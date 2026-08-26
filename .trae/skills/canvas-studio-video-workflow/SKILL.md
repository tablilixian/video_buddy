---
name: "canvas-studio-video-workflow"
description: "Canvas Studio 视频生成工作流：从文本到视频片段的完整流程编排。Invoke when user asks to generate a video from scratch, or when orchestrating multi-step video creation involving image generation, image analysis, style transfer, storyboarding, and video synthesis."
---

# Canvas Studio 视频生成工作流

## 概述

本 skill 定义了从「文本描述」到「最终视频片段」的完整编排流程。流程按步骤推进，每个步骤使用对应的 Canvas Studio 工具，确保生成质量和链路通畅。

## 核心规则：所有图片必须先上传

**所有需要图片作为输入的工具，都只能接受 `filename`（已上传到 Drama Backend 的服务器文件名），不能直接传图片 URL。** 必须遵循以下步骤：

1. 用 `image_generate` 生图 → 得到图片 URL
2. 用 `upload_image` 上传到 Drama Backend → 得到服务器文件名
3. 用 `filename` 传给下游工具（`video_generate`、`image2vl`、`style_transfer`、`storyboard_generate`、`deduction`、`image_generate` 图生图模式）

## 可用工具清单

| 工具名 | 功能 | 输入 | 输出 |
|--------|------|------|------|
| `prompt_enhance` | 增强提示词 | `prompt` | 增强后的文本 |
| `image_generate` | 文生图 / 图生图 | `prompt`, `filename?`（图生图用）, `aspectRatio?` | 图片 URL |
| `upload_image` | 上传到 Drama Backend | `imageUrl` | 服务器文件名 |
| `image2vl` | 图像分析（VLM） | `filename`, `prompt`, `systemPrompt?` | 分析文本 |
| `style_transfer` | 风格迁移 | `filename`, `styleFilename`, `prompt?`, `enhance?` | 图片 URL |
| `storyboard_generate` | 分镜生成 | `prompt`, `gridnum?`, `filename?` | 图片 URL |
| `video_generate` | 图生视频（MSR） | `prompt`, `filename`, `aspectRatio?`, `duration?` | 视频 URL |
| `video_composite` | 多图合成视频（MKR） | `prompt`, `filenames`, `aspectRatio?`, `duration?` | 视频 URL |
| `deduction` | 剧情推演 | `filename`, `analysisPrompt?`, `deductionPrompt?` | 分析 + 推演 |

## 标准流程

### 流程 A：标准图生视频（3 步）

适用于用户只需要一张图作为参考生成视频。

```
Step 1: image_generate(prompt, aspectRatio)
  → 得到图片 URL: /canvas-studio/assets/xxx/yyy.png

Step 2: upload_image(imageUrl=图片URL)
  → 得到服务器文件名: "reference (xxx).png"

Step 3: video_generate(prompt, filename=服务器文件名, duration)
  → 使用服务器文件名调用 image2videomsr → 得到视频 URL
```

### 流程 B：增强视频生成（4 步）

适用于需要高质量视频的场景，先增强提示词，再生成图片，再图生视频。

```
Step 1: prompt_enhance(prompt)
  → 得到增强后的提示词 enhancedPrompt

Step 2: image_generate(prompt=enhancedPrompt, aspectRatio)
  → 得到图片 URL

Step 3: upload_image(imageUrl=图片URL)
  → 得到服务器文件名

Step 4: video_generate(prompt=enhancedPrompt, filename=服务器文件名, duration)
  → 得到视频 URL
```

### 流程 C：多图合成视频（4+ 步）

适用于需要多张参考图合成一段视频的场景。

```
Step 1: image_generate(prompt="场景1", aspectRatio)
  → 得到图片 URL1

Step 2: image_generate(prompt="场景2", aspectRatio)
  → 得到图片 URL2

Step 3: upload_image(imageUrl=URL1) → 文件名1
        upload_image(imageUrl=URL2) → 文件名2
  (可并行上传)

Step 4: video_composite(prompt, filenames=[文件名1, 文件名2], duration)
  → 内部按时间轴均分 frame_index → 调用 image2videomkr → 得到视频 URL
```

### 流程 D：图生图后再生视频（4+ 步）

适用于先生成一张图，再基于它生成风格化图片，最后生成视频。

