/**
 * 智慧社区治理平台 Demo —— RESTful API 服务（单端口 8081）
 * 对应说明书 3.3 / 3.4：JWT 鉴权、四级数据权限、状态机闭环、事务留痕、
 * 统一响应体 {code,message,data}、分页 {total,records,pageNum,pageSize}、Excel 导入导出。
 */
import express from 'express'
import XLSX from 'xlsx'
import multer from 'multer'
import http from 'node:http'
import https from 'node:https'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as store from './store.js'
import {
  RESOURCES, FLOWS, FLOW_BY_RESOURCE, FIELD_LABELS, IMPORT_TEMPLATES,
  assertResource, PROTECTED_FIELDS, FLOW_PROTECTED_FIELDS, FLOW_INITIAL_STATUS,
  FLOW_SLA_HOURS, SLA_START_FIELD, REVOKE_WINDOW_MINUTES, RETURN_ROLES, ROLE_MODULES,
  REMARK_MAX_LENGTH, SEARCH_KEYWORD_MAX_LENGTH, SEARCH_MAX_LIMIT, ORG_CODE_RE,
  RESIDENT_PRIVATE_MESSAGE_RE
} from './config.js'
import { ok, fail, bizFail, wrap, desensitize, scopeFilter, assertModule, assertScope, sanitizeRichText } from './utils.js'
import { sign, verify, revoke, createLimiter, TTL } from './auth.js'
import { runWithUser, setCurrentUser, setRequestMeta } from './scope.js'
import { isProduction, keyStatus, keyOf } from './keys.js'
import { verifyPassword } from './crypto.js'
import { subscribe, publish, closeUser, busStats } from './events.js'
import { localStamp, stampEpoch } from './time.js'
import * as stats from './stats.js'
import * as geoBasemap from './geo-basemap.js'
import { parseBasemapFile } from './geo-import.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const UPLOAD_DIR = path.join(__dirname, 'uploads')
// 上传目录常驻磁盘，独立于 SQLite；递归创建避免首启缺目录
fs.mkdirSync(UPLOAD_DIR, { recursive: true })
const PORT = Number(process.env.PORT || 8081)
const SECURE = isProduction()

// 生产环境启动前强制校验密钥注入，缺一即退出，避免误用本地开发密钥
if (SECURE) {
  try { keyOf('jwt'); keyOf('data'); keyOf('index') }
  catch (e) { console.error(`[startup] ${e.message}`); process.exit(1) }
}

await store.load()   // 打开 SQLite；库为空时自动从种子 JSON 灌数据
const app = express()
app.disable('x-powered-by')
// 经 Nginx 反代时信任 1 层代理，使 req.ip / req.protocol 取到真实来源；
// 直连部署保持 false，避免攻击者用伪造 X-Forwarded-For 绕过按 IP 的限流。
const TRUST_PROXY = process.env.ZHSQ_TRUST_PROXY
if (TRUST_PROXY != null && TRUST_PROXY !== '' && TRUST_PROXY !== '0') {
  app.set('trust proxy', TRUST_PROXY === 'true' ? 1 : Number(TRUST_PROXY) || 1)
}
app.use(express.json({ limit: '2mb' }))   // JSON 不再承载 Excel 数据，收紧体积

/* ---------------- 传输边界：CORS 白名单 + 安全头 + 限流 ---------------- */
const CORS_ORIGINS = (process.env.ZHSQ_CORS_ORIGINS ||
  'http://localhost:8081,http://127.0.0.1:8081,http://localhost:5182,http://127.0.0.1:5182')
  .split(',').map((s) => s.trim()).filter(Boolean)
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'",
  "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'"
].join('; ')
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Credentials', 'true')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Sensitive-Token')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Content-Security-Policy', CSP)
  if (SECURE) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// 阈值可通过环境变量收紧（生产建议接入 Redis 做分布式限流）
const RATE = {
  global: Number(process.env.ZHSQ_RATE_GLOBAL || 1200),
  login: Number(process.env.ZHSQ_RATE_LOGIN || 10),
  resident: Number(process.env.ZHSQ_RATE_RESIDENT || 120)
}
const globalLimiter = createLimiter({ max: RATE.global, windowMs: 60000, message: '请求过于频繁，请稍后再试' })
const loginLimiter = createLimiter({
  max: RATE.login, windowMs: 60000,
  keyOfReq: (req) => `login:${req.ip}:${String(req.body?.username || '')}`,
  message: '登录尝试过于频繁，请 1 分钟后再试'
})
const residentLimiter = createLimiter({ max: RATE.resident, windowMs: 60000, keyOfReq: (req) => `resident:${req.ip}`, message: '提交/查询过于频繁，请稍后再试' })
// V2.6：二次验密是密码校验入口，不能只靠全局限流（1200/min）兜底。
// 采用「仅连续失败计数」的专用守卫：成功授权立即清零，避免正常回归 / 运维操作被误锁。
const SENSITIVE_FAIL_MAX = Number(process.env.ZHSQ_RATE_SENSITIVE || 8)
const SENSITIVE_FAIL_WINDOW_MS = 60000
const sensitiveFails = new Map()
const sensitiveFailKey = (req) => `${req.ip || '-'}:${req.user?.id || '-'}`
const sensitiveLocked = (req) => {
  const key = sensitiveFailKey(req)
  const rec = sensitiveFails.get(key)
  if (!rec) return 0
  if (Date.now() - rec.firstAt >= SENSITIVE_FAIL_WINDOW_MS) { sensitiveFails.delete(key); return 0 }
  return rec.count >= SENSITIVE_FAIL_MAX ? Math.ceil((SENSITIVE_FAIL_WINDOW_MS - (Date.now() - rec.firstAt)) / 1000) : 0
}
const noteSensitiveFail = (req) => {
  const key = sensitiveFailKey(req)
  const now = Date.now()
  const rec = sensitiveFails.get(key)
  const next = (!rec || now - rec.firstAt >= SENSITIVE_FAIL_WINDOW_MS)
    ? { count: 1, firstAt: now }
    : { count: rec.count + 1, firstAt: rec.firstAt }
  sensitiveFails.set(key, next)
  // 防止异常 IP 撑爆内存
  if (sensitiveFails.size > 5000) {
    for (const [k, v] of sensitiveFails) if (now - v.firstAt >= SENSITIVE_FAIL_WINDOW_MS) sensitiveFails.delete(k)
  }
  return next.count
}
app.use('/api', globalLimiter)
// 演示期遗留接口显式下线（放在鉴权之前，明确返回 404 而非 401）
app.get('/api/meta/accounts', (_req, res) => fail(res, 404, '接口已移除：正式版不下发任何账号信息', 40400))
// 每个请求建立独立上下文，SQL 层据此自动注入数据权限；审计日志从上下文取来源 IP/UA
app.use('/api', (req, res, next) => runWithUser(null, () => {
  setRequestMeta({ ip: req.ip || '-', ua: req.headers['user-agent'] || '' })
  next()
}))

/* ---------------- 鉴权拦截器（JWT + 吊销名单） ---------------- */
// 免鉴权白名单逐条精确匹配；不再用 /^\/api\/resident\// 这类前缀，
// 防止 /api/resident/..%2f.. 形式绕过鉴权中间件。
const PUBLIC = [
  /^\/api\/auth\/(login|refresh)$/,
  /^\/api\/health$/,
  /^\/api\/resident\/(home|messages)\/[^/]+$/,
  /^\/api\/resident\/(events|requests|progress)$/
]
app.use('/api', (req, res, next) => {
  const fullPath = req.originalUrl.split('?')[0]
  if (PUBLIC.some((r) => r.test(fullPath))) return next()
  const auth = req.headers.authorization || ''
  const payload = verify(auth.startsWith('Bearer ') ? auth.slice(7) : '', 'access')
  if (!payload) return fail(res, 401, '登录已过期或令牌无效，请重新登录', 40100)
  const user = store.getDb().users.find((u) => u.id === payload.userId)
  if (!user) return fail(res, 401, '用户不存在', 40101)
  req.user = { ...user, scopeDesc: user.scopeDesc }
  req.tokenPayload = payload
  setCurrentUser(req.user)
  next()
})

const parseCookies = (raw = '') => Object.fromEntries(
  String(raw).split(';').map((s) => s.trim().split('=')).filter((p) => p[0])
    .map(([k, v]) => {
      // 畸形 Cookie（如 value 含孤立的 %）不应让登录 / 刷新接口直接 500
      let value = v || ''
      try { value = decodeURIComponent(value) } catch (e) { /* 保留原值，后续验签必然失败 */ }
      return [k, value]
    })
)
const tokenPayloadOf = (u) => ({ userId: u.id, username: u.username, role: u.role, orgCode: u.orgCode, orgLevel: u.orgLevel })
const setRefreshCookie = (res, token) => res.cookie('zhsq_refresh', token, {
  httpOnly: true, sameSite: 'strict', secure: SECURE, maxAge: TTL.refresh * 1000, path: '/api/auth'
})

/** 表驱动菜单（sys_menu / sys_role_menu），不再用硬编码 MENUS 过滤 */
const visibleMenus = (user) => store.menusForRole(user.role)
const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.name, role: u.role, roleName: u.roleName,
  orgCode: u.orgCode, orgLevel: u.orgLevel, orgName: u.orgName, scopeDesc: u.scopeDesc
})

/**
 * 明文查看二次授权：区级管理员 + 重新验密换取的 5 分钟 sensitive 令牌。
 * 未授权但请求 reveal=1 时直接 403，不静默降级为脱敏。
 */
const revealGranted = (req) => {
  if (req.query?.reveal !== '1') return { reveal: false }
  if (req.user?.orgLevel !== 1) return { reveal: false, error: '仅区级管理员可申请查看明文' }
  const p = verify(req.headers['x-sensitive-token'], 'sensitive')
  if (!p || p.userId !== req.user.id) return { reveal: false, error: '查看明文需先二次验密授权（5 分钟有效）' }
  return { reveal: true }
}

/**
 * 资源级授权：所有通用 CRUD / 导出 / 导入 / 检索接口统一走这里。
 * 前端隐藏菜单只是 UI，真正的边界在服务端；越权尝试同步写入审计日志。
 */
const guardResource = (req, res, resource, action = 'read') => {
  if (assertResource(req.user, resource, action)) return true
  const cfg = RESOURCES[resource]
  store.addOpLog(req.user, '越权访问被拦截', `${action}：${cfg?.label || resource}`)
  fail(res, 403, `当前角色无【${cfg?.label || resource}】的${action === 'read' ? '查看' : '操作'}权限`, 40301)
  return false
}

/** 新增/编辑的服务端业务校验：前端 :required 只是提示，不能作为边界 */
const validateBody = (resource, body) => {
  const cfg = RESOURCES[resource] || {}
  const missing = (cfg.required || []).filter((k) => String(body?.[k] ?? '').trim() === '')
  if (missing.length) return `缺少必填字段：${missing.map((k) => FIELD_LABELS[k] || k).join('、')}`
  // 列表/详情返回的是脱敏副本（含 *），编辑时原样回传不应被当成格式错误
  const plain = (v) => v != null && String(v).trim() !== '' && !String(v).includes('*')
  if (plain(body?.idcard) && !/^\d{17}[\dXx]$/.test(String(body.idcard).trim())) return '身份证号格式不正确（应为 18 位）'
  for (const k of ['phone', 'applicantPhone', 'reporterPhone', 'mobile']) {
    if (plain(body?.[k]) && !/^1\d{10}$/.test(String(body[k]).trim())) return '手机号格式不正确（应为 11 位）'
  }
  if (body?.joinDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.joinDate).trim())) return '入党时间格式应为 YYYY-MM-DD'
  // 防止超长文本打爆存储/FTS 索引与导出（居民端另有更严格的独立校验）
  for (const [k, v] of Object.entries(body || {})) {
    if (typeof v === 'string' && v.length > 4000) return `字段【${FIELD_LABELS[k] || k}】内容过长（上限 4000 字）`
  }
  return null
}
/** 单个导出文件的最大行数：避免 5 万行级全量导出在并发请求下吃满进程内存 */
const MAX_EXPORT_ROWS = Number(process.env.ZHSQ_EXPORT_MAX_ROWS || 50000)

/**
 * V2.6 审计修复：流转 / 撤回 / 退回的文本边界。
 * 这些文本会写入业务字段、进度消息、流转留痕、FTS 索引与 Excel 导出，
 * 此前完全不校验，实测可写入 11200 字 <img onerror> 并原样出现在居民端与导出文件里。
 */
const validateRemark = (value, { minLength = 0, label = '办理意见' } = {}) => {
  if (value == null || value === '') return minLength ? `${label}不能少于 ${minLength} 个字` : null
  if (typeof value !== 'string') return `${label}格式不正确，请提交文本内容`
  const v = value.trim()
  if (v.length < minLength) return `${label}不能少于 ${minLength} 个字`
  if (v.length > REMARK_MAX_LENGTH) return `${label}内容过长（上限 ${REMARK_MAX_LENGTH} 字）`
  if (/[<>]/.test(v)) return `${label}不能包含 < 或 > 等标记字符`
  return null
}

