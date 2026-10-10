# REQ-022 · Storyboard 数据契约（设计稿 v2.0）

> 配套需求：REQ-022（两阶段产出：Storyboard 拍摄定稿 → 画布，资料库别名 R-P0-01，设计稿 `R-P0-01-两阶段Storyboard形态设计.md`）。
> 触发：用户 5 条基础需求 + 真实 `canvas.json` 取证 + 与 R-P0-01 模型 C 的连贯化。
> 状态：**v2.0 已定稿（2026-10-10）**——v1 讨论定稿后经 8 议题分项复审全部收口（状态机 / 落地机制 / 版本语义 / 工具处置 / 镜号约定 / 约束注入 / 回写通道 / 编号挂账），拍板条目已全部回写正文。
> 编号说明：本文档原名 `R-P0-02-storyboard数据契约.md`，2026-10-10 改名——资料库别名 `R-P0-02` 已属 REQ-023（音色资产），本稿归 REQ-022 设计系列，改名规避撞名。

---

## 0. 背景与来源

用户在 R-P0-01 的「故事板」概念之上，补充了 5 条**基础需求**并指明一份真实画布文件作为证据：

1. 故事版生成阶段要能**稳定转换成 HTML** 展示当前内容；
2. 故事版要能**切换不同版本**做对比；
3. 故事版敲定后，要有**干净的数据落到画布**（用户敲定的版本），**不把历史无用信息带进来**污染画布和 agent；
4. 落到画布时，故事版内容要能**拆分到画布上落成节点**，方便 agent 调工具产出图/视频/音频；
5. 画布上的节点修改，也要能**回写到故事版**做同步更新。

取证文件：`~/Desktop/job/VideoOut/newOut1/projects/.draft-202609-2/canvas.json`（一份真实执行期画布）。
它证实了「故事版拆分落节点」的**目标拓扑**——本文的 seed 映射全部对齐该文件字段，使现有生成工具链路零改动。

---

## 1. 决策账（总表）

| # | 议题 | 结论 |
|---|---|---|
| 1 | 物理形态 | `storyboard.json`（SSOT）**独立文件**，与 `canvas.json` 分离；`render()` 纯函数出 HTML |
| 2 | 版本管理 | 模型 C：活副本 + 「存档为新版本」按钮 + **3 个自动 checkpoint**（首稿 v1 / 落地前固化 / 落地冻结 final）；**版本存储用全量快照** |
| 3 | 关联机制 | **双向双 ID**：画布节点带 `sbRef`（语义 ID）→ 故事版；storyboard 的 `bindings` 块（**版本快照之外**）存画布 UUID 反查。不用名字、不用位置 |
| 4 | 干净落地 | `seed(终版)` 纯函数，显式丢弃版本历史 / 编辑痕迹 / 待核实 / 对话；画布只拿「生成机器要吃的最小集」 |
| 5 | 拆分落节点 | 照 canvas.json 实证拓扑 1:1 映射（锚点文档 + 分镜卡 + 角色/look 资产 + 旁白参数节点）；现有 `video_composite` 链路零改动 |
| 6 | 回写 | 字段三分类 **P/L/A 全字段表**（§8）：P 走结构修订 / L 直写 sections / A 写 `actuals[sbRef]`；**声明面回写、实例面不回写** |
| 7 | 增删分镜 | 确认后放行，定性「结构修订」：`revise_storyboard` 独立工具 + 版本链 f2/f3 + delta re-seed，下游生成物标孤儿不自动删 |
| 8 | 角色卡 | `profile`（人读，只上 HTML）与 `gen`（机读 lockedPrompt/negativePrompt，画布可改可回写）分离；画布只露生成级字段 |
| 9 | 状态机 | **5 态 → 3 态**：新增 `storyboarding`，删 `drafting`/`script_review`/`awaiting_approval`；项目创建直接进 `storyboarding`（§3） |
| 10 | 落地机制 | **用户按钮 → Host 路由**，非 agent 工具；三层校验；**单向终点**（落地仅一次，整体重落禁止）；auto 模式由 Host 编排自动落地（§7） |
| 11 | `final` 语义 | 落地所选内容的全量快照，落地即冻结，记 `sourceVersion`；任意历史版本/活副本可落；活副本 = `sections` 本身（§5） |
| 12 | `07_assets` 扩展 | 用户上传资源引用化（`ref:{kind,id}`），HTML 必须展示，seed 不造新节点只校验引用（§4） |
| 13 | 呈现入口 | Host `render()` 纯函数 → webServer 路由 → **iframe 全屏覆盖层**压画布；单一入口 = 画布顶条「拍摄定稿」按钮，两阶段共用（§11） |
| 14 | 旧工具处置 | 方案甲：`write_screenplay`/`submit_screenplay_for_approval`/`submit_storyboard_for_approval` **全下线**；保留 `resolveShotRefs`/「分镜 N」约定/`submit_keyframes_for_approval`/`write_script`（§9） |
| 15 | 镜号与卡 | 画布扁平 12 卡、scene 不落节点；镜号一次铸造永不重排；卡标题 `分镜 {N} · {shotId} · {景别}`；shotRefs 增 sbRef 写法（§7.6） |
| 16 | 约束注入 | 四层通道：全局纪律→system prompt 小节、每镜内容→agent 组装、一致性→资产卡；**Host 不做隐式 prompt 合并**（§12） |
| 17 | `actuals` 写入 | 只由 Host 自动写（生成结算 + qc 镜像），不设 agent 手写入口（§8.3） |

