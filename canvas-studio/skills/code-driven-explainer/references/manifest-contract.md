# CompositionManifest 契约（组装必读）

`render_composition` 的唯一入参是字段 `manifest`（一段 JSON 字符串）。本文是该结构的字段手册与硬约束；上游口径见 `skills/canvas-studio-creation/references/toolchain.md`。

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

## 帧级动画 `animate`

**画面不动就是幻灯片。** 这一节是"让东西动起来"的唯一入口。

```jsonc
{
  "from": { "x": 115, "opacity": 0 },   // 起点（必填）
  "to":   { "x": 50,  "opacity": 1 },   // 终点（必填）
  "startFrame": 0,                       // 轨内相对帧，缺省 0
  "durationInFrames": 18,                // 动画时长（帧），缺省 = 整轨长
  "easing": "easeInOut"                  // linear / easeIn / easeOut / easeInOut（缺省 easeInOut）
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

### `shape`（形状 / 色块 / 路径）

```jsonc
{ "type": "shape", "id": "bg-1", "startFrame": 0, "durationInFrames": 900,
  "shape": "gradient", "color": "#111827", "box": { "x": 0, "y": 0, "w": 100, "h": 100 } }
```

`shape` 取 `rect` / `circle` / `line` / `gradient` / `arrow` / `triangle` / `star` / `polygon` / `path`；
`box` 是相对画布的百分比坐标（0–100）。`arrow` / `triangle` / `star` / `polygon` 与 4 种基础形状用法
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
| `mode` | `bars` | `bars` 单向 / `mirror` 上下对称 |
| `gain` | 1.6 | 振幅增益 0–4（人声比配乐轻，给 1.4–2.2） |
| `heightPercent` | 30 | 波形区高度（占画布高百分比） |
| `position` | `bottom` | `bottom` / `top` |
| `color` | 主题蓝 | 柱色 |

用法要点：波形轨放 `tracks` 数组**靠后**（后写在上层）；配 `fx:"maskFade"` 让底部自然淡出；
`durationInFrames` 不必等于音频总长（超出部分按静音画基线）。

## 硬约束（违反即校验失败或不达预期）

1. `meta.durationInFrames` 与 `max(track.endFrame)` 偏差 > 1 帧会 warning，请让两者一致；任一轨超出总时长会 warning 并在渲染时按 `meta` 裁切。
2. 轨道 `id` 必须唯一，否则报错。
3. **`src` 只接受** `/canvas-studio/assets/...` 同源 URL，或**位于本项目资产目录内**的绝对路径（宿主会物化为同源 URL；目录外的绝对路径会被拒收 —— 渲染进程在浏览器环境取不到域外文件）；任何 `http(s)://`、协议相对 `//` 一律拒绝（防外链）。
4. `meta.width` / `height` / `fps` / `durationInFrames` 必须是有限正数（帧数为正整数）。
5. CSS 层叠（z-index）在客户端渲染器里**不支持**：叠放顺序由 `tracks` 数组顺序决定，后写在上层——要压底先把背景 shape 放前面。
6. 转场窗口应落在相邻两轨的重叠区，否则过渡可能不可见（warning）。
7. `animate.easing` 只接受 `linear` / `easeIn` / `easeOut` / `easeInOut`；`scale` 必须 > 0；
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
    `mode` 只允许 `bars` / `mirror`、`position` 只允许 `bottom` / `top`；`src` 同样受同源约束。

## 事件与一致性

- Manifest 引用的每条素材轨 `src` 要能解析到本项目资产；宿主会核对存在性 —— **缺失或不可用即拒绝渲染**（`CS-USER-ERR`，不落节点）。video 轨的声明时长与 ffmpeg 真值偏差 > 0.5s 会以 warning 回传并按真值校正（见 SKILL.md「缺素材会被直接拒收」）。
- `global.fontFamily` / `global.fonts` 的写法见 `references/fonts.md`。
- 科普脚本与卡片节奏见 `references/explainer-patterns.md`。
