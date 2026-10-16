# 用户上传 skill —— 开发文档（devdoc v1.0）

> 日期：2026-10-16 · 状态：**可开工**（技术前提已全部实测，剩余 8 条小决策已给默认值）
> 上游设计：`skill-user-upload-design-2026-10-16.md`（**P1~P6 / Q1~Q7 已拍板**，见其 §7）
> 视觉与交互基线：`skill-user-upload-mockup-2026-10-16.html`
> 契约前身：`skill-user-upload-contract.md` / `src/skill-upload-contract.ts`（CV-325）
> 前置已落地：CV-317~326（skill 系统四阶段九批）
>
> ⚠️ **编号口径（2026-10-16 更正）**：**不在文档里预领号** —— 编号开工时取、验收后登记。
> 本文与效果图里的 `CV-xxx` 一律视为**批次代称**，实际号以开工当天 `STATUS.md §4.1` 的水位为准。
> 已作废：原草案 §4 曾把 CV-327~CV-330 预留给本线；`CV-327` 已被 REQ-034 B3/B4 占用（`9b937710d0` / `a72eaf7ca4`）。
>
> **实施状态（2026-10-16 晚，CV-331~CV-333）**：批次 1/2/3 **全部代码已落地**
> （契约改造 + 导入校验层 + 落盘 + 4 条路由 + 广场动态列表 + 三步向导 + 9 条错误码 + 全套样式）。
> 本文与实现的一处**有意差异**：原§5 计划把结构与规模校验写在 `validateImport` 里，
> 实现上**独立成 `src/skill-import-validate.ts`**（纯函数、零 IO），使「路由 / 落盘 / 单测」
> 三方共用同一判据。其余按本文。落地记录见 `skill-user-upload-contract.md` §0。

---

## 0. 开工结论

**技术面：无阻塞。** 三个曾经的不确定已全部实测落地（见 §3），其中两个直接消掉了原以为要开发的量。
**决策面：8 条小决策**（§1.4），全部给了默认值——不采用默认值才需要拍板，采用即视为通过。
**通道面：⚠️ 唯一需要协调的** —— REQ-034 线正在活跃开发（B0–B7 还有后续批次），且已改过本线要动的 `routes.ts` / `client/index.ts`（见 §11.1）。

> **复核实测（2026-10-16 14:45，HEAD `a72eaf7ca4`）**：本文 §2 的 19 条行号证据，**17 条精确命中、4 处偏移 5~6 行**（已在表中标注）；§3 引用的**上游行号全部精确命中**。
> 上游服务面的四条关键断言已逐条验证成立：`SkillSource` 含 `'user-dsh'`（`skill/src/index.ts:39`）、`SkillViewOptions extends SkillLookupOptions` 且 `cwd` 选择项目根（`:117-120`）、`USER_DSH_RANK = 400` 绑 `join(dshHome,'skills')` + `skipSystem`（`skill-filesystem/src/index.ts:39,253`）、`BUNDLED_SKILL_RANK = 600`（`skill/src/index.ts:27`）。
> ⇒ **`source === 'user-dsh'` + `snapshot({cwd})` + 「用户级输给内置」这三条设计地基成立，无需改设计。**

| 面 | 结论 | 证据 |
|---|---|---|
| 目录发现 / 热更新 / 优先级 | **零开发**（上游 `skill-filesystem` 已在标准 preset 挂载） | §3.1 / §3.2 |
| 导入的文件来源 | ⚠️ **必须走 renderer 的 file input** —— canvas-studio 拿不到原生目录选择器 | §3.3 |
| 写盘后的可见性 | ⚠️ **只能靠 Chokidar，做不到同步失效**（本插件不是 `edit`/`write` 的 actor） | §3.4 |
| 冲突判据 | ⚠️ **是 frontmatter `name`，不是目录名**（效果图已勘误） | §3.5 |
| Host→Client 推送 | 走**轮询**（复用既有「空闲即停」纪律），不引 SSE | §3.6 |
| 契约改造 | `slot` 从「绑定输入」降级为「展示标签」⇒ 原 X1 死锁 / X2 fail-open **自然消解** | §5.3 |
| 编号 | **开工时取、验收后登记**（不预领）；本文按**批次 1/2/3** 表述 | 本页页首 |

---

## 1. 范围与决策

### 1.1 做什么

让用户把**自己写的知识型 skill** 放进产品并**真的生效**，四件事：

1. **导入**：把一个本地目录包（`<name>/SKILL.md` + 可选 `references/`）或单个 `.md` **落到** `<DSH_HOME>/skills/`。
2. **看见**：广场出现「我的技能」分组 + 来源角标；详情卡显示**生效状态三态**。
3. **生效**：进 catalog（自动，上游发现）→ 通过 chips **装载**（`skills.json`，CV-323 既有机制）。
4. **管理**：冲突提示、改名指引、删除（可恢复）。

### 1.2 明确不做（第一阶段）

| 不做 | 为什么 |
|---|---|
| 决策型 skill 上传 | P1 拍板：决策打架的源头；`role` 非 `knowledge` 一律拒 |
| 项目级 skill 目录（`<cwd>/.dsh/skills`） | P2 拍板：上游 `<projectRoot>` 取「最近含 `.git` 的祖先」，与 canvas-studio 的「项目」不是一回事，有跨项目串味风险 |
| 槽位绑定（用户 skill 顶替内置） | P3 拍板：`toolchain.md` 在包内只读，要生效得新增第二份可写表，与 CV-324 单源化方向相反 |
| 应用内新建表单 / zip 导入 | Q5 拍板：延后（§9 的批次 4） |
| 编辑已入库的 skill | 用户可直接改磁盘文件（热更新）；应用内编辑器属第二阶段 |
| 用户 skill 参与「能力槽位绑定表」 | 同 P3 |

### 1.3 与既有实现的边界

- **不改** `skills/canvas-studio-creation/references/toolchain.md`（内置绑定表，包内只读）。
- **不改** 内置 skill 的 `platform.yaml` 体系（编译期 `BUNDLED_CATALOG` 快照，有深相等守卫）。
- **不加** YAML 依赖（`parseSkillFrontmatter` 现有实现刻意只支持扁平 `key: value`，见 §5.4）。

### 1.4 待确认的 8 条小决策（默认值即建议）

