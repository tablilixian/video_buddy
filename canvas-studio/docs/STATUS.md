# Canvas Studio 状态总表（STATUS）

> **这是唯一事实来源。** 需求 / 缺陷 / 优化点的当前状态一律以本文件为准。
> 其它文档（backlog、分析报告、设计稿）只保留**技术细节与决策过程**，状态一律引用本文件。
>
> **最近更新：2026-11-09（CV-451~455 批 2/3 落码 + A2 真机验收通过登记）** —— 会话 19/20 复盘驱动的编排治理批落码并经 A2 真机验收：analyzer 全会话 turn 分解与跨 turn 三判红（CV-451，A2/翻拍判卷实测）、契约生成物「行为语义速查」段（CV-452）、spec 编排闸双闸（CV-453，scaffold 拒收真机实证 + 模型自愈）、桌面通知聚焦豁免与 max-tokens 专属文案（CV-454）、download_video 组件下载四修（CV-455，超时/镜像/代理 curl/序列化）。**A2 确定性内容表跑：70min 交付、像素复核 5/6、msPerFrame 17.5（提速 5.6×）、max-tokens 0**。翻拍半程 7/7 判据全过（34 段拆解表、回核 33/33 偏差 0.17s、video2vl/asr2txt 双 500 下纯像素完成）。动态思考强度策略文档见 plans/2026-11-08。
> **上一条：2026-11-06（CV-448 语音识别 asr2txt：文本 + 词级转写 JSON 落盘，待桌面验收）** —— 后端 0.9.0 新增 `POST /api/v1/generate/asr2txt`（fast-Whisper-large-v3-turbo-ct2），本批作为第 **50** 个工具（49 真实 + 1 占位）接入工具侧（本轮不接 api-playground）：入参单 `filename`（媒体句柄 / `@ref`，按扩展名路由 `video`/`audio` 同传优先 audio，`resolveRefValue` 不传 `expectKind`）；超时复用 image 档 720s、走 `callDramaRaw` 不进生成槽、不新增 CS-* 错误码（沿 analyzeImage 同型自愈换名重试）。输出 = 文本回执 + 新 `src/asr-transcript.ts` 归组落盘**词级转写 JSON**（`transcripts/asr-*.json`，直接喂 `evidence_grid.transcriptPath` 每格叠台词词标签）——有 `txt_segment` 才按重叠最大归词、缺失自造句段**不二次归组**（修掉每词双推 bug，单测钉死）；`txt_word` 缺失只回文本并明说未落盘；能力边界进描述（99 语种 / 中文一般 / **不支持方言** / `duration` 是服务端耗时）。同批清三处存量漂移（tools 分节计数 + §A14 详情节、api.md 清单 50 对齐注册面 + 契约节 + TOC、README 与 STATUS §3.4 计数）。验证：重建 EXIT=0 + 定向 8 文件 56 条全绿；**⚑ 待桌面验收**：真机口播出转写 JSON → `transcriptPath` 出词标签。
> **上一条：2026-11-06（CV-447 画布阶段提速批 A/B + T0/T1 规则与硬闸，待桌面验收）** —— 45s 科普片分析暴露的渲染侧成本与轮次失控一次收口：**P0-A** 渲染在飞时临时放开宿主窗口后台节流（claim 关、结算恢复，`render-host/{window,dispatch,wiring}.ts`）；**P0-B** 执行器回退原因进工单诊断（`fallbackReason` + 超时文案附已渲帧数）；**P0-C** 超时预算 200→240ms/帧并按档位分档（draft 0.7 / standard 1 / high 1.15，真机 45s standard 实测 282.4s ≈209ms/帧，给 15% 裕度）；**P1-A** desktop 组合配置豁免 `render_composition` 反重复提醒；**P1-B** 抽帧改 JPEG q0.85（同 2MiB 图片预算从 3 张提到 12 张，`image_crop` 仍出 PNG）；**P1-C** spotFrames 并入结构帧（0 / 末帧 / 各轨起止 ±2，上限 8）；**P1-D** 交付 lint 优先读 `build/fact-snapshot.json`（口头"已核实"不再报假警报）；**T0** `words` 透传 + 失真数字修订 + 探针裁决序；**T1** 唯一入口硬闸（第 4 次 probe 抛 `CS-USER-ERR` 并给降级出口）+ 渲染轮次埋点。验证：双 tsc + build + verify:loader + smoke 失败 0；硬闸反向变异红。**⚑ 待真机**：high 档系数回填 / `executorFallbackReason` 复核 / P1-E 窗口复用去留。
> **上一条：2026-11-05（CV-446 请求体 413 止血：网关图片预算对齐 4 MiB 实测上限，待桌面验收）** —— DramaServer `/v1/llm` 请求体上限**实测精确 4194304 B（4 MiB）**（413 错误体与真机三连败逐字节一致），harness 默认 20 MiB 图片预算远超它 ⇒ 本地检查通过而网关 413 归类 INVALID_REQUEST 终态、image-offload 不接管、会话永久卡死。`gateway.ts` 补 provider 级 `maxRequestImageBytes = 2 MiB`（留 2 MiB 给文本历史）+ 纳入 `gatewayFingerprint`（常量调整即触发 reconcile 重写，不等重启）+ 回归单测。根因链与 P1（spill-policy 无图片定价）/ P2（服务端上限）分层方案见根 `docs/2026-11-05-请求体413根因分析与修复方案.md`。验证链四步全绿，smoke **2841·2841 0 红**。
> **上一条：2026-11-05（CV-445 rea-video 吸收批 S1–S4，待桌面验收）** —— 切点检测升级（自适应三件套+原生帧率采样，真值片 9/10·FP0 不劣于 rea-video）+ 取证三项 + 生成单元规划（47 号）+ 对比片（48 号）+ capabilities JSON；smoke 2812·2812 0 红。上一条：CV-444 UI 加固批。
> **上一条：2026-11-05（CV-443 读图线补漏收尾，待桌面验收）** —— CV-435/437/442 之后全仓读图口径审计的漏网一次清账：① image_crop「你看不见图」旧假设四处清零（运行时工具描述 `host-tools-artifact.ts` / toolchain image_crop 行 / canvas-studio-tools.md C2 / 测试注释；改「读图给语义、数字给可复算判据」，数值自检纪律保留）；② effect-test-runner 补取证层级（唯一仍以 image2vl 为主判据的 skill：description + 第 6 步先 read_image 看图 + fixtures 三处，image2vl 交集降为趋势指标）；③ hub 分册对齐（look.md 来源③与 §2.2 重排「首选自己看图 / image2vl 保底」+ §7 降级行先试 read_image、consistency / prompt-writing / krea2-edit-writing「禁再验」补 read_image 单次出口且禁复读循环不变、remake-mapping 切点归实测）；④ 四散点 executor 补 §7 指针（paper-collage / co-op / music-video-subtitle / oriental）；⑤ tools 文档 A12 video2vl 补保底三条件 + 端到端配方 read_image 优先；⑥ gateway.ts 覆盖表注释补「换默认模型前确认 input 声明」操作规程。验证：canvas-studio `check` 全绿（双 tsc + 字段表漂移 + build + verify:loader + smoke **2759·2759 0 红**）。
> **上一条：2026-11-05（CV-436~438 六体裁执行计划段 A 三批，待桌面验收）** —— **CV-436** B-0 负例纪律纠偏（「负例必发 / 未执行不得结案」从流程摘除：负例 = 验收阶段可选测试手段；SKILL 第 5 步改「交付前复述未决项」；执行计划 §6 十处污染点清零 + 历史台账只加注记）；**CV-437** B-1 读图线整理（`list_references` 回执逐条带本地图 `assets/<文件名>` 路径（D6）/ `video2vl` 标保底通道三情况 / `image_matting` 数值自检措辞改「先看数值、目视再 read_image」/ toolchain §8 `@ref[id]` 找本地图三步法 / skill-tool-refs 组 8 豁免 read_image（运行时原生工具）；历史台账注记；顺手修复 cv-details 22:57 注记截断行）；**CV-438** B-2 #11 运动口径统一（新 `src/remotion/motion-features.ts` SSOT：`trackMotionFeatures()` 三路输出 animated/windowKinds/intervals，trackIsAnimated / collectAnimationWindows / motion-lint / slideshow-risk 四处全改派生；slideshow-risk 静态文案与渲染报告同源不再自相矛盾；`reveal.out` 进 ML-02 退场豁免（会话 15 恒报 11 条的根因收尾）；漂移靶反向变异实证）。验证：双 tsc --noEmit + `yarn build` + verify:loader 绿；skill 门禁 148·148、remotion/manifest 337·337、motion 相邻 67 全绿；全量 smoke 待用户侧基线（P2）。计划正本 `docs/2026-11-04-科普线后续执行计划.md`，段 A 继续 B-3~B-6。
> **上一条：2026-11-04（四·夜）**（**CV-435 读图能力恢复（待桌面验收）** —— 网关实测 `deepseek-flash` 路由到 `deepseek-v4.1-flash`、带 `image_url` 的请求 200 且能正确描述图像，故「模型无图像能力」是**能力声明缺失**而非模型限制：`src/gateway.ts` 的 `gatewayProfile()` 丢掉 `input` 字段 ⇒ llm-pi-ai 回落 `defaultInput=[text]` ⇒ `tool-fs/read-image.ts` 严格闸拒收；且 `src/index.ts` 每次启动 reconcile 会整体覆盖网关行，本机 patch 会被冲掉。修法：模型行补 `input`（目录 `capabilities.inputs` 优先 + 实测覆盖表兜底）、fingerprint 纳入它；成组反转「无视觉」禁令（toolchain.md / guardrail 测试 / image2vl 描述 / 抽帧文案，旧禁令改反向护栏）；CV-431 的 P8「看图本身」落成 `spotFrames → read_image → 逐条判据` 可执行路径。数值自检 / `inspect_image` 像素真值 / VLM 不可靠纪律一律保留）。**书面验收基线 = `6c131867f5` 工作区**，与 CV-427~434 合并验收；全量冒烟与真机实证时点由用户决定。
> **上一条 2026-11-04（四）**（**CV-427~434 科普线 0.1 验收修复批（待桌面验收）** —— 起点是两轮真机会话的验收分析（0.1 中文版 + 英文重制版），沉淀出「工具缺陷 / 流程纪律 / 成片 manifest」三类问题。**CV-427** animate 窗口静态校验（段整段落在轨外 / opacity 全程 0 ⇒ 整层永久不可见；读数复用渲染层同一纯函数，零漂移）；**CV-428** reveal 退场擦除 `reveal.out` + 进场方向语义告警；**CV-429** 六个体裁壳 description 补「点名下游 executor 时本壳仍须先加载做定向」+ executor 侧回指；**CV-430** 验收结论传递（pitfalls / verification 分册 + 项目级 lessons.md）；**CV-431** 三条流程纪律进 SKILL.md（spot 探针前置 / 画面判据必须看图本身、禁拿 manifest 字段自证 / 交付前复述未决项；负例必发条已于 2026-11-04 纠偏撤销）；**CV-432** `ask_user_choice` 失败兜底（非 abort 不外抛，回默认项）；**CV-433** ML-10 改屏幕时间口径 + ML-04 往复豁免按可见幅度收紧；**CV-434** 字幕卡排版预算按盒子算（多行 subtitle 溢出裁切的通用缺陷）。验证：`yarn check` 全绿（smoke 2720·2720 0 红））
> <details><summary>上一条：2026-11-04（三）～ 2026-10-31（六）—— CV-419~426 六大体裁阶段 2/3/4 落码批 / CV-405~408 参考素材落地批 / CV-397~400 复刻客户端能力批 / CV-396 订阅与积分 / CV-393~395 复刻复盘批 / CV-392 sprite 裁切 / CV-391 viral-remake（点开展开）</summary>
> **上一条 2026-11-04（三）**（**CV-419~426 六大体裁阶段 2/3/4 落码 + 短剧手册批（待桌面验收）** —— **CV-419** 视频 1:1 画幅放行客户端三件套（`VideoAspectRatio` 加 `'1:1'` + is/normalize 归一唯一实现点 + 双工具 schema / NodeInputCard 三档；联调前静默降级警告保留）；**CV-420** `social-ad-format-director` 社媒广告编排壳（前 3 秒钩子纪律四形态 + 卡点/复刻/实拍三链路路由 + 多画幅分发策略）；**CV-421** chart 扩型 pie/donut/gauge（`chart-pie.ts` 纯函数：份额归一 / wedge+donut 路径 / gauge dasharray；pie 族等比 meet 护栏；gauge 中心复用 countUpTextAt；棘轮 manifest.ts +7）；**CV-422** `import_csv` 数据导入工具（`csv-parse.ts` RFC4180-lite + 分隔符嗅探 + limit 1-32 截断；注册面 43→44；TOOL_SOURCES 补 host-tools-data.ts）；**CV-423** `data-viz-format-director` 数据可视化编排壳（数据来源溯源红线 + 图型选型判据五条 + 数字非编造验收第一条）；**CV-424** 短剧 episodic 剧集管理（SeriesStore `series.json` + `series_manage`/`episode_brief` 两工具，注册面 44→46；集=项目 / recap agent 撰写两口径复核点见方案 §四）；**CV-425** `drama-episode-executor` 通用短剧单集执行手册（episodic 流程纪律 brief→创作→登记 + 集结构四段表 + 节拍钩子密度 + 角色预算常驻 ≤4）；**CV-426** `drama-format-director` 短剧编排壳（定向三问 + 三链路路由 + 系列建档与集间定位核心输出 + 逐集验收 4 条）。验证：各批 `yarn check` 全绿）
> **上一条 2026-11-04（二）**（**CV-415~418 六大体裁阶段 1 落码（handoff 门禁 + 品牌三分类 + 两编排壳，待桌面验收）** —— **CV-415** handoff 交回契约最小门禁（`<skill>@<stage>`/`self`；6 个 decision 型非编排 skill 全部声明交回点；`tests/skill-handoff.test.mjs` 两级校验：必填可解析 / 幽灵绑定红，反向变异验红；§4.3 判据 2/4 留后续收紧）；**CV-416** 资产库扩品牌三分类 logo/brand/product（LibCategory 五处同步：contracts 枚举标签收口 / param-guard 描述串 / 客户端色板 / manifest.global 新 `logo` 键 + 字段文档生成物；B-4 新增描述串同源守卫，REQ-032 C1 失败模式上闸；棘轮 manifest.ts +2 显式登记）；**CV-417** `brand-format-director` 品牌宣传编排壳（从 brand-promo-video-generator 拆编排层：素材现实定向三问 + brand-promo 风格链 / code-driven-explainer 动效图形链路由 + 真实性验收四条；风格纪律留 L3）；**CV-418** `product-format-director` 产品讲解编排壳（统一 minimalist-product-ad-generator 广告链与 scaffold_manifest recipe=product-walkthrough 走查链两入口）。两壳 stage:preview + handoff 契约 + catalog 快照同批。验证：每批 `yarn check` 全绿；整片验收 = 路线阶段 1.4 待真机）
> **上一条 2026-11-04**（**CV-409~414 科普讲解能力批落码（能力五连 + L2 编排壳首发 + 收尾批，待桌面验收）** —— **CV-409** `ShapeTrack.pivot` 旋转轴心（缺省盒中心；`pivotOriginStyle` 纯函数 + `Shape.tsx` 接线；棘轮 → `lintZOrder` 拆 `manifest-lint.ts`；解锁指针甩弧/偏心自转/仪表盘）；**CV-410** `explainer-format-director` 科普编排壳（三层 skill 架构 L2 首发：定向三问 → 路由表 → executor 指派 → 验收清单；SKILL.md 4102B + platform.yaml + catalog 快照同批）；**CV-411** chart `variant:'line'` 独立折线 + dataCard `countUp` 数位滚动（`count-up.ts` `countUpTextAt`：45 帧缓出、前后缀/小数位对齐）；**CV-412** `callout` 引线标注轨（anchor+box+text 一条轨、elbow/straight、non-scaling-stroke）+ `reveal` 分区揭示（wipe 四向 / spotlight）——`reveal.ts` + `RevealShell.tsx`；chart 校验外提 `manifest-track-validate.ts`（棘轮合规）；**CV-413** 技能广场「体裁编排」分类 + 编排壳去重瘦身；**CV-414** 收尾批：总纲「用户明确指示压过项目预设/配方缺省」+ 音色澄清/草稿先行/预算前置 + CV-136 1:1 拍板翻转 + 六大体裁路线 SSOT 新建。验证：`yarn build` 绿 + skill 守卫 9 测试 2669·2669 全绿；整片验收（0.1）与编排壳转正（0.3）开放中）
> **上一条 2026-11-03（二）**（**CV-405~408 REQ-037 参考素材落地与展示批落码（待桌面验收）** —— **CV-405** `download_video` 产物自动标参考（`isReference:true` + `referenceRole:'source'`，contracts 联合类型扩展）+ §07 用户参考登记纪律（write_storyboard assets 口径 + 总纲指针 + toolchain.md）；**CV-406** 参考托盘升级**素材托盘四分区**（图片/视频/音频/文本，文本托盘内展开；`list_references` 四类全收带 `kind`），托盘入口重新启用（**反转 2026-10-08 关闭拍板**）；**CV-407** 附件点击再落（**反转 2026-09-05/09-13 自动落卡拍板**）：项目内发附件不再自动落卡——`divertAttachments` 改 `stashLobbyFiles` 暂存 + 占位说明（agent 提醒用户点「落进画布」），StudioFrame「待落画布」条经 `LOBBY_LAND_STASH_EVENT` → `landLobbyStash`（失败件留在条上）；首页首句自动落暂存不变；lobby-stash CV-261 门禁按新契约改写（11·11 绿）；**CV-408** `upload_image` 收 http(s) 外链自动落参考图片节点（`ensureExternalImageNode`，URL+末段双口径去重）+ §07 `canvasNode` 引用失效就地标红（`canvasNodeIds` 选项 + `.pill.stale`）。立项痛点 = 首页发视频链接做参考，画布/故事板无处回看；需求正本 `plans/REQ-037-参考素材落地与展示-需求文档-20261103.md`。验证：typecheck 绿 + 全量 smoke **2642·2642 0 新增红**；棘轮 5 文件/4 函数显式登记（styles 11067 / host-tools 4705 / routes 3654 / StudioFrame 3261 / index 3008））
> **上一条 2026-11-03（一）**（**CV-397~400 REQ-036 复刻客户端能力批落码（四条纯客户端确定性能力，零模型服务费用，待桌面验收）** —— **CV-397** `media_probe`（39 号）：ffmpeg -i 解析（随包无 ffprobe）+ ebur128 响度复用，拆解表真值 + 响度对齐；**CV-398** `evidence_grid`（40 号）：证据网格一次调用出「时间标注网格 + 结构化清单 + 实测切点」——select 保实测帧 PTS（fps 滤镜重写 pts 实测弃用）+ tile/drawtext/drawbox + -vsync 0（image2 CFR 复制首页实测坑），切点复用 teardown-verify 同一函数，transcriptPath 可选（与后台 ASR 互不等待），随包全量 Noto TTF 10MB（drawtext 需实体字体）；**CV-399** `download_video`（41 号）：抖音/B站/YouTube 白名单 → yt-dlp 运行时按需下载（版本钉死 + SHA2-256SUMS 复检，不进安装包）→ 画布素材区落盘；**CV-400** manifest `anchor` 相对锚定：animate/draw/colorShift 可锚 caption 句/词窗口（治换文案时机漂移）——anchor.ts 纯函数 + validateManifest fail-fast 与客户端同一份实现 + Root.tsx 组合期解析（无锚零开销）。skill §0/§1 联动。验证：定向全绿 + smoke 见 changelog；**编号勘误：初占 396~399 撞订阅批，未 push 前重编 397~400，水位 CV-400**）
> **上一条 2026-11-02（一）**（**CV-396 订阅与积分接入（Stripe 全链路 + G1 余额闸 + 整数积分口径，待桌面验收）** —— 后端零改动（Stripe TEST 模式，三接口实测 200）。Host：新 `contracts/billing.ts` + `billing-state.ts`（读永不抛、保留上次快照、403 置 disabled、15s TTL）+ `/canvas-studio/billing` 三分派（快照 / `checkout` / `portal-sessions`，写动作过 `mutationAllowed` 并原样透传上游 status/code/Retry-After）。客户端：`billing-store.ts` 状态机 + pending 轮询（5s×2min，停止 = pending 消失或订阅 key 变化）+ 幂等键按购买意图复用（只在 expired/idem_mismatch 换键）、`BillingPage.tsx` 全屏页、`billing-copy.ts` 文案唯一实现点。**「刷新不全」根因**：只听 `visibilitychange`，跳系统浏览器付款时主窗口从未 hidden ⇒ 回来永不刷新；新 `refresh-signal.ts` 改 `window.focus` + `visibilitychange` 双源 1s 去重，账号/余额/订阅共用。**积分一律整数截断**（用户拍板，同 WorkBuddy）：`formatCredits` 用 `Math.trunc`，显示值永不超过真实值；假余额 `2600` 删除，菜单两行改真数据且可点开订阅页。G1 闸放 `dramaPost`（不放 `requireDramaAuth` —— 上传共用但不扣费），余额未知 fail-open，不足抛 `CS-BILL-001`。验证：typecheck×3 / tsdown / tsc emit / verify:loader 全绿 + 计费 80·80；全量 smoke 跑两次各 1 红且两次不同（单跑全绿）= 沙箱计时 flaky）
> **上一条 2026-11-02（一）**（**CV-393~395 REQ-036 复刻复盘批落码（甜品复刻会话实测教训，待桌面验收）** —— **CV-393** `fx:'outline'` 镂空描边字：TrackFx/TRACK_FX 白名单 + timing outline 分支（textFill 透明 + 奶油白粗描边；currentColor 会随填充一起变透明故给固定色值）+ TextCard 在 color 解析后展开 textFill；**CV-394** 新工具 `image_matting`（第 36 号）：纯色底抠透明底 alpha PNG（内置 ffmpeg colorkey：key=white/black/green/magenta/#RRGGBB，similarity/blend 钳 0–1），新纯函数 `src/image-matting.ts`（normalizeKeyColor/buildMattingArgs + 执行器可注入，无注入面），产物 `<原名>-alpha.png` 落同目录供 image 轨直引 + param-guard 豁免 3 参 + tool-presentation A 档；**CV-395** viral-remake 复盘：拆解表加第 6 列「元素与动效」（什么在动/怎么动/什么曲线/和谁联动）+「每个会动的元素 = 一条独立轨」铁律（禁整帧烤图 fade 轮播）+ 缓动速查 §3.5（缺省 linear 没有生命感）+ 透明素材链路（白底生图 → image_matting → inspect_image 核 colorType=6）。验证：tsc/build 绿 + 定向 21·21（image_matting 真 ffmpeg E2E：lavfi 白底红方块 → colorkey → decodePng 断言 colorType=6 + 角落 alpha=0）+ 全量 smoke **2517·2517** 0 新增红；棘轮显式登记 host-tools 4401→4435 / createStudioTools 2436→2483 / timing 1436→1447）
> **上一条 2026-10-31（六）**（**CV-392 image 轨 sourceRect 精灵图子区域裁切（REQ-036 R-2，待桌面验收）** —— 新 `ImageClipTrack.sourceRect`：百分比 `{x,y,w,h}`（0–100 与 box 同口径，越界硬失败），圈出的子区域按既有 `fit` 语义（cover/contain/kenburns）铺层 =「把圈出的区域当作这张图」；不写 = 整图、老 manifest 逐帧不变。实现：新纯函数模块 `src/remotion/sprite.ts`（validateSpriteRect + spriteRegionStyle：整图按 scale 放大 + 负偏移对准区域 + 层 overflow hidden + `objectFit:'fill'`，**不用 background-position** —— CSR 护栏）；cover/contain 等比需要自然尺寸 ⇒ ImageClip onLoad 测量（Remotion 官方 delayRender 模式、AudioViz 先例；**无 sourceRect 零 delayRender**，坏图退化纯百分比拉伸兜底不卡渲染）。验证：单测 `tests/sprite-rect.test.mjs` 11 条（契约 6 + 几何 5 精确数值）+ 反向变异 2 处验红（cover 换 min / 越界判据删）；全量 smoke **2507·2507** 0 新增红 + build/tsc 绿；**bench 11 号 E2E 5/5** —— 直连产品 sprite.ts 公式（零拷贝防漂移），4 块板 q1~q4 目视全对（cover 裁切方向 + contain 留边），`--repeat=2` 字节数全等 643518。踩坑：canvas 合成素材 fillText/arc 的 GPU 光栅跨加载不确定（首轮 H4 86/90 帧红）⇒ 自造素材只用整数 fillRect（README §五记档）。文档四处同步：manifest-contract / viral-remake 分册+SKILL / bench README）
> **上一条 2026-10-31（六）**（**CV-391 viral-remake 爆款复刻编排 skill 落码（REQ-036 R-1，待桌面验收）** —— 决策型新 skill（stage 'preview'）+ catalog 快照登记：参考视频拆解表 → 内容类型→轨道映射（video/image/caption/textCard/chart/shape/audioViz，转场 11 式就近近似）→ draft 档先行渲染 → 原片五项对照（节奏/转场/字幕/信息卡/整体）→ 批量变量表换装裂变；manifest 契约让位 code-driven-explainer 分册、审批节奏跟总纲。守卫 `tests/viral-remake-skill.test.mjs` 5 条，含转场全表↔EFFECTS 与文字动效↔TEXT_ANIM_PRESETS **双向**一致（文档↔源码）；反向变异（分册删 clock）实证变红还原绿；18 个 skill 门禁测试文件定向 152·152 + 全量 smoke **2496·2496** 0 新增红 + typecheck 绿；SKILL.md 5.9KB（12KB 闸内）。踩坑三条记档：决策型不写知识型让位哨兵（CV-324 红）/ 反向断言 fade 前缀撞 fadeUp（先排除 anim 预设）/ catalog 快照与 platform.yaml 同批同步（深等门）。R-2 sprite 裁切、R-3 素材供给见 REQ-036 方案 `plans/REQ-036-爆款复刻-需求转化计划-20261031.md`）
</details>
> <details><summary>上一条：2026-10-31（六）—— CV-383 渲染窗口一单一个（复用必挂收口）</summary>

