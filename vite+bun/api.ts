import { getAllUsage } from './src/lib/usage';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 6767;
const IDLE_TIMEOUT_SECONDS = process.env.API_IDLE_TIMEOUT_SECONDS
  ? parseInt(process.env.API_IDLE_TIMEOUT_SECONDS)
  : 30;

function corsJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return Response.json(data, { ...init, headers });
}

Bun.serve({
  port: PORT,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  routes: {
    "/api/usage": {
      GET: async () => {
        try {
          const usage = await getAllUsage();
          return corsJson(usage);
        } catch (error) {
          return corsJson(
            {
              error: 'Failed to load usage',
              hint: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
          );
        }
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }),
    },
    "/api/usage/claude": {
      GET: async () => {
        const { getClaudeUsage } = await import('./src/lib/usage');
        return corsJson(await getClaudeUsage());
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }),
    },
    "/api/usage/codex": {
      GET: async () => {
        const { getCodexUsage } = await import('./src/lib/usage');
        return corsJson(await getCodexUsage());
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }),
    },
    "/api/usage/zai": {
      GET: async () => {
        const { getZaiUsage } = await import('./src/lib/usage');
        return corsJson(await getZaiUsage());
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }),
    },
    "/api/usage/openrouter": {
      GET: async () => {
        const { getOpenRouterUsage } = await import('./src/lib/usage');
        return corsJson(await getOpenRouterUsage());
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }),
    },
    "/api/usage/opencode-go": {
      GET: async () => {
        const { getOpencodeGoUsage } = await import('./src/lib/usage');
        return corsJson(await getOpencodeGoUsage());
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }),
    },
    "/api/usage/opencode-zen": {
      GET: async () => {
        const { getOpencodeZenUsage } = await import('./src/lib/usage');
        return corsJson(await getOpencodeZenUsage());
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }),
    },
    "/api/usage/crof-ai": {
      GET: async () => {
        const { getCrofAIUsage } = await import('./src/lib/usage');
        return corsJson(await getCrofAIUsage());
      },
      OPTIONS: () => new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } }),
    },
  },
});

console.log(`API server running at http://localhost:${PORT}`);
