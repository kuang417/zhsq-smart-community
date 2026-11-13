/**
 * V2.6 · 第三轮深度代码审计专项回归
 *
 * 本轮按「真实请求复现 → 修复 → 固化为断言」执行，覆盖：
 *  A. 自然主键资源（orgs）新增后无法按声明主键读 / 改 / 删；grids 业务编码可改导致关联断裂（严重）
 *  B. 人口 Excel 导入写成党员字段结构、归属编码按组织表校验（严重，业务数据污染）
 *  C. 状态机 remark / 回退原因无长度与内容校验（严重，脏数据 + 存储型注入面）
 *  D. 居民端进度留痕泄露内部办理意见、消息接口不校验网格且返回后台字段（严重，隐私）
 *  E. 全局检索 limit 可绕过（LIMIT -1 拖库）、二次验密无限流（中）
 *  F. 组织 / 网格编码可写不存在的孤儿值、空间查询参数不校验且全表扫描（中）
 *  G. 前端演示编码兜底、字段级校验口径、加载错误 UI（中/轻）
 *
 * 用法：先 npm start，再 node tests/v26-audit.js
 * 所有临时业务记录通过 API 删除；留痕 / 查询凭条直连 SQLite 清理。
 * 注意：最后一组会真实触发二次验密失败锁定（60s 窗口），故置于末尾。
 */
