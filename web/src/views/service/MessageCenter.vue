<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">消息中心</h2>
      <div class="page-desc">公告、预警通知、办事进度推送；居民端可接收，后台可查看推送记录。办事状态每次流转会自动生成一条进度消息（F6-1 / F6-4）。</div>
      <div class="mini-stats">
        <div v-for="t in ['公告','预警通知','办事进度']" :key="t" class="mini-stat"><div class="v">{{ counts[t] || 0 }}</div><div class="n">{{ t }}</div></div>
      </div>
    </div>
    <CrudTable resource="messages" title="消息推送记录" :columns="cols" :filters="filters" :form-fields="fields" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '@/api'
import CrudTable from '@/components/CrudTable.vue'
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const counts = ref({})
const cols = [
  { prop: 'type', label: '消息类型', width: 120, type: 'tag' }, { prop: 'title', label: '标题', minWidth: 250 },
  { prop: 'content', label: '内容', minWidth: 240 }, { prop: 'gridCode', label: '网格编码', width: 140 },
  { prop: 'publishTime', label: '推送时间', width: 165 }, { prop: 'readCount', label: '阅读量', width: 90 },
  { prop: 'status', label: '状态', width: 100, type: 'status' }
]
const filters = [
  { prop: 'type', label: '消息类型', type: 'select', options: opts(['公告', '预警通知', '办事进度']) },
  { prop: 'status', label: '状态', type: 'select', options: opts(['已发布', '草稿']) }
]
const fields = [
  { prop: 'type', label: '消息类型', type: 'select', options: opts(['公告', '预警通知', '办事进度']) },
  { prop: 'title', label: '标题', required: true }, { prop: 'content', label: '内容', type: 'textarea' },
  { prop: 'gridCode', label: '网格编码' }, { prop: 'orgCode', label: '组织编码' },
  { prop: 'status', label: '状态', type: 'select', options: opts(['已发布', '草稿']) }
]
onMounted(async () => {
  for (const t of ['公告', '预警通知', '办事进度']) counts.value[t] = (await api.list('messages', { type: t, pageSize: 1 })).total
})
</script>
