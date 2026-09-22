# Drama Backend API 文档

> ✅ **后端状态横幅（2026-09-10 复验，见 [api-probe/2026-09-10-file-endpoint-recheck.md](./api-probe/2026-09-10-file-endpoint-recheck.md)）**
> - **带文件名入参的端点全部可用**：`image2image` / `image2vl` / `image2character` / `image2styletransfer` / `image2ipastyletransfer` / `image2storyboard` / `image2inpaint` / `image2360hdri` / `image2splitegrid` / `image2videofl2va` / `image2videoref2va` 共 11 个端点，用真实尺寸参考图实测 **一律 200**。
>   早先「带文件名入参的端点全部 500」的结论（CV-145）**已撤回** —— 误判根因是当时探测用了 **1×1 像素的占位图**，后端读取该图即崩，与参考图链路无关。
>   ⚠️ 其中 **`image2styletransfer` / `image2storyboard` / `image2inpaint` / `image2splitegrid` 四个端点
>   自 2026-09-11 起已不接入**（对应工具删除），此处仅表示**后端侧可用**。
> - ⚠️ **参考图必须是有意义的真实尺寸图**。程序生成的最小占位图（1×1 / 极小字节）会让后端 500；这是素材问题，不是接口问题 —— 不要据此判定端点不可用。
> - **纯文本端点全通**，可正常用。
> - 🆕 **`image2fix`（Boogu 文字修复，2026-09-18 后端新增）**：契约已收录并接入（工具 `image_fix`，见「图像文字修复」节）——探针实测 200 / 68.5s，修复生效（SALLE→SALE），产物前缀 `boogu_*`；产物名不可直接入参（CV-155 纪律，直用 500 快失败 55ms 实测复证）。
> - 🆕 **`video2vl`（视频理解 / Qwen3-VL，2026-09-22 收录并接入）**：工具 `video2vl`，见「视觉语言模型」节。探针实测（[api-probe/video2vl-20260922](./api-probe/video2vl-20260922/report.md)）：**上传句柄 → 200 / 16.7s**、**产物名 → 0.1s 前置 500**（与 CV-155 两类 filename 纪律同型，工具侧已自带换名自愈）。
> - **后端单任务同步**：并发只排队不加速（A 9.4s / B 18.7s / 墙钟 18.7s）→ 调用一律串行。
> - **422 vs 500**：缺必填/类型错 = 422（字段名精确，可回显）；文件读取失败/生成中崩 = 500 **无原因**。
> - **响应 `duration` = 服务端生成耗时（秒），不是媒体时长**（逐条与 HTTP 耗时吻合）→ 视频真值必须用 ffprobe 探测。
> 复验命令：`node scripts/probe-file-endpoints.mjs --matrix image2image,image2vl`（严格串行）。

**版本:** 0.3.1  
**最近修订:** 2026-09-22（收录并接入后端 `video2vl` 视频理解端点：工具 `video2vl` 24→25 + 探针实测，CV-230；此前 2026-09-18 `image2fix` 23→24，CV-202）

> **修订说明（收录 `video2vl` 视频理解端点，2026-09-22，CV-230）**
> 后端新增 **`POST /api/v1/generate/video2vl`**（Qwen3-VL-4B-Instruct + `qwen3vl_video_analyze.json` 工作流），用于**视频理解**：视频内容分析、分镜拆解、镜头描述生成。本次收录契约并完成接入（工具 **`video2vl`**，24→25）：
> - **与 `image2vl` 同构**：入参只有 `system_prompt`（必填）/ `prompt`（必填）/ `video`（文件名，可空），响应 `{prompt_id, output, duration}`；`duration` 同样是**服务端耗时**（实测 16.66s ≈ HTTP 墙钟 16.7s），不是视频时长。
> - **文件名纪律同一套**（[api-probe/video2vl-20260922](./api-probe/video2vl-20260922/report.md)）：**上传句柄 → 200**（1.65MB 样片 16.7s，输出逐镜头描述）；**生成产物名 → 0.1s 前置 500**。工具侧因此自带「`@ref` 主动换名 + 500 后自愈重试一次」，与 `image2vl` 共用一份实现。
> - **超时取视频档**（`DRAMA_TIMEOUT_MS.video` = 600s，非文本档 180s）：耗时随片长增长，文本档对长片不够用。
> - **占用后端单任务槽位**：与生成类一样串行，工具描述已带 `DRAMA_SERIAL_HINT`。
> - **提示词不让模型自己写**：工具**缺省就是「分镜拆解」**——直接发出 `src/video-analysis.ts` 里的官方模板（角色设定 + 九项字段 + 「直接输出、不要注释」收口，后端同事按 Qwen3-VL 实测调优）；要别的问法用 `mode:'free'` 自己写 prompt。**模型照抄长模板必漂移**，所以模板只存在代码一处，由 `tests/video-analysis.test.mjs` 守住「发出去的就是它」。详见 [`canvas-studio-tools.md`](./canvas-studio-tools.md) §A12。

> **0.3.1 修订说明（收录 `image2fix` 文字修复端点，2026-09-18，CV-202）**
> 后端于 2026-09-18 新增 **`POST /api/v1/generate/image2fix`**（Boogu Image Edit，`boogu_image_edit.json` 工作流），定位为 **Krea2 生图后图内文字出错的专用修复通道**。本次收录其契约并完成接入（工具 `image_fix`，23→24）：
> - **用法纪律（后端同事交代）**：修复 prompt **只保留原出图 prompt 里「文字」那部分描述**（确切文本 + 字体/排版/位置锁定），场景/角色/画风描述一律不带 —— 这是改图接口，不是重新生成。
> - **产物名前缀 `boogu_*`**（2026-09-18 探针实测 [api-probe/image2fix-20260918](./api-probe/image2fix-20260918/report.md)；后端文档示例写作 `boogu_edit_*`，以实测为准）：属「产物名」类，**不可直接作下游入参**（探针复证：直用 500 快失败 55ms，CV-155 两类 filename 纪律同型），走 `@ref` 引用或 `upload_image` 换句柄。
> - **实测记录**：Krea2 产物名直用作入参同样 500 快失败（52ms）；带错字海报（SALLE）→ image2fix（只发文字段 prompt）→ 200 / **68.5s**（后端文档示例 4.55s 偏乐观，以实测为准）→ image2vl 读回标题 `SUMMER SALE 50% OFF`，**修复生效**。
> - **与其他改图端点的分工**：`image2image`（Krea2 Edit）= 通用改图 / 多参考融合；`image2inpaint` = 移除/添加元素（已不接入）；本端点 = **文字修复特化**（改几个字不必整图重画）。

