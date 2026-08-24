# Agent Role 需求与初步设计

> 状态：Draft
> 范围：Agent Role V1，不包含记忆功能

## 背景

Lody 已经支持在不同 Machine 上配置 Agent Provider / Agent Config，在创建 Session 时选择模型、思考等级和其他 ACP 运行参数，也支持 Agent 通过 Lody MCP 在当前对话中创建新的 Session。

目前，如果用户希望 Agent 使用指定 Provider、模型和思考等级创建 Session，需要在 Prompt 中手动描述这些配置。Agent Role 用于把常用配置保存为可命名、可 mention、可复用的 Session 创建预设。

## 概念边界

| 对象 | 职责 |
| --- | --- |
| Agent Provider / Agent Config | 定义 Agent 如何启动，包括运行时、认证、环境变量和所属 Machine |
| Agent Role | 定义如何使用某个 Agent Config，包括模型、思考等级、运行参数和预设 Prompt |
| Session | 一次具体执行；创建时冻结 Role 的有效配置 |

Agent Role 不是新的 Provider，不保存 Provider 密钥，也不是长期运行的 Agent 实例。

## V1 目标

1. 用户可以在 Settings 中创建、编辑、删除和复制 Agent Role。
2. Role 可以预设 Agent Config、模型、思考等级、其他非敏感运行参数和 Prompt 前缀。
3. Role 默认是 `private`，用户可以将其共享到 workspace。
4. 用户可以在对话中通过 `@role` mention Role，让当前 Agent 使用该 Role 创建新 Session。
5. 当前项目是 GitHub 项目时，允许 mention 其他已授权 Machine 上的 Role。
6. Role 被 mention 后，其配置立即冻结为本次调用快照；后续编辑或删除 Role 不影响已接受的操作。

## V1 非目标

- Role 级长期记忆、知识库或独立上下文。
- Prompt 模板变量或复杂 Prompt 组装语言。
- 在 Role 中保存 API Key、Token、环境变量或其他 Provider 密钥。
- Role 级 MCP Server 选择。
- 自动批准等高风险权限策略。
- 通过 mention 中途切换当前 Session 的 Provider 或模型。

## 数据模型

```ts
type AgentRoleVisibility = 'private' | 'workspace'

type AgentRoleRunConfig = {
  modeId?: string
  modelId?: string
  configOptionValues?: Record<string, string | boolean>
}

type AgentRole = {
  v: 1
  id: AgentRoleId
  ownerUserId: string
  visibility: AgentRoleVisibility

  name: string
  mentionSlug: string
  description?: string

  machineId: MachineId
  agentConfigId: AgentConfigId
  runConfig: AgentRoleRunConfig
  promptPrefix?: string

  revision: number
  createdAt: number
  updatedAt: number
}
```

关键约束：

- `id` 是稳定身份，不随名称或 mention slug 变化。
- mention range 携带 Role id，不能使用可变 slug 作为持久化主键。
- `machineId + agentConfigId` 精确绑定执行位置和 Provider 配置。V1 不做跨 Machine Provider 自动映射。
- `configOptionValues` 只能保存 Agent capability 已公布的非敏感选项。命中 key、token、secret、password 等敏感名称的选项不能保存。
- `revision` 在每次有效编辑后递增。
- Role 不复制 Agent Config 的环境变量、启动命令或运行时密钥。

## 存储与共享

### 单一 workspace catalog

V1 使用一个 workspace 级 Role catalog，不拆分 private 和 workspace 两个目录文档。建议在现有 workspace Flock 中增加新的 row family：

```ts
type WorkspaceFlockAgentRoleKey = ['agentRole', AgentRoleId]
```

创建、编辑、分享和取消分享都是同一行的普通更新，不需要在两个文档间搬迁数据。

当前用户可以访问的 Role 为：

```ts
role.ownerUserId === currentUserId || role.visibility === 'workspace'
```

