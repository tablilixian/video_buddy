# 交接提示词 · Canvas Studio REQ-022 故事板评审问题修复批

> **用法**：把本文件全文粘进新会话。它是**自足的**——不需要重新分析项目；按 §9 的命令直接开工。
> **背景文档**（可选深读）：[REQ-022-storyboard功能评审报告-20261012.md](./REQ-022-storyboard功能评审报告-20261012.md)（每个问题的完整推理都在那，本文只留施工规格）。

## 0. 你的任务

修复 2026-10-12 对 REQ-022「拍摄定稿」功能评审发现的问题，按四个批次推进：

| 批 | 内容 | 必做？ |
|---|---|---|
| **A（P0）** | SB-01 落地顺序缺陷 + SB-02 落地版本漏传 | **必做，先做** |
| **B（P1）** | SB-03 阶段守卫漏 `keyframe_review` + SB-04 撤回指向不存在工具的文案 | 必做 |
| **C（P2）** | SB-05 `resolveShotRefs` 认语义引用 + SB-06 落地 TOCTOU 复核 | 建议做 |
| **D（P3）** | SB-07~12 小账（日志/注释/滚动/持久化/死代码/体验） | 可选，能修则修 |

**契约层的三个大缺口（`revise_storyboard` 实现、L 类回写、A 类 actuals）不在本批范围**——本批只撤文案（SB-04），不实现新工具。若用户明确要求实现，先要求拍板范围再动手。

## 1. 环境（照抄；不要用裸 yarn）

- 仓库根：`/Users/wl/Desktop/job/learn/video_buddy`（桌面产品仓；插件是子目录 `canvas-studio/`）
- **全局 yarn 是 1.x，会被 `packageManager` 字段拒绝** ⇒ 一律 `corepack yarn ...`
- 全部命令在 `canvas-studio/` 下执行：
  - `corepack yarn typecheck`
  - `corepack yarn build` —— clean + tsdown + `tsc -p tsconfig.json` + `tsc -p tsconfig.client.json --emitDeclarationOnly`。⚠️ 沙箱内 build 首步 clean.mjs 会撞批量删除阈值 ⇒ 改为逐步骤：`node node_modules/.bin/tsdown && tsc -p tsconfig.json && tsc -p tsconfig.client.json --emitDeclarationOnly`
  - `corepack yarn verify:loader` —— 客户端模块注册 smoke
  - `corepack yarn test:smoke` —— 跑的是 **`lib/` 产物**（必须先 build）；门禁包装 `scripts/run-smoke.mjs`：失败集合 ⊆ `tests/baseline-red.json` 才算过
  - 要跑原始 `node --test` 用 `test:smoke:raw`
- **验证链铁律（顺序不能变）**：`corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke`
- **基线红已清零（2026-10-01）**：`tests/baseline-red.json` 的 `failing` 为空数组 ⇒ **任何 smoke 红都是真回归**，名单外新增红即非 0。名单内红若被修好，同步移除条目。
- ⚠️ **`deepseek-harness/` 是 pinned Git 子模块，永不修改**；每次收尾用 `git status --short deepseek-harness/` 确认干净（应为空）
- 不要跑根仓脚本、不碰 Electron/打包；graphical launch 保持显式，一切验证 headless-safe

## 2. 仓库地图（只需要这些）

