# 下一步优化 Backlog（2026-10-26 收口）

> 来源：session.v4 三次复盘（2/3/4）+ 布局表达力压测 + 本轮实施剩余项。
> 基线：`5182a410c4`（OPT-1~6 + box 契约）与 `5b44986ee9`（三缺口修复）已提交，**未领 CV 号、未 push**（push 由用户手动执行）。
> **实施状态（2026-10-26 下午）**：P0/P1/P2 全部落地（OPT-8~19），定向测试 174/174 绿、typecheck 绿；CV-325 复核为已被 CV-331 重构覆盖（导入链路本就 fail-closed，欠账笔记过期）；CV-370~373 cv-details 小节已补（两层同步闸 6/6 绿）。P3 缓行未动。**全量 test:smoke 待用户决定。**
>
> 规则沿用：每项验收必须可反向变红；只修产生数据的路径；T3 级改动走全量闸（clean → tsdown → tsc 双 tsconfig → verify:loader → test:smoke + verify-previews）。

## §0 已完成基线（本轮，勿重复做）

| 项 | 内容 | 落点 |
|---|---|---|
| OPT-1+5 | workflow.mode + projects.json 路径注入 system prompt | `workflow-mode-prompt.ts` + routes setMode 失效 |
| OPT-2 | BaseTrack.box（0–100 中心语义）+ fail-closed 校验 + 三组件盒子渲染 | `remotion/manifest.ts` + Video/Image/TextCard |
| OPT-3 | layout-recipes.md 七配方（含压测新增 6/7） | `canvas-studio-creation/references/` |
| OPT-4+6 | 分册批量读取指引 / grep 限定子目录 / heredoc 落盘（平台事实 13–15 条） | SKILL.md + toolchain.md |
| FIX-1 | reconcileVideoDuration 只缩短不拉长，认 trimBeforeFrames | `timing.ts` |
| FIX-2 | xDeclared/yDeclared 逐轴位置声明 | `animated-style.ts` + `Shape.tsx` |
| 附 | box 校验反向变异 15 例、timing 3 例、position-declared 4 例，定向 30/30 绿 | `tests/` |

---

## §1 P0 —— 画质事故修复（产品码，用户可感知，最先做）

### OPT-8 · VideoClip/ImageClip 无 box 路径底色涂黑整帧
- **证据**：session.v4-4 @12:31 实证——无 box 的 video 轨容器 `AbsoluteFill` 自带 `backgroundColor:'#000'` 铺满画布；当视频轨 z 序在文字卡之上，整帧被涂黑、卡片消失。agent 只能改轨序绕过。
- **方案**：底色从铺满容器改为只跟媒体元素本身（媒体区域内着色；媒体加载前的兜底色也限制在元素盒内）。无 box 时媒体元素即全屏，行为对全屏用法不变。
- **配套 lint**：`validateManifest` 增编排体检 warning——全屏媒体轨位于非全屏内容轨（textCard/shape）之上时提示 z-order 风险。
- **验收**：① 新单测：`{video 轨在上 + textCard 在下}` 渲染帧文字卡可见（用既有 preview/渲染测试基建）；反向变异——恢复容器底色断言即红。② 用 `scripts/probe/layout-demo.probe.mjs` 复现「视频在上、卡片在下」场景目视验收。

### OPT-9 · look.temperature 的 hue-rotate 恒定 168deg
- **证据**：session.v4-4 @12:39 实证——`amount` 只缩放 `sepia()`，`hue-rotate` 以固定大角度参与 → 冷蓝 `#161f38` 被染成暖棕，与风格规范冲突。agent 手算颜色矩阵才定位，删 temperature 绕过。
- **方案**：look 管线（`style-presets` → 渲染 resolve 链）让 `hue-rotate` 角度按 `amount` 缩放；若语义上 temperature 不应含色相旋转则直接移除该项。定案前先 grep style-presets.md 中 temperature 的语义承诺，以文档为准。
- **验收**：单测——`temperature:{amount:0}` 输出 filter 串不含 hue-rotate；`amount:1` 与基准风格截图/矩阵对比一致；反向变异即红。真机：冷蓝风格 + temperature 渲染一帧目视。

---

## §2 P1 —— 工具面缺口（每次视频 QC 都在重复付费）

