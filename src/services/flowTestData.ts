/**
 * 流程测试数据 — 创建测试流程定义和实例
 */
import { v4 as uuidv4 } from 'uuid'
import { FlowDefinitionModel } from '../models/FlowDefinition.js'
import { FlowInstanceModel } from '../models/FlowInstance.js'
import { TaskInstanceModel } from '../models/TaskInstance.js'
import { ApprovalLogModel } from '../models/ApprovalLog.js'

/**
 * 创建请假审批流程定义
 */
export async function createLeaveApprovalFlow(): Promise<string> {
  const definitionId = uuidv4()

  const graph = {
    nodes: [
      {
        id: 'start',
        shape: 'bpmn-node',
        x: 0,
        y: 100,
        width: 200,
        height: 36,
        data: {
          bpmnType: 'startEvent',
          label: '开始',
        },
      },
      {
        id: 'submit',
        shape: 'bpmn-node',
        x: 260,
        y: 78,
        width: 160,
        height: 80,
        data: {
          bpmnType: 'userTask',
          label: '提交请假申请',
          assigneeType: 'expression',
          assignee: '${initiator}',
          formMode: 'edit',
        },
      },
      {
        id: 'manager_approve',
        shape: 'bpmn-node',
        x: 520,
        y: 78,
        width: 160,
        height: 80,
        data: {
          bpmnType: 'userTask',
          label: '主管审批',
          assigneeType: 'role',
          candidateRoles: ['manager'],
          approvalMode: 'single',
          formMode: 'view',
        },
      },
      {
        id: 'end',
        shape: 'bpmn-node',
        x: 780,
        y: 100,
        width: 200,
        height: 36,
        data: {
          bpmnType: 'endEvent',
          label: '结束',
        },
      },
    ],
    edges: [
      {
        id: 'edge_1',
        shape: 'bpmn-edge',
        source: { cell: 'start' },
        target: { cell: 'submit' },
        data: {},
      },
      {
        id: 'edge_2',
        shape: 'bpmn-edge',
        source: { cell: 'submit' },
        target: { cell: 'manager_approve' },
        data: {},
      },
      {
        id: 'edge_3',
        shape: 'bpmn-edge',
        source: { cell: 'manager_approve' },
        target: { cell: 'end' },
        data: {},
      },
    ],
  }

  await FlowDefinitionModel.create({
    id: definitionId,
    name: '请假审批流程',
    description: '员工提交请假申请，主管审批',
    graph,
    version: 1,
    status: 'published',
  })

  return definitionId
}

/**
 * 创建采购审批流程定义（带条件分支）
 */
