#!/usr/bin/env node
/**
 * L6 真实链路端到端（方案「验证链与收尾」，不在 CI）：
 *   真实 Supabase token 跑通 auth/sync → /v1/models?modality=text → 一次 /v1/llm/chat/completions。
 *
 * 用法：
 *   DRAMA_ACCESS_TOKEN=<supabase access token> node scripts/live-e2e-management.mjs
 * 可选：DRAMA_BUSINESS_BASE（默认 http://117.50.108.73）、DRAMA_LIVE_MODEL（默认 deepseek-flash）。
 *
 * token 获取：桌面端登录后，从客户端 localStorage（supabase.auth.getSession()
 * 的 access_token）复制；或 `curl -s 'https://rotkecckjazdfujgacvb.supabase.co/auth/v1/token?grant_type=refresh_token' ...`。
 * 脚本不落盘 token，只进内存与请求头。
 */
import { randomUUID } from 'node:crypto'

const BASE = (process.env.DRAMA_BUSINESS_BASE ?? 'http://117.50.108.73').replace(/\/+$/, '')
const TOKEN = process.env.DRAMA_ACCESS_TOKEN ?? ''
const MODEL = process.env.DRAMA_LIVE_MODEL ?? 'deepseek-flash'

if (TOKEN.length === 0) {
  console.error('缺少 DRAMA_ACCESS_TOKEN（Supabase access token，桌面端登录后获取）')
  process.exit(1)
}

const step = async (label, run) => {
  process.stdout.write(`\n== ${label}\n`)
  try {
    return await run()
  } catch (error) {
    console.error(`✗ ${label} 失败：${error.message}`)
    process.exit(1)
  }
}

const request = async (path, init = {}) => {
  const response = await fetch(BASE + path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', ...(init.headers ?? {}) },
  })
  const bodyText = await response.text()
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${bodyText.slice(0, 300)}`)
  }
  return bodyText.length === 0 ? undefined : JSON.parse(bodyText)
}

await step('POST /v1/auth/sync（用户同步 + 设备登记）', async () => {
  const body = await request('/v1/auth/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ device: { device_id: `live-e2e-${randomUUID().slice(0, 8)}`, name: 'VideoBuddy LiveE2E', platform: 'darwin', app_version: 'live' } }),
  })
  console.log(`  user.id = ${body.user?.id}  status = ${body.user?.status}`)
})

const models = await step('GET /v1/models?modality=text', async () => {
  const body = await request('/v1/models?modality=text')
  const list = body.models ?? []
  console.log(`  共 ${list.length} 个 text 模型：${list.map((m) => m.code).join(', ')}`)
  return list
})

if (models.length === 0) {
  console.error('\n✗ 目录为空：无 text 模型可用，中止 LLM 调用（前置步骤已通过）。')
  process.exit(2)
}
if (!models.some((m) => m.code === MODEL && m.available !== false)) {
  console.error(`\n✗ 目录里没有可用模型 ${MODEL}，改用：${models.find((m) => m.available !== false)?.code}`)
}

await step(`POST /v1/llm/chat/completions（模型 ${MODEL}）`, async () => {
  const body = await request('/v1/llm/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: '用一个短句回答：连通性验证成功了吗？' }],
      max_tokens: 64,
    }),
  })
  const content = body.choices?.[0]?.message?.content
  console.log(`  回复：${typeof content === 'string' ? content.slice(0, 200) : JSON.stringify(body).slice(0, 300)}`)
})

console.log('\n✅ L6 真实链路全部通过：sync → models → /v1/llm/chat/completions')
