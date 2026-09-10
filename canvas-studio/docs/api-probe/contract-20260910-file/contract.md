# Drama Backend 契约探测报告（串行实测）

- 后端：`http://117.50.108.73:8082`（健康检查 200）
- 时间：2026/9/10 20:17:42 · 套件：full · 用例 12 个 · 全程串行

> 后端单任务同步：并发不会加速，只会排队（或被入口拒）。本报告所有耗时均为**独占后端**时测得。

## 实测结果

| # | 用例 | HTTP | 耗时 | 响应摘要 |
| ---: | --- | ---: | ---: | --- |
| 0 | openapi | 200 | 70ms | {"openapi":"3.1.0","info":{"title":"Drama Server","description":"Now,API for interacting with ComfyUI workflow |
| 1 | upload.real | 200 | 54ms | {"name":"ref-edb15b93.png","subfolder":"","type":"input"} |
| 2 | image2character.baseline | 500 | 1195ms | Internal Server Error |
| 3 | image2character.wrongtype.image | 422 | 59ms | {"detail":[{"type":"string_type","loc":["body","image"],"msg":"Input should be a valid string","input":12345}] |
| 4 | image2character.ghost.image | 500 | 57ms | Internal Server Error |
| 5 | image2character.nofile | 200 | 72937ms | {"prompt_id":"ecdae263-9d6c-4bd7-a02a-5147ae57da47","filename":"img_01260_.png","full_url":"http://117.50.108. |
| 6 | image2videofl2va.baseline | 500 | 1290ms | Internal Server Error |
| 7 | image2videofl2va.missing.prompt | 422 | 56ms | {"detail":[{"type":"missing","loc":["body","prompt"],"msg":"Field required","input":{"duration":5,"image1":"re |
| 8 | image2videofl2va.wrongtype.megapixels | 422 | 28ms | {"detail":[{"type":"float_parsing","loc":["body","megapixels"],"msg":"Input should be a valid number, unable t |
| 9 | image2videofl2va.wrongtype.prompt | 422 | 25ms | {"detail":[{"type":"string_type","loc":["body","prompt"],"msg":"Input should be a valid string","input":12345} |
| 10 | image2videofl2va.ghost.image1 | 500 | 58ms | Internal Server Error |
| 11 | image2videofl2va.nofile | 200 | 151721ms | {"prompt_id":"03bd89a9-c4f8-43f9-b0f5-235668e7c578","filename":"MiniMax_H3_00301_.mp4","full_url":"http://117. |

## 怎么读这张表

- `.baseline` 成功 → 该端点的可选字段确实可选（可以不传）。
- `.missing.<字段>` 返回 **422** 且 detail 指向该字段 → 真必填；返回 **200** → 文档写了必填、后端有默认值，实际不传也行；返回 **500** → 后端没做参数校验，缺失会一路崩到内部（这类最危险，客户端必须自己兜底）。
- `.ghost.<字段>` 返回 500 → 「文件名在、文件不在」被后端当成内部错误，客户端**无法**从状态码区分「文件名拼错」与「后端故障」，只能靠上游保证句柄有效（canvas-studio 的 `ref-<uuid>.<ext>` 自造唯一名就是为此）。
- `.wrongtype` 返回 422 → 后端有类型校验，可放心把错误直接回显给用户；返回 500/200 → 类型错误被吞，需在工具层预校验。

> 原始响应当见同目录 `raw.json`。
