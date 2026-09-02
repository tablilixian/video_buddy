# Canvas Studio 二期优化计划（Phase 2）

> DSH Desktop 项目内 canvas-studio 插件的二期打磨计划。一期（P1–P6，见 `canvas-studio.md` 与 `canvas-studio-handoff.md`）已跑通主链路并全部关闭；二期目标是补齐产品承诺的四块短板，把工具从"演示可用"打磨成"日常好用"。
>
> 关联文档：`canvas-studio-api-usage.md`（Drama Backend 接口使用指南，本文的接口事实来源）、`canvas-studio-tools.md`（工具契约）、`api.md`（后端原始 API 参考 v0.2.0）。
>
> 已确认决策（2026-08-24）：① P7 门控最先做；② 接受引入 ffmpeg-static（LGPL 构建）；③ 参考视频两步走（先抽帧提风格）；④ 二期不含内置化打包（推三期），继续 dev 形态。

## 1. 一期结论与二期目标

一期已交付：文字输入 → agent 编排（LLM + creation-spec skill）→ 格子分镜 → 定妆锚点 → 逐镜出图 → 图生视频/多图合成，所有产物实时落画布，支持逐节点打断/重试/改提示词。

对照产品目标（"文字+参考图/参考视频 → agent 调度 → 几十秒成片，全程可视可控"）仍有四个缺口：

| # | 缺口 | 现状证据 |
| --- | --- | --- |
| 1 | 需求澄清无硬门控 | 仅 skill 提示词纪律（`creation-spec.ts` "先给用户确认"），agent 可以跳过确认直接生成 |
| 2 | 素材入口缺失 | 用户本地图无法进入工具链（`upload_image` 只收 URL）；无参考视频通路；存量工具多参考图参数未暴露 |
| 3 | 成片合成缺失 | 无本地拼接/导出，"几十秒"只能靠 MKR 插值（≤~30s）或多段独立片段节点 |
| 4 | 可靠性弱 | 后端宕机即挂起；`DRAMA_API_KEY` 明文且未随请求发送；项目不持久化 sessionId |

## 2. 阶段总览与排期

```
P7 ──► P8 ──► P9        主线（交互契约 → 输入 → 输出）
P10 ────────►           穿插
P11                     收尾弹性池（按需裁剪）
```

| 阶段 | 主题 | 关键交付 |
| --- | --- | --- |
| P7 | 需求澄清门控 + 显式执行模式 | 项目工作流状态机、审批工具与 UI 条、生成硬门禁、模式开关、skill 五要素澄清 |
| P8 | 素材入口 | 本地图片上传路由、存量工具多参考扩参、分镜拆单镜闭环（splitegrid）、参考视频抽帧提风格 |
| P9 | 成片合成与导出 | 时间轴排序持久化、ffmpeg-static 本地拼接/转码/BGM 混音、一键导出 mp4 回写画布 |
| P10 | 可靠性与安全 | `/health` 探针与友好降级、请求超时与重试、API key 处置、sessionId 持久化 |
| P11 | 体验增强池 | image2character 定妆、inpaint、视频模式扩展（fl2va/ref2va/mkrgrid）、动漫风等 |

## 3. P7 需求澄清门控 + 显式执行模式

原则：门禁做成 Host 侧硬约束，而不是提示词纪律。

### 3.1 项目工作流状态机

`StudioProject` 扩展 `workflow` 字段（registry version 1→2，旧记录迁移补默认值）：

```ts
interface StudioWorkflow {
  /** confirm：逐步确认；auto：放手跑 */
  mode: 'confirm' | 'auto'
  /** drafting：需求澄清中；awaiting_approval：分镜表待批准；executing：执行中 */
  state: 'drafting' | 'awaiting_approval' | 'executing'
}
```

- 默认 `{ mode: 'confirm', state: 'drafting' }`
- 状态迁移：`submit_storyboard_for_approval` → `awaiting_approval`；用户批准（UI/路由）→ `executing`；用户驳回 → `drafting`；`auto` 模式下提交动作直接跳过等待置 `executing`

### 3.2 新增 Host 工具 `submit_storyboard_for_approval`

- 参数：`storyboard`（markdown 分镜表文本）、`summary?`
- 行为：把分镜表落为画布 `text` 节点（复用 `appendCanvasNode`，origin=agent）；置 `workflow.state = awaiting_approval`；返回文本指示模型停止并等待用户批准
- 会话回合在该工具后自然结束，模型不继续调生成工具

### 3.3 生成硬门禁

`runGeneration`（`host-tools.ts`）在解析项目后检查 workflow：

- `mode === 'auto'` 或 `state === 'executing'`：放行
- `state === 'awaiting_approval'` 或（`confirm` 且 `state === 'drafting'`）时：`storyboard_generate` / `video_generate` / `video_composite` 抛错，错误信息指导模型先走 `submit_storyboard_for_approval`；`image_generate` / `style_transfer` / `upload_image` / 文本工具放行（策划期概念图允许）

### 3.4 审批 UI 与路由