| # | 决策 | 默认值 |
|---|---|---|
| **D1** | 导入的文件来源 | renderer 侧隐藏 `<input type="file" webkitdirectory multiple>`；**不做原生 dialog**（拿不到） |
| **D2** | 写盘后如何让 catalog 立刻刷新 | **接受 Chokidar 延迟**（≤ ~300ms），不尝试注入 `fs/observed` |
| **D3** | 删除的去向 | **应用内回收站** `<DSH_HOME>/skills/.trash/<slug>-<ts>/`（跨平台一致，不依赖 Electron shell）。✅ 效果图 S6 已按此勘误 |
| **D4** | 同名用户 skill 重复导入 | **允许覆盖**；原目录先整体移入 `.trash/`（提示里给出恢复路径） |
| **D5** | 规模上限 | 单文件 ≤ 256KB / 总量 ≤ 2MB / 文件数 ≤ 50 / 子目录深度 ≤ 3 |
| **D6** | 二进制文件 | 只收文本（`.md` `.txt` `.json` `.yaml` `.yml`）；二进制**跳过并提示**，不算失败 |
| **D7** | 用户 skill 的分类从哪来 | 自己解析 frontmatter 的 `category`（可选）；缺失或非法 → 「未分类」 |
| **D8** | `disable-model-invocation: true` | **警告不拒绝**：模型永远看不到，等于装了不生效，必须说清 |

---

## 2. 现状取证（证据表）

改动会碰到的既有文件与位置（行号已按 **HEAD `a72eaf7ca4`** 复核实测；标 ⚠️ 的是偏移过的）。

| 位置 | 是什么 | 本线的用法 |
|---|---|---|
| `src/index.ts:47` | `export const inject = ['webServer','tools','skills','settings','systemPrompt']` | ✅ **`skills` 已注入**，`ctx.skills` 直接可用 |
| `src/index.ts:120` | `assetsRoot = () => source().assetDir \|\| dshHomePath('canvas-studio')` | 复用 `dshHomePath` 口径 |
| `src/routes.ts:244` | `ROUTE_ACTIVE_SKILLS = '/canvas-studio/active-skills'` | 新增路由的邻居；**不要动它** |
| `src/routes.ts:1991-2046` | active-skills 的 GET/POST；`MAX_ACTIVE_SKILLS = 12`（`:269`）；POST 后调 `invalidateActiveSkillsPromptCache()` | §8.2 的 X3 修复点 |
| `src/active-skills-prompt.ts` | 激活集注入 provider（order 154） | §8.2 |
| `src/projects.ts:282/296/323` | `dirOf(projectId)` / `projectDir` / `skills.json` 路径 | **`dirOf` 就是会话 cwd** ⇒ 可作 `snapshot({cwd})` 的入参 |
| `src/projects.ts:545/567` | `readActiveSkills` / `writeActiveSkills`（原子写） | 装载复用，不改 |
| `src/skill-catalog.ts` | `VISIBLE_CATALOG` / `SKILL_CATEGORY_IDS` / `SKILL_CATEGORY_LABELS` / `BUNDLED_CATALOG` | 内置展示元数据的唯一来源；用户 skill 不进去（保持编译期常量纯净） |
| `src/client/SkillMarket.tsx` | `VISIBLE_CATALOG` 在 `:23`(import) / `:49`(基础集) / `:120`(计数文案) / `:162`(侧栏计数) 被消费 | §7 改造成「内置 + 动态用户」；**计数文案是运行时算的，新增内置 skill 会自动跟随** |
| `src/client/SkillMarket.tsx:110-111` ⚠️ | 社区 CTA 卡「按目录规范投放你的技能（规划中）」（`:110`）+`待接入`（`:111`） | 改为引导到「导入技能…」 |
| `src/skill-upload-contract.ts` | CV-325 契约：`UPLOAD_SLOTS`(6) / `parseSkillFrontmatter` / `validateUpload` | **本线的契约改造对象**（§5.3） |
| `src/client/index.ts:1233`(CV-220 生成队列) / `:1300` ⚠️(REQ-034 B3 渲染工单) | 两个轮询，**均「空闲即停」** | §3.6 复用这个模式；⚠️ `:1300` 那段是 REQ-034 线刚加的 ⇒ **共享文件，见 §11.1** |
| `src/client/AssetLibrary.tsx:601` ⚠️、`LobbyStashBar.tsx:155` | 隐藏 `<input type="file">` + `.click()` | 导入入口的既有惯例 |

---

## 3. 技术前提（已实测）

### 3.1 发现 / 解析 / 热更新：零开发

本机 desktop 用的 `standard` preset **已经挂载** `skill-filesystem` 与 `tool-skill`：

```
~/.videobuddy/profiles/node_modules/@deepseek-ai/dsh/config/agent-presets/standard/agent.cordis.yml:83
  - id: skill-filesystem
    name: '@deepseek-ai/dsh-skill-filesystem'
  - id: tool-skill
    name: '@deepseek-ai/dsh-tool-skill'
```

它对 agents 提供：**扫目录 → 解析 frontmatter → Chokidar 热更新 → 按 scope/rank 合并**（`skill-filesystem/src/index.ts`）。
canvas-studio 声明了该依赖（`package.json`）却在源码零引用 ⇒ 以下**四件事不用写**：存哪、怎么被发现、改了怎么生效、什么格式。

**Watch 配置**（上游默认值）：`watch=true`、稳定阈值 **200ms**、轮询间隔 100ms、最大 128 个项目根、跟随符号链接。

### 3.2 落盘路径与优先级

`DSH_HOME` 由桌面端强设为 `~/.videobuddy`（`dsh-plugin-desktop/src/main.ts:158` → `resolveDshHome(join(homedir(), '.videobuddy'))`，`:471` 写入 env）。
⇒ `dshHomePath('skills')` = **`~/.videobuddy/skills`**（当前**不存在**，创建即生效）。

上游根目录与 rank（`skill-filesystem/src/index.ts:36-40, 240-258`）：

| rank | 根 | 说明 |
|---|---|---|
| 100 | `<projectRoot>/.dsh/skills` | 仅当传了 `cwd` |
| 200 | `<projectRoot>/.agents/skills` | 仅当传了 `cwd` |
| 300 | `customSkillDirs`（host 注入） | 本线不用 |
| **400** | **`<DSH_HOME>/skills`** | **本线的落盘位置**；该根带 `skipSystem: true` |
| 500 | `<DSH_HOME>` 同级的 `~/.agents/skills` | 本线不用 |
| 600 | bundled（`$DSH_BUNDLED_SKILL_DIR`） | 内置；**rank 大 = 优先级低** |

