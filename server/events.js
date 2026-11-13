/**
 * 进程内 SSE 事件总线（V2.4 · 真·实时推送）
 *
 * 设计边界：
 *  - 单进程 / 单实例部署（与 SQLite 单机单写的部署拓扑一致）；多实例需要换成 Redis Pub/Sub 或消息队列。
 *  - 推送只携带「哪一类数据发生了变化」的最小信号（资源名 / 主题 / 编号 / 时间），
 *    不携带姓名、手机号、身份证、办理意见等任何业务字段；前端收到信号后按原有鉴权接口重新拉数。
 *  - 每个连接绑定建立时的会话身份；按组织前缀（四级数据权限）与资源模块授权逐客户端过滤事件，
 *    避免 A 街道收到 B 街道的变更信号，也避免网格员收到运营中心资源的变更信号。
 *  - 通道本身走 /api 的 JWT 鉴权中间件；用 fetch 流式读取（可带 Authorization 头），
 *    不使用会把令牌暴露在 URL / 查询串里的 EventSource。
 */
import { assertResource, ROLE_MODULES, RESOURCES } from './config.js'
import { inScope } from './utils.js'
import { localStamp } from './time.js'

const MAX_TOTAL = 200
const MAX_PER_USER = 3
const HEARTBEAT_MS = 25000
const MAX_LIFETIME_MS = 2 * 60 * 60 * 1000   // 与 access token 同寿命，到期由客户端换新令牌重连

/** clientId -> { res, user, jti, clientId, heartbeat, deadline, closed } */
const clients = new Map()
/** userId -> Set<clientId> */
const byUser = new Map()
let seq = 0
let published = 0
let cid = 0

const nowStamp = () => localStamp()

function write(res, text) {
  try { return res.write(text) } catch (e) { return false }
}

function removeClient(clientId) {
  const c = clients.get(clientId)
  if (!c || c.closed) return
  c.closed = true
  if (c.heartbeat) clearInterval(c.heartbeat)
  if (c.deadline) clearTimeout(c.deadline)
  clients.delete(clientId)
  const set = byUser.get(c.user.id)
  if (set) {
    set.delete(clientId)
    if (!set.size) byUser.delete(c.user.id)
  }
  try { c.res.end() } catch (e) { /* 客户端已断开 */ }
}

/**
 * 建立一个 SSE 连接。调用方必须是已通过鉴权中间件的请求（req.user 存在）。
 * 返回该连接的清理函数，便于测试或路由层主动关闭。
 */
export function subscribe(req, res, user) {
  if (!user?.id) return () => {}
  // 绑定当前 access token 的 jti：退出登录只关闭「本次会话」的连接，
  // 不误杀同账号其它页签（它们仍持有各自有效的 access token，被关掉只会反复自动重连）。
  const jti = String(req.tokenPayload?.jti || '')
  if (clients.size >= MAX_TOTAL) {
    res.status(503).json({ code: 50301, message: '实时通道连接数已达上限，请稍后重试', data: null })
    return () => {}
  }
  const set = byUser.get(user.id) || new Set()
  // 同一账号最多保留 3 个页签；关闭最旧的连接，避免刷新页面累积僵尸连接
  while (set.size >= MAX_PER_USER) {
    const oldest = set.values().next().value
    if (!oldest) break
    write(clients.get(oldest)?.res, `event: closed\ndata: ${JSON.stringify({ reason: '被新连接替换' })}\n\n`)
    removeClient(oldest)
  }

  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')   // Nginx 反代下禁止缓冲，否则事件会被攒着不下发
  res.flushHeaders?.()

  const clientId = ++cid
  const c = {
    clientId, res, jti, user: {
      id: user.id, username: user.username, name: user.name, role: user.role,
      orgCode: user.orgCode, orgLevel: user.orgLevel
    },
    closed: false, heartbeat: null, deadline: null
  }
  clients.set(clientId, c)
  set.add(clientId)
  byUser.set(user.id, set)

  write(res, 'retry: 3000\n\n')
  write(res, `event: ready\ndata: ${JSON.stringify({
    at: nowStamp(), heartbeatSeconds: HEARTBEAT_MS / 1000,
    maxLifetimeSeconds: MAX_LIFETIME_MS / 1000, mode: 'sse'
  })}\n\n`)

  c.heartbeat = setInterval(() => {
    if (!write(res, `: ping ${nowStamp()}\n\n`)) removeClient(clientId)
  }, HEARTBEAT_MS)
  c.deadline = setTimeout(() => {
    write(res, `event: closed\ndata: ${JSON.stringify({ reason: '连接到达最大生命周期，请重新订阅' })}\n\n`)
    removeClient(clientId)
  }, MAX_LIFETIME_MS)
  // 客户端断开的双保险：req 的 close 在部分反代/keep-alive 组合下不会及时触发，
  // res 的 close 一定会在连接终止时触发，避免僵尸订阅占满 MAX_TOTAL / MAX_PER_USER。
  req.on('close', () => removeClient(clientId))
  res.on('close', () => removeClient(clientId))

  return () => removeClient(clientId)
}

