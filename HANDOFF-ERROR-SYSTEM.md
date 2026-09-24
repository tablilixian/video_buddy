# HANDOFF：Canvas Studio 统一错误处理系统（后续会话专用）

> 本文件用于**新开一个对话**专门推进「统一错误处理系统」时续接。
> 先读 §1 状态速览，再读 §2 设计，然后按 §5 的下一步顺序做。
> 相关代码与文档已全部提交；**CV-234 / CV-235 / CV-236 三批 + 一处播放弹窗修复
> 已 commit、待 push**（清单见 §八）。`origin/dev` 目前停在 `12148e0a2d`（CV-233）。

---

## 一、状态速览（一句话版）

**阶段二迁移已全部完成（2026-09-23）**：`src/` 应用代码里的历史裸 `throw new Error` 已 **100% 接入统一错误系统**（仅剩 `error-system.ts` 自身的启动期防呆断言，属设计内），全部错误均携带 `CS-*-NN` 码；§5.2 D4 toast 桥（`src/client/error-toast.ts`）已实例化；§5.3 D5 仅日志项已逐条评审（全部维持 D5）。全量测试 `917 / pass 912 / fail 5`，失败清单**恰等于基线红**（402 渐进披露 + studio-defaults ×4），迁移零回归。

后续只剩「运行态观察」：桌面运行时（另一份 checkout）需 `git pull` + 重建后，用真实生成流程观察错误呈现；以及拍板两个遗留设计点（见 §5.5）。

### 1.1 后续三批（2026-09-23 ~ 09-24，代码 + 守卫 + 文档均已完成，待 push / 待桌面验收）

| 编号 | 内容 | 关键不变量 |
|---|---|---|
| **CV-233** | 统一错误系统边界收敛（已 push） | 受众/可恢复性双轴，含 `user` 且非 `auto` 才露面 |
| **CV-234** | 错误可见性「**诊断开关**」（设置 → 诊断） | 进程级 `ErrorVisibility` 标志，`'all'` 时绕过 auto / 受众两条隐藏规则；Host 与 Client 是两个运行时，标志不共享、共享的是设置值 |
| **CV-235** | 工具入参「**占位值**」守卫 | 唯一实现点 `wrapStudioToolDefinition`（别写进各工具 execute）；拒收先于 execute ⇒ 零副作用；独立码 `CS-PARAM-002` |
| **CV-236** | H3 预检 `R7`「素材标签编号不连续」**ERROR → 提示** | 降级后 WARN **必须**由 `assertH3IrPrompt` 的返回值带进 `result.warnings`，否则静默；「引用了不存在的素材」仍 ERROR |

⚠️ **两条认知更正**（验收时最容易踩，详见 §八 与 `docs/STATUS.md` 的 CV-234 行）：
1. **对话流（D1）那行红字是宿主渲染的**，`audience` 判定与诊断开关**都够不到** ——
   只要有工具失败就有那行红字。**要验收开关，必须用「隐藏受众」的码**
   （`CS-NET-009` / `CS-PROV-003` / `CS-FFMPEG-001` / `CS-DEV-ERR` 等），
   且只看 D2 红标 / D3 面板 / D4 toast。用 `CS-H3IR-001` 或 `CS-PARAM-002`
   验收必然误判（它们 `audience` 含 `user`，本来就该展示）。
2. **「拒收零副作用」只对 Host 成立**：客户端在 `tool/call` 一到就落了占位节点，
   而 `CS-PARAM-002` / `CS-H3IR-001` 都含 `user` 受众 ⇒ 画布仍会留一张红标
   「生成失败」节点，尽管预检没发起任何生成。（待修，见 `canvas-node-state-map.md`）

同期查出**未修**的两个画布侧缺陷（已在记忆立案）：① 零执行的失败仍留红标节点；
② 隐藏受众失败**漏清占位计时器**（占位永久「生成中」+ 2s 队列轮询永不停止，
`asset-capture.ts` 提前 return 与 `client/index.ts onToolError` 的 `clearPendingTimer` 脱钩）。

```
HEAD（本批）= 见 git log；阶段二两个提交：
  <batch-1>  feat: register CS-*-NN codes + migrate generate.ts timeout domain（§5.1.1）
  <batch-2>  feat: migrate all remaining bare throws to error system + D4 toast bridge（§5.1 剩余 + §5.2 + §5.3）
```

验证基线：`tsc -p tsconfig.json` 零错误；`node --test tests/error-system.test.mjs` **9/9 通过**；`long-request` / `video-provider-registry` / `health` 测试仍全绿（超时翻倍未破坏不变量）。

