// Drama Backend 端点 schema —— 测试工具表单与请求体的唯一事实来源。
// 字段与请求体构造严格对齐 canvas-studio/src/{config,generate,host-tools,providers/drama}.ts。
//
// 关键后端纪律（来自源码注释）：
//  - 图片/视频档位 → 像素/megapixels 必须取自下方 OUTPUT_SIZE / MEGAPIXELS（32 倍数，禁自由值）。
//  - 参考图字段（image1.. / filename / filenames）只收「上传句柄」，**不收产物名（img_*/z-image_*）**，
//    否则后端 500。素材库里的「句柄」类才可直填；URL 类需先「转存」成句柄。
//
// 字段 default 的含义：既作为表单初始值（方便直接发送），也是「填入示例」按钮的复位目标。

export type FieldType = 'text' | 'textarea' | 'select' | 'number' | 'boolean' | 'file'

/** 参考位类型：素材库「用作输入」时按此匹配。 */
export type RefKind = 'image-slot' | 'filename' | 'filenames'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  /** 初始值；对提示词类字段即「示例提示词」，可一键复位。 */
  default?: string | number | boolean
  hint?: string
  refKind?: RefKind
  /** 该字段是否由「全局角色」驱动：选角色后自动填入。 */
  characterDriven?: boolean
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
  /**
   * 响应**结构断言**：返回非空数组即判失败（元素为人类可读的失败原因）。
   *
   * 为什么需要它：只校验 HTTP 200 会把「后端 200 但响应体缺产物 URL」这类
   * 静默故障判成 PASS（客户端拿不到图，测试台却全绿）。断言层把「能拿到的
   * 东西」也纳入判定 —— PASS = HTTP 2xx **且**断言全过。
   *
   * 只在 HTTP 2xx 时执行；非 2xx 由 `verdict.evaluate` 直接判失败并抽出后端错误。
   *
   * ⚠️ 断言依据必须可查证，禁止凭猜测写字段。三处权威来源：
   *   ① 请求约束 → docs/api-probe/krea2-turbo-20260916/openapi-20260916.json
   *   ② 成功响应体 → docs/api-probe/image2fix-20260918/report.md（实测留档）
   *   ③ 客户端实际读取的字段 → canvas-studio/src/generate.ts:795（callDrama）
   */
  expect?: (json: unknown) => string[]
}

// —— 分辨率/像素映射（与 canvas-studio/config.ts 同源）——
const OUTPUT_SIZE: Record<string, { w: number; h: number }> = {
  '480p': { w: 864, h: 480 },
  '736p': { w: 1280, h: 736 },
  '2k': { w: 1920, h: 1088 },
}
const MEGAPIXELS: Record<string, number> = { '480p': 0.4, '736p': 0.9, '2k': 2.0 }
// 档位/宽高比选项对外导出：参数矩阵面板要按同一份清单给用户勾选，
// 否则「矩阵里能选的档位」和「表单里能选的档位」会各写一份、慢慢漂移。
export const RES_OPTIONS = ['480p', '736p', '2k']
export const IMG_ASPECT = ['16:9', '9:16', '1:1']
export const VID_ASPECT = ['16:9', '9:16']

// —— 角色模板 ——
// 供「角色四视图」链路用：先文生图产出一个角色，再喂给 image2character。
// 之所以不用风景（如灯塔），是因为 image2character 需要的是角色设计图。
// ⚠️ 描述纪律：**必须是单个人物**（one person only / solo）——避免出现多人同框或
//    「角色设定集 / concept art 多姿势」那样被画成好几个人的情况。
export const CHARACTER_PRESETS: { label: string; value: string }[] = [
  { label: '通用角色', value: 'a single young adventurer, one person only, solo, full body, standing pose, centered, plain simple background, high detail' },
  { label: '泳装美女', value: 'a single beautiful young woman wearing a one-piece swimsuit, one person only, solo, full body, standing pose, centered, plain studio background, soft natural light, high detail' },
  { label: '中世纪武士', value: 'a single medieval knight in ornate plate armor with a flowing cape, one person only, solo, full body, standing pose, centered, plain background, dramatic rim light, high detail' },
  { label: '中国古代神仙', value: 'a single ancient Chinese immortal deity in flowing embroidered hanfu robes, one person only, solo, full body, standing pose, centered, plain background, ethereal glow, high detail' },
  { label: '动漫人造人', value: 'a single anime-style android girl with visible mechanical joints and glowing accents, one person only, solo, full body, standing pose, centered, plain background, high detail, anime style' },
  { label: '赛博朋克特工', value: 'a single cyberpunk special agent in a techwear jacket with neon implants, one person only, solo, full body, standing pose, centered, plain background, high detail' },
]

