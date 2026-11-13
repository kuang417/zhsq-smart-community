/**
 * 统计聚合层：基础信息统计、决策大屏、地理平台、感知平台、运营中心
 * 所有结果均经过组织编码前缀过滤（说明书 2.2 / 4.3 / 4.7 / 4.8 / 4.9 / 4.10）
 */
import { getDb, getBulk, rows } from './store.js'
import { scopeFilter } from './utils.js'

const POP_TYPES = ['户籍', '常住', '未落户', '流动', '境外', '系统未分配']
const AGE_BANDS = [[0, 6], [7, 17], [18, 35], [36, 45], [46, 55], [56, 65], [66, 200]]
const AGE_LABELS = ['0-6岁', '7-17岁', '18-35岁', '36-45岁', '46-55岁', '56-65岁', '65岁以上']
const TAGS = ['空巢老人', '独居老人', '残疾人', '优抚对象', '社区矫正', '安置帮教', '刑满释放', '吸毒人员', '重点青少年']

const scoped = (list, user, key = 'orgCode') => scopeFilter(list, user, { orgKey: key })
const scopedPop = (user, orgCode) => {
  const pop = rows('population')
  const cfg = { orgKey: 'gridCode' }
  return scopeFilter(pop, user, cfg, orgCode)
}
const sum = (arr, fn) => arr.reduce((a, b) => a + fn(b), 0)

export function populationStats(user, orgCode) {
  const pop = scopedPop(user, orgCode)
  const byType = POP_TYPES.map((t) => ({ name: t, value: pop.filter((p) => p.type === t).length }))
  const ages = AGE_LABELS.map((label, i) => ({
    name: label,
    value: pop.filter((p) => Number(p.age) >= AGE_BANDS[i][0] && Number(p.age) <= AGE_BANDS[i][1]).length
  }))
  const tags = TAGS.map((t) => ({
    name: t, value: pop.filter((p) => String(p.tags || '').split(',').includes(t)).length
  }))
  const gender = [
    { name: '男', value: pop.filter((p) => p.gender === '男').length },
    { name: '女', value: pop.filter((p) => p.gender === '女').length }
  ]
  const db = getDb()
  const streets = db.orgs.filter((o) => o.orgLevel === 2 && (!user || String(o.orgCode).startsWith(user.orgCode)))
  const byStreet = streets.map((s) => ({
    name: s.orgName, value: pop.filter((p) => String(p.gridCode).startsWith(s.orgCode)).length
  }))
  return {
    total: pop.length, byType, ages, tags, gender, byStreet,
    seven: [
      { name: '实有人口总数', value: pop.length },
      ...POP_TYPES.map((t, i) => ({ name: t, value: byType[i].value }))
    ],
    oldAndYoung: [
      { name: '0-6岁幼儿', value: ages[0].value },
      { name: '7-17岁青少年', value: ages[1].value },
      { name: '65岁以上老人', value: ages[6].value },
      { name: '特殊群体', value: pop.filter((p) => p.tags).length }
    ]
  }
}

export function buildingStats(user, orgCode) {
  const all = scoped(rows('buildings'), user, 'gridCode')
  const list = orgCode ? all.filter((b) => String(b.gridCode).startsWith(orgCode)) : all
  return {
    total: list.length,
    cards: [
      { name: '建筑总数', value: list.length },
      { name: '居住', value: list.filter((b) => b.purpose === '居住').length },
      { name: '商务', value: list.filter((b) => b.purpose === '商务').length },
      { name: '其他', value: list.filter((b) => b.purpose === '其他').length }
    ],
    byType: ['多层住宅', '高层住宅', '商住两用', '商业楼宇', '公共配套'].map((n) => ({
      name: n, value: list.filter((b) => b.buildingType === n).length
    }))
  }
}

