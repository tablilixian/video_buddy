import { installSettingsSection } from '@deepseek-ai/dsh-settings';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { ProjectRegistry } from './projects.js';
import { registerStudioRoutes } from './routes.js';
import { createStudioTools } from './host-tools.js';
import { registerCreationSkill } from './skills/creation-spec.js';
import { registerMinimaxSkills } from './skills/minimax-skills.js';
import { createPlaceholderTools } from './skills/placeholder-tools.js';
import { setRuntimeConfig } from './generate.js';
import { CANVAS_STUDIO_NS, CanvasStudioConfig, DEFAULT_DRAMA_API_BASE, DEFAULT_DRAMA_API_KEY_REF, } from './host-config.js';
/** Stable Cordis plugin name matching the bundle patch row. */
export const name = 'canvas-studio';
/** Services required by the host plugin. */
export const inject = ['webServer', 'tools', 'skills', 'settings'];
/** Host plugin body: the project registry, its routes, the media tools, and the creation skill. */
export function apply(ctx) {
    // 设置外置（块 2）：注册 namespace + 用 base 作默认层 + onChange 刷新 source。
    // dramaApiKey 以 credential-ref 形式存储，不落明文；运行时经 resolveDramaApiKey 解析。
    const base = {
        dramaApiBase: DEFAULT_DRAMA_API_BASE,
        dramaApiKey: DEFAULT_DRAMA_API_KEY_REF,
        maxVideoSeconds: 15,
        defaultAspectRatio: '16:9',
        exportFormat: 'mp4',
        exportDir: '',
        videoQuality: 'standard',
        workflowMode: 'confirm',
        hitlStoryboard: true,
        hitlKeyframe: false,
        autoRetry: true,
        maxParallel: 2,
        assetDir: '',
        autoSave: true,
        autoSaveInterval: 30,
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
    // 资产库根目录：每次取最新 source().assetDir（live 读取，留空=走桌面默认）。
    // ProjectRegistry 内部按 root 缓存项目列表，root 切换后下个 list() 触发重读。
    const assetsRoot = () => source().assetDir || dshHomePath('canvas-studio');
    const registry = new ProjectRegistry(assetsRoot);
    ctx.effect(() => registerStudioRoutes(ctx, registry), 'canvas-studio: project routes');
    // 运行时配置：透传给 generate.ts（模块级 current），供 Drama 调用读取基址/时长/密钥
    // 与设置页扩展字段（画幅比例已接入；其余待管线消费）。
    const cfg = {
        dramaApiBase: () => source().dramaApiBase,
        maxVideoSeconds: () => source().maxVideoSeconds,
        resolveDramaApiKey,
        defaultAspectRatio: () => source().defaultAspectRatio,
        workflowMode: () => source().workflowMode,
        hitlStoryboard: () => source().hitlStoryboard,
        hitlKeyframe: () => source().hitlKeyframe,
        autoRetry: () => source().autoRetry,
        maxParallel: () => source().maxParallel,
        assetDir: () => source().assetDir,
        autoSave: () => source().autoSave,
        autoSaveInterval: () => source().autoSaveInterval,
    };
    setRuntimeConfig(cfg);
    // Media generation tools register on the Host (the `tools` service is
    // Host-only); each tool resolves its project from the session workspace.
    ctx.effect(() => {
        const disposers = createStudioTools(registry, ctx.webServer.port, cfg).map((definition) => ctx.tools.register(definition));
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'canvas-studio: media generation tools');
    // MiniMax upstream skill 占位工具：覆盖原版流程中 canvas 缺失的能力
    // （BGM 生成/TTS/硬字幕），返回可操作降级路径而非报错。
    ctx.effect(() => {
        const disposers = createPlaceholderTools().map((definition) => ctx.tools.register(definition));
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'canvas-studio: upstream placeholder tools');
    // P6: the creation-spec skill teaches the agent the storyboard format and
    // the nine-tool pipeline; it ships inside this bundle (runtime registration).
    ctx.effect(() => registerCreationSkill(ctx), 'canvas-studio: creation skill');
    // MiniMax-H3 upstream skills pilot: verbatim bodies from the pinned submodule
    // (3d-animation-short-generator for now). Registered as runtime skills so the
    // model can load the full upstream workflow on demand via the skill tool.
    ctx.effect(() => registerMinimaxSkills(ctx), 'canvas-studio: minimax upstream skills');
}
