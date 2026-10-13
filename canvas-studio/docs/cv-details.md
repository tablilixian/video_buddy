# Canvas Studio — CV 条目详情（§4 详情层）

> **本文件是什么**：`STATUS.md` §4.1 索引表的**详情层** —— 每条一个 `#### CV-xxx` 小节，
> 承载技术细节（详情 / 涉及文件 / 落地·验收）。
>
> **权威划分**：**状态以 [`STATUS.md`](./STATUS.md) §4.1 索引表为准**（唯一加/改入口）；
> 本文件只放细节，**不重复维护状态** —— 改状态请改 STATUS.md §4.1 那一行。
>
> **查法**：按号 grep，勿整读（本文件不在常读路径，整读只会白烧 token）：
> `grep -n "#### CV-311" docs/cv-details.md` / `grep -n -A6 "#### CV-311" ...`。
>
> **来源**：2026-10-13 由 `STATUS.md` §4 的「一句话 / 涉及文件 / 落地·验收」三格**原样搬出**，
> 零改写（迁移脚本带 CV 号守恒 + 内容子串守恒断言）。新增条目请同时补 §4.1 索引行 + 本文件小节。

---
#### CV-311 · §02「点开看原图」跳出系统浏览器（会报错/无反应）→ 改 app 内缩放浮层（推翻 CV-307 拍板）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：用户实测点开样张**跳出系统浏览器且报错**：资产路由的 loopback authority 拒绝对外部浏览器导航（同 CV-246a 真机结论），`data:` 种子图更被 Electron `setWindowOpenHandler` → `shell.openExternal` 静默 deny、点了毫无反应。**CV-307 当初拍的「`<a target="_blank">` 新窗口打开」被真机证伪**，但零 JS 契约不动摇 ⇒ **交互外移父层**：故事板文档只留 `a.zoom` 钩子（`target="_blank"` **降级保留**，同源 iframe 不被拦截时仍能开系统窗口），`StudioFrame` 在同源 iframe 的 `contentDocument` 上挂**捕获阶段** click 拦截（`preventDefault` 拦下新窗口 + `stopPropagation`），改开新增 `src/client/canvas/ImageZoomModal.tsx`：**滚轮以光标为锚缩放**（non-passive 原生监听，画布反缩放教训同款）、pointer capture 拖拽平移、双击适配↔100%、`−` `%` `+` 适配/100% 工具条、键盘 `+`/`-`/`0`、Escape·遮罩·✕ 三出口关闭、加载前 contain 适配防闪帧、取不到图显式错误态；浮层渲染在覆盖层（dialog）内部 —— 覆盖层「展开」态 z-index 200 高于通用遮罩 70，放外面会被压住。监听幂等重挂（`attachSbZoomCapture`，依赖 storyboardRev/sbVersion/sbCompareFrom 变更）、覆盖层隐藏时摘监听并关浮层；§01 来源链接（外部 URL）不拦。**守卫**：新 `tests/storyboard-zoom-wiring.test.mjs` 4 条源码接线（钩子在位 / ref+capture+onLoad 重挂 / `preventDefault`+`setSbZoomUrl(anchor.href)` / 浮层渲染+wheel non-passive+Escape+双击+pointer capture）+ `storyboard-render` 文案断言（「点开看原图（应用内打开，可缩放）」、保留 `target="_blank"`、不得再出现「新窗口打开」）。**验证**：typecheck / tsdown / tsc×2 / verify:loader / 全量 `test:smoke` **1590·1590、失败 0、基线 0**。**⚠️ 真机首验失败 → 跨 realm 修正（2026-10-13 同日）**：点图**仍跳出系统浏览器** —— 拦截 handler 第一行 `target instanceof Element` 比对的是**父窗口**构造器，而点击目标属于 **iframe 自己的 realm**（每个 frame 独立原型链、构造器不共享）⇒ 恒 false ⇒ 判定提前 return、`preventDefault` 永远走不到；源码字符串守卫照不出它（closest/preventDefault 字面量都在）。修正：命中判定抽成唯一实现 `src/storyboard-zoom.ts` `storyboardZoomHref(event)` —— **鸭子类型**（`typeof target.closest === 'function'` + `call(el, 'a.zoom')` + 非空 href 才 `preventDefault`），跨 realm 的元素方法调用不经过构造器比对；StudioFrame handler 只剩委托。守卫补**行为级** ③b/③c（喂一个与任何 DOM 构造器不沾边的 target，命中必须返回 href 且拦默认；未命中不拦）+ 源码禁令 `instanceof Element|HTMLAnchorElement`；**反向变异**（把 instanceof 加回去）3 条真红后还原。**二轮反馈「框太小」→ 尺寸撑大（同日三修）**：卡片原先复用 `.csVideoModalCard` 的 `width:auto` —— backdrop 是 `place-items:center` 的 grid，auto 宽 = fit-content，而图加载后 stage 内容**全是绝对定位、无流内内容** ⇒ 卡片塌缩成「标题栏文字宽」（真机 ≈170px）的窄条；改专用 `.csImageZoomCard`（`min(1360px, calc(100vw − 48px))` 显式近全屏）+ stage 定高 `72vh → min(82vh, calc(100vh − 160px))`，wiring ④ 补三条断言钉住（必须用 csImageZoomCard / 卡显式大宽 / stage 定高）；复验全量 **1592·1592、失败 0、基线 0**
- **涉及文件**：`src/client/canvas/ImageZoomModal.tsx`(新) / `src/client/StudioFrame.tsx` / `src/client/styles.ts` / `src/storyboard-render.ts` / `tests/{storyboard-zoom-wiring,storyboard-render}.test.mjs`
- **落地/验收**：2026-10-13 落地，待桌面验收（点样张 → 浮层可缩放平移 → 三种方式关闭，全程不离开 app）

#### CV-294 · 首页对话式创建认领时 .draft- 目录就地改名为项目名 + 宿主 workspace/会话重建（方案 A）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（用户反馈「打开都是 . 开头的隐藏文件夹，能不能创建后文件夹名字跟 App 内看到的名字相同」；即 REQ-005 登记的遗留体验项「认领不改名」，见 [tracking-closed.md](./tracking-closed.md) REQ-005）。原设计不改名是为保宿主 workspace/会话绑定（CV-260 事故面：目录改名后 registry 会把 cwd 不 resolve 的会话踢出 membership），本条按方案 A 正向收口。① **Host 认领即改名**：`createClaimingDir` 校验通过后先算目标路径（新纯函数 `claimedDirTarget(name, projects)`：`sanitizeProjectDirName` + 占用集 = registry 已登记 dirs ∪ `projects/` 全部现存目录，**均 toLowerCase 比对**〔APFS 大小写不敏感，rename 打到已存在目录会吞掉对方〕，重名走 `-2…-999` 循环、再撞走 UUID 兜底），`rename(resolved, target)` 就地改名，`project.dir` 以改名后路径登记；**占用扫描/改名任一失败 → 回退原 draft 路径登记**（认领不因改名失败而失败，产物仍是 `.draft-` 前缀目录），**登记失败（同名双查 / `commitRegistry` 抛错）→ `rollbackRename` 回滚改名**。存量已认领 `.draft-*` 项目不迁移。② **Client 改名后重建会话绑定**：`claimAndSend` 发现 `project.dir !== dir` 时**先 `select(project.id)`**（清 homePinned + 落 selectedProjectId，**两道闸都关**，否则重建触发的 workspaces/sessions 订阅里 `maybeDraftLanding` 会把首页落点又建回去），再按新 cwd 重建：`workspaces.create({ path: project.dir })` → `sessionSvc.clear()` → `connectWorkspace(workspaceId)` → `sessionSvc.open(newId)` → 尽力 `rename(workspaceId, project.name)` 对齐标题 → 摘除旧 draft 落点 workspace（归档其 blank 会话后 delete）→ `sessionSvc.binding(newId).session` 替换 `args[0]` 首句改发到新会话；重建失败 `failWith(cause, '项目已创建，但会话绑定失败')` 可见报错（重发首句会撞「项目名已存在」，不产生重复项目）。测试：`lobby-claim.test.mjs` 新增 CV-294 源码断言（`select` 先于重建 / `create({ path: project.dir })` / `connectWorkspace` / `open` / `args` 换绑 / 旧 workspace 摘除 / `failWith` 文案）+ 原「认领不得 mint 新目录」过时断言改写；`projects-dir.test.mjs` 新增 3 例（正常改名 `.draft-…`→项目名 / 占用撞名落 `-2` 且既有目录原样保留 / 改名失败回退原路径且清扫不误删）。验证：typecheck / build / verify:loader / `test:smoke` **1429·1429 全绿、基线 0**。
- **涉及文件**：`src/projects.ts`（createClaimingDir / claimedDirTarget / rollbackRename）、`src/client/index.ts`（claimAndSend 重建段）、`src/storage-info.ts` / `src/routes.ts` / `src/client/SettingsModal.tsx`（注释与文案跟改）、`tests/lobby-claim.test.mjs`、`tests/projects-dir.test.mjs`

