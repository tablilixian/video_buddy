/**
 * Canvas Studio 错误码注册表（catalog）。
 *
 * 这是「错误收敛」的单一事实来源：每条用户/AI 可见的错误都必须在此登记，
 * 声明其受众、严重度、可恢复性与首选展示面。新增错误 = 在此加一条
 * `registerError(...)`，禁止再用裸 `throw new Error('...')` 抛出可展示错误。
 *
 * 模块 A–K 与 docs/canvas-studio-error-handbook.md 一一对应；本文件先登记
 * 跨模块的「代表样例」（每模块 1–2 条），其余历史错误按 docs 附录的迁移清单
 * 分批补登。self-registering：在 Host / Client 入口各 `import './errors/catalog.js'`
 * 一次即可让全部错误码生效。
 *
 * 命名：`CS-<MODULE>-<NN>`
 *   MODULE: GEN 任务/超时 · PROV 供应商 · USER 工具入参 · COMP 合成 ·
 *           NODE 重试 · EFFECT 效果测试 · NET 后端通信 · H3IR H3 预检 ·
 *           REF 参考素材 · FFMPEG 基础设施
 */

import { registerError, type CanvasErrorSpec } from '../error-system.js'
// CV-235：占位值纪律句的唯一源 —— 同一份字面量既挂进工具 description（事前），
// 也拼进下面 CS-PARAM-002 的文案（事后）。方向是 catalog → param-guard 单向。
import { PLACEHOLDER_PARAM_RULE } from '../param-guard.js'

