# harness 升级可行性研究（dsh-v0.1.1-rc.2 → 最新）

> 状态：研究完成，待用户拍板升级目标与时机。
> 日期：2026-09-07
> 本地镜像：`/Users/wl/Desktop/job/learn/deepseek-harness`（已 fetch 至 origin/master）
> 关联：`docs/plans/attachment-divert-no-fork.md`（无 fork divert 方案）、`docs/harness-fork-maintenance.md`

## 1. 官方仓库最新情况

| 项 | 状态 |
| --- | --- |
| git 最新 tag | `dsh-v0.1.3-alpha.1`（= origin/master HEAD，PR #3554） |
| npm `@deepseek-ai/dsh` dist-tags | `latest: 0.1.2-rc.1`，`alpha: 0.1.2-alpha.5`；**0.1.3-alpha.1 尚未发 npm** |
| 跨度 | rc.2 → 0.1.3-alpha.1 共 **2063 commits**（含 0.1.2 全系列 alpha/rc） |
| 官方 divert 扩展点 | **没有**。全树 grep `divert` 零命中——`registerAttachmentDivert` 式的官方口子不存在，无 fork wrapper 方案仍是唯一路径 |

### sendSession 的上游演进（对我们方案的影响）

新版（0.1.3-alpha.1）`sendSession` 重写为「提交回显 + 后台上传队列」架构：`session.beginSubmission` echo、通用文件（不止图片）经 Worker 后台上传（`maxConcurrentFileUploads`）、FileReader data-URL 编码、回显退休后统一释放草稿（`service.ts:228-290`）。

- **wrapper 方案依然成立**：`conversation` 服务键仍在（`super(ctx, 'conversation')`），`sendSession` 仍是实例方法、仍是唯一附件入口（hub.ts:186 调用时 `rootCtx.get('conversation')` 解析）。
- 0.1.2-rc.1 上 facade 与 rc.2 **完全一致**（仍是 `draftImages`/`releaseDraftImages`，service.ts:270）；0.1.3 才改名 `resolveDraftAttachments`/`releaseDraftAttachments`——wrapper 的特征检测（`resolveDraftAttachments ?? draftImages`）可同时兼容两代。

## 2. 升级目标建议

**推荐 `dsh-v0.1.2-rc.1` / npm `0.1.2-rc.1`**：npm `latest` 与 `next` 都指向它，是当前最稳的可安装版本；且 divert wrapper facade 零改动。`0.1.3-alpha.1` 未发 npm 且是 alpha，不建议跟。

## 3. canvas-studio 兼容性核对（以 0.1.2-rc.1 为准）

### 唯一硬伤：`conversationEvents` 服务键已移除

| rc.2 | 0.1.2-rc.1 |
| --- | --- |
| 独立服务键 `conversationEvents`（runtime 包），`ctx.conversationEvents.register(definition)` | 并入 `uiConversation` 服务（ui-conversation 包，`assembly.ts`），入口 `ctx.uiConversation.events.register(definition)`；`ConversationNodeDefinition.match` 参数由 `SessionEvent` 改为 `SessionEventLike`（`contract/conversation.ts:1`） |

canvas-studio 迁移动作（共 3 处调用点）：

1. client `inject` 数组：`'conversationEvents'` → `'uiConversation'`；
2. `createBriefCaptureDefinition` / `createAssetCaptureDefinition` 两处注册改走 `ctx.uiConversation.events.register(...)`（注意环依赖注释：`uiConversation` 与 `conversation` 同包，同样不能进顶层 inject，需沿用轮询/惰性模式）；
3. definition 的 `match(event)` 放宽为 `SessionEventLike` 适配。

### 其余依赖面：全部无需改动

| 依赖面 | 结论 | 证据 |
| --- | --- | --- |
| inject 键 `slots`/`workspaces`/`sessions`/`connection`/`settingsScope`/`theme` | ✅ 全部保留 | 各包 `super(ctx, '<key>')` 命中 |
| `conversation` 服务（`send`/`input`/`blocks`/`cancel`） | ✅ 不变 | ui-conversation service.ts:39,184 |
| ui-slots（`slots.inject/register`） | ✅ 不变 | 包存续 |
| Host 侧 `defineTool`（exec.agent/signal、ContentBlock 渲染） | ✅ 不变 | core/tools schema.ts:545 |
| `webServer.register(WebRoute)` | ✅ 不变 | host-webserver index.ts:165 |
| `dsh-system-prompt`/`llm`/`home-paths`/`credentials`/`atomic-write`/`skill`/`session` | ✅ 包均存在，契约未见破坏 | git ls-tree 核对 |
| 打包机制 `dsh.profile.bundles` / `bundle.patch` / client inject | ✅ 仍支持 | boot/app-boot profile.ts:7-11 |

## 4. 升级步骤清单（拍板后执行）

1. **版本对齐**：`video_buddy/deepseek-harness` submodule pin → `dsh-v0.1.2-rc.1`；本地镜像切同名 tag 建分支（fork 正本若需保留，从另一台电脑取回——当前本机没有 `local/attachment-divert`）。
2. **desktop 依赖 bump**：`dsh-plugin-desktop/package.json` 全部 `@deepseek-ai/dsh*` 由 `0.1.1-rc.2` → `0.1.2-rc.1`（含 `dsh`、`dsh-agent`、`dsh-client-*`、`dsh-client-ui-*`），`corepack yarn install --immutable`。
3. **canvas-studio 迁移**：§3 的 conversationEvents 三处改动；tsc + tsdown + verify-client-loader + 全量测试。
4. **dist 补丁处置**：升级后 node_modules 重装，旧 dist 补丁彻底作废（本就丢了）；divert 由 wrapper 方案接管，**升级反而消除了补丁维护负担**。
5. **验证链**：`yarn check` + 真机冒烟（画布加载、贴图发送、生成工具、@ref 解析）；若真机回归出问题，回退 = 还原 package.json 版本重新 install。
6. **文档同步**：`harness-fork-maintenance.md` 版本基线更新；若采纳 wrapper 方案，dist 补丁台账标记废弃。

## 5. 风险与建议

| 风险 | 等级 | 说明 |
| --- | --- | --- |
| 2063 commits 的隐性 breaking | 中 | Agent 核对只覆盖 canvas-studio 的已知依赖面；真机冒烟是必要门槛 |
| `SessionEventLike` 适配面 | 低 | 两处 definition 的 match 实现，类型层面小改 |
| alpha 节奏快 | 提示 | 0.1.2-rc.1 是当前最稳落点；0.1.3 正式版发布后可做第二次小升级（wrapper 已双代兼容） |
| 上游 sendSession 新架构 | 提示 | 官方自有附件上传与 divert 并存不冲突（divert 拦截在最前），但通用文件（非图片）暂不在 divert 范围 |

**结论**：升级可行且成本可控——除 `conversationEvents` 一处迁移外，canvas-studio 依赖面在 0.1.2-rc.1 上零改动；升级同时天然解决 dist 补丁被冲掉的顽疾。建议顺序：先落 wrapper divert 方案（rc.2 上验证通过）→ 再升 0.1.2-rc.1 → 0.1.3 正式版发布后按需跟进。
