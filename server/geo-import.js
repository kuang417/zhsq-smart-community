/**
 * 离线矢量底图「多格式导入适配层」
 *
 * 目的：属地自然资源主管部门 / 甲级测绘资质单位交付的行政区划数据，
 * 常见格式是 Shapefile 压缩包（.shp + .dbf + .prj + .cpg，打包成 .zip）
 * 或 GeoPackage（.gpkg，可能再套一层 .zip）。原先平台只收 .geojson，
 * 用户必须自行安装 GDAL / QGIS 转换，落地门槛极高。
 *
 * 本模块零新增依赖（仅 Node 内置 + 项目已有 better-sqlite3），把这几种
 * 容器统一解析成 GeoJSON FeatureCollection，再交给 geo-basemap.js 做
 * 结构校验、坐标校验、属性剥离与合规守护。
 *
 * !! 合规边界不变 !!
 * 支持格式 ≠ 允许来源。压缩包内文件名、README / 版权文本、GeoPackage
 * 图层名、字段名与属性值都会先经过内容级合规特征扫描；
 * OpenStreetMap / Geofabrik / ODbL 衍生数据即使改文件名、改来源说明、
 * 换容器，仍会被拒绝。行政区划边界须取自带审图号的合规渠道。
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { assertCompliantText } from './geo-basemap.js'

/** 上传体积由 multer 控制（60MB）；这里再限制解压后的膨胀，防 zip bomb */
const MAX_ENTRIES = 64
const MAX_UNCOMPRESSED = 120 * 1024 * 1024
const MAX_SINGLE = 80 * 1024 * 1024
/** 只扫描小文本文件，避免把 200MB 的二进制边界当字符串处理 */
const MAX_AUDIT_TEXT = 64 * 1024
const TEXT_EXT = new Set(['.txt', '.md', '.json', '.geojson', '.xml', '.html', '.htm', '.cpg', '.prj', '.csv', '.readme', ''])
const RING_POINT_LIMIT = 60000

/* ---------------- ZIP 容器（仅 store / deflate，ZIP32） ---------------- */

function readZip(buf) {
  if (buf.length < 22) throw new Error('ZIP 文件损坏或不完整')
  let eocd = -1
  const floor = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是合法的 ZIP 压缩包（未找到中央目录）')
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count > MAX_ENTRIES) throw new Error(`压缩包内文件数量超过上限（${MAX_ENTRIES}）`)
  if (cdOffset === 0xffffffff) throw new Error('ZIP64 超大压缩包不受支持，请转换为 GeoJSON 后再导入')

  const out = new Map()
  let p = cdOffset
  let total = 0
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP 中央目录损坏')
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const fnLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const rawName = buf.subarray(p + 46, p + 46 + fnLen).toString('utf8')
    p += 46 + fnLen + extraLen + commentLen
    if ([compSize, uncompSize, localOff].includes(0xffffffff)) throw new Error('ZIP64 超大条目不受支持，请转换为 GeoJSON 后再导入')
    // 路径穿越防护：只取 basename，绝不按原始路径落盘
    const name = path.basename(rawName.replace(/\\/g, '/'))
    if (!name || rawName.endsWith('/')) continue
    if (uncompSize > MAX_SINGLE) throw new Error(`压缩包内单文件超过上限（${MAX_SINGLE / 1024 / 1024}MB）`)
    if (total + uncompSize > MAX_UNCOMPRESSED) throw new Error('压缩包解压后总体积超过上限，请简化边界后再导入')
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('ZIP 本地文件头损坏')
    const lfn = buf.readUInt16LE(localOff + 26)
    const lex = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lfn + lex
    if (start + compSize > buf.length) throw new Error('ZIP 条目数据不完整')
    const packed = buf.subarray(start, start + compSize)
    let data
    if (method === 0) data = Buffer.from(packed)
    else if (method === 8) {
      try { data = zlib.inflateRawSync(packed, { maxOutputLength: MAX_SINGLE }) }
      catch { throw new Error('ZIP 条目解压失败或体积超限') }
    } else throw new Error(`ZIP 使用了不支持的压缩方式（method=${method}）`)
    if (data.length > MAX_SINGLE) throw new Error('ZIP 条目解压后体积超限')
    total += data.length
    out.set(name.toLowerCase(), { name, data })
  }
  if (!out.size) throw new Error('压缩包内没有可用文件')
  return out
}

