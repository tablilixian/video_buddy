# Canvas Studio 视觉升维 · 改造执行计划（DD 落地清单）

> **定位**：本文是 [visual-direction-plan.md](./visual-direction-plan.md) 的**工程配套**。
> 那边回答「为什么不够高级、往哪走、分几批」；本文只回答**「怎么改、改哪些文件哪几行、怎么验、怎么退」**。
>
> DD 方案 §7.2 自己写明：「出 step plan 给用户审批（**本方案不含具体代码改动清单**）」——
> 本文就是那份缺失的清单，逐批可直接开工。
>
> **基线**：2026-09-12 实测。测试 **462/462 · fail 0**（绿）。所有数字可复跑，命令见 §9。
> **状态**：**DD-00 ~ DD-06 全部落地**（CV-161 前两批 + CV-162 第三批 + CV-163 第四批=DD-04a/05/06 合并立项）；
> 仅 DD-04b（真波形，Host 侧 ffmpeg 抽包络）按计划延后 —— 04a 骨架可独立上线（原方案 §DD-04 预留的降级路径）。
> **编号**：DD-00 起（`DD` 独立序列，不占 `CV-xxx`）。CV 条目已立：**CV-161**（DD-01 + DD-02）、
> **CV-162**（DD-03）、**CV-163**（DD-04a + DD-05 + DD-06）；下一批立案从 `CV-164` 起。
>
> **落地记录（2026-09-12）**：
>
> | 批次 | 状态 | 落地内容 | 验证 |
> | --- | --- | --- | --- |
> | DD-00 | ✅ 已落地 | STATUS.md 立项登记 CV-161（§0 编号规则 / §1 速览 64→65 / §4 主表插行 / §8 变更记录 / 页首「最近更新」） | 文档 |
> | DD-01 | ✅ 已落地 | `brand.ts` 新增 `SURFACE_LIGHT` + `SURFACE_DARK` 双轨常量（`--cs-shell/-2/-3`、`--cs-node/-hi`、`--cs-float`、`--cs-line/-hi`，与预设解耦以守住「切换只动 accent 族」）+ `--cs-dim` + `--cs-fs-xs~2xl`；**清掉 4 个幽灵令牌**（`--cs-text` / `--cs-text-muted` / `--cs-border` / `--cs-surface-raised`，7 处引用）；`styles.ts` 接上 `--cs-duration-slow` / `--cs-ease` / `--cs-line`。新增守卫 `tests/visual-tokens.test.mjs` 4 用例（反引号 / 幽灵令牌 / 空转棘轮 / 基线一致性） | `466/466` · fail 0 |
> | DD-02 | ✅ 已落地 | 四层同色拆成**空间三档**（壳 `/ .csWorkflowBar` 二档 / 画布最暗 / 节点最亮 / 浮层压节点）+ 全部切分线统一 `--cs-line`（浮层 `--cs-line-hi`）；网格由两条直角线改**点阵双层**（24px 细格 + 120px 主格，值对齐设计稿 0.06 / 0.11）；浅色画布 `#F7F7FA` → `#EFEFF4`（与节点落差 8 级 → 16 级） | 真实产物渲染台 computed style：暗色 **画布 17 ＜ 壳 23 ＜ 节点 34 ＜ 浮层 39**；浅色 **画布 239 ＜ 壳/节点 255** |
> | DD-03 | ✅ 已落地 | ① 节点卡：悬停抬高档（`--cs-node-hi`）、状态过渡接 `--cs-duration-base/-fast` + `--cs-ease`；② **媒体区片门**（`.csNodeMediaBox` 上下 2px `--cs-gate`，媒体窗底改 `--cs-canvas-bg`）；③ 选中光晕收敛到 `--cs-glow-accent`（**并补上浅色轨缺失的那条**）；④ **血缘聚光**（新建纯函数 `src/canvas-lineage.ts` + `CanvasSurface` 传 `dimmed` + `--cs-dim`）；⑤ 生成中改**显影扫描光带**（`csProgressSlide` → `csDevelop`，DOM 不变）；⑥ 成片节点 `--cs-teal` 描边；⑦ 字阶/间距/圆角共 14 个令牌接上；⑧ **修两处真 bug**（见下） | `478/478` · fail 0；渲染台双主题 22 项断言全绿 |
> | DD-04a | ✅ 已落地 | 时间轴从等宽 chip 升维为**真时间轴**：自适应秒刻度标尺 + **三轨**（视频 / BGM / 参考·产物）+ **可拖播放头**（擦洗松手联动画布选中，压中片段 teal 高亮）；片段宽度 = 真实 duration 比例（新纯函数 `src/timeline-layout.ts` 唯一权威）；成片产物 / 失效版本移出比例布局（守 CV-160 口径，归「参考·产物」轨）；勾选排除 / 拖拽重排 / BGM 下拉 / 显示全部全保留；守卫 `tests/timeline.test.mjs` +5 条（比例宽度 / 首尾相接 / 播放头 = 进度×宽度 / 刻度 / 左闭右开命中） | `484/484` · fail 0；渲染台双主题 18 项断言全绿（含抓出播放头 8px 参考系偏移真 bug） |
> | DD-04b | ⏸ 按计划延后 | 真波形（Host ffmpeg 抽包络 + 抽根级纯函数）—— 唯一带 Host 新能力的批次；观感差异主要来自骨架（04a），按原方案「04a 先上、04b 延后」 | — |
> | DD-05 | ✅ 已落地 | ① 审批条**场记板形态**：gold 拍板条压左缘 + 顶缘打板斜纹（::before repeating-gradient）+ gold 体块底 + 批准按钮 gold 实底深色字；② 工作流条**五阶段行进指示**（需求 → 剧本 → 分镜 → 关键帧 → 制作；只有行进语义不可点击 —— 六阶段可跳转仍缺阶段模型，见还原度判定）；③ Toast 入场接 `--cs-duration-fast`/`--cs-ease`；动效三语义白名单无新增（3 个既有动画已归位） | 渲染台双主题 18 项断言全绿（斜纹 / gold 底 / 阶段节点 / 动效令牌） |
> | DD-06 | ✅ 已落地 | 首屏 `csWelcome*`/`csLobby*`/`csLobbyGreet`/`csLobbyTail*` 全量令牌化（38 处替换，脚本逐块定位零误伤）：欢迎卡 `--cs-float` + `--cs-shadow-3`、字阶六阶全接线、accent-deep 底部余晖、空间令牌 space-4..7 全消费。**空转棘轮 25 → 1**（仅剩 `--cs-canvas-bg-l1`，暂无自然消费点） | `484/484` · fail 0；渲染台双主题断言通过（字阶 / 浮层 / 阴影 / 三层背景） |
>
> **落地时才拿到的实测发现（回填 §0）**：
> 1. 4 个幽灵令牌不仅「从未定义」，**连兜底色都在漂移** —— `--cs-border` 两处 fallback 各不相同
>    （`rgba(128,128,128,.35)` vs `rgba(255,255,255,.14)`），`--cs-text` 也是两个不同值
>    （`#e8eaed` vs `#e6e8eb`）。这才是真正的病根：同一语义的东西在不同地方长得不一样。
> 2. 判定「**不能还原**」的只有一项 —— 设计稿的**六阶段制作轨道可跳转**在工程里没有状态源
>    （`workflow.state` 只有 5 个值，无阶段模型）。详见 DD 方案页首的「还原度判定」表。
> 3. **（DD-03）节点不透明度有一条被 inline 压死的死代码链。** `CanvasNode` 把 `node.opacity`
>    直接写成 inline `opacity`，而 inline 永远赢 —— `.csNodeLocked{opacity:.75}` 与
>    `.csNodeRetired{opacity:.45}` **从未生效**（CV-108 号称「失效版本灰显」，实际只有
>    `grayscale(1)` 在起作用）。修法：三层各写一个乘数（`--cs-node-opacity` /
>    `--cs-node-state` / `--cs-node-dim`），由 `.csNode` 一条 `calc()` 统一算。
> 4. **（DD-03）`--cs-glow-accent` 只在暗色块里定义过。** 浅色轨整条令牌缺失 → `var()` 退到
>    空值 → 浅色主题下选中态只剩一根 1px 描边；而 DD-02 刚把「处处描边」拆掉，于是浅色下
>    「选中」几乎读不出来。已补进浅色轨，并加守卫：**主题敏感令牌必须明暗两轨都在**。
> 5. **（DD-03）`.csNodeLinkHandle` 有两条完全重复的规则**（1193 与 2007），其中一条还带
>    `transition`、另一条不带 —— 删除重复块，只留一条。
>
> **与本文原计划的偏差（DD-03 回填）**：
>
> | 项 | 原计划 | 实际 | 理由 |
> | --- | --- | --- | --- |
> | 守卫文件名 | `tests/design-tokens.test.mjs` | **`tests/visual-tokens.test.mjs`**（DD-01 起） | 与既有 `style-tokens.test.mjs` 区分：那个管风格预设，这个管视觉升维 |
> | 浮层底令牌 | `--cs-glass` | **`--cs-float`**（DD-01 定） | `glass` 暗示 `backdrop-filter`，但浮层只有部分用毛玻璃；`float` 描述的是**空间位置**，语义更准 |
> | 头部 | `.csNodeKind` / `.csNodeBadgeVersion` 改「镜号 + 标题 + 版本 chip」 | **不加头部条**，改为把既有角标做成「镜头条」语言 | 媒体节点只有 260×180，加一条 24px 头带要吃掉 13% 高度，而 `.csNodeMedia` 是 `object-fit:cover` —— 画面会被重新裁切，属**功能性回归**（构图工具里裁切变化不能算纯视觉） |
> | 景深幅度 | §10-3 建议 0.7 + 设置可关 | **0.42，无开关**，但加了「**无血缘不压暗**」前提 | 设计稿（观感基准）就是 0.42 且用户已确认；开关需动 `host-config.ts` + `SettingsModal.tsx`，属待拍板项。安全阀见 §DD-03 改动点 ④ |
> | 阶段轨道 | DD-03 立「动效三语义」白名单守卫 | 已建（`csDevelop` / `csToastIn` / `csLogoPulse`），DD-05 只扩语义不改机制 | 提前建守卫成本极低，且能拦住后来人随手加的第四个动画名 |

---

## 0. 先说结论：三条会改变排期的实测发现

| # | 发现 | 对计划的影响 |
| --- | --- | --- |
| **A** | 宿主**已经提供** `--dsw-alias-bg-layer-1/2/3` 三档层级令牌（合计被插件引用 44 次），插件只是**画布区没用** | DD-02 的"三档明度"**不需要自造整套令牌**，成本比原方案设想低一个量级 |
| **B** | `.csChat`（右侧对话区）在插件样式表里**只有 1 条规则 / 8 行** | 硬约束 3「不动右侧对话区」**天然已满足**，不是风险项 |
| **C** | `!important` 全表 **0 处** | 无需对抗优先级，DD-02 可干净地改选择器；这是能省大量返工的好消息 |

反过来说，真正吃成本的是另外两件事，都在 §2：

- `--dsw-alias-bg-base` **50 次** + `--dsw-alias-border-l2` **107 次** —— 改层级就是动这 157 个引用点，必须外科手术式局部 repoint。
- 桌面验收队列**已积压约 65 条**（STATUS 速览：`已修复·待验收` 64 + `已完成·待验收` 1）—— 每加一批 DD 就再加一条，排期必须与 CV 验收**交替**，不能连推。

---

## 1. 基线数字（今天实测，可复跑）

### 1.1 样式表规模与结构

| 指标 | 实测 | 备注 |
| --- | --- | --- |
| `src/client/styles.ts` | **4617 行** | 单文件样式表 |
| 顶级类选择器 | **449 个** | 全部 `cs` 前缀 |
| `var(--dsw-alias-*)` 引用 | **512 次 / 25 个不同令牌** | 宿主语义令牌是主力 |
| `var(--cs-*)` 引用 | **79 次** | accent 族 49（其中裸 `--cs-accent` 36）/ radius 16 / shadow 5 / canvas-bg 2 / 其余 7 |
| 裸 hex 色值 | **18 个唯一值** | |
| `rgba()/rgb()` | **26 处** | |
| 裸 px 值 | **1102 处** | 间距未走令牌 |
| `font-size` 唯一值 | **11 种** | 10/11/12/13/14/15/16/18/20/22/56px |
| `transition` 声明 | 14 处 | |
| `@keyframes` | **3 个** | `csProgressSlide`(2034) / `csToastIn`(2664) / `csLogoPulse`(3873) |
| `@media` | 3 处 | **全部是** `prefers-reduced-motion`(25 / 4077 / 4319)，无响应式断点 |
| `backdrop-filter` | 1 处 | 2858，用宿主 `--dsw-mask-blur` |
| `!important` | **0 处** | ✅ 无 hack 堆积 |
| `z-index` 唯一值 | 12 个 | |

