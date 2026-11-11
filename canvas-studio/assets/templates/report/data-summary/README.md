# 汇报 · 数据小结（`report/data-summary`）

标题 → 三个关键指标（`dataCard` + `countUp` 数位滚动）→ 一句结论。带四角括线。

| 项 | 值 |
|---|---|
| 画布 | 1920×1080 · 16:9 |
| 时长 | 600 帧 @30fps = 20.0s（固定） |
| 卡片位 | 3（`itemCapacity`，= 三个指标） |
| 素材 | 不需要 |
| 构件 | `cornerBrackets` |
| 音效 | 1 × `thud`（指标区入场）+ 1 × `swoosh`（结论） |

## 结构（时间轴）

| 轨 | 区间（帧） | 内容 |
|---|---|---|
| `title` | 0–150 | 标题（`title`，`maskReveal`） |
| `kpi` | 150–450 | `dataCard`：三个 `{k,v}`，`countUp` 数位滚动，`dataSource: "inline"`（占位/自测数据，声明非外部事实） |
| `conclusion` | 450–600 | 结论一行（`bullets`） |

> 数值型指标的溯源：本模板的三个数**由用户提供**，`dataSource` 写 `inline` 表示「非外部事实」。
> 若用户给的是外部统计口径，出片前请把 `dataSource` 改成真实出处（否则 `dataCard` 溯源校验会告警）。

## 授权

自有模板（本仓产出），随 canvas-studio 一起分发。
