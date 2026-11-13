/**
 * V2.5 · 深度代码审计专项回归
 *
 * 本次审计实测发现并修复的缺陷，逐条固化为回归断言：
 *  A. 通用 CRUD 可直写 status 绕过状态机与流转留痕（严重）
 *  B. 免鉴权居民端提交无服务端字段校验（严重）
 *  C. 居民端进度查询外泄内部办理字段与留痕全字段（中）
 *  D. 批量写操作 SSE 广播用操作人组织编码，漏推给下级订阅者（中）
 *  E. 导出无行数上限、只读留痕授权判断顺序错误（中）
 *  F. 前端 ECharts tooltip 未转义、状态字段仍在录入表单、实时通道竞态等（中/轻）
 *
 * 用法：先 npm start，再 node tests/v25-audit.js
 * 所有临时记录通过 API 删除；临时流转留痕 / 查询凭条直连 SQLite 清理。
 */
import fs from 'node:fs'
import Database from 'better-sqlite3'
import { login } from './helpers.js'
import { escHtml } from '../web/src/utils/esc.js'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const DB_PATH = process.env.ZHSQ_DB_FILE || 'server/data/zhsq.db'
const TAG = 'V25审计临时'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const call = async (path, { method = 'GET', token, body, headers = {} } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  let json = null
  try { json = await r.json() } catch { /* 二进制响应 */ }
  return { status: r.status, code: json?.code, data: json?.data, message: json?.message, headers: r.headers }
}
const stamp = () => {
  const p = (n) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const newRequest = (extra = {}) => ({
  code: `${TAG}${Date.now().toString(36)}`, applicant: TAG, item: '事项申报',
  orgCode: '450102010101', gridCode: '450102010101', submitTime: stamp(), content: '审计临时记录',
  ...extra
})
const cleanupIds = []
const cleanupBiz = []

/** SSE 客户端：只收集 change 帧，供广播范围断言使用 */
const openSse = async (token) => {
  const ctrl = new AbortController()
  const res = await fetch(BASE + '/api/events', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: ctrl.signal
  })
  const frames = []
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  ;(async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const f = buf.slice(0, i); buf = buf.slice(i + 2)
        const m = f.match(/event: change[\s\S]*?data: (.+)/)
        if (m) { try { frames.push(JSON.parse(m[1])) } catch { /* 忽略畸形帧 */ } }
      }
    }
  })().catch(() => {})
  await sleep(260)
  return { frames, close: () => ctrl.abort() }
}

