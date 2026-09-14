import type { ReactElement } from 'react';
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client';
export interface UserCardProps {
    /** 打开 Canvas Studio 设置弹窗（真实功能）。 */
    onOpenSettings(): void;
    /** 桌面主题运行时（真实功能；连接未就绪时主题组整体隐藏）。 */
    theme?: ThemeRuntime;
}
/**
 * 首字母 + 品牌色渐变 SVG 头像（不用图片资源）。
 *
 * DD-08 / R8 起导出：左栏收起态的缩略条要复用**同一个**头像（圆形裁剪靠
 * `.csUserAvatar`，渐变 id 靠 useId）—— 复制一份出来，两处头像迟早分叉
 * （圆角/渐变方向/描边）而没有任何报错提示。
 */
export declare function LetterAvatar(props: {
    name: string;
    size?: number;
}): ReactElement;
export declare function UserCard(props: UserCardProps): ReactElement;