⇒ **用户级（400）输给内置（600）**，天然满足「内置优先」的既有拍板。这是选用户级而不是项目级的第二个理由。

⚠️ `skipSystem: true` 意味着 `<DSH_HOME>/skills/.system/` 被跳过 —— **`.system` 必须进 slug 黑名单**。

### 3.3 约束 A：导入只能走 renderer 的 file input

原生目录选择器只存在于 `dsh-plugin-desktop`（`electron-runtime.ts:144`、`workspace-admission.ts:90` 的 `showOpenDialog`），
**没有注入给 canvas-studio**（`src/index.ts:47` 的 inject 列表里没有对应服务）。

⇒ 导入流程的正确形态是：

```
用户在 renderer 选目录  →  读出文件内容（File.text()）  →  POST 内容给 Host  →  Host 校验 + 落盘
```

而不是「让用户选一个路径、Host 去读」。好处：**Host 永远不读用户给的路径**，`..`/绝对路径/符号链接逃逸这类问题在数据模型上就不存在（只落 `<DSH_HOME>/skills/<校验过的 slug>/`）。

UI 惯例已有先例：`AssetLibrary.tsx:606`、`LobbyStashBar.tsx:155` 都是隐藏 `<input type="file">` + `.click()`。

### 3.4 约束 B：写盘后做不到「同步失效」

上游有一个同步失效通道，但**本插件够不着**：

```ts
// skill-filesystem/src/index.ts:139-142
ctx.on('fs/observed', (target, _observation, actor) => {
  if (mutationToolName(actor) === undefined) return
  provider.observeHostMutation(target.displayPath)
})
// :693  mutationToolName 只认 actor.name === 'edit' | 'write'
```

即：只有经 dsh 的 `write` / `edit` **工具**落盘的改动才会即时失效。canvas-studio 用 `node:fs` 直写不会触发。

`ctx.skills`（`SkillRegistry`）的公开面只有 `registerProvider` / `register` / `list` / `snapshot` / `get` —— **没有 `invalidate()`**（`invalidate` 只在 provider 自己的 `SkillProviderControl` 上，`skill/src/index.ts:271-276`）。

**处置（D2）**：接受 Chokidar 的 ≤ ~300ms 延迟。落盘后「回到广场能看到」是**下一次轮询**的事，不需要同步等待（§8.1 的时序据此写）。

### 3.5 冲突判据是 frontmatter `name`

```ts
// skill-filesystem/src/index.ts:810-813
const name = stringField(parsed.data, 'name')
const description = stringField(parsed.data, 'description')
if (name === undefined || description === undefined) {
  ctx.logger.warn(`skill file ${path} ignored: frontmatter requires name and description`)
```

**注册名 = frontmatter `name`，目录名只决定物理位置。** 推论：

- 「与内置同名」的冲突是 **`name` 撞**，不是目录名撞 ⇒ ✅ **效果图 S3 的「改名指引」已于 2026-10-16 勘误为「改 `frontmatter.name`」**（物理目录建议同步改，但不是生效判据）。
- 目录名与 `name` 不一致**不会报错**，但会让用户困惑 ⇒ 校验里作为**警告**（不是拒绝）。

### 3.6 Host→Client 只走轮询

canvas-studio 现有路由全是普通 HTTP（`ctx.webServer.register({kind:'exact'|'prefix', ...})`），
**没有任何 SSE / WebSocket / EventSource**（`grep -rnE "EventSource|text/event-stream|WebSocket" src/` 零命中）。

而「空闲即停轮询」在本仓已是成熟模式（`client/index.ts:1239` 生成队列、`:1306` CSR 渲染工单，注释明写「零后台流量」）。
⇒ 广场的用户 skill 列表用**同款轮询**，不引入新协议。轮询频率沿用现有常量口径（有在飞任务才跑；无任务不跑）。

---

## 4. 数据模型与落盘布局

### 4.1 磁盘布局

```
<DSH_HOME>/skills/                     # = ~/.videobuddy/skills
├── night-noir-lighting/               # slug（目录名）
│   ├── SKILL.md                       # 必需，严格大写
│   └── references/                    # 可选；辅助文件必须放这里（见 §5.5）
│       └── palette.md
├── my-lighting.md                     # 扁平 .md 也合法（上游同样发现）
└── .trash/                            # 应用内回收站（D3）
    └── night-noir-lighting-20261016T143012/
```

### 4.2 slug 规则（唯一实现，Host 与 Client 共用）

```
^[a-z0-9][a-z0-9-]{1,63}$        # 2~64 字符，小写字母/数字/连字符
```

- 黑名单：`.system`（上游跳过）；保留名：`.trash`。
- 归一化查重：**大小写不敏感**（macOS 默认文件系统如此），`Foo` 与 `foo` 视为同名。
- 非法字符**不静默改写**（不把「我的打光」自动转拼音）—— 由用户在向导里改，或按 D7 从 `name` 派生建议值。
- 扁平 `.md` 文件名（去 `.md`）同样受此规则约束。

### 4.3 内存/接口模型

```ts
/** 面向 UI 的一条技能条目（内置与用户共用形状）。 */
interface SkillListItem {
  name: string                 // frontmatter name（内置 = 注册名）
  title: string                // 展示标题：用户条目回落 name
  summary: string              // 用户条目 = 截断后的 description
  category: SkillCategoryId    // 用户条目缺省 'uncategorized'
  icon: SkillIconId | null     // 用户条目缺省 null（渲染首字母）
  origin: 'builtin' | 'user'   // 决定来源角标
  slug: string | null          // 用户条目才有（删除/改名用）
  loadable: boolean            // 命中 catalog 且 modelInvocable
  conflict: { kind: 'name'; winner: string } | null
}
```

---

## 5. 契约：用户 skill 的 `SKILL.md`

### 5.1 字段表

