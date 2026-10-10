# R-P0-02 · Storyboard 数据契约（storyboard.json ↔ canvas.json）

> 状态：讨论定稿（2026-10-10 用户拍板全部决策）
> 承接：[R-P0-01 两阶段 Storyboard 形态设计](./R-P0-01-两阶段Storyboard形态设计.md)
> 配套可视化：`canvas_studio_flow.html` 第 ⑩ 节「数据契约 R-P0-02」

本文把「故事版生成阶段 → 敲定 → 落地画布 → 画布改动回写」这条链上的**数据格式 / 版本 / 展示 / 更新 / 传递**钉成可落地契约。所有节点字段以真实画布 `~/Desktop/job/VideoOut/newOut1/projects/.draft-202609-2/canvas.json` 的拓扑为锚，确保 seed 出来的节点现有生成工具链路一行不用改。

---

## 1. 5 条基础需求与对应结论

| # | 需求 | 结论（本节契约落点） |
|---|---|---|
| 1 | 故事版要能稳定转 HTML 展示 | `render(storyboard, version?)` 纯函数、模板化，v1/v5 同构只换数据 |
| 2 | 能切换不同版本做对比 | `versions.history[]` 全量快照；任意版本可渲染；字段级 diff 高亮 |
| 3 | 敲定后干净落画布（不带历史污染 agent/画布） | `seed(终版)` 纯函数 + 显式丢弃清单 |
| 4 | 拆分落节点供 agent 调工具产出（图/视频/音频） | 字段级映射表对齐真 canvas.json，现有 `video_composite` 链路零改动 |
| 5 | 画布节点改动回写故事版同步 | `sbRef` + `bindings` 双向关联 + 字段三分类 P/L/A |

---

## 2. 决策账（总表）

| # | 议题 | 结论 |
|---|---|---|
| 1 | 物理形态 | `storyboard.json`（SSOT）**独立**于 `canvas.json`；`render()` 纯函数出 HTML |
| 2 | 版本管理 | 模型 C：活副本 + 「存档为新版本」按钮 + 双自动 checkpoint（首稿→v1、确认→终版冻结）；存储用**全量快照** |
| 3 | 关联机制 | **双向双 ID**：canvas 节点/资产带 `sbRef`（语义 ID）→ 故事版；storyboard 的 `bindings` 块（版本快照之外）存 canvas UUID 反查 |
| 4 | 干净落地 | `seed(终版)` 纯函数，显式丢弃版本历史/编辑痕迹/待核实/对话；画布只拿「生成机器要吃的最小集」 |
| 5 | 拆分落节点 | 照 canvas.json 实证拓扑 1:1 映射，现有生成工具链路零改动 |
| 6 | 回写 | 字段三分类：**P 规划冻结**（走结构修订）/ **L 生成参数**（画布改→直接写回 sections+重渲染）/ **A 执行实况**（写 `actuals[sbRef]`，不碰 sections） |
| 7 | 增删分镜 | 确认后放行，定性「结构修订」：版本链 f2/f3 + delta re-seed（只增删对应节点），下游生成物标孤儿不自动删 |
| 8 | 角色卡 | `profile`（人读，只上 HTML）与 `gen`（机读 lockedPrompt/negativePrompt，画布可改可回写）分离；画布只露生成级字段 |

> 与 R-P0-01 设计稿的 4 处修正见 §12。

---

## 3. 物理边界：为什么独立文件

```
storyboard.json  ──SSOT──  版本仓库(v1..vn + 终版冻结)   + bindings(快照外) + actuals(快照外)
   │  render()                │  seed(终版)  ──纯函数, 丢弃历史──
   ▼                          ▼
storyboard.html          canvas.json（执行）
(用户审阅/版本对比)        节点带 sbRef 回指针
                              │  node edit (用户手改 / agent 改)
                              ▼  writeback via sbRef
                         storyboard.json.actuals / sections 更新 → 重渲染 HTML
```

- 物理上 storyboard.json 与 canvas.json 是**两个文件**。确认时一次性 `seed`，不是把故事版嵌进 canvas——否则版本历史/草稿会污染画布字段，直接违反 req3。
- `bindings` 与 `actuals` 放在 `versions.history[]` 快照**之外**（与 `versions` 同级），所以既不污染版本 diff，也不进 seed 投影。

---

## 4. storyboard.json Schema

