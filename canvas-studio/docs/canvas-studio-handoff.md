# Canvas Studio 交接文档(2026-08-21,S1–S7 集成 + 画布体验修复完成)

> 用途:新开对话继续开发前的完整上下文。本文件 + [`docs/plans/canvas-studio.md`](./canvas-studio.md)(完整计划)+ [`docs/plans/canvas-studio-reference-integration.md`](./canvas-studio-reference-integration.md)(S1–S7 集成契约)+ [`docs/plans/canvas-studio-tools.md`](./canvas-studio-tools.md)(9 工具契约)是当前权威。本文件记录"当前状态、已验证机制、环境事实、下一步"。

## 1. 当前状态

**截至 2026-08-25 晚:一期(P1–P6)+ 二期 P7(门控/澄清)、P8(参考素材 1→4)、P9.1(时间轴排序持久化)、P10(health 探针)全部代码完成并已推送 `origin/dev`(或并入 `main`)。验收反馈四连、会话历史恢复、启动会话对齐均已修复并推送。P9.2 合成路由 + P9.3 导出 UI(2026-08-25 收尾,代码完成待桌面核验)已完成:P9.2 ffmpeg 基建抽 `src/ffmpeg-run.ts` + `src/compose.ts`(`POST /canvas-studio/compose`,落 `export-<uuid>.mp4`);P9.3 `api.ts composeStudioVideo` + `project-store addComposedVideo` + `CanvasTimeline`「合成导出成片」按钮回写画布 video-composite 节点。整链路「创意 → 分镜 → 生成片段 → 时间轴排序 → 合成导出成片」代码已闭环,单测 72/72 绿。剩余 会话去重(sessionId 入注册表) / P11 裁剪执行 为技术债与增强,不阻断导出闭环。**

- 仓库根 `canvas-studio/` 独立包,桌面 profile 已集成(`corepack yarn dev` 三栏工作台)。
- 布局:左栏项目列表,中间无限画布(顶部固定工具栏 + 底部分镜时间线),右栏为官方对话区。图层列表是画布右上角可开关浮窗;小地图支持工具条显隐。
- **9 工具扩展(2026-08-21,未提交)**:在原 3 个生成工具外新增 `prompt_enhance` / `upload_image` / `image2vl` / `style_transfer` / `storyboard_generate` / `deduction`,全部走 Drama Backend 同步端点;核心规则「所有图片输入必须先 `upload_image` 拿 filename」;详见 [`canvas-studio-tools.md`](./canvas-studio-tools.md)。
- **画布体验修复(2026-08-21,未提交)**:
  1. **视频不能播放**:`.csNodeMedia` 对 img/video 统一 `pointer-events:none`,视频原生控制条收不到点击;现仅 `img.csNodeMedia` 保持 none。产物路由补 `Range`/`Accept-Ranges`/206/416,支持流式播放与拖进度条。
  2. **视图持久化(canvas.json v3)**:缩放/平移/图层开关/小地图开关落盘,重启恢复。契约 `StudioCanvasView` + `CANVAS_DOCUMENT_VERSION=3`;Host `readCanvas` 返回整文档、`writeCanvas(projectId, nodes, view?)`(Host 写入保留已存视图);client store 增 `views` + `setView` + `viewOf`;CanvasSurface 改**受控视图**(offset/scale 来自 store);帧层 400ms 防抖保存;旧项目无存档视图时首次载入自动适配一次视野。
  3. **工具栏精简**:移除六种对齐与水平/垂直分布按钮(含 store 的 `alignNodes`/`distributeNodes`),只留「整理布局」;整理算法重写为**无重叠网格**(`canvas-view.ts computeArrangeLayout`:单元尺寸取最大节点、组盒子随行且子图层保持相对偏移、按血缘深度+创建时间排序),整理后自动适配视野。
  4. **画布跳动 bug**:时间线点击后 `focusNodeId` effect 依赖 `[focusNodeId, nodes]`,任何节点变化(拖拽帧、生成重载)都会重新居中;改为仅在 focusNodeId 变化时居中一次(`lastFocusedRef` 守卫,nodes 走 ref)。
  5. **悬停跟随移动 bug**:手势状态机空闲态原是 `mode:'pan'`(坐标残留 0,0),悬停触发 pointermove 导致画布跟鼠标走;引入 `mode:'none'` 空闲态,且 `buttons===0` 时自愈结束手势。