### OPT-10 · qc_shot 支持视频镜头（或新增抽帧工具）
- **证据**：session.v4-4 QC 阶段——`qc_shot` 拒收视频节点，agent 被迫 ffmpeg 抽帧 → `upload_image`×3 → `qc_shot`×3，约 3 分钟 6 次调用/镜头。
- **方案**：二选一（定案时比较）：① `qc_shot` 增加可选 `videoRefs`（Drama 通道已有该参数先例），host 侧自动抽 N 帧走既有图像 QC 链；② 新增 `video_frame_extract` 工具落帧到 assets 再人工 qc。倾向 ①（一次调用闭环）。
- **验收**：单测——videoRefs 命中时产出与图像 QC 同构的调用链；反向变异即红。真机——视频镜头 QC 从 6 次调用降到 1 次。

### OPT-11 · muted/静音的平台保证写入 render report
- **证据**：session.v4-4——`muted:true` 是否真静音需 agent 用 ffprobe 采电平对比（−33dB vs −14dB）人工验证，~1.5min。
- **方案**：渲染/合成链在剥离音轨处输出确定性字段（如 `report.audio: {stripped: true, sources: [...]}`），report 消费端可见。
- **验收**：单测——muted 轨渲染后 report 字段为 stripped:true；非 muted 轨为 false。无需人工电平验证。

### OPT-12 · image_generate 关键参数守卫
- **证据**：session.v4-4 首次生成漏传 `aspectRatio` → 同图重做 3 次（~100s 浪费）。
- **方案**：在唯一入口 `wrapStudioToolDefinition` 增加按工具的必填参数校验（image_generate：画布用途下 aspectRatio 必填），拒收并给修正提示。注意与既有 text-guard 体系同构，别另起炉灶。
- **验收**：单测——缺参拒收文案可执行；反向变异即红。不误伤非画布用途（白名单或可选场景放行）。

---

## §3 P1 —— 流程缺口前移（把发现时机从「渲染前」提到「素材落位」）

### OPT-13 · 分辨率对账前移
- **证据**：video_generate 产出 864×480 vs 成片 720p（上采样 1.5×），warning 在 **5 次渲染里重复出现**而无人执行「重出」建议——发现太晚，决策成本已被稀释。
- **方案**：video_generate 完成落位时（list_shots/probeMediaInfo 通道）即与 `OUTPUT_SIZE` 对账：低于成片分辨率 → 当场给三选一决策点（重出 / 接受上采样 / 换素材），不再等到 render warning。
- **验收**：单测——低分辨率素材在落位对账处报决策点；渲染链不再重复该 warning（或降为 info）。

### OPT-14 · 素材总长 vs 时间轴窗口预对账
- **证据**：session.v4-4——素材总长 742 帧 > 窗口 705 帧（超 37 帧），渲染前才发现，agent 用 16 帧交叉溶解绕过。
- **方案**：storyboard 定稿/素材落位时对每镜做「素材时长 ≥ 镜头窗口」校验，超窗即提示（重出 / 预留溶解帧 / 缩窗），写进 skill 流程与 lint。
- **验收**：单测——超窗素材在预对账处拦截；反向变异即红。skill 分册补一段操作指引。

### OPT-15 · QC 末帧约定（消灭动画中段假象）
- **证据**：session.v4-4——S5 标题「偏移 ~100px」实为 maskReveal 动画中段，末帧居中，烧掉 ~4 轮排查。
- **方案**：① skill（qc/一致性分册）写明铁律「动画轨先看窗口末帧再定论」；② render report 附每轨动画窗口表（start/end 帧 + 动画类型），QC 有据可查。
- **验收**：skill 守卫测试覆盖该句；report 字段单测。

---

## §4 P2 —— 会话效率深化（生产侧 74% 时间是模型延迟，压上下文是唯一杠杆）

### OPT-16 · 禁全量 dump 约定
- **证据**：session.v4-3/4——agent 反复把整份 storyboard.json/manifest 打进上下文，10MB 会话、4 次 compaction，每步 prefill 从 27s 恶化到 41s。
- **方案**：toolchain.md 平台事实加一条「读大 JSON 一律定向提取（jq/python 片段），禁止整份 cat 进回复」；`write_storyboard`/`render_composition` 回执继续只返回摘要（已有基础）。
- **验收**：toolchain 守卫；下次真机会话观测 compaction 次数 ≤2。

