import request from './request'

// 第三参数可传 Axios 配置（如 silentError: true 由调用方自定义错误提示）
const get = (url, params, config = {}) => request.get(url, { params, ...config })
const post = (url, data, config = {}) => request.post(url, data, config)
const put = (url, data, config = {}) => request.put(url, data, config)
const del = (url, config = {}) => request.delete(url, config)

const downloadBlob = (blob, filename) => {
  if (!blob || !blob.size) throw new Error('导出文件为空，请稍后重试')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

// 路径片段统一编码：gridCode / 业务编号 / 资源名都来自用户输入或后端数据，
// 直接拼接会让含 /、?、# 的值改变请求路径（甚至命中居民端免鉴权前缀）。
const seg = (v) => encodeURIComponent(String(v ?? ''))

export const api = {
  /* 任意 GET（非标准化资源路径，如 /party/members） */
  get: (url, params, config = {}) => get(url, params, config),

  /* 认证 / 元数据 */
  login: (username, password) => post('/auth/login', { username, password }),
  refresh: () => post('/auth/refresh', {}),
  sensitiveGrant: (password) => post('/auth/sensitive-grant', { password }),
  profile: () => get('/auth/profile'),
  logout: () => post('/auth/logout', {}),
  health: () => get('/health'),
  overview: () => get('/meta/overview'),
  todo: (limit = 6, overdueOnly = false, config = {}) => get('/meta/todo', { limit, overdue: overdueOnly ? '1' : '' }, config),
  schema: (config = {}) => get('/meta/schema', {}, config),
  liveStats: () => get('/meta/live'),
  search: (q, limit = 10) => get('/search', { q, limit }),
  dicts: () => get('/dicts'),
  orgTree: () => get('/orgs/tree'),
  orgOptions: (level) => get('/orgs/options', { level }),
  gridOptions: () => get('/grids/options'),
  qr: (code) => get(`/grids/${seg(code)}/qr`),

  /* 通用 CRUD（约30张表） */
  list: (resource, params) => get(`/${seg(resource)}`, params),
  detail: (resource, id) => get(`/${seg(resource)}/${seg(id)}`),
  create: (resource, data) => post(`/${seg(resource)}`, data),
  update: (resource, id, data) => put(`/${seg(resource)}/${seg(id)}`, data),
  remove: (resource, id) => del(`/${seg(resource)}/${seg(id)}`),

  /* 状态机与留痕（支持批量） */
  transition: (payload) => post('/transition', payload),
  transitionBatch: (payload) => post('/transition/batch', payload),
  transitionRevoke: (payload) => post('/transition/revoke', payload),
  transitionReturn: (payload) => post('/transition/return', payload),
  bulkDelete: (resource, ids) => post(`/bulk-delete/${seg(resource)}`, { ids }),
  flows: (params) => get('/flows', params),

  /* 导入导出：导入走 multipart/form-data，服务端解析，不再把整表塞进 JSON */
  exportFile: async (resource, params = {}, filename = '') => {
    const blob = await request.get(`/export/${seg(resource)}`, { params, responseType: 'blob' })
    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    downloadBlob(blob, filename || `${resource}_${day}.xlsx`)
    return blob
  },
  template: async (resource, filename = '导入模板.xlsx') => {
    const blob = await request.get('/import/template', { params: { resource }, responseType: 'blob' })
    downloadBlob(blob, filename)
  },
  importFile: (resource, file) => {
    const fd = new FormData()
    fd.append('file', file)
    return request.post(`/import/${seg(resource)}`, fd, { timeout: 120000 })
  },

  /* 富文本编辑器：图片 / 附件上传（鉴权由请求拦截器统一携带 Bearer） */
  uploadFile: (file, type = 'image') => {
    const fd = new FormData()
    fd.append('file', file)
    return request.post(`/upload?type=${type}`, fd, { timeout: 60000 })
  },

  /* 统计 / 大屏 / 地理 / 感知 / 运营 */
  populationStats: (orgCode) => get('/stats/population', { orgCode }),
  buildingStats: (orgCode) => get('/stats/buildings', { orgCode }),
  screenStats: () => get('/stats/screen'),
  sensingStats: () => get('/stats/sensing'),
  opsStats: () => get('/stats/ops'),
  geoStats: (layer, orgCode) => get('/stats/geo', { layer, orgCode }),
  buildingDetail: (id) => get(`/stats/building/${seg(id)}`),
  geoQuery: (payload) => post('/geo/query', payload),
  /* 离线矢量底图：真实行政区边界 GeoJSON，合规导入 / 本地渲染，断网可用 */
  geoBasemap: (params) => get('/geo/basemap', params),
  geoBasemapImport: (fd) => request.post('/geo/basemap/import', fd, { timeout: 60000 }),
  geoBasemapClear: () => del('/geo/basemap'),

  /* 居民端 H5：三要素查询（手机号 + 业务编号 + 一次性查询码） */
  residentHome: (gridCode) => get(`/resident/home/${seg(gridCode)}`),
  residentMessages: (gridCode) => get(`/resident/messages/${seg(gridCode)}`),
  residentEvent: (data) => post('/resident/events', data),
  residentRequest: (data) => post('/resident/requests', data),
  // 三要素查询的失败原因差异较大（校验 / 不匹配 / 限流 / 网络），由页面自行分层提示
  residentProgress: (phone, bizCode, queryCode) => get('/resident/progress', { phone, bizCode, queryCode }, { silentError: true })
}

/** 全局检索 / 工作台跳转用：资源 → 业务模块路由 + 中文标签 */
export const RESOURCE_ROUTES = {
  partyOrgs: ['/party/org', '党组织'], partyMembers: ['/party/member', '党员'],
  honors: ['/party/honor', '党员荣誉'], memberFlows: ['/party/honor', '党员流动'],
  meetings: ['/party/meeting', '三会一课'], learnings: ['/party/learn', '学习资料'],
  historyLearn: ['/party/history', '历史学习'], learningProgress: ['/party/learn', '学习进度'],
  grids: ['/base/grid', '网格'], persons: ['/base/grid', '人员主数据'], orgs: ['/base/grid', '组织'],
  population: ['/base/population', '人口'], houses: ['/base/building', '房屋'],
  buildings: ['/base/building', '建筑'], parts: ['/base/part', '部件'],
  enterprises: ['/base/enterprise', '企业'], communities: ['/base/community', '小区'],
  messages: ['/service/message', '消息'], banners: ['/publish', '轮播图'],
  shortcuts: ['/publish', '快捷入口'], recommends: ['/publish', '推荐位'],
  contents: ['/publish', '内容发布'], serviceRequests: ['/service/request', '办事申请'],
  governanceEvents: ['/service/event', '治理万家'], devices: ['/sensing', '设备'],
  alarms: ['/sensing', '告警'], workOrders: ['/sensing', '处置工单'],
  contracts: ['/ops', '订阅合同'], flowLogs: ['/ops', '流转记录'], opLogs: ['/ops', '操作日志']
}
