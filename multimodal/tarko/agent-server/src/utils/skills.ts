/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { AgentAppConfig } from '../types';

export type SkillEntry = {
  name: string;
  description: string;
  location: 'project' | 'global';
  skillDir: string;
  skillPath: string;
  workflowFile?: string;
  workflowPath?: string;
};

const DEFAULT_SKILL_DIRS = ['.agent/skills', '.claude/skills'];
const FRONTMATTER_DELIMITER = '---';
const MAX_DESCRIPTION_LENGTH = 240;
const WORKFLOW_FILES = ['workflow.json', 'workflow.zip'];

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

const resolveWorkflowFile = (skillDir: string): { workflowFile?: string; workflowPath?: string } => {
  for (const file of WORKFLOW_FILES) {
    const workflowPath = path.join(skillDir, file);
    if (fs.existsSync(workflowPath)) {
      return { workflowFile: file, workflowPath };
    }
  }
  return {};
};

const resolveSkillEntry = (skillDir: string, location: SkillEntry['location']): SkillEntry | null => {
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
  const workflowInfo = resolveWorkflowFile(skillDir);

  return {
    name: frontmatter.name?.trim() || fallbackName,
    description: truncate(frontmatter.description || fallbackDescription || 'No description'),
    location,
    skillDir,
    skillPath: skillFile,
    ...workflowInfo,
  };
};

const collectSkillEntries = (baseDir: string, location: SkillEntry['location']): SkillEntry[] => {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolveSkillEntry(path.join(baseDir, entry.name), location))
    .filter((entry): entry is SkillEntry => Boolean(entry));
};

export const listSkillEntries = (options: AgentAppConfig): SkillEntry[] => {
  const skillOptions = (options as any).skills ?? {};
  if (skillOptions?.enabled === false) {
    return [];
  }

  const workspace = options.workspace;
  if (!workspace) {
    return [];
  }

  const directories: string[] = Array.isArray(skillOptions?.directories)
    ? skillOptions.directories
    : DEFAULT_SKILL_DIRS;
  const projectSkills = directories.flatMap((dir) =>
    collectSkillEntries(path.resolve(workspace, dir), 'project'),
  );

  const includeGlobal = !!skillOptions?.includeGlobal;
  const globalSkills = includeGlobal
    ? directories.flatMap((dir) => collectSkillEntries(path.resolve(os.homedir(), dir), 'global'))
    : [];

  return [...projectSkills, ...globalSkills];
};

export const findSkillByName = (
  options: AgentAppConfig,
  name: string,
): SkillEntry | null => {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  const entries = listSkillEntries(options);
  return (
    entries.find((entry) => entry.name.toLowerCase() === target) ||
    entries.find((entry) => path.basename(entry.skillDir).toLowerCase() === target) ||
    null
  );
};
