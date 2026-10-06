/**
 * REQ-021 应用内一键测试模式的**机器检查点断言库**（纯函数，node:test 直测）。
 *
 * ## 为什么在 src/ 根而不是 src/client/
 *
 * 检查点必须是**纯函数**（设计文档 §4.5：输入持久化状态快照、不触网、可单测、
 * 反向变异可红）。客户端代码打成单包（`lib/client.js`，ModuleLoader 包装），
 * node:test 无法 import —— 与 `project-naming.ts` / `queue-view.ts` 同理，纯函数
 * 必须写在 src/ 根才能被 `tests/*.test.mjs` 直连（client/index.ts 顶部有先例注释）。
 *
 * ## 数据口径（全部持久化状态，不碰会话流）
 *
 * - `loadStudioCanvas(projectId)` → nodes（画布节点表，原始磁盘文档）；
 * - `getStudioAssetHistory(projectId)` → history（产物登记，`file` 是**磁盘名**
 *   `uuid.ext`，不是后端产物名 —— 路由断言必须用节点的 `filename` 字段）；
 * - `fetchStudioGenerateQueue()` → queue（active/waiting/resumedJobs 快照）；
 * - `listStudioProjects()` → project（目录名 / createdAt）。
 *
 * ## 断言纪律
 *
 * - 检查点只回答「客观事实成立吗」，不回答「好看吗」——逐字正确性 / 画面质量 /
 *   warnings 文案留给报告的「内容评估」环节（设计文档 §六）。
 * - 尺寸断言容忍 16:9 与 9:16 的互换（同一档位基准的旋转变体），因为画幅由
 *   agent 按剧本决定、像素只由档位表决定；档位像素来自 `output-size.ts`
 *   （与 config.ts 同一份实现）。
 * - 瞬态生成态（isLoading 占位）在快照清洗时剔除 —— 持久化文档本不该有它们，
 *   但断言不替持久化层背锅。
 */
import type { StudioCanvasNode } from './contracts/canvas.js'
import { STORYBOARD_NODE_TOOL } from './contracts/canvas.js'
import type { StudioProject } from './contracts/project.js'
import type { VideoResolution } from './providers/types.js'
import type { GenerateQueueSnapshot } from './queue-view.js'
import { OUTPUT_SIZE } from './output-size.js'

/**
 * 产物历史条目的最小结构面（与 client/api.ts 的 `AssetHistoryEntry` 结构兼容 ——
 * 不直接 import 是因为那个类型住在 client 目录，本模块必须可被 node:test 直连）。
 */
export interface AutoTestHistoryEntry {
  file: string
  kind: 'image' | 'video' | 'audio' | 'file'
  tool: string
  label: string
  createdAt: number
  deletedAt?: number
}

/** 检查点的输入快照（一次回合结束后由执行器现拉）。 */
export interface AutoTestSnapshots {
  project: StudioProject
  nodes: readonly StudioCanvasNode[]
  history: readonly AutoTestHistoryEntry[]
  queue: GenerateQueueSnapshot | null
  /** 本次运行的生效设置（只读快照）：图片档位（尺寸断言的期望基准之一）。 */
  expectedImageResolution: VideoResolution
  /** 生效设置：视频档位。 */
  expectedVideoResolution: VideoResolution
}

/** 单条检查点的结论。 */
export interface AutoTestCheckpointResult {
  pass: boolean
  /** 证据：节点 id / filename / 数值 —— 报告逐条落盘，验收方按它复核。 */
  evidence: string
}

/** 一条检查点定义。 */
export interface AutoTestCheckpointDef {
  /** 稳定 id（场景定义按 id 引用；报告按它落盘）。 */
  id: string
  /** 人话标题（报告与浮窗展示）。 */
  label: string
  /**
   * 从第几条发送回合结束后开始参与断言（0 = 首条剧本回合，1 = 第一条追加指令后）。
   * 例：取代串链断言只在追加指令（改孙女形象）之后才有意义。
   */
  appliesFromTurn: number
  check: (snap: AutoTestSnapshots) => AutoTestCheckpointResult
}

