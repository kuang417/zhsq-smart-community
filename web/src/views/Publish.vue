<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">发布系统 / 信息管理</h2>
      <div class="page-desc">社区新闻、政策法规、活动通知三类内容发布与管理；已发布内容同步展示到居民端 H5（F6-3 / F1-2）。</div>
      <div class="mini-stats">
        <div v-for="s in stats" :key="s.name" class="mini-stat"><div class="v">{{ s.value }}</div><div class="n">{{ s.name }}</div></div>
      </div>
    </div>
    <CrudTable ref="table" resource="contents" title="内容发布" :columns="cols" :filters="filters" :form-fields="fields">
      <template #row-actions="{ row }">
        <el-button link type="info" size="small" @click.stop="preview = row">预览</el-button>
      </template>
    </CrudTable>
    <el-dialog v-model="previewVisible" :title="preview?.title" width="560px">
      <div class="muted mb12">{{ preview?.type }} ｜ {{ preview?.publisher }} ｜ {{ preview?.publishTime }} ｜ {{ preview?.views }} 次浏览</div>
      <p style="line-height:2">{{ preview?.summary }}</p>
      <el-alert type="success" :closable="false" title="该内容已同步到居民端 H5 的社区资讯栏目" />
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'
import CrudTable from '@/components/CrudTable.vue'
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const stats = ref([])
const preview = ref(null)
const previewVisible = computed({
  get: () => !!preview.value,
  set: (v) => { if (!v) preview.value = null }
})
const cols = [
  { prop: 'type', label: '内容类型', width: 120, type: 'tag' }, { prop: 'title', label: '标题', minWidth: 250 },
  { prop: 'summary', label: '摘要', minWidth: 240 }, { prop: 'publisher', label: '发布人', width: 100 },
  { prop: 'publishTime', label: '发布时间', width: 165 }, { prop: 'views', label: '浏览量', width: 100 },
  { prop: 'status', label: '状态', width: 100, type: 'status' }
]
const filters = [
  { prop: 'type', label: '内容类型', type: 'select', options: opts(['社区新闻', '政策法规', '活动通知']) },
  { prop: 'status', label: '状态', type: 'select', options: opts(['已发布', '待审核']) }
]
const fields = [
  { prop: 'type', label: '内容类型', type: 'select', options: opts(['社区新闻', '政策法规', '活动通知']) },
  { prop: 'title', label: '标题', required: true }, { prop: 'summary', label: '摘要', type: 'textarea' },
  { prop: 'publisher', label: '发布人' }, { prop: 'orgCode', label: '组织编码' },
  { prop: 'status', label: '状态', type: 'select', options: opts(['已发布', '待审核']), default: '已发布' }
]
onMounted(async () => {
  stats.value = await Promise.all(['社区新闻', '政策法规', '活动通知'].map(async (name) => ({ name, value: (await api.list('contents', { type: name, pageSize: 1 })).total })))
})
</script>