/**
 * 组织 / 网格编码必须指向真实存在的组织或网格。
 * 此前客户端可写 450102999999 这类孤儿编码：能落库但不属于任何下级数据范围，
 * 统计与权限过滤时记录会「凭空消失」，也无法被对应辖区维护。
 * 只在客户端显式提供（或编辑时值发生变化）时校验，不影响历史数据与内部联动写入。
 */
const validateOrgRefs = (req, body, previous = null, creatingKeys = []) => {
  const db = store.getDb()
  const orgSet = new Set(db.orgs.map((o) => String(o.orgCode)))
  const gridSet = new Set(db.grids.map((g) => String(g.gridCode)))
  for (const [key, validSet, label] of [
    ['orgCode', orgSet, '组织编码'], ['gridCode', gridSet, '网格编码']
  ]) {
    if (body?.[key] == null || body[key] === '') continue
    const v = String(body[key]).trim()
    if (previous && String(previous[key] ?? '') === v) continue
    if (!ORG_CODE_RE.test(v)) return `${label}【${v}】格式不正确（应为 6~20 位数字）`
    if (!assertScope(req.user, v)) return `越权操作：${label}【${v}】超出您的数据范围`
    if (creatingKeys.includes(key)) {
      // 新增组织 / 网格时该编码正是要创建的业务键：允许不存在，但不允许重复
      if (validSet.has(v)) return `${label}【${v}】已存在，请勿重复新增`
    } else if (!validSet.has(v)) {
      return `${label}【${v}】不存在，请从组织 / 网格台账中选择有效编码`
    }
  }
  return null
}

/**
 * 受保护字段按资源区分：PROTECTED_FIELDS 里的 role 是为了防止通用 CRUD 改写账号权限角色，
 * 但 persons.role 是业务岗位标签（网格长 / 网格员）。若一并拦截，新增人员永远写不进角色，
 * 网格台账、微站、居民端也就无法区分谁是谁——这是「找不到录入网格员入口」的后端根因之一。
 */
const isProtectedField = (resource, key) =>
  PROTECTED_FIELDS.has(key) && !(resource === 'persons' && key === 'role')

const PERSON_ROLES = ['网格长', '网格员', '社区书记', '街道负责人', '区级负责人', '其他']
/** 人员主数据业务校验：岗位标签限定枚举，避免下拉与列表出现无法归类的自由文本 */
const validatePersonBody = (resource, body) => {
  if (resource !== 'persons' || body?.role == null || String(body.role).trim() === '') return null
  return PERSON_ROLES.includes(String(body.role).trim()) ? null : `人员角色仅支持 ${PERSON_ROLES.join(' / ')}`
}

/**
 * 网格人员引用校验：leaderId / workerIds 必须指向真实存在的人员主数据。
 * 否则手工录入或改绑会留下孤儿 ID，前台会直接把 P00xxx 或 '-' 当成姓名显示，
 * 造成「网格微站」与「网格组织」看起来人员不一致。
 */
const validatePersonRefs = (resource, body) => {
  if (resource !== 'grids') return null
  const ids = new Set(store.getDb().persons.map((p) => String(p.id)))
  const leader = body.leaderId == null ? '' : String(body.leaderId).trim()
  if (leader && !ids.has(leader)) return `网格长【${leader}】不存在于人员主数据，请先在「人员主数据」中新增`
  if (body.workerIds == null) return null
  if (!Array.isArray(body.workerIds)) return '网格员必须是人员 ID 列表'
  if (body.workerIds.length > 20) return '单个网格最多配置 20 名网格员'
  const ws = body.workerIds.map((x) => String(x))
  if (new Set(ws).size !== ws.length) return '网格员不能重复选择同一个人'
  for (const id of ws) if (!ids.has(id)) return `网格员【${id}】不存在于人员主数据，请先在「人员主数据」中新增`
  if (leader && ws.includes(leader)) return '同一个人不能同时担任该网格的网格长和网格员'
  return null
}

/** 居民端公开内容的字段白名单：不暴露 orgCode / readCount / 内部状态等后台字段 */
const pickFields = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] != null).map((k) => [k, o[k]]))
const PUBLIC_MESSAGE_FIELDS = ['id', 'type', 'title', 'content', 'publishTime']
const PUBLIC_CONTENT_FIELDS = ['id', 'type', 'title', 'summary', 'publishTime', 'cover', 'views']
const PUBLIC_LINK_FIELDS = ['id', 'title', 'type', 'url', 'path', 'icon', 'sort']
const publicMessage = (m) => pickFields(m, PUBLIC_MESSAGE_FIELDS)
const publicContent = (c) => pickFields(c, PUBLIC_CONTENT_FIELDS)
const publicLink = (s) => pickFields(s, PUBLIC_LINK_FIELDS)
/** 居民端可见的消息：排除含申请人姓名 / 内部办理意见的进度类消息 */
const isPublicMessage = (m) => m?.status === '已发布' && !RESIDENT_PRIVATE_MESSAGE_RE.test(String(m.type || ''))
/** 居民端进度留痕：只给面向申请人的固定文案，绝不返回内部办理意见原文 */
const publicFlowRemark = (f) => {
  if (f.action === '创建') return '居民通过便民码在线提交'
  if (f.action === '退回') return '申请已退回上一环节，请留意补充材料'
  if (f.action === '撤回') return '工作人员已撤回上一步操作'
  return ''
}

/* ---------------- V2.4 实时通道 / 业务时限公共机制 ---------------- */
/**
 * 写操作事务成功后广播「数据已变化」信号。
 * 推送失败绝不影响业务结果（实时性是增强能力，不能拖垮主流程）；
 * 状态机资源的写操作额外带 todo 主题，让工作台与待办红点即时刷新。
 */
/** orgCode 可传单个编码或编码数组（批量写操作涉及多条不同组织的记录时必须逐条收集） */
const emitChange = (resource, orgCode, ids = [], action = 'write') => {
  try {
    publish({
      resource, orgCode, ids: Array.isArray(ids) ? ids : [ids],
      action, topics: FLOW_BY_RESOURCE[resource] ? ['todo'] : []
    })
  } catch (e) { console.error('[events] publish failed:', e?.message || e) }
}
/**
 * 单条待办的 SLA：以业务上报/提交/告警时刻为起点，未配置起点且无审计时间时不判超期。
 * 返回 { startedAt, slaHours, ageHours, overdue, remainingHours }
 */
const slaInfo = (resource, row, now = Date.now()) => {
  const flowName = FLOW_BY_RESOURCE[resource] || ''
  const slaHours = FLOW_SLA_HOURS[flowName] || 0
  const startedAt = String(row?.[SLA_START_FIELD[resource]] || row?.created_at || row?.updated_at || '')
  const started = stampEpoch(startedAt)
  if (!slaHours || Number.isNaN(started)) {
    return { startedAt: '', slaHours, ageHours: null, overdue: false, remainingHours: null }
  }
  const ageHours = Math.max(0, +((now - started) / 3600000).toFixed(2))
  return {
    startedAt, slaHours, ageHours,
    overdue: ageHours > slaHours,
    remainingHours: +(slaHours - ageHours).toFixed(2)
  }
}

/* ---------------- 认证 / 元信息 ---------------- */
app.post('/api/auth/login', loginLimiter, wrap((req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return bizFail(res, '请输入账号和密码', 40002)
  const u = store.getDb().users.find((x) => x.username === username)
  // 库里只有 scrypt 加盐哈希，明文密码不落库、不比对明文
  if (!u || !verifyPassword(password, u.password)) {
    store.addOpLog({ name: String(username), username: String(username), orgCode: '-' }, '登录失败', '账号或密码错误')
    return bizFail(res, '账号或密码错误', 40002)
  }
  const access = sign(tokenPayloadOf(u), 'access')
  const refresh = sign({ userId: u.id, username: u.username }, 'refresh')
  setRefreshCookie(res, refresh)
  store.addOpLog(u, '登录', `角色：${u.roleName}，数据范围：${u.orgCode}`)
  return ok(res, {
    token: access, user: publicUser(u), menus: visibleMenus(u),
    permissions: store.permissionsForRole(u.role), expiresIn: TTL.access
  })
}))

/** 页面刷新后用 HttpOnly Cookie 中的 refresh 换回 access（前端只在内存持有 access） */
app.post('/api/auth/refresh', wrap((req, res) => {
  const rt = parseCookies(req.headers.cookie).zhsq_refresh
  const payload = verify(rt, 'refresh')
  if (!payload) return fail(res, 401, '会话已过期，请重新登录', 40100)
  const u = store.getDb().users.find((x) => x.id === payload.userId)
  if (!u) return fail(res, 401, '用户不存在', 40101)
  revoke(payload, 'rotate')
  const access = sign(tokenPayloadOf(u), 'access')
  setRefreshCookie(res, sign({ userId: u.id, username: u.username }, 'refresh'))
  return ok(res, { token: access, user: publicUser(u), menus: visibleMenus(u), permissions: store.permissionsForRole(u.role), expiresIn: TTL.access })
}))

app.get('/api/auth/profile', wrap((req, res) => ok(res, {
  user: publicUser(req.user), menus: visibleMenus(req.user), permissions: store.permissionsForRole(req.user.role)
})))

app.post('/api/auth/logout', wrap((req, res) => {
  const rp = verify(parseCookies(req.headers.cookie).zhsq_refresh, 'refresh')
  if (rp) revoke(rp, 'logout')
  if (req.tokenPayload) revoke(req.tokenPayload, 'logout')
  res.clearCookie('zhsq_refresh', { path: '/api/auth' })
  // 只关闭本次会话（access token jti）建立的实时连接；同账号其它页签不受影响
  const closed = closeUser(req.user?.id, req.tokenPayload?.jti)
  store.addOpLog(req.user, '退出登录', `令牌已加入吊销名单，本会话实时连接关闭 ${closed} 个`)
  return ok(res, null, '已退出')
}))

/** 明文查看：重新验密换取 5 分钟授权令牌，全程留痕 */
app.post('/api/auth/sensitive-grant', wrap((req, res) => {
  const { password } = req.body || {}
  if (req.user.orgLevel !== 1) return fail(res, 403, '仅区级管理员可申请明文查看授权', 40300)
  const locked = sensitiveLocked(req)
  if (locked) return fail(res, 429, `密码校验失败次数过多，请 ${locked} 秒后再试`, 42901)
  const u = store.getDb().users.find((x) => x.id === req.user.id)
  if (!u || !verifyPassword(password, u.password)) {
    const fails = noteSensitiveFail(req)
    store.addOpLog(req.user, '明文授权失败', `二次验密未通过（连续第 ${fails} 次）`)
    return bizFail(res, '密码校验失败，授权未通过', 40002)
  }
  // 校验通过即清零：正常查看明文 / 自动化回归不会累积成误锁
  sensitiveFails.delete(sensitiveFailKey(req))
  const token = sign({ userId: u.id, scope: 'sensitive' }, 'sensitive')
  store.addOpLog(req.user, '申请明文查看授权', '二次验密通过，授权 5 分钟')
  return ok(res, { sensitiveToken: token, expiresIn: TTL.sensitive })
}))

app.get('/api/health', wrap((_req, res) => {
  const db = store.getDb(), bulk = store.getBulk()
  return ok(res, {
    status: 'running', port: PORT, generatedAt: db.meta.generatedAt,
    counts: {
      orgs: db.orgs.length, grids: db.grids.length, population: bulk.population.length,
      houses: bulk.houses.length, buildings: bulk.buildings.length, parts: bulk.parts.length,
      partyMembers: db.partyMembers.length, enterprises: db.enterprises.length,
      devices: db.devices.length, alarms: db.alarms.length
    },
    tables: Object.keys(db).length + Object.keys(bulk).length,
    // 生产模式不下发数据库绝对路径等部署细节
    storage: { engine: 'SQLite', ...(SECURE ? {} : { file: process.env.ZHSQ_DB_FILE || 'server/data/zhsq.db' }), ...store.statsInfo() },
    security: {
      mode: SECURE ? 'production' : 'development',
      cors: 'whitelist', csp: 'enabled', rateLimit: 'enabled',
      passwordHash: 'scrypt', fieldEncryption: 'AES-256-GCM',
      token: 'access(2h) + refresh(7d, HttpOnly Cookie) + revocation list',
      keys: keyStatus()
    }
  })
}))

/**
 * SSE 实时通道：走统一 JWT 鉴权，前端以 fetch 流读取（可携带 Authorization 头）。
 * 事件只描述「哪类数据变了」，具体数据仍由原有带鉴权/数据范围的 REST 接口拉取。
 */
