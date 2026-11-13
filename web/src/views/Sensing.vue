<template>
  <div class="dark-view">
    <div class="dark-head">
      <div>
        <h1>感 知 平 台</h1>
        <div class="muted" style="color:#8fb4e6">五大主题 · 事件预警 · 设备 / 告警 / 工单三块联动 · 告警状态机</div>
        <div class="data-stamp">统计口径：当前角色可见范围内已入库台账 ｜ 数据截至 {{ updatedAt || '加载中' }}（{{ liveLabel }}） ｜ 视频抓拍通道未接入</div>
      </div>
      <div class="flex gap8">
        <el-switch v-model="showLayer" active-text="网格图层" inactive-text="底图收起" style="--el-switch-on-color:#1d4ed8" />
        <el-tag type="success" effect="dark">设备在线率 {{ stat.onlineRate }}%</el-tag>
        <el-button size="small" :icon="'Refresh'" :loading="reloading" @click="load">刷新数据</el-button>
        <el-button size="small" @click="$router.push('/portal')">返回工作台</el-button>
      </div>
    </div>

    <!-- 五大主题 -->
    <div class="grid-sensing-themes">
      <div v-for="t in stat.themes" :key="t.name" class="panel-dark" style="cursor:pointer;text-align:center"
        :style="theme === t.name ? 'border-color:#38bdf8;box-shadow:0 0 16px rgba(56,189,248,.3)' : ''" @click="theme = theme === t.name ? '' : t.name">
        <div style="color:#7dd3fc;font-size:13px;font-weight:700">{{ t.name }}</div>
        <div style="font-size:23px;font-weight:800;color:#fff;margin:6px 0">{{ t.devices }}</div>
        <div style="font-size:11px;color:#8fb4e6">设备 {{ t.online }} 在线 ｜ 告警 <span style="color:#fb7185">{{ t.alarms }}</span></div>
      </div>
    </div>

    <!-- 事件预警 -->
    <div class="panel-dark" style="margin-bottom:12px;border-color:rgba(248,113,113,.45)">
      <h3 style="color:#fca5a5">⚠ 事件预警（红色告警框）</h3>
      <div class="grid-sensing-alerts">
        <div v-for="a in urgentAlarms" :key="a.id" class="flex gap12" style="background:rgba(127,29,29,.22);border:1px solid rgba(248,113,113,.35);border-radius:8px;padding:10px;cursor:pointer" @click="selectAlarm(a)">
          <!-- 演示模式显示明确标注的示意画面；生产模式显示无图像占位，不伪装成实时抓拍 -->
          <div v-if="DEMO_MODE" class="alarm-snapshot" style="width:130px;flex-shrink:0" title="示意画面，非真实抓拍"><div class="scan-line"></div></div>
          <div v-else class="alarm-no-image">暂无抓拍图像<br>视频 / 抓拍通道未接入</div>
          <div style="font-size:11px;line-height:1.9;color:#fecaca;min-width:0">
            <div style="font-weight:700;color:#fff;font-size:13px">{{ a.type }}</div>
            <div>时间：{{ a.alarmTime }}</div>
            <div>地点：{{ a.location }}</div>
            <div>级别：<span style="color:#f87171">{{ a.level }}</span> ｜ {{ a.status }}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid-sensing">
      <!-- 设备台账 -->
      <div class="panel-dark">
        <h3>设备台账 <span class="muted" style="color:#8fb4e6">（点击联动）</span></h3>
        <el-input v-model="deviceKw" placeholder="检索设备 / 点位" size="small" clearable style="margin-bottom:8px" />
        <div style="max-height:330px;overflow:auto">
          <div v-for="d in shownDevices" :key="d.id" class="link-row" :class="{ active: selectedDevice?.id === d.id }" @click="selectDevice(d)">
            <div class="flex gap8"><el-tag size="small" :type="d.status === '在线' ? 'success' : 'danger'">{{ d.status }}</el-tag><strong>{{ d.name }}</strong></div>
            <div class="muted" style="color:#8fb4e6">{{ d.location }} ｜ 读数 {{ d.value }}</div>
          </div>
        </div>
      </div>

      <!-- 告警流 -->
      <div class="panel-dark">
        <h3>告警流 <span class="muted" style="color:#8fb4e6">（状态机：待处置→处置中→已处置→已归档）</span></h3>
        <div class="flex gap8" style="margin-bottom:8px">
          <el-button v-if="DEMO_MODE" size="small" type="danger" plain @click="jumpDemo">跳步演示（示意，应被拦截）</el-button>
          <el-button size="small" @click="openFlows">查看流转留痕</el-button>
          <span class="spacer"></span>
          <span class="muted" style="color:#8fb4e6">{{ shownAlarms.length }} 条</span>
        </div>
        <div style="max-height:330px;overflow:auto">
          <div v-for="a in shownAlarms" :key="a.id" class="link-row" :class="{ active: selectedAlarm?.id === a.id }" @click="selectAlarm(a)">
            <div class="flex gap8">
              <el-tag size="small" :type="statusType(a.status)">{{ a.status }}</el-tag>
              <strong>{{ a.type }}</strong>
              <span class="spacer"></span>
              <el-button link type="primary" size="small" @click.stop="openTransition(a)">流转</el-button>
            </div>
            <div class="muted" style="color:#8fb4e6">{{ a.alarmTime }} ｜ {{ a.deviceName }} ｜ {{ a.location }}</div>
          </div>
        </div>
      </div>

      <!-- 工单 + 图层 -->
      <div>
        <div class="panel-dark" style="margin-bottom:12px">
          <h3>处置工单（联动）</h3>
          <div style="max-height:210px;overflow:auto">
            <div v-for="w in shownOrders" :key="w.id" class="link-row">
              <div class="flex gap8"><el-tag size="small" :type="statusType(w.status)">{{ w.status }}</el-tag><strong>{{ w.code }}</strong></div>
              <div class="muted" style="color:#8fb4e6">{{ w.title }} ｜ 处置人 {{ w.assignee }}</div>
            </div>
            <el-empty v-if="!shownOrders.length" description="该设备暂无关联工单" :image-size="50" />
          </div>
        </div>
        <div class="panel-dark">
          <h3>网格区域图层</h3>
          <EChart v-if="showLayer" :option="layerOption" height="170px" />
          <div v-else style="height:170px;display:grid;place-items:center;color:#64748b;font-size:12px">底图已收起（仅显示台账数据）</div>
        </div>
      </div>
    </div>

    <!-- 状态流转 dialog -->
    <el-dialog v-model="transVisible" title="告警状态流转" width="460px">
      <el-alert type="warning" :closable="false" style="margin-bottom:12px"
        :title="`当前状态：${current?.status}　合法下一状态：${legalNext || '无'}`"
        description="选择跨级状态提交，将被状态机拦截并提示「跳步被系统拦截」" />
      <el-form label-width="90px">
        <el-form-item label="目标状态"><el-select v-model="target" style="width:100%">
          <el-option v-for="s in alarmStates" :key="s" :label="s + (s === legalNext ? '  ✓ 合法' : '  ✗ 跳步')" :value="s" />
        </el-select></el-form-item>
        <el-form-item label="处置意见"><el-input v-model="remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="transVisible = false">取消</el-button><el-button type="primary" @click="submitTransition">提交</el-button></template>
    </el-dialog>

    <el-drawer v-model="flowVisible" title="告警流转留痕" size="420px"><FlowTimeline :items="flowItems" /></el-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import { useUserStore } from '@/stores/user'
