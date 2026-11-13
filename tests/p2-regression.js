/**
 * V2.4 · P2 批次 A 专项回归
 *
 * 覆盖：
 *  1) SSE 实时通道的鉴权、连接、最小负载、按数据范围/资源模块投递、登出关闭；
 *  2) 待办 SLA 超期口径、仅看超期筛选、新记录不误判超期（验证本地时间修复）；
 *  3) 状态机撤回 / 退回的成功路径与全部拒绝路径（时限、本人、角色、原因、终态、留痕）；
 *  4) 服务端资源元数据的按角色授权与不泄露敏感值。
 *
 * 用法：先 npm start，再 node tests/p2-regression.js
 * 临时业务记录全部通过 API 删除；临时流转留痕按 bizId 直连 SQLite 清理（与 p0-regression 同策略）。
 */
import Database from 'better-sqlite3'
import { login, loginFresh, freshSession } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const DB_PATH = process.env.ZHSQ_DB_FILE || 'server/data/zhsq.db'
const TAG = 'P2回归临时'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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
  return { status: r.status, code: json?.code, data: json?.data, message: json?.message, headers: r.headers }
}
const localStamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const createRequest = (token, extra = {}) => call('/api/serviceRequests', {
  method: 'POST', token,
  body: {
    code: `${TAG}${Date.now().toString(36)}`, applicant: TAG, item: '时限测试',
    status: '待受理', orgCode: '450102010101', gridCode: '450102010101',
    submitTime: localStamp(), handler: '', opinion: '', content: TAG, ...extra
  }
})

/** 打开一个 SSE 订阅并持续解析帧；返回帧数组、等待器与关闭函数 */
async function openSse(token) {
  const ctrl = new AbortController()
  const res = await fetch(`${BASE}/api/events`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: ctrl.signal
  })
  const frames = []
  const state = { alive: true }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  ;(async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) { state.alive = false; break }
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i)
        buf = buf.slice(i + 2)
        if (frame.includes('event: ready')) frames.push({ type: 'ready' })
        const m = frame.match(/event: change[\s\S]*?data: (.+)/)
        if (m) { try { frames.push({ type: 'change', data: JSON.parse(m[1]) }) } catch (e) { /* 忽略畸形帧 */ } }
      }
    }
  })().catch(() => {})
  return {
    res, frames, state,
    close: () => ctrl.abort(),
    waitFor: async (pred, ms = 3500) => {
      const end = Date.now() + ms
      while (Date.now() < end) {
        const hit = frames.find(pred)
        if (hit) return hit
        await sleep(80)
      }
      return null
    }
  }
}

