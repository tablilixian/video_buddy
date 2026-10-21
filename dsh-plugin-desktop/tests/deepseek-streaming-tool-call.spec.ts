import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { MessageId, type StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  DeepSeekAdapter,
  resolveAdapterOptions,
} from '@deepseek-ai/dsh-llm-deepseek'
import { afterEach, describe, expect, it, vi } from 'vitest'

function sseResponse(payloads: readonly unknown[]): Response {
  const body = payloads
    .map(payload => `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`)
    .join('')
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('DeepSeek streaming tool calls', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the streamed tool identity across partial JSON deltas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      // 0.2.1 的 DeepSeek Messages 协议：tool 身份只出现在 content_block_start，
      // 后续增量只带 input_json_delta —— 不再有「续传 delta 里的空 id/name」这种形状。
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'call_web_search',
          name: 'web_search',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"query":' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '"AI news today"}' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ])))

    const connection = resolveAdapterOptions({
      baseURL: 'https://example.test/v1',
      thinking: 'disabled',
    })
    const adapter = new DeepSeekAdapter({
      options: () => connection,
      // 0.2.1：适配器只接收请求快照派生出的凭据头，不再回读端点取 key。
      resolveAuth: async () => ({ headers: { authorization: 'Bearer test-key' } }),
      resolveUserId: () => 'test-user' as AnonymousUserId,
      // 本 spec 不覆盖插件扩展字段，按空扩展满足必填契约。
      prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
    })
    const chunks: StreamChunk[] = []

    for await (const chunk of adapter.stream({
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      messages: [{
        id: MessageId('message-user'),
        role: 'user',
        content: [{ type: 'text', text: 'Search today AI news' }],
        source: { kind: 'user' },
      }],
      tools: [{
        name: 'web_search',
        description: 'Search the web',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      }],
    })) chunks.push(chunk)

    const streamed = chunks.filter(chunk => chunk.type === 'tool-call-delta')
    expect(streamed).toHaveLength(3)
    expect(streamed[0]).toMatchObject({
      id: 'call_web_search',
      name: 'web_search',
      argumentsDelta: '',
    })
    expect(streamed.slice(1).map(chunk => (chunk as { id?: string }).id))
      .toEqual(['call_web_search', 'call_web_search'])

    expect(chunks.find(chunk => chunk.type === 'block-end')).toMatchObject({
      block: {
        type: 'tool-call',
        id: 'call_web_search',
        name: 'web_search',
        arguments: '{"query":"AI news today"}',
      },
    })
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind: 'tool-calls' },
    })
  })
})
