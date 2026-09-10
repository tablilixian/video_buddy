# 视频生成模式选择：从「图片数量」改为「图片语义」驱动（CV-132）

> 日期 2026-09-10（末次更新 2026-09-10 下午） ｜ 状态：**方案已定稿·待实施**（本文仍只做方案，未改代码）
> 起因（用户观察）：`只给了一张角色参考图` 时，编排会把它**当成首帧**直接生成视频，
> 于是参考图本身出现在成片里；用户认为正确做法是「**先理解这张图的含义 → 据此生成关键帧 → 再用关键帧生成视频**」。
> 关联：CV-119（H3 IR 预检的模式映射）、CV-105（尾帧链 `referenceRole='frame'`）、
> CV-103/CV-104（一致性资产卡与锚点）、CV-131（统一时间轴）、`skills-local/canvas-studio-creation/SKILL.md` 第 9 步。
> 用户拍板（2026-09-10 下午）：① 关键帧走 I2VA、参考图走 Ref2VA，**先看这张图是什么**；
> ② **保留后门**（「从这张图开始生成后面 10 秒」这类需求需支持）；③ **自动补一步**，
> 甚至可以直接复制一遍 —— 让流程更顺畅。

---

## 0. 一句话结论

当前**选哪个工具、用哪种模式**，唯一依据是**图片数量**；而图片的**语义角色**
（首帧？角色锚点？场景概念？风格？）在数据模型里**已经存在**（`referenceRole`）却**没有任何一处消费它**。

**定稿方向**：不追求「把用途猜准」，而是**让猜错不致命** ——
引入 **关键帧归一化（Keyframe Normalization）**：视频生成前，保证画布上存在一个
**明确的关键帧节点**；输入不是关键帧，就先把它**变成**关键帧（复制或重画）。
归一化之后，「参考图被当成第 0 帧」这个 bug 在结构上不可能发生。

---

## 1. 现象

用户给一张角色参考图（定妆照/立绘），本意是「让这个角色演一段新戏」。
结果成片的第一帧就是那张参考图本身 —— 因为它在链路里被当成了**首帧**（逐像素起点），
而不是**参考**（只提供长相/气质，由模型另构图）。

---

## 2. 当前调用逻辑（代码事实）

判定入口只有一个纯函数：`capabilityOf(tool, params)`（`src/providers/capability.ts:42`），
入参 `CapabilityInput` 只声明三个字段：`filename` / `filenames` / `audioRefs`（同文件 `:17-26`）。

| 工具 | 条件 | `capabilityOf` 判定 | 落到 Drama 端点 | 图的语义 |
|---|---|---|---|---|
| `video_generate` | 无 `filename` | `text-to-video` | `fl2va`（无图） | — |
| `video_generate` | 有 `filename` | `first-last-frame` | `fl2va` + `image1` | **首帧（逐像素起点）** |
| `video_composite` | 2 张 | `first-last-frame` | `fl2va` + `image1/2` | 首帧 + 尾帧 |
| `video_composite` | **1 张** | `multi-reference` | **`ref2va`** + `image1` | 参考（官方 r2v） |
| `video_composite` | ≥3 张 | `multi-reference` | `ref2va` + `image1..6` | 参考 |
| 任意 | 带 `audioRefs` | `multi-reference`（`capability.ts:46`，压过其它） | `ref2va` | 参考 |

关键两行（`capability.ts:47-50`）：

```ts
if (tool === 'video_generate') {
  return params.filename !== undefined ? 'first-last-frame' : 'text-to-video'
}
return (params.filenames?.length ?? 0) === 2 ? 'first-last-frame' : 'multi-reference'
```

**两个入口对同一张图的解读完全相反**，而分界线只是「调用了哪个工具」。

---

## 3. 四处硬伤

### 3.1 单图 = 首帧，从不问「这是参考还是关键帧」

同一张角色定妆照：

- 走 `video_generate(filename=…)` → 当**首帧** → 视频 **0.00 秒就是这张定妆照本身**
- 走 `video_composite(filenames=[1 张])` → 当**参考** → 官方 r2v，模型另构图

工具描述也在鼓励前者：`video_generate` 的 `filename` 参数说明就是「**用作视频首帧**」。
agent 读到「只有一张图 + 要生成视频」，最自然的动作就是 `video_generate(filename=那张图)`。

### 3.2 `referenceRole` 字段存在，但生成链路零消费

- 定义：`src/contracts/canvas.ts:161` —— `referenceRole?: 'image' | 'character' | 'style' | 'frame'`，
  注释明写「**决定 agent 选用哪个生成工具与强度**（Runway 式分类）」
