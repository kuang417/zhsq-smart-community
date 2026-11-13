/**
 * 把后端错误码翻译成「用户能做点什么」的提示，避免所有失败都被压平成一句 toast。
 * 后端已分层的语义：40002/40003 校验、40304 三要素不匹配、42901 尝试过多、
 * 40901 状态冲突、40300 越权；网络层失败没有 response。
 */
export function describeError(e, fallback = '操作失败，请稍后重试') {
  const code = Number(e?.code)
  const msg = String(e?.bizMessage || e?.message || '').trim()

  if (e?.isNetwork) return { kind: 'network', message: '网络连接异常，请检查网络后重试' }
  if (code === 40304) return { kind: 'credential', message: '手机号、业务编号或查询码不匹配，请核对凭条后重试' }
  if (code === 42901 || e?.status === 429) return { kind: 'limited', message: msg || '校验失败次数过多，请 10 分钟后再试' }
  if (code === 40002 || code === 40003) return { kind: 'validation', message: msg || '填写信息有误，请核对后重试' }
  if (code === 40300 || code === 40301 || e?.status === 403) return { kind: 'permission', message: msg || '当前账号无权执行该操作' }
  if (code === 40901 || e?.status === 409) return { kind: 'conflict', message: msg || '数据状态已变化，请刷新后重试' }
  if (code === 40400 || e?.status === 404) return { kind: 'notfound', message: msg || '未找到对应记录' }
  return { kind: 'unknown', message: msg || fallback }
}

/** 按错误类型给出下一步动作文案 */
export const errorAction = (kind) => ({
  network: '请检查网络后点击重试',
  credential: '请核对凭条上的三项信息',
  limited: '请稍后再试，连续失败会临时锁定',
  validation: '请修改标红字段后重试',
  permission: '如认为有误请联系管理员',
  conflict: '请刷新页面后重试',
  notfound: '请确认业务编号是否正确',
  unknown: '请稍后重试或联系网格员'
}[kind] || '请稍后重试')
