import { defineConfig } from 'tsdown'

const PACKAGE_NAME = 'canvas-studio'

export default defineConfig({
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