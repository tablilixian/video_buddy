# pixel-audit · 像素对拍闸（REQ-038 RQ-13/14/15/19）

> **定位**：产品验收工具链（RQ-13 的三道观感闸 + RQ-14 资产自检 + RQ-15 落点审计）。
> 独立子包（拍板 **SB-4**），零 npm 依赖；ffmpeg 从 PATH 解析。逻辑层（`lib/metrics.mjs`
> / `lib/png.mjs` / `lib/report.mjs`）是纯函数、可单测（`tests/req038-pixel-audit.test.mjs`）。

## 三道观感闸（RQ-13；判据阈值来自 playsout 实测，需求正本 §1.2）

| 工具 | 判据 | 判红线 |
| --- | --- | --- |
| `flash-scan.mjs <video>` | 逐帧亮度跳变 p99 | **> 4 判红**（修复前实测 4.51） |
| `frame-diff.mjs <A> <B>` | 逐帧 PSNR 分桶 | 同规格复现：≥40dB 占比 ≥95% 且 min ≥40；不雷同：中位 <25 且 min <20 |
| `scan-ink.mjs <video> --frame N --box x,y,w,h` | 墨迹中心 vs box 中心 | 偏差 > 24px 判红（历史右移 70px 必被拦） |

```sh
# 例：全片亮度闸（red = 修复前的全屏暗罩会被抓出）
node scripts/pixel-audit/flash-scan.mjs build/output.mp4 --json /tmp/luma.json; echo $?
# 例：切段拼接 vs 整片直渲 的逐帧等价
node scripts/pixel-audit/frame-diff.mjs build/concat.mp4 build/direct.mp4
# 例：标题落点审计（box 50,46 中心语义）
node scripts/pixel-audit/scan-ink.mjs build/output.mp4 --frame 120 --box 50,46,76,30
```

## 资产 alpha 剖面自检（RQ-14；E4 事故的资产期拦截）

```sh
node scripts/pixel-audit/asset-check.mjs build/assets/scrim.png --bottom-band 300 --peak-window 0.55,0.75
```

预生成流水线（`scripts/playsout-replica/stage-assets.mjs`）出图后自动调用同款断言
（`lib/png.mjs` 的 `assertAlphaProfile`），不满足即拒绝出图。

## 报告字段（RQ-19 采集面）

`lib/report.mjs` 的 `buildPixelAuditReport` 输出：`lumaJumpP99` / `psnr` / `inkOffsets` /
`paramDimensions` / `paramEffective` / `assetSourceDistribution`（后三项由 P 卡判据运行填充）。
`ok=false` 时 `failures[]` 列全部判红原因。

## 已知边界

- 灰度比较口径：`scale=320:180,format=gray`（与 /tmp 原型一致；更高分辨率会拖慢但更严）。
- 硬切 / 白闪帧**不自动豁免**（spikes 列表给人工复核；需求正本 E6 的既知跳变是源片风格）。
- PSNR 为 Infinity（逐字节相同）时中位数/最小值取有限值集合 —— 全同片会得到 min=0 的
  表象，分桶 ≥40dB 占比才是主判据。