### 1.2 令牌空转（定义在 `src/brand.ts`，`styles.ts` 零消费）

| 令牌 | 定义处 | styles.ts 引用 | 判定 |
| --- | --- | --- | --- |
| `--cs-space-1..7` | brand.ts:121-127 | **0** | ❌ 空转（裸 px 1102 处在裸奔） |
| `--cs-duration-fast/base/slow` | brand.ts:138-140 | **0** | ❌ 空转 |
| `--cs-ease` | brand.ts:141 | **0** | ❌ 空转 |
| `--cs-gold` / `--cs-teal` | brand.ts:181-182 | **0** | ❌ 空转（HITL 金 / 播放青没有落到令牌） |
| `--cs-glow-accent` | brand.ts:178 | **0** | ❌ 空转 |
| `--cs-canvas-grid` | brand.ts:166,176 | **0** | ❌ 空转（网格没用品牌色） |
| `--cs-canvas-grid-major` | brand.ts:167,177 | **0** | ❌ 空转 |
| `--cs-canvas-bg` / `-l1` | brand.ts:164-165,174-175 | **2**（仅 `.csWelcome` / `.csLobbyHero` 的径向渐变背景） | ⚠️ 名存实亡：**画布本体没用它** |

> **结论**：§1.2 原诊断（"设计系统只落地了四分之一"）成立，实测空转的令牌族比原文档列举的**更多**
> （gold / teal / canvas-grid / canvas-grid-major 也是 0）。

### 1.3 同色面板：四层嵌套同一个色值

| 层 | 选择器 | 行号 | background |
| --- | --- | --- | --- |
| 壳 | `.csFrame` | 13 | `var(--dsw-alias-bg-base)` |
| 画布容器 | `.csCanvas` | 1053 | `var(--dsw-alias-bg-base)` |
| 画布面 | `.csCanvasSurface` | 1073 | `background-color: var(--dsw-alias-bg-base)` |
| 节点卡 | `.csNode` | 1127 | `var(--dsw-alias-bg-base)` |

**四层同一个令牌** → 层级只能靠 1px 描边（`--dsw-alias-border-l2`，107 次）切分。这是 DD-02 要解决的核心事实。

### 1.4 网格：与节点描边同源，靠透明度打补丁

`styles.ts:1080-1087`：

```css
background-color: var(--dsw-alias-bg-base);
/* CV-035：网格线降到 45% 不透明度。原样用 border-l2 时网格与节点描边同色， */
background-image:
  linear-gradient(to right,  color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent) 1px, transparent 1px),
  linear-gradient(to bottom, color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent) 1px, transparent 1px);
```

- 网格 = 两条交叉 `linear-gradient` = **1px 直角线**，单层，无主次，格距 **40px**（CV-035 注释里写死）
- 色值取自 `--dsw-alias-border-l2` —— **和节点描边同一个令牌**；CV-035 的注释自己承认了这点，用"降透明度"绕过
- `--cs-canvas-grid` / `--cs-canvas-grid-major` 定义了却没人用

> **DD-02 顺带退休 CV-035 的 workaround**：网格改用 `--cs-canvas-grid(-major)` 双层，
> 节点描边改走 `--cs-line`。否则新旧两套逻辑并存，改完更难维护。

### 1.5 假波形：两套公式，同一首曲子长得不一样

| 位置 | 行号 | 条数 | 高度公式 |
| --- | --- | --- | --- |
| 画布音频节点 | `CanvasNode.tsx:37-38, 146-150` | `AUDIO_WAVE_BARS = 28` | `24 + ((seed * (index + 5)) % 61)` |
| 音频播放大窗 | `AudioPlayerModal.tsx:37-38, 71-75` | `WAVE_BARS = 48` | `18 + ((seed * (index + 7)) % 83)` |

两条都是"按 id/url 派生的确定性伪随机"，**公式与条数都不同**。
`CanvasTimeline.tsx`（243 行）里**没有任何波形代码** —— 时间轴侧连假波形都没有。

### 1.6 改动面尺寸（用于估工，非行数指标）

| 前缀 | 规则数 | 占用行数 | 归属批次 |
| --- | --- | --- | --- |
| `.csNode*` | 72 | 508 | **DD-03**（只碰视觉框，见 §3.4） |
| `.csCanvas*` | 12 | 93 | **DD-02** |
| `.csToolbar*` | 13 | 77 | DD-02 |
| `.csDetailPanel*` | 5 | 53 | DD-02 |
| `.csTimeline*` | 27 | 170 | **DD-04** |
| `.csWorkflow*` | 14 | 73 | **DD-05** |
| `.csLayer*` | 18 | 113 | DD-02 |
| `.csMinimap*` | 3 | 17 | DD-02 |
| `.csLobby*` | 21 | 114 | **DD-06** |
| `.csWelcome*` | 14 | 82 | **DD-06** |
| `.csChat*` | **1** | **8** | 宿主区，不碰 ✅ |
| `.csProjects*` | 8 | 64 | DD-02 |
| `.csModal*` | 16 | 101 | 不碰（不在此次范围） |
| `.csSkill*` | 75 | 523 | 不碰（不在此次范围） |

### 1.7 关键行号锚点（开工时直接跳）

```
.csFrame            13      .csWorkflowBar       76      .csWorkflowApproval 124
.csProjects        379      .csCanvas          1053      .csCanvasSurface   1073  (网格 1084-1086)
.csCanvasLayer    1103      .csEdge            1120      .csNode            1127
.csNodeSelected   1181      .csNodeMedia       1203      .csTimeline        1408
.csTimelineItem   1448      .csToolbar         1759      .csMinimap         2186
.csDetailPanel    2367      .csToast           2648      .csWelcome         3653
.csLobbyHero      3738      .csMarquee         4548
```

### 1.8 宿主令牌依赖面（25 个，这才是真正的风险阈值）

| 宿主令牌 | 引用 | DD 处置 |
| --- | --- | --- |
| `--dsw-alias-border-l2` | **107** | 收口为 `--cs-line`；**降权**（层级改由明度表达，而非处处描边） |
| `--dsw-alias-label-primary` | 103 | 收口为 `--cs-t1` |
| `--dsw-alias-bg-base` | **50** | **分档**为 `--cs-shell` / `--cs-canvas-bg` / `--cs-node`（只改画布区那几处） |
| `--dsw-alias-label-secondary` | 50 | 收口为 `--cs-t2` |
| `--dsw-alias-label-tertiary` | 49 | 收口为 `--cs-t3` |
| `--dsw-alias-interactive-bg-hover` | 37 | **保留**（宿主交互态语义，别抢） |
| `--dsw-alias-interactive-bg-active` | 29 | **保留** |
| `--dsw-alias-bg-layer-1 / -2 / -3` | 17 / 11 / 16 | **保留并优先复用**（宿主已给层级，见 §0-A） |
| 其余 17 个 | 各 1-5 | 保留 |

---

## 2. 决定改造路径的工程事实（含反直觉项）

1. **令牌注入链路已就绪，加令牌≈零成本。**
   `src/brand.ts` → `brandCssText()` 生成 CSS 文本 → `src/client/brand-inject.ts` 写入 `<style>` + `body[data-cs-brand]`。
   新增令牌**只需在 `brandCssText()` 的 light / dark / fixed / nonColor 四个数组里各加一行**，注入逻辑一行不用改。
   → 原方案把 DD-01 描述成"地基、最大工作量"，实测**工作量被高估**；真正贵的是 repoint 调用点（见 §2.2）。

2. **`--dsw-alias-bg-base` 的 51 次引用是最大风险面。**
   DD-02 **绝不能做全局替换**。正确做法是只 repoint 画布区那 4 个容器（§1.3 表）+ 浮层，其余 40+ 处保持。
   → 这条必须在 step plan 里写成硬纪律，否则一次 sed 就能把整个插件改花。

3. **宿主已有层级令牌，DD-02 不必自造整套三档。**
   `bg-layer-1/2/3` 已被引用 44 次，方向是"越上层越亮"。**壳与节点直接用它们**；
   只有"画布要比壳更深"这一档宿主没有（layer 都是往上亮），用**已存在的** `--cs-canvas-bg` 补上。
   → DD-02 净新增令牌压到 `--cs-line` / `--cs-dim` / `--cs-glass` 三个 + 把已有的接上去。

4. **`color-mix` 是本项目已批准的技法。**
   `styles.ts:1085` 已在用，注释明确"Chromium 111+，桌面 Electron 43 满足"。
   → 三档明度可以写成**相对宿主基底的 `color-mix`**（见 §3.3），这样：
   (a) 自动跟随宿主明暗主题，满足硬约束 7「明色主题同样成立」；
   (b) 四个品牌预设不必各自定义三档（预设只换 accent 的既有约定不被破坏，brand.ts 注释 §"切换只动 accent 族"）。

5. **测试前必须 build emit，`--noEmit` 会让测试 ERR_MODULE_NOT_FOUND。**
   `tests/*.mjs` 直连 `lib/*.js`。DEV-WORKFLOW §三的顺序是 typecheck → build → smoke → loader，**顺序不能变**。
   今天实测 `lib/` 已构建（181 文件），462 用例全过。

6. **桌面验收队列已积压 ~65 条，这是排期的真实约束。**
   每批 DD 都要桌面人工验收，等于往队列再加一条。
   → 建议：DD 批次与 CV 验收**交替**推进；DD-01 这类"无视觉变化"的批次**与 DD-02 合并验收**，不单独占一次桌面回归。

7. **`!important` = 0，且 `@media` 只有 3 条（全是 reduced-motion）。**
   → 改选择器不会被优先级反噬；但**新增动效必须照 `styles.ts:25 / 4077 / 4319` 的既有模式加 reduced-motion 降级**，
   硬约束 7 不是新要求，是既有纪律的延续。

---

## 3. 批次改造清单

> 每批格式统一：**目标 · 改动点 · 新增令牌 · 守卫断言 · 验收方法 · 回滚点**。
> 估工用「改动面」而非"人天"，因为本项目节奏由批次计数驱动。

### DD-00 · 立项登记（先做，半天内）

| 项 | 内容 |
| --- | --- |
| 目标 | 让 DD 方案在 `STATUS.md` 里**有名有号**，避免"改了代码但表里查无此项" |
| 改动点 | ① `STATUS.md` §5「已设计但零落地的模块」新增一行：DD 视觉升维方案（来源 `visual-direction-plan.md`，状态`仅设计`，附本文链接）<br>② `STATUS.md` §0 编号规则确认 `CV-161` 起可用<br>③ 若拍板立项：在 §2/§3 主表按批建 `CV-161…` 条目 |
| 守卫 | 无代码改动，无断言 |
| 验收 | 文档 diff 人工过目 |
| 回滚点 | 纯文档，无 |

> **为什么要先做**：`STATUS.md` 是唯一事实来源（§0 明文）。DD 批次跨多周，不登记就一定会出现文档漂移。

### DD-01 · 设计系统收口

| 项 | 内容 |
| --- | --- |
| 目标 | 把"定义了没人用"的令牌变成唯一来源；建立**只减不增**的棘轮 |
| 改动点 | ① `src/brand.ts`：`NON_COLOR_TOKENS` 增加字号阶 `--cs-fs-xs…2xl`（6 级）；新增 `--cs-line` / `--cs-line-hi` / `--cs-dim` / `--cs-glass` 到 `fixed` 数组（不随预设变）<br>② `src/client/styles.ts`：把**触碰到的**裸值迁移为令牌 —— 优先级：`transition` 14 处 → `--cs-duration-*` + `--cs-ease`；间距裸 px 按批迁移；`font-size` 11 种 → 6 级<br>③ 全表 `border` 色统一走 `--cs-line`（107 处 `border-l2` 分步，本批只做画布区） |
| 新增令牌 | `--cs-fs-xs/sm/base/md/lg/2xl`、`--cs-line`、`--cs-line-hi`、`--cs-dim`、`--cs-glass` |
| 守卫 | **新增 `tests/design-tokens.test.mjs`**，用例：<br>· `brandCssText：每个定义的令牌都在 CSS 文本里出现一次`（防"定义了没注入"）<br>· `styles.ts 引用的每个 --cs-* 都在 brand.ts 有定义`（防拼错/签名漂移）<br>· `禁裸值棘轮：画布区（.csCanvas/.csNode 段）hex 与裸 px 数量不超过基线快照`（**只减不增**）<br>· `font-size 只允许取 --cs-fs-* 六阶`（白名单） |
| 验收 | 桌面打开：**视觉应与改前一致**（DD-01 是重构，不该有观感变化）。截图前后对比留档 |
| 回滚点 | 单批纯令牌替换，`git revert` 一个 commit 即回 |

