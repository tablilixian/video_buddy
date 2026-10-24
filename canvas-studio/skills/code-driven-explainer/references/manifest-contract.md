# CompositionManifest 契约（组装必读）

`render_composition` 的 manifest 入参二选一：字段 `manifest`（一段 JSON 字符串），或字段 `manifestPath`（manifest JSON 文件的**绝对路径**）。本文是该结构的字段手册与硬约束；上游口径见 `skills/canvas-studio-creation/references/toolchain.md`。

**长片必须走 `manifestPath`**：先把 manifest 写进项目内文件（如 `build/manifest.json`），再把绝对路径传给 `manifestPath`。原因：内联 JSON 过大时会被工具入参截断——宿主的「尾部完整性校验」会拦下缩水的 manifest（`meta.durationInFrames` 必须 = 全部轨道的最大结束帧，少一帧都报 `CS-USER-ERR`），但那已经浪费了一轮调用；文件通道没有入参体积风险。短 manifest（草稿迭代）内联即可。

**时长自洽是硬约束**：组装完成时自查一遍 `meta.durationInFrames == max(track.startFrame + track.durationInFrames)`（字幕末句卡与收尾轨都应到达总时长），不成立先自己改对再调用——别等宿主报「尾部完整性校验失败」再返工。

## 顶层结构

```jsonc
{
  "id": "cmp-0001",              // 唯一 id（便于血缘与重试）
  "meta": {
    "title": "全球老龄化速览",
    "width": 1280,               // 与画幅对齐：16:9 用 1280×720 或 1920×1088
    "height": 720,
    "fps": 30,
    "durationInFrames": 900,     // 总帧数 = max(track.startFrame + track.durationInFrames)
    "backgroundColor": "#0B1020"
  },
  "tracks": [ /* 见下 */ ],
  "audio": {                     // 可选
    "bgmUrl": "/canvas-studio/assets/p1/bgm.mp3",
    "voiceOverUrl": "/canvas-studio/assets/p1/vo.mp3",
    "mix": { "bgmVolume": 0.35, "voiceVolume": 1 }
  },
  "global": {                    // 可选
    "fontFamily": "Source Han Sans SC",
    "theme": "dark",
    "brandColor": "#3B82F6"
  }
}
```

> `audioComposition`（成片角标）**不是** manifest 输入：它由宿主在校验通过后派生，你不要产出该字段。

## 轨道共同字段

每条轨道都有 `id` / `startFrame` / `durationInFrames` / `type`：

- `startFrame`：≥ 0 的整数（帧）。
- `durationInFrames`：正整数（帧）。
- `id`：唯一。**video / image 轨的 `id` 必须是该素材的画布节点 id**（宿主据此产出血缘）；textCard / shape / transition 用本地 id 即可。
- `transform`（可选）：**静态姿势** —— `{ "x"?, "y"?, "scale"?, "rotation"? }`。`x` / `y` 是 0–100 的
  画布百分比坐标（50 = 居中），`scale` 必须 > 0，`rotation` 单位是度。**六种轨通用**。
- `animate`（可选）：**帧级动画** —— 一条，或一个数组（多条按顺序叠加，后者覆盖它声明过的维度）。
- `orbit`（可选，二期）：**公转** —— 绕某点做圆周运动，见下节。与 `transform` / `animate` 的
  `x` / `y` **互斥**（同一条轨只能有一处决定位置，同时写直接校验失败）。
- `fx`（可选，二期）：**视觉效果** —— `glow` / `stroke` / `shadow` / `blur` / `maskFade`，见下节。
- `fadeFrames`（可选）：首尾淡入淡出帧数 —— `0` = 硬切；缺省 6。`subtitle` 卡缺省即 `0`。
- `exit`（可选，三期）：**退场** —— 片尾/离场怎么走，见「三期：编排与质感」节。有它时
  `fadeFrames` 的**尾部**淡化自动让位（只保留首部），不会双淡出。
- `startAfter`（可选，三期）：**顺序衔接** —— 用「接在上一轨之后」代替手算绝对帧号，
  与 `startFrame` **互斥**（同时写直接报错）。`gapFrames` 负数 = 与上一轨**重叠**（转场必用）。
- `blend`（可选，三期）：`normal` / `screen` / `multiply` / `overlay` / `soft-light` —— 图层混合模式。
- `colorShift`（可选，三期）：颜色随帧过渡（`shape.color` / `textCard.accentColor` / `audioViz.color`）。

## 帧级动画 `animate`

**画面不动就是幻灯片。** 这一节是"让东西动起来"的唯一入口。

```jsonc
{
  "from": { "x": 115, "opacity": 0 },   // 起点（必填）
  "to":   { "x": 50,  "opacity": 1 },   // 终点（必填）
  "startFrame": 0,                       // 轨内相对帧，缺省 0
  "durationInFrames": 18,                // 动画时长（帧），缺省 = 整轨长
  "easing": "easeOutCubic"               // 13 档白名单，见「三期：编排与质感」节（缺省 easeInOut）
}
```

