# 参考片拆解 · 《究竟什么是光》（Kurzgesagt）· 首支真实样本

> **蓝本**：B 站 `BV1Pt41167vp` p=15，cid `69284100`，UP「丢我刘某」搬运的 Kurzgesagt 中文合集。
> **用途**：按 [`../plans/2026-11-08-参考片挑选层借鉴方案-讨论稿.md`](../plans/2026-11-08-参考片挑选层借鉴方案-讨论稿.md) 的四步法，把一支**真实参考片**走完「收集 → 拆解 → 挑选 → 制作」，回答「我们的 app 要做出这个效果需要怎么做」。
> **状态**：讨论稿配套样本，未拍板、未领 CV 号、未登记 STATUS、**无代码改动**。
> **取证**：本地下载 p15 正片（1920×1080 / 25fps / 278.85s / 17MB），`ffprobe` + `ffmpeg` 抽帧 + 逐像素统计。**不采信搬运标题与简介**。

---

## 0. 可复现的取证链

```bash
# 1) 稿件与分 P
curl -s -H 'User-Agent: Mozilla/5.0' \
  'https://api.bilibili.com/x/web-interface/view?bvid=BV1Pt41167vp' -o /tmp/bili-view.json
# 2) p15 流地址（qn=32 → 1080P / mp4 / 单段 18MB）
curl -s -H 'User-Agent: Mozilla/5.0' -H 'Referer: https://www.bilibili.com/' \
  'https://api.bilibili.com/x/player/playurl?bvid=BV1Pt41167vp&cid=69284100&qn=32&fnval=0&fourk=0' \
  -o /tmp/bili-play.json
# 3) 下载（URL 带时效，用 JSON 里的 durl[0].url）
# 4) 抽帧总览：每 14s 一帧，4×5 拼版
ffmpeg -v error -i kurz-light.mp4 -vf "fps=1/14,scale=480:270,tile=4x5" -frames:v 1 /tmp/kurz-sheet.jpg
# 5) 色彩状态：每 5s 一帧缩到 160×90 rawvideo，逐帧取主色
ffmpeg -v error -i kurz-light.mp4 -vf "fps=1/5,scale=160:90" -f rawvideo -pix_fmt rgb24 /tmp/kurz-5s.raw
# 6) 硬切检测
ffmpeg -v info -i kurz-light.mp4 -vf "select='gt(scene,0.3)',showinfo" -f null - 2>&1 | grep pts_time
```

**实测结果**：

| 项 | 值 |
|---|---|
| 规格 | 1920×1080 / 25fps / 278.85s / 6970 帧 |
| `scene>0.3` 硬切点 | **仅 2 个**：102.16s、235.28s |
| 字幕轨 | `x/player/v2` 返回 `subtitles: []`（无 CC 字幕文件） |
| 看点章节 | `view_points: []` |
| 全片主色占比 | `#101030`(量化) 21.9% > `#f0f0f0` 13.0% > `#f0e010` 7.1% > `#f0d0c0` 6.2% > `#4000b0` 5.8% |

> **2 个硬切 / 279 秒** 是这支片子最重要的一个数：**它不靠剪辑，靠整屏连续变形与换色推进**。

---

## 1. 拆解表（文章「三块」口径）

### 1.1 内容理解 —— 「作者说的」与「画面实证的」分开记

| 类别 | 内容 |
|---|---|
| **搬运标题说的** | 「【中文字幕】简而言之（kurzgesagt）科普动画合集」，p15 =「究竟什么是光」 |
| **简介说的** | 原频道在 YouTube，动画形式科普天文/生理/物理，「语速适中，动画做的特别棒」 |
| **画面实证** | 抽帧总览 20 格 + 12 个精确时点 + 56 帧色彩采样：**未见烧录中文字幕**；画面内文字全为英文（标签 / 全屏大写标题 / 片尾说明卡）。`subtitles: []` ⇒ 中文若为外挂 CC 或未随画面烧录，**本片未实证**，不写进风格圣经 |
| **画面实证** | 全片扁平矢量、无实拍、无摄影机运镜、无景深、无光影材质；**无渐变、无投影、无描边实体**（唯一描边是白字蓝边，见 t200） |
| **结构主线** | 一个概念一屏：光 → 电磁波谱 → 波长尺度（γ 射线 / 氢原子 / 小行星 / 无线电波）→ 电场与磁场 → 「这图是骗人的」纠误 → 原子吸收 → 光速 → 收尾 |

