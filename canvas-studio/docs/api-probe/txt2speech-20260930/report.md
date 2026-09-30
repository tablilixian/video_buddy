# 语音合成（`txt2speech` / VoxCPM2）取证报告

**日期**：2026-09-30 ｜ **后端**：`117.50.108.73:8082`（无鉴权、单任务串行）
**触发**：CV-271「`tts_voiceover` 占位升真 —— 接入后端 0.8.0 的 `txt2speech` 语音合成端点」—— 接线前确认耗时、产物形态、时长口径与错误形态。
**结论一句话**：**通道全通**（声音设计直打 200 / 14.4s，普通话男声合成自然）；**产物是 mp3（后端文档写 flac，以实测为准）**；`duration` 仍是服务端耗时（14.34s）≠ 音频真值（ffprobe 5.16s）。

---

## 一、探针记录（串行，curl 直打）

| # | 动作 | 结果 | 判读 |
|---|---|---|---|
| 1 | `POST /api/v1/generate/txt2speech`（声音设计：青年男性 / 平静低沉 / 标准普通话 / 中速；文本 22 字） | **200 / 14.4s**，`duration: 14.34` | 通道可用，产物 `voxcpm_00012.mp3` |
| 2 | `GET /view?filename=voxcpm_00012.mp3` | **200**，`audio/mpeg`，94KB | 产物可正常取回 |
| 3 | ffprobe 实测产物 | **5.16s**，mp3 64kbps / 48kHz / 单声道 | ⚠️ 与响应 `duration`（14.34s）**差 2.8 倍** —— 再证「`duration` = 服务端生成耗时」全端点通用口径 |
| 4 | `POST` 缺 `txt_prompt`（只发 `instruct_prompt`） | **422 / 0.021s**，`loc: ["body","txt_prompt"]` | 字段级校验，**快失败**、字段名精确可回显 |

探针 1 原始响应（`resp.json`）：

```json
{
  "prompt_id": "5b0a4985-b893-4bc2-bd8e-f11c435acce3",
  "filename": "voxcpm_00012.mp3",
  "full_url": "http://117.50.108.73:8082/view?filename=voxcpm_00012.mp3",
  "duration": 14.34
}
```

请求体：

```json
{
  "instruct_prompt": "青年男性，平静低沉，标准普通话，中速",
  "txt_prompt": "夜色像潮水一样漫过窗台，他在灯下写完了最后一行字。"
}
```

**听感判读**：男声、语速平缓、普通话标准、断句自然 —— `instruct_prompt` 的自然语言声音设计**生效**（后端文档口径：语言 / 性别 / 年龄 / 语气 / 情感 / 语速 / 方言都用自然语言写，支持 30 种语言 + 9 种中文方言）。

---

## 二、由探针直接决定的实现选择

| 选择 | 依据 |
|---|---|
| **超时维持 audio/文本档**（本仓随 `txt2audio` 同类同步音频端点走） | 14.4s 对 22 字；耗时随文本长度增长但不剧烈，复用现有档位即可 |
| **产物节点 `duration` 必须本地 ffprobe 实测** | 探针 3：服务端 `duration` 与真值差 2.8 倍 —— 与 `music_generation` / 视频同款纪律（落盘后 `probeMediaDuration`） |
| **产物名按「后端产物名」类处理** | `voxcpm_*` 前缀非上传句柄；本端点无文件入参不触发，但下游引用仍走 `@ref` 换句柄 |
| **工具描述写「时长由文本决定，无 duration 参数」** | 契约无时长入参；要控时长只能增删文本 |
| **`refaudio` 克隆通道按文档接入、标注未实测** | 本轮探针只测声音设计（用户拍板）；克隆纪律（上传句柄）与全局 filename 纪律同型，风险低 |

---

## 三、与后端 0.8.0 文档的出入（以实测为准）

1. **产物格式**：文档写「输出格式为 flac」（示例 `voxcpm_00001_.flac`），实测 **`voxcpm_00012.mp3`（audio/mpeg）**。工具与文档按 mp3 口径收录。
2. **产物名尾缀**：文档示例带尾下划线（`00001_.flac`），实测无（`00012.mp3`）—— 与 `txt2image_withtxt` 同款「尾缀不定式」，以「前缀 `voxcpm_*`」作识别依据。

---

## 四、可直接复现的命令

```bash
# 探针 1：声音设计合成（约 15s，占后端单任务槽位）
curl -s -X POST http://117.50.108.73:8082/api/v1/generate/txt2speech \
  -H 'content-type: application/json' \
  -d '{"instruct_prompt":"青年男性，平静低沉，标准普通话，中速","txt_prompt":"夜色像潮水一样漫过窗台，他在灯下写完了最后一行字。"}'

# 探针 2：取回产物（换上一步返回的 filename）
curl -s "http://117.50.108.73:8082/view?filename=voxcpm_00012.mp3" -o tts.mp3

# 探针 3：真值探测（对比响应 duration）
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 tts.mp3

# 探针 4：422 校验（快失败，成本≈0）
curl -s -X POST http://117.50.108.73:8082/api/v1/generate/txt2speech \
  -H 'content-type: application/json' -d '{"instruct_prompt":"青年男性"}'
```
