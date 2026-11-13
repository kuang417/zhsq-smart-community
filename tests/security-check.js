/**
 * 正式版安全专项验收（P0 红线 + P1 权限/契约）
 * 用法：先 npm start，再 node tests/security-check.js
 */
import Database from 'better-sqlite3'

const BASE = process.env.BASE || 'http://127.0.0.1:8081'
let pass = 0, failCount = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`) }
  else { failCount++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`) }
}
const req = async (path, { method = 'GET', body, token, headers = {} } = {}) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {})
  })
  const ct = r.headers.get('content-type') || ''
  return { status: r.status, body: ct.includes('json') ? await r.json() : await r.text(), headers: r.headers }
}

;(async () => {
  const l = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } })
  const token = l.body.data?.token
  check('管理员登录成功', !!token)
  const refreshCookie = l.headers.get('set-cookie') || ''
  check('refresh 令牌为 HttpOnly + SameSite=Strict Cookie',
    /HttpOnly/i.test(refreshCookie) && /SameSite=Strict/i.test(refreshCookie) && /zhsq_refresh=/.test(refreshCookie))

  console.log('\n=== 1. 账号与密码（P0-1）===')
  const acct = await req('/api/meta/accounts')
  check('账号下发接口已移除', acct.status === 404, `HTTP ${acct.status}`)
  check('响应不含任何明文密码', !/admin123|"password"/.test(JSON.stringify(acct.body)))
  // 与服务端使用同一个库路径（生产可通过 ZHSQ_DB_FILE 放到独立数据卷）
  const dbPath = process.env.ZHSQ_DB_FILE || 'server/data/zhsq.db'
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  const pwd = db.prepare("SELECT json_extract(data,'$.password') p FROM t_users WHERE id='U001'").get().p
  check('库中密码为 scrypt 加盐哈希', /^scrypt\$/.test(pwd) && !pwd.includes('admin123'), String(pwd).slice(0, 20) + '...')
  const bad = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong-password' } })
  check('错误密码登录失败', bad.body.code === 40002)

  console.log('\n=== 2. 敏感数据存储与明文授权（P0-2）===')
  const row = db.prepare('SELECT data, secure, sec_idx, sec_phone FROM t_population LIMIT 1').get()
  const obj = JSON.parse(row.data)
  check('库内 data 只存脱敏副本', /\*{4}/.test(obj.idcard) && /\*{4}/.test(obj.phone))
  check('原值以 AES-256-GCM 密文存 secure 列', /^v1\./.test(JSON.parse(row.secure).idcard))
  check('精确匹配使用不可逆 HMAC 索引', /^[0-9a-f]{32}$/.test(JSON.parse(row.sec_idx).phone) && /^[0-9a-f]{32}$/.test(row.sec_phone))
  const masked = await req('/api/population?pageSize=1', { token })
  check('列表默认返回脱敏值', /\*{4}/.test(masked.body.data.records[0].idcard))
  const noGrant = await req('/api/population?reveal=1&pageSize=1', { token })
  check('未授权请求明文被 403 拦截', noGrant.status === 403, noGrant.body.message)
  const badGrant = await req('/api/auth/sensitive-grant', { method: 'POST', token, body: { password: 'wrong' } })
  check('二次验密错误不授权', badGrant.body.code === 40002)
  const grant = await req('/api/auth/sensitive-grant', { method: 'POST', token, body: { password: 'admin123' } })
  const st = grant.body.data?.sensitiveToken
  check('二次验密换取短时授权令牌', !!st, `${grant.body.data?.expiresIn}s`)
  const plain = await req('/api/population?reveal=1&pageSize=1', { token, headers: { 'X-Sensitive-Token': st } })
  check('授权后可查看完整身份证/手机号',
    plain.status === 200 && /^\d{17}[\dXx]$/.test(plain.body.data.records[0].idcard) && /^1\d{10}$/.test(plain.body.data.records[0].phone),
    plain.body.data.records[0].idcard)
  const asAccess = await req('/api/grids?pageSize=1', { token: st })
  check('sensitive 令牌不能充当 access 令牌', asAccess.status === 401)
  const exact = await req('/api/population?keyword=' + plain.body.data.records[0].phone + '&pageSize=3', { token })
  check('完整手机号仍可经 HMAC 索引检索', exact.body.data.total >= 1)
  const audit = db.prepare("SELECT count(*) n FROM t_opLogs WHERE json_extract(data,'$.action') = '申请明文查看授权'").get().n
  check('明文查看操作留审计', audit >= 1, `${audit} 条`)
  db.close()

  console.log('\n=== 3. 传输边界与令牌（P0-3）===')
  const evil = await req('/api/health', { headers: { Origin: 'http://evil.example.com' } })
  check('恶意 Origin 不返回 CORS 授权', !evil.headers.get('access-control-allow-origin'))
  const good = await req('/api/health', { headers: { Origin: 'http://localhost:8081' } })
  check('白名单 Origin 精确放行', good.headers.get('access-control-allow-origin') === 'http://localhost:8081')
  check('CSP / X-Frame-Options / nosniff 已启用',
    !!good.headers.get('content-security-policy') &&
    good.headers.get('x-frame-options') === 'SAMEORIGIN' &&
    good.headers.get('x-content-type-options') === 'nosniff')
  const refreshOnly = await req('/api/grids?pageSize=1', { token: refreshCookie.match(/zhsq_refresh=([^;]+)/)?.[1] })
  check('refresh 令牌不能当 access 使用', refreshOnly.status === 401)

  console.log('\n=== 4. 居民端越权（P0-2）===')
  const leak = await req('/api/resident/progress?phone=13561863235')
  check('仅凭手机号查询他人进度被拒',
    leak.status === 403 || leak.body.code === 40003 || leak.status === 429,
    leak.body.message || `HTTP ${leak.status}`)

  console.log('\n=== 5. 统一数据权限 / 乐观锁（P1）===')
  const grid = await req('/api/auth/login', { method: 'POST', body: { username: 'grid', password: '123456' } })
  const gt = grid.body.data?.token
  const gridPop = await req('/api/population?pageSize=1', { token: gt })
  check('网格员人口数据受 SQL 前缀约束', gridPop.body.data.total > 0 && gridPop.body.data.total < 20860, `${gridPop.body.data.total} 条`)
  const gridReveal = await req('/api/population?reveal=1&pageSize=1', { token: gt })
  check('非区级角色明文请求被拒', gridReveal.status === 403)
  const forbidden = await req('/api/population?pageSize=1&orgCode=999999', { token: gt })
  check('显式越权下钻返回空集', forbidden.body.data.total === 0)

  console.log('\n=== 6. 登出吊销与限流（放最后，避免影响其他用例）===')
  const logout = await req('/api/auth/logout', { method: 'POST', token })
  check('登出成功', logout.body.code === 0)
  const afterLogout = await req('/api/grids?pageSize=1', { token })
  check('已吊销令牌立即失效', afterLogout.status === 401)
  let limited = 0
  for (let i = 0; i < 11; i++) {
    const r = await req('/api/auth/login', { method: 'POST', body: { username: 'ratelimit-probe', password: 'x' } })
    if (r.status === 429) { limited = i + 1; break }
  }
  check('登录限流生效（10 次/分钟）', limited > 0, `第 ${limited} 次返回 429`)

  console.log(`\n=== 结果：${pass} 项通过 / ${failCount} 项失败 ===\n`)
  process.exit(failCount ? 1 : 0)
})().catch((e) => { console.error('测试执行异常：', e); process.exit(1) })
