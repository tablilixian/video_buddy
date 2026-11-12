/**
 * 整片模板通道的开关（2026-11-12 临时下线 → **2026-11-13 按用户指示重开**）。
 *
 * 历史：2026-11-12 因「模板复刻产物还原度未达预期」临时下线（只关入口不删能力：
 * 关闭态 `list_templates` 不注册、`scaffold_manifest` 拒收 `templateId`、system
 * prompt 常驻「走自由编排」覆盖指令）。**2026-11-13 用户明确要求重开**（并新增
 * `vo-ad/vo-spot-30s` 口播广告模板），`DEFAULT_ENABLED` 改回 `true`。
 * 需要再次临时关闭时：启动前导出 `CANVAS_STUDIO_TEMPLATE_CHANNEL=0`（env 优先于
 * 缺省值，无需改代码）。
 *
 * 读 env 放在函数里而非模块常量：测试需要在同一进程里切两态做行为断言。
 * `typeof process` 保护是给万一被客户端 bundle 误引入时留的（Host-only 模块）。
 */
export const TEMPLATE_CHANNEL_ENV = 'CANVAS_STUDIO_TEMPLATE_CHANNEL'

const DEFAULT_ENABLED = true

export function templateChannelEnabled(): boolean {
  const raw = typeof process === 'undefined' ? undefined : process.env[TEMPLATE_CHANNEL_ENV]
  if (raw === '1') return true
  if (raw === '0') return false
  return DEFAULT_ENABLED
}
