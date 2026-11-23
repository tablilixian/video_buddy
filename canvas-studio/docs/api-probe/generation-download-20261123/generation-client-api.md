# Generation 客户端 API 与接入指南

本文整理 DramaServer 当前提供给客户端的异步媒体生成接口。范围以
`internal/generation`、`internal/assets` 和路由注册代码为准，覆盖：

- 文本生图：`txt2image`
- 图片生图：`image2image`
- 角色四视图：`image2character`
- 图像视觉语言：`image2vl`
- 视频视觉语言：`video2vl`
- 首尾帧生成视频：`image2videofl2va`（Minimax H3）
- 多模态参考生成视频：`image2videoref2va`（Minimax H3）
- 音频或视频语音识别：`asr2txt`（Fast Whisper）
- 文本生音乐：`txt2audio`
- 文本生成语音：`txt2speech`（VoxCPM2）
- 创建、查询、长轮询、列表、取消和结果下载
- 参考图的上传与完成流程
- TypeScript/Web 或 Electron 客户端的推荐调用方式

当前 generation 接口不负责 Supabase 登录。客户端先通过 Supabase 取得
`access_token`，再调用本文接口。

产物归档、CDN 签名下载、状态机和清理策略以
`docs/generation-output-archive-design.md` 为准。

## 1. 接口总览

设 API 根地址为 `<BASE_URL>`，本地默认是 `http://127.0.0.1:8080`。

| 方法 | 路径 | 成功状态 | 会话级 JWT | 用途 |
| --- | --- | --- | --- | --- |
| `GET` | `/v1/models?modality=image` | `200` | 否 | 选择可用的图片模型 |
| `GET` | `/v1/credits/balance` | `200` | 否 | 预检查积分余额 |
| `POST` | `/v1/assets/presign` | `201` | 是 | 创建直接上传到 Blob 的预签名 URL |
| `PUT` | 响应中的 `upload_url` | Blob 返回状态 | 否 | 客户端直接上传参考图字节 |
| `POST` | `/v1/assets/complete` | `200` | 是 | 校验上传并标记素材为 `ready` |
| `POST` | `/v1/generations/quote` | `200` | 否 | 预估一次生成的积分消耗 |
| `POST` | `/v1/generations` | `202` | 是 | 创建异步生成任务 |
| `GET` | `/v1/generations/{id}` | `200` | 否 | 立即读取任务快照 |
| `GET` | `/v1/generations/{id}/poll` | `200` | 否 | 按版本号长轮询任务变化 |
| `GET` | `/v1/generations` | `200` | 否 | 分页恢复或展示历史任务 |
| `POST` | `/v1/generations/{id}/cancel` | `202` | 是 | 请求取消任务 |
| `GET` | `/v1/generations/{id}/download/{ordinal}` | `200` | 否 | 获取短期 Blob/CDN 下载 URL |
| `GET` | `/v1/generations/{id}/content/{ordinal}` | `200` | 否 | 代理下载生成结果原始字节 |

“会话级 JWT”表示 Supabase access token 必须包含非空 `session_id`。普通
Supabase 登录会话通常满足该条件；降级或非会话 token 不能调用创建、取消和
素材上传确认接口。

客户端不能指定 provider、provider account、endpoint 或价格。服务端根据
`model`、`operation` 和路由策略选择执行端点。

## 2. 公共约定

### 2.1 认证头

除 `PUT upload_url` 外，请求都应携带当前 Supabase access token：

```http
Authorization: Bearer <supabase-access-token>
Accept: application/json
```

JSON 请求还需携带：

```http
Content-Type: application/json
```

长期运行的长轮询必须使用当前有效 token。客户端在 token 刷新后，应让下一次
请求使用新 token，而不是永久缓存登录时取得的旧 token。

### 2.2 错误信封

非 2xx 响应统一为：

```json
{
  "error": {
    "code": "invalid_argument",
    "message": "invalid generation request"
  }
}
```

客户端应依据 `error.code` 分支处理，不依赖 `message` 文案。

长轮询遇到生成终态时仍返回 HTTP `200`，失败原因放在快照的 `error` 中。若
provider 明确返回了可安全透出的失败原因，`error.message` 会携带该原因；
`error.code` 仍保持稳定，客户端不应把动态文案当作逻辑分支条件。

常见错误：

| HTTP | `error.code` | generation 场景 |
| --- | --- | --- |
| `400` | `invalid_argument` | JSON、字段、模型或 operation 非法 |
| `401` | `unauthenticated` | token 缺失、过期、非法或缺少 `session_id` |
| `403` | `permission_denied` | 用户禁用或模型未授权 |
| `404` | `not_found` | 任务不存在，或不属于当前用户 |
| `409` | `conflict` | 幂等冲突、积分不足、素材状态冲突 |
| `409` | `result_not_ready` | 媒体产物仍在归档，客户端应继续轮询 |
| `410` | `gone` | 生成结果已过期或不可再取 |
| `429` | `rate_limited` | 用户或接口限流 |
| `500` | `internal` | 服务端内部错误 |
| `503` | `unavailable` | 当前没有可路由的 provider |

`429` 响应带 `Retry-After`，客户端应遵守该等待时间并加入少量随机抖动。

## 3. 登录与模型准备

推荐登录后先调用 `POST /v1/auth/sync` 同步业务用户，并登记稳定的安装设备
ID。若请求带 `device`，该 token 也必须是会话级 token。

然后按业务场景查询模型。这里以图片为例：

```http
GET /v1/models?modality=image
Authorization: Bearer <supabase-access-token>
```

关键字段：

