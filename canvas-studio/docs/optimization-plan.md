# Canvas Studio 下一阶段优化方案

> ⚠️ **本文档是纯设计稿，代码零落地。**
> 2026-09-01 核实：`WorkflowController` / `VersionManager` / `ModelAdapter` / `AssetLibrary` /
> `WorkflowProgress` / `resumePoint` 在 `canvas-studio/src/` 中**零匹配**。
> 五步工作流、双层版本控制、多模型适配、素材库、实时反馈五大模块及 Phase 1-4 里程碑均未启动。
> 其中多项已被更轻的 CV 条目覆盖（重试、审批闸、落点策略、loading 耗时、toast 等，见 STATUS.md）。
>
> **当前状态以 [STATUS.md](./STATUS.md) 为准。** 保留本文件作远期参考，不进当前排期。

## 一、项目背景与现状分析

### 1.1 项目定位
Canvas Studio 是 DSH Desktop 中的画布式 AI 视频创作工作流插件，基于 Cordis 插件系统，提供无限画布、节点编辑、媒体生成、成片合成等能力。

### 1.2 当前状态
- **已完成**：项目管理、无限画布、13个Agent工具、媒体生成、成片合成、参考闭环、审批门禁
- **进行中**：设置系统完善、多模型支持、国际化
- **待优化**：工作流流程、版本管理、素材管理、用户体验

### 1.3 对标分析（Open-Magiviz）
| 维度 | Open-Magiviz | Canvas Studio | 差距 |
|------|--------------|---------------|------|
| 工作流设计 | 五步串行，支持中断恢复 | 画布自由布局，无固定流程 | 流程规范性 |
| 版本管理 | 双层版本控制，历史回溯 | 单版本，无历史 | 版本追溯 |
| 多模型支持 | 12+模型，自动适配 | 单一Drama Backend | 模型丰富度 |
| 项目管理 | 完整生命周期，素材库 | 基础项目管理 | 管理深度 |
| 用户体验 | 进度条，实时状态，失败重试 | 基础状态提示 | 交互体验 |

## 二、优化目标与原则

### 2.1 核心目标
1. **流程规范化**：引入五步串行工作流，支持中断恢复
2. **版本可追溯**：实现双层版本控制，支持历史回溯
3. **模型多样化**：扩展AI视频生成模型支持，自动适配参数
4. **体验专业化**：提升交互体验，实时状态反馈，失败重试机制

### 2.2 设计原则
1. **插件化优先**：所有优化通过Cordis插件机制实现，零修改上游
2. **向后兼容**：现有功能不受影响，新功能渐进式启用
3. **桌面优先**：保持Electron本地优势，性能优先
4. **可测试性**：每个模块提供可验证的接口和测试用例

## 三、具体优化模块设计

### 3.1 五步串行工作流模块

#### 3.1.1 功能设计
```
创意输入 → AI剧情生成 → 角色设计 → 分镜生成 → 视频渲染 → 成品导出
```

#### 3.1.2 技术实现
```typescript
// 新增工作流状态机
interface WorkflowState {
  step: 'idle' | 'script' | 'character' | 'storyboard' | 'scenes' | 'video';
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'paused';
  progress: number; // 0-100
  data: WorkflowData;
  resumePoint?: string; // 中断恢复点
}

// 工作流控制器
class WorkflowController {
  private state: WorkflowState;
  private abortController?: AbortController;
  
  async start(prompt: string): Promise<void>;
  async pause(): Promise<void>;
  async resume(): Promise<void>;
  async retry(failedStep: string): Promise<void>;
  async cancel(): Promise<void>;
}
```

#### 3.1.3 UI组件
- **WorkflowProgress.tsx**：五步进度条，显示当前步骤、状态、进度
- **WorkflowControls.tsx**：开始、暂停、恢复、取消按钮
- **StepDetailPanel.tsx**：每个步骤的详细信息和操作

#### 3.1.4 验证标准
- [ ] 工作流可正常启动、暂停、恢复、取消
- [ ] 中断后重新打开项目能自动恢复到中断点
- [ ] 每个步骤失败后可单独重试
- [ ] 进度条实时更新，状态准确

### 3.2 双层版本控制系统

