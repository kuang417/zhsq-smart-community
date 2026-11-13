<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">人口明细管理</h2>
      <div class="page-desc">人口基础信息维护（姓名、身份证脱敏、联系方式、住址、网格归属、人口类型）；支持 Excel 模板导入与按筛选条件导出，区级管理员可切换明文查看（F3-4 / F2-6~F2-8）。</div>
    </div>
    <CrudTable resource="population" title="实有人口明细" :columns="cols" :filters="filters" :form-fields="fields" importable show-reveal />
  </div>
</template>

<script setup>
import CrudTable from '@/components/CrudTable.vue'
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const cols = [
  { prop: 'name', label: '姓名', width: 100 }, { prop: 'idcard', label: '身份证（脱敏）', width: 190 },
  { prop: 'phone', label: '联系方式（脱敏）', width: 150 }, { prop: 'gender', label: '性别', width: 70 },
  { prop: 'age', label: '年龄', width: 70 }, { prop: 'type', label: '人口类型', width: 110, type: 'tag' },
  { prop: 'tags', label: '特殊群体标签', minWidth: 150 }, { prop: 'gridCode', label: '网格编码', width: 135 },
  { prop: 'address', label: '住址', minWidth: 220 }
]
const filters = [
  { prop: 'type', label: '人口类型', type: 'select', options: opts(['户籍', '常住', '未落户', '流动', '境外', '系统未分配']) },
  { prop: 'gridCode', label: '网格', type: 'grid' }
]
const fields = [
  { prop: 'name', label: '姓名', required: true }, { prop: 'idcard', label: '身份证号', required: true },
  { prop: 'phone', label: '联系方式' }, { prop: 'gender', label: '性别', type: 'select', options: opts(['男', '女']) },
  { prop: 'age', label: '年龄', type: 'number' },
  { prop: 'type', label: '人口类型', type: 'select', options: opts(['户籍', '常住', '未落户', '流动', '境外', '系统未分配']) },
  { prop: 'gridCode', label: '网格编码', required: true },
  { prop: 'tags', label: '特殊群体标签', placeholder: '多个标签用逗号分隔' },
  { prop: 'address', label: '住址' }
]
</script>
