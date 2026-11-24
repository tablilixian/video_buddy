/**
 * 积分预估的唯一 client 入口（三个 chip + 卡面「重新生成」共用）。
 *
 * ## 为什么是 hook 而不是「每个组件各写一个 effect」
 *
 * 预估会被**高频触发**：拖时长滑块、连点清晰度、切模式。三段骨架缺一不可
 * （参考工程 reelsbuddy-desktop `packages/studio-panel/lib/client.js:1270-1303`
 * 已经踩过这些坑）：
 * 1. **300ms 防抖** —— 拖一次滑块不该发三个请求；
 * 2. **AbortController** —— 参数变了，在飞的那个请求的结果已经没人要，必须能取消；
 * 3. **参数变先清旧值** —— 否则会看到「1080P 的档位配 720P 的价」闪一下。
 *
 * 第四件事是**指纹缓存**（模块级，跨组件共享）：同一组计价参数 5 分钟内命中缓存
 * 直接返回，不发请求。缓存键**不含 prompt**（见 `credit-quote.ts` 的
 * `quoteFingerprint`）：改一个字不该重报一次价。
 *
 * ## 三态语义（与 Host 契约对齐）
 *
 * - `loading`：在飞且没有旧值 ⇒ 显示 `…`；
 * - `ok`：拿到数 ⇒ 显示精确值；
 * - `failed`：没拿到 ⇒ 有旧值显示「约 N」并标灰（title 挂原因），没旧值显示 `—`。
 *
 * **失败绝不阻断提交**：预估是装饰性读数，Host 侧的 quote 硬闸也是 fail-open。
 */
import { useEffect, useRef, useState } from 'react'
import { fetchStudioAccountQuote } from './api.js'
import type { CreditQuoteParams } from '../contracts/account.js'

export interface CreditQuoteState {
  /** `idle` = 没有可报的参数（如空节点）；`loading` = 在飞且无旧值。 */
  readonly status: 'idle' | 'loading' | 'ok' | 'failed'
  /** 预估积分（服务端 4 位小数原样）；null = 没有数。 */
  readonly credits: number | null
  /** 显示的是上一组参数留下的值（标灰 + 「约」）。 */
  readonly stale: boolean
  /** 失败原因（给 title 用，不弹错）。 */
  readonly error: string | null
  /** 报价用的模型 code（详情/title 可显示「按 image.krea2 计价」）。 */
  readonly model: string | null
}

interface CacheEntry {
  readonly credits: number
  readonly model: string
  readonly at: number
}

/** 缓存 TTL：与 Host 侧一致（5 分钟）。 */
const CACHE_TTL_MS = 5 * 60_000
/** 防抖窗口：拖滑块时只报最后一次。 */
const DEBOUNCE_MS = 300
/** 缓存上限（指纹种类随档位/时长组合增长，封顶防泄漏）。 */
const CACHE_MAX = 64

const cache = new Map<string, CacheEntry>()

/**
 * 指纹：**只含计价参数**。与 Host 的 `quoteFingerprint` 必须同构 —— 不一致的
 * 后果只是「多打一次请求」，但仍然要保持同一份口径，否则排查时会以为缓存坏了。
 */
function fingerprintOf(params: CreditQuoteParams): string {
  return [
    params.kind,
    params.imageTool ?? '',
    params.resolution ?? '',
    params.aspectRatio ?? '',
    params.hasImages === true ? 'ref' : 'text',
    params.duration === undefined ? '' : String(Math.round(params.duration)),
    params.videoMode ?? '',
    params.audioFn ?? '',
    params.modelOverride ?? '',
  ].join('|')
}

const IDLE: CreditQuoteState = { status: 'idle', credits: null, stale: false, error: null, model: null }
const LOADING: CreditQuoteState = { status: 'loading', credits: null, stale: false, error: null, model: null }

/** 内部状态多带一个 `key`：用来判断「这个数是不是当前参数的」。 */
interface StoredState extends CreditQuoteState {
  readonly key: string | null
}

