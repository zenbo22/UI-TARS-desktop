import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FiSettings, FiX } from 'react-icons/fi';
import { Dialog, DialogPanel } from '@tarko/ui';
import { apiService } from '@/common/services/apiService';
import { SanitizedAgentOptions } from '@/common/types';
import { JSONViewer, LoadingSpinner } from '@tarko/ui';
import { API_ENDPOINTS } from '@/common/constants';
import { API_BASE_URL } from '@/config/web-ui-config';

interface AgentConfigViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AgentConfigViewer: React.FC<AgentConfigViewerProps> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<SanitizedAgentOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadConfig = useCallback(async () => {
    if (!isOpen) return;

    setLoading(true);
    setError(null);

    try {
      const options = await apiService.getAgentOptions();
      setConfig(options);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  }, [isOpen]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const skills = config?.skills?.available ?? [];
  const hasSkills = skills.length > 0;
  const buildSkillReadUrl = (name: string) =>
    `${API_BASE_URL}${API_ENDPOINTS.SKILLS_READ}?name=${encodeURIComponent(name)}`;
  const buildWorkflowUrl = (name: string) =>
    `${API_BASE_URL}${API_ENDPOINTS.SKILLS_WORKFLOW}?name=${encodeURIComponent(name)}`;

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    setImporting(true);
    setError(null);

    try {
      const text = await file.text();
      const workflow = JSON.parse(text);
      const nameFromFile = typeof workflow?.name === 'string' ? workflow.name : undefined;
      const payload = {
        name: nameFromFile || file.name.replace(/\.json$/i, ''),
        workflow,
      };

      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.SKILLS_IMPORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || '导入失败');
      }

      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={isOpen} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogPanel className="relative max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FiSettings size={20} className="text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                Agent Configuration
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Current agent options and settings
              </p>
            </div>
          </div>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            <FiX size={20} className="text-gray-500 dark:text-gray-400" />
          </motion.button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 max-h-[calc(85vh-120px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner />
              <span className="ml-3 text-gray-600 dark:text-gray-400">
                Loading configuration...
              </span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="text-red-500 mb-2">⚠️</div>
                <p className="text-red-600 dark:text-red-400 font-medium mb-2">
                  Failed to load configuration
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={loadConfig}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  Retry
                </motion.button>
              </div>
            </div>
          ) : config && Object.keys(config).length > 0 ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    Available Skills
                  </h3>
                  <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                    <button
                      type="button"
                      onClick={handleImportClick}
                      disabled={importing}
                      className="rounded-md border border-blue-200 px-2 py-1 text-blue-600 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50 dark:border-blue-500/40 dark:text-blue-400 dark:hover:border-blue-500/60"
                    >
                      {importing ? '导入中...' : '导入 workflow'}
                    </button>
                    <span>{hasSkills ? `${skills.length} total` : 'None'}</span>
                  </div>
                </div>
                {hasSkills ? (
                  <div className="space-y-2">
                    {skills.map((skill) => (
                      <div
                        key={`${skill.location}-${skill.name}`}
                        className="flex items-start justify-between gap-4 rounded-md bg-gray-50 dark:bg-gray-800/50 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {skill.name}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {skill.description}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className="text-xs text-gray-400 dark:text-gray-500">
                            {skill.location}
                          </div>
                          <div className="flex items-center gap-2 text-xs">
                            <a
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                              href={buildSkillReadUrl(skill.name)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              打开
                            </a>
                            {skill.workflowFile && (
                              <a
                                className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                                href={buildWorkflowUrl(skill.name)}
                              >
                                下载 workflow
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    No skills found. Add skills under `.agent/skills` or `.claude/skills`.
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </div>
              <JSONViewer data={config} emptyMessage="No configuration available" />
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="text-gray-400 mb-2">📋</div>
                <p className="text-gray-600 dark:text-gray-400 font-medium">
                  No configuration available
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  The agent has no exposed configuration options
                </p>
              </div>
            </div>
          )}
        </div>
      </DialogPanel>
    </Dialog>
  );
};
