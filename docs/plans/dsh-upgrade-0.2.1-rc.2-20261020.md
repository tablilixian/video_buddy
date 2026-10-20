# DSH 上游升级方案：0.1.1-rc.2 → 0.2.1-rc.2

> 文档状态：**草案 v1，待审核**
> 编制日期：2026-10-20
> 适用仓库：`video_buddy`（DSH Desktop 2.0.4）
> 影响范围：根 workspace、`dsh-plugin-desktop`、`canvas-studio`、`dsh-community-market`、`dsh-web-search-*`、上游子模块 pin
> 不包含：`deepseek-harness/` 内部源码改动

---

## 0. 审核摘要（TL;DR）

| 项目 | 结论 |
| --- | --- |
| 推荐升级版本 | **`0.2.1-rc.2`** |
| 推荐上游 pin | `687f282e8625c6b8d11ff58211a90524be2e4317`（`dsh-v0.2.1-rc.2`） |
| 升级方式 | **一次性跨版本升级**，不逐版本（0.1.5 → 0.1.7 → 0.2.0 → 0.2.1）推进 |
| 参考实现 | `anywhere-labs/dsh-desktop`（本项目最初来源），master 已在该版本 |
| 预计工作量 | **P50 约 15 人日，P90 约 25 人日**（单人 3–5 周） |
| 最大风险 | 客户端 Settings 体系重写、`settings.yaml` 数据迁移、Canvas/Market 必须与 desktop lockstep 迁移（§4.8）、17 个产品 patch 重做 |
| 决策状态 | 已于 2026-10-20 拍板 D1–D7，见 §10；核心约束：保留全部本地功能、画布优先、本轮不涉及发布 |

**一句话结论**：从 `0.1.2-rc.1` 起上游就删除了 `dsh-client-runtime` 和 `dsh-host-apiproxy`，任何高于当前版本的升级都绕不开客户端 API 迁移；而 `0.2.1-rc.2` 是 npm `latest`，并且原项目已经把这次迁移和 17 个 patch 跑通，直接对齐它比停在中间版本更省成本。注意 `verify-layout` 不覆盖 `canvas-studio`（§4.8），Canvas 与 Market 必须和 desktop 在同一分支内完成迁移，否则 gate 会「假绿」。

---

## 1. 背景与目标

### 1.1 当前基线

| 项目 | 当前值 | 证据 |
| --- | --- | --- |
| 产品版本 | `2.0.4` | `package.json:3` |
| 上游子模块 | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` | `git submodule status` |
| 上游 tag | `dsh-v0.1.1-rc.2` | 子模块 `git describe` |
| `upstream.json` | `sourceVersion` / `runtimePackageVersion` = `0.1.1-rc.2` | `upstream.json:3-6` |
| 上游包管理 | `pnpm@11.7.0` | `deepseek-harness/package.json` |
| Node 要求 | `^22.19.0 \|\| >=24.0.0` | 根 `package.json:9` |
| DSH 依赖条目 | 216 条（203 条为 `0.1.1-rc.2`，10 条为 `0.1.0-rc.7`；其中 8 个包在 0.2.1 已删除，见 §4.8） | 各 workspace `package.json` |
| 本地 patch | 17 个文件（15 个作用于 DSH 包，2 个作用于第三方包） | `patches/` |
| 客户端代码引用 | `dsh-client-runtime/client` 共 28 处，其中 19 个 `src` 文件 | `grep` 结果见附录 D |

### 1.2 升级目标

1. 将上游运行时升级到可发布的 RC，缩短与官方修复/能力的差距。
2. 保持 VideoBuddy 现有产品能力：兼容/扩展/高级三种外壳模式、Canvas Studio、社区市场、Web 搜索、桌面设置、通知、终端、自动更新、macOS/Windows 打包。
3. 保持仓库既有架构约束：上游子模块只读、DSH 包只从 npm 发布边界进入、`upstream.json` 与子模块 pin 一致。
4. 升级过程可回滚、可验证、可审计。
5. **功能对等**：升级后所有现有本地功能必须保留，尤其是 `canvas-studio`（核心能力）必须正常可用（见 §10.1）。

### 1.3 非目标

- 不在本轮重写 Canvas Studio 或社区市场的**产品功能**；但必须在本轮完成它们对 DSH 包的依赖与设置 API 迁移（同分支 lockstep），否则会在 0.2.1 运行时下损坏（§4.8）。
- 不在本轮切换到上游新出现的 `apps/desktop` / `apps/desktop-host`（未发布到 npm，且属于产品方向变更）。
- 不追逐原项目在 0.2.1 上新增的全部 77 个依赖（其中 74 个 DSH）；只迁移“现有功能必需”的部分。
- 不在本轮移除兼容模式或变更用户数据目录语义。

---

## 2. 版本评估

### 2.1 候选版本对比

包数量统计口径：上游 `packages/*/*/package.json`。

| 版本 | 包数量 | npm 标签 | 关键变化 | 对本案的影响 | 结论 |
| --- | ---: | --- | --- | --- | --- |
| `0.1.1-rc.2` | 227 | 旧版 | 当前基线 | — | 保持现状，不升级 |
| `0.1.2-rc.1` | 249 | — | 删除 `dsh-client-runtime`、`dsh-host-apiproxy` | 客户端/宿主迁移已不可避免 | 否 |
| `0.1.5-rc.3` | 267 | — | 仍保留 `agent-presets`、`settings-file`、`code-runtime` | 少 3 个包的迁移，但仍要重做客户端 API | 否 |
| `0.1.7-rc.2` | 312 | — | 再删 `agent-presets`、`settings-file`、`code-runtime`；Settings 改为 profile 配置 | 迁移面接近最终版 | 否 |
| `0.2.0-rc.2` | 316 | — | 与 0.1.7 基本同构；仍保留 `invariants` 与 `subagent-in-process-driver` | 迁移面与 0.1.7 接近 | 否 |
| `0.2.1-alpha.5` | 340 | `alpha` | 预发布 | 稳定性不足 | 否 |
| **`0.2.1-rc.2`** | **342** | **`latest` / `next`** | 最新 RC；原项目 stable/beta 双通道均在此版本 | 迁移面最大，但可直接复用原项目成果 | **推荐** |

### 2.2 推荐理由

1. **客户端迁移无法通过“少升几个版本”规避。** `dsh-client-runtime` 在 `0.1.2-rc.1` 就已移除，`dsh-host-apiproxy` 同时移除。只要离开 `0.1.1-rc.2`，19 个客户端源文件就必须迁移。
2. **中间版本会重复付迁移成本。** `0.1.7-rc.2` 又删除 `settings-file`、`agent-presets`、`code-runtime`，`0.2.1` 再删除 `invariants` 与 `subagent-in-process-driver`；分步升级等于把同一批 API 迁移做 2–3 次。
3. **原项目已把 0.2.1-rc.2 跑通。** `anywhere-labs/dsh-desktop` master 的 `upstream.json` 中 stable 与 beta 都是 `0.2.1-rc.2`，并保留了 21 个对应版本的 patch。可以直接对照其实现和迁移注释，显著降低试错成本。
4. **`0.2.1-rc.2` 是 registry 最新发布。** npm `dist-tags`：`latest = 0.2.1-rc.2`、`next = 0.2.1-rc.2`；继续停留在 0.1.1 会持续错过上游修复。
5. **`0.2.1-alpha.5` 不作为目标。** alpha 通道不稳定，且 rc.2 已包含 alpha 阶段的能力与迁移指南。

### 2.3 不推荐的路径

| 路径 | 不推荐原因 |
| --- | --- |
| 停在 0.1.1-rc.2 | 与上游差距约 9,248 个提交，后续升级成本只会继续增加 |
| 先升 0.1.5-rc.3 再观察 | 仍需客户端迁移，且 `0.1.5` 不是发布候选 |
| 先升 0.1.7-rc.2 / 0.2.0-rc.2 | 迁移面与 0.2.1 基本一致，之后还要再升一次 |
| 跟随 0.2.1-alpha.5 | 预发布，回归风险高 |
| 切换到上游 `apps/desktop` | 未发布到 npm，且与“桌面本身是插件”的产品架构冲突 |

---

## 3. 参考项目基线

### 3.1 事实

| 项目 | 值 |
| --- | --- |
| 仓库 | `https://github.com/anywhere-labs/dsh-desktop` |
| 默认分支 | `master` |
| 当前 commit | `687f282e8625c6b8d11ff58211a90524be2e4317` |
| 上游版本 | `0.2.1-rc.2` |
| `upstream.json` | `activeChannel: beta`，stable/beta 均指向同一 commit |
| 桌面插件版本 | `2.0.18` |
| 0.2.1-rc.2 patch | 21 个 |
| 运行时分发 | `vendor/dsh-runtime/0.2.1-rc.2/*.tgz` + `file:` 解析 |