/** 采集包内可用于来源合规判定的文本（文件名 + 小型文本文件） */
function collectAuditTexts(entries) {
  const texts = []
  for (const { name, data } of entries.values()) {
    texts.push(name)
    const ext = path.extname(name).toLowerCase()
    if (TEXT_EXT.has(ext) && data.length <= MAX_AUDIT_TEXT) texts.push(data.toString('utf8'))
  }
  return texts
}

/* ---------------- DBF 属性表（中文编码自适应） ---------------- */

function normalizeEnc(cpg) {
  const s = String(cpg || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!s || s === '65001' || s === 'utf8') return ''
  if (s === '936' || s === 'gbk' || s === 'gb2312' || s === 'gb18030') return 'gbk'
  if (s === 'utf8bom') return ''
  return ''
}

function decodeDbfText(bytes, cpg) {
  let end = bytes.length
  while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) end--
  const b = bytes.subarray(0, end)
  const preferred = normalizeEnc(cpg)
  const candidates = preferred ? [preferred, 'utf-8', 'gbk'] : ['utf-8', 'gbk']
  for (const enc of candidates) {
    try { return new TextDecoder(enc, { fatal: true }).decode(b).trim() } catch { /* 换下一个编码 */ }
  }
  return b.toString('latin1').trim()
}

function parseDbf(buf, cpg) {
  if (!buf || buf.length < 33) throw new Error('.dbf 属性表缺失或格式不正确')
  const numRecords = buf.readUInt32LE(4)
  const headerLen = buf.readUInt16LE(8)
  const recordLen = buf.readUInt16LE(10)
  if (headerLen < 33 || recordLen < 2 || headerLen > buf.length) throw new Error('.dbf 头部损坏')
  const fields = []
  for (let off = 32; off + 32 <= headerLen && buf[off] !== 0x0d; off += 32) {
    const name = buf.subarray(off, off + 11).toString('latin1').split('\0')[0].trim()
    const len = buf[off + 16]
    if (name && len > 0) fields.push({ name, len })
  }
  const rows = []
  for (let i = 0; i < numRecords; i++) {
    const s = headerLen + i * recordLen
    if (s + recordLen > buf.length) break
    if (buf[s] === 0x2a) { rows.push(null); continue } // 已删除记录：占位以保持与 .shp 序号对齐
    let p = s + 1
    const props = {}
    for (const f of fields) {
      const raw = buf.subarray(p, Math.min(p + f.len, s + recordLen))
      props[f.name] = decodeDbfText(raw, cpg)
      p += f.len
    }
    rows.push(props)
  }
  return rows
}

/* ---------------- Shapefile 面要素 ---------------- */

function parseShp(buf) {
  if (!buf || buf.length < 100 || buf.readInt32BE(0) !== 9994) throw new Error('.shp 文件缺失或格式不正确')
  const geoms = []
  let off = 100
  while (off + 8 <= buf.length) {
    const contentLen = buf.readUInt32BE(off + 4) * 2
    const s = off + 8
    if (contentLen < 4 || s + contentLen > buf.length) break
    const type = buf.readInt32LE(s)
    if (![5, 15, 25].includes(type)) {
      throw new Error(`Shapefile 几何类型 ${type} 不受支持（仅支持面 Polygon / PolygonZ / PolygonM）`)
    }
    const numParts = buf.readInt32LE(s + 36)
    const numPoints = buf.readInt32LE(s + 40)
    if (numParts < 1 || numPoints < 4 || numParts > 10000 || numPoints > RING_POINT_LIMIT) throw new Error('Shapefile 面要素尺寸异常')
    const partsAt = s + 44
    const pointsAt = partsAt + numParts * 4
    if (pointsAt + numPoints * 16 > s + contentLen) throw new Error('.shp 记录长度不足，文件可能损坏')
    const parts = []
    for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(partsAt + i * 4))
    const rings = []
    for (let i = 0; i < numParts; i++) {
      const from = parts[i]
      const to = i + 1 < numParts ? parts[i + 1] : numPoints
      const ring = []
      for (let j = from; j < to; j++) ring.push([buf.readDoubleLE(pointsAt + j * 16), buf.readDoubleLE(pointsAt + j * 16 + 8)])
      if (ring.length < 3) throw new Error('Shapefile 环点数不足')
      const first = ring[0]
      const last = ring[ring.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first])
      // ESRI 外环顺时针、内环逆时针；GeoJSON RFC 7946 恰好相反，统一反转
      rings.push(ring.reverse())
    }
    geoms.push({ type: 'Polygon', coordinates: rings })
    off = s + contentLen
  }
  if (!geoms.length) throw new Error('.shp 中没有可导入的面要素')
  return geoms
}

