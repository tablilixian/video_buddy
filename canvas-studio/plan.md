# Canvas Studio 开发计划（plan.md）

> 单页 UI 承载的 agent 驱动视频生产流水线（idea → storyboard → 角色/场景 → keyframe → video → 成片）。
> 本文档为开发计划与变更记录，随实现持续更新。模块边界与 Host/Client 分层见仓库 `AGENTS.md` 与 `CLAUDE.md`。

---

## 1. 设置页（Settings）实现记录

### 1.1 需求与约束

- **主页必须是画布**，画布工具栏有一个**设置按钮（齿轮）**，点开弹出设置界面。
- 设置项需包含：**主题选择**、**大模型（编排 LLM）配置**，以及既有的 Drama 后端连接配置。
- 桌面**未安装** `dsh-client-ui-settings-plugins`（其 `settings.plugin.item` 槽才是"Plugins 设置卡"的宿主）。
  早期误把配置卡注册进该孤儿槽，导致卡片永不挂载、打开设置只能落到 `openDocument` 的 raw `setting.yaml` 兜底。
  **结论：设置 UI 必须由 canvas-studio 自带弹窗承载，不能依赖全局 Plugins 面板。**

### 1.2 架构（三处数据源，统一在一个弹窗）

设置弹窗 `src/client/SettingsModal.tsx` 为自包含 UI，主页画布工具栏按钮 → `StudioFrame` 的
`settingsOpen` 状态 → 条件渲染 `<SettingsModal>`。弹窗分三个分区（标签页）：

| 分区 | 数据源 | 性质 | 作用域 / 服务 |
|---|---|---|---|
| 通用 | `src/host-config.ts` `CanvasStudioConfig` | **私有**（canvas-studio 持有） | `settingsScope.bind({ namespace: 'canvas-studio' })` |
| 主题 | 桌面 `dsh-client-ui-theme` | **全局**（影响整个桌面） | `ctx.theme` 运行时（`getTheme` / `setTheme`） |
| 模型 | 桌面 `connection.api` 三域（`llm.providers` / `settings.describe`+`settings.mutate` / `credentials`）+ 全局默认 `agent-default-model` | **全局**（与桌面原生「模型」设置完全对等、共享同一份存储） | `ctx.get('connection')?.api`，惰性 `getModelApi()` |

**关键决策（模型分区 = 自实现 provider 感知面板，而非复用 dsh 组件）：**

用户要求模型设置是一个**完整功能**——自部署 + 第三方服务商都要支持（base URL + API Key + 模型清单 + 设为默认），
与桌面原生「模型」设置**一致**。

- **尝试路径（已被证伪）**：复用 dsh 自带 `dsh-client-ui-settings-models` 组件。实际装包后发现
  `ModelsSettingsStore` / `ModelsSection` / `SettingsSchemaOperations` 均为**包内私有**、未从
  `/client` 导出；且桌面**没有任何「打开设置页」的命令 API**（仅一个 HTTP 只读端点）。故"嵌 dsh 组件 /
  跳转 dsh 原生页"在当前 dsh 版本下**技术上不可行**，已整体回退。
- **最终路径（落地）**：自实现 `ModelSettingsPanel.tsx`，直接调用 **dsh 同款 wire API**（即 dsh 组件背后的
  那套薄接口），从而做到功能对等 + **状态与桌面原生设置共享**（在 dsh 原生「模型」页也能看到同一份配置），
  且**不依赖任何 dsh 私有 API**：
  1. `connection.api.llm.providers({})` —— 拉 provider 目录（自部署 / OpenAI / DeepSeek / pi-ai 等拓扑，
     每个 provider 自带 `settingsNs` + `settingsPath`）。
  2. `settingsScope.describe()`（或 `connection.api.settings.describe`）—— 取各 provider 命名空间视图。
  3. `connection.api.settings.mutate([...pathOps])` —— 写 baseURL / models / apiKeyEnv 等。
  4. `connection.api.credentials.set({ ref, value })` —— API Key 走凭据域，不落明文。
  5. `agent-default-model` 命名空间 —— 「设为默认」写 `provider` / `model` / `reasoningEffort`。
  6. 自定义 provider 创建 —— 走 `llm-pi-ai` 命名空间（`providerType: 'pi-ai'` + `protocol` + `baseURL`）。

