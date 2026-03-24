export interface UsageWindow {
	used: string;
	remaining: string;
	resetsIn: string;
	resetsAtMs: number;
	usedPercent: number;
}

export interface ServiceUsage {
	service: string;
	status: "ok" | "error" | "no_credentials";
	error?: string;
	hint?: string;
	fiveHour?: UsageWindow;
	sevenDay?: UsageWindow;
	plan?: string;
	source?: string;
}

export type AgentQuotaRpcSchema = {
	bun: {
		requests: {
			getAllUsage: {
				params: undefined;
				response: ServiceUsage[];
			};
			getServiceUsage: {
				params: { service: string };
				response: ServiceUsage;
			};
		};
		messages: {};
	};
	webview: {
		requests: {};
		messages: {};
	};
};