```json
{
  "models": [
    {
      "id": "55555555-5555-4555-8555-000000000004",
      "code": "image.qwen-image-2.1",
      "display_name": "Qwen Image 2.1",
      "modality": "image",
      "capabilities": {
        "inputs": ["text", "image"],
        "outputs": ["image"],
        "operations": ["txt2image", "image2image"]
      },
      "entitled": true,
      "available": true,
      "endpoints": []
    },
    {
      "id": "55555555-5555-4555-8555-000000000011",
      "code": "image.krea2",
      "display_name": "Krea2",
      "modality": "image",
      "capabilities": {
        "inputs": ["text", "image"],
        "outputs": ["image"],
        "operations": ["image2character"]
      },
      "entitled": true,
      "available": true,
      "endpoints": []
    }
  ],
  "entitlement": {
    "features": {
      "concurrent_generations": 2
    }
  }
}
```

创建任务时传给 `model` 的是模型稳定编码 `code`，不是模型 UUID。

客户端应同时检查：

- `available === true`
- `capabilities.operations` 包含准备提交的 operation；若目录没有声明
  `operations`，至少检查输入、输出能力
- 当前 operation 需要的素材已经准备完成

不要把 `model_id`、endpoint UUID 或 provider account UUID 放进创建请求。

## 4. 参考图上传

`txt2image` 不需要上传素材。`image2image` 必须先上传 1 到 4 张图片，并在
创建任务时引用其 `asset_id`。`image2character` 必须先上传且只引用 1 张角色
设计图。`image2vl` 必须先上传且只引用 1 张图片，`video2vl` 必须先上传且只
引用 1 个视频。`image2videofl2va` 可选上传首帧和尾帧图片；
`image2videoref2va` 可选组合最多 9 张图片、3 个视频和 3 个音频参考素材。
两个视频 operation 都允许不传 `inputs`，此时按文本提示词生成视频。
`asr2txt` 必须先上传且只引用 1 个音频或视频素材，`role`
必须与实际素材类型一致。`txt2audio` 只接受文本，不需要上传素材。`txt2speech`
可选上传 1 个音频作为参考音色，不上传时使用模型默认音色。

### 4.1 创建预签名上传

```http
POST /v1/assets/presign
Authorization: Bearer <supabase-access-token>
Content-Type: application/json

{
  "type": "image",
  "filename": "reference.png",
  "content_type": "image/png",
  "size_bytes": 12345
}
```

成功响应 `201`：

```json
{
  "asset": {
    "id": "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
    "type": "image",
    "status": "uploading",
    "mime_type": "image/png",
    "expires_at": "2026-11-17T12:00:00Z",
    "created_at": "2026-11-15T12:00:00Z",
    "updated_at": "2026-11-15T12:00:00Z"
  },
  "upload_url": "https://...signed-put-url...",
  "headers": {
    "content-type": "image/png"
  },
  "expires_at": "2026-11-15T12:10:00Z"
}
```

当前允许的图片 MIME 包括：

- `image/jpeg`
- `image/png`
- `image/webp`
- `image/gif`
- `image/avif`

参考音频允许 `audio/mpeg`、`audio/mp4`、`audio/wav`、`audio/x-wav`、
`audio/ogg` 和 `audio/webm`。创建预签名时 `type` 使用 `audio`。

参考视频允许 `video/mp4`、`video/quicktime`、`video/webm` 和
`video/x-matroska`。创建预签名时 `type` 使用 `video`。

上传大小上限由 `ASSET_MAX_UPLOAD_BYTES` 配置，默认 1 GiB。素材业务有效期由
`ASSET_TTL` 配置，默认 48 小时；预签名 URL 本身是短时有效的。

### 4.2 直接上传到 Blob

直接向响应中的 `upload_url` 发 `PUT`：

```http
PUT <upload_url>
Content-Type: image/png

<raw image bytes>
```

客户端必须原样使用响应 `headers` 中的头。这个请求不需要、通常也不应附加
DramaServer 的 `Authorization` 头，避免把 Supabase token 发给对象存储。

预签名故意不幂等。重试 `presign` 会得到新的 asset ID 和新的对象键。

### 4.3 完成上传

上传成功后，计算文件字节的 SHA-256，以小写十六进制提交：

```http
POST /v1/assets/complete
Authorization: Bearer <supabase-access-token>
Content-Type: application/json

{
  "asset_id": "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
  "checksum_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "size_bytes": 12345
}
```

成功返回 `200` 和 `status: "ready"` 的 asset。相同 checksum 的重复 complete
是幂等的；checksum 不一致返回 `409 conflict`。

只有 `ready` 且未过期的当前用户素材可以作为 generation 输入。不同用户素材、
重复素材、ordinal 不连续都会被拒绝。

素材关联到 generation 后，即使任务已经进入终态，也会至少保留
`ASSET_GENERATION_INPUT_RETENTION`（默认 `24h`）。实际删除时间取
`max(asset.expires_at, generation.completed_at + retention)`，因此任务结束后
24 小时内再次使用该 `asset_id` 不会被 cleanup 抢先删除。

再次引用不可用素材时，创建接口返回稳定错误：

| HTTP | 错误码 | 含义 |
| --- | --- | --- |
| `404` | `not_found` | 素材不存在、已被清理，或不属于当前用户 |
| `409` | `conflict` | 素材存在但尚未 `ready` |
| `410` | `gone` | 素材已过期 |

### 4.4 输入顺序

`inputs` 按 operation 校验：

