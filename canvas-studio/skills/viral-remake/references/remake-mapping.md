# 爆款复刻映射分册 —— 拆解表 / 轨道映射 / 转场全表 / 批量变量

> 本文是 `viral-remake` 的细则分册。manifest 字段级契约（校验规则、必填、取值域）
> 以 `code-driven-explainer/references/manifest-contract.md` 为准，本文不重复，
> 只写「参考片元素 → 用哪条轨、哪个字段」的映射决策与模板。

## 1. 爆款拆解表（模板）

| 镜 | 起–止(s) | 时长 | 内容类型 | 转场入 | 字幕/文案 | 素材需求 |
|----|---------|------|---------|--------|----------|---------|
| 1 | 0.0–1.8 | 1.8 | 静帧图 | — | 标题「一口爆汁」 | 产品图 A（user） |
| 2 | 1.8–4.2 | 2.4 | 实拍段 | zoom | 无 | 生视频：草莓挞特写（generated） |
| 3 | 4.2–6.0 | 1.8 | 数据卡 | crossWarp | 「29.9 / 3 种口味」 | 数据来自用户 |
| 4 | 6.0–8.0 | 2.0 | 口播字幕 | fade | 「点击下方链接」 | tts_voiceover 第 4 句 |

规则：

- 时长 0.1s 精度；**镜序即轨道接续顺序**，也是 transition 轨
  `fromTrackId → toTrackId` 的连接顺序。
- 内容类型六选一：`实拍段 / 静帧图 / 口播字幕 / 文案卡 / 数据卡 / 节奏装饰`；
  拿不准按画面主体归，一镜只归一类（复合镜拆两条轨同段叠放）。
- 「转场入」= 上一镜 → 本镜的效果名（§3 全表就近选）。
- 「素材需求」列即总纲 §07 素材清单的来源：`generated`（生图/生视频）/
  `user`（用户提供）/ `library`（素材库）；placeholder 也要登记，不漏项。

## 2. 内容类型 → 轨道映射

| 参考片元素 | 轨道 | 关键字段 | 决策备注 |
|---|---|---|---|
| 实拍段（产品演示/人物/食物） | `video` | `src`（同源 URL） | 素材先落画布（生视频走画布 video 节点，产物引用资产 URL）；一镜一段，不剪辑 |
| 静帧/产品图 | `image` | `fit: cover / contain / kenburns` | `kenburns` 推近营造节奏；多图轮换 = 多条轨接续 + 转场 |
| 口播/歌词逐字 | `caption` | `src` + `text`（单句一条轨） | 词级卡拉OK；`words` 显式时间戳或能量谷推导（±1–3 帧） |
| 句级字幕条/标题卡 | `textCard` | `variant: subtitle / title`、`anim` | `anim` 四选一：`fadeUp` / `maskReveal` / `typewriter` / `wordStagger` |
| 要点列表 | `textCard` | `variant: bullets` | 逐行入场；数据真成表用 chart |
| 数据卡（单卡键值） | `textCard` | `variant: dataCard` + `data` | 键值对形态 |
| 数据表/对比图 | `chart` | `variant: bars / dual`、`labels`/`values` | dual 必给 `lineValues`；单位写 `unit` |
| 「每镜多长」结构数据 | `chart` | `source: 'timeline'` | 从 video 轨真值推导，零手填；与内联数据互斥 |
| 节奏装饰（几何/光效/线条） | `shape` | `rect / circle / line / gradient / path / arrow / triangle / star / polygon` | 配 `orbit` / `draw` / `fx`（glow/stroke/shadow/blur/maskFade） |
| BGM 情绪可视化 | `audioViz` | `mode: bars / mirror / line`、`bandSplit` | 参考片有强节拍感时加；`bandSplit` 六频段分色 |

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
