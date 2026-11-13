/**
 * 资源元数据的前端缓存（V2.4）
 *
 * 列 / 表单必填 / 状态机 / 导入模板 / SLA 等元数据由 GET /api/meta/schema 从
 * 服务端配置派生，避免前后端各维护一份而逐渐漂移。接口本身按角色做资源级授权，
 * 拿不到的资源前端一律不显示对应能力。
 *
 * 缓存只在会话内有效；加载失败时静默回退到页面内的本地配置，不阻断业务。
 */
import { api } from '@/api'

let cache = null
let pending = null

export const getSchemaSync = () => cache

export function loadSchema(force = false) {
  if (cache && !force) return Promise.resolve(cache)
  if (pending) return pending
  pending = api.schema({ silentError: true })
    .then((d) => { cache = d || null; return cache })
    .catch(() => { cache = null; return null })
    .finally(() => { pending = null })
  return pending
}

export function clearSchema() { cache = null; pending = null }

/** 单个资源的元数据；无缓存时返回 null，由调用方回退到本地常量 */
export const resourceSchema = (key) => cache?.resources?.[key] || null