app.get('/api/events', wrap((req, res) => {
  if (!req.user) return fail(res, 401, '登录已过期或令牌无效，请重新登录', 40100)
  subscribe(req, res, req.user)
}))

/** 通道诊断（仅计数，不暴露连接身份）：用于回归测试与运维核对是否已真正连上 */
app.get('/api/meta/live', wrap((_req, res) => ok(res, busStats())))

/** 前后端共享的资源元数据：列/表单/必填/状态机/模板的单一事实来源由服务端下发 */
app.get('/api/meta/schema', wrap((req, res) => {
  const resources = {}
  for (const [key, cfg] of Object.entries(RESOURCES)) {
    if (!assertResource(req.user, key)) continue
    const flowName = FLOW_BY_RESOURCE[key] || ''
    resources[key] = {
      label: cfg.label, module: cfg.module, moduleVisible: (ROLE_MODULES[req.user.role] || []).includes(cfg.module),
      primary: cfg.primary || 'id', required: cfg.required || [], search: cfg.search || [],
      orgKey: cfg.orgKey || 'orgCode', sensitive: cfg.sensitive || [], global: !!cfg.global,
      readonly: key === 'flowLogs' || key === 'opLogs',
      flow: flowName, states: flowName ? FLOWS[flowName] : [],
      slaHours: FLOW_SLA_HOURS[flowName] || 0,
      slaStartField: SLA_START_FIELD[key] || '',
      importTemplate: !!IMPORT_TEMPLATES[key],
      fieldLabels: Object.fromEntries(
        [...(cfg.required || []), ...(cfg.search || []), ...(cfg.sensitive || []), 'status', 'version']
          .map((k) => [k, FIELD_LABELS[k] || k])
      )
    }
  }
  return ok(res, {
    version: 'V2.6', generatedAt: localStamp(),
    resourceCount: Object.keys(resources).length, resources,
    flows: FLOWS, sla: FLOW_SLA_HOURS, revokeWindowMinutes: REVOKE_WINDOW_MINUTES,
    returnRoles: RETURN_ROLES, protectedFields: [...PROTECTED_FIELDS],
    // 前端表单据此自动剔除不可直写的字段（状态机字段只能由专用接口写入）
    immutableFields: [...new Set([...PROTECTED_FIELDS, ...FLOW_PROTECTED_FIELDS])]
  })
}))

app.get('/api/dicts', wrap((_req, res) => ok(res, store.getDb().dicts)))

/* FTS5 全文检索：替代 Demo 阶段的内存过滤 / 说明书中的 ElasticSearch 一期方案 */
app.get('/api/search', wrap((req, res) => {
  const { q, resource = '', limit = 50 } = req.query
  const rawQ = String(q || '').trim()
  if (!rawQ) return bizFail(res, '请输入检索关键字')
  if (rawQ.length > SEARCH_KEYWORD_MAX_LENGTH) {
    return bizFail(res, `检索关键字过长（上限 ${SEARCH_KEYWORD_MAX_LENGTH} 字）`, 40002)
  }
  // V2.6：limit 必须显式夹取。此前 limit=-1 会变成 SQL「LIMIT -1」= 不限制，
  // 单次请求实测返回 21784 条全库 FTS 结果（数十 MB），可被用来拖垮进程 / 拖库。
  const n = Number(limit)
  const safeLimit = Number.isFinite(n) && n > 0 ? Math.min(SEARCH_MAX_LIMIT, Math.trunc(n)) : 50
  if (resource && RESOURCES[String(resource)] && !guardResource(req, res, String(resource))) return
  let items = store.fullTextSearch(rawQ, String(resource), safeLimit)
  items = items.filter((x) => {
    const cfg = RESOURCES[x.resource]
    // FTS 索引是全局的，必须同时做模块授权 + 组织前缀两道过滤
    if (!cfg || !assertResource(req.user, x.resource)) return false
    if (cfg.global) return true
    return assertScope(req.user, x[cfg.orgKey || 'orgCode'])
  })
  return ok(res, {
    keyword: rawQ, engine: 'SQLite FTS5(trigram)', total: items.length, limit: safeLimit,
    items: items.map((i) => desensitize(i))
  })
}))
app.get('/api/meta/overview', wrap((req, res) => ok(res, stats.portalStats(req.user))))

/** 统一待办工作台：三类待办按角色模块授权 + 四级数据范围收窄，首页不再用"任意状态前 6 条"冒充待办 */
const TODO_GROUPS = [
  { key: 'events', resource: 'governanceEvents', statuses: ['待派发', '已派发', '处置中'], path: '/service/event', label: '治理万家' },
  { key: 'requests', resource: 'serviceRequests', statuses: ['待受理', '办理中'], path: '/service/request', label: '便民办事' },
  { key: 'alarms', resource: 'alarms', statuses: ['待处置', '处置中'], path: '/sensing', label: '感知告警' }
]
app.get('/api/meta/todo', wrap((req, res) => {
  const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 6))
  const overdueOnly = String(req.query.overdue || '') === '1'
  const now = Date.now()
  const groups = {}, counts = {}, overdue = {}
  for (const g of TODO_GROUPS) {
    if (!assertResource(req.user, g.resource)) {
      groups[g.key] = []; counts[g.key] = 0; overdue[g.key] = 0; continue
    }
    const cfg = RESOURCES[g.resource]
    const all = scopeFilter(store.rows(g.resource), req.user, { orgKey: cfg.orgKey || 'orgCode' })
    const pending = all.filter((r) => g.statuses.includes(r.status))
      .map((r) => ({ row: r, sla: slaInfo(g.resource, r, now) }))
      .sort((a, b) => {
        // 「仅看超期」按超期时长降序：最久未处理的排最前；
        // 常规待办仍按业务提交/上报时间倒序（新单优先）。
        if (overdueOnly) return (b.sla.ageHours ?? 0) - (a.sla.ageHours ?? 0)
        return String(b.row.reportTime || b.row.submitTime || b.row.alarmTime || b.row.time || '')
          .localeCompare(String(a.row.reportTime || a.row.submitTime || a.row.alarmTime || a.row.time || ''))
      })
    counts[g.key] = pending.length
    overdue[g.key] = pending.filter((x) => x.sla.overdue).length
    const visible = overdueOnly ? pending.filter((x) => x.sla.overdue) : pending
    groups[g.key] = visible.slice(0, limit).map(({ row, sla }) => ({
      ...desensitize(row), _group: g.key, _path: g.path, _label: g.label, _sla: sla
    }))
  }
  const overdueTotal = Object.values(overdue).reduce((a, b) => a + b, 0)
  return ok(res, {
    counts, groups, total: Object.values(counts).reduce((a, b) => a + b, 0),
    overdue: { ...overdue, total: overdueTotal },
    statuses: Object.fromEntries(TODO_GROUPS.map((g) => [g.key, g.statuses])),
    filter: { overdue: overdueOnly, sort: overdueOnly ? 'overdue-desc' : 'time-desc' },
    sla: { unit: '小时', byFlow: FLOW_SLA_HOURS, startField: SLA_START_FIELD, note: '以业务提交/上报/告警时刻起算，仅作超期提醒，不自动改变状态' },
    generatedAt: localStamp()
  })
}))
// 正式版已移除 /api/meta/accounts：任何接口都不得下发账号或密码（含哈希）

/* ---------------- 组织树 / 网格 / 主数据联动 ---------------- */
app.get('/api/orgs/tree', wrap((req, res) => {
  const list = scopeFilter(store.getDb().orgs, req.user, { orgKey: 'orgCode' })
  const byCode = new Map()
  list.forEach((o) => byCode.set(o.orgCode, { ...o, children: [] }))
  const roots = []
  list.forEach((o) => {
    const node = byCode.get(o.orgCode)
    const parent = byCode.get(o.parentCode)
    if (parent) parent.children.push(node)
    else roots.push(node)
  })
  return ok(res, roots)
}))

app.get('/api/orgs/options', wrap((req, res) => {
  const level = Number(req.query.level || 0)
  let list = scopeFilter(store.getDb().orgs, req.user, { orgKey: 'orgCode' })
  if (level) list = list.filter((o) => o.orgLevel === level)
  return ok(res, list.map((o) => ({
    label: o.orgName, value: o.orgCode, orgCode: o.orgCode, orgName: o.orgName,
    orgLevel: o.orgLevel, parentCode: o.parentCode, levelName: o.levelName,
    level: o.orgLevel, bounds: o.bounds
  })))
}))

app.get('/api/grids/options', wrap((req, res) => {
  const list = scopeFilter(store.getDb().grids, req.user, { orgKey: 'orgCode' })
  return ok(res, list.map((g) => ({ label: g.gridName, value: g.gridCode, ...g })))
}))

app.get('/api/grids/:code/qr', wrap((req, res) => {
  const g = store.getDb().grids.find((x) => x.gridCode === req.params.code)
  if (!g) return bizFail(res, '网格不存在')
  if (!assertScope(req.user, g.orgCode)) return fail(res, 403, '越权访问：该网格不在您的数据范围内', 40300)
  const url = `${req.protocol}://${req.get('host')}${g.qrUrl}`
  return ok(res, { gridCode: g.gridCode, gridName: g.gridName, url, qrUrl: g.qrUrl })
}))

/* ---------------- 统计接口 ---------------- */
app.get('/api/stats/population', wrap((req, res) => ok(res, stats.populationStats(req.user, req.query.orgCode))))
app.get('/api/stats/buildings', wrap((req, res) => ok(res, stats.buildingStats(req.user, req.query.orgCode))))
app.get('/api/stats/portal', wrap((req, res) => ok(res, stats.portalStats(req.user))))
app.get('/api/stats/screen', wrap((req, res) => {
  if (!assertModule(req.user, 'screen')) return fail(res, 403, '当前角色无决策大屏权限', 40301)
  return ok(res, stats.screenStats(req.user))
}))
app.get('/api/stats/sensing', wrap((req, res) => ok(res, stats.sensingStats(req.user))))
app.get('/api/stats/ops', wrap((req, res) => {
  if (!assertModule(req.user, 'ops')) return fail(res, 403, '运营中心仅区级管理员可见', 40301)
  return ok(res, stats.opsStats(req.user))
}))
app.get('/api/stats/geo', wrap((req, res) => {
  if (!assertModule(req.user, 'geo')) return fail(res, 403, '当前角色无地理平台权限', 40301)
  return ok(res, stats.geoStats(req.user, req.query.layer || '人口', req.query.orgCode || ''))
}))
app.get('/api/stats/building/:id', wrap((req, res) => {
  const d = stats.buildingDetail(req.params.id, req.user)
  if (!d) return bizFail(res, '楼栋不存在或不在数据范围内', 40400)
  return ok(res, d)
}))

/* ---------------- 离线矢量底图（真实行政区边界，合规导入 + 本地渲染） ----------------
 * 不下载 / 不缓存任何在线地图瓦片；真实边界由管理员从自然资源主管部门等合规渠道
 * 获取 GeoJSON 后导入，落在本地磁盘并由前端 ECharts 自绘，断网可用。
 * 导入需登记来源 / 审图号 / 坐标系，服务端做结构、体量、来源三重校验并留痕。*/
