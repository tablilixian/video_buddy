# THIRD_PARTY_NOTICES · 第三方素材与衍生说明

本包包含的第三方来源内容及其许可如下。新增第三方来源时在此登记（纪律见
`docs/plans/REQ-038-视频产出质量提升-需求文档-20261112.md` §7 合规边界）。

## video-shotcraft（镜头配方手法库 · RQ-11① 的来源）

- **上游**：<https://github.com/kingselyjoe/video-shotcraft-dsh>（Apache License 2.0）
- **版权**："video-shotcraft Copyright 2026 Wei Yihao"（上游 NOTICE 原文）
- **我们取了什么**：`references/shots/` 下 152 张镜头配方卡的「参数表 + 已知坑」
  **手法与参数知识**，提炼改写进
  `skills/code-driven-explainer/references/shotcraft-catalog.md`（每卡 7 字段：
  一句话 / 能量 / 典型参数 / 调节手感 / 已知坑 / 我们能不能做 / 走哪条轨道）。
- **我们没有取什么**：上游的 TSX 实现（`demos/`）、模板工程（`template/`）、音频资产、
  美术与品牌元素 —— 一件都没有进仓。路线也不同（他们 Route A：agent 写 TSX + SSR；
  我们 Route B：manifest DSL → CSR）。
- **二次借鉴边界**（沿上游自身声明同款纪律）：只取**抽象的动效手法**（时序结构、
  缓动思路、编排逻辑、参数量级）；**不复刻具体表达**（原片画面、美术、文案、品牌）。
  上游卡片的来源研究亦未获原权利人复刻许可（上游 `references/shots/ATTRIBUTION.md`
  有完整边界声明），我们的改写同样依赖「手法参考 + 独立实现、无原素材」这一实践。
- **许可留痕**：Apache-2.0 全文见上游仓库 `LICENSE`；本分册头部标注来源与许可；
  上游 `NOTICE` 与 `references/shots/ATTRIBUTION.md` 的要点已收录本文件。

## SFX 与音频（历史批次）

- playsout 复刻所用的 149 支 SFX 与上游 `assets/audio/sfx/` 同源，其授权与 SHA-256
  记录在 `scripts/playsout-replica/ATTRIBUTION.md`（Mixkit Free License 等）。
- 本包自身不附带任何音频文件（`build/` 不入库）。

## 其他

- 其余 `references/` 分册（shot-cards.md / product-promo-cards.md 等）均为本仓原创，
  不含第三方版权材料。
