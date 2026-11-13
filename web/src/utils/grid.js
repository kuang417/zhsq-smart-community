/**
 * V2.6：居民端预览 / 网格编码解析的单一来源。
 *
 * 此前顶栏「居民端预览」、办事 / 治理页「打开居民端」都写死演示网格编码
 * 450102010101，居民端页面本身也用它兜底。生产空库（无网格）时这些入口会
 * 打开一个必然 404 的页面，却看不出原因；换成真实行政区划后也会指向错误网格。
 * 现在统一从带鉴权 + 数据范围过滤的 /api/grids/options 动态取值，无网格时明确提示。
 */
import { ElMessage } from 'element-plus'
import { api } from '@/api'

/** 按当前会话的身份缓存，切换账号后自动失效，避免把上一位使用者的范围带过来 */
let cacheKey = ''
let cached = null
let inflight = null

export async function gridOptions(user) {
  const key = `${user?.id || '-'}:${user?.orgCode || ''}:${user?.role || ''}`
  if (cached && cacheKey === key) return cached
  if (!inflight || inflight.key !== key) {
    inflight = {
      key,
      promise: api.gridOptions()
        .then((d) => {
          cached = Array.isArray(d) ? d : []
          cacheKey = key
          return cached
        })
        .finally(() => { inflight = null })
    }
  }
  return inflight.promise
}

/** 取当前角色可用于居民端预览的网格编码；无网格返回空串 */
export async function resolveResidentGrid(user) {
  const list = await gridOptions(user)
  const ownCode = String(user?.orgCode || '')
  if (user?.orgLevel === 4 && list.some((g) => String(g.gridCode) === ownCode)) return ownCode
  if (ownCode) {
    const inScope = list.find((g) => String(g.gridCode).startsWith(ownCode)
      || String(g.orgCode || '').startsWith(ownCode))
    if (inScope) return String(inScope.gridCode)
  }
  return list.length ? String(list[0].gridCode) : ''
}

/** 打开居民端预览：无网格 / 请求失败都给出可操作的提示，不再静默跳到演示编码 */
export async function openResidentPreview(user) {
  try {
    const code = await resolveResidentGrid(user)
    if (!code) {
      ElMessage.warning('当前数据范围内暂无网格，请先在「网格组织 / 便民码」台账维护网格后再预览居民端')
      return false
    }
    window.open(`/resident?grid=${encodeURIComponent(code)}`, '_blank')
    return true
  } catch (e) {
    ElMessage.warning('无法获取网格列表，请稍后重试或检查网络连接')
    return false
  }
}
