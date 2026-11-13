/**
 * 密钥管理（正式版）
 *
 * 优先级：环境变量 > 本地开发密钥文件 > 生产模式拒绝启动。
 * 生产环境必须通过 ZHSQ_JWT_SECRET / ZHSQ_DATA_KEY / ZHSQ_INDEX_KEY 注入，
 * 否则直接抛错退出，避免把密钥写进代码或镜像。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const KEY_DIR = path.join(__dirname, 'data', 'keys')
const ENV_NAMES = { jwt: 'ZHSQ_JWT_SECRET', data: 'ZHSQ_DATA_KEY', index: 'ZHSQ_INDEX_KEY' }
const cache = new Map()

export const isProduction = () => process.env.NODE_ENV === 'production'

export function keyOf(name) {
  if (!ENV_NAMES[name]) throw new Error(`未知密钥用途: ${name}`)
  if (cache.has(name)) return cache.get(name)
  const raw = process.env[ENV_NAMES[name]]
  let buf
  if (raw && String(raw).trim()) {
    buf = crypto.createHash('sha256').update(String(raw).trim(), 'utf8').digest()
  } else {
    if (isProduction()) {
      throw new Error(`生产环境必须通过环境变量 ${ENV_NAMES[name]} 注入密钥，禁止使用本地开发密钥文件`)
    }
    fs.mkdirSync(KEY_DIR, { recursive: true })
    const file = path.join(KEY_DIR, `${name}.key`)
    if (fs.existsSync(file)) {
      buf = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64url')
      if (buf.length !== 32) throw new Error(`密钥文件损坏: ${file}`)
    } else {
      buf = crypto.randomBytes(32)
      fs.writeFileSync(file, buf.toString('base64url'), { mode: 0o600 })
    }
  }
  cache.set(name, buf)
  return buf
}

/** 健康接口只暴露来源，不暴露密钥内容 */
export function keyStatus() {
  return Object.fromEntries(Object.keys(ENV_NAMES).map((n) => [n, process.env[ENV_NAMES[n]] ? 'env' : (isProduction() ? 'missing' : 'file')]))
}