- UI：详情面板有下拉选择器（`LayerDetailPanel.tsx:306`）、节点有角色徽标（`CanvasNode.tsx:589`）
- 对模型可见：`list_references` 会把 role 报给模型（`host-tools.ts:849`，缺省 `'image'`）
- **但 `capabilityOf` 的入参里根本没有 role** —— 生成链路读不到它，字段形同注释

### 3.3 单图分支在 `video_composite` 上自相矛盾

同一份输入（1 张图 + `video_composite`）被两处按**不同模式**解读：

| 处 | 判为 | 位置 |
|---|---|---|
| 能力解析 | `multi-reference`（→ `ref2va`） | `capability.ts:50` |
| H3 IR 预检 | **`I2VA`**（1 图作首帧） | `host-tools.ts:986` |
| 工具描述 | **只写了 2 张 / ≥3 张，1 张的分支没写** | `host-tools.ts` video_composite |

后果：agent 按 Ref2VA 六段式写 IR → 被 I2VA 预检拦下（模式用错 K5）；
按 I2VA 写 → 预检通过但请求被送到 `ref2va` 端点。**两边必有一边是错的。**

### 3.4 两个工具的描述对 role 的期待正好相反（核实中额外发现）

| 工具 | 描述原文（`host-tools.ts`） | 暗示 filename 应是 |
|---|---|---|
| `video_generate`（`:886`） | 「传入 filename 时为首帧图生视频」「role=**frame** 的参考即首帧图」 | **frame** |
| `video_composite`（`:942`） | 「两张图走首尾帧插值；三张及以上走多参考图合成」「role=**character/image** 的参考即可用」 | **character / image** |

而用户上传 / 对话贴图旁路落的**导入节点 role 缺省就是 `image`**
（`project-store.ts:823` 默认参数 `referenceRole = 'image'`，`:841` 在 `isReference` 为真时写入节点；
`list_references` 也把缺省值报成 `image`，`host-tools.ts:849`）。
→ 按 `video_generate` 的描述，缺省 role 的图**不该**被当首帧；按 `video_composite` 的描述**可以**当参考。
**描述与实现互相打架，agent 无论怎么读都会有一半概率踩空。**

---

## 4. 用户给的判据（正确形态）

```
参考图 → （image_generate 据此出关键帧）→ 关键帧 → （video_generate 首帧）→ 视频
```

而不是：

```
参考图 → video_generate（当首帧）→ 视频          ← 参考图直接出现在成片里
```

即：**先判断图的用途，再决定它的落法**；参考图必须先「转化」成该镜的关键帧。

**用户补充的三条拍板（2026-09-10 下午）**：

1. **分派原则**：看图是什么 —— **关键帧 → I2VA**，**参考图 → Ref2VA**；并追问「有没有可能判断出这张图的用途」。
2. **保留后门**：需要支持「给一张图，生成从这张图开始的后面 10 秒」这类需求（**图即起点**）。
3. **自动补一步**：参考图缺关键帧时**自动补一步**（甚至**直接复制一遍**），让流程更顺畅。

---

## 5. 现状是否已覆盖这条路径？—— 覆盖了一半

**理想路径是有的**（`skills-local/canvas-studio-creation/SKILL.md`）：

- 第 5 步：逐镜出图 `image_generate` 生成关键帧
- 第 6b 步：`submit_keyframes_for_approval` 关键帧审批门禁（未确认不许生成视频）
- 第 9 步（`:82`）：「逐镜视频（**参考组合优先**）—— 默认 `video_composite` 多参考 Ref2VA
  （角色锚点 + 场景概念图 + 可选姿态帧），仅同镜首尾转场用两图 FL2VA，**都不适用才退 `video_generate`**」

也就是说：**规范里本来就要求「关键帧先行、参考组合优先」**。但落不了地的原因：

1. **零工程约束** —— agent 直接 `video_generate(filename=参考图)` 不会报错、不会告警、不会被拦；
2. **工具描述反向引导** —— `filename` 的说明本身就是「用作视频首帧」，看起来完全合法；
3. **只提供一张图时最容易短路** —— 用户只贴一张图 / agent 想「省一步出图」，
   就会跳过关键帧，直接把参考图喂给 `video_generate`；
4. **单图走 `video_composite` 的分支没写清楚**（§3.3/§3.4），agent 无从判断该走哪个入口。

**结论：这是「纪律靠文档、无工程兜底」的典型 —— 与 CV-119（IR 预检）之前的状态同类。**

