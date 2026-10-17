# 动感范式库（主题无关）

本分册把「让画面动起来、且动得**能被看懂**」的能力从具体主题（如太阳系）里抽出来，变成
**任何科普内容**都能套用的通用范式。agent 在组装 `CompositionManifest` 时，**默认**按这里的范式
给画面加运动，而不是只放静态卡片。

> 引擎前提：CV-336 之后，`animate` 的**多段同维度关键帧**已正确插值（公转 / 呼吸 / 旋转这类
> 「跨时间段动同一维度」的动画不会再用后面的段把前面的钉死）。此前这些都不可用，现在可放心写。

---

## 0. 先纠正一个认知：动画「存在」≠ 观众「看懂」

首个太阳系 demo 里行星**真的在动**，但观感像 PPT —— 因为缺少「运动可读性」设计。四条通用技巧，
任何主题都要用：

1. **静止参照物**：运动体旁边要有**不动的路径 / 网格 / 刻度 / 背景点**，否则慢速位移会被读成「静止画面里的两个随机点」。→ 轨道环、坐标格、背景星点、进度刻度。
2. **拖尾 / 残影**：在运动体后方按帧滞后放几个**逐渐变淡变小**的副本，方向与速度一眼可读。→ 见 §2 的 `trail` 模式。
3. **合理的速率**：一圈 / 一次往复的时长控制在 3–12s；太慢（>15s 一圈）相邻截图几无差别，太快则看不清。周期 / 相位各异能自然形成层次。
4. **别用全屏大标题压住运动**：`variant:'title'` 自带 84px 大字 + 全屏 `rgba(0,0,0,.35)` 压暗层，会盖住画面中央的运动。需要字幕时用**底部 `subtitle`**（小字 + 底部胶囊），中心运动保持可见。

---

## 1. 必知的契约坑（写错会被忽略 / 拒收）

- **透明度不在 `transform` 里**。`transform` 只认 `x / y / scale / rotation`。任何透明度
  必须写进 `color`，用 `rgba(r,g,b,a)` 形式（如 `color: 'rgba(150,190,235,0.3)'`）。写在
  `transform.opacity` 上会被契约静默忽略（不报错，但没效果）。
- **真圆要算像素空间再换算**：`box.x / box.y` 是 0–100 的画布百分比，x 按宽、y 按高各自换算。
  直接 `x:50+rcost` 当百分比用，在 1280×720 下会把正圆拉成扁椭圆。正解：
  `x% = cx + r·cos(θ) / (W/100)`，`y% = cy + r·sin(θ) / (H/100)`（`motion-helpers.mjs` 的
  `trueCirclePoint` 就是这个）。同理正多边形、等距网格都要先算像素再除。
- **转场必须落在重叠区**：`transition` 的 `startFrame` + `durationInFrames` 必须同时压住
  `fromTrackId` 和 `toTrackId` 两个内容轨的**重叠区间**，否则报「完全不相交」拒收。务必让相邻
  内容轨人为重叠 10–20 帧。
- **`animate.startFrame / durationInFrames` 必须整数帧**；`easing` 只接受
  `linear / easeIn / easeOut / easeInOut`。
- **位置只能有一处来源**（二期）：`orbit`、`transform.x/y`、`animate.from/to` 的 `x/y` 三选一。
  写了 `orbit` 又写 `x/y` 会被直接拒收（不是静默忽略）。
- **圆周运动别手算了**：`orbit` 一行声明就够，上面的像素↔百分比换算是给老写法 / 拖尾留的。

---

## 2. 范式库（可直接改写的 manifest 片段）

下面每个范式给「轨道形状 + 关键 `animate` 写法」。坐标按 `W=1280,H=720` 举例，换画幅按比例调。

### 2.1 中心环绕 / 卫星（hub + revolving bodies）
适用：太阳系、原子结构（核 + 电子）、齿轮系的中心轮、地月、任意「一个中心 + 多个绕转体」。
- 中心体放 `box:{x:50,y:50}`，可加 `pulseSegs` 呼吸。
- 每个绕转体：**用 `orbit` 一行声明**（二期 A1 起是一等字段，见 `manifest-contract.md`），
  **不要再手算 24 段关键帧**——`orbit` 的半径按画布百分比，宿主按帧求值，圆是数学圆。
