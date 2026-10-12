# REQ-022 故事板（拍摄定稿）功能评审报告（2026-10-12）

> **性质**：只读设计评审，零代码改动。行号以当日工作区为准。
> **配套交接**：修复批的自足交接提示词在 [REQ-022-storyboard修复交接提示词.md](./REQ-022-storyboard修复交接提示词.md)（可整段粘进新会话）。
> **评审范围**：REQ-022「两阶段 Storyboard → 画布」阶段一已落地部分（CV-293 / CV-295 / CV-295a / CV-295b / CV-296），含契约、落盘、seed、渲染、版本、diff、纪律注入、覆盖层 UI 与全部关联测试。

---

## 一、一句话结论

**数据层与渲染层是仓库级的高水准实现（纯函数 + 判定测试钉边界 + 唯一完成度判据），但「落地」这条唯一不可逆链路上有两个可复现的产品级 bug（一个会把项目永久锁死在「已落地但什么都没发生」的状态，一个是静默投错料且不可撤销），且契约承诺的「回写半场」（`revise_storyboard` / L 类回写 / A 类 actuals）整体缺席、UI 与报错文案却已按「存在」来引导用户。**

---

## 二、架构速览（评审对象的形状）

### 2.1 分层

| 层 | 文件 | 职责 |
|---|---|---|
| 契约 | `src/contracts/storyboard.ts`（797 行） | wire 类型 + 宽松归一化 + `validateForSeed`（唯一完成度判据）；纯函数零 IO |
| 落盘 | `src/storyboard-store.ts` | `storyboard.json` 读写；模块级串行队列（读也排队）；损坏 → `.corrupt` 留证；四态 `StoryboardLoad`（ok/missing/corrupt/stale） |
| seed | `src/storyboard-seed.ts` | 终版 → 画布节点/资产的纯投影（只造骨架，不预生成媒体） |
| 渲染 | `src/storyboard-render.ts` | `renderStoryboard*` → 零 JS 覆盖层 HTML；全字段 `escapeHtml` |
| 版本 | `src/storyboard-history.ts` | archive / restore / relabel / nextVersionId；全量快照、seq 只增 |
| diff | `src/storyboard-diff.ts` | 字段级 `diffSections`，按 shot/line ID 配对（插镜不误报） |
| 纪律注入 | `src/storyboard-discipline-prompt.ts` | 落地后 §00/§02/§08 进 system prompt（order 153，per-cwd 缓存） |
| 路由 | `src/routes.ts` | `/canvas-studio/storyboard` 前缀路由；land / archive / restore / rename / diff / HTML 分发 |
| 工具 | `src/host-tools.ts` | `write_storyboard`（九节 JSON 入参、分节合并）；`attachImageToStoryboard` |
| 客户端 | `src/client/StudioFrame.tsx` + `index.ts` + `api.ts` | 覆盖层状态机、版本面板、iframe、`bumpStoryboardRev` 刷新信号 |

### 2.2 数据模型要点

- 顶层文档 `StoryboardDocument`（`contracts/storyboard.ts:243-254`）：`sections` 九节（00 创意 / 01 事实 / 02 视觉 / 03 旁白 / 04 两级分镜 scenes[].shots[] / 05 角色 profile-gen 分离 / 06 声音 / 07 素材引用 / 08 硬约束）+ `versions` + `landed` + `bindings` + `actuals`。
- 版本是**全量快照**非 delta（:175-187）；打点只在四个时刻：首稿 / 用户存档 / 回退前 / 落地固化（:192-194）。
- `landed` 刻意不进 `versions`（:204-213）：落地产物生命周期与版本历史不同，落地即冻结。
- `bindings`（sbRef ↔ 画布 UUID，:216-220）与 `actuals`（A 类实况，:227-232）在快照之外。

### 2.3 主链路

