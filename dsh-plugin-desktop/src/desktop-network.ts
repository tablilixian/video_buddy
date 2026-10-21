/** Desktop ordinary-browser access and listener exposure preferences. */

import { networkInterfaces } from 'node:os'
import type { Config as WebServerConfig } from '@deepseek-ai/dsh-host-webserver'
import type { DesktopShellMode } from './runtime.ts'

/** Listener scope selected for the next Desktop generation. */
export type DesktopNetworkExposure = 'loopback' | 'lan'

/**
 * Parse the browser-access preference.
 *
 * `openBrowser` is retained as the persisted key for compatibility. Desktop
 * never projects it into the upstream default-browser handoff.
 */
export function parseDesktopOpenBrowser(value: unknown): boolean {
  if (value === undefined) return false
  if (typeof value === 'boolean') return value
  throw new Error('dsh-plugin-desktop: dsh-desktop.openBrowser must be a boolean')
}

/** Browser access can only be granted by an explicitly selected compatibility shell. */
export function desktopBrowserAccessAvailable(mode: DesktopShellMode): boolean {
  return mode === 'compatibility'
}

/**
 * Resolve browser access while preserving already-exposed legacy LAN setups
 * only when the selected shell is compatible with an ordinary browser.
 */
export function desktopBrowserAccessEnabled(
  mode: DesktopShellMode,
  storedOpenBrowser: boolean,
  exposure: DesktopNetworkExposure,
): boolean {
  return desktopBrowserAccessAvailable(mode) && (storedOpenBrowser || exposure === 'lan')
}

/** LAN exposure is meaningful only while ordinary-browser access is enabled. */
export function desktopNetworkExposureForBrowserAccess(
  browserAccess: boolean,
  exposure: DesktopNetworkExposure,
): DesktopNetworkExposure {
  return browserAccess ? exposure : 'loopback'
}

/** Parse the restart-applied listener exposure preference. */
export function parseDesktopNetworkExposure(value: unknown): DesktopNetworkExposure {
  if (value === undefined) return 'loopback'
  if (value === 'loopback' || value === 'lan') return value
  throw new Error('dsh-plugin-desktop: dsh-desktop.networkExposure must be "loopback" or "lan"')
}

/**
 * Project a persisted exposure preference into one concrete bind literal.
 *
 * 0.2.1 rejects the wildcard address, so LAN exposure binds the first
 * non-internal IPv4 interface instead of every interface at once.
 */
export function desktopWebServerHost(
  exposure: DesktopNetworkExposure,
  addresses: readonly string[] = desktopLanAddresses(),
): WebServerConfig['host'] {
  if (exposure === 'loopback') return '127.0.0.1'
  const address = addresses[0]
  if (address === undefined) {
    throw new Error('dsh-plugin-desktop: LAN exposure requires a concrete IPv4 interface')
  }
  return address
}

/** Marker-free URL suitable for an ordinary local browser. */
export function desktopLoopbackBrowserUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}/`
}

/** Marker-free URLs advertised for the Web runtime's startup-sampled LAN addresses. */
/**
 * Advertiseable LAN addresses of this host.
 *
 * 0.2.1 dropped the `webRuntime` service that used to publish these, so the
 * Desktop enumerates them itself. IPv4 only: a bare IPv6 literal needs brackets
 * inside the URL and `desktopLanBrowserUrls` interpolates the host verbatim.
 */
export function desktopLanAddresses(): readonly string[] {
  const addresses: string[] = []
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue
      addresses.push(entry.address)
    }
  }
  return Object.freeze(addresses)
}

export function desktopLanBrowserUrls(port: number, addresses: readonly string[]): readonly string[] {
  return Object.freeze(addresses.map(address => `http://${address}:${String(port)}/`))
}
