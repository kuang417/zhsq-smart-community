<template>
  <div class="h5">
    <div class="h5-head">
      <h2>🏘 {{ home.grid?.gridName || '网格微站' }}</h2>
      <p>{{ home.community || '社区微站' }} ｜ 便民码扫码进入 ｜ 编码 {{ gridCode || '未指定网格' }}</p>
    </div>
    <div class="h5-body" v-if="gridCode">
      <el-alert v-if="homeError" type="error" :closable="false" :title="homeError" class="mb12">
        <el-button size="small" @click="loadHome">重新加载</el-button>
      </el-alert>

      <!-- 首页 -->
      <template v-if="tab === 'home'">
        <div class="h5-card">
          <h4>本网格信息</h4>
          <div class="grid-h5-kpi">
            <div><div class="h5-kpi-v">{{ home.grid?.populationCount || 0 }}</div><div class="muted">实有人口</div></div>
            <div><div class="h5-kpi-v">{{ home.grid?.partyMemberCount || 0 }}</div><div class="muted">党员</div></div>
            <div><div class="h5-kpi-v">{{ home.grid?.workers?.length || 0 }}</div><div class="muted">网格员</div></div>
          </div>
          <div class="muted" style="margin-top:10px;border-top:1px solid #eef2f8;padding-top:8px">
            网格长：{{ home.grid?.leader }} ｜ 网格员：{{ home.grid?.workers?.join('、') }}
          </div>
        </div>
        <div class="h5-card">
          <h4>快捷服务</h4>
          <div class="h5-grid">
            <button v-for="(s, i) in (home.shortcuts || [])" :key="i" type="button" class="g"
              :aria-label="`打开${s.title}`"
              @click="tab = ['service','home','progress','service','report','message','home','service'][i] || 'home'">
              <div class="ic"><el-icon><component :is="icons[i % icons.length]" /></el-icon></div>{{ s.title }}
            </button>
          </div>
        </div>
        <div class="h5-card">
          <h4>推荐服务</h4>
          <div class="flex gap8" style="flex-wrap:wrap">
            <el-tag v-for="r in (home.recommends || [])" :key="r.id" effect="plain" size="large">{{ r.title }}</el-tag>
          </div>
        </div>
        <div class="h5-card">
          <h4>社区公告</h4>
          <div v-for="m in (home.messages || [])" :key="m.id" style="padding:8px 0;border-bottom:1px solid #f1f5f9">
            <div class="flex gap8"><el-tag size="small" effect="plain">{{ m.type }}</el-tag><strong style="font-size:13px">{{ m.title }}</strong></div>
            <div class="muted" style="margin-top:4px">{{ m.publishTime }}</div>
          </div>
          <el-empty v-if="!home.messages?.length" description="暂无公告" :image-size="50" />
        </div>
        <div class="h5-card">
          <h4>社区资讯</h4>
          <div v-for="c in (home.contents || [])" :key="c.id" style="padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
            <el-tag size="small" effect="plain" style="margin-right:6px">{{ c.type }}</el-tag>{{ c.title }}
          </div>
        </div>
      </template>

      <!-- 消息 -->
      <template v-else-if="tab === 'message'">
        <div class="h5-card">
          <h4>消息通知</h4>
          <div v-for="m in messages" :key="m.id" style="padding:10px 0;border-bottom:1px solid #f1f5f9">
            <div class="flex gap8"><el-tag size="small" :type="m.type === '预警通知' ? 'danger' : 'primary'" effect="plain">{{ m.type }}</el-tag><strong style="font-size:13px">{{ m.title }}</strong></div>
            <div class="muted" style="margin-top:5px">{{ m.content }}</div>
            <div class="muted" style="margin-top:3px">{{ m.publishTime }}</div>
          </div>
          <el-empty v-if="!messages.length" description="暂无消息" :image-size="60" />
        </div>
      </template>

      <!-- 在线办事 -->
      <template v-else-if="tab === 'service'">
        <div class="h5-card">
          <h4>在线办事申请</h4>
          <div class="muted mb12">状态流转：待受理 → 办理中 → 已办结，每次流转自动推送进度通知</div>
          <el-form ref="serviceFormRef" :model="serviceForm" :rules="serviceRules" label-position="top" size="large">
            <el-form-item label="办理事项" prop="item"><el-select v-model="serviceForm.item" style="width:100%">
              <el-option v-for="i in (home.serviceItems || [])" :key="i" :label="i" :value="i" />
            </el-select></el-form-item>
            <el-form-item label="申请人姓名" prop="name"><el-input v-model="serviceForm.name" placeholder="请输入姓名" /></el-form-item>
            <el-form-item label="手机号（用于进度查询）" prop="phone"><el-input v-model="serviceForm.phone" placeholder="请输入 11 位手机号" inputmode="numeric" maxlength="11" /></el-form-item>
            <el-form-item label="补充说明" prop="description"><el-input v-model="serviceForm.description" type="textarea" :rows="2" /></el-form-item>
          </el-form>
          <el-button type="primary" size="large" style="width:100%;min-height:44px" :loading="submitting === 'service'" @click="submitRequest">提交申请</el-button>
        </div>
        <ReceiptCard v-if="lastResult" kind-label="办事申请" code-label="业务编号" :receipt="lastResult"
          note="进度查询需同时校验手机号 + 业务编号 + 查询码。" @clear="clearReceipt('service')" />
      </template>

      <!-- 事件上报 -->
      <template v-else-if="tab === 'report'">
        <div class="h5-card">
          <h4>治理万家 · 事件上报</h4>
          <div class="muted mb12">居民上报 → 社区派发网格员 → 现场处置 → 结果回填 → 归档，全程留痕可查</div>
          <el-form ref="eventFormRef" :model="eventForm" :rules="eventRules" label-position="top" size="large">
            <el-form-item label="事件类型" prop="type"><el-select v-model="eventForm.type" style="width:100%">
              <el-option v-for="i in (home.eventTypes || [])" :key="i" :label="i" :value="i" />
            </el-select></el-form-item>
            <el-form-item label="事件标题" prop="title"><el-input v-model="eventForm.title" placeholder="简要描述问题" /></el-form-item>
            <el-form-item label="发生地点" prop="location"><el-input v-model="eventForm.location" /></el-form-item>
            <el-form-item label="上报人 / 手机号" prop="phone">
              <div class="flex gap8"><el-input v-model="eventForm.name" placeholder="姓名" /><el-input v-model="eventForm.phone" placeholder="手机号" inputmode="numeric" maxlength="11" /></div>
            </el-form-item>
            <el-form-item label="详细描述" prop="description"><el-input v-model="eventForm.description" type="textarea" :rows="2" /></el-form-item>
          </el-form>
          <el-button type="primary" size="large" style="width:100%;min-height:44px" :loading="submitting === 'event'" @click="submitEvent">提交上报</el-button>
        </div>
        <ReceiptCard v-if="lastEvent" kind-label="事件上报" code-label="事件编号" :receipt="lastEvent"
          note="网格员接单后可在「进度」查询流转记录。" @clear="clearReceipt('event')" />
      </template>

      <!-- 进度查询 -->
      <template v-else>
        <div class="h5-card">
          <h4>办事 / 事件进度查询</h4>
          <div class="muted mb12">为保护隐私，需同时校验提交时填写的手机号、业务编号与一次性查询码</div>
          <el-form ref="progressFormRef" :model="progressForm" :rules="progressRules" label-position="top" size="large">
            <el-form-item label="手机号" prop="phone"><el-input v-model="progressForm.phone" placeholder="提交时填写的 11 位手机号" inputmode="numeric" maxlength="11" /></el-form-item>
            <el-form-item label="业务编号" prop="bizCode"><el-input v-model="progressForm.bizCode" placeholder="如 BS202611090001 / ZW202611090001" /></el-form-item>
            <el-form-item label="查询码" prop="queryCode"><el-input v-model="progressForm.queryCode" placeholder="提交成功后显示的 6 位查询码" maxlength="6" inputmode="numeric" /></el-form-item>
          </el-form>
          <el-alert v-if="progressError" :type="progressErrorKind === 'limited' ? 'warning' : 'error'" :closable="false"
            :title="progressError" :description="errorAction(progressErrorKind)" class="mb12" />
          <el-button type="primary" size="large" style="width:100%;min-height:44px" :loading="submitting === 'progress'" @click="queryProgress">查询进度</el-button>
        </div>
        <div class="h5-card" v-for="(r, i) in myRequests" :key="'r' + i">
          <div class="flex gap8"><strong>{{ r.item }}</strong><span class="spacer"></span><el-tag size="small" :type="statusType(r.status)">{{ r.status }}</el-tag></div>
          <div class="muted" style="margin-top:5px">{{ r.code }} ｜ {{ r.submitTime }}</div>
        </div>
        <div class="h5-card" v-for="(e, i) in myEvents" :key="'e' + i">
          <div class="flex gap8"><strong>{{ e.title }}</strong><span class="spacer"></span><el-tag size="small" :type="statusType(e.status)">{{ e.status }}</el-tag></div>
          <div class="muted" style="margin-top:5px">{{ e.code }} ｜ {{ e.reportTime }}</div>
        </div>
        <div class="h5-card" v-if="myFlows.length">
          <h4>流转留痕</h4>
          <FlowTimeline :items="myFlows" />
        </div>
        <div class="h5-card" v-if="queried && !progressError && !myRequests.length && !myEvents.length">
          <el-empty description="该凭条暂无可展示的进度记录" :image-size="70" />
        </div>
      </template>
    </div>
    <!-- V2.6：不再用演示网格编码兜底。无编码时明确告知居民需要扫码，
         管理员预览也应先从网格台账进入，避免生产空库打开一个必然 404 的页面。 -->
    <div class="h5-body" v-else>
      <el-empty description="缺少网格编码：请扫描本网格便民码进入；后台预览请从「网格组织 / 便民码」台账打开" :image-size="90" />
    </div>

    <div class="h5-tabbar" v-if="gridCode" role="tablist" aria-label="居民端导航">
      <button v-for="t in tabs" :key="t.key" type="button" role="tab" class="item"
        :class="{ active: tab === t.key }" :aria-selected="tab === t.key" @click="tab = t.key">
        <el-icon><component :is="t.icon" /></el-icon>{{ t.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import { statusType } from '@/utils/format'
import { describeError, errorAction } from '@/utils/errors'
import FlowTimeline from '@/components/FlowTimeline.vue'
import ReceiptCard from '@/components/ReceiptCard.vue'

const route = useRoute()
// 生产空库 / 直接访问 /resident 时不再回退到演示网格编码，由页面给出明确指引
const gridCode = ref(String(route.query.grid || '').trim())
const tab = ref('home')
const home = ref({})
const homeError = ref('')
const messages = ref([])
const lastResult = ref(null)
const lastEvent = ref(null)
const progressForm = reactive({ phone: '', bizCode: '', queryCode: '' })
const myRequests = ref([]), myEvents = ref([]), myFlows = ref([])
const queried = ref(false)
const submitting = ref('')
const progressError = ref('')
const progressErrorKind = ref('unknown')
const serviceFormRef = ref(null), eventFormRef = ref(null), progressFormRef = ref(null)

const tabs = [
  { key: 'home', label: '首页', icon: 'HomeFilled' },
  { key: 'message', label: '消息', icon: 'Bell' },
  { key: 'service', label: '办事', icon: 'Document' },
  { key: 'report', label: '上报', icon: 'EditPen' },
  { key: 'progress', label: '进度', icon: 'Clock' }
]
const icons = ['Document', 'HomeFilled', 'Clock', 'EditPen', 'Bell', 'Service', 'Star', 'Phone']
const serviceForm = reactive({ name: '', phone: '', item: '', description: '' })
const eventForm = reactive({ name: '', phone: '', type: '', title: '', location: '', description: '' })

const phoneRule = [
  { required: true, message: '请填写手机号', trigger: 'blur' },
  { pattern: /^1\d{10}$/, message: '请输入正确的 11 位手机号', trigger: 'blur' }
]
const serviceRules = {
  item: [{ required: true, message: '请选择办理事项', trigger: 'change' }],
  name: [{ required: true, message: '请填写申请人姓名', trigger: 'blur' }],
  phone: phoneRule
}
const eventRules = {
  type: [{ required: true, message: '请选择事件类型', trigger: 'change' }],
  title: [{ required: true, message: '请填写事件标题', trigger: 'blur' }],
  phone: phoneRule
}
const progressRules = {
  phone: phoneRule,
  bizCode: [{ required: true, message: '请填写业务编号', trigger: 'blur' }],
  queryCode: [
    { required: true, message: '请填写查询码', trigger: 'blur' },
    { pattern: /^\d{6}$/, message: '查询码为 6 位数字', trigger: 'blur' }
  ]
}

/* 凭条只在当前标签页会话内保留：刷新页面不丢，关闭标签页即消失（不写 localStorage） */
const RECEIPT_KEY = 'zhsq:receipt:'
const readReceipt = (kind) => {
  try { return JSON.parse(sessionStorage.getItem(RECEIPT_KEY + kind) || 'null') } catch (e) { return null }
}
const saveReceipt = (kind, data) => {
  try { sessionStorage.setItem(RECEIPT_KEY + kind, JSON.stringify(data)) } catch (e) { /* 隐私模式下忽略 */ }
}
const clearReceipt = (kind) => {
  try { sessionStorage.removeItem(RECEIPT_KEY + kind) } catch (e) { /* 忽略 */ }
  if (kind === 'service') lastResult.value = null
  else lastEvent.value = null
}
const fillProgress = (phone, receipt) => {
  progressForm.phone = phone
  progressForm.bizCode = receipt.code || ''
  progressForm.queryCode = receipt.queryCode || ''
}

const submitRequest = async () => {
  if (submitting.value) return
  try { await serviceFormRef.value?.validate() } catch (e) { return }
  submitting.value = 'service'
  try {
    const d = await api.residentRequest({ ...serviceForm, gridCode: gridCode.value })
    lastResult.value = { ...d, phone: serviceForm.phone }
    saveReceipt('service', lastResult.value)
    fillProgress(serviceForm.phone, d)
    ElMessage.success('申请已提交，请复制或保存查询凭条')
  } catch (e) { /* 拦截器已按后端错误码提示 */ }
  finally { submitting.value = '' }
}
const submitEvent = async () => {
  if (submitting.value) return
  try { await eventFormRef.value?.validate() } catch (e) { return }
  submitting.value = 'event'
  try {
    const d = await api.residentEvent({ ...eventForm, gridCode: gridCode.value })
    lastEvent.value = { ...d, phone: eventForm.phone }
    saveReceipt('event', lastEvent.value)
    fillProgress(eventForm.phone, d)
    ElMessage.success('事件已上报，请复制或保存查询凭条')
  } catch (e) { /* 拦截器已按后端错误码提示 */ }
  finally { submitting.value = '' }
}
const queryProgress = async () => {
  if (submitting.value) return
  try { await progressFormRef.value?.validate() } catch (e) { return }
  submitting.value = 'progress'
  progressError.value = ''
  try {
    const d = await api.residentProgress(progressForm.phone.trim(), progressForm.bizCode.trim(), progressForm.queryCode.trim())
    myRequests.value = d?.requests || []
    myEvents.value = d?.events || []
    myFlows.value = d?.flows || []
    queried.value = true
  } catch (e) {
    const info = describeError(e, '进度查询失败，请稍后重试')
    progressError.value = info.message
    progressErrorKind.value = info.kind
    myRequests.value = []; myEvents.value = []; myFlows.value = []
    queried.value = true
  } finally { submitting.value = '' }
}

const loadHome = async () => {
  homeError.value = ''
  if (!gridCode.value) return   // 无网格编码时由空态卡片给出指引，不发无效请求
  try {
    home.value = await api.residentHome(gridCode.value)
    messages.value = await api.residentMessages(gridCode.value) || []
    serviceForm.item = home.value.serviceItems?.[0] || ''
    eventForm.type = home.value.eventTypes?.[0] || ''
    eventForm.location = home.value.grid?.gridName || ''
  } catch (e) {
    // 透传服务端原因（便民码无效 / 网格不存在），不再统一伪装成「网络错误」
    homeError.value = e?.bizMessage || e?.message || '微站信息加载失败，请检查网络后重试'
  }
}
onMounted(() => {
  lastResult.value = readReceipt('service')
  lastEvent.value = readReceipt('event')
  const r = lastResult.value || lastEvent.value
  if (r) { progressForm.phone = r.phone || ''; progressForm.bizCode = r.code || ''; progressForm.queryCode = r.queryCode || '' }
  loadHome()
})
</script>