function buildFeatureCollection(geoms, rows, nameField) {
  const field = String(nameField || 'name').toLowerCase()
  const features = geoms.map((geometry, i) => {
    const p = rows[i] || {}
    const keys = Object.keys(p)
    const nameKey = keys.find((k) => k.toLowerCase() === field)
    const codeKey = keys.find((k) => ['code', 'adcode', 'gridcode', 'xzqdm', 'xzqhdm', 'pac'].includes(k.toLowerCase()))
    const props = { ...p }
    if (nameKey && p[nameKey]) props.name = p[nameKey]
    if (codeKey && p[codeKey]) props.code = p[codeKey]
    return { type: 'Feature', properties: props, geometry }
  })
  return { type: 'FeatureCollection', features }
}

/* ---------------- GeoPackage（GPKG 头 + WKB） ---------------- */

function parseWkbGeom(buf, pos) {
  if (pos + 5 > buf.length) throw new Error('GeoPackage 几何数据损坏')
  const le = buf[pos] === 1
  const u32 = (p) => le ? buf.readUInt32LE(p) : buf.readUInt32BE(p)
  const dbl = (p) => le ? buf.readDoubleLE(p) : buf.readDoubleBE(p)
  let p = pos + 1
  const rawType = u32(p); p += 4
  const iso = Math.floor(rawType / 1000)
  const dims = 2 + (iso === 1 ? 1 : iso === 2 ? 1 : iso === 3 ? 2 : 0)
  const type = rawType % 1000
  if (![3, 6].includes(type)) return { geometry: null, end: p }
  const count = () => { const v = u32(p); p += 4; return v }
  const readRing = () => {
    const n = count()
    if (n > RING_POINT_LIMIT) throw new Error('GeoPackage 单个环坐标点超上限')
    const ring = []
    for (let i = 0; i < n; i++) {
      if (p + dims * 8 > buf.length) throw new Error('GeoPackage 几何数据不完整')
      ring.push([dbl(p), dbl(p + 8)])
      p += dims * 8
    }
    return ring
  }
  const readPolygon = () => {
    const n = count()
    if (n > 10000) throw new Error('GeoPackage 面要素环数异常')
    const rings = []
    for (let i = 0; i < n; i++) rings.push(readRing())
    return rings
  }
  if (type === 3) return { geometry: { type: 'Polygon', coordinates: readPolygon() }, end: p }
  const n = count()
  if (n > 10000) throw new Error('GeoPackage MultiPolygon 子面数量异常')
  const polys = []
  for (let i = 0; i < n; i++) {
    const sub = parseWkbGeom(buf, p)
    if (!sub.geometry || sub.geometry.type !== 'Polygon') throw new Error('GeoPackage MultiPolygon 包含非面几何')
    polys.push(sub.geometry.coordinates)
    p = sub.end
  }
  return { geometry: { type: 'MultiPolygon', coordinates: polys }, end: p }
}

function parseGpkgGeometry(blob) {
  if (!blob || blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) return null
  const flags = blob[3]
  const little = (flags & 0x01) === 1
  const srsId = little ? blob.readInt32LE(4) : blob.readInt32BE(4)
  if ([3857, 900913, 3587, 102100].includes(srsId)) {
    throw new Error('检测到 Web Mercator 投影坐标（米），平台业务点位为经纬度；请先转换为经纬度 GeoJSON 后再导入')
  }
  const envIndicator = (flags >> 1) & 0x07
  const envDoubles = [0, 4, 6, 8, 8][envIndicator] || 0
  const wkb = blob.subarray(8 + envDoubles * 8)
  return parseWkbGeom(wkb, 0).geometry
}