### OPT-17 · 探针类调用批处理指引
- **证据**：T3 62min 里 75 次调用多为「想一下、探一根针」。
- **方案**：skill 加指引「连续探查类操作合并为一次脚本/一次多参数调用」；与 OPT-16 同一条平台事实即可，不单开条目。
- **验收**：合并进 OPT-16 验收。

### OPT-18 · SKILL.md 字节余量恢复
- **证据**：总纲现 11,255B / 闸 11,264B，**仅余 9B**——下次任何增补必然破闸，会被迫做临时精简。
- **方案**：专项精简一轮（与 frontmatter description 重复的语义、可下沉到分册的细则），腾出 ≥300B 余量；或评估闸值是否需要上调（动闸要连 tests 两处常量同改）。
- **验收**：`skill-progressive-disclosure` 闸绿且余量 ≥300B。

### OPT-19 · layout-recipes 配方截图补齐
- **证据**：配方文档目前纯文字；压测已产出真实渲染产物可截图。
- **方案**：用 `layout-demo.probe.mjs` 对 split-lr / split-tb / PiP / lower-third 逐配方渲静帧，落 `assets/layout-demos/`，与 style-demos 同管线。
- **验收**：截图 = 真实渲染产物（非手画）；配方文档逐条挂链。

---

## §5 P3 —— 缓行（依赖前置项，勿提前做）

| 项 | 内容 | 解锁条件 |
|---|---|---|
| OPT-7 | `layout.preset` 命名布局模板 | OPT-2 已落地，等真实会话 box 使用分布数据，出现高频重复组合再固化 |
| OPT-20 | box 进 animate（平滑 zoom 过场，替代硬切） | 平台级契约扩展，等真实需求频次；压测已证明分段轨硬切可覆盖多数场景 |
| OPT-21 | textCard scale-to-box（小卡片/小标签） | 压测确认「只裁不缩」是表达力边界；先靠配方 7「大盒子贴设计尺寸」约定顶住 |
| — | RenderHost v2（后台渲染隐藏窗口） | 已有 `docs/plans/REQ-034-后台渲染方案-20261019.md`，S0 spike 四问未跑，按原计划排期 |

---

## §6 存量欠账（非本轮产生，顺带清账）

| 项 | 内容 | 动作 |
|---|---|---|
| CV 登记 | 本轮两笔提交（`5182a410c4` / `5b44986ee9`）未领 CV 号 | 取号前 `git log` + STATUS §4.1 复核，三层登记（§4.1 索引行 / cv-details 小节 / changelog 一行）+ §0 水位，跑 `status-summary.mjs` |
| CV-370~373 | `af10dc3209` 只登了 STATUS 头部块 + CV 表，**cv-details 缺小节** → smoke 两层同步闸持续挂 | 补 cv-details 四个小节 |
| 全量 smoke 残留 | 恢复轮询 `render-host-retry` 满载偶发（单跑 4/4 绿） | 观察一次全量，仍偶发则加互斥/重试 |
| CV-325 | `validateUpload` fail-open 未修 | 与 OPT-12 同批次（都是工具入口守卫） |
| 其他历史 | CV-202 / CV-218 / 隐藏受众漏清占位计时器 / 零执行失败留红标节点 / CV-220、CV-201 等待验收 | 以 STATUS 未完成清单为准，不在本 backlog 展开 |

---

## §7 建议执行顺序

1. **第一批（画质事故，半天级）**：OPT-8 + OPT-9 —— 都是单点产品码修复 + 反向变异单测，走 T2 全量闸。
2. **第二批（工具面，一天级）**：OPT-10 + OPT-11 + OPT-12（+ 顺带 CV-325）—— 同属工具入口/host 侧，一起过闸。
3. **第三批（流程前移，文档+lint 为主）**：OPT-13~17 —— skill 约定 + 少量 lint 代码，风险低。
4. **收尾**：OPT-18/19 + §6 存量欠账登记。
5. P3 全部缓行，等数据再立项。

每批完成即真机冒烟一次（`start-canvas-studio.sh` 完整模式），配方截图（OPT-19）可借冒烟顺产。
