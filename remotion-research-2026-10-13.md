# Remotion 与相关开源项目调研

> 调研日期：2026-10-13
> 目的：搞清楚 Remotion 这套「模式」是怎么生成视频的，以及它的开源生态，对照我们自己的 Flova / Canvas Studio / REQ-034 路线。

## 0. 一句话结论

视频生成有两条本质不同的路线：

| 路线 | 代表 | 「视频」是怎么来的 | 像素/运动由谁产生 |
|---|---|---|---|
| **模型驱动（生成式）** | Sora / Veo / Kling / MiniMax H3 / FLUX | 给文本/图片，AI 模型**直接生成**画面与运动 | 神经网络扩散模型 |
| **代码驱动（程序化）** | Remotion / HyperFrames / Motion Canvas | 你**写代码描述每一帧**，浏览器渲染 + FFmpeg 编码 | 浏览器（CSS/SVG/Canvas/WebGL） |

**关键认知**：Remotion 本身「不会生成内容」——它只是一个**把代码渲染成视频的渲染引擎**。所谓 "AI 生成视频" 若走 Remotion 路线，AI 只负责两件事：(1) 生成素材（图片/视频片段，仍靠模型驱动），(2) 可选地生成 Remotion 代码；**最终成片的每一帧都是浏览器渲染出来的**。

这正是 OpenMontage（我们 REQ-034 要赶超的对象）的架构本质：**用 gen-AI 造素材，用 Remotion/HyperFrames 做合成与动画，用 FFmpeg 做后期**。两条路线被它缝合在一起。

---

## 1. Remotion 的核心心智模型

> 视频 = 一个关于时间的纯函数 `frame → 画面`。

传统剪辑软件是「轨道 + 关键帧」的视觉抽象；Remotion 的核心洞察是：**任意时间轴动画都能表达为 `f(t) → frame` 的纯函数**。React 组件天然是「props → JSX」的声明式结构，把 `frame` 作为 prop 注入，组件就在每一帧自动重渲染出该时刻的画面。

### 视频四要素（Composition 的元数据）
- `width` / `height`：分辨率（像素）
- `fps`：帧率
- `durationInFrames`：总帧数（秒数 = durationInFrames / fps）

### 核心 API
| API | 作用 |
|---|---|
| `useCurrentFrame()` | 取当前帧号（0 ~ durationInFrames-1） |
| `useVideoConfig()` | 取 fps/分辨率/时长 |
| `interpolate(frame, [a,b],[c,d])` | 帧号 → 数值的插值（做位移动画/淡入淡出） |
| `spring()` | 弹簧物理动画（更自然的动效） |
| `Sequence` | 时间偏移容器（排场景、错峰动画） |
| `staticFile()` | 加载图片/字体/音频等静态资源 |
| `delayRender()` / `continueRender()` | 异步安全闸门（等 API/字体加载完再截图，防空白帧） |

### 最小示例（3 秒、30fps、淡入文字）
```tsx
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
export const MyVideo = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity, backgroundColor: "white" }}>Hello</AbsoluteFill>;
};
```

---

## 2. 渲染管线（这是「模式」的技术核心）

Remotion 的渲染分三阶段，本质就是「**打包 → 浏览器逐帧截图 → FFmpeg 编码**」：

```
① Webpack/esbuild 打包 React 组件 + 元数据(fps/分辨率/总帧数)
        ↓
② Puppeteer 启动 Headless Chrome，加载打包后的页面
        ↓
③ 从 frame 0 到 N 循环：
     设置根节点 CSS 变量 --remotion-frame = i
     → 触发 React 重渲染
     → 等 delayRender 闸门 resolve
     → 截图（PNG/JPEG 或共享内存位图）
        ↓
④ FFmpeg 把帧序列 + 音轨编码为 H.264(MP4) / VP9(WebM)，mux 音视频
```

