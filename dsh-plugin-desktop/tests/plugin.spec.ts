import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type { LocaleId } from '@deepseek-ai/dsh-client-locale'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  Config,
  DESKTOP_SETTINGS_NAMESPACE,
  desktopRendererUrl,
  DesktopSettingsSchema,
  inject,
  type Config as DesktopConfig,
  type DesktopSettings,
} from '../src/index.ts'
import {
  DESKTOP_DIRECTORY_PICKER_PATH,
  DESKTOP_DIRECTORY_VALIDATOR_PATH,
} from '../src/directory-picker-contract.ts'
import type { DesktopRuntime, DesktopShellSpec } from '../src/runtime.ts'
import { createDesktopBrowserAccess } from '../src/desktop-browser-access.ts'
import { RENDERER_BOOT_REPORT_PATH, type RendererBootReport } from '../src/renderer-boot-contract.ts'

/** Loader entry id the desktop shell's settings are keyed by in 0.2.1. */
const DESKTOP_SETTINGS_ENTRY_ID = 'desktop-shell'

const config: DesktopConfig = {
  mode: 'compatibility',
  macosMaterial: 'transparent',
  windowsMaterial: 'acrylic',
  port: 43_120,
  networkExposure: 'loopback',
  openBrowser: false,
  logLevel: 'info',
  width: 1280,
  height: 840,
  minWidth: 900,
  minHeight: 640,
}

/**
 * dsh 0.2.1 hands a plugin its editable fields as one `Volatile` reference
 * instead of a registered settings scope, so a "settings change" in these tests
 * is a write into this backing state followed by the `loader/volatile-update`
 * event the Loader raises on the owning fiber.
 */
interface ConfigFixture {
  readonly ref: Volatile<DesktopConfig | undefined>
  write(next: Partial<DesktopSettings>): void
  read(): DesktopConfig
}

function configFixture(initial: DesktopConfig): ConfigFixture {
  let state = initial
  return {
    ref: { get: () => state },
    write(next) { state = { ...state, ...next } },
    read: () => state,
  }
}

afterEach(() => { vi.useRealTimers() })

interface PluginHarness {
  ctx: Context
  /** Live configuration reference the plugin now receives instead of a scope. */
  configRef: Volatile<DesktopConfig | undefined>
  runtime: DesktopRuntime
  shell(): DesktopShellSpec | undefined
  update: ReturnType<typeof vi.fn<(entryId: unknown, patch: Partial<DesktopSettings>) => Promise<void>>>
  restart: ReturnType<typeof vi.fn<() => Promise<void>>>
  setLocalePreference: ReturnType<typeof vi.fn<(locale: LocaleId | undefined) => void>>
  setThemeSource: ReturnType<typeof vi.fn<(source: ThemePreference) => void>>
  rendererBoot: ReturnType<typeof vi.fn<(report: RendererBootReport) => void>>
  pickDirectory: ReturnType<typeof vi.fn<() => Promise<string | null>>>
  validateDirectory: ReturnType<typeof vi.fn<(path: string) => Promise<boolean>>>
  route(path: string): WebRoute | undefined
  /** Write a live preference edit and raise the Loader's volatile update. */
  notify(next: Partial<DesktopSettings>, prev?: DesktopSettings): Promise<void>
  notifyLocale(preference: LocaleId | undefined): void
  notifyTheme(preference: ThemePreference): void
  /** Run a candidate configuration through the `internal/config` waterfall. */
  validate(candidate: DesktopSettings): void
}