- `image2image` 为 1 到 4 个图片；`image2character`、`image2vl` 固定为 1 个图片
- `video2vl` 固定为 1 个视频且 `role` 必须为 `video`
- `asr2txt` 固定为 1 项且 `role` 必须是 `audio` 或 `video`
- `image2videofl2va` 可选 0 到 2 个图片，`ordinal` 1 是首帧、2 是尾帧；
  不传 `inputs` 时按文本生成视频
- `image2videoref2va` 的 `role` 只允许 `image`、`video`、`audio`；
  每个 role 的 `ordinal` 分别从 1 开始；不传 `inputs` 时按文本生成视频
- 其他 operation 的 `role` 只允许 `image`，省略时服务端默认为对应角色
- 同一 role 内 ordinal 必须唯一且从 1 连续
- 同一 asset ID 不能重复

服务端先按媒体 role，再按 ordinal 排序后提交给 provider。

## 5. 创建 generation

### 5.0 预估积分消耗

在提交任务前，客户端可以调用报价接口展示预计积分消耗。报价使用与创建任务
相同的模型路由和价格公式，但不会冻结积分、创建任务或写入 provider attempt。

```http
POST /v1/generations/quote
Authorization: Bearer <supabase-access-token>
Content-Type: application/json

{
  "model": "image.qwen-image-2.1",
  "operation": "txt2image",
  "input": {
    "width": 1280,
    "height": 720
  }
}
```

成功响应只包含预计积分：

```json
{
  "estimated_credits": 18.432
}
```

报价请求：

- 不需要 `Idempotency-Key`。
- 不需要 prompt 已填写，也不需要参考素材已经上传完成。
- 支持与创建任务相同的 `model`、`operation` 和 `input` 参数。
- 图片按目标 `width × height` 计算；视频和音乐按 `duration` 计算。
- 当前视频的 `megapixels` 不参与价格公式，只影响 provider 生成参数。

建议客户端在模型、operation、尺寸、时长等价格相关参数变化后做约 300ms
防抖再请求报价。报价代表当前路由和价格版本下的预计值，创建任务时返回的冻结
结果仍是最终依据。

### 5.1 文本生图

```http
POST /v1/generations
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
Idempotency-Key: 3dbf7ad8-ef58-4b4f-8f9d-0cb36514db56
X-Client-Run-ID: local-run-20261115-001

{
  "model": "image.qwen-image-2.1",
  "operation": "txt2image",
  "input": {
    "prompt": "a cinematic mountain village at sunrise",
    "width": 1024,
    "height": 768
  }
}
```

### 5.2 图片生图

```http
POST /v1/generations
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
Idempotency-Key: 40be1f39-b93c-4bf4-8f97-a6e75c503e47

{
  "model": "image.qwen-image-2.1",
  "operation": "image2image",
  "input": {
    "prompt": "keep the person, change the background to a snowy forest",
    "width": 1024,
    "height": 768
  },
  "inputs": [
    {
      "asset_id": "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
      "role": "image",
      "ordinal": 1
    }
  ]
}
```

### 5.3 角色四视图

`image2character` 调用 DramaBackend 的 Krea2 Quadview 工作流，将一张角色设计图
转换为角色四视图。该 operation 不需要 prompt 或尺寸；创建时必须提供且只能
提供一张已 ready 的图片素材。

```http
POST /v1/generations
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
Idempotency-Key: 7aa9b7fb-1fa4-4adb-bc14-d321eb840f33

{
  "model": "image.krea2",
  "operation": "image2character",
  "inputs": [
    {
      "asset_id": "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
      "role": "image",
      "ordinal": 1
    }
  ]
}
```

### 5.4 文本生音乐

```http
POST /v1/generations
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
Idempotency-Key: 5d659cb6-a7d7-481f-8a92-f7b84518e394

{
  "model": "audio.yue2",
  "operation": "txt2audio",
  "input": {
    "prompt": "warm Chinese campus folk, nylon guitar, flute, intimate female vocal, 92 BPM, 4/4, D major",
    "lyrics": "[Verse]\n九月的风推开教室的窗\n[Chorus]\n那一年我们什么都不怕",
    "duration": 45,
    "bpm": 92,
    "key_scale": "D major",
    "language": "zh",
    "time_signature": "4/4"
  }
}
```

`prompt` 是音乐风格/编曲描述。为兼容 Playsout 原始字段名，也可以使用
`caption_prompt`、`lyrics_prompt`、`keyscale`、`timesignature`；同一含义的
标准字段与兼容字段同时出现时，值必须一致。

### 5.4.1 文本生成语音

`txt2speech` 调用 DramaBackend `/api/v1/generate/txt2speech`，使用 VoxCPM2
异步生成语音并返回音频结果。`input.prompt` 必填，表示要朗读的文本；
`input.system_prompt` 可选，表示音色、情绪或表达方式。为兼容 Playsout
原始字段名，也可以使用 `txt_prompt` 和 `instruct_prompt`。

参考音色音频可选且最多 1 个。上传后通过 `inputs[].asset_id` 引用，
`role` 必须为 `audio`。

```http
POST /v1/generations
Authorization: Bearer <supabase-access-token>
Content-Type: application/json
Idempotency-Key: 0c2a8a02-94fa-4c7f-bf39-6a469ac77724

{
  "model": "audio.voxcpm2",
  "operation": "txt2speech",
  "input": {
    "system_prompt": "温暖、克制、纪录片旁白语气。",
    "prompt": "欢迎来到片场。"
  },
  "inputs": [
    {
      "asset_id": "dddddddd-dddd-4ddd-8ddd-000000000004",
      "role": "audio",
      "ordinal": 1
    }
  ]
}
```

`txt2speech` 不接受 `width`、`height`、`lyrics`、`duration`、`bpm`、
`key_scale`、`language` 或 `time_signature`。参考音频不是必填项；不传
`inputs` 时按无参考音色的语音合成处理。

