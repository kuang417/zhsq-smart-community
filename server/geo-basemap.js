/**
 * 离线矢量底图（真实行政区边界 GeoJSON）存储与校验
 *
 * 合规说明（地图数据）：
 *  - 本模块不内置、不下载、不缓存任何在线地图瓦片，也不引入任何境外 / 无资质地图源。
 *  - 真实边界由管理员从合规渠道获取后导入，落在本机 server/data/geo/ 下，
 *    由前端 ECharts 自绘渲染，断网可用，全程无外部地图请求。
 *  - 导入必须登记「数据来源 + 审图号 + 坐标系」，并在页面公示；
 *    行政区划 / 边界属测绘成果，应取自自然资源主管部门或有测绘资质的单位，
 *    且按《地图管理条例》使用带审图号的标准地图。
 *
 * 合规获取渠道（供界面与文档展示）：
 *  1. 自然资源部标准地图服务 bzdt.ch.mnr.gov.cn（带审图号的标准地图）
 *  2. 国家地理信息公共服务平台「天地图」www.tianditu.gov.cn（含政务版 / 离线部署授权）
 *  3. 属地自然资源主管部门（如自治区 / 市 / 区自然资源局）依法提供的行政区划数据
 *  4. 具备甲级测绘资质单位提供、经审核的政务用图数据
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const GEO_DIR = path.join(__dirname, 'data', 'geo')
const BASEMAP_FILE = path.join(GEO_DIR, 'basemap.json')

/** 明确禁止的无资质 / 境外地图数据源（导入时按来源文本拦截并给出合规提示） */
const FORBIDDEN_SOURCE_RE = /openstreetmap|open\s*street\s*map|\bosm\b|google|mapbox|bing|apple\s*maps?|arcgis\s*online|maptiler|stamen|carto\s*db|geofabrik|bbbike|hotosm|\bodbl\b|open\s*database\s*licen[cs]e|瓦片抓取|瓦片缓存|爬取.*瓦片/i

/**
 * 文件内容级合规特征：Geofabrik / OSM 衍生包常见的版权声明、生成器与要素主键。
 * 只匹配明确的来源标识，不因合规数据里的 properties.source / license 键名误伤。
 */
const FORBIDDEN_CONTENT_RE = /openstreetmap|open\s*street\s*map|\bosm\b|geofabrik|bbbike|hotosm|\bodbl\b|open\s*database\s*licen[cs]e|©\s*openstreetmap/i
/** 容器级特征：压缩包文件名、README、GeoPackage 图层名（如 gis_osm_*_free）同样要拦 */
const FORBIDDEN_ARCHIVE_RE = /openstreetmap|open\s*street\s*map|gis_osm|osm[_/-]|[_/-]osm(?:[_/-]|$)|\bosm\b|geofabrik|bbbike|hotosm|\bodbl\b|open\s*database\s*licen[cs]e|©\s*openstreetmap/i
const OSM_FIELD_RE = /^(?:osm[_-]|@id$|osmid$|way_id$|relation_id$|geofabrik|gis_osm)/i
const NONCOMPLIANT_MSG = '检测到 OpenStreetMap / Geofabrik / ODbL 等境外或无资质地图数据特征，按《地图管理条例》不得用于本平台；请使用自然资源部标准地图服务、天地图或属地自然资源主管部门提供的带审图号数据'
export const COMPLIANT_SOURCES = [
  '自然资源部标准地图服务（bzdt.ch.mnr.gov.cn，带审图号）',
  '国家地理信息公共服务平台「天地图」（www.tianditu.gov.cn）',
  '属地自然资源主管部门依法提供的行政区划数据',
  '具备甲级测绘资质单位提供、经审核的政务用图数据'
]
export const CRS_OPTIONS = ['GCJ-02', 'CGCS2000', 'WGS84']

const MAX_FEATURES = 300
const MAX_POINTS = 60000
const MAX_NAME_LEN = 100
const MAX_META_LEN = 200

/** 递归收集 GeoJSON 坐标点并校验数值与经纬度范围；返回点数，非法则抛错 */
function countPoints(coords, depth, state) {
  if (!Array.isArray(coords)) throw new Error('坐标结构不是数组')
  // GeoJSON: Polygon -> [ring][point]，Point -> [lng,lat]；用数值对判定叶子
  if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const [lng, lat] = coords
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error('存在非数值坐标')
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) throw new Error('坐标超出经纬度合法范围')
    state.n++
    if (state.n > MAX_POINTS) throw new Error(`坐标点超过上限（${MAX_POINTS}），请简化边界后再导入`)
    return
  }
  if (depth > 6) throw new Error('坐标嵌套层级过深')
  for (const c of coords) countPoints(c, depth + 1, state)
}

/**
 * 校验并规整导入的 GeoJSON：仅保留 name / code，剔除其它属性，
 * 避免把任意 HTML / 脚本带进 tooltip，也控制文件体积。
 */
