export declare function useWaveBars(url: string | undefined, bars: number): number[];
export interface WaveBarsProps {
    /** 音频资产 URL（同源 /canvas-studio/assets/...；缺省 = 全降级条）。 */
    url?: string | undefined;
    /** 波形条数。 */
    bars: number;
}
/**
 * 波形条带（`.csWaveBars > i`）。时间轴 BGM 轨等「在 map 里渲染」的场景不能
 * 逐项调 hook，用这个实例级组件承载（组件内部调 useWaveBars 合规）。
 */
export declare function WaveBars(props: WaveBarsProps): React.JSX.Element;
