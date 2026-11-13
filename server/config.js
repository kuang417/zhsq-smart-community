/**
 * 资源 / 状态机 / 菜单 / 角色权限 配置（说明书 2.2、3.3、3.4、4.x）
 */
const all = ['portal', 'party', 'base', 'panorama', 'micro', 'service', 'publish', 'sensing', 'screen', 'geo', 'ops']

export const ROLE_MODULES = {
  district: all,
  street: ['portal', 'party', 'base', 'panorama', 'micro', 'service', 'publish', 'sensing', 'screen', 'geo'],
  community: ['portal', 'party', 'base', 'panorama', 'micro', 'service', 'publish', 'sensing'],
  grid: ['portal', 'base', 'micro', 'service', 'sensing']
}

export const MENUS = [
  { key: 'portal', title: '首页 / 统一门户', path: '/portal', icon: 'HomeFilled', module: 'portal' },
  {
    key: 'party', title: '智慧党建', icon: 'Flag', module: 'party', children: [
      { key: 'party-org', title: '党组织树', path: '/party/org', module: 'party' },
      { key: 'party-member', title: '党员管理', path: '/party/member', module: 'party' },
      { key: 'party-honor', title: '荣誉与流动', path: '/party/honor', module: 'party' },
      { key: 'party-meeting', title: '三会一课', path: '/party/meeting', module: 'party' },
      { key: 'party-learn', title: '学习教育', path: '/party/learn', module: 'party' },
      { key: 'party-history', title: '历史学习', path: '/party/history', module: 'party' }
    ]
  },
  {
    key: 'base', title: '基础信息', icon: 'OfficeBuilding', module: 'base', children: [
      { key: 'base-grid', title: '网格组织 / 便民码', path: '/base/grid', module: 'base' },
      { key: 'base-popstats', title: '实有人口统计', path: '/base/popstats', module: 'base' },
      { key: 'base-population', title: '人口明细', path: '/base/population', module: 'base' },
      { key: 'base-tags', title: '特殊群体标签', path: '/base/tags', module: 'base' },
      { key: 'base-building', title: '实有建筑 / 房屋', path: '/base/building', module: 'base' },
      { key: 'base-enterprise', title: '实有企业', path: '/base/enterprise', module: 'base' },
      { key: 'base-community', title: '小区与驻地单位', path: '/base/community', module: 'base' },
      { key: 'base-part', title: '部件管理', path: '/base/part', module: 'base' }
    ]
  },
  { key: 'panorama', title: '数据全景', path: '/panorama', icon: 'Search', module: 'panorama' },
  { key: 'micro', title: '网格微站', path: '/micro', icon: 'Grid', module: 'micro' },
  {
    key: 'service', title: '便民服务', icon: 'Service', module: 'service', children: [
      { key: 'service-message', title: '消息中心', path: '/service/message', module: 'service' },
      { key: 'service-overview', title: '概览管理', path: '/service/overview', module: 'service' },
      { key: 'service-request', title: '办事管理', path: '/service/request', module: 'service' },
      { key: 'service-event', title: '治理万家', path: '/service/event', module: 'service' }
    ]
  },
  { key: 'publish', title: '发布系统', path: '/publish', icon: 'Document', module: 'publish' },
  { key: 'sensing', title: '感知平台', path: '/sensing', icon: 'Warning', module: 'sensing' },
  { key: 'screen', title: '决策大屏', path: '/screen', icon: 'DataBoard', module: 'screen' },
  { key: 'geo', title: '地理平台', path: '/geo', icon: 'Location', module: 'geo' },
  { key: 'ops', title: '运营中心', path: '/ops', icon: 'TrendCharts', module: 'ops' }
]

/**
 * 通用 CRUD 资源定义
 *
 * 安全字段（V2.1 深度审计加固）：
 *  - module : 该资源所属业务模块，接口层据此做 assertModule 校验，避免「前端隐藏菜单 = 权限」
 *  - roles  : 可选，按角色白名单覆盖模块判断（用于运营/审计类全局数据）
 *  - primary: 主键字段名（orgs 用 orgCode、grids 用 gridCode），编辑/删除时禁止篡改
 *  - required: 新增时的必填字段，后端强制校验（前端表单只是提示，不是边界）
 *
 * global 只表示「不做组织前缀过滤」，不代表「任何角色可读」，仍受 module / roles 约束。
 */
