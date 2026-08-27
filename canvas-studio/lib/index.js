import { installSettingsSection } from '@deepseek-ai/dsh-settings';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { ProjectRegistry } from './projects.js';
import { registerStudioRoutes } from './routes.js';
import { createStudioTools } from './host-tools.js';
import { registerCreationSkill } from './skills/creation-spec.js';
import { setRuntimeConfig } from './generate.js';
import { CANVAS_STUDIO_NS, CanvasStudioConfig, DEFAULT_DRAMA_API_BASE, DEFAULT_DRAMA_API_KEY_REF, } from './host-config.js';
/** Stable Cordis plugin name matching the bundle patch row. */
export const name = 'canvas-studio';
/** Services required by the host plugin. */
export const inject = ['webServer', 'tools', 'skills', 'settings'];
/** Host plugin body: the project registry, its routes, the media tools, and the creation skill. */
export function apply(ctx) {
    const registry = new ProjectRegistry();
    ctx.effect(() => registerStudioRoutes(ctx, registry), 'canvas-studio: project routes');
    // 设置外置（块 2）：注册 namespace + 用 base 作默认层 + onChange 刷新 source。
    // dramaApiKey 以 credential-ref 形式存储，不落明文；运行时经 resolveDramaApiKey 解析。
    const base = {
        dramaApiBase: DEFAULT_DRAMA_API_BASE,
        dramaApiKey: DEFAULT_DRAMA_API_KEY_REF,
        maxVideoSeconds: 15,
    };
    let source = () => base;
    const resolveDramaApiKey = async () => {
        const ref = source().dramaApiKey;
        const credentials = ctx.get('credentials');
        if (credentials !== undefined) {
            const hit = await credentials.resolve(credentialRef(ref));
            if (hit !== undefined)
                return hit.value;
        }
        throw new Error('canvas-studio: 未配置凭证 ' + ref);
    };
    installSettingsSection(ctx, CANVAS_STUDIO_NS, CanvasStudioConfig, base, {
        setSource: (current) => { source = current; },
        onChange: () => { },
    });
    // 运行时配置：透传给 generate.ts（模块级 current），供 Drama 调用读取基址/时长/密钥。
    const cfg = {
        dramaApiBase: () => source().dramaApiBase,
        maxVideoSeconds: () => source().maxVideoSeconds,
        resolveDramaApiKey,
    };
    setRuntimeConfig(cfg);
    // Media generation tools register on the Host (the `tools` service is
    // Host-only); each tool resolves its project from the session workspace.
    ctx.effect(() => {
        const disposers = createStudioTools(registry, ctx.webServer.port, cfg).map((definition) => ctx.tools.register(definition));
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'canvas-studio: media generation tools');
    // P6: the creation-spec skill teaches the agent the storyboard format and
    // the nine-tool pipeline; it ships inside this bundle (runtime registration).
    ctx.effect(() => registerCreationSkill(ctx), 'canvas-studio: creation skill');
}
