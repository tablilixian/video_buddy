# 画布插件代码组织结构 · AI 辅助开发适配性评审

> **状态：待拍板**（决策点已登记 [STATUS.md](./STATUS.md) §7 **G1**）
> **评审对象**：`canvas-studio/` 的代码与文档组织，及其在根仓的门禁 / 文档布局
> **评审基线**：`bd0ebfc07a`（2026-09-28）· 纯文档零代码，未改任何产品代码
> **复算方法见 [§5](#5-复算方法命令可原样重跑)**，本文所有数字都是本机实测值

---

## 0. 结论先行

1. **结构本身对 AI 相当友好** —— 纯函数核心 + 源码静态守卫 + 反向对照 + CV-xxx 三向追溯，这套组合在「防 AI 写出假绿」上高于平均水平，**应当保留并强化，不要为了整洁而重构掉**。
2. **真正的短板不在代码组织，在两处「机制没接上」**：① 根 `typecheck` / `test` / `check` 与 CI **完全不含 canvas-studio**，1,097 条守卫没有任何闸门在跑；② 那 **5 条基线红**靠人肉比对「净增 0」而不是靠机器判定。
3. **其次是「状态库不可机读」**：`STATUS.md` 746KB / 661 行 / 单行最长 31,591 字符 —— 被称为「唯一事实来源」的文件，恰恰是行式读取工具最难读的那一份。
4. 建议：**P0 三件事**（门禁接入 + 基线红名单机读 + `AGENTS.md` 入口），**P1** 拆巨型文件与文档机读，**P2** 注释分层与记忆层定级。详见 [§4](#4-建议)。

---

## 1. 结构速写

| 层 | 位置 | 规模（实测） |
| --- | --- | --- |
| Host 半（注册表 / 路由 / 工具 / 媒体管线） | `src/index.ts`、`src/routes.ts`、`src/host-tools.ts`、`src/generate.ts` | 与 Client 合计 **147 文件 / 50,207 行** |
| 纯函数核心（Host + Client 共用） | `canvas-geometry` / `canvas-placement` / `canvas-view` / `canvas-lineage` / `approval-gate` / `stage-chip` / `studio-defaults` … | 无 IO、无 React，全部可 `node --test` 直测 |
| 共享契约 | `src/contracts/*.ts`（纯类型 + 纯常量） | 两侧各自擦除，不进运行时包 |
| Client 半 | `src/client/**`（`StudioFrame.tsx`、`project-store.ts`、`canvas/*`） | tsdown 打成 `lib/client.js`（1.08 MB） |
| 测试 | `tests/*.test.mjs` **100 文件 / 1,097 用例** | 跑 `lib/*.js` 产物；含大量**读源码的静态守卫** |
| 无头 UI 验收 | `scripts/preview-*.mjs` + `verify-previews.mjs` | Chrome `getComputedStyle` 断言，明暗双轨 + **反向对照** |
| 状态库 | `docs/` **66 篇 .md / 27,057 行 / 26MB** | `STATUS.md` 单一事实来源；CV 号代码内 166 个、文档内 249 个 |
| 提示词资产 | `skills/` 21 个 skill（73 个 .md / 9.9MB） | 有测试守（引用文件存在性、体积闸、字节一致） |
| 记忆层（仓外/半外） | `.workbuddy/memory/`（会话记忆）、`.trae/skills/`（他端 agent skill） | 与 `docs/`、代码注释并存，见 [§3.8](#38-记忆层已经出现分歧p2) |

规模速记：注释 **12,107 / 50,207 行 ≈ 24%**（多为「为什么 / 事故现场」型长注释）；`CV-xxx` 在 `src/` 出现 **1,219 次**、唯一号 **166** 个。

---

## 2. 对 AI 辅助开发的优势

1. **纯函数核心 + UI 只做投影** —— `approval-gate.ts`、`canvas-placement.ts` 这类文件无 IO、无 React，AI 改完 20~60 秒内能自证。这是全仓对 AI 最友好的设计，也是「预览台能摆真实实现」的前提。
2. **CV-xxx 三向可追溯** —— 代码注释、`docs/`、commit message 共用同一编号。AI 一 grep 就能拿到「上次为什么这么改、踩了什么坑」，例如 `src/contracts/canvas.ts:12` 起的血缘说明、`src/client/project-store.ts` 里的「四处共用本模块」账。
3. **源码静态守卫正中 AI 的失败模式** —— `tests/approval-gate.test.mjs:1` 开篇即写「判定对了但忘了接 = 等于没做」，用 grep 断言 `host-tools.ts` 里每个产出类工具都调了门禁。AI 最常见的「写了判定没接线」被直接钉死。
4. **反向对照 + 独立 ORACLE** —— 预览台要求「对照组必须真的红，否则说明断言是空绿」，`preview-spotlight.mjs` 页内自带独立期望表不与被测实现共用判定。这是对「写出让测试通过的假实现」的结构性约束。
5. **验证链短** —— typecheck + build + smoke + loader 约 30~60 秒，AI 能在单轮内闭环（`DEV-WORKFLOW.md` §三 的铁律顺序也正是为此设计）。
6. **`DEV-WORKFLOW.md` 是可执行 checklist** —— 认领条目 → 编码约束表 → 验证链 → 四步收尾，把「流程」变成 AI 能逐项打勾的东西，而不是口头约定。
7. **提示词资产化并被测试守护** —— `skills/` 的体积闸、引用文件存在性、与源码字节一致断言，让「改 prompt」也变成可回归的改动。

---

## 3. 弊端（按严重度，均为本机实测）

### 3.1 门禁是空的：1,097 条守卫没有任何闸门（P0）

| 闸门 | 是否含 canvas-studio |
| --- | --- |
| 根 `yarn typecheck` | ❌ 只跑 `dsh-plugin-desktop` + `dsh-community-market`（`package.json:8`） |
| 根 `yarn test` | ❌ 同上（`package.json:9`） |
| 根 `yarn check` | ❌ `check:layout` + fabric + market + desktop（`package.json:15`） |
| CI `.github/workflows/ci.yml:88` | ❌ 跑的就是根 `yarn check`；打包 job 才顺带 build canvas-studio |
| canvas-studio 自己的 `check` | ⚠️ `build + verify:loader + typecheck`，**不含 `test:smoke`**（`canvas-studio/package.json:49`） |

**后果**：`tests/` 的 1,097 条用例（含大量防「接线缺失」的守卫）**没有任何自动化流程在跑**。AI 跑 `yarn check` 得到全绿，与测试红不红完全无关。

### 3.2 「5 条基线红」靠人肉比对，不靠机器判定（P0）

本机实测（`bd0ebfc07a`，干净工作树，全新 build）：

```
# tests 1097 · pass 1092 · fail 5
  tests/studio-defaults.test.mjs ×4  → 断言 defaults.resolution，实现已拆成 imageResolution/videoResolution
  tests/minimax-skill.test.mjs   ×1  → cinematic-moves 跨 skill 引用 h3-prompt-writing/references/…，守卫按本 skill 目录解析
```

这 5 条**是已知基线**，STATUS.md 多个条目写着「5 条基线红同名：渐进披露×1 + studio-defaults×4，净增 0」（CV-245 / CV-247 / CV-253 / CV-255 等）。问题不在「没人知道」，而在：

1. **判定方式是人肉对数**（`1035/1040`、`1047/1052`、`1089/1094`、`1092/1097` 逐条目手抄）—— 这正是脚本该做的事；
2. **没有闸门阻止基线扩散**：任何人（或任何 AI）新增一条红，只要不主动跑测试就没人发现；
3. **新会话无法区分「基线红」与「我改红了」** —— 除非先读 STATUS 巨行；AI 的两种典型误判是「把 5 红当成自己弄坏的」和「把第 6 条红也当成基线」。

### 3.3 测试跑的是 `lib/` 产物，红绿随「有没有先 build」漂移（P1）

| 状态 | 结果 |
| --- | --- |
| 未重建（`lib/` 过期） | **11 红 / 1,037 用例**（部分测试文件直接 import 失败，用例数都变了） |
| 全新 `yarn build` 后 | **5 红 / 1,097 用例** |

`DEV-WORKFLOW.md:48` 自己写着「`test:smoke` 跑的是 `lib/*.js` 产物，源码语法写坏了测试照样全绿」—— 反过来也成立：**产物过期会让测试红得毫无意义**。对 AI 这是双重陷阱：红可能是过期、也可能是真回归，而两者长得一样。

### 3.4 状态库不可机读（P1）

- `docs/STATUS.md`：**746,388 字节 / 661 行 / 单行最长 31,591 字符**（第 10 行）。
- `docs/canvas-ux-backlog.md`：181,754 字节 / 194 行。

行式读取工具对 >2000 字符的行会**截断**；grep 命中一行就是几万 token。于是「唯一事实来源」实际上是：

- AI 只能靠 `scripts/status-summary.mjs` 这类脚本旁路（该脚本只重算 §1 速览表，§8 与「上一条…」巨行仍不可读）；
- 追加式巨文件会持续制造合并冲突；
- 文档内部已经出现漂移（同一份 STATUS 里）：
  - §0 编号规则写「已编到 **CV-247**」，§4 实际最大 **CV-255**；
  - 顶部「最近更新：**2026-09-24**（CV-241…）」，而 §4/§8 已有 **2026-09-28** 的 CV-253/255 行。

### 3.5 收尾四文档同步是纯记忆负担（P1）

`DEV-WORKFLOW.md` §四 要求每次改动更新：STATUS §1 状态列 + §8 变更记录 + `canvas-ux-backlog` 对应行与变更记录 + 排查四处漂移高发区，再提交。该文档自己承认「这个坑已经踩过三次」（编号撞号）。

对 AI 而言：**每轮改动 = 4 处 markdown + 1 次漂移排查**，token 成本与漏更新概率都随文档数线性上升。这不是纪律不严，是把「一致性」交给了执行者的记性。

### 3.6 双 tsconfig 的手工 `include` 白名单（P2）

`tsconfig.client.json` 的 `include` 要手工追加每个新的根级模块（`DEV-WORKFLOW.md:21` 已列为编码约束）。漏了就是「typecheck 过了但 client 解析不到」—— 属于**隐藏耦合**，是 AI 的高频翻车点，且没有任何测试能提前发现。

### 3.7 巨型文件 = AI 的可编辑单元过大（P2）

| 文件 | 行数 |
| --- | --- |
| `src/client/styles.ts` | **7,694** |
| `src/generate.ts` | 2,985 |
| `src/host-tools.ts` | 2,454 |
| `src/client/StudioFrame.tsx` | 2,003 |
| `src/routes.ts` | 1,969 |
| `src/client/index.ts` | 1,534 |
| `src/client/project-store.ts` | 1,362 |
| `src/client/canvas/CanvasSurface.tsx` | 1,063 |

单次读不完全 → 多轮编辑；仓内已有实测教训：「同消息对同一文件发多条 Edit 会互相覆盖」（`compose.ts`，见 STATUS 记录）。文件越大，这类冲突概率越高，AI 的「读全文再改」策略也越失效。

### 3.8 记忆层已经出现分歧（P2）

本仓同时存在三类「给 agent 看的记忆」：`docs/`（长期事实）、代码注释（局部事故账）、`.workbuddy/memory/`（会话记忆）+ `.trae/skills/`（他端 agent skill）。实测分歧：

- `.trae/skills/canvas-studio-video-workflow/SKILL.md` 仍列出 **`style_transfer` / `storyboard_generate` / `deduction`** 三个在 `src/host-tools.ts` 中**不存在**的工具（当前实注册 22 个具名工具）；`upload_image` 语义也已变更。
- 这份文件**不在任何收尾清单里** —— 给别的 AI 用的文档反而最容易漂，因为没人把它纳入 §四 步骤 3 的「漂移高发区」。

### 3.9 入口缺失：新会话找不到规则（P2）

- 根 `AGENTS.md` 对 `canvas-studio` **零提及**（grep 0 命中），而 canvas-studio 是根 workspace 的第一顺位成员、代码量最大；
- 仓内**没有** `canvas-studio/AGENTS.md` / `CLAUDE.md`；
- `DEV-WORKFLOW.md` 只能从 `canvas-studio/docs/README.md` 索引发现。

结果：新 AI 会话的第一落点拿不到「验证链 / 编码约束表 / 四步收尾 / 编号规则」，实际最常被加载的反而是 `.workbuddy/memory/MEMORY.md` —— 而它在 `AGENTS.md` 里没有地位。

---

## 4. 建议

### P0（一次改动，收益最大）

| # | 动作 | 验收标准 |
| --- | --- | --- |
| P0-1 | **门禁接入**：根 `typecheck` / `test` / `check` 各加 `yarn workspace canvas-studio …`；canvas-studio 的 `check` 改为 `build && typecheck && test:smoke && verify:loader`（或单列不可跳过的 `gate`）；CI 同步 | CI 上跑得到 canvas-studio 的测试；本地 `yarn check` 红绿与 `test:smoke` 一致 |
| P0-2 | **基线红名单机读**：把 5 条基线红固化成 `tests/baseline-red.json`（按 `文件 + 用例名`），`test:smoke` 末尾比对「失败集合 ⊆ 名单」，多一条红即退出码非 0；顺手修掉这 5 条（`studio-defaults` 补 `imageResolution/videoResolution` 断言、`minimax-skill` 支持跨 skill 引用） | 红不再靠人对数；新增红自动挡；基线归零或明确留档 |
| P0-3 | **入口文件**：新增 `canvas-studio/AGENTS.md`（≤60 行：验证链 / 编码约束表 / 四步收尾 / 编号规则 / 基线红说明），根 `AGENTS.md` 加一行指过去 | 新会话第一落点即可拿到全部铁律 |

> P0-2 是 P0-1 的前提：**门禁一开就是红的**，必须先让红变得可判定。

### P1

| # | 动作 | 理由 |
| --- | --- | --- |
| P1-1 | **STATUS 拆「状态表 + 变更流水」**：§4 保持一行一条（ID/状态/一句话/涉及文件），巨型「上一条…」叙事移到 `docs/changelog/CV-xxx.md`，`status-summary.mjs` 升为唯一写入口 + CI 校验（表与流水不一致就红） | 让状态机器可读，AI 只读表不读叙事；同时消灭 §0 / 顶部日期这类漂移 |
| P1-2 | **把「文档漂移」变成脚本**：新增 `check-docs.mjs` —— CV 号引用完整性、错误码 vs `errors/catalog.ts`、工具名 vs `host-tools.ts`、`skills/*/references` 存在性、`.trae/skills` 工具清单对账 | 漂移应报红，而不是靠人回头看（已有 `status-summary.mjs` 先例） |
| P1-3 | **拆巨型文件**：`styles.ts` 按域（tokens/canvas/rail/chat/timeline）、`host-tools.ts` 按工具族（审批/资产/媒体/查询）、`StudioFrame.tsx` 容器与面板分离，目标单文件 ≤600 行 | 直接决定 AI 的可编辑单元大小，降低多轮编辑冲突 |
| P1-4 | **消掉手工 `include`**：`tsconfig.client.json` 改 `include: ["src/**/*"]` + 反向 `exclude`，或改用 project references | 去掉一个纯人工同步点 |
| P1-5 | **测试与 build 绑死**：`gate` = build → typecheck → test → loader（一条命令），或测试直跑 src（`node --experimental-strip-types`） | 让「红」只可能来自代码，不来自过期产物 |

### P2

| # | 动作 | 理由 |
| --- | --- | --- |
| P2-1 | **注释分层**：新代码写「约束 + CV 号 + 3 行职责说明」，长篇事故叙事移入 `docs/` | 24% 注释率是净收益，但叙事长在源文件里会推高每次读取成本 |
| P2-2 | **记忆层定级**并写进 `AGENTS.md`：`AGENTS.md` = 入口与铁律 / `docs/` = 产品长期事实 / `.workbuddy/memory` = 会话记忆（短）/ `.trae/skills` 纳入 P1-2 守卫或删除 | 现状是三套记忆并存且已分歧（§3.8） |
| P2-3 | `verify-previews.mjs` 保持可选（依赖 Chrome，符合 headless-safe 铁律），CI 上跑其中不依赖视觉基线的几组 | 无头 UI 断言是本仓独有资产，目前只靠本地自觉 |

---

## 5. 复算方法（命令可原样重跑）

```bash
cd canvas-studio

# 规模
find src -name '*.ts' -o -name '*.tsx' | xargs wc -l          # 50,207 / 147 文件
grep -rn '^\s*\(//\|/\*\|\*\)' src --include='*.ts' --include='*.tsx' | wc -l   # 12,107
find tests -name '*.test.mjs' | wc -l                          # 100
find docs -name '*.md' | wc -l                                 # 66
wc -lc docs/STATUS.md docs/canvas-ux-backlog.md                # 746388/661, 181754/194
awk '{ if (length($0)>m) { m=length($0); l=NR } } END { print m, l }' docs/STATUS.md   # 31591 10

# CV 号覆盖
grep -rho 'CV-[0-9]\+' src | sort -u | wc -l                   # 166
grep -rho 'CV-[0-9]\+' docs | sort -u | wc -l                  # 249

# 门禁是否含 canvas-studio
node -e "const s=require('./package.json').scripts; console.log(s.typecheck, s.test, s.check)"   # 均不含
grep -n 'canvas-studio' ../AGENTS.md                            # 0 命中
grep -n 'run: yarn' ../.github/workflows/ci.yml                 # 仅 yarn check / 打包 job

# 测试与基线红（先 build 再测，否则红绿不可比）
corepack yarn workspace canvas-studio build
cd canvas-studio && node --test "tests/*.test.mjs"              # 1097 · 1092 过 · 5 红
```

> ⚠️ **不 build 直接跑**会得到 `11 红 / 1,037 用例`（`lib/` 过期），用例总数都会变 —— 这正是 [§3.3](#33-测试跑的是-lib-产物红绿随有没有先-build-漂移p1) 的现象本身。

---

## 6. 本次评审的边界

- **纯文档零代码**：未改任何产品代码、未改测试、未修那 5 条基线红（它们是既有基线，需单独排期，见 P0-2）。
- **未分配 CV 编号**：本文按「待拍板」登记在 STATUS §7（G1）与 §4 之外；若决定开工，按 §0 规则取当前最大号 + 1 新建 §4 条目与 backlog 行，再跑 `node scripts/status-summary.mjs`。
- 评审只覆盖 `canvas-studio` 与它在根仓的接线；`dsh-plugin-desktop` / community 包的组织结构不在范围内。
