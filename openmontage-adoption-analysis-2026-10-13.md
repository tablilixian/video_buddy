# OpenMontage 模式落地到当前项目（Canvas Studio）的可行性分析报告

> 调研日期：2026-10-13
> 背景：REQ-034「学习赶超 OpenMontage，支持 Remotion 和 HyperFrames、低成本科普教育视频」
> 方法：实地读取 `canvas-studio/src` 与 `skills/` 代码底座，逐层对照 OpenMontage 架构；参考同类开源（video-shotcraft / anything2explainer / Motion Canvas / HyperFrames）。

---

## 0. 结论先行

**当前项目（Canvas Studio）已经是一个"准 OpenMontage"架构** —— agentic skill 体系、模型驱动 provider 层、ffmpeg 后期底座、storyboard 编排数据层、强制审批门（HITL）全部具备，且工程成熟度高于 OpenMontage 的"散 Python 工具 + YAML 清单"。

真正缺的只有两块：
1. **代码驱动的合成/动画引擎**（Remotion / HyperFrames 等价物）—— 当前"合成"只是 ffmpeg 的 concat+混音，做不了字幕卡/数据卡/动态图形/精确帧动画。
2. **OpenMontage 的两条特色流水线**（参考驱动创建、真实素材语料库）以及**批量/云端渲染**。

因此落地的本质不是"从零造 OpenMontage"，而是**补两块短板 + 借鉴其质量治理**。先天优势远大于劣势。

---

## 1. 当前已有地基（逐层对照 OpenMontage）

| OpenMontage 层 | Canvas Studio 现有等价物 | 证据（文件:行 / 目录） |
|---|---|---|
| `tools/`（52 个 Python 工具） | `host-tools.ts` 注册的一组 Host 工具：`video_generate` / `video_composite` / `compose_video` / `cut_audio` / `music_generation` / `qc_shot` / `image2vl` / `video2vl` / `extract_last_frame` 等 | `src/host-tools.ts:57,133,161,200,1527,2238` |
| `pipeline_defs/`（YAML 流水线） | 隐式落在 skill 内部 + `storyboard` 数据契约（`contracts/storyboard.ts`） | `src/contracts/storyboard.ts`、`storyboard-store.ts`、`storyboard-seed.ts` |
| `skills/`（Markdown 指令，教 Agent 用工具） | `skills/*/SKILL.md`（**23 个**，含 gate / trigger-words / 全局风格规则 / 音频策略） | `canvas-studio/skills/*/SKILL.md`（例 `paper-collage-explainer-generator/SKILL.md:1-90` 含 Gate 1 审批） |
| Remotion / HyperFrames 渲染引擎 | **缺**。仅 `compose.ts` 做 ffmpeg concat+混音，无逐帧代码渲染 | `src/compose.ts:5,152,184-186,228-311`；全局 grep `remotion|hyperframes|gsap|puppeteer|chromium` 仅在规划文档出现，**无实现** |
| FFmpeg 后期 | `ffmpeg-run.ts`（路径解析 + 超时强杀 + 媒体探测真值）+ `audio-cut.ts` | `src/ffmpeg-run.ts:128,164,278`、`src/audio-cut.ts` |
| 质量门禁（预合成验证 + 幻灯片风险评分 + ffprobe 自检） | **部分**。有 `quality-check.ts` + `qc_shot` 工具 + 分辨率/时长探测，但**无"幻灯片风险评估"** | `src/quality-check.ts`、`host-tools.ts:qc_shot` |
| 文件系统 checkpoint 接口（不用 REST） | **更成熟**：storyboard JSON + 画布节点血缘，落盘即 checkpoint，`compose_video` 按节点 id 精确选片 | `storyboard-land.ts`、`host-tools.ts:356,469` |
| 参考驱动创建（粘贴视频 → 变体） | **缺** | — |
| 真实素材语料库（Archive/CLIP 检索） | **缺**（纯模型生成） | — |
| 云端/serverless 批量渲染 | **缺**（单 Drama 后端同步单任务 + 视频异步队列，串行） | `config.ts:100 DRAMA_SERIAL_HINT`、`config.ts:111 DRAMA_VIDEO_ASYNC_HINT` |
| 模型 provider 抽象 + 7 维评分 | **有 provider 抽象 + 选择测试**，评分未显式化 | `tests/video-provider-select.test.mjs`、`tests/video-provider-drama.test.mjs`、`providers/fal.ts` |