---

## 2. 五条需求 → 方案映射

| 需求 | 落点 |
|---|---|
| ① 稳定转 HTML | `render(storyboard, version?)` 纯函数，模板化，v1/v5 同构只换数据（§11） |
| ② 版本切换对比 | 版本 = `versions.history` 全量快照；`render(version)` 任意版本；字段级 diff（P2） |
| ③ 干净落地 | `seed(终版)` 纯函数 + 显式丢弃清单（§7.4） |
| ④ 拆分节点 | §7.5 字段级映射表，对齐 canvas.json 拓扑 |
| ⑤ 节点回写 | §8 字段三分类全表 + `sbRef`/`bindings` 双向关联 |

---

## 3. 状态机与门禁

### 3.1 三态模型（方案 B，覆盖 R-P0-01 §3.2 提议）

| | 内容 |
|---|---|
| **新契约** | `storyboarding`（新增）/ `keyframe_review`（保留）/ `executing`（保留） |
| **删除** | `drafting` / `script_review` / `awaiting_approval`——剧本门+分镜门被方案 A 取代，态随门删 |
| **进态** | 项目创建成功 → 直接 `storyboarding` |
| **语义** | 落画布之前一切都在 `storyboarding`（含澄清、搜索、写故事版、调整循环、版本存档、看预览）；**落地 = 瞬时动作，非停留态**；落地后转 `executing` 且**不回退** |
| **落地后** | 故事版仍是 SSOT：结构修订（§9 delta re-seed）、L 类回写（§8）、A 类 actuals 全部在 `executing` 下放行；预览层变**只读**；版本列表仍可回看 |
| **存量迁移** | `normalizeWorkflow` 一次性映射：`drafting`/`script_review`/`awaiting_approval` → `storyboarding`；`keyframe_review`/`executing` 不变。开发阶段不强行兼容，**不写其他一次性兼容代码**；迁移若复杂不收敛则不写 |

### 3.2 `storyboarding` 态门禁面

- **放行**：`write_storyboard` / `revise_storyboard` / `look_card` / `image_generate`（仅 Look 样张，shotBound=false）/ 搜索核实 / `ask_user_choice` / 版本存档与回退（Host 路由）
- **拦截**：`FORMAL_TOOLS` 全部 + 绑 shot 的出图 + 一切媒体生成
- **`write_script` 不放行**：阶段一只写 storyboard.json（§03/§06 数据在文档内），文案节点由 seed 落画布
- **抢跑防线**：原「提交即停手（concludeTurn）」职责改由**状态门禁**承担——`storyboarding` 态产出类工具一律抛错，不依赖 agent 自律
- **auto 模式**：`mode !== 'confirm'` 时 `approvalGateMessage` 返回 null（既有语义不变），落地由 Host 编排自动完成（§7.3）

### 3.3 门禁与工具实现收口

- **落地执行体 = 用户按钮 → Host 路由**，非 agent 工具；**不新增 `submit_storyboard_for_confirmation` 工具**
- **`approval-gate` 重写面**：`REVIEW_STATES` = `{keyframe_review}` 单值；`DRAFTING_MESSAGE` 删除；放行面按 §3.2（仅 confirm 模式约束）
- **`approval-notice` gate 收敛为 `'keyframes'` 单值**；storyboard 确认交互不存在，落地确认走 overlay 弹窗（§7.3）
- **auto 状态翻转**：从 submit 工具移到 Host 编排（`write_storyboard` 成功 → validateForSeed → seed + 写 `executing`）；顺序天然由数据依赖保障（seed 前画布无分镜卡，`shotRefs` 连不上边）
- **工具互斥**：`write_storyboard` 仅 `storyboarding` 态可用；`revise_storyboard` 仅 `executing` 态可用（§9）——门禁面天然成立

---

## 4. `storyboard.json` schema

### 4.1 顶层

```jsonc
{
  "schemaVersion": 1,
  "projectId": "…",
  "title": "《雨夜来信》",
  "meta": { "genre": "民国悬疑", "targetDuration": 30.0, "aspect": "16:9", "audience": "…" },
  "sections": { /* §4.2 */ },
  "versions": { /* §4.3 */ },
  "bindings": { /* §4.4 —— 版本快照之外 */ },
  "actuals":  { /* §4.5 —— 版本快照之外 */ }
}
```

### 4.2 `sections`（规划内容，进入版本快照）

每个可独立定位的实体带**语义 ID**，规则：`C1` / `S1` / `S1-Sh1` / `V1` / `L1`。**一次铸造、永不复用**；全文重写时铸造新 ID（旧节点走孤儿流程，§9）。

