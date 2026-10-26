# 布局配方（render_composition 分屏 / 画中画等布局直接抄）

`render_composition` 的**非全屏布局**（左右分屏、画中画、底部信息条…）一律先在这里选配方、改参数，**禁止用 `transform.scale` + 位移手算布局**——手算要自己处理画幅换算与中心/左上角坐标系，是布局出错的第一大来源。字段手册见 `code-driven-explainer/references/manifest-contract.md`。

## `box` 语义速记（30 秒）

- `box: {x, y, w, h}`：**0–100 画布百分比；`x` / `y` 是区域中心**（不是左上角！），`w` / `h` 是宽高。
- 铺满全屏 = `{x:50,y:50,w:100,h:100}`；**右半区** = `{x:71,y:50,w:58,h:100}`（区域 [42,100]）。
- 只对 **video / image / textCard / shape** 轨生效；`transition` / `audioViz` 给 box 会被拒收。
- **与位置维度互斥**：同一轨不得再给 `transform.x/y`、`animate.from/to.x/y`、`exit.to.x/y`、`orbit`（`scale` / `rotation` / `opacity` 可同用，绕区域中心生效）。**shape 轨豁免**（沿用其旧语义）。
- 出画布（x−w/2 < 0 或 x+w/2 > 100 等）会被校验拒收，报错信息里带修正算式（shape 轨豁免此查）。
- z 序与 box 无关：**`tracks` 数组顺序 = 叠放顺序**，上层轨写在后面。
- 区域换算口诀：想要区域 [a, b]（水平）→ `w = b−a`，`x = (a+b)/2`；垂直同理。

## 配方 1：split-lr 左右分屏（讲解类最常用）

左文右媒体。参数：`leftRatio` 左区右边界（0.35–0.65，缺省 0.42）、`gap` 中缝（缺省 2）。

```jsonc
// leftRatio=0.42, gap=2 → 左区 [0,42]，右区 [44,100]
{ "type": "textCard", "id": "txt-left", "variant": "bullets",
  "text": ["心率监测", "消息提醒", "数据智能分析"],
  "startFrame": 0, "durationInFrames": 300,
  "box": { "x": 21, "y": 50, "w": 40, "h": 90 } },
{ "type": "video", "id": "<素材节点id>", "src": "/canvas-studio/assets/…",
  "startFrame": 0, "durationInFrames": 300,
  "box": { "x": 72, "y": 50, "w": 56, "h": 100 } }
```

变体：左区要大标题用 `"variant": "title"`；右区放图用 `image` 轨（`fit: "contain"` 留边、缺省 cover 裁满）。左右互换即把两个 box 的 x/w 对调。

## 配方 2：split-tb 上下分屏

上媒体下文字。参数：`topRatio` 上区底边界（缺省 0.58）。

```jsonc
// topRatio=0.58 → 上区 [2,58]，下区 [62,96]（各留 2% 呼吸边）
{ "type": "video", "id": "<素材节点id>", "src": "/canvas-studio/assets/…",
  "startFrame": 0, "durationInFrames": 300,
  "box": { "x": 50, "y": 30, "w": 100, "h": 56 } },
{ "type": "textCard", "id": "txt-bottom", "variant": "bullets",
  "text": ["…"], "startFrame": 0, "durationInFrames": 300,
  "box": { "x": 50, "y": 79, "w": 92, "h": 34 } }
```

## 配方 3：picture-in-picture 画中画

主画面铺满 + 右下小窗。参数：小窗中心 `pipX`/`pipY`（缺省 78/76）与 `pipW`/`pipH`（缺省 34/38）。

```jsonc
{ "type": "video", "id": "<主画面节点id>", "src": "/canvas-studio/assets/…",
  "startFrame": 0, "durationInFrames": 300 },            // 不写 box = 铺满
{ "type": "video", "id": "<小窗节点id>", "src": "/canvas-studio/assets/…",
  "startFrame": 0, "durationInFrames": 300,
  "box": { "x": 78, "y": 76, "w": 34, "h": 38 } }        // 区域 [61,95]×[57,95]
```

小窗建议后声明（在上层）；给小窗轨加 `"animate": {"from":{"opacity":0,"scale":0.6},"to":{"opacity":1,"scale":1}}` 可做弹入（scale/opacity 与 box 可同用）。

## 配方 4：lower-third 底部信息条

