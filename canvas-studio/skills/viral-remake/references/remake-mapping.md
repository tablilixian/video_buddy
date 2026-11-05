# 爆款复刻映射分册 —— 拆解表 / 轨道映射 / 转场全表 / 批量变量

> 本文是 `viral-remake` 的细则分册。manifest 字段级契约（校验规则、必填、取值域）
> 以 `code-driven-explainer/references/manifest-contract.md` 为准，本文不重复，
> 只写「参考片元素 → 用哪条轨、哪个字段」的映射决策与模板。

## 1. 爆款拆解表（模板）

| 镜 | 起–止(s) | 时长 | 内容类型 | 元素与动效 | 转场入 | 字幕/文案 | 素材需求 |
|----|---------|------|---------|-----------|--------|----------|---------|
| 1 | 0.0–1.8 | 1.8 | 静帧图 | 产品图从底部弹入（y -30%→0 + scale 0.7→1，backOut）；标题字镂空淡入 | — | 标题「一口爆汁」 | 产品图 A（user，白底 → image_matting） |
| 2 | 1.8–4.2 | 2.4 | 实拍段 | 实拍推近（kenburns）；装饰星体缓慢漂浮（orbit cw） | zoom | 无 | 生视频：草莓挞特写（generated） |
| 3 | 4.2–6.0 | 1.8 | 数据卡 | 柱状逐根长出（draw，easeOutCubic）；背景色随口味同步切换 | crossWarp | 「29.9 / 3 种口味」 | 数据来自用户 |
| 4 | 6.0–8.0 | 2.0 | 口播字幕 | 字逐字点亮（caption 词级）；产品轻微浮动（orbit） | fade | 「点击下方链接」 | tts_voiceover 第 4 句 |

规则：

- **落表的数据来源（CV-402 三层分工）**：表头真值（片长 / fps / 音轨 / 参考片 LUFS）
  用 `media_probe` 探；段边界（起–止秒）以 `evidence_grid` 的实测切点为骨架（缺省
  1s/格概览 → 红框密集段二次 `passes` 密采）；镜内内容语义由 `video2vl`（缺省
  shot-breakdown）逐镜补。网格页图落在本地产物里，要核对某格画面时 `read_image(file_path=…)`
  看图即可（读图给语义）；但**切点定位一律以实测切点为准**——不要用 inspect_image 逐帧
  轮询找切点，也不要靠「看一眼网格图」定段边界。
- 时长 0.1s 精度；**镜序即轨道接续顺序**，也是 transition 轨
  `fromTrackId → toTrackId` 的连接顺序。
- **「元素与动效」列是灵魂**：逐元素回答「什么在动 / 怎么动 / 什么曲线 / 和谁
  联动」。原片观感 80% 来自元素级运动与联动（菜单切换 → 商品+标题+背景同步换），
  版式只占 20%。拆不出动效列 = 复刻必然退化成静态轮播。
- 内容类型六选一：`实拍段 / 静帧图 / 口播字幕 / 文案卡 / 数据卡 / 节奏装饰`；
  拿不准按画面主体归，一镜只归一类（复合镜拆两条轨同段叠放）。
- 「转场入」= 上一镜 → 本镜的效果名（§3 全表就近选）。
- **落表即回核**：拆解表写完先跑 `verify_teardown`（videoPath + segments）——
  matched 边界回报实测切换时刻，偏差 >0.3s 的段起点按实测校准；unmatched =
  边界可疑、extraSwitches = 疑似漏段/漏镜，改表重核通过后才能进 §2 映射。
  这是时序闸（成片 vs 拆解表偏差 ≤0.2s）能成立的前提：表先对，片才能对。
- 「素材需求」列即总纲 §07 素材清单的来源：`generated`（生图/生视频）/
  `user`（用户提供）/ `library`（素材库）；placeholder 也要登记，不漏项；
  **需要透明底的条目标注「白底 → image_matting」**。