> 这套 wire 调用与 dsh 原生组件写入格式**逐字段对齐**（path ops + credentials.set + deriveKeyRef
> 规则），所以 canvas-studio 写出的配置能被桌面原生设置页无缝读取，反之亦然。

> ⚠️ **行为已知差异**：主题与模型两个分区改的是**桌面全局**配置，不是 canvas-studio 私有。
> 即：在 canvas-studio 弹窗里切主题 / 换模型，会同步改变整个桌面的外观与默认智能体模型。
> 若需"canvas-studio 专属模型隔离"，属更大的架构改造（canvas-studio 自己持有 LLM 客户端并驱动
> 自有 agent，即 B2），不在本轮范围。

### 1.3 数据链路

```
用户改值 → 分区组件调用 scope.set(...) / theme.setTheme(...)
        → ① 通用：'canvas-studio' 用户层写入 → Host installSettingsSection 的 source() 实时读到
                  → Host generate.ts 的 Drama 基址/时长/密钥（setRuntimeConfig 注入）
        → ② 主题：ctx.theme.setTheme(id) → 桌面主题服务发布 theme/change → 全局 UI 换肤
        → ③ 模型：'agent-default-model' 用户层写入（设为默认）→ 桌面 AgentDefaultModelConfig.currentSelection() 实时读到
                  → 驱动 canvas-studio 创作流水线的智能体大脑
        → ③' 模型连接：按 provider 写其 settingsNs 命名空间（baseURL/models/apiKeyEnv）+ credentials 域（Key）
                  → 与桌面原生「模型」设置共享同一份存储，dsh 原生页可读取
```

密钥（Drama API Key）走**凭据域** `credentials.set({ ref, value })`，不落明文；弹窗只显示
"已配置 / 未配置"状态（`credentials.describe`）。

### 1.4 涉及文件

| 文件 | 改动 |
|---|---|
| `src/client/ModelSettingsPanel.tsx` | **新增**：完整 provider 感知模型设置面板。拉 `llm.providers` 目录 + `settings.describe` 命名空间视图 + `credentials.describe` 密钥态；按 provider 渲染卡片（baseURL / API Key 写凭据域 / 模型清单可编辑 + `discoverModels` 拉取 / 设为默认写 `agent-default-model`）；支持自定义 provider（写 `llm-pi-ai` 命名空间）。写入格式对齐 dsh（`settings.mutate` path ops + `credentials.set` + `deriveKeyRef`） |
| `src/client/SettingsModal.tsx` | `ModelSection` 由原先 3 文本字段**改为薄包装**，委托 `<ModelSettingsPanel getModelApi={...} />`；`SettingsModalProps` 增 `getModelApi`；`contracts.ts` 增补 `CanvasStudioModelApi` / `ConfigurableProviderView` / `SettingsNamespaceView` / `SettingsPathOpView` / `DiscoveredModelView` 本地最小类型 |
| `src/client/contracts.ts` | `StudioProjectListInjected` 增 `getModelApi(): CanvasStudioModelApi | undefined`（惰性 thunk，复用现有 `connection` inject）；`CanvasStudioCredentials` 增 `unset({ ref })`（移除自定义 provider 清密钥用） |
| `src/client/index.ts` | return 对象增 `getModelApi: () => ctx.get('connection')?.api as unknown as CanvasStudioModelApi | undefined`（惰性，避免启动期 service not found） |
| `src/client/StudioFrame.tsx` | 解构 `getModelApi` 并传给 `<SettingsModal getModelApi={getModelApi} />`（与 `settingsScope` / `getCredentials` / `theme` 一并） |
| `src/client/styles.ts` | 补 `.csModel*` 系列样式：provider 卡片、模型清单编辑行、发现模型按钮、自定义 provider 表单（沿用 `--dsw-alias-*` 设计令牌） |
| `src/host-config.ts` | **未改动**（通用分区 schema 已就绪） |
| `src/index.ts`（Host） | **未改动**（模型连接由桌面持有，经 `connection.api` 直写） |

### 1.5 自检结果