| 字段 | 必填 | 上游行为 | canvas-studio 校验 |
|---|---|---|---|
| `name` | ✅ | 注册名 / 去重键；缺则**整条忽略**（`:810`） | 必填；`^[a-z0-9][a-z0-9-]{1,63}$`；与内置重名 → **警告** |
| `description` | ✅ | 进 catalog，超长截断 **500**（`tool-skill/src/index.ts:27,227`） | 必填；建议 ≤200，**硬上限 500** |
| `whenToUse` | ❌ | 透传进 catalog（`:830`） | 可选，≤200，透传 |
| `disable-model-invocation` | ❌ | `true` → `modelInvocable=false` | 可选；`true` → **警告**（D8） |
| `user-invocable` | ❌ | `false` → 不进人类可调用目录 | 可选，透传 |
| `role` | ✅（本仓） | 上游**不认**，忽略 | 必填且只能是 `knowledge`（P1） |
| `slot` | ❌（本次改为可选） | 上游忽略 | 给了就必须是**已知槽位**之一 —— 合法集 = 绑定表 6 值（`video-prompt` / `image-t2i` / `image-edit` / `audio-music` / `audio-voice` / `camera-language`）**∪ `general` ∪ `orchestration`**；**仅作标签，不参与绑定**（§5.3） |
| `category` | ❌ | 上游忽略 | 自己解析（D7）；非法 → `uncategorized` |
| `icon` | ❌ | 上游忽略 | 自己解析；非法 → `null` |
| `disableModelInvocation` / `modelInvocable` / `userInvocable` | ⛔ | **上游抛错** ⇒ 整条忽略（`:991-1006`） | **拒绝导入**，并提示正确写法 |

⚠️ 最后一行是硬坑：`modelInvocable` 是**驼峰遗留名**，上游见到就 `throw`。
（这与评审报告原 P0 提到的 `modelInvocable` 是两回事：那个是**上游 API 字段**，这个是**frontmatter 键**。）

### 5.2 与内置 skill 的契约差异

| | 内置 | 用户 |
|---|---|---|
| `platform.yaml` | 必需（展示元数据） | **不需要**（上游不认识，我们也不需要） |
| `meta.yaml` | 可选（上游署名） | 不需要 |
| `role` | 决策型/知识型皆有 | **只允许 `knowledge`** |
| `slot` | 决定槽位绑定 | 可选，仅标签 |
| 审批门 | 知识型不得自设审批门（渐进披露门禁） | 同口径：正文写审批门 → **警告** |

### 5.3 `skill-upload-contract.ts` 的改造（消掉 X1 / X2）

**问题回顾**：现行 `validateUpload(frontmatter, owners = {})` 的语义是「槽位绑定」，
而 `UPLOAD_SLOTS` 的 6 个槽位**全部**已被内置占用 ⇒ 注入正确 owners 时必然 `bound:false`（永不生效）；
不注入（默认 `{}`）时又 fail-open（用户顶掉内置）。两个分支都落不到正常态。

**改法**（P3 拍板的直接推论）：**`slot` 从「绑定输入」降级为「展示标签」**。

```ts
// 改造后（形状示意）
export type UploadVerdict =
  | { ok: true; note: string; advisories: UploadAdvisory[] }
  | { ok: false; reason: string }

export type UploadAdvisory =
  | { kind: 'name-collision'; with: string }   // 与内置/已有用户条目同名
  | { kind: 'slot-occupied'; slot: string; owner: string }  // 该槽位已有内置实现（仅提示）
  | { kind: 'model-hidden' }                    // disable-model-invocation: true
  | { kind: 'approval-gate-in-body' }
  | { kind: 'dir-name-mismatch'; dir: string }
  | { kind: 'binary-skipped'; files: string[] }
```

- 删 `bound` 字段、删 `owners` 参数（或保留为 advisory 输入，不再影响 `ok`）。
- `role` 仍必填、仍只接受 `knowledge`（P1 不变）。
- `slot` 保留但**可选**：给了非已知值 → 拒绝（拦住拼写错误）；给了合法值 → 只产 `slot-occupied` advisory。
  ⚠️ **合法集必须包含 `general` / `orchestration`**（2026-10-16 实测发现）：`general` 是**最主流的写法** —— 22 个内置 `platform.yaml` 里 **17 个用 `slot: "general"`**，只有 6 个用绑定表的槽位（`orchestration` 归总纲）。
  **若只认绑定表 6 值，用户照抄任意内置 skill 的写法就会被拒**，而这恰恰是用户最可能做的事。所以：合法集 = 绑定表 6 值 ∪ `{general, orchestration}`；`general`/`orchestration` 额外产一条「通用槽位，不代表能力绑定」的 advisory。
- **X1 消解**（不再有绑定决策）；**X2 消解**（不再有 fail-open 分支——没有「默认值导致行为翻转」这回事了）。

### 5.4 frontmatter 解析

沿用 `parseSkillFrontmatter`（`:59-72`）：只认扁平 `key: value`，不引 YAML 依赖。
**限制要写进 UI 提示**：数组、行内对象、多行值解析不出来。若 `category: [a, b]` 这类写法出现，`parseSkillFrontmatter` 会拿到字面串
→ 校验层判为非法值 → 回落 `uncategorized`（不会崩，也不会误判为合法）。

⚠️ 上游用的是**完整 YAML**（`parseFrontmatter`），我们的是**子集**。
⇒ 判据差异只允许出现在「展示字段」（`category`/`icon`/`role`/`slot`），**不许用来判 `name`/`description` 是否合法**：
那两项必须以上游为唯一事实源，做法是导入后**回读上游 catalog** 确认条目真的出现了（§8.1 第 5 步）。

### 5.5 辅助文件的硬规则

上游把**根级任意 `.md`** 都当候选 skill（`isPotentialSkillPath`：`segments.length === 1 && endsWith('.md')`）。
`<dir>/references/x.md` 因 `segments.length === 3` 被**安全忽略**；但 `<dir>/notes.md` 会被**当独立 skill 试解析**
（无 frontmatter → warn 忽略，污染日志且行为不可预期）。

⇒ **规则**：目录包内除 `SKILL.md` 外，任何 `.md` / `.txt` 必须位于子目录（默认 `references/`）。
导入时若发现根级多余 `.md`：**自动移入 `references/` 并在校验清单里标出**（不拒绝、不静默）。

### 5.6 校验三档

| 档 | 判据 | 呈现 |
|---|---|---|
| **拒绝**（`ok:false`，不可导入） | 缺 `SKILL.md` / 缺 `name` / 缺 `description` / `role` 非 `knowledge` / slug 非法 / 用了驼峰遗留键 / 超上限 | 红字 + 具体原因 + 修法 |
| **警告**（可导入，效果打折） | `name` 与内置或已有用户条目重名 / `disable-model-invocation: true` / 正文含审批门 / 目录名与 `name` 不一致 / 根级多余 `.md`（已自动归位） | 黄条 + 「会发生什么」 + 仍然导入 |
| **静默跳过** | 二进制 / 隐藏文件 / 超深目录 | 在「已跳过」折叠区列出文件名 |

---

## 6. Host 侧设计

### 6.1 新增模块