> **0.3.0 修订说明（对齐后端 0.3.0 文档，2026-09-16）**
> 后端文档 `api.md` 于 2026-09-15 更新到 **0.3.0**。逐节对拍后本仓同步如下（编号 **CV-191**）：
> - **图像侧换模型（三处）**：`txt2image` 由 `nunchaku-z-image-turbo` 换 **Krea2 Turbo**（`krea2_workflow.json`，steps=8、**`cfg` 固定 1.0**、服务端随机种子；**`width`/`height` 会覆盖工作流默认尺寸**，产物名 `krea2_*.png`）；
>   `image2image` 由 `qwen_image_edit_3_image_ref` 换 **Krea2 Edit**（`krea2_edit.json`，steps=9、cfg=1.0）；`image2character` 由 `qwen_4view_char_2step` 换 **`krea2_quadview.json`**（steps=10、cfg=1.0，产物名 `krea2_char_4view_*.png`）。
>   ⚠️ **对调用方的影响只有「参考槽位数」**——尺寸/步骤/种子都是后端内部参数，我们不发 `steps` / `cfg` / `seed`。
> - **`image2image` 参考槽位 3 → 4**：后端具名槽位扩到 `image1`–`image4`（留空的 `image2`–`image4` 由后端自动从工作流排除，建议至少提供 `image1`）。**代码已于 CV-189 落地**（`generate.ts` 截断上限 4），本节此前写着「最多 3 张」属滞后，现已更正。
> - **`ref2va` 参考图上限 6 → 9（本仓代码同步修，CV-191）**：`drama.ts` 的 `maxReferences` 与 `sliceToMax` 上限由 6 抬到 **9**（与 fal 同值）。超 9 张时**保留首尾 + 中间均匀采样并回 warning**（与 fal 同一条规则，不静默丢弃）。
> - **`ref2va` 的 `aspect` 口径结案**：后端 0.3.0 明确「可选 `16:9` 或 `9:16`，默认 16:9」⇒ 本仓 0.2.8 记的「枚举含 `adaptive`/`4:3`/`21:9`、**没有 `9:16`**、待确认」**到此结案**——竖屏直传 `9:16` 与 `providers/drama.ts` 的 `dramaAspect` 行为一致，无需改动。
>   ⚠️ 但后端 0.3.0 **不再提「参考文件总数 ≤12」「输出 24fps」「参考音频合计 ≤15s」**三条——它们是否仍生效**未知**，本仓约束**不放宽**（音频侧仍按 H3 官方规格在发出前拦）。
> - **补 `txt2audio` 契约节**：`music_generation` 自 CV-125 起就是真实工具，但本文档一直没有对应端点节——本次补齐（含 `keyscale` / `language` 全量枚举与 `language=unknown` 出纯器乐的口径）。
> - **`resolution` 生效范围改写（与 CV-190a 同批）**：`drama` 供应商**不再是「固定 0.4 MP、传了也忽略」**——CV-190a 起按档发 `megapixels`（480p→0.4 / 768p→1.0 / 2k→2.0，与 `OUTPUT_SIZE` 同源）。
>   ⚠️ **未证实前提仍在**：后端是否真按 1.0 / 2.0 MP 出高分辨率尚未取得干净实测（历史 P0-d 探针自身有三处缺陷），若后端静默回退 0.4，则请求体对、产物仍是 864×480 ⇒ **对外描述档位时必须保留这层保留意见**。
> - **不接入的端点维持原状**（用户拍板 2026-09-16）：`image2ipastyletransfer`（IPA 风格迁移）、`image2360hdri`（360 HDRI）、`image2videomsr` / `image2videomkr` / `image2videomkrgrid` —— 后端 0.3.0 里都在，但本仓**不建工具、本文档不为它们单列节**，需要时再评估。
> - **`upload` 响应结构冲突已复验（本仓口径为准）**：后端 0.3.0 文档写 `{"success": true, "filename": "..."}`，而 2026-09-16 真机实测（health 夹心）返回的仍是 ComfyUI 原生结构
>   `{"name":"ref-03000001.png","subfolder":"","type":"input"}`（`200`）⇒ **后端文档示例有误，本仓 `{name, subfolder, type}` 的结论继续有效**（见 [文件上传](#文件上传唯一上传端点)）。

> **0.2.10 修订说明（工具收敛 + H3 端点明确，2026-09-11）**
> - **删除 4 个工具的接入**：`inpaint` / `style_transfer` / `storyboard_generate` / `storyboard_split`
>   已从 `createStudioTools` 注册表移除，`src/config.ts` 的 `DRAMA_ENDPOINTS` 同步删除
>   `inpaint` / `styleTransfer` / `storyboard` / `spliteGrid` 四项，`generate.ts` 的对应分支
>   与 `DISABLED_TOOLS` 守卫一并删除。**原因是产品决策，不是后端限制** ——
>   `image2inpaint`（200/31.2s）与 `image2styletransfer`（200/22.2s）实测均可用。
>   （`deduction` / `/generate/deduction` 更早已移除。）
> - 因此下面 **「风格迁移」「分镜生成」「图像分割网格」「图像修复」四节标记为「已不接入」**：
>   端点在后端仍然存在，本文保留其契约供参考，但 canvas-studio 不再有任何工具调用它们。
> - **视频端点描述明确为 H3**：`video_generate` / `video_composite` 的 Drama 路由统一写明为
>   **`image2videofl2va`**（纯文生 / 单首帧 / 首尾两帧）与 **`image2videoref2va`**（多参考 /
>   带参考音频），`capabilityOf` → `drama.ts` 的映射已写进工具 description 与工具文档。
> - 工具清单更新为 **22 个**（20 真实 + 2 占位）；`music_generation` 不再是占位（CV-125 起为真实工具）。
>   （CV-157 新增 `look_card` 后为 **23 个** = 21 真实 + 2 占位，见下文「工具清单与实现状态」。）

> **0.2.9 修订说明（上传链路统一，2026-09-10 实测）**
> - **上传端点收敛为一个**：后端路由表现在只有 `POST /api/v1/generate/upload`
>   （openapi.json 的 22 条路径里含 upload 的仅此一条）。旧的
>   `POST /api/v1/generate/uploadimage` **已下线**——对图片/视频/音频任何请求均返回
>   `404 {"detail":"Not Found"}`，`GET /` 与 openapi 里都不再出现。
> - **不限文件类型**：图片 / 视频 / 音频共用同一端点、同一字段（`file`）。
> - **响应结构与旧端点完全一致**（ComfyUI 原生 `{name, subfolder, type}`）→ 下游
>   消费方式不变，`name` 即「文件名参数」。
> - **标准流程**（所有「以文件名为入参」的接口都适用）：先上传拿 `name`，再把 `name`
>   填进参数（`image` / `image1..9` / `video1..3` / `audio1..3` …）。已端到端实证：
>   上传 → `image2vl` 的 `image`、上传 → `ref2va` 的 `image1`+`video1`+`audio1`。
> - **耗时随体积线性（≈9.6ms/KB ≈ 100KB/s），不存在 1MB 悬崖**——旧文档「>1MB 触发
>   Starlette 溢写导致耗时陡增」经实测**证伪**（详见下方实测表）。
> - 本仓已同步：`src/config.ts` 的端点常量由 `uploadimage` 换成 `upload`，
>   `uploadBytesToDrama` 的注释与错误文案同步更新（见 STATUS.md CV-137）。
> - ⚠️ **0.2.1 关于 `upload` 的结论已作废**（当时「任何调用方式均返回 500、端点已移出
>   文档」的判断，是后端当时的故障态；现它已是唯一上传入口）。

> **0.2.8 修订说明（后端侧接口更新，2026-09-10）**
> - **`image2videoref2va`（全能参考）能力扩容**：参考图由 ≤6 张扩到 **`image1`–`image9`**，
>   新增 **`video1`–`video3`（参考视频）** 与 **`audio1`–`audio3`（参考音频）**，
>   **单次请求参考文件总数 ≤12**（超出报错）。
> - **混合参考有明确分工**：`image1`–`image9` 是「参考什么」（锁定角色/场景/产品/风格），
>   **不决定首帧**；`video1`–`video3` 是「参考怎么动」（驱动动作、运镜、节奏，画面不可复用）；
>   `audio1`–`audio3` 是「参考听什么」（驱动节奏、情绪与音色，**只用于参考，不直接拼接成音轨**）。
> - **参考视频会同时提供画面与音轨作为约束** → 其自带音轨**同样计入音频的 ≤15s 预算**
>   （与 `audio-reference.ts` 记录的官方规则一致）。
> - **输出规格**：24fps（与实测一致）；`aspect` 枚举为 `adaptive` / `16:9` / `4:3` / `21:9`
>   —— 枚举里**没有 `9:16`**，但**竖屏直接传 `9:16` 已确认可用**（用户拍板，2026-09-10；
>   （0.3.0 已把口径明确为「可选 `16:9` 或 `9:16`」，本条疑虑**结案**）；
>   CV-136 起本仓视频**只发 16:9 / 9:16 两档**，不再有 1:1 降级一说）。
> - **响应 `duration` 字段语义存疑**：示例中请求 `duration=5` 而响应 `duration=8.50`，
>   与 txt2audio 的「该字段是生成耗时而非产物时长」同型 → **不可当作视频长度消费**，待实测。
> - 我们的发送端（`providers/drama.ts`）早已落 `audio1..audio3`，字段名与本次后端更新**完全一致**；
>   ~~当前唯一的落差点是图片上限仍按 6 张截断（见 STATUS.md CV-134）~~ —— **已修（CV-191）**：
>   `maxReferences` 与 `sliceToMax` 上限抬到 **9**，超限回 warning（不静默丢弃）。

> **0.2.8 修订说明（CV-187 分辨率三档）**
> - **`resolution` 从「4 档 + 隐式升档」改为「3 档直通」**：枚举收窄为 `480p` / `768p`（默认）/ `2k`，与 **H3 推荐分辨率表的 0.4 / 1.0 / 2.0 三行**一一对应，像素见 `config.ts` 的 `OUTPUT_SIZE`（唯一事实来源）。**`720p` / `1080p` 已删除**——它们在 H3 无对应档，旧行为是「就近升档 + 费用提示」，属**隐式**成本决策；旧枚举值不再出现在参数枚举里，但历史值仍能安全重放（就地归一，见下）。
> - **历史节点安全**：`resolution` 会随 `generationPromptOf` 落进画布节点，所以**真实历史节点里存着旧枚举**。`fal.ts` 新增 `normalizeResolution()` 就地归一（`720p`→`768p`、`1080p`→`2k`，与旧升档行为**等义**，故不再回 warning）；不认识的值返回 `undefined`（不传该字段），**不抛错**。
> - **图片侧首次获得档位**：`image_generate` 新增 `resolution` 参数，**与视频侧共用同一档位与同一张像素表**（图片端点收 width/height、视频端点收 megapixels，是两种风格，但**像素同源**）。
> - **默认档 = `768p`**（1376×768）：图片默认输出由 1280×720 变为 1376×768（720 本不是 32 的倍数）。设置页新增「默认分辨率」；原有「视频质量（待接入）」改名**「导出质量（待接入）」**以撇清语义（那是成片码率，不是生成分辨率）。
> - **生效范围**（~~**仅 `fal` 供应商按档生效**；`drama` 供应商暂不消费该档位（固定 0.4 MP ≈ 864×480），显式传入会回「暂未接入，已忽略」提示~~）：
>   **0.3.0 / CV-190a 起 `drama` 亦按档生效**——`providers/drama.ts` 改为按档发 `megapixels`（`MEGAPIXELS_BY_RESOLUTION`：480p→0.4 / 768p→1.0 / 2k→2.0），原先那条「已忽略」warning 已删。
>   ⚠️ **但仍有一条未验证前提**：后端是否真按 1.0 / 2.0 MP 输出高分辨率**尚未取得干净实测**（历史 P0-d 探针自带三处缺陷，既未证实也未证伪）；
>   若后端静默回退 0.4，则**请求体正确、产物仍是 864×480**。视频侧「声明 ≠ 真实」的问题**已由 CV-188 在落盘侧兜住**（落盘用 ffmpeg 实测像素 + 客户端不一致即纠正）。
> - **P0 实测**（`docs/api-probe/resolution-tier-1789462074585/`）：图片端点**逐字节按请求出图**（五个合规尺寸全部一致）；非 8 倍数的尺寸被**静默取整**（1400×780 → 1400×776），故「尺寸错了不会失败，只会悄悄给你另一个尺寸」；`480p` 出图 5.3 s vs `2k` 32.7 s（约 **6 倍**差距）。

> **0.2.7 修订说明**
> - **视频生成多供应商**：`video_generate` / `video_composite` 新增 `provider` 参数（枚举 `drama` / `fal`），用于选择后端链路。留空则走设置页「默认视频供应商」（默认 `drama`）；重试节点时自动沿用该片原供应商，不会串台。
> - `drama` 供应商即本文档既有的 Drama Backend（FL2VA）链路；`fal` 供应商为 MiniMax H3 队列（`minimax/h3/*`），其端点、参数映射与钳制规则见 [`docs/plans/video-provider-abstraction.md`](./plans/video-provider-abstraction.md)（本文档不重复描述 fal 端点）。
> - **`resolution` 占坑状态修正**（⚠️ 其中「升档」部分已被上文 **0.2.8** 取代；「仅 `fal` 生效」部分已被 **0.3.0 / CV-190a** 取代 —— drama 亦按档生效）：此前标记为「传了也忽略」的 `resolution`，在 `fal` 供应商下已生效（~~720p/1080p 会升档至 768P/2K 并提示费用更高~~）；~~仅 `drama` 供应商仍忽略~~。详见下方 [待接入参数](#待接入参数占坑已声明未生效)。
> - `model` / `generateAudio` 仍属占坑（仅 fal 真实消费 `resolution`，其余待后端支持）；**仍不应向用户提问「H3 还是 Seedance」**。

> **0.2.6 修订说明**
> - **skill 体系目录化重构**：`scripts/sync-minimax-skills.mjs` 改为把 9 个上游 skill 目录从 `minimax-h3` submodule **逐字节复制**到 `canvas-studio/skills/<name>/`（保留 h3 原生布局：SKILL.md 入口 + references/ 细则），不再生成 `src/skills/generated/minimax-skills.ts` 内联单体（已删除）。
> - **渐进披露**：`src/skills/minimax-skills.ts` 启动时扫描 `skills/` 注册英文精简入口，并设 `resourceBase: { kind: 'directory' }`——模型加载 skill 只拿精简正文，正文引用的 `references/<file>` 由其经 Host `read` 工具按需读取（fs 读取不受沙箱限制）。单次加载量从中文单体 ~30K 字符降到 ~8–11K。
> - **缺口顺带修复**：co-op-game-intro-generator 的 `references/h3-video-prompt-template.md`（STEP 6 视频回填模板）在旧中文单体方案下缺失，现已随目录同步可被模型读取。
> - 详见 [MiniMax-H3 上游 skill 注册与调用](#minimax-h3-上游-skill-注册与调用)。

> **0.2.5 修订说明**
> - **skill 工具引用缺口修复**（审计见 `src/skills/generated/minimax-skills.ts` 上游 9 skill 与注册工具对账）：
>   - `music-2.6`（minimalist-product-ad-generator 当作工具调用）→ 已声明为 `music_generation` 占位工具的别名，见 [占坑工具表](#占坑3个仅返回降级指引)。
>   - `h3-prompt-writing` 正文引用的 `references/base-en.txt` / `references/ref-en.txt` → 已由 `scripts/sync-minimax-skills.mjs` **内联进 skill content**（「Inline skill attachments」段），运行时无需文件系统访问；3d/co-op 的未引用 references 不内联（仅在同步日志提示）。
> - **视频生成占坑参数**：`video_generate` / `video_composite` 新增 `model`（h3/seedance2）、`resolution`（768p/1080p/720p/2k）、`generateAudio` 三个【占坑·待接入】参数——当前后端统一走 FL2VA（H3 技术路线），暂不支持模型切换/分辨率指定/原生音频；显式传入会在工具结果中返回「暂未接入」提示，不影响出片。依据：后端 `117.50.108.73:8082` 当日不可达（Connection refused，早前被打挂后未恢复），无法实跑探测 FL2VA 参数能力，故按「占坑 + 合理标记」处理。
> - `minimax-skills.ts` 顶部 "Pilot scope: 3d-animation-short-generator only" 注释已过时，改为实际注册全部 9 个上游 skill 的说明。

> **0.2.4 修订说明**
> - `style_transfer` 与 `inpaint` 两个工具标记为**暂不可用**：`createStudioTools` 仍注册这两个工具（避免上游 skill 流程因 "tool not found" 中断），但 `execute` 入口经 `guardDisabledTool` 统一抛「暂不可用」错误；`description` 与 creation-spec skill 均标注「【暂不可用】」。
> - 后端端点 `image2styletransfer` / `image2inpaint` 与 `generate.ts` 中的对应分支**全部保留**，恢复时只需把工具名移出 `DISABLED_TOOLS` 集合。

> **0.2.3 修订说明**
> - 新增 [canvas-studio 工具清单与实现状态](#canvas-studio-工具清单与实现状态) 一节：列出当前插件注册的全部 20 个工具，标注 17 个「完整实现」与 3 个「占坑」，并给出工具 → 后端端点的对应关系。

> **0.2.2 修订说明**
> - 移除 **`POST /api/v1/generate/image2videomsr` / `image2videomkr` / `image2videomkrgrid`**：canvas-studio 已收敛为仅 `image2videofl2va`（首尾帧）+ `image2videoref2va`（多参考）两个视频端点，上述三者未接入且后端稳定性存疑，移出可用清单。
> - 移除 **`POST /api/v1/generate/image2ipastyletransfer`** 与 **`POST /api/v1/generate/image2360hdri`**：canvas-studio 当前未暴露这两个端点的工具，移出可用清单（后端仍在，需要时再补工具）。
> - `POST /api/v1/generate/txt2image`（写实）与 `POST /api/v1/generate/txt2imageanime`（卡通/日式动漫）现明确为**生图的两套画风模式**，分别对应 canvas-studio 工具 `image_generate` 的 `style='realistic'`（默认）/ `'anime'`。
> - 依据：本项目 `canvas-studio/src/config.ts`、`src/generate.ts`、`src/host-tools.ts` 实际接入的工具与端点对照（2026-08-31 核查）。

> **0.2.1 修订说明（其中 upload 部分已被 0.2.9 推翻）**
> - `POST /api/v1/generate/uploadimage`：修正响应示例为实测结构（`{name, subfolder, type}`，非 `{success, filename}`）。
> - ~~`POST /api/v1/generate/upload`：端点已移出文档。实测任何调用方式均返回 500，成功响应从未出现。~~
>   —— **已作废（0.2.9）**：该 500 是端点当时的故障态；现在它已是**唯一**的上传入口，
>   而 `uploadimage` 反过来被下线了。

---

## 目录

- [canvas-studio 工具清单与实现状态](#canvas-studio-工具清单与实现状态)
- [MiniMax-H3 上游 skill 注册与调用](#minimax-h3-上游-skill-注册与调用)
- [根端点](#根端点)
- [健康检查](#健康检查)
- [图像生成](#图像生成)
- [提示词增强](#提示词增强)
- [角色生成](#角色生成)
- [风格迁移（已不接入）](#风格迁移)
- [文件上传（唯一上传端点）](#文件上传唯一上传端点)
- [图像查看](#图像查看)
- [分镜生成（已不接入）](#分镜生成)
- [图像分割网格（已不接入）](#图像分割网格)
- [图像修复（已不接入）](#图像修复)
- [图像文字修复（Boogu Edit）](#图像文字修复boogu-edit)
- [视觉语言模型](#视觉语言模型)
- [图像转视频](#图像转视频)
- [音频生成](#音频生成)
- [错误响应](#错误响应)

---

## canvas-studio 工具清单与实现状态

插件当前在 Host 侧注册 **25 个工具**：

- `canvas-studio/src/host-tools.ts` 的 `createStudioTools` → **23 个真实工具**（下表 A/B/C）
- `src/skills/placeholder-tools.ts` 的 `createPlaceholderTools` → **2 个占位工具**（不调后端，仅返回能力边界与替代路径）

> **2026-09-11 工具收敛**：`inpaint` / `style_transfer` / `storyboard_generate` / `storyboard_split`
> 已从注册表**删除**，连带后端端点与 `generate.ts` 分支代码一并移除；`deduction` 更早已移除。
> 本次收敛前为 24 个真实工具。详见 [`canvas-studio-tools.md`](./canvas-studio-tools.md) §2026-09-11 工具收敛。
>
> ⚠️ **计数勘误（2026-09-22）**：此前这里写「23 个工具 / 21 个真实」，实际少了 `image_fix`（CV-202
> 只补了正文节、没进本表）⇒ 本次一并补录 `image_fix` 与新增的 `video2vl`，A 类 10 → 12，
> 真实工具 21 → 23。以后加工具请同时改这三处：本节计数 / A B C 分节计数 / `canvas-studio-tools.md`。

### A. 后端生成 / 分析（12 个）

| 工具 | 用途 | 后端端点 / 实现位置 |
| --- | --- | --- |
| `image_generate` | 文生图 / 图生图（单参考 / 最多 4 张多参考融合，CV-189）；`style=realistic`（默认，写实）/ `anime`（卡通，仅纯文生图）双画风 | `txt2image`（写实文生）/ `image2image`（有参考图）/ `txt2imageanime`（卡通文生） |
| `image_fix` | 图内**文字**修复（改几个字不必整图重画；prompt 只写文字那部分） | `image2fix`（CV-202，见「图像文字修复」节） |
| `character_generate` | 角色设计图 → 角色立绘（不建资产卡） | `image2character` |
| `character_sheet` | 四视图立绘**拼图整图**作一致性资产卡唯一锚点（同名卡整体覆盖） | `image2character` |
| `image2vl` | 画面分析（视觉语言模型） | `image2vl` |
| `video2vl` | **视频理解**（Qwen3-VL）：按时间轴 / 逐镜头描述运镜、景别、节奏与主体动作（CV-230） | `video2vl` |
| `qc_shot` | 逐镜一致性质检（PASS/FAIL/WARN + 漂移项），结论写回画布节点 | `image2vl` |
| `prompt_enhance` | 提示词增强 | `image2promptenhance` |
| `upload_image` | 上传图片到 Drama Backend 拿 `filename` | `upload`（唯一上传端点，见 [文件上传](#post-apiv1generateupload唯一上传端点)） |
| `video_generate` | 文生视频 / 首帧图生视频（H3 路线） | **`image2videofl2va`**；带参考音频或参考视频改走 **`image2videoref2va`**；`provider=fal` 走 fal MiniMax H3（**fal 未接入参考视频，带 `videoRefs` 直接报错**） |
| `video_composite` | 多图合成视频（2 张首尾帧插值 / 1 张或 ≥3 张多参考） | **`image2videofl2va`**（2 张）/ **`image2videoref2va`**（1 或 ≥3 张、或带音频/参考视频）；`provider=fal` 走 fal MiniMax H3（同上） |
| `music_generation` | BGM 生成（ACE Step Audio），音频节点可作 `compose_video` 的 `bgmNodeId` | `txt2audio`（后端有偶发 500，工具自动重试 + 软提示降级） |

### B. 本地媒体处理（2 个，不调后端）

| 工具 | 用途 | 实现位置 |
| --- | --- | --- |
| `extract_last_frame` | 抽视频真实末帧，供 `shotTransition=chain` 链帧 | Host 本地 ffmpeg（`src/video-frames.ts`） |
| `compose_video` | 拼接时间轴已有视频片段成成片（可混 BGM / 挂文案 / 统一调色） | Host 本地 ffmpeg concat（`src/compose.ts`） |

### C. 画布 / 流程管控（9 个，不调后端）

| 工具 | 用途 | 实现位置 |
| --- | --- | --- |
| `list_shots` | 镜头清单（节点 id / 分镜卡 / 版本 / 状态 / 时长） | 本地项目注册表 |
| `list_references` | 参考托盘 + 一致性资产卡 + 画布文本节点 | 本地项目注册表 |
| `look_card` | **Look 卡**（CV-157）：5 项 tokens 冻结成 `role=style` 资产卡，逐镜逐字节注入 | 本地项目注册表 |
| `write_screenplay` | 剧本落画布「剧本」节点（重复调用原地更新） | 本地画布落盘 |
| `write_script` | 结构化文案落「文案」节点（供 `compose_video` 作 `scriptId`） | 本地画布落盘 |
| `ask_user_choice` | 点选式提问（需求澄清） | 本地交互阻塞 |
| `submit_screenplay_for_approval` | 剧本审批门禁 | 本地工作流状态机 |
| `submit_storyboard_for_approval` | 分镜表审批门禁（批准后视频工具才放行） | 本地工作流状态机 |
| `submit_keyframes_for_approval` | 关键帧确认门禁 | 本地工作流状态机 |

> 审批门禁的实际拦截名单是 `host-tools.ts` 的 `GATED_TOOLS`，当前仅
> `video_generate` / `video_composite` 两个成员。

### 占位工具（2 个，仅返回降级指引）

| 工具 | 用途 | 降级路径 |
| --- | --- | --- |
| `tts_voiceover` | 旁白 / 对白 TTS 配音 | 用 `write_script` 落「文案」节点（不生成音频）；H3 提示词用 `says in an off-screen voiceover` 处理离屏旁白 |
| `subtitle_burn` | 硬字幕烧录进画面 | 用 `write_script` 落「文案」节点（仅成片详情展示）；画面内文字写进 H3 提示词画面描述 |

> 占位工具存在的意义：让 agent 能完整跑完上游 MiniMax-H3 原版 skill 流程而不因「tool not found」中断；
> 每个占位工具都返回可操作的中文替代路径，**不调用任何 Drama Backend 端点**。
>
> ⚠️ BGM 生成**已不再是占位**：`music_generation` 自 CV-125 起为真实工具（`txt2audio`），
> 上游 skill 里出现的 `music-2.6` 即本工具。

### 视频生成参数现状（H3 技术路线）

`video_generate` / `video_composite` 的完整参数与端点路由见
[`canvas-studio-tools.md`](./canvas-studio-tools.md) §A8 / §A9。要点：

| 参数 | 取值 | 当前行为 |
| --- | --- | --- |
| `provider` | `drama`（默认）/ `fal` | **已生效**：选择视频后端链路。留空走设置页「默认视频供应商」；重试节点自动沿用原供应商。详见 [`docs/plans/video-provider-abstraction.md`](./plans/video-provider-abstraction.md) |
| `model` | `h3`（默认）/ `seedance2` | 占坑：传 `seedance2` 时工具结果附加「暂未接入」提示，仍按 h3 生成 |
| `resolution` | `480p` / `736p`（默认）/ `2k` | **CV-187 起三档直通**（16:9 基准像素 864×480 / 1280×736 / 1920×1088；竖屏反宽高、`1:1` 三档共用 1024×1024）。**CV-190a 起 `drama` 与 `fal` 均按档生效**（drama 侧按档发 `megapixels` 0.4 / 0.9 / 2.0）。留空走设置页「默认分辨率」。历史值 `720p` / `1080p` 就地归一为 `736p` / `2k`（等义映射，不回提示）。⚠️ 后端是否真按 0.9 / 2.0 MP 出高清**未证实**（若静默回退 0.4，产物仍是 864×480；真假由 CV-188 实测落盘兜住） |
| `generateAudio` | `true` / `false` | **已按 H3 官方标准透传（缺省不发送）**：传 `true` 请求随画同步的原生音轨，传 `false` 要求静音。被后端拒绝时由视频自愈摘字段并回 warning，不假装生效 |
| `audioRefs` | 文件名数组 | **已按 H3 官方标准透传**：有序、顺序即 `<Audio N>` 引用序；≤3 段、单段 2–15s、合计 ≤15s，不合规在发出前报错。带音频时一律走 `image2videoref2va`（r2v），与首尾帧语义互斥。⚠️ 音频**不能作唯一输入**（须同时有图或参考视频） |
| `videoRefs` | 文件名数组 | **2026-09-22 接入**（CV-226）：有序、顺序即 `<Video N>` 引用序；落到 Drama 的 `video1`–`video3`（openapi 实证）。官方规格 ≤3 段、单段 2–15s、**合计 ≤15s**、MP4/MOV、≤50MB/段，不合规在发出前报错。与音频**相反**：参考视频**可以作唯一输入**。⚠️ **必须传上传句柄**（`ref-*.mp4`）——生成产物名（`MiniMax_H3_ref2va_*.mp4`）实测被后端 0.1s 内 500 前置拒绝（与图片 CV-155 同型）。⚠️ fal 未接入该通道（字段名未经实测，明确报错而非静默丢弃） |
| — | 跨模态 | 图 + 视频 + 音频**合计 ≤12 个文件**（官方上限；单看每路都不超 9/3/3，合起来会超）→ `validateH3ReferenceBudget` |

> 设计意图：对应上游 3d-animation-short-generator 的「视频模型选项卡（H3/Seedance）」与「分辨率选项卡」、
> brand-promo-video-generator 的 `generate_audio=true`。**agent 不应向用户提问「H3 还是 Seedance」**（选项未生效），
> 应按默认执行；亦**不应主动向用户询问用哪个供应商**——除非用户明确要求切换，否则用设置页默认值。

> Drama 端点路由由 `src/providers/capability.ts` 的 `capabilityOf` 决定，`src/providers/drama.ts` 落成具体路径：
> 多参考 → `image2videoref2va`；首尾帧 / 单首帧 / 纯文生 → `image2videofl2va`。

---

## MiniMax-H3 上游 skill 注册与调用

插件在 Host 启动时注册 **10 个 skill**：9 个 MiniMax-H3 上游 skill（`h3-prompt-writing` + 8 个风格生成器）+ 1 个本插件总纲 `canvas-studio-creation`。全部采用 **h3 原生目录形态**（总纲由 `skills-local/canvas-studio-creation/` 在构建时合并进 `skills/`，机制与上游一致）：

```text
canvas-studio/skills/<name>/
├── SKILL.md          # 精简入口（英文原版，模型经 skill 工具加载的正文）
├── SKILL.cn.md       # 中文对照（人读，不注册）
├── references/       # 分环节细则，模型按需读取（如 shot-table-spec.md）
└── meta.yaml
```

- **内容来源（2026-09-17 整合）**：`skills/` 是**本仓唯一手写源**——手工维护、随 git 提交、原样随包发布（`package.json` 的 `files`）。早期由 `scripts/sync-minimax-skills.mjs` 从上游 submodule 逐字节同步 + `skills-local/` 覆盖合并而来；该脚本、`skills-local/` 目录与上游子模块**均已移除**。整合前已核验 `skills/` 逐字节包含原 `skills-local/` 全部 71 个文件，故零内容损失。规范见 [skill-expansion-spec.md](./skill-expansion-spec.md)。目录成员即注册范围。
- **注册**：`src/skills/minimax-skills.ts` 启动时扫描 `skills/` 逐个注册：`content` = SKILL.md 正文（剥离 frontmatter，description 取 frontmatter 并按 `DESCRIPTION_LIMIT` = 1024 字符截断），并设 `resourceBase: { kind: 'directory', path: skills/<name> }`。
- **调用接口（模型侧）**：`skill(name="<英文 kebab-case 原名>")`，如 `skill(name="3d-animation-short-generator")`；同一会话已加载的 skill 不重复调用。加载结果为 `<skill_content>` 块：`<skill_resources>` 提示模型「相对路径按 resourceBase 目录解析、按需加载」，`<skill_instructions>` 为精简正文。正文引用的 `references/<file>` 由模型经 Host `read` 工具读取（fs 读取不受沙箱限制，只有写入受限；打包态 `lib/**` 与 `skills/**` 均经 asarUnpack 落为物理路径）。
- **能力降级**：上游 skill 引用而本插件不具备的能力由占位工具承接（见 [占坑表](#占坑3-个仅返回降级指引)）；视频模型/分辨率选项卡为占坑参数（见 [待接入参数](#待接入参数占坑已声明未生效)）。
- **扩充新 skill**：遵循 [skill-expansion-spec.md](./skill-expansion-spec.md)（两条路径：上游 ENABLED 加名 / skills-local 自研 bundle，含目录格式与质量门）。

---

## 根端点

### GET /

获取服务基本信息

**响应示例:**
```json
{
  "message": "dramabackend"
}
```

---

## 健康检查

### GET /api/v1/health

服务健康检查端点

**响应示例:**
```json
{
  "status": "ok"
}
```

---

## 图像生成

### POST /api/v1/generate/txt2image

根据文本描述生成图像

**请求体 (Text2ImageRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 场景描述（从脚本内容派生） |
| `width` | integer | 否 | 1024 | 图像宽度 |
| `height` | integer | 否 | 768 | 图像高度 |

**请求示例:**
```json
{
  "prompt": "A beautiful sunset over the ocean",
  "width": 1024,
  "height": 768
}
```

**响应:** 返回生成的图像数据

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "krea2_00039_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=krea2_00039_.png",
    "duration": 3.63
}
```

**说明:**
- 使用 **Krea2 Turbo** 模型与 `krea2_workflow.json` 工作流生成图像（0.3.0 起；此前是 `nunchaku-z-image-turbo`）
- **`negative_prompt` 不生效**（CV-192 实测：cfg=1.0 时负向条件结构性失效，带负向「排除太阳」仍照常画出太阳；openapi `Text2ImageRequest` 也只有 prompt/width/height 三字段，多余字段被丢弃）——`image_generate` 工具**已移除 `negativePrompt` 参数**（不再向任何端点发送），约束一律写进正向提示词
- 工作流 `steps` 固定为 8、`cfg` 固定为 1.0，**种子由服务端随机**（本仓不发这三个参数）
- 请求的 `width` / `height` 会**覆盖工作流的默认生成尺寸**；尺寸不必是 8 的倍数——非 8 倍数会被后端**静默取整**（实测 `1400×780` → `1400×776`，不报错）
- 这是**写实模式**生图（canvas-studio 工具 `image_generate` 的 `style='realistic'`，默认）；卡通/日式动漫风格请改用 [POST /api/v1/generate/txt2imageanime](#post-apiv1generatetxt2imageanime)。

### POST /api/v1/generate/txt2imageanime

生成动漫风格图像

**请求体 (Text2ImageRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 场景描述（从脚本内容派生） |
| `width` | integer | 否 | 1024 | 图像宽度 |
| `height` | integer | 否 | 768 | 图像高度 |

**请求示例:**
```json
{
  "prompt": "An anime girl with long pink hair in a cherry blossom garden",
  "width": 1024,
  "height": 768
}
```

**响应:** 返回生成的动漫风格图像数据

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "anime_image_00001_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=anime_image_00001_.png",
    "duration": 4.20
}
```

**说明:**
- 使用 **Krea2 Turbo** 模型生成图像（2026-09-16 实测确认：后端文档仍写 z-anime-aio，但模型已随 0.3.0 切换，仅靠提示词表达动漫画风；产物名前缀仍沿用工作流里的 `Z-Anime_*`）
- `steps` 固定 8、`cfg` 固定 1.0，与写实 `txt2image` 同模型同规则（含 **negative_prompt 不生效**：工具已不再发送该字段，约束写进正向提示词，见上节）
- 适用于生成日式动漫风格的角色和场景
- 这是**卡通 / 日式动漫模式**生图（canvas-studio 工具 `image_generate` 的 `style='anime'`）；**仅支持纯文生图**，无对应的图生图变体（要参考已有图做动漫风时改回写实模式）。

### POST /api/v1/generate/image2image

基于参考图像生成或编辑图像（Krea2 Edit；最多 4 张参考图）

**请求体 (Image2ImageRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 场景描述（从脚本内容派生） |
| `width` | integer | 否 | 1024 | 图像宽度 |
| `height` | integer | 否 | 768 | 图像高度 |
| `image1` | string | 否 | "" | 参考图像1（文件名） |
| `image2` | string | 否 | "" | 参考图像2（文件名） |
| `image3` | string | 否 | "" | 参考图像3（文件名） |
| `image4` | string | 否 | "" | 参考图像4（文件名，0.3.0 新增槽位） |

**请求示例:**
```json
{
  "prompt": "Transform this landscape to autumn style",
  "width": 1024,
  "height": 768,
  "image1": "scene.png",
  "image2": "character.png",
  "image3": "prop.png",
  "image4": "style.png"
}
```

**响应:** 返回生成的图像数据

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "ComfyUI_00039_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=ComfyUI_00039_.png",
    "duration": 3.63
}
```

**说明:**
- 使用 **Krea2 Edit**（`krea2_edit.json`，0.3.0 起；此前是 `qwen_image_edit_3_image_ref`）
- 工作流 `steps` 固定为 9、`cfg` 固定为 1.0，种子由服务端随机（本仓不发这三个参数）
- **支持最多 4 张参考图像（`image1`–`image4`）**；`image2` / `image3` / `image4` 留空时由后端自动从工作流中排除，**建议至少提供 `image1`**
- canvas-studio 侧对应 `image_generate` 的图生图分支，截断上限同为 4（CV-189）；超限会在结果 `warnings` 里点名被忽略的文件，不静默丢弃

---

## 提示词增强

### POST /api/v1/generate/image2promptenhance

提示词增强（根据输入提示词生成更丰富的提示词）

**请求体 (Image2PromptEnhanceRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 原始提示词 |

**请求示例:**
```json
{
  "prompt": "a beautiful landscape"
}
```

**响应:** 返回增强后的提示词

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "output": "A stunningly beautiful landscape with rolling green hills, majestic mountains in the distance, vibrant wildflowers blooming in the foreground, a serene lake reflecting the golden sunset sky, fluffy white clouds drifting lazily overhead, and a gentle breeze rustling through the tall grass, creating a peaceful and idyllic scene.",
    "duration": 1.23
}
```

**说明:**
- 该端点使用AI模型对输入提示词进行扩展和增强
- 生成更详细、更具描述性的提示词
- 适用于提升图像生成质量

### POST /api/v1/generate/image2character

基于角色设计图生成角色立绘图（四视图）

**请求体 (Image2CharacterRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `image` | string | 否 | "" | 角色设计图（文件名） |

**请求示例:**
```json
{
  "image": "character_design.png"
}
```

**响应:** 返回生成的角色立绘图

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "krea2_char_4view_00001_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=krea2_char_4view_00001_.png",
    "duration": 3.63
}
```

**说明:** 
- 该接口根据输入的角色设计图生成**四视图**立绘图，0.3.0 起使用 **`krea2_quadview.json` 工作流**（此前是 `qwen_4view_char_2step`）
- 四视图 = **正面特写、正面全身、侧面全身、背面全身**
- 工作流默认 `steps=10`、`cfg=1.0`，种子由服务端随机（本仓不发这三个参数）
- 背景为纯白色
- canvas-studio 侧两个工具共用本端点：`character_generate`（单张立绘，不建资产卡）与 `character_sheet`（四视图拼图**整图**作一致性资产卡的唯一锚点，CV-122）

---

## 风格迁移

> ⚠️ **已不接入（2026-09-11）**：`style_transfer` 工具已删除，canvas-studio 不再有工具调用本端点。
> 端点在后端仍然存在且实测可用（200 / 22.2s），以下契约仅供需要时参考。

### POST /api/v1/generate/image2styletransfer

基于参考图像进行风格迁移

**请求体 (Image2StyleTransferRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `image1` | string | 否 | "" | 目标图像（需要进行风格迁移的图像） |
| `image2` | string | 否 | "" | 参考图像（提供风格参考的图像） |
| `prompt` | string | 否 | "" | 增强提示词 |
| `enhance` | boolean | 否 | false | 是否增强风格迁移效果 |

**请求示例:**
```json
{
  "image1": "target_image.png",
  "image2": "style_reference.png",
  "prompt": "Make it more vibrant",
  "enhance": true
}
```

**响应:** 返回风格迁移后的图像

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "styletransfer_00001_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=styletransfer_00001_.png",
    "duration": 4.55
}
```

**说明:**
- 该端点将 image2 的风格迁移到 image1 上，使用 Klein Transfer Style 工作流
- image1 是目标图像，image2 是风格参考图像
- `prompt` 和 `enhance` 参数可进一步增强风格迁移效果
- 适用于将一幅图像的风格应用到另一幅图像上

---

## 文件上传（唯一上传端点）

### POST /api/v1/generate/upload

把本地文件（图片 / 视频 / 音频）上传到 Drama Backend，拿到**服务器文件名**。

> **这是所有「以文件名为入参」的接口的标准前置步骤。** 生成接口不读本地路径、也不接受同源资产 URL：
> 必须先把文件传到这个端点，再用响应里的 `name` 去填参数。
>
> ```
> 本地文件 ──POST /api/v1/generate/upload（form-data: file）──▶ { "name": "xxx.png" }
>                                                                    │
> 把 name 填入下游参数 ◀──────────────────────────────────────────────┘
>   image2image.image / image2vl.image
>   image2videofl2va.image1 | image2
>   image2videoref2va.image1..image9 / video1..video3 / audio1..audio3
> ```

**请求体:**
采用 form-data 形式（**不要手工填 Content-Type**——写死会丢掉 boundary，后端解析失败）

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `file` | binary | 是 | 要上传的文件（图片、视频、音频均可） |

openapi 里该字段 `required: true`；字段名写错会得到
`422 {"detail":[{"type":"missing","loc":["body","file"],"msg":"Field required"}]}`。

**响应示例（实测）:**
```json
{
  "name": "tiny.png",
  "subfolder": "",
  "type": "input"
}
```

**响应字段:**

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | **服务端保存的文件名**——下游接口所需的文件名参数就取这个值 |
| `subfolder` | string | 子目录，实测恒为空串 |
| `type` | string | 固定为 `input` |

> ⚠️ 这是 ComfyUI `UploadImage` 节点的原生返回结构，**没有** `success` 字段，文件名键名是 `name` 而不是 `filename`。
> 按旧文档写 `resp.filename` 会拿到 `undefined`。
>
> **2026-09-16 复验（后端 0.3.0 之后）**：后端 0.3.0 文档把响应示例写成
> `{"success": true, "filename": "uploaded_file.png"}`，与本仓实测不符 ⇒ 真机再跑一次
> （`GET /api/v1/health` 夹心，前后各一次均 `200`）：
>
> ```text
> [health/pre] 200 {"status":"ok"}
> [upload ref-03000001.png] 200 {"name":"ref-03000001.png","subfolder":"","type":"input"}
> [health/post] 200 {"status":"ok"}
> ```
>
> ⇒ **`{name, subfolder, type}` 仍是实际响应，后端文档的示例有误**（文档写错，不是接口变了）。
> 本仓 `generate.ts` 的 `uploadBytesToDrama` 解析为 `data.name ?? data.filename ?? data.data.*`，
> 两种形态都能吃下，故即便后端将来真的改成 `{success, filename}` 也不会破线。

**实测记录（2026-09-10，`117.50.108.73:8082`，返回结构三种文件类型一致）:**

| 用例 | 体积 | 结果 |
|------|------|------|
| 图片 tiny.png | 190B | `200` · 194ms · `{"name":"tiny.png","subfolder":"","type":"input"}` |
| 视频 tiny.mp4 | 7KB | `200` · 62ms |
| 音频 tiny.mp3 | 8.5KB | `200` · 63ms |
| 音频 long.mp3（10s） | 80KB | `200` · 135ms |
| 图片 big.png | 1.21MB | `200` · 12.1s · `{"name":"big (1).png",...}` ⚠️ 重名被加后缀 |

**耗时随体积线性，不存在 1MB 悬崖:**

| 体积 | 耗时 | 归一化 |
|------|------|--------|
| 105KB | 0.21s | ≈2.0ms/KB |
| 293KB | 2.85s | ≈9.7ms/KB |
| 577KB | 5.48s | ≈9.5ms/KB |
| 872KB | 8.35s | ≈9.6ms/KB |
| 1.21MB | 12.1s | ≈10ms/KB |

→ 有效上行吞吐 ≈ **100KB/s**，全程近似线性。旧文档「超过 1MB 触发 Starlette 溢写磁盘、耗时陡增」
**已证伪**：当年的「1.6MB ≈ 14s」正是 `1.6MB ÷ 100KB/s` 的传输时间，与 1MB 阈值无关。
**结论没变甚至更强**：上传前压缩是必要的（3MB 手机照片 ≈ 30s）。

**文件名安全约定（重要）:**
- 后端**按文件名去重**：重名会加 ` (1)` 后缀（见上表 `big (1).png`）。
- 带空格/括号的名字会让下游接口 **500**（历史已踩此坑）。
- 所以调用方必须自己生成「唯一 + 只含 `[A-Za-z0-9._-]`」的文件名——本仓统一用
  `ref-<8位uuid>.<ext>`（`src/generate.ts` 的 `uploadBytesToDrama`，有契约测试兜底）。

**错误形态:**

| 情形 | 响应 |
|------|------|
| 字段名不是 `file` | `422` `{"detail":[{"type":"missing","loc":["body","file"],...}]}` |
| 后端未注册该端点（旧版本后端） | `404 {"detail":"Not Found"}` |

**下游句柄可用性（已端到端实证）:**
- 上传 `tiny.png` → `image2vl` 的 `image` 参数 → `200`，模型如实描述出「纯红色背景图片」
  （**证明后端真的读到了上传的字节**，而不是静默忽略未知文件名）。
- 上传 `tiny.png` / `tiny.mp4` / `tiny.mp3` → `image2videoref2va` 的 `image1` / `video1` / `audio1`
  → `200`，产出 `MiniMax_H3_00290_.mp4`（耗时 127.1s）→ **三类文件的句柄全部被消费**。
- 反向对照：填一个不存在的文件名 → `500 Internal Server Error`（后端对「名字在、文件不在」
  一律报笼统 500）。

---

## 已下线的上传端点（历史）

### ~~POST /api/v1/generate/uploadimage~~ ❌ 已下线（404）

> **2026-09-10 起。** 后端路由表已不再注册该路径，`openapi.json` 的路径清单里也没有它。
> 实测对图片 / 视频 / 音频任何文件均返回 `404 {"detail":"Not Found"}`。
>
> 它曾是我们唯一的上传入口（响应同样是 `{name, subfolder, type}`），
> 现在请一律使用上面的 `/api/v1/generate/upload`。**不要再改回去。**
>
> 📌 对照：该端点 2026-08-31 曾被记为「`upload` 不可用（任何请求形态均 500）、统一走 `uploadimage`」；
> 2026-09-10 两者地位**完全反转**——同一次后端修复的两面。

**/view 回读的坑（附）:**
`GET /view?filename=<name>` **只对生成产物有效**（实测 `200`，返回产物字节）；
对**上传的文件**回读是 `500`。因此：

- 不要用 `/view` 校验「上传是否真的落库」——用 `image2vl` 这类真实消费方来验。
- 响应里的 `full_url` 形如 `http://<host>/view?filename=...`，是**产物**地址，可用于下载/展示。

> ⚠️ 后端若再次改动上传端点，必须同步确认三件事：入参契约、响应里的文件名键名、
> 以及下游如何消费这个名字（本仓的兜底见 `tests/upload-endpoint.test.mjs`）。

---

## 图像查看

### GET /view

从 ComfyUI 服务器获取图像

**查询参数:**

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `filename` | string | 是 | 要获取的图像文件名 |

**响应:** 返回图像二进制数据 (image/png)

---

## 分镜生成

> ⚠️ **已不接入（2026-09-11）**：`storyboard_generate` 工具已删除，canvas-studio 不再有工具调用本端点。
> 分镜改为由 `submit_storyboard_for_approval` 把分镜表文本逐镜拆卡落画布，不再生成格子分镜图。

### POST /api/v1/generate/image2storyboard

根据文本描述生成分镜图像（格子分镜）

**请求体 (Image2StoryboardRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 场景描述（每行描述一个分镜场景） |
| `gridnum` | integer | 否 | 4 | 分镜格子数量 |
| `width` | integer | 否 | 1024 | 分镜图像每个item宽度 |
| `image` | string | 否 | "" | 参考图像（文件名） |

**请求示例:**
```json
{
  "prompt": "Character enters the forest\nCharacter finds a treasure\nCharacter leaves with treasure",
  "gridnum": 4,
  "width": 1024,
  "image": "reference.png"
}
```

**响应:** 返回生成的分镜图像数据

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "storyboard_00001_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=storyboard_00001_.png",
    "duration": 5.23
}
```

**说明:**
- 使用 qwenedit_gridstoryboard 工作流生成分镜图像
- `prompt` 每行描述一个分镜场景

## 图像分割网格

> ⚠️ **已不接入（2026-09-11）**：`storyboard_split` 工具已删除，canvas-studio 不再有工具调用本端点。
> 角色四视图也不再切分——`character_sheet` 直接以拼图整图作资产卡唯一锚点（CV-122）。

### POST /api/v1/generate/image2splitegrid

将图像分割成网格布局

**请求体 (Image2SpliteGridRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `row` | integer | 否 | 2 | 网格行数 |
| `column` | integer | 否 | 2 | 网格列数 |
| `target_width` | integer | 否 | 1024 | 目标图像宽度 |
| `target_height` | integer | 否 | 768 | 目标图像高度 |
| `image` | string | 否 | "" | 要分割的图像（文件名） |

**请求示例:**
```json
{
  "row": 2,
  "column": 2,
  "target_width": 1024,
  "target_height": 768,
  "image": "input_image.png"
}
```

**响应:** 返回分割后的网格图像

**响应示例:**
```json
{
    "prompt_id": "c9c1236f-fff7-4083-b405-cb422ee285d9",
    "images": [
        {
            "filename": "splitegrid_img_1716656698_00001_.png",
            "url": "http://117.50.108.73:8082/view?filename=splitegrid_img_1716656698_00001_.png"
        },
        {
            "filename": "splitegrid_img_1716656698_00002_.png",
            "url": "http://117.50.108.73:8082/view?filename=splitegrid_img_1716656698_00002_.png"
        },
        {
            "filename": "splitegrid_img_1716656698_00003_.png",
            "url": "http://117.50.108.73:8082/view?filename=splitegrid_img_1716656698_00003_.png"
        },
        {
            "filename": "splitegrid_img_1716656698_00004_.png",
            "url": "http://117.50.108.73:8082/view?filename=splitegrid_img_1716656698_00004_.png"
        }
    ],
    "total_count": 4,
    "duration": 1.03
}
```

**说明:**
- 该端点将输入图像按照指定的行列数分割成网格
- 适用于将大图分割成小图、或创建拼图效果
- 支持任意行列组合（如 2x2, 3x3, 2x3 等）

---

## 图像修复

> ⚠️ **已不接入（2026-09-11）**：`inpaint` 工具已删除，canvas-studio 不再有工具调用本端点。
> 端点在后端仍然存在且实测可用（200 / 31.2s）；局部改写需求改走 `image_generate` 传参考图 + 保留子句。

### POST /api/v1/generate/image2inpaint

对图像进行修复或编辑（Inpainting）

**请求体 (Image2InpaintRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 图像修复描述（描述需要修复或添加的内容） |
| `image` | string | 否 | "" | 要修复的图像（文件名） |

**请求示例:**
```json
{
  "prompt": "Remove the person and fill with forest background",
  "image": "input_image.png"
}
```

**响应:** 返回修复后的图像

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "inpaint_00001_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=inpaint_00001_.png",
    "duration": 4.55
}
```

**说明:**
- 该端点使用 Inpainting 技术对图像进行修复或编辑，基于 qwen_edit_inpainting 工作流
- 可以移除图像中的不需要元素并智能填充背景
- 可以根据提示词添加新元素到图像中

---

## 图像文字修复（Boogu Edit）

> 🆕 **2026-09-18 后端新增端点**（后端同事提供契约与用法，CV-202 收录并接入 —— canvas-studio 工具 **`image_fix`**）。
>
> **定位**：用 Krea2 生成图后，如果图里有**错误的文字**，走本接口修复文本。修复 prompt 从原出图 prompt 里**只提取「文字」那部分描述**（确切文本 + 字体/排版/位置锁定），其余画面描述一律不要 —— 这是改图接口，不是重新生成。修复后的产物文件名以 **`boogu` 前缀**开头。

### POST /api/v1/generate/image2fix

基于提示词对输入图像进行修复或编辑（Boogu Image Edit）

**请求体 (Image2FixRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 图像修复或编辑指令（**使用纪律：只写文字部分**，见节首说明） |
| `image` | string | 否 | "" | 要修复或编辑的图像（文件名） |

**请求示例:**
```json
{
  "prompt": "修复画面中的文字，保持原有版式和设计不变",
  "image": "input_image.png"
}
```

**响应:** 返回修复或编辑后的图像

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "boogu_00009_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=boogu_00009_.png",
    "duration": 68.46
}
```
> 示例取自 2026-09-18 探针实测（[api-probe/image2fix-20260918](./api-probe/image2fix-20260918/report.md)）；后端文档示例写作 `boogu_edit_00001_.png` / `duration: 4.55`，**前缀与耗时均以实测为准**（`boogu_*` / 实测 68.5s）。

**说明:**
- 该端点使用 Boogu Edit 模型和 `boogu_image_edit.json` 工作流，根据提示词修复或编辑输入图像
- `image` 应传入通过文件上传接口获得的图像文件名
- 服务端自动使用随机种子
- 适用于文字修复、画面内容调整和指令式图像编辑

**canvas-studio 侧备注:**
- **与其他改图端点的分工**：`image2image`（Krea2 Edit）= 通用改图 / 多参考融合重画；`image2inpaint` = 移除/添加元素（已不接入）；本端点 = **文字修复特化** —— 图内文字出错时的首选通道，改几个字不必整图重画。
- **修复 prompt 纪律**：只写文字段（要修的文字内容 + 字体/排版/位置锁定），不带场景/角色/画风描述 —— 后端同事明确「只要文字那部分，其他都不要」；多余描述属于改图接口的过度指令，可能伤及画面。
- **产物名 `boogu_*.png` 属「产物名」类**：不可直接作下游入参（CV-155 两类 filename 纪律；探针实测直用 `image2vl` 500 快失败 55ms），走 `@ref` 引用或 `upload_image` 换句柄；`_<4位数字>_` 形态已被 `isDramaProductName` 识别，自愈路径覆盖。
- **实测记录（2026-09-18 探针）**：生成带错字海报（标题 SALLE）→ `upload` 换句柄 → `image2fix`（prompt 只含文字段）→ **200 / 68.5s** → `image2vl` 读回标题 `SUMMER SALE 50% OFF` —— 修复生效。Krea2 产物名直用作入参同样 500 快失败（52ms），CV-155 纪律对本端点同型成立。

---

## 视觉语言模型

### POST /api/v1/generate/image2vl

基于图像和文本提示进行视觉语言模型推理

**请求体 (Image2VLRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `system_prompt` | string | 是 | - | 系统提示词 |
| `prompt` | string | 是 | - | 用户提示词 |
| `image` | string | 否 | "" | 参考图像（文件名） |

**请求示例:**
```json
{
  "system_prompt": "You are a helpful assistant.",
  "prompt": "Describe this image in detail",
  "image": "input_image.png"
}
```

**响应:** 返回模型生成的文本结果

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "output": "镜头从低角仰视缓缓抬升至中景，男子静坐石阶，烛光在衣褶投下流动阴影；手持微颤，眼神凝望远方，似有心事未诉。暖黄光线勾勒轮廓，木窗格虚化成背景呼吸脉动。\n\n镜头横向平滑右移，聚焦其左手轻抚袖口细节，布料纹理清晰可见；耳后簪子反射烛火余晖，眉宇间紧锁一丝沉思。远处三支蜡烛依次渐隐，在空间纵深里营造仪式感压迫气氛。\n\n近景特写他指尖微微蜷曲，指腹压住袍边暗纹处——那是旧伤痕印记；瞳孔深处映着一缕斜射而来的烛焰，情绪由内敛转为警觉。背景柱体模糊，强化角色心理独白强度。\n\n缓慢拉远镜头，展现全身盘腿端坐姿态，灰袍宽大垂落形成对称美感；身后阶梯层层叠起，烛台排列如阵列守卫。面部神情自若却透出压抑重量，暗示即将发生重大抉择或对话转折。",
    "duration": 3.12
}
```

### POST /api/v1/generate/video2vl

基于视频和文本提示进行视觉语言模型推理（Qwen3-VL）

**请求体 (Video2VLRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `system_prompt` | string | 是 | - | 系统提示词 |
| `prompt` | string | 是 | - | 用户提示词 |
| `video` | string | 否 | "" | 参考视频（文件名） |

**请求示例:**
```json
{
  "system_prompt": "You are a helpful video analysis assistant.",
  "prompt": "Describe the video content, camera movement, and subjects in each shot.",
  "video": "input_video.mp4"
}
```

**响应:** 返回模型生成的视频文本分析结果

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "output": "0-3秒：中景镜头缓慢向前推进，人物站在窗边注视远方，环境光线由冷转暖。\n\n3-6秒：镜头向右平移，画面切换到桌面上的关键道具，景别变为特写。",
    "duration": 8.42
}
```

**说明:**
- 该端点使用 Qwen3-VL-4B-Instruct 模型和 `qwen3vl_video_analyze.json` 工作流进行视频理解
- `video` 应传入通过文件上传接口获得的视频文件名（**产物名会被前置 500**，纪律同 `image2vl`）
- 服务端将 `system_prompt` 与 `prompt` 以换行拼接后作为模型提示词
- 适用于视频内容分析、分镜拆解和镜头描述生成
- **`duration` 是服务端耗时**（实测 1.65MB 样片 16.66s ≈ HTTP 墙钟 16.7s），不是视频时长
- 探针实测见 [api-probe/video2vl-20260922](./api-probe/video2vl-20260922/report.md)；复跑命令 `node scripts/probe-video2vl.mjs`
- canvas-studio 接入：工具 **`video2vl`**（超时取视频档 600s；带参考名自愈），用法见 [`canvas-studio-tools.md`](./canvas-studio-tools.md) §A12

---

## 图像转视频

> canvas-studio 当前仅接入以下两个视频端点（已移除未接入的 msr / mkr / mkrgrid）：`image2videofl2va`（首尾帧 / 纯文生视频）与 `image2videoref2va`（多参考图视频）。

### POST /api/v1/generate/image2videofl2va

基于首尾帧图像生成视频（FL2VA）

**请求体 (Image2VideoFl2vaRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 场景描述（从脚本内容派生） |
| `aspect` | string | 否 | "16:9" | 画面比例，可选 16:9 或 9:16 |
| `megapixels` | number | 否 | 0.4 | 视频清晰度（百万像素） |
| `duration` | integer | 否 | 5 | 视频时长（秒） |
| `image1` | string | 否 | "" | 起始帧图像（文件名） |
| `image2` | string | 否 | "" | 结束帧图像（文件名） |

**请求示例:**
```json
{
  "prompt": "A city street at sunset, camera pans forward",
  "aspect": "16:9",
  "megapixels": 0.4,
  "duration": 5,
  "image1": "start_frame.png",
  "image2": "end_frame.png"
}
```

**响应:** 返回生成的视频数据

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "video_fl2va_00001_.mp4",
    "full_url": "http://117.50.108.73:8082/view?filename=video_fl2va_00001_.mp4",
    "duration": 8.50
}
```

**说明:**
- 该端点基于首帧与尾帧图像生成连贯视频，使用 h3_i2v_fl2va.json 工作流
- `aspect` 支持 16:9 与 9:16，默认横屏 16:9
- `image1` 为起始帧，`image2` 为结束帧
- 适用于首尾帧之间插值生成动态视频

### POST /api/v1/generate/image2videoref2va

基于多张参考图像生成视频（全能参考 REF2VA）

**请求体 (Image2VideoRef2vaRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 场景描述（从脚本内容派生） |
| `aspect` | string | 否 | "16:9" | 画面比例，**可选 `16:9` 或 `9:16`**（0.3.0 明确口径；见下方「aspect 已结案」） |
| `megapixels` | number | 否 | 0.4 | 视频清晰度（百万像素）；本仓按档发 **0.4 / 1.0 / 2.0**（`config.ts` 的 `MEGAPIXELS_BY_RESOLUTION`） |
| `duration` | integer | 否 | 5 | 视频时长（秒） |
| `image1` … `image9` | string | 否 | "" | **参考图（≤9 张）**：定义「参考什么」——角色 / 场景 / 产品 / 风格；**不决定首帧** |
| `video1` … `video3` | string | 否 | "" | **参考视频（≤3 段）**：定义「参考怎么动」——动作、运镜、节奏、转场；**画面不会被复制进成片** |
| `audio1` … `audio3` | string | 否 | "" | **参考音频（≤3 段）**：定义「参考听什么」——节奏 / 情绪 / 音色；**仅作参考，不直接拼接成音轨** |
| — | — | — | — | 0.2.8 记的 **参考文件总数 ≤12**（图 + 视频 + 音频合计）：0.3.0 **未再声明**，是否仍生效未知 ⇒ 本仓按「仍生效」保守处理 |

**请求示例:**
```json
{
  "prompt": "A character walking through a fantasy city",
  "aspect": "16:9",
  "megapixels": 0.4,
  "duration": 5,
  "image1": "ref1.png",
  "image2": "ref2.png"
}
```

**响应:** 返回生成的视频数据

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "video_ref2va_00001_.mp4",
    "full_url": "http://117.50.108.73:8082/view?filename=video_ref2va_00001_.mp4",
    "duration": 8.50
}
```

**说明:**
- 该端点基于「全能参考」生成视频，使用 h3_i2v_ref2va.json 工作流
- **三类参考分工**：图 = 参考什么（不决定首帧）；视频 = 参考怎么动（画面不复用）；
  音频 = 参考听什么（不直接成音轨）。**参考视频自带的音轨同样占用音频 ≤15s 预算**
- **参考图上限 ≤9**（`image1`–`image9`）：本仓 `providers/drama.ts` 的 `maxReferences` 与
  `sliceToMax` 上限 **CV-191 起同为 9**；超 9 张时**保留首尾 + 中间均匀采样并回 warning**（与 fal 同一条规则）
- 0.2.8 记的**文件总数 ≤12**（image ≤9 + video ≤3 + audio ≤3 合计）与**输出 24fps**：
  0.3.0 文档**未再声明**（是否仍生效未知，见 0.3.0 修订说明）⇒ 本仓**不放宽**既有约束
- ✅ **aspect 已结案（0.3.0）**：后端明确「`aspect` 支持 `16:9` 与 `9:16`，默认横屏 `16:9`」
  → 0.2.8「枚举里没有 `9:16`、竖屏该传什么待确认」的疑虑**到此为止**。
  本仓发送端 `providers/drama.ts` 的 `dramaAspect` 本来就硬传 `'9:16'`，**与后端口径一致，无需改动**
- ⚠️ **响应 `duration` 语义（仍待注意）**：示例请求 `duration=5` 而响应 `duration=8.50`，
  与 txt2audio 的「该字段是**生成耗时**而非产物时长」同型 → **不要当作视频长度消费**，
  真实时长仍应本地 ffprobe（正是 av-timeline-plan.md 的 P0）
- **实测记录（2026-09-02）**：经 canvas-studio `video_composite` 双参考（定妆照+场景概念图）端到端出片成功（1280x720, 8s，prompt 为 H3 六段式全参考格式）——端点可用性已验证，见 `docs/effect-tests/` 轮次记录 R001/T1

---

## 音频生成

### POST /api/v1/generate/txt2audio

文本生成音乐（ACE Step Audio）。canvas-studio 侧对应工具 `music_generation`（CV-125 起为真实工具），产物落画布**音频节点**，可作 `compose_video` 的 `bgmNodeId`。

**请求体 (Txt2AudioRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `caption_prompt` | string | 是 | - | 音频整体描述（tags，即风格提示词） |
| `lyrics_prompt` | string | 是 | - | 歌词提示词 |
| `duration` | integer | 否 | 30 | 音频时长（秒） |
| `bpm` | integer | 否 | 128 | 每分钟节拍数 |
| `keyscale` | string | 否 | "Bb major" | 调式，格式为 `root` + `quality`；支持值见下 |
| `language` | string | 否 | "en" | 语言代码；支持值见下。**`unknown` = 纯器乐 / 无人声** |
| `timesignature` | string | 否 | "4" | 拍号，可选 `2` / `3` / `4` / `6` |

**支持值:**

`keyscale` = `root` + `quality`：

- `root`：`C`、`C#`、`Db`、`D`、`D#`、`Eb`、`E`、`F`、`F#`、`Gb`、`G`、`G#`、`Ab`、`A`、`A#`、`Bb`、`B`
- `quality`：`major`、`minor`

`language`（49 种 + `unknown`）：
`ar`、`az`、`bg`、`bn`、`ca`、`cs`、`da`、`de`、`el`、`en`、`es`、`fa`、`fi`、`fr`、`he`、`hi`、`hr`、`ht`、`hu`、`id`、`is`、`it`、`ja`、`ko`、`la`、`lt`、`ms`、`ne`、`nl`、`no`、`pa`、`pl`、`pt`、`ro`、`ru`、`sa`、`sk`、`sr`、`sv`、`sw`、`ta`、`te`、`th`、`tl`、`tr`、`uk`、`ur`、`vi`、`yue`、`zh`、`unknown`

**请求示例:**
```json
{
  "caption_prompt": "uplifting electronic pop, bright piano arpeggios, driving four-on-the-floor beat",
  "lyrics_prompt": "Verse 1:\nWake up to a brand new day\nChorus:\nWe shine like stars tonight",
  "duration": 30,
  "bpm": 128,
  "keyscale": "Bb major",
  "language": "en",
  "timesignature": "4"
}
```

**响应:** 返回生成的音频数据

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "audio_00001_.mp3",
    "full_url": "http://117.50.108.73:8082/view?filename=audio_00001_.mp3",
    "duration": 15.30
}
```

**说明:**
- 该端点使用 **ACE Step Audio** 模型生成音乐，工作流为 `ace_step_audio.json`，输出 **mp3**
- **`language=unknown` 用于纯器乐 / 无人声音频**（本仓当前走 `lyrics_prompt='[Instrumental]'` 的写法，二者都可用；改用 `unknown` 属可选优化，非必须）
- ⚠️ **响应 `duration` 是「服务端生成耗时」而不是音频时长**（与视频端点同型）→ 真实时长必须本地探测
- ⚠️ **`txt2audio` 实测存在偶发 500**（同参数一次 200 一次 500，且一律不返回原因）⇒ canvas-studio 侧已内建自愈：
  快失败摘字段重试、慢失败原样重试；被摘掉的字段名回落到结果 `degradedFields`，**必须据实告知用户该参数未生效**

---

## 错误响应

所有端点可能返回以下错误状态码：

| 状态码 | 描述 |
|--------|------|
| 400 | 请求参数错误 |
| 500 | 服务器内部错误 |
| 502 | Drama Backend 服务不可用 |

---
