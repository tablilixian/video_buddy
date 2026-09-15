# 分辨率三档分级 —— 需求、开发计划与待决项

> **上游输入**：`docs/resolution-tier-guide.md`（下称「参考稿」，2026-09-15）
> **本文档定位**：把参考稿的「改这 7 个文件」重写成需求 + 计划 + 待拍板项。保留可直接施工的坐标，补上缺的决策，标出**不能照做**的地方。
> **当前状态**：`已落地·待桌面验收`（**CV-187**）。本文档只作**决策留痕**；施工口径与实际结论一律以 [`docs/plans/resolution-tier-dev.md`](./resolution-tier-dev.md) 为准。
> **2026-09-15 更新**：用户提供了 **H3 官方推荐分辨率表** → Q1（三档像素）与 Q2（fal 2K 存疑）**已结案**；
> Q3/Q5/Q6 因前提变化被改判。用户随后拍板 §6 两点（默认 `768p` ✅、`image_generate` 也给 `resolution` ✅）→ **P1/P2/P3 已落地**。
> **仍未闭合的一件事**：**P0-d（Drama 端 `megapixels` > 0.4 是否被接受）实测未证实** —— 首轮实测中后端于该请求处转为不可达，无法归因。故 `drama.ts` 本轮**不动**，Drama 视频的「声明分辨率 ≠ 真实产物」**仍是未修缺陷**。详见 dev 文档 §0.5 / §3.3。
> **编号**：已在 `docs/STATUS.md` 登记 **CV-187**；**下一条从 CV-188 起**（DD 最高为 DD-10，下一条 DD-11）。

---

## 0. 结论先行

| # | 结论 |
|:--|:--|
| 1 | 参考稿的**行号清单 100% 准确**（7 处逐条核对无误），可以当施工坐标直接用 —— 这在文档里是少见的靠谱 |
| 2 | 但它把**两件不同的事**写成了一件：视频侧「枚举改名 + 去升档 hack」（小改，fal 侧已有三档基础）与图片侧「新增分辨率档位」（真新功能，需要新参数 + 新来源） |
| 3 | ~~三档像素值全部是反推的、无实测；`2K` = 1920×1088 存疑~~ → **已结案**：用户提供的 H3 推荐表逐行确认 `0.4 → 864×480`、`1.0 → 1376×768`、`2.0 → 1920×1088`，且输出保证为 32 的倍数 |
| 4 | 有一处会**真崩**：删掉 `720p`/`1080p` 后，历史画布节点重试会 `TypeError`（§2） |
| 5 | 有**两处漏项**会让验证当场变红：`tests/generate.test.mjs:721` 与 `tests/video-provider-fal.test.mjs:133`（§1.2） |
| 6 | 参考稿 §6 步骤 8 的命令 `corepack yarn test` **不存在**（实际是 `yarn test:smoke`），且 `yarn check` **不含** test |

**建议节奏**：先 P0 探针（不动代码，约半天）→ 拿到真实档位像素 → 再按 §6 拍板结果决定 P1~P3 的范围。

---

## 1. 与代码的逐条核对

### 1.1 参考稿的 7 处改动点（全部准确）

| # | 参考稿位置 | 核对 | 补充 |
|:--|:--|:--|:--|
| 1 | `src/config.ts` 39–42 | ✅ | 函数实际在 37–44；唯一调用点 `generate.ts:1047`（已 grep 确认全仓只有这一处） |
| 2 | `src/providers/drama.ts` 24 | ✅ | `MEGAPIXELS` 在 4 处 body 使用：78 / 86 / 97 / 104 |
| 3 | `src/providers/fal.ts` 76–81 | ✅ | 消费点在 172–176；`resolution` 是无条件写入 `input`（在 capability 分支之前） |
| 4 | `src/providers/types.ts` 45 | ✅ | — |
| 5 | `src/generate.ts` 103 | ✅ | 另需改 `host-tools.ts` 1113 / 1174 的两处参数类型断言 |
| 6 | `src/host-tools.ts` 1101 / 1162 | ✅ | 另需改同文件 1113 / 1174（类型断言）与 1120 / 1181（赋值） |
| 7 | `src/host-tools.ts` 529 | ✅ | 消费点 1654–1655 |

### 1.2 参考稿**没提**、但落地时会红/会过期的 9 处