```jsonc
"sections": {
  "00_creative":   { "brief": "…" },
  "01_facts":      { "facts": [ { "claim": "…", "source": "https://…", "status": "verified|pending" } ] },
  "02_visual":     { "tokens": [ { "k": "色彩", "v": "青灰冷调 + 钨丝暖点" } ] }, // → look 卡
  "03_narration":  { "lines": [ { "id": "V1", "text": "…", "duration": 2.5, "shotRef": "S1-Sh1" } ] }, // 只写一次
  "04_storyboard": {
    "scenes": [
      { "id": "S1", "title": "开场", "shots": [
        { "id": "S1-Sh1", "duration": 2.5, "frames": 60, "camera": "Push in",
          "visual": "…", "audio": "…", "narrationRef": "V1",
          "promptEn": "…", "backup": false }
      ]}
    ]
  },
  "05_characters": [
    { "id": "C1", "label": "ROLE A", "name": "苏婉", "tags": ["女","26岁","单女主"],
      "profile": { "temperament": "…", "face": "…", "costume": "…" },   // 人读，只上 HTML
      "palette": { "base": "warm ivory", "accent": "围巾暗红" },
      "appearsIn": ["S1" /*…*/ "S6"],
      "gen": { "lockedPrompt": "…", "negativePrompt": "…" } }            // 机读，落画布可回写
  ],
  "06_sound":      { "bgm": { "bpm": 52, "lufs": -16, "sidechain": "1.5–3kHz" }, "sfx": [ "…" ] },
  "07_assets":     [ { "name": "…", "type": "image", "status": "ready|pending",
                       "ref": { "kind": "canvasNode|file", "id": "…" } } ],
  "08_constraints":[ "每个 shot prompt 只保留一个 camera motion 动词", "…" ]
}
```

### 4.3 字段表定稿（必填底线，`validateForSeed` 与此同源）

| section | 结构（钉死） | 必填底线 |
|---|---|---|
| `00_creative` | `{ brief: string }`（一句话意图，不结构化） | 非空 |
| `01_facts` | `[{claim, source, status}]` | 可空（搜索可后补） |
| `02_visual` | `tokens: [{k, v}]` | ≥1 |
| `03_narration` | `lines: [{id:"V*", text, duration, shotRef?}]` | 可空（无旁白片） |
| `04_storyboard` | `scenes: [{id:"S*", title, shots:[{id, duration, frames, camera, visual, audio, narrationRef?, promptEn?, backup}]}]` | ≥1 scene ≥1 shot |
| `05_characters` | `[{id, label, name, tags, profile{temperament,face,costume}, palette, appearsIn, gen{lockedPrompt,negativePrompt}}]` | 可空；**有则 `gen.lockedPrompt` 必填** |
| `06_sound` | `{bgm:{bpm,lufs,sidechain}, sfx:[]}` | 可空 |
| `07_assets` | **扩展**：`[{name, type:'text'\|'image'\|'video'\|'audio', status, ref:{kind:'canvasNode'\|'file', id}}]` | 可空；**非必需项，但有则 HTML 必须展示** |
| `08_constraints` | `string[]` | 可空（建议 ≥1） |

**07 扩展口径**：用户上传资源复用现有上传路由（文件进项目 `assets/`、画布落参考节点 `isReference`）；storyboard 条目**只存引用不存副本**；HTML §07 渲染缩略图（图）/时长角标（视频音频）/摘要（文本），点击跳画布节点；**seed 不为 07 造新节点**（节点上传时已落），seed 只校验引用有效性，失效标「待重新上传」；不进 blocker。

### 4.4 `versions`（全量快照）

```jsonc
"versions": {
  "current": "v2",
  "history": [
    { "version": "v1", "label": "初稿", "createdAt": 1790…, "snapshot": { /* 全量 sections */ } },
    { "version": "v2", "label": "黄昏版", "createdAt": 1790…, "parent": "v1", "snapshot": { /* 全量 sections */ } }
  ],
  "final": null,   // 落地时填：本次落地所选内容的全量快照，落地即冻结；带 sourceVersion 审计字段
  "sourceVersion": null  // 落的是哪版（"v2" 或 "live"）
}
```

> 全量快照而非 delta：storyboard 体量小（<100KB），全量让 `render(version)` 与 diff 最省事、最稳。

### 4.5 `bindings`（**版本快照之外**）

seed 时记录「语义 ID ↔ 画布 UUID」的反查表。它不参与版本 diff、不进 seed 投影。

```jsonc
"bindings": {
  "05:C1": { "canvasNodeId": "c5a047ca-…", "canvasAssetId": "eedf2b09-…", "seededFrom": "final" },
  "04:S1/shots/S1-Sh1": { "canvasNodeId": "0ac0d038-…" }
}
```

### 4.6 `actuals`（**版本快照之外**）

执行期真相覆盖层，按 `sbRef` 索引，绝不触碰 `sections`（满足「规划冻结」）。写入路径见 §8.3。

```jsonc
"actuals": {
  "04:S1/shots/S1-Sh1": { "actualDuration": 10.13, "qc": { "verdict": "pass" }, "framingNote": "实际构图略广" }
}
```

---

## 5. 版本管理（模型 C）

- **活副本物理存储**：`storyboard.json.sections` **本身就是活副本**（无独立 working 文件）；revise 直接原子写该文件；「存档」= 当前 `sections` 拷入 `versions.history`。
- **存档按钮**：用户点「存档为新版本」才生成 v2/v3…，附 diff 摘要、可命名、可回退。**每次对话式局部重写 / 行内微调不自动 +版本号。**
- **3 个自动 checkpoint**：首稿 `write_storyboard` → v1；**落地前固化**（所选内容 → vN）；**落地冻结** → `final`（后两步合并为落地动作的两步）。固化规则一句话：**落画布永远先把所选内容固化成版本 → 再冻结 final → 再 seed**——源 = 活副本 → 自动存档为 vN；源 = 历史版本 → 直接取其快照。
- **`final` 语义**：= 本次落地所选内容的全量快照，落地即冻结，与版本号无关；记 `sourceVersion`（审计「落的是哪版」）；`seed(final)` 契约不变。
- **选版本落地**：任意历史版本 + 活副本均可作落地源；版本列表**每项**带「落到画布」入口（落地前可用）。
- **回退**：用旧版内容生成**新版本**，不删历史；活副本同步替换为该内容。
- **版本 diff 字段级高亮 → P2**（P1 版本切换 = `render(version)` 换数据即天然可比）。
- **落地后**：版本列表入口消失 → 「已落地 vN」终态标记；版本仍可回看（只读）。