---

## 6. 用途能不能自动判断？（回答用户问题 ①）

**能，但只覆盖一部分 —— 而且漏掉的恰好是最常见的那部分。**

判断依据是**证据链**，按可靠度分五层：

| 层 | 信号 | 来源 | 可靠度 | 覆盖场景 |
|---|---|---|---|---|
| **L1 显式声明** | `referenceRole` 手工标注；新增 `intent` 参数 | 用户/agent 主动指定 | **最高** | agent 明确知道意图时 |
| **L2 来源溯源** | 节点的 `toolName` | 生成它的工具 | **很硬** | **画布内自己产出的图**（见下表，近乎 100%） |
| **L3 血缘** | 节点的 `sourceIds` | 上游节点 | 中 | 从某视频抽的帧、从某图衍生的图 |
| **L4 语义判断** | prompt / 对话上下文 | **由 agent 判断**（它有上下文） | 中 | 用户新上传/新贴的图 |
| **L5 安全默认** | — | 兜底 | — | 全都拿不到时 |

### 6.1 L2 能覆盖的情况（画布内产物，几乎可 100% 判定）

`toolName` / `operationType` 都在节点上（`contracts/canvas.ts:91/99`），这是**可靠的溯源链**：

| 来源工具 `toolName` | 产物定义上必然是 | 判定 |
|---|---|---|
| `extract_last_frame` | 某个视频的**尾帧** | **frame** |
| `storyboard_generate` / `storyboard_split` | 分镜帧 | **frame** |
| `inpaint` | 修图产物 | **frame** |
| `image_generate`（无 filename） | 文生图 = 关键帧/概念图 | **frame** |
| `image_generate`（有 filename） | 图生图产物 | **frame**（若 prompt 是出关键帧） |
| `character_sheet` | 角色四视图**锚点拼图** | **character** |
| `character_generate` | 角色立绘 | **character** |
| `style_transfer` | 风格迁移产物 | **style** |

### 6.2 **L2 覆盖不到的情况（用户 bug 的现场）**

| 来源 | role 缺省值 | 能否判断 |
|---|---|---|
| 用户**上传**的图（`origin='manual'`，走 `addImportNode`） | `image`（`project-store.ts:823` 默认） | ❌ **无法判断** |
| 对话里**直接贴**的图（附件旁路落卡，同上） | `image` | ❌ **无法判断** |

**这两行恰恰就是「用户给一张角色参考图」的场景。** 所以：

> **纯推断不够。** 无论把 L1–L4 做得多好，用户新给的图永远是「未知用途」。
> 这时候只剩两条路：**问用户**（打断流程）或**安全侧默认**（有代价）。

### 6.3 关键洞察：与其猜准，不如让猜错不致命

注意两侧的**失败代价是不对称的**：

| 误判方向 | 后果 | 严重度 |
|---|---|---|
| 把**参考图**误判成首帧（I2VA） | **参考图直接烙进成片第 0 帧** ← 用户遇到的 bug | **产品级事故** |
| 把**关键帧**误判成参考（Ref2VA） | 只是首帧没锁住，画面可能漂移 | 软失败（可重做） |

→ 默认必须偏 **Ref2VA**（安全侧）。但更好的做法不是「默认得对」，而是**消除这个二义性本身**
（见 §7）。

---

## 7. 定稿方案：关键帧归一化（Keyframe Normalization）

### 7.1 核心思想

> **不要去问「这张图该用 I2VA 还是 Ref2VA」，而是问「画布上有没有一个明确的关键帧」。**
> 没有 → **先补一个**；有了 → 一律按关键帧走 I2VA。

视频生成前插入一个**归一化步**：

```
归一化后，所有视频生成的视觉输入都必须是「画布上 role=frame 的关键帧节点」
                    ↓
        「参考图 vs 首帧」的二义性从根上消失
```

**为什么这样更好**：判断用途是**猜测**，补关键帧是**操作**。猜测会错，操作不会 ——
一旦画布上有了明确的关键帧，参考图就**退回它本来的位置**（参考），
「它出现在成片第 0 帧」在结构上不再可能。

### 7.2 归一化后的模式分派表（收敛到 I2VA）

