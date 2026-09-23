# Canvas Studio 统一错误处理系统

> 状态：已落地核心实现（`src/error-system.ts` + `src/errors/catalog.ts` + `tests/error-system.test.mjs`，9/9 测试通过）。
> 本文是**系统定义 + 后续开发约束**，所有新增/改动错误处理代码必须遵守 §6。

---

## 1. 背景与需求映射

用户反馈的核心痛点：

| 用户原话 | 系统要解决的 |
|---|---|
| 有些错误用户根本看不懂，看到也不知道怎么办 | **受众分层**：开发期/诊断类错误不展示给用户，只在开发模式落到日志 |
| 有些错误 AI 能自己恢复 | **可恢复性分层**：`auto` 类错误静默处理，不报用户 |
| 把错误处理收敛起来对本项目有利 | **结构化 + 注册表**：所有错误统一为 `CanvasStudioError`，集中登记，下游不再靠字符串匹配 |

结论：**错误≠都要给用户看**。按「谁必须知道」与「能否自行恢复」两个轴重新分层，是收敛的关键。

---

## 2. 两个轴 + 一个等级

### 2.1 受众轴 `ErrorAudience`（决定「给谁看」）

| 值 | 含义 | 生产环境默认 |
|---|---|---|
| `user` | 终端用户必须知情（能看懂、知道怎么办） | 展示 |
| `agent` | AI 需知情以自主恢复（不一定展示给人） | 经对话回显给 AI |
| `developer` | 仅开发/排障有用（用户看不懂也无从下手） | **隐藏**，仅日志 |

可多选。例：`['user','agent']` = 用户看到提示，AI 同时拿到细节用于重试。

### 2.2 可恢复性轴 `ErrorRecoverability`（决定「怎么处理」）

| 值 | 含义 | 是否展示给用户 |
|---|---|---|
| `auto` | AI 可自行重试/换路恢复 | **永不** |
| `guided` | 需用户或 AI 按 `recoveryHint` 重试 | 是（按 channel） |
| `fatal` | 需人工介入（配置/权限/数据损坏） | 是（脱敏后） |

### 2.3 严重等级 `ErrorSeverity`

- **S1** 阻塞/数据风险：任务无法继续，或可能产生错误数据（需立即干预）。
- **S2** 可恢复失败：本次失败但可重试/换路。
- **S3** 提示/信息：非失败，仅告知（降级生效、参数被忽略）。

---

## 3. 统一错误类型 `CanvasStudioError`

见 `src/error-system.ts`。每个错误实例携带结构化字段，下游按字段路由，**不再解析字符串**：

```ts
class CanvasStudioError extends Error {
  code: string                 // CS-GEN-204
  severity: ErrorSeverity      // S1|S2|S3
  audience: ErrorAudience[]    // ['user','agent']
  recoverability: ErrorRecoverability
  channel: ErrorChannel        // 首选展示面
  userMessage: string          // 脱敏后的用户文案（{var} 已渲染）
  devMessage?: string          // 原始诊断（仅开发期）
  recoveryHint?: string
  recoverableBy: 'ai'|'user'|'none'
}
```

关键 API：

- `registerError(spec)` —— 登记一条错误规格（重复码/自相矛盾**注册即抛错**）。
- `throwError(code, params)` —— 按已注册码抛出（未注册直接报错，防止漏登）。
- `asCanvasError(e)` —— 工具边界兜底，把遗留裸 `Error` 收敛为 `CS-UNC-000`（仅 `agent`+`developer` 受众，不骚扰用户）。
- `routeError(err, { devMode })` —— 纯函数，返回处置动作（见 §4）。
- `sanitizeForUser(raw)` —— 抹掉 IPv4/IPv6/URL/绝对路径/stack 痕迹，供「透传原始错误」前的最后清洗。
- `setDevMode()` / `isDevMode()` —— 开发模式开关（Host/Client 入口各设一次）。
- `toJSON()` / `fromJSON()` —— 跨进程序列化（Host→Client 经 `tool/result` 或会话事件传递）。

---

## 4. 路由决策矩阵 `routeError()`

所有可能的错误，经 `routeError` 收敛为三类处置：

