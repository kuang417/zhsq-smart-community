/**
 * 回归测试公共助手：跨进程复用登录会话 + 遵守服务端登录限流
 *
 * 背景：test:all 串行跑 6 个测试文件，每个都单独登录同一账号，
 * 连续运行两轮就会累计触发 loginLimiter（10 次 / 60 秒 / 账号），
 * 使后续用例拿到 401/429 而误判为功能缺陷。安全能力本身不绕过：
 *  - 优先复用本轮已取得且仍有效的 access token（临时缓存，仅存令牌与时间戳）；
 *  - 确实需要重新登录时，若返回 429 则按服务端 Retry-After 等待窗口滑出后重试。
 *
 * 缓存仅落在系统临时目录、权限 0600、30 分钟自动失效；不写项目数据目录。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
const CACHE_FILE = path.join(
  os.tmpdir(),
  `zhsq-test-session-${crypto.createHash('sha256').update(BASE).digest('hex').slice(0, 10)}.json`
)
const MAX_AGE_MS = 30 * 60 * 1000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function readCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch { return {} }
}
function writeCache(cache) {
  try { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), { mode: 0o600 }) } catch { /* 临时目录不可写时退化为不缓存 */ }
}

async function stillValid(token) {
  if (!token) return false
  try {
    const r = await fetch(`${BASE}/api/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    return r.status === 200
  } catch { return false }
}

/** 真实登录一次；429 时按服务端 Retry-After 等待，不绕过限流 */
async function rawLogin(u, p) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    })
    const j = await r.json().catch(() => null)
    if (j?.data?.token) {
      return { token: j.data.token, cookie: (r.headers.get('set-cookie') || '').split(';')[0] }
    }
    if (r.status === 429) {
      const sec = Math.min(61, Math.max(1, Number(r.headers.get('retry-after')) || 5))
      console.log(`  ⏳ 登录限流（${u}），等待 ${sec}s 后重试`)
      await sleep(sec * 1000 + 300)
      continue
    }
    throw new Error(`登录失败 ${u}: HTTP ${r.status} ${j?.message || ''}`)
  }
  throw new Error(`登录持续被限流：${u}`)
}

/** 复用有效会话，返回 access token */
export async function login(u, p) {
  const cache = readCache()
  const hit = cache[u]
  if (hit?.token && Date.now() - (hit.at || 0) < MAX_AGE_MS && await stillValid(hit.token)) {
    return hit.token
  }
  const session = await rawLogin(u, p)
  cache[u] = { token: session.token, at: Date.now() }
  writeCache(cache)
  return session.token
}

/** 需要全新 jti 与 refresh Cookie 的场景（如验证按会话关闭实时连接），不复用缓存 */
export async function loginFresh(u, p) {
  return rawLogin(u, p)
}

/** 用 HttpOnly refresh Cookie 换一个全新 jti 的 access token，避免为测试再登录一次 */
export async function freshSession(cookie) {
  const r = await fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST', headers: { Cookie: cookie }
  })
  const j = await r.json().catch(() => null)
  if (!j?.data?.token) throw new Error(`刷新会话失败：HTTP ${r.status} ${j?.message || ''}`)
  return j.data.token
}

export { BASE, CACHE_FILE }
