# 真实会话复盘：code-driven-explainer 智能手表讲解片（85 分钟零产出）

> **状态**：复盘完成（2026-10-23）。数据源：`session.v4.json`（351 事件，62 次工具调用，3 turns，20:18–21:43）。
> **任务**：用户点名 code-driven-explainer 制作 60s 智能手表介绍视频（左栏打字机文字 + 右栏手表同步展示）。
> **最终结果**：**没有成功渲染过任何草稿或成片**。唯一一次 `render_composition`（seq 265）超时，此后会话死于上下文耗尽。

---

## 0. 会话时间线（关键节点）

| 时间 | 事件 | seq |
|---|---|---|
| 20:18 | turn 1 开始，正确先加载 `canvas-studio-creation` 总纲再加载 `code-driven-explainer` | 17/22 |
| 20:31–20:48 | 写拍摄定稿（write_storyboard ×3）；用户插入「先出方案，不要来回抠细节」→ agent 给出方案 | 113–146 |
| 20:49 | turn 2：又加载 3 个 skill（krea2-turbo / voiceover / music-prompt） | 147–163 |
| 20:55 | image_generate 出表体图；agent 开始手写 PNG 解码器做像素定位 | 168–188 |
| 21:07 | 用户：「不需要精准控制，一个框里就行，后面我告诉你怎么调」 | 194 |
| 21:13–21:42 | **压缩（compaction）18 连败**（400 invalid llm request）；期间 agent 仍继续写脚本 | 219–335 |
| 21:39 | 用户贴截图「有点歪了，调整一下」→ agent 又回到像素量测路线 | 294–295 |
| 21:42 | turn 2 以 **max-tokens** 结束；最后输出仅 15 字符且是裸 `<｜DSML｜` 标记（退化） | 337–339 |
| 21:43 | turn 3「继续」存活 20 秒，再次 max-tokens。**会话实质死亡** | 341–349 |

上下文累计 ~860K 字符 ≈ **215K / 262K tokens**，从 21:13（~189K）起每次压缩都失败，无任何降级手段。

---

## 1. 问题清单（按严重程度）

### P0-1 压缩（compaction）100% 失败 → 会话死亡【✅ 已修复，CV-360】

- 18 次 compaction 全部返回 `400: {"code":"invalid_argument","message":"invalid llm request"}`（seq 220–344），provider 为 canvas-studio-gateway / deepseek-flash。
- 失败后**无降级策略**：不降请求体、不换摘要方式、不人工截断，只是间隔重试，18 次结果完全相同。
- 后果链：上下文只涨不缩 → 215K/262K → 模型输出被 max-tokens 截断 → 出现裸 DSML 特殊标记（生成已退化）→ turn 3 无法工作。
- **根因（已实测钉死，2026-10-23）**：compaction-basic 在 `cordis.patch.yml` 零配置挂载，摘要请求默认带 `max_completion_tokens: 65536`（=headroomTokens 默认值），超 DramaServer `/v1/llm` 32k 输出上限。实测对照：65536→400（与会话错误体逐字节一致）、32768→200、1024→200。普通对话从不带该字段 ⇒ 全部成功，形成全有全无模式。
- **修复（CV-360，全部落在可编辑区）**：① `dsh-plugin-desktop/cordis.patch.yml` compaction-basic 显式 `config.maxTokens: 32768`（根修）；② `canvas-studio/src/gateway.ts` 模型行补 `maxTokens: 32768`，压缩压力预留真实计入 32k。老安装重启即生效（`recoverGatewayFromCache` 走 deep-strict 比较自动重写网关行）。
- **遗留（纵深防御，另立项）**：① 压缩持续失败对用户可见的警示条；② `compaction/summary-error` 降级监听（N 连败后持久收缩选区重试）；③ DramaServer 侧 400 应返回字段名与上限值而非笼统 `invalid llm request`（服务端立项）。

### P0-2 上下文膨胀无节制（与升级方案 G4/B4 直接呼应——本会话是最好的实证）

- turn 1 单轮累计 544K 字符：2 个 skill 全文 + **大段 `cat` 整文件源码**（TextCard/ImageClip/timing/Shape/manifest/materialize/Transition/Root…），单条最大 21K chars。
- turn 2 再加载 3 个 skill 全文。5 次 skill 加载 + 分册读取是固定大头。
- **修法**：① skill 最小必读集（升级方案 B4 优先级应上调）；② bash 读源码改为带行号窗口/搜索式引用，整文件 cat 结果超阈值截断；③ 工具结果可做「老结果折叠」。

### P1-3 图像工具链缺失 → agent 手写 8 个 PNG 分析脚本【✅ 已修复，CV-362】