**时间线（按实测色彩状态分段，±5s 采样误差）**：

| 约 | 色彩状态 | 画面主体 |
|---|---|---|
| 0–18s | 深紫 `#1e1137` | 六边形同心框 + 星空 + 黄色四角星（开场图标） |
| 20–48s | 白 `#fdfdfd` | 蜂巢六边形群、正弦波箭头条、`ELECTROMAGNETIC SPECTRUM` 标题、彩虹扇形射入一只眼睛 |
| 50–68s | 红 `#eb2942` | `GAMMA RAYS ~10 picometer`、氢原子圆、尺度标注 |
| 70–78s | 青 `#33d1cd` | `LOW FREQUENCY RADIO WAVE`、低频正弦波、`Asteroid that killed the dinosaurs` 尺寸对照 |
| 80–100s | 深紫 → 紫 `#6e48f2` | 蜂巢网格 + 小鸭符号角色、电场 / 磁场三条正弦波、`This image is a lie.` |
| 110–143s | 亮黄 `#fae518` | 手托红色球体、白色条带、六边形收缩成一点 |
| 145–162s | 浅粉/肉色 | 红色原子核 + 同心圆波纹 + `ATOM` / `ELECTRON` 标签 |
| 165–198s | 深蓝紫 `#4100b2` → 深紫 | `electric field` / `magnetic field` 波、蜂巢网格里的原子 |
| 200–203s | 洋红 `#dd0f78` | **满屏**白字蓝边粗斜体 `ELECTRO MAGNETIC RADIATION JUST HAPPENS TO MOVE THIS FAST.` |
| 205–243s | 深紫 → 亮黄 | 光点条带、正弦波箭头、星空收束 |
| 250–279s | 浅灰 `#ececec` | 旧式片尾卡（黑鸭 + 说明文字 + 四格推荐位） |

### 1.2 风格分析 —— 写到能照着做

| 维度 | 可测量描述 |
|---|---|
| **色板** | 深紫 `#1e1137`（主背景，全片 21.9%）／白 `#fdfdfd`／红 `#eb2942`／青 `#33d1cd`／紫 `#6e48f2`／亮黄 `#fae518`／深蓝紫 `#4100b2`／洋红 `#dd0f78`／片尾浅灰 `#ececec`／星黄 ≈ `#ffe500`。**每段只用一个满屏底色 + 1–2 个主体色**，不叠加第三种大面积色 |
| **版式字体** | 无衬线粗体、全大写、斜体用于强调句；标签是小型全大写无衬线（`GAMMA RAYS` / `ATOM`）；中文没有出现 |
| **构图** | 满屏、居中、单主体；主体常占 40–80% 画幅；**没有卡片容器、没有边框、没有圆角面板** |
| **运动与镜头** | 无摄影机；元素做缩放 / 平移 / 旋转 / 生长 / 呼吸；几何元素**连续变形**接续到下一段（六边形 → 蜂巢 → 眼睛 → 扇形） |
| **转场** | 主体不变、底色整屏切换；或形状自身 morph 成下一物；硬切 ≈ 0 |
| **节奏** | 一个概念约 15–30s，远慢于我们按旁白句切的 3–8s；**色彩状态约 10 个**，其中洋红大字只留 ~3–5s 作重音 |
| **音画关系** | 原片旁白驱动，但**画面段落由概念边界决定，不由句子边界决定**；文字是画面的一部分（标签 / 全屏字），不是逐句字幕条 |
| **技术路线** | 逐帧矢量 motion graphics（≈ AE/Flash 的 shape tween），非视频生成模型、非实拍、非卡片堆叠 |

### 1.3 复用指南

