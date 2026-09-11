# Canvas Studio 媒体生成工具文档

> **唯一权威**：`src/host-tools.ts` 中每个 `defineTool` 的 `description` + `parameters`
> ——那正是模型实际读到的东西。本页是**人工可读的镜像**，与代码不一致时以代码为准。
>
> 本文档已按 **2026-09-11 工具收敛**重写：`inpaint` / `style_transfer` / `storyboard_generate` /
> `storyboard_split` 四个工具已从注册表**删除**（连带后端端点与分支代码），`deduction` 早在
> 2026-08 就已移除。详见文末「2026-09-11 工具收敛」。

约定：`canvas-studio/src/` 为源码，`lib/` 为编译产物。
后端 API 基址：`http://117.50.108.73:8082`（可被 `CANVAS_STUDIO_DRAMA_API_BASE` 环境变量覆盖）。

---

## 目录

- [核心规则：所有图片必须先上传](#核心规则所有图片必须先上传)
- [工具总览](#工具总览)
- [工具详情](#工具详情)
- [公共输出 schema](#公共输出-schema)
- [跨工具串联：完整流程](#跨工具串联完整流程)
- [2026-09-11 工具收敛](#2026-09-11-工具收敛)
- [已修复问题清单](#已修复问题清单)
- [验证清单](#验证清单)

---

## 核心规则：所有图片必须先上传

**所有需要图片作为输入的工具，都只能接受 `filename`（已上传到 Drama Backend 的服务器文件名），不能直接传图片 URL。**

1. 用 `image_generate` 生图 → 得到图片 URL
2. 用 `upload_image` 上传到 Drama Backend → 得到服务器文件名
3. 用 `filename` 传给下游工具

**三个容易踩的点（2026-09-10 实测补充）**

- **上传响应取 `name`**：`POST /api/v1/generate/upload` 返回 ComfyUI 原生结构
  `{name, subfolder, type}`，**`name` 就是下游工具要传的文件名**（如 `ref-8e6fce70.png`）。
  调用时只传 `name`，不要拼 `subfolder` 前缀。
- **参考图必须是有意义的真实尺寸图**：拿 1×1 像素 / 几百字节的占位图当参考图，后端
  会返回笼统 500（**不是**接口不可用）。这条是 2026-09-10 那轮「带文件端点全挂」误判的根因，
  排查接口时务必先确认素材本身正常。
- **大文件上传偶发连接重置**：约 1MB 的图上传时出现过 `socket hang up`，重试即成功；
  314KB / 550KB 未复现。生产侧上传建议保留重试。

> 完整端点契约、必填性与耗时基线见 [`api.md`](./api.md) 与
> [`api-probe/2026-09-10-file-endpoint-recheck.md`](./api-probe/2026-09-10-file-endpoint-recheck.md)。

---

## 工具总览

注册给模型的工具**共 23 个** = **21 个真实工具**（下表）+ **2 个占位工具**（见本节末）。

### A. 后端生成 / 分析类（10 个）

| 工具名 | 产物 | 对应后端端点 | 备注 |
|--------|------|------------|------|
| `image_generate` | image | `txt2image` / `txt2imageanime` / `image2image`（带参考图时） | 双画风 realistic / anime |
| `character_generate` | image | `image2character` | 角色设计图 → 多视角立绘（不建卡） |
| `character_sheet` | 资产卡 | `image2character` | 白底四视图拼图整图，一致性唯一锚点 |
| `image2vl` | text | `image2vl` | 直调视觉模型分析画面 |
| `qc_shot` | text | `image2vl` | 逐镜一致性质检，结论写回画布节点 |
| `prompt_enhance` | text | `image2promptenhance` | 提示词增强 |
| `upload_image` | filename | `upload` | **唯一上传端点**（图片/视频/音频通用） |
| `video_generate` | video | `image2videofl2va`（带音频时 `image2videoref2va`） | H3 路线；`provider=fal` 走 fal MiniMax H3 |
| `video_composite` | video | `image2videofl2va` / `image2videoref2va` | H3 路线；按参考图数量自动选端点 |
| `music_generation` | audio | `txt2audio` | ACE Step Audio；后端有偶发 500，工具自动重试 |

### B. 本地媒体处理（2 个，不调后端）

| 工具名 | 产物 | 实现 |
|--------|------|------|
| `extract_last_frame` | image | 本地 ffmpeg 抽真实末帧，供 `shotTransition=chain` 链帧 |
| `compose_video` | video | 本地 ffmpeg 拼接 + BGM 混音 + 统一调色，产出成片 |

### C. 画布 / 流程管控（9 个，不调后端）

| 工具名 | 用途 |
|--------|------|
| `list_shots` | 镜头清单（节点 id / 分镜卡 / 版本号 / 状态 / 时长） |
| `list_references` | 参考托盘 + 一致性资产卡 + 画布文本节点（三段返回） |
| `look_card` | **Look 卡**（CV-157）：把澄清第 ② 步的 5 项 tokens 冻结成 `role=style` 资产卡，逐镜逐字节注入 |
| `write_screenplay` | 剧本落画布「剧本」节点（重复调用原地更新） |
| `write_script` | 文案落画布「文案」节点（供 `compose_video` 作 `scriptId`） |
| `ask_user_choice` | 点选式提问卡片（人在回路） |
| `submit_screenplay_for_approval` | 剧本审批门禁 |
| `submit_storyboard_for_approval` | 分镜审批门禁（批准后视频工具才放行） |
| `submit_keyframes_for_approval` | 关键帧审批门禁 |

> 审批门禁的实际拦截由 `host-tools.ts` 的 `GATED_TOOLS` 实现，当前成员为
> `video_generate` / `video_composite` 两个——只有它们会被工作流状态拦下。

### D. 占位工具（`src/skills/placeholder-tools.ts`，另注册 2 个）

这 2 个不调用任何后端端点，只返回「能力边界 + 替代路径」文本，用来让上游 skill
流程不因缺能力而报错中断：

| 工具名 | 产物 | 后端端点 | 说明 |
|--------|------|---------|------|
| `tts_voiceover` | text | 无（占位） | 旁白/对白配音：canvas-studio 当前无 TTS 能力 |
| `subtitle_burn` | text | 无（占位） | 硬字幕烧录：canvas-studio 当前无烧录能力 |

注册入口：`src/index.ts` 的 `ctx.tools.register`（真实工具走 `createStudioTools`，
占位工具走 `createPlaceholderTools`）。

---

## 工具详情

> 参数级事实源是代码；此处给出**参数清单 + 关键约束**，便于人工核对与交接。
> 全部工具的输出 schema 见「[公共输出 schema](#公共输出-schema)」（除非单独标注）。

### A1. `image_generate`

**功能**：按提示词生成图片。不传参考图 = 纯文生图；传参考图 = 图生图（最多 3 张多参考融合）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 生成提示词 |
| `aspectRatio` | string | 否 | `16:9`（默认）/ `9:16` / `1:1` |
| `style` | string | 否 | `realistic`（默认，写实）/ `anime`（卡通，**仅纯文生图**；带参考图则回退写实图生图） |
| `filename` | string | 否 | 单参考图：Drama 文件名；可传 `@ref[显示名]` 由 Host 自动解析 |
| `filenames` | string[] | 否 | 多参考图（最多 3 张），与 `filename` 二选一 |
| `negativePrompt` | string | 否 | 反向提示词。⚠️ **文生图路径禁止使用**（后端忽略，约束改写进正向提示词） |
| `replaces` | string | 否 | 本次生成取代哪个已有图片节点（节点 id）。旧图自动失效并**退出参考池**；**重出样张 / 重做参考图时应传**（CV-159） |
| `sourceUrls` | string[] | 否 | 参考图的画布产物 URL，用于画血缘箭头 |
| `shotRefs` | array | 否 | 关联的分镜卡（标题 / 「分镜 N」/ 节点 id） |

**端点路由**：`style=anime` 且无参考图 → `txt2imageanime`；有参考图 → `image2image`（`image1`~`image3`）；否则 → `txt2image`。

---

### A2. `character_generate`

**功能**：基于角色设计图生成角色立绘 / 三视图。**只出一张立绘图，不建一致性资产卡**（要建卡用 `character_sheet`）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filename` | string | 是 | 角色设计图：Drama 文件名（来自 `upload_image`，或 `@ref[显示名]`） |
| `aspectRatio` | string | 否 | `16:9` / `9:16` / `1:1` |
| `sourceUrls` | string[] | 否 | 设计图对应的画布产物 URL |
| `shotRefs` | array | 否 | 关联分镜卡 |

**端点**：`POST /api/v1/generate/image2character`（`qwen_4view_char_2step` 工作流），请求体只吃 `image`。

---

### A3. `character_sheet`

**功能**：建立**项目级一致性资产卡**——调 `image2character` 生成白底四视图立绘，
**拼图整图**直接作为资产卡唯一锚点（CV-122：官方 reference-sheet 用法，拼图自带角色/视角标签，
下游整图作参考，不再切分）。返回资产卡 id 与拼图的 Drama filename。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filename` | string | 是 | 角色设计图 / 定妆照的 Drama 文件名 |
| `name` | string | 是 | 资产卡显示名（如「女主」）。**同名卡整体覆盖** → 取稳定角色名，不要带序号/版本号 |
| `lockedPrompt` | string | 是 | 冻结的 SAME 块（外貌/发型/服装/配色/光感），**必须先与用户确认**；后续镜头 prompt 逐字节复用 |
| `negativePrompt` | string | 否 | 负面约束（如「不更换服装」） |
| `sourceUrls` | string[] | 否 | 设计图对应的画布产物 URL |

**输出**（独立 schema，非公共 `resultSchema`）：`{ url, assetId, name, filename }`。

> ⚠️ 同名覆盖是**纠正冻结描述写错**的路径——重调传相同 `name` 即整体更新锚点与 lockedPrompt。

---

### A4. `image2vl`

**功能**：分析一张图片的内容，返回详细画面描述。必须提供 `filename`。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filename` | string | 是 | Drama 文件名（来自 `upload_image`，或 `@ref[显示名]` 含对话附件素材） |
| `prompt` | string | 是 | 分析提示词 |
| `systemPrompt` | string | 否 | 缺省「你是一个专业的影视镜头分析师。请从电影摄影的角度分析这张画面。」 |

**端点**：`POST /api/v1/generate/image2vl`（`image` + `prompt` + `system_prompt`）。

> ⚠️ 模型没有视觉能力：不要读本地图片路径、不要把图片 URL 当参数（会报 `model does not declare image input`）。
> ⚠️ 跨请求脏状态：**不传图**时后端会返回陈旧缓存图的描述 → 不带图的 VL 结果不可信。

---

### A5. `qc_shot`

**功能**：对单个镜头产物做**一致性质检**——视觉模型对照固定要素描述核对画面，返回 PASS / FAIL / WARN 与漂移项，结论写回该画布节点。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `filename` | string | 是 | 被检镜头图的 Drama 文件名（产物 filename / `upload_image` 结果 / `@ref[显示名]`） |
| `expect` | string | 否 | 判定基准。缺省拼接本项目全部资产卡的 `lockedPrompt`；两者皆空时报错 |
| `shotRefs` | array | 否 | 该镜所属分镜卡。**务必传**——重跑会生成新节点，不传则重跑预算失效 |
| `budget` | number | 否 | 重跑预算，默认 2；用尽时 `exhausted=true`，应停止自动重跑并上报用户仲裁 |

**输出**（独立 schema）：`{ verdict, drifts, reason, attempts, budget, exhausted, nodeId }`。底层调 `image2vl`。

---

### A6. `prompt_enhance`

**功能**：增强提示词，返回更丰富详细的描述。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 原始提示词 |

**输出**：`{ text }`。**端点**：`POST /api/v1/generate/image2promptenhance`。

---

### A7. `upload_image`

**功能**：上传图片到 Drama Backend，返回服务器文件名。**所有以文件名为入参的接口都必须先经本工具**。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `imageUrl` | string | 是 | 图片 URL（通常是产物 URL；相对 URL 自动补全为绝对 URL） |

**上传流程**：
1. 解析来源为字节：
   - **canvas-studio 资产 URL**（`/canvas-studio/assets/<projectId>/<file>`，带不带 `http://127.0.0.1:<port>` 前缀均可）：Host 进程直接 `registry.assetsDir(projectId)/<file>` 读盘——**绕过本地 webServer 对 loopback 请求返回的 403**。
   - 本地绝对路径 / `file://`：直接读盘。
   - 其它 URL：补全 loopback 端口后 `fetch` 下载。
2. `FormData`（字段名 `file`）`POST` 到 **`/api/v1/generate/upload`**（唯一上传端点；旧 `uploadimage` 已下线返回 404）。
3. 解析响应提取文件名（兼容 `{ name }` / `{ filename }` / `{ data: { filename } }` / `{ data: { url } }`）。
4. 返回 `filename`。表单文件名统一 `ref-<8位uuid>.<ext>`，避开后端去重后缀 ` (1)` 带出的空格/括号（下游会 500）。

**输出**：`{ filename }`（独立 schema）。上传后会把 filename 回写到画布资产节点（CV-031b 血缘反查）。

---

### A8. `video_generate`

**功能**：生成视频。不传 `filename` = 纯文生视频；传 `filename` = 首帧图生视频。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 生成提示词。若写成 H3-Context-IR 简报格式会先做**本地格式预检**，ERROR 级直接报错且不调后端 |
| `filename` | string | 否 | 首帧图：Drama 文件名（或 `@ref[显示名]`） |
| `aspectRatio` | string | 否 | `16:9`（默认）/ `9:16`。**视频只有这两档**，`1:1` 会落回 16:9 |
| `duration` | number | 否 | 秒，默认 5；上限 15（建议 8–10，更长请拆多段） |
| `model` | string | 否 | 【占坑】`h3`（默认）/ `seedance2`（未接入，传了会提示并按 h3 生成） |
| `resolution` | string | 否 | 【占坑】`768p` / `1080p` / `720p` / `2k`：**仅 fal 生效**；Drama 忽略并回提示 |
| `generateAudio` | boolean | 否 | 原生音轨开关。**缺省不发送**；传 `true` 请求随画同步原生音轨，传 `false` 要求静音 |
| `audioRefs` | string[] | 否 | 参考音频（H3 audio reference 通道）。**有序数组，顺序即 `<Audio N>` 引用序**。硬规格：≤3 段、单段 2–15s、**合计 ≤15s**、WAV/MP3、单段 ≤15MB，且**音频不能是唯一输入**——不合规在发出前直接报错 |
| `provider` | string | 否 | `drama`（默认）/ `fal`（MiniMax H3，需配置 fal API Key）。留空走设置页默认值 |
| `sourceUrls` | string[] | 否 | 首帧图的画布产物 URL，用于血缘箭头 |
| `shotRefs` | array | 否 | 关联分镜卡 |
| `shotTransition` | string | 否 | `chain`（同场景连续，生成前先 `extract_last_frame` 取上镜末帧）/ `cut`（默认）/ `bridge` |
| `replaces` | string | 否 | 本次取代哪个已有视频节点 id（`list_shots` 查）。旧版自动失效、不再进默认合成 |

**Drama 端点路由（H3 技术路线）**：

| 条件 | 端点 |
|------|------|
| 纯文生视频（无参考图） | `POST /api/v1/generate/image2videofl2va` |
| 单张首帧图生视频 | `POST /api/v1/generate/image2videofl2va`（`image1`） |
| 带参考音频（`audioRefs` 非空） | `POST /api/v1/generate/image2videoref2va`（H3 全能参考通道） |

`provider=fal` 时改走 fal MiniMax H3（参考上限 9 张，时长下限 5 秒）。

---

### A9. `video_composite`

**功能**：将多张参考图合成一段视频。两张图走首尾帧插值；三张及以上走多参考图合成。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 生成提示词（IR 简报会按图数映射模式做本地预检） |
| `filenames` | string[] | 是 | 参考图 Drama 文件名数组。上限：Drama 6 张 / fal 9 张，超出自动采样保留首尾 |
| `aspectRatio` | string | 否 | `16:9`（默认）/ `9:16` |
| `duration` | number | 否 | 秒，默认 10；上限 15。fal 下限 5 秒（更短会被钳到 5 并提示） |
| `model` / `resolution` / `generateAudio` / `audioRefs` / `provider` / `sourceUrls` / `shotRefs` / `shotTransition` / `replaces` | — | 否 | 同 `video_generate` |

**Drama 端点路由（H3 技术路线）**：

| 条件 | 端点 |
|------|------|
| 恰好 2 张（首尾帧插值） | `POST /api/v1/generate/image2videofl2va`（`image1` + `image2`） |
| 1 张，或 ≥3 张（多参考合成） | `POST /api/v1/generate/image2videoref2va`（`image1`…`image6`） |
| 带参考音频（`audioRefs` 非空） | `POST /api/v1/generate/image2videoref2va`（一律 r2v，与首尾帧语义互斥） |

> 端点的选择依据是 `src/providers/capability.ts` 的 `capabilityOf`，由 `src/providers/drama.ts` 落成具体路径。
> 「带音频」优先级最高，且会通过 `audioModeNotice` 显式回报语义变更，不静默改写。

---

### A10. `music_generation`

**功能**：生成 BGM（Drama `txt2audio`，ACE Step Audio）。音频节点自动落画布，可直接作 `compose_video` 的 `bgmNodeId` 混音（自动淡入淡出）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 音频整体描述 tags（情绪/风格/乐器/节奏）。写法见 skill `music-prompt-writing` |
| `lyrics` | string | 否 | 歌词（`[Verse]`/`[Chorus]` 结构标记）。**纯器乐留空**，自动填 `[Instrumental]` 并建议 `language="unknown"` |
| `duration` | number | 否 | 秒，默认 30；BGM 应与成片真实时长一致（≤300 稳定） |
| `bpm` | number | 否 | 默认 128；60–180 最稳（模型只当锚点，实际 ±2） |
| `keyscale` | string | 否 | 调式（如「C major」）。**软提示**：后端不接受时自动摘掉并记入 `degradedFields` |
| `language` | string | 否 | 语言代码（`zh`/`en`/`ja`…；`unknown` = 纯器乐无人声） |
| `timesignature` | string | 否 | 拍号 `4`/`3`/`6`；软提示 |
| `sourceUrls` | string[] | 否 | 关联画布产物 URL |

**输出**（独立 `musicResultSchema`）：`{ url, filename, nodeId, duration, declaredDuration, bpm, lyrics, degradedFields, attempts }`。
`duration` 是**落盘后 ffprobe 实测的真实时长**，不是响应里的 `duration`（后者是服务端生成耗时）。

> ⚠️ 后端 `txt2audio` 有**偶发 500**（同参数一次 200 一次 500，一律不给原因）；工具按
> 「快失败摘字段 / 慢失败原样重试」自愈，最多 3 次。`keyscale` 等软提示被拒时如实回显 `degradedFields`——
> **不要向用户声称「已按指定调性生成」**。

---

### B1. `extract_last_frame`

**功能**：抽取画布上某个视频片段的**真实末帧**（本地 ffmpeg），用于「同场景连续镜头」的像素级衔接。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `videoUrl` | string | 是 | 视频片段的同源 URL（`video_generate` / `video_composite` 返回的 `url` 字段） |

末帧图落到画布并标记为 frame 参考（可用 `@ref` 引用）；返回的 `filename` 可直接填进
`video_generate` 的 `filename` 或 `video_composite` 的 `filenames` 首张。**只在衔接语义为 `chain` 时调用**。

---

### B2. `compose_video`

**功能**：把画布上已有的视频片段拼接成最终成片（本地 ffmpeg concat，可选混 BGM + 统一调色）。
**这是「成片合成」步骤——严禁再用 `video_generate` / `video_composite` 从图片重新生成视频。**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `clipIds` | string[] | 否 | 参与拼接的片段节点 id；缺省取时间轴全部有效片段。**只给 1 个也合法**（= 一镜整出，保留该镜原生环境声） |
| `bgmNodeId` | string | 否 | BGM 节点 id（视频/音频）。**必须不短于成片真实时长**，否则直接报错不落成片 |
| `scriptId` | string | 否 | 文案节点 id（`write_script` 产物），成片详情展示广告词/对白/字幕 |
| `colorGrade` | boolean | 否 | 统一调色开关，默认开（治色调漂移）；片段已色调一致时传 `false` 关闭 |

**音轨策略（自动，不参与参数）**：**单镜保留原生环境声；多镜拼接一律丢弃** →
多镜必须给 BGM，否则成片无声。

**输出**（公共 `resultSchema`，含成片专用字段）：`{ url, width, height, duration, nodeId, clipCount, skippedCount, audioComposition }`。
`audioComposition` ∈ `native` / `native+bgm` / `bgm` / `none`，**必须如实转述给用户**。

---

### C1. `list_shots`

**功能**：列出当前项目画布上的视频片段，含节点 id / 分镜卡 / 版本号 / 状态 / 时长。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `includeRetired` | boolean | 否 | 是否一并列出已失效/已作废片段（默认 `false` 只列有效片段） |

**返回值**：`{ shots: [...] }`（独立 schema）。用户要求「某镜返工」「只合成合理的分镜」时**必须先调本工具**定位节点 id
——重出某镜时把旧版 id 填进 `video_generate` / `video_composite` 的 `replaces`；精确合成时填进 `compose_video` 的 `clipIds`。

---

### C2. `list_references`

**功能**：列出当前项目可复用的参考图 + 一致性资产卡 + 画布文本节点。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `includeRetired` | boolean | 否 | 是否一并列出已失效（被取代 / 作废）的参考图（默认 `false`）。失效参考带 `status` 字段（`superseded` / `retired`），可用于恢复旧版定位节点 id |

**返回值三段**（独立 schema）：
- `references`：参考托盘素材节点——`title` / `url` / `filename`（空则需先 `upload_image`）/ `role`（image/character/style/frame）/ `strength`。**被取代 / 已作废的图片默认不列**（CV-159：废样张退出参考池，不挤占 `image2image` 的 3 个参考位）。
- `assets`：项目一致性资产卡——`id` / `name` / `role` / `lockedPrompt` / `negativePrompt` / `anchors`（锚点分图的 title/url/filename）。
  **跨镜头生成同一角色/场景时必须先读它**，以 `lockedPrompt` 逐字节复用 + 锚点分图作参考。
- `notes`：画布文本类节点（风格归纳便签 / `write_script` 文案 / 已提交的分镜表），最多 10 条、单条截断 2000 字符。

---

### C3. `write_screenplay`

**功能**：把完整剧本落为画布节点（标题「剧本」，`kind=text`）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `screenplay` | string | 是 | 完整剧本 markdown（含结构节拍与各节时长占比） |
| `summary` | string | 否 | 一句话概述，展示在审批提示与剧本摘要 |

**返回值**：`{ text }`（独立 schema）。**重复调用原地更新**已有「剧本」节点（不产生重复节点）；
落盘后必须调 `submit_screenplay_for_approval`。上游风格 skill 的「故事大纲 / 叙事主轴」步骤即本节点，**禁止另建大纲节点**。

---

### C4. `write_script`

**功能**：把成片文案落为画布节点（标题「文案」，`kind=text`），覆盖广告词 / 对白 / 背景音乐（BGM）/ 音效（SFX）/ 字幕。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `script` | string | 是 | 完整文案（可分段标题） |

**返回值**：`{ text }`。合成成片时把节点 id 作为 `scriptId` 传入 `compose_video`，成片详情即展示该文案。

---

### C5. `ask_user_choice`

**功能**：向用户提出一道点选题。选项卡片内联在对话区，用户点击后选择自动作为工具结果返回（无需打字）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `question` | string | 是 | 问题文本（简短一句话） |
| `options` | string[] | 是 | 候选项（2–6 个短标签）；推荐项末尾加「（推荐）」 |
| `allowFreeText` | boolean | 否 | 自由输入框开关，缺省开启；仅纯封闭单选题才显式传 `false` |
| `multiSelect` | boolean | 否 | `true` 为多选题，答案以「、」拼接返回 |

**返回值**：`{ text }`。会阻塞到用户作答或超时（上限 600s）；超时返回提示时应采用带「推荐」标记的选项继续。

---

### C6–C8. 三个审批门禁

| 工具 | 参数 | 逐步确认模式下的行为 |
|------|------|---------------------|
| `submit_screenplay_for_approval` | `summary?` | 校验画布已有「剧本」节点 → 置 `state=script_review`，要求用户点「批准」。放手跑模式直接放行 |
| `submit_storyboard_for_approval` | `storyboard`（必填）、`summary?` | 把分镜表**逐镜拆卡**落画布（解析不出表格则回退整表单节点）→ 置 `state=awaiting_approval`。批准后 `video_generate` / `video_composite` 才放行 |
| `submit_keyframes_for_approval` | `summary?` | 置 `state=keyframe_review`，等待用户点「确认关键帧」。放手跑模式为空操作 |

三者均返回 `{ text }`（独立 schema，含下一步指引）。

---

### C9. `look_card`（CV-157）

**功能**：把澄清第 ② 步采集到的 **5 项 tokens**（色彩 / 光线 / 材质 / 镜头语汇 / 节奏）冻结成
项目级 **Look 卡**（`role: 'style'` 资产卡），供逐镜逐字节注入。**不调用任何后端生成** ——
样张由 `image_generate` 产出，本工具只把 tokens 与素材登记成卡。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 卡名（如「雨夜霓虹」）。`Look · ` 前缀**自动补上**；同名重调即整体覆盖 |
| `lockedPrompt` | string | 是 | 5 行「色彩：…」…「节奏：…」，顺序固定、不增不减；**必须先与用户确认** |
| `referenceFilename` | string | 否 | 样张/参考图，作视觉锚点。可传 `@ref[节点标题]` / 画布节点 id / upload_image 文件名 |
| `negativePrompt` | string | 否 | 风格负面约束（如「不要高饱和」） |

**返回值**：`assetId` / `name` / `lockedPrompt` / `anchors[]` / `warnings?`（独立 schema，带编译期字段覆盖守卫）。

要点：

- **与角色卡的差异**：`character_sheet` 的四视图拼图是本工具当场生成的 → 新节点作锚点；
  `look_card` 的样张**已在画布上**（②-2 由 `image_generate` 出）→ **复用既有节点作锚点**，
  不重下载、不新建节点。传 `@ref[节点标题]` 最省事。
- **同名即整体覆盖**（与角色卡同一语义）：tokens 或样张改了就同名重调，不要建第二张卡。
  前缀 `Look · ` 防与角色卡撞名（撞名会静默换掉另一张卡）。
- **tokens 归一策略**：5 项齐全 → 归一成权威行序后落卡（逐镜注入是逐字节复用，行序漂移会让
  卡与 prompt 对不上）；缺项 → **原样保留 + 返回 warning**，不改写看不懂的输入。
- **锚点未命中不阻断**：解析不到画布节点时出 warning 照常落卡 —— 主路径是**文字注入**。
- **参考席位**：Look 默认不占参考图席位（后端 `image2image` 只有 `image1~image3` 三个槽位）；
  确需视觉锚点时应**取代 image3**（首镜成图）而非新增第 4 张（第 4 张会被静默 `slice(0,3)` 丢弃）。

---

## 公共输出 schema

除单独标注独立 schema 的工具（`character_sheet` / `list_shots` / `list_references` / `prompt_enhance` /
`image2vl` / `qc_shot` / `upload_image` / `write_screenplay` / `write_script` / `ask_user_choice` /
三个审批门禁 / `music_generation` / `look_card`）外，图像与视频产物共用 `resultSchema`（`src/host-tools.ts`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 产物托管 URL |
| `width` / `height` | integer | 尺寸（像素） |
| `duration` | number | 视频时长（秒）；图片无此项 |
| `filename` | string | Drama 服务器文件名（图片类产物，供下游以 filename 链式引用） |
| `warnings` | string[] | 占坑参数提示（`model` / `resolution` / `generateAudio` 未生效时的说明） |
| `nodeId` | string | 落到的画布节点 id（可填 `compose_video` 的 `clipIds`、`replaces`） |
| `superseded` | string[] | 本次产物取代掉的旧节点 id |
| `clipCount` / `skippedCount` | integer | 成片专用：纳入拼接的片段数 / 被跳过的失效片段数 |
| `audioComposition` | string | 成片专用：`native` / `native+bgm` / `bgm` / `none`，必须如实转述 |

> ⚠️ **`additionalProperties: false`**：结果类型新增字段而 schema 未同步时，产物会在返回给模型前
> **被静默丢弃**（后端已生成、时间照花）。CV-146 就是这个坑，现已加**编译期覆盖守卫**防复发。

```ts
// src/host-tools.ts
export type ComposeSchemaCoverage = MustBeNever<MissingInSchema<typeof resultSchema, ComposeToolResult>>
export type MusicSchemaCoverage = MustBeNever<MissingInSchema<typeof musicResultSchema, MusicResult>>
```

---

## 跨工具串联：完整流程

### 标准图生视频（3 步）

```
Step 1: image_generate(prompt="...")                     → 图片 URL + filename
Step 2: video_generate(prompt="...", filename=文件名)     → 视频 URL
```

产物落画布时自带 filename，**不需要**对每次生成产物重复调 `upload_image`（只有外部 URL 图片才需要）。

### 多参考合成（含角色一致性）

```
Step 1: character_sheet(filename=设计图, name="女主", lockedPrompt=...)  → 资产卡 + 锚点拼图 filename
Step 2: image_generate(prompt=lockedPrompt + 本镜动作, filenames=[锚点拼图, 场景概念图], shotRefs=["分镜 1 · 特写"])
Step 3: qc_shot(filename=本镜产物, shotRefs=["分镜 1 · 特写"])            → PASS / FAIL / WARN
Step 4: video_composite(prompt=六段式, filenames=[锚点, 场景图, 姿态帧], shotRefs=[...])
Step 5: music_generation(prompt="...", duration=成片真实时长 + 余量)      → bgmNodeId
Step 6: compose_video(clipIds=[...], bgmNodeId=..., scriptId=...)        → 成片
```

### 创作全流程（逐步确认模式）

```
1. 需求澄清         ask_user_choice（一次一个问题）
2. 创意策划         prompt_enhance
3. 剧本 → 审批      write_screenplay → submit_screenplay_for_approval（等「批准」）
4. 分镜 → 审批      submit_storyboard_for_approval（等「批准」）
5. 资产卡           character_sheet（含角色的片子必经）
6. 逐镜关键帧       image_generate（lockedPrompt 原样开头 + shotRefs）
7. 逐镜质检         qc_shot（PASS 不重跑 / FAIL 只重跑该镜 / exhausted 上报）
8. 关键帧 → 确认    submit_keyframes_for_approval（等「确认关键帧」）
9. 逐镜视频         video_composite 多参考优先；chain 镜先 extract_last_frame
10. 文案            write_script
11. BGM             music_generation（时长 ≥ 成片真实时长）
12. 成片合成        compose_video（clipIds / bgmNodeId / scriptId）
```

---

## 2026-09-11 工具收敛

### 删除了什么

| 工具 | 后端端点 | 处置 |
|------|---------|------|
| `inpaint` | `image2inpaint` | 工具 + 端点 + `generate.ts` 分支 + `DISABLED_TOOLS` 守卫全部删除 |
| `style_transfer` | `image2styletransfer` | 同上 |
| `storyboard_generate` | `image2storyboard` | 工具 + 端点 + 分支删除；一并移出 `GATED_TOOLS` |
| `storyboard_split` | `image2splitegrid` | 工具 + 端点 + `splitStoryboard` / `gridDims` 删除 |
| `deduction` | `/generate/deduction` | **早于本次**（2026-08）即已移除，代码中从不存在 |

**决策依据（2026-09-11 用户拍板）**：这 4 个接口**不暴露给大模型使用**。
注意 `inpaint` / `style_transfer` 的后端端点本身是**可用**的（实测 `image2inpaint` 200 / 31.2s、
`image2styletransfer` 200 / 22.2s），删除属**产品决策**而非后端限制；「移出 `DISABLED_TOOLS`
并同步 skill 文案」的备选方案已作废。

### 同步改了什么

- `src/host-tools.ts`：4 个 `defineTool` 块、`DISABLED_TOOLS` / `guardDisabledTool`、`GATED_TOOLS` 成员、`resultSchema` 与 JSDoc 引用。
- `src/generate.ts`：3 个端点分支、`splitStoryboard` / `gridDims`、`GenerateParams` 的 `styleFilename` / `gridnum` / `enhance` 字段。
- `src/config.ts`：`DRAMA_ENDPOINTS` 移除 `inpaint` / `styleTransfer` / `storyboard` / `spliteGrid`。
- `src/asset-capture.ts`：媒体白名单移除 4 项。
- `src/providers/types.ts`、`src/contracts/canvas.ts`、`src/projects.ts`：清理相关注释。
- `scripts/analyze-session.mjs`：移除工具分类与端点映射 4 项。
- `skills-local/`：`canvas-studio-creation`（SKILL.md + toolchain / prompt-writing / style-presets / consistency）
  与 `qwen-image-edit-writing` 移除全部教学与引用，改完执行 `scripts/sync-minimax-skills.mjs` 重建 `skills/`。
- 测试：`workflow-gate`（改用 `video_generate` 作受控工具）、`generate`（P8.3 两条删除，新增收敛断言）、
  `asset-capture`、`skill` 四个文件同步。

### 有意保留的历史兼容

- `StudioCanvasOperationType` 仍保留 `'style-transfer'` / `'storyboard-split'` 成员，
  `client/canvas/labels.ts`、`CanvasEdges.tsx`、`CanvasNode.tsx`（`inpaint` 加载文案）、
  `LayerDetailPanel.tsx`（`styleFilename` 展示解析）同样保留 —— **老项目画布上由这些工具生成的既有节点
  仍要能正常渲染与重试**。新节点不会再产生这些取值。

---

## 已修复问题清单

| # | 问题 | 状态 | 位置 |
|---|------|------|------|
| 1 | **图片参数规范**：所有需要图片输入的工具必须使用 `filename`，移除 `imageUrl`/`imageUrls` | ✅ 已修复 | `src/generate.ts`、`src/host-tools.ts` |
| 2 | **相对 URL 自动解析**：`upload_image` 接受相对 URL，内部补全为绝对 URL | ✅ 已修复 | `src/generate.ts` |
| 3 | **`video_composite` 的 `frame_index` 算法**：改为按时间轴均分而非数组下标 | ✅ 已修复 | `src/generate.ts` |
| 4 | **`video_generate` API 参数**：使用 `image1` 传递主参考图 | ✅ 已修复 | `src/generate.ts` |
| 5 | **上传响应格式兼容**：兼容 `{ filename }` / `{ name }` / `{ data: { filename } }` | ✅ 已修复 | `src/generate.ts` |
| 6 | ~~新增完整工具集（早期 9 工具版本）~~ | ⚠️ 已被 2026-09-11 收敛取代，见上文 | — |
| 7 | **`upload_image` 直读本地资产**：资产 URL 直接经 `registry.assetsDir` 读盘，不再 `fetch` 本地 webServer（loopback 403 导致上传必失败） | ✅ 已修复 | `src/generate.ts` `readSourceBytes` / `parseCanvasAsset` |
| 8 | **产物输出 schema 补齐 `filename`**：回传 Drama 文件名时触发 `additionalProperties: false` 校验失败，产物被丢弃 | ✅ 已修复 | `src/host-tools.ts` `resultSchema` / `renderResult` |
| 9 | **产物输出 schema 再次漏字段（CV-146）**：`resultSchema` 漏 `audioComposition`；`music_generation` 内联 schema 漏 `declaredDuration` 等 **5 个**字段。**与第 8 条同一个坑**。已补齐并新增编译期覆盖守卫 `MusicSchemaCoverage` / `ComposeSchemaCoverage`（漏字段时 `tsc` 失败并点名，已反向验证） | ✅ 已修复（2026-09-11） | `src/host-tools.ts` |
| 10 | **CV-145 误判撤回**：曾判定「带文件端点全挂」，实为探测脚本用了 1×1 占位图 → 后端解码崩 500。换真实尺寸图后 11 个带文件端点全部 200 | ✅ 已撤回（2026-09-10） | `docs/api-probe/2026-09-10-file-endpoint-recheck.md` |
| 11 | **CV-146 同源风险：工具文档整体过时**（早期 9 工具版本、端点映射错误、`file:///Users/wl/...` 指向别的开发机） | ✅ 已修复（2026-09-11 全量重写） | 本文件 |

---

## 验证清单

### 自动化覆盖

```
corepack yarn workspace canvas-studio build          # sync skills + clean + tsdown + tsc（双端）
corepack yarn workspace canvas-studio verify:loader  # 客户端 loader 冒烟
corepack yarn workspace canvas-studio test:smoke     # node --test tests/*.test.mjs
```

覆盖要点：
- `image_generate` 生成 / `retryOf` 重试语义 / 重试目标不存在时的错误处理
- `video_generate` 文生与首帧两条路径的端点与请求体契约（`image2videofl2va`）
- `video_composite` 双图 → `image2videofl2va`、多图 → `image2videoref2va`
- 供应商选择：默认 drama / `provider=fal` / 非法值报错 / provider 随节点持久化
- 音频通道：`audioRefs` 按序落 `audio1..audio3` 且走 REF2VA；`generate_audio` 缺省不发送
- 上传端点形态与响应解析（`upload`，兼容四种响应形状）
- 工作流门禁：`video_generate` / `video_composite` 在 `confirm` 模式下被硬拦截，批准后放行
- **收敛断言**：4 个已删工具不再出现在注册表、媒体白名单与 `DRAMA_ENDPOINTS` 中

### 端到端验证步骤

| # | 步骤 | 期望 |
|---|------|------|
| 1 | `prompt_enhance(prompt="一只猫")` | 返回增强提示词 |
| 2 | `image_generate(prompt="一只猫")` | 画布出现图片，文件落盘 |
| 3 | `upload_image(imageUrl=产物URL)` | 返回 `filename` |
| 4 | `image_generate(prompt=..., filename=...)` | 图生图产物落盘 |
| 5 | `image2vl(filename=..., prompt="描述画面")` | 返回画面分析文本 |
| 6 | `character_sheet(filename=设计图, name="女主", lockedPrompt=...)` | 返回 `assetId` + 拼图 filename，`list_references` 的 `assets` 可见 |
| 7 | `qc_shot(filename=镜头图, shotRefs=["分镜 1 · 特写"])` | 返回 PASS/FAIL/WARN，结论写回节点 |
| 8 | `video_generate(prompt=..., filename=首帧图)` | 视频落盘可播放，端点命中 `image2videofl2va` |
| 9 | `video_composite(prompt=..., filenames=[3 张])` | 端点命中 `image2videoref2va` |
| 10 | `music_generation(prompt=..., duration=成片时长)` | mp3 落盘，`nodeId` 可作 `bgmNodeId` |
| 11 | `compose_video(clipIds=[...], bgmNodeId=...)` | 成片落盘，`audioComposition` 如实回报 |
| 12 | `list_shots` → `compose_video(replaces/… )` | 旧版自动失效、不进默认合成 |

> 真机验收（阶段 7）尚未完成：`music_generation` 与 `compose_video` 的「产物不再被 schema 丢弃」
> 需要在真实后端跑一次确认，`txt2audio` 的后端可用性至今未被真正验证过。
