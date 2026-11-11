/**
 * 渲染工单报告（宿主侧形状，字段与客户端 `RenderMetrics` 一一对齐）。
 *
 * 从 `render-job.ts` 拆出的原因同 `render-diagnostics.ts` / `render-budget.ts`：RP-16 给
 * `prepareMs` 加三段拆解字段后该文件到 1,282 行 > 棘轮登记 1,263（`tests/file-size-guard.test.mjs`，
 * 单文件 ≤1,200 闸线 + 白名单只准减不准增）。**不改白名单登记数**，把成块接口搬走即可。
 *
 * 形状契约由 `tests/remotion-render-report.test.mjs`（透传 / 兜底 0）与
 * `tests/render-tool-contract.test.mjs`（report schema 子集）双向钉住。
 */
import type { ManifestAudioSummary, RenderQuality } from './manifest.js'
import type { TextFitReportEntry } from './text-fit-audit.js'
import type { TimingCheckSummary } from '../timing-segments.js'

/** 三期 W6-2 / REQ-035 F-04：渲染报告（宿主侧形状，字段与客户端 `RenderMetrics` 一一对齐）。 */
export interface RenderJobReport {
  quality: RenderQuality
  frames: number
  totalMs: number
  /**
   * 准备阶段（字体注入 + 素材时长探测 + 能力判定），与帧数无关。
   *
   * RP-16：真机曾报「准备 19.0s」但从未归因，2026-11-07 字体探针实测字体全程仅
   * 26–44ms（`docs/plans/2026-11-07-渲染性能优化调研与推进计划.md` §7.5）⇒ 19s 另有出处，
   * 故用下面三个分段字段把它拆开。**三段之和 ≈ `prepareMs`**（差值是中间胶水）。
   * 老客户端不上报时分段落 `0`（`asRenderReport` 白名单只收已知数值键）。
   */
  prepareMs: number
  /** 字体注入段（`applyManifestFonts`：注入 `@font-face` + 等字体就绪）。 */
  prepareFontMs: number
  /** 素材时长探测段（宿主给了 `realDurations` 即短路，应趋近 0）。 */
  prepareProbeMs: number
  /** 能力判定段（`canRenderMediaOnWeb`）。 */
  prepareCapabilityMs: number
  /** 净渲染耗时（`renderMediaOnWeb` 从调用到返回）。 */
  renderMs: number
  /** 每帧净渲染耗时 = `renderMs / frames`。 */
  msPerFrame: number
  /** 全部帧**编码完成**的时刻（相对渲染开始）；不是"编码耗时"。 */
  encodeDoneAtMs: number
  bytes: number
  bitrateKbps: number
  width: number
  height: number
  sampledFrames: number
  /** OPT-11：音频平台保证 —— 由 manifest 确定性推导（非探测）。`audibleSources=0` ⇒ 成片必然无声。 */
  audio?: ManifestAudioSummary
  /**
   * Q1 响度闸：成片综合响度（ITU-R BS.1770 integrated LUFS）。无声片 / 探测失败不出此字段。
   * 复刻场景里响度直接决定观感对齐（甜品复刻会话实测：-15.3 vs 原片 -11.4，无人发现）。
   */
  loudnessLufs?: number
  /**
   * Q2 时序闸（复刻提效批四）：调用方传了 `timingSegments` 时，渲完实测成片切换点
   * 与拆解段起点的逐边界比对结论（漂移超窗报 warnings，细节看这里逐段校准）。
   */
  timingCheck?: TimingCheckSummary
  /**
   * 0B（CV-461）：**文字容量体检** —— 逐条文字轨一条（渲前在浏览器里按真实字形量的）。
   *
   * 为什么要有：`validateManifest` 在 Node 里没有 canvas，只能粗判；成片那句「字被
   * `overflow:hidden` 裁掉、校验却说一切正常」就卡在这个空档里。这里是**实测值**：
   * `overflow=true` 的条目已在 `warnings` 里有可执行文案（改短到 N 字 / 加大 box）。
   * 老客户端不上报时缺省（不伪造空数组 —— 空数组等于「查过且没问题」，那是撒谎）。
   */
  textFit?: TextFitReportEntry[]
}