1. 建项目 → `ensureStoryboardSkeleton` 预建仅含 meta 的 v1 空壳（`storyboard-store.ts:187-203`；失败静默，`routes.ts:794`）。
2. agent `write_storyboard`（`host-tools.ts:2304-2477`）：状态守卫 → 逐节 `JSON.parse`（解析失败拒落盘）→ 拒 corrupt/stale → `mergeStoryboardWrite` 分节合并（没传=保留，CV-296）→ `normalizeStoryboard` → `validateForSeed` 只报不拦 → missing 则首稿 v1 / 骨架就地填 v1 / 否则只更活副本不打点。客户端 `onToolFinished` 里 `bumpStoryboardRev`（`client/index.ts:1650`）→ iframe 换 `?rev=` 重渲染。
3. 落地 `POST /storyboard/land` → `landStoryboard`（`routes.ts:189-255`）：`assertNotLanded` → 选版本或活副本 → `validateForSeed` 有 blocker 即拒 → `planSeedFromStoryboard` → 算 `bindings` → 固化 `landed` → `writeCanvas` 追加 seed 节点/资产 → `updateWorkflow state:'executing'`。seed 产物：锚点文档（无 sbRef）+ 分镜卡 ×N（`sbRef='04:<scene>/shots/<shot>'`，`storyboard-seed.ts:183`）+ style 资产（`sbRef='02:look'`）+ 旁白声音节点（`sbRef='03'`）+ 角色资产卡与占位图（`sbRef='05:<C id>'`）。
4. 效果图回写：`image_generate` 带 `storyboardRef` → `attachStoryboardImage`（`contracts/storyboard.ts:371-395`）绝不抛错（miss 降级提示）→ `onStoryboardTouched` bump。
5. 落地后：§00/§02/§08 经 `storyboard-discipline-prompt.ts` 注入 system prompt；版本写操作全部被 `assertNotLanded`（`routes.ts:114-120`）冻结。

### 2.4 UI

顶条「拍摄定稿」按钮 → 对话框（`StudioFrame.tsx:2420-2589`）：头部（版本按钮 / 展开 / **确认落地** / 关闭——storyboarding 且未落地时隐藏关闭，:2465）+ 版本面板（选中 / 对比 / 回退 / 改名）+ iframe（零 JS 文档，差异高亮由 Host 侧渲染进 HTML）。storyboarding 态自动弹出；`storyboardDismissedRef` 内存 Set 记「关过不再弹」（:445）。

### 2.5 测试资产

`tests/storyboard-{contract,store,seed,render,history,diff,merge}.test.mjs` 共 70+ 例，打的都是真实翻车边界：损坏≠空、并发 10 写不丢、队列前序失败不阻断、XSS 文本/属性双转义、diff 按 ID 配对、镜号 1..N 不重排、占位节点不带 generationPrompt、分节合并「没传=保留」。`tests/baseline-red.json` 的 `failing` 为空（2026-10-01 清零）——**任何 smoke 红都是真回归**。

---

## 三、优点（为什么这套设计的骨架是对的）

### 3.1 设计思路

1. **SSOT 与投影的分层**。`storyboard.json` 与 `canvas.json` 同级独立，画布只是它的 seed 投影——「故事板是规划事实源、画布是派生物」从类型到落地链路一以贯之。比旧流程（markdown 分镜表塞节点文本靠解析器读回）高一个量级。
2. **纯函数纪律**。契约/store/seed/diff/history/render 六层全部「判定纯函数 + IO 薄壳」；`validateForSeed` 被钦定为唯一完成度判据（`contracts/storyboard.ts:15-16`），杜绝「UI 说能点、执行侧说不行」的双标——与 `canvas-studio/AGENTS.md` 的核心纪律完全一致。
3. **blocker / warning 二分**是正确的产品判断：「能不能落地」与「落得好不好」分开，agent 不会因告警空转。
4. **「损坏≠空」语义**（`storyboard-store.ts:9-11`）：canvas 读坏降级空文档（可抛弃的 UI 状态），storyboard 读坏必须留证 + 拒绝继续（用户创作资产）。洞察正确，且已抽共享件 `file-quarantine.ts` 防漂移。
5. **镜号一次铸造永不重排**（`storyboard-seed.ts:19-21`）：素材组/产物命名钉在镜号上，重编=全线孤儿——对下游生态是必要的，测试钉住了。
6. **schema 闸门在归一化之前**（`storyboard-store.ts:97-104`）：避免旧形状被归一化伪装成「新格式的空值」= 静默清稿。

### 3.2 展现方式