- 新路由 `GET/POST /canvas-studio/workflow`：GET `?projectId` 读 workflow；POST `{ projectId, action: 'approve' | 'reject' | 'setMode', mode? }`（沿用同源校验）
- `StudioFrame` 顶部审批条：`awaiting_approval` 时显示「分镜表待批准」＋[批准开始制作] [继续修改]；批准后提示用户在对话中发送「继续」（P7 先用手动恢复；经上游会话服务自动注入消息列为增强项，可行性待验证）
- 模式开关放在项目列表项菜单/详情区，读写走 workflow 路由

### 3.5 skill 更新（`creation-spec.ts`）

- 新增五要素澄清：时长 / 画幅 / 风格 / 节奏 / 受众，缺项先用对话追问，再出分镜表
- 写入门控协议：confirm 模式必须先 `submit_storyboard_for_approval`，被拒时不要重试生成
- 移除 `deduction` 教学（后端已 404，见 §8 探测结果）

### 3.6 验收标准

1. confirm 模式下，agent 跳过审批直接调 `storyboard_generate` 会被拒且收到指引
2. 审批条批准后状态变 `executing`，用户发「继续」后流程走通
3. auto 模式下一句话直达成片，全程无审批中断
4. 重启后项目的 mode/state 保持

## 4. P8 素材入口

### 4.1 本地图片上传

- 新路由 `POST /canvas-studio/upload`：body 为 JSON `{ projectId, name, dataBase64 }`（复用现有 `readJson` 与 16MB 上限；≤5MB 图 base64 后约 6.7MB，够用，避免引入 multipart 解析依赖）
- Host 将 Buffer 经 undici `FormData`/`Blob` POST 到 Drama `uploadimage`，返回 filename 给客户端
- 入口：① 项目详情/工具条「上传图片」按钮（文件选择器）；② 画布拖拽图片文件直接建素材节点（manual origin）并可右键「上传到后端」；③ 聊天附件桥接列为增强项（受上游 InputBar 结构限制）

### 4.2 存量工具多参考扩参（优先于新增工具）

- `GenerateParams.filenames?: string[]`：`image_generate` 图生图映射 `image1~3`（现仅传 image1）；`video_generate` 映射 MSR `image1~4`（现仅传 background）
- 工具 schema 增加 `filenames` 数组参数（上限按端点），保持 `filename` 单参向后兼容
- `video_composite` 维持现状（MKR 关键帧上限 5，已用满）

### 4.3 分镜拆单镜闭环

- 新工具 `storyboard_split`：对格子分镜图产物调 `image2splitegrid`（row×column 由 gridnum 推导：4→2×2、6→2×3、9→3×3，或显式传参）
- 拆出的每张单镜自动 `appendCanvasNode` 为独立 image 节点（sourceIds 指向分镜网格节点），每个都可独立重试/inpaint/作首帧

### 4.4 参考视频（两步走的第 a 步）

- 不依赖存疑的流式上传端点：Host 侧用 ffmpeg-static（P9 提前引入）对本地参考视频抽帧（默认每 2s 一帧，封顶 8 帧）→ 帧图走 `uploadimage` → `image2vl` 归纳风格要素 → 作为后续生成的风格/构图参考
- 入口：项目详情「上传参考视频」；产物为一组帧素材节点＋一张风格归纳 sticky 节点
- 第 b 步（后端视频条件生成）等后端 roadmap，见 §8

### 4.5 验收标准

1. 本地 png/jpg 上传后拿到 filename，可作 image_generate / video_generate 输入
2. `image_generate(filenames=[a,b,c])` 三参考图生图链路真实出图
3. 分镜网格一键拆成 N 个单镜节点，血缘边正确
4. 参考 mp4 抽帧 → 风格归纳 → 用于首镜生成，全流程无手写 filename

## 5. P9 成片合成与导出

- 依赖：`ffmpeg-static`（LGPL 构建二进制）进 canvas-studio 依赖；dev 形态直接走 node_modules，Electron 打包体积问题留给三期
- 时间轴排序持久化：`StudioCanvasView` 扩展 `timeline?: string[]`（clip 节点 id 有序列表），`normalizeCanvasView` 兼容旧文档；时间轴面板支持拖拽排序
- 合成路由 `POST /canvas-studio/compose`：`{ projectId, clipIds, bgmNodeId?, title? }`
  - concat 片段 → 统一分辨率/fps 转码（取第一个 clip 的尺寸）→ 可选 BGM `amix` → 写入 `assets/export/<uuid>.mp4`
  - 同步等待（本地合成几十秒视频通常 <30s，超时上限 120s）；耗时异步化列为后续优化
- 产物回写画布：kind=video、operationType=video-composite、origin=manual、sourceIds=clipIds
- 字幕：分镜表的台词列导出 srt 旁路文件（烧录列 P11）

### 验收标准

1. 选 3 个片段排序导出一个连贯 mp4，分辨率统一
2. 带 BGM 导出音画同步
3. 导出产物出现在画布并可作为后续节点来源

### 5.1 实施步骤（2026-08-25 定稿，按 commit 拆三步）

