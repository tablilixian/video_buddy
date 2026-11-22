/**
 * DramaServer 业务 API 视频供应商（迁移 B3-3，2026-11-22）。
 *
 * 旧 `providers/drama.ts`（8082 ComfyUI：202 + job_id + 30s 固定轮询 + result 端点）
 * 随老端口退役；本供应商走业务 API 全异步契约（api(12).md §6.8-§6.10）：
 *
 *   submit = ctx.businessRun（创建幂等任务 → /poll version 游标长轮询到终态 →
 *            content 端点下载产物字节）→ **settled 句柄**（executor 直通，无轮询循环）
 *   cancel = 尽力语义由 followGeneration 内建（打断/超时自动 POST /cancel）
 *
 * 请求体契约（§6.5，白名单外字段一律拒收）：
 * - fl2va：0-2 张 image（ordinal 1 = 首帧 / 2 = 尾帧）；
 * - ref2va：image ≤9 + video ≤3 + audio ≤3（总 ≤15，h3-ir 校验在上层）；
 * - input 只收 prompt / aspect / megapixels / duration；
 * - **generate_audio 已被新 API 拒收**（探测报告 §3）——显式传参时回 warning 不发送
 *   （拍板 ②：先测后记，结论反馈后台）。
 * - 1:1 画幅官方支持（报价层实测放行），摘除旧「可能被静默降级」警告。
 *
 * 参考素材失效自愈：与图像链路同一不变式——引用句柄（asset_id）失效（400/404/5xx）
 * 时经 ctx.healBusinessRef 重传换新句柄，**换新幂等键**重试一次（素材变了 key 必须换）。
 */
import { BUSINESS_MODEL_CODES } from '../config.js'
import { MEGAPIXELS_BY_RESOLUTION, DEFAULT_RESOLUTION } from '../config.js'
import type {
  BusinessVideoRunOutcome,
  ProviderContext,
  ProviderHandle,
  ProviderPoll,
  VideoProvider,
  VideoRequest,
} from './types.js'
import { normalizeVideoAspect } from './types.js'
import { throwError, makeCanvasError } from '../error-system.js'
import '../errors/catalog.js'
import type { GenerationRef } from '../generation-client.js'

/** ProviderContext.businessRun 的返回形状（types 里以结构化类型声明，这里取别名）。 */
type RunOutcome = BusinessVideoRunOutcome

/** 取出业务执行注入（generate.ts 闭包；缺注入 = 接线 bug）。 */
function requireBusinessRun(ctx: ProviderContext): NonNullable<ProviderContext['businessRun']> {
  const run = ctx.businessRun
  if (run === undefined) {
    throwError('CS-PROV-003', { detail: 'business provider 需要 businessRun 注入' })
  }
  return run
}

/** 构造业务 API 视频供应商实例（registry 注册名保持 'drama'——设置项 defaultVideoProvider 语义不变）。 */
export function createBusinessVideoProvider(): VideoProvider {
  return {
    id: 'drama',
    label: 'DramaServer 业务 API',
    capabilities: new Set(['text-to-video', 'first-last-frame', 'multi-reference']),
    maxReferences: 9,

    async submit(req: VideoRequest, ctx: ProviderContext): Promise<ProviderHandle> {
      const run = requireBusinessRun(ctx)
      if (ctx.isBadReferenceError === undefined || ctx.healBusinessRef === undefined) {
        throwError('CS-PROV-003', { detail: 'business provider 需要 isBadReferenceError/healBusinessRef 注入' })
      }
      const operation = req.capability === 'multi-reference' ? 'image2videoref2va' : 'image2videofl2va'
      const aspect = normalizeVideoAspect(req.aspectRatio)
      const megapixels = MEGAPIXELS_BY_RESOLUTION[req.resolution ?? DEFAULT_RESOLUTION]
      const input: Record<string, unknown> = {
        prompt: req.prompt,
        aspect,
        megapixels,
        duration: req.duration,
      }
      const warnings: string[] = []
      // 拍板 ②（2026-11-22）：generate_audio 被新 API 拒收（400 invalid_argument，
      // 探测报告 §3）——显式传参时如实告知「未生效」，不发送该字段。
      if (req.generateAudio !== undefined) {
        warnings.push(
          '当前后台版本不支持音轨开关（generate_audio 字段被新业务 API 拒收），参数未生效；'
          + '是否带原生音轨以后端默认行为为准。',
        )
      }

      // —— 素材引用：按 capability 定 role/ordinal（顺序 = prompt 里的 <Picture N> 引用序）。
      const buildRefs = (): GenerationRef[] => {
        const refs: GenerationRef[] = []
        if (operation === 'image2videoref2va') {
          const images = req.references.slice(0, 9)
          images.forEach((ref) => refs.push({ assetId: ref.localPath, role: 'image' }))
          if (req.references.length > images.length) {
            warnings.push(
              `参考图共 ${req.references.length} 张，上限 9 张，已保留前 ${images.length} 张（order 即 <Picture N> 引用序，请核对提示词）`,
            )
          }
          ;(req.videos ?? []).forEach((ref) => refs.push({ assetId: ref.localPath, role: 'video' }))
          ;(req.audios ?? []).forEach((ref) => refs.push({ assetId: ref.localPath, role: 'audio' }))
        } else {
          // fl2va：ordinal 1 = 首帧 / 2 = 尾帧（§6.5）；纯文生视频无引用。
          req.references.slice(0, 2).forEach((ref) => refs.push({ assetId: ref.localPath, role: 'image' }))
        }
        return refs
      }

      // —— 执行（含参考自愈：失效 → 重传换句柄 → 换新幂等键重试一次）。
      let refs = buildRefs()
      for (let attempt = 1; ; attempt += 1) {
        let outcome: RunOutcome
        try {
          outcome = await run({ model: BUSINESS_MODEL_CODES.videoH3, operation, input, refs })
        } catch (error) {
          if (attempt > 1 || refs.length === 0 || ctx.isBadReferenceError?.(error) !== true) throw error
          const healed: GenerationRef[] = []
          for (const ref of refs) {
            const fresh = await ctx.healBusinessRef!(ref.assetId)
            if (fresh === null || fresh === ref.assetId) {
              // 与图像链路同一口径：救不回就包「reference heal exhausted」，原始报错随行。
              throw makeCanvasError('CS-USER-ERR', {
                message: `参考文件句柄已失效，且画布上找不到可自动恢复的源文件（它可能已被重生成、删除或从未上传成功）。请重新上传该素材取得新句柄，或对来源节点重试后再生成。后端原始报错：${error instanceof Error ? error.message : String(error)}`,
                detail: 'reference heal exhausted: no recoverable source',
              })
            }
            ctx.onHealed?.(ref.assetId, fresh)
            healed.push({ assetId: fresh, role: ref.role })
          }
          refs = healed
          continue
        }
        // business 产物无 remote URL——url 留空串，字节由调用侧直落盘。
        return {
          token: outcome.generationId,
          settled: { url: '', filename: outcome.generationId, bytes: outcome.bytes, ext: outcome.ext },
          ...(warnings.length > 0 ? { warnings } : {}),
        }
      }
    },

    /** submit 内已跟随到终态并取回产物字节（settled 句柄）——executor 直通。 */
    async poll(): Promise<ProviderPoll> {
      return { done: false, stage: '生成中' }
    },

    /** 打断/超时的远端取消内建在 followGeneration（POST /cancel），此处无额外动作。 */
    async cancel(): Promise<void> {},
  }
}
