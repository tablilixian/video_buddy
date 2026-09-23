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
    userMessage: 'Drama 后端在 {n} 秒内未返回结果（已放弃重试）：{note}\n本次可能是时长超出该档上限——可稍后重试或缩短时长。',
    devMessage: 'DRAMA_TIMEOUT_MS 触发；probeQueueDepthNow 返回 {note}；原始信号：{signal}',
    recoveryHint: '缩短生成时长 / 稍后重试；若频繁发生检查后端是否被占用或传输层是否静默退回 300s。',
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

  // ── D 供应商层 ────────────────────────────────────────────────────────────
  {
    // 典型「用户看不懂、不会处理」但开发期有用的错误 → 用户给脱敏提示，dev 看细节。
    code: 'CS-PROV-001',
    module: 'PROV',
    severity: 'S1',
    audience: ['user', 'developer'],
    recoverability: 'fatal',
    channel: 'node',
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
    userMessage: 'H3 参考素材简报本地预检发现 {n} 处错误，已阻止本次生成。',
    devMessage: 'IR 模式声明与素材位次不一致 / 素材缺失：{detail}',
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
    channel: 'conversation',
    userMessage: '效果测试所需的会话绑定项目超时，请重新发起测试。',
    devMessage: '会话绑定项目等待超时：{detail}',
    recoveryHint: '重新触发效果测试流程，确保会话已绑定当前项目。',
  },
]

for (const spec of SPECS) {
  registerError(spec)
}
