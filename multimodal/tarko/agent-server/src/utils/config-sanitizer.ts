/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentAppConfig } from '../types';
import { SanitizedAgentOptions, SanitizedTool } from '@tarko/interface';
import { Tool, AgentModel } from '@tarko/interface';

const DEFAULT_SKILL_DIRS = ['.agent/skills', '.claude/skills'];
const FRONTMATTER_DELIMITER = '---';
const MAX_DESCRIPTION_LENGTH = 240;

type SkillSummary = {
  name: string;
  description: string;
  location: 'project' | 'global';
};

const truncate = (input: string): string => {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= MAX_DESCRIPTION_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`;
};

const parseFrontmatter = (content: string): Record<string, string> => {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    return {};
  }

  const result: Record<string, string> = {};
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line === FRONTMATTER_DELIMITER) {
      break;
    }
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
};

const resolveSkillSummary = (
  skillDir: string,
  location: SkillSummary['location'],
): SkillSummary | null => {
  const skillFile = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillFile)) {
    return null;
  }

  const content = fs.readFileSync(skillFile, 'utf8');
  const frontmatter = parseFrontmatter(content);
  const fallbackName = path.basename(skillDir);
  const fallbackDescription = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== FRONTMATTER_DELIMITER);

  return {
    name: frontmatter.name?.trim() || fallbackName,
    description: truncate(frontmatter.description || fallbackDescription || 'No description'),
    location,
  };
};

const collectSkillSummaries = (
  baseDir: string,
  location: SkillSummary['location'],
): SkillSummary[] => {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolveSkillSummary(path.join(baseDir, entry.name), location))
    .filter((entry): entry is SkillSummary => Boolean(entry));
};

/**
 * Sanitize agent configuration, hiding sensitive information
 */
export function sanitizeAgentOptions(options: AgentAppConfig): SanitizedAgentOptions {
  const sanitized: SanitizedAgentOptions = {};

  // Base agent options
  if (options.id !== undefined) sanitized.id = options.id;
  if (options.name !== undefined) sanitized.name = options.name;
  if (options.instructions !== undefined) {
    // Truncate instructions for UI display
    sanitized.instructions =
      options.instructions.length > 100
        ? options.instructions.substring(0, 100) + '...'
        : options.instructions;
  }

  // Model configuration
  if (options.model !== undefined) {
    const modelConfig: AgentModel = { ...options.model };

    // Sanitize API key if present
    if (modelConfig.apiKey) {
      modelConfig.apiKey = sanitizeApiKey(modelConfig.apiKey); // secretlint-disable-line
    }

    // No providers array to sanitize in simplified model

    sanitized.model = modelConfig;
  }

  // Model-related options
  if (options.maxTokens !== undefined) sanitized.maxTokens = options.maxTokens;
  if (options.temperature !== undefined) sanitized.temperature = options.temperature;
  if (options.thinking !== undefined) sanitized.thinking = options.thinking;

  // Tool configuration
  if (options.tools !== undefined && Array.isArray(options.tools)) {
    sanitized.tools = options.tools.map(sanitizeTool);
  }

  if (options.tool !== undefined) {
    sanitized.tool = {
      include: options.tool.include,
      exclude: options.tool.exclude,
    };
  }

  if (options.toolCallEngine !== undefined) {
    // Convert tool call engine to string representation for serialization
    if (typeof options.toolCallEngine === 'string') {
      sanitized.toolCallEngine = options.toolCallEngine;
    } else if (typeof options.toolCallEngine === 'function') {
      // For constructor functions, use the class name or 'CustomEngine'
      sanitized.toolCallEngine = options.toolCallEngine.name || 'CustomEngine';
    } else {
      sanitized.toolCallEngine = 'Unknown';
    }
  }

  // Loop options
  if (options.maxIterations !== undefined) {
    sanitized.maxIterations = options.maxIterations;
  }

  // Memory options
  if (options.context !== undefined) {
    sanitized.context = options.context;
  }

  if (options.eventStreamOptions !== undefined) {
    sanitized.eventStreamOptions = options.eventStreamOptions;
  }

  if (options.enableStreamingToolCallEvents !== undefined) {
    sanitized.enableStreamingToolCallEvents = options.enableStreamingToolCallEvents;
  }

  // Misc options
  if (options.logLevel !== undefined) {
    sanitized.logLevel = options.logLevel;
  }

  // Workspace options
  if (options.workspace !== undefined) {
    sanitized.workspace = options.workspace;
    sanitized.workspaceName = path.basename(options.workspace);
  }

  // Skill summaries for UI
  const skillOptions = (options as any).skills;
  if (skillOptions?.available && Array.isArray(skillOptions.available)) {
    sanitized.skills = {
      available: skillOptions.available.map((skill: any) => ({
        name: String(skill.name ?? ''),
        description: String(skill.description ?? ''),
        location: String(skill.location ?? ''),
      })),
    };
  } else if (skillOptions?.enabled !== false && options.workspace) {
    const directories: string[] = Array.isArray(skillOptions?.directories)
      ? skillOptions.directories
      : DEFAULT_SKILL_DIRS;
    const projectSkills = directories.flatMap((dir) =>
      collectSkillSummaries(path.resolve(options.workspace as string, dir), 'project'),
    );
    const includeGlobal = !!skillOptions?.includeGlobal;
    const globalSkills = includeGlobal
      ? directories.flatMap((dir) => collectSkillSummaries(path.resolve(os.homedir(), dir), 'global'))
      : [];
    sanitized.skills = {
      available: [...projectSkills, ...globalSkills],
    };
  }

  return sanitized;
}

/**
 * Sanitize tool configuration, removing function implementations
 */
function sanitizeTool(tool: Tool): SanitizedTool {
  // Create a copy of the tool without the function property
  const { function: toolFunction, ...sanitized } = tool;
  return sanitized as SanitizedTool;
}

/**
 * Sanitize API key by showing only first and last few characters
 */
function sanitizeApiKey(apiKey?: string): string | undefined {
  if (!apiKey) return undefined;

  if (apiKey.length <= 8) {
    return '*'.repeat(apiKey.length);
  }

  // Show first 4 and last 4 characters, mask the middle
  const start = apiKey.substring(0, 4);
  const end = apiKey.substring(apiKey.length - 4);
  const middle = '*'.repeat(Math.max(apiKey.length - 8, 3));

  return `${start}${middle}${end}`;
}
