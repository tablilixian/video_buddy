# 技能扩充规范（Skill Expansion Spec）

> 本文规定如何向 canvas-studio 增加一个新 skill。
> 机制基础见 [api.md §MiniMax-H3 上游 skill 注册与调用](./api.md#minimax-h3-上游-skill-注册与调用)；回归验收见 [minimax-skills-acceptance.md](./minimax-skills-acceptance.md)。
>
> **2026-09-17 整合**：skill 内容来源收敛为**单一事实源 `skills/`**。此前的双源机制——上游 submodule 逐字节同步 + `skills-local/` 覆盖合并——连同 `scripts/sync-minimax-skills.mjs`、`skills-local/` 目录、`minimax-h3` 子模块**已全部移除**。旧 plan 文档（`docs/plans/*`）里「`skills/` 是 sync 产物、必须改 `skills-local/`」的表述一并作废。

## 1. 设计原则（扩 skill 前必读）

1. **单一事实源**：`skills/<name>/` 就是内容本身——手工维护、随 git 提交、原样随包发布。写入即生效：没有同步步骤、没有第二份副本、没有上游 checkout 需要更新。MiniMax-H3 来源的 bundle 是 **2026-08-15 一次性零改编导入**（上游 commit `d21241f0a4b3`）的产物，此后由本仓库拥有并适配——这是**导入，不是持续跟随**，所以「回流上游」对它们不成立。
2. **目录成员即注册**：`skills/<name>/` 里有 `SKILL.md` 就会被注册，没有就不注册。注册代码（`src/skills/minimax-skills.ts`）不需要为新 skill 改动。
3. **渐进披露**：`SKILL.md` 保持精简入口（几百行以内），细节放 `references/`，正文里用相对路径 `references/<file>` 引用；模型加载入口后按需用 `read` 工具读取细则。
4. **能力边界先在宿主侧适配，必要时直接改正文**：skill 引用宿主不具备的工具时，优先由占位工具（music_generation / tts_voiceover / subtitle_burn）承接降级路径，其次在 creation-spec 总纲里写映射规则。**但本仓是固定单后端产品，与上游「通用模型仓」的定位不同**——当 skill 正文写了与本产品冲突的流程（如「先让用户选择视频模型」）时，直接改 `skills/` 下的正文即可：本仓库对其内容有完整所有权，这不叫「改编上游」。历史先例：`references/model-selection.md` 删掉整个模型选择卡章节、`papercraft` 的 SKILL.md 把「默认使用」改为「固定使用」。
5. **禁止重新引入外部 skill 源**：`tests/skills-single-source.test.mjs` 是硬门禁——源码 / 脚本 / 配置 / 根启动脚本里出现上游 submodule 名，或 `skills-local/` 目录重新出现、`build` 首步变回同步，构建即红灯。

## 2. skill 目录格式

```text
<name>/                        # 目录名 = 注册名，必须 kebab-case（[a-z0-9-]）
├── SKILL.md                   # 必需。YAML frontmatter + 精简正文入口
├── references/                # 可选。分环节细则，正文用相对路径引用
│   └── xxx-spec.md
├── SKILL.cn.md                # 可选。中文对照（人读，不参与注册）
└── meta.yaml                  # 可选。展示元数据（版本/标签/摘要/署名）
```

### SKILL.md 骨架

```markdown
---
name: my-new-skill
description: 一段 1024 字符以内的路由描述：这个 skill 做什么、什么时候用、不适用什么。模型靠它决定是否加载。
---

# My New Skill

何时使用本 Skill（一句话）。流程重点（一句话）。

## STEP 1：…

关键步骤与选项卡门（需要用户确认的点写明用 ask_user_choice 承接）。

## STEP N：细则引用

镜头表格式遵循 `references/shot-table-spec.md` 的六列规范。

## 边界

不适用场景（防止 skill 被误加载）。
```

**硬性约束**（`test:smoke` 自动检查，违反即构建红灯）：

| 约束 | 原因 |
|---|---|
| 目录名 kebab-case 且与 frontmatter `name` 一致 | 注册名合法性与寻址一致性 |
| `description` 非空且 ≤1024 字符 | Host 注册表按 `DESCRIPTION_LIMIT` 截断；取值依据是最长 description + 100 余量 |
| 正文引用的每个 `references/<file>` 必须真实存在 | 渐进披露可用性（`read` 找不到文件流程即断） |
| 正文非空且含 markdown 标题 | 加载结果基本可读性 |

> `description` 是模型在 catalog 中选择 skill 的唯一依据，**截断会静默砍掉排在最末的负向路由语**（"Not for KOC talking-head ads…" 这类能力边界限定），且改动前后都无日志。调长度上限须同步更新 `src/skills/minimax-skills.ts` 的 `DESCRIPTION_LIMIT` 与 `tests/minimax-skill.test.mjs` 的长度快照断言。

## 3. 新增一个 skill（唯一路径）

1. **写目录**：在 `canvas-studio/skills/<name>/` 下按 §2 格式创建 `SKILL.md`（+ 可选 `references/`、`SKILL.cn.md`、`meta.yaml`）。
2. **重建**：`corepack yarn workspace canvas-studio build`。build 已无同步步骤，`skills/**` 直接随包发布。
3. **（可选）接入风格路由**：见 §5。
4. **（可选）补 catalog**：`src/skill-catalog.ts` 加展示元数据。`tests/skill-catalog.test.mjs` 是硬门禁——漏补表直接红（防「skill 在库但用户选不到」）。
5. **验证**：跑 `corepack yarn workspace canvas-studio test:smoke`，再按 [minimax-skills-acceptance.md](./minimax-skills-acceptance.md) 在桌面抽查该 skill 能加载、references 能按需读取。

**从上游取来新 skill 时**：当作一次性导入——把上游目录内容拷进 `skills/<name>/`，再按本仓需要直接改（产品化适配），并在 §6 的溯源表加一行来源 commit。**不做逐字节保持，也不留双源**。

## 4. 归属与提交纪律

- `skills/` 由本仓库所有、随 git 提交、随包发布（`package.json` 的 `files` 含 `skills/**`）。**它不再是构建产物**——没有任何脚本会覆盖它，直接改它即可，改完即生效。
- `references/` 下的文件与 `SKILL.md` 同等重要：正文用 `references/<file>` 相对引用，缺文件会让渐进披露断链（`test:smoke` 硬门禁）。
- 打包态 `lib/**` 与 `skills/**` 经 asarUnpack 落为物理路径，Host `read` 工具可直达。
- 历史沿革：`skills/` 曾同时接受上游同步与 `skills-local/` 覆盖（后者内容已并入前者，目录本身已删除）。旧口径「只改 `skills-local/`、别改 `skills/`」**已作废**。

## 5. （可选）接入需求澄清的风格路由

只有"面向终端用户的成片风格"需要这一节；工具型 skill（如 h3-prompt-writing）跳过。

1. **风格预设表**：在 [creation-spec.ts](../src/skills/creation-spec.ts) 的「风格预设」表加一行，四列对齐既有行——预设名（用户点选标签，逐字用于 ask_user_choice）、适用场景、流程差异/关键约束、对应 skill 的英文原名（模型据此 `skill(name=…)`）。
2. **大类归属**：该 skill 要挂进 3a 大类题（商业推广 / 动画叙事 / 讲解科普 / 艺术创意）之一，写进 creation-spec 的分类对照行。
3. **风格 GIF 预览（可选）**：放一张 `assets/style-demos/<name>.gif` 即可在澄清第③步渲染预览卡片；没有 GIF 不影响 skill 生效，只是无预览图。存在性由 `skill-catalog.ts` 的 `demo` 字段单点判定，缺失时渲染「预览制作中」降级占位卡（16:9 同尺寸，防布局跳动）。GIF 与 `skills/` 一样是**入库资产，手工放置**。
4. 若新风格涉及本插件不具备的能力（如烧录字幕），确认占位工具/能力边界章节已有对应降级描述，没有则在 creation-spec「能力边界」补充。

## 6. 溯源与打包

- **打包**：`package.json` 的 `files` 含 `skills/**` 与 `assets/**`，随包发布；打包态二者经 asarUnpack 落为物理路径，`read` 工具可直达。
- **提交**：直接改 `skills/` 并提交——它的 diff 就是内容变更本身，review 时直接看。
- **溯源表**（来自 MiniMax-H3 的 bundle，一次性导入后由本仓维护）：

| 来源 | 导入时上游版本 | 导入日期 | 现状 |
|---|---|---|---|
| MiniMax-AI/MiniMax-H3 `skills/`（9 个：h3-prompt-writing + 8 个风格生成器） | commit `d21241f0a4b3`（2026-08-15） | 2026-08-15 | 由本仓维护并已产品化适配；上游独有件（8 件 `meta.yaml` 署名 + 1 件 `agents/openai.yaml` + 5 件被正文引用的 `references/`）已并入 `skills/` |
| 同上 `assets/<skill>.gif`（8 张风格演示图） | 同上 | 2026-08-15 | 已入 `assets/style-demos/`（连同 2 张自研风格图，共 10 张），入库资产 |

> **许可待办**：上游为 MiniMax H3 Community License（非 MIT/Apache），LICENSE 全文位于 HuggingFace 仓库，本仓未取得副本。署名载体是各 skill 的 `meta.yaml`（`author-en` / `source` / `version`），须保留。第三方许可全文入库（`THIRD_PARTY_NOTICES.md`）与 `verify:licenses` 覆盖 skills 内容仍是待办，见 STATUS.md。

## 7. 扩充检查清单（PR 自查）

- [ ] 目录名 kebab-case，与 frontmatter `name` 一致
- [ ] `description` 非空、≤1024 字符、写清"何时用/何时不用"
- [ ] 正文精简（入口级），细节在 `references/` 且正文用 `references/<file>` 相对路径引用
- [ ] 正文引用的所有 references 文件真实存在
- [ ] `corepack yarn workspace canvas-studio build` + `test:smoke` 全绿
- [ ] 桌面抽查：catalog 出现新 skill；`skill(name=…)` 加载成功；references 按需读取成功
- [ ] （风格类）creation-spec 风格表 + 大类归属已更新；GIF 预览按需放置
- [ ] （能力缺口）占位工具 / 能力边界描述覆盖
- [ ] （上游导入）§6 溯源表加一行来源 commit
- [ ] 状态登记：STATUS.md 加 CV 条目（或并入既有条目）