---

## 二、系统设计与关键概念

### 2.1 两个轴 + 一个等级（核心抽象）

错误用 `CanvasStudioErrorSpec` 描述，三个关键字段：

- **`audience: 'user' | 'agent' | 'developer'`** —— 决定「给谁看」。
  - `developer`：开发期/诊断类（内网地址、provider 原始 blob、stack）。**生产环境对用户自动隐藏**，只进日志。
  - 这是用户原始诉求的落点：普通用户看不懂、不会处理的错误，只要标成 `developer` 就自动下沉。
- **`recoverability: 'auto' | 'guided' | 'fatal'`** —— 可恢复性。
  - `auto`：AI 能自恢复（如网络抖动瞬时失败）→ **永不报用户**，静默重试。
  - `guided`：需用户/agent 引导（如「重试」「换参考图」）。
  - `fatal`：阻断（如项目文件损坏）。
- **`severity: 'S1' | 'S2' | 'S3'`** —— 严重等级（S1 阻塞 / S2 可恢复 / S3 提示）。

### 2.2 路由引擎 `routeError(err, { devMode })`

所有错误收敛为三类处置（见 `docs/canvas-studio-error-system.md` §3 路由矩阵）：

| 条件 | 生产环境 (devMode=false) | 开发环境 (devMode=true) |
|---|---|---|
| `recoverability==='auto'` | 静默重试（用户无感） | 仅记日志 |
| 受众**不含** `user`（仅 developer/agent） | **仅日志（用户无感）** | 仅日志 |
| 含 `user` 且非 `auto` | 按 `channel` 展示（**不含** dev 细节） | 展示并附 `[dev]` 原始细节 |

→ **只有「含 user 且非 auto」的错误才会真正出现在用户眼前**。这正是收敛的全部意义。

### 2.3 展示通道 `channel`（D1–D5）

代码库**没有** `console.error` / `alert()` / 错误 Modal，错误主通道是：
- **D1 agent 对话回显**（Host 工具错误经 agent 对话呈现）
- **D2 画布节点错误态**（生成失败 → 节点 error 态）
- **D3 效果测试面板**（effect test 状态/失败行）
- **D4 toast**（`.csToast-error` 样式已就绪，JS 实例化点由新系统统一接管）
- **D5 仅日志**（开发者可见，用户无感）

### 2.4 脱敏 `sanitizeForUser()`

抹掉内网地址 / URL / 绝对路径 / stack，保证用户文案零敏感信息。所有面向用户的 `userMessage` 必须走脱敏。

---

## 三、已落地的文件（均在本仓库 `canvas-studio/`）

| 文件 | 作用 | 行/规模 |
|---|---|---|
| `src/error-system.ts` | 核心：类型 + `registerError` / `throwError` / `asCanvasError` / `routeError` / `sanitizeForUser` / `toJSON`·`fromJSON`。纯 TS、Host/Client 双端可用 | ~290 行 |
| `src/errors/catalog.ts` | 错误码注册表（单一事实来源），self-registering。已登记 **13 条**代表码（A–K 各 1–2 条）作迁移样板，含「仅 developer 隐藏」(`CS-FFMPEG-001`) 与「auto 静默」(`CS-NET-002`) 示范 | ~120 行 |
| `tests/error-system.test.mjs` | 路由 + 脱敏断言，**9/9 通过** | — |
| `docs/canvas-studio-error-system.md` | **系统设计文档**：定义、路由矩阵、错误码规范 `CS-MODULE-NN`、§6 十条硬编码开发约束 + PR 自检清单、§7 阶段化迁移策略、扩展指引 | — |
| `docs/canvas-studio-error-handbook.md` | **完整错误手册**：110+ 条用户可见报错，按「文案/原因/展示方式/是否自纠错/严重等级」五维度 + 11 模块（A–K）收敛，全部带 `文件:行号` | — |
| `docs/canvas-studio-task-timeout-spec.md` | 任务调度与超时功能说明 + 错误手册（§8），本次会话早期产物，已被上两份文档覆盖但保留作参考 | — |

> 阅读顺序建议：先 `docs/canvas-studio-error-system.md`（设计 + 约束），再 `docs/canvas-studio-error-handbook.md`（全量错误清单，迁移时的「待办池」）。

---

## 四、本次会话顺带做的改动（非本系统，但同批提交）