1. **零 JS iframe 覆盖层**是聪明取舍：HTML 由 Host 纯函数生成、XSS 全字段转义（14 例专测），React 侧零故事板逻辑泄漏——渲染正确性全部收进可单测纯函数。
2. **版本面板信息密度合适**：活副本行 + 版本行（自动徽标 / baseline 徽标 / 对比 / 回退 / 改名）+ 字段级 diff 高亮，且按 ID 配对避免插镜误报——版本对比最易翻车处做对了。
3. **设计决策注释诚实**：如「storyboarding 态隐藏关闭」（`StudioFrame.tsx:2462-2464`）把「为什么」写清楚了，后续修改者不会误删。

### 3.3 数据与健壮性

1. **九节结构分工明确**：§05 角色 profile（人读、不上画布）/ gen（机读、落画布可回写）分离（`contracts/storyboard.ts:105-115`）——一份数据两个消费面，为 L 类回写留了干净接缝。
2. **宽松归一化的哲学正确**（:402-403）：「宁可留空让 blocker 说话，也不猜值」；非法数字归 0、非法枚举归 fallback——读盘不因一个脏字段整体崩，脏数据交给 validator 指名道姓报出。这是对 agent 生成内容的正确防御姿态。
3. **串行队列失败语义正确**（`storyboard-store.ts:62-68`）：前序失败不阻断后续（`then(task, task)`），一档写失败不会让该项目所有编辑永久卡死。
4. **`attachStoryboardImage` 绝不抛错**（`contracts/storyboard.ts:368-369`）：生成昂贵、回写廉价，回写失败不该让整次生成调用失败——错误优先级正确。
5. **测试是仓库标杆**：70+ 例全部钉真实失败模式，`baseline-red` 清零后门禁是硬的。

---

## 四、问题清单

编号 SB-xx 为本报告内部号；修入代码时按仓库规则取 CV 号（**已编到 CV-299，新条目从 CV-300 起，写号前 grep 整个 `docs/`**）。

### 4.1 P0 —— 正确性，立即修

#### SB-01【严重】落地顺序与注释相反：`landed` 先于画布写入，失败即项目永久锁死

- **位置**：`src/routes.ts:216-246`（`landStoryboard`）。
- **现象**：:216 注释写「先固化再写画布：万一写画布失败，`landed` 尚未置位，用户可重试」，但代码实际顺序是 `updateStoryboardOrFail`（:229-237，**此处已把 `landed` 置位**，:235）→ `registry.writeCanvas`（:239-245）→ `updateWorkflow`（:246）。注释描述的意图与代码做的事**相反**。
- **触发**：`writeCanvas` 或 `updateWorkflow` 抛错（磁盘满 / 文件锁 / canvas 目录权限 / 并发写 canvas 均可）。
- **后果**：文档 `landed !== null` → `assertNotLanded`（:114-120）拒绝一切版本写操作与重落地；画布上没有 seed 节点；state 未进 `executing`。用户卡在「已落地但什么都没发生」，**UI 上没有任何出路**（覆盖层无法关——storyboarding 态关闭按钮隐藏；无法改；无法重落）。
- **为什么测试没兜住**：`landStoryboard` 是 `routes.ts` 模块私有函数，`tests/` 无任何 land 路由测试（grep 确认零命中）；store 层测试只测单文件读写，测不到跨文件顺序。
- **修法方向**（修入会话拍板，此处给约束而非定稿）：
  1. **硬约束 A**：`landed` 置位必须发生在画布写入**成功之后**；
  2. **硬约束 B**：修完后「任一步失败 → 用户重试」必须收敛（不能引入重复 seed 节点）——单纯交换两行会让「writeCanvas 成功、置 landed 失败」时重试重复追加节点，需幂等防护（如重试前检测是否已有本次落地的 seed 锚点：`toolName === SEED_ANCHOR_TOOL` 且标题匹配 `document.title 拍摄定稿 · <sourceVersion>`，见 `storyboard-seed.ts:146` 的标题模板）；
  3. **硬约束 C**：:216 的注释必须与最终代码一致（这条注释已经误导过一次评审，不许再留错的）。
- **验收判据**：① 路由级测试：注入一个 `writeCanvas` 抛错的假 registry → 落盘后 `document.landed === null`、可再次 land；② 路由级测试：第一次 land 在「置 landed 前」失败后重试 → 画布节点不重复；③ 桌面：正常 land 一次，行为与现网一致（画布出节点、state 进 executing、版本冻结）。

