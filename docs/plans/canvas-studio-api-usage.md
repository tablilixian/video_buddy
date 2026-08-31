# Canvas Studio × Drama Backend 接口使用指南

> 本文是 canvas-studio 视角的**接线状态 + 使用方式**活文档：每个接口在创作流程中什么时候用、怎么用、有什么坑。原始请求/响应细节以 `api.md`（后端 API 参考，v0.2.0）为准，本文不复制、只引用。
>
> **维护约定**：每完成一项接线，更新 §2 状态列并在 §6 追加一行。状态标记：✅ 已接线 / ⚠️ 已声明未接线（`config.ts` 有常量、无调用代码）/ 🆕 待接线（api.md 有、配置缺）/ ❓ 存疑待确认。
>
> 最后核对：2026-08-24（含首轮真实探测，见 `canvas-studio-phase2.md` §8）。

## 1. 基础约定

### 1.1 配置与调用链路

- 基址：`config.ts → DRAMA_API_BASE`，env `CANVAS_STUDIO_DRAMA_API_BASE` 覆盖，默认 `http://117.50.108.73:8082`
- 鉴权：`DRAMA_API_KEY` 目前**未随任何请求发送**；实测后端当前无鉴权（health 无 key 通过）。去留待后端确认（§5-3）
- 调用链路（全部在 Host 侧，规避浏览器 CORS）：
  ```
  工具(host-tools.ts) → generate.ts callDrama/callDramaRaw
    → Drama Backend（同步 HTTP）
    → 产物下载落盘 ~/.dsh/canvas-studio/projects/<id>/assets/<uuid>.<ext>
    → webServer /canvas-studio/assets/<projectId>/<file> 托管给画布
  ```
- 上传链路：产物 URL 先经 `upload_image` 工具（内部走 `resolveImageUrl` 换算本机托管地址再转发）→ `POST uploadimage` → 得服务器文件名（响应 **`name`** 字段）→ 才能作为其他工具的图片输入

### 1.2 调用语义与坑

| 事项 | 说明 |
| --- | --- |
| 同步阻塞 | 所有生成接口同步返回；一次调用可能持续数秒到数十秒。「打断」只是本地中断 fetch，服务端任务不回收 |
| 错误码 | 400 参数错误 / 500 后端内部错误 / 502 后端不可用（P10 将映射为中文提示并加超时+重试） |
| 尺寸 | 本地 `sizeForAspectRatio`：16:9→1280×720、9:16→720×1280、1:1→1024×1024，**务必显式传宽高**——多个视频端点默认仅 640×320 |
| aspect 参数差异 | 图像类端点收 `width/height` 像素；fl2va/ref2va 收 `aspect`（"16:9"/"9:16"）+ `megapixels`，两种风格不要混传 |
| filename | 一切图片输入只认 Drama 服务器文件名，不认 URL |

## 2. 接线总览表

