import { getAllUsage } from './src/lib/usage';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 6767;
const IDLE_TIMEOUT_SECONDS = process.env.API_IDLE_TIMEOUT_SECONDS
  ? parseInt(process.env.API_IDLE_TIMEOUT_SECONDS)
  : 30;

Bun.serve({
  port: PORT,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  routes: {
    "/api/usage": {
      GET: async () => {
        try {
          const usage = await getAllUsage();
          return Response.json(usage);
        } catch (error) {
          return Response.json(
            {
              error: 'Failed to load usage',
              hint: error instanceof Error ? error.message : String(error),
            },
            { status: 500 }
          );
        }
      },
    },
    "/api/usage/claude": {
      GET: async () => {
        const { getClaudeUsage } = await import('./src/lib/usage');
        return Response.json(await getClaudeUsage());
      },
    },
    "/api/usage/codex": {
      GET: async () => {
        const { getCodexUsage } = await import('./src/lib/usage');
        return Response.json(await getCodexUsage());
      },
    },
    "/api/usage/zai": {
      GET: async () => {
        const { getZaiUsage } = await import('./src/lib/usage');
        return Response.json(await getZaiUsage());
      },
    },
    "/api/usage/openrouter": {
      GET: async () => {
        const { getOpenRouterUsage } = await import('./src/lib/usage');
        return Response.json(await getOpenRouterUsage());
      },
    },
    "/api/usage/opencode-go": {
      GET: async () => {
        const { getOpencodeGoUsage } = await import('./src/lib/usage');
        return Response.json(await getOpencodeGoUsage());
      },
    },
    "/api/usage/opencode-zen": {
      GET: async () => {
        const { getOpencodeZenUsage } = await import('./src/lib/usage');
        return Response.json(await getOpencodeZenUsage());
      },
    },
  },
});

console.log(`API server running at http://localhost:${PORT}`);