export async function createPurchaseApprovalFlow(): Promise<string> {
  const definitionId = uuidv4()

  const graph = {
    nodes: [
      {
        id: 'start',
        shape: 'bpmn-node',
        x: 0,
        y: 150,
        width: 200,
        height: 36,
        data: {
          bpmnType: 'startEvent',
          label: '开始',
        },
      },
      {
        id: 'submit',
        shape: 'bpmn-node',
        x: 260,
        y: 128,
        width: 160,
        height: 80,
        data: {
          bpmnType: 'userTask',
          label: '提交采购申请',
          assigneeType: 'expression',
          assignee: '${initiator}',
          formMode: 'edit',
        },
      },
      {
        id: 'gateway',
        shape: 'bpmn-node',
        x: 480,
        y: 158,
        width: 40,
        height: 40,
        data: {
          bpmnType: 'exclusiveGateway',
          label: '金额判断',
          gatewayDirection: 'diverging',
          defaultFlow: 'edge_high',
        },
      },
      {
        id: 'manager_approve',
        shape: 'bpmn-node',
        x: 580,
        y: 78,
        width: 160,
        height: 80,
        data: {
          bpmnType: 'userTask',
          label: '主管审批',
          assigneeType: 'role',
          candidateRoles: ['manager'],
          approvalMode: 'single',
          formMode: 'view',
        },
      },
      {
        id: 'ceo_approve',
        shape: 'bpmn-node',
        x: 580,
        y: 238,
        width: 160,
        height: 80,
        data: {
          bpmnType: 'userTask',
          label: '总经理审批',
          assigneeType: 'role',
          candidateRoles: ['ceo'],
          approvalMode: 'single',
          formMode: 'view',
        },
      },
      {
        id: 'end',
        shape: 'bpmn-node',
        x: 800,
        y: 150,
        width: 200,
        height: 36,
        data: {
          bpmnType: 'endEvent',
          label: '结束',
        },
      },
    ],
    edges: [
      {
        id: 'edge_1',
        shape: 'bpmn-edge',
        source: { cell: 'start' },
        target: { cell: 'submit' },
        data: {},
      },
      {
        id: 'edge_2',
        shape: 'bpmn-edge',
        source: { cell: 'submit' },
        target: { cell: 'gateway' },
        data: {},
      },
      {
        id: 'edge_low',
        shape: 'bpmn-edge',
        source: { cell: 'gateway', port: 'bottom' },
        target: { cell: 'manager_approve' },
        data: {
          label: '≤5000',
          conditionExpression: 'amount <= 5000',
        },
      },
      {
        id: 'edge_high',
        shape: 'bpmn-edge',
        source: { cell: 'gateway', port: 'bottom' },
        target: { cell: 'ceo_approve' },
        data: {
          label: '>5000',
          isDefault: true,
        },
      },
      {
        id: 'edge_5',
        shape: 'bpmn-edge',
        source: { cell: 'manager_approve' },
        target: { cell: 'end' },
        data: {},
      },
      {
        id: 'edge_6',
        shape: 'bpmn-edge',
        source: { cell: 'ceo_approve' },
        target: { cell: 'end' },
        data: {},
      },
    ],
  }

  await FlowDefinitionModel.create({
    id: definitionId,
    name: '采购审批流程',
    description: '采购申请，金额 ≤5000 主管审批，>5000 总经理审批',
    graph,
    version: 1,
    status: 'published',
  })

  return definitionId
}

/**
 * 创建测试流程实例
 */
export async function createTestInstances(definitionId: string, userId: string): Promise<void> {
  // 创建实例 1：运行中
  const instance1 = await FlowInstanceModel.create({
    id: uuidv4(),
    definitionId,
    version: 1,
    status: 'running',
    variables: { leaveType: '年假', days: 3 },
    tokens: [],
    initiatedBy: userId,
    startedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 天前
  })

  // 创建待办任务
  await TaskInstanceModel.create({
    id: uuidv4(),
    instanceId: instance1.id,
    nodeId: 'manager_approve',
    nodeName: '主管审批',
    status: 'pending',
    assignee: 'manager_user',
    candidateRoles: ['manager'],
    formMode: 'view',
    priority: 5,
  })

  // 创建实例 2：已完成
  const instance2 = await FlowInstanceModel.create({
    id: uuidv4(),
    definitionId,
    version: 1,
    status: 'completed',
    variables: { leaveType: '事假', days: 1 },
    tokens: [],
    initiatedBy: userId,
    startedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
    completedAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
  })

  // 创建审批日志
  await ApprovalLogModel.create([
    {
      id: uuidv4(),
      instanceId: instance2.id,
      nodeId: 'submit',
      nodeName: '提交请假申请',
      taskId: 'task_1',
      action: 'approve',
      operator: userId,
    },
    {
      id: uuidv4(),
      instanceId: instance2.id,
      nodeId: 'manager_approve',
      nodeName: '主管审批',
      taskId: 'task_2',
      action: 'approve',
      operator: 'manager_user',
      comment: '同意',
    },
  ])
}

/**
 * 种子数据入口
 */
export async function seedFlowData(): Promise<{ definitions: number; instances: number }> {
  // 检查是否已有数据
  const count = await FlowDefinitionModel.countDocuments()
  if (count > 0) {
    return { definitions: count, instances: 0 }
  }

  // 创建流程定义
  const leaveFlowId = await createLeaveApprovalFlow()
  const purchaseFlowId = await createPurchaseApprovalFlow()

  // 创建测试实例
  await createTestInstances(leaveFlowId, 'test_user')

  return {
    definitions: 2,
    instances: 2,
  }
}
