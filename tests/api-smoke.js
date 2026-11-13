/**
 * 接口冒烟回归测试（说明书第 7 章验收项 · V2.0 正式版契约）
 * 用法：先 npm start 启动服务，再 node tests/api-smoke.js
 */
import XLSX from 'xlsx'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const call = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const ct = r.headers.get('content-type') || ''
  const data = ct.includes('json') ? await r.json() : await r.arrayBuffer()
  return { status: r.status, body: data, size: data.byteLength || 0, headers: r.headers }
}
const upload = async (path, resource, aoa, token) => {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '数据')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${resource}.xlsx`)
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd
  })
  return { status: r.status, body: await r.json() }
}

;(async () => {
  console.log('\n=== 1. 服务与静态页面 ===')
  const health = await call('/api/health')
  check('健康检查', health.body.code === 0 && health.body.data.status === 'running',
    `${health.body.data.counts.grids} 网格 / ${health.body.data.counts.population} 人口 / ${health.body.data.counts.houses} 房屋`)
  check('SQLite 存储 + 安全机制就绪',
    health.body.data.storage.engine === 'SQLite' && health.body.data.security.fieldEncryption === 'AES-256-GCM',
    health.body.data.security.passwordHash)
  check('118 个网格', health.body.data.counts.grids === 118)
  check('2万+人口 / 5万+房屋', health.body.data.counts.population > 20000 && health.body.data.counts.houses > 50000)
  for (const p of ['/', '/portal', '/screen', '/geo', '/resident?grid=450102010101', '/login']) {
    const r = await fetch(BASE + p)
    check(`SPA 路由 ${p}`, r.status === 200 && (await r.text()).includes('<div id="app">'))
  }

  console.log('\n=== 2. 四级角色权限（验收项 2）===')
  const roles = {}
  let adminProfile = null
  for (const [u, p] of [['admin', 'admin123'], ['street', '123456'], ['community', '123456'], ['grid', '123456']]) {
    const r = await call('/api/auth/login', { method: 'POST', body: { username: u, password: p } })
    roles[u] = r.body.data?.token
    if (u === 'admin') adminProfile = r.body.data   // 复用本轮登录结果，避免重复登录占满限流桶
    check(`账号 ${u} 登录`, r.body.code === 0 && !!roles[u], r.body.data?.user?.orgName)
  }
  check('登录返回菜单与权限点（表驱动）', Array.isArray(adminProfile?.menus) && adminProfile.permissions.length > 10,
    `${adminProfile?.menus?.length ?? 0} 菜单 / ${adminProfile?.permissions?.length ?? 0} 权限点`)
  check('登录不下发密码字段', !('password' in (adminProfile?.user || {})))
  const counts = {}
  for (const u of Object.keys(roles)) {
    const r = await call('/api/grids?pageSize=1', { token: roles[u] })
    counts[u] = r.body.data.total
  }
  check('区级可见全部 118 网格', counts.admin === 118, `实际 ${counts.admin}`)
  check('街道数据范围收窄', counts.street > 1 && counts.street < 118, `实际 ${counts.street}`)
  check('社区数据范围继续收窄', counts.community > 1 && counts.community < counts.street, `实际 ${counts.community}`)
  check('网格员仅本网格', counts.grid === 1, `实际 ${counts.grid}`)
  const pop = await call('/api/population?pageSize=1', { token: roles.grid })
  check('人口列表默认脱敏', /\*{4}/.test(pop.body.data.records[0].idcard) && /\*{4}/.test(pop.body.data.records[0].phone))
  const noAuth = await call('/api/grids')
  check('无令牌访问被拦截 401', noAuth.status === 401)
  const noMenu = await call('/api/stats/screen', { token: roles.grid })
  check('越权访问决策大屏被拦截', noMenu.status === 403, noMenu.body.message)
  const noOps = await call('/api/stats/ops', { token: roles.street })
  check('越权访问运营中心被拦截', noOps.status === 403)
  const lastGrid = await call('/api/grids?pageSize=500', { token: roles.admin })
  const outOfScopeId = lastGrid.body.data.records[lastGrid.body.data.records.length - 1].id
  const crossDetail = await call(`/api/grids/${outOfScopeId}`, { token: roles.grid })
  check('网格员越权读取他网格详情被拦截', crossDetail.status === 404 || crossDetail.status === 403, `${outOfScopeId} → HTTP ${crossDetail.status}`)

  console.log('\n=== 3. 业务状态机与留痕（验收项 3）===')
  // 不消耗种子数据：多轮回归会把种子里的「待受理」申请逐条流转掉，
  // 耗尽后原本的 records[0] 会直接抛 TypeError。改为每轮自建一条专用记录、验证完删除，
  // 让本套件可以无限次重复执行而不依赖演示数据余量。
  const created = await call('/api/serviceRequests', {
    method: 'POST', token: roles.admin,
    body: {
      applicant: '状态机回归专用', applicantPhone: '13800000000', item: '居住证明开具',
      gridCode: '450102010101', orgCode: '450102010101', content: '自动化回归临时数据'
    }
  })
  check('自建待受理办事申请用于状态机验证',
    created.body.code === 0 && created.body.data?.status === '待受理', created.body.message)
  const sr = created.body.data
  if (!sr?.id) throw new Error('无法创建待受理办事申请，状态机验证无法继续')
  const jump = await call('/api/transition', { method: 'POST', token: roles.admin, body: { resource: 'serviceRequests', id: sr.id, to: '已办结' } })
  check('跳步流转被拦截', jump.body.code === 40901, jump.body.message)
  const normal = await call('/api/transition', { method: 'POST', token: roles.admin, body: { resource: 'serviceRequests', id: sr.id, to: '办理中', remark: '冒烟测试' } })
  check('合法流转成功', normal.body.code === 0, `${normal.body.data?.from} → ${normal.body.data?.to}`)
  const flows = await call(`/api/flows?bizId=${sr.id}`, { token: roles.admin })
  check('流转记录留痕', flows.body.data.some((f) => f.to === '办理中'))
  const pushed = await call('/api/messages?type=办事进度&pageSize=5', { token: roles.admin })
  check('办事流转自动推送进度消息', pushed.body.data.records.some((m) => m.title.includes('办理中')))
  const alarmPending = await call('/api/alarms?status=待处置&pageSize=1', { token: roles.admin })
  const a = alarmPending.body.data.records?.[0]
  // 不再静默跳过：没有可测数据时明确失败，避免「0 失败」掩盖断言未执行
  check('存在待处置告警用于跳步验证', !!a, a ? a.id : '库中没有待处置告警，请先执行 npm run reset')
  if (a) {
    const jumpA = await call('/api/transition', { method: 'POST', token: roles.admin, body: { resource: 'alarms', id: a.id, to: '已归档' } })
    check('告警跳步被拦截', jumpA.body.code === 40901)
  }

  console.log('\n=== 4. 组织/人员主数据与关联校验（验收项 4）===')
  const tree = await call('/api/orgs/tree', { token: roles.admin })
  check('四级组织树', tree.body.data.length === 1 && tree.body.data[0].children.length === 4)
  const delOrg = await call('/api/partyOrgs/PO001', { method: 'DELETE', token: roles.admin })
  check('删除含下级的党组织被拦截', delOrg.body.code === 40902, delOrg.body.message)
  const delGrid = await call('/api/grids/G0001', { method: 'DELETE', token: roles.admin })
  check('删除含人口的网格被拦截', delGrid.body.code === 40902, delGrid.body.message)

  console.log('\n=== 5. Excel 导入导出与统计 ===')
  const tpl = await call('/api/import/template?resource=partyMembers', { token: roles.admin })
  check('导入模板下载 xlsx', tpl.size > 1000, `${tpl.size} bytes`)
  const imp = await upload('/api/import/partyMembers', 'partyMembers', [
    ['姓名', '身份证号', '手机号', '所属党组织编码', '入党时间(YYYY-MM-DD)', '党员状态'],
    ['测试党员甲', '450102199001011234', '13800138000', '4501020101', '2020-01-01', '正式党员'],
    ['错误行乙', '123', 'abc', '999999', 'x', '']
  ], roles.admin)
  check('multipart 导入校验返回错误行明细',
    imp.status === 200 && imp.body.data.success === 1 && imp.body.data.failed === 1 && imp.body.data.errors[0].row === 3,
    imp.body.data.errors?.[0]?.reason)
  const impJson = await call('/api/import/partyMembers', { method: 'POST', token: roles.admin, body: { rows: [] } })
  check('旧 JSON 导入契约已停用（要求上传文件）', impJson.body.code !== 0)
  const imported = await call('/api/partyMembers?keyword=测试党员甲', { token: roles.admin })
  check('导入数据已入库且手机号脱敏', imported.body.data.total >= 1 && /\*{4}/.test(imported.body.data.records[0].phone || ''))
  const exp = await call('/api/export/partyMembers?status=正式党员', { token: roles.community })
  check('按筛选条件导出（受权限）', exp.size > 1000, `${exp.size} bytes`)
  const stats = await call('/api/stats/population', { token: roles.admin })
  check('人口七项统计', stats.body.data.seven.length === 7 && stats.body.data.total === 20860)
  const screen = await call('/api/stats/screen', { token: roles.admin })
  check('决策大屏指标', screen.body.data.totals.population === 20860 && screen.body.data.digitalParty.length === 6)
  const geo = await call('/api/stats/geo?layer=人口', { token: roles.admin })
  check('地理平台五图层数据', geo.body.data.values.length === 118)
  const buffer = await call('/api/geo/query', { method: 'POST', token: roles.admin, body: { type: 'buffer', center: [108.30, 22.80], radius: 3, layer: '人口' } })
  check('半径缓冲区分析', buffer.body.data.total > 0, `命中 ${buffer.body.data.total} 网格`)
  const score = await call('/api/geo/query', { method: 'POST', token: roles.admin, body: { type: 'score', layer: '人口', topN: 5 } })
  check('选址评分', score.body.data.items.length === 5)
  const ops = await call('/api/stats/ops', { token: roles.admin })
  check('运营中心指标', ops.body.data.contractStatus.length === 4 && ops.body.data.onlineRate > 0)

  console.log('\n=== 6. 居民端闭环（扫码→提交→后台→三要素进度）===')
  const home = await call('/api/resident/home/450102010101')
  check('便民码扫码进入居民端', home.body.code === 0 && home.body.data.grid.gridName.includes('第01网格'))
  const submit = await call('/api/resident/events', { method: 'POST', body: {
    gridCode: '450102010101', name: '冒烟测试居民', phone: '13900001234', type: '环境卫生', title: '冒烟测试事件', description: '自动化测试'
  } })
  check('居民端事件上报', submit.body.code === 0, submit.body.data?.code)
  check('提交返回一次性查询码', /^\d{6}$/.test(String(submit.body.data?.queryCode || '')))
  const inBackend = await call('/api/governanceEvents?keyword=冒烟测试事件', { token: roles.admin })
  check('后台可见居民上报事件', inBackend.body.data.total >= 1)
  const onlyPhone = await call('/api/resident/progress?phone=13900001234')
  check('仅凭手机号查询被拒绝', onlyPhone.body.code === 40003 || onlyPhone.status === 403)
  const progress = await call(`/api/resident/progress?phone=13900001234&bizCode=${submit.body.data.code}&queryCode=${submit.body.data.queryCode}`)
  check('三要素进度查询成功', progress.body.code === 0 && progress.body.data.events.length === 1 && progress.body.data.flows.length >= 1)
  const wrongCode = await call(`/api/resident/progress?phone=13900001234&bizCode=${submit.body.data.code}&queryCode=000000`)
  check('错误查询码被拒绝', wrongCode.status === 403 || wrongCode.body.code === 40304)

  // 清理本轮自建的状态机记录，避免污染演示库、累积无效数据
  if (sr?.id) await call(`/api/serviceRequests/${sr.id}`, { method: 'DELETE', token: roles.admin })

  console.log(`\n=== 结果：${pass} 项通过 / ${failCount} 项失败 ===\n`)
  process.exit(failCount ? 1 : 0)
})().catch((e) => { console.error('测试执行异常：', e); process.exit(1) })