| 输入情况 | 归一化动作 | 生成模式 |
|---|---|---|
| 已是关键帧（`role=frame` 或显式 `intent='start-frame'`） | 无需 | **I2VA**（首帧） |
| 关键帧 + 尾帧 | 无需 | **FL2VA**（首尾帧插值） |
| 参考图（character / style），无关键帧 | **补一步**（见 §9） | I2VA（用补出的关键帧） |
| 多参考（角色锚点 + 场景），无关键帧 | **补一步** | I2VA 或 Ref2VA |
| 仅纯文本 | **补一步** | I2VA |
| 带参考音频 | 强制 | **Ref2VA**（官方规定音频与帧模式互斥） |

**归一化后绝大多数情况收敛到 I2VA** —— 这同时把 §3.3 的口径冲突一并消解
（`video_composite` 的「1 张」分支不再需要靠数量猜：1 张参考图会先被归一化）。

### 7.3 与「参考组合优先」规范的关系

不是推翻总纲第 9 步，而是**把它从纪律升级为工程保证**：

- 总纲第 9 步要求「参考组合优先（`video_composite` Ref2VA）」—— 归一化后仍然成立：
  **多参考**（角色锚点 + 场景 + 关键帧）依旧走 `video_composite`
- 归一化补的是**缺失的那一环**：单张参考图**没有**关键帧时，不让它短路成首帧
- 总纲第 5/6b 步（关键帧先行 + 审批门禁）与归一化天然一致：归一化就是「补做第 5 步」

---

## 8. 后门设计（回答用户问题 ②）

用户需求：「**给一张图，生成从这张图开始的后面 10 秒**」—— 图即**起点**，这必须支持。

**但实现方式不应该是「`filename` 隐式当首帧」**（那正是 bug 源），而应该是
**「归一化的 copy 分支」**：

```
用户：「用这张图作为起点，生成后面 10 秒」
  → agent 判定 intent = 'start-frame'
  → 归一化：把这张图 **copy 成关键帧节点**（role=frame）
  → video_generate(filename=该关键帧) → I2VA → 正确
```

**为什么用 copy 而不是「直接当首帧」**：

| | 直接当首帧（现状） | copy 成关键帧（建议） |
|---|---|---|
| 语义 | 图是游离输入 | 图是画布一等节点 |
| 可追溯 | ❌ 成片从哪来查不到 | ✅ `sourceIds` 有血缘 |
| 可重做 | ❌ 只能重跑整条 | ✅ 关键帧可单独重做（CV-108 版本链） |
| 可审批 | ❌ 绕过关键帧门禁 | ✅ 走 6b 审批 |
| 与参考图的区分 | ❌ 靠调用者自觉 | ✅ 结构上区分（frame vs 参考） |

**三条进入 I2VA 的合法路径**（都要显式，不再隐式）：

1. `filename` 指向的节点 `referenceRole === 'frame'`
2. 该节点是 `extract_last_frame` / `storyboard_*` 产物（L2 溯源确认为帧）
3. 工具参数显式声明 `intent: 'start-frame'`（agent 按用户语义主动声明）

→ 三条都不满足时，**不再静默当首帧**，而是报错并给出修复指引（见 §10 的 P1）。

---

## 9. 自动补步的两种模式（回答用户问题 ③）

用户建议「**甚至可以直接复制一遍**」—— **这个思路是对的，而且是最优解之一**。
补步有两种模式，由**意图**决定：

| 意图（agent 判定） | 补步模式 | 做法 | 为什么 |
|---|---|---|---|
| 「**从这张图开始** / 按这张推演」 | **promote-copy** | 直接把参考图**复制**成关键帧节点 | 用户给的图**就是**他要的起点（往往是他精修过的）；**重新生成会改变它**，违背意图还多花一次出图钱。零成本、零失真 |
| 「**以这个人物为主角** / 保持这个风格」 | **promote-generate** | `image_generate(filename=参考图, prompt='第 0 帧：<新构图>')` | 需要**新构图**，只继承角色/风格特征 —— 这正是官方 r2v 的用法 |
| **未知**（用户上传的图，无明确表述） | **promote-generate** | 同上 | 未知时**不能假设它就是起点**（那正是 bug）。重画最安全，且给用户一个可见的关键帧去确认 |

### 9.1 技术可行性：**已有能力，零新增依赖**

核实结论：`image_generate` **已原生支持参考图输入**
（`host-tools.ts:563` 描述：`filename` 单参考图生图 → `image2image`；`filenames` 最多 3 张多参考融合），
`promote-copy` 更是**零成本**（复制节点 + 改 role）。

→ **本方案不需要任何新的生成能力，纯编排 + 判定逻辑。**

### 9.2 补步的四个配套要求