- **可直接用的风格描述**：「深紫满屏底，扁平矢量，纯色块无渐变无阴影，一屏一个概念，几何主体居中放大，段间靠主体连续变形与整屏换色推进，全大写无衬线粗体只当标签用。」
- **一眼认出出处的标志性元素**：六边形/蜂巢网格、四角星闪光、同心圆波纹、正弦波箭头条、彩虹扇形射入眼睛、极简小鸭符号角色。
- **可迁移到别的题材的手法**（对应文章 37→49 条手法库）：
  - **数字做成可比的形状**：`~10 picometer` 的 γ 射线 ↔ 氢原子 ↔ 小行星 ↔ 无线电波，全用同一条正弦波的波长对比 ⇒ 直接可搬到四季片的「23.5° / 30 年 / 直射斜射」。
  - **朴素方案逐级失败**：先画「光 = 一条正弦波」的常见示意，再打上 `This image is a lie.` 自我推翻，然后逐级讲电场/磁场 ⇒ 科普片的最佳开场结构。
  - **每段换画风，锁死色板和字体**：段落底色换 10 次却不散，靠的就是色板与字体锁死。
  - **数值脊柱**：波长这个量贯穿全片，每一屏都在量同一个东西的不同尺度。
  - **首尾回环**：开场六边形星空 ↔ 收尾星空/蜂巢。
  - **情绪曲线 = 速度曲线**：洋红满屏大字是全片唯一重音，前后都慢。
- **本机做不到的部分**（见 §4）：形状 morph、实心任意路径、大量点群/蜂巢群、角色表演、描边空心大字。

### 1.4 索引记录（讨论稿落点 1 的第一份真实样本）

```jsonc
{
  "sourceUrl": "https://www.bilibili.com/video/BV1Pt41167vp/?p=15",
  "cid": 69284100,
  "part": "究竟什么是光",
  "durationSec": 278.85,
  "aspect": "16:9",
  "inputKind": ["一组知识点", "一段旁白"],
  "structureDriver": "知识点（概念递进），非句子边界",
  "techniques": [
    { "name": "数字做成可比的形状", "fit": "跨量级尺度对比", "unfit": "无量化对象的叙事件", "from": "本片 55–78s" },
    { "name": "朴素方案逐级失败", "fit": "存在普遍误解的科普题", "unfit": "纯陈述型资讯", "from": "本片 90–100s" },
    { "name": "每段换画风锁死色板", "fit": "长片多段", "unfit": "15s 内资讯速览", "from": "全片" },
    { "name": "数值脊柱", "fit": "全片围绕同一个量", "unfit": "多主题拼盘", "from": "波长贯穿" }
  ],
  "palette": ["#1e1137", "#fdfdfd", "#eb2942", "#33d1cd", "#6e48f2", "#fae518", "#4100b2", "#dd0f78"],
  "layers": {
    "结构骨架": "概念递进 + 首尾回环",
    "画面风格": "扁平矢量 / 满屏单色 / 无容器",
    "手法": "尺度阶梯 / 逐级纠误 / 数值脊柱",
    "节奏": "15–30s 一概念 + 一次 3–5s 满屏字重音",
    "声音": "按旁白，但切点跟概念不跟句"
  },
  "segments": [
    { "in": 55, "out": 78, "borrow": ["尺度阶梯", "波长对比"] },
    { "in": 90, "out": 100, "borrow": ["朴素方案逐级失败"] },
    { "in": 200, "out": 203, "borrow": ["满屏字重音"] }
  ],
  "representativeFrames": ["/tmp/kurz-sheet.jpg", "/tmp/kurz-t5.jpg", "/tmp/kurz-t45.jpg", "/tmp/kurz-t95.jpg", "/tmp/kurz-t145.jpg", "/tmp/kurz-t200.jpg"],
  "unverified": ["标题声称的中文字幕（画面未实证，subtitles: []）"]
}
```

> 按作者开源口径：**只挂原地址，不搬视频**。`sourceUrl` 是唯一持久引用；本地抽帧只是本次分析产物。

---

## 2. 挑选：选片篮 → 编译指令

```
参考：BV1Pt41167vp p=15《究竟什么是光》
借：
  结构骨架  ← 概念递进「一个概念一屏」+ 首尾回环
  画面风格  ← 扁平矢量 / 满屏单底色 / 无卡片容器 / 色板锁死
  手法      ← 数值脊柱（同一个量贯穿全片）+ 尺度阶梯 + 朴素方案逐级失败
  节奏      ← 段落由概念边界决定；全片留 1 次满屏字重音
  声音      ← 按旁白做画面（沿用项目既有路线）
段落级借用 ← I 55s / O 78s 只借「尺度阶梯」；I 200s / O 203s 只借「重音」
相似度：借骨架做差异（不照搬、不只取一两个手法）
不要：morph 形变、实心任意路径、角色表演（见 §4 换成什么画法）
时长 45s / 16:9 / 30fps / 中文 TTS
```

---

## 3. 风格圣经 + 负面清单

