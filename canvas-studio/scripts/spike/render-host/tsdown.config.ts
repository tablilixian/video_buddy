/**
 * REQ-034 · O-04 S0 spike 构建（**探针专用，不进产品构建**）。
 *
 * 跑法：
 *   npx tsdown -c scripts/spike/render-host/tsdown.config.ts
 *   node dsh-plugin-desktop/node_modules/electron/cli.js scripts/spike/render-host/main.mjs
 *
 * 为什么单独打一份：`renderManifestOnWeb` 依赖 remotion 三件套 + mediabunny，
 * 必须全部打进单文件（客户端 bundle 里的相对 require 在探针页面里解析不了）。
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'render-host-spike',
  entry: { entry: fileURLToPath(new URL('./entry.ts', import.meta.url)) },
  tsconfig: 'tsconfig.client.json',
  outDir: '/tmp/cs-render-host-spike',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: false,
  jsx: 'automatic',
  deps: { alwaysBundle: [/react/, /^remotion/, /^@remotion\//, /mediabunny/, /^@mediabunny\//] },
  outputOptions: { entryFileNames: 'entry.js' },
})
