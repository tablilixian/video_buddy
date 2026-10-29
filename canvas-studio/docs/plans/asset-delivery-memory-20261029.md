# 资产交付内存基线 + CR 台账对账（小计划 · 2026-10-29）

> **状态**：**T0~T3 已全部落地（2026-10-29 · CV-382 · 待桌面验收；执行期自决 D-05~D-11 见 §9.1）** ｜ **编号**：**CV-382**（三层登记完成：STATUS §4.1 / cv-details / changelog）
> **执行纪律**：与音频收口同款 —— **连续推进不中断、自决不问、只在全部完成后汇报一次**（见 §9）
> **续接入口**：新会话开局直接粘 [2026-10-29-交接-资产内存.md](./2026-10-29-交接-资产内存.md)（自包含的 T0→T3 任务书）
> **治的条目**：CR-004（唯一中危未修的真账）、CR-023（假待处理）、CR 台账双轨矛盾（≥7 条）、资产 range 行为零覆盖
> **规模**：**4 个任务 / ≈2 人日**（对照音频收口：6 阶段 / 9.5 人日）

---

## 1. 现状：代码核实（2026-10-29 逐点验证）

### 1.1 一句话根因

**资产的 Range 支持是"假流式"：先把整个文件 `readFile` 进内存，再在 Buffer 上切片。**

`src/routes.ts:1108` 起的资产前缀路由里：

```ts
let data: Buffer
try { data = await readFile(target) }                            // ← 整文件进内存
catch (ENOENT) { data = await readFile(join(base, ASSET_TRASH_DIR, file)) }
...
const range = parseByteRange(req.headers.range, data.byteLength)  // ← 在已整读的 Buffer 上切
if (range !== undefined) { res.statusCode = 206; ... res.end(data.subarray(start, end + 1)) }
res.statusCode = 200; res.setHeader('accept-ranges', 'bytes'); res.end(data)
```

`accept-ranges: bytes` + 206 让 `<video>` 看起来能 seek，**实际上每个分段请求都会重读一次整个文件**。128MB 的片子 seek 10 次 = 读 1.28GB。

### 1.2 核实表（本次实测，非文档转述）

| # | 事实 | 位置 | 台账原状态 | 判定 |
|---|---|---|---|---|
| 1 | 资产响应整读：`readFile(target)` → 在 Buffer 上 `subarray` 切 range | `src/routes.ts:1147`（根）、`1152`（`.trash/` 兜底）、`1160-1171`（切片与 200/206） | CR-004「待处理」 | ✅ **仍成立，且比原描述更严重** —— 2026-09-02 写这条时还没有 range 支持；现在多了「每次 seek 都全量读」这一层 |
| 2 | 上传侧单文件上限 | `src/routes.ts:328` `MAX_VIDEO_BODY_BYTES = 128 * 1024 * 1024` | — | 内存放大上界 = 128MB × 并发数 |
| 3 | CR-023「无 BGM 分支整读再写盘」：`writeFile(final, await readFile(concat))` | `src/compose.ts` 已无任何 `readFile` / `copyFile` 调用 | CR-023「待处理」 | ❌ **假待处理**（代码里已不存在该形态，应关账） |
| 4 | CR-042 `installBrandStyles` cleanup 不移除 DOM | `src/client/brand-inject.ts:59-71` 已 `brandElement.remove()` + `removeAttribute(BRAND_ATTR)` + 清 favicon link，注释直写 CR-042 | §1.2 表「待处理」/ §3 表「已修复·待验收」 | ❌ **已修**，但**两表状态相反** |
| 5 | CR-045 LogoMark 硬编码灰不随主题 | `src/client/brand/LogoMark.tsx:36` 用 `var(--cs-accent, #7C6CFF)` | §1.2 表「待处理」/ §3 表「已修复」 | ❌ **已修**，同样两表相反 |
| 6 | 资产 range 行为的测试覆盖 | `tests/asset.test.mjs` 内 `range` / `206` / `416` **零命中** | — | ⚠️ **零覆盖** —— 改造前必须先补断言，否则改坏了没人知道 |
| 7 | 台账双轨一致性 | `docs/code-review/README.md` §1 清单表 vs §3 状态总表 | — | ❌ **至少 7 条状态相反**：CR-032 / 035 / 036 / 042 / 045 / 046 / 089（§1 写「待处理」，§3 写「已修复·待验收 2026-09-03」） |

### 1.3 顺带发现：台账「待处理」总量

