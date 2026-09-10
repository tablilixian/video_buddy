# 视频生成模式选择：从「图片数量」改为「图片语义」驱动（CV-132）

> 日期 2026-09-10 ｜ 状态：**已立项·待讨论**（本文只做现状核实与方案候选，未改任何代码）
> 起因（用户观察）：`只给了一张角色参考图` 时，编排会把它**当成首帧**直接生成视频，
> 于是参考图本身出现在成片里；用户认为正确做法是「**先理解这张图的含义 → 据此生成关键帧 → 再用关键帧生成视频**」。
> 关联：CV-119（H3 IR 预检的模式映射）、CV-105（尾帧链 `referenceRole='frame'`）、
> CV-103/CV-104（一致性资产卡与锚点）、CV-131（统一时间轴）、`skills-local/canvas-studio-creation/SKILL.md` 第 9 步。

---

## 0. 一句话结论

当前**选哪个工具、用哪种模式**，唯一依据是**图片数量**；而图片的**语义角色**
（首帧？角色锚点？场景概念？风格？）在数据模型里**已经存在**（`referenceRole`）却**没有任何一处消费它**。

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

## 3. 三处硬伤

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
- 对模型可见：`list_references` 会把 role 报给模型（`host-tools.ts:849`）
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
4. **单图走 `video_composite` 的分支没写清楚**（§3.3），agent 无从判断该走哪个入口。

**结论：这是「纪律靠文档、无工程兜底」的典型 —— 与 CV-119（IR 预检）之前的状态同类。**

---

## 6. 改造方向（候选，待拍板）

| 方案 | 做法 | 代价 | 评价 |
|---|---|---|---|
| **D. 修 §3.3 的口径不一致** | 统一「1 张图 + `video_composite`」的模式口径（`capabilityOf` 与 IR 预检取同一个），并把 1 张的分支补进工具描述 | 极小 | **必做**，这是明确的 bug，与方向之争无关 |
| **A. 角色驱动（不打断）** | `CapabilityInput` 加 `roles`；单图 + `role ∈ {character,style,image}` 时判为 `multi-reference`；role 是 `frame` 才当首帧。把 role 从 `@ref` 解析处带下来 | 中（要打通 role 传递链） | **推荐作为主方案**，与字段本来的注释一致；用户仍可自由选择 |
| **B. 预检拦截（最硬）** | `video_generate` 若发现 `filename` 对应节点 `referenceRole !== 'frame'` 且不是 `extract_last_frame` 产物 → 直接报错，提示「这是参考图，请先 `image_generate` 出关键帧」 | 小，但可能误拦 | 适合作为**严格模式**开关，不宜默认开启 |
| **C. 流程编排（最贴用户意图）** | 总纲把「参考图 → 关键帧」上升为硬步骤；缺关键帧时**自动补一步** `image_generate`；单图参考入口统一收敛到 `video_composite` | 大（动总纲 + 多一次出图成本） | 与 CV-131 的时间轴改造一起排期 |

**推荐组合：D（立即） + A（主） + B（可选严格模式）；C 并进 CV-131 批次。**

---

## 7. 待讨论问题

1. **「1 张图 + `video_composite`」应该走 I2VA 还是 Ref2VA？**
   官方 r2v 的语义是「参考素材（可含图/音频）驱动生成」，与 I2VA 的「首帧起点」是两件事；
   从用户这次的现象看，**单图期望的一般是「参考」而非「首帧」**，倾向 Ref2VA，但需确认官方对
   「仅 1 张参考图、无首帧」的支持度（是否被当作 r2v 的合法输入）。
2. **要不要留后门？** 用户确实想「拿这张图当首帧」时（例如就是自己画好的构图），
   是否需要显式参数（如 `assumeFirstFrame: true`）来跳过角色判定？
3. **关键帧缺失时是否自动补一步 `image_generate`？** 自动 → 体验顺滑但多一次出图成本与等待；
   手动 → 保持用户对成本的知情权，但 agent 可能继续短路。
4. **role 的默认值问题**：`referenceRole` 缺省是 `image`（`host-tools.ts:849`），
   而「对话直接贴图」旁路落的卡 role 也是 `image`。若 A 方案把 `image` 也判为「参考」，
   会影响所有默认路径 —— 需要确认默认值该不该改（或 `image` 保持中性、只有 `character/style` 强判参考）。

---

## 8. 影响面（改动 A/B 时需一并覆盖）

- `src/providers/capability.ts` —— 判定核心
- `src/generate.ts:175` `videoRequestOf`（`:184` 把 `filename` 映射成首帧引用）
- `src/host-tools.ts` —— 两个视频工具的描述文案 + IR 预检模式映射（`:925-931`、`:980-986`）
- `src/reference-token.ts` / `@ref` 解析处 —— role 需要随解析结果一起带下来
- `skills-local/h3-prompt-writing/references/format-base.md` —— I2VA / FL2VA / Ref2VA 模式说明
- `skills-local/canvas-studio-creation/SKILL.md:82`（第 9 步）与 `references/shot-format.md`
- `tests/h3-ir-precheck.test.mjs` / `tests/video-provider-*.test.mjs` —— 模式断言需同步
