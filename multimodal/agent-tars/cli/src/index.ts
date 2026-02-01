/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */

import { AgentTARS } from '@agent-tars/core';
import path, { join } from 'path';
import {
  AgentCLI,
  AgentCLIInitOptions,
  printWelcomeLogo,
  CLICommand,
  CLIOptionsEnhancer,
  deepMerge,
} from '@tarko/agent-cli';
import {
  buildConfigPaths,
  loadAgentConfig,
  loadEnvironmentVars,
  resolveWorkspacePath,
  GlobalWorkspaceCommand,
} from '@tarko/agent-cli';
import {
  AgentTARSCLIArguments,
  AgentTARSAppConfig,
  BrowserControlMode,
  AGENT_TARS_CONSTANTS,
} from '@agent-tars/interface';
import { homedir } from 'os';
import fs from 'fs';
import os from 'os';

export type { AgentTARSCLIArguments } from '@agent-tars/interface';

const packageJson = require('../package.json');

type SkillEntry = {
  name: string;
  description: string;
  location: 'project' | 'global';
  skillPath: string;
};

const DEFAULT_OPTIONS = {
  binName: 'agent-tars',
  versionInfo: {
    version: packageJson.version,
    buildTime: __BUILD_TIME__,
    gitHash: __GIT_HASH__,
  },
  appConfig: {
    agent: {
      type: 'module',
      constructor: AgentTARS,
    },
    server: {
      storage: {
        type: 'sqlite',
        baseDir: path.join(homedir(), AGENT_TARS_CONSTANTS.GLOBAL_STORAGE_DIR),
        dbName: AGENT_TARS_CONSTANTS.SESSION_DATA_DB_NAME,
      },
    },
  },
  directories: {
    globalWorkspaceDir: AGENT_TARS_CONSTANTS.GLOBAL_WORKSPACE_DIR,
  },
} as Partial<AgentCLIInitOptions> & {
  versionInfo?: unknown;
  directories?: { globalWorkspaceDir?: string };
};

const FRONTMATTER_DELIMITER = '---';
const MAX_DESCRIPTION_LENGTH = 240;

const truncate = (input: string) => {
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

  return {
    name: frontmatter.name?.trim() || fallbackName,
    description: truncate(frontmatter.description || fallbackDescription || 'No description'),
    location,
    skillPath: skillFile,
  };
};

const collectSkillsFromDir = (baseDir: string, location: SkillEntry['location']): SkillEntry[] => {
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolveSkillEntry(path.join(baseDir, entry.name), location))
    .filter((entry): entry is SkillEntry => Boolean(entry));
};

const listSkillsFromConfig = (appConfig: any, workspace: string): SkillEntry[] => {
  const skillOptions = appConfig?.skills ?? {};
  if (skillOptions?.enabled === false) {
    return [];
  }

  const directories: string[] = skillOptions?.directories || ['.agent/skills', '.claude/skills'];
  const projectSkills = directories.flatMap((dir) =>
    collectSkillsFromDir(path.resolve(workspace, dir), 'project'),
  );

  const includeGlobal = !!skillOptions?.includeGlobal;
  const globalSkills = includeGlobal
    ? directories.flatMap((dir) => collectSkillsFromDir(path.resolve(os.homedir(), dir), 'global'))
    : [];

  return [...projectSkills, ...globalSkills];
};

const findSkillByName = (appConfig: any, workspace: string, name: string): SkillEntry | null => {
  const target = name.trim().toLowerCase();
  if (!target) return null;

  const skills = listSkillsFromConfig(appConfig, workspace);
  return (
    skills.find((skill) => skill.name.toLowerCase() === target) ||
    skills.find((skill) => path.basename(path.dirname(skill.skillPath)).toLowerCase() === target) ||
    null
  );
};

/**
 * Agent TARS CLI - Extends the base CLI with TARS-specific functionality
 */
export class AgentTARSCLI extends AgentCLI {
  constructor(options: AgentCLIInitOptions) {
    const mergedOptions = deepMerge(DEFAULT_OPTIONS, options ?? {});
    super(mergedOptions as AgentCLIInitOptions);
  }

  protected configureAgentCommand(command: CLICommand): CLICommand {
    return (
      command
        // Browser configuration
        .option('--browser <browser>', 'browser config')
        .option(
          '--browser-control [mode]',
          'Browser control mode (deprecated, replaced by `--browser.control`)',
        )
        .option(
          '--browser-cdp-endpoint <endpoint>',
          'CDP endpoint (deprecated, replaced by `--browser.cdpEndpoint`)',
        )
        .option('--browser.control [mode]', 'Browser control mode (hybrid, dom, visual-grounding)')
        .option(
          '--browser.cdpEndpoint <endpoint>',
          'CDP endpoint to connect to, for example "http://127.0.0.1:9222/json/version',
        )
        // Planner configuration
        .option('--planner <planner>', 'Planner config')
        .option('--planner.enable', 'Enable planning functionality for complex tasks')

        // Search configuration
        .option('--search <search>', 'Search config')
        .option(
          '--search.provider [provider]',
          'Search provider (browser_search, tavily, bing_search)',
        )
        .option('--search.count [count]', 'Search result count', { default: 10 })
        .option('--search.apiKey [apiKey]', 'Search API key')
    );
  }

