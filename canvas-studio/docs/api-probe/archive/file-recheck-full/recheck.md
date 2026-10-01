# 带文件参数端点复验（文件来源作自变量）

- 后端：`http://117.50.108.73:8082`（健康检查 200）
- 时间：2026/9/10 22:08:41 · 全程串行（后端单任务同步）
- 真实图片：`/Users/lilixian/jobs/AI/video_buddy/assets/desktop-preview.png`（314KB，2654×1838）

## 一、上传句柄

| 来源 | 文件名 | 上传结果 |
| --- | --- | --- |
| real | `ref-real-12d6d8a8.png` | 200 / 2153ms |
| tiny | `ref-tiny-0d03ff66.png` | 200 / 30ms |
| legacy | `ref-8e6fce70.png` | （旧句柄，未重新上传） |

## 二、实测矩阵

| 端点 | 文件来源 | HTTP | 耗时 | 判定 | 响应摘要 |
| --- | --- | ---: | ---: | --- | --- |
| `image2image` | real | 200 | 25019ms | ✅ 成功 | {"prompt_id":"36617083-42b5-4acb-856b-bfabfc31cb4a","filename":"img_01265_.png","full_url" |
| `image2vl` | real | 200 | 7319ms | ✅ 成功 | {"prompt_id":"7dddde42-35dc-43b4-978e-0993b3f2bcb7","output":"This is a screenshot of the  |
| `image2character` | real | 200 | 72676ms | ✅ 成功 | {"prompt_id":"195bb8f4-3430-4f61-8241-c8585a1a054b","filename":"img_01266_.png","full_url" |
| `image2character` | tiny | 500 | 56ms | ❌ 500 快失败(入口/读取阶段) | Internal Server Error |
| `image2character` | legacy | 200 | 57428ms | ✅ 成功 | {"prompt_id":"7668fad7-3445-45db-a343-594c0aa3e58d","filename":"img_01267_.png","full_url" |
| `image2character` | ghost | 500 | 33ms | ❌ 500 快失败(入口/读取阶段) | Internal Server Error |
| `image2character` | nofile | 200 | 57435ms | ✅ 成功 | {"prompt_id":"479d73db-6fb8-4dc7-afab-6b87bbf0841a","filename":"img_01268_.png","full_url" |
| `image2styletransfer` | real | 200 | 22247ms | ✅ 成功 | {"prompt_id":"2d414185-1b34-4bab-8d12-a64d81aa1d04","filename":"transfer_style_00035_.png" |
| `image2ipastyletransfer` | real | 200 | 76585ms | ✅ 成功 | {"prompt_id":"e6994918-dc5a-47d7-8280-330b3788c179","filename":"ipastyletransfer_00414_.pn |
| `image2storyboard` | real | 200 | 31330ms | ✅ 成功 | {"prompt_id":"21ab1a4e-cc89-403f-8612-68f7b3e9cf55","filename":"img_01269_.png","full_url" |
| `image2inpaint` | real | 200 | 31212ms | ✅ 成功 | {"prompt_id":"e98deca2-c345-420f-a2cb-83532533c141","filename":"img_01270_.png","full_url" |
| `image2360hdri` | real | 200 | 193484ms | ✅ 成功 | {"prompt_id":"616fe5f3-e8bf-4ed7-b33d-f26d138ce7e3","filename":"ComfyUI_00607_.png","full_ |
| `image2splitegrid` | real | 200 | 1189ms | ✅ 成功 | {"prompt_id":"9a76bb69-ca76-4410-9f2c-71681eac86af","images":[{"filename":"splitegrid_img_ |
| `image2videomsr` | real | 500 | 1116ms | ❌ 500 快失败(入口/读取阶段) | Internal Server Error |
| `image2videomkr` | real | 422 | 25ms | ⚠️ 入参被拒(422) | {"detail":[{"type":"model_attributes_type","loc":["body","images",0],"msg":"Input should b |
| `image2videomkrgrid` | real | 200 | 137842ms | ✅ 成功 | {"prompt_id":"e888f3ab-b328-427c-b35e-929ac7b7c29d","filename":"ltx_mkr_00159_.mp4","full_ |
| `image2videofl2va` | real | 200 | 196594ms | ✅ 成功 | {"prompt_id":"c24bed61-cc86-4340-9025-d4eb54f56cf6","filename":"MiniMax_H3_00302_.mp4","fu |
| `image2videoref2va` | real | 200 | 125597ms | ✅ 成功 | {"prompt_id":"41ec33f0-5151-4366-aa27-c65e49b808db","filename":"MiniMax_H3_00303_.mp4","fu |

## 三、原始响应

```json
[
  {
    "endpoint": "image2image",
    "source": "real",
    "status": 200,
    "ms": 25019,
    "text": "{\"prompt_id\":\"36617083-42b5-4acb-856b-bfabfc31cb4a\",\"filename\":\"img_01265_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01265_.png\",\"duration\":24.99}"
  },
  {
    "endpoint": "image2vl",
    "source": "real",
    "status": 200,
    "ms": 7319,
    "text": "{\"prompt_id\":\"7dddde42-35dc-43b4-978e-0993b3f2bcb7\",\"output\":\"This is a screenshot of the DeepSeek Harness AI coding assistant interface, where the user has just greeted it and received an introduction to its capabilities for code editing, debugging, searching, and architecture planning within a des"
  },
  {
    "endpoint": "image2character",
    "source": "real",
    "status": 200,
    "ms": 72676,
    "text": "{\"prompt_id\":\"195bb8f4-3430-4f61-8241-c8585a1a054b\",\"filename\":\"img_01266_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01266_.png\",\"duration\":72.64}"
  },
  {
    "endpoint": "image2character",
    "source": "tiny",
    "status": 500,
    "ms": 56,
    "text": "Internal Server Error"
  },
  {
    "endpoint": "image2character",
    "source": "legacy",
    "status": 200,
    "ms": 57428,
    "text": "{\"prompt_id\":\"7668fad7-3445-45db-a343-594c0aa3e58d\",\"filename\":\"img_01267_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01267_.png\",\"duration\":57.33}"
  },
  {
    "endpoint": "image2character",
    "source": "ghost",
    "status": 500,
    "ms": 33,
    "text": "Internal Server Error"
  },
  {
    "endpoint": "image2character",
    "source": "nofile",
    "status": 200,
    "ms": 57435,
    "text": "{\"prompt_id\":\"479d73db-6fb8-4dc7-afab-6b87bbf0841a\",\"filename\":\"img_01268_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01268_.png\",\"duration\":57.38}"
  },
  {
    "endpoint": "image2styletransfer",
    "source": "real",
    "status": 200,
    "ms": 22247,
    "text": "{\"prompt_id\":\"2d414185-1b34-4bab-8d12-a64d81aa1d04\",\"filename\":\"transfer_style_00035_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=transfer_style_00035_.png\",\"duration\":22.11}"
  },
  {
    "endpoint": "image2ipastyletransfer",
    "source": "real",
    "status": 200,
    "ms": 76585,
    "text": "{\"prompt_id\":\"e6994918-dc5a-47d7-8280-330b3788c179\",\"filename\":\"ipastyletransfer_00414_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=ipastyletransfer_00414_.png\",\"duration\":76.46}"
  },
  {
    "endpoint": "image2storyboard",
    "source": "real",
    "status": 200,
    "ms": 31330,
    "text": "{\"prompt_id\":\"21ab1a4e-cc89-403f-8612-68f7b3e9cf55\",\"filename\":\"img_01269_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01269_.png\",\"duration\":31.29}"
  },
  {
    "endpoint": "image2inpaint",
    "source": "real",
    "status": 200,
    "ms": 31212,
    "text": "{\"prompt_id\":\"e98deca2-c345-420f-a2cb-83532533c141\",\"filename\":\"img_01270_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01270_.png\",\"duration\":31.06}"
  },
  {
    "endpoint": "image2360hdri",
    "source": "real",
    "status": 200,
    "ms": 193484,
    "text": "{\"prompt_id\":\"616fe5f3-e8bf-4ed7-b33d-f26d138ce7e3\",\"filename\":\"ComfyUI_00607_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=ComfyUI_00607_.png\",\"duration\":193.43}"
  },
  {
    "endpoint": "image2splitegrid",
    "source": "real",
    "status": 200,
    "ms": 1189,
    "text": "{\"prompt_id\":\"9a76bb69-ca76-4410-9f2c-71681eac86af\",\"images\":[{\"filename\":\"splitegrid_img_5618745_00001_.png\",\"url\":\"http://117.50.108.73:8082/view?filename=splitegrid_img_5618745_00001_.png\"},{\"filename\":\"splitegrid_img_5618745_00002_.png\",\"url\":\"http://117.50.108.73:8082/view?filename=splitegrid_i"
  },
  {
    "endpoint": "image2videomsr",
    "source": "real",
    "status": 500,
    "ms": 1116,
    "text": "Internal Server Error"
  },
  {
    "endpoint": "image2videomkr",
    "source": "real",
    "status": 422,
    "ms": 25,
    "text": "{\"detail\":[{\"type\":\"model_attributes_type\",\"loc\":[\"body\",\"images\",0],\"msg\":\"Input should be a valid dictionary or object to extract fields from\",\"input\":\"ref-real-12d6d8a8.png\"}]}"
  },
  {
    "endpoint": "image2videomkrgrid",
    "source": "real",
    "status": 200,
    "ms": 137842,
    "text": "{\"prompt_id\":\"e888f3ab-b328-427c-b35e-929ac7b7c29d\",\"filename\":\"ltx_mkr_00159_.mp4\",\"full_url\":\"http://117.50.108.73:8082/view?filename=ltx_mkr_00159_.mp4\",\"duration\":137.68}"
  },
  {
    "endpoint": "image2videofl2va",
    "source": "real",
    "status": 200,
    "ms": 196594,
    "text": "{\"prompt_id\":\"c24bed61-cc86-4340-9025-d4eb54f56cf6\",\"filename\":\"MiniMax_H3_00302_.mp4\",\"full_url\":\"http://117.50.108.73:8082/view?filename=MiniMax_H3_00302_.mp4\",\"duration\":196.56}"
  },
  {
    "endpoint": "image2videoref2va",
    "source": "real",
    "status": 200,
    "ms": 125597,
    "text": "{\"prompt_id\":\"41ec33f0-5151-4366-aa27-c65e49b808db\",\"filename\":\"MiniMax_H3_00303_.mp4\",\"full_url\":\"http://117.50.108.73:8082/view?filename=MiniMax_H3_00303_.mp4\",\"duration\":125.44}"
  }
]
```
