/**
 * Canvas Studio 设置弹窗（浏览器半侧，自包含 UI）。
 *
 * 不依赖桌面全局 Plugins 面板（ui-settings-plugins 未装入当前桌面），由 canvas-studio
 * 自带弹窗承载配置；主页画布上的「设置」按钮 → 弹出本弹窗 → 分区编辑 → 经
 * 不同作用域回写：
 * - 通用：绑定 'canvas-studio' 命名空间（Drama 连接；Host 侧 source() 实时读到）。
 * - 输出 / 工作流 / 存储：同样绑定 'canvas-studio' 命名空间，分字段回写（画幅比例已接入
 *   生成兜底，其余字段待 P2-P4 管线消费，见 plan.md §1.7 消费状态表）。
 * - 主题：复用桌面 dsh-client-ui-theme 的 ctx.theme 运行时（全局浅色/深色/跟随系统）。
 * - 模型：自实现的 provider 感知面板（见 ModelSettingsPanel）。直接复用桌面 dsh 的
 *   `ModelsSettingsStore` / `ModelsSection` 不可行——它们包内私有、不导出，且没有打开
 *   桌面设置页的命令。本面板改为调用与 dsh 完全相同的 Host wire 接口（llm.providers /
 *   settings.describe + settings.mutate / credentials.set），因此与桌面「设置 → 模型」
 *   共享同一份存储、功能对等：支持 DeepSeek / Anthropic / 自部署 OpenAI 兼容 / 自定义
 *   provider，填 Base URL + API Key、拉模型清单、设为默认。该配置为桌面全局默认模型，
 *   驱动 Canvas Studio 创作流水线。
 *
 * 密钥走凭据域（credentials.set），不落明文。订阅方式照搬 dsh-plugin-desktop 的
 * DesktopSettingsSection.useScope（useSyncExternalStore）。
 */
import { type ReactElement } from 'react';
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client';
import type { CanvasStudioCredentials, CanvasStudioModelApi, CanvasStudioSettingsScope } from './contracts.js';
export interface SettingsModalProps {
    /** 绑定 'canvas-studio' 命名空间的 settings 作用域（通用分区用）。 */
    settingsScope: CanvasStudioSettingsScope;
    /** 惰性取凭据客户端（密钥写凭据域，不落明文）。 */
    getCredentials: () => CanvasStudioCredentials | undefined;
    /** 惰性取模型设置所需的 Host wire 接口（llm/settings/credentials 三域）。 */
    getModelApi: () => CanvasStudioModelApi | undefined;
    /** 惰性取桌面原生目录选择器（资产库位置用）；dsh workspaces 服务未就绪时返回 undefined。 */
    getDirectoryPicker: () => {
        pick: () => Promise<string | null>;
    } | undefined;
    /** 桌面主题运行时（主题分区复用，切换全局浅色/深色/跟随系统）。 */
    theme: ThemeRuntime;
    /** 关闭弹窗（点背景 / 关闭按钮 / Esc）。 */
    onClose: () => void;
}
/**
 * Render the Canvas Studio settings popup with six sections: 通用 / 主题 / 模型 / 输出 / 工作流 / 存储.
 * 通用/输出/工作流/存储经 canvas-studio 命名空间回写；主题经 ctx.theme；模型经 host wire 三域。
 */
export declare function SettingsModal(props: SettingsModalProps): ReactElement;
