# 内容规格（content-spec）· RQ-12/RQ-21 填空指南（REQ-038）

> **一句话**：拿到 brief 后，你写的是这份 **spec（JSON 填空）**，不是 manifest 轨。
> spec → `planFromSpec`（产品侧确定性函数）→ manifest。**同 spec ⇒ 同 manifest**（逐字段）。

## 为什么不许直接写轨

- 手写大 manifest 必错（REQ-038 §3 RQ-18：2026-11-05 有 3h37m 零成片的前车之鉴；
  playsout 复刻手搓 265 轨产出 3 个真 bug）。
- spec 把你从「写轨」解放到「填内容 + 选卡」：段结构、时间轴切分、版式轨、装饰层、
  素材槽位全部由**卡注册表**（`recipe-cards.ts`）确定性生成。

## spec 形状（schema 正本在 `src/remotion/content-spec.ts`）

```jsonc
{
  "meta": { "title": "必填", "theme": "cold-tech（可选）", "fps": 30, "durationSec": 60 },
  "sections": [
    {
      "id": "hook",                       // 必填，唯一
      "card": "A2",                       // 卡编号或卡名（'A2 标题逐字' 也认）；缺省 = 占位段
      "copy": "今天，它替你数了一次心跳",   // 必填主文案（B1 用 "键:值; 键:值" 行内格式）
      "durationSec": 3,                   // 显式秒数；不给则按 weight 归一
      "label": "开场",                    // 可选，eyebrow / dataCard 标题
      "assetSlots": { "mainVisual": "/canvas-studio/assets/xxx.png" },  // 可选，素材槽位
      "accentColor": "#4f9cf9"            // 可选，本段强调色
    }
  ],
  "captions": [{ "text": "…", "startSec": 0.5 }],   // 可选
  "sfx": [{ "name": "impact-cine-big", "startSec": 1.83, "gain": 0.8 }]  // 可选
}
```

## 校验（`validateContentSpec`）

- 必填缺失 / 取值越界 ⇒ **error**（拒收，修完再跑）；
- `card` 未注册 ⇒ **warning**（该段走占位回落，出片但只有一张占位卡）；
- `captions[].text` / `sfx[].name` 空串 ⇒ error。

## 内置卡速查（`registeredCardIds()`；卡册全文见 `shot-cards.md`）

| 卡 | 用途 | 素材槽位 | 缺素材降级 |
| --- | --- | --- | --- |
| `A1` | 标题遮罩揭示 | —（零素材） | — |
| `A2` | 标题逐字打出 | — | — |
| `A4` | 要点逐词落位（copy 按 `；` 或换行拆条） | — | — |
| `A5` | 收尾落版（自带 exit 上浮淡出） | — | — |
| `B1` | 数据卡（copy = `键:值; 键:值`，数值自动 countUp） | — | — |
| `C2` | 左右分栏（文 + 图） | `mainVisual`（user） | 色块占位，不阻断 |
| `E1` | 素材推拉（全屏 kenburns + 暗角 + 字幕） | `scene`（user） | 退化为标题卡 |

每卡自动长出的版式：段底板 + 点阵（`dotGrid`）+ 径向光晕（`gradient radial`）+
眉标 + 主内容 + 强调线 + 角标 + 暗角（`vignette`）—— playsout 设计语言的代码化。

## 素材契约（RQ-21）· 写 spec 前先看清单

1. `specAssetNeeds(spec)` 给出**机读素材需求清单**，按 `source` 三路分流：
   - `user`（必须用户给 / 真实品牌）：**选卡阶段就先列出来问**，缺了走 `fallback` 降级出片，
     降级记录写进交付说明 —— **不整片停摆，也不造假**；
   - `library`（资产库复用：SFX / 媒体 logo）：查 `list_library_assets` 直接取；
   - `generated`（可生成：海报 / 广告图 / 抽象底图）：走画布媒体生成。
2. **品牌红线（SB-5）**：`kind: 'logo' | 'ui'` 的素材**永远不可能**来自 `generated` 通道
   —— 卡注册表在注册期就拒收这种声明。你也不许在 `assetSlots` 里塞 AI 画的 logo。
3. 同一份 spec 两次运行产出**同一份**清单（确定性）—— 清单可以直接贴给用户。

## 产出物怎么进 manifest

```
brief → 你写 spec（本文件 schema）→ validateContentSpec 零错
      → planFromSpec(spec, totalFrames) → { tracks, timeline, assetNeeds }
      → 包上 meta/audio → validateManifest → render_composition
```

`totalFrames = durationSec × fps`；时间轴末段吃余数保证 Σ = 总帧（时长自洽）。