```jsonc
{
  "schemaVersion": 1,
  "projectId": "…",
  "title": "《雨夜来信》",
  "meta": { "genre":"民国悬疑", "targetDuration":30.0, "aspect":"16:9", "audience":"…" },
  "sections": {
    "00_creative":   { "brief":"…" },
    "01_facts":      { "facts":[ { "claim":"…", "source":"https://…", "status":"verified|pending" } ] },
    "02_logline":    { "logline":"…", "arc":"…" },
    "03_narration":  { "lines":[ { "id":"N1","text":"…","duration":2.5,"shotRef":"S1-Sh1" } ] }, // 旁白只写一次
    "04_storyboard": { "scenes":[
        { "id":"S1","title":"初见","shots":[
            { "id":"S1-Sh1","duration":5.0,"frames":120,"camera":"…",
              "visual":"…","audio":"…","narrationRef":"N1","promptEn":"…","backup":false }
        ]}
    ]},
    "05_characters": [ { "id":"C1","label":"ROLE A","name":"苏婉",
                        "tags":["女","26岁","单女主"],
                        "profile":{ "temperament":"…","face":"…","costume":"…" },  // 人读, 只上 HTML
                        "palette":{ "base":"warm ivory","accent":"围巾暗红" },
                        "appearsIn":["S1"…"S6"],
                        "gen":{ "lockedPrompt":"…","negativePrompt":"…" } } ],   // 机读, 落画布可回写
    "06_sound":      { "bgm":{…}, "sfx":[…] },
    "07_assets":     [ … ],          // 素材清单
    "08_constraints":[ "…" ]          // 硬约束
  },
  "versions": {
    "current": "v2",
    "history": [
      { "version":"v1","label":"初稿","createdAt":…,"snapshot":{/* 全量 sections */} },
      { "version":"v2","label":"黄昏版","createdAt":…,"parent":"v1","snapshot":{/* 全量 sections */} }
    ],
    "final": null   // 确认后填 frozen 的全量快照
  },
  "bindings": {},     // 版本快照之外：{ "05:C1": { canvasNodeId, canvasAssetId, seededFrom:"final" } }
  "actuals": {}      // 版本快照之外：{ "04:S1/shots/S1-Sh1": { actualDuration, framingNote } }
}
```

**语义 ID 规则（关联稳定的根基）**：`sections` 内每个可映射单元都铸一次 ID，跨版本永不改、永不复用——`00`/`01`/`02`/`03` 为节级；`04:S1`(分镜)、`04:S1/shots/S1-Sh1`(shot)、`05:C1`(角色)、`06:bgm` 等。全文重写时铸造**新** ID，旧节点走孤儿流程。

---

## 5. 版本管理（模型 C）

1. **实时活副本**：每次对话式局部重写 / 行内微调都**立即重渲染**预览，但**不因此 +1 版本号**；顶栏徽标只显示「活副本 · 最近改动：分镜1 时长 5→7s」这类活状态。
2. **「存档为新版本」按钮**：用户点一下才生成 v2/v3…，附 diff 摘要、可命名（如「黄昏版」）、可回退。
3. **两个自动 checkpoint**：① 首稿 `write_storyboard` 产出时自动 v1；② 点「确认进入画布」时自动冻结最终版（之后不许再改，进 seeding）。
4. **存储 = 全量快照**：`history[]` 存每个版本的**完整 `sections`**（storyboard 小，<100KB，全量最稳、diff 最省事）。`render(v)` 直接读对应快照，版本切换/对比零成本。

> 修正设计稿原「每次改写版本 +1」：该模型会让 10 次微改变成 v1~v11 噪声，回退失去意义。模型 C 保留「看着一版版长出来」的观感（活副本连续可见），但版本号只标记里程碑。

---

## 6. 关联机制：双向双 ID（req2/req3/req5 的钉子）

```
storyboard.json（SSOT）                      canvas.json
──────────────────────────                  ────────────────────────────
sections.05_characters[ id:"C1" ] ◀─ sbRef ── node.sbRef  = "05:C1"   （画布→故事版）
                                            asset.sbRef = "05:C1"
bindings: {                      ── uuid ──▶ node.id = "c5a047ca-…"    （故事版→画布）
  "05:C1": { canvasNodeId, canvasAssetId, seededFrom:"final" }
}
```

