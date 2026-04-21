export interface UsageWindow {
    used: string;
    remaining: string;
    resetsIn: string;
    resetsAtMs: number;
    usedPercent: number;
    label?: string;
}

export interface ServiceUsage {
    service: string;
    status: "ok" | "error" | "no_credentials";
    error?: string;
    hint?: string;
    fiveHour?: UsageWindow;
    sevenDay?: UsageWindow;
    monthly?: UsageWindow;
    plan?: string;
    source?: string;
}
