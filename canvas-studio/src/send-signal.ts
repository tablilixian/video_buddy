/**
 * 发送信号的**解耦**（纯函数，Host/Client 两侧无关，可单测）。
 *
 * 背景（2026-10-22 真机）：首页首句认领成功后，页面弹
 * `client api: Remote invocation "session/prompt" was aborted (gateway/cancelled)`，
 * 项目建出来了、会话也切过去了，但**首句永远进不去**（对话区空白）。
 *
 * 真因不在 dsh，也不在认领：`conversation.sendSession` 的第 5 个参数是
 * 「调用方取消信号」，它由**承载这条消息的那个 composer shell** 铸造
 *（`SessionInputShell` 的 `detached` 控制器，见 dsh-client-ui-conversation 的
 * `mintAttempt` / `onRelease`）。而认领必须把 draft 目录就地改名成项目目录 ——
 * 于是我们**在同一拍里拆掉旧 shell**：
 *
 *   - `uiWorkspace.openSession(newId)` 切走会话；
 *   - `workspaces.archiveSession(旧会话)` + `workspaces.delete(旧 workspace)`
 *     把落点痕迹摘掉。
 *
 * 旧 shell 的 `ctx.effect` 清理函数随之跑 `shell.dispose()` → `dispatchRun({type:'release'})`
 * → `onRelease()` → `for (const controller of this.detached.values()) controller.abort()`。
 * 于是**我们手里的 signal 在自己动手之后必然变成 aborted**；再把它原样传给新会话的
 * `session.prompt(...)`，api-gateway 在第一次 await 前就判 `gateway/cancelled`
 *（`dsh-api-gateway` 的 `remoteCancelled`），消息零送达。
 *
 * 结论：**跨会话发送时必须换一条信号**。这里采用「快照」语义 —— 只继承切换**之前**
 * 已经发生的取消（用户真的按了取消），之后旧 shell 的中止一律不算数，因为那时它
 * 只代表「我们主动拆掉了一个已经不属于这条消息的 composer」。
 *
 * 反过来也不能省掉信号的继承：若调用方在我们动任何副作用之前就取消了（例如用户
 * 连点两次 / 关闭面板），已中止的信号仍然立刻失败，不会白建一个空项目。
 */
export function detachCallerSignal(source: AbortSignal | undefined): AbortSignal {
  const controller = new AbortController()
  // 只继承「此刻之前」的取消。已中止的信号原样中止，让宿主立刻拿到失败结果。
  if (source?.aborted === true) controller.abort(source.reason)
  // 刻意不 `source.addEventListener('abort', ...)`：之后的中止来自被我们拆掉的旧
  // composer，与这条消息无关（见文件头注）；转发它等于把 bug 重新装回去。
  return controller.signal
}