const SPECS: CanvasErrorSpec[] = [
  // ── A 任务调度与超时 ──────────────────────────────────────────────────────
  {
    code: 'CS-GEN-204',
    module: 'GEN',
    severity: 'S2',
    // 用户需要知道「没出图」，AI 需要知道「可以重试/缩短时长」。
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    // 「后端一直没回」三级处置归「服务不可达」：三态卡的提示是「请确认后端已启动」，
    // 正是此时该做的事（比泛泛的「重试一次」有用）；重试仍是可点的次行动。
    uiKind: 'unreachable',
    userMessage: 'Drama 后端在 {n} 秒内未返回结果（已放弃重试）：{note}\n本次可能是时长超出该档上限——可稍后重试或缩短时长。',
    devMessage: 'DRAMA_TIMEOUT_MS 触发；probeQueueDepthNow 返回 {note}；原始信号：{signal}',
    recoveryHint: '缩短生成时长 / 稍后重试；若频繁发生检查后端是否被占用或传输层是否静默退回 300s。',
  },
  {
    // 阶段二迁移（generate.ts 上传超时域）：原裸 `文件上传 {N}s 内未完成`。
    code: 'CS-GEN-205',
    module: 'GEN',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '文件上传在 {n} 秒内未完成：后端可能繁忙或文件过大——可稍后重试，或压缩素材后再上传。',
    devMessage: 'UPLOAD_TIMEOUT_MS 触发（{n}s）',
    recoveryHint: '稍后重试；若大视频/大参考音频频繁超时，检查后端是否被占用或传输层是否静默退回 300s。',
  },
  {
    // 阶段二迁移（generate.ts 生成响应失败 / video2vl）：原裸 `生成失败: <describeError>`。
    code: 'CS-GEN-206',
    module: 'GEN',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '生成失败（后端返回错误）：{safe}',
    devMessage: 'describeError: {detail}',
    recoveryHint: '查看 dev 详情定位后端错误；可重试或换参数 / 换参考图。',
  },

  // ── B 生成后端通信 ────────────────────────────────────────────────────────
  {
    code: 'CS-NET-001',
    module: 'NET',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '生成服务暂时连不上（已重试一次），请稍后重试或检查服务是否可达。',
    devMessage: '网络错误且 2 次均失败：{cause}',
    recoveryHint: '确认 Drama Backend ({host}) 可达；检查本机网络 / 代理。',
  },
  {
    // 仅开发者：undici dispatcher 符号缺失导致传输层静默退回 300s。
    // 用户看不懂也无法处理，生产环境完全隐藏，仅开发期日志可见。
    code: 'CS-NET-002',
    module: 'NET',
    severity: 'S3',
    audience: ['developer'],
    recoverability: 'auto',
    channel: 'log',
    userMessage: 'fetch 传输层超时上限未生效，长视频可能被提前掐断。',
    devMessage: '无法抬高 fetch 传输层超时上限，退回 undici 默认 300s：{detail}',
    recoveryHint: '在进程首请求前发一次廉价探活，确保 undici 全局 dispatcher 符号就位。',
  },
  {
    // 阶段二迁移（generate.ts 上传连接失败）：原裸 `文件上传连接失败: <cause>`。
    // 网络不可达是 agent / 开发期信息，用户看不懂也无法处理 → 仅 agent+developer。
    code: 'CS-NET-003',
    module: 'NET',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '文件上传连接失败，请检查 Drama Backend 是否可达后重试。',
    devMessage: '上传 fetch 异常：{cause}',
    recoveryHint: '确认 Drama Backend 可达；检查本机网络 / 代理。',
  },
  {
    // 阶段二迁移（generate.ts 上传 404）：后端未注册上传端点，纯配置/版本问题 → developer。
    code: 'CS-NET-004',
    module: 'NET',
    severity: 'S1',
    audience: ['developer'],
    recoverability: 'fatal',
    channel: 'log',
    userMessage: '文件上传失败（HTTP 404）：后端未注册上传端点，请确认 Drama Backend 版本。',
    devMessage: 'POST /api/v1/generate/upload 返回 404；期望端点已注册',
    recoveryHint: '升级 Drama Backend 到含 /api/v1/generate/upload 的版本。',
  },
  {
    // 阶段二迁移（generate.ts 上传非 2xx）：状态码非用户可处理 → agent+developer。
    code: 'CS-NET-005',
    module: 'NET',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '文件上传失败（HTTP {status}），请稍后重试。',
    devMessage: '上传返回非 2xx：HTTP {status}',
    recoveryHint: '非 4xx 类可重试；4xx 多为请求体 / 参数问题，检查上传内容。',
  },
  {
    // 阶段二迁移（generate.ts 上传成功却无 filename）：响应结构异常 → developer。
    code: 'CS-NET-006',
    module: 'NET',
    severity: 'S1',
    audience: ['developer'],
    recoverability: 'fatal',
    channel: 'log',
    userMessage: '文件上传成功但后端未返回文件名，上传通道异常，请联系开发。',
    devMessage: '响应未含 filename/name/data.url：{data}',
    recoveryHint: '检查 Drama Backend 上传响应结构是否与 ComfyUI 原生 {name,subfolder,type} 一致。',
  },
  {
    // 阶段二迁移（generate.ts downloadBytes / 三视图拼图 / 音频下载）：远程 HTTP 失败。
    // 用户只需知道「下载失败可重试」，原始状态码进 devMessage 脱敏隐藏。
    code: 'CS-NET-007',
    module: 'NET',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '下载「{label}」失败，请稍后重试或检查素材来源是否可达。',
    devMessage: 'fetch 非 2xx：{label} -> HTTP {status}',
    recoveryHint: '确认来源 URL 可访问；若为后端产物，检查生成是否成功。',
  },
  {
    // 阶段二迁移（generate.ts downloadBytes 超字节上限）：用户可压缩重试 → 用户可见。
    code: 'CS-NET-008',
    module: 'NET',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '下载「{label}」体积超过上限，请压缩后重试。',
    devMessage: '超过 {maxBytes} 字节（label={label}）',
    recoveryHint: '降低素材分辨率 / 质量后再上传或下载。',
  },
  {
    // 阶段二迁移（generate.ts assertSafeDownloadUrl）：SSRF / 受限网段拒绝。
    // 来源是 agent 提供的 URL，用户看不懂也无法处理 → agent+developer，仅日志。
    code: 'CS-NET-009',
    module: 'NET',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'fatal',
    channel: 'log',
    userMessage: '下载地址不安全或不在允许范围内，已拒绝。',
    devMessage: 'SSRF/地址校验拒绝：{detail}',
    recoveryHint: '只允许 http/https 且非受限网段（loopback/私网/链路本地/保留）的下载地址。',
  },
  {
    // 阶段二迁移（generate.ts 生成响应缺产物 URL）：后端返回结构异常 → developer。
    code: 'CS-NET-010',
    module: 'NET',
    severity: 'S1',
    audience: ['developer'],
    recoverability: 'fatal',
    channel: 'log',
    userMessage: '生成响应中未找到产物 URL，后端返回结构异常，请联系开发。',
    devMessage: 'response 未含 full_url / data[0].url',
    recoveryHint: '检查 Drama Backend 生成响应结构是否变化。',
  },

  // ── D 供应商层 ────────────────────────────────────────────────────────────
  {
    // 典型「用户看不懂、不会处理」但开发期有用的错误 → 用户给脱敏提示，dev 看细节。
    code: 'CS-PROV-001',
    module: 'PROV',
    severity: 'S1',
    audience: ['user', 'developer'],
    recoverability: 'fatal',
    channel: 'node',
    // 缺 Key 是唯一「重试必然复发」的典型：主行动必须是「去设置」，重试只能当次按钮。
    uiKind: 'config',
    userMessage: '视频生成（fal）未配置 API Key，生成已停止。请在设置中配置后重试。',
    devMessage: 'fal adapter 缺失 apiKey：{detail}',
    recoveryHint: '在运行时配置 fal API Key（setRuntimeConfig）。',
  },
  {
    code: 'CS-PROV-002',
    module: 'PROV',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '请求的视频供应商「{p}」未注册或不支持「{op}」。',
    devMessage: 'registry 查询失败：{detail}',
    recoveryHint: '检查 providers/registry 是否包含该供应商且声明支持该操作。',
  },

  // ── E 工具入参校验 ────────────────────────────────────────────────────────
  {
    code: 'CS-USER-001',
    module: 'USER',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '参考图 @ref[{ref}] 在当前项目画布中未找到，请先生成或上传该节点。',
    devMessage: 'findNodeByRef 未命中：{detail}',
    recoveryHint: '确认 @ref 令牌拼写；或先运行生成该参考图的工具。',
  },

  // ── F 生成参数校验 + H3 预检 ──────────────────────────────────────────────
  {
    code: 'CS-H3IR-001',
    module: 'H3IR',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '{rich}',
    devMessage: 'H3 IR precheck rejected: {n} errors（细节见 userMessage，含规则标记与修正指引）',
    recoveryHint: '按预检报告修正 prompt 中的 @ref 引用与模式声明。',
  },

  // ── G 参考素材 ────────────────────────────────────────────────────────────
  {
    code: 'CS-REF-001',
    module: 'REF',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '参考图「{name}」编码后 {mb} MB，超过单张上限，请压缩后重试。',
    devMessage: 'fal 单张上限校验失败：{detail}',
    recoveryHint: '降低参考图分辨率 / 质量后再上传。',
  },

  // ── H 成片合成 ────────────────────────────────────────────────────────────
  {
    code: 'CS-COMP-001',
    module: 'COMP',
    severity: 'S2',
    audience: ['user'],
    recoverability: 'guided',
    channel: 'toast',
    userMessage: '请先选择至少一个分镜片段再合成。',
    recoveryHint: '在画布勾选要拼接的视频节点。',
  },
  {
    code: 'CS-COMP-002',
    module: 'COMP',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'node',
    userMessage: '片段「{clipId}」转码失败，本次合成跳过该片段。',
    devMessage: 'ffmpeg 转码非零退出：{detail}',
    recoveryHint: '检查该片段文件完整性 / 分辨率是否被识别。',
  },

  // ── I 波形（仅开发者示例：用户无需也不应看到 ffmpeg 内部缺失）──────────────
  {
    code: 'CS-FFMPEG-001',
    module: 'FFMPEG',
    severity: 'S1',
    // 仅开发者：ffmpeg 缺失是运维/打包问题，终端用户既看不懂也无法处理。
    audience: ['developer'],
    recoverability: 'fatal',
    channel: 'log',
    userMessage: '视频处理组件当前不可用，相关功能已暂停。',
    devMessage: 'resolveFfmpegPath 返回 null：{detail}',
    recoveryHint: '确认内置 ffmpeg 已随包分发；CI 出包需走 LGPL 构建（CV-201 阻断遗留）。',
  },

  // ── C 重试（节点）─────────────────────────────────────────────────────────
  {
    code: 'CS-NODE-001',
    module: 'NODE',
    severity: 'S2',
    audience: ['user'],
    recoverability: 'guided',
    channel: 'node',
    userMessage: '该节点没有可重放的生成参数（仅 agent 生成的媒体节点支持重试）。',
    recoveryHint: '让 agent 重新生成该节点，而非使用右键「重试」。',
  },

  // ── J 效果测试 ────────────────────────────────────────────────────────────
  {
    code: 'CS-EFFECT-001',
    module: 'EFFECT',
    severity: 'S2',
    // AI 可重新绑定项目/重试，无需打扰用户。
    audience: ['agent'],
    recoverability: 'guided',
    channel: 'effectTest',
    userMessage: '效果测试所需的会话绑定项目超时，请重新发起测试。',
    devMessage: '会话绑定项目等待超时：{detail}',
    recoveryHint: '重新触发效果测试流程，确保会话已绑定当前项目。',
  },

  // ── 阶段二迁移（generate.ts / host-tools / providers / compose / projects / client 等）──
  // 通用三码：覆盖大量「单句用户可懂校验」与「仅开发者可见」错误，避免无限膨胀。
  {
    code: 'CS-USER-ERR',
    module: 'USER',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '{message}',
    devMessage: '{detail}',
    recoveryHint: '按提示修正输入后重试。',
  },
  {
    code: 'CS-DEV-ERR',
    module: 'DEV',
    severity: 'S1',
    // 仅开发者：内部/配置类错误，用户看不懂也无从下手，生产环境完全隐藏。
    audience: ['developer'],
    recoverability: 'fatal',
    channel: 'log',
    userMessage: '操作未完成（内部错误），请稍后重试或联系开发。',
    devMessage: '{detail}',
    recoveryHint: '查看 dev 详情定位根因。',
  },
  {
    code: 'CS-CLIENT-ERR',
    module: 'CLIENT',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'toast',
    userMessage: '{message}',
    devMessage: '{detail}',
    recoveryHint: '按提示重试或刷新页面。',
  },
  {
    code: 'CS-PROJ-001',
    module: 'PROJ',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '项目不存在（{id}），请确认项目 id 或先创建项目。',
    devMessage: 'project not found: {id}',
    recoveryHint: '确认 projectId 正确；或用列表接口获取可用项目。',
  },
  {
    code: 'CS-NODE-002',
    module: 'NODE',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'node',
    userMessage: '重试目标节点不存在（{id}），无法重试。',
    devMessage: 'retry target missing: {id}',
    recoveryHint: '确认节点 id；或让 agent 重新生成该节点。',
  },
  {
    code: 'CS-NODE-003',
    module: 'NODE',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'node',
    userMessage: '{tool} 只支持原地重试（缺少 retryOf）；首次生成请走对应的工具调用。',
    devMessage: 'in-place retry only: {tool}',
    recoveryHint: '传入 retryOf 指向已有节点以原地更新。',
  },
  {
    code: 'CS-PARAM-001',
    module: 'USER',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '「{tool}」缺少必需参数「{param}」，无法继续。',
    devMessage: 'missing param {param} for {tool}',
    recoveryHint: '补上该参数（如 filename / caption_prompt / videoUrl / image）后重试。',
  },
  {
    // CV-235：入参填了**占位值**（`placeholder2` / `占位` / `placeholder-will-retry`…）。
    // 与 CS-PARAM-001（缺参）是两件事：那条是「没给」，这条是「给了个假货」。
    // 为什么必须是独立码而不是复用 CS-NET-009（下载地址安全）：实测两者会撞在同一个
    // 入参上 —— 占位串一路走到 SSRF 校验才被拦，于是用户看到「地址不安全」，
    // 而真因是「模型压根没去取真实值」。拆开后各自文案才说得准。
    //
    // 受众含 user：这条错误的文案本身是可读且可行动的（「本次调用没执行，模型该先取
    // 真实值」），且工具失败结果无论如何都会写进会话转录 —— 与其让框架用原文回显，
    // 不如给一份说清「什么都没发生」的准确文案。
    code: 'CS-PARAM-002',
    module: 'USER',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '「{tool}」的 {param} 填的是占位值「{value}」—— 本次调用未执行（没建节点、没发起生成）。\n'
      + PLACEHOLDER_PARAM_RULE,
    devMessage: 'placeholder arg rejected: {detail}',
    recoveryHint: '先调用产出该素材的工具（或工具结果里给出的取法）拿到真实值，或改用 @ref[节点标题] 引用画布节点，然后重试。',
  },
  {
    code: 'CS-H3IR-002',
    module: 'H3IR',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '参考{kind}不符合 H3 官方规格（未发起生成）：\n{detail}',
    devMessage: 'H3 {kind} reference invalid: {detail}',
    recoveryHint: '按预检报告修正 prompt 中的 @ref 引用与模式声明。',
  },
  {
    code: 'CS-H3IR-003',
    module: 'H3IR',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '参考素材总数超出 H3 官方上限（未发起生成）：\n{detail}',
    devMessage: 'H3 budget exceeded: {detail}',
    recoveryHint: '减少参考图/视频数量或换更小素材后重试。',
  },
  {
    code: 'CS-H3IR-004',
    module: 'H3IR',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '未知的 H3 IR 模式「{mode}」（应为 T2VA / I2VA / L2VA / FL2VA / Ref2VA）。',
    devMessage: 'unknown IR mode: {mode}',
    recoveryHint: '检查 prompt 中的 irMode 声明拼写。',
  },
  {
    code: 'CS-H3IR-005',
    module: 'H3IR',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '{rich}',
    devMessage: 'IR mode mismatch: declared {declared} actual {actual}（细节见 userMessage）',
    recoveryHint: '修正 prompt 中的 irMode 声明或 @ref 引用位次。',
  },
  {
    code: 'CS-GEN-208',
    module: 'GEN',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '未知的生成工具：{tool}。',
    devMessage: 'unknown generation tool: {tool}',
    recoveryHint: '确认 tool 名称（video_generate / video_composite / character_generate / image_fix / music_generation 等）。',
  },
  {
    code: 'CS-NET-011',
    module: 'NET',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'fatal',
    channel: 'log',
    userMessage: '本地文件引用超出资产库范围，已拒绝。',
    devMessage: 'local file ref out of asset root: {path}',
    recoveryHint: '只允许引用本项目资产库内的文件。',
  },
  {
    code: 'CS-PROV-003',
    module: 'PROV',
    severity: 'S1',
    audience: ['developer'],
    recoverability: 'fatal',
    channel: 'log',
    userMessage: '视频供应商初始化失败（缺少必要注入），请联系开发。',
    devMessage: 'provider missing injection: {detail}',
    recoveryHint: '确认 generate.ts 已向供应商适配器注入所需上下文（readReferenceBytes / dramaPostWithFallback）。',
  },
  {
    code: 'CS-PROV-004',
    module: 'PROV',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '视频供应商请求失败（HTTP {status}）：{safe}',
    devMessage: '{label} -> HTTP {status} {detail}',
    recoveryHint: '非 4xx 类可重试；4xx 多为请求体问题。',
  },
  {
    code: 'CS-PROV-005',
    module: 'PROV',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '视频供应商返回了无法解析的响应，可稍后重试。',
    devMessage: '{label} 响应非合法 JSON（HTTP {status}）',
    recoveryHint: '检查供应商端点是否健康；可重试。',
  },
  {
    code: 'CS-PROV-006',
    module: 'PROV',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '视频供应商任务提交失败（缺少任务标识），可稍后重试。',
    devMessage: 'fal submit 响应缺少 request_id / response_url',
    recoveryHint: '重试；若持续，检查 fal 端点。',
  },
  {
    code: 'CS-PROV-007',
    module: 'PROV',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: 'fal 供应商暂不支持参考视频（本次收到 {n} 段）。请改用 drama 供应商（provider: "drama"）。',
    devMessage: 'fal received {n} reference videos; not supported',
    recoveryHint: '将 provider 改为 "drama"（Drama 后端已支持 video1–video3）。',
  },
  {
    code: 'CS-PROV-008',
    module: 'PROV',
    severity: 'S2',
    audience: ['agent', 'developer'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '生成已完成但结果缺少视频地址，请重试或联系开发。',
    devMessage: 'fal 结果缺少 video.url',
    recoveryHint: '重试；若持续，检查 fal 出图结构。',
  },
  {
    code: 'CS-PROV-009',
    module: 'PROV',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '非法的视频供应商「{value}」（仅支持 drama / fal）。',
    devMessage: 'invalid video provider: {value}',
    recoveryHint: '将 provider 设为 "drama" 或 "fal"。',
  },
  {
    code: 'CS-PROV-010',
    module: 'PROV',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '「{tool}」不是视频生成工具，无法解析能力。',
    devMessage: 'not a video tool: {tool}',
    recoveryHint: '仅 video_generate / video_composite 走供应商能力解析。',
  },
  {
    code: 'CS-PROV-011',
    module: 'PROV',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    // 「没有供应商支持这个能力」= 配置问题（设置里没启用），不是偶发失败。
    uiKind: 'config',
    userMessage: '没有可用的视频供应商支持「{op}」，请检查供应商配置。',
    devMessage: 'no provider supports capability: {op}',
    recoveryHint: '在设置中启用支持该能力的供应商（drama / fal）。',
  },
  {
    code: 'CS-PROV-012',
    module: 'PROV',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    // 同上：一个都没注册 = 设置里没启用任何供应商。
    uiKind: 'config',
    userMessage: '当前没有任何已注册的视频供应商，请检查供应商装配（drama / fal）。',
    devMessage: 'provider registry empty: {detail}',
    recoveryHint: '确认插件装配时已 registerProvider(drama) / registerProvider(fal)。',
  },
  {
    code: 'CS-PROV-014',
    module: 'PROV',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '视频生成超时（{seconds} 秒），已尝试取消任务。请稍后重试或缩短时长。',
    devMessage: 'provider {label} timeout after {seconds}s',
    recoveryHint: '缩短生成时长 / 稍后重试；确认后端未被占用。',
  },
  {
    code: 'CS-REF-003',
    module: 'REF',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '参考图合计 {mb}MB，超过 fal 单次请求上限，请减少数量或改用更小的图。',
    devMessage: 'fal total reference over limit: {mb}MB ({detail})',
    recoveryHint: '降低参考图数量 / 分辨率后再上传。',
  },
  {
    code: 'CS-REF-004',
    module: 'REF',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'conversation',
    userMessage: '引用句柄包含 [ 或 ]，无法生成 @ref 引用标记，请先重命名该节点。',
    devMessage: 'reference handle contains bracket',
    recoveryHint: '重命名节点去掉 [ ] 后再引用。',
  },
  {
    code: 'CS-EFFECT-002',
    module: 'EFFECT',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'effectTest',
    userMessage: '效果测试指令发出后回合未启动，请重新发起测试。',
    devMessage: 'effect test round did not start',
    recoveryHint: '重新触发效果测试流程。',
  },
  {
    code: 'CS-EFFECT-003',
    module: 'EFFECT',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'effectTest',
    userMessage: '等待 agent 回合结束超时，请重新发起测试。',
    devMessage: 'wait agent turn timeout',
    recoveryHint: '重新触发效果测试流程。',
  },
  {
    code: 'CS-EFFECT-004',
    module: 'EFFECT',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'effectTest',
    userMessage: '会话服务未就绪，请稍后重试。',
    devMessage: 'conversation service not ready: {detail}',
    recoveryHint: '确认会话已绑定当前项目后重试。',
  },
  {
    code: 'CS-CLIENT-002',
    module: 'CLIENT',
    severity: 'S2',
    audience: ['user', 'agent'],
    recoverability: 'guided',
    channel: 'toast',
    userMessage: '配置已被其它改动覆盖，请刷新后重试。',
    devMessage: 'settings-conflict',
    recoveryHint: '刷新页面重新加载配置后再保存。',
  },
]

for (const spec of SPECS) {
  registerError(spec)
}