### 5.4.2 音频或视频语音识别

`asr2txt` 调用 DramaBackend `/api/v1/generate/asr2txt`，使用 Fast Whisper
异步识别音频或视频中的语音并返回纯文本。创建时不需要 `input`，必须且只能
上传一个 ready 的音频或视频素材。服务端按素材 MIME 提交到上游对应的
`audio` 或 `video` 字段。

```json
{
  "model": "audio.fast-whisper",
  "operation": "asr2txt",
  "inputs": [
    {
      "asset_id": "dddddddd-dddd-4ddd-8ddd-000000000004",
      "role": "audio",
      "ordinal": 1
    }
  ]
}
```

识别结果是一个结构化 JSON 输出，`type` 为 `json`，`mime_type` 为
`application/json`，不提供 `content_url`：

```json
{
  "ordinal": 0,
  "type": "json",
  "mime_type": "application/json",
  "txt": "plain transcript",
  "txt_word": "word timestamps",
  "txt_segment": "segment timestamps"
}
```

`txt` 是完整转写，`txt_word` 是逐词时间戳，`txt_segment` 是分段时间戳。
三个字段始终保留，没有内容时返回空字符串。

`asr2txt` 不接受 `prompt`、`system_prompt`、`width`、`height`、`lyrics`、
`duration`、`bpm`、`key_scale`、`language` 或 `time_signature`。

### 5.5 图像视觉语言

`image2vl` 调用 DramaBackend `/api/v1/generate/image2vl`，异步返回一段文本。
`system_prompt` 可省略，Playsout Endpoint 的 `default_system_prompt` 或服务端
默认值会补齐；`prompt` 必填。创建时必须提供且只能提供一张已 ready 的图片。

```json
{
  "model": "image.qwen3-vl",
  "operation": "image2vl",
  "input": {
    "system_prompt": "You are a visual analyst.",
    "prompt": "Describe the visual language and composition."
  },
  "inputs": [
    {
      "asset_id": "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
      "role": "image",
      "ordinal": 1
    }
  ]
}
```

### 5.6 视频视觉语言

`video2vl` 调用 DramaBackend `/api/v1/generate/video2vl`，异步返回一段文本。
创建时必须提供且只能提供一个已 ready 的视频素材，`role` 使用 `video`。

```json
{
  "model": "video.qwen3-vl",
  "operation": "video2vl",
  "input": {
    "system_prompt": "You are a video analyst.",
    "prompt": "Summarize the action, camera movement, and visual style."
  },
  "inputs": [
    {
      "asset_id": "cccccccc-cccc-4ccc-8ccc-000000000003",
      "role": "video",
      "ordinal": 1
    }
  ]
}
```

视觉语言任务通常按 `request` 价格单位计费，完成后文本位于
`outputs[0].text`，不提供 `content_url`。

### 5.6.1 Minimax H3 视频生成

`video.minimax_h3` 暴露两个 operation。Endpoint 路由、异步任务状态、轮询和
结果下载与其他 generation 完全一致。

首尾帧生成，`inputs` 可选：

```json
{
  "model": "video.minimax_h3",
  "operation": "image2videofl2va",
  "input": {
    "prompt": "镜头从山门缓慢推进到云海日出，人物衣摆随风扬起",
    "aspect": "16:9",
    "megapixels": 0.4,
    "duration": 5
  },
  "inputs": [
    { "asset_id": "image-start", "role": "image", "ordinal": 1 },
    { "asset_id": "image-end", "role": "image", "ordinal": 2 }
  ]
}
```

多模态参考生成，`inputs` 可选：

```json
{
  "model": "video.minimax_h3",
  "operation": "image2videoref2va",
  "input": {
    "prompt": "组合角色造型、镜头运动和音频情绪",
    "aspect": "1:1",
    "megapixels": 0.6,
    "duration": 8
  },
  "inputs": [
    { "asset_id": "image-ref-1", "role": "image", "ordinal": 1 },
    { "asset_id": "image-ref-2", "role": "image", "ordinal": 2 },
    { "asset_id": "video-ref-1", "role": "video", "ordinal": 1 },
    { "asset_id": "audio-ref-1", "role": "audio", "ordinal": 1 }
  ]
}
```

`aspect` 允许 `16:9`、`9:16` 或 `1:1`，默认 `16:9`；`megapixels` 默认 `0.4`，
范围 `0.01..16`；`duration` 默认 `5` 秒，范围 `1..60`。两个 operation 都按
请求秒数冻结和结算积分，并返回 `type=video` 的规范化媒体结果。

### 5.7 请求约束

- 请求体上限 1 MiB，不接受未知 JSON 字段。
- `Idempotency-Key` 必填，trim 后长度为 1 到 255 字节，建议用 UUID。
- `model` 必填，来自 `GET /v1/models` 的 `code`，并按 modality 过滤。
- `operation` 当前允许 `txt2image`、`image2image`、`image2character`、
  `image2vl`、`video2vl`、`asr2txt`、`txt2audio`、`txt2speech`、
  `image2videofl2va`、`image2videoref2va`。
- `prompt` 对除 `image2character`、`asr2txt` 外的 operation 必填；图片 operation
  上限 8000 字节，`txt2audio` 上限 20000 字节。
- `width`、`height` 省略或传 `0` 时默认 `1024 x 768`。
- 显式尺寸必须在 `1..8192`，但具体 endpoint 仍可能拒绝不支持的尺寸。
- `txt2image`、`image2image` 按目标 `width × height × 生成张数` 的百万像素数
  冻结和结算积分；默认尺寸按 `1024 × 768` 计算。