const geoUpload = multer({
  storage: multer.memoryStorage(),
  // Shapefile 压缩包 / GeoPackage 体积通常大于 GeoJSON，放宽容器体积；
  // 最终落库的 GeoJSON 仍受 300 区域 / 60000 点 / 属性剥离约束。
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/\.(geojson|json|zip|gpkg)$/i.test(file.originalname)) cb(null, true)
    else cb(new Error('仅支持 .geojson / .json / .zip（Shapefile 打包） / .gpkg 文件'))
  }
})
const canManageBasemap = (req, res) => {
  if (!assertModule(req.user, 'geo')) { fail(res, 403, '当前角色无地理平台权限', 40301); return false }
  if (req.user?.orgLevel !== 1) { fail(res, 403, '仅区级管理员可维护离线底图', 40300); return false }
  return true
}
app.get('/api/geo/basemap', wrap((req, res) => {
  if (!assertModule(req.user, 'geo')) return fail(res, 403, '当前角色无地理平台权限', 40301)
  const b = geoBasemap.loadBasemap()
  // meta=1 仅回元数据，供前端轮询比对版本，避免实时刷新反复传输整份边界数据
  const light = String(req.query.meta || '') === '1'
  return ok(res, {
    enabled: b.enabled, meta: b.meta,
    geojson: light ? null : b.geojson,
    options: { sources: geoBasemap.COMPLIANT_SOURCES, crsOptions: geoBasemap.CRS_OPTIONS }
  })
}))
app.post('/api/geo/basemap/import', geoUpload.single('file'), wrap((req, res) => {
  if (!canManageBasemap(req, res)) return
  if (!req.file) return bizFail(res, '请选择底图文件（表单字段名为 file）', 40010)
  try {
    // .geojson / .json / .zip(Shapefile 或 gpkg) / .gpkg 统一转成 FeatureCollection；
    // 转换过程中已扫描包内文件名、README、图层名、字段名等来源特征。
    const raw = parseBasemapFile(req.file.buffer, req.file.originalname, req.body.nameField)
    // 内容级合规守护：即使把「数据来源」改写为合规渠道、或换个容器，也拒绝 OSM / Geofabrik / ODbL 衍生数据
    geoBasemap.assertCompliantFeatureContent(raw)
    const meta = geoBasemap.assertCompliantSource({
      name: req.body.name, source: req.body.source,
      reviewNo: req.body.reviewNo, crs: req.body.crs || 'GCJ-02'
    })
    const parsed = geoBasemap.validateGeoJSON(raw, req.body.nameField)
    const record = {
      enabled: true,
      meta: {
        ...meta, nameField: parsed.nameField,
        sourceFile: String(req.file.originalname || '').slice(0, 120),
        featureCount: parsed.featureCount, pointCount: parsed.pointCount,
        importedAt: new Date().toISOString(),
        importedBy: req.user.name || req.user.username || '-'
      },
      geojson: parsed.geojson
    }
    geoBasemap.saveBasemap(record)
    store.addOpLog(req.user, '导入离线底图',
      `${meta.name}｜来源 ${meta.source}｜${meta.crs}｜${parsed.featureCount} 个区域${meta.reviewNo ? '｜审图号 ' + meta.reviewNo : ''}`)
    emitChange('grids', req.user.orgCode, [], 'basemap')
    return ok(res, record.meta, '离线底图导入成功')
  } catch (e) {
    return bizFail(res, e.message || '底图校验失败', 40002)
  }
}))
app.delete('/api/geo/basemap', wrap((req, res) => {
  if (!canManageBasemap(req, res)) return
  geoBasemap.clearBasemap()
  store.addOpLog(req.user, '移除离线底图', '已恢复为组织 bounds 示意边界')
  emitChange('grids', req.user.orgCode, [], 'basemap')
  return ok(res, null, '已恢复示意底图')
}))

/* ---------------- 空间查询：框选 / 缓冲区 / 选址评分 ---------------- */
app.post('/api/geo/query', wrap((req, res) => {
  if (!assertModule(req.user, 'geo')) return fail(res, 403, '当前角色无地理平台权限', 40301)
  const { type, bounds, center, radius, layer = '人口', topN = 6 } = req.body || {}
  // V2.6：空间查询参数此前完全不校验，负半径 / 非数组 bounds 会被静默当成「查全部」，
  // 并在 UI 上显示『-999 km 缓冲区』这种误导结果；全部入参先做类型与取值范围校验。
  if (!['box', 'buffer', 'score'].includes(String(type))) {
    return bizFail(res, '查询类型不正确（box / buffer / score）', 40002)
  }
  if (!['人口', '党组织', '建筑', '事件', '企业'].includes(String(layer))) {
    return bizFail(res, '图层不在可选范围内', 40002)
  }
  const finite = (v) => typeof v === 'number' && Number.isFinite(v)
  const count = Number(topN)
  const safeTopN = Number.isFinite(count) && count > 0 ? Math.min(50, Math.trunc(count)) : 6
  let radiusKm = 1
  if (type === 'box') {
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(finite)
      || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
      return bizFail(res, '框选范围需提供 4 个有效数值：[minLng, minLat, maxLng, maxLat]', 40002)
    }
  }
  if (type === 'buffer') {
    if (!Array.isArray(center) || center.length !== 2 || !center.every(finite)) {
      return bizFail(res, '缓冲区中心需提供 [经度, 纬度] 两个数值', 40002)
    }
    radiusKm = Number(radius)
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 50) {
      return bizFail(res, '缓冲区半径应为 0~50 km 的正数', 40002)
    }
  }
  const db = store.getDb()
  const grids = scopeFilter(db.grids, req.user, { orgKey: 'orgCode' })
  const geo = stats.geoStats(req.user, layer)
  const valMap = new Map(geo.values.map((v) => [v.gridCode, v.value]))
  const km = (a, b) => {
    const dx = (a[0] - b[0]) * 102, dy = (a[1] - b[1]) * 111
    return Math.sqrt(dx * dx + dy * dy)
  }
  let hit = grids
  if (type === 'box') {
    hit = grids.filter((g) => g.lng >= bounds[0] && g.lng <= bounds[2] && g.lat >= bounds[1] && g.lat <= bounds[3])
  } else if (type === 'buffer') {
    hit = grids.filter((g) => km([g.lng, g.lat], center) <= radiusKm)
  }
  // 预聚合一次：此前每个网格都对 2 万人口 / 5 万房屋 / 部件做一次全表 filter，
  // 单请求 O(网格 × 全表)，数据上量后必然卡顿。
  const countBy = (list, key) => {
    const m = new Map()
    for (const x of list) {
      const k = String(x?.[key] ?? '')
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }
  const popMap = countBy(store.rows('population'), 'gridCode')
  const entMap = countBy(db.enterprises, 'gridCode')
  const partMap = countBy(store.rows('parts'), 'gridCode')
  const items = hit.map((g) => {
    const p = popMap.get(String(g.gridCode)) || 0
    const ent = entMap.get(String(g.gridCode)) || 0
    const parts = partMap.get(String(g.gridCode)) || 0
    const score = +(Math.min(40, p / 8) + Math.min(30, ent * 6) + Math.min(20, parts / 2) + 10).toFixed(1)
    return {
      gridCode: g.gridCode, name: g.gridName, lng: g.lng, lat: g.lat,
      layerValue: valMap.get(g.gridCode) || 0, population: p, enterprises: ent, parts, score
    }
  })
  if (type === 'score') items.sort((a, b) => b.score - a.score)
  return ok(res, {
    type, layer, total: items.length,
    items: type === 'score' ? items.slice(0, safeTopN) : items.slice(0, 200),
    area: type === 'buffer' ? `${radiusKm} km 缓冲区` : type === 'box' ? '自定义框选范围' : '全区'
  })
}))

/* ---------------- 流转记录 ---------------- */
app.get('/api/flows', wrap((req, res) => {
  // 通用流转台账 /api/flowLogs 仅区级可读；单条留痕按业务模块授权（网格员/社区/街道看本辖区）
  if (!assertModule(req.user, 'service') && !assertModule(req.user, 'sensing')) {
    return fail(res, 403, '当前角色无流转留痕查看权限', 40301)
  }
  const { bizType, bizId } = req.query
  const db = store.getDb()
  let list = db.flowLogs.slice()
  if (bizType) list = list.filter((f) => f.bizType === bizType)
  if (bizId) list = list.filter((f) => f.bizId === bizId)
  // flowLogs 是全局表且历史留痕本身没有 orgCode，按 bizId 反查业务主体后做数据范围过滤，
  // 避免网格员读到全平台 275 条流转记录（含其他街道的事件编号/上报人/处置意见）
  const orgById = new Map()
  for (const r of ['serviceRequests', 'governanceEvents', 'alarms']) {
    for (const row of (db[r] || [])) if (row.id) orgById.set(String(row.id), row.orgCode)
  }
  list = list.filter((f) => {
    const oc = f.orgCode || orgById.get(String(f.bizId || ''))
    return oc ? assertScope(req.user, oc) : req.user?.orgLevel === 1
  })
  return ok(res, list.sort((a, b) => (stampEpoch(a.time) || 0) - (stampEpoch(b.time) || 0) || (Number(a.atMs) || 0) - (Number(b.atMs) || 0)))
}))

/* ---------------- 业务状态机（禁止跳步 + 全程留痕） ---------------- */
/**
 * 单条流转的纯业务实现（不含事务，由调用方决定单条/批量的事务边界）。
 * 返回 { data } 或 { error:{http,code,message} }；批量时一条失败不会中断整批。
 * requestedTo = '__next__' 时自动流转到各自的合法下一状态（批量场景默认行为）。
 */
const applyTransition = (req, resource, id, requestedTo, remark) => {
  const cfg = RESOURCES[resource]
  const flowName = FLOW_BY_RESOURCE[resource]
  if (!cfg || !flowName) return { error: { http: 200, code: 40001, message: '该资源不支持状态流转' } }
  const badRemark = validateRemark(remark)
  if (badRemark) return { error: { http: 200, code: 40002, message: badRemark } }
  if (!assertResource(req.user, resource, 'write')) {
    store.addOpLog(req.user, '越权访问被拦截', `write：${cfg.label}`)
    return { error: { http: 403, code: 40301, message: `当前角色无【${cfg.label}】的操作权限` } }
  }
  const db = store.getDb()
  const row = store.findOne(resource, id, cfg)
  if (!row) return { error: { http: 404, code: 40400, message: '记录不存在或不在数据范围内' } }
  if (!assertScope(req.user, row.orgCode)) return { error: { http: 403, code: 40300, message: '越权操作：该记录不在您的数据范围内' } }
  const states = FLOWS[flowName]
  const cur = states.indexOf(row.status)
  if (cur < 0) return { error: { http: 200, code: 40001, message: `当前状态[${row.status}]不在状态机定义内` } }
  const to = requestedTo === '__next__' ? states[cur + 1] : requestedTo
  const target = states.indexOf(to)
  if (!to) return { error: { http: 200, code: 40901, message: `已是终态[${row.status}]，无可流转的下一状态` } }
  if (target <= cur) {
    return { error: { http: 200, code: 40901, message: `跳步被系统拦截：当前状态[${row.status}]不能流转到[${to}]，合法下一状态为[${states[cur + 1] || '无（已终态）'}]` } }
  }
  if (target !== cur + 1) {
    return { error: { http: 200, code: 40901, message: `跳步被系统拦截：当前状态[${row.status}]不能跨级流转到[${to}]，请先流转至[${states[cur + 1]}]` } }
  }
  // 操作人一律取会话身份，禁止客户端传 operator 伪造流转留痕
  const who = req.user.name
  const prev = row.status
  const now = localStamp()
  const patch = { status: to }

  // 所有联动写入（主记录 + 消息/工单 + 流转留痕 + 审计）由调用方包在同一个 SQLite 事务里
  if (flowName === '办事') {
    if (!row.handler) patch.handler = who
    if (to === '已办结') patch.opinion = remark || '材料齐全，已办结并通知申请人'
    store.insert('messages', {
      id: store.uid('M'), type: '办事进度', title: `【${row.item}】进度更新：${to}`,
      content: `${row.applicant}您好，您提交的申请已进入「${to}」环节。${remark || ''}`,
      gridCode: row.gridCode, orgCode: row.orgCode,
      publishTime: now, readCount: 0, status: '已发布'
    })
  }
  if (flowName === '治理万家') {
    if (to === '已派发' && !row.dispatcher) patch.dispatcher = who
    if (to === '处置中' && !row.handler) patch.handler = who
    if (to === '已办结') patch.result = remark || '现场已处置完毕，居民确认满意'
  }
  if (flowName === '告警') {
    if (!row.handler) patch.handler = who
    if (to === '已处置') patch.handleTime = now
    if (to === '已归档') patch.result = remark || '现场核查无异常，已归档'
    const order = db.workOrders.find((o) => o.alarmId === row.id)
    if (order) store.update('workOrders', order.id, { status: to === '已处置' || to === '已归档' ? '已完成' : '处理中' })
  }
  store.update(resource, id, patch)
  store.insert('flowLogs', {
    id: store.uid('FL'),
    bizType: flowName, bizId: row.id, from: prev, to, operator: who, operatorId: req.user.id, time: now,
    remark: remark || '', orgCode: row.orgCode || '', action: '流转', atMs: Date.now()
  })
  store.addOpLog(req.user, '状态流转', `${flowName} ${row.id}: ${prev} → ${to}`)
  return { data: { id, from: prev, to, flowName, orgCode: row.orgCode || '' } }
}
const sendTransitionError = (res, error) => error.http === 200
  ? bizFail(res, error.message, error.code)
  : fail(res, error.http, error.message, error.code)

app.post('/api/transition', wrap((req, res) => {
  const { resource, id, to, remark } = req.body || {}
  const r = store.transaction(() => applyTransition(req, resource, id, to, remark))
  if (r.error) return sendTransitionError(res, r.error)
  emitChange(resource, r.data.orgCode, [id], 'transition')
  if (r.data.flowName === '办事') emitChange('messages', r.data.orgCode, [], 'transition-message')
  return ok(res, r.data, `流转成功：${r.data.from} → ${r.data.to}`)
}))