;(async () => {
  const adminSession = await loginFresh('admin', 'admin123')
  const admin = adminSession.token
  const street = await login('street', '123456')
  const grid = await login('grid', '123456')
  const adminUser = (await call('/api/auth/profile', { token: admin })).data?.user
  const gridUser = (await call('/api/auth/profile', { token: grid })).data?.user
  check('三个角色登录成功', !!admin && !!street && !!grid)

  const created = []          // 业务主记录 id
  const createdResources = [] // {resource,id}
  const tempMessages = []     // 退回产生的进度消息 id

  console.log('\n=== 1. SSE 实时通道 ===')
  const noAuth = await fetch(`${BASE}/api/events`)
  check('实时通道未带令牌被拒', noAuth.status === 401, `HTTP ${noAuth.status}`)
  const noAuthStats = await call('/api/meta/live')
  check('通道诊断接口同样需要鉴权', noAuthStats.status === 401)
  const stats0 = (await call('/api/meta/live', { token: admin })).data
  check('通道诊断返回连接上限与心跳配置', stats0?.maxTotal === 200 && stats0?.maxPerUser === 3 && stats0?.heartbeatSeconds === 25)

  const adminSse = await openSse(admin)
  check('已鉴权订阅返回 SSE 流', adminSse.res.status === 200 && /text\/event-stream/.test(adminSse.res.headers.get('content-type') || ''),
    adminSse.res.headers.get('content-type'))
  check('Nginx 反代禁用缓冲头已设置', adminSse.res.headers.get('x-accel-buffering') === 'no')
  const ready = await adminSse.waitFor((f) => f.type === 'ready', 1500)
  check('连接建立后收到 ready 帧', !!ready, ready ? '含心跳与最大生命周期配置' : '1.5s 内未收到')
  const stats1 = (await call('/api/meta/live', { token: admin })).data
  check('连接计数随之增加', stats1?.connections >= stats0?.connections + 1, `${stats0?.connections} → ${stats1?.connections}`)

  const msg = await call('/api/messages', {
    method: 'POST', token: admin,
    body: { title: `${TAG}消息`, orgCode: '450102010101', gridCode: '450102010101', status: '已发布', content: TAG }
  })
  createdResources.push({ resource: 'messages', id: msg.data?.id })
  const evt = await adminSse.waitFor((f) => f.type === 'change' && f.data?.resource === 'messages' && f.data?.ids?.includes(msg.data?.id))
  check('写操作事务成功后立即收到变化信号', !!evt, evt?.data?.action)
  const payload = JSON.stringify(evt?.data || {})
  check('推送只含最小信号，不含姓名/手机/身份证等字段',
    !!evt && !/applicantPhone|idcard|"phone"|"name"|135\*\*\*/.test(payload), payload.slice(0, 160))
  check('推送带主题与序号，可用于前端节流刷新', !!evt && Array.isArray(evt.data.topics) && evt.data.topics.includes('messages') && evt.data.seq > 0)

  /* 按数据范围 / 资源模块过滤：网格员不应收到其它网格或运营中心资源的信号 */
  const gridSse = await openSse(grid)
  await sleep(200)
  const outside = await call('/api/messages', {
    method: 'POST', token: admin,
    body: { title: `${TAG}外网格消息`, orgCode: '450102030103', gridCode: '450102030103', status: '已发布' }
  })
  createdResources.push({ resource: 'messages', id: outside.data?.id })
  await sleep(600)
  check('网格员不收到其它网格的变更信号',
    !gridSse.frames.some((f) => f.type === 'change' && f.data?.ids?.includes(outside.data?.id)),
    `grid=${gridUser?.orgCode}`)

  const contract = await call('/api/contracts', {
    method: 'POST', token: admin,
    body: { code: `${TAG}CONTRACT`, party: TAG, orgCode: '450102010101', status: '生效中' }
  })
  createdResources.push({ resource: 'contracts', id: contract.data?.id })
  await sleep(600)
  check('网格员不收到运营中心（无权资源）的变更信号',
    !gridSse.frames.some((f) => f.type === 'change' && f.data?.resource === 'contracts'))

  const inScope = await call('/api/messages', {
    method: 'POST', token: admin,
    body: { title: `${TAG}本网格消息`, orgCode: gridUser?.orgCode || '450102010101', gridCode: gridUser?.orgCode || '450102010101', status: '已发布' }
  })
  createdResources.push({ resource: 'messages', id: inScope.data?.id })
  const gridEvt = await gridSse.waitFor((f) => f.type === 'change' && f.data?.ids?.includes(inScope.data?.id))
  check('网格员能收到本网格内的变更信号', !!gridEvt, gridEvt?.data?.action)

  /* 登出关闭连接：用一个一次性令牌单独验证，避免影响后续用例 */
  const tmpToken = await freshSession(adminSession.cookie)
  const tmpSse = await openSse(tmpToken)
  const tmpReady = await tmpSse.waitFor((f) => f.type === 'ready', 1500)
  check('一次性会话的实时通道建立成功', !!tmpReady && tmpSse.state.alive)
  const before = (await call('/api/meta/live', { token: admin })).data?.connections
  await call('/api/auth/logout', { method: 'POST', token: tmpToken })
  await sleep(400)
  const after = (await call('/api/meta/live', { token: admin })).data?.connections
  // 直接验证「本会话的流确实被服务端关闭」；全局计数只作参考（可能被其它页签重连抵消）
  check('退出登录后本会话实时连接被立即关闭', !tmpSse.state.alive && after <= before,
    `连接计数 ${before} → ${after}；本会话流${tmpSse.state.alive ? '仍在' : '已关闭'}`)
  check('登出不误杀同账号其它页签的连接', adminSse.state.alive === true && gridSse.state.alive === true,
    `工作台连接 ${adminSse.state.alive ? '在线' : '被误关闭'} / 网格员连接 ${gridSse.state.alive ? '在线' : '被误关闭'}`)
  tmpSse.close()

  console.log('\n=== 2. 待办 SLA / 超期提醒 ===')
  const todo = await call('/api/meta/todo?limit=6', { token: admin })
  check('待办返回超期计数与 SLA 口径', todo.code === 0 && todo.data?.overdue?.total > 0 && !!todo.data?.sla?.byFlow,
    `超期 ${todo.data?.overdue?.total} 条`)
  check('SLA 阈值：办事48h / 治理24h / 告警4h',
    todo.data?.sla?.byFlow?.['办事'] === 48 && todo.data?.sla?.byFlow?.['治理万家'] === 24 && todo.data?.sla?.byFlow?.['告警'] === 4)
  check('待办行携带 _sla 时限明细', Object.values(todo.data?.groups || {}).every((list) => list.every((r) => r._sla && typeof r._sla.overdue === 'boolean')))
  const overdueTodo = await call('/api/meta/todo?limit=8&overdue=1', { token: admin })
  check('仅看超期筛选：全部命中项都是超期', overdueTodo.data?.filter?.overdue === true
    && Object.values(overdueTodo.data?.groups || {}).every((list) => list.every((r) => r._sla?.overdue === true)))
  check('仅看超期不改变待办总量口径', overdueTodo.data?.total === todo.data?.total)
  const gridTodo = await call('/api/meta/todo', { token: grid })
  check('超期统计同样按四级数据范围收窄', gridTodo.data?.overdue?.total <= todo.data?.overdue?.total,
    `网格员 ${gridTodo.data?.overdue?.total} / 区级 ${todo.data?.overdue?.total}`)

  const fresh = await createRequest(admin)
  created.push(fresh.data?.id)
  const newTodo = await call('/api/meta/todo?limit=8', { token: admin })
  const freshRow = (newTodo.data?.groups?.requests || []).find((r) => r.id === fresh.data?.id)
  check('刚提交的新申请进入待办且未误判超期', !!freshRow && freshRow._sla?.overdue === false,
    freshRow ? `age=${freshRow._sla.ageHours}h / SLA=${freshRow._sla.slaHours}h` : '未出现在前 8 条')
  const freshOverdue = await call('/api/meta/todo?limit=20&overdue=1', { token: admin })
  check('新申请不出现在「仅看超期」结果中',
    !(freshOverdue.data?.groups?.requests || []).some((r) => r.id === fresh.data?.id))
  const old = await createRequest(admin, { submitTime: '2026-01-01 00:00:00' })
  created.push(old.data?.id)
  const oldOverdue = await call('/api/meta/todo?limit=20&overdue=1', { token: admin })
  const overdueRows = oldOverdue.data?.groups?.requests || []
  const oldRow = overdueRows.find((r) => r.id === old.data?.id)
  check('历史提交记录被正确判为超期', !!oldRow && oldRow._sla?.overdue === true && oldRow._sla?.ageHours > 48,
    oldRow ? `age=${oldRow._sla.ageHours}h` : `未出现在超期视图（共 ${overdueRows.length} 条）`)
  check('仅看超期按超期时长降序，最紧急的排最前',
    oldOverdue.data?.filter?.sort === 'overdue-desc'
    && (overdueRows[0]?._sla?.ageHours ?? 0) >= (overdueRows[overdueRows.length - 1]?._sla?.ageHours ?? 0),
    `${overdueRows[0]?._sla?.ageHours ?? '-'}h → ${overdueRows[overdueRows.length - 1]?._sla?.ageHours ?? '-'}h`)

  console.log('\n=== 3. 状态机撤回 / 退回 ===')
  const id = fresh.data?.id
  const r0 = await call('/api/transition/revoke', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id } })
  check('初始状态不可撤回', r0.code === 40901, r0.message)
  adminSse.frames.length = 0   // 只观察本次流转产生的新帧，避免命中建单时的历史信号
  const t1 = await call('/api/transition', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id, to: '办理中', remark: TAG } })
  check('先推进到办理中', t1.code === 0 && t1.data?.to === '办理中')
  const liveEvt = await adminSse.waitFor((f) => f.type === 'change' && f.data?.action === 'transition' && f.data?.ids?.includes(id))
  check('状态流转广播待办刷新信号', !!liveEvt && liveEvt.data?.topics?.includes('todo'), liveEvt?.data?.action || '未收到')
  const other = await call('/api/transition/revoke', { method: 'POST', token: street, body: { resource: 'serviceRequests', id } })
  check('不能撤回他人发起的流转', other.code === 40302, other.message)
  const rv = await call('/api/transition/revoke', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id, reason: '误操作' } })
  check('本人 30 分钟内撤回成功', rv.code === 0 && rv.data?.to === '待受理' && rv.data?.action === '撤回', rv.message)
  const afterRv = await call(`/api/serviceRequests/${id}`, { token: admin })
  check('撤回后业务状态与办理痕迹同步回退', afterRv.data?.status === '待受理' && !afterRv.data?.handler)
  const flows1 = await call(`/api/flows?bizId=${id}`, { token: admin })
  const logs = flows1.data || []
  check('原流转留痕被标记 revokedAt（不删除历史）', logs.some((f) => f.action === '流转' && f.revokedAt))
  check('新增独立的撤回留痕且按时间正序', logs.some((f) => f.action === '撤回')
    && logs.findIndex((f) => f.action === '流转') < logs.findIndex((f) => f.action === '撤回'))
  const rv2 = await call('/api/transition/revoke', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id } })
  check('重复撤回被拒绝', rv2.code === 40901, rv2.message)

  await call('/api/transition', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id, to: '办理中' } })
  const short = await call('/api/transition/return', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id, reason: '退回' } })
  check('退回原因过短被拦截', short.code === 40002, short.message)
  const gridReturn = await call('/api/transition/return', { method: 'POST', token: grid, body: { resource: 'serviceRequests', id, reason: '网格员尝试退回上一环节' } })
  check('网格员无权正式退回', gridReturn.status === 403 && gridReturn.code === 40301)
  const rt = await call('/api/transition/return', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id, reason: '材料不齐，退回补充' } })
  check('区级管理员带原因退回成功', rt.code === 0 && rt.data?.to === '待受理' && rt.data?.action === '退回', rt.message)
  const flows2 = (await call(`/api/flows?bizId=${id}`, { token: admin })).data || []
  check('退回留痕写入原因', flows2.some((f) => f.action === '退回' && /材料不齐/.test(f.remark || '')))
  const msgs = await call(`/api/messages?keyword=${encodeURIComponent('进度回退')}&pageSize=50`, { token: admin })
  for (const m of (msgs.data?.records || [])) if (/材料不齐/.test(m.content || '')) tempMessages.push(m.id)
  check('退回同步生成给申请人的进度消息', tempMessages.length > 0, `${tempMessages.length} 条`)

  // V2.5 起状态机资源只能由流转接口推进状态，不能再用 POST 直写终态构造测试数据
  const archived = await call('/api/governanceEvents', {
    method: 'POST', token: admin,
    body: { title: `${TAG}归档事件`, orgCode: '450102010101', gridCode: '450102010101', reportTime: localStamp() }
  })
  createdResources.push({ resource: 'governanceEvents', id: archived.data?.id })
  for (const to of ['已派发', '处置中', '已办结', '已归档']) {
    await call('/api/transition', { method: 'POST', token: admin, body: { resource: 'governanceEvents', id: archived.data?.id, to } })
  }
  const archReturn = await call('/api/transition/return', { method: 'POST', token: admin, body: { resource: 'governanceEvents', id: archived.data?.id, reason: '归档记录尝试退回' } })
  check('已归档记录不可回退', archReturn.code === 40901, archReturn.message)
  const badRes = await call('/api/transition/return', { method: 'POST', token: admin, body: { resource: 'grids', id: 'G0001', reason: '非状态机资源' } })
  check('非状态机资源不可回退', badRes.code === 40001, badRes.message)
  const forward = await call('/api/transition', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id, to: '已办结' } })
  check('正向状态机仍然禁止跳步', forward.code === 40901, forward.message)

  console.log('\n=== 4. 服务端资源元数据 ===')
  const schema = await call('/api/meta/schema', { token: admin })
  check('schema 返回资源数量与版本', schema.code === 0 && schema.data?.version === 'V2.6' && schema.data?.resourceCount >= 25,
    `${schema.data?.resourceCount} 个资源`)
  check('必填字段 / 状态机 / SLA 由服务端下发',
    schema.data?.resources?.population?.required?.includes('name')
    && schema.data?.resources?.serviceRequests?.states?.length === 3
    && schema.data?.resources?.serviceRequests?.slaHours === 48)
  check('只读留痕资源被标记 readonly', schema.data?.resources?.flowLogs?.readonly === true)
  check('受保护字段清单下发且含 version', (schema.data?.protectedFields || []).includes('version'))
  const gridSchema = await call('/api/meta/schema', { token: grid })
  check('schema 按角色裁剪资源', gridSchema.data?.resourceCount < schema.data?.resourceCount
    && !gridSchema.data?.resources?.contracts && !gridSchema.data?.resources?.flowLogs,
    `网格员 ${gridSchema.data?.resourceCount} / 区级 ${schema.data?.resourceCount}`)
  check('schema 不含任何密码或身份证明文', !/admin123|\d{17}[\dXx]/.test(JSON.stringify(schema.data || {})))
  const noAuthSchema = await call('/api/meta/schema')
  check('schema 未鉴权被拒', noAuthSchema.status === 401)

  /* 清理：业务记录走 API；流转留痕与进度消息按标记直连清理，避免污染干净演示数据 */
  for (const id2 of created.filter(Boolean)) await call(`/api/serviceRequests/${id2}`, { method: 'DELETE', token: admin })
  for (const { resource, id: rid } of createdResources.filter((x) => x.id)) {
    await call(`/${resource}/${rid}`, { method: 'DELETE', token: admin })
  }
  for (const mid of tempMessages) await call(`/api/messages/${mid}`, { method: 'DELETE', token: admin })
  try {
    const db = new Database(DB_PATH)
    for (const id2 of created.filter(Boolean)) {
      const logsToDelete = db.prepare('SELECT id FROM t_flowLogs WHERE json_extract(data, ?) = ?').all('$.bizId', String(id2))
      for (const l of logsToDelete) db.prepare('DELETE FROM fts_search WHERE resource = ? AND rid = ?').run('flowLogs', l.id)
      db.prepare('DELETE FROM t_flowLogs WHERE json_extract(data, ?) = ?').run('$.bizId', String(id2))
    }
    db.close()
    console.log('  🧹 临时业务记录 / 流转留痕 / 进度消息已清理')
  } catch (e) { console.warn('  ⚠ 临时留痕清理失败：', e.message) }
  adminSse.close(); gridSse.close()

  console.log(`\n=== 结果：${pass} 项通过 / ${failCount} 项失败 ===\n`)
  process.exit(failCount ? 1 : 0)
})().catch((e) => { console.error('测试执行异常：', e); process.exit(1) })
