<template>
  <div class="dark-view">
    <div class="dark-head">
      <div>
        <h1>地 理 信 息 平 台</h1>
        <div class="muted" style="color:#8fb4e6">五图层切换 · 人口热力图 · 分类统计 · 空间查询（框选 / 缓冲区 / 选址评分）· 结果受数据权限约束</div>
        <div class="data-stamp">统计口径：当前角色可见范围内已入库数据 ｜ 数据截至 {{ updatedAt || '加载中' }}（{{ liveLabel }}） ｜ {{ basemapLabel }}</div>
      </div>
      <div class="flex gap8">
        <el-switch v-model="showRegion" active-text="网格区域" inactive-text="区域隐藏" style="--el-switch-on-color:#1d4ed8" />
        <el-button v-if="canManage" size="small" :icon="'Location'" @click="openBasemap">离线底图</el-button>
        <el-button size="small" :icon="'Refresh'" :loading="reloading" @click="reload(false)">刷新数据</el-button>
        <el-button size="small" @click="$router.push('/portal')">返回门户</el-button>
      </div>
    </div>

    <div class="panel-dark mb12">
      <div class="flex gap8" style="flex-wrap:wrap">
        <span style="color:#7dd3fc;font-size:13px;font-weight:700">图层：</span>
        <el-radio-group v-model="layer" size="small" @change="loadGeo">
          <el-radio-button v-for="l in layers" :key="l" :label="l" />
        </el-radio-group>
        <span class="spacer"></span>
        <span style="color:#7dd3fc;font-size:13px;font-weight:700">空间查询：</span>
        <el-radio-group v-model="mode" size="small">
          <el-radio-button label="">浏览</el-radio-button>
          <el-radio-button label="box">框选查询</el-radio-button>
          <el-radio-button label="buffer">半径缓冲区</el-radio-button>
        </el-radio-group>
        <el-input-number v-model="radius" :min="0.5" :max="10" :step="0.5" size="small" style="width:110px" />
        <span class="muted" style="color:#8fb4e6">km</span>
        <el-button size="small" type="primary" @click="runScore">选址评分</el-button>
      </div>
      <div class="muted" style="color:#8fb4e6;margin-top:8px">
        {{ mode === 'box' ? '框选模式：在地图上按住鼠标拖出矩形范围，松开即查询范围内网格' : mode === 'buffer' ? '缓冲区模式：在地图上点击确定中心点，按设定半径查询' : '浏览模式：点击图层切换查看归一化着色与分类统计；所有查询均经过四级数据权限过滤' }}
      </div>
    </div>

    <div class="grid-geo">
      <div class="panel-dark">
        <h3>{{ layer }}图层 · 归一化着色（ECharts 自绘 · {{ basemapTag }}）</h3>
        <div style="position:relative" @mousedown="onDown" @mousemove="onMove" @mouseup="onUp" ref="mapWrap">
          <EChart :option="mapOption" height="500px" @ready="onReady" @chart-click="onMapClick" />
          <div v-if="boxStyle" :style="boxStyle" style="position:absolute;border:1px dashed #38bdf8;background:rgba(56,189,248,.16);pointer-events:none"></div>
        </div>
      </div>
      <div>
        <div class="panel-dark mb12">
          <h3>分类统计面板</h3>
          <div class="dark-grid dark-kpi-cols">
            <div v-for="c in category" :key="c.name" class="dark-kpi"><div class="v">{{ c.value.toLocaleString() }}</div><div class="n">{{ c.name }}</div></div>
          </div>
        </div>
        <div class="panel-dark mb12">
          <h3>空间查询结果</h3>
          <div class="muted" style="color:#8fb4e6;margin-bottom:8px">{{ resultText }}</div>
          <div style="max-height:280px;overflow:auto">
            <div v-for="(it, i) in resultItems" :key="i" class="link-row" @click="highlight(it)">
              <div class="flex gap8"><strong>{{ i + 1 }}. {{ it.name }}</strong><span class="spacer"></span>
                <el-tag v-if="it.score" size="small" effect="dark" type="warning">{{ it.score }} 分</el-tag>
                <el-tag v-else size="small" effect="dark">{{ it.layerValue }}</el-tag>
              </div>
              <div class="muted" style="color:#8fb4e6">{{ it.gridCode }} ｜ 人口 {{ it.population }} ｜ 企业 {{ it.enterprises }} ｜ 部件 {{ it.parts }}</div>
            </div>
            <el-empty v-if="!resultItems.length" description="选择工具后在地图上查询" :image-size="60" />
          </div>
        </div>
        <div class="panel-dark">
          <h3>图层值分布</h3>
          <EChart :option="barOption" height="150px" />
        </div>
      </div>
    </div>

    <!-- 离线矢量底图：导入合规来源的真实行政区边界，本地存储 + 本地渲染，断网可用 -->
    <el-dialog v-model="bmVisible" title="离线地图（真实行政区边界）管理" width="700px">
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:12px"
        title="地图数据合规要求"
        description="行政区划边界属测绘成果，只能使用自然资源部标准地图服务（带审图号）、天地图、属地自然资源主管部门或具备甲级测绘资质单位提供的数据。禁止导入 OpenStreetMap（含 Geofabrik 等 OSM 衍生包、ODbL 授权数据）、Google Maps / Mapbox / Bing 等境外或无资质来源，禁止批量抓取、缓存在线地图瓦片；平台会同时校验文件特征，改写来源说明无法绕过。" />
      <el-descriptions :column="2" border size="small" style="margin-bottom:10px">
        <el-descriptions-item label="当前底图">{{ basemap?.meta?.name || '示意边界（未导入）' }}</el-descriptions-item>
        <el-descriptions-item label="状态">
          <el-tag :type="basemap?.enabled ? 'success' : 'info'" size="small" effect="plain">{{ basemap?.enabled ? '真实离线底图' : '示意底图' }}</el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="数据来源">{{ basemap?.meta?.source || '-' }}</el-descriptions-item>
        <el-descriptions-item label="审图号">{{ basemap?.meta?.reviewNo || '未登记' }}</el-descriptions-item>
        <el-descriptions-item label="坐标系">{{ basemap?.meta?.crs || '-' }}</el-descriptions-item>
        <el-descriptions-item label="区域 / 坐标点">{{ basemap?.meta?.featureCount || 0 }} 个 / {{ basemap?.meta?.pointCount || 0 }} 点</el-descriptions-item>
      </el-descriptions>
      <div class="muted" style="font-size:12px;margin-bottom:8px">
        名称匹配：{{ basemapMatch.matched }}/{{ basemapMatch.total }} 个区域与业务网格同名（未匹配区域不着色，散点图层仍按经纬度叠加）
      </div>

      <el-divider content-position="left">导入合规来源的行政区划边界</el-divider>
      <el-form label-width="110px">
        <el-form-item label="底图名称" required>
          <el-input v-model="bmForm.name" placeholder="如：兴宁区社区行政区划边界" />
        </el-form-item>
        <el-form-item label="数据来源" required>
          <el-select v-model="bmForm.source" filterable allow-create default-first-option style="width:100%" placeholder="选择或填写合规获取渠道">
            <el-option v-for="s in bmOptions.sources" :key="s" :label="s" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item label="审图号">
          <el-input v-model="bmForm.reviewNo" placeholder="标准地图审图号，如 GS(2024)xxxx号" />
        </el-form-item>
        <el-form-item label="坐标系">
          <el-select v-model="bmForm.crs" style="width:100%">
            <el-option v-for="c in bmOptions.crsOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="名称字段">
          <el-input v-model="bmForm.nameField" placeholder="要素名称所在属性，默认 name（如 NAME / XZQMC）" />
        </el-form-item>
        <el-form-item label="边界文件" required>
          <input type="file" accept=".geojson,.json,.zip,.gpkg" @change="onBmFile" />
          <span class="muted" style="margin-left:8px;font-size:12px">{{ bmFileName || '未选择' }}</span>
        </el-form-item>
      </el-form>
      <div class="muted" style="font-size:12px;line-height:1.8">
        支持 <strong>.geojson / .json</strong>、<strong>.zip</strong>（Shapefile 的 .shp+.dbf 打包，或内含 .gpkg）、<strong>.gpkg</strong>（GeoPackage），平台自动转换为 GeoJSON，<strong>无需安装 GDAL / QGIS</strong>；单文件 ≤60MB，且要素须为经纬度面（≤300 个区域 / ≤60000 点）。<br />
        导入后数据保存在平台服务器本地（server/data/geo/basemap.json），由 ECharts 自绘渲染，<strong>完全离线、无任何外部地图请求</strong>；要素名称需与业务网格同名才会参与着色，坐标系请与业务点位保持一致。<br />
        <strong>格式支持不等于来源放行</strong>：压缩包内文件名、版权声明、图层名与属性值都会经过来源校验，OpenStreetMap / Geofabrik / ODbL 衍生数据即使改文件名或换个容器仍会被拒绝。
      </div>
      <template #footer>
        <el-button v-if="basemap?.enabled" type="danger" plain :loading="bmSubmitting" @click="clearBasemap">恢复示意底图</el-button>
        <el-button @click="bmVisible = false">取消</el-button>
        <el-button type="primary" :loading="bmSubmitting" @click="submitBasemap">导入并启用</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, shallowRef, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'
