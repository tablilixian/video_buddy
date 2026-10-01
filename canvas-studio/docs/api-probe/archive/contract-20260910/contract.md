# Drama Backend 契约探测报告（串行实测）

- 后端：`http://117.50.108.73:8082`（健康检查 200）
- 时间：2026/9/10 20:19:44 · 套件：quick · 用例 21 个 · 全程串行

> 后端单任务同步：并发不会加速，只会排队（或被入口拒）。本报告所有耗时均为**独占后端**时测得。

## 一、OpenAPI 契约（必填 / 可选 / 默认值）

| 端点 | 必填字段 | 可选字段（默认值） |
| --- | --- | --- |
| `POST /api/v1/generate/txt2image` | **prompt** | width(=1024), height(=768) |
| `POST /api/v1/generate/txt2imageanime` | **prompt** | width(=1024), height(=768) |
| `POST /api/v1/generate/image2image` | **prompt** | width(=1024), height(=768), image1(=""), image2(=""), image3(="") |
| `POST /api/v1/generate/image2character` | （无） | image(="") |
| `POST /api/v1/generate/image2styletransfer` | （无） | image1(=""), image2(=""), prompt(=""), enhance(=false) |
| `POST /api/v1/generate/image2ipastyletransfer` | **prompt** | width(=1024), height(=768), image1(=""), image2(=""), image3(=""), ref_image(=""), enhance(=false) |
| `POST /api/v1/generate/image2storyboard` | **prompt** | gridnum(=4), width(=1024), image(="") |
| `POST /api/v1/generate/image2inpaint` | **prompt** | image(="") |
| `POST /api/v1/generate/image2360hdri` | （无） | image(="") |
| `POST /api/v1/generate/image2vl` | **system_prompt**, **prompt** | image(="") |
| `POST /api/v1/generate/image2promptenhance` | **prompt** | （无） |
| `POST /api/v1/generate/image2splitegrid` | （无） | row(=2), column(=2), target_width(=1024), target_height(=768), image(="") |
| `POST /api/v1/generate/image2videomsr` | **prompt**, **background** | width(=640), height(=320), duration(=5), fps(=30), image1(=""), image2(=""), image3(=""), image4(="") |
| `POST /api/v1/generate/image2videomkr` | **prompt** | width(=640), height(=320), duration(=12), fps(=30), images(=[]) |
| `POST /api/v1/generate/image2videomkrgrid` | **prompt** | width(=640), height(=320), duration(=12), fps(=30), image(=""), gridtype(=4), frame_indexs |
| `POST /api/v1/generate/image2videofl2va` | **prompt** | aspect(="16:9"), megapixels(=0.4), duration(=5), image1(=""), image2(="") |
| `POST /api/v1/generate/image2videoref2va` | **prompt** | aspect(="16:9"), megapixels(=0.4), duration(=5), image1(=""), image2(=""), image3(=""), image4(=""), image5(=""), image6(=""), image7(=""), image8(=""), image9(=""), video1(=""), video2(=""), video3(=""), audio1(=""), audio2(=""), audio3(="") |
| `POST /api/v1/generate/txt2audio` | **caption_prompt**, **lyrics_prompt** | duration(=30), bpm(=128), keyscale(="Bb major"), language(="en"), timesignature(="4") |

> 来源：`GET /openapi.json`（后端自述，唯一权威）。「实测」一节再验证这些声明是否与真实行为一致——历史上出现过「文档写必填、实际有默认值」和「文档写可选、实际不传就 500」两种偏差。

## 二、实测结果