**P9.1 时间轴排序持久化**（前端为主）
1. `contracts/canvas.ts`：`StudioCanvasView` 增加 `timeline?: string[]`（clip 节点 id 有序列表；缺省时客户端按 createdAt 从视频节点派生）
2. `canvas-view.ts` `normalizeCanvasView`：兼容旧文档（字段缺失保持 undefined；非 string 数组丢弃）；clip 定义 = `kind === 'video'` 的节点
3. `CanvasTimeline.tsx`：条目 HTML5 拖拽重排 → `actions.setView(projectId, { timeline })`（走既有视口防抖保存链路）；时间轴点击定位行为不变
4. 测试：normalize 往返 + 缺省派生顺序

**P9.2 合成路由（Host）**
1. ffmpeg 基建抽公共模块 `src/ffmpeg-run.ts`：把 `resolveFfmpegPath` / `runFfmpeg` 从 `video-style.ts` 移入（video-style 改为 re-export，API 不变；P9 复用同一套 env/static/PATH 解析）
2. 新模块 `src/compose.ts`：
   - 输入 clipIds → 读画布节点解析本地 assets 路径（url 反查文件，缺失报中文错「片段文件不存在，请重新生成」）
   - 两段式 ffmpeg 流水线：① 逐片段统一转码（取第一个 clip 的尺寸与 fps；`scale` + `fps` + `format=yuv420p`，有音轨转 aac 无音轨 `-an`）→ 中间文件进临时目录；② concat demuxer（`-f concat -safe 0`）拼接 → 可选 BGM `amix=duration=first`（BGM 音量钳制 0.8，先混音后封装）
   - 输出写项目 assets 根目录 `export-<uuid>.mp4`（**不放 export/ 子目录**——资产路由是 `<projectId>/<file>` 两段式，避免扩路由）
   - 同步等待上限 120s（AbortSignal.timeout），超时报「合成超时，请减少片段数或缩短时长」
3. `routes.ts` 注册 `POST /canvas-studio/compose`：body `{ projectId, clipIds, bgmNodeId? }`（同源校验同其它 mutation 路由）；返回 `{ url, duration }`
4. 测试：clip 收集/参数构造纯函数断言 + 假 ffmpeg 端到端（同 video-style 测试法）+ 真 ffmpeg 双段 testsrc 本地冒烟脚本

**P9.3 一键导出入口（前端）**
1. `api.ts` `composeStudioVideo(projectId, clipIds, bgmNodeId?)`
2. `CanvasTimeline.tsx` 工具行加「合成导出」按钮：取当前 timeline（≥2 个 clip 才可用），进行中禁用 + 文案「合成中…」；完成 alert 展示时长
3. 成功回写画布：新 video 节点（operationType='video-composite'、origin='manual'、sourceIds=timeline 全部、title=`成片 <日期 时间>`），走 persistAfter 落盘
4. BGM 选择第一版从简：无选择器，后续增强再补（amix 参数已在 Host 就绪）
5. srt 旁路导出为可选尾项（分镜表 text 节点台词列 → srt 下载），不阻塞验收

## 6. P10 可靠性与安全

- 健康探针：`callDrama` 前查 `GET /api/v1/health`（结果缓存 30s），不可达时报中文错误「Drama Backend 不可达，请检查服务」，不再无限挂起
- 超时：`callDrama` 全部加 `AbortSignal.timeout`（图片类 360s、视频类 600s，2026-08-24 验收反馈翻倍；文本 60s）；网络类失败自动重试一次
- 错误码映射：400/500/502 → 区分「参数问题」「后端内部错误」「后端不可用」的中文提示
- 「打断只是本地中断，服务端任务不会回收」在打断按钮 tooltip 如实标注
- API key：实测后端当前无鉴权（health 无 key 通过，见 §8）→ 待后端确认鉴权规划后再决定「随请求发送」或「移除常量」；存储先把 `config.json` 从源码明文迁到 `$DSH_HOME/canvas-studio/config.json`（0600），safeStorage/配置中心随三期桌面配置中心做
- sessionId 持久化：`StudioProject.sessionId?`，工具执行命中项目后回写当前会话 id（具体取值路径运行时验证）；workspace 匹配优先精确 sessionId
- rename 失败降级为尽力改名（沿用 handoff §10.4 记录）

## 7. P11 体验增强池（按需裁剪）

| 项 | 内容 | 依赖端点 |
| --- | --- | --- |
| 真·定妆照 | 新工具 `character_sheet`（四视图立绘）替换 prompt 约定模拟 | image2character |
| 局部重绘 | 新工具 `inpaint_image`，配合画布标注框选 | image2inpaint |
| 动漫风 | `image_generate` 增加 `style: realistic \| anime` | txt2imageanime |
| 视频模式扩展 | ~~`video_generate` 增加 `mode`: msr（默认）/ fl2va（首尾帧）/ ref2va（6 参考一致性）/ mkrgrid（宫格）~~ → **2026-08-25 决策重构**：msr 停用（后端 500），`video_generate` 统一走 FL2VA（无 filename 文生 / 有 filename 首帧，已由本插件默认）；`video_composite` 双图走 FL2VA 首尾帧、≥3 图走 REF2VA（≤6 张）已落地；mkrgrid（宫格）仍挂起待定 | fl2va / ref2va（已落地）；mkrgrid（待定） |
| IPA 风格迁移 | 多参考融合精细控制 | image2ipastyletransfer |
| 字幕烧录 | srt 硬字幕进导出 mp4 | ffmpeg 本地 |
| 缩略图 LOD / 手绘标注层 / 独立 edge 层 | handoff §10.5 既有项 | — |
| store 单测补强 | undo/redo/吸附（tsx 在 React 外跑） | — |

