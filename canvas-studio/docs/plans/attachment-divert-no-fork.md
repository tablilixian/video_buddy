# 附件旁路 divert 无 fork 重实现（方案研究）

> 状态：研究完成，待用户批准后实施。
> 日期：2026-09-07
> 关联：`docs/plans/conversation-attachment-divert.md`（原 fork 方案）、`docs/harness-fork-maintenance.md`（dist 补丁台账，其 §4 预警已应验一次）。
> 目标：**零 harness 仓库/dist 改动**，把「对话贴图 → 画布落节点 → @ref 引用」功能做到 harness 升级天然兼容。

## 1. 结论（先说答案）

**可行，且有比 dist 补丁更优的拦截点。** 原补丁改的是 `ConversationController.sendSession`——而该方法是**实例方法**，且唯一调用方 `InputHub.sink` 是**调用时**才经 `rootCtx.get('conversation')` 取单例再查方法（hub.ts:216-220, 173）。因此 canvas-studio 作为 client plugin **在运行时包装该实例方法**即可拦截同一条链路，harness 仓库与 node_modules 都不用动。

## 2. 拦截点解剖（代码证据，基于本机干净 tag dsh-v0.1.1-rc.2）

| 环节 | 位置 | 关键事实 |
| --- | --- | --- |
| 附件提交唯一入口 | `ui-conversation/src/client/service.ts:145` `sendSession(session, text, imageIds, mode, signal)` | 原方案 §3.1 补丁的注入点 |
| 唯一调用方 | `ui-conversation/src/client/input/hub.ts:173` `this.conversation().sendSession(...)` | 无其他调用方（全仓 grep 验证） |
| 服务解析方式 | `hub.ts:216-220` `rootCtx.get('conversation')` **每次调用时**解析 | 方法在调用点做实例属性查找 → 实例级包装生效 |
| 草稿文件获取 | `service.ts:184` `draftImages(ids)` 公开方法，返回含 `.file` 的 `ComposerAttachment` | wrapper 无需触碰私有状态 |
| 草稿释放 | `service.ts:224` `releaseDraftImages(attachments)` 公开方法，含 blob URL 回收 | 成功路径自己释放，与原补丁「成功后才释放」语义一致 |
| 提交结果契约 | `SubmitOutcome = { kind: 'success' } \| { kind: 'error' }`（ui-input-trigger） | composer 以此决定是否还原草稿；wrapper 返回同契约 |

**排除的其他路径**（研究过、否决）：

- `ui-input-trigger` 的 bail 事件：仅输入机内部消费（paste-upgrade 等），不是对第三方开放的提交拦截点；
- Cordis 客户端服务替换：无公开 API（profile 的 patches 是包补丁管理，非运行时 override）；
- composer 槽位整体替换：成本高、丢失原生 composer 能力，否决；
- Host 侧拦截：session.prompt 到 apiproxy 的链路无插件可见的 transform 钩子。

## 3. 方案设计：runtime 方法包装（wrap, not patch)

改动范围：**仅 `canvas-studio/src/client/index.ts` 的注册 effect**（374-400 行一带）。`divertAttachments` 及两段式上传、哈希去重、@ref 全链路**原样复用**。

