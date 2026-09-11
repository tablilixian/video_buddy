# 用文生图生成素材复验带文件端点

- 后端：`http://117.50.108.73:8082`（健康检查 200） · 时间：2026/9/10 22:11:54 · 全程串行
- 流程：`txt2image` 生成 → 下载到本地 → 上传回后端拿 `ref-*` 句柄 → 用句柄调用带文件端点（生产同款）

## 一、生成的测试素材

| 素材 | 用途 | 产物文件名 | 尺寸 | 上传句柄 |
| --- | --- | --- | --- | --- |
| 角色三视图（正/侧/背） | `sheet` | z-image_00839_.png | 1024×768（550KB） | `ref-sheet-6ed6b279.png` |
| 电影感单帧（图生视频首帧） | `frame` | z-image_00840_.png | 1024×768（974KB） | `—` |

## 二、带文件端点实测

| 端点 | 文件字段 | HTTP | 耗时 | 判定 | 响应摘要 |
| --- | --- | ---: | ---: | --- | --- |
| `image2vl` | image | 200 | 6651ms | ✅ 成功 | {"prompt_id":"c7022cb8-5577-44b0-a1b9-8b495f08c7a0","output":"The image displays a man wearing a navy blue dou |
| `image2image` | image1 | 200 | 25134ms | ✅ 成功 | {"prompt_id":"260b5f1b-7e74-4c25-b7d2-5b068fc09f6e","filename":"img_01271_.png","full_url":"http://117.50.108. |
| `image2character` | image | 200 | 68926ms | ✅ 成功 | {"prompt_id":"2c163fde-9d93-4cd0-a29f-4a8172c7ed2b","filename":"img_01272_.png","full_url":"http://117.50.108. |

## 三、原始响应

```json
[
  {
    "endpoint": "image2vl",
    "field": "image",
    "handle": "ref-sheet-6ed6b279.png",
    "status": 200,
    "ms": 6651,
    "text": "{\"prompt_id\":\"c7022cb8-5577-44b0-a1b9-8b495f08c7a0\",\"output\":\"The image displays a man wearing a navy blue double-breasted trench coat from three different angles—front, side, and back—against a plain white background. He is dressed formally with a shirt, tie, trousers, and black shoes, showcasing the coat's tailored design and features like epaulets and a waist belt.\",\"duration\":6.55}"
  },
  {
    "endpoint": "image2image",
    "field": "image1",
    "handle": "ref-sheet-6ed6b279.png",
    "status": 200,
    "ms": 25134,
    "text": "{\"prompt_id\":\"260b5f1b-7e74-4c25-b7d2-5b068fc09f6e\",\"filename\":\"img_01271_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01271_.png\",\"duration\":25.05}"
  },
  {
    "endpoint": "image2character",
    "field": "image",
    "handle": "ref-sheet-6ed6b279.png",
    "status": 200,
    "ms": 68926,
    "text": "{\"prompt_id\":\"2c163fde-9d93-4cd0-a29f-4a8172c7ed2b\",\"filename\":\"img_01272_.png\",\"full_url\":\"http://117.50.108.73:8082/view?filename=img_01272_.png\",\"duration\":68.87}"
  }
]
```