`from` / `to` 里可写 `x` / `y` / `scale` / `rotation` / `opacity` 的任意组合。

三条要诀：

1. **要动的维度，`from` 与 `to` 都写**。只写一边时另一边取 `transform` 的值；两边都没有则取该维度的缺省
   （`x`/`y` = 50、`scale` = 1、`rotation` = 0、`opacity` = 1）。只动 `x` **不会**影响 `scale`。
2. **不要用 CSS 动画的思路**：契约里没有 `@keyframes` / `transition`。逐帧渲染要求"同一帧号永远同一画面"，
   所以只接受这种声明式插值。要往复（脉动 / 呼吸）就写**两条首尾相接的 `animate`**。
3. `startFrame` 是**轨内相对帧**（不是全片帧）。多个元素"依次出场"= 各轨错开自己的 `startFrame`，
   各自的 `animate` 从 0 开始即可。

三个可直接照抄的例子：

```jsonc
// ① 要点卡从画面右侧滑入（"依次出场"就是每张卡错开 startFrame + 同样的 animate）
{ "type": "textCard", "id": "pt-1", "startFrame": 90, "durationInFrames": 120,
  "variant": "bullets", "text": ["木星直径约为地球的 11 倍"],
  "animate": { "from": { "x": 115, "opacity": 0 }, "to": { "x": 50, "opacity": 1 }, "durationInFrames": 18 } }

// ② 尺寸对比：行星圆从小到大长到目标尺寸
{ "type": "shape", "id": "jupiter", "startFrame": 60, "durationInFrames": 150,
  "shape": "circle", "color": "#E8B26A", "box": { "x": 30, "y": 50, "w": 22, "h": 22 },
  "animate": { "from": { "scale": 0.4 }, "to": { "scale": 1 }, "durationInFrames": 24 } }

// ③ 周期往复（脉动 / 呼吸）：两条首尾相接的 animate
{ "type": "shape", "id": "sun-pulse", "startFrame": 0, "durationInFrames": 900,
  "shape": "circle", "color": "#F6C445", "box": { "x": 50, "y": 50, "w": 14, "h": 14 },
  "animate": [
    { "from": { "scale": 1 },    "to": { "scale": 1.08 }, "startFrame": 0,  "durationInFrames": 30 },
    { "from": { "scale": 1.08 }, "to": { "scale": 1 },    "startFrame": 30, "durationInFrames": 30 }
  ] }
```

**讲"过程 / 关系"怎么落**（比逐个元素硬编码更省事的四种套路）：

| 想表达的 | 怎么写 |
| --- | --- |
| 多个元素**依次出场** | 各轨错开 `startFrame`，`animate` 都从 0 开始 |
| **尺寸 / 数量对比** | 各元素的 `to.scale` 按比例给不同值（起始可都相同） |
| **周期往复**（脉动 / 呼吸 / 闪烁） | 数组里给两条首尾相接的 `animate` |
| **绕中心转圈**（公转 / 环绕） | **用 `orbit` 一行声明**（见下节），不要手算关键帧 |

## 公转 `orbit`（二期 A1 · 关系类动画的一等声明）

```jsonc
{ "type": "shape", "id": "earth", "startFrame": 0, "durationInFrames": 300,
  "shape": "circle", "color": "#4EA8DE", "box": { "x": 0, "y": 0, "w": 6, "h": 6 },
  "orbit": { "center": { "x": 50, "y": 50 }, "radius": 26, "startAngle": -90, "periodInFrames": 300, "direction": "ccw" } }
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `center` | ✓ | 圆心 `{x,y}`，0–100 百分比坐标（与 `transform.x/y` 同域） |
| `radius` | ✓ | 半径，`(0, 100]`，百分比单位（画布宽的百分比） |
| `startAngle` | | 起始角（度）。**0° = 正右**，角度增大 = 顺时针（屏幕 y 向下）；缺省 0 |
| `periodInFrames` | | 转一圈的帧数（> 0）。缺省 = 本轨 `durationInFrames`（即整轨正好一圈） |
| `direction` | | `cw`（顺时针，缺省）/ `ccw` |

要诀：

1. **位置三选一，不许叠加**：一条轨的位置来源只能是 `orbit`、或 `transform`/`animate` 的 `x`/`y`、
   或都不写（缺省居中）。**同时声明 `orbit` 与 `x`/`y` 会直接校验失败**（报错会点名该轨）。
   需要"边公转边改变自身尺寸/透明度"是合法的 —— `scale` / `rotation` / `opacity` 不受限制。
2. `box` 仍要给（决定形状自身多大），但它的 `x` / `y` 会被 `orbit` 覆盖 —— 直接写 `0` 即可。
3. 多颗星同向公转 = 各自 `orbit` 给不同 `radius` / `startAngle`，`periodInFrames` 按开普勒式
   比例给（内圈快、外圈慢）看起来更真；要"同一面朝向观众"就不要加 `rotation` 动画。

## 视觉特效 `fx`（二期 A2）

```jsonc
{ "type": "textCard", "id": "t1", "startFrame": 0, "durationInFrames": 120,
  "variant": "title", "text": "全球老龄化", "fx": "glow" }