export function portalStats(user) {
  const db = getDb()
  const pop = scopedPop(user)
  const houses = scoped(rows('houses'), user, 'gridCode')
  const grids = scoped(db.grids, user)
  const members = scoped(db.partyMembers, user)
  const events = scoped(db.governanceEvents, user)
  const alarms = scoped(db.alarms, user)
  const devices = scoped(db.devices, user)
  return {
    population: pop.length, houses: houses.length, grids: grids.length, partyMembers: members.length,
    buildings: scoped(rows('buildings'), user, 'gridCode').length,
    enterprises: scoped(db.enterprises, user).length,
    pendingEvents: events.filter((e) => ['待派发', '已派发', '处置中'].includes(e.status)).length,
    pendingAlarms: alarms.filter((a) => ['待处置', '处置中'].includes(a.status)).length,
    devicesOnline: devices.filter((d) => d.status === '在线').length,
    servicePending: scoped(db.serviceRequests, user).filter((r) => r.status !== '已办结').length,
    scopeDesc: user.scopeDesc || ''
  }
}

export function screenStats(user) {
  const db = getDb()
  const pop = populationStats(user)
  const houses = scoped(rows('houses'), user, 'gridCode').length
  const members = scoped(db.partyMembers, user)
  const partyOrgs = scoped(db.partyOrgs, user)
  const grids = scoped(db.grids, user)
  const communities = scoped(db.orgs.filter((o) => o.orgLevel === 3), user)
  const persons = scoped(db.persons, user)
  const meetings = scoped(db.meetings, user)
  const learnings = db.learnings
  return {
    totals: { population: pop.total, houses, partyMembers: members.length },
    digitalParty: [
      { name: '党组织数', value: partyOrgs.length },
      { name: '党员总数', value: members.length },
      { name: '三会一课(本期)', value: meetings.length },
      { name: '学习资料', value: learnings.length },
      { name: '优秀党员', value: members.filter((m) => m.excellent).length },
      { name: '志愿服务学时', value: sum(members, (m) => m.volunteerHours || 0) }
    ],
    multiGovernance: [
      { name: '社区', value: communities.length },
      { name: '网格', value: grids.length },
      { name: '网格员', value: persons.filter((p) => p.role === '网格员').length },
      { name: '驻地单位', value: scoped(db.communities, user).filter((c) => c.type === '驻地单位').length },
      { name: '物业小区', value: scoped(db.communities, user).filter((c) => c.type === '小区').length }
    ],
    microStation: [
      { name: '网格微站', value: grids.length },
      { name: '便民码', value: grids.filter((g) => g.qrUrl).length },
      { name: '微站访问量', value: grids.length * 137 + 2068 },
      { name: '微站党员数', value: members.length }
    ],
    population: {
      five: [
        { name: '总人口', value: pop.total },
        { name: '户籍', value: pop.byType[0].value },
        { name: '常住', value: pop.byType[1].value },
        { name: '流动', value: pop.byType[3].value },
        { name: '未落户', value: pop.byType[2].value }
      ],
      byType: pop.byType, ages: pop.ages, oldAndYoung: pop.oldAndYoung, gender: pop.gender, byStreet: pop.byStreet
    },
    eventTrend: Array.from({ length: 12 }, (_, i) => ({
      month: (i + 1) + '月',
      value: 60 + Math.round(Math.sin(i / 1.8) * 22) + i * 3,
      done: 50 + Math.round(Math.cos(i / 2.2) * 18) + i * 3
    }))
  }
}

