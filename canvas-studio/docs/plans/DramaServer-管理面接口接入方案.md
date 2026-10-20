# DramaServer 管理面接口接入方案（auth/sync · models · credits/balance）

> 状态：方案待评审（未开工）
> 日期：2026-10-20
> 接口来源：《DramaServer 业务 API》（api(10).md，2026-10-19 版）：`POST /v1/auth/sync`、`GET /v1/models`、`GET /v1/credits/balance`
> 参考实现：`/Users/wl/Desktop/job/reelsbuddy-desktop`（ADR-0002 已在 DSH 体系完整落地同一套接口）
> 条目号：待分配（写号前按 AGENTS.md 先 grep `docs/`；下文以 **CV-DMA-*** 占位）

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

| 动作 | 文件 | 说明 |
| --- | --- | --- |
| 新增 | `canvas-studio/src/account-state.ts` | Host 侧缓存与编排：`bootstrap()`（auth/sync，带 device 全量信息）、`refreshCatalog()`、`refreshBalance()`；TTL 缓存（建议 models 5min / credits 30s）；`onCatalogChanged` 回调（P4 网关消费）；启用闸 = `businessApiBase` 非空 && `supabaseUrl` 非空（`syncDramaAuthRequired` 同款联动模式，见 `index.ts:153-163`） |
| 修改 | `canvas-studio/src/routes.ts` | `ROUTE_AUTH` prefix handler（`routes.ts:3286`）内：`setAuthSession(...)` 成功后 fire-and-forget `accountState.bootstrap()`（去重：进行中不重复发）；`clearAuthSession(...)` 处同步 `accountState.reset()` |
| 修改 | `canvas-studio/src/index.ts` | 装配 `account-state`（live 读设置：`businessApiBase`/`supabaseUrl` 变更即时生效，`installSettingsSection` 的 `onChange` 里同步开关，先于回调触发的 TDZ 纪律同 `syncDramaAuthRequired`） |
| 新增测试 | `canvas-studio/tests/account-state.test.mjs` | bootstrap 幂等（同会话只发一次）、401 静默不重试、429 按 `Retry-After` 推迟、未启用闸时零请求、reset 语义 |

**错误策略**（对齐 api(10).md §6）：`401` 静默（client 会刷 token 重推）；`403` 记日志 + 置禁用态（UI P3 展示）；`429/503` 退避；`500` 记日志不重试。bootstrap 失败不回滚登录态。

---

## P3 · client 只读路由 + UI 展示

**目标**：画布 UI 可见登录用户、设备、模型目录、积分余额。

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
| 新增 | `canvas-studio/src/gateway-catalog.ts` | 目录缓存读写：`$DSH_HOME/canvas-studio/gateway-catalog.json`（`account-state.refreshCatalog()` 成功后落盘） |
| 修改 | `canvas-studio/src/index.ts` | 可选接入 `configEditor`（`ctx.get('configEditor')`，缺失时记日志降级，同 reelsbuddy `unavailable` 状态，其余链路照常）；`accountState.onCatalogChanged → reconcileGateway`（configEditor.edit 合并进 profile 用户层 + 热重放）；每次会话推送（P2 钩子）刷新 `ctx.credentials.set('CANVAS_STUDIO_GATEWAY_TOKEN', <access token>)` |
| 新增测试 | `canvas-studio/tests/gateway.test.mjs` | 行生成、指纹（无变化不写）、空目录移除、凭据发布形状（credentialRef、空 token 不写）、无 configEditor 降级 |

### 4.2 待确认（阻塞验收，不阻塞编码）

1. **`/v1/llm` 契约文档**——api(10).md 未覆盖；reelsbuddy `scripts/live-e2e.mjs` 实测过 `/v1/llm/chat/completions`（模型 `deepseek-flash`），以它为基线与后端确认。
2. text 模型 `code` 与 `openai-completions` API 形态的兼容性（reelsbuddy 已验证一例，换模型需复核）。

~~3. `businessApiBase` 正式地址~~ —— **已确认（2026-10-20）**：`http://117.50.108.73`（80 端口），已写入 P1 默认值。

---

## 验证链与收尾

- 每阶段收口跑 canvas-studio 验证链（顺序铁律）：`corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke`。
- L6 真实端到端（不在 CI）：参考 reelsbuddy `scripts/live-e2e.mjs`——真实 Supabase token 跑通 sync → models → balance → 一次 `/v1/llm/chat/completions`。
- 手工桌面验收：登录后模型选择器出现 DramaServer 模型（无需重启）；额度 chip 数值与后端一致；`auth/sync` 在服务端产生用户 + 设备记录（后端确认）。
- 收尾四步（AGENTS.md 强制）：`docs/STATUS.md` 终态 + 变更记录；`canvas-ux-backlog.md` 对应行；`docs/tracking.md` 派单映射（条目号分配后回填本方案占位号）；精确路径提交。

## 风险清单

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 业务 API 走公网 http（80 端口） | Bearer JWT 明文过公网链路 | 短期可接受（JWT 短时效 + `error.code` 不泄露细节）；与后端确认 TLS/网关规划，长期切 https 后只改 `DEFAULT_BUSINESS_API_BASE` |
| DSH 缺 configEditor / credentials.set | P4 受阻 | Spike 前置；缺失即升级（迁移清单现成，3 处适配点） |
| `/v1/llm` 契约漂移 | 网关请求失败 | L6 live 用 reelsbuddy 同款脚本对拍；模型逐个复核 |
| 设备重复登记覆盖 | `auth/sync` 省略字段会被置空 | `device-registry` 每次发全量字段（device_id/name/platform/app_version） |
| 余额展示与扣费时差 | UI 数值滞后 | 仅展示语义（拍板 0.2-4）；生成结算后由 account-state 主动刷一次 credits |
