/**
 * Canvas Studio 品牌文案与三态微文案（集中常量表）。
 *
 * 统一「导演 / 镜头 / 成片」语汇（brand-identity-proposal.md §6）。纯数据模块，
 * 组件只从这里取文案，不散落硬编码。命名：Canvas Studio（英文主名）· 创意工厂
 * （中文运营名，2026-08-31 拍板）；tagline From idea to final cut.
 */
export declare const BRAND: {
    /** 英文主名。 */
    readonly name: "Canvas Studio";
    /** 中文运营名。 */
    readonly nameZh: "创意工厂";
    /** 主 Tagline（已定案）。 */
    readonly tagline: "From idea to final cut.";
    /** Tagline 中文。 */
    readonly taglineZh: "从创意到成片";
    /** 一句话定位（正式场合：README / 设置页 About）。 */
    readonly positioning: "Agent 驱动的 AI 视频生产工作台";
    /** 定位完整句。 */
    readonly positioningFull: "Agent 驱动的 AI 视频生产工作台：你定方向，AI 执导全程。";
    /** 副语（欢迎屏 / About 补充）。 */
    readonly subline: "Let your agent direct.";
};
/** 空态（empty）三场景文案。 */
export declare const EMPTY_COPY: {
    /** 首启欢迎屏主标题。 */
    readonly welcomeTitle: "从一句话创意开始";
    /** 首启欢迎屏引导。 */
    readonly welcomeHint: "新建项目后，在右侧对话里描述你的创意——分镜、定妆、场景与成片，都由 agent 替你排好。";
    /** 欢迎屏主 CTA。 */
    readonly createProject: "新建项目";
    /** 欢迎屏副 CTA：示例项目。 */
    readonly createSample: "创建示例项目";
    /** 欢迎屏副 CTA 说明。 */
    readonly sampleHint: "预置分镜、定妆、场景与视频节点，直观感受画布全链路";
    /** 有项目但画布无节点（画布中心引导）。 */
    readonly canvasEmptyTitle: "画布空空如也";
    readonly canvasEmptyHint: "在右侧对话描述你的创意，agent 会为你排好一切；也可以拖入图片或右键新建素材。";
    /** 未选中项目（画布区提示）。 */
    readonly noProject: "打开或新建一个项目，开始创作";
    /** 项目列表空态。 */
    readonly projectEmpty: "还没有项目，点击「新建项目」开始创作";
};
/** Lobby 态（无项目：对话居中）文案。 */
export declare const LOBBY_COPY: {
    /** 品牌条引导句（聊天框上方）。 */
    readonly hint: "在下面描述你的创意 —— 分镜、定妆、场景与成片，agent 替你排好。";
    /** 示例项目短说明（品牌条右侧，比欢迎屏更紧凑）。 */
    readonly sampleHint: "预置分镜与视频节点，直观感受全链路";
};
/** 加载态（loading）文案。 */
export declare const LOADING_COPY: {
    /** 项目列表加载中。 */
    readonly projects: "正在加载项目…";
    /** 画布载入中。 */
    readonly canvas: "画布载入中…";
    /** 按生产阶段的生成中文案（节点级与骨架屏共用）。 */
    readonly stage: (stage: string) => string;
    readonly stages: {
        readonly storyboard: "分镜推演";
        readonly character: "角色定妆";
        readonly scene: "场景概念";
        readonly clip: "镜头渲染";
        readonly compose: "成片合成";
    };
};
/** 错误态（error）三级处置文案。 */
export declare const ERROR_COPY: {
    /** 可重试：通用文案。 */
    readonly retryable: "出错了，重试一次？";
    readonly retry: "重试";
    /** 配置缺失。 */
    readonly configTitle: "配置缺失";
    readonly configHint: "请到设置里检查 Drama API 基址与密钥。";
    readonly openSettings: "打开设置";
    /** 服务不可达。 */
    readonly unreachableTitle: "服务不可达";
    readonly unreachableHint: "生成服务没有响应，请确认 Drama 后端已启动后重试。";
};