/** 批量流转：逐条独立事务，每条都走同一套状态机/组织范围/模块授权校验 */
app.post('/api/transition/batch', wrap((req, res) => {
  const { resource, ids, to = '__next__', remark } = req.body || {}
  if (!Array.isArray(ids) || !ids.length) return bizFail(res, '请先选择要流转的记录')
  if (ids.length > 100) return bizFail(res, `单次批量流转上限 100 条，本次 ${ids.length} 条`)
  const successIds = [], errors = [], successOrgs = new Set()
  for (const rawId of ids) {
    const id = String(rawId)
    try {
      const r = store.transaction(() => applyTransition(req, resource, id, to, remark))
      if (r.error) errors.push({ id, reason: r.error.message })
      else { successIds.push(id); successOrgs.add(String(r.data.orgCode || req.user.orgCode)) }
    } catch (e) { errors.push({ id, reason: e?.message || '流转失败，请刷新后重试' }) }
  }
  store.addOpLog(req.user, '批量流转', `${RESOURCES[resource]?.label || resource} → ${to === '__next__' ? '各记录下一状态' : to}：成功 ${successIds.length} 条，失败 ${errors.length} 条`)
  // 按实际受影响记录的组织编码投递：区级用户批量处理社区数据时，社区订阅者同样要收到信号
  if (successIds.length) emitChange(resource, [...successOrgs], successIds, 'transition-batch')
  return ok(res, {
    success: successIds.length, failed: errors.length, ids: successIds, errors,
    policy: '逐条校验状态机与数据权限；失败条目不影响成功条目'
  }, `批量流转完成：成功 ${successIds.length} 条，失败 ${errors.length} 条`)
}))

/* ---------------- V2.4 业务闭环：撤回本人误操作 / 正式退回上一环节 ----------------
 * 正向状态机仍然严格禁止跳步与回退；回退只能通过这两个专用接口完成，且全部留痕。
 * 撤回 = 本人 + 30 分钟内 + 上一步为正向流转（撤销误操作，原始留痕标记 revokedAt）；
 * 退回 = 区/街/社区管理员 + 必填原因（正式业务回退，另行插入一条退回留痕）。
 */
const applyRollback = (req, resource, id, mode, reason) => {
  const isRevoke = mode === 'revoke'
  const actionName = isRevoke ? '撤回' : '退回'
  const cfg = RESOURCES[resource]
  const flowName = FLOW_BY_RESOURCE[resource]
  if (!cfg || !flowName) return { error: { http: 200, code: 40001, message: '该资源不支持状态回退' } }
  if (!assertResource(req.user, resource, 'write')) {
    store.addOpLog(req.user, '越权访问被拦截', `${actionName}：${cfg.label}`)
    return { error: { http: 403, code: 40301, message: `当前角色无【${cfg.label}】的操作权限` } }
  }
  if (!isRevoke && !RETURN_ROLES.includes(req.user.role)) {
    return { error: { http: 403, code: 40301, message: '退回上一环节仅区级 / 街道 / 社区管理员可操作' } }
  }
  // 回退说明同样会写入进度消息 / 留痕 / 导出：长度、类型与标记字符统一走 validateRemark
  const badReason = validateRemark(reason, { minLength: isRevoke ? 0 : 5, label: isRevoke ? '撤回说明' : '退回原因' })
  if (badReason) return { error: { http: 200, code: 40002, message: badReason } }
  const row = store.findOne(resource, id, cfg)
  if (!row) return { error: { http: 404, code: 40400, message: '记录不存在或不在数据范围内' } }
  if (!assertScope(req.user, row.orgCode)) {
    return { error: { http: 403, code: 40300, message: '越权操作：该记录不在您的数据范围内' } }
  }
  const states = FLOWS[flowName]
  const cur = states.indexOf(row.status)
  if (cur < 0) return { error: { http: 200, code: 40001, message: `当前状态[${row.status}]不在状态机定义内` } }
  if (cur < 1) return { error: { http: 200, code: 40901, message: `当前处于初始状态[${row.status}]，没有可${actionName}的上一步` } }
  if (row.status === '已归档') {
    return { error: { http: 200, code: 40901, message: '已归档记录不可回退，如需更正请重新建单' } }
  }
  const logs = store.rows('flowLogs')
    .filter((f) => String(f.bizId) === String(row.id) && f.bizType === flowName)
    .sort((a, b) => (stampEpoch(a.time) || 0) - (stampEpoch(b.time) || 0) || (Number(a.atMs) || 0) - (Number(b.atMs) || 0))
  const last = logs[logs.length - 1]
  if (!last) return { error: { http: 200, code: 40901, message: '找不到流转留痕，禁止无痕回退' } }
  if (isRevoke) {
    if (['撤回', '退回'].includes(last.action)) {
      return { error: { http: 200, code: 40901, message: '上一步已是撤回 / 退回操作，不可再次撤回' } }
    }
    if (last.revokedAt) return { error: { http: 200, code: 40901, message: '上一步流转已被撤回' } }
    if (last.to !== row.status) {
      return { error: { http: 200, code: 40901, message: '流转留痕与当前状态不一致，请刷新后重试' } }
    }
    // 优先按用户 ID 判定「本人」，避免同名工作人员互相撤回；历史留痕无 ID 时回退按姓名
    const sameActor = last.operatorId
      ? String(last.operatorId) === String(req.user.id)
      : String(last.operator || '') === String(req.user.name || '')
    if (!sameActor) {
      return { error: { http: 200, code: 40302, message: '只能撤回本人发起的上一步流转' } }
    }
    const at = stampEpoch(last.time)
    if (Number.isNaN(at)) return { error: { http: 200, code: 40901, message: '上一步流转时间缺失，无法校验撤回时限' } }
    const minutes = (Date.now() - at) / 60000
    if (minutes > REVOKE_WINDOW_MINUTES) {
      return { error: {
        http: 200, code: 40901,
        message: `超过可撤回时限（${REVOKE_WINDOW_MINUTES} 分钟），如需回退请使用「退回」并填写原因`
      } }
    }
  }

  const prev = states[cur - 1]
  const who = req.user.name
  const now = localStamp()
  const patch = { status: prev }
  // 状态回退后清理由该步流转产生的办理痕迹，避免 UI 出现「待受理却显示办结意见」的脏数据
  const clearFields = prev === states[0]
    ? ['handler', 'dispatcher', 'opinion', 'result', 'handleTime']
    : ['opinion', 'result', 'handleTime']
  for (const k of clearFields) if (k in row) patch[k] = ''
  if (flowName === '告警') {
    const order = store.getDb().workOrders.find((o) => o.alarmId === row.id)
    if (order) store.update('workOrders', order.id, { status: prev === states[0] ? '待处理' : '处理中' })
  }
  if (flowName === '办事' && !isRevoke) {
    store.insert('messages', {
      id: store.uid('M'), type: '办事进度', title: `【${row.item}】进度回退：${prev}`,
      content: `${row.applicant}您好，您的申请已退回「${prev}」环节，原因：${String(reason).trim()}`,
      gridCode: row.gridCode, orgCode: row.orgCode, publishTime: now, readCount: 0, status: '已发布'
    })
  }
  store.update(resource, id, patch)
  // 撤回时在原留痕上打标，不删除任何历史；再追加一条独立的回退留痕
  if (isRevoke && last.id) {
    store.update('flowLogs', last.id, { revokedAt: now, revokedBy: who, revokeReason: String(reason || '').trim() })
  }
  store.insert('flowLogs', {
    id: store.uid('FL'), bizType: flowName, bizId: row.id,
    from: row.status, to: prev, operator: who, operatorId: req.user.id, time: now,
    remark: isRevoke
      ? `撤回上一步流转（${last.from || '创建'} → ${last.to}）${String(reason || '').trim() ? '：' + String(reason).trim() : ''}`
      : `退回原因：${String(reason).trim()}`,
    orgCode: row.orgCode || '', action: actionName, atMs: Date.now()
  })
  store.addOpLog(req.user, `状态${actionName}`, `${flowName} ${row.id}: ${row.status} → ${prev}（${isRevoke ? '本人窗口内' : '填写原因'}）`)
  return { data: { id, from: row.status, to: prev, action: actionName, flowName, orgCode: row.orgCode || '' } }
}

app.post('/api/transition/revoke', wrap((req, res) => {
  const { resource, id, reason } = req.body || {}
  const r = store.transaction(() => applyRollback(req, resource, id, 'revoke', reason))
  if (r.error) return sendTransitionError(res, r.error)
  emitChange(resource, r.data.orgCode, [id], 'revoke')
  return ok(res, r.data, `撤回成功：${r.data.from} → ${r.data.to}（原留痕已标记，全程可追溯）`)
}))

app.post('/api/transition/return', wrap((req, res) => {
  const { resource, id, reason } = req.body || {}
  const r = store.transaction(() => applyRollback(req, resource, id, 'return', reason))
  if (r.error) return sendTransitionError(res, r.error)
  emitChange(resource, r.data.orgCode, [id], 'return')
  if (r.data.flowName === '办事') emitChange('messages', r.data.orgCode, [], 'return-message')
  return ok(res, r.data, `退回成功：${r.data.from} → ${r.data.to}（原因已写入流转留痕）`)
}))

/* ---------------- Excel 模板 / 导入 / 导出 ---------------- */
const sheetFrom = (objects, columns) => {
  const cols = columns || Object.keys(objects[0] || {}).map((key) => ({ key, label: FIELD_LABELS[key] || key }))
  const aoa = [cols.map((c) => c.label), ...objects.map((o) => cols.map((c) => o[c.key] ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = cols.map(() => ({ wch: 20 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '数据')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
const sendXlsx = (res, buffer, filename) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
  res.end(buffer)
}

app.get('/api/import/template', wrap((req, res) => {
  const resource = String(req.query.resource || '')
  const tpl = IMPORT_TEMPLATES[resource]
  // 不再静默返回党员模板：未配置模板的资源必须显式报错，避免下载错模板后整表导入失败
  if (!tpl) return bizFail(res, `资源[${resource || '未指定'}]未配置 Excel 导入模板`, 40401)
  const sample = {}
  tpl.columns.forEach((c) => { sample[c.key] = '' })
  return sendXlsx(res, sheetFrom([sample], tpl.columns), `${tpl.label}.xlsx`)
}))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) cb(null, true)
    else cb(new Error('仅支持 .xlsx / .xls 文件'))
  }
})

/* ---------------- 通用附件 / 图片上传（学习资料富文本编辑器使用） ----------------
 * 仅白名单扩展名入站；落盘文件名用随机十六进制（不保留原文件名，杜绝目录穿越与中文乱码）；
 * 图片 inline、其它文件强制 attachment 下载，避免被浏览器当作 HTML 执行（存储型 XSS 收敛）。*/
const UPLOAD_IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
const UPLOAD_FILE_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip', 'rar', '7z', 'md'])
const UPLOAD_MIME_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
  'application/pdf': 'pdf', 'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt', 'text/csv': 'csv', 'text/markdown': 'md',
  'application/zip': 'zip', 'application/x-rar-compressed': 'rar', 'application/x-7z-compressed': '7z'
}
const UPLOAD_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown', zip: 'application/zip', rar: 'application/x-rar-compressed', '7z': 'application/x-7z-compressed'
}
function uploadExt(name, mimetype, type) {
  const allow = type === 'image' ? UPLOAD_IMAGE_EXT : UPLOAD_FILE_EXT
  const ext = String(name || '').toLowerCase().split('.').pop()
  if (allow.has(ext)) return ext
  const me = UPLOAD_MIME_EXT[mimetype]
  if (me && allow.has(me)) return me
  return null
}
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const type = req.query.type === 'image' ? 'image' : 'file'
      const ext = uploadExt(file.originalname, file.mimetype, type)
      const name = crypto.randomBytes(16).toString('hex') + (ext ? '.' + ext : '')
      cb(null, name)
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const type = req.query.type === 'image' ? 'image' : 'file'
    if (uploadExt(file.originalname, file.mimetype, type)) return cb(null, true)
    cb(new Error(type === 'image'
      ? '仅支持图片（jpg/png/gif/webp/bmp），单文件 ≤20MB'
      : '不支持的文件类型（支持 pdf/doc/docx/xls/xlsx/ppt/pptx/txt/csv/zip/rar/7z/md），单文件 ≤20MB'))
  }
})
app.post('/api/upload', mediaUpload.single('file'), wrap((req, res) => {
  if (!req.file) return bizFail(res, '请上传文件（表单字段名为 file）', 40010)
  const type = req.query.type === 'image' ? 'image' : 'file'
  const ext = String(req.file.originalname).toLowerCase().split('.').pop()
  const allow = type === 'image' ? UPLOAD_IMAGE_EXT : UPLOAD_FILE_EXT
  if (!allow.has(ext)) return bizFail(res, type === 'image' ? '仅支持图片（jpg/png/gif/webp/bmp）' : '不支持的文件类型', 40010)
  return ok(res, {
    url: `/uploads/${req.file.filename}`, name: req.file.originalname, size: req.file.size, type
  }, '上传成功')
}))