### 3.2 可以借鉴的内容

1. **patch 的 0.2.1-rc.2 版本**：21 个 patch 文件可直接作为移植基线。
2. **迁移注释与实现**：其 `dsh-plugin-desktop/src/profile.ts` 明确记录了 0.1.7-alpha.1 的删除点：
   - `@deepseek-ai/dsh-settings-file` 被删除，Settings 改为 profile 自身的 `@deepseek-ai/dsh-settings`；
   - `@deepseek-ai/dsh-agent-presets` 拆分为 `dsh-agent-preset`（模型，含 `skills/`）与 `dsh-agent-preset-registry`（Loader 服务）；
   - preset 声明迁入 `@deepseek-ai/dsh-web-app/presets/*.patch.yml`；
   - 旧 `settings.yaml` 由 Settings 一次性导入，并重命名为 `settings.yaml.imported`。
3. **用户数据迁移表**：其代码给出了 Desktop 两个旧 section（`dsh-desktop`、`dsh-desktop-notifications`）以及 `agent-presets → agent-preset-registry`、`default → selectedDefault` 的迁移方案。
4. **验证思路**：loader/profile/closure/打包冒烟的组织方式。

### 3.3 不能直接照搬的内容

| 原项目做法 | 本项目约束 | 结论 |
| --- | --- | --- |
| `@deepseek-ai/*` 依赖使用 `file:vendor/...tgz` | `scripts/verify-layout.mjs:88` 明确禁止 `workspace:` / `file:` / `link:` / `portal:` 绕过已发布 DSH 包边界 | **必须继续走 npm registry** |
| `upstream.json` 使用 `channels` 结构 | `scripts/verify-layout.mjs:96-113` 读取扁平 `commit/sourceVersion/runtimePackageVersion` | 保持现有扁平结构，不改 gate |
| 自带 beta/next 桌面变体 | 本项目当前只有单一桌面包 | 本轮不引入 |
| 77 个新增依赖（74 个 DSH） | 本项目只保留现有产品能力 | 按需引入，见 §4.2 |

---

## 4. 差异与影响分析

### 4.1 包拓扑变化

- 上游包目录：**227 → 342**。
- 我们直接依赖的 216 个 DSH 条目中，**8 个包在 0.2.1 已不存在**：
  `dsh-client-runtime`、`dsh-host-apiproxy`、`dsh-code-runtime`、`dsh-code-runtime-worker-thread`、`dsh-agent-presets`、`dsh-settings-file`、`dsh-invariants`、`dsh-subagent-in-process-driver`（核查记录见 §4.8）。
- `canvas-studio` 共 28 条 DSH 依赖条目（10 个唯一包名）仍 pin `0.1.0-rc.7`，需要一并统一到 `0.2.1-rc.2`（或删除）。

### 4.2 被移除包与替代方案

| 被移除包 | 0.2.1 替代 | 本项目当前用法 | 迁移动作 |
| --- | --- | --- | --- |
| `dsh-client-runtime` | `@deepseek-ai/cordis` 的 `Context` + `dsh-client-store` + 各服务包的 module augmentation | 19 个 `src` 文件、28 处引用；`ClientContext`、`SettingsScope`、`defineStore`、`ISessions`、`EngineStoreHandle` | 逐个改写 import 与服务声明；`defineStore` 改从 `dsh-client-store` 引入 |
| `dsh-host-apiproxy` | `dsh-api-*-controller`（session/settings/workspace/account/terminal 等）+ `dsh-api-remote-access` | 仅测试断言和 1 个 patch 直接引用；运行时由上游 bundle 装配 | 删除测试中的旧包名；`inputModalities` patch 评估是否迁移到新 controller |
| `dsh-code-runtime` | `dsh-ptc-runtime` | `canvas-studio` 仅依赖 manifest，无 `src` 直接 import | 删除旧依赖；确认 Canvas 不需要 PTC 运行时后不引入新包 |
| `dsh-code-runtime-worker-thread` | 随之删除（PTC 运行时自带执行方式） | `canvas-studio` 仅依赖 manifest，无 `src` 直接 import | 从 `canvas-studio` manifest 删除 |
| `dsh-agent-presets` | `dsh-agent-preset` + `dsh-agent-preset-registry` | `profile.ts` 的 `AGENT_PRESETS_ROW_ID = 'agent-presets'`、`roots` 配置、2 处测试 | row id 改为 `agent-preset-registry`；删除 `roots`/`includeUserRoot`；preset 声明改由 `dsh-web-app/presets/*.patch.yml` 提供；skills 从 `dsh-agent-preset` 解析 |
| `dsh-settings-file` | `dsh-settings` + `dsh-config-editor` + profile patch 持久化 | `profile.ts` 的 `FileSettingsProvider.Config`、`resolveSpec`、`SETTINGS_FILE_PACKAGE`；3 处测试 | 重写启动前设置读取逻辑；保留一次性 `settings.yaml` 导入；row 名改为 `settings` |
| `dsh-invariants` | 无；`/invariant` 子路径全部删除 | 4 个 manifest 依赖，无 `src` 业务引用 | 从 manifest 删除；清理任何 `*/invariant` 行 |
| `dsh-subagent-in-process-driver` | `dsh-subagent-fork-in-process` / `dsh-subagent-spawn-in-process`；子代理改由 `dsh-subagent` 服务统一执行 | 仅 1 个 manifest 依赖，无 `src` 直接引用 | 从 manifest 删除；确认 profile 中没有旧 driver 行 |

### 4.3 宿主侧破坏性变化

| 变化 | 影响文件 | 处理方式 |
| --- | --- | --- |
| 客户端 `ctx.settingsScope` 与宿主 `ctx.settings.register` 均被移除，改为 `SettingsForms.describe/update/replace/mutate`；namespace 由 Loader entry id + 插件 Config 决定 | `dsh-community-market/src/host/routes.ts`、`catalog/source-store.ts`、`dsh-plugin-desktop/src/profile.ts`、客户端设置页 | 把市场设置声明为插件 Config 的 volatile 字段；用 `ctx.settings.update/mutate` 读写；补 revision 冲突处理；客户端改用 `remote.settings` / `configForms` |
| Settings 持久化从 `settings.yaml` 迁移到 profile patch，并一次性导入旧文件 | `dsh-plugin-desktop/src/profile.ts` | 保留启动前读取；增加 `dsh-desktop`/`dsh-desktop-notifications` section 重命名；处理 `settings.yaml.imported` |
| `agent-presets` row 改名 `agent-preset-registry`；`roots`/`includeUserRoot` 删除 | `dsh-plugin-desktop/src/profile.ts:88,891-897` | 改 row id；删除 roots 注入；preset 声明改由上游 bundle 提供 |
| `webRuntime` 服务删除，改为 `webStartup`；`web-runtime` 行不再接受 `trustedHosts`；通配监听地址被拒绝 | `dsh-plugin-desktop/src/index.ts:85`、`main.ts:932-936`、`profile.ts:862-871`、`cordis.patch.yml:46-51` | 改为注入 `webStartup`；`lanAddresses` 改用新服务；`trustedHosts` 移到 `web-startup`/`connection` 表达式；网络暴露逻辑重新验证 |
| `dsh-invariants` 与 `/invariant` 行删除 | 各 manifest、profile patch | 删除依赖与行；失败上报改走各自通道 |
| 子代理驱动与 `tool-subagent` 配置变化（`persona`、`toolFilter`、`backgroundMode` 等） | 目前无直接配置，仅需验证 | 检查自定义 preset/配置中是否残留 |
| 凭证优先级：已保存凭证优先于环境变量 | 设置页/凭证页面 | 验证桌面设置 UI 的提示与行为；更新文档 |
| 工作目录 `{{cwd}}` 与 `cwd` 配置移除 | 如后续引入自定义 prompt/preset | 本轮现有代码未使用；列入回归检查 |

### 4.4 客户端侧破坏性变化