- **画布→故事版**：seed 时给每个节点写一个 `sbRef` 字段，值是 storyboard 里的**语义 ID**（`05:C1`、`04:S1/shots/S1-Sh1`）。人可读、roundtrip 不丢。
- **故事版→画布**：`bindings` 块存画布 UUID，放版本快照之外（不进 diff、不进 seed 投影），既不污染画布也不污染版本历史。
- **为什么不用名字**：「苏婉」「分镜 1」会被改名，一改关联就断；**为什么不用位置**：增删分镜后索引全漂。只有一次铸造、永不复用的语义 ID 稳。
- **向后兼容**：现有 canvas.json 里的 `sourceIds`/`shotNodeIds` 用画布内部 UUID，**保持原样不动**；`sbRef` 是附加字段。老画布没有 `sbRef` → 不参与回写。

---

## 7. seed 契约（req3 干净 + req4 拆节点）

`seed(storyboard.versions.final)` = **对终版的纯函数**，只投影画布要的字段。

### 显式丢弃清单（req3 的"不带历史"）
版本历史、编辑痕迹、`§01` 里 `status:pending` 的待核实项、agent 对话、活副本状态。

### 字段级映射表（对齐真 canvas.json 拓扑）

| storyboard 节 | 落地节点 | kind / tool / operationType | 关键字段 | sbRef |
|---|---|---|---|---|
| `04_storyboard` 每个 shot | 分镜文本节点 | text / `seed_storyboard` / `storyboard` | `declaredDuration` `declaredFrames` `sourceIds:[剧本]` | `04:S1/shots/S1-Sh1` |
| `05_characters` | 角色资产+图节点 | image / `character_sheet` / `character-sheet` | `assets[]` `role:character` `lockedPrompt` `negativePrompt` | `05:C1` |
| look/style（`00` 或 `06`） | Look 图节点 | image / `image_generate` / `look` | `assets[]` `role:style` `lockedPrompt` | `00:look` |
| `03_narration` | 文案节点 | text / `write_script` | 旁白/BGM/SFX 全文 | `03` |
| `00_creative` | 创意节点 | text / `user_brief` | 根 brief | `00` |

### 只造骨架（不预生成媒体）
seed **只造结构骨架**（文本节点 + 资产定义 + look 占位）。角色图 / 场景图 / 视频仍由 agent 在执行期调 `image_generate` / `character_sheet` / `video_composite` 消费这些节点完成——这正是 req4「方便 agent 调用工具产出」的落点，且现有 `video_composite` 靠 `sourceIds + shotNodeIds` 拉节点的机制原样复用（零改动）。

### 锚点血缘
同时落一张「故事板」BRIEF 文本节点作血缘根，`sourceIds` 连到由它 seed 出的分镜卡，便于回溯"这段画面意图来自哪一镜"。

---

## 8. writeback 契约（req5）：字段三分类 P / L / A

每个字段按**可变性与回写去向**分三类：

| 类 | 例 | 确认后画布能改？ | 改了写到哪 |
|---|---|---|---|
| **P 规划冻结** | 分镜结构、旁白文本、硬约束、logline | 走特殊「结构修订」操作（§9） | `sections`（修订链 f2/f3） |
| **L 生成参数 live-sync** | 角色 `lockedPrompt`/`negativePrompt`、look `lockedPrompt`、BGM 参数 | ✅ 直接改 | 直接写回 `sections` 对应字段 + 重渲染 HTML |
| **A 执行实况 actuals** | 实际时长（10.13 vs 声明 10）、实拍构图备注 | ✅ agent 自动记 | `actuals[sbRef]`，**永不碰 sections** |

**流程**：画布节点被改（用户手改分镜文本 / agent 记录实际时长）→ 读 `sbRef` → 定位 `storyboard.json` 字段 → 更新 → 调 `render()` 刷新 HTML。

**actuals 覆盖层**（解决"确认即冻结 vs 节点回写"张力）：执行真相（实际时长 10.13 vs 声明 10、实际构图备注）写进 `storyboard.json.actuals[sbRef] = {actualDuration, framingNote}`，**不动 `sections` 规划字段**。`render()` 有 actuals 时显示"声明 10s / 实际 10.13s"，规划意图纹丝不动。

**闸门**：仅带 `sbRef` 的规划节点参与回写；生成的 video / group / audio 节点无 `sbRef` → 一律忽略，绝不反向污染故事版。

**分镜文本 roundtrip**：节点 `text`（「【镜 1】大远景 · 10s\n画面：…\n声音：…」）是模板渲染出的扁平字符串，回写时用**同一模板反向解析**——渲染器与解析器共享一份模板定义，避免"写得进、读不回"错位。

---

## 9. 结构修订（分镜增减 · req5 延伸）