## 8. Drama Backend 联调探测结果（2026-08-24）

| 探测 | 结果 | 影响 |
| --- | --- | --- |
| `GET /api/v1/health` | ✅ `{"status":"ok"}`，无需鉴权 | P10 探针可直接落地 |
| `GET /` | ❌ 500（api.md 称返回 message） | 记入待确认清单 |
| `POST /generate/deduction`（空 body） | ❌ **404 Not Found** | 一期 `deduction` 工具对当前后端失效；skill 移除教学，工具保留待后端澄清 |
| `image2character` / `ipastyletransfer` / `splitegrid` / `inpaint` / `360hdri` / `txt2imageanime`（空 body POST） | ⏳ 连接超时（非 404，端点已路由） | 端点存在，真实参数联调在 P8/P11 进行 |
| `ref2va` | ✅ **实测可用（2026-09-02，效果测试 R001/T1）**：video_composite 双参考出片成功，1280x720@8s | 首次端到端实测记录见 `docs/effect-tests/` 轮次记录表；`fl2va` 已在日常路径持续使用 |

待后端确认清单：

1. `deduction` 端点是否已废弃/迁移（不在 api.md v0.2.0）
2. ~~流式上传 `/generate/upload` 响应无 filename，下游如何引用~~ → **2026-08-31 实测确认为坏端点**：
   POST 任何形态（含空 body）均 500，成功响应从未出现，已从 api.md 移除。待确认项改为「后端是否修复」，
   大文件出路为客户端先压缩再走 `uploadimage`（P8 本地抽帧路线本身不依赖该端点，不阻塞）
3. 鉴权：是否计划加 API key 校验（决定 `DRAMA_API_KEY` 去留）
4. 视频/音频路线图：参考视频条件生成、TTS/BGM 是否规划
5. 根路径 500 是否符合预期

## 9. 里程碑与风险

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M0 | 两份文档落盘（本文件 + api-usage） | ✅ 2026-08-24 |
| M1 | P7 全部验收标准通过 | ✅ 2026-08-25 端到端验收通过（流程跑通；少量非阻塞小问题转入后续优化） |
| M2 | P8 全部验收标准通过 | ✅ 2026-08-25 端到端验收通过（上传/多参考/拆单镜/视频抽帧提风格全链路可用） |
| M3 | P9 全部验收标准通过 | 🟡 部分提前完成（fl2va 双图路径、时长钳制）；ffmpeg 本地拼接未开始 |
| M4 | P10 完成 + P11 裁剪结论 | 🟡 超时/重试已提前落地；health 探针、key 处置、sessionId 未开始；P11 已落地 H3 提示词规范 |

风险：

- Drama Backend 可用性波动会反复阻塞验收（一期已有先例）→ 每阶段验收尽量安排在后端可用窗口，单测用 mock 不依赖后端
- ffmpeg-static 约 +70MB，dev 形态无感，三期打包需评估按平台分发
- 同步阻塞 API 是并发体验天花板，若后端长期不提供任务查询/异步化，只能靠超时+重试缓解

## 10. 画布完成度审计（2026-08-24 验收反馈）

### 10.1 已实现

| 能力 | 状态 |
| --- | --- |
| 视口：平移 / 滚轮平移 / Ctrl+滚轮缩放 / 适配内容 / 重置；持久化（v3） | ✅ |
| 节点：拖拽（对齐吸附+参考线）、8 向缩放、锁定/隐藏/透明度/翻转、z 序 | ✅ |
| 编组/解组、自动整理、复制粘贴、undo/redo（20 步）、键盘快捷键 | ✅ |
| 选择：单选 / Ctrl 多选 / 全选 / Esc 清空；时间轴点击定位聚焦 | ✅ |
| 详情面板：标题改名、类型/操作、工具名、时间、尺寸、透明度、翻转、锁定可见、置顶置底、生成参数查看、错误显示、重试/修改提示词/打断/删除 | ✅ |
| 血缘边：贝塞尔曲线 + 箭头 + 操作标签 chip + 手动连线手柄 | ✅ 组件在，但 agent 生成的节点此前 sourceIds 恒空 → 见 10.2-4 |
| 生成占位（进度条）/ 失败徽标 / 右键菜单 / 小地图 / 图层列表 | ✅ |

### 10.2 本次修复（对应验收反馈四连）

