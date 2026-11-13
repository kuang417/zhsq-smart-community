/**
 * 深度代码审计 · 安全与业务逻辑回归测试
 *
 * 覆盖前三个测试套件未覆盖的场景：模块级鉴权、全局资源越权读、流转留痕越权、
 * 跨组织写、主键/组织编码篡改、空表单写入、乐观锁并发、查询码暴破锁定、
 * 审计日志来源 IP、状态机操作人伪造。
 *
 * 用法：先 npm start，再 node tests/audit-regression.js
 * 测试产生的临时记录会在结束时清理（含流转留痕），不改变初始数据。
 */
import Database from 'better-sqlite3'
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const DB_PATH = process.env.ZHSQ_DB_FILE || 'server/data/zhsq.db'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
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
  try { json = await r.json() } catch { /* 非 JSON */ }
  return { status: r.status, code: json?.code, data: json?.data, message: json?.message }
}
/* 登录会话由 tests/helpers.js 统一复用并遵守限流，避免连续回归互相踩登录桶 */

;(async () => {
  const admin = await login('admin', 'admin123')
  const street = await login('street', '123456')
  const grid = await login('grid', '123456')
  check('三个测试角色登录成功', !!admin && !!street && !!grid)

  console.log('\n=== 1. 模块级鉴权（P1：前端隐藏菜单不是安全边界）===')
  for (const r of ['partyMembers', 'partyOrgs', 'learnings', 'contents', 'contracts', 'opLogs']) {
    const x = await call(`/api/${r}?pageSize=1`, { token: grid })
    check(`网格员读取无权限资源 ${r} 被拒绝`, x.status === 403, `HTTP ${x.status} / ${x.code}`)
  }
  for (const r of ['grids', 'population', 'messages', 'serviceRequests', 'alarms', 'banners', 'shortcuts']) {
    const x = await call(`/api/${r}?pageSize=1`, { token: grid })
    check(`网格员读取本职模块 ${r} 正常`, x.status === 200 && x.code === 0, `HTTP ${x.status}`)
  }
  const exp = await call('/api/export/opLogs', { token: grid })
  check('网格员导出全局审计日志被拒绝', exp.status === 403, `HTTP ${exp.status}`)

  console.log('\n=== 2. 流转留痕数据范围 ===')
  const gFlows = await call('/api/flows', { token: grid })
  const aFlows = await call('/api/flows', { token: admin })
  const gCount = Array.isArray(gFlows.data) ? gFlows.data.length : -1
  const aCount = Array.isArray(aFlows.data) ? aFlows.data.length : -1
  check('网格员流转记录已按数据范围收窄', gCount >= 0 && gCount < aCount, `网格员 ${gCount} / 区级 ${aCount}`)

  console.log('\n=== 3. 跨组织写防护 ===')
  const other = await call('/api/partyMembers?pageSize=1&orgCode=45010202', { token: admin })
  const otherRow = other.data?.records?.[0]
  check('取得跨组织测试样本', !!otherRow, otherRow?.id)
  if (otherRow) {
    check('街道管理员越权编辑他街道记录被拒',
      (await call(`/api/partyMembers/${otherRow.id}`, { method: 'PUT', token: street, body: { name: '越权' } })).status === 404)
    check('街道管理员越权删除他街道记录被拒',
      (await call(`/api/partyMembers/${otherRow.id}`, { method: 'DELETE', token: street })).status === 404)
  }
  check('街道管理员越权新增他街道数据被拒',
    (await call('/api/partyMembers', { method: 'POST', token: street, body: { name: '越权', idcard: '450102199001011234', orgCode: '45010202' } })).status === 403)

  console.log('\n=== 4. 权限关键字段防篡改 + 服务端必填校验 ===')
  const own = await call('/api/messages?pageSize=1', { token: street })
  const ownRow = own.data?.records?.[0]
  check('取得本范围测试样本', !!ownRow, ownRow?.id)
  if (ownRow) {
    const move = await call(`/api/messages/${ownRow.id}`, { method: 'PUT', token: street, body: { orgCode: '45010299' } })
    check('把记录移出自身数据范围被拒', move.status === 403, `HTTP ${move.status}`)
    const still = await call(`/api/messages/${ownRow.id}`, { token: admin })
    check('越权改写未落库', still.data?.orgCode !== '45010299', still.data?.orgCode)
  }
  const empty = await call('/api/partyMembers', { method: 'POST', token: admin, body: {} })
  check('空表单写入被服务端拦截', empty.code === 40002, `${empty.code} ${empty.message || ''}`)
  const badId = await call('/api/partyMembers', { method: 'POST', token: admin, body: { name: '甲', idcard: '123', orgCode: '450102' } })
  check('非法身份证格式被拦截', badId.code === 40002, badId.message)

  console.log('\n=== 5. 编辑主链路 + 乐观锁 ===')
  if (ownRow) {
    const title0 = ownRow.title
    const e1 = await call(`/api/messages/${ownRow.id}`, {
      method: 'PUT', token: street, body: { title: title0 + '【回归】', version: ownRow.version }
    })
    check('带版本号编辑成功（主键/ID 解析正确）', e1.status === 200 && e1.code === 0, `HTTP ${e1.status}`)
    const e2 = await call(`/api/messages/${ownRow.id}`, {
      method: 'PUT', token: street, body: { title: title0, version: ownRow.version }
    })
    check('用过期版本号重复提交触发 409 并发冲突', e2.status === 409 && e2.code === 40903, `HTTP ${e2.status}`)
    const cur = await call(`/api/messages/${ownRow.id}`, { token: street })
    check('列表下发最新 version', Number(cur.data?.version) > Number(ownRow.version), `v${ownRow.version} → v${cur.data?.version}`)
    // 复原标题（用当前 version）
    await call(`/api/messages/${ownRow.id}`, {
      method: 'PUT', token: street, body: { title: title0, version: cur.data?.version }
    })
  }

  console.log('\n=== 6. 流转操作人不可伪造 ===')
  const tmp = await call('/api/governanceEvents', {
    method: 'POST', token: admin,
    body: { title: '审计回归临时事件', orgCode: '450102', status: '待派发', reporter: '回归', reporterPhone: '13800138000' }
  })
  const tmpId = tmp.data?.id
  check('创建临时事件用于留痕验证', !!tmpId, tmpId)
  if (tmpId) {
    const t = await call('/api/transition', {
      method: 'POST', token: admin,
      body: { resource: 'governanceEvents', id: tmpId, to: '已派发', operator: '伪造的操作人' }
    })
    check('流转成功', t.code === 0)
    const fl = await call(`/api/flows?bizId=${tmpId}`, { token: admin })
    const last = (fl.data || []).slice(-1)[0]
    check('留痕操作人取会话身份而非客户端传参', last?.operator === '区级管理员' && last?.operator !== '伪造的操作人', last?.operator)
  }

  console.log('\n=== 7. 查询码防暴破 ===')
  const fakeBiz = 'BS' + Date.now()
  const statuses = []
  for (let i = 0; i < 7; i++) {
    const r = await call(`/api/resident/progress?phone=13800138000&bizCode=${fakeBiz}&queryCode=00000${i}`, {})
    statuses.push(r.status)
  }
  check('连续错误查询码触发锁定 429', statuses.slice(-1)[0] === 429 && statuses.some((s) => s === 403),
    statuses.join(','))

  console.log('\n=== 8. 账号资源与审计留痕 ===')
  check('users 不在通用 CRUD 暴露范围', (await call('/api/users?pageSize=1', { token: grid })).status === 404)
  const logs = await call('/api/opLogs?pageSize=50', { token: admin })
  const hasIp = (logs.data?.records || []).some((r) => Object.prototype.hasOwnProperty.call(r, 'ip') && r.ip !== '-')
  check('运行时审计日志含来源 IP 字段', hasIp, `${logs.data?.records?.length || 0} 条样本`)

  // 清理临时事件及其流转留痕，保证初始数据干净
  if (tmpId) {
    try {
      const db = new Database(DB_PATH)
      db.prepare('DELETE FROM t_governanceEvents WHERE id = ?').run(String(tmpId))
      db.prepare('DELETE FROM fts_search WHERE resource = ? AND rid = ?').run('governanceEvents', String(tmpId))
      db.prepare('DELETE FROM t_flowLogs WHERE json_extract(data, ?) = ?').run('$.bizId', String(tmpId))
      db.prepare('DELETE FROM t_messages WHERE json_extract(data, ?) LIKE ?').run('$.title', '%审计回归临时事件%')
      db.close()
      console.log('  🧹 临时事件与流转留痕已清理')
    } catch (e) { console.warn('  ⚠ 临时数据清理失败：', e.message) }
  }

  console.log(`\n=== 结果：${pass} 项通过 / ${failCount} 项失败 ===\n`)
  process.exit(failCount ? 1 : 0)
})().catch((e) => { console.error('测试执行异常：', e); process.exit(1) })
