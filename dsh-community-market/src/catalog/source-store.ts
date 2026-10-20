import type { CatalogSnapshot } from '../contracts/generated/catalog-snapshot.js'
import { validateLocalSourceRecords } from '../contracts/validate.js'
import type { CatalogSourceStore, LocalSourceRecord } from '../contracts/types.js'

export interface MarketCatalogCache {
  readonly version: 1
  readonly sourceRecordId: string
  readonly locale: string
  readonly savedAt: string
  readonly snapshot: CatalogSnapshot
  readonly categories: readonly string[]
  readonly scannedAt: string
  readonly expiresAt: string
  readonly providerRevision?: string
}

export interface MarketSettingsDocument {
  readonly sources: readonly LocalSourceRecord[]
  readonly catalogCache?: MarketCatalogCache
}

/**
 * Minimal settings-store contract the catalog source store depends on.
 *
 * 0.2.1 起 `@deepseek-ai/dsh-settings` 不再导出 `SettingsScope`：插件配置改由 Loader
 * 注入的 Config（对象级 volatile）+ `ctx.settings.mutate` 读写。此处只保留本包所需的
 * 读写面，由 Host 侧 `registerMarketSettings` 实现，从而与 dsh-settings 解耦。
 */
export interface MarketSettingsStore {
  get(): MarketSettingsDocument
  update(patch: Partial<MarketSettingsDocument>): Promise<void>
}

/**
 * Reconcile legacy multi-enabled settings into the single active-source model.
 * The first enabled record by user order wins. An all-disabled registry keeps
 * its explicit no-selection state.
 */
export function normalizeActiveSourceRecords(
  records: readonly LocalSourceRecord[],
): readonly LocalSourceRecord[] {
  const ordered = [...records].sort((left, right) => left.order - right.order)
  const activeSourceRecordId = ordered.find(record => record.enabled)?.sourceRecordId
  return ordered.map(record => ({
    ...record,
    enabled: record.sourceRecordId === activeSourceRecordId,
  }))
}

export class SettingsCatalogSourceStore implements CatalogSourceStore {
  constructor(private readonly scope: MarketSettingsStore) {}

  async load(): Promise<readonly LocalSourceRecord[]> {
    const records = [...this.scope.get().sources]
    validateLocalSourceRecords(records)
    return normalizeActiveSourceRecords(records)
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    await this.scope.update({ sources: normalized })
  }
}

export class MemoryCatalogSourceStore implements CatalogSourceStore {
  private records: readonly LocalSourceRecord[] = []

  async load(): Promise<readonly LocalSourceRecord[]> {
    return this.records
  }

  async save(records: readonly LocalSourceRecord[]): Promise<void> {
    const normalized = normalizeActiveSourceRecords(records)
    validateLocalSourceRecords(normalized)
    this.records = normalized.map(record => ({ ...record }))
  }
}
