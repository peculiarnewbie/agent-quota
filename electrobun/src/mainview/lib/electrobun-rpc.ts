import { Electroview } from "electrobun/view";
import type { AgentQuotaRpcSchema, ServiceUsage } from "../../shared/rpc";

const rpc = Electroview.defineRPC<AgentQuotaRpcSchema>({
	maxRequestTime: 15000,
	handlers: {
		requests: {},
		messages: {},
	},
});

let electroviewInstance: Electroview<typeof rpc> | null = null;

// --- Browser fixtures for development (Vite dev server without Electrobun) ---

const browserFixtureUsage: ServiceUsage[] = [
	{
		service: "claude",
		status: "ok",
		source: "~/.claude/credentials.json",
		fiveHour: {
			used: "23.4%",
			remaining: "76.6%",
			resetsIn: "3h 12m",
			resetsAtMs: Date.now() + 3 * 3600 * 1000 + 12 * 60 * 1000,
			usedPercent: 23.4,
		},
		sevenDay: {
			used: "8.1%",
			remaining: "91.9%",
			resetsIn: "5d 2h 30m",
			resetsAtMs: Date.now() + 5 * 86400 * 1000 + 2 * 3600 * 1000,
			usedPercent: 8.1,
		},
	},
	{
		service: "codex",
		status: "ok",
		plan: "plus",
		source: "~/.codex/auth.json",
		fiveHour: {
			used: "45%",
			remaining: "55%",
			resetsIn: "1h 48m",
			resetsAtMs: Date.now() + 1 * 3600 * 1000 + 48 * 60 * 1000,
			usedPercent: 45,
		},
		sevenDay: {
			used: "12%",
			remaining: "88%",
			resetsIn: "4d 18h 0m",
			resetsAtMs: Date.now() + 4 * 86400 * 1000 + 18 * 3600 * 1000,
			usedPercent: 12,
		},
	},
	{
		service: "zai",
		status: "ok",
		source: "env:ZAI_API_KEY",
		fiveHour: {
			used: "67%",
			remaining: "33%",
			resetsIn: "2h 5m",
			resetsAtMs: Date.now() + 2 * 3600 * 1000 + 5 * 60 * 1000,
			usedPercent: 67,
		},
	},
	{
		service: "openrouter",
		status: "ok",
		source: "env:OPENROUTER_API_KEY",
		fiveHour: {
			used: "$14.32",
			remaining: "$85.68",
			resetsIn: "--",
			resetsAtMs: 0,
			usedPercent: 14.32,
		},
	},
	{
		service: "opencode-go",
		status: "ok",
		source: "env:OPENCODE_GO_*",
		fiveHour: {
			label: "monthly",
			used: "42%",
			remaining: "58%",
			resetsIn: "12d 4h 0m",
			resetsAtMs: Date.now() + 12 * 86400 * 1000 + 4 * 3600 * 1000,
			usedPercent: 42,
		},
	},
	{
		service: "opencode-zen",
		status: "ok",
		source: "env:OPENCODE_API_KEY",
		fiveHour: {
			used: "--",
			remaining: "USD 42.50",
			resetsIn: "--",
			resetsAtMs: 0,
			usedPercent: 0,
		},
	},
];

function useBrowserFixture() {
	return (
		import.meta.env.DEV &&
		typeof window !== "undefined" &&
		typeof window.__electrobunWebviewId !== "number"
	);
}

export function initDesktopRpc() {
	if (typeof window === "undefined" || electroviewInstance) return;
	if (typeof window.__electrobunWebviewId !== "number") return;

	electroviewInstance = new Electroview({ rpc });
}

export const desktopRpc = {
	getAllUsage() {
		if (useBrowserFixture()) {
			return Promise.resolve(browserFixtureUsage);
		}

		return rpc.requestProxy.getAllUsage(undefined);
	},

	getServiceUsage(params: { service: string }) {
		if (useBrowserFixture()) {
			const fixture = browserFixtureUsage.find(
				(u) => u.service === params.service,
			);
			return Promise.resolve(
				fixture ?? {
					service: params.service,
					status: "error" as const,
					error: "Unknown service (fixture)",
				},
			);
		}

		return rpc.requestProxy.getServiceUsage(params);
	},

	quitApp() {
		if (useBrowserFixture()) {
			console.log("[fixture] quitApp called");
			return Promise.resolve({ ok: true });
		}

		return rpc.requestProxy.quitApp(undefined);
	},
};