---

## 6. 关联机制：双向双 ID

```
storyboard.json（SSOT）                        canvas.json（执行）
──────────────────────────                    ────────────────────────────
sections.05_characters[id:"C1"]  ◀─ sbRef ──── node.sbRef  = "05:C1"      （画布→故事版）
                                              asset.sbRef = "05:C1"
bindings:{ "05:C1":{canvasNodeId…} } ── uuid ─▶ node.id = "c5a047ca-…"     （故事版→画布）
```

- 画布→故事版：`sbRef` 字段（语义 ID），人可读、画布 roundtrip 不丢（`normalizeCanvasDocument` 的 `{...node}` 展开保证；`writeCanvas` 的 client-author 保护需给 `sbRef` 加同款白名单，防误删）。
- 故事版→画布：`bindings` 块（版本快照外）存画布 UUID。
- **不用名字**：「苏婉」「分镜 1」会被改名；**不用位置**：增删分镜后索引漂移。只有语义 ID 稳。
- 画布内 `sourceIds` / `shotNodeIds` 仍用原有 UUID，**保持原样**；`sbRef` 是纯增量字段，老画布无 `sbRef` 即不参与回写（向后兼容）。
- 全文重写铸造新 ID，旧节点走孤儿流程（§9）。

### 6.1 shotRefs 解析（生成期卡发现）

`resolveShotRefs` 接受 **4 种写法**：节点 id 精确匹配 / 卡片标题精确匹配 / `分镜 N` 镜号前缀（既有正则保证 `分镜 1` 不误中 `分镜 10`）/ **shotId（如 `S1-Sh1`，新增）**。agent 自己写的 storyboard，sbRef 必在上下文 → 落地后直接 `shotRefs: ["S1-Sh1"]`，**无需列卡工具，不新增工具注册**。

- `canvas-placement.ts` 的 `resolveShotRefs` 同款逻辑同步扩 sbRef 写法。
- 连带清理 7 处工具描述「来自提交分镜的工具结果」（`host-tools.ts:1213/1261/1285/1306/1660/1733/2187`）→「来自 shot 定稿（sbRef / 标题 / 镜号 / 节点 id）」；`:1086` 报错文案同步。

### 6.2 分镜卡判定谓词 `isShotCard(node)`

seed 卡 `toolName = 'seed_canvas_from_storyboard'`（新值）；`contracts/canvas.ts` 增 **`isShotCard(node)` 谓词，双值兼容**——同时接受存量旧值 `'submit_storyboard_for_approval'`。10+ 处 `node.toolName === STORYBOARD_NODE_TOOL` 等价替换：`workflow-stage.ts:154/:256`（阶段判定）、`host-tools.ts`（`shotCardTitleOf`/`resolveShotRefs`/`write_script` 锚卡）、`generate.ts`（素材组/产物命名血缘）、`canvas-placement.ts:85`、`shot-versions.ts:171`、`auto-test-checkpoints.ts:219/:232`、`auto-test-report.ts:65`。该谓词是「存量卡天然兼容」声明的实现载体。

---

## 7. seed 契约（干净落地 + 拆分 + 落地机制）

`seed(storyboard.versions.final)` = 对终版的纯函数，**只投影画布要的字段**。

### 7.1 三层校验，各管时机

1. **schema 校验**（`write_storyboard`/`revise_storyboard` 落盘时）：结构合法性，不过 = 显式报错不落盘（既有纪律）；
2. **`validateForSeed(storyboard)`**（修改后实时算 + 点击落地兜底）：完成度 blocker 表，**纯函数、全入口共用一份**；
3. **落地确认清单**（blocker 全过后）：warning 软提示 + 数据摘要，用户点「确认落地」才执行。

**blocker（缺 = 不让落地）**：meta 齐（title/aspect/targetDuration）；≥1 scene 且每 shot `id` 唯一合法/`duration>0`/`visual` 非空；每角色 `gen.lockedPrompt` 非空；`02_visual.tokens` ≥1；`narrationRef`/`appearsIn` 引用有效；语义 ID 全文唯一。

**warning（列入确认清单，放行）**：Σ shot 时长 vs targetDuration 偏差；§01 `status:pending` 数量；§07 待上传数量；shot 缺 `promptEn`。

### 7.2 落地按钮（单向终点）

- **按钮交互**：**永不 disabled**，常驻缺项徽标（如「落到画布 · 缺 2 项」）；点击分流——有 blocker → 弹缺项清单（每项 = 缺什么 + 在哪分节 + 点击跳转），无 blocker → 弹确认清单 → seed → 转 `executing`。
- **单向终点**：落地仅一次；落地后版本列表入口消失 → 「已落地 vN」终态标记；**整体重落禁止**；§9 结构修订 delta re-seed（局部通道）保留不动。
- **多次落地（seed 幂等 upsert）方案已否决。**

### 7.3 auto 模式落地

