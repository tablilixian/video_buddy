# 镜头卡（可直接粘的片段库）

> **用法**：先在这里挑卡，再填参数。不要从空 `tracks` 开始想 —— 每次从零组装是过去
> 时长失控与结构试错的主因。
>
> **每条片段都实测可渲**（`scripts/render-forensics/cards.mjs`，Q12/Q13：14/14 通过，
> 判定「非黑 > 50% 且相邻帧 MAE ≥ 0.5」）。`id` 可改，`startFrame` / `durationInFrames`
> 按你的时间轴调；`meta.durationInFrames` 必须始终 = 最大结束帧。
>
> 卡里的数字是**画布百分比、x/y 是中心**（与 `render_composition` 的 `box` 同口径）。
>
> **成本档**依据取证实测稳态 ms/帧（`scripts/render-forensics`，90 帧卡样；真实会话首帧另含 bundle
> 预热，另计）：**低** <10 ｜ **中** 10–30 ｜ **高** >30。**高成本卡只允许单镜头短时长使用，不得成片连排。**

---

## 素材需求索引（选卡前先看这张表）

**这张表是"先备齐再动手"的依据**：`§07` 里 `status:"pending"` 的素材会**阻断落地**，
所以选卡时就要知道这张卡要不要素材、去哪拿。

| 卡 | 素材需求 | 来源（`source`） |
|---|---|---|
| A1 标题遮罩 / A2 标题逐字 / A3 字幕 / A4 要点 / A5 收尾落版 | **无**（纯代码绘制） | —— |
| B1 数据卡 / B2 柱状对比 | **无** | —— |
| C1 卡片入场 | **无** | —— |
| C2 左右分栏 | **1 张竖构图像**（右侧视觉主体） | `user`（用户给）/ `library`（资产库）/ `generated` |
| D1 擦除转场 / D2 呼吸光效 | **无** | —— |
| E1 素材推拉 | **1 张图**（按项目画幅；`kenburns` 会裁掉边缘） | `user` / `library` / `generated` |
| E2 路径生长 / E3 公转徽标 | **无** | —— |

**两个结论，直接影响排期**：
1. **14 张卡里只有 2 张要外部素材**（C2、E1）⇒ "素材组织慢"的主要矛盾不在选卡，在**素材本身从哪来**（尤其"把产品图里的表盘裁出来"这类，我们目前没有抠图工具）。
2. 需要素材的卡**必须**在故事板 §07 里登记一条（`neededBy` 指向它服务的 shot，`source` 说明去哪拿）；
   漏登记 = 落地后才发现缺图 = 又要临时找。这条已由门禁兜住（pending 会拦落地）。

---

## A 类 · 标题与字幕

### A1 标题遮罩揭示 `maskReveal`
**适用**：大标题 / 金句 / 章节页。**观感**：遮罩边缘硬，最"有设计感"的一种。
**成本**：高（66 ms/帧，逐帧重绘文字 —— 14 卡最贵，限单镜头短用）
```jsonc
{ "id": "t", "type": "textCard", "variant": "title", "text": "心率监测",
  "anim": "maskReveal", "animOptions": { "revealFrames": 24 },
  "startFrame": 6, "durationInFrames": 78, "fadeFrames": 0 }
```

### A2 标题逐字打出 `typewriter`
**适用**：需要"说出来"的节奏（旁白对齐）。**观感**：慢速揭示调 `wordDelayFrames`（缺省 1），
**不要**去调 `unitDurationInFrames`（那是单字入场时长，缺省 12 帧，调大只会让每个字变"糊"）。
**成本**：中（21 ms/帧）
```jsonc
{ "id": "t", "type": "textCard", "variant": "title", "text": "今天，它替你数了一次心跳",
  "anim": "typewriter", "animOptions": { "wordDelayFrames": 2 },
  "startFrame": 6, "durationInFrames": 84, "fadeFrames": 0 }
```

### A3 字幕逐字 `subtitle`
**适用**：旁白对齐的默认形态。**观感**：底边居中、自带压暗，不要自己再加蒙版。
**成本**：中（24 ms/帧）
```jsonc
{ "id": "s", "type": "textCard", "variant": "subtitle", "text": "静息心率 62，低于昨日 4 次",
  "anim": "typewriter", "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0 }
```