### 必须知道的几个实现细节（踩坑点）
1. **每帧渲染是「无状态」的**：这是最容易栽的地方。浏览器视角下，帧与帧之间没有持久化——`useState` 永远返回初始值，`useRef.current` 在 frame 40 设的值到 frame 41 就没了，`useMemo([])` 每帧都重算（因为 React 树是被拆掉重建，而非暂停-恢复）。任何「跨帧记忆」都得靠帧号自己算出来，不能靠 React 状态。
2. **shared-memory capture（v4.0.534+）**：不再把每帧压缩成 JPEG/PNG 再交给 FFmpeg 解码（纯浪费），而是把原始位图直接共享给 Remotion 自带的 FFmpeg 二进制编码。条件：macOS Apple Silicon + macOS 15、或较新的 Linux glibc；渲染视频（非 GIF/音频/静帧）；并行编码开启。老平台（Windows、Intel Mac、旧 Linux）回退到普通截图。
3. **并发 = 多 Chrome 实例**：`--concurrency N` 同时起 N 个 Headless Chrome 各跑一部分帧。渲染耗时 ≈ 帧数 × 每帧像素 × 每帧 React 计算量，三者非线相乘。
4. **云端扩展**：Remotion Lambda（AWS）/ Cloud Run 把帧分片分发到大量 serverless 函数并行渲染，再拼接；几分钟视频可秒级出片。

### 代价与边界
- ✅ 仅用 Web 标准（Chrome + FFmpeg），浏览器能渲染的（CSS/SVG/Canvas/WebGL）都能进视频帧
- ✅ `delayRender` 保证异步数据加载完才截图，防数据驱动视频的空白帧
- ✗ 强依赖 Headless Chrome（无浏览器的环境跑不了）
- ✗ 内存高（全高清帧常驻内存，长视频吃 RAM）
- ✗ 逐帧走浏览器渲染流水线，**慢**：适合几十秒到几分钟的短视频，不适实时直播

---

## 3. 开源生态（相关项目）

### 3.1 Remotion 本体与官方配套
- **remotion-dev/remotion**（~61k★，Apache-2.0 风格的 Remotion License）：核心框架，用 React 写视频。
- **remotion-dev/skills** + **claude-code-plugin / cursor-plugin / codex-plugin / kimi-code-plugin**：官方 Agent Skills，让编码助手用自然语言生成 Remotion 代码。
- **remotion-dev/canvas-capture**：HTML-in-canvas 高保真网页录制。
- **@remotion/lambda** / **lambda-php-sdk / lambda_go_sdk / lambda-ruby-sdk**：云端渲染 SDK 多语言支持。

### 3.2 基于 Remotion 的「Agentic 视频生产」系统（最相关）
| 项目 | Stars | 定位 | 渲染方式 |
|---|---|---|---|
| **calesthio/OpenMontage** | ~66k | 世界首个开源「代理化」视频生产系统：12 条流水线、52 工具、500+ Agent Skill；研究→脚本→素材→剪辑→合成 E2E | Remotion(React) **+ HyperFrames(HTML/GSAP)** 双引擎 + FFmpeg |
| **Vincentwei1021/video-shotcraft** | ~11k | Claude Code/Codex 的 AI 视频 Skill：152 张分镜配方卡、209 个动效预览、产品级模板 | Remotion |
| **Vincentwei1021/anything2explainer** | ~2.4k | 任意主题 → 黑底动态图形解说视频，TTS 配音 + 字幕 + 章节进度条 | Remotion（每帧代码绘制） |
| **0xsline/OpenChatCut** | ~2.3k | 本地优先的对话式 AI 视频编辑器，专业多轨时间轴 + MCP 集成 | Remotion 渲染 |
| **digitalsamba/claude-code-video-toolkit** | ~2.2k | 面向 Claude Code 的 AI-native 视频工具包 | Remotion + Playwright |
| **Agents365-ai/video-podcast-maker** | ~1.7k | 主题 → 4K 旁白视频，manifest 驱动 Asset Engine | Remotion |
| **Vincentwei1021/video-talkcraft** | ~1.5k | 口播驱动解说视频，词级语音同步 + 109 张动效配方卡 | Remotion |
| **Remocn/remocn** | ~1.6k | 生产级 Remotion 动画/转场/背景/场景库（shadcn 风格） | Remotion |

> OpenMontage 重点拆解（REQ-034 直接对标）：
> - **三层架构**：`tools/`（52 个 Python 可执行工具）+ `pipeline_defs/`（12 条 YAML 流水线清单）+ `skills/`（Markdown 写的「阶段导演」指令，教 Agent 怎么用每个工具）。没有专属编排器——Agent 读 manifest 自己驱动。
> - **文件系统优先**：YAML 清单 + JSON checkpoint 当接口，**不用 REST API**。Agent 要调时间轴就改 YAML 再重生 checkpoint。这是它「让 AI 能精细改时间轴」的关键设计。
> - **双渲染引擎**：Remotion 是数据驱动解说/React 场景栈的默认；HyperFrames（HTML+GSAP）是大量动态图形、SVG 角色动画的默认。提案阶段二选一锁定 `render_runtime`。
> - **质量治理**：预合成验证门禁 + 渲染后自检（ffprobe/帧采样/音频电平）+ **「幻灯片风险评分」**（6 维度防「一堆图拼一起假装视频」）；每个 provider 选择做 7 维打分 + 可审计决策日志。
> - **零成本起步**：Piper TTS（本地离线）+ Archive.org/NASA/Wikimedia/Pexels 免费素材 + Remotion 本地渲染，无需任何 API key 即可出片。