`write_storyboard` 成功 → **Host 编排**自动跑 `validateForSeed` → 通过直接 seed + 写 `executing`；**有 blocker 停下报错，不猜测补数据**。状态翻转从「agent 工具」移到「Host 编排」，auto 不需要 submit 工具；顺序天然由数据依赖保障（seed 前画布无分镜卡，`shotRefs` 连不上边，生产工具想抢跑也连不上）。

### 7.4 显式丢弃清单（这就是 req3「不带历史」）

版本历史（`history` 其余项）、编辑痕迹、§01 里 `status:pending` 的待核实项、agent 对话、活副本状态、回退指针。

### 7.5 字段级节点映射表（对照真实 canvas.json 拓扑）

| # | storyboard 源 | canvas 落点 | sbRef |
|---|---|---|---|
| 1 | `meta` + `00.brief` + `01` 已核实项 | **锚点文档节点**（text，`toolName:"seedCanvasFromStoryboard"`） | 无 |
| 2 | `01` pending 项 | 不落（§7.4 丢弃） | — |
| 3 | `02.tokens` | `assets[] role:"style"`（lockedPrompt=tokens 拼接）+ 挂**既有** Look 样张节点 `anchorNodeIds`；无样张则 anchor 空 + 标「待出样张」 | `02:look` |
| 4 | `03.lines` + `06` | **旁白与声音参数 text 节点**（seed 落：逐句旁白 + BGM 参数模板渲染） | `03` |
| 5 | `04` 每 shot | text · `operationType:"storyboard"`：`declaredDuration/declaredFrames/sourceIds:[锚点.id]` | `04:S1/shots/S1-Sh1` |
| 6 | `05[].gen` | `assets[] role:"character"` + 占位 `character-sheet` 图节点（**标「待生成」角标 + 锁定 prompt 存独立文本字段；`generationPrompt` 不塞裸文本**——该字段全库语义是 JSON 编码请求参数，节点重试重放与 `auto-test-checkpoints` 断言依赖） | `05:C1` |
| 7 | `05[].profile/palette/appearsIn` | 不落画布（只上 HTML） | — |
| 8 | `07` | 不造新节点（上传时参考节点已落）；seed 仅校验 `ref` 有效，失效标「待重新上传」 | — |
| 9 | `08` | 不落节点 → 纪律注入（来源标「拍摄定稿 §08」，§12） | — |
| 10 | `00` 禁令类 | 并入纪律注入（来源标「拍摄定稿 §00」）+ 锚点节点文本 | — |

> 实据：真实 canvas.json 中 `assets[]` 的 `role:"character"` 带 `lockedPrompt`/`negativePrompt`/`anchorNodeIds`，`operationType:"storyboard"` 节点带 `declaredDuration`/`declaredFrames`/`sourceIds`。seed 产出与之同构 → `video_composite` 经 `sourceIds`+`shotNodeIds` 拉节点的现有链路一行不改。

**锚点节点规格**（血缘新宿主）：

```
kind: text
toolName: 'seedCanvasFromStoryboard'
title: 《雨夜来信》拍摄定稿 · 终版 v2
text:  【参数】30s · 16:9 · 民国悬疑
       【创意】<00.brief 全文>
       【事实锚点】<01 verified 项，带来源 URL>
sourceIds: [user_brief.id]（有创意节点则挂，无则 []）
sbRef: 无（只读投影，无回写需求）
```

**血缘**：所有 seed 产物（分镜卡 ×N、角色占位节点、style 资产、旁白参数节点）`sourceIds → [锚点.id]`（剧本门下线后「分镜卡→剧本→创意」链断，改「分镜卡→锚点→创意」）。

**拍板理由摘要**：① 锚点 = 血缘宿主 + 执行期 agent 全局上下文可读面 + R-P0-01 §5.3 既有设计；② `00` 不造独立节点（消费面 = prompt 纪律，锚点首段可读 + 纪律注入强制双落点）；③ `01` verified 并入锚点，pending 不落是 §7.4 既定语义；④ `03+06` 造参数节点（agent 工作面是画布，避免新增「读故事版文件」路径；`write_script` 消费该节点产出文案卡，输入/产出不冲突）；⑤ shot 卡 `sourceIds → [锚点.id]`（剧本节点不存在了，5-1 悬置项已了结）。

### 7.6 镜号与卡规格（两级结构 → 扁平画布）

- **画布拓扑 = 扁平 N 卡，scene 不落画布节点**：`S1..S6` 只存在于 `storyboard.json` / HTML overlay / 卡片 text 里的 shotId / 节点 `sbRef`。否决项：scene 落 group 节点（素材组已占 `分镜 N · 素材` 父层，再套两级嵌套 `canvas-view` arrangement 未验证）；scene 级镜号 `分镜 1-1`（砸穿 `分镜\s*(\d+)` 全部正则）。
- **镜号铸造：一次铸造、永不变号**——seed 按 storyboard 遍历序（scene 序 × shot 序）铸全局号 1..N；**结构修订后新增 shot 取当前 max+1，删除 shot 不重编号**（空号保留）。素材组 / 产物命名（`分镜 N · 关键帧`、`分镜 N · 素材`）全钉在镜号上，重编 = 全线孤儿。delta re-seed 只做增 / 改 / 标记作废，**绝不重排**。
- **卡标题格式 = `分镜 {N} · {shotId} · {景别}`**（例 `分镜 3 · S2-Sh1 · 中景推近`）：`分镜 N` 前缀保住全部正则；shotId 是人读键、sbRef 是机读键。存量卡旧格式 `分镜 N · 景别` 继续有效。
- **卡发现**：见 §6.1（shotRefs 第 4 种写法 sbRef）。