```

| `fx` | 效果 | 典型用法 |
| --- | --- | --- |
| `glow` | 冷蓝外发光（文字带辉光） | 标题、发光数据点 |
| `stroke` | 文字描边 + 投影（深色描边压亮背景） | 亮底上的白字字幕 |
| `shadow` | 较大范围柔和投影 | 卡片 / 图形浮起 |
| `blur` | 轻微模糊（3px） | 背景层虚化、失焦前后景 |
| `maskFade` | 底部渐隐遮罩 | 波形条 / 列表底部淡出 |

**单值枚举，不写数组**（组合会让画面失控）。给哪条轨都行（六种轨通用）；`fx` 与 `fadeFrames` 可叠加。

⚠️ 曲线与路径的**唯一**合法写法：圆周运动用 `orbit`，SVG 路径用 `shape:"path"` + `d` + `draw`（见下节）。
别写 `bezier` / `keyframes` / `motionPath` 这类字段 —— 它们不在契约内，**不会生效**，宿主会把它们列进
`warnings` 回传（看到这类 warning 请照本手册改字段名，不要当成"已经生效"）。

## 六种轨道

### `video`（素材视频）

```jsonc
{ "type": "video", "id": "<画布节点 id>", "startFrame": 0, "durationInFrames": 150,
  "src": "/canvas-studio/assets/p1/clip.mp4", "kenBurns": false }
```

`durationInFrames` 必须按 `list_shots` 的真值取整（见 `references/source-duration.md`）。

三期加的五个媒体字段（**都是可选**，不写 = 与以前完全一样）：

| 字段 | 说明 |
| --- | --- |
| `trimBeforeFrames` | 从素材第几帧开始用（≥0 整数，**输出帧号域**）。一条 8s 素材只用其中 2.5s 就靠它 |
| `playbackRate` | 播放速率 `(0.1, 4]`。`0.5` = 慢动作，`2` = 快放 |
| `muted` | `true` = 关掉这段素材的原声（默认开声） |
| `volume` | 素材原声音量 0–1（与 `muted` 二选一即可；`muted:true` 优先） |
| `loop` | `true` = 素材比轨道短时循环填满 |

⚠️ `trimBeforeFrames + durationInFrames × playbackRate` 不能超过素材真实时长 —— 超了尾部会是黑帧。
拿不准就先用 `list_shots` 看真值。

### `image`（静态图）

```jsonc
{ "type": "image", "id": "<画布节点 id>", "startFrame": 150, "durationInFrames": 90,
  "src": "/canvas-studio/assets/p1/still.png", "fit": "cover", "caption": "图注" }
```

`fit` 取 `cover`（默认，填满）/ `contain`（留边）/ `kenburns`（缓推）。

### `textCard`（字幕卡 / 数据卡 / 标题卡 / 要点）

```jsonc
{ "type": "textCard", "id": "sub-1", "startFrame": 0, "durationInFrames": 120,
  "variant": "subtitle", "text": "世界人口已突破 80 亿", "accentColor": "#F59E0B" }
```

- `variant` 取 `subtitle` / `dataCard` / `title` / `bullets`。
- `text`：字符串，或字符串数组（`bullets` 每行一条）。
- `data`：仅 `dataCard` 用，键值对数组，如 `[{ "k": "全球老龄化", "v": "16%" }]`。
- **`subtitle` 的 `durationInFrames` 是屏上时长**：相邻字幕卡必须**首尾相接**（每句延伸到下一句
  `startFrame`，末句到总帧），不留空白帧 —— 详见 `references/subtitle-timing.md`。
- `subtitle` 缺省**硬切**（等价于写 `fadeFrames: 0`），避免句间接缝闪背景；`title` / `dataCard` /
  `bullets` 缺省保留淡入淡出（6 帧）。要改就显式写 `fadeFrames`（`0` = 硬切，值越大越柔）。
- **三期 · 文本动效**（`anim`，可选；缺省 = 整块按 `fadeFrames` 淡入，与以前一样）：

| `anim` | 观感 | 适合 |
| --- | --- | --- |
| `fadeUp` | 整体上浮淡入 | 标题、结论句 |
| `maskReveal` | 自上而下揭开（遮罩） | 大标题、金句 |
| `typewriter` | 逐字打出（带光标） | 引语、数据揭示 |
| `wordStagger` | 逐词落位 | 标题、要点 |

  `animOptions` 可微调：`{ "wordDelayFrames": 3, "offsetY": 14, "blur": 4 }`（词间延迟 / 上浮距离 px / 起始模糊 px）。
  ⚠️ 动效作用于**整张卡**，不要为了让它动而把一句话拆成多张卡（拆了反而丢了对齐与断行）。

### `shape`（形状 / 色块 / 路径）

```jsonc
{ "type": "shape", "id": "bg-1", "startFrame": 0, "durationInFrames": 900,
  "shape": "gradient", "color": "#111827", "box": { "x": 50, "y": 50, "w": 100, "h": 100 } }