确认后放行分镜增减，但定性为特殊操作，不走普通回写：

1. 用户说「第 3 镜拆成两镜」→ agent 调 `revise_storyboard`（执行期结构修订模式）→ 版本链推进 f2/f3（快照仍全量）；
2. **delta re-seed**：新增 shot → 铸新语义 ID → 只造**新增**的那个分镜节点（带 sbRef）插进对应素材组；删 shot → 节点移除，其下游视频节点标「源已删」孤儿提示，**不自动删用户已生成的视频**；
3. 画布上永远只有当前修订版结构，修订历史只活在 storyboard.json 里——req3 的「干净」始终成立。

---

## 10. 角色卡 JSON 组织 + 画布映射（人读/机读分离）

```jsonc
// sections.05_characters[]
{
  "id": "C1",                      // ★ 语义ID：write_storyboard 铸造，跨版本永不改，关联全靠它
  "label": "ROLE A",               // 显示用，可改，不参与关联
  "name": "苏婉",                   // 显示用，可改，不参与关联
  "tags": ["女","26岁","单女主","全片唯一正脸"],
  "profile": {                     // 人读的创作向描述 → 只在 storyboard.html 展示/编辑，不上画布
    "temperament": "静，但不是弱。她被吓到时第一反应是去看而不是逃……",
    "face": "鹅蛋脸，眉细而平，眼神清亮偏冷……",
    "costume": "月白旗袍 + 深灰开衫，发髻低挽……"
  },
  "palette": { "base": "warm ivory", "accent": "围巾暗红" },
  "appearsIn": ["S1"…"S6"],
  "gen": {                         // ★ 机器读的生成参数（L类）→ 落画布，可改可回写
    "lockedPrompt": "26-year-old chinese woman, oval face… 1930s suspense portrait.",
    "negativePrompt": "不改变五官发型与服装配色；不增删人物……"
  }
}
```

| storyboard 字段 | canvas.json 落点 | 关联 |
|---|---|---|
| `gen.lockedPrompt` | `assets[]` role:character `.lockedPrompt` | `asset.sbRef="05:C1"` |
| `gen.negativePrompt` | `assets[]` `.negativePrompt` | 同上 |
| 角色图（占位） | image 节点 `character_sheet` / `operationType:character-sheet` + `assetId` | `node.sbRef="05:C1"`，bindings 记 UUID |
| `profile.*`（气质/面部/服装） | **不上画布**——req3 要干净，画布只留生成需要的 | 只在 HTML 里看和改 |
| `appearsIn` | 不单独落节点；血缘由分镜节点的 `sourceIds` 反向表达 | — |

分工呼应 req3：**画布拿到「生成机器要吃的最小集」，人看的故事全貌留在故事版 HTML**。

---

## 11. render 契约（req1）

`render(storyboard, version?) → HTML` 纯函数，模板化（沿用 R-P0-01 demo 的暗色 editorial 形态），v1/v5 同构只换数据 → 这就是"稳定转换"。版本对比 = 对两个快照做字段级 diff 高亮（如镜头数、时长、提示词差异）。

---

## 12. 与 R-P0-01 设计稿的差异修正

| 项 | R-P0-01 原稿 | 本契约（R-P0-02） |
|---|---|---|
| 版本机制 | 每次改写版本 +1 | 模型 C：活副本 + 手动存档 + 双自动 checkpoint |
| seeding 描述 | 笼统「五路映射」 | 字段级映射表 + `sbRef` 回指针 |
| 回写 | 单向「画布产出不回写」 | 双向：`sbRef`+`bindings` + P/L/A 三分类 + actuals 层 |
| 分镜增删 | 未定义 | 放行，定性「结构修订」+ delta re-seed |
| 角色卡 | 未细分 | `profile`(人读,只上HTML) / `gen`(机读,落画布可回写) 分离 |

---

## 13. 落地建议（P1 最小集）

1. `storyboard.json` schema（§4）+ `bindings`/`actuals` 版本快照外设计；
2. `write_storyboard` 工具（铸语义 ID、产 v1）；
3. 只读预览 `render()`（§11）+ 「存档为新版本」按钮（模型 C）；
4. 确认门 `submit_storyboard_for_confirmation`（冻结终版）；
5. `seedCanvasFromStoryboard`（§7 最小映射集，不预生成媒体）。

> 是否登记进 `docs/STATUS.md` 的 running max 体系待用户确认（本仓习惯验收后再补编号）。
