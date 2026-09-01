# 技能扩充规范（Skill Expansion Spec）

> 本文规定如何向 canvas-studio 增加一个新 skill——无论它来自 MiniMax-H3 上游还是本地自研。
> 机制基础见 [api.md §MiniMax-H3 上游 skill 注册与调用](./api.md#minimax-h3-上游-skill-注册与调用)；回归验收见 [minimax-skills-acceptance.md](./minimax-skills-acceptance.md)。

## 1. 设计原则（扩 skill 前必读）

1. **零改编**：skill 内容不改写、不翻译、不裁剪。上游 skill 逐字节同步；本地自研直接以最终形态编写。
2. **目录成员即注册**：`skills/<name>/` 里有 `SKILL.md` 就会被注册，没有就不注册。注册代码（`src/skills/minimax-skills.ts`）不需要为新 skill 改动。
3. **渐进披露**：`SKILL.md` 保持精简入口（几百行以内），细节放 `references/`，正文里用相对路径 `references/<file>` 引用；模型加载入口后按需用 `read` 工具读取细则。
4. **能力边界在宿主侧适配**：skill 引用宿主不具备的工具时，优先由占位工具（music_generation / tts_voiceover / subtitle_burn）承接降级路径，其次在 creation-spec 总纲里写映射规则；**不要因此修改 skill 正文**。

## 2. skill 目录格式（两种来源通用）

```text
<name>/                        # 目录名 = 注册名，必须 kebab-case（[a-z0-9-]）
├── SKILL.md                   # 必需。YAML frontmatter + 精简正文入口
├── references/                # 可选。分环节细则，正文用相对路径引用
│   └── xxx-spec.md
├── SKILL.cn.md                # 可选。中文对照（人读，不参与注册）
└── meta.yaml                  # 可选。展示元数据（版本/标签/摘要）
```

### SKILL.md 骨架

```markdown
---
name: my-new-skill
description: 一段 200 字以内的路由描述：这个 skill 做什么、什么时候用、不适用什么。模型靠它决定是否加载。
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
| `description` 非空且 ≤500 字符 | Host 注册表按 500 字符截断 |
| 正文引用的每个 `references/<file>` 必须真实存在 | 渐进披露可用性（`read` 找不到文件流程即断） |
| 正文非空且含 markdown 标题 | 加载结果基本可读性 |

## 3. 路径 A：扩充上游 skill（推荐，最常见）

适用：MiniMax-H3 仓库发布了新 skill，或要把某个未启用的上游 skill 打开。

1. **更新 submodule**：`git submodule update --init --recursive`（或 `git -C minimax-h3 pull`）。
2. **加入启用集**：在 [scripts/sync-minimax-skills.mjs](../scripts/sync-minimax-skills.mjs) 的 `ENABLED` 集合里加一行 skill 名。
3. **构建**：`corepack yarn workspace canvas-studio build`。同步是构建链第一步，日志应出现 `+ <name> (verbatim directory copy)`。
4. **（可选）接入风格路由**：见 §5。
5. **验证**：跑 `corepack yarn workspace canvas-studio test:smoke`（新 skill 自动纳入 verbatim 与 references 质量门），再按 [minimax-skills-acceptance.md](./minimax-skills-acceptance.md) 在桌面抽查该 skill 能加载、references 能按需读取。

上游 skill 更新版本时：重跑第 3 步即可，`skills/` 会被整体重建，diff 即上游变更。

## 4. 路径 B：本地自研 skill（skills-local/）

适用：写一个不依赖上游 submodule 的自研 skill。

1. **编写 bundle**：在 `canvas-studio/skills-local/<name>/` 下按 §2 格式创建 `SKILL.md`（+ 可选 `references/`）。
2. **构建**：`corepack yarn workspace canvas-studio build`。同步脚本在复制上游之后合并 `skills-local/`，日志出现 `+ <name> (local bundle)`。
3. **验证**：同路径 A 第 5 步（本地 skill 不做 submodule 比对，其余质量门同样生效）。

规则与注意：

- **重名覆盖**：`skills-local/` 里与上游同名的 skill 会覆盖上游副本（同步日志警告）。用于"临时热修上游 skill"是可以的，但长期修改应回流上游。
- **归属**：`skills-local/` 由本仓库所有、随 git 提交；`skills/` 是构建产物（同样入库，便于 review 与 dev 直用），两者不要手改 `skills/` 本体。
- **与上游无关的自研 skill 不进 ENABLED 集合**（那个集合只管上游复制来源）。

## 5. （可选）接入需求澄清的风格路由

只有"面向终端用户的成片风格"需要这一节；工具型 skill（如 h3-prompt-writing）跳过。

1. **风格预设表**：在 [creation-spec.ts](../src/skills/creation-spec.ts) 的「风格预设」表加一行，四列对齐既有行——预设名（用户点选标签，逐字用于 ask_user_choice）、适用场景、流程差异/关键约束、对应 skill 的英文原名（模型据此 `skill(name=…)`）。
2. **大类归属**：该 skill 要挂进 3a 大类题（商业推广 / 动画叙事 / 讲解科普 / 艺术创意）之一，写进 creation-spec 的分类对照行。
3. **风格 GIF 预览（可选）**：放一张 `assets/style-demos/<name>.gif` 即可在澄清第③步渲染预览卡片；没有 GIF 不影响 skill 生效，只是无预览图。上游 skill 的 GIF 由同步脚本从 submodule `assets/` 自动复制；本地自研 skill 手动放置。
4. 若新风格涉及本插件不具备的能力（如烧录字幕），确认占位工具/能力边界章节已有对应降级描述，没有则在 creation-spec「能力边界」补充。

## 6. 发布与打包

- `package.json` 的 `files` 已含 `skills/**`，同步产物随包发布；打包态 `lib/**` 与 `skills/**` 经 asarUnpack 落为物理路径，`read` 工具可直达。
- 提交纪律：`skills/`、`skills-local/`、sync 脚本改动一并入库；`skills/` 的 diff 就是上游变更本身，review 时直接看。

## 7. 扩充检查清单（PR 自查）

- [ ] 目录名 kebab-case，与 frontmatter `name` 一致
- [ ] `description` 非空、≤500 字符、写清"何时用/何时不用"
- [ ] 正文精简（入口级），细节在 `references/` 且正文用 `references/<file>` 相对路径引用
- [ ] 正文引用的所有 references 文件真实存在
- [ ] `corepack yarn workspace canvas-studio build` + `test:smoke` 全绿
- [ ] 桌面抽查：catalog 出现新 skill；`skill(name=…)` 加载成功；references 按需读取成功
- [ ] （风格类）creation-spec 风格表 + 大类归属已更新；GIF 预览按需放置
- [ ] （能力缺口）占位工具 / 能力边界描述覆盖
- [ ] 状态登记：STATUS.md 加 CV 条目（或并入既有条目）
