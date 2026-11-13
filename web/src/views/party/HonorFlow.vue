<template>
  <div class="page">
    <el-tabs v-model="tab" type="border-card">
      <el-tab-pane label="党员荣誉信息" name="honor">
        <div class="page-desc">党员荣誉单独维护，支持多条记录关联同一党员（F2-5）。</div>
        <CrudTable resource="honors" title="荣誉信息" :columns="honorCols" :filters="[{ prop: 'level', label: '荣誉级别', type: 'select', options: opts(['区级','街道级','市级']) }]" :form-fields="honorFields" />
      </el-tab-pane>
      <el-tab-pane label="党员流动管理" name="flow">
        <div class="page-desc">记录流入 / 流出党员的流向、时间与办理状态（F2-4）。</div>
        <CrudTable resource="memberFlows" title="党员流动记录" :columns="flowCols" :filters="[{ prop: 'direction', label: '流动方向', type: 'select', options: opts(['流入','流出']) }, { prop: 'status', label: '办理状态', type: 'select', options: opts(['已办结','办理中','待审核']) }]" :form-fields="flowFields" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CrudTable from '@/components/CrudTable.vue'
const tab = ref('honor')
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const honorCols = [
  { prop: 'memberName', label: '党员姓名', width: 110 }, { prop: 'title', label: '荣誉名称', minWidth: 170 },
  { prop: 'level', label: '级别', width: 100, type: 'tag' }, { prop: 'awardDate', label: '获奖日期', width: 120 },
  { prop: 'orgName', label: '所属党组织', minWidth: 180 }, { prop: 'remark', label: '事迹', minWidth: 180 }
]
const honorFields = [
  { prop: 'memberName', label: '党员姓名', required: true }, { prop: 'title', label: '荣誉名称', required: true },
  { prop: 'level', label: '级别', type: 'select', options: opts(['区级', '街道级', '市级']) },
  { prop: 'awardDate', label: '获奖日期', placeholder: 'YYYY-MM-DD' }, { prop: 'orgCode', label: '组织编码' },
  { prop: 'remark', label: '事迹说明', type: 'textarea' }
]
const flowCols = [
  { prop: 'memberName', label: '党员姓名', width: 110 }, { prop: 'direction', label: '方向', width: 90, type: 'tag' },
  { prop: 'fromOrg', label: '原组织', minWidth: 180 }, { prop: 'toOrg', label: '流向组织', minWidth: 160 },
  { prop: 'flowDate', label: '流动日期', width: 120 }, { prop: 'status', label: '办理状态', width: 110, type: 'status' },
  { prop: 'handler', label: '经办人', width: 100 }
]
const flowFields = [
  { prop: 'memberName', label: '党员姓名', required: true },
  { prop: 'direction', label: '流动方向', type: 'select', options: opts(['流入', '流出']) },
  { prop: 'fromOrg', label: '原组织' }, { prop: 'toOrg', label: '流向组织' },
  { prop: 'flowDate', label: '流动日期', placeholder: 'YYYY-MM-DD' },
  { prop: 'status', label: '办理状态', type: 'select', options: opts(['已办结', '办理中', '待审核']) },
  { prop: 'orgCode', label: '组织编码' }
]
</script>