1. **黑图**：媒体加载失败兜底——URL 失效/产物损坏时节点显示「媒体加载失败」徽标而非静默黑块。若图本身是模型输出的黑图属后端问题（右键重试；列入 §8 后端联调）
2. **永远「生成中」**：占位节点加 660s 宽限超时（比 Host 最长视频超时更宽），到点自动转失败并提示重试
3. **重新编辑窗口**：双击任意节点 = 选中并打开详情面板（原双击改名保留在详情面板内）
4. **流程箭头**：根因是 Host 落盘时 sourceIds 恒为 `[]`。新增 `sourceUrls` 参数（image_generate/video_generate/video_composite），Host 按 URL 反查画布节点写入血缘；skill 已指引模型每次传参。**仅对新会话生效**
5. **小地图/图层列表默认关闭**（`VIEW_DEFAULTS` 调整；已保存过视图的项目保持各自记录）

### 10.3 画布后续优化清单（按优先级）

| # | 项 | 说明 | 归属 |
| --- | --- | --- | --- |
| 1 | 文本类节点正文编辑 | 便签/文本/提示双击直接改正文（现在正文只读，只能改标题） | P11 |
| 2 | 框选多选（rubber band） | 目前只有 Ctrl 点选与全选 | P11 |
| 3 | 时间轴拖拽排序 + 多段导出选择 | P9 本地合成的前置交互 | P9 |
| 4 | 详情面板增强 | 产物 URL 复制/下载按钮、来源列表可视化、正文编辑入口 | P11 |
| 5 | 单条血缘边管理 | 删除某条来源 / 边上直接改操作标签（现在只能整节点处理） | 增强 |
| 6 | 大画布性能 LOD | >300 节点降级渲染缩略图（handoff §10.5 既有项） | P11 |
| 7 | 触控板 pinch + 手绘标注层 | handoff §10.5 既有项 | P11 |
| 8 | 后端偶发黑图联调 | 与 WL 侧确认 MSR/fl2va 黑帧问题（前端已兜底提示） | §8 清单 |

## 11. 二期剩余工作清单（2026-08-24 盘点）

> 状态：⬜ 未开始 / 🟨 进行中或部分完成 / ✅ 完成。每项含验收标准；外部依赖单独标注。

### 11.1 P7 需求澄清门控 ✅（2026-08-25 端到端验收通过）

- ✅ registry workflow 状态机（drafting → awaiting_approval → executing，含模式 confirm/auto）
- ✅ `submit_storyboard_for_approval` 工具 + 生成硬门禁（storyboard/video 类工具未批准即拒）
- ✅ `ask_user_choice` 点选式提问（Host 阻塞等待 + 对话区内联选项卡片 + 答案自动回流）
- ✅ 审批条 / 模式开关 UI；skill 五要素逐项提问协议
- ✅ **端到端验收**：「点选澄清 → 五要素摘要 → 分镜表审批 → 批准 → 生成」与「放手跑」两条路径均跑通（验收反馈的若干非阻塞小问题列入后续优化清单）

### 11.2 P8 素材入口 ✅（2026-08-25 端到端验收通过）

1. ✅ 本地图片上传：`POST /canvas-studio/upload`（JSON base64，复用 readJson/16MB 上限）→ Drama `uploadimage`
   - 验收：工具条按钮 + 画布拖拽两个入口；上传后 filename 可直接作生成输入
2. ✅ 存量工具多参考扩参：`image_generate` 已支持 `filenames`（≤3 张映射 image1~3）；video 侧原「msr 补 image1~4」**已作废**（video_generate 走 fl2va 单首帧、video_composite 双图 fl2va / ≥3 图 ref2va）
   - 验收：三参考图生图、参考图+背景生视频真实出片
3. ✅ 分镜拆单镜闭环：新工具 `storyboard_split` 调 `image2splitegrid`（gridnum→row×column 推导），产物逐格落独立节点（sourceIds 指向网格图）
   - 验收：4/6/9 格拆分正确、血缘边正确、单镜可独立重试
4. ✅ 参考视频抽帧提风格（2026-08-25）：新路由 `POST /canvas-studio/upload-video`（原始字节流，128MB 上限）→ Host `extractVideoStyle`（`src/video-style.ts`）：ffmpeg 抽帧（每 2s 一帧封顶 8；长片改全片均匀采样）→ 帧图 uploadimage 拿 filename → 均匀抽样 ≤4 帧调 `image2vl` 归纳风格。客户端落「帧 image 参考节点（role=style，带 filename）+ 风格归纳 sticky（血缘指向全部帧）」；工具条「上传视频」+ 画布拖拽视频两入口
   - 验收：参考视频 → 风格归纳 → 用于首镜生成全流程无手写 filename（帧 filename 直接进参考托盘/list_references/@ref）
   - 备注：ffmpeg-static 已进依赖但根 .yarnrc.yml `enableScripts: false` 跳过其 postinstall 二进制下载；运行时按「显式参数 → FFMPEG_PATH → ffmpeg-static 二进制（存在时）→ 系统 PATH」解析，均缺失报中文安装指引

### 11.3 P9 成片合成与导出 🟨（开发中，2026-08-25 启动；实施步骤定稿见 §5.1）