- §3 状态总表里 **30 条**标 `待处理`（1 中危 CR-004 + 29 低危）。
- 其中 CR-004 是本轮唯一确认**仍成立**的中危真账；其余低危未逐条核实（本计划不做全量对账，见 §7）。

### 1.4 本轮踩到的一处工具坑（写进计划防止复踩）

核实 CR-042 时第一遍用 `grep -n "brandElement\|cleanup"` **返回空**，差点判定「文件里没这东西 ⇒ 已删除 ⇒ 逻辑变了」。实际是 **BSD grep 不支持 BRE 的 `\|`**，模式被当成字面量。换 `grep -E` 后立刻命中。

⇒ **核实类工作一律用 `grep -E`**，`grep` 空命中不得等同于"不存在"。

---

## 2. 为什么选它（而不是别的）

| 判据 | 本主题 | 说明 |
|---|---|---|
| 有真账 | ✅ CR-004 经核实仍成立且更严重 | 不是"看着像问题"，是读代码确认 + 上限常量确认 |
| 收益可量化 | ✅ 内存峰值 O(文件大小×并发) → O(64KB×并发) | 用进程 RSS 实测对比，不靠感觉 |
| 完全离线可验 | ✅ 假 `ctx` 捕获 handler + 本地文件 | 已有 `library-route.test.mjs` / `account-routes.test.mjs` 同款套路，无需 GUI/后端/额度 |
| 风险低 | ✅ 单文件单路由，行为用测试锁定 | 改造前先补 6 条断言锁住现状 |
| 体量小 | ✅ 4 任务 / 2 人日 | 用户要求「时间短、任务少」 |
| 有额外产出 | ✅ 台账机器闸 | 防止下次再做「修已修的东西」（本轮差点重做 CR-042/CR-023） |

**被排除的候选（都核实过，避免浪费一轮）**：

| 候选 | 排除理由 |
|---|---|
| 「拒收类码仍落红标 / 隐藏受众漏清计时器」 | ❌ **已修**：`src/asset-capture.ts:370-435` 已有五档分流（AUTH 自愈 / 取消 / 非 user 受众 / 预执行类 / 其余标红）。`canvas-node-state-map.md:69` 那段记档已过时 |
| 真机验收自动化（备选 B） | ❌ 依赖 Electron/GUI，时间不可控，与「时间短」冲突 |
| 音频收口后续 | ❌ 已由另一会话做完（CV-377~381 已入账） |
| CR 全量对账（30 条低危） | ❌ 体量不可控，本计划只做「双轨矛盾 + 1 条中危真账」 |

---

## 3. 目标与验收口径

| 目标 | 机器可判定口径 |
|---|---|
| **内存不再随文件大小线性放大** | 同一个 60MB 测试文件、同一组 10 次 Range 请求：改造前后用 `process.memoryUsage().rss` 采样峰值，**改造后峰值增量 < 20MB**（改造前预期 ≥ 60MB，实测填真值） |
| **Range 语义不变** | 6 条断言全绿：200 全量 / 206 单段 / 206 后缀 `bytes=-N` / 416 越界 / 无 Range 头 / `.trash` 兜底回源 |
| **断连不泄漏** | 请求方 abort 后 `createReadStream` 被 `destroy()`，不产生未关闭 fd（用 `process._getActiveHandles` 或 fd 计数断言） |
| **台账不再双轨** | `tests/code-review-ledger.test.mjs` 断言：§1 与 §3 的 ID 集合相同、同 ID 状态一致、状态词 ∈ 允许集合、`已修复` 项必须含「方案一句话」 |

> **实测基线（T0，2026-10-29，node v22.20.0 / darwin / `--expose-gc`，`build/probe/asset-memory.json`）**：
> before 峰值增量 **148MB**（60MB 资产 × 10 次 Range 连发，RSS 采样 130.8→213.0MB —— 连发期间多份
> 60MB Buffer 同时存活、GC 未及回收，与「≥ 60MB」预测同向且更重）；fd 增量 **2**（阈 ≤2，含 1 次中途 abort）。
> after 待 T1 重跑回填：before 148MB → **after 7.83MB（T1 实测回填，<20MB ✅）**。
> 【T1 复测终值】对测姿势改为「同一构建同一客户端」：before = `CANVAS_STUDIO_ASSET_LEGACY_BUFFER=1`（T1 保留的旧整读形态）**125.45MB**，after = 流式 **7.83MB**（10 次 Range 含 5 次 50MB 段首块即断，fd 增量 0；采样序列见 `build/probe/asset-memory.json`）。T0 时点的 fetch 版 before=148MB 留作历史证据 —— fetch/undici 装置噪声见 §9.1 D-05。

