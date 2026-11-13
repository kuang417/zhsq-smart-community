/**
 * P0 体验改造 · 专项回归测试
 *
 * 覆盖：统一待办聚合（状态/范围/口径）、流转留痕范围收窄、导入模板显式报错、
 * 房屋空表单拦截、表头排序、批量流转（成功/跳步/越权/上限）、批量删除与逐条隔离。
 *
 * 用法：先 npm start，再 node tests/p0-regression.js
 * 临时业务记录全部通过 API 删除；临时流转留痕按固定标记清理，不改变初始数据。
 */
import Database from 'better-sqlite3'
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const DB_PATH = process.env.ZHSQ_DB_FILE || 'server/data/zhsq.db'
const TAG = 'P0回归临时'
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
  try { json = await r.json() } catch { /* 二进制响应 */ }
  return { status: r.status, code: json?.code, data: json?.data, message: json?.message, headers: r.headers }
}
/* 登录会话由 tests/helpers.js 统一复用并遵守限流，避免连续回归互相踩登录桶 */

;(async () => {
  const admin = await login('admin', 'admin123')
  const street = await login('street', '123456')
  const grid = await login('grid', '123456')
  check('三个角色登录成功', !!admin && !!street && !!grid)

  console.log('\n=== 1. 统一待办工作台 ===')
  const todo = await call('/api/meta/todo?limit=6', { token: admin })
  const counts = todo.data?.counts || {}
  const sum = Object.values(counts).reduce((a, b) => a + b, 0)
  check('待办接口返回聚合结果', todo.code === 0 && todo.data?.total === sum, `total=${todo.data?.total}`)
  check('待办数量与三类计数一致', sum === counts.events + counts.requests + counts.alarms)
  const validStatus = Object.entries(todo.data?.groups || {}).every(([key, list]) =>
    list.every((r) => (todo.data.statuses[key] || []).includes(r.status)))
  check('首页待办不再混入已办结/已归档记录', validStatus)
  check('每组返回条数受 limit 约束', Object.values(todo.data?.groups || {}).every((l) => l.length <= 6))
  check('待办行带跳转路径与分组', (todo.data?.groups?.events || []).every((r) => r._path && r._group))
  const gridTodo = await call('/api/meta/todo', { token: grid })
  check('待办按四级数据范围收窄', gridTodo.data.total <= todo.data.total,
    `网格员 ${gridTodo.data.total} / 区级 ${todo.data.total}`)

  console.log('\n=== 2. 流转留痕数据范围（上轮遗漏路径）===')
  const gLog = await call('/api/flowLogs?pageSize=1', { token: grid })
  const sLog = await call('/api/flowLogs?pageSize=1', { token: street })
  const aLog = await call('/api/flowLogs?pageSize=1', { token: admin })
  check('网格员读取全局流转台账被拒', gLog.status === 403 && gLog.code === 40301, `HTTP ${gLog.status}`)
  check('街道管理员读取全局流转台账被拒', sLog.status === 403, `HTTP ${sLog.status}`)
  check('区级管理员仍可读取流转台账', aLog.status === 200 && aLog.data?.total > 0, `${aLog.data?.total} 条`)
  const gExp = await call('/api/export/flowLogs', { token: grid })
  check('网格员导出流转台账被拒', gExp.status === 403)
  const gFlows = await call('/api/flows?bizId=SR0001', { token: grid })
  check('单条留痕接口对业务角色仍可用', gFlows.status === 200 && gFlows.code === 0, `HTTP ${gFlows.status}`)

  console.log('\n=== 3. 导入模板与房屋空表单 ===')
  const badTpl = await call('/api/import/template?resource=houses', { token: admin })
  check('未配置模板的资源不再静默返回党员模板', badTpl.code === 40401, badTpl.message)
  const goodTpl = await call('/api/import/template?resource=partyMembers', { token: admin })
  check('已配置模板仍可下载 xlsx',
    goodTpl.status === 200 && String(goodTpl.headers.get('content-type') || '').includes('spreadsheetml'))
  const emptyHouse = await call('/api/houses', { method: 'POST', token: admin, body: {} })
  check('房屋空表单写入被必填校验拦截', emptyHouse.code === 40002, emptyHouse.message)
  const tmpHouse = await call('/api/houses', {
    method: 'POST', token: admin,
    body: { code: 'P0HOUSE001', buildingId: 'B00001', gridCode: '450102010101', unit: 1, room: '101', area: 80, purpose: '居住' }
  })
  check('补齐字段后房屋新增成功', tmpHouse.code === 0, tmpHouse.data?.id)

  console.log('\n=== 4. 表头排序（后端已具备，前端已接线）===')
  const asc = await call('/api/population?pageSize=5&sortField=name&sortOrder=asc', { token: admin })
  const desc = await call('/api/population?pageSize=5&sortField=name&sortOrder=desc', { token: admin })
  check('升序/降序均返回 200', asc.code === 0 && desc.code === 0)
  check('排序结果确实不同',
    (asc.data?.records || []).map((r) => r.name).join('|') !== (desc.data?.records || []).map((r) => r.name).join('|'),
    `${asc.data?.records?.[0]?.name} / ${desc.data?.records?.[0]?.name}`)

  console.log('\n=== 5. 批量流转（状态机 / 逐条隔离 / 越权 / 上限）===')
  const mkEvent = (n) => call('/api/governanceEvents', {
    method: 'POST', token: admin,
    body: { title: `${TAG}事件${n}`, type: '回归测试', status: '待派发', orgCode: '450102010205', gridCode: '450102010205', reporter: '回归测试' }
  })
  const e1 = await mkEvent('A'), e2 = await mkEvent('B')
  const ids = [e1.data?.id, e2.data?.id].filter(Boolean)
  check('创建 2 条临时待办事件', ids.length === 2, ids.join(','))
  const b1 = await call('/api/transition/batch', { method: 'POST', token: admin, body: { resource: 'governanceEvents', ids, to: '__next__', remark: TAG } })
  check('批量流转推进到各自下一状态', b1.code === 0 && b1.data?.success === 2 && b1.data?.failed === 0,
    `成功 ${b1.data?.success} / 失败 ${b1.data?.failed}`)
  const after = await call(`/api/governanceEvents/${ids[0]}`, { token: admin })
  check('流转后状态已落库', after.data?.status === '已派发', after.data?.status)
  const b2 = await call('/api/transition/batch', { method: 'POST', token: admin, body: { resource: 'governanceEvents', ids, to: '已归档' } })
  check('批量跳步被逐条拦截', b2.code === 0 && b2.data?.failed === 2 && b2.data?.errors?.every((x) => /跳步|跨级/.test(x.reason)),
    `失败 ${b2.data?.failed}`)
  const still = await call(`/api/governanceEvents/${ids[0]}`, { token: admin })
  check('跳步失败未污染业务状态', still.data?.status === '已派发')
  const b3 = await call('/api/transition/batch', { method: 'POST', token: grid, body: { resource: 'governanceEvents', ids, to: '__next__' } })
  check('网格员批量流转他网格记录全部失败', b3.code === 0 && b3.data?.failed === 2 && b3.data?.success === 0,
    `成功 ${b3.data?.success} / 失败 ${b3.data?.failed}`)
  const b4 = await call('/api/transition/batch', { method: 'POST', token: admin, body: { resource: 'governanceEvents', ids: ids.concat(['NO-SUCH-ID']), to: '__next__' } })
  check('存在/不存在记录混合时逐条隔离', b4.code === 0 && b4.data?.failed >= 1 && b4.data?.errors?.some((x) => /不存在/.test(x.reason)))
  const b5 = await call('/api/transition/batch', { method: 'POST', token: admin, body: { resource: 'governanceEvents', ids: Array(101).fill('X'), to: '__next__' } })
  check('批量上限 100 条生效', b5.code === 40001, b5.message)
  const single = await call('/api/transition', { method: 'POST', token: admin, body: { resource: 'governanceEvents', id: ids[0], to: '已归档' } })
  check('单条流转接口保持原有跳步响应契约', single.code === 40901, `${single.code} ${single.message}`)

  console.log('\n=== 6. 批量删除与结果汇总 ===')
  const mkMsg = (n) => call('/api/messages', { method: 'POST', token: admin, body: { title: `${TAG}消息${n}`, orgCode: '450102010101', status: '已发布' } })
  const m1 = await mkMsg('A'), m2 = await mkMsg('B')
  const mids = [m1.data?.id, m2.data?.id].filter(Boolean)
  check('创建 2 条临时消息', mids.length === 2)
  const d1 = await call('/api/bulk-delete/messages', { method: 'POST', token: admin, body: { ids: mids } })
  check('批量删除全部成功', d1.code === 0 && d1.data?.success === 2, `成功 ${d1.data?.success}`)
  const d2 = await call('/api/bulk-delete/messages', { method: 'POST', token: admin, body: { ids: mids } })
  check('重复删除被逐条识别为不存在', d2.code === 0 && d2.data?.failed === 2)
  const ro = await call('/api/bulk-delete/flowLogs', { method: 'POST', token: admin, body: { ids: ['FL00001'] } })
  check('系统留痕资源禁止批量删除', ro.code === 40302, ro.message)

  // 清理：业务记录走 API（同步服务端内存镜像），流转留痕按标记清理
  if (tmpHouse.data?.id) await call('/api/bulk-delete/houses', { method: 'POST', token: admin, body: { ids: [tmpHouse.data.id] } })
  for (const id of ids) await call(`/api/governanceEvents/${id}`, { method: 'DELETE', token: admin })
  try {
    const db = new Database(DB_PATH)
    for (const id of ids) {
      const logs = db.prepare('SELECT id FROM t_flowLogs WHERE json_extract(data, ?) = ?').all('$.bizId', String(id))
      for (const l of logs) db.prepare('DELETE FROM fts_search WHERE resource = ? AND rid = ?').run('flowLogs', l.id)
      db.prepare('DELETE FROM t_flowLogs WHERE json_extract(data, ?) = ?').run('$.bizId', String(id))
    }
    db.close()
    console.log('  🧹 临时业务记录与流转留痕已清理')
  } catch (e) { console.warn('  ⚠ 临时留痕清理失败：', e.message) }

  console.log(`\n=== 结果：${pass} 项通过 / ${failCount} 项失败 ===\n`)
  process.exit(failCount ? 1 : 0)
})().catch((e) => { console.error('测试执行异常：', e); process.exit(1) })
