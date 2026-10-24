# 《Skill 系统编排能力升级方案》评审意见

> **状态**：评审完成（2026-10-23）。评审对象：[skill-orchestration-upgrade-plan-2026-10-23.md](./skill-orchestration-upgrade-plan-2026-10-23.md) v1.0。
>
> **结论**：方案质量高，诊断基本全部属实，架构方向正确，建议采纳（D1-A / D3-A / D4-B / D5-A 均同意）。另发现 2 处文档自身错误、3 个设计空档、1 处迁移策略可简化，落地前须处理下表「必改」项。

---

## 1. 事实核对（逐条实测，全部通过，除注明外）

| 方案断言 | 实测结果 |
|---|---|
| 22 skill、15 个 `general` | ✅ 逐目录统计一致 |
| `STYLE_SKILLS` 11 名 = 预设表 11 行 | ✅ `tests/skill-progressive-disclosure.test.mjs:50-62`，逐名相等 |
| `skill-expansion-spec.md:92`「写进总纲的分类对照行」悬空 | ✅ 总纲中 grep 不到任何「分类对照/大类」内容 |
| `DECISION_TYPES` 硬编码 | ✅ `tests/skill-role-consistency.test.mjs:47` |
| `parsePlatformYaml` 扁平标量、拒数组/嵌套/重复键 | ✅ `src/skill-catalog.ts:186-206` |
| 任一文件解析失败**整表**退回内嵌快照 | ✅ `src/skill-catalog.ts:329-337`（`parsePlatformYaml` 失败与 `toCatalogEntry` 失败均整表退回） |
| `role`/`slot` 不进 `SkillCatalogEntry` | ✅ `src/skill-catalog.ts:215-217` 注释明确 |
| `docs/STATUS.md` 最大 CV-359 | ✅ |

## 2. 方案自身的 2 处错误（必改）

| # | 位置 | 问题 | 修法 |
|---|---|---|---|
| E1 | 方案附录 B 末尾注释 | 「`pipeline: true` 的正好是预设表 11 行 **+** `oriental-mythic-visual-director`」自相矛盾——`oriental-mythic-visual-director` 本来就在 11 行内（`STYLE_SKILLS` 列表 :59 可证），不存在「+1」 | 改为「`pipeline: true` 集合 = 预设表现有 11 行，逐名相等」 |
| E2 | 方案 §4.5.1（L1 断言） | 未写明 description 的载体。description 在各 `SKILL.md` frontmatter，**不在 `platform.yaml`**（抽查 `platform.yaml` 无此字段）。N6 门禁实现时若按 platform.yaml 找会扑空 | §4.5.1 显式写明「description 载体 = `SKILL.md` frontmatter」 |

## 3. 实测补充：L1 缺口比方案预期大

按正则粗扫 22 条 description（载体见 E2）：**负向路由语缺失约 12/22，正向路由语缺失约 10/22**。N6 落地首日即大面积红。

- N6 判据须先定精确词表：中文变体多（「别用于 / 非…场景 / 不要 / 无需」），单一正则必漏；建议「词表 + 逐条白名单豁免（只减不增）」。
- 补写按 P0/P1 分批，避免一次 22 条文案改动难以 review。

## 4. 3 个设计空档（按严重程度）

### 4.1 `genre` 的运行时消费点悬空（最需要补）

方案 §3.2 说 genre →「组合路由、广场分组、覆盖率统计」，但全文没说**运行时谁读它、何时读**。若 B2 只做字段+门禁，genre 就是纯 CI 字段——这可以，但必须写明；否则下一个实现者会把它塞进 `toCatalogEntry` 给广场分组用，那时：

- 枚举校验必须进运行时解析器；
- 写错枚举会触发**整表退回快照**（`skill-catalog.ts:333-337` 已确认 `toCatalogEntry` 失败同样整表退回），正是方案 R1 描述的「改了没生效」故障模式。

**建议**：§4.1 加一行——「B2 阶段 `genre` 不进 `SkillCatalogEntry`，合法性仅由 N1 在测试侧校验；运行时消费（广场分组）另立 CV」。

### 4.2 B4 阈值 P90 会自产一份豁免名单，违反方案自己的 P1

P90 意味着约 2-3 个 skill 天然超线 → 必须配豁免名单 → 又一份手维护表，与 P1「新字段必须消灭一份现有表」冲突。

**建议**：复用方案已有的「白名单只减不增」机制（同 `PENDING_GENRE` 模式），在 §4.4 显式写明。

### 4.3 L3「连续两轮 hit 才算稳定」执行成本被低估

8 条真跑 × 2 轮 = 16 次真机会话。

**建议**：首轮全跑记录原始值并记为基线；第二轮只复跑首轮 `hit` 的 case 确认稳定性；`miss/wrong` 修复后自然重跑。

## 5. 迁移策略修正建议：B2 可一次填完

方案 §4.1 的 `PENDING_GENRE` 初始 = 全部 22 名、分批迁移——**过于保守**：

- fail-closed 触发条件是**语法**错误（数组/嵌套/重复键），`genre: "explainer"` 这类标量行语法安全；
- 枚举值写错只会让 N1 门禁当场红，**不存在静默失败路径**；
- 附录 B 已给出全部 22 个建议值。

**建议**：B2 一个 PR 直接填完 22 个 `genre` + N1/N2 门禁同批提交，白名单直接空态。`handoff` 涉及 4 个 decision 型 skill 的编排语义，保留分批合理。

## 6. 值得肯定的合理之处

1. **G2 三份平行表收敛（§4.2）**：全文最有价值的单项，双向对账门禁让「加第 12 个风格 skill 忘同步」从静默漂移变成 CI 红，直接消灭两处手维护。
2. **§3.3 反方案论证正确**：slot 互斥（装配确定性）与 genre 可叠加（题材组合）正交；扩 slot 到 15 值会同时破坏两个性质并拖垮 `toolchain.md` 绑定表。
3. **P1「新字段必须消灭一份现有表」**：好治理原则，建议保留为长期准则。
4. **R1 fail-closed 风险识别准确**：「改了没生效」在该仓是真实发生过的模式。
5. **P3 度量先行 + §8「不达标不结项」**：全文档最硬的约束；L2 不冒充 L3 的口径（§4.5.2）写得很清醒。

## 7. 落地前检查清单

> ✅ 全部已并入方案 v1.1（2026-10-23）。

- [x] 修 E1（附录 B 注释）
- [x] 修 E2（§4.5.1 写明 description 载体，并补实测缺口数据）
- [x] §4.1 补「genre 不进 SkillCatalogEntry」澄清（§4.1 空档）
- [x] §4.4 阈值机制改为「白名单只减不增」
- [x] §4.5.3 L3 流程改为「首轮全跑 + 二轮复跑 hit」
- [x] §4.1 / §6 B2 改为「一次填完 22 个 genre，白名单空态」
- [ ] N6 词表定稿后重估 L1 补写工作量（随 B1 落地执行）
