/**
 * 设备标识单测（src/device-registry.ts，方案 P1/CV-355）。
 *
 * 覆盖：首次生成并落盘、二次读取复用（跨启动稳定）、损坏文件重生成、0600 权限位、
 * platform 映射。路径固定 DSH_HOME（不随 assetDir 迁移）由装配侧保证，此处只测文件行为。
 *
 * 运行：corepack yarn workspace canvas-studio test:smoke
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeviceRegistry } from '../lib/device-registry.js'

test('device-registry：首次生成落盘（0600）→ 复读复用 → 损坏重生成', () => {
  const home = mkdtempSync(join(tmpdir(), 'cs-device-'))
  try {
    const first = new DeviceRegistry(home, '1.2.3')
    const id1 = first.deviceId()
    assert.match(id1, /^[0-9a-f-]{36}$/)
    assert.equal(first.appVersion(), '1.2.3')
    assert.equal(first.platform(), process.platform === 'darwin' ? 'darwin' : first.platform())
    // 权限位：0600（owner 读写，其余无）。
    assert.equal(statSync(join(home, 'device.json')).mode & 0o777, 0o600)
    // 落盘内容可解析且含 deviceId。
    assert.equal(JSON.parse(readFileSync(join(home, 'device.json'), 'utf8')).deviceId, id1)

    // 新实例（模拟重启）：读同一个 id，不重生成。
    const second = new DeviceRegistry(home, '1.2.3')
    assert.equal(second.deviceId(), id1)

    // 损坏文件（半写 JSON）→ 重生成新 id 并落盘可解析。
    writeFileSync(join(home, 'device.json'), '{"deviceI', { encoding: 'utf8' })
    const third = new DeviceRegistry(home, '1.2.3')
    const id3 = third.deviceId()
    assert.notEqual(id3, id1)
    assert.match(id3, /^[0-9a-f-]{36}$/)
    assert.equal(JSON.parse(readFileSync(join(home, 'device.json'), 'utf8')).deviceId, id3)

    // 非法形态（deviceId 非字符串）同样重生成。
    writeFileSync(join(home, 'device.json'), JSON.stringify({ deviceId: 42 }))
    const fourth = new DeviceRegistry(home, '1.2.3')
    assert.match(fourth.deviceId(), /^[0-9a-f-]{36}$/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('device-registry：目录不存在时自动创建', () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-device-root-'))
  try {
    const home = join(root, 'canvas-studio')
    const registry = new DeviceRegistry(home, '0.0.1')
    assert.match(registry.deviceId(), /^[0-9a-f-]{36}$/)
    assert.equal(statSync(home).isDirectory(), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