/** 正式版：multipart/form-data 上传，服务端流式解析，不再由浏览器把 5 万行塞进 JSON */
app.post('/api/import/:resource', upload.single('file'), wrap((req, res) => {
  const resource = req.params.resource
  const tpl = IMPORT_TEMPLATES[resource]
  if (!tpl || !RESOURCES[resource]) return bizFail(res, '该资源不支持 Excel 导入')
  if (!guardResource(req, res, resource, 'write')) return
  if (!req.file) return bizFail(res, '请上传 Excel 文件（表单字段名为 file）')
  // 用户上传的 Excel 属不可信输入：限制解析行数与工作表数量，防止超大工作簿打满进程内存
  const wb = XLSX.read(req.file.buffer, { type: 'buffer', sheetRows: 50001 })
  if (wb.SheetNames.length > 5) return bizFail(res, 'Excel 工作表数量超过上限（5 个）', 40010)
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  const labelMap = new Map(tpl.columns.map((c) => [c.label, c.key]))
  const headers = (aoa[0] || []).map((h) => labelMap.get(String(h).trim()) || String(h).trim())
  const incoming = aoa.slice(1)
    .filter((r) => r.some((c) => String(c).trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, String(r[i] ?? '').trim()])))
  if (incoming.length > 50000) return bizFail(res, `单次导入上限 50000 行，本次 ${incoming.length} 行，请拆分文件`)
  const db = store.getDb()
  const orgCodes = new Set(db.orgs.map((o) => String(o.orgCode)))
  const gridCodes = new Set(db.grids.map((g) => String(g.gridCode)))
  const orgNameByCode = new Map(db.orgs.map((o) => [String(o.orgCode), o.orgName]))
  const partyOrgIdByCode = new Map(db.partyOrgs.map((o) => [String(o.orgCode), o.id]))
  // V2.6：人口模板和党员模板共用一段构造逻辑，此前无论导入哪个资源都写「正式党员 /
  // 入党时间 / 学历 / 志愿服务学时」这套党员字段，人口数据被写成党员档案（实测可复现）。
  // 现在按资源分别构造符合各自表结构的记录，归属编码也分别按组织 / 网格校验。
  const isPopulation = resource === 'population'
  const errors = []
  const valid = []
  incoming.forEach((r, i) => {
    const rowNo = i + 2
    const issues = []
    if (!String(r.name || '').trim()) issues.push('姓名不能为空')
    if (!/^\d{17}[\dXx]$/.test(String(r.idcard || '').trim())) issues.push('身份证格式不正确（应为18位）')
    if (r.phone && !/^1\d{10}$/.test(String(r.phone).trim())) issues.push('手机号格式不正确')
    // 与手工表单 / 居民端一致：拒绝超长文本与标记字符，避免污染 FTS 索引与导出文件
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'string' && v.length > 4000) { issues.push(`字段【${FIELD_LABELS[k] || k}】内容过长`); break }
      if (typeof v === 'string' && /[<>]/.test(v)) { issues.push('提交内容不能包含 < 或 > 等标记字符'); break }
    }
    if (isPopulation) {
      const gc = String(r.gridCode || '').trim()
      if (!gc) issues.push('网格编码不能为空')
      else if (!gridCodes.has(gc)) issues.push(`网格编码[${gc}]不存在`)
      else if (!assertScope(req.user, gc)) issues.push('该网格编码不在您的数据范围内')
      if (r.age && (!/^\d{1,3}$/.test(String(r.age)) || Number(r.age) > 150)) issues.push('年龄应为 0~150 的整数')
    } else {
      const oc = String(r.orgCode || r.gridCode || '').trim()
      if (!oc) issues.push('所属党组织编码不能为空')
      else if (!orgCodes.has(oc)) issues.push(`组织编码[${oc}]不存在`)
      else if (!assertScope(req.user, oc)) issues.push('该组织编码不在您的数据范围内')
      if (r.joinDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.joinDate))) issues.push('入党时间格式应为 YYYY-MM-DD')
    }
    if (issues.length) errors.push({ row: rowNo, reason: issues.join('；'), name: r.name || '' })
    else valid.push(r)
  })
  if (valid.length) {
    const stamp = localStamp()
    const batch = valid.map((r, i) => {
      const common = {
        name: String(r.name).trim(), idcard: String(r.idcard).trim(), phone: String(r.phone || '').trim()
      }
      if (isPopulation) {
        return {
          ...common, gridCode: String(r.gridCode).trim(),
          type: String(r.type || '户籍').trim(), age: Number(r.age) || 0,
          gender: String(r.gender || '男').trim(), tags: String(r.tags || '').trim(),
          address: String(r.address || '').trim(), importTime: stamp, importNo: i + 1
        }
      }
      const oc = String(r.orgCode || r.gridCode || req.user.orgCode).trim()
      return {
        ...common, orgCode: oc,
        orgName: orgNameByCode.get(oc) || req.user.orgName,
        orgId: partyOrgIdByCode.get(oc) || '',
        joinDate: String(r.joinDate || '').trim(), status: String(r.status || '正式党员').trim(),
        excellent: false, education: '本科', volunteerHours: 0,
        importTime: stamp, importNo: i + 1
      }
    })
    store.transaction(() => {
      store.insertMany(resource, batch)
      store.addOpLog(req.user, 'Excel导入', `${RESOURCES[resource].label}：成功 ${valid.length} 行，失败 ${errors.length} 行（multipart 上传）`)
    })
    emitChange(resource, [...new Set(valid.map((r) => isPopulation
      ? String(r.gridCode) : String(r.orgCode || r.gridCode || req.user.orgCode)))], [], 'import')
  }
  return ok(res, { total: incoming.length, success: valid.length, failed: errors.length, errors, policy: '部分入库：错误行不入库，正确行已写入' })
}))

app.get('/api/export/:resource', wrap((req, res) => {
  const resource = req.params.resource
  const cfg = RESOURCES[resource]
  if (!cfg) return bizFail(res, '不支持导出的资源')
  if (!guardResource(req, res, resource)) return
  const grant = revealGranted(req)
  if (grant.error) {
    store.addOpLog(req.user, '拒绝明文导出', `${cfg.label}：${grant.error}`)
    return fail(res, 403, grant.error, 40303)
  }
  // 先用同一套 SQL 条件做 COUNT，超过上限直接拒绝，避免全表 hydrate + XLSX 生成吃满内存
  const countReq = { ...req, query: { ...req.query, pageNum: 1, pageSize: 1 } }
  const totalRows = store.list(resource, countReq, cfg).total
  if (totalRows > MAX_EXPORT_ROWS) {
    return bizFail(res, `本次导出 ${totalRows} 条，超过单次上限 ${MAX_EXPORT_ROWS} 条；请先按组织/状态筛选后分批导出`, 40002)
  }
  // 与列表共用同一套 SQL 权限/筛选条件；仅授权通过时才在存储层解密
  const filtered = store.query(resource, req, cfg, { reveal: grant.reveal }).records
  const objects = filtered.map((r) => desensitize(r, grant.reveal))
  const keys = Object.keys(objects[0] || {})
    .filter((k) => !['children', 'bounds', 'workerIds', 'importNo', 'importTime', 'version', 'ip', 'userAgent'].includes(k))
  const cols = keys.map((key) => ({ key, label: FIELD_LABELS[key] || key }))
  if (grant.reveal) store.addOpLog(req.user, '查看敏感信息', `${cfg.label}导出：${objects.length} 条明文（二次验密授权）`)
  store.addOpLog(req.user, '数据导出', `${cfg.label}：${objects.length} 条，${grant.reveal ? '明文' : '脱敏'}导出`)
  return sendXlsx(res, sheetFrom(objects.length ? objects : [{}], cols), `${cfg.label}_${localStamp().slice(0, 10)}.xlsx`)
}))

/* ---------------- 居民端 H5（便民码扫码进入，免登录） ---------------- */
const residentGrid = (code) => store.getDb().grids.find((g) => g.gridCode === code)
app.get('/api/resident/home/:gridCode', wrap((req, res) => {
  const db = store.getDb()
  const g = residentGrid(req.params.gridCode)
  if (!g) return bizFail(res, '便民码无效：网格不存在', 40400)
  const person = (id) => db.persons.find((p) => p.id === id)?.name || '-'
  const pop = store.rows('population').filter((p) => p.gridCode === g.gridCode).length
  return ok(res, {
    grid: {
      gridCode: g.gridCode, gridName: g.gridName, parentCode: g.parentCode,
      leader: person(g.leaderId), workers: g.workerIds.map(person),
      partyMemberCount: g.partyMemberCount, populationCount: pop
    },
    community: db.orgs.find((o) => o.orgCode === g.parentCode)?.orgName || '',
    messages: db.messages.filter((m) => isPublicMessage(m) && (m.gridCode === g.gridCode || m.type === '公告'))
      .slice(0, 6).map(publicMessage),
    contents: db.contents.filter((c) => c.status === '已发布').slice(0, 6).map(publicContent),
    shortcuts: db.shortcuts.map(publicLink), recommends: db.recommends.map(publicLink),
    serviceItems: db.dicts.serviceItems, eventTypes: db.dicts.eventTypes
  })
}))
app.get('/api/resident/messages/:gridCode', wrap((req, res) => {
  // V2.6：此前不校验网格是否存在，任意编码都能拿到全部公告与后台字段；
  // 进度类消息还含其它居民姓名与内部办理意见，只能经三要素查询返回给本人。
  if (!residentGrid(req.params.gridCode)) return bizFail(res, '便民码无效：网格不存在', 40400)
  return ok(res, store.getDb().messages
    .filter((m) => isPublicMessage(m) && (m.gridCode === req.params.gridCode || m.type === '公告'))
    .slice(0, 30).map(publicMessage))
}))
/** 免鉴权居民端提交的服务端边界：前端表单校验不构成边界，必须独立做白名单 + 格式 + 长度 + 枚举 */
const RESIDENT_LIMITS = { name: 50, title: 100, item: 100, type: 50, location: 200, description: 2000, phone: 11 }
const validateResidentBody = (req, kind) => {
  const b = req.body || {}
  const fields = kind === 'event'
    ? ['name', 'phone', 'title', 'type', 'location', 'description']
    : ['name', 'phone', 'item', 'description']
  for (const k of fields) {
    const v = b[k]
    if (v == null || v === '') continue
    if (typeof v !== 'string') return `字段【${k}】格式不正确，请提交文本内容`
    if (/[<>]/.test(v)) return '提交内容不能包含 < 或 > 等标记字符'
    if (v.trim().length > RESIDENT_LIMITS[k]) return `内容过长：【${k}】上限 ${RESIDENT_LIMITS[k]} 字`
  }
  if (!/^1\d{10}$/.test(String(b.phone || '').trim())) return '请填写正确的 11 位手机号（用于进度查询）'
  const dicts = store.getDb().dicts
  if (kind === 'event' && b.type && !(dicts.eventTypes || []).includes(String(b.type))) return '事件类型不在可选范围内'
  if (kind === 'request' && b.item && !(dicts.serviceItems || []).includes(String(b.item))) return '办理事项不在可选范围内'
  return null
}
const residentSubmit = (req, res, kind) => {
  const db = store.getDb()
  const g = residentGrid(req.body?.gridCode)
  if (!g) return bizFail(res, '网格编码无效')
  const bad = validateResidentBody(req, kind)
  if (bad) return bizFail(res, bad, 40003)
  const now = localStamp()
  const id = store.nextId(kind === 'event' ? 'governanceEvents' : 'serviceRequests', kind === 'event' ? 'GE' : 'SR')
  const row = kind === 'event' ? {
    id, code: 'ZW' + now.slice(0, 10).replace(/-/g, '') + id.slice(-4),
    type: req.body.type || '其他', title: req.body.title || '居民上报事件',
    reporter: req.body.name || '居民', reporterPhone: req.body.phone || '',
    location: req.body.location || g.gridName, gridCode: g.gridCode, orgCode: g.orgCode,
    status: '待派发', reportTime: now, dispatcher: '', handler: '', result: '',
    photos: 0, description: req.body.description || ''
  } : {
    id, code: 'BS' + now.slice(0, 10).replace(/-/g, '') + id.slice(-4),
    applicant: req.body.name || '居民', applicantPhone: req.body.phone || '',
    item: req.body.item || db.dicts.serviceItems[0], gridCode: g.gridCode, orgCode: g.orgCode,
    status: '待受理', submitTime: now, handler: '', opinion: '', content: req.body.description || ''
  }
  const resource = kind === 'event' ? 'governanceEvents' : 'serviceRequests'
  // 一次性查询码：仅在本次响应中返回给居民，库里只存 HMAC 哈希
  const queryCode = String(crypto.randomInt(100000, 1000000))
  const saved = store.transaction(() => {
    const r = store.insert(resource, row)
    store.issueResidentQuery(id, row.code, queryCode, req.body.phone || '')
    store.insert('flowLogs', {
      id: store.uid('FL'), bizType: kind === 'event' ? '治理万家' : '办事', bizId: id,
      from: '', to: row.status, operator: row.reporter || row.applicant,
      time: now, remark: '居民通过便民码在线提交', action: '创建', orgCode: g.orgCode, atMs: Date.now()
    })
    store.addOpLog({ name: row.reporter || row.applicant, username: '居民端', orgCode: g.orgCode }, '居民端提交', `${row.code} ${row.title || row.item}`)
    return r
  })
  // 居民端提交没有登录会话，按业务记录的组织编码投递给对应辖区的在线值班人员
  emitChange(resource, g.orgCode, [id], 'resident-submit')
  return ok(res, { ...saved, queryCode }, '提交成功，请保存业务编号与查询码用于进度查询')
}
app.post('/api/resident/events', residentLimiter, wrap((req, res) => residentSubmit(req, res, 'event')))
app.post('/api/resident/requests', residentLimiter, wrap((req, res) => residentSubmit(req, res, 'request')))