| 文件 | 职责 | 依赖 |
|---|---|---|
| `src/user-skills.ts` | 用户 skill 的**唯一落盘实现**：`listUserSkills()` / `writeUserSkill()` / `trashUserSkill()` / `emptyTrash()`；slug 校验、回收站、原子写 | `node:fs/promises`、`dshHomePath` |
| `src/skill-import-validate.ts` | **纯函数**校验层（可单测、零 IO）：`validateImport(files, existingNames) → ImportVerdict`。`skill-upload-contract.ts` 的 `parseSkillFrontmatter` 在此复用 | 无 IO |
| `src/routes.ts`（改造） | 新增 4 条路由（§6.2）+ X3 修复 | 既有 |
| `src/active-skills-prompt.ts`（改造） | X3：写入后同步重算（§8.2） | 既有 |

**单一实现纪律**：`user-skills.ts` 是唯一写 `<DSH_HOME>/skills` 的地方；`skill-import-validate.ts` 是唯一判「能不能导入」的地方。
端点只做「读 body → 调 verify → 落盘」，不重复业务规则。

### 6.2 路由表

全部挂 `/canvas-studio/skills` 前缀（`kind:'prefix'`），与 `ROUTE_ACTIVE_SKILLS` 区分开：

| 方法 | 路径 | 作用 | 返回 |
|---|---|---|---|
| `GET` | `/canvas-studio/skills` | 广场列表：内置（编译期常量）+ 用户（`ctx.skills.snapshot({cwd})` 过滤 `source==='user-dsh'`）+ 冲突标注 | `{ items: SkillListItem[], builtinCount: number }` |
| `POST` | `/canvas-studio/skills/import` | `{ slug, files: [{path, text}], overwrite: boolean }` → 校验 → 落盘 | `{ verdict }` 或 `{ error, code }` |
| `POST` | `/canvas-studio/skills/delete` | `{ slug }` → 移入 `.trash/` | `{ ok, trashedTo }` |
| `POST` | `/canvas-studio/skills/trash/empty` | 清空回收站 | `{ removed: number }` |

约定（与既有路由一致）：

- **`GET` 只读**；所有写操作走 `POST` + 同源校验（照抄 `routes.ts:2015` 的 `405` 口径）。
- 请求体上限：**4MB**（D5 的总量上限 2MB ×2 冗余），超限 `413`。
- 不提供「任意路径读写」的端点。

### 6.3 `listUserSkills` 的实现要点

```ts
// 只认 rank 400 这个根（user-dsh），不要自己扫盘（= 第二份事实源）
const snapshot = await ctx.skills.snapshot({ cwd: registry.dirOf(projectId) })
const mine = snapshot.skills.filter(s => s.source === 'user-dsh')
```

- `source` 字段是上游 `SkillSummary` 的既有字段（`source: 'user-dsh'`），**别自己猜**。
- 传 `cwd` 的理由：广场要显示「对本项目是否生效」，项目根的优先级高于用户级（100 < 400），不传 cwd 会漏掉「项目级顶掉用户级」这一真实冲突态。`dirOf(projectId)` 就是会话 cwd（`projects.ts:105` 注释：宿主 workspace / 会话绑在它上面）。
- 用户 skill 的**展示字段**（`category`/`icon`）上游不返回 ⇒ 需要时由 `user-skills.ts` 读那个目录的 `SKILL.md` 自己解析（**只有展示字段**，`name`/`description` 一律以上游回归值为准）。

### 6.4 错误码（新增前缀 `CS-SKILL`）

| 码 | 触发 | 用户可见 |
|---|---|---|
| `CS-SKILL-001` | 目录包缺 `SKILL.md` | ✅ |
| `CS-SKILL-002` | frontmatter 缺 `name` / `description` | ✅ |
| `CS-SKILL-003` | `role` 非 `knowledge`（或缺失） | ✅ |
| `CS-SKILL-004` | slug 非法 / 保留名 / 大小写重名 | ✅ |
| `CS-SKILL-005` | 用了驼峰遗留键 | ✅ |
| `CS-SKILL-006` | 超出 D5 上限 | ✅ |
| `CS-SKILL-007` | 目标已存在且 `overwrite !== true` | ✅ |
| `CS-SKILL-008` | 落盘失败（IO） | ✅ |
| `CS-SKILL-009` | 回收站操作失败 | ✅ |

新增错误码必须同时登记：`src/errors/catalog.ts` + `docs/api.md` 错误码附录（项目既有口径）。

---

## 7. Client 侧设计

### 7.1 文件与组件

| 文件 | 改动 |
|---|---|
| `src/client/SkillMarket.tsx` | 数据源从 `VISIBLE_CATALOG` 改为「内置常量 + 用户动态」；侧栏加「我的技能」；顶栏按钮从 `+ 新建技能`(disabled) 换成 `导入技能…` + `打开技能目录`；CTA 卡改引导 |
| `src/client/SkillImportWizard.tsx` | **新增**：三步向导（选择来源 → 预览与校验 → 完成） |
| `src/client/SkillStatusBadge.tsx` | **新增**：生效状态三态的呈现（含解释文案） |
| `src/client/SkillCard.tsx` | 加来源角标（内置 / 我的） |
| `src/client/api.ts` | 加 4 个薄封装（列表 / 导入 / 删除 / 清空回收站） |
| `src/client/index.ts` | 加「技能列表轮询」（**空闲即停**，照抄 `:1306` 的 CSR 工单轮询写法） |
| `src/client/styles.ts` | 新增 `.csSkillImport*` / `.csSkillSource*` / `.csSkillStatus*` 样式；`verify-previews.mjs` 若需分组则注册 |

### 7.2 数据流

```
SkillMarket 挂载
  → GET /canvas-studio/skills           （首次）
  → 轮询（仅在广场打开 + 有在飞请求时；空闲即停）
  → 合并：BUILTIN（编译期）∪ USER（运行时）
  → 渲染分组：官方精选 / 我的技能 / 其余技能
```

**状态归属**：列表是 Host 的事实 ⇒ client 不缓存为「应用状态」，只做「最近一次快照 + 是否在飞」。
装载（chips）仍走既有 `active-skills` 路由与既有 store，**不复用不改动**。

### 7.3 导入向导三步（对齐效果图 S3）