```

`shape` 取 `rect` / `circle` / `line` / `gradient` / `arrow` / `triangle` / `star` / `polygon` / `path`；
`box` 按画布百分比（0–100）给出**形状中心与宽高**：`x` / `y` 是中心点（实现是 `left/top` +
`translate(-50%,-50%)`），`w` / `h` 是宽高。**铺满全屏用 `50,50,100,100`**；写成 `0,0,100,100`
只会铺左上四分之一（片头卡大面积纯黑就是这个原因）。`arrow` / `triangle` / `star` / `polygon` 与 4 种基础形状用法
完全相同（`box` + `color`），几何由宿主纯函数算顶点，`polygon` 额外可给边数：

```jsonc
{ "type": "shape", "id": "tri", "startFrame": 30, "durationInFrames": 90,
  "shape": "triangle", "color": "#F59E0B", "box": { "x": 70, "y": 40, "w": 8, "h": 8 } }
```

**`shape:"path"`（二期 · 路径生长）** —— 画箭头轨迹、示意图轮廓、手绘风线条：

```jsonc
{ "type": "shape", "id": "route", "startFrame": 60, "durationInFrames": 120,
  "shape": "path", "color": "#7DD3FC", "strokeWidth": 0.8,
  "d": "M 12 74 C 32 40, 58 88, 86 30",
  "draw": { "to": 1, "durationInFrames": 90, "easing": "easeInOut" } }
```

- `d` **必填**，坐标空间是 **0–100 的双轴百分比**（`viewBox="0 0 100 100"` + `preserveAspectRatio="none"`），
  与 `box` 同域。注意它**非等比**：16:9 画布上，x 方向 10 个单位比 y 方向 10 个单位长 16/9 倍。
  画"正圆感"的曲线要按画幅比补偿（16:9 时 `rx : ry ≈ 1 : 0.5625`）。
- `strokeWidth`：描边宽度，百分比单位（缺省 `0.5`，相对 100 单位盒）。
- `draw`：描边从无到有的生长 —— `to`（0–1，缺省 1）、`startFrame`（轨内相对帧，缺省 0）、
  `durationInFrames`（缺省 = 整轨）、`easing`（同 `animate` 白名单）。区间之前不画、之后恒为 `to`
  （端点收敛，不跳变）。
- `path` 轨**不需要 `box`**（`transform` 的 x/y 仍可用来整体挪位置）。给非 `path` 形状写 `d` / `draw`
  不报错，但会收到"只在 shape:'path' 上生效"的 warning。

### `transition`（转场）

```jsonc
{ "type": "transition", "id": "tr-1", "startFrame": 140, "durationInFrames": 20,
  "effect": "fade", "fromTrackId": "clip-a", "toTrackId": "clip-b" }
```

`effect` 取 `fade` / `slide` / `zoom` / `dissolve` / `wipeLeft` / `wipeRight` / `clock` / `flipX`：

| effect | 观感 |
| --- | --- |
| `fade` / `dissolve` | 淡入淡出（`dissolve` 更柔） |
| `slide` | 后一轨从右侧推入 |
| `zoom` | 推近切换 |
| `wipeLeft` / `wipeRight` | **硬边擦除**（幕布左→右 / 右→左推进）—— 章节切换、时间线推进 |
| `clock` | **扇形扫描**（钟表指针式转场）—— 数据揭晓、循环感 |
| `flipX` | **横向翻面**（3D 翻转）—— 前后对照、卡片翻页 |

`fromTrackId` / `toTrackId` 必须指向**真实存在且互不相同**的两条轨道；两轨**必须重叠**——首尾相接（无重叠）会退化为硬切（warning），完全不相交会直接报错。

**三期参数化三个可选字段**（不写 = 与以前逐像素一致）：

| 字段 | 说明 |
| --- | --- |
| `easing` | 转场推进的缓动，白名单同 `animate`（缺省线性 —— 保住老片子观感） |
| `softness` | `0`–`1`。`> 0` 时把**硬边擦除换成软边渐变**（只对 `wipeLeft` / `wipeRight` 生效）。`0.3`–`0.4` 就明显「贵」一档 |
| `direction` | `left` / `right` / `up` / `down`（只对 `slide` / `wipe` 生效；缺省按效果自身语义） |

⚠️ `softness` 上了 `0.8` 以上基本看不出在擦除（等于是个淡入），**0.2–0.45 是可用区间**。

### `audioViz`（音频可视化，二期 B1）

```jsonc
{ "type": "audioViz", "id": "wave", "startFrame": 0, "durationInFrames": 600,
  "src": "/canvas-studio/assets/p1/bgm.mp3", "bars": 32, "mode": "mirror",
  "gain": 1.6, "heightPercent": 24, "position": "bottom", "color": "#38BDF8", "fx": "maskFade" }