- `txt2image` 不允许任何 `inputs`。
- `image2image` 必须提供 1 到 4 个已 ready 的图片素材。
- `image2character` 必须提供且只能提供 1 个已 ready 的图片素材，`prompt`
  可省略或留空。
- `image2vl` 必须提供且只能提供 1 个已 ready 的图片素材。
- `video2vl` 必须提供且只能提供 1 个已 ready 的视频素材。
- `image2videofl2va` 可选 0 到 2 个图片素材，按首帧、尾帧排序；不传素材时
  按文本生成视频。
- `image2videoref2va` 可选 0 到 15 个参考素材；其中图片最多 9 个，视频和音频
  分别最多 3 个。
- 两个 Minimax H3 operation 都要求 `prompt`；只接受 `aspect`、`megapixels`
  和 `duration`，不接受 `width`、`height`、`system_prompt` 或音频生成字段。
- `image2vl`、`video2vl` 可选 `system_prompt`，最长 2000 字符；不接受
  `width` 或 `height`。
- `txt2audio` 不允许任何 `inputs`、`width` 或 `height`。
- `txt2audio.lyrics` 可选，最长 100000 字节；空歌词可用于纯器乐或由模型自行规划。
- `txt2audio.duration` 默认 `30` 秒，范围 `1..600`，按请求秒数冻结和结算积分。
- `txt2audio.bpm` 默认 `128`，范围 `1..400`。
- `txt2audio.key_scale`、`language`、`time_signature` 默认分别为
  `Bb major`、`en`、`4`，每项最长 80 个字符。
- `txt2speech` 的 `prompt` 最长 20000 字节，可选 `system_prompt` 最长
  2000 字符；最多引用 1 个 `audio` 素材。
- `asr2txt` 不接受 `input`，必须且只能引用 1 个 `audio` 或 `video` 素材，
  `role` 必须与素材实际类型一致。
- 可选 `X-Client-Run-ID` 只用于服务端关联和排障，不会替代 generation ID。

### 5.8 幂等语义

同一用户、同一 `Idempotency-Key`、同一规范化请求重复调用时，服务端返回原
generation，不会重复冻结积分或再次入队。

同一 key 但 prompt、model、operation、尺寸或输入素材发生变化时返回
`409 conflict`。

客户端应在发请求前持久化这次创建意图：

- `Idempotency-Key`
- 完整请求体
- 可选 `X-Client-Run-ID`
- 已经拿到的 generation ID

创建响应丢失时，客户端应使用同样的 key 和同样的请求体重放，而不是生成新 key。

### 5.7 成功响应

HTTP `202 Accepted`：

```json
{
  "id": "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
  "model_id": "55555555-5555-4555-8555-000000000004",
  "operation": "txt2image",
  "status": "credit_held",
  "version": 1,
  "progress": 0,
  "billing_status": "held",
  "terminal": false,
  "poll_after_ms": 0,
  "outputs": [],
  "error": null,
  "created_at": "2026-11-15T12:00:00Z",
  "updated_at": "2026-11-15T12:00:00Z"
}
```

`202` 只表示任务已经持久化和入队，不表示 provider 已生成成功。积分会在创建
时冻结，成功完成后 commit，失败、取消或超时后 release。

`poll_after_ms` 是普通轮询的兼容字段；当前客户端应优先使用 `/poll` 长轮询。

## 6. 查询与长轮询

### 6.1 立即查询

```http
GET /v1/generations/{id}
Authorization: Bearer <supabase-access-token>
```

该接口只读取 PostgreSQL 快照，不调用 provider。

### 6.2 长轮询

```http
GET /v1/generations/{id}/poll?after_version=1&wait=25s
Authorization: Bearer <supabase-access-token>
```

参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `after_version` | `0` | 当前已处理版本；任务版本更大时立即返回 |
| `wait` | `25s` | 服务端会 clamp 到 `0..25s` |

行为：

- 任务终态时立即返回 `200`。
- `version > after_version` 时立即返回 `200`。
- 否则最多等待 `wait`，期间至少每秒重新检查一次 PostgreSQL。
- 普通等待超时仍返回 `200` 和最新快照，不返回 `408` 或 `504`。
- 非本人任务按不存在处理，返回 `404 not_found`。

推荐算法：

```text
create -> snapshot
version = snapshot.version

while not snapshot.terminal:
  snapshot = GET /poll?after_version=version&wait=25s
  version = snapshot.version

  on 429/503: wait Retry-After + jitter, keep same generation ID and version
  on network error: bounded exponential backoff, keep same generation ID and version
  on success: immediately start next poll
```

必须用响应里的新 `version` 更新游标。普通超时可能返回相同 version，此时继续
发起下一次长轮询即可。

## 7. 任务快照与状态

公共响应字段：

| 字段 | 说明 |
| --- | --- |
| `id` | generation UUID |
| `model_id` | 模型 UUID，仅用于展示映射 |
| `operation` | `txt2image`、`image2image`、`image2character`、`image2vl`、`video2vl`、`asr2txt`、`txt2audio`、`txt2speech`、`image2videofl2va` 或 `image2videoref2va` |
| `status` | 当前任务状态 |
| `version` | 单调递增版本，长轮询游标 |
| `progress` | `0..100` 的展示进度 |
| `billing_status` | `none`、`held`、`committed` 或 `released` |
| `result_status` | 媒体结果准备状态：`archiving`、`ready`、`failed` 或 `expired` |
| `terminal` | 是否终态 |
| `outputs` | 输出数组；无输出时为 `[]`，不是 `null` |
| `error` | 无错误时为 `null` |
| `created_at` | 创建时间 |
| `updated_at` | 最近更新时间 |