| 步 | 内容 | 关键点 |
|---|---|---|
| 1 · 选择来源 | 三张选择卡：**选择文件夹** / **选择 SKILL.md 文件** / **打开技能目录** | 前两个触发隐藏 `<input type="file">`（前者带 `webkitdirectory`）；第三个走宿主能力打开 Finder（若拿不到则降级为复制路径提示） |
| 2 · 预览与校验 | 左侧「校验清单」（来源 / name / description / role / slot / 落点）+ 右侧「结构校验」逐条 ✓/⚠️/✗ | **四种样例的判定必须由 Host 返回的 verdict 驱动**，不在前端重算规则 |
| 3 · 完成 | 落盘路径（`~/.videobuddy/skills/<slug>/`）+ **双状态**：已进 catalog ✓、未装载 ⚠️ | 「已进 catalog」的确认不靠前端假设 —— 见 §8.1 |

**按钮态**：`ok:false` → 主按钮 disabled + 红字原因；有 advisory → 黄条 + 主按钮文案变「仍然导入」（默认 D8/D4 都是「警告不拒绝」）。

### 7.4 生效状态三态（效果图 S4）

判定顺序（**唯一实现**，Host 侧算完随列表返回）：

| 态 | 判据 | 文案要点 |
|---|---|---|
| **已生效** ✓ | 在 catalog 中 + 已装载进本项目 `skills.json` | 「模型可用；本项目的提示词会带上它」 |
| **未装载** ⚠️ | 在 catalog 中 + **未**装载 | 「模型能看到它，但不一定会用；装载后本项目的任务会按它写」 |
| **有冲突** ⛔ | catalog 里的赢家不是它（被更高 rank 的同名条目顶掉） | 「与 `<winner>` 同名，`<winner>` 优先；改 `frontmatter.name` 后重传」 |

⚠️ 三态**不是**「有没有进 catalog」的二态。第三态的关键是「存在同名条目且自己输了」——这正是 §3.5 的推论。

### 7.5 视觉落地

以效果图 `skill-user-upload-mockup-2026-10-16.html` 为准，其中已验证的结构性约束：

- 来源角标放**左下**（H3 在左上、试跑在右上，左下零碰撞 —— 效果图里做了矩形相交断言 + 反向对照）。
- 侧栏「装载过的」改名「已装载」，新增「我的技能」（= 导入的条目）；两者语义不同，别复用同一个 key。
- 颜色只用既有令牌（`--cs-*` / `--dsw-alias-*`）；浅色/深色两轨都验过。
- 交互 HTML 必须自带基础重置（`button/input { appearance: none; font: inherit }`）—— 否则宿主 UA 样式会盖掉按钮底色。

---

## 8. 关键时序

### 8.1 导入

```
① 用户点「导入技能…」→ 选目录（renderer file input，webkitdirectory）
② renderer 读所有文本文件（File.text()），组装 {path, text}[]
   非文本 → 本地先标记，不上传内容
③ POST /canvas-studio/skills/import
④ Host：validateImport(files, existingNames)
     ✗ → 返回 verdict（不落盘）
     ✓ → writeUserSkill()：写 temp → rename（原子）→ 返回 verdict
⑤ 落盘完成 ≠ 立即可见：Chokidar 需 ≤ ~300ms 才能让 catalog 更新（§3.4）
     ⇒ 第 3 步的 UI 不阻塞等 catalog；用轮询在第 4~5 次拍到它能命中后翻绿
⑥ renderer 采到「已进 catalog」→ 第 3 步显示双状态（已生效/未装载）
```

**「已进 catalog」的确认方式必须用三值，不是二值**（2026-10-16 复核补入）：

`GET /skills` 返回条目的 `loadable` 由 Host 每次现算（`ctx.skills.get(name)` 命中）。
但**只看「在不在」会把「还没扫完」误判成「导入失败」**：上游 `snapshot()` 返回的是
`SkillCatalogSnapshot { skills, complete }`（`skill/src/index.ts:482-490`），`complete === false` 表示本轮发现**未完成**
（上游注释原文：*Incomplete observations are never cached, allowing consumers to retain last-good state and retry on their next request boundary*）。

⇒ **列表接口必须一并返回 `complete`**，前端按下表呈现，否则用户会在落盘后的头 ~200ms 看到一次假红：

| `complete` | 条目在 catalog 里 | 呈现 |
|---|---|---|
| `true` | 在 | **已进 catalog ✓** |
| `true` | 不在 | **真失败** —— 去查上游 warn 日志（多半是 frontmatter 不合法） |
| `false` | 不在 | **扫描中…** —— 继续轮询，**不报错、不标红** |

这条替代了原先「拍它几次」的模糊说法：判定依据从「轮询次数」变成上游给的确定性信号。

### 8.2 X3 修复：激活集的一轮空窗

**现状**（`routes.ts:2043-2046`）：`writeActiveSkills()` 之后只调 `invalidateActiveSkillsPromptCache()`（清缓存）。
provider 在缓存未命中时 `return ''` + 异步刷新 ⇒ **点完 chips 后的那一轮 assemble 看不到激活集**，第二轮才看到 ——
恰好是最需要它的那一轮。同文件注释「写完立刻下一轮一定读到新值」与实际相反。

**改法**：`invalidateActiveSkillsPromptCache()` 之后**同步重算并填入缓存**（`await` 一次装配），
使「下一轮 assemble」必然命中新值。缓存键与装配入口沿用既有实现，**不新增第二份装配逻辑**。

⚠️ 守卫要求：这条必须用**行为断言**（造一份 `skills.json` → POST → 立刻 assemble → 断言含新值），
不能只匹配源码里的函数名（本仓已有教训：只匹配文本的守卫曾被短路后照样全绿）。

### 8.3 装载

复用既有链路，不改：chips → `POST /canvas-studio/active-skills` → `skills.json` → 激活集注入。
用户 skill 与内置 skill 在装载上**完全同权**（都是 catalog 里的一个名字），这是 P3「不做槽位」的直接好处。

### 8.4 删除

```
POST /skills/delete { slug }
  → 校验 slug（禁 .. / 禁保留名）→ 确认目录在 <DSH_HOME>/skills 之内（realpath 前缀校验）
  → rename(<skills>/<slug>, <skills>/.trash/<slug>-<ts>)
  → 返回 { trashedTo }
```

- **不做物理删除**（D3）。`.trash` 里的目录不会被上游发现（`isPotentialSkillPath` 只认 ≤2 段；`.trash/x/SKILL.md` 是 3 段）—— ✅ 顺带确认：**回收站里的 skill 不会偷偷继续生效**。
  等等：`.trash/<slug>-<ts>/SKILL.md` 相对根的 segments = `['.trash', '<slug>', 'SKILL.md']` = 3 段 ⇒ `isPotentialSkillPath` 返回 false ⇒ 不发现。**但发现是另一条路径**（`discover` 用的可能是目录枚举而非 watch 事件）；§9 的验收用例 U-14 必须实测这一点。
