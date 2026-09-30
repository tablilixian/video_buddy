/**
 * REQ-003：参考句柄解析端点（`POST /canvas-studio/resolve-refs`）的**共享契约**。
 *
 * 为什么单列一个模块：Host 侧（`routes.ts`）与客户端（`client/api.ts`）必须对同一
 * 个形状达成一致，而它既不属于画布文档（那是持久化契约，本批刻意不动），也不属于
 * 资产库。放这里两侧 import 同一份，避免各写一遍再漂移。
 */

/** 一次请求最多解析多少个引用（UI 一次多选的上限；超出部分被截断而不是报错）。 */
export const MAX_RESOLVE_REFS = 32

/** 解析结果的一项：成功给 `handle`，失败给 `error`（**逐项失败不整批失败**）。 */
export interface ResolveRefItem {
  /** 回显请求里的引用原文（节点 id 或 `lib:<id>`）。 */
  readonly ref: string
  /** 可直接下发给后端的 Drama 文件名（成功时存在）。 */
  readonly handle?: string
  /** 失败原因（用户可读；`message` 恒为 `userMessage`，不含路径等开发者细节）。 */
  readonly error?: { readonly code: string; readonly message: string }
}

export interface ResolveRefsResponse {
  readonly items: readonly ResolveRefItem[]
}