import { statusType } from '@/utils/format'
import { DEMO_MODE } from '@/utils/app'
import EChart from '@/components/EChart.vue'
import FlowTimeline from '@/components/FlowTimeline.vue'
import { liveLabel, onLiveRefresh } from '@/utils/live'
import { escHtml } from '@/utils/esc'

const store = useUserStore()
const stat = ref({ themes: [], onlineRate: 0, alarmStatus: [] })
const devices = ref([]), alarms = ref([]), orders = ref([])
const theme = ref(''), deviceKw = ref('')
const selectedDevice = ref(null), selectedAlarm = ref(null)
const showLayer = ref(true)
const alarmStates = ['待处置', '处置中', '已处置', '已归档']
const transVisible = ref(false), current = ref(null), target = ref(''), remark = ref('')
const flowVisible = ref(false), flowItems = ref([])
const updatedAt = ref('')
const reloading = ref(false)
const legalNext = computed(() => alarmStates[alarmStates.indexOf(current.value?.status) + 1] || '')

const shownDevices = computed(() => devices.value.filter((d) =>
  (!theme.value || d.theme === theme.value) && (!deviceKw.value || (d.name + d.location).includes(deviceKw.value))
))
const shownAlarms = computed(() => alarms.value.filter((a) =>
  (!theme.value || a.theme === theme.value) && (!selectedDevice.value || a.deviceId === selectedDevice.value.id)
))
const shownOrders = computed(() => orders.value.filter((o) =>
  !selectedAlarm.value ? (!selectedDevice.value || o.deviceId === selectedDevice.value.id) : o.alarmId === selectedAlarm.value.id
))
const urgentAlarms = computed(() => alarms.value.filter((a) => ['待处置', '处置中'].includes(a.status)).slice(0, 3))

