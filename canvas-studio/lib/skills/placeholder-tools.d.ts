/**
 * 创建占位工具集（供 Host 的 `ctx.tools.register` 逐条注册）。
 * 每个工具不调用任何生成后端，只返回能力边界说明与替代路径。
 */
export declare function createPlaceholderTools(): import("@deepseek-ai/dsh-tools").ToolDefinition[];