- **验证状态**:`corepack yarn workspace canvas-studio check`(build + verify:loader + typecheck)全绿,`test:smoke` **21/21 通过**(原 16 + canvas-view 5)。
- **事故记录**:2026-08-21 曾因带类型错误构建(clean 后 tsc 失败)导致 `lib/` 残缺,桌面启动黑屏。纪律:**启动桌面前必须完整跑过 `check`**。
- 根级 `corepack yarn check` 仍被缺失的 `dsh-community-fabric` / `dsh-community-market` 包阻塞(既有仓库状态,与本插件无关)。

## 2. 参考画布集成(S1–S7)摘要

集成计划文档 `docs/plans/canvas-studio-reference-integration.md` 定义了 7 个阶段,每阶段独立验收/提交。执行结果:

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| S1 模型 + 迁移 | `contracts/canvas.ts` 扩为 v2(`CANVAS_DOCUMENT_VERSION = 2`):`operationType`/`generationPrompt`/`locked`/`visible`/`opacity`/`flipX|Y`/`parentId`/`zIndex`/`loading`/`error`/`progress`/`duration`;`projects.ts` `normalizeCanvasDocument` 做 v1→v2 迁移(zIndex 按文档序递增、补默认值);`generate.ts` `operationTypeOf`/`generationPromptOf` | 完成 |
| S2 连线渲染 | `CanvasEdges.tsx` 重写:按操作类型着色的水平贝塞尔(`|dx|*0.5`)、箭头 marker、中点中文操作胶囊、多源角色标签(首帧/中间帧/尾帧)、端点选中高亮;props 改 `selectedNodeIds` | 完成 |
| S3 状态与交互 | `project-store.ts` 全量重写(多选、undo/redo 快照历史 cap 20、剪贴板、z 序、编组/解组、对齐/分布、`autoArrange` 按血缘深度、`linkLayers`、pending 节点三件套);`canvas-math.ts`(clamp/calculateSnap 5px 六类对齐线 + 网格吸附/contentBounds/screenToWorld/worldToScreen);`CanvasNode.tsx` 重写(交互元素抑制、8 向缩放把手、内联重命名、连线手柄、锁定/加载/错误角标、flip/opacity);`CanvasSurface.tsx` 重写(中键/Shift 平移、Ctrl+滚轮绕光标缩放 0.1–5、fitToContent、窗口快捷键 Delete/Ctrl+C/V/Z/Y/A/Escape、拖拽吸附 + 引导线、resize/link 手势、缩放簇、内嵌 Minimap) | 完成 |
| S4 生成中占位 | pending 节点数据流:`asset-capture.ts` `onToolCall` 放置占位节点(loading + 进度条),`onToolError` 从 `tool/result` 的 `data.error` 标记错误(字符串/`{message}`/兜底文案);成功结果触发画布重载(单一真相源从 Host 重读) | 完成 |
| S5 面板 | 新增 `CanvasToolbar`(撤销/重做/删除/编组/对齐/分布/整理布局/新建便签·文本·提示 + 图层显隐/缩放 ±/适配/重置/小地图显隐)、`LayerPanel`(图层列表:缩略图/锁定/可见性/层级/删除 + 搜索,作为可开关悬浮面板叠在画布右上角)、`LayerDetailPanel`(标题/透明度/镜像/锁定/层级/生成参数预览/重试/修改提示词/打断/删除 + 内联 steer 输入)、`Minimap`(内容拟合 + 视口框拖拽导航,支持工具条显隐开关);全部并入 `StudioFrame` 布局 | 完成 |
| S6 编组/对齐/布局/连线 | 已随 S3 的 store actions + CanvasSurface 手势落地(对齐/分布/编组/解组/手动连线/整理布局) | 完成 |
| S7 节点级重试/修改提示词/打断 | `generate.ts` 支持 `retryOf`(原地更新节点,保留 id/位置/血缘/编组,不产生新边;`generationPrompt` 不夹带锚点);`api.ts` 新增 `retryStudioNode`(解析 `generationPrompt` 重放原参数 + overrides);客户端注入 `'sessions'`,`cancelCurrentTurn` 经 `ctx.sessions.binding(current).session.cancel()` 打断;上下文菜单与属性面板接通重试/修改提示词/打断 | 完成 |

