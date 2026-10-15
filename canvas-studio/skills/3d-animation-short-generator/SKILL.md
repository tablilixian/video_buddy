---
name: 3d-animation-short-generator
description: |
  Style knowledge for stylized 3D animated shorts: Pixar-inspired C4D + Octane rendering lock, exaggerated geometric character design with Q-version proportions, sculpted hair clumps with edge flyaway, warm subsurface-scattering skin, squash-and-stretch Disney/Pixar acting, and the card/shot asset rules that keep identity and continuity stable (labeled 16:9 character sheets, environment-only scene cards with continuity landmarks, six-column shot table with per-second directives). Use when the user wants a narrative 3D animation project with strong character consistency and scene continuity. Not for single images, simple edits, photorealistic live action, or one standalone clip.
compatibility: Requires the MiniMax Hub agent (canvas workspace, choice cards, and hub_generate_image/hub_generate_video tools); not portable to generic agent harnesses.
---

# 3D Animation Short Generator

风格化 3D 动画短片的**风格知识库**：画风锁定、角色与场景资产规则、分镜表规格、成片纪律。

## 立场声明

**本 skill 只提供风格知识与该风格的特殊约束；流程、审批门禁与工具契约一律以 `canvas-studio-creation` 为准。**

## 何时用 / 何时不用

**用**：用户想要一条故事优先的 3D 动画短片——从一句创意到成片，强调角色一致性、场景连续性、时序、镜头、表演与音频控制。

**不用**：单张图、简单剪辑、单段动画、logo 设计、纯提示词咨询、照片级真人实拍。

## 全局画风锁定

除非用户明确要求别的视觉风格，角色卡、场景卡、分镜表、文字分镜、可选铅笔分镜、单镜视频片段、合成视频与终版合成图都要用这套画风：

- 渲染风格：Pixar 风格 3D 卡通渲染，C4D + Octane 渲染器质感，高端动画长片水准。
- 角色设计：夸张的几何简化与出色的材质细节结合。避免 100% 写实人体解剖；用高层次的造型语言、大而清晰的剪影，需要时用 Q 版比例。
- 比例语言：友好的风格化比例，萌系或幼态角色常用 2.5-3 头身，大头、紧凑身形、清晰剪影、高辨识度。
- 毛发：强雕塑感的块面与干净的体块结合，配上边缘细碎飞毛或毛绒轮廓细节，让毛发看起来是被设计过、且在光下有触感。
- 皮肤/材质：温暖次表面散射皮肤质感，耳廓、面颊、鼻尖、指尖有柔和的红色透光；避免硬塑料皮肤。
- 表演风格：夸张、活泼的迪士尼/皮克斯式角色动画表演，带挤压拉伸、强烈眉形、眼尾、瞳孔、嘴唇与脸颊形变。
- 运动风格：高能姿态、清晰动作线、前倾、强烈预备动作，快但可读的时序，弹性身体力学，鲜明的微表情。
- 情绪跨度：在萌与爆发力之间取平衡；强烈情绪可以用戏剧化的面部形变，但要保住角色魅力。

负向风格约束：不要照片级真人实拍、不要扁平 2D 动漫、不要塑料玩具皮肤、不要僵硬人体模特摆拍、不要写实解剖的僵硬、不要无表情的脸。

## 角色卡规格

推荐顺序：主角卡 → 反差/压力角色卡 → 可选配角卡。

角色卡尽量做成 16:9 的制作参考图。与终版渲染视频不同，**角色卡要带清晰可读的标注**，方便后续生成绑定正确的人物与道具：

- 角色名标注（英文和/或项目语言）。
- 角色定位标注：主角、奶奶、小偷、搭档、压力角色等。
- 主 3/4 视角。
- 正面 / 侧面 / 背面视图。
- 表情。
- 材质 / 服装 / 道具细节。
- 重要道具标注：手提包、钱包、滑板、苹果篮、围巾、鞋、眼镜等。
- 在提示词里重复身份锁定。
- 一段简短视觉 ID 备注：年龄段、体型、发型、服装配色、标志性道具与不可改特征。

风格化 3D 的角色要柔软、清晰可读，并在后续图像与视频之间保持一致。

对白语言只在用户明确要求时才写具体语言，否则记 `language not specified` 并保持对白精简（或需要时再问）。

改已锁定的角色设计可能导致分镜表、单镜分镜、单镜片段、合成主片与终版合成全部返工——这一点要在锁定前讲清。

## 场景卡规格

角色卡之后出场景卡。**场景卡只画环境**：不放角色、人物、人群、剪影、手、脸或角色客串。角色动作属于分镜表、可选铅笔分镜与单镜片段，不属于场景卡。

包含：

- 主环境概览。
- 关键光照状态，例如白天 / 夜晚。
- 情绪子空间。
- 连续性地标（同一场景内屏幕位置必须保持一致的固定物体，例如厨房岛台、沙发、门框、树、邮箱）。
- 环境里的重要道具。

## 分镜表规格

角色卡与场景卡锁定后产出标准化视频提示词分镜表——这一步是强制的，不能被分镜或视频生成替代。六列 schema、逐秒指令要求、表级规则与自检门见 `references/shot-table-spec.md`（写分镜表前必读）。

最低运行契约：

- 建一个画布表节点。
- 恰好六列：`Shot ID & Duration`、`Continuity Handoff`、`Reference Anchors (Spatial + Identity)`、`Hook Type`、`Shot Description (Per-Second Directives)`、`Audio & Dialogue Track`。
- 每一行都要有完整的逐秒指令、连续性交接、参考锚点、钩子类型与音频/对白时序。
- 进文字分镜前先跑 `references/shot-table-spec.md` 里的自检门。

## 文字分镜规格

默认模式是**一份权威文字分镜文档**，每个镜头一节。铅笔分镜图只是可选的可视化产物，**永远不覆盖文字分镜**。只有用户点名某镜要重度迭代时，才把该节抽成独立文本节点，并在文档里留 `(extracted)` 标记。细则见 `references/storyboard-guidelines.md`。

渲染单镜片段时要剥掉只属于分镜的标注，并把每段片段绑定到已确认的文字分镜节、精确的角色卡与精确的场景卡——绑定的是文字分镜，不是铅笔图。

## 成片纪律

- 保持已确认分镜表里的镜头顺序。
- 只用已确认的最新资产。
- BGM 在对白、反应与重要音效之下。
- 除非明确要求，不加字幕或文字。
- 终版视频不得残留任何分镜痕迹、标注、箭头、时间标记、画框边线或双份绑定标签。

细则见 `references/qc-checklist.md`。

## 分册（按需读，不要一次全读）

| 分册 | 何时读 |
| --- | --- |
| `references/shot-table-spec.md` | 写六列分镜表前必读；含逐秒指令要求、表级规则与自检门 |
| `references/storyboard-guidelines.md` | 写文字分镜文档、决定是否出铅笔图、抽离/回填单镜分镜时 |
| `references/model-selection.md` | 固定 MiniMax H3 的策略与提示词塑形、片段确认要点 |
| `references/fallback-policy.md` | 片段漂移时的重试阶梯、降级处理与升级选项 |
| `references/qc-checklist.md` | 合成、BGM 匹配、终版审阅、画布排序归组与返工纪律 |

## 边界

生成、落地、审批与交付动作一律走 `canvas-studio-creation`；本 skill 不提供工具参数、不设审批门。本项目没有可选视频模型与分辨率选择环节，不要展示模型或分辨率选择卡。