```

柱高由音频真实振幅驱动（客户端解码 → 纯函数按帧取样），所以**同一 manifest 渲两次柱高完全一致**。

| 字段 | 缺省 | 说明 |
| --- | --- | --- |
| `src` | 必填 | 音频资产 URL（同源约束同上） |
| `bars` | 24 | 柱数，1–128 整数 |
| `mode` | `bars` | `bars` 单向 / `mirror` 上下对称 / `line` 连续波形线（三期） |
| `gain` | 1.6 | 振幅增益 0–4（人声比配乐轻，给 1.4–2.2） |
| `heightPercent` | 30 | 波形区高度（占画布高百分比） |
| `position` | `bottom` | `bottom` / `top` |
| `color` | 主题蓝 | 柱色 |
| `smoothing` | 0 | 三期：帧间指数平滑 0–0.9。低帧率素材或抖动明显的曲子给 0.3–0.5 |
| `gradient` | 无 | 三期：柱体渐变 `{ "from": "#38BDF8", "to": "rgba(0,0,0,0)" }` |

用法要点：波形轨放 `tracks` 数组**靠后**（后写在上层）；配 `fx:"maskFade"` 让底部自然淡出；
`durationInFrames` 不必等于音频总长（超出部分按静音画基线）。

## 三期新增：编排与质感（速查）

这一节是「让片子从网页截图变成成片」的全部开关。**所有字段都可选，不写 = 与二期逐像素一致**，
所以老 manifest 不用改；但新做的片子不写这些，观感就还停在二期。

### 全片调色 `meta.look`（最省事的一次观感升级）

```jsonc
"meta": {
  "look": { "contrast": 1.06, "saturation": 1.12, "brightness": 1.02,
            "temperature": 0.12, "vignette": 0.35, "grain": 0.16 }
}
```

| 字段 | 缺省 | 范围 | 说明 |
| --- | --- | --- | --- |
| `contrast` | 1 | 0–4 | 对比度，`1.06` 起步就够（过 1.3 容易死黑/死白） |
| `saturation` | 1 | 0–4 | 饱和度，`1.1`–`1.15` 最稳 |
| `brightness` | 1 | 0–4 | 亮度 |
| `temperature` | 0 | −1–1 | 正 = 暖（琥珀），负 = 冷（青蓝） |
| `vignette` | 0 | 0–1 | 暗角，`0.3`–`0.4` 是「电影感」的甜点区 |
| `grain` | 0 | 0–1 | 颗粒，`0.12`–`0.2` |

**调色是全片统一的**（`meta` 级，不是逐轨）——逐轨调必然花，且会让相邻两镜色调打架。
逐轨只保留 `blend`。`vignette` / `grain` 上到 `0.6` 以上会明显糊，不要贪。

### 质量档 `quality`（工具参数，不是 manifest 字段）

`render_composition` 的入参里另有 `quality`：

| 档 | 用途 | 代价 |
| --- | --- | --- |
| `draft` | 半分辨率 / 低码率 / 10s 关键帧间隔，**自动跳过渲染前预览闸门** | 画质粗，画布角标标「草稿」 |
| `standard` | 缺省。与二期完全一致的默认值 | — |
| `high` | 交付 / 发布（高码率 / 2s 关键帧） | 文件大、慢一些 |

节奏与排版没定之前一律用 `draft` 迭代，定稿再 `standard` / `high` 重渲一版。

### 顺序衔接 `startAfter`（治「帧号算错」）

```jsonc
// 紧接：下一轨从上一轨结束处开始
{ "id": "t4", "startAfter": { "trackId": "t3", "gapFrames": 4 }, "durationInFrames": 90, ... }

