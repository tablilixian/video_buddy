# video-shotcraft-dsh 借鉴评估（2026-11-12）

> 对象：<https://github.com/kingselyjoe/video-shotcraft-dsh>（Apache-2.0，150★，2026-08 建仓）
> 问题：① 它走的是哪条渲染路线？② 它的模板/镜头卡能不能被我们借鉴？
> 结论先行：**路线和我们相反（Route A / SSR + agent 写 TSX），但它的「镜头卡文本资产」几乎可以无偿借鉴，
> 「demo 组件」只能按能力映射部分移植，「整支模板工程」不建议抄。**

---

## 1. 路线判定：Route A（SSR + 代码生成），与我们的 Route B（CSR + 声明式 JSON）相反

### 1.1 证据（实读源码）

| 证据 | 内容 | 说明 |
|---|---|---|
| `template/package.json` | `@remotion/cli@4.0.484` / `remotion@4.0.484` / `react@19.2.7`；scripts = `remotion studio` / `remotion render` / `remotion still` | **CLI 驱动**，渲染起 headless Chrome（SSR）；无 `@remotion/renderer` API 编排，更无 `@remotion/web-renderer` |
| `template/src/aifl/*` | `Main.tsx` + `SceneOpen/FlyIn/Detail/Papers/Wbr/OutroLive.tsx` + `PaperTitleCard/FlashCut/Caption/DigitRoll` + `live-layout.json` | 产物是**一支片子的 TSX 工程**，不是数据 |
| `SKILL.md` | 「需要模板时先复制到目标目录」「制作代码与渲染产物必须写入用户确认的目标目录」 | agent 的动作是**复制工程 → 改代码 → 跑 npm** |
| `demos/*/*/*.tsx`（202 个文件 / 143 个 demo 目录） | 每个 demo 是自包含 React 组件，靠 `useCurrentFrame` + 归一化 `t` 驱动 | 与「一套固定组件解释 JSON」正好相反 |
| `dsh/manifest.json` | `runtime.commands: [node, npm, npx]` | 依赖外部 npm 工具链 |

### 1.2 两套路线逐项对照

| 维度 | video-shotcraft-dsh | 本项目（Canvas Studio） |
|---|---|---|
| 渲染位置 | Node + headless Chrome（`remotion render`） | Electron 渲染进程 + WebCodecs（`renderMediaOnWeb`） |
| 输入形态 | **agent 写/改 TSX 代码** | **agent 写 JSON manifest**（10 类轨道） |
| 打包 | 每个项目都要 `npm install` + webpack bundle | 零打包（`lib/render-host.js` 随插件出） |
| 包体成本 | 随项目装 CLI + headless-shell | +0MB |
| 可控性 | 任意 CSS / 任意组件（上限高，失败面不可穷举） | 能力有边界（可 lint、可体检、可回放） |
| 渲染入口 | 用户项目里的 npm 脚本 | 宿主工具 `render_composition` + 工单桥 |
| 版本 | Remotion 4.0.484 / React 19 | Remotion 4.0.535 / React 18.3.1 |

> ⚠️ 顺带一个**不能混用**的点：它的 demo 全部按 React 19 + 4.0.484 写，我们是 React 18.3.1 + 4.0.535。
> 直接拷 TSX 进来会同时踩两处版本差（尤其 `@remotion/cli` 与 web-renderer 的内部 API 强耦合，见 `tests/remotion-lockstep.test.mjs`）。

---

## 2. 它的资产结构：真正值钱的不是代码

```
SKILL.md                  工作流总纲（三种模式：套模板 / 自主创作 / 共创）
references/
  pipeline.md             六阶段流水线
  aesthetic-rules.md      审美准则（Q1~Q9）
  music-beat-sync.md      卡点方法论（beatF(n) 写时间线）
  sound-design.md         SFX 设计
  final-review.md         终检清单
  shots/<10 类>/*.md      ★ 152 张镜头配方卡（核心资产）
demos/<10 类>/<卡名>/*.tsx   每张卡的参考实现（202 个文件）
gallery/
  api/library.json        152 卡 / 209 样式 的可检索索引（JSON）
  source/*.md             卡片全文（给 Gallery 用）
template/                 一支已验收的 36.2s 成片工程（Ink Press）
assets/audio/             11 个 SFX（Mixkit，另附 ATTRIBUTION）
```