export const RESOURCES = {
  partyOrgs: { label: '党组织', store: 'db', search: ['name', 'secretary'], orgKey: 'orgCode', tree: true, module: 'party', required: ['name', 'orgCode'] },
  partyMembers: { label: '党员', store: 'db', search: ['name', 'orgName', 'phone'], orgKey: 'orgCode', sensitive: ['idcard', 'phone'], module: 'party', required: ['name', 'idcard', 'orgCode'] },
  honors: { label: '党员荣誉', store: 'db', search: ['memberName', 'title'], orgKey: 'orgCode', module: 'party' },
  memberFlows: { label: '党员流动', store: 'db', search: ['memberName', 'fromOrg', 'toOrg'], orgKey: 'orgCode', module: 'party' },
  meetings: { label: '三会一课', store: 'db', search: ['title', 'host', 'place'], orgKey: 'orgCode', module: 'party' },
  learnings: { label: '学习资料', store: 'db', search: ['title', 'publisher'], global: true, module: 'party' },
  historyLearn: { label: '历史学习', store: 'db', search: ['title', 'period', 'column'], global: true, module: 'party' },
  learningProgress: { label: '学习进度', store: 'db', search: ['memberName'], global: true, module: 'party' },

  grids: { label: '网格', store: 'db', search: ['gridName', 'gridCode'], orgKey: 'orgCode', module: 'base', required: ['gridName', 'gridCode', 'orgCode'] },
  persons: { label: '人员主数据', store: 'db', search: ['name', 'phone'], orgKey: 'orgCode', module: 'base', required: ['name', 'orgCode'] },
  orgs: { label: '组织', store: 'db', search: ['orgName', 'orgCode'], orgKey: 'orgCode', primary: 'orgCode', module: 'base', required: ['orgName', 'orgCode'] },
  population: { label: '人口', store: 'bulk', search: ['name', 'idcard', 'phone', 'address'], orgKey: 'gridCode', sensitive: ['idcard', 'phone'], module: 'base', required: ['name'] },
  houses: { label: '房屋', store: 'bulk', search: ['code', 'buildingId'], orgKey: 'gridCode', module: 'base', required: ['code', 'buildingId', 'gridCode'] },
  buildings: { label: '建筑', store: 'bulk', search: ['name', 'buildingType'], orgKey: 'gridCode', module: 'base' },
  parts: { label: '部件', store: 'bulk', search: ['name', 'type'], orgKey: 'gridCode', module: 'base' },
  enterprises: { label: '企业', store: 'db', search: ['name', 'creditCode', 'legalPerson'], orgKey: 'orgCode', sensitive: ['contact'], module: 'base', required: ['name', 'orgCode'] },
  communities: { label: '小区 / 驻地单位', store: 'db', search: ['name', 'manager'], orgKey: 'orgCode', sensitive: ['phone'], module: 'base', required: ['name', 'orgCode'] },

  messages: { label: '消息', store: 'db', search: ['title', 'content'], orgKey: 'orgCode', module: 'service', required: ['title'] },
  banners: { label: '轮播图', store: 'db', search: ['title'], global: true, module: 'portal' },
  shortcuts: { label: '快捷入口', store: 'db', search: ['title'], global: true, module: 'portal' },
  recommends: { label: '推荐位', store: 'db', search: ['title'], global: true, module: 'portal' },
  contents: { label: '内容发布', store: 'db', search: ['title', 'publisher'], orgKey: 'orgCode', module: 'publish', required: ['title'] },
  serviceRequests: { label: '办事申请', store: 'db', search: ['applicant', 'item', 'code'], orgKey: 'orgCode', sensitive: ['applicantPhone'], flow: '办事', module: 'service' },
  governanceEvents: { label: '治理万家事件', store: 'db', search: ['title', 'reporter', 'code'], orgKey: 'orgCode', sensitive: ['reporterPhone'], flow: '治理万家', module: 'service' },

  devices: { label: '设备', store: 'db', search: ['name', 'code', 'location'], orgKey: 'orgCode', module: 'sensing' },
  alarms: { label: '告警', store: 'db', search: ['code', 'type', 'location'], orgKey: 'orgCode', flow: '告警', module: 'sensing' },
  workOrders: { label: '处置工单', store: 'db', search: ['code', 'title', 'assignee'], orgKey: 'orgCode', module: 'sensing' },
  contracts: { label: '订阅合同', store: 'db', search: ['code', 'party', 'contact'], global: true, sensitive: ['phone'], module: 'ops', roles: ['district'] },
  // 流转留痕是全局表且历史记录无 orgCode，通用 CRUD/导出只允许区级读取；
  // 其它角色通过 /api/flows?bizId= 查看本辖区留痕（该接口按业务主体反查做范围过滤）
  flowLogs: { label: '流转记录', store: 'db', search: ['bizId', 'operator'], global: true, module: 'ops', roles: ['district'] },
  opLogs: { label: '操作日志', store: 'db', search: ['action', 'username'], global: true, module: 'ops', roles: ['district'] }
}

