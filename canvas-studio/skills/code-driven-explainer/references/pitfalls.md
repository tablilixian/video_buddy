# 常见坑（pitfalls）

> 这份分册只收**已实证踩过**的坑，每条按「症状 → 根因 → 修法」写。
> 证据来自科普 0.1 中文版 + 英文重制版两轮真机会话的验收（2026-11-04）。
> **组装 manifest 之前先扫一遍**；验收发现新坑也往这里追加（格式照本册）。
>
> 校验层现在能拦的坑，标了「现在会拦」；拦不住的（语义类）标了「现在只告警」。

## §1 `animate.startFrame` 是**轨内相对帧**，不是绝对帧

**症状**：某一层在成片里完全看不见，但 manifest 里该轨一切合法。

**根因**：`animate.startFrame` / `animate.durationInFrames` 相对于**本轨的第一帧**计数
（轨的第一帧是 0）。把全局时间轴的帧号直接写进 `startFrame` ⇒ 段整体落在轨外，永不命中。

**修法**：段起点换算成 `startFrame = 全局帧 − 轨起点帧`。
现在会拦：**段完全落在轨外 ⇒ error**（`startFrame ≥ 轨长`）；段尾越出轨尾 ⇒ warning（末尾几帧不生效）。

## §2 `animate.durationInFrames: 1` 会把整层钉死

**症状**：层存在、字段合法，却**永远不可见**。

**根因**：`durationInFrames:1` 的段只命中 1 帧，那一帧的插值进度恒为 0 ⇒
`from.opacity:0 → to.opacity:1` 的读数永远是 0。

**实证**：科普 0.1 英文版 `s2_callout` 轨 —— 32 帧轨配 `animate{startFrame:31, durationInFrames:1}`
⇒ 整层 opacity 恒 0。事故原文逐字保留在 `canvas-studio/tests/fixtures/animate-window/real-s2-callout.json`。

**修法**：进场段至少给到能覆盖首帧的时长（惯例 18 帧），且 `startFrame` 落在轨内。
现在会拦：**opacity 维度在轨内全程读到 0 ⇒ error**（`exit` 能把它救回来时除外）。

## §3 `reveal.direction` 是**进场**方向，不是退场方向

**症状**：想「右 wipe 出」，画面却是自右往左展开；或面板整个被遮住。

**根因**：两个方向**不是同一口径**——

| 字段 | 含义 | 隐藏侧（被遮的一侧） |
|---|---|---|
| `reveal.direction`（进场） | 可见区**展开**的行进方向 | **该方向** |
| `reveal.out.direction`（退场） | 内容**退去**的方向 | **该方向的对侧** |

**实证**：科普 0.1 英文版 `s4_rPanel`（右面板）写 `direction:"right"` ⇒ 隐藏侧 = 右 = 本卡所在侧 ⇒ 整层被遮。

**修法**：退场擦除用 `reveal.out`：

```jsonc
"reveal": {
  "kind": "wipe",
  "direction": "right",           // 进场：可见区自右展开
  "out": { "direction": "right" } // 退场：内容朝右退去 ⇒ 隐藏侧 = 左
}
```

退场区间锚在**轨尾**，与 `exit` 同口径。现在只告警：当 `reveal.direction` 指向本卡所在侧时，
提示改用 `reveal.out.direction`（异侧不报；只对 `kind:"wipe"` 生效）。

## §4 `exit` 不支持 clip 退场

**症状**：想用「wipe 出」却只能写 `exit`，写出来的是淡出 / 位移，不是擦除。

**根因**：`exit.to` 只接受视觉状态字段（`x` / `y` / `rotation` / `scale` / `opacity`），**没有 clip**。

**修法**：擦除退场用 `reveal.out`（见 §3）；`exit` 留给「整层淡出 / 缩走 / 位移走」。

## §5 `subtitle` 多行会溢出盒子（是裁切，不是叠字）

**症状**：多行字幕看起来「叠在一起」。逐帧看真相是**裁切**——首行被削成一条线，
第二行只剩后半截（实证：`"0° Equator"` 只剩 `"Equator"`、`"+23.5°N · Solstice"` 只剩 `"Solstice"`）。

