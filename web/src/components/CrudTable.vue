<template>
  <div class="page-card">
    <div class="flex gap8" style="margin-bottom:6px">
      <h2 class="page-title" style="margin:0">{{ title }}</h2>
      <el-tag v-if="flow" size="small" type="warning" effect="plain">状态机：{{ flow }}</el-tag>
      <span class="spacer"></span>
      <span class="muted">共 {{ total }} 条</span>
      <el-tag v-if="selected.length" size="small" type="primary" effect="plain">已选 {{ selected.length }} 条</el-tag>
    </div>
    <div v-if="desc" class="page-desc">{{ desc }}</div>

    <!-- 查询工具栏 -->
    <div class="toolbar">
      <el-input v-model="keyword" placeholder="关键字检索" clearable style="width:190px" @keyup.enter="reload" />
      <template v-for="f in filters" :key="f.prop">
        <el-select v-if="f.type === 'select' || f.type === 'grid' || f.type === 'org' || f.type === 'partyOrg'" v-model="filterValues[f.prop]" :placeholder="f.label" clearable filterable style="width:160px">
          <el-option v-for="o in (f.options || optionMap[f.prop] || [])" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input v-else v-model="filterValues[f.prop]" :placeholder="f.label" clearable style="width:150px" />
      </template>
      <el-button type="primary" :icon="'Search'" @click="reload">查询</el-button>
      <el-button :icon="'Refresh'" @click="resetQuery">重置</el-button>
      <el-tooltip content="复制当前筛选条件的链接（不含关键字）" placement="top">
        <el-button :icon="'Link'" @click="copyFilterLink">分享筛选</el-button>
      </el-tooltip>
      <span class="spacer"></span>
      <el-switch v-if="showReveal && orgLevel === 1" v-model="reveal" active-text="显示明文" inline-prompt @change="onRevealChange" />
      <el-button v-if="creatable && !readonly" type="primary" plain :icon="'Plus'" @click="openForm()">新增</el-button>
      <el-button v-if="importable && !readonly" :icon="'Upload'" @click="openImport">Excel导入</el-button>
      <el-button v-if="exportable" :icon="'Download'" :loading="exporting" :disabled="busy" @click="doExport">导出Excel</el-button>
      <slot name="toolbar" />
    </div>

    <!-- 批量操作条：选中后才出现，避免常驻占空间 -->
    <div v-if="selected.length && !readonly" class="batch-bar">
      <span>已选中 <strong>{{ selected.length }}</strong> 条记录</span>
      <el-button v-if="flow" size="small" type="primary" :disabled="busy" @click="openBatchTransition">批量流转</el-button>
      <el-button v-if="deletable" size="small" type="danger" plain :disabled="busy" @click="doBatchDelete">批量删除</el-button>
      <el-button size="small" :disabled="busy" @click="clearSelection">清空选择</el-button>
    </div>

    <el-table ref="tableRef" :data="rows" border stripe size="small" v-loading="loading" style="width:100%"
      :max-height="tableHeight" @row-click="onRowClick" @selection-change="onSelectionChange" @sort-change="onSortChange">
      <el-table-column v-if="batchable" type="selection" width="44" align="center" />
      <el-table-column type="index" label="#" width="52" align="center" />
      <el-table-column v-for="c in columns" :key="c.prop" :prop="c.prop" :label="c.label"
        :width="c.width" :min-width="c.minWidth || 110" :show-overflow-tooltip="true" :align="c.align || 'left'"
        :sortable="c.sortable === false ? false : 'custom'">
        <template #default="{ row }">
          <span v-if="c.type === 'status'"><el-tag :type="statusType(row[c.prop])" size="small" effect="light">{{ row[c.prop] || '-' }}</el-tag></span>
          <span v-else-if="c.type === 'tag'"><el-tag size="small" effect="plain" :type="c.colorType ? statusType(row[c.prop]) : 'info'">{{ row[c.prop] || '-' }}</el-tag></span>
          <span v-else-if="c.type === 'bool'">{{ row[c.prop] ? '是' : '否' }}</span>
          <span v-else-if="c.type === 'array'">{{ Array.isArray(row[c.prop]) ? row[c.prop].join('、') : (row[c.prop] || '-') }}</span>
          <span v-else-if="c.type === 'num'">{{ fmtNum(row[c.prop]) }}</span>
          <span v-else-if="c.formatter">{{ c.formatter(row[c.prop], row) }}</span>
          <span v-else :class="{ 'muted': !row[c.prop] }">{{ row[c.prop] === '' || row[c.prop] == null ? '-' : row[c.prop] }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" :width="actionWidth" fixed="right" align="center">
        <template #default="{ row }">
          <el-button v-if="flow" link type="primary" size="small" @click.stop="openTransition(row)">流转</el-button>
          <el-button v-if="flow" link type="info" size="small" @click.stop="openFlows(row)">留痕</el-button>
          <el-button v-if="canRollback(row)" link type="info" size="small" @click.stop="openRollback(row, 'revoke')">撤回</el-button>
          <el-button v-if="canRollback(row)" link type="warning" size="small" @click.stop="openRollback(row, 'return')">退回</el-button>
          <slot name="row-actions" :row="row" />
          <el-button v-if="editable && !readonly" link type="primary" size="small" @click.stop="openForm(row)">编辑</el-button>
          <el-button v-if="deletable && !readonly" link type="danger" size="small" @click.stop="doDelete(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <div v-if="loadError" style="padding:18px 0">
          <el-empty :image-size="70" :description="loadError">
            <el-button type="primary" size="small" @click="load">重新加载</el-button>
          </el-empty>
        </div>
        <span v-else class="muted">当前筛选条件下暂无数据</span>
      </template>
    </el-table>
    <div class="flex" style="justify-content:flex-end;margin-top:12px">
      <el-pagination background layout="total, sizes, prev, pager, next, jumper" :total="total"
        v-model:current-page="pageNum" v-model:page-size="pageSize" :page-sizes="[10, 20, 50, 100]" @change="onPageChange" />
    </div>
  </div>

  <!-- 新增 / 编辑 -->
  <el-dialog v-model="formVisible" :title="(editing ? '编辑' : '新增') + title" :width="formDialogWidth" destroy-on-close>
    <el-alert v-if="editing && primaryField" type="info" :closable="false" style="margin-bottom:12px"
      :title="`【${primaryField}】为主键，编辑时不可修改`" />
    <el-form ref="formRef" :model="form" :rules="formRules" label-width="130px">
      <el-form-item v-for="fld in fields" :key="fld.prop" :label="fld.label" :prop="fld.prop" :required="fld.required">
        <el-select v-if="fld.type === 'select' || fld.type === 'partyOrg' || fld.type === 'org' || fld.type === 'grid' || fld.type === 'person'" v-model="form[fld.prop]" filterable clearable :disabled="isFieldDisabled(fld)" style="width:100%" :placeholder="'请选择' + fld.label">
          <el-option v-for="o in fieldOptions(fld)" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-else-if="fld.type === 'persons'" v-model="form[fld.prop]" multiple filterable collapse-tags collapse-tags-tooltip :disabled="isFieldDisabled(fld)" style="width:100%" :placeholder="'可选择多名' + fld.label">
          <el-option v-for="o in fieldOptions(fld)" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
        <el-input-number v-else-if="fld.type === 'number'" v-model="form[fld.prop]" :min="0" :max="1000000" :disabled="isFieldDisabled(fld)" style="width:100%" />
        <el-input v-else-if="fld.type === 'textarea'" v-model="form[fld.prop]" type="textarea" :rows="3" :disabled="isFieldDisabled(fld)" />
        <RichTextEditor v-else-if="fld.type === 'richtext'" v-model="form[fld.prop]" :placeholder="fld.placeholder || '请输入' + fld.label" />
        <el-input v-else v-model="form[fld.prop]" :disabled="isFieldDisabled(fld)" :placeholder="fld.placeholder || '请输入' + fld.label" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="submitting" @click="submitForm">保存</el-button>
    </template>
  </el-dialog>

  <!-- 单条状态机流转 -->
  <el-dialog v-model="transVisible" :title="`状态流转 · ${current?.title || current?.name || current?.id || ''}`" width="520px">
    <el-alert type="info" :closable="false" style="margin-bottom:14px"
      :title="`当前状态：${current?.status}　合法下一状态：${legalNext || '无（已终态）'}`"
      description="状态机按顺序校验，跳步或回退会被系统拦截" />
    <el-form label-width="90px">
      <el-form-item label="目标状态">
        <el-select v-model="target" style="width:100%">
          <el-option v-for="s in states" :key="s" :label="`${s}${s === legalNext ? '  ✓ 合法' : '  ✗ 跳步/回退'}`" :value="s" />
        </el-select>
      </el-form-item>
      <el-form-item label="办理意见"><el-input v-model="remark" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="填写处置结果 / 办理意见，写入流转记录（上限 500 字，不支持标记字符）" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="transVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="submitting" @click="submitTransition">提交流转</el-button>
    </template>
  </el-dialog>

  <!-- 状态回退：撤回本人误操作 / 正式退回上一环节（服务端二次校验窗口与角色） -->
  <el-dialog v-model="rollbackVisible" :title="`${rollbackMode === 'revoke' ? '撤回上一步流转' : '退回上一环节'} · ${current?.title || current?.name || current?.id || ''}`" width="520px">
    <el-alert :type="rollbackMode === 'revoke' ? 'info' : 'warning'" :closable="false" style="margin-bottom:14px"
      :title="`当前状态：${current?.status} → 回退到：${rollbackTarget}`"
      :description="rollbackMode === 'revoke'
        ? '仅限撤回本人 30 分钟内发起的上一步流转；原留痕会标记「已撤回」并追加一条撤回记录，历史不可删除。超时请改用「退回」。'
        : '正式业务退回仅区级 / 街道 / 社区管理员可操作，原因必填并写入流转留痕；办事申请会同步给申请人推送进度回退消息。'" />
    <el-form label-width="100px">
      <el-form-item :label="rollbackMode === 'return' ? '退回原因' : '补充说明'" :required="rollbackMode === 'return'">
        <el-input v-model="rollbackReason" type="textarea" :rows="3" maxlength="200" show-word-limit
          :placeholder="rollbackMode === 'return' ? '请填写不少于 5 个字的原因，例如：材料不齐，退回补充' : '可留空；填写后会一并写入撤回留痕'" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="rollbackVisible = false">取消</el-button>
      <el-button :type="rollbackMode === 'return' ? 'warning' : 'primary'" :loading="submitting" :disabled="submitting" @click="submitRollback">确认{{ rollbackMode === 'revoke' ? '撤回' : '退回' }}</el-button>
    </template>
  </el-dialog>

  <!-- 批量流转 -->
  <el-dialog v-model="batchVisible" :title="`批量流转 · 已选 ${selected.length} 条`" width="560px">
    <el-alert type="warning" :closable="false" style="margin-bottom:14px"
      title="逐条校验状态机、模块权限与数据范围"
      description="默认让每条记录各自推进到合法下一状态；失败条目不影响成功条目，结果会逐条列出。" />
    <el-form label-width="110px">
      <el-form-item label="目标状态">
        <el-select v-model="batchTarget" style="width:100%">
          <el-option v-for="o in batchTargets" :key="o.value" :label="o.label" :value="o.value" />
        </el-select>
      </el-form-item>
      <el-form-item label="办理意见"><el-input v-model="batchRemark" type="textarea" :rows="2" maxlength="500" show-word-limit placeholder="统一写入本次流转记录（可留空，上限 500 字）" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="batchVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="submitting" @click="submitBatchTransition">确认流转</el-button>
    </template>
  </el-dialog>

  <!-- 批量操作结果 -->
  <el-dialog v-model="batchResultVisible" title="批量操作结果" width="600px">
    <el-descriptions :column="2" border size="small" style="margin-bottom:12px">
      <el-descriptions-item label="处理成功">{{ batchResult?.success ?? 0 }} 条</el-descriptions-item>
      <el-descriptions-item label="处理失败">{{ batchResult?.failed ?? 0 }} 条</el-descriptions-item>
    </el-descriptions>
    <el-table v-if="batchResult?.errors?.length" :data="batchResult.errors" size="small" border max-height="260">
      <el-table-column prop="id" label="记录编号" width="150" />
      <el-table-column prop="reason" label="失败原因" />
    </el-table>
    <el-tag v-else type="success" effect="plain">全部处理成功</el-tag>
    <template #footer><el-button type="primary" @click="batchResultVisible = false">完成</el-button></template>
  </el-dialog>

  <!-- 流转留痕 -->
  <el-drawer v-model="flowVisible" title="全流程流转记录（留痕可查）" size="480px">
    <el-alert v-if="flowError" :title="flowError" type="error" :closable="false" show-icon />
    <FlowTimeline v-else :items="flowItems" />
  </el-drawer>

  <!-- Excel 导入 -->
  <el-dialog v-model="importVisible" :title="`Excel导入 · ${title}`" width="700px">
    <el-alert type="info" :closable="false" style="margin-bottom:12px"
      title="导入策略：校验身份证格式、组织编码匹配与数据权限；错误行不入库并返回行号+原因，正确行部分入库。" />
    <div class="flex gap8 mb12">
      <el-button :icon="'Download'" @click="downloadTemplate">下载导入模板</el-button>
      <el-button type="primary" plain :icon="'Upload'" :loading="importing" :disabled="importing" @click="$refs.fileInput.click()">选择 xlsx 文件</el-button>
      <input ref="fileInput" type="file" accept=".xlsx,.xls" style="display:none" @change="onFileChange" />
      <span class="muted">{{ fileName }}</span>
    </div>
    <el-alert v-if="importError" type="error" :closable="false" style="margin-bottom:12px" :title="importError" />
    <div v-if="importResult">
      <el-descriptions :column="3" border size="small" style="margin-bottom:12px">
        <el-descriptions-item label="总行数">{{ importResult.total }}</el-descriptions-item>
        <el-descriptions-item label="成功入库">{{ importResult.success }}</el-descriptions-item>
        <el-descriptions-item label="错误行">{{ importResult.failed }}</el-descriptions-item>
      </el-descriptions>
      <el-table v-if="importResult.errors.length" :data="importResult.errors" size="small" border max-height="240">
        <el-table-column prop="row" label="行号" width="80" />
        <el-table-column prop="name" label="姓名" width="110" />
        <el-table-column prop="reason" label="错误原因" />
      </el-table>
      <el-tag v-else type="success" effect="plain">全部校验通过，无错误行</el-tag>
    </div>
    <template #footer><el-button type="primary" @click="importVisible = false; load()">完成</el-button></template>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'
import { useUserStore } from '@/stores/user'
import { setSensitiveToken } from '@/api/token'
import { statusType, fmtNum, FLOW_STATES } from '@/utils/format'
import { loadSchema, resourceSchema } from '@/utils/schema'
import { onLiveRefresh } from '@/utils/live'
import FlowTimeline from './FlowTimeline.vue'
import RichTextEditor from './RichTextEditor.vue'

const props = defineProps({
  resource: { type: String, required: true },
  title: { type: String, default: '数据列表' },
  desc: { type: String, default: '' },
  columns: { type: Array, default: () => [] },
  filters: { type: Array, default: () => [] },
  formFields: { type: Array, default: () => [] },
  flow: { type: String, default: '' },
  importable: Boolean,
  exportable: { type: Boolean, default: true },
  creatable: { type: Boolean, default: true },
  editable: { type: Boolean, default: true },
  deletable: { type: Boolean, default: true },
  readonly: Boolean,
  showReveal: Boolean,
  extraQuery: { type: Object, default: () => ({}) },
  tableHeight: { type: [String, Number], default: 540 }
})
const emit = defineEmits(['row-click', 'loaded'])
const store = useUserStore()
const route = useRoute()
const router = useRouter()
const orgLevel = computed(() => store.orgLevel)

/* 资源元数据由服务端下发：必填字段、状态机、导入模板能力与前端本地配置合并，避免两边漂移 */
const schemaTick = ref(0)
const meta = computed(() => { schemaTick.value; return resourceSchema(props.resource) })
/**
 * V2.6：表单字段级格式校验与服务端 validateBody / validateOrgRefs 保持同一口径，
 * 不再只做「非空」。编辑态回传的脱敏副本（含 *）由服务端跳过校验，前端同样跳过。
 */
const FIELD_PATTERNS = {
  idcard: { re: /^\d{17}[\dXx]$/, msg: '身份证号应为 18 位' },
  idCard: { re: /^\d{17}[\dXx]$/, msg: '身份证号应为 18 位' },
  phone: { re: /^1\d{10}$/, msg: '手机号应为 11 位数字' },
  applicantPhone: { re: /^1\d{10}$/, msg: '手机号应为 11 位数字' },
  reporterPhone: { re: /^1\d{10}$/, msg: '手机号应为 11 位数字' },
  contact: { re: /^1\d{10}$/, msg: '手机号应为 11 位数字' },
  mobile: { re: /^1\d{10}$/, msg: '手机号应为 11 位数字' },
  orgCode: { re: /^\d{6,20}$/, msg: '组织编码应为 6~20 位数字' },
  gridCode: { re: /^\d{6,20}$/, msg: '网格编码应为 6~20 位数字' }
}
for (const k of ['joinDate', 'meetingDate', 'registerDate', 'awardDate', 'establishDate', 'installDate', 'flowDate']) {
  FIELD_PATTERNS[k] = { re: /^\d{4}-\d{2}-\d{2}$/, msg: '日期格式应为 YYYY-MM-DD' }
}
/** 组织 / 网格台账下拉：录入端只能选真实存在的编码，从源头杜绝孤儿数据 */
const orgRefOptions = reactive({ orgCode: [], gridCode: [], persons: [] })
/** 人员下拉统一取自人员主数据，避免手工输入错误 ID 造成「孤儿姓名」 */
const fieldOptions = (fld) => fld.options || orgRefOptions[fld.prop]
  || ((fld.type === 'person' || fld.type === 'persons') ? orgRefOptions.persons : []) || []
const loadPersonOptions = async () => {
  if (!props.formFields.some((f) => f.type === 'person' || f.type === 'persons')) return
  const p = await api.list('persons', { pageSize: 500 }).catch(() => null)
  orgRefOptions.persons = (Array.isArray(p?.records) ? p.records : []).map((x) => ({
    label: `${x.name}（${x.role || '人员'}${x.gridCode ? ' · ' + x.gridCode : ''}）`, value: String(x.id)
  }))
}
/** 新增组织 / 网格时这两个编码是要创建的业务键，必须允许手工输入，不能套下拉 */
const creatingKeys = computed(() => props.resource === 'orgs' ? ['orgCode']
  : props.resource === 'grids' ? ['gridCode'] : [])
// 服务端元数据是字段可写性的单一来源：状态机等不可直写字段自动从表单剔除，
// 避免页面配置遗漏导致「填了却被服务端拒绝」或状态被绕过留痕
const fields = computed(() => props.formFields
  // persons.role 是业务岗位标签（非账号权限角色），服务端已按资源豁免，前端也不按全局不可写字段剔除
  .filter((f) => !(meta.value?.immutableFields || []).includes(f.prop) || (props.resource === 'persons' && f.prop === 'role'))
  .map((f) => {
    const out = {
      ...f,
      label: f.label || meta.value?.fieldLabels?.[f.prop] || f.prop,
      required: !!(f.required || (meta.value?.required || []).includes(f.prop))
    }
    const refOpts = orgRefOptions[f.prop]
    if (!f.type && !f.options && refOpts?.length && !creatingKeys.value.includes(f.prop)) {
      out.type = 'select'
      out.options = refOpts
    }
    return out
  }))
const primaryField = computed(() => meta.value?.primary && meta.value.primary !== 'id'
  ? meta.value.primary : (props.resource === 'orgs' ? 'orgCode' : props.resource === 'grids' ? 'gridCode' : ''))
// 富文本字段需要更宽的录入弹窗，否则工具栏会换行拥挤
const formDialogWidth = computed(() => fields.value.some((f) => f.type === 'richtext') ? '860px' : '640px')

const rows = ref([])
const total = ref(0)
const pageNum = ref(1)
const pageSize = ref(20)
const keyword = ref('')
const filterValues = reactive({})
const optionMap = reactive({})
const reveal = ref(false)
const loading = ref(false)
const loadError = ref('')
const submitting = ref(false)
const exporting = ref(false)
const importing = ref(false)
const busy = computed(() => submitting.value || exporting.value || importing.value || loading.value)
const selected = ref([])
const sortField = ref('')
const sortOrder = ref('')
const tableRef = ref(null)
const formRef = ref(null)
const editingId = ref('')
const editingVersion = ref(null)
let sensitiveTimer = null

const batchable = computed(() => !props.readonly && (!!props.flow || props.deletable))
const rowKey = (row) => String(row?.id ?? row?.orgCode ?? row?.gridCode ?? row?.code ?? '')
const formRules = computed(() => Object.fromEntries(
  fields.value.map((f) => {
    const rules = []
    if (f.required) rules.push({ required: true, message: `请填写${f.label}`, trigger: ['blur', 'change'] })
    const p = FIELD_PATTERNS[f.prop]
    if (p) rules.push({
      validator: (_rule, value, callback) => {
        const v = String(value ?? '').trim()
        // 空值交给 required 规则；脱敏副本（含 *）不重复校验，服务端同样跳过
        if (!v || v.includes('*')) return callback()
        if (!p.re.test(v)) return callback(new Error(p.msg))
        callback()
      },
      trigger: ['blur', 'change']
    })
    return [f.prop, rules]
  })
))

/* ---------------- 筛选状态：刷新/切页可恢复，结构化条件可分享 ----------------
 * 关键字与下拉条件保存在 sessionStorage（会话级，退出登录统一清除），
 * 不写入 URL / 服务端日志；URL 只同步下拉、分页、排序，便于把"筛好的结果"发给同事。 */
const stateKey = () => `zhsq:view:${props.resource}`
const readSaved = () => {
  try { return JSON.parse(sessionStorage.getItem(stateKey()) || '{}') } catch (e) { return {} }
}
const restoreState = () => {
  const saved = readSaved()
  for (const f of props.filters) {
    const fromUrl = route.query[f.prop]
    filterValues[f.prop] = fromUrl != null ? String(fromUrl) : String(saved.filters?.[f.prop] ?? f.default ?? '')
  }
  keyword.value = String(route.query.keyword || saved.keyword || '')
  pageNum.value = Math.max(1, Number(route.query.pageNum || saved.pageNum || 1) || 1)
  pageSize.value = [10, 20, 50, 100].includes(Number(route.query.pageSize || saved.pageSize))
    ? Number(route.query.pageSize || saved.pageSize) : 20
  sortField.value = String(route.query.sortField || saved.sortField || '')
  sortOrder.value = String(route.query.sortOrder || saved.sortOrder || '')
}
const saveState = () => {
  try {
    sessionStorage.setItem(stateKey(), JSON.stringify({
      keyword: keyword.value, filters: { ...filterValues },
      pageNum: pageNum.value, pageSize: pageSize.value,
      sortField: sortField.value, sortOrder: sortOrder.value
    }))
  } catch (e) { /* 隐私模式下 sessionStorage 不可用，忽略即可 */ }
  const q = { ...route.query }
  delete q.keyword  // 关键字只在会话内保留，不长期留在地址栏 / 浏览器历史 / 服务端访问日志
  for (const f of props.filters) {
    if (filterValues[f.prop] !== '' && filterValues[f.prop] != null) q[f.prop] = filterValues[f.prop]
    else delete q[f.prop]
  }
  if (sortField.value) { q.sortField = sortField.value; q.sortOrder = sortOrder.value }
  else { delete q.sortField; delete q.sortOrder }
  if (pageNum.value > 1) q.pageNum = String(pageNum.value); else delete q.pageNum
  // 与当前 URL 完全一致时不触发无意义的历史替换
  if (JSON.stringify(q) !== JSON.stringify(route.query)) router.replace({ query: q }).catch(() => {})
}
const copyFilterLink = async () => {
  saveState()
  const url = new URL(window.location.href)
  url.searchParams.delete('keyword')  // 关键字属于用户敏感输入，不随链接分享
  try {
    await navigator.clipboard.writeText(url.toString())
    ElMessage.success('筛选链接已复制（不含关键字）')
  } catch (e) { ElMessage.warning('浏览器未授权剪贴板，请直接复制地址栏链接') }
}

const buildParams = () => {
  const activeFilters = Object.fromEntries(Object.entries(filterValues).filter(([, v]) => v !== '' && v != null))
  return {
    pageNum: pageNum.value, pageSize: pageSize.value,
    keyword: keyword.value, reveal: reveal.value ? '1' : '',
    sortField: sortField.value, sortOrder: sortOrder.value,
    ...props.extraQuery, ...activeFilters
  }
}
// 请求序号：SSE 自动刷新与用户翻页/排序并发时，先发后至的旧响应不得覆盖新结果
let loadSeq = 0
const load = async () => {
  const seq = ++loadSeq
  loading.value = true
  loadError.value = ''
  try {
    const d = await api.list(props.resource, buildParams())
    if (seq !== loadSeq) return
    rows.value = Array.isArray(d?.records) ? d.records : []
    total.value = d?.total ?? 0
    emit('loaded', d)
    saveState()
  } catch (e) {
    if (seq !== loadSeq) return
    rows.value = []
    total.value = 0
    loadError.value = e?.bizMessage || e?.message || '数据加载失败，请检查网络或重新登录'
  } finally { if (seq === loadSeq) loading.value = false }
}
const reload = () => { pageNum.value = 1; load() }
const resetQuery = () => {
  keyword.value = ''
  Object.keys(filterValues).forEach((k) => { filterValues[k] = '' })
  sortField.value = ''; sortOrder.value = ''
  tableRef.value?.clearSort?.()
  reload()
}
const onPageChange = () => load()
const onRowClick = (row, column) => {
  if (column?.type === 'selection') return
  emit('row-click', row)
}
const onSelectionChange = (list) => { selected.value = list || [] }
const clearSelection = () => { tableRef.value?.clearSelection?.(); selected.value = [] }
const onSortChange = ({ prop, order }) => {
  sortField.value = order ? prop : ''
  sortOrder.value = order === 'ascending' ? 'asc' : 'desc'
  reload()
}

/** 所有写操作共用一把请求锁：连点保存/流转/导入不会重复落库 */
const withLock = async (fn) => {
  if (submitting.value) return null
  submitting.value = true
  try { return await fn() } finally { submitting.value = false }
}
const showBatchResult = (data) => {
  batchResult.value = data || { success: 0, failed: 0, errors: [] }
  batchResultVisible.value = true
}
const doExport = async () => {
  if (exporting.value) return
  exporting.value = true
  try {
    const blob = await api.exportFile(props.resource, buildParams(), `${props.title}_${new Date().toISOString().slice(0, 10)}.xlsx`)
    if (!blob || blob.size === 0) throw new Error('导出文件为空')
    ElMessage.success(`已按当前筛选条件导出 ${total.value} 条（导出前已做数据权限校验）`)
  } catch (e) { /* 拦截器已提示 */ }
  finally { exporting.value = false }
}

/** 明文查看：二次验密换取 5 分钟授权令牌；到期/离开页面立即清理 */
const clearSensitive = () => {
  setSensitiveToken('')
  if (sensitiveTimer) { clearTimeout(sensitiveTimer); sensitiveTimer = null }
}
const onRevealChange = async (val) => {
  if (!val) { clearSensitive(); reload(); return }
  try {
    const { value: pwd } = await ElMessageBox.prompt(
      '查看身份证 / 手机号明文需二次验证当前账号密码，授权仅 5 分钟有效，操作全程留痕',
      '敏感数据访问授权',
      {
        inputType: 'password', inputPlaceholder: '请输入登录密码',
        confirmButtonText: '授权并查看', cancelButtonText: '取消',
        inputValidator: (v) => (v && v.length ? true : '请输入密码')
      }
    )
    const d = await api.sensitiveGrant(pwd)
    clearSensitive()
    setSensitiveToken(d.sensitiveToken)
    sensitiveTimer = setTimeout(() => { reveal.value = false; clearSensitive(); reload() }, 5 * 60 * 1000)
    ElMessage.success('明文查看授权成功，5 分钟后自动失效')
    reload()
  } catch (e) {
    reveal.value = false
    clearSensitive()
  }
}
onBeforeUnmount(clearSensitive)

/* ------- 表单 ------- */
const formVisible = ref(false)
const editing = ref(false)
const form = reactive({})
const openForm = (row) => {
  // 没有任何字段配置的资源不允许打开表单，避免 0 字段空表单写出脏数据
  if (!fields.value.length) return ElMessage.warning(`【${props.title}】未配置录入字段，如需维护请联系管理员配置表单`)
  editing.value = !!row
  editingId.value = row ? rowKey(row) : ''
  editingVersion.value = row?.version ?? null
  Object.keys(form).forEach((k) => delete form[k])
  fields.value.forEach((f) => {
    if (f.type === 'persons') form[f.prop] = Array.isArray(row?.[f.prop]) ? [...row[f.prop]] : (Array.isArray(f.default) ? [...f.default] : [])
    else form[f.prop] = row ? (row[f.prop] ?? '') : (f.default ?? '')
  })
  // 每次打开录入弹窗都刷新人员主数据：新录入的人员无需刷新整页即可在下拉里选到
  loadPersonOptions()
  if (!row && !form.orgCode && !form.gridCode) form.orgCode = store.user?.orgCode
  formVisible.value = true
  formRef.value?.clearValidate?.()
}
// 编辑态主键只读：填完才发现 403 是最典型的无效劳动
const isFieldDisabled = (fld) => editing.value && !!primaryField.value && fld.prop === primaryField.value
const submitForm = () => withLock(async () => {
  try { await formRef.value?.validate() } catch (e) { return }
  try {
    const payload = { ...form }
    if (editing.value) {
      if (editingVersion.value != null) payload.version = editingVersion.value
      await api.update(props.resource, editingId.value, payload)
    } else await api.create(props.resource, payload)
    ElMessage.success(editing.value ? '保存成功（组织/人员主数据全局联动）' : '新增成功')
    formVisible.value = false
    load()
  } catch (e) { /* 拦截器已提示，对话框保持打开以便重试 */ }
})
const doDelete = async (row) => {
  try {
    await ElMessageBox.confirm(`确认删除【${row.name || row.title || rowKey(row)}】？`, '删除确认',
      { type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' })
  } catch (e) { return }
  await withLock(async () => {
    try {
      await api.remove(props.resource, rowKey(row))
      ElMessage.success('删除成功')
      load()
    } catch (e) { /* 拦截器已提示 */ }
  })
}

/* ------- 状态机（优先使用服务端下发的 states，缺失时回退本地常量） ------- */
const states = computed(() => meta.value?.states?.length ? meta.value.states : (FLOW_STATES[props.flow] || []))
const transVisible = ref(false)
const current = ref(null)
const target = ref('')
const remark = ref('')
const legalNext = computed(() => states.value[states.value.indexOf(current.value?.status) + 1] || '')
const openTransition = (row) => {
  current.value = row
  target.value = states.value[states.value.indexOf(row.status) + 1] || row.status
  remark.value = ''
  transVisible.value = true
}
const submitTransition = () => withLock(async () => {
  try {
    await api.transition({
      resource: props.resource, id: rowKey(current.value), to: target.value,
      remark: remark.value
    })
    ElMessage.success(`流转成功：${current.value.status} → ${target.value}（已写入流转记录）`)
    transVisible.value = false
    load()
  } catch (e) { /* 跳步拦截提示由拦截器展示 */ }
})
const flowVisible = ref(false)
const flowItems = ref([])
const flowError = ref('')
const openFlows = async (row) => {
  // 区分「确实没有留痕」与「接口失败」：审批场景显示空白会被误读为没有审批记录
  flowItems.value = []
  flowError.value = ''
  try { flowItems.value = (await api.flows({ bizId: rowKey(row) })) || [] }
  catch (e) { flowError.value = '流转留痕加载失败，请稍后重试（当前不是「暂无记录」）' }
  flowVisible.value = true
}

/* ------- 撤回 / 退回：正向状态机仍禁止跳步，回退只走专用接口 ------- */
const rollbackVisible = ref(false)
const rollbackMode = ref('revoke')
const rollbackReason = ref('')
const rollbackTarget = computed(() => states.value[states.value.indexOf(current.value?.status) - 1] || '')
const canRollback = (row) => !!props.flow && !props.readonly
  && states.value.indexOf(row.status) > 0 && row.status !== '已归档'
const openRollback = (row, mode) => {
  current.value = row
  rollbackMode.value = mode
  rollbackReason.value = ''
  rollbackVisible.value = true
}
const submitRollback = () => withLock(async () => {
  const mode = rollbackMode.value
  if (mode === 'return' && rollbackReason.value.trim().length < 5) {
    return ElMessage.warning('退回原因不少于 5 个字，将写入流转留痕')
  }
  try {
    const payload = { resource: props.resource, id: rowKey(current.value), reason: rollbackReason.value.trim() }
    const d = mode === 'revoke' ? await api.transitionRevoke(payload) : await api.transitionReturn(payload)
    ElMessage.success(`${d.action}成功：${d.from} → ${d.to}（已写入流转留痕）`)
    rollbackVisible.value = false
    load()
  } catch (e) { /* 拦截器已展示服务端的具体拒绝原因，弹窗保持打开便于调整 */ }
})

/* ------- 批量操作 ------- */
const batchVisible = ref(false)
const batchTarget = ref('__next__')
const batchRemark = ref('')
const batchResult = ref(null)
const batchResultVisible = ref(false)
const batchTargets = computed(() => [
  { label: '各自流转到下一合法状态（推荐）', value: '__next__' },
  ...states.value.map((s) => ({ label: `统一流转到【${s}】`, value: s }))
])
const openBatchTransition = () => { batchTarget.value = '__next__'; batchRemark.value = ''; batchVisible.value = true }
const submitBatchTransition = () => withLock(async () => {
  try {
    const d = await api.transitionBatch({
      resource: props.resource, ids: selected.value.map(rowKey),
      to: batchTarget.value, remark: batchRemark.value
    })
    batchVisible.value = false
    showBatchResult(d)
    clearSelection()
    load()
  } catch (e) { /* 拦截器已提示 */ }
})
const doBatchDelete = async () => {
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${selected.value.length} 条记录？引用完整性校验不通过的条目会自动跳过`,
      '批量删除确认', { type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' })
  } catch (e) { return }
  await withLock(async () => {
    try {
      const d = await api.bulkDelete(props.resource, selected.value.map(rowKey))
      showBatchResult(d)
      clearSelection()
      load()
    } catch (e) { /* 拦截器已提示 */ }
  })
}

/* ------- Excel 导入 ------- */
const importVisible = ref(false)
const importResult = ref(null)
const importError = ref('')
const fileName = ref('')
const downloadTemplate = () => {
  // 服务端未配置模板时直接给出可操作提示，不再让用户下载后才发现整表被拒
  if (meta.value && !meta.value.importTemplate) {
    return ElMessage.warning(`【${props.title}】暂未配置 Excel 导入模板，如需批量导入请联系区级管理员配置`)
  }
  return api.template(props.resource, `${props.title}导入模板.xlsx`)
}
const openImport = () => { importResult.value = null; importError.value = ''; fileName.value = ''; importVisible.value = true }
const onFileChange = async (e) => {
  const file = e.target.files[0]
  if (!file) return
  if (importing.value) return
  fileName.value = file.name
  importError.value = ''
  importResult.value = null
  importing.value = true
  try {
    importResult.value = await api.importFile(props.resource, file)
    ElMessage.success(`导入完成：成功 ${importResult.value.success} 行，失败 ${importResult.value.failed} 行`)
  } catch (err) {
    // 请求拦截器抛出的是统一业务错误对象（bizMessage 才是后端原因），
    // 旧写法只取 err.response?.data，会把「模板未配置 / 行数超限」显示成通用网络文案
    importError.value = err?.bizMessage || err?.message || '导入失败，请确认文件格式后重试'
  } finally { importing.value = false }
  e.target.value = ''
}

const actionWidth = computed(() => (props.flow ? (props.readonly ? 110 : 360) : (props.readonly ? 80 : 130)))
let offLiveList = null

onMounted(() => {
  restoreState()
  // 元数据只拉一次（模块内缓存）；失败时静默回退到本地配置
  loadSchema().then(() => { schemaTick.value++ })
  // 数据变化后自动刷新列表：弹窗打开 / 正在提交 / 页面不可见时暂缓，避免打断使用者
  offLiveList = onLiveRefresh(() => {
    if (formVisible.value || transVisible.value || rollbackVisible.value || batchVisible.value
      || importVisible.value || flowVisible.value || busy.value) return
    load()
  }, { minInterval: 10000, topics: [props.resource, 'poll'] })
  // 组织 / 网格台账只拉一次，同时供筛选下拉与录入表单使用；
  // 任一接口失败不再导致整张表空白或抛未捕获异常，表单会回退为文本输入由服务端兜底校验。
  ;(async () => {
    const [orgs, grids, partyOrgs] = await Promise.all([
      api.orgOptions(0).catch(() => []), api.gridOptions().catch(() => []),
      api.list('partyOrgs', { pageSize: 500 }).catch(() => [])
    ])
    orgRefOptions.orgCode = (Array.isArray(orgs) ? orgs : []).map((o) => ({
      label: `${o.orgName || o.label}（${o.orgCode || o.value}）`, value: String(o.orgCode || o.value)
    }))
    orgRefOptions.gridCode = (Array.isArray(grids) ? grids : []).map((g) => ({
      label: `${g.gridName || g.label}（${g.gridCode || g.value}）`, value: String(g.gridCode || g.value)
    }))
    // 党员归属以党组织主键 orgId 为准（党总支与支部可能共用社区编码），
    // 录入 / 筛选统一按党组织 id 选择，避免 orgCode 歧义导致的错归属。
    orgRefOptions.orgId = (Array.isArray(partyOrgs?.records) ? partyOrgs.records : []).map((o) => ({
      label: `${o.name}（${o.level || ''}）`, value: String(o.id)
    }))
    for (const f of props.filters) {
      if ((f.type === 'org' || f.type === 'grid' || f.type === 'partyOrg') && !f.options) {
        optionMap[f.prop] = f.type === 'grid' ? orgRefOptions.gridCode
          : f.type === 'partyOrg' ? orgRefOptions.orgId : orgRefOptions.orgCode
      }
    }
  })()
  loadPersonOptions()
  load()
})
watch(() => props.extraQuery, () => reload(), { deep: true })
onBeforeUnmount(() => offLiveList?.())
defineExpose({ load, reload })
</script>

<style scoped>
.batch-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  margin: 8px 0; padding: 8px 12px; border-radius: 8px;
  background: #eef4ff; border: 1px solid #cddcff; color: #17357f; font-size: 13px;
}
</style>