**关键判断**：OpenMontage 的核心三层（tools / skills / pipelines）Canvas Studio 已有更工程化的版本；差距集中在"渲染引擎"和"两条特色流水线"，而非"agent 编排"本身。

---

## 2. 需要补的准备清单（按优先级）

### P0 — 代码驱动合成/动画引擎（对标 Remotion/HyperFrames）
这是对标 OpenMontage 与 REQ-034「低成本科普教育视频」的**硬缺口**。当前 `compose_video` 只能把模型生成的 clip 拼起来 + 混 BGM，做不了：
- 字幕卡 / 数据卡 / 章节进度条（OpenMontage 的 TikTok 风格词级字幕、anything2explainer 的黑底动态图形）
- 动态图形 / 运动排版（HyperFrames 的核心能力）
- 精确帧级转场、Ken Burns、粒子叠加（Canvas Studio 的 `camera-moves.ts` 现在只服务于"给模型写 prompt"，不是成片后处理）

**三种选型**（详见 §4 风险）：
- **Remotion**（React 写视频）：生态最全、工业级。**关键修正：Remotion License 对「个人 + 3 人及以下公司」完全免费**，只有 **4 人及以上**才需 Company License（$100/月起）。本项目为**两人公司 → 落在 Free License，商业使用零费用**。用 LLM 生成 Remotion 代码并自行渲染也被明确允许（仅禁止让用户上传自有 Remotion 代码到你的服务渲染）。
- **HyperFrames**（HTML+GSAP，OpenMontage 双引擎之一）：更轻、更适合动态图形，许可友好。
- **自研 canvas/WebGL 帧渲染 + ffmpeg 封装**：零外部 License，但要自己造"逐帧生成→编码"轮子。**好消息：现成可参考的开源项目极多，门槛不高**（详见下方「自研参考与技术门槛」）。

> **自研参考项目（都能读源码、能 fork、能直接用，无需从零造轮子）**
> 1. **Motion Canvas**（`github.com/motion-canvas/motion-canvas`，**MIT 许可**）—— 最强参考。TypeScript 编写、generator 描述动画、2D canvas 渲染、Vite 驱动、导出帧给 FFmpeg。本质是开源版代码驱动引擎，可当依赖或 fork 改，**无商业限制**，比 Remotion 更适合"掌握在自己手里"。
> 2. **node-canvas + FFmpeg 极简管线** —— 门槛最低、示例最多（`wwwtyro/canvas-video-generator`、`TierRanker`、Electron Canvas+FFmpeg 实战）。服务端 node-canvas 画 PNG 序列 → 直接喂现有 ffmpeg 管道。
> 3. **Remotion 本体**（开源仓库可读）—— 想看"React + Headless Chrome 逐帧截图"工业级实现，直接读其源码；免费就用它，不必重造。
> 4. **HyperFrames** —— OpenMontage 自带渲染器（HTML+GSAP），独立文档较少，参考价值弱于前两者。
>
> **技术门槛分层（Senior TS 开发者的真实量程）**
> - **低（1~2 周出 MVP）**：node-canvas 服务端逐帧 + 现有 FFmpeg 合成。覆盖 REQ-034 刚需：字幕卡、数据卡、图文幻灯片、简单转场、下三分之一条。代价：CPU 渲染（1080p 实测 ~10–50ms/帧）、无 DOM/CSS 复杂排版。最贴合现有底座，几乎零新依赖。
> - **中（1~2 月）**：Playwright/Puppeteer 起 Headless Chrome 渲染 HTML/CSS/SVG 逐帧截图 → FFmpeg。拿到完整 CSS 布局、Web 字体、SVG、过渡动画。难点在**逐帧精确捕获（防 jank/竞态）和字体/无头环境配置**。Motion Canvas 站此档位（用 Playwright 驱动无头 Chromium 渲染 canvas）。
> - **高（年为单位，别自研）**：Remotion 那种完整 React reconciler + WebGL/着色器 + GPU 加速 + 分布式云端渲染。直接免费用 Remotion 或 fork Motion Canvas 即可，无需自己写。
> **结论：MVP 技术要求不高。** 最小可行代码合成（卡片+幻灯片+字幕+简单转场）是 1~2 周 node-canvas + 现有 FFmpeg 的事；只有复刻 Remotion 全功能引擎才高，而那一步没必要——免费用 Remotion（两人公司免费）或 MIT 的 Motion Canvas 都行。

