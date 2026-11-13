/** 临时验证：生产模式空库首次初始化 + 二次启动（重启不误判、不灌演示数据） */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DB = path.resolve('server/data/prod-smoke.db')
const clean = () => {
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f) } catch { /* noop */ } }
}
const env = {
  ...process.env,
  NODE_ENV: 'production', PORT: '8082', ZHSQ_DB_FILE: DB,
  ZHSQ_JWT_SECRET: 'smoke-jwt-secret-0123456789',
  ZHSQ_DATA_KEY: 'smoke-data-key-0123456789',
  ZHSQ_INDEX_KEY: 'smoke-index-key-0123456789',
  ZHSQ_ADMIN_PASSWORD: 'SmokeTestPassw0rd!',
  ZHSQ_TRUST_PROXY: '1'
}
const start = () => {
  const c = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  c.stdout.on('data', (d) => { log += d.toString() })
  c.stderr.on('data', (d) => { log += d.toString() })
  c._log = () => log
  return c
}
const waitHealth = async (c) => {
  for (let i = 0; i < 60; i++) {
    if (c.exitCode != null) throw new Error(`进程提前退出(${c.exitCode})：\n${c._log()}`)
    try {
      const r = await fetch('http://127.0.0.1:8082/api/health')
      if (r.ok) return await r.json()
    } catch { /* 尚未监听 */ }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`启动超时：\n${c._log()}`)
}
const stop = (c) => new Promise((resolve) => {
  if (c.exitCode != null) return resolve()
  c.once('exit', resolve)
  c.kill('SIGTERM')
  setTimeout(() => { if (c.exitCode == null) c.kill('SIGKILL') }, 3000)
})

clean()
const results = []
for (const round of [1, 2]) {
  const c = start()
  try {
    const h = await waitHealth(c)
    const login = await (await fetch('http://127.0.0.1:8082/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'SmokeTestPassw0rd!' })
    })).json()
    results.push({
      round, status: h.data.status, mode: h.data.security.mode,
      keys: h.data.security.keys.jwt, fileHidden: !('file' in h.data.storage),
      grids: h.data.counts.grids, population: h.data.counts.population,
      login: login.code === 0, menus: login.data?.menus?.length
    })
  } finally { await stop(c) }
}
console.log(JSON.stringify(results, null, 2))
const ok = results.length === 2 && results.every((r) => r.status === 'running' && r.mode === 'production'
  && r.keys === 'env' && r.fileHidden && r.grids === 0 && r.population === 0 && r.login)
console.log(ok ? 'PROD SMOKE: PASS（首次初始化 + 二次重启均正常，无演示数据）' : 'PROD SMOKE: FAIL')
clean()
process.exit(ok ? 0 : 1)