| 旧 API | 新位置 | 受影响文件 |
| --- | --- | --- |
| `import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'` | `import type { Context as ClientContext } from '@deepseek-ai/cordis'` | 19 个 `src` 文件（Desktop 8、Canvas 9、Market 2） |
| `SettingsScope<T>` + `ctx.settingsScope.bind({ namespace })` | `ctx.remote.settings` + `ctx.configForms`，或插件自有 Config 表单 | Desktop 设置 2 个文件、Canvas 设置 5 个文件、Market 设置页 |
| `defineStore` / `EngineStoreHandle` | `@deepseek-ai/dsh-client-store` | `canvas-studio/src/client/project-store.ts`、`dsh-community-market/src/client/market-view-store.ts` |
| `ISessions` | 由 `dsh-client-ui-session` 等服务包提供 | `canvas-studio/src/client/index.ts` |
| `dsh.client.inject` 中的旧包名 | 对应新服务包 | `dsh-plugin-desktop/package.json`、`canvas-studio/package.json`、`dsh-community-market/package.json` |

客户端迁移的关键不是机械替换 import，而是**设置读写模型**：0.2.1 的设置以 Loader entry id 为 namespace，通过 Remote 与 Config Forms 读写，旧的任意 namespace 注册和 `scope.get()/set()` 不再存在。

### 4.5 patch 影响清单

共 17 个 patch 文件，其中 15 个作用于 DSH 包、2 个作用于第三方包。

| patch | 作用 | 0.2.1 目标包状态 | 处理方式 |
| --- | --- | --- | --- |
| `dsh-app-boot` | 空配置解析容错 | 存在 | 参考原项目 0.2.1 patch 重做 |
| `dsh-client-ui-directory-picker-browse` | 自定义目录选择器 UI + 原生选择按钮 | 存在 | 重做，工作量较大 |
| `dsh-host-directory-picker-browse` | Windows reparse 目录容错 | 存在 | 参考原项目 0.2.1 patch 重做 |
| `dsh-sandbox-windows-acl` | `windowsHide` | 存在 | 重做 |
| `dsh-subprocess-local` | `windowsHide` | 存在 | 重做 |
| `dsh-web-app` | `openBrowser: false`、`ELECTRON_RUN_AS_NODE` 清理、`windowsHide` | 存在 | 重做；同时适配 `web-startup` 变化 |
| `dsh` | `windowsHide` | 存在 | 重做 |
| `dsh-agent-loop` | 空 tool name 守卫 | 存在 | 原项目无对应 patch，需自行重做 |
| `dsh-client-ui-settings-models` | 模型候选搜索 | 存在 | 原项目无对应 patch，需自行重做 |
| `dsh-client-ui-trajectory` | 中文工具栏文案 | 存在 | 原项目无对应 patch，需自行重做 |
| `dsh-client-ui-workspace` | 工作区拖拽标记 | 存在 | 原项目无对应 patch，需自行重做 |
| `dsh-llm-deepseek` | tool call id/name 兜底 | 存在 | 原项目无对应 patch，需自行重做 |
| `dsh-token-meter` | context breakdown 状态版本升级 | 存在 | 原项目无对应 patch，需自行重做 |
| `dsh-client-runtime` | session 选择时序修复 | **包已删除** | 确认新实现是否已修复；否则迁到新客户端 store |
| `dsh-host-apiproxy-model-modalities` | `inputModalities` 扩展 | **包已删除** | 评估是否迁移到新 `dsh-api-*` controller；否则放弃并记录功能损失 |
| `app-builder-lib` | macOS 签名 keychain、Windows 安装进程检测 | 第三方，存在 | 版本不变则保留；升级 electron-builder 时重做 |
| `open` | `windowsHide` | 第三方，存在 | 升级 `open` 时重做 |

> 关键判断：**7 个 patch 在原项目有 0.2.1 对应版本**（app-boot、两个 directory-picker、sandbox、subprocess、web-app、dsh），可直接对照；**6 个是本项目独有产品定制**，必须逐个人工重做；**2 个目标包已删除**，需要功能取舍。

### 4.6 工具链与依赖变化

| 项目 | 当前 | 0.2.1-rc.2 | 影响 |
| --- | --- | --- | --- |
| 上游 pnpm | `11.7.0` | `11.28.5` | CI 首次安装需拉取新 pnpm；`upstream:*` 脚本不变 |
| Node engines | `^22.19.0 \|\| >=24.0.0` | 相同 | 无变化 |
| `@deepseek-ai/cordis` | `4.0.1` | `4.0.5` | 客户端/宿主类型与生命周期需回归 |
| `cordis-plugin-group` | `1.0.1` | `1.0.5` | 同上 |
| `cordis-plugin-include` | `1.0.6` | `1.0.10` | patch/profile 组合行为需回归 |
| `cordis-plugin-loader` | `1.0.2` | `1.0.6` | row 解析、`!!js` 表达式需回归 |
| `cordis-plugin-timer` | `1.1.3` | `1.1.7` | 低风险 |
| `schemastery` | `^3.18.1` | `^3.18.5` | 低风险 |
| Electron | `43.4.0` | 保持不变 | 上游桌面未发布，本轮不跟随 |
| 上游 `apps/desktop` | 无 | 存在但未发布 npm | 不引入 |

### 4.7 数据与用户影响

1. **`settings.yaml` 一次性导入**：0.2.1 会把旧的 harness-home `settings.yaml` 导入当前 profile 的 patch，并重命名为 `settings.yaml.imported`。Desktop 在 Loader 启动前还会读取该文件以确定窗口模式、端口、材质、浏览器访问等启动设置，因此必须保证读取发生在导入之前，且迁移后值仍然正确。
2. **Desktop section 改名**：旧 section `dsh-desktop`、`dsh-desktop-notifications` 需要映射到新的 Loader entry id（如 `desktop-shell`、`desktop-notifications`），否则导入会告警并丢弃设置。
3. **Agent preset 选择丢失风险**：旧 `agent-presets.default` 在新版改为 `agent-preset-registry.selectedDefault`。如果不做字段映射，用户选择的默认 preset 会被 bundle 的 `standard` 覆盖。
4. **市场设置**：旧的 `ctx.settings.register` namespace 数据需要迁移到插件 Config / profile patch，否则目录源、安装配置等会丢失。
5. **不可逆操作**：`settings.yaml` 被重命名后，回滚旧版本需要手动恢复；升级前应备份 `$DSH_HOME`。

### 4.8 依赖版本一致性与 gate 覆盖面（核查记录）

核查方法：对 5 个 manifest（root、`dsh-plugin-desktop`、`dsh-community-market`、`canvas-studio`、`dsh-community-fabric`）的 `@deepseek-ai/*` 依赖去重，得 **117 个包名**，逐个查询 registry 的 `0.2.1-rc.2` 是否存在。

| 结果 | 数量 | 说明 |
| --- | ---: | --- |
| `0.2.1-rc.2` 已发布 | 103 | 升级时直接 bump 到 `runtimePackageVersion` |
| 已删除 | 8 | 见下表，必须先清理引用 |
| cordis 家族（按自身版本号发布，不在 0.2.1 列车） | 6 | `cordis@4.0.5`、`plugin-loader@1.0.6`、`plugin-include@1.0.10`、`plugin-group@1.0.5`、`plugin-timer@1.1.7`、`schemastery@3.18.5`，均已发布 |

> 本次核查对 §4.1 做了一处更正：被删包是 **8 个**，`dsh-code-runtime-worker-thread` 此前被漏记。

8 个被删包在仓库内的引用分布：

| 被删包 | desktop | market | canvas | `src` 引用 |
| --- | :-: | :-: | :-: | ---: |
| `dsh-client-runtime` | ✓ | ✓ | ✓ | 19 个文件 |
| `dsh-host-apiproxy` | ✓ | ✓ | — | 0 |
| `dsh-code-runtime` | ✓ | — | ✓ | 0 |
| `dsh-code-runtime-worker-thread` | — | — | ✓ | 0 |
| `dsh-agent-presets` | ✓ | ✓ | — | 0（`profile.ts:88` 的 `AGENT_PRESETS_ROW_ID` 是 row id 常量，不是包 import） |
| `dsh-settings-file` | ✓ | ✓ | — | 1 个文件（`profile.ts`） |
| `dsh-invariants` | ✓ | ✓ | ✓ | 0 |
| `dsh-subagent-in-process-driver` | ✓ | — | — | 0 |

**gate 覆盖面缺口（必须显式登记）**：