#### 3.2.1 数据结构设计
```typescript
interface ProjectVersion {
  id: string;
  projectId: string;
  version: number;
  versionGroupId: string;
  
  // 步骤数据
  scriptData?: ScriptData;
  characterData?: CharacterData[];
  storyboardData?: StoryboardData[];
  sceneVideoData?: SceneVideoData[];
  finalVideoUrl?: string;
  
  // 元信息
  createdAt: Date;
  completedAt?: Date;
  status: 'in_progress' | 'completed';
}

interface VersionGroup {
  id: string;
  projectId: string;
  name: string;
  versions: ProjectVersion[];
  currentVersionId: string;
}
```

#### 3.2.2 存储结构
```
$DSH_HOME/canvas-studio/<projectId>/
├── project.json          # 项目元信息
├── canvas.json           # 画布状态
├── versions/             # 版本目录
│   ├── vg-<versionGroupId>/
│   │   ├── v1.json       # 版本1数据
│   │   ├── v2.json       # 版本2数据
│   │   └── ...
│   └── ...
└── assets/               # 媒体资产
```

#### 3.2.3 API端点
```
GET    /canvas-studio/projects/:id/versions           # 获取版本列表
GET    /canvas-studio/projects/:id/versions/:vid      # 获取特定版本
POST   /canvas-studio/projects/:id/versions           # 创建新版本
PUT    /canvas-studio/projects/:id/versions/:vid      # 更新版本
DELETE /canvas-studio/projects/:id/versions/:vid      # 删除版本
```

#### 3.2.4 验证标准
- [ ] 每次重新生成自动创建新版本组
- [ ] 版本历史可查看、可回溯
- [ ] 未完成版本可继续生成
- [ ] 版本数据完整保存，不丢失

### 3.3 多模型适配层

#### 3.3.1 模型配置系统
```typescript
interface ModelConfig {
  id: string;
  name: string;
  provider: 'drama' | 'veo' | 'kling' | 'seedance' | 'wan';
  capabilities: {
    imageGeneration: boolean;
    videoGeneration: boolean;
    maxDuration: number;
    supportedAspectRatios: string[];
    supportedStyles: string[];
  };
  parameters: Record<string, any>;
  costPerSecond: number;
}

// 模型注册表
const MODEL_REGISTRY: Record<string, ModelConfig> = {
  'drama-fl2va': { /* ... */ },
  'veo31-fast': { /* ... */ },
  'kling3': { /* ... */ },
  // ...
};
```

#### 3.3.2 自动适配逻辑
```typescript
function adaptParameters(model: ModelConfig, request: GenerationRequest) {
  const adapted = { ...request };
  
  // 时长适配
  if (request.duration > model.capabilities.maxDuration) {
    adapted.duration = model.capabilities.maxDuration;
  }
  
  // 画幅适配
  if (!model.capabilities.supportedAspectRatios.includes(request.aspectRatio)) {
    adapted.aspectRatio = model.capabilities.supportedAspectRatios[0];
  }
  
  // 风格适配
  if (!model.capabilities.supportedStyles.includes(request.style)) {
    adapted.style = model.capabilities.supportedStyles[0];
  }
  
  return adapted;
}
```

#### 3.3.3 UI组件
- **ModelSelector.tsx**：模型选择器，显示模型信息、成本、能力
- **ModelComparison.tsx**：模型对比面板
- **CostEstimator.tsx**：成本预估器

#### 3.3.4 验证标准
- [ ] 支持至少5种AI视频生成模型
- [ ] 模型参数自动适配，不报错
- [ ] 成本预估准确
- [ ] 模型切换后工作流正常执行

### 3.4 素材库管理系统

#### 3.4.1 数据结构
```typescript
interface Asset {
  id: string;
  projectId: string;
  type: 'image' | 'video' | 'audio' | 'document';
  name: string;
  path: string;
  size: number;
  metadata: Record<string, any>;
  usedIn: string[]; // 引用此资产的节点ID
  createdAt: Date;
}

interface AssetLibrary {
  projectId: string;
  assets: Asset[];
  storageUsed: number;
  storageLimit: number;
}
```

#### 3.4.2 功能设计
1. **统一存储**：所有媒体资产集中管理
2. **引用追踪**：显示每个资产被哪些项目/节点使用
3. **一键导出**：支持单个/批量导出，多种格式
4. **存储监控**：显示已用/可用空间
5. **智能搜索**：按类型、大小、日期、名称搜索

#### 3.4.3 API端点
```
GET    /canvas-studio/projects/:id/assets              # 获取资产列表
POST   /canvas-studio/projects/:id/assets/upload       # 上传资产
DELETE /canvas-studio/projects/:id/assets/:aid         # 删除资产
GET    /canvas-studio/projects/:id/assets/:aid/download # 下载资产
GET    /canvas-studio/projects/:id/assets/:aid/usage   # 获取引用信息
```