任务状态：

| 状态 | 终态 | 含义 |
| --- | --- | --- |
| `created` | 否 | 已持久化，尚未产生成功计费 |
| `credit_held` | 否 | 积分已冻结，等待提交 |
| `queued` | 否 | provider 排队中 |
| `submitted` | 否 | 已提交上游 |
| `running` | 否 | 上游生成中 |
| `finalizing` | 否 | 上游已返回，服务端正在落结果和结算 |
| `succeeded` | 是 | 生成成功；媒体是否可下载还要看 `result_status` |
| `failed` | 是 | 失败，查看 `error.code` |
| `cancel_requested` | 否 | 已请求取消，等待上游收敛 |
| `canceled` | 是 | 已取消 |
| `timeout` | 是 | 超过任务 deadline |

`finalizing` 不是终态，客户端必须继续轮询到 `terminal === true`。

`succeeded` 表示 Provider 生成和计费结算已经完成，不代表 CDN 归档一定完成。
媒体结果的 `result_status` 为 `archiving` 时应继续长轮询，直到变为 `ready`；
只有 `ready` 且输出带有 `download_url` 后才下载。`failed` 表示归档失败，
`expired` 表示结果已过期，这两种状态都不应触发重新生成。

## 8. 列表与恢复

```http
GET /v1/generations?limit=50&status=running
Authorization: Bearer <supabase-access-token>
```

查询参数：

| 参数 | 说明 |
| --- | --- |
| `status` | 可选，必须是上面的合法状态 |
| `limit` | 可选，默认 50，最大 200 |
| `cursor` | 可选，上一页返回的不透明 cursor |

响应示例：

```json
{
  "generations": [],
  "next_cursor": "eyJjcmVhdGVkX2F0Ijoi..."
}
```

结果按 `created_at DESC, id DESC` 返回。最后一页没有 `next_cursor`。

应用重启后，客户端可以用列表恢复历史展示和未终态任务。当前列表没有
`client_run_id` 过滤参数，因此 `X-Client-Run-ID` 不能作为恢复主键。客户端应
持久化 generation ID 和创建幂等键。

## 9. 取消

```http
POST /v1/generations/{id}/cancel
Authorization: Bearer <supabase-access-token>
```

成功返回 `202`。非终态任务会先变为 `cancel_requested`，然后客户端继续长轮询
直到 `canceled`。如果任务已经是终态，接口返回原终态快照，不会改变状态。

取消接口不需要 `Idempotency-Key`，但同样要求会话级 JWT。

## 10. 下载结果

`result_status=ready` 后，`outputs` 类似：

```json
[
  {
    "ordinal": 0,
    "type": "image",
    "mime_type": "image/png",
    "content_url": "/v1/generations/aaaaaaaa-aaaa-4aaa-8aaa-000000000001/content/0",
    "download_url": "/v1/generations/aaaaaaaa-aaaa-4aaa-8aaa-000000000001/download/0",
    "size_bytes": 2474836,
    "checksum_sha256": "...",
    "width": 1024,
    "height": 768
  }
]
```

音频结果使用相同结构。`content_url` 仅用于旧客户端兼容，新版客户端使用
`download_url`：

```json
[
  {
    "ordinal": 0,
    "type": "audio",
    "mime_type": "audio/mpeg",
    "content_url": "/v1/generations/aaaaaaaa-aaaa-4aaa-8aaa-000000000001/content/0",
    "download_url": "/v1/generations/aaaaaaaa-aaaa-4aaa-8aaa-000000000001/download/0",
    "size_bytes": 1353743,
    "checksum_sha256": "..."
  }
]
```

视频结果同样通过签名 URL 下载：

```json
[
  {
    "ordinal": 0,
    "type": "video",
    "mime_type": "video/mp4",
    "content_url": "/v1/generations/aaaaaaaa-aaaa-4aaa-8aaa-000000000001/content/0",
    "download_url": "/v1/generations/aaaaaaaa-aaaa-4aaa-8aaa-000000000001/download/0",
    "size_bytes": 2474836,
    "checksum_sha256": "..."
  }
]
```

视觉语言结果直接携带文本，没有下载路径：

```json
[
  {
    "ordinal": 0,
    "type": "text",
    "mime_type": "text/plain",
    "text": "画面中的人物站在窗边。"
  }
]
```

媒体结果归档完成后，`download_url` 是相对于 DramaServer `<BASE_URL>` 的受保护
签名 URL 获取入口。新客户端必须等待 `result_status === "ready"` 后再请求
`download_url`，不要在 `archiving` 阶段先调用下载再依赖失败回退。

`content_url` 仅为旧客户端兼容入口，不是新客户端的正常下载路径。

推荐先读取短期下载地址：

```http
GET /v1/generations/{id}/download/{ordinal}
Authorization: Bearer <supabase-access-token>
```

```json
{
  "url": "https://blob.example/signed?...",
  "expires_at": "2026-11-23T08:10:00Z",
  "size_bytes": 2474836,
  "mime_type": "video/mp4",
  "checksum_sha256": "..."
}
```

随后直接 GET 返回的 `url`。签名有效期只限制发起新请求，不会按时间切断已经
开始的传输；暂停或断线后续传前必须重新申请 URL。`409 result_not_ready`
只用于防御性处理，正常客户端不应在 `archiving` 阶段请求这个接口。

旧版客户端仍可使用以下兼容入口，下载时必须带 JWT：

```http
GET /v1/generations/{id}/content/{ordinal}
Authorization: Bearer <supabase-access-token>
```