所有 Settings、mention 搜索、MCP Role 解析和 Session 创建入口必须复用同一套权威访问检查，不能只在 UI 中隐藏 private Role。

写入规则：

- 新 Role 默认写入 `visibility: 'private'`。
- 默认只有 owner 可以编辑、分享、取消分享和删除 Role。
- 分享前检查 Role 绑定的 Machine 是否对 workspace 可用，否则阻止分享或明确标记为其他成员不可执行。
- catalog 修改先保证本地持久化，再显式同步。同步失败时保留本地结果并显示“已保存但尚未同步”，不能报告为已完成分享。

### V1 private 语义

`private` 表示其他 workspace 成员不能通过产品功能发现、mention 或执行该 Role。

如果 workspace Flock 原始行会复制到所有成员客户端，这并不提供传输层或存储层保密性。因此 V1 禁止在 Role 中保存 secret。如果以后要求 private Role Prompt 也不能被其他成员的原始副本接收，应增加 row 级授权或加密，而不是现在拆分两个 catalog。

## Settings 交互

在 Settings 的 Agents 附近新增独立的 **Agent Roles** 页面。Provider 配置和 Role 配置不合并到同一个编辑弹窗中。

Role 列表展示：

- Role 名称和 `@mentionSlug`。
- Private / Workspace 状态。
- Machine、Agent Provider、Model 和 Reasoning。
- 是否配置 Prompt。
- 当前是否可执行，以及不可执行的精确原因。

Role 编辑页面包含：

- Name、mention slug 和 description。
- Machine 和该 Machine 上的 Agent Config。
- 从所选 Agent capability 生成的 Model、Reasoning、Mode、Plan/Fast 等选项。
- Prompt prefix。
- 默认关闭的 `Share with workspace` 开关。
- 配置预览和兼容性警告。

如果 Agent Config 被删除、Machine 不可访问或模型能力发生变化，Role 应保留但标记为 `Unavailable`。系统不能静默回退到其他 Machine、Provider、模型或思考等级。

## Mention 体验

`@` 菜单新增 **Agent Roles** category，支持通过以下方式查找：

```text
@role:reviewer
```

选中后，输入框显示简洁文本：

```text
@reviewer 请 review 当前实现
```

候选项详情展示 Provider、Machine、Model、Reasoning 和可见性。mention range 使用稳定 id：

```ts
{
  kind: 'agent_role',
  value: role.id,
}
```

持久化后的 message text span 同样使用 `agent_role`，让 Transcript 能还原 Role chip，而不是显示机器可读的 Session 创建指令。

### Work context 过滤

Role 必须先通过可见性、Machine 访问权限和 Agent Config 可用性检查，再根据当前工作上下文过滤：

| 当前 work context | 可 mention 范围 |
| --- | --- |
| Local Project | 仅该 Local Project 所在 Machine 上可执行的 Role |
| GitHub Project | 所有已授权 Machine 上可执行的 Role，包括跨 Machine Role |
| 需要共享当前物理 workspace 的 child Session | 仅当前 Machine 上的 Role |
| 无项目的纯 Chat | V1 默认仅当前 Machine；跨 Machine 可后续单独开放 |

Machine 离线、Agent Config 不存在或 capability 不兼容时，Role 可继续出现在 Settings 中，但不能作为可提交的 mention 候选。mention 菜单可以显示禁用项及其原因，帮助用户修复配置。

## GitHub 跨 Machine 行为

当当前 Session 绑定 GitHub 项目时，Role 可以指向另一台 Machine。目标 Session 使用 Role 的 Machine 和 Agent Config，并复用当前 GitHub work context：

```ts
{
  machineId: role.machineId,
  agentConfigId: role.agentConfigId,
  workContext: {
    kind: 'github',
    repo: currentRepo,
    branch: currentBranch,
  },
}
```

跨 Machine GitHub Session 必须是独立 Session：