```
Step 1: image_generate(prompt="原始场景", aspectRatio)
  → 得到图片 URL1

Step 2: upload_image(imageUrl=URL1) → 文件名1

Step 3: image_generate(prompt="风格化描述", filename=文件名1, aspectRatio)
  → 基于文件名1做图生图 → 得到图片 URL2

Step 4: upload_image(imageUrl=URL2) → 文件名2

Step 5: video_generate(prompt=最终prompt, filename=文件名2, duration)
  → 得到视频 URL
```

### 流程 E：完整电影级工作流（8+ 步）

适用于需要完整前期规划 + 后期生成的场景。

```
# 阶段一：创意策划
Step 1: prompt_enhance(prompt="原始创意描述")
  → 得到增强后的提示词

# 阶段二：分镜规划
Step 2: storyboard_generate(prompt="分镜1\n分镜2\n分镜3\n分镜4", gridnum=4)
  → 得到分镜图 URL

# 阶段三：参考图生成
Step 3: image_generate(prompt=增强后的提示词, aspectRatio)
  → 得到主图 URL

# 阶段四：上传参考图
Step 4: upload_image(imageUrl=主图URL) → 文件名1

# 阶段五：风格统一（可选）
Step 5: image_generate(prompt="风格化描述", filename=文件名1, aspectRatio)
  → 得到风格化图片 URL2

Step 6: upload_image(imageUrl=URL2) → 文件名2

# 阶段六：画面分析（可选）
Step 7: image2vl(filename=文件名2, prompt="分析画面内容")
  → 得到画面分析文本（可用于后续 prompt 优化）

# 阶段七：剧情推演（可选，多帧场景）
Step 8: deduction(filename=文件名2)
  → 得到下一帧画面描述

# 阶段八：视频生成
Step 9: video_generate(prompt=最终prompt, filename=文件名2, duration)
  → 得到视频 URL
```

## 关键规则

### 1. 图片 → 视频的串联规则

- 所有以图片作为输入的工具**只能接受 `filename`/`filenames`**（已上传到 Drama Backend 的服务器文件名）
- 必须先通过 `upload_image` 上传图片，拿到服务器文件名后，再传给下游工具
- `upload_image` 接受 `imageUrl`（`image_generate` 产物的相对 URL），内部自动补全为绝对 URL 后上传

### 2. 上传去重

- 如果同一张图需要被多个工具使用，**只上传一次**，保存 `filename` 重复使用
- 示例：`upload_image` → 得到 `filename` → 同时用于 `image2vl` 分析和 `video_generate` 生成

### 3. 宽高比规则

- `16:9` → 1280×720（横屏，默认）
- `9:16` → 720×1280（竖屏）
- `1:1` → 1024×1024（正方形）
- 一次生成流程中保持宽高比一致，避免图片拉伸

### 4. 视频时长

- `video_generate` 默认 5 秒，建议 3-10 秒
- `video_composite` 默认 12 秒，建议 5-30 秒

### 5. 错误处理

- `HTTP 500`：服务端错误，可能是参数问题或服务暂时不可用。重试 1 次，如果仍然失败则告知用户。
- `上传失败`：检查图片 URL 是否可访问，确认 webServer 正常运行。
- `未返回 filename`：检查 Drama Backend 的上传接口响应格式。

## 使用示例

### 示例 1：用户说"帮我生成一只小猫在草地上奔跑的视频"

```
1. prompt_enhance("小猫在草地上奔跑")
   → 增强后的提示词

2. image_generate(prompt=增强后的提示词, aspectRatio="16:9")
   → 图片 URL

3. upload_image(imageUrl=图片URL)
   → 服务器文件名

4. video_generate(prompt="小猫在草地上奔跑，四蹄交替，尾巴翘起",
                  filename=服务器文件名, duration=5)
   → 视频 URL
```

### 示例 2：用户说"把这两个场景合成一段视频"

```
1. image_generate(prompt="场景一描述", aspectRatio="16:9") → URL1
2. image_generate(prompt="场景二描述", aspectRatio="16:9") → URL2
3. upload_image(imageUrl=URL1) → filename1
   upload_image(imageUrl=URL2) → filename2
4. video_composite(prompt="从场景一过渡到场景二",
                   filenames=[filename1, filename2], duration=10)
   → 视频 URL
```

### 示例 3：用户说"基于这张图重新生成一张并做成视频"

```
1. image_generate(prompt="原始场景", aspectRatio="16:9") → URL1
2. upload_image(imageUrl=URL1) → filename1
3. image_generate(prompt="改成水墨风格", filename=filename1, aspectRatio="16:9") → URL2
4. upload_image(imageUrl=URL2) → filename2
5. video_generate(prompt="水墨风格动画", filename=filename2, duration=5)
   → 视频 URL
```