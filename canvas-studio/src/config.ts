/**
 * Canvas Studio P3 明文配置（验收后整理）。
 *
 * 优先读取环境变量，便于本地验收时切换；未设置时回退到下方明文常量。
 * 接口形态参考 WL-AI-Director 的 Drama Backend 适配器
 *（`services/adapters/imageAdapter.ts`、`videoAdapter.ts`）。
 */
import { randomUUID } from 'node:crypto'
import type { VideoResolution } from './providers/types.js'
// 档位像素表本体已抽到 output-size.ts（下方再出口）；本文件的 sizeForAspectRatio
// 仍要读它，故同文件内直接 import（同一份实现，无第二张表）。
import { OUTPUT_SIZE } from './output-size.js'

/**
 * 生成接口端点（与 WL 适配器对齐）。
 * 注：Drama Backend 的基址 / 密钥已外置到 DSH 设置系统（见 host-config.ts），
 * 不再在此写死明文常量。
 */
export const DRAMA_ENDPOINTS = {
  health: '/api/v1/health',
  txt2image: '/api/v1/generate/txt2image',
  // 0.7.0 对拍（2026-09-30）：`txt2imageanime` 已从后端端点总览移除，动漫画风不再
  // 走独立端点 —— Krea2 Turbo 本就靠提示词表达画风，动漫画风直接写进 prompt。
  /**
   * 中文海报 / 文字渲染特化生图（CV-270，2026-09-30 后端 0.8.0 新增 + 同日探针实测接入）：
   * Qwen Image 2.1（steps=25），画面里有**要读的文字**（片名字幕 / 海报标题 / 标语招牌）
   * 时用它；普通无字图仍走 `txt2image`（Krea2，steps=8，更快）。
   * 探针证据：docs/api-probe/txt2image-withtxt-20260930/report.md（200 / 20.7s，
   * 《剑归江湖》四字无错字、版式符合描述；422 字段级校验快失败 0.018s）。
   * 纯文生：入参只有 prompt/width/height，无参考图槽位（带参考图的改字走 image_fix）。
   */
  txt2imageWithtxt: '/api/v1/generate/txt2image_withtxt',
  image2image: '/api/v1/generate/image2image',
  /**
   * 图内文字修复（CV-202，2026-09-18 后端新增 + 同日探针实测接入）：Boogu Edit
   * 专用改图链路 —— Krea2 出图后画面文字出错时的修复通道，改几个字不必整图重画。
   * 后端同事用法纪律：prompt **只写文字部分**（从原出图 prompt 提取），其余画面
   * 描述不带。产物名 `boogu_*` 前缀（后端文档示例写 boogu_edit_*，以实测为准），
   * 属「产物名」类不可直接入参（探针复证：直用 500 快失败，CV-155 同型）。
   * 探针证据：docs/api-probe/image2fix-20260918/report.md（200 / 68.5s，SALLE→SALE 修复生效）。
   */
  image2fix: '/api/v1/generate/image2fix',
  /**
   * 统一文件上传（图片 / 视频 / 音频）——**唯一**的上传端点（CV-137，2026-09-10 实测）。
   *
   * 旧的 `/api/v1/generate/uploadimage` 已从后端路由表移除：对任何文件均返回
   * `404 {"detail":"Not Found"}`（openapi.json 里也不再出现该路径）。不要再改回去。
   * 响应为 ComfyUI 原生结构 `{name, subfolder, type}`，`name` 即下游工具所需的文件名。
   */
  upload: '/api/v1/generate/upload',
  // 0.7.0 对拍（2026-09-30）：`image2promptenhance` 已从后端端点总览移除，
  // prompt_enhance 工具随之退役；提示词改写若要回归，走本地会话模型而非后端端点。
  image2vl: '/api/v1/generate/image2vl',
  /**
   * 视频理解（Qwen3-VL-4B + `qwen3vl_video_analyze.json` 工作流）。
   *
   * 与 image2vl 同构，只是入参换成 `video`；**共用同一条文件名纪律**——`video` 必须是
   * 上传得到的句柄，生成产物名会被后端 0.1s 前置 500（本项目 2026-09-22 探针实测：
   * 产物名 0.1s 500 / 上传句柄 200，报告见 `docs/api-probe/video2vl-20260922/`）。
   */
  character: '/api/v1/generate/image2character',
  videoFl2va: '/api/v1/generate/image2videofl2va',
  videoRef2va: '/api/v1/generate/image2videoref2va',
  /**
   * 异步视频任务（后端 0.5.0 起，fl2va / ref2va 改为「提交即 202 + job_id」）。
   * `GET {jobs}/{job_id}` 查状态（pending/in_progress/completed/failed/cancelled）、
   * `POST {jobs}/{job_id}/cancel` 取消、`GET {jobs}/{job_id}/result` 取产物
   * （结构 = 旧同步响应 `{prompt_id, filename, full_url, duration}`；202 未完成 /
   * 409 失败或取消 / 404 不存在）。`job_id` 即 ComfyUI `prompt_id`。
   */
  jobs: '/api/v1/jobs',
  video2vl: '/api/v1/generate/video2vl',
  txt2audio: '/api/v1/generate/txt2audio',
  /**
   * 语音合成（CV-271，2026-09-30 后端 0.8.0 收录 + 同日探针实测接入）：VoxCPM2
   * （`tts_cpm.json` 工作流）—— 工具 `tts_voiceover` 占位升真。
   * 入参 `txt_prompt`（合成文本，必填）/ `instruct_prompt`（声音设计，自然语言：
   * 语言/性别/年龄/语气/情感/语速/方言，支持 30 语言 + 9 中文方言）/ `refaudio`
   * （参考音频句柄克隆音色，**未实测**——本轮探针只测声音设计路径）。
   * 探针证据：docs/api-probe/txt2speech-20260930/report.md（200 / 14.4s；
   * 产物实测 **mp3**（文档写 flac，以实测为准）；响应 duration=14.34 vs ffprobe
   * 真值 5.16 —— 服务端耗时口径再证）。
   */
  txt2speech: '/api/v1/generate/txt2speech',
} as const