> ⚠️ **棘轮而非硬闸**：全表有 1102 处裸 px、18 个 hex。写成"零裸值"的硬闸会**当场挂**。
> 正确做法是：建立基线快照 + 断言"不超过"，新代码禁裸值。这是本项目已有的护栏文化（对照 `tests/skill-catalog.test.mjs` 的硬闸用法）。

### DD-02 · 空间层级重做（感知提升最大）

| 项 | 内容 |
| --- | --- |
| 目标 | 层级从"1px 描边"改为"**明度差**"；画布成为下沉的"工作面"，节点浮起来 |
| 改动点（**只碰这几处，别扩面**） | ① `.csFrame`(13) → `--cs-shell`<br>② `.csCanvas`(1053) → `--cs-canvas-bg`<br>③ `.csCanvasSurface`(1073) → `--cs-canvas-bg` + **网格换令牌**（见下）<br>④ `.csNode`(1127) → `--cs-node`，`border` 改 `--cs-line`<br>⑤ 浮层：`.csCanvasLayers`(2217) / `.csDetailPanel`(2367) / `.csMinimap`(2186) → `--cs-glass` + `backdrop-filter`<br>⑥ 选中态 `.csNodeSelected`(1181) → `--cs-glow-accent`（把空转的令牌接上） |
| 网格改造（退休 CV-035） | `styles.ts:1084-1086` 由「2× linear-gradient + border-l2 45%」改为「**主次双层** `--cs-canvas-grid` / `--cs-canvas-grid-major`」，或点阵（`radial-gradient`）。**两层都要**，每层可读。格距维持 **40px**（CV-035 注释里写死的尺寸，本批不动） |
| 新增令牌 | `--cs-shell`、`--cs-canvas-bg`（已存在，接上）、`--cs-node`（内部用 `bg-layer-1`）、`--cs-dim` |
| 景深幅度 | 建议**明度差 4~6%**（原方案 §8-2 待拍板）；先截图对比再定值 |
| 守卫 | `tests/design-tokens.test.mjs` 追加：<br>· `三档明度单调性：壳/画布/节点 的明度关系符合设计意图`（解析 `color-mix` 结果或直接断言令牌存在 + 顺序）<br>· `--cs-canvas-bg 在 .csCanvas 与 .csCanvasSurface 上均被引用`（防再次名存实亡）<br>· `--cs-canvas-grid 与 -major 均被引用`（把 §1.4 的 0 引用钉死）<br>· `网格与节点描边不同源`（防回归到 CV-035 的老毛病） |
| 验收 | 桌面：① 四层面板底色**肉眼可辨差异**；② 网格不再与节点描边同色；③ **暗部素材截图**（原方案 §6 风险：画布再暗可能糊）。**DD-01 + DD-02 合并一次桌面验收** |
| 回滚点 | CSS 单批，一个 commit |

> **必须同批退休 CV-035 的 workaround**，否则"两个网格方案并存"，后续没人敢动。

### DD-03 · 节点卡片重做

| 项 | 内容 |
| --- | --- |
| 目标 | 单张卡片就有"作品感"：**媒体区 + 片门**，而不是通用卡片 |
| 改动点（**72 条规则里只碰视觉框的那十几条**） | ① `.csNode`：悬停抬高档（`--cs-node-hi`）+ 状态过渡接 `--cs-duration-base` / `--cs-ease`；拖动态 `--cs-shadow-2`<br>② `.csNodeMediaBox`：上下 **2px 片门暗带**（`--cs-gate`，明暗两轨各一值）+ `box-sizing:border-box`；`.csNodeMedia` 底色改 `--cs-canvas-bg`<br>③ 角标（`.csNodeBadge` / `.csNodeRefBadge` / 版本 chip）：底色改跟节点面同源，走 `--cs-radius-*` / `--cs-fs-xs`；版本 chip 用药丸形 + accent 底<br>④ 数字统一 `font-variant-numeric: tabular-nums`（时长 / 分辨率 / 计时 / 角标）<br>⑤ 生成中：进度条 → **显影扫描光带**（`csDevelop`），遮罩改主题感知的 `--cs-scrim`<br>⑥ 血缘聚光（`--cs-dim`）+ 成片节点青边（`--cs-teal`） |
| 血缘聚光口径（**本批新增纯函数**） | `src/canvas-lineage.ts`：`lit` = 选中项 + **一跳**上下游；`active` 需**选中项确有血缘**才为真 —— 压暗是揭示关系的手段，孤立节点没有关系可揭示，压暗只会把整屏压灰。`CanvasSurface` 只喂 `visibleNodes`（隐藏节点不算血缘） |
| **明确不碰** | `.csNodeResize*`（8 个方向手柄）/ `.csNodeLinkHandle` / `.csNodeOverlay*` 的 DOM 结构 / `.csNodeRef*` 的色点 / `.csNodeAudio*` 的播放逻辑 —— 这些是**功能承重结构**，改视觉框时不顺手动。**也不给媒体节点加头部条**：260×180 的卡加一条 24px 头带要吃掉 13% 高度，而 `.csNodeMedia` 是 `object-fit:cover`，画面会被重新裁切 |
| 新增令牌 | `--cs-gate`、`--cs-scrim`（明暗双轨）；`--cs-node-opacity` / `-state` / `-dim` 三个**乘数**（默认值 1，属节点视觉契约） |
| 守卫 | `tests/visual-tokens.test.mjs` 追加 3 条：`@keyframes 三语义白名单` / `节点不透明度只走乘法链` / `血缘聚光与成片判定不得内联第二份`（比对前**剥注释**，否则守卫会被一句正确的注释误杀）。`tests/canvas-lineage.test.mjs` 新建 8 例。`tests/brand.test.mjs` 追加 1 条：**主题敏感令牌必须明暗两轨都定义** |
| 验收 | 桌面：① 单看一张卡片像"镜头条"（片门可辨）；② 拖拽/缩放/连线功能**零回归**（本批最大回归风险：`--cs-node-opacity` 由 inline `opacity` 改为 CSS 变量）；③ 生成中动效观感；④ **明暗主题各看一遍** —— 片门 / 遮罩 / 光晕三处是本批的主题敏感项 |
| 回滚点 | 单独 commit + 单独截图留档（改动面最宽，回滚粒度要细） |

> **两条必须写进验收单的观感变化**（都是修 bug 带来的，不是新设计）：
> 1. **失效版本节点会真的灰下去（0.45）** —— 此前那条规则被 inline `opacity` 压死，只有
>    `grayscale(1)` 生效。老项目里"已作废 / 被取代"的节点现在明显更沉。
> 2. **点选节点时，非血缘节点会压暗到 0.42** —— 这是设计稿的行为（用户在交互稿上确认过），
>    但**只在选中项确有血缘时触发**；选中孤立节点不压暗（比设计稿更保守）。
>
> 幅度若在桌面验收时仍觉偏重，改 `brand.ts` 一处 `--cs-dim` 即可（§10-3 的建议值是 0.7）。

### DD-04a / DD-04b · 时间轴升维（体量最大，拆两批）

| 批次 | 目标 | 改动点 |
| --- | --- | --- |
| **DD-04a** 骨架 | 从"等宽 chip 列表"变成"**真时间轴**" | `.csTimeline*`(1408/1448，27 规则/170 行)：加**时间标尺**（秒刻度）、**可拖播放头**、片段宽度 = **真实 duration 比例**、多轨（视频 / BGM / 参考） |
| **DD-04b** 真波形 | 把假波形换成**真包络** | ① Host 侧新增 ffmpeg 抽包络能力（走既有 ffmpeg 调用链）<br>② 抽根级纯函数 `src/waveform.ts`，`CanvasNode.tsx` 与 `AudioPlayerModal.tsx` **共用同一份**（消灭 §1.5 的两套公式） |

**DD-04a 可提前插入**（原方案 §4：与 DD-02 无强耦合）。

| 项 | 内容 |
| --- | --- |
| 守卫 | `tests/timeline.test.mjs`（已存在）追加：<br>· `片段宽度比例 = duration / 总时长`（纯函数，不依赖 DOM）<br>· `播放头位置 = 进度 × 可用宽度`（把上一轮设计稿里踩过的"数学期望"直接固化为断言） |
| 新增守卫 | `tests/waveform.test.mjs`：· 同一 url/id 每次产出一致 · 条数上限 · **两处消费方调用同一函数**（防再次分叉） |
| 验收 | 桌面：① 拖播放头，画布与时间轴联动高亮；② 片段宽度对得上真实时长（对照 `ffprobe` 真值）；③ 波形与音频实际起伏相符（不再是伪随机） |
| 回滚点 | 04a / 04b 各自 commit；04b 若 ffmpeg 侧卡住，04a 可独立上线 |

> ⚠️ **04b 是唯一带 Host 侧新能力的批次**，成本远高于纯前端批次。若排期紧，**04a 先上、04b 延后**是安全的（观感差异主要来自骨架）。

### DD-05 · 生成过程叙事化

| 项 | 内容 |
| --- | --- |
| 目标 | 把"等待"变成"看得见的制作"：阶段轨道 + 场记板审批 + 动效三语义 |
| 改动点 | ① `.csWorkflowBar`(76) / `.csWorkflowApproval`(124) / `.csWorkflowMode` / `.csWorkflowState`（本组 14 规则/73 行）：审批条改为**场记板形态**，金色走 **`--cs-gold`**（把 §1.2 里空转的 gold 接上）<br>② **六阶段制作轨道**：当前阶段行进指示（依赖 `.csWorkflowState` 语义扩展）<br>③ `.csToast`(2648)：接 `--cs-duration-*` + `--cs-ease` |
| 动效三语义（**契约，不是建议**） | 只允许三种：**显影**（新内容出现）/ **行进**（阶段推进）/ **让位**（旧内容退出）。新增 `@keyframes` 必须归入其一，否则守卫拦下 |
| 新增令牌 | 无（`--cs-gold` 已存在，接上即可） |
| 守卫 | 上面的 `@keyframes` 白名单断言（DD-03 已建，本批扩充到 3 个语义 + `csProgressSlide/csToastIn/csLogoPulse` 三个既有动画归位） |
| 验收 | 桌面：① 六阶段轨道能指出"现在在第几步"；② 审批条金色与品牌一致（四套预设下都不串色）；③ 切到 `全自动` 模式观感正确 |
| 回滚点 | CSS + 少量组件，一个 commit |

### DD-06 · 首屏与三态

| 项 | 内容 |
| --- | --- |
| 目标 | 第一印象：打开就"像在制作一部片子" |
| 改动点 | `.csLobby*`(21 规则/114 行，含 `.csLobbyHero` 3738) + `.csWelcome*`(14 规则/82 行，3653)：套用 DD-01/02 定稿的空间语言与字阶；三态（空 / 加载 / 就绪）观感统一 |
| 新增令牌 | 无 |
| 守卫 | 复用 DD-01 棘轮（首屏区也在"禁裸值"范围内） |
| 验收 | 桌面：① 无项目（lobby 态）② 首启欢迎屏 ③ 有项目 work 态 —— 三态截图留档 |
| 回滚点 | 一个 commit |

---

### DD-08 · 左侧栏（2026-09-14 立项，**DD 系列此前的盲区**）