#### SB-02【严重】选中历史版本点「落地 vN」，实际落的是活副本

- **位置**：`src/client/StudioFrame.tsx:1595-1605`（`handleLand`）。
- **现象**：按钮文案与 title 承诺「把历史版本 ${sbVersion} 落成画布节点」（:2455-2457、:2460 `落地 ${sbVersion}`），但 `handleLand` 调的是 `landStoryboard(projectId)`——**漏传 `sbVersion`**。
- **链路早已备好，纯 UI 漏接**：`client/index.ts:1340-1348` `landStoryboard(projectId, version?)` → `api.ts:359-373`（body 带 `version`）→ `routes.ts:1853` `landStoryboard(registry, projectId, asText(record.version))` → `routes.ts:189-201` 选版本逻辑完整（`versionById`、找不到报错、落历史版本不补 checkpoint）。
- **后果**：用户回看、对比、选中某历史版本（如 v3）点「落地 v3」→ 得到的是**活副本**内容；落地后 `assertNotLanded` 冻结、不可撤销——**静默投错料且不可逆**。恶劣之处：它发生在用户最谨慎的操作路径上（对比→选版→落地），信任成本极高。
- **桌面复现**（唯一能手动复现的 P0）：项目写两版内容不同的故事板 → 版本面板选中旧版 → 点「落地 vN」→ 画布 seed 节点内容是活副本而非 vN。
- **修法**：`handleLand` 改为 `landStoryboard(projectId, sbVersion)`。
- **验收判据**：① 桌面复现路径走一遍，画布节点内容 = 所选版本快照；② 接线守卫测试（仿 `tests/reference-slot-wiring.test.mjs` 源码字符串断言）：`StudioFrame.tsx` 中 `handleLand` 必须把 `sbVersion` 传给 `landStoryboard`。

### 4.2 P1 —— 明确缺陷，本批修

#### SB-03【中】阶段守卫只拦 `executing`，`keyframe_review` 期可整体重写故事板

- **位置**：`src/host-tools.ts:2352`。
- **现象**：`write_storyboard` 的阶段守卫是 `state === 'executing'` 才拒；但三态已上线（`contracts/project.ts:23` `StudioWorkflowState = 'storyboarding' | 'keyframe_review' | 'executing'`，`workflow-stage.ts:6`）。`keyframe_review` 期 agent 仍可**整体重写 §04**——此时关键帧已是制作产物，重写会让画布产物与规划失配，正是该守卫要防的事。
- **自证**：:2349-2350 注释自己写着「原子批换成 `storyboarding` 单值放行」——三态迁移（CV-295 原子批）做了，守卫没跟上，过渡注释留成了现行代码。
- **修法**：收紧为「仅 `storyboarding`（与 workflow 缺失的 legacy 项目）放行」：`const state = project?.workflow?.state; if (state !== undefined && state !== 'storyboarding') 拒`。报错文案随 SB-04 一并改。
- **验收判据**：`keyframe_review` 态调 `write_storyboard` 得到 `CS-USER-ERR` 且文案不提不存在的工具；`storyboarding` 态行为不变（含 CV-296 分节合并语义）。

#### SB-04【中】报错文案与契约注释指向不存在的 `revise_storyboard`

- **位置**：`src/host-tools.ts:2348-2354`（「请改用结构修订（只增删/改具体分镜）」）；`src/contracts/storyboard.ts:689`（「`revise_storyboard` 前置校验」）。
- **事实**：`revise_storyboard` **全库无实现**（grep 命中仅限注释、docs、演示 HTML）；契约把它排在 P2（`REQ-022-详细开发计划.md:203`）。executing 期被守卫拦后，agent 按文案去找「结构修订」= 死胡同，可能循环重试。
- **修法（本批）**：撤文案——报错改为诚实表述，如「当前阶段（已进入制作）不支持整体重写故事板；该入口仅限规划期使用」；`contracts/storyboard.ts:689` 注释同步改为「（未来）`revise_storyboard` 前置校验」或删去引用。**不要**在本批实现 `revise_storyboard`（见 §五 G1，属排期决策）。
- **验收判据**：全库 grep `revise_storyboard` 仅存在于 docs/ 演示与明确标注「未实现/排期中」的注释里，工具报错路径零命中。

