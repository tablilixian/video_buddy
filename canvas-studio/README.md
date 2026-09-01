# Canvas Studio

画布式 AI 视频创作工作流插件:左栏项目列表 + 参考托盘,中间无限画布(顶部固定工具栏 + 底部分镜时间线),右栏为官方对话区。图层列表作为可开关的悬浮面板叠在画布右上角。agent 在对话中编排分镜、角色定妆、场景概念、视频片段与合成,节点实时落在画布上,可打断、改提示、单节点重试。

本插件对 `deepseek-harness/`(pinned 上游)与 `dsh-plugin-desktop/` 零修改,纯新增独立包。计划见 [`docs/plans/canvas-studio.md`](../docs/plans/canvas-studio.md)(一期)与 [`docs/plans/canvas-studio-phase2.md`](../docs/plans/canvas-studio-phase2.md)(二期,含变更记录)。

## 组成

- Host 半(`src/index.ts`):项目注册表(`projects.ts`)、webServer 路由(`routes.ts`:projects/generate/assets/canvas/workflow/upload/upload-video)、媒体生成工具集(`host-tools.ts`,Host 侧注册)、skill 注册器(`skills/minimax-skills.ts`,扫描 `skills/` 目录注册全部 skill)。
- 媒体管线(`generate.ts` / `video-style.ts`):Drama Backend 调用、产物落盘托管、P8.4 参考视频 ffmpeg 抽帧提风格。
- 共享契约(`contracts/`、`reference-token.ts`):节点模型(含 filename/isReference/referenceRole/referenceStrength)与 `@ref[显示名]` 引用标记(纯类型/纯函数)。
- Client 半(`src/client/`):三栏框架、画布组件(`client/canvas/`,含参考托盘)、project store、资产捕获与点选式提问卡片。

## 机制

- 客户端模块图由 host Loader 条目发现:包声明 `dsh.client`(platform: web)后,浏览器加载 `/plugins/canvas-studio/client.js`。
- 画布与聊天不直接通信:两者同为官方会话通道(`session/event` 帧、`session.prompt` / `cancel`)的对等消费者;agent 生成产物由 Host 落盘 canvas.json(单一真相源),客户端在 tool/result 后重载。
- 素材入口:工具条/拖拽上传图片(P8.1)与参考视频(P8.4,ffmpeg 抽帧 ≤8 张 + image2vl 风格归纳便签);帧图与本地产物默认成为参考(role=style/image 等,带 Drama filename),经参考托盘「引用到对话」复制 `@ref[显示名]`,Host 工具的 filename(s) 参数自动解析。
- 项目 ↔ 会话绑定:每个项目一个工作区;打开项目优先恢复该工作区最近**非空**会话(避免重复新建空白会话导致历史"消失"),无历史才新建空白。
- 持久化卫生:客户端瞬态占位节点(生成中)绝不落盘;画布保存/重载串行化,最后一次保存必为最新状态。
- 桌面 advanced 模式:桌面壳的 advanced shell 独占 root 座位;canvas-studio 在该模式下不注册(root 的 children 声明全局唯一),需将桌面 profile 置于兼容模式。

## 构建与安装

```sh
corepack yarn install --immutable   # 根 workspace 安装(含 canvas-studio)
corepack yarn workspace canvas-studio build
dsh plugin --profile <name> add ./canvas-studio
```

开发循环:改 client 代码 → 重建 bundle → 重启应用(web-app patch 已禁用 HMR,rev 只在启动时重算)。注意 `check` 的 clean 步骤会触发环境 bulk-delete 门禁(lib 受跟踪文件 >50),直接跑 tsdown+tsc 即可。

## 阶段

一期 P1–P6 全部关闭(见 handoff 文档);二期 P7–P11 见 [phase2 计划](../docs/plans/canvas-studio-phase2.md)。当前快照:P7 门控代码完成待端到端验收;P8 素材入口代码全部完成(上传图片/多参考扩参/拆单镜/参考视频抽帧提风格);P9 参考闭环(@ref/list_references/类型强度)已落地,本地合成未开始;P10 超时与重试已提前落地。

## 已知限制与后续

- 桌面 advanced 模式下不生效(见上文),兼容模式下为默认工作台。
- ffmpeg 解析顺序:显式参数 → `FFMPEG_PATH` → ffmpeg-static 二进制 → 系统 PATH;根 workspace `enableScripts: false` 会跳过 ffmpeg-static 的 postinstall 二进制下载,此时回退系统 ffmpeg,两者皆缺时报中文安装指引。
- Drama Backend 可用性直接阻塞生成/上传链路(超时+一次性重试已做,健康探针在 P10);视频单段 ≤15s。
- 明文 API key 迁移 `$DSH_HOME`、sessionId 持久化、P9 本地合成(时间轴 + compose 路由)等见 phase2 §11 待办清单。