#### CV-292 · 启动清扫早于「资产库位置」hydration，自定义根用户从未被清扫 → 首页落点补扫

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（CV-291 验收反馈：用户 Finder 实测旧 `.draft-` 空目录一个没少，质疑「没找到真实保存地址」——诊断结论：**地址解析全对，坏在触发时机**）。根因链：`registerStudioRoutes` 的 fire-and-forget 清扫在插件 attach 早期执行，此时 `source()` 仍是 composition base（[index.ts:77](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/index.ts#L77) `assetDir: ''`），`assetsRoot()` 落到默认根 `dshHomePath('canvas-studio')`（`~/.dsh/canvas-studio`，不存在 → `readdir` 静默 0）；`installSettingsSection`（[index.ts:140](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/index.ts#L140)）hydration 之后的落点/认领全走真实根 `newOut1`，清扫却再无第二次机会 —— 即**该 bug 自 REQ-005 起对自定义资产库位置的用户一直存在**（测试直接用正确根调 sweep，测不出来）。修复：`ProjectRegistry.sweepOnceForCurrentRoot()`（按 root 键控、每进程每根至多一次、同根并发共享 promise、被拒 promise 摘出 map 可重试）；两个触发点互补——`registerStudioRoutes` 保留（默认根用户仍即时生效）+ **`ensureDraftDir` 入口 await 补扫**（客户端加载后配置必然生效，这才是自定义根用户真正被清扫的时机，落点等清扫完成再走以保证测试可判定）；`routes.ts` 同步改走 `sweepOnceForCurrentRoot`（同根不重复扫）。诊断副产物：直接对真实根复现清扫一次删掉 13 个存量空目录。测试：`projects-dir.test.mjs` 新增 1 例（第一次落点清过期垃圾 + 同根第二次不再清）、CV-291 三闸用例的过期项改为「落点补扫中被清掉」的强断言；4 个路由 stub 假 registry 补 `sweepOnceForCurrentRoot` 面。验证：typecheck / build / verify:loader / `test:smoke` **1424·1424 全绿、基线 0**。
- **涉及文件**：`src/projects.ts`（sweptRoots / sweepOnceForCurrentRoot / ensureDraftDir 入口）、`src/routes.ts`、`tests/projects-dir.test.mjs`、`tests/{library-route,storage-info-route,resolve-refs-route,retired-assets-cleanup}.test.mjs`

#### CV-291 · 首页 draft 落点复用优先 + 启动清扫窗口 7→1 天

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（用户反馈「每次打开首页都会创建一个空的项目」，图证 = `projects/` 下堆积多个 `.draft-<yyyyMM>-<ddHHmmss>` 空目录）。① **复用优先**：`ensureDraftDir` 铸新名前先扫 `projects/`，采纳「`.draft-` 前缀 + 未认领 + 全空 + 龄 < 清扫窗口」的最新遗留落点（新纯函数 `findReusableDraftDir` 四闸，多候选取 mtime 最新），采纳不到才按秒铸新名 —— 每次启动落点先复用上次遗留，稳态全程只堆 1 个空目录；空+未认领 = 从未发过话 ⇒ 绑的必然是 blank/死会话，`workspace.create` 按路径幂等复用，不带旧对话。② **清扫窗口 `DRAFT_SWEEP_GRACE_MS` 7 天 → 1 天**（用户拍板「启动时把一天前的空目录清掉」；REQ-021 R001 当时「一周之内」口径收紧）；CV-260 的 `activeDraft` 实例豁免与 claimed/非空两闸不动。前提：单实例运行（用户确认每次只能启动一个 app，不存在多窗口抢落点/他窗落点被扫的竞态）。测试：`projects-dir.test.mjs` 新增 2 例（复用采纳跨启动不增目录 / 非空·已认领·过期三闸不采纳）+ 窗口用例 8 天·6 天 → 2 天·20 小时；`lobby-claim.test.mjs` 源码断言同步（窗口=1 天正向钉死）。
- **涉及文件**：`src/projects.ts`（ensureDraftDir / findReusableDraftDir / DRAFT_SWEEP_GRACE_MS）、`tests/projects-dir.test.mjs`、`tests/lobby-claim.test.mjs`

#### CV-275 · skill 入库：action-scene-director（动作场面导演）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（2026-09-21 入库 `fc31d5d546`，此前零登记，2026-10-01 对账补登）。catalog 22 技能之一，注册即生效（`skills/` 目录扫描）；功能点展开见 [skill-features-inventory.md](./skill-features-inventory.md) 勘误横幅
- **涉及文件**：`skills/action-scene-director/` / `src/skill-catalog.ts`

#### CV-274 · skill 入库：cinematic-moves（运镜词汇库）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（2026-09-21 入库 `0444b702fc`，此前零登记，2026-10-01 对账补登）。catalog 22 技能之一；含 cinematic-vocabulary / formula-composition / quality-keywords 三分册
- **涉及文件**：`skills/cinematic-moves/` / `src/skill-catalog.ts`

#### CV-273 · 参考位 UI 三段式

- **状态**：已拍板（2026-10-07）· 待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（REQ-003 收尾段）：CV-270/271 批顺延的占位立项——withtxt / tts 转真后参考槽位 UI 的三段式改造，方案未写；写号前先按 §0 规则复核（2026-10-01 补占位行）。**2026-10-07 拍板：并入 REQ-029/031 参考托盘一并设计落地**（同一块表面，随 REQ-029 验收收口；方案 `plans/REQ-029-画布image节点交互方案.md`）
- **涉及文件**：—

#### CV-278 · 带字图路由纪律知识层对齐：Qwen 一步直出为首选，自动 image_fix 降级为兜底

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（执行层 R-P1-03 已机制化，本批收口知识层漂移）。**取证**：用户反馈「带字图已能直接出，agent 仍先出一版再改一版」——执行层（`23922c1f50`，2026-10-04）已现算路由（`src/model-route.ts`：纯文生含可显示引号文字 → `txt2imageWithtxt`）并在 `host-tools.ts` 命中 Qwen 时豁免 CV-212 自动修复；但知识层三处仍按 CV-212/218 时代口径教「出图后自动挂一次 image_fix」（`prompt-writing.md` §CV-212 标题「必须遵守」、`krea2-turbo-writing` / `krea2-edit-writing` 文字节；grep `withtxt\|Qwen` 零命中）——agent 点名加载技能后按旧口径走，即用户看到的「先出一版再改一版」。另有两条**设计内**两段式应写明而非消灭：图生图带字（withtxt 无参考槽位）与装旧构建的会话。**改动（纯知识层 + 1 闸）**：① `prompt-writing.md` §CV-212 重写为「Qwen 一步直出首选（`image_generate` / `image_generate_withtxt` 等价，产物逐字正确、**不会也不触发 image_fix**，别手动补修复）→ 自动修复仅两条兜底链路（**图生图带字 = 设计内行为**，勿当故障）→ CV-211/212/218 历史沿革降级保留 → 手动修复纪律不变」；② krea2-turbo / krea2-edit 文字节同步同口径 + 顺带清 krea2-turbo 重复「自检清单」标题；③ `tests/skill-discipline.test.mjs` +1 源码闸（正向：三处必须含 withtxt 口径 / 直出不触发修复 / 图生图两段式属设计内；反向：旧无条件触发句式不得回潮；CV-218 `buildTextFixPrompt` 教训必须保留）。**验证**：typecheck ✓ / build ✓ / verify:loader ✓ / `test:smoke` 门禁 0 失败（本闸 9/9 过）
- **涉及文件**：`skills/canvas-studio-creation/references/prompt-writing.md` / `skills/krea2-turbo-writing/SKILL.md` / `skills/krea2-edit-writing/SKILL.md` / `tests/skill-discipline.test.mjs`

#### CV-277 · 废弃视频事件修复批（揽月湾真机取证，Bug 表 BUG-011013）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P0
- **详情**：。① **CV-277-a（P0，消掉三宗问题）**：镜位级取代判据由「血缘有任一张分镜卡相同即取代」改为「**旧节点锚点集 ⊆ 新节点锚点集**」，且两侧锚点**同口径**（新增 `shotAnchorCardsOf`：`shotRefs` 显式声明优先，血缘继承仅在恰好一张时回退，多张/空一律拒绝自动取代）——原判据在「逐镜多参考图」（`shot-format.md` 第 9 步要求 ≥3 张、补位引用别镜关键帧 + CV-031 继承）下退化为**全局串链**：实测 3 镜 6 条视频串成 v1→v6、5 条误标废弃（**其中 2 条实际已在成片里**）、`defaultComposeClips` 只剩 1 段 ⇒ UI 导出得 5.17s 单镜残片、白烧 3 条视频（8.5 min GPU + 4.25 MB）；原守卫测试用「每镜各挂一卡」的干净形态故测不到。② **CV-277-b**：`compose_video` 在「非显式 clipIds + 只收 1 段 + 画布逐镜 >1」时追加 warning 明说失效版本并给两条出口（**不改判定**，`isShotClip` 唯一口径不破）。③ **CV-277-c**（用户拍板取方案 2）：新增 `POST /canvas-studio/asset-history/prune-retired` + 历史抽屉「清理失效产物（N）」——只收失效**图/视频**，成片/音频/文本/`isLoading` 跳过（后者进 `busyNodes` 回报），N 文件**合并成一次 writeCanvas**，GC 保护语义不变（CV-246 的「未删条目 = 保护名单」是刻意设计，本批只补「不想要了」的出口）。④ **CV-277-d**：`list_references` 的参考图与资产卡锚点每项补**节点 id**、描述写明「优先 `@ref[<节点 id>]`」（标题取自提示词前 12 字，`@ref[标题]` 走精确匹配易失配 ⇒ 现场 agent 绕道 `upload_image` 多跑一趟）。**验证**：两套 typecheck + 三段构建全绿；`test:smoke` **1280/1280、失败 0、基线名单外新增 0**（1272 → 1280）；**现场数据回放**（用 `canvas.json` 真实血缘重放 6 次提交）→ 3 条互不取代、同镜重跑正确取代、`defaultComposeClips` 选 3 段 15.00s（旧判据 1 段 5.17s）。取证与诊断见根仓 `docs/effect-tests/lanyue-bay-retro-20261005.md`，逐项清单见 `fix-list-20261005.md`
- **涉及文件**：—

#### CV-276 · 结构评审 P0 落地：门禁接入 + 基线红名单机读 + Agent 入口

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（[ai-assisted-dev-structure-review.md](./ai-assisted-dev-structure-review.md) §P0 三件，2026-10-01 开工）。① **P0-2**：新增 `scripts/run-smoke.mjs` 门禁包装——TAP 原样透传后断言「失败集合 ⊆ `tests/baseline-red.json`」，名单外新增红即退出码 1（反向变异验证：摘一条名单 → exit 1 ✓，还原 → exit 0 ✓）；名单已清零（2026-10-01 P1 后续：studio-defaults 四条断言更新到双分辨率 API、minimax-skill 渐进披露支持跨 skill 引用）；`test:smoke` 切换为包装器，原始跑法保留为 `test:smoke:raw`。② **P0-1**：本包 `check` 扩为 `typecheck && build && verify:loader && test:smoke`；根 `typecheck` / `test` / `check` 各追加 `yarn workspace canvas-studio …`（CI `yarn check` 自动传导）。③ **P0-3**：新增本包 `AGENTS.md`（验证链 / 编码约束 / 收尾四步 / 编号规则 / 基线红说明），根 `AGENTS.md` 加 canvas-studio 条目。**突破点**：门禁开通前先让红变得机器可判定（名单与实测失败集合一致才可能全绿）
- **涉及文件**：`scripts/run-smoke.mjs`（新）/ `tests/baseline-red.json`（新）/ `package.json`（根 + 本包）/ `AGENTS.md`（根 + 本包）

#### CV-247 · BUG-010 收口：上传回执卡从视频泛化到音频与文字（首屏 / 首条消息前拖文件不再「没反应」）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**根因**：`StudioFrame.canvasBody` 三态里 lobby（无项目）与 lobby-pending（有项目、首条消息未发）**都不渲染画布** ⇒ 音频与文字的唯一回执（画布节点 `addAudioNode` / `addTextAssetNode`）无人渲染，对话区又零反馈（成功无 toast、只有失败才报）⇒ 用户把音频拖进「第一个对话页面」看不出任何变化（BUG-010 现场）；对照组为什么能看见：**图片**不被 capture 拦（判据「非 image 才接管」）⇒ 落宿主 `ComposerAttachments` 输入框附件缩略图，**视频**走 `VideoUploadBar`（CV-232 已补同型回执，其文件头注释本就写明「画布节点在 lobby / 首屏态下根本看不见」）。**三层落地**：① **store**：`VideoUploadItem` / `videoUploads` → `MediaUploadItem(+kind: video\|audio\|text)` / `mediaUploads`，四条 action 改名 `begin/settle/fail/dismissMediaUpload`；② **StudioFrame**：`handleUploadAudio` / `handleUploadText` 补齐三段回执（begin→上传→settle、catch→fail），id 生成收口为单一 `newUploadId()`；audio/text **不造 objectURL**（不画预览就不该造没人回收的 blob）；`handleUploadVideo` 改接新 action 并写 `kind:'video'`；③ **组件**：`VideoUploadBar.tsx` → `MediaUploadBar.tsx`（槽 id `canvas-studio-video-upload` → `canvas-studio-media-upload`，挂点仍 `conversation.input.dock`），图位按 kind 分档 —— video 用 `<video preload="metadata">` 画首帧，audio/text 用**扩展名徽标** `.csUploadChipExt`（`MP3`/`TXT`，不伪造缩略图）。**图片刻意不进卡**（宿主附件缩略图即其回执，第二套回执必然与附件 chip 打架）—— 反向断言钉住。**测试**：`tests/video-upload-wiring.test.mjs` 改名 `tests/media-upload-wiring.test.mjs`（7→**9 例**）：三类 handler 各自带 `begin/settle/fail` 且 `kind` 归属正确、audio/text 不造 objectURL、图片 handler 不得进回执卡、槽 id / 单一数据源 / 不抽帧原样保留。**验证**：`corepack yarn check` ✓（build + verify:loader + typecheck）；`test:smoke` **1040 条 1035 过**（5 条基线红同名：渐进披露×1 + studio-defaults×4）。**遗留（未拍板，属 BUG-010 次因）**：无项目（lobby）时 capture 前置 `projectId===null` 未注册 ⇒ 音频落宿主撞「仅支持 PNG、JPG、WebP、GIF」提示、落画布区则 `handleUploadAudio` 静默 return（无 toast）—— 本批未动
- **涉及文件**：`src/client/project-store.ts`(MediaUploadItem/mediaUploads/四 action) / `src/client/StudioFrame.tsx`(三类三段回执 + `newUploadId`) / `src/client/VideoUploadBar.tsx`→`MediaUploadBar.tsx` / `src/client/contracts.ts` / `src/client/index.ts`(槽 id) / `src/client/styles.ts`(`csUploadChipExt`) / `tests/media-upload-wiring.test.mjs`(改名 + 2 例) / `docs/tracking.md`(BUG-010) / `docs/acceptance-test-cases.md`(V 组)

#### CV-245 · BUG-002 收口：agent 侧的音频裁切入口 cut_audio（Host 本地 ffmpeg）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**根因**：ffmpeg 早已随包（CV-201），但 agent **没有任何音频加工入口** —— `music_generation` 只能整段生成、`compose_video.bgmNodeId` 只能整段混入，`skills/` 与工具描述对「裁切」零命中 ⇒ 用户说「裁成 12–20 秒」时只能去告诉模型 ffmpeg 路径（BUG-002 现场）。**三层落地**：① 新能力模块 `src/audio-cut.ts` `cutAudioSegment`（**重编码 `libmp3lame`** 输出 mp3 而非 `-c copy` —— 切点精确、输出形态恒定；`-ss` 放 `-i` 前 + `-t` 时长语义；越界语义：**起点越界报错并给可用区间**、**终点超长自动截到末尾 + warnings**（不打断能自愈的输入）；ffmpeg 失败/空输出 `rm` 半成品）；② 新 Host 工具 `cut_audio(audio, start, end)` 插在 `music_generation` 后 —— `resolveCutAudioSource` 认三种形态（节点 id / `@ref[标题]` / 纯文件名，**不走 `resolveRefValue`** 故零网络往返），视频节点合法（抽音轨 `-vn`），产物落**新音频节点**（`toolName/origin:'agent'/sourceIds` 血缘、`deriveNodePlacement` 260×132、`duration` 落盘实测、标题 `源标题 · 裁剪 12–20s`、**不设 `operationType`** 避免动 workflow-stage 全键体检），**不接审批门**（纯本地、不调后端，`approval-gate` 三份名单均不含）；③ 指引层互提：`toolchain.md` 工具表 + 「不受约束」清单（2→3）、`music_generation` 描述指名「只要一段 → cut_audio」、`audioRefs`（合计 ≤15s）与 `compose_video.bgmNodeId` 提示、`docs/canvas-studio-tools.md` §B3 详节（工具总数 25→26 / 真实 23→24）。**登记同步**：`param-guard`（`audio`→handle、`start`/`end`→豁免）+ `asset-capture`（`cut_audio: 'audio'`，漏登记 = 裁完画布不刷新，同 CV-130）。**测试**：新 `tests/audio-cut.test.mjs` **11 例**（假 ffmpeg sh 替身记真实 argv 断言 `-ss/-i/-t/-vn/-map 0:a:0/-c:a libmp3lame` 与「输出是最后参数」、截尾 warnings 同步收窄 `-t`、越界/非法区间/穿越/非媒体/不存在五类拒收、失败不留半成品、工具层落卡+血缘+render、`approval-gate` 源码不得出现 `cut_audio`）。**验证**：`yarn check`（build + verify:loader + typecheck）✓；`test:smoke` **1035 条 1030 过**（5 条基线红同名：渐进披露×1 + studio-defaults×4）。**验收**：`docs/acceptance-test-cases.md` **K-8/K-9/K-10**（不告知任何路径 agent 自主完成裁切）
- **涉及文件**：`src/audio-cut.ts`(新) / `src/host-tools.ts`(`cut_audio` 工具 + `music_generation`·`audioRefs` 描述互提) / `src/param-guard.ts` / `src/asset-capture.ts` / `skills/canvas-studio-creation/references/toolchain.md` / `docs/canvas-studio-tools.md` / `docs/tracking.md`(BUG-002) / `docs/acceptance-test-cases.md`(K-8~K-10) / `tests/audio-cut.test.mjs`(新)

#### CV-240 · 质检退出生成过程 + 视频批量编排写入 skill + SKILL.md 上限 15KB→20KB

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。用户三条拍板：① 质检全程不参与（不调 qc_shot / 不爆红 / 不返工），仅**项目完成时**逐镜出结果汇总《质检报告》随交付输出、仅供参考；② SKILL.md 上限放开到 20K 补缺失纪律；③ 质检不参与决策。**改动（纯 skill 层，实现零改动——CV-214 已不自动重跑）**：① 总纲 SKILL.md：删 6a「逐镜质检 QC gate」（6a 改为关键帧确认门，属审批非质检）；新增**第 11 步「质检报告（仅此一处）」**（成片交付后逐镜 qc_shot → 汇总报告，FAIL 不重出、不制造返工痕迹）；底线④「质检不参与过程」；步骤 9 补**批量提交**（视频异步：非 chain 镜一个回合全部发出、chain 镜按链序）与**句柄纪律**（只认 @ref / upload_image 句柄，节点 id / url 抠名 → CS-USER-002）。② toolchain.md：「同步单任务」节拆两档（图片/音频/分析类逐个；**视频批量**+不重复提交），qc_shot 行改「仅成片交付后的质检报告」。③ consistency.md：「质检闭环」→「质检报告（仅项目完成时）」；CV-210 全景表三行过程质检条目收敛为一行。④ qc_shot 工具描述：过程中调用属流程违规，FAIL/WARN 不触发返工。⑤ skill-catalog 测试闸 15KB→20KB。**SKILL.md 15342→16112B（20K 闸内）**。全量 **984 条 979 过**（5 条基线红同名）。背景：批量编排行为已在「测试多任务2」会话自然出现（3 调用并行 + 7 调用批量规划），本次条文固定为流程；QC 与批量的一致性矛盾（逐镜质检串行化）随质检退出过程而消解
- **涉及文件**：`skills/canvas-studio-creation/SKILL.md` / `skills/canvas-studio-creation/references/toolchain.md` / `skills/canvas-studio-creation/references/consistency.md` / `src/host-tools.ts`（qc_shot 描述）/ `tests/skill-catalog.test.mjs`（20KB 闸）

#### CV-239 · 取消不是故障：打断类调用的画布占位直接移除（ABORTED_BEFORE_DISPATCH / TOOL_ABORTED / 新码 CS-GEN-207 三形态）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**起因**（2026-09-24「测试多任务2」会话，[session 实证]）：CV-237/238 全面工作（模型全程 `@ref` 句柄、上轮 502 形态零复发、jobs.json 6 job = 5 settled + 1 cancelled），但用户一次打断在画布留下约 10 个红色「生成失败·点击重试」占位——7 个 `ABORTED_BEFORE_DISPATCH`（同批排队未派发）+ 1 个「生成已取消」（在跑的被取消）；且「生成已取消」被 generateAsset 的音频提示包装（「后端尚未开放音频…」），取消被当成后端故障误导。**修复**：① 新码 **`CS-GEN-207`「生成已取消」**（catalog，user/agent 受众）+ `error-system.ts` 新增 `makeCanvasError` 构造器（不抛出的按码构造）；三处 abort 归一：`executor.abortError` / `generate-queue.abortReason`（排队等待被取消）/ `dramaPost` 的 signal-aborted 透传。② `generateAsset` 视频 catch：`signal.aborted` 时**原样透传**，不套音频指导。③ [asset-capture.ts](../src/asset-capture.ts) 新增 `CANCELLED_ERROR_CODES` 集合 + `onToolCancelled` 可选钩子（error 分支在 codeIsUserFacing 判定**之前**拦截）；client 接线 `removePendingByRunId` **直接移除占位**（会话转录仍有一行「生成已取消」，叙事不丢；钩子缺省的消费方退化为 onToolError，防占位永远卡「生成中」）。**测试 +3 更新 1**：三形态取消走移除不标红 / 钩子缺省退化 / abort 透传不套音频指导（generateAudio=true 踩包装分支）；executor 取消断言改按 CS-GEN-207。全量 **984 条 978 过**（5 条同名基线红）。`video-chain.md` §8/§9 同步（缺口 #1/#2 关闭：取消路径已闭环，仅剩「进程硬死未重启」窗口）
- **涉及文件**：`src/errors/catalog.ts`（CS-GEN-207）/ `src/error-system.ts`（makeCanvasError）/ `src/providers/executor.ts` / `src/generate-queue.ts` / `src/generate.ts`（dramaPost 归一 + abort 透传）/ `src/asset-capture.ts` / `src/client/index.ts` / `tests/{asset-capture,generate,video-provider-registry}.test.mjs` / `docs/video-chain.md`

#### CV-238 · 视频链路两项修复（句柄形态前置校验 + 自愈判定结构化）+ 新增链路契约文档 docs/video-chain.md

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**起因**（2026-09-24「测试多任务」会话复盘）：模型把**画布节点 UUID 当 Drama filename** 传（21 次带参考图的调用全部失败），叠加 0.5.0 后端的**新错误形态**骗过了自愈判据。**因果链（全部实测取证）**：① `resolveRefValue` 对非 `@ref` 裸值**原样返回**不校验 → 节点 id 穿透到后端；② 后端 0.5.0 把「参考文件不存在」包成 **502 + body detail**（实测复现：`HTTP 502 {"detail":"请求失败: 400 Client Error: Bad Request for url: http://…:8188/prompt"}`，55ms 快失败——ComfyUI 拒绝引用不存在输入文件的工作流 → Drama 包装 502；旧后端是笼统 500）；③ `describeError` 用 body detail **替换**默认的「HTTP 502」文案 ⇒ 消息里既没有「HTTP 502」也没有「HTTP 400」（只有「400 Client Error」）⇒ `isBadReferenceError` 的消息正则**全失配** ⇒ **参考图自愈被跳过**（sourceUrls 本可按位重传救回）；④ 错误对模型**不可行动**（内部 IP 已脱敏，只剩「400 Client Error」）⇒ 盲试 15+ 轮（去音频 / 去 IR / 改图数，从不换句柄），每次失败因 dramaPost 对 502 的内部重试**打了后端两遍**；⑤ 模型最终**弃用全部一致性锚点改纯文生**才成功（2 条落画布）——质量静默降级；⑥ job3 提交后进程硬死卡 in_progress（恢复 watcher 只启动时扫一次——**缺口登记未修**，见 video-chain.md §9）。**修复① 句柄形态前置校验**：`generate.ts` 新增纯函数 `looksLikeCanvasNodeId`（basename 去扩展名为标准 UUID 即命中；ref-*/产物名/局部 hex 本地名不误伤），`resolveRefValue` 在 `tokens.length === 0` 分支拦截并抛新码 **`CS-USER-002`**——报错本身教模型「改用 @ref[显示名] 或 upload_image 句柄」，**零后端调用**。**修复② 自愈判定结构化**：`callDramaJson` 的 `CS-GEN-206` 增带 `params.httpStatus`（CanvasStudioError 本就保留 params），`isBadReferenceError` 改为「**结构化优先**：status ∈ {400, 404, ≥500}（**422 除外**——参数校验错误重传救不了）→ 自愈；无结构化状态码的错误（上传失败等）保留消息正则兜底」。误判代价仍是「多一次重传+一次重试」，方向安全。**测试 +3**：判据纯函数（裸 id / 带扩展名 / 相对与绝对 URL / 大写正例；ref-*、产物名、局部 hex 反例）、工具级拦截（video_generate filename=UUID → `CS-USER-002` 且**零后端调用**）、**502 新形态全链路自愈**（视频提交路径：502 → 自愈重传换句柄 → 202 → 轮询 → 落盘；桩按真实序列 502/502/202——dramaPost 的内部重试先打两遍才轮到自愈，这个行为本身已被测试钉住）。全量 **981 条 976 过**（5 条同名基线红）。**文档**：新增 **`docs/video-chain.md`**（编排→工具→请求→任务→结算全链路契约基线：capabilityOf 路由表 / 句柄三形态与解析契约 / 参数规格 / IR 预检 / 请求体映射 / 202+台账+30s 轮询状态机 / 异常处理矩阵 / 事故复盘 / 已知缺口）
- **涉及文件**：`src/generate.ts`（looksLikeCanvasNodeId + isBadReferenceError 结构化 + httpStatus）/ `src/host-tools.ts`（resolveRefValue 拦截）/ `src/errors/catalog.ts`（CS-USER-002）/ `tests/filename-consumability.test.mjs` / `tests/generate.test.mjs` / `docs/video-chain.md`（**新**）

#### CV-237 · Drama 后端 0.5.0 异步视频任务接入（提交 202 + job_id → 轮询 → 取结果；30s 独立轮询；jobs.json 台账断线续查；放开连续提交多镜头）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**探针先行**（`scripts/probe-video-jobs.mjs`，报告 [api-probe/video-jobs-20260924](./api-probe/video-jobs-20260924/report.md)）：提交 **48ms** 返回 `202 {job_id, status, status_url, cancel_url, result_url}`（job_id = ComfyUI prompt_id）；未完成取 result = `202 {"detail":"Job is not completed"}`、未知 job = `404`；状态机 `in_progress@0s → completed@+132s`（0.4MP/5s 文生，队列空）；result 结构与旧同步响应**同构**（`{prompt_id, filename, full_url, duration}`，duration=129.11 仍是服务端耗时）；cancel → `{cancelled:true}` 约 5s 内翻 `cancelled`。**① 适配器切异步**：`providers/drama.ts` 由「同步阻塞 submit（settled 直塞）」改为 submit → poll → cancel 三段式（与 fal 同构；executor 轮询 / 超时 / 取消逻辑零改动）；`dramaPostWithFallback` 契约改为返回**原始 JSON**（202 信封没有 full_url，产物解析移到 adapter 的 poll），参考图失效自愈（500 → 重传 → 重试）经参数化的 `withReferenceHeal` 壳照常生效（产物壳 callDrama / JSON 壳 callDramaJson 共用一份自愈，`callDrama` 拆出 `callDramaJson` 核心，图片/音乐路径行为不变）；提交超时独立短档 `DRAMA_TIMEOUT_MS.videoSubmit = 60s`（202 秒级返回，长超时只会在后端宕机时拖慢快失败）；`video` 档 20min → **40min** 且语义改为 **executor 轮询整体墙钟**（不再受 undici 300s 传输层上限约束，long-request 不变量测试豁免该档）；客户端占位截止 `PENDING_TIMEOUT_MS` 22min → **42min** 成对抬高（多镜头排队时最后一个任务要等完整条队列）。**新错误码**：`CS-PROV-015`（后台任务失败，带 execution_error 详情）/ `CS-PROV-016`（任务 404 消失——后端重启清队列，不当瞬时错误）；`CS-NET-010` 文案扩为「缺产物地址（或异步任务标识）」。**② 用户拍板三项（2026-09-24）**：轮询间隔 **30s**（`DRAMA_JOB_POLL_INTERVAL_MS`，经 `ctx.pollIntervalMs` 注入，每任务独立计时——executor 本就是每次 runVideo 独立循环）；**放开连续提交多镜头**（`DRAMA_VIDEO_ASYNC_HINT` 换上 video_generate / video_composite 描述，image_generate / upload_image / video2vl 仍贴串行提示；skill-guardrail 守卫改为两档双向断言「异步工具不得再引用串行提示」）；**瞬时错误容忍**（poll 遇网络异常 / 5xx / status=0 一律当「本轮未完成」，404 / failed / cancelled 才立即失败——用户 abort 不吞，signal 中止直接抛给 executor 统一 cancel）。**③ 任务落地续查（新增 `src/video-jobs.ts`）**：提交拿到 job_id **立即**写项目 `<项目目录>/jobs.json` 台账（`{version, jobs[]}`，记录含 jobId/projectId/toolName/**完整参数快照 JSON**/status/executionError/result，`writeFileAtomic` 原子写）；状态流转经 ProviderContext 的 `onSubmitted` / `onJobUpdate` 钩子回写（generate.ts 内一条 promise 链串行，保证「先落 job_id 再回写状态」不被异步乱序打断；写盘失败只吞不阻断生成）；**Host 装配时**（`createStudioTools`）调 `startDramaJobResumeWatcher` 扫描所有项目非终态任务，逐个起独立 30s 恢复循环——completed → 取 result → 走**共享结算**落盘；failed / cancelled / 404 落终态；恢复轮询最长跟踪 45min（覆盖 40min deadline）。**④ 共享结算**：generate.ts 的「资产落盘 + 画布节点写入」段抽出为 `persistGeneratedAsset`（资产命名 / ffmpeg 实测时长分辨率 / 血缘反查 / 分镜编组 / 版本取代 / retryOf 原地更新全部在内），正常生成与恢复结算（`settleDramaVideoJob`）共用同一份——恢复出来的节点与正常生成的节点字段口径不会分叉；settle 成功后台账置 `settled`（终态保护：终态不可被迟到状态打回）；本轮未结算（超时 / 打断）时按台账现状收尾——`completed` 保持（重启后再恢复结算）、其余落 `cancelled`。**⑤ 客户端感知**：队列快照并入 `resumedJobs`（`queue-view.ts` 可选字段 + 归一化缺省 0，旧 Host 响应不失效）；客户端 `pollGenerationQueue` 改「先取快照再判空闲」，`lastResumedJobs` 计数下降（一个恢复任务结算）即重载画布让产物现身（恢复路径没有 tool/result 事件，画布重载是唯一结算通知渠道），启动时先探一次快照、resumedJobs>0 则保持轮询。**⑥ executor 零改动**：超时 / 打断时自动调 `provider.cancel`——Drama 首次获得远端取消能力，不再留孤儿任务白占队列。**测试**：重写 `tests/video-provider-drama.test.mjs`（27 条：202 信封 / token 语义 / onSubmitted / kind=videoSubmit / poll 状态机全分支 / onJobUpdate 只在变化时回调 / 404·failed·cancelled / 瞬时容忍 / result 202 与 409 / cancel / 执行器集成含中止取消 / jobStatusOf·jobResultOf 纯函数），新增 `tests/video-jobs.test.mjs`（7 条：台账落地幂等 / 终态保护 / failed 带 error / 多项目扫描 / 恢复轮询 completed→settle·failed·404·瞬时容忍·cancelled·settle 重试）；generate / video-provider-select / workflow-gate / resolution-tier 打桩 fetch 按 URL 分流异步端点；long-request 不变量豁免 `video` 档（墙钟非 fetch 超时）。全量 **978 条 973 过**（5 条失败与 CV-223 时期同名基线红一致）。**文档**：`docs/api.md` 收录 0.5.0（**只收异步相关**——health/upload 等其他接口不变不重复收录）+ 新增「异步视频任务」节；`canvas-studio-tools.md` 待验收时同步
- **涉及文件**：`src/providers/drama.ts` / `src/providers/types.ts` / `src/video-jobs.ts`（**新**）/ `src/generate.ts` / `src/config.ts` / `src/errors/catalog.ts` / `src/routes.ts` / `src/queue-view.ts` / `src/client/index.ts` / `src/host-tools.ts` / `scripts/probe-video-jobs.mjs`（**新**）/ `docs/api-probe/video-jobs-20260924/`（**新**）/ `docs/api.md` / tests×8

#### CV-236 · H3 预检 R7「<Picture N> 编号不连续」从 ERROR 降为 WARN（只提示、不阻断生成）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：。**起因**（2026-09-24 用户报障 → 追问「这个工具作用是什么、能不能从应用层解决」→ 拍板）：同一条红字 `[R7] <Picture N> 编号不连续：1, 2, 4` **掐断了一次 4 张参考图的 `video_composite` 调用**（后端零调用、画布留红标）；用户拍板原话「**这个报错，降级成一个提示性的语句**」。**判据复核**：`<Picture N>` 的 N **就是 `filenames` 的位次**（第 N 张 = 第 N 个输入）⇒ **跳号指向的图仍然是对的、简报自洽**，属「有一张输入素材没被引用」的**记账不齐**而非路由错误；同一份代码对 `<Audio N>` 早已因官方 C4 样本只输出 `<Audio 2>` 而放宽成「只查上限」（见 R7/R8 注释），Picture/Video 不该更严；且技能分册 `format-ref2va.md` **本就允许**某张图不单独立条目（在 `<Subject N>` 里 inline 注明出处即可）⇒ **原拦截比我们教给模型的规则更严**。**改动四处**：① `h3-ir-validate.ts` 的 R7 连续性由 `err` 改 `warn`，提示**点名缺哪一号**并声明「**不影响本次生成**」；**「引用了不存在的素材」（越界）仍 ERROR** —— 那才是真矛盾。② **`assertH3IrPrompt` 返回值 `void` → `string[]`** —— 原本 WARN 只在「同时有 ERROR」时被拼进报错文本，**一次通过的调用里 WARN 整批丢弃** ⇒ 只把 `err` 换成 `warn` 就收工的后果是**静默**（比原来报错更糟）；故让它在通过时返回「要转达给用户/模型的 WARN 文案」。③ `host-tools.ts` 的 `video_generate` / `video_composite` 两处 execute 接住 `irNotes` 并**并进 `result.warnings`**（既有公共通道，客户端 toast 层已读）。④ **事前纪律**（用户要的「把前面的提示词和用法部分写好」）：`video_composite.filenames` 描述补「每一张参考图都应在简报里出现一次」、两个工具 description 补「素材标签编号不连续只出提示、不阻断生成」、`format-ref2va.md` 新增同段。**测试 +4**（`h3-ir-precheck.test.mjs`：官方 Ref2VA 样本前提断言 / 跳号不抛且带 `[R7]` 提示 + `不影响本次生成` / **反向对照**「引用不存在的素材仍拦截」/ **接线守卫**「`irNotes` 必须恰好被这两个工具接住」——返回值被丢掉时表现是静默）。两处自设陷阱已避开：跳号用**一次性正则替换**（逐个 `replaceAll` 会链式位移）、该用例**刻意放宽 `pictures` 上限**以隔离「连续性」这条。**⚠️ 本批未编译未验证**（当次会话 shell 通道失效：`sandbox-exec: pattern serialization length … exceeds maximum`），且 `assertH3IrPrompt` 属**破坏性签名变更**，需全仓确认无别的调用点
- **涉及文件**：`src/h3-ir-validate.ts` / `src/host-tools.ts` / `skills/h3-prompt-writing/references/format-ref2va.md` / `tests/h3-ir-precheck.test.mjs`

#### CV-235 · 工具入参「占位值」守卫：模型给引用类入参填占位串，一路走到 SSRF 校验 / 后端才失败，报出文不对题的错

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**① 症状**（2026-09-23 用户会话，12 条报错里 **7 条**源于此）：模型一次规划多个工具调用时，给「还没取到的」素材句柄先填一个占位串顶上，打算回头再补 —— 实测 `upload_image {"imageUrl":"placeholder2"}`（一直到 `placeholder5`）、`character_sheet {"filename":"placeholder-will-retry"}`、`video_composite {"prompt":"placeholder"}`。这些串**长得像合法取值**（像文件名、像地址），于是每一层校验都放它过去，直到某个与「这是个占位词」毫无关系的地方才失败：`upload_image` 报的是**「下载地址不安全或不在允许范围内」**（下载地址安全校验），而**真因是模型压根没去取真实值** ⇒ 用户看到文不对题的报错，模型得到**误导性纠正信号**（它会去改地址，而不是去取真实值），白烧一轮。**② 拦在唯一入口**：`wrapStudioToolDefinition`（`tool-error-boundary.ts`）是宿主**全部工具**（`createStudioTools` + `createPlaceholderTools`）的唯一包装点，守卫挂这里 ⇒ **一份实现**（在每条工具里各写一遍就是「同一规则两份实现」，`CS-UNC-000` 那次边界两侧结论相反正是这种分叉的代价）。拒收发生在 `execute` **之前** ⇒ **零副作用**：不解析项目、不落节点、不发起后端调用。**③ 三档口径（本批核心判断）**：`text-guard.ts` 原有**写入严**（`stubTextReason`，两把尺子含「过短」）/ **载入稳**（`isPlaceholderOnlyText`，只用第二把）两档；入参侧**不能复用任何一把**，因为**它判的是标识符不是散文** —— 「过短」那把在标识符上完全失效（合法值可以极短：画布节点 id `p1`、语言代码 `zh`），而「剥完只剩 ≤2 字符」也不够（短标签类合法值 `无` / `8 镜` 剥不掉任何占位词却天然只剩 1–2 个字符，会被整片误判）。故新增第三档 `placeholderParamReason`，比载入档**再收紧两处**：**① 必须真的剥掉过占位词**（`无` / `8 镜` / `p1` 剥不掉任何东西 ⇒ 放行）**② 剥完只允许剩纯数字（≤2 位）**（`placeholder2` 的编号后缀放行；`音乐.png` / `女主.png` 剥掉后缀还剩汉字 ⇒ 放行；`placeholder-will-retry` 剥完为空 ⇒ 命中）。取舍方向固定为 **宁漏判，不误判**（漏判 = 回到引入本守卫之前的旧行为；误判 = 拦住合法调用），已登记已知漏判 `占位图.png`（剥掉后缀只剩「图」不是纯数字 ⇒ 放行）并**专门写了一条用例把该取舍钉住**（放宽成「剥完只剩 1–2 任意字符」虽能捞到它，但会同时误伤合法中文文件名）。词表扩 27 个：填充词 `willretry` / `later` / `filllater` / `tobefilled` / `tobedone`（不收回它们，`placeholderwillretry` 就剥不干净）+ 假值 `dummy` / `sample` / `example` / `test` / `demo` / `fake` / `temp` + 常见后缀 `png` / `jpg` / `jpeg` / `webp` / `gif` / `mp4` / `mov` / `mp3` / `wav` / `m4a`。**⚠️ 同批自查又修出一处真漏判 —— 剥离必须「最长优先」**：`to-be-filled-later` 压成 `tobefilledlater` 后，按词表**声明顺序**逐词剥时 `fill`（4 字符，声明在 `tobefilled` 之前）先命中，把 `tobefilled` 咬成 `tobeed`，长词此后再也匹配不上 ⇒ 残余 `tobeed` 不是纯数字 ⇒ **漏判**（该串就在测试夹具里，会红）。改为 `PLACEHOLDER_TOKENS_BY_LENGTH`（按长度降序，maximal munch —— 词表里**既有整体又有其组成部分**时的通用解法）后修复。**该剥离函数由三档口径共用**（写入 `stubTextReason` / 载入 `isPlaceholderOnlyText` / 入参 `placeholderParamReason`）⇒ 这次是**修漏判**（去掉漏网），**不是新增拒收面**，验收时别当成「CV-235 扩大了拦截范围」。**④ 参数分类表 + 双向对账**（`src/param-guard.ts`，新）：15 个句柄类 / 12 个自由文本类 / 24 个豁免（**豁免逐条写明原因**，不是笼统略过），测试遍历全部工具的**实际参数名**，未归类判红、分类表里的残留名字也判红（「先登记后使用」的同一手法）。**本批已手工完成对账**：23 条业务工具 50 个参数名 + 2 条占位工具贡献 `text` / `language` = 51，与分类表 15 + 12 + 24 **精确相等**。两处刻意豁免并写明理由：`script` / `screenplay` 交给 `write_script` / `write_screenplay` 内部的 **CV-217 专用守卫**（那里文案逐项列出必须覆盖的构成，比通用文案有用，中央守卫先抛会把更具体的纠正挤掉）；`options` 的「待定 / 暂无」是**合法语义**（`暂不确定`），拦它会把正常点选题拒掉。**⑤ 事前纪律唯一源**：`PLACEHOLDER_PARAM_RULE` —— **同一份字面量**既挂进「有句柄入参」工具的 `description`（判据从工具自己声明的 `parameters` 现算，加句柄参数的新工具自动被覆盖，**无名单可漏**），又拼进被拒收时的错误文案（与 `STUB_PAYLOAD_RULE` 同一手法，两处措辞永不漂移）。理由：**错误文案只在犯错那一刻出现 —— 模型在没犯错时读不到「本工具不接受占位值」，它就还会照旧先占位、等报错**。**⑥ 独立错误码 `CS-PARAM-002`**：与 `CS-PARAM-001`（缺参 = 没给）是两件事（这条 = 给了个假货）；也**不能复用 `CS-NET-009`** —— 实测两者会撞在同一个入参上（占位串一路走到 SSRF 校验才被拦），拆开各自文案才说得准。受众含 `user`：文案本身可读且可行动，且工具失败结果无论如何都会被框架写进会话转录，与其让框架拿原文回显，不如给一份说清「本次调用未执行（没建节点、没发起生成）」的准确文案。**⑦ 踩坑（本批唯一硬伤）**：`param-guard.ts` **不能** `import './errors/catalog.js'` —— 方向必须 `catalog → param-guard` **单向**，ESM 环会在 **import 求值阶段**直接 ReferenceError（catalog 读到尚未初始化的 `const PLACEHOLDER_PARAM_RULE`），不是运行到那行才报。**验证（待跑）**：`node --test tests/param-guard.test.mjs` 14 条；反向变异「去掉 `assertNoPlaceholderParams` 那一行」⇒ 入口拒收用例精确变红、「去掉 `withPlaceholderParamRule`」⇒ 描述挂载用例精确变红
- **涉及文件**：`src/param-guard.ts`（**新**）、`src/text-guard.ts`、`src/errors/catalog.ts`、`src/tool-error-boundary.ts`、`tests/param-guard.test.mjs`（**新**）

#### CV-234 · 错误可见性「诊断开关」（设置 → 诊断）+ 一处关键认知更正：audience 管不到对话流（D1）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**① 为什么需要开关**：默认行为是把 `agent` / `developer` 受众的错误**藏起来**，而**藏起来的东西没有可观察迹象** ⇒ 验收时分不清「被正确隐藏」与「压根没触发」；`developer` 受众的错误在生产与开发环境下**都不展示**（`RouteEnv.devMode` 只往文案后加 `[dev]` 细节、**不改变受众判定**），所以「隐藏」这条规则此前**无法被验证**。新增 `ErrorVisibility = 'audience' \| 'all'`（`error-system.ts`）+ 设置项 `errorVisibility`（`host-config.ts`，`z.union(['audience','all']).default('audience')` —— 默认值必须是生产行为，漏改默认会让整套语义整体失效）+ 设置弹窗第 7 个分区「诊断」（一个 checkbox）+ 根组件挂载时订阅同步。**打开后**：绕过两条隐藏规则（`recoverability:'auto'` 与「非 `user` 受众」）一律走「需展示」，且 `channel === 'log'` 的码**改走 `conversation`**（`log` 面没有渲染实现 —— D5 只落日志，照搬会得到「判定说已展示、屏幕上什么都没有」的假绿，正好把开关的用途废掉），文案后附 `[dev]` 诊断细节。**两条读取路径必须同改**：`routeError()`（实例侧）与 `codeIsUserFacing(code)`（客户端手里只有码字符串时用）—— 只改一处就是「同一规则两份实现」的老毛病（本项目已在 `CS-UNC-000` 上踩过一次：同一码在边界两侧结论相反）。`routeError` 因此**不再是纯函数**（读进程级 `visibilityFlag`），JSDoc 与节标题已同步声明。**② Host / Client 是两个独立 JS 运行时** —— 标志不共享，共享的是**设置值**（`canvas-studio` 命名空间）；两端各自在读到设置后调 `setErrorVisibility()` 同步**自己进程内**的标志。客户端**必须在根组件同步**而不是只靠弹窗 `onChange`：后者只在弹窗打开时活着，重启后标志退回默认值 ⇒ 出现「开关是开的、行为还是默认的」这种最难查的偏差（Host 侧同理，两个回调是否在装载期被调用属框架内部行为，故装载后**无条件首次同步一次**）。**③ 关键更正（本批最有价值的结论）**：「只有『含 `user` 受众 且 非 `auto`』才会出现在用户眼前」这条**只管 D2/D3/D4，管不了 D1 对话流** —— 框架把工具失败结果**固定**渲染成 `Error: <message>` 写进会话转录，那一层是**宿主 L0 的 DOM**，受众判定够不到。实证：`CS-NET-009`（`audience:['agent','developer']`、`channel:'log'`）在用户截图里就出现在对话流中，一次会话 6 条。**推论（必须记住）**：把「非 `user` 受众的 `message` 换成 `devMessage`」是**错的**修法 —— `CanvasStudioError.message` 正是对话流里那一行，换成 `devMessage` 会把内网地址 / 绝对路径 / stack 泄进**用户可读的会话转录**；正确做法是**另立专用码**，`userMessage` 只回显可安全外泄的信息。**CV-233 勘误（同批修正）**：`registerStudioToolErrorBoundary` 原先用 `ctx.on('tools/execute')` 注册 —— `dsh-scope` 的 `scopeTarget` 只放行「无 scope 标签」或「注册所在 scope 是 agent scope 本身 / 祖先」（源码注释原话「events flow up the chain, never down」），而本插件 ctx 与 agent scope **平级** ⇒ 中间件**永不被调用**（最小复现实测 0 次 vs `ctx.root.on` 1 次），错误码从未跨过 Host→Client 边界、D2 按受众判红标形同虚设。改用 `ctx.root.on` + `ctx.effect` 包裹（含反向对照，证明不是用例写错）。**守卫**：`tests/error-system-guards.test.mjs` +1（第 8 条：默认必须是 `audience`；打开后 `routeError` 与 `codeIsUserFacing` **一起**放行、`log` 面改走 `conversation`、`auto` 档也放出来；`finally` 还原**并再断言一次**，防进程级标志污染同进程后续用例）。⚠️ **本批未经机器验证**：沙箱 `sandbox-exec: pattern serialization length exceeds maximum` ⇒ Bash / Grep 全不可用（`dangerouslyDisableSandbox` 也绕不过），待恢复后跑 `tsc -p tsconfig.json` + `tsc -p tsconfig.client.json`（**必跑**：`CanvasStudioConfig` 新增必填字段）+ 全量测试 + 反向变异。
- **涉及文件**：`src/error-system.ts` / `src/host-config.ts` / `src/index.ts` / `src/client/SettingsModal.tsx` / `src/client/StudioFrame.tsx` / `tests/error-system-guards.test.mjs`

#### CV-233 · 统一错误处理系统全量落地：错误码化 + 双轴路由 + 五条展示通道 + 开发者细节默认隐身

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**起点**：错误过去是一堆裸 `throw new Error('中文文案')` + `logger.warn`，**谁该看见、看见了该怎么办全靠下游猜文案** ⇒ 用户会撞见 `Failed to fetch` / `ECONNREFUSED` / 内网 IP / 绝对路径这类他看不懂也无从处理的东西；而真正该报的故障又被埋在日志里。**三个阶段（代码全部完工）**：**① 框架层** `src/error-system.ts` —— `CanvasStudioError` + 注册表 + 纯函数 `routeError()`。**双轴分层**：`audience`（user / agent / developer，决定「给谁看」）× `recoverability`（auto / guided / fatal，决定「怎么处理」），外加 `severity`（S1/S2/S3）。**唯一核心规则**：**只有「含 `user` 受众 且 非 `auto`」才会出现在用户眼前**，其余落日志或静默重试。展示通道 `ErrorChannel` 五种：`conversation`(D1) / `node`(D2) / `effectTest`(D3) / `toast`(D4) / `log`(D5)。`registerError` 做一致性自校验（audience 为空 / `auto` 却含 `user` / 含 `user` 却 `channel:'log'` 一律拒绝登记）。**② 全量迁移** `src/errors/catalog.ts` **53 条**错误码（阶段二按错误手册 A–K 逐模块把裸抛改为 `throwError(code)`；含 `user` 受众 35 条，剩余 19 条对用户完全隐身；连同 `error-system.ts` 内自注册的兜底码 `CS-UNC-000` 共 **54 条**）。**③ 边界收敛**（本批新增）：**（a）错误码跨进程** —— 框架的 `tool/result` 只对 `HarnessError` 填 `error.info = {name, code}`，其余异常一律降级成纯文本，而 `tools/execute` 中间件**看不到原始异常** ⇒ 新建 `src/tool-error-boundary.ts` 两半配合：`wrapStudioToolDefinition()` 包装 execute 并用 `WeakMap` 暂存码、`registerStudioToolErrorBoundary(ctx)` 在中间件侧取回并 `decorateStudioToolResult()` 写进 `result.error.info`。**⚠️ 不能走 `instanceof HarnessError` 方案**：实测 `canvas-studio/node_modules/@deepseek-ai/dsh-llm` 与 `dsh-plugin-desktop/node_modules/...` 是**两份独立实体**，跨副本 `instanceof` 恒 false。`decorateStudioToolResult` 两条不写规则：非失败结果原样返回；已有 `result.error.info` 原样返回（框架的 `TOOL_ABORTED`/`TOOL_TIMEOUT` 优先）。**（b）D2 节点错误态按受众决策** —— `asset-capture.ts` 取 `data.error.code`，`codeIsUserFacing(code)` 为假则**不画红标**（此前一律画红，把开发者诊断当用户故障）。**（c）`data.error.message` 是死字段** —— 旧实现读它拿文案、实际**不存在**，真形状是 `data.message.content[0].content[0].text`（文本嵌在 `tool-result` 层内）；文案提取收口为唯一实现 `src/tool-result-text.ts` 的 `firstText()`（限深 4 防自引用），并剥掉框架加的 `Error: ` 前缀。**（d）HTTP 路由层 20 处细节外泄收口** —— 新增 `sendRouteFailure()`：需展示的用 catalog 的 `userMessage`，其余落日志 + 中性中文兜底，**响应体一律带 `code`**；此前 `cause instanceof Error ? cause.message : 'xxx'` 会把 `project list unavailable` 这类英文内部串直接当用户文案返回。**（e）devMode 默认安全化** —— 旧判定 `NODE_ENV !== 'production'`，而桌面端**从不设 `NODE_ENV`** ⇒ 打包后恒为开发模式、`[dev]` 诊断行会直接露给用户；改为白名单 `resolveDevModeFromProcess()`（`CANVAS_STUDIO_DEV_MODE==='1' \|\| NODE_ENV==='development'`）。**（f）三态错误卡改按码判定** —— `error-kind.ts` 新增 `classifyStudioFailure(code, message)`：有结构化码时按 catalog 的 `uiKind`（`retryable`/`config`/`unreachable`，省略即 `retryable`），无码才回退字符串启发式（**启发式降为兜底，不再是主路径**，回应 CR-032 与本系统 §6-1「下游不再靠字符串匹配」）；`uiKind` 定义在 `error-system.ts` 而非 `error-kind.ts` —— 它是错误规格的一部分，放后者会形成循环依赖。链路：`project-store` 新增 `errorCode` 字段 → `StudioFrame` → `ProjectList` → `StudioErrorState`。**验证**：clean + tsdown + tsc×2 + verify:loader ✓；`tests 936 / pass 931 / fail 5`（净增 15 条守卫，**5 条红与基线逐条同名**：渐进披露 + studio-defaults ×4）；**新增 3 份守卫** —— `tests/error-system-guards.test.mjs`（7 条：禁裸抛 + 先登记后使用 + 全码元数据完整性 + routeError 自洽 + 未登记码按展示处理 + **系统自造兜底码必须已登记〔边界两侧结论一致〕** + 码命名空间）、`tests/error-kind.test.mjs`（11 条）、`tests/tool-error-boundary.test.mjs`（8 条）。**反向变异两轮全部精确命中**：① `return spec.uiKind ?? 'retryable'` 改回 `return classifyStudioError(message)` ⇒ 3 条红；② 去掉 `CS-GEN-204` 的 `uiKind` 声明 ⇒ 精确红；③ **删掉 `CS-UNC-000` 的注册 ⇒ 精确命中那条一致性守卫（仅 1 条红）**。均还原复绿。**已知限制**：`CS-FFMPEG-001` 现为 `developer` 受众（生产对用户隐藏）—— 用户其实看得懂「视频处理组件不可用」且只能靠重装解决，**是否升 `user` 待拍板**（§7）；存量画布节点上的旧英文文案不回填（开发阶段只修产生数据的路径，重试一次即被新文案覆盖）。
- **涉及文件**：`src/error-system.ts` / `src/error-kind.ts` / `src/errors/catalog.ts`（53 条） / `src/tool-error-boundary.ts`（新） / `src/tool-result-text.ts`（新） / `src/question-result.ts` / `src/asset-capture.ts` / `src/routes.ts`（20 处） / `src/client/{index.ts,api.ts,project-store.ts,ProjectList.tsx,StudioFrame.tsx,brand/States.tsx}` / `tests/error-system-guards.test.mjs`（新） / `tests/tool-error-boundary.test.mjs`（新） / `tests/error-kind.test.mjs` / `tests/asset-capture.test.mjs` / `docs/canvas-studio-error-system.md` / `docs/canvas-studio-error-handbook.md` / `docs/acceptance-test-cases.md`（R 组 9 条）
- **落地/验收**：2026-09-23

#### CV-219 · health 探针 fail-closed 误判

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：判据 `ok = response.ok` 让 health 一返 500 就把**所有**打后端的操作报成「不可达」（可观测性接口故障被升级成服务不可用）；顺带落地「忙/闲」双态：探针带回 `queue_task_count`，忙时经既有 warnings 通道回流排队位次、本地超时报**实时**队列深度
- **涉及文件**：`src/generate.ts` + `tests/health.test.mjs`

#### CV-223 · 「整理布局」升级镜位泳道：行 = 镜号，行内从左到右 分镜卡 → 场景图×k → 关键帧 → 视频/托盘 → 末帧

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（demo `canvas-layout-v2.html` 定稿方案移植）。CV-185「按工具固定列」的代价：18 镜的卡/视频/托盘按工具各自堆成一列，镜与镜的对应关系不可读、镜位区被拉得极长。**镜号解析（四趟血缘传播）**：分镜卡 title「分镜 N」→ 视频（血缘含卡）→ 末帧（血缘含视频）→ 无血缘场景图取消费视频最小镜号；**消费者 ≥8 = 全局锚**（风格/场景锚）不进镜位、留源素材区；图引用分镜卡 = 关键帧。**头部行**（创意/上传素材/全局锚/源 BGM；剧本对齐首行、定妆照跟随源素材）+ **右上尾区**（文案/配乐 BGM/无镜号视频；compose 恒末行）+ **兜底行**（镜号解析不出的单元排到所有已用行之后，任何画布不重叠的保证不破）。**链式镜零特判**：末帧与视频同镜同行、下一镜自然落下一行 —— 18 镜链不拉 18 列。**托盘按子代视频镜号进镜位行**（组随行相对偏移不变，沿用 CV-185 机制；store 排后仍走 tidyGroupLayout）；**版本钉扎**：顶层被取代节点钉在取代链尾正下方，取代者所在行加高防压。**真实画布冒烟**（罗大佑 83 节点）：83/83 落位、顶层重叠 0、18 卡 18 行升序、18 托盘全与对应分镜卡同行、末帧与镜 1 同行、成片落右上尾区。**测试**：`tests/canvas-arrange.test.mjs` 重写 13 条（同镜同行 / 血缘继承 / 链式不拉列 / 全局锚 / 场景横排跨镜对齐 / 组随行 / 版本钉扎 / 同泳道纵排 / 流程左→右 / compose 尾行 + CV-185 适配 3 条保留），**canvas-arrange 3 条基线红全部翻绿**；顺带翻正 2 条早已漂移的接线断言（`autoArrange` 的 visibleIds 签名与 StudioFrame 传参）。**桌面验收发现并当日修复（2026-09-22）：镜位区曾被整体让出 `headRows` 行 ⇒ 分镜区下移** —— 真实画布 6 个源素材把镜位区推下 5 行（镜 1 落在 y=2018），分镜与头部之间空出一大片（用户截图报障）。**根因（读码定位）**：`headRows = max(源素材单元数, 2)` 是「头部行数」，而尾区与头部都从第 0 行起排、只有镜位区从 `headRows + 镜号` 起算 ⇒ **不对称**；头部只占 LANE_SOURCE/LANE_SCRIPT、镜位占 LANE_CARD~FRAME，**X 本就分离，无须让行**（demo 源素材少 + `headRows` 下限 3，故未暴露）。**修法**：`shotRow[shot] = shot`（行号 = 镜号）。**实测对比**（同画布 83 节点，改前/改后各跑一次）：镜 1 `y 2018 → 368`；包围盒 `4596×9328 → 4596×7678`（总高 **−17.7%**）；83/83 落位、顶层重叠 0、18 卡 18 行、18 托盘全与对应分镜卡同行 —— **全部保持**。**续办（同日 · 同一验收反馈）**：镜 1 再上移一行与创意**同行**（`Math.max(0, shot - 1)`，镜 1 `y 368 → 40`）+ 行内/泳道横向间隙 `ARRANGE_GAP_X` 48 → **80**（只放宽横向、纵向不动）⇒ 包围盒 `4596×7678 → 4820×7350`（宽 +4.9%、高 −4.3%），结构指标全保持；测试 1 的「头部在镜位之上」改写为「同行 + 泳道 X 分离」，反向变异精确命中；预览台 `arrange-preview` 的 7 条失败经 `git stash` 同题对照证实为**既有基线**（与本批无关）。**测试**：canvas-arrange **13 → 14 条**（新增「源素材数量不推高镜位区起点」，反向变异精确命中：改回 `headRows + shot` 仅该条红）；「全局锚不进镜位行」判据从**行号更小**改写为**泳道 X 分离**
- **涉及文件**：`src/canvas-view.ts`（computeArrangeLayout 重写：镜位泳道 + 兜底；2026-09-22 去掉 headRows 偏移、镜 1 对齐首行、`ARRANGE_GAP_X` 48→80）/ `tests/canvas-arrange.test.mjs`（重写 8→13，验收后 +1 = 14 条）

#### CV-220 · 宿主侧从来没有生成队列 —— 后端同步单任务 × 占位截止只剩 60s 余量 ⇒ 排在后面的请求「还没轮到」就被判「生成超时」

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**问题是误判不是慢**：Drama 后端同刻只处理一个请求（并发只排队、墙钟不变），而客户端占位节点的结算上限 `PENDING_TIMEOUT_MS = 660s` 从**占位落地那一刻**起算，`DRAMA_TIMEOUT_MS.video = 600s` ⇒ **只剩 60s 余量**；只要请求重叠一次（客户端连点节点重试 / 打回重出 / 模型同回合多调用，或后端已被**他人**占满 —— CV-218 的 B 实测 `queue_task_count=5`），后面的占位就会在「还没轮到」时被判「生成超时」。**落地两层**：① `src/generate-queue.ts`（新，纯模块）—— FIFO 单通道，`withGenerateSlot(label, signal, run)` 排队执行、`finally` 释放；**等待中被取消必须出队**（不清理就锁死整条队列，这是最危险的失败模式）；`generateQueueSnapshot()` 给出「谁在执行 / 谁在等 / 排第几」。**接入点选在 `callDrama`** —— 它是同步单任务后端的**唯一**网络入口（图片 / 文字修复 / 角色 / 视频(仅 drama) / 音乐全走它），而 fal（异步三段式）、`uploadBytesToDrama`（上传）、`ensureDramaReachable`（探活）、`callDramaRaw`（文本工具）各自独立 ⇒ **「只拦同步 Drama」是结构保证，不是 provider 字符串分支**，`maxParallel` 也继续刻意不接（并发无收益）。② `src/queue-view.ts`（新，纯模块）+ 只读端点 `GET /canvas-studio/generate-queue` + 客户端轮询（**只在有生成在飞时跑**，空闲即停）：遮罩显示「生成队列：视频生成 · 等待 2 个」并**在队列非空期间顺延占位截止** —— 把排队时间从「超时」里摘出去才是消掉假超时的那一刀。**刻意不做「本节点第 N 位」**：客户端只看得到自己发起的请求，把全局位次贴到某个节点上是**假精度**（同一次刷新里两个节点会都显示「第 2 位」），要做需给请求加一条 `客户端 requestId → 队列条目` 的归属通道。**验证**：clean + tsdown + tsc×2 + verify:loader ✓；`tests 849 / pass 841 / fail 8`（净增 13，**8 条红与基线逐条同名**）；预览台 23/33（基线）；**反向变异 8 轮全部精确命中**（不互斥 → 4 条红；abort 不出队 → 精确 1 条红；抛错不释放 → 4 条红且报「队列没有继续前进」；接入点挪到上传 → 精确 1 条红；唯一接入点落在别处 → 精确 1 条红并**点出实际落点**；客户端不顺延 → 精确 1 条红；标签漏端点 + 归一化降级 → 精确 2 条红；fal 引用 callDrama → 精确 1 条红），全部还原后复绿。**顺带修守卫自身缺陷**：首轮「抛错不释放」变异表现为**挂死**（CI 上会拖垮整轮、看不到是哪条断言坏），已给「队列本该继续前进」的等待加 800ms 短闸，把挂死换成可读的红。
- **涉及文件**：`src/generate-queue.ts`（新） / `src/queue-view.ts`（新） / `src/generate.ts`（`generationLabelOf` + `callDrama` 排队） / `src/routes.ts`（只读队列端点） / `src/client/{api.ts,index.ts,project-store.ts,StudioFrame.tsx}`（轮询 + 顺延 + 投影） / `src/client/canvas/{CanvasSurface.tsx,CanvasNode.tsx}`（遮罩文案） / `tests/generate-queue.test.mjs`（新，13 条）

#### CV-218 · image2fix 自动兜底的修复 prompt 形态错误 —— 只喂字符清单 ⇒ 丢掉位置锚点

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**取证不靠猜**：用户给出后台同事的**真实成功案例**（海报「山见茶事」，12 处文字 8 处错 → 修复后**全对、排版零漂移、无新增文字**），据此把「正确形态」钉死；本项目真机反证为 `武仔`→`武传`（**仍错**）+ 凭空多出两处「武侠」+ 曝光漂移。**规则**：修复 prompt = 原 prompt 的「**文字规格段**」（每段文字 **+ 它在画面里的位置 / 字体 / 字号 / 颜色 / 排版关系**）+「**逐字约束段**」，**删掉**画幅 / 材质 / 光线 / 配色 / 气质等美术描述段。**三条根因**：① 丢位置锚点 —— 模型不知该位置原本是什么字，只能按形近字猜；② 祈使式动词「确保…正确渲染」⇒ 语义被读成「把这些字渲染出来」；③ 无「不得增删」约束 ⇒ 顺手补字。**落地**：① 新建纯函数 `extractTextSpec()`（分句 → 保留含**未被否定**引号文本的句子 + 含逐字约束关键词的句子 + 含「占位」的占位元素句；判据「引号前 3 字含否定词」只认 不要/不用/避免/不是/禁用/别用/勿用/禁止，**刻意不含「无」「非」** —— `用无衬线"SALE"` 会被误判）；② `buildTextFixPrompt(originalPrompt)` 改**原 prompt 直通**，并**删掉「字符清单」回退分支**（该分支实际不可达：只要触发修复，原文必有含引号的规格句 ⇒ 留着只是第二份永不执行的实现）；③ 自动路径 `runTextAutoFix()` 增收原 prompt、`image_generate` 调用点传 `a.prompt`；④ 原文没写约束句时补 `DEFAULT_TEXT_CONSTRAINT`（唯一源）。**skill 同步 5 处**（prompt-writing / consistency / krea2-turbo / krea2-edit / music-video-subtitle）+ `image_fix` 工具描述与 prompt 参数描述。**关键讽刺点**：`image_fix` **工具描述早已写对这一做法**，只有自动路径没跟上。⚠️ **B（真机 A/B 对照）被后端阻塞**：`/api/v1/health` 200 / `openapi.json` 200，但 `POST /api/v1/generate/upload` **稳定 500**（3/3 次、~50ms 快失败，125KB 小图同样 500 ⇒ 非体积问题）；image2fix 必须用上传句柄（CV-155），故 A/B 真跑待后端修复
- **涉及文件**：`src/text-detection.ts` / `src/host-tools.ts` / `tests/text-detection.test.mjs`（10→21 条） / `tests/fixtures/text-spec/`（新：正例原文 + 人工确认的目标修复 prompt） / `scripts/probe-image2fix-ab.mjs`（新：A/B 真机探针，含 health 夹心） / 5 个 skill 文件

#### CV-217 · 画布上反复多出一张正文只有「占位」二字的「文案」卡 —— 模型「先占位、后回填」的坏习惯 × write_script 每次调用都新建节点 ⇒ 占位卡永远没人替换它

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：。用户截图（标题「文案」、正文「占位」、角标 2 字，问「是出现的时机不正确吗」）→ **从真实画布与会话转录取证，不靠截图推测**：`~/.videobuddy/…/projects/北京书市/canvas.json` 里**两张**「文案」节点 —— `d193cb86` 正文 `占位`（`createdAt` 16:12:16）与 `0303622f` 真文案（16:29:24），**相隔 17 分钟**；转录 `session-eca7901d-…/session.jsonl.zstd` 的 `tool-call-chunks` 逐 token 打出 `["", "{\"script\": ", "\"占位", "\"", "}"]` ⇒ **不是流被截断，是模型自己写的**（而它同一 step 的推理写着「Next, write the screenplay」）。同一模式在「测试分辨率拆分」项目**独立复现第二次**（`write_script {"script":"占位"}` → 真文案）。**所以不是「时机不对」，是那张卡从来没人回填**。**三处收口**：① `write_script` / `write_screenplay` 落盘前拒收占位载荷（`stubTextReason`，命中即抛错，并给出路「内容没准备好就先不要调用本工具」）；② 客户端载入清洗增 `isStubTextNode`，把**历史遗留**的占位卡清掉（写入侧只管新项目，不修这儿老画布永远脏）；③ 两个工具的 description 挂同一句 `STUB_PAYLOAD_RULE`（唯一源 —— 错误文案只在犯错那一刻出现，模型没犯错时读不到「本工具不接受占位」）。判据取「**整篇**只有占位词」而非「包含占位词」：真实文案里出现「不要写占位」这类叮嘱是合法的。载入侧另用更窄的 `isPlaceholderOnlyText`（空内容不算占位）—— 那里是**真删已落盘数据**，用户可能点开 agent 写的卡把它清空，那是用户笔迹，不能替他删。**刻意没做**：把 `write_script` 改成原地更新 —— `docs/canvas-lineage-completion-plan.md` §2.3 明确记着本产品「6 文案 ↔ 6 BGM ↔ 6 成片」的多版文案是**合法用法**，原地覆盖会砸掉它（该改进属 CV-207，仍待拍板）。
- **涉及文件**：`src/text-guard.ts`（新） / `src/host-tools.ts`（两个写入工具 + description） / `src/client/project-store.ts`（载入清洗） / `tests/text-guard.test.mjs`（新，10 条） / `tests/generate.test.mjs`（夹具由占位串改为合法文案）

#### CV-216 · 放手跑下仍弹出点选卡片：卡片的有无由「模型调了什么工具」决定，而不是由「Host 是否真的在问」决定

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。用户实测截图（放手跑模式下弹出「成片想要什么形态？」卡片）→ **从会话转录逐帧取证**（`~/.videobuddy/sessions/…北京书市…/session-eca7901d-…/session.jsonl.zstd`，非截图推测）：`tool/call` seq 1085 → `tool/result` seq 1086 **仅隔 7ms**，结果原文写着「（放手跑模式）本回合不等待用户作答…已直接按默认值取…」⇒ **Host 侧完全正常**（`autoAnswerFor` 按设计短路：不写 `pendingQuestion`、不进轮询），模型那行 Think「This session is in 放手跑模式」正是读到它之后的反应。**真因一：客户端判据错位** —— `client/question-capture.tsx` 的 `match()` **只看 `event.type === 'tool/call' && name === 'ask_user_choice'` 就建节点**，`start()` 直接照参数建卡片，**从不问 Host 有没有真的问**；两条路互不知情 ⇒ 卡片照弹。**修法（方案 A：按调用粒度落一个可识别标记）**：① `studio-defaults.ts` 新增 `AUTO_ANSWER_MARKER` 与成对的 `AUTO_ANSWER_OPTION_PATTERN`（**唯一源**），`autoAnswerFor` 首句改用它拼接；② 新建根级纯模块 `src/question-result.ts`（**判定与渲染分家** —— 消费方是 `.tsx`、进不了 `node --test`，同一手法见 CV-151 的 `style-grid.ts`）；③ 客户端读到标记 ⇒ 翻 `autoAnswered`、**不渲染任何可交互元素**，降级为一行窄条「（放手跑）本回合未提问，已按默认值取「多镜头叙事短片」」。**为什么不整条隐藏**：它是「这里本该提问、但放手跑替你定了」的唯一痕迹，与画布上其它节点一样应当可追溯。**为什么不读 `workflow.mode` 而落文本标记**：判定按**调用粒度**生效 —— 重放旧会话时逐条读到的仍是当时的真相，读「当前模式」会让历史卡片形态漂移。**真因二（同文件连带缺陷）：`extractResultNote` 层级读错** —— 真实形状是 `message.content[0] = { type:'tool-result', content:[{ type:'text', text }] }`（**转录取证**），旧实现直接遍历 `message.content` 找 `type === 'text'` ⇒ **永远匹配不到 ⇒ 所有点选卡片底部恒显示兜底的「已结算」**，连用户真正作答后的文案也是坏的。新实现深度优先、兼容新旧两种形状（限深 4，防自引用）。**真因三：死字段** —— `StudioQuestionChatData.answer` 全仓只有赋 `null` 一处、从无读取 ⇒「✓ 已选择：X」是死分支，已删（用户作答后的样子由 `note` 承载）。**真因四（skill 层）：豁免写在强制框架之后等于没写** —— `references/clarification.md` 开头是硬命令「开始策划前用 ask_user_choice 确认形态 + Look」，而放手跑豁免压在第 26 条与文末补完段；模型推理原文显示它通篇在绕「§3 形态题的条件式跳过规则」、**一次没提放手跑**。⇒ 把「放手跑下本文件整节作废」提到**文件第 1 节**，并把那个宽泛的「唯一例外」（风格 skill 内部卡片）收紧为**三条件同时成立**（该 skill 本回合真的加载过 / 卡片写在该 skill 自己的 STEP 里 / 用户显式点名选中），防它被当免罪符。**新增守卫 11 条**（`tests/question-result.test.mjs`）：解析层 4 条（真实嵌套形状 / 扁平兼容 / 畸形输入回退 / 自引用不递归）+ 标记识别 3 条（**转录快照也能识别**〔守住「重放旧会话」这一场景〕/ 用户真实作答不得误判 / **中段复述标记不算数**〔必须是首句前缀，否则模型转述一句就能把真卡片降级掉〕）+ 咬合与接线 4 条（**端到端：`autoAnswerSummary(autoAnswerFor(…))` 必须非 null** / 生成侧不得硬编码字面量 / 客户端必须引用共享模块且删掉的 `answer` 不得复活 / 短路必须排在硬命令之前）。**反向变异 3 轮全部精确变红**：① 改生成侧措辞「已直接按默认值取」→ **仅端到端那条**红；② 把 `AUTO_ANSWER_MARKER` 改回硬编码字面量 → 常量脱钩那条红；③ 删掉 `update` 里的 `autoAnswered: true` 翻牌 → 消费侧那条红（**此轮暴露原断言只查「标识符存在」、不查接线逻辑，已加强为「算 / 翻 / 画」三件事逐条钉**）。**验证**：build + typecheck + verify:loader ✓；`tests 810 / pass 802 / fail 8` —— 净增 11 条且**失败清单与基线逐条一致**（`canvas-arrange`×3 / `minimax-skill`×1 / `studio-defaults`×4，与本批零依赖）；预览台 23/33（10 条失败为基线，含 1 条故意反向对照）。**顺带实测（后端侧，非本批改动）**：`GET /api/v1/health` 目前**稳定 500**（0.02s、5/5 次，`/` 同 500；`/view` 返 422 说明路由与服务是活的）⇒ 用户提供的 `{"status": "ok", "queue_task_count": 2}` 此刻取不到。**⚠️ 影响面比看起来大**：`ensureDramaReachable` 是 fail-closed（`ok = response.ok`）⇒ health 500 会让**所有打后端的操作**立即报「Drama Backend 不可达」—— **可观测性接口故障被升级成服务不可用**。故 ③（宿主单通道队列）与 ⑤（探针升「忙/闲」）**继续挂起**，等后端 health 恢复后再推（⑤ 应一并区分「端点 5xx」与「连接失败」）
- **涉及文件**：`src/studio-defaults.ts` / `src/question-result.ts`（新） / `src/client/question-capture.tsx` / `src/client/styles.ts` / `skills/canvas-studio-creation/references/clarification.md` / `tests/question-result.test.mjs`（新）

#### CV-215 · 把「后端同步单任务」纪律真正传达给模型 + 收口 CV-135 遗漏的上传超时

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。用户就画布插件提三问（① 调后端的超时怎么设 ② 任务失败后怎么探活 ③ 后端单任务规则有没有让模型知道），核查后的落地：**① 纪律此前从未进过模型上下文** —— `skills/` 全部 SKILL.md 与 references **零处**提及、24 个工具 description **零处**提及，唯一写着「后端单任务同步…调用一律串行」的是 `docs/api.md`（**开发者文档，不在模型上下文里**）；更糟的是总纲第 7 步**反向**写着 upload_image「（可并行）」，与事实相反。**做法**：新增 `config.ts` 的 `DRAMA_SERIAL_HINT`（**唯一源**，与 `h3-ir-validate.ts` 的 `COUNT_MODE_HINT` 同一惯例 —— 防两处漂移），挂到 4 个批量风险工具的描述（`image_generate` / `upload_image` / `video_generate` / `video_composite`）——**工具描述每回合都在上下文里**，比「只有被加载后才可见」的 SKILL.md 更可靠；总纲第 7 步改「**逐个**调 upload_image 拿 filename（后端同步单任务）」（**净增 22 字节 → 15343 / 15360，闸门余量只剩 17 字节**）；完整纪律（受约束的 11 个打后端工具 / 不受约束的 2 个本地 ffmpeg 工具 / 「并发只排队、墙钟 = 各段之和」的理由）写进分册 `toolchain.md` 新节「后端同步单任务：调用必须逐个来」。**② 顺带收口 CV-135 的遗漏**：`uploadBytesToDrama` 是**唯一裸 fetch 的 Drama 请求** —— 既不注入 `longRequestDispatcher`（⇒ 传输层仍是 undici 默认 300s），又不带任何超时（⇒ `signal` 缺省时可无限挂起，且它同样吃 300s）；补 `UPLOAD_TIMEOUT_MS`（5min）+ 按请求注入 dispatcher + 区分「用户打断 / 本地超时 / 连接失败」三档错误文案，并把它纳入**既有不变量守卫**（必须严格小于 `LONG_REQUEST_TIMEOUT_MS`=900s）。**③ `maxParallel` 定性**：全仓零消费者（schema + 注入 + 设置页 UI 三处俱在），此前只标「待接入」却没写原因 —— 现于设置页与 `host-config.ts` 双处写明「**后端同步单任务 ⇒ 并行闸门拿不到收益，刻意不接入**，等后端提供并发队列再评估」。**④ 顺带勘误**：`video_composite` 描述与分册里的「Drama 最多 6 张」是 CV-191（6→9）的漏网 ⇒ 一并改 9（两处，防模型主动少传参考图）。**关键发现（供后续决策）**：串行其实**已被平台默认兜住** —— 24 个工具都走裸 `defineTool`、**均未声明 `isConcurrencySafe`**，而 dsh-tools 是 fail-closed 语义（「Only an exact `true` is parallel; unknown, hidden, undeclared … are exclusive」）⇒ 同回合多个 tool_call **本就串行 + 排序屏障**（`dsh-tools/lib/index.js:1176`）；**但这层保护是隐式的** —— 谁为提速加一句 `isConcurrencySafe: () => true` 就静默失效，故纪律仍须显式传达。**新增守卫 2 条**（`tests/skill-guardrail.test.mjs`）：① 总纲不得再出现「可并行」且两处都写明同步单任务；② 常量内容含「同步单任务 / 逐个调用」+ 4 个工具都引用该常量（**注意断言位置**：编译产物里 `lib/host-tools.js` 只有 `DRAMA_SERIAL_HINT` 这个**标识符**，中文字面量落在 `lib/config.js` ⇒ 正确姿势是「常量内容对 + 每个工具都引用它」，而不是在 host-tools.js 里找中文）。**反向变异已验证能精确变红**：改回旧措辞 → 断言 3 红；删掉 video_composite 的引用 → 断言 4 红并点名该工具；两者均已还原复绿。**验证**：build + typecheck + verify:loader ✓；`tests 799 / pass 791 / fail 8` —— **净增 0 个失败**（那 8 个为既有基线，与本批**零依赖**：`canvas-arrange` → `lib/canvas-view.js`、`studio-defaults` → `lib/contracts/project.js`、`minimax-skill` 报的是 krea2-edit-writing 的跨 skill 引用路径 `/krea2-edit-writing/references/prompt-writing.md`，三者都不是本批改动的模块）
- **涉及文件**：`src/config.ts`（+`DRAMA_SERIAL_HINT`）/ `src/host-tools.ts`（4 处描述 + video_composite 6→9）/ `src/generate.ts`（+`UPLOAD_TIMEOUT_MS` + upload 补 dispatcher/超时）/ `src/host-config.ts`（maxParallel 定性）/ `src/client/SettingsModal.tsx`（maxParallel 提示）/ `skills/canvas-studio-creation/SKILL.md`（第 7 步措辞）/ `skills/canvas-studio-creation/references/toolchain.md`（新节 + 6→9）/ `tests/long-request.test.mjs`（+上传档不变量）/ `tests/skill-guardrail.test.mjs`（+2 守卫）/ `docs/STATUS.md`

#### CV-202 · image2fix 文字修复端点：探针 + 工具接入 + skill 全套

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：。后端 2026-09-18 新增 `POST /api/v1/generate/image2fix`（Boogu Image Edit，`boogu_image_edit.json` 工作流）= **Krea2 出图后图内文字出错的专用修复通道**；后端同事用法交代：修复 prompt **只写「文字」那部分描述**（从原出图 prompt 提取，其余画面描述一律不带 —— 改图接口不是重新生成）。**① 探针先行**（新增 `scripts/probe-image2fix.mjs`，产物 [api-probe/image2fix-20260918](./api-probe/image2fix-20260918/report.md)）：带错字海报（标题 SALLE）→ Krea2 产物名直用作入参 **500 快失败 52ms**（CV-155 纪律复证）→ upload 换句柄 → **image2fix 200 / 68.5s**（后端文档示例 4.55s 偏乐观）→ 产物前缀实测 **`boogu_00009_.png`**（后端文档示例写 `boogu_edit_*`，以实测为准）→ boogu 产物名直用 image2vl 同样 500（55ms）→ 换句柄后 image2vl 读回 **`SUMMER SALE 50% OFF`，修复生效**；踩坑留存：keep-alive 复用在「1MB /view 大响应后立刻 POST」1ms socket hang up ⇒ 探针 `agent: false`。**② 工具接入（23→24）**：`config.ts` +`image2fix`；`generate.ts` 新增 `image_fix` 分支（**不收 width/height**，产物尺寸跟随输入图 ⇒ 新增纯函数 `pngSizeOf` 解析 PNG IHDR 实测落盘 —— 唯一实测像素的图片路径）+ `operationTypeOf` 归 `image-to-image`；`host-tools.ts` 注册 `image_fix`；`node-params.ts`（REPLAYABLE + PROMPT_FIELDS）与 `approval-gate.ts`（PRODUCING_TOOLS）补行。**③ skill 6 处**：krea2-turbo-writing 文字渲染节修复出口 + 自检清单、krea2-edit-writing 纠错/创作分流、总纲 prompt-writing.md 第三条路由（总纲 SKILL.md 不动，仅剩 287B 余量）、toolchain.md 加 image_fix 行（顺带勘误 image_generate「最多 3 张」CV-189 漏网）、music-video-subtitle-generator 加 Typography error recovery 节、co-op-game-intro-generator STEP 7 加错字修复路径。**④ 文档**：api.md 0.3.1、api-usage 14b、canvas-studio-tools.md 24 工具 + A11。**验证**：build + typecheck + verify:loader ✓，测试 **772/772 fail 0**（+5：契约 2 + PNG 实测落盘 1 + pngSizeOf 1 + 注册反证补名；C10 守卫 `const display` 随 let 化翻正）
- **涉及文件**：`src/config.ts` / `src/generate.ts`（image_fix 分支 + pngSizeOf + display let 化）/ `src/host-tools.ts`（+image_fix）/ `src/node-params.ts` / `src/approval-gate.ts` / `scripts/probe-image2fix.mjs`（新）/ `docs/api-probe/image2fix-20260918/`（新）/ `tests/generate.test.mjs`（+5）/ `tests/visual-tokens.test.mjs`（C10 翻正）/ `skills/krea2-turbo-writing` / `skills/krea2-edit-writing` / `skills/canvas-studio-creation/references/{prompt-writing,toolchain}.md` / `skills/music-video-subtitle-generator` / `skills/co-op-game-intro-generator` / `docs/api.md` / `docs/canvas-studio-api-usage.md` / `docs/canvas-studio-tools.md` / `docs/STATUS.md`

#### CV-201 · 内置 ffmpeg：装机即全功能（补上 app 唯一的外部二进制缺口）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。**诊断**：依赖早就在（`ffmpeg-static@5.3.0`），**二进制从来没进过包** —— 它靠 postinstall 从 GitHub Releases 下载，而 `.yarnrc.yml` 设 `enableScripts:false`、根 `dependenciesMeta` 又没给 `ffmpeg-static:{built:true}` 豁免（electron / koffi / node-pty 都给了）⇒ `node_modules/ffmpeg-static/` 只有包壳，**已打包的 app 里同样没有**；`src/ffmpeg-run.ts` 的 `require('ffmpeg-static')` 档因此恒被 `accessSync(X_OK)` 跳过 ⇒ 只剩系统 PATH（开发机可用只因 brew 装了 ffmpeg）。**影响面**：成片合成 `compose.ts:408` / 抽帧 `video-style.ts:146` / 尾帧续镜 `video-frames.ts:107` **硬失败＝用户导不出成片**；BGM 真波形、fal 参考图压缩、产物时长与分辨率实测三处**静默降级**。**落地**：① `scripts/ffmpeg-bundle.ts`（新）—— tag `b6.1.1` 四目标（darwin-arm64/x64、win32-x64、linux-x64）**sha256 内容级锁死** + 解压后体积/哈希/**容器架构嗅探**三重校验 + 幂等缓存（命中即离线复用，不重下）；② `scripts/fetch-ffmpeg.ts`（新）—— `--mac/--win/--host/--all` + `--dev`（把宿主架构那份镜像进未打包的 Electron 资源目录，让开发态与装机态解析同一条路径），`dist:mac|mac-smoke|win|win-portable` 与 `package:dir` 全部前置调用（缺了直接红，不静默降级）；③ `build.extraResources` → `Contents/Resources/ffmpeg/<平台>-<架构>/`（两架构**分路径**，且必须在 `mac.x64ArchFiles` 里**显式声明** `ffmpeg/darwin-*/**` —— universal 拒绝「两切片逐字节相同且未声明」的 Mach-O，见 plans §11；不在 asar 内可 spawn；在 bundle 内被签名公证覆盖）；④ `src/ffmpeg-run.ts` 新增**随包档**（`process.resourcesPath` + 模块祖先目录两路，纯 Node 下 `undefined` 自动跳过 ⇒ 不引入 electron 依赖，Host 保持 headless 可测），新顺序＝显式参数 → `FFMPEG_PATH` → **随包** → ffmpeg-static → PATH；错误文案改面向终端用户（删掉「brew install」这种把开发者步骤推给用户的话）；⑤ `scripts/after-pack.ts`（新）把运行时候选清单与**随包 ffmpeg 门禁**合成一个 afterPack：缺文件 / 体积不符 / sha256 不符 / 架构不符 / 缺 LICENSE 全红，并**真跑 `<bin> -version` 且判耗时**（<5ms 视为「没真跑」直接红）；⑥ 许可：随包带上游 `LICENSE` + `THIRD_PARTY_NOTICES.md` 与生成器新增「Bundled executables」段。**包体**：mac universal 单包 **+42MB**（拍板维持单包）｜**许可**：GPL-3.0-or-later 先落地（拍板），⚠️ 该构建 configure 含 `--enable-nonfree`，分发合规留 §7 待法务复核。**续（2026-09-18）**：mac universal 合并闸的**第五处红**已修 —— 根因**不是 ffmpeg**，是 MemOS 带入的 `better-sqlite3` 单架构 addon（addon 落在固定路径、路径里**没有任何 CPU 标记** ⇒ 旧守卫按标记筛、**静默漏检**）；修法是**打 fat addon**（新增 `scripts/better-sqlite3-addon.ts`：`prebuild-install` 取缺失架构 + `lipo -create` + `require()` 真跑）**而不是补一条 `x64ArchFiles`**（补声明只会让 Intel 切片带 arm64 addon 出厂、运行时 `dlopen` 失败），并把守卫改成 **universal 精确规则**（闭包内所有瘦 Mach-O 都要有交代，**fat 天然豁免**）。详见 [archive/plans/bundled-ffmpeg.md §13](archive/plans/bundled-ffmpeg.md#13-第五处红better-sqlite3-的单架构-addon2026-09-18)
- **涉及文件**：`dsh-plugin-desktop/scripts/ffmpeg-bundle.ts`（新）/ `scripts/fetch-ffmpeg.ts`（新）/ `scripts/after-pack.ts`（新）/ `scripts/verify-licenses.mjs` / `package.json`（extraResources + dist 前置 + afterPack）/ `THIRD_PARTY_NOTICES.md` / `canvas-studio/src/ffmpeg-run.ts` / `canvas-studio/tests/ffmpeg-bundled.test.mjs`（新）/ `dsh-plugin-desktop/tests/ffmpeg-bundle.spec.ts`（新）/ `start-canvas-studio.sh` / `docs/archive/plans/bundled-ffmpeg.md`

#### CV-200 · 启动脚本两处幂等判据指向幽灵路径 ⇒ 条件恒为真

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：`deepseek-harness/src/index.ts`（该子模块根**没有 `src/`**，源码在 `apps/`、`packages/`）与根 `node_modules/.bin`（Yarn 4 的 node-modules linker 只在各 workspace 内建 `.bin`）在本仓都不存在 ⇒ **每次启动都白跑一次联网 submodule 拉取 + 一次 `--immutable` install**，只吐一行「首次需联网」的误导输出。已改为 `deepseek-harness/package.json` 与 `node_modules/.yarn-state.yml`；实跑确认输出直达「快速启动」。**无 UI 验收**：判据守卫 `skills-single-source.test.mjs` 第 6 条（反向变异已验证能精确变红）+ 启动日志 `skills registered: 19 total, 0 description truncated`。
- **涉及文件**：`start-canvas-studio.sh` / `canvas-studio/tests/skills-single-source.test.mjs`

#### CV-199 · skill 内容源整合为单一事实源：删 skills-local/ + 删 sync 脚本 + 移除 minimax-h3 子模块

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。skill 内容原先来自两处（上游 submodule 逐字节同步 + `skills-local/` file-level overlay），`skills/` 是二者**并集**产物 —— 于是**事实源是悬空的**：`sync-minimax-skills.mjs` 在子模块缺失时 `console.warn` + `return`（退出码 0）、`minimax-skill.test.mjs` 带 `{ skip: !submodulePresent }`、`skill.test.mjs` / `music-prompt-writing.test.mjs` 两处**裸 `return`**（= 记 pass），四条路径都能在「事实源不在位」时保持 `# fail 0`；实测移走 `minimax-h3/skills` 后仍 8 tests → 7 pass / 1 skip / fail 0，而改了 `skills-local/` 的合并**静默不发生**。**取证先行（决定方案形状）**：核验 `skills/` 已**逐字节包含**原 `skills-local/` 全部 71 个文件（零差异零遗漏）⇒ 整合**不需要搬任何文件**，方向取**反转**（`skills/` 从「构建产物」升为**唯一手写源**）而非「把 14 件上游文件下沉进 `skills-local/`」——后者仓库里会留两份 85 文件副本（170 个），前者只剩一份，且**运行时零改动**（`MINIMAX_SKILLS_DIR` / `files: skills/**` / 打包与 `read` 寻址全不动）。**改动六件**：① `git rm -r skills-local/`（71 文件）；② 删 `scripts/sync-minimax-skills.mjs`，`build` 首步 sync → `node scripts/clean.mjs`（已核对 `clean` 只删 `lib/`，不碰 `skills/`）；③ 新增 `tests/skills-single-source.test.mjs` 五条门禁（`skills-local/` 与 sync 脚本不得存在 / build 首步不得含 sync / **源码·脚本·配置·根启动脚本零 submodule 名引用**〔剥块注释与整行注释后比对〕/ 8 件上游 `meta.yaml` 在位且带署名 / 5 件被正文引用的 references 在位）；④ **删掉三处静默绿出口**并翻正 8 个测试文件的路径与语义；⑤ **切断上游**：`.gitmodules` 删段 → `git rm --cached`（须先 stage `.gitmodules`，否则 git 拒绝）→ `git config --remove-section` → 目录与 git-dir 一并移出并转为**独立仓库**（`core.worktree` 须 `--unset`，否则 chdir 失败），`start-canvas-studio.sh` 与 `scripts/package.mjs` 两处 `--init --recursive` 改**只拉 `deepseek-harness`**；⑥ 六份文档同步（规范原则层改写）。**上游独有的 14 件**按「已在 `skills/` 内、保留是零动作」全部保留（8 件 `meta.yaml` 是上游署名唯一载体）。
- **涉及文件**：`skills-local/`（删除 71 文件）/ `scripts/sync-minimax-skills.mjs`（删除）/ `package.json` / `tests/skills-single-source.test.mjs`（新）/ 8 个测试文件 / `src/skills/minimax-skills.ts` / `src/index.ts` / `src/style-tokens.ts` / `.gitmodules` / `start-canvas-studio.sh` / `scripts/package.mjs` / `docs/skill-expansion-spec.md` 等 6 份文档

#### CV-198 · 节点内容复制到系统剪贴板

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（SSOT 补登：上一批已落地并提交，此前只存在于源码与验收台）。判定与文案收口在 `src/clipboard-copy.ts`（纯逻辑、可单测）；浏览器侧 `ClipboardEnv` 是**全仓唯一**碰 `navigator.clipboard` 的地方（守卫锁「唯一」这条），只做取资产 / PNG 重编码 / 写剪贴板三件事。实测依据 `scripts/probe-clipboard.mjs`（无头 Chrome）：`ClipboardItem` / `createImageBitmap` / `canvas.toBlob('image/png')` 全部可用，`toBlob` 产出真 PNG（magic `89 50 4E 47`）⇒ **不写** `new Image()` / `execCommand('copy')` 这类永远跑不到的降级分支；真缺能力时 `available()` 判 false，用户拿到「改用下载资产」这条明确的路。
- **涉及文件**：`src/clipboard-copy.ts` / `tests/clipboard-copy.test.mjs` / `scripts/probe-clipboard.mjs` / `scripts/preview-clipboard.mjs`

#### CV-197 · 节点类型的色彩身份

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（SSOT 补登：同上）。唯一判据 = `src/client/canvas/labels.ts` 的 `kindAccentOf`（画布侧只准**投影**、禁重算）；接线守卫 `tests/kind-visual.test.mjs`，行为验证在验收台 `scripts/preview-kind.mjs`。
- **涉及文件**：`src/client/canvas/labels.ts` / `src/client/canvas/CanvasNode.tsx` / `src/client/styles.ts` / `tests/kind-visual.test.mjs` / `scripts/preview-kind.mjs`

#### CV-196 · 质检与预检体验优化：视频预检「先修后拦」+ 语义规则降 WARN + qc_shot 放手跑自动跳过 + 回合末汇总纪律

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。用户反馈「生图/视频提示词校验太严 → 频繁重出图 + 红色报错刷屏」，诊断出两条主源：① `assertH3IrPrompt` 的 ~20 条 ERROR 里大量是**纯格式**（段间空行/围栏/对齐行时长）或**模型可容忍的语义**（handheld 等表外运镜词）问题；② qc_shot 每镜必检 + FAIL 原样重跑（只换种子，同样漂移重现）+ WARN 中断问用户。**改动（用户四项全选 + 追加：放手跑质检全关 / 报错改回合末汇总 / 后期质检让位前期关键词优化 / confirm 保留轻量闭环）**：① `h3-ir-validate.ts` 新增 `prepareH3IrPrompt` **确定性修复层**（剥围栏 / 首尾空白 / 段序归一 / 段间空行 / I2VA 对齐行重建与补齐 / FL2VA·L2VA 对齐行时长按 duration 重写——**只动格式不动内容**，结构不合法不猜），两个视频工具接入：修复后的 prompt 才进预检与后端，修复清单经 warnings 透明展示（`预检自动修复（不影响语义）：…`）；② **C1 表外运镜词 / T6 切镜动词 / D5 缺 [Language] 降 WARN**（D5 标签不配对仍 ERROR）——红错只剩结构错误（段缺失 / 标签未定义 / 模式错位），这些发出去必然浪费一次分钟级后端调用，保留 fail-fast；③ `qc_shot` 在 **auto 模式返回 `skipped=true`**（机器闸不靠提示词自觉；不调视觉模型、不烧预算、不写节点），**confirm 保留轻量闭环**；④ `consistency.md` 质检闭环重写：FAIL **修复式重跑**（drifts 转纠正指令追加 prompt，禁止原样重跑；同漂移项重复不烧第二次预算）、WARN 不中断只记录、**回合末「质检与预检汇总」**（修复项 / 软警告 / FAIL 记录与 exhausted / WARN 待确认，用户一次决策）、**前置自检代替事后质检**（发色/服装/道具关键词出图前显式写全）。测试 **681 → 689 fail 0**（修复层 7 条 + qc 跳过 1 条；C1/D5 旧 ERROR 断言随降级翻正）。
- **涉及文件**：`src/h3-ir-validate.ts`（prepareH3IrPrompt + 三处降 WARN）/ `src/host-tools.ts`（两视频工具接入 + qc_shot 跳过 + 描述同步）/ `src/quality-check.ts`（QC_AUTO_MODE_NOTICE）/ `skills-local/canvas-studio-creation/references/{consistency,toolchain}.md` / `skills-local/effect-test-runner/SKILL.md`（qc_shot 自动跳过备注）/ `tests/h3-ir-{validate,precheck}.test.mjs` / `tests/quality-check.test.mjs` / `docs/STATUS.md`

#### CV-195 · 补齐三条重放链路：music_generation / character_sheet / extract_last_frame

- **状态**：已修复·待验收（2026-09-17）（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：。CV-194 把「能不能重试」的判据从「有 `toolName` + 有 `generationPrompt`」收紧为 `isReplayable`（= `generateAsset` 真**有分支**可原样重放），由此暴露：这三类工具**从来只有写入路径、没有重放分支** —— 8 个既有节点（5 个 BGM + 2 张四视图 + 1 个抽帧）以前点「重试」只会被入口侧判据拦下（`该节点没有可重放的生成参数`），从未真的重放过。现状是**按钮不显示**（诚实，但功能缺失）。要做的是真补齐：① `generateAsset` 补三条分支（BGM 侧复用既有的 `planMusicRetry` 自愈 + `degradedFields` 告警）；② `REPLAYABLE_TOOLS` 扩到覆盖三者，`PROMPT_FIELDS_BY_TOOL` 按真参数形状给字段（四视图 / 抽帧无自由文本提示词 ⇒ `promptFieldsOf` 返回空是**正确态**，工具条只给「重试」不给「改提示词」）；③ 工具条与右键菜单的条件**自动跟随**（两处都走 `isReplayable`，零额外接线）；④ `tests/generate.test.mjs` 补三条重放契约、`scripts/preview-detail.mjs` 里「8 个节点不显示重试」的对照场景**翻正**（那条断言届时会红 —— 正是它该做的事）。**动手前必须先按 `docs/api.md` 逐条核对三个端点的参数名**（BGM 的 `caption_prompt` / `lyrics_prompt`、四视图的参考图槽位、抽帧的源视频与帧号），不要照旧的写入路径臆测。**✅ 2026-09-17 已落地**：按 `docs/api.md` 逐条核对参数后实现 `replayDetachedAsset` + `overwriteNodeAsset`（三条链路共用的原地改写出口），`REPLAYABLE_TOOLS` 扩到 7 项，`PROMPT_FIELDS_BY_TOOL` 对四视图 / 抽帧**返回空**（正确态：工具条只给「重试」不给「改提示词」）；工具条与右键两处条件零接线自动跟随；新增 `tests/node-replay.test.mjs` 8 用例（含双向守卫）。
- **涉及文件**：`src/generate.ts`（`generateAsset` 三条分支）/ `src/node-params.ts`（`REPLAYABLE_TOOLS` / `PROMPT_FIELDS_BY_TOOL`）/ `src/client/canvas/NodeActionBar.tsx`（判据自动跟随，预计零改动）/ `tests/generate.test.mjs` / `scripts/preview-detail.mjs` / `docs/api.md`（参数核对）
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**三类离线产物点「重试」无反应** —— `music_generation`（BGM）/ `character_sheet`（四视图）/ `extract_last_frame`（抽末帧）从来只有写入路径、没有重放分支（存量 8 个节点受影响：5 BGM + 2 四视图 + 1 抽帧）
  - **位置**：`node-params.ts`（`REPLAYABLE_TOOLS`）、`generate.ts`（`replayDetachedAsset` / `overwriteNodeAsset`）、`video-frames.ts`（`extractLastFrame`）
  - **修法要点**：✅ 2026-09-17：三条链路统一走「原地换一版」—— 抽 `overwriteNodeAsset`（清 `error` 残留、保 id / 位置 / 血缘 / 编组）+ `replayDetachedAsset`（snake_case 入参翻译，`retryOf` 必填，缺失报「只支持原地重试」）；BGM 换新音频文件、四视图复用原资产卡锚点 id（**不新开第二张卡**，卡被删则明确报错不静默降级）、抽帧重探时长后换末帧。+8 用例（含 `REPLAYABLE_TOOLS` ↔ `generateAsset` 分支的**双向守卫**）

#### CV-193 · 生视频编排优化：逐镜关键帧改「按需，默认不出」+ 参考组合「必须 ≥3 张」陷阱修复 + T10 双路线对照用例与 R002 直调首跑

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：。背景：用户以「竹林双人对打」例子推演发现，编排链路默认逐镜出关键帧（贵、且关键帧在 Ref2VA 路线里只剩姿态帧价值），而 skill 文本第 9 步本就「参考组合优先、不要求关键帧作首帧」——关键帧门成了纯开销。**改动（用户拍板 A+C）**：① 总纲第 6 步逐镜出图改「按需，默认不出」（仅构图/走位需钉死的镜出**姿态关键帧**作参考组合最后一席），6a 质检仅对出了的帧、6b 关键帧门改**条件门**（一张未出跳过直接进第 9 步；状态机核对：分镜批准后即 `executing`，`keyframe_review` 仅显式提交才进入，机制成立）；② **`video_composite` 参考组合「必须 ≥3 张」**——`capability.ts` 按数量判模式，恰 2 张会被解成「首帧+尾帧」走 FL2VA（定妆/场景语义跑偏且无告警；单角色场景 1 定妆 + 1 场景正踩中），shot-format / SKILL.md / consistency / toolchain / look 五处同步；③ **新增 T10 用例**（effect-test-runner）：Ref2VA 直出 vs 关键帧 I2VA 双路线对照，固定素材 3 张（`character-anchor-4view` / `character2-anchor-4view` 由定妆照经 `image2character` 派生、`bamboo-scene` 由 txt2image 生成）+ 金标准 prompt 逐字入库，`ProjectList.tsx` 一键用例 +T10；④ **T1/T1b fixtures 勘误**：预期「恰 2 张」是旧路由时代残留（R001 时 2 参考 → ref2va 正确，现行路由 2 张 = FL2VA），改 **≥3 张**；⑤ **R002 直调首跑（结构通过）**：A 路线 3 参考 → `image2videoref2va` ✅ 六段 6/6；B 路线关键帧 → 单图 `image2videofl2va` ✅；**运营发现：双路线服务端耗时 645s / 751s（@768p/8s）均超管线 `DRAMA_TIMEOUT_MS.video`（600s）**——历史同规格 130s，后端显著变慢，默认档当前任何路线都会被客户端超时掐断（缓解：草稿走 480p 或调超时）；B 帧灰袍角色与四视图锚点 image2vl 交集 100%、A 帧 25% 系归一化伪差（同件风衣标「风衣」vs「深蓝」）；人工目检：B 帧风衣男疑似马尾漂移、A 帧贴锚点——**路线优劣待人工并排评，结论决定关键帧门最终去留**。测试 681/681 fail 0
- **涉及文件**：`skills-local/canvas-studio-creation/`（SKILL.md + shot-format / consistency / toolchain / look）、`skills-local/effect-test-runner/`（SKILL.md + fixtures.md + assets×3 新增）、`src/client/ProjectList.tsx`（+T10）、`docs/effect-tests/视频效果验证测试用例与轮次记录.md`（T10 节 + T1/T1b 勘误 + R002 行）、`docs/effect-tests/runs/直调T10-R001/`（报告 + 产物）、`docs/STATUS.md`

#### CV-192 · 文生图提示词 skill 切换 Krea2 Turbo：新增 krea2-turbo-writing（旧 z-image skill 保留但加「已弃用 · 历史存档」转介）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：。后端 `txt2image` 已切 Krea2 Turbo（`krea2_workflow`，steps=8/cfg=1.0；CV-191 落文档）且 `txt2imageanime` 同模型（用户确认，产物前缀仍 `Z-Anime_*`、后端文档未更新）——但文生图运行时路由仍指向按 Z-Image-Turbo 特性写的 `z-image-prompt-writing`。**探针先行**（[api-probe/krea2-turbo-20260916](./api-probe/krea2-turbo-20260916/report.md)）：openapi `Text2ImageRequest` 仅 prompt/width/height（`negative_prompt` 被静默丢弃）+ cfg=1.0 负向条件结构性失效 + **A/B 实测**（同 prompt 负向「排除太阳/落日/橙色」仍画出太阳，image2vl 判图 A/B 两图一致）⇒「禁传 negativePrompt」规则沿用、理由从 Z-Image 换成 Krea2 证据；`image2character` 产物前缀 `krea2_char_4view_*` 印证 `krea2_quadview`（steps=10）。**skill**：新增 `krea2-turbo-writing`（九段式 / 负向→正向改写表 / 文字渲染引号锁定 / 画幅尺寸表骨架沿用，模型特性节按探针重写；anime 分支改「同模型、靠提示词表达画风」）；运行时路由改指新 skill：总纲 SKILL.md + prompt-writing.md（含 Z-Image 理由替换为 Krea2 实测表述）+ consistency.md + style-presets.md（工作流名 krea2_workflow）+ `krea2-edit-writing` 转介与 `krea2_quadview` 工作流名同步 + oriental-mythic 工作流名同步；`skill-catalog.ts` 补条目（双向断言防漏表）；sync 重建 `skills/`。**代码注释**：`generate.ts` anime / txt2image 两处旧工作流名（z-anime-aio / nunchaku-z-image-turbo）更新。**文档**：api.md txt2imageanime 勘误为 Krea2 Turbo + txt2image 补「negative_prompt 不生效」实测结论；api-usage 接线表同步。**验证**：build + typecheck ✓，测试 **681/681 fail 0**。
- **涉及文件**：skills-local/krea2-turbo-writing/（新）、canvas-studio-creation（SKILL.md + 3 分册）、krea2-edit-writing、oriental-mythic-visual-director、z-image-prompt-writing + qwen-image-edit-writing（存量转介补正）、src/skill-catalog.ts、src/generate.ts、docs/api.md、docs/canvas-studio-api-usage.md、docs/api-probe/krea2-turbo-20260916/（新）、docs/STATUS.md

#### CV-189 · image2image 参考槽位 3→4（后端切 Krea2 Edit 工作流）+ 新增 krea2-edit-writing 提示词 skill（旧 qwen skill 保留）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：。后端契约更新：`POST /api/v1/generate/image2image` 由 image1~3 三个具名槽位扩到 **image1~4 四个**（工作流由 qwen_image_edit_3_image_ref 换 **krea2_edit**，steps 固定 9、cfg 固定 1.0；留空的 image2~4 后端自动从工作流排除，建议至少提供 image1）。**代码**：`generate.ts` 截断上限 `slice(0,3)→(0,4)`（全仓唯一数量闸口 —— grep `slice(0,3)` 仅此一处，视频侧 ref2va 的 6 张与 fal 的 9 张上限无关）、CV-153 告警通道保留、文案与注释同步（保留 CV-153 历史脉络：当年「第 4 张静默丢弃」的教训升级为「第 5 张起显式告警」）；`host-tools.ts` 四处 agent 可见描述 —— image_generate 描述 + `filenames` 参数「最多 4 张」、`look_card` 由「锚点应取代 image3」改为「**占第 4 席（image4）**，挤占前 3 席会牺牲角色/场景参考位」、look 卡无锚点提示的槽位数。**skill（用户新增拍板：新增不替换）**：新建 `skills-local/krea2-edit-writing/SKILL.md`（内容沿用指令式四段式 / 分步链式 / 文字编辑引号锁定等核心规范 —— 这些写法对 Krea2 Edit 依然成立，技术路线改 Krea2 Edit 并补 steps/cfg、多参考分工扩到 4 张并给席位建议：1-2 角色身份 / 3 场景打光 / 4 画风材质），**旧 `qwen-image-edit-writing` 一字未动**；运行时路由三处改指新 skill —— `z-image-prompt-writing` 的「传了参考图改用…」转介、`canvas-studio-creation` 总纲 SKILL.md 的图像 skill 分流、`references/prompt-writing.md` 分册；`skill-catalog.ts` 补条目（双向断言：skills/ 下漏补表直接红、catalog 幽灵条目直接红，故旧条目保留是合法态）；sync 脚本重建 `skills/`（+ krea2-edit-writing local bundle）。**测试**：`generate.test.mjs` 两条 CV-189 契约 —— ① 4 张映射 image1~image4（新用例）；② 5 张输入截前 4：`image4='d.png'` + `image5` 缺失 + **断言 `result.warnings` 点名被忽略的 `e.png`**（旧断言「image4=undefined」随契约翻正）。**文档**：canvas-studio-tools（5 处）/ api.md（1 处）/ canvas-studio-api-usage（3 处，含旧工作流名与 steps=4→9 勘误）。**踩坑（编号纪律第 3 次现形）**：本批最初按 src 注释 grep 最高号只见到 CV-187 就用了 CV-188，动手前查 STATUS.md 才发现 CV-188 当天已被「视频侧分辨率实测」占用 —— 印证编号规则「**写号前先 grep 整个 `docs/`（含 STATUS.md），而非只 grep `src/`**」，全部引用就地改 CV-189
- **涉及文件**：`src/generate.ts`（slice(0,4) + 文案 + 注释）/ `src/host-tools.ts`（4 处描述）/ `src/skill-catalog.ts`（+krea2 条目）/ `skills-local/krea2-edit-writing/SKILL.md`（新）/ `skills-local/z-image-prompt-writing/SKILL.md` / `skills-local/canvas-studio-creation/SKILL.md` + `references/prompt-writing.md` / `skills/`（sync 重建）/ `tests/generate.test.mjs`（2 条契约翻新）/ `docs/canvas-studio-tools.md` / `docs/api.md` / `docs/canvas-studio-api-usage.md` / `docs/STATUS.md`

#### CV-188 · 视频侧「声明的分辨率 ≠ 真实产物」修复：落盘改用 ffmpeg 实测像素（不猜）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。CV-187 遗留的残余缺陷 —— Drama 视频真实产物**恒 864×480**（`megapixels` 固定 0.4），而节点按档位落盘 `mediaWidth/mediaHeight`（默认档 1376×768）⇒ **详情面板给每个视频显示一个假数字**，且这个假数字会**静默**跟着错（客户端 `StudioFrame.handleMediaNatural` 只在 `mediaWidth === undefined` 时用自然尺寸回填 → **已写入的错值永不被纠正**）。CV-187 留的两条修法（① 后端认 1.0 ⇒ drama 按档发 megapixels；② 不认 ⇒ drama 声明恒取 `OUTPUT_SIZE['480p']`）**都是在猜后端会输出什么**，且都要等 P0-d gate —— 而 gate 因后端不可达一直悬着。**改走第三条：不猜，落盘时实测。**`ffmpeg -i` 的 stderr 里本来就有视频流分辨率（`parseFfmpegStreams` 早已在解析它，只是此前只给末帧抽取用），而 CV-140 起每次视频落盘**本来就会跑一次** `ffmpeg -i` 探时长 ⇒ **同一次调用多读一行，零额外开销**。实现：`ffmpeg-run.ts` 新增 `probeMediaInfo(path) → { duration, width?, height? }`，`probeMediaDuration` 降为它的薄封装（同一份实现，不另写一遍探测）；`generate.ts` 落盘段引入 `mediaSize`（实测成功取实测、失败回退声明值），节点 `mediaWidth/mediaHeight` **两处**与工具返回值 `width/height` 一起改口径。**结论：`drama.ts` 依旧不动**（P0-d 未证实），而「声明 ≠ 真实」已经修掉 —— 修在**落盘侧**，不在请求侧。**三个刻意选择**：① 探测失败**不新增 warning**（时长与分辨率出自同一次探测，失败时时长侧那条已经说了「探测不可用」，再加一条是把同一件事说两遍）；② **图片侧不引入探测**（P0-c 已证实逐字节按请求出图，探测属无收益有开销）；③ 节点框仍按**声明值**算比例（档位间比例差 <1% = 0.46%，低于客户端 5% 校正阈值）。**顺带改正两处工具描述**：`resultSchema` 的 `width`/`height` 从「宽度（像素）」改写为「视频为 ffmpeg 实测的真实产物像素，要判断实际出了多大以此为准」（此前 agent 无从知道那是真值还是声明值）；`warnings` 描述里残留的「占坑参数 model/**resolution**/generateAudio」一并更正（`resolution` 自 CV-187 起已非占坑）。**守卫（新增 I / J 两组）**：J 组验 `probeMediaInfo` 的双输出与「失败只回 `duration: 0` + 尺寸字段缺失 + 不抛」；I 组端到端 —— 桩产物是**真 864×480 mp4**、不传档位（默认 768p）⇒ 断言落盘 `mediaWidth/mediaHeight` **必须 = 864×480**，且 `notDeepEqual` **明确排除** `OUTPUT_SIZE['768p']`。**反向验证已执行**：注释掉实测采纳 ⇒ **I 组红（`not ok 10`）**，恢复后复绿。**踩坑（已写进 dev 文档）**：`findRealFfmpeg()` 若只调 `resolveFfmpegPath()` 会在本机返回 null 并**静默软跳过**（用例显示 `ok` 但耗时 **0.5ms**）—— 两种常见原因**都不代表本机没装 ffmpeg**（进程 PATH 被裁剪 / `ffmpeg-static` 只落了包壳、二进制未下载），故补一层常见安装位置探测；**判据：I/J 组耗时应约 90ms，< 5ms 即跳过（空绿）**。另已确认**生产侧可用**：登录 shell 的 PATH 含 `/opt/homebrew/bin`、`start-canvas-studio.sh` 继承之 → Electron 子进程能解析到 ffmpeg ⇒ **不**在 `src/` 加路径兜底（那会掩盖「PATH 没配好」这件事）。验证链全绿：**679/679 fail 0**（+2），预览台 25 组全过
- **涉及文件**：`src/ffmpeg-run.ts`（+`probeMediaInfo` / `MediaInfo`，`probeMediaDuration` 改薄封装）/ `src/generate.ts`（`mediaSize` 三处口径 + import）/ `src/host-tools.ts`（`width`/`height`/`warnings` 描述）/ `tests/resolution-tier.test.mjs`（+I/J 两组 + `findRealFfmpeg` 兜底）/ `docs/archive/plans/resolution-tier-dev.md`（§3.3.1）/ `docs/STATUS.md`

#### CV-187 · 分辨率三档分级（480p / 768p / 2k）：删隐式升档 + 图片侧首次获得档位 + 默认改 768p

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。起点是用户提供的参考稿 `docs/archive/resolution-tier-guide.md`，要求「整理成需求文档 + 开发计划」。**核对参考稿：7 处行号全准，但有 3 处会真出事** —— ① **会崩**：`resolution` 随 `generationPromptOf` 原样落进画布节点（只摘 `retryOf`），所以**真实历史节点里存着 `720p`**；按参考稿删掉该键后老节点重试会查表得 `undefined` → 取值处 TypeError → **重试直接崩**。修法与画幅侧既有先例同构（`drama.ts` 的 `dramaAspect()` 处理历史 `1:1`）：新增 `normalizeResolution()` 就地归一（`720p→768p`、`1080p→2k`，与旧升档行为**等义**故不回 warning；认不出的返回 `undefined` 不传）。② **参考稿把两件事写成一件**：视频侧是「枚举收窄 + 删升档 hack」，图片侧是「一个全新维度」—— 后端契约本就不同（`api-usage.md`：图像类收 width/height 像素，fl2va/ref2va 收 aspect + megapixels，「两种风格不要混传」）。③ **漏了 2 个必红测试**（`generate.test.mjs` 的 `mediaWidth=1280`、`video-provider-fal.test.mjs` 的升档断言）+ 命令勘误（参考稿的 `yarn test` 不存在，实际是 `test:smoke`）。**取值结案**：三档 = **H3 官方推荐分辨率表的 0.4 / 1.0 / 2.0 三行**（用户补充该表后，从「反推占位值」变为**有出处**）：864×480 / **1376×768** / 1920×1088，宽高**均为 32 的倍数**，9:16 反宽高、1:1 三档共用 1024×1024。**P0 真机实测（新增 `scripts/probe-resolution-tiers.mjs`，产物 `docs/api-probe/resolution-tier-1789462074585/`，真实像素一律 ffprobe 量出）**：**① 图片端点逐字节按请求出图** —— 五个合规尺寸全部一致（1280×720 / 864×480 / 1376×768 / 1920×1088 / 768×1376）⇒「声明 = 真实」在图片侧成立；**② 错尺寸不报错、只静默取整** —— 请求 `1400×780` 实得 `1400×776`：后端按 **8** 对齐（不是 32），即「尺寸错了不会失败，只会悄悄给你另一个尺寸」（三档全 32 倍数，两道都满足，守卫取更严的 32）；**③ 480p 提速是真的** —— 5.3 s vs 14.5 s vs 32.7 s（约 1 : 2.7 : 6.2）；**④ `megapixels=0.4` 实测 864×480、耗时 130.8 s**，与 H3 表第一行逐字吻合。**⑤ P0-d 未证实（本轮唯一的坑）**：`megapixels=1`/`2` 双双 `fetch failed`（无 HTTP 状态 = 连接级失败），随后的对照复测（`0.4 → 1 → 0.4`，含对照位）在第一个 0.4 上就没返回、进程退出，再测 `health` 得 `HTTP 000` —— **后端整体不可达** ⇒ 无法区分「后端拒收 1.0/2.0」与「后端在长任务压力下自行崩溃」。**故 `drama.ts` 本轮不动**（`MEGAPIXELS` 保持 0.4）：在证实之前发未经验证的请求体，若真是前者就是每次生成都打挂后端。**残余缺陷（已单列，未修）**：Drama 视频真实产物恒 864×480，而节点按档位落盘 `mediaWidth/mediaHeight` ⇒「声明 ≠ 真实」在 **Drama 视频**上依然存在（图片侧已解决）。修它有两条路（后端认 1.0 ⇒ drama 按档发 megapixels；不认 ⇒ drama 侧声明恒取 `OUTPUT_SIZE['480p']`），**两条都先要实测**。**顺带修掉一处既有缺口**：`COMPOSED_FALLBACK` 从硬编码 `1280×720` 改为与默认档同源（`OUTPUT_SIZE[DEFAULT_RESOLUTION]`）。**设置层**：新增「默认分辨率」下拉；原有「视频质量（待接入）」改名**「导出质量（待接入）」**并加 hint 撇清（那是成片码率，**不复用**同一字段 —— 一个字段两个语义，导出管线接入时必然要拆回来）。**验证**：整链全绿（sync → tsdown → tsc Host emit → tsc client dts → verify:loader），**677/677 fail 0**，预览台 **25 组全过**；**G 组反向验证两条都能红**（`LEGACY_RESOLUTION` 置空 → B 组红；`OUTPUT_SIZE['2k']` 改 1920×1080 → H 组红），恢复后复绿。**为什么 H 组（表-码对齐守卫）必备**：`OUTPUT_SIZE` 是「声明 = 真实」的唯一落点，把它改成 1920×1080（看起来更「标准」）之后**全仓其余断言照样全绿**，只有画布多看几 px + 详情面板数字变假 —— 这类静默失败只有断言拦得住，且期望值硬编码自 H3 表、不引用实现
- **涉及文件**：`src/config.ts`（`OUTPUT_SIZE` / `DEFAULT_RESOLUTION` / `isVideoResolution` / `sizeForAspectRatio` 加档位参数）/ `src/providers/types.ts`（枚举收窄 4→3）/ `src/providers/fal.ts`（三档直通 + `LEGACY_RESOLUTION` + `normalizeResolution()`，删升档 hack）/ `src/generate.ts`（`resolutionOf()` 档位决策：工具参数 > 全局设置 > 默认；档位驱动像素）/ `src/host-tools.ts`（两处视频 enum/描述提成共用常量 + `image_generate` 新增 `resolution` + `COMPOSED_FALLBACK` 同源）/ `src/host-config.ts` / `src/index.ts` / `src/client/SettingsModal.tsx` / `tests/resolution-tier.test.mjs`（新，A~H 组）/ `tests/generate.test.mjs` / `tests/video-provider-fal.test.mjs` / `scripts/probe-resolution-tiers.mjs`（新）/ `docs/archive/plans/resolution-tier.md` / `docs/archive/plans/resolution-tier-dev.md` / `docs/api.md` / `docs/canvas-studio-api-usage.md` / `docs/canvas-studio-tools.md` / `docs/plans/video-provider-abstraction.md`（§5.3 勘误 + Q2 推翻）/ `skills-local/canvas-studio-creation/references/toolchain.md` / `skills-local/z-image-prompt-writing/SKILL.md` / `plan.md` / `docs/STATUS.md`

#### CV-186 · 血缘压暗恢复：判据重做（距离三档）+ 生命周期改绑手势

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。用户要求把 2026-09-13 退场的「拖动时压暗血缘较远的节点」加回来。**退场真因复盘（CV-162 立 / CV-170 修 / CV-171 退）**：**① 判据在真实数据上几乎恒为真** —— 旧 `active = lit.size > selected.size`，实测 18 节点的「凌晨三点的门外人」选中任意节点都会压暗 **9~16 个**（连零血缘的「创意」也压暗 11 个：6 个下游被点亮 ⇒ `7 > 1` 成立）；**② 生命周期绑错了对象** —— 压暗挂在**选区**上，而选区全仓十几处写入点（生成完成 / 附件旁路 / 轨道点击 / 切项目…），漏一处就永远恢复不了，这才是「松手不恢复」的机制性原因；**③ 尺度** —— 原口径「1 跳亮 / 其余压暗」平均压暗 **68%**、53 个拖动目标里 **39 个 >70%**（最差 91%）→ 用户读到「一点就整屏变灰」。**恢复方案（用户四问全按推荐拍板）**：**仅拖动时生效**（手势态 `spotDragIds`，写入点在 `onPointerMove` 的**首次真实位移** → 单击/按住不闪灰；出口只有 `pointerup`/`pointercancel`/`pointerleave` 三条）；**距离三档 A1**（以被拖簇为起点双向 BFS：1 跳亮 / 2 跳 `.csNodeNear` `--cs-dim-near` **0.75** / ≥3 跳与无关 `.csNodeDimmed` `--cs-dim` **0.42**）；**两道安全阀**（① 被拖簇之外无 1 跳邻居 → 整体不启用；② 中间档覆盖 >70% → 整体退亮档）；**托盘与成员同档**（托盘自身无血缘，按自己距离判档会把装着来源图的托盘压暗 → 取簇内最亮档；不加这条时真画布上「托盘与成员落进不同档」出现 **22 次**）。**三口径实测对照**：A0 平均 68% / 最差 91% / 39 个 >70% → **A1 28% / 65% / 0 个** → A2（只压无关）12% / 20% / 0 个
- **涉及文件**：`src/canvas-lineage.ts`（`canvasSpotlight` 重写：`hopDistances` 双向 BFS + `containmentCluster` + 两道阀）/ `src/brand.ts`（`--cs-dim-near` 0.75）/ `src/client/styles.ts`（`.csNodeNear` + `.csNodeDimmed`）/ `src/client/canvas/CanvasNode.tsx`（`dimmed` → `tier`）/ `src/client/canvas/CanvasSurface.tsx`（`spotDragIds` 手势态 + `tierOf` 投影）/ `tests/canvas-lineage.test.mjs`（重写 13 用例）/ `tests/visual-tokens.test.mjs`（反向守卫翻正）/ `scripts/preview-spotlight.mjs`（新，含独立 ORACLE）/ `scripts/verify-previews.mjs`（+1 组）/ `scripts/probe/drive.mjs`（断言 6c 更正 + 新增按下不压暗）/ `docs/STATUS.md`

#### CV-185 · 「整理布局」按视口整形（列宽按列自适应 + 行数上限开子列）+ 适配视野的可读下限

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。用户问「整理布局点下去怎么工作、有没有优化空间」—— 量出来的问题是**两张真画布上它基本失效**。**① 排布形状与画布形状毫无关系**：原来「一个深度一条列、列内不限行」，而真实画布 `测试音乐` 的 23 个单元**全在 depth 0**（21 张分镜卡 + 2 条 BGM）→ 排出 **768×6452 的细长条**，占用率 35%，适配比例撞到缩放下限 **0.1**（`canvas.json` 存的就是 0.1 —— 打开项目是一片看不清的缩略图）。**修法两处**：**列宽按列自适应**（改前取全局最大单元宽 —— 一张 996 宽的托盘把**所有**列一起撑开：`验收新建项目` 的盒子因此多 1248px 宽，适配 0.322 → 0.363）；**列有行数上限、超了往右开同深度相邻子列** —— 上限 R 由**搜索**挑（目标函数 = 预测适配比例最大，即让排完的盒子贴近视口形状），下界 `ARRANGE_MIN_ROWS = 3`（放开到 1 会把 3 个同层节点摊成一排、列的意义消失，且实测不改善比例）。子列只在同深度内开、且相邻有序 → **「越深越靠右」仍严格成立**（预览台在屏幕上复核过）。**② 适配不再「为了全塞进去一路缩到看不清」**：新增 `FIT_MIN_SCALE = 0.3`（低于它 260px 的卡只剩不到 78px，卡面分不出是图还是文字），缩到下限就停 + **必须出声**（提示「内容较多…视野外还有节点」，同签名只报一次；打开项目时的自动适配不打扰）—— 不说这句，用户会把「只看到一半」读成「节点丢了」。适配数学同步**收口成纯函数 `computeFitView`**（原来写在 `CanvasSurface` 的 JSX 里：既没法单测、整理布局也没法引用），`viewportSize()` 由画布交给排布。**实测（三张真画布，视口 1160×700）**：适配比例 **0.100→0.433** / **0.322→0.415** / 0.184→0.263；包围盒占用 **35→60% / 29→52% / 31→53%**；无关节点重叠 0
- **涉及文件**：`src/canvas-view.ts`（列宽/行数搜索 + `computeFitView` + `FIT_MIN_SCALE`/`FIT_PADDING`/`CanvasViewport`）/ `src/client/canvas/CanvasSurface.tsx`（适配改调纯函数、返回 `FitResult`、新增 `viewportSize()`、`onFitClamped` 回调）/ `src/client/project-store.ts`（`autoArrange(projectId, viewport?)`）/ `src/client/StudioFrame.tsx`（传视口 + 被下限挡住时提示 + 打开项目时不打扰）/ `tests/canvas-arrange.test.mjs`（新 9 用例）/ `scripts/preview-arrange.mjs`（新，预览台）/ `scripts/verify-previews.mjs`（+1 组）/ `docs/STATUS.md`

#### CV-184 · 新节点落点收口（单一实现 + 无血缘冲突检测）+ 生成后把新节点带进视野

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。用户问「新生成的节点放到画布上的逻辑是什么？『整理布局』点下去怎么工作的？有没有优化空间」—— 讲解时当场量出两个问题。**① 落点规则散成 4 份**：`generate.ts`（唯一带冲突避让）、`compose.ts`（`const index = existing.length` 盲排）、`client/index.ts`（占位节点）、`client/project-store.ts`（`LAYOUT` 常量，5 处消费）各自维护 origin 40 / step 300×240 / 4 列 / 血缘右侧 60px；**无血缘分支一律「盲取 index」** → 第 20 张图固定落在 `(40 + 19%4×300, 40 + ⌊19/4⌋×240)`，而那一格早被占了 → 用户看到的「成片压在别人身上 / 一堆图叠成一摞」（`generate.ts` 当年单独打了避让补丁，另外三处漏了）。**修法**：新建 `src/canvas-placement.ts` 作为**唯一权威** —— `PLACEMENT_GRID` / `PLACEMENT_GAP` / `PLACEMENT_STEPS` / `PLACEMENT_SCAN` + `boxesOverlap`（**半开区间**，正好相邻不算撞）+ `deriveNodePlacement`（两分支**共用同一份 `clashes`**；无血缘改为**从 `nodes.length` 起扫描第一个不重叠格**，上限 256 格）+ `placeSequence`（批量落位推进占用，帧序列不再自己算步长）；四处调用点全部改 import、`LAYOUT` 删除、`tsconfig.client.json` include 补新模块（client 引根级模块的既有要求）。**② 生成完看不见生成物**（用户原话「生成完之后不知道去哪儿了」）：`src/canvas-view.ts` 新增纯函数 `revealOffsetOf(box, view, viewport, padding=48)` —— **只返回 dx/dy、永不改 scale**；框比视口还大且已相交则**不动**（否则会把用户的缩放顶掉），完全在视口外才居中；`CanvasSurface.revealNodes(ids)` 经 `onViewChangeRef` 同 scale 平移并挂进 `CanvasSurfaceHandle`，**手势进行中（`gesture.current.mode !== 'none'`）直接返回**（生成回包正好落在用户拖动时不能把视口拽走）；`StudioFrame` 的 `seenNodeIdsRef` 做**集合记忆**，只对「首次出现 + 非 pending + 非 brief」的节点触发（撤销/重做老节点不抢视口，占位节点不算生成完成）。**搁置项（用真实 28 节点链条量出来的，不是拍脑袋）**：「镜次×阶段矩阵」C1 让 fit-scale **0.201 → 0.179 反而更差**，且 `StudioCanvasNode` **没有 `shotIndex` 字段**（要改数据契约、动 wire）→ 用户拍板**先搁置**；「格子列内自适应」B1 单独做 **0.201 → 0.201 毫无改善**（瓶颈在高度不在宽度），只有 B2（按包围盒贴近视口）有效 → 与 B3（不再无条件缩放）一起排第二批
- **涉及文件**：`src/canvas-placement.ts`（新）/ `src/generate.ts` / `src/compose.ts` / `src/host-tools.ts` / `src/video-frames.ts` / `src/client/index.ts` / `src/client/project-store.ts` / `src/canvas-view.ts` / `src/client/canvas/CanvasSurface.tsx` / `src/client/StudioFrame.tsx` / `tsconfig.client.json` / `tests/canvas-placement.test.mjs`（新 9 用例）/ `docs/STATUS.md`

#### CV-183 · 托盘拖动时里面的图片「消失」（松手又回来）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：。用户报「拖动画布上的托盘进行拖动的时候，上面的图片会消失，松开的时候图片又会显示出来」。**先核事实**：这不是拖动逻辑丢数据（`moveNode` 的 `parentId` 跟随规则在，成员坐标一直跟着走），也不是透明蒙层 —— 是**层叠**。**成因三段**：① `.csNodePrimary.csNodeSelected { z-index: 3 }`（CV-089）把「被拖动的卡」置顶，免得被别的选中卡的外光晕压住 —— 这条本身没错；② 托盘是**容器**，成员是画布层的兄弟节点，常态靠 `compareNodes` 把托盘排在 zIndex 最低一位（`groupSelected` 给 `min(成员 zIndex) - 1`）画在下面；③ 托盘卡身是**不透明**的 `--cs-node` → 按住托盘时 `setPrimaryDragId(group.id)` 让它 z-index 从 `auto` 跳 **3**，整张成员图被自己的容器当场盖住（渲染台实测：成员图中心的 `elementFromPoint` 由「成员」变「托盘」，卡身 `rgb(30, 34, 48)` alpha = 1）。**修法**：托盘豁免 z-index、保留描边 —— 新增外层标记类 `csNodeTray` + `.csNodeTray.csNodePrimary.csNodeSelected { z-index: auto }`。⚠️ **别名陷阱**：内层那个布局 div 叫 `csNodeGroup`，CSS 选的是外层，两者名字接近但挂在不同元素上（守卫按行断言，防「标记类挂到内层 = 规则静默变死代码」）。**取证手法（本批最值得留存的部分）**：静态守卫只能锁「规则在不在、类挂没挂」，锁不住**层叠结果**（DOM 顺序反了、被更高特异度压过、卡身改成半透明，源码里全都「看着对」）→ 新建 `scripts/preview-tray.mjs`，把 `elementFromPoint` 那一问（成员图上这一点最上面是谁）做成 13 条断言、明暗双轨，并**故意留一组未修复对照**（场景 B：有 `csNodePrimary`、无 `csNodeTray`）——**它必须红**，否则说明台子没有分辨力
- **涉及文件**：`src/client/styles.ts`（+豁免规则）/ `src/client/canvas/CanvasNode.tsx`（+`csNodeTray`）/ `src/client/canvas/CanvasSurface.tsx`（注释）/ `tests/group-tray.test.mjs`（+CV-183 守卫）/ `scripts/preview-tray.mjs`（新）/ `scripts/verify-previews.mjs`（+1 组）/ `docs/STATUS.md`

#### CV-182 · 新建项目对话框精修 + 顺带查出的播放弹窗标题栏回归 + 首屏「跟正式画布和谐」（DD-10，三处一起）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：。用户拿着两张截图提两条（「新建页面优化一下」「第一个对话也重新设计一下，整体高大上、跟正式画布和谐一些」），**落地时查出旁边躺着一处更严重的问题**。**① 回归（本批真正的技术内容）**：`.csModalHeader` / `.csModalClose` 在提交 `df8ad3b2b5`（「设置页扩展」）里被当成 legacy 类名写成 `display: none` —— 而它们不是 legacy：三个播放弹窗（VideoPlayerModal / AudioPlayerModal / ImagePreviewModal）的标题与关闭键全挂在上面，于是**用户看片时不知道在看哪条、也关不掉（只能点遮罩）**；VideoPlayerModal 的 `max-height: calc(100vh - 140px)` 注释还明写「扣除标题栏(49)」—— 那 49px 一直预留、从来没画出来。CV-092 的新建对话框当时「不想要标题栏」的做法是**关掉一个全局类再共用它**，于是连带关掉了别人（只有一处消费方时看不出问题，第二处出现就已经错了）。**修法**：恢复两个类（可见 + 28px 方形关闭键），新建对话框改用独立一组 `.csCreateHead` / `.csCreateClose`（视觉同源、类名独立），并加**双向守卫**（① 那两个类不许再被关掉且有消费方；② 新建对话框不许再回挂共享类 —— 只守一边都拦不住「再关一次全局」）。**② 对话框精修**：加标题栏（accent 立柱 + 标题 + 副行「三项都可以留空 —— AI 会在对话里跟你确认」+ ×）—— 「三项都能留空」此前**没有任何地方告诉过用户**，三个字段看着都像必填；分组下拉的 emoji + 原生箭头换成内联 SVG + 自绘箭头收进同一个字段盒（原生箭头各平台不同，macOS 那个蓝箭头尤其抢戏）；画幅 / 目标时长两个**封闭小集合**（4 枚 / 5 枚）由原生 select 改 **chip 组**（一眼看全、一点即选，此前要求「展开 → 瞄一眼 → 点下来」），选中态读 `aria-pressed` 而不是另挂类名（语义照进 DOM，不会出现「类挂了但属性没同步」）；字段间距 14→18px。**③ 首屏**：题目里的「不和谐」**不是**宿主那张 hero —— 「✦ 探索未至之境」+「预览版」徽标全在 `deepseek-harness` 的 CSS Modules 里，插件改不了；不和谐的是**我们自己那张对话卡**：`.csLobbyHero` 早已铺了点阵 + accent 光晕，而同一屏的 `.csChat` 还是宿主 `bg-layer-1` + 1px 描边的**白盒子**，两张材质不同的面并排读起来像两个产品。改成同一份画布配方（`--cs-canvas-bg-l1` + 顶部光晕 + 120/24 双层点阵 + `--cs-line` 描边 + `--cs-shadow-2`），与 `.csLobbyHero` / `.csCanvasSurface` 逐参数同源。**④ 中栏「开拍前条」（本批唯一新增内容）**：lobby-pending 时中栏第一行本来什么都不渲染，用户看不到这个项目锁了什么规格、走到六段哪一段；而 work 态同一位置是有东西的（工具栏 + 工作流条）→ 补一条同位置的带子（状态词「待开拍」胶囊 + 项目名 + 规格 + 阶段胶囊），与输入区读数带**同一个判定入口**（`deriveProjectContextView`）与**同一份拼装**（新抽 `specPartsOf` / `contextTitleOf`，两条带子共用 —— 各拼一份必然漂移）。**渲染台（新预览组 `preview-create.mjs`，明暗双轨 48/49 条断言）当场抓出三个静态检查看不见的问题**：① 字段盒比输入框**高 2px**（盒内控件 padding 写成 8px，而描边只出一次 → 三个字段盒边对不齐）；② 对话卡因 `margin: 0 0 12px` + `align-self: center` 在行内**溢出 6px**，把开拍前条的底边框压掉中间一段（此前第一行为空，看不出来 —— 是 DD-10 把这条旧账变成了可见缺陷）；③ 预览台自己写的「各 5 枚 chip」与真实代码（画幅 4 枚）不符。两条真问题已修（控件 padding 7px 对齐输入框；卡片改 `height: min(560px, calc(100% - 24px))` + `margin: 12px 0`，让 margin 盒恰好等于行高、居中无余数）。**验证**：`644/644 fail 0`（+10）、预览台 **19 组全过**（新增 1 组，明暗双轨）、**反向验证 11 探针各自能红**（含「把卡片退回白盒子」「接线退回 return null」「字段盒 padding 改回 8px」）
- **涉及文件**：`src/client/styles.ts` / `src/client/ProjectList.tsx` / `src/client/SlateBar.tsx`（新） / `src/client/StudioFrame.tsx` / `src/project-context.ts` / `src/brand-copy.ts` / `scripts/preview-create.mjs`（新） / `scripts/verify-previews.mjs` / `tests/visual-tokens.test.mjs`（+7 守卫） / `tests/project-context.test.mjs`（+3 用例） / `docs/STATUS.md`

#### CV-181 · 视觉升维收口 · E 区三解（删死样式 / 悬空分组回落 / 孤儿会话撤修）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（① 整屏欢迎卡 8 类 + 3 条子规则从无 JSX 消费方 → 删除；`.csWelcomeSample` 独立版被 `.csLobbyActions` 版字节级完全覆盖，一并删除。连带：`--cs-accent-deep` / `--cs-fs-2xl` / `--cs-shadow-3` / `--cs-space-7` 的唯一消费方就是这张死卡 → DD-06「顺带接线空转的 deep」实际未生效；四者均为成套尺度成员，登记进空转基线并注明批次，不硬删 brand.ts。② 左栏分桶收口到纯函数 `resolveVisibleSections`，悬空 `groupId` 回落未分组（旧实现两个桶都不收 → 卡片静默消失）。③ 孤儿会话**取证后不修**：`workspace.json` 条目 0、`latestResumableSession` 按 workspace 过滤 → 不可能恢复；残留属宿主侧会话列表，插件无 delete 权限。验证 633/633 fail 0（+8）+ 预览 17 组 + 反向验证 5 探针能红）
- **涉及文件**：`src/project-sections.ts`（新） / `tests/project-sections.test.mjs`（新 7 用例） / `src/client/ProjectList.tsx` / `src/client/styles.ts`（净删 ~2.5KB 死样式） / `tests/visual-tokens.test.mjs`（+2 守卫 + 空转基线首 4 项） / `docs/STATUS.md` / `docs/visual-direction-ui-closeout.md`

#### CV-180 · C3「真波形」其实一直是降级条：Host 侧 PCM 字节上限把可解码时长锁死在 12.8 秒

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（桌面验收 C 区「BGM 轨是真波形（不是伪随机）：两首不同曲子长得不一样」一条报「不确定，感觉没实现」）。**根因可复算**：旧实现把整段 PCM 收进 Buffer 并设 `MAX_PCM_BYTES = 200KB` 上限，而 8kHz s16le 单声道 = 16KB/秒 → **只能解码 12.8 秒**；BGM 基本都超过这个长度 → ffmpeg 被强杀 → 路由返 400 → 客户端 `use-waveform.ts` **静默**退回确定性降级公式，真包络一次都没上过屏幕（不是「没实现」，是「实现了但永远走不到」）。**修复**：改为**流式取峰切片** —— 解码过程中每 250 样本（31.25ms）取一个真峰，内存只与时长有关（每秒 32 个数）、与字节数无关，上限抬到约 35 分钟；短音频也不退化成平线（32 片/秒 远细于最终 96 桶）。**反向验证**：把上限压回 12.8 秒等价（409 片），新增的 20 秒用例当场红，错误正是「音频过长，超出波形解码上限」；同批新增形态守卫钉住「不得再设 PCM 字节上限 / 不得整段缓存 PCM」。验证链全绿：sync / tsdown / tsc Host emit / tsc client dts / verify:loader ✓，**625/625 fail 0**（+2），预览台 17 组全过
- **涉及文件**：`src/waveform-host.ts`（流式切片取峰，撤 `MAX_PCM_BYTES`） / `tests/waveform.test.mjs`（+2 用例） / `docs/STATUS.md`

#### CV-173 · 视觉升维 DD-08 左侧栏（「工具面板 → 制作现场」第五批）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：方向见 [visual-direction-plan.md](./visual-direction-plan.md) §3 DD-08、工程清单见 [visual-direction-execution-plan.md](./visual-direction-execution-plan.md) §3 DD-08（子批 R0~R8 + 拍板记录）。**这是 DD 系列的盲区，不是「没做好」** —— 收口清单划的验收分区 A 空间 / B 节点 / C 时间轴 / D 工作流 / E 首屏**一个都没覆盖左栏**，所以左栏整块还停在宿主令牌 + 裸值阶段。**改前实测**（左栏区段 `styles.ts:576-1240`）：`--cs-*` 仅 **4 个**、`--dsw-alias-*` **72 处**、`--cs-space-*`/`--cs-radius-*` **0 次**（brand.ts 里明明有 7 档间距 + 4 档圆角）、裸 `font-size` **7 档**（10/11/12/13/14/15/16）。**三处结构性问题**：① **层级倒挂** —— 分组名 13px/600 比项目名 13px/500 更响；② **行内原生 `<select>`**（`.csProjectMove`）在暗色壳上渲染成常驻亮底浮块 —— **截图里那个灰盒子就是它**，整栏最丑的一处；③ **三枚全宽虚线按钮**同样响，栏内最响的元素承载最次要动作，还混了一个 dev 自测入口。**改动**：① **R1 令牌收口 + 层级反转**（字号 7 档→3 档走 `--cs-fs-*`、间距走 `--cs-space-*`、圆角走 `--cs-radius-*`，组头降到 11px 次级色、项目名回主级；hover 底改 `--cs-shell-2`、线改 `--cs-line`；**删两条死规则** `.csProjectSettings` / `.csProjectFormInline`，全仓零消费者）；② **R2 菜单取代 select**（`⋯` 按钮 + 菜单，**复用画布既有 `.csContextMenu` / `.csMenuAction` 家族**，不新造第三套；关闭语义沿用 CV-167 的 `pointerdown` 结论；新增 `src/client/ProjectRowMenu.tsx`）；③ **R3 项目行 → 项目卡**（34px 首字母封面 + 名称 + 副行三段：**阶段词** 与六段轨道同源 / **产出规格** `16:9 · 30s` / **相对时间**；三样**全部来自已在 wire 上的字段** `workflow.state` + `plan.*` + `updatedAt` → **零契约改动、零数据迁移**；配套新纯函数 `src/relative-time.ts` / `src/project-cover.ts` / `src/project-row.ts`）；④ **R4 分组头**（`▸/▾` 文字符 → SVG 箭头 + 旋转过渡，计数独立成列右对齐，不再挤成 `名称 (8)`）；⑤ **R5 动作区收口**（三枚虚线按钮 → 一枚实底主按钮 + 一枚透明底图标按钮；dev 自测入口**默认隐藏**）；⑥ **R6 用户卡**（名称 13/500 + 真实副行 11px）；⑦ **R8 可收起左栏**（280px ⇄ **56px 缩略条**：品牌标 + 项目色块 chips + 用户头像；`data-rail="strip"` 驱动栅格，**`min-width` 同步下移到 696px** —— 否则收起反而多出横向滚动条，这条被渲染台当场抓出；新增 `src/client/RailStrip.tsx`）。**新增令牌**：`--cs-float`（浮层档，暗色比壳亮一档；**浅色与壳同为 `#FFFFFF` 是刻意的** —— 靠描边 + 投影区分）、`--cs-cover-1..6`（封面六档，**随预设变**，由品牌色现场 `color-mix` 混出、明暗自动跟随）。**零外部依赖**（动效全 CSS）、**未改任何 `--dsw-alias-*`**、**未动右侧对话区**、**未改栏宽基准 280px**（改它会重排已验收的 C/D 区）。**验证链全绿**：sync skills / tsdown / tsc Host emit / tsc client dts / verify:loader ✓，**550/550 fail 0**（+14：新建 `tests/project-row.test.mjs` 覆盖相对时间分档边界 / 代理对首字 / 色档由 id 派生 / **档位数量三处同源** / 阶段词与六段轨道同源）；另建**整栏渲染台** `scripts/preview-rail.mjs`（CSS 取自 `styles.ts` 真实产物 + 令牌取自 `lib/brand.js`，**280px 真实宽度 + 明暗双轨 + hover/选中/菜单展开/折叠四态**，32 条 computed-style 断言；`verify-previews.mjs` **15 组 15 通过 0 失败**）。**一处断言被自己纠正**：初版把「菜单底色 ≠ 壳色」写成不分主题的断言，浅色下当场假红 —— 复核判定**是断言过严**：浅色下 `--cs-shell` 与 `--cs-float` 同为 `#FFFFFF`（同一支白），浮层靠描边 + 投影区分，真正该守的是「**浮层必须能与壳区分**」，已改为分主题判定。**新立验收分区 F 左栏**（`visual-direction-ui-closeout.md` §6.1），**不受 A~E 放行约束**。**待用户桌面验收**（分区 F）：① 收起 / 展开各走一遍，**重点看窄窗**（收起后不应多出横向滚动条）；② 确认行内不再有原生下拉浮块；③ 副行三段，**未锁定规格的项目该段不显示且不留悬空 `·`**；④ 分组名应比项目名更弱（层级已反转）；⑤ 明暗各一遍（浅色下浮层与壳同白属预期）
- **涉及文件**：`src/brand.ts` / `src/client/styles.ts` / `src/client/{ProjectList,StudioFrame,UserCard}.tsx` / `src/client/{ProjectRowMenu,RailStrip}.tsx`（新）/ `src/{relative-time,project-cover,project-row,workflow-stage}.ts` / `tests/project-row.test.mjs`（新）/ `scripts/preview-rail.mjs`（新）/ `scripts/verify-previews.mjs` / `docs/{STATUS,visual-direction-plan,visual-direction-execution-plan,visual-direction-ui-closeout}.md`

#### CV-163 · 视觉升维 DD-04a 时间轴 + DD-05 叙事 + DD-06 首屏（「工具面板 → 制作现场」第四批，三批合并立项）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：① `.csTimelineStrip` 等宽 chip → **真时间轴**（`CanvasTimeline.tsx` 重写 + 新纯函数 `src/timeline-layout.ts`）：自适应秒刻度标尺 / 三轨（视频轨片段宽度 = 真实 duration 比例、BGM 轨点选即选定、参考·产物轨收容图片素材 + 成片 + 失效版本）/ 可拖播放头（擦洗松手联动画布选中、`clipIdAt` 左闭右开命中、teal isHot）；**播放头 8px 参考系偏移在渲染台断言中当场抓出并修掉**；② 审批条场记板形态（gold 拍板条 + 顶缘斜纹）+ 五阶段行进指示（`workflowStageIndex`，行进语义不可点击）+ Toast 接 `--cs-duration-fast`/`--cs-ease`；③ 首屏 38 处令牌化；守卫 +6（timeline 5 + 场记板 1），空转棘轮 25 → 1
- **涉及文件**：~~`src/timeline-layout.ts`（新）/ `CanvasTimeline.tsx` / `StudioFrame.tsx` / `styles.ts` / `brand.ts`（无改动）/ `tests/timeline.test.mjs` / `tests/visual-tokens.test.mjs`~~ ✅ 2026-09-12 渲染台双主题全绿；`484/484` fail 0；**待桌面验收**
- **落地/验收**：`src/timeline-layout.ts`（新）/ `src/client/canvas/CanvasTimeline.tsx` / `src/client/StudioFrame.tsx` / `src/client/styles.ts` / `tests/timeline.test.mjs` / `tests/visual-tokens.test.mjs` / docs

#### CV-160 · 时间轴把「成片」当成片段：预计时长重复计入 + 成片递归叠加

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P0
- **详情**：（桌面验收时用户发现：「时间计算有问题 —— 生成视频后有一些视频已经废弃了」）。**根因是口径分叉，不是公式错**：片段判定全仓有两份 —— Host 权威 `defaultComposeClips`（CR-001 起）是 `kind==='video' && toolName !== 'compose' && isActiveShot`，而 CV-006/007 新增的 `compose-selection.isComposableClip` 只写了 `kind==='video' && !retired && !supersededBy`，**漏了「非成片」一条**。成片节点是 `kind='video'` + `toolName='compose'`（`project-store.ts:931` / `compose.ts:605`），于是在时间轴上被算成「一个视频片段」：① 用户实测「视频片段 4 / 预计成片 30.99s」，其中 15.48s 就是**上一版成片**（三个 5.17s 片段拼出来的），真实成片长度 15.51s —— **估算正好翻倍**，并连带触发 BGM 误报「17.04s 短 13.95s，合成会被拒绝」；② 点「合成导出成片」会把上一版成片作为 clipId 再拼一次（**递归叠加**，正是 CR-001 早已在 Host 侧杜绝的行为，UI 侧却漏了）。**修法：把片段判定收敛成唯一权威谓词，两处共用**——`shot-versions.ts` 新增 `isComposeProduct`（成片产物）与 `isShotClip`（逐镜片段：视频素材 + 存活版本 + 非成片），`defaultComposeClips` 与 `compose-selection.isComposableClip` 双双改为委托它（**任何新消费方必须复用，不得再内联 `kind === 'video'` 判片段**）。UI：成片 chip 保留可见（回看/下载）但**不给勾选区**、加「成片」角标、工具栏出提示「成片 N 个不计入」，预计时长的 tooltip 写明「与 /compose 实际提交的 clipIds 完全一致」。验证 **462/462**（+4：成片不计入 clipIds/est（15.51 而非 30.99）/ `video_composite` 仍是合法片段 / `isComposedFilm` 边界 / **口径一致性护栏**——同一节点表下 `isComposableClip` 集合必须等于 `defaultComposeClips` 集合，专防再次分叉）
- **涉及文件**：src/shot-versions.ts / src/compose-selection.ts / src/host-tools.ts / src/client/canvas/{CanvasTimeline.tsx,styles.ts} / tsconfig.client.json / tests/compose-selection.test.mjs

#### CV-152 · 风格质检基准（Look Phase 4 / L4，编号沿用 [look-asset-plan.md](./look-asset-plan.md) 附录 A 预留）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P3
- **详情**：一致性从此有**风格**基准可判（此前只有角色基准）。① `defaultQcExpect` 从 host-tools 移入 `quality-check.ts` 并**按角色分组**——角色/场景卡「逐项一致」、Look 卡（`role='style'`）「整体调性（允许轻微波动、不允许调性反转）」：混在一起 VLM 会拿逐项标准去卡风格，把轻微调色差异误判成 FAIL；② `buildQcPrompt` 检出 Look tokens（`parseLookTokens` ≥1 字段可解析）时追加 **4 个单帧可判的风格维度**（色彩与调色 / 光线方向与软硬 / 材质质感 / 镜头语汇），漂移项点名对应 token 行（如「光线」）；「节奏」是跨镜时间维度**单帧不可判，显式排除**（防 VLM 拿它凑 FAIL）；③ **不新增 `qc_look`**（工具数纪律，CV-147 刚收敛过；qc_shot 扩展即达目标）。`toolchain.md` qc_shot 行同步。测试 +2（`tests/quality-check.test.mjs`：分组判据与角色在前 / tokens 检出 + 无 tokens 时行为与旧版一致）
- **涉及文件**：src/quality-check.ts / src/host-tools.ts / skills-local + skills 双副本（look.md、toolchain.md）/ tests/quality-check.test.mjs / docs/canvas-studio-tools.md

#### CV-151 · 预设降级收口 + 预设自带 Look tokens（Look Phase 3 / L3，编号沿用 [look-asset-plan.md](./look-asset-plan.md) 附录 A 预留）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：预设降为「出口」在 Phase 0 已做（纯文档），本批收掉剩余两处。① **预设表新增第 4 列「Look tokens」**（11 条预设各一份 5 项 tokens，出口选中即用）+ 出口选中预设后的落卡规则：把该行 tokens 整理成 **5 行** → 向用户复述确认 → `look_card` 落卡（`Look · <预设名>`），该预设的风格 skill **照常加载** —— 预设与 ②-1 采集从此**同一条注入路径**，不产生第二套机制。② **GIF 网格判定抽出为根级纯函数 `src/style-grid.ts`**（client 单文件 bundle 测试够不着；按 `skill-catalog.ts` 先例引用根级模块，两要件：client tsconfig include + `.js` 后缀），进入规则由「**任一选项命中即入网格**」收紧为「**命中 ≥ 2 且未命中 ≤ 1**」—— 旧规则在 Look 采集类问题（②-2 样张确认）上会误触发：选项顺带提到一个预设名（宽松包含匹配）就入网格，而网格分支对未命中选项 `return null` **整个吞掉**，「我来说说」类按钮消失；现网格模式下未命中选项照常渲染为文字按钮（兜底项不丢）。③ `SKILL.md`「仅出口路径逐字使用预设名」Phase 0 已写死，**零改动**（体积闸余 57B）；3.4（Look 卡画布视觉标识）按「明确排除 over-engineering」不做。测试 **+5**（`tests/style-grid.test.mjs`：MAP ↔ 预设表首列**逐字对账**（CV-116 四处联动自动化两处）/ MAP 值 ∈ catalog 且不重 / 匹配精确·宽松·（推荐）·未命中 / 网格判定 6 例（含「样张确认 + 顺带提预设名」不误入）/ tokens 列 11 行 5 项齐全）
- **涉及文件**：src/style-grid.ts（新）/ src/client/question-capture.tsx / tsconfig.client.json / skills-local + skills 双副本（style-presets.md）/ tests/style-grid.test.mjs（新）/ docs/look-asset-plan.md

#### CV-159 · 样张重出不取代旧样张

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（验收 CV-157 时用户发现）：`image_generate` 没有「取代」入参，Agent 重出样张只能**追加新节点** → 旧样张留在画布且仍是**有效参考**（图片产物落盘即 `isReference:true`），两个后果：① 后端 `image2image` 只有 3 个参考位，废样张挤占候选（`list_references` 不筛失效，标了失效也照列）；② `findNodeByRef` 对同标题取**首个创建**节点，`@ref[标题]` 可能解析到废图；连带：右键「作废/恢复」被 `isShot` 门控只对视频开放，用户无法手动作废废样张。而「取代」机制（`replaces` → 旧节点标 `supersededBy`）CV-108 已实现，**只是没暴露给图片侧**。修法（全复用现成机制，4 处）：① `planSupersede` 泛化出 `kind` 参数（`'video'` 默认 / `'image'`）—— 图片侧只吃显式 `replaces`、**不做指纹判重**（参考图多版本是有意的，CV-108 注释即言明）；② `image_generate` 暴露 `replaces` 参数（节点 id）并接线到 `runGeneration`（落盘后二次写盘补 `supersededBy`，与视频同一条应用路径）；③ `list_references` 默认**滤掉失效参考** + 新增 `includeRetired`（失效项带 `status`，渲染标「已被新版取代 / 已作废」）；④ 右键「作废 / 恢复」对参考图片开放（图片文案「作废（不再作为参考）」）。skill 纪律：`look.md` §6 写死「**重出样张必传 `replaces`**（旧样张自动失效退出参考池）+ 锚点优先用节点 id」，`toolchain.md` 两行同步。验证 **440/440**（+2，`tests/shot-versions.test.mjs`：图片 replaces 命中 / 种类不匹配双向不误伤 / 不做指纹判重 / `image_generate` 暴露参数 + `list_references` 过滤与 status）
- **涉及文件**：src/{shot-versions,generate,host-tools}.ts / src/client/canvas/CanvasContextMenu.tsx / skills-local/canvas-studio-creation/references/{look,toolchain}.md / tests/shot-versions.test.mjs / docs/canvas-studio-tools.md

#### CV-158 · 2b 命名重载消歧

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（同一份 `SKILL.md` 里 `2b` 两义）：第 32 行「② Look 采集（2a 提取 → **2b 样张确认** → 2c 预设出口）」与第 71 行「**2b. 剧本创作 → 审批**」撞名 —— 后者是**审批门禁**（有实际后果），前者只是澄清子步，歧义代价不对称。修法取「改 Look 一侧」：三小步统一为 **`②-1 / ②-2 / ②-3`**（明确挂在「澄清提问顺序第 ② 项」下，与文档既有的 ①②③ 记法一致），`2b. 剧本创作` 与 `screenplay.md` 对它的引用**不动**（工作流序号体系保持原样）。涉及 3 文件 12 处：`SKILL.md` / `clarification.md` / `look.md`，另 `look-asset-plan.md` §7.3 同步并加编号注。`clarification.md` 补一条「编号范围（别混淆）」说明。**坑**：不能用裸 `2a` 批量替换 —— `txt2audio` 里也含 `2a`，故按完整子串精确替换 + 逐条断言命中数（替换后复核残留只剩 `2b. 剧本创作` / `screenplay.md` 引用 / `txt2audio` 三处，均为预期）。本次为纯文档改名**无新测试**，验证链仍 **438/438**
- **涉及文件**：skills-local/canvas-studio-creation/{SKILL.md,references/{clarification,look}.md} / docs/look-asset-plan.md

#### CV-157 · Look 卡资产化（Look Phase 2 / L2）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：让「风格」与「角色」平级：把澄清 ②-1 采集、②-2 确认的 **5 项 tokens 冻结成 `role=style` 资产卡**，逐镜逐字节注入。① 新增 **`look_card` 工具**（注册工具 **22 → 23**，用户已拍板同意）：`name`（`Look · ` 前缀**自动补** —— 注册表按名字整体覆盖，撞名会静默换掉角色卡）/ `lockedPrompt`（5 行 tokens）/ `referenceFilename?`（锚点）/ `negativePrompt?`；**不调任何后端生成**，样张由 `image_generate` 出、本工具只做登记。② `registerLookCard`（`generate.ts`）**复用既有样张节点作锚点** —— 与 `character_sheet` 的关键差异：那张四视图拼图是本工具**当场生成**的故新建节点，而样张在 ②-2 已落画布 → 不重下载、不新建；同名重调 = 复用原 id 整体覆盖 + 先摘旧锚点归属。③ **tokens 归一策略 =「能完全理解才改写」**：5 项齐全 → `formatLookTokens` 归一成**权威行序**（逐镜注入是逐字节复用，行序漂移会让卡与 prompt 对不上）；缺项 → **原样保留 + warning**，不改写看不懂的输入。④ 锚点解析 `resolveAnchorNodeId` 三种入参都认（`@ref[标题]` / 节点 id / 文件名或本地资产名），解析不到只出 warning **不阻断落卡**（主路径是文字注入）。⑤ output schema 独立声明 + **CV-146 同款编译期覆盖守卫**（`LookCardSchemaCoverage`）。⑥ skill 同步：`look.md` §9 改写为「落卡 + 注入纪律」（原「卡尚未提供 / 手工拼接」一节作废）+ 新增 §9.3 无卡回退、`consistency.md` 新增「Look 卡注入纪律」节、`SKILL.md` 工作流第 1 步补落卡时点、`toolchain.md` 工具表加行。验证 **438/438**（+11，`tests/look-card.test.mjs`，含「工具已注册 + skill 有文档」正向护栏防 CV-130「工具在但没人用」）
- **涉及文件**：src/{generate,host-tools,style-tokens}.ts / skills-local/canvas-studio-creation/{SKILL.md,references/{look,consistency,toolchain}.md} / tests/look-card.test.mjs / docs/{canvas-studio-tools,api,look-asset-plan}.md

#### CV-156 · H3 IR 模式判定「双轨」冲突

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：工具侧按**图片数量**判模式（`src/host-tools.ts`：1 图=I2VA / 2 图=FL2VA / ≥3 图=Ref2VA），而 `h3-prompt-writing` 按**素材角色**判（首帧/尾帧/首尾帧/通用参考）。实测：Agent 以「参考图定风格 + 首帧定构图」为语义（Ref2VA）给 `video_composite` 传 2 图，工具却解成**首尾帧 FL2VA** → 预检 10 ERROR 拦截；按 FL2VA 解还会把**风格参考图当成「尾帧」**（语义荒谬），而预检只看 IR 文本、看不到这层错位。另：预检文案只报「IR 格式 N 处 ERROR」，未点出真因 —— skill 自身硬约束是「FL2VA/I2VA/L2VA 与 Ref2VA **互斥**（锁首帧与参考风格**只能两步走**）」，即**正解是分两步调用**。修法：① 文案点出真因；② 工具描述写死「N 图 → 模式 + 第 N 张位次」；③ 彻底做法是模式**显式化**（**已补齐**，见下）。**已修复（2026-09-11，做 ①+②）**：`h3-ir-validate.ts` 新增 `detectIrTemplate`（只认模板形态）/ `modeByPictureCount`（数量→模式的唯一映射）/ `irModeMismatchHint`（错位时给可操作出路）/ `COUNT_MODE_HINT`（文案单一权威，工具描述**引用**而非抄写）——预检与校验 CLI 共用同一份，两处漂移。模板与模式不一致时，报错**先点真因**「模式选错，不是格式写错」，再给正解：语义是「风格参考 + 首帧」时**拆两步**（先用风格参考出关键帧 `image_generate` → 再把该关键帧**单图**走 I2VA），或补齐到 ≥3 张才走 Ref2VA。② 两个视频工具的 `filename` / `filenames` 描述写死**位次**（1 张 = 首帧 `<Picture 1>`；2 张 = 首帧 + 尾帧；≥3 张 = 第 N 张即 `<Picture N>`）。③ 同步 `h3-prompt-writing` §1 与 `toolchain.md`（新增「IR 预检的模式按图片数量判」节）。验证 **438/438**（+6）。**③ 已补齐（2026-09-11 第二批，+3 例）**：两个视频工具新增 `irMode` 显式模式声明参数（T2VA/I2VA/FL2VA/Ref2VA）—— `assertH3IrPrompt` 新增 `declaredMode`：声明与位次推断不一致时 **fail-fast** 报「模式声明不一致」（回显声明值 + 位次判成什么 + 端点由素材数量决定 + 两步走/补到 ≥3 张出路），不再放行去产生派生段名 ERROR；纯文本提示词忽略声明（`toolchain.md` 两行 + `h3-prompt-writing` §1 同步）
- **涉及文件**：src/h3-ir-validate.ts / src/host-tools.ts / scripts/validate-h3-ir.mjs / skills-local/h3-prompt-writing/SKILL.md / skills-local/canvas-studio-creation/references/toolchain.md / tests/h3-ir-precheck.test.mjs

#### CV-154 · 会话分析脚本值形态族漏报修复

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（`scripts/analyze-session.mjs`）：本会话「参数嫌疑分析」**本该第一时间报出 CV-155 的规律却没报**，两个叠加缺陷 —— ① 值形态族分析被写在 `if (withK.length < 2 \|\| withoutK.length < 2) continue` **之后**，而 `image2vl`/`qc_shot` 每次都带 `filename`（`withoutK` 为空）→ 该维度**整段没跑**；② 对照取**工具整体成功率**（`rate < baseRate - 0.3`），当嫌疑族本身是多数派时（`img-*` 13/19）会把 `baseRate` 一起拉低到 26% → `0 < -0.04` 恒假、**永不触发**。改为「值形态族分析独立于键存在性判据」+「对照优先取**同键其它形态族**，单一形态族时退回**不带该键**的样本」+ 删掉不再使用的 `baseRate`。修复后：09-11 报出 `image2vl \| filename=img-* \| 0%（13） \| 83%（6）`；09-10 回归 7 行 **⊇** 修复前 6 行（原检测一个未丢）
- **涉及文件**：scripts/analyze-session.mjs / docs/api-probe/{session-20260911,2026-09-11-filename-consumability.md}

#### CV-147 · 工具集收敛 26→22 + 生视频工具改显式 H3 端点描述

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：用户拍板删除 `inpaint` / `style_transfer` / `storyboard_generate` / `storyboard_split`（`deduction` 早已不存在），**连代码一起删**——4 个 `defineTool` 块 + `DISABLED_TOOLS`/`guardDisabledTool` 机制 + `generate.ts` 分支 + `DRAMA_ENDPOINTS` 端点常量；`storyboard_*` 一并移出 `GATED_TOOLS`（现仅 `video_generate`/`video_composite`）。`video_generate`/`video_composite` 的 description 显式标注 H3 端点：`image2videofl2va`（首帧/首尾帧）/ `image2videoref2va`（全能参考，带 `audioRefs` 必走）。注册给模型的工具 26→22（20 真实 + 2 占位）。**有意保留** `StudioCanvasOperationType` 的 `'style-transfer'`/`'storyboard-split'` 取值与客户端渲染映射（老项目既有节点仍可渲染/重试）。同步 skills-local 6 文件 + 重建 skills/、测试 4 文件。验证：build ✓ / verify:loader ✓ / typecheck 双端 ✓ / test:smoke **406/406**（删 2 加 1）✓
- **涉及文件**：src/host-tools.ts / src/generate.ts / src/config.ts / src/asset-capture.ts / src/providers/types.ts / src/contracts/canvas.ts / src/projects.ts / src/client/canvas/{CanvasNode,LayerDetailPanel}.tsx / scripts/analyze-session.mjs / skills-local/{canvas-studio-creation,qwen-image-edit-writing} / tests/{workflow-gate,generate,asset-capture,skill,character-sheet}.test.mjs / docs/{canvas-studio-tools,api}.md

#### CV-145 · 带文件名入参的后端端点全部 500 → 复验实测全部可用（11 个端点 200）

- **状态**：已撤回（误判）（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：—
- **详情**：~~带文件名入参的后端端点全部 500~~ → 复验实测**全部可用**（11 个端点 200）；误判根因是探测用了 1×1 像素占位图
- **涉及文件**：docs/api-probe/archive/2026-09-10-file-endpoint-recheck.md
- **缺陷追踪（§2.1）**：状态 **已撤回（误判）** · 优先级 —（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**~~所有「带文件名入参」的后端端点全部 500~~ → 复验证明全部可用，原判撤回**：2026-09-10 22:00–22:20 用 `scripts/probe-file-endpoints.mjs` / `probe-generated-refs.mjs` / `probe-video-refs.mjs` 严格串行复验 —— **同一端点、同一参数，只把参考图从「1×1 像素占位图」换成真实尺寸图，500 立刻变 200**：`image2image` 200/24.8s、`image2vl` 200/7.4s、`image2character` 200/72.7s、`image2styletransfer` 200/22.2s、`image2ipastyletransfer` 200/76.6s、`image2storyboard` 200/31.3s、`image2inpaint` 200/31.2s、`image2360hdri` 200/193.5s、`image2splitegrid` 200/1.2s、`image2videofl2va` 200/196.6s+136.5s、`image2videoref2va` 200/125.6s+130.0s，**共 11 个端点全通过**；另按生产形态闭环（`txt2image` 生成角色三视图 → 下载 → 上传得 `ref-*` 句柄 → 调用）复验，`image2vl` 准确识别出「front / side / back 三视角、深蓝双排扣风衣、白底、肩章腰带」。**误判根因**：上一轮探测的上传素材是内联的 **1×1 像素 PNG（190B）**，后端能「找到」文件（1.2s ≫ 幽灵名 0.06s，故当时判「文件被找到了」并没错），但**解码/预处理即崩** → 500；把崩因归给「文件消费链路坏了」才是错的。原判「20 倍差 = 链路坏了」修正为「找到了 → 读取时崩，而崩溃由探测自选的 1×1 图触发」。**方法论教训：探测参考图必须是有意义的真实尺寸图**，最小占位图会把「素材本身不可处理」误报成「接口不可用」，而这类误判最贵——它会让后续 agent 主动避开本来可用的链路。另复验确认：`image2vl` 跨请求脏状态**属实**（不传图仍返回陈旧缓存图描述，带图时可信）；响应 `duration` 实证为**服务端生成耗时（秒）**（逐条与 HTTP 耗时吻合）→ 不可当媒体时长
  - **位置**：`docs/api-probe/archive/2026-09-10-file-endpoint-recheck.md`（结论）+ `scripts/probe-{file-endpoints,generated-refs,video-refs}.mjs`（新，可复用）
  - **修法要点**：已撤回，无需修复；参考图素材纪律写进 `docs/api.md` 横幅

#### CV-005 · 血缘连线只能加不能删

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：血缘连线只能加不能删
- **涉及文件**：CanvasEdges / CanvasContextMenu
- **缺陷追踪（§2.1）**：状态 **待处理** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：血缘连线只能加不能删：手动 link 后无 UI 移除单条边，Agent 画错血缘无法修正
  - **位置**：`CanvasEdges.tsx`、`CanvasContextMenu.tsx`
  - **修法要点**：见决策点 D3（已拍板延后，并入「多版素材择优」工作流）

#### CV-006 · compose 无法排除片段、无 BGM 选择器

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（client SDK `bgmNodeId` 与 `/compose` 路由早已支持，缺口纯在 UI）——按 [av-ui-acceptance-plan.md](./av-ui-acceptance-plan.md) §3 落地：① `StudioCanvasView` 追加可缺省 `composeExcluded` / `composeBgmNodeId`（老项目零迁移；`normalizeCanvasView` 同步 coercion 防持久化 round-trip 丢字段）；② 时间轴 video chip 右上勾选区（**兄弟绝对定位元素**，button 嵌 button 非法 DOM；排除态降透明、作废片段禁用联动 CV-108）；③ 工具栏 BGM 下拉（**仅存活音频节点**（拍板 ①），选项带真值时长；失效引用自动回退「不使用」）；④ 选中 BGM 短于预计成片时出 amber 软提示（0.05s 容差，不拦——服务端 CV-138 守卫报精确差额）；⑤ 导出走 `resolveComposeSelection` 派生结果，与 agent 完全同一 `/compose` 通路
- **涉及文件**：src/compose-selection.ts（新）/ src/contracts/canvas.ts / src/canvas-view.ts / src/client/StudioFrame.tsx / src/client/canvas/CanvasTimeline.tsx / src/client/styles.ts / tests/compose-selection.test.mjs（新）

#### CV-007 · 时间轴语义混乱（非媒体混排、无总时长）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：最小满足（波形/刻度尺明确非目标）：① 默认**只显媒体**（image/video/audio），工具栏「显示全部」toggle 回看非媒体（拍板 ②）；② video/audio chip 角标显示 **ffprobe 真值时长**（CV-140 数据源）+ 创建时间；③ 工具栏显示「预计成片 ≈ Σ 有效纳入片段真值时长」，随排除勾选实时更新（合成前唯一的时长锚点）
- **涉及文件**：src/client/canvas/CanvasTimeline.tsx / src/compose-selection.ts / src/client/styles.ts

#### CV-021 · 删除被引用节点无提示，sourceIds 悬空

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：删除被引用节点无提示，sourceIds 悬空
- **涉及文件**：StudioFrame / project-store
- **缺陷追踪（§2.1）**：状态 **待处理** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：删除被血缘引用的节点无提示，下游 `sourceIds` 静默悬空
  - **位置**：`StudioFrame.tsx`（handleDelete）
  - **修法要点**：删除前检测下游引用并提示，或级联清理 sourceIds

#### CV-036 · 项目无「已完成」标记

- **状态**：待拍板（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：项目无「已完成」标记
- **涉及文件**：projects.ts / ProjectList

#### CV-039 · skill 的 H3 提示词规范是官方粗糙子集，声音设计能力未启用

- **状态**：待处理（部分）（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：skill 的 H3 提示词规范是官方粗糙子集，声音设计能力未启用。**已落地部分**：六段规划法、8 类风格预设；**未落地**：三字段声音规范（`integrated_multimodal_description` / `overall_soundscape` / `non_diegetic_music`）未内化进 `creation-spec.ts` —— 2026-09-01 核实该文件中零匹配，三字段只出现在上游 skill（英文正文与 references/）里
- **涉及文件**：skills/creation-spec.ts

#### CV-040 · 多段成片音轨断裂 → Master Audio 全局基准装配

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：多段成片音轨断裂 → Master Audio 全局基准装配
- **涉及文件**：compose.ts / host-tools.ts

#### CV-042 · 风格化画面文字能力未规划

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：风格化画面文字能力未规划
- **涉及文件**：skills/creation-spec.ts

#### CV-043 · Ref2VA 音频参考与复用未利用（远期，依赖 039/040）

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：Ref2VA 音频参考与复用未利用（远期，依赖 039/040）
- **涉及文件**：generate.ts / video-style.ts

#### CV-046 · 注册表跨实例互踩（数据完整性）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：注册表跨实例互踩（数据完整性）
- **涉及文件**：projects.ts
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：项目注册表落 `$DSH_HOME/canvas-studio/`（home 级、跨 profile 共享）+ 常驻内存原子写 → 两个 DSH 实例共享 home 时后写方整表覆盖，先写方的项目从注册表消失（目录还在，表现为「项目丢了」）
  - **位置**：~~`projects.ts`（registry root）~~
  - **修法要点**：✅ 2026-09-17：取方案 ②（**不迁目录，零迁移风险**）—— 6 处写点全部改走 `commitRegistry(memory, removed)`：**写前重读磁盘**后与内存按 id 合并（内存优先，故本实例的改动不丢）再落盘；`projects.json` 新增 `deleted[]` **删除墓碑**（上限 200，落盘前裁旧），删过的项目即便出现在另一实例的陈旧快照里也不会被「复活」。损坏的注册表上 `list()` / `create()` 一律报错且**原文件一个字节都不改**（不拿空注册表覆盖用户可抢救的数据）。+5 用例

#### CV-047 · 端口静默漂移无提示

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：端口静默漂移无提示
- **涉及文件**：dsh-plugin-desktop
- **缺陷追踪（§2.1）**：状态 **待处理** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：端口被占时从 43120 起向后重试 32 个，**静默换端口无任何提示**，用户不知道自己开了两个 DSH
  - **位置**：`dsh-plugin-desktop/src/desktop-port.ts`
  - **修法要点**：退避命中后托盘/通知提示「已改用端口 N」

#### CV-048 · 缺「本机已有 DSH」官方指引（文档项）

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：缺「本机已有 DSH」官方指引（文档项）
- **涉及文件**：docs/faq.md / user-guide.md

#### CV-049 · ask_user_choice 自由输入是 opt-in，没传就没出口 → 反转缺省为 true（显式传 false 才隐藏

- **状态**：已完成·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：ask_user_choice 自由输入是 opt-in，没传就没出口 → **反转缺省为 true**（显式传 false 才隐藏；模型未传参的存量问题卡片也获得输入框）
- **涉及文件**：host-tools.ts / contracts/project.ts / question-capture.tsx

#### CV-050 · 分镜重复提交堆积

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（打回重做的实际杀手），CV-026 遗留项
- **涉及文件**：host-tools.ts buildShotCards
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：打回后 AI 重新提交分镜，`buildShotCards` 无脑追加整套新卡，旧卡原地不动 → 打回两次画布上三套「分镜 1 · 特写」；下游关键帧的 `shotRefs` 可能连到旧卡
  - **位置**：~~`host-tools.ts:262`（buildShotCards）、`:763-764`（提交落卡）~~
  - **修法要点**：✅ 2026-09-17：按 D4 方案 A 将 `buildShotCards` 提为可测纯函数 `mergeShotCards(existing, sourceIds, shots, mint)` —— 按 `shotCardNumberOf` 解析的镜号匹配旧卡，复用 id 与位置**只更新文案**；新镜号新建且用共享 `boxesOverlap` 避让已占格；多余旧镜号卡**保留不删**（防下游 `shotRefs` 断链）；新行省略时长时清掉旧 `declaredDuration` / `declaredFrames`（防旧值冒充新值）；工具结果写明「新建 N 张 / 复用 M 张」。+8 用例

#### CV-051 · 关键帧阶段无打回

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（只有确认）
- **涉及文件**：StudioFrame / routes.ts
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：关键帧阶段只有「确认关键帧」没有「打回」：整体不满意只能逐张右键重做（AI 不知情）或去对话里说
  - **位置**：~~`StudioFrame.tsx:717-723`、`routes.ts:627-629`、`client/index.ts:356-360`~~
  - **修法要点**：✅ 2026-09-17：新增 `reject_keyframes` 动作 —— 确认条内加意见输入框（占位「不满意哪里？」）+「打回重出」按钮；状态回 `executing`（**必须离开 `keyframe_review`**，否则重出走 `image_generate` 会被 `PRODUCING_TOOLS` 闸拦死）+ 带意见唤醒 AI 重出，重出后**再次**弹确认条；`approval-gate` / `approval-notice` 文案同步。+3 用例（含全链路接线守卫）

#### CV-052 · 模式切换把状态误翻回 drafting

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P0
- **涉及文件**：routes.ts setMode
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P0（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：在 `keyframe_review` 或 `executing` 状态下再点一次顶部模式按钮（按钮仍可点），`state` 被强制翻成 `drafting` → 审批条消失、AI 后续调视频工具收到「请先提交分镜表」，流程语义错乱
  - **位置**：~~`routes.ts:646-648`（setMode）~~
  - **修法要点**：✅ 2026-09-01：状态决策抽为纯函数 `resolveSetModePatch`（`contracts/project.ts`，mode 未变化短路只写 mode）；模式按钮加 `disabled` + 样式；新增 `tests/workflow-mode.test.mjs` 7 用例（全量 153/153 绿）。UI 验收法见 redo-redesign-plan §A2-1

#### CV-053 · 审批条不醒目（无高亮 / 角标）

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：审批条不醒目（无高亮 / 角标）
- **涉及文件**：StudioFrame

#### CV-054 · 无单版本回退（节点加 previous 字段存上一版）

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：无单版本回退（节点加 previous 字段存上一版）
- **涉及文件**：contracts/canvas.ts / LayerDetailPanel

#### CV-055 · 下游无过时标记（沿 sourceIds 反向 BFS 打 staleAt）

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：下游无过时标记（沿 sourceIds 反向 BFS 打 staleAt）
- **涉及文件**：project-store / CanvasNode

#### CV-056 · 切模式解除等待后不唤醒 agent

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（状态显示「制作中」，AI 实际在睡）
- **涉及文件**：client/index.ts setWorkflowMode
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：模式切换把 `awaiting_approval` / `keyframe_review` 解除等待后置 `executing`，但 `setWorkflowMode` 不含 wakeAgent → AI 已结束回合在睡，状态条显示「制作中」而流程实际停摆。用户以为切放手跑就自动续跑，其实要手动打字叫醒
  - **位置**：~~`client/index.ts:361-364`（setWorkflowMode）~~
  - **修法要点**：✅ 2026-09-01：`setWorkflowMode` 切换前快照 `before.state`，等待类 → `executing` 时复用 wakeAgent 发「继续」（对齐 `confirmKeyframes` 写法）

#### CV-057 · 视频播放浮层无进度条无控制按钮（只有点击切播放/暂停）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：视频播放浮层无进度条无控制按钮（只有点击切播放/暂停）。修复：自绘控制条（可拖进度 + 时间 + 播放暂停 + 音量/静音），仍不挂原生 controls（CV-044 硬约束）
- **涉及文件**：VideoPlayerModal / styles
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：视频播放没有进度条也没有任何控制按钮：双击视频打开的播放浮层只有「点击画面切播放/暂停」，无进度条、无时间显示、无音量、无法拖动进度
  - **位置**：~~`VideoPlayerModal.tsx`~~
  - **修法要点**：✅ 2026-09-01：浮层自绘控制条落地（可拖进度 pointer-capture + 当前/总时长 + 播放暂停按钮 + 音量 slider + 静音切换），仍不挂原生 controls（CV-044 硬约束约束住双击全屏路径）

#### CV-058 · 上传图片无任何选项

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：上传图片无任何选项；引导文案与实际交互不符。**拍板：只改文案**（上传功能后续在 LLM 编排里已有）。修复：`StudioFrame.tsx` 空态引导改为真实路径「上传后在节点详情面板点『标记为参考』」
- **涉及文件**：StudioFrame 参考图空态文案
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：上传图片没有任何选项；`StudioFrame.tsx:535` 引导文案与实际交互不符（文案撒谎）。**拍板：只改文案**（上传功能后续在 LLM 编排里已有）。上传链路核实为**双写**：本地落盘 + 同步传 Drama 拿 filename 落节点；副作用 Drama 不可用时整次上传失败（all-or-nothing，暂不动）
  - **位置**：~~`StudioFrame.tsx:535`（撒谎文案）~~
  - **修法要点**：✅ 2026-09-01：空态引导改为真实路径「上传后在节点详情面板点『标记为参考』」

#### CV-059 · 工具栏改版：删设置按钮（拍板：设置入口 = app 左下角全局入口）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：工具栏改版：删设置按钮（**拍板：设置入口 = app 左下角全局入口**）；整理布局/图层/小地图三按钮移到最右（原设置位）并全部图标化（内联 SVG 16px stroke 2，title/aria-label 保留，开关态高亮）。`onOpenSettings` prop 保留接线预留
- **涉及文件**：CanvasToolbar / styles
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：工具栏改版：删设置按钮（**拍板：设置入口 = app 左下角全局入口**）；整理布局/图层/小地图移最右并图标化
  - **位置**：~~`CanvasToolbar.tsx`~~
  - **修法要点**：✅ 2026-09-01：设置按钮移除（TOOLBAR_VISIBILITY.settings=false，prop 保留接线）；三按钮移至最右图标组（内联 SVG 16px stroke 2，title/aria-label 保留，图层/小地图开关态高亮 csToolbarIconActive）

#### CV-060 · 应用名迁移半途：标题栏 + productName 仍是「DSH Desktop」，托盘/更新已叫 VideoBuddy，两处不一致

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：应用名迁移半途：标题栏 + productName 仍是「DSH Desktop」，托盘/更新已叫 VideoBuddy，两处不一致。修复：标题栏 span、`index.ts` productName/windowTitle、tray-locale / native-dialog-copy / recovery-copy / desktop-dialog-window 四文案文件共 53 处统一为 VideoBuddy；**main.ts PRODUCT_NAME 保持不动**（app.setName 决定 userData 目录，改名会使日志/安装 ID/profile 状态搬家，如需迁移另立专项）
- **涉及文件**：dsh-plugin-desktop index.ts / ExtendedTitlebar / 四文案文件
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：应用名迁移半途、两处不一致：标题栏硬编码「DSH Desktop」、Electron productName 同，而托盘与更新模块已叫 VideoBuddy → 同一应用两个名字
  - **位置**：~~`index.ts:394`、`ExtendedTitlebar.tsx:181`、四文案文件~~
  - **修法要点**：✅ 2026-09-01：标题栏 span + productName/windowTitle + tray-locale / native-dialog-copy / recovery-copy / desktop-dialog-window 共 53 处统一为 VideoBuddy。**main.ts PRODUCT_NAME 保持 'DSH Desktop' 不动**（app.setName 决定 userData 目录，改名会让日志/安装 ID/profile 状态搬家；如需迁移另立专项）

#### CV-062 · ask_user_choice 多选 + 交互改版

- **状态**：已完成·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：新增 multiSelect 参数（答案以「、」拼接回流，下游契约不变）；交互统一两段式「点选 → 确认」（单选点新项自动替换，防误触）；视觉强化——问题头部徽标 + 提示、实底 chip + hover 上浮、选中实心反色 + ✓ 前缀、确认主按钮、结算 ✓
- **涉及文件**：host-tools.ts / contracts/project.ts / question-capture.tsx / styles.ts / creation-spec.ts

#### CV-064 · lobby 三态布局

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（一期 lobby + 二期三态）：① 无项目（`lobby`）——chat 居中、480px 右栏压到 0px、右上角新建 CTA（LobbyHero）；② 有项目无对话（`lobby-pending`）——chat 仍居中 + 推荐技能横滚，**无新建 CTA**；③ 有对话（`work`）——切回三栏现状。**判据**：`sessionSvc.list` 当前会话 `blank` 字段（首条 prompt ACCEPTED 自动翻转 false，`list.subscribe` 触发 → 发消息即切 work，不等 agent）。**实现与原方案 C 的差异（重要）**：对话槽**不做 JSX 条件渲染搬家**——换容器会让上游 conversation 组件卸载重建（草稿/滚动/会话绑定全丢），改为 `.csChat` 常驻挂载 + CSS grid 重排（`data-mode="lobby" / "lobby-pending"`：第三列 0px、中栏切 `auto / 1fr` 两行、`.csChat` 显式落 2 行 2 列居中卡片）；工具栏/工作流条在 lobby 态用 `display:none` 让位（保持挂载，work 态 DOM 零变化）；`LobbyHero.tsx`（横向紧凑品牌条 + 双 CTA）+ `LOBBY_COPY` 文案；`grid-template-columns` 300ms 过渡（`prefers-reduced-motion` 关闭）。静态预览：`node scripts/preview-lobby.mjs` 生成单文件 HTML（三态循环 + 亮暗切换）
- **涉及文件**：StudioFrame.tsx / styles.ts / LobbyHero.tsx（新）/ brand-copy.ts / scripts/preview-lobby.mjs（新）/ project-store.ts / client/index.ts

#### CV-065 · 技能广场 UI

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：lobby 横滚 6-8 张推荐卡片 + "更多"进全屏广场（参照图 #2 MiniMaxHub，左栏分类侧栏 + 右栏卡片网格）。新建按钮禁用 + "待接入"角标（reserved 原则）。「使用」= 提示词插进对话输入框（复用 insertReferenceToken 通路，不自动发送）。方案：[§3](./lobby-skill-marketplace-plan.md#3-phase-c--技能广场-uicv-065-续)
- **涉及文件**：SkillCard/Carousel/Market.tsx（新）/ SkillCatalog（新）/ CanvasToolbar / styles

#### CV-066 · skill 激活链路

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：「使用」= 提示词插进对话输入框（复用 insertReferenceToken 通路）+ work 态装载 `activeSkills`（store 即时更新，chip 行展示 + × 卸载）。**持久化与方案差异（重要）**：`activeSkills` 独立存 `skills.json`（`ProjectRegistry.readActiveSkills/writeActiveSkills`，原子写 + 去重 + 类型过滤，缺失/损坏降级空数组），**不碰 canvas.json 的 merge-protect 复杂逻辑**；整表替换 API 幂等（activate/deactivate 都走 saveActiveSkills）。**不做 send_system_message host 路由**——客户端已有 `insertReferenceToken` + 对话发送自然唤醒 agent 两条现成通路，无需新增 host 工具。方案：[§4](./lobby-skill-marketplace-plan.md#4-phase-d--激活链路cv-066)
- **涉及文件**：projects.ts / routes.ts / api.ts / project-store.ts / ActiveSkillChips.tsx（新）/ contracts.ts / StudioFrame.tsx

#### CV-067 · 竖屏成片在画布被横屏框裁切

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：`compose_video` 成片节点落盘硬编码 `260×180` 横屏占位（`compose.ts` `COMPOSED_SIZE`），9:16 竖屏视频（480×864）在横框内被 `object-fit: cover` 裁切；`onMediaNatural` 异步校正兜底不稳定（依赖 `<video onLoadedMetadata>` 时序）。**修复 + 逻辑收敛**：新增 `src/canvas-aspect.ts` 作为「真实分辨率 → 画布显示框」唯一事实来源（长边 480、1:1→420×420、短边 60 地板，对齐验收用例 I-2）；`compose.ts` 按真实分辨率换算节点框（缺分辨率回退 260×180）；`generate.ts` 删本地 `previewSizeOf` 改 import 共享；`StudioFrame.tsx` 删 `longSide480`、上传探测与媒体加载校正均走共享函数（消除三处规则漂移：1:1 曾 420/480 不一致）；`tsconfig.client.json` include 追加。验证链全绿：build ✓ / test:smoke **172/172** ✓（+7 例 canvas-aspect 契约测试）/ typecheck（Host+Client）✓ / verify:loader ✓
- **涉及文件**：compose.ts / generate.ts / canvas-aspect.ts（新）/ StudioFrame.tsx / tsconfig.client.json / tests/canvas-aspect.test.mjs（新）
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：竖屏成片（9:16，480×864）在画布上横屏显示被 `object-fit: cover` 裁切（2026-09-02 用户实测截图反馈）——`compose_video` 成片节点落盘硬编码 `COMPOSED_SIZE 260×180` 横屏占位，真实分辨率只进 mediaWidth/mediaHeight；`onMediaNatural` 异步校正依赖 `<video onLoadedMetadata>` 时序，落盘初期窗口期兜底未生效
  - **位置**：~~`compose.ts:343-344`（COMPOSED_SIZE 硬编码）~~
  - **修法要点**：✅ 2026-09-02：抽 `src/canvas-aspect.ts` 统一「分辨率→显示框」换算（generate 的 previewSizeOf + StudioFrame 的 longSide480/onMediaNatural 三处合一，消 1:1 漂移）；compose 落盘按真实分辨率换算（9:16→267×480），缺分辨率才回退占位；+7 契约测试（172/172 绿）

#### CV-069 · 左栏底部用户信息区缺失（竞品对标）→ UserCard 组件 + popover（主题/设置接真实功能，其余挂待接入）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：左栏底部用户信息区缺失（竞品对标）→ UserCard 组件 + popover（主题/设置接真实功能，其余挂待接入）
- **涉及文件**：client/UserCard.tsx / StudioFrame.tsx / styles.ts / brand-copy.ts
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**用户信息区缺失（竞品对标 MiniMax Design，2026-09-02 用户截图）**：竞品左栏底部有用户卡（头像/昵称/UID）+ 点击弹个人信息面板（账号身份/积分余额/订阅/设置组/帮助组），本项目左栏底部为空；且 CV-059 拍板「设置入口 = app 左下角全局入口」后画布侧缺插件内设置落点。拍板四项：① 主题/设置接真实功能；② 未规划条目（记忆管理/教程/更新日志/接入飞书微信）保留入口挂待接入，尽量完整复刻；③ 用户卡三态常驻（lobby / lobby-pending / work）；④ 假数据中文创作人设
  - **位置**：`client/UserCard.tsx`（新）、`StudioFrame.tsx`（左栏底部挂载）、`styles.ts`（csUser* 系列）、假数据常量（brand-copy.ts 追加或独立 user-mock.ts）
  - **修法要点**：✅ 2026-09-02 落地：`UserCard.tsx`（字母渐变 SVG 头像 + popover；主题三态 = 真实 ctx.theme，设置 = 打开 SettingsModal；积分/订阅/帮助组 reserved 入口 + 待接入角标，「接入飞书/微信」未接入 badge）；`USER_MOCK` 假数据收敛 brand-copy.ts。方案见 backlog CV-069

#### CV-071 · 技能卡悬停操作浮层 + 查看详情（竞品 DA-2）→ hover「使用 + 查看详情」+ 二级详情弹窗

- **状态**：待修复（弹窗未显示 GIF 预览）（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：技能卡悬停操作浮层 + 查看详情（竞品 DA-2）→ hover「使用 + 查看详情」+ 二级详情弹窗
- **涉及文件**：SkillCard.tsx / SkillMarket.tsx
- **缺陷追踪（§2.1）**：状态 **待修复（弹窗未显示 GIF 预览）** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：技能卡悬停浮层 + 查看详情（竞品 DA-2）
  - **位置**：`SkillCard.tsx`、`SkillMarket.tsx`
  - **修法要点**：✅ 2026-09-02 落地：hover 浮层「查看详情」+ 二级详情弹窗（标题/说明/分类/注册名/使用按钮；Escape 先关弹窗再关广场）

#### CV-073 · 「我的 Skill」视角（竞品 DA-4）→ 侧栏视图 + × 卸载，复用 CV-066 链路

- **状态**：待修复（我的 Skill 视图缺陷）（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：「我的 Skill」视角（竞品 DA-4）→ 侧栏视图 + × 卸载，复用 CV-066 链路
- **涉及文件**：SkillMarket.tsx / StudioFrame.tsx
- **缺陷追踪（§2.1）**：状态 **待修复（我的 Skill 视图缺陷）** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：「我的 Skill」视角（竞品 DA-4）：已激活技能广场内不可见
  - **位置**：`SkillMarket.tsx`（activeSkills 链路已有）
  - **修法要点**：✅ 2026-09-02 落地：侧栏「我的 Skill」视图（activeSkills 清单 + × 卸载复用 CV-066 链路；lobby 态无项目隐藏入口；空态引导）

#### CV-075 · 作者署名/下载量（竞品 DA-6）→ 假下载量与「不伪造已生效」冲突，用户拍板先不处理

- **状态**：暂缓（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P3
- **详情**：作者署名/下载量（竞品 DA-6）→ 假下载量与「不伪造已生效」冲突，用户拍板先不处理
- **涉及文件**：src/skill-catalog.ts / SkillCard.tsx
- **缺陷追踪（§2.1）**：状态 **暂缓** · 优先级 P3（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：作者署名/下载量（竞品 DA-6）：假下载量与「不伪造已生效」原则有张力
  - **位置**：`skill-catalog.ts`
  - **修法要点**：2026-09-02 用户拍板先不处理；做前需再拍板诚实性方案

#### CV-079 · 生成产物自动编组（竞品 DA-10）→ attachShotGroup 纯函数按分镜卡血缘并入「分镜 N · 素材」组

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：生成产物自动编组（竞品 DA-10）→ attachShotGroup 纯函数按分镜卡血缘并入「分镜 N · 素材」组
- **涉及文件**：generate.ts / CanvasSurface.tsx / project-store.ts
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**生成产物自动编组**（竞品 DA-10，用户点 1）：生成物全平铺；~~前置 CV-008~~ 已随本批一并完成
  - **位置**：`generate.ts`（`attachShotGroup`）、`CanvasSurface.tsx`（CV-008 多选/框选）、`project-store.ts`
  - **修法要点**：✅ 2026-09-02 落地：`attachShotGroup` 纯函数——有分镜卡血缘时并入「分镜 N · 素材」组（sourceIds 记分镜卡 id 去重复用，组框随成员包围盒扩展），无分镜卡保持旧行为；存量节点不追溯拉组。+2 单测

#### CV-080 · 生成节点命名精准化（竞品 DA-11）→ mediaNodeTitle 纯函数（镜号优先，回退 prompt 摘要）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：生成节点命名精准化（竞品 DA-11）→ mediaNodeTitle 纯函数（镜号优先，回退 prompt 摘要）
- **涉及文件**：generate.ts / storyboard_split
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**生成节点命名精准化**（竞品 DA-11，用户点 2）：媒体节点大多无 title，图层名「图片/视频」泛化
  - **位置**：`generate.ts`（`mediaNodeTitle`/`promptSummary`）、storyboard_split（`单镜 N`）
  - **修法要点**：✅ 2026-09-02 落地：命名 helper 纯函数——分镜卡镜号优先（`分镜 N · 关键帧/视频`）、无镜号取 prompt 前 12 字摘要、皆缺回退泛化标签；单镜拆分节点命名 `单镜 N`。+1 单测

#### CV-081 · 文本节点选中可滚动（竞品 DA-12）→ 选中态 overflow-y:auto + Surface wheel 对可滚正文放行

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：文本节点选中可滚动（竞品 DA-12）→ 选中态 overflow-y:auto + Surface wheel 对可滚正文放行
- **涉及文件**：CanvasNode.tsx / styles.ts / CanvasSurface.tsx
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**文本节点选中可滚动**（竞品 DA-12，用户点 3）：`.csNodeBody` overflow:hidden 截断长文
  - **位置**：`CanvasNode.tsx`、`styles.ts`、`CanvasSurface.tsx`
  - **修法要点**：✅ 2026-09-02 落地：选中态 `.csNodeSelected .csNodeBody` overflow-y:auto + overscroll-behavior:contain；Surface wheel handler 对「可滚动的选中正文 / textarea」放行（不劫持平移缩放），不可滚时画布行为不变

#### CV-082 · 视频 hover 自动播放（竞品 DA-13）→ 150ms 延迟 muted+loop，模块级单实例

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：视频 hover 自动播放（竞品 DA-13）→ 150ms 延迟 muted+loop，模块级单实例
- **涉及文件**：CanvasNode.tsx / styles.ts
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**视频 hover 自动播放**（竞品 DA-13，用户点 4）：缩略视频全静态
  - **位置**：`CanvasNode.tsx`
  - **修法要点**：✅ 2026-09-02 落地：hover 150ms 延迟 muted+loop 播放（模块级单实例登记防多视频同时播），离开 pause+归零；loading/失败/错误不播、prefers-reduced-motion 降级、卸载清理；双击仍开浮层

#### CV-083 · 视频时长角标（竞品 DA-14）→ loadedmetadata 现算 m:ss（不落盘）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：视频时长角标（竞品 DA-14）→ loadedmetadata 现算 m:ss（不落盘）；内联完整控件明确不做
- **涉及文件**：CanvasNode.tsx / canvas-aspect.ts / styles.ts
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：视频时长角标（竞品 DA-14）：内联完整控件明确不做（CV-044 结论）
  - **位置**：`CanvasNode.tsx`、`canvas-aspect.ts`（`formatMediaDuration`）
  - **修法要点**：✅ 2026-09-02 落地：loadedmetadata 现算「m:ss」角标（**实现决策：不落盘**——重载后 metadata 自然恢复，省契约字段）；+1 单测（8 例）。与 CV-082 同批

#### CV-084 · 制作计划阶段清单（竞品 DA-15）→ skill 产出 steps + host 推导翻转 + 清单定位，执行进度可视

- **状态**：待处理（单独排期）（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：制作计划阶段清单（竞品 DA-15）→ skill 产出 steps + host 推导翻转 + 清单定位，执行进度可视
- **涉及文件**：contracts/ workflow steps / host-tools.ts / StudioFrame.tsx / skill
- **缺陷追踪（§2.1）**：状态 **待处理（单独排期）** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：制作计划阶段清单（竞品 DA-15）：执行进度黑盒
  - **位置**：workflow steps 契约、`StudioFrame.tsx`、skill
  - **修法要点**：skill 产出 steps + host 推导翻转 + 清单定位；optimization-plan「实时状态反馈」轻量替代。本批未动

#### CV-085 · 视频 hover 快捷工具条（竞品 DA-16）→ 依赖成片编辑/素材库，待前置落地再评估

- **状态**：远期记录（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P3
- **详情**：视频 hover 快捷工具条（竞品 DA-16）→ 依赖成片编辑/素材库，待前置落地再评估
- **涉及文件**：—
- **缺陷追踪（§2.1）**：状态 **远期记录** · 优先级 P3（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：视频 hover 快捷工具条（竞品 DA-16）：依赖成片编辑/素材库未落地
  - **修法要点**：待 CV-006/040/043 前置落地再评估。本批未动

#### CV-086 · 项目分组管理（竞品 DA-17）→ 用户拍板做，2026-09-03 由 CV-091 落地（用户自定义分组 + 折叠，非拖拽归组）

- **状态**：已修复·待验收（由 CV-091 实现）（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P3
- **详情**：项目分组管理（竞品 DA-17）→ 用户拍板做，2026-09-03 由 CV-091 落地（用户自定义分组 + 折叠，非拖拽归组）
- **涉及文件**：projects.ts / ProjectList.tsx / routes.ts / client/*
- **缺陷追踪（§2.1）**：状态 **已修复·待验收（由 CV-091 实现）** · 优先级 P3（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：项目分组管理（竞品 DA-17）：原注册表扁平、项目个位数时价值低；用户拍板做，2026-09-03 由 CV-091 落地（用户自定义分组 + 折叠）
  - **位置**：`projects.ts`（`group?`→`groupId`）、`ProjectList.tsx`
  - **修法要点**：见 CV-091（分组渲染 + 折叠头 + 顶部新建分组 + 行内「移动到分组」下拉；非拖拽）

#### CV-087 · 项目封面缩略图（竞品 DA-18）→ 落产物增量写注册表

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：项目封面缩略图（竞品 DA-18）→ 落产物增量写注册表；红线：列表禁全量加载 canvas.json
- **涉及文件**：projects.ts / ProjectList.tsx / generate.ts / compose.ts
- **缺陷追踪（§2.1）**：状态 **待处理** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：项目封面缩略图（竞品 DA-18）：纯文字行识别效率低
  - **位置**：`projects.ts`（`coverUrl?`）、`ProjectList.tsx`
  - **修法要点**：落产物增量写 + 打开补写；**红线：列表禁全量加载 canvas.json**。本批未动

#### CV-088 · Lobby 个性化问候（竞品 DA-19）→ LobbyHero 增「你好，{USER_MOCK.name}」行

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P3
- **详情**：Lobby 个性化问候（竞品 DA-19）→ LobbyHero 增「你好，{USER_MOCK.name}」行
- **涉及文件**：LobbyHero.tsx / brand-copy.ts
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P3（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：Lobby 个性化问候（竞品 DA-19）
  - **位置**：`LobbyHero.tsx`、`brand-copy.ts`
  - **修法要点**：✅ 2026-09-02 落地：LobbyHero 增「你好，{USER_MOCK.name}」问候行，persona 与 CV-069 用户卡同源

#### CV-090 · 框选（marquee）交互改进 → ① 命中预览高亮 ② marquee 加 pointer capture 出界不取消

- **状态**：待处理（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：框选（marquee）交互改进 → ① 命中预览高亮 ② marquee 加 pointer capture 出界不取消
- **涉及文件**：CanvasSurface.tsx / styles.ts
- **缺陷追踪（§2.1）**：状态 **待处理** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**框选（marquee）交互改进**：拖拽过程中看不到哪些节点会被框中；指针划出画布表面即取消，无法跨列框大片区域
  - **位置**：`CanvasSurface.tsx`（Gesture marquee 分支）、`styles.ts`
  - **修法要点**：用户反馈「框选还是不好用」。CV-089 已排除 dim 干扰（原 dim 错挂在拖动上）。待做两项：① **命中预览高亮** —— 框选期间实时给相交节点加轻描边（Figma 行为），让用户松手前就知道选了谁；② **给 marquee 加 pointer capture** —— 出界不取消、回界继续框（CV-008/CR-060 当时刻意不捕获以防误选，现判据偏严苛）。拍板后再动

#### CV-091 · 左侧栏用户自定义分组 + 折叠

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P3
- **详情**：（竞品 DA-17 实际落地，原 CV-086 缓做项，截图标讨论用户拍板做）：数据层 `groupId` + 独立 `groups.json`，顶部「+ 新建分组」建组，分组头 `[+]` 就地建项目，行内「移动到分组」下拉归组（非拖拽），折叠态按 `groupId` 存 localStorage，「未分组」桶常驻兜底
- **涉及文件**：contracts/project.ts / projects.ts / routes.ts / client/api.ts / client/contracts.ts / client/project-store.ts / client/index.ts / client/ProjectList.tsx / styles.ts
- **缺陷追踪（§2.1）**：状态 **已修复·待验收** · 优先级 P3（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**左侧栏用户自定义分组 + 折叠**（竞品 DA-17 实际落地，原 CV-086 缓做项，经截图讨论用户拍板做）：分组维度=用户自定义分组（数据层 `groupId` + 独立 `groups.json`），新建项目走分组头 `[+]` 就地展开名称输入（非全屏 modal），侧栏顶部「+ 新建分组」按钮建组，项目行 hover 出「移动到分组」下拉归组（非拖拽），分组可折叠、折叠态按 `groupId` 存 localStorage 刷新保持，「未分组」桶常驻兜底（老项目 + 新建未分组）。全链路：Host 路由 → client api → inject → store → UI
  - **位置**：`contracts/project.ts`、`projects.ts`、`routes.ts`、`client/api.ts`、`client/contracts.ts`、`client/project-store.ts`、`client/index.ts`、`client/ProjectList.tsx`、`styles.ts`
  - **修法要点**：✅ 已落地：① 契约 `StudioProject.groupId?` + `StudioProjectGroup{id,name,order}`；② `ProjectRegistry` 独立 `groups.json`（`GROUPS_VERSION=1`，缺失/损坏降级空数组，零迁移风险），`create(name,groupId?)` 校验分组存在，增 `listGroups/createGroup/renameGroup/deleteGroup/moveProjectToGroup`（删组组内项目回落未分组）；③ `routes.ts` 新增 `ROUTE_GROUPS`（GET/POST/PATCH/DELETE，复用 authority + same-origin 校验）；④ `ProjectList.tsx` 重写——顶部双按钮 + 未分组桶 + 各分组 section（折叠头 `▾/▸`、双击重命名、hover `[+]` 组内新建、`×` 删组、空态），行内 `csProjectMove` 下拉归组；⑤ `styles.ts` 补 `csProjectGroup*`/`csProjectMove`/`csProjectRowActions`/`csProjectListActions` 等 15 类。验证链全绿：typecheck（Host+Client）✓ / build（tsdown + tsc）✓ / test:smoke **195/195** ✓。**待桌面验收**：重启桌面新建分组 → 折叠/展开持久化、组内新建、移动到分组、双击改名、删组回落未分组

#### CV-092 · 新建项目改弹窗（竞品截图风格）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P3
- **详情**：用户要求「+ 新建项目」从侧栏内联表单改为居中模态对话框（对齐竞品「新建创作页」截图）。弹窗含「名称」输入 + 「所属分组」下拉（📁 + 未分组/各分组），底部「取消 / 创建」；从顶部「+ 新建项目」进入默认未分组，从分组头 `+` 进入预选该分组，从 Lobby 欢迎屏「+ 新建项目」进入默认未分组。`createOpen` prop 仍经 `useEffect` 驱动（保持欢迎屏契约），分组头路径只走本地 state 避免把预选分组重置为空。移除旧内联表单（`formOpen`/`submit`/`submitGroup`/`groupFormKey`/`groupDraft`/`draftName`）与分组内联新建表单。复用既有 `.csModalBackdrop/.csModal/.csModalHeader/.csField/.csFieldInput/.csFieldSelect`，新增 `.csCreateGroupRow/.csCreateGroupIcon/.csModalFooter/.csModalBtnPrimary/.csModalBtnSecondary`
- **涉及文件**：client/ProjectList.tsx / styles.ts

#### CV-095 · 新增图像侧两个提示词规范 skill

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：视频侧有 `h3-prompt-writing`，图像侧长期空白，出图提示词靠模型即兴发挥。新增 `z-image-prompt-writing`（文生图：九段式、禁 negativePrompt、正向改写表、打光/文字渲染词表）+ `qwen-image-edit-writing`（图生图/改图：指令式四段式 操作+目标+规格+保留子句、多参考图分工、分步链式、inpaint 禁用替代路径）。总纲新增「图像提示词写法」小节做调度指引与两条硬约束（文生图禁传 negativePrompt；inpaint/style_transfer 禁调）。两个 skill 均 `hidden: true`（对标 h3-prompt-writing 的基础技能定位），体量 1.9KB / 2.5KB 按需加载
- **涉及文件**：skills-local/{z-image-prompt-writing,qwen-image-edit-writing}/SKILL.md / skills/ 同步副本 / skills-local/canvas-studio-creation/SKILL.md / src/skill-catalog.ts

#### CV-096 · 品牌图标正式稿（V2 Aperture Squircle）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：mark 定稿为「场记板核心隐喻 + 画布网格次级」的方形 squircle（64 网格），淘汰旧写实场记板（118×96 非方形、16px 点阵全糊）。新增 `scripts/build-brand-assets.mjs`（几何单一来源，配色解析 `src/brand.ts` 的 `BRAND_PRESETS` 不复制色值以避漂移），产出 `assets/brand/` 共 12 SVG + 21 PNG/ICO（主 mark / 浅底版 / 单色版 / 四套 preset 变色版 / 1024 应用图标七档 PNG / favicon 三档 / 横版 lockup）；`src/client/brand/LogoMark.tsx` 重写为 V2（颜色走 `--cs-accent`/`--cs-accent-deep` 令牌，明暗与预设联动）；`src/brand.ts` 的 `FAVICON_DATA_URL` 换为 V2 简化形（硬编码默认 cinema-violet 两色，favicon 不吃令牌）
- **涉及文件**：scripts/build-brand-assets.mjs / assets/brand/ / src/client/brand/LogoMark.tsx / src/brand.ts

#### CV-101 · 东方异境视觉导演 skill 外挂试跑（第三方 MJ skill 接入验证）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：外部 skill《东方异境视觉导演 v0.3 · MJ 8.2 STYLE LOCK》（1720 行，Midjourney 向）接入验证，采取**原文零改动**策略——`skills-local/oriental-mythic-visual-director/references/oriental-director-v0.3.md` 原样存放全文，另写薄 `SKILL.md`（约 90 行）只做三件事：① frontmatter（description 321 字符，未触 1024 截断上限）；② **覆盖失效的 MJ 层**（`--ar`/`--stylize`/`--no` 与 21:9 在本项目无效 → 改为 image_generate 的 prompt 编译顺序 + negativePrompt 基线 + H3 视频模式；画幅收敛 16:9/9:16/1:1；`style` 固定 realistic、禁 anime）；③ 流程衔接（三方向走 ask_user_choice 而非「不等待直接落地」、系列视觉圣经写进剧本节点不另建、门禁不变）。catalog 条目 category=style / **hidden=true**（试跑期不上广场）。【2026-09-09 修订：hidden 已移除，上广场 + `stage:'preview'` 试跑角标——当初不上广场的两个理由（无上游 demo GIF、风格追问未接入）已分别被 CV-116 降级占位与 CV-109 预设表扩容消解，用户拍板放开；stage 语义同步修订为与可见性正交（详见 CV-118）】验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **272/272** ✓ / verify:loader ✓（注册 14 个 skill，新 skill 已注册且 description 未截断）。**待桌面验收**：`skill(name="oriental-mythic-visual-director")` 手动加载 → 跑原文 §31「桂花·月下桂海」案例 → 看出图是否达到「真实电影人物 + 绘画化东方异境」；成立再接入总纲风格预设（第 9 类）
- **涉及文件**：skills-local/oriental-mythic-visual-director/{SKILL.md,references/oriental-director-v0.3.md} / src/skill-catalog.ts

#### CV-102 · 无 fork 附件旁路 + 上传标题唯一化 + 画布刷新白名单补漏

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：① 运行时包装 `conversation.sendSession` 实例方法替代已丢失的 harness dist 补丁（`registerAttachmentDivert`），harness 仓库零改动、可干净跟升级；② `src/reference-token.ts` 新增 `sanitizeTitle`（去括号）+ `uniqueTitle`（重名插序号 `image 2.png`），接入 `client/index.ts` 与 `StudioFrame.tsx` 两处上传入口，修多张上传图重名导致 `@ref` 丢失；③ `asset-capture.ts` 的 `STUDIO_TOOL_KINDS`（媒体类）与 `WORKFLOW_TOOLS`（文本/状态类）覆盖全部写 canvas 的工具，修三视图/上传图生成后画布不实时刷新。已 push（fc8592cd73）。方案：[attachment-divert-no-fork.md](./plans/attachment-divert-no-fork.md)
- **涉及文件**：src/index.ts / src/reference-token.ts / src/client/index.ts / src/client/StudioFrame.tsx / src/asset-capture.ts

#### CV-103 · C1 一致性资产锚点（自 WL 仓库收敛）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：数据模型 v3→v4（`StudioAsset` + 节点 `assetId` + 文档 `assets`）；`projects.ts` 增 `upsertAsset`（writeCanvas 省略 assets 时保留，拖拽不丢卡）；`generate.ts` 增 `generateCharacterSheet`（image2character 四视图 → splitegrid 2×2 切分 → 分图回传 Drama → 落节点并建卡；切分失败抛错降级单锚点）；`host-tools.ts` 注册 `character_sheet` 工具（@ref 自动解析）+ `renderCharacterSheetResult`；测试 12 用例全绿。**真机联调挂起**：drama-api（本地 3005 / 远程 8082）不可达，端到端未跑通。已提交未 push（c05ad94113）。方案：[canvas-studio-consistency-solution.md](archive/plans/canvas-studio-consistency-solution.md)
- **涉及文件**：src/contracts/canvas.ts / src/projects.ts / src/generate.ts / src/host-tools.ts / tests/{asset,reference,asset-capture}.test.mjs

#### CV-111 · character_sheet 参考图失效自愈

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：用户报「调用生成角色多视图报服务不可用，但功能测试没问题」。日志 + 后端实测复现定位：输入 filename（`z-image_00802_.png`，早前 image_generate 产物）在 Drama temp/ 已丢失（重启清存储），`image2character` 入口 0.1s 报笼统 500；`runGeneration` 有 `callWithFallback` 自愈（isBadReferenceError → 画布本地资产重传换新名 → 重试）但 `generateCharacterSheet` 裸调 `callDrama` 未接该链。修复（方案 A，最小改动）：step 1 加同款自愈——按 filename 反查画布节点 → `readLocalAssetBytes` 重传 `uploadBytesToDrama` → 回写节点 filename（不变式：节点 filename = 后端当前可用名）→ 带新名重试一次；反查不中抛原始错误，非参考图类错误（4xx 参数错）不触发重传。新增 tests/character-sheet.test.mjs 3 用例（自愈成功/资产缺失保留原始错/非失效错误直抛）。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **335/335**（+3）✓ / verify:loader ✓
- **涉及文件**：src/generate.ts / tests/character-sheet.test.mjs（新）

#### CV-120 · creative-mechanisms 按风格打通（机制库「沉睡」修复）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：30 个 T8 叙事机制此前仅街采/惊变 2 个 skill 引用，其余 9 个风格 skill 0 触达。选定**单点索引**方案（放弃逐 9 skill 加「机制衔接」节——机制匹配稀疏会凑数，且 B2 去重重写时要逐个迁移）：① `references/creative-mechanisms.md` 末尾新增「风格技能 × 机制速查表」——11 个风格技能全部给出首选机制与套用要点（co-op-game→ensemble-dyad、music-video→continuous-emotion-escalation、oriental-mythic→extraordinary-visitor、papercraft→bounded-day-loop 等；街采/惊变标注已自带衔接节），并声明本表为风格↔机制映射**唯一权威**、未列入=无强匹配不要硬套；② h3 SKILL.md 五步 Workflow 第 1 步加「风格技能联动」钩子（激活风格技能时先查速查表选定机制再判模式），参考文件清单同步标注。为 B2（CV-121 总纲拆分+风格去重）预留约束：去重时保留「叠用 h3-prompt-writing」指令保钩子链，机制映射只引用速查表不复制。顺手修正「10s 纪」→「10s 级」笔误。验证：sync-minimax-skills 同步后源/产物一致，test:smoke **352/352** ✓（纯 skill 内容改动，不触 src）
- **涉及文件**：skills-local/h3-prompt-writing/{SKILL.md, references/creative-mechanisms.md} / skills/h3-prompt-writing/（同步产物）

#### CV-121 · 总纲拆分 + 风格优先原则（B2，方案 Z + 优先级反转）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：总纲 49KB 单体（15 节，references=0）拆为**路由级骨架 14.8KB + 7 个 references 分册**（49KB→14.8KB）：clarification（澄清细则）/ toolchain（工具链全表+供应商差异）/ prompt-writing（图像+视频提示词写法）/ style-presets（风格预设 11 类+画风选择）/ screenplay（剧本创作）/ shot-format（分镜表+镜头词汇+衔接语义+逐镜参考组合+成片自检）/ consistency（资产卡+预处理+逐镜复用+QC 闭环+返工版本+一致性要点）。取舍原则：SKILL.md 只留「每次激活都必须进上下文」的路由级内容（执行模式与审批门禁全量、核心规则全量、工作流骨架每步带指针），「到第 N 步才需要」的一律抽走、骨架处放显式「必读」指针。**方案 Z（风格 skill 去重不做文件改写，按用户拍板执行优先级反转）**：核心规则新增「风格 skill 优先原则」——激活风格 skill 后其流程/选项卡/风格规则与总纲冲突时**以风格 skill 为准**（用户指定方向，特化优先于通用底座）；安全底线例外不参与：审批门禁、一致性硬约束（lockedPrompt 逐字节复用/qc_shot/replaces）、工具参数硬限制——任何 skill 不得绕过。style-presets.md 头部同锚该原则 + CV-120 机制速查表联动。**防回弹门禁**：skill-catalog.test.mjs 新增 2 断言（总纲 ≤15KB 且含路由级标记、≥8KB 防误删 + 7 分册存在；style-presets.md 须覆盖 11 个风格 skill id）；skill.test.mjs 内容覆盖断言改用「主文+全部分册」合并文本（意图不变：规则能被 agent 读到即覆盖，防拆分弄丢规则）。验证：sync 后源/产物一致，test:smoke **354/354**（+2）✓。**待桌面验收**：跑一条风格片，观察 agent 澄清前读 clarification.md、写提示词前读 prompt-writing.md、风格 skill 与总纲冲突时按风格走且不越过门禁
- **涉及文件**：skills-local/canvas-studio-creation/{SKILL.md, references/×7} / skills/canvas-studio-creation/（同步产物）/ tests/{skill-catalog,skill}.test.mjs

#### CV-122 · character_sheet 去 splitegrid 依赖：四视图拼图整图作唯一锚点

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：用户跑片报 `image2splitegrid` 笼统 500（Drama 后端已知特征），引发「切分 API 是否该存在」讨论。核查结论：① 端点真实存在（实测空参 200），本次 500 是该拼图输入的特定问题；② 但上游官方资料（3D 动画 skill STEP 3「character cards should be a 16:9 production reference sheet…clear readable labels」+ T8 官方案例「常驻参考板」+ H3 ref-en.txt 一 Subject 一图语法）**支持整图直接作参考**——切分是 WL 适配器自创的工程化路径，非官方要求。按用户方案改造：generate.ts 砍掉切分+逐片下载/上传整段（~60 行），资产卡锚点 = 拼图整图单节点，结果新增 `filename` 字段（拼图 Drama 名，直接作 image_generate / video_composite 的 filenames）；工具 description / 渲染文案 / 输出 schema 同步；host-tools `renderCharacterSheetResult` 改单锚点文案。参考预算反而更省（逐镜从「正面+全身 2 张」变「拼图 1 张」）。`image2splitegrid` 端点保留给 storyboard_split。skill 侧同步：consistency.md / 总纲第 5/6 步 / shot-format.md「锚点分图」表述全部改「锚点拼图」。测试 character-sheet.test.mjs 更新（不再调 splitegrid 断言 + 锚点单节点断言）。连锁收益：本次 500 整类消失。风险与防线：整图参考的「分屏/特征平均化」伪影风险靠 lockedPrompt 逐字节复用对冲，跑片验收确认
- **涉及文件**：src/generate.ts / src/host-tools.ts / tests/character-sheet.test.mjs / skills-local/canvas-studio-creation/{SKILL.md, references/consistency.md, references/shot-format.md} / skills/（同步产物）

#### CV-126 · 音乐先行（Master Audio First）工作流

- **状态**：拟立项·待拍板（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：长视频配乐目前是「视频先行、第 10 步才贴 BGM」，与官方规范（项目已接入的 `music-video-subtitle-generator` L63/L76/L164/L174/L191）相反——官方要求先锁一条主音频再按拍拆镜。方案见 [archive/music-first-workflow-plan.md](archive/music-first-workflow-plan.md)：① 总纲新增第 2c 步「主音频锁定」（music_generation，duration=目标成片时长，分镜之前完成）；② 第 3 步分镜改为音乐驱动型的 2–5s 短镜 + 切点对齐 1/4–1/8 拍格（新增「拍点」列）；③ 第 9 步条件启用 `<Audio N>`（主音频作参考，跨镜音乐连续）；④ 第 10 步明确「不拉伸、循环仅兜底」；⑤ 新增分册 `references/audio-first.md`（触发条件判定 + 按拍规则 + Music3 caption 三段式 + 硬切纪律）。触发条件严格限定音乐驱动型（MV 字幕/品牌宣传/音乐视频/强节奏广告），讲解剧情类维持现状 7–10s，避免一刀切推高成本。配套代码分 P0–P4 五期，**P0 为纯 skill 文档、不依赖后端**；P2/P3 卡后端两个待确认问题（`filenames` 能否收 mp3 决定 `<Audio N>` 落地；是否启用 `generateAudio` 原生音轨决定要不要禁各镜独立音轨）。**状态：方案已出，等用户拍板后再动总纲**（2026-09-10 用户拍板：**降级** —— 后台暂无时间支持长音频 / 统一音轨能力，音乐先行暂不推进，改为先走 [音轨与视频合并路线](./av-timeline-plan.md)（CV-131）；本方案存档待后端就绪再启）
- **涉及文件**：已降级·待后台支持

#### CV-127 · 音乐提示词规范 skill + music_generation 工具增强（音频生成规划 A+B）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：承接 [audio-generation-plan.md](./audio-generation-plan.md) 阶段 A/B。① 新建 `music-prompt-writing` skill（skills-local 源 → sync 进 skills/）：薄主文 ~5KB 讲清能力边界（后端仅 text2music 7 参数，无 seed/reference/cover/repaint）、**duration 必须等于成片时长**、纯器乐默认路径（lyrics 留空 + language=unknown）、Caption 五步拼装（流派→乐器→音色→情感，BPM 不写进 caption）、Lyrics 结构标记纪律、参数取值边界表、抽卡策略；两个分册 `references/tag-dictionary.md`（117 标签：乐器 38 / 音色 7 / 流派 25+BPM / 情感 8 / 调性 27 / 综合风格 12 + 万能模板与组合速记）、`references/caption-lyrics-rules.md`（Caption 九维度与七原则、Lyrics 结构/人声/能量标记表、音节与分段技巧、纯器乐写法、AI 味五红旗、元数据边界「模型是参考不是执行」、输入控制总表标注后端未暴露项）。catalog 条目（prompting 分类 / hidden，与 h3-prompt-writing 等写作类一致）。② 工具增强（CV-125 实测暴露的 4 项）：`lyrics` 留空自动填 `[Instrumental]`（原传空串语义不明）、结果回显 `duration` / `bpm`（供分镜按拍拆镜与成片对齐；注释警示**响应 duration 是生成耗时而非音频时长**）、description 与参数描述加 skill 指针与取值边界、output schema 增两字段 + render 回显「规格: Ns / N BPM」。测试：新增 `tests/music-prompt-writing.test.mjs`（4 用例）、`tests/music-generation.test.mjs` 补默认 lyrics 与回显断言（共 365/365 绿）。（CV-127b 追加：**实测后端 txt2audio 存在偶发 500**——同参数一次 200 一次 500（`E minor`），且分两种形态：快失败 ~0.07s（请求没进队列=参数未被接受）与慢失败 ~8.6s（生成过程中崩溃，纯偶发），一律不给原因；`Em`/`E minor` 被拒而 `C major`/`Am`/`Emin` 可过，无稳定规律可教给 agent。故 generateMusic 加自愈：快失败摘非核心字段（keyscale→timesignature→bpm）重试，慢失败原样重试，最多 3 次（纯函数 planMusicRetry，4 个新用例）；结果回 `degradedFields` / `attempts`，render 显式警告「该参数未生效，不要声称已按它生成」——这是「不让智能体产生错觉」的关键；显式传空 lyrics 也按纯器乐兜住（原 `??` 只兜 undefined）；节点 generationPrompt 改记最终生效参数。skill 主文加「软提示铁律」+ 分册写明元数据可能被整条拒绝。371/371 绿；**真后端 E2E 用原出错参数（keyscale=Em + lyrics=""）已能自愈出音频，16.6s，degradedFields=[keyscale]**）。**待桌面验收**：对话里让 agent 生成 BGM，看是否加载 music-prompt-writing、lyrics 是否 [Instrumental]、结果是否回显规格
- **涉及文件**：skills-local/music-prompt-writing/{SKILL.md,references/*.md} / src/{skill-catalog,generate,host-tools}.ts / tests/{music-prompt-writing,music-generation}.test.mjs / skills/（同步产物）

#### CV-128 · 画布音频节点显示 + 就地播放（kind='audio' 独立成类，不再复用 video）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：用户要求音频节点在画布上可见且可播放。① 契约 `StudioCanvasNodeKind` 增 `'audio'`；② `projects.ts`：`isCanvasNode` 接受 audio，`normalizeCanvasDocument` 把 CV-125 时代以 `kind='video'+operationType='text-to-audio'` 落盘的遗留音频节点归位成 `audio`（纯函数 `migrateAudioNode`，单测）；③ client `CanvasNode` 渲染独立音频卡片（♪ 图标 + 标题 + 时长 + 波形条 + 播放/暂停按钮 + 进度条，全局单实例播放、卸载清理），double-click 仍开详情面板；④ `LayerPanel` 缩略图显示 ♪、`LayerDetailPanel` 加试听 `<audio controls>`、`canvas-actions.canDownloadNode` 支持 audio（扩展名 .mp3）、`Minimap.NODE_COLORS.audio`、`labels.KIND_LABEL.audio='音频'`+`OPERATION_LABELS['text-to-audio']='BGM 生成'`、`project-store.NODE_SIZE.audio=260×84`；⑤ `compose.collectClips` 仅收 `kind='video'` 天然排除 audio，mp3 不会被当一镜拼进成片；⑥ `styles.ts` 音频卡片 + 详情/图层样式。测试：`music-generation.test.mjs` kind 断言改 audio + 新增迁移单测（372/372 绿）。**待桌面验收**：生成 BGM 后画布出现音频卡片可点播、详情面板可试听、图层列表显示 ♪
- **涉及文件**：src/{contracts/canvas,projects,canvas-actions,generate}.ts / src/client/{canvas/CanvasNode,canvas/LayerPanel,canvas/LayerDetailPanel,canvas/Minimap,canvas/labels,project-store}.tsx/.ts / src/client/styles.ts / tests/music-generation.test.mjs

#### CV-129 · H3 官方音频通道按标准落地（audio reference / audio reuse / 原生音轨）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：依据用户「按 H3 官方标准实现，后端暂不支持也先补上」的拍板。官方规格（MiniMax H3 API reference + fal `minimax/h3/reference-to-video` + HF 汇总三源交叉核实）：参考音频 ≤3 段、单段 2–15s、**合计 ≤15s**、WAV/MP3、单段 ≤15MB、**不能作为唯一输入**（必须配图或视频）、帧模式(FLF)与参考模式(r2v)互斥、原生音频与视频**同一次推理**产出。落地：① 新建 `src/audio-reference.ts` 纯函数校验（`audioExtensionOf` / `validateH3AudioReferences` / `audioModeNotice`）；② 契约 `VideoRequest` 加 `audios` + `generateAudio`，`capabilityOf` 带音频一律走 multi-reference（**压过首尾帧语义**——否则「1 关键帧 + 1 音频」会被误判成 FLF）；③ drama 适配器音频落 `audio1..audio3`（延续 image1..image6 命名；**2026-09-10 后端更新已确认字段名就是 `audio1`–`audio3`**，无需改动）+ `generate_audio`；④ fal 适配器走 `reference_audio_urls`，新增 `toFalAudioDataUri`（**刻意不复用图片编码**——那条路径含 ffmpeg 压 JPEG，套音频会产出坏载荷）；⑤ 工具层 `video_generate` / `video_composite` 加 `audioRefs`（@ref 解析），IR 预检按 Ref2VA 并传 `audios` 计入 `<Audio N>` 标签上界；⑥ 生成层预检（时长优先取画布音频节点 duration、字节数读本地资产），不合规**生成前直接报错**；失败时把音频参数显式点出（避免笼统 500 被误读成参考图失效）；⑦ skill：h3-prompt-writing 补「音频参考的官方硬规格」，总纲 toolchain 更新 generateAudio/audioRefs 现状（generateAudio 由「占坑」改「已透传·缺省不发送」）。**关键决策（用户拍板）**：字段名取 `audio1..audio3`、原生音轨**默认不发送**。测试 +13 → 385/385 绿。**待桌面验收**：对某镜传参考音频 / 开原生音轨，看是否按官方规格预检、被拒时是否明确提示后端未开放
- **涉及文件**：src/audio-reference.ts / src/providers/{types,capability,drama,fal,reference}.ts / src/{generate,host-tools}.ts / skills-local/{h3-prompt-writing,canvas-studio-creation} / tests/{audio-reference,video-provider-drama,video-provider-fal-refs}.test.mjs

#### CV-130 · 画布音频体验四件套（生成后即时刷新 / 歌词上画布 / 可拖进度条 / 双击播放器窗口）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：① **「生成音频后画布不刷新」根因**——`src/asset-capture.ts` 的 `STUDIO_TOOL_KINDS` 是「工具能否上画布」的**唯一白名单**，`music_generation` 从未登记 → `tool/call` 不建 start → `tool/result` 的 update 在 conversationEvents 里找不到挂载点 → `reloadCanvas` 永不触发（产物其实已写进 canvas.json，只是画布不知道，要切窗口/重开项目才看见）。与当年 `character_generate` 漏登记同一类 bug。修：白名单补 `music_generation: 'audio'` + `NODE_SIZE_PENDING.audio` + 2 个防回弹用例（白名单命中 / 结算确实触发 reloadCanvas，且走媒体分支而非 workflow 分支）。② **歌词上画布**——节点契约新增 `lyrics`（值 = 实际提交给后端的 `lyrics_prompt`），`generateMusic` 写生效歌词、`MusicResult` 回显、render 加「歌词已随节点上画布，双击看全文」；画布音频卡片加歌词摘要行（取首个非结构标记行；`[Instrumental]` 渲染成「纯器乐 · 无歌词」，有词/无词都占位 → 卡片高度不跳动），详情面板加歌词全文（限高可滚动）。`INSTRUMENTAL_LYRICS` 由 Host 的 `generate.ts` 上移到共享契约（客户端也要靠它区分「纯器乐」与「真歌词」），Host 侧转出保持既有导入面。③ **可拖进度条**——画布卡片进度条改 pointer capture seek（命中区 4px→14px、`stopPropagation` 防止被当成拖拽节点、`seekingRef` 防止 timeupdate 把位置回拽）。④ **双击开播放器窗口**——新建 `AudioPlayerModal`（与 `VideoPlayerModal` 同构：自绘控制条 + 可拖进度 + 当前/总时长 + 音量/静音 + Escape 关闭 + 点舞台切播放），舞台区把画面让给**歌词**（有词逐行铺开可滚动、`[Verse]` 类结构标记弱化显示；纯器乐时走波形动画），歌词区点击不切播放（避免划选/复制误触）；`StudioFrame` 的播放浮层按 `kind` 分派，hover 素材卡点击也进播放器。⑤ 尺寸防漂移——`AUDIO_NODE_WIDTH/HEIGHT` 提为契约常量（Host 落盘 / client `NODE_SIZE` / 占位节点三处同源，此前 260×84 是两边手写），`migrateAudioNode` 把历史 84 高音频节点抬到 116（音频节点没有 resize 手柄，尺寸偏小不可能是用户意图）。⑥ skill——`music-prompt-writing` 增「歌词要『交出去』——它会落到画布上」节：写完整成品歌词、改词必须重新调 `music_generation`、纯器乐走默认路径、给出验收判据（返回带 `lyrics` 字段 + 卡片摘要行显示的是要的那句）。验证链全绿：tsdown ✓ / tsc 双端 ✓ / sync ✓ / test:smoke **390/390**（+5）✓ / verify:loader ✓。**待桌面验收**：让 agent 生成一首带歌词的歌 → 卡片摘要行出现歌词首行、双击出播放器可拖进度看全文；纯器乐显示「纯器乐 · 无歌词」；音频生成本身不再需要切窗口才出现
- **涉及文件**：src/asset-capture.ts / src/contracts/canvas.ts / src/{generate,host-tools,projects}.ts / src/client/{index,project-store,StudioFrame,styles}.ts(x) / src/client/canvas/{CanvasNode,LayerDetailPanel,AudioPlayerModal}.tsx / skills-local/music-prompt-writing/SKILL.md（+ skills/ 同步产物） / tests/{asset-capture,music-generation}.test.mjs

#### CV-131 · 音视频统一时间轴 + BGM 时长对齐（音轨与视频合并路线）

- **状态**：🚩 已立项·待启动（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：用户拍板——音乐先行（CV-126）降级（后台无时间支持长音频 / 统一音轨），**先走「音轨与视频合并」**（先出视频 → 生成 BGM → amix 混音）。核实结论：**目前没有统一时间轴**，只有 5 个分散机制——① 目标总时长 `targetDuration`（`contracts/project.ts:102`，仅经 `plan-prompt.ts:45-51` 注入 prompt 推镜头数）；② 分镜表「时长」列（**纯文本**写在分镜卡正文，`host-tools.ts:404`）；③ 逐镜 `duration` 参数（agent 手填，`clampDuration` 钳 1–15）；④ 节点 `duration`（`generate.ts:1314/1330/1386` 存的是**请求值**）；⑤ 成片真实时长（`compose.ts:351` ffmpeg 探测，全链唯一真实数据，但拿到时已晚）。**四个断点**：① 分镜表之和 vs 目标总时长只有 skill 自检条款、无工程校验；② **请求时长 vs 模型真实产出从不比对**（`parseFfmpegDuration` 只被 `compose.ts:330/351`、`video-frames.ts:102`、`video-style.ts:147` 调用，**生成主路径 `generate.ts` 完全没接**）→ 画布/`list_shots` 显示的时长可能一直是错的；③ 成片时长 vs BGM 时长无守卫；④ 时间线无时间刻度（= 已挂的 CV-007，D2 延后）。**死结**：BGM 时长必须等于成片时长，而成片真实时长合成前不可知，现只能拿分镜表声明之和估。**方案**：路线 A 声明值驱动（结构化时间轴指导生成，一次成型，但把成败押在「模型守时」上）/ 路线 B 真实值驱动（先合成无声成片 → 探测真实时长 → 生成等长 BGM → 二次合成，**数据硬对齐、不依赖模型守时**，零件全都有）/ 推荐 **B 为主 + A 为辅**。**第一步必做**：实测 H3 对 `duration` 的遵守度（音频侧已实测 ±0.03s，**视频侧从未测过**——决定路线 A 是否可信）。P0（真实时长探测接入生成路径）与 P1（守时实测）不依赖拍板方向，可立即做。详见 [av-timeline-plan.md](./av-timeline-plan.md)
- **涉及文件**：docs/av-timeline-plan.md

#### CV-132 · 视频生成模式选择：从「图片数量」改为「图片语义」驱动

- **状态**：🚩 方案已定稿·待实施（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：用户观察——只给一张角色参考图时，编排把它当**首帧**直接生成视频，于是参考图本身出现在成片里；用户给出的正确形态是「参考图 →（`image_generate` 据此出关键帧）→ 关键帧 →（`video_generate` 首帧）→ 视频」。核实结论：判定入口 `capabilityOf`（`src/providers/capability.ts:42`）**只看图片数量**，入参 `CapabilityInput` 只声明 `filename` / `filenames` / `audioRefs`（同文件 `:17-26`）。**三处硬伤**：① **单图 = 首帧，从不问语义**——同一张定妆照走 `video_generate(filename)` 当首帧（视频 0.00 秒就是它本人），走 `video_composite(filenames=[1 张])` 当参考（→ `ref2va`，官方 r2v），两个入口语义完全相反，而分界线只是「调用了哪个工具」；工具描述还在**反向引导**（`filename` 说明原文即「用作视频首帧」）。② **`referenceRole` 字段存在但生成链路零消费**——`contracts/canvas.ts:161` 定义 `referenceRole?: 'image'\|'character'\|'style'\|'frame'`，注释明写「**决定 agent 选用哪个生成工具与强度**（Runway 式分类）」，详情面板有选择器（`LayerDetailPanel.tsx:306`）、节点有徽标（`CanvasNode.tsx:589`）、`list_references` 也把 role 报给模型（`host-tools.ts:849`），但 `capabilityOf` 的入参里根本没有 role。③ **单图分支自相矛盾**——`capabilityOf:50` 判 `multi-reference`（→ `ref2va`），H3 IR 预检判 **`I2VA`**（`host-tools.ts:986`），工具描述则完全没写 1 张的分支：agent 按 Ref2VA 写 IR 会被 I2VA 预检拦下，按 I2VA 写则预检通过但请求被送到 `ref2va`，**两边必有一边是错的**。**现状只覆盖一半**：总纲第 5 步（逐镜出图）/ 6b（关键帧审批门禁）/ 9 步（`SKILL.md:82`「参考组合优先——默认 `video_composite` 多参考 Ref2VA，都不适用才退 `video_generate`」）本已要求关键帧先行，但**零工程约束**（直接 `video_generate(filename=参考图)` 不报错不告警）+ 工具描述反向引导 + 单图最易短路 = 「纪律靠文档、无工程兜底」，与 CV-119 之前的状态同类。**方案候选**：**D** 修 §③ 口径不一致（必做，明确 bug，与方向之争无关）/ **A** 角色驱动（`CapabilityInput` 加 `roles`，单图 + `role ∈ {character,style,image}` 判 `multi-reference`，推荐作主方案）/ **B** 预检拦截（`filename` 对应节点 role ≠ `frame` 且非 `extract_last_frame` 产物 → 直接报错，宜作严格模式开关）/ **C** 流程编排（「参考图 → 关键帧」升为硬步骤 + 缺关键帧自动补一步 `image_generate`，并入 CV-131 批次）。**方案定稿（2026-09-10 下午，用户三问已答）**：用户拍板 ① 分派按图是什么——**关键帧走 I2VA、参考图走 Ref2VA**；② **保留后门**（「给一张图生成从这张图开始的后面 10 秒」）；③ **自动补一步**（甚至可直接复制一遍）。**新增第 4 处硬伤**：两个工具描述对 role 的期待**正好相反**——`video_generate`（`:886`）说「role=**frame** 的参考即首帧图」，`video_composite`（`:942`）说「role=**character/image** 的参考即可用」，而缺省 role 就是 `image`（`:849`）→ 描述互斥、实现谁都没读。**用途能否自动判断（用户问题①）**：能，但分层——**L1 显式声明**（`referenceRole` / 新增 `intent`）/ **L2 来源溯源**（节点 `toolName`：`extract_last_frame`→必为帧、`character_sheet`/`character_generate`→必为角色锚点、`storyboard_*`→帧、`style_transfer`→风格，画布内产物近乎 100% 可判）/ **L3 血缘**（`sourceIds`）/ **L4 语义判断**（由 agent 读 prompt 与对话）/ **L5 安全默认**；**但 L2 恰好看不到用户新上传/新贴的图**（`origin='manual'` 与对话贴图旁路落卡的 role 缺省都是 `image`）——**这正是 bug 现场**。**定稿方案：关键帧归一化（Keyframe Normalization）**——不问「该用 I2VA 还是 Ref2VA」，而问「画布上有没有明确的关键帧」：没有就先补一个（§9 的 `promote-copy` 复制 / `promote-generate` 重画，由意图决定），有了就一律 I2VA。归一化后「参考图被当第 0 帧」在**结构上不可能发生**（失败代价不对称：误判 I2VA = 参考图烙进成片=事故；误判 Ref2VA = 仅首帧未锁定=软失败 → 默认必偏 Ref2VA）。**后门（问题②）**：不新增晦涩参数，而是走「copy 成关键帧 + I2VA」，进入 I2VA 的三条合法路径（role=`frame` / L2 溯源为帧 / 显式 `intent='start-frame'`）之外**不再隐式当首帧**，改为报错 + 修复指引。**自动补步（问题③）**：用户提的「直接复制一遍」**是最优解之一**——「从这张图开始」的场景下用户给的图**就是**他要的起点，重画会改变它，复制零成本零失真；**技术零新增依赖**（`image_generate` 已原生支持参考图输入 `host-tools.ts:563`）。配套四要求：补出的关键帧**必须可见**（落画布）/ **必须告知**（结果回显）/ **走 6b 审批门禁** / **可关闭**。实施顺序：**P1** 修口径 + 首帧入口收紧 + 角色驱动判定（bug 级、与方向无关）→ **P2** 归一化 + `intent` 参数 → **P3** 总纲同步。详见 [video-mode-selection-plan.md](./video-mode-selection-plan.md)
- **涉及文件**：docs/video-mode-selection-plan.md

#### CV-133 · 生成请求的超时配置被 undici 300s 隐形上限架空（配置失效）

- **状态**：✅ 已修复·待验收（CV-135 落地）（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P0
- **详情**：由 CV-131 的「`duration=10` 疑似打挂后端」追出，**结论历经三次修正**（打挂后端 → 探针超时 → 后台在测试 + 客户端隐形上限）。**核心**：Node 内置 `fetch`（undici）的 dispatcher 默认 `headersTimeout = bodyTimeout = 300s`，且**先于 `AbortSignal` 触发、与之无关** → `DRAMA_TIMEOUT_MS = { image: 360_000, video: 600_000, text: 180_000 }`（`generate.ts:203`）里 image / video **两档都超过 300s，实际不可达**，有效上限恒为 300s；叠加 `dramaPost` 失败**自动重试一次**（`:359-377`）→ 单次生成最坏 **300s + 300s = 10 分钟**才失败，且报错文案「Drama Backend 连接失败（已重试一次）」会把人误导到「后端不可达」。**直接后果**：`video_composite` 默认时长就是 **10s**（`host-tools.ts:947`），而 10s 推理在负载期已 >301s → **当前「随机失败」的最可能来源**。**证据链**：① 探针三次失败 `wallMs` 精确 = **301.0 / 301.1 / 301.2s**，错误码 **`UND_ERR_HEADERS_TIMEOUT`**（undici 专有；而探针 `TIMEOUT_MS` 实为 900s，**从未触发**）；② 错误码是「响应头超时」而非「连接错误」→ 连接已建立、是客户端先放弃；③ **本地复现**：起「只接不回响应头」的服务器，`AbortSignal.timeout(2000)` 抛「The operation was aborted due to timeout」且**无** `UND_ERR_*` → 证明那一刀来自 undici 而非我们的信号；④ undici 官方文档 `headersTimeout / bodyTimeout Defaults to 300 seconds`。**修法候选**：① 自定义 dispatcher（`undici` 当前**不可 require**，需引依赖）；② 该 POST 改走 `node:http`（零依赖，**本探针已采用**）；③ 承认 300s 为正式上限，改短超时 + 明确文案。**已撤回**：原「后端单通道串行 + 客户端超时不取消后端任务 → 假死 20 分钟」推断——`/health` 长时间不响应的真相是**后台当时在测试**（用户确认）。详见 [av-timeline-plan.md](./av-timeline-plan.md) §4.4 / §5(P0-A)
- **涉及文件**：src/generate.ts / canvas-studio/scripts/h3-duration-probe.mjs

#### CV-134 · 对齐后端 0.2.8「全能参考」扩容（image 6→9 / 新增 video1..video3 / 参考文件总数 ≤12）

- **状态**：🚩 已立项·待拍板（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：后端 2026-09-10 更新——`image2videoref2va` 参考图扩到 **`image1`–`image9`**，新增 **`video1`–`video3`（参考视频：驱动动作 / 运镜 / 节奏，画面不复用，且其自带音轨计入音频 ≤15s 预算）** 与 **`audio1`–`audio3`**（字段名与我们早已落的一致 → **C 音频通道由「后端未开放」正式转正**），单次参考文件总数 **≤12**，输出 24fps。**需做三件**：① **图片上限 6→9**（`providers/drama.ts:71` 的 `sliceToMax(images, 6)`）——该「6」在**四处以上**被引用（`types.ts:158` 注释、`host-tools.ts:942/945` 工具描述、`skills-local/…/toolchain.md:22,43`、`shot-format.md:22`、`SKILL.md:82`、`tests/video-provider-drama.test.mjs:105`、`tests/video-provider-fal-refs.test.mjs:197`、`docs/api.md`、`docs/canvas-studio-api-usage.md` 五处），**属「四处同改」型改动，须先列清单再动**，否则必漂移；② **video1..video3 参考视频通道**——目前**完全未接线**（契约无 `videos`、工具无 `videoRefs`、skill 未写用法），它是「参考上一镜动作/运镜保持连贯」的官方解法，价值高，可复用 audios 的落地范式；③ **参考文件总数 ≤12 的预检**（图 + 视频 + 音频合计，现无任何校验）。**另有两项待确认**（已在 api.md 标注 ⚠️）：`aspect` 枚举去掉 `9:16`（我们竖屏仍硬传 `'9:16'`，`providers/drama.ts:37`）→ 竖屏该传什么？响应 `duration` 是否又是「生成耗时」（示例：请求 5 / 响应 8.50）→ 不可当视频长度消费
- **涉及文件**：docs/api.md / src/providers/drama.ts / src/host-tools.ts / skills-local/canvas-studio-creation/ / tests/video-provider-*.test.mjs

#### CV-135 · 长请求传输层：把 Node 内置 fetch 的隐形 300s 上限抬到 900s（= CV-133 的落地修法）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P0
- **详情**：undici 的 `headersTimeout = bodyTimeout = 300s` 且**先于 AbortSignal 触发**，使 `DRAMA_TIMEOUT_MS` 的 image(360s) / video(600s) 两档不可达、有效上限恒 300s。**方案取舍（用户拍板「尽量干净、上限 900s」，三选一）**：① 引入 `undici` 依赖自建 Agent ❌（会被打进 Electron 插件产物）；② 全仓改走 `node:http` ❌（**fetch 同时是测试缝**——10 个测试文件打桩 `globalThis.fetch`，替换即集体失效）；③ ✅ **按请求注入 dispatcher** —— Node 的 fetch 接受非标准 `init.dispatcher`，为单次请求指定独立 Agent：零依赖、**不动全局**（健康探针 / 资产下载 / fal 全不受影响）、且**仍然调用 `globalThis.fetch`** → 现有打桩测试零改动。落地：新增 `src/long-request.ts`（`LONG_REQUEST_TIMEOUT_MS = 900_000`）——从 undici 全局 dispatcher 的 well-known symbol 借到 Agent 构造器造实例（Node 不暴露 undici 模块，`import('undici')` 报 ERR_MODULE_NOT_FOUND），取不到时**防御式退回** fetch 默认并告警一次，**绝不阻断生成**；`dramaPost` 仅在本次请求上注入。**顺带修掉重试放大**：本地超时不再进 `catch` 重试分支（原来超时也重试 → video 档最坏 **20 分钟**才报错），改为立刻抛「N 秒内未返回结果（已放弃重试）」；502/503/504 的一次性重试保持不变。**不变量**：`DRAMA_TIMEOUT_MS` 每档必须**严格小于**传输层上限（单测断言）。测试 `tests/long-request.test.mjs` 3 用例：不变量 / dispatcher 契约（可取到 + 按 ms 记忆化 + 不等于全局实例）/ **行为实证**（loopback 起「2s 后才发响应头」的服务器：收紧到 500ms 的 dispatcher 必须被 `UND_ERR_HEADERS_TIMEOUT` 掐断，同一端点不传 dispatcher 的对照必须成功 → 证明该参数确实决定上限，而不是只断言对象长得对）。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **393/393**（+3）✓ / verify:loader ✓
- **涉及文件**：src/long-request.ts（新）/ src/generate.ts / tests/long-request.test.mjs（新）

#### CV-136 · 视频画幅收敛为 16:9 / 9:16 两档（去掉 1:1）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：此前 `VideoAspectRatio` 三档、视频工具 enum 也含 `1:1`，而 Drama 后端只认两档 → 用户选 1:1 会被**静默降级成 16:9**（「参数没生效却不报错」的误导型行为，与 CV-127b 立下的诚实回显原则相悖）。用户拍板：「竖屏就是 9:16，甚至可以只剩 9:16 和 16:9 两种」。改动：① `VideoAspectRatio` 收窄为 `'16:9' \| '9:16'`（`providers/types.ts`）；② `videoRequestOf` 去掉 1:1 分支，非 9:16 一律落 16:9（历史节点重放 `generationPrompt` 时带的 `1:1` 同样兜住，不把非法值发给后端）；③ `video_generate` / `video_composite` 的 `aspectRatio` enum 去掉 `1:1`，描述写明「只有横屏 16:9 与竖屏 9:16 两档」；**方形 1:1 只保留在图片类工具**（image_generate / character_generate / inpaint / storyboard_generate / style_transfer）。同步清理四处过期表述：`dramaAspect`（保留作运行时兜底并改注释）、fal 头注释与画幅分支注释、`plan-prompt.ts` 的画幅提示语。**连带结案**：api.md 里「0.2.8 枚举无 9:16、竖屏该怎么传」的 ⚠️ 待确认 —— **竖屏直接传 `9:16` 已确认可用**。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **393/393** ✓ / verify:loader ✓
- **涉及文件**：src/providers/{types,drama,fal}.ts / src/generate.ts / src/host-tools.ts / src/plan-prompt.ts / docs/api.md

#### CV-137 · 上传端点统一（uploadimage 已下线 404 → 切到 POST /api/v1/generate/upload）+ 上传链路实测校准

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P0
- **详情**：用户提示「所有以文件名为入参的接口都要先上传拿名字再填参数，接口用 `/api/v1/generate/upload`，自己测一下并更新文档」。**实测查出 P0 破口**：旧的 `/api/v1/generate/uploadimage` **已从后端路由表移除**——对图片/视频/音频任何文件均返回 `404 {"detail":"Not Found"}`，`openapi.json` 的 22 条路径里含 upload 的只剩 `POST /api/v1/generate/upload`（`summary: Upload File`，请求体仅一个必填 `file`）。**意味着改造前整条上传链路（P8 本地上传 / 视频抽帧帧图 / promoteAssetFile / 参考图上传工具）全部 404 失效**——这是必须立刻修的破口。**改动**：① `src/config.ts` 端点常量 `uploadimage` → `upload`（附注释写死「旧端点已下线、不要再改回去」）；② `uploadBytesToDrama` 改走新端点、错误文案从「参考图上传失败」改为「文件上传失败」（不再只服务图片），并给 404 单独一条定位提示（「后端未注册该端点，请确认 Drama Backend 版本」），响应解析改为**优先取 `name`**（实测结构）再兼容 `filename` / `data.*`；③ 测试桩同步（`video-style` / `character-sheet` 的 `/generate/uploadimage` 匹配改为 `/generate/upload`）；④ 新增防回弹契约测试 `tests/upload-endpoint.test.mjs`（4 用例：端点常量且**不得**再出现 uploadimage / 请求形态＝form-data 字段 `file` + 唯一安全名 `ref-<8位uuid>.<ext>` + 不写死 Content-Type / 响应四种形态解析 / 404·500·缺字段的中文错误）。**实测结论（写进 api.md 0.2.9）**：① 三种文件类型返回结构一致 `{name, subfolder, type}`；② **耗时随体积线性 ≈9.6ms/KB（≈100KB/s），不存在 1MB 悬崖** → 旧文档「>1MB 触发 Starlette 溢写、耗时陡增」**证伪**（当年「1.6MB≈14s」正是 1.6MB÷100KB/s 的传输时间；实测 105KB/293KB/577KB/872KB/1.21MB → 0.21/2.85/5.48/8.35/12.1s）；③ **标准流程端到端实证**：上传 `tiny.png` → `image2vl.image` 返回「纯红色背景图片」（证明后端真读到字节）、上传 png+mp4+mp3 → `ref2va` 的 `image1`+`video1`+`audio1` 同发成功产出 `MiniMax_H3_00290_.mp4`（127.1s，**C 音频通道句柄首次走通**）；④ 新坑：`/view?filename=` **只对生成产物有效**（200），对上传文件回读 500，不能拿它校验上传；⑤ 重名后端加 ` (1)` 后缀（`big (1).png`）→ 唯一安全名约定必须保持。验证链全绿：client tsc ✓ / tsdown ✓ / host tsc ✓ / client dts ✓ / verify:loader ✓ / test:smoke **397/397**（+4）✓
- **涉及文件**：src/config.ts / src/generate.ts / docs/api.md / docs/canvas-studio-api-usage.md / docs/canvas-studio-tools.md / tests/upload-endpoint.test.mjs（新）/ tests/{video-style,character-sheet}.test.mjs

#### CV-116 · 风格映射四处漂移（11 vs 8）+ 未命中选项被整个吞掉

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：CV-109 把总纲风格预设扩到 11 类，但 UI `STYLE_DEMO_MAP`（question-capture.tsx:22）仍 8 对、catalog `demo` 字段 8 条、assets/style-demos GIF 8 个。真正严重的不是缺 GIF——渲染时未命中 MAP 的选项被 `return null` **整个丢弃，用户根本选不到该风格**。修复：① 从 T8 仓库 `minimax-h3-prompt-skill-T8/catalog/community-skills/` 取回街采/惊吓两个 preview.gif 入 assets/style-demos（与现有 8 个同源同字节），catalog 补 `demo` 字段；② MAP 补到 11 对；③ **GIF 存在性改由 catalog `demo` 字段单点判定**（`getSkillEntry` 查全量含 hidden），缺失时渲染「预览制作中」降级占位卡而非丢弃卡片（新增 `csStyleDemoFallback`，16/9 同尺寸防布局跳动）；oriental-mythic 在 T8 无素材 → 走降级。client 首次引用根级 catalog，tsconfig.client.json include 已追加 `src/skill-catalog.ts`。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **344/344**（+2）✓ / verify:loader ✓
- **涉及文件**：src/client/question-capture.tsx / src/client/styles.ts / src/skill-catalog.ts / assets/style-demos/（+2 GIF）/ tsconfig.client.json

#### CV-117 · catalog 一致性测试补反向断言

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：原只断言「skills/ 每个 skill 都能取到条目」（防漏补表），删除或改名后 catalog 残留幽灵条目不会红（广场出现点不动的死卡）。新增反向断言：catalog 每条必须在 `MINIMAX_SKILL_NAMES` 中真实存在。负向验证已做：注入假条目 → 测试变红（fail 1），还原 → 8/8 绿
- **涉及文件**：tests/skill-catalog.test.mjs

#### CV-118 · hidden 拆生命周期语义

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：`hidden?: boolean` 一个字段混了两种语义（技术类永久隐藏 vs 未就绪试跑）。新增 `stage?: 'ga' \| 'preview'`，三种组合各归其位：都不写 = 普通广场技能；只 hidden（无 stage）= 技术类永久隐藏（总纲 / 提示词技术，属分类维度）；hidden + preview = 试跑期（生命周期维度，就绪后删掉两字段即上线）。oriental-mythic 已标 preview。测试断言：stage 取值合法 + preview 必须 hidden + ga 不得 hidden
- **涉及文件**：src/skill-catalog.ts / tests/skill-catalog.test.mjs

#### CV-104 · C2 注入纪律（lockedPrompt 逐字节复用 + 资产卡覆盖）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：① `list_references` 增 `assets` 输出（id/name/role/lockedPrompt/negativePrompt + 锚点分图 filename/url，节点 id 已翻译成可直接填 filenames 的 Drama 文件名；参考项带 `assetId`），渲染段「一致性资产卡」置于参考图之前，无卡时该段不渲染（旧项目零影响）；② `character_sheet` **同名卡整体覆盖**——`resolveAssetSlot`（同名复用原 id） + `ProjectRegistry.releaseAssetNodes`（摘掉不再属于该卡的旧锚点节点 `assetId`，避免旧分图冒充锚点），冻结描述写错的纠正路径 = 重调同名卡；③ 总纲 SKILL.md 新增「一致性资产卡与注入纪律」硬规矩三条（先建卡且 lockedPrompt 须经用户确认冻结 / 每镜 prompt 以 lockedPrompt 原样开头、视频侧 subject_definitions 逐字复用 + retention 标 fully_preserved / 取锚点先查 `list_references.assets`），并改造工作流第 4/5/6/9 步与「一致性要点」节；工具链表补 `character_sheet` 行，`character_generate` 标注为「只要立绘图、不建卡」。**按用户拍板走纯 skill 纪律**：不在 Host 生成链路强制前置 prompt（避免破坏 H3 六段式首段结构）。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **286/286**（新增 4 用例）✓ / verify:loader ✓。**待验收**：桌面让 agent 出同一角色两个镜头，比对两镜 `generationPrompt` 的 SAME 块是否逐字节一致、参考图句柄是否同源；跨会话新对话仍能经 list_references 拿到锚点
- **涉及文件**：src/host-tools.ts / src/projects.ts / src/generate.ts / skills-local+skills/canvas-studio-creation/SKILL.md / tests/{asset,reference}.test.mjs

#### CV-108 · 镜位版本链与失效标注（返工片段不再混入成片）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：起因 = 用户验收一致性时发现「要求返工的镜头 + 返工后新出的镜头被一起合进成片」，agent 最后用 bash+ffmpeg 手写 concat 绕过。日志实证根因：① 6 个镜头各被重复生成 2 次（同参数），返工后又来一轮 → 画布 20+ 段；② `compose_video` 不传 clipIds 时 `defaultComposeClips` 收「全部视频节点」；③ agent 拿不到节点 id（生成工具只返回 url）；④ shotRefs 粒度不足（一张分镜卡挂多个子镜）当不了镜位主键。方案（用户拍板）：① 新增 `src/shot-versions.ts` 纯函数层（有效判定 / 输入指纹 / 取代规划 / 打标 / 恢复）；② 节点加 `shotVersion`/`supersededBy`/`supersedes`/`retired` 四字段；③ 三条建立通道 = 指纹相同自动取代（保守：无锚点拒绝判重）+ 工具 `replaces` 显式取代 + 画布右键作废恢复；④ 合成默认只收有效片段并返回「纳入 N 段、跳过 M 段」，新工具 `list_shots` 供 agent 拿 id；⑤ 成片也进版本链（重合成后旧成片自动失效但保留）；⑥ UI 灰显 + 虚线框 + 版本号/已失效角标。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **318/318**（新增 11 用例）✓ / verify:loader ✓
- **涉及文件**：src/shot-versions.ts（新）/ src/contracts/canvas.ts / src/generate.ts / src/compose.ts / src/host-tools.ts / src/client/canvas/{CanvasNode,CanvasContextMenu}.tsx / src/client/{StudioFrame.tsx,styles.ts} / skills-local+skills/canvas-studio-creation/SKILL.md / tests/shot-versions.test.mjs（新）

#### CV-107 · C5 合成统一（调色 pass + BGM 淡入淡出）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：① `compose.ts` 新增 `DEFAULT_COLOR_GRADE`（中性 eq 预设 `contrast=1.03:saturation=1.02`）+ `buildTranscodeArgs` 末位追加调色滤镜（治各镜色调漂移），`ComposeOptions.colorGrade` 支持 `false` 关闭 / 字符串覆盖 / 缺省默认；② `buildBgmFade`（淡入 1s + 淡出末 1s，时长不足只淡入）+ `buildAmixArgs` 第五参 `bgmDuration` 驱动 BGM 单轨贯穿淡入淡出；③ `compose_video` 工具新增 `colorGrade?: boolean`（默认开）；④ 总纲第 10 步 + 工具链表补 C5 兜底说明。**音效层遮切点未做**（方案 §4.6 已注明音频层另行立项，属独立 audio-first 工作流）。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **307/307**（compose 测试 +4：调色 vf 拼接、buildBgmFade 三种边界、buildAmixArgs 淡入淡出、含 BGM 端到端）✓ / verify:loader ✓
- **涉及文件**：src/compose.ts / src/host-tools.ts / skills-local+skills/canvas-studio-creation/SKILL.md / tests/compose.test.mjs

#### CV-106 · C4 质检闭环（逐镜 VLM 自检 + 预算熔断）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：① 新增 `src/quality-check.ts` —— `runShotQc`（调 image2vl 对单镜成片打分：判定 normalizeVerdict 中英容错 + 0–1 分 + 失败原因 + 建议；`qcBudget` 默认 2 次，耗尽返回 `escalate` 让 agent 上报用户仲裁）/ `writeQcNote`（落画布质检便签，`sourceIds` 指向被检镜，标题「质检 ✅/⚠️/❌」）/ `renderQcText`）；② Host 新工具 `qc_shot`（入参 `mediaUrl` + 可选 `baseline` 文本，写回被检节点 `qcVerdict`/`qcScore`/`qcAttempts`/`qcBudget`）；③ 节点新增 4 字段；④ 总纲 SKILL.md 第 9 步后新增「质检与重跑」流程（pass 进下镜、fail/warn 重跑且预算 −1、耗尽上报）。与 C2/C3 一致的纯 skill 纪律取向：Host 只暴露工具 + 硬预算，不替 agent 决定重跑哪些镜。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **303/303**（新增 14 用例）✓ / verify:loader ✓
- **涉及文件**：src/quality-check.ts（新）/ src/host-tools.ts / src/contracts/canvas.ts / src/asset-capture.ts / skills-local+skills/canvas-studio-creation/SKILL.md / tests/quality-check.test.mjs（新）

#### CV-105 · C3 尾帧链（同场景连续镜头的像素级衔接）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：① 新增 `src/video-frames.ts` —— `extractLastFrame`（ffmpeg 探测时长 → `planLastFrameSeek` 内缩 0.05s 抽末帧 → 落项目 assets 目录 → 回传 Drama 取 filename → 落画布 image 节点，`isReference=true` / `referenceRole='frame'` / 血缘指向源视频），纯函数 `planLastFrameSeek` 可单测，`upload` 可注入（drama-api 不可达时仍能端到端自测）；② Host 新工具 `extract_last_frame`（入参 `videoUrl`，即 video_generate / video_composite 返回的 url），进 `asset-capture` 刷新白名单；③ 节点新增 `shotTransition?: 'chain' \| 'cut' \| 'bridge'`（v4 契约，缺省视 cut），`video_generate` / `video_composite` 新增同名可选参数并随节点落盘（重试原地更新一并保留）；④ 总纲 SKILL.md：分镜表加「衔接」列、第 3/9 步与一致性要点节写明 chain 镜必须先 `extract_last_frame` 取**真实末帧**作首帧（禁止用分镜图/关键帧代替）、cut 不链帧、bridge 走 FL2VA 首尾帧书挡。验证链全绿：tsdown ✓ / tsc 双端 ✓ / test:smoke **289/289**（新增 3 用例）✓ / verify:loader ✓。**待验收**：drama-api 恢复后，规划两段 chain 镜头 → 第二段首帧与第一段末帧一致（抽帧比对）；cut 镜头不链帧；`shotTransition` 落盘
- **涉及文件**：src/video-frames.ts（新）/ src/host-tools.ts / src/generate.ts / src/contracts/canvas.ts / src/asset-capture.ts / skills-local+skills/canvas-studio-creation/SKILL.md / tests/video-frames.test.mjs（新）

#### CV-093 · 技能广场隐藏前两个基础技能

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P3
- **详情**：用户要求「画布创作总纲」「H3 视频提示词」不在技能广场 / lobby 推荐横滚 / 分类角标中展示，但项目中仍可激活/使用/在「我的 Skill」中管理。实现：`SkillCatalogEntry.hidden?: boolean`；两基础技能标 `hidden: true`；新增 `VISIBLE_CATALOG`；`skillsByCategory` / `skillCountByCategory` / `recommendedSkills` 均基于可见子集；`SkillMarket` 顶栏/侧栏「全部」计数改为可见数；原 featured 两基础技能隐藏后，将「品牌宣传片」提为 featured 保证 lobby 横滚非空。`getSkillEntry` 仍查完整 `SKILL_CATALOG`，故已激活 hidden 技能在 mine 视图可见。
- **涉及文件**：src/skill-catalog.ts / client/SkillMarket.tsx / tests/skill-catalog.test.mjs

#### CV-175 · 视觉升维 DD-09 右栏（对话区）：a 守卫 + b 可收起 + c 会话头阶段 chip + d 输入区读数带 已落地，eg 待做（2026-09-21 由 §1 速览枚举补登为 §4 行）

- **状态**：进行中（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：视觉升维 DD-09 右栏（对话区）：a 守卫 + b 可收起 + c 会话头阶段 chip + d 输入区读数带 已落地，e~g 待做（2026-09-21 由 §1 速览枚举补登为 §4 行）
- **涉及文件**：见 §1 / DD-09
- **落地/验收**：2026-09-21 补登

#### CV-203 · image_generate 移除 negativePrompt 参数（代码 + skill + 文档收口

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：image_generate 移除 negativePrompt 参数（代码 + skill + 文档收口；后端 Krea2 Turbo / Z-Image 的 negative_prompt 结构性失效）
- **涉及文件**：src/host-tools.ts / src/generate.ts / 多个 skill / canvas-studio-tools.md / api.md
- **落地/验收**：2026-09-18 落地（详见 §8）

#### CV-207 · write_script 原地更新改进（多版文案合法，原地覆盖会砸掉它，属 CV-207 仍待拍板）

- **状态**：待拍板（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：write_script 原地更新改进（多版文案合法，原地覆盖会砸掉它，属 CV-207 仍待拍板）
- **涉及文件**：—
- **落地/验收**：待拍板

#### CV-208 · 用户上传参考图挂血缘

- **状态**：待拍板（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：`addImportNode` 恒 `sourceIds: []`，按用途挂创意 / 分镜卡（方案已写在血缘补全方案 §CV-208，2026-10-01 对账补录）
- **涉及文件**：[canvas-lineage-completion-plan.md](./canvas-lineage-completion-plan.md)（§CV-208）

#### CV-209 · H3 原生音轨成为多镜主声轨

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：drama.ts 显式透传 `generate_audio`（缺省不发、被拒由视频自愈摘字段重试）、skill 第 9 步强制 `generateAudio=true`；推翻 audio-acceptance-checklist 早期「后端未开放」结论（2026-10-01 对账补录）
- **涉及文件**：`src/providers/drama.ts` / `skills/canvas-studio-creation/SKILL.md`（第 9 步）/ `src/generate.ts` / `docs/audio-generation-plan.md`

#### CV-210 · 质检全景表收敛

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：（随 CV-240 批执行）：过程质检退出（不调 qc_shot / 不返工），全景表三行过程质检条目收敛为一行「仅项目完成时出质检报告」（2026-10-01 对账补录）
- **涉及文件**：`skills/canvas-studio-creation/SKILL.md` / `skills/canvas-studio-creation/references/consistency.md`

#### CV-211 · 出图后 QC 链（image2vl 逐字复述 → image_fix）

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：因 VLM 对非拉丁文字识别不可靠，默认路径已切 CV-212；旧链保留为手动模式（2026-10-01 对账补录）
- **涉及文件**：`skills/canvas-studio-creation/references/prompt-writing.md`（§含文字图片的出图后 QC 链 / §与旧 CV-211 的兼容）/ `src/text-detection.ts`

#### CV-212 · 含文字 prompt 自动 image_fix 触发

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P1
- **详情**：（`text-detection.ts`：触发判定 + 修复 prompt 构造；CV-218 起修复 prompt 改原 prompt 直通）；`image_generate_withtxt` 不接本兜底（Qwen 特化，CV-270）
- **涉及文件**：`src/text-detection.ts` / `src/host-tools.ts` / `docs/api.md`（端点占用表）

#### CV-213 · 硬字幕烧录暂不开放

- **状态**：已降级（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：当前无烧录能力，`subtitle_burn` 占位工具承接降级路径、默认不开字幕（2026-10-01 对账补录）
- **涉及文件**：`src/skills/placeholder-tools.ts` / `docs/canvas-studio-tools.md` §D

#### CV-214 · VLM 输出不可当事实警告

- **状态**：已修复·待验收（权威见 [STATUS.md](./STATUS.md) §4.1 索引表）
- **优先级**：P2
- **详情**：image2vl / video2vl 工具描述写明非平凡出错率（节奏/质感、色号/细节易判错）与「只作辅助参考」纪律（2026-10-01 对账补录）
- **涉及文件**：`src/host-tools.ts`（image2vl / video2vl 描述）/ `docs/canvas-studio-tools.md`
#### CV-146 · music_generation / compose_video 的产物被本地…

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过（2026-09-11）** · 优先级 P0（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**`music_generation` / `compose_video` 的产物被本地 output schema 丢弃（4/4 + 2/2 全失败）**：两个工具的 output schema 都声明 `additionalProperties:false` 却漏了 CV-127b/140/143 新增字段 → 后端其实已把活干完（耗时 26–64s 说明真跑了），产物在返回给模型前被 schema 校验拦掉，BGM 与成片 100% 拿不到。**复核后修正根因细节**：① `compose_video` 用的是共享 `resultSchema`，漏 `audioComposition`；② `music_generation` 用的是**内联** schema，漏的不止 `declaredDuration` —— `bpm`/`lyrics`/`degradedFields`/`attempts` **共 5 个字段全缺**（内联 schema 与结果类型各自演化，无人对账）。**这是插件 bug，不是后端问题**。会话实证：47 次后端调用中这 6 次全部失败于本地校验。**修复**：`resultSchema` 补 `audioComposition`；`music_generation` 的内联 schema 提为具名常量 `musicResultSchema` 并补全字段；同时新增**编译期覆盖守卫**（`MusicSchemaCoverage` / `ComposeSchemaCoverage`）—— 结果类型新增字段而 schema 未跟上时 `tsc` 直接失败并点名缺失字段，已反向验证有效
  - **位置**：`src/host-tools.ts`（`resultSchema` / `musicResultSchema` / `ComposeToolResult` / 守卫类型）
  - **修法要点**：待真机验收：跑一次 `music_generation` + `compose_video` 确认产物不再被丢弃（并顺带验 `txt2audio`，其后端可用性至今未被验证过）

#### CV-094 · 创作任务里 skill 调度顺序错乱（会话复盘发现）

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**创作任务里 skill 调度顺序错乱（会话复盘发现）**：用户「生成一段折纸动画」的会话里，模型先凭直觉连问 3 轮 `ask_user_choice`（漏第①步形态题、把②时长+③画幅合并成一问、风格题**自造选项**而非预设两级追问），第 4 步才想起加载 `canvas-studio-creation`，**风格 skill 全程一次都没加载**（应选 `papercraft-stop-motion-explainer` / `paper-collage-explainer`）。后果：风格 → 上游 STEP 流程 → 预览 GIF 整条链路未触发，成片质量只靠模型即兴发挥。根因：总纲在 catalog 里的 `description` 是软约束（「凡涉及生成图片/视频…时使用」），模型可以选择晚加载甚至不加载。修复：① 把 `description` 改成硬指令——「第一个动作必须是调用 skill(name=canvas-studio-creation) 加载本规范，严格先于一切提问与工具调用，禁止凭直觉先行澄清」（243 字，未触发 500 字截断）；② 正文开头加「加载时机铁律」——若在任何提问/工具调用之后才读到本段，立即停止即兴流程并回到需求澄清第①步重来。纯文档改动（自研 skill，非上游），无代码
  - **位置**：`skills-local/canvas-studio-creation/SKILL.md` + `skills/` 同步副本

#### CV-089 · 画布选中/拖动视觉修正（用户多轮实测反馈）

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过（2026-10-13）** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：**画布选中/拖动视觉修正（用户多轮实测反馈）**：① 选中态像「蒙了一层蓝」；② **点选单张图拖动 → 其余全部节点被压暗（蒙一层）**；③ 视频/图片浮层元信息条（分辨率+时长）整行消失；④ 双击节点无反应（视频+图片同根因）；⑤ 节点无分辨率信息
  - **位置**：`styles.ts`、`CanvasSurface.tsx`、`CanvasNode.tsx`、`VideoPlayerModal.tsx`、`ImagePreviewModal.tsx`
  - **修法要点**：✅ 2026-09-03 落地：① 选中态改用 `--cs-accent` 实色描边 + 外光晕（原 `--dsw-alias-interactive-bg-active` 带透明度，叠大节点上像蒙层）；② **移除 dim 规则**——dim 错挂在 `data-dragging`（**节点拖动手势**）上，而 dim 的合理语义是「框选时区分命中/未命中」，语义接反；拖动时不再改任何节点不透明度，只给主拖节点 `csNodePrimary`（z-index:3 + 加粗描边）；③ 元信息条改**始终渲染**（未就绪显示 `— × —` / `加载中…`）；④ 双击失效根因 = pointerdown 立即 `setPointerCapture` 致 `mousedown/mouseup` 被 retarget 到容器，dblclick target 变容器、节点收不到；改为**首次移动才捕获** + 3px 拖拽阈值（顺带消灭「双击手抖→位移+空 undo+写盘」）；⑤ 分辨率角标（右下）+ 浮层元信息条；⑥ `.csNodeLinkHandle` 默认隐藏改 hover/选中才显；⑦ 删 `csNodeRing` 死元素。**编号纠正**：本条改动曾在代码注释里误用 CV-072/CV-073（已被「技能广场搜索 / 我的 Skill」占用），已全量改回 CV-089

#### CV-078 · 创作者社区 CTA 收尾卡（竞品 DA-9）

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过** · 优先级 P3（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：创作者社区 CTA 收尾卡（竞品 DA-9）
  - **位置**：`SkillMarket.tsx`
  - **修法要点**：✅ 2026-09-02 落地：网格末尾虚线框「加入创作者社区」卡 + 待接入角标

#### CV-077 · 未激活过滤 + 排序（竞品 DA-8）

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过（过滤通过；排序仍未做）** · 优先级 P3（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：未激活过滤 + 排序（竞品 DA-8）
  - **位置**：`SkillMarket.tsx`
  - **修法要点**：✅ 2026-09-02 落地：「仅显示未装载」checkbox 过滤；**排序未实现**（skill 少价值低，如需后续补）

#### CV-076 · H3 能力角标（竞品 DA-7）

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过** · 优先级 P3（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：H3 能力角标（竞品 DA-7）：真实信息（8/10 skill 基于 H3）
  - **位置**：`skill-catalog.ts`（`h3?`）、`SkillCard.tsx`
  - **修法要点**：✅ 2026-09-02 落地：卡片左上角 H3 badge + 详情弹窗同步展示

#### CV-074 · 官方精选分区（竞品 DA-5）

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过** · 优先级 P2（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：官方精选分区（竞品 DA-5）：`featured` 字段已有未消费
  - **位置**：`SkillMarket.tsx`、`SkillCarousel.tsx`
  - **修法要点**：✅ 2026-09-02 落地：「官方精选 / 其他技能 · N」两级分区（全部 + 无搜索 + 未勾过滤时生效，其余场景平铺）

#### CV-072 · 技能广场搜索（竞品 DA-3）

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：技能广场搜索（竞品 DA-3）
  - **位置**：`SkillMarket.tsx`
  - **修法要点**：✅ 2026-09-02 落地：header 搜索框，title/summary/name 子串过滤（大小写不敏感），与分类/过滤叠加

#### CV-070 · 技能卡动态预览（竞品 DA-1）

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：技能卡**动态预览**（竞品 DA-1）：竞品卡头图是 GIF 演示，我们静态渐变；`assets/style-demos/` 8 个 GIF 与 skill 同名**已就绪**
  - **位置**：`skill-catalog.ts`（`demo?`）、`SkillCard.tsx`、`styles.ts`
  - **修法要点**：✅ 2026-09-02 落地：catalog 加 `demo` 字段（8 技能）；SkillCard hover 懒注入 `<img>`（不 hover 不下载）；无 demo 回退静态渐变；测试守卫 demo GIF 文件真实存在

#### CV-068 · 主模型无视觉（qwen3.8-27b-mtp 等文本模型），agent 在生成…

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：主模型无视觉（qwen3.8-27b-mtp 等文本模型），agent 在生成「视觉预览」等中间产物后试图**直接读本地图片路径自查效果** → DSH 运行时把 png admit 成 image block 提交给模型，能力校验抛 `model does not declare image input`（2026-09-02 用户实测截图反馈，3 连错）。项目架构上视觉理解走专用工具（`upload_image` 拿 Drama 服务器 filename → `image2vl` 分析），该报错 = agent 绕过专用通道直接读图，SKILL.md 旧护栏（「不要用文件读取工具打开图片」）太轻未拦住
  - **位置**：~~`skills/canvas-studio-creation/SKILL.md:51`（弱护栏）~~、`host-tools.ts`（image2vl 描述）
  - **修法要点**：✅ 2026-09-02：SKILL.md 核心规则升级显式禁令（无视觉能力声明 + 禁止 file_path / 图片 URL / 内嵌引用 / 附件全部读图变体 + 产物 url 用途澄清「只给展示与 upload_image，非视觉输入」+ image2vl 唯一合规通道与前置步骤）；`image2vl` 工具 description 补同款护栏（工具级兜底）；+3 护栏守卫测试（175/175 绿）

#### CV-008 · 多选是半成品

- **状态**：（见 [STATUS.md](./STATUS.md) §2.1 索引表）

- **缺陷追踪（§2.1）**：状态 **已完成·桌面验收通过（2026-10-13）** · 优先级 P1（权威见 [STATUS.md](./STATUS.md) §2.1 索引表）
  - **问题**：多选是半成品：只能 ctrl 点选，**拖拽只移动被按下的单个节点**；无框选（组带动 children 经代码核实 moveNode 已实现，STATUS 原记载过时）
  - **位置**：`CanvasSurface.tsx`（Gesture）
  - **修法要点**：✅ 2026-09-02：① 多选整体拖拽——gesture 捕获全员起始位置（过滤组内成员防双重位移），snap 校正量均摊到全体；② 空白左键拖拽 = marquee 框选（Ctrl/Cmd 叠加，单击=清选；平移改由 Shift+左键/中键/滚轮承担），拖出容器取消而非误选；③ store moveNode 的组带动经核实已存在

