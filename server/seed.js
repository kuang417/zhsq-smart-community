/**
 * 智慧社区治理平台 Demo —— 种子数据生成器
 * ------------------------------------------------------------
 * 对应说明书 5.1 / 5.2 / 5.3：四级组织编码前缀、约30张业务实体、
 * 118 网格 + 2万+人口 + 5万+房屋铺满，敏感字段存储与展示分离。
 *
 * 固定随机种子 => 每次生成的数据完全一致，便于演示与回归。
 * 用法：npm run seed（不存在则生成） / npm run reset（强制重置）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HISTORY_PERIODS, HISTORY_COLS, buildHistoryContent } from './history-content.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const FORCE = process.argv.includes('--force')
const BULK_FILE = path.join(DATA_DIR, 'bulk.json')
const DB_FILE = path.join(DATA_DIR, 'db.json')

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
if (!FORCE && fs.existsSync(BULK_FILE) && fs.existsSync(DB_FILE)) {
  console.log('[seed] 数据已存在，跳过生成（如需重置请执行 npm run reset）')
  process.exit(0)
}

/* ---------------- 随机工具（固定种子） ---------------- */
let seedState = 20261104
const rnd = () => ((seedState = (seedState * 1664525 + 1013904223) >>> 0) / 4294967296)
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = (arr) => arr[ri(0, arr.length - 1)]
const chance = (p) => rnd() < p
const pad = (n, len) => String(n).padStart(len, '0')

const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤'.split('')
const GIVEN_M = ['伟', '强', '磊', '军', '洋', '勇', '杰', '涛', '明', '超', '建国', '志远', '文博', '海峰', '嘉豪', '宇轩', '浩然', '子墨', '建华', '国强']
const GIVEN_F = ['芳', '娜', '敏', '静', '丽', '秀英', '燕', '霞', '婷', '慧', '晓琳', '思雨', '欣怡', '桂兰', '玉梅', '梓萱', '若曦', '淑珍', '春梅', '雅琴']
const name = () => pick(SURNAMES) + (chance(0.5) ? pick(GIVEN_M) : pick(GIVEN_F))
const phone = () => '1' + pick(['3', '5', '7', '8', '9']) + pad(ri(0, 999999999), 9)
const idcard = (age) => {
  const y = 2026 - age
  return '450102' + y + pad(ri(1, 12), 2) + pad(ri(1, 28), 2) + pad(ri(0, 999), 3) + pad(ri(0, 9), 1)
}
const dateStr = (daysAgo, withTime = true) => {
  const d = new Date(Date.UTC(2026, 10, 8, 3, 0, 0) - daysAgo * 86400000 - ri(0, 86400000))
  const s = d.toISOString().slice(0, 10)
  return withTime ? s + ' ' + pad(ri(7, 20), 2) + ':' + pad(ri(0, 59), 2) + ':' + pad(ri(0, 59), 2) : s
}
const creditCode = () => '91450102MA' + pad(ri(0, 999999), 6) + pick('ABCDEFGHJKLMNPQRTUWXY') + pad(ri(0, 99), 2)

/* ---------------- 四级组织树（组织编码前缀规则） ---------------- */
const DISTRICT = { code: '450102', name: '兴宁区' }
const STREETS = [
  { name: '民生街道', communityCount: 4 },
  { name: '朝阳街道', communityCount: 4 },
  { name: '兴东街道', communityCount: 3 },
  { name: '三塘街道', communityCount: 3 }
]
const COMMUNITY_NAMES = [
  '民生社区', '解放社区', '和平社区', '新华社区',
  '朝阳社区', '华东社区', '望州社区', '长堽社区',
  '兴东社区', '五村岭社区', '燕子岭社区',
  '三塘社区', '那况社区', '同仁社区'
]
const AREA = { minLng: 108.2800, minLat: 22.7800, maxLng: 108.3600, maxLat: 22.8600 }

const orgs = []
const grids = []
const persons = []
let personSeq = 0
const addPerson = (role, orgCode, gridCode) => {
  const p = { id: 'P' + pad(++personSeq, 5), name: name(), phone: phone(), role, orgCode, gridCode: gridCode || '', title: role }
  persons.push(p)
  return p
}