| # | 端点 | 状态 | 使用方（工具/路由） | 关键参数 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | `GET /api/v1/health` | 🆕→P10 | 健康探针 | — | 实测 ✅ 正常 |
| 2 | `POST /generate/txt2image` | ✅ | image_generate（写实档） | prompt, width, height | z-image-turbo, steps=8 |
| 3 | `POST /generate/txt2imageanime` | ⚠️→P11 | image_generate `style:anime` | 同上 | z-anime-aio |
| 4 | `POST /generate/image2image` | ✅ | image_generate 图生图 | prompt, width, height, image1~3 | qwen_image_edit_3_image_ref, steps=4；**image2/3 尚未暴露**（P8 扩参） |
| 5 | `POST /generate/image2promptenhance` | ✅ | prompt_enhance | prompt | 返回 `output` 字段 |
| 6 | `POST /generate/image2character` | 🆕→P11 | character_sheet（新工具） | image | 四视图立绘，白底 |
| 7 | `POST /generate/image2styletransfer` | ✅ | style_transfer | image1 目标图, image2 风格图, prompt?, enhance? | Klein Transfer Style |
| 8 | `POST /generate/image2ipastyletransfer` | 🆕→P11 | IPA 精细风格迁移 | prompt, image1~3, ref_image, enhance | 多参考融合 |
| 9 | `POST /generate/uploadimage` | ✅ | upload_image / P8 本地上传 | form-data `file` | 实测返回 **`{name, subfolder, type}`**（无 `success`、文件名键是 `name`）；>1MB 触发溢写，1.6MB 约 14s |
| 10 | `POST /generate/upload`（流式） | ❌ 停用（2026-08-31 起移除） | — | — | 任何请求形态均 **500**（含空 body），成功响应从未出现；GET 探测 405 仅证明路由已注册。大文件改为**客户端先压缩** |
| 11 | `GET /view?filename=` | ✅ | generate.ts 下载产物 | filename | ComfyUI 取图 |
| 12 | `POST /generate/image2storyboard` | ✅ | storyboard_generate | prompt（每行一镜）, gridnum=4, width, image? | 格子分镜 |
| 13 | `POST /generate/image2splitegrid` | 🆕→P8 | storyboard_split（新工具） | row, column, target_width/height, image | 分镜拆单镜的关键 |
| 14 | `POST /generate/image2inpaint` | 🆕→P11 | inpaint_image（新工具） | prompt, image | 移除/添加元素智能填充 |
| 15 | `POST /generate/image2vl` | ✅ | image2vl | system_prompt, prompt, image? | VLM 画面分析 |
| 16 | `POST /generate/image2360hdri` | 🆕（低优） | — | image | 全景环境贴图彩蛋 |
| 17 | `POST /generate/image2videomsr` | ❌ 停用（2026-08-25 起弃用，改走 fl2va） | video_generate（旧） | prompt, width, height, duration=5, fps=30, image1~4, background(**必填**) | 后端 ltx_msr_workflow 崩溃返回 500，临时停用；单图/文生改走 fl2va |
| 18 | `POST /generate/image2videomkr` | ❌ 停用（2026-08-25 起弃用，改走 ref2va） | video_composite（≥3 图旧路径） | prompt, width, height, duration=10, fps=30, images[{image, frame_index}]≤5 | 多关键帧精确控帧位；改为 ref2va 多参考（后端自动排布，丢帧位控制） |
| 19 | `POST /generate/image2videomkrgrid` | ⚠️→P11 | video_generate mode=mkrgrid | gridtype∈{4,6,9}, frame_indexs 长度=gridtype | 宫格视频 |
| 20 | `POST /generate/image2videofl2va` | ✅（2026-08-24 起；2026-08-25 扩展至 video_generate 首帧/文生） | video_generate（首帧/文生）+ video_composite 双图 | aspect(16:9\|9:16), megapixels=0.4, duration=5, image1 首帧, image2 尾帧（均可选） | 首尾帧插值；两图合成**优先走此接口**；video_generate 不传 filename 即纯文生、传则首帧；1:1 画幅就近落 16:9 |
| 21 | `POST /generate/image2videoref2va` | ✅（2026-08-25 接线） | video_composite ≥3 图（+ video_generate 可扩展） | aspect, megapixels, duration, image1~6 | 多参考一致性最强；≥3 图统一走此接口，最多 6 张，超出自动采样 |
| 22 | `GET /` | ❓ | — | — | api.md 称返回 message，实测 500 |
| ★ | `/generate/deduction` | ❌ | deduction 工具（一期） | — | **不在 api.md，实测 404，端点已不存在**；skill 已停止教学，待后端澄清 |

## 3. 分场景使用指南

### 3.1 分镜拆解（P8 闭环后）

```
storyboard_generate(prompt=每行一个场景, gridnum=N)
  └─► 得网格分镜图 URL
storyboard_split(该图上传后 filename, row×column 由 N 推导: 4→2x2 / 6→2x3 / 9→3x3)
  └─► images[] 每格一张 → 自动落画布为独立单镜节点
```

- prompt 必须每行一个场景，行数 = gridnum
- 单镜节点可独立：重试 / inpaint(P11) / 作视频首帧

### 3.2 定妆与一致性

| 手段 | 用法 | 适用 |
| --- | --- | --- |
| 定妆照（现状） | image_generate 出主角图，后续镜头以其 filename 作参考 | 通用 |
| 真·四视图（P11） | character_sheet(image=定妆照) → 三视角立绘白底图作全片锚点 | 角色一致性要求高 |
| 风格统一 | style_transfer(image1=新镜, image2=首图) | 逐镜风格漂移时 |
| IPA 精细控制（P11） | ipastyletransfer(prompt, ref_image=风格基准, image1~3=内容参考) | 姿态+外观双控 |

### 3.3 逐镜出图

- 写实：txt2image；动漫：txt2imageanime（P11 起 via `style` 参数）
- 要角色一致：image2image 带 image1=定妆照 filename（P8 起可带至 3 张参考）
- 画幅全程统一（16:9 / 9:16 / 1:1），不要混用

### 3.4 视频生成接口详解（5 个）

选型速查：

