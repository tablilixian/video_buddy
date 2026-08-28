/**
 * Canvas Studio「模型」设置面板（provider 感知，完整功能）。
 *
 * 设计：不直接复用桌面 dsh 的 `ModelsSettingsStore` / `ModelsSection`（包内私有、
 * 不导出，且没有打开桌面设置页的命令），而是调用与 dsh **完全相同**的 Host wire
 * 接口（经 canvas-studio 已有的 `connection` 服务）：
 * - `llm.providers({})`            拉可配置 provider 目录（自部署 / OpenAI / DeepSeek / 自定义…）
 * - `settings.describe({})`        拉全量命名空间视图（含已解析值 + revision）
 * - `settings.mutate({...})`       写 provider profile（base URL / 模型清单 / apiKeyEnv）
 * - `credentials.set/describe`     密钥走凭据域，不落明文
 *
 * 因此本面板与桌面原生「模型」设置共享同一份存储：在桌面设置里看到的配置，这里也能
 * 改；反之亦然。写入格式严格对齐 dsh（path ops + 派生凭据引用），不会损坏其它字段。
 */
import { type ReactElement } from 'react';
import type { CanvasStudioModelApi, CanvasStudioSettingsScope } from './contracts.js';
export interface ModelSettingsPanelProps {
    /** 惰性取模型设置所需的 Host wire 接口。 */
    getModelApi: () => CanvasStudioModelApi | undefined;
    /** 绑定 settings 命名空间的作用域（默认模型写 'agent-default-model'）。 */
    settingsScope: CanvasStudioSettingsScope;
}
/** 模型设置面板主体。 */
export declare function ModelSettingsPanel(props: ModelSettingsPanelProps): ReactElement;