- `scripts/verify-layout.mjs:75-80` 只遍历 root、desktop、fabric、market 四个 manifest，**不包含 `canvas-studio`**。
- `scripts/verify-layout.mjs:111-114` 只对 `dsh-plugin-desktop` 中 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 依赖强制等于 `runtimePackageVersion`；`cordis` 家族以及 market / canvas / fabric 的版本都不校验。
- 后果：只升 desktop + market 也能让 `yarn check` 变绿，但 canvas 仍在 `0.1.0-rc.7` 且引用已删除的 `dsh-client-runtime`，由于 canvas 与 desktop 共用同一 Cordis 树、同一 Loader，运行时会直接坏。因此 **canvas 与 market 的迁移是 P1/P2 的硬性入口条件，不是可选项**。

---

## 5. 实施方案

### 5.1 阶段总览

| 阶段 | 内容 | 预计人日 | 出口标准 |
| --- | --- | ---: | --- |
| P0 | 冻结基线、建分支、记录当前 gate 结果 | 0.5 | 基线可复现 |
| P1 | 子模块 pin、`upstream.json`、三个插件 workspace 依赖清单升级与 8 个被删包清理 | 1.5 | `yarn install --immutable` 可解析，且三 manifest 无被删包 |
| P2 | 宿主侧迁移（Settings、preset、webRuntime、invariants），含 market 宿主设置 API | 3 | Host typecheck 通过 |
| P3 | 客户端侧迁移（client-runtime、SettingsScope、store、slots），含 Canvas/Market 客户端 | 4 | Client typecheck 与 loader 通过 |
| P4 | patch 重做与功能取舍 | 3 | 所有保留 patch 可应用 |
| P5 | 全量 gate、数据迁移、打包冒烟 | 3 | `yarn check` 与打包冒烟通过 |
| — | **合计（P50）** | **15** | — |
| — | **含缓冲（P90）** | **25** | — |

> 估算前提：1 名熟悉本仓库的工程师；上游构建与依赖下载网络正常；不新增产品功能。
> P1/P2/P3 的退出标准都要求三个插件 workspace 同时通过；`verify-layout` 不覆盖 `canvas-studio`（§4.8），所以不能只看 `yarn check` 变绿。

### 5.2 P0：基线与冻结

1. 从当前 `dev` 拉出 `upgrade/dsh-0.2.1-rc.2`，不直接改 `dev`。
2. 记录基线：
   ```bash
   corepack yarn check
   git submodule status
   ```
3. 备份一份测试用 `$DSH_HOME`（包含 `settings.yaml`、profiles、credentials），用于后续升级数据验证。
4. 在分支上保留本文件，作为实施与验收依据。

**回滚点**：P0 不改变代码，可直接删分支。

### 5.3 P1：pin 与依赖升级

1. 更新子模块到目标 commit：
   ```bash
   git -C deepseek-harness fetch --tags
   git -C deepseek-harness checkout 687f282e8625c6b8d11ff58211a90524be2e4317
   git add deepseek-harness
   ```
2. 更新 `upstream.json`：
   - `commit` = `687f282e8625c6b8d11ff58211a90524be2e4317`
   - `sourceVersion` = `0.2.1-rc.2`
   - `runtimePackageVersion` = `0.2.1-rc.2`
   - 保持扁平结构，不引入 `channels`（否则 `verify-layout` 会失败）。
3. 更新所有 workspace 的 DSH 依赖（**三个插件 workspace 一起改，别只改 desktop**）：
   - 216 条 DSH 条目统一到 `0.2.1-rc.2`；
   - `canvas-studio` 的 13 条（10 个唯一包名）`0.1.0-rc.7` 一并升级或删除；
   - `dsh-community-market` 的 DSH 依赖同步 bump；
   - `@deepseek-ai/cordis*`、`schemastery` 按 §4.6 升级（注意 verify-layout 只对 `@deepseek-ai/dsh*` 强制版本一致，cordis 家族按自身版本号）。
4. 处理 8 个已删除包：按 §4.2 与 §4.8 的引用矩阵删除或替换，确保三个 manifest 里不再出现。
5. `patches/` 先移出 `resolutions`（保留文件），确保 install 不被旧 patch 阻塞；P4 再逐个恢复。
6. 运行：
   ```bash
   corepack yarn install
   corepack yarn upstream:install
   corepack yarn upstream:build
   ```

**出口标准**：依赖解析成功；上游构建成功；`verify-layout` 通过。
**回滚点**：恢复子模块 pin、`upstream.json`、`package.json`、`yarn.lock`。

### 5.4 P2：宿主侧迁移

按以下顺序处理，先让 Host 编译通过：

1. **Settings**
   - 删除 `FileSettingsProvider` / `resolveSpec` / `SETTINGS_FILE_PACKAGE`；
   - 设置 row 改为 `@deepseek-ai/dsh-settings`；
   - 保留启动前 `settings.yaml` 读取，但改为本地解析 + 新 row 校验；
   - 增加旧 section 到 entry id 的映射表；
   - 验证 `settings.yaml` 导入发生在启动设置读取之后。
2. **Agent preset**
   - `AGENT_PRESETS_ROW_ID` 改为 `agent-preset-registry`；
   - 删除 `roots` / `includeUserRoot` 注入；
   - `shippedPresetRoot()` 改为解析 `@deepseek-ai/dsh-agent-preset/skills`；
   - preset 声明依赖 `@deepseek-ai/dsh-web-app/presets/*.patch.yml`。
3. **webRuntime → webStartup**
   - `index.ts` 的 `inject` 改 `webRuntime` 为 `webStartup`；
   - `main.ts` 的 `lanAddresses` 改用新服务；
   - `cordis.patch.yml` 的 `trustedHosts: []` 移到 `web-startup`/`connection` 表达式；
   - 验证 `networkExposure` / `browserAccess` 的监听地址逻辑。
4. **invariants**
   - 删除依赖与 profile 中的 `/invariant` 行；
   - 确认失败上报不再依赖 rethrow。
5. **子代理与工作目录**
   - 检查自定义 preset、patch、配置中是否残留 `persona`、`toolFilter`、`backgroundMode`、`cwd`；
   - 本轮未使用则只做回归验证。

**出口标准**：`dsh-plugin-desktop` Host typecheck 通过；profile 组合无 `patch: entry ... not found`。
**回滚点**：P2 单独提交，可按文件回退。

### 5.5 P3：客户端侧迁移

1. **ClientContext**
   - 19 个 `src` 文件改为 `import type { Context as ClientContext } from '@deepseek-ai/cordis'`；
   - 删除 `dsh.client.inject` 中的旧包名，改为对应服务包。
2. **SettingsScope**
   - Desktop 设置页改用 `ctx.remote.settings` + `ctx.configForms`，或为 Desktop 自身 Config 定义 volatile 字段；
   - Canvas 设置页（`SettingsModal`、`FirstRunSettings`、`ModelSettingsPanel`）同样迁移；
   - Market 设置页与 Host 设置 API 对齐；
   - 保留现有 UI 文案与交互，不借机重构视觉。
3. **Store**
   - `defineStore` / `EngineStoreHandle` 改从 `@deepseek-ai/dsh-client-store` 引入；
   - `ISessions` 改从 `dsh-client-ui-session` 等服务包获取。
4. **Slots / 服务声明**
   - 用 module augmentation 补齐 `ctx` 服务类型；
   - 逐项验证 `ui-layout`、`ui-sidebar`、`ui-conversation` 的 slot 注册。
5. **验证**
   ```bash
   corepack yarn workspace dsh-plugin-desktop typecheck
   corepack yarn workspace canvas-studio typecheck
   corepack yarn workspace dsh-community-market typecheck
   corepack yarn workspace dsh-plugin-desktop verify:loader
   ```

**出口标准**：三个 workspace 的 typecheck 与 loader 验证通过；首屏能启动。
**回滚点**：P3 单独提交；客户端迁移可独立回退。

### 5.6 P4：patch 重做

1. 建立 patch 对照表（§4.5），逐项标记：保留 / 重做 / 放弃 / 迁移。
2. 优先使用原项目 0.2.1-rc.2 patch 作为基线：app-boot、两个 directory-picker、sandbox、subprocess、web-app、dsh。
3. 本项目独有 patch 逐个在 0.2.1 产物上重做，并补充回归测试：
   - agent-loop 空 tool name；
   - ui-settings-models 搜索；
   - ui-trajectory 中文文案；
   - ui-workspace 拖拽标记；
   - llm-deepseek tool call 兜底；
   - token-meter 状态版本。
4. 两个目标包已删除的 patch：
   - `dsh-client-runtime` 时序修复：先确认新实现是否已修复；未修复则迁到新 store；
   - `dsh-host-apiproxy` 的 `inputModalities`：评估新 controller 是否已有该能力；否则放弃并记录用户可见损失。