**卡片本身的写法**（这才是可搬运的部分）：`一句话 / 适用 / 时长 / 能量` + `意图` +
`动效核心`（含时间窗与缓动的精确数值）+ **`参数表`（典型值 + 调节手感：为什么 3–4f 是甜点、>8f 会怎样）**
+ **`已知坑`** + `参考实现` 指针。

> 这个「参数表 + 已知坑」的密度，比我们现有的 `code-driven-explainer/references/animation-and-assets.md`
> 高一个量级。它沉淀的是**调参直觉**，而调参直觉与渲染路线无关——JSON 也好 TSX 也好，都是同一批数字。

### 2.1 152 张卡的分布

| 类别 | 数量 | 对我们（manifest 能力）的适配度 |
|---|---|---|
| typography 文字与字卡 | 25 | **高**（`textCard.anim` 直接对得上） |
| ui-entrance 界面登场与陈列 | 27 | 中（`image`/`group`/`animate` 可表达，但依赖真实截图素材） |
| transition 转场 | 19 | 中（我们 11 种效果，能覆盖约 5 张） |
| effects 光效与强调 | 17 | **低**（大量 CSS 滤镜/混合模式，CSR 不支持） |
| interaction 交互演示 | 15 | 低（要真实产品截图 + 光标轨迹） |
| data 数据与指标 | 11 | 中高（`chart` / `countUp` / `dataCard`） |
| rhythm 节奏与蒙太奇 | 11 | 中（`playbackRate` 有，但段内变速没有） |
| camera 运镜与空间 | 10 | **高**（我们有真 3D + `orbit` + `animate`） |
| opening 开场与品牌 | 10 | 中（`reveal` / `draw` / `callout` 部分覆盖） |
| outro 收尾 | 7 | 中 |

---

## 3. 能不能借鉴？按「成本 × 收益」分四档

### 档 A · 零代码风险，可直接吸收（**建议立刻做**）

把 152 张卡的**文本**搬进我们的知识层，不搬代码。落点是 skill 的分册，不是组件：

| 卡片族 | 落点 | 为什么值 |
|---|---|---|
| typography 全类（25） | `code-driven-explainer/references/` 新增 `text-reveal-recipes.md` | 我们的 `anim` 只有 4 个 preset，模型选不到「翻牌/滚轮/乱码/描边填充」；卡的参数表直接变成提示词 |
| camera（10） | 现有 `animation-and-assets.md` 补「运镜关键帧表」段 | 我们有 `rotateX/rotateY/z/perspective` + `orbit`，但模型不会自己算关键帧；卡里给了成套数值 |
| rhythm（11） | 与现有 `audio-first.md` + `analyze_beats` 对齐 | 它的 `beatF(n)` 时间线写法可以直接抄成"先用 `analyze_beats` 拿 bpm，再按拍号写 startFrame" |
| 审美准则 Q1~Q9 + 已知坑 | `aesthetic-rules` 提炼成我们的"观感体检"补充规则 | 与我们的 `motion-lint` ML-01~12 互补：我们管"有没有动"，它管"动得好不好看" |

> 注意：**只搬"手法与参数"，不搬"表达"**（见 §4 授权）。搬文本时改写成我们自己的口吻，
> 并标注来源，避免出现"我们的文档里塞了别人 152 篇原文"这种一次性债务。

### 档 B · 低成本可移植（每个 30–80 行 + 表测）

我们的 `TextAnimPreset = 'fadeUp' | 'maskReveal' | 'typewriter' | 'wordStagger'`，
而它光 typography 就有 25 张卡。以下 6 张**只差一个纯函数**：

| 卡 | 我们的差距 | 落地方式 |
|---|---|---|
| `blur-slide` | 已有 `wordStagger` + `animOptions.{offsetY, blur}`，**但入场窗写死 12f**（`TextCard.tsx:37`），它是 20f | 把 `unitDurationInFrames` 暴露进 `animOptions`（`textUnitProgress` 已支持该参数，只差接线 ~5 行） |
| `split-flap-title` 翻牌 | 无 | 新 preset，纯函数按 `p` 算 `rotateX` + 上下两半 clip |
| `vertical-word-roll-blur-cycle` 竖排滚轮 | 无 | 新 preset，`translateY` + `overflow:hidden` |
| `scramble` 乱码 | 无 | 新 preset，确定性伪随机（禁 `Math.random`，用种子） |
| `glitch-cycle` | 无 | 新 preset，克隆两层 + `translateX` 抖动（不用 blend） |
| `gradient-word-sweep` 渐变扫字 | 无 | `background-clip:text` + `backgroundPosition` 扫；CSR 下需实测（属"跑一次才知道"类） |

