# Canvas Studio 代码审查问题追踪（code-review）

> 本目录收录 **2026-09-02 全源码逐文件代码审查**发现的问题与优化点，统一编号为 **CR-xxx**，便于按文档**依次修复与验收**。
> 每次修复完成后在本文件「状态总表」更新该条目状态，并勾掉对应模块文档里的清单。

---

## 0. 关于本目录

### 来源
一次对 `src/**` 全部代码文件（约 1.89 万行 TypeScript）的逐文件深度审查，覆盖 HOST/核心逻辑、契约与工具类、客户端 UI、画布渲染、客户端基础设施五大模块。

### 状态词（统一）
| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| `待处理` | 已记录，未开始修复 | 按优先级排期动手 |
| `进行中` | 正在修复 | 继续 |
| `已修复·待验收` | 代码已改、本地跑通，**未在桌面回归** | 重启桌面验证 → 通过改 `已完成` |
| `已完成` | 修复 + 桌面验收通过 | 无 |
| `已否决` | 明确不做 | 附原因 |

### 编号说明
- 统一前缀 **`CR-xxx`**，全局连续，不区分缺陷/优化（避免双序列）。
- 每条含：**位置**（审查时行号，可能随后续改动漂移）、**问题（是什么）**、**影响**、**解决方案（怎么做）**、**验收方式**。
- 本目录是**审查整理与修复台账**；状态最终同步到 [STATUS.md](../STATUS.md)（项目唯一事实来源）与相应 backlog。

### 修复纪律
1. 按「§5 优先级路线」顺序逐条处理，一次一条，避免并发改动串扰。
2. 修复后先跑 `yarn run typecheck` + `yarn run test:smoke`。
3. 涉及 HOST 侧 / 客户端渲染的新改动，需**完整重启桌面应用**加载新构建（desktop 进程缓存旧 `lib`，见项目 memory 教训）。
4. 通过后在 STATUS.md §8 变更日志记录，并同步本文件状态表。

---

## 1. 问题清单总览

> 详细描述见各模块文档。P：严重等级（高/中/低）。`→` 表示已在某日修复。