### 4.3 P2 —— 设计欠账，本批或紧随批修

#### SB-05【中】`resolveShotRefs` 不认契约钦定的语义引用，`bindings` 写了没人读

- **位置**：`src/host-tools.ts:1100-1129`。
- **现象**：`shotRefs` 只接受 ① 节点 id ② 卡标题精确 ③ `分镜 N` 前缀。但 seed 产出的分镜卡带 `sbRef='04:<scene>/shots/<shot>'`（`storyboard-seed.ts:183`），`image_generate.storyboardRef` 的口径是 shot 语义 id（`S1-Sh1`，`contracts/storyboard.ts:72`）——**第 4 种引用形态（sbRef / 语义 id）契约里有、数据里有、解析器不认**。agent 按故事板语义 id 传 `shotRefs` 直接 `CS-USER-ERR`（:1124），且报错提示只提「卡片标题或节点 id」，进一步固化旧口径。
- **连带**：`landed` 时算出的 `bindings`（`routes.ts:217-226`，sbRef → canvasNodeId/AssetId）**全库无消费方**——双向映射建了不用等于白建。
- **修法**：`resolveShotRefs` 增加两条解析：`node.sbRef === raw` 精确命中；或 raw 为纯语义 shot id 时按 `sbRef` 尾段 `/shots/<raw>` 匹配（或查 `document.bindings`）。报错提示同步补上两种新写法。
- **验收判据**：seed 后用 `04:S1/shots/S1-Sh1` 与 `S1-Sh1` 两种写法传 `shotRefs` 均解析成功；旧三种写法回归不变；新增单测覆盖四种写法 + miss 报错文案。

#### SB-06【低-中】落地链路 TOCTOU：校验窗口内活副本可被并发改写

- **位置**：`src/routes.ts:194`（读）→ :202（validate）→ :211（seed 规划）→ :229（队列内重读再写）。
- **现象**：`loadStoryboardOrFail` 与 `updateStoryboardOrFail` 是两次独立入队；窗口内 agent 的 `write_storyboard` 落盘后，`landed.sections` 固化的仍是**校验过的旧 frozen**，而活副本已是新内容——落地内容与用户最后看到的可能不一致（有 `landed.sourceVersion` 审计可追，但 UI 不展示差异）。串行队列只保护单次读改写，不保护整段 land 事务。
- **修法（最小）**：在 `updateStoryboardOrFail` 的 mutate 里复核 `current.sections` 与规划时用的 `frozen` 一致（引用或深比较），不一致即抛「故事板在落地过程中被修改，请重试」。
- **验收判据**：构造并发场景（先 enqueue 一个改写再 land）→ land 明确报错而非静默落旧料。

### 4.4 P3 —— 已知小账，可修可挂账

| 编号 | 位置 | 问题 | 建议 |
|---|---|---|---|
| SB-07 | `routes.ts:794` | `ensureStoryboardSkeleton(...).catch(() => undefined)` 静默吞错，无日志无诊断 | 至少补一行 `ctx.logger.warn`；功能不坏（首笔写走 missing 首稿兜底） |
| SB-08 | `storyboard-discipline-prompt.ts:10` | 头注写 `versions.final !== null`，实现是 `document.landed`（契约 v2.0 已把 `final` 演化为顶层 `landed`）；功能正确但注释误导 | 改注释 |
| SB-09 | `StudioFrame.tsx:2581-2588` | 每次 bump 都换 `?rev=` 整页重载 iframe，用户滚动长文档被打回顶部；分次写是 skill 明教模式 ⇒ storyboarding 期反复打断 | 缓解：内容未变不 bump，或 Host 渲染时带滚动锚点；零 JS 约束下无更优注入通道 |
| SB-10 | `StudioFrame.tsx:445` | `storyboardDismissedRef` 只在内存；刷新页面后 storyboarding 态强制重弹覆盖层，「关过不想再弹」不持久 | 持久化到 sessionStorage/project 级配置 |
| SB-11 | `host-tools.ts:862-1099` | 旧流程 `parseStoryboardShots` / `mergeShotCards` / `formatStoryboardShot` 成死代码，仅测试引用；`isShotCard` 改口径要背两套语义 | 明确「保留待删/等待 revive」决策，写进 tracking，别永远悬着 |
| SB-12 | 全链路 | 落地失败无专门 UI 通道：blockers 只是通用 `setFailed` 文案，九节文档缺项无可视化引导（如缺 §04 时高亮该节） | 体验增强，可挂账 |

