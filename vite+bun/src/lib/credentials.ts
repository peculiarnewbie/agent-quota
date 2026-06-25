import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

const HOME = homedir();

export interface ClaudeCredentials {
  accessToken: string;
  source: string;
}

export interface CodexCredentials {
  accessToken?: string;
  accountId?: string;
  apiKey?: string;
  source: string;
}

export interface ZaiCredentials {
  apiKey: string;
  source: string;
}

export interface OpenRouterCredentials {
  apiKey: string;
  source: string;
}

export interface OpencodeZenCredentials {
  apiKey: string;
  source: string;
}

export interface OpencodeGoCredentials {
  workspaceId: string;
  authCookie: string;
  source: string;
}

export interface CrofaiCredentials {
  session: string;
  source: string;
}

export interface CursorCredentials {
  accessToken: string;
  refreshToken: string | null;
  source: string;
}

export function getClaudeCredentials(): ClaudeCredentials | null {
  const credPaths = [
    join(HOME, '.claude', '.credentials.json'),
    join(HOME, '.claude', 'credentials.json'),
    join(HOME, '.config', 'claude', 'credentials.json'),
  ];

  for (const credPath of credPaths) {
    if (existsSync(credPath)) {
      try {
        const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
        const token = creds?.claudeAiOauth?.accessToken || creds?.accessToken;
        if (token) {
          return { accessToken: token, source: credPath };
        }
      } catch {}
    }
  }

  const envToken = process.env.CLAUDE_ACCESS_TOKEN;
  if (envToken) {
    return { accessToken: envToken, source: 'environment' };
  }

  return null;
}

export function getCodexCredentials(): CodexCredentials | null {
  const result: CodexCredentials = { source: '' };

  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    result.apiKey = envKey;
    result.source = 'environment';
  }

  const authPaths = [
    join(HOME, '.codex', 'auth.json'),
    join(HOME, '.config', 'codex', 'auth.json'),
  ];

  for (const authPath of authPaths) {
    if (existsSync(authPath)) {
      try {
        const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
        
        if (!result.apiKey && auth.OPENAI_API_KEY) {
          result.apiKey = auth.OPENAI_API_KEY;
        }
        
        if (auth.tokens) {
          if (auth.tokens.access_token) {
            result.accessToken = auth.tokens.access_token;
          }
          if (auth.tokens.account_id) {
            result.accountId = auth.tokens.account_id;
          }
        }
        
        if (result.accessToken || result.apiKey) {
          result.source = authPath;
          return result;
        }
      } catch {}
    }
  }

  return Object.keys(result).some(k => k !== 'source' && result[k as keyof CodexCredentials]) ? result : null;
}

export function getZaiCredentials(): ZaiCredentials | null {
  const credPath = join(HOME, '.zai', 'config.json');
  
  if (existsSync(credPath)) {
    try {
      const config = JSON.parse(readFileSync(credPath, 'utf-8'));
      if (config.apiKey || config.api_key) {
        return { 
          apiKey: config.apiKey || config.api_key, 
          source: credPath 
        };
      }
    } catch {}
  }

  const envVars = ['ZAI_API_KEY', 'ZAI_KEY', 'ZHIPU_API_KEY', 'ZHIPUAI_API_KEY'];
  for (const varName of envVars) {
    const key = process.env[varName];
    if (key) {
      return { apiKey: key, source: `env:${varName}` };
    }
  }

  return null;
}

export function getOpenRouterCredentials(): OpenRouterCredentials | null {
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) {
    return { apiKey: envKey, source: 'env:OPENROUTER_API_KEY' };
  }

  return null;
}

export function getOpencodeZenCredentials(): OpencodeZenCredentials | null {
  const envKey = process.env.OPENCODE_API_KEY;
  if (envKey) {
    return { apiKey: envKey, source: 'env:OPENCODE_API_KEY' };
  }

  const configPaths = [
    join(HOME, '.config', 'opencode', 'config.json'),
    join(HOME, '.opencode', 'config.json'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (config.OPENCODE_API_KEY || config.apiKey || config.api_key) {
          return {
            apiKey: config.OPENCODE_API_KEY || config.apiKey || config.api_key,
            source: configPath,
          };
        }
      } catch {}
    }
  }

  return null;
}

export function getOpencodeGoCredentials(): OpencodeGoCredentials | null {
  const workspaceId = process.env.OPENCODE_GO_WORKSPACE_ID?.trim();
  const authCookie = process.env.OPENCODE_GO_AUTH_COOKIE?.trim();
  if (workspaceId && authCookie) {
    return {
      workspaceId,
      authCookie,
      source: 'env:OPENCODE_GO_*',
    };
  }

  const configPaths = [
    join(HOME, '.config', 'opencode', 'opencode-quota', 'opencode-go.json'),
    join(HOME, '.opencode-quota', 'opencode-go.json'),
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const fileWorkspaceId =
        typeof config.workspaceId === 'string' ? config.workspaceId.trim() : '';
      const fileAuthCookie =
        typeof config.authCookie === 'string' ? config.authCookie.trim() : '';

      if (fileWorkspaceId && fileAuthCookie) {
        return {
          workspaceId: fileWorkspaceId,
          authCookie: fileAuthCookie,
          source: configPath,
        };
      }
    } catch {}
  }

  return null;
}

export function getCrofaiCredentials(): CrofaiCredentials | null {
  const envSession = process.env.CROFAI_SESSION?.trim();
  if (envSession) {
    return { session: envSession, source: 'env:CROFAI_SESSION' };
  }

  const configPaths = [
    join(HOME, '.config', 'opencode', 'opencode-quota', 'crofai.json'),
    join(HOME, '.opencode-quota', 'crofai.json'),
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;

    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const session = typeof config.session === 'string' ? config.session.trim() : '';

      if (session) {
        return { session, source: configPath };
      }
    } catch {}
  }

  return null;
}

function readCursorStateDb(): { accessToken: string | null; refreshToken: string | null } | null {
  const dbPath = join(HOME, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (!existsSync(dbPath)) return null;

  try {
    const { Database } = require('bun:sqlite');
    const db = new Database(dbPath, { readonly: true });
    const row = db.query(
      "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken', 'cursorAuth/refreshToken')"
    ).all() as { key: string; value: string }[];
    db.close();

    const accessToken = row.find(r => r.key === 'cursorAuth/accessToken')?.value || null;
    const refreshToken = row.find(r => r.key === 'cursorAuth/refreshToken')?.value || null;
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

export function getCursorCredentials(): CursorCredentials | null {
  const envAccess = process.env.CURSOR_ACCESS_TOKEN?.trim();
  const envRefresh = process.env.CURSOR_REFRESH_TOKEN?.trim();
  if (envAccess) {
    return { accessToken: envAccess, refreshToken: envRefresh || null, source: 'env:CURSOR_*' };
  }

  const configPaths = [
    join(HOME, '.config', 'opencode', 'opencode-quota', 'cursor.json'),
    join(HOME, '.opencode-quota', 'cursor.json'),
  ];

  for (const configPath of configPaths) {
    if (!existsSync(configPath)) continue;
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf-8'));
      const accessToken = typeof config.accessToken === 'string' ? config.accessToken.trim() : '';
      const refreshToken = typeof config.refreshToken === 'string' ? config.refreshToken.trim() : null;
      if (accessToken) {
        return { accessToken, refreshToken, source: configPath };
      }
    } catch {}
  }

  const state = readCursorStateDb();
  if (state?.accessToken) {
    return { accessToken: state.accessToken, refreshToken: state.refreshToken, source: 'Cursor state.vscdb' };
  }

  return null;
}