（**CV-383 渲染窗口「复用必挂」收口：一扇窗只渲一单（待桌面验收）** —— 会话 `session.v4 8.jsonl` 97 次渲染里 **21 次「已取单但 30.0–31.3s 一帧未出」**，失败率随轨数单调上升（≤6 轨 0/36 → ≥46 轨 13/24），同 manifest 同档 ERR→OK 配对 ≥7 组。新探针 `render-host-stall.probe.mjs`（真隐藏窗口 + 真 bundle + 真 WebCodecs，喂 63 轨 / 5415 帧 / 26 段真视频）实测：**同窗连渲**第 2 单在 10s 处心跳+进度同时全停、139.1s 零帧；**每单换新窗** 3/3 成交（首帧前 10.8s、18.9ms/帧、字节数三次全等）⇒ 否掉「5415 帧超限」「首帧前无心跳死区」两条旧归因，真因＝**窗口复用把渲染页主线程按住**。修法：结算打标 → 下一单派单前回收（**不吃**失败重置的 30s 节流）+ 立刻重建（清暖启防抖），两处调用点（`runRenderJob` 开头 + `armTimeout` 补排队单）+ 在飞守卫；判死「渲染器被卡住」与退窗「窗口已退出」文案分离。验收：探针 `--recycle=1` **3/3 成交**、重建 **204–205ms**；`render-host-deadzone.test.mjs` **12 条全绿** + 反向变异 **13 组**逐条验红；相邻渲染测试 46 条全绿；`routes.ts` 净 0 行））

</details>
> <details><summary>上一条：2026-10-29（四）—— CV-382 资产交付内存基线 + CR 台账对账</summary>

（**CV-382 资产交付内存基线 + CR 台账对账（待桌面验收）** —— **CR-004 收口**：`routes.ts` 资产路由「整读 readFile 再 Buffer 切片」改 stat 探测（根→.trash 兜底）+ createReadStream 流式，no-store/206/416 语义逐字符保留 + res close 时 destroy 读流 + `CANVAS_STUDIO_ASSET_LEGACY_BUFFER=1` 回退开关；实测 60MB×10 Range（含 5 次 50MB 段首块即断）RSS 峰值增量 **125.45MB → 7.83MB**（<20MB ✅）、fd 增量 0；`asset-range.test.mjs` 6 条先锁语义再改造。**CR 台账对账**：§1/§3 双轨矛盾 8 处一次对齐（7 条两表统一 + CR-104 补登 + CR-023 关账）+ 已修项补「方案一句话」；机器闸 `code-review-ledger.test.mjs` 4 条结构断言。反向变异 3 处全红实证；smoke **2429·0**；routes.ts 净 +39 行棘轮显式登记））

</details>
> <details><summary>上一条：2026-10-28（三）—— CV-377~381 音频子系统收口五连</summary>

（**CV-377~381 音频子系统收口五连（待桌面验收）** —— 治 CV-040（多段成片音轨断裂 / Master Audio）：**CV-377** 统一模型 + 止血 + 从零装配——新纯函数层 `audio-timeline.ts`（校验 / 8 枚举派生 / filter_complex 唯一生成点 / 中文摘要），无音轨段 `-an` 改补等长静音轨 + 全分支统一 48k 立体声（16k×48k 混拼实测流级损坏），多镜成片改「视频母版 + AudioTimeline 装配轨 + `-c:v copy` 合流」（D-01）、单镜逐字符不变、角标「已丢弃」错文案钉回行为；**CV-378** 时间轴只读音频轨 + 混音面板（写回节点 `audioTimeline`）+ 导出前预检（D-02 短 BGM 自动补静音并告知）+ 音频抽屉；**CV-379** 总纲第 2d 步声音规划 + audio-first / beat-editing 分册 + `mv-production` skill；**CV-380** 节拍分析 `beat-analyze.ts` + `analyze_beats` / `snap_cuts_to_beats` 工具（回填 06_sound.bgm.bpm/lufs 既有契约；G2 真机 120/90/140 误差 ≤0.6、拍点对齐 100%）；**CV-381** `music_generation` variants 抽卡（D-06 仅显式）。探针三件套 `scripts/probe/{audio-baseline,audio-mix,beat}.probe.mjs`（修复前稳定红 → 修复后全绿，A/V 差 0.037s ≤1 帧）；**反向变异 12 处全部能变红**；test:smoke 2411·0 红；新代码全进新文件，StudioFrame +7 行棘轮显式登记））

</details>
> <details><summary>上一条：2026-10-28（二）</summary>