| 路径 | 作用 |
|---|---|
| `src/routes.ts` | 全部 HTTP 路由；**SB-01/SB-06 落点**：`landStoryboard`（约 :189-255）、`assertNotLanded`（约 :114-120）、land 路由分发（约 :1853） |
| `src/client/StudioFrame.tsx` | 工作台外壳 + 故事板覆盖层；**SB-02 落点**：`handleLand`（约 :1595-1605）、落地按钮（约 :2451-2460）、iframe（约 :2581-2588）、`storyboardDismissedRef`（约 :445） |
| `src/client/index.ts` | 客户端 API 收口；`landStoryboard(projectId, version?)`（约 :1340-1348）、`bumpStoryboardRev` 结算点（约 :1645-1659） |
| `src/client/api.ts` | HTTP 封装；`landStoryboard`（约 :359-373，**已支持 version 参数**） |
| `src/host-tools.ts` | agent 工具；**SB-03/SB-04 落点**：`write_storyboard` 阶段守卫（约 :2347-2356）；**SB-05 落点**：`resolveShotRefs`（约 :1100-1129）；SB-11 死代码（约 :862-1099） |
| `src/contracts/storyboard.ts` | wire 契约事实源（797 行）；**SB-04 连带**：:689 注释提 `revise_storyboard` |
| `src/contracts/canvas.ts` | `SEED_SHOT_TOOL`（:509）、`isShotCard` 双值谓词（:530-531）、节点/资产 `sbRef` 字段（:162/:361） |
| `src/contracts/project.ts` | `StudioWorkflowState` 三态（:23） |
| `src/storyboard-store.ts` | 落盘层：串行队列、`updateStoryboard` 读改写原子入口（:153-165）、`ensureStoryboardSkeleton`（:187-203） |
| `src/storyboard-seed.ts` | seed 纯投影；锚点标题模板（:146）、分镜卡 `sbRef`（:183）——SB-01 幂等防护要用 |
| `src/storyboard-seed.ts` / `storyboard-history.ts` / `storyboard-diff.ts` / `storyboard-render.ts` / `storyboard-discipline-prompt.ts` | 本批大概率只碰 discipline-prompt 的头注（SB-08） |
| `tests/storyboard-*.test.mjs` | 7 个既有测试文件；新增测试放同目录 |
| `tests/reference-slot-wiring.test.mjs` | **接线守卫测试的范本**（源码字符串断言）；SB-02 的守卫测试仿它写 |
| `tests/resolve-refs-route.test.mjs` 等 `*-route.test.mjs` | **路由级测试的范本**（假 ctx.webServer + 假 registry + 真 http）；SB-01 的路由测试仿它写 |
| `docs/STATUS.md` | **CV 状态唯一事实源**（§4 全量表 + §8 变更记录；§1 速览由脚本生成勿手改） |
| `docs/canvas-ux-backlog.md` | CV 条目技术细节 + 变更记录 |
| `docs/tracking.md` | 需求级映射账本（涉 REQ 时镜像同步） |
| `docs/DEV-WORKFLOW.md` | 「四收尾必更文档」纪律 |

## 3. REQ-022 一分钟背景

「拍摄定稿」= 两阶段创作的阶段一：agent 用 `write_storyboard` 把九节结构（创意/事实/视觉/旁白/分镜/角色/声音/素材/约束）写进 `storyboard.json`（SSOT）；用户在中栏覆盖层（零 JS iframe）审阅、对比版本；点「确认落地」→ Host 校验（`validateForSeed` blocker 拦截）→ seed 投影成画布节点（锚点文档 + 分镜卡×N + 角色卡等）→ 工作流进 `executing`。**落地是单向终点**：`landed` 置位后一切版本写操作被 `assertNotLanded` 冻结。

已落地批次：CV-293（增量批：契约+store+render+工具）、CV-295（原子批：3 态迁移+工具下线+落地+seed）、CV-295a/295b/296（seed/纪律注入/分节合并）。`revise_storyboard`（落地后结构修订）、L 类回写、A 类 actuals 均**未实现**（排在 P2+）。

## 4. 批次 A（P0）—— 落地正确性，必须先做

### 4.1 SB-01 落地顺序：`landed` 先于画布写入，失败即永久锁死

**现状**（`src/routes.ts:216-246`）：

```
:229 updateStoryboardOrFail(...)  ← landed 在 :235 被置位
:239 registry.writeCanvas(...)    ← 之后才写画布
:246 registry.updateWorkflow(...) ← 再推状态
```

:216 的注释写的是「先固化再写画布：万一写画布失败，`landed` 尚未置位，用户可重试」——**注释与代码相反**。`writeCanvas`/`updateWorkflow` 一抛错：`landed !== null` → `assertNotLanded` 拒绝一切重试 → 画布无节点、state 未变 → 用户卡死无出路。

**修复约束（顺序与幂等都要，缺一不可）**：

1. `landed` 置位必须在 `writeCanvas` **成功之后**（简单交换不够，见 2）；
2. **幂等防护**：若「writeCanvas 成功、置 landed 失败」后用户重试，不得重复追加 seed 节点。可行方案（择一，写清理由）：
   - 重试路径先查画布是否已有本次落地的锚点（`toolName === SEED_ANCHOR_TOOL`，标题形如 `${document.title} 拍摄定稿 · ${sourceVersion}`，见 `storyboard-seed.ts:146`）——已有则跳过 writeCanvas 只补置 landed 与 state；
   - 或把「置 landed」与「写画布」的失败都做成可安全重入（writeCanvas 前 diff 计划节点 id 是否已在画布——但 seed 的 id 每次 `crypto.randomUUID()` 新生成，**不能按 id 判重**，须按锚点标题/toolName 判）。
