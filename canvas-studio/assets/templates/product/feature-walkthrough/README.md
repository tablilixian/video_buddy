# 产品 · 特性走查（`product/feature-walkthrough`）

产品名 + 一句话定位开场 → 三条特性逐条入场 → 落版行动号召。带四角括线与底部进度条。

| 项 | 值 |
|---|---|
| 画布 | 1920×1080 · 16:9 |
| 时长 | 720 帧 @30fps = 24.0s（固定） |
| 卡片位 | 3（`itemCapacity`） |
| 素材 | 不需要（需要实拍产品图时改用自由编排 + `image` 轨） |
| 构件 | `cornerBrackets` + `progressBar`（32 刻度，蓝色游标） |
| 音效 | 3 × `card`（特性入场）+ 1 × `swoosh`（落版） |

## 结构（时间轴）

| 轨 | 区间（帧） | 内容 |
|---|---|---|
| `brand` | 0–120 | 产品名（`subtitle` variant，小字号） |
| `headline` | 0–120 | 一句话定位（`title`，`maskReveal`） |
| `feature1..3` | 120–300 / 300–480 / 480–660 | 每卡 `bullets` 两行 |
| `cta` | 660–720 | 落版号召 |

## 授权

自有模板（本仓产出），随 canvas-studio 一起分发。