**风格圣经**：
1. 每段**一条**满屏纯色底，取自 §1.2 色板；段内不许出现第 3 种大面积色。
2. 主体是**纯代码几何**（六边形 / 圆 / 正弦波 / 同心圆 / 箭头条），居中，占 40–80% 画幅。
3. **禁止卡片容器、圆角面板、边框、投影、渐变**；`gradient` 形状不用。
4. 文字只有两种角色：小型全大写标签 / 一次满屏重音句。**不出现逐句字幕条**。
5. 段间用**整屏换色 + 帘式推进**，不用淡入淡出、不用硬切黑帧。
6. 旁白 4–5 字/秒先定稿，但**画面段落边界取概念边界**，不取句子边界。

**负面清单（可测量）**：

| # | 不要什么 | 判据 |
|---|---|---|
| N1 | 不要 PPT 卡片感 | 全片 `textCard` 轨 ≤ 2 条（标签 + 重音句） |
| N2 | 不要多色叠加 | 每帧主色 ≥ 75% 画幅，色板外主色 = 0 |
| N3 | 不要渐变/阴影/圆角 | `shape:'gradient'` = 0；`fx:shadow/glow` = 0 |
| N4 | 不要硬切黑帧 | 段间首尾帧主色覆盖率 ≥ 60% |
| N5 | 不要逐句字幕条 | `caption` 轨 = 0（**与项目现有纪律冲突，见 §6**） |
| N6 | 不要空概念段 | 每段至少 1 个几何主体 + 1 个标签 |
| N7 | 不要首帧裸 | 第 0 帧主体可见（Kurzgesagt 开场即六边形星空） |

---

## 4. 实现依赖表（**本文核心：app 到底能不能做**）

> 已核实到字段级，依据 `src/remotion/manifest.ts`、`src/remotion/components/Shape.tsx`、`src/remotion/shape-geometry.ts`、`skills/code-driven-explainer/references/{motion-patterns,shot-cards}.md`。

### A 档 · 今天就能做，不用改代码

| 效果 | 现成字段 | 出处 |
|---|---|---|
| 六边形同心框 / 蜂巢单元 | `shape:'polygon'`（源码写死 `polygonPoints(6)`，正好六边形）+ `box` | `shape-geometry.ts:95` |
| 黄色四角星闪光 | `shape:'path'` 描边 + `draw`，或用 `shape:'star'`（5 点）近似 | `Shape.tsx:47-85` |
| 正弦波箭头条 / 电场磁场波 | `shape:'path'` + `d`（0–100 双轴百分比）+ `draw` 生长；箭头用 `shape:'arrow'` | `motion-patterns.md` §2.9 / `shot-cards.md` E2 |
| 彩虹扇形射入眼睛 | 白底 + 多个 `shape:'circle'`（用 `box.w≠h` 拉成椭圆）叠出眼睛；扇形用 `transition:{effect:'clock'}` 或 `reveal:{kind:'wipe'}` 分色带 | `manifest.ts:556,715` |
| 尺度阶梯（10 picometer ↔ 小行星） | 动感范式 **§2.7 量级对比**：同一 `startFrame`、各给不同 `to.scale` | `motion-patterns.md:136` |
| 整屏换色 | 每段落一条 `shape:'rect'` 满屏轨；或 `colorShift:{from,to,...}` 做**平滑换色过渡**（`Shape.tsx:36` 已接线） | `Shape.tsx:35-36` |
| 帘式推进替代形变 | `reveal:{kind:'wipe',direction}` / `transition:{effect:'wipeLeft'|'wipeRight'|'clock'}` | `manifest.ts:556,725` |
| 同心圆波纹 / 原子 | 多 `shape:'circle'` + `animate` 缩放 / `orbit` 公转 | `shot-cards.md` E3 |
| 描边 / 轮廓类 fx | `fx:'stroke' | 'outline'` 是**容器级**滤镜（`manifest.ts:428`），**不等于文字描边空心字**（后者见 C 档缺口） | `manifest.ts:428` |

### B 档 · 加 1–2 个小字段就能做（可选，非必需）