3. **注释必须与最终代码一致**（:216 这条错注释已误导过一次评审）；
4. `updateWorkflow` 失败的处理：至少保证 `landed`+画布已就位时 state 可被下次操作或手动修复——最小做法：把 updateWorkflow 移到置 landed 之前也行（state 是可重放的投影），但**不得**让「画布没写成但 landed 置位」的组合出现。顺序建议：validate → seed plan →（幂等检查）writeCanvas → updateWorkflow → 置 landed+bindings+checkpoint；或 writeCanvas → 置 landed → updateWorkflow 并接受「state 失败可由后续 confirm/重试修复」——**两案选一，写进 STATUS**。

**测试（新增 `tests/storyboard-land-route.test.mjs`，仿 `resolve-refs-route.test.mjs` 的假 ctx/registry + 真 http 脚手架）**：

1. 注入 `writeCanvas` 抛错的假 registry → POST land → 断言响应失败且重读 storyboard `landed === null`；
2. 上一步失败后再 POST land（registry 恢复正常）→ 断言成功、画布节点恰好一份（无重复）；
3. 正常 land → 断言 `landed` 非空、画布含 `SEED_ANCHOR_TOOL` 节点、workflow 为 `executing`（回归现有行为）；
4. land 两次（第一次成功）→ 第二次被 `assertNotLanded` 拒绝。

**注意**：`tests/` 里从 `lib/*.js` 导入 ⇒ 改完必须 build 再跑 smoke。

### 4.2 SB-02 落地版本漏传：按钮说「落地 vN」，实际落活副本

**现状**（`src/client/StudioFrame.tsx:1595-1605`）：

```ts
const handleLand = (): void => {
  ...
  void landStoryboard(projectId).then(...)   // ← 漏传 sbVersion
}
```

按钮 title/文案（:2455-2460）却承诺 `落地 ${sbVersion}`。整条链路（`index.ts:1340` → `api.ts:359` → `routes.ts:1853/189`）**都已支持 version**，纯 UI 漏一行参数。

**修复**：`landStoryboard(projectId, sbVersion)`。

**测试**：接线守卫（仿 `tests/reference-slot-wiring.test.mjs`）：读 `StudioFrame.tsx` 源码，断言 `handleLand` 内 `landStoryboard(` 调用带第二参 `sbVersion`（字符串断言，注意编译产物里标识符会变、源码断言打的是 src）。

**桌面验收清单（交给用户）**：① 两版内容不同的故事板，选中旧版点「落地 vN」→ 画布节点内容 = 旧版；② 选活副本点「确认落地」→ 内容 = 活副本；③ 落地后版本面板出现「已落地，写操作已冻结」。

## 5. 批次 B（P1）—— 守卫与文案

### 5.1 SB-03 阶段守卫漏 `keyframe_review`

**现状**（`src/host-tools.ts:2351-2356`）：只拦 `state === 'executing'`。三态已上线，`keyframe_review` 期 `write_storyboard` 可整体重写 §04——关键帧已是制作产物，重写即失配。:2349-2350 的过渡注释自认此事（「原子批换成 storyboarding 单值放行」——批已做完，守卫没跟上）。

**修复**：放行条件收紧为 `storyboarding` 与 legacy（`state === undefined`）：

```ts
const state = project?.workflow?.state
if (state !== undefined && state !== 'storyboarding') {
  throwError('CS-USER-ERR', { message: '……' })  // 文案见 5.2
}
```

**测试**：`write_storyboard` 在 `keyframe_review` 态必须 `CS-USER-ERR`；`storyboarding` 态正常落盘（可扩 `tests/workflow-gate.test.mjs` 或新例）。注意回归：`storyboarding` 态的 CV-296 分节合并语义不许变。

### 5.2 SB-04 撤回指向不存在工具的文案

**现状**：

- `host-tools.ts:2354` 报错文案引导「请改用结构修订（只增删/改具体分镜）」——`revise_storyboard` **全库无实现**（排 P2）；agent 会去找一个不存在的工具。
- `contracts/storyboard.ts:689` 注释「`revise_storyboard` 前置校验」同样误导。