| 项 | 内容 |
| --- | --- |
| 目标 | 左栏是「项目目录」，也是打开产品后**第一秒就在看**的一块。它不在任何已有验收分区里 —— 收口清单划的 A 空间 / B 节点 / C 时间轴 / D 工作流 / E 首屏**一个都没覆盖它**。所以它现在的问题不是「没做好」，而是「从来没被这批改过」 |
| 诊断（可复跑） | 左栏区段 `styles.ts:576-1240`：`--cs-*` 只有 **4 个**、`--dsw-alias-*` **72 处**、`--cs-space-*`/`--cs-radius-*` **0 次**（brand.ts 里明明有 7 档间距 + 4 档圆角）、裸 `font-size` **7 档**（10/11/12/13/14/15/16 vs DD-01 收口的 6 档）。**画布/节点/时间轴都换成自有令牌了，左栏整块还停在宿主令牌 + 裸值阶段** |
| 三处结构性问题 | ① **层级倒挂** —— 分组名 13px/600 比项目名 13px/500 更响，截图里「未分组」比下面的项目名抢眼；② **行内原生 `<select>`**（`.csProjectMove`）在暗色壳上渲染成亮底浮块且常驻可见 —— **截图里那个灰盒子就是它**，整栏最丑的一处；③ **三枚全宽虚线按钮**同样响，栏内最响的元素承载最次要动作，还混了一个 dev 自测入口 |
| 改动点 | `src/client/styles.ts`（左栏区段）、`src/client/ProjectList.tsx`、`src/client/StudioFrame.tsx`、`src/client/UserCard.tsx`、`src/brand.ts`（新增令牌）；新增 `src/client/ProjectRowMenu.tsx`、`src/client/RailStrip.tsx`、纯函数 `src/relative-time.ts` / `src/project-cover.ts` / `src/project-row.ts` |
| 新增令牌 | `--cs-float`（浮层档，明暗两轨）、`--cs-shell-2`（行悬停档）、`--cs-cover-1..6`（封面六档，**随预设变**，由品牌色 `color-mix` 现混）、`--cs-node-*` 复用已有不新增 |
| 守卫 | `tests/project-row.test.mjs`（**新建 14 用例**：相对时间分档边界 / 代理对首字 / 色档由 id 派生 / **档位数量三处同源** / 阶段词与六段轨道同源）+ `scripts/preview-rail.mjs`（**整栏渲染台**，32 条 computed-style 断言，明暗双轨） |
| 验收 | 分区 **F 左栏**（见 `visual-direction-ui-closeout.md` §6.1）：完整态 280px、收起态 56px、hover / 选中 / 菜单展开 / 折叠四态、明暗各一遍 |
| 回滚点 | 一个 commit |

#### DD-08 子批 R0~R8（实际施工序，非编号序）

| 子批 | 内容 | 关键文件 | 风险 |
| --- | --- | --- | --- |
| **R0** | 整栏渲染台 `scripts/preview-rail.mjs`：280px 真实宽度、明暗双轨、hover/选中/菜单/折叠四态。既有三个脚本各覆盖一块，**没有一处是「整栏」** | `scripts/`（不碰 `src/`） | 零 |
| **R1** | 令牌收口 + **层级反转**：字号 7 档→3 档走 `--cs-fs-*`、间距走 `--cs-space-*`、圆角走 `--cs-radius-*`；组头降到 11px 次级、项目名回主级；hover 底改 `--cs-shell-2`、线改 `--cs-line`；**删两条死规则**（`.csProjectSettings` / `.csProjectFormInline`，全仓零消费者） | `styles.ts` | 低（纯 CSS） |
| **R2** | **菜单取代 select**：`⋯` 图标按钮 + 菜单，**复用既有 `.csContextMenu` / `.csMenuAction` 家族**（`CanvasContextMenu.tsx` 已建立这套语言），不新造第三套；关闭语义沿用 CV-167 结论（`pointerdown`） | `ProjectList.tsx`、新增 `ProjectRowMenu.tsx` | 低 |
| **R4** | 分组头：`▸/▾` 文字符 → **SVG 箭头 + 旋转过渡**（归「让位」语义）；计数独立成列右对齐，不再挤成 `名称 (8)` | `styles.ts`、`ProjectList.tsx` | 低 |
| **R6** | 用户卡：avatar 30 + 名称 13/500 + **副行真实信息**（不再占位） | `UserCard.tsx` | 低 |
| **R5** | 动作区收口：三枚虚线按钮 → **一枚主按钮 + 一枚图标按钮**（⊕ 新建分组）；**dev 自测入口默认隐藏**（拍板 2C） | `ProjectList.tsx` | 中（`createOpen` 受控链路不能断） |
| **R3** | 项目行 → **项目卡**：34px 首字母封面 + 名称 + 副行（阶段词 / 产出规格 / 相对时间）。副行**第一版零契约改动** —— 三样全来自已在 wire 上的字段 | `ProjectList.tsx`、新增三个纯函数 | 中 |
| **R8** | **可收起左栏**（2026-09-14 新增需求）：收起成 **56px 缩略条**（项目色块 chips + 品牌标 + 用户头像），可再展开。栅格用 `data-rail="strip"` 驱动，`min-width` **同步下移**到 696px（否则收起反而多出横向滚动条 —— 渲染台抓到过） | `styles.ts`、新增 `RailStrip.tsx`、`StudioFrame.tsx` | 中 |

#### DD-08 拍板记录（2026-09-14，用户逐条确认）

| # | 议题 | 拍板结果 |
| --- | --- | --- |
| 1 | 封面数据源 | **A + C**：首字母色块（纯前端派生，立刻可见）**且**加强副行信息。CV-087（Host `coverUrl` 增量写）**不在本批**，落地时这块只是把 `<span>` 换 `<img>` 的局部替换 |
| 2 | 「跑效果测试」入口 | **C**：加 dev 开关，**默认隐藏** |
| 3 | 行内操作 | kebab 菜单（`⋯`），去掉常驻按钮 |
| 4 | 是否引入自有文本令牌 `--cs-t*` | **不引入** —— 继续用宿主 `label-*`（主题自适应已验证） |
| 5 | CV-036「标记完成」徽章 + 沉底 | **手动标记**（不做自动判定），入口塞进 R2 的菜单里 |
| 6 | 栏宽 | **保持 280px**，但做成**可收起**（→ R8，收起 56px 缩略条） |

#### DD-08 两条越界禁令（照抄设计稿会挂守卫）

1. **别改栏宽基准**。`minmax(200px, 280px)` 收到设计稿的 264px 会重排画布与时间轴 —— 那是已验收的 C/D 区。
2. **别照抄设计稿的令牌名**。`--cs-t1/t2/t3`、`--cs-canvas-1`、`--cs-shell-3` 在 `brand.ts` 的令牌里**都不存在**（`shell-3` 已被 C2 按棘轮删掉），照抄会被 DD-01 落地的**幽灵令牌守卫**当场拦。文本色继续用宿主 `label-*`；选中行底色用已有的 `--cs-shell-2`，**不要用 `--cs-canvas-*`**（会违反「画布必须是最深一档」那条既有断言）。

### DD-09 · 右栏（对话区）（2026-09-14 立项，**硬约束变更后的第一个批次**）

| 项 | 内容 |
| --- | --- |
| 目标 | 右栏与左栏**性质不同** —— 左栏是插件自己的 DOM（DD-08 可以大刀阔斧），右栏是**宿主 DSH 的 conversation**。立项时用户加了一条硬约束：「**不改 dsh 本体，要保留随时无缝升级的能力**」。于是本批分两层：先把「不越界」变成机器可验证属性（a 批），再在**宿主公开插槽 + 令牌只读**的范围内做视觉提升 |
| 约束下的可动范围 | **L0 插件自有 DOM / L1 宿主公开插槽 / L2 宿主令牌只读**。实测四条红线本来就全 0 → 这条约束**不是新增限制，而是把既有事实钉住**。宿主用 CSS Modules（hash 类名），插件**选不中也不该选**；`.csChat` 侧原本只有 8 行有效规则、`.csConversation` 1 条 —— 「不动右侧对话区」这条既有硬约束**天然已满足** |
| 可插入的宿主槽（L1） | `conversation.session.header.actions` / `.utilities`、`chat.turnTail`（chain）、`chat.assistant-actions`、`input.dock`（卡片上方整行）、**`composer.dock`（卡片下方读数带）**、`input.left` / `.right`；`chat.node` 是 **keyed**（只能加自己的 key，已有 `canvas-studio-question`）；已用 `hero.brand.mark` |
| 改不了的（明确非目标） | 消息气泡 / tool 调用行节奏 / 输入框本体 / 模型选择器 / 往消息流中间插阶段分隔线。**原 h 批（阶段分隔线）因此整批删除** —— 它结构性违反约束，不是「以后再说」 |
| 「无缝升级」的技术基础 | `slots.inject(key, () => slots.register(...))` 是**等待声明**语义：裸 `register` 到未声明槽会抛「registering into an undeclared slot」→ 渲染进程 abort；`inject` 的 callback 在声明就绪后才跑 → **宿主升级删/改槽位时，插件静默不挂该 UI、整体照常启动**。这条已由守卫④固化 |
| 关键设计判断 | **越少依赖宿主渲染，越不怕升级** —— 宿主渲染的 markdown 改不了，那就让产物**不再以文字形式出现在消息流里**：工具返回结构化结果 → 插件在 `chat.turnTail` 渲染卡片。`conversationEvents.register` + `tool/result` 的 `callId`（`asset-capture.ts:221`）是现成关联键，不必猜时间 |
| 改动点 | `src/client/styles.ts`、`src/client/StudioFrame.tsx`；新增 `src/client/ChatStrip.tsx`（b 批已落）、`src/client/AssistantActionBar.tsx` 等（c~g 批） |
| 新增令牌 | **零** —— 竖条材料全部复用既有令牌，避免触发空转棘轮；本批刻意不往 `brand.ts` 加东西 |
| 守卫 | `tests/host-boundary.test.mjs`（**新建 6 用例**：四条红线 + 禁相对路径深入 dsh + 宿主槽「种类必需项」；红线④与必需项都用 **TS AST** 判定）+ `scripts/preview-chat.mjs`（**右栏整栏渲染台**，31 条 computed-style 断言、明暗双轨）+ `tests/visual-tokens.test.mjs` 加 3 条（收起态栅格 + 对话区不得 `display:none` + 会话头 chip 接线与类名双向配对）+ `tests/stage-chip.test.mjs`（**新建 8 用例**：chip 判定纯函数） |
| 验收 | 分区 **G 右栏**（`visual-direction-ui-closeout.md` **§6.1 区表 + §1.1 逐区勾选清单**；**2026-09-15 前该区只在本文被引用、收口清单里没登记，引用指向的 §6.2 其实是「开发顺序」** —— 已补登记）：右栏完整 / 收起两态、画布**真实变宽**、展开后**滚动位置停在原处**、**会话头标题完整显示 + 胶囊住读数带右端**（CV-179）、明暗各一遍 |
| 回滚点 | 一个 commit |

#### DD-09 子批 a~g（h 批已删除）

| 子批 | 内容 | 状态 |
| --- | --- | --- |
| **a** | 红线棘轮守卫 `tests/host-boundary.test.mjs` + 右栏渲染台 —— 把「不碰 dsh」从口头约定变成 CI 可验证属性 | **已落地**（558/558 fail 0，反向验证过能红） |
| **b** | **可收起右栏**：56px 竖条 ⇄ 320~480px，`data-chat` 驱动栅格；新增 `ChatStrip` + `.csChatCollapse` | **已落地**（渲染台实测画布 480 → 904 → 1128px） |
| **c** | **阶段 chip 与会话头**（原走宿主公开槽 `conversation.session.header.utilities`，kind `list`）：未选项目不占位、显示当前段 + 进度 + 执行模式、待批准转 gold | **已落地 → 已迁移**（新增纯函数 `src/stage-chip.ts` + `tests/stage-chip.test.mjs` 8 用例，569/569 fail 0）。**CV-179 起该挂点已撤销**：胶囊是会话头里唯一的插件元素，而宿主标题簇是 `flex: 1; min-width: 0`、utilities 是 `flex: none` → 胶囊每占 1px 就压标题 1px（实测占 133px 时 14 字标题只剩三字）。现改挂**输入区读数带**（`ProjectContextBar` 右端），判定与组件原样复用、零新判定；详见下方「c 的 CV-179 修正」 |
| **d** | **项目上下文条**：当前项目 + 画幅 + 目标时长（+ 建议镜头数）。**槽选型在实施时纠正为 `conversation.composer.dock`**（宿主把两个位置分了工，见下方「d 三处反直觉判断」）；**CV-179 起该条同时承载阶段胶囊**，样式升为场记板横条 | **已落地**（新增纯函数 `src/project-context.ts` + `tests/project-context.test.mjs` **9 用例**；`planSummaryOf` 与左栏副行共用一份实现；CV-179 把签名扩为 `(project, workflow, nodes)`） |
| **e** | **产物卡**：裸 UUID 文本 → 缩略图卡片（`chat.turnTail` + `callId` 关联） | 待做 |
| **f** | 轮末动作（`chat.assistant-actions`） | 待做 |
| **g** | 容器收口（只收口插件自己的容器，**不覆写宿主令牌**） | 待做 |
| ~~h~~ | ~~消息流中间插阶段分隔线~~ | **已删除**（违反硬约束） |

#### DD-09 / b 三处反直觉判断（别按常识改回去）

