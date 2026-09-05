# 对话附件旁路上传画布（方案 B）

> 状态：代码完成，静态验证全绿；**端到端真机验收未做**（见 §6）。
> 日期：2026-09-05

## 1. 问题与决策

用户在对话输入框贴参考图点发送时：

- 附件被 `ui-conversation` 序列化成 base64 image content block 直接塞给 LLM，纯文本模型（如 glm-4.5-flash）直接报「当前模型不支持图片」；
- 即使模型支持，图片也只进对话上下文，画布与生成工具（`list_references` / `image_generate` 等）都拿不到。

用户拍板（2026-09-05）：

1. **方案 B**：发送时附件走「Host 落盘 → 画布落素材节点 → 正文追加 `@ref[标题]`」，不再作为 content block；
2. ~~旁路落的素材是**普通素材节点**，不自动标记参考~~ → **22:22 修订：附件自动标记为参考**（`isReference=true`，role=image，进参考托盘与 list_references；用户理由：上传的素材都是要当参考用的；具体定位由用户在详情面板手动改）；
3. 先确认扩展点，确认后直接开工。

## 2. 发送链路（改后；2026-09-05 晚二轮优化：两段式上传）

```
点击发送
  ├─ 快速段（阻塞，毫秒级）：/canvas-studio/upload-local 只做「校验 + 项目 assets 落盘」
  │    → 立刻落素材节点（同源 url 可预览）→ 消息发出，进入聊天
  ├─ 后台段（不等人）：/canvas-studio/promote 逐个读盘上传 Drama → filename 回填节点 + 落盘
  │    （skill 编排的前置确认（审批 / 点选）就是天然时间窗，大概率发送后几秒内回填完成）
  └─ 惰性兜底：生成工具解析 @ref 时节点还没有 filename → Host 现场读盘上传 Drama
     并回写 canvas.json（host-tools.resolveRefFilenames）——正确性与后台进度完全解耦
```

- 冷启动正好覆盖：新建项目后第一句话带动附件，会话创建瞬间素材已落画布。
- 消息气泡正文会显示 `@ref[xxx]` token（对用户可见，即引用凭据）；不加额外气泡提示（用户拍板）。
- 快速段失败（连本地落盘都不行）→ 回落原 base64 content block 路径，行为不变。

## 2.1 两段式的关键机制

- **节点 url 即磁盘指针**：`/canvas-studio/assets/<projectId>/<file>` 自编码项目与文件名，
  Host 随时能反查落盘字节（`assetKeyFromUrl`），画布节点契约**零新增字段**。
- **in-flight 去重**：`generate.promoteAssetFile` 按 `projectId/assetFile` 合并并发提升——
  后台预热与惰性兜底同时触发不会重复上传；文件名白名单（`[A-Za-z0-9._-]`）双处校验防穿越。
- **回写通道**：惰性兜底经 `registry.writeCanvas` 回填 filename（与 CV-031b
  `backfillUploadFilename` 同一先例）；客户端后台预热经 `updateNode + persistCanvasQueued`。

## 2.2 真机首测诊断与加固（2026-09-05 21:xx）

**现象**：5 张图出现 10 个节点、Drama 收到 10 次上传；且「感觉还是挺慢」。

**canvas.json 实测数据**：两批节点 `createdAt` 间隔 **41.2s**（20:47:03 与 20:47:44），
每批内部 5 张仅 **~230ms**（每张 ~45ms）。结论：

- **不是代码双触发**——是同一条带附件草稿的消息被发送了两次（第一次提交后草稿
  被还原——大概率提交报错或用户等不及重发；第二次发送成功且带同样 5 张图）。
- **拷贝本身不慢**（230ms ≪ 1s）；「慢」的感知来自拷贝之后的 `session.prompt`
  往返 + 本地思考型模型（ollama qwen3.5）首个响应的等待——不属于本功能范畴。

**加固（本轮已实现）**：

1. **内容哈希去重**：节点新增持久字段 `contentHash`（SHA-256 hex，仅旁路写入）。
   `divertAttachments` 落卡前按哈希查画布已有节点，命中则**复用**——不重复落盘、
   不重复上传 Drama、不重复落卡，token 指向同一节点。重发 / 双击 / 同消息内
   重复图全部免疫；持久在 canvas.json，重启后依然生效。
2. **快速段并行化**：5 张图的落盘/探测/哈希改 `Promise.all`，~230ms → ~1 次往返。
3. 全部无新附件时（全部命中去重）不再触发空持久化。

## 3. 改动清单

### 3.1 harness fork 正本（deepseek-harness @ tag dsh-v0.1.1-rc.2）

`packages/client/ui-conversation/src/client/service.ts`：

- 新增导出接口 `ConversationAttachmentDivert { divert(files, text, signal?): Promise<string | undefined> }`；
- `IConversation` 增加可选方法 `registerAttachmentDivert?(divert | undefined)`（可选是为了不破坏现有测试 fake）；
- `ConversationController`：新增 `attachmentDivert` 字段与 `registerAttachmentDivert()`（root 服务全局唯一，后注册覆盖，undefined 注销）；
- `sendSession`：附件 > 0 且有 divert 时先调 divert——返回文本则按纯文本提交（草稿仍在 prompt 成功结算后才释放，失败可恢复），返回 `undefined` 或抛错则回落原路径并 `logger.warn`。