**所有超时时长翻倍**（用户诉求：降低频繁超时）。13 处 `*_TIMEOUT_MS` 常量 2x，不变量仍成立：
`LONG_REQUEST_TIMEOUT_MS=1800s` > 各档上限（最大 `DRAMA.video=1200s`）；`PENDING_TIMEOUT=1320s` 与 `DRAMA.video` 余量放大到 120s。
改动文件：`generate.ts` `long-request.ts` `providers/executor.ts` `ffmpeg-run.ts` `video-style.ts` `compose.ts` `client/index.ts` + 测试 `video-provider-registry.test.mjs` 断言同步。

> 详见 `docs/canvas-studio-task-timeout-spec.md`。这部分**不是**新会话的重点，但改超时若动到相关文件，留意不要破坏已翻倍的值。

---

## 五、接下来做什么（新会话推进顺序）

> **✅ 2026-09-23 更新：§5.1 / §5.2 / §5.3 / §5.4 已全部完成**（§5.4 由迁移本身闭环——所有错误实例都带 `.code`，agent/用户贴码即可定位 catalog 条目）。以下条目保留作存档；新会话只需看本节末尾的「遗留设计点」。

### 遗留设计点（需拍板，非阻塞）
1. **`CS-FFMPEG-001` 受众**：当前标 `developer`（生产对用户隐藏）；但「视频处理组件不可用」用户其实看得懂、且只能靠重装解决 —— 是否应升为 `user` 受众，等真实运行态观察后再定。
2. **`docs/canvas-studio-error-handbook.md` / `canvas-studio-error-system.md` 已不在工作树**（本会话开始时即缺失）：手册是迁移时的「待办池」，迁移完成后若仍需要，应从 git 历史恢复或按 catalog 现状重生成。

### 5.1 阶段二迁移：把 110+ 历史裸报错接入新系统（核心任务）

目标：把 `src/**` 下所有 `throw new Error('...')` 与 `console.warn` 诊断，按手册 `docs/canvas-studio-error-handbook.md` 的 A–K 模块逐条登记为 `CS-*-NN` 码，并把抛出点改为 `throwError(code, vars)`。

**建议迁移顺序（按风险/收益）**：
1. **`generate.ts` 超时域先走**（最直接缓解用户吐槽）：`Drama Backend {N}s 内未返回结果`、`文件上传 {N}s 内未完成`、各下载/地址校验。把「用户看不懂的裸文案」登记为 `developer` 受众 → 自动对用户隐藏。
2. **`long-request.ts` 的 `console.warn('无法抬高 fetch 传输层超时上限')`** → 登记为 `CS-NET-001` developer 受众（这条是"同事频繁超时"真凶候选，必须进日志且可检索）。
3. **Provider 层**（`providers/fal.ts` `drama.ts` `registry.ts` `selection.ts` `capability.ts` `reference.ts`）：整套 fal/供应商选择报错目前全漏在手册外，先补齐登记。
4. **工具入参校验**（`host-tools.ts` + `generate.ts` 工具参数段）：`参考图 @ref[X] 未找到`、`分镜卡「X」未找到` 等——这些是 `user` 受众 + `guided`（带恢复指引）。
5. **合成/参考视频/波形/项目管理**（`compose.ts` `video-style.ts` `video-frames.ts` `waveform-host.ts` `projects.ts` `routes.ts` `client/api.ts`）。

**迁移时不变量**（见系统文档 §6）：
- 禁止裸 `throw new Error('...')`，必须 `throwError(code)`；未登记码注册即抛错（`registerError` 启动期自校验）。
- 受众最小化；AI 可恢复必写 `auto`；`user` 文案必须 `sanitizeForUser`；`guided/fatal` 必填 `recoveryHint`。
- `registerError` 自动拒绝矛盾配置（`auto` 却含 `user` / 含 `user` 却 `channel:'log'`）。

### 5.2 接入展示通道（D4 toast 实例化）

`.csToast-error` 样式存在，但 JS 实例化点未接。需在客户端把 `routeError` 结果为 `channel:'toast'` 的错误桥接到一个轻量 toast 渲染器（新建 `src/client/error-toast.ts` 或在现有 client 入口挂载）。这是让 `user`+`guided` 错误真正"按 channel 展示"的最后一公里。

### 5.3 评审 D5 仅日志项

逐条审查当前 `console.warn` / `logger.warn` 的 D5 项（如 `deferred promote failed`），按 §2.3 判定是否应升级为 D1/D3，避免"用户完全无感知但本该看到"的盲区。

### 5.4 错误码回写代码（闭环）

把手册里的 `A1…K5` 实体化为 `CS-*-NN` 码并回写到 `CanvasStudioError.code` 字段，使「用户贴报错 → 查手册 → 定位根因」形成闭环。