| 条件 | devMode=false（生产） | devMode=true（开发） |
|---|---|---|
| `recoverability==='auto'` | `silent-retry`（静默，触发重试钩子） | `log-only`（记 dev 细节） |
| 受众**不含** `user`（仅 agent/developer） | `log-only`（用户无感知） | `log-only` |
| 需展示（含 `user`） | `surface` → 按 `channel` 展示，**不含** dev 细节 | `surface` → 按 `channel` 展示，**附 `[dev]` 细节** |

> 即：**只有「含 `user` 受众 且 非 `auto`」的错误，才会真正出现在用户眼前**；其余一律下沉到日志或静默重试。这正是「用户看不懂的错误不展示」的落地机制。

### 展示面 `ErrorChannel` → 实际 UI（D1–D5）

| channel | 落地 UI | 说明 |
|---|---|---|
| `conversation` | D1 agent 对话回显 | Host 工具把 `userMessage` 作为工具结果文本返回 |
| `node` | D2 画布节点错误态 | Client 把错误写回对应节点 `state:error` |
| `toast` | D4 非阻塞浮层 `.csToast-error` | Client 调用 toast 渲染（样式已就绪，待接实例化） |
| `effectTest` | D3 效果测试面板 | Client 效果测试流的错误槽 |
| `log` | D5 日志 | `ctx.logger.warn` / `console.warn`（开发期） |

> 注：当前 `.csToast-error` 样式已在 `client/styles.ts` 定义，但 JS 实例化点尚未接；接入时调用 `routeError` 返回的 `surface` 动作即可统一触发。

---

## 5. 错误码规范

**命名**：`CS-<MODULE>-<NN>`（全大写，Modules 与错误手册 A–K 对齐）。

| 前缀 | 模块 |
|---|---|
| `GEN` | 任务调度与超时 |
| `NET` | 生成后端通信 |
| `PROV` | 供应商层（fal/drama/registry/selection/capability/reference） |
| `USER` | 工具入参校验 |
| `H3IR` | H3 参考素材预检 |
| `REF` | 参考素材（抽帧/末帧/上限） |
| `COMP` | 成片合成 |
| `NODE` | 节点重试 |
| `EFFECT` | 效果测试 |
| `FFMPEG` | ffmpeg / 基础设施 |

**注册表 `src/errors/catalog.ts`** 是单一事实来源：每条错误显式声明 `code/severity/audience/recoverability/channel/userMessage/devMessage/recoveryHint`。self-registering——在 Host 入口与 Client 入口各 `import './errors/catalog.js'` 一次即生效。

---

## 6. 后续开发约束（硬性规则）

新增或修改任何错误处理代码，**必须**遵守：

1. **禁止裸抛**：凡要展示给「用户或 AI」的错误，必须用 `throwError(code, params)` 或 `new CanvasStudioError(spec, params)`；**不允许** `throw new Error('中文文案')`。历史遗留的裸抛，在工具边界用 `asCanvasError()` 兜底。
2. **先登记后使用**：任何新错误码先在 `catalog.ts` 登记；`throwError` 未注册会直接抛开发期错误。
3. **受众最小化**：用户看不懂/不会处理的错误，受众只写 `['developer']`（或 `['agent','developer']`），**绝不**写 `user`。它们会自动对用户隐藏。
4. **AI 能自恢复的写 `auto`**：`auto` 错误**不得**含 `user` 受众，路由会自动静默重试而不打扰用户。
5. **用户文案脱敏**：`userMessage` 不得含 stack、内网地址（`117.50.108.73:8082` 之类）、原始 provider blob、绝对路径。需要透传原始错误时，先过 `sanitizeForUser()`，且只放进 `devMessage`。
6. **文案风格统一**：建议三段式 `{prefix}：{reason}（{hint}）`，中文为主、术语保持一致。
7. **必填 `recoveryHint`**：`guided`/`fatal` 错误必须给出「怎么办」，否则等于只报错不解决。
8. **一致性自校验**：`registerError` 会拒绝——
   - `audience` 为空；
   - `auto` 却含 `user`；
   - 含 `user` 却把 `channel` 设为 `log`。