- 装载过的项目：删除时**不自动改 `skills.json`**（那份清单是项目的事实），但 UI 要提示「有 N 个项目装载过它」——与效果图 S6 一致。

---

## 9. 分批实施（编号开工时再取，此处只按批次）

| 批次 | 范围 | 依赖 | 关键文件 |
|---|---|---|---|
| **批次 1** | **前置修复三连**：X3 激活集空窗 + `slot` 语义改造（消 X1/X2）+ 用户 skill 与内置同台时 `snapshot({cwd})` 的口径确定 | 无 UI 依赖，可独立落 | `active-skills-prompt.ts`、`routes.ts`、`skill-upload-contract.ts` |
| **批次 2** | 广场动态列表 + 「我的技能」分组 + 来源角标 + 详情卡三态 | 批次 1 的 `slot` 语义 | `SkillMarket.tsx`、`SkillCard.tsx`、`api.ts`、`client/index.ts`、`routes.ts`(GET) |
| **批次 3** | 导入向导与落盘（校验 + 冲突提示 + 回收站 + 删除） | 批次 2 的列表通路 | `user-skills.ts`、`skill-import-validate.ts`、`SkillImportWizard.tsx`、路由 3 条 |
| **批次 4**（可选） | 应用内新建表单 / 项目级目录 / zip / 回收站管理 UI | Q4 待定 | — |

**为什么批次 1 必须先做**：批次 3 的导入流程要校验 `slot`，而现在的 `slot` 语义是「必填 + 决定绑定」。
不先改语义，导入流程会去校验一个本不该存在的必填字段，UI 与契约撕裂。
**且批次 1 是纯 Host 侧、不碰 `SkillMarket.tsx`，是唯一能在并行开发期安全落地的批次。**

---

## 10. 验收用例（U 组）

### 10.1 可自动化（Host 纯函数 / 路由级）

| # | 用例 | 断言 |
|---|---|---|
| U-1 | slug 非法集 | `..`、`.system`、`.trash`、`A-B`、空、65 字符、含 `/` 全部拒绝 |
| U-2 | 缺 `SKILL.md` 的目录包 | `CS-SKILL-001` |
| U-3 | 缺 `name` / `description` | `CS-SKILL-002`（两项分别一条） |
| U-4 | `role: decision` / 缺失 | `CS-SKILL-003`；`role: knowledge` 通过 |
| U-5 | `slot` 可选性 | 不写 → ok；写绑定表值（如 `camera-language`）→ ok + `slot-occupied` advisory；写 **`general` → 必须 ok**（17 个内置的主流写法）+ 通用槽位 advisory；写错值（如 `vedio-prompt`）→ 拒绝 |
| U-6 | 驼峰遗留键 | `modelInvocable: false` → `CS-SKILL-005` |
| U-7 | 上限 | 单文件 257KB / 总量 2.1MB / 51 个文件 / 4 层目录 → `CS-SKILL-006` |
| U-8 | 根级多余 `.md` | 自动归位 `references/` + advisory；归位后**不产生**第二个 skill 条目 |
| U-9 | `name` 与内置重名 | ok + `name-collision` advisory（不是拒绝） |
| U-10 | 覆盖语义 | 同名再导入且 `overwrite:false` → `CS-SKILL-007`；`true` → 旧的进 `.trash` |
| U-11 | 路径逃逸 | `files[].path` 含 `../` / 绝对路径 → 拒绝，且 `<DSH_HOME>/skills` 之外**零写入** |
| U-12 | **X3 行为断言** | 写 `skills.json` → POST → **立刻** assemble → 含新值（旧实现必红） |
| U-13 | **X1/X2 消解断言** | `validateUpload` 不再有 `bound` 字段；任意输入都不存在「默认参数导致行为翻转」的分支 |
| U-14 | 回收站不生效 | 目录移到 `.trash/<slug>-<ts>/` 后 `ctx.skills.list()` **不含**该 name |
| U-15 | 名单纪律 | `CS-SKILL-*` 全部在 `errors/catalog.ts` 与 `docs/api.md` 有登记 |

### 10.2 需人看（视觉/UX，自动覆盖不到）

| # | 用例 | 判据 |
|---|---|---|
| U-16 | 导入向导三步完整走一遍（真实目录） | 每步信息完整、无压字、无按钮不可读 |
| U-17 | 四种样例的呈现 | 与效果图 S3 一致（合规 / 同名 / role 被拒 / 自设审批门警告） |
| U-18 | 详情卡三态 | 三种状态解释清楚「为什么没生效」 |
| U-19 | 浅色 + 深色两轨 | 无深底浅字 / 无低对比 |
| U-20 | 装载联动 | 点「使用」→ chips 立刻 +1 |
| U-21 | 端到端 | 导入 → 广场出现 → 装载 → 起一个任务 → **模型真的按该规范写**（这是唯一能证明「生效」的用例） |

⚠️ U-21 不可省：前面所有用例都只证明「链路通了」，不证明「模型用上了」。这条必须人看。

---

## 11. 风险与未决

### 11.1 ⚠️ 并行通道（2026-10-16 实测；开工前必读）

REQ-034 线（Remotion / 代码驱动合成）**此刻正在活跃开发**：B1~B5 已落（B3/B4 提交于
`9b937710d0` / `a72eaf7ca4`，后者 14:40），**剩余 R1~R6 六项**（见 `plans/REQ-034-剩余工作-20261016.md`）—— 其中 **R1 字体系统会再改 `routes.ts`**、**R6 路由接线会改总纲 `SKILL.md`**。

**两条线的文件重叠实测**：

