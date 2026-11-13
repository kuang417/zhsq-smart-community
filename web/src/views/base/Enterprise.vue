<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">实有企业</h2>
      <div class="page-desc">名称、统一社会信用代码、地址、法人、联系方式、网格归属；支持筛选与增删改查，联系方式默认脱敏（F3-7）。</div>
    </div>
    <CrudTable resource="enterprises" title="实有企业台账" :columns="cols" :filters="filters" :form-fields="fields" show-reveal />
  </div>
</template>

<script setup>
import CrudTable from '@/components/CrudTable.vue'
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const cols = [
  { prop: 'name', label: '企业名称', minWidth: 220 }, { prop: 'creditCode', label: '统一社会信用代码', width: 200 },
  { prop: 'type', label: '行业', width: 120, type: 'tag' }, { prop: 'legalPerson', label: '法人', width: 100 },
  { prop: 'contact', label: '联系方式（脱敏）', width: 150 }, { prop: 'address', label: '地址', minWidth: 180 },
  { prop: 'gridCode', label: '网格编码', width: 140 }, { prop: 'status', label: '状态', width: 90, type: 'status' }
]
const filters = [
  { prop: 'type', label: '行业分类', type: 'select', options: opts(['商贸零售', '餐饮住宿', '信息技术', '物业服务', '教育培训', '医疗健康', '制造加工', '物流运输']) },
  { prop: 'orgCode', label: '按组织范围', type: 'org' },
  { prop: 'status', label: '经营状态', type: 'select', options: opts(['在营', '歇业']) }
]
const fields = [
  { prop: 'name', label: '企业名称', required: true }, { prop: 'creditCode', label: '统一社会信用代码', required: true },
  { prop: 'type', label: '行业', type: 'select', options: opts(['商贸零售', '餐饮住宿', '信息技术', '物业服务', '教育培训', '医疗健康', '制造加工', '物流运输']) },
  { prop: 'legalPerson', label: '法人' }, { prop: 'contact', label: '联系方式' },
  { prop: 'address', label: '地址' }, { prop: 'gridCode', label: '网格编码', required: true },
  { prop: 'orgCode', label: '组织编码' }, { prop: 'status', label: '状态', type: 'select', options: opts(['在营', '歇业']) }
]
</script>