1. **收起态的对话区不能用 `display:none`**。它是一个滚动容器，一旦离开布局 `scrollTop` 就归零 —— 用户收起再展开会跳回对话顶部，而收起本来是**可逆动作**。正解：绝对定位脱离文档流 + 写死 `480px` 自身宽度（右栏上限，任何实际宽度都不超过它，故内部布局一字不变）+ `visibility: hidden`。代价是 `.csChat` 必须 `position: relative` 当包含块（缺了会以视口为包含块，把对话区糊到整个窗口）。
2. **grid 分支不能四象限展开**。`[data-rail]` × `[data-chat]` × `[data-mode]` 全写就是 12 条，改一处漏三处。实际只需要 **1 条**显式组合（两栏同时收起），其余三种由单栏规则与本体覆盖；而那条组合必须写在「左栏收起 + lobby」**之前** —— 两者特异度同为 0,3,0，平手靠源码顺序决出，**lobby 必须赢**（第三列回 0px，否则 lobby 态中栏聊天被挤进 56px 缝里）。
3. **收起按钮走绝对定位的插件自有元素，不塞进宿主头部**。右栏顶部是宿主 conversation 自己的头部（CSS Modules，hash 类名选不中）；塞进去就是改 dsh，自造栏头又会与宿主头部叠成「双层头」。代价是 `top/left: 6px` 可能与宿主头部左上角内容轻微重叠 —— 用「默认 `opacity: .55`、hover 才实底」压低冲突。

#### DD-09 / c 三处反直觉判断（会话头阶段 chip）

1. **未选项目时必须 `return null`，不能渲染一个空壳**。宿主那排 utilities 是 `:empty { display: none }` 折叠的，但它前面挂着 `margin-left: 20px` —— 渲染出一个没有内容的 `<span>` 会让 `:empty` 不成立，会话头右侧平白多出 20px 空白，而且**什么都不报错**。所以「显不显示」的判据必须是 `null`，由纯函数给（`tests/stage-chip.test.mjs` 第一条就是它）。
2. **`list` 槽必须给 `id`、`keyed` 槽必须给 `key`** —— 槽的 kind 决定必需项，缺了不是「少个属性」而是宿主 SlotRegistry 直接**抛错**；抛在 apply 期间等于渲染进程 abort（桌面上表现为「Renderer boot failed」，不是「这块 UI 没出来」）。已固化成守卫：`host-boundary.test.mjs` 维护一张**只含本插件实际注册的三个宿主槽**的小表，注册了表外的槽就报错（逼人来补 kind，而不是让它悄悄过去）。
3. **chip 本批刻意不做交互**。它是**读数**（`title` 里带完整信息：阶段 / 进度 / 模式 / 已产出节点数），不是入口。理由不是省事：它长在宿主头部里，点击要做什么（跳到该段产物？打开审批？）是产品决策，而它紧挨着宿主自己的按钮群，误点的代价是打断会话。等 e / f 批拿到 `chat.turnTail` / `assistant-actions` 之后，交互落在**插件自己的容器**里。

> c 批的判定**全部收口到纯函数** `src/stage-chip.ts`（8 条单测直连），组件只剩「把模型渲染成 DOM」。
> 原因就是 R8 那件事：判定写在 `.tsx` 里只能靠渲染台验，而渲染台的绿**不覆盖接线**。

#### DD-09 / c 的 CV-179 修正：胶囊撤出会话头（**别再加回去**）

桌面验收时用户给了一张截图，问「上面这个文字是什么意思，永远显示不出来全部的」。定位过程本身就是结论：

1. **那行字是宿主自动生成的会话标题** —— 不是项目名（项目名在输入卡下方那条读数带上），也不是我们写的任何元素。它来自 `titleProvider: session-title-first-prompt-llm`（从首条用户消息提炼），落盘在会话转录的 `"title"` 字段；截图里是 14 字「创作演唱会MV及简单女声歌曲」。**先把「这是什么」查清，再谈「怎么改」** —— 否则会去改一个我们根本控制不了的字符串。
2. **它被截不是因为它长，而是因为我们在挤它**。宿主 `ConversationRoot.module.css`：`.titleRow`(flex) → `.titleCluster`(`flex: 1; min-width: 0`)，里面是 `.crumb`(`max-width: 220px; overflow: hidden; text-overflow: ellipsis`) 与 `.headerActions`(flex: none)；右侧 `.headerUtilities` 是 `flex: none; margin-left: 20px`。**能被压的只有标题簇，压人的是 utilities** —— 而阶段胶囊正是 utilities 里唯一的插件元素。算术：胶囊在场时标题可用约 93px（实测只显示三字），撤走后回到约 234px ≥ 14 字所需约 202px。
3. **结论：能改的不是宿主的标题，是我们放进去的东西**。宿主这条会话头是 CSS Modules（hash 类名），插件既选不中也**不该**去改 —— 硬改就是违反「不碰 dsh、保随时无缝升级」。所以正解是把自己的元素**撤出去**，而不是想办法把标题挤回来。
4. **但它不能只是被删掉**。胶囊是右栏唯一的阶段读数（六段轨道与审批条都在中栏），直接删等于功能回归 → 改挂输入区读数带右端。**判定与组件原样复用**（`deriveStageChipView` → 合并进 `deriveProjectContextView(project, workflow, nodes)`），**零新判定**；`StageChip.tsx` 退化成纯展示组件，不再自己订阅 store。
5. **验证手法要留存**：宿主 DOM 我们断言不了，于是渲染台**同一帧渲染两个只差一件事的会话头**（挂着胶囊 vs 不挂），差分断言「现状不截 **且** 对照组仍被截」。**对照组必须真的红** —— 否则「现状不截」可能只是因为模型里压根没挤，主断言就是空绿。这条写法可直接复用到任何「宿主宽度受限、插件只能退让」的场合。

**落地后新增的两条源码闸**（`tests/visual-tokens.test.mjs`）：① 插件不得再往 `conversation.session.header.utilities` 注册元素（旧 id `canvas-studio-stage` 必须一并消失，留着会让后来者以为那里还挂着东西）；② 胶囊必须是纯展示组件（`useStudio` / `InjectFace` / `deriveStageChipView` / `workflow.state` / `approvalPending` 一律不得出现 —— 「撤出会话头」与「退化成纯展示」是两件事，只做前者会留下一个没有出口的组件）。`host-boundary.test.mjs` 的「宿主槽必需项」表同步摘掉该槽，并在原处写明**再加回时必须补回该行**（否则新挂点会绕过 kind 必需项检查）。

#### DD-09 / d 三处反直觉判断（项目上下文条）