orgs.push({
  orgCode: DISTRICT.code, orgName: DISTRICT.name, orgLevel: 1, parentCode: '',
  levelName: '区', bounds: [AREA.minLng, AREA.minLat, AREA.maxLng, AREA.maxLat], leader: addPerson('区级负责人', DISTRICT.code).id
})
const streetBounds = []
STREETS.forEach((s, si) => {
  const col = si % 2, row = Math.floor(si / 2)
  const b = [
    AREA.minLng + col * 0.04, AREA.minLat + row * 0.04,
    AREA.minLng + (col + 1) * 0.04, AREA.minLat + (row + 1) * 0.04
  ]
  streetBounds.push(b)
  const code = DISTRICT.code + pad(si + 1, 2)
  orgs.push({ orgCode: code, orgName: s.name, orgLevel: 2, parentCode: DISTRICT.code, levelName: '街道', bounds: b, leader: addPerson('街道负责人', code).id })
})

let communityIndex = 0
STREETS.forEach((s, si) => {
  const sCode = DISTRICT.code + pad(si + 1, 2)
  const b = streetBounds[si]
  const cols = 2, rows = Math.ceil(s.communityCount / cols)
  const cw = (b[2] - b[0]) / cols, ch = (b[3] - b[1]) / rows
  for (let ci = 0; ci < s.communityCount; ci++) {
    const col = ci % cols, row = Math.floor(ci / cols)
    const cb = [b[0] + col * cw, b[1] + row * ch, b[0] + (col + 1) * cw, b[1] + (row + 1) * ch]
    const cCode = sCode + pad(ci + 1, 2)
    const cName = COMMUNITY_NAMES[communityIndex++]
    orgs.push({ orgCode: cCode, orgName: cName, orgLevel: 3, parentCode: sCode, levelName: '社区', bounds: cb, leader: addPerson('社区书记', cCode).id })
  }
})

// 118 个网格：14 个社区，前 6 个各 9 个、后 8 个各 8 个
const communityOrgs = orgs.filter((o) => o.orgLevel === 3)
let gridSeq = 0
communityOrgs.forEach((c, ci) => {
  const count = ci < 6 ? 9 : 8
  const b = c.bounds
  for (let gi = 1; gi <= count; gi++) {
    gridSeq++
    const gCode = c.orgCode + pad(gi, 2)
    const leader = addPerson('网格长', c.orgCode, gCode)
    const workers = [addPerson('网格员', c.orgCode, gCode)]
    if (chance(0.6)) workers.push(addPerson('网格员', c.orgCode, gCode))
    const lng = +(b[0] + (b[2] - b[0]) * (0.12 + 0.76 * rnd())).toFixed(6)
    const lat = +(b[1] + (b[3] - b[1]) * (0.12 + 0.76 * rnd())).toFixed(6)
    orgs.push({
      orgCode: gCode, orgName: `${c.orgName}第${pad(gi, 2)}网格`, orgLevel: 4, parentCode: c.orgCode,
      levelName: '网格', bounds: [lng - 0.0016, lat - 0.0014, lng + 0.0016, lat + 0.0014], leader: leader.id
    })
    grids.push({
      id: 'G' + pad(gridSeq, 4), gridCode: gCode, gridName: `${c.orgName}第${pad(gi, 2)}网格`,
      orgCode: gCode, parentCode: c.orgCode, streetCode: c.orgCode.slice(0, 8),
      lng, lat, leaderId: leader.id, workerIds: workers.map((w) => w.id),
      partyMemberCount: ri(8, 46), populationCount: ri(120, 240),
      qrUrl: '/resident?grid=' + gCode, createTime: dateStr(ri(300, 900))
    })
  }
})
console.log('[seed] 组织节点', orgs.length, '网格', grids.length)

/* ---------------- 静态大表：人口 / 房屋 / 建筑 / 部件 ---------------- */
const POP_TYPES = ['户籍', '常住', '未落户', '流动', '境外', '系统未分配']
const TAGS = ['空巢老人', '独居老人', '残疾人', '优抚对象', '社区矫正', '安置帮教', '刑满释放', '吸毒人员', '重点青少年']
const AGE_BANDS = [[0, 6], [7, 17], [18, 35], [36, 45], [46, 55], [56, 65], [66, 100]]

