import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';

const HOME = homedir();

export function getClaudeCredentials() {
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

export function getCodexCredentials() {
  const result = { source: '' };

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

  return Object.keys(result).some(k => k !== 'source' && result[k]) ? result : null;
}

export function getZaiCredentials() {
  const configPaths = [
    join(HOME, '.zai', 'config.json'),
    join(HOME, '.config', 'zai', 'config.json'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (config.apiKey || config.api_key) {
          return {
            apiKey: config.apiKey || config.api_key,
            source: configPath,
          };
        }
      } catch {}
    }
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

export function getOpenRouterCredentials() {
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) {
    return { apiKey: envKey, source: 'env:OPENROUTER_API_KEY' };
  }

  const configPaths = [
    join(HOME, '.config', 'openrouter', 'config.json'),
    join(HOME, '.openrouter', 'config.json'),
  ];

  for (const configPath of configPaths) {
    if (existsSync(configPath)) {
      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        if (config.OPENROUTER_API_KEY || config.apiKey || config.api_key) {
          return {
            apiKey: config.OPENROUTER_API_KEY || config.apiKey || config.api_key,
            source: configPath,
          };
        }
      } catch {}
    }
  }

  return null;
}

export function getOpencodeZenCredentials() {
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

export function getOpencodeGoCredentials() {
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

export function getCrofaiCredentials() {
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

let _sqlJs = null;
async function getSqlJs() {
  if (_sqlJs) return _sqlJs;
  const mod = await import('sql.js');
  const initSqlJs = mod.default;
  _sqlJs = await initSqlJs();
  return _sqlJs;
}

function readCursorStateDbSync() {
  const dbPath = join(HOME, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (!existsSync(dbPath)) return null;

  try {
    const out = execFileSync('sqlite3', [
      dbPath,
      "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken', 'cursorAuth/refreshToken')",
    ], { encoding: 'utf-8', timeout: 5000 });

    const lines = out.trim().split('\n');
    const result = {};
    for (const line of lines) {
      const sep = line.indexOf('|');
      if (sep > 0) {
        result[line.slice(0, sep)] = line.slice(sep + 1);
      }
    }

    if (result['cursorAuth/accessToken']) {
      return {
        accessToken: result['cursorAuth/accessToken'],
        refreshToken: result['cursorAuth/refreshToken'] || null,
      };
    }
  } catch {}

  return null;
}

async function readCursorStateDbAsync() {
  const dbPath = join(HOME, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb');
  if (!existsSync(dbPath)) return null;

  try {
    const SQL = await getSqlJs();
    const buf = readFileSync(dbPath);
    const db = new SQL.Database(buf);
    const result = db.exec(
      "SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken', 'cursorAuth/refreshToken')"
    );
    db.close();

    if (!result || result.length === 0) return null;
    const rows = result[0].values;
    const accessToken = rows.find(r => r[0] === 'cursorAuth/accessToken')?.[1] || null;
    const refreshToken = rows.find(r => r[0] === 'cursorAuth/refreshToken')?.[1] || null;

    if (accessToken) {
      return { accessToken, refreshToken };
    }
  } catch {}

  return null;
}

export async function getCursorCredentials() {
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

  const syncResult = readCursorStateDbSync();
  if (syncResult?.accessToken) {
    return { accessToken: syncResult.accessToken, refreshToken: syncResult.refreshToken, source: 'Cursor state.vscdb' };
  }

  const asyncResult = await readCursorStateDbAsync();
  if (asyncResult?.accessToken) {
    return { accessToken: asyncResult.accessToken, refreshToken: asyncResult.refreshToken, source: 'Cursor state.vscdb (sql.js)' };
  }

  return null;
}