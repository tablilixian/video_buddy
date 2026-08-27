/**
 * Canvas Studio P3 明文配置（验收后整理）。
 *
 * 优先读取环境变量，便于本地验收时切换；未设置时回退到下方明文常量。
 * 接口形态参考 WL-AI-Director 的 Drama Backend 适配器
 *（`services/adapters/imageAdapter.ts`、`videoAdapter.ts`）。
 */
import { randomUUID } from 'node:crypto';
/** Drama Backend API 基址（WL 自架后端）。 */
export const DRAMA_API_BASE = process.env.CANVAS_STUDIO_DRAMA_API_BASE ?? 'http://117.50.108.73:8082';
/** Drama Backend API Key（明文；验收后改为加密 / 配置中心）。 */
export const DRAMA_API_KEY = process.env.CANVAS_STUDIO_DRAMA_API_KEY ?? 'REPLACE_WITH_YOUR_KEY';
/** 生成接口端点（与 WL 适配器对齐）。 */
export const DRAMA_ENDPOINTS = {
    health: '/api/v1/health',
    txt2image: '/api/v1/generate/txt2image',
    txt2imageanime: '/api/v1/generate/txt2imageanime',
    image2image: '/api/v1/generate/image2image',
    uploadimage: '/api/v1/generate/uploadimage',
    promptEnhance: '/api/v1/generate/image2promptenhance',
    styleTransfer: '/api/v1/generate/image2styletransfer',
    image2vl: '/api/v1/generate/image2vl',
    storyboard: '/api/v1/generate/image2storyboard',
    spliteGrid: '/api/v1/generate/image2splitegrid',
    inpaint: '/api/v1/generate/image2inpaint',
    videoFl2va: '/api/v1/generate/image2videofl2va',
    videoRef2va: '/api/v1/generate/image2videoref2va',
};
/** 宽高比 → 像素尺寸（简化自 WL `config/sizeConfig.ts`）。 */
export function sizeForAspectRatio(aspectRatio) {
    switch (aspectRatio) {
        case '9:16': return { width: 720, height: 1280 };
        case '1:1': return { width: 1024, height: 1024 };
        case '16:9':
        default: return { width: 1280, height: 720 };
    }
}
/** 生成一个资产文件名用的 UUID。 */
export function newAssetId() {
    return randomUUID();
}