成功响应是原始文件字节，`Content-Type` 来自输出 MIME，可能是
`Content-Length`。结果缺失、过期或 ordinal 不存在时返回
`410 gone`，错误码 `gone`，message 为 `result_expired`。

浏览器不能给普通 `<img src>`、`<audio src>` 单独添加 Authorization 头。Web 或 Electron
渲染进程应先申请签名 URL，再直接取 Blob 并调用 `URL.createObjectURL(blob)`：

```ts
const ticketResponse = await fetch(baseUrl + output.download_url, {
  headers: { Authorization: `Bearer ${accessToken}` },
})
if (!ticketResponse.ok) throw new Error(`download ticket failed: HTTP ${ticketResponse.status}`)
const ticket = await ticketResponse.json()
const mediaResponse = await fetch(ticket.url, { headers: ticket.headers })
if (!mediaResponse.ok) throw new Error(`media failed: HTTP ${mediaResponse.status}`)
const objectUrl = URL.createObjectURL(await mediaResponse.blob())
```

不再使用时调用 `URL.revokeObjectURL(objectUrl)`。

## 11. 限流

- 所有已认证业务接口共享每用户 `600 次/分钟` 基础限流。
- `POST /v1/generations` 另有每用户 `10 次/分钟` 提交限流。
- `/v1/assets/presign` 和 `/v1/assets/complete` 共享每用户
  `30 次/分钟` 上传限流。
- Redis 不可用时限流 fail-open。

长轮询每次等待最多 25 秒，不要用高频短轮询替代。

## 12. TypeScript 客户端示例

以下示例适用于浏览器或能够使用 Web Crypto 和 `fetch` 的 Electron 渲染环境。
生产代码还应增加 token 刷新、错误码映射、超时和日志。

```ts
type GenerationStatus =
  | 'created'
  | 'credit_held'
  | 'queued'
  | 'submitted'
  | 'running'
  | 'finalizing'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'canceled'
  | 'timeout'

interface GenerationOutput {
  ordinal: number
  type: string
  mime_type: string
  content_url?: string
  download_url?: string
  size_bytes?: number
  checksum_sha256?: string
  text?: string
  txt?: string
  txt_word?: string
  txt_segment?: string
  width?: number
  height?: number
}

interface GenerationView {
  id: string
  model_id: string
  operation:
    | 'txt2image'
    | 'image2image'
    | 'image2character'
    | 'image2vl'
    | 'video2vl'
    | 'asr2txt'
    | 'txt2audio'
    | 'txt2speech'
    | 'image2videofl2va'
    | 'image2videoref2va'
  status: GenerationStatus
  result_status: 'archiving' | 'ready' | 'failed' | 'expired' | ''
  version: number
  progress: number
  billing_status: 'none' | 'held' | 'committed' | 'released'
  terminal: boolean
  outputs: GenerationOutput[]
  error: { code: string; message: string } | null
  created_at: string
  updated_at: string
}

interface CreateGenerationRequest {
  model: string
  operation:
    | 'txt2image'
    | 'image2image'
    | 'image2character'
    | 'image2vl'
    | 'video2vl'
    | 'asr2txt'
    | 'txt2audio'
    | 'txt2speech'
    | 'image2videofl2va'
    | 'image2videoref2va'
  input?: {
    prompt?: string
    system_prompt?: string
    width?: number
    height?: number
    aspect?: string
    megapixels?: number
    lyrics?: string
    duration?: number
    bpm?: number
    key_scale?: string
    language?: string
    time_signature?: string
  }
  inputs?: Array<{
    asset_id: string
    role: 'image' | 'video' | 'audio'
    ordinal: number
  }>
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterMs: number | null,
  ) {
    super(code)
  }
}

async function api<T>(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')

  const response = await fetch(baseUrl + path, {
    ...init,
    headers,
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const retryAfter = Number(response.headers.get('Retry-After'))
    throw new HttpError(
      response.status,
      body?.error?.code ?? `http_${response.status}`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
    )
  }
  return (await response.json()) as T
}

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function uploadImage(
  baseUrl: string,
  token: string,
  file: File,
): Promise<string> {
  const presign = await api<{
    asset: { id: string }
    upload_url: string
    headers: Record<string, string>
  }>(baseUrl, token, '/v1/assets/presign', {
    method: 'POST',
    body: JSON.stringify({
      type: 'image',
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    }),
  })

  const upload = await fetch(presign.upload_url, {
    method: 'PUT',
    headers: presign.headers,
    body: file,
  })
  if (!upload.ok) throw new Error(`blob upload failed: HTTP ${upload.status}`)

  const asset = await api<{ id: string; status: string }>(
    baseUrl,
    token,
    '/v1/assets/complete',
    {
      method: 'POST',
      body: JSON.stringify({
        asset_id: presign.asset.id,
        checksum_sha256: await sha256Hex(file),
        size_bytes: file.size,
      }),
    },
  )
  if (asset.status !== 'ready') throw new Error(`asset is ${asset.status}`)
  return asset.id
}

async function createGeneration(
  baseUrl: string,
  token: string,
  idempotencyKey: string,
  request: CreateGenerationRequest,
): Promise<GenerationView> {
  return api<GenerationView>(baseUrl, token, '/v1/generations', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(request),
  })
}

async function waitForGeneration(
  baseUrl: string,
  token: string,
  created: GenerationView,
): Promise<GenerationView> {
  let current = created
  let retryDelayMs = 500

  while (
    !current.terminal ||
    (current.status === 'succeeded' && current.result_status === 'archiving')
  ) {
    try {
      current = await api<GenerationView>(
        baseUrl,
        token,
        `/v1/generations/${current.id}/poll?after_version=${current.version}&wait=25s`,
      )
      retryDelayMs = 500
    } catch (error) {
      const retriable =
        !(error instanceof HttpError) ||
        error.status === 429 ||
        error.status === 503
      if (!retriable) throw error

      const retryAfterMs =
        error instanceof HttpError && error.retryAfterMs !== null
          ? error.retryAfterMs
          : retryDelayMs
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfterMs + Math.random() * 250),
      )
      retryDelayMs = Math.min(retryDelayMs * 2, 15_000)
    }
  }
  return current
}

async function downloadOutput(
  baseUrl: string,
  token: string,
  output: GenerationOutput,
): Promise<Blob> {
  if (!output.download_url) throw new Error('result is still being prepared')
  const ticketResponse = await fetch(baseUrl + output.download_url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!ticketResponse.ok) {
    throw new Error(`download ticket failed: HTTP ${ticketResponse.status}`)
  }
  const ticket = (await ticketResponse.json()) as {
    url: string
    headers?: Record<string, string>
  }
  const response = await fetch(ticket.url, { headers: ticket.headers })
  if (!response.ok) throw new Error(`media failed: HTTP ${response.status}`)
  return response.blob()
}

// 调用示例：文本生图。
const created = await createGeneration(baseUrl, accessToken, crypto.randomUUID(), {
  model: 'image.qwen-image-2.1',
  operation: 'txt2image',
  input: {
    prompt: 'a cinematic mountain village at sunrise',
    width: 1024,
    height: 768,
  },
})
const finished = await waitForGeneration(baseUrl, accessToken, created)
if (finished.status === 'succeeded') {
  const output = finished.outputs[0]
  if (output) {
    const blob = await downloadOutput(baseUrl, accessToken, output)
    const objectUrl = URL.createObjectURL(blob)
    // UI 展示 objectUrl，结束后调用 URL.revokeObjectURL(objectUrl)。
  }
}

// 调用示例：角色四视图。
const characterID = await uploadImage(baseUrl, accessToken, characterFile)
const character = await createGeneration(
  baseUrl,
  accessToken,
  crypto.randomUUID(),
  {
    model: 'image.krea2',
    operation: 'image2character',
    inputs: [{ asset_id: characterID, role: 'image', ordinal: 1 }],
  },
)
const finishedCharacter = await waitForGeneration(baseUrl, accessToken, character)
if (finishedCharacter.status === 'succeeded' && finishedCharacter.outputs[0]) {
  const characterBlob = await downloadOutput(
    baseUrl,
    accessToken,
    finishedCharacter.outputs[0],
  )
  const characterURL = URL.createObjectURL(characterBlob)
  // UI 展示 characterURL，结束后调用 URL.revokeObjectURL(characterURL)。
}

// 调用示例：文本生音乐。
const music = await createGeneration(baseUrl, accessToken, crypto.randomUUID(), {
  model: 'audio.yue2',
  operation: 'txt2audio',
  input: {
    prompt: 'dreamy Mandopop with guzheng and warm strings, 88 BPM, D major',
    lyrics: '[Verse]\n月光落在窗前\n[Chorus]\n我们唱着回家的歌',
    duration: 45,
    bpm: 88,
    key_scale: 'D major',
    language: 'zh',
    time_signature: '4/4',
  },
})
const finishedMusic = await waitForGeneration(baseUrl, accessToken, music)
if (finishedMusic.status === 'succeeded' && finishedMusic.outputs[0]) {
  const audioBlob = await downloadOutput(
    baseUrl,
    accessToken,
    finishedMusic.outputs[0],
  )
  const audioURL = URL.createObjectURL(audioBlob)
  // UI 交给 <audio src={audioURL}>，结束后调用 URL.revokeObjectURL(audioURL)。
}
```

