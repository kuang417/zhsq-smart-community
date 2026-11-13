/**
 * 公共机制：JWT 鉴权、统一响应体、四级数据权限、脱敏、通用过滤分页
 * 说明书 2.3 / 3.3-(1)(2) / 3.4 / 4.2-F2-8
 */
import { ROLE_MODULES, RESOURCES } from './config.js'
import { mask } from './crypto.js'

// 令牌签发/校验统一由 auth.js 承担（密钥外置 + jti + 吊销名单）；此处仅做兼容转发
export { sign as signToken, verify as verifyToken } from './auth.js'

export const ok = (res, data = null, message = 'success') => res.json({ code: 0, message, data })
export const fail = (res, status, message, code = status * 100) => res.status(status).json({ code, message, data: null })
export const bizFail = (res, message, code = 40001) => res.json({ code, message, data: null })

/** 统一异常收口 */
export function wrap(fn) {
  return (req, res, next) => {
    try {
      const r = fn(req, res, next)
      if (r && typeof r.catch === 'function') r.catch((e) => next(e))
    } catch (e) { next(e) }
  }
}

/* ---------------- 敏感信息脱敏（展示层二次防护；存储层已加密） ---------------- */
export const SENSITIVE_KEYS = ['idcard', 'idCard', 'phone', 'contact', 'applicantPhone', 'reporterPhone', 'mobile']
export const maskValue = (key, value) => mask(key, value)
export function desensitize(obj, reveal = false) {
  if (reveal || !obj || typeof obj !== 'object') return obj
  const o = { ...obj }
  for (const k of SENSITIVE_KEYS) if (o[k]) o[k] = mask(k, o[k])
  return o
}

/* ---------------- 四级数据权限（组织编码前缀过滤） ---------------- */
export function inScope(user, orgCode, orgKey = 'orgCode') {
  if (!user) return true
  if (user.orgLevel === 1) return true
  return String(orgCode || '').startsWith(String(user.orgCode))
}
export function scopeFilter(list, user, cfg, extraOrgCode) {
  if (!user || cfg?.global) return list
  const key = cfg?.orgKey || 'orgCode'
  let arr = list.filter((r) => String(r[key] || '').startsWith(String(user.orgCode)))
  // 显式指定 orgCode 时进一步收窄（用于地图下钻、网格筛选）
  if (extraOrgCode && String(extraOrgCode).startsWith(String(user.orgCode))) {
    arr = arr.filter((r) => String(r[key] || '').startsWith(String(extraOrgCode)))
  } else if (extraOrgCode) {
    arr = []
  }
  return arr
}
export function assertScope(user, orgCode) {
  if (!user) return true
  return inScope(user, orgCode)
}
export function assertModule(user, moduleKey) {
  if (!user) return false
  return (ROLE_MODULES[user.role] || []).includes(moduleKey)
}

/* ---------------- 通用查询：关键字 / 等值 / 前缀 / 分页 ---------------- */
const RESERVED = new Set(['pageNum', 'pageSize', 'keyword', 'orgCode', 'reveal', 'sortField', 'sortOrder', '_t', 'exportAll', 'gridCode'])
export function queryRows(rows, req, cfg = {}) {
  const q = req.query || {}
  let arr = scopeFilter(rows, req.user, cfg, q.orgCode || q.gridCode)
  const kw = String(q.keyword || '').trim().toLowerCase()
  if (kw) {
    const fields = cfg.search || Object.keys(rows[0] || {})
    arr = arr.filter((r) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(kw)))
  }
  for (const [k, v] of Object.entries(q)) {
    if (RESERVED.has(k) || v === '' || v == null) continue
    if (Array.isArray(v)) continue
    const val = String(v)
    arr = arr.filter((r) => {
      const cell = r[k]
      if (cell === undefined) return false
      if (typeof cell === 'number') return String(cell) === val
      if (k.toLowerCase().includes('code')) return String(cell).startsWith(val)
      return String(cell).includes(val)
    })
  }
  if (q.sortField) {
    const f = q.sortField, dir = q.sortOrder === 'asc' ? 1 : -1
    arr = arr.slice().sort((a, b) => String(a[f] ?? '').localeCompare(String(b[f] ?? ''), 'zh-CN') * dir)
  }
  return arr
}
export function paginate(arr, q) {
  const pageNum = Math.max(1, parseInt(q.pageNum, 10) || 1)
  const pageSize = Math.min(500, Math.max(1, parseInt(q.pageSize, 10) || 20))
  return { total: arr.length, records: arr.slice((pageNum - 1) * pageSize, pageNum * pageSize), pageNum, pageSize }
}

export function resourceCfg(resource) {
  return RESOURCES[resource] || null
}

/* ---------------- 富文本清洗（存储型 XSS 收敛） ----------------
 * 学习资料 content 以 HTML 形式入库并经 v-html 渲染；对不可信的编辑结果做入库前净化，
 * 仅保留排版标签与安全媒体（图片 / 链接），剥离 script/iframe 与 on* 事件、危险协议，
 * 与平台等保「不可信输入入库前净化」要求一致。纯正则方案，Node 与浏览器行为一致、零依赖。*/
const ALLOWED_RICHTEXT_TAGS = new Set([
  'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'blockquote',
  'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'code', 'pre',
  'a', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption'
])
const RICHTEXT_ATTRS = new Set(['href', 'src', 'alt', 'title', 'target', 'rel', 'width', 'height', 'class'])
const SAFE_URL_RE = /^(https?:\/\/|\/|data:image\/(png|jpe?g|gif|webp);base64,)/i
export function sanitizeRichText(html) {
  if (!html || typeof html !== 'string') return ''
  let out = html
  // 整段移除可执行 / 可嵌套的外部资源标签（含其内容与闭合）
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|noscript)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select|noscript)\b[^>]*>/gi, '')
  // 移除所有事件处理器属性（onclick=… 等）
  out = out.replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
  out = out.replace(/\son\w+\s*=\s*'[^']*'/gi, '')
  out = out.replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
  // 仅保留白名单标签，过滤其它标签（保留其内部文本）与非白名单 / 危险属性
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (m, slash, tag, attrs) => {
    const t = tag.toLowerCase()
    if (!ALLOWED_RICHTEXT_TAGS.has(t)) return ''
    const cleaned = attrs
      .replace(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g, (mm, name, val) => {
        const n = name.toLowerCase()
        if (!RICHTEXT_ATTRS.has(n)) return ''
        if ((n === 'href' || n === 'src') && !SAFE_URL_RE.test(val)) return ''
        return mm
      })
      .replace(/([a-zA-Z-]+)\s*=\s*'([^']*)'/g, (mm, name, val) => {
        const n = name.toLowerCase()
        if (!RICHTEXT_ATTRS.has(n)) return ''
        if ((n === 'href' || n === 'src') && !SAFE_URL_RE.test(val)) return ''
        return mm
      })
    return `<${slash}${t}${cleaned}>`
  })
  return out
}
