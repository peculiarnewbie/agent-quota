import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

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

export function getOpenRouterCredentials() {
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey) {
    return { apiKey: envKey, source: 'env:OPENROUTER_API_KEY' };
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

export function getCrofAICredentials() {
  const apiKey = String(process.env.CROF_AI_API_KEY || "").trim();
  if (!apiKey) return null;

  const parsedLimit = Number(process.env.CROF_AI_DAILY_LIMIT);
  const dailyLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 0;

  return { apiKey, dailyLimit, source: "env:CROF_AI_*" };
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