9. **登记即测试**：每条新码在 `tests/error-system.test.mjs` 补一条「路由断言」（验证其 `kind` 符合预期：auto→silent-retry / 仅 developer→log-only / 含 user→surface）。
10. **跨进程传递靠框架的 `error.info`，不靠 `toJSON`**：Host 工具抛出的错误经 dsh 的 `tools/execute` 管线，框架只把 `HarnessError` 转成 `result.error.info = { name, code }`，其余异常被降级成纯文本。所以「码要跨到 Client」必须走 **`src/tool-error-boundary.ts`** 的两半配合（见 §9.1）——**不要**指望 `instanceof HarnessError`：`canvas-studio` 与 `dsh-plugin-desktop` 各有一份独立的 `@deepseek-ai/dsh-llm` 实体，跨副本 `instanceof` 恒为 false。

**自检清单**（PR 前逐项确认）：
- [ ] 新错误有 `code` 且已登记？
- [ ] `audience` 是否最小化（能不给用户看的就不给）？
- [ ] `auto` 错误是否真的实现了自动恢复路径？
- [ ] `userMessage` 是否零敏感信息？
- [ ] `recoveryHint` 是否可执行？
- [ ] 是否补了路由测试？

---

## 7. 迁移策略（历史 110+ 错误分批收敛）

收敛按模块分批，**不改外部行为，只换表达方式**。

**阶段一（框架就绪）——✅ 已完成**：`error-system.ts` + `catalog.ts`（登记代表样例）+ 测试。

**阶段二（逐模块迁移）——✅ 已完成**：按错误手册 A–K 顺序，把裸抛改为 `throwError(code)`，把「仅开发期有用」的 `logger.warn` 改为登记的 `developer` 受众错误。实际落点：

| 序 | 模块 | 覆盖的域 |
|---|---|---|
| 1 | `generate.ts` / `long-request.ts` | 超时域（后端超时 / 上传超时 / 生成响应失败 / video2vl） |
| 2 | `providers/*` | fal / drama / registry 供应商报错 |
| 3 | `host-tools.ts` | 工具入参校验 |
| 4 | `compose.ts` / `video-style.ts` / `video-frames.ts` / `waveform-host.ts` | 合成 / 参考素材 / 波形 |
| 5 | `projects.ts` / `routes.ts` / `client/api.ts` | 项目 / 路由 / 客户端 API |
| 6 | `h3-ir-validate.ts` / `ffmpeg-run.ts` | 预检 / 基础设施 |

**阶段三（边界收敛，随阶段二同步做）——✅ 已完成**：

1. **Host 工具边界**统一走 `tools/execute` 中间件注入码（§9.1），Client 侧 D2 节点错误态**按受众决定画不画红标**（`asset-capture.ts` 过 `codeIsUserFacing`）。
2. **HTTP 路由层**统一 `sendRouteFailure()`：需展示的用 catalog 的 `userMessage`，其余落日志 + 中性中文兜底，**响应体一律带 `code`**（收敛了此前 20 处把内部串直接当用户文案透传的点）。
3. **devMode 白名单化**：旧判定按 `NODE_ENV !== 'production'`，而桌面端**从不设 `NODE_ENV`** ⇒ 打包后恒为开发模式，`[dev]` 诊断行会直接露给用户。现改为白名单（§8）。

**尚未收敛的小尾巴**：手册 A–K 各节条目的「引用 `code` 回填」。阶段二已把**产生路径**改完（新产生的错误都带码），历史条目文本不逐条回填 —— 与项目「只修产生数据的路径、不动存量」的约定一致。

---

## 8. 扩展指引

