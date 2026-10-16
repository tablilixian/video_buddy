# CompositionManifest 契约（组装必读）

`render_composition` 的唯一入参是字段 `manifest`（一段 JSON 字符串）。本文是该结构的字段手册与硬约束；上游口径见 `skills/canvas-studio-creation/references/toolchain.md`。

## 顶层结构

```jsonc
{
  "id": "cmp-0001",              // 唯一 id（便于血缘与重试）
  "meta": {
    "title": "全球老龄化速览",
    "width": 1280,               // 与画幅对齐：16:9 用 1280×720 或 1920×1088
    "height": 720,
    "fps": 30,
    "durationInFrames": 900,     // 总帧数 = max(track.startFrame + track.durationInFrames)
    "backgroundColor": "#0B1020"
  },
  "tracks": [ /* 见下 */ ],
  "audio": {                     // 可选
    "bgmUrl": "/canvas-studio/assets/p1/bgm.mp3",
    "voiceOverUrl": "/canvas-studio/assets/p1/vo.mp3",
    "mix": { "bgmVolume": 0.35, "voiceVolume": 1 }
  },
  "global": {                    // 可选
    "fontFamily": "Source Han Sans SC",
    "theme": "dark",
    "brandColor": "#3B82F6"
  }
}
```

> `audioComposition`（成片角标）**不是** manifest 输入：它由宿主在校验通过后派生，你不要产出该字段。

## 轨道共同字段

每条轨道都有 `id` / `startFrame` / `durationInFrames` / `type`：

- `startFrame`：≥ 0 的整数（帧）。
- `durationInFrames`：正整数（帧）。
- `id`：唯一。**video / image 轨的 `id` 必须是该素材的画布节点 id**（宿主据此产出血缘）；textCard / shape / transition 用本地 id 即可。

## 五种轨道

### `video`（素材视频）

```jsonc
{ "type": "video", "id": "<画布节点 id>", "startFrame": 0, "durationInFrames": 150,
  "src": "/canvas-studio/assets/p1/clip.mp4", "kenBurns": false }
```

`durationInFrames` 必须按 `list_shots` 的真值取整（见 `references/source-duration.md`）。

### `image`（静态图）

```jsonc
{ "type": "image", "id": "<画布节点 id>", "startFrame": 150, "durationInFrames": 90,
  "src": "/canvas-studio/assets/p1/still.png", "fit": "cover", "caption": "图注" }
```

`fit` 取 `cover`（默认，填满）/ `contain`（留边）/ `kenburns`（缓推）。

### `textCard`（字幕卡 / 数据卡 / 标题卡 / 要点）

```jsonc
{ "type": "textCard", "id": "sub-1", "startFrame": 0, "durationInFrames": 120,
  "variant": "subtitle", "text": "世界人口已突破 80 亿", "accentColor": "#F59E0B" }
```

- `variant` 取 `subtitle` / `dataCard` / `title` / `bullets`。
- `text`：字符串，或字符串数组（`bullets` 每行一条）。
- `data`：仅 `dataCard` 用，键值对数组，如 `[{ "k": "全球老龄化", "v": "16%" }]`。
- **`subtitle` 的 `durationInFrames` 是屏上时长**：相邻字幕卡必须**首尾相接**（每句延伸到下一句
  `startFrame`，末句到总帧），不留空白帧 —— 详见 `references/subtitle-timing.md`。
- `subtitle` 在组件层**不做**淡入淡出（硬切），避免接缝处闪背景；`title` / `dataCard` / `bullets`
  保留淡入淡出。

### `shape`（形状 / 色块）

```jsonc
{ "type": "shape", "id": "bg-1", "startFrame": 0, "durationInFrames": 900,
  "shape": "gradient", "color": "#111827", "box": { "x": 0, "y": 0, "w": 100, "h": 100 } }
```

`shape` 取 `rect` / `circle` / `line` / `gradient`；`box` 是相对画布的百分比坐标（0–100）。

### `transition`（转场）

```jsonc
{ "type": "transition", "id": "tr-1", "startFrame": 140, "durationInFrames": 20,
  "effect": "fade", "fromTrackId": "clip-a", "toTrackId": "clip-b" }
```

`effect` 取 `fade` / `slide` / `zoom` / `dissolve`。`fromTrackId` / `toTrackId` 必须指向**真实存在且互不相同**的两条轨道；两轨**必须重叠**——首尾相接（无重叠）会退化为硬切（warning），完全不相交会直接报错。

## 硬约束（违反即校验失败或不达预期）

1. `meta.durationInFrames` 与 `max(track.endFrame)` 偏差 > 1 帧会 warning，请让两者一致；任一轨超出总时长会 warning 并在渲染时按 `meta` 裁切。
2. 轨道 `id` 必须唯一，否则报错。
3. **`src` 只接受** `/canvas-studio/assets/...` 同源 URL，或**位于本项目资产目录内**的绝对路径（宿主会物化为同源 URL；目录外的绝对路径会被拒收 —— 渲染进程在浏览器环境取不到域外文件）；任何 `http(s)://`、协议相对 `//` 一律拒绝（防外链）。
4. `meta.width` / `height` / `fps` / `durationInFrames` 必须是有限正数（帧数为正整数）。
5. CSS 层叠（z-index）在客户端渲染器里**不支持**：叠放顺序由 `tracks` 数组顺序决定，后写在上层——要压底先把背景 shape 放前面。
6. 转场窗口应落在相邻两轨的重叠区，否则过渡可能不可见（warning）。

## 事件与一致性

- Manifest 引用的每条素材轨 `src` 要能解析到本项目资产；宿主会核对存在性 —— **缺失或不可用即拒绝渲染**（`CS-USER-ERR`，不落节点）。video 轨的声明时长与 ffmpeg 真值偏差 > 0.5s 会以 warning 回传并按真值校正（见 SKILL.md「缺素材会被直接拒收」）。
- `global.fontFamily` / `global.fonts` 的写法见 `references/fonts.md`。
- 科普脚本与卡片节奏见 `references/explainer-patterns.md`。
