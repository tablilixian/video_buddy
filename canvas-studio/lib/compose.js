/**
 * Canvas Studio P9.2 成片合成路由（Host 侧）。
 *
 * 收集画布上的分镜视频片段（clip）→ 逐段用 ffmpeg 统一分辨率/帧率转码 →
 * concat demuxer 拼接 → 可选 BGM `amix` 混音 → 落项目 assets 根目录
 * `export-<uuid>.mp4`（兼容现有两段式资产路由 `<projectId>/<file>`）。
 *
 * 所有 ffmpeg 解析/执行复用 `ffmpeg-run`；纯函数（clip 收集、参数构造、
 * concat 清单、分辨率解析）直接由单测断言，端到端用假 ffmpeg 替身覆盖。
 */
import { mkdtemp, writeFile, access, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newAssetId } from './config.js';
import { applySupersede, isActiveShot } from './shot-versions.js';
import { previewSizeOf } from './canvas-aspect.js';
/** 成片节点缺分辨率时的回退画布显示尺寸（横屏占位，媒体加载后由框比例校正兜底）。 */
const COMPOSED_FALLBACK_SIZE = { width: 260, height: 180 };
import { resolveFfmpegPath, runFfmpeg, parseFfmpegStreams, parseFfmpegDuration, FFMPEG_TIMEOUT_MS } from './ffmpeg-run.js';
/** 合成整体超时上限（毫秒）：本地拼接几十秒视频应远小于此，超时报中文错误。 */
const COMPOSE_TIMEOUT_MS = 120_000;
/** 统一转码目标帧率。 */
const TARGET_FPS = 25;
/** BGM 混音音量（0–1）。 */
const BGM_VOLUME = 0.8;
/**
 * v1 中性默认调色（统一 eq 滤镜，治各镜色调漂移）：轻微提对比 + 饱和归一，
 * 所有片段应用同一滤镜链，把逐镜生成的色调差异拉到同一基线。传 false 关闭，
 * 传字符串覆盖本预设（见 ComposeOptions.colorGrade）。
 */
const DEFAULT_COLOR_GRADE = 'eq=contrast=1.03:saturation=1.02';
/** BGM 淡入淡出时长（秒）。 */
const BGM_FADE_SEC = 1;
/**
 * 将画布节点同源 URL 反查为本地资产文件绝对路径。
 * URL 形如 `/canvas-studio/assets/<projectId>/<file>`，资产目录由 registry
 * 提供；返回 `join(assetsDir, file)`。
 */
export function urlToAssetPath(assetsDir, url) {
    const parts = url.split('/').filter(Boolean);
    const idx = parts.indexOf('assets');
    const file = idx >= 0 ? parts[idx + 2] : parts.at(-1);
    return join(assetsDir, file ?? url.split('/').at(-1) ?? '');
}
/**
 * 从画布节点收集合成所需的视频 clip（纯函数）。
 * - 仅接受 kind=video 的节点；
 * - clipIds 中缺失/非视频/重复 id 一律跳过；
 * - 返回命中的节点与缺失的 id 列表（缺失由调用方面向用户报「片段文件不存在」）。
 */
export function collectClips(nodes, clipIds) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const clips = [];
    const missingIds = [];
    const seen = new Set();
    for (const id of clipIds) {
        if (seen.has(id))
            continue;
        seen.add(id);
        const node = byId.get(id);
        if (node === undefined || node.kind !== 'video' || node.url === undefined) {
            missingIds.push(id);
            continue;
        }
        clips.push(node);
    }
    return { clips, missingIds };
}
/** 构造 concat demuxer 清单内容（纯函数）：每行 `file '<绝对路径>'`。 */
export function buildConcatList(paths) {
    return paths.map((path) => `file '${path}'`).join('\n') + '\n';
}
/** 统一转码参数（纯函数）。无音轨加 `-an`，有音轨重新编码为 aac。
 * `colorGrade` 非空时在 vf 末尾追加统一调色滤镜（治各镜色调漂移）。 */
