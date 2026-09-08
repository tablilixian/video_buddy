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