#### 3.4.4 验证标准
- [ ] 资产上传、下载、删除正常
- [ ] 引用追踪准确
- [ ] 批量导出功能正常
- [ ] 存储空间监控准确

### 3.5 实时状态反馈系统

#### 3.5.1 状态管理
```typescript
interface GenerationStatus {
  taskId: string;
  nodeId: string;
  step: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  estimatedTimeRemaining?: number;
  error?: string;
  retryCount: number;
}
```

#### 3.5.2 UI反馈
- **节点状态指示器**：每个节点显示实时状态（处理中、完成、失败）
- **进度环/条**：显示生成进度百分比
- **失败覆盖层**：红色蒙层 + 错误信息 + 重试按钮
- **通知系统**：生成完成/失败时桌面通知

#### 3.5.3 重试机制
```typescript
class RetryManager {
  private maxRetries = 3;
  private retryDelay = 1000;
  
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options?: { maxRetries?: number; retryDelay?: number }
  ): Promise<T> {
    // 实现指数退避重试
  }
}
```

#### 3.5.4 验证标准
- [ ] 节点状态实时更新
- [ ] 进度显示准确
- [ ] 失败后自动重试（可配置）
- [ ] 桌面通知正常工作

## 四、技术实现方案

### 4.1 架构设计
```
┌─────────────────────────────────────────────────┐
│                 Canvas Studio Plugin             │
├─────────────────────────────────────────────────┤
│  Client Layer (React)                           │
│  ├─ WorkflowUI (五步进度条、控制面板)            │
│  ├─ VersionHistory (版本列表、对比)              │
│  ├─ ModelSelector (模型选择、对比)               │
│  ├─ AssetLibrary (素材管理、导出)                │
│  └─ StatusFeedback (状态指示、通知)              │
├─────────────────────────────────────────────────┤
│  Host Layer (Node.js)                           │
│  ├─ WorkflowEngine (工作流引擎)                  │
│  ├─ VersionManager (版本管理器)                  │
│  ├─ ModelAdapter (模型适配层)                    │
│  ├─ AssetManager (资产管理器)                    │
│  └─ StatusReporter (状态报告器)                  │
├─────────────────────────────────────────────────┤
│  Core Layer                                     │
│  ├─ ProjectStore (项目状态)                      │
│  ├─ CanvasEngine (画布引擎)                      │
│  ├─ MediaGenerator (媒体生成)                    │
│  └─ VideoComposer (视频合成)                    │
└─────────────────────────────────────────────────┘
```

### 4.2 文件结构
```
canvas-studio/src/
├── workflow/                    # 工作流模块
│   ├── WorkflowController.ts    # 工作流控制器
│   ├── WorkflowState.ts         # 状态定义
│   ├── steps/                   # 各步骤实现
│   │   ├── ScriptStep.ts
│   │   ├── CharacterStep.ts
│   │   ├── StoryboardStep.ts
│   │   ├── ScenesStep.ts
│   │   └── VideoStep.ts
│   └── client/                  # UI组件
│       ├── WorkflowProgress.tsx
│       ├── WorkflowControls.tsx
│       └── StepDetailPanel.tsx
├── versions/                    # 版本管理模块
│   ├── VersionManager.ts        # 版本管理器
│   ├── VersionStorage.ts        # 版本存储
│   └── client/
│       ├── VersionHistory.tsx
│       └── VersionCompare.tsx
├── models/                      # 多模型适配模块
│   ├── ModelRegistry.ts         # 模型注册表
│   ├── ModelAdapter.ts          # 参数适配
│   ├── ModelCost.ts             # 成本计算
│   └── client/
│       ├── ModelSelector.tsx
│       └── CostEstimator.tsx
├── assets/                      # 素材管理模块
│   ├── AssetManager.ts          # 资产管理器
│   ├── AssetStorage.ts          # 资产存储
│   ├── AssetExporter.ts         # 资产导出
│   └── client/
│       ├── AssetLibrary.tsx
│       └── AssetSearch.tsx
├── status/                      # 状态反馈模块
│   ├── StatusReporter.ts        # 状态报告器
│   ├── RetryManager.ts          # 重试管理器
│   ├── NotificationService.ts   # 通知服务
│   └── client/
│       ├── NodeStatusIndicator.tsx
│       └── ProgressDisplay.tsx
└── enhanced/                    # 增强现有模块
    ├── EnhancedProjectStore.ts  # 增强项目存储
    ├── EnhancedWorkflow.ts      # 增强工作流
    └── EnhancedUI.ts            # 增强UI
```