function parseGeoPackage(buffer, nameField) {
  const tmp = path.join(os.tmpdir(), `zhsq-geo-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.gpkg`)
  fs.writeFileSync(tmp, buffer)
  let db
  try {
    db = new Database(tmp, { readonly: true, fileMustExist: true })
    const tables = db.prepare("SELECT table_name, identifier, description FROM gpkg_contents WHERE data_type = 'features'").all()
    if (!tables.length) throw new Error('GeoPackage 中没有面要素图层（gpkg_contents 无 features 记录）')
    const geoCols = new Map()
    try {
      for (const r of db.prepare('SELECT table_name, column_name FROM gpkg_geometry_columns').all()) geoCols.set(r.table_name, r.column_name)
    } catch { /* 非标准包：回落默认 geom 列 */ }
    const auditTexts = []
    const features = []
    for (const t of tables) {
      const tn = String(t.table_name)
      const col = String(geoCols.get(tn) || 'geom')
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tn) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(col)) throw new Error('GeoPackage 图层名 / 几何列名不合法')
      auditTexts.push(tn, String(t.identifier || ''), String(t.description || ''))
      const stmt = db.prepare(`SELECT * FROM "${tn}" LIMIT 301`)
      const cols = stmt.columns().map((c) => c.name)
      auditTexts.push(...cols)
      for (const row of stmt.all()) {
        for (const c of cols) {
          const v = row[c]
          if (v != null && typeof v !== 'object') auditTexts.push(String(v))
        }
        let geometry = null
        try { geometry = parseGpkgGeometry(Buffer.isBuffer(row[col]) ? row[col] : Buffer.from(row[col] || [])) }
        catch (e) { throw new Error(`GeoPackage 图层 ${tn} 几何解析失败：${e.message}`) }
        // 非面几何（点 / 线图层）正常跳过；面几何损坏必须报错，不能静默少导区域
        if (!geometry) continue
        const properties = {}
        for (const c of cols) if (c !== col && row[c] != null && typeof row[c] !== 'object') properties[c] = row[c]
        const field = String(nameField || 'name').toLowerCase()
        const nk = Object.keys(properties).find((k) => k.toLowerCase() === field)
        if (nk) properties.name = properties[nk]
        const ck = Object.keys(properties).find((k) => ['code', 'adcode', 'gridcode', 'xzqdm', 'xzqhdm', 'pac'].includes(k.toLowerCase()))
        if (ck) properties.code = properties[ck]
        features.push({ type: 'Feature', properties, geometry })
      }
    }
    return { geojson: { type: 'FeatureCollection', features }, auditTexts }
  } finally {
    try { db?.close() } catch { /* 已关闭 */ }
    try { fs.unlinkSync(tmp) } catch { /* 已删除 */ }
  }
}

/* ---------------- 统一入口 ---------------- */

const parseJson = (data) => {
  const text = data.toString('utf8').replace(/^\uFEFF/, '')
  try { return JSON.parse(text) } catch { throw new Error('文件不是合法的 JSON / GeoJSON') }
}

/**
 * 把上传文件解析为 GeoJSON FeatureCollection。
 * 包内文本 / 表名 / 字段名会在此完成来源合规特征扫描（防换壳绕过）。
 * 返回的对象仍需调用方执行 assertCompliantFeatureContent + validateGeoJSON。
 */
export function parseBasemapFile(buffer, filename, nameField = 'name') {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('上传文件为空')
  const ext = path.extname(String(filename || '').toLowerCase())
  if (ext === '.geojson' || ext === '.json') {
    const raw = parseJson(buffer)
    assertCompliantText(buffer.toString('utf8').slice(0, MAX_AUDIT_TEXT))
    return raw
  }
  if (ext === '.zip') {
    const entries = readZip(buffer)
    for (const t of collectAuditTexts(entries)) assertCompliantText(t)
    const all = [...entries.values()]
    const gj = all.find((e) => /\.(geojson|json)$/i.test(e.name))
    if (gj) return parseJson(gj.data)
    const gpkg = all.find((e) => /\.gpkg$/i.test(e.name))
    if (gpkg) {
      const r = parseGeoPackage(gpkg.data, nameField)
      r.auditTexts.forEach(assertCompliantText)
      return r.geojson
    }
    const shp = all.find((e) => /\.shp$/i.test(e.name))
    if (shp) {
      const dbf = all.find((e) => /\.dbf$/i.test(e.name))
      const cpg = all.find((e) => /\.cpg$/i.test(e.name))
      const prj = all.find((e) => /\.prj$/i.test(e.name))
      if (!dbf) throw new Error('Shapefile 压缩包缺少 .dbf 属性表（要素名称来自属性字段）')
      if (prj) assertCompliantText(prj.data.toString('utf8').slice(0, MAX_AUDIT_TEXT))
      const geoms = parseShp(shp.data)
      const rows = parseDbf(dbf.data, cpg?.data.toString('utf8'))
      return buildFeatureCollection(geoms, rows, nameField)
    }
    throw new Error('压缩包中没有 .geojson / .gpkg / .shp+.dbf 边界文件')
  }
  if (ext === '.gpkg') {
    const r = parseGeoPackage(buffer, nameField)
    r.auditTexts.forEach(assertCompliantText)
    return r.geojson
  }
  throw new Error('仅支持 .geojson / .json / .zip / .gpkg 文件')
}
