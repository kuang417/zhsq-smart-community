/**
 * 请求上下文（AsyncLocalStorage）
 *
 * 正式版统一数据权限：鉴权中间件把当前用户放入上下文，SQLite 查询层自动读取并
 * 在 SQL 层注入 org_code LIKE '前缀%'。任何接口即使漏写 assertScope，也无法越权读数据。
 * 居民端 / 公开接口不设置用户；系统内部任务用 bypassScope 显式跳过。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()

export const runWithUser = (user, fn) => als.run({ user: user || null, meta: {} }, fn)
export const currentUser = () => als.getStore()?.user || null
/** 鉴权通过后把用户写进当前请求上下文，供 SQL 层自动注入数据权限 */
export const setCurrentUser = (user) => { const s = als.getStore(); if (s) s.user = user || null }
/** 记录来源 IP / UA，审计日志自动带上，不再只留操作人 */
export const setRequestMeta = (meta = {}) => { const s = als.getStore(); if (s) s.meta = { ...(s.meta || {}), ...meta } }
export const currentRequestMeta = () => als.getStore()?.meta || {}
export const bypassScope = (fn) => als.run({ user: null, bypass: true, meta: {} }, fn)
export const isBypass = () => !!als.getStore()?.bypass