- 可读性：给每条轨道铺一圈**点状环**（静止参照）+ 给绕转体加 **拖尾**（§2.6）。
```js
// 一颗绕转体（半径 26% 屏宽，10 秒转一圈，从正上方起转，逆时针）
{ id:'body-0', type:'shape', shape:'circle', color:'#5AA9FF',
  box:{x:0,y:0,w:3.4,h:3.4}, startFrame:0, durationInFrames:300, fadeFrames:0,
  orbit:{ center:{x:50,y:50}, radius:26, startAngle:-90, periodInFrames:300, direction:'ccw' } }
```
内圈快、外圈慢更像天体（`periodInFrames` 按半径的 1.5 次方给）。要「同一面朝观众」就不要叠 `rotation`。

> 老的 `orbitSegs(...)` 手算写法**仍然可用**（历史 manifest 兼容），但新组装一律用 `orbit`：
> 少一次像素↔百分比换算，就不会踩 §1 的椭圆坑。

### 2.2 平移 / 流动 / 信号 / 入场
适用：子弹飞行、信号传播、数据流入、元素依次出场、字幕卡滑入。
- 单段 `animate` 从 `from` 到 `to`，`easing:'easeOut'`（入场）或 `'easeIn'`（出场）。
- 多个元素「依次出场」：用**同一套入场 animate**，只错开 `startFrame`（接力 / 序列揭示，见 §2.5）。
```js
// 字幕 / 卡片滑入（右侧滑入 + 淡入）
{ id:'card-1', type:'textCard', variant:'subtitle', text:'…', startFrame:30, durationInFrames:120, fadeFrames:0,
  animate:{ from:{x:115,opacity:0}, to:{x:50,opacity:1}, durationInFrames:18, easing:'easeOut' } }
```

### 2.3 呼吸 / 脉动 / 尺寸强调
适用：太阳 / 原子核发光、心跳、强调某个数字、加载态。
- 两段首尾相接的 `scale`（lo→hi→lo），循环若干次（`pulseSegs`，整数帧）。
```js
{ id:'core', type:'shape', shape:'circle', color:'#FFC94A', box:{x:50,y:50,w:7.5,h:7.5},
  startFrame:0, durationInFrames:360, fadeFrames:0,
  animate: pulseSegs(360, 6, 1, 1.1) }   // 6 个呼吸周期，1→1.1→1
```

### 2.4 原地旋转
适用：指针、齿轮、加载环、强调翻转、雷达扫描线。
- 多段 `rotation` 关键帧（CV-336 后多段可用），`rotateSegs`（见 §4）。
```js
{ id:'gear', type:'shape', shape:'rect', color:'#9fb4d8', box:{x:50,y:50,w:20,h:20},
  startFrame:0, durationInFrames:360, fadeFrames:0,
  animate: rotateSegs(360, 2) }   // 转 2 圈
```

### 2.5 序列揭示（sequential reveal）
适用：并列清单逐项点出、步骤依次出现、要素逐步聚集。
- **不**写复杂动画，只让同组元素错开 `startFrame` 各带一段入场 `animate`（§2.2 那种）。
- 入场 15–24 帧即可，动一次就停，避免全场乱动没重点。

### 2.6 拖尾 / 残影（运动可读性关键）
适用：任何移动体，让方向与速度可读。
- 在运动体**下方**（先入栈）放 N 个副本，每个落后 `lagFrames` 帧、更淡更小。
- 圆周运动的拖尾要按 `lagPhaseOffset(period, lag)` 修正相位，使其精确落在轨迹后方。
```js
// 落后 3 帧的拖尾（绕转体 body-0 的后方残影）
{ id:'body-0-trail-0', type:'shape', shape:'circle', color:'rgba(90,169,255,0.32)',
  box:{x:50,y:50,w:3.4,h:3.4}, startFrame:0, durationInFrames:360, fadeFrames:0,
  transform:{scale:0.92},
  animate: orbitSegs({cx:50,cy:50,radiusPx:150,periodFrames:180,totalFrames:360,
    phase: lagPhaseOffset(180,3), W:1280,H:720}) }
```

### 2.7 量级对比（一瞬到位、各给不同 scale）
适用：「A 是 B 的 3 倍」「市场规模对比」。
- 同一 `startFrame` 到位、各给不同 `to.scale`（起点可一致），让「差多少」自己说话。
- 不要做宽度动画（契约无 `box.w` 动画），用 `scale` 近似。

