# 带文件参数端点复验（文件来源作自变量）

- 后端：`http://117.50.108.73:8082`（健康检查 200）
- 时间：2026/9/10 21:50:56 · 全程串行（后端单任务同步）
- 真实图片：`/Users/lilixian/jobs/AI/video_buddy/assets/desktop-preview.png`（314KB，2654×1838）

## 一、上传句柄

| 来源 | 文件名 | 上传结果 |
| --- | --- | --- |
| real | `ref-real-b4e201ff.png` | 200 / 2165ms |
| tiny | `ref-tiny-6b8be668.png` | 200 / 39ms |
| legacy | `ref-8e6fce70.png` | （旧句柄，未重新上传） |

## 二、实测矩阵

| 端点 | 文件来源 | HTTP | 耗时 | 判定 | 响应摘要 |
| --- | --- | ---: | ---: | --- | --- |
| `image2image` | real | 200 | 24807ms | ✅ 成功 | {"prompt_id":"77689dd8-a9e3-499e-b139-31315684050c","filename":"img_01262_.png","full_url" |
| `image2image` | tiny | 500 | 1150ms | ❌ 500 快失败(入口/读取阶段) | Internal Server Error |
| `image2image` | legacy | 200 | 10546ms | ✅ 成功 | {"prompt_id":"156c39bc-65ba-48c8-81bb-bdee942be49d","filename":"img_01263_.png","full_url" |
| `image2image` | ghost | 500 | 34ms | ❌ 500 快失败(入口/读取阶段) | Internal Server Error |
| `image2image` | nofile | 200 | 10507ms | ✅ 成功 | {"prompt_id":"0ddb93f8-5913-48be-9049-8ea15c095eeb","filename":"img_01264_.png","full_url" |
| `image2vl` | real | 200 | 7350ms | ✅ 成功 | {"prompt_id":"3d9fd11e-78fe-4276-b79e-7e93ac79b047","output":"This is a screenshot of the  |
| `image2vl` | tiny | 500 | 1076ms | ❌ 500 快失败(入口/读取阶段) | Internal Server Error |
| `image2vl` | legacy | 200 | 3225ms | ✅ 成功 | {"prompt_id":"f5f84a18-4328-4ba1-8a97-76c1cacc45f5","output":"A lone figure in red walks t |
| `image2vl` | ghost | 500 | 31ms | ❌ 500 快失败(入口/读取阶段) | Internal Server Error |
| `image2vl` | nofile | 200 | 3220ms | ✅ 成功 | {"prompt_id":"89ba4f8e-2cd7-42fd-b38d-10ea4c9c2d71","output":"A man in traditional Chinese |

## 三、原始响应

```json
[
  {
    "endpoint": "image2image",
    "source": "real",
    "status": 200,
    "ms": 24807,
    "text": "{\"prompt_id\":\"77689dd8-a9e3-499e-b139-31315684050c\",\"filename\":\"img_01262_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01262_.png\",\"duration\":24.7}"
  },
  {
    "endpoint": "image2image",
    "source": "tiny",
    "status": 500,
    "ms": 1150,
    "text": "Internal Server Error"
  },
  {
    "endpoint": "image2image",
    "source": "legacy",
    "status": 200,
    "ms": 10546,
    "text": "{\"prompt_id\":\"156c39bc-65ba-48c8-81bb-bdee942be49d\",\"filename\":\"img_01263_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01263_.png\",\"duration\":10.46}"
  },
  {
    "endpoint": "image2image",
    "source": "ghost",
    "status": 500,
    "ms": 34,
    "text": "Internal Server Error"
  },
  {
    "endpoint": "image2image",
    "source": "nofile",
    "status": 200,
    "ms": 10507,
    "text": "{\"prompt_id\":\"0ddb93f8-5913-48be-9049-8ea15c095eeb\",\"filename\":\"img_01264_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01264_.png\",\"duration\":10.46}"
  },
  {
    "endpoint": "image2vl",
    "source": "real",
    "status": 200,
    "ms": 7350,
    "text": "{\"prompt_id\":\"3d9fd11e-78fe-4276-b79e-7e93ac79b047\",\"output\":\"This is a screenshot of the DeepSeek Harness AI coding assistant interface, showing an initial greeting and its capabilities for code editing, debugging, searching, and architecture planning within a workspace environment.\",\"duration\":7.2"
  },
  {
    "endpoint": "image2vl",
    "source": "tiny",
    "status": 500,
    "ms": 1076,
    "text": "Internal Server Error"
  },
  {
    "endpoint": "image2vl",
    "source": "legacy",
    "status": 200,
    "ms": 3225,
    "text": "{\"prompt_id\":\"f5f84a18-4328-4ba1-8a97-76c1cacc45f5\",\"output\":\"A lone figure in red walks through a rain-slicked courtyard of traditional wooden buildings at night, their warm lanterns glowing against the dark, stormy sky.\",\"duration\":3.08}"
  },
  {
    "endpoint": "image2vl",
    "source": "ghost",
    "status": 500,
    "ms": 31,
    "text": "Internal Server Error"
  },
  {
    "endpoint": "image2vl",
    "source": "nofile",
    "status": 200,
    "ms": 3220,
    "text": "{\"prompt_id\":\"89ba4f8e-2cd7-42fd-b38d-10ea4c9c2d71\",\"output\":\"A man in traditional Chinese robes sits solemnly in a dimly lit room, illuminated by the warm glow of candles against wooden paneling and pillars.\",\"duration\":3.17}"
  }
]
```
