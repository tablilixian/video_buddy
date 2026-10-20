import { defineConfig } from 'tsdown'

const PACKAGE_NAME = 'canvas-studio'

/**
 * REQ-034 · O-05：**第二个浏览器 bundle** —— RenderHost 页面脚本。
 *
 * 与 client bundle 的差别有三点，别照抄：
 * 1. 它是**独立页面**（`<script type="module">`），不包 `__ModuleLoader__` 的 banner/footer；
 * 2. 格式是 `esm`（模块脚本），不是被 loader `require` 的 cjs；
 * 3. 同样必须 `codeSplitting: false` —— 页面里出现相对 chunk 会 404（宿主只注册了单个 JS 路由）。
 *
 * 重依赖（remotion / mediabunny）在这里是**动态 import**，关闭分包后会内联进同一个文件，
 * 因此包体与 client bundle 同量级（约 3MB），但**只在隐藏窗口里加载**，不影响主界面首屏。
 */
const renderHostConfig = defineConfig({
  name: `${PACKAGE_NAME}/render-host`,
  entry: { 'render-host': 'src/render-host/main.ts' },
  tsconfig: 'tsconfig.client.json',
  outDir: 'lib',
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  fixedExtension: false,
  dts: false,
  clean: false,
  sourcemap: true,
  // ⚠️ react / react-dom 必须打进来：client bundle 里它们是 external（宿主 loader provide），
  // 但隐藏窗口这个**普通页面**没有任何 loader —— 留 external 会直接
  // `Failed to resolve module specifier "react"`，页面白屏、状态永远不上报（真机实测踩过）。
  noExternal: [/^react/, /^react-dom/, /^@remotion\//, /^remotion(\/|$)/, /^mediabunny/, /^@mediabunny\//],
  outputOptions: {
    entryFileNames: 'render-host.js',
    codeSplitting: false,
  },
})

const clientConfig = defineConfig({
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-layout/client',
      '@deepseek-ai/dsh-client-ui-slots',
    ],
    // tsdown 默认把 package.json dependencies 全部 externalize —— 宿主 loader
    // 只 provide 上面 external 列表里的模块，client 代码引用的其它依赖必须
    // 显式打进来（2026-10-15 实测：supabase-js 漏打 → renderer boot failed；
    // verify-client-loader 的 factory 执行层守卫会拦这一类回归）。
    // REQ-034 · B3：CSR 渲染器 import `@remotion/web-renderer` + `remotion` +
    // `@remotion/media`（组件树），三者都是 dependencies、必须打进 bundle；
    // 其传递依赖（mediabunny / @mediabunny/* / @remotion/licensing）非直接依赖，
    // tsdown 默认就会打进来。
    noExternal: ['@supabase/supabase-js', /^@remotion\//, /^remotion(\/|$)/],
    outputOptions: {
      entryFileNames: 'client.js',
      // REQ-034 · B3：CSR 渲染器把 `@remotion/web-renderer` + `mediabunny` 打进 bundle 后，
      // 默认会为编码器拆出动态 chunk（`./custom-coder-*.cjs` 等）。宿主 loader 的 `require`
      // 只 provide react / @deepseek-ai，**相对 require 在渲染进程里解析不了** —— 必须
      // 关闭分包、内联为单文件，否则 renderer boot 直接炸（verify-client-loader 会拦）。
      codeSplitting: false,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
})

export default [clientConfig, renderHostConfig]