（**CV-376 `@ref`/`shotRefs` 解析容错（待桌面验收）** —— 转录实测（24 个会话，`"isError":true` 结构化判定）：**18 次 `CS-USER-001` + 2 次「分镜卡未找到」全部是模型三种写法被解析器拒收** —— ① `@ref[<资产文件名>]`（模型从工具返回的 URL 截末段当句柄，而节点 id 是另一个 uuid）；② `@ref[<截断标题…>]`（标题是 `promptSummary` 的前 12 字 + `…`）；③ `shotRefs: ["S1-Sh1"]`（shot.id 写在卡上却没人读）。而客户端 `findAssetByChipText` 早就有等价兜底 ⇒ 症状是「hover 有缩略图、一发出去就报找不到」。修法：`findNodeByRef` 判据从「id/标题全等」扩成**六级阶梯**（id → 标题 → 去省略号 → 资产文件名 stem → 标题分段 → 前缀，较短一方 ≥4 字）；`resolveShotRefs` 从 `host-tools.ts` 搬到 `reference-resolve.ts`（顺带解掉该文件 4401/4401 的行数棘轮）并补 **sbRef 末段 / 标题分段 / `分镜N` 无空格** 三档；`CS-USER-001` 与分镜卡报错都附**最接近的 3 个候选**（相似度用重叠系数，只进文案不参与判定）。`cut_audio` 保留「裸文件名优先当文件」的既定分工（否则 `song.mp3` 会被解析成节点、凭空多出带血缘由），由全量 smoke 抓出并当场修掉。新增 `tests/shot-ref.test.mjs` 6 条（该函数此前**零覆盖**，9 个调用点全靠运气）+ `reference.test.mjs` 4 条；全量 **2348·2348 全绿、smoke 门禁 0 新增红**；反向变异 M1 资产名 → 1 红、M2 sbRef → 1 红、M3 候选提示 → 1 红、M4 分镜候选 → 1 红）
</details>
> **上一条 2026-10-28**（**CV-375 资产名唯一准入点（CR-01/CR-02，待桌面验收）** —— 「合法资产名」此前有 **8 份同款白名单 + 6 处裸 `join`**，其中 `compose.urlToAssetPath` 被成片 / 抽帧 / 素材核对三条链路复用却**完全不校验**：`/canvas-studio/assets/<id>/../../../..` 经 `path.join` 折叠后能读本机任意文件，再被 `upload_image` 上传到 Drama、被 fal 通道 base64 内联进公网请求。修法：新 `src/asset-path.ts` 作唯一源（`isAssetFileName` / `assertAssetFileName` / `resolveAssetPathIn` = ASCII 白名单 + 拒首字符 `.` 与 `..` + `startsWith(base + sep)` 前缀复核），11 个源文件（新增 `asset-path.ts` + 10 处改调）、8 份私有判据删除；`readSourceBytes` 增 `projectId` 钉住跨项目引用（复用走 `lib:` 物化）。**两条踩坑记档**：① 准入点**不能挂 `ProjectRegistry` 方法** —— 测试用只实现 `assetsDir` 的桩 registry，挂上去立刻 20 条红，改纯函数后全绿（`projects.ts` 最终**零改动**）；② 反向变异第一版**无效通过**（相对 `../../` 未穿越出项目根、且只断言 error code），改上溯三级 + 断言消息后才正确变红。新增 `tests/asset-path.test.mjs` 9 条；tsc×2 / tsdown / verify:loader / 文件大小棘轮全绿且**未上调棘轮值**）
> **上一条 2026-10-26**（**CV-373 渲染看门狗活性语义 + 预览闸门三修（待桌面验收）** —— 会话6（10-25）9 渲 7 死的根因群一次收口。① **claim-stall 改按「最后一次活性证据」计死线**（`clientJobOrphanReason` / 看门狗 settle 两处 `Math.max(clientClaimedAt, lastProgressAt)`）：客户端取单后每 5s 打 `progress=0` 报活心跳（`renderClaimedJob` 里 setInterval，finally 清表），warmup（首帧前 ~80s）与预览闸门等人不再被 20s 判死/改派误杀；`reportRenderJobProgress` 加假时钟 `now` 供测试。② **进度单调不回退**（`reportRenderProgress`）：心跳的 0 不能把真实进度打回 0%。③ **预览闸门重入修复**：轮询下一拍重进同一单时**原地等同一个闸门 Promise**（旧实现跳过整个闸门块直接开渲 ⇒「弹窗底下照渲」）；`pendingPreviewGate` 注册表 + 同拍双进保险。④ **僵尸弹窗拆除**：轮询里发现单已不在队列而闸门还挂着 ⇒ `abortRenderPreview()`（render-preview 新导出）按「用户取消」收尾。⑤ **probe 贯通**：`runRenderJob` options / ActiveRenderJob / PendingStudioRenderJob 全链加 `probe`，诊断渲跳过预览闸门（不再弹「帧 3/9」打断用户）。⑥ `errors.md` 分流改写：「已取单但没渲染」不再等于环境问题（先看 last liveness），`msPerFrame > 1000` 禁止 manifest 二分；探针文件约定写 `build/probe/`。新增回归测试 2 条（心跳推迟死线 / 0 心跳不回退进度），全量 2217·2217、smoke 门禁 0 新增红）
> **上一条 2026-10-25 深夜（二）**（**CV-369 素材就绪门禁 + 卡片素材需求 + 片型配方（待桌面验收）** —— 治「每次临时组织素材」。根因不是缺模板：`§07 素材清单` 当时只在完成度里展示，**落地不读、出片不读、seed 不消费**，是个摆设。三层：① `status:"pending"` 升成 **blocker**（`CANVAS_STUDIO_ENFORCE_ASSET_READINESS=0` 可回退），阻断项逐条点名素材与来源；**配出路** `status:"waived"`（只拦不给路 = 功能不可用）；新增 `neededBy`（服务哪些 shot）+ `source`（generated/user/library/stock）。② 卡片册加**素材需求索引**：14 张卡只有 C2/E1 两类需要外部素材。③ 新 `recipe` 参数（`src/remotion/recipes.ts`）：explainer-cards 零素材 / product-walkthrough 需 1 张产品图 / story-arc 需 2 张场景图 —— 一次给段序列 + 时间轴 + 卡片 + 可直接填 §07 的素材清单，并接管 tracks 骨架（Σ 段时长严丝合缝）。新增 12 条测试）
> **上一条 2026-10-25 深夜**（**CV-368 shotcraft 本地化 P0/P1 + 分组坐标（待桌面验收）** —— 会话 #5 里 88 次 python3 手算坐标、24 次读源码的对策。六处一次落：① `inspect_image` 新增 `mode:"sample"` 逐点取色（原来只有区域统计，答不了「这个点什么颜色 / 多亮」，agent 只能手搓 PNG 解码器）；② 新工具 `layout_table`（项目级 `layout.json` 存命名矩形，**工作台不参与渲染** —— `render_composition` 不读它，避免第二事实源）；③ manifest 新增 `groups` / `group`：组内 0–100 相对坐标，宿主侧**预展开**成绝对坐标后再进校验与渲染（渲染器/客户端都看不到组）；④ `references/animation-and-assets.md`（G6）：逐字动画帧语义、`fit` 三档与 kenburns 推幅、素材核对何时硬失败、形状几何；⑤ 落位卡册 `references/shot-cards.md` 14 张可粘片段（守卫逐条过 `validateManifest`，当场抓出 3 处写错）；⑥ `image_generate` 未指定画幅时跟随项目预置画幅；⑦ `scaffold_manifest` 加 `theme`（四套视觉预设，展开成底色 + 强调色 + 动效基线，manifest 不存 themeId）。另：**auto 模式下「绑分镜出图」也纳入故事板闸**（补 CV-367 的已知边界）。新增 31 条测试，全量 smoke 0 红）
> **上一条 2026-10-25 夜**（**CV-367 故事板强约束 L1–L4（待桌面验收）** —— 会话 #5（187.6min / `render_composition` **0 次**）里用户 @36min 质问「故事板完成了吗？就开始设计图片？」，根因是三份判据互相放水：`mode !== 'confirm' → 放行`（auto 全开）、`state` 判据不看 `landed`。四层一次收口：**L3** auto 模式在「收尾信号 `awaitingLanding` + blockers 清零」时自动落地（信号是必需的 —— 写完 §04 那一笔 blockers 就已清零，只看它会在半途落地、把 §03/§05 浇死）；**L1** 新 `storyboard-gate.ts` 单一放行点，9 个产出工具只判 `landed`、与 mode/state 解耦，`approval-gate` 的产线分支删除，新增 **CS-STORY-001**；**L2** landed 在而 state 停在 storyboarding 时补推 executing（只修显示、不放行）；**L4** 新工具 `adopt_canvas_as_storyboard` 从画布分镜卡反推 §04 骨架（「不豁免存量」的唯一出路）。回滚开关：`CANVAS_STUDIO_AUTO_LAND_STORYBOARD=0` / `CANVAS_STUDIO_ENFORCE_STORYBOARD_LANDED=0`。新增 21 条测试，全量 smoke 0 红。已知边界：auto 模式下**绑镜出图**仍不受拦（`approval-gate` 的 shotBound 分支受 mode 影响），下一批由 gate 接管）
> **上一条 2026-10-25**（**CV-366 REQ-035 G1–G4 skill/工具可理解性审计收口（待桌面验收）** —— 「agent 读不懂工具与文档」的代价已可量化：每步 reasoning 2.7–4 万字符、24 次源码探索、5 次压缩。五处一次修完：G1 `scaffold_manifest` 未进 skill 流程；G1b 解释器 skill 未指工具总表；G2 `render_composition` 的 id 未标必填；**G3 描述瘦身 6,628 → 1,167 字符（-82%）**——原描述把 manifest 契约又抄一遍（easing 13 档 / orbit / shape 全表 / transition / audioViz / look），与 `manifest-contract.md` 33KB 成两套事实必漂移，现只留何时用 / 两条入参通道 / 5 条硬边界 / 质量档 / probe / 返回构成 / 体检提示，全部工具描述+schema **41,642 → 36,181 字符**；G4 新增 `references/errors.md`（10 个错误码 × 何时出现/改什么/别做什么 + 3 条通用原则）。瘦身被 `remotion-shape-box` 拦下一次，据此确认 **7 条事实必须钉在「永远在场」层**（manifestPath / 尾部完整性校验 / 时长判据原文 / 隐藏渲染窗口 / 关掉 App 会中断 / x/y 是形状中心 / 铺满写法）。skill 系列 158 条全绿，smoke 0 红）
> **上一条 2026-10-24**（**CV-365 16 条引擎契约入库 + skill 纪律补强（待桌面验收）** —— 同一复盘的另一半：agent 为搞清「圆点占多宽 / 字号会不会自动放大 / glow 能不能换色」读了 27 次组件源码、烧 1.5h，还因此触发 5 次压缩。修法：`code-driven-explainer/references/manifest-contract.md` 新增「实现细节」**16 条**（circle 直径只看 `box.w`、line 的 `box.x` 是左缘、bullets 圆点常显占 18+24px、自动排版只缩不放、`fx:glow` 固定冷蓝、`temperature>0` 走 -12deg 而冷调必须给负值、path 非等比、`durationInFrames===max(end)`、`exit ≤ 轨道时长`、`render_composition` 别传 `projectId`…）；新增 `tests/manifest-contract-doc.test.mjs` **把文档断言回对源码**（10 条短语↔正则，源码改了文档没跟即红）+ 章节完整性 + 旧口径残留检查。SKILL.md 补三条纪律：**有下一步就别停轮**（事故里阶段成功后白等 36 分钟）、**先看工单再看内容**（`工单：…` 显示未认领/无首帧 或最小探针 >1s/帧 ⇒ 判环境、停止缩 manifest）、`CS-RENDER-TIMEOUT` 按诊断三分类处置。SKILL.md 10.1KB（≤12KB 闸内）；全量 smoke **2143·2143 全绿**）
> **上一条 2026-10-24**（**CV-364 编排体检去重/呼吸豁免 + inspect_image 能力对齐 + 资产生命线（待桌面验收）** —— 三处「工具说了做不到的事」：① ML-04 按**分段**逐条 push ⇒ 同轨 3 段长呼吸刷出 14 条，把真告警挤出上限；改为 `(code,at)` 去重 + **往复呼吸豁免**（首尾状态相同即判循环脉动）。② `inspect_image` 描述写「唯一像素真值来源、不要再手写脚本」，实测深色屏压深色背景时 bbox 退化成整图（threshold 收到 8 仍占 97.3% 宽）⇒ agent 自写 9 个解码脚本；改为新增 `mode:"grid"`（32×18 亮度表 + 最暗/最亮块坐标）、`bbox-*` 加 `region` 限定扫描区、覆盖率分母改扫描区且 >90% 显式告警「结果不能用来定位」，并如实交代边界。③ `asset-gc` 的「根目录孤儿物理删除」是本次三份中间图消失的真凶（此后连历史工件都无法重放）⇒ 改为**只登记不删**（`orphansRemoved:number` → `orphans:string[]`），素材缺失报错补「同目录相近文件」提示。测试 +7（motion-lint 3 / inspect-image 4）；smoke 2132·2132。详见 [cv-details.md](./cv-details.md)）
> **上一条 2026-10-24**（**CV-363 REQ-035 渲染可靠性 P0：认领/改派/看门狗 + 工单诊断 + 字段语义（待桌面验收）** —— 智能手表成片 39 次 `CS-RENDER-TIMEOUT` / 0 成片的根因：**工单基本没走隐藏窗口**（真机日志全天 0 次改派、`RenderHost 已创建` 8 次但销毁时刻总落在「零成功渲染」时段之后 5 分钟）。五个结构性缺陷一次修完：① 派单闸与改派闸共用 `renderHostReady()` ⇒ 闸一关新单推给画布页、同时禁止窗口接管（**新增 `renderHostCanTakeOver()` 解耦**）；② `clientClaimedAt` 一次打点即永久放弃改派（claim ≠ 在渲）⇒ 改三档滞留判据（未认领 15s / 认领后无进度 20s / 开渲后停滞 90s，原因串进日志）；③ client 单无看门狗 ⇒ `armLivenessWatchdog` 两种执行者都装，并以 `maxProgress` 区分「取单没动」与「在渲只是慢」，**有窗口可接管时让位给改派**；④ 冷启预算 3s→8s（3s 是纸面值，首单几乎必判给画布页）；
> ⑤ 工具超时不通知页面、`currentJobId` 非空后轮询永久跳过 ⇒ 工单载荷下发 `deadlineAt`，页面到点自 abort。配套：`RenderJobDiagnostics` 进结果文本（`工单：画布页 · 未认领 · 无首帧 · 用时 90.0s`）、`CS-RENDER-TIMEOUT` 文案**删掉「请确认画布页面已打开且可见」**（与工具描述互斥且被四档窗口实测否证）改带 `{diagnosis}`、报告字段修正（新增 `prepareMs`/`renderMs`，`msPerFrame` 不再掺准备阶段，`encodeMs`→`encodeDoneAtMs`，**删 `warm`**）、`probe:true` 探针不落画布/不抽帧/跳过体检。**注意：本条推翻 [CV-359] 的「claim 过就永不改派」判据**（Phase 0 证明该判据把卡住的单永久锁死）。新增 `tests/render-host-takeover.test.mjs` 10 条；smoke 2119·2119。详见 [cv-details.md](./cv-details.md)）
> **上一条 2026-10-23**（**CV-362 inspect_image 像素级图像检测工具 + 先粗后精纪律（验收中）** —— 复盘 P1-3 修复：环境无 PIL/ImageMagick、agent 手写 8 个 PNG 解码脚本烧 25 分钟。新 `src/inspect-image.ts`（零依赖 PNG 解码：colorType 0/2/3/4/6 × bitDepth 1/2/4/8/16 × 滤波 0-4；JPG/WEBP/隔行显式报错）+ 宿主工具 `inspect_image`（profile / bbox-dark·bright 亮度阈值包围盒 → **画布百分比中心与宽高，与 render_composition 的 box 同口径直接填轨道** / colors 主色 top-N）；工具描述写明「唯一像素真值来源，禁手写解码脚本」。配套：总纲「先粗后精」一行（用户声明「不需要精准」后禁像素量测；总纲 11261B 压在 11KB 硬闸内，等量置换）、平台事实清单 #12/#13（像素真值唯一来源 / 临时脚本写项目 `build/`，/tmp 会被清空）。登记六处：tool-registry 计数 25→26、toolchain 绑定表、canvas-studio-tools §C2、docs/README、STATUS §3.4、tool-presentation 展示表 + param-guard 参数分类（filePath/threshold/topN）。**门禁实证**：首次全量 smoke 抓出 4 红全数修复（裸抛守卫 12 处 → throwError(CS-USER-ERR) / 参数分类 / 分流② 措辞 / 展示表漏登记）；终验 **2111/2111 全绿、基线外新增 0**。另：同批复盘与两份 skill 体系文档（orchestration-upgrade-plan v1.1 + review、quality-system-design-review）一并入库。详见 [cv-details.md](./cv-details.md)）
> **上一条 2026-10-23**（**CV-361 render_composition 传路径通道 + 尾部截断校验（待桌面验收）** —— 同一复盘（[session-postmortem](./session-postmortem-code-driven-explainer-2026-10-23.md)）的两个渲染入参缺陷：① 长片内联 manifest 过大被截断仍发起调用，白烧一次 186s 渲染窗口；② 宿主校验只查超长不查**缩水**（尾部轨道丢失照样放行）。修法：新增 `manifestPath` 参数（绝对路径，与 `manifest` 二选一，8MB 上限）+ `manifestTruncationError()` 纯函数（`meta.durationInFrames` 必须 = 全部轨道最大结束帧，缩水即拒收并给修复指引；**只放宿主工具入口**——`validateManifest` 被客户端校正路径复用，真值校正会合法缩短轨道，不能共享该语义）。同步四处文档（toolchain / canvas-studio-tools §B4 / code-driven-explainer manifest-contract 头部「长片必须走 manifestPath + 组装自洽自查」）。manifest + render-tool-contract 26/26；skill 门禁 24/24；tsdown + tsc×2 全绿。详见 [cv-details.md](./cv-details.md)）
> **上一条 2026-10-23**（**CV-360 压缩摘要请求输出超网关上限致 18 连败（待桌面验收）** —— 真机会话复盘（[session-postmortem](./session-postmortem-code-driven-explainer-2026-10-23.md)）钉死 P0 根因：compaction-basic 零配置挂载，摘要请求默认带 `max_completion_tokens: 65536`（=headroomTokens 默认值），超 DramaServer `/v1/llm` 32k 输出上限 → 每次压缩 `400 invalid_argument`，18 连败后上下文烧穿 215K/262K，会话死于 max-tokens。**实测对照**：65536→400、32768→200、1024→200（逐字节复现会话错误体）。修法两处：① `dsh-plugin-desktop/cordis.patch.yml` 给 compaction-basic 显式 `config.maxTokens: 32768`（根修，无需动 submodule）；② `canvas-studio/src/gateway.ts` 模型行补 `maxTokens: GATEWAY_MAX_OUTPUT_TOKENS(32768)`，压缩压力预留（`reservedCompletionTokens` → `defaultMaxTokens`）真实计入 32k，触发时机修正。老安装升级即生效：启动 `recoverGatewayFromCache` 走 deep-strict 比较不走指纹门，重启后自动重写网关行。gateway 单测更新 + 新增守卫断言（maxTokens 必须 < 65536）；tsdown + tsc×2 全绿。详见 [cv-details.md](./cv-details.md)）
> **上一条 2026-10-23**（**CV-359 渲染工单滞留改派 + 画布页轮询保活（待桌面验收）** —— 修 10-20 起真机 `render_composition` **11 连败**（全部 `CS-RENDER-TIMEOUT`，签名：RenderHost 已创建 → 5min idle 销毁 → 超时）。双根因：① 画布页 `pollRenderJob` 「扑空 ⇒ 停表」，而宿主建单晚于最早几拍（校验/素材探测可达几十秒）⇒ 工单永久无人认领（`onToolFinished` 对 studio 工具不触发，停表线是死代码）；② O-06 执行者 3s warmup 错过即永远钉 client，RenderHost 替补永远接不了盘。修法：客户端 `render-poll-gate.ts` 决策表（在飞期间扑空只 hold，收工由结算回调清账，成功路径新增 `onRenderToolSettled` 钩子）+ 宿主 `claimRenderJobFor` **滞留改派**（client 单 15s 内从未被 claim 且窗口健康 ⇒ 窗口接管 + 补装看门狗；claim 打点保证看过的单永不抢）+ 改派/窗口 unsupported 两条留痕日志。新 `scripts/probe/render-host-e2e.probe.mjs` 三阶段 Electron 探针：窗口冷启实测 124~155ms（« 3s 预算）、真实渲染出片、改派全链路无超时。验证链全绿（2095·2095）；新增 10 条测试。详见 [cv-details.md](./cv-details.md)）
> **上一条 2026-10-23**（**CV-358 余额接真实数据（`/v1/credits/balance`）·左栏卡 + 只读路由 + 生成后刷新（待桌面验收）** —— REQ-030 ③ 时代的 `0 / 1,000` 纯展示占位退场。Host 侧 `account-state` 加余额三态（balance / fetchedAt / error）+ 30s TTL + `refreshCredits(force)` + `creditsView()`，token **从 auth-session 会话缓存现取**（不再抄一份，规避「退避/幂等分支提前 return 漏更新」那类 bug）；`GET /canvas-studio/account/credits`（`?refresh=1` 绕 TTL，未登录/未启用返回 200 降级体，读失败保留旧值不 500）；UI 复用左栏 `.csCredits` 卡（可用 + 冻结行、固定 4 位小数、**不自造总额度分母**）：未登录「登录后查看」可点弹登录、失败标灰留数字、403 转「账号受限」；刷新四触发 = 登录预取 / 卡挂载 / 点击强刷 / **生成彻底结束后强刷 + 6s 复检**（`generate-queue` 槽位释放置陈旧 + client 队列空闲信号）。新增 3 个测试文件块、16 条断言；验证链四步全绿（2085·2085）；反向变异两处（陈旧标记失效 / 失败清空旧值）与升级钮可点各红一条。详见 [cv-details.md](./cv-details.md)）
> **上一条 2026-10-22**（**CV-354~357** —— 模型设置页 0.2.1 断线修复 + 官方区块重设计；DramaServer 管理面 P1+P2+P4 落码，自有大模型打通聊天与设置页，改走 `settings.mutate` 避开死 entry 重放失败。详见 [cv-details.md](./cv-details.md)）
> **更早的变更记录**：2026-10 见 [`changelog.md`](./changelog.md)；2026-09 及更早归档在 [`archive/changelog-2026-09.md`](./archive/changelog-2026-09.md)；本 header 历史全文（2026-09 至 10-11 的逐条速记）见 [`archive/status-header-history.md`](./archive/status-header-history.md)。


