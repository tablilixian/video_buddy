// 负向用例包 —— 「后端该不该挡住坏请求，且报错有没有指对地方」。
//
// 为什么需要：正向链路全绿只说明「好请求能跑通」，不代表坏请求会被挡住。
// 一个过于宽松的后端（把不存在的句柄当成空、把非法枚举静默降级）在正向测试里
// 完全看不出来，却会在用户手上变成「生成了但结果不对」。
//
// 判定与正向用例**相反**：这里期望**被挡下**（非 2xx），而且 422 的 `detail[].loc`
// 必须命中我们故意做错的那个字段 —— 只回 422 但 loc 指错字段同样算用例失败。
//
// ⚠️ 依据纪律：每条用例都写清 `why`（有实测留档的写实测码，靠契约推的要标注「契约推定」），
//    避免日后分不清「这条断言过期了」和「后端真的坏了」。
//
// 契约来源：docs/api-probe/krea2-turbo-20260916/openapi-20260916.json
// 实测来源：docs/api-probe/image2fix-20260918/report.md

import { extractValidationFields } from './verdict.ts'
import { getEndpoint } from './endpoints.ts'

export interface NegativeCase {
  id: string
  title: string
  /** 真实端点 id（用于取 path / method）。 */
  endpoint: string
  method?: 'GET' | 'POST'
  /** 故意做错的请求体（绕过 buildBody 直接发原始体）。null = 空体。 */
  body: Record<string, unknown> | null
  /** 是否发 multipart（用于 upload 的「不带文件」用例）。 */
  multipart?: boolean
  /** 可接受的「被挡下」状态码。空数组 = 只要非 2xx 就算挡住。 */
  expectStatus: number[]
  /** 实际返回 422 时，`detail[].loc` 必须命中该字段路径。 */
  expectField?: string
  /** 这条用例的依据。 */
  why: string
}

export const NEGATIVE_CASES: NegativeCase[] = [
  {
    id: 'neg.product-name-as-handle',
    title: '产物名当句柄（image2fix）',
    endpoint: 'image2fix',
    body: { prompt: '把标题改一下，只改文字', image: 'krea2_00140_.png' },
    expectStatus: [500],
    why: '实测：image2fix-20260918 留档，产物名直用 → 500 且 52ms 内返回（后端把「文件不存在」报成笼统 Internal Server Error）。',
  },
  {
    id: 'neg.product-name-as-vl-handle',
    title: '产物名当句柄（image2vl）',
    endpoint: 'image2vl',
    body: { filename: 'boogu_00009_.png', prompt: '描述这张图', system_prompt: '你是摄影指导。' },
    expectStatus: [500],
    why: '实测：同留档 CV-155 对照，55ms 内 500。与上一条合看，说明「产物名不可入参」是全局纪律而非单端点的偶然。',
  },
  {
    id: 'neg.nonexistent-handle',
    title: '不存在的句柄（image2fix）',
    endpoint: 'image2fix',
    body: { prompt: '把标题改一下，只改文字', image: 'ref-doesnotexist.png' },
    expectStatus: [500, 404, 400],
    why: '契约推定：后端对 temp/ 文件丢失与产品名同样报 500（见 generate.ts 的 isBadReferenceError 注释）。放宽到 4xx 也接受 —— 这条要证明的是「不会静默成功」，不是「必须是 500」。',
  },
  {
    id: 'neg.missing-prompt',
    title: '缺必填 prompt（txt2image）',
    endpoint: 'txt2image',
    body: { width: 1280, height: 736 },
    expectStatus: [422],
    expectField: 'prompt',
    why: '契约：Text2ImageRequest.required = [prompt]。',
  },
  {
    id: 'neg.missing-system-prompt',
    title: '缺必填 system_prompt（image2vl）',
    endpoint: 'image2vl',
    body: { filename: 'ref-x.png', prompt: '描述这张图' },
    expectStatus: [422],
    expectField: 'system_prompt',
    why: '契约：Image2VLRequest.required = [system_prompt, prompt]（字段名是下划线，容易写错，故单列一条）。',
  },
  {
    id: 'neg.missing-lyrics-prompt',
    title: '缺必填 lyrics_prompt（txt2audio）',
    endpoint: 'txt2audio',
    body: { caption_prompt: 'calm ocean waves ambience' },
    expectStatus: [422],
    expectField: 'lyrics_prompt',
    why: '契约：Txt2AudioRequest.required = [caption_prompt, lyrics_prompt]。注意**空串是合法的**（纯音乐就传 ""），只有字段缺失才 422。',
  },
  {
    id: 'neg.bad-aspect-enum',
    title: '非法宽高比（视频 aspect=1:1）',
    endpoint: 'videoFl2va',
    body: { prompt: 'slow push in', aspect: '1:1' },
    expectStatus: [422],
    expectField: 'aspect',
    why: '契约：AspectRatio 枚举只有 [16:9, 9:16]。1:1 是图片端点的便利档（映射 1024×1024），视频端点不收 —— 传错应被挡。',
  },
  {
    id: 'neg.bad-duration-type',
    title: '时长类型错（duration="abc"）',
    endpoint: 'videoFl2va',
    body: { prompt: 'slow push in', duration: 'abc' },
    expectStatus: [422],
    expectField: 'duration',
    why: '契约：duration 是 integer。注意**契约里没有 maximum** —— 所以「时长上限 15」是产品约定，不是后端校验，故不做 >15 的用例。',
  },
  {
    id: 'neg.upload-without-file',
    title: '上传不带文件',
    endpoint: 'upload',
    body: null,
    multipart: true,
    expectStatus: [422],
    expectField: 'file',
    why: '契约：upload 的 requestBody.required = true，Body_upload_file 的 required = [file]。',
  },
]