---

## 4. 任务（T0 → T3，共 4 个）

### T0 · 先补测试锁现状（0.5 天）

**先把现有行为钉死，再动实现。** 这一步不做，T1 就是裸奔。

| 产出 | 说明 |
|---|---|
| `tests/asset-range.test.mjs` | 用假 `ctx.webServer.register` 捕获 handler（照 `library-route.test.mjs` 套路），假 `ProjectRegistry` 指向临时目录；6 条断言：200 / 206 单段 / 206 后缀 / 416 / 无 Range / `.trash` 兜底 |
| `scripts/probe/asset-memory.probe.mjs` | 起一个最小 http server 挂同一 handler，灌 60MB 假资产，发 10 次 Range 请求，采样 `rss` 峰值，输出 `build/probe/asset-memory.json`（`before`/`after` 两个字段，T1 后重跑填 `after`） |
| 基线数值 | 把 T0 的实测峰值写进本文 §3 表格下方 |

**退出条件**：6 条断言全绿（锁定现状）；probe 能输出 `before` 峰值数字。

### T1 · 流式改造（0.75 天）

| 改动 | 文件 | 要点 |
|---|---|---|
| 存在性探测改 `stat` | `src/routes.ts` 资产路由 | 先 `stat(target)`，ENOENT 再 `stat(join(base, ASSET_TRASH_DIR, file))`；两者都 miss → 404。**不要**为了拿 `size` 而 `readFile` |
| 200 分支 | 同上 | `createReadStream(finalPath)` + `content-length: size` + `accept-ranges: bytes`；`stream.on('error')` → 若已发头则 `res.destroy()`，未发头则 500 |
| 206 分支 | 同上 | `createReadStream(path, { start, end })` + `content-range: bytes s-e/size` + `content-length: e-s+1` |
| 416 分支 | 同上 | 保持 `content-range: bytes */size`，`size` 来自 `stat` |
| 断连 | 同上 | `res.on('close')` → `stream.destroy()`（避免 fd 泄漏） |
| 不动的部分 | 同上 | `cache-control: no-store`、`x-content-type-options: nosniff`、content-type 推断、403 越界校验**逐字符不变** |

**退出条件**：T0 的 6 条断言仍全绿；probe 重跑 `after` 峰值增量 < 20MB；反向变异 3 处能变红（见 §8）。

### T2 · 台账对账 + 机器闸（0.5 天）

| 改动 | 文件 | 要点 |
|---|---|---|
| 两表对齐 | `docs/code-review/README.md` | CR-032/035/036/042/045/046/089 的 §1 表状态改成与 §3 一致的「已修复·待验收」；CR-023 关账（补一句「2026-10-29 核实：`compose.ts` 已无整读形态」）；CR-004 修完后改「已修复·待验收」 |
| 记录方案而非只说已修 | 同上 | 已修项必须写「用了哪种方案」（例：CR-042 是 `remove()` 真移除，不是 `querySelector` 清理 —— 两者都对但实现不同，下次核对要按实现读） |
| 机器闸 | 新 `tests/code-review-ledger.test.mjs` | 四条断言：① §1 与 §3 的 ID 集合相同；② 同 ID 状态词相同；③ 状态词 ∈ {待处理, 进行中, 已修复·待验收, 已完成, 已否决}；④ 状态为「已修复」时必须能在同文件里找到该条目的「方案」字样 |
| 反向变异 | — | 把某条 §1 状态改回矛盾值 → 断言②红；插一个不在 §3 的 ID → 断言①红 |

**退出条件**：闸 4 条全绿；两处故意改坏能变红。

### T3 · 验收与登记（0.25 天）

- probe 前后对比写进本文 §3；`yarn test:smoke` 全绿（含新增 10 条）；
- STATUS 登记一条（CV-382，按 §4.1 三层：索引行 / `cv-details.md` 小节 / `changelog.md` 一行 + `node scripts/status-summary.mjs`）；
- `docs/code-review/README.md` 头部补一句「2026-10-29 对账批注（CR-004 收口 + 双轨统一 + 机器闸）」。

---

## 5. 决策（已自主判定，不再回议）