**关键上游事实(S7 依据,源码级核实)**:
- **无 `tool/error` 事件** —— 工具错误以 `tool/result` 的 `data.error` 呈现(参考 `packages/session/session-checkpoint-policy/tests/crash-recovery.e2e.ts` 的 error 形态)。
- 客户端 `SessionFace` 有 `prompt(content, 'queue'|'steer')` 与 `cancel()`;`ctx.sessions` 是合法 client inject(ui-conversation 同款);取会话 face:`ctx.sessions.list.getSnapshot().current` → `ctx.sessions.binding(id)?.session`。

## 3. 已建文件

```
canvas-studio/
├── package.json          # dsh.bundle.patch + dsh.client + exports["./client"] + scripts
│                         # [2026-08-21] dependencies 增 @deepseek-ai/dsh-skill(P6 skill 用,lockfile 待更新)
├── cordis.patch.yml      # insert 自身行 + 禁用 ui-layout
├── tsconfig.json / tsconfig.client.json / tsdown.config.ts
├── scripts/              # clean.mjs / dev-install.mjs / verify-client-loader.mjs
├── tests/
│   ├── asset-capture.test.mjs   # [P4/P4+/S7] 13 用例
│   ├── generate.test.mjs        # [S7/9工具] 3 用例:retryOf 原地更新/缺失目标报错/普通追加(mock registry 已升 v3 文档形态)
│   └── canvas-view.test.mjs     # [2026-08-21 新增] 5 用例:视图规范化/缩放钳制/无重叠布局/组随行/空表
└── src/
    ├── config.ts         # [P3/9工具] 明文配置:DRAMA_API_BASE/KEY、ENDPOINTS(13 端点)、sizeForAspectRatio、newAssetId
    ├── canvas-view.ts    # [2026-08-21 新增] 纯函数:clampViewScale/normalizeCanvasView/computeArrangeLayout(无重叠网格+组随行);lib 产物可被 node --test 直连
    ├── contracts/
    │   ├── project.ts    # StudioProject 共享类型
    │   └── canvas.ts     # [v3] StudioCanvasNode/StudioCanvasDocument(view?)/StudioCanvasView/CANVAS_DOCUMENT_VERSION=3/VIEW_DEFAULTS/NODE_DEFAULTS
    ├── projects.ts       # Host:ProjectRegistry;readCanvas 返回整文档{nodes,view};writeCanvas(projectId,nodes,view?) 合并写且 Host 写保留已存视图
    ├── generate.ts       # [P3/S7/9工具] generateAsset + retryOf + operationTypeOf/generationPromptOf + enhancePrompt/analyzeImage/deduction + uploadImage/resolveImageUrl
    ├── routes.ts         # /canvas-studio/projects | /canvas-studio/canvas(GET 带 view,POST 收 view)| POST /generate | GET /assets(Range/206/416)
    ├── host-tools.ts     # [9工具] 九个 defineTool + resolveProjectId(cwd 反查项目)
    ├── asset-capture.ts  # [P4/S4/S7] STUDIO_TOOL_KINDS(含 style_transfer/storyboard_generate)+ createAssetCaptureDefinition(hooks)
    ├── index.ts          # Host:inject(['webServer','tools'])/apply(注册表 + 路由 + 工具注册)
    └── client/
        ├── index.ts      # apply:advanced 跳过 + provide layout + register root;inject ['slots','workspaces','conversationEvents','sessions']
        │               # 会话级归属 + 共享 store 实例 + applyLoadedCanvas(节点+视图)+ retry/steer/cancel + persistCanvas 带 view
        ├── layout-controller.ts  # ILayout 实现(P1 全 no-op)
        ├── api.ts        # list/create/deleteStudioProject + loadStudioCanvas(→{nodes,view})/saveStudioCanvas(nodes,view) + retryStudioNode
        ├── project-store.ts      # [S3/S6/v3] 全量 actions + 选择器(nodesOf/viewOf)+ views 状态 + setView(scale 钳制);已移除 alignNodes/distributeNodes;autoArrange 走 computeArrangeLayout
        ├── contracts.ts  # StudioProjectListInjected + StudioActions(= EngineStoreInstance actions 绑定类型)
        ├── ProjectList.tsx       # 项目列表 + 新建表单 + 行内删除
        ├── StudioFrame.tsx       # 三栏框架 + 受控视图接线(handleViewChange 400ms 防抖持久化)+ 无存档视图自动适配一次 + 整理后适配
        ├── styles.ts     # 注入 <style data-plugin="canvas-studio">;[2026-08-21] 仅 img.csNodeMedia 保持 pointer-events:none,video 恢复原生控制条(--dsw-alias-* token)
        └── canvas/
            ├── canvas-math.ts    # clamp/calculateSnap/contentBounds/screenToWorld/worldToScreen
            ├── CanvasEdges.tsx   # [S2] 操作类型着色边 + 角色胶囊
            ├── CanvasNode.tsx    # [S3/S4] 节点盒 + 缩放/重命名/连线/角标/占位
            ├── CanvasSurface.tsx # [v3 受控视图] offset/scale 来自 props.view,变更经 onViewChange 进 store;focusNodeId 仅变化时居中一次;手势 'none' 空闲态 + buttons===0 自愈
            ├── CanvasTimeline.tsx # [P4+] 按时间回看/定位条
            ├── Minimap.tsx       # [S5] 内容拟合 + 视口框拖拽导航
            ├── CanvasToolbar.tsx # [精简] 撤销/重做/删除/编组/解组/整理布局/+便签·文本·提示/图层显隐/缩放 ±/适配/重置/小地图显隐
            ├── LayerPanel.tsx    # [S5] 图层列表
            ├── LayerDetailPanel.tsx # [S5] 节点属性/重试/修改提示词
            └── CanvasContextMenu.tsx # [S5] 节点右键菜单
```