- **落库**：回核通过的拆解表 `teardown_store`（`action:"save"` + videoPath +
  segments）按参考片指纹入库 —— 跨会话/跨项目复用；`load` 取回后仍要回核对版
  （参考片可能换版），对得上再进映射。备注（`note`）顺手写参考片响度实测等结论。
- **拆解段的结构化形态**：进渲染时把每段以 `[{label, startSec, endSec,
  elements:[…动效元素]}]` 传给 `render_composition` 的 `timingSegments`
  （elements = 「元素与动效」列逐元素一条，素材内部运动不单列）—— 宿主渲完自动
  做时序回核（Q2）与元素覆盖核对（Q3），选档参考 §3.7。

## 2. 内容类型 → 轨道映射

| 参考片元素 | 轨道 | 关键字段 | 决策备注 |
|---|---|---|---|
| 实拍段（产品演示/人物/食物） | `video` | `src`（同源 URL） | 素材先落画布（生视频走画布 video 节点，产物引用资产 URL）；一镜一段，不剪辑 |
| 静帧/产品图 | `image` | `fit: cover / contain / kenburns` | `kenburns` 推近营造节奏；多图轮换 = 多条轨接续 + 转场；**一张精灵图切多格** → 每格一条轨 + `sourceRect {x,y,w,h}` 百分比子区域（0–100，与 box 同口径，越界硬失败） |
| 口播/歌词逐字 | `caption` | `src` + `text`（单句一条轨） | 词级卡拉OK；`words` 显式时间戳或能量谷推导（±1–3 帧） |
| 句级字幕条/标题卡 | `textCard` | `variant: subtitle / title`、`anim` | `anim` 四选一：`fadeUp` / `maskReveal` / `typewriter` / `wordStagger` |
| 要点列表 | `textCard` | `variant: bullets` | 逐行入场；数据真成表用 chart |
| 数据卡（单卡键值） | `textCard` | `variant: dataCard` + `data` | 键值对形态 |
| 数据表/对比图 | `chart` | `variant: bars / dual`、`labels`/`values` | dual 必给 `lineValues`；单位写 `unit` |
| 「每镜多长」结构数据 | `chart` | `source: 'timeline'` | 从 video 轨真值推导，零手填；与内联数据互斥 |
| 节奏装饰（几何/光效/线条） | `shape` | `rect / circle / line / gradient / path / arrow / triangle / star / polygon` | 配 `orbit` / `draw` / `fx`（glow/stroke/shadow/blur/maskFade） |
| 镂空描边大字（品牌站常态） | `textCard` | `fx: 'outline'` | 填充透明 + 奶油白粗描边（描边色 v1 固定；需要别的色 → 自绘素材或后端增强） |
| 透明底素材 | `image` | 产物 `<原名>-alpha.png` | **四步工序（拆解表含产品元素时缺步不许渲）**：① 生图提示词固定「纯白背景，主体居中占画面 60% 以上」→ ② `image_matting`（key 缺省 white）→ ③ `inspect_image` 核对 colorType=6 → ④ alpha PNG 直引 image 轨——引擎按 hasAlpha 跳过深底垫底，透明底真正融入场景。**禁止**伪透明拼贴（棋盘格残边）；实拍照白底抠不干净 → 回到 ① 换 AI 重绘再抠，不要拿 colorkey 啃复杂照片 |
| BGM 情绪可视化 | `audioViz` | `mode: bars / mirror / line`、`bandSplit` | 参考片有强节拍感时加；`bandSplit` 六频段分色 |

### 2.5 硬边界：每个会动的元素 = 一条独立轨

- 背景 / 标题 / 产品 / 装饰 / 底栏 / 进度条……凡是参考片里**位置、大小、颜色、
  透明度随时间变**的东西，都必须是独立轨道 + `animate`（显式 `easing`）或 `orbit`。
