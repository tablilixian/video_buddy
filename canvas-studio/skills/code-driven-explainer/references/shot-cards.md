# 镜头卡（可直接粘的片段库）

> **用法**：先在这里挑卡，再填参数。不要从空 `tracks` 开始想 —— 每次从零组装是过去
> 时长失控与结构试错的主因。
>
> **每条片段都实测可渲**（`scripts/render-forensics/cards.mjs`，Q12/Q13：24/24 通过 —— A–E 14 张
> + F 类 10 张，判定「非黑 > 50% 且相邻帧 MAE ≥ 0.5」）。`id` 可改，`startFrame` / `durationInFrames`
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
| F1–F10（shotcraft 吸收批） | **无**（全部纯代码绘制） | —— |

**两个结论，直接影响排期**：
1. **24 张卡里只有 2 张要外部素材**（C2、E1）⇒ "素材组织慢"的主要矛盾不在选卡，在**素材本身从哪来**（尤其"把产品图里的表盘裁出来"这类，我们目前没有抠图工具）。
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

## SFX 建议索引（CV-371）

`assets/audio/sfx/` 现有 12 个可溯源音效（Mixkit 免署名可商用，授权与 SHA-256 见
`assets/audio/sfx/ATTRIBUTION.md`）。**这只是排轨时的建议标注，渲染链完全忽略** ——
混音/音频构成属后续产品线，manifest 里**不要**写任何 sfx 字段（白名单校验会拒收）。

| 卡 | 建议 SFX | 钉点 |
|---|---|---|
| F1 长卷急刹 | `sweep-fast-small` | 刹停那帧 |
| F2 数据飞线 | `sweep-scifi-fast` | 弧线开始生长 |
| F3 扫描标注 | `glitch-electric-small` | 括号合围完成 |
| F4 马克笔下划线 | `camera-shutter-hard` | 线描完落定 |
| F5 首词组装 | `impact-zoom-quick` | 大字砸落帧 |
| F6 词槽轮换 | `camera-autofocus` | 每次换词 |
| F7 高光扫过 | `shimmer-sparkle-sweep` | 光带起扫 |
| F8 UI 蒸发收尾 | `transition-snap` | 定版词进场 |
| F9 里程碑时间轴 | `click-camera` | 每个节点亮起 |
| F10 进度环揭晓 | `bass-hit-short` | 数字跳出 |
| A3 落版 / 段首重音 | `impact-deep-whoosh` | 段首首帧 |
| 任意转场 | `whoosh-fast` | 转场起点 |

---

## F 类 · shotcraft 吸收批（CV-370，10 张）

> 来源：shotcraft 124 卡按 D18 门槛筛选（白名单可组合 + 复用频次 + 成本 ≤ 中），10 张全部取证通过。
> **成本口径**：F 类数字来自 2026-10-25T22-48-40 轮，与 A–E 类（04-16-46 轮）不同轮，轮间有 ±4ms
> 漂移 —— 比卡时看档位与量级，别抠小数。

### F1 长卷急刹 `scroll-brake`
**适用**：长列表/多项指标「快滚→急刹→停点揭晓」。**观感**：滚得越快，刹得越脆；停点行抬亮配打字小结。
**成本**：中（25.7 ms/帧；`bullets` 多行 + 三段关键帧）
```jsonc
{ "id": "list", "type": "textCard", "variant": "bullets",
  "text": ["静息心率 62", "深睡 1h42m", "血氧 98%", "压力指数 18", "步数 8,432"],
  "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "animate": [
    { "from": { "y": 66 }, "to": { "y": 40 }, "durationInFrames": 10, "easing": "easeOut" },
    { "from": { "y": 40 }, "to": { "y": 34 }, "durationInFrames": 8, "easing": "easeOut", "startAfter": "previous" },
    { "from": { "y": 34 }, "to": { "y": 35 }, "durationInFrames": 4, "easing": "easeInOut", "startAfter": "previous" }
  ] }
```
**注意**：过冲段只回弹 1 个百分点 —— 急刹的「脆」靠**末段短**（4 帧），不靠回弹幅度。停点抬亮配
`fx:"stroke"` 的 rect + `opacity` 淡入（完整样本 `scroll-brake`）。

### F2 数据飞线 `flyline-arc`
**适用**：卡到卡的因果/能量流（摄入→消耗、源头→结果）。**观感**：弧线生长到落点，脉冲一圈消散。
**成本**：中（11.6 ms/帧）
```jsonc
{ "id": "fly", "type": "shape", "shape": "path", "color": "#7DD3FC", "strokeWidth": 0.9, "fx": "glow",
  "d": "M 18 64 C 40 22, 58 72, 78 30", "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "draw": { "to": 1, "durationInFrames": 40, "easing": "easeInOut" } }
```
**注意**：落点脉冲 = 同位大一号 `circle + fx:glow`，animate 两段「亮起→扩散消失」用 `startAfter:"previous"`
串联；起终点各放一个小 `circle` 当锚。

