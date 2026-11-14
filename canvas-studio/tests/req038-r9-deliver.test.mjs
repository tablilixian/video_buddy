/**
 * REQ-038 R9-P1（#18/#2）· **权威交付路径**单测。
 *
 * 四条纪律必须同时成立：
 * ① **单一权威路径** —— deliver/final.mp4 覆盖写（不留 final-vN 家族）+ card.json 字段齐全；
 * ② **时长断言** —— |actual − target| > 1s 标 durationMismatch（混规格显性化，不拒收）；
 * ③ **handoff 倒逼** —— 未决项空 ⇒ deliveredWithGaps + 「（未填）」占位（不加审批门）；
 * ④ **渲染不陪葬** —— 写盘失败返回 written:false + note，绝不抛错。
 *
 * 直连 Host tsc 编译产物（临时目录，不碰真项目）。定向跑：node --test tests/req038-r9-deliver.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  DELIVER_DURATION_TOLERANCE_SEC,
  deliveryReceiptLines,
  isDeliverableRender,
  writeDeliverable,
} from '../lib/deliverable.js'

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'r9-deliver-'))
  // 伪成片源文件（内容不重要，能校验复制即可）
  writeFileSync(join(dir, 'source.mp4'), 'fake-mp4-bytes', 'utf8')
  return dir
}

function baseInput(dir, overrides = {}) {
  return {
    projectDir: dir,
    sourceFile: join(dir, 'source.mp4'),
    url: '/canvas-studio/assets/p/x.mp4',
    assetFile: 'x.mp4',
    nodeId: 'node-1',
    durationSec: 45.1,
    width: 1920,
    height: 1080,
    fps: 30,
    quality: 'standard',
    manifestHash: createHash('sha256').update('{}').digest('hex').slice(0, 16),
    anchorVersion: 3,
    targetDurationSec: 45,
    openIssues: '音色未锁',
    now: 1794620546663,
    ...overrides,
  }
}

test('定稿输入：final.mp4 复制 + card.json 字段齐全（时长断言通过）', () => {
  const dir = fixtureDir()
  const result = writeDeliverable(baseInput(dir))
  assert.equal(result.written, true)
  assert.equal(existsSync(join(dir, 'deliver', 'final.mp4')), true)
  assert.equal(readFileSync(join(dir, 'deliver', 'final.mp4'), 'utf8'), 'fake-mp4-bytes', '成片字节必须完整复制')
  const card = JSON.parse(readFileSync(join(dir, 'deliver', 'card.json'), 'utf8'))
  assert.equal(card.spec.quality, 'standard')
  assert.equal(card.spec.durationSec, 45.1)
  assert.equal(card.version.anchorVersion, 3)
  assert.ok(card.version.manifestHash.length === 16)
  assert.equal(card.pending.openIssues, '音色未锁')
  assert.equal(card.pending.deliveredWithGaps, false)
  assert.equal(card.durationCheck.durationMismatch, false, '45.1 vs 45 = 0.1s ≤ 1s 容忍')
  assert.equal(card.durationCheck.deltaSec, 0.1)
  assert.equal(card.pointers.nodeId, 'node-1')
})

test('覆盖写：第二次交付同路径覆盖，不产生 final-vN 家族', () => {
  const dir = fixtureDir()
  writeDeliverable(baseInput(dir, { durationSec: 26.6 }))
  writeDeliverable(baseInput(dir, { durationSec: 45.1 }))
  assert.equal(existsSync(join(dir, 'deliver', 'final-v2.mp4')), false, 'D2 拍板：不留版本家族')
  const card = JSON.parse(readFileSync(join(dir, 'deliver', 'card.json'), 'utf8'))
  assert.equal(card.spec.durationSec, 45.1, 'card.json 与 final 同步为最新一次')
})

test('时长断言：偏差 >1s 标 durationMismatch（DNS 2 的 26.6s vs 45s 悲剧在此被拦）', () => {
  const dir = fixtureDir()
  const result = writeDeliverable(baseInput(dir, { durationSec: 26.6, targetDurationSec: 45 }))
  assert.equal(result.durationMismatch, true)
  assert.equal(result.deltaSec, -18.4)
  const card = JSON.parse(readFileSync(result.cardPath, 'utf8'))
  assert.equal(card.durationCheck.durationMismatch, true)
})

test('target 缺省：不判失配（deltaSec null），不误报', () => {
  const dir = fixtureDir()
  const result = writeDeliverable(baseInput(dir, { targetDurationSec: null }))
  assert.equal(result.durationMismatch, false)
  assert.equal(result.deltaSec, null)
  assert.equal(JSON.parse(readFileSync(result.cardPath, 'utf8')).durationCheck.targetDurationSec, null)
})

test('未决项空：deliveredWithGaps + （未填）占位（handoff 倒逼，不加审批门）', () => {
  const dir = fixtureDir()
  const result = writeDeliverable(baseInput(dir, { openIssues: null }))
  assert.equal(result.deliveredWithGaps, true)
  const card = JSON.parse(readFileSync(result.cardPath, 'utf8'))
  assert.equal(card.pending.openIssues, '（未填）')
  assert.equal(card.pending.deliveredWithGaps, true)
  const lines = deliveryReceiptLines(result)
  assert.ok(lines.some((line) => line.includes('未决项为空')), '回执必须带倒逼提醒')
})

test('写盘失败（源不存在）：written:false + note，绝不抛错（渲染不陪葬）', () => {
  const dir = fixtureDir()
  const result = writeDeliverable(baseInput(dir, { sourceFile: join(dir, 'missing.mp4') }))
  assert.equal(result.written, false)
  assert.ok(result.note !== undefined && result.note.includes('写入失败'))
  const lines = deliveryReceiptLines(result)
  assert.ok(lines[0].includes('权威交付写入失败'))
})

test('定稿判定（D1）：standard/high 且非 probe/spot 才落；draft/probe/spot 不落', () => {
  assert.equal(isDeliverableRender('standard', false, false), true)
  assert.equal(isDeliverableRender('high', false, false), true)
  assert.equal(isDeliverableRender('draft', false, false), false, 'draft 不落（画布角标已区分）')
  assert.equal(isDeliverableRender('standard', true, false), false, '探针不落')
  assert.equal(isDeliverableRender('high', false, true), false, 'spot-check 不落')
  assert.equal(DELIVER_DURATION_TOLERANCE_SEC, 1, 'D4 拍板 ±1s')
})

test('回执行：正常交付给一句权威交付说明（模型看得见 deliver 路径）', () => {
  const dir = fixtureDir()
  const lines = deliveryReceiptLines(writeDeliverable(baseInput(dir)))
  assert.ok(lines.some((line) => line.includes('deliver/final.mp4')))
})