// 紧凑数组存储：[id, 姓名, 身份证, 手机, 类型, 年龄, 性别, 网格编码, 标签, 住址]
const population = []
const POP_TOTAL = 20860
for (let i = 1; i <= POP_TOTAL; i++) {
  const g = grids[(i * 7 + Math.floor(i / 13)) % grids.length]
  const age = ri(0, 96)
  let type = pick(POP_TYPES)
  if (rnd() < 0.46) type = '户籍'
  else if (rnd() < 0.5) type = '常住'
  const tags = []
  if (age >= 65 && chance(0.42)) tags.push(pick(['空巢老人', '独居老人']))
  if (chance(0.035)) tags.push(pick(TAGS.slice(2)))
  if (tags.length === 0 && age < 18 && chance(0.08)) tags.push('重点青少年')
  population.push([
    'R' + pad(i, 6), name(), idcard(age), phone(), type, age,
    chance(0.51) ? '男' : '女', g.gridCode, tags.join(','),
    `${g.gridName}${ri(1, 18)}栋${ri(1, 4)}单元${ri(101, 2501)}室`
  ])
}

// 组织 / 人员主数据一处维护：网格人口数由人口主数据实时回填，保证全局联动一致
const popCountByGrid = new Map()
population.forEach((p) => popCountByGrid.set(p[7], (popCountByGrid.get(p[7]) || 0) + 1))
grids.forEach((g) => { g.populationCount = popCountByGrid.get(g.gridCode) || 0 })

const buildings = []
let buildingSeq = 0
const BUILD_USE = ['居住', '居住', '居住', '商务', '其他']
for (const g of grids) {
  const n = ri(5, 7)
  for (let i = 1; i <= n; i++) {
    buildingSeq++
    const use = pick(BUILD_USE)
    buildings.push({
      id: 'B' + pad(buildingSeq, 5),
      name: `${g.gridName.replace(/第\d+网格$/, '')}${pad(i, 2)}号楼`,
      buildingType: pick(['多层住宅', '高层住宅', '商住两用', '商业楼宇', '公共配套']),
      purpose: use, orgCode: g.orgCode, gridCode: g.gridCode,
      streetCode: g.streetCode,
      lng: +(g.lng + (rnd() - 0.5) * 0.003).toFixed(6),
      lat: +(g.lat + (rnd() - 0.5) * 0.003).toFixed(6),
      floors: use === '居住' ? ri(6, 32) : ri(2, 18),
      households: 0, buildYear: ri(1992, 2023), status: chance(0.96) ? '正常' : '维修中'
    })
  }
}

// 紧凑数组：[id, 房屋编码, 建筑id, 单元, 房号, 面积, 网格编码, 用途]
const houses = []
const HOUSE_TOTAL = 50120
for (let i = 1; i <= HOUSE_TOTAL; i++) {
  const b = buildings[i % buildings.length]
  b.households++
  houses.push([
    'H' + pad(i, 6), 'FW' + pad(i, 7), b.id, ri(1, 4), ri(101, 3204),
    +(ri(38, 168) + rnd()).toFixed(1), b.gridCode, b.purpose
  ])
}

const PART_TYPES = ['摄像头', '路灯', '健身器材', '宣传栏', '垃圾桶', '消防设施', '井盖', '其他']
const parts = []
for (let i = 1; i <= 1180; i++) {
  const g = grids[i % grids.length]
  parts.push({
    id: 'PT' + pad(i, 5), name: PART_TYPES[i % 8] + '-' + pad(i, 4), type: PART_TYPES[i % 8],
    orgCode: g.orgCode, gridCode: g.gridCode,
    lng: +(g.lng + (rnd() - 0.5) * 0.0032).toFixed(6),
    lat: +(g.lat + (rnd() - 0.5) * 0.0028).toFixed(6),
    status: chance(0.9) ? '正常' : pick(['故障', '维修中', '待更换']),
    installDate: dateStr(ri(30, 1200), false)
  })
}
console.log('[seed] 人口', population.length, '房屋', houses.length, '建筑', buildings.length, '部件', parts.length)

