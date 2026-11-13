/**
 * 全站展示级常量（构建期由前端消费，不涉及任何后端配置）。
 * 版本号只在这里维护一处，登录页 / 顶栏 / README 保持同一口径。
 */
export const APP_VERSION = 'V2.6'

/**
 * 示意件统一开关。
 * - 开发环境：默认开启，便于演示与验收；设置 VITE_DEMO_MODE=0 可关闭。
 * - 生产构建：默认强制关闭（避免假画面混进真实数据）；确需在生产构建里展示，
 *   必须同时显式设置 VITE_DEMO_MODE=1 与 VITE_DEMO_IN_PROD=1，并在页面显著标注「示意」。
 * 注意：本开关只控制「演示控件」的显隐，绝不参与任何鉴权或数据权限判断。
 */
const requested = import.meta.env.VITE_DEMO_MODE === '1'
export const DEMO_MODE = import.meta.env.PROD
  ? requested && import.meta.env.VITE_DEMO_IN_PROD === '1'
  : import.meta.env.VITE_DEMO_MODE !== '0'

/** 示意地图 / 示意图层的统一口径说明（无论何种模式都必须如实标注） */
export const SCHEMATIC_MAP_NOTE = '示意边界（由组织 bounds 生成，非测绘成果）'