/** 三要素校验：手机号 + 业务编号 + 一次性查询码；不再仅凭手机号即可查他人进度 */
app.get('/api/resident/progress', residentLimiter, wrap((req, res) => {
  const { phone, bizCode, queryCode } = req.query
  if (!/^1\d{10}$/.test(String(phone || '').trim())) return bizFail(res, '请输入正确的 11 位手机号', 40003)
  if (!String(bizCode || '').trim() || !/^\d{6}$/.test(String(queryCode || '').trim())) {
    return bizFail(res, '请填写业务编号和 6 位查询码（提交成功后一次性显示）', 40003)
  }
  // 6 位查询码可被枚举：按「业务编号 + 来源 IP」计数，连续 5 次失败锁定 10 分钟
  const attemptKey = `${String(bizCode).trim()}:${req.ip || 'unknown'}`
  const remain = store.queryLockRemaining(attemptKey)
  if (remain) return fail(res, 429, `校验失败次数过多，请 ${Math.ceil(remain / 60)} 分钟后重试`, 42901)
  const bizId = store.verifyResidentQuery(String(bizCode).trim(), String(queryCode).trim(), String(phone).trim())
  if (!bizId) {
    const { lockedSeconds } = store.noteQueryFailure(attemptKey)
    store.addOpLog({ name: '居民端', username: '居民端', orgCode: '-' }, '进度查询失败', `三要素校验未通过：${String(bizCode).slice(0, 20)}`)
    if (lockedSeconds) return fail(res, 429, `校验失败次数过多，请 ${Math.ceil(lockedSeconds / 60)} 分钟后重试`, 42901)
    return fail(res, 403, '手机号、业务编号或查询码不正确，无法查询', 40304)
  }
  store.clearQueryAttempts(attemptKey)
  const isRequest = String(bizCode).startsWith('BS')
  const resource = isRequest ? 'serviceRequests' : 'governanceEvents'
  const row = store.findOne(resource, bizId, { ...RESOURCES[resource], global: true })
  const db = store.getDb()
  // 居民端是免鉴权页面：只返回进度展示需要的字段，不外泄内部办理人、组织编码、
  // 办理意见、留痕主键 / 来源 IP 等后台字段（三要素校验通过不等于可读取全量业务档案）
  const PUBLIC_BIZ = ['id', 'code', 'item', 'title', 'type', 'status', 'submitTime', 'reportTime', 'reporter', 'applicant', 'location']
  const pick = (o) => Object.fromEntries(PUBLIC_BIZ.filter((k) => o && o[k] != null).map((k) => [k, o[k]]))
  const flows = db.flowLogs.filter((f) => String(f.bizId) === String(bizId))
    .sort((a, b) => (stampEpoch(a.time) || 0) - (stampEpoch(b.time) || 0) || (Number(a.atMs) || 0) - (Number(b.atMs) || 0))
    .map((f) => ({
      id: f.id, bizType: f.bizType, from: f.from || '', to: f.to || '', time: f.time || '',
      action: f.action || '流转',
      // 内部办理意见 / 核查备注 / 退回原因不外泄，只给面向申请人的固定文案
      remark: publicFlowRemark(f), revokedAt: f.revokedAt || '',
      operator: '工作人员'
    }))
  const item = row ? pick(desensitize(row)) : null
  return ok(res, {
    events: isRequest || !item ? [] : [item], requests: isRequest && item ? [item] : [], flows
  })
}))

/* ---------------- 通用 CRUD（约 30 张业务表，全部走 SQL） ---------------- */
const READONLY = new Set(['flowLogs', 'opLogs'])

/** 删除前的引用完整性校验：单条删除与批量删除共用同一套规则 */
const deletionBlockReason = (resource, row) => {
  const db = store.getDb()
  if (resource === 'partyOrgs') {
    if (db.partyOrgs.some((o) => o.parentId === row.id)) return '删除被拦截：该党组织下存在下级组织'
    if (db.partyMembers.some((m) => m.orgId === row.id)) return '删除被拦截：该党组织下存在关联党员'
  }
  if (resource === 'grids' && store.rawConn()
    .prepare('SELECT 1 FROM t_population WHERE grid_code = ? LIMIT 1').get(row.gridCode)) {
    return '删除被拦截：该网格下存在实有人口数据'
  }
  if (resource === 'orgs' && db.orgs.some((o) => o.parentCode === row.orgCode)) {
    return '删除被拦截：该组织下存在下级组织'
  }
  return null
}

/** 批量删除：逐条做权限/引用完整性校验，单条失败不影响其它条目 */
app.post('/api/bulk-delete/:resource', wrap((req, res, next) => {
  const resource = req.params.resource
  const cfg = RESOURCES[resource]
  if (!cfg) return next()
  if (READONLY.has(resource)) return bizFail(res, '流转/操作日志为系统留痕数据，不可手工删除', 40302)
  if (!guardResource(req, res, resource, 'write')) return
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
  if (!ids.length) return bizFail(res, '请先选择要删除的记录')
  if (ids.length > 100) return bizFail(res, `单次批量删除上限 100 条，本次 ${ids.length} 条`)
  const successIds = [], errors = [], successOrgs = new Set()
  for (const rawId of ids) {
    const id = String(rawId)
    const row = store.findOne(resource, id, cfg)
    if (!row) { errors.push({ id, reason: '记录不存在或不在数据范围内' }); continue }
    if (!cfg.global && !assertScope(req.user, row[cfg.orgKey || 'orgCode'])) {
      errors.push({ id, reason: '越权操作：该记录不在您的数据范围内' }); continue
    }
    const reason = deletionBlockReason(resource, row)
    if (reason) { errors.push({ id, reason }); continue }
    try {
      store.transaction(() => {
        store.remove(resource, id)
        store.addOpLog(req.user, '批量删除', `${cfg.label}：${id} ${row.name || row.title || ''}`)
      })
      successIds.push(id)
      successOrgs.add(String(row.orgCode || row.gridCode || req.user.orgCode))
    } catch (e) { errors.push({ id, reason: e?.message || '删除失败，请刷新后重试' }) }
  }
  if (successIds.length) emitChange(resource, [...successOrgs], successIds, 'bulk-delete')
  return ok(res, { success: successIds.length, failed: errors.length, ids: successIds, errors },
    `批量删除完成：成功 ${successIds.length} 条，失败 ${errors.length} 条`)
}))

/**
 * 党组织党员数 / 党员列表专项支持。
 * 历史问题：partyOrgs.memberCount 是永不更新的冗余字段（新建组织恒为 0，增删党员也不回写），
 * 且党员按 orgId（党组织主键）归属，但「该组织党员」列表曾按 orgCode 过滤，导致父级党委 / 党工委
 * 查不到下级支部的党员、显示 0 人。此处改为：
 *   1) 列表返回时实时聚合「本组织 + 全部下级」的党员数；
 *   2) 提供 /api/party/members 按 orgId 拉取本组织 + 下级的党员（分页、脱敏、数据范围过滤）；
 *   3) 党员新增 / 编辑时由 orgCode 反查并落库 orgId / orgName，避免手工录入的党员缺失归属主键。
 */
// 党员归属以唯一 orgId（党组织主键）为准：党总支与下属支部可能共用社区 orgCode，
// 仅凭 orgCode 反查会有歧义。优先用 orgId 反查 orgCode / orgName；仅当只有 orgCode 时才回退映射。
const applyPartyOrgRef = (body) => {
  const db = store.getDb()
  if (body.orgId != null && String(body.orgId).trim()) {
    const po = db.partyOrgs.find((o) => o.id === String(body.orgId).trim())
    if (po) { body.orgCode = po.orgCode; body.orgName = po.name; return }
  }
  if (body.orgCode != null) {
    const oc = String(body.orgCode).trim()
    const po = db.partyOrgs.find((o) => String(o.orgCode) === oc)
    if (po) { body.orgId = po.id; body.orgName = po.name }
  }
}
const computePartyMemberCounts = () => {
  const db = store.getDb()
  const byId = new Map(db.partyOrgs.map((o) => [o.id, o]))
  const counts = new Map(db.partyOrgs.map((o) => [o.id, 0]))
  for (const m of db.partyMembers) {
    let cur = byId.get(m.orgId)
    while (cur) { counts.set(cur.id, (counts.get(cur.id) || 0) + 1); cur = cur.parentId ? byId.get(cur.parentId) : null }
  }
  return counts
}
app.get('/api/party/members', wrap((req, res) => {
  if (!assertResource(req.user, 'partyMembers')) return fail(res, 403, '当前角色无党组织 / 党员权限', 40301)
  const db = store.getDb()
  const orgId = String(req.query.orgId || '')
  const org = db.partyOrgs.find((o) => o.id === orgId)
  if (!org) return fail(res, 404, '组织不存在', 40400)
  // 收集本组织 + 全部下级组织的 id（党组织树可能多级）
  const childrenOf = new Map()
  for (const o of db.partyOrgs) {
    if (o.parentId) { if (!childrenOf.has(o.parentId)) childrenOf.set(o.parentId, []); childrenOf.get(o.parentId).push(o.id) }
  }
  const ids = [orgId]; const stack = [orgId]
  while (stack.length) { const cur = stack.pop(); for (const c of (childrenOf.get(cur) || [])) { ids.push(c); stack.push(c) } }
  const set = new Set(ids)
  let members = db.partyMembers.filter((m) => set.has(m.orgId))
  members = scopeFilter(members, req.user, { orgKey: 'orgCode' })
  const total = members.length
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20))
  const records = members.slice((page - 1) * pageSize, page * pageSize).map((m) => desensitize(m, false))
  return ok(res, { total, page, pageSize, records })
}))

app.get('/api/:resource', wrap((req, res, next) => {
  const resource = req.params.resource
  const cfg = RESOURCES[resource]
  if (!cfg) return next()
  if (!guardResource(req, res, resource)) return
  const grant = revealGranted(req)
  if (grant.error) {
    store.addOpLog(req.user, '拒绝明文查看', `${cfg.label}列表：${grant.error}`)
    return fail(res, 403, grant.error, 40303)
  }
  // 权限前缀、关键词、字段筛选、排序、分页全部下推到 SQL，不再全表捞进内存
  const result = store.list(resource, req, cfg, { reveal: grant.reveal })
  if (grant.reveal) store.addOpLog(req.user, '查看敏感信息', `${cfg.label}列表：${result.total} 条明文（二次验密授权）`)
  // 党组织列表：memberCount 实时聚合「本组织 + 全部下级」，避免显示陈旧的 0
  if (resource === 'partyOrgs') {
    const counts = computePartyMemberCounts()
    result.records = result.records.map((r) => ({ ...r, memberCount: counts.get(r.id) || 0 }))
  }
  result.records = result.records.map((r) => desensitize(r, grant.reveal))
  return ok(res, result)
}))

app.get('/api/:resource/:id', wrap((req, res, next) => {
  const resource = req.params.resource
  const cfg = RESOURCES[resource]
  if (!cfg) return next()
  if (!guardResource(req, res, resource)) return
  const grant = revealGranted(req)
  if (grant.error) return fail(res, 403, grant.error, 40303)
  // findOne 内部已按请求上下文做组织前缀校验，这里是第二道显式防线
  const row = store.findOne(resource, req.params.id, cfg, { reveal: grant.reveal })
  if (!row) return fail(res, 404, '记录不存在或不在数据范围内', 40400)
  if (!cfg.global && !assertScope(req.user, row[cfg.orgKey || 'orgCode'])) return fail(res, 403, '越权访问：该记录不在您的数据范围内', 40300)
  return ok(res, desensitize(row, grant.reveal))
}))

