<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">三会一课台账</h2>
      <div class="page-desc">四类台账分别记录时间、地点、主持人、参会人、内容；按党组织筛选（F2-9）。</div>
      <div class="mini-stats">
        <div v-for="t in types" :key="t" class="mini-stat" style="cursor:pointer" @click="pick(t)">
          <div class="v">{{ counts[t] ?? 0 }}</div><div class="n">{{ t }}（点击筛选）</div>
        </div>
      </div>
    </div>
    <CrudTable ref="table" resource="meetings" title="三会一课台账" :columns="cols" :filters="filters" :form-fields="fields" :extra-query="extra" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import CrudTable from '@/components/CrudTable.vue'
import { api } from '@/api'

const types = ['支部党员大会', '支部委员会', '党小组会', '党课']
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const counts = ref({})
const extra = ref({})
const table = ref(null)
const pick = (t) => { extra.value = { type: t } }
const cols = [
  { prop: 'title', label: '台账名称', minWidth: 160 }, { prop: 'type', label: '会议类型', width: 140, type: 'tag' },
  { prop: 'orgCode', label: '组织编码', width: 130 }, { prop: 'meetingDate', label: '会议时间', width: 160 },
  { prop: 'place', label: '地点', minWidth: 160 }, { prop: 'host', label: '主持人', width: 100 },
  { prop: 'attendees', label: '参会人数', width: 100 }, { prop: 'content', label: '会议内容', minWidth: 240 }
]
const filters = [
  { prop: 'type', label: '台账类型', type: 'select', options: opts(types) },
  { prop: 'orgCode', label: '党组织', type: 'org' }
]
const fields = [
  { prop: 'title', label: '台账名称', required: true },
  { prop: 'type', label: '会议类型', type: 'select', options: opts(types) },
  { prop: 'orgCode', label: '组织编码', required: true },
  { prop: 'meetingDate', label: '会议时间', placeholder: 'YYYY-MM-DD HH:mm:ss' },
  { prop: 'place', label: '地点' }, { prop: 'host', label: '主持人' },
  { prop: 'attendees', label: '参会人数', type: 'number' },
  { prop: 'content', label: '会议内容', type: 'textarea' }
]
onMounted(async () => {
  for (const t of types) {
    const d = await api.list('meetings', { type: t, pageSize: 1 })
    counts.value[t] = d.total
  }
})
</script>