export function validateGeoJSON(raw, nameField = 'name') {
  if (!raw || typeof raw !== 'object') throw new Error('文件内容不是合法的 JSON 对象')
  if (raw.type !== 'FeatureCollection') throw new Error('仅支持 GeoJSON FeatureCollection')
  if (!Array.isArray(raw.features) || !raw.features.length) throw new Error('features 为空，没有可导入的区域')
  if (raw.features.length > MAX_FEATURES) throw new Error(`区域数量超过上限（${MAX_FEATURES}）`)
  const field = String(nameField || 'name').slice(0, 40)
  const state = { n: 0 }
  const features = raw.features.map((f, i) => {
    if (!f || f.type !== 'Feature' || !f.geometry) throw new Error(`第 ${i + 1} 个要素不是合法的 Feature`)
    const g = f.geometry
    if (!['Polygon', 'MultiPolygon'].includes(g.type)) {
      throw new Error(`第 ${i + 1} 个要素 geometry 仅支持 Polygon / MultiPolygon（当前 ${g.type}）`)
    }
    countPoints(g.coordinates, 0, state)
    const nm = String(f.properties?.[field] ?? f.properties?.name ?? '').trim()
    if (!nm) throw new Error(`第 ${i + 1} 个要素缺少名称字段【${field}】，可在导入时指定名称字段`)
    if (nm.length > MAX_NAME_LEN) throw new Error(`第 ${i + 1} 个要素名称过长`)
    const code = String(f.properties?.code ?? f.properties?.adcode ?? f.properties?.gridCode ?? '').slice(0, 40)
    return { type: 'Feature', properties: { name: nm, code }, geometry: { type: g.type, coordinates: g.coordinates } }
  })
  return { geojson: { type: 'FeatureCollection', features }, featureCount: features.length, pointCount: state.n, nameField: field }
}

/** 来源合规守护：拒绝明确的无资质 / 境外源，来源与审图号必填校验 */
export function assertCompliantSource({ name, source, reviewNo, crs }) {
  const s = String(source || '').trim()
  const n = String(name || '').trim()
  if (!n) throw new Error('请填写底图名称（如：兴宁区社区行政区划边界）')
  if (n.length > MAX_META_LEN) throw new Error('底图名称过长')
  if (!s) throw new Error('请填写地图数据来源（测绘成果必须可追溯）')
  if (s.length > MAX_META_LEN) throw new Error('来源说明过长')
  if (FORBIDDEN_SOURCE_RE.test(s)) {
    throw new Error('该来源属于无资质 / 境外地图数据源，按《地图管理条例》不得用于本平台；请使用自然资源部标准地图服务、天地图或属地自然资源主管部门提供的数据')
  }
  if (!CRS_OPTIONS.includes(String(crs || ''))) throw new Error(`坐标系仅支持 ${CRS_OPTIONS.join(' / ')}`)
  const rn = String(reviewNo || '').trim()
  if (rn.length > MAX_META_LEN) throw new Error('审图号过长')
  return { name: n, source: s, reviewNo: rn, crs: String(crs) }
}

/**
 * 内容级合规守护：防止把 OSM 衍生数据改个文件名、或把「数据来源」改写成合规渠道后绕过校验。
 * 检查 GeoJSON 顶层元数据与要素属性中的 OSM / Geofabrik / ODbL 特征（值或主键字段名）。
 * 合规数据中常见的 name / code / adcode / source=某自然资源局 不受影响。
 */
/**
 * 容器级合规扫描：压缩包内文件名 / README / 版权声明 / GeoPackage 图层名、
 * 字段名与属性值等任意文本。用于防止「换个容器、改个来源说明」绕过守护。
 */
export function assertCompliantText(text) {
  const s = String(text ?? '')
  if (s && FORBIDDEN_ARCHIVE_RE.test(s)) throw new Error(NONCOMPLIANT_MSG)
}

export function assertCompliantFeatureContent(raw) {
  if (!raw || typeof raw !== 'object') return
  const scanText = (v) => {
    if (typeof v === 'string' && FORBIDDEN_CONTENT_RE.test(v)) throw new Error(NONCOMPLIANT_MSG)
  }
  // 部分导出工具会把版权 / 生成器写在顶层
  for (const k of ['attribution', 'license', 'copyright', 'generator', 'source', 'note', 'description', 'name']) scanText(raw[k])
  const features = Array.isArray(raw.features) ? raw.features : []
  for (const f of features) {
    const p = f?.properties
    if (!p || typeof p !== 'object') continue
    for (const [k, v] of Object.entries(p)) {
      if (OSM_FIELD_RE.test(k)) throw new Error(NONCOMPLIANT_MSG)
      scanText(v)
    }
  }
}

export function loadBasemap() {
  try {
    if (!fs.existsSync(BASEMAP_FILE)) return { enabled: false, meta: null, geojson: null }
    return JSON.parse(fs.readFileSync(BASEMAP_FILE, 'utf8'))
  } catch (e) {
    // 文件损坏时按「无底图」回落，不能让整个地理平台打不开
    console.error('[geo-basemap] 读取失败，回落示意底图：', e.message)
    return { enabled: false, meta: null, geojson: null }
  }
}

/** 原子写入：先写临时文件再 rename，避免写入中途被读到半份 JSON */
export function saveBasemap(record) {
  fs.mkdirSync(GEO_DIR, { recursive: true })
  const tmp = `${BASEMAP_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(record), 'utf8')
  fs.renameSync(tmp, BASEMAP_FILE)
}

export function clearBasemap() {
  try { if (fs.existsSync(BASEMAP_FILE)) fs.unlinkSync(BASEMAP_FILE) } catch (e) { /* 已删除 */ }
}