const selectDevice = (d) => { selectedDevice.value = selectedDevice.value?.id === d.id ? null : d; selectedAlarm.value = null }
const selectAlarm = (a) => { selectedAlarm.value = a; selectedDevice.value = devices.value.find((d) => d.id === a.deviceId) || null }
const openTransition = (a) => {
  current.value = a
  target.value = alarmStates[alarmStates.indexOf(a.status) + 1] || a.status
  remark.value = ''
  transVisible.value = true
}
const jumpDemo = () => {
  const a = alarms.value.find((x) => x.status === '待处置')
  if (!a) return ElMessage.warning('暂无待处置告警可用于跳步演示')
  current.value = a; target.value = '已归档'; remark.value = '演示非法跳步'; transVisible.value = true
}
const submitTransition = async () => {
  try {
    await api.transition({ resource: 'alarms', id: current.value.id, to: target.value, remark: remark.value, operator: store.user?.name })
    ElMessage.success(`流转成功：${current.value.status} → ${target.value}，工单状态已联动更新`)
    transVisible.value = false
    await load()
  } catch (e) { /* 拦截器提示跳步拦截 */ }
}
const openFlows = async () => {
  const id = selectedAlarm.value?.id || alarms.value[0]?.id
  flowItems.value = id ? await api.flows({ bizType: '告警', bizId: id }) : []
  flowVisible.value = true
}
const layerOption = computed(() => ({
  backgroundColor: 'transparent',
  tooltip: { formatter: (p) => `${escHtml(p.name)}<br/>状态：${escHtml(p.data?.raw?.status || '-')}` },
  grid: { left: 40, right: 12, top: 10, bottom: 26 },
  xAxis: { type: 'value', min: 108.27, max: 108.37, show: false },
  yAxis: { type: 'value', min: 22.77, max: 22.87, show: false },
  series: [{ type: 'scatter', symbolSize: 6, itemStyle: { color: '#38bdf8', opacity: .75 },
    data: devices.value.slice(0, 240).map((d) => ({ name: d.name, value: [d.lng, d.lat], raw: d })) }]
}))

const load = async () => {
  reloading.value = true
  try {
    const [s, d, a, o] = await Promise.all([
      api.sensingStats(), api.list('devices', { pageSize: 500 }),
      api.list('alarms', { pageSize: 200 }), api.list('workOrders', { pageSize: 200 })
    ])
    stat.value = s; devices.value = d.records; alarms.value = a.records; orders.value = o.records
    updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } finally { reloading.value = false }
}
let offLive = null
onMounted(() => {
  load()
  offLive = onLiveRefresh(load, { minInterval: 12000, topics: ['devices', 'alarms', 'workOrders', 'todo', 'poll'] })
})
onBeforeUnmount(() => offLive?.())
</script>

<style scoped>
.link-row { padding:8px 9px;border-bottom:1px solid rgba(90,160,255,.14);cursor:pointer;border-radius:5px;color:#e6f0ff;font-size:12px }
.link-row:hover { background:rgba(56,189,248,.1) }
.link-row.active { background:rgba(56,189,248,.18);border-left:2px solid #38bdf8 }
</style>
