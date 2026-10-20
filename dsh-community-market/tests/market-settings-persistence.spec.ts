import type { Context } from '@deepseek-ai/cordis'
import { createVolatile, updateVolatile, type Volatile } from '@deepseek-ai/cosmokit'
import { describe, expect, it } from 'vitest'
import { DSH_1024STORE_ADAPTER_ID, DSH_1024STORE_PROVIDER_ID } from '../src/adapters/dsh-1024store.js'
import { SettingsCatalogSourceStore, type MarketSettingsDocument } from '../src/catalog/source-store.js'
import type { LocalSourceRecord } from '../src/contracts/index.js'
import { registerMarketSettings, type MarketSettingsConfigValue } from '../src/host/routes.js'

const source: LocalSourceRecord = {
  sourceRecordId: '018f1f77-a5c4-7b73-a9ae-0242ac120002',
  registrationKind: 'built-in',
  adapterId: DSH_1024STORE_ADAPTER_ID,
  providerId: DSH_1024STORE_PROVIDER_ID,
  builtInProviderKey: 'dsh-1024store',
  enabled: true,
  order: 0,
}

interface Mutation {
  readonly field: string
  readonly value: unknown
}

/** Minimal Context stand-in exposing only the surfaces `registerMarketSettings` touches. */
function fakeContext(config: Volatile<MarketSettingsDocument | undefined>) {
  const mutations: Mutation[] = []
  const ctx = {
    get: (name: string) => (name === 'loader' ? { locate: () => 'dsh-community-market' } : undefined),
    settings: {
      mutate: async (_ns: string, ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[]) => {
        for (const op of ops) {
          mutations.push({ field: op.path[0]!, value: op.value })
          updateVolatile(config, createVolatile({ ...config.get(), [op.path[0]!]: op.value }))
        }
      },
    },
  }
  return { ctx: ctx as unknown as Context, mutations, config: config as MarketSettingsConfigValue }
}

describe('community market settings store', () => {
  it('round-trips sources through the catalog source store', async () => {
    const { ctx, config } = fakeContext(createVolatile<MarketSettingsDocument | undefined>({ sources: [] }))
    const store = new SettingsCatalogSourceStore(registerMarketSettings(ctx, config))

    await store.save([source])
    expect(await store.load()).toEqual([{ ...source, enabled: true, order: 0 }])
  })

  it('persists sources via ctx.settings.mutate under the loader entry id', async () => {
    const { ctx, config, mutations } = fakeContext(createVolatile<MarketSettingsDocument | undefined>({ sources: [] }))
    const scope = registerMarketSettings(ctx, config)

    await scope.update({ sources: [source] })
    expect(mutations).toEqual([{ field: 'sources', value: [source] }])
    expect(scope.get()).toEqual({ sources: [source] } satisfies MarketSettingsDocument)
  })

  it('falls back to an empty source list when the config is unset', () => {
    const { ctx, config } = fakeContext(createVolatile<MarketSettingsDocument | undefined>(undefined))
    expect(registerMarketSettings(ctx, config).get()).toEqual({ sources: [] })
  })
})