1. ✅ P9.1 时间轴片段拖拽排序 + `view.timeline` 持久化（normalizeCanvasView 兼容旧文档；`deriveTimelineOrder` 纯函数派生有效顺序：持久化优先 → 剔除已删 → 新节点按 createdAt 补齐；时间轴条目 HTML5 拖拽重排，落点虚线提示）—— 待桌面验收
 2. ✅ P9.2 合成路由 `POST /canvas-studio/compose`（2026-08-25 收尾，代码完成待桌面核验）：ffmpeg 基建抽 `src/ffmpeg-run.ts`（`resolveFfmpegPath`/`runFfmpeg`/`parseFfmpegStreams`/`parseFfmpegDuration`，video-style 改 re-export）→ 新增 `src/compose.ts`（`collectClips`/`urlToAssetPath` 纯函数 + `buildTranscodeArgs`/`buildConcatList`/`buildConcatArgs`/`buildAmixArgs` 参数构造 + `composeStudioVideo` 逐段统一转码 1280x720@25 → concat → 可选 BGM `amix=duration=first`(BGM 音量 0.8) → 落 `assets/export-<uuid>.mp4` 兼容两段式资产路由，返回 `{ url, duration }`）；`routes.ts` 注册路由；单测 72/72 绿（含 compose 9 + 真实 ffmpeg testsrc 双段连贯 mp4 冒烟）。同步等待上限 120s（`AbortSignal.any` 合并调用方 signal），超时/中断报中文。
 3. ✅ P9.3 一键导出（2026-08-25 收尾，代码完成待桌面核验）：`api.ts` 新增 `composeStudioVideo(projectId, clipIds, bgmNodeId?)`；`project-store.ts` 新增 `addComposedVideo`（video-composite 终节点，origin=manual，sourceIds=timeline 全部，title=`成片 <日期 时间>`）；`CanvasTimeline.tsx` 工具条加「合成导出成片」按钮（取时间轴 kind=video 片段，≥2 才可点，进行中禁用 + 文案「合成中…」），成功回写画布并 alert 时长；BGM 第一版从简（无选择器，bgmNodeId 留接口）；srt 旁路导出列为可选尾项（不阻塞验收）。验收：3 片段排序导出连贯 mp4 出现在画布并可播放。

### 11.4 P10 可靠性与安全 🟨（约 50%）

- ✅ 超时（图 360s / 视频 600s / 文本 60s）+ 一次性重试；错误体透出（含 detail 字段）
- ✅ 视频时长钳制 ≤15s；上传文件名唯一安全化
- ✅ `/health` 前置探针（结果缓存 30s）+ 宕机中文提示：`ensureDramaReachable` 前置于 `dramaPost` 与两条上传路径，宕机时秒级报「Drama Backend 不可达，请检查服务」，不再吃满长超时；`resetDramaProbeCache` 测试钩子；3 个探针契约测试
- ⬜ API key 处置：迁 `$DSH_HOME/canvas-studio/config.json`（0600）；鉴权去留待后端确认（§8-3）—— **优先级后置（2026-08-25 用户决策，不着急）**
- ⬜ sessionId 持久化（StudioProject.sessionId，工具执行命中后回写）
- ⬜ rename 失败降级；「打断仅本地中断」tooltip 标注

### 11.5 P11 增强池 🟨（按需裁剪）

- ✅ H3 提示词规范进 skill；fl2va 双图路径
- ⬜ `character_sheet`（image2character 四视图定妆，替换 prompt 约定 hack）
- ⬜ `inpaint_image` 局部重绘（配合画布标注）
- ⬜ 动漫风（image_generate `style: anime` → txt2imageanime）
- ⬜ 视频模式接线扩展：ref2va（6 参考一致性）/ mkrgrid（宫格）作为 video_generate/composite 参数
- ⬜ 字幕烧录进导出 mp4
- ⬜ 画布 8 项（§10.3）：文本节点正文编辑、框选多选、详情面板增强、单边管理、LOD、pinch、后端黑图联调

### 11.6 外部依赖（非代码）

1. ⬜ Drama Backend 恢复 + 稳定性（当前挂起；黑图/500 需 WL 侧排查）
2. ⬜ 后端对齐五问（§8）：deduction 存废、流式上传 filename、鉴权、TTS/BGM roadmap、根路径 500

### 11.7 推进顺序

```
后端已恢复 → P7 验收收口(✅) → P8（1→2→3→4，✅）→ P9.1 时间轴排序持久化(✅) →
P10 health 探针(✅) → 验收反馈修复四连(✅) + 会话历史恢复(✅) + 启动会话对齐(✅)
→ P9.2 合成路由(下一步) → P9.3 导出 UI → 会话去重(sessionId 入注册表) → P11 裁剪执行
```

### 11.8 验收待办清单（2026-08-25 晚 · 待桌面核验）

- [ ] 验收反馈四连：① 缩略图黑块 ② 重试按钮失效 ③ 删除后 3s 复活 ④ 对话列 480px
- [ ] 点击项目恢复最近非空会话（不丢历史）
- [ ] 启动后自动显示当前项目历史对话（不再需手动点一次项目）
- [ ] P9.1 时间轴拖拽重排 + 刷新/重开保留顺序
- [ ] P10 `/health` 探针：Drama 宕机时秒级中文报错（非 60s 超时栈）
- [ ] 优化池待办：会话内偶现 `Error: [object Object]` 工具错误渲染（abort reason 未取 message）
- [ ] 已知限制：实时进度条未实现（仅首帧占位 + 完整结算），列入 P9.3/优化池