5. 每恢复一个 patch，更新 `resolutions` 并重新 install，避免一次性堆积。

**出口标准**：所有保留 patch 可应用；`git diff` 无冲突标记；patch 对照表全部有结论。
**回滚点**：patch 文件与 `resolutions` 一并回退。

### 5.7 P5：验证与发布准备

1. 执行 §6 的全部自动 gate。
2. 用 P0 备份的 `$DSH_HOME` 做一次真实升级演练，检查：
   - `settings.yaml` 是否正确导入并重命名；
   - 窗口模式、端口、材质、浏览器访问、通知设置是否保留；
   - 默认 agent preset 是否保留；
   - 市场目录源与安装配置是否保留。
3. 执行 macOS / Windows 打包冒烟。
4. 更新文档：`docs/` 中的上游版本、升级说明、已知差异。
5. 准备发布说明与回滚包。

**出口标准**：自动 gate 全绿；数据迁移演练通过；打包冒烟通过。
**回滚点**：保留上一版本安装包与 `$DSH_HOME` 备份。

---

## 6. 验证计划

### 6.1 自动 gate

| 命令 | 验证内容 | 通过标准 |
| --- | --- | --- |
| `corepack yarn upstream:install` | 上游依赖 | 成功 |
| `corepack yarn upstream:build` | 上游构建 | 成功 |
| `corepack yarn install --immutable` | 根 workspace 锁文件 | 成功 |
| `corepack yarn typecheck` | 三个 workspace 类型 | 无错误 |
| `corepack yarn test` | 单测 | 全绿 |
| `corepack yarn check` | 布局、双语、架构、各包 check | 全绿 |
| `corepack yarn workspace dsh-plugin-desktop verify:loader` | Loader 启动 | 通过 |
| `corepack yarn workspace dsh-plugin-desktop verify:profile` | Profile 组合 | 通过 |
| `corepack yarn workspace dsh-plugin-desktop verify:closure` | 运行时闭包 | 通过 |
| `corepack yarn workspace dsh-plugin-desktop verify:licenses` | 许可证 | 通过 |
| `corepack yarn workspace canvas-studio test:smoke` | Canvas 冒烟 | 通过 |
| `corepack yarn workspace dsh-community-market check` | 市场完整 check | 通过 |

### 6.2 手工验收矩阵

| 场景 | 检查点 |
| --- | --- |
| 全新安装启动 | 首屏、登录/引导、无 Loader 报错 |
| 从 0.1.1 升级 | `settings.yaml` 导入、设置保留、preset 保留、市场配置保留 |
| 兼容模式 | 官方 Web 客户端、Settings、会话 |
| 扩展模式 | Desktop 独立 layout/sidebar、窗口材质 |
| 高级模式 | 独立 root registration、caption |
| Canvas Studio | 打开项目、生成、渲染、设置页、登录 |
| 社区市场 | 目录源、安装/卸载、重启提示 |
| Web 搜索 | hybrid/tinyfish 配置与调用 |
| 终端 | 打开、命令执行、Windows pwsh |
| 通知 | 会话完成、子代理过滤 |
| 浏览器访问 | loopback/LAN、trusted hosts、拒绝通配地址 |
| 自动更新 | 检查、下载、安装 |
| 打包 | macOS dir/notarize、Windows NSIS/portable |

### 6.3 数据迁移专项

1. 用备份 `$DSH_HOME` 启动，确认 `settings.yaml` 被重命名为 `settings.yaml.imported`。
2. 对比迁移前后的 Desktop 设置值。
3. 确认 `agent-preset-registry.selectedDefault` 与用户原选择一致。
4. 确认市场设置仍可读写，且 revision 冲突有正确提示。
5. 回滚演练：恢复旧版本 + 旧 `settings.yaml`，确认可启动。

---

## 7. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 客户端 Settings 体系迁移超预期 | 高 | 高 | 先做 1 个设置页 spike（Desktop），确认 Remote/ConfigForms 模式后再批量迁移 |
| `settings.yaml` 导入丢设置 | 中 | 高 | 严格按原项目映射表实现；用真实备份数据做迁移专项；升级前自动备份 |
| 市场设置从任意 namespace 改为插件 Config | 高 | 中 | 先确认新 Settings API 能否承载动态目录源；必要时保留只读兼容层 |
| 独有 patch 无法直接重做 | 中 | 中 | 每个 patch 先确认上游是否已修复；无法保留的功能写入发布说明 |
| `ui-layout` / `ui-sidebar` 与 Canvas 冲突 | 中 | 高 | 以 loader/profile 冒烟为准；必要时调整 Canvas 的 slot 注册 |
| `webRuntime` → `webStartup` 影响浏览器访问 | 中 | 中 | 专项验证 loopback/LAN/trusted host；拒绝通配地址的行为需产品确认 |
| Windows 专属 patch 回归不足 | 中 | 中 | 在 Windows CI/真机跑 pwsh、subprocess、目录选择器、打包 |
| 上游包未发布到 registry | 低 | 高 | 已核查 103 个在用包均可用于 `0.2.1-rc.2`；若后续引入新包缺失，需等上游发布或申请 gate 例外，不能私自 vendor |
| Canvas 未随 desktop 迁移导致运行时崩溃 | 高 | 高 | `verify-layout` 不覆盖 `canvas-studio`，只升 desktop/market 也能过 gate；把 canvas 迁移列为 P1/P2 硬性入口条件（§4.8） |
| 依赖体积与启动时间上升 | 中 | 中 | 只引入必需包；对比升级前后安装体积与首屏时间 |
| 范围蔓延到原项目新功能 | 高 | 中 | 严格按 §1.3 非目标执行；新功能另立需求 |

---

## 8. 工作量与排期

| 阶段 | P50（人日） | P90（人日） | 备注 |
| --- | ---: | ---: | --- |
| P0 基线 | 0.5 | 1 | — |
| P1 pin/依赖 | 1.5 | 2.5 | 依赖冲突是主要变量 |
| P2 宿主迁移 | 3 | 5 | Settings/preset/webStartup |
| P3 客户端迁移 | 4 | 7 | SettingsScope 是最大变量 |
| P4 patch | 3 | 5 | 7 个可参考、6 个独有、2 个删除 |
| P5 验证/打包 | 3 | 4.5 | 含数据迁移演练 |
| **合计** | **15** | **25** | 单人 3–5 周 |

建议排期：1 人全职 3–4 周；若 Host/Client/patch 可并行，可压缩到约 2.5 周，但需要额外的代码评审与集成时间。

---

## 9. 回滚方案

### 9.1 合并前

- 所有改动集中在 `upgrade/dsh-0.2.1-rc.2` 分支，`dev` 不受影响。
- 回滚只需删除分支，或 `git reset --hard` 到基线。
- 子模块 pin、`upstream.json`、`package.json`、`yarn.lock`、`patches/` 作为一组回滚。

### 9.2 合并后 / 发布后

- 保留上一版本安装包与 0.1.1 的 `$DSH_HOME` 备份。
- 若必须回退：
  1. 退出应用；
  2. 恢复 `$DSH_HOME` 备份（含 `settings.yaml`）；
  3. 重新安装上一版本；
  4. 验证设置、preset、市场配置。
- 注意：0.2.1 已把 `settings.yaml` 重命名为 `settings.yaml.imported`，回退时必须恢复原文件，不能只回退应用版本。

### 9.3 分阶段回滚点

| 阶段 | 回滚方式 |
| --- | --- |
| P1 | 恢复 pin/清单/锁文件 |
| P2 | 回退 Host 迁移提交 |
| P3 | 回退 Client 迁移提交 |
| P4 | 回退 patch 与 resolutions |
| P5 | 回退发布，恢复用户数据备份 |

---

## 10. 决策记录（已于 2026-10-20 拍板）