**做法建议**：不要这 6 张一起上。先做 `blur-slide`（几乎是白捡）+ 1 张重手法（建议 `split-flap`），
验证「新 preset 的接线成本」再决定要不要铺开。

### 档 C · 中成本，值得单独立项

1. **2.5D 页面相机（`PageCam.tsx`）**：整页截图 + 关键帧 `{frame, cx, cy, zoom, rotX/Y/Z, persp}` 插值。
   我们的 `animate` 已经是关键帧模型的退化版（只有 from→to），要复刻它需要「多关键帧 + 每段缓动」。
   **这是"真实产品页特写"这一整类镜头的地基**，也是我们现在最缺的一类。
2. **真实截图采集链**（它的 pipeline 阶段 4）：起 dev server → 无头浏览器截全页 2x → 元素级抠图 →
   `layout.json` 坐标表。我们的 `layout_table` / `inspect_image` 只解决了"下游消费"，
   **上游采集完全没有**。这个缺口决定了我们做不了"复刻真实页面"类视频。
3. **段内变速（speed ramp）**：我们 `playbackRate` 是常量（0.1–4），做不了"先慢后快再定格"。

### 档 D · 不建议借

| 对象 | 原因 |
|---|---|
| `template/`（Ink Press 整支工程） | TSX 工程 + 纸墨风格强绑定 + 全是真实截图素材；抄进来等于在我们体系里维护第二套渲染路线 |
| 24 个用到 `zIndex` 的 demo | CSR 不支持 `z-index`，移植必须先重排 DOM / 改成轨道顺序，属于重写 |
| 11 个用到 `mixBlendMode` / `backdropFilter` 的 demo | 4.0.535 下整字段无效（能力基准 #08/#09 像素实证），搬了也是错的 |
| `assets/audio/` 的 SFX | Mixkit 授权与我们的 `remotion/sfx` 路由是两套；且音频走我们的 `audio` 轨更一致 |

---

## 4. 授权与合规（商业产品必读）

| 项 | 事实 | 我们需要做什么 |
|---|---|---|
| 仓库许可 | **Apache-2.0**（`LICENSE`），`NOTICE` 记 "video-shotcraft Copyright 2026 Wei Yihao" | 若**拷贝代码/文档进我们仓库**：保留 NOTICE 与版权声明、标注修改。若只提炼参数与手法改写，风险更低 |
| 上游来源 | 衍生自 `Vincentwei1021/video-shotcraft`（同 Apache-2.0），本仓库补充了 DSH 打包/安装/CI | 溯源两跳，注意别把上游的品牌与模板当成我们的 |
| 卡片来源 | `references/shots/ATTRIBUTION.md` 明确：手法研究自 x.com 多位作者与商业片（**未获复刻许可**），全部"重新实现、无原素材、去品牌化" | 我们二次借鉴时**保持同样的边界**：只取时序结构与参数，不复刻具体画面/文案/品牌元素；涉及时保留其 ATTRIBUTION 溯源 |
| SFX | Mixkit，另有 `assets/audio/ATTRIBUTION.md` | 不直接 vendor |
| 我们的身份 | Canvas Studio 是**商业产品**（Free 档 ≤3 人） | 建议：**不整包 vendor**，改为"提炼 + 改写 + 标注来源"，并把来源写进 `THIRD_PARTY_NOTICES.md` |

> 一句话：**手法/参数可以学，表达不能抄，来源必须留痕。**

---

## 5. 结论

1. **路线不同**：它是 Route A（SSR + agent 写 Remotion TSX + npm 渲染），我们是 Route B
   （CSR + agent 写 JSON + 工单桥）。它的路线**不可迁移**，也不需要迁移——我们用 JSON 换来的
   可校验、可 lint、可回放，正是它做不到的。
2. **但它的「配方卡」是跨路线资产**：152 张卡的参数表与已知坑，是模型写 manifest 时最缺的
   "调参直觉"。这一档应尽快吸收（档 A）。
3. **代码只值得挑几张**：文字 preset 里有 6 张是纯函数级移植（档 B），先做 1–2 张验证接线成本。
4. **真正值得立项的是它暴露的两个能力缺口**：多关键帧相机（PageCam）与真实截图采集链（档 C）。
   这两块补上，我们才能做"真实产品页"这一类片子——而现在这块是空的。
5. **不要整包 vendor**：Apache-2.0 允许，但会把我们绑进"第二套渲染路线 + 两跳溯源 + 别人的品牌模板"。