import { useUserStore } from '@/stores/user'
import { buildGeoJSON, darkAxis } from '@/utils/format'
import { SCHEMATIC_MAP_NOTE } from '@/utils/app'
import EChart from '@/components/EChart.vue'
import { liveLabel, onLiveRefresh } from '@/utils/live'
import { escHtml } from '@/utils/esc'

const layers = ['人口', '党组织', '建筑', '事件', '企业']
const layer = ref('人口')
const mode = ref('')
const radius = ref(3)
const showRegion = ref(true)
const orgs = ref([])
const geo = ref({ values: [], max: 1, points: [] })
const mapOption = ref({})
const mapWrap = ref(null)
const chartInst = shallowRef(null)   // ECharts 实例不可被 Vue reactive 深度代理
const boxStyle = ref(null)
let dragStart = null
const resultItems = ref([])
const resultText = ref('尚未执行空间查询')
const highlighted = ref([])
const category = ref([])
const updatedAt = ref('')
const reloading = ref(false)
const stamp = () => { updatedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false }) }

/* ------- 离线矢量底图：默认回落组织 bounds 示意边界；导入后改用真实行政区边界 ------- */
const userStore = useUserStore()
const canManage = computed(() => userStore.orgLevel === 1)
const basemap = ref({ enabled: false, meta: null, geojson: null })
const basemapTick = ref(0)
const bmOptions = reactive({ sources: [], crsOptions: ['GCJ-02', 'CGCS2000', 'WGS84'] })
const bmVisible = ref(false)
const bmSubmitting = ref(false)
const bmFileName = ref('')
const bmFile = ref(null)
const bmForm = reactive({ name: '', source: '', reviewNo: '', crs: 'GCJ-02', nameField: 'name' })
const basemapLabel = computed(() => {
  const m = basemap.value?.meta
  if (basemap.value?.enabled && m) {
    return `真实离线底图：${m.name}（${m.featureCount} 个区域 · 来源 ${m.source}${m.reviewNo ? ' · 审图号 ' + m.reviewNo : ''} · ${m.crs}）`
  }
  return SCHEMATIC_MAP_NOTE
})
const basemapTag = computed(() => basemap.value?.enabled ? '真实离线矢量底图' : '示意边界')
const basemapMatch = computed(() => {
  const fs = basemap.value?.geojson?.features || []
  if (!fs.length) return { total: 0, matched: 0 }
  const names = new Set(geo.value.values.map((v) => v.name))
  return { total: fs.length, matched: fs.filter((f) => names.has(f.properties?.name)).length }
})
const loadBasemap = async (light = false) => {
  try {
    const d = await api.geoBasemap(light ? { meta: '1' } : {})
    if (d?.options) {
      bmOptions.sources = d.options.sources || []
      bmOptions.crsOptions = d.options.crsOptions || bmOptions.crsOptions
    }
    // 实时刷新只比对版本，版本一致就不重复传输整份边界数据
    if (light) {
      const cur = basemap.value
      if (cur?.enabled === d.enabled && (cur?.meta?.importedAt || '') === (d.meta?.importedAt || '')) return
    }
    basemap.value = light ? await api.geoBasemap() : d
    basemapTick.value++
    buildOption()
  } catch (e) { /* 拉取失败保留原有底图，不影响地图可用性 */ }
}
const openBasemap = () => {
  const m = basemap.value?.meta
  bmForm.name = m?.name || ''
  bmForm.source = m?.source || bmOptions.sources[0] || ''
  bmForm.reviewNo = m?.reviewNo || ''
  bmForm.crs = m?.crs || 'GCJ-02'
  bmForm.nameField = m?.nameField || 'name'
  bmFileName.value = ''
  bmFile.value = null
  bmVisible.value = true
}
const onBmFile = (e) => {
  const f = e.target.files?.[0]
  bmFile.value = f || null
  bmFileName.value = f ? `${f.name}（${(f.size / 1024).toFixed(1)} KB）` : ''
}
const submitBasemap = async () => {
  if (!bmFile.value) return ElMessage.warning('请选择边界文件（.geojson / .json / .zip / .gpkg）')
  if (!bmForm.name.trim() || !bmForm.source.trim()) return ElMessage.warning('请填写底图名称与数据来源')
  if (bmFile.value.size > 60 * 1024 * 1024) return ElMessage.warning('文件超过 60MB，请简化边界后再导入')
  const fd = new FormData()
  // 文本字段先于文件写入，保证 multipart 解析后 req.body 完整可用
  for (const k of ['name', 'source', 'reviewNo', 'crs', 'nameField']) fd.append(k, String(bmForm[k] || ''))
  fd.append('file', bmFile.value)
  bmSubmitting.value = true
  try {
    await api.geoBasemapImport(fd)
    ElMessage.success('离线底图已导入并启用')
    bmVisible.value = false
    await loadBasemap()
  } catch (e) { /* 拦截器已提示 */ }
  finally { bmSubmitting.value = false }
}
const clearBasemap = async () => {
  try {
    await ElMessageBox.confirm('确认移除已导入的离线底图、恢复为示意边界？', '恢复示意底图', { type: 'warning' })
  } catch (e) { return }
  bmSubmitting.value = true
  try {
    await api.geoBasemapClear()
    ElMessage.success('已恢复示意底图')
    bmVisible.value = false
    await loadBasemap()
  } catch (e) { /* 拦截器已提示 */ }
  finally { bmSubmitting.value = false }
}

