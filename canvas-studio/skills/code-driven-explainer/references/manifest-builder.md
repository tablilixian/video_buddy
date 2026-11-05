# manifest-builder：用内容表生成 manifest（超过 12 轨必须用它）

> 工具本体：`assets/manifest-builder.mjs`（零依赖，复制进项目 `build/` 直接跑）
> 适用：`render_composition` 的轨道数 > 12，或总时长 > 20s，或需要「以第一版为锚点逐步丰富」

## 为什么规则是「>12 轨必须用脚本」

60–90 轨的 manifest 是一次 60–120KB 的 JSON。真机实测：模型手写到一半，单步 32,768 输出
预算被思考吃满，**一次都没写出来**（2026-11-05，3h37m 零成片）。

排版是确定性计算：句子帧窗、时长自洽、轨 id、首尾相接——全部能由代码算。模型只需要交
**内容表**（每句一行、每个视觉元素一条），把 token 花在「写什么」而不是「算帧号」。

## 五步

```bash
# ① 把脚本复制进项目（一次）
mkdir -p build && cp <skill>/assets/manifest-builder.mjs build/manifest-builder.mjs

# ② 写内容表 build/manifest-spec.json（见下）
# ③ 生成 + 自检（它会打印轨数 / 段表 / 断言结果）
node build/manifest-builder.mjs

# ④ 出片（先 draft，落画布让用户看得见）
#    render_composition({ manifestPath: "<项目绝对路径>/build/manifest.json", quality: "draft" })

# ⑤ 验帧（只看目标帧，不整片重渲）
#    render_composition({ manifestPath, spotFrames: [0, 300, 900] }) → 逐张 read_image
```

## spec 形状

```json
{
  "title": "玻璃为什么是透明的",
  "fps": 30,
  "aspect": "16:9",
  "theme": { "background": "#0b1220", "layer": "#111827", "accent": "#38bdf8" },
  "captions": [
    { "id": "V1", "text": "玻璃其实是……", "frames": 132, "src": "/canvas-studio/assets/vo1.mp3" },
    { "id": "V2", "text": "光线照上去时……", "frames": 168, "src": "/canvas-studio/assets/vo2.mp3" }
  ],
  "visuals": [
    { "id": "v-data", "type": "textCard", "variant": "dataCard", "at": "V2", "box": { "x": 50, "y": 38, "w": 60, "h": 26 }, "text": "96%", "subtitle": "可见光透过率" },
    { "id": "v-line", "type": "chart", "at": "V3", "until": "V5", "box": { "x": 50, "y": 55, "w": 70, "h": 40 }, "variant": "line", "labels": ["1950", "1980", "2020"], "values": [0.2, 0.6, 1.2] }
  ],
  "outro": { "text": "玻璃不是透明，是「不挡光」", "frames": 75 }
}
```

### 两条输入通道（二选一）

| 通道 | 何时用 | 帧数从哪来 |
|---|---|---|
| `captions[].frames` | **有旁白**（TTS 已合成） | `tts_voiceover` / `tts_narration` 的真值时长 × fps（**唯一合法来源**，禁止目测） |
| `narration[].seconds` | 旁白还没合成，先出字幕片 | 按 fps 折算；后续换成 frames 即升级为真值版 |

`captions[].src` 有值 → 生成 `caption` 轨（自带旁白播放）；没有 → 生成 `textCard/subtitle`
（纯文字版，仍能出片）。**这条就是「20 分钟内先出片」的降级路径**：旁白没好的时候也照样有片。

### 视觉轨的三种帧窗写法

| 写法 | 含义 | 例子 |
|---|---|---|
| 只给 `at` | 跨这一句 | `"at": "V3"` |
| `at` + `until` | 跨多句（本节主视觉） | `"at": "V3", "until": "V6"` |
| `at` + `duration` | 固定帧数（小装饰、标注） | `"at": "V3", "duration": 45` |
| 直接给数字 | `at` / `until` 也可以是帧号 | `"at": 420, "until": 900` |

视觉轨的字段**一律透传**（`variant` / `box` / `animate` / `values` / `points` … 见
`shot-cards.md` 与 `manifest-contract.md`）。builder 只补 `id` 与帧窗 —— 刻意不做
「类型 → 字段」的转换，避免出现第二份契约。

## 段边界冻结（最重要的一条）

首次运行会把句子帧窗写进 `build/segment-lock.json`。之后每次运行都对比：**帧窗变了就报错退出**。

```
✖ 段边界被改动了 —— 这是「重排」，不是「追加」，已拒绝生成。
冻结值：V1@0–132 | V2@132–300 | ...
本次值：V1@0–150 | V2@150–318 | ...
```

为什么这么硬：manifest 是声明式的，「丰富」只有两种合法操作——**追加轨** / **替换单轨**。
这两种都要求段边界不动。边界一动，所有轨的 `startFrame` 全要重排，等于重写整片——正是
2 小时 40 分钟空转的那个循环。

确实要重排（例如旁白重新合成、帧数变了）时：删 `build/segment-lock.json`，重跑，并在
汇报里明说「本版重排了帧窗，因为旁白从 X 帧变成 Y 帧」。

## 报错对照

| 报错 | 该怎么做 |
|---|---|
| `spec 里没有任何句子` | 补 `captions[]` 或 `narration[]`；空 spec 不可能出片 |
| `的 text 是空的` | 字幕卡不允许空文案；确实不要这一句就删掉它 |
| `的 text 含换行` | 单句一条轨；折行交给渲染层，别在 spec 里换行 |
| `指向不存在的句子 id` | `at` / `until` 写的是 `captions[].id`，不是文案 |
| `段边界被改动了` | 见上一节；先确认是不是真的重排 |

## 与出片节奏的关系

| 轮 | spec 里有什么 | 产物 |
|---|---|---|
| R0 | 空（用 `scaffold_manifest` 的 recipe 骨架） | 结构可渲的占位片（先证明链路通） |
| R1 | 只有 `captions[]`（真文案 + 真帧） | **M1 首片**：真文案字幕片，20 分钟内 |
| R2/R3 | `captions[]` + `visuals[]`（数据卡 / 图表 / 形状） | 有信息量的版本 |
| R4 | 视觉轨补 `animate` / `kenBurns` / transition | 有运动感的版本 |
| R5 | spec 加 `audio`（`voiceOver` / `bgmUrl`） | 音画对齐的版本 |
| R6 | `render_composition({ quality: "high" })` | 定稿 |

每轮只动 spec 里的一小片，重跑脚本，渲 draft —— **不要**在轮与轮之间重排帧窗。