### 7.7 seed 只造骨架，媒体仍由 agent 生成

seed **不预生成图片/视频**。它造：锚点文档、分镜卡、角色/look 的**资产定义 + 占位图节点**、旁白参数节点。角色图 / 场景图 / 视频由 agent 在执行期调 `image_generate` / `character_sheet` / `video_composite` 消费这些节点完成——即 req4「方便 agent 调用工具产出」的落点。

### 7.8 健壮性与并发（实现约定）

- **`storyboard.json` 读损坏**：**显式报错 + `.corrupt` 备份文件**，绝不静默重置（区别于 canvas.json 的降级空文档——storyboard 是用户创作资产）。
- **写并发**：所有写者（agent write/revise 工具、存档/回退/落地按钮路由、L 类回写 diff）收口 `ProjectRegistry` 的 storyboard 读写方法，**模块级串行队列**（`asset-history.ts:45` 同款先例）；路由与工具不直接碰文件。

---

## 8. writeback 契约（字段三分类）

### 8.1 原则

- **回写主通道 = 声明面（带 `sbRef` 节点）；实例面（生成节点参数箱）不回写**——实例 prompt 是六段式组装产物，整串写回 `§04.visual` 会把 lockedPrompt 塞进分镜描述造成下次组装双重嵌套。**闸门**：仅带 `sbRef` 的规划节点参与回写，生成的 video / group / audio 节点无 `sbRef` → 一律忽略，绝不反向污染故事版。
- **用户教育点**：改「这一镜以后怎么拍」→ 编辑分镜卡；改「这一张图重新出」→ 编辑节点参数箱。
- `render()` 有 `actuals` 时显示「声明 10s / 实际 10.13s」，规划意图纹丝不动。

### 8.2 字段三分类全表

| 字段 | 类 | 画布编辑面 | 回写动作 |
|---|---|---|---|
| 结构（scenes/shots 增删、`duration`/`frames`、scene title） | **P** | 结构修订（§9 f2） | f2 链 + delta re-seed |
| §03 旁白文本/时长 | **P** | 卡上改 → 引导走结构修订，不直接写 | f2 |
| **§04 `visual`/`camera`/`audio`/`promptEn`/`backup`** | **L** | 分镜卡 text 编辑 | 标签解析 → 直写 sections |
| §05 `gen.lockedPrompt`/`negativePrompt` | **L** | 资产卡编辑（`PUT /library/:id`） | 直写 sections |
| §02 tokens / §06 BGM 参数 | **L** | Look 卡 / 旁白参数节点 | 直写 sections |
| §00 brief、§01 facts、§08 constraints | **L**（仅 overlay，无画布节点） | overlay 各节 | 直写；§00禁令/§08 **刷纪律缓存**（§12） |
| 生成节点参数箱 prompt | **不回写** | 节点自身 | 留 `generationPrompt`（实例记录） |
| 实际时长 / qc 结论 | **A** | 无（Host 自动） | `actuals[sbRef]`，**永不碰 sections** |

### 8.3 A 类写入路径

**只由 Host 自动写，不设 agent 手写入口**（防伪造，对齐「reserved 字段不伪造已生效」仓规）：

- **生成结算**：video 落盘时按 shotRefs 血缘写 `actuals[sbRef].actualDuration` 等实测值；
- **`qc_shot` 落盘镜像** `actuals[sbRef].qc`（节点 `qc` 字段照旧，双写：节点给画布、actuals 给 overlay）；
- 写入走 §7.8 串行队列；L 回写不进 actuals，A/L 通道互不交叉。

### 8.4 L 类触发机制

- **diff 挂在 Host 写盘路径**（`ROUTE_CANVAS` save、`PUT /library/:id`、overlay 的 storyboard 写 API），比对目标 = storyboard 当前值（≠ 才写），**请求内同步完成**，走 §7.8 同一串行队列；**不加定时器**（仓规：事件驱动落盘）。手势结束才触发（`handleNodeTextSubmit` 即此语义，非逐键）。
- agent 的 `revise_storyboard` 同队列排队，字段级 last-write-wins：只覆盖显式修改的字段，用户已回写的字段保留。
- **分镜卡模板标签化（实现前提）**：seed 卡 text 用稳定字段标签（`【视觉】`/`【运镜】`/`【声音】`…）作解析键；**解析失败 → 跳过回写 + 画布提示「未识别为结构化字段，改动仅存于本卡」**，绝不带病写库。
- **版本语义**：L 回写**不升版本**（final 冻结不动、活副本直变、可手动存档为新版本）；overlay 走 §11 事件刷新通道即时可见。
- 发现性提示（参数箱改动时提示「仅作用于本节点」）→ **P2**，本期不做。

---

## 9. 结构修订（分镜增减）

确认后允许增 / 删 / 拆镜，定性为**特殊操作**，与字段级回写区分：

