# 动画时序与素材语义（引擎实现事实）

> 这份补的是 `manifest-contract.md` 里**读不出来**的那一层：字段写了会怎样。
> 每一条都来自读源码，不是从字段名推测的 —— 会话 #5 里 agent 为了回答这几个问题
> 读了 24 次源码、触发 5 次压缩。
>
> 对码守卫：`tests/manifest-contract-doc.test.mjs`（本文件里的短语被钉住，源码改了没跟即红）。

---

## 1. 逐字 / 逐词动画（`textCard.anim`）

实现：`src/remotion/timing.ts` 的 `textUnitProgress()` + `splitTextUnits()`。

| 事实 | 说明 |
|---|---|
| **单元怎么切** | `typewriter` → **逐字符**（`[...text]`，空格也算一个单元）；其余预设 → 拉丁文按空格整词、CJK **逐字**、空白单独成单元 |
| **第 N 个单元何时出现** | 起始帧 = `wordDelayFrames × index`（`index` 从 0 起）；`wordDelayFrames` 缺省：`typewriter` = **1**，其它 = **3** |
| **单元素入场多久** | `unitDurationInFrames`，缺省 **12 帧** |
| **进度曲线** | `easeOutCubic`，`raw ≤ 0 → 0`、`raw ≥ 1 → 1`，中间缓动 |
| **整卡 vs 逐行** | 这套只作用在**一个文本单元序列**里；`bullets` 的 `typewriter` 是**整卡帧推进**，要逐行打字必须**拆成多条轨** |

**推算示例**（30fps、`typewriter`、10 个字、`unitDurationInFrames` 缺省 12）：
第 1 个字在 frame 0 开始、frame 12 满；第 10 个字在 frame 9 开始、frame 21 满。
⇒ **整句打完只需要 ≈0.7s**，不是"每字 12 帧"。要慢，调 `wordDelayFrames` 而不是 `unitDurationInFrames`。

**禁止**用 CSS animation 做这类效果：逐帧截图走真实时钟，CSS 动画会让同一 manifest 渲两次结果不同（`timing.ts` 顶部注释写明了这条）。

---

## 2. 图片轨（`image` / `ImageClip`）

实现：`src/remotion/components/ImageClip.tsx`。

| 字段 | 事实 |
|---|---|
| `fit` 缺省 | **`cover`**（`contain` 才完整显示，两侧留黑） |
| `fit:'kenburns'` | 在**整条轨**的 `durationInFrames` 内把 scale 从 **1.0 → 1.08** 线性推上去（`1 + 0.08 × frame/duration`）；`objectFit` 仍走 `cover` |
| **`kenBurns: true` 是死字段** | 类型里有、实现从不读。要缓推必须写 `fit:'kenburns'` |
| KenBurns 与入场缩放 | KenBurns 作为 `extraScale` 与 `animate` 的 `scale` **相乘** ⇒ "缓推 + 入场缩放"可以叠加 |
| `animate` 的缩放字段 | 只有等比 **`scale`**，**没有 `scaleX` / `scaleY`**；写错不报错、不生效 |
| 尺寸来源 | 轨道铺满画布（`AbsoluteFill`），图片本身 `width/height:100%` + `objectFit` ⇒ **没有"图片原始尺寸"这条路**，要局部显示必须用 `box`（中心语义百分比）裁出那块区域 |
| 底色 | 组件自带 `backgroundColor:#05080f`（没铺满时的背景不是透明） |
| **`src` 不接受 `@ref[...]`** | manifest 里的 `src` 必须是同源资产 URL（`/canvas-studio/assets/…`）或项目资产目录内的绝对路径。`@ref` 只在**工具入参层**被解析，写进 manifest 会被校验器拒收 |
| **`exit.to` 必填** | 退场是 `exit: { to: {...}, durationInFrames?, easing?, gapFrames? }` —— `to` 是**必填**终点状态（只写想变的维度），没有 `mode` 这种字段；`durationInFrames` 缺省按入场时长 0.6 倍推导 |

---

## 3. 素材可用性（`asset-check`）

实现：`src/remotion/asset-check.ts`（**宿主侧、无浏览器**）。