### 4.3 依赖管理
```json
{
  "dependencies": {
    "@deepseek-ai/dsh-client-runtime": "^1.0.0",
    "@deepseek-ai/dsh-client-ui-slots": "^1.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "typescript": "^6.0.3",
    "vitest": "^4.1.8",
    "tsdown": "^0.22.2"
  }
}
```

## 五、开发计划与里程碑

### 5.1 Phase 1：基础框架（2周）
**目标**：搭建优化模块的基础框架

| 任务 | 负责人 | 时间 | 交付物 |
|------|--------|------|--------|
| 工作流状态机设计 | 后端 | 3天 | WorkflowState.ts, WorkflowController.ts |
| 版本数据结构设计 | 后端 | 2天 | VersionManager.ts, VersionStorage.ts |
| 模型配置系统 | 后端 | 2天 | ModelRegistry.ts, ModelAdapter.ts |
| 素材管理接口 | 后端 | 2天 | AssetManager.ts, AssetStorage.ts |
| 状态反馈框架 | 后端 | 1天 | StatusReporter.ts, RetryManager.ts |
| UI组件库搭建 | 前端 | 2天 | 基础UI组件 |

**验收标准**：
- [ ] 所有模块接口定义完成
- [ ] 单元测试覆盖率 > 80%
- [ ] 文档完整

### 5.2 Phase 2：核心功能（3周）
**目标**：实现核心功能模块

| 任务 | 负责人 | 时间 | 交付物 |
|------|--------|------|--------|
| 五步工作流实现 | 全栈 | 5天 | 完整工作流引擎 |
| 版本管理系统 | 全栈 | 4天 | 版本创建、查询、回溯 |
| 多模型适配 | 全栈 | 3天 | 模型切换、参数适配 |
| 素材库管理 | 全栈 | 3天 | 上传、下载、引用追踪 |
| 实时状态反馈 | 全栈 | 3天 | 状态更新、通知 |

**验收标准**：
- [ ] 工作流可正常执行五步流程
- [ ] 版本管理功能完整
- [ ] 支持至少3种AI模型
- [ ] 素材管理功能完整
- [ ] 状态反馈实时准确

### 5.3 Phase 3：UI集成（2周）
**目标**：完成UI集成和用户体验优化

| 任务 | 负责人 | 时间 | 交付物 |
|------|--------|------|--------|
| 工作流UI集成 | 前端 | 3天 | 进度条、控制面板 |
| 版本历史UI | 前端 | 2天 | 版本列表、对比视图 |
| 模型选择UI | 前端 | 2天 | 模型选择器、成本预估 |
| 素材库UI | 前端 | 2天 | 资产列表、搜索、导出 |
| 状态指示UI | 前端 | 2天 | 节点状态、进度显示 |
| 整体UI优化 | 前端 | 2天 | 样式统一、交互优化 |

**验收标准**：
- [ ] 所有UI组件正常工作
- [ ] 交互流畅，无卡顿
- [ ] 样式统一，符合设计规范

### 5.4 Phase 4：测试与优化（1周）
**目标**：全面测试和性能优化

| 任务 | 负责人 | 时间 | 交付物 |
|------|--------|------|--------|
| 单元测试 | 全员 | 2天 | 测试用例、测试报告 |
| 集成测试 | 全员 | 2天 | 集成测试用例 |
| 性能测试 | 后端 | 1天 | 性能报告 |
| 问题修复 | 全员 | 2天 | Bug修复 |

**验收标准**：
- [ ] 测试覆盖率 > 90%
- [ ] 性能指标达标
- [ ] 无Critical Bug

## 六、验证与测试策略

### 6.1 单元测试
```typescript
// 示例：工作流控制器测试
describe('WorkflowController', () => {
  it('should start workflow', async () => {
    const controller = new WorkflowController();
    await controller.start('测试提示词');
    expect(controller.state.step).toBe('script');
    expect(controller.state.status).toBe('executing');
  });
  
  it('should pause and resume workflow', async () => {
    const controller = new WorkflowController();
    await controller.start('测试提示词');
    await controller.pause();
    expect(controller.state.status).toBe('paused');
    await controller.resume();
    expect(controller.state.status).toBe('executing');
  });
});
```