1. 用户/agent 提出 → agent 调 **`revise_storyboard`**（独立工具，仅 `executing` 态可用，与 `write_storyboard` 按状态互斥）→ 版本链推进 f2/f3（快照仍全量）；**前置 `validateForSeed` 同源校验，blocker 不放行**；
2. **不设二次确认门**：executing 态放行 confirm/auto（修订本身是主动意图，孤儿标记机制已兜底）；
3. **delta re-seed**：新增 shot → 铸新语义 ID + **镜号取当前 max+1**（§7.6）→ 只造**新增**分镜节点（带 `sbRef`）插入对应素材组；删除 shot → 节点移除（镜号空缺保留，不重编）；
4. 下游生成物（引用该 shot 的视频节点）标「源已删」**孤儿提示，不自动删用户已生成物**；
5. 画布上永远只有当前修订版结构，修订历史只活 storyboard.json 里（req3 始终成立）。

---

## 10. 角色卡组织示例（对照真实 canvas.json「一家四口」asset）

```jsonc
// sections.05_characters[]  —— 人读 / 机读分离是关键
{
  "id": "C1",                      // 语义ID，关联全靠它
  "label": "ROLE A", "name": "苏婉",
  "tags": ["女","26岁","单女主","全片唯一正脸"],
  "profile": {                     // 人读：气质/面部/服装 prose → 只上 HTML，不上画布
    "temperament": "静，但不是弱……",
    "face": "鹅蛋脸，眉细而平……",
    "costume": "月白旗袍 + 深灰开衫……"
  },
  "palette": { "base": "warm ivory", "accent": "围巾暗红" },
  "appearsIn": ["S1" /*…*/ "S6"],
  "gen": {                         // 机读：生成锚点 → 落画布，可改可回写
    "lockedPrompt": "26-year-old chinese woman, oval face, …",
    "negativePrompt": "不改变五官发型与服装配色；不增删人物……"
  }
}
```

落画布对照（真实 canvas.json 实证）：

| storyboard 字段 | canvas.json 落点 | 关联 |
|---|---|---|
| `gen.lockedPrompt` | `assets[]` `role:"character"` `.lockedPrompt` | `asset.sbRef="05:C1"` |
| `gen.negativePrompt` | `assets[]` `.negativePrompt` | 同上 |
| 角色图（占位） | image 节点 `character_sheet`/`operationType:"character-sheet"` + `assetId` | `node.sbRef="05:C1"` |
| `profile.*` | **不上画布** | 只在 storyboard.html |
| `appearsIn` | 不单独落节点；血缘由分镜节点 `sourceIds` 反向表达 | — |

---

## 11. render 契约与呈现

`render(storyboard, version?) → HTML` 为**纯函数**，模板化（沿用 R-P0-01 demo 的暗色 editorial 形态），v1/v5 同构只换数据 —— 即 req1「稳定」。版本对比 = 对两个快照做字段级 diff 高亮（P2）。

分镜节点 `text` 由**模板渲染**成带稳定字段标签的字符串（`【镜 1】`/`【视觉】`/`【运镜】`/`【声音】`…），回写时用**同一模板反向解析**——渲染器与解析器共享一份模板定义，避免「写得进、读不回」（§8.4）。

**呈现与入口**：

- **形态**：Host `render()` 出完整 HTML（内联 JS：版本切换/锚点跳转/折叠均在文件自带）→ webServer 路由托管（`/canvas-studio/projects/:id/storyboard.html`）→ 客户端 **iframe 同源加载**。
- **覆盖关系**：故事版 = **压在画布上方的全屏覆盖层**，画布布局不动；单一入口 = **画布顶部工作条「拍摄定稿」按钮**（带状态角标：草稿 vN / 缺 N 项 / 已落地 vN）。
- **两阶段共用同一入口**：`storyboarding` 期它是主工作面；`executing` 期随时打开**只读查看** + actuals 对照（「声明 10s / 实际 10.13s」）。
- **实时更新**：事件驱动刷新，秒级——`write/revise/存档/回退` 写 JSON → render 重生成 → 客户端收 `tool/result` 或路由响应 → iframe 刷新（src 带版本号）；overlay 内按钮经 `postMessage` 外壳 React 调 Host API，**落地成功额外由外壳关 overlay + 刷画布**（动作逻辑在 HTML，外壳只管容器与事件）。
- **数据关系一句话**：两个独立文件（`storyboard.json` SSOT 规划 ↔ `canvas.json` 执行），`sbRef`/`bindings` 双向关联，互不覆盖互不内嵌；显示上故事版永远是覆盖层。

---

## 12. 执行期约束注入

### 12.1 `lockedPrompt` 的四层消费

**核心结论**：`gen.lockedPrompt`（SAME 块）不是成品提示词，是**冻结的主体段**；四个消费方各归其位，只有 `character_sheet` 参数一处原样透传，其余组装权在 agent、冻结权在 storyboard。

| 时刻 | lockedPrompt 角色 | agent 动作 |
|---|---|---|
| 出角色设计图（`image_generate`） | `subject_definitions` 开头段逐字节嵌入 | **组装**：SAME 块 + 定妆构图 + §02 Look + 用途描述 |
| `character_sheet` 建四视图卡 | **不进请求体**（`generate.ts` 只发 `{ image }`），只写资产卡注册表 | **原样透传**该参数（零加工） |
| 每镜出图/出视频 | prompt 第一段逐字节复用（工具描述明文） | **组装**：SAME 块（一字不动）+ §04.visual 英文改写 + Look + 景别运镜 |
| `qc_shot` | 缺省 `expect` = 资产卡 lockedPrompt（`host-tools.ts:1524`） | 无需动作 |

