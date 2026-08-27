import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import './slots-contracts.js';
/**
 * Services required before the studio frame can mount.
 *
 * 注意：`tools` 是 Host 专属服务，客户端没有该服务。媒体生成工具已在 Host
 * 侧（`src/host-tools.ts`）注册，客户端只负责 UI、项目/工作区绑定，以及
 * 通过 `conversationEvents` 捕获工具产物到画布 store（P4），并把画布节点
 * 持久化到 Host（P4+ 重启恢复）。`sessions` 用于打断当前会话的生成回合。
 */
export declare const inject: string[];
/**
 * Client plugin body: provide the standard ctx.layout contract (owned by the
 * disabled ui-layout row) and register the studio frame into the runtime's
 * built-in root slot, declaring the standard child seats so the upstream
 * sidebar/conversation/details plugins keep their registration paths.
 *
 * Project switching binds the conversation to the project's workspace: each
 * project owns one workspace registered at its disk directory, and opening a
 * project connects (reusing a blank session) and navigates to it. The canvas
 * nodes for that project are loaded (and, with `?cs-dev-seed=1`, seeded) here.
 * @param ctx - active browser Cordis context.
 */
export declare function apply(ctx: ClientContext): void;