### 6.2 集成测试
```typescript
// 示例：端到端工作流测试
describe('End-to-End Workflow', () => {
  it('should complete full workflow', async () => {
    const project = await createTestProject();
    const workflow = new WorkflowController(project.id);
    
    await workflow.start('测试提示词');
    
    // 等待每一步完成
    await waitForStep('script');
    await waitForStep('character');
    await waitForStep('storyboard');
    await waitForStep('scenes');
    await waitForStep('video');
    
    const finalVideo = await getFinalVideo(project.id);
    expect(finalVideo).toBeDefined();
  });
});
```

### 6.3 性能测试
- **工作流执行时间**：五步流程 < 5分钟（本地）
- **版本创建时间**：< 1秒
- **模型切换时间**：< 500ms
- **素材上传速度**：> 10MB/s
- **状态更新延迟**：< 100ms

### 6.4 用户验收测试
1. **工作流测试**：创建项目 → 执行工作流 → 中断恢复 → 完成
2. **版本管理测试**：创建版本 → 查看历史 → 回溯版本 → 继续生成
3. **模型切换测试**：切换模型 → 参数适配 → 执行生成
4. **素材管理测试**：上传素材 → 引用追踪 → 批量导出
5. **状态反馈测试**：观察状态更新 → 失败重试 → 通知接收

## 七、风险评估与应对

### 7.1 技术风险
| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| 工作流状态同步问题 | 高 | 中 | 实现状态快照、断点续传 |
| 多模型适配复杂度 | 中 | 高 | 模块化设计、逐步扩展 |
| 版本数据一致性 | 高 | 低 | 事务性写入、校验和 |
| 性能瓶颈 | 中 | 中 | 异步处理、缓存优化 |

### 7.2 项目风险
| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|----------|
| 开发周期延长 | 中 | 中 | 分阶段交付、MVP优先 |
| 需求变更 | 中 | 高 | 模块化设计、接口稳定 |
| 依赖服务不可用 | 高 | 低 | 健康检查、降级方案 |

### 7.3 应对策略
1. **渐进式开发**：每个Phase独立交付，降低风险
2. **接口优先**：先定义接口，再实现细节
3. **测试驱动**：TDD开发，保证质量
4. **文档同步**：代码与文档同步更新

## 八、成功标准

### 8.1 功能标准
- [ ] 五步工作流完整可用，支持中断恢复
- [ ] 双层版本控制系统稳定运行
- [ ] 支持5+种AI视频生成模型
- [ ] 素材库管理功能完整
- [ ] 实时状态反馈准确及时

### 8.2 性能标准
- [ ] 工作流执行时间 < 5分钟
- [ ] 版本操作响应时间 < 1秒
- [ ] 状态更新延迟 < 100ms
- [ ] 内存占用增长 < 20%

### 8.3 质量标准
- [ ] 测试覆盖率 > 90%
- [ ] 无Critical Bug
- [ ] 文档完整度 > 95%
- [ ] 代码审查通过率 100%

## 九、总结

本优化方案基于Open-Magiviz的成熟功能设计，结合Canvas Studio的现有架构，通过五个核心模块的优化，显著提升视频创作工作流的专业性和用户体验。方案遵循插件化、向后兼容、桌面优先的原则，确保可执行、可验证、可扩展。

通过四个阶段的迭代开发，预计6周内完成所有优化，使Canvas Studio在功能完整性、用户体验、技术架构方面达到行业领先水平。

## 十、详细技术实现

### 10.1 工作流引擎实现