| 编号 | 决策 | 选项 | 结论 |
| --- | --- | --- | --- |
| D1 | 目标版本 | `0.2.1-rc.2` / `0.2.0-rc.2` / `0.1.7-rc.2` / 保持现状 | **采用 `0.2.1-rc.2`** |
| D2 | 是否接受设置自动迁移 | 接受一次性导入并重命名 / 自研迁移脚本 / 不做迁移 | **接受上游导入 + Desktop 映射表 + 升级前备份 `$DSH_HOME`** |
| D3 | 设置 UI 方案 | 迁移到 `remote.settings` + `configForms` / 保留自定义页面并自建 API / 暂时只读 | **迁移到 `remote.settings` + `configForms`** |
| D4 | Canvas 兼容模式 | 继续替换 `ui-layout`/`ui-sidebar` / 改用官方布局 | **继续替换 `ui-layout`/`ui-sidebar`**，本轮做 0.2.1 兼容性验证 |
| D5 | 是否引入上游桌面 | 否 / 是 | **否**；未发布 npm，且与产品架构冲突 |
| D6 | 发布节奏 | 直接正式版 / 先 beta | **本轮不在决策范围**：项目处于开发阶段，以功能正确为第一目标，不考虑对外版本节奏 |
| D7 | Canvas / Market 迁移方式 | 与 desktop 同分支 lockstep 迁移 / 独立分支先行 / 暂缓升级 | **同分支 lockstep 迁移**；`verify-layout` 不覆盖 canvas，独立分支容易被误判为「已通过」 |

### 10.1 附加约束（随 D6/D7 一并确认）

1. **功能对等优先**：本次以升级 DSH 版本为主，但**所有现有本地功能必须保留**，不得因升级而删减产品能力（包括三种外壳模式、设置、通知、终端、自动更新、Web 搜索、市场、Canvas 等）。
2. **画布是核心**：`canvas-studio` 是本项目核心能力，升级后必须保证画布功能正常可用；画布问题按最高优先级处理，进 P2/P3 的第一批验收项。
3. **不做发布规划**：本轮只保证 `upgrade/dsh-0.2.1-rc.2` 分支上功能正确、gate 通过，不安排对外发布（D6 相关章节中的 beta/正式节奏表述仅作参考，不作为本轮出口条件）。

---

## 11. 审批记录

| 角色 | 姓名 | 结论 | 日期 | 备注 |
| --- | --- | --- | --- | --- |
| 产品/项目负责人 | — | **D1–D7 全部按下表结论执行** | 2026-10-20 | 见 §10 与 §10.1 |
| 技术负责人 | — | 待审核 | — | — |
| 发布负责人 | — | 本轮不涉及发布 | 2026-10-20 | 开发阶段，先保证功能正确 |

---

## 附录 A：依赖统计

| workspace | DSH 条目 | 其中 `0.1.1-rc.2` | 其中 `0.1.0-rc.7` |
| --- | ---: | ---: | ---: |
| `dsh-plugin-desktop` | 104 | 104 | 0 |
| `canvas-studio` | 28 | 15 | 13 |
| `dsh-community-market` | 66 | 66 | 0 |
| `dsh-web-search-hybrid` | 9 | 9 | 0 |
| `dsh-web-search-tinyfish` | 9 | 9 | 0 |
| `dsh-community-fabric` | 0 | 0 | 0 |
| **合计** | **216** | **203** | **13** |

> `canvas-studio` 的 13 条旧 pin 包括 `dsh-client-runtime`、`dsh-client-ui-layout`、`dsh-client-ui-slots`、`dsh-client-ui-conversation` 等；升级时需统一，避免同一 workspace 内出现两个客户端运行时版本。

## 附录 B：本地方案 patch 清单

| # | 文件 | 目标包 | 0.2.1 状态 | 处置 |
| ---: | --- | --- | --- | --- |
| 1 | `app-builder-lib@26.15.7.patch` | 第三方 | 存在 | 保留/按版本重做 |
| 2 | `dsh-agent-loop@0.1.1-rc.2.patch` | DSH | 存在 | 本项目独有，人工重做 |
| 3 | `dsh-app-boot@0.1.1-rc.2.patch` | DSH | 存在 | 参考原项目 |
| 4 | `dsh-client-runtime@0.1.1-rc.2.patch` | DSH | **删除** | 确认新实现，必要时迁移 |
| 5 | `dsh-client-ui-directory-picker-browse@0.1.1-rc.2.patch` | DSH | 存在 | 参考原项目，工作量较大 |
| 6 | `dsh-client-ui-settings-models@0.1.1-rc.2.patch` | DSH | 存在 | 本项目独有，人工重做 |
| 7 | `dsh-client-ui-trajectory@0.1.1-rc.2.patch` | DSH | 存在 | 本项目独有，人工重做 |
| 8 | `dsh-client-ui-workspace@0.1.1-rc.2.patch` | DSH | 存在 | 本项目独有，人工重做 |
| 9 | `dsh-host-apiproxy-model-modalities@0.1.1-rc.2.patch` | DSH | **删除** | 评估迁移或放弃 |
| 10 | `dsh-host-directory-picker-browse@0.1.1-rc.2.patch` | DSH | 存在 | 参考原项目 |
| 11 | `dsh-llm-deepseek@0.1.1-rc.2.patch` | DSH | 存在 | 本项目独有，人工重做 |
| 12 | `dsh-sandbox-windows-acl@0.1.1-rc.2.patch` | DSH | 存在 | 参考原项目 |
| 13 | `dsh-subprocess-local@0.1.1-rc.2.patch` | DSH | 存在 | 参考原项目 |
| 14 | `dsh-token-meter@0.1.1-rc.2.patch` | DSH | 存在 | 本项目独有，人工重做 |
| 15 | `dsh-web-app@0.1.1-rc.2.patch` | DSH | 存在 | 参考原项目，需适配 webStartup |
| 16 | `dsh@0.1.1-rc.2.patch` | DSH | 存在 | 参考原项目 |
| 17 | `open@11.0.1.patch` | 第三方 | 存在 | 保留/按版本重做 |

## 附录 C：关键命令

```bash
# 基线
corepack yarn check
git submodule status

# 上游
corepack yarn upstream:install
corepack yarn upstream:build

# 根 workspace
corepack yarn install
corepack yarn typecheck
corepack yarn test
corepack yarn check

# 桌面包专项
corepack yarn workspace dsh-plugin-desktop verify:loader
corepack yarn workspace dsh-plugin-desktop verify:profile
corepack yarn workspace dsh-plugin-desktop verify:closure

# 打包冒烟
corepack yarn dist:mac-smoke
corepack yarn dist:win-portable
```

## 附录 D：证据索引

| 结论 | 证据 |
| --- | --- |
| 当前上游 pin 为 0.1.1-rc.2 | `git submodule status`；`upstream.json:3-6` |
| 0.2.1-rc.2 是 npm latest/next | `npm view @deepseek-ai/dsh dist-tags` |
| 原项目已在 0.2.1-rc.2 | `anywhere-labs/dsh-desktop` 的 `upstream.json`（commit `687f282e86`） |
| 原项目有 21 个 0.2.1-rc.2 patch | 其仓库 `patches/*@0.2.1-rc.2.patch` |
| 0.1.2-rc.1 起删除 client-runtime/apiproxy | 各 tag 的包清单对比 |
| 0.1.7 起删除 settings-file/agent-presets/code-runtime | 上游 `docs/upgrade-guide/` 与原项目 `profile.ts` 注释 |
| 0.2.1 删除 invariants | `docs/upgrade-guide/v0.2.0-rc.2/remove-runtime-invariants/guide.md`（该指南描述 0.2.0-rc.2 之后的版本；包清单确认 0.2.0-rc.2 仍存在、0.2.1-rc.2 已移除） |
| 0.2.1 删除 subagent-in-process-driver | `docs/upgrade-guide/v0.2.1-alpha.1/subagent-activations/guide.md` |
| webRuntime 改为 webStartup | `docs/upgrade-guide/v0.2.1-alpha.1/web-listener-trust-config/guide.md`；本项目 `main.ts:932`、`profile.ts:862` |
| 本项目禁止 file: 依赖 | `scripts/verify-layout.mjs:88` |
| 本项目 19 个 src 文件引用 client-runtime | `grep -rl "dsh-client-runtime/client" ...`（见 §1.1） |

---

## 附录 E：审核意见

> 请在下方记录审核结论；未通过时请注明需修改的章节。

| 日期 | 审核人 | 结论 | 意见 |
| --- | --- | --- | --- |
| 2026-10-20 | 用户 | D1–D7 通过 | 见 §10 / §10.1 |

---

## 附录 F：P0/P1 执行记录（2026-10-20）

### F.1 已执行