- 在目标 Machine 上独立 clone 或创建 worktree。
- 通过 `openedBySessionId` 记录精确的发起 Session。
- 不使用 `parentSessionId` 表达跨 Machine 关系。
- 不使用 `useCurrentSessionAsParent=true`，因为它暗示共享物理 workspace。
- 继续执行现有 Machine、GitHub repo 和 Session 创建权限检查。

如果目标 Machine 离线或 Agent Config 不可用，创建返回明确错误，不能回退到当前 Machine。

## Role 调用快照

Role mention 在发送当前 Turn 时解析为不可变快照：

```ts
type AgentRoleInvocationSnapshot = {
  roleId: AgentRoleId
  roleRevision: number
  roleName: string
  machineId: MachineId
  agentConfigId: AgentConfigId
  runConfig: AgentRoleRunConfig
  promptPrefix?: string
}
```

快照作为当前用户 Turn input config 的一部分持久化：

```ts
type SessionTurnInputConfig = {
  // Existing fields...
  agentRoleInvocations?: AgentRoleInvocationSnapshot[]
}
```

这不是第二份 Role catalog，而是该用户 Turn 实际授权的执行证据。它保证：

- mention 后修改 Role，不会改变已经发送的请求。
- 删除 Role 后，已经接受的 Operation 仍能恢复。
- Operation 重试不会重新读取可变 Role。
- CLI 可以验证 Agent 传入的 `agentRoleId` 来自驱动当前操作的用户 Turn。

快照不包含 Provider 密钥或环境变量。

## Session 创建流程

1. 用户在对话中选择 `@reviewer`。
2. 发送 Turn 时，客户端生成 Role invocation snapshot，并将其写入该 Turn input config。
3. mention 在发给当前 Agent 的 Prompt 中展开为机器可读指令，要求 Agent 使用 Lody MCP 并传入 `agentRoleId`。
4. 当前 Agent 调用 `lody_session_create` 或 `lody_session_create_many`。
5. CLI 从驱动 Turn 的快照中匹配 `agentRoleId`，而不是重新读取 Role catalog。
6. CLI 再次检查请求者权限、Machine 可用性、Agent Config 和 ACP capability。
7. Operation 在接受时冻结最终 dispatch config 和目标 Prompt。
8. CLI 在 Role 指定的 Machine 上创建新 Session。
9. 新 Session 记录 `agentRoleId` 和 `agentRoleRevision` 作为来源信息；实际执行仍以已冻结的 Agent Config 和 Turn input config 为准。

MCP 创建输入增加可选字段：

```ts
type SessionCreateInput = {
  prompt: string
  agentRoleId?: AgentRoleId
  // Existing fields...
}
```

当 `agentRoleId` 存在时，V1 不允许同时手动覆盖 Machine、Agent Config、Model、Reasoning、Fast 或 Plan 等 Role 已拥有的配置。需要另一套配置时，应编辑或复制 Role。

## Prompt 组装

目标 Session 的首个 Prompt 按以下顺序组装：

```text
Agent Config 默认 Prompt

Agent Role Prompt Prefix

本次用户任务
```

约束：

- Role Prompt 只注入目标 Session 的首个 Turn。
- 当前负责创建 Session 的 Agent 只需要知道 Role id 和用户任务，不需要手动转述 Role Prompt 或运行配置。
- 目标 Session 历史保存实际发送给 Agent 的组装后 Prompt，以便恢复和审计。
- V1 不支持 Prompt 模板变量。

## 错误策略

Role 调用不允许静默回退。以下情况必须返回结构化、可修复的错误：

- Role 快照不在驱动 Turn 中。
- Role 对请求用户不可见。
- 目标 Machine 不可访问或离线。
- Agent Config 已删除或不属于 Role 指定的 Machine。
- Model、Mode 或 config option 已不受目标 Agent capability 支持。
- GitHub repo 对目标 Machine 或请求用户不可用。
- `agentRoleId` 与手动 Agent/run-config 覆盖同时出现。