#### 10.1.1 状态机核心
```typescript
// src/workflow/WorkflowEngine.ts
export class WorkflowEngine {
  private state: WorkflowState;
  private steps: Map<string, WorkflowStep>;
  private eventEmitter: EventEmitter;
  
  constructor(projectId: string) {
    this.state = {
      projectId,
      step: 'idle',
      status: 'pending',
      progress: 0,
      data: {},
      history: []
    };
    this.steps = new Map();
    this.eventEmitter = new EventEmitter();
    this.registerSteps();
  }
  
  private registerSteps() {
    this.steps.set('script', new ScriptStep());
    this.steps.set('character', new CharacterStep());
    this.steps.set('storyboard', new StoryboardStep());
    this.steps.set('scenes', new ScenesStep());
    this.steps.set('video', new VideoStep());
  }
  
  async execute(prompt: string, options?: WorkflowOptions): Promise<void> {
    this.state.status = 'executing';
    this.state.data.prompt = prompt;
    
    const stepOrder = ['script', 'character', 'storyboard', 'scenes', 'video'];
    
    for (const stepName of stepOrder) {
      if (options?.resumeFrom && stepOrder.indexOf(stepName) < 
          stepOrder.indexOf(options.resumeFrom)) {
        continue;
      }
      
      await this.executeStep(stepName);
    }
    
    this.state.status = 'completed';
    this.eventEmitter.emit('workflow:completed', this.state);
  }
  
  private async executeStep(stepName: string): Promise<void> {
    const step = this.steps.get(stepName);
    if (!step) throw new Error(`Unknown step: ${stepName}`);
    
    this.state.step = stepName as any;
    this.state.status = 'executing';
    this.eventEmitter.emit('step:started', { step: stepName });
    
    try {
      const result = await step.execute(this.state.data, this.eventEmitter);
      this.state.data = { ...this.state.data, ...result };
      this.state.status = 'completed';
      this.eventEmitter.emit('step:completed', { step: stepName, result });
    } catch (error) {
      this.state.status = 'failed';
      this.state.error = error.message;
      this.eventEmitter.emit('step:failed', { step: stepName, error });
      throw error;
    }
  }
  
  async pause(): Promise<void> {
    this.state.status = 'paused';
    this.state.resumePoint = this.state.step;
    this.eventEmitter.emit('workflow:paused', this.state);
  }
  
  async resume(): Promise<void> {
    if (this.state.status !== 'paused') {
      throw new Error('Workflow is not paused');
    }
    
    await this.execute(this.state.data.prompt, {
      resumeFrom: this.state.resumePoint
    });
  }
}
```

#### 10.1.2 步骤实现示例
```typescript
// src/workflow/steps/ScriptStep.ts
export class ScriptStep implements WorkflowStep {
  name = 'script';
  
  async data: WorkflowData, eventEmitter: EventEmitter
  ): Promise<Partial<WorkflowData>> {
    const { prompt, duration, aspectRatio, videoStyle, videoModel } = data;
    
    // 调用AI生成剧情
    const response = await fetch('/canvas-studio/generate-script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        duration,
        aspectRatio,
        videoStyle,
        videoModel
      })
    });
    
    if (!response.ok) {
      throw new Error(`Script generation failed: ${response.statusText}`);
    }
    
    const scriptData = await response.json();
    
    // 发送进度更新
    eventEmitter.emit('step:progress', {
      step: this.name,
      progress: 100,
      data: scriptData
    });
    
    return { scriptData };
  }
}
```

### 10.2 版本管理系统

#### 10.2.1 版本存储实现
```typescript
// src/versions/VersionStorage.ts
export class VersionStorage {
  private basePath: string;
  
  constructor(projectId: string) {
    this.basePath = `$DSH_HOME/canvas-studio/${projectId}/versions`;
  }
  
  async createVersionGroup(name: string): Promise<VersionGroup> {
    const groupId = `vg-${uuid()}`;
    const groupPath = `${this.basePath}/${groupId}`;
    
    await fs.mkdir(groupPath, { recursive: true });
    
    const group: VersionGroup = {
      id: groupId,
      projectId: this.projectId,
      name,
      versions: [],
      currentVersionId: ''
    };
    
    await this.writeJson(`${groupPath}/group.json`, group);
    return group;
  }
  
  async createVersion(
    groupId: string, 
    data: Partial<ProjectVersion>
  ): Promise<ProjectVersion> {
    const group = await this.getVersionGroup(groupId);
    const versionNumber = group.versions.length + 1;
    const versionId = `v${versionNumber}`;
    
    const version: ProjectVersion = {
      id: versionId,
      projectId: this.projectId,
      version: versionNumber,
      versionGroupId: groupId,
      createdAt: new Date(),
      status: 'in_progress',
      ...data
    };
    
    const versionPath = `${this.basePath}/${groupId}/${versionId}.json`;
    await this.writeJson(versionPath, version);
    
    group.versions.push(version);
    group.currentVersionId = versionId;
    
    await this.writeJson(
      `${this.basePath}/${groupId}/group.json`, 
      group
    );
    
    return version;
  }
  
  async getVersion(
    groupId: string, 
    versionId: string
  ): Promise<ProjectVersion> {
    const versionPath = `${this.basePath}/${groupId}/${versionId}.json`;
    return await this.readJson(versionPath);
  }
  
  async updateVersion(
    groupId: string,
    versionId: string,
    updates: Partial<ProjectVersion>
  ): Promise<ProjectVersion> {
    const version = await this.getVersion(groupId, versionId);
    const updatedVersion = { ...version, ...updates };
    
    const versionPath = `${this.basePath}/${groupId}/${versionId}.json`;
    await this.writeJson(versionPath, updatedVersion);
    
    return updatedVersion;
  }
}
```