| 场景 | 端点/mode | 输入要点 |
| --- | --- | --- |
| 单镜动态（默认） | fl2va（首帧/文生） | 不传 filename 纯文生；传则 image1 首帧；aspect 选画幅 |
| 两张图之间过渡 | fl2va | image1 首帧 + image2 尾帧，aspect 选画幅 |
| 多参考保角色 | ref2va | 最多 6 张参考（定妆+场景+道具），一致性最好 |
| 多关键帧精确控节奏 | mkr（❌ 2026-08-25 停用，改 ref2va） | images≤5，frame_index=时间点×fps |
| 宫格多机位 | mkrgrid | gridtype 4/6/9，frame_indexs 数量须等于 gridtype |

#### 3.4.1 `image2videomsr` —— 图生视频（单镜动态；❌ 2026-08-25 起停用，改走 fl2va）

```json
{
  "prompt": "…",
  "width": 1280, "height": 720,
  "duration": 5, "fps": 30,
  "image1": "参考图.png", "image2": "", "image3": "", "image4": "",
  "background": "背景图.png"
}
```

- **background 必填**（单镜首图），image1~4 可选参考
- 默认 640×320，**必须显式传宽高**（本地 `sizeForAspectRatio`：16:9→1280×720、9:16→720×1280、1:1→1024×1024）
- duration 整数，默认 5；本地钳制 ≤15s（建议 8–10）
- prompt 按 H3 规范写首帧锚点式结构（规范蒸馏在 creation-spec skill，原文见 MiniMax-AI/MiniMax-H3 仓库）

#### 3.4.2 `image2videofl2va` —— 首尾帧插值（`video_composite` 双图路径在用 ✅）

```json
{
  "prompt": "…",
  "aspect": "16:9", "megapixels": 0.4,
  "duration": 5,
  "image1": "首帧.png", "image2": "尾帧.png"
}
```

- **用 aspect + megapixels，不传宽高**（与 msr/mkr 的参数风格不同，勿混）
- aspect 仅 `16:9` / `9:16`；1:1 画幅就近落 16:9
- 偏好单镜头连续插值；prompt 描述首帧→尾帧的运动路径（H3 FL2VA 结构）

#### 3.4.3 `image2videomkr` —— 多关键帧合成（❌ 2026-08-25 起停用，改走 ref2va）

```json
{
  "prompt": "…", "width": 1280, "height": 720,
  "duration": 10, "fps": 30,
  "images": [
    { "image": "a.png", "frame_index": 0 },
    { "image": "b.png", "frame_index": 150 },
    { "image": "c.png", "frame_index": -1 }
  ]
}
```

- 最多 5 个关键帧；`frame_index` = 时间点×fps（整数），**末帧固定 -1** 标记结束
- 本地按时间轴均分：`round(index/(n-1) × duration×fps)`

#### 3.4.4 `image2videomkrgrid` —— 宫格视频（未接线，P11）

```json
{
  "prompt": "…", "width": 640, "height": 320,
  "duration": 12, "fps": 30,
  "image": "输入图.png",
  "gridtype": 4, "frame_indexs": [0, 90, 180, 360]
}
```

- gridtype 仅 4/6/9；`frame_indexs` 长度必须等于 gridtype

#### 3.4.5 `image2videoref2va` —— 多参考一致性视频（✅ 2026-08-25 已接线）

```json
{
  "prompt": "…", "aspect": "16:9", "megapixels": 0.4, "duration": 5,
  "image1": "定妆.png", "image2": "场景.png", "image3": "", "image4": "", "image5": "", "image6": ""
}
```

- 最多 6 张参考（定妆+场景+道具），角色/场景一致性最强；aspect 风格同 fl2va

#### 3.4.6 通用注意

- 全部**同步阻塞**；错误码 400/500/502（客户端已有超时+一次重试+错误体透出）
- 时长统一钳制 ≤15s（`clampDuration`）；长片走 P9 本地拼接
- 输入 filename 一律来自 `uploadimage`；上传表单文件名必须唯一且只含 `[\w.\-]`（带空格括号的后端去重名会导致下游 500，已修复）
- 请求体契约有自动化测试守护（`tests/generate.test.mjs` "api.md 契约" 4 例）

### 3.5 辅助

- prompt_enhance：创意阶段打磨描述；输出取 `output` 字段
- image2vl：分析画面/归纳参考帧风格（P8 参考视频路线用它做风格归纳）
- ~~deduction~~：❌ 端点已 404，不要调用

### 3.6 上传