## 4. 已验证机制(源码级核实,不要推翻)

1. **root children 声明全局唯一**:同时只有一人能声明某座位。canvas-studio 必须声明全部四个官方座位 `sidebar`/`conversation`/`details`/`shell.overlay`(ui-sidebar 与 ui-conversation 对它们是**裸 register**,未声明即整树抛错)。
2. **`ctx.layout` 服务补位**:ui-layout 被禁后 canvas-studio client 用 `ctx.reflect.provide('layout', layout)` 补位,实现 `ILayout`。
3. **桌面 advanced 模式降级**:client 检测 `window.location.search` 的 `dsh-desktop-mode=advanced` 时跳过注册;用户 profile 是兼容模式,正常生效。
4. **同 priority 重复注册抛错**:两个自建 root 的插件不能同 profile。
5. **客户端模块发现链**:host Loader 条目 name → 包 `dsh.client` 声明 → 浏览器加载 `/plugins/<name>/client.js`。改 client 代码 = 重建 bundle + 重启应用。
6. **patch 层序与语义**:profile bundles 依序 → profile 自己 cordis.patch.yml → `$DSH_HOME/cordis.patch.yml`;patch 按 id 替换整个 config(非深合并);空 patch 文件必须是显式 `[]`。
7. **in-box bundle 不进 profile pnpm**:`@deepseek-ai/dsh-base`/`dsh-web-app` 等经 `$DSH_HOME/profiles/node_modules` 愈合回退解析;pnpm 只管 out-of-tree 包。
8. **桌面 profile 的 pnpm 是 v11**(store v11):子模块 dsh CLI 转发的 pnpm 是 v10 会报 store 不匹配;桌面 profile 操作须在 profile 目录直接 `corepack pnpm@11.7.0`,再手工维护 `dsh.profile.bundles`。
9. **上游构建前提**:跑 web 冒烟(任意 profile)需先 `corepack yarn upstream:build`。
10. **canvas-studio 的 client bundle 无运行时上游依赖**:对 `@deepseek-ai/*` 全是 type-only import(被擦除),唯一运行时外部依赖是 `react/jsx-runtime`(shell 提供)。
11. **client bundle 可运行时 require runtime store 引擎**:`@deepseek-ai/dsh-client-runtime/client` 是上游 `CLIENT_EXTERNALS` 的文档化豁免(RUNTIME_STORE_EXEMPTION),loader 模块表直接应答 —— `defineStore` 从它 import。
12. **workspace.create 幂等**:Host 按路径 resolve-by-path 复用;绑定流程 `ctx.workspaces.create({ path: project.dir })` + `startSession` + `rename`(标题同步)。
13. **项目注册表权限**:目录/注册表 0700/0600;写注册表走 `writeFileAtomic`(`@deepseek-ai/dsh-atomic-write`)。
14. **webServer 路由信任模型**:GET 要求 loopback 权威(remoteAddress 回环 + host=127.0.0.1:port + sec-fetch-site 非 cross-site),POST 加同源 Origin。冒烟 curl 必须带 `-H "origin: http://127.0.0.1:3080"`。
15. **Host 是画布节点单一真相源**:`generateAsset` 落盘后直接写 `canvas.json`(含 `sourceIds` 血缘);capture 只负责触发客户端重载/占位/错误标记,不直接写节点。
16. **会话级项目归属**:`client/index.ts` 订阅 `ctx.workspaces.list`,用 `recentWorkspaceId → view.path === project.dir` 把当前 workspace 映射为画布项目,自动 select + 载入;重启恢复会话后画布不再空态。
17. **相对产物 URL**:`generate.ts` 产物 URL 为同源 `/canvas-studio/assets/<projectId>/<file>`(删 `port` 参数链路);`api.ts` 载入时把旧绝对 URL 归一化,桌面重启换端口不失效。
18. **注入面 actions 绑定**:inject face 的 `actions` 类型用 `EngineStoreInstance<State, Actions>['actions']`(运行时绑定好的、剥离 draft 的版本),不是 `ProjectStoreActions` 字面量类型。
19. **exactOptionalPropertyTypes 纪律**:canvas-studio tsconfig 开启 `exactOptionalPropertyTypes`;构建节点对象时禁止显式赋 `undefined` 给可选字段(用条件展开/解构剥离),契约字段保持 `field?: T`。
20. **画布视图单一来源(2026-08-21)**:offset/scale/图层开关/小地图开关存 store(`views` + `setView`,scale 钳制 0.1–5),CanvasSurface 是**受控组件**;磁盘保存由帧层 400ms 防抖合并;Host 写 canvas.json(generate 落盘)不传 view 时保留已存视图;`viewOf` 返回模块级常量兜底(避免每次快照新对象触发重渲染)。
21. **手势状态机空闲态必须是 `'none'`**:`pointermove` 在悬停时也触发;若用 `'pan'` 当空闲态(坐标残留)画布会跟随鼠标。`buttons===0` 时在 move 里自愈结束手势(表面外松开无 pointerup)。
22. **focusNodeId 只在变化时居中一次**:`lastFocusedRef` 守卫,nodes 走 ref;依赖 nodes 会在拖拽帧/生成重载时反复拉走视口(「画布跳动」根因)。
23. **媒体元素服务契约**:`<img>` 需要 `pointer-events:none`(防拖拽干扰),`<video>` 必须可交互(原生控制条);产物路由须支持单段 `Range`(206 + Content-Range + Accept-Ranges,非法 416),否则视频无法流式/拖进度条。
24. **skill 机制(上游源码级,P6 依据)**:`ctx.skills.register({name kebab-case, description 非空, source:'runtime', content})` 运行时注册;base bundle 提供 `skills` 服务;web-app 禁用 `tool-skill`,但桌面 agent presets(standard/code/cordis)按 preset 挂载 → 桌面会话可见 skill 目录与 `skill` 工具;无 `tool-skill` 的组合静默不可见。

