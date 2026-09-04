import { installSettingsSection } from '@deepseek-ai/dsh-settings';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { ProjectRegistry } from './projects.js';
import { registerStudioRoutes } from './routes.js';
import { createStudioTools } from './host-tools.js';
import { registerMinimaxSkills } from './skills/minimax-skills.js';
import { createPlaceholderTools } from './skills/placeholder-tools.js';
import { registerSkillRoutingPrompt } from './skills/routing-prompt.js';
import { setRuntimeConfig } from './generate.js';
import { CANVAS_STUDIO_NS, CanvasStudioConfig, DEFAULT_DRAMA_API_BASE, DEFAULT_DRAMA_API_KEY_REF, } from './host-config.js';
import { DEFAULT_BRAND_PRESET } from './brand.js';
/** Stable Cordis plugin name matching the bundle patch row. */
export const name = 'canvas-studio';
/** Services required by the host plugin. */
export const inject = ['webServer', 'tools', 'skills', 'settings', 'systemPrompt'];
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
        brandPreset: DEFAULT_BRAND_PRESET,
    };
    let source = () => base;
    const resolveDramaApiKey = async () => {
        const ref = source().dramaApiKey;
        const credentials = ctx.get('credentials');
        if (credentials !== undefined) {
            const hit = await credentials.resolve(credentialRef(ref));
            // CR-033：命中但值为空串 = 未配置（不把空 key 当有效）；有值才返回。
            if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0)
                return hit.value;
        }
        // CR-033：未配置时返回空串而非 fail-fast 抛错——后端当前无鉴权（docs §5-3），
        // 且仅本地/画布合成等不依赖 Drama 的场景不应因「未配置凭证」报错。调用方按
        // 需决定是否附加 Authorization 头（空 key 即不附加）。
        return '';
    };
    installSettingsSection(ctx, CANVAS_STUDIO_NS, CanvasStudioConfig, base, {
        setSource: (current) => { source = current; },
        onChange: () => { },
    });
    // 资产库根目录：每次取最新 source().assetDir（live 读取，留空=走桌面默认）。
    // ProjectRegistry 内部按 root 缓存项目列表，root 切换后下个 list() 触发重读。
    const assetsRoot = () => source().assetDir || dshHomePath('canvas-studio');
    // R1（缺口 C）：把设置页「默认执行模式」传给 registry——新建项目的工作流
    // 初始 mode 取自该设置（live 读取），设置开关不再只是装饰。
    const registry = new ProjectRegistry(assetsRoot, () => source().workflowMode);
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
    // The creation-spec skill (canvas-studio-creation) ships as a skills-local
    // bundle: scripts/sync-minimax-skills.mjs merges it into skills/ at build
    // time and registerMinimaxSkills below registers it like any other skill.
    // MiniMax-H3 upstream skills pilot: verbatim bodies from the pinned submodule
    // (3d-animation-short-generator for now). Registered as runtime skills so the
    // model can load the full upstream workflow on demand via the skill tool.
    ctx.effect(() => registerMinimaxSkills(ctx), 'canvas-studio: minimax upstream skills');
    // SK-01：创作任务路由硬指令——注册在 system prompt 而非只写在总纲的
    // description 里。CV-094 改 description 后模型会先加载总纲，但那依赖模型
    // 主动读 catalog 摘要；常驻小节让「先加载再澄清」在每一轮都可见，且不占
    // description 的长度配额（该配额留给负向路由语）。
    ctx.effect(() => registerSkillRoutingPrompt(ctx), 'canvas-studio: skill routing prompt');
}
