/**
 * 实时数据通道（V2.4 / V2.5 审计加固）
 *
 * 用 fetch 流式读取后端 SSE，而不是 EventSource：这样可以把 access token 放在
 * Authorization 头里（令牌只存内存），不出现在 URL / 查询串 / 日志中。
 *
 * 可靠性策略：
 *  - 断线按 1s → 2s → 4s …（上限 30s）指数退避重连，401 先用 refresh 换令牌再重连；
 *  - 连续两次连不上自动降级为 30s 轮询信号，页面仍会更新，只是不再是即时；
 *  - 页面切到后台时暂停分发，回到前台补一次刷新；
 *  - 服务端只推「哪类数据变了」的最小信号，真正的数据一律由原有带鉴权的 REST 接口重新拉取。
 *
 * 注意：本模块只做展示层刷新，绝不用于权限判断。
 */
import { ref, computed } from 'vue'
import { getToken } from '@/api/token'
import { refreshSession } from '@/api/request'

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

/** offline | connecting | live | polling —— 供顶栏如实展示连接状态 */
export const liveStatus = ref('offline')
export const liveUpdatedAt = ref('')
/** 统一口径文案：如实说明当前是实时推送还是降级轮询，不再笼统写「非实时」 */
export const liveLabel = computed(() => ({
  live: '实时通道已连接，数据变化自动刷新',
  polling: '实时通道暂不可用，已降级为 30 秒轮询',
  connecting: '正在连接实时通道，可手动刷新',
  offline: '实时通道未连接，请手动刷新'
}[liveStatus.value] || '实时通道状态未知'))
export const liveShort = computed(() => ({
  live: '实时', polling: '轮询', connecting: '连接中', offline: '未连接'
}[liveStatus.value] || ''))

const listeners = new Set()
let started = false
let stopped = false
let active = false
/** 代际编号：stopLive→startLive 快速切换时，旧连接的 finally 不得清掉新连接的 active 标记 */
let epoch = 0
let activeEpoch = -1
let controller = null
let retryTimer = null
let pollTimer = null
let retries = 0
let authFailures = 0

const notify = (evt) => {
  for (const fn of [...listeners]) {
    try { fn(evt) } catch (e) { /* 单个订阅者异常不影响其它页面 */ }
  }
}
export const onLive = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}
function startPolling() {
  if (pollTimer) return
  // 降级信号统一带 poll 主题，让所有 onLiveRefresh 订阅者按各自节流节奏刷新
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      notify({ type: 'poll', topics: ['poll', 'todo'], at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
    }
  }, 30000)
}
function scheduleReconnect(delay) {
  if (stopped) return
  const wait = delay || Math.min(30000, 1000 * (2 ** Math.min(retries, 5)))
  retries++
  if (retries >= 2) { liveStatus.value = 'polling'; startPolling() }
  else liveStatus.value = 'connecting'
  clearTimeout(retryTimer)
  retryTimer = setTimeout(connect, wait)
}

function handleFrame(frame) {
  let event = 'message'
  let data = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
    // ': ping' 心跳帧与 'id:' 序号帧无需分发
  }
  // 服务端主动关闭（新连接替换 / 到达最大生命周期）：显式通知订阅者，连接结束会自动重连
  if (event === 'closed') { notify({ type: 'closed', topics: [], at: '' }); return }
  if (event !== 'change' || !data) return
  try {
    const payload = JSON.parse(data)
    liveUpdatedAt.value = payload.at || ''
    notify({ ...payload, type: 'change' })
  } catch (e) { /* 忽略畸形帧 */ }
}

