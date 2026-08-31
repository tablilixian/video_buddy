/**
 * Canvas Studio 客户端类型契约枢纽。
 *
 * 槽位注册表在运行时与 Desktop 宿主共享，但 `SlotMap` 类型按各客户端包分别
 * 解析：`@deepseek-ai/dsh-client-ui-slots` 默认导出空 `SlotMap`，每个消费包
 * 增强自己所拥有的槽位。Canvas Studio 直接依赖的呈现包（ui-layout /
 * ui-conversation 等）已增强上游槽位（sidebar / conversation / details /
 * shell.overlay 等）；本包只声明自身拥有的 `root`（其 StudioFrame），并保留
 * ui-settings 经 `@deepseek-ai/cordis` 注入的 `settingsScope` 服务类型。
 *
 * 历史：`settings.plugin.item` / `sidebar.settings` 槽位由桌面的 ui-settings-plugins
 * 与 ui-sidebar 包拥有，本桌面未装入前者，导致依赖它们的卡片成为孤儿。设置 UI 已
 * 改为 canvas-studio 自带的弹窗（SettingsModal），不再依赖这两个第三方槽位。
 *
 * 运行时归属：Canvas Studio 拥有 `root`（其 StudioFrame），并声明其下的上游
 * 子槽位；Desktop 宿主让出 `root`，二者不争同一槽位。
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
/** Owner share of `conversation.hero.brand.mark`：dsh 上游定义同名类型，本地复制以避免
 * 依赖上游运行时类型导出（上游 dist 与 src 导出表偶有差异）。 */
export interface HeroBrandMarkOwnerProps {
    /** Requested square edge in pixels (dsh passes 34 for the blank-session hero). */
    size: number;
    /** Host CSS class for preserving the default hero mark color and hover motion. */
    className?: string | undefined;
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** Canvas Studio 主表面；Desktop 宿主渲染进同一视口。 */
        'root': {
            kind: 'single';
            scope: 'root';
            owner: Record<never, never>;
        };
        /**
         * 对话空态 hero 的品牌标识（替换官方 FishLogo 为场记板）。
         * owner 由 dsh `ui-conversation` 在 HeroShell 渲染时提供 `{size, className}`，
         * fallback 是 FishLogo。本地定义于 HeroBrandMarkOwnerProps（与上游一致）。
         */
        'conversation.hero.brand.mark': {
            kind: 'single';
            scope: 'root';
            owner: HeroBrandMarkOwnerProps;
        };
    }
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        /** 绑定某个 settings 命名空间的响应式作用域（ui-settings 注入）。 */
        settingsScope: {
            bind<T>(spec: {
                namespace: string;
                decode?: (section: unknown) => T | undefined;
            }): SettingsScope<T>;
        };
    }
}