| # | 决策 | 判定 | 理由 | 推翻成本 |
|---|---|---|---|---|
| **D-01** | 改造范围 | **只改资产交付路径**（`ROUTE_ASSETS` 前缀里那 5 处文件响应），不碰 grain / bundle / login-video 三处 | 那三处是小文件（<2MB）、一次性加载、且 bundle 有强缓存语义；改它们收益为 0、回归面为正 | 小 |
| **D-02** | 是否顺手改 `cache-control: no-store` | **不改** | 与 undo / `.trash` 回源语义耦合（CV-243），改缓存会引入「删了还能看到旧图」的新问题 | 小 |
| **D-03** | 台账闸的强度 | **只做结构闸**（ID 集合 / 状态词 / 方案字样），不解析正文语义 | 语义闸必然脆（中文表述自由），会被迫频繁改测试；结构闸已能拦住 7 条矛盾里全部 | 小 |
| **D-04** | trash 兜底在流式下怎么实现 | **`stat` 探测两条路径**，不 `try/catch` 包 `createReadStream` | 流式错误是异步事件、发头后再 catch 无意义；`stat` 是同步决策点，语义清晰 | 小 |

---

## 6. 工期与依赖

```
T0 补测试锁现状 0.5d ──→ T1 流式改造 0.75d ──→ T3 验收登记 0.25d
                    └──→ T2 台账对账 0.5d ──┘（与 T1 无耦合，可并行）
```

合计 ≈ **2 人日**。**零外部依赖**：不需要 GUI、不需要后端、不消耗额度、不需要用户参与。

---

## 7. 明确不做（边界）

- **不做 30 条低危 CR 的全量对账**：只处理双轨矛盾 7 条 + CR-004 + CR-023 关账。全量对账另立计划。
- **不改 `no-store` / 不加 ETag / 不做 CDN 语义**：缓存策略属于另一条线。
- **不引入 `send` / `koa-send` 之类依赖**：手写 `createReadStream` 足够，且现有 15 行 `parseByteRange` 已可用。
- **不重构整个 `routes.ts`**（4400+ 行，是既有棘轮目标，但不属于本轮）。
- **不迁移历史资产**：`.trash` 里已有的、根目录已有的，一律只读。

---

## 8. 风险与止损

| 风险 | 触发信号 | 止损 |
|---|---|---|
| 流式后 `<video>` seek 反而坏 | 真机播放器拖进度条卡住/黑屏 | 保留 `CANVAS_STUDIO_ASSET_LEGACY_BUFFER=1` 回退到整读；T0 的 6 条断言必须先在改前变绿 |
| 发头后出流错误导致连接挂死 | `res.writableEnded` 为真但仍 `destroy` | `stream.on('error')` 里先判 `res.headersSent`：已发头只 `res.destroy()`，未发头才 500 |
| fd 泄漏 | probe 里 fd 计数递增 | `res.on('close')` 无条件 `stream.destroy()`；probe 断言「10 次请求后 fd 增量 ≤ 2」 |
| 台账闸太脆 | 后续正常编辑就红 | 按 D-03 只做结构闸；断言消息写明「改状态词请同步 §1 与 §3」 |
| `build/probe/` 被误提交 | `git status` 出现 probe 产物 | probe 输出目录加进忽略；产物只作本地证据 |

**反向变异清单（3 处，必须都能变红）**

1. 206 分支去掉 `content-length` → 断言「206 的 content-length == e-s+1」红；
2. `stat` 探测改回 `readFile` 兜底 → probe 的 `after` 峰值回升（阈值断言红）；
3. 台账某条状态改回矛盾值 → 闸断言②红。

---

## 9. 执行纪律（沿用音频收口 §10，同等效力）

1. **连续推进**：T0 → T1 → T2 → T3 一口气做完，中途不询问、不等确认、不「先汇报再继续」。
2. **自主决策**：新问题按「已写明 → 不做边界内侧 → 不破坏既有行为且可回退可观测 → 连续 3 轮无进展则回退缩小并记遗留」四级顺序自判，记进 §9.1。
3. **只在全部完成后汇报一次**，格式见 §9.2。
4. 停下的唯一合法理由：全部任务完成，或用户主动打断。

### 9.1 决策日志