### 1.1 高危（建议最先处理）
| ID | P | 模块 | 问题（一句话） | 位置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| CR-001 | 高 | HOST | `compose_video` 缺省片段会把**成片节点**当片段，二次合成递归叠加 | [host-tools.ts](../src/host-tools.ts#L915-L917) | 已修复·待验收 |
| CR-029 | 高 | 契约 | `normalizeWorkflow` 把缺失的 `options` 归一化成空 `[]` 并写回，多选/推荐项失效 | [project.ts](../src/contracts/project.ts#L46) | 已修复·待验收 |
| CR-040 | 高 | UI | SettingsModal 的 TinyFish 凭据 effect 缺 `value` 依赖，**凭据状态永不刷新** | [SettingsModal.tsx](../src/client/SettingsModal.tsx#L92-L101) | 已修复·待验收 |
| CR-059 | 高 | 画布 | `CanvasEdges` SVG marker `cs-arrow-import` 被定义两次（`id` 冲突） | [CanvasEdges.tsx](../src/client/canvas/CanvasEdges.tsx#L136-L160) | 已修复·待验收 |
| CR-060 | 高 | 画布 | `CanvasSurface` 注释宣称 pointer capture，实际从未 `setPointerCapture`，拖出边界行为不符 | [CanvasSurface.tsx](../src/client/canvas/CanvasSurface.tsx#L363-L364) | 已修复·待验收 |

### 1.2 中危
| ID | P | 模块 | 问题（一句话） | 位置 | 状态 |
| --- | --- | --- | --- | --- | --- |
| CR-002 | 中 | HOST | ASSETS/style-demos 路由 `decodeURIComponent` 在 try 外，malformed URL 抛异常致 handler 挂住 | [routes.ts](../src/routes.ts#L419) | 已修复·待验收 |
| CR-003 | 中 | HOST | `ProjectRegistry.dirOf` 回退路径未校验越界，`projectId=../x` 可穿目录写文件 | [projects.ts](../src/projects.ts#L131-L134) | 已修复·待验收 |
| CR-006 | 中 | HOST | `appendCanvasNode` 每次追加全量读+写 canvas.json（内部再读一次） | [projects.ts](../src/projects.ts#L271-L275) | 已修复·待验收 |
| CR-007 | 中 | HOST | `create` 并发同名竞态 + 注册表写失败遗留空目录 | [projects.ts](../src/projects.ts#L296-L323) | 已修复·待验收 |
| CR-010 | 中 | HOST | 产物下载 `fetch(mediaUrl)` 无超时、无大小上限、整读内存 | [generate.ts](../src/generate.ts#L935-L937) | 已修复·待验收 |
| CR-011 | 中 | HOST | `readSourceBytes` 对任意 URL/本地路径读取（SSRF / 本地文件泄露面） | [generate.ts](../src/generate.ts#L231-L260) | 已修复·待验收 |
| CR-012 | 中 | HOST | `resolveDramaApiKey` 已定义但从未注入请求头 | [host-tools.ts](../src/host-tools.ts#L360) | 待拍板 |
| CR-013 | 中 | HOST | `splitStoryboard` 中途失败产生半成品（部分帧/节点已落盘） | [generate.ts](../src/generate.ts#L1100-L1131) | 已修复·待验收 |
| CR-018 | 中 | HOST | `asset-capture` 对任意 `tool/result` 都触发、且盲访问 `message.source` 可能抛错 | [asset-capture.ts](../src/asset-capture.ts#L205-L212) | 已修复·待验收 |
| CR-021 | 中 | HOST | `extractVideoStyle` 中途失败遗留孤儿视频/抽帧 | [video-style.ts](../src/video-style.ts#L136-L173) | 已修复·待验收 |
| CR-022 | 中 | HOST | compose 逐段用首片分辨率非等比拉伸，画幅不一致会变形 | [compose.ts](../src/compose.ts#L241) | 已修复·待验收 |
| CR-031 | 中 | 契约 | `@ref[...]` token 边界未约束（标题含 `]` 截断；单值多 token 静默取首） | [reference-token.ts](../src/reference-token.ts#L22-L35) | 已修复·待验收 |
| CR-032 | 中 | 契约 | `error-kind` 判定 `unreachable` 先于 `config`，双命中消息误导用户 | [error-kind.ts](../src/error-kind.ts#L46-L51) | 待处理 |
| CR-033 | 中 | 契约 | `resolveDramaApiKey` 全缺时 fail-fast 抛错，空 key 不被判缺失 | [index.ts](../src/index.ts#L55-L63) | 待处理 |
| CR-035 | 中 | 契约 | placeholder `renderText` 无守卫强转，`text` 可能为 undefined | [placeholder-tools.ts](../src/skills/placeholder-tools.ts#L20-L23) | 待处理 |
| CR-036 | 中 | 契约 | MiniMax frontmatter 解析不含 `>` 折叠与引号剥离 | [minimax-skills.ts](../src/skills/minimax-skills.ts#L35-L64) | 待处理 |
| CR-041 | 中 | UI | StudioFrame 大量内联回调/派生数组每渲染重建，击穿子组件 memo | [StudioFrame.tsx](../src/client/StudioFrame.tsx) | 已修复·待验收 |
| CR-042 | 中 | UI | `installBrandStyles` cleanup 不移除 DOM，重装会累积 `<style>` 元素 | [brand-inject.ts](../src/client/brand-inject.ts#L59) | 待处理 |
| CR-045 | 中 | UI | LogoMark 铰链/白板硬编码灰，不随明暗主题联动 | [LogoMark.tsx](../src/client/brand/LogoMark.tsx#L31-L33) | 待处理 |
| CR-046 | 中 | UI | SkillCard hover 菜单键盘用户可能完全无法触达 | [SkillCard.tsx](../src/client/SkillCard.tsx#L57-L74) | 待处理 |
| CR-061 | 中 | 画布 | CanvasSurface 单击选中也 push 历史 + 触发持久化（undo 快照膨胀） | [CanvasSurface.tsx](../src/client/canvas/CanvasSurface.tsx#L394) | 已修复·待验收 |
| CR-062 | 中 | 画布 | 方向键连发每次持久化写盘，无节流 | [CanvasSurface.tsx](../src/client/canvas/CanvasSurface.tsx#L286-L296) | 已修复·待验收 |
| CR-063 | 中 | 画布 | 拖拽逐帧整棵 surface 所有节点+边全量重渲染 | [CanvasSurface.tsx](../src/client/canvas/CanvasSurface.tsx#L580-L656) | 已修复·待验收 |
| CR-066 | 中 | 画布 | 每个 loading 节点独立 1s `setInterval`，批量生成 N 个定时器 | [CanvasNode.tsx](../src/client/canvas/CanvasNode.tsx#L91-L97) | 已修复·待验收 |
| CR-071 | 中 | 画布 | Minimap 命中/跳转 fallback 用 `window` 尺寸，与实测尺寸首帧不一致 | [Minimap.tsx](../src/client/canvas/Minimap.tsx#L72-L73) | 已修复·待验收 |
| CR-081 | 中 | 画布 | 节点用 `left/top` 布局不走合成层，拖拽重绘开销大 | [styles.ts](../src/client/styles.ts#L857-L858) | 已修复·待验收 |
| CR-089 | 中 | 基础设施 | question 卡片本地选态在 `data.answer/note` 回流后不清零，展示冲突 | [question-capture.tsx](../src/client/question-capture.tsx#L120-L123) | 待处理 |

### 1.3 低危
见各模块文档末尾「低危清单表」。

---

## 2. 模块文档索引
| 文档 | 覆盖范围 | 条目 |
| --- | --- | --- |
| [01-host-core.md](./01-host-core.md) | routes / projects / generate / host-tools / compose / asset-capture / ffmpeg-run / video-style / canvas-view / canvas-aspect / canvas-actions / config | CR-001 ~ CR-028 |
| [02-contracts-utils.md](./02-contracts-utils.md) | contracts / encoding / reference-token / error-kind / index / skills | CR-029 ~ CR-039 |
| [03-client-ui.md](./03-client-ui.md) | StudioFrame / ProjectList / UserCard / SettingsModal / ModelSettingsPanel / SkillMarket / SkillCard / SkillIcon / SkillCarousel / ActiveSkillChips / LobbyHero / brand/* | CR-040 ~ CR-058 |
| [04-client-canvas.md](./04-client-canvas.md) | CanvasSurface / CanvasNode / CanvasEdges / CanvasTimeline / Minimap / CanvasToolbar / ContextMenu / BlankMenu / LayerDetailPanel / LayerPanel / ReferenceTray / Modals / canvas-math / labels / styles | CR-059 ~ CR-081 |
| [05-client-infra.md](./05-client-infra.md) | project-store / api / layout-controller / slots-contracts / contracts / question-capture / brief-capture | CR-082 ~ CR-091 |

---

## 3. 状态总表（修复台账）
> 修复勾选时：在 `状态` 列改为「已修复·待验收」→ 桌面回归后改为「已完成」，并在「完成日」填日期。

| ID | P | 状态 | 完成日 | 备注 |
| --- | --- | --- | --- | --- |
| CR-001 | 高 | 已修复·待验收 | 2026-09-02 | |
| CR-002 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-003 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-004 | 中 | 待处理 | | |
| CR-005 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-006 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-007 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-008 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-009 | 低 | 待处理 | | |
| CR-010 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-011 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-012 | 中 | 待拍板 | | 后端鉴权方式未定（docs §5-3），不臆造方案 |
| CR-013 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-014 | 低 | 待处理 | | |
| CR-015 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-016 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-017 | 低 | 待处理 | | |
| CR-018 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-019 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-020 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-021 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-022 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-023 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-024 | 低 | 待处理 | | |
| CR-025 | 低 | 待处理 | | |
| CR-026 | 低 | 待处理 | | |
| CR-027 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-028 | 低 | 待处理 | | |
| CR-029 | 高 | 已修复·待验收 | 2026-09-02 | |
| CR-030 | 高 | 已否决 | | 误报：formatRefToken 实被 StudioFrame.tsx:356 使用（子代理漏检） |
| CR-031 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-032 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-033 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-034 | 低 | 待处理 | | |
| CR-035 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-036 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-037 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-038 | 低 | 待处理 | | |
| CR-039 | 低 | 待处理 | | |
| CR-040 | 高 | 已修复·待验收 | 2026-09-02 | |
| CR-041 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-042 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-043 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-044 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-045 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-046 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-047 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-048 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-049 | 低 | 待处理 | | |
| CR-050 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-051 | 低 | 待处理 | | |
| CR-052 | 低 | 待处理 | | |
| CR-053 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-054 | 低 | 待处理 | | |
| CR-055 | 低 | 待处理 | | |
| CR-056 | 低 | 待处理 | | |
| CR-057 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-058 | 低 | 待处理 | | |
| CR-059 | 高 | 已修复·待验收 | 2026-09-02 | |
| CR-060 | 高 | 已修复·待验收 | 2026-09-02 | |
| CR-061 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-062 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-063 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-064 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-065 | 低 | 待处理 | | |
| CR-066 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-067 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-068 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-069 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-070 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-071 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-072 | 低 | 待处理 | | |
| CR-073 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-074 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-075 | 低 | 待处理 | | |
| CR-076 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-077 | 低 | 待处理 | | |
| CR-078 | 低 | 待处理 | | |
| CR-079 | 低 | 待处理 | | |
| CR-080 | 低 | 待处理 | | |
| CR-081 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-082 | 低 | 待处理 | | |
| CR-083 | 低 | 待处理 | | |
| CR-084 | 低 | 待处理 | | |
| CR-085 | 低 | 待处理 | | |
| CR-086 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-087 | 低 | 已修复·待验收 | 2026-09-03 | |
| CR-088 | 低 | 待处理 | | |
| CR-089 | 中 | 已修复·待验收 | 2026-09-03 | |
| CR-090 | 低 | 待处理 | | |
| CR-091 | 低 | 待处理 | | |

---

## 4. 已核实并确认为「有意设计/非缺陷」（勿重复排查）
为节省回溯时间，以下经代码核对判断为**有意设计**，不在修复范围：
- 项目所有 HTTP 入口均要求 **loopback + 同源校验**，CR-003/CR-011 虽为风险面但**不可被远程直接利用**（属纵深防御项而非漏洞）。
- `removeProject` 删除路径已有 `startsWith` 守卫（projects.ts）。
- `projects.ts` 的 `moveNode` 组带动 children、多选拖拽防双移，逻辑正确。
- `normalizeWorkflow` 的 `multiSelect`/`allowFreeText` 三端（contract/client/Host）语义一致；多选答案以「、」拼接契约对齐。
- 跨项目 undo 单栈、全局剪贴板、`layout-controller` 全 no-op，均为显式设计选择。
- `minimax-skills` / `skill-catalog` / `brand*` / `canvas-math` 为纯函数/纯数据，逻辑自洽。
- `ProjectList` / `StudioFrame` 的 CSS 类名探测式降级是刻意稳健策略（建议加 warn，见 CR 对应条目）。

---

## 5. 优先级路线（建议执行顺序）
1. **第一批（高危，功能正确性）**：CR-001、CR-029、CR-040、CR-059、CR-060 —— 直接纠正错误行为，改动局部。
2. **第二批（中危·安全/健壮性）**：CR-003、CR-010、CR-011、CR-012、CR-002 —— 收敛 SSRF/路径穿越/下载超时。
3. **第三批（中危·数据一致/性能）**：CR-006、CR-007、CR-013、CR-021、CR-018、CR-022、CR-031。
4. **第四批（客户端渲染性能/体验）**：CR-061、CR-062、CR-063、CR-066、CR-071、CR-081、CR-041。
5. **第五批（UI 视觉/契约/可访问性）**：CR-042、CR-045、CR-046、CR-040 复查、CR-032、CR-033、各低危项。

---

## 6. 变更记录
| 日期 | 条目 | 说明 |
| --- | --- | --- |
| 2026-09-02 | — | 建立本目录，录入代码审查问题 CR-001 ~ CR-091 |
| 2026-09-02 | CR-001 / CR-029 / CR-040 / CR-059 / CR-060 | **第一批（高危）修复落地**：CR-001 缺省选片排除成片节点（抽纯函数 `defaultComposeClips`，+4 测试）；CR-029 `normalizeWorkflow` options 缺失打可见告警（+2 测试）；CR-040 TinyFish effect 补 `value` 依赖；CR-059 删除重复 marker、`import` 常驻 marker 集合；CR-060 节点/缩放/link 手势加 pointer capture（marquee 按 CV-008 约定保持拖出取消）。验证链全绿：tsc Host emit ✓ / typecheck（Host+Client）✓ / tsdown ✓ / test:smoke **185/185** ✓。状态 → **已修复·待验收**（5 条）。桌面回归方法见 README §0 |
| 2026-09-03 | CR-002 / CR-003 / CR-010 / CR-011 | **第二批（安全/健壮性）修复落地**：CR-002 routes 两处 `decodeURIComponent` 移入 try（malformed URL 不再挂起 handler）；CR-003 `dirOf` 回退路径 resolve 后校验落在 projects 目录内（+2 测试）；CR-010 新增 `downloadBytes` 助手（超时 + 字节上限 + 流式读取，替换三处整读下载，+1 测试）；CR-011 `readSourceBytes` SSRF 防护（IP 字面量私网/环回/链路本地/云元数据黑名单 + localhost 族 + 非 http(s) 拒绝）+ 本地读取白名单到资产库根（新增 `registryRoot` 访问器，+2 测试）。**CR-012 转待拍板**：文档 §5-3 明示后端当前无鉴权、是否发送 key 待后端确认，不臆造方案（避免破坏现网）。验证链全绿：tsc Host emit ✓ / typecheck（Host+Client）✓ / test:smoke **190/190** ✓。状态 → **已修复·待验收**（4 条）+ 待拍板（1 条） |
| 2026-09-03 | CR-006 / CR-007 / CR-013 / CR-018 / CR-021 / CR-022 / CR-031 | **第三批（数据一致/健壮性）修复落地**：CR-006 `appendCanvasNode` 抽 `writeCanvasDocument` 只读一次盘（生成热路径 2 读+1 写 → 1 读+1 写）；CR-007 `create` 写失败回滚已建目录 + 写前缓存复查同名（不留孤儿目录、收窄并发竞态）；CR-013 `splitStoryboard` 先全下载 → 统一写盘 → 再落节点，任一步失败清理已写文件（不留半成品）；CR-021 `extractVideoStyle` 失败清理视频+已抽帧（不留孤儿资产）；CR-018 `asset-capture` / `question-capture` 的 tool/result 盲访问 `message.source` 加防御（缺结构即不匹配，不再 TypeError 阻断事件）；CR-022 `buildTranscodeArgs` 改 `force_original_aspect_ratio=decrease` + pad 补足（画幅不一致不再非等比拉伸变形）；CR-031 `formatRefToken` 拒绝含 `[`/`]` 标题（StudioFrame 引用转 toast 提示）、`parseRefTokens` 加 64 token 上限、`resolveRefValue` 单值多 token 显式报错（不再静默取首）。**CR-030 定论误报**：`formatRefToken` 实被 StudioFrame.tsx:356 使用，非死代码，标已否决。验证链全绿：tsc Host emit ✓ / typecheck（Host+Client）✓ / tsdown ✓ / test:smoke **192/192** ✓（+2：CR-031 的 formatRefToken 拒绝 + token 上限；CR-022 断言更新）。状态 → **已修复·待验收**（7 条） |
| 2026-09-03 | CR-041 / CR-061 / CR-062 / CR-063 / CR-066 / CR-071 / CR-081 | **第四批（客户端渲染性能/体验）修复落地**：CR-041 StudioFrame 稳定化——`timelineOrder`/`referenceNodes` useMemo，beginEdit/persist/persistAfter/handleViewChange/handleDelete/handleUndo/handleRedo/handleRename/handleRetry/handleTimelineSelect 及 15 个 CanvasSurface 绑定回调全部 useCallback（依赖只含 projectId/actions/persistAfter），`onMediaNatural` 改经 `nodesRef` 读最新节点；CR-061 单击（无位移）不推 undo 历史/不持久化（`editBegun` 标志，首帧 move 才 onBeginEdit）；CR-062 方向键连发 300ms 去抖只写一次盘（卸载清 timer）；CR-063 `CanvasNode`/`CanvasEdges` React.memo + `visibleNodes`/`ordered` useMemo（moveNode 只给被移动节点新引用 → 拖拽时未移动节点不再重渲染）；CR-066 loading 节点改订阅**全局共享 1s ticker**（监听器归零自动停表，不再每节点一个 setInterval）；CR-071 Minimap `jumpTo` 经 `sizeRef` 读最新实测尺寸（消除首帧 window 回退过渡不一致）；CR-081 节点定位改 `translate3d`（left/top 锚 0）+ `.csNode` 加 `will-change: transform`（拖拽走合成层不触发布局重绘）。验证链全绿：tsc Host emit ✓ / typecheck（Host+Client）✓ / tsdown ✓ / test:smoke **192/192** ✓。状态 → **已修复·待验收**（7 条） |
| 2026-09-03 | CR-019/027/032/033/037/042/043/044/045/046/047/050/053/064/067/073/086/087 | **第五批（UI 视觉/契约/a11y/低危）修复落地**：CR-042 `installBrandStyles` cleanup 真正移除 style+favicon DOM（不再累积）；CR-045 LogoMark 铰链/白板改主题令牌（`--dsw-alias-border-l2`/`--dsw-alias-bg-layer-1`）；CR-046 `.csSkillHover` 加 `:focus-within`（键盘可触达）；CR-032 error-kind 拆「硬/软网络信号」——硬信号（ECONNREFUSED 等）优先 unreachable，软信号（连接失败/超时）与配置关键词同现时归 config（+3 测试）；CR-033 `resolveDramaApiKey` 空 key 判缺、未配置返回空串而非 fail-fast（对齐后端无鉴权现状）；CR-043 SkillMarket 社区 CTA 整区只渲染一次；CR-044 删除死代码 `StudioEmptyState`；CR-047 UserCard 渐变 id 改 `useId`；CR-050 SettingsModal 三个数字输入清空跳过（不再写 0）；CR-053 ProjectList 项目行键盘可达（role/tabIndex/Enter）；CR-064 link 模式拖出画布直接取消起草线（不伪造 (0,0) pointerup）；CR-067 `prefersReducedMotion` 模块级缓存；CR-073 LayerDetailPanel 复制反馈 timer ref 卸载清理；CR-086 api `readJson` 非 JSON 错误按 StudioApiError 归类（不抛 SyntaxError）；CR-087 `normalizeCanvasNodes` 兼容 localhost 历史 URL；CR-037 minimax description 空串回退 name；CR-019 ffmpeg-run `finish` settled 防重入；CR-027 `previewSizeOf` 非正输入回退正方形（+1 测试）。验证链全绿：tsc Host emit ✓ / typecheck（Host+Client）✓ / tsdown ✓ / test:smoke **195/195** ✓。状态 → **已修复·待验收**（18 条） |
| 2026-09-03 | CR-005/008/015/016/020/023/035/036/048/057/068/069/070/074/076/089 | **第六批（剩余低危·值得做部分）修复落地**：CR-005 `sendJson` 加 `res.destroyed` 守卫（断连不再抛 ERR_HTTP_HEADERS_SENT）；CR-008 readRegistry 校验记录 dir 落在 projects 目录内（防损坏注册表指向系统路径）；CR-015 严格 base64 校验（字符集+填充+round-trip，非法不再以损坏字节写盘）；CR-016 `enhancePrompt` 兜底不再返回 `[object Object]`；CR-020 ffmpeg stdout/stderr 1MB 累计上限；CR-023 无 BGM 分支改 `copyFile`（不再整读大视频进内存）；CR-035 placeholder `renderText` 防御性取 text；CR-036 frontmatter 支持 `>` 折叠 + 引号剥离；CR-048 UserCard 面板打开期间监听 resize/scroll 重算位置；CR-057 SkillCarousel 箭头边界 disabled；CR-068 CanvasNode `canHoverPreview` 翻假时取消 hover timer；CR-069 CanvasTimeline 缩略图 onError 隐藏；CR-070 时间轴 dragOver setState 去重；CR-074 LayerDetailPanel 参考缩略无 url 不渲染空 src；CR-076 `calculateSnap` guides 按 (type,position) 去重（消除重复 React key）；CR-089 question 卡片权威结果回流时清空本地选态。验证链全绿：tsc Host emit ✓ / typecheck（Host+Client）✓ / tsdown ✓ / test:smoke **195/195** ✓。状态 → **已修复·待验收**（16 条） |