import fs from 'node:fs'
import XLSX from 'xlsx'
import Database from 'better-sqlite3'
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const DB_PATH = process.env.ZHSQ_DB_FILE || 'server/data/zhsq.db'
const TAG = 'V26审计临时'
const REAL_GRID = '450102010101'
const REAL_ORG = '450102010101'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const read = (p) => { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }
const call = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  let json = null
  try { json = await r.json() } catch { /* 二进制响应 */ }
  return { status: r.status, code: json?.code, data: json?.data, message: json?.message, size: r.headers.get('content-length') }
}
const upload = async (resource, rows, token) => {
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '数据')
  const fd = new FormData()
  fd.append('file', new Blob([XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })]), 'v26.xlsx')
  const r = await fetch(`${BASE}/api/import/${resource}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd
  })
  return r.json()
}
const stamp = () => {
  const p = (n) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const cleanupIds = []
const cleanupBiz = []

async function run() {
  const admin = await login('admin', 'admin123')
  console.log('\n=== A. 自然主键与业务编码一致性 ===')
  const orgCode = '4501020297'
  const o1 = await call('/api/orgs', { method: 'POST', token: admin, body: {
    orgName: `${TAG}组织`, orgCode, orgLevel: 4, parentCode: '45010202', levelName: '社区'
  } })
  check('新增组织成功', o1.code === 0, o1.message)
  check('新增组织不再写入合成 id（与种子结构一致）', o1.data && !('id' in o1.data), JSON.stringify(o1.data || {}).slice(0, 120))
  const o2 = await call(`/api/orgs/${orgCode}`, { token: admin })
  check('按配置声明的主键 orgCode 可读', o2.code === 0 && o2.data?.orgCode === orgCode, `code=${o2.code}`)
  const o3 = await call(`/api/orgs/${orgCode}`, { method: 'PUT', token: admin, body: {
    ...o2.data, orgName: `${TAG}组织改`
  } })
  check('按 orgCode 可编辑', o3.code === 0 && o3.data?.orgName === `${TAG}组织改`, o3.message)
  const o4 = await call(`/api/orgs/${orgCode}`, { method: 'DELETE', token: admin })
  check('按 orgCode 可删除', o4.code === 0, o4.message)
  check('删除后不可再读', (await call(`/api/orgs/${orgCode}`, { token: admin })).status === 404)
  const dup = await call('/api/orgs', { method: 'POST', token: admin, body: {
    orgName: `${TAG}重复`, orgCode: '45010201', orgLevel: 2, parentCode: '450102'
  } })
  check('重复组织编码被明确拒绝', dup.code === 40002 && /已存在/.test(dup.message || ''))

  const gridCode = '450102029701'
  const g1 = await call('/api/grids', { method: 'POST', token: admin, body: {
    gridName: `${TAG}网格`, gridCode, orgCode: '45010202', lng: 108.3, lat: 22.8
  } })
  check('新增网格成功且主键为 id', g1.code === 0 && /^GR/.test(String(g1.data?.id || '')), g1.message)
  const gridId = g1.data?.id
  if (gridId) {
    const g2 = await call(`/api/grids/${gridId}`, { token: admin })
    check('新增网格按其主键可读', g2.code === 0 && g2.data?.gridCode === gridCode)
    const g3 = await call(`/api/grids/${gridId}`, { method: 'PUT', token: admin, body: {
      ...g2.data, gridCode: '450102029799'
    } })
    check('改网格编码被拦截（人口/房屋/便民码关联键）', g3.code === 40305, g3.message)
    const g4 = await call(`/api/grids/${gridId}`, { method: 'PUT', token: admin, body: {
      ...g2.data, gridName: `${TAG}网格改`
    } })
    check('网格改名称正常', g4.code === 0, g4.message)
    check('删除网格成功', (await call(`/api/grids/${gridId}`, { method: 'DELETE', token: admin })).code === 0)
  } else {
    check('新增网格按其主键可读', false, '未拿到 id')
    check('改网格编码被拦截（人口/房屋/便民码关联键）', false, '未拿到 id')
    check('网格改名称正常', false, '未拿到 id')
    check('删除网格成功', false, '未拿到 id')
  }
  const dupGrid = await call('/api/grids', { method: 'POST', token: admin, body: {
    gridName: `${TAG}重复网格`, gridCode: REAL_GRID, orgCode: '450102010101'
  } })
  check('重复网格编码被明确拒绝', dupGrid.code === 40002 && /已存在/.test(dupGrid.message || ''))

  console.log('\n=== B. Excel 导入按资源构造记录 ===')
  const popName = `${TAG}人口`
  const impPop = await upload('population', [{
    '姓名': popName, '身份证号': '450102199001011241', '手机号': '13900139011',
    '人口类型': '户籍', '年龄': '36', '性别': '女', '网格编码': REAL_GRID,
    '特殊群体标签': '', '住址': 'V26审计路1号'
  }], admin)
  check('人口导入成功', impPop.code === 0 && impPop.data?.success === 1, JSON.stringify(impPop.data?.errors || []))
  const popRow = (await call(`/api/population?keyword=${encodeURIComponent(popName)}`, { token: admin })).data?.records?.[0]
  check('人口记录不含党员字段', !!popRow && !['status', 'joinDate', 'education', 'volunteerHours', 'orgId'].some((k) => k in popRow), JSON.stringify(popRow || {}).slice(0, 160))
  check('人口记录含人口业务字段', !!popRow && popRow.gridCode === REAL_GRID && popRow.address === 'V26审计路1号' && popRow.age === 36)
  if (popRow?.id) cleanupIds.push(popRow.id)
  const impBadGrid = await upload('population', [{
    '姓名': `${TAG}坏网格`, '身份证号': '450102199001011242', '手机号': '', '人口类型': '户籍',
    '年龄': '30', '性别': '男', '网格编码': '999999999999', '特殊群体标签': '', '住址': ''
  }], admin)
  check('人口导入校验网格编码真实存在', impBadGrid.data?.failed === 1 && /网格编码/.test(impBadGrid.data?.errors?.[0]?.reason || ''))
  const impPm = await upload('partyMembers', [{
    '姓名': `${TAG}党员`, '身份证号': '450102199001011243', '手机号': '13900139012',
    '所属党组织编码': '4501020101', '入党时间(YYYY-MM-DD)': '2020-01-01', '党员状态': '正式党员'
  }], admin)
  check('党员导入仍成功', impPm.code === 0 && impPm.data?.success === 1, JSON.stringify(impPm.data?.errors || []))
  const pmRow = (await call(`/api/partyMembers?keyword=${encodeURIComponent(TAG + '党员')}`, { token: admin })).data?.records?.[0]
  check('党员记录保留党员业务字段', !!pmRow && 'joinDate' in pmRow && 'status' in pmRow && !('address' in pmRow))
  if (pmRow?.id) cleanupIds.push(pmRow.id)
  const impHtml = await upload('partyMembers', [{
    '姓名': `${TAG}注入`, '身份证号': '450102199001011244', '手机号': '',
    '所属党组织编码': '4501020101', '入党时间(YYYY-MM-DD)': '', '党员状态': '<img src=x onerror=alert(1)>'
  }], admin)
  check('导入内容拒绝 HTML 标记字符', impHtml.data?.failed === 1 && /标记字符/.test(impHtml.data?.errors?.[0]?.reason || ''))

  console.log('\n=== C. 状态机文本边界 ===')
  const mkRequest = async (suffix) => {
    const r = await call('/api/serviceRequests', { method: 'POST', token: admin, body: {
      code: `${TAG}${Date.now().toString(36)}${suffix}`, applicant: TAG, applicantPhone: '13800138000',
      item: '居住证明开具', orgCode: REAL_ORG, gridCode: REAL_GRID, submitTime: stamp(), content: TAG
    } })
    if (r.data?.id) { cleanupIds.push(r.data.id); cleanupBiz.push(r.data.id) }
    return r.data?.id
  }
  const r1 = await mkRequest('A')
  check('构造初始状态业务记录', !!r1)
  const huge = '<img src=x onerror=alert(1)>'.repeat(400)
  const t1 = await call('/api/transition', { method: 'POST', token: admin, body: {
    resource: 'serviceRequests', id: r1, to: '办理中', remark: huge
  } })
  check('超长且含标记的办理意见被拒', t1.code === 40002 && /上限|标记/.test(t1.message || ''), t1.message)
  const t2 = await call('/api/transition', { method: 'POST', token: admin, body: {
    resource: 'serviceRequests', id: r1, to: '办理中', remark: { evil: true }
  } })
  check('非字符串办理意见被拒', t2.code === 40002)
  const t3 = await call('/api/transition', { method: 'POST', token: admin, body: {
    resource: 'serviceRequests', id: r1, to: '办理中', remark: `${TAG}正常办理意见`
  } })
  check('正常办理意见可流转且留痕', t3.code === 0 && t3.data?.to === '办理中', t3.message)
  const t4 = await call('/api/transition/return', { method: 'POST', token: admin, body: {
    resource: 'serviceRequests', id: r1, reason: '退回'.repeat(300)
  } })
  check('超长退回原因被拒', t4.code === 40002)
  const t5 = await call('/api/transition/revoke', { method: 'POST', token: admin, body: {
    resource: 'serviceRequests', id: r1, reason: '<script>alert(1)</script>'
  } })
  check('含标记的撤回说明被拒', t5.code === 40002)
  const r2 = await mkRequest('B')
  const r3 = await mkRequest('C')
  const batch = await call('/api/transition/batch', { method: 'POST', token: admin, body: {
    resource: 'serviceRequests', ids: [r2, r3], to: '__next__', remark: huge
  } })
  check('批量流转逐条拒绝脏 remark', batch.code === 0 && batch.data?.success === 0 && batch.data?.failed === 2,
    JSON.stringify(batch.data?.errors || []).slice(0, 160))
  const flowLogs = await call(`/api/flows?bizId=${r1}`, { token: admin })
  check('被拒的脏 opinion 未落库', Array.isArray(flowLogs.data) && !flowLogs.data.some((f) => String(f.remark || '').includes('onerror')))

  console.log('\n=== D. 居民端隐私边界 ===')
  const rmBad = await call('/api/resident/messages/NOT_A_REAL_GRID')
  check('居民端消息校验网格存在', rmBad.code === 40400, rmBad.message)
  const rm = await call(`/api/resident/messages/${REAL_GRID}`)
  check('居民端消息字段白名单', Array.isArray(rm.data) && rm.data.every((m) =>
    !['orgCode', 'readCount', 'status', 'gridCode', 'version'].some((k) => k in m)), JSON.stringify(rm.data?.[0] || {}).slice(0, 160))
  check('居民端不返回含内部意见的进度类消息', Array.isArray(rm.data) && rm.data.every((m) => !/进度|办理|派发|处置|核查/.test(String(m.type || ''))))
  const rh = await call(`/api/resident/home/${REAL_GRID}`)
  check('居民端首页消息字段收窄', Array.isArray(rh.data?.messages) && rh.data.messages.every((m) => !('orgCode' in m)))
  check('居民端首页资讯字段收窄', Array.isArray(rh.data?.contents) && rh.data.contents.every((c) => !('orgCode' in c) && !('version' in c)))
  const dicts = (await call('/api/dicts', { token: admin })).data
  const sub = await call('/api/resident/requests', { method: 'POST', body: {
    gridCode: REAL_GRID, name: `${TAG}居民`, phone: '13700137011',
    item: dicts?.serviceItems?.[0], description: TAG
  } })
  check('居民端提交成功（字典选项）', sub.code === 0 && !!sub.data?.queryCode, sub.message)
  if (sub.data?.id) { cleanupIds.push(sub.data.id); cleanupBiz.push(sub.data.id) }
  const INTERNAL = `${TAG}内部核查：材料存疑，请勿对外`
  if (sub.data?.id) {
    await call('/api/transition', { method: 'POST', token: admin, body: {
      resource: 'serviceRequests', id: sub.data.id, to: '办理中', remark: INTERNAL
    } })
    const pg = await call(`/api/resident/progress?phone=13700137011&bizCode=${encodeURIComponent(sub.data.code)}&queryCode=${sub.data.queryCode}`)
    check('进度查询不外泄内部办理意见', pg.code === 0 && (pg.data?.flows || []).every((f) => !String(f.remark || '').includes('内部核查')))
    check('进度查询业务字段仍为白名单', !('handler' in (pg.data?.requests?.[0] || {})) && !('orgCode' in (pg.data?.requests?.[0] || {})))
    check('进度留痕操作人仍脱敏', (pg.data?.flows || []).every((f) => f.operator === '工作人员'))
  } else {
    check('进度查询不外泄内部办理意见', false, '提交失败')
    check('进度查询业务字段仍为白名单', false, '提交失败')
    check('进度留痕操作人仍脱敏', false, '提交失败')
  }

  console.log('\n=== E. 检索上限与编码引用完整性 ===')
  const s1 = await call('/api/search?q=%E7%BD%91%E6%A0%BC&limit=-1', { token: admin })
  check('检索 limit=-1 不再拖全库', s1.code === 0 && (s1.data?.items?.length || 0) <= 200 && s1.data?.limit <= 200,
    `items=${s1.data?.items?.length}`)
  const s2 = await call('/api/search?q=%E7%BD%91%E6%A0%BC&limit=99999', { token: admin })
  check('检索 limit 上限夹取到 200', (s2.data?.items?.length || 0) <= 200 && s2.data?.limit === 200)
  const s3 = await call(`/api/search?q=${encodeURIComponent('网'.repeat(200))}`, { token: admin })
  check('超长检索关键字被拒', s3.code === 40002)
  const bad1 = await call('/api/devices', { method: 'POST', token: admin, body: {
    name: `${TAG}孤儿设备`, code: `${TAG}ORPHAN`, orgCode: '450102999999'
  } })
  check('新增拒绝不存在的组织编码', bad1.code === 40002 && /不存在/.test(bad1.message || ''), bad1.message)
  const bad2 = await call('/api/devices', { method: 'POST', token: admin, body: {
    name: `${TAG}非法编码`, code: `${TAG}BAD`, orgCode: '<script>'
  } })
  check('新增拒绝非数字组织编码', bad2.code === 40002)
  const dev0 = (await call('/api/devices?pageSize=1', { token: admin })).data?.records?.[0]
  if (dev0?.id) {
    const bad3 = await call(`/api/devices/${dev0.id}`, { method: 'PUT', token: admin, body: {
      ...dev0, orgCode: '450102888888'
    } })
    check('编辑拒绝不存在的组织编码', bad3.code === 40002 && /不存在/.test(bad3.message || ''))
  } else check('编辑拒绝不存在的组织编码', false, '未取到设备')

  console.log('\n=== F. 空间查询参数与性能 ===')
  const geo1 = await call('/api/geo/query', { method: 'POST', token: admin, body: {
    type: 'buffer', center: [108.3, 22.8], radius: -999
  } })
  check('负半径缓冲区被拒', geo1.code === 40002, geo1.message)
  const geo2 = await call('/api/geo/query', { method: 'POST', token: admin, body: {
    type: 'box', bounds: 'bad'
  } })
  check('非法框选范围被拒', geo2.code === 40002)
  const geo3 = await call('/api/geo/query', { method: 'POST', token: admin, body: { type: 'unknown' } })
  check('非法查询类型被拒', geo3.code === 40002)
  const geo4 = await call('/api/geo/query', { method: 'POST', token: admin, body: {
    type: 'score', layer: '<script>'
  } })
  check('非法图层被拒', geo4.code === 40002)
  const t0 = Date.now()
  const geo5 = await call('/api/geo/query', { method: 'POST', token: admin, body: {
    type: 'score', layer: '人口', topN: 6
  } })
  const ms = Date.now() - t0
  check('合法选址评分正常返回（预聚合后无全表扫描）', geo5.code === 0 && geo5.data?.total > 0 && geo5.data?.items?.length === 6 && ms < 1500, `${ms}ms`)

  console.log('\n=== G. 前端 / 部署静态断言 ===')
  const demoFiles = ['web/src/views/Resident.vue', 'web/src/layouts/MainLayout.vue',
    'web/src/views/service/ServiceRequest.vue', 'web/src/views/service/GovernanceEvent.vue']
  check('四处居民端入口已移除演示网格编码兜底', demoFiles.every((f) => !read(f).includes('450102010101')))
  check('居民端预览改由带鉴权的网格台账解析', read('web/src/utils/grid.js').includes('api.gridOptions')
    && read('web/src/layouts/MainLayout.vue').includes('openResidentPreview'))
  check('居民端无编码时给出明确空态', read('web/src/views/Resident.vue').includes('缺少网格编码'))
  check('大屏根组织编码 / 名称不再写死', !read('web/src/views/Screen.vue').includes("focus = ref('450102')")
    && !read('web/src/views/Screen.vue').includes("'兴宁区'"))
  check('大屏首屏加载失败有错误 UI', read('web/src/views/Screen.vue').includes('loadError'))
  check('办事 / 治理页统计失败有重试 UI', ['web/src/views/service/ServiceRequest.vue', 'web/src/views/service/GovernanceEvent.vue']
    .every((f) => read(f).includes('statsError') && read(f).includes('重新加载')))
  check('办理事项 / 事件类型改由服务端字典下发', ['web/src/views/service/ServiceRequest.vue', 'web/src/views/service/GovernanceEvent.vue']
    .every((f) => read(f).includes('api.dicts()')))
  const crud = read('web/src/components/CrudTable.vue')
  check('表单字段级格式校验与服务端同口径', crud.includes('FIELD_PATTERNS') && crud.includes('validator'))
  check('脱敏副本不重复校验', crud.includes("v.includes('*')"))
  check('组织 / 网格编码录入改为台账下拉且保留新建例外', crud.includes('orgRefOptions') && crud.includes('creatingKeys'))
  check('办理意见输入限制 500 字', (crud.match(/maxlength="500"/g) || []).length >= 2)
  check('导入错误提示改用 bizMessage', crud.includes('err?.bizMessage'))
  const idx = read('server/index.js')
  check('服务端具备 remark / 编码 / 居民端投影 / 验密限流守卫',
    ['validateRemark', 'validateOrgRefs', 'publicFlowRemark', 'sensitiveFails', 'publicMessage'].every((k) => idx.includes(k)))
  check('导入按资源分别构造记录', idx.includes('const isPopulation = resource ===') && idx.includes('if (isPopulation)'))
  check('存储层按 primary 读写自然键资源', read('server/store.js').includes('primaryOf'))
  check('统计层预聚合替代逐网格全表过滤', read('server/stats.js').includes('const countBy'))
  check('版本号统一 V2.6', read('web/src/utils/app.js').includes("APP_VERSION = 'V2.6'")
    && read('package.json').includes('"version": "2.6.0"')
    && read('docker-compose.yml').includes('zhsq-smart-community:2.6.0')
    && idx.includes("version: 'V2.6'"))

  console.log('\n=== H. 二次验密失败锁定（置于末尾，锁定窗口 60s） ===')
  const grantOk = await call('/api/auth/sensitive-grant', { method: 'POST', token: admin, body: { password: 'admin123' } })
  check('正确密码可换取明文授权', grantOk.code === 0 && !!grantOk.data?.sensitiveToken)
  const wrongCodes = []
  for (let i = 0; i < 8; i++) {
    wrongCodes.push((await call('/api/auth/sensitive-grant', { method: 'POST', token: admin, body: { password: 'wrong' + i } })).code)
  }
  check('连续错误均返回业务校验失败', wrongCodes.every((c) => c === 40002), wrongCodes.join(','))
  const blocked = await call('/api/auth/sensitive-grant', { method: 'POST', token: admin, body: { password: 'admin123' } })
  check('超过失败阈值后二次验密被锁定', blocked.status === 429 && blocked.code === 42901, `${blocked.status}/${blocked.code}`)

  /* ---------- 清理 ---------- */
  try {
    const db = new Database(DB_PATH)
    for (const bid of cleanupBiz.filter(Boolean)) {
      db.prepare('DELETE FROM t_flowLogs WHERE id IN (SELECT id FROM t_flowLogs WHERE json_extract(data, ?) = ?)').run('$.bizId', bid)
      db.prepare('DELETE FROM resident_query WHERE biz_id = ?').run(bid)
    }
    db.close()
  } catch (e) { console.log('  ⚠️ 临时留痕清理失败：' + e.message) }
  for (const rid of cleanupIds.filter(Boolean)) {
    for (const res of ['serviceRequests', 'population', 'partyMembers', 'grids', 'devices']) {
      await call(`/api/${res}/${rid}`, { method: 'DELETE', token: admin }).catch(() => {})
    }
  }

  console.log(`\n=== 结果：${pass} 项通过 / ${failCount} 项失败 ===\n`)
  if (failCount) process.exit(1)
}

run().catch((e) => { console.error('测试执行异常：', e); process.exit(1) })