### P1 — 质量治理门禁（OpenMontage 工程设计含量最高的部分）
纯增量，不引入新渲染引擎即可拿到 REQ-034 的直接质量收益：
- **预合成验证门禁**：渲染前检查"计划输出 vs 脚本内容 / 场景覆盖率 / 素材规格"，不满足就拒绝（Canvas Studio 已有 `quality-check.ts`，补一道"成片前"闸）。
- **幻灯片风险评分（Slideshow Risk Score）**：6 维度（场景平均时长 / 运动素材占比 / 摄像机运动检测 / 切换频率 / 音频动态 / 视觉变化密度）评估"一堆图假装视频"。**这是我们当前最大盲区**——模型生成的是真运动 clip 还好，但一旦 skill 退化成"出图+简单推镜"就会触发，需要主动拦截。
- **渲染后自检**：ffprobe 帧采样 + 音频电平分析 + 字幕存在性（ffmpeg-run.ts 的 `probeMediaInfo` 已能取时长/分辨率/音轨，补帧采样即可）。

### P1 — pipeline manifest 显式化（让 Agent 能精细改时间轴）
OpenMontage 的关键设计是"YAML 清单 + JSON checkpoint 当接口，Agent 改清单就能调时间轴"。Canvas Studio 的流水线现在**隐式写在 skill 的 STEP 里**。建议：把"成片结构"抽成结构化 manifest（shot 列表 + 时长 + 转场 + 字幕轨），让 Agent 用 `compose_video` 的 `clipIds` / 新增 `timeline` 参数精细编排，而非纯靠自然语言驱动。

### P2 — 参考驱动创建（paste video → 变体）
OpenMontage 的"从参考视频起步"：分析节奏/钩子/场景/风格，给 2-3 个差异化概念 + 成本估算。Canvas Studio 已有 `video2vl`（视频理解）和 storyboard 契约，**缺的是"参考→提案"这一步的 skill 编排**，不是底层能力。

### P2 — 真实素材语料库（与模型驱动互补，选做）
OpenMontage 的纪录片蒙太奇：从 Archive.org/NASA/Wikimedia 建语料库 + CLIP 检索真实动态画面。这填补了"模型画质/一致性受限 + 贵"的短板。**与我们对标"低成本"高度相关**，但是否要做取决于产品定位（写实 vs 动态图形）。

### P2 — 批量/云端渲染（选做）
当前单 Drama 后端串行。若要"千人千面批量模板"（Remotion 的杀手锏），需要并行渲染。优先级取决于是否真有批量需求。

---

## 3. 先天优势（我们已经有的，且比 OpenMontage 强）