/* ---------------- 党建 ---------------- */
const partyOrgs = []
partyOrgs.push({ id: 'PO001', orgCode: '450102', name: '中共兴宁区委员会', level: '党委', parentId: '', memberCount: 0, secretary: name(), establishDate: '2008-06-01' })
STREETS.forEach((s, si) => partyOrgs.push({
  id: 'PO1' + pad(si + 1, 2), orgCode: DISTRICT.code + pad(si + 1, 2), name: `中共${s.name}工作委员会`,
  level: '党工委', parentId: 'PO001', memberCount: 0, secretary: name(), establishDate: dateStr(ri(2000, 5000), false)
}))
communityOrgs.forEach((c, ci) => {
  const pid = 'PO2' + pad(ci + 1, 2)
  partyOrgs.push({ id: pid, orgCode: c.orgCode, name: `中共${c.orgName}总支部委员会`, level: '党总支', parentId: 'PO1' + pad(Math.floor(ci / 4) + 1, 2), memberCount: 0, secretary: name(), establishDate: dateStr(ri(1000, 4000), false) })
})
// 党支部挂在党总支下
communityOrgs.forEach((c, ci) => {
  const parent = partyOrgs.find((p) => p.id === 'PO2' + pad(ci + 1, 2))
  for (let k = 1; k <= 2; k++) partyOrgs.push({
    id: `PO3${pad(ci + 1, 2)}${k}`, orgCode: c.orgCode, name: `中共${c.orgName}第${k}支部`, level: '党支部',
    parentId: parent.id, memberCount: 0, secretary: name(), establishDate: dateStr(ri(500, 3000), false)
  })
})

const partyMembers = []
for (let i = 1; i <= 860; i++) {
  const po = pick(partyOrgs.filter((p) => p.level === '党支部'))
  po.memberCount++
  const age = ri(22, 78)
  partyMembers.push({
    id: 'PM' + pad(i, 5), name: name(), idcard: idcard(age), phone: phone(),
    gender: chance(0.55) ? '男' : '女', orgId: po.id, orgCode: po.orgCode, orgName: po.name,
    joinDate: dateStr(ri(365, 12000), false), status: pick(['正式党员', '正式党员', '正式党员', '预备党员', '离退休党员']),
    excellent: chance(0.09), education: pick(['本科', '大专', '硕士', '高中', '中专']),
    volunteerHours: ri(0, 260)
  })
}
const honors = []
partyMembers.filter((m) => m.excellent).slice(0, 42).forEach((m, i) => honors.push({
  id: 'HR' + pad(i + 1, 4), memberId: m.id, memberName: m.name,
  title: pick(['优秀共产党员', '社区治理先进个人', '志愿服务标兵', '最美网格员', '抗疫先进个人']),
  level: pick(['区级', '街道级', '市级']), awardDate: dateStr(ri(30, 900), false),
  orgCode: m.orgCode, orgName: m.orgName, remark: '在基层治理工作中表现突出'
}))
const memberFlows = []
for (let i = 1; i <= 24; i++) {
  const m = pick(partyMembers)
  memberFlows.push({ id: 'MF' + pad(i, 3), memberId: m.id, memberName: m.name, direction: chance(0.5) ? '流入' : '流出', fromOrg: m.orgName, toOrg: pick(['外区单位', '市直机关', '外地党组织', '本区其他支部']), flowDate: dateStr(ri(5, 300), false), status: pick(['已办结', '办理中', '待审核']), handler: name(), orgCode: m.orgCode })
}
const MEETING_TYPES = ['支部党员大会', '支部委员会', '党小组会', '党课']
const meetings = []
for (let i = 1; i <= 48; i++) meetings.push({
  id: 'MT' + pad(i, 4), type: MEETING_TYPES[i % 4], orgId: pick(partyOrgs.filter((p) => p.level === '党支部')).id,
  orgCode: pick(communityOrgs).orgCode, title: `${MEETING_TYPES[i % 4]}（${ri(1, 12)}月）`,
  meetingDate: dateStr(ri(1, 330)), place: pick(['社区党群服务中心', '党员活动室', '网格微站会议室']),
  host: name(), attendees: ri(8, 42), content: pick(['学习党的二十大精神与基层治理相关论述', '讨论网格化服务管理工作安排', '研究重点人群关爱帮扶事项', '开展党纪学习教育专题研讨'])
})
const learnings = []
for (let i = 1; i <= 14; i++) learnings.push({
  id: 'LN' + pad(i, 3), title: pick(['习近平新时代中国特色社会主义思想学习纲要', '党史学习专题：伟大建党精神', '基层治理现代化专题辅导', '党纪学习教育读本', '社区网格员能力提升课程', '党的二十大报告辅导读本']) + `（第${i}期）`,
  category: pick(['政治理论', '党史教育', '业务能力', '党纪法规']), publishDate: dateStr(ri(1, 240), false),
  publisher: '区委组织部', hours: ri(2, 12), attachments: ri(0, 3), progress: ri(30, 100), content: '请各支部组织党员按期完成学习并上报进度。'
})
const historyLearn = []
HISTORY_PERIODS.forEach((p, pi) => HISTORY_COLS.forEach((c, ci) => historyLearn.push({
  id: `HL${pi}${ci}`, period: p, column: c, title: `${p}·${c}`,
  summary: `本栏目收录${p}关于${c}的专题资料，供党员群众在线学习查阅。`,
  content: buildHistoryContent(p, c),
  cover: `h${(pi * 8 + ci) % 12 + 1}`, views: ri(120, 4600)
})))