## 5. 环境事实

- **桌面产品已更名 VideoBuddy(2026-08-21,用户要求)**:`dsh-plugin-desktop` 全部用户可见文案(PRODUCT_NAME/窗口标题/托盘/对话框/终端横幅/渲染进程报错)+ electron-builder `build.productName`/`shortcutName` + 相关测试断言已改;内部标识(npm 包名 `dsh-plugin-desktop`、bin `dsh-desktop`、CLI `dsh`、`~/.dsh`)不变;`update-checker.ts` 仍指上游 DSH 发布服务(仅注释保留原名)。
- **userData 目录随之变为 `~/Library/Application Support/VideoBuddy`**(旧 `DSH Desktop` 目录弃用,重启锁清理路径见 §6)。
- **dev 模式 Dock 悬停名**:读的是 `dsh-plugin-desktop/node_modules/electron/dist/Electron.app/Contents/Info.plist`,已 patch `CFBundleName`/`CFBundleDisplayName` = VideoBuddy;**重装 electron 后会还原**,需重跑:
  `plutil -replace CFBundleName -string VideoBuddy <dist>/Electron.app/Contents/Info.plist`(DisplayName 同理)。
- 仓库:`/Users/wl/Desktop/job/learn/video_buddy`,开发分支 `dev`(跟踪 `origin/dev`)、集成分支 `main`;`origin` = `https://github.com/tablilixian/video_buddy.git`(唯一远程,无独立 fork/upstream)。
- 子模块 `deepseek-harness` 当前钉 `dsh-v0.1.1-rc.2`(b150a551b8d4),**永不编辑**;上游命令走根脚本(`corepack yarn upstream:build`);更新 pin 须单独提交(见 AGENTS.md)。
- `$DSH_HOME` 未设置 → `~/.dsh`;profile:`desktop`(桌面在用,已集成 canvas-studio)、`studio`(web CLI 冒烟用)。
- 桌面 profile settings.yaml 有用户 LLM 配置(wlqw provider,模型 `qwopus3.6-27b-v2-mtp-nvfp4`)。
- 用户参考项目:`/Users/wl/Desktop/job/learn/WL_AI_Studio/reference/WL-AI-Director`(CC BY-NC-SA,只借鉴概念/交互/算法,不移植代码)。
- 桌面 dev 实例 webServer 端口动态;CDP 调试端口 9222;重启前须删 `~/Library/Application Support/DSH Desktop/{SingletonLock,SingletonSocket,SingletonCookie}` 与 `crash-evidence/active-run.json`;CDP 脚本在 `/var/folders/v4/sbr4hr2d6t1dzss1ssrhblxw0000gn/T/opencode/dsh-cdp/`。
- 根级 `corepack yarn check` 失败:缺 `dsh-community-fabric` / `dsh-community-market` 包(AGENTS.md 规定它们暂为私有文档脚手架,不得声明可加载入口)。**与本插件改动无关**,验证以 workspace 级 check + smoke 为准。