| 事实 | 说明 |
|---|---|
| 核对什么 | ① 同源资产 URL → 本地文件（`urlToAssetPath`）后 `existsSync`；② `video` 轨用 ffmpeg 探**真值时长与真实像素** |
| 缺失怎么处理 | **硬失败**（`missing` 非空 ⇒ `CS-USER-ERR`），不放行到渲染 —— 否则用户只会看到一条没有上下文的客户端渲染失败 |
| 为什么宿主能做 | route B（CSR）下渲染页与素材**同源**，宿主不拷素材；真正的解码发生在 Electron 渲染进程 |
| 真值时长的影响 | 会用来校正「声明帧数 vs 真值」（`reconcileManifestVideoDurations`）⇒ `video` 轨的 `durationInFrames` 写小了不会截断，写大了会被真值压回 |
| 像素的影响 | 供分辨率检查判「素材被上采样进成片」（写 4K 出 720p 素材会告警） |
| `asset-gc` 的边界 | 只**登记**孤儿素材不物理删除（CV-364）⇒ 文件消失通常是外部清理，报错会带「同目录相近文件」提示 |

---

## 4. 形状几何（`shape`）

实现：`src/remotion/shape-geometry.ts`。

| 事实 | 说明 |
|---|---|
| `box` 语义 | **中心**：`x/y` 是形状中心、`w/h` 是宽高（画布百分比）—— 与 `render_composition` 的 `box` 同口径 |
| `star` | 顶点数 `points`（缺省 5）、内半径比 `innerRatio` 缺省 **0.45**、起始角 **-90°**（正上方起步） |
| `polygon` | `sides` 条边、起始角 **-90°**；`triangle` = `sides:3` |
| 非等比 | `w ≠ h` 时形状被**拉伸**（不做等比约束）；要正圆/正多边形必须让 `w/h` 与画布比例匹配 |
| 可动画性 | `box` 本身**不能被 animate**；但 `animate` 的 `x/y` 会**覆盖** `box.x/y`（两者同时写时以后者为准） |
| `arrow` | 固定水平向右的箭头，方向靠轨道 `transform.rotate` 改 |
| **`shape:'path'` 必须给 `d`** | SVG path 字符串，坐标空间是 **0–100 双轴百分比**（非等比、`preserveAspectRatio="none"`）；缺 `d` 直接拒收 |

---

## 5. 分组坐标（`groups`）—— 写的时候不用算全局坐标

> 用户原话（2026-10-25 会话 #5 @143min）：「表盘跟里面的内容做到一起，是不是就不用考虑全局变换坐标了啊？」

**怎么写**：顶层声明 `groups`，成员轨用 `group` 引用组 id，**组内坐标一律是 0–100 相对该组**。

```jsonc
{
  "groups": [{ "id": "dial", "box": { "x": 70, "y": 50, "w": 40, "h": 80 } }],
  "tracks": [
    { "id": "ring", "type": "shape", "shape": "circle", "color": "#0EA5E9", "group": "dial",
      "box": { "x": 50, "y": 50, "w": 100, "h": 100 }, "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0 },
    { "id": "label", "type": "textCard", "variant": "subtitle", "text": "62 bpm", "group": "dial",
      "box": { "x": 50, "y": 72, "w": 80, "h": 16 }, "startFrame": 6, "durationInFrames": 84, "fadeFrames": 0 }
  ]
}
```

上例：`ring` 组内 (50,50) 100×100 ⇒ 铺满组；`label` 组内 y=72 ⇒ 组高度的 72% 处。
**改组的 box 一处，两个元素一起移动** —— 这就是"不用管全局坐标"的意思。

| 事实 | 说明 |
|---|---|
| 展开在哪发生 | **宿主侧**（`render_composition` 入口，`src/remotion/groups.ts`）⇒ 渲染器 / 校验器 / 客户端都看不到 `groups` |
| 组 `box` 语义 | 画布百分比、`x/y` 是中心（与所有 `box` 同口径） |
| 成员轨的 `box` | **组内 0–100**（不是画布百分比）；超过 0–100 允许（刻意越界出画面），不钳制 |
| **只作用于 `box`** | `animate` 的 `x`/`y` 始终是画布绝对百分比 —— 组的展开不改动效轨迹（否则"从组外飞入"就做不出来） |
| **不支持嵌套** | 组套组会让"这个百分比相对谁"变成推理题；需要两层就在外层预先算好 |
| 硬约束 | 组内轨**必须自带 `box`**；引用不存在的组会被**拒收**（不静默按原样渲） |
| 没写 `groups` | 老 manifest 像素级不变（不做任何处理） |

---

## 6. 一句话总结（写 manifest 时的五条纪律）

1. 动效**只用 manifest 字段**，不用 CSS。
2. 慢速揭示调 `wordDelayFrames`，不要拿 `unitDurationInFrames` 当"每字时长"。
3. 图片要缓推写 `fit:'kenburns'`，不要写 `kenBurns:true`。
4. 要局部显示图片/形状，用 `box` 中心语义百分比；没有"按原始尺寸摆放"这条路。
5. 一组元素要一起移动（表盘 + 里面的文字），用 `groups` 写组内坐标 —— 别在每个轨上手算全局百分比。