## 13. 接入检查清单

- 每次创建请求只生成一个幂等键，并在重试创建时复用。
- 创建前持久化幂等键、请求体和可选 client run ID。
- 只使用 `GET /v1/models` 返回的模型 `code`。
- `image2image` 只引用当前用户、`ready`、未过期且 ordinal 连续的素材。
- `image2character` 只引用一张当前用户、`ready` 且未过期的角色设计图。
- `txt2audio` 只传文本参数，不传 `inputs`、`width` 或 `height`。
- `txt2speech` 的 `prompt` 必填；参考音频最多 1 个且 `role` 必须是 `audio`。
- `asr2txt` 不传 `input`，只引用 1 个 ready 的 `audio` 或 `video` 素材，且
  `role` 与素材类型一致。
- 不把 provider URL、endpoint UUID 或 provider account UUID 暴露给创建请求。
- 用任务 `version` 做长轮询游标，而不是时间戳或 progress。
- 只在 `terminal === true` 时展示最终结果或停止轮询。
- `status === "succeeded"` 后仍应检查 `result_status`；`archiving` 时继续轮询，
  `ready` 后再使用 `download_url` 获取短期签名地址。
- 对 `429` 使用 `Retry-After`，对网络错误做有界退避。
- 对 `409 conflict` 不盲目生成新幂等键；先核对原请求和已保存任务。

## 14. 实现位置

- 路由与认证：`internal/api/router.go`
- HTTP 请求/响应：`internal/generation/handler.go`
- 公共 DTO 与状态：`internal/generation/types.go`
- 创建、轮询、取消、下载：`internal/generation/service.go`
- 素材上传：`internal/assets/handler.go`、`internal/assets/service.go`
- 设计契约：`docs/generation-provider-polling-design.md`
- Provider 与 poll 验证：`docs/m8-verification.md`
