/**
 * 视频生成供应商抽象层 —— 契约定义（阶段 1）。
 *
 * 目标：把「视频生成」从单一 Drama Backend 解耦成「能力路由 + 供应商适配器」，
 * 使新增模型（如 fal 的 MiniMax H3）只需新增一个适配器文件，不再改动
 * `generate.ts` 的主流程。
 *
 * 核心设计：**同步与异步执行形态的差异完全封装在适配器内部**。
 * - 同步供应商（Drama）：`submit()` 内部一次请求等到底，结果放进
 *   `handle.settled`，`poll()` 首次即返回 done，零额外开销。
 * - 异步供应商（fal，队列三段式）：`submit()` 返回 request_id，
 *   `poll()` 反复查询直到 done。
 *
 * 上层（executor）只认 `submit()` + `poll()` 两段，对两者一视同仁。
 *
 * 本阶段只落地契约与注册表骨架，**不接入任何调用方**。
 * 方案文档：docs/plans/video-provider-abstraction.md
 */
export {};