// 叠化：负 gapFrames = 与引用轨「重叠」这么多帧（-12 正好配 12 帧转场）
{ "id": "t4", "startAfter": { "trackId": "t3", "gapFrames": -12 }, "durationInFrames": 90, ... }
```

- 解析结果 = `引用轨的 startFrame + 引用轨的 durationInFrames + gapFrames`（负号自己就是减法）；
- **`gapFrames` 可以是负数**：`-12` = 与引用轨重叠 12 帧。**片子用 `transition` 时必须写负值**
  —— 转场要求两轨重叠，`0` 只会首尾相接、退化成硬切。建议 `gapFrames` 的绝对值 = 该转场轨
  的 `durationInFrames`（一起写 `-12` / 12），低于 6 帧会触发 ML-06；
- 重叠量不能超过引用轨起点能容纳的范围（解析出负起始帧会被拒收）；
- **与 `startFrame` 互斥**（同时写 = 报错）；**只能引用数组里更靠前的轨**（天然无环）；
- 宿主解析后会回一行「顺序衔接已解析：…」，照那行核对即可，不要再自己手算。

### 退场 `exit`（治「硬消失」）

```jsonc
"exit": { "to": { "y": 44, "opacity": 0 }, "durationInFrames": 8, "easing": "easeIn", "gapFrames": 0 }
```

- `from` **自动**取「入场动画在退场起点处的读数」⇒ 不会跳变，所以只写 `to`；
- `durationInFrames` 缺省 = `clamp(入场时长 × 0.6, 4, 12)`（退场比进场快，观感才利落）；
- `gapFrames`：提前多少帧结束退场（缺省 0 = 退到轨道末尾为止）；
- 有 `exit` 时 `fadeFrames` 的**尾部**淡化自动让位（只保留首部），不会双淡出。

### 颜色过渡 `colorShift`

```jsonc
"colorShift": { "from": "#4f9cf9", "to": "#ff7a59", "durationInFrames": 60, "easing": "easeInOut" }
```

作用于 `shape.color` / `textCard.accentColor` / `audioViz.color`。区间外取端点（不循环）。
适合「同一元素从冷到暖表示状态变化」，别整条片子每个元素都在变色。

### 图层混合 `blend`

`normal`（缺省）/ `screen`（光晕叠加）/ `multiply`（纹理压暗）/ `overlay` / `soft-light`（双重曝光）。
零运行时成本（GPU 合成）。

### 缓动白名单（13 档）与 `spring`

| 类别 | 取值 | 什么时候用 |
| --- | --- | --- |
| 老四档 | `linear` / `easeIn` / `easeOut` / `easeInOut` | 与二期公式一字不差，老片子保持原样 |
| 收束感 | `easeOutCubic` / `easeOutQuart` / `easeOutExpo` / `easeOutCirc` | **入场首选**：前 30–40% 走完 70–88% 行程，利落 |
| 发力感 | `easeInCubic` / `easeInOutCubic` / `easeInOutExpo` | 离场、镜头整体位移 |
| 过冲 | `backOut` | 卡片弹入（过冲 10%，`opacity` 自动 clamp） |
| 弹性 | `spring` | 「有重量」的落位，配 `spring: { stiffness, damping, mass }` |

`spring` 缺省参数 = `stiffness 170 / damping 18 / mass 1`（ζ≈0.69 ⇒ 过冲约 5%，落位有「重量感」）。
想更弹就降 `damping`（10 左右很像 iOS 的弹入），想更稳就抬到 26（几乎不过冲）。
**`opacity` 永远被 clamp 在 0–1**（过冲只作用于 `x`/`y`/`scale`/`rotation`），所以大胆给 `backOut` / `spring`。

### 音频包络与 BGM 闪避

```jsonc
// 单句旁白
"audio": { "bgmUrl": "…", "voiceOverUrl": "…",
           "fadeInSeconds": 0.6, "fadeOutSeconds": 1.2, "duck": { "amount": 0.55 } }

// 多句旁白：voiceOver 数组，按 startFrame 落到时间轴（与 voiceOverUrl 互斥）
"audio": { "bgmUrl": "…",
           "voiceOver": [
             { "src": "…/vo-1.mp3", "startFrame": 78 },
             { "src": "…/vo-2.mp3", "startFrame": 212, "volume": 0.9 },
             { "src": "…/vo-3.mp3", "startFrame": 357 }
           ],
           "mix": { "bgmVolume": 0.35, "voiceVolume": 1 } }
