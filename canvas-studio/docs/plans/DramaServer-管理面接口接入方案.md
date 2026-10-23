# DramaServer 管理面接口接入方案（auth/sync · models · credits/balance）

> 状态：**P1/P2/P4 + 积分（P3 的 credits 部分）落码完成，剩桌面 GUI 验收 + L6（2026-10-23 核对）**——P1 = CV-355、P2 = CV-356、P4 = CV-357、**余额 = CV-358**；P3 只剩 `session` / `models` 两条只读路由与业务用户展示未做（未取号）。逐阶段进度与缺口见 [§0.5](#05-当前进度核对2026-10-23)
> 日期：2026-10-20（2026-10-22 按 DSH 0.2.1-rc.2 重新评估，见 §0.4）
> 接口来源：《DramaServer 业务 API》（api(10).md，2026-10-19 版）：`POST /v1/auth/sync`、`GET /v1/models`、`GET /v1/credits/balance`
> 参考实现：`/Users/wl/Desktop/job/reelsbuddy-desktop`（ADR-0002 已在 DSH 体系完整落地同一套接口）
> 条目号：P1/P2/P4 = CV-355/356/357（写号前已 grep `docs/`，无撞号；`CV-DMA-*` 占位作废）

## 0. 背景与已拍板决策

### 0.1 服务拓扑澄清（重要）

**DramaServer 业务 API（`/v1/*`）与现有生成后端（`/api/v1/*`，`dramaApiBase`）不是同一个服务**——同机不同端口（117.50.108.73 的 80 vs 8082），路径族与鉴权均不同：

| | 生成后端（现有） | DramaServer 业务 API（本次接入） |
| --- | --- | --- |
| 路径族 | `/api/v1/generate/*`、`/api/v1/jobs/*` | `/v1/auth/sync`、`/v1/models`、`/v1/credits/balance`、`/v1/llm/*` |
| 鉴权 | API Key（credential-ref） | Supabase access token（Bearer JWT） |
| 基址 | 设置项 `dramaApiBase`（默认 `http://117.50.108.73:8082`） | 设置项 `businessApiBase`（默认 `http://117.50.108.73`，80 端口；2026-10-20 部署确认） |

因此新增**独立设置字段 `businessApiBase`**，不复用 `dramaApiBase`。

### 0.2 决策记录（2026-10-20 与产品对齐）

1. **实现参考 reelsbuddy**：协议客户端、错误映射、网关写法直接平移改造。
2. **`/v1/models` 消费深度 = 接入 DSH LLM 网关**（reelsbuddy ADR-0002 同款）：text 模型进官方模型选择器；媒体生成链路（图/视频/配音）不动，继续走 canvas-studio 自己的 provider 体系。
3. **`device_id` 由 canvas-studio 自建持久化**（`device.json`），不依赖 dsh-plugin-desktop 的安装标识。
4. **`credits/balance` 仅展示**，不做生成前预检；以服务端冻结/扣费结果为准。
5. **DSH seam 缺失时的解法 = 升级 DSH 版本**（本决策在网关场景下优先于 REQ-007「暂缓升级等 stable」的旧拍板）。
6. **会话持有架构不变**：client（renderer）仍是唯一 Supabase session 持有者，Host 只做内存缓存（2026-10-15 拍板，见 `src/auth-session.ts` 头注）；管理面调用从 Host 缓存取 token，不把会话管理搬进 Host。

### 0.3 关键接口约束（实现时对照 api(10).md）

- 全部请求带 `Authorization: Bearer <supabase access token>`；按 `error.code` 分派，不解析文案。
- `auth/sync` 幂等；**带 `device` 时 JWT 必须含 `session_id`**（Google PKCE 登录的 access token 满足，现有登录流无需改动）。
- `device_id` 跨启动稳定；重复登记覆盖字段，每次发全量设备信息。
- `/v1/models` 用 `modality=text` 过滤（网关只吃 text）；判断 `available` 而非只看数组；`models` 空时是 `[]` 不是 `null`。
- 金额固定 4 位小数（JSON number），展示不截断为整数。
- 限流 600 次/分（IP + 用户），429 带 `Retry-After`；503 退避不高频重试；403 提示账号禁用并停止业务请求。
- 401 = token 过期 → 静默丢弃本次，等 client `TOKEN_REFRESHED` 重推后重试（现有推送机制天然覆盖）。

### 0.4 重新评估（2026-10-22，DSH 0.2.1-rc.2 已就位）

背景：方案起草时本仓 pin 0.1.x-rc 线；此后 DSH 已整体升级 0.2.1-rc.2（2026-10-21 迁移，含 wire 面改版）。重新核对结论：

| 项 | 0.1.x 时代的假设 | 0.2.1-rc.2 实测 | 结论 |
| --- | --- | --- | --- |
| `ctx.get('configEditor')` | 缺失，需升级 DSH（原拍板 0.2-5） | ✅ `dsh-config-editor@0.2.1-rc.2`：`entries()` / `edit(entry, change)`（校验 + 持久化 profile patch + Loader 重放），API 面与 reelsbuddy 用法一致 | **无需升级**，P4 直接落地 |
| `ctx.credentials.set` | 仅用过 `.resolve` | ✅ `dsh-credentials` 抽象基类有 `set/unset/resolve` | 可用 |
| llm-pi-ai 行热重放 | 待 spike | ✅ `llm-pi-ai/src/index.ts` 监听 `internal/config`，settings 变更自动重注册路由（同一 adapter 实例重注册） | 只写 `llm-pi-ai` 的 provider 行即可热生效 |
| Spike（§4.0） | 先行探针 | **三 seam 全部存在，Spike 免除**，结论直接回填本表 | §4.0 关闭 |
| 模型目录消费方 | 设置页官方区块（CV-354 已埋 `canvas-studio-gateway` 识别 + 待接入暗态） | 不变；P4 落地后官方区块与聊天模型选择器自动点亮，**零 UI 改动** | CV-354 与本方案闭环 |
| 宿主目录构建链 | 聊天「暂无可选模型」根因（2026-10-22 用户实测两图） | `buildModelCatalog` 遍历已注册 provider 的 `listModels`，凭据解析失败的组整体剔除 | P4 是聊天可用的**唯一**路径（DeepSeek key 手配是临时替代） |

范围调整：本轮落地 **P1 + P2 + P4**（用户拍板「重新评估后开发，把自有大模型配置连通」+ 真实链路验收）；P3 剩余 UI（余额 chip、业务用户展示）不在本轮。

### 0.5 当前进度核对（2026-10-23）

对着 `src/` 与提交历史逐条核对，不按「已写进文档」算完成：

| 阶段 | 条目 | 代码状态 | 证据 / 缺口 |
| --- | --- | --- | --- |
| P1 协议客户端 + 设备身份 | CV-355 | ✅ 落码 | `src/drama-management.ts`（`sync`/`listTextModels`/`creditBalance`/`ApiError`）、`src/device-registry.ts`、`host-config.ts` 的 `businessApiBase`；两个测试文件在位 |
| P2 登录 bootstrap | CV-356 | ✅ 完成（含欠账） | `auth/sync` → `models` → 网关回调（`src/account-state.ts`，接线 `routes.ts:3373/3396`）；**`refreshBalance` 那条欠账已随 CV-358 落地**（`refreshCredits` + 30s TTL + `creditsView`） |
| P4 LLM 网关 | CV-357 | ✅ 落码 | `src/gateway.ts` 纯函数 + `index.ts` 的 `applyGatewayConfig`/`reconcileGateway`（串行队列 + 指纹 + 启动期缓存恢复）；落行走 `settings.mutate`（`configEditor.edit` 的全量重放会被无关 entry 激活失败整体回滚，见 CV-357 详情） |
| P3 只读路由 + UI | **CV-358**（credits）/ 未取号（其余） | 🟡 **credits 已落** | `GET /canvas-studio/account/credits` + `CreditsCard`（左栏 `.csCredits` 卡，见下方「积分落地清单」）；`session` / `models` 两条路由与业务用户展示**仍未做**，不需要它们的功能就不必开 |

**结论（LLM 这条线）**：代码缺口 = 0。剩下全是验收 —— 桌面 5 步（官方区块点亮 / 聊天模型选择器出现 DramaServer 组 / 保存设置窗口不消失 / 服务端有设备记录 / 日志出现「管理面 bootstrap 完成」）+ L6 脚本一次 `scripts/live-e2e-management.mjs` + §4.2 两个契约待确认项（`/v1/llm` 契约、text 模型与 `openai-completions` 兼容性），后者本就靠 L6 覆盖。

**结论（积分这条线）**：已落 **CV-358**（Host 缓存 → 只读路由 → 左栏卡 + 生成后刷新），代码缺口 0，剩桌面验收。下面 §P3「积分落地清单」保留**开工前核对出的四处文档偏差**，那是这次真正省时间的地方。


---

## P1 · Host 管理协议客户端 + 设备标识

**目标**：Host 侧具备三个管理接口的调用能力与稳定设备身份。不接 UI、不接网关。

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `canvas-studio/src/drama-management.ts` | 纯协议客户端：`sync(token, device)` / `listTextModels(token)` / `creditBalance(token)`；`ApiError {code, status, retryAfterSeconds}` + 错误信封解析。平移改造 `reelsbuddy-desktop/src/host/business/drama-client.ts`（~130 行，`fetchImpl` 注入保可测）；`name` 字段改 `VideoBuddy Desktop`；日志纪律同 `auth-session.ts`（token 绝不进日志） |
| 新增 | `canvas-studio/src/device-registry.ts` | 稳定 `device_id`：`$DSH_HOME/canvas-studio/device.json`（`dshHomePath('canvas-studio')`，UUID v4，0600，损坏时重生成）。平移 `reelsbuddy-desktop/src/host/business/device.ts`。**注意：路径固定在 DSH_HOME，不随设置页 `assetDir` 换库迁移**（设备身份 ≠ 资产库位置） |
| 修改 | `canvas-studio/src/host-config.ts` | `CanvasStudioConfig` 增加字段 `businessApiBase: string`（`DEFAULT_BUSINESS_API_BASE = 'http://117.50.108.73'`，默认即生效，同 `DEFAULT_SUPABASE_URL` 模式）；**清空 = 管理面整体降级关闭**（同 `supabaseUrl` 空 = 隐藏登录的既有语义） |
| 修改 | `canvas-studio/src/index.ts` | 读取 `businessApiBase` 传给 account-state（P2 接线点，本阶段先落配置面） |
| 新增测试 | `canvas-studio/tests/drama-management.test.mjs` | 错误信封解析（400/401/403/429/503 → code 映射）、`Retry-After` 解析、成功响应形状（`user.id` 缺失 → `invalid_response`）、device body 组装 |
| 新增测试 | `canvas-studio/tests/device-registry.test.mjs` | 首次生成并落盘、二次读取复用、损坏文件重生成、权限位 |

**纪律**：可单测纯函数放 `src/*.ts`（Host 侧，AGENTS.md 编码约束）；token 只进请求头。

---

## P2 · 登录 bootstrap（auth/sync 触发编排）

**目标**：client 推送会话后，Host 幂等完成业务用户同步 + 设备登记，并预热目录/余额缓存。失败不阻塞现有登录闭环。

> **现状（2026-10-23）**：下表「目录缓存 / 回调 / 幂等 / 错误策略」已全部落地；**`refreshBalance()` 与 credits TTL 缓存未实现**（`creditBalance()` 无调用方）。该项归到 P3 的积分清单一起做 —— 单独一个「取余额但没人用」的 Host 方法是死代码。

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `canvas-studio/src/account-state.ts` | Host 侧缓存与编排：`bootstrap()`（auth/sync，带 device 全量信息）、`refreshCatalog()`、`refreshBalance()`；TTL 缓存（建议 models 5min / credits 30s）；`onCatalogChanged` 回调（P4 网关消费）；启用闸 = `businessApiBase` 非空 && `supabaseUrl` 非空（`syncDramaAuthRequired` 同款联动模式，见 `index.ts:153-163`） |
| 修改 | `canvas-studio/src/routes.ts` | `ROUTE_AUTH` prefix handler（`routes.ts:3286`）内：`setAuthSession(...)` 成功后 fire-and-forget `accountState.bootstrap()`（去重：进行中不重复发）；`clearAuthSession(...)` 处同步 `accountState.reset()` |
| 修改 | `canvas-studio/src/index.ts` | 装配 `account-state`（live 读设置：`businessApiBase`/`supabaseUrl` 变更即时生效，`installSettingsSection` 的 `onChange` 里同步开关，先于回调触发的 TDZ 纪律同 `syncDramaAuthRequired`） |
| 新增测试 | `canvas-studio/tests/account-state.test.mjs` | bootstrap 幂等（同会话只发一次）、401 静默不重试、429 按 `Retry-After` 推迟、未启用闸时零请求、reset 语义 |

**错误策略**（对齐 api(10).md §6）：`401` 静默（client 会刷 token 重推）；`403` 记日志 + 置禁用态（UI P3 展示）；`429/503` 退避；`500` 记日志不重试。bootstrap 失败不回滚登录态。

---

## P3 · client 只读路由 + UI 展示

> **现状（2026-10-23）**：**积分部分已落 CV-358**（只读路由 + 左栏卡 + 生成后刷新）；`session` / `models` 两条路由与业务用户展示**仍未开工、未取号**（开工前按 STATUS §4.1 水位复核）。
>
> **开工前按代码核对，本节原设计有四处与实际不符**（照抄会做错，已按实测修正）：
>
> | # | 原文 | 实际 | 修正 |
> | --- | --- | --- | --- |
> | 1 | 「顶栏额度 chip」 | 画布没有顶栏；左栏底部已有 `.csCredits` 占位卡（REQ-030 ③） | 就地升级该卡，卡体抽 `CreditsCard.tsx` |
> | 2 | 展示 `available / frozen`（沿用 `0 / 1,000`） | `/v1/credits/balance` **无总额度字段** | 改成「可用 + 冻结行」，不自造分母 |
> | 3 | 生成结算后刷一次，挂 `callDrama` 的 finally | 那一步只是**释放出队槽位**，服务端未结清 | 挂 client `pollGenerationQueue` 里 `queuePollNeeded()` 转 false（+ 6s 复检） |
> | 4 | （未提）用生成队列状态当忙碌判据 | `generationQueueStateOf` 在「有 active、无 waiting」时返回 `null` | 不得用 `store.generationQueue` 判忙碌，用 `queuePollNeeded()` |

**目标**：画布 UI 可见登录用户、设备、模型目录、积分余额。

### 积分落地清单（回答「积分什么时候能更新」）

数据源已就绪（`DramaClient.creditBalance(token)`，CV-355），缺的是从 Host 到眼睛的三层管道：

| # | 层 | 落点 | 要点 |
| --- | --- | --- | --- |
| 1 | Host 缓存 | `src/account-state.ts` 补 `refreshBalance(force)` | 复用现有单例与 deps 注入；`creditBalance` TTL **30s**（方案 §P2 原口径）；`401` 静默、`403` 沿用同一禁用态、`429/503` **不写退避**（余额是主动刷新语义，等下次用户操作即可）；bootstrap 成功后**顺手预取一次**（失败只记日志） |
| 2 | 只读路由 | `src/routes.ts` 新增 `GET /canvas-studio/account/credits` | 校验沿用 `storage-info` 的 loopback authority + same-origin；返回 `{ available_balance, frozen_balance, currency, fetchedAt, disabled?, stale? }`；`?refresh=1` 绕 TTL（**仍受「一次只发一个请求」去重**，防连点打满 600/min）；未启用闸时返回降级体（`enabled:false`，不抛） |
| 3 | UI | `src/client/api.ts` + `StudioFrame.tsx` 顶栏 chip | 金额固定 **4 位小数**，`parseInt` 一律禁止（方案 §0.3）；`available` / `frozen` 两个数；403 禁用态显示「账号受限」而不是数字 |

**「何时更新」= 四个触发点**（前三个必须在同一批做，否则用户只能靠刷新页面）：

1. 登录 bootstrap 成功后预取；
2. chip 挂载 / 画布页重新可见时（TTL 内复用缓存，过期才发请求）；
3. 用户点 chip 或下拉刷新 → `?refresh=1` 强制刷新；
4. **生成结算后主动刷一次** —— 挂到生成队列释放处（`callDrama` 的 `finally` 之后、任务终态推送点）。这是「扣完费立刻看到新余额」的唯一手段；缺这条，积分会一直显示上一次登录时的数字。

**验收口径**：登录后卡片出现且与 `GET /v1/credits/balance` 一致；跑一次生成 → 数字下降（不必等 TTL）；断网/503 时卡片保留旧值并标灰，不显示 0。

**落地（CV-358，2026-10-23）**：①`src/account-state.ts` 的 `refreshCredits(force)` / `creditsView()` / `markCreditsStale()`（30s TTL、不抛错、**不写退避窗口**、在飞去重；**token 从 `auth-session` 现取而非另存一份** —— 抄一份会在「退避窗口内 / 幂等命中」两个提前 return 的分支漏更新，拿旧 token 换 401）；②`routes.ts` 的 `GET /canvas-studio/account/credits`（`requestAllowed` 守卫、`?refresh=1` 绕 TTL、未登录/未启用返 **200 降级体**、读失败保留旧值不 500）；③`CreditsCard.tsx`（七态）+ `credits-store.ts`（空闲即刷 + 6s 复检，连续生成不叠计时器）+ `formatCredits`（固定 4 位小数、不抹零）；④Host 侧 `generate-queue` 槽位释放置陈旧、client 侧队列空闲强刷 —— 两条互补，缺前一条会「生成后 30s 内切项目看到扣费前的数字」。

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 修改 | `canvas-studio/src/routes.ts` | 新增 3 条只读 exact 路由：`GET /canvas-studio/account/session`（业务用户 + 设备）、`GET /canvas-studio/account/models`（text 目录缓存）、`GET /canvas-studio/account/credits`（余额缓存）。校验沿用本文件既有 loopback authority + same-origin 模式（同 `storage-info` 路由）；`?refresh=1` 绕 TTL 强刷（限流 600/分宽裕，仍只在用户主动刷新时透传） |
| 修改 | `canvas-studio/src/client/api.ts` | account 三接口的 fetch 封装（返回错误按 `error.code` 结构化，403/401 有区分文案） |
| 修改 | `canvas-studio/src/client/StudioFrame.tsx` | 登录态区扩展：业务用户（display_name/avatar）+ 禁用提示；顶栏额度 chip（`available_balance` / `frozen_balance`，保留 4 位小数格式化，不 parseInt） |
| 修改 | `canvas-studio/tsconfig.client.json` | 若 client 引用新根级类型模块（account 形状类型），显式追加 include（AGENTS.md 踩坑表） |
| 新增测试 | `canvas-studio/tests/account-routes.test.mjs` | authority 拒绝路径、缓存形状、`refresh=1` 语义、未启用闸时路由返回降级体 |

UI 落点细节（chip 具体挂哪个槽位）实施时与现有登录入口布局对齐，不在本计划锁定。

---

## P4 · DSH LLM 网关（先 spike，后实施）

**目标**：`/v1/models?modality=text` 目录驱动 profile 的 `llm-pi-ai` provider 行，DramaServer text 模型进官方模型选择器；JWT 经 credentials 服务轮换，不重启。

### 4.0 Spike（先行，结论回填本节）

> **已关闭（2026-10-22）**：三 seam 在 0.2.1-rc.2 上实测全部存在，结论见 [§0.4](#04-重新评估2026-10-22dsh-021-rc2-已就位) 表格；下方「缺失即升级」的分支未触发。保留原文作历史记录。

验证我们 pin 的 DSH（`0.1.x-rc` 线，canvas-studio `package.json`：dsh-agent `0.1.1-rc.2` / 基建 `0.1.0-rc.7`）是否具备三 seam：

1. `ctx.get('configEditor')` 存在且可写 profile 用户层（reelsbuddy 侧是 `0.2.1-rc.2` 的 `ctx.configEditor`）；
2. `ctx.credentials` 具备 `.set(name, value)`（我们现只用了 `.resolve(credentialRef(...))`，见 `index.ts:93-105`）；
3. `llm-pi-ai` 行级热重放：仅重启变化的 provider 行，用户 Models 页新增 provider 不被遮蔽。

**任一缺失 → 升级 DSH**（已拍板）：
- 迁移清单参考 [harness-upgrade-feasibility.md](./harness-upgrade-feasibility.md)（唯一硬伤：`conversationEvents` → `uiConversation`，共 3 处调用点；其余依赖面核对表现成）；
- 目标版本对齐 reelsbuddy 钉版策略（`0.2.1-rc.2` 家族 / cordis `4.0.5`，ADR-0002 D5）；
- 遵守根仓库 AGENTS.md：submodule pin 更新与桌面行为变更**分开提交**；升级先过根 `corepack yarn check` 再继续 P4。

Spike 产物：一次性探针脚本（不入 `src/`），证据与结论回填本节。

### 4.1 实施

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `canvas-studio/src/gateway.ts` | 参考 `reelsbuddy-desktop/src/host/studio/gateway.ts`：`gatewayRow(catalog)`（目录 → provider 行）、指纹比较（目录无变化不写配置）、空目录 → 移除网关行（防已下线模型复活）；provider id `canvas-studio-gateway`，`apiKeyEnv: CANVAS_STUDIO_GATEWAY_TOKEN`（只写引用名，凭据值不入配置文件），`api: openai-completions`，`baseURL: <businessApiBase>/v1/llm`（默认即 `http://117.50.108.73/v1/llm`），`models: [...目录快照...]`；合并只改自己的行，用户配置不受影响 |
| 新增 | ~~`canvas-studio/src/gateway-catalog.ts`~~ → 并入 `gateway.ts` | **实施偏差**：目录缓存读写（`readGatewayCatalog` / `writeGatewayCatalog` / `gatewayCatalogPath`）没单开文件，直接放 `gateway.ts` —— 三处都是几行纯函数，另开文件只多一个 import 环的风险 |
| 修改 | `canvas-studio/src/index.ts` | **实施偏差（重要）**：落行**不是** `configEditor.edit`，而是 `settings.mutate`。原因：`settings.mutate` 底层走 `ConfigEditor.edit` 的 **profile 全量重放**，只要图里有任一无关 entry 激活失败（桌面壳的 `hmr` 缺 `--expose-internals` / `desktop-product-telemetry` 缺 `DSH_CLIENT_VERSION`），整批写入就被回滚 —— 网关行永远写不进去。`settings.mutate` 走 llm-pi-ai 用户层 volatile 写 + 热重注册，不做全量重放。装配面 = `applyGatewayConfig` / `reconcileGateway`（串行队列 + 指纹 + `unavailable` 不推进指纹）+ 启动期缓存恢复（延后 5s 且兜 catch，早触发会放大成 `fatal load failure`）；每次会话推送发布 `CANVAS_STUDIO_GATEWAY_TOKEN` |
| 新增测试 | `canvas-studio/tests/gateway.test.mjs` | 行生成、指纹（无变化不写）、空目录移除、凭据发布形状（credentialRef、空 token 不写）、无 configEditor 降级 |

### 4.2 待确认（阻塞验收，不阻塞编码）

1. **`/v1/llm` 契约文档**——api(10).md 未覆盖；reelsbuddy `scripts/live-e2e.mjs` 实测过 `/v1/llm/chat/completions`（模型 `deepseek-flash`），以它为基线与后端确认。
2. text 模型 `code` 与 `openai-completions` API 形态的兼容性（reelsbuddy 已验证一例，换模型需复核）。

~~3. `businessApiBase` 正式地址~~ —— **已确认（2026-10-20）**：`http://117.50.108.73`（80 端口），已写入 P1 默认值。

---

## 验证链与收尾

- 每阶段收口跑 canvas-studio 验证链（顺序铁律）：`corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke`。
- L6 真实端到端（不在 CI）：`DRAMA_ACCESS_TOKEN=<桌面登录的 access token> node scripts/live-e2e-management.mjs`（已备，未跑）—— 跑通 sync → models → balance → 一次 `/v1/llm/chat/completions`。
- 手工桌面验收：登录后模型选择器出现 DramaServer 模型（无需重启）；额度 chip 数值与后端一致；`auth/sync` 在服务端产生用户 + 设备记录（后端确认）。
- 收尾四步（AGENTS.md 强制）：`docs/STATUS.md` 终态 + 变更记录；`canvas-ux-backlog.md` 对应行；`docs/tracking.md` 派单映射（条目号分配后回填本方案占位号）；精确路径提交。

### 剩余清单（2026-10-23，按依赖顺序）

**A. LLM 一条线（桌面验收已通过 —— 用户 2026-10-23 反馈）**

下列步骤保留作**复验顺序**；L6 若尚未跑，建议补一次（它是 §4.2 两个契约待确认项的唯一覆盖手段）。

1. 用户终端启动桌面（受管 shell 起不了 Electron，见交接文档 §6-9/11），日志确认无 `did not activate`、出现「网关行已从目录缓存恢复」/「管理面 bootstrap 完成」。
2. 设置 → 模型：「DramaServer 官方模型」区块点亮；**期间保存任意一项** —— 窗口不得消失、`profiles/desktop/cordis.patch.yml` 出现 `llm-pi-ai.providers`。
3. 聊天模型选择器出现 DramaServer 组，选它发一句话拿到回复（这是「设为 LLM」的最终判据）。
4. L6 脚本一次（覆盖 §4.2 两个待确认：`/v1/llm` 契约、`openai-completions` 兼容性）。
5. 服务端确认设备记录 `name=VideoBuddy Desktop`。
6. 以上通过 → CV-355/356/357 状态改「已完成」，STATUS §0 水位与 `changelog.md` 同步。

**B. 积分一条线 —— 已落码（CV-358），只剩桌面验收**

1. ~~`account-state` 余额缓存 + TTL + bootstrap 预取~~ → `refreshCredits` / `creditsView` / `markCreditsStale` ✅
2. ~~`GET /canvas-studio/account/credits`（强刷 / 降级体 / 403）~~ ✅
3. ~~`client/api.ts` 封装 + 左栏卡（4 位小数 / 可用 + 冻结 / 失败留旧值）~~ → `CreditsCard.tsx` ✅
4. ~~生成结算后刷新~~ → Host 置陈旧 + client 队列空闲强刷 + 6s 复检 ✅
5. ~~测试~~ → `account-state`（+7）/ `account-routes`（新 5）/ `account-format`（新 4），REQ-030 守卫改判据 ✅
6. ~~取号~~ → **CV-358** ✅
7. **待桌面验收**：登录后左栏四位小数余额与接口一致 → 跑一次生成看数字下降（不等 30s）→ 点卡强刷 → 断网/503 保留旧值标灰 → 登出后数字消失。

**C. 仍未开工（需要时才做）**：`GET /canvas-studio/account/session`（业务用户 + 设备）、`GET /canvas-studio/account/models`（目录缓存）与业务用户展示 —— 目前没有任何 UI 消费方，等「账号页」需求再取号。

## 风险清单

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 业务 API 走公网 http（80 端口） | Bearer JWT 明文过公网链路 | 短期可接受（JWT 短时效 + `error.code` 不泄露细节）；与后端确认 TLS/网关规划，长期切 https 后只改 `DEFAULT_BUSINESS_API_BASE` |
| DSH 缺 configEditor / credentials.set | P4 受阻 | Spike 前置；缺失即升级（迁移清单现成，3 处适配点） |
| `/v1/llm` 契约漂移 | 网关请求失败 | L6 live 用 reelsbuddy 同款脚本对拍；模型逐个复核 |
| 设备重复登记覆盖 | `auth/sync` 省略字段会被置空 | `device-registry` 每次发全量字段（device_id/name/platform/app_version） |
| 余额展示与扣费时差 | UI 数值滞后 | 仅展示语义（拍板 0.2-4）；生成结算后由 account-state 主动刷一次 credits |