**修复**：

1. 报错文案改为诚实表述（建议）：「当前阶段（关键帧审阅/制作中）不支持整体重写故事板；`write_storyboard` 仅限规划期（storyboarding）使用。如需调整规划，请在落地前完成。」——与 SB-03 的新守卫配套；
2. `contracts/storyboard.ts:689` 注释改为「（未来 `revise_storyboard` 的）前置校验」或删除该引用；
3. **不要**实现 `revise_storyboard`。

**测试**：grep 级守卫可选——断言 `host-tools.ts` 报错文案不含 `revise_storyboard` 字样。

## 6. 批次 C（P2，建议做）

### 6.1 SB-05 `resolveShotRefs` 认语义引用

**现状**（`host-tools.ts:1100-1129`）：`shotRefs` 只认 ①节点 id ②卡标题精确 ③`分镜 N` 前缀。seed 分镜卡自带 `sbRef='04:<scene>/shots/<shot>'`（`storyboard-seed.ts:183`），`image_generate.storyboardRef` 口径是语义 id（`S1-Sh1`）——第 4 种形态数据在、解析不认，agent 传语义 id 直接报错且提示固化旧口径。land 时算的 `bindings`（`routes.ts:217-226`）全库无人读。

**修复**：在既有三条匹配链后追加：

1. `node.sbRef === raw` 精确命中（全量画布节点扫 `sbRef`，不只 shot 卡——角色/声音节点也可被引用）；
2. raw 命中 `/shots/<id>` 尾段语义 id（即 raw 为 `S1-Sh1` 形态时按 `sbRef.endsWith('/shots/' + raw)` 匹配分镜卡）；
3. 报错提示补两种新写法（「或故事板语义 id（如 S1-Sh1）/ sbRef」）。

**测试**：扩 `tests/shot-cards.test.mjs` 或新增例：四种写法（节点 id/标题/分镜 N/语义 id/sbRef）各一正例 + miss 报错文案断言。注意从 `lib/host-tools.js` 导入的是导出函数——确认 `resolveShotRefs` 有导出或经工具 execute 路径测。

### 6.2 SB-06 落地 TOCTOU 复核

**现状**（`routes.ts:194-237`）：validate 用的读（:194）与置 landed 的读改写（:229）是两次独立入队；窗口内 `write_storyboard` 并发落盘 → `landed.sections` 固化旧 frozen、活副本已新——静默落旧料。

**修复（最小）**：`updateStoryboardOrFail` 的 mutate 里复核 `current.sections` 与规划时的 `frozen` 深一致（`JSON.stringify` 或逐节引用比较；注意 frozen 若来自历史版本 snapshot 则与活副本本就不同——**只在落活副本路径复核**），不一致即抛「故事板刚被修改，请重新确认落地」。

**测试**：单测或路由级——先入队一个改 sections 的 `updateStoryboard`，再 land → 期望明确报错（若时序难控，可将复核逻辑抽纯函数单测）。

## 7. 批次 D（P3，可选）

| 编号 | 落点 | 动作 |
|---|---|---|
| SB-07 | `routes.ts:794` | `.catch(() => undefined)` 改为记 warn 日志（拿 `ctx.logger`） |
| SB-08 | `storyboard-discipline-prompt.ts:10` | 头注 `versions.final` → `document.landed` |
| SB-09 | `StudioFrame.tsx` iframe | 低优先：内容未变不 bump（需 Host 侧内容指纹）或滚动位置记忆；零 JS 约束下可只记账不做 |
| SB-10 | `StudioFrame.tsx:445` | `storyboardDismissedRef` 持久化到 sessionStorage（key 带 projectId） |
| SB-11 | `host-tools.ts:862-1099` | 旧分镜表解析死代码：**只登记决策进 tracking**（保留待删 or 等 revive），本批不删（有测试引用，删除是独立批） |
| SB-12 | 覆盖层 | blockers 可视化（缺节高亮）：体验增强，可只记账 |

## 8. 纪律与红线