```

- `fadeInSeconds` / `fadeOutSeconds`：BGM 整轨线性淡入淡出；
- `duck.amount`：**字幕在屏时** BGM 压到该倍率（前后各 6 帧过渡）。依据是字幕轨窗口，不是音频分析 ⇒ 确定、零成本；
- 近似说明：旁白间隙不恢复（字幕连续时 BGM 全程压低）。
- **`voiceOver` 数组（O-10）**：多句旁白逐条给 `{src, startFrame?, volume?}`（`startFrame` 是**绝对帧**，
  上限 64 条）。**不要自己用 ffmpeg 拼一条长音轨** —— 终端用户跑不了 ffmpeg，这条路对用户是断的。
  `voiceOverUrl` 与 `voiceOver` 二选一：单句用前者，多句用后者（同时写会拒收）。

### 编排体检回执（lint）

`validateManifest` 会在返回值的 `warnings` 里带上 `[编排体检 ML-xx] …` 条目，`render_composition`
的结果里还有 `report.lint: [{ code, at }]` 可计数。**只 warning、不拒收**。12 条：

| Code | 触发 | 怎么改 |
| --- | --- | --- |
| ML-01 | ≥3 条内容轨同帧入场且都带动画 | 错峰 3–6 帧，或用 `startAfter` |
| ML-02 | 轨在片尾前结束、无 `exit`、无尾部淡化/转场 | 加 `exit` |
| ML-03 | `animate.durationInFrames < 6` | 低于 6 帧观感是抖动 |
| ML-04 | 动画 > 45 帧且位移 < 10% | 缩到 18–30 帧或加大位移 |
| ML-05 | 有位移/缩放却用 `linear` | 换 `easeOutCubic` 及以上 |
| ML-06 | 转场窗口 < 6 帧 | 拉长到 8–20 帧 |
| ML-07 | 同帧 ≥4 条轨在动 | 1 主 2 次，其余错峰 |
| ML-08 | 全片 `exit` 数为 0 且轨数 ≥ 5 | 片尾统一退场 |
| ML-09 | 动画端点 `x`/`y` 超出 0–100 | 元素会跑出画 |
| ML-10 | 静态时长占比 > 70% | 加运动或缩短镜头 |
| ML-11 | 字幕超 3 行（720p） | 拆句或缩字号 |
| ML-12 | 单行超 28 字 | 同上 |

不想要这些提示可在 `meta` 里写 `"lint": "off"`。

### 渲后抽帧与报告（自查用）

`render_composition` 的结果里：

- `frames: [{ frame, url }]` —— 4 张均匀抽帧 + 每个转场中点（上限 8）。**先看这几张图再向用户汇报**：
  字压边、元素出画、转场叠影只能在这上面看出来；
- `report: { quality, frames, totalMs, msPerFrame, encodeMs, bytes, bitrateKbps, width, height, sampledFrames, warm, lint }`
  —— 这条片花了多久、质量档是否生效、哪几条 lint 命中。慢得离谱时先看 `msPerFrame` 与 `encodeMs` 的占比。

## 实现细节（读源码才看得到，2026-10 真机踩过）

> 这一节是**组件层实现事实**，不是约定。写 manifest 时按它避开，比渲染完再改省一轮。
> `tests/manifest-contract-doc.test.mjs` 会把这批"文档断言"回去对源码 —— 源码改了而文档没跟，测试会红。

| # | 实现事实 | 你该怎么做 |
| --- | --- | --- |
| 1 | `shape:"circle"` 的直径**只由 `box.w` 决定**（实现是 `height:0` + `paddingBottom: w%`，高度按父**宽**解析），**`box.h` 被忽略** | 画圆只给 `w`；想要椭圆用 `shape:"path"` 或 `transform.scale` 拉一个圆 |
| 2 | `shape:"line"` 的 `box.x` 是**左边缘**，不是中心（它把居中用的 `translateX(-50%)` 换成了 `translateX(0)`） | 要让一条线看起来居中，`x` 按 `50 - w/2` 写 |
| 3 | `bullets` 的文字色**硬编码** `#e6edf3`；`accentColor` 只改**圆点**颜色 | 表盘/卡片里要多色文字，只能用 `shape` 拼，或换 `subtitle` |
| 4 | `bullets` 的圆点**常显、无开关**；圆点 18px + 右边距 24px ⇒ 文字左缘固定偏 **42px**；容器固定 **900px** 宽 | 按像素对齐时把这 42px 算进去；窄画布上容器会按 90% 收 |
| 5 | `bullets` 的 `anim:"typewriter"` 用**整卡的轨内帧**推进，多行会同时开始打字 | 要"一行打完再打下一行"，必须**拆成多条 textCard 轨**，各自错开 `startFrame` |
| 6 | `variant:"title"` 带**全屏蒙版** `rgba(0,0,0,0.35)`；`variant:"subtitle"` 固定**底部居中** | 想要"左栏大标题"用 `bullets` + `transform.x`，不要用 title 硬挪 |
| 7 | 自动排版**只缩不放**：`fitTextPolicy` 从 `baseFontPx` 以 0.94 递减收缩，永不放大 | 想让标题更大，改 `transform.scale`，别指望字号自适应 |
| 8 | `shape` 的 `box` **不能被 `animate` 动画**；`shapeTransform` 只有 `scale` / `rotation`，**没有位移** | 用 `animate` 的 `x/y` 动位置（见第 9 条），不要试图动画 `box` |
| 9 | 但 `animate.from/to` 里的 `x/y` **会覆盖 `box.x/y`**（`positionDeclared` 以 animate 为准） | "以 `box` 定初始位置、只动 y"是可行的：`animate` 里只写 `y`，`x` 保持 `box` |
| 10 | `transition` 作用于 `fromTrackId` / `toTrackId` 的**整条轨**，不是单个元素 | "只擦除某一行/某个块"做不到；要么拆轨，要么用 `exit` 淡出模拟 |
| 11 | `fx:"glow"` 的发光色**固定冷蓝** `rgba(120,190,255,…)`，不可配 | 要暖色光晕就用 `shape` + 半透明径向渐变自己画 |
| 12 | `meta.look.temperature > 0` 走 `hue-rotate(-12deg)`（偏暖）；`≤ 0` 走 168°（偏青） | **要冷调必须给负值**（如 `-0.55`），给 0 等于不调、给正数是反方向 |
| 13 | `shape:"path"` 的 `d` 是 **0–100 双轴百分比**且 `preserveAspectRatio="none"`（非等比） | 16:9 下画"正圆感"的曲线要按 `rx : ry ≈ 1 : 0.5625` 补偿 |
| 14 | `box` 的 `w` / `h` 是**画布百分比**，不是像素；父容器变了它跟着变 | 换算像素时一律 `百分比 × 画布宽/高 ÷ 100`，别写死 px |
| 15 | `meta.durationInFrames` 必须 **等于** `max(startFrame + durationInFrames)`；`exit.durationInFrames` 必须 **≤ 轨道时长** | 改末尾轨的时长后同步改 `meta`；`exit` 只能在长轨上用，别给 1 帧轨写 10 帧退场 |
| 16 | `render_composition` **不要传 `projectId`**（省略即按当前项目解析）；长 manifest 走 `manifestPath` 绝对路径 | 内联超 ~30KB 会被入参截断，尾部完整性校验会当场拒收，白烧一轮 |