### 10.3 多模型适配器

#### 10.3.1 模型配置
```typescript
// src/models/ModelRegistry.ts
export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'drama-fl2va': {
    id: 'drama-fl2va',
    name: 'Drama FL2VA',
    provider: 'drama',
    capabilities: {
      imageGeneration: true,
      videoGeneration: true,
      maxDuration: 15,
      supportedAspectRatios: ['16:9', '9:16', '1:1'],
      supportedStyles: ['realistic', 'anime', 'cinematic']
    },
    parameters: {
      temperature: 0.7,
      maxTokens: 2048
    },
    costPerSecond: 0.1
  },
  'veo31-fast': {
    id: 'veo31-fast',
    name: 'Veo 3.1 Fast',
    provider: 'veo',
    capabilities: {
      imageGeneration: false,
      videoGeneration: true,
      maxDuration: 8,
      supportedAspectRatios: ['16:9', '9:16'],
      supportedStyles: ['realistic', 'cinematic']
    },
    parameters: {
      quality: 'fast'
    },
    costPerSecond: 0.15
  },
  // ... 更多模型配置
};
```

#### 10.3.2 参数适配器
```typescript
// src/models/ModelAdapter.ts
export class ModelAdapter {
  private registry: Map<string, ModelConfig>;
  
  constructor() {
    this.registry = new Map(Object.entries(MODEL_CONFIGS));
  }
  
  adaptRequest(
    modelId: string, 
    request: GenerationRequest
  ): AdaptedRequest {
    const config = this.registry.get(modelId);
    if (!config) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    
    const adapted = { ...request };
    
    // 时长适配
    if (request.duration > config.capabilities.maxDuration) {
      adapted.duration = config.capabilities.maxDuration;
      console.warn(
        `Duration reduced to ${config.capabilities.maxDuration}s for model ${modelId}`
      );
    }
    
    // 画幅适配
    if (!config.capabilities.supportedAspectRatios.includes(request.aspectRatio)) {
      adapted.aspectRatio = config.capabilities.supportedAspectRatios[0];
      console.warn(
        `Aspect ratio changed to ${adapted.aspectRatio} for model ${modelId}`
      );
    }
    
    // 风格适配
    if (!config.capabilities.supportedStyles.includes(request.style)) {
      adapted.style = config.capabilities.supportedStyles[0];
      console.warn(
        `Style changed to ${adapted.style} for model ${modelId}`
      );
    }
    
    return {
      ...adapted,
      modelConfig: config
    };
  }
  
  estimateCost(modelId: string, duration: number): number {
    const config = this.registry.get(modelId);
    if (!config) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    
    return duration * config.costPerSecond;
  }
}
```

## 十一、UI设计规范

### 11.1 设计令牌
```css
/* styles/tokens.css */
:root {
  /* 颜色 */
  --cs-primary: #3b82f6;
  --cs-primary-hover: #2563eb;
  --cs-success: #10b981;
  --cs-warning: #f59e0b;
  --cs-error: #ef4444;
  --cs-info: #6366f1;
  
  /* 间距 */
  --cs-spacing-xs: 4px;
  --cs-spacing-sm: 8px;
  --cs-spacing-md: 16px;
  --cs-spacing-lg: 24px;
  --cs-spacing-xl: 32px;
  
  /* 圆角 */
  --cs-radius-sm: 4px;
  --cs-radius-md: 8px;
  --cs-radius-lg: 12px;
  
  /* 阴影 */
  --cs-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --cs-shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --cs-shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
  
  /* 字体 */
  --cs-font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --cs-font-mono: 'Fira Code', monospace;
  
  /* 动画 */
  --cs-transition-fast: 150ms ease;
  --cs-transition-normal: 300ms ease;
  --cs-transition-slow: 500ms ease;
}
```