- `read_image` 对项目素材报错 `cannot read ... as an image`（seq 184）；系统 python3 无 PIL、无 ImageMagick/rsvg（seq 84 探测确认）。
- agent 用 `node:zlib` 手写 PNG 解码器后，接连产出 `decode/an/an2/an3/an4/shot/cmp/cmp2/colors` **8 个脚本**，每个都全文 `cat <<EOF` 进上下文（3–5K/次）+ 运行输出，既烧上下文又烧时间（21:07→21:32 约 25 分钟）。
- **修复（CV-362）**：新增宿主工具 `inspect_image`（`src/inspect-image.ts` 纯函数层，零外部依赖）：`mode:"profile"`（尺寸/位深/色彩类型）/ `bbox-dark`/`bbox-bright`（亮度阈值包围盒 → 画布百分比中心与宽高，与 render_composition 的 box 同口径）/ `colors`（量化主色 top-N）。PNG 解码覆盖 colorType 0/2/3/4/6、bitDepth 1/2/4/8/16、行滤波 0-4；JPG/WEBP/隔行显式报错。工具描述写明「唯一像素真值来源，禁止手写解码脚本」。配套：总纲加「先粗后精」迭代纪律（用户声明不需要精准后禁像素量测）、平台事实清单加「临时脚本写项目 `build/`，/tmp 会被清空」。登记：工具计数 25→26（tool-registry 钉死）、toolchain.md 绑定表、canvas-studio-tools.md §C2、docs/README.md、STATUS §3.4。

### P1-4 render_composition 超时 + manifest 被手工截断仍调用【✅ 已修复，CV-361】

- 唯一一次渲染超时（186 秒画布客户端未返回，命中已知 ~130–200s 区间）。
- agent 事后自认：「上次调用中截断了轨道」「manifest 被手工截断，还混入了多余的字段」（seq 271/278）——**入参过大被截断后没有校验就发出**，白白烧掉 3 分钟渲染窗口。
- **修复（CV-361）**：① `render_composition` 新增 `manifestPath` 参数（绝对路径，与 `manifest` 二选一，8MB 上限）——manifest 落盘传路径，彻底绕开入参体积问题；② 新增 `manifestTruncationError()`：`meta.durationInFrames` 必须 = 全部轨道最大结束帧，缩水即渲染前拒收并给修复指引（只放宿主入口，不共享进 `validateManifest`——客户端校正路径会合法缩短轨道）。同步 toolchain.md / canvas-studio-tools.md / code-driven-explainer manifest-contract。

### P2-5 沙箱 /tmp 清空导致返工

- `/tmp/wscan` 被沙箱清掉（seq 210），agent 重建到工作区 `build/`——浪费 2 轮。
- **修法**：skill 或总纲写明「临时脚本一律放项目内 build/ 目录，禁用 /tmp」。

### P2-6 执行策略违背用户明确指令（过程性，最伤体验）

- 用户 21:07 明确说「**不需要精准控制**，一个框里就行，快速出效果，明白了吗？」——agent 回复「明白，收到」（seq 195），但**之后仍花了 25 分钟做像素定位**（积分图精修、8 个脚本），直到用户催促才切到参数框方案（seq 250）。
- 用户 21:39 贴图「有点歪了，调整一下」，agent 的第一反应又是「用程序量出实际落点…反推修正」（seq 295）——再次违背「不要精准」的指令。
- **修法**：总纲加一条执行原则：「用户要求快速出效果时，先粗后精；用户已声明不需要精准后，禁止像素级测量类操作，偏差用可调参数 + 用户目测反馈闭环」。

### 正面发现（验证设计有效）

- **skill 路由正确**：第一个动作就是总纲 `canvas-studio-creation`，随后按环节加载 `code-driven-explainer` → `krea2-turbo/voiceover/music-prompt`，与总纲「入口分流」第 6 条（知识型图文短片，零视频模型调用）判定一致。
- **澄清克制**：全程仅 1 次 `ask_user_choice`（旁白选项），未骚扰用户。
- 用户「先出方案」后 agent 立即停止抠细节并产出 5 场 13 shot 定稿——该分支行为正确。

## 2. 与《Skill 系统编排能力升级方案》的关系

| 本会话问题 | 方案覆盖 | 动作 |
|---|---|---|
| P0-1 压缩失败 | **未覆盖**（harness/网关层问题） | 新立项，最高优先 |
| P0-2 上下文膨胀 | G4/B4 直接命中 | B4 优先级上调，本会话作为实证写进 B1 基线 |
| P1-3 图像工具缺失 | 未覆盖（工具层） | 新工具需求 `inspect_image`，走工具登记门禁 |
| P1-4 渲染入参过大 | 未覆盖 | render_composition 支持传路径 + 入参校验 |
| P2-6 执行策略 | 部分相关（总纲内容侧） | 总纲补「先粗后精」原则 |

## 3. 一句话结论

这次会话的失败**不是 skill 知识质量问题**（路由、澄清、定稿都做对了），而是**平台层三连击**：压缩机制完全失效 + 图像工具链缺失逼出 8 个手写脚本 + 渲染入参过大超时——三者共同把 215K 上下文烧穿，最终 85 分钟零产出。升级方案解决了「知识侧」，本复盘提出的 P0-1/P1-3/P1-4 属于「平台侧」，需要另立 CV。