1. **agentic skill 体系成熟**：23 个带 frontmatter（name/description/trigger-words/compatibility）的 SKILL.md，含强制审批 gate、全局风格规则、音频策略。OpenMontage 的 skill 是"教 Agent 用工具"，我们多了**路由 + 守卫**（`skills/routing-prompt.ts`、`param-guard.ts`）。
2. **Host/Client 分层 + 工具注册 + 统一错误系统**：比 OpenMontage 的"散 Python 脚本 + REST"更工程化。`ctx.tools` 是 Host-only 服务，`tool/result` 通过 `conversationEvents` 订阅——天然适合"agent 驱动渲染"。
3. **模型驱动层已接且多 provider**：Drama 后端（`fl2va`/`ref2va`/`txt2image`/`txt2speech`/`image2vl`/`video2vl`，`config.ts:62-84`）+ fal provider，覆盖图/视频/语音/理解。
4. **ffmpeg 后期底座健壮**：`resolveFfmpegPath` 多级回退（参数→环境变量→随包二进制→PATH）、`runFfmpeg` 超时强杀 + 中断、媒体真值探测（时长/分辨率/音轨）、BGM 混音淡入淡出（`compose.ts:228-311`）。**且打包已带 ffmpeg 随包二进制（CV-201）**，终端用户零安装。
5. **审批门 + HITL 已是产品核心**：`approval-gate.ts` / `workflow-stage.ts` 是强制 gate，比 OpenMontage 的"确认后执行"更严格、更可控。
6. **storyboard 数据契约 + 零 JS HTML 审阅**：`storyboard-render.ts` 渲染零脚本 iframe 审阅，`contracts/storyboard.ts` 是稳定的结构化中间层——这本身就是 OpenMontage 想要的"声明式编排数据"，且已落地。
7. **档位/像素表 + provider 选择测试**：`output-size.ts` / `config.ts:115-160` 统一分辨率档位，`video-provider-select.test.mjs` 已有 provider 抽象测试。
8. **团队已研究过这条路线**：`docs/` 下 `visual-direction-*.md` 已提到 remotion/gsap，说明前期有过技术预研，不是从零认知。

---

## 4. 先天劣势 / 风险

| 劣势 | 影响 | 缓解 |
|---|---|---|
| **缺代码驱动动画引擎（最大短板）** | 做不了字幕卡/数据卡/动态图形/精确转场，直接卡死 REQ-034「低成本科普教育视频」（这类正需字幕+数据卡+动画） | 引 Remotion/HyperFrames 或自研（见 §2 P0） |
| **Remotion License（两人公司无风险）** | ~~4 人及以上才需 Company License（$100/月起）~~；本项目为两人公司 → **Free License 覆盖，商业使用零费用**。仅当团队扩到 4 人、或让用户上传自有 Remotion 代码到服务渲染时才触及付费/合规 | 当前无需规避；若未来 ≥4 人再评估 Company License，或切 HyperFrames / Motion Canvas（MIT）/ 自研 canvas 帧渲染 |
| **单 Drama 后端串行** | 长视频/批量慢，无云端并行 | 若做批量再做并行（§2 P2）；短期不构成瓶颈 |
| **纯模型生成，无真实素材** | 受模型画质/一致性/价格约束，"低成本"天花板低 | 真实素材语料库（§2 P2）互补 |
| **Electron 桌面形态 vs OpenMontage CLI 工具包** | 集成形态不同，但 Host/Client 已天然分层，适配成本低 | 不照搬"文件系统优先"，继续用现有 storyboard 契约 + 工具注册 |
| **外部 API 依赖** | 离线/零成本起步不如 OpenMontage（Piper TTS + 免费素材）；Drama 后端单任务串行 | 关键轻量能力（字幕/数据卡）走本地代码合成，不依赖出图 |
| **仓库已 7427 文件、复杂度高** | 再加合成引擎易破坏现有守卫（T3 全量 + 反向变异体系） | 新引擎作为独立模块，复用 `ffmpeg-run.ts`，不动历史数据路径（遵循"只修产生路径"铁律） |

---

## 5. 落地路线图建议（分阶段，最小风险）