**边界**：允许的加工 = **组装**（加段落，按 `h3-prompt-writing` 六段式）；禁止 = **改写块内文字**（skill 底线② + qc 漂移检测双挡）。

### 12.2 四层通道

1. **全局纪律（§00 禁令 + §08）→ system prompt 小节**：新建 `storyboard-discipline-prompt.ts`（照抄 `plan-prompt.ts` 架构：同步 provider + per-cwd 缓存 + `agent/created` 预热），`order: 152`（紧跟 plan 的 151），每条带来源标注「拍摄定稿 §08/§00」。未落地（`storyboarding` 态）无成稿 → 缓存空 → 不注入。
2. **每镜内容（§04）→ agent 消费**：skill 阶段二步骤加「prompt 以定稿 §04 shot 为基底」；`promptEn` 本就是 agent 自写、在上下文里。
3. **一致性（§05 lockedPrompt / §02 tokens）→ 资产卡**：已通（§7.5 #3/#6），不动。
4. 系统提示只带短纪律（§00+§08），不塞 §04/§05 全文，防 bloat。

### 12.3 口径与时机

- **Host 不做隐式 prompt 合并**（否决「image_generate 收 shotRefs 自动拼 promptEn」）：中文纪律无法可靠英译；显式 prompt 会被强制覆盖锁死返工；`promptEn` 可选字段会生出冲突优先级新状态；既有先例是显式参数（`cameraPrefix`），要机注入必须走显式参数，本期不新增。
- **纪律缓存刷新时机**：seed 落地时（Host 路径直接刷，下一轮 assemble 生效）/ f2 结构修订改 §08 / L 回写改 §08。**§08 归 L 类**——改约束不改画布拓扑，直写 sections + 刷纪律缓存，不触发 f2；改镜头增删才是 f2。
- **`qc_shot` 每镜 expect 增强（§04.visual 作 per-shot 基准）不做**：CV-240 已限定质检为交付后报告，挂 backlog P2。

---

## 13. 与 R-P0-01 的差异 / 修正

| 项 | R-P0-01 原稿 | 本稿（v2）修正 |
|---|---|---|
| 状态机 | 5 态（含 drafting/script_review/awaiting_approval） | **3 态**：`storyboarding`/`keyframe_review`/`executing`（§3） |
| 确认机制 | 「确认进入画布」门 + submit 工具 | **落地按钮 → Host 路由**，非 agent 工具；三层校验 + 单向终点（§7） |
| 版本管理 | 「每次改写版本 +1」 | 模型 C：活副本 + 存档按钮 + 3 checkpoint + final 冻结（§5） |
| seeding | 「五路映射」笼统说法 | 字段级映射表（10 行）+ `sbRef`/`bindings` 双向关联 + 锚点节点（§7.5） |
| 回写 | 原稿单向「画布产出不回写」 | 双向：P/L/A 全字段表 + L 类 diff 直写 + A 类 Host 自动（§8） |
| 结构 | 无分镜增减通道 | 「结构修订」+ `revise_storyboard` 独立工具 + delta re-seed + 孤儿处理（§9） |
| 角色卡 | 未明确 canvas 落点 | `profile`/`gen` 分离，画布只露生成级（§10） |
| 呈现入口 | ⑨ 待拍板项之一 | 已拍定：iframe 全屏覆盖层 + 画布顶条按钮（§11） |
| 旧分镜工具 | 未涉及 | `write_screenplay`/双 submit 全下线；`approval-gate` 收敛单值（§3.3） |
| 约束注入 | 「逐次注入」意图 | 落为四层通道 + system prompt 小节机制（§12） |

---

## 14. 开放项 / 实施清单

### P1 落地最小集（估 3~4 天 + 收口）

状态机 3 态（`normalizeWorkflow` 迁移 + `approval-gate` 重写）→ schema + `validateForSeed` → `write_storyboard` 工具 → seed（§7.5 映射 + 镜号铸造 + `isShotCard`）→ overlay（`render` 纯函数 + 路由 + iframe + 落地按钮）→ 三工具下线 + skill/文档同步。

### P2

版本切换/存档按钮全量（checkpoint 已入 P1 核心）/ 字段级 diff 高亮 / `revise_storyboard` + delta re-seed / L 类回写 diff 全表 / 发现性提示 / `qc_shot` per-shot expect。

### P3

搜索接入 + 声音映射全量 + `actuals` 回写 UI。

### 开工时机械清单（随 P1 批次，CV 号开工取 **CV-293**，写前 grep 整个 `docs/` 复核）

- [ ] `docs/canvas-studio-tools.md`：+`write_storyboard`/`revise_storyboard`、−3 旧工具、7 处 shotRefs 描述更新（有测试守卫）
- [ ] skill：`canvas-studio-creation` SKILL.md（阶段一步骤重写 / 阶段二「prompt 以 §04 为基底」/ step 4 lockedPrompt 前置改由落地确认接管 / 门禁文案）+ 涉 approval 的 references + `skill-guardrail`/`skills` 测试断言
- [ ] 测试面：`approval-gate` / `approval-notice` / `workflow-gate` / `auto-test-*`（`STORYBOARD_NODE_TOOL`→`isShotCard`）/ 工具注册 / 与 `baseline-red.json` 对账
- [ ] `tracking.md` REQ-022 条目推进 + `STATUS.md` §4 CV 条目登记（收尾四步）