const run = async () => {
  console.log('\n=== V2.5 深度审计专项回归 ===\n')
  const admin = await login('admin', 'admin123')
  const grid = await login('grid', '123456')
  check('测试会话就绪（复用有效令牌，不绕过限流）', !!admin && !!grid)

  /* ---------- A. 状态机写入边界 ---------- */
  console.log('\n--- A. 通用 CRUD 不得绕过状态机 ---')
  const evilCreate = await call('/api/serviceRequests', { method: 'POST', token: admin, body: newRequest({ status: '已办结' }) })
  check('新增时直写终态被拒绝', evilCreate.code === 40002, `${evilCreate.code} ${evilCreate.message}`)
  const evilEnum = await call('/api/serviceRequests', { method: 'POST', token: admin, body: newRequest({ status: '任意非法状态' }) })
  check('新增时写入状态机外枚举被拒绝', evilEnum.code === 40002)
  const created = await call('/api/serviceRequests', { method: 'POST', token: admin, body: newRequest() })
  const id = created.data?.id
  cleanupIds.push(id)
  check('不带 status 新建成功且固定为初始状态', created.code === 0 && created.data?.status === '待受理', String(created.data?.status))
  check('新建自动补齐 SLA 起算时间', !!created.data?.submitTime, String(created.data?.submitTime))
  const noFlow = await call(`/api/flows?bizId=${id}`, { token: admin })
  check('新建不产生伪流转留痕', Array.isArray(noFlow.data) && noFlow.data.length === 0)

  if (id) {
    const putStatus = await call(`/api/serviceRequests/${id}`, { method: 'PUT', token: admin, body: { status: '已办结', version: created.data?.version } })
    check('PUT 直改 status 被拒绝', putStatus.code === 40002, `${putStatus.code} ${putStatus.message}`)
    const putHandler = await call(`/api/serviceRequests/${id}`, { method: 'PUT', token: admin, body: { handler: '伪造办理人' } })
    check('PUT 直改状态机派生字段被拒绝', putHandler.code === 40002)
    const legalEdit = await call(`/api/serviceRequests/${id}`, { method: 'PUT', token: admin, body: { content: '仅修改申请内容' } })
    check('普通业务字段编辑不受影响', legalEdit.code === 0 && legalEdit.data?.content === '仅修改申请内容')
    const trans = await call('/api/transition', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id, to: '办理中', remark: '审计回归' } })
    check('专用流转接口正常工作', trans.code === 0 && trans.data?.to === '办理中')
    const logs = await call(`/api/flows?bizId=${id}`, { token: admin })
    const last = (logs.data || []).at(-1)
    check('流转留痕写入操作人 ID（撤回按用户判定）', !!last?.operatorId, String(last?.operatorId))
    const revoke = await call('/api/transition/revoke', { method: 'POST', token: admin, body: { resource: 'serviceRequests', id, reason: '审计误操作' } })
    check('本人撤回仍可用', revoke.code === 0 && revoke.data?.to === '待受理')
    cleanupBiz.push(id)
  }

  const schema = await call('/api/meta/schema', { token: admin })
  check('元数据版本为 V2.6 且下发受保护字段', schema.data?.version === 'V2.6' && (schema.data?.protectedFields || []).includes('id'))
  check('元数据下发状态机不可直写字段供前端剔除', (schema.data?.immutableFields || []).includes('status'))
  const gridSchema = await call('/api/meta/schema', { token: grid })
  check('网格员元数据不含运营/审计资源', !gridSchema.data?.resources?.contracts && !gridSchema.data?.resources?.opLogs)

  /* ---------- B. 居民端免鉴权边界 ---------- */
  console.log('\n--- B. 免鉴权居民端提交的服务端校验 ---')
  const base = { gridCode: '450102010101', name: '审计居民', phone: '13800138000', type: '环境卫生', title: '审计事件', description: '内容' }
  const cases = [
    ['缺少手机号被拒绝', { ...base, phone: undefined }],
    ['非法手机号被拒绝', { ...base, phone: 'not-a-phone' }],
    ['超长标题被拒绝', { ...base, title: 'X'.repeat(3000) }],
    ['HTML 标记被拒绝', { ...base, title: '<img src=x onerror=alert(1)>' }],
    ['枚举外事件类型被拒绝', { ...base, type: '<script>alert(1)</script>' }],
    ['非字符串字段被拒绝', { ...base, description: { a: 1 } }]
  ]
  for (const [name, body] of cases) {
    const r = await call('/api/resident/events', { method: 'POST', body })
    check(name, r.code !== 0, `${r.code} ${String(r.message).slice(0, 40)}`)
  }
  const okSubmit = await call('/api/resident/events', { method: 'POST', body: base })
  check('合法居民端提交仍成功', okSubmit.code === 0 && /^\d{6}$/.test(String(okSubmit.data?.queryCode || '')))
  const bizCode = okSubmit.data?.code, queryCode = okSubmit.data?.queryCode, bizId = okSubmit.data?.id
  cleanupIds.push(bizId); cleanupBiz.push(bizId)
  const progress = await call(`/api/resident/progress?phone=13800138000&bizCode=${encodeURIComponent(bizCode)}&queryCode=${queryCode}`)
  const pub = progress.data?.events?.[0]
  check('三要素进度查询仍成功', progress.code === 0 && !!pub)
  check('进度不再外泄内部办理字段', pub && !('handler' in pub) && !('opinion' in pub) && !('orgCode' in pub) && !('version' in pub))
  const flow = progress.data?.flows?.[0]
  check('进度留痕不外泄内部操作人 / 组织编码', !!flow && flow.operator === '工作人员' && !('orgCode' in flow) && !('atMs' in flow))

  /* ---------- C. SSE 批量广播范围 ---------- */
  console.log('\n--- C. SSE 批量写操作按记录组织编码投递 ---')
  const sse = await openSse(grid)
  const batchId = (await call('/api/serviceRequests', { method: 'POST', token: admin, body: newRequest() })).data?.id
  cleanupIds.push(batchId); cleanupBiz.push(batchId)
  if (batchId) {
    const batch = await call('/api/transition/batch', {
      method: 'POST', token: admin, body: { resource: 'serviceRequests', ids: [batchId], to: '__next__' }
    })
    await sleep(400)
    check('批量流转成功', batch.code === 0 && batch.data?.success === 1)
    check('下级订阅者收到批量流转信号（原缺陷）', sse.frames.some((f) => f.ids?.includes(batchId)))
  }
  sse.close()

  /* ---------- D. 导出、只读留痕与越权 ---------- */
  console.log('\n--- D. 导出与授权纵深 ---')
  const exportRes = await fetch(BASE + '/api/export/messages?pageSize=1', { headers: { Authorization: `Bearer ${admin}` } })
  const buf = Buffer.from(await exportRes.arrayBuffer())
  check('正常导出仍返回非空 xlsx', exportRes.status === 200 && buf.length > 1000, `${buf.length} bytes`)
  const writeLog = await call('/api/flowLogs', { method: 'POST', token: admin, body: { bizType: '办事', bizId: 'FORGE' } })
  check('只读留痕不允许任何角色手工写入', writeLog.code !== 0, `${writeLog.code} ${writeLog.message}`)
  const crossOrg = await call('/api/messages', { method: 'POST', token: grid, body: { title: '越权写入', orgCode: '999999', gridCode: '999999', type: '公告' } })
  check('跨组织写入被拒绝', crossOrg.status === 403 && crossOrg.code === 40300)
  const longField = await call('/api/messages', { method: 'POST', token: admin, body: { title: '长度审计', content: 'X'.repeat(5000), orgCode: '450102010101', gridCode: '450102010101' } })
  check('超长文本被服务端拒绝', longField.code === 40002, `${longField.code} ${longField.message}`)
  if (longField.data?.id) cleanupIds.push(longField.data.id)

  // 编辑回传脱敏值不得损坏库内真实明文
  const pm = await call('/api/partyMembers?pageSize=1', { token: admin })
  const member = pm.data?.records?.[0]
  if (member) {
    await call(`/api/partyMembers/${member.id}`, { method: 'PUT', token: admin, body: { ...member } })
    const grant = await call('/api/auth/sensitive-grant', { method: 'POST', token: admin, body: { password: 'admin123' } })
    const revealed = await fetch(BASE + `/api/partyMembers/${member.id}?reveal=1`, {
      headers: { Authorization: `Bearer ${admin}`, 'X-Sensitive-Token': grant.data?.sensitiveToken }
    }).then((r) => r.json())
    check('编辑回传脱敏值不覆盖库内明文', /^\d{17}[\dXx]$/.test(String(revealed.data?.idcard || '')), String(revealed.data?.idcard))
  }

  /* ---------- E. 前端与部署静态断言 ---------- */
  console.log('\n--- E. 前端 / 部署静态断言 ---')
  const read = (p) => fs.readFileSync(p, 'utf8')
  check('escHtml 正确转义标签与引号', escHtml('<img src=x onerror="a">') === '&lt;img src=x onerror=&quot;a&quot;&gt;')
  const tooltipFiles = ['web/src/views/Screen.vue', 'web/src/views/GeoPlatform.vue', 'web/src/views/Sensing.vue', 'web/src/views/base/PartManage.vue']
  check('四处 ECharts tooltip 全部启用转义', tooltipFiles.every((f) => read(f).includes("from '@/utils/esc'")))
  check('PartManage tooltip 对 raw 做可选链兜底', read('web/src/views/base/PartManage.vue').includes('p.data?.raw?'))
  const formFiles = ['web/src/views/service/ServiceRequest.vue', 'web/src/views/service/GovernanceEvent.vue']
  check('状态字段已从两张录入表单移除',
    formFiles.every((f) => !read(f).includes("default: '待受理'") && !read(f).includes("default: '待派发'")))
  check('CrudTable 依据服务端元数据自动剔除不可直写字段',
    read('web/src/components/CrudTable.vue').includes('immutableFields'))
  check('实时通道具备代际竞态保护', read('web/src/utils/live.js').includes('activeEpoch'))
  check('实时通道处理 closed 帧与 refresh 失败', read('web/src/utils/live.js').includes("event === 'closed'") && read('web/src/utils/live.js').includes('authFailures >= 2'))
  check('明文令牌仅在 reveal / export 请求注入', read('web/src/api/request.js').includes('wantsReveal'))
  check('登出与 401 清理全部 zhsq: 会话缓存', read('web/src/layouts/MainLayout.vue').includes("startsWith('zhsq:')") && read('web/src/api/request.js').includes("startsWith('zhsq:')"))
  check('登录重定向用 URL origin 校验', read('web/src/views/Login.vue').includes('u.origin === window.location.origin'))
  check('列表加载有请求序号防竞态', read('web/src/components/CrudTable.vue').includes('let loadSeq = 0'))
  check('Nginx 改为纯反代且不依赖容器内 dist 路径', !read('deploy/nginx.conf').includes('alias /app/dist') && !read('deploy/nginx.conf').includes('root /app/dist'))
  check('Nginx 覆盖 XFF 防止伪造来源绕过限流', !read('deploy/nginx.conf').includes('$proxy_add_x_forwarded_for'))
  check('生产镜像补齐 sql DDL 基线', read('Dockerfile').includes('COPY --from=build /app/sql ./sql'))

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
    await call(`/api/serviceRequests/${rid}`, { method: 'DELETE', token: admin }).catch(() => {})
    await call(`/api/governanceEvents/${rid}`, { method: 'DELETE', token: admin }).catch(() => {})
    await call(`/api/messages/${rid}`, { method: 'DELETE', token: admin }).catch(() => {})
  }

  console.log(`\n=== 结果：${pass} 项通过 / ${failCount} 项失败 ===\n`)
  if (failCount) process.exit(1)
}

run().catch((e) => { console.error('测试执行异常：', e); process.exit(1) })
