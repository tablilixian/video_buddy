import type { ReactElement } from 'react';
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client';
export interface UserCardProps {
    /** 打开 Canvas Studio 设置弹窗（真实功能）。 */
    onOpenSettings(): void;
    /** 桌面主题运行时（真实功能；连接未就绪时主题组整体隐藏）。 */
    theme?: ThemeRuntime;
}
export declare function UserCard(props: UserCardProps): ReactElement;