/** 测试项目命名前缀（拍板①：沿用 效果验证-R# —— 吃到既有启动清扫）。 */
export const AUTO_TEST_PROJECT_PREFIX = /^效果验证-R\d+-.+/

/**
 * 后端产物名前缀（探针口径）：含字图走 Qwen（txt2image_withtxt），纯文生图走 Krea2。
 * BUG-015（R001 实证）：**以后端实际产物名为准** —— 实测为小写 `qwen_image_2.1_*`
 * （canvas.json 节点 15811f5b），故小写模式 + `i` 兼容历史大写记忆；断言只认
 * filename，与文档/描述里的展示大小写无关。
 *
 * ⚠️ BUG-019（R002 实证）：filename 形态**因后端而异**——有的回产物名（R001），
 * 有的回 `ref-*` 上传句柄（R002）。路由断言以 {@link routeModel}（结构化字段）
 * 为第一证据，filename 前缀只作旧画布（R001 时代）回放兼容。
 */
export const QWEN_TEXT_RENDER_PREFIX = /^qwen_image_2\.1_/i
/** 纯文生图（Krea2 Turbo）产物名：`krea2_<序号>_.png`；`krea2_char_4view_*` 是四视图，不算概念图。 */
export const KREA2_T2I_PREFIX = /^krea2_\d+/

/**
 * 结构化路由证据（BUG-019）：节点的 `routeModel` = 生成时 routeImageModel 现算的
 * Drama 端点。Qwen 文字渲染链路 = `…/txt2image_withtxt`；Krea2 纯文生 =
 * `…/txt2image`（`$` 锚定排除 withtxt）。端点常量住在 config.ts（node:crypto，
 * 客户端 bundle 与本模块拖不动），这里按值尾段匹配，与 MODEL_ROUTE_TABLE 同源
 * 的守卫由 model-route 的单测承担。
 */
export const QWEN_TEXT_RENDER_ROUTE = /txt2image_withtxt$/u
export const KREA2_T2I_ROUTE = /\/txt2image$/u

/** 图片节点的路由证据：routeModel（结构化，第一证据）优先，filename 产物名兜底（旧画布回放）。 */
function routeEvidenceOf(node: StudioCanvasNode): { qwen: boolean; krea2T2I: boolean } {
  return {
    qwen: node.routeModel !== undefined && QWEN_TEXT_RENDER_ROUTE.test(node.routeModel)
      || node.filename !== undefined && QWEN_TEXT_RENDER_PREFIX.test(node.filename),
    krea2T2I: node.routeModel !== undefined && KREA2_T2I_ROUTE.test(node.routeModel)
      || node.filename !== undefined && KREA2_T2I_PREFIX.test(node.filename),
  }
}

/** 图片扩展名后缀（composite 参考图计数用；URL 先剥查询串再比对）。 */
const IMAGE_EXT_SUFFIX = /\.(?:png|jpe?g|webp|gif|bmp)$/i

/**
 * video_composite 镜的**图片**参考数：从 generationPrompt（JSON 编码的请求参数）
 * 读 `sourceUrls`，按扩展名过滤只数图片 —— R001 实证该数组混有 audioRefs 并入的
 * mp3，直接数长度会把音频当参考图。参数缺失/损坏按 0 计（加严口径）。
 */