---

## 五、契约承诺 vs 实现差距（排期决策，非本批修复项）

| 编号 | 契约承诺 | 现状 | 风险 |
|---|---|---|---|
| G1 | `revise_storyboard` 结构修订 + delta re-seed（契约 §9，P2） | **无实现**；但 `write_storyboard` 报错文案（SB-04）与契约注释已按「存在」引导 | agent 循环重试不存在的工具；**本批只撤文案（SB-04），实现与否需产品排期拍板** |
| G2 | L 类回写（画布改 `gen.lockedPrompt`/§08 → 回写 storyboard，契约 §8） | 无实现；seed 只在卡面写标签「供将来反向解析」（`storyboard-seed.ts:67-69`） | 用户在画布改的约束/角色锚点不会回流，storyboard 与画布渐行渐远 |
| G3 | A 类 `actuals`（actualDuration/qc/framingNote 双写，契约 §8） | 只有类型 + 归一化（`contracts/storyboard.ts:227-232`），全库无生产写入点 | 「参数条量化对齐」的数据永远是空的 |
| G4 | `bindings` 反查消费（sbRef ↔ 画布 UUID） | land 时写入（`routes.ts:217-226`），**无任何读取方** | SB-05 的根因之一 |

**总判**：P 类（agent 写 storyboard）通了；L/A/revise 三块是空头支票而 UI 与文案已按「存在」预支。要么排期补齐，要么把文案与注释收回——**本批选择后者（SB-04），前者需要独立的 REQ 排期**。

---

## 六、修复优先级路线

| 优先级 | 编号 | 一句话 | 理由 |
|---|---|---|---|
| P0 | SB-01 | 落地顺序：先写画布成功再置 `landed` + 幂等防护 | 不可逆 + 永久锁死 + 注释反写 |
| P0 | SB-02 | `handleLand` 传 `sbVersion` | 一行参数，静默投错料且不可逆 |
| P1 | SB-03 | `keyframe_review` 补拦 `write_storyboard` | 三态迁移已知遗留，注释自认 |
| P1 | SB-04 | 收回 `revise_storyboard` 文案与注释 | agent 死循环风险；实现另排期 |
| P2 | SB-05 | `resolveShotRefs` 认 sbRef/语义 id | 契约承诺、双向映射建了不用 |
| P2 | SB-06 | 落地 TOCTOU 复核 | 低概率但静默落旧料 |
| P3 | SB-07~12 | 日志/注释/滚动/持久化/死代码/体验 | 挂账或顺手修 |

**建议批次拆分**（修入会话可调整）：
- **批 A（P0，必须先做）**：SB-01 + SB-02 —— 一条 CV 拿不下就两条（落地正确性批）；
- **批 B（P1）**：SB-03 + SB-04 —— 守卫与文案一体两面，同批；
- **批 C（P2，可并入 B 或独立）**：SB-05 + SB-06；
- **批 D（P3）**：顺手修或挂账。

每批走 `canvas-studio/AGENTS.md` 收尾四步（STATUS §4+§8 / backlog / tracking 镜像 / 提交带条目号），验证链 `typecheck && build && verify:loader && test:smoke`，基线红为空 ⇒ 新增红即回归。

---

## 七、评审方法说明

- 全量阅读：契约 797 行全读、store 全读、seed 全读、`landStoryboard`/`write_storyboard`/`resolveShotRefs`/`handleLand`/覆盖层 JSX 全读；diff/history/render/discipline-prompt 读关键段。
- 交叉验证：所有「无实现」结论均经 `grep` 全库确认（`revise_storyboard` / `actuals` 写入点 / `bindings` 消费方 / land 路由测试）。
- 未做：未跑桌面（本环境 headless）、未改任何代码、未跑测试（只读评审）。
