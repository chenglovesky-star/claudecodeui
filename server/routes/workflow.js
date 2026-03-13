import express from 'express';
import { workflowDb, teamDb, notificationsDb } from '../database/db.js';
import { broadcastToTeam } from '../utils/team-websocket.js';

const router = express.Router();

// Workflow step definitions
const WORKFLOW_STEPS = {
  product_brief: ['project_overview', 'target_users', 'core_features', 'constraints', 'review'],
  prd: ['requirements_gathering', 'user_stories', 'acceptance_criteria', 'nfr', 'review'],
  architecture: ['tech_stack', 'system_design', 'data_model', 'api_design', 'review'],
  epic_breakdown: ['epic_identification', 'story_decomposition', 'priority_ordering', 'review'],
};

const STEP_LABELS = {
  project_overview: '项目概述',
  target_users: '目标用户',
  core_features: '核心功能',
  constraints: '约束条件',
  review: '审核确认',
  requirements_gathering: '需求收集',
  user_stories: '用户故事',
  acceptance_criteria: '验收标准',
  nfr: '非功能需求',
  tech_stack: '技术选型',
  system_design: '系统设计',
  data_model: '数据模型',
  api_design: 'API 设计',
  epic_identification: 'Epic 识别',
  story_decomposition: 'Story 分解',
  priority_ordering: '优先级排序',
};

const WORKFLOW_LABELS = {
  product_brief: '产品简报',
  prd: 'PRD',
  architecture: '技术架构',
  epic_breakdown: 'Epic 拆分',
};

function getConnectedClients(req) {
  return req.app.locals.connectedClients;
}

function broadcastWorkflowEvent(req, teamId, eventType, payload) {
  const clients = getConnectedClients(req);
  if (!clients) return;
  broadcastToTeam(clients, teamId, { type: eventType, teamId, ...payload });
}

