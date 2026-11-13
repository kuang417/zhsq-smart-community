export const FLOW_STATES = {
  办事: ['待受理', '办理中', '已办结'],
  治理万家: ['待派发', '已派发', '处置中', '已办结', '已归档'],
  告警: ['待处置', '处置中', '已处置', '已归档']
}

const DANGER = ['待处置', '待派发', '待受理', '紧急', '故障', '离线', '到期预警', '终止']
const WARNING = ['办理中', '办理中', '处置中', '处理中', '待接单', '待审核', '重要', '维修中', '试用', '草稿', '待更换']
const SUCCESS = ['已办结', '已处置', '已归档', '已完成', '正常', '在线', '在营', '签约', '已发布', '启用', '已办结']

export const statusType = (s) => {
  if (SUCCESS.includes(s)) return 'success'
  if (DANGER.includes(s)) return 'danger'
  if (WARNING.includes(s)) return 'warning'
  if (['已派发', '处理中', '正式党员', '一般'].includes(s)) return 'primary'
  return 'info'
}

export const fmtNum = (v) => (typeof v === 'number' ? v.toLocaleString('zh-CN') : (v ?? '-'))

/* Excel 导入表头映射（与后端 IMPORT_TEMPLATES 保持一致） */
export const IMPORT_COLS = {
  partyMembers: [
    ['姓名', 'name'], ['身份证号', 'idcard'], ['手机号', 'phone'],
    ['所属党组织编码', 'orgCode'], ['入党时间(YYYY-MM-DD)', 'joinDate'], ['党员状态', 'status']
  ],
  population: [
    ['姓名', 'name'], ['身份证号', 'idcard'], ['手机号', 'phone'], ['人口类型', 'type'],
    ['年龄', 'age'], ['性别', 'gender'], ['网格编码', 'gridCode'],
    ['特殊群体标签', 'tags'], ['住址', 'address']
  ]
}

/** ECharts 自绘地图：由四级组织 bounds 生成示意 GeoJSON（不依赖第三方地图 SDK） */
function polygon(bounds, inset = 0.0004) {
  const [x1, y1, x2, y2] = bounds
  const a = x1 + inset, b = y1 + inset, c = x2 - inset, d = y2 - inset
  const cut = Math.min((c - a), (d - b)) * 0.12
  return [[a + cut, b], [c - cut, b], [c, b + cut], [c, d - cut], [c - cut, d], [a + cut, d], [a, d - cut], [a, b + cut], [a + cut, b]]
}
export function buildGeoJSON(nodes) {
  return {
    type: 'FeatureCollection',
    features: nodes.map((n) => ({
      type: 'Feature',
      properties: { name: n.orgName, orgCode: n.orgCode, orgLevel: n.orgLevel, value: 0 },
      geometry: { type: 'Polygon', coordinates: [polygon(n.bounds)] }
    }))
  }
}

/** 大屏 / 地理平台通用深色图表色板 */
export const DARK_PALETTE = ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#a78bfa', '#fb923c']
export const darkAxis = {
  axisLine: { lineStyle: { color: 'rgba(125,211,252,.25)' } },
  axisLabel: { color: '#8fb4e6', fontSize: 10 },
  splitLine: { lineStyle: { color: 'rgba(125,211,252,.1)' } }
}
