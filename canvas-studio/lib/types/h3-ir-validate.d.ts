/**
 * H3-Context-IR 简报格式校验器（TS 移植，源自 MiniMax-H3-Context-IR-Skill validate.py）。
 *
 * 规则从 MiniMax 官方两份写作指南 + 四组官方实际 IR 输出独立推导。
 * 冲突时以官方实际输出为准 —— 数值型"句数/词数"约束官方自己也会超，
 * 因此 ERROR 只留给结构性错误，数值区间一律 WARN。
 *
 * 硬闸门：tests/h3-ir-validate.test.mjs 用 tests/fixtures/official_ir.json
 * 断言官方 IR 输出 100% 通过（对应 validate.py --self-test）。
 */
export declare const BASE_SECTIONS: readonly ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"];
export declare const REF_SECTIONS: readonly ["subject_definitions", "summary", "retention_analysis", "detailed_description", "overall_soundscape", "non_diegetic_music"];
export type IrMode = 'T2VA' | 'I2VA' | 'L2VA' | 'FL2VA' | 'Ref2VA';
/** C1 — 运镜封闭词表（20 个，供提示词侧与测试引用）。 */
export declare const CAMERA_TERMS: string[];
export interface IrFinding {
    rule: string;
    severity: 'ERROR' | 'WARN';
    message: string;
}
export interface IrReport {
    mode: IrMode;
    duration: number;
    findings: IrFinding[];
    /** ERROR 级 findings（判失败）。 */
    errors: IrFinding[];
    /** WARN 级 findings（不判失败）。 */
    warnings: IrFinding[];
    /** 无 ERROR 即通过。 */
    ok: boolean;
}
export interface ValidateH3IrOptions {
    mode: IrMode;
    /** 目标时长（秒）。 */
    duration: number;
    pictures?: number;
    videos?: number;
    audios?: number;
    allowTransitions?: boolean;
}
export declare function validateH3Ir(text: string, opts: ValidateH3IrOptions): IrReport;
/**
 * 判断 prompt 是否「像」一份 H3-Context-IR 简报。纯文本提示词（哪怕偶尔
 * 含单个可疑标记，如一行 `summary:` 开头）必须原样透传，因此要求命中
 * ≥2 个不同标记才认定为 IR —— 半成品 IR（模型想写 IR 但写漏/写错段）通常
 * 仍带有多个段名或标签，能被拦下。
 */
export declare function looksLikeH3Ir(text: string): boolean;
export interface AssertH3IrPromptOptions {
    mode: IrMode;
    /** 有效时长（秒）——调用方应传钳制后的值，与实际发往后端的时长一致。 */
    duration: number;
    pictures?: number;
    videos?: number;
    audios?: number;
    allowTransitions?: boolean;
}
/**
 * CV-119：video_generate / video_composite 的 prompt 预检。
 *
 * prompt 不是 IR（纯文本）→ 直接放行；是 IR 但有 ERROR 级违规 → 抛错取消
 * 本次生成（不再打到后端才发现格式问题浪费一次调用）。WARN 只提示、不阻断。
 */
export declare function assertH3IrPrompt(text: string, opts: AssertH3IrPromptOptions): void;