| # | 用例 | HTTP | 耗时 | 响应摘要 |
| ---: | --- | ---: | ---: | --- |
| 0 | openapi | 200 | 106ms | {"openapi":"3.1.0","info":{"title":"Drama Server","description":"Now,API for interacting with ComfyUI workflow |
| 1 | upload.real | 200 | 64ms | {"name":"ref-faa09791.png","subfolder":"","type":"input"} |
| 2 | image2promptenhance.baseline | 200 | 9520ms | {"prompt_id":"5e2e2dc5-2860-4e60-98d3-83b56ac5d984","output":"A close-up shot of a single, ripe red apple rest |
| 3 | image2promptenhance.missing.prompt | 422 | 66ms | {"detail":[{"type":"missing","loc":["body","prompt"],"msg":"Field required","input":{}}]} |
| 4 | image2promptenhance.wrongtype.prompt | 422 | 28ms | {"detail":[{"type":"string_type","loc":["body","prompt"],"msg":"Input should be a valid string","input":12345} |
| 5 | txt2image.baseline | 200 | 15800ms | {"prompt_id":"1346cf98-2a8e-4765-ad20-7f994af25b9c","filename":"z-image_00836_.png","full_url":"http://117.50. |
| 6 | txt2image.missing.prompt | 422 | 26ms | {"detail":[{"type":"missing","loc":["body","prompt"],"msg":"Field required","input":{}}]} |
| 7 | txt2image.wrongtype.width | 422 | 25ms | {"detail":[{"type":"int_parsing","loc":["body","width"],"msg":"Input should be a valid integer, unable to pars |
| 8 | txt2image.wrongtype.prompt | 422 | 30ms | {"detail":[{"type":"string_type","loc":["body","prompt"],"msg":"Input should be a valid string","input":12345} |
| 9 | image2image.baseline | 500 | 1091ms | Internal Server Error |
| 10 | image2image.missing.prompt | 422 | 52ms | {"detail":[{"type":"missing","loc":["body","prompt"],"msg":"Field required","input":{"image1":"ref-faa09791.pn |
| 11 | image2image.wrongtype.width | 422 | 34ms | {"detail":[{"type":"int_parsing","loc":["body","width"],"msg":"Input should be a valid integer, unable to pars |
| 12 | image2image.wrongtype.prompt | 422 | 28ms | {"detail":[{"type":"string_type","loc":["body","prompt"],"msg":"Input should be a valid string","input":12345} |
| 13 | image2image.ghost.image1 | 500 | 159ms | Internal Server Error |
| 14 | image2image.nofile | 200 | 28175ms | {"prompt_id":"959adbdb-0313-47e9-96f2-3050a0f212bd","filename":"img_01261_.png","full_url":"http://117.50.108. |
| 15 | image2vl.baseline | 500 | 87ms | Internal Server Error |
| 16 | image2vl.missing.system_prompt | 422 | 60ms | {"detail":[{"type":"missing","loc":["body","system_prompt"],"msg":"Field required","input":{"prompt":"what is  |
| 17 | image2vl.missing.prompt | 422 | 26ms | {"detail":[{"type":"missing","loc":["body","prompt"],"msg":"Field required","input":{"system_prompt":"You are  |
| 18 | image2vl.wrongtype.system_prompt | 422 | 29ms | {"detail":[{"type":"string_type","loc":["body","system_prompt"],"msg":"Input should be a valid string","input" |
| 19 | image2vl.ghost.image | 500 | 69ms | Internal Server Error |
| 20 | image2vl.nofile | 200 | 12646ms | {"prompt_id":"6e9400a4-036e-4558-8c36-5998b2e80be6","output":"This image depicts a man dressed in traditional  |

## 三、怎么读这张表

- `.baseline` 成功 → 该端点的可选字段确实可选（可以不传）。
- `.missing.<字段>` 返回 **422** 且 detail 指向该字段 → 真必填；返回 **200** → 文档写了必填、后端有默认值，实际不传也行；返回 **500** → 后端没做参数校验，缺失会一路崩到内部（这类最危险，客户端必须自己兜底）。
- `.ghost.<字段>` 返回 500 → 「文件名在、文件不在」被后端当成内部错误，客户端**无法**从状态码区分「文件名拼错」与「后端故障」，只能靠上游保证句柄有效（canvas-studio 的 `ref-<uuid>.<ext>` 自造唯一名就是为此）。
- `.wrongtype` 返回 422 → 后端有类型校验，可放心把错误直接回显给用户；返回 500/200 → 类型错误被吞，需在工具层预校验。

> 原始响应当见同目录 `raw.json`。