- **新增模块**：在 `catalog.ts` 加 `CS-<NEW>-NN` 条目，MODULE 表同步更新本文件 §5。
- **新增展示面**：扩展 `ErrorChannel` 联合类型 + `routeError` 的 `surface` 分支 + 对应 Client 渲染；不要散落在各处硬编码。
- **新增等级/受众/可恢复性值**：属中枢变更，必须同步本文件与 `error-system.ts` 的校验逻辑，并补测试。
- **声明 UI 三级处置**：三态错误卡的分级用 `CanvasErrorSpec.uiKind`（`retryable` / `config` / `unreachable`），**省略即 `retryable`**。它只在「重试必然复发（要去改配置）」或「服务确实连不上」时才需要显式声明。
  - ⚠️ 该字段定义在 `error-system.ts` 而**不是** `error-kind.ts` —— 它是**错误规格的一部分**（登记时声明），放 `error-kind.ts` 会形成 `error-system → error-kind` 循环依赖。`StudioErrorKind` 是它的类型别名，无第二份定义。
- **devMode 探测**：**白名单**，不是黑名单。
  - Host 侧：`resolveDevModeFromProcess()` —— `CANVAS_STUDIO_DEV_MODE === '1' || NODE_ENV === 'development'` 才算开发模式。**不要**写回 `NODE_ENV !== 'production'`。
  - Client 侧：入口显式 `setDevMode(resolveDevModeFromProcess())`。

---

## 9. 接入点（落地清单）

| 接入点 | 位置 | 职责 |
|---|---|---|
| 错误码注册 | Host / Client 入口各 `import '../errors/catalog.js'` 一次 | 让全部码生效（自注册） |
| devMode 初始化 | 两个入口的 `apply` 开头 `setDevMode(resolveDevModeFromProcess())` | 桌面默认**非**开发模式 |
| Host 工具边界 | `src/index.ts`：`createStudioTools(...).map(wrapStudioToolDefinition)` + `registerStudioToolErrorBoundary(ctx)` | 码跨进程注入（§9.1） |
| Client 节点错误态（D2） | `src/asset-capture.ts` `update` 分支 | 用 `codeIsUserFacing(code)` 决定**是否**画红标 |
| Client 效果测试（D3） | `src/client/index.ts` catch → `asCanvasError` + `routeError` | 非 surface 落 `ctx.logger.warn` |
| HTTP 路由 | `src/routes.ts` `sendRouteFailure()` | 需展示用 `userMessage`；其余落日志 + 中性兜底；**响应体带 `code`** |
| 项目列表错误卡 | `project-store.ts` `errorCode` → `ProjectList` → `StudioErrorState` | `classifyStudioFailure(code, message)` 定三级处置 |

### 9.1 错误码如何跨进程（唯一可靠通道）

框架的 `tool/result` 事件只对 **`HarnessError`** 填 `error.info = { name, code }`（`agent-loop/src/tool-calls.ts`），其余异常一律降级成 `content[0].content[0].text`。而 `tools/execute` **中间件看不到原始异常**（拿到的是已降级的结果）。所以需要**两半配合**，实现全在 `src/tool-error-boundary.ts`：

| 半 | 函数 | 做什么 |
|---|---|---|
| 包装侧 | `wrapStudioToolDefinition(def)` | 包住 `execute`；成功透传，失败时把 `CanvasStudioError` 用 `WeakMap` 暂存到该次执行结果对象上，再原样抛出 |
| 中间件侧 | `registerStudioToolErrorBoundary(ctx)` | 在 `tools/execute` 上取回暂存项，调 `decorateStudioToolResult()` 把 `{ name: 'CanvasStudioError', code }` 写进 `result.error.info` |

`decorateStudioToolResult` 有**两条不写规则**（都别删）：

1. **非失败结果原样返回** —— 不许给成功结果贴错误码。
2. **已有 `result.error.info` 原样返回** —— 框架自己的 `TOOL_ABORTED` / `TOOL_TIMEOUT` **优先**，不许被业务码覆盖。

Client 侧读取的是 `data.message.content`（文本）与 `data.error.code`（结构化码）；`data.message.source.callId` 用于关联。**注意**：旧实现读的 `data.error.message` 字段**不存在**，文案其实一直藏在 `tool-result` 层内。

---

## 10. 附录：已登记错误码（catalog 现状）

**共 54 条**（阶段二全量迁移完成后的实测值；`tests/error-system-guards.test.mjs` 会遍历全部条目逐条断言元数据完整性与路由自洽）。

