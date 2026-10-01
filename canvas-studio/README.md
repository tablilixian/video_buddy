# Canvas Studio

画布式 AI 视频创作工作流插件:左栏项目列表 + 参考托盘,中间无限画布(顶部固定工具栏 + 底部分镜时间线),右栏为官方对话区。图层列表作为可开关的悬浮面板叠在画布右上角。agent 在对话中编排分镜、角色定妆、场景概念、视频片段与合成,节点实时落在画布上,可打断、改提示、单节点重试。

本插件对 `deepseek-harness/`(pinned 上游)与 `dsh-plugin-desktop/` 零修改,纯新增独立包。开发史见 [`docs/canvas-studio.md`](docs/canvas-studio.md)(一期,**已降级为历史开发档案**)与 [`docs/archive/canvas-studio-phase2.md`](docs/archive/canvas-studio-phase2.md)(二期);**一切「做了没 / 现状如何」以 [docs/STATUS.md](docs/STATUS.md) 为准**。

## 组成

- Host 半(`src/index.ts`):项目注册表(`projects.ts`)、webServer 路由(`routes.ts`,**22 条**常量:projects / draft-landing / resolve-refs / groups / generate / generate-queue / assets / canvas / workflow / upload / upload-media / promote / waveform / split-video / style-demos / asset-gc / asset-history / active-skills / compose 等)、媒体生成工具集(`host-tools.ts`,**26 个工具** Host 侧注册,见 [docs/canvas-studio-tools.md](docs/canvas-studio-tools.md))、skill 注册器(`skills/minimax-skills.ts`,扫描 `skills/` 目录注册全部 **22 个 skill**)。
- 生成与供应商(`generate.ts` / `providers/`):Drama Backend 调用(0.5.0 起视频为 **异步 submit → 30s 轮询 → 40min 整体墙钟**)、fal 适配器、能力路由、产物落盘托管、参考视频 ffmpeg 抽帧提风格;超时与队列语义见 [`docs/canvas-studio-task-timeout-spec.md`](../docs/canvas-studio-task-timeout-spec.md)。
- 本地合成(`compose.ts`):分镜片段 ffmpeg 转码拼接 + BGM 混音淡出,`compose_video` 工具入口(调色 / 交叉淡化等见 [docs/video-chain.md](docs/video-chain.md))。
- 共享契约(`contracts/`、`reference-token.ts`、`node-params.ts`):节点模型(`StudioCanvasNode` 含 filename / sourceIds / shotVersion 等)与 `@ref[显示名]` 引用标记(纯类型/纯函数)。
- Client 半(`src/client/`):三栏框架、画布组件(`client/canvas/`,含参考托盘、时间轴、生成历史抽屉)、全局资产库页(`AssetLibrary.tsx`,REQ-001)、project store、错误系统展示面(`error-toast.ts`)、品牌资产(`brand/`)。

## 机制

- 客户端模块图由 host Loader 条目发现:包声明 `dsh.client`(platform: web)后,浏览器加载 `/plugins/canvas-studio/client.js`。
- 画布与聊天不直接通信:两者同为官方会话通道(`session/event` 帧、`session.prompt` / `cancel`)的对等消费者;agent 生成产物由 Host 落盘 canvas.json(单一真相源),客户端在 tool/result 后重载。
- 素材入口:工具条/拖拽上传**四类文件**(图/视频/音频/文字,CV-241 统一入口本地落盘 + 惰性 promote);帧图与本地产物默认成为参考,经参考托盘「引用到对话」复制 `@ref[显示名]`,Host 工具的 filename(s) 参数自动解析(产物名直传会被 `CS-USER-002` 拦下)。
- 项目 ↔ 会话绑定:每个项目一个工作区;打开项目优先恢复该工作区最近**非空**会话,无历史才新建空白。首页(无项目)为宿主对话卡形态(REQ-005:`LobbySpecRow` 挂 `conversation.input.dock` 槽)。
- 持久化卫生:客户端瞬态占位节点(生成中)绝不落盘;画布保存/重载串行化,`writeCanvas` 带 `author` 写者语义与 `removedIds` 显式删除协议(CV-242);产物两段式回收(`assets/.trash/` + GC,CV-243)与生成历史台账(CV-246)。
- 桌面 advanced 模式:桌面壳的 advanced shell 独占 root 座位;canvas-studio 在该模式下不注册(root 的 children 声明全局唯一),需将桌面 profile 置于兼容模式。

## 构建与安装

```sh
corepack yarn install --immutable   # 根 workspace 安装(含 canvas-studio)
corepack yarn workspace canvas-studio build
corepack yarn workspace canvas-studio dev:install   # 装入当前 profile(scripts/dev-install.mjs)
```

⚠️ **不要用 `dsh plugin --profile <name> add ./canvas-studio`** —— 上游 pnpm 转发与本仓 Yarn workspace 的 store 版本冲突,见 docs/canvas-studio-handoff.md §6。

开发循环:改 client 代码 → `corepack yarn workspace canvas-studio build` → 重启应用(web-app patch 已禁用 HMR,rev 只在启动时重算)。注意 `check` 的 clean 步骤会触发环境 bulk-delete 门禁(lib 受跟踪文件 >50),直接跑 tsdown+tsc 即可。验证链:`typecheck` / `build` / `test:smoke` / `verify:loader`——**根 `yarn check` 不含 canvas-studio**,须在 `canvas-studio/` 内单独跑(见 [docs/DEV-WORKFLOW.md](docs/DEV-WORKFLOW.md))。

## 当前状态(2026-09-30)

一期 P1–P6、二期 P7–P11 全部关闭;CV 主线已推进至 **CV-272**(后端 0.8.0 对拍:tts 转真 / withtxt 文字渲染 / 生视频双工具拆分)。近期里程碑:统一错误处理系统(CV-233)、异步视频任务链(CV-231/238/239)、四类文件统一上传(CV-241)、资产废料回收 + 生成历史(CV-243/246)、全局资产库(CV-255)、首页宿主对话卡(REQ-005,CV-256~262)、对话流中文 tool 行(CV-263/264)。逐项状态见 [docs/STATUS.md](docs/STATUS.md)。

## 已知限制与后续

- 桌面 advanced 模式下不生效(见上文),兼容模式下为默认工作台。
- ffmpeg 解析顺序:显式参数 → `FFMPEG_PATH` → **随包二进制**(`resources/ffmpeg/<平台>-<架构>/`,打包期抓取,CV-201) → ffmpeg-static → 系统 PATH;根 workspace `enableScripts: false` 会跳过 ffmpeg-static 的 postinstall 二进制下载,此时靠随包档兜住,全缺时回退系统 ffmpeg。
- Drama Backend 可用性直接阻塞生成/上传链路(超时+一次性重试已做,健康探针分层 + 「忙/闲」双态 CV-219);**同刻只有一个任务真在跑** —— 宿主有一条**显式单通道队列**(CV-220),排队期间画布显示「生成队列:… · 等待 N 个」且**排队时间不计入客户端占位截止**;视频单段 ≤15s。
- 后端依赖项与待拍板项(resolution-tier 升档、统一时间轴 CV-131/132、REQ-015~019 工具调用条件审计)以 [docs/STATUS.md](docs/STATUS.md) §7 为准;历史待办存档见 [docs/archive/canvas-studio-phase2.md](docs/archive/canvas-studio-phase2.md) §11。