```ts
// 结构化 facade（不 import 上游内部类型，仅结构性约束）
type DivertConversation = {
  sendSession(session: SessionFace, text: string, imageIds: readonly DraftAttachmentId[],
              mode: InputSubmitMode, signal?: AbortSignal): Promise<SubmitOutcome>
  draftImages(ids: readonly DraftAttachmentId[]): readonly { id: DraftAttachmentId; file: File }[]
  releaseDraftImages(attachments: readonly { id: DraftAttachmentId }[]): void
}

ctx.effect(() => {
  const conversation = pollForService() as DivertConversation | undefined
  // 特征检测：上游内部签名变化 → 不安装、warn、行为退回原生
  if (typeof conversation?.sendSession !== 'function' || typeof conversation?.draftImages !== 'function') {
    ctx.logger.warn('canvas-studio: conversation.sendSession facade not detected, attachment divert disabled')
    return
  }
  const original = conversation.sendSession // 实例原型方法
  conversation.sendSession = async (...args) => {
    const [session, text, imageIds, mode, signal] = args
    if (imageIds.length === 0) return original.apply(conversation, args) // 纯文本零开销直通
    try {
      const attachments = conversation.draftImages(imageIds)
      if (attachments.length === 0) return original.apply(conversation, args)
      const files = attachments.map((a) => a.file)
      const divertedText = await divertAttachments(files, text, signal)
      if (divertedText === undefined) return original.apply(conversation, args) // 无激活项目 → 原路径
      const result = await original.call(conversation, session, divertedText, [], mode, signal) // 纯文本提交
      if (result.kind === 'success') conversation.releaseDraftImages(attachments)
      return result
    } catch (cause) {
      ctx.logger.warn(`canvas-studio: attachment divert failed, fallback to native: ${...}`)
      return original.apply(conversation, args) // 快速段失败 → 原生 base64 路径（原方案同款降级）
    }
  }
  return () => { conversation.sendSession = original } // 卸载还原
}, 'canvas-studio: conversation attachment divert')
```

### 语义对齐表（与原 fork 补丁逐条对照）

| 原补丁行为 | wrapper 等价实现 |
| --- | --- |
| divert 返回文本 → 按纯文本提交 | `original(session, divertedText, [], mode, signal)` |
| 返回 undefined / 抛错 → 回落原路径 + warn | catch + `original.apply(args)` 同款 |
| 草稿在 prompt 成功结算后才释放 | 仅 `kind==='success'` 时 `releaseDraftImages` |
| 纯文本消息不受影响 | `imageIds.length === 0` 直通 |
| queue / steer 双模式 | mode 原样透传 |

### 升级韧性（设计初衷的核心）

- **特征检测 + 结构化 facade**：不 import 上游内部符号类型，只做结构匹配。上游内部重构时最坏结果是「检测不到 → 功能关闭 + 启动日志可见」，**绝不会崩客户端或污染原生行为**。
- **参数透传用 rest args**：上游给 sendSession 加参数时直通路径不受影响（divert 路径的显式 5 参调用需人工跟进，属可接受维护点）。
- **卸载还原**：effect disposer 恢复原方法，热重载/插件停用不留痕。
- **自检命令**：`grep -c "divertAttachments" canvas-studio/lib/client.js ≥ 1`（构建产物在仓库内，不随 install 丢失）——比 dist 补丁的自检可靠一个量级。

## 4. 风险与缓解

| 风险 | 等级 | 缓解 |
| --- | --- | --- |
| 官方插件纪律「不 override 其他插件 internals」（plugin-development.en.md:210-211） | 中 | 这是 wrap 而非 replace；失败即回落原生；功能关闭的降级是静默安全的。属于有意识的工程取舍，换取零 fork |
| 上游 rename `sendSession`/`draftImages` | 低 | 特征检测兜底，功能退化为原生行为（= 现状），启动 warn 可见 |
| 并发 sendSession（连发消息） | 低 | wrapper 无共享可变状态；divert 内部已有哈希去重 + in-flight 去重 |
| steer 模式下 divert 延迟 | 低 | 快速段毫秒级落盘，与 queue 模式相同 |

## 5. 后续动作（批准后）

1. `src/client/index.ts` 注册 effect 改造为上述 wrapper（`DivertHost` 类型替换为 `DivertConversation`）；
2. `tsc --noEmit` + tsdown 构建 + verify-client-loader + 既有测试（264 条）全绿；
3. 更新两份文档：`harness-fork-maintenance.md`（dist 补丁台账标记「已被无 fork 方案取代」）、`conversation-attachment-divert.md` §3.2 加 supersede 说明；
4. 真机验收：沿用原方案 §6 九步清单（贴图发送不报错、画布落节点、@ref 可解析、断网回退）；
5. 可选长期项：把 `registerAttachmentDivert` 扩展点作为非破坏性小 PR 提给上游——合并后 wrapper 换回官方 API，这是唯一能 100% 摆脱「内部方法依赖」的路线。