**按模块统计**：`PROV` 13 · `NET` 11 · `H3IR` 5 · `GEN` 4 · `EFFECT` 4 · `REF` 3 · `NODE` 3 · `USER`(含 `PARAM`/`USER-ERR`) 2 · `COMP` 2 · `CLIENT` 2 · `UNC`/`FFMPEG`/`DEV`/`PROJ`/`PARAM` 各 1。

**按受众统计**：用户可见（含 `user` 且非 `auto`）**35 条** · 对用户完全隐藏 **19 条**（只进日志或静默重试）。

### 10.1 全部条目

`uiKind` 列即三态错误卡的分级（省略 = `retryable`）。

| code | module | severity | audience | recoverability | channel | uiKind |
|---|---|---|---|---|---|---|
| `CS-CLIENT-002` | CLIENT | S2 | user, agent | guided | toast | retryable |
| `CS-CLIENT-ERR` | CLIENT | S2 | user, agent | guided | toast | retryable |
| `CS-COMP-001` | COMP | S2 | user | guided | toast | retryable |
| `CS-COMP-002` | COMP | S2 | user, agent | guided | node | retryable |
| `CS-DEV-ERR` | DEV | S1 | developer | fatal | log | retryable |
| `CS-EFFECT-001` | EFFECT | S2 | agent | guided | effectTest | retryable |
| `CS-EFFECT-002` | EFFECT | S2 | user, agent | guided | effectTest | retryable |
| `CS-EFFECT-003` | EFFECT | S2 | user, agent | guided | effectTest | retryable |
| `CS-EFFECT-004` | EFFECT | S2 | user, agent | guided | effectTest | retryable |
| `CS-FFMPEG-001` | FFMPEG | S1 | developer | fatal | log | retryable |
| `CS-GEN-204` | GEN | S2 | user, agent | guided | conversation | **unreachable** |
| `CS-GEN-205` | GEN | S2 | user, agent | guided | conversation | retryable |
| `CS-GEN-206` | GEN | S2 | user, agent | guided | conversation | retryable |
| `CS-GEN-208` | GEN | S2 | user, agent | guided | conversation | retryable |
| `CS-H3IR-001` | H3IR | S2 | user, agent | guided | conversation | retryable |
| `CS-H3IR-002` | H3IR | S2 | user, agent | guided | conversation | retryable |
| `CS-H3IR-003` | H3IR | S2 | user, agent | guided | conversation | retryable |
| `CS-H3IR-004` | H3IR | S2 | user, agent | guided | conversation | retryable |
| `CS-H3IR-005` | H3IR | S2 | user, agent | guided | conversation | retryable |
| `CS-NET-001` | NET | S2 | agent, developer | guided | conversation | retryable |
| `CS-NET-002` | NET | S3 | developer | auto | log | retryable |
| `CS-NET-003` | NET | S2 | agent, developer | guided | conversation | retryable |
| `CS-NET-004` | NET | S1 | developer | fatal | log | retryable |
| `CS-NET-005` | NET | S2 | agent, developer | guided | conversation | retryable |
| `CS-NET-006` | NET | S1 | developer | fatal | log | retryable |
| `CS-NET-007` | NET | S2 | user, agent | guided | conversation | retryable |
| `CS-NET-008` | NET | S2 | user, agent | guided | conversation | retryable |
| `CS-NET-009` | NET | S2 | agent, developer | fatal | log | retryable |
| `CS-NET-010` | NET | S1 | developer | fatal | log | retryable |
| `CS-NET-011` | NET | S2 | agent, developer | fatal | log | retryable |
| `CS-NODE-001` | NODE | S2 | user | guided | node | retryable |
| `CS-NODE-002` | NODE | S2 | user, agent | guided | node | retryable |
| `CS-NODE-003` | NODE | S2 | user, agent | guided | node | retryable |
| `CS-PARAM-001` | USER | S2 | user, agent | guided | conversation | retryable |
| `CS-PROJ-001` | PROJ | S2 | user, agent | guided | conversation | retryable |
| `CS-PROV-001` | PROV | S1 | user, developer | fatal | node | **config** |
| `CS-PROV-002` | PROV | S2 | agent, developer | guided | conversation | retryable |
| `CS-PROV-003` | PROV | S1 | developer | fatal | log | retryable |
| `CS-PROV-004` | PROV | S2 | agent, developer | guided | conversation | retryable |
| `CS-PROV-005` | PROV | S2 | agent, developer | guided | conversation | retryable |
| `CS-PROV-006` | PROV | S2 | agent, developer | guided | conversation | retryable |
| `CS-PROV-007` | PROV | S2 | user, agent | guided | conversation | retryable |
| `CS-PROV-008` | PROV | S2 | agent, developer | guided | conversation | retryable |
| `CS-PROV-009` | PROV | S2 | user, agent | guided | conversation | retryable |
| `CS-PROV-010` | PROV | S2 | user, agent | guided | conversation | retryable |
| `CS-PROV-011` | PROV | S2 | user, agent | guided | conversation | **config** |
| `CS-PROV-012` | PROV | S2 | user, agent | guided | conversation | **config** |
| `CS-PROV-014` | PROV | S2 | user, agent | guided | conversation | retryable |
| `CS-REF-001` | REF | S2 | user, agent | guided | conversation | retryable |
| `CS-REF-003` | REF | S2 | user, agent | guided | conversation | retryable |
| `CS-REF-004` | REF | S2 | user, agent | guided | conversation | retryable |
| `CS-UNC-000` | uncaught | S2 | agent, developer | guided | log | retryable |
| `CS-USER-001` | USER | S2 | user, agent | guided | conversation | retryable |
| `CS-USER-ERR` | USER | S2 | user, agent | guided | conversation | retryable |

