/**
 * Canvas Studio 客户端类型契约枢纽。
 *
 * 槽位注册表在运行时与 Desktop 宿主共享，但 `SlotMap` 类型按各客户端包分别
 * 解析：`@deepseek-ai/dsh-client-ui-slots` 默认导出空 `SlotMap`，每个消费包
 * 增强自己所拥有的槽位。Canvas Studio 直接依赖的呈现包（ui-layout /
 * ui-conversation 等）已增强上游槽位（sidebar / conversation / details /
 * shell.overlay 等）；而本包未直接链接、但运行时由宿主提供的两个第三方槽位——
 * `sidebar.settings`（设置外壳）与 `settings.plugin.item`（Plugins 分区配置卡）——
 * 需在此等价重新声明，否则 settings-card / StudioFrame 无法解析其类型。
 *
 * 另：本包的 `ctx.settingsScope` 由 ui-settings 经 `@deepseek-ai/cordis` 的
 * Context 扩展注入，同样因未链接该包而在本编译环境缺失，此处一并声明。
 *
 * 运行时归属：Canvas Studio 拥有 `root`（其 StudioFrame），并声明其下的上游
 * 子槽位；Desktop 宿主让出 `root`，二者不争同一槽位。
 */
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** Canvas Studio 主表面；Desktop 宿主渲染进同一视口。 */
        'root': {
            kind: 'single';
            scope: 'root';
            owner: Record<never, never>;
        };
        /** 设置外壳占位方（由 ui-settings-general 渲染）；canvas-studio 在 root 内重挂载以恢复设置入口。 */
        'sidebar.settings': {
            kind: 'single';
            scope: 'root';
            owner: {
                children?: never;
            };
        };
        /** Plugins 分区中一张插件的配置卡（按 settings namespace 键控）；canvas-studio 注册自己的卡。 */
        'settings.plugin.item': {
            kind: 'keyed';
            scope: 'root';
            owner: {
                children?: never;
            };
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
