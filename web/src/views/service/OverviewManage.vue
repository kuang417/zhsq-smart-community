<template>
  <div class="page">
    <div class="page-card">
      <h2 class="page-title">概览管理</h2>
      <div class="page-desc">轮播图、快捷入口、推荐位三个内容位均可配置（图片、链接、排序），配置结果同步到居民端 H5 首页（F6-2）。</div>
    </div>
    <el-tabs v-model="tab" type="border-card">
      <el-tab-pane label="轮播图" name="banners">
        <CrudTable resource="banners" title="轮播图配置" :columns="bannerCols" :form-fields="bannerFields" />
      </el-tab-pane>
      <el-tab-pane label="快捷入口" name="shortcuts">
        <CrudTable resource="shortcuts" title="快捷入口配置" :columns="shortCols" :form-fields="shortFields" />
      </el-tab-pane>
      <el-tab-pane label="推荐位" name="recommends">
        <CrudTable resource="recommends" title="推荐位配置" :columns="recCols" :form-fields="recFields" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import CrudTable from '@/components/CrudTable.vue'
const opts = (arr) => arr.map((v) => ({ label: v, value: v }))
const tab = ref('banners')
const commonFields = [
  { prop: 'title', label: '标题', required: true }, { prop: 'link', label: '跳转链接', default: '/resident' },
  { prop: 'sort', label: '排序', type: 'number' },
  { prop: 'status', label: '状态', type: 'select', options: opts(['启用', '停用']), default: '启用' }
]
const bannerCols = [
  { prop: 'title', label: '标题', minWidth: 200 }, { prop: 'image', label: '图片标识', width: 140 },
  { prop: 'link', label: '跳转链接', width: 160 }, { prop: 'sort', label: '排序', width: 90 },
  { prop: 'status', label: '状态', width: 100, type: 'status' }
]
const bannerFields = [...commonFields.slice(0, 1), { prop: 'image', label: '图片标识', default: 'banner1' }, ...commonFields.slice(1)]
const shortCols = [
  { prop: 'title', label: '入口名称', minWidth: 180 }, { prop: 'icon', label: '图标', width: 120 },
  { prop: 'link', label: '跳转链接', width: 160 }, { prop: 'sort', label: '排序', width: 90 },
  { prop: 'status', label: '状态', width: 100, type: 'status' }
]
const shortFields = [...commonFields.slice(0, 1), { prop: 'icon', label: '图标名', default: 'Menu' }, ...commonFields.slice(1)]
const recCols = [
  { prop: 'title', label: '推荐名称', minWidth: 180 }, { prop: 'link', label: '跳转链接', width: 160 },
  { prop: 'sort', label: '排序', width: 90 }, { prop: 'status', label: '状态', width: 100, type: 'status' }
]
const recFields = commonFields
</script>
