# asset-pipeline · 预生成资产流水线（REQ-038 RQ-16）

> **定位**：参数化出图入口 —— 其他体裁**不需要**再复制 `stage-assets.mjs` 的私有函数。
> 出图即自检（RQ-14 的 alpha 剖面断言，不合格拒绝写盘）；可选 `--manifest` 产素材清单
>（file/kind/params/sha256/bytes）。零 npm 依赖（canvas 用 `playsout-replica/lib/png.mjs`
> 的纯 JS 光栅器）。

## 用法

```sh
# 压暗条（字幕带）
node scripts/asset-pipeline/generate.mjs --kind scrim --out build/assets/scrim-hero.png \
  --from bottom --band 300 --color "#05080f" --peak 0.9 --manifest build/assets/pipeline-assets.json
# 径向暗角
node scripts/asset-pipeline/generate.mjs --kind vignette --out build/assets/vig.png --strength 0.55
# 径向光晕
node scripts/asset-pipeline/generate.mjs --kind glow --out build/assets/glow.png --color "#3d3efd" --alpha 0.2
# 上下双压暗条
node scripts/asset-pipeline/generate.mjs --kind scrim-top-bottom --out build/assets/stb.png --top-peak 0.92
```

## 自检口径（阈值来自 playsout 实测）

| kind | 断言 |
| --- | --- |
| `scrim` | 带外全透明（topBand/bottomBand）+ 峰值行在贴边窗（0.9–1 或 0–0.1） |
| `vignette` | 径向中心（44%±10%）alpha ≤ 12（写反即红）+ 峰值 ≥ 0.4×strength×255（实测 0.48） |
| `glow` | 峰值 ≥ 0.5×alpha×255（行平均口径，实测 0.585）+ 峰值行在中带 |
| `scrim-top-bottom` | 峰值在顶带 + 中段 alpha ≤ 20 |

新增 recipe：在 `RENDERERS` 加一个工厂（返回 `{ png, check, label }`），check 直接喂
`pixel-audit/lib/png.mjs` 的 `assertAlphaProfile`。

## 与 stage-assets.mjs 的关系

`stage-assets.mjs`（playsout 专用）已同批接入自检（`checkedPng` wrapper，RQ-14），
公式与本入口同源；它的 playsout 专属排版（hero/SDK 等具体素材名）**不**进本入口 ——
本入口只收**跨体裁通用**的参数化形态。新增通用形态时两边同步（公式一致是回归前提）。
