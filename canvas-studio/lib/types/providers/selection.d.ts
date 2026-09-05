/**
 * 视频供应商参数校验（阶段 3）。
 *
 * 把「入参 provider 是否合法」抽成可单测的纯函数，供 generate.ts 与 routes.ts 共用。
 * 合法值当前仅 'drama' / 'fal'（与设计文档 §4.5 对齐）。约束 4：路由的 provider
 * 字段无白名单校验，必须做枚举校验，否则是不可控的注入面。
 */
import type { VideoProviderId } from './types.js';
/**
 * 校验入参 provider 字段。
 * - 未提供（undefined / null）→ 返回 undefined（交由默认供应商逻辑处理）。
 * - 合法字符串 → 返回该值。
 * - 非法值 → 抛出含「仅支持 drama / fal」的明确中文错误（供 routes 转 400）。
 */
export declare function parseProviderParam(value: unknown): VideoProviderId | undefined;
