<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">党组织树管理</h2>
      <div class="page-desc">四级党组织树（党委 / 党工委 / 党总支 / 党支部）；删除前校验是否存在下级组织或关联党员，存在则拦截并提示（F2-1）。</div>
    </div>
    <div class="grid-side-320">
      <div class="page-card">
        <div class="toolbar">
          <el-input v-model="kw" placeholder="名称模糊查询" clearable size="small" />
          <el-button type="primary" size="small" :icon="'Plus'" @click="openForm()">新增组织</el-button>
        </div>
        <el-tree :data="tree" :props="{ children: 'children', label: 'name' }" default-expand-all highlight-current
          :filter-node-method="filterNode" ref="treeRef" @node-click="onNode" style="max-height:520px;overflow:auto">
          <template #default="{ data }">
            <div class="flex gap8" style="width:100%">
              <el-tag size="small" effect="plain" :type="levelType(data.level)">{{ data.level }}</el-tag>
              <span style="font-size:13px">{{ data.name }}</span>
              <span class="spacer"></span>
              <span class="muted">{{ data.memberCount || 0 }}人</span>
            </div>
          </template>
        </el-tree>
      </div>

      <div>
        <div class="page-card" v-if="selected">
          <div class="flex gap8 mb12">
            <h3 class="section-title" style="margin:0;flex:1">组织详情</h3>
            <el-button size="small" :icon="'Edit'" @click="openForm(selected)">编辑</el-button>
            <el-button size="small" type="danger" plain :icon="'Delete'" @click="removeOrg">删除（校验关联）</el-button>
          </div>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="组织名称">{{ selected.name }}</el-descriptions-item>
            <el-descriptions-item label="组织层级">{{ selected.level }}</el-descriptions-item>
            <el-descriptions-item label="组织编码">{{ selected.orgCode }}</el-descriptions-item>
            <el-descriptions-item label="书记">{{ selected.secretary }}</el-descriptions-item>
            <el-descriptions-item label="成立日期">{{ selected.establishDate }}</el-descriptions-item>
            <el-descriptions-item label="党员人数">{{ selected.memberCount }}</el-descriptions-item>
          </el-descriptions>
        </div>
        <div class="page-card">
          <h3 class="section-title">该组织党员（身份证 / 手机号默认脱敏）</h3>
          <el-table :data="members" size="small" border max-height="330">
            <el-table-column prop="name" label="姓名" width="100" />
            <el-table-column prop="idcard" label="身份证" width="190" />
            <el-table-column prop="phone" label="手机号" width="140" />
            <el-table-column prop="joinDate" label="入党时间" width="130" />
            <el-table-column prop="status" label="状态" />
          </el-table>
        </div>
      </div>
    </div>

    <el-dialog v-model="visible" :title="form.id ? '编辑党组织' : '新增党组织'" width="520px">
      <el-form label-width="100px">
        <el-form-item label="组织名称" required><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="组织层级" required>
          <el-select v-model="form.level" style="width:100%">
            <el-option v-for="l in ['党委','党工委','党总支','党支部']" :key="l" :label="l" :value="l" />
          </el-select>
        </el-form-item>
        <el-form-item label="上级组织">
          <el-select v-model="form.parentId" clearable filterable style="width:100%">
            <el-option v-for="o in flat" :key="o.id" :label="o.name" :value="o.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="组织编码" required><el-input v-model="form.orgCode" placeholder="须在当前角色数据范围内" /></el-form-item>
        <el-form-item label="书记"><el-input v-model="form.secretary" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'
import { useUserStore } from '@/stores/user'

const store = useUserStore()
const flat = ref([])
const tree = ref([])
const selected = ref(null)
const members = ref([])
const kw = ref('')
const treeRef = ref(null)
const visible = ref(false)
const form = reactive({})
const levelType = (l) => ({ 党委: 'danger', 党工委: 'warning', 党总支: 'primary', 党支部: 'info' }[l] || 'info')
const filterNode = (value, data) => !value || data.name.includes(value)
watch(kw, (v) => treeRef.value?.filter(v))

const buildTree = (list) => {
  const map = new Map(list.map((o) => [o.id, { ...o, children: [] }]))
  const roots = []
  list.forEach((o) => {
    const n = map.get(o.id)
    const p = map.get(o.parentId)
    if (p) p.children.push(n); else roots.push(n)
  })
  return roots
}
const load = async () => {
  const d = await api.list('partyOrgs', { pageSize: 500 })
  flat.value = d.records
  tree.value = buildTree(d.records)
  if (!selected.value) selected.value = d.records[0] || null
  if (selected.value) await loadMembers()
}
const onNode = async (data) => { selected.value = data; await loadMembers() }
const loadMembers = async () => {
  // 按党组织主键（含全部下级）拉取党员：父级党委 / 党工委也能看到下级支部的党员
  const d = await api.get(`/party/members?orgId=${encodeURIComponent(selected.value.id)}&pageSize=30`)
  members.value = d.records || []
}
const openForm = (row) => {
  Object.keys(form).forEach((k) => delete form[k])
  Object.assign(form, row ? { ...row } : { orgCode: store.user?.orgCode, level: '党支部', parentId: '', secretary: '' })
  visible.value = true
}
const submit = async () => {
  try {
    if (form.id) await api.update('partyOrgs', form.id, { ...form })
    else await api.create('partyOrgs', { ...form, establishDate: new Date().toISOString().slice(0, 10) })
    ElMessage.success('保存成功')
    visible.value = false
    load()
  } catch (e) { /* 拦截器提示 */ }
}
const removeOrg = async () => {
  try {
    await ElMessageBox.confirm(`确认删除【${selected.value.name}】？若存在下级组织或关联党员，系统会自动拦截。`, '删除确认', { type: 'warning' })
    await api.remove('partyOrgs', selected.value.id)
    ElMessage.success('删除成功')
    selected.value = null
    load()
  } catch (e) { /* 取消 / 后端拦截 */ }
}
onMounted(load)
</script>