1. **槽选型：`composer.dock`，不是立项时写的 `input.dock`**。宿主槽目录对这两个位置有明确分工 —— `input.dock` 是「卡片**上方**的整行，给需要独占一行/**会换行或带正文**的内容（queue rows / todo strip / goal bar）」，`composer.dock` 才是「卡片**下方**、卡片宽度列内的**环境读数**位」（自带的 stats 行 `id: 'stats', order: 0` 就住那里）。读数条不换行、不带正文、不可点，归后者。两个槽都是 `list` + `scope: session` + 必填 `id`，选错**不会报错**，只会让读数落在错的位置 —— 所以这条已经固化成守卫（`tests/visual-tokens.test.mjs` 断言注册进的是 composer.dock，且**不得**出现 input.dock 的注册）。
2. **宿主对 composer.dock 的渲染条件是 `!hero`** —— hero 态（尚无会话内容、输入框居中）**不渲染这一带**。已知并接受：此时中栏画布与左栏都已在表明项目身份，本行是补充读数而非唯一信号。想让它在 hero 也可见，换回 `input.dock` 即可（一行字符串），但会与 goal / queue 抢同一格。
3. **几何必须 1:1 镜像那条 stats 行**（同宽列 `--dsh-chat-content-width`、同内边距 `--dsh-composer-side-clearance`、同 12px/20px、同样居中）。宿主那一份是 CSS Modules（hash 类名，插件选不中也改不了），所以只能按它抄量级；两条读数行一上一下，一条居中一条左对齐就会显得散。渲染台的断言正是「两者**等宽同轴**」，而不是「宽度等于某个数」 —— 480px 栏宽下 748px 的上限根本不生效，断言上限等于没测。

---

#### DD-09 验收期抓出的缺陷：CV-176 审批门三连失效（2026-09-14，已修复·待验收）

> b 批桌面验收时用户顺手报了两个现象，**都不是 DD-09 引入的**，但都在 DD-09 的验收动作里被看见 —— 属于「验收不只是看新东西」的收益。这里留档是因为**取数方法**和**两条工程纪律**要传承下去。

**症状**：① 审批条写「剧本已提交到画布，请确认故事方向后批准」，同一屏的六段轨道已显示「剧本✓ 分镜✓ 定妆✓ ⬤关键帧」；② 分镜表提交后**没等用户点批准就继续跑**。

**取证（可复跑，胜过看截图）**：DSH home 不是默认 `~/.dsh` 而是 `~/.videobuddy`；画布数据在 `settings.yaml` 的 `canvas-studio.assetDir`。会话转录 `~/.videobuddy/sessions/<cwd 转义>/session-*/session.jsonl.zstd` 是**多帧 zstd** —— `zlib.zstdDecompressSync` 只解首帧（216B，实际 172KB），必须 `/opt/miniconda3/bin/zstd -dc`。转录显示 `submit_storyboard_for_approval` **14:25:46** 提交、用户 **14:29:44** 才批准，**这 3 分 58 秒里** agent 加载 `h3-prompt-writing`、读 `format-ref2va.md`、2× `image_generate` 定妆照、`character_sheet` 建卡，然后一路逐镜出图。

| 层 | 根因 | 实测证据 | 修法 |
| --- | --- | --- | --- |
| ① 提示词 | **停止指令的「位置」**，不是措辞 | 剧本结果 152 字符、指令在第 74 字符（**49%**）→ 停住；分镜 **1080 字符**、指令被 16 张卡的「标题+UUID+逐镜出图时把 shotRefs 设为…」压到第 1023 字符（**95%**）→ 没停 | 新建 `src/approval-notice.ts`：停手写第一行，获批后才用的材料走 `deferred` + `DEFERRED_FENCE`；总纲补「提交即停手」硬条，删掉已不成立的旧说法「image_generate 出概念图不受限」 |
| ② 硬门禁 | 门禁表只列了两个工具，且**最贵的动作走的是另一条路** | `GATED_TOOLS = {video_generate, video_composite}`；逐镜出图走 `image_generate`、`character_sheet` 连表都没进 | 新建 `src/approval-gate.ts` 纯函数判定，删 `GATED_TOOLS`；`runGeneration` + 5 个**直接 execute** 的工具逐个接线；三个 `submit_*` 改用官方 `exec.concludeTurn()` 硬停 |
| ③ 六段轨道 | `OPERATION_STAGE` **4 个死键** + 审阅态吃证据 | 分镜卡是 text 节点（被 `kind !== 'image'` 拦下）、`character-sheet`/`scene-concept` 无生产者 → 两段永远空；Look 产物全 `text-to-image` → 样本 14:20 出、剧本 14:22 才写，**剧本没落盘轨道就跳到关键帧** | 删死键；分镜卡按 `toolName` 判；新增 `operationType='look'` 归「定妆」；`deriveWorkflowStage` 加**审阅态例外**；`csStageDone` 改为「位次在前 **且真有产物**」 |

**两条要传承的工程纪律**：

1. **守卫要钉结构，不钉字面**。文案测试只断言「停手在**首行**」「围栏前正文 ≤320 字符」「`auto` 不得出现停手」「`concludeTurn` 必须在 `auto` 分支之后」—— 措辞随便改都不该红。反过来，若只断言「文本里含『请结束回合』」，事故里那版实现**正是这么写的**，守卫会绿着看它失效。
2. **判定与接线是两件事，都要守**。`approval-gate.ts` 的判定表逐格单测能全绿，但工具忘了调用它，行为与「没做」完全一样。所以守卫里有一条**源码断言**：5 个不走 `runGeneration` 的工具必须真的调了 `assertApprovalAllowed`（这一条当场覆盖了 `character_sheet` 这个双重漏网）。同理，门禁判定与出图分类必须**同源**（都取 `shotNodeIds` 的 `shotBound`）——两处各写一份，迟早一个放行一个拦。

**顺带结论**：原计划的「阻塞式审批」（`ask_user_choice` 式 pending + 轮询）**不必做了** —— dsh 官方 `exec.concludeTurn()` 已提供硬停，不需要架构改动。这条要写进来，免得以后有人翻到那个候选方案又评估一遍。

---

### DD-10 · 新建项目对话框 + 首屏（2026-09-15 立项，随 CV-182 落地）

**立项缘由**：用户在 DD-09 验收通过后拿着两张截图提两条 —— ①「新建页面优化一下」②「第一个对话也重新设计一下？整体高大上，跟正式画布和谐一些」。三条决策当场确认：画幅/时长下拉**改成 chip 组**；首屏「项目规格 + 阶段」放**中栏顶部·开拍前条**；顺带发现的**播放弹窗标题栏回归一并修复**。

**范围的第一件事是划清「不能改的地方」**：

| 元素 | 归属 | 结论 |
| --- | --- | --- |
| 「✦ 探索未至之境」标题 / 「预览版」徽标 / 输入框 | `deepseek-harness/.../ui-conversation/` 的 `EmptyHero.tsx` + `locales.ts` | **宿主的，插件改不了**（CSS Modules hash 类名）。首屏「不和谐」的账**不能记在它头上** |
| `.csLobbyHero`（品牌条） | 我们自己的 | 早已是画布材质（C7 / DD-06）——**它才是材质基准** |
| `.csChat` 卡片（lobby / lobby-pending） | 我们自己的 | 白盒子（`--dsw-alias-bg-layer-1` + 1px 描边）→ **不和谐的真正来源** |
| `conversation.composer.dock`（规格读数带） | 宿主槽 | 渲染条件是 `!hero` → **首屏天生看不到**，故需要「替身」 |

**A 批 · 新建项目对话框（CV-182）**

1. **先修回归**：`.csModalHeader` / `.csModalClose` 自 `df8ad3b2b5` 起是 `display: none`，而三个播放弹窗的标题与关闭键全挂在上面 → 恢复可见（28px 方形关闭键）；新建对话框改用独立 `.csCreateHead` / `.csCreateClose`。
2. 标题栏：accent 立柱（2px，与 `.csContextBar::before` 同款）+ 标题 + **副行「三项都可以留空 —— AI 会在对话里跟你确认画幅与时长」**（此前没有任何地方告诉过用户）+ ×。
3. 分组下拉：emoji + 原生箭头 → 内联 SVG + `appearance: none` + 自绘箭头，三段收进同一个字段盒。
4. 画幅（4 枚）/ 目标时长（5 枚）由原生 select 改 **chip 组**：两行结构（主词等宽数字 + 副词说明），选中态**读 `aria-pressed`** 而不另挂类名 —— 选中是语义，照进 DOM 属性比加类名不容易漂移（类挂了属性没同步就会出现「看着选中了但屏幕阅读器说没选」）。
5. 字段间距 14→18px；主按钮 hover 加 accent-soft 环；底部操作区底色取壳层第二档。

**B 批 · 首屏（DD-10）**

1. **对话卡换材质**（这是「跟正式画布和谐」最实的一块）：`.csChat` 的两态规则改 `--cs-canvas-bg-l1` + 顶部 accent 光晕 + 120/24 双层点阵 + `--cs-line` + `--cs-shadow-2`，参数与 `.csLobbyHero` / `.csCanvasSurface` **逐字同源**。底色用 L1 而非 `--cs-canvas-bg`：**画布本体必须是最深一档**（DD-02 的硬约束），卡片是「画布的内容面」。
2. **中栏「开拍前条」**（本批唯一新增内容）：lobby-pending 时中栏第一行原本什么都不渲染，而 work 态同一位置有工具栏 + 工作流条 → 补同位置一条带子（`待开拍` 胶囊 + 项目名 + 规格 + 阶段胶囊）。数据与输入区读数带**同一个判定入口**（`deriveProjectContextView`）+ **同一份拼装**（新抽 `specPartsOf` / `contextTitleOf`，两条带子共用）。
3. 技能卡材料由宿主令牌改 `--cs-line` / `--cs-node`，hover 用 `--cs-glow-accent`。

**渲染台当场抓出三条静态检查看不见的问题**（新增预览组 `preview-create.mjs`，明暗双轨）：

| # | 现象 | 性质 | 处置 |
| --- | --- | --- | --- |
| 1 | 字段盒 34px vs 输入框 32px | **真问题**：盒内控件 padding 写 8px，而描边只出一次（输入框自己出、字段盒由外盒出）→ 三个字段的盒边在竖线上错开 2px | 控件 padding 改 7px 对齐输入框；守卫**把两处 padding 绑成一条不变量**（改一处必须改另一处） |
| 2 | 对话卡在行内溢出 **6px**，压掉开拍前条底边框中间一段 | **旧账变可见**：`margin: 0 0 12px` + `align-self: center` 在 452px 行里使 margin 盒 = H+12 > H → 整体上移 6px。此前第一行为空，看不出来 | 改 `height: min(560px, calc(100% - 24px))` + `margin: 12px 0`，让 margin 盒**恰好等于行高**，居中无余数、也不依赖容器实际高度 |
| 3 | 预览台自己写的「两行各 5 枚 chip」 | **断言错误**：真实代码是画幅 4 枚 / 时长 5 枚 | 修正断言（并顺手改正 `styles.ts` 与守卫注释里的同一个错误说法） |

> 第 3 条值得单记：**验收台自己也会写错**。它的断言一旦把「我以为的」写成事实，就会在正确的实现上报错（或反之放行）。所以预览台的失败必须逐条回源码核对，而不是照着改实现。

**守卫**（`tests/visual-tokens.test.mjs` +7、`tests/project-context.test.mjs` +3）：

- **媒体弹窗标题栏双向守卫**：① 共享类不许再被 `display: none`，且三个弹窗必须仍在消费；② 新建对话框不许回挂共享类。只守一边都拦不住「再关一次全局」。
- chip 组：选中态只准挂 `[aria-pressed='true']`（禁另造 `.csChoiceActive`）、盒内控件 `appearance: none`、图标必须内联 SVG（禁 emoji）、**字段盒与输入框 padding 必须相等**。
- 类名与样式**双向配对**（对话框 14 类 + 开拍前条 6 类）。
- 首屏卡片：L1 底色（且**不得**用最深的 `--cs-canvas-bg`）、120/24 点阵、光晕在第一层、描边走 `--cs-line`；两态**共用同一条规则**。
- 接线：`StudioFrame` 必须在 `!hasConversation` 分支渲染 `SlateBar` 且三个入参不漏传；`SlateBar` 不得 `useStudio`、不得判阶段、必须复用 `specPartsOf` / `contextTitleOf`。

**验收方法**：`node scripts/preview-create.mjs`（本仓没有 `preview:*` 的 npm 脚本，四条预览台一律直接跑 node）产出 `.workbuddy/preview/create-modal-preview.html`，浏览器打开、`?theme=light` 切浅色；页内 48/49 条 `computedStyle` 断言与判决表可直接读。桌面验收两条：① 点「+ 新建项目」看标题栏/两个 chip 组/分组下拉的箭头；② 选中一个还没有对话的项目，看中栏第一行是否出现开拍前条、下面对话卡是否与顶部同材质。**顺带回归**：播放任意视频/音频、点开图片预览，**标题与 × 关闭键应该回来了**（这正是本批修掉的回归）。

---

## 4. 令牌新增总表（DD 批次合计）

| 令牌 | 归属 | 值 / 来源 | 随预设变？ |
| --- | --- | --- | --- |
| `--cs-fs-xs/sm/base/md/lg/2xl` | DD-01 | 6 级字阶，取代 11 种离散 font-size | 否 |
| `--cs-line` | DD-01 | `color-mix(in srgb, var(--dsw-alias-border-l2) …)`，收口 107 处 | 否 |
| `--cs-line-hi` | DD-01 | 强调分隔（选中/hover） | 否 |
| `--cs-dim` | DD-01 | 景深不透明度（建议 0.7，待拍板） | 否 |
| `--cs-glass` | DD-01 | 浮层底（配 `backdrop-filter`） | 否 |
| `--cs-shell` | DD-02 | `--dsw-alias-bg-base` 或 `color-mix` 微调 | 否（跟随宿主主题） |
| `--cs-node` | DD-02 | 建议 `--dsw-alias-bg-layer-1`（宿主已有层级） | 否 |
| `--cs-canvas-bg` | **已存在** | brand.ts:164-175，**从 2 次引用扩到画布本体** | **是**（每预设一条） |
| `--cs-glow-accent` | **已存在** | brand.ts（原**只在 dark 轨**，DD-03 补上浅色轨），接到 `.csNodeSelected` | 是 |
| `--cs-gate` | DD-03 | 媒体区片门暗带：暗 `#0B0D12` / 浅 `rgba(15,17,23,.82)` | 否 |
| `--cs-scrim` | DD-03 | 生成中遮罩：暗 `rgba(11,13,18,.86)` / 浅 `rgba(252,252,254,.9)` | 否 |
| `--cs-node-opacity` `-state` `-dim` | DD-03 | 节点不透明度三个乘数（默认 1），由 `.csNode` 一条 calc 相乘 | 否 |
| `--cs-gold` / `--cs-teal` | **已存在** | brand.ts:181-182，接到审批条 / 播放控件 | 否 |
| `--cs-canvas-grid(-major)` | **已存在** | brand.ts:166-167,176-177，接到网格双层 | 是 |
| `--cs-float` | DD-08 | 浮层底。暗色比壳亮一档；**浅色与壳同为 `#FFFFFF`** —— 那不是 bug，是刻意：浅色下浮层靠描边 + 投影区分（渲染台按主题分写断言） | 否（跟随宿主主题） |
| `--cs-shell-2` | **已存在** | 原为选中行底色，DD-08 扩到**侧栏行悬停** | 是 |
| `--cs-cover-1..6` | DD-08 | 封面六档，由品牌色**现场 `color-mix` 混出**，明暗自动跟随；与 `project-cover.ts` 的 `COVER_TONES` **同源**（三处档数由守卫钉住） | **是**（每预设一条） |

> 关键判断：**DD-02 需要自造的新令牌只有 `--cs-shell` / `--cs-node` 两个**，其余全部是"接了已有的线"。
> 这与原方案"设计系统只落地了四分之一、要大改"的观感不同 —— 之所以只落地四分之一，是因为**没接**，不是因为**没有**。

---

## 5. 守卫测试清单（DD-03 后回填为实际状态）

| 文件 | 状态 | 覆盖批次 | 实测用例数 |
| --- | --- | --- | --- |
| `tests/visual-tokens.test.mjs` | 已建（原名计划叫 `design-tokens`，改名以避开已有的 `style-tokens.test.mjs`） | DD-01 / DD-02 / DD-03 / DD-05 / **DD-08** / **DD-09**（b / c / **d**） | 7 → 9 → 25 → **27**（含 C 系列既有守卫） |
| `tests/canvas-lineage.test.mjs` | **新建** | DD-03（血缘聚光纯函数） | 8 |
| `tests/brand.test.mjs` | 扩充（+1：主题敏感令牌两轨都在） | DD-01 / DD-03 | 6 |
| `tests/host-boundary.test.mjs` | **新建**（把 DD-09 立项时的硬约束「不改 dsh 本体」变成 CI 属性） | DD-09a / c / **d** | 5 → **6**（+宿主槽种类必需项；表内槽 3 → **4**，含 `composer.dock`） |
| `tests/stage-chip.test.mjs` | **新建** | DD-09c（会话头 chip 判定纯函数） | 8 |
| `tests/project-context.test.mjs` | **新建** | DD-09d（输入区读数带判定纯函数） | 6 |
| `tests/waveform.test.mjs` | 待建 | DD-04b | — |
| `tests/timeline.test.mjs` | 待扩充 | DD-04a | — |
| `tests/project-row.test.mjs` | **新建** | DD-08（相对时间 / 封面色档 / 副行组装 / 阶段词）+ **DD-09d**（规格摘要唯一实现） | 14 → **16** |
| `scripts/preview-rail.mjs` | **新建**（整栏渲染台，非单测） | DD-08（R0） | 32 条 computed-style 断言 |
| `scripts/preview-chat.mjs` | **新建**（右栏整栏渲染台，非单测；`verify-previews.mjs` 已纳入，明暗双轨） | DD-09b / c / **d** | 24 → 31 → **39** 条 computed-style 断言 |

**`tests/visual-tokens.test.mjs` 实际用例**（照项目命名风格：中文 + 说明断言意图）：