### 3.3 同族替代渲染引擎（非 Remotion，但同一范式）
- **HyperFrames**：OpenMontage 用的 HTML/CSS/GSAP 渲染引擎，适合动态排版/品牌/Web 风视觉，自定义灵活。
- **Motion Canvas**（GitHub 热门）：也是「代码驱动」动画，但用 TS + 自有渲染（非 React），偏技术讲解/教学动画。
- **Diffusion Studio**：偏模板驱动 + 托管 API 的浏览器内视频编辑。

---

## 4. 与我们自己项目的对照

| 维度 | 我们现状（Flova / WL AI Director） | Remotion 路线 | OpenMontage 路线 |
|---|---|---|---|
| 画面/运动来源 | **模型驱动**：z-image 出图 + MiniMax H3 出视频（image2video） | 浏览器渲染代码 | 模型出素材 + 代码合成 |
| 时间轴/剪辑 | 剧本分镜 → 逐镜头 prompt → 模型生成 clip → 拼 | 代码声明式 `frame → 画面` | YAML 清单 + Agent 编排 + Remotion 合成 |
| 一致性约束 | 跨镜头方位/睡衣/手机硬约束（靠 prompt + 校验） | 天然一致（同一份代码） | 靠素材检索 + 场景规划 |
| 产出 | 写实悬疑短片（75s） | 动态图形/数据可视化/模板视频 | 全品类（解说/纪录/预告/avatar…） |
| 可批量化 | 弱（每个镜头都要模型推理） | 强（换 inputProps 批量出 N 个） | 强（参数化 + 云端） |

**给我们的启示（REQ-034 落地参考）**：
1. 我们当前是纯「模型驱动」，**没有 Remotion 这层「代码合成/动画」能力**。如果用户未来想要「把模型生成的 clip 精确剪辑、加字幕、做数据卡、做转场动画」，Remotion/HyperFrames 正是缺的那块拼图。
2. OpenMontage 的「**文件系统优先 + YAML manifest + Agent 驱动**」比我们现在的「硬编码 pipeline 脚本」更适配多 Agent 协作，值得借鉴其清单/checkpoint 接口设计。
3. 其「**质量治理门禁**」（预合成验证 + 幻灯片风险评分）可直接平移到我们的 Flova 验收环节。
4. **许可风险**：Remotion License 对 4 人及以上公司需付费（Company License $100/月起）。如果我们要把 Remotion 打进商业产品，需评估授权；HyperFrames/Motion Canvas/FFmpeg（自有合成）可规避。我们 Canvas Studio 自己用 ffmpeg/ffmpeg.wasm 做后期，路线是兼容的——但**不要直接依赖 Remotion 的闭源 License 组件进发行版**。

---

## 5. 关键取舍：什么时候用哪条路线

- **用模型驱动（Sora/Veo/Kling/MiniMax H3）**：要「真实/写实/电影感画面」「人物表演」「复杂运动」——这些是代码画不出来的。我们 Flova 写实悬疑短片就属此类。
- **用 Remotion/HyperFrames（代码驱动）**：要「数据可视化」「字幕/标题卡」「动态图形/产品演示」「千人千面批量模板」「像素级精确控制」「可版本控制/可复现」——这些模型不稳、且代码更便宜可控。
- **两者结合（OpenMontage 模式）**：模型出「难以生成的素材/片段」，代码负责「精确的剪辑、动画、字幕、合成」。这是目前开源社区最被验证的「AI 视频生产」范式。

---

### 参考链接
- Remotion 官方：https://www.remotion.dev/ ｜ 文档：https://www.remotion.dev/docs
- GitHub 组织：https://github.com/remotion-dev
- OpenMontage：https://github.com/calesthio/OpenMontage
- Remotion 渲染架构拆解：https://www.negabaro.com/en/blog/remotion/remotion-architecture
- Shared-memory capture：https://www.remotion.dev/docs/shared-memory-capture
- Remotion 渲染耗时分析：https://rendercomp.com/blog/remotion-render-time-benchmarks