### 3.2 dist 等价补丁（运行时实际生效的代码）

`dsh-plugin-desktop/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js` 与
`lib/types/client/service.d.ts` 已手工应用与 §3.1 完全等价的补丁（`node --check` 通过）。

> ⚠️ 原因：harness monorepo `pnpm install` 被 WorkBuddy broker 拦截（symlink 到 `~/Library/pnpm` 被拒），进程改造后仍 137 被杀，无法本地构建整包。fork 恰好停在与运行时一致的发布 tag，故直接补丁 dist。
> ⚠️ **重装依赖（yarn/pnpm install）会冲掉该补丁**：届时需重新应用，或等 harness 依赖可装后按 §3.1 正本走 `pnpm --filter @deepseek-ai/dsh-client-ui-conversation bundle` 构建覆盖。

### 3.3 canvas-studio

- `src/client/index.ts`：
  - `divertAttachments(files, text, signal)`：`resolveActiveProjectId()` 无项目时返回 undefined（不旁路）；逐个 `uploadLocalStudioImageDeferred`（**快速段：仅落盘**）→ `addImportNode(..., isReference=false)`（标题去 `[ ]` 保证 token 可解析，CR-031；**不带 filename**）→ 探测真实宽高落 `mediaWidth/Height` → `persistCanvasQueued` → `promoteDeferredAssets` 后台预热（fire-and-forget，完成 `updateNode` 回填 filename + 落盘；失败仅 `logger.warn`，由惰性兜底接力）；返回 `原文\n@ref[t1] @ref[t2]`（无正文则纯 token）。
  - 注册 effect：500ms × 60 次轮询 `ctx.get('conversation')` 直到服务可用再注册（fiber 顺序不保证；绝不能进 `inject`，环依赖，见文件头注释），卸载时注销。
- `src/client/api.ts`：`uploadLocalStudioImageDeferred`（POST `/canvas-studio/upload-local`）与 `promoteStudioImage`（POST `/canvas-studio/promote`）；原 `uploadLocalStudioImage`（一步式）保留给工具条上传。
- `src/host-tools.ts`：`resolveRefFilenames` 匹配池改为**参考托盘优先、普通素材节点（带 filename）兜底**——否则「不自动标参考」的旁路节点 token 永远解析失败；`isReference` 回归托盘展示语义。`list_references` 行为不变（仍只列托盘节点）。命中节点缺 filename 且 url 是画布资产 → **惰性兜底**：`promoteAssetFile` 现场上传 Drama 并 `writeCanvas` 回写 filename。
- `src/generate.ts`：`uploadLocalImage` 拆成 `saveLocalImage`（校验+落盘）与 `promoteAssetFile`（读盘→Drama，per-asset in-flight 去重 + 文件名白名单防穿越）；新增纯函数 `assetKeyFromUrl`；`uploadLocalImage` 保持原语义（save+promote）供旧路由与工具条上传使用。
- `src/routes.ts`：新增 `/canvas-studio/upload-local` 与 `/canvas-studio/promote` 两个同源 POST 路由（守卫脚手架与 `/upload` 一致）。

## 4. 明确不做 / 后续

- 附件类型仍限于图片（harness `createDraftImages` 的 MIME 白名单决定）；音频/文件需上游扩 MIME 与画布节点 kind，另行排期。
- 模型能力分流（方案 C：视觉模型图照常进上下文 + 同时落画布）留作二期。
- 重复图片按内容 hash 去重：未做（本轮从简）。

## 5. 验证记录（2026-09-05）

- canvas-studio：`tsc -p tsconfig.json` / `tsconfig.client.json --noEmit` ✓；`tsdown` 构建 ✓；`verify-client-loader` ✓；`node --test tests/*.test.mjs` **264 pass 0 fail** ✓（含新增 `tests/asset-promote.test.mjs` 4 条 assetKeyFromUrl 契约测试）。
- dist 补丁：`node --check` ✓；d.ts 与源码同步。
- harness fork 源码：未单独 typecheck（monorepo 依赖装不上），与 dist 补丁人工对齐。

## 6. 真机验收清单（下一步）

`bash start-canvas-studio.sh`（完整模式，重建桌面使补丁生效）后：

1. 新建项目 → 输入框贴 1–4 张图 + 文案 → 发送：**无「当前模型不支持图片」报错，且发送不被 Drama 上传阻塞**（点击后 ≤1s 进入聊天状态）；
2. 画布**立即**出现对应数量普通素材节点（无「已标记」徽章），图片可直接预览（本地 url）；
3. 发送后几秒～几十秒内，节点 filename 被后台预热静默回填（canvas.json 可查）；
4. 消息气泡正文尾部出现 `@ref[文件名]`；
5. 让 agent 生成视频：`@ref` 能解析出 Drama filename——无论后台预热是否完成（惰性兜底验证：发消息后立刻让 agent 生成也必须成功）；
6. `list_references` 看不到旁路节点，属预期——未标参考；
7. 手动把某节点标记为参考后，参考托盘出现、生成可引用；
8. 旁路失败回退：断网/停 Host 后端再贴图发送 → 走原路径（视觉模型可收到图 / 文本模型报原错误），日志出现 `attachment divert failed` warn；
9. 后台预热失败（发送后立即断 Drama 网络）→ 生成时惰性兜底现场重试成功（Host 日志可见 promote 调用）。
