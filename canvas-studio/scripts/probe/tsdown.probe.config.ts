import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

/** CV-167 探针构建（CanvasSurface 手势回归验证，不在产品构建内）。 */
export default defineConfig({
  name: 'surface-probe',
  entry: { probe: fileURLToPath(new URL('./surface-probe.tsx', import.meta.url)) },
  tsconfig: 'tsconfig.client.json',
  outDir: '/tmp/cs-surface-probe',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  clean: false,
  sourcemap: false,
  jsx: 'automatic',
  deps: { alwaysBundle: [/react/] },
})