/** 资源级授权：角色白名单优先，其次按业务模块校验；未配置的资源默认拒绝（fail-closed） */
export function assertResource(user, resource, action = 'read') {
  const cfg = RESOURCES[resource]
  if (!cfg) return false
  // 只读留痕资源不允许任何角色手工写入：必须先于 roles 白名单判断，
  // 否则带 roles 的 flowLogs/opLogs 会提前 return true，这段保护成为死代码。
  if (action !== 'read' && (resource === 'flowLogs' || resource === 'opLogs')) return false
  if (cfg.roles) return cfg.roles.includes(user?.role)
  if (!cfg.module) return false
  const modules = ROLE_MODULES[user?.role] || []
  if (!modules.includes(cfg.module)) return false
  return true
}

/** 权限关键字段：禁止通过通用 PUT 篡改，避免把数据移出自己的数据范围或伪造留痕 */
export const PROTECTED_FIELDS = new Set([
  'id', 'version', 'password', 'role', 'roleName', 'orgLevel', 'scopeDesc',
  'created_at', 'updated_at', 'secure', 'sec_idx', 'sec_phone',
  // V2.6：JSON 请求体可携带原型链关键字，赋值时可能触发原型 setter，统一剔除
  '__proto__', 'constructor', 'prototype'
])

/**
 * V2.5 审计修复：状态机资源的业务字段只能由 /transition* 系列接口写入。
 * 通用 POST/PUT 若允许直写 status，可一步把待办改成终态并且不留任何流转痕迹，
 * 也会绕过跳步校验、进度消息、工单联动与撤回/退回口径（实测可复现）。
 */
export const FLOW_PROTECTED_FIELDS = new Set([
  'status', 'handler', 'dispatcher', 'opinion', 'result', 'handleTime',
  'flowStatus', 'revokedAt', 'revokedBy', 'revokeReason'
])
/** 通用 CRUD 新建状态机记录时强制写入的初始状态 */
export const FLOW_INITIAL_STATUS = {
  serviceRequests: '待受理', governanceEvents: '待派发', alarms: '待处置'
}

/** 业务状态机：只允许按序流转，禁止跳步（说明书 3.3-(3)） */
export const FLOWS = {
  办事: ['待受理', '办理中', '已办结'],
  治理万家: ['待派发', '已派发', '处置中', '已办结', '已归档'],
  告警: ['待处置', '处置中', '已处置', '已归档']
}
export const FLOW_BY_RESOURCE = {
  serviceRequests: '办事', governanceEvents: '治理万家', alarms: '告警'
}

/** V2.4 业务时限（SLA）：待办在对应起始时刻后超过阈值即标记超期，仅作提醒，不改变状态机 */
export const FLOW_SLA_HOURS = { 办事: 48, 治理万家: 24, 告警: 4 }
/** 计时起点字段；缺失时回退 created_at / updated_at，仍缺失则视为「无起算时间，不判超期」 */
export const SLA_START_FIELD = {
  serviceRequests: 'submitTime', governanceEvents: 'reportTime', alarms: 'alarmTime'
}
/** 撤回：只允许撤回本人上一步流转，且必须在窗口内；退回：正式业务回退，需填写原因且限管理层角色 */
export const REVOKE_WINDOW_MINUTES = 30
export const RETURN_ROLES = ['district', 'street', 'community']

/**
 * V2.6 审计加固：写入流转留痕 / 办理意见 / 进度消息的文本边界。
 * 这些文本会同时落到业务字段、消息正文、FTS 索引与 Excel 导出，
 * 不接受任意长度、非字符串或 HTML 标记（居民端与前端均为文本插值渲染）。
 */