| 步骤 | 结果 |
| --- | --- |
| P0 建分支 | `upgrade/dsh-0.2.1-rc.2`（自 `dev`，HEAD `c3cc3d43d1`） |
| P0 基线 gate | 仅 2 个**既有**失败：`dsh-plugin-desktop/tests/mac-x64arch.spec.ts`（Mach-O 覆盖，与工作区 node_modules 状态相关，与本升级无关） |
| P1 子模块 pin | `deepseek-harness` 切到 `687f282e8625c6b8d11ff58211a90524be2e4317`（`dsh-v0.2.1-rc.2`）；`git add` 后 `verify-layout` 通过 |
| P1 `upstream.json` | `commit` / `sourceVersion` / `runtimePackageVersion` 全部 → `0.2.1-rc.2` |
| P1 依赖 bump | 6 个 manifest 的 `@deepseek-ai/dsh*` 全部 → `0.2.1-rc.2`；cordis 家族 → `cordis@4.0.5`、`plugin-loader@1.0.6`、`plugin-include@1.0.10`、`plugin-group@1.0.5`、`plugin-timer@1.1.7`、`schemastery@^3.18.5` |
| P1 删除被删包 | 8 个包从所有 manifest 移除（desktop 5、market 5、canvas 4、tinyfish 1；含重复） |
| P1 patch 出栈 | root `resolutions` 移除全部 `@deepseek-ai/*` patch 条目（保留第三方 `app-builder-lib`/`open`/`dshmarket`/`koffi`）；`patches/*` 文件保留待 P4 |
| P1 安装 | `corepack yarn install` 成功（3m19s，+426 包），仅 `YN0002`/`YN0086` peer 警告 |
| P1 gate | `GIT_CONFIG_GLOBAL=/dev/null node scripts/verify-layout.mjs` 通过；`yarn.lock` 重生成（~19k 行变更） |

> 环境修复：`deepseek-harness` 内有一个 2026-09-01 的陈旧 `.git/modules/deepseek-harness/index.lock`（0 字节，无 git 进程），已删除。
> 本机 `verify-layout` 需加 `GIT_CONFIG_GLOBAL=/dev/null`，否则全局 `insteadOf` 会让 `origin` 判定失败。

### F.2 断点清单（typecheck 实测）

`yarn typecheck` 三个 workspace 全部失败，作为迁移工作项的入口：

| workspace | 错误数 | 主要文件 | 根因分类 |
| --- | ---: | --- | --- |
| `dsh-plugin-desktop` | 41 | `index.ts`(15)、`profile.ts`(6)、`notifications.ts`(6)、`main.ts`(6)、`windows-pwsh-sandbox.ts`(6)、`profile-manager.ts`、`desktop-plugins.ts` | Settings API（`SettingsForms.register/get`、`settingsNamespace`、`settings/updated` 事件消失）、`ProfileTemplate` 类型重写（`patchPath`→`patchPaths`、新增 `skippedBundles`）、`dsh-settings-file`/`healProfilesModuleFallback` 删除、Job API（`JobSnapshot`/`onJobDone`）、pwsh sandbox `Volatile`/`SandboxPwshExecutor` 形状、`webServer.port` |
| `dsh-community-market` | 14 | `host/routes.ts`(13)、`catalog/source-store.ts`(1) | `SettingsScope`/`settingsNamespace` 导入消失、`SettingsForms.register` 消失、`ctx.webServer.port` |
| `canvas-studio` | 86 | `routes.ts`(71)、`index.ts`(9)、`host-config.ts`(1)、`dsh-tools`/`dsh-llm` 的 `.d.ts`(5 处) | `ctx.webServer.port` 由 `number` → `number \| undefined`（占 71）、缺失依赖 `dsh-credentials`/`dsh-settings`、`systemPrompt` 服务形状变化、peer 包 `dsh-sandbox`/`dsh-ptc-runtime`/`dsh-attachment` 未声明 |

**已定位的关键 API 变化**：

1. `@deepseek-ai/dsh-host-webserver` 的 `WebServer.port` 现在是 `get port(): number | undefined`（“or `undefined` before `listen` binds”），直接导致 81 个 `TS2345`。修复点集中在 `canvas-studio/src/routes.ts:654` 与 `dsh-community-market/src/host/routes.ts:667` 的 `const expectedPort = ctx.webServer.port`。
2. `@deepseek-ai/dsh-settings`：`settingsNamespace` 消失（疑为 `SettingsNamespace`），`SettingsForms` 无 `register`/`get`；事件 `settings/updated` 不再是 `keyof Events`。
3. `dsh-agent-loop`、`dsh-app-boot`（`healProfilesModuleFallback`）、`dsh-settings-file`、`dsh-jobs`（`JobSnapshot`/`onJobDone`）均有导出签名变化，属 P2 逐项处理。

### F.3 P2 进度（2026-10-20，进行中）

已完成：

| 项 | 结果 | 提交 |
| --- | --- | --- |
| `ctx.webServer.port` 语义修复 | `canvas-studio/src/routes.ts` 与 `dsh-community-market/src/host/routes.ts` 把 `const expectedPort = ctx.webServer.port` 改为惰性读取 `(): number \| undefined => ctx.webServer.port`，调用点改为 `expectedPort()`；helper 签名与 `expectedPort` 字段放宽为 `number \| undefined`（`studioAuthority`/`marketRequestAllowed` 对 `undefined` 天然返回 false） | `d72e73437c` |
| Canvas 缺失依赖补齐 | `canvas-studio/package.json` 补 `dsh-attachment`、`dsh-credentials`、`dsh-ptc-runtime`、`dsh-sandbox`、`dsh-settings`（原依赖 hoist 巧合，未显式声明） | `d72e73437c` |
| **Canvas 宿主 settings 迁移（Option A，见下）** | `host-config.ts` 去掉 `settingsNamespace`，schema 整棵 `.volatile()`；`index.ts` 导出 `Config = CanvasStudioConfig`、`apply(ctx, config)` 经 `config.get()` 读当前值、移除 `installSettingsSection`、`ctx.settings.configure({ auto: false }, ctx.fiber)` 关闭自动页、监听 `loader/volatile-update` 同步派生状态；`createStudioTools` 端口改 getter；四个 prompt helper 复用 `Pick<Context, 'systemPrompt' \| 'on'>` | `d72e73437c` |
| 错误下降 | canvas 宿主 `86 → 0`（`tsc -p tsconfig.json` 通过）；market `14 → 4` | |

**Canvas 宿主 settings 迁移要点（Option A，已落地）**：

- Cordis 从模块**命名导出**读取 `Config`：`canvas-studio/src/index.ts` 现导出 `Config = CanvasStudioConfig`，函数式 `apply(ctx, config)` 的第二参即校验后的 Config 值。
- 采用**对象级 `.volatile()`**（`z.object({...}).volatile()`）：`isVolatilePath` 视「祖先 volatile」下所有字段可编辑，且 `volatileForm` 返回整棵 plain schema；运行时值为 `Volatile<CanvasStudioConfig | undefined>`，`config.get()` 返回已填默认值的普通对象。
- 关键机制（已核对源码）：Loader 对 **volatile-only** 配置变更走 `_commitVolatile()` → `updateVolatile(ref, source)` **原地更新、不重启插件**（`cordis-plugin-loader/src/config/entry.ts:145-191`）；普通字段变更才 `fiber.update()` 重启。
- 因此不能用「重装回调」同步派生状态，改为监听 `ctx.on('loader/volatile-update', ...)` 触发 `syncErrorVisibility` / `syncDramaAuthRequired` / `onStorageRootMaybeChanged`（参考上游 `llm-deepseek/src/host.ts:57`、`speech-to-text/src/index.ts:50`）。
- schema 放置约束：`app-boot/src/config-schema/projector.ts:133` 禁止 volatile 嵌套 volatile；对象级 volatile 下**子字段不得再标 volatile**（canvas 子字段均未标，合法）。

### F.3.1 Market 宿主 settings 迁移（2026-10-20，已完成，提交 `cf41e64cc7`）

| 项 | 结果 |
| --- | --- |
| `source-store.ts` | 删除 `SettingsScope` 导入，改为本包自持的 `MarketSettingsStore` 契约（`get()` / `update(patch)` 两个方法，与 dsh-settings 解耦） |
| `host/routes.ts` | `MARKET_SETTINGS_NAMESPACE` 改为纯字符串（= entry id `dsh-community-market`）；`SETTINGS_SCHEMA` → 导出 `MarketSettingsConfig`（对象级 `.volatile()`）；`registerMarketSettings(ctx, config)` 读 `config.get()`、写经 `ctx.settings.mutate(ns, ops)`（ns 由 `ctx.get('loader').locate(ctx.fiber)` 取得） |
| `index.ts` | 导出 `Config = MarketSettingsConfig`；`apply(ctx, config)` |
| 测试 | `market-settings-persistence.spec.ts` 依赖的 `dsh-settings-file`/`settings.register` 已被删除，重写为适配器契约测试（volatile + stub `ctx.settings.mutate`） |
| 错误 | market 宿主 `4 → 0`（`tsc -p tsconfig.json` 通过） |