const onReady = (chart) => { chartInst.value = chart }
const buildOption = () => {
  const nodes = orgs.value.filter((o) => o.orgLevel === 4)
  if (!nodes.length) return
  const b = basemap.value
  const useReal = !!(b?.enabled && b?.geojson?.features?.length)
  // 真实边界与示意边界都是经纬度坐标，ECharts geo 线性投影可直接复用，
  // 因此框选 / 缓冲区查询拿到的仍是经纬度，无需坐标转换。
  const name = `zhsq-geo-${layer.value}-${useReal ? 'real' : 'schematic'}-${basemapTick.value}`
  echarts.registerMap(name, useReal ? b.geojson : buildGeoJSON(nodes))
  mapOption.value = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (p) => p.seriesType === 'map'
        ? `<b>${escHtml(p.name)}</b><br/>${escHtml(layer.value)}：${escHtml(p.value ?? 0)}`
        : `<b>${escHtml(p.name)}</b><br/>${escHtml(p.data?.raw?.type || '')}`
    },
    visualMap: {
      min: 0, max: Math.max(1, geo.value.max), left: 10, bottom: 10, calculable: true,
      inRange: { color: ['#0b3a7a', '#155e9c', '#0ea5e9', '#7dd3fc', '#fde68a', '#fb7185'] },
      text: ['高', '低'], textStyle: { color: '#8fb4e6', fontSize: 10 }
    },
    geo: {
      map: name, roam: mode.value === '' && showRegion.value, zoom: 1.03,
      label: { show: false },
      itemStyle: { areaColor: showRegion.value ? '#123b78' : 'rgba(10,30,60,.15)', borderColor: showRegion.value ? 'rgba(125,211,252,.5)' : 'transparent', borderWidth: .8 },
      emphasis: { itemStyle: { areaColor: '#0ea5e9' }, label: { show: false } }
    },
    series: [
      { type: 'map', map: name, geoIndex: 0, data: geo.value.values.map((v) => ({ name: v.name, value: v.value })) },
      { type: 'scatter', coordinateSystem: 'geo', geoIndex: 0, symbolSize: 5,
        itemStyle: { color: '#a5f3fc', opacity: .65 },
        data: geo.value.points.map((p) => ({ name: p.name, value: p.value, raw: p })) },
      { type: 'effectScatter', coordinateSystem: 'geo', geoIndex: 0, symbolSize: 13, zlevel: 3,
        rippleEffect: { scale: 2.6 }, itemStyle: { color: '#fbbf24', shadowBlur: 10, shadowColor: '#fbbf24' },
        data: highlighted.value.map((it) => ({ name: it.name, value: [it.lng, it.lat], raw: it })) }
    ]
  }
}
const loadGeo = async () => { geo.value = await api.geoStats(layer.value); buildOption() }
const loadCategory = async () => {
  const d = await api.populationStats('')
  const t = (n) => d.byType.find((x) => x.name === n)?.value || 0
  const tag = (n) => d.tags.find((x) => x.name === n)?.value || 0
  category.value = [
    { name: '实有人口', value: d.total }, { name: '户籍人口', value: t('户籍') },
    { name: '未落户', value: t('未落户') }, { name: '境外人员', value: t('境外') },
    { name: '社会救助', value: tag('优抚对象') + tag('残疾人') },
    { name: '重点人员', value: d.tags.reduce((a, b) => a + b.value, 0) }
  ]
}
const barOption = computed(() => {
  const top = geo.value.values.slice().sort((a, b) => b.value - a.value).slice(0, 8)
  return {
    color: ['#38bdf8'], tooltip: { trigger: 'axis' }, grid: { left: 100, right: 20, top: 10, bottom: 20 },
    xAxis: { type: 'value', ...darkAxis },
    yAxis: { type: 'category', data: top.map((x) => x.name.replace(/社区/, '')), ...darkAxis, axisLabel: { ...darkAxis.axisLabel, fontSize: 9 } },
    series: [{ type: 'bar', data: top.map((x) => x.value), barWidth: '60%', itemStyle: { color: '#0ea5e9', borderRadius: [0, 3, 3, 0] } }]
  }
})

