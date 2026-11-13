/**
 * 党组织"党员人数"统计回归
 *
 * 修复前缺陷：
 *   1) partyOrgs.memberCount 是永不更新的冗余字段，新建组织恒为 0，增删党员也不回写，
 *      导致党组织树 / 组织详情的"党员人数"一律显示 0。
 *   2) "该组织党员"列表按 orgCode 过滤，但党员按 orgId（党组织主键）归属，且党总支与
 *      下属支部共用社区 orgCode，父级党委 / 党工委查不到下级支部的党员、也出现 0 人。
 *   3) 手工新增党员只传 orgCode、后端不补 orgId，导致这些党员 orgId 为空，既不被任何
 *      组织计数、也查不到（错归属）。
 *
 * 修复后断言：
 *   - 党组织列表的 memberCount 实时聚合「本组织 + 全部下级」党员；
 *   - /api/party/members?orgId= 按唯一 orgId 聚合（含下级）返回党员；
 *   - 新增 / 编辑党员以唯一 orgId 归属，计数随之联动。
 *
 * 用法：先 npm start，再 node tests/party-count.js
 */
import { login } from './helpers.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const call = async (path, { method = 'GET', token, body } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  let data = null
  try { data = await r.json() } catch {}
  return { status: r.status, code: data?.code, data: data?.data, raw: data }
}

const main = async () => {
  const token = await login('admin', 'admin123')
  console.log('\n=== 党组织党员人数统计回归 ===')

  const orgsRes = await call('/api/partyOrgs?pageSize=500', { token })
  const orgs = orgsRes.data?.records || []
  const byId = new Map(orgs.map((o) => [o.id, o]))
  check('党组织列表可获取', orgs.length > 0, `${orgs.length} 个`)

  const root = byId.get('PO001') // 中共兴宁区委员会（党委，理论含全部下级）
  check('根党委 memberCount 实时聚合（等于全部党员总数）', root && root.memberCount > 0,
    root ? `memberCount=${root.memberCount}` : 'PO001 缺失')

  const leaf = orgs.find((o) => o.level === '党支部')
  check('支部 memberCount 为正数', leaf && leaf.memberCount > 0, leaf ? `${leaf.name}=${leaf.memberCount}` : '')

  // /api/party/members 按 orgId 聚合
  const rootMembers = await call(`/api/party/members?orgId=PO001&pageSize=5`, { token })
  check('根党委党员(含下级)总数 = 列表 memberCount', root && rootMembers.data?.total === root.memberCount,
    `total=${rootMembers.data?.total} vs memberCount=${root?.memberCount}`)

  const leafMembers = await call(`/api/party/members?orgId=${leaf.id}&pageSize=5`, { token })
  check('支部党员总数 = 列表 memberCount', leafMembers.data?.total === leaf.memberCount,
    `total=${leafMembers.data?.total} vs memberCount=${leaf.memberCount}`)

  // 父级党委应能看到下级支部的党员（聚合）
  check('父级党委聚合数 ≥ 任一子支部数', root.memberCount >= leaf.memberCount,
    `${root.memberCount} >= ${leaf.memberCount}`)

  // 新增党员：只传 orgId，验证唯一归属 + 计数联动
  const beforeLeaf = leaf.memberCount
  const beforeRoot = root.memberCount
  const newMem = await call('/api/partyMembers', {
    method: 'POST', token,
    body: { name: '回归测试员', idcard: '450102199003032018', phone: '13700000003', orgId: leaf.id, joinDate: '2021-05-05', status: '正式党员' }
  })
  check('新增党员成功', newMem.code === 0, `code=${newMem.code}`)
  check('新增党员 orgId 精确归属（无歧义）', newMem.data?.orgId === leaf.id, `orgId=${newMem.data?.orgId}`)
  check('新增党员 orgName 已反查', !!newMem.data?.orgName, newMem.data?.orgName)

  const leafAfter = (await call('/api/partyOrgs?pageSize=500', { token })).data.records.find((o) => o.id === leaf.id)
  const rootAfter = (await call('/api/partyOrgs?pageSize=500', { token })).data.records.find((o) => o.id === 'PO001')
  check('新增后支部 memberCount +1', leafAfter.memberCount === beforeLeaf + 1, `${beforeLeaf}→${leafAfter.memberCount}`)
  check('新增后根党委 memberCount +1', rootAfter.memberCount === beforeRoot + 1, `${beforeRoot}→${rootAfter.memberCount}`)

  const leafMem2 = await call(`/api/party/members?orgId=${leaf.id}&pageSize=200`, { token })
  check('新增党员出现在该组织党员列表中', leafMem2.data.records.some((m) => m.id === newMem.data.id))
  check('新增党员出现在父级党委聚合列表中', (await call('/api/party/members?orgId=PO001&pageSize=200', { token })).data.records.some((m) => m.id === newMem.data.id))

  // 编辑：改挂到另一个支部，计数随之搬迁
  const leaf2 = orgs.find((o) => o.level === '党支部' && o.id !== leaf.id)
  const beforeLeaf2 = leaf2.memberCount
  const upd = await call(`/api/partyMembers/${newMem.data.id}`, {
    method: 'PUT', token, body: { orgId: leaf2.id, version: newMem.data.version }
  })
  check('编辑党员改挂新组织成功', upd.code === 0, `code=${upd.code}`)
  check('编辑后 orgId 更新为新组织', upd.data?.orgId === leaf2.id)
  const leafBack = (await call('/api/partyOrgs?pageSize=500', { token })).data.records.find((o) => o.id === leaf.id)
  const leaf2After = (await call('/api/partyOrgs?pageSize=500', { token })).data.records.find((o) => o.id === leaf2.id)
  check('原支部计数回退', leafBack.memberCount === beforeLeaf, `${leafBack.memberCount} vs ${beforeLeaf}`)
  check('新支部计数 +1', leaf2After.memberCount === beforeLeaf2 + 1, `${beforeLeaf2}→${leaf2After.memberCount}`)

  // 清理
  await call(`/api/partyMembers/${newMem.data.id}`, { method: 'DELETE', token })
  const leafClean = (await call('/api/partyOrgs?pageSize=500', { token })).data.records.find((o) => o.id === leaf.id)
  check('删除党员后支部计数复原', leafClean.memberCount === beforeLeaf, `${leafClean.memberCount} vs ${beforeLeaf}`)

  console.log(`\n结果：${pass} 通过 / ${failCount} 失败`)
  process.exit(failCount ? 1 : 0)
}
main().catch((e) => { console.error('运行异常', e); process.exit(2) })