- 客户端类型检查：`node node_modules/.bin/tsc --noEmit -p tsconfig.client.json` → **0 错误（CLIENT_OK）**
- Host 类型检查：`node node_modules/.bin/tsc -p tsconfig.json --noEmit` → **0 错误（HOST_OK）**
- 构建：`corepack yarn build` → **成功**（`lib/client.js` 252.94 kB / gzip 55.65 kB）
- **渲染未在本沙箱验证**：沙箱无法启动 Electron GUI。需用户在本地重建后验证（见 §1.6）。

### 1.6 本地验收步骤

1. 本地重建：`corepack yarn workspace canvas-studio build` → 重启 DSH Desktop。
2. 画布工具栏点齿轮 → 弹出 "Canvas Studio 设置"，出现 **通用 / 主题 / 模型** 三个标签页。
3. **通用**：Drama 基址 / 时长上限(1–15) / Key 三项可编辑，刷新后保留。
4. **主题**：点 浅色 / 深色 / 跟随系统 → 整个桌面（含画布）即时换肤；重新打开弹窗选中态正确。
5. **模型（本轮重点）**：
   - 打开「模型」标签页，**自动列出桌面所有 provider**（自部署 / OpenAI / DeepSeek / pi-ai 等），
     与桌面原生「模型」设置页看到的一致（共享存储）。
   - 选一个 provider 卡片：可编辑 **Base URL**、填入 **API Key**（写凭据域，界面只显示「已配置/未配置」）、
     **拉取模型清单**（点「发现模型」按钮，调用 `discoverModels`）或手动增删模型 ID。
   - 点 **「设为默认」** → 写入 `agent-default-model`（`provider` / `model` / `reasoningEffort`），
     新建智能体会话即用该模型。
   - **自定义 provider**：填名称 + 选协议（OpenAI 兼容 / pi-ai）+ Base URL → 创建后出现在列表，
     配置方式同上（写 `llm-pi-ai` 命名空间）。
   - **交叉验证**：在 canvas-studio 里改的 provider 配置，打开桌面原生「设置 → 模型」能看到同一份；
     反之在桌面原生页改的，回到 canvas-studio 也同步。
   - **自部署大模型**走 OpenAI 兼容协议填自己的 base URL + Key + 模型清单，应可正常连上并设为默认。

### 1.7 设置页扩展（输出 / 工作流 / 存储）— 2026-08-28 落地

按 §2.1 高价值低成本候选，新增三个分区标签页（共六个：通用 / 主题 / 模型 / 输出 / 工作流 / 存储）。
三者均绑定 `canvas-studio` 私有命名空间（与通用分区同一 namespace，分字段回写），Host `source()`
实时读到、`setRuntimeConfig` 透传进 `generate.ts` 的 `StudioRuntimeConfig`。

> ⚠️ **消费状态**：三组字段里**仅「默认画幅比例」今天有真实消费方**——`generate.ts` 在
> `params.aspectRatio` 缺省时按 `current.defaultAspectRatio()` 兜底（`sizeForAspectRatio`）。
> 其余字段已落 schema 并**持久化**，但当前 canvas-studio 管线（P2-P4）尚未消费——属**前向配置**，
> 不伪造"已生效"。下表逐字段标注 live / reserved。

**消费状态表**

| 字段 | 分区 | 类型 / 默认 | 状态 | 消费方 |
|---|---|---|---|---|
| `defaultAspectRatio` | 输出 | `16:9`/`9:16`/`1:1`，默认 `16:9` | ✅ live | `generate.ts` 生成画幅兜底 |
| `exportFormat` | 输出 | `mp4` | ⏳ reserved | P3 导出管线 |
| `exportDir` | 输出 | `''`（默认目录） | ⏳ reserved | P3 导出管线 |
| `videoQuality` | 输出 | `standard`/`high` | ⏳ reserved | P3 导出管线 |
| `workflowMode` | 工作流 | `confirm`/`auto` | ⏳ reserved | P2-P4 agent 编排 |
| `hitlStoryboard` | 工作流 | `true` | ⏳ reserved（已有 `submit_storyboard_for_approval` 门禁，待接此开关） | P2 分镜 HITL |
| `hitlKeyframe` | 工作流 | `false` | ⏳ reserved | P2 关键帧 HITL |
| `autoRetry` | 工作流 | `true` | ⏳ reserved | 生成重试逻辑 |
| `maxParallel` | 工作流 | `2`（1–8） | ⏳ reserved | 并行编排 |
| `assetDir` | 存储 | `''`（默认 `$DSH_HOME/canvas-studio`） | ✅ **live** | 已接通 `ProjectRegistry` + 桌面原生目录选择器（设置页「浏览…」按钮，调用 dsh 官方 `ctx.workspaces.pickDirectory()`） |
| `autoSave` | 存储 | `true` | ⏳ reserved（客户端画布自动保存，待接入） | 画布自动保存 |
| `autoSaveInterval` | 存储 | `30`（5–600 秒） | ⏳ reserved | 画布自动保存 |

