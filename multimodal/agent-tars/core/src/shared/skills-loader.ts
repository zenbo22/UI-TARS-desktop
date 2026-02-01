/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { AgentTARSOptions } from '../types';

export type SkillEntry = {
  name: string;
  description: string;
  location: 'project' | 'global' | 'custom';
  skillPath: string;
};

const FRONTMATTER_DELIMITER = '---';
const MAX_DESCRIPTION_LENGTH = 240;

function truncate(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= MAX_DESCRIPTION_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`;
}

function parseFrontmatter(content: string): Record<string, string> {
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
}

function resolveSkillEntry(skillDir: string, location: SkillEntry['location']): SkillEntry | null {
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

  const name = frontmatter.name?.trim() || fallbackName;
  const description = truncate(frontmatter.description || fallbackDescription || 'No description');

  return {
    name,
    description,
    location,
    skillPath: skillFile,
  };
}

function collectSkillsFromDir(baseDir: string, location: SkillEntry['location']): SkillEntry[] {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const entries = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(baseDir, entry.name));

  return entries
    .map((skillDir) => resolveSkillEntry(skillDir, location))
    .filter((entry): entry is SkillEntry => Boolean(entry));
}

function buildSkillsBlock(skills: SkillEntry[]): string {
  if (skills.length === 0) return '';

  const skillLines = skills
    .map((skill) => {
      return [
        '<skill>',
        `<name>${skill.name}</name>`,
        `<description>${skill.description}</description>`,
        `<location>${skill.location}</location>`,
        '</skill>',
      ].join('\n');
    })
    .join('\n\n');

  const usage = [
    'When users ask for a task, check if a skill below can help.',
    'If a skill looks relevant, open its SKILL.md using the filesystem tools before acting.',
    'Do not use skills that are not listed in <available_skills>.',
  ].join(' ');

  return [
    '<skills_system priority="1">',
    '<usage>',
    usage,
    '</usage>',
    '<available_skills>',
    skillLines,
    '</available_skills>',
    '</skills_system>',
  ].join('\n');
}

export function listSkills(options: AgentTARSOptions, workspace: string): SkillEntry[] {
  const skillOptions = options.skills;
  if (skillOptions?.enabled === false) {
    return [];
  }

  const directories = skillOptions?.directories || ['.agent/skills', '.claude/skills'];
  const projectSkills = directories.flatMap((dir) =>
    collectSkillsFromDir(path.resolve(workspace, dir), 'project'),
  );

  const globalSkills = skillOptions?.includeGlobal
    ? directories.flatMap((dir) => collectSkillsFromDir(path.resolve(os.homedir(), dir), 'global'))
    : [];

  return [...projectSkills, ...globalSkills];
}

export function findSkillByName(
  options: AgentTARSOptions,
  workspace: string,
  skillName: string,
): SkillEntry | null {
  const target = skillName.trim().toLowerCase();
  if (!target) return null;

  const skills = listSkills(options, workspace);
  return (
    skills.find((skill) => skill.name.toLowerCase() === target) ||
    skills.find((skill) => path.basename(path.dirname(skill.skillPath)).toLowerCase() === target) ||
    null
  );
}

export function loadSkillsPrompt(options: AgentTARSOptions, workspace: string): string {
  const skills = listSkills(options, workspace);
  return buildSkillsBlock(skills);
}
