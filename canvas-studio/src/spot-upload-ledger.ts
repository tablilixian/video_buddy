/**
 * spot 静帧的「边渲边传」账本（REQ-041 F3）。
 *
 * 为什么需要它：真机事故里探针渲到第 5 帧把渲染器按死，宿主 30s 看门狗判死整张工单 ——
 * 前 4 张静帧**已经在内存里渲好了**，但当时的实现要等全部渲完才统一回写，于是这 4 张跟着
 * 工单一起被丢掉，模型只看到「请重试」。
 *
 * 口径（三条，缺一条都会退化成事故形态）：
 * 1. **渲出一张就立刻发一次上传**，不攒批；
 * 2. **同一帧只传一次**（渲完的补传与 `onSample` 会重叠，重复上传会在宿主侧落成两张
 *    同名帧的资产、回执里出现重复帧号）；
 * 3. 失败时**先把已发出的上传等落地**再撤单 —— 宿主侧「已落盘 N 张」才是真的。
 *
 * 纯逻辑、IO 由调用方注入（宿主侧是 `uploadStudioRenderSample`），所以不依赖浏览器。
 */

/** 一张待上传的静帧（只要字节与帧号，不需要完整 `RenderSample` 类型）。 */
export interface SpotUploadSample {
  frame: number
  bytes: Uint8Array
}

export interface SpotUploadLedger {
  /** 渲出一张就调一次（作为渲染实现的 `onSample` 传下去）。 */
  onSample: (sample: SpotUploadSample) => void
  /** 渲完后把「没走过 onSample」的帧补上（注入假渲染实现的测试会走这条路）。 */
  fillMissing: (samples: readonly SpotUploadSample[]) => void
  /** 等所有已发出的上传落地（失败也吞掉：一次上传失败不该毁掉整张工单）。 */
  settle: () => Promise<void>
  /** 已经发起过上传的帧号（升序）—— 回执 / 诊断用。 */
  uploadedFrames: () => number[]
}

/**
 * @param upload 真正的上传动作（宿主侧 = `transport.uploadSample(jobId, frame, bytes)`）
 */
export function createSpotUploadLedger(
  upload: (frame: number, bytes: Uint8Array) => Promise<unknown>,
): SpotUploadLedger {
  const started = new Set<number>()
  const pending: Array<Promise<unknown>> = []
  const push = (sample: SpotUploadSample): void => {
    if (started.has(sample.frame)) return
    started.add(sample.frame)
    pending.push(upload(sample.frame, sample.bytes).catch(() => null))
  }
  return {
    onSample: push,
    fillMissing: (samples) => {
      for (const sample of samples) push(sample)
    },
    settle: async () => {
      await Promise.all(pending)
    },
    uploadedFrames: () => [...started].sort((a, b) => a - b),
  }
}
