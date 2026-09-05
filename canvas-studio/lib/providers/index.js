/**
 * 内置视频供应商注册（阶段 2 起；阶段 4 追加 fal）。
 *
 * 在插件装配时调用一次；该函数在 `generate.ts` 模块加载时也会调用
 * （保证测试直连 lib/generate.js 时供应商已注册），重复调用为幂等覆盖（Map.set），无副作用。
 */
import { registerProvider } from './registry.js';
import { createDramaProvider } from './drama.js';
import { createFalProvider } from './fal.js';
export function registerBuiltinVideoProviders() {
    registerProvider(createDramaProvider());
    // fal 是异步（队列三段式）供应商，执行形态差异封装在 adapter 内，上层无感。
    // 注册顺序在 drama 之后：未显式指定时仍优先走 drama（升级后默认行为不变）。
    registerProvider(createFalProvider());
}