### 2.8 收敛 / 发散（从散到点 or 从点到散）
适用：要素汇聚成结论、信息爆炸、粒子聚合成形。
- 收敛：每个元素 `from` 在不同远点、`to` 在中心附近，同 `startFrame`；反向即发散。
- 配合 `opacity` 在 `color` 里（淡入）。

### 2.9 路径生长（描边一笔画出）
适用：路线 / 因果链 / 流程 / 示意图轮廓 / 手绘风线条 / 「从左到右长出」的时间轴。
- 用 `shape:"path"` + `d`（0–100 双轴百分比坐标）+ `draw` 控制生长；
  **不要**用多个 shape 拼折线，也不要指望 `animate` 去插值 `d`（契约里 `d` 不支持动画）。
- 想「边画边走」：路径轨加 `draw`，再放一个小圆走 `orbit`（半径/圆心与路径端点近似）或用短
  `animate` 平移过去 —— 两者都是独立轨，各自按帧求值，天然同步。
```js
// 一条从左下到右上的曲线，90 帧内画完（先画完再停留）
{ id:'route', type:'shape', shape:'path', color:'#7DD3FC', strokeWidth:0.8,
  d:'M 12 74 C 32 40, 58 88, 86 30',
  startFrame:60, durationInFrames:150, fadeFrames:0,
  draw:{ to:1, durationInFrames:90, easing:'easeInOut' } }
```
注意 16:9 下 x/y 单位不等长（`preserveAspectRatio="none"`）：画「圆感」曲线时 x 方向的跨度为 y
方向的 1.78 倍才不变形。

---

## 3. 决策表（agent 组装时照此选范式）

| 内容关系 | 选用范式 | 必加可读性 |
| --- | --- | --- |
| 中心 + 绕转体（行星/电子/卫星） | 2.1（`orbit`）+ 2.3(中心呼吸) | 轨道环(静止) + 拖尾(2.6) |
| 流动 / 信号 / 入场 | 2.2 | 起点/终点参照物 |
| 发光 / 强调 / 心跳 | 2.3 | 静止背景对比 |
| 指针 / 齿轮 / 雷达 | 2.4 | 固定刻度环 |
| 并列清单 / 步骤 | 2.5 | 错峰节奏 |
| 数量级对比 | 2.7 | 同屏并排 |
| 汇聚 / 发散 | 2.8 | 轨迹参照 |
| 路线 / 因果链 / 流程 / 轮廓 | 2.9（`path` + `draw`） | 端点标记 + 画完停留 |

样式层（与范式正交，随时可加）：`fx: glow`（发光主体）、`fx: stroke`（亮底文字）、
`fx: shadow`（卡片浮起）、`fx: blur`（背景虚化）、`fx: maskFade`（波形/列表底部淡出）。
有 BGM / 旁白且要「让声音看得见」时叠一条 `audioViz` 轨（`mode:"mirror"` + `fx:"maskFade"` 最好看）。

**铁律**：动得要有理由（不是为动而动）；入场 0.5–0.8s 就停；字幕卡(`subtitle`)仍首尾相接硬切、
不给 `fadeFrames`（避免接缝闪背景）—— 这条不变。

---

## 4. 复用代码（不要手写 24 段关键帧）

`scripts/remotion-verify/motion-helpers.mjs`（仓内参考实现）导出了上面所有范式的生成器，可直接 import
复用，也是「如何计算关键帧」的权威参考实现：

- `trueCirclePoint(cx,cy,radiusPx,angle,W,H)` — 像素空间真圆坐标。
- `orbitSegs({cx,cy,radiusPx,periodFrames,totalFrames,phase,W,H,segmentsPerRev})` — 圆周运动段数组。
- `pulseSegs(totalFrames,cycles,lo,hi)` — 呼吸段数组。
- `rotateSegs(totalFrames,turns,startFrame?)` — 原地旋转段数组。
- `travelSegs({from,to,startFrame,durationInFrames,easing?})` — 单段平移。
- `lagPhaseOffset(periodFrames,lagFrames)` — 拖尾相位修正。
- `rgba(rgb,alpha)` / `rnd(seed)` — 透明度写法 / 确定性随机。

LLM 在组装 manifest 时若需手写关键帧，按这些函数的公式推算坐标即可（圆周每圈 24 段 ≈ 每段 15°，
弦高在最大半径上也仅数像素，足够平滑）。