> 像素定位（素材上的屏幕/主体矩形）：用 `inspect_image` —— 先 `mode:"grid"` 看空间分布，
> 再用 `bbox-dark` + `region` 拿精确矩形。它给的是**扫描区内的包络**，不是连通域；
> 深色目标压在深色背景上时会退化成整块区域（覆盖率 >90% 会显式告警），别拿那次结果去定位。

## 硬约束（违反即校验失败或不达预期）

1. `meta.durationInFrames` 与 `max(track.endFrame)` 偏差 > 1 帧会 warning，请让两者一致；任一轨超出总时长会 warning 并在渲染时按 `meta` 裁切。
2. 轨道 `id` 必须唯一，否则报错。
3. **`src` 只接受** `/canvas-studio/assets/...` 同源 URL，或**位于本项目资产目录内**的绝对路径（宿主会物化为同源 URL；目录外的绝对路径会被拒收 —— 渲染进程在浏览器环境取不到域外文件）；任何 `http(s)://`、协议相对 `//` 一律拒绝（防外链）。
4. `meta.width` / `height` / `fps` / `durationInFrames` 必须是有限正数（帧数为正整数）。
5. CSS 层叠（z-index）在客户端渲染器里**不支持**：叠放顺序由 `tracks` 数组顺序决定，后写在上层——要压底先把背景 shape 放前面。
6. 转场窗口应落在相邻两轨的重叠区，否则过渡可能不可见（warning）。
7. `animate.easing` 只接受「三期新增：编排与质感」那节列的 13 档白名单；`scale` 必须 > 0；
   `opacity` 限 0–1；`fadeFrames` 是 ≥ 0 的整数。**契约外字段不会生效**（例如把 `animate` 写成
   `animation`、把 `transform` 写成 `position`）—— 宿主会把它们列进 `warnings` 回传。
   看到这类 warning 请照本手册改正字段名后重跑，**不要当成"已经生效"**。
8. **位置来源互斥**：`orbit` 与 `transform.x/y`、`animate.from/to` 的 `x/y` 只能有一处（同时写即报错）。
9. `orbit.radius` 必须在 `(0, 100]`；`orbit.center.x/y` 必须在 0–100；`periodInFrames` 若显式给必须 > 0
   （不给则取本轨 `durationInFrames`，此时该轨时长必须合法）。
10. `shape:"path"` 必须给 `d`；`strokeWidth` 在 `(0, 100]`；`draw.to` 在 0–1，
    `draw.durationInFrames` 是正整数（不给则取本轨时长，该轨时长必须合法）。
11. `fx` 是单值枚举（`glow` / `stroke` / `shadow` / `blur` / `maskFade`），**不要传数组**。
12. `audioViz` 的 `bars` 是 1–128 整数、`gain` 在 0–4、`heightPercent` 在 `(0, 100]`、
    `mode` 只允许 `bars` / `mirror` / `line`、`position` 只允许 `bottom` / `top`、
    `smoothing` 在 0–0.9；`src` 同样受同源约束。
13. 三期字段的类型边界：`exit.durationInFrames` / `exit.gapFrames` / `trimBeforeFrames` 是 ≥0 整数，
    `playbackRate` 在 `(0.1, 4]`，`volume` / `softness` / `smoothing` / `look.*` 是 0–1（`contrast` /
    `saturation` / `brightness` 除外），`blend` 是单值枚举。越界会直接报错点名该轨。

## 事件与一致性

- Manifest 引用的每条素材轨 `src` 要能解析到本项目资产；宿主会核对存在性 —— **缺失或不可用即拒绝渲染**（`CS-USER-ERR`，不落节点）。video 轨的声明时长与 ffmpeg 真值偏差 > 0.5s 会以 warning 回传并按真值校正（见 SKILL.md「缺素材会被直接拒收」）。
- `global.fontFamily` / `global.fonts` 的写法见 `references/fonts.md`。
- 科普脚本与卡片节奏见 `references/explainer-patterns.md`。
