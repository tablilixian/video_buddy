import type { ReactElement } from 'react';
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CanvasStudioConfig } from '../host-config.js';
/** api.credentials 的最小结构类型（仅取本卡片实际调用的两个方法）。 */
interface CredentialsClient {
    set(req: {
        ref: string;
        value: string;
    }): Promise<void>;
    describe(req: {
        refs: string[];
    }): Promise<{
        credentials: Record<string, {
            configured: boolean;
            writable: boolean;
        }>;
    }>;
}
/** 卡片经 inject face 注入的业务面：一个命名空间作用域 + 凭据客户端。 */
interface CanvasStudioCardFace {
    scope: SettingsScope<CanvasStudioConfig>;
    credentials: CredentialsClient;
}
/** 渲染卡片：两个普通字段输入框 + 一个密钥输入（写凭据域）。 */
export type CanvasStudioCardProps = PropsRuntime<'settings.plugin.item'> & InjectFace<CanvasStudioCardFace>;
/**
 * 浏览器半侧入口：把 canvas-studio 的配置卡注册进 Plugins 分区。
 * 返回 slots 注销函数，由调用方经 `ctx.effect` 托管生命周期（与
 * registerStudioRoutes / registerCreationSkill 同构：回调须回吐 disposer）。
 */
export declare function apply(ctx: ClientContext): () => void;
/** 渲染卡片：两个普通字段输入框 + 一个密钥输入（写凭据域）。 */
export declare function CanvasStudioCard(props: CanvasStudioCardProps): ReactElement;
export {};