### F3 扫描标注 `scanline-annotate`
**适用**：逐项识别/体检式揭示（扫过即标注）。**观感**：细光带匀速过境 + 四角括号合围 + 打字贴标。
**成本**：中（16.8 ms/帧）
```jsonc
{ "id": "scan", "type": "shape", "shape": "rect", "color": "#7DD3FC",
  "box": { "x": 50, "y": 17, "w": 46, "h": 0.8 }, "fx": "glow",
  "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "animate": { "from": { "y": 17 }, "to": { "y": 75 }, "startFrame": 8, "durationInFrames": 46, "easing": "easeInOut" } }
```
**注意**：四角括号 = 4 条两笔 `path`（`M 27 26 L 27 18 L 35 18` 这类），`draw` 6 帧错峰；扫描线先走完，
括号与标签再上（时序：扫 8–54f，括 56f 起，标 62f 起）。底板 `rect` 先铺。

### F4 马克笔下划线 `marker-underline`
**适用**：关键词强调的最便宜形态。**观感**：标题落定后一条微上斜的手绘线快描而过。
**成本**：中（15.7 ms/帧；大头是 typewriter 标题本体）
```jsonc
{ "id": "u", "type": "shape", "shape": "path", "color": "#F59E0B", "strokeWidth": 1.4,
  "d": "M 36 63 C 48 62.2, 62 63.6, 88 62.4", "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "draw": { "to": 1, "durationInFrames": 12, "easing": "easeOut" } }
```
**注意**：线要「手绘感」就别水平 —— 端点 y 差 0.6–1 个百分点、用 `C` 带一点弯；12 帧描完，宁快勿慢。

### F5 首词组装 `lead-word-zoom`
**适用**：数字/钩子开场（大字砸下来）。**观感**：首词 2.2 倍缩回落位到上方，余词推进成句。
**成本**：中（15.5 ms/帧）
```jsonc
{ "id": "w1", "type": "textCard", "variant": "title", "text": "3.8 亿",
  "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "animate": { "from": { "y": 46, "scale": 2.2, "opacity": 0 }, "to": { "y": 32, "scale": 1, "opacity": 1 },
               "startFrame": 2, "durationInFrames": 16, "easing": "easeOut" } }
```
**注意**：两条 `title` 都居中渲染，**用 animate 的 y 把它们摆开**（首词 y32、句子 y54）—— textCard
版位固定，位置全靠 `animate` 位移，这是 CV-334 后的标准摆位手法。

### F6 词槽轮换 `pill-slot-cycle`
**适用**：同句干换词的排比强调（更快/更稳/更准）。**观感**：句干钉死，同位词卡逐个上翻替换。
**成本**：低（9.6 ms/帧）
```jsonc
{ "id": "w1", "type": "textCard", "variant": "title", "text": "更快",
  "startFrame": 4, "durationInFrames": 30, "fadeFrames": 0,
  "exit": { "to": { "opacity": 0, "y": 44 }, "durationInFrames": 8 } }
```
**注意**：三个词轨**同位交替**（都走 title 居中位），后一词在前一词 exit 中段进场（前 4f 后 36f 这样错）；
最后一个词不退出，可加 scale 0.9→1 微弹落定。

### F7 高光扫过 `sheen-sweep`
**适用**：成果/奖杯时刻的加冕。**观感**：一道亮带单程擦过主角卡。
**成本**：中（10.9 ms/帧）
```jsonc
{ "id": "sheen", "type": "shape", "shape": "rect", "color": "#F8FAFC",
  "box": { "x": 24, "y": 50, "w": 2.4, "h": 36 }, "fx": "glow",
  "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "animate": [
    { "from": { "x": 24, "opacity": 0 }, "to": { "x": 30, "opacity": 0.85 }, "durationInFrames": 3, "easing": "easeInOut" },
    { "from": { "x": 30, "opacity": 0.85 }, "to": { "x": 76, "opacity": 0 }, "durationInFrames": 12, "easing": "easeInOut", "startAfter": "previous" }
  ] }
```
**注意**：没有 rotate，**只能做竖直光带**（45° 斜带做不了，缺口清单有记）；光带要**超出主角卡高度**，
扫过才有「掠过表面」感。

