/**
 * 供应商注册表（阶段 1）。
 *
 * 提供注册与按能力路由。注册顺序即「未指定供应商时的默认优先级」，
 * 当前由 `index.ts` 在插件装配时决定（阶段 2 起 drama 先注册）。
 *
 * 阶段 3 会在此基础上叠加「设置项默认值 → 参数显式指定」的优先级链。
 */
import type { VideoCapability, VideoProvider, VideoProviderId } from './types.js';
/** 注册一个供应商。重复注册同一 id 会覆盖（便于测试与热替换）。 */
export declare function registerProvider(provider: VideoProvider): void;
/** 注销一个供应商（测试与热替换用）。 */
export declare function unregisterProvider(id: VideoProviderId): void;
/** 清空注册表（测试用，避免用例间互相污染）。 */
export declare function clearProviders(): void;
/** 按 id 取供应商。 */
export declare function getProvider(id: VideoProviderId): VideoProvider | undefined;
/** 列出全部已注册供应商（按注册顺序）。 */
export declare function listProviders(): readonly VideoProvider[];
/**
 * 选出能处理该能力的供应商。
 *
 * 优先级：显式指定 > 注册顺序（阶段 3 会在中间插入设置项默认值）。
 *
 * **显式指定但不支持时抛错，不静默回退**——静默换供应商会让出片风格突变，
 * 用户更难排查。（策略待文档 §10 Q1 审批确认，当前按此实现。）
 */
export declare function resolveProvider(capability: VideoCapability, preferred: VideoProviderId | undefined): VideoProvider;