1. `守卫：styles.ts 不得含反引号（模板字面量会被撕裂）` ✅ DD-01 **本批又拦下一次**
2. `守卫：styles.ts 引用的每个 --cs-* 都必须在 brand.ts 有定义（禁幽灵令牌）` ✅ 本批拦下 3 个内部变量
3. `DD-01 棘轮：brand.ts 新增令牌不得空转（空转集 ⊆ 基线）` ✅ 基线 25 → 11
4. `DD-01 棘轮：已接上引用的令牌应从基线移除（清单需与现实一致）` ✅ 本批提示删掉 `--cs-shell-3`
5. `DD-03 守卫：@keyframes 只允许三语义（develop / advance / yield）` 🆕
6. `DD-03 守卫：节点不透明度只走 --cs-node-opacity 乘法链` 🆕 直接钉死本批修的死代码
7. `DD-03 守卫：血缘聚光判定不得在客户端内联第二份` 🆕（剥注释后比对，防误杀）
8. `DD-08 守卫：styles.ts 用的每个 [data-*] / [aria-*] 属性都必须真的有 .tsx 写它` 🆕 **由 R8 的真实事故催生**（见下）
9. `DD-08 / R8 守卫：收起态左栏走 56px 栅格，不是「撑满 280px 再居中」` 🆕
10. `DD-09 / b 守卫：收起态右栏走 56px 栅格，且对话区不得被卸载或丢滚动位置` 🆕 **9 条断言**（`data-chat` 真挂 DOM / 第三列 56px / `min-width: 576px` / 双收起 56-1fr-56 / 双收起规则在 lobby 之前 / 对话区**不是** `display:none` / 绝对定位 / `visibility: hidden` / 固定 480px 宽 + `.csChat` 是 `relative` + `chatCollapsed && <ChatStrip`）
11. `tests/host-boundary.test.mjs` **红线①~④ + 禁深引** 🆕 见下方 DD-09a 教训
12. `DD-09 / d 守卫：输入区读数带真的接上了宿主槽` + `上下文条类名与样式双向配对` 🆕 **4 条接线断言**（注册的是 `composer.dock` 而非 `input.dock` / occupant 是 `ProjectContextBar` / `id` 固定 / `order: -10` 与同源 `storeInstance`）+ **「判定只在纯函数里」**（组件不得出现 `planSummaryOf` / `suggestShotCount` / `.plan?.`）+ 类名双向配对（整词匹配）。反向验证过：
   摘掉 `id` → 宿主槽必需项守卫红；把槽换回 `input.dock` → 本守卫红。

> **R8 事故（2026-09-14，用户桌面验收当场发现）**：`styles.ts` 里
> `.csFrame[data-rail="strip"]` 的 56px 栅格写好了，渲染台 32 条断言全绿 —— 但
> `StudioFrame` **压根没把 `data-rail` 挂到 DOM 上**（只挂了 `data-mode`）。于是
> 收起左栏后栅格仍是 280px，`RailStrip` 的 `width:100%` 撑满整条、40px 色块被
> `align-items:center` 居中 → **看起来「收起了但没收窄、左边一大片空白、画布一点没变大」**。
>
> 教训写进团队约定：**CSS 断言只能证明「规则写对了」，证明不了「规则被用上了」**。
> 渲染台是手写 HTML，属性是我自己补的，所以它的绿**永远不覆盖接线**。用例 8 就是
> 补这个洞：凡 `styles.ts` 用 `[data-*]`/`[aria-*]` 分支的样式，必须能在某个 `.tsx`
> 里找到同名属性的写入；宿主注入的 `ds-dark-theme` 单独白名单。
> **反向验证过**（把 `data-rail` 摘掉 → 用例 8/9 当场双红），不是假绿守卫。
> aria 一并纳入是因为 `.csProjectGroupToggle[aria-expanded="false"] svg` 属同类风险。

> 用例 1 就是原方案 §1.1 说的那条守卫 —— "这条若早存在，今天这 3 个 0 引用令牌当场被拦下"。
> 实测空转令牌**远不止 3 个**（§1.2），所以这条的价值比原方案设想的更高。
> **DD-03 实测复利**：本批写注释时又踩了一次反引号、又新增了 3 个未定义的 `--cs-*`
> 内部变量 —— 三条守卫各拦下一次，且都是一挂就定位到行。守卫的成本在这个项目里已经回本。

> **DD-09a 教训（手写扫描器 vs 编译器前端，2026-09-14）**：红线④的判据最初是「手写括号配对，
> 数 `register(...)` 的实参个数」，写下去连踩四坑：① 声明的对象里有一段 200 行箭头函数，
> 手写配对只要在**注释或字符串**里遇上一个不平衡的 `)` 就整体切碎；② 只校验方法名 `register`
> → 把 `tools.register` / `conversationEvents.register` / `webServer.register` 共 4 条判成违规（假阳性）；
> ③ 一律用 TSX 去解析 `.ts` → 597 条 `parseDiagnostics`，AST 全废（`ScriptKind` 必须按扩展名给）；
> ④ `register({…} as never, renderer)` 把实参包进 `as never` → 「实参个数 == 1」这条判据直接失效。
> 改用 **TypeScript AST**（`ts.createSourceFile`，仓库里本来就有 typescript）后四坑一起消失，
> 判据换成「接收者必须是 `slots` + 剥掉 `as`/`satisfies`/括号后看对象是否带 `children` 字段」。
> 结论：**凡是"文本层面的结构判定"，交给编译器前端做** —— 手写扫描器省下的那点依赖，
> 远不抵它引入的误报与漏报。**反向验证过**（探针文件 → 四条红线各自转红 → 删探针）。
> 顺带修掉守卫基础设施 `ruleBody` 的**子串误命中**老坑：查 `.csChat {` 命中的是
> `.csFrame[data-mode="lobby"] .csChat {`（同一形态的坑在这个仓库已第三次现形，
> 前两次分别被 `C5 .csErrorCard` 与 DD-08 绕开），改为锚定正则 `(?:^|[,\n])[ \t]*SELECTOR[ \t]*\{`。
> **这条对 DD-09 所有子批都适用**：c~g 批每加一处 `[data-*]` 分支，都要先过 `ruleBody` 这条正则。

> **DD-09 b/c 反向验证的战果（2026-09-14，三次探针）**：新守卫一律先证明**能红**再收工，三次各抓出一类东西 ——
> ① 摘掉 `id:` → 「宿主槽必需项」当场红 ✓（真守卫）；
> ② 把 `csStageChipProgress` 改名成 `csStageChipProgressX` → **初版守卫是绿的（假绿）**：根因是判据写成 `src.includes(类名)`，而 `'csStageChipProgressX'.includes('csStageChipProgress')` 恒真；改成**整词匹配**（两侧不得是 `[A-Za-z0-9_-]`）后当场红 ✓；
> ③ 整条 chip 注册删掉 → **3 条同时红**（红线④的 occupant 基线计数、必需项表的「陈货」自证、c 批接线守卫）✓ —— 说明这三条不是同一件事的重复，而是三层不同的网。
> **教训**：凡断言「某名字存在 / 不存在」，先问它会不会被**更长的名字包含**。同一形态的坑在这个仓库已出现多次（`--cs-accent` 吞掉 `-strong/-soft`、`ruleBody` 的子串误命中、本次的类名包含），统一口径 = **带边界的整词匹配**。

---

## 6. 排期建议（含与 CV 验收交替）

```
DD-00 登记 ──► DD-01 地基 ──┬─► DD-02 空间 ──► DD-03 节点 ──► DD-05 叙事 ──► DD-06 首屏
                             │        │
                             │        └─► DD-04a 时间轴骨架 ──► DD-04b 真波形
                             └─ 与 DD-02 合并验收（纯重构，无视觉变化）
```

| 序 | 批次 | 桌面验收 | 理由 |
| --- | --- | --- | --- |
| 1 | DD-00 | 文档过目 | 先登记，防漂移 |
| 2 | DD-01 | **并入 DD-02** | 纯重构，单看无变化，不值得单独占一次回归 |
| 3 | DD-02 | ✅ 一次 | 感知提升最大，第一次真正"看得出变了" |
| 4 | **CV 验收窗口** | — | 队列已积压 ~65 条，此处必须回补 |
| 5 | DD-03 | ✅ 已落地待验收 | 改动面最宽，回归风险最高 |
| 6 | DD-04a | ✅ 一次 | 可并行插入，但验收独立 |
| 7 | **CV 验收窗口** | — | 交替 |
| 8 | DD-05 | ✅ 一次 | |
| 9 | DD-06 | ✅ 一次 | |
| 10 | DD-04b | ✅ 一次 | Host 侧新能力，单独验 |
| 11 | **DD-08 左栏** | ✅ 一次（**新分区 F**） | **不受 A~E 放行约束** —— 它不在任何既有分区里，现在就能开工；但改完要新立分区 F 单独验 |

**为什么必须交替**：`STATUS.md` 速览显示 `已修复·待验收` **64 条** + `已完成·待验收` 1 条。
每批 DD 加一次桌面回归，连推会让队列从 65 涨到 72，"验收"这个动作本身会成为瓶颈，
而 DEV-WORKFLOW §五 明文规定"代码落地 ≠ 完成"。

---

## 7. 验收方法（桌面）

每批统一走这个动作序列，避免每次重新想：

1. 重启桌面（加载新 build）—— **必须**，否则新样式不生效
2. 打开一个**有存量数据**的项目（不要新建空项目，否则看不到节点/时间轴）
3. 按该批"验收"条目逐条对照，**截图留档**（存到 `docs/` 或临时目录，命名含批次号）
4. 明暗主题各看一遍（硬约束 7）
5. 系统开启「减弱动态效果」再看一遍（验证 reduced-motion 降级）
6. 通过后把 `STATUS.md` 对应条目从 `已修复·待验收` 改 `已完成`

**DD-02 专项**：必须**拿暗部素材**（夜景/低照度）实测截图 —— 原方案 §6 第一风险就是"画布再暗一档，暗部素材可能糊"。

**DD-08 专项（左栏）**：

0. **收起后画布必须真的变宽 —— 本项第一验收点**（2026-09-14 用户桌面验收当场指出过一次）。收起是**栅格**从 `280px` 变 `56px`，缩略条必须贴在**窗口最左侧**、画布立刻多出 224px。若表现为「色块居中、左边一大片空白、画布宽度没变」，原因是 `data-rail` 没挂到 `.csFrame` 上（栅格分支成了死规则），**不是样式没调好** —— 回去看用例 8。
1. **收起 / 展开各走一遍** —— 收起是 56px 缩略条（品牌标 + 项目色块 chips + 用户头像），展开回 280px。**重点看窄窗**：把窗口拖到最小，确认收起后**不会反而多出横向滚动条**（栅格 `min-width` 必须跟着下移到 696px，渲染台抓过这条）。
2. **菜单取代 select** —— 点 `⋯` 出菜单，确认没有残留的原生下拉浮块（旧截图里那个灰盒子）。
3. **副行三段** —— 阶段词 / 产出规格 / 相对时间；**未锁定规格的项目**该段不显示且不留悬空 `·`。
4. **层级反转** —— 分组名应比项目名**更弱**（11px 次级色），不再是现在的倒挂。
5. 明暗各一遍（`--cs-float` 在浅色下与壳同白，**靠描边 + 投影区分**，不是看不见）。

---

## 8. 回滚与 git

| 项 | 做法 |
| --- | --- |
| 粒度 | **一批一 commit**；DD-01 / DD-02 因相互依赖可合一个 PR 但**分两个 commit** |
| 提交范围 | `git add canvas-studio/`；**`lib/` 入库，改 `src/` 时连 `lib/` 一起提交**（项目惯例） |
| 分支 | 根 `video_buddy` / 分支 `dev` |
| push | **助手 commit，push 由用户手动**（本机无凭据） |
| 回滚 | 纯 CSS 批次 `git revert <commit>` 即回；DD-03 / DD-04b 涉及组件，回滚前先跑验证链 |
| 混入检查 | 提交时排除 dirty 的 `deepseek-harness` submodule（submodule hygiene） |

---

## 9. 证据采集命令（可复跑）

> **⚠️ 下面的「期望值」是 DD-01/02 落地前的基线（2026-09-12 上午）。** DD-01/02 已落地，
> 现在复跑会看到若干项**按设计改变**（`var(--cs-*)` 79 → 104；`--cs-canvas-grid` / `-major` /
> `-ease` 由 0 → 1；`dsw-alias-bg-base` 50 → 53 等）。脚本里的 `期望 xxx ✗` 标记**不是失败**，
> 而是「这一项已被本批改动触及」的对照 —— 拿它当**改前/改后对照工具**用，别当断言闸。
> 真正的断言闸是 `tests/visual-tokens.test.mjs`（DD-03 后 7 条）+ `tests/canvas-lineage.test.mjs`（8 条）。

### 9.1 真实产物渲染台（DD-03 起纳入常规验证）

上面的 §9 是**静态**清点（数引用、看行）。DD-02 起另加一层**动态**验证：把真实
`styles.ts` 模板字面量 + 真实 `lib/brand.js` 令牌喂给 headless Chrome，读 `computedStyle`
断言「该发生的真的发生了」，而不是只断言「代码里写了这个词」。双主题各跑一遍。

