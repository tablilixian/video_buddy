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
    noExternal: ['@supabase/supabase-js'],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
})