- 图片一律走 `uploadimage`（form-data `file` 字段）
- **响应取 `name` 字段，不是 `filename`**。实测返回 `{"name":"small.png","subfolder":"","type":"input"}`，
  没有 `success` 字段。canvas-studio 的 `upload_image` 已兼容 `{filename}` / `{name}` /
  `{data:{filename}}` 三种形态，实测结构可直接消费。
- **不要用 `/generate/upload`**：2026-08-31 实测确认不可用（任何请求形态 500，含空 body），
  已从 api.md 移除。大文件改为客户端先压缩再走 uploadimage。

## 4. 参数速查

| 端点族 | 参考图上限 | 画幅参数 | 时长/帧 |
| --- | --- | --- | --- |
| image2image | image1~3 | width/height | steps 固定 4 |
| txt2image(-anime) | — | width/height | steps 固定 8 |
| videomsr（❌ 2026-08-25 停用） | image1~4 + background(必填) | width/height（默认 640×320！） | duration 默认 5s, fps 30 |
| videomkr（❌ 2026-08-25 停用） | images ≤5 关键帧 | width/height | duration 默认 12s；frame_index=duration×fps |
| videomkrgrid | 单图宫格 | width/height | gridtype∈{4,6,9} |
| fl2va / ref2va | fl2va 2 帧 / ref2va ≤6 张 | **aspect + megapixels**（不是像素） | duration 默认 5s |
| storyboard | image 可选 | width（单项宽） | gridnum 默认 4 |
| splitegrid | image | target_width/target_height | row/column 任意组合 |

## 5. 待后端确认清单

1. `deduction` 是否废弃/迁移？一期工具有 UI 入口但端点 404
2. ~~流式上传 `/generate/upload` 响应只有 `{status}`，下游如何拿到 filename？~~
   → **2026-08-31 已证实不是契约问题**：端点任何形态均 500（含空 body），本身是坏的。
   待确认项改为：后端是否修复？若修复需同步给出入参契约与文件名返回方式。
3. 鉴权规划：是否将引入 API key 校验（决定 `DRAMA_API_KEY` 发送或移除）
4. 视频/音频 roadmap：参考视频条件生成（两步走的 b 步）、TTS/BGM 端点是否规划
5. 根路径 `GET /` 返回 500是否符合预期

## 6. 变更记录

- 2026-08-24 初版：按 api.md v0.2.0 全量盘点 22 端点 + deduction 存疑项；首轮探测（health ✅、deduction 404、其余新端点已路由）；确定 P8 抽帧路线绕开流式上传。
- 2026-08-24 二次修订：video_composite 双图路径接通 **fl2va**（首尾帧插值优先）；全部视频生成**时长钳制 ≤15s**（默认 10，建议 8–10，长片走 P9 本地拼接）；callDrama 加超时（图片 360s / 视频 600s / 文本 60s，验收反馈后翻倍）与一次性自动重试；后端视频模型确认为开源 **MiniMax H3**（`h3_*` 工作流），官方提示词规范已蒸馏进 creation-spec skill（原文属第三方材料，按 .gitignore reference/ 规则仅存本地不入库）。
- 2026-08-24 三次修订：§3.4 扩写为五个视频端点的完整参数/示例详解；修复上传文件名缺陷（表单名唯一化 `ref-xxxxxxxx.png`，杜绝后端去重产生带空格括号的 filename 导致下游 500）；错误信息透出后端响应体片段；新增 4 个 api.md 请求体契约测试（31 项全绿）。
- 2026-08-25 四次修订：视频生成收敛为仅 **fl2va + ref2va** 两个接口（msr 后端 500 停用、mkr 改 ref2va）；video_generate 走 fl2va（支持文生视频 / 首帧两种模式），video_composite 双图走 fl2va 首尾帧、≥3 图走 ref2va（最多 6 张，超出自动采样保首尾）；config 移除 videoMsr/videoMkr/videoMkrGrid、新增 videoRef2va；契约测试 msr/mkr 断言改为 fl2va/ref2va。
- 2026-08-31 五次修订（上传接口实测校准）：直连 `http://117.50.108.73:8082` 实测两个上传端点——
  ① `uploadimage` 可用，但**响应是 ComfyUI UploadImage 原生结构 `{name, subfolder, type}`**，无 `success`、
  文件名键是 `name`（§1 第 9 行、§3.6 同步更正；canvas-studio `upload_image` 已兼容 `{name}`，代码无需改）；
  ② `generate/upload` **任何请求形态均 500**（含空 body），判为坏端点，从 api.md 移除并在此标为停用，
  大文件出路改为客户端先压缩。§5 待确认清单第 2 条由"契约不明"改为"后端是否修复"。