| # | 位置 | 内容 | 后果 |
|:--|:--|:--|:--|
| A | `tests/generate.test.mjs:721-722` | 断言生图 `mediaWidth=1280` / `mediaHeight=720` | 改 `config.ts` 默认尺寸 → **测试红** |
| B | `tests/video-provider-fal.test.mjs:133-161` | 断言 `720p→768P`、`1080p→2K` 升档 + warning | 改枚举 → **测试红** |
| C | `skills/canvas-studio-creation/references/toolchain.md:55` | 写着 4 枚举与升档规则 | 技能侧教错参数 → agent 会传废枚举 |
| D | `skills-local/canvas-studio-creation/references/toolchain.md` | 同上（双目录镜像） | 同 C；注意 `yarn build` 的 `sync-minimax-skills.mjs` 不一定覆盖这个文件，需手改 |
| E | `docs/api.md:71, 72, 201` | 分辨率契约表 | 文档与实现不符 |
| F | `docs/canvas-studio-tools.md:246, 278, 474` | 工具参数表 | 同上 |
| G | `docs/STATUS.md:173` | 「多模型切换」行写着 resolution 是占坑 | SSOT 过期 |
| H | `docs/plans/video-provider-abstraction.md:78-84, 496-503, 834` | §5.3 映射表 + §11.2 勘误 + Q2 决策记录（「接受升档并 warning」） | **这是当前升档 hack 的决策依据**，改掉必须回填，否则后人不知道为何变过 |
| I | `docs/canvas-studio-api-usage.md:30, 116` | 「16:9→1280×720」写了两处 | 一旦动生图默认尺寸即过期 |

> **命令勘误**：参考稿 §6 步骤 8 写 `corepack yarn test` —— `canvas-studio/package.json` 里没有 `test` 脚本。实际是 `yarn test:smoke`（`node --test "tests/*.test.mjs"`）。并且 `yarn check` = build + verify:loader + typecheck，**不含单测**。

---

## 2. 会真崩的那一处（最高优先级，不是「注意一下」级别）

### 2.1 触发链（已逐环节读源码确认）

```
generate.ts:798-800   generationPromptOf(params)   // 只摘掉 retryOf，其余原样 JSON.stringify
   ↓  节点 generationPrompt 里存着 resolution: '720p'
client/api.ts:378-387 retryStudioNode → { ...base, ...overrides, retryOf }   // 节点级重试按原参数重放
   ↓
generate.ts:208       videoRequestOf → { ...(params.resolution !== undefined ? { resolution: params.resolution } : {}) }
   ↓
providers/fal.ts:173  RESOLUTION_MAP[req.resolution]
   ↓  删掉 '720p' 键之后
   ↓  → undefined
providers/fal.ts:174  input.resolution = mapped.value     // TypeError: Cannot read properties of undefined
```

### 2.2 为什么这不是理论风险

- `resolution` **已经在 fal 通道上线过**（`fal.ts:79-80` 那两条升档 warning 就是为 4 枚举写的），所以真实画布节点里确实可能存着 `720p`/`1080p`。
- 同仓**已经有过完全同类的先例**：`drama.ts:43-45` 的 `dramaAspect()` 就是为历史参数做的运行时兜底，注释写明「画布老节点重放 generationPrompt 时可能仍带着历史参数 `1:1`，统一落回横屏，**绝不把非法取值发出去**」。
- **画幅侧有兜底，分辨率侧一个都没有。** 参考稿直接删键，等于把画幅侧踩过的坑再踩一遍。

### 2.3 要求

新增归一函数（与 `dramaAspect` 同一模式），在**进 map 之前**处理：

| 历史值 | 归一为 | 依据 |
|:--|:--|:--|
| `720p` | `768p` | 与现行升档映射一致（`fal.ts:79`） |
| `1080p` | `2k` | 与现行升档映射一致（`fal.ts:80`） |
| `480p` / `768p` / `2k` | 原值 | — |
| 其它任何值 | 默认档 | 与 `dramaAspect` 的「落回默认」同构 |

**并且这条守卫必须反向验证能红**：把归一函数摘掉，测试必须失败。否则就是「断言写的是实现现状」而不是用户期望（本项目已有此教训）。

---

## 3. 概念澄清：这不只是一件事，是两件事

参考稿 §3 其实已经指出了差异，但 §1/§2 的改法仍按「一套档位改 7 个文件」写 —— 底层并没有共享实现，三档只是给两条不同链路起了同一套名字。

| | **图片链路**（`image_generate` / `character_generate`） | **视频链路**（`video_generate` / `video_composite`） |
|:--|:--|:--|
| 参数形态 | `width` + `height`（像素） | Drama：`aspect` + `megapixels`；fal：`resolution` 字符串 |
| 现状有无「档」的概念 | **没有**（固定一组像素） | **已经有**（fal 原生 480P/768P/2K/4K，本地 4 枚举含 2 个升档） |
| 唯一入口 | `sizeForAspectRatio()` → `generate.ts:1047` | `VideoRequest.resolution` → 适配器 |
| 后端契约原文 | `docs/canvas-studio-api-usage.md:31`：「图像类端点收 `width/height` 像素；fl2va/ref2va 收 `aspect` + `megapixels`，**两种风格不要混传**」 | 同左 |