/** 命中未过期缓存（命中即视为精确值，不打请求）。 */
function freshCache(key: string): CreditQuoteState | undefined {
  const hit = cache.get(key)
  if (hit === undefined || Date.now() - hit.at >= CACHE_TTL_MS) return undefined
  return { status: 'ok', credits: hit.credits, stale: false, error: null, model: hit.model }
}

/**
 * 报一次价（参数变化时自动重报）。
 *
 * `params` 每次渲染都会是新对象，所以这里**不能**把它放进依赖数组 —— 依赖只能是
 * 指纹字符串（同参数 ⇒ 同字符串 ⇒ 不重跑）。
 */
export function useCreditQuote(params: CreditQuoteParams | null): CreditQuoteState {
  const key = params === null ? null : fingerprintOf(params)
  // 请求体跟着参数走，但重报只由指纹触发：prompt 改了不重报（价格与它无关）。
  const latest = useRef<CreditQuoteParams | null>(params)
  latest.current = params
  const [stored, setStored] = useState<StoredState>({ ...IDLE, key: null })

  /**
   * **渲染期派生**，而不是等 effect：参数一改（key 变）就必须立刻换读数。
   *
   * 为什么不能只靠 effect 里的 `setState`：effect 在 paint 之后跑，中间那一帧仍是
   * 上一档的数 —— 用户拖一次档位会看到「1080P 的档位 + 720P 的价」闪一下。缓存命中
   * 的时候更明显：手速快时会连闪几次。这里按 key 直接派生，那一帧就不存在。
   */
  const current: CreditQuoteState = stored.key === key
    ? stored
    : key === null
      ? IDLE
      : (freshCache(key) ?? LOADING)

  useEffect(() => {
    if (key === null) return
    const cached = freshCache(key)
    if (cached !== undefined) {
      setStored({ ...cached, key })
      return
    }
    // 过期缓存：**保留数字但降级成「约」**（同一组参数的旧报价是近似值，不是另一个
    // 价）。新参数没有旧值时才是 `…`（LOADING）。
    const expired = cache.get(key)
    setStored(expired === undefined
      ? { ...LOADING, key }
      : { key, status: 'ok', credits: expired.credits, stale: true, error: null, model: expired.model })
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(() => {
      const request = latest.current
      if (request === null) return
      void (async () => {
        try {
          const view = await fetchStudioAccountQuote(request, controller.signal)
          if (!active) return
          if (view.credits === null) {
            setStored({
              key,
              status: 'failed',
              credits: null,
              stale: false,
              error: view.error?.message ?? '报价暂不可用',
              model: null,
            })
            return
          }
          if (cache.size >= CACHE_MAX) {
            const oldest = cache.keys().next()
            if (!oldest.done) cache.delete(oldest.value)
          }
          cache.set(key, { credits: view.credits, model: view.model ?? '', at: Date.now() })
          setStored({ key, status: 'ok', credits: view.credits, stale: false, error: null, model: view.model })
        } catch (cause) {
          // abort = 换参数了，这次结果没人要；不要写成 failed（会闪一下「暂不可用」）。
          if (!active) return
          const message = cause instanceof Error ? cause.message : String(cause)
          setStored(previous => ({
            key,
            status: 'failed',
            // 只有**同一组参数**的成功值才允许降级成「约 N」：跨档位的旧数不是近似，
            // 是另一个价（720P 21.14 与 1080P 41.78 差一倍），宁可不显示。
            credits: previous.key === key ? previous.credits : null,
            stale: previous.key === key && previous.credits !== null,
            error: message,
            model: previous.key === key ? previous.model : null,
          }))
        }
      })()
    }, DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [key])

  return current
}

/**
 * 预估积分的展示文案（**唯一格式化点**）。
 *
 * 4 位小数是服务端的精度，**不四舍五入到整数**：21.1354 显示成 21 会让人以为
 * 「一图 21 分」，而实际扣的是 21.1354；但服务端也会给 30.0000 这种整数，所以
 * 去掉尾随 0 —— 该精确的地方精确，该干净的地方干净。
 */
export function formatQuoteCredits(credits: number): string {
  const fixed = credits.toFixed(4)
  return fixed.replace(/\.?0+$/, '')
}
