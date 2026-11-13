<template>
  <div class="page">
    <el-tabs v-model="tab" type="border-card">
      <el-tab-pane label="党员列表" name="all">
        <div class="page-desc">姓名、性别、身份证（脱敏）、手机号（脱敏）、所属党组织、入党时间、状态、学历、志愿学时；支持组织/姓名/状态筛选、Excel 导入导出与敏感信息脱敏（F2-2 / F2-6~F2-8）。</div>
        <CrudTable resource="partyMembers" title="党员信息" :columns="columns" :filters="filters" :form-fields="formFields"
          importable show-reveal />
      </el-tab-pane>
      <el-tab-pane label="优秀党员" name="excellent">
        <div class="page-desc">独立页签维护优秀党员名单与事迹，荣誉信息在「荣誉与流动」页单独维护（F2-3 / F2-5）。</div>
        <CrudTable resource="partyMembers" title="优秀党员" :columns="columns" :filters="filters" :form-fields="formFields"
          :extra-query="excellentQuery" show-reveal />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CrudTable from '@/components/CrudTable.vue'

const tab = ref('all')
const excellentQuery = { excellent: true }
const columns = [
  { prop: 'name', label: '姓名', width: 100 },
  { prop: 'idcard', label: '身份证（脱敏）', width: 190 },
  { prop: 'phone', label: '手机号（脱敏）', width: 140 },
  { prop: 'gender', label: '性别', width: 70 },
  { prop: 'orgName', label: '所属党组织', minWidth: 200 },
  { prop: 'joinDate', label: '入党时间', width: 120 },
  { prop: 'status', label: '状态', width: 110, type: 'status' },
  { prop: 'excellent', label: '优秀党员', width: 100, type: 'bool' },
  { prop: 'volunteerHours', label: '志愿学时', width: 100 },
  { prop: 'education', label: '学历', width: 90 }
]
const filters = [
  { prop: 'status', label: '党员状态', type: 'select', options: ['正式党员', '预备党员', '离退休党员'].map((v) => ({ label: v, value: v })) },
  { prop: 'orgId', label: '所属党组织', type: 'partyOrg' }
]
const formFields = [
  { prop: 'name', label: '姓名', required: true },
  { prop: 'idcard', label: '身份证号', required: true },
  { prop: 'phone', label: '手机号' },
  { prop: 'gender', label: '性别', type: 'select', options: [{ label: '男', value: '男' }, { label: '女', value: '女' }], default: '男' },
  { prop: 'orgId', label: '所属党组织', required: true, type: 'partyOrg' },
  { prop: 'joinDate', label: '入党时间', placeholder: 'YYYY-MM-DD' },
  { prop: 'status', label: '党员状态', type: 'select', options: ['正式党员', '预备党员', '离退休党员'].map((v) => ({ label: v, value: v })), default: '正式党员' },
  { prop: 'excellent', label: '优秀党员', type: 'select', options: [{ label: '是', value: true }, { label: '否', value: false }], default: false },
  { prop: 'volunteerHours', label: '志愿学时', type: 'number', default: 0 },
  { prop: 'education', label: '学历' }
]
</script>
