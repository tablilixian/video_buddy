# Canvas Studio 媒体生成工具文档

> 约定：`canvas-studio/src/` 为源码，`lib/` 为编译产物。
> 后端 API 基址：`http://117.50.108.73:8082`（可被 `CANVAS_STUDIO_DRAMA_API_BASE` 环境变量覆盖）。

---

## 目录

- [核心规则：所有图片必须先上传](#核心规则所有图片必须先上传)
- [工具总览](#工具总览)
- [工具详情](#工具详情)
- [公共输出 schema](#公共输出-schema)
- [跨工具串联：完整流程](#跨工具串联完整流程)
- [已修复问题清单](#已修复问题清单)
- [验证清单](#验证清单)

---

## 核心规则：所有图片必须先上传

**所有需要图片作为输入的工具，都只能接受 `filename`（已上传到 Drama Backend 的服务器文件名），不能直接传图片 URL。必须遵循以下步骤：**

1. 用 `image_generate` 生图 → 得到图片 URL
2. 用 `upload_image` 上传到 Drama Backend → 得到服务器文件名
3. 用 `filename` 传给下游工具

---

## 工具总览

当前完整工具集（共 **9 个工具**）：

| 工具名 | 产物类型 | 注册模块 | 执行模块 | 对应后端端点 |
|--------|---------|---------|---------|------------|
| `prompt_enhance` | text | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L183-L204) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L129-L136) | `image2promptenhance` |
| `image_generate` | image | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L100-L120) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L218-L242) | `txt2image` / `image2image` |
| `upload_image` | filename | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L121-L144) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L60-L82) | `uploadimage` |
| `image2vl` | text | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L206-L229) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L138-L151) | `image2vl` |
| `style_transfer` | image | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L231-L253) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L281-L294) | `image2styletransfer` |
| `storyboard_generate` | image | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L255-L273) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L295-L305) | `image2storyboard` |
| `deduction` | text | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L275-L305) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L153-L168) | `deduction` |
| `video_generate` | video | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L145-L162) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L243-L256) | `image2videomsr` |
| `video_composite` | video | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L164-L181) | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L257-L280) | `image2videomkr` |