| 缺口 | 现状 | 小改 |
|---|---|---|
| 正 N 边形 / 实心任意多边形 | `polygon` 写死 6 边；`star` 写死 5 点 | `ShapeTrack` 加可选 `sides` / `points`，纯函数 `polygonPoints(sides)` 已支持任意边数，**只需透传** |
| **path 只能描边，不能填充** | `Shape.tsx:71-77` 写死 `fill="none"` ⇒ 实心四角星 / 彩虹扇形 / 小鸭轮廓全部画不了 | 加可选 `filled?: boolean`（缺省 `false` ⇒ 老 manifest 逐帧不变）；这是**收益最大的一处小改** |
| 多段色板的语义化 | `recipes.ts:148` 只有一条整片 `bg` 轨 | 新增一条 recipe `flat-vector-scenes`：N 段满屏底色 + 标签位，不改渲染器 |

### C 档 · 结构性做不到 → 按文章口径**换成什么画法**

| 想要的效果 | 为什么做不到 | 改成什么画法 |
|---|---|---|
| **形状连续 morph**（六边形→蜂巢→眼睛） | `motion-patterns.md:158` 明写「**不要指望 `animate` 去插值 `d`（契约里 `d` 不支持动画）**」；确定性铁律下也不该引入逐帧路径插值 | **整屏换色 + `reveal:wipe` 帘式推进 + 同构几何缩放接续**；用同一六边形在不同段缩放/旋转/换色，让观众读出「同一个东西变了」，不靠轮廓真的变形 |
| **满屏白字蓝描边粗斜体** | `shot-cards.md` 能力缺口清单：「textCard 缺描边空心字样式 + 瞬时填充帧」 | 放弃描边，改用**实心白字 + 洋红底 + 极大字号 + 斜体**，靠高对比与字重做重音（不引入 `fx:shadow`，避免与 N3 冲突） |
| **数百点星空 / 蜂巢群聚形** | 能力缺口清单：「点群编排（数百点聚形拼数字），且成本必超标」；项目渲染预算本来就紧（RenderHost / msPerFrame） | 用 6–12 个 `shape:'circle'` 稀疏点 + `animate` 呼吸，或一张静态星点 `image` 轨（`kenburns` 微推） |
| **极简小鸭角色 / 手托球体** | 实心任意路径缺失 + 项目无角色库；文章结论 3 也说角色表演是代码做视频的结构性短板 | **用几何符号替代角色**：一个六边形 + 两个小圆当「观察者」，不做肢体动作；或直接不出现角色（本片角色只是点缀） |
| **15–30s 的慢段落** | 项目 `subtitle-timing.md` 要求句首尾相接、M1 20 分钟出片，段边界取 TTS 真值 | 45s 片不改：把「概念边界」映射成 3–4 个 TTS 段落组，每组内句仍首尾相接 |

### 结论（一句话分档）

**80% 像今天就能做**（一屏一概念 + 满屏纯色 + 扁平几何 + 尺度阶梯 + 路径生长 + wipe 推进）；**再 15% 靠两处小改**（`filled` 实心路径、`sides` 任意边数）；**最后 5% 是结构性短板**（morph / 点群 / 角色表演），按文章口径在方案阶段就换画法，不留到做到一半。

---

## 5. 可直接粘的 manifest 骨架（45s 试做片《光的波长》）

> 30fps / 1350 帧 / 16:9（试渲用 1280×720；正式档按 `resolution-tiers.ts` 的 1080p = 1920×1088 取）。
> **未渲染**（渲染需桌面端运行时），这里是给编排用的骨架，字段全部来自现有契约；`meta` / `global` / `variant` / `reveal` / `colorShift` 均已对源码核过。
> 结构 = 借本片前三个概念（六边形开场 → 波长尺度 → 满屏重音），**不复制其内容**。