## 12. 变更记录
- 2026-08-24：初版。含一期复盘、P7–P11 设计、首轮后端探测结果与决策记录。
- 2026-08-24（实施日）：M0 完成；P7 代码全部落地（workflow 状态机 + submit_storyboard_for_approval 工具与硬门禁 + workflow 路由 + 审批条/模式开关 UI + skill 五要素澄清），并修复审批条不随工具结算刷新的问题（asset-capture 识别工作流工具）；提前落地部分 P9/P10/P11 项——video_composite 双图走 fl2va、全部视频时长钳制 ≤15s、callDrama 超时+一次性重试、MiniMax H3 官方提示词规范蒸馏进 skill（原文为第三方材料仅本地留存，不入库）。27 项单测全绿。待办：P7 端到端验收 → P8。
- 2026-08-24（验收反馈轮）：超时翻倍（图片 360s / 视频 600s）；画布专项修复五连——媒体加载失败兜底、占位超时转失败、双击打开详情面板、sourceUrls 血缘箭头、小地图/图层默认关闭；新增 §10 画布完成度审计与优化清单。
- 2026-08-24（点选澄清轮）：需求澄清改为**点选式交互**——新工具 `ask_user_choice`（Host 阻塞等待）+ 对话区内联选项卡片（conversationEvents 自定义聊天节点 `canvas-studio-question` 注册进上游 `conversation.chat.node` seat），用户点选后答案自动回流模型；画布侧卡片移除；skill 强制"一次一问、禁文本列表提问"。
- 2026-08-24（视频排障轮）：定位视频 500 两层原因——①我方上传表单文件名写死 `reference.png` 触发后端去重后缀（带空格括号破坏下游，已修：唯一安全名）；②后端整体挂起（health 超时，待 WL 侧恢复）。错误信息透出后端响应体；新增 4 个 api.md 请求体契约测试；api-usage §3.4 扩写为五端点完整详解。
- 2026-08-25（接口收敛）：视频生成收敛到两个已验证接口——`video_generate` 统一 FL2VA（文生 / 首帧），`video_composite` 双图 FL2VA 首尾帧、≥3 图 REF2VA（≤6 张，sliceToMax 收敛）；停用 msr/mkr（后端 msr 500）。config 移除 videoMsr/videoMkr/videoMkrGrid，仅留 videoFl2va/videoRef2va；契约测试替换为 fl2va/ref2va 断言。已按仓库规范（排除 dirty 子模块、只 stage canvas-studio+docs）提交并 `git push`（`origin/dev`,commit e35bc715e7）。本文件 §7 视频模式扩展行、§11.2 P8.2 描述同步修订。下一步：进入 P8 素材入口。
- 2026-08-25（P8.1–P8.3 + P9 参考闭环）：P8.1 本地图片上传（工具条 + 拖拽，arrayBuffer 修二进制破坏）、P8.2 多参考扩参（image_generate filenames ≤3）、P8.3 storyboard_split 拆单镜先后落地；P9 参考图闭环补全——节点模型加 filename/isReference/referenceRole/referenceStrength，新增 @ref[显示名] 引用标记（reference-token.ts，复制进对话由 Host 工具参数级自动解析）、参考托盘 UI、list_references 工具与 image/video/style/composite 四工具的 filename(s) 自动解析。
- 2026-08-25（P8.4 参考视频抽帧提风格）：新路由 `POST /canvas-studio/upload-video`（原始字节流，128MB 上限）+ Host `extractVideoStyle`（src/video-style.ts）：ffmpeg 抽帧（每 2s 封顶 8 帧，长片改全片均匀采样）→ 帧图 uploadimage → 均匀抽样 ≤4 帧 image2vl 归纳 → 客户端一次快照落「帧参考节点（role=style）+ 风格归纳 sticky（血缘指向全部帧）」。引入 ffmpeg-static 依赖（enableScripts:false 下运行时回退系统 ffmpeg，解析顺序见 §11.2-4）；资产 Content-Type 扩展到常见视频容器；generate.ts 抽出 uploadBytesToDrama 共用。测试 55/55 绿（新增 video-style.test.mjs：抽帧计划纯函数、时长解析、ffmpeg 解析顺序、假 ffmpeg + mock Drama 端到端）。P8 代码全部完成，待端到端验收。
- 2026-08-25（验收反馈修复四连）：① 「生成中」黑块残留 —— 占位节点此前会随整表保存落盘，载入只剥标志保留本体；现在持久化前剔除瞬态节点（isLoading / pending-* / 无 url 的 agent 媒体节点），载入时同样丢弃（自动治愈已污染项目）。② 重试无反应 —— rerunNode 失败走 markPendingError 只作用于占位，真实节点的错误被静默吞掉；现在发起即进入加载态（进度遮罩），失败把错误写回节点本体（详情面板可见），无参数的节点给出明确提示。③ 删除后重开复现 —— 删除保存（POST）与 tool/result 重载（GET 整表替换 store）并发竞争；画布读写统一进串行 Promise 链且保存取执行时刻快照，最后一次保存必为最新状态。④ 对话区 380px → 480px。
- 2026-08-25（会话恢复修复）：openProject 此前每次调 startSession，而上游 connectWorkspace 只复用工作区下的**空白**会话 —— 原会话一旦聊过（非 blank），再次打开项目就会新开一个空会话并跳过去，表现为「切换后历史对话消失」（旧对话仍在 Host，仅不再展示）。现改为从会话镜像里挑该工作区 updatedAt 最新的**非空**会话直接 `sessions.open` 恢复（排除 archived）；确实没有历史会话才回退 startSession 建空白，首次使用行为不变。（commit aa88c02b5c）
- 2026-08-25（验收收口与排期决策）：Drama Backend 恢复，P7 + P8 端到端验收**全部通过**（M1/M2 关闭；少量非阻塞小问题转入后续优化清单，待补录）。用户排期决策：① P10 `/health` 探针为下一个开发项（先于 P9 落地）；② API key 处置优先级后置；③ P9 成片合成正式启动，实施步骤定稿见 §5.1（P9.1 时间轴 → P9.2 compose 路由 → P9.3 导出入口，按 commit 分步）；④ 其余增强项（sessionId 持久化、P11 池、画布 8 项）先挂文档排队。推进顺序更新为：health 探针 → P9.1→P9.2→P9.3 → sessionId → P11 裁剪。
- 2026-08-25（health 探针 + P9.1）：① `/health` 前置探针落地——`ensureDramaReachable` 前置于 dramaPost 与 uploadImage/uploadBytesToDrama，结果正负双向缓存 30s，宕机秒级中文报错并阻断后续调用；测试桩统一放行 `/api/v1/health`。② P9.1 时间轴排序持久化落地——`view.timeline?: string[]` 入契约，normalize 兼容旧文档（非法整体丢弃），`deriveTimelineOrder` 纯函数（持久化优先/剔已删/新节点 createdAt 补齐），时间轴 HTML5 拖拽重排 + 落点虚线样式，经视口防抖保存链路持久化。测试 62/62 绿（+3 探针 +4 时间轴）。待桌面验收。下一步：P9.2 compose 路由。
- 2026-08-25（启动会话对齐）：验收反馈「打开客户端后当前项目的历史对话不显示，点一下项目才出现」——上游初始选择策略只恢复最近工作区的**空白**会话，而历史恢复此前只在点击项目（openProject）时生效。新增一次性启动对齐 `alignStartupSession`：工作区/会话基线就绪后，若当前会话缺失或为空白，则恢复该项目工作区 updatedAt 最新的非空会话（`latestResumableSession` 与 openProject 共用）；用户此后主动新建的空白会话不被强行跳走。另记录验收小问题待办：会话里偶现 `Error: [object Object]` 的工具错误渲染（疑似 abort reason 对象未取 message，列入优化池）。
 - 2026-08-25（P9.2 合成路由）：ffmpeg 运行基建从 `video-style.ts` 抽出 `src/ffmpeg-run.ts`（`resolveFfmpegPath`/`runFfmpeg`/`parseFfmpegStreams`/`parseFfmpegDuration`，video-style 改 re-export 保持 API 不变）；新增 `src/compose.ts`：`collectClips`/`urlToAssetPath` 纯函数收集分镜视频 clip 并反查本地资产路径（缺文件报「片段文件不存在，请重新生成后再导出」）、`buildTranscodeArgs`/`buildConcatList`/`buildConcatArgs`/`buildAmixArgs` 参数构造纯函数、`composeStudioVideo` 执行两段式流水线（逐段统一转码 1280x720@25/fps=yuv420p/有音轨转 aac 否则 `-an` → concat demuxer 拼接 → 可选 BGM `amix=duration=first` 音量钳 0.8 → 落 `assets/export-<uuid>.mp4`，整体 120s `AbortSignal` 上限）；`routes.ts` 注册 `POST /canvas-studio/compose` 返回 `{ url, duration }`。单测新增 9 用例（收集/反查/参数构造/流解析/缺文件报错）+ 真实 ffmpeg testsrc 双段连贯 mp4 本地冒烟，总计 72/72 绿。
- 2026-08-25（P9.3 导出 UI）：闭环成片回写——`api.ts` 新增 `composeStudioVideo(projectId, clipIds, bgmNodeId?)`；`project-store.ts` 新增 `addComposedVideo`（video-composite 终节点，origin=manual，sourceIds=timeline 全部，title=`成片 <日期 时间>`，带入 duration）；`CanvasTimeline.tsx` 工具条加「合成导出成片」按钮（取时间轴 kind=video 片段，≥2 才可点，进行中禁用 + 文案「合成中…」），成功经 `persistAfter` 回写画布并 alert 时长；`StudioFrame.tsx` 串接 `handleComposeExport`（clipIds 取时间轴视频节点顺序）；`styles.ts` 补时间轴列布局 + 工具条样式。BGM 选择器第一版从简（接口预留 bgmNodeId）；srt 旁路导出列为可选尾项。至此「创意 → 分镜 → 生成片段 → 时间轴排序 → 合成导出成片」整链路代码完成，待桌面核验。
