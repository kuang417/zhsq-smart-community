<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">小区与驻地单位管理</h2>
      <div class="page-desc">管理小区、物业公司、物管会、驻地单位四类主体信息及关联关系（F3-8）。</div>
    </div>
    <CrudTable resource="communities" title="小区 / 物业 / 物管会 / 驻地单位" :columns="cols" :filters="filters" :form-fields="fields" />
  </div>
</template>

<script setup>
import CrudTable from '@/components/CrudTable.vue'
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const cols = [
  { prop: 'name', label: '主体名称', minWidth: 210 }, { prop: 'type', label: '主体类型', width: 120, type: 'tag' },
  { prop: 'propertyCompany', label: '物业公司', minWidth: 170 }, { prop: 'manager', label: '负责人', width: 100 },
  { prop: 'phone', label: '联系电话（脱敏）', width: 150 }, { prop: 'households', label: '服务户数', width: 110, type: 'num' },
  { prop: 'gridCode', label: '网格编码', width: 140 }, { prop: 'address', label: '地址', minWidth: 170 }
]
const filters = [
  { prop: 'type', label: '主体类型', type: 'select', options: opts(['小区', '物业公司', '物管会', '驻地单位']) },
  { prop: 'orgCode', label: '按组织范围', type: 'org' }
]
const fields = [
  { prop: 'name', label: '主体名称', required: true },
  { prop: 'type', label: '主体类型', type: 'select', options: opts(['小区', '物业公司', '物管会', '驻地单位']) },
  { prop: 'propertyCompany', label: '关联物业公司' }, { prop: 'manager', label: '负责人' },
  { prop: 'phone', label: '联系电话' }, { prop: 'households', label: '服务户数', type: 'number' },
  { prop: 'gridCode', label: '网格编码', required: true }, { prop: 'orgCode', label: '组织编码' },
  { prop: 'address', label: '地址' }, { prop: 'remark', label: '备注', type: 'textarea' }
]
</script>