```jsonc
{
  "id": "light-wavelength-45s",
  "meta": { "title": "光的波长", "width": 1280, "height": 720,
            "fps": 30, "durationInFrames": 1350, "backgroundColor": "#1e1137" },
  "global": { "fontFamily": "Noto Sans SC" },
  "tracks": [
    // 段1 0–150f：深紫 + 六边形同心框 + 四角星（对应 0–18s）
    { "id": "bg-1", "type": "shape", "shape": "rect", "color": "#1e1137",
      "box": { "x": 50, "y": 50, "w": 100, "h": 100 },
      "startFrame": 0, "durationInFrames": 150, "fadeFrames": 0 },
    { "id": "hex-1", "type": "shape", "shape": "polygon", "color": "#6e48f2",
      "box": { "x": 50, "y": 50, "w": 34, "h": 34 },
      "startFrame": 0, "durationInFrames": 150, "fadeFrames": 0,
      "animate": { "from": { "scale": 0.6, "opacity": 0 }, "to": { "scale": 1, "opacity": 1 }, "durationInFrames": 24 } },
    { "id": "spark", "type": "shape", "shape": "star", "color": "#fae518",
      "box": { "x": 50, "y": 50, "w": 5, "h": 5 },
      "startFrame": 12, "durationInFrames": 138, "fadeFrames": 0 },

    // 段2 150–375f：白底 + 正弦波路径生长（电磁波谱）
    { "id": "bg-2", "type": "shape", "shape": "rect", "color": "#fdfdfd",
      "box": { "x": 50, "y": 50, "w": 100, "h": 100 },
      "startFrame": 150, "durationInFrames": 225, "fadeFrames": 0,
      "reveal": { "kind": "wipe", "direction": "right", "durationInFrames": 18 } },
    { "id": "wave", "type": "shape", "shape": "path", "color": "#1e1137", "strokeWidth": 0.8,
      "d": "M 2 50 Q 8 20 14 50 T 26 50 T 38 50 T 50 50 T 62 50 T 74 50 T 86 50 T 98 50",
      "startFrame": 150, "durationInFrames": 225, "fadeFrames": 0,
      "draw": { "to": 1, "durationInFrames": 90, "easing": "easeInOut" } },

    // 段3 375–750f：红底 → 青底，尺度阶梯（量级对比范式 §2.7）
    { "id": "bg-3", "type": "shape", "shape": "rect", "color": "#eb2942",
      "box": { "x": 50, "y": 50, "w": 100, "h": 100 },
      "startFrame": 375, "durationInFrames": 375, "fadeFrames": 0,
      "colorShift": { "from": "#eb2942", "to": "#33d1cd", "startFrame": 150, "durationInFrames": 60 } },
    { "id": "scale-small", "type": "shape", "shape": "circle", "color": "#fae518",
      "box": { "x": 24, "y": 50, "w": 3, "h": 3 }, "startFrame": 400, "durationInFrames": 300, "fadeFrames": 0 },
    { "id": "scale-large", "type": "shape", "shape": "circle", "color": "#fdfdfd",
      "box": { "x": 70, "y": 50, "w": 26, "h": 26 }, "startFrame": 400, "durationInFrames": 300, "fadeFrames": 0,
      "animate": { "from": { "scale": 0.4 }, "to": { "scale": 1 }, "durationInFrames": 24 } },

    // 段4 750–1050f：亮黄 + 六边形收缩（首尾回环的「同构几何」替代 morph）
    { "id": "bg-4", "type": "shape", "shape": "rect", "color": "#fae518",
      "box": { "x": 50, "y": 50, "w": 100, "h": 100 },
      "startFrame": 750, "durationInFrames": 300, "fadeFrames": 0,
      "reveal": { "kind": "wipe", "direction": "right", "durationInFrames": 18 } },
    { "id": "hex-2", "type": "shape", "shape": "polygon", "color": "#fdfdfd",
      "box": { "x": 50, "y": 50, "w": 40, "h": 40 },
      "startFrame": 750, "durationInFrames": 300, "fadeFrames": 0,
      "animate": { "from": { "scale": 1 }, "to": { "scale": 0.25 }, "durationInFrames": 150 } },

    // 段5 1050–1350f：洋红满屏重音（N5 例外：全片唯一一条 textCard）
    { "id": "bg-5", "type": "shape", "shape": "rect", "color": "#dd0f78",
      "box": { "x": 50, "y": 50, "w": 100, "h": 100 },
      "startFrame": 1050, "durationInFrames": 300, "fadeFrames": 0,
      "reveal": { "kind": "wipe", "direction": "right", "durationInFrames": 18 } },
    { "id": "punch", "type": "textCard", "variant": "title",
      "text": "光，只是波长不同的同一件事",
      "box": { "x": 50, "y": 50, "w": 88, "h": 46 },
      "startFrame": 1080, "durationInFrames": 270, "fadeFrames": 0 }
  ]
}
```

**验收方式**（沿用项目纪律，不采信描述）：
`spotFrames` 一次取满 ≤8 帧（第 0 / 段间前后 / 正弦波生长中 / 末帧）→ 逐张 `read_image` 看成片像素 → 按 N1–N7 逐条打勾（主色占比、卡片容器数、渐变/阴影数、段间覆盖率、首末帧主体）。**若 `path` 的 `draw` 出现虚线（Q-A2 已知 Chrome 150 dash 问题），按 `pitfalls.md §9` 临时去掉 `draw`。**