---

## 六、验证流程（每次改动后必跑）

```bash
cd canvas-studio
# 1) 重新 emit Host 产物到 lib/（测试引用 ../lib/*.js，不重 emit 会跑旧代码）
node node_modules/.bin/tsc -p tsconfig.json
# 2) 跑新系统测试
node --test tests/error-system.test.mjs
# 3) 回归超时/不变量测试
node --test tests/long-request.test.mjs tests/video-provider-registry.test.mjs tests/health.test.mjs
```

---

## 七、踩坑与约定（新会话必读）

1. **`lib/` 是编译产物、被 gitignore**：改了 `src/error-system.ts` 后**必须**重跑 `tsc -p tsconfig.json` 再跑测试，否则测试跑的是旧 `lib/`。
2. **`exactOptionalPropertyTypes` 陷阱**（本会话已踩）：可选属性**不能**显式赋 `undefined`，否则 tsc 报错。写法应把类型声明成 `devMessage?: string | undefined`（已在本模块修正）。
3. **两份 checkout 同步**：桌面实际加载的是 `~/Desktop/job/git/playsout/videobuddytest`（同 remote/dev）；本会话在 `~/Desktop/job/learn/video_buddy` 开发。**本系统改的是 `src/`，运行时需到另一份 `git pull` + 重建才能看到效果**——但新会话在 `video_buddy` 这个 checkout 里开发即可。
4. **git `insteadOf` 会改写 remote URL**（`https→ssh`），本机会显示 `git@github.com:...`；若跑"比对 remote URL 的仓库门禁"会假红，加 `GIT_CONFIG_GLOBAL=/dev/null` 中和。普通 commit/push 不受影响。
5. **client 端集成待确认**：`src/error-system.ts` 经 Host `tsconfig.json` 编译进 `lib/`；`src/client/**` 走独立 client 配置、被 Host tsconfig 排除。客户端若要用，需确认 client 打包能解析 `../error-system.js`（或将其纳入 client 入口）。这是 §5.2 的一个待澄清点。
6. **不要动 `deepseek-harness/`**（上游 submodule，AGENTS.md 规定不在桌面分支改它）；也不要为历史数据写脚本/迁移（开发阶段只修产生数据的路径）。

---

## 八、提交记录

```
a29ba1f2e4  feat: add unified error handling system + handbooks                  [pushed]
6313cea9c7  refactor: double all task/timeout durations across the pipeline       [pushed]
78bb8bac32  feat: migrate all remaining bare throws to error system + D4 toast     [pushed]
12148e0a2d  feat: CV-233 unified error system — codepath hardening                 [pushed]
5409b97fe5  feat: CV-234 错误可见性「诊断开关」（设置 → 诊断）                        [待 push]
90c09036e3  feat: CV-235 工具入参「占位值」守卫（事前纪律 + 入口拒收）                  [待 push]
e2e0090716  feat: CV-236 H3 预检 R7「素材标签编号不连续」ERROR → 提示                   [待 push]
6cd4035d06  fix:  播放弹窗高度自适应（竖屏视频不再把控制条顶出卡片）                     [待 push]
```

**验证基线（2026-09-24 实测，仅本机）**：`tsc -p tsconfig.json` 与
`tsc -p tsconfig.client.json --emitDeclarationOnly` 零错误、`verify-client-loader` ✓；
全量 `node --test "tests/*.test.mjs"` = **957 / pass 952 / fail 5**（老基线 937/932/5，
净增 20 条全绿；5 条红与基线**逐条同名**：1 条渐进披露 skill references + 4 条
studio-defaults）。CV-234/235/236 的守卫均已**反向变异**验证（改坏产品码 → 断言精确
变红 → 还原），CV-236 另加一条**接线守卫**（断言 `assertH3IrPrompt` 返回值恰好被 2 处
接住）。⚠️ 后台/网络相关测试按用户指示**未跑**（后端已发新版本）。

> ⚠️ **本机 `Bash` / `Grep` 曾在会话中途整体失效**（`sandbox-exec: pattern
> serialization length … exceeds maximum`，长度随会话内出现过的路径累积增长
> ⇒ 同一会话不自愈，**换新会话即恢复**）。那段时间只能 Read/Edit，故上述三批的
> 验证是在 shell 恢复后补跑的。
>
> `HANDOFF-CV-223.md` / `HANDOFF-CV-232.md` / `session-*.html` 为历史未跟踪文件，
> 与本系统无关，**勿纳入提交**。