```jsonc
{ "type": "textCard", "id": "txt-lower", "variant": "subtitle",
  "text": "凌晨三点的监控画面", "startFrame": 30, "durationInFrames": 120,
  "box": { "x": 50, "y": 82, "w": 86, "h": 20 } }        // 区域 [7,93]×[72,92]
```

`subtitle` 变体不加 box 时本来就贴整幅画布底部；加 box 后改为贴**盒子**底部、条宽随盒子走。

## 配方 5：full-bleed 全屏

铺满就是**不写 box**（与 `{x:50,y:50,w:100,h:100}` 等价）；只想要「全屏但留安全边」时用 `{x:50,y:50,w:94,h:94}` 这类微缩盒。

## 配方 6：window↔fullscreen 窗口与全屏切换（2026-10-26 真渲验证）

`box` 是**静态声明**——「小窗 → 全屏 → 回小窗」没有平滑缩放过场，正确做法是**按阶段拆成多条轨**，硬切：

```jsonc
// 同一素材 X（12s），三阶段各一条轨；同源分段用 trimBeforeFrames 保证播放连续
// （单位=帧，从素材第 N 帧起播）。三段声明时长都必须 ≤ 素材总长 − trimBefore。
{ "type": "video", "id": "news-win", "src": "/canvas-studio/assets/X.mp4",
  "startFrame": 0, "durationInFrames": 90,
  "box": { "x": 71, "y": 32, "w": 50, "h": 56 } },                      // 阶段1：右上小窗
{ "type": "video", "id": "news-full", "src": "/canvas-studio/assets/X.mp4",
  "startFrame": 90, "durationInFrames": 90, "trimBeforeFrames": 90 },   // 阶段2：全屏（无 box）
{ "type": "video", "id": "news-back", "src": "/canvas-studio/assets/X.mp4",
  "startFrame": 180, "durationInFrames": 90, "trimBeforeFrames": 180,
  "box": { "x": 71, "y": 32, "w": 50, "h": 56 } }                       // 阶段3：回小窗
```

要点：全屏段**不写 box**；z 序靠轨序——全屏段要压住其它轨就把它排到 `tracks` 数组后面；「播音员同步出现/全屏」同理拆轨。若素材是按镜头生成的独立片段（推荐），每段直接用各自 `src`、声明=真实时长，不需要 `trimBeforeFrames`。

## 配方 7：shape 柱状图（animate 必须把 x/y 写全）

```jsonc
// 三根柱子 = 三条 shape:rect 轨；animate 生长动画**必须同时显式给 from/to 的 x 和 y**
// —— 只给 y 时 x 走 box 落点（逐轴回退），但把 x 显式写全是零歧义写法。
{ "type": "shape", "id": "bar-2024", "shape": "rect", "color": "#38bdf8",
  "startFrame": 0, "durationInFrames": 300,
  "box": { "x": 78, "y": 74.5, "w": 8, "h": 23 },
  "animate": { "from": { "x": 78, "y": 86 }, "to": { "x": 78, "y": 74.5 } } }
```

年份/数值标签用 `subtitle` 文本条（见下方边界：文字要用**大盒子贴设计尺寸**，别塞进小区域）。

## 已知边界（抄配方前看一眼）

- `dataCard` 卡片本体固定 940px 宽：盒宽折算后 <1000px（约 `w<78`，16:9 1280 宽）会被裁边——dataCard 只配宽盒或整幅。
- `textCard` 的字号自适应按**画布宽度**估算可用宽度：盒子明显窄于估算宽时文字会溢出被裁——窄盒优先用 `bullets` 短行，别塞长句。
- **textCard 的 box 只裁不缩**（2026-10-26 压测实证）：`subtitle`（layer padding 72px / 字号 44px）、`title`（84px）、`dataCard`（卡宽 940px）内部按全屏设计，盒宽 < 约 60% 必裁字；且这些像素常量不随分辨率缩放。**文字条一律给大盒子**（横贯条 `w≥86`、大标题 `w≥50`），小区域标签当前表达不了——宁可不做，不要交付裁字的卡。
- `image` 轨的 `caption` 仍贴**整幅画布**底部（不进盒子）；区域化文字请用 textCard 轨。
- `shape:'path'` 铺满画布，`box` 不生效（校验给 warning）。

## 配方截图（验收锚点）

`assets/layout-demos/` 下每配方一张真实渲染截图（split-lr.png / split-tb.png / picture-in-picture.png / lower-third.png）。**尚未生成**：首次真机验收时用各配方的示例 manifest 以 `quality:"draft"` 渲一次并把抽帧落进去——截图必须来自真实渲染产物，不许手画。
