// Drama Backend 端点 schema —— 测试工具表单与请求体的唯一事实来源。
// 字段与请求体构造严格对齐 canvas-studio/src/{config,generate,host-tools,providers/drama}.ts。
//
// 关键后端纪律（来自源码注释）：
//  - 图片/视频档位 → 像素/megapixels 必须取自下方 OUTPUT_SIZE / MEGAPIXELS（32 倍数，禁自由值）。
//  - 参考图字段（image1.. / filename / filenames）只收「上传句柄」，**不收产物名（img_*/z-image_*）**，
//    否则后端 500。素材库里的「句柄」类才可直填；URL 类需先「转存」成句柄。

export type FieldType = 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'file'

/** 参考位类型：素材库「用作输入」时按此匹配。 */
export type RefKind = 'image-slot' | 'filename' | 'filenames'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  default?: string | number | boolean
  hint?: string
  refKind?: RefKind
}

export interface EndpointDef {
  id: string
  method: 'GET' | 'POST'
  path: string
  group: string
  title: string
  desc: string
  consumes?: 'json' | 'multipart'
  fields: FieldDef[]
  /** 把表单值转成真实请求体（json 对象或 multipart FormData）。 */
  buildBody?: (v: Record<string, string>) => Record<string, unknown> | FormData
}

// —— 分辨率/像素映射（与 canvas-studio/config.ts 同源）——
const OUTPUT_SIZE: Record<string, { w: number; h: number }> = {
  '480p': { w: 864, h: 480 },
  '768p': { w: 1376, h: 768 },
  '2k': { w: 1920, h: 1088 },
}
const MEGAPIXELS: Record<string, number> = { '480p': 0.4, '768p': 1.0, '2k': 2.0 }
const RES_OPTIONS = ['480p', '768p', '2k']
const IMG_ASPECT = ['16:9', '9:16', '1:1']
const VID_ASPECT = ['16:9', '9:16']

function sizeFor(aspect: string, res: string): { width: number; height: number } {
  const base = OUTPUT_SIZE[res] ?? OUTPUT_SIZE['768p']
  if (aspect === '9:16') return { width: base.h, height: base.w }
  if (aspect === '1:1') return { width: 1024, height: 1024 }
  return { width: base.w, height: base.h }
}

// 生成 image1..imageN 参考槽字段
function imageSlots(n: number, hint: string): FieldDef[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `image${i + 1}`,
    label: `参考图 ${i + 1}`,
    type: 'text' as const,
    required: i === 0,
    hint,
    refKind: 'image-slot' as const,
  }))
}