**根因**：`subtitle` 变体给了 `text: string[]` 的能力，但排版预算按**整卡**算；
一旦该轨带 `box`，真实容器是**盒子**（更小）⇒ 多行数组放不下 ⇒ 被裁。

**修法**：带 `box` 时按**盒子**算预算（可用宽 / 高 / 基准字号 / 行数上限，字号下限 16px）——
现在由 `TextCard` 的字幕预算统一处理，不带 `box` 的老写法**逐像素不变**。
仍嫌挤就**拆成两条单行轨**。

## §6 ML-04：微幅往复不再豁免

**症状**：为了消一条 lint，给 19 条轨挂上 `scale 0.994↔1.006` 的「呼吸」假动效——
画面没动多少，lint 反而更多。

**根因**：往复豁免以前是「首尾同值即豁免」，太宽 ⇒「加一段假呼吸」成了消告警的**万能钥匙**。
而 1.2% 的缩放幅度人眼根本读不出来，等于拿画面代价换一条 agent 本来就会主动放弃的 warning。

**修法**：豁免改为**幅度门槛**（`movementMagnitude ≥ 1`，换算：x/y 1 个画布百分点、
scale 2%、opacity 0.1、rotation 3°）——幅度看不见的往复照报。**别用假呼吸消 lint。**

## §7 ML-10：按**屏幕时间**算，不按「可动轨」算

**症状**：一条真·静物的片子（本来就是静物讲解）被判「动效不足」。

**根因**：ML-10 的分母原来是「可动轨总时长」，分子的定义也含糊，设计性静物片被误判。

**修法**：现在按**屏幕时间**口径——分子 = `animate` ∪ `exit` ∪ `reveal` ∪ `video` 区间的**并集**，
分母 = **整片时长**，阈值 **0.3**（静态时长占比 > 70% 才算幻灯片）。设计性静物片不再误报；
真·静态图文片仍然会报。

## §8 素材轨 `durationInFrames` 只能来自真值

**症状**：轨道重叠 / 转场失效，宿主按 ffprobe 真值改写时长后把 manifest **拒收**。

**根因**：`video` 轨的 `durationInFrames` 写了估算值。

**修法**：一律取 `list_shots` 的真值（细则见 `references/source-duration.md`）。
宿主复核后改写时长，相邻轨可能不再重叠 ⇒ 转场窗口「完全不相交」而被拒收。
收到就按报错里的真值重排轨道与转场窗口，**不要原样重试**。

## §9 `draw`（路径生长）在非等比画布上退化成断续胶囊

**症状**：`shape:'path'` 加 `draw` 做描边生长，生长**结束后**线条不是实线，而是 ~8 段
断续胶囊（实段 ≈30px / 间隔 ≈15px）。不带 `draw` 的同一条线正常。
（四季片仪表盘弧实拍确认，2026-11-07；取证台 `QR2` 场景复现：带 draw = 8 段、
不带 = 实线，`scripts/render-forensics/out/2026-11-07T09-28-46/`。）

**根因**：Chrome（Electron 43 / Chrome 150 实测）在 `preserveAspectRatio="none"` +
`vector-effect: non-scaling-stroke` 组合下，`stroke-dasharray` / `stroke-dashoffset`
的语义整体坏掉 —— dash 模式与 dasharray 取值（1 / 94.26 / 1000）和 `pathLength`
（有无 / 值）**全都无关**；去掉 non-scaling-stroke 立刻恢复正常（受控浏览器五组
对照实验隔离定案，2026-11-07）。产品 path 轨正是这个组合（0–100 双轴百分比空间
必须 `PA="none"`，等宽描边必须 `VE`），所以 `draw`（= dash 机制）必踩。

**修法**：**不需要绘制动画的线不要传 `draw`**（本片仪表盘弧完全可以首帧即成）；
确需 draw 时接受虚线退化，或等根治批（修法已定案：运行时把原 d 在拉伸空间重采样成
像素坐标 polyline、渲染进等比 viewBox 的 svg —— dash 回到正确语义，等宽由 1:1
像素空间天然保证；统筹方案 Q-A2）。`vectorEffect` 不是元凶，别只删它。
