/**
 * 无 GUI 无头渲染入口（仅用于 agent 侧取证，不参与产品运行时）。
 *
 * 与 `entry.tsx` 的区别：这里**只注册产品 `<Composition>`**，不执行 `void main()`
 * 那套 web-renderer + `/__save` 回写流程 —— 否则 headless 加载页面时会去 POST 一个不存在的服务。
 */
import { registerRoot } from 'remotion'
import { Root } from '../../src/remotion/components/Root.js'

registerRoot(Root)