| 文件 | REQ-034 是否已改 | 本线是否要改 | 冲突形态 |
|---|---|---|---|
| `src/routes.ts` | ✅ B3 加了 3 条渲染工单路由 + 复用 `upload-media` / `readRawBody`；⚠️ **R1 还要加字体只读路由** | ✅ 加 4 条 skill 路由 + X3 修复段 | **同文件不同段** ⇒ git 可自动合，但**双方行号会互相漂**（§2 表里 `:1991-2046` 这类区间引用尤其脆弱）；是**唯一会被两边反复追加**的文件 |
| `src/client/index.ts` | ✅ B3 加了渲染工单轮询（`:1300` 起） | ✅ 加「技能列表轮询」 | 同上；两段轮询结构高度相似，**容易复制粘贴串味** |
| `src/client/SkillMarket.tsx` | ❌ 未碰 | ✅ 主战场 | 无冲突 |
| `src/host-tools.ts` | ✅ B3 加 `render_composition`；⚠️ R2 还要接成片质检 | ❌ 本线不加工具 | 无冲突 |
| `skills/canvas-studio-creation/SKILL.md`（总纲） | ⚠️ **R6 要改第 10 步**（补 `render_composition` 路由） | ❌ **本线刻意不动总纲**（P3 不给槽位正是为了不改它） | 无冲突；但要知悉**总纲有 11KB 硬闸**，R6 加行会吃余量 |
| `src/active-skills-prompt.ts` / `src/skill-upload-contract.ts` | ❌ 未碰 | ✅ 改 | 无冲突（且 `skill-upload-contract.ts` 的**产品侧调用方为零**，只有 `tests/skill-upload-contract.test.mjs` ⇒ 改契约是干净的） |

**结论与建议**：

1. **批次 1 可以立即开工** —— 只碰 `active-skills-prompt.ts` / `skill-upload-contract.ts` / `routes.ts` 的 X3 段，与 REQ-034 的影响面基本不相交，**风险最低、且是批次 2/3 的前置**。
2. **批次 2/3 建议等 REQ-034 收尾**（其剩余 R1~R6 都还会改文件）—— `SkillMarket.tsx` 是主战场，还要配套改 `routes.ts` 的 GET 段与 `client/index.ts` 的轮询段。
3. **每次开工前先 `git fetch origin dev` + `git status` 复核**，不要在 `e209e5413e` 这类旧基线上写（本文的复核实测基线是 `a72eaf7ca4`）。
   ⚠️ **本轮实测教训**：devdoc 写完不到 30 分钟，HEAD 就从 `e209e5413e` 前进到 `a72eaf7ca4`（B4），并冒出一份新的 `REQ-034-剩余工作-20261016.md` ⇒ **行号类证据的有效期以「小时」计**，动手前必复看。

### 11.2 其余风险

| 风险 | 影响 | 处置 |
|---|---|---|
| Chokidar 在本机某些文件系统上不触发（网络盘 / 特殊挂载） | 导入后广场不出现条目 | 兜底：列表接口**顺带做一次目录枚举**（`readdir` 判 `<slug>/SKILL.md` 存在）作为「有没有文件」的第二判据；两者不一致时以 catalog 为准并记一行 warn |
| `~/.videobuddy/skills` 首次创建 | 上级目录不存在 | `writeUserSkill` 递归建目录（`mkdir -p` 语义）后再原子 rename |
| 用户直接改磁盘文件（热更新）绕过校验 | 可能出现不合规 skill（如决策型） | 接受：这是「产品 = 用户自己的电脑」的信任模型（P6）。但**列表里对不合规条目显示黄色标记**，不静默忽略 |
| 上游 `description` 截断 500 vs 自研 1024 | 契约写两套口径 | 用户环节统一按 **500**（X5）；自研注册那条不动 |
| 删除后 `skills.json` 仍引用旧 name | 装载清单里出现幽灵条目 | UI 侧对「装载了但 catalog 里没有」的 chip 标灰（既有 chips 组件需确认是否已处理） |
| `dirOf(projectId)` 作 `cwd` 时，若项目目录恰在某个 git 仓内 | 上游 `<projectRoot>` 会往上找，多出 `<repo>/.dsh/skills` 根 | 低危（用户不会往那里放东西）；若实测出现串味，改为 `snapshot({})` + 单独判「同名时谁赢」 |

**未决（不阻塞开工，属第二阶段）**

- 是否开放一个真正空置的风格槽位（Q4）。
- `whenToUse` / `metadata` / scope 分层是否接（X6）—— 本线**允许用户写 `whenToUse`** 但不额外消费它。
- `lobby-skill-marketplace-plan.md §4.6-2`（「不做激活即注入」已被 CV-323 反转）的勘误指针。
- ✅ 效果图 S3「改名指引」与 S6「进废纸篓」两处文案**已于 2026-10-16 按 §3.5 / D3 勘误**（回归 28/28 断言绿）。
- ⚠️ 效果图里的**内置计数是起草时的旧值**（15 可见 + 2 我的 = 17）。REQ-034 B4 新增 `code-driven-explainer` 后，可见内置已成为 **16** ⇒ 效果图应显示 18。**属示意数据、不影响产品逻辑**（`SkillMarket` 的计数是运行时 `VISIBLE_CATALOG.length`，自动跟随）。

---

## 12. 提交与登记清单

代码落完、**验收通过后**再登记（项目口径：不预写、不抢在验收前）。

1. `STATUS.md` §4.1 索引行（`ID|状态|P|标题`，标题 ≤40 字符、整行 ≤400 字节）
2. `cv-details.md` 的 `#### CV-xxx · 标题`（**ID 后必须是 ` · `**）
3. `changelog.md` 追加一行
4. `STATUS.md` §0「当前水位」+ 文件头「最近更新/上一条」（只留最近 3 条）
5. `node scripts/status-summary.mjs` 重算 §1（**禁手改**）
6. 闸：`tests/status-shape.test.mjs` 六条
7. 新增错误码 → `errors/catalog.ts` + `docs/api.md` 附录
8. 编号：**开工时取、验收后登记**（页首口径）。起草阶段用过 CV-327~CV-330 作批次代称，其中 CV-327 已被 REQ-034 占用；实际号以开工当天 `STATUS.md §4.1` 水位为准，**不要沿用草案里的号**。

### 验证分层（按本仓口径，别一刀切）

| 改动类型 | 验证 |
|---|---|
| `skill-import-validate.ts`（纯函数）/ `user-skills.ts`（IO + slug） | **T2**：build + 定向测试（U-1~U-11） |
| `routes.ts` / `active-skills-prompt.ts`（跨进程 + 注入） | **T3**：全量 `yarn test:smoke` + **反向变异**（U-12 / U-13 必须能真红） |
| `SkillMarket.tsx` / 向导 / 三态（视觉） | build + 定向 + **桌面自主验收**；视觉只做结构性断言，不做像素 diff |

⚠️ 测试入口只准 `yarn test:smoke`；**禁裸 `node --test`**（会扫到真机探针，2026-10-15 有事故）。
⚠️ 需要真跑上游 provider 的用例：不要碰生产后端；`skill-filesystem` 是纯本地，安全。
