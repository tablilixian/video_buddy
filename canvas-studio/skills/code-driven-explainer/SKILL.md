---
name: code-driven-explainer
description: 代码驱动科普成片规范（canvas-studio 的 render_composition，Remotion 客户端渲染）。凡要把知识 / 数据 / 观点做成带字幕卡、数据卡、转场的解说短片时加载：时间轴由 CompositionManifest（JSON）显式声明，客户端的 Remotion 渲染器按它出 H.264 成片，宿主只做校验、落盘、探测与混音。触发词：科普、教育、讲解、知识短片、数据可视化、带字幕卡 / 数据卡的视频、代码合成。流程：确认拍摄定稿已落地 → list_shots / list_references 取素材真值 → 组装 manifest → ask_user_choice 给轨道时序预览（可调时长档位 / 字幕粒度 / 卡片取舍）→ render_composition。边界：不改写总纲的流程与审批语义；不做词级字幕对齐（后端 TTS 无时间戳数据源）；纯片段顺序拼接仍走 compose_video，不用本工具。
---

# 代码驱动科普成片（code-driven-explainer）

把知识 / 数据 / 观点做成**带字幕卡与转场的解说短片**时走本路径：时间轴由 `CompositionManifest`（一段 JSON）显式声明，客户端的 Remotion 渲染器按它出片，宿主只做校验、落盘、探测与混音。适合需要**代码级精确控制**（句级字幕对齐、卡片逐一入场、转场窗口）的成片。

本 skill 是 `canvas-studio-creation` 总纲的**下游分支**：总纲负责需求澄清、拍摄定稿与审批语义，本 skill 只负责「已定稿之后，怎么把素材组装成 manifest 并交给 `render_composition`」。启用它**不改变**总纲的流程与审批门禁。

## 何时用（trigger）

- 用户要「科普 / 教育 / 讲解 / 知识短片 / 数据可视化」，或明确要**带字幕卡 / 数据卡 / 图文幻灯片**的成片。
- 需要把既有视频 / 图片素材与**逐句字幕**编排进同一条时间轴。

**不适用**：只把已有视频片段按顺序拼接 → 用总纲的 `compose_video`；只要风格化 B-roll 而非卡片叙事 → 走对应风格 skill。

## 前置（缺一不可）

1. `write_storyboard` 的拍摄定稿已落地（脚本 / 分镜已在画布）。
2. 需要的视频 / 图片素材已在画布（`video_generate` / `video_composite` / `image_generate` 的产物，或用户上传与参考资产）。
3. 片中有旁白时，`tts_voiceover` 已产出并落成音频节点。

## 工作流

1. **取真值**：`list_shots` 读每个视频片段的**真实时长**（素材轨时长的唯一合法来源）；`list_references` 取角色 / 风格资产卡与图片。有旁白时以 `tts_voiceover` 结果里的真值时长为准。
2. **组装 `CompositionManifest`**：`meta`（画幅 / 帧率 / 总帧数）+ `tracks`（video / image / textCard / shape / transition）+ 可选 `audio`。字段与约束见 `references/manifest-contract.md`。
3. **澄清（可选方案，非审批门）**：用 `ask_user_choice` 给出成片结构预览——**轨道时序表**（video 轨须同时显示「声明时长 / 真值」两列）与可调项（时长档位 / 字幕粒度 / 卡片取舍）供用户挑；措辞按「可选方案」写，**不要写成流程门**。用户不挑就按推荐方案默认。放手跑模式跳过本步。
4. **调 `render_composition({ manifest })`**：放行由该工具自身承担（与 `compose_video` 同口径），本 skill **不设门**。**不要传 `projectId`**。
5. **展示**：成片节点自动落画布；把结果里的 `warnings`（时长校正 / 缺素材 / 幻灯片风险）转告用户。

## 组装要点（细则已下沉分册）

- **素材轨时长硬口径**：video 轨 `durationInFrames` 必须来自 `list_shots` 真值，禁止目测或估算 → `references/source-duration.md`。
- **句级字幕时序**：按旁白真值总长 + 字数占比分配，末句吸收舍入误差 → `references/subtitle-timing.md`。
- **字体声明**：中文先声明 `global.fontFamily`；随包子集未命中再走 `global.fonts[]` → `references/fonts.md`。
- **科普结构**：钩子 → 主体（3±2 个要点）→ 收尾；卡片形态与节奏 → `references/explainer-patterns.md`。

## 纪律

- **一句一条字幕卡**：字数与展示时长匹配，不把长段落塞进一张卡。
- **血缘**：video / image 轨的 `id` 必须填该素材的**画布节点 id**（宿主据此画制作链）；纯呈现轨（textCard / shape / transition）用本地 id。
- **素材引用**：`src` 只接受 `/canvas-studio/assets/...` 同源 URL 或本地绝对路径，**禁一切外链**。
- **缺素材不要静默出片**：宿主核对不存在的素材只给 warning，仍会尝试渲染；发现这类 warning 要**明确告知用户**而不是当作成功。

## 遇错处理

- **`CS-RENDER-TIMEOUT`**：客户端渲染器没取到工单。首查是否**误传了 `projectId`**——省略即按当前项目解析；确需显式传，必须是真实项目 id。
- **manifest 校验失败**：报错会定位到具体 `tracks[i]` 字段，按点改，不要整段重试。
- **`CS-RENDER-002`（客户端渲染失败）**：先确认素材可读（同源 URL 存在、格式受支持），再向用户说明。
