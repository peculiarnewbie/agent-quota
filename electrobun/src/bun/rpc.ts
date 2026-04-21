import { BrowserView } from "electrobun/bun";
import type { AgentQuotaRpcSchema } from "../shared/rpc";
import { quitApp } from "./app-lifecycle";
import {
	getAllUsage,
	getClaudeUsage,
	getCodexUsage,
	getZaiUsage,
	getOpencodeGoUsage,
	getOpenRouterUsage,
	getOpencodeZenUsage,
} from "./usage";

const serviceFetchers: Record<string, () => Promise<import("../shared/rpc").ServiceUsage>> = {
	claude: getClaudeUsage,
	codex: getCodexUsage,
	zai: getZaiUsage,
	"opencode-go": getOpencodeGoUsage,
	openrouter: getOpenRouterUsage,
	"opencode-zen": getOpencodeZenUsage,
};

export const appRpc = BrowserView.defineRPC<AgentQuotaRpcSchema>({
	handlers: {
		requests: {
			async getAllUsage() {
				console.log("[rpc] getAllUsage start");
				const startedAt = Date.now();
				try {
					const result = await getAllUsage();
					console.log(`[rpc] getAllUsage ok ${Date.now() - startedAt}ms`);
					return result;
				} catch (error) {
					console.error(`[rpc] getAllUsage failed ${Date.now() - startedAt}ms`, error);
					throw error;
				}
			},
			async getServiceUsage(params) {
				const service = params?.service ?? "claude";
				console.log(`[rpc] getServiceUsage(${service}) start`);
				const startedAt = Date.now();
				try {
					const fetcher = serviceFetchers[service];
					if (!fetcher) {
						return {
							service,
							status: "error" as const,
							error: `Unknown service: ${service}`,
						};
					}
					const result = await fetcher();
					console.log(`[rpc] getServiceUsage(${service}) ok ${Date.now() - startedAt}ms`);
					return result;
				} catch (error) {
					console.error(`[rpc] getServiceUsage(${service}) failed ${Date.now() - startedAt}ms`, error);
					throw error;
				}
			},
			async quitApp() {
				console.log("[rpc] quitApp");
				// Small delay so the RPC response can be sent back.
				setTimeout(() => quitApp(), 100);
				return { ok: true };
			},
		},
		messages: {},
	},
});