### 11.2 组件规范
```typescript
// components/WorkflowProgress.tsx
interface WorkflowProgressProps {
  steps: WorkflowStep[];
  currentStep: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  progress: number;
}

export const WorkflowProgress: React.FC<WorkflowProgressProps> = ({
  steps,
  currentStep,
  status,
  progress
}) => {
  return (
    <div className="cs-workflow-progress">
      {steps.map((step, index) => {
        const isActive = step.id === currentStep;
        const isCompleted = steps.findIndex(s => s.id === currentStep) > index;
        const isFailed = status === 'failed' && isActive;
        
        return (
          <div
            key={step.id}
            className={cs-progress-step({
              active: isActive,
              completed: isCompleted,
              failed: isFailed
            })}
          >
            <div className="cs-progress-step-icon">
              {isCompleted ? (
                <CheckIcon className="cs-icon-success" />
              ) : isFailed ? (
                <XIcon className="cs-icon-error" />
              ) : isActive ? (
                <LoaderIcon className="cs-icon-spinning" />
              ) : (
                <span className="cs-step-number">{index + 1}</span>
              )}
            </div>
            <div className="cs-progress-step-content">
              <div className="cs-progress-step-title">{step.name}</div>
              <div className="cs-progress-step-description">
                {step.description}
              </div>
            </div>
            {isActive && status === 'executing' && (
              <div className="cs-progress-bar">
                <div 
                  className="cs-progress-bar-fill"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
```

## 十二、部署与上线计划

### 12.1 环境准备
```yaml
# .github/workflows/deploy.yml
name: Deploy Canvas Studio

on:
  push:
    branches: [main]
    paths:
      - 'canvas-studio/**'

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '22'
          
      - name: Install dependencies
        run: corepack yarn install --immutable
        
      - name: Run tests
        run: corepack yarn test
        
      - name: Build
        run: corepack yarn build
        
      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: canvas-studio
          path: canvas-studio/lib/
```

### 12.2 发布流程
1. **开发环境**：本地开发，使用 `corepack yarn dev`
2. **测试环境**：推送至 `develop` 分支，自动部署到测试环境
3. **预发布环境**：推送至 `release/*` 分支，自动部署到预发布环境
4. **生产环境**：合并至 `main` 分支，自动发布到生产环境

### 12.3 监控与告警
```typescript
// src/monitoring/MetricsCollector.ts
export class MetricsCollector {
  private metrics: Map<string, number>;
  private timers: Map<string, number>;
  
  constructor() {
    this.metrics = new Map();
    this.timers = new Map();
  }
  
  increment(name: string, value: number = 1): void {
    const current = this.metrics.get(name) || 0;
    this.metrics.set(name, current + value);
  }
  
  startTimer(name: string): void {
    this.timers.set(name, Date.now());
  }
  
  endTimer(name: string): number {
    const start = this.timers.get(name);
    if (!start) {
      throw new Error(`Timer ${name} not started`);
    }
    
    const duration = Date.now() - start;
    this.timers.delete(name);
    this.increment(`${name}_duration`, duration);
    
    return duration;
  }
  
  getMetrics(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }
}
```

## 十三、维护与支持

### 13.1 文档维护
- **API文档**：使用TypeDoc自动生成，随代码更新
- **用户指南**：Markdown格式，存储在 `docs/` 目录
- **开发者指南**：包含架构设计、开发规范、贡献指南

### 13.2 版本管理
- **语义化版本**：遵循 SemVer 规范
- **变更日志**：每个版本发布时更新 CHANGELOG.md
- **迁移指南**：重大变更提供迁移指南

### 13.3 支持渠道
- **GitHub Issues**：Bug报告和功能请求
- **Discussions**：社区讨论和问答
- **Discord**：实时沟通和社区支持

## 十四、附录

### 14.1 术语表
| 术语 | 定义 |
|------|------|
| Cordis | 插件化基础框架，用于DSH Desktop的插件系统 |
| Drama Backend | AI媒体生成后端服务 |
| Workflow | 工作流，指视频创作的完整流程 |
| Version Group | 版本组，关联同一批次的所有重新生成任务 |
| HITL | Human-in-the-Loop，人机协作模式 |

### 14.2 参考文献
1. Open-Magiviz GitHub Repository: https://github.com/ItusiAI/Open-Magiviz
2. DSH Desktop Documentation: ./docs/
3. Cordis Plugin System: https://github.com/cordiverse/cordis
4. Electron Documentation: https://www.electronjs.org/docs

### 14.3 变更记录
| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|----------|
| 1.0.0 | 2026-09-01 | AI助手 | 初始版本 |