async function connect() {
  if (stopped) return
  const myEpoch = epoch
  if (active && activeEpoch === myEpoch) return
  const token = getToken()
  if (!token) { scheduleReconnect(2000); return }
  active = true
  activeEpoch = myEpoch
  controller = new AbortController()
  liveStatus.value = 'connecting'
  const alive = () => !stopped && epoch === myEpoch
  try {
    const res = await fetch(`${API_BASE}/events`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      credentials: 'include', cache: 'no-store', signal: controller.signal
    })
    if (res.status === 401) {
      let ok = false
      try { ok = await refreshSession() } catch (e) { ok = false }
      if (ok) { authFailures = 0; scheduleReconnect(1500); return }
      // refresh 也失败说明会话真正过期：不能无限重连，也不能停留在「仍在轮询」的假连接状态
      authFailures++
      if (authFailures >= 2) {
        stopLive()
        if (!window.location.pathname.startsWith('/login')) window.location.assign('/login')
        return
      }
      scheduleReconnect(1500)
      return
    }
    if (!res.ok || !res.body) { scheduleReconnect(); return }
    retries = 0
    authFailures = 0
    liveStatus.value = 'live'
    stopPolling()
    notify({ type: 'ready', topics: [], at: '' })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (alive()) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        handleFrame(frame)
      }
    }
    if (alive()) scheduleReconnect(800)
  } catch (e) {
    if (e?.name === 'AbortError') return
    if (alive()) scheduleReconnect()
  } finally {
    if (epoch === myEpoch) active = false
  }
}

function onVisibility() {
  if (stopped || document.visibilityState !== 'visible') return
  notify({ type: 'visible', topics: ['poll', 'todo'], at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) })
  if (liveStatus.value !== 'live') {
    clearTimeout(retryTimer)
    connect()
  }
}

export function startLive() {
  if (started) {
    // 只有「刚被 stopLive 关闭过」才需要换代；页面重复订阅不应打断已有连接
    if (stopped) { stopped = false; epoch++; active = false; activeEpoch = -1 }
    connect()
    return
  }
  started = true
  stopped = false
  document.addEventListener('visibilitychange', onVisibility)
  connect()
}

export function stopLive() {
  stopped = true
  epoch++
  try { controller?.abort() } catch (e) { /* 忽略 */ }
  controller = null
  clearTimeout(retryTimer)
  stopPolling()
  liveStatus.value = 'offline'
}

/**
 * 订阅「相关数据变了 → 节流刷新」。
 * @param fn 刷新函数（通常是重新拉取列表/统计）
 * @param opts.minInterval 最小刷新间隔（毫秒），避免批量写入时把页面刷爆
 * @param opts.topics 只关心这些主题；不传则接受所有变化信号
 * @returns 取消订阅函数（组件卸载时必须调用）
 */
export function onLiveRefresh(fn, { minInterval = 8000, topics = null } = {}) {
  // 连接是应用级的：独立全屏路由（/screen）不经过主布局，必须自带启动能力。
  // startLive() 幂等，多个页面同时订阅也只保持一条 SSE 连接。
  startLive()
  let last = 0
  let trailing = null
  let pending = null
  const fire = (evt) => {
    last = Date.now()
    if (trailing) { clearTimeout(trailing); trailing = null }
    pending = null
    try { fn(evt) } catch (e) { /* 由调用方自行处理请求异常 */ }
  }
  const off = onLive((evt) => {
    if (evt.type === 'ready' || evt.type === 'closed') return
    if (topics && Array.isArray(evt.topics) && !topics.some((t) => evt.topics.includes(t))) return
    if (document.visibilityState !== 'visible') { pending = evt; return }
    const wait = Math.max(0, minInterval - (Date.now() - last))
    if (wait === 0) return fire(evt)
    pending = evt
    if (!trailing) trailing = setTimeout(() => { if (pending) fire(pending) }, wait)
  })
  const onVis = () => {
    if (document.visibilityState === 'visible' && (pending || Date.now() - last > minInterval)) {
      fire(pending || { type: 'visible', topics: ['poll'] })
    }
  }
  document.addEventListener('visibilitychange', onVis)
  return () => {
    off()
    if (trailing) clearTimeout(trailing)
    document.removeEventListener('visibilitychange', onVis)
  }
}
