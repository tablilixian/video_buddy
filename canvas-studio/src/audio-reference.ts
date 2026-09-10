/**
 * H3 官方音频参考规格与校验（纯函数，Host 侧使用）。
 *
 * 本模块只做「发出去之前」的规格把关，**与后端当前能力无关**——Drama 后端
 * 尚未开放音频入参，但规格按官方标准先落地，后端补齐后即可直接生效。
 *
 * 官方规格（MiniMax H3 / Hailuo-03 API reference，多源交叉核实：
 * platform.minimaxi.com 官方文档 + fal `minimax/h3/reference-to-video` + HF 规格汇总）：
 *
 * | 项 | 规格 |
 * | --- | --- |
 * | 数量 | ≤ 3 段 |
 * | 单段时长 | 2–15s |
 * | **合计时长** | **≤ 15s** |
 * | 格式 | WAV / MP3 |
 * | 单段大小 | ≤ 15MB |
 * | 组合 | **不能作为唯一输入**——必须同时提供至少一张图或一段视频 |
 * | 模式 | 首尾帧（first_frame/last_frame）与参考模式（reference_*）**互斥** |
 *
 * 另注：参考**视频自带的音轨也计入音频预算**（官方按 15s 总量校验），本项目
 * 目前只支持独立音频文件，故未涉及。
 */

/** 官方上限：参考音频段数。 */
export const H3_AUDIO_MAX_CLIPS = 3

/** 官方下限：单段音频时长（秒）。 */
export const H3_AUDIO_MIN_SECONDS = 2

/** 官方上限：单段音频时长（秒）。 */
export const H3_AUDIO_MAX_SECONDS = 15

/** 官方上限：全部参考音频合计时长（秒）。 */
export const H3_AUDIO_TOTAL_SECONDS = 15

/** 官方上限：单段音频文件大小（字节）。 */
export const H3_AUDIO_MAX_BYTES = 15 * 1024 * 1024

/** 官方支持的音频容器（小写扩展名，含点）。 */
export const H3_AUDIO_EXTENSIONS: readonly string[] = ['.mp3', '.wav']

/** 一条待校验的参考音频。时长/大小由调用方实测提供，未知时传 undefined 跳过该项。 */
export interface AudioReferenceInput {
  /** 文件标识（Drama filename 或本地文件名），仅用于错误文案。 */
  readonly label: string
  /** 实测时长（秒）。未知传 undefined → 跳过时长项校验。 */
  readonly seconds?: number | undefined
  /** 实测字节数。未知传 undefined → 跳过大小项校验。 */
  readonly bytes?: number | undefined
}

/** 校验问题。`code` 供测试/调用方分支，`message` 面向 agent 与用户。 */
export interface AudioReferenceIssue {
  readonly code:
    | 'too-many'
    | 'too-short'
    | 'too-long'
    | 'total-too-long'
    | 'too-large'
    | 'bad-format'
    | 'audio-only'
  readonly message: string
}

/** 取小写扩展名（含点）；无扩展名返回空串。 */
export function audioExtensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot).toLowerCase()
}

/**
 * 按官方规格校验参考音频集合。
 *
 * 顺序即 `<Audio N>` 的编号顺序（官方与 fal 都按 prompt 里的引用顺序对齐），
 * 故本函数不改写顺序、不排序。
 *
 * @param refs 待校验音频（顺序敏感）。
 * @param visualCount 本次请求同时提供的**视觉**素材数（图 + 视频）。为 0 且
 *   refs 非空 → 违反「音频不能唯一」硬规则。
 * @returns 问题列表；空数组 = 全部通过。
 */
export function validateH3AudioReferences(
  refs: readonly AudioReferenceInput[],
  visualCount: number,
): AudioReferenceIssue[] {
  const issues: AudioReferenceIssue[] = []
  if (refs.length === 0) return issues

  if (refs.length > H3_AUDIO_MAX_CLIPS) {
    issues.push({
      code: 'too-many',
      message: `参考音频最多 ${H3_AUDIO_MAX_CLIPS} 段，当前 ${refs.length} 段`,
    })
  }
  // 官方硬规则：音频必须与图或视频同行（audio-only payload 会被直接拒绝）。
  if (visualCount === 0) {
    issues.push({
      code: 'audio-only',
      message: `音频不能作为唯一参考：H3 要求同时提供至少一张图或一段视频（官方硬规则）`,
    })
  }

  let total = 0
  let allKnown = true
  for (const ref of refs) {
    const ext = audioExtensionOf(ref.label)
    if (ext !== '' && !H3_AUDIO_EXTENSIONS.includes(ext)) {
      issues.push({
        code: 'bad-format',
        message: `${ref.label} 格式不支持：官方仅接受 ${H3_AUDIO_EXTENSIONS.join(' / ')}`,
      })
    }
    if (ref.bytes !== undefined && ref.bytes > H3_AUDIO_MAX_BYTES) {
      issues.push({
        code: 'too-large',
        message: `${ref.label} 超过单段 ${Math.round(H3_AUDIO_MAX_BYTES / 1024 / 1024)}MB 上限`,
      })
    }
    if (ref.seconds === undefined) {
      allKnown = false
      continue
    }
    total += ref.seconds
    if (ref.seconds < H3_AUDIO_MIN_SECONDS) {
      issues.push({
        code: 'too-short',
        message: `${ref.label} 时长 ${ref.seconds.toFixed(1)}s 低于 ${H3_AUDIO_MIN_SECONDS}s 下限`,
      })
    } else if (ref.seconds > H3_AUDIO_MAX_SECONDS) {
      issues.push({
        code: 'too-long',
        message: `${ref.label} 时长 ${ref.seconds.toFixed(1)}s 超过单段 ${H3_AUDIO_MAX_SECONDS}s 上限`,
      })
    }
  }

  // 合计上限只在全部时长已知时判定：部分未知就下结论会误报。
  if (allKnown && total > H3_AUDIO_TOTAL_SECONDS) {
    issues.push({
      code: 'total-too-long',
      message: `参考音频合计 ${total.toFixed(1)}s 超过 ${H3_AUDIO_TOTAL_SECONDS}s 上限`
        + `（官方按总量校验：超限部分会被截断或整单被拒）`,
    })
  }
  return issues
}

/**
 * 音频参考与生成模式的**互斥**提示。
 *
 * 官方：帧模式（first_frame / last_frame）与参考模式（reference_*）不可混用。
 * 本项目按「带音频参考即走参考模式（r2v）」处理，但若调用方**原本**会走首尾帧
 * 插值（`video_composite` 恰好 2 图），语义就被音频改写了——必须显式告知，
 * 不静默按原意图生成。
 *
 * @param baseCapability 假设**不带音频**时解析出的能力（即调用方原意图）。
 * @param visualCount 本次实际提供的视觉素材数（图 + 视频）。
 * @returns 需附加到结果 warnings 的说明；无冲突时返回 undefined。
 */
export function audioModeNotice(baseCapability: string, visualCount: number): string | undefined {
  if (baseCapability !== 'first-last-frame') return undefined
  return `带参考音频时按官方「参考模式（r2v）」生成（${visualCount} 个视觉素材作参考）`
    + '——H3 的帧模式与参考模式互斥，本次不按首尾帧插值'
}