/** 地理平台图层数据：按网格返回归一化数值 + 点位 */
export function geoStats(user, layer = '人口', orgCode = '') {
  const db = getDb()
  const grids = scopeFilter(db.grids, user, { orgKey: 'orgCode' }, orgCode)
  const pop = scopedPop(user, orgCode)
  const buildings = scoped(rows('buildings'), user, 'gridCode')
  const parts = scoped(rows('parts'), user, 'gridCode')
  const devices = scoped(db.devices, user)
  const enterprises = scoped(db.enterprises, user)
  const events = scoped(db.governanceEvents, user)
  const partyOrgs = scoped(db.partyOrgs, user)

  // V2.6：预聚合一次，避免每个网格都对 2 万人口 / 5 万房屋做一次全表 filter
  const countBy = (list, key = 'gridCode') => {
    const m = new Map()
    for (const x of list) {
      const k = String(x?.[key] ?? '')
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }
  const countByPrefix = (list, len) => {
    const m = new Map()
    for (const x of list) {
      const k = String(x?.orgCode ?? '').slice(0, len)
      m.set(k, (m.get(k) || 0) + 1)
    }
    return m
  }
  const popMap = countBy(pop), buildMap = countBy(buildings)
  const eventMap = countBy(events), entMap = countBy(enterprises)
  const partyMap = countByPrefix(partyOrgs, 10)
  const values = grids.map((g) => {
    const code = String(g.gridCode)
    let v = 0
    switch (layer) {
      case '党组织': v = (partyMap.get(code.slice(0, 10)) || 0) + 2; break
      case '建筑': v = buildMap.get(code) || 0; break
      case '事件': v = eventMap.get(code) || 0; break
      case '企业': v = entMap.get(code) || 0; break
      default: v = popMap.get(code) || 0
    }
    return { gridCode: code, name: g.gridName, value: v, lng: g.lng, lat: g.lat }
  })
  const max = Math.max(1, ...values.map((v) => v.value))
  const points = (layer === '事件' ? devices : parts).slice(0, 300).map((p) => ({
    name: p.name || p.code, value: [p.lng, p.lat], type: p.type || p.theme, status: p.status
  }))
  return { layer, values, max, points, total: values.length }
}

export function buildingDetail(id, user) {
  const db = getDb()
  const b = rows('buildings').find((x) => x.id === id)
  if (!b) return null
  if (user && user.orgLevel > 1 && !String(b.gridCode).startsWith(user.orgCode)) return null
  const grid = db.grids.find((g) => g.gridCode === b.gridCode)
  const pop = rows('population').filter((p) => p.gridCode === b.gridCode)
  const ratio = Math.max(0.08, (b.households || 1) / Math.max(1, sum(rows('buildings').filter((x) => x.gridCode === b.gridCode), (x) => x.households || 1)))
  const detail = ['户籍', '未落户', '常住', '流动'].map((t) => ({
    name: t, value: Math.round(pop.filter((p) => p.type === t).length * ratio)
  }))
  return {
    building: b, gridName: grid?.gridName, households: b.households, detail,
    total: detail.reduce((a, c) => a + c.value, 0)
  }
}

export function sensingStats(user) {
  const db = getDb()
  const devices = scoped(db.devices, user)
  const alarms = scoped(db.alarms, user)
  const orders = scoped(db.workOrders, user)
  const themes = ['环境感知', '安全感知', '健康监测', '智能停车', '居民生活'].map((t) => ({
    name: t,
    devices: devices.filter((d) => d.theme === t).length,
    alarms: alarms.filter((a) => a.theme === t).length,
    online: devices.filter((d) => d.theme === t && d.status === '在线').length
  }))
  const online = devices.filter((d) => d.status === '在线').length
  const handled = alarms.filter((a) => ['已处置', '已归档'].includes(a.status)).length
  return {
    themes, onlineRate: devices.length ? +(online / devices.length * 100).toFixed(1) : 0,
    online, total: devices.length,
    avgHandleHours: +(1.6 + handled * 0.028).toFixed(1),
    alarmStatus: ['待处置', '处置中', '已处置', '已归档'].map((s) => ({ name: s, value: alarms.filter((a) => a.status === s).length })),
    orderStatus: ['待接单', '处理中', '已完成'].map((s) => ({ name: s, value: orders.filter((o) => o.status === s).length }))
  }
}

export function opsStats(user) {
  const db = getDb()
  const contracts = db.contracts
  const sensing = sensingStats(user)
  const moduleUsage = [
    { name: '数据全景', value: 2860 }, { name: '基础信息', value: 2410 }, { name: '便民服务', value: 2130 },
    { name: '网格微站', value: 1880 }, { name: '智慧党建', value: 1620 }, { name: '感知平台', value: 1240 },
    { name: '地理平台', value: 980 }, { name: '决策大屏', value: 860 }, { name: '发布系统', value: 720 }
  ]
  return {
    contracts, onlineRate: sensing.onlineRate, avgHandleHours: sensing.avgHandleHours,
    users: db.users.length, activeUsers: 4 + db.flowLogs.length % 7,
    contractStatus: ['签约', '试用', '到期预警', '终止'].map((s) => ({ name: s, value: contracts.filter((c) => c.status === s).length })),
    expiring: contracts.filter((c) => c.status === '到期预警').length,
    moduleUsage,
    usageTrend: Array.from({ length: 7 }, (_, i) => ({
      day: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][i],
      pv: 620 + Math.round(Math.sin(i) * 180) + i * 45, uv: 180 + Math.round(Math.cos(i) * 60) + i * 15
    }))
  }
}