**由此得到的真实工作量**：

- **R1（视频）** = 枚举改名 + 去升档 + 加历史兜底。改动小，但风险集中在 §2 那处崩溃。
- **R2（图片）** = **全新能力**。需要新参数、新的档位来源、新的默认尺寸决策。参考稿只写了一句「改 `sizeForAspectRatio` 的返回值」，把这一整块复杂度漏掉了。

---

## 4. 需求

### R1 · 视频分辨率档位直通化

| 编号 | 需求 | 验收方式 |
|:--|:--|:--|
| R1.1 | `VideoResolution` 收窄为 `'480p' \| '768p' \| '2k'` | `yarn typecheck` 绿 |
| R1.2 | fal `RESOLUTION_MAP` 三键**直通**，删除两条升档 warning | 单测：3 档输入 → 输出 `480P`/`768P`/`2K`，**且 warnings 为空** |
| R1.3 | 历史值 `720p`/`1080p` 归一，不抛错、不静默丢弃 | 单测：4 个历史值各跑一次，断言不抛 + 落预期档；**摘掉归一函数必须红** |
| R1.4 | 三档语义写进工具描述（480p 草稿 / 768p 默认 / 2k 交付） | `host-tools.ts` 两处 description 一致 |
| R1.5 | Drama 侧 `megapixels` 三档 —— **待 P0 实测后决定做/不做** | 探针报告 |

### R2 · 图片分辨率档位（范围待 Q3/Q4 拍板）

| 编号 | 需求 | 备注 |
|:--|:--|:--|
| R2.1 | 三档 → 映射为 `width`/`height` 像素 | 像素值以探针实测为准 |
| R2.2 | 1:1 三档共用 1024×1024 | 与 `types.ts:36-37`「方形只保留在图片类工具」一致 |
| R2.3 | 档位来源：工具参数 > 项目 plan > 全局设置 > 默认 | 见 Q4 |
| R2.4 | 默认档**不得改变现有默认输出**（推荐） | 见 Q3 |

### R3 · 一致性与同步

| 编号 | 需求 |
|:--|:--|
| R3.1 | 改造 §1.2 的 A / B 两个测试文件 |
| R3.2 | 回填 §1.2 的 C~I 共 7 处文档/技能（含 `skills-local/` 镜像） |
| R3.3 | 验证链：`build` → `verify:loader` → `typecheck` → `test:smoke`，**只认 `fail 0`** |

> ⚠️ **本机跑法**：本机 shell 里**没有 `yarn`**（历史坑），要展开成显式路径：
> ```
> node scripts/sync-minimax-skills.mjs && node scripts/clean.mjs \
>   && ./node_modules/.bin/tsdown \
>   && ./node_modules/.bin/tsc -p tsconfig.json \
>   && ./node_modules/.bin/tsc -p tsconfig.client.json --emitDeclarationOnly \
>   && node scripts/verify-client-loader.mjs \
>   && node --test "tests/*.test.mjs"
> ```

---

## 5. 开发计划

### P0 · 探针（先做，零代码改动）

放 `docs/api-probe/`（本仓已有该惯例目录），用 `ffprobe` 读回**真实输出像素**，而不是相信标签。

| 探针 | 目标 | 为什么必须 |
|:--|:--|:--|
| P0-a | fal **t2v**：`480P` / `768P` / `2K` / `4K` 各一次 | 参考稿的像素值是反推的 |
| P0-b | fal **i2v**（首帧图生视频）：同上档位 | **见 Q2 —— 可能让整件事空转** |
| P0-c | fal **ref2v**：同上档位 | 多参考链路 |
| P0-d | Drama `image2videofl2va`：`megapixels` = 0.4 / 1.0 / 2.0 | 后端是否接受非 0.4 |
| P0-e | Drama `txt2image`：`width/height` 是否要求 32 倍数、上限在哪 | 「32 倍数」是未验证假设（反证：现行 1280×720 里 720÷32 不是整数，却一直正常） |

**放行条件**：5 份探针结果写进报告，三档像素值从「推测」变成「实测」。

### P1 · R1 视频档位直通（P0 通过后）