### F.3.2 依赖一致性缺口（P1 遗留，重要）

- **现象**：上游 0.2.1 的客户端包 `.d.ts` 引用了若干**新包**（`dsh-client-store`、`dsh-plugin-manager`、`dsh-plugin-market`、`dsh-subagent`、`dsh-api-job-controller`、`dsh-api-session-controller`、`dsh-api-terminal-controller`、`dsh-api-workspace-controller`、`dsh-api-workspace-files`、`dsh-command-feedback`、`dsh-client-shortcuts`、`dsh-package-manifest`、`dsh-util-code-language`、`dsh-jobs`、`dsh-workspace`、`dsh-host-directory-picker`、`@types/mdast`），但这些包**既未声明为 dependencies 也未声明为 peerDependencies** —— 上游靠 pnpm workspace 的物理共存解决。
- **影响**：Yarn `node-modules` 隔离下它们不入目录 ⇒ `TS2307 Cannot find module`。P1 只做了「删除 8 个消失包 + 升级版本」，未做「补齐 0.2.1 新增包」。
- **处置**：已在 `dsh-community-market` 补入上述包（`0.2.1-rc.2`，devDependencies；`@types/mdast@^4.0.4`）。**desktop / canvas 需按各自 typecheck 报出的缺失清单同样补齐**（见 F.4）。

剩余（Settings 模型迁移，见下）：

| workspace | 剩余错误 | 内容 |
| --- | ---: | --- |
| `canvas-studio`（host） | 0 | ✅ 宿主侧已清零 |
| `dsh-community-market`（host） | 0 | ✅ 宿主侧已清零（`cf41e64cc7`） |
| `canvas-studio`（client） | 约 60+ | 均为 `@deepseek-ai/dsh-client-runtime/client` 删除的级联（`TS2307` + 由此产生的隐式 any）；属 P3，需切到 `cordis` + `dsh-client-store` |
| `dsh-community-market`（client） | 约 30+ | `dsh-client-runtime/client` 删除级联 + `dsh-client-ui-primitives` 图标改名（`Icon*Outline16/14` → `Icon*OutlineMedium`）+ 槽位 props（`useStore`/`actions`）变更；属 P3 |
| `dsh-plugin-desktop`（host） | 0 | ✅ 宿主侧已清零（见 F.5；`d669deafaa` 等） |

**Settings 模型的关键事实（P2 依据）**：

- 0.2.1 的 `@deepseek-ai/dsh-settings` 不再导出 `settingsNamespace`/`installSettingsSection`/`SettingsScope`。
- 新模型：`ctx.settings: SettingsForms`（`@deepseek-ai/dsh-settings` 默认导出）。入口为 `describe()/update()/replace()/mutate()`，namespace 即 **Loader entry id**；`configure({ auto }, owner)` 只登记页面策略。
- 插件读取自身配置的方式变为**直接读插件 Config 对象（由 Loader 实时更新）**，不再有 `scope.get()/watch()`。参考实现：上游 `packages/core/agent-default-model/src/index.ts:60` 的 `child.settings.configure({ auto: false }, ownerContext.fiber)`。
- 旧实现（0.1.5）`installSettingsSection` 语义保留在 git 历史 `b0a2011d95:packages/settings/settings/src/index.ts:474`，可作为重写对照。

### F.4 待办清单（按优先级）

1. ✅ **Canvas 宿主 settings 迁移完成**（`d72e73437c`）；客户端级联错误待 P3。
2. ✅ **Market 宿主 settings 迁移完成**（`cf41e64cc7`）；客户端级联错误待 P3。
3. **补齐 desktop / canvas 的 0.2.1 新增依赖**（F.3.2）：按 `tsc` 报出的 `TS2307` 清单逐个加入对应 manifest（`0.2.1-rc.2`）。
4. ✅ **Desktop 宿主迁移完成**（`2d827d4503` `f6f7812337` `e70f4d19bb` `d669deafaa`，宿主 `tsc` 41 → 0）；测试与客户端面留待 P3/P4（见 F.5「已知后续」）。
5. P3 客户端迁移（canvas + market + desktop）：`client-runtime` → `cordis` + `dsh-client-store`；`dsh-client-ui-primitives` 图标改名；槽位 props（`useStore`/`actions`）改写；含各 package.json 的 `dsh.client.inject` 中已删除的 `@deepseek-ai/dsh-client-runtime`。**此步完成前三个 workspace 的 client typecheck 无法清零。**
6. P4 patch 重做。
7. 补跑各包自身验证链（`typecheck && build && verify:loader && test:smoke`）——须待 P3 后。

### F.5 Desktop 宿主迁移（2026-10-20，已完成宿主侧，提交 `2d827d4503` `f6f7812337` `e70f4d19bb` `d669deafaa`）

决策（延续 §10）：**把 desktop 持久设置折叠进 `desktop-shell` 插件 Config**，设置存于 profile patch（entry id = `desktop-shell`），旧 `settings.yaml` 的 `dsh-desktop` section 作为一次性迁移来源。desktop 宿主 `tsc -p tsconfig.json` 由 **41 → 0**。

| 模块 | 提交 | 内容 |
| --- | --- | --- |
| pwsh sandbox | `2d827d4503` | 0.2.1 以单个 `protected argv(spec)` 取代 `runArgv`/`startArgv`；`PwshConfig.pwshPath` 变为 `Volatile<string>`。ACL trampoline 改经 `argv()`，runner-only env 写回 spec；`pwshPath` 经 `createVolatile`/`updateVolatile` 提交 |
| ProfileTemplate | `f6f7812337` | `PROFILE_TEMPLATES[x]` 由裸 bundle 列表改为 `ProfileTemplate{ bundles }`；`desktop-plugins.ts`/`profile-manager.ts` 读 `.bundles` |
| notifications | `e70f4d19bb` | 通知设置折叠为插件 volatile Config（entry id `desktop-notifications`）；移除 `settings.register`；`jobs.onJobDone` → `jobs.events.subscribe({ owners: 'all' })`，只上报未 `awaited` 的 `settled` 事件；`JobSnapshot` 类型消失，改用 `JobView` |
| shell settings | `d669deafaa` | `Config extends DesktopSettings` 且对象级 `.volatile()`；`apply(ctx, configValue)` 取启动快照；`ctx.settings.configure({ auto: false }, ctx.fiber)`；写经 `ctx.settings.update(entryId, patch)`（entryId 由 `loader.locate(ctx.fiber)`）；跨字段校验改经 `ctx.on('internal/config', …)` waterfall；重启检测改监听 `loader/volatile-update`；theme/locale 经 `ctx.settings.describe()` + `settings/document-updated`；`ctx.webServer.port` 补 `?? DESKTOP_DEFAULT_WEB_PORT` |

**profile.ts 启动设置来源变更**：不再组合 `dsh-settings-file` 的 `settings` 行、不再 `healProfilesModuleFallback`（改用 `removeLinkProjections(profileDir)`）。启动 `mode/port/...` 改从组合后的 `desktop-shell` 行 config 读取（`readDesktopStartupSettings(rowConfig(shellRow))`）。`settings.yaml` 路径仅保留给 setup wizard / browser-access 迁移 / recovery 窗口（`PreparedDesktopProfile.settingsDocument`）。

**已知后续（P2 收尾 / P3 前）**：
- `settings.yaml` 现由上游 `SettingsForms.importLegacyDocument` 在首启重命名为 `.imported`；desktop 的 wizard/迁移若依赖该文件将失效，需将 setup wizard 与 browser-access 迁移改写到 `ctx.settings.update('desktop-shell', …)`。
- desktop 客户端设置面（`DesktopSettingsSection`）仍引用旧 ns `dsh-desktop`；新 ns = entry id `desktop-shell`，属 P3 客户端迁移。
- `tsconfig.tests.json` 仍缺 `dsh-client-runtime`（已删，P3）与引用已删 `dsh-settings-file` 的测试；`tests/plugin.spec.ts`/`profile.spec.ts`/`windows-pwsh-sandbox.spec.ts`/`client-desktop-settings.spec.ts` 断言的是旧 API，需随 P3/P4 一并改写。


