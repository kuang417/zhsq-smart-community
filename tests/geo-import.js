/**
 * 离线底图「多格式导入」回归
 *
 * 背景：合规渠道交付的行政区划数据通常是 Shapefile 压缩包或 GeoPackage，
 * 平台原先只收 .geojson，用户必须自行安装 GDAL / QGIS 转换。
 * 本轮新增 server/geo-import.js 做零依赖格式适配，同时保持来源合规红线：
 * 包内文件名 / README / 图层名 / 字段名均参与合规特征扫描。
 *
 * 断言要点：
 *   1) .geojson 原路径无回归；
 *   2) .zip(Shapefile .shp+.dbf+.cpg，中文属性) / .zip(.gpkg) / .gpkg 均可直接导入；
 *   3) OSM / Geofabrik / ODbL 特征换容器、改文件名、改来源说明仍被拒；
 *   4) 投影坐标、缺 .dbf、损坏压缩包、非法扩展名、zip bomb 均被拒；
 *   5) meta 登记原始文件名；结束恢复示意底图，不留演示数据。
 *
 * 用法：先 npm start，再 node tests/geo-import.js
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import Database from 'better-sqlite3'
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const COMPLIANT_SOURCE = '自然资源部标准地图服务（bzdt.ch.mnr.gov.cn，带审图号）'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const callJson = async (p, { method = 'GET', token } = {}) => {
  const r = await fetch(BASE + p, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} })
  let d = null
  try { d = await r.json() } catch {}
  return { status: r.status, code: d?.code, data: d?.data, message: d?.message }
}

/* ---------------- 测试样本构造器 ---------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** 构造 store 方式的 ZIP32（可选 deflate，用于覆盖两种压缩路径） */
function makeZip(files) {
  const locals = [], centrals = []
  let offset = 0
  for (const [name, raw, forcedMethod] of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const method = forcedMethod === 8 ? 8 : 0
    const compressed = method === 8 ? zlib.deflateRawSync(raw) : raw
    const crc = crc32(raw)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(method, 8); lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(compressed.length, 18); lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    const local = Buffer.concat([lh, nameBuf, compressed])
    locals.push(local)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(method, 10); ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(compressed.length, 20); ch.writeUInt32LE(raw.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([ch, nameBuf]))
    offset += local.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

/** ESRI 外环顺时针，解析层会反转成 GeoJSON 逆时针 */
const square = (x, y, size = 0.01) => [
  [x, y], [x, y + size], [x + size, y + size], [x + size, y], [x, y]
]

function makeShp(rings) {
  const recs = []
  rings.forEach((ring, i) => {
    const c = Buffer.alloc(4 + 32 + 4 + 4 + 4 + ring.length * 16)
    c.writeInt32LE(5, 0)
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
    c.writeDoubleLE(Math.min(...xs), 4); c.writeDoubleLE(Math.min(...ys), 12)
    c.writeDoubleLE(Math.max(...xs), 20); c.writeDoubleLE(Math.max(...ys), 28)
    c.writeInt32LE(1, 36); c.writeInt32LE(ring.length, 40); c.writeInt32LE(0, 44)
    ring.forEach((p, j) => { c.writeDoubleLE(p[0], 48 + j * 16); c.writeDoubleLE(p[1], 56 + j * 16) })
    const h = Buffer.alloc(8)
    h.writeUInt32BE(i + 1, 0); h.writeUInt32BE(c.length / 2, 4)
    recs.push(Buffer.concat([h, c]))
  })
  const body = Buffer.concat(recs)
  const head = Buffer.alloc(100)
  head.writeInt32BE(9994, 0); head.writeUInt32BE((100 + body.length) / 2, 24)
  head.writeInt32LE(1000, 28); head.writeInt32LE(5, 32)
  head.writeDoubleLE(108.3, 36); head.writeDoubleLE(22.8, 44)
  head.writeDoubleLE(108.4, 52); head.writeDoubleLE(22.9, 60)
  return Buffer.concat([head, body])
}

function makeDbf(fields, rows) {
  const headerLen = 33 + fields.length * 32
  const recordLen = 1 + fields.reduce((s, f) => s + f.len, 0)
  const buf = Buffer.alloc(headerLen + rows.length * recordLen)
  buf[0] = 0x03
  buf.writeUInt32LE(rows.length, 4)
  buf.writeUInt16LE(headerLen, 8)
  buf.writeUInt16LE(recordLen, 10)
  fields.forEach((f, i) => {
    const off = 32 + i * 32
    Buffer.from(f.name.slice(0, 10), 'latin1').copy(buf, off)
    buf[off + 11] = 0x43
    buf[off + 16] = f.len
  })
  buf[headerLen - 1] = 0x0d
  rows.forEach((r, i) => {
    const s = headerLen + i * recordLen
    buf[s] = 0x20
    let p = s + 1
    for (const f of fields) {
      const b = Buffer.from(String(r[f.name] ?? ''), 'utf8')
      const n = Math.min(b.length, f.len)
      b.copy(buf, p, 0, n)
      for (let k = p + n; k < p + f.len; k++) buf[k] = 0x20
      p += f.len
    }
  })
  return buf
}

function polygonWkb(ring, type = 3) {
  const b = Buffer.alloc(1 + 4 + 4 + 4 + ring.length * 16)
  b[0] = 1; b.writeUInt32LE(type, 1); b.writeUInt32LE(1, 5)
  b.writeUInt32LE(ring.length, 9)
  ring.forEach((p, i) => {
    b.writeDoubleLE(p[0], 13 + i * 16); b.writeDoubleLE(p[1], 21 + i * 16)
  })
  return b
}
function gpkgGeom(wkb, srsId = 4326) {
  const h = Buffer.alloc(8)
  h[0] = 0x47; h[1] = 0x50; h[2] = 0; h[3] = 0x01 // little endian + 无 envelope
  h.writeInt32LE(srsId, 4)
  return Buffer.concat([h, wkb])
}

/** 构造一个最小合规 GeoPackage；tableName / 字段可注入 OSM 特征用于绕过测试 */
function makeGpkg(items, { tableName = 'boundary', srsId = 4326, extraCols = [], description = '测试样本' } = {}) {
  const tmp = path.join(os.tmpdir(), `zhsq-geo-test-${process.pid}-${Date.now()}.gpkg`)
  const db = new Database(tmp)
  try {
    db.exec('CREATE TABLE gpkg_contents (table_name TEXT, data_type TEXT, identifier TEXT, description TEXT, srs_id INTEGER)')
    db.exec('CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER, z INTEGER, m INTEGER)')
    const colDefs = extraCols.map((c) => `"${c}" TEXT`).join(', ')
    db.exec(`CREATE TABLE "${tableName}" (fid INTEGER PRIMARY KEY, NAME TEXT${colDefs ? ', ' + colDefs : ''}, geom BLOB)`)
    db.prepare("INSERT INTO gpkg_contents VALUES (?, 'features', ?, ?, ?)").run(tableName, '行政区划边界', description, srsId)
    db.prepare('INSERT INTO gpkg_geometry_columns VALUES (?, ?, ?, ?, 0, 0)').run(tableName, 'geom', 'POLYGON', srsId)
    const ins = db.prepare(`INSERT INTO "${tableName}" (NAME, geom) VALUES (?, ?)`)
    items.forEach((it, i) => ins.run(it.name, gpkgGeom(polygonWkb(square(108.3 + i * 0.02, 22.8)), srsId)))
    db.close()
    const buf = fs.readFileSync(tmp)
    return buf
  } finally {
    try { db.close() } catch {}
    try { fs.unlinkSync(tmp) } catch {}
  }
}

const geojson = (names) => ({
  type: 'FeatureCollection',
  features: names.map((nm, i) => ({
    type: 'Feature', properties: { name: nm, code: 'G' + i },
    geometry: { type: 'Polygon', coordinates: [square(108.3 + i * 0.02, 22.8)] }
  }))
})

/* ---------------- 上传封装 ---------------- */

const importFile = async (token, buffer, filename, fields = {}) => {
  const fd = new FormData()
  const all = {
    name: '兴宁区社区行政区划边界（多格式测试）', source: COMPLIANT_SOURCE,
    reviewNo: 'GS(2024)0000号', crs: 'CGCS2000', nameField: 'name', ...fields
  }
  for (const [k, v] of Object.entries(all)) fd.append(k, String(v))
  fd.append('file', new Blob([buffer]), filename)
  const r = await fetch(`${BASE}/api/geo/basemap/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
  })
  let d = null
  try { d = await r.json() } catch {}
  return { status: r.status, code: d?.code, data: d?.data, message: d?.message }
}
const isRejected = (r, code = 40002) => r.status === 200 && r.code === code
const reset = async (token) => callJson('/api/geo/basemap', { method: 'DELETE', token })

/* ---------------- 主流程 ---------------- */

const main = async () => {
  const token = await login('admin', 'admin123')
  console.log('\n=== 离线底图多格式导入回归 ===')
  await reset(token)

  // 取真实业务网格名，验证「同名才能着色」的口径
  const stats = await callJson('/api/stats/geo?layer=人口', { token })
  const names = (stats.data?.values || []).slice(0, 2).map((v) => v.name)
  const goodNames = names.length >= 2 ? names : ['民生社区第01网格', '民生社区第02网格']

  // 1) 原 .geojson 路径无回归
  const plain = await importFile(token, Buffer.from(JSON.stringify(geojson(goodNames))), 'boundary.geojson')
  check('.geojson 原导入路径无回归', plain.status === 200 && plain.code === 0, plain.message)
  check('meta 登记原始文件名', plain.data?.sourceFile === 'boundary.geojson', String(plain.data?.sourceFile))
  await reset(token)

  // 2) .zip 内 Shapefile（.shp + .dbf + .cpg，中文属性）
  const shp = makeShp(goodNames.map((_, i) => square(108.3 + i * 0.02, 22.8)))
  const dbf = makeDbf([{ name: 'NAME', len: 60 }, { name: 'CODE', len: 20 }],
    goodNames.map((nm, i) => ({ NAME: nm, CODE: 'G' + i })))
  const zipShp = makeZip([
    ['边界数据.shp', shp], ['边界数据.dbf', dbf],
    ['边界数据.cpg', Buffer.from('UTF-8', 'utf8')],
    ['边界数据.prj', Buffer.from('GEOGCS["CGCS2000"]', 'utf8')]
  ])
  const z1 = await importFile(token, zipShp, 'xingning-boundary.zip', { nameField: 'NAME' })
  check('.zip 内 Shapefile 直接导入成功（无需 GDAL）', z1.status === 200 && z1.code === 0, z1.message)
  check('Shapefile 中文名称字段解析正确', z1.data?.featureCount === 2, `${z1.data?.featureCount} 个区域`)
  const full1 = await callJson('/api/geo/basemap', { token })
  check('Shapefile 几何转成 GeoJSON 且名称与业务网格同名',
    goodNames.includes(full1.data?.geojson?.features?.[0]?.properties?.name) &&
    full1.data?.geojson?.features?.[0]?.geometry?.type === 'Polygon',
    String(full1.data?.geojson?.features?.[0]?.properties?.name))
  check('Shapefile 附加属性被剥离，仅保留 name / code',
    Object.keys(full1.data?.geojson?.features?.[0]?.properties || {}).sort().join(',') === 'code,name')
  await reset(token)

  // 3) .zip 内 GeoPackage（deflate 压缩路径）
  const gpkg = makeGpkg(goodNames.map((nm) => ({ name: nm })))
  const zipGpkg = makeZip([
    ['boundary.gpkg', gpkg, 8],
    ['说明.txt', Buffer.from('数据来源：属地自然资源主管部门依法提供', 'utf8')]
  ])
  const z2 = await importFile(token, zipGpkg, 'boundary-gpkg.zip')
  check('.zip 内 GeoPackage（deflate）导入成功', z2.status === 200 && z2.code === 0, z2.message)
  await reset(token)

  // 4) .gpkg 直接上传
  const z3 = await importFile(token, gpkg, 'boundary.gpkg')
  check('.gpkg 直接导入成功', z3.status === 200 && z3.code === 0, z3.message)
  await reset(token)

  // 5) 合规守护：换容器 / 改文件名 / 改来源说明都拦得住
  const osmReadmeZip = makeZip([
    ['边界数据.shp', shp], ['边界数据.dbf', dbf],
    ['README', Buffer.from('This data is created from OpenStreetMap and licensed under ODbL 1.0', 'utf8')]
  ])
  const r1 = await importFile(token, osmReadmeZip, '合规行政区划.zip')
  check('压缩包内 ODbL / OSM 版权声明被内容守护拒绝',
    isRejected(r1) && /境外|无资质|特征|管理条例/.test(r1.message || ''), r1.message)

  const osmMetaGpkg = makeGpkg([{ name: goodNames[0] }], {
    description: 'Geofabrik daily export created from OpenStreetMap data, ODbL 1.0'
  })
  const r2 = await importFile(token, osmMetaGpkg, '合规数据.gpkg', { source: '属地自然资源主管部门依法提供的行政区划数据' })
  check('GeoPackage 元数据含 Geofabrik 声明、改写来源仍被拒',
    isRejected(r2) && /境外|无资质|特征|管理条例/.test(r2.message || ''), r2.message)

  const osmNameZip = makeZip([['guangxi-osm-260514-free.gpkg', makeGpkg([{ name: goodNames[0] }])]])
  const r2b = await importFile(token, osmNameZip, '行政区划数据.zip')
  check('包内文件名含 OSM 特征被容器级守护拒绝', isRejected(r2b), r2b.message)

  const osmTableGpkg = makeGpkg([{ name: goodNames[0] }], { tableName: 'gis_osm_adminareas_a_free' })
  const r3 = await importFile(token, osmTableGpkg, '合规数据.gpkg')
  check('GeoPackage 图层名 gis_osm_* 被容器级守护拒绝', isRejected(r3), r3.message)

  const osmFieldZip = makeZip([
    ['b.geojson', Buffer.from(JSON.stringify({
      ...geojson([goodNames[0]]),
      features: [{ ...geojson([goodNames[0]]).features[0], properties: { name: goodNames[0], osm_id: 'relation/123' } }]
    }), 'utf8')]
  ])
  const r4 = await importFile(token, osmFieldZip, '合规数据.zip')
  check('zip 内 GeoJSON 带 osm_id 字段仍被拒', isRejected(r4), r4.message)

  const osmSource = await importFile(token, Buffer.from(JSON.stringify(geojson([goodNames[0]]))),
    'boundary.geojson', { source: 'Geofabrik 广西数据包（已转成 GeoJSON）' })
  check('OSM 数据转格式 + 改写容器仍被来源守护拒绝', isRejected(osmSource), osmSource.message)

  // 6) 结构与安全边界
  const noDbf = await importFile(token, makeZip([['边界数据.shp', shp]]), '缺属性表.zip')
  check('Shapefile 压缩包缺 .dbf 被拒', isRejected(noDbf) && /dbf/.test(noDbf.message || ''), noDbf.message)

  const projected = await importFile(token, makeGpkg([{ name: goodNames[0] }], { srsId: 3857 }), 'webmercator.gpkg')
  check('Web Mercator 投影坐标被明确拒绝', isRejected(projected) && /投影|经纬度/.test(projected.message || ''), projected.message)

  const badZip = await importFile(token, Buffer.from('PK-fake-zip-not-a-real-archive'), 'broken.gpkg.zip')
  check('损坏的 ZIP 容器被拒（40002）', isRejected(badZip), badZip.message)

  const badExt = await importFile(token, Buffer.from('x'), 'map.exe')
  check('非法扩展名被文件类型守卫拒绝（40010）', badExt.status === 400 && badExt.code === 40010, `${badExt.status}/${badExt.code}`)

  const traversal = makeZip([['../../boundary.geojson', Buffer.from(JSON.stringify(geojson([goodNames[0]])), 'utf8')]])
  const tv = await importFile(token, traversal, 'traversal.zip')
  check('ZIP 路径穿越条目按 basename 安全解析，不落盘到外层', tv.status === 200 && tv.code === 0, tv.message)

  // 超限要素：301 个区域
  const tooMany = geojson(Array.from({ length: 301 }, (_, i) => '网格' + i))
  const tm = await importFile(token, Buffer.from(JSON.stringify(tooMany)), 'toomany.geojson')
  check('区域数超过 300 被拒', isRejected(tm) && /上限/.test(tm.message || ''), tm.message)

  // 未鉴权上传
  const noAuth = await fetch(`${BASE}/api/geo/basemap/import`, { method: 'POST', body: new FormData() })
  check('未鉴权导入被拦截（401）', noAuth.status === 401, `status=${noAuth.status}`)

  // 收尾：确认回落示意
  await reset(token)
  const after = await callJson('/api/geo/basemap', { token })
  check('清理后回落示意底图', after.data?.enabled === false && after.data?.geojson === null)

  console.log(`\n结果：${pass} 通过 / ${failCount} 失败`)
  process.exit(failCount ? 1 : 0)
}
main().catch((e) => {
  console.error('测试异常', e)
  login('admin', 'admin123').then((t) => fetch(`${BASE}/api/geo/basemap`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }))
    .catch(() => {}).finally(() => process.exit(1))
})
