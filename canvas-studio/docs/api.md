# Drama Backend API 文档

**版本:** 0.2.9  
**最近修订:** 2026-09-10（后端更新：上传端点统一为 `POST /api/v1/generate/upload`，旧 `uploadimage` 已下线）

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
>   CV-136 起本仓视频**只发 16:9 / 9:16 两档**，不再有 1:1 降级一说）。
> - **响应 `duration` 字段语义存疑**：示例中请求 `duration=5` 而响应 `duration=8.50`，
>   与 txt2audio 的「该字段是生成耗时而非产物时长」同型 → **不可当作视频长度消费**，待实测。
> - 我们的发送端（`providers/drama.ts`）早已落 `audio1..audio3`，字段名与本次后端更新**完全一致**；
>   当前唯一的落差点是图片上限仍按 6 张截断（见 STATUS.md CV-134）。

> **0.2.7 修订说明**
> - **视频生成多供应商**：`video_generate` / `video_composite` 新增 `provider` 参数（枚举 `drama` / `fal`），用于选择后端链路。留空则走设置页「默认视频供应商」（默认 `drama`）；重试节点时自动沿用该片原供应商，不会串台。
> - `drama` 供应商即本文档既有的 Drama Backend（FL2VA）链路；`fal` 供应商为 MiniMax H3 队列（`minimax/h3/*`），其端点、参数映射与钳制规则见 [`docs/plans/video-provider-abstraction.md`](./plans/video-provider-abstraction.md)（本文档不重复描述 fal 端点）。
> - **`resolution` 占坑状态修正**：此前标记为「传了也忽略」的 `resolution`，在 `fal` 供应商下已生效（720p/1080p 会升档至 768P/2K 并提示费用更高）；仅 `drama` 供应商仍忽略。详见下方 [待接入参数](#待接入参数占坑已声明未生效)。
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
- [风格迁移](#风格迁移)
- [文件上传（唯一上传端点）](#文件上传唯一上传端点)
- [图像查看](#图像查看)
- [分镜生成](#分镜生成)
- [图像分割网格](#图像分割网格)
- [图像修复](#图像修复)
- [视觉语言模型](#视觉语言模型)
- [图像转视频](#图像转视频)
- [错误响应](#错误响应)

---

## canvas-studio 工具清单与实现状态

插件当前在 Host 侧注册 **20 个工具**（`canvas-studio/src/host-tools.ts` 的 `createStudioTools` + `src/skills/placeholder-tools.ts` 的 `createPlaceholderTools`）。其中 **15 个完整实现**（真实调用 Drama Backend 或本地能力），**2 个暂不可用**（功能代码保留，调用时抛错），**3 个占坑**（不调用任何后端，仅返回能力边界与替代路径）。

### 完整实现（15 个）

| 工具 | 用途 | 后端端点 / 实现位置 |
| --- | --- | --- |
| `image_generate` | 文生图 / 图生图（单参考 / 多参考融合）；`style=realistic`（默认，写实）/ `anime`（卡通）双画风 | `txt2image`（写实文生）/ `image2image`（写实图生）/ `txt2imageanime`（卡通文生） |
| `character_generate` | 角色设计图 → 角色立绘三视图（正/侧/背等多视角） | `image2character` |
| `video_generate` | 文生视频 / 首帧图生视频；含 `provider`（供应商选择，**已生效**：`drama`/`fal`）+ 3 个【占坑·待接入】参数 `model` / `resolution` / `generateAudio`（见下方说明） | `image2videofl2va`（drama）/ `minimax/h3/*`（fal） |
| `video_composite` | 多图合成视频（2 张首尾帧插值 / ≥3 张多参考 REF2VA）；同样含 `provider`（已生效）+ 3 个【占坑·待接入】参数 | `image2videofl2va` / `image2videoref2va`（drama）/ `minimax/h3/*`（fal） |
| `storyboard_generate` | 文本 → 格子分镜图 | `image2storyboard` |
| `storyboard_split` | 格子分镜图 → 逐镜单图（4/6/9 格拆分） | `image2splitegrid` |
| `prompt_enhance` | 提示词增强 | `image2promptenhance` |
| `image2vl` | 画面分析（视觉语言模型） | `image2vl` |
| `upload_image` | 上传图片到 Drama Backend 拿 `filename` | `upload`（统一上传端点，见 [文件上传](#post-apiv1generateupload唯一上传端点)） |
| `list_references` | 列出当前项目参考图（角色/风格/首帧）与画布文本节点 | 本地项目注册表（无后端调用） |
| `compose_video` | 拼接时间轴已有视频片段成成片（可混 BGM / 挂文案） | Host 本地 ffmpeg concat（`src/compose.ts`） |
| `write_script` | 产出结构化文案（对白/字幕/BGM/SFX）落到「文案」节点 | 本地画布落盘（无后端调用） |
| `submit_storyboard_for_approval` | 分镜表提交审批（逐步确认模式门禁） | 本地工作流状态机（无后端调用） |
| `submit_keyframes_for_approval` | 关键帧提交确认（逐步确认模式门禁） | 本地工作流状态机（无后端调用） |
| `ask_user_choice` | 点选式提问（需求澄清五要素） | 本地交互阻塞（无后端调用） |

### 暂不可用（2 个，功能代码保留，调用时抛错）

| 工具 | 用途 | 后端端点 / 替代方案 |
| --- | --- | --- |
| `inpaint` | 图像修复 / 编辑（移除元素、智能填充、添加元素） | `image2inpaint`（端点保留）；图像编辑需求暂缓或改用 `image_generate` 传参考图 |
| `style_transfer` | 风格迁移（image2 风格套到 image1 上） | `image2styletransfer`（端点保留）；风格统一改用 `image_generate` 图生图或 `character_generate` |

> 恢复方式：把工具名从 `host-tools.ts` 顶部的 `DISABLED_TOOLS` 集合中移出即可，后端端点与 `generate.ts` 分支无需改动。

### 占坑（3 个，仅返回降级指引）

| 工具 | 用途 | 降级路径 |
| --- | --- | --- |
| `music_generation` | BGM 生成（上游 MiniMax-H3 skill STEP 8 要求）；**上游 skill 中出现的 `music-2.6` 即本占位工具的别名** | 引导用户上传 BGM 节点 → `compose_video` 传 `bgmNodeId`；或写进 H3 提示词 `non_diegetic_music` 字段 |
| `tts_voiceover` | 旁白 / 对白 TTS 配音 | 用 `write_script` 落「文案」节点（不生成音频）；H3 提示词用 `says in an off-screen voiceover` 处理离屏旁白 |
| `subtitle_burn` | 硬字幕烧录进画面 | 用 `write_script` 落「文案」节点（仅成片详情展示）；画面内文字写进 H3 提示词画面描述 |

> 三个占位工具存在的意义：让 agent 能完整跑完上游 MiniMax-H3 原版 skill 流程而不因「tool not found」中断；每个占位工具都返回可操作的中文替代路径。它们**不调用任何 Drama Backend 端点**。

### 待接入参数（占坑，已声明未生效）

`video_generate` / `video_composite` 除上述既有参数外，另携带以下参数。其中 `provider` 已生效，其余 3 个为**占坑预留**（当前 `drama` 后端统一走 FL2VA/H3 技术路线，暂不支持模型切换、分辨率指定与原生音频轨；`fal` 供应商仅真实消费 `resolution`）：

| 参数 | 取值 | 当前行为 |
| --- | --- | --- |
| `provider` | `drama`（默认）/ `fal` | **已生效**：选择视频后端链路。留空走设置页「默认视频供应商」；重试节点自动沿用原供应商。详见 [`docs/plans/video-provider-abstraction.md`](./plans/video-provider-abstraction.md) |
| `model` | `h3`（默认）/ `seedance2` | 占坑：传 `seedance2` 时工具结果附加「暂未接入」提示，仍按 h3（FL2VA）生成 |
| `resolution` | `768p` / `1080p` / `720p` / `2k` | **`fal` 供应商已生效**（720p→768P、1080p→2K 升档并提示费用更高）；`drama` 供应商仍忽略，以 `aspectRatio` 与后端默认分辨率输出并附提示 |
| `generateAudio` | `true` / `false` | 占坑：传 `true` 时附提示，成片仍无原生音频轨 |

> 设计意图：对应上游 3d-animation-short-generator 的「视频模型选项卡（H3/Seedance）」与「分辨率选项卡」、brand-promo-video-generator 的 `generate_audio=true`。**agent 不应向用户提问「H3 还是 Seedance」**（选项未生效），应按默认执行；亦**不应主动向用户询问用哪个供应商**——除非用户明确要求切换，否则用设置页默认值。恢复方式：后端支持对应参数后，在 `generate.ts` 的视频分支把字段透传进 FL2VA 请求体即可，工具层无需改动。

> 后端连通性备注：2026-08-31 当日 `117.50.108.73:8082` 全程 Connection refused（早前被 1.6MB 上传打挂后未恢复），FL2VA 参数能力未能实跑探测——上述占坑标记基于现有端点约定（`aspect`/`megapixels`/`duration`）推断，待后端恢复后需实测校准。

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

- **同步**：`scripts/sync-minimax-skills.mjs` 从 `minimax-h3` submodule **逐字节复制**（脚本内 `ENABLED` 集合控制范围），随后合并 `skills-local/` 自研 bundle（如 `canvas-studio-creation` 总纲），构建链第一步执行；`skills/**` 随包发布（`package.json` 的 `files`）。目录成员即注册范围。
- **注册**：`src/skills/minimax-skills.ts` 启动时扫描 `skills/` 逐个注册：`content` = SKILL.md 正文（剥离 frontmatter，description 取 frontmatter 并截断 500 字符），并设 `resourceBase: { kind: 'directory', path: skills/<name> }`。
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
    "filename": "z-image_00039_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=z-image_00039_.png",
    "duration": 3.63
}
```

**说明:**
- 使用 nunchaku-z-image-turbo 工作流生成图像
- steps 参数固定为 8
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
- 使用动漫风格模型生成图像，基于 z-anime-aio 工作流
- 适用于生成日式动漫风格的角色和场景
- 这是**卡通 / 日式动漫模式**生图（canvas-studio 工具 `image_generate` 的 `style='anime'`）；**仅支持纯文生图**，无对应的图生图变体（要参考已有图做动漫风时改回写实模式）。

### POST /api/v1/generate/image2image

基于参考图像生成新图像

**请求体 (Image2ImageRequest):**

| 字段 | 类型 | 必填 | 默认值 | 描述 |
|------|------|------|--------|------|
| `prompt` | string | 是 | - | 场景描述（从脚本内容派生） |
| `width` | integer | 否 | 1024 | 图像宽度 |
| `height` | integer | 否 | 768 | 图像高度 |
| `image1` | string | 否 | "" | 参考图像1（文件名） |
| `image2` | string | 否 | "" | 参考图像2（文件名） |
| `image3` | string | 否 | "" | 参考图像3（文件名） |

**请求示例:**
```json
{
  "prompt": "Transform this landscape to autumn style",
  "width": 1024,
  "height": 768,
  "image1": "image1.png"
}
```

**响应:** 返回生成的图像数据

**响应示例:**
```json
{
    "prompt_id": "1e315014-43e3-4140-bbf3-ef1a1119705e",
    "filename": "z-image_00039_.png",
    "full_url": "http://117.50.108.73:8082/view?filename=z-image_00039_.png",
    "duration": 3.63
}
```

**说明:**
- 使用 qwen_image_edit_3_image_ref 工作流生成图像
- steps 参数固定为 4
- 支持最多3张参考图像（image1, image2, image3）

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

基于角色设计图生成角色立绘图（三视图）

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
    "filename": "dramma_character_visual_image.png",
    "full_url": "http://117.50.108.73:8082/view?filename=dramma_character_visual_image.png",
    "duration": 3.63
}
```

**说明:** 
- 该接口将根据输入的角色设计图生成四视图立绘图，使用 qwen_4view_char_2step 工作流
- 包含正面特写、侧面全身、背面全身等多个视角
- 背景为纯白色

---

## 风格迁移

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
            "url": "http://100.90.169.105:8081/view?filename=splitegrid_img_1716656698_00001_.png"
        },
        {
            "filename": "splitegrid_img_1716656698_00002_.png",
            "url": "http://100.90.169.105:8081/view?filename=splitegrid_img_1716656698_00002_.png"
        },
        {
            "filename": "splitegrid_img_1716656698_00003_.png",
            "url": "http://100.90.169.105:8081/view?filename=splitegrid_img_1716656698_00003_.png"
        },
        {
            "filename": "splitegrid_img_1716656698_00004_.png",
            "url": "http://100.90.169.105:8081/view?filename=splitegrid_img_1716656698_00004_.png"
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
| `aspect` | string | 否 | "16:9" | 画面比，可选 `adaptive` / `16:9` / `4:3` / `21:9`（⚠️ **0.2.8 起不再列 `9:16`**，竖屏改用 `adaptive`；见下方待确认） |
| `megapixels` | number | 否 | 0.4 | 视频清晰度（百万像素） |
| `duration` | integer | 否 | 5 | 视频时长（秒） |
| `image1` … `image9` | string | 否 | "" | **参考图（≤9 张）**：定义「参考什么」——角色 / 场景 / 产品 / 风格；**不决定首帧** |
| `video1` … `video3` | string | 否 | "" | **参考视频（≤3 段）**：定义「参考怎么动」——动作、运镜、节奏、转场；**画面不会被复制进成片** |
| `audio1` … `audio3` | string | 否 | "" | **参考音频（≤3 段）**：定义「参考听什么」——节奏 / 情绪 / 音色；**仅作参考，不直接拼接成音轨** |
| — | — | — | — | **参考文件总数 ≤12**（图 + 视频 + 音频合计），超出请求报错 |

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
- **文件总数 ≤12**（image ≤9 + video ≤3 + audio ≤3 合计）
- 输出 **24fps**（与我们的实测一致）
- ⚠️ **待确认 1（aspect）**：0.2.8 的枚举里去掉了 `9:16`。我们发送端（`providers/drama.ts:37`
  `dramaAspect`）在竖屏时仍硬传 `'9:16'` → **可能被拒或静默落回横屏**，需实测确认竖屏应改传什么
- ⚠️ **待确认 2（响应 `duration`）**：示例请求 `duration=5` 而响应 `duration=8.50`，
  与 txt2audio 的「该字段是**生成耗时**而非产物时长」同型 → **不要当作视频长度消费**，
  真实时长仍应本地 ffprobe（正是 av-timeline-plan.md 的 P0）
- **实测记录（2026-09-02）**：经 canvas-studio `video_composite` 双参考（定妆照+场景概念图）端到端出片成功（1280x720, 8s，prompt 为 H3 六段式全参考格式）——端点可用性已验证，见 `docs/effect-tests/` 轮次记录 R001/T1

---

## 错误响应

所有端点可能返回以下错误状态码：

| 状态码 | 描述 |
|--------|------|
| 400 | 请求参数错误 |
| 500 | 服务器内部错误 |
| 502 | Drama Backend 服务不可用 |

---