DD-03 的断言（22 项，全部 ✅）：片门 2px / 边框盒 / 媒体窗底同画布档 · 光晕双层且两主题都解析得出来 ·
悬停规则存在 · 成片青边与普通描边不同色 · **不透明度乘法链 0.9 × 0.75 = 0.675** ·
压暗 0.42 / 失效 0.45 · 遮罩底色暗 13 / 浅 252 · 扫描条 `animationName=csDevelop`、
`position=absolute`、无旧圆角进度条残留 · 双主题零 JS 报错。

> **2026-09-12 已入库**（原临时脚本 `/tmp/dd_render.mjs` 已不存在，故非搬迁而是重建）：
>
> | 脚本 | 职责 |
> |---|---|
> | `scripts/preview-tokens.mjs` | 共享助手。`--cs-*` 令牌**全部派生**自 `lib/brand.js`（不再手抄），并提供 `tokenProbe()` 页内探针 |
> | `scripts/preview-visual.mjs` | 视觉升维验收台：真实 `STUDIO_STYLES` + 真实令牌 + 骨架 DOM，四预设 × 明暗双轨切换，页内 22 条 `computedStyle` 断言 |
> | `scripts/preview-rail.mjs` / `preview-chat.mjs` | 左栏 / 右栏整栏验收台（DD-08 / DD-09），同样明暗双轨 |
> | `scripts/preview-create.mjs` | 新建对话框 + 首屏验收台（DD-10），明暗双轨 48/49 条断言；覆盖「字段盒等高」「两态卡片同材质」「开拍前条与卡片不重叠」等几何判定 |
> | `scripts/verify-previews.mjs` | 一键无头验证：跑上面的产物并把判决汇总成表，**失败即非零退出** |
>
> **写自定义自检的台子不要调用 `tokenProbe()`**：它自带一个 `<pre id="pvVerdict">`
> 并会 `setAttribute('data-pv-fail', …)`，跑在页尾 → **覆盖**本页判决
> （`getElementById` 拿到的是先出现的那个）。`preview-rail.mjs` 与
> `preview-create.mjs` 都是把令牌可解析性并入自己的自检。
>
> 另：`ruleBody()` 取规则体时，**组选择器里只有最后一项紧邻左花括号** ——
> 传前面那一项永远取到空串（`.csFrame[data-mode="lobby"] .csChat,` 后面跟的是
> 逗号）。写断言时要么用末项取体、要么单独断言那两行选择器确实成组。
>
> 跑法：`node scripts/verify-previews.mjs`（加 `--no-gen` 复用现有产物）。四预设 × 双主题
> + 三个既有预览的令牌探针 = 12 组，当前 12/12 全绿。
>
> **为什么不进 `yarn check`**：它依赖本机固定路径的 Chrome，塞进闸门会破坏 AGENTS.md 的
> 「headless-safe」要求。故设计为**独立可选**脚本：找不到 Chrome 就打印跳过说明并以 0 退出。
> 可用 `CHROME_PATH` 指定浏览器。
>
> **为什么必须动态验证**：令牌「在 CSS 文本里存在」≠「在页面上生效」。2026-09-12 实测到
> 一个真 bug —— `brandCssText()` 的第 1 块是**明暗双轨共用的基块**（装着 `--cs-gold` /
> `--cs-teal` / `--cs-dim` / `--cs-fs-*` / `--cs-space-*` / `--cs-shadow-*` / `--cs-ease`），
> 第 2 块才是暗色覆盖层。预览若把基块错锚成「仅浅色」，暗色下这批令牌**整批不生效**，
> 而 `styles.ts` 里大量 `var(--cs-teal, #35C2A6)` 兜底值让界面看着「差不多对」——
> 静态检查全绿，只有 `getComputedStyle` 能抓到。
>
> 另一个同源发现：三个既有 `preview-*.mjs`（lobby / groups / user）的手抄令牌表
> **各自都缺 16 个关键令牌**（`--cs-shell` / `--cs-node(-hi)` / `--cs-float` / `--cs-line(-hi)` /
> `--cs-fs-*` / `--cs-dim` / `--cs-gate` / `--cs-scrim` / `--cs-glow-accent` / `--cs-gold` /
> `--cs-teal` / `--cs-canvas-grid(-major)` / `--cs-space-*`），跑起来会**安静地显示残缺效果**。
> 现已全部改为派生，并各自带 `tokenProbe()`。

```bash
cd canvas-studio

# ---------- 验证链（改前改后各跑一次；顺序不能变，只认 # fail 0）----------
# 注意：tests/*.mjs 直连 lib/*.js，必须先 build emit。
# 只跑 tsc --noEmit 不 emit → 测试全部 ERR_MODULE_NOT_FOUND（这是踩过的坑）。
node scripts/sync-minimax-skills.mjs
npx tsdown
npx tsc -p tsconfig.json                              # Host，必须 emit
npx tsc -p tsconfig.client.json --emitDeclarationOnly # Client dts
node scripts/verify-client-loader.mjs
node --test "tests/*.test.mjs"                        # 期望 # fail 0（今天 462/462）

# ---------- 以下全部用 node，别用 grep（本机 BSD grep 会静默空返回）----------
node -e '
const s = require("fs").readFileSync("src/client/styles.ts","utf8");
// 只对 var(-- 的 "(" 与 \w 转义；短横线在字符类外是字面量，不用转义。
// 末尾的 (?![\\w-]) 是关键：否则 cs-canvas-grid 会把 cs-canvas-grid-major 也算进去。
const n = t => (s.match(new RegExp("var\\(--" + t + "(?![\\w-])","g"))||[]).length;

// §1.1 引用总量
console.log("— §1.1 引用总量 —");
console.log("var(--dsw-*) 512?", (s.match(/var\(--dsw-/g)||[]).length);
console.log("var(--cs-*)   79?", (s.match(/var\(--cs-/g)||[]).length);
console.log("@keyframes     3?", (s.match(/@keyframes/g)||[]).length);
console.log("!important     0?", (s.match(/!important/g)||[]).length);
console.log("font-size 唯一值:", new Set((s.match(/font-size:\s*([^;}]+)/g)||[]).map(x=>x.replace(/font-size:\s*/,"").trim())).size);

// §1.2 空转令牌 —— 改前基线全为 0。DD-01/02 落地后 cs-ease / cs-canvas-grid /
// cs-canvas-grid-major 已接到引用（变 1），其余（space / duration-base / gold / teal /
// glow-accent）仍在 tests/visual-tokens.test.mjs 的 DEAD_TOKEN_BASELINE 里，由后续批次收敛。
console.log("\n— §1.2 空转令牌（改前基线全为 0）—");
["cs-space-1","cs-duration-base","cs-ease","cs-gold","cs-teal","cs-glow-accent",
 "cs-canvas-grid","cs-canvas-grid-major"].forEach(t => console.log("  " + t.padEnd(24) + n(t)));

// §1.3 四层同色 —— 四行都应是 var(--dsw-alias-bg-base)
console.log("\n— §1.3 四层面板底色 —");
const L = s.split("\n");
[".csFrame",".csCanvas",".csCanvasSurface",".csNode"].forEach(sel => {
  const i = L.findIndex(x => x.trim().startsWith(sel + " {"));
  let j = i, d = [];
  while (j < L.length && !/^}/.test(L[j])) { if (/^\s*background(-color)?:/.test(L[j])) d.push(L[j].trim()); j++; }
  console.log("  " + sel.padEnd(18) + "L" + (i+1) + "  " + d.join(" | "));
});

// §1.8 宿主令牌依赖面（改层级时动的是这些点）
console.log("\n— §1.8 重仓宿主令牌 —");
[["dsw-alias-border-l2",107],["dsw-alias-label-primary",103],["dsw-alias-bg-base",50],
 ["dsw-alias-label-secondary",50],["dsw-alias-label-tertiary",49],
 ["dsw-alias-interactive-bg-hover",37],["dsw-alias-interactive-bg-active",29],
 ["dsw-alias-bg-layer-1",17],["dsw-alias-bg-layer-2",11],["dsw-alias-bg-layer-3",16]]
 .forEach(([t,exp]) => { const got = n(t); console.log("  " + t.padEnd(36) + got + (got===exp?"  ✓":"  期望 "+exp+" ✗")); });
'

# §1.4 网格来源（应看到 1084-1086 两条 linear-gradient）
node -e 'const L=require("fs").readFileSync("src/client/styles.ts","utf8").split("\n");
L.slice(1079,1088).forEach((x,i)=>console.log((1080+i)+": "+x))'

# §1.6 各模块改动面（规则数 / 占用行数）
node -e 'const l=require("fs").readFileSync("src/client/styles.ts","utf8").split("\n");
[".csNode",".csCanvas",".csTimeline",".csWorkflow",".csLobby",".csWelcome",".csChat"].forEach(p=>{
  let r=0,loc=0;
  l.forEach((x,i)=>{ if(x.trim().startsWith(p)&&x.includes("{")){ r++; let j=i;
    while(j<l.length&&!/^}/.test(l[j])){ loc++; j++; } loc++; } });
  console.log(p.padEnd(14), r, loc); });'

# §0-A 宿主层级令牌确实已被引用（证明层级体系已存在，只是画布区没接）
# 见上面 §1.8 一行：bg-layer-1/2/3 = 17/11/16
```

> ⚠️ **本机 `grep` 是 BSD grep，偶发静默空返回**。上面凡涉及"断言某模式为 0"的命令，
> 结果为空时**务必换 `node -e` 或专用搜索工具复核**，别把工具故障当成"确实没有"。
> （今天实测时踩过：一次 `grep` 网格来源返回空，改用 node 重跑才发现 `linear-gradient` 在 1084-1086。）

---

## 10. 待拍板项（收敛为 5 个，均给建议值）

| # | 议题 | 建议 | 影响 |
| --- | --- | --- | --- |
| 1 | **是否拍板启动 DD 批次** | 建议启动，但**先只批 DD-00 + DD-01 + DD-02 三批**，看完第一次桌面验收再决定后续 | 避免一次性批到 DD-06 后中途改向 |
| 2 | **三档明度的具体值** | 建议起点：壳 = 宿主 `bg-base`，画布比壳深 **4~6%**，节点 = 宿主 `bg-layer-1`；**用 `color-mix` 表达**（自动跟主题） | 直接决定 §2.3 原则的达成度；建议截图对比后定值 |
| 3 | **景深 dim 默认开/关 + 幅度** | 建议**默认开、幅度 0.7、设置可关**（原方案 §8-3 同建议；上一轮设计稿实测 0.42 偏重） | 开关落点为 `src/host-config.ts` 新增字段 + `SettingsModal.tsx` 外观区（品牌色板旁），链路已现成 |
| 4 | **DD-04b（真波形）是否投入** | 建议**延后**：先上 04a 骨架。04b 是唯一带 Host ffmpeg 新能力的批次，成本与风险都远高于其余 | 观感差异主要来自骨架；真波形是"锦上添花" |
| 5 | **是否立 CV 条目** | 建议**立**：DD-01 起立 `CV-161` 起（先 grep 全 `docs/` 取号，参考 `CV-123` 撞号教训） | 不立则这批改动在唯一事实来源里查不到 |

> **以上 5 项均已于 2026-09-12 拍板并落地**（DD-00~06 全做完）。DD-04b（真波形）按建议延后。
>
> **DD-08（左栏）的 6 项拍板记录**见 §3 的「DD-08 拍板记录」表（2026-09-14 逐条确认，已闭环，无待定项）。

---

## 附录：与既有文档的边界

| 文档 | 管什么 | 与本文关系 |
| --- | --- | --- |
| `visual-direction-plan.md` | 方向、诊断、批次**设计意图**、硬约束 | **上游**。本文 = 它的工程落地清单（补 §7.2 缺失的那部分） |
| `visual-direction-preview.html` | 交互设计稿（单文件 HTML，可双击看） | **视觉基准**。三档明度、时间轴、审批条的观感以它为准 |
| `brand-identity-proposal.md` | 品牌识别（叫什么/什么色/什么 logo），已定案 | 本文不动品牌识别，只动界面骨架 |
| `canvas-ux-backlog.md` | 交互缺陷（CV 条目技术细节） | 本文不改交互行为，**唯一例外**是 DD-02 退休 CV-035 的网格 workaround |
| `STATUS.md` | **唯一事实来源** | DD-00 负责把本文登记的模块写进 §5 |
| `DEV-WORKFLOW.md` | 验证链、收尾流程、状态变更规则 | 本文 §7/§8/§9 遵循其规定 |