export interface NegativeOutcome {
  pass: boolean
  /** 失败原因（人类可读）。 */
  failures: string[]
  /** 通过时的摘要。 */
  note: string
}

/**
 * 判定一条负向用例的结果。
 *
 * 三段判定，缺一段都会漏：
 *  ① 必须**被挡下**（非 2xx）—— 2xx 说明后端放行了坏请求；
 *  ② 状态码要在可接受集合里 —— 挡住的方式也得对（如该 422 却 500，说明是崩溃不是校验）；
 *  ③ 422 时 loc 必须命中故意做错的那个字段 —— 只回 422 但指错字段，用户照样看不懂。
 */
export function judgeNegative(c: NegativeCase, status: number, json: unknown): NegativeOutcome {
  if (status >= 200 && status < 300) {
    return {
      pass: false,
      failures: [`坏请求被放行：期望被后端挡下，实际 HTTP ${status} 成功`],
      note: '',
    }
  }
  if (status === 0) {
    return { pass: false, failures: ['请求未完成：没有拿到 HTTP 响应（后端不可达或超时）'], note: '' }
  }
  if (c.expectStatus.length > 0 && !c.expectStatus.includes(status)) {
    const detail = json === null ? '' : ` · ${JSON.stringify(json).slice(0, 160)}`
    return {
      pass: false,
      failures: [`挡住的方式不符预期：期望 ${c.expectStatus.join(' / ')}，实际 HTTP ${status}${detail}`],
      note: '',
    }
  }
  if (c.expectField && status === 422) {
    const fields = extractValidationFields(json)
    if (!fields.includes(c.expectField)) {
      return {
        pass: false,
        failures: [
          `422 的定位没指对字段：期望 loc 命中「${c.expectField}」，实际 ${fields.length > 0 ? fields.map((f) => `「${f}」`).join('、') : '未解析出任何字段'}`,
        ],
        note: '',
      }
    }
    return { pass: true, failures: [], note: `HTTP 422 如期挡下 · loc 命中 ${c.expectField}` }
  }
  return { pass: true, failures: [], note: `HTTP ${status} 如期挡下` }
}

/** 取该用例对应的端点路径（渲染 / 发送都要）。 */
export function negativePath(c: NegativeCase): string {
  return getEndpoint(c.endpoint)?.path ?? ''
}