## 6. 命令备忘

```sh
# 构建 / 验证(canvas-studio)
corepack yarn workspace canvas-studio build
corepack yarn workspace canvas-studio typecheck
corepack yarn workspace canvas-studio check        # build + verify:loader + typecheck
corepack yarn workspace canvas-studio test:smoke   # 16 用例(asset-capture 13 + generate 3)

# 上游构建(首次或改上游后)
corepack yarn upstream:build

# web 冒烟(studio profile;桌面 profile 同理,注意别与运行中的桌面抢 3080)
cd deepseek-harness && node --import tsx/esm apps/cli/src/bin.ts --profile studio
# 浏览器开 http://127.0.0.1:3080

# 桌面启动
corepack yarn dev
# 桌面 dev 实例 webServer 端口动态;重启前清理 singleton 锁
rm -f ~/Library/Application\ Support/VideoBuddy/Singleton{Lock,Socket,Cookie}
rm -f ~/Library/Application\ Support/VideoBuddy/crash-evidence/active-run.json

# 可视化验收(兼容模式 + 种子)
# 打开桌面窗口后地址栏加 ?cs-dev-seed=1 → 新建/打开项目 → 画布应显示示例图/视频/便签

# 桌面 profile 装/卸插件(P6 dev-install:构建 + link + bundles 维护一条龙,幂等)
corepack yarn workspace canvas-studio dev:install            # 装(默认 desktop profile)
corepack yarn workspace canvas-studio dev:install studio     # 指定 profile
corepack yarn workspace canvas-studio dev:install --remove   # 卸载
# 等价手动路径:改 profile 的 package.json(dsh.profile.bundles + link 依赖)后
# 在 profile 目录 corepack pnpm@11.7.0 install;不要用 dsh plugin(转发 pnpm v10 会撞 store v11)
```

