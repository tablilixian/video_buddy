/**
 * REQ-036 复刻客户端能力增强批：**复刻链路工具**（media_probe / evidence_grid / download_video）。
 *
 * 为什么独立成文件：`host-tools.ts` 在文件行数棘轮下只准减不准增
 * （`tests/file-size-guard.test.mjs`），按 `host-tools-artifact.ts` 的先例外置：
 * 工厂注入依赖，工具定义全部落在本模块，主文件只留一行 spread。
 *
 * 三条工具的共同点：都是**纯客户端确定性能力**（Host 侧 ffmpeg / 下载），零模型
 * 服务费用，服务「拆解输入质量」与「秒数锚定」两个复刻缺口（渲染与生成侧不动）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { sep } from 'node:path'
import type { ProjectRegistry } from './projects.js'
import { throwError } from './error-system.js'
import { renderTextResult } from './tool-result-text.js'
import { probeMedia } from './media-probe.js'

export interface RemakeToolsDeps {
  registry: ProjectRegistry
  resolveProjectId(registry: ProjectRegistry, cwd: string | undefined): Promise<string>
}

/** 复刻链路工具（`media_probe` / `evidence_grid` / `download_video`）。 */
export function defineRemakeTools(_deps: RemakeToolsDeps): ReturnType<typeof defineTool>[] {
  // download_video（C1）会消费 registry / resolveProjectId 落画布素材区；先收下依赖。
  return [
    defineTool({
      // 第 39 号工具（REQ-036 C3；编号紧接 teardown_store=38，REQ 文档写作 38/39/40
      // 是因为成文时 teardown_store 尚未占号 —— 按「写号前 grep docs/」惯例顺延）。
      name: 'media_probe',
      description:
        '媒体探针：一条命令摸清本地媒体文件的真实参数 —— 时长（秒）/ 分辨率 / fps / 音轨数 / 容器 / **综合响度（LUFS）**。'
        + '\n\n**什么时候用**：① 拆解表头部（时长/fps/音轨）—— 拆解与映射前先探，别拿声明值当真值（H3 实测请求 5s 出 5.167s，帧级对齐全偏）；'
        + '② **响度对齐**——复刻观感对齐的硬数据（甜品复刻实测：成片 -15.3 LUFS vs 原片 -11.4，无人发现）：先探参考片 LUFS，成片渲完再探一次，差值 >2 LUFS 就调 BGM/旁白音量重渲。'
        + '\n\n**不再临场拼 ffmpeg 命令**——本工具是唯一入口，内部用 ffmpeg -i + ebur128，不需要你写 argv。'
        + '响度只在有音轨时测量；无声 / 测量失败不阻塞探针（如实标注原因）。绝不抛错到「探不出来」之外——文件不存在会明确报错。',
      parameters: {
        videoPath: { type: 'string' as const, required: true, description: '媒体文件绝对路径（画布上传/生成产物的落盘路径；音频文件同样可探）' },
      },
      output: {
        schema: {
          type: 'object' as const,
          additionalProperties: false,
          properties: {
            text: { type: 'string' as const, description: '逐项参数读数 + 用法指引' },
          },
        },
        render: renderTextResult,
      },
      async execute(args) {
        const a = args as { videoPath?: unknown }
        const videoPath = typeof a.videoPath === 'string' ? a.videoPath.trim() : ''
        if (videoPath === '' || !videoPath.startsWith(sep)) {
          throwError('CS-USER-ERR', { message: '缺少 videoPath 或不是绝对路径 —— 媒体要先落盘（画布产物路径即可）。' })
        }
        const result = await probeMedia({ path: videoPath })
        const size = result.width !== undefined && result.height !== undefined ? ` · ${result.width}×${result.height}` : ''
        const fps = result.fps !== undefined ? ` · ${result.fps} fps` : ''
        const container = result.container !== undefined ? result.container : '未知容器'
        const loudness = result.audioLoudnessLufs !== null
          ? `${result.audioLoudnessLufs.toFixed(1)} LUFS`
          : `未测得（${result.loudnessNote ?? '未知原因'}）`
        const lines = [
          `📐 ${container}${size}${fps} · ${result.durationSec.toFixed(2)}s · 视频流 ${result.videoStreams} · 音轨 ${result.audioStreams}`,
          `综合响度：${loudness}`,
        ]
        if (result.hasAudio) {
          lines.push('响度用法：把参考片 LUFS 记进拆解便签；成片渲完 media_probe 一次，差值 >2 LUFS 调音量重渲（SKILL §4 口径）。')
        } else {
          lines.push('本片无音轨 —— 拆解只看画面节奏，不需要响度对齐。')
        }
        return { text: lines.join('\n') }
      },
    }),
  ]
}