- **禁止把整帧画面烤成静态图再 fade 轮播**——那是幻灯片。烘焙卡图只允许用于
  「参考片里确实完全静止的整体版式底图」，且底图之上仍要拆可动元素。
- 联动 = 拆解表「元素与动效」列里的「和谁联动」→ 同一 `startFrame` + 同 `easing`
  家族（如菜单切换瞬间，产品轨 backOut 弹入、背景 shape 轨换色、标题轨 maskReveal
  同时发生）。

## 3. 转场全表（11 式，就近选近似）

| 效果 | 视觉形态 | 什么时候选 |
|---|---|---|
| `fade` | 交叉淡化 | 默认温和切换 |
| `slide` | 平移推入 | 换场景/换话题；`direction` 四向 |
| `zoom` | 推近切换 | 强调/进入特写 |
| `dissolve` | 溶解 | 时间流逝/回忆感 |
| `wipeLeft` / `wipeRight` | 硬边擦除推进 | 分屏对比/清单推进；`softness` 软化边缘 |
| `clock` | 时钟扇形扫描 | 倒计时/过程展示 |
| `flipX` | 压扁翻面 | 卡片翻转/前后对比 |
| `zoomBlur` | 径向模糊推近 | 高能卡点/冲屏 |
| `linearBlur` | 方向模糊横移 | 快速横移剪辑感 |
| `crossWarp` | 水平挤压交换 | 动感换场 |

- 参数：`easing`（缓动白名单，见契约分册）、`softness`（只对 wipe 生效）、
  `direction`（只对 slide/wipe 生效）。转场时长建议 0.3–0.5s，从后一镜起始帧
  往回叠。
- **近似口径**：参考片的转场名字对不上就按视觉形态就近选；渲染器不支持真模糊
  粒子与 3D 透视（基准归因 A2/A9），`zoomBlur` / `linearBlur` / `crossWarp` 是
  基准实测的近似式，视觉有差异要向用户说明。

### 3.5 缓动速查（每条 animate 都显式选档，缺省 linear 没有生命感）

| 曲线 | 缓动档 | 什么时候用 |
|---|---|---|
| 弹跳跃入（商品从底部跳上来、卡片弹出） | `backOut` | 参考片「跳一下」的感觉就是它——过冲再回稳 |
| 柔性滑动（卡片轻弹、悬浮贴合） | `spring` | 连续小幅震荡的贴合感 |
| 快出缓停（飞入、放大收尾） | `easeOutCubic` / `easeOutQuart` / `easeOutExpo` | 入场动画最常用的三档，越靠后前段越猛 |
| 缓入（淡出、渐隐先行） | `easeIn` / `easeInCubic` | 元素离场 |
| 往复 | `easeInOutCubic` / `easeInOutExpo` | 来回移动、呼吸缩放 |
| 匀速机械感 | `linear` | 仅传送带/扫描线类机械运动；**人物/产品/标题禁用** |

### 3.6 产品跳升 preset（实测配方，直接套用）

参考片最常见的产品主动画：产品从画面底部跳升到画面中央。甜品复刻会话对原片
45 步逐帧实测拟合出的参数，**直接套用，不要现场重推**：

| 参数 | 值 |
|---|---|
| 位移 | `from.y ≈ 85–95`（0–100 垂直中心口径，起于画面底部）→ `to.y: 50` 居中落位 |
| 时长 | 12–18 帧（0.4–0.6s）；快节奏卡点取 12，常规段落取 15–18 |
| 缓动 | `easeOutCubic` —— 前 3 帧完成约 63% 位移的「快起长尾」，与原片手感一致 |
| 落位 | 到位即静止；拆解表写明「跳一下」才换 `backOut` |
| 联动 | 与背景换色轨、标题入场轨**同一 `startFrame` + 同 easing 家族**同时发生 |

manifest 片段（image 轨）：

```json
"animate": { "from": { "y": 90 }, "to": { "y": 50 }, "startFrame": 0, "durationInFrames": 15, "easing": "easeOutCubic" }
```