/* ---------------- 基础信息：企业 / 小区 ---------------- */
const ENTERPRISE_TYPES = ['商贸零售', '餐饮住宿', '信息技术', '物业服务', '教育培训', '医疗健康', '制造加工', '物流运输']
const enterprises = []
for (let i = 1; i <= 360; i++) {
  const g = grids[(i * 11) % grids.length]
  enterprises.push({
    id: 'E' + pad(i, 4), name: `${pick(['广西', '南宁', '兴宁'])}${pick(['恒信', '嘉和', '众诚', '宏远', '瑞丰', '新宇', '华润', '德胜', '华兴', '惠民'])}${pick(['商贸', '科技', '物业', '实业', '服务'])}有限公司`,
    creditCode: creditCode(), type: pick(ENTERPRISE_TYPES), address: `${g.gridName}${ri(1, 60)}号`,
    legalPerson: name(), contact: phone(), orgCode: g.orgCode, gridCode: g.gridCode,
    status: pick(['在营', '在营', '在营', '歇业']), registerDate: dateStr(ri(200, 4000), false)
  })
}
const COMM_TYPES = ['小区', '物业公司', '物管会', '驻地单位']
const communities = []
for (let i = 1; i <= 68; i++) {
  const g = grids[(i * 5) % grids.length]
  const type = COMM_TYPES[i % 4]
  communities.push({
    id: 'C' + pad(i, 4), name: `${pick(['翠竹', '金桂', '嘉和', '望州', '长堽', '明秀', '北湖', '南梧'])}${pick(['花园', '苑', '小区', '大厦'])}${type === '小区' ? '' : '·' + type}`,
    type, orgCode: g.orgCode, gridCode: g.gridCode, propertyCompany: type === '小区' ? pick(['南宁市安居物业', '兴宁区城市服务公司', '广西嘉和物业']) : '',
    manager: name(), phone: phone(), households: ri(120, 1800), address: `${g.gridName}${ri(1, 80)}号`, remark: ''
  })
}

