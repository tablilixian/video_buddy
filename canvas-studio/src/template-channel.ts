/**
 * 整片模板通道的临时开关（2026-11-12）。
 *
 * 背景：模板复刻产物的还原度未达预期，先临时下线整片模板通道，等制作工艺有
 * 更好的方案再推进。这里只关「入口」，不删「能力」：
 *   - 关闭态：`list_templates` 不注册（模型看不见）、`scaffold_manifest` 传
 *     `templateId` 被拒收、system prompt 常驻「走自由编排」的覆盖指令；
 *   - 保留：`assets/templates/**` 全部资产、`template-*` 编译器 / 五判据 /
 *     槽位合同 / furniture 构件 / recipe 骨架 / validateManifest / textFit
 *     / 渲染回执判据，以及覆盖开启态的模板测试。
 *
 * 恢复方式（任选其一，无需改任何业务代码）：
 *   1. 启动前导出 `CANVAS_STUDIO_TEMPLATE_CHANNEL=1`；
 *   2. 把下面的 `DEFAULT_ENABLED` 改成 `true`。
 *
 * 读 env 放在函数里而非模块常量：测试需要在同一进程里切两态做行为断言。
 * `typeof process` 保护是给万一被客户端 bundle 误引入时留的（Host-only 模块）。
 */
export const TEMPLATE_CHANNEL_ENV = 'CANVAS_STUDIO_TEMPLATE_CHANNEL'

const DEFAULT_ENABLED = false

export function templateChannelEnabled(): boolean {
  const raw = typeof process === 'undefined' ? undefined : process.env[TEMPLATE_CHANNEL_ENV]
  if (raw === '1') return true
  if (raw === '0') return false
  return DEFAULT_ENABLED
}
