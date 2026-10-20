import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type {
  SessionEvent,
  SessionHeader,
  SessionLogOffset,
  SessionSeq,
} from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { contextBreakdownProjectionDefinition } from '../node_modules/@deepseek-ai/dsh-token-meter/lib/types/breakdown-projection.js'
import { contextPressureProjectionDefinition } from '../node_modules/@deepseek-ai/dsh-token-meter/lib/types/usage-projection.js'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(TokenMeter)
  return ctx
}

function replaceEvent(seq: number, start: number, end: number, text = '.'): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: 0,
    data: createUserMessage({
      content: [{ type: 'text', text }],
      // 0.2.1 删除了 `plugin` 这一 catch-all source kind；本 spec 只关心 surface
      // 折叠，两个投影都不读 source，所以用用户来源造事件即可。
      source: { kind: 'user' },
    }),
    surfaceOp: { op: 'replace', start: start as SessionSeq, end: end as SessionSeq },
    sourceEventSeqs: [start as SessionSeq, end as SessionSeq],
  } as unknown as SessionEvent
}

describe('token-meter negative projection recovery', () => {
  it('invalidates pre-fix negative checkpoint rows via stateVersion mismatch', async () => {
    const ctx = await harness()

    // 0.2.1 上游这两个单元的版本号已经前进（breakdown 6 / pressure 5），本仓库
    // 的负值修复 patch 尚未按新产物重做（P4-b）。断言改成「任何旧于当前版本的
    // checkpoint 都必须被丢弃」，语义与原 patch 的防线一致。
    expect(contextBreakdownProjectionDefinition.stateVersion).toBe(6)
    expect(contextPressureProjectionDefinition.stateVersion).toBe(5)

    const restored = ctx.sessionProjections.restore({
      contextBreakdown: {
        ver: 5,
        seq: 38_481 as never,
        val: {
          systems: [],
          surfaceTokens: -4840,
          breakdown: { systemTokens: 5640, toolsTokens: 11075, messageTokens: -4840 },
        },
      },
      contextPressure: {
        ver: 4,
        seq: 38_481 as never,
        val: {
          surfaceTokens: -4840,
          contextWindow: 1_000_000,
          pressureTokens: 89_773,
          sampledSurfaceTokens: 36_309,
        },
      },
    }, [], 0 as SessionLogOffset, {
      id: 'session-negative-projection',
      version: 0,
      createdAt: 1,
    } as unknown as SessionHeader, 0 as SessionLogOffset)

    expect(restored.snapshot.values.contextBreakdown).toEqual({
      systemTokens: 0,
      toolsTokens: 0,
      messageTokens: 0,
    })
    expect(restored.snapshot.values.contextPressure).toEqual({})
    expect(restored.checkpoint.contextBreakdown).toMatchObject({
      ver: 6,
      seq: -1,
      val: {
        systems: [],
        surfaceTokens: 0,
        breakdown: { systemTokens: 0, toolsTokens: 0, messageTokens: 0 },
      },
    })
    expect(restored.checkpoint.contextPressure).toMatchObject({
      ver: 5,
      seq: -1,
      val: { surfaceTokens: 0 },
    })
  })

  it('clamps drifted replacement deltas before they can persist negative state', () => {
    const replacement = replaceEvent(38482, 100, 200)

    const breakdown = contextBreakdownProjectionDefinition.apply({
      systems: [],
      surfaceTokens: 0,
      breakdown: { systemTokens: 5640, toolsTokens: 11075, messageTokens: 0 },
      claim: {
        start: 100 as SessionSeq,
        end: 200 as SessionSeq,
        tokens: 47_095,
        systemSeqs: [],
      },
    }, replacement)
    expect(breakdown.breakdown.messageTokens).toBe(0)

    const pressure = contextPressureProjectionDefinition.apply({
      surfaceTokens: 0,
      contextWindow: 1_000_000,
      pressureTokens: 89_773,
      sampledSurfaceTokens: 36_309,
      claim: { start: 100 as SessionSeq, end: 200 as SessionSeq, tokens: 47_095 },
    }, replacement)
    expect(pressure.surfaceTokens).toBe(0)
  })
})