/* ---------------- 便民服务 ---------------- */
const messages = []
const MSG_TYPES = ['公告', '预警通知', '办事进度']
for (let i = 1; i <= 42; i++) {
  const type = MSG_TYPES[i % 3]
  messages.push({
    id: 'M' + pad(i, 4), type, title: type === '公告' ? pick(['关于开展2026年度居民信息核实工作的通知', '社区邻里节活动公告', '冬季用火用电安全提示']) : type === '预警通知' ? pick(['高温橙色预警', '强降雨防范提醒', '消防通道占用告警']) : '您提交的申请状态已更新',
    content: '请居民朋友留意相关事项，详情可在本网格微站查看。', gridCode: grids[(i * 3) % grids.length].gridCode,
    orgCode: grids[(i * 3) % grids.length].orgCode, publishTime: dateStr(ri(0, 90)), readCount: ri(30, 1200), status: pick(['已发布', '已发布', '草稿'])
  })
}
const banners = Array.from({ length: 4 }, (_, i) => ({ id: 'BN' + (i + 1), title: ['党建引领基层治理', '便民服务一件事', '网格连心 服务到家', '共建美好家园'][i], image: 'banner' + (i + 1), link: '/portal', sort: i + 1, status: '启用' }))
const shortcuts = ['我要上报', '办事指南', '网格微站', '政策查询', '便民电话', '邻里互助', '志愿服务', '意见征集'].map((t, i) => ({ id: 'SC' + (i + 1), title: t, icon: 'Menu', link: '/resident', sort: i + 1, status: '启用' }))
const recommends = ['社区食堂', '养老服务站', '少儿托管', '家政服务'].map((t, i) => ({ id: 'RC' + (i + 1), title: t, sort: i + 1, status: '启用', link: '/resident' }))
const CONTENT_TYPES = ['社区新闻', '政策法规', '活动通知']
const contents = []
for (let i = 1; i <= 38; i++) contents.push({
  id: 'CT' + pad(i, 4), type: CONTENT_TYPES[i % 3],
  title: pick(['社区开展环境卫生整治行动', '关于调整城乡居民医保缴费标准的通知', '邻里节趣味运动会报名开始', '网格员入户走访重点人群', '2026年惠民政策解读', '消防安全进社区宣传活动']),
  orgCode: communityOrgs[i % communityOrgs.length].orgCode, publisher: name(),
  publishTime: dateStr(ri(0, 120)), views: ri(50, 3600), status: pick(['已发布', '已发布', '待审核']),
  summary: '为进一步提升社区治理服务水平，相关工作情况与政策内容公告如下。'
})

const SERVICE_ITEMS = ['居住证明开具', '高龄津贴申请', '低保救助申请', '生育登记', '医保参保登记', '公租房申请', '退役军人优待证', '灵活就业社保补贴']
const serviceRequests = []
for (let i = 1; i <= 32; i++) {
  const g = grids[(i * 17) % grids.length]
  const st = pick(['待受理', '待受理', '办理中', '办理中', '已办结'])
  serviceRequests.push({
    id: 'SR' + pad(i, 4), code: 'BS' + dateStr(0, false).replace(/-/g, '') + pad(i, 4),
    applicant: name(), applicantPhone: phone(), item: pick(SERVICE_ITEMS), gridCode: g.gridCode, orgCode: g.orgCode,
    status: st, submitTime: dateStr(ri(1, 60)), handler: st === '待受理' ? '' : name(),
    opinion: st === '已办结' ? '材料齐全，已办结并通知申请人' : '', content: '申请人已按要求提交材料，请予以办理。'
  })
}
const EVENT_TYPES = ['环境卫生', '设施损坏', '邻里纠纷', '安全隐患', '占道经营', '噪声扰民', '其他']
const governanceEvents = []
for (let i = 1; i <= 40; i++) {
  const g = grids[(i * 13) % grids.length]
  const st = pick(['待派发', '待派发', '已派发', '处置中', '处置中', '已办结', '已归档'])
  governanceEvents.push({
    id: 'GE' + pad(i, 4), code: 'ZW' + dateStr(0, false).replace(/-/g, '') + pad(i, 4),
    type: pick(EVENT_TYPES), title: pick(['楼道堆放杂物存在消防隐患', '小区路灯损坏需维修', '路面井盖破损', '夜间装修噪声扰民', '绿化带垃圾未清理', '停车位纠纷']),
    reporter: name(), reporterPhone: phone(), location: `${g.gridName}${ri(1, 30)}号`,
    gridCode: g.gridCode, orgCode: g.orgCode, status: st,
    reportTime: dateStr(ri(1, 45)), dispatcher: ['已派发', '处置中', '已办结', '已归档'].includes(st) ? name() : '',
    handler: ['处置中', '已办结', '已归档'].includes(st) ? name() : '',
    result: ['已办结', '已归档'].includes(st) ? '现场已处置完毕，居民确认满意' : '',
    photos: ri(1, 3), description: '居民通过便民码上报，请网格员现场核实处置。'
  })
}

