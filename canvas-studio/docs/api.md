# Drama Backend API 文档

**版本:** 0.2.6  
**最近修订:** 2026-09-01（skill 体系目录化重构：verbatim 同步 h3 目录 + resourceBase 渐进披露，移除内联生成物）

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

> **0.2.1 修订说明**
> - `POST /api/v1/generate/uploadimage`：修正响应示例为实测结构（`{name, subfolder, type}`，非 `{success, filename}`）。
> - `POST /api/v1/generate/upload`：端点已移出文档。实测任何调用方式均返回 500，成功响应从未出现。
> - 依据：`docs/plans/api-upload-test-report.md`（2026-08-31 对 `http://117.50.108.73:8082` 的直连实测）。

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
- [图像上传](#图像上传)
- [流式文件上传（已移除）](#流式文件上传已移除)
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
| `video_generate` | 文生视频 / 首帧图生视频；含 3 个【占坑·待接入】参数 `model` / `resolution` / `generateAudio`（见下方说明） | `image2videofl2va` |
| `video_composite` | 多图合成视频（2 张首尾帧插值 / ≥3 张多参考 REF2VA）；同样含 3 个【占坑·待接入】参数 | `image2videofl2va` / `image2videoref2va` |
| `storyboard_generate` | 文本 → 格子分镜图 | `image2storyboard` |
| `storyboard_split` | 格子分镜图 → 逐镜单图（4/6/9 格拆分） | `image2splitegrid` |
| `prompt_enhance` | 提示词增强 | `image2promptenhance` |
| `image2vl` | 画面分析（视觉语言模型） | `image2vl` |
| `upload_image` | 上传图片到 Drama Backend 拿 `filename` | `uploadimage` |
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

`video_generate` / `video_composite` 携带以下 3 个参数，均为**占坑预留**——当前后端统一走 FL2VA（H3 技术路线），暂不支持模型切换、分辨率指定与原生音频轨：

| 参数 | 取值 | 当前行为 |
| --- | --- | --- |
| `model` | `h3`（默认）/ `seedance2` | 传 `seedance2` 时工具结果附加「暂未接入」提示，仍按 h3（FL2VA）生成 |
| `resolution` | `768p` / `1080p` / `720p` / `2k` | 传入被忽略，以 `aspectRatio` 与后端默认分辨率输出，附提示 |
| `generateAudio` | `true` / `false` | 传 `true` 时附提示，成片仍无原生音频轨 |

> 设计意图：对应上游 3d-animation-short-generator 的「视频模型选项卡（H3/Seedance）」与「分辨率选项卡」、brand-promo-video-generator 的 `generate_audio=true`。**agent 不应向用户提问「H3 还是 Seedance」**（选项未生效），应按默认执行。恢复方式：后端支持对应参数后，在 `generate.ts` 的视频分支把字段透传进 FL2VA 请求体即可，工具层无需改动。

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

## 图像上传

### POST /api/v1/generate/uploadimage

上传图像到 Drama Backend 服务器

**请求体:**
采用form-data形式(不要填Content-Type)

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `file` | binary | 是 | 要上传的图像文件 |

**响应示例:**
```json
{
  "name": "small.png",
  "subfolder": "",
  "type": "input"
}
```

**响应字段:**

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | **服务端保存的文件名**。下游工具（image2image / fl2va 等）所需的 `image` 参数即取此值。 |
| `subfolder` | string | 子目录，实测恒为空串 |
| `type` | string | 固定为 `input` |

> ⚠️ **注意**：这是 ComfyUI `UploadImage` 节点的原生返回结构，**没有** `success` 字段，文件名键名是 `name` 而不是 `filename`。
> 按旧文档写 `resp.filename` 会拿到 `undefined`。

**说明:**
- 实测（2026-08-31）：3KB 图片耗时约 0.1s；1.6MB 图片耗时约 **14s**——超过 1MB 会触发 Starlette
  自动溢写磁盘，耗时陡增。建议上传前先把图片压到 1MB 以内。
- 大文件没有可用的替代端点：`/api/v1/generate/upload` 已确认不可用（见下节）。

---

## 流式文件上传（已移除）

### ~~POST /api/v1/generate/upload~~ ❌ 不可用，已从可用接口清单移除

> **2026-08-31 移除。** 实测该端点对任何请求形态均返回 `500`，文档所述的
> `{"status":"success"}` 从未出现。不要在新代码中调用它。

**实测证据：**

| 请求形态 | 结果 |
|------|------|
| form-data，字段名 `file` | `500` |
| form-data，字段名 `image` | `500` |
| form-data，字段名 `filename` | `500` |
| raw body `Content-Type: application/octet-stream` | `500` |
| raw body `Content-Type: image/png` | `500` |
| **空 body** | `500` |
| `GET`（方法探测） | `405 Method Not Allowed` |

空 body 也返回 500，说明请求未走到参数校验阶段，异常在流读取最开始即抛出——**不是调用姿势问题，是端点本身坏了**。
`GET` 返回 405 仅证明路由已注册。

**影响与替代方案：**
- 所有上传场景统一走 `/api/v1/generate/uploadimage`。
- 超过 1MB 的大文件：**在客户端先压缩再传**，不要指望这个端点绕开溢写。
- 若后端后续修复该端点，需补充：入参契约、成功响应结构、以及下游如何拿到文件名（原文档从未说明）。

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
| `aspect` | string | 否 | "16:9" | 画面比例，可选 16:9 或 9:16 |
| `megapixels` | number | 否 | 0.4 | 视频清晰度（百万像素） |
| `duration` | integer | 否 | 5 | 视频时长（秒） |
| `image1` | string | 否 | "" | 参考图像1（文件名） |
| `image2` | string | 否 | "" | 参考图像2（文件名） |
| `image3` | string | 否 | "" | 参考图像3（文件名） |
| `image4` | string | 否 | "" | 参考图像4（文件名） |
| `image5` | string | 否 | "" | 参考图像5（文件名） |
| `image6` | string | 否 | "" | 参考图像6（文件名） |

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
- 该端点基于多张参考图像生成视频，使用 h3_i2v_ref2va.json 工作流
- `aspect` 支持 16:9 与 9:16，默认横屏 16:9
- 支持最多6张参考图像（image1-image6）
- 适用于需要多参考图像保持角色和场景一致性的视频生成
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
