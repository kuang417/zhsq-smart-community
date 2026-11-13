<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">数据全景</h2>
      <div class="page-desc">
        网格 / 建筑 / 人口 / 企业四个页签，支持多条件组合查询；结果分页展示、敏感字段脱敏；一键按当前查询条件导出 Excel，导出前做数据权限校验（F4-1~F4-3）。
        跨实体全文检索由 SQLite FTS5 索引承载（trigram 分词），按当前角色模块授权与四级组织编码前缀过滤结果，无需外部搜索引擎。
      </div>
      <el-alert type="info" :closable="false" title="所有查询结果均受四级组织编码前缀约束：切换角色后可见数据量自动收窄，越权导出被拦截。" style="margin-bottom:12px" />
    </div>
    <el-tabs v-model="tab" type="border-card">
      <el-tab-pane v-for="t in tabs" :key="t.key" :label="t.label" :name="t.key">
        <CrudTable :key="t.key" :resource="t.resource" :title="t.label + ' · 综合查询'" :columns="t.columns" :filters="t.filters"
          :creatable="false" :editable="false" :deletable="false" show-reveal />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CrudTable from '@/components/CrudTable.vue'
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const tab = ref('grid')
const tabs = [
  {
    key: 'grid', label: '网格', resource: 'grids',
    columns: [
      { prop: 'gridCode', label: '网格编码', width: 140 }, { prop: 'gridName', label: '网格名称', minWidth: 180 },
      { prop: 'parentCode', label: '所属社区', width: 130 }, { prop: 'populationCount', label: '实有人口', width: 110, type: 'num' },
      { prop: 'partyMemberCount', label: '党员数', width: 90 }, { prop: 'lng', label: '经度', width: 120 }, { prop: 'lat', label: '纬度', width: 120 }
    ],
    filters: [{ prop: 'orgCode', label: '组织范围', type: 'org' }, { prop: 'streetCode', label: '街道编码', type: 'input' }]
  },
  {
    key: 'building', label: '建筑', resource: 'buildings',
    columns: [
      { prop: 'name', label: '建筑名称', minWidth: 190 }, { prop: 'buildingType', label: '类型', width: 140, type: 'tag' },
      { prop: 'purpose', label: '用途', width: 100, type: 'tag' }, { prop: 'floors', label: '层数', width: 80 },
      { prop: 'households', label: '户数', width: 90 }, { prop: 'gridCode', label: '网格编码', width: 140 },
      { prop: 'status', label: '状态', width: 100, type: 'status' }
    ],
    filters: [
      { prop: 'purpose', label: '用途', type: 'select', options: opts(['居住', '商务', '其他']) },
      { prop: 'buildingType', label: '类型', type: 'select', options: opts(['多层住宅', '高层住宅', '商住两用', '商业楼宇', '公共配套']) },
      { prop: 'gridCode', label: '网格', type: 'grid' }
    ]
  },
  {
    key: 'population', label: '人口', resource: 'population',
    columns: [
      { prop: 'name', label: '姓名', width: 100 }, { prop: 'idcard', label: '身份证（脱敏）', width: 190 },
      { prop: 'phone', label: '手机号（脱敏）', width: 150 }, { prop: 'type', label: '人口类型', width: 110, type: 'tag' },
      { prop: 'age', label: '年龄', width: 80 }, { prop: 'tags', label: '特殊群体标签', minWidth: 150 },
      { prop: 'gridCode', label: '网格编码', width: 140 }, { prop: 'address', label: '住址', minWidth: 200 }
    ],
    filters: [
      { prop: 'type', label: '人口类型', type: 'select', options: opts(['户籍', '常住', '未落户', '流动', '境外', '系统未分配']) },
      { prop: 'tags', label: '特殊群体标签', type: 'input' },
      { prop: 'gridCode', label: '网格', type: 'grid' }
    ]
  },
  {
    key: 'enterprise', label: '企业', resource: 'enterprises',
    columns: [
      { prop: 'name', label: '企业名称', minWidth: 220 }, { prop: 'creditCode', label: '统一社会信用代码', width: 200 },
      { prop: 'type', label: '行业', width: 120, type: 'tag' }, { prop: 'legalPerson', label: '法人', width: 100 },
      { prop: 'contact', label: '联系方式（脱敏）', width: 150 }, { prop: 'gridCode', label: '网格编码', width: 140 },
      { prop: 'status', label: '状态', width: 90, type: 'status' }
    ],
    filters: [
      { prop: 'type', label: '行业', type: 'select', options: opts(['商贸零售', '餐饮住宿', '信息技术', '物业服务', '教育培训', '医疗健康', '制造加工', '物流运输']) },
      { prop: 'orgCode', label: '组织范围', type: 'org' }
    ]
  }
]
</script>
