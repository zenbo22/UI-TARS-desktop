/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { sanitizeAgentOptions } from '../../utils/config-sanitizer';
import { getPublicAvailableModels, isModelConfigValid } from '../../utils/model-utils';
import { findSkillByName } from '../../utils/skills';

export function healthCheck(req: Request, res: Response) {
  res.status(200).json({ status: 'ok' });
}

export function getVersion(req: Request, res: Response) {
  const server = req.app.locals.server;
  res.status(200).json({
    version: server.versionInfo?.version,
    buildTime: server.versionInfo?.buildTime,
    gitHash: server.versionInfo?.gitHash,
  });
}

export function getAgentOptions(req: Request, res: Response) {
  const server = req.app.locals.server;
  res.status(200).json({
    options: sanitizeAgentOptions(server.appConfig),
  });
}

export function getSkillContent(req: Request, res: Response) {
  const name = req.query.name as string;
  if (!name) {
    return res.status(400).json({ error: 'Skill name is required' });
  }

  const server = req.app.locals.server;
  const skill = findSkillByName(server.appConfig, name);
  if (!skill || !fs.existsSync(skill.skillPath)) {
    return res.status(404).json({ error: 'Skill not found' });
  }

  const content = fs.readFileSync(skill.skillPath, 'utf8');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.status(200).send(content);
}

export function downloadSkillWorkflow(req: Request, res: Response) {
  const name = req.query.name as string;
  if (!name) {
    return res.status(400).json({ error: 'Skill name is required' });
  }

  const server = req.app.locals.server;
  const skill = findSkillByName(server.appConfig, name);
  if (!skill || !skill.workflowPath || !fs.existsSync(skill.workflowPath)) {
    return res.status(404).json({ error: 'Workflow not found' });
  }

  return res.download(skill.workflowPath, skill.workflowFile || 'workflow.json');
}

const slugifySkillName = (input: string): string => {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (normalized) return normalized;
  return `skill-${Date.now()}`;
};

export function importSkillWorkflow(req: Request, res: Response) {
  const { name, workflow } = req.body as { name?: string; workflow?: Record<string, any> };

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Skill name is required' });
  }
  if (!workflow || typeof workflow !== 'object') {
    return res.status(400).json({ error: 'Workflow JSON is required' });
  }

  const server = req.app.locals.server;
  const workspace = server.appConfig?.workspace;
  if (!workspace) {
    return res.status(400).json({ error: 'Workspace is not configured' });
  }

  const skillDirName = slugifySkillName(name);
  const skillDir = path.join(workspace, '.agent', 'skills', skillDirName);
  const workflowPath = path.join(skillDir, 'workflow.json');
  const skillPath = path.join(skillDir, 'SKILL.md');

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

  const description =
    typeof workflow?.description === 'string' ? workflow.description : '通过 Automa workflow 自动化前端操作';
  const skillContent = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    '## 使用说明',
    '1. 在浏览器扩展 Automa 中导入同目录下的 `workflow.json`。',
    '2. 点击 Run 运行流程。',
    '3. 如需登录/验证码，手动完成后继续执行。',
    '',
  ].join('\n');

  fs.writeFileSync(skillPath, skillContent);

  return res.status(200).json({
    skill: {
      name,
      description,
      location: 'project',
      workflowFile: 'workflow.json',
    },
  });
}

/**
 * Get runtime settings schema and current values
 * - If no sessionId provided: returns only schema for home page
 * - If sessionId provided: returns schema + current values for that session
 */
export async function getRuntimeSettings(req: Request, res: Response) {
  const sessionId = req.query.sessionId as string;
  const server = req.app.locals.server;

  try {
    // Get runtime settings configuration from server config
    const runtimeSettingsConfig = server.appConfig?.server?.runtimeSettings;
    
    if (!runtimeSettingsConfig) {
      return res.status(200).json({ 
        schema: { type: 'object', properties: {} },
        currentValues: {}
      });
    }

    const schema = runtimeSettingsConfig.schema;
    let currentValues = {};

    // If sessionId is provided, get current session values
    if (sessionId && server.storageProvider) {
      try {
        const sessionInfo = await server.storageProvider.getSessionInfo(sessionId);
        currentValues = sessionInfo?.metadata?.runtimeSettings || {};
      } catch (error) {
        // Session doesn't exist or no stored values, use defaults from schema
      }
    }

    // Merge with default values from schema
    const mergedValues: Record<string, any> = { ...currentValues };
    
    if (schema && schema.properties) {
      Object.entries(schema.properties).forEach(([key, propSchema]: [string, any]) => {
        if (mergedValues[key] === undefined && propSchema.default !== undefined) {
          mergedValues[key] = propSchema.default;
        }
      });
    }

    res.status(200).json({
      schema: schema,
      currentValues: sessionId ? mergedValues : {} // Only return current values if sessionId provided
    });
  } catch (error) {
    console.error(`Error getting runtime settings:`, error);
    res.status(500).json({ error: 'Failed to get runtime settings' });
  }
}