## 7. Git 工作流

```sh
git remote -v
# origin   https://github.com/tablilixian/video_buddy.git   ← 唯一远程(既推又拉,无独立 fork/upstream)

# 分支模型:
#   main   集成/稳定分支(已完成阶段合并于此)
#   dev    日常开发分支(所有 canvas-studio 改动在此提交并推送)
git checkout dev
git pull --ff-only                        # 推送前先快进对齐 origin/dev
# ... 改代码 ...
git add canvas-studio docs                # 只 stage 插件包与计划文档
git commit -m "feat(canvas-studio): ..."
git push                                  # 推到 origin/dev(已跟踪)

# 把已验收的阶段并入 main(按你习惯,本地合并或走 PR):
git checkout main && git merge --no-ff dev && git push
```

### 子模块纪律(同 AGENTS.md)
- `deepseek-harness/` 是 pinned 子模块,**永不编辑其内部文件**;上游构建走根脚本 `corepack yarn upstream:build`。
- 更新子模块 pin 必须**单独提交**,不与桌面行为改动混在一起;提交前确保子模块工作树干净:
  ```sh
  git -C deepseek-harness checkout -- pnpm-lock.yaml   # 还原子模块内误改
  git status                                            # 确认 deepseek-harness 无 dirty
  ```
- 提交时排除 `.workbuddy/` 与 `reference/`(已入 `.gitignore`);只 `git add canvas-studio docs`(如需带根 workspace 改动再补 `package.json`/`yarn.lock`)。

### 同步上游 DeepSeek Harness(可选)
子模块本身的源头是 `https://github.com/deepseek-ai/deepseek-harness.git`;如需升级 pin:
```sh
git -C deepseek-harness fetch origin
git -C deepseek-harness checkout <新 tag/commit>   # 如 dsh-v0.1.x-rc.y
git add deepseek-harness                           # 单独提交 pin 变更
```
桌面侧 `@deepseek-ai/dsh-*` 依赖版本若需随之升级,见优化列表 O5(独立排期,先试 patch rebase)。

## 8. 纪律提醒

- 不编辑 `deepseek-harness/` 子模块;桌面产品文件(dsh-plugin-desktop 等)不动。
- client 组件纪律:props 四份额(PropsRuntime/PropsRenderSlots/PropsStore/inject),组件不见 ctx;store 用 `createXXXStore()` 工厂(defineStore);async 业务全在 apply/inject 回调,经 store actions 提交;产品文案中文、注释英文;样式注入 `<style data-plugin>`,不引入 CSS Modules/Tailwind;颜色一律 `--dsw-alias-*` 语义 token。
- Host 侧按上游惯例:name/inject/Config/apply,`ctx.get()` 读可选服务;webServer 路由注册返回 disposer,经 `ctx.effect()` 挂载。
- 许可证纪律:参考源码(CC BY-NC-SA)不进入仓库;只借鉴概念/结构/算法,每个借鉴点带来源标注。
- 完成当前阶段后:更新交接文档 + 计划文档对应章节,再提交一次(先还原子模块,只 stage canvas-studio 与 docs)。

## 9. 已提交记录