export const REMARK_MAX_LENGTH = 500
export const SEARCH_KEYWORD_MAX_LENGTH = 100
export const SEARCH_MAX_LIMIT = 200
/** 组织 / 网格编码格式：纯数字，长度与行政区划编码规范一致 */
export const ORG_CODE_RE = /^\d{6,20}$/
/** 居民端公开消息：进度类消息含申请人姓名与内部办理意见，只能经三要素查询返回给本人 */
export const RESIDENT_PRIVATE_MESSAGE_RE = /进度|办理|派发|处置|核查/

/** 导出字段中文表头 */
export const FIELD_LABELS = {
  id: '编号', code: '编号', gridCode: '网格编码', orgCode: '组织编码', parentCode: '上级编码', streetCode: '街道编码',
  name: '名称', gridName: '网格名称', orgName: '组织名称', title: '标题', label: '名称',
  idcard: '身份证号', phone: '手机号', contact: '联系方式', applicantPhone: '申请人电话', reporterPhone: '上报人电话',
  type: '类型', purpose: '用途', status: '状态', level: '层级', levelName: '层级名称', theme: '主题',
  partyMemberCount: '党员数', populationCount: '人口数', leaderId: '网格长ID', workerIds: '网格员ID',
  leader: '负责人', qrUrl: '便民码链接', lng: '经度', lat: '纬度', createTime: '创建时间',
  memberName: '党员姓名', memberId: '党员ID', orgId: '党组织ID', joinDate: '入党时间', excellent: '优秀党员',
  education: '学历', volunteerHours: '志愿服务学时', gender: '性别', age: '年龄', tags: '特殊群体标签',
  address: '住址', area: '面积(㎡)', unit: '单元', room: '房号', buildingId: '建筑ID',
  buildingType: '建筑类型', floors: '层数', households: '户数', buildYear: '建成年份',
  creditCode: '统一社会信用代码', legalPerson: '法人', registerDate: '注册日期',
  manager: '负责人', propertyCompany: '物业公司', householdsCount: '户数', remark: '备注',
  publishTime: '发布时间', readCount: '阅读量', publisher: '发布人', views: '浏览量', summary: '摘要',
  applicant: '申请人', item: '事项', submitTime: '提交时间', handler: '办理人', opinion: '办理意见', content: '内容',
  reporter: '上报人', location: '地点', reportTime: '上报时间', dispatcher: '派发人', result: '处置结果',
  photos: '现场照片数', description: '描述', deviceId: '设备ID', deviceName: '设备名称',
  alarmTime: '告警时间', snapshot: '抓拍图', handleTime: '处置时间', assignee: '处置人',
  party: '签约方', amount: '合同金额(元)', startDate: '开始日期', endDate: '到期日期', modules: '订阅模块数',
  bizType: '业务类型', bizId: '业务编号', from: '原状态', to: '目标状态', operator: '操作人', time: '时间',
  direction: '流动方向', fromOrg: '原组织', toOrg: '流向组织', flowDate: '流动日期',
  meetingDate: '会议时间', place: '地点', host: '主持人', attendees: '参会人数',
  hours: '学时', progress: '学习进度(%)', attachments: '附件数', category: '分类',
  period: '历史时期', column: '二级栏目', cover: '封面', awardDate: '获奖日期', secretary: '书记',
  establishDate: '成立日期', memberCount: '党员数', installDate: '安装日期', lastHeartbeat: '最后心跳',
  value: '实时读数', lastValue: '读数', flowStatus: '办理状态', opinionText: '意见',
  version: '版本号', action: '操作类型', revokedAt: '撤回时间'
}

export const IMPORT_TEMPLATES = {
  partyMembers: {
    label: '党员信息导入模板',
    columns: [
      { key: 'name', label: '姓名' }, { key: 'idcard', label: '身份证号' }, { key: 'phone', label: '手机号' },
      { key: 'orgCode', label: '所属党组织编码' }, { key: 'joinDate', label: '入党时间(YYYY-MM-DD)' },
      { key: 'status', label: '党员状态' }
    ]
  },
  population: {
    label: '人口信息导入模板',
    columns: [
      { key: 'name', label: '姓名' }, { key: 'idcard', label: '身份证号' }, { key: 'phone', label: '手机号' },
      { key: 'type', label: '人口类型' }, { key: 'age', label: '年龄' }, { key: 'gender', label: '性别' },
      { key: 'gridCode', label: '网格编码' }, { key: 'tags', label: '特殊群体标签' }, { key: 'address', label: '住址' }
    ]
  }
}