---

## 0. 怎么用这份表

### 状态词汇（所有条目统一）

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| `已完成` | 代码落地 + 用户桌面验收通过 | 无 |
| `已修复·待验收` | 代码已改、测试过，**用户还没在桌面回归** | 重启桌面验证，通过改 `已完成` |
| `进行中` | 正在改 | 继续 |
| `待处理` | 方案已明确，可直接动手 | 排期 |
| `待拍板` | 方向未定，需用户决策 | 找用户确认 |
| `待复现` | 缺复现信息，无法定位 | 等用户提供 |
| `仅设计` | 有完整设计文档，**零代码落地** | 决策要不要做 |
| `已否决` | 明确不做，附原因 | 无 |
| `已分配·未登记` | 编号已在源码注释流通但 STATUS 无对应条目（记账缺口） | 补登条目或回收编号 |

### 编号规则
- **当前水位**：2026-11-05 —— **CV-446 请求体 413 止血：网关图片预算对齐实测上限（待桌面验收）**：真机会话连续读 15+ 张图后请求体撑爆 DramaServer `/v1/llm` 的 **4 MiB 硬上限**（`content-length ≤ 4194304` 进应用层、`4194305` 即 413；错误体与事故逐字节一致），413 被 `llm-pi-ai/stream.ts:48` 归类 INVALID_REQUEST 终态 ⇒ 重发必败、`compaction-image-offload`（只认 `IMAGE_OFFLOAD_REQUIRED`）不接管 ⇒ 会话永久卡死。**两道本地防线为何全失效**：① spill-policy 因 `llm-pi-ai` 无 `imageRequestPricing` 抛「no image token calculator」被吞，带图工具结果**永不截断**（日志 14:38 起刷屏）；② pi-ai 的 `maxRequestImageBytes` 默认 **20 MiB 仅计图片字节**，与网关「整包 4 MiB」错位，自愈在 413 前没机会触发。**修法（P0，编辑区内）**：`gateway.ts` 新增 `GATEWAY_MAX_REQUEST_IMAGE_BYTES = 2 MiB`（< 4 MiB 且留 ≥2 MiB 文本历史头部）写进 `gatewayProfile()` + 纳入 `gatewayFingerprint`（常量改动能被 reconcile 指纹门发现并热重写，CV-435 教训）；`tests/gateway.test.mjs` 回归断言（字段在场 + `< 4 MiB` + 指纹含字段）。P1（spill-policy 中性估算兜底 / PiAiAdapter 补 `imageRequestPricing`，**上游子模块轨道**）与 P2（服务端放大上限 + 413 带 `limit` 字段）见根仓分析文档。验证：typecheck / build / verify:loader / `test:smoke` **2841·2841 0 红**。**⚑ 待桌面验收**：新会话连续读 15+ 张图不再 413，日志出现 `image/offload` 事件、最老图片转占位文本、会话继续。详见下条。
- **上一条水位**：2026-11-05 —— **CV-445 rea-video 能力吸收批 S1–S4 落码（待桌面验收）**：S1 自适应切点检测（`src/shot-detect.ts`，HSV 直方图+像素差分合成 / 局部自适应阈值 / 变化面积门限 / 黑场淡入淡出；**原生帧率逐帧采样**封顶 30fps——B 站真值片实测 6fps 定档只有 3/10，原生 9/10）+ teardown-verify/evidence-grid 切点口径同源升级（`detector:'legacy'` 可退回）；S2 确定性取证三项（`src/method-evidence.ts`：AIGC 元数据字节扫描 / 帧率指纹 / 冻结帧）；S3 生成单元规划（`src/plan-generation-units.ts` + 第 47 号工具 `plan_generation_units`，DP 求最少单元，只出计划不代执行）；S4 自动对比片（`src/compare-video.ts` + 第 48 号工具 `make_compare`，并排烧标签零模型费用）+ 能力地图 JSON（`capabilities/`）。验证：build EXIT=0 + verify:loader 干净 + 全量 smoke **2812·2812 0 红** + B 站 20s 真值片基准**命中 9/10 / FP 0**（rea-video 同片 9/10 / FP 2，严格不劣；10.40 两边同漏）。顺手清账：本次 5 守卫红（裸抛/字段漂移改名 samples/参数分类 12 项/CV-404 skill 引用/REQ-008 展示表）+ CV-444 存量 3 红（行数/跨度棘轮补登 + `--cs-z-toast` 幽灵令牌补进 brand.ts）。详见下条。
- **上一条水位**：2026-11-05 —— **CV-444 UI 审查清单 14 条加固批落码待桌面验收**（统一确认闸门 / 全局焦点陷阱 / z-index 阶梯令牌 / `DraftField` 失焦提交 / 导入上限唯一实现点 + `tests/ui-hardening.test.mjs` 7 条护栏与反向变异实证；build + verify:loader 全绿，全量 smoke 待用户终端）。本批与六体裁主线解耦，不参与科普首轮会话差分。上一水位：CV-443 读图线补漏收尾 + 段 A 七批全部落码（详见下条）。
- **上一条水位**：2026-11-05 —— **段 A 七批全部落码，段 A 完毕（执行计划 `docs/2026-11-04-科普线后续执行计划.md` §5.1.1）+ CV-443 读图线补漏收尾（B-1 漏项清账 + 分册/散点取证层级对齐）：CV-442 B-6 六体裁工程准备（六壳工程纪律节 + 五 executor 取证层级 + skill-genre-guardrail 护栏）/ CV-441 B-5 机制补完（P-02 字段表漂移检查 + 四字段补登记 / P-03 未知键文案不越界+近似提示 / P-05 ML-04 浮点边界 / P-16 reveal 缺省方向误报）/ CV-440 B-4 数据溯源契约（chart dataSource/baseline + dataCard 收窄口径 + storyboard pending 事实桥，全部观察期 warning）/ CV-439 B-3 体检回执消费端（lint 计数+前5条原文+落盘 build/ 路径，反向变异实证）/ CV-436 B-0 负例纪律纠偏（负例降级为验收可选测试手段，十处污染点清零）/ CV-437 B-1 读图线整理（LLM 主读/VLM 保底 + D6 `list_references` 回执本地图路径）/ CV-438 B-2 #11 运动口径统一（`trackMotionFeatures` SSOT + `reveal.out` 进 ML-02 豁免 + 漂移靶反向变异实证）**。上一水位：CV-435 读图能力恢复 + CV-427~434 科普线 0.1 验收修复批待桌面验收（animate 窗口静态校验 / reveal 退场擦除 / 六体裁壳消解句 / 验收结论传递 / ask_user_choice 兜底 / ML-10·ML-04 / 字幕卡排版预算）。更早：六大体裁阶段 2/3/4 落码批 CV-419~426、阶段 1 CV-415~418 待桌面验收。整片验收开放：1.4 / 2.3 / 3.4（连续两集）/ 阶段 4 视觉目检。
- **上一条水位**：2026-11-02 —— **CV-396 订阅与积分接入（Stripe Checkout/Portal 全链路 + G1 余额闸 + 积分整数口径）落码待桌面验收**（方案 `plans/订阅与积分接入方案-20261102.md`）。
- **主线编号 `CV-xxx`** — 画布侧全部条目（缺陷 + 优化 + 小需求）共用一条序列，**水位以 §4.1 索引表为准**（当前已编到 **CV-456**）。新增号直接 +1，不必 grep 整树。⚠️ `docs/skill-user-upload-design-2026-10-16.md` §4 曾把 CV-327~CV-330 **预留给用户上传 skill 分批**（该文是待拍板草案、未落地）；**该区间已全部被本轮 REQ-034 占用**（B3/B4 → **CV-327**、R1 字体 → **CV-328**、R6 路由 → **CV-329**、R3/R4 物化+硬失败 → **CV-330**），用户上传线重启时**以 §4.1 水位为准另取号**（或回写该草案）。历史号归属（各号的落地内容与日期）见 §4.1 / [`cv-details.md`](./cv-details.md) / [`changelog.md`](./changelog.md)。
- **历史编号 `O1-O5` / `F1-F8` / `R1-R4`** — 早期文档遗留，不复用。映射关系见 [§6 历史 ID 映射](#6-历史-id-映射)，避免查旧文档时对不上。
- **条目详情**写在 [cv-details.md](./cv-details.md)（本表 §4.1 的详情层，按 CV 号 grep）、[canvas-ux-backlog.md](./canvas-ux-backlog.md)（CV 条目技术方案）与各分析文档中，**本表只管状态**。

### 0.3 维护纪律（速览表自动生成）

> §1 速览表**禁止手改**，由 `scripts/status-summary.mjs` 读取 §4.1 索引表 + `archive-cv-completed.md` 自动重算并回写（幂等，用 HTML 注释标记包住，可重复跑）。
> - **新增条目**：① §4.1 索引表加一行（`ID | 状态 | P | 标题`，标题 ≤ 40 字符）；② [cv-details.md](./cv-details.md) 加对应 `#### CV-xxx` 小节（详情 / 涉及文件 / 落地·验收）；③ 跑 `node scripts/status-summary.mjs`。
> - **条目结项（已完成·桌面验收通过）**：§4.1 整行移到 `archive-cv-completed.md`（`#### CV-xxx` 形态），详情小节留在 cv-details.md，再跑脚本。
> - **行长纪律**（守卫 `tests/status-shape.test.mjs` 强制）：**单行 ≤ 400 字节** —— 整段正文不要塞进表格单元格，改用独立小节；表格单元格内的 `|` 必须写成 `\|`。
> - 状态文案对齐 §0.1 词汇；纯占位未登记的号标 `已分配·未登记`，脚本会汇总报警，便于发现记账缺口。
>
> **体积纪律（2026-10-13 审计后新立，三条）**：
> - **文件头「上一条 …」只留最近 3 条**。更早的删掉即可（内容已在 [`changelog.md`](./changelog.md) 里）；文件头不许再当第二份变更记录用 —— 本次瘦身前它单独占了 6 万字符。
> - **变更流水不进本文件**：2026-10 起的逐条变更已整体迁到 [`changelog.md`](./changelog.md)（只追加）；更早按月份归档在 `archive/changelog-YYYY-MM.md`。新增变更记到 changelog.md，**不要往 §8 加行**。
> - **单行长度红线 ≤2KB**。表格行内容过长请拆行或下沉到 backlog —— 超长行会让 `Read limit` 失效（`limit=24` 本意读约 1.5KB，撞上 1.6KB/行的表却灌进 40KB）。这是本文件 2026-10 之前最大的 token 黑洞，比总字节数更致命。

---

## 1. 速览（30 秒看全局）

<!-- STATUS_SUMMARY_START -->
| 已完成 | 150 | CV-001~004, CV-008~020, CV-022~035, CV-037, CV-038, CV-041, CV-044, CV-045, CV-061, CV-063, CV-068, CV-070, CV-072, CV-074, CV-076~078, CV-089, CV-094, CV-097~100, CV-109, CV-112, CV-114, CV-115, CV-119, CV-124, CV-125, CV-138~144, CV-146, CV-148, CV-149, CV-153, CV-155, CV-161, CV-162, CV-174, CV-176~179, CV-194, CV-204~206, CV-221, CV-222, CV-241~244, CV-246, CV-251~257, CV-259~272, CV-279~288, CV-293, CV-295~310, CV-313~316, CV-350~353, CV-401~404, CV-451, CV-453 |
| 已修复·待验收 | 247 | CV-006, CV-007, CV-046, CV-050~052, CV-056~060, CV-064~067, CV-069, CV-071, CV-073, CV-079~083, CV-086, CV-088, CV-091~093, CV-095, CV-096, CV-101~108, CV-111, CV-116~118, CV-120~122, CV-127~130, CV-133, CV-135~137, CV-147, CV-151, CV-152, CV-154, CV-156~160, CV-163, CV-173, CV-180~189, CV-192, CV-193, CV-195~203, CV-209~212, CV-214~220, CV-223, CV-233~240, CV-245, CV-247, CV-274~278, CV-291, CV-292, CV-294, CV-311, CV-312, CV-317~349, CV-354~400, CV-405~450, CV-452, CV-454~456 |
| 进行中 | 1 | CV-175 |
| 已完成·待验收 | 2 | CV-049, CV-062 |
| 待处理 | 16 | CV-005, CV-021, CV-039, CV-040, CV-042, CV-043, CV-047, CV-048, CV-053~055, CV-084, CV-085, CV-087, CV-090, CV-273 |
| 待拍板 | 7 | CV-036, CV-075, CV-126, CV-131, CV-134, CV-207, CV-208 |
| 已撤回（误判） | 1 | CV-145 |
| 仅设计（零落地） | 6 大模块 | 见 §5 |
<!-- STATUS_SUMMARY_END -->

> ⚠️ 本速览表由 `scripts/status-summary.mjs` 自动生成（读取 §4.1 索引表 + archive）。新增/修改条目请在 §4.1 加行后运行该脚本，**勿手改本表**；历史遗漏已由 2026-09-21 补登（CV-175 + CV-203~214）修正。

**当前最该动的三件事**（详见 [重做方案](./redo-redesign-plan.md)）：

1. ~~**CV-052**（P0 bug）模式切换会把工作流状态误翻回 `drafting`~~ ✅ 已修复·待验收（2026-09-01）——纯函数化 + 按钮 disabled + 7 用例测试，[详情](./redo-redesign-plan.md#a2-1--修复模式切换误翻状态--cv-052p0必修10-分钟)。
2. ~~**CV-050**（P1 bug）打回后重新提交分镜，旧卡不删只追加~~ ✅ **已修复·待验收（2026-09-17）** —— 按 D4 方案 A 落地：按镜号复用旧卡（id 与位置原地不动、只更新文案），新镜号新建并避让已占格，多余旧镜号卡保留；+8 用例。
3. ~~**CV-051**（P1）关键帧阶段只有「确认」没有「打回」~~ ✅ **已修复·待验收（2026-09-17）** —— 确认条内加意见框 +「打回重出」，状态回 `executing`（否则 `image_generate` 被 `PRODUCING_TOOLS` 闸拦死）后带意见唤醒 AI；+3 用例。
4. 剩余 P1 待处理项：CV-005（血缘边不能删）、CV-039（H3 三字段声音规范未内化）、CV-040（多段成片音轨断裂）、CV-054（无单版本回退，D5 已拍板方案 A）。
5. ~~**CV-056**（P1）切模式解除等待后不唤醒 agent~~ ✅ 已修复·待验收（2026-09-01，与 CV-052 同批）。

---

## 2. 缺陷追踪（Bug）

### 2.1 未解决

> **本表只管状态**。问题全文 / 位置 / 修法要点在 [cv-details.md](./cv-details.md) 对应
> `#### CV-xxx` 小节的「**缺陷追踪（§2.1）**」块 —— 按号 grep：
> `grep -n -A8 "#### CV-052" docs/cv-details.md`。
>
> 纪律同 §4.1：单元格内的 `|` 写 `\|`，问题列 ≤ 40 字符，**不要把整段正文塞回单元格**。

| ID | 状态 | P | 问题 |
| --- | --- | --- | --- |
| CV-052 | 已修复·待验收 | **P0** | 在 keyframe_review 或 executing 状态下再点一次顶部… |
| CV-056 | 已修复·待验收 | **P1** | 模式切换把 awaiting_approval / keyframe_revi… |
| CV-195 | 已修复·待验收 | **P2** | 三类离线产物点「重试」无反应 |
| CV-050 | 已修复·待验收 | **P1** | 打回后 AI 重新提交分镜，buildShotCards 无脑追加整套新卡，旧… |
| CV-051 | 已修复·待验收 | **P1** | 关键帧阶段只有「确认关键帧」没有「打回」 |
| CV-057 | 已修复·待验收 | **P1** | 视频播放没有进度条也没有任何控制按钮 |
| CV-060 | 已修复·待验收 | **P1** | 应用名迁移半途、两处不一致 |
| CV-058 | 已修复·待验收 | P2 | 上传图片没有任何选项 |
| CV-059 | 已修复·待验收 | P2 | 工具栏改版 |
| CV-067 | 已修复·待验收 | **P1** | 竖屏成片（9:16，480×864）在画布上横屏显示被 object-fit:… |
| CV-068 | 已完成·桌面验收通过 | **P1** | 主模型无视觉（CV-435 已更正：实为能力声明缺失，非模型限制） |
| CV-069 | 已修复·待验收 | P2 | 用户信息区缺失（竞品对标 MiniMax Design，2026-09-02… |
| CV-070 | 已完成·桌面验收通过 | P1 | 技能卡动态预览（竞品 DA-1） |
| CV-071 | 待修复（弹窗未显示 GIF 预览） | P2 | 技能卡悬停浮层 + 查看详情（竞品 DA-2） |
| CV-072 | 已完成·桌面验收通过 | P1 | 技能广场搜索（竞品 DA-3） |
| CV-073 | 待修复（我的 Skill 视图缺陷） | P2 | 「我的 Skill」视角（竞品 DA-4） |
| CV-074 | 已完成·桌面验收通过 | P2 | 官方精选分区（竞品 DA-5） |
| CV-075 | **暂缓** | P3 | 作者署名/下载量（竞品 DA-6） |
| CV-076 | 已完成·桌面验收通过 | P3 | H3 能力角标（竞品 DA-7） |
| CV-077 | 已完成·桌面验收通过（过滤通过；排序仍未做） | P3 | 未激活过滤 + 排序（竞品 DA-8） |
| CV-078 | 已完成·桌面验收通过 | P3 | 创作者社区 CTA 收尾卡（竞品 DA-9） |
| CV-079 | 已修复·待验收 | P1 | 生成产物自动编组 |
| CV-080 | 已修复·待验收 | P1 | 生成节点命名精准化 |
| CV-081 | 已修复·待验收 | P2 | 文本节点选中可滚动 |
| CV-082 | 已修复·待验收 | P2 | 视频 hover 自动播放 |
| CV-083 | 已修复·待验收 | P2 | 视频时长角标（竞品 DA-14） |
| CV-084 | 待处理（**单独排期**） | P2 | 制作计划阶段清单（竞品 DA-15） |
| CV-085 | **远期记录** | P3 | 视频 hover 快捷工具条（竞品 DA-16） |
| CV-086 | 已修复·待验收（由 CV-091 实现） | P3 | 项目分组管理（竞品 DA-17） |
| CV-087 | 待处理 | P2 | 项目封面缩略图（竞品 DA-18） |
| CV-088 | 已修复·待验收 | P3 | Lobby 个性化问候（竞品 DA-19） |
| CV-089 | 已完成·桌面验收通过（2026-10-13） | P1 | 画布选中/拖动视觉修正（用户多轮实测反馈） |
| CV-090 | 待处理 | P2 | 框选（marquee）交互改进 |
| CV-091 | 已修复·待验收 | P3 | 左侧栏用户自定义分组 + 折叠 |
| CV-046 | 已修复·待验收 | P1 | 项目注册表落 $DSH_HOME/canvas-studio/（home 级… |
| CV-047 | 待处理 | P2 | 端口被占时从 43120 起向后重试 32 个，静默换端口无任何提示，用户不知… |
| CV-008 | 已完成·桌面验收通过（2026-10-13） | P1 | 多选是半成品 |
| CV-021 | 待处理 | P2 | 删除被血缘引用的节点无提示，下游 sourceIds 静默悬空 |
| CV-094 | 已完成·桌面验收通过 | **P1** | 创作任务里 skill 调度顺序错乱（会话复盘发现） |
| CV-005 | 待处理 | P1 | 血缘连线只能加不能删 |
| CV-145 | **已撤回（误判）** | — | 所有「带文件名入参」的后端端点全部 500 → 复验证明全部可用，原判撤回 |
| CV-146 | **已完成·桌面验收通过**（2026-09-11） | **P0** | music_generation / compose_video 的产物被本地… |

### 2.2 已解决（索引）

> 🗄️ **本节已于 2026-09-03 清空并封存**
>
> 原 10 条索引（CV-002 / 003 / 013 / 030 / 031 / 033 / 034 / 037 / 038 / 044）连同全部 35 条
> 「已完成」条目，已移入封存档 **[archive-cv-completed.md](./archive-cv-completed.md)**。
>
> 该存档**只读**：不要在其中改状态、加条目、记新问题，也不要从那里找待办。
> 要追溯「某功能当年为什么这么做 / 实现细节是什么」，按 ID 去存档查。

---

## 3. 需求实现状态（按功能域）

图例：✅ 已完成 · ⚠️ 部分完成 / 有缺口 · ❌ 未做

### 3.1 项目与工作区

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 项目创建 / 打开 / 删除 / 重命名 | ✅ | 含孤儿 workspace 清理（CV-033/034） |
| 项目目录名可读 | ✅ | 提交 `f56f80673a` |
| 项目「已完成」标记 | ⏸ 待拍板 | CV-036，方案 A（手动标记 + 成片信号辅助）已提出 |
| 注册表跨实例隔离 | ✅ | CV-046 —— 写前重读磁盘 + 内存合并（内存优先）+ 删除墓碑（2026-09-17，待验收） |

### 3.2 画布基础

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 无限画布 / 缩放 / 平移 / Minimap | ✅ | |
| 节点创建 / 移动 / 删除 / 层级 / 锁定 / 隐藏 | ✅ | |
| 右键菜单（节点 + 空白） | ✅ | CV-037 / CV-016 |
| 方向键微调（1px / Shift 10px） | ✅ | CV-017 |
| 缩放到选中、双击空白适配视野 | ✅ | CV-019 |
| 整理布局（按血缘左源右目标分列） | ✅ | F4 |
| 撤销 / 重做 | ✅ | 入口已按组隐藏（`e53aa0a7f2`），功能保留 |
| 多选拖拽 / 框选 | ✅ | CV-008（2026-10-13 桌面验收通过；CV-090 框选体验改进仍待处理） |
| 血缘连线删除 | ❌ | CV-005，D3 拍板延后 |

### 3.3 节点与内容

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 6 种节点 kind（image/video/sticky/text/prompt/group） | ✅ | 分镜卡 / 文案 / 创意均为 text + toolName 区分 |
| 文本内联编辑（双击 + 详情面板） | ✅ | CV-001，D1 方案 A |
| 媒体框比例自适应（长边 480） | ✅ | CV-029 |
| 图片大图预览浮层 | ✅ | CV-045 |
| 视频固定尺寸播放浮层 | ✅ | CV-044 |
| 详情面板 + 生成参数结构化展示 | ✅ | CV-012（提示词可复制 / 参考图反查 / 参数行 / 原始 JSON 折叠） |
| 节点详情抽屉（就近工具条 + 底部可拖高抽屉，取代原屏幕右上固定浮层） | ✅ | CV-194（2026-09-17 验收通过：工具条不随缩放 / 抽屉底边贴时间轴且不压对话栏 / 高度可拖且记忆 / 提示词三档 / 8 个不可重放节点不显示重试） |
| 参考角标 + 参考托盘空态引导 | ✅ | CV-011 |
| 资产下载（右键 + 详情面板） | ✅ | CV-020 |
| loading 已耗时 + 超 3 分钟打断提示 | ✅ | CV-010 |
| toast 替代 window.alert | ✅ | CV-015 |
| 节点版本历史 / 回退 | ❌ | CV-054（单版本回退）、optimization-plan §3.2（双层版本控制，仅设计） |
| 下游过时标记（上游重做后提示） | ❌ | CV-055 |

### 3.4 生成与工具

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 50 个 Host 工具（49 真实 + 1 占位） | ✅ | **49 真实工具 + 1 占位**（`subtitle_burn`）。**逐个清单以 `docs/canvas-studio-tools.md` §A/B/C/C2/D 为准**（50 行表格：A 16 / B 4 / C 13 / C2 16 / 占位 1），注册面以 `src/host-tools.ts` + `host-tools-audio.ts`（`analyze_beats`/`snap_cuts_to_beats` 经 `defineAudioTools` 工厂展开注册，CV-401 补指针）+ `host-tools-artifact.ts` + `host-tools-remake.ts` + `host-tools-data.ts` + `host-tools-series.ts` 的 `defineTool` 为准。**2026-09-11 收敛**：`inpaint` / `style_transfer` / `storyboard_generate` / `storyboard_split` 已从注册表删除（连带端点与分支代码；`deduction` 更早已移除）；REQ-022 另退役 `write_screenplay` / `submit_screenplay_for_approval` / `submit_storyboard_for_approval`（历史画布卡仍带这些 `toolName`）。<br>该数字由 `tests/tool-registry.test.mjs` 钉死（总数 + 名单 + 不重名），增删改名即红；2026-10-12 AR-06 计数勘误见 changelog 2026-10-12 行与 cv-details。**CV-448（2026-11-06）+`asr2txt`，并清 43 → 50 的存量漂移**（`import_csv` 44 / `series_manage`·`episode_brief` 45~46 / `plan_generation_units` 47 / `make_compare` 48 / `confirm_intent_card` 49 / `asr2txt` 50） |
| 节点重试 / 修改提示词重放 | ✅ | 原地覆盖，保留 id / 位置 / 血缘 |
| 生成落点策略（来源右侧 + 防重叠） | ✅ | CV-024 |
| 血缘自动反查（按 Drama filename） | ✅ | CV-022 |
| 创意节点自动捕获 | ✅ | CV-023（首条真人消息落「创意」节点） |
| 分镜表逐镜拆卡 + 自动连创意 | ✅ | CV-026 / CV-025 |
| 关键帧 / 视频连所属分镜卡（shotRefs） | ✅ | CV-027 + CV-031 兜底 |
| 多模型切换 | ❌ | 后端统一 FL2VA（H3），model / resolution / generateAudio 是占坑参数，显式传参会返回 warnings |
| 声音能力（BGM / 配音 / 字幕烧录） | 🟡 | **2026-10-26 更新**：BGM 生成 ✅（CV-125/146 转正并验收通过）、音画同步链路 ✅（CV-138/140/141/142/143 全部验收通过 —— 真值时长 / 单镜保留原生音轨 / 多镜丢轨 / BGM 守卫 / 音轨构成角标）、**TTS 配音 ✅**（CV-271 占位升真：Drama `txt2speech` / VoxCPM2；含 `speed` / `pitchSemitones` 宿主后处理，多轨旁白 `audio.voiceOver[]` 已落地、2026-10-26 完成能力实测与音色锚规范）；**仍缺**：字幕烧录（`subtitle_burn` 占位降级）、Master Audio 全局对齐（CV-040）、三字段声音规范内化进 `creation-spec.ts`（CV-039 部分落地，六段规划法在） |

### 3.5 工作流与 HITL

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 分镜审批闸（`awaiting_approval`） | ✅ | 硬闸，拦在触达 Drama 之前 |
| 关键帧确认闸（`keyframe_review`） | ✅ | O4 方案 A + CV-176 扩面：`PRODUCING_TOOLS`（`FORMAL_TOOLS` + `image_generate` / `character_generate`）在三个审阅态一律拦死；`shotBound` 只用于区分 `drafting` 下的「逐镜关键帧」与「Look 样张」 |
| **关键帧打回** | ✅ | **CV-051** —— 意见框 +「打回重出」→ 状态回 `executing` 后带意见唤醒 AI，重出后再弹确认条（2026-09-17，待验收） |
| 审批 / 确认后自动代发「继续」 | ✅ | O1，`client/index.ts` wakeAgent |
| 分镜打回 + 意见输入框 | ✅ | R1，意见随驳回消息转述 Agent |
| **分镜重新提交去重复用** | ✅ | **CV-050** —— 按镜号复用旧卡（id / 位置原地不动、只改文案），新镜号新建避让，多余旧卡保留（2026-09-17，待验收） |
| 模式切换（逐步确认 / 放手跑） | ⚠️→✅ | CV-052 状态误翻（P0）与 CV-056 不唤醒 agent（P1）均已修复（2026-09-01），待桌面验收 |
| 设置页「默认执行模式」生效 | ✅ | R1，`ProjectRegistry` 接收 live provider |
| `ask_user_choice` 选项卡片 | ⚠️ | 可选可答，但无高亮选中态（O2）、自由输入为 opt-in（CV-049） |
| 审批条醒目化（高亮 + 角标） | ❌ | CV-053 |
| 打断生成中节点 | ✅ | |

### 3.6 成片

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 片段拼接（compose_video） | ✅ | 禁重新生成，只拼已有片段 |
| 成片自动定位 | ✅ | F1 |
| 成片导出 / 下载 | ✅ | CV-020 |
| 时间轴排除片段 | ✅ | CV-006：chip 勾选态（`composeExcluded` 持久化，作废片段禁用联动） |
| BGM 节点选择 | ✅ | CV-006：时间轴 BGM 下拉（`composeBgmNodeId`，失效自动回退；与 agent 同一 `/compose` 通路） |
| 多段音轨统一（Master Audio） | ❌ | CV-040，`compose.ts` 有 amix 半成品 |
| 时间轴语义（只显示媒体 + 总时长） | ✅ | CV-007 最小满足：默认仅媒体（可切全部）+ 真值时长角标 + 预计成片总时长；波形/刻度尺非目标 |
| 成片节点不计入片段与时长 | ✅ | CV-160：成片（`kind=video` + `toolName=compose`）是**产物不是素材**——不计入「视频片段」计数与「预计成片」，也不进 `clipIds`（杜绝递归叠加）；时间轴 chip 标「成片」角标 + 工具栏提示「成片 N 个不计入」 |

### 3.7 品牌与设置

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 品牌识别度落地 + 主题即时切换 | ✅ | `f56f80673a` / `f16d33d351` |
| 设置页扩展（输出 / 工作流 / 存储） | ✅ | `plan.md §1.7` |
| reserved 字段统一「待接入」角标 | ✅ | 不伪造已生效 |

### 3.8 账号与登录

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 登录闭环（Supabase Google PKCE） | ✅ | CV-313：Host loopback 回调 + 三条 auth 路由，client `auth/` 四时机推 token、`LoginModal` + 三态用户卡 |
| Drama 请求带 Bearer | ✅ | CV-314：4 处 fetch 全注入；消耗型（submit/upload）无 token **fail-fast 零网络**抛 `CS-AUTH-001` |
| 401 自愈链 | ✅ | CV-314：静默续期 + 原样重试一次（60s 窗去重），仍失败才弹登录窗；占位节点移除、**不标红**（可恢复态） |
| 本地直连入口前置闸 | ✅ | CV-315：节点发送/重试、参考槽解析先过 `requireSignIn()`；不满足则不进加载态、不写 `node.error` |
| 聊天前置闸 | ✅ | CV-316：唯一发送实现 `sendChatText`，未登录零发送 + 宿主保草稿 |
| 免登录部署（`supabaseUrl` 为空） | ✅ | 全闸放行（`unconfigured`），回归旧行为；测试/自托管零影响 |
| P3 计费拦截 | ⏳ | 拦截点唯一 `wrapStudioToolDefinition`，待后台给额度接口 |

---

## 4. CV 主线全量表

> **本表只管状态**（唯一加/改入口）。每条的技术细节（详情 / 涉及文件 / 落地验收）在
> [cv-details.md](./cv-details.md) 的对应 `#### CV-xxx` 小节 —— 按号 grep 取用：
> `grep -n "#### CV-311" docs/cv-details.md`。
>
> 纪律：单元格内的 `|` 必须写成 `\|`；标题列 ≤ 40 字符（守卫 `tests/status-shape.test.mjs`）。

| ID | 状态 | P | 标题 |
| --- | --- | --- | --- |
| CV-350 | **已完成** | **P1** | render_composition 抽帧与报告进文本 |
| CV-351 | **已完成** | **P1** | ML-10 动效覆盖口径修正（素材驱动片） |
| CV-352 | **已完成** | **P2** | 形状 box 中心语义统一与契约修正 |
| CV-353 | **已完成** | **P2** | skill 第 8 步补配音决策 |
| CV-354 | **已修复·待验收** | **P1** | 模型设置页 0.2.1 断线修复 + 官方区块 |
| CV-355 | **已修复·待验收** | **P1** | 管理面协议客户端与设备标识（P1） |
| CV-356 | **已修复·待验收** | **P1** | 登录 bootstrap 管理面编排（P2） |
| CV-357 | **已修复·待验收** | **P1** | DramaServer 模型网关接入 LLM（P4） |
| CV-358 | **已修复·待验收** | **P1** | 余额接真实数据：只读路由与左栏卡 |
| CV-359 | **已修复·待验收** | **P1** | 渲染工单滞留改派 + 画布页轮询保活 |
| CV-360 | **已修复·待验收** | **P0** | 压缩摘要请求输出超网关上限致 18 连败 |
| CV-361 | **已修复·待验收** | **P1** | render_composition 传路径通道 + 尾部截断校验 |
| CV-362 | **已修复·待验收** | **P1** | inspect_image 像素级图像检测工具 + 先粗后精纪律 |
| CV-363 | **已修复·待验收** | **P0** | REQ-035 渲染可靠性：认领/改派/看门狗 + 工单诊断 + 字段语义 |
| CV-364 | **已修复·待验收** | **P1** | 体检去重/呼吸豁免 + inspect_image 能力对齐 + 资产不删孤儿 |
| CV-365 | **已修复·待验收** | **P1** | 16 条引擎契约入库（文档↔源码守卫）+ skill 纪律补强 |
| CV-366 | **已修复·待验收** | **P1** | REQ-035 G1–G4 skill/工具可理解性审计 |
| CV-367 | **已修复·待验收** | **P0** | 故事板强约束 L1–L4（单一放行点 + auto 落地 + 自愈 + 迁移） |
| CV-368 | **已修复·待验收** | **P1** | shotcraft 本地化 P0/P1 + 逐点取色 + 分组坐标 |
| CV-369 | **已修复·待验收** | **P1** | 素材就绪门禁 + 卡片素材需求 + 片型配方 |
| CV-370 | **已修复·待验收** | **P2** | shotcraft 吸收 R3：第二批镜头卡 F1–F10（取证 24/24） |
| CV-371 | **已修复·待验收** | **P2** | SFX 品类 12 个 + 授权账本（R4） |
| CV-372 | **已修复·待验收** | **P3** | BGM 卡点建议器 beat-suggest.mjs（R5） |
| CV-373 | **已修复·待验收** | **P0** | 看门狗活性语义 + 预览闸门三修（会话6 根因群） |
| CV-374 | **已修复·待验收** | **P2** | 风格库分册 style-library.md（30 条纯知识风格行） |
| CV-375 | **已修复·待验收** | **P0** | 资产名唯一准入点（CR-01/CR-02 收敛 8 份白名单） |
| CV-376 | **已修复·待验收** | **P1** | @ref/shotRefs 解析容错（资产名·截断标题·sbRef） |
| CV-377 | **已修复·待验收** | **P0** | CV-040 收口：统一模型+止血+从零装配 |
| CV-378 | **已修复·待验收** | **P1** | 音频轨+混音面板+导出预检+抽屉 |
| CV-379 | **已修复·待验收** | **P1** | 声音规划 2d 步 + 三份 skill 分册 |
| CV-380 | **已修复·待验收** | **P1** | 节拍分析+卡点工具（G2 机器验收） |
| CV-381 | **已修复·待验收** | **P2** | music_generation variants 抽卡 |
| CV-382 | **已修复·待验收** | **P2** | 资产交付流式化（CR-004 收口）+ 台账对账机器闸 |
| CV-383 | **已修复·待验收** | **P0** | 渲染窗口一单一个：复用必挂（真机取证 + 探针复现） |
| CV-384 | **已修复·待验收** | **P0** | 画布瓦片内存收口：去常驻合成层 + 手势合帧 + 视口裁剪（拖缩抖动） |
| CV-385 | **已修复·待验收** | **P1** | 渲染能力基准 bench：10/10 出片 + S1/S2 + 02S Skia |
| CV-386 | **已修复·待验收** | **P1** | CSR 渲染写法护栏（三条硬约束机检） |
| CV-387 | **已修复·待验收** | **P1** | 转场收口：clock/flipX 坏点修复 + 三近似 |
| CV-388 | **已修复·待验收** | **P1** | chart 数据图表轨 + timeline 数据源 |
| CV-389 | **已修复·待验收** | **P1** | caption 词级卡拉OK字幕轨（能量谷对齐） |
| CV-390 | **已修复·待验收** | **P2** | audioViz 分频段 bandSplit（六级低通级联） |
| CV-391 | **已修复·待验收** | **P1** | viral-remake 爆款复刻编排 skill（REQ-036 R-1） |
| CV-392 | **已修复·待验收** | **P1** | image 轨 sourceRect 精灵图子区域裁切（R-2） |
| CV-393 | **已修复·待验收** | **P1** | textCard fx:outline 镂空描边字（复刻复盘批） |
| CV-394 | **已修复·待验收** | **P1** | image_matting 纯色底抠透明底工具（复刻复盘批） |
| CV-395 | **已修复·待验收** | **P1** | viral-remake 动效拆解复盘（元素列+独立轨铁律） |
| CV-396 | **已修复·待验收** | **P0** | 订阅与积分接入（Stripe 全链路 + 整数积分口径） |
| CV-397 | **已修复·待验收** | **P1** | media_probe 媒体探针工具（REQ-036 C3） |
| CV-398 | **已修复·待验收** | **P1** | evidence_grid 证据网格工具（REQ-036 C2） |
| CV-399 | **已修复·待验收** | **P1** | download_video 视频下载工具（REQ-036 C1） |
| CV-400 | **已修复·待验收** | **P1** | manifest 相对锚定 anchor 字段（REQ-036 C4） |
| CV-401 | **已完成·桌面验收通过** | **P0** | TOOL_SOURCES 补 host-tools-audio.ts（审计批） |
| CV-402 | **已完成·桌面验收通过** | **P0** | viral-remake 联动补交付（三工具入册） |
| CV-403 | **已完成·桌面验收通过** | **P0** | 节拍工具入册（mv-production 三分册） |
| CV-404 | **已完成·桌面验收通过** | **P1** | 反向对账门禁：注册面每工具必须在 skills 出现 ≥1 次 |
| CV-405 | **已修复·待验收** | **P1** | download_video 标参考 + §07 登记纪律（REQ-037） |
| CV-406 | **已修复·待验收** | **P1** | 参考身份泛化 + 素材托盘四分区（REQ-037 R1） |
| CV-407 | **已修复·待验收** | **P1** | 附件点击再落·待落画布条（REQ-037 R4） |
| CV-408 | **已修复·待验收** | **P1** | 图片链接落节点 + §07 失效标红（REQ-037 R3/R5） |
| CV-409 | **已修复·待验收** | **P1** | ShapeTrack.pivot 旋转轴心（指针/仪表盘/偏心自转） |
| CV-410 | **已修复·待验收** | **P1** | explainer-format-director 科普编排壳（L2 薄壳首发） |
| CV-411 | **已修复·待验收** | **P1** | chart line 独立折线 + dataCard countUp 数位滚动 |
| CV-412 | **已修复·待验收** | **P1** | callout 引线标注轨 + reveal 分区揭示 + 结构模板 |
| CV-413 | **已修复·待验收** | **P1** | 技能广场「体裁编排」分类 + 编排壳去重瘦身 |
| CV-414 | **已修复·待验收** | **P1** | 科普复盘收尾批（指示优先/音色澄清/1:1 翻转） |
| CV-415 | **已修复·待验收** | **P1** | handoff 交回契约最小门禁（decision 必填+指向存在） |
| CV-416 | **已修复·待验收** | **P1** | 资产库品牌三分类 + manifest logo 位（路线 1.1） |
| CV-417 | **已修复·待验收** | **P1** | brand-format-director 品牌宣传编排壳（路线 1.2） |
| CV-418 | **已修复·待验收** | **P1** | product-format-director 产品讲解编排壳（路线 1.3） |
| CV-419 | **已修复·待验收** | **P1** | 视频 1:1 画幅放行客户端三件套（路线 2.1） |
| CV-420 | **已修复·待验收** | **P1** | social-ad-format-director 社媒广告壳（路线 2.2） |
| CV-421 | **已修复·待验收** | **P1** | chart 扩型 pie/donut/gauge 饼图环形进度环（路线 4.1） |
| CV-422 | **已修复·待验收** | **P1** | import_csv 数据导入工具 CSV→chart 数据卡（路线 4.2） |
| CV-423 | **已修复·待验收** | **P1** | data-viz-format-director 数据可视化壳（路线 4.3） |
| CV-424 | **已修复·待验收** | **P1** | 短剧 episodic 剧集管理 series.json+两工具（路线 3.1） |
| CV-425 | **已修复·待验收** | **P1** | drama-episode-executor 短剧单集执行手册（路线 3.2） |
| CV-426 | **已修复·待验收** | **P1** | drama-format-director 短剧编排壳（路线 3.3） |
| CV-427 | **已修复·待验收** | **P0** | animate 窗口静态校验：段整段落在轨外/整层永久透明判 error |
| CV-428 | **已修复·待验收** | **P0** | reveal 退场擦除 `reveal.out` 契约 + 进场方向语义告警 |
| CV-429 | **已修复·待验收** | **P1** | 六个体裁编排壳 description 补「点名下游仍须先过本壳」消解句 |
| CV-430 | **已修复·待验收** | **P0** | 验收结论传递（pitfalls/verification 分册） |
| CV-431 | **已修复·待验收** | **P1** | 流程纪律进 SKILL.md：画面判据取证/spot 探针前置/未决项复述 |
| CV-432 | **已修复·待验收** | **P0** | ask_user_choice 失败兜底（非 abort 不外抛，回默认项继续） |
| CV-433 | **已修复·待验收** | **P2** | ML-10 改屏幕时间口径 + ML-04 往复豁免按可见幅度收紧 |
| CV-434 | **已修复·待验收** | **P1** | 字幕卡排版预算按盒子算（多行 subtitle 溢出裁切的通用缺陷） |
| CV-435 | **已修复·待验收** | **P1** | 读图能力恢复：网关模型行 image 声明 + 视觉禁令反转 |
| CV-436 | **已修复·待验收** | **P1** | B-0 负例纪律纠偏：负例降级为验收可选测试手段 |
| CV-437 | **已修复·待验收** | **P1** | B-1 读图线整理：LLM 主读 / VLM 保底全仓对齐 |
| CV-438 | **已修复·待验收** | **P1** | B-2 #11 运动口径统一：trackMotionFeatures 单源 |
| CV-439 | **已修复·待验收** | **P1** | B-3 体检回执消费端：计数+前5条+落盘路径 |
| CV-440 | **已修复·待验收** | **P1** | B-4 数据溯源契约：dataSource/baseline+pending 桥 |
| CV-441 | **已修复·待验收** | **P1** | B-5 机制补完：字段表漂移/未知键文案/ML-04 浮点/reveal 缺省 |
| CV-442 | **已修复·待验收** | **P1** | B-6 六体裁工程准备：六壳工程纪律节 + 通用护栏 |
| CV-443 | **已修复·待验收** | **P1** | 读图线补漏收尾：B-1 漏项 + 分册/散点取证层级对齐 |
| CV-444 | **已修复·待验收** | **P1** | UI 加固批：14 条清单落码（确认闸门/焦点陷阱/层级） |
| CV-445 | **已修复·待验收** | **P1** | rea-video 吸收批：切点检测/取证/单元规划/对比片 |
| CV-446 | **已修复·待验收** | **P0** | 请求体 413 止血：图片预算 2MiB 对齐 4MiB |
| CV-447 | **已修复·待验收** | **P1** | 画布阶段提速：节流/诊断/JPEG 探针/结构帧 |
| CV-448 | **已修复·待验收** | **P2** | 语音识别 `asr2txt`：文本 + 词级转写 JSON 落盘 |
| CV-449 | **已修复·待验收** | **P1** | （§18 词级对齐批预留，详情并入 CV-450 所在批） |
| CV-450 | **已修复·待验收** | **P1** | （§18 box 内裁切批预留，详情并入 CV-450 所在批） |
| CV-451 | **已完成·桌面验收通过** | **P1** | analyzer 全会话 turn 分解 + 跨 turn 三判红 |
| CV-452 | **已修复·待验收** | **P1** | 契约生成物「行为语义速查」段 + 缺口前置纪律 |
| CV-453 | **已完成·桌面验收通过** | **P1** | spec 编排闸：intent 前置 + scaffold 前置 |
| CV-454 | **已修复·待验收** | **P1** | 桌面通知聚焦豁免 + max-tokens 专属文案 |
| CV-455 | **已修复·待验收** | **P1** | download_video 组件下载四修 |
| CV-456 | **已修复·待验收** | **P1** | 动态思考强度 v2：storyboard 压 low + 失败升级有界降回 |

| CV-338 | **已修复·待验收** | **P1** | orbit/draw 语义原语契约与校验 |
| CV-339 | **已修复·待验收** | **P2** | 语义原语组件接线与 skill 同步 |
| CV-340 | **已修复·待验收** | **P1** | 长片渲染队列与进度通道（D1） |
| CV-341 | **已修复·待验收** | **P2** | 轨级效果栈 fx（A2） |
| CV-342 | **已修复·待验收** | **P2** | 形状族 arrow/triangle/star/polygon |
| CV-343 | **已修复·待验收** | **P2** | 转场库扩 wipe/clock/flipX（A4） |
| CV-344 | **已修复·待验收** | **P2** | textCard 自适配排版（A5） |
| CV-345 | **已修复·待验收** | **P2** | audioViz 音频可视化轨（B1） |
| CV-346 | **已修复·待验收** | **P3** | 渲染前探真实时长（B2） |
| CV-347 | **已修复·待验收** | **P3** | 渲染失败分类与有界重试（D2） |
| CV-348 | **已修复·待验收** | **P1** | compose 旁白音轨判定（D6） |
| CV-349 | **已修复·待验收** | **P2** | 覆盖层主题随切换实时刷新 |
| CV-331 | **已修复·待验收** | **P1** | 用户上传 skill 契约改造 |
| CV-332 | **已修复·待验收** | **P1** | 用户上传 skill 落盘与广场 |
| CV-333 | **已修复·待验收** | **P1** | 用户上传 skill 导入链路 |
| CV-334 | **已修复·待验收** | **P1** | Remotion 帧级动画能力补齐 |
| CV-335 | **已修复·待验收** | **P1** | 清 CV-331~333 批 6 条全量欠账 |
| CV-336 | **已修复·待验收** | **P1** | animateStateAt 多段关键帧插值修复 |
| CV-337 | **已修复·待验收** | **P2** | motion 能力主题无关通用化 |
| CV-327 | **已修复·待验收** | **P1** | `render_composition` 工具链（REQ-034 B3/B4） |
| CV-328 | **已修复·待验收** | **P1** | 随包中文字体（REQ-034 R1） |
| CV-329 | **已修复·待验收** | **P2** | 成片合成二择路由（REQ-034 R6） |
| CV-330 | **已修复·待验收** | **P1** | 素材物化层 + 缺素材硬失败（REQ-034 R3/R4） |
| CV-317 | **已修复·待验收** | **P2** | skill 语义门禁：工具引用对账 + 修 5 处 stale |
| CV-318 | **已修复·待验收** | **P3** | 删除死 skill：z-image / qwen-image 两条 |
| CV-319 | **已修复·待验收** | **P1** | 能力槽位化：总纲不再点名 skill，改为绑定表 |
| CV-320 | **已修复·待验收** | **P2** | 五类 skill 角色声明规范化（分轴可判定） |
| CV-321 | **已修复·待验收** | **P1** | 总纲瘦身 21.3→10.2 KB + 上限双指标冻结 |
| CV-322 | **已修复·待验收** | **P1** | 渐进披露门禁 + 5 个大 skill 拆 references |
| CV-323 | **已修复·待验收** | **P2** | 激活集注入 system prompt（用户勾选对模型可见） |
| CV-324 | **已修复·待验收** | **P1** | 元数据单源化：新建 platform.yaml（meta 不动） |
| CV-325 | **已修复·待验收** | **P2** | 用户上传契约：仅知识型 + 槽位冲突内置优先 |
| CV-326 | **已修复·待验收** | **P2** | 用户 skill 四条安全协议预写死进总纲 |
| CV-316 | **已完成·桌面验收通过（2026-10-15）** | **P1** | 登录 P2.2：聊天也判登录（未登录不发消息） |
| CV-315 | **已完成·桌面验收通过（2026-10-15）** | **P1** | 登录 P2.1：本地直连入口补前置登录闸 |
| CV-314 | **已完成·桌面验收通过（2026-10-15）** | **P1** | 登录 P2：Bearer 注入 + 401 自愈链 |
| CV-313 | **已完成·桌面验收通过（2026-10-15）** | **P1** | 登录 P1：Supabase Google PKCE 登录闭环 |
| CV-312 | **已修复·待验收** | **P2** | skill 入库：bible-story-director（圣经故事导演） |
| CV-311 | **已修复·待验收** | **P2** | §02「点开看原图」跳出系统浏览器（会报错/无反应）→ 改 app 内缩放浮层… |
| CV-294 | **已修复·待验收** | **P1** | 首页对话式创建认领时 .draft- 目录就地改名为项目名 + 宿主 work… |
| CV-292 | **已修复·待验收** | **P1** | 启动清扫早于「资产库位置」hydration，自定义根用户从未被清扫 → 首页… |
| CV-291 | **已修复·待验收** | **P1** | 首页 draft 落点复用优先 + 启动清扫窗口 7→1 天 |
| CV-275 | **已修复·待验收** | **P2** | skill 入库：action-scene-director（动作场面导演） |
| CV-274 | **已修复·待验收** | **P2** | skill 入库：cinematic-moves（运镜词汇库） |
| CV-273 | **已拍板（2026-10-07）· 待处理** | **P1** | 参考位 UI 三段式 |
| CV-278 | **已修复·待验收** | **P1** | 带字图路由纪律知识层对齐：Qwen 一步直出为首选，自动 image_fix… |
| CV-277 | **已修复·待验收** | **P0** | 废弃视频事件修复批（揽月湾真机取证，Bug 表 BUG-011013） |
| CV-276 | **已修复·待验收** | **P1** | 结构评审 P0 落地：门禁接入 + 基线红名单机读 + Agent 入口 |
| CV-247 | **已修复·待验收** | **P1** | BUG-010 收口：上传回执卡从视频泛化到音频与文字（首屏 / 首条消息前拖… |
| CV-245 | **已修复·待验收** | **P1** | BUG-002 收口：agent 侧的音频裁切入口 cut_audio（Hos… |
| CV-240 | **已修复·待验收** | **P1** | 质检退出生成过程 + 视频批量编排写入 skill + SKILL.md 上限… |
| CV-239 | **已修复·待验收** | **P1** | 取消不是故障：打断类调用的画布占位直接移除（ABORTED_BEFORE_DI… |
| CV-238 | **已修复·待验收** | **P1** | 视频链路两项修复（句柄形态前置校验 + 自愈判定结构化）+ 新增链路契约文档… |
| CV-237 | **已修复·待验收** | **P1** | Drama 后端 0.5.0 异步视频任务接入（提交 202 + job_id… |
| CV-236 | **已修复·待验收** | **P2** | H3 预检 R7「<Picture N> 编号不连续」从 ERROR 降为 W… |
| CV-235 | **已修复·待验收** | **P1** | 工具入参「占位值」守卫：模型给引用类入参填占位串，一路走到 SSRF 校验 /… |
| CV-234 | **已修复·待验收** | **P1** | 错误可见性「诊断开关」（设置 → 诊断）+ 一处关键认知更正：audience… |
| CV-233 | **已修复·待验收** | **P1** | 统一错误处理系统全量落地：错误码化 + 双轴路由 + 五条展示通道 + 开发者… |
| CV-219 | **已修复·待验收** | **P1** | health 探针 fail-closed 误判 |
| CV-223 | **已修复·待验收** | **P2** | 「整理布局」升级镜位泳道：行 = 镜号，行内从左到右 分镜卡 → 场景图×k… |
| CV-220 | **已修复·待验收** | **P1** | 宿主侧从来没有生成队列 —— 后端同步单任务 × 占位截止只剩 60s 余量… |
| CV-218 | **已修复·待验收** | **P1** | image2fix 自动兜底的修复 prompt 形态错误 —— 只喂字符清单… |
| CV-217 | **已修复·待验收** | **P2** | 画布上反复多出一张正文只有「占位」二字的「文案」卡 —— 模型「先占位、后回填… |
| CV-216 | **已修复·待验收** | **P1** | 放手跑下仍弹出点选卡片：卡片的有无由「模型调了什么工具」决定，而不是由「Hos… |
| CV-215 | **已修复·待验收** | **P1** | 把「后端同步单任务」纪律真正传达给模型 + 收口 CV-135 遗漏的上传超时 |
| CV-202 | **已修复·待验收** | **P2** | image2fix 文字修复端点：探针 + 工具接入 + skill 全套 |
| CV-201 | **已修复·待验收** | **P1** | 内置 ffmpeg：装机即全功能（补上 app 唯一的外部二进制缺口） |
| CV-200 | **已修复·待验收** | **P2** | 启动脚本两处幂等判据指向幽灵路径 ⇒ 条件恒为真 |
| CV-199 | **已修复·待验收** | **P1** | skill 内容源整合为单一事实源：删 skills-local/ + 删 s… |
| CV-198 | **已修复·待验收** | **P2** | 节点内容复制到系统剪贴板 |
| CV-197 | **已修复·待验收** | **P2** | 节点类型的色彩身份 |
| CV-196 | **已修复·待验收** | **P1** | 质检与预检体验优化：视频预检「先修后拦」+ 语义规则降 WARN + qc_s… |
| CV-195 | **已修复·待验收**（2026-09-17） | **P2** | 补齐三条重放链路：music_generation / character_s… |
| CV-193 | **已修复·待验收** | **P2** | 生视频编排优化：逐镜关键帧改「按需，默认不出」+ 参考组合「必须 ≥3 张」陷… |
| CV-192 | **已修复·待验收** | **P2** | 文生图提示词 skill 切换 Krea2 Turbo：新增 krea2-tu… |
| CV-189 | **已修复·待验收** | **P2** | image2image 参考槽位 3→4（后端切 Krea2 Edit 工作流… |
| CV-188 | **已修复·待验收** | **P1** | 视频侧「声明的分辨率 ≠ 真实产物」修复：落盘改用 ffmpeg 实测像素（不… |
| CV-187 | **已修复·待验收** | **P1** | 分辨率三档分级（480p / 768p / 2k）：删隐式升档 + 图片侧首次… |
| CV-186 | **已修复·待验收** | **P1** | 血缘压暗恢复：判据重做（距离三档）+ 生命周期改绑手势 |
| CV-185 | **已修复·待验收** | **P1** | 「整理布局」按视口整形（列宽按列自适应 + 行数上限开子列）+ 适配视野的可读… |
| CV-184 | **已修复·待验收** | **P1** | 新节点落点收口（单一实现 + 无血缘冲突检测）+ 生成后把新节点带进视野 |
| CV-183 | **已修复·待验收** | **P1** | 托盘拖动时里面的图片「消失」（松手又回来） |
| CV-182 | **已修复·待验收** | **P2** | 新建项目对话框精修 + 顺带查出的播放弹窗标题栏回归 + 首屏「跟正式画布和谐… |
| CV-181 | **已修复·待验收** | **P2** | 视觉升维收口 · E 区三解（删死样式 / 悬空分组回落 / 孤儿会话撤修） |
| CV-180 | **已修复·待验收** | **P1** | C3「真波形」其实一直是降级条：Host 侧 PCM 字节上限把可解码时长锁死… |
| CV-173 | **已修复·待验收** | **P2** | 视觉升维 DD-08 左侧栏（「工具面板 → 制作现场」第五批） |
| CV-163 | **已修复·待验收** | **P2** | 视觉升维 DD-04a 时间轴 + DD-05 叙事 + DD-06 首屏（「… |
| CV-160 | **已修复·待验收** | **P0** | 时间轴把「成片」当成片段：预计时长重复计入 + 成片递归叠加 |
| CV-152 | **已修复·待验收** | **P3** | 风格质检基准（Look Phase 4 / L4，编号沿用 [look-ass… |
| CV-151 | **已修复·待验收** | **P2** | 预设降级收口 + 预设自带 Look tokens（Look Phase 3… |
| CV-159 | **已修复·待验收** | **P1** | 样张重出不取代旧样张 |
| CV-158 | **已修复·待验收** | **P2** | 2b 命名重载消歧 |
| CV-157 | **已修复·待验收** | **P1** | Look 卡资产化（Look Phase 2 / L2） |
| CV-156 | **已修复·待验收** | **P1** | H3 IR 模式判定「双轨」冲突 |
| CV-154 | **已修复·待验收** | **P2** | 会话分析脚本值形态族漏报修复 |
| CV-147 | **已修复·待验收** | **P1** | 工具集收敛 26→22 + 生视频工具改显式 H3 端点描述 |
| CV-145 | **已撤回（误判）** | — | 带文件名入参的后端端点全部 500 → 复验实测全部可用（11 个端点 200） |
| CV-005 | 待处理 | P1 | 血缘连线只能加不能删 |
| CV-006 | **已修复·待验收** | **P1** | compose 无法排除片段、无 BGM 选择器 |
| CV-007 | **已修复·待验收** | **P1** | 时间轴语义混乱（非媒体混排、无总时长） |
| CV-021 | 待处理 | P2 | 删除被引用节点无提示，sourceIds 悬空 |
| CV-036 | **待拍板** | P1 | 项目无「已完成」标记 |
| CV-039 | 待处理（部分） | P1 | skill 的 H3 提示词规范是官方粗糙子集，声音设计能力未启用 |
| CV-040 | 待处理 | P1 | 多段成片音轨断裂 → Master Audio 全局基准装配 |
| CV-042 | 待处理 | P2 | 风格化画面文字能力未规划 |
| CV-043 | 待处理 | P2 | Ref2VA 音频参考与复用未利用（远期，依赖 039/040） |
| CV-046 | 已修复·待验收 | P1 | 注册表跨实例互踩（数据完整性） |
| CV-047 | 待处理 | P2 | 端口静默漂移无提示 |
| CV-048 | 待处理 | P2 | 缺「本机已有 DSH」官方指引（文档项） |
| CV-049 | 已完成·待验收 | P1 | ask_user_choice 自由输入是 opt-in，没传就没出口 → 反… |
| CV-050 | 已修复·待验收 | **P1** | 分镜重复提交堆积 |
| CV-051 | 已修复·待验收 | **P1** | 关键帧阶段无打回 |
| CV-052 | 已修复·待验收 | **P0** | 模式切换把状态误翻回 drafting |
| CV-053 | 待处理 | P2 | 审批条不醒目（无高亮 / 角标） |
| CV-054 | 待处理 | P1 | 无单版本回退（节点加 previous 字段存上一版） |
| CV-055 | 待处理 | P2 | 下游无过时标记（沿 sourceIds 反向 BFS 打 staleAt） |
| CV-056 | 已修复·待验收 | **P1** | 切模式解除等待后不唤醒 agent |
| CV-057 | 已修复·待验收 | **P1** | 视频播放浮层无进度条无控制按钮（只有点击切播放/暂停） |
| CV-058 | 已修复·待验收 | P2 | 上传图片无任何选项 |
| CV-059 | 已修复·待验收 | P2 | 工具栏改版：删设置按钮（拍板：设置入口 = app 左下角全局入口） |
| CV-060 | 已修复·待验收 | **P1** | 应用名迁移半途：标题栏 + productName 仍是「DSH Deskto… |
| CV-062 | 已完成·待验收 | **P1** | ask_user_choice 多选 + 交互改版 |
| CV-064 | **已修复·待验收** | **P1** | lobby 三态布局 |
| CV-065 | **已修复·待验收** | **P1** | 技能广场 UI |
| CV-066 | **已修复·待验收** | **P1** | skill 激活链路 |
| CV-067 | **已修复·待验收** | **P1** | 竖屏成片在画布被横屏框裁切 |
| CV-069 | 已修复·待验收 | P2 | 左栏底部用户信息区缺失（竞品对标）→ UserCard 组件 + popove… |
| CV-071 | 待修复（弹窗未显示 GIF 预览） | P2 | 技能卡悬停操作浮层 + 查看详情（竞品 DA-2）→ hover「使用 + 查… |
| CV-073 | 待修复（我的 Skill 视图缺陷） | P2 | 「我的 Skill」视角（竞品 DA-4）→ 侧栏视图 + × 卸载，复用 C… |
| CV-075 | 暂缓 | P3 | 作者署名/下载量（竞品 DA-6）→ 假下载量与「不伪造已生效」冲突，用户拍板… |
| CV-079 | 已修复·待验收 | P1 | 生成产物自动编组（竞品 DA-10）→ attachShotGroup 纯函数… |
| CV-080 | 已修复·待验收 | P1 | 生成节点命名精准化（竞品 DA-11）→ mediaNodeTitle 纯函数… |
| CV-081 | 已修复·待验收 | P2 | 文本节点选中可滚动（竞品 DA-12）→ 选中态 overflow-y:aut… |
| CV-082 | 已修复·待验收 | P2 | 视频 hover 自动播放（竞品 DA-13）→ 150ms 延迟 muted… |
| CV-083 | 已修复·待验收 | P2 | 视频时长角标（竞品 DA-14）→ loadedmetadata 现算 m:s… |
| CV-084 | 待处理（单独排期） | P2 | 制作计划阶段清单（竞品 DA-15）→ skill 产出 steps + ho… |
| CV-085 | 远期记录 | P3 | 视频 hover 快捷工具条（竞品 DA-16）→ 依赖成片编辑/素材库，待前… |
| CV-086 | 已修复·待验收（由 CV-091 实现） | P3 | 项目分组管理（竞品 DA-17）→ 用户拍板做，2026-09-03 由 CV… |
| CV-087 | 待处理 | P2 | 项目封面缩略图（竞品 DA-18）→ 落产物增量写注册表 |
| CV-088 | 已修复·待验收 | P3 | Lobby 个性化问候（竞品 DA-19）→ LobbyHero 增「你好，{… |
| CV-090 | 待处理 | P2 | 框选（marquee）交互改进 → ① 命中预览高亮 ② marquee 加… |
| CV-091 | 已修复·待验收 | P3 | 左侧栏用户自定义分组 + 折叠 |
| CV-092 | 已修复·待验收 | P3 | 新建项目改弹窗（竞品截图风格） |
| CV-095 | 已修复·待验收 | P1 | 新增图像侧两个提示词规范 skill |
| CV-096 | 已修复·待验收 | P2 | 品牌图标正式稿（V2 Aperture Squircle） |
| CV-101 | 已修复·待验收 | P2 | 东方异境视觉导演 skill 外挂试跑（第三方 MJ skill 接入验证） |
| CV-102 | 已修复·待验收 | P1 | 无 fork 附件旁路 + 上传标题唯一化 + 画布刷新白名单补漏 |
| CV-103 | 已修复·待验收 | P1 | C1 一致性资产锚点（自 WL 仓库收敛） |
| CV-111 | 已修复·待验收 | P1 | character_sheet 参考图失效自愈 |
| CV-120 | 已修复·待验收 | P2 | creative-mechanisms 按风格打通（机制库「沉睡」修复） |
| CV-121 | 已修复·待验收 | P1 | 总纲拆分 + 风格优先原则（B2，方案 Z + 优先级反转） |
| CV-122 | 已修复·待验收 | P1 | character_sheet 去 splitegrid 依赖：四视图拼图整图… |
| CV-126 | 拟立项·待拍板 | P2 | 音乐先行（Master Audio First）工作流 |
| CV-127 | 已修复·待验收 | P1 | 音乐提示词规范 skill + music_generation 工具增强（音… |
| CV-128 | 已修复·待验收 | P1 | 画布音频节点显示 + 就地播放（kind='audio' 独立成类，不再复用… |
| CV-129 | 已修复·待验收 | P1 | H3 官方音频通道按标准落地（audio reference / audio… |
| CV-130 | 已修复·待验收 | P1 | 画布音频体验四件套（生成后即时刷新 / 歌词上画布 / 可拖进度条 / 双击播… |
| CV-131 | 🚩 已立项·待启动 | P1 | 音视频统一时间轴 + BGM 时长对齐（音轨与视频合并路线） |
| CV-132 | 🚩 方案已定稿·待实施 | P1 | 视频生成模式选择：从「图片数量」改为「图片语义」驱动 |
| CV-133 | ✅ 已修复·待验收（CV-135 落地） | P0 | 生成请求的超时配置被 undici 300s 隐形上限架空（配置失效） |
| CV-134 | 🚩 已立项·待拍板 | P2 | 对齐后端 0.2.8「全能参考」扩容（image 6→9 / 新增 video… |
| CV-135 | 已修复·待验收 | P0 | 长请求传输层：把 Node 内置 fetch 的隐形 300s 上限抬到 90… |
| CV-136 | 已修复·待验收 | P2 | 视频画幅收敛为 16:9 / 9:16 两档（去掉 1:1） |
| CV-137 | 已修复·待验收 | P0 | 上传端点统一（uploadimage 已下线 404 → 切到 POST /a… |
| CV-116 | 已修复·待验收 | P1 | 风格映射四处漂移（11 vs 8）+ 未命中选项被整个吞掉 |
| CV-117 | 已修复·待验收 | P2 | catalog 一致性测试补反向断言 |
| CV-118 | 已修复·待验收 | P2 | hidden 拆生命周期语义 |
| CV-104 | 已修复·待验收 | P1 | C2 注入纪律（lockedPrompt 逐字节复用 + 资产卡覆盖） |
| CV-108 | 已修复·待验收 | P1 | 镜位版本链与失效标注（返工片段不再混入成片） |
| CV-107 | 已修复·待验收 | P1 | C5 合成统一（调色 pass + BGM 淡入淡出） |
| CV-106 | 已修复·待验收 | P1 | C4 质检闭环（逐镜 VLM 自检 + 预算熔断） |
| CV-105 | 已修复·待验收 | P1 | C3 尾帧链（同场景连续镜头的像素级衔接） |
| CV-093 | 已修复·待验收 | P3 | 技能广场隐藏前两个基础技能 |
| CV-175 | 进行中 | P2 | 视觉升维 DD-09 右栏（对话区）：a 守卫 + b 可收起 + c 会话头… |
| CV-203 | 已修复·待验收 | P2 | image_generate 移除 negativePrompt 参数（代码… |
| CV-207 | 待拍板 | P2 | write_script 原地更新改进（多版文案合法，原地覆盖会砸掉它，属 C… |
| CV-208 | 待拍板 | P2 | 用户上传参考图挂血缘 |
| CV-209 | 已修复·待验收 | P1 | H3 原生音轨成为多镜主声轨 |
| CV-210 | 已修复·待验收 | P2 | 质检全景表收敛 |
| CV-211 | 已修复·待验收 | P2 | 出图后 QC 链（image2vl 逐字复述 → image_fix） |
| CV-212 | 已修复·待验收 | P1 | 含文字 prompt 自动 image_fix 触发 |
| CV-213 | 已降级 | P2 | 硬字幕烧录暂不开放 |
| CV-214 | 已修复·待验收 | P2 | VLM 输出不可当事实警告 |

## 5. 已设计但零落地的模块

来源：[archive/optimization-plan.md](archive/optimization-plan.md)（1122 行完整方案）。**代码核实（2026-09-01）：`WorkflowController` / `VersionManager` / `ModelAdapter` / `WorkflowProgress` / `resumePoint` 在 `src/` 中零匹配，全部仅停留在设计稿。**（2026-09-30 勘误：`AssetLibrary` 已随 CV-255 全局资产库落地，从零匹配清单移除——见下表「素材库管理」行。）

| 模块 | 设计内容 | 与现有 CV 条目的关系 | 状态 |
| --- | --- | --- | --- |
| 五步串行工作流 | 创意→剧情→角色→分镜→视频→导出，支持暂停/恢复/单步重试 | **大部分已被更轻的实现覆盖**：审批闸、关键帧确认、重试（CV-018）、落点策略（CV-024）已落地；「暂停/恢复/中断点续跑」仍零落地 | 仅设计 |
| 双层版本控制 | 节点级 + 项目级版本，历史回溯 | 对应 **CV-054**（轻量单版本回退），未启动 | 仅设计 |
| 多模型适配层 | 12+ 模型配置、参数自动适配 | 当前后端统一 FL2VA，无切换。与产品定位冲突（我们不拼模型丰富度） | 仅设计 |
| 素材库管理 | 独立素材库、生命周期管理 | **已被超越**：REQ-001 全局资产库（角色/场景/物件/群像 + `@ref[lib:…]` 引用）CV-255 三步全部落地并桌面验收通过，覆盖并超出本方案设想 | ✅ 已落地（CV-255） |
| 实时状态反馈 | 进度条、实时状态、失败重试 | 部分落地：loading 耗时（CV-010）、toast（CV-015）、重试（CV-018）；百分比进度条未做 | 仅设计 |
| Phase 1-4 里程碑（8 周） | 基础框架 2 周 + 核心功能 3 周 + UI 2 周 + 测试 1 周 | 未启动，未排期 | 仅设计 |

**处理建议**：这份方案体量远大于当前节奏，且多处已被 CV 条目以更低成本覆盖。保留作远期参考，不进当前排期；其中「节点版本回退」抽出来并入 CV-054。

---

## 6. 历史 ID 映射

早期文档用了四套编号，查旧文档时用这张表对齐。

### O 系列（optimization-backlog）

| ID | 内容 | 现在的状态 |
| --- | --- | --- |
| O1 | 批准后自动代发「继续」 | ✅ 已完成（`client/index.ts` wakeAgent） |
| O2 | ask_user_choice 选项无高亮选中态 | 待处理（未进 CV 编号，方案见 optimization-backlog §一） |
| O3 | 右键菜单功能「似乎不可用」 | ✅ 已被 CV-037 覆盖并解决（根因：window mousedown 抢先卸载菜单） |
| O4 | 关键帧确认闸 | ✅ 已完成（方案 A，`keyframe_review` + `confirm_keyframes`） |
| O5 | DSH / 桌面包版本升级 | 独立排期（跨 ~90 依赖 + 多 patch rebase，建议单独 PR） |

### F 系列（acceptance-feedback）

| ID | 内容 | 状态 |
| --- | --- | --- |
| F1 | 导出成片未显示在画布 → 自动定位 | ✅ 已完成 |
| F2 | 详情面板增加分辨率信息 | ✅ 已完成（CV-013 补齐探测与回填） |
| F3 | 提示词按 H3 规范优化（BGM/对白/多语言） | ⚠️ 部分：基础规范在，声音/对白能力见 CV-039（待处理） |
| F4 | 整理布局按血缘分列 | ✅ 已完成 |
| F5 | 参考图交互重构（托盘 + 右键引用 + 光标插入） | ✅ 已完成 |
| F6 | 图层连线加粗 | ✅ 已完成（CV-032 补反向缩放补偿） |
| F7 / F8 | 2026-08-27 追加项 | ✅ 已完成 |

### R 系列（redo-flow-analysis，重做流程）

| ID | 内容 | 状态 |
| --- | --- | --- |
| R1 | 分镜打回意见输入框 | ✅ 已完成（2026-09-01，提交 `92a752d4b6`） |
| R2 | 节点版本化 / 版本历史 | ❌ 待排期 → 并入 **CV-054** |
| R3 | 下游 stale 级联标记 | ❌ 待排期 → 并入 **CV-055** |
| R4 | 替代标记（多版本择优） | ❌ 待排期，与决策点 D3（连线删除）合并设计 |

### 资料库别名系列（A-x/B-x/C-x/D-x/E-x 与 R-Px）

资料库 Bug/需求表的行别名 ↔ 权威号（BUG-00X / REQ-00X）全量对照，见 [tracking.md](./tracking.md) §三「别名映射总表」（2026-10-06 五账合并后唯一维护处）；查旧图证文件名（按别名命名）或资料库截图时用它。

---

## 7. 待拍板决策点

| ID | 问题 | 候选方案 | 状态 |
| --- | --- | --- | --- |
| **G1** | **AI 辅助开发结构治理要不要排期**（门禁接入 + 基线红机读 + 文档机读） | **A. 只做 P0 三件**：① 根 `typecheck`/`test`/`check` 与 CI 接入 canvas-studio、`check` 补 `test:smoke`；② 5 条基线红固化 `tests/baseline-red.json` + 失败集合比对（多一条红即红）并顺手修掉；③ 新增 `canvas-studio/AGENTS.md`（≤60 行入口）。**B. P0 + P1**：另加拆巨文件（`styles.ts` 9,675 行等）、STATUS 拆「状态表 + 变更流水」、`check-docs.mjs` 漂移脚本、消 `tsconfig.client.json` 手工 `include`、测试与 build 绑死。**C. 暂不排期**，评审文档留档 | **待拍板（只剩 B 部分）** —— ⚠️ **2026-10-12 AR-12 勘误**：原依据是本条决策时的快照，**其中 P0 三件已随 CV-276 落地，快照过期**，就地更正：① 根 `typecheck`/`test`/`check` **已含 canvas-studio**（`AGENTS.md:14`，CV-276 起）；② 本包自己的 `check` **已含 `test:smoke`**（`package.json:49`），且 `tests/baseline-red.json` 的 `failing` 已于 2026-10-01 **清零**（任何红都是真回归，门禁直接挡）；③ `canvas-studio/AGENTS.md` 已建（≤60 行入口）。**仍待拍的只有 B 部分**：拆巨文件、STATUS 拆表、`check-docs.mjs` 漂移脚本、消 `tsconfig.client.json` 手工 `include`、测试与 build 绑死。<br>依据文档：[ai-assisted-dev-structure-review.md](./ai-assisted-dev-structure-review.md)（原快照实测 `bd0ebfc07a`，其中「1,097 条守卫零闸门」「不 build 直跑 11 红」两条**已失效**；现行守卫规模见 `canvas-studio-architecture-review.md` §5.3） |
| D1 | 文本编辑放哪 | 方案 A：双击文本=内联编辑，媒体=详情 | 已拍板（2026-08-28） |
| D2 | 时间轴定位 | 延后，CV-006/007 不进当前批次 | 已拍板·延后 |
| D3 | 连线删除语义 | 并入「多版素材择优」工作流后实施 | 已拍板·延后 |
| **D4** | **分镜重新提交时旧卡怎么处理** | A. 按镜号复用覆盖 / B. 整套替换多余删掉 / C. 整套替换 + 存档到历史分组 | ✅ **已拍板 2026-09-01 → A**：按镜号匹配旧卡，复用 id 与位置只更新文案；多出来的旧卡**保留不动**（不静默删，避免下游 `shotRefs` 断链）。解锁 CV-050 |
| **D5** | **节点版本回退做到什么程度** | A. 单版本回退（`previous` 字段，轻） / B. revisions 数组 cap 5（重，契约升级） | ✅ **已拍板 2026-09-01 → A**：节点加单个 `previous?: {url, filename, generationPrompt}`，重做前压栈，详情面板给「撤销上次重做」。不做 revisions 数组。解锁 CV-054 |
| CV-036 | 项目「已完成」标记 | 方案 A 手动标记 + 成片信号辅助 / B 全自动（不推荐） | 待拍板 |
| **B1** | **内置 ffmpeg 的包体换法** | A. mac 维持 universal 单包（+42MB） / B. 改双架构 DMG（各 +18/+24MB，但 `mac-universal.ts` 与 verify-mac-smoke 一整套门禁要改） / C. 自编译精简 ffmpeg（远期） | ✅ **已拍板 2026-09-17 → A**：维持 universal 单包（CV-201 已按 A 落地）。**实测校正**：未压缩合计 **118 MiB**（arm64 43 MiB + x64 75 MiB），DMG 压缩后增量待全量构建实测；原「+42MB」是估算值 |
| **B2** | **随包 ffmpeg 的许可路线** | A. 先按现状 GPL 落地（快） / B. 换 LGPL 构建（BtbN `-lgpl` 变体或自编译；H.264 改走 `h264_videotoolbox`/`h264_mf`） | ⚠️ **2026-09-17 复核后必须重拍**：拍板 A 时的前提（「只是 GPL，履行义务即可」）**已被实测推翻**。产物 configure 行＝`--enable-gpl --enable-version3 --enable-nonfree --enable-libx264 --enable-libx265 …`；`--enable-nonfree` 触发 FFmpeg 随包 LICENSE 原文 *"This will cause the resulting binary to be unredistributable."* ⇒ **不可再分发**，不是法务「确认一下」而是硬阻断。**内测/自用不受限；对外发布前必须换 B** |
| **E1** | **`CS-FFMPEG-001`（内置 ffmpeg 缺失/被移除）要不要升 `user` 受众** | A. 维持 `['developer']`（现状，生产对用户完全隐藏，只进日志；用户只看到最终的「成片合成失败」） / B. 升 `['user','developer']` + `uiKind: 'config'`（用户看到「应用内置的 ffmpeg 组件缺失或被移除，请重新安装应用后重试」+ 三态卡走「打开设置」） | ✅ **已拍板：不升级，维持 `['developer']`（2026-09-23 用户决定）** —— 理由：内置 ffmpeg 已随包预装（CV-201），**不会再出现「视频处理组件不可用」这一类缺失故障** ⇒ 升受众没有实际收益，且连「点这个按钮该跳哪」那个问题也不必再回答。**原待拍板理由（留档）**：**曾倾向 B** —— K-7 验收档早就写好了面向终端用户的文案（且明确要求**不出现** `brew install` 这类开发者指引），说明这是用户**看得懂也唯一能自行处理**（重装）的一类故障；归 `developer` 后用户只会看到下游笼统的「成片合成失败」，**把可行动的信息藏掉了**。之所以没直接改：`CS-FFMPEG-001` 是 `S1`/`fatal`，升 `user` 会让错误卡在三态里走 `config` 档（弹「打开设置」），而**重装并不在设置页**。**取证快照**（2026-09-23 实测）：`lib/` 侧该条元数据为 `FFMPEG / S1 / developer / fatal / log`；`docx`/`docs` 两处无其它引用 |



---

## 8. 变更记录

> 📦 **2026-10 起的变更流水已整体迁出到 [`changelog.md`](./changelog.md)**（只追加，按日期 / CV 号 grep 查）。
> 更早（2026-09 及以前 172 条）：[`archive/changelog-2026-09.md`](./archive/changelog-2026-09.md)。
>
> **为什么迁出**：本文件是每次会话都要读的热文件；变更流水是低频历史。迁出前 §8 占全文 17%，
> 且 46 行里 39 行超 400 字节 —— 留在正文里只是让每次读取白烧 token。