错误可以提示用户在 Settings 中修复 Role，但不能包含 Provider 密钥、环境变量值或其他敏感运行信息。

## 执行一致性

- Role catalog 是可变设置数据。
- mention 发送时的 invocation snapshot 是该用户 Turn 的不可变输入。
- Operation 接受时继续冻结目标 dispatch config，作为重试、恢复和 Delivery 的权威输入。
- Session 创建成功后，Role 只用于展示来源，不再作为当前 Session 配置的动态来源。

修改 Role 只影响未来的 mention，不修改已有 Session，也不改变已接受 Operation 的恢复结果。

## 实施拆分

### 1. Shared contract 与 catalog

- 新增 `AgentRoleId`、`AgentRole`、validator 和 normalization helper。
- 扩展 workspace Flock key/row union，增加 `agentRole` family。
- 建立统一的 Role 可见性、所有权和可执行性检查。
- 实现 catalog 订阅、写入和显式同步结果。

### 2. Settings

- 新增 Agent Roles tab 和路由。
- 实现 Role 列表、创建/编辑、复制、删除和分享开关。
- 复用现有 Agent capability selector 生成 Model、Reasoning 和其他配置选项。
- 展示不可用、未同步、private 和 workspace 状态。

### 3. Mention

- 新增 Agent Roles category 和 candidate source。
- 新增 `agent_role` mention kind、icon、chip、草稿恢复和发送前 rewrite。
- 根据 Local/GitHub work context 和 Machine 权限过滤候选项。
- 发送 Turn 时写入 invocation snapshot。

### 4. MCP 与 Session orchestration

- 为 `lody_session_create` 和 `lody_session_create_many` 增加 `agentRoleId`。
- 从驱动 Turn 快照解析 Role，并禁止手动覆盖 Role 配置。
- 将 Role 配置映射为现有 Session dispatch config。
- 实现 GitHub work context 的跨 Machine 复用。
- 在 Operation 接受时冻结最终配置和组装后的 Prompt。
- 在 Session meta 中记录 Role 来源信息。

### 5. 验证

- 数据 validator、Flock row 读写和冲突收敛测试。
- private/workspace 可见性和所有权测试。
- Local Project 同 Machine mention 过滤测试。
- GitHub Project 跨 Machine mention 和 Session 创建测试。
- Role 修改或删除后 invocation snapshot 保持不变的测试。
- Operation 重试和 CLI 重启仍使用相同冻结配置的测试。
- 不支持的模型或思考等级明确失败且不静默回退的测试。
- Role 数据和错误输出不包含 Provider secret 的测试。

## 验收标准

1. 用户可以创建一个默认 private 的 Role，并选择具体 Machine、Agent Config、Model、Reasoning 和 Prompt。
2. private Role 仅 owner 能在 Settings 和 mention 菜单中看到并使用。
3. owner 可以通过修改同一 catalog row 将 Role 共享到 workspace，无需迁移目录数据。
4. Local Project 对话只能 mention 该 Project 所属 Machine 上的 Role。
5. GitHub Project 对话可以 mention 其他已授权 Machine 上的 Role。
6. GitHub 跨 Machine Role 创建独立 Session，复用 repo/branch work context，并通过 `openedBySessionId` 关联发起 Session。
7. 用户不需要在 Prompt 中重复 Provider、模型或思考等级。
8. mention 后修改或删除 Role，不改变已经接受的操作。
9. Provider、Machine 或 capability 不可用时返回明确错误，不静默选择其他配置。

## 后续扩展方向

- Role 级记忆和记忆管理权限。
- Role 级 MCP / Skill 组合。
- 每台 Machine 的 Agent Config binding，使一个 Role 可绑定多台 Machine 上的等价 Provider。
- Prompt 模板变量和结构化输入。
- Role 版本历史和回滚。
- Workspace 管理员治理、推荐 Role 和默认 Role。
- 在 New Chat 中直接使用 Role，而不仅用于对话内 Session 创建。
