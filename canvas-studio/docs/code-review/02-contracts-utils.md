# 02 · 契约与工具类审查

> 覆盖：`contracts/project.ts` / `contracts/canvas.ts` / `encoding.ts` / `reference-token.ts` / `error-kind.ts` / `skills/*` / `index.ts`
> 条目：CR-029 ~ CR-039。状态总表见 [README.md](./README.md#3-状态总表修复台账)。

---

## 高危

### CR-029｜[高] `normalizeWorkflow` 把缺失 `options` 归一化成空 `[]` 并写回，多选/推荐失效
- **位置**：[project.ts#L46](../src/contracts/project.ts#L46)
- **问题（是什么）**：`options: Array.isArray(question.options) ? question.options.map(String) : []`——旧数据缺 `options`/非数组时被重置为 `[]`（空数组）。
- **影响**：多选与单选都依赖 `options`（画布渲染 chips、`ask_user_choice` 兜底返回推荐项却无推荐项）。空 `options` 被不可恢复写回 registry，点选卡片无任何选项。
- **解决方案**：缺省 `options` 时保留原值或打 warn 可见降级，避免写回空数组。
- **验收方式**：构造含 `question` 但无 `options` 的历史记录，归一化后仍应有可见降级/不静默清空。
- **状态**：✅ **已修复·待验收**（2026-09-02）——[project.ts](../src/contracts/project.ts#L40-L57) 在 `options` 缺失/非数组时打 `console.warn`（带问题对象，便于定位脏数据），字段契约仍以空数组降级（类型不变、不破坏消费方）；新增 [workflow-mode.test.mjs](../../tests/workflow-mode.test.mjs) 2 用例（缺失告警 / 合法不打告警）。

### CR-030｜[高] ~~`formatRefToken` 死代码~~ → **误报，已否决**
- **位置**：[reference-token.ts#L14-L16](../src/reference-token.ts#L14-L16)
- **问题（是什么）**：子代理审查称 `formatRefToken` 无消费点、客户端另行拼接。**核实为误报**：`formatRefToken` 实被 [StudioFrame.tsx#L356](../src/client/StudioFrame.tsx#L356) 导入使用（`formatRefToken(node.title ?? node.id)`），引用到对话走同一条 token 通路，并非「客户端另行拼接」。
- **结论**：✅ **已否决**（2026-09-03）——非死代码，无 DRY 漂移问题；不处理。

### CR-031｜[中] `@ref[...]` token 边界未约束（标题含 `]` 截断；单值多 token 静默取首）
- **位置**：[reference-token.ts#L22-L35](../src/reference-token.ts#L22-L35) + [host-tools.ts#L152](../src/host-tools.ts#L152)、[#L170](../src/host-tools.ts#L170)
- **问题（是什么）**：① `@ref\[([^\]]+)\]` 假定显示名不含 `]`，重命名含 `]` 会被截断；② 单个字符串含多个 token 时 `resolveRefValue` 只取 `resolved[0]`，其余丢弃；③ token 大小写敏感、对任意文本误写都会命中并按 title 查库，查不到即抛错中断。
- **影响**：参考图错配、多 token 丢参、普通聊天误写即中断生成。
- **解决方案**：`formatRefToken` 对 `[` `]` 做转义/拒绝；`resolveRefValue` 对多 token 明确「仅支持单 token」并断言而非静默取首；解析时令牌上限防超长输入。
- **验收方式**：标题含 `]` 的节点能完整引用；单值多 token 有明确报错而非静默丢。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[reference-token.ts](../src/reference-token.ts)：`formatRefToken` 拒绝含 `[`/`]` 标题（抛「无法生成 @ref 引用标记，请先重命名」）；`parseRefTokens` 加 `MAX_REF_TOKENS=64` 上限。[host-tools.ts#L178-L188](../src/host-tools.ts#L178-L188) `resolveRefValue` 单值多 token 显式报错（不再静默取首）。[StudioFrame.tsx#L355-L371](../src/client/StudioFrame.tsx#L355-L371) `handleReferenceToChat` 捕获 `formatRefToken` 异常转 toast，不复制坏标记。新增 [reference.test.mjs](../../tests/reference.test.mjs) 2 用例（拒绝 `[`/`]`、token 上限）。

### CR-032｜[中] `error-kind` 判定 `unreachable` 先于 `config`，双命中消息误导用户
- **位置**：[error-kind.ts#L46-L51](../src/error-kind.ts#L46-L51)
- **问题（是什么）**：消息同时命中「连接失败」与「api key/credential/401」时一律归 `unreachable`，UI 提示「检查后端」，真实根因是配置缺失。
- **影响**：用户在设置页校正才正确，诊断被带偏。
- **解决方案**：收窄 UNREACHABLE（要求含连接/超时关键字**且不含** config 类关键字），或 UNREACHABLE 匹配后叠加「排除 CONFIG 关键词」子判定。
- **验收方式**：构造「连接失败：invalid api key」应归类为 config 而非 unreachable。

### CR-033｜[中] `resolveDramaApiKey` 全缺时 fail-fast 抛错，空 key 不被判缺失
- **位置**：[index.ts#L55-L63](../src/index.ts#L55-L63)
- **问题（是什么）**：`ctx.get('credentials')` 未定义或未命中时直接 throw；`hit.value` 为空串时不判缺失（`hit !== undefined` 仅判存在）。
- **影响**：用户即使不需要 Drama 后端（仅本地/画布手动合成），每次生成前也爆配置错误；空 key 被静默当作有效。
- **解决方案**：无 credentials 服务时返回更明确的中文降级信息；校验空 key 判缺。
- **验收方式**：不配置 Drama 也不走 Drama 时不应强制报错；空 key 应视为未配置。

### CR-035｜[中] placeholder `renderText` 无守卫强转，`text` 可能为 undefined
- **位置**：[placeholder-tools.ts#L20-L23](../src/skills/placeholder-tools.ts#L20-L23)
- **问题（是什么）**：`const v = value as { text: string }` 后直接 `return [{ type:'text', text: v.text }]`，上游 render 传入形状不符值时会产出 `text: undefined` 块。
- **影响**：空文本块可能被模型调用管道丢弃。
- **解决方案**：`typeof v.text === 'string' ? v.text : ''` 兜底。
- **验收方式**：传入缺 `text` 的对象，输出为 `''` 而非 undefined。

### CR-036｜[中] MiniMax frontmatter 解析不含 `>` 折叠与引号剥离
- **位置**：[minimax-skills.ts#L35-L64](../src/skills/minimax-skills.ts#L35-L64)
- **问题（是什么）**：`parseFrontmatter` 只支持 `key: value` 与 `|` 折行；`description: >`（folded）不处理，`description: "带引号"` 保留两端引号。
- **影响**：上游某 SKILL.md 描述含折叠/引号时，注册 description 截断或带引号。
- **解决方案**：补充 `>` 折叠与引号剥离；或在 sync 脚本侧强制规范 frontmatter。
- **验收方式**：含折叠/引号描述的 SKILL.md 注册后描述正确。

---

## 低危清单

| ID | 位置 | 问题 | 解决方案 |
| --- | --- | --- | --- |
| CR-034 | [index.ts#L36-L92](../src/index.ts#L36-L92) | `base`/`cfg`/`host-config` schema 默认值**三处重复维护**（长尾风险，已现 maxParallel 不一致） | 默认值单源到 host-config，index 引用 |
| CR-037 | [minimax-skills.ts#L79-L80](../src/skills/minimax-skills.ts#L79-L80) | 空串 `description` 不被 `??` 兜底（`??` 不认为空串缺失） | 改 `(meta.description \|\| meta.name \|\| name).slice(0,500)` |
| CR-038 | [canvas.ts#L79-L80](../src/contracts/canvas.ts#L79-L80) | `thumbnail` 冗余死字段，长期无消费者 | 防腐：移除或在清理周期标注占位目的（同时确认下游） |
| CR-039 | [encoding.ts#L18-L25](../src/encoding.ts#L18-L25) | 依赖全局 `btoa`（隐含 Node≥16）+ 大文件 base64 内存峰值 | 注释标注 Node 版本约束；大文件建议分块输出或 `Buffer` 方案 |

---

## 其他（建议留意、暂不单独立项）
- **无关紧要的类型挂注**：`negotiation` 多处 `as`/`!` 断言已兜底，无运行风险。
- `resolveRefFilenames` 以标题作 Map 键，重名参考取最后一个（[host-tools.ts#L150](../src/host-tools.ts#L150)）——建议含 id 消歧。与 CR-031 关联，可在同批处理。