---

## 6. 与项目现有纪律的冲突（**这比能力缺口更要紧**）

| # | 冲突 | 项目现状 | 判断 |
|---|---|---|---|
| **C3** | **字幕主导 vs 画面主导** | `code-driven-explainer` 是「旁白定稿 → TTS 真值 → 段边界取真值 → caption 逐句首尾相接」，词级卡拉OK是硬规格 | 本片**没有逐句字幕条**，文字是画面的一部分。若硬套，N1（≤2 条 textCard）与「一句一条字幕卡」正面冲突。**照搬风格 = 违反 skill 纪律** ⇒ 只能借骨架与手法，字幕层保留项目口径 |
| **C4** | **裸画面 lint** | `verification.md` / 体检会把静态占比、运动密度、首末帧覆盖当告警 | 本片 t145 是「纯黄 + 一个白六边形」，按我们的体检极可能被判「静态图文 / 裸画面」。**这是两种成片范式的冲突，不是缺陷** ⇒ 若开这条路线，需要给体检一个 `flat-vector` 档位豁免，否则永远过不了 |
| **C5** | **整屏换色 vs 段边界取真值** | 段边界来自 TTS；`colorShift` 是轨内相对帧 | 换色窗口必须挂在 TTS 段边界上，否则音画错位。45s 片建议 4–5 段，别按原片 10 段做 |
| **C1/C2** | 打断次数 / 静帧先行 | 见讨论稿 §4 | 结论不变：相似度进意图卡预置，代表帧拼版降级为静态物 |

**所以真正的答案是：不要把这支片子当「模板」照搬，要当「手法库」借。** 照搬风格会同时踩 C3、C4 两条产品纪律。

---

## 7. 落地路径（按投入排序，每步可单独停）

| 阶段 | 动作 | 前置 | 验收 |
|---|---|---|---|
| **P0 · 今天** | 用 §5 骨架跑一条 45s《光的波长》，**零代码改动**；验证 A 档能力是否真能出「一屏一概念」 | 桌面端可渲染（RenderHost 批 0.2 修好后更稳） | N1–N7 逐条像素判据；与四季片 A/B 版横比「像不像 Kurzgesagt」 |
| **P1 · 小改** | ① `ShapeTrack.filled?: boolean`（缺省 false，老 manifest 逐帧不变）② `sides` 透传给 `polygonPoints(sides)` ③ 新增 recipe `flat-vector-scenes` | 契约同步三件套（生成物字段表 / component-contract / 手写分册）+ 反向变异 | 实心四角星、任意边数多边形可渲；老 manifest 像素哈希不变 |
| **P2 · 编排** | 把「概念边界」与「TTS 段边界」的映射写进 skill 分册；给体检加 `flat-vector` 档位（C4） | P0 真机结论 | 体检不再误报「静态图文」；概念段落与旁白段落可对齐 |
| **P3 · 不立项** | morph 形变 / 点群聚形 / 角色库 | — | 按文章口径换画法，不补这些能力（成本与确定性铁律都不划算） |

---

## 8. 待拍板

1. **这支片子是「模板」还是「手法库」**？我建议后者（§6 两条硬冲突）。
2. **P0 试做片做哪条**：《光的波长》45s 新片，还是**用四季片同题重跑一版 Kurzgesagt 风格**（后者能和 A/B 两版三方横比，判尺现成）？
3. **要不要开 P1 两处小改**（`filled` / `sides`）？收益大、风险低，但会动 `Shape.tsx` 与契约生成物。
4. **C4 体检档位**：是给 `flat-vector` 加豁免，还是干脆要求这条路线也满足现有运动密度（等于放弃纯色慢段落）？
5. **C3 字幕**：借风格时保留词级卡拉OK（项目口径），还是为这条路线出「无字幕条」变体（会动主 skill 纪律）？

---

## 9. 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-08 | 首版。按讨论稿四步法，以 B 站 p15《究竟什么是光》为首支真实参考片：可复现取证链、拆解三块、索引 JSON 样例、选片篮指令、风格圣经与 N1–N7、字段级实现依赖表（A/B/C 三档）、可直接粘的 45s manifest 骨架、与项目纪律的 5 条冲突、P0–P3 落地路径、5 项待拍板。未渲染、未改代码、未拍板、未领 CV 号。 |
