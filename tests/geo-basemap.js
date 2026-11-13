/**
 * 地理信息平台「离线矢量底图」回归
 *
 * 背景：原地图由组织 bounds 生成的示意矩形，非真实地理边界。
 * 新增能力：管理员从合规渠道获取该地区行政区划 GeoJSON 导入，
 * 数据落本地磁盘、由 ECharts 自绘渲染，断网可用、无任何外部地图请求。
 *
 * 断言：
 *   1) 未鉴权读取 / 非区级管理员导入被拦截；
 *   2) 默认回落示意底图，并下发合规来源选项；
 *   3) 非法 GeoJSON / 坐标越界 / 缺名称字段 / 超量要素均被拒；
 *   4) 境外或无资质来源（OpenStreetMap 等）被合规守护拒绝；
 *   5) 合规来源导入成功，meta 登记来源 / 审图号 / 坐标系 / 区域数；
 *   6) 只保留 name / code 属性，剔除其它属性（tooltip 注入收敛）；
 *   7) meta=1 轻量模式不返回整份边界；DELETE 可恢复示意底图。
 *
 * 用法：先 npm start，再 node tests/geo-basemap.js
 * 说明：测试结束会删除导入的底图，不留演示数据。
 */
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const callJson = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, code: data?.code, data: data?.data, message: data?.message }
}

