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
10. **跨进程传递用 `toJSON`/`fromJSON`**：Host 抛出的错误若需到 Client 渲染，序列化后经会话事件传递，Client 用 `CanvasStudioError.fromJSON` 还原，保持结构化。

**自检清单**（PR 前逐项确认）：
- [ ] 新错误有 `code` 且已登记？
- [ ] `audience` 是否最小化（能不给用户看的就不给）？
- [ ] `auto` 错误是否真的实现了自动恢复路径？
- [ ] `userMessage` 是否零敏感信息？
- [ ] `recoveryHint` 是否可执行？
- [ ] 是否补了路由测试？

---

## 7. 迁移策略（历史 110+ 错误分批收敛）

当前 `src` 下仍有大量裸 `throw new Error(...)` 与 `ctx.logger.warn`。收敛按模块分批，**不改外部行为，只换表达方式**：

**阶段一（框架就绪，已做）**：`error-system.ts` + `catalog.ts`（登记代表样例）+ 测试。
**阶段二（逐模块迁移）**：按错误手册 A–K 顺序，每模块把裸抛改为 `throwError(code)`，把「仅开发期有用」的 `console.warn`/`logger.warn` 改为登记的 `developer`-受众 `auto`/`fatal` 错误。优先级：
1. `generate.ts` / `long-request.ts`（超时域，用户最常遇）—— 直接对应本系统的价值。
2. `providers/*`（fal/drama/registry）供应商报错。
3. `host-tools.ts` 工具入参校验。
4. `compose.ts` / `video-style.ts` / `video-frames.ts` / `waveform-host.ts`（合成/参考/波形）。
5. `projects.ts` / `routes.ts` / `client/api.ts`（项目/路由/API）。
6. `h3-ir-validate.ts` / `ffmpeg-run.ts`（预检/基础设施）。

每批迁移需同步更新错误手册 `docs/canvas-studio-error-handbook.md` 的条目，使其引用新 `code`。

---

## 8. 扩展指引

- **新增模块**：在 `catalog.ts` 加 `CS-<NEW>-NN` 条目，MODULE 表同步更新本文件 §5。
- **新增展示面**：扩展 `ErrorChannel` 联合类型 + `routeError` 的 `surface` 分支 + 对应 Client 渲染；不要散落在各处硬编码。
- **新增等级/受众/可恢复性值**：属中枢变更，必须同步本文件与 `error-system.ts` 的校验逻辑，并补测试。
- **devMode 探测**：Host 侧默认 `process.env.NODE_ENV!=='production'`；Client 侧在入口显式 `setDevMode(import.meta.env?.DEV ?? false)`（具体按客户端打包配置）。

---

## 9. 接入点（落地清单）

- **Host 工具边界**（`host-tools.ts`）：`execute` 内 `try/catch`，`catch(e){ const err = asCanvasError(e); const action = routeError(err, {devMode:isDevMode()}); if(action.kind==='surface') return {error: err.userMessage}; ... }`。
- **Client 渲染**（`client/index.ts` 等）：收到结构化错误后 `routeError` 决定写节点错误态 / 弹 toast / 仅记日志。
- **入口注册**：Host 与 Client 入口各 `import './errors/catalog.js'` 一次。

---

## 10. 附录：已登记错误码（catalog 现状）

| code | module | severity | audience | recoverability | channel |
|---|---|---|---|---|---|
| `CS-GEN-204` | GEN | S2 | user,agent | guided | conversation |
| `CS-NET-001` | NET | S2 | agent,developer | guided | conversation |
| `CS-NET-002` | NET | S3 | developer | auto | log |
| `CS-PROV-001` | PROV | S1 | user,developer | fatal | node |
| `CS-PROV-002` | PROV | S2 | agent,developer | guided | conversation |
| `CS-USER-001` | USER | S2 | user,agent | guided | conversation |
| `CS-H3IR-001` | H3IR | S2 | user,agent | guided | conversation |
| `CS-REF-001` | REF | S2 | user,agent | guided | conversation |
| `CS-COMP-001` | COMP | S2 | user | guided | toast |
| `CS-COMP-002` | COMP | S2 | user,agent | guided | node |
| `CS-FFMPEG-001` | FFMPEG | S1 | developer | fatal | log |
| `CS-NODE-001` | NODE | S2 | user | guided | node |
| `CS-EFFECT-001` | EFFECT | S2 | agent | guided | conversation |

> 其余历史错误按 §7 分批补登。