// —— 文字修复测试场景（中文）——
// 供 image2fix 链路生成「基图」用：**必须同时含远景与近景的中文文字**——
// 近景文字清晰可辨（用来验证「改对了」），远景文字被景深虚化（用来验证「没被误改」）。
// 只写单个平面标牌无法覆盖这一验证点，因此每个场景都显式约束「近处清晰 / 远处模糊」。
export const TEXT_SCENES: { label: string; value: string }[] = [
  { label: '街道广告牌·远近景', value: 'a city street lined with Chinese advertising billboards on both sides, the nearest billboard large and perfectly in focus with big crisp legible Chinese characters, billboards further down the street visibly blurred by shallow depth of field, photorealistic street photography, 35mm lens, bright daylight' },
  { label: '店铺门头·远近景', value: 'a row of Chinese shop storefronts along a street, the nearest shop signboard large and perfectly sharp with clear legible Chinese characters, the further signboards softly out of focus, photorealistic, evening street, warm shop light' },
  { label: '地铁指示牌·远近景', value: 'a subway corridor with Chinese directional signs, the nearest sign panel sharp and fully readable with large Chinese characters, signs further down the corridor blurred by depth of field, photorealistic, indoor fluorescent light' },
  { label: '夜市横幅·远近景', value: 'a night market street with Chinese stall banners, the nearest banner sharp with large legible Chinese characters, the banners behind blurred by shallow depth of field, photorealistic, warm lantern light' },
]

// —— 示例提示词（同时用于表单初始值与「填入示例」）——
export const SAMPLES = {
  txt2image: CHARACTER_PRESETS[0].value,
  txt2imageanime: 'a young anime hero with silver hair, full body, clean background, anime style',
  image2image: 'same character, dramatic moonlight, cinematic',
  /** 文字修复默认用例：中文优先；改近景 + 显式声明远景不动。 */
  image2fix: '把近景广告牌上的「朝阳街道」改成「朝阳大街」，保持字体、字号、颜色、位置不变；远景模糊的文字保持不变。',
  /** image2fix 链路的基图提示词（中文远近景场景）。 */
  txt2imageFixScene: TEXT_SCENES[0].value,
  videoFl2va: 'slow camera push in',
  videoRef2va: 'keep character consistent',
  promptEnhance: 'a cat sitting on a windowsill, morning light',
  image2vlPrompt: '请从电影摄影角度分析这张画面。',
  image2vlSystem: '你是一位资深电影摄影指导。',
  txt2audio: 'calm ocean waves ambience',
}

function sizeFor(aspect: string, res: string): { width: number; height: number } {
  const base = OUTPUT_SIZE[res] ?? OUTPUT_SIZE['736p']
  if (aspect === '9:16') return { width: base.h, height: base.w }
  if (aspect === '1:1') return { width: 1024, height: 1024 }
  return { width: base.w, height: base.h }
}

// ===== 响应断言（供 verdict.ts 调用；依据见 EndpointDef.expect 的注释）=====