**涉及文件**

| 文件 | 改动 |
|---|---|
| `src/host-config.ts` | `CanvasStudioConfig` interface + `z` schema 扩 12 字段（枚举用 `z.union`，schemastery 无 `.enum`） |
| `src/host-tools.ts` | `StudioRuntimeConfig` 增 9 个惰性闭包字段（画幅/工作流/存储） |
| `src/index.ts` | `base` 字面量补 12 字段；`cfg` 透传 9 个新闭包 |
| `src/generate.ts` | `sizeForAspectRatio(params.aspectRatio ?? current?.defaultAspectRatio?.())` 兜底 |
| `src/client/SettingsModal.tsx` | 新增 `OutputSection` / `WorkflowSection` / `StorageSection`（复用 `useScope` + `csField*` 样式）；`SettingsTab` 扩 `output`/`workflow`/`storage`；TabButton 增三选项 |
| `src/client/styles.ts` | 补 `.csFieldSelect` / `.csToggle` / `.csReserved` 样式（沿用 `--dsw-alias-*` 令牌） |

**自检结果**

- 客户端 `tsc --noEmit -p tsconfig.client.json` → **0 错误**
- Host `tsc -p tsconfig.json --noEmit` → **0 错误**（含 `base` 字面量类型对齐）
- `corepack yarn build` → **成功**（`lib/client.js` 264.84 kB / gzip 57.22 kB）
- 渲染未在本沙箱验证（Electron GUI 不可跑），需本地验收。

**本地验收补充步骤**（在 §1.6 基础上）

6. 设置弹窗出现 **输出 / 工作流 / 存储** 三个新标签页：
   - **输出 → 默认画幅比例**：改 `9:16` → 触发一次生成（文生图/视频）且 agent 未指定 aspectRatio 时，产物应为竖屏（1280×720→720×1280）；改回 `16:9` 恢复横屏。
   - **工作流 / 存储**：开关与数值可编辑并保存，刷新重新打开后保留（验证持久化）；带「待接入」标记的字段当前不影响行为，属预期。
   - 交叉验证：在 `canvas-studio` 命名空间改的值，Host `source()` 实时反映（P2-P4 接入后自动生效）。
7. **「存储」→ 资产库位置**：点「浏览…」→ dsh `ctx.workspaces.pickDirectory()` 弹系统文件夹选择器（macOS→osascript / Linux→Zenity·KDialog / Windows→IFileOpenDialog）→ 选目录直接回填输入框；新建项目会落在新 root；旧项目保留在原位。用户取消静默；OS chooser 选出的路径 dsh Host 已校验可写，无需额外 validate。
8. **「主题」即时切换**：点 浅色 / 深色 / 跟随系统 → 弹窗「当前：xxx」文字立即更新 + 整个桌面主题色立即跟随（rAF 兜底处理 dsh layout 异步刷新 `body[data-ds-dark-theme]` 的 race）。
9. **设置按钮位置**：左侧项目栏底部出现 ⚙ 图标按钮（不再是中部"设置"文字按钮）；点击照常打开设置弹窗。

### 1.8 本轮修复记录（2026-08-28）