export const ENDPOINTS: EndpointDef[] = [
  {
    id: 'health',
    method: 'GET',
    path: '/api/v1/health',
    group: '系统',
    title: '健康检查',
    desc: 'GET /api/v1/health —— 确认 Drama Backend 可达。',
    fields: [],
  },
  {
    id: 'txt2image',
    method: 'POST',
    path: '/api/v1/generate/txt2image',
    group: '文生图',
    title: '写实文生图',
    desc: 'POST /api/v1/generate/txt2image（Krea2 Turbo）。纯文生图，返回图片 URL。',
    fields: [
      { key: 'prompt', label: '提示词', type: 'textarea', required: true },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: IMG_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '768p' },
    ],
    buildBody: (v) => {
      const s = sizeFor(v.aspectRatio || '16:9', v.resolution || '768p')
      return { prompt: v.prompt, width: s.width, height: s.height }
    },
  },
  {
    id: 'txt2imageanime',
    method: 'POST',
    path: '/api/v1/generate/txt2imageanime',
    group: '文生图',
    title: '卡通文生图',
    desc: 'POST /api/v1/generate/txt2imageanime（仅纯文生图）。动漫画风。',
    fields: [
      { key: 'prompt', label: '提示词', type: 'textarea', required: true },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: IMG_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '768p' },
    ],
    buildBody: (v) => {
      const s = sizeFor(v.aspectRatio || '16:9', v.resolution || '768p')
      return { prompt: v.prompt, width: s.width, height: s.height }
    },
  },
  {
    id: 'image2image',
    method: 'POST',
    path: '/api/v1/generate/image2image',
    group: '图生图',
    title: '图生图（最多 4 参考）',
    desc: 'POST /api/v1/generate/image2image（Krea2 Edit）。传句柄到 image1..image4；不传则为纯文生图。',
    fields: [
      { key: 'prompt', label: '提示词', type: 'textarea', required: true },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: IMG_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '768p' },
      ...imageSlots(4, '上传句柄（来自「上传」或生成产物「转存」）。不收产品名(img_*/z-image_*)。'),
    ],
    buildBody: (v) => {
      const s = sizeFor(v.aspectRatio || '16:9', v.resolution || '768p')
      const body: Record<string, unknown> = { prompt: v.prompt, width: s.width, height: s.height }
      for (const k of ['image1', 'image2', 'image3', 'image4']) {
        if (v[k] && v[k].trim() !== '') body[k] = v[k].trim()
      }
      return body
    },
  },
  {
    id: 'image2fix',
    method: 'POST',
    path: '/api/v1/generate/image2fix',
    group: '图生图',
    title: '图内文字修复',
    desc: 'POST /api/v1/generate/image2fix（Boogu Edit）。prompt 只写文字部分；不收宽高。',
    fields: [
      { key: 'prompt', label: '修复指令（只写文字）', type: 'textarea', required: true, hint: '如：把标题 "SALLE" 改成 "SALE"，保持字体/大小/颜色/位置不变。' },
      { key: 'filename', label: '要修复的图（句柄）', type: 'text', required: true, refKind: 'filename', hint: '上传句柄，不收产品名。' },
    ],
    buildBody: (v) => ({ prompt: v.prompt, image: v.filename.trim() }),
  },
  {
    id: 'image2character',
    method: 'POST',
    path: '/api/v1/generate/image2character',
    group: '图生图',
    title: '角色四视图',
    desc: 'POST /api/v1/generate/image2character（krea2_quadview）。基于角色设计图生成四视图立绘。',
    fields: [
      { key: 'filename', label: '角色设计图（句柄）', type: 'text', required: true, refKind: 'filename', hint: '上传句柄，不收产品名。' },
    ],
    buildBody: (v) => ({ image: v.filename.trim() }),
  },
  {
    id: 'upload',
    method: 'POST',
    path: '/api/v1/generate/upload',
    group: '工具',
    title: '上传文件（拿句柄）',
    desc: 'POST /api/v1/generate/upload（multipart）。响应 {name,subfolder,type}，name 即下游句柄。',
    consumes: 'multipart',
    fields: [
      { key: 'file', label: '选择文件', type: 'file', required: true, hint: '图片/视频/音频均可；上传后 name 进素材库（句柄类）。' },
    ],
  },
  {
    id: 'promptEnhance',
    method: 'POST',
    path: '/api/v1/generate/image2promptenhance',
    group: '工具',
    title: '提示词增强',
    desc: 'POST /api/v1/generate/image2promptenhance。返回增强后的提示词 {output}。',
    fields: [
      { key: 'prompt', label: '原始提示词', type: 'textarea', required: true },
    ],
    buildBody: (v) => ({ prompt: v.prompt }),
  },
  {
    id: 'image2vl',
    method: 'POST',
    path: '/api/v1/generate/image2vl',
    group: '工具',
    title: '图片理解（VL）',
    desc: 'POST /api/v1/generate/image2vl。三个字段均必填，返回画面描述 {output}（注意字段名 system_prompt 为下划线）。',
    fields: [
      { key: 'filename', label: '图（句柄）', type: 'text', required: true, refKind: 'filename', hint: '上传句柄，不收产品名。' },
      { key: 'prompt', label: '分析提示词', type: 'textarea', required: true, default: '请从电影摄影角度分析这张画面。' },
      { key: 'system_prompt', label: '系统提示词 system_prompt', type: 'text', required: true, default: '你是一位资深电影摄影指导。', hint: '必填（下划线命名）。' },
    ],
    buildBody: (v) => ({ filename: v.filename.trim(), prompt: v.prompt, system_prompt: v.system_prompt }),
  },
  {
    id: 'videoFl2va',
    method: 'POST',
    path: '/api/v1/generate/image2videofl2va',
    group: '图生视频',
    title: '首尾帧 / 首帧视频',
    desc: 'POST /api/v1/generate/image2videofl2va。不传图为纯文生视频；image1=首帧；image1+image2=首尾帧插值。',
    fields: [
      { key: 'prompt', label: '提示词', type: 'textarea', required: true },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: VID_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '768p' },
      { key: 'duration', label: '时长(秒)', type: 'number', default: 5, hint: '默认 5，上限 15。' },
      ...imageSlots(2, 'image1=首帧；image1+image2=首尾帧。上传句柄。'),
    ],
    buildBody: (v) => {
      const body: Record<string, unknown> = {
        prompt: v.prompt,
        aspect: v.aspectRatio || '16:9',
        megapixels: MEGAPIXELS[v.resolution || '768p'] ?? 1.0,
        duration: Number(v.duration) || 5,
      }
      if (v.image1 && v.image1.trim() !== '') body.image1 = v.image1.trim()
      if (v.image2 && v.image2.trim() !== '') body.image2 = v.image2.trim()
      return body
    },
  },
  {
    id: 'videoRef2va',
    method: 'POST',
    path: '/api/v1/generate/image2videoref2va',
    group: '图生视频',
    title: '多参考图视频',
    desc: 'POST /api/v1/generate/image2videoref2va（最多 9 图 + 3 音频）。图多则角色/场景一致性更强。',
    fields: [
      { key: 'prompt', label: '提示词', type: 'textarea', required: true },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: VID_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '768p' },
      { key: 'duration', label: '时长(秒)', type: 'number', default: 5, hint: '默认 5，上限 15。' },
      ...imageSlots(9, '参考图 image1..image9（上传句柄）。'),
      { key: 'audio1', label: '参考音频 1（句柄）', type: 'text', refKind: 'filename' },
      { key: 'audio2', label: '参考音频 2（句柄）', type: 'text', refKind: 'filename' },
      { key: 'audio3', label: '参考音频 3（句柄）', type: 'text', refKind: 'filename' },
    ],
    buildBody: (v) => {
      const body: Record<string, unknown> = {
        prompt: v.prompt,
        aspect: v.aspectRatio || '16:9',
        megapixels: MEGAPIXELS[v.resolution || '768p'] ?? 1.0,
        duration: Number(v.duration) || 5,
      }
      for (let i = 1; i <= 9; i++) {
        const k = `image${i}`
        if (v[k] && v[k].trim() !== '') body[k] = v[k].trim()
      }
      for (let i = 1; i <= 3; i++) {
        const k = `audio${i}`
        if (v[k] && v[k].trim() !== '') body[k] = v[k].trim()
      }
      return body
    },
  },
  {
    id: 'txt2audio',
    method: 'POST',
    path: '/api/v1/generate/txt2audio',
    group: '工具',
    title: '文生音频',
    desc: 'POST /api/v1/generate/txt2audio。后端必填 caption_prompt 与 lyrics_prompt（歌词可传空串）。',
    fields: [
      { key: 'caption_prompt', label: '音频描述 caption_prompt', type: 'textarea', required: true, hint: '整体风格/氛围描述，如 calm ocean waves ambience。' },
      { key: 'lyrics_prompt', label: '歌词 lyrics_prompt', type: 'textarea', hint: '必填字段，纯音乐/环境音可留空。', default: '' },
      { key: 'duration', label: '时长(秒)', type: 'number', default: 5, hint: '可选。' },
    ],
    buildBody: (v) => {
      const body: Record<string, unknown> = {
        caption_prompt: v.caption_prompt,
        lyrics_prompt: v.lyrics_prompt ?? '',
      }
      if (v.duration && v.duration.trim() !== '') body.duration = Number(v.duration)
      return body
    },
  },
]

export function getEndpoint(id: string): EndpointDef | undefined {
  return ENDPOINTS.find((e) => e.id === id)
}

export const ENDPOINT_GROUPS: string[] = Array.from(new Set(ENDPOINTS.map((e) => e.group)))