const COMPLIANT_SOURCE = '自然资源部标准地图服务（bzdt.ch.mnr.gov.cn，带审图号）'
const makeGeoJSON = (names, opts = {}) => ({
  type: 'FeatureCollection',
  features: names.map((nm, i) => ({
    type: 'Feature',
    properties: { name: nm, code: 'G' + i, ...(opts.extraProps || {}) },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [108.30 + i * 0.02, 22.80], [108.31 + i * 0.02, 22.80],
        [108.31 + i * 0.02, 22.81], [108.30 + i * 0.02, 22.81],
        [108.30 + i * 0.02, 22.80]
      ]]
    }
  }))
})
const importBasemap = async (token, geojson, fields = {}) => {
  const fd = new FormData()
  const all = {
    name: '兴宁区社区行政区划边界（测试）', source: COMPLIANT_SOURCE,
    reviewNo: 'GS(2024)0000号', crs: 'GCJ-02', nameField: 'name', ...fields
  }
  for (const [k, v] of Object.entries(all)) fd.append(k, String(v))
  fd.append('file', new Blob([JSON.stringify(geojson)], { type: 'application/geo+json' }), 'boundary.geojson')
  const r = await fetch(`${BASE}/api/geo/basemap/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, code: data?.code, data: data?.data, message: data?.message }
}

const main = async () => {
  const token = await login('admin', 'admin123')
  const street = await login('street', '123456')
  console.log('\n=== 地理信息平台：离线矢量底图回归 ===')

  // 前置清理：保证从「未导入」状态开始
  await callJson('/api/geo/basemap', { method: 'DELETE', token })

  // 1) 未鉴权读取 → 401
  const noAuth = await callJson('/api/geo/basemap')
  check('未鉴权读取底图被拦截（401）', noAuth.status === 401, `status=${noAuth.status}`)

  // 2) 默认回落示意底图 + 下发合规渠道
  const init = await callJson('/api/geo/basemap', { token })
  check('默认未启用真实底图（回落示意）', init.data?.enabled === false && init.data?.geojson === null)
  check('下发合规获取渠道选项', Array.isArray(init.data?.options?.sources) && init.data.options.sources.length >= 3,
    `${init.data?.options?.sources?.length} 项`)
  check('下发坐标系选项', (init.data?.options?.crsOptions || []).includes('GCJ-02'))

  // 3) 有 geo 权限但非区级管理员 → 403
  const denied = await importBasemap(street, makeGeoJSON(['网格A']))
  check('街道管理员导入被拒（仅区级可维护，403）', denied.status === 403, `status=${denied.status}`)

  // 4) 结构 / 坐标 / 名称 / 体量校验
  const badType = await importBasemap(token, { type: 'Point', coordinates: [108.3, 22.8] })
  check('非 FeatureCollection 被拒（400）', badType.status === 200 && badType.code === 40002, badType.message)

  const badCoord = await importBasemap(token, {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { name: '越界' },
      geometry: { type: 'Polygon', coordinates: [[[999, 999], [999, 1000], [1000, 1000], [999, 999]]] } }]
  })
  check('坐标超出经纬度范围被拒', badCoord.status === 200 && badCoord.code === 40002, badCoord.message)

  const noName = await importBasemap(token, {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { code: 'X' },
      geometry: { type: 'Polygon', coordinates: [[[108.3, 22.8], [108.31, 22.8], [108.31, 22.81], [108.3, 22.8]]] } }]
  })
  check('要素缺少名称字段被拒', noName.status === 200 && noName.code === 40002, noName.message)

  // 5) 合规来源守护：境外 / 无资质来源
  const osm = await importBasemap(token, makeGeoJSON(['网格A']), { source: 'OpenStreetMap 下载的 OSM 边界' })
  check('境外无资质来源被合规守护拒绝', osm.status === 200 && osm.code === 40002 && /无资质|境外|管理条例/.test(osm.message || ''), osm.message)

  // 5.1) 防绕过：Geofabrik / ODbL 来源关键词 + 文件内容特征守护
  const geofabrikSource = await importBasemap(token, makeGeoJSON(['网格A']), { source: 'Geofabrik 广西矢量数据包' })
  check('Geofabrik OSM 衍生包来源被拒', geofabrikSource.status === 200 && geofabrikSource.code === 40002, geofabrikSource.message)

  const odblSource = await importBasemap(token, makeGeoJSON(['网格A']), { source: '某下载站，ODbL 授权数据' })
  check('ODbL 授权来源被拒', odblSource.status === 200 && odblSource.code === 40002, odblSource.message)

  const osmProps = await importBasemap(token, makeGeoJSON(['网格A'], {
    extraProps: { osm_id: 'relation/123', osm_type: 'relation' }
  }))
  check('来源改写为合规渠道、要素带 osm_id 仍被内容守护拒绝',
    osmProps.status === 200 && osmProps.code === 40002 && /境外|无资质|特征|管理条例/.test(osmProps.message || ''), osmProps.message)

  const osmLicense = await importBasemap(token, {
    ...makeGeoJSON(['网格A']),
    license: 'Open Database License (ODbL) 1.0', generator: 'Geofabrik osmium export'
  })
  check('顶层 ODbL / Geofabrik 版权声明被内容守护拒绝',
    osmLicense.status === 200 && osmLicense.code === 40002 && /境外|无资质|特征|管理条例/.test(osmLicense.message || ''), osmLicense.message)

  const benign = await importBasemap(token, makeGeoJSON(['网格A'], {
    extraProps: { source: '南宁市自然资源局提供', license: '政务数据授权使用' }
  }))
  check('合规数据的普通来源说明字段不被误伤', benign.status === 200 && benign.code === 0, benign.message)
  await callJson('/api/geo/basemap', { method: 'DELETE', token })

  // 5.2) 损坏的 zip 容器被结构校验拒绝（V2.7 起 zip / gpkg 为合法容器，见 test:geoimport）
  const fdZip = new FormData()
  fdZip.append('name', '广西地图'); fdZip.append('source', COMPLIANT_SOURCE)
  fdZip.append('crs', 'GCJ-02'); fdZip.append('nameField', 'name')
  fdZip.append('file', new Blob(['PK-fake-zip'], { type: 'application/zip' }), 'broken.gpkg.zip')
  const zipResp = await fetch(`${BASE}/api/geo/basemap/import`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fdZip
  })
  let zipData = null
  try { zipData = await zipResp.json() } catch {}
  check('损坏的 zip 容器被结构校验拒绝（40002）',
    zipResp.status === 200 && zipData?.code === 40002, `${zipResp.status} ${zipData?.message || ''}`)

  // 6) 合规导入成功
  const stats = await callJson('/api/stats/geo?layer=人口', { token })
  const names = (stats.data?.values || []).slice(0, 2).map((v) => v.name)
  const goodNames = names.length >= 2 ? names : ['民生社区第01网格', '民生社区第02网格']
  const okImport = await importBasemap(token, makeGeoJSON(goodNames, { extraProps: { evil: '<script>alert(1)</script>' } }))
  check('合规来源导入成功', okImport.status === 200 && okImport.code === 0, okImport.message)
  check('meta 登记来源 / 审图号 / 坐标系',
    okImport.data?.source === COMPLIANT_SOURCE && okImport.data?.reviewNo === 'GS(2024)0000号' && okImport.data?.crs === 'GCJ-02')
  check('meta 登记区域数', okImport.data?.featureCount === 2, `${okImport.data?.featureCount} 个`)

  // 7) 全量读取 + 属性剥离
  const full = await callJson('/api/geo/basemap', { token })
  check('读取后 enabled=true 且返回完整边界',
    full.data?.enabled === true && full.data?.geojson?.features?.length === 2)
  const props = full.data?.geojson?.features?.[0]?.properties || {}
  check('仅保留 name / code，剔除其它属性', !('evil' in props) && 'name' in props, JSON.stringify(props))
  check('要素名称与业务网格同名（可归一化着色）', goodNames.includes(props.name), props.name)

  // 8) meta=1 轻量模式
  const light = await callJson('/api/geo/basemap?meta=1', { token })
  check('meta=1 不返回整份边界', light.data?.geojson === null && light.data?.meta?.importedAt)

  // 9) 删除恢复
  const removed = await callJson('/api/geo/basemap', { method: 'DELETE', token })
  check('删除底图成功', removed.status === 200 && removed.code === 0)
  const after = await callJson('/api/geo/basemap', { token })
  check('删除后回落示意底图', after.data?.enabled === false && after.data?.geojson === null)

  console.log(`\n结果：${pass} 通过 / ${failCount} 失败`)
  process.exit(failCount ? 1 : 0)
}
main().catch((e) => {
  console.error('测试异常', e)
  // 异常也要清理底图，避免污染演示库
  login('admin', 'admin123').then((t) => fetch(`${BASE}/api/geo/basemap`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } }))
    .catch(() => {}).finally(() => process.exit(1))
})