app.post('/api/:resource', wrap((req, res, next) => {
  const resource = req.params.resource
  const cfg = RESOURCES[resource]
  if (!cfg) return next()
  if (READONLY.has(resource)) return bizFail(res, '流转/操作日志为系统留痕数据，不可手工写入', 40302)
  if (!guardResource(req, res, resource, 'write')) return
  const body = { ...(req.body || {}) }
  // 受保护字段绝不接受客户端注入（密码 / 账号权限角色 / 层级 / 密文列等）。
  // persons.role 是业务岗位标签（网格长 / 网格员），按资源豁免，否则永远无法录入人员角色。
  for (const k of PROTECTED_FIELDS) if (isProtectedField(resource, k)) delete body[k]
  const flowName = FLOW_BY_RESOURCE[resource]
  if (flowName) {
    const initial = FLOW_INITIAL_STATUS[resource]
    // 状态机资源：新建只能是初始状态；办理痕迹一律由流转接口生成，杜绝「一步办结且零留痕」
    if (String(req.body?.status ?? initial) !== initial) {
      return bizFail(res, `新建【${cfg.label}】的初始状态固定为「${initial}」，状态变更请使用流转 / 撤回 / 退回`, 40002)
    }
    for (const k of FLOW_PROTECTED_FIELDS) delete body[k]
    body.status = initial
    const startField = SLA_START_FIELD[resource]
    if (startField && !String(body[startField] || '').trim()) body[startField] = localStamp()
  }
  // 党员按 orgId（党组织主键）归属；手工新增只传 orgCode，须反查并落库 orgId / orgName，
  // 否则该党员无法被党组织树汇总计数、也无法按组织查询到。
  if (resource === 'partyMembers') applyPartyOrgRef(body)
  // 学习资料正文以 HTML 入库，落库前净化，收敛存储型 XSS
  if (resource === 'learnings' && body.content != null) body.content = sanitizeRichText(String(body.content))
  const invalid = validateBody(resource, body) || validatePersonBody(resource, body)
  if (invalid) return bizFail(res, invalid, 40002)
  const oc = body.orgCode || body.gridCode || req.user.orgCode
  if (!assertScope(req.user, oc)) return fail(res, 403, '越权操作：新增数据的组织范围超出权限', 40300)
  const primary = cfg.primary || 'id'
  // orgs 以 orgCode 为自然主键；grids 以 id 为主键但新增时 gridCode 也是新创建的业务编码。
  // 两类「待创建编码」都只需校验格式 / 范围 / 不重复，不要求已存在于台账。
  const creatingKeys = primary !== 'id' ? [primary] : []
  if (resource === 'grids') creatingKeys.push('gridCode')
  const refError = validateOrgRefs(req, body, null, creatingKeys)
  if (refError) return bizFail(res, refError, 40002)
  // 手工新增网格不会带 workerIds，补空数组，避免微站/网格台账渲染时 .map of undefined
  if (resource === 'grids' && !Array.isArray(body.workerIds)) body.workerIds = []
  const personRefError = validatePersonRefs(resource, body)
  if (personRefError) return bizFail(res, personRefError, 40002)
  // V2.6：orgs / grids 以自然键为主键，不能生成合成 id 写进业务对象，
  // 否则 SQL 主键与 GET/PUT/DELETE 使用的 orgCode/gridCode 不一致，新记录变成不可维护的幽灵数据。
  const newId = primary === 'id'
    ? store.nextId(resource, resource.slice(0, 2).toUpperCase())
    : String(body[primary] ?? '')
  const payload = { ...body }
  if (primary === 'id') payload.id = newId
  else delete payload.id
  const saved = store.transaction(() => {
    const r = store.insert(resource, payload)
    store.addOpLog(req.user, '新增', `${cfg.label}：${newId} ${body.name || body.title || ''}`)
    return r
  })
  emitChange(resource, saved?.orgCode || saved?.gridCode || req.user.orgCode, [newId], 'create')
  return ok(res, saved, '新增成功')
}))

app.put('/api/:resource/:id', wrap((req, res, next) => {
  const resource = req.params.resource
  const cfg = RESOURCES[resource]
  if (!cfg) return next()
  if (READONLY.has(resource)) return bizFail(res, '流转/操作日志为系统留痕数据，不可修改', 40302)
  if (!guardResource(req, res, resource, 'write')) return
  const old = store.findOne(resource, req.params.id, cfg)
  if (!old) return fail(res, 404, '记录不存在或不在数据范围内', 40400)
  if (!cfg.global && !assertScope(req.user, old[cfg.orgKey || 'orgCode'])) return fail(res, 403, '越权操作：该记录不在您的数据范围内', 40300)

  const raw = { ...(req.body || {}) }
  const clientVersion = raw.version
  const patch = {}
  for (const [k, v] of Object.entries(raw)) if (!isProtectedField(resource, k)) patch[k] = v
  // 编辑态同样锁死状态机字段：字段值有变化就明确拒绝，避免「改了却没生效」的静默兜底
  if (FLOW_BY_RESOURCE[resource]) {
    for (const k of FLOW_PROTECTED_FIELDS) {
      if (patch[k] !== undefined && String(patch[k] ?? '') !== String(old[k] ?? '')) {
        return bizFail(res, `【${FIELD_LABELS[k] || k}】由业务状态机统一管理，请通过流转 / 撤回 / 退回操作变更`, 40002)
      }
      delete patch[k]
    }
  }

  // 主键不可改：orgs 以 orgCode、grids 以 gridCode 为主键，改动会让 SQL 命中 0 行却污染缓存/索引
  const primary = cfg.primary || 'id'
  if (primary !== 'id' && patch[primary] != null && String(patch[primary]) !== String(old[primary])) {
    return fail(res, 403, `不允许修改主键字段【${primary}】，如需调整请联系区级管理员`, 40305)
  }
  // grids 的 SQL 主键是 id，但 gridCode 是人口 / 房屋 / 便民码的关联键，
  // 前端已置灰，后端必须同样拦截，避免直接调 API 改码后整条数据链断裂。
  if (resource === 'grids' && patch.gridCode != null && String(patch.gridCode) !== String(old.gridCode)) {
    return fail(res, 403, '不允许修改网格编码（人口 / 房屋 / 便民码的关联键），如需调整请新建网格并迁移数据', 40305)
  }
  // 组织/网格编码若变更，新值必须仍在当前用户数据范围内（防止把数据移出管辖范围或越权挂靠）
  for (const k of ['orgCode', 'gridCode']) {
    if (patch[k] != null && String(patch[k]) !== String(old[k]) && !assertScope(req.user, String(patch[k]))) {
      return fail(res, 403, `越权操作：修改后的${k}超出您的数据范围`, 40300)
    }
  }
  // 仍在数据范围内的编码也必须是真实存在的组织 / 网格，避免写出无法被任何辖区查询的孤儿记录
  const refError = validateOrgRefs(req, patch, old)
  if (refError) return bizFail(res, refError, 40002)
  // 网格改绑人员时按「旧记录 + 本次补丁」合并校验，避免只传 workerIds 就绕过网格长冲突判断
  const personRefError = validatePersonRefs(resource, { ...old, ...patch })
  if (personRefError) return bizFail(res, personRefError, 40002)
  // 党员变更所属党组织编码时，同步更新归属主键 orgId / orgName
  if (resource === 'partyMembers') applyPartyOrgRef(patch)
  // 学习资料正文以 HTML 入库，落库前净化，收敛存储型 XSS
  if (resource === 'learnings' && patch.content != null) patch.content = sanitizeRichText(String(patch.content))
  const invalid = validateBody(resource, { ...old, ...patch })
    || validatePersonBody(resource, { ...old, ...patch })
  if (invalid) return bizFail(res, invalid, 40002)

  // 乐观锁：优先使用前端回传的版本；兼容旧客户端时退回服务端现读
  const expectedVersion = clientVersion != null ? clientVersion : store.versionOf(resource, req.params.id)
  const merged = store.transaction(() => {
    const m = store.update(resource, req.params.id, patch, { expectedVersion })
    store.addOpLog(req.user, '编辑', `${cfg.label}：${req.params.id} ${old.name || old.title || ''}`)
    return m
  })
  emitChange(resource, merged?.orgCode || merged?.gridCode || old.orgCode || old.gridCode, [req.params.id], 'update')
  return ok(res, merged, '保存成功（组织/人员主数据全局联动）')
}))

app.delete('/api/:resource/:id', wrap((req, res, next) => {
  const resource = req.params.resource
  const cfg = RESOURCES[resource]
  if (!cfg) return next()
  if (READONLY.has(resource)) return bizFail(res, '流转/操作日志为系统留痕数据，不可删除', 40302)
  if (!guardResource(req, res, resource, 'write')) return
  const row = store.findOne(resource, req.params.id, cfg)
  if (!row) return fail(res, 404, '记录不存在或不在数据范围内', 40400)
  if (!cfg.global && !assertScope(req.user, row[cfg.orgKey || 'orgCode'])) return fail(res, 403, '越权操作：该记录不在您的数据范围内', 40300)
  // 删除前关联校验（F2-1 / F3-1），与批量删除共用同一套规则
  const reason = deletionBlockReason(resource, row)
  if (reason) return bizFail(res, reason, 40902)
  store.transaction(() => {
    store.remove(resource, req.params.id)
    store.addOpLog(req.user, '删除', `${cfg.label}：${req.params.id} ${row.name || row.title || ''}`)
  })
  emitChange(resource, row.orgCode || row.gridCode, [req.params.id], 'delete')
  return ok(res, null, '删除成功')
}))

/* ---------------- 上传文件托管（学习资料图片 / 附件） ----------------
 * 仅按纯文件名取文件：拒绝任何路径分隔与 .. 穿越；非图片强制下载，
 * 图片 inline；统一 nosniff，避免被当作 HTML 执行（存储型 XSS 收敛）。*/
app.get('/uploads/:name', (req, res) => {
  const name = req.params.name
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) return res.status(400).send('invalid filename')
  const fp = path.join(UPLOAD_DIR, name)
  if (fp !== UPLOAD_DIR && !fp.startsWith(UPLOAD_DIR + path.sep)) return res.status(400).send('invalid path')
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return res.status(404).send('not found')
  const ext = name.toLowerCase().split('.').pop()
  const isImage = UPLOAD_IMAGE_EXT.has(ext)
  res.setHeader('Content-Type', UPLOAD_MIME[ext] || 'application/octet-stream')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Disposition', `${isImage ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`)
  fs.createReadStream(fp).pipe(res)
})

/* ---------------- 静态资源 & SPA fallback ---------------- */
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return fail(res, 404, '接口不存在', 40400)
    res.sendFile(path.join(DIST, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => res.send('<h2>前端尚未构建，请先执行 npm run build，或使用 npm run dev:web 启动开发服务（5182）</h2>'))
}

/* ---------------- 全局异常收口 ---------------- */
app.use((err, req, res, _next) => {
  console.error(`[error] ${req.method} ${req.originalUrl}`, err)
  if (res.headersSent) return
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ code: 41300, message: '上传文件超过大小限制（Excel 20MB / 离线底图 60MB）', data: null })
  if (/仅支持|Excel 文件|不支持的文件类型/.test(err?.message || '')) return res.status(400).json({ code: 40010, message: err.message, data: null })
  if (err?.code === 40903) return res.status(409).json({ code: 40903, message: err.message, data: null })
  const detail = SECURE ? '系统异常，请联系管理员' : ('系统异常：' + (err.message || '未知错误'))
  res.status(500).json({ code: 50000, message: detail, data: null })
})

// 未捕获异常意味着进程状态已不可信：记录后立即退出，由容器 restart 策略 / 进程管理器拉起，
// 避免「只打日志继续跑」在半损坏状态下继续写入业务数据。
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', e); process.exit(1) })
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', e); process.exit(1) })

/* ---------------- 启动：生产可启用 TLS，或由 Nginx 终止 ---------------- */
let server = http.createServer(app)
let protocol = 'http'
if (process.env.ZHSQ_TLS_CERT && process.env.ZHSQ_TLS_KEY) {
  server = https.createServer({
    cert: fs.readFileSync(path.resolve(process.env.ZHSQ_TLS_CERT)),
    key: fs.readFileSync(path.resolve(process.env.ZHSQ_TLS_KEY))
  }, app)
  protocol = 'https'
}
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  智慧社区治理平台 · ${SECURE ? '生产模式' : '开发模式'} 已启动`)
  console.log(`  管理端 / 居民端 / API : ${protocol}://localhost:${PORT}`)
  console.log(`  健康检查             : ${protocol}://localhost:${PORT}/api/health`)
  console.log(`  安全配置             : CORS 白名单 / CSP / 限流 / 密码加盐 / 字段加密 / 令牌吊销`)
  if (!SECURE) console.log('  ⚠ 开发模式使用本地随机密钥；生产部署请设置 NODE_ENV=production 并注入 ZHSQ_* 密钥环境变量\n')
})