function createHarness(
  platform: DesktopRuntime['platform'] = 'darwin',
  ordinaryBrowserEnabled = false,
  overrides: Partial<DesktopSettings> = {},
): PluginHarness {
  let shell: DesktopShellSpec | undefined
  const fixture = configFixture({ ...config, openBrowser: ordinaryBrowserEnabled, ...overrides })
  const volatileUpdated = new Set<() => void | Promise<void>>()
  const documentUpdated = new Set<(namespace: unknown, revision: number) => void>()
  const configWaterfall = new Set<(this: unknown, raw: unknown, next: () => unknown) => unknown>()
  const update = vi.fn(async (_entryId: unknown, _patch: Partial<DesktopSettings>) => {})
  const restart = vi.fn(async () => {})
  const setLocalePreference = vi.fn<(locale: LocaleId | undefined) => void>()
  const setThemeSource = vi.fn<(source: ThemePreference) => void>()
  const rendererBoot = vi.fn<(report: RendererBootReport) => void>()
  const pickDirectory = vi.fn(async () => null)
  const validateDirectory = vi.fn(async () => true)
  const routes = new Map<string, WebRoute>()
  let localePreference: LocaleId | undefined
  let themePreference: ThemePreference = 'system'
  const browserAccess = createDesktopBrowserAccess(
    ordinaryBrowserEnabled,
    Buffer.alloc(32, 6).toString('base64url'),
  )
  const runtime: DesktopRuntime = {
    platform,
    windowsBuild: platform === 'win32' ? 22_631 : undefined,
    locale: 'en',
    updates: {
      isPackaged: false,
      canDownload: platform === 'darwin' || platform === 'win32',
      currentVersion: '2.0.0',
      statePath: '/tmp/dsh-desktop-update-state.json',
      request: async () => new Response(null, { status: 304 }),
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      downloadAndOpen: async () => {},
      notify: () => {},
    },
    schedule: (spec) => {
      shell = spec
      return async () => {}
    },
    mountScheduled: async () => {},
    show: () => {},
    notifyAttention: () => {},
    registerTrayItem: () => ({ refresh: () => {}, dispose: () => {} }),
    openTerminal: () => {},
    reloadRenderer: () => {},
    toggleDeveloperTools: () => {},
    exportDiagnostics: async () => {},
    pickDirectory,
    validateDirectory,
    openProfileCreateWindow: () => {},
    reportRendererBoot: rendererBoot,
    setLocalePreference,
    setThemeSource,
    requestRestart: restart,
    requestRecoveryRestart: restart,
    prepareToQuit: () => {},
  }
  // 0.2.1 keeps no plugin-owned settings scope: the editable fields are the
  // plugin's Config, and the standard service is only read for the built-in
  // namespaces the tray projects (theme / locale).
  const settings = {
    describe: vi.fn(() => [
      { ns: 'ui-theme', value: { preference: themePreference } },
      { ns: 'locale', value: { preference: localePreference } },
    ]),
    update,
    configure: vi.fn(() => () => {}),
  }
  const fiber = { id: DESKTOP_SETTINGS_ENTRY_ID }
  const ctx = {
    fiber,
    desktopRuntime: runtime,
    webServer: {
      host: '127.0.0.1',
      port: 43120,
      register: vi.fn((route: WebRoute) => {
        routes.set(route.path, route)
        return () => { if (routes.get(route.path) === route) routes.delete(route.path) }
      }),
    },
    settings,
    logger: { warn: vi.fn(), error: vi.fn() },
    get: vi.fn((key: unknown) => {
      if (String(key) === 'desktopRuntime') return runtime
      if (String(key) === 'desktopBrowserAccess') return browserAccess
      if (String(key) === 'settings') return settings
      if (String(key) === 'loader') return { locate: () => DESKTOP_SETTINGS_ENTRY_ID }
      return () => {}
    }),
    effect: vi.fn((register: () => unknown) => register()),
    on: vi.fn((event: string, listener: (...args: never[]) => unknown) => {
      if (event === 'settings/document-updated') {
        const slot = listener as (namespace: unknown, revision: number) => void
        documentUpdated.add(slot)
        return () => { documentUpdated.delete(slot) }
      }
      if (event === 'loader/volatile-update') {
        const slot = listener as () => void
        volatileUpdated.add(slot)
        return () => { volatileUpdated.delete(slot) }
      }
      if (event === 'internal/config') {
        const waterfall = listener as unknown as (this: unknown, raw: unknown, next: () => unknown) => unknown
        configWaterfall.add(waterfall)
        return () => { configWaterfall.delete(waterfall) }
      }
      return () => {}
    }),
  } as unknown as Context
  return {
    ctx,
    configRef: fixture.ref,
    runtime,
    shell: () => shell,
    update,
    restart,
    setLocalePreference,
    setThemeSource,
    rendererBoot,
    pickDirectory,
    validateDirectory,
    route: path => routes.get(path),
    notify: async (next) => {
      fixture.write(next)
      for (const listener of [...volatileUpdated]) await listener()
    },
    notifyLocale: (preference) => {
      localePreference = preference
      for (const listener of documentUpdated) listener('locale', 1)
    },
    notifyTheme: (preference) => {
      themePreference = preference
      for (const listener of documentUpdated) listener('ui-theme', 1)
    },
    validate: (candidate) => {
      for (const waterfall of configWaterfall) waterfall.call(fiber, candidate, () => candidate)
    },
  }
}