### A4 要点逐词落位 `bullets + wordStagger`
**适用**：功能罗列、3–5 条要点。**观感**：**圆点常显**（无开关，占 18px + 24px 边距 ⇒ 文字左缘固定偏 42px）；
容器固定 900px。逐行打字必须拆多条轨（`bullets` 的 typewriter 是整卡推进）。
**成本**：中（27 ms/帧）
```jsonc
{ "id": "b", "type": "textCard", "variant": "bullets",
  "text": ["全天心率曲线", "异常自动提醒", "七天趋势对比"],
  "anim": "wordStagger", "animOptions": { "wordDelayFrames": 4 },
  "startFrame": 6, "durationInFrames": 84, "fadeFrames": 0 }
```

### A5 收尾落版
**适用**：片尾最后一屏。**观感**：不要硬消失 —— 用 `exit` 上浮淡出（`to` 必填，只写想变的维度；
`durationInFrames` 缺省按入场时长的 0.6 倍推导）。
**成本**：低（5 ms/帧）
```jsonc
{ "id": "o", "type": "textCard", "variant": "title", "text": "它一直在看",
  "startFrame": 6, "durationInFrames": 84, "fadeFrames": 0,
  "exit": { "durationInFrames": 18, "to": { "opacity": 0, "y": 58 } } }
```

---

## B 类 · 数据与图表

### B1 数据卡 `dataCard`
**适用**：2–3 个数字指标。**观感**：`accentColor` 只染数值，不要染整卡。
**成本**：中（15 ms/帧）
```jsonc
{ "id": "d", "type": "textCard", "variant": "dataCard", "text": "今日概览",
  "data": [{ "k": "静息心率", "v": "62 bpm" }, { "k": "血氧", "v": "98%" }],
  "accentColor": "#F59E0B", "startFrame": 6, "durationInFrames": 84, "fadeFrames": 0 }
```

### B2 柱状对比
**适用**：三档对比 / 趋势强调。**观感**：三根柱**错峰**入场（startFrame 各差 4–6 帧）才不呆板；
柱子高度用 `box.h`，底部对齐靠 `y = 100 - h/2`。
**成本**：低（6 ms/帧）
```jsonc
{ "id": "b1", "type": "shape", "shape": "rect", "color": "#22D3EE",
  "box": { "x": 30, "y": 70, "w": 10, "h": 20 }, "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0 }
```

---

## C 类 · 版式与容器

### C1 卡片入场（上浮 + 缩放）
**适用**：UI 元素出现的基本功。**观感**：`animate` 的 `y` 与 `scale` 同时给小值（8 → 1.0）最稳；
注意 `animate` **不支持** `scaleX` / `scaleY`。
**成本**：低（9 ms/帧）
```jsonc
{ "id": "card", "type": "shape", "shape": "rect", "color": "#1F2937",
  "box": { "x": 50, "y": 55, "w": 46, "h": 30 }, "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "animate": { "from": { "y": 62, "opacity": 0, "scale": 0.94 }, "to": { "y": 55, "opacity": 1, "scale": 1 }, "durationInFrames": 20 } }
```

### C2 左右分栏（讲解 + 视觉主体）
**适用**：「左讲解 / 右表盘」这类结构 —— 也是 `layout_table` 最该先量的两块。
**成本**：中（18 ms/帧）
```jsonc
{ "id": "right", "type": "shape", "shape": "rect", "color": "#0E7490",
  "box": { "x": 74, "y": 50, "w": 42, "h": 84 }, "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0 }
```

---

## D 类 · 转场与强调

### D1 擦除转场 `wipeLeft`
**适用**：段落之间。**观感**：两条卡必须**时间重叠**（`to` 的 startFrame < `from` 的结束帧），
否则中间会闪一帧底。
**成本**：低（7 ms/帧）
```jsonc
{ "id": "tr", "type": "transition", "effect": "wipeLeft", "fromTrackId": "a", "toTrackId": "b",
  "startFrame": 40, "durationInFrames": 14, "fadeFrames": 0 }
```

