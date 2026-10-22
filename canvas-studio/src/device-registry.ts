/**
 * 设备标识（方案 P1，CV-355）：`$DSH_HOME/canvas-studio/device.json` 持久化 UUID v4。
 *
 * device_id 必须跨启动稳定，否则每次登录都会在服务端变成一台新设备（auth/sync 按
 * device_id upsert）。**路径固定在 DSH_HOME，不随设置页 assetDir 换库迁移** ——
 * 设备身份 ≠ 资产库位置（方案 P1 表格纪律）。文件损坏时重生成而不是 fail。
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export class DeviceRegistry {
  readonly #path: string
  readonly #appVersion: string
  #deviceId: string | null = null

  constructor(studioHomeDirectory: string, appVersion: string) {
    mkdirSync(studioHomeDirectory, { recursive: true })
    this.#path = join(studioHomeDirectory, 'device.json')
    this.#appVersion = appVersion
  }

  deviceId(): string {
    if (this.#deviceId !== null) return this.#deviceId
    const existing = this.#read()
    if (existing !== null) {
      this.#deviceId = existing
      return existing
    }
    const generated = randomUUID()
    this.#deviceId = generated
    this.#write(generated)
    return generated
  }

  appVersion(): string {
    return this.#appVersion
  }

  platform(): string {
    if (process.platform === 'win32') return 'windows'
    if (process.platform === 'darwin') return 'darwin'
    if (process.platform === 'linux') return 'linux'
    return 'unknown'
  }

  #read(): string | null {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#path, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null) {
        const value = (parsed as Record<string, unknown>)['deviceId']
        if (typeof value === 'string' && value.length > 0) return value
      }
      return null
    } catch {
      // 文件缺失/损坏（半写、手改坏）→ 重生成：设备身份丢了比启动失败更可接受。
      return null
    }
  }

  #write(deviceId: string): void {
    writeFileSync(this.#path, `${JSON.stringify({ deviceId }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
  }
}