describe('desktop Host plugin', () => {
  it('defaults to compatibility mode and validates both schemas', () => {
    expect(Config({} as DesktopConfig)).toEqual(config)
    expect(Config({ mode: 'advanced' } as DesktopConfig)).toEqual({ ...config, mode: 'advanced' })
    expect(DesktopSettingsSchema({} as DesktopSettings)).toEqual({
      mode: 'compatibility',
      macosMaterial: 'transparent',
      windowsMaterial: 'acrylic',
      port: 43_120,
      openBrowser: false,
      networkExposure: 'loopback',
      logLevel: 'info',
    })
    expect(() => DesktopSettingsSchema({ port: -1 } as DesktopSettings)).toThrow()
    expect(() => DesktopSettingsSchema({ port: 1.5 } as DesktopSettings)).toThrow()
    expect(() => DesktopSettingsSchema({ port: 65_536 } as DesktopSettings)).toThrow()
    expect(() => Config({ mode: 'custom' } as never)).toThrow()
    expect(String(DESKTOP_SETTINGS_NAMESPACE)).toBe('dsh-desktop')
  })

  it('prints a launcher reminder and registers nothing without desktopRuntime', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const registerRoute = vi.fn()
    const ctx = {
      webServer: { host: '127.0.0.1', port: 43120, register: registerRoute },
      settings: {
        describe: vi.fn(() => []),
        configure: vi.fn(),
        update: vi.fn(async () => {}),
      },
      logger: { warn: vi.fn(), error: vi.fn() },
      get: vi.fn(() => undefined),
      effect: vi.fn((register: () => unknown) => register()),
      on: vi.fn(() => () => {}),
    } as unknown as Context

    apply(ctx, { get: () => config })

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('desktop launcher'))
    expect(registerRoute).not.toHaveBeenCalled()
    expect(vi.mocked(ctx.settings.configure)).not.toHaveBeenCalled()
    stderr.mockRestore()
  })

  it('builds the loopback root with validated renderer mode and platform markers', () => {
    const url = new URL(desktopRendererUrl(43120, 'advanced', 'darwin', '2.0.3'))
    expect(url.origin).toBe('http://127.0.0.1:43120')
    expect(url.pathname).toBe('/')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'dsh-desktop-mode': 'advanced',
      'dsh-desktop-platform': 'darwin',
      'dsh-desktop-version': '2.0.3',
      'dsh-desktop-material': 'off',
    })
    expect(Object.fromEntries(new URL(desktopRendererUrl(
      43120,
      'extended',
      'win32',
      '2.0.3',
      'mica',
      22_631,
    )).searchParams)).toEqual({
      'dsh-desktop-mode': 'extended',
      'dsh-desktop-platform': 'win32',
      'dsh-desktop-version': '2.0.3',
      'dsh-desktop-material': 'mica',
      'dsh-desktop-titlebar-inset': '36',
      'dsh-desktop-mica': '1',
    })
    expect(Object.fromEntries(new URL(desktopRendererUrl(
      43120,
      'compatibility',
      'linux',
      '2.0.3',
    )).searchParams)).not.toHaveProperty('dsh-desktop-titlebar-inset')
  })

  it('publishes the settings policy and the active Web port without re-entering Loader settlement', async () => {
    const harness = createHarness()
    const loaderAwait = vi.fn(() => new Promise<void>(() => {}))
    Object.assign(harness.ctx, { loader: { await: loaderAwait } })

    apply(harness.ctx, harness.configRef)

    expect(inject).toContain('settings')
    expect(inject).not.toContain('loader')
    // 0.2.1: the editable fields are this plugin's Config, so the plugin no
    // longer registers a scope. It hands the entry to the standard settings
    // page with `auto: false` (Desktop owns its own presentation) and writes
    // through `update(entryId, patch)` keyed by the Loader entry.
    const configure = vi.mocked(harness.ctx.settings.configure)
    expect(configure).toHaveBeenCalledWith({ auto: false }, harness.ctx.fiber)
    expect(loaderAwait).not.toHaveBeenCalled()
    expect(harness.shell()).toEqual(expect.objectContaining({
      mode: 'compatibility',
      url: 'http://127.0.0.1:43120/?dsh-desktop-mode=compatibility&dsh-desktop-platform=darwin&dsh-desktop-version=2.0.0&dsh-desktop-material=transparent&dsh-desktop-titlebar-inset=36',
      productName: 'VideoBuddy',
      windowTitle: 'VideoBuddy',
      rendererAccessHeader: {
        name: 'x-dsh-desktop-renderer',
        value: Buffer.alloc(32, 6).toString('base64url'),
      },
      readThemeSource: expect.any(Function),
    }))
    expect(harness.shell()?.iconPath.endsWith(join('build', 'app-icon-mac.png'))).toBe(true)
    expect(harness.shell()?.trayIcons.templatePath.endsWith(join('build', 'tray-iconTemplate.png'))).toBe(true)
    expect(harness.shell()?.trayIcons.bluePath.endsWith(join('build', 'tray-icon-blue.png'))).toBe(true)
    expect(harness.shell()?.readThemeSource()).toBe('system')
    harness.notifyTheme('dark')
    expect(harness.setThemeSource).toHaveBeenCalledWith('dark')

    await harness.shell()?.requestModeChange('advanced')
    expect(harness.update).toHaveBeenCalledWith(DESKTOP_SETTINGS_ENTRY_ID, { mode: 'advanced' })
  })

  it('atomically withdraws browser access when the native tray selects a custom mode', async () => {
    const harness = createHarness('darwin', true)
    apply(harness.ctx, harness.configRef)

    await harness.shell()?.requestModeChange('advanced')

    expect(harness.update).toHaveBeenCalledWith(DESKTOP_SETTINGS_ENTRY_ID, {
      mode: 'advanced',
      openBrowser: false,
      networkExposure: 'loopback',
    })
  })

  it('forwards same-origin renderer boot reports through the Host route', async () => {
    const harness = createHarness()
    apply(harness.ctx, harness.configRef)
    const route = harness.route(RENDERER_BOOT_REPORT_PATH)
    expect(route).toEqual(expect.objectContaining({
      kind: 'exact',
      path: RENDERER_BOOT_REPORT_PATH,
    }))
    const report = { status: 'failed', plugins: ['dsh-vision-router'], error: 'slot conflict' } as const
    const req = {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:43120',
        'content-type': 'application/json',
      },
      async * [Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(report)) },
    } as unknown as IncomingMessage
    const res = { statusCode: 200, end: vi.fn() } as unknown as ServerResponse

    await route?.handler(req, res)

    expect(harness.rendererBoot).toHaveBeenCalledWith(report)
    expect(res.statusCode).toBe(204)
  })

  it('serves the Windows native picker through a same-origin desktop route', async () => {
    const harness = createHarness('win32')
    harness.pickDirectory.mockResolvedValue('C:\\Work')
    apply(harness.ctx, harness.configRef)
    const route = harness.route(DESKTOP_DIRECTORY_PICKER_PATH)
    expect(route).toEqual(expect.objectContaining({
      kind: 'exact',
      path: DESKTOP_DIRECTORY_PICKER_PATH,
    }))
    const req = {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:43120' },
    } as unknown as IncomingMessage
    let body = ''
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn((value?: string) => { body = value ?? '' }),
    } as unknown as ServerResponse

    await route?.handler(req, res)

    expect(harness.pickDirectory).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body)).toEqual({ path: 'C:\\Work' })
  })

  it('validates a Windows workspace through a same-origin desktop route', async () => {
    const harness = createHarness('win32')
    harness.validateDirectory.mockResolvedValue(false)
    apply(harness.ctx, harness.configRef)
    const route = harness.route(DESKTOP_DIRECTORY_VALIDATOR_PATH)
    const req = {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:43120',
        'content-type': 'application/json',
      },
      async * [Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ path: 'E:\\repo' })) },
    } as unknown as IncomingMessage
    let body = ''
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      end: vi.fn((value?: string) => { body = value ?? '' }),
    } as unknown as ServerResponse

    await route?.handler(req, res)

    expect(harness.validateDirectory).toHaveBeenCalledWith('E:\\repo')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body)).toEqual({ allowed: false })
  })

  it.each(['win32', 'linux'] as const)(
    'keeps the full-size application icon on %s',
    (platform) => {
      const harness = createHarness(platform)

      apply(harness.ctx, harness.configRef)

      expect(harness.shell()?.iconPath.endsWith(join('build', 'app-icon.png'))).toBe(true)
    },
  )

  it('requests one orderly restart after the settings scope commits another mode', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, harness.configRef)

    await harness.notify(
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'info' },
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'info' },
    )
    expect(harness.restart).not.toHaveBeenCalled()

    harness.restart.mockImplementation(() => new Promise<void>(() => {}))
    await harness.notify(
      { mode: 'advanced', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'info' },
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'info' },
    )
    await vi.runAllTimersAsync()
    expect(harness.restart).toHaveBeenCalledOnce()
  })

  it('restarts when browser access changes and when a custom mode withdraws stale access', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, harness.configRef)
    harness.restart.mockImplementation(() => new Promise<void>(() => {}))

    await harness.notify(
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 43_120, openBrowser: true, networkExposure: 'loopback', logLevel: 'info' },
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 43_120, openBrowser: false, networkExposure: 'loopback', logLevel: 'info' },
    )
    await vi.runAllTimersAsync()
    expect(harness.restart).toHaveBeenCalledOnce()

    const enabledHarness = createHarness('darwin', true)
    apply(enabledHarness.ctx, enabledHarness.configRef)
    await enabledHarness.notify(
      { mode: 'advanced', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 43_120, openBrowser: true, networkExposure: 'loopback', logLevel: 'info' },
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 43_120, openBrowser: true, networkExposure: 'loopback', logLevel: 'info' },
    )
    await vi.runAllTimersAsync()
    expect(enabledHarness.restart).toHaveBeenCalledOnce()
  })

  it('requests one orderly restart after the configured Web port changes', async () => {
    vi.useFakeTimers()
    const harness = createHarness()
    apply(harness.ctx, harness.configRef)

    await harness.notify(
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'debug' },
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'info' },
    )
    expect(harness.restart).not.toHaveBeenCalled()

    harness.restart.mockImplementation(() => new Promise<void>(() => {}))
    await harness.notify(
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 43_189, openBrowser: false, networkExposure: 'loopback', logLevel: 'debug' },
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'debug' },
    )
    await vi.runAllTimersAsync()
    expect(harness.restart).toHaveBeenCalledOnce()
  })

  it('requests one orderly restart after the native material changes', async () => {
    vi.useFakeTimers()
    const harness = createHarness('win32')
    apply(harness.ctx, harness.configRef)

    harness.restart.mockImplementation(() => new Promise<void>(() => {}))
    await harness.notify(
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'mica', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'info' },
      { mode: 'compatibility', macosMaterial: 'transparent', windowsMaterial: 'acrylic', port: 0, openBrowser: false, networkExposure: 'loopback', logLevel: 'info' },
    )
    await vi.runAllTimersAsync()

    expect(harness.restart).toHaveBeenCalledOnce()
  })

  it('projects live built-in theme changes into an advanced native material', () => {
    const harness = createHarness('darwin', false, { mode: 'advanced' })
    apply(harness.ctx, harness.configRef)

    expect(harness.shell()?.readThemeSource()).toBe('system')
    harness.notifyTheme('dark')
    expect(harness.setThemeSource).toHaveBeenCalledWith('dark')
  })

  it('projects the Host-backed locale preference into the native tray', () => {
    const harness = createHarness('win32')
    apply(harness.ctx, harness.configRef)

    expect(harness.shell()?.readLocalePreference()).toBeUndefined()
    expect(harness.setLocalePreference).not.toHaveBeenCalled()

    harness.notifyLocale('zh')
    expect(harness.shell()?.readLocalePreference()).toBe('zh')
    expect(harness.setLocalePreference).toHaveBeenCalledWith('zh')

    harness.notifyLocale(undefined)
    expect(harness.setLocalePreference).toHaveBeenLastCalledWith(undefined)
  })

  it('requires the Web carrier host to match the configured exposure', () => {
    const harness = createHarness()
    Object.assign(harness.ctx.webServer, { host: '0.0.0.0' })

    expect(() => apply(harness.ctx, harness.configRef)).toThrow('does not match networkExposure')

    expect(() => apply(harness.ctx, { get: () => ({ ...config, networkExposure: 'lan' }) })).not.toThrow()
  })

  it('validates the effective Linux mode while a browser migration is deferred', () => {
    const harness = createHarness('linux')
    apply(harness.ctx, harness.configRef)

    const settings: DesktopSettings = {
      mode: 'compatibility',
      macosMaterial: 'transparent',
      windowsMaterial: 'acrylic',
      port: 43_120,
      openBrowser: false,
      networkExposure: 'loopback',
      logLevel: 'info',
    }
    // 0.2.1 moved this guard from `settings.register({ validate })` onto the
    // Loader's `internal/config` waterfall: the plugin rejects an impossible
    // combination before the committed configuration changes.
    expect(() => harness.validate({ ...settings, mode: 'advanced' })).toThrow(
      'supported on macOS and Windows',
    )
    expect(() => harness.validate({ ...settings, mode: 'extended' })).toThrow(
      'supported on macOS and Windows',
    )
    expect(() => harness.validate({ ...settings, mode: 'compatibility' })).not.toThrow()
    expect(() => harness.validate({
      ...settings,
      mode: 'advanced',
      openBrowser: true,
    })).toThrow('browser and LAN access require compatibility mode')
    expect(() => harness.validate({
      ...settings,
      mode: 'advanced',
      networkExposure: 'lan',
    })).toThrow('browser and LAN access require compatibility mode')
  })
})