1. **必须可见**：补出的关键帧要落到画布上（用户能看见、能改、能重做），不能是隐形的中间态。
2. **必须告知**：工具结果里显式回报「已自动补出关键帧节点 id=X（因为输入的是一张参考图）」
   —— 让 agent 与用户都知道发生过这一步（诚实回显范式，与 CV-127b 一致）。
3. **走审批门禁**：补出的关键帧进入 6b 门禁（若项目处于 `keyframe_review` 模式），
   用户可在生成视频前否决 —— 这正是「参考图变关键帧」后用户确认构图的机会。
4. **可关闭**：提供开关（默认开）。用户明确要「一步到位」时关掉，退化为报错 + 提示手动补。

---

## 10. 实施拆解（待拍板）

| 优先级 | 项 | 内容 | 依赖 |
|---|---|---|---|
| **P1** | **修 §3.3 / §3.4 口径不一致** | 统一「1 张图 + `video_composite`」的模式口径（`capabilityOf` 与 IR 预检取同一个）；把 1 张的分支补进工具描述；**修掉两个工具对 role 期待相反**的描述矛盾 | 无（明确的 bug，与方向无关） |
| **P1** | **首帧入口收紧 + 明确报错** | `video_generate(filename=…)` 不再让任意图隐式当首帧：仅接受 §8 的三条合法路径；否则报错并提示「这是参考图/用途不明，请先出关键帧（或显式声明 intent='start-frame'）」 | 无 |
| **P1** | **角色驱动判定（原 A 方案，降为辅助）** | `CapabilityInput` 加 `roles`；单图 + role ∈ {character, style} 判参考；`frame` 才当首帧 | P1 上一行 |
| **P2** | **关键帧归一化（主方案）** | 视频生成前插入归一化步：无明确关键帧 → 自动补步（§9 的 copy / generate 由 intent 决定）；补出的节点落盘 + 回显 + 走门禁 | P1 |
| **P2** | **`intent` 参数** | `video_generate` / `video_composite` 增 `intent: 'start-frame' \| 'reference' \| 'auto'`（缺省 `auto`），给后门一个显式入口 | P1 |
| **P3** | **总纲同步** | `SKILL.md` 第 9 步补「归一化」说明；`h3-prompt-writing` 的格式分册补「补步后 IR 该按哪套写」 | P2 |

**推荐顺序**：先做三条 **P1**（都是 bug 修复级别、与方向之争无关、能立刻止血），
再做 **P2** 归一化（主方案），最后 **P3** 文档同步。

---

## 11. 待确认项（实施前需拍板）

1. **`role` 缺省值要不要改？** 当前缺省是 `image`（`host-tools.ts:849`），而「对话贴图」旁路也落 `image`。
   若把 `image` 一并判为「参考」，会影响所有默认路径。倾向：**`image` 保持中性**
   （只有 `character` / `style` 强判参考，判定不出的走归一化补步）。
2. **归一化默认开还是关？** 默认开会多一次出图成本（`promote-generate`）或零成本（`promote-copy`）。
   倾向：**默认开**（对应用户拍板的第 3 条），但 `promote-copy` 要尽量命中（它零成本）。
3. **`promote-generate` 要不要先问用户？** 多花一次出图与等待（出图约 30–60s）。
   倾向：**不问、直接补、结果可见可重做**（与「流程顺畅」的目标一致），并在结果里明确告知。
4. **老项目兼容**：历史项目里 `video_generate(filename=参考图)` 生成的节点已存在 —— 只影响未来生成，
   不回改历史（`generationPrompt` 保留原样供追溯）。

---

## 12. 影响面（实施时需一并覆盖）

- `src/providers/capability.ts` —— 判定核心（加 `roles` / `intent`）
- `src/generate.ts:176/1175/1179` `capabilityOf` 调用点；`:175` `videoRequestOf`（`:184` 把 `filename` 映射成首帧引用）
- `src/host-tools.ts` —— 两个视频工具的描述文案 + IR 预检模式映射（`:925-931`、`:980-986`）+ 新增归一化步
- `src/reference-token.ts` / `@ref` 解析处（`host-tools.ts:273-301`）—— role 需随解析结果带下来
- `src/contracts/canvas.ts:161` —— `referenceRole` 语义落地；可能新增 `promotedFrom`（copy 血缘）
- `skills-local/h3-prompt-writing/references/format-base.md` —— I2VA / FL2VA / Ref2VA 模式说明
- `skills-local/canvas-studio-creation/SKILL.md:82`（第 9 步）与 `references/shot-format.md`
- `tests/h3-ir-precheck.test.mjs` / `tests/video-provider-*.test.mjs` —— 模式断言需同步