### D2 呼吸光效 `fx:glow`
**适用**：强调与环境光。**观感**：`fx:glow` **固定冷蓝**、换不了色；往复呼吸用「首尾相同」的
animate，否则会被动效体检查判「动画拖沓」。
**成本**：低（6 ms/帧）
```jsonc
{ "id": "g", "type": "shape", "shape": "circle", "color": "#0EA5E9", "fx": "glow",
  "box": { "x": 50, "y": 50, "w": 22, "h": 22 }, "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "animate": [{ "from": { "opacity": 0.45 }, "to": { "opacity": 0.95 }, "durationInFrames": 45 },
              { "from": { "opacity": 0.95 }, "to": { "opacity": 0.45 }, "durationInFrames": 45, "startAfter": "previous" }] }
```

---

## E 类 · 素材

### E1 素材推拉 `fit:'kenburns'`
**适用**：实拍 / 产品图 / 截图。**观感**：整条轨内 scale 1.0 → 1.08；**`kenBurns: true` 是死字段**
（类型里有、实现从不读）。
**成本**：低（6 ms/帧）

⚠️ **`src` 不接受 `@ref[...]`**：manifest 里必须是同源资产 URL（`/canvas-studio/assets/…`）
或项目资产目录内的绝对路径 —— `@ref` 只在工具入参层被解析，写进 manifest 会被校验器拒收。
```jsonc
{ "id": "img", "type": "image", "src": "/canvas-studio/assets/watch.png", "fit": "kenburns",
  "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0 }
```

### E2 路径生长 `shape:path + draw`
**适用**：趋势线 / 流程示意。**观感**：坐标是 0–100 双轴且**非等比**（`preserveAspectRatio="none"`）
⇒ 画圆形的路径必须按画布比例补偿。
**成本**：低（6 ms/帧）
```jsonc
{ "id": "p", "type": "shape", "shape": "path", "color": "#7DD3FC", "strokeWidth": 0.8,
  "d": "M 5 80 L 30 55 L 55 62 L 80 20",
  "box": { "x": 50, "y": 50, "w": 70, "h": 40 }, "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "animate": { "from": { "draw": 0 }, "to": { "draw": 1 }, "durationInFrames": 60 } }
```

### E3 公转徽标 `shape:circle + orbit`
**适用**：关系类 / 围绕类表达。**观感**：`orbit` 的半径是画布百分比，轨道中心找「被围绕那个形状的 `box` 中心」。
**成本**：低（5 ms/帧）
```jsonc
{ "id": "o", "type": "shape", "shape": "circle", "color": "#F59E0B",
  "box": { "x": 50, "y": 50, "w": 10, "h": 10 }, "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "animate": { "from": { "orbit": { "angle": 0, "radiusX": 26, "radiusY": 26 } },
               "to": { "orbit": { "angle": 360, "radiusX": 26, "radiusY": 26 } },
               "durationInFrames": 90, "easing": "linear" } }
```

> **有 5 张卡省略了 `animate` / `exit` 细节**（`card-enter` 完整版 / `glow-pulse` / `orbit-badge` /
> `path-growth` / `outro-fade`）：完整可渲样本在 `scripts/render-forensics/cards.mjs`。
> 改这些卡前先跑 `node scripts/render-forensics/run.mjs --only=Q12` 确认没渲崩。

---

## 与 shotcraft 157 张卡的对照（骨架，逐卡待填）

不引它的资产、也不移植它的 TSX（`demos/*.tsx` 是 React 组件，我们的产物是 manifest DSL，
且"模型不写代码"是架构约束）。只借它的**分类词汇**：

| 它的类别 | 我们的对应能力 | 差距 |
|---|---|---|
| camera（推拉摇移） | `animate.scale` + `orbit` + `transform` | 只有等比 scale，无 `scaleX/Y`、无真实透视 |
| typography（文字动效） | 4 种 `anim` 预设 + `textCard` 4 个 variant | 无 per-character 自定义时序（只有等间隔） |
| UI entrance（元素入场） | `animate` 的 `x/y/opacity/scale` | 无弹性/回弹曲线族（只有 easing 档位） |
| data emphasis（数据强调） | `dataCard` + `shape:rect` 手绘柱/条 | 无图表组件（柱/线/饼都得手拼） |
| transition（转场） | `transition` 效果表 | 无 3D / 遮罩形状转场 |
| outro（落版） | `exit` + `fadeFrames` | —— |

**逐卡对照需要 `git clone --depth 1` 到 `/tmp` 后按 Gallery 挑 10 张填这张表**（约 2 小时，
不引入依赖、不改构建）。填完会明确分出两堆：「现有字段能复刻」→ 补进本册；「缺字段」→ 进 backlog。