- **阶段 A（最小可行，纯增量，1~2 周）**：在现有 `compose_video` / `quality-check.ts` 上加 **幻灯片风险评分 + 预合成验证 + 渲染后 ffprobe 自检**。不引入新渲染引擎，直接拿到 REQ-034 的质量收益。复用 `ffmpeg-run.ts` 的 `probeMediaInfo`。
- **阶段 B（补代码驱动引擎，核心）**：评估并引入轻量"代码动画合成"模块——优先做**字幕卡 / 数据卡 / 转场 / 简单动态图形**这一最小集（低成本科普视频的刚需）。选型见 §2 P0 / §4：两人公司 **Remotion 免费可直接用**；想掌握在自己手里则 **fork/用 Motion Canvas（MIT）**；最贴合现有底座的是 **node-canvas 逐帧 + 现有 ffmpeg**（1~2 周 MVP，零新依赖）。
- **阶段 C（参考驱动，选做）**：把 `video2vl` + storyboard 契约编排成"paste video → 提案变体"skill。
- **阶段 D（真实素材 / 批量云端，选做）**：取决于产品是否要做"低成本纪录片蒙太奇"或"千人千面批量"。

---

## 6. 需要你拍板的关键决策点

1. **代码驱动引擎选型**：Remotion（两人公司免费，可直接用）/ Motion Canvas（MIT，可 fork 掌握在自己手里）/ node-canvas 逐帧 + 现有 ffmpeg（最贴合底座，1~2 周 MVP）/ HyperFrames（HTML+GSAP）。
2. **Remotion License**：两人公司已被 Free License 覆盖，当前零风险、零费用；仅当团队扩到 4 人、或开放"用户上传自有 Remotion 代码渲染"时才需评估。
3. **是否照搬 OpenMontage 的"YAML manifest + 文件系统 checkpoint"接口**：建议**不照搬**——现有 storyboard 契约 + 工具注册比它更成熟，只需把"成片结构"显式化为结构化 manifest（§2 P1）。
4. **REQ-034 的范围**：只补"质量门禁 + 字幕/数据卡合成"（阶段 A+B，达标"低成本科普视频"），还是也要做"参考驱动 + 真实素材"（阶段 C+D，全面赶超）？

---

## 7. 与同类开源的横向参考

- **OpenMontage**（66k★）：12 流水线 + 52 工具 + 500+ skill + Remotion/HyperFrames 双引擎 + 质量门禁。我们的对标对象，但其工具层散、无类型安全，我们 Host/Client 分层更优。
- **video-shotcraft**（11k）：Remotion + 152 分镜配方卡。可借鉴"配方卡"模式补我们的 shot 库。
- **anything2explainer**（2.4k）：主题→黑底动态图形解说，每帧代码绘制 + TTS。纯代码驱动，无模型视频——正好是我们要补的"代码合成"样板。
- **Motion Canvas**（TS 自有渲染，非 React）：技术讲解动画，可替代 Remotion 作代码驱动引擎选项。
- **HyperFrames**（HTML+GSAP）：OpenMontage 双引擎之一，动态图形首选，许可友好。

---

### 核心一句话
**我们已经有了 OpenMontage 的"大脑"（agentic skills + 编排 + 模型层 + 后期），只缺它的"双手"（代码驱动合成引擎）和两条特色流水线。补 P0 引擎 + P1 质量门禁，即可达标 REQ-034，且工程基础比 OpenMontage 本身更扎实。**

### 参考代码位置（已读）
- `canvas-studio/src/ffmpeg-run.ts`（ffmpeg 底座）
- `canvas-studio/src/compose.ts`（合成：concat+混音+淡入淡出）
- `canvas-studio/src/config.ts`（Drama 端点 + 档位 + 串行/异步纪律）
- `canvas-studio/src/host-tools.ts`（Host 工具注册：compose_video / cut_audio / qc_shot / video_generate …）
- `canvas-studio/src/storyboard-render.ts`（零 JS HTML 审阅）
- `canvas-studio/skills/*/SKILL.md`（23 个 agentic skill）
- `canvas-studio/src/quality-check.ts`（质量检查，缺幻灯片风险评分）
- `canvas-studio/src/camera-moves.ts`（镜头运动，仅服务于模型 prompt）