变体：菜单切换联动 → 每段产品各自一条轨、同 startFrame 跳升；多产品逐个入场 →
错峰 2–3 帧起步（除非拆解表写明「逐个入场」，否则保持同帧同时感）。

### 3.7 动效选型表（按元素类型直接查，别现场发明）

拆解表「元素与动效」列的描述关键词 → 动效档 auto 匹配（命中即选；preset 细参
§3.5 缓动速查 / §3.6 跳升配方）：

| 元素类型 | 拆解表描述关键词 | 选档 |
|---|---|---|
| 产品/主体 | 跳、跃入、从底部上来 | §3.6 跳升 preset（easeOutCubic，15 帧左右） |
| 产品/卡片 | 弹一下、Q 弹 | `backOut`（过冲回稳） |
| 标题/文案 | 淡入、浮现 | textCard `anim: fadeUp` |
| 品牌大字 | 镂空、描边字 | `fx: 'outline'`（或 §3.7 末的 fill+outline 双轨叠放） |
| 卡片/面板 | 滑入、推入、飞入 | `animate` 位移 + `easeOutCubic`/`easeOutQuart` |
| 装饰（星/光/线） | 漂浮、环绕、缓慢 | `orbit`；往复呼吸用 `easeInOutCubic` |
| 数字/数据 | 长出、逐根、增长 | chart `bars`（线条生长用 shape `draw`） |
| 底栏/角标 | 贴合、轻弹 | `animate` + `spring` |
| 离场 | 淡出、消失 | `easeIn` 系 exit |

display 组合排版两招（品牌站常态）：

- **fill+outline 双轨叠放**：同文案同 box 两条 textCard，下层普通填充、上层
  `fx: 'outline'`——z 序 = 轨道声明顺序（先声明的在底）。镂空字要压在深底上时
  这招比单 outline 多一层保险。
- **文字穿产品前后**：产品轨声明在中间，前层文字轨与后层文字轨各一条（同文案或
  分行文案），「被产品挡住的部分」用后层轨表达——层序全靠声明顺序，不要用
  translateZ（引擎无真 3D）。

中文粗 display：textCard 的 title / dataCard 数值缺省就按 700 粗体渲染（随包
Noto Sans SC，断网一致）——够用的前提下不要再引系统字体（非 macOS 机器会静默
fallback）。

## 4. 时长与节奏 → manifest 骨架

- fps 固定 30：`durationInFrames` = 总时长 × 30；每镜轨 `startFrame` / `endFrame`
  = 拆解表起–止秒 × 30。
- 每对相邻镜间一条 `transition` 轨；无转场的硬切不写 transition 轨。
- 口播按句拆：每句一条 `caption` 轨 + 一条 `tts_voiceover` 产物；句边界对齐拆解表
  的起止秒。
- 结尾若参考片有定版 LOGO/口号，用 `textCard`（`variant: title`）+ `fade` 收。

## 5. 批量变量表（模板）

| 变量 | 版本 A | 版本 B | 版本 C |
|---|---|---|---|
| 产品图 | assets/…a.png | assets/…b.png | … |
| 品牌名 | 妙可 | 甘甜 | … |
| 标题文案 | 一口爆汁 | 轻盈不腻 | … |
| 价格数字 | 29.9 | 39.9 | … |

循环纪律：

1. 复制 manifest 骨架 → 按列替换变量 → 逐条 `render_composition`（队列并发 1，
   一次一条）。
2. **文案不是盲替**：caption 词数变化影响能量谷推导与折行，textCard 长文案触发
   排版自适配——每版替换后看渲染体检提示，再出下一版。
3. 素材没齐先 placeholder 出片占位并登记素材需求，不让整批等一张图。
4. 每版产物与版本号对账（文件名带版本后缀），对照验收按 SKILL.md §4 的五项口径
   抽查首末两版。