1. **CV 编号**：已编到 **CV-301**；**CV-302** 已被「首屏覆盖层与画布同帧出现」修复占用（在途、待桌面验收后登记）⇒ **新条目从 CV-303 起**；**写号前 grep 整个 `docs/`**（不只 STATUS.md——撞过三次）。〔2026-10-12 更正：本行原写「已编到 CV-299、新条目从 CV-300 起」——随后 CV-300 / CV-301 被两个**未登记且撞号**的本地提交占用并已改号登记，见 STATUS §4 / §8 2026-10-12 行〕建议：批 A = CV-300（落地正确性批，SB-01+SB-02 一条号；若你判断该拆两条则 CV-300/301）。
2. **收尾四步（每批强制）**：① `docs/STATUS.md` §4 加行 + §8 变更记录 + §0「已编到」跟进 → 跑 `node scripts/status-summary.mjs`（§1 速览勿手改）；② `docs/canvas-ux-backlog.md` 变更记录；③ `docs/tracking.md` 镜像（涉 REQ-022 行）；④ `git add` **精确路径**（勿 `git add canvas-studio/`），提交信息带条目号：`fix(canvas-studio): …（CV-xxx）`。
3. **可单测的纯函数放 `src/*.ts`，不放 `src/client/**`**（Host tsconfig 排除 client）；client 引用新根级模块须显式追加 `tsconfig.client.json` include。
4. **接线守卫**：本仓库最看重「判定对了但没接上」的失败模式——SB-02 必须有源码级字符串断言测试。
5. **非幂等操作入口加状态守卫**（别在 UI 层逐处防抖）；**UI 可见性判定与执行侧前置检查共用同一纯函数**。
6. **`src/client/styles.ts` 红线**：无反引号、无幽灵令牌、keyframes 三语义名、选择器 `.cs*`；守卫 `tests/visual-tokens.test.mjs`。本批大概率不碰 styles，碰了必跑。
7. **不动**：`deepseek-harness/`；`contracts/canvas.ts` 持久化形状（`sbRef` 已存在无需改）；不吞并 CV-054/055 节点版本化线；不在 UI 裸 `fetch`（走 `api.ts`）。
8. **不要做的**：不实现 `revise_storyboard` / L 类回写 / actuals（除非用户单独拍板）；不删旧解析函数（SB-11 只登记）；不「顺手修绿」名单内基线红（当前名单为空，故=任何红都要修真因）。
9. **路由测试脚手架坑**（照 `tests/resolve-refs-route.test.mjs` 抄）：Node keep-alive ⇒ `agent: false` + `closeIdleConnections/closeAllConnections` 再 `close()`；假 `ctx.webServer.register` 必须返回 disposer；同源测例显式给 `origin` 头。

## 9. 开工顺序（照这个顺序做）

```bash
cd /Users/wl/Desktop/job/learn/video_buddy/canvas-studio

# 1) 存基线（基线红应为 0）
corepack yarn typecheck && corepack yarn build
corepack yarn test:smoke 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"

# 2) 登记批 A 的 CV 行（CV-30x —— 开工时按当时的「已编到」重新取号，勿沿用本行数字）到 docs/STATUS.md §4，跑：
node scripts/status-summary.mjs

# 3) 修 SB-01（routes.ts 落地顺序 + 幂等 + tests/storyboard-land-route.test.mjs）
# 4) 修 SB-02（StudioFrame.tsx handleLand 传参 + 接线守卫测试）
# 5) 验证：
corepack yarn typecheck && corepack yarn build && corepack yarn verify:loader && corepack yarn test:smoke
git status --short deepseek-harness/     # 必须为空

# 6) 批 A 收尾四步（§8.2）+ 给用户桌面验收清单（§4.2 末）
# 7) 依次批 B（SB-03/04）→ 批 C（SB-05/06）→ 批 D（能做多少做多少）
```

**每批完成时交给用户**：① 一页改动摘要；② 测试数字（净增/净过/红=0）；③ 桌面验收清单（用户能点出的动作 + 期望现象）；④ 明确说清哪些批**未做**。

## 10. 已知欠账（不要顺手扩scope）

1. `revise_storyboard` 实现、L 类回写、A 类 actuals —— 各需独立 REQ 排期（见评审报告 §五 G1-G4）。
2. `bindings` 的完整消费生态（不只是 SB-05 的解析）——随 G1/G2 一起设计。
3. 仓根有未跟踪文件 `不要提交这个文件.md`（用户明确要求保留工作区不提交，**任何提交都勿带它**）。
4. 覆盖层 dismissed 持久化（SB-10）与滚动体验（SB-09）若批 D 时间不够，登记 backlog 即可。