// Create workflow
router.post('/:teamId/workflows', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const { type } = req.body;
    if (!WORKFLOW_STEPS[type]) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '无效的工作流类型' } });
    }

    // Check for existing active workflow
    const active = workflowDb.getUserActive(req.user.id, teamId);
    if (active) {
      return res.status(400).json({ error: { code: 'ACTIVE_EXISTS', message: '你已有一个活跃工作流', activeWorkflow: active } });
    }

    const steps = WORKFLOW_STEPS[type];
    const workflow = workflowDb.createInstance(teamId, req.user.id, type, steps);

    // Add initial system message
    workflowDb.addMessage(workflow.id, 'system', `${WORKFLOW_LABELS[type]}工作流已启动。请按步骤完成各项内容。`, steps[0], {});

    broadcastWorkflowEvent(req, teamId, 'workflow:started', { workflow });
    res.status(201).json({ data: { workflow, steps: steps.map(s => ({ id: s, label: STEP_LABELS[s] || s })) } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get team workflows
router.get('/:teamId/workflows', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.userId) filters.userId = parseInt(req.query.userId);
    const workflows = workflowDb.getByTeam(teamId, filters);
    res.json({ data: { workflows } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get user's active workflow
router.get('/:teamId/workflows/active', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const workflow = workflowDb.getUserActive(req.user.id, teamId);
    res.json({ data: { workflow } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get workflow detail
router.get('/:teamId/workflows/:workflowId', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const workflowId = parseInt(req.params.workflowId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const workflow = workflowDb.getInstance(workflowId, teamId);
    if (!workflow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '工作流未找到' } });
    const steps = WORKFLOW_STEPS[workflow.workflow_type] || [];
    res.json({ data: { workflow, steps: steps.map(s => ({ id: s, label: STEP_LABELS[s] || s })) } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Cancel workflow
router.post('/:teamId/workflows/:workflowId/cancel', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const workflowId = parseInt(req.params.workflowId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const success = workflowDb.cancel(workflowId, teamId);
    if (!success) return res.status(400).json({ error: { code: 'INVALID_STATE', message: '工作流无法取消' } });
    res.json({ data: { success: true } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Send message to workflow
router.post('/:teamId/workflows/:workflowId/messages', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const workflowId = parseInt(req.params.workflowId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const workflow = workflowDb.getInstance(workflowId, teamId);
    if (!workflow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '工作流未找到' } });
    if (!['active', 'waiting_input'].includes(workflow.status)) {
      return res.status(400).json({ error: { code: 'INVALID_STATE', message: '工作流不在活跃状态' } });
    }

    const { content, type: msgType } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '消息不能为空' } });
    }

    // Save user message
    const userMsg = workflowDb.addMessage(workflowId, 'user', content.trim(), workflow.current_step, {});

    // Process step advancement if it's a choice
    const context = JSON.parse(workflow.context_json || '{}');
    const steps = context.steps || WORKFLOW_STEPS[workflow.workflow_type] || [];
    const currentIdx = steps.indexOf(workflow.current_step);

    let aiReply;
    if (msgType === 'choice' && content.trim().toLowerCase() === 'next') {
      // Advance to next step
      const completedSteps = context.completedSteps || [];
      completedSteps.push(workflow.current_step);

      if (currentIdx >= steps.length - 1) {
        // Workflow complete
        workflowDb.updateStatus(workflowId, 'completed', { ...context, completedSteps });
        aiReply = workflowDb.addMessage(workflowId, 'assistant',
          `${WORKFLOW_LABELS[workflow.workflow_type]}工作流已完成！所有步骤均已审核通过。`, 'completed', {});

        // Save final document
        const allMessages = workflowDb.getMessages(workflowId);
        const documentContent = allMessages
          .filter(m => m.role === 'assistant' || m.role === 'user')
          .map(m => `**${m.role === 'user' ? '用户' : 'AI'}** (${STEP_LABELS[m.step_name] || m.step_name || ''}):\n${m.content}`)
          .join('\n\n---\n\n');
        workflowDb.addMessage(workflowId, 'system', documentContent, 'final_document',
          { documentType: workflow.workflow_type, version: 1, format: 'markdown' });

        // Notify team
        const members = teamDb.getTeamMembers(teamId);
        for (const member of members) {
          if (member.user_id !== req.user.id) {
            notificationsDb.create(member.user_id, teamId, 'workflow_completed',
              `${workflow.nickname || workflow.username} 完成了${WORKFLOW_LABELS[workflow.workflow_type]}文档`, null, null);
          }
        }
        broadcastWorkflowEvent(req, teamId, 'workflow:complete', {
          workflowId, workflowType: workflow.workflow_type, creatorId: workflow.user_id
        });
      } else {
        // Move to next step
        const nextStep = steps[currentIdx + 1];
        workflowDb.updateStep(workflowId, nextStep, { ...context, completedSteps });
        workflowDb.updateStatus(workflowId, 'active');
        aiReply = workflowDb.addMessage(workflowId, 'assistant',
          `已进入下一步: **${STEP_LABELS[nextStep] || nextStep}**。请提供相关内容，或输入问题让我引导你完成。`,
          nextStep, {});
        broadcastWorkflowEvent(req, teamId, 'workflow:step', {
          workflowId, step: nextStep, stepLabel: STEP_LABELS[nextStep]
        });
      }
    } else {
      // Regular message - generate a guided AI reply
      const stepLabel = STEP_LABELS[workflow.current_step] || workflow.current_step;
      aiReply = workflowDb.addMessage(workflowId, 'assistant',
        `收到你关于"${stepLabel}"的输入。内容已记录。\n\n如果此步骤已完成，请点击"下一步"继续；如需补充，请继续输入。`,
        workflow.current_step, {});
      workflowDb.updateStatus(workflowId, 'waiting_input');
    }

    res.json({ data: { userMessage: userMsg, aiReply } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get workflow messages
router.get('/:teamId/workflows/:workflowId/messages', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const workflowId = parseInt(req.params.workflowId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    const messages = workflowDb.getMessages(workflowId, limit, offset);
    res.json({ data: { messages } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get team documents (completed workflow outputs)
router.get('/:teamId/documents', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const documents = workflowDb.getCompletedDocuments(teamId).map(doc => ({
      workflowId: doc.workflow_id,
      type: doc.workflow_type,
      typeLabel: WORKFLOW_LABELS[doc.workflow_type] || doc.workflow_type,
      creator: { username: doc.username, nickname: doc.nickname, avatarUrl: doc.avatar_url },
      createdAt: doc.created_at,
      updatedAt: doc.updated_at,
      preview: doc.document_content ? doc.document_content.substring(0, 200) : '',
      hasContent: !!doc.document_content,
    }));
    res.json({ data: { documents } });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

// Get document content
router.get('/:teamId/documents/:workflowId', (req, res) => {
  try {
    const teamId = parseInt(req.params.teamId);
    const workflowId = parseInt(req.params.workflowId);
    if (!teamDb.isMember(teamId, req.user.id)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: '非团队成员' } });
    }
    const workflow = workflowDb.getInstance(workflowId, teamId);
    if (!workflow) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '文档未找到' } });

    const messages = workflowDb.getMessages(workflowId);
    const finalDoc = messages.find(m => m.role === 'system' && m.step_name === 'final_document');
    res.json({
      data: {
        document: {
          workflowId: workflow.id,
          type: workflow.workflow_type,
          typeLabel: WORKFLOW_LABELS[workflow.workflow_type] || workflow.workflow_type,
          content: finalDoc ? finalDoc.content : '',
          metadata: finalDoc ? JSON.parse(finalDoc.metadata || '{}') : {},
          creator: { username: workflow.username, nickname: workflow.nickname, avatarUrl: workflow.avatar_url },
          createdAt: workflow.created_at,
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: error.message } });
  }
});

export default router;
