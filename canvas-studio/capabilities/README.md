# 能力地图（capability map，CV-445 S4 · rea-video A5 吸收）

> 模型能力的事实源：`models/*.json`（**刻意用 JSON 不用 YAML** —— 本仓无 yaml 解析依赖，
> 不为数据文件引新包；schema 同构，后续引 yaml 时只换序列化层）。
> 数据源只登记**本仓实测/文档可查的规格**（来源写进 `verified.basis`）；
> 转述第三方（如 rea-video 自称）的信息放 `capabilities.note` 并降 confidence，
> **不得当采购依据**（能力对照表 §1.4 口径）。

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | 模型 id（= 文件名去 `.json`），全库唯一 |
| `name` | ✓ | 人话名 |
| `status` | ✓ | `ga` / `preview` / `limited` / `placeholder` / `shutdown` |
| `channels` | ✓ | 供应商通道（drama / fal / …；placeholder 可为空数组） |
| `primitives` | ✓ | 与厂商无关的能力原语（`video.*` / `audio.*` / `analysis.*`；placeholder 可为空） |
| `limits` | ✓ | duration（min/max/default）/ resolution / refs（images/videos/audios/totalFiles） |
| `capabilities.multi_shot` | ✓ | 原生多镜头能力：`true` / `false` / `null`（未知）—— 规划层（plan_generation_units）据此定切分策略 |
| `cost` | ✓ | 计费口径说明；不写死单价（后端变化频繁） |
| `license` | ✓ | 许可形态 |
| `verified.basis` | ✓ | **规格的事实来源**（仓库文件路径/文档章节），没有来源的字段不许写 |
| `verified.date` | ✓ | 复核日期（ISO）；**测试闸：>90 天未复核即红** —— 过期说明模型规格可能已漂移 |
| `verified.confidence` | ✓ | `high` / `medium` / `low` |

## 消费方

- `plan_generation_units`（S3）的切分上限参数与 `multi_shot` 语义；
- seedance2 接入时有处可写规格（占坑 → 实测回填 status: `placeholder` → `ga`）；
- 与 `src/providers/` 供应商抽象层对齐（provider 能力预检的事实参考）。

## 纪律

1. **新增/修改模型条目必须带 `verified.basis`** —— 无来源的规格是二手话；
2. `verified.date` 过期（>90 天）由 `tests/capabilities-schema.test.mjs` 拦下：复核后更新日期，不确认就改短 confidence；
3. 转述信息（官方 README/第三方仓库自称）只进 `note`，不进结构化 `limits`。