/* ---------------- 感知平台：设备 / 告警 / 工单 ---------------- */
const SENSE_THEMES = ['环境感知', '安全感知', '健康监测', '智能停车', '居民生活']
const DEVICE_TYPES = {
  环境感知: ['空气质量监测', '噪声监测', '温湿度传感器', '水质监测'],
  安全感知: ['高清摄像头', '烟感报警器', '门禁道闸', '消防水压监测'],
  健康监测: ['健康一体机', '智能血压仪', '养老手环'],
  智能停车: ['车位地磁', '车牌识别相机', '充电桩'],
  居民生活: ['智能快递柜', '智能垃圾桶', '公共广播']
}
const devices = []
for (let i = 1; i <= 236; i++) {
  const theme = SENSE_THEMES[i % 5]
  const g = grids[(i * 9) % grids.length]
  devices.push({
    id: 'D' + pad(i, 4), code: 'SB' + pad(i, 5), name: pick(DEVICE_TYPES[theme]) + '-' + pad(i, 4),
    theme, type: pick(DEVICE_TYPES[theme]), gridCode: g.gridCode, orgCode: g.orgCode,
    location: `${g.gridName}${ri(1, 40)}号点位`,
    lng: +(g.lng + (rnd() - 0.5) * 0.003).toFixed(6), lat: +(g.lat + (rnd() - 0.5) * 0.003).toFixed(6),
    status: chance(0.92) ? '在线' : '离线', lastHeartbeat: dateStr(0), value: ri(10, 99), installDate: dateStr(ri(60, 900), false)
  })
}
const ALARM_TYPES = ['烟雾浓度超限', '消防通道占用', '人员聚集预警', '独居老人长时间未活动', '高空抛物', '垃圾满溢', '车辆违停', '水质异常']
const alarms = []
for (let i = 1; i <= 52; i++) {
  const d = devices[(i * 7) % devices.length]
  const st = pick(['待处置', '待处置', '处置中', '已处置', '已归档'])
  alarms.push({
    id: 'A' + pad(i, 4), code: 'BJ' + dateStr(0, false).replace(/-/g, '') + pad(i, 4),
    deviceId: d.id, deviceName: d.name, theme: d.theme, type: pick(ALARM_TYPES),
    location: d.location, gridCode: d.gridCode, orgCode: d.orgCode,
    alarmTime: dateStr(ri(0, 30)), level: pick(['紧急', '重要', '一般']),
    status: st, snapshot: 'CAM-' + pad(ri(1, 12), 2), handler: st === '待处置' ? '' : name(),
    handleTime: ['已处置', '已归档'].includes(st) ? dateStr(ri(0, 5)) : '', result: st === '已归档' ? '现场核查无异常，已归档' : ''
  })
}
const workOrders = []
for (let i = 1; i <= 34; i++) {
  const a = alarms[i % alarms.length]
  workOrders.push({
    id: 'W' + pad(i, 4), code: 'GD' + dateStr(0, false).replace(/-/g, '') + pad(i, 4),
    alarmId: a.id, deviceId: a.deviceId, title: a.type + '处置工单',
    assignee: name(), orgCode: a.orgCode, gridCode: a.gridCode,
    status: pick(['待接单', '处理中', '已完成']), createTime: dateStr(ri(0, 25)),
    finishTime: '', remark: '请按预案现场核查并回填结果'
  })
}

/* ---------------- 运营中心 ---------------- */
const CONTRACT_STATUS = ['签约', '试用', '到期预警', '终止']
const contracts = []
for (let i = 1; i <= 14; i++) {
  const s = pick(CONTRACT_STATUS)
  contracts.push({
    id: 'CT' + pad(i, 4), code: 'HT2026' + pad(i, 4),
    party: pick(STREETS).name + ' / ' + pick(['南宁城市运营公司', '广西数字政务服务公司', '兴宁区物业协会', '某科技有限公司']),
    status: s, amount: ri(8, 120) * 10000,
    startDate: dateStr(ri(200, 700), false), endDate: dateStr(-ri(15, 380), false),
    modules: ri(3, 10), contact: name(), phone: phone()
  })
}

