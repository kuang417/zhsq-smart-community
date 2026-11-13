import axios from 'axios'
import { ElMessage } from 'element-plus'
import { getToken, setToken, clearTokens, getSensitiveToken } from './token'

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api'

const request = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  withCredentials: true,          // 携带 HttpOnly refresh cookie
  headers: { 'Content-Type': 'application/json' }
})

request.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  // 5 分钟明文授权令牌只在「确实要查看/导出明文」的请求上发送，
  // 不再附带到所有 API（日志、代理、错误上报面都会被扩大）
  const sensitive = getSensitiveToken()
  if (sensitive) {
    const wantsReveal = String(config.params?.reveal ?? '') === '1' || String(config.url || '').startsWith('/export/')
    if (wantsReveal) config.headers['X-Sensitive-Token'] = sensitive
  }
  return config
})

let refreshing = null
/** 供实时通道在 401 时主动换发令牌（普通请求的刷新仍由响应拦截器完成） */
export const refreshSession = () => {
  if (!refreshing) {
    refreshing = axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true })
      .then((r) => {
        if (r.data?.code === 0 && r.data.data?.token) { setToken(r.data.data.token); return true }
        return false
      })
      .catch(() => false)
      .finally(() => { refreshing = null })
  }
  return refreshing
}

let loginRedirecting = false
const goLogin = async () => {
  clearTokens()
  // 会话结束/过期时清掉本标签页的所有平台缓存：筛选条件可能含姓名/身份证片段，
  // 居民端凭条含手机号 + 一次性查询码，不能留给下一位使用者
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith('zhsq:')).forEach((k) => sessionStorage.removeItem(k))
  } catch (e) { /* 隐私模式下忽略 */ }
  // 同时清空 Pinia 会话（user/menus/permissions/dicts），否则 logged getter 仍为 true；
  // 动态 import 避免 request.js -> stores/user.js -> api/index.js 的循环依赖
  try {
    const { useUserStore } = await import('@/stores/user')
    useUserStore().clear()
  } catch (e) { /* pinia 尚未就绪时忽略 */ }
  // 并发 401 会同时走到这里，只提示并跳转一次
  if (loginRedirecting) return
  loginRedirecting = true
  // 路由是 createWebHistory，必须用 pathname 判断并整体跳转
  if (!window.location.pathname.startsWith('/login')) {
    ElMessage.warning('登录已过期，请重新登录')
    window.location.assign('/login')
  }
}

/** 统一构造带业务码的错误对象，供调用方按错误类型给出不同出口 */
const bizError = (message, code, status = 200) => {
  const e = new Error(message)
  e.code = code
  e.status = status
  e.bizMessage = message
  return e
}

request.interceptors.response.use(
  async (response) => {
    const silent = !!response.config?.silentError
    if (response.config.responseType === 'blob') {
      const blob = response.data
      // 后端鉴权/校验失败返回的是 JSON（403/400），不能当成 xlsx 直接下载
      if (blob && typeof blob.text === 'function' && /json/i.test(blob.type || '')) {
        const text = await blob.text()
        try {
          const body = JSON.parse(text)
          const err = bizError(body.message || '导出失败', body.code)
          if (!silent) ElMessage.error(err.message)
          return Promise.reject(err)
        } catch (e) {
          // blob.text() 已消费流：解析失败时重建一个内容完整的 Blob，不能返回被读空的空文件
          return new Blob([text], { type: blob.type })
        }
      }
      return blob
    }
    const body = response.data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 0) return body.data
      const err = bizError(body.message || '操作失败', body.code, response.status)
      if (!silent) ElMessage.error(err.message)
      return Promise.reject(err)
    }
    return body
  },
  async (error) => {
    const status = error.response?.status
    const cfg = error.config || {}
    const isAuthApi = String(cfg.url || '').includes('/auth/')
    if (status === 401 && !isAuthApi && !cfg.__retried) {
      cfg.__retried = true
      if (await refreshSession()) return request(cfg)
      await goLogin()
      return Promise.reject(error)
    }
    const body = error.response?.data
    const msg = body?.message || error.message || '网络异常'
    error.code = body?.code ?? error.code
    error.status = status
    error.bizMessage = msg
    error.isNetwork = !error.response
    if (status === 401 && isAuthApi) await goLogin()
    else if (!cfg.silentError) ElMessage.error(msg)
    return Promise.reject(error)
  }
)

export default request