| 步骤 | 文件 |
|:--|:--|
| 1 | `src/providers/types.ts:45` 收窄枚举 |
| 2 | `src/providers/fal.ts:76-81` 三键直通 + 新增 `normalizeResolution()`；172-176 改为先归一后查表 |
| 3 | `src/generate.ts:103` 参数类型 |
| 4 | `src/host-tools.ts:1101/1113/1120/1162/1174/1181` schema + 类型断言 |
| 5 | `tests/video-provider-fal.test.mjs` 改 133-161；**新增**历史枚举兜底用例 |

**验证门**：`build` + `verify:loader` + `typecheck` + `test:smoke` 全绿（跑法见 R3.3 注，本机无 `yarn`）；兜底守卫**反向验证能红**。

### P2 · R2 图片档位（待 Q3/Q4 拍板）

| 步骤 | 文件 |
|:--|:--|
| 1 | `src/config.ts` 新增档位常量 + `imageSizeFor(aspect, tier)`（**不改** `sizeForAspectRatio` 签名，见 Q5） |
| 2 | `src/generate.ts:103` 新增 `imageTier?:` 参数；1047 的 `size` 改由新入口产出，档位来源见 Q4 |
| 3 | `src/host-tools.ts` 图片类工具 schema 加档位 |
| 4 | `tests/generate.test.mjs:721` 按最终默认档调整或保持 |

### P3 · 同步面回填

§1.2 的 C~I 七处 + `docs/STATUS.md` 登记 CV-187。

### P4 · 验收

桌面实测：三档各生成一次，画布节点尺寸、详情面板、成片合成均正常；**历史节点重试不崩**（这是本次最关键的手测项）。

---

## 6. 待拍板（含我的推荐与理由）

### Q1 · 三档像素值到底是多少？→ **必须探针，不能沿用参考稿**

参考稿的 864×480 / 1376×768 / 1920×1088 是**从 megapixels 反推**的，隐含两个未验证假设：

1. fal 的 `480P`/`768P`/`2K` 标签就等于这三个像素数。**`2K` 尤其可疑** —— 1920 宽在行业惯例里是 1080p 的量级，「2K」通常指 2048 或 2560 宽。若 fal 的 `2K` 实际输出 2560×1440，那「高档 = 2.0MP」这句就是错的。
2. 「宽高必须 32 的倍数」。**反证**：现行 `1280×720` 里 `720 ÷ 32 = 22.5`，不是 32 的倍数，而它一直正常工作 —— 说明要么后端不强制，要么会在内部钳制。参考稿没给出这条约束的出处。

> **推荐**：把像素值当作**探针的输出**而不是输入。P0 跑完再定表格。

### Q2 · fal 的 i2v 端点接受 `resolution` 吗？→ **可能让整件事空转**

`fal.ts:13` 明写「i2v：`minimax/h3/image-to-video`，**无 `aspect_ratio`（画幅跟随首帧图）**」。

而本产品的主链路是 **keyframe → video（首帧图生视频）**，走的正是 i2v 端点。若 i2v 的输出尺寸由首帧图决定，那么 `resolution` 在主链路上**根本不生效** —— 三档做完了，用户在主链路上也看不出差别。

> **推荐**：P0-b 必须单独测 i2v。若确实不吃 `resolution`，则在工具描述与 SKILL 里**如实写明「仅纯文生视频与多参考生效，首帧图生视频的画幅跟随关键帧」**，而不是让 agent 以为传了就生效（这正是本项目最反感的「参数没生效但不报错」型误导）。

### Q3 · R2 的默认档取哪个？→ **强烈建议：默认不变**

参考稿默认 = 中档 1376×768，比现行 1280×720 大 24% 面积。**反对**，理由是这属于**全量生图输出的静默变更**：

- 已生成资产与新生成资产尺寸不一致（同一项目里混着两套分辨率）
- 生成耗时与后端费用变化（Drama 是自架 GPU，耗时是直接可见的）
- `docs/canvas-studio-api-usage.md:30, 116` 两处契约说明立刻过期
- `tests/generate.test.mjs:721` 断言要改
- 收益仅为 +24% 面积

> **推荐**：**把「中档」定义为现状 `1280×720`**，低档 `864×480`、高档取实测值作为**新增可选**。这样默认零变更、零过期文档、零资产不一致；想要画质提升的用户显式选高档。
> 一句话：**别为了 +24% 面积付全量回归的代价。**

### Q4 · 档位由谁决定？→ **参考稿完全没定义，这是最大的逻辑空洞**

参考稿让 `sizeForAspectRatio` 加 `tier` 参数，但它唯一调用点是 `generate.ts:1047`，**没有任何调用方会传 tier** → tier 是死参数，生图永远停在同一档，需求 R2 事实上不成立。

