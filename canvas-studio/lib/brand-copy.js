/**
 * Canvas Studio 品牌文案与三态微文案（集中常量表）。
 *
 * 统一「导演 / 镜头 / 成片」语汇（brand-identity-proposal.md §6）。纯数据模块，
 * 组件只从这里取文案，不散落硬编码。命名：Canvas Studio（英文主名）· 创意工厂
 * （中文运营名，2026-08-31 拍板）；tagline From idea to final cut.
 */
export const BRAND = {
    /** 英文主名。 */
    name: 'Canvas Studio',
    /** 中文运营名。 */
    nameZh: '创意工厂',
    /** 主 Tagline（已定案）。 */
    tagline: 'From idea to final cut.',
    /** Tagline 中文。 */
    taglineZh: '从创意到成片',
    /** 一句话定位（正式场合：README / 设置页 About）。 */
    positioning: 'Agent 驱动的 AI 视频生产工作台',
    /** 定位完整句。 */
    positioningFull: 'Agent 驱动的 AI 视频生产工作台：你定方向，AI 执导全程。',
    /** 副语（欢迎屏 / About 补充）。 */
    subline: 'Let your agent direct.',
};
/** 空态（empty）三场景文案。 */
export const EMPTY_COPY = {
    /** 首启欢迎屏主标题。 */
    welcomeTitle: '从一句话创意开始',
    /** 首启欢迎屏引导。 */
    welcomeHint: '新建项目后，在右侧对话里描述你的创意——分镜、定妆、场景与成片，都由 agent 替你排好。',
    /** 欢迎屏主 CTA。 */
    createProject: '新建项目',
    /** 欢迎屏副 CTA：示例项目。 */
    createSample: '创建示例项目',
    /** 欢迎屏副 CTA 说明。 */
    sampleHint: '预置分镜、定妆、场景与视频节点，直观感受画布全链路',
    /** 有项目但画布无节点（画布中心引导）。 */
    canvasEmptyTitle: '画布空空如也',
    canvasEmptyHint: '在右侧对话描述你的创意，agent 会为你排好一切；也可以拖入图片或右键新建素材。',
    /** 未选中项目（画布区提示）。 */
    noProject: '打开或新建一个项目，开始创作',
    /** 项目列表空态。 */
    projectEmpty: '还没有项目，点击「新建项目」开始创作',
};
/** Lobby 态（无项目：对话居中）文案。 */
export const LOBBY_COPY = {
    /** 品牌条引导句（聊天框上方）。 */
    hint: '在下面描述你的创意 —— 分镜、定妆、场景与成片，agent 替你排好。',
    /** 示例项目短说明（品牌条右侧，比欢迎屏更紧凑）。 */
    sampleHint: '预置分镜与视频节点，直观感受全链路',
};
/**
 * CV-069：用户信息面板假数据（mock persona，中文创作人设）。
 * 接真用户体系时只改这一处；积分/订阅为 reserved 展示（UI 挂「待接入」
 * 角标，不伪造可充值语义）。
 */
export const USER_MOCK = {
    /** 昵称（CV-088 Lobby 问候同源）。 */
    name: '林小满',
    /** 展示用 UID（假）。 */
    uid: '467368332739416065',
    /** 账号身份。 */
    plan: '个人账号',
    /** 积分余额（假数，reserved）。 */
    credits: 2600,
};
/** 加载态（loading）文案。 */
export const LOADING_COPY = {
    /** 项目列表加载中。 */
    projects: '正在加载项目…',
    /** 画布载入中。 */
    canvas: '画布载入中…',
    /** 按生产阶段的生成中文案（节点级与骨架屏共用）。 */
    stage: (stage) => `${stage}中…`,
    stages: {
        storyboard: '分镜推演',
        character: '角色定妆',
        scene: '场景概念',
        clip: '镜头渲染',
        compose: '成片合成',
    },
};
/** 错误态（error）三级处置文案。 */
export const ERROR_COPY = {
    /** 可重试：通用文案。 */
    retryable: '出错了，重试一次？',
    retry: '重试',
    /** 配置缺失。 */
    configTitle: '配置缺失',
    configHint: '请到设置里检查 Drama API 基址与密钥。',
    openSettings: '打开设置',
    /** 服务不可达。 */
    unreachableTitle: '服务不可达',
    unreachableHint: '生成服务没有响应，请确认 Drama 后端已启动后重试。',
};