/**
 * Update runtime settings for a session
 * Requires sessionId parameter
 */
export async function updateRuntimeSettings(req: Request, res: Response) {
  const { sessionId, runtimeSettings } = req.body as {
    sessionId: string;
    runtimeSettings: Record<string, any>;
  };

  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID is required' });
  }

  if (!runtimeSettings || typeof runtimeSettings !== 'object') {
    return res.status(400).json({ error: 'Runtime settings object is required' });
  }

  try {
    const server = req.app.locals.server;

    if (!server.storageProvider) {
      return res.status(404).json({ error: 'Storage not configured, cannot update runtime settings' });
    }

    const sessionInfo = await server.storageProvider.getSessionInfo(sessionId);
    if (!sessionInfo) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Update session info with new runtime settings
    const updatedSessionInfo = await server.storageProvider.updateSessionInfo(sessionId, {
      metadata: {
        ...sessionInfo.metadata,
        runtimeSettings,
      },
    });

    // If session is currently active, recreate the agent with new runtime settings
    const activeSession = server.sessions[sessionId];
    if (activeSession) {
      console.log('Runtime settings updated', {
        sessionId,
        runtimeSettings,
      });

      try {
        // Recreate agent with new runtime settings configuration
        await activeSession.updateSessionConfig(updatedSessionInfo);
        console.log('Session agent recreated with new runtime settings', { sessionId });
      } catch (error) {
        console.error('Failed to update agent runtime settings for session', { sessionId, error });
        // Continue execution - the runtime settings are saved, will apply on next session
      }
    }

    res.status(200).json({ 
      session: updatedSessionInfo,
      runtimeSettings 
    });
  } catch (error) {
    console.error(`Error updating runtime settings:`, error);
    res.status(500).json({ error: 'Failed to update runtime settings' });
  }
}

export function getAvailableModels(req: Request, res: Response) {
  const server = req.app.locals.server;
  const models = getPublicAvailableModels(server.appConfig);

  res.status(200).json({ models });
}

/**
 * Update session model configuration
 */
export async function updateSessionModel(req: Request, res: Response) {
  const { sessionId, model } = req.body;
  const server = req.app.locals.server;

  if (!sessionId || !model || !model.provider || !model.id) {
    return res
      .status(400)
      .json({ error: 'Missing required parameters: sessionId, model (with provider and id)' });
  }

  // Validate model configuration
  if (!isModelConfigValid(server.appConfig, model.provider, model.id)) {
    return res.status(400).json({ error: 'Invalid model configuration' });
  }

  try {
    // Update session model configuration
    if (server.storageProvider) {
      // Get current session metadata
      const currentSessionInfo = await server.storageProvider.getSessionInfo(sessionId);
      if (!currentSessionInfo) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Update metadata with new model config
      const updatedSessionInfo = await server.storageProvider.updateSessionInfo(sessionId, {
        metadata: {
          ...currentSessionInfo.metadata,
          modelConfig: model,
        },
      });

      // If session is currently active, recreate the agent with new model config
      const activeSession = server.sessions[sessionId];
      if (activeSession) {
        console.log('Session model updated', {
          sessionId,
          provider: model.provider,
          modelId: model.id,
        });

        try {
          // Recreate agent with new model configuration
          await activeSession.updateSessionConfig(updatedSessionInfo);
          console.log('Session agent recreated with new model config', { sessionId });
        } catch (error) {
          console.error('Failed to update agent model config for session', { sessionId, error });
          // Continue execution - the model config is saved, will apply on next session
        }
      }

      res.status(200).json({
        success: true,
        sessionInfo: updatedSessionInfo,
      });
    } else {
      res.status(400).json({ error: 'Storage not configured' });
    }
  } catch (error) {
    console.error('Failed to update session model:', error);
    res.status(500).json({ error: 'Failed to update session model' });
  }
}
