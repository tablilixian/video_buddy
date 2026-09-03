# 01 · HOST / 核心逻辑模块审查

> 覆盖：`routes.ts` / `projects.ts` / `generate.ts` / `host-tools.ts` / `compose.ts` / `asset-capture.ts` / `ffmpeg-run.ts` / `video-style.ts` / `canvas-view.ts` / `canvas-aspect.ts` / `canvas-actions.ts` / `config.ts`
> 条目：CR-001 ~ CR-028。状态总表见 [README.md](./README.md#3-状态总表修复台账)。

---

## 高危

### CR-001｜[高] compose_video 缺省片段把「成片节点」当片段，二次合成递归叠加
- **位置**：[host-tools.ts#L915-L917](../src/host-tools.ts#L915-L917)
- **问题（是什么）**：`compose_video` 在不传 `clipIds` 时选取 `doc.nodes.filter(node => node.kind === 'video')`，**没有排除成片节点**。成片节点由 `appendComposedVideoNode` 写入、`kind:'video'`（见 `compose.ts`），且成片总是最新创建、恒在队尾。
- **影响**：首次合成后再跑一次 compose 且不传片段时，上一版成片会被再次当作片段拼接 → **递归叠加**，成片质量与时长失控。
- **解决方案**：缺省选取时排除成片节点——仅取 `toolName === 'video_generate' | 'video_composite'` 的节点，过滤 `toolName === 'compose'`。
- **验收方式**：连续两次（不传 `clipIds`）调用 compose_video，第二次成片应只基于原始片段拼接，而非包含上一版成片。
- **状态**：✅ **已修复·待验收**（2026-09-02）——缺省选片抽为纯函数 `defaultComposeClips`（[host-tools.ts](../src/host-tools.ts#L63-L68)），`kind==='video' && toolName !== 'compose'` 过滤 + 按 createdAt 排序；工具 execute 改用该函数；新增 [compose-clips.test.mjs](../../tests/compose-clips.test.mjs) 4 用例覆盖排除成片/排序/非视频/空表。

---

## 中危

### CR-002｜[中] ASSETS/style-demos 路由 `decodeURIComponent` 在 try 外，malformed URL 抛异常致 handler 挂住
- **位置**：[routes.ts#L419](../src/routes.ts#L419)（assets）、[routes.ts#L480](../src/routes.ts#L480)（style-demos）
- **问题（是什么）**：这两行都在各自 `try` **之外**。请求 `/canvas-studio/assets/%zz` 时 `decodeURIComponent('%zz')` 抛 `URIError`，handler 直接 reject，不外发状态码、不回 `res.end()`。
- **影响**：响应悬空（或被框架统一 500），资源不释放；属可被触发的健壮性缺陷。
- **解决方案**：把 `decodeURIComponent` 移入 try（或先正则校验 `%` 编码合法性再解码）。
- **验收方式**：请求 `…/assets/%zz` 应返回明确的错误码（400/500）而非挂起。
- **状态**：✅ **已修复·待验收**（2026-09-03）——两处 `decodeURIComponent` 均包进 try，malformed 编码返回 400 `malformed asset path` / `malformed style demo path`（[routes.ts#L418-L427](../src/routes.ts#L418-L427)、[#L487-L496](../src/routes.ts#L487-L496)）。

### CR-003｜[中] `ProjectRegistry.dirOf` 回退路径未校验越界，可穿目录读写
- **位置**：[projects.ts#L131-L134](../src/projects.ts#L131-L134)
- **问题（是什么）**：`dirOf` 在缓存未命中时返回 `join(projectsDir, projectId)`，`projectId` 来自路由（canvas POST / assets / active-skills），可为 `../x`、`../y/canvas.json` 等任意字符串。
- **影响**：配合 cascade 路由 POST，可在 projects 目录之外写 `canvas.json`/`skills.json`（`writeFileAtomic` 会自动建父目录）。因入口有 loopback+同源校验，属**纵深防御**缺口而非可直接远程利用漏洞。
- **解决方案**：回退分支先 `resolve` 并校验 `result.startsWith(projectsDir + sep)`，越界抛错。
- **验收方式**：以 `projectId='../x'` 走保存接口，应被拒绝而非写入外部路径。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[projects.ts#L134-L145](../src/projects.ts#L134-L145) 回退路径 `resolve` 后校验必须落在 `projectsDir` 内（`== root` 或 `startsWith(root+sep)`），越界抛「非法项目目录引用」；注册表记录命中时仍按记录 `dir` 返回（历史语义不变）；新增 [projects-dir.test.mjs](../../tests/projects-dir.test.mjs) 2 用例（越界拒绝 / 合法 id 安全网不变）。

### CR-004｜[中] 资产以整文件读进内存再发送
- **位置**：[routes.ts#L438](../src/routes.ts#L438)、[#L456](../src/routes.ts#L456)、[#L461](../src/routes.ts#L461)
- **问题（是什么）**：视频/图片整读 `readFile` 后 `res.end(data)`；上限 128MB 的视频会整体驻留内存。
- **影响**：多并发点播/上传时内存放大明显。
- **解决方案**：全量响应用 `createReadStream`；范围响应用 `createReadStream({start,end})`。
- **验收方式**：并发拉取多个大视频，观察内存峰值显著下降、功能不变。

### CR-006｜[中] `appendCanvasNode` 每次全量读+写，内部再读一次
- **位置**：[projects.ts#L271-L275](../src/projects.ts#L271-L275)、[#L201-L225](../src/projects.ts#L201-L225)
- **问题（是什么）**：先 `readCanvas`，随后 `writeCanvas` 内部又 `readCanvas`（合并保护）→ 每次追加=2 读+1 写整份 canvas.json。`generate.ts:splitStoryboard` 每帧调用一次（最多 9 帧）。
- **影响**：画布节点多时全量序列化开销可观。
- **解决方案**：改为先拉一次现有节点，批量构造后一次写入。
- **验收方式**：观察多次生成后单次追加的读/写次数由 2读1写 降为 1读1写（侧载计数或以单测断言调用次数）。
- **状态**：✅ **已修复·待验收**（2026-09-03）——抽私有 `writeCanvasDocument`（[projects.ts#L210-L220](../src/projects.ts#L210-L220)）；`appendCanvasNode` 只读一次盘、直接构造文档写回（[projects.ts#L297-L310](../src/projects.ts#L297-L310)），不再经 `writeCanvas` 的 merge-protect 二次读盘（调用方已有完整快照，合并冗余）。

### CR-007｜[中] `create` 并发同名竞态 + 失败遗留空目录
- **位置**：[projects.ts#L296-L323](../src/projects.ts#L296-L323)
- **问题（是什么）**：两个并发 `create` 同名都可能通过 `projects.some` 检查；且 `mkdir` 在 `writeRegistry` 之前，注册表写失败会留空 `projects/<dir>/assets` 孤儿目录。
- **影响**：同名项目可能被后者覆盖/竞态，失败后残留垃圾目录。
- **解决方案**：name 冲突检查移到持久化后重查；或先写注册表再 mkdir（失败回滚）。
- **验收方式**：并发创建同名项目只应成功其一；人为让注册表写失败应不留空目录。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[projects.ts#L331-L371](../src/projects.ts#L331-L371)：mkdir 后、writeRegistry 前对缓存复查同名（并发后到者被拦，避免后写方整表覆盖先写方）；`writeRegistry` 失败时回滚已建目录（`rm` + 重抛），不留孤儿目录。

### CR-010｜[中] 产物下载无超时、无大小上限、整读内存
- **位置**：[generate.ts#L935-L937](../src/generate.ts#L935-L937)、[#L254-L256](../src/generate.ts#L254-L256)
- **问题（是什么）**：`fetch(mediaUrl)` 仅传来自路由的 signal（客户端断开才 abort）；外部 CDN 挂起会无限阻塞，`arrayBuffer()` 整读无字节上限。
- **影响**：生成路由可能永久挂起、内存被打满。
- **解决方案**：追加 `AbortSignal.timeout` + 字节上限 + 流式写盘；2xx 与超时统一归类错误。
- **验收方式**：指向一个挂起的 URL，生成应按超时归档而非无限卡死；超大响应被限流。
- **状态**：✅ **已修复·待验收**（2026-09-03）——新增 `downloadBytes(url, signal, {maxBytes, timeoutMs, label})` 助手（[generate.ts#L134-L172](../src/generate.ts#L134-L172)）：`AbortSignal.timeout` 与调用方 signal 组合、流式读取 + 字节超限中止（桩环境无 `body` 时回退 `arrayBuffer()` 并仍校验上限）。替换三处整读下载：产物（`MEDIA_DOWNLOAD_MAX_BYTES=512MB` / 10min）、单镜（`IMAGE_DOWNLOAD_MAX_BYTES=32MB` / 2min）、参考图。新增 [generate.test.mjs](../../tests/generate.test.mjs) 1 用例（流式超限报中文错误）。

### CR-011｜[中] `readSourceBytes` 对任意 URL/本地路径读取（SSRF / 本地文件泄露面）
- **位置**：[generate.ts#L231-L260](../src/generate.ts#L231-L260)
- **问题（是什么）**：分支 2 直接 `fileURLToPath(source)`/`isAbsolute(source)` 读任意本地文件；分支 3 对任意 URL `fetch`（含云元数据 `169.254.169.254`、内网地址）。source 由模型/上传参数提供。
- **影响**：agent 参数可诱导 Host 访问内网/读本地任意文件。同源+loopback 防御下不可远程利用，但仍属明确高风险面。
- **解决方案**：仅允许 `canvas-studio` 资产 URL、配置内目录；对 URL 做私网/环回地址黑名单，本地读做白名单。
- **验收方式**：构造内网/环回 URL 与越权本地路径作为 source，应被拒绝。
- **状态**：✅ **已修复·待验收**（2026-09-03）——`readSourceBytes` 分支 2 本地读取白名单到资产库根（[generate.ts#L344-L357](../src/generate.ts#L344-L357)，越权抛「超出资产库范围」，新增 `ProjectRegistry.registryRoot` 公开访问器 [projects.ts#L116-L120](../src/projects.ts#L116-L120)）；分支 3 下载前过 `assertSafeDownloadUrl`（[generate.ts#L174-L200](../src/generate.ts#L174-L200)）：仅 http/https、IP 字面量私网/环回/链路本地/云元数据黑名单 + localhost 族拒绝（DNS 级解析留待后端确认，避免引入网络依赖）。新增 [generate.test.mjs](../../tests/generate.test.mjs) 2 用例（SSRF 网段拒绝 / 本地越权拒绝+库内放行）。

### CR-012｜[中] `resolveDramaApiKey` 已定义但从未注入请求
- **位置**：[host-tools.ts#L360](../src/host-tools.ts#L360)、[generate.ts#L40](../src/generate.ts#L40)
- **问题（是什么）**：`dramaPost`/`callDrama`/`uploadBytesToDrama` 的所有 `fetch` 都无 `Authorization` 及任何凭据头。
- **影响**：若 Drama 后端期望鉴权，用户配置的 key 形同虚设，请求必然 401。
- **解决方案**：确认后端鉴权方式，需要时把 `resolveDramaApiKey()` 结果挂到请求头。
- **验收方式**：配置有效 key 后调用 Drama 相关生成，请求带正确的认证头并成功。
- **状态**：⏸ **待拍板**（2026-09-03）——[canvas-studio-api-usage.md §5-3](../canvas-studio-api-usage.md) 明示：后端**当前无鉴权**（health 无 key 通过），`DRAMA_API_KEY` 是否发送待后端确认。不臆造 Bearer/自定义头方案（可能破坏现网），待后端定鉴权协议后再落地。

### CR-013｜[中] `splitStoryboard` 中途失败产生半成品
- **位置**：[generate.ts#L1100-L1131](../src/generate.ts#L1100-L1131)
- **问题（是什么）**：循环内每帧先 `writeFile` 再 `appendCanvasNode`；第 N 帧失败时前 N-1 帧文件+节点已持久化，函数却抛错——与「不落半成品」注释冲突。
- **影响**：画布与磁盘处于不一致状态，残留孤立帧。
- **解决方案**：成功全部帧后再统一写盘/建节点，失败时清理已写帧。
- **验收方式**：在第 3 帧人为制造失败，应无前 2 帧残留。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[generate.ts#L1215-L1275](../src/generate.ts#L1215-L1275)：先下载全部帧到内存 → 统一写盘（失败清理已写文件）→ 再追加节点（追加失败也清理已写文件），任一步失败都不留半成品。

### CR-018｜[中] `asset-capture` 对任意工具 `tool/result` 都触发、且盲访问 `message.source`
- **位置**：[asset-capture.ts#L205-L212](../src/asset-capture.ts#L205-L212)
- **问题（是什么）**：`tool/result` 分支不看工具名，任何工具结果都 `{id:String(source.callId), role:'update'}`；且 `(event.data).message.source` 为盲访问。
- **影响**：会触发与该画布无关工具的 `reloadCanvas`/`onToolFinished`；若事件缺 `message.source` 结构则直接抛 TypeError 阻断该事件。
- **解决方案**：`tool/result` 校验工具名；读取 `message.source` 前判空并对结构防御。
- **验收方式**：混入非画布工具结果不应触发画布刷新；缺失 source 的事件不应抛错。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[asset-capture.ts#L205-L215](../src/asset-capture.ts#L205-L215) 与 [question-capture.tsx#L244-L250](../src/client/question-capture.tsx#L244-L250) 对 `message.source` 判空防御（缺 `message`/`source`/`callId` 即不匹配，返回 null，不再 TypeError）。tool/result 事件不带工具名字段，无法按名过滤；reload 幂等，非画布工具多触发一次无害（注释已说明）。

### CR-021｜[中] `extractVideoStyle` 中途失败遗留孤儿视频/抽帧
- **位置**：[video-style.ts#L136-L173](../src/video-style.ts#L136-L173)
- **问题（是什么）**：先写视频本体，再逐帧写帧图并上传 Drama；任一步失败整体抛错，但已写文件/上传无画布节点引用。
- **影响**：成为孤儿资产，无入口清理。
- **解决方案**：失败时清理本次生成的 `videoId`/`frameId` 文件。
- **验收方式**：中途模拟失败，观察无残留文件。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[video-style.ts#L141-L194](../src/video-style.ts#L141-L194) 把抽帧/上传/VLM 归纳包进 try/catch，`writtenFiles` 累计视频+已抽帧，任一步失败统一清理后重抛。

### CR-022｜[中] compose 逐段非等比拉伸，画幅不一致会变形
- **位置**：[compose.ts#L241](../src/compose.ts#L241)
- **问题（是什么）**：`scale=${width}:${height}` 直接定死 `-vf scale=W:H`，无 `force_original_aspect_ratio`。
- **影响**：片段画幅与首片不一致时被非等比拉伸变形。
- **解决方案**：加 `force_original_aspect_ratio=decrease,pad=...` 保持纵横比。
- **验收方式**：拼接不同画幅片段，成片画面比例正确无拉伸。
- **状态**：✅ **已修复·待验收**（2026-09-03）——[compose.ts#L108-L128](../src/compose.ts#L108-L128) `buildTranscodeArgs` 的 vf 改为 `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2,fps=N`（等比缩放 + 黑边补足）；[compose.test.mjs](../../tests/compose.test.mjs) 断言更新为子串匹配。

### CR-023｜[中] 无 BGM 分支把 concat 产物整读进内存再写盘
- **位置**：[compose.ts#L291](../src/compose.ts#L291)
- **问题（是什么）**：`writeFile(finalOutput, await readFile(concatOutput))`，大视频全量驻留内存。
- **影响**：合成长视频内存峰值高。
- **解决方案**：用 `copyFile` 或流式 pipe。
- **验收方式**：合成长视频时内存峰值显著下降，产物一致。

### CR-004（资产整读内存）已见上方；CR-023 与其同类。

---

## 低危清单

| ID | 位置 | 问题 | 解决方案 |
| --- | --- | --- | --- |
| CR-005 | [routes.ts#L462](../src/routes.ts#L462)、#L497 | 客户端断连后 `sendJson` 仍 setHeader/end，可能抛 `ERR_HTTP_HEADERS_SENT` | catch 分支加 `if (!res.destroyed)` |
| CR-008 | [projects.ts#L461-L470](../src/projects.ts#L461-L470) | 注册表记录 `dir` 未校验位于 projects 目录内，损坏记录可指向系统路径 | readRegistry 校验 `dir.startsWith(projectsDir+sep)` |
| CR-009 | [projects.ts#L53-L55](../src/projects.ts#L53-L55) | `sanitizeProjectDirName` 按 UTF-16 码元截断可能切开 emoji（半个代理对） | 用正确码点/码元截断（如 `Intl.Segmenter` 或整代理对判断） |
| CR-014 | [generate.ts#L940](../src/generate.ts#L940) | 落盘扩展名硬编码 `mp4/png`，与后端真实码流可能不符（webm/mov） | 按响应 `Content-Type`/真实扩展名落盘 |
| CR-015 | [generate.ts#L319-L323](../src/generate.ts#L319-L323) | `Buffer.from(x,'base64')` 永不抛错，无效 base64 不触发「空图」判空 | 用严格 base64 校验 |
| CR-016 | [generate.ts#L611](../src/generate.ts#L611)、#L626 | `enhancePrompt`/`analyzeImage` 三元兜底 `?? data` 把对象当字符串返回 | 改 `JSON.stringify` 或显式取字段 |
| CR-017 | [generate.ts#L24](../src/generate.ts#L24) | 模块级可变 `current` 全局状态，测试并行/多实例互扰 | 由调用方显式传 cfg |
| CR-019 | [ffmpeg-run.ts#L85-L89](../src/ffmpeg-run.ts#L85-L89) | `finish` 无 settled 防重入（error/close 双触发各清一次） | 加 settled 标志 |
| CR-020 | [ffmpeg-run.ts#L99-L100](../src/ffmpeg-run.ts#L99-L100) | `stderr`/`stdout` 无上限累加 | 限制 `-loglevel` 或缓冲上限 |
| CR-024 | [compose.ts#L103-L105](../src/compose.ts#L103-L105) | concat list 路径含单引号未转义 | 转义 `'`（当前路径 Host 生成无引号，防御项） |
| CR-025 | [host-tools.ts#L190-L198](../src/host-tools.ts#L190-L198) vs [routes.ts#L357-L403](../src/routes.ts#L357-L403) | P7 门禁仅工具路径生效，`/generate` 路由可绕过（双标准法定） | 文档化契约差异或统一鉴权 |
| CR-026 | [canvas-view.ts#L148-L149](../src/canvas-view.ts#L148-L149) | arrange 单元格只按主节点宽高，未纳入子节点外延，可能与注释承诺的「不重叠」不符 | 单元格尺寸纳入组内子节点包围盒 |
| CR-027 | [canvas-aspect.ts#L29-L34](../src/canvas-aspect.ts#L29-L34) | `previewSizeOf` 对宽/高为 0 无保护（除 0 → Infinity） | 非正输入返回 fallback |
| CR-028 | [routes.ts](../src/routes.ts) | 9 处几乎逐字重复的 abort/close 监听样板 | 抽 `withClientAbortSignal(req,res,fn)` helper |

---

## 接口契约需留意的点（不单独立项）
- Drama 返回产物 URL 的**绝对/相对形态假设**（`generate.ts#L379` 与 `#L935`）。
- 落盘扩展名硬编码与真实码流形态（CR-014）。
- `resultSchema` 声明的 `width/height` 为 integer，而 compose 返回值可能来自 ffmpeg 探测缺省值（已兜底，口径待统一）。