> **推荐**：镜像既有的 `defaultAspectRatio` / `defaultVideoProvider` 模式，加设置项 `defaultResolution`（默认 `med`）：
> `host-config.ts`（`z.union` + default）→ `index.ts`（source + runtime）→ `generate.ts`（`runtime().defaultResolution()` 兜底）→ `SettingsModal.tsx`（下拉）
> 优先级：**工具参数 > 项目 plan > 全局设置 > 默认**。
> ⚠️ 这条链是 **4 处联动**，本项目历史上「多处同改」漏过（如 `GROUP_PADDING` 与 client 硬编码 `-12/+24` 分叉），改的时候一起改。

### Q5 · `sizeForAspectRatio` 要不要加 `tier` 参数？→ **建议不加**

它的返回值同时喂三处，其中一处**明确不需要档位**：

| 消费点 | 是否需要档位 |
|:--|:--|
| 生图请求体 `width/height`（`generate.ts:1196/1216/1232`） | 需要 |
| `frameSizeOf(size)` 画布节点显示框（`generate.ts:1052`） | **不需要** —— 它归一化到长边 480，与档位无关 |
| 工具返回的 `mediaWidth` / `mediaHeight` | 跟随实际输出 |

把档位塞进一个「宽高比 → 像素」的纯映射函数，等于让比例映射承担尺寸策略。

> **推荐**：保持 `sizeForAspectRatio(aspect)` 签名不变；新增独立入口 `imageSizeFor(aspect, tier)`，内部先取比例再按档定尺寸。函数名诚实，改动面更小。

### Q6 · `COMPOSED_FALLBACK` 该不该改？→ **建议不动**

参考稿说 1280×720 → 1376×768。但该常量的语义是**探针失败时的占位**（`host-tools.ts:1654`：`result.width ?? COMPOSED_FALLBACK.width`），它应该跟**素材/成片真实尺寸**一致，而不是跟「默认生成档位」一致。

另外参考稿漏了同类常量 `compose.ts:24` 的 `COMPOSED_FALLBACK_SIZE`（它取 `DEFAULT_NODE_SIZE`，是**节点框**尺寸，语义完全不同，本就不该跟着改）。

> **推荐**：维持不动。若确实要动，改为**从档位推导**而非硬编码新数字，避免下次调档又漏这里。

### Q7 · 草稿档会不会催生「向用户提问」？

现行技能明确禁止提问：`toolchain.md:55`「**不要为分辨率向用户提问**（除非用户明确要求指定）」、`3d-animation-short-generator/SKILL.md:213`「Resolution is not selectable: do not show a resolution choice card」。

引入三档后是否给 agent 主动选择策略（如「草稿阶段 480p、定稿 2k」）？这会直接影响每次生成的费用与耗时。

> **推荐**：agent 仍不主动提问；但允许它在**明确的草稿/试拍语境**下自行用低档，并在 SKILL 里写明判据（什么算草稿语境）。判据要落到文字，否则每个会话自己发挥。

---

## 7. 参考稿需要就地修正的 3 处

1. **§6 步骤 8 的命令**：`corepack yarn test` → `corepack yarn test:smoke`（前者不存在）；并注明 `yarn check` 不含单测。
2. **§1 / §2 的结构**：把「视频档位直通」与「图片新增档位」拆成两节 —— 当前写法让人以为是一件事，会低估图片侧的复杂度。
3. **§4「不需要修改的部分」表**：补一行 `src/compose.ts:24 COMPOSED_FALLBACK_SIZE`，说明它为什么不用改（走 `DEFAULT_NODE_SIZE`，是节点框尺寸而非媒体尺寸），否则读者会与 `host-tools.ts:529` 的同名概念混淆。

---

## 附：一页速查

| 项 | 结论 |
|:--|:--|
| 参考稿行号准确性 | 7/7 准确 |
| 可照做的 | §2.1（加常量）、§2.3（fal 直通）、§2.4（收窄枚举） |
| 必须加的 | 历史枚举归一函数 + 反向验证（§2.3） |
| 必须验的 | fal 三档真实像素、i2v 是否吃 resolution、Drama megapixels 是否可调（P0） |
| 建议改的 | 默认档维持 1280×720（Q3）、档位来源走设置项 4 处联动（Q4）、新增 `imageSizeFor` 而非改 `sizeForAspectRatio`（Q5） |
| 建议不动的 | `COMPOSED_FALLBACK`（Q6） |
| 漏项 | 2 个测试文件 + 7 处文档/技能 + 1 个命令勘误 |