function isFilled(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== ''
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 生成类端点（图片 / 视频 / 音频）。
 *
 * 实测响应体（image2fix-20260918 留档）：
 *   {"prompt_id":"<uuid>","filename":"krea2_00140_.png","full_url":"http://…/view?…","duration":68.46}
 * 客户端 `callDrama` 读 `full_url ?? data[0].url`（generate.ts:795）——
 * 两者皆空时客户端一定会抛「生成响应中未找到产物 URL」，所以这里必须判失败。
 * `duration` 是**服务端生成耗时（秒）**，不是媒体时长，只校验类型不校验值。
 */
function expectArtifactUrl(json: unknown): string[] {
  if (!isPlainObject(json)) return ['响应体不是 JSON 对象（客户端无法解析产物）']
  const nested =
    Array.isArray(json.data) && isPlainObject(json.data[0]) ? (json.data[0] as Record<string, unknown>).url : undefined
  const fails: string[] = []
  if (!isFilled(json.full_url) && !isFilled(nested)) {
    fails.push('缺少产物 URL：full_url 与 data[0].url 均为空（客户端会报「未找到产物 URL」）')
  }
  if ('filename' in json && !isFilled(json.filename)) fails.push('filename 存在但为空串')
  if ('duration' in json && typeof json.duration !== 'number') {
    fails.push(`duration 应为 number（服务端生成秒数），实际 ${typeof json.duration}`)
  }
  return fails
}

/**
 * 上传端点。实测响应体：`{"name":"ref-a8035d1b.png","subfolder":"","type":"input"}`。
 * `name` 是**唯一**的下游句柄来源，缺失即整条链路断掉。
 * 注意 `subfolder` 正常就是空串，不能当成缺失。
 */
function expectUploadHandle(json: unknown): string[] {
  if (!isPlainObject(json)) return ['响应体不是 JSON 对象（拿不到句柄）']
  const fails: string[] = []
  if (!isFilled(json.name)) fails.push('缺少 name（下游唯一的句柄来源）')
  if ('subfolder' in json && typeof json.subfolder !== 'string') fails.push('subfolder 应为 string')
  if ('type' in json && typeof json.type !== 'string') fails.push('type 应为 string')
  return fails
}

/**
 * 文本类端点（image2vl / image2promptenhance）。
 * 客户端读 `output ?? msg`（generate.ts:1035 / 1062），两者皆空等于没结果。
 * 实测：image2vl → `{"prompt_id":"…","output":"SUMMER SALE 50% OFF","duration":4.39}`。
 */
function expectTextOutput(json: unknown): string[] {
  if (!isPlainObject(json)) return ['响应体不是 JSON 对象（拿不到文本结果）']
  if (!isFilled(json.output) && !isFilled(json.msg)) {
    return ['缺少文本结果：output 与 msg 均为空']
  }
  return []
}

/**
 * 健康检查。实测响应体恒为 `{"status":"ok"}`（两处留档：52ms / 34ms，200）。
 * 契约声明 `additionalProperties: string`（FastAPI 返回 dict[str,str]），故顺带校验值类型。
 */
function expectHealth(json: unknown): string[] {
  if (!isPlainObject(json)) return ['响应体不是 JSON 对象']
  const vals = Object.values(json)
  if (vals.length === 0) return ['健康检查返回空对象']
  const bad = vals.filter((v) => typeof v !== 'string').length
  if (bad > 0) return [`健康检查响应含 ${bad} 个非字符串值（契约声明 additionalProperties:string）`]
  if (json.status !== 'ok') return [`status 应为 "ok"，实际 ${JSON.stringify(json.status)}`]
  return []
}

// 生成类端点与文本类端点共用同一批断言函数，命名导出便于 verdict.ts 的单测复用。
export const EXPECT = {
  artifactUrl: expectArtifactUrl,
  uploadHandle: expectUploadHandle,
  textOutput: expectTextOutput,
  health: expectHealth,
} as const

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
    expect: EXPECT.health,
  },
  {
    id: 'txt2image',
    method: 'POST',
    path: '/api/v1/generate/txt2image',
    group: '文生图',
    title: '写实文生图',
    desc: 'POST /api/v1/generate/txt2image（Krea2 Turbo）。纯文生图，返回图片 URL。',
    fields: [
      { key: 'prompt', label: '提示词（由顶部「角色」驱动）', type: 'textarea', required: true, default: SAMPLES.txt2image, hint: '必须是单个人物；顶部选角色会自动填入。', characterDriven: true },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: IMG_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '736p' },
    ],
    buildBody: (v) => {
      const s = sizeFor(v.aspectRatio || '16:9', v.resolution || '736p')
      return { prompt: v.prompt, width: s.width, height: s.height }
    },
    expect: EXPECT.artifactUrl,
  },
  {
    id: 'txt2imageanime',
    method: 'POST',
    path: '/api/v1/generate/txt2imageanime',
    group: '文生图',
    title: '卡通文生图',
    desc: 'POST /api/v1/generate/txt2imageanime（仅纯文生图）。动漫画风。',
    fields: [
      { key: 'prompt', label: '提示词（由顶部「角色」驱动）', type: 'textarea', required: true, default: SAMPLES.txt2imageanime, hint: '动漫画风；同样必须是单个人物。', characterDriven: true },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: IMG_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '736p' },
    ],
    buildBody: (v) => {
      const s = sizeFor(v.aspectRatio || '16:9', v.resolution || '736p')
      return { prompt: v.prompt, width: s.width, height: s.height }
    },
    expect: EXPECT.artifactUrl,
  },
  {
    id: 'image2image',
    method: 'POST',
    path: '/api/v1/generate/image2image',
    group: '图生图',
    title: '图生图（最多 4 参考）',
    desc: 'POST /api/v1/generate/image2image（Krea2 Edit）。传句柄到 image1..image4；不传则为纯文生图。',
    fields: [
      { key: 'prompt', label: '提示词', type: 'textarea', required: true, default: SAMPLES.image2image },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: IMG_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '736p' },
      ...imageSlots(4, '上传句柄（来自「上传」或生成产物「转存」）。不收产品名(img_*/z-image_*)。'),
    ],
    buildBody: (v) => {
      const s = sizeFor(v.aspectRatio || '16:9', v.resolution || '736p')
      const body: Record<string, unknown> = { prompt: v.prompt, width: s.width, height: s.height }
      for (const k of ['image1', 'image2', 'image3', 'image4']) {
        if (v[k] && v[k].trim() !== '') body[k] = v[k].trim()
      }
      return body
    },
    expect: EXPECT.artifactUrl,
  },
  {
    id: 'image2fix',
    method: 'POST',
    path: '/api/v1/generate/image2fix',
    group: '图生图',
    title: '图内文字修复',
    desc: 'POST /api/v1/generate/image2fix（Boogu Edit）。prompt 只写文字部分；不收宽高。默认用例为中文：改近景广告牌文字，远景虚化文字须保持不变。',
    fields: [
      { key: 'prompt', label: '修复指令（中文优先，只写文字）', type: 'textarea', required: true, default: SAMPLES.image2fix, hint: '写明要改的字与要保持的项，并显式声明「远景模糊文字不要改动」——用来验证模型不会误改虚化文字。' },
      { key: 'filename', label: '要修复的图（句柄）', type: 'text', required: true, refKind: 'filename', hint: '上传句柄，不收产品名。基图须含远近景中文文字；点「准备参考图」可自动生成并填入。' },
    ],
    buildBody: (v) => ({ prompt: v.prompt, image: v.filename.trim() }),
    expect: EXPECT.artifactUrl,
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
    expect: EXPECT.artifactUrl,
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
    expect: EXPECT.uploadHandle,
  },
  {
    id: 'promptEnhance',
    method: 'POST',
    path: '/api/v1/generate/image2promptenhance',
    group: '工具',
    title: '提示词增强',
    desc: 'POST /api/v1/generate/image2promptenhance。返回增强后的提示词 {output}。',
    fields: [
      { key: 'prompt', label: '原始提示词', type: 'textarea', required: true, default: SAMPLES.promptEnhance },
    ],
    buildBody: (v) => ({ prompt: v.prompt }),
    expect: EXPECT.textOutput,
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
      { key: 'prompt', label: '分析提示词', type: 'textarea', required: true, default: SAMPLES.image2vlPrompt },
      { key: 'system_prompt', label: '系统提示词 system_prompt', type: 'text', required: true, default: SAMPLES.image2vlSystem, hint: '必填（下划线命名）。' },
    ],
    buildBody: (v) => ({ filename: v.filename.trim(), prompt: v.prompt, system_prompt: v.system_prompt }),
    expect: EXPECT.textOutput,
  },
  {
    id: 'videoFl2va',
    method: 'POST',
    path: '/api/v1/generate/image2videofl2va',
    group: '图生视频',
    title: '首尾帧 / 首帧视频',
    desc: 'POST /api/v1/generate/image2videofl2va。不传图为纯文生视频；image1=首帧；image1+image2=首尾帧插值。',
    fields: [
      { key: 'prompt', label: '提示词', type: 'textarea', required: true, default: SAMPLES.videoFl2va },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: VID_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '736p' },
      { key: 'duration', label: '时长(秒)', type: 'number', default: 5, hint: '默认 5，上限 15。' },
      ...imageSlots(2, 'image1=首帧；image1+image2=首尾帧。上传句柄。'),
    ],
    buildBody: (v) => {
      const body: Record<string, unknown> = {
        prompt: v.prompt,
        aspect: v.aspectRatio || '16:9',
        megapixels: MEGAPIXELS[v.resolution || '736p'] ?? 1.0,
        duration: Number(v.duration) || 5,
      }
      if (v.image1 && v.image1.trim() !== '') body.image1 = v.image1.trim()
      if (v.image2 && v.image2.trim() !== '') body.image2 = v.image2.trim()
      return body
    },
    expect: EXPECT.artifactUrl,
  },
  {
    id: 'videoRef2va',
    method: 'POST',
    path: '/api/v1/generate/image2videoref2va',
    group: '图生视频',
    title: '多参考图视频',
    desc: 'POST /api/v1/generate/image2videoref2va（最多 9 图 + 3 音频）。图多则角色/场景一致性更强。',
    fields: [
      { key: 'prompt', label: '提示词', type: 'textarea', required: true, default: SAMPLES.videoRef2va },
      { key: 'aspectRatio', label: '宽高比', type: 'select', options: VID_ASPECT, default: '16:9' },
      { key: 'resolution', label: '分辨率档位', type: 'select', options: RES_OPTIONS, default: '736p' },
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
        megapixels: MEGAPIXELS[v.resolution || '736p'] ?? 1.0,
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
    expect: EXPECT.artifactUrl,
  },
  {
    id: 'txt2audio',
    method: 'POST',
    path: '/api/v1/generate/txt2audio',
    group: '工具',
    title: '文生音频',
    desc: 'POST /api/v1/generate/txt2audio。后端必填 caption_prompt 与 lyrics_prompt（歌词可传空串）。',
    fields: [
      { key: 'caption_prompt', label: '音频描述 caption_prompt', type: 'textarea', required: true, default: SAMPLES.txt2audio, hint: '整体风格/氛围描述，如 calm ocean waves ambience。' },
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
    expect: EXPECT.artifactUrl,
  },
]

export function getEndpoint(id: string): EndpointDef | undefined {
  return ENDPOINTS.find((e) => e.id === id)
}

export const ENDPOINT_GROUPS: string[] = Array.from(new Set(ENDPOINTS.map((e) => e.group)))

/** 需要「参考句柄」才能跑的端点（批量测试时会自动前置生成图+上传）。 */
export const HANDLE_DEPENDENT: string[] = [
  'image2image',
  'image2character',
  'image2fix',
  'image2vl',
  'videoFl2va',
  'videoRef2va',
]

/** 视频类端点（慢，约 130–200s/次）。「仅快速」模式即排除它们。 */
export const VIDEO_ENDPOINTS: string[] = ['videoFl2va', 'videoRef2va']
