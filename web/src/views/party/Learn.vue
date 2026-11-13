<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">学习教育</h2>
      <div class="page-desc">发布学习资料（标题、分类、内容等）；「学习内容」支持在线富文本编辑——可排版、插入图片与上传附件，点击「查看」可阅读完整图文。党员上报学习进度（已学 / 学时），进度按上报记录汇总，页面加载时取数（F2-10）。</div>
      <el-button type="primary" plain :icon="'Upload'" @click="openProgress">上报学习进度</el-button>
    </div>
    <CrudTable resource="learnings" title="学习资料" :columns="cols" :filters="filters" :form-fields="fields">
      <template #row-actions="{ row }">
        <el-button link type="success" size="small" @click="viewContent(row)">查看</el-button>
      </template>
    </CrudTable>
    <div class="page-card">
      <h3 class="section-title">党员学习进度上报记录</h3>
      <el-table :data="progress" size="small" border max-height="260">
        <el-table-column prop="memberName" label="党员" width="110" />
        <el-table-column prop="title" label="学习资料" minWidth="220" />
        <el-table-column prop="hours" label="已学学时" width="110" />
        <el-table-column prop="progress" label="进度(%)" width="110" />
        <el-table-column prop="time" label="上报时间" width="180" />
      </el-table>
      <el-empty v-if="!progress.length" description="暂无上报记录，点击上方按钮上报学习进度" :image-size="60" />
    </div>

    <el-dialog v-model="visible" title="党员学习进度上报" width="480px">
      <el-form label-width="100px">
        <el-form-item label="党员"><el-select v-model="form.memberName" filterable style="width:100%">
          <el-option v-for="m in members" :key="m.id" :label="`${m.name}（${m.orgName}）`" :value="m.name" />
        </el-select></el-form-item>
        <el-form-item label="学习资料"><el-select v-model="form.title" filterable style="width:100%">
          <el-option v-for="l in learnings" :key="l.id" :label="l.title" :value="l.title" />
        </el-select></el-form-item>
        <el-form-item label="已学学时"><el-input-number v-model="form.hours" :min="0" :max="100" /></el-form-item>
        <el-form-item label="完成进度"><el-slider v-model="form.progress" :step="5" show-input /></el-form-item>
      </el-form>
      <template #footer><el-button @click="visible = false">取消</el-button><el-button type="primary" @click="submit">提交上报</el-button></template>
    </el-dialog>

    <el-dialog v-model="contentVisible" :title="`学习内容 · ${selectedRow?.title || ''}`" width="760px">
      <div class="rt-content" v-html="selectedRow?.content || '<span style=\'color:#999\'>（暂无内容）</span>'"></div>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import CrudTable from '@/components/CrudTable.vue'

const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const cols = [
  { prop: 'title', label: '资料标题', minWidth: 260 }, { prop: 'category', label: '分类', width: 120, type: 'tag' },
  { prop: 'publisher', label: '发布单位', width: 140 }, { prop: 'publishDate', label: '发布日期', width: 120 },
  { prop: 'hours', label: '学时', width: 80 }, { prop: 'attachments', label: '附件数', width: 90 },
  { prop: 'progress', label: '整体进度(%)', width: 120 }
]
const filters = [{ prop: 'category', label: '资料分类', type: 'select', options: opts(['政治理论', '党史教育', '业务能力', '党纪法规']) }]
const fields = [
  { prop: 'title', label: '资料标题', required: true },
  { prop: 'category', label: '分类', type: 'select', options: opts(['政治理论', '党史教育', '业务能力', '党纪法规']) },
  { prop: 'publisher', label: '发布单位' }, { prop: 'publishDate', label: '发布日期', placeholder: 'YYYY-MM-DD' },
  { prop: 'hours', label: '学时', type: 'number' }, { prop: 'attachments', label: '附件数', type: 'number' },
  { prop: 'content', label: '学习内容', type: 'richtext' }
]
const progress = ref([])
const members = ref([])
const learnings = ref([])
const visible = ref(false)
const contentVisible = ref(false)
const selectedRow = ref(null)
const form = reactive({ memberName: '', title: '', hours: 2, progress: 100 })
const viewContent = (row) => { selectedRow.value = row; contentVisible.value = true }
const load = async () => { progress.value = (await api.list('learningProgress', { pageSize: 50 })).records }
const openProgress = () => { visible.value = true }
const submit = async () => {
  try {
    await api.create('learningProgress', {
      ...form, time: new Date().toISOString().replace('T', ' ').slice(0, 19),
      orgCode: members.value.find((m) => m.name === form.memberName)?.orgCode || ''
    })
    ElMessage.success('学习进度已上报')
    visible.value = false
    load()
  } catch (e) { /* 拦截器提示 */ }
}
onMounted(async () => {
  load()
  members.value = (await api.list('partyMembers', { pageSize: 100 })).records
  learnings.value = (await api.list('learnings', { pageSize: 50 })).records
})
</script>
