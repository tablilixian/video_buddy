# Krea2 Turbo 文生图链路探测（CV-190 前置证据）

- 日期：2026-09-16
- 后端：`http://117.50.108.73:8082`（`/api/v1/health` → `{"status":"ok"}`）
- 背景：API 文档 v0.3.0 称 `txt2image` 已用 **Krea2 Turbo**（`krea2_workflow.json`，steps=8、cfg=1.0）；用户确认 `txt2imageanime` **同样已切 Krea2 Turbo**（文档未更新）。本探测为「文生图 skill 切换 Krea2」提供行为证据。
- 原始响应：本目录 `*.json` / `openapi-20260916.json`。

## 结论速览

| 端点 | 产物 filename 前缀 | 判定 |
| --- | --- | --- |
| `POST /api/v1/generate/txt2image` | `krea2_00085_.png` | ✅ Krea2 Turbo 工作流（与文档一致） |
| `POST /api/v1/generate/txt2imageanime` | `Z-Anime_00063_.png` | ⚠️ 前缀仍是 Z-Anime（工作流 JSON 的 `filename_prefix` 未随模型切换改名）；按用户确认实际模型已是 Krea2 Turbo |
| `POST /api/v1/generate/image2image` | （CV-189 已证 `ComfyUI_*`） | ✅ Krea2 Edit |
| `POST /api/v1/generate/image2character` | `krea2_char_4view_00022_.png` | ✅ Krea2 四视图（`krea2_quadview.json`；代码/旧 skill 里的 `qwen_4view_char_2step` 已过时） |

## 负向提示词 A/B 实测（核心结论）

**`negative_prompt` 对 Krea2 Turbo 无效。**

- 同一 prompt（`A serene ocean sunset, golden sun disc low over calm waves`，1024×576）两次生成：
  - A 组：不带负向 → `krea2_00086_.png`
  - B 组：`negative_prompt: "sunset, sun, sun disc, golden sky, orange"` → `krea2_00087_.png`（HTTP 200，参数被接受但**不进工作流生效**——openapi `Text2ImageRequest` schema 仅 `prompt/width/height` 三字段，多余字段被 FastAPI 静默丢弃）
- `image2vl` 判图：
  - A：**有**太阳/落日盘，天空橙黄渐变
  - B：**仍**有太阳/落日，天空橙色与暖黄渐变 —— 负向词明确排除「sun disc / golden sky / orange」却毫无效果
- 机理佐证：cfg=1.0 时 KSampler 的 uncond 分支系数为 (cfg−1)=0，负向条件**结构性无效**（与 CV-189 已定案的 krea2_edit 同理）。

→ **skill 规则不变式：所有 Krea2 链路（文生图 / 图生图）一律禁传 `negativePrompt`，约束改写为正向表述。**

## 其它观测

- 生成耗时波动大（7–23s），与文档示例 3.6s 差一个量级——排队负载所致，不影响结论。
- `image2character` 用非角色图（海景）入参仍正常出四视图白底拼图（84.9s），前缀可作工作流判定依据。
- 产物名不可作带文件端点入参的既有结论（CV-155）不受影响；本次 VLM 判图前均先经 `/upload` 取句柄。

## 对本批改动的指导

1. 新文生图 skill 按 Krea2 Turbo 写：保留「禁传 negativePrompt」「步数/CFG 不可调」「偏好长提示词」三条骨架，模型名与技术描述改 Krea2 Turbo。
2. `character_generate` 工作流名改 `krea2_quadview.json`（steps=10、cfg=1.0）。
3. `txt2imageanime` 分支：模型描述统一为 Krea2 Turbo（文档未更新处以后端实测为准）。