| 类别 | 改动 |
|---|---|
| **[Bug#1] 主题即时切换** | `SettingsModal.tsx ThemeSection`：`useState + 手动 setSnap(getTheme())` → `useSyncExternalStore(getSnapshot=theme.getTheme)` + onClick 后 rAF 兜底再读一次。dsh `ThemeRuntime` 不暴露 subscribe，但 setTheme 内部**同步**重建 snapshot；rAF 兜底兼容 dsh layout 异步刷新 `body[data-ds-dark-theme]` 的 race。 |
| **[Bug#2] 设置按钮改图标** | `ProjectList.tsx`：删除原"设置"文字按钮；在 `csProjectList` 容器底部加 `.csProjectListFooter` 槽位 + ⚙ 图标按钮（aria-label / title / focus ring）。`styles.ts`：加 `.csProjectListFooter`（`margin-top: auto` 推到底部，flex 槽位）与 `.csProjectSettingsIcon`（hover 高亮、focus ring）。`csProjectList` 加 `flex: 1 1 auto; min-height: 0` 让 footer 在 sidebar 剩余空间里能正确贴底。 |
| **[主任务] 资产库位置接通** | `host-config.ts`：assetDir 字段补 live 注释。`projects.ts`：`ProjectRegistry` 构造参数由 `string` 扩展为 `string | (() => string)`，新增 `rootProvider` 字段 + `root`/`projectsDir`/`file` 动态 getter；`cached` 改为 `{root, projects}` 元组形式以支持 root 切换后自动失效。`src/index.ts`：cfg 不变，新增 `assetsRoot: () => source().assetDir || dshHomePath('canvas-studio')` 闭包传入 `new ProjectRegistry(assetsRoot)`（构造移到 `installSettingsSection` 之后，确保 source 已挂上）。**新建 src/client/host/directory-picker.ts**：原生 fetch 包装 `pickDesktopDirectory` + `validateDesktopDirectory`（走 dsh 桌面 `/_dsh/desktop/pick-directory` + `validate-directory` 端点，加 fetchImpl 注入便于测试）。`contracts.ts` / `client/index.ts` / `StudioFrame.tsx` / `SettingsModal.tsx`：依次透传 `getDirectoryPicker` 惰性 thunk；`StorageSection` 资产库位置行加「浏览…」按钮 + 错误提示 + 「仅对新建项目生效」hint，「待接入」标改「已接入」。**不引入新依赖**（不绑 dsh `directory-picker.ts` 包内私有模块）。 |
| **[修#3] 路径选择器在 macOS 报错** | **根因**：之前假设 dsh 暴露 `/_dsh/desktop/pick-directory` HTTP 端点，实为 `dsh-plugin-desktop` 桌面私有 bundle 的 **Windows-only** 内部捷径（`dsh-plugin-desktop/src/index.ts:293` 仅在 `runtime.platform === 'win32'` 注册），macOS 必然 404。**修复**：改用 dsh **官方** client API `ctx.workspaces.pickDirectory()`（全平台支持，RPC → `host.pickDirectory({})`，macOS 走 `osascript`），返回的路径 Host 已校验可写，省掉二次 validate。**改动**：`client/index.ts` 的 `getDirectoryPicker` 改为 `() => ({ pick: () => ctx.workspaces.pickDirectory() })`，去掉 `pickDesktopDirectory/validateDesktopDirectory` import；`contracts.ts` 与 `SettingsModal.tsx` 的 `getDirectoryPicker` 类型去 `validate` 字段；`StorageSection.onPickDirectory` 删 `picker.validate(...)` 调用与相关错误分支；**删除** `src/client/host/directory-picker.ts` 与空的 `host/` 目录。`pickError` 仍保留兜底：用户取消静默、`workspaces` 服务未就绪 →「当前桌面环境未提供目录选择器，请手动输入路径」。 |

**自测结果**：客户端 tsc 0 错；Host tsc 0 错；`tsdown + tsc -p tsconfig.json + tsc -p tsconfig.client.json --emitDeclarationOnly` 全绿（`lib/client.js` 271.02 kB / gzip 59.02 kB；`lib/projects.js` + `lib/index.js` 包含新 `rootProvider` + `assetsRoot` 闭包）。

**本地验收（沙箱外）**：在 §1.7 步骤 1-6 基础上追加 7-9（见上）。

---

## 2. 设置页下一步扩展计划（Roadmap）

> 本轮（用户指定）只做 **主题 + 模型 + 既有通用**。以下为候选扩展，按价值/可行性排序，
> 后续迭代择需纳入。每一项都标注 **可行性** 与 **依赖**。

### 2.1 高价值、低成本（建议优先）— 已落地 ✅（2026-08-28，见 §1.7）

> 输出与导出 / 工作流偏好 / 存储与缓存 三个分区已实现并自测全绿。其中仅「默认画幅比例」已
> 接入生成兜底，其余字段为前向配置（待 P2-P4 管线消费），详见 §1.7 消费状态表。

| 候选分区 | 具体内容 | 状态 | 实现要点 / 依赖 |
|---|---|---|---|
| **输出与导出** | 默认画幅比例（已 live）、导出格式/目录/质量（reserved） | ✅ 已落地 | 扩 `CanvasStudioConfig` schema + Host `source()`；画幅接入 `generate.ts` 兜底 |
| **工作流偏好** | 执行模式（confirm/auto）、HITL 门禁、自动重试、并行数（reserved） | ✅ 已落地 | 写入 canvas-studio 命名空间，Host 透传；待 agent 编排消费 |
| **存储与缓存** | 资产库位置（**live**）、自动保存开关/间隔（reserved） | ✅ 已落地 | `ProjectRegistry` root 改为 `() => string` provider 读取 `assetDir`（留空走 `dshHomePath('canvas-studio')`）；设置页加「浏览…」按钮，调用 dsh 官方 `ctx.workspaces.pickDirectory()`（macOS→osascript / Linux→Zenity·KDialog / Windows→IFileOpenDialog，返回路径 Host 已校验可写）；**仅对新建项目生效，旧项目保留在原位不迁移** |

### 2.2 中成本（需引入新体系）

| 候选分区 | 具体内容 | 可行性 | 实现要点 / 依赖 |
|---|---|---|---|
| **语言 / 地区** | UI 简中 / English | ⚠️ 需 i18n | 引入字符串表与 locale 切换；canvas-studio 当前无 i18n 体系 |
| **网络 / 代理** | HTTP 代理（访问海外模型 Veo/Sora 用） | ⚠️ 范围可控 | 给 Host 侧 `fetch` 加代理；需确认桌面是否已有代理服务可复用 |

### 2.3 待验证依赖（需先确认桌面能力）

| 候选分区 | 具体内容 | 可行性 | 实现要点 / 依赖 |
|---|---|---|---|
| **通知** | 生成完成 / 失败桌面通知 | ⚠️ 待查 | 依赖桌面 notification 服务是否对插件开放 |
| **关于** | 版本号、重置所有设置为默认、清空本地资产 | ✅ 低风险 | 调用 settings 重置 + 资产目录清理 |

### 2.4 探索性（架构层面）

- **画布专属模型隔离（B2）**：canvas-studio 自己持有 LLM 客户端 + 驱动自有 agent，使模型配置
  不污染桌面全局默认。工作量最大，仅在"全局模型"的已知差异（§1.2）不可接受时考虑。
- **各生成阶段选模型（A）**：文生图 / 图生图 / 视频 / 风格迁移各自选模型（CogView-4 / Vidu2 /
  Sora-2 / Veo）。需 **Drama Backend 支持按请求传 `model` 参数**——当前 `generate.ts` 未传，
  需先与后端确认支持度，再在 schema + `callDrama` 加 passthrough。
- **设置项搜索 / 分组折叠**：分区增多后，顶部加搜索框与分组折叠，避免弹窗过长。

### 2.5 技术债与注意事项

- 沙箱无法跑 Electron GUI，**任何渲染期问题只能靠代码审计 + 类型/构建自测定位**，最终需用户本地验证。
- `yarn build` 的 `scripts/clean.mjs`（删 `lib/`）会触发沙箱 bulk-delete 守卫；CI/本地构建
  如遇，用 `tsdown && tsc -p tsconfig.json && tsc -p tsconfig.client.json --emitDeclarationOnly` 绕过。
- Cordis 隔离 inject：未在 `inject` 数组声明的服务在 `ctx` 上不可访问——新增设置依赖的桌面服务
  （如通知、代理）必须同步加入 client `inject`。

## 3. MiniMax-H3 上游 skill 接入（试点）— 2026-08-28

### 3.1 背景与决策

- 用户诉求：把 MiniMax-H3 仓库 `skills/`（9 个 skill：h3-prompt-writing + 8 风格生成 skill）接入 canvas-studio，**内容与上游原版完全相同、零改编**。
- 用户拍板：git submodule 挂载原版；先做 `3d-animation-short-generator` 试点；缺失能力（BGM 生成 / TTS / 硬字幕）用 **Host 侧占位工具壳**处理（返回可操作降级指引而非报错）；用官方 **SKILL.cn.md** 中文原版。
- 现状基线：creation-spec 已内化 h3-prompt-writing 规范 + 8 类风格预设（每类仅一行提炼），缺风格 skill 的完整流程深度。

### 3.2 实施（与设计文档的两处调整）

设计文档：`.workbuddy/artifacts/minimax-h3-skills-access-plan.md`。实施中两处调整：

1. **加载方式：薄 provider → 构建时生成 + runtime register**
   - 原因：bundle 打包后运行时无法可靠定位 submodule 绝对路径；生成式注册符合 canvas「改代码→重建→重启」惯例，submodule 仍作更新源与对照源。
   - `scripts/sync-minimax-skills.mjs`：读 `minimax-h3/skills/<name>/SKILL.cn.md`（回退 SKILL.md）→ 生成 `src/skills/generated/minimax-skills.ts`（content 逐字原样，JSON 转义）；`ENABLED` 集合控制试点范围，已挂入 build 链（submodule 缺失时跳过不失败）。
   - `src/skills/minimax-skills.ts`：`registerMinimaxSkills(ctx)` 批量 `ctx.skills.register({name, description, source:'runtime', content})`。
2. **占位工具按盘点收敛为 3 个**：grep 原版正文确认 BGM 是唯一明确「生成」能力（STEP 8，12+ 处）；旁白为文本轨设计、字幕默认禁止 → `music_generation` / `tts_voiceover` / `subtitle_burn` 三个占位工具（`src/skills/placeholder-tools.ts`），各自返回中文能力边界 + 替代路径。

### 3.3 涉及文件

| 文件 | 说明 |
|---|---|
| `minimax-h3/`（submodule，pinned d21241f0） | MiniMax-H3 原版，只读 |
| `scripts/sync-minimax-skills.mjs` | 生成器（零改编读取 SKILL.cn.md） |
| `src/skills/generated/minimax-skills.ts` | 自动生成（不手改），含 3d-animation 逐字 content |
| `src/skills/minimax-skills.ts` | 注册函数 + MINIMAX_SKILL_NAMES |
| `src/skills/placeholder-tools.ts` | 3 个占位工具 |
| `src/index.ts` | 接入注册 + 占位工具 effect |
| `src/skills/creation-spec.ts` | 3D 动画风格行加路由提示（`3d-animation-short-generator` + 占位工具） |
| `tests/minimax-skill.test.mjs` | 冒烟测试（含零改编逐字验证） |
| `docs/minimax-skills-acceptance.md` | 桌面验收步骤 |

### 3.4 自检结果

- HOST_OK + CLIENT_OK（tsc --noEmit）。
- `corepack yarn build` 成功；lib 产物含 minimax-skills.js / generated/minimax-skills.js / placeholder-tools.js。
- `test:smoke` 92/92 通过，含：注册输入合法（kebab-case / description ≤500 / content 非空）+ **零改编验证（content 与 submodule SKILL.cn.md 正文逐字一致）** + 标志性段落（STEP 0 / 项目简报 / 六列标准镜头信息表 / ## 边界）。

### 3.5 桌面验收

见 `docs/minimax-skills-acceptance.md`。关键观察点：skill 是否按需加载、STEP 0–9 是否走通、BGM 环节 music_generation 是否返回降级指引且不卡流程、产物是否按序落画布。

### 3.6 已知边界与后续

- 试点仅注册 1 个 skill；铺开其余 8 个 = 改 sync 脚本 `ENABLED` + 重建（内容零改编）。
- 原版 skill 的「选项卡门」与 canvas 的 ask_user_choice / submit_storyboard_for_approval 并存，试点观察是否有行为冲突。
- 原版「视频模型选项卡」（H3/Seedance 2.0）canvas 无对应模型选择，agent 需降级说明固定走 Drama Backend（观察是否需要总纲提示）。
- references/*.txt（shot-table-spec 等 5 个文件）正文零引用，暂不打包；若后续需要按需扩展。