function compositeImageRefCount(node: StudioCanvasNode): number {
  const params = paramsOf(node)
  const urls = Array.isArray(params?.sourceUrls) ? params.sourceUrls : []
  return urls.filter((url) => {
    if (typeof url !== 'string') return false
    return IMAGE_EXT_SUFFIX.test(url.split(/[?#]/)[0] ?? '')
  }).length
}

/** 剔除瞬态生成态节点（占位 / 生成中）——断言只认持久化产物。 */
function persistedNodes(nodes: readonly StudioCanvasNode[]): readonly StudioCanvasNode[] {
  return nodes.filter(node => node.isLoading !== true && !node.id.startsWith('pending-'))
}

/** 16:9 基准档位像素 + 9:16 旋转变体（画幅由剧本决定，像素只由档位表决定）。 */
function tierSizes(resolution: VideoResolution): readonly { width: number; height: number }[] {
  const base = OUTPUT_SIZE[resolution]
  return [base, { width: base.height, height: base.width }]
}

/** 解析节点 generationPrompt（JSON 编码的请求参数）；损坏/缺失返回 null。 */
function paramsOf(node: StudioCanvasNode): Record<string, unknown> | null {
  if (node.generationPrompt === undefined) return null
  try {
    const parsed: unknown = JSON.parse(node.generationPrompt)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

/** 检查点 12：把「取代串链」的旧→新句柄对列成证据。 */
interface SupersedePair {
  oldId: string
  oldFilename: string | undefined
  newId: string
  newFilename: string | undefined
}

function supersedePairsOf(nodes: readonly StudioCanvasNode[]): SupersedePair[] {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const pairs: SupersedePair[] = []
  for (const node of nodes) {
    if (node.kind !== 'image' || node.supersededBy === undefined || node.supersededBy === '') continue
    const replacement = byId.get(node.supersededBy)
    if (replacement === undefined) continue
    pairs.push({
      oldId: node.id,
      oldFilename: node.filename,
      newId: replacement.id,
      newFilename: replacement.filename,
    })
  }
  return pairs
}

/**
 * 一期检查点注册表（对应《山谷晨光》15s，逐条对齐设计文档 §4.5 的 12 条）。
 *
 * 注册表是**唯一的 id → 断言映射**：场景定义按 id 引用，执行器经
 * {@link runAutoTestCheckpoints} 按注册表顺序执行 —— 顺序、去重、存在性都只在这份表上成立。
 */
export const AUTO_TEST_CHECKPOINTS: readonly AutoTestCheckpointDef[] = [
  {
    id: 'project-created',
    label: '项目创建成功且命名/目录合规',
    appliesFromTurn: 0,
    check: (snap) => {
      const { project } = snap
      if (!AUTO_TEST_PROJECT_PREFIX.test(project.name)) {
        return { pass: false, evidence: `项目名「${project.name}」不匹配 /^效果验证-R\\d+-.+/` }
      }
      // E-3 的「按秒铸造」只作用于首页 draft 落点目录；常规项目目录 =
      // 用户名的 sanitize 版（projects.ts uniqueDirName）。这里断言可核对的
      // 部分：目录 basename 以项目名结尾（中文名 sanitize 后不变）。
      const dirName = project.dir.split(/[\\/]/).pop() ?? ''
      if (!dirName.startsWith(project.name)) {
        return { pass: false, evidence: `目录名「${dirName}」与项目名「${project.name}」不对应` }
      }
      if (!Number.isFinite(Date.parse(project.createdAt))) {
        return { pass: false, evidence: `createdAt 不可解析：${project.createdAt}` }
      }
      return { pass: true, evidence: `name=${project.name} dir=${dirName} createdAt=${project.createdAt}` }
    },
  },
  {
    id: 'storyboard-cards',
    label: '分镜卡数量 = 3（15s ÷ 3 镜）',
    appliesFromTurn: 0,
    check: (snap) => {
      const cards = persistedNodes(snap.nodes).filter(node => node.toolName === STORYBOARD_NODE_TOOL)
      return {
        pass: cards.length === 3,
        evidence: `分镜卡 ${cards.length} 张（id: ${cards.map(node => node.id).join(', ') || '无'}）`,
      }
    },
  },
  {
    id: 'keyframes-linked',
    label: '每张分镜卡都挂有关键帧（sourceIds 反查）',
    appliesFromTurn: 0,
    check: (snap) => {
      const nodes = persistedNodes(snap.nodes)
      const cards = nodes.filter(node => node.toolName === STORYBOARD_NODE_TOOL)
      const linked = cards.map((card) => ({
        cardId: card.id,
        frames: nodes.filter(node => node.kind === 'image' && node.sourceIds.includes(card.id)),
      }))
      const missing = linked.filter(entry => entry.frames.length === 0)
      const detail = linked.map(entry => `${entry.cardId}×${entry.frames.length}`).join(', ')
      return {
        pass: cards.length > 0 && missing.length === 0,
        evidence: missing.length === 0
          ? `${cards.length} 张分镜卡各有关键帧（卡×关键帧: ${detail}）`
          : `未挂关键帧的卡：${missing.map(entry => entry.cardId).join(', ')}（全部: ${detail}）`,
      }
    },
  },
  {
    id: 'videos-active',
    label: '镜位视频 = 3 且全部 active、零 retired（BUG-011 回归断言）',
    appliesFromTurn: 0,
    check: (snap) => {
      // BUG-016：skill 默认工具策略是镜位视频优先 video_composite（多参考 Ref2VA，
      // SKILL.md 第 9 步），不适用才退 video_generate —— 条数统计两者都认，否则合规
      // 的 composite 镜被计 0 必红（R001 实证）。BUG-011 的回归意图（废弃视频串链 /
      // 单镜残片）不由工具名承担，仍由「active 计数」+ compose-final（来源 ≥3）覆盖。
      const clips = persistedNodes(snap.nodes).filter(node =>
        node.kind === 'video' && (node.toolName === 'video_generate' || node.toolName === 'video_composite'))
      // BUG-017（R002 实证）：被取代（supersededBy）是追加指令返工的**合法产物**
      // ——旧版本让位新版本，画布上保留历史版本；断言只看**生效版本**：
      // active 恰好 3 条、零手动作废。supersededBy 计数降级为证据展示。
      const active = clips.filter(node => node.supersededBy === undefined)
      const retired = clips.filter(node => node.retired === true)
      const superseded = clips.filter(node => node.supersededBy !== undefined)
      // 加严子项（§三.1 拍板默认纳入）：composite 镜的图片参考 ≥3（Ref2VA 纪律
      // 机器化，依据 references/shot-format.md 的两图 FL2VA 歧义警告）。
      // sourceUrls 里混有 audioRefs 并入的 mp3 —— 按扩展名过滤只数图片。
      // 只看 active 版本（被取代的旧版不背现行纪律）。
      const weakRefs = active
        .filter(node => node.toolName === 'video_composite')
        .map(node => ({ id: node.id, count: compositeImageRefCount(node) }))
        .filter(entry => entry.count < 3)
      const refNote = weakRefs.length > 0
        ? `；composite 图片参考不足：${weakRefs.map(entry => `${entry.id} ${entry.count}/3`).join('、')}`
        : ''
      return {
        pass: active.length === 3 && retired.length === 0 && weakRefs.length === 0,
        evidence: `生效视频 ${active.length} 条（期望 3），retired ${retired.length} 条（期望 0），被取代的历史版本 ${superseded.length} 条${refNote}；id: ${active.map(node => node.id).join(', ') || '无'}`,
      }
    },
  },
  {
    id: 'poster-route-qwen',
    label: '海报走 Qwen（含引号片名 → txt2image_withtxt 路由）',
    appliesFromTurn: 0,
    check: (snap) => {
      // BUG-019：路由证据以节点 `routeModel`（结构化字段）为准；filename 产物名
      // 前缀只兜底旧画布回放——不同后端对图片端点回的 filename 形态不同
      // （R001 产物名 / R002 ref-* 句柄），从 filename 猜路由不可靠。
      const posters = persistedNodes(snap.nodes).filter(node =>
        node.kind === 'image' && routeEvidenceOf(node).qwen)
      const evidence = posters
        .map(node => node.routeModel !== undefined && QWEN_TEXT_RENDER_ROUTE.test(node.routeModel)
          ? `${node.id}（route=${node.routeModel}）`
          : `${node.id}（filename=${node.filename ?? '-'}）`)
      return {
        pass: posters.length >= 1,
        evidence: evidence.length > 0 ? `Qwen 链路产物：${evidence.join(', ')}` : '画布节点中无 Qwen 文字渲染链路证据（routeModel / 产物名均未命中）',
      }
    },
  },
  {
    id: 'concept-route-krea2',
    label: '纯文生图走 Krea2（route=txt2image / krea2_ 产物名）',
    appliesFromTurn: 0,
    check: (snap) => {
      // R-P1-03 后的口径：只有**纯文生图**（无参考）承诺 Krea2；关键帧带参考
      // 走 image2image（Qwen i2i）是设计内行为，不算违规。证据同 BUG-019 口径。
      const concepts = persistedNodes(snap.nodes).filter(node =>
        node.kind === 'image' && routeEvidenceOf(node).krea2T2I)
      const evidence = concepts
        .map(node => node.routeModel !== undefined && KREA2_T2I_ROUTE.test(node.routeModel)
          ? `${node.id}（route=${node.routeModel}）`
          : `${node.id}（filename=${node.filename ?? '-'}）`)
      return {
        pass: concepts.length >= 1,
        evidence: evidence.length > 0 ? `Krea2 纯文生产物：${evidence.join(', ')}` : '画布节点中无 Krea2 纯文生链路证据（routeModel / 产物名均未命中）',
      }
    },
  },
  {
    id: 'resolution-tier',
    label: '产物分辨率落在生效档位（对照 OUTPUT_SIZE，C-8）',
    appliesFromTurn: 0,
    check: (snap) => {
      // 断言范围：镜位视频 / 成片（video_generate / compose）与普通生成图
      // （image_generate —— 关键帧 / 海报 / 概念图）。四视图与 image_fix 的尺寸
      // 跟随输入图、上传素材无档位语义，均不参与（否则必然误红）。
      const tierOf = (toolName: string | undefined): VideoResolution | undefined => {
        if (toolName === 'video_generate' || toolName === 'compose') return snap.expectedVideoResolution
        if (toolName === 'image_generate') return snap.expectedImageResolution
        return undefined
      }
      const checked: string[] = []
      const bad: string[] = []
      for (const node of persistedNodes(snap.nodes)) {
        const resolution = tierOf(node.toolName)
        if (resolution === undefined || node.mediaWidth === undefined || node.mediaHeight === undefined) continue
        const allowed = tierSizes(resolution)
        const ok = allowed.some(size => size.width === node.mediaWidth && size.height === node.mediaHeight)
        const label = `${node.toolName} ${node.id} ${String(node.mediaWidth)}×${String(node.mediaHeight)}`
        if (ok) checked.push(label)
        else bad.push(label)
      }
      const expectText = `image=${snap.expectedImageResolution} video=${snap.expectedVideoResolution}`
      return {
        pass: checked.length > 0 && bad.length === 0,
        evidence: `档位（生效设置）${expectText}；合规 ${checked.length} 个${bad.length > 0 ? `；越档：${bad.join('；')}` : ''}`,
      }
    },
  },
  {
    id: 'queue-settled',
    label: '生成队列全 settled（无在飞 / 等待 / 恢复任务）',
    appliesFromTurn: 0,
    check: (snap) => {
      const queue = snap.queue
      const active = queue?.active ?? null
      const waiting = queue?.waiting ?? []
      const resumed = queue?.resumedJobs ?? 0
      // 队列之外的持久化失败证据：媒体节点缺产物 URL（落盘失败的残缺节点）。
      const broken = persistedNodes(snap.nodes)
        .filter(node => (node.kind === 'image' || node.kind === 'video' || node.kind === 'audio') && node.url === undefined)
      const ok = active === null && waiting.length === 0 && resumed === 0 && broken.length === 0
      const parts = [`active=${active === null ? '0' : active.label}`, `waiting=${waiting.length}`, `resumed=${resumed}`]
      if (broken.length > 0) parts.push(`缺 URL 节点 ${broken.length} 个（${broken.map(node => node.id).join(', ')}）`)
      return { pass: ok, evidence: parts.join('，') }
    },
  },
  {
    id: 'history-volume',
    label: '产物登记数达到下限（2 定妆 + 3 关键帧 + 3 视频 + 1 音乐 + 1 海报 + 1 成片）',
    appliesFromTurn: 0,
    check: (snap) => {
      const active = snap.history.filter(entry => entry.deletedAt === undefined)
      const count = (kind: AutoTestHistoryEntry['kind']): number => active.filter(entry => entry.kind === kind).length
      const images = count('image')
      const videos = count('video')
      const audios = count('audio')
      // 下限写宽（设计文档）：重试/重出只会让数字更大，合理。
      const shortfalls: string[] = []
      if (images < 6) shortfalls.push(`image ${images}/6`)
      if (videos < 4) shortfalls.push(`video ${videos}/4`)
      if (audios < 1) shortfalls.push(`audio ${audios}/1`)
      return {
        pass: shortfalls.length === 0,
        evidence: `image=${images} video=${videos} audio=${audios} file=${count('file')}（总计 ${active.length}，已删 ${snap.history.length - active.length}）${shortfalls.length > 0 ? `；缺：${shortfalls.join('、')}` : ''}`,
      }
    },
  },
  {
    id: 'voiceover-consistent',
    label: '旁白音色全程一致（refaudio 同源 / instruct 逐字 / 克隆派生，C-5）',
    appliesFromTurn: 0,
    check: (snap) => {
      const voices = persistedNodes(snap.nodes).filter(node => node.toolName === 'tts_voiceover')
      if (voices.length === 0) return { pass: false, evidence: '画布上没有 tts_voiceover 节点（旁白未生成？）' }
      const refaudios = voices.map(node => {
        const params = paramsOf(node)
        return typeof params?.refaudio === 'string' ? params.refaudio : undefined
      })
      const defined = refaudios.filter((value): value is string => value !== undefined)
      if (defined.length === refaudios.length) {
        // 全部走 refaudio：逐段同源即一致。
        const unique = new Set(defined)
        return {
          pass: unique.size === 1,
          evidence: unique.size === 1
            ? `${voices.length} 段旁白共用 refaudio=${defined[0]}`
            : `refaudio 出现 ${unique.size} 种（${[...unique].join(' | ')}）`,
        }
      }
      if (defined.length === 0) {
        // 全部没传 refaudio：C-5 的另一条合法路径 —— instruct_prompt 七维逐字一致。
        const instructs = voices.map(node => {
          const params = paramsOf(node)
          return typeof params?.instruct_prompt === 'string' ? params.instruct_prompt : undefined
        })
        const missing = instructs.filter(value => value === undefined).length
        const unique = new Set(instructs.filter((value): value is string => value !== undefined))
        return {
          pass: missing === 0 && unique.size === 1,
          evidence: `${voices.length} 段旁白未用 refaudio，instruct_prompt 一致性：${unique.size} 种${missing > 0 ? `（${missing} 段参数不可解析）` : ''}`,
        }
      }
      // 混合策略（BUG-022，R003 实证）：「首段 instruct 定调 + 其余段 refaudio 克隆
      // 首段产物」是合法的派生一致 —— 音色由构造保证同源。判据是**可证明的一致性**，
      // 不是假设：① 所有 refaudio 同源（唯一值）；② 该值恰等于某条无 refaudio 段的
      // 产物文件名（克隆源必须在本批旁白里，否则与 instruct 段同音色不可证明）；
      // ③ 多条无 refaudio 段（多个根）时 instruct_prompt 必须逐字一致。
      const uniqueRef = new Set(defined)
      if (uniqueRef.size !== 1) {
        return { pass: false, evidence: `refaudio 出现 ${uniqueRef.size} 种（${[...uniqueRef].join(' | ')}）` }
      }
      const refaudio = defined[0] as string
      const roots = voices.filter((_, index) => refaudios[index] === undefined)
      const sourceOfRef = roots.some(node => node.filename === refaudio)
      if (!sourceOfRef) {
        return {
          pass: false,
          evidence: `refaudio=${refaudio} 不指向本批任何旁白段的产物，与 instruct 段的音色一致性不可证明`,
        }
      }
      const instructs = roots.map(node => {
        const params = paramsOf(node)
        return typeof params?.instruct_prompt === 'string' ? params.instruct_prompt : undefined
      })
      const missing = instructs.filter(value => value === undefined).length
      const uniqueInstruct = new Set(instructs.filter((value): value is string => value !== undefined))
      const consistent = missing === 0 && uniqueInstruct.size === 1
      return {
        pass: consistent,
        evidence: consistent
          ? `派生一致：${roots.length} 段 instruct 定调（逐字一致），${defined.length} 段 refaudio 克隆其产物 ${refaudio}`
          : `克隆源的根段 instruct_prompt 不一致（${uniqueInstruct.size} 种${missing > 0 ? `，${missing} 段参数不可解析` : ''}）`,
      }
    },
  },
  {
    id: 'compose-final',
    label: '成片节点存在且来源 ≥ 3 段（compose 选片未被残片化，M-3 侧证）',
    appliesFromTurn: 0,
    check: (snap) => {
      const films = persistedNodes(snap.nodes).filter(node =>
        node.kind === 'video'
        && node.toolName === 'compose'
        && node.supersededBy === undefined
        && node.retired !== true)
      if (films.length === 0) return { pass: false, evidence: '无 active 成片节点（toolName=compose）' }
      const weak = films.filter(node => node.sourceIds.length < 3)
      return {
        pass: weak.length === 0,
        evidence: films.map(node =>
          `${node.id} 来源 ${node.sourceIds.length} 段${weak.includes(node) ? '（不足 3，疑似单镜残片）' : ''}`).join('；'),
      }
    },
  },
  {
    id: 'supersede-chain',
    label: '追加指令后：旧形象被取代且下游引用已改写（批F supersede 改写链）',
    appliesFromTurn: 1,
    check: (snap) => {
      const pairs = supersedePairsOf(persistedNodes(snap.nodes))
      if (pairs.length === 0) {
        return { pass: false, evidence: '画布上没有任何「被取代」的图片节点（旧孙女四视图未被标记 supersededBy？）' }
      }
      // 下游改写断言：旧 filename 不允许再出现在任何活跃节点的 generationPrompt 里
      // （改写链会把旧句柄换成新句柄；旧节点无 filename 时跳过该子项）。
      // BUG-018（R002 实证）：**取代对的新节点自身豁免**——图生图改妆类返工以
      // 旧图为生成输入，它的 generationPrompt 里保留旧句柄是生成事实 + 重试
      // 保真的依据，不是改写遗漏；豁免面只有 newId 自己，其余下游照查。
      const nodes = persistedNodes(snap.nodes)
      const staleRefs: string[] = []
      for (const pair of pairs) {
        if (pair.oldFilename === undefined) continue
        const holders = nodes.filter(node =>
          node.id !== pair.newId
          && node.generationPrompt !== undefined
          && node.generationPrompt.includes(pair.oldFilename as string))
        if (holders.length > 0) {
          staleRefs.push(`${pair.oldFilename} 仍被 ${holders.map(node => node.id).join(', ')} 引用`)
        }
      }
      const downstream = pairs
        .map(pair => `${pair.oldId}→${pair.newId}${pair.newFilename !== undefined ? `(${pair.newFilename})` : ''}`)
        .join('；')
      return {
        pass: staleRefs.length === 0,
        evidence: `取代链 ${pairs.length} 条：${downstream}${staleRefs.length > 0 ? `；改写残留：${staleRefs.join('；')}` : '；下游 generationPrompt 无旧句柄残留'}`,
      }
    },
  },
]

/** 按 id 取检查点定义（场景引用的 id 必须在注册表内 —— 执行器先经 {@link resolveAutoTestCheckpoints} 校验）。 */
export function autoTestCheckpointById(id: string): AutoTestCheckpointDef | undefined {
  return AUTO_TEST_CHECKPOINTS.find(entry => entry.id === id)
}

/**
 * 执行一批检查点（按注册表顺序，过滤：① id 在给定集合内；② 该回合已到
 * appliesFromTurn）。任何一条的 check 抛错都折算成 fail（断言库自身 bug 不该
 * 炸掉整个场景执行器 —— 报告里如实记证据）。
 */
export function runAutoTestCheckpoints(
  ids: readonly string[],
  snap: AutoTestSnapshots,
  turnIndex: number,
): readonly { id: string; label: string; pass: boolean; evidence: string }[] {
  const wanted = new Set(ids)
  return AUTO_TEST_CHECKPOINTS
    .filter(entry => wanted.has(entry.id) && turnIndex >= entry.appliesFromTurn)
    .map((entry) => {
      try {
        const result = entry.check(snap)
        return { id: entry.id, label: entry.label, pass: result.pass, evidence: result.evidence }
      } catch (cause) {
        return {
          id: entry.id,
          label: entry.label,
          pass: false,
          evidence: `断言函数抛错：${cause instanceof Error ? cause.message : String(cause)}`,
        }
      }
    })
}
