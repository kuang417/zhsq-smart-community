/**
 * 令牌与边界防护（正式版）
 *
 * - JWT HS256，密钥由 keys.js 注入；载荷带 jti / typ / iat / exp
 * - access 2 小时、refresh 7 天、sensitive 授权 5 分钟，按 typ 校验用途
 * - 吊销名单落 SQLite，logout / 改密后即时失效，过期记录自动清理
 * - 内存滑动窗口限流（单机 SQLite 部署足够；多实例时换 Redis）
 */
import crypto from 'node:crypto'
import { keyOf } from './keys.js'
import * as S from './sqlite.js'
import { localStamp } from './time.js'

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const sig = (s) => crypto.createHmac('sha256', keyOf('jwt')).update(s).digest('base64url')

export const TTL = { access: 2 * 3600, refresh: 7 * 24 * 3600, sensitive: 300 }

export function sign(payload, typ = 'access', ttl = TTL[typ]) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ ...payload, typ, jti: crypto.randomUUID(), iat: now, exp: now + ttl })
  return `${head}.${body}.${sig(`${head}.${body}`)}`
}

export function verify(token, expectTyp = 'access') {
  if (!token) return null
  const parts = String(token).split('.')
  if (parts.length !== 3) return null
  const expected = sig(`${parts[0]}.${parts[1]}`)
  const got = parts[2]
  if (expected.length !== got.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return null
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    if (head.alg !== 'HS256') return null
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (!p.exp || p.exp < Math.floor(Date.now() / 1000)) return null
    if (p.typ !== expectTyp) return null
    if (!p.jti || isRevoked(p.jti)) return null
    return p
  } catch { return null }
}

export function revoke(payload, reason = 'logout') {
  if (!payload?.jti) return
  const db = S.conn()
  db.prepare('INSERT OR IGNORE INTO auth_revoked (jti, exp, reason, revoked_at) VALUES (?, ?, ?, ?)')
    .run(payload.jti, payload.exp || 0, reason, localStamp())
  db.prepare('DELETE FROM auth_revoked WHERE exp > 0 AND exp < ?').run(Math.floor(Date.now() / 1000))
}

function isRevoked(jti) {
  return !!S.conn().prepare('SELECT 1 FROM auth_revoked WHERE jti = ?').get(jti)
}

/* ---------------- 限流 ---------------- */
const buckets = new Map()
export function createLimiter({ windowMs = 60000, max = 120, keyOfReq = (req) => req.ip || 'unknown', message = '请求过于频繁，请稍后再试' } = {}) {
  return (req, res, next) => {
    const key = keyOfReq(req)
    const now = Date.now()
    let arr = buckets.get(key)
    if (!arr) { arr = []; buckets.set(key, arr) }
    while (arr.length && arr[0] <= now - windowMs) arr.shift()
    if (arr.length >= max) {
      res.setHeader('Retry-After', String(Math.ceil((arr[0] + windowMs - now) / 1000)))
      return res.status(429).json({ code: 42900, message, data: null })
    }
    arr.push(now)
    // 防止异常 IP 撑爆内存
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) if (!v.length || v[v.length - 1] < now - windowMs) buckets.delete(k)
    }
    next()
  }
}