注册入口：[`index.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/index.ts#L24-L27) `ctx.tools.register`。

---

## 工具详情

### 工具 1: `prompt_enhance`

**功能**：增强提示词，使生成的图像/视频质量更高。

**参数列表**：

| 参数名 | 类型 | 必填 | 描述 |
|-------|------|------|------|
| `prompt` | string | 是 | 原始提示词 |

**输出**：
```json
{
  "text": "增强后的提示词..."
}
```

---

### 工具 2: `image_generate`

**功能**：根据提示词生成一张图片。如果传入 `filename`，则基于该参考图进行图生图。

**参数列表**：

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
|-------|------|------|--------|------|
| `prompt` | string | 是 | - | 生成提示词 |
| `aspectRatio` | string | 否 | `"16:9"` | 宽高比，可选 `"16:9"` / `"9:16"` / `"1:1"` |
| `filename` | string | 否 | - | 可选参考图：已上传的 Drama Backend 文件名（来自 `upload_image`，用于图生图） |
| `negativePrompt` | string | 否 | - | 反向提示词 |

**后端映射**：

**文生图（无参考图）** → `POST /api/v1/generate/txt2image`

| 请求字段 | 值来源 | 类型 | 说明 |
|---------|--------|------|------|
| `prompt` | `params.prompt` | string | 必填 |
| `width` | `sizeForAspectRatio(params.aspectRatio).width` | integer | 1280/720/1024 |
| `height` | `sizeForAspectRatio(params.aspectRatio).height` | integer | 720/1280/1024 |
| `negative_prompt` | `params.negativePrompt` | string | API 允许，文档未列出 |

**图生图（有参考图）** → `POST /api/v1/generate/image2image`

| 请求字段 | 值来源 | 类型 | 说明 |
|---------|--------|------|------|
| `prompt` | `params.prompt` | string | 必填 |
| `width` | `sizeForAspectRatio(params.aspectRatio).width` | integer | - |
| `height` | `sizeForAspectRatio(params.aspectRatio).height` | integer | - |
| `image1` | `params.filename` | string | 参考图文件名（已上传） |
| `negative_prompt` | `params.negativePrompt` | string | API 允许，文档未列出 |

> 注：API 支持 `image1`~`image3` 三张参考图，当前代码仅实现一张。如需多张可后续扩展。

**输出**：
```json
{
  "url": "/canvas-studio/assets/<projectId>/<uuid>.png",
  "width": 1280,
  "height": 720
}
```

---

### 工具 3: `upload_image`

**功能**：将图片上传到 Drama Backend 服务器，返回服务器上的文件名。所有需要图片作为输入的工具都必须先使用本工具上传图片，拿到服务器文件名后再传入。

**参数列表**：

| 参数名 | 类型 | 必填 | 描述 |
|-------|------|------|------|
| `imageUrl` | string | 是 | 图片 URL（通常是 `image_generate` 的产物 URL，相对 URL 会自动补全为绝对 URL） |

**上传流程**：
1. `upload_image` 先把来源解析为字节：
   - **canvas-studio 资产 URL**（含 `/canvas-studio/assets/<projectId>/<file>`，带不带 `http://127.0.0.1:<port>` 前缀均可）：host 进程本就有权直读磁盘，直接 `registry.assetsDir(projectId)/<file>` 读盘——**绕过本地 webServer 对 loopback 请求返回的 403**（Electron 安全限制，浏览器同源请求才正常）。
   - 本地绝对路径 / `file://`：直接读盘。
   - 其它 URL（外部托管）：补全 loopback 端口后 `fetch` 下载。
2. 以 `FormData` 形式 `POST` 到 `/api/v1/generate/uploadimage`（`file` 字段）
3. 解析响应，提取 `filename`（兼容 `{ filename }` / `{ name }` / `{ data: { filename } }` 多种格式）
4. 返回 `filename` 供下游工具使用

**输出**：
```json
{
  "filename": "reference (xxx).png"
}
```

---

### 工具 4: `image2vl`

**功能**：分析一张图片的内容，返回详细的画面描述。必须提供 `filename`。

**参数列表**：

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
|-------|------|------|--------|------|
| `filename` | string | 是 | - | 已上传的 Drama Backend 文件名（来自 `upload_image`） |
| `prompt` | string | 是 | - | 分析提示词，描述需要分析的内容 |
| `systemPrompt` | string | 否 | "你是一个专业的影视镜头分析师..." | 系统提示词 |

**后端映射** → `POST /api/v1/generate/image2vl`

| 请求字段 | 值来源 |
|---------|--------|
| `image` | `params.filename` |
| `prompt` | `params.prompt` |
| `system_prompt` | `params.systemPrompt` |

**输出**：
```json
{
  "text": "画面分析结果..."
}
```

---

### 工具 5: `style_transfer`

**功能**：将一张图片的风格迁移到另一张图片上。必须提供两个已上传的文件名。

**参数列表**：

| 参数名 | 类型 | 必填 | 描述 |
|-------|------|------|------|
| `filename` | string | 是 | 目标图：已上传的 Drama Backend 文件名（需要改变风格的图片） |
| `styleFilename` | string | 是 | 风格参考图：已上传的 Drama Backend 文件名（提供风格参考的图片） |
| `prompt` | string | 否 | 增强提示词，描述期望的风格效果 |
| `enhance` | boolean | 否 | 是否增强风格迁移效果 |
| `aspectRatio` | string | 否 | `"16:9"` | 宽高比 |

**后端映射** → `POST /api/v1/generate/image2styletransfer`

| 请求字段 | 值来源 |
|---------|--------|
| `image1` | `params.filename`（目标图） |
| `image2` | `params.styleFilename`（风格参考图） |
| `prompt` | `params.prompt` |
| `enhance` | `params.enhance` |

**输出**：同 `image_generate` → 图片 URL 与尺寸。

---

### 工具 6: `storyboard_generate`

**功能**：根据文本描述生成分镜图像（格子分镜）。每行描述一个分镜场景。可传入参考图。

**参数列表**：

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
|-------|------|------|--------|------|
| `prompt` | string | 是 | - | 场景描述，每行描述一个分镜场景 |
| `gridnum` | number | 否 | `4` | 分镜格子数量 |
| `filename` | string | 否 | - | 可选参考图：已上传的 Drama Backend 文件名 |
| `aspectRatio` | string | 否 | `"16:9"` | 宽高比 |

**后端映射** → `POST /api/v1/generate/image2storyboard`

| 请求字段 | 值来源 |
|---------|--------|
| `prompt` | `params.prompt` |
| `gridnum` | `params.gridnum` |
| `image` | `params.filename` |
| `width` | 计算后宽度 |

**输出**：同 `image_generate` → 分镜图 URL 与尺寸。

---

### 工具 7: `deduction`

**功能**：剧情推演：基于当前帧画面分析 + 剧情方向，推演下一帧的构图描述和关键要素。必须提供 `filename`。

**参数列表**：

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
|-------|------|------|--------|------|
| `filename` | string | 是 | - | 当前帧图片：已上传的 Drama Backend 文件名 |
| `analysisPrompt` | string | 否 | 默认提示词 | VLM 画面分析提示词 |
| `deductionPrompt` | string | 否 | 默认提示词 | 剧情推演提示词 |
| `analysisSystemPrompt` | string | 否 | 默认提示词 | VLM 画面分析系统提示词 |
| `deductionSystemPrompt` | string | 否 | 默认提示词 | 剧情推演系统提示词 |

**后端映射** → `POST /api/v1/generate/deduction`

**输出**：
```json
{
  "analysis": "画面分析结果(JSON)",
  "deduction": "剧情推演结果(JSON)"
}
```

---

### 工具 8: `video_generate`

**功能**：根据提示词与一张参考图生成视频（图生视频，MSR 算法）。**必须提供 `filename`**（`upload_image` 返回的 Drama Backend 文件名）。

**参数列表**：

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
|-------|------|------|--------|------|
| `prompt` | string | 是 | - | 生成提示词 |
| `filename` | string | 是 | - | 已上传的 Drama Backend 文件名（来自 `upload_image`） |
| `aspectRatio` | string | 否 | `"16:9"` | 宽高比 |
| `duration` | number | 否 | `5` | 视频时长（秒） |

**后端映射** → `POST /api/v1/generate/image2videomsr`

| 请求字段 | 值来源 | 类型 | 必填 | 说明 |
|---------|--------|------|------|------|
| `prompt` | `params.prompt` | string | 是 | |
| `width` | 计算后宽度 | integer | 否 | |
| `height` | 计算后高度 | integer | 否 | |
| `duration` | `params.duration ?? 5` | integer | 否 | |
| `fps` | `30`（硬编码） | integer | 否 | |
| `image1` | `params.filename` | string | 是 | 主参考图（API 文档要求必填 image1） |
| `background` | `params.filename` | string | - | 同一张图作为 background（兼容当前实现） |

> 注：API 支持 `image1`~`image4` 四张参考图，当前仅传递一张。后续可扩展参数支持多张。

**输出**：
```json
{
  "url": "/canvas-studio/assets/<projectId>/<uuid>.mp4",
  "width": 1280,
  "height": 720,
  "duration": 5
}
```

---

### 工具 9: `video_composite`

**功能**：将多张参考图合成一段视频，首尾帧插值（MKR 算法）。**必须提供 `filenames`**（`upload_image` 返回的 Drama Backend 文件名数组）。

**参数列表**：

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
|-------|------|------|--------|------|
| `prompt` | string | 是 | - | 生成提示词 |
| `filenames` | string[] | 是 | - | 已上传的 Drama Backend 文件名数组（来自 `upload_image`） |
| `aspectRatio` | string | 否 | `"16:9"` | 宽高比 |
| `duration` | number | 否 | `12` | 视频时长（秒） |

**后端映射** → `POST /api/v1/generate/image2videomkr`

| 请求字段 | 值来源 | 类型 | 说明 |
|---------|--------|------|------|
| `prompt` | `params.prompt` | string | |
| `width` | 计算后宽度 | integer | |
| `height` | 计算后高度 | integer | |
| `duration` | `params.duration ?? 12` | integer | |
| `fps` | `30`（硬编码） | integer | |
| `images` | `buildImageFrames(params.filenames)` | array | 按时间轴均分帧位置 |

**`images` 数组 `frame_index` 计算规则**：
```typescript
const totalFrames = (params.duration ?? 12) * 30  // 总帧数 = 时长 × fps
const images = filenames.map((image, index) => ({
  image,
  // 最后一张用 -1 标记（API 文档约定表示结束）
  frame_index: index === filenames.length - 1
    ? -1
    : Math.round((index / (filenames.length - 1)) * totalFrames),
}))
```

**输出**：
```json
{
  "url": "/canvas-studio/assets/<projectId>/<uuid>.mp4",
  "width": 1280,
  "height": 720,
  "duration": 12
}
```

---

## 公共输出 schema

除 `upload_image`/`prompt_enhance`/`image2vl`/`deduction` 外，图像/视频产物共用同一个 [`resultSchema`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L17-L26)：

 ```typescript
{
  type: 'object',
  properties: {
    url:      { type: 'string',  description: '产物托管 URL，可在画布中直接引用' },
    width:    { type: 'integer', description: '宽度（像素）' },
    height:   { type: 'integer', description: '高度（像素）' },
    duration: { type: 'number',  description: '视频时长（秒）；图片无此项' },
    filename: { type: 'string',  description: 'Drama Backend 服务器文件名（图片类产物；供下游 image_generate / video_generate / video_composite / storyboard_split 以 filename 链式引用）' },
  },
}
```

### 渲染回模型

工具执行后，返回结果被渲染为文本块供模型阅读：

```text
已生成产物: /canvas-studio/assets/<projectId>/<uuid>.png (1280x720), Drama 文件名: z-image_xxx_.png
已生成产物: /canvas-studio/assets/<projectId>/<uuid>.mp4 (1280x720, 5s)
已上传到 Drama Backend: reference (xxx).png
```

---

## 跨工具串联：完整流程

### 标准图生视频（3 步）

```
Step 1: image_generate(prompt="一只小猫在草地上奔跑", aspectRatio="16:9")
  → 生成图片 → 落盘 → 返回产物 URL: /canvas-studio/assets/p1/xxx.png

Step 2: upload_image(imageUrl=/canvas-studio/assets/p1/xxx.png)
  → 自动下载图片 → 上传到 Drama Backend → 返回服务器文件名: "reference (xxx).png"

Step 3: video_generate(prompt="一只小猫在草地上奔跑，四蹄交替，尾巴翘起",
                filename="reference (xxx).png", duration=5)
  → 使用 filename 调用 image2videomsr → 生成视频 → 落盘 → 返回视频 URL
```

### 多图合成视频（4+ 步）

```
Step 1: image_generate(prompt="场景一：村庄入口", aspectRatio="16:9") → URL1
Step 2: image_generate(prompt="场景二：村中小路", aspectRatio="16:9") → URL2
Step 3: image_generate(prompt="场景三：村口大树", aspectRatio="16:9") → URL3

Step 4: upload_image(imageUrl=URL1) → filename1
        upload_image(imageUrl=URL2) → filename2
        upload_image(imageUrl=URL3) → filename3
  (可并行上传)

Step 5: video_composite(prompt="镜头从村庄入口慢慢推进，经过小路，停在大树下",
                 filenames=[filename1, filename2, filename3], duration=10)
  → 自动计算 frame_index → 调用 image2videomkr → 合成视频
```

### 完整电影级工作流（8+ 步）

```
# 阶段一：创意策划
Step 1: prompt_enhance(prompt="原始创意描述") → 增强后的提示词

# 阶段二：分镜规划
Step 2: storyboard_generate(prompt="分镜1\n分镜2\n分镜3\n分镜4", gridnum=4) → 分镜图 URL

# 阶段三：参考图生成
Step 3: image_generate(prompt=增强后的提示词, aspectRatio="16:9") → 主图 URL

# 阶段四：上传参考图
Step 4: upload_image(imageUrl=主图URL) → 文件名1

# 阶段五：风格统一（可选）
Step 5: image_generate(prompt="水墨风格", filename=文件名1, aspectRatio="16:9") → URL2
Step 6: upload_image(imageUrl=URL2) → 文件名2

# 阶段六：画面分析（可选）
Step 7: image2vl(filename=文件名2, prompt="分析画面内容") → 画面分析文本

# 阶段七：剧情推演（可选，多帧场景）
Step 8: deduction(filename=文件名2) → 推演下一帧描述

# 阶段八：视频生成
Step 9: video_generate(prompt=最终prompt, filename=文件名2, duration=5) → 视频 URL
```

---

## 已修复问题清单

| # | 问题 | 修复状态 | 修复位置 |
|---|------|---------|---------|
| 1 | **图片参数规范**：所有需要图片输入的工具必须使用 `filename`，移除 `imageUrl`/`imageUrls` 参数 | ✅ 已修复 | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L20-L40), [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts#L100-L306) |
| 2 | **相对 URL 自动解析**：`upload_image` 接受相对 URL，内部自动补全为绝对 URL（利用传入的 `port`） | ✅ 已修复 | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L56-L58) |
| 3 | **`video_composite` 的 `frame_index` 算法**：改为按时间轴均分（`duration × fps`），而非数组下标 | ✅ 已修复 | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L260-L268) |
| 4 | **`video_generate` API 参数**：使用 `image1` 字段传递主参考图（符合 API 文档要求），`background` 传同一张图 | ✅ 已修复 | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L251-L253) |
| 5 | **上传响应格式兼容**：`uploadImage` 兼容 `{ filename }` / `{ name }` / `{ data: { filename } }` 多种响应格式 | ✅ 已修复 | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts#L74-L79) |
| 6 | **新增完整工具集**：从后端 API 文档实现了全部 9 个工具（`prompt_enhance`/`upload_image`/`image2vl`/`style_transfer`/`storyboard_generate`/`deduction`） | ✅ 已完成 | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts), [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts) |
| 7 | **`upload_image` 直读本地资产**：canvas-studio 资产 URL（`/canvas-studio/assets/<pid>/<file>`，带或不带 `http://127.0.0.1:<port>` 前缀）直接经 `registry.assetsDir(pid)` 读盘上传，不再 `fetch` 本地 webServer（其 loopback 请求返回 403，导致上传必失败） | ✅ 已修复 | [`generate.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/generate.ts) `readSourceBytes`/`parseCanvasAsset`, [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts) `upload_image` |
| 8 | **产物输出 schema 补齐 `filename`**：`image_generate`/视频/风格/分镜等工具回传 Drama 文件名时触发 `additionalProperties: false` 校验失败（`"value.filename" is not a declared property`）；已在 `resultSchema` 声明 `filename`，并让 `renderResult` 打印 `Drama 文件名` 便于模型链式引用 | ✅ 已修复 | [`host-tools.ts`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/src/host-tools.ts) `resultSchema`/`renderResult` |

---

## 验证清单

### 单元测试覆盖

当前单元测试 [`generate.test.mjs`](file:///Users/wl/Desktop/job/learn/video_buddy/canvas-studio/tests/generate.test.mjs) 覆盖了：
- `image_generate` 普通生成（追加新节点） ✅
- `image_generate` 带 `retryOf` 的重试语义 ✅
- `image_generate` 重试目标不存在时错误处理 ✅

**已更新测试用例**：参数从 `imageUrl` 改为 `filename` ✅

### 端到端验证步骤

1. **`prompt_enhance`**：输入简单提示词 → 返回增强后的提示词
2. **`image_generate` 文生图**：调用 `image_generate(prompt="一只猫")` → 画布显示图片，文件落盘 ✅
3. **`image_generate` 图生图**：`image_generate` → `upload_image` → 再 `image_generate`（带 filename）→ 生成风格化图片
4. **`upload_image`**：传入 `image_generate` 产物 URL → 返回服务器 filename
5. **`image2vl`**：`image_generate` → `upload_image` → `image2vl` → 返回分析文本
6. **`style_transfer`**：两张图都上传 → `style_transfer(filename, styleFilename)` → 返回风格迁移后的图片
7. **`storyboard_generate`**：传入多行分镜描述 → 生成分格图片
8. **`deduction`**：上传参考图 → 返回画面分析和下一帧推演
9. **`video_generate` 图生视频**：`image_generate` → `upload_image` → `video_generate(filename)` → 生成视频，画布可播放
10. **`video_composite` 多图合成**：生成并上传三张图 → `video_composite(filenames)` → 按正确帧位置合成视频