/**
 * Drama 后端「同步单任务」纪律的**模型可见文案（唯一源）**。
 *
 * 后端同刻只处理一个请求，一次 POST 等到出片才返回；并发提交只排队、不加速
 * （实测 A 9.4s / B 18.7s 并发墙钟仍 18.7s）。**必须写进工具描述**——描述每回合
 * 都在模型上下文里，而 SKILL.md 只有被加载后才进上下文。多个工具共用同一措辞，
 * 防两处漂移（与 `h3-ir-validate.ts` 的 `COUNT_MODE_HINT` 同一做法）。
 *
 * 后端 0.5.0 起视频两端点改异步（提交即 202），**视频工具换用
 * `DRAMA_VIDEO_ASYNC_HINT`**；本提示继续贴在图片 / 上传 / 视频理解等仍为
 * 同步阻塞的工具上。不适用于本地 ffmpeg 工具（`compose_video` / `extract_last_frame` /
 * `cut_audio` —— 三者都只碰本地磁盘，与后端队列无关）。
 */
export const DRAMA_SERIAL_HINT =
  '⚠️ Drama 后端**同步单任务**（同刻只处理一个请求）：需要多次生成时**逐个调用、等上一个返回**再发下一个。并发提交只排队不加速，还会让用户以为卡死。'

/**
 * Drama 视频工具（`video_generate` / `video_composite`）的**异步纪律文案（唯一源）**。
 *
 * 后端 0.5.0 起两个视频端点提交即 202 + job_id，ComfyUI 自行排队串行执行 ⇒
 * agent 可以**连续提交多个镜头任务**再统一等待，批量出片墙钟 = 后端队列总耗时，
 * 不再被「逐个调用等上一个返回」拉长。轮询由宿主按任务独立进行（30s 间隔），
 * agent 只需不重复提交同一镜头。
 */
export const DRAMA_VIDEO_ASYNC_HINT =
  'ℹ️ Drama 视频为**异步任务**：提交后立即返回（后端自行排队串行执行）。可以**连续提交多个镜头**的任务，不必等上一个出片再提交下一个；每个任务由系统独立跟踪进度，**不要重复提交同一镜头**。'

/**
 * 分辨率档位 → 输出像素（16:9 基准）与档位 → megapixels 表。
 *
 * REQ-021 起本体抽到 `output-size.ts`（纯数据模块，客户端检查点库与 node:test
 * 可直连 —— config.ts 顶部的 `node:crypto` import 让它们无法拖本文件）；这里
 * 再出口保持既有 import 路径（generate.ts / providers / host-config 等）不变。
 * 逐条搬运的原理注释见 output-size.ts。
 */
export { MEGAPIXELS_BY_RESOLUTION, OUTPUT_SIZE } from './output-size.js'

/** 默认档位（设置项 `defaultResolution` 的默认值，两处必须一致）。 */
export const DEFAULT_RESOLUTION: VideoResolution = '736p'

/**
 * CV-243：项目资产回收站目录名（`<项目>/assets/.trash/`）。
 *
 * 常量放这里是 config 是唯一被 generate.ts（promote fallback）与 asset-gc.ts
 * （移入 / GC）同时依赖的共享底座——放任何一方都会造成循环 import。
 * 生命周期：删除节点 → 文件移入；打开项目 GC → 回活（仍被引用）或物理删除。
 */
export const ASSET_TRASH_DIR = '.trash'

/** 合法档位判定 —— 工具入参 / 设置项 / 历史值归一三处共用（避免校验散落）。 */
export function isVideoResolution(value: unknown): value is VideoResolution {
  return value === '480p' || value === '736p' || value === '2k'
}

/**
 * 宽高比 + 档位 → 像素尺寸（图片与视频**共用同一个档位**，故只用这一份实现）。
 *
 * 9:16 反宽高；1:1 恒 1024×1024（方形不是 H3 输出规格，三档共用，无档位意义）。
 * 第 2 参带默认值 ⇒ 既有调用点（`generate.ts`）与既有测试零改动即可编译。
 */
export function sizeForAspectRatio(
  aspectRatio: string | undefined,
  resolution: VideoResolution = DEFAULT_RESOLUTION,
): { width: number; height: number } {
  switch (aspectRatio) {
    case '9:16': {
      const base = OUTPUT_SIZE[resolution]
      return { width: base.height, height: base.width }
    }
    case '1:1': return { width: 1024, height: 1024 }
    case '16:9':
    default: return { ...OUTPUT_SIZE[resolution] }
  }
}

/** 生成一个资产文件名用的 UUID。 */
export function newAssetId(): string {
  return randomUUID()
}
