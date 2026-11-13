/**
 * 密码哈希 / 字段级加密 / 可检索索引 / 脱敏（正式版）
 *
 * - 密码：scrypt 加盐 + timingSafeEqual 比对，库里绝不存明文
 * - 敏感字段：AES-256-GCM 加密存 secure 列；data 中只保留脱敏副本用于展示与模糊检索
 * - 精确匹配：HMAC-SHA256 索引存 sec_idx 列（不可逆，支持按完整身份证/手机号查询）
 * - 密钥：统一由 keys.js 管理，生产必须环境变量注入
 */
import crypto from 'node:crypto'
import { keyOf } from './keys.js'

export const SENSITIVE_FIELDS = ['idcard', 'idCard', 'phone', 'contact', 'applicantPhone', 'reporterPhone', 'mobile']
const isSensitive = (k) => SENSITIVE_FIELDS.includes(k)

/* ---------------- 密码 ---------------- */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(plain), salt, 32)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}
export function isPasswordHash(v) { return /^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(String(v || '')) }
export function verifyPassword(plain, stored) {
  try {
    const [alg, salt, hash] = String(stored || '').split('$')
    if (alg !== 'scrypt' || !salt || !hash) return false
    const a = crypto.scryptSync(String(plain), Buffer.from(salt, 'base64url'), 32)
    const b = Buffer.from(hash, 'base64url')
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch { return false }
}

/* ---------------- 字段加密 ---------------- */
export function encryptValue(plain) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keyOf('data'), iv)
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`
}
export function decryptValue(token) {
  const [v, iv, tag, ct] = String(token || '').split('.')
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('密文格式不正确')
  const d = crypto.createDecipheriv('aes-256-gcm', keyOf('data'), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
}

/** 不可逆精确匹配索引；空值返回空串 */
export function hIndex(value) {
  if (value == null || String(value).trim() === '') return ''
  return crypto.createHmac('sha256', keyOf('index')).update(String(value).trim()).digest('hex').slice(0, 32)
}

export function mask(key, value) {
  if (value == null || value === '') return value
  const s = String(value)
  if (s.includes('*')) return s                       // 已脱敏，保持幂等
  if (key === 'idcard' || key === 'idCard') return s.length < 8 ? '****' : s.slice(0, 4) + '**********' + s.slice(-4)
  return s.length < 7 ? '****' : s.slice(0, 3) + '****' + s.slice(-4)
}

/**
 * 把明文对象密封为入库形态。
 * @returns {{data: object, secure: string|null, secIdx: string|null}}
 *          data 中敏感字段已替换为脱敏副本；prev 用于更新时保留未改动字段的原密文。
 */
export function seal(obj, prev = {}) {
  const data = { ...(obj || {}) }
  const secure = { ...(prev.secure || {}) }
  const idx = { ...(prev.idx || {}) }
  for (const k of SENSITIVE_FIELDS) {
    const v = data[k]
    if (v == null || v === '') continue
    const s = String(v)
    if (s.includes('*')) { data[k] = s; continue }   // 前端回传的是脱敏值，不覆盖原密文
    secure[k] = encryptValue(s)
    idx[k] = hIndex(s)
    data[k] = mask(k, s)
  }
  return {
    data,
    secure: Object.keys(secure).length ? JSON.stringify(secure) : null,
    secIdx: Object.keys(idx).length ? JSON.stringify(idx) : null
  }
}

/** 只有持有敏感授权时才把密文还原进对象 */
export function unseal(data, secure, reveal) {
  if (!reveal || !secure || !data) return data
  try {
    const plain = JSON.parse(secure)
    const out = { ...data }
    for (const [k, v] of Object.entries(plain)) out[k] = decryptValue(v)
    return out
  } catch { return data }
}

export { isSensitive }