/* ---------------- 流转记录 / 用户 / 字典 / 日志 ---------------- */
const flowLogs = []
let flowSeq = 0
const addFlow = (bizType, bizId, from, to, operator, remark) => {
  flowLogs.push({ id: 'FL' + pad(++flowSeq, 5), bizType, bizId, from, to, operator, time: dateStr(ri(0, 20)), remark: remark || '' })
}
serviceRequests.forEach((r) => {
  addFlow('办事', r.id, '', '待受理', r.applicant, '居民在线提交申请')
  if (r.status !== '待受理') addFlow('办事', r.id, '待受理', '办理中', r.handler, '已受理，材料审核中')
  if (r.status === '已办结') addFlow('办事', r.id, '办理中', '已办结', r.handler, r.opinion || '办结')
})
governanceEvents.forEach((e) => {
  addFlow('治理万家', e.id, '', '待派发', e.reporter, '居民扫码上报')
  if (e.status !== '待派发') addFlow('治理万家', e.id, '待派发', '已派发', e.dispatcher, '社区派发至网格员')
  if (['处置中', '已办结', '已归档'].includes(e.status)) addFlow('治理万家', e.id, '已派发', '处置中', e.handler, '网格员已到场')
  if (['已办结', '已归档'].includes(e.status)) addFlow('治理万家', e.id, '处置中', '已办结', e.handler, e.result)
  if (e.status === '已归档') addFlow('治理万家', e.id, '已办结', '已归档', e.dispatcher, '归档留存')
})
alarms.forEach((a) => {
  addFlow('告警', a.id, '', '待处置', '感知平台', '设备自动上报告警')
  if (a.status !== '待处置') addFlow('告警', a.id, '待处置', '处置中', a.handler, '已派单处置')
  if (['已处置', '已归档'].includes(a.status)) addFlow('告警', a.id, '处置中', '已处置', a.handler, '现场处置完成')
  if (a.status === '已归档') addFlow('告警', a.id, '已处置', '已归档', a.handler, '归档')
})

const users = [
  { id: 'U001', username: 'admin', password: 'admin123', name: '区级管理员', role: 'district', roleName: '区级管理员', orgCode: '450102', orgLevel: 1, orgName: '兴宁区', scopeDesc: '全区所有街道 / 社区 / 网格' },
  { id: 'U002', username: 'street', password: '123456', name: '街道管理员', role: 'street', roleName: '街道管理员', orgCode: '45010201', orgLevel: 2, orgName: '民生街道', scopeDesc: '本街道及下属 4 个社区 / 36 个网格' },
  { id: 'U003', username: 'community', password: '123456', name: '社区管理员', role: 'community', roleName: '社区管理员', orgCode: '4501020101', orgLevel: 3, orgName: '民生社区', scopeDesc: '本社区及下属 9 个网格' },
  { id: 'U004', username: 'grid', password: '123456', name: '网格员', role: 'grid', roleName: '网格员', orgCode: '450102010101', orgLevel: 4, orgName: '民生社区第01网格', scopeDesc: '仅本网格数据' }
]
const dicts = {
  popTypes: POP_TYPES, ageBands: AGE_BANDS.map(([a, b]) => (b >= 100 ? `${a}岁以上` : `${a}-${b}岁`)),
  tags: TAGS, partTypes: PART_TYPES, meetingTypes: MEETING_TYPES,
  senseThemes: SENSE_THEMES, contentTypes: CONTENT_TYPES, eventTypes: EVENT_TYPES,
  contractStatus: CONTRACT_STATUS, buildingUse: ['居住', '商务', '其他'], serviceItems: SERVICE_ITEMS
}
const opLogs = []

/* ---------------- 写出 ---------------- */
const bulk = { population, houses, buildings, parts }
const db = {
  meta: { version: '1.1', generatedAt: '2026-11-08 11:20:00', note: '智慧社区治理平台演示种子数据（固定随机种子）' },
  users, orgs, grids, persons, dicts, opLogs, flowLogs,
  partyOrgs, partyMembers, honors, memberFlows, meetings, learnings, learningProgress: [], historyLearn,
  enterprises, communities,
  messages, banners, shortcuts, recommends, contents, serviceRequests, governanceEvents,
  devices, alarms, workOrders, contracts
}
fs.writeFileSync(BULK_FILE, JSON.stringify(bulk))
fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 0))
console.log('[seed] 写入完成：bulk.json', (fs.statSync(BULK_FILE).size / 1024 / 1024).toFixed(2) + 'MB',
  '| db.json', (fs.statSync(DB_FILE).size / 1024 / 1024).toFixed(2) + 'MB')
console.log('[seed] 业务集合数：', Object.keys(db).length, ' 组织节点：', orgs.length, ' 网格：', grids.length,
  ' 人口：', population.length, ' 房屋：', houses.length)