  protected extendCli(cli: any): void {
    cli
      .command('skills <action> [name]', 'List or read OpenSkills-compatible skills')
      .option('--json', 'Output JSON (list only)')
      .option('--workspace <path>', 'Workspace path')
      .option('--config, -c <path>', 'Config path (can be passed multiple times)', {
        type: [String],
      })
      .action(
        async (
          action: string,
          name: string | undefined,
          options: { json?: boolean; workspace?: string; config?: string[] },
        ) => {
          const workspace = resolveWorkspacePath(process.cwd(), options.workspace);
          loadEnvironmentVars(workspace);

          const globalWorkspaceCommand = new GlobalWorkspaceCommand(
            (this.options as any).directories?.globalWorkspaceDir,
          );
          const globalWorkspaceEnabled = await globalWorkspaceCommand.isGlobalWorkspaceEnabled();

          const configPaths = buildConfigPaths({
            cliConfigPaths: options.config,
            workspace,
            globalWorkspaceEnabled,
            globalWorkspaceDir:
              (this.options as any).directories?.globalWorkspaceDir ||
              AGENT_TARS_CONSTANTS.GLOBAL_WORKSPACE_DIR,
          });

          const userConfig = await loadAgentConfig(configPaths);

          if (action === 'list') {
            const skills = listSkillsFromConfig(userConfig as any, workspace);
            if (options.json) {
              console.log(JSON.stringify(skills, null, 2));
              return;
            }
            if (skills.length === 0) {
              console.log('No skills found.');
              return;
            }
            skills.forEach((skill: SkillEntry) => {
              console.log(`${skill.name} (${skill.location})`);
              console.log(`  ${skill.description}`);
              console.log(`  ${skill.skillPath}`);
            });
            return;
          }

          if (action === 'read') {
            if (!name) {
              console.error('Skill name is required for read.');
              process.exit(1);
            }
            const skill = findSkillByName(userConfig as any, workspace, name);
            if (!skill) {
              console.error(`Skill not found: ${name}`);
              process.exit(1);
            }
            const content = fs.readFileSync(skill.skillPath, 'utf8');
            console.log(content);
            return;
          }

          console.error(`Unknown skills action: ${action}. Use "list" or "read".`);
          process.exit(1);
        },
      );
  }

  /**
   * Create CLI options enhancer for Agent TARS specific options
   * This method only handles the additional options that Agent TARS introduces
   */
  protected configureCLIOptionsEnhancer(): CLIOptionsEnhancer<
    AgentTARSCLIArguments,
    AgentTARSAppConfig
  > {
    return (cliArguments, appConfig) => {
      const { browserControl, browserCdpEndpoint } = cliArguments;

      // Handle deprecated Agent TARS browser options
      if (browserControl || browserCdpEndpoint) {
        // Ensure browser config exists
        const agentTARSConfig = appConfig as Partial<AgentTARSAppConfig>;
        if (!agentTARSConfig.browser) {
          agentTARSConfig.browser = {};
        }

        // Handle deprecated --browserControl option
        if (browserControl && !agentTARSConfig.browser.control) {
          agentTARSConfig.browser.control = browserControl as BrowserControlMode;
        }

        // Handle deprecated --browserCdpEndpoint option
        if (browserCdpEndpoint && !agentTARSConfig.browser.cdpEndpoint) {
          agentTARSConfig.browser.cdpEndpoint = browserCdpEndpoint;
        }
      }

      const workspace = resolveWorkspacePath(process.cwd(), cliArguments.workspace);
      const skills = listSkillsFromConfig(appConfig as any, workspace);
      if (!appConfig.skills) {
        (appConfig as any).skills = {};
      }
      (appConfig as any).skills.available = skills.map((skill: SkillEntry) => ({
        name: skill.name,
        description: skill.description,
        location: skill.location,
      }));
    };
  }

  /**
   * Print Agent TARS welcome logo with custom dual ASCII art
   */
  protected printLogo(): void {
    const agentArt = [
      ' █████  ██████  ███████ ███    ██ ████████',
      '██   ██ ██      ██      ████   ██    ██   ',
      '███████ ██   ██ █████   ██ ██  ██    ██   ',
      '██   ██ ██   ██ ██      ██  ██ ██    ██   ',
      '██   ██ ███████ ███████ ██   ████    ██   ',
    ].join('\n');

    const tarsArt = [
      '████████  █████  ██████   ███████',
      '   ██    ██   ██ ██   ██  ██     ',
      '   ██    ███████ ██████   ███████',
      '   ██    ██   ██ ██   ██       ██',
      '   ██    ██   ██ ██   ██  ███████',
    ].join('\n');

    printWelcomeLogo(
      'Agent TARS',
      this.getVersionInfo().version,
      'An open-source Multimodal AI Agent',
      [agentArt, tarsArt],
      'https://agent-tars.com',
    );
  }
}