### F8 UI 蒸发收尾 `strip-away-outro`
**适用**：复杂界面收束到一个结论。**观感**：外围元素错峰蒸发，唯一结论放大定版。
**成本**：中（12.7 ms/帧）
```jsonc
{ "id": "bar", "type": "shape", "shape": "rect", "color": "#1F2937",
  "box": { "x": 50, "y": 16, "w": 70, "h": 7 },
  "startFrame": 0, "durationInFrames": 44, "fadeFrames": 0,
  "exit": { "to": { "opacity": 0, "y": 12 }, "durationInFrames": 8 } }
```
**注意**：蒸发时序 = 外围→中心逐个错峰（每个元素自身 duration 结束前 8 帧走 exit）；**每个元素的
退场方向指向画面外**（顶条向上、左栏向左下、右栏向右下）；最后的定版词配 `fx:glow` 光晕 + typewriter。

### F9 里程碑时间轴 `timeline-marks`
**适用**：阶段/进度叙事（第 1 周→第 4 周→第 8 周）。**观感**：轴线生长，节点错峰亮起，要点逐条落位。
**成本**：中（29.6 ms/帧；F 类最贵 —— 轴 + 3 节点 + bullets 三层叠）
```jsonc
{ "id": "axis", "type": "shape", "shape": "path", "color": "#475569", "strokeWidth": 0.7,
  "d": "M 12 72 L 88 72", "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "draw": { "to": 1, "durationInFrames": 26, "easing": "easeInOut" } }
```
**注意**：节点 = 小 `circle` 沿轴 x 排开、`scale 0.2→1` 错峰 8 帧进场（中间节点可加 `fx:glow` 当当前站）；
bullets 放轴上方避免压线。要「变速旅行」效果得靠多段 x 关键帧，成本会再上去，先别叠。

### F10 进度环揭晓 `progress-ring`
**适用**：达成率/百分比揭晓。**观感**：圆环描完，中心数字打字跳出。
**成本**：中（11.6 ms/帧）
```jsonc
{ "id": "ring", "type": "shape", "shape": "path", "color": "#38BDF8", "strokeWidth": 1.6, "fx": "glow",
  "d": "M 50 20 A 30 30 0 1 1 49.9 20", "startFrame": 0, "durationInFrames": 90, "fadeFrames": 0,
  "draw": { "to": 1, "durationInFrames": 56, "easing": "easeInOut" } }
```
**注意**：整圆弧用 `A` 命令（终点 x 差 0.1 绕满一圈）；`strokeWidth` 是画布高度百分比（1.6 ≈ 11px）；
数字用 typewriter 在 draw 过半（约 34f）时进场。

### 能力缺口清单（想吸收但白名单拼不出 —— 进 backlog，勿做成伪卡）

| 缺口卡（shotcraft） | 缺什么字段/能力 |
|---|---|
| 对比拉杆 before-after-slider | 图像层缺按杆位的 clip/mask 揭示（`fx.maskFade` 只有整层淡入） |
| 空心词点亮 outline-word-fill | textCard 缺描边空心字样式 + 瞬时填充帧 |
| 渐变充能 gradient-word-sweep | 缺渐变填充 + 扫过波前 mask |
| 满弧扫针 gauge-readout(A) | `animate` 缺 `rotate`（指针甩弧/圆环自转全依赖它） |
| 点阵重组 chart-live(B) | 缺点群编排（数百点聚形拼数字），且成本必超标 |
| 数位滚动 DigitRoll | 缺计数滚动组件（现只能多轨文本阶跃近似，见 F6 的近似法） |

---

## 与 shotcraft 124 卡的对照（CV-370 已完成第一批）

不引它的资产、也不移植它的 TSX（`demos/*.tsx` 是 React 组件，我们的产物是 manifest DSL，
且"模型不写代码"是架构约束）。只借它的**分类词汇**：

| 它的类别 | 我们的对应能力 | 差距 |
|---|---|---|
| camera（推拉摇移） | `animate.scale` + `orbit` + `transform` | 只有等比 scale，无 `scaleX/Y`、无真实透视 |
| typography（文字动效） | 4 种 `anim` 预设 + `textCard` 4 个 variant | 无 per-character 自定义时序（只有等间隔） |
| UI entrance（元素入场） | `animate` 的 `x/y/opacity/scale` | 无弹性/回弹曲线族（只有 easing 档位） |
| data emphasis（数据强调） | `dataCard` + `shape:rect` 手绘柱/条 + F1/F9/F10 | 无图表组件（柱/线/饼都得手拼） |
| transition（转场） | `transition` 效果表 | 无 3D / 遮罩形状转场 |
| effects（强调/扫描） | F2 飞线 / F3 扫描 / F4 下划线 / F7 高光 | 缺 rotate（见缺口清单） |
| outro（落版） | `exit` + `fadeFrames` + F8 蒸发收尾 | —— |

第一批已按 D18 门槛筛出 13 张候选：10 张用现有字段复刻成 F 类（上文），其余 3 张与 6 条
**字段级缺口**进上面「能力缺口清单」——扩 manifest 字段后才能做，勿做成伪卡。