| # | 任务 | 触发 | 自决内容 | 理由 |
|---|---|---|---|---|
| D-05 | T1 | 探针首跑 after 相 40.78MB 假超阈 | 探针客户端从 fetch/undici + arrayBuffer() 换成裸 `http.request`（无 keep-alive、数据即弃）；**阈值 20MB 不动**，修的是测量装置不是门槛 | 同进程 fetch 装置每请求留 ~6-8MB GC 滞后垃圾（体缓冲 + undici 对象），把「服务端内存」读数淹掉；采样序列单调爬升 +6-8MB/请求与流式 64KB 分块不符 |
| D-06 | T1 | before/after 需同方法学对测 | before 相改在流式构建上以 `CANVAS_STUDIO_ASSET_LEGACY_BUFFER=1` 实测（= 旧整读形态），T0 时点 fetch 版 before=148MB 留作历史证据 | 同一构建 + 同一客户端，排除装置差异；LEGACY_BUFFER 本就是 §8 止损开关，一物两用 |
| D-07 | T1 | 探针 abort 计数实测 0 次（`含 abort 0 次`） | 断连探测升级为 **5 次 50MB 段「首块即断」**（奇数次），偶数次小段完整收尾 —— 仍是 10 次 Range 请求；新增「abort 必须 =5」硬判定 | loopback 上 1MB 小段在 abort 执行前已 end，1 次弱探测空转且 fd 断言失义；只断 1 次时泄漏 1 fd 恰 ≤2 会假绿 |
| D-08 | T2 | 计划原文闸①写「§1 与 §3 ID 集合相同」，但 §1.3 明言「低危见各模块文档」——§1 只是高危+中危子集，集合相等按字面必然红 | 闸① 取 **§1 ⊆ §3**（§3 是全集），另加两表各自「无重复 ID」；反向变异「插一个 §3 没有的 ID」在该口径下照样红 | 按 README 自身结构取最保守实现（裁决序 ②）；实测该口径当场抓出第 8 处矛盾：CR-104 在 §1.1 有条而 §3 无行，已补登 |
| D-09 | T2 | 闸③允许集合不含「已定案」，而 CR-012 两表已用「已定案（不实施 / 维持不注入）」 | 允许集合收编「已定案」（§0 五词 + 台账既有词汇），**不改写 CR-012 的历史定案表述** | 2026-09-30 对账批注的定案是负载事实；为闸过而改史违反「不破坏既有行为」 |
| D-10 | T2 | 闸④「必须找到该条目的方案」若按字面做语义解析必然脆（D-03 禁） | 结构化为：已修复·待验收 的每个 ID 必须在 **§3 表行之外的 README 全文**（§0 批注 / §1 清单 / §6 变更记录）可寻——方案一句话的既定住所；本轮已为对账条目在 §3 备注列补方案一句话 | D-03 之下最强的结构代理；逼住未来「只标已修不写方案」的增量 |
| D-11 | T2 | README 改完后，模块文档 01-host-core.md 的 CR-004/CR-023 仍无状态行 —— 会立刻形成「README 已修、模块文档空白」的新双轨 | 同步补两处状态行（CR-004 已修复·待验收 + 实测数字；CR-023 关账核实注），**不动其余 29 条低危**（§7 边界） | 台账单点化的一致性要求；超出计划字面但属同一矛盾体的收尾 |

### 9.2 汇报格式

1. T0~T3 各自做了什么 + 改动文件路径 + 验证命令与关键数值（RSS 前后对比必须给数字）；
2. 与 §1 预测不一致之处及原因；
3. 降级/遗留（若有）；
4. git：commit 几笔、hash 前缀、是否待 push。

### 9.3 红线

- 不碰 `deepseek-harness/` submodule；不改后端入参字段名。
- 不为让测试变绿而改既有断言语义（本轮无例外项）。
- 不跳过验证链：`clean.mjs` → `tsdown` → `tsc`×2 → `verify:loader` → `yarn test:smoke`。
- `git push` 由用户手动；助手只 commit。

---

## 10. 剩余卡点（2026-10-29 复核）

| 类别 | 内容 | 阻塞？ |
|---|---|---|
| 需要人 | 无。本轮全部离线可验（RSS 峰值 + 断言 + 台账闸） | ❌ 不需要用户参与 |
| 需要外部 | 无（不碰后端） | ❌ |
| 技术不确定 | 流式后 seek 行为在真机播放器上的表现（离线只能验 206 语义，不能验播放器交互） | ⚠️ 有回退开关；真机播放验证列入交付后清单 |
| 工程约束 | `routes.ts` 4400+ 行棘轮 —— 本轮只改一个路由内的 5 处响应，**净增 ≤ 60 行**，注意棘轮 | ❌ 已量化 |

**结论：零阻塞，可直接开工 T0。**