const pixelToGeo = (x, y) => {
  try { return chartInst.value?.convertFromPixel({ geoIndex: 0 }, [x, y]) || null } catch { return null }
}
const runQuery = async (payload, text) => {
  const d = await api.geoQuery({ ...payload, layer: layer.value })
  resultItems.value = d.items
  highlighted.value = d.items
  resultText.value = `${text} ｜ 命中 ${d.total} 个网格（已按数据权限过滤）`
  buildOption()
  ElMessage.success(`查询完成，命中 ${d.total} 个网格`)
}
const onDown = (e) => {
  if (mode.value !== 'box') return
  const r = mapWrap.value.getBoundingClientRect()
  dragStart = { x: e.clientX - r.left, y: e.clientY - r.top }
  boxStyle.value = { left: dragStart.x + 'px', top: dragStart.y + 'px', width: '0px', height: '0px' }
}
const onMove = (e) => {
  if (!dragStart || mode.value !== 'box') return
  const r = mapWrap.value.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  boxStyle.value = {
    left: Math.min(dragStart.x, x) + 'px', top: Math.min(dragStart.y, y) + 'px',
    width: Math.abs(x - dragStart.x) + 'px', height: Math.abs(y - dragStart.y) + 'px'
  }
}
const onUp = async (e) => {
  if (!dragStart || mode.value !== 'box') return
  const r = mapWrap.value.getBoundingClientRect()
  const x = e.clientX - r.left, y = e.clientY - r.top
  const a = pixelToGeo(Math.min(dragStart.x, x), Math.min(dragStart.y, y))
  const b = pixelToGeo(Math.max(dragStart.x, x), Math.max(dragStart.y, y))
  dragStart = null; boxStyle.value = null
  if (a && b) {
    const bounds = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
    await runQuery({ type: 'box', bounds }, `框选范围 [${bounds.map((n) => n.toFixed(4)).join(', ')}]`)
  }
}
const onMapClick = async (p) => {
  if (mode.value !== 'buffer') return
  const ev = p.event?.event
  const x = ev?.offsetX ?? p.event?.offsetX
  const y = ev?.offsetY ?? p.event?.offsetY
  const c = pixelToGeo(x, y) || (() => {
    const node = orgs.value.find((o) => o.orgLevel === 4 && o.orgName === p.name)
    return node ? [(node.bounds[0] + node.bounds[2]) / 2, (node.bounds[1] + node.bounds[3]) / 2] : null
  })()
  if (!c) return ElMessage.warning('无法解析中心点，请重试')
  await runQuery({ type: 'buffer', center: c, radius: radius.value }, `${radius.value} km 缓冲区 [${c.map((n) => n.toFixed(4)).join(', ')}]`)
}
const runScore = async () => {
  await runQuery({ type: 'score', topN: 6 }, '选址评分 TOP 6（人口密度 / 企业 / 部件覆盖）')
}
const highlight = (it) => { highlighted.value = [it]; buildOption() }

const reload = async (lightBasemap = false) => {
  reloading.value = true
  try { await loadBasemap(lightBasemap); await Promise.all([loadGeo(), loadCategory()]); stamp() }
  finally { reloading.value = false }
}
watch([mode, showRegion], () => buildOption())
let offLive = null
onMounted(async () => {
  orgs.value = await api.orgOptions(0)
  await reload(false)
  offLive = onLiveRefresh(() => reload(true), { minInterval: 15000, topics: ['population', 'grids', 'buildings', 'partyOrgs', 'poll'] })
})
onBeforeUnmount(() => offLive?.())
</script>

<style scoped>
.link-row { padding:7px 9px;border-bottom:1px solid rgba(90,160,255,.14);cursor:pointer;border-radius:5px;color:#e6f0ff;font-size:12px }
.link-row:hover { background:rgba(56,189,248,.12) }
</style>