export function buildTranscodeArgs(input, output, width, height, fps, hasAudio, colorGrade) {
    // CR-022：等比缩放 + 黑边补足，避免画幅不一致的片段被非等比拉伸变形。
    // `force_original_aspect_ratio=decrease` 保持纵横比缩放到 WxH 内，
    // 再 `pad` 居中补到目标画幅，保证 concat 时所有片段同尺寸可拼接。
    // C5：末尾追加统一调色（eq 等），各镜应用同一滤镜链拉到同一色调基线。
    const gradeVf = colorGrade ? `,${colorGrade}` : '';
    const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps}${gradeVf}`;
    return [
        '-i', input,
        '-vf', vf,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        ...(hasAudio ? ['-c:a', 'aac'] : ['-an']),
        '-y', output,
    ];
}
/** concat 拼接参数（纯函数）。 */
export function buildConcatArgs(concatListPath, output) {
    return ['-f', 'concat', '-safe', '0', '-i', concatListPath, '-c', 'copy', '-y', output];
}
/** 构造 BGM 淡入淡出滤镜串（纯函数）。时长不足一个淡入周期时只做淡入。
 * 返回空串表示不做任何淡化（如时长未知）。 */
export function buildBgmFade(duration) {
    if (!Number.isFinite(duration) || duration <= 0)
        return '';
    const fadeIn = `afade=t=in:st=0:d=${BGM_FADE_SEC}`;
    const fadeOut = duration > BGM_FADE_SEC
        ? `,afade=t=out:st=${(duration - BGM_FADE_SEC).toFixed(3)}:d=${BGM_FADE_SEC}`
        : '';
    return `,${fadeIn}${fadeOut}`;
}
/**
 * BGM 混音参数（纯函数）。concat 产物有音轨时与 BGM 做 `amix=duration=first`
 * （钳制 BGM 音量）；无音轨时直接把 BGM 作为成片音轨。两种情形 BGM 都过
 * `buildBgmFade` 淡入淡出（C5：BGM 单轨贯穿 + 头尾不突兀）。
 */
export function buildAmixArgs(concatOutput, bgmInput, output, hasConcatAudio, bgmDuration = 0) {
    const fade = buildBgmFade(bgmDuration);
    const bgmChain = `[1:a]volume=${BGM_VOLUME}${fade}[bgm]`;
    if (hasConcatAudio) {
        return [
            '-i', concatOutput,
            '-i', bgmInput,
            '-filter_complex',
            `${bgmChain};[0:a][bgm]amix=duration=first[out]`,
            '-map', '0:v',
            '-map', '[out]',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-shortest',
            '-y', output,
        ];
    }
    return [
        '-i', concatOutput,
        '-i', bgmInput,
        '-filter_complex',
        bgmChain,
        '-map', '0:v',
        '-map', '[bgm]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-shortest',
        '-y', output,
    ];
}
function isVideoFile(path) {
    return /\.(mp4|m4v|mov|webm|mkv|avi)$/iu.test(path);
}
/**
 * 执行成片合成全流程（Host 侧）：
 * 1) 读取画布节点，收集 clip 并反查本地文件，缺失报「片段文件不存在」；
 * 2) 探测首个 clip 的分辨率（后续片段统一到此尺寸），无分辨率则报错；
 * 3) 逐段统一转码（25fps / yuv420p / 有音轨转 aac 否则 -an）；
 * 4) concat demuxer 拼接；
 * 5) 可选 BGM amix 混音；
 * 6) 落 `export-<uuid>.mp4` 于 assets 根目录，返回同源 URL + 成片时长。
 *
 * 整体受 120s 超时与调用方 `signal` 双重约束，超时/中断即抛中文错误。
 */
export async function composeStudioVideo(registry, projectId, clipIds, bgmNodeId, options = {}, signal) {
    if (clipIds.length === 0)
        throw new Error('请先选择至少一个分镜片段');
    const project = await registry.getProject(projectId);
    if (project === null)
        throw new Error(`项目不存在: ${projectId}`);
    const assetsDir = registry.assetsDir(projectId);
    await mkdir(assetsDir, { recursive: true });
    const document = await registry.readCanvas(projectId);
    const { clips, missingIds } = collectClips(document.nodes, clipIds);
    if (clips.length === 0) {
        throw new Error('所选片段中没有可合成的视频节点，请重新生成片段');
    }
    // 反查本地文件，缺失即报错（不落半成品）。
    const resolvedClips = [];
    for (const clip of clips) {
        const inputPath = urlToAssetPath(assetsDir, clip.url);
        try {
            await access(inputPath);
        }
        catch {
            missingIds.push(clip.id);
        }
        resolvedClips.push({ id: clip.id, url: clip.url, inputPath, hasAudio: false });
    }
    if (missingIds.length > 0) {
        throw new Error('片段文件不存在，请重新生成后再导出');
    }
    const ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
    const fps = Math.max(1, options.fps ?? TARGET_FPS);
    // C5：统一调色预设解析 —— false 关闭，字符串覆盖，缺省用中性默认。
    const colorGrade = options.colorGrade === false
        ? undefined
        : (typeof options.colorGrade === 'string' ? options.colorGrade : DEFAULT_COLOR_GRADE);
    const tempDir = await mkdtemp(join(tmpdir(), 'cs-compose-'));
    // 整体超时：调用方 signal 与 120s 上限取并集。
    const timeout = AbortSignal.timeout(COMPOSE_TIMEOUT_MS);
    const composed = AbortSignal.any([signal ?? AbortSignal.timeout(COMPOSE_TIMEOUT_MS), timeout]);
    try {
        // 1) 探针首个 clip 分辨率 + 每段音轨存在性。
        const firstProbe = await runFfmpeg(ffmpegPath, ['-i', resolvedClips[0].inputPath], FFMPEG_TIMEOUT_MS, composed);
        const firstStreams = parseFfmpegStreams(firstProbe.stderr);
        const width = firstStreams.width;
        const height = firstStreams.height;
        if (width === undefined || height === undefined) {
            throw new Error('无法识别片段分辨率，请重新生成片段');
        }
        const probeTasks = resolvedClips.map(async (clip) => {
            const probe = await runFfmpeg(ffmpegPath, ['-i', clip.inputPath], FFMPEG_TIMEOUT_MS, composed);
            clip.hasAudio = parseFfmpegStreams(probe.stderr).hasAudio;
            return clip;
        });
        await Promise.all(probeTasks);
        // 2) 逐段统一转码。
        const transcodedPaths = [];
        for (let i = 0; i < resolvedClips.length; i += 1) {
            const clip = resolvedClips[i];
            const out = join(tempDir, `clip-${i}.mp4`);
            const args = buildTranscodeArgs(clip.inputPath, out, width, height, fps, clip.hasAudio, colorGrade);
            const result = await runFfmpeg(ffmpegPath, args, COMPOSE_TIMEOUT_MS, composed);
            if (result.code !== 0) {
                const detail = result.stderr.trim().split('\n').at(-1) ?? '';
                throw new Error(`片段转码失败（${clip.id}${detail.length > 0 ? `: ${detail}` : ''}）`);
            }
            transcodedPaths.push(out);
        }
        // 3) concat 拼接。
        const concatListPath = join(tempDir, 'concat.txt');
        await writeFile(concatListPath, buildConcatList(transcodedPaths));
        const concatOutput = join(tempDir, 'concat.mp4');
        const concatResult = await runFfmpeg(ffmpegPath, buildConcatArgs(concatListPath, concatOutput), COMPOSE_TIMEOUT_MS, composed);
        if (concatResult.code !== 0) {
            const detail = concatResult.stderr.trim().split('\n').at(-1) ?? '';
            throw new Error(`片段拼接失败${detail.length > 0 ? `: ${detail}` : ''}`);
        }
        // 4) 可选 BGM 混音；无 BGM 时 concat 产物即成片。
        const outputName = options.outputName ?? `export-${newAssetId()}.mp4`;
        const finalOutput = join(assetsDir, outputName);
        if (bgmNodeId !== undefined) {
            const bgmNode = document.nodes.find((node) => node.id === bgmNodeId);
            if (bgmNode === undefined || bgmNode.url === undefined) {
                throw new Error('BGM 片段不存在，请重新选择');
            }
            if (!isVideoFile(bgmNode.url)) {
                throw new Error('BGM 仅支持视频/音频文件');
            }
            const bgmInput = urlToAssetPath(assetsDir, bgmNode.url);
            try {
                await access(bgmInput);
            }
            catch {
                throw new Error('BGM 文件不存在，请重新上传后再导出');
            }
            // C5：探测 BGM 时长，驱动淡出起点（时长不足淡入周期时只淡入）。
            const bgmProbe = await runFfmpeg(ffmpegPath, ['-i', bgmInput], FFMPEG_TIMEOUT_MS, composed);
            const bgmDuration = parseFfmpegDuration(bgmProbe.stderr);
            const concatProbe = await runFfmpeg(ffmpegPath, ['-i', concatOutput], FFMPEG_TIMEOUT_MS, composed);
            const hasConcatAudio = parseFfmpegStreams(concatProbe.stderr).hasAudio;
            const amixResult = await runFfmpeg(ffmpegPath, buildAmixArgs(concatOutput, bgmInput, finalOutput, hasConcatAudio, bgmDuration), COMPOSE_TIMEOUT_MS, composed);
            if (amixResult.code !== 0) {
                const detail = amixResult.stderr.trim().split('\n').at(-1) ?? '';
                throw new Error(`BGM 混音失败${detail.length > 0 ? `: ${detail}` : ''}`);
            }
        }
        else {
            // 无 BGM：直接把 concat 产物落盘为最终成片。
            // CR-023：copyFile 流式复制，不再把大视频整读进内存再写。
            await copyFile(concatOutput, finalOutput);
        }
        // 5) 探测成片时长（ffmpeg -i 非零退出属预期，时长在 stderr）。
        const finalProbe = await runFfmpeg(ffmpegPath, ['-i', finalOutput], FFMPEG_TIMEOUT_MS, composed);
        const duration = parseFfmpegDuration(finalProbe.stderr);
        const finalStreams = parseFfmpegStreams(finalProbe.stderr);
        return {
            url: `/canvas-studio/assets/${projectId}/${outputName}`,
            duration,
            ...(finalStreams.width !== undefined ? { width: finalStreams.width } : {}),
            ...(finalStreams.height !== undefined ? { height: finalStreams.height } : {}),
        };
    }
    finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}
/**
 * 把合成结果写为画布节点（video-composite，origin=agent，血缘指向源片段），
 * 返回新建节点。位置沿用 4 列网格；真实分辨率写入 mediaWidth/mediaHeight，
 * 文案写入 `script`，使详情面板可展示。客户端工具/结果重载后即出现在画布。
 * 节点框按真实分辨率等比换算（竖屏成片不再被 260×180 横屏占位框 cover 裁切）。
 */
export async function appendComposedVideoNode(registry, projectId, input) {
    const existing = (await registry.readCanvas(projectId)).nodes;
    const index = existing.length;
    // CV-108：成片也进版本链——重新合成后旧成片标记失效（保留在画布上供对比，
    // 但不再被当作「当前成片」，避免多个成片并列分不清最终版）。
    const previousComposed = existing.filter((node) => node.toolName === 'compose' && isActiveShot(node));
    const composedVersion = previousComposed.reduce((max, node) => Math.max(max, node.shotVersion ?? 1), 0) + 1;
    const supersedeIds = previousComposed.map((node) => node.id);
    // 宽高齐备时按真实分辨率换算显示框（1:1→420、9:16→267×480、16:9→480×270）；
    // 探测失败回退横屏占位，由客户端媒体加载后的框比例校正兜底。
    const size = input.width !== undefined && input.height !== undefined && input.width > 0 && input.height > 0
        ? previewSizeOf({ width: input.width, height: input.height })
        : COMPOSED_FALLBACK_SIZE;
    const node = {
        id: newAssetId(),
        kind: 'video',
        title: `成片 ${new Date().toLocaleString('zh-CN')}`,
        url: input.url,
        ...(input.duration !== undefined ? { duration: input.duration } : {}),
        ...(input.width !== undefined ? { mediaWidth: input.width } : {}),
        ...(input.height !== undefined ? { mediaHeight: input.height } : {}),
        x: 40 + (index % 4) * 300,
        y: 40 + Math.floor(index / 4) * 240,
        width: size.width,
        height: size.height,
        createdAt: Date.now(),
        toolName: 'compose',
        origin: 'agent',
        sourceIds: input.sourceIds,
        operationType: 'video-composite',
        shotVersion: composedVersion,
        ...(supersedeIds.length > 0 ? { supersedes: supersedeIds } : {}),
        ...(input.script !== undefined ? { script: input.script } : {}),
    };
    await registry.appendCanvasNode(projectId, node);
    if (supersedeIds.length > 0) {
        const persisted = (await registry.readCanvas(projectId)).nodes;
        await registry.writeCanvas(projectId, applySupersede(persisted, node.id, supersedeIds));
    }
    return node;
}