> **如何再生成这张表**：`catalog.ts` 是唯一事实来源，本表只是快照。改完 catalog 后重建并跑
> `node -e "Promise.all([import('./lib/errors/catalog.js'),import('./lib/error-system.js')]).then(([,es])=>es.listErrorSpecs().forEach(s=>console.log(s.code,s.module,s.severity,s.audience.join('|'),s.recoverability,s.channel,s.uiKind??'retryable')))"`
> 核对差异。
>
> **受众口径**：只有「含 `user` **且** `recoverability !== 'auto'`」才会送到用户眼前（记作「用户可见」）。`CS-NET-002` 虽含自动恢复语义但受众是 `developer`，仍走 `log`。

### 10.2 三条「命名空间逃生码」

| code | 用途 | 为什么存在 |
|---|---|---|
| `CS-USER-ERR` | HTTP 路由层入参/契约错误 | 前端有可能在码尚未登记的新路由上失败，需要一个**通用**用户可见码兜底，而不是退化成英文内部串 |
| `CS-CLIENT-ERR` | Client 侧未登记的裸异常 | 与上一条对称，覆盖「Host 已发布、Client 还没跟上」的窗口期 |
| `CS-DEV-ERR` | 开发期未捕获兜底 | 受众只有 `developer`、`channel: log`，**天然对用户隐身**，可安全兜住一切意外 |
| `CS-UNC-000` | 工具边界收敛遗留裸异常（`asCanvasError`）与反序列化兜底（`fromJSON`） | 受众 `agent, developer` / `channel: log` —— 未收敛的内部异常**不该惊动用户**，但仍要能被 agent 与日志看见 |

> ⚠️ **`CS-UNC-000` 的注册位置有讲究（2026-09-23 修）**：它的规格常量定义在 `error-system.ts` 内部，**曾经只当常量用、没进注册表** —— 于是实例侧 `routeError` 读规格判 `log-only`，而码字符串侧 `codeIsUserFacing()` 走「未登记按展示处理」的 fail-open 分支判 `true`，**同一个码在边界两侧结论相反**（跨进程时 Client 手里只有码字符串，拿不到实例）⇒ 未收敛的内部异常会在客户端画出红标。
> 现在它在 `error-system.ts` 内**自注册**（而非放进 `catalog.ts`）——`asCanvasError` 的调用方未必 import 过 catalog，自注册才能保证这个码在任何入口下都可查。`tests/error-system-guards.test.mjs` 有专门一条守着「系统自造的兜底码必须已登记 + 实例侧与码侧结论一致」，已做反向变异验证。
