import type { AppConfig } from './types';
export const DEFAULT_CONFIG: AppConfig = {
  zentao: { baseUrl: '', edition: 'open', auth: 'token', account: '', secret: '', scope: 'mine', syncIntervalMin: 5, connected: false },
  gitlab: { baseUrl: '', token: '', targetBranch: 'main', mrDraft: true, connected: false },
  codex: { cliPath: '', model: 'Codex · 标准', sandbox: 'workspace-write', concurrency: 1, connected: false },
  mappings: [],
};