- P1 骨架:`4155603dd` + `30c935c3`(handoff 文档/fork 工作流)
- P2 项目注册表核心:`8786414361`
- P2 收尾 + 深色主题:`a0e74865ed`
- P3(工具 + 产物托管):`16d7666130` + 闪退修复 `c3411814cb`
- P4/P4+/§18/§19(捕获上画布 + 持久化 + 会话级归属 + 相对 URL):合并提交(见计划 §16–§19)
- 修复:render 结果值、共享 store 实例:`b700b80de2` / `6ce1e0a8bb`
- 参考画布 S1–S7 集成:`9a314b6e88`;布局微调:`e38e329cbb` / `1a81a9ebd4`
- **2026-08-21(9 工具扩展 + 画布体验修复):本轮提交(见 git log;含 tools 文档、v3 视图持久化、视频播放修复、整理布局重写、跳动/悬停 bug 修复)**
- **2026-08-25(二期推进):P7 门控与点选澄清 `1dad2b7c6a`;接口收敛(fl2va/ref2va)`e35bc715e7`;P8.1–P8.3 素材入口 `36d094cc31`/`7004ac0986`/`ef1258a3a8`;P9 参考闭环(@ref + list_references)`2cde9e8474`;P8.4 参考视频抽帧提风格 `a1a1abaa91`;验收修复四连(黑块残留/重试反馈/删除复活/对话区加宽)`9d3f48f010`;会话恢复(打开项目回到最近非空会话)`aa88c02b5c`。细节见 phase2 §11–§12。**
  - **2026-08-25(二期收口):文档验收收口 + 排期决策与 P9 实施步骤定稿 `f70f66bbe8`;health 前置探针 + P9.1 时间轴排序持久化 `4be84e64b4`;启动会话对齐(打开客户端自动恢复最近非空会话,无需手动点项目)`95ecd74dc8`;P9.2 合成路由(`src/ffmpeg-run.ts` 抽公共 + `src/compose.ts` + `POST /canvas-studio/compose` + 单测 72/72)代码完成待桌面核验。细节见 phase2 §11.3/§11.4/§11.8。**

## 10. 下一步

1. **桌面可视化验收(待核验)**:重启 `corepack yarn dev`(兼容模式)→ 对照 phase2 §11.8 验收清单逐项核验:视频节点可播放、视图持久化、整理布局、时间线不拉走视口、悬停不跟随、验收四连(黑块/重试/删除复活/对话 480px)、点击项目与启动后均恢复历史对话、时间轴拖拽重排持久化、Drama 宕机秒级中文报错。真实生成验收需 drama-api 可达 + 桌面启动设 `NO_PROXY=localhost,127.0.0.1`。
2. **P9.2 合成路由(已完成,待桌面核验)**:见 phase2 §5.1 步骤② —— 已抽取 `src/ffmpeg-run.ts`(`resolveFfmpegPath`/`runFfmpeg`/`parseFfmpegStreams`/`parseFfmpegDuration`,video-style 改为 re-export);新增 `src/compose.ts`(收集分镜视频 clip → 逐段统一转码 1280x720@25 → 时间线 `concat` → 可选 BGM `amix` → 落 `assets 根/export-<uuid>.mp4`);`routes.ts` 注册 `POST /canvas-studio/compose`,返回 `{ url, duration }`;测试 72/72 绿(含 compose 9 用例 + 真实 ffmpeg testsrc 双段冒烟)。**P9.3 导出 UI 已完成并闭环**:`api.ts composeStudioVideo` + `project-store addComposedVideo` + `CanvasTimeline`「合成导出成片」按钮(≥2 视频片段可点,进行中禁用)→ 回写画布 video-composite 节点。至此导出闭环打通,下一步为桌面核验。
3. **P9.3 导出 UI**:`StudioFrame` 顶部「导出成片」按钮 → 调 `/compose` → 进度 Modal → 完成后本地预览/打开文件/复制路径。
4. **会话去重(技术债)**:项目注册表持久化 `sessionId`,打开项目优先复用,遏制 workspace 会话堆积(与当前「恢复最近非空会话」互补)。
5. **P11 裁剪执行**:交付前裁掉未接端点(`txt2imageanime`/`inpaint`/`videoMkrGrid` 等)、未启用 UI 与 dead code;最终 `check` 全绿。
6. **优化池**:实时进度条(现仅首帧占位 + 完整结算)、`Error: [object Object]` 工具错误渲染、store 单测补强(undo/redo/吸附)、多参考图扩展。