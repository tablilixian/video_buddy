/**
 * 生成接口端点（与 WL 适配器对齐）。
 * 注：Drama Backend 的基址 / 密钥已外置到 DSH 设置系统（见 host-config.ts），
 * 不再在此写死明文常量。
 */
export declare const DRAMA_ENDPOINTS: {
    readonly health: "/api/v1/health";
    readonly txt2image: "/api/v1/generate/txt2image";
    readonly txt2imageanime: "/api/v1/generate/txt2imageanime";
    readonly image2image: "/api/v1/generate/image2image";
    readonly uploadimage: "/api/v1/generate/uploadimage";
    readonly promptEnhance: "/api/v1/generate/image2promptenhance";
    readonly styleTransfer: "/api/v1/generate/image2styletransfer";
    readonly image2vl: "/api/v1/generate/image2vl";
    readonly storyboard: "/api/v1/generate/image2storyboard";
    readonly spliteGrid: "/api/v1/generate/image2splitegrid";
    readonly character: "/api/v1/generate/image2character";
    readonly inpaint: "/api/v1/generate/image2inpaint";
    readonly videoFl2va: "/api/v1/generate/image2videofl2va";
    readonly videoRef2va: "/api/v1/generate/image2videoref2va";
};
/** 宽高比 → 像素尺寸（简化自 WL `config/sizeConfig.ts`）。 */
export declare function sizeForAspectRatio(aspectRatio: string | undefined): {
    width: number;
    height: number;
};
/** 生成一个资产文件名用的 UUID。 */
export declare function newAssetId(): string;