/**
 * 会话退出 / 令牌吊销时关闭实时连接。
 * 传 jti 时只关闭该 access token 建立的连接；不传时关闭该账号全部连接（改密等强制下线场景）。
 */
export function closeUser(userId, jti = '') {
  const set = byUser.get(String(userId))
  if (!set) return 0
  let n = 0
  for (const id of [...set]) {
    const c = clients.get(id)
    if (jti && c?.jti && c.jti !== String(jti)) continue
    removeClient(id); n++
  }
  return n
}

/**
 * 广播一条「数据已变化」信号。
 * @param {{resource?:string, orgCode?:string|string[], ids?:Array, action?:string, topics?:string[]}} evt
 * 事务成功后才调用；任何推送失败都不得影响业务写入结果。
 */
export function publish(evt = {}) {
  if (!clients.size) return 0
  const resource = String(evt.resource || '')
  const cfg = RESOURCES[resource]
  const topics = Array.isArray(evt.topics) ? evt.topics : []
  // 批量写操作涉及多条不同组织的记录：逐条收集编码，任一编码落在订阅者范围内即投递
  const orgCodes = (Array.isArray(evt.orgCode) ? evt.orgCode : [evt.orgCode])
    .filter((x) => x != null && String(x) !== '').map(String)
  const at = nowStamp()
  const id = ++seq
  published++
  let sent = 0
  for (const c of [...clients.values()]) {
    if (c.closed) continue
    // 组织前缀过滤：空组织编码（个别历史留痕）只投递给区级
    if (orgCodes.length) {
      if (!orgCodes.some((oc) => inScope(c.user, oc))) continue
    } else if (c.user.orgLevel !== 1) continue

    const allowedTopics = []
    if (topics.includes('todo')) {
      const mods = ROLE_MODULES[c.user.role] || []
      if (mods.includes('service') || mods.includes('sensing')) allowedTopics.push('todo')
    }
    const canSeeResource = !!resource && assertResource(c.user, resource)
    if (canSeeResource) allowedTopics.push(resource)
    if (!allowedTopics.length) continue

    const payload = {
      type: 'change', seq: id, at,
      action: String(evt.action || 'write'),
      resource: canSeeResource ? resource : '',
      module: cfg?.module || '',
      topics: allowedTopics,
      // 编号只在有该资源读权限时下发，且最多 20 条，避免大批量操作撑大推送体
      ids: canSeeResource ? (Array.isArray(evt.ids) ? evt.ids.slice(0, 20).map(String) : []) : []
    }
    if (!write(c.res, `id: ${id}\nevent: change\ndata: ${JSON.stringify(payload)}\n\n`)) {
      removeClient(c.clientId)
      continue
    }
    sent++
  }
  return sent
}

/** 测试 / 运维诊断：不暴露任何连接身份信息 */
export function busStats() {
  return {
    connections: clients.size, subscribers: byUser.size,
    maxTotal: MAX_TOTAL, maxPerUser: MAX_PER_USER,
    heartbeatSeconds: HEARTBEAT_MS / 1000, published, seq
  }
}
