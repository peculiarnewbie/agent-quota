/** @jsxImportSource solid-js */
import { createSignal, onMount, onCleanup, Show, For } from "solid-js";
import type { ServiceUsage, UsageWindow } from "./lib/usage";

const REFRESH_INTERVAL = 5 * 60 * 1000;

function fillColor(pct: number): string {
    if (pct >= 100) return "#ef4444";
    if (pct >= 90) return "#f97316";
    if (pct >= 70) return "#eab308";
    return "#22c55e";
}

function formatTimeOfDay(ms: number): string {
    if (!ms) return "--";
    const d = new Date(ms);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(ms: number): string {
    if (!ms) return "--";
    const d = new Date(ms);
    return (
        d.toLocaleDateString([], { month: "short", day: "numeric" }) +
        ", " +
        d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    );
}

function ProgressBar(props: { percent: number; size?: "sm" | "md" }) {
    const height = props.size === "sm" ? "h-1.5" : "h-2";
    return (
        <div class={`progress-track ${height} w-full`}>
            <div
                class="progress-fill"
                style={{
                    width: `${Math.min(props.percent, 100)}%`,
                    background: fillColor(props.percent),
                }}
            />
        </div>
    );
}

function StatusDot(props: { percent?: number; status: string }) {
    const color = () => {
        if (props.status !== "ok") return "#52525b";
        if (props.percent === undefined) return "#22c55e";
        return fillColor(props.percent);
    };
    return <span class="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color() }} />;
}

function UsageCard(props: { usage: ServiceUsage }) {
    const u = props.usage;
    const maxPercent = () => Math.max(u.fiveHour?.usedPercent || 0, u.sevenDay?.usedPercent || 0);

    return (
        <Show
            when={u.status === "ok"}
            fallback={
                <div class="card-usage rounded-lg p-4 opacity-50">
                    <div class="flex items-center gap-2 mb-2">
                        <StatusDot status={u.status} />
                        <span class="font-medium text-zinc-400 capitalize">{u.service}</span>
                    </div>
                    <p class="text-xs text-red-400/70 font-mono">{u.error}</p>
                </div>
            }
        >
            <div class="card-usage rounded-lg p-4 transition-all duration-300 hover:border-zinc-700">
                <div class="flex items-center justify-between mb-3">
                    <div class="flex items-center gap-2">
                        <StatusDot status={u.status} percent={maxPercent()} />
                        <span class="font-semibold capitalize text-zinc-100">{u.service}</span>
                    </div>
                    <Show when={u.plan}>
                        <span class="section-label text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded">
                            {u.plan}
                        </span>
                    </Show>
                </div>

                <div class="space-y-3">
                    <Show when={u.fiveHour}>
                        <div>
                            <div class="flex items-center justify-between mb-1.5">
                                <span class="text-xs text-zinc-500 font-mono uppercase tracking-wider">
                                    5h window
                                </span>
                                <span
                                    class="font-mono text-sm tabular-nums"
                                    style={{ color: fillColor(u.fiveHour!.usedPercent) }}
                                >
                                    {u.fiveHour!.used}
                                </span>
                            </div>
                            <ProgressBar percent={u.fiveHour!.usedPercent} />
                            <div class="flex justify-between mt-2">
                                <span class="text-xs text-zinc-500 font-mono">
                                    reset {u.fiveHour!.resetsIn}
                                </span>
                                <span class="text-xs text-zinc-500 font-mono">
                                    {formatTimeOfDay(u.fiveHour!.resetsAtMs)}
                                </span>
                            </div>
                        </div>
                    </Show>

                    <Show when={u.sevenDay}>
                        <div>
                            <div class="flex items-center justify-between mb-1.5">
                                <span class="text-xs text-zinc-500 font-mono uppercase tracking-wider">
                                    7d window
                                </span>
                                <span
                                    class="font-mono text-sm tabular-nums"
                                    style={{ color: fillColor(u.sevenDay!.usedPercent) }}
                                >
                                    {u.sevenDay!.used}
                                </span>
                            </div>
                            <ProgressBar percent={u.sevenDay!.usedPercent} />
                            <div class="flex justify-between mt-2">
                                <span class="text-xs text-zinc-500 font-mono">
                                    reset {u.sevenDay!.resetsIn}
                                </span>
                                <span class="text-xs text-zinc-500 font-mono">
                                    {formatDateTime(u.sevenDay!.resetsAtMs)}
                                </span>
                            </div>
                        </div>
                    </Show>

                    <Show when={u.hint}>
                        <p class="text-[10px] text-zinc-600 italic pt-1 border-t border-zinc-800">
                            {u.hint}
                        </p>
                    </Show>
                </div>
            </div>
        </Show>
    );
}

function CreditCard(props: { usage: ServiceUsage }) {
    const u = props.usage;

    return (
        <Show
            when={u.status === "ok"}
            fallback={
                <div class="card-credits rounded-xl p-6 opacity-50">
                    <div class="flex items-center gap-2 mb-2">
                        <StatusDot status={u.status} />
                        <span class="font-medium text-zinc-400 capitalize">{u.service}</span>
                    </div>
                    <p class="text-xs text-red-400/70 font-mono">{u.error}</p>
                </div>
            }
        >
            <div class="card-credits rounded-xl p-6 animate-fade-in">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-2">
                        <StatusDot status={u.status} />
                        <span class="section-label text-cyan-400/80 capitalize">
                            {u.service.replace("-", " ")}
                        </span>
                    </div>
                    <Show when={u.plan}>
                        <span class="text-[10px] text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded font-mono">
                            {u.plan}
                        </span>
                    </Show>
                </div>

                <div class="grid grid-cols-2 gap-4">
                    <Show when={u.fiveHour?.used}>
                        <div>
                            <p class="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">
                                Used
                            </p>
                            <p class="text-xl font-semibold text-amber-400 font-mono tracking-tight">
                                {u.fiveHour!.used}
                            </p>
                        </div>
                    </Show>
                    <Show when={u.fiveHour?.remaining}>
                        <div>
                            <p class="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">
                                Remaining
                            </p>
                            <p class="text-xl font-semibold text-cyan-300 font-mono tracking-tight">
                                {u.fiveHour!.remaining}
                            </p>
                        </div>
                    </Show>
                </div>

                <Show when={u.source}>
                    <div class="mt-4 pt-4 border-t border-cyan-400/10">
                        <span class="text-[10px] text-zinc-600 font-mono truncate">{u.source}</span>
                    </div>
                </Show>
            </div>
        </Show>
    );
}

export default function App() {
    const [usage, setUsage] = createSignal<ServiceUsage[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<string | null>(null);
    const [lastUpdated, setLastUpdated] = createSignal<Date | null>(null);

    const usageServices = () =>
        usage().filter((u) => ["claude", "codex", "zai"].includes(u.service));

    const creditServices = () =>
        usage().filter((u) => ["openrouter", "opencode-zen"].includes(u.service));

    async function fetchUsage() {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/usage");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            setUsage(data);
            setLastUpdated(new Date());
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    onMount(() => {
        fetchUsage();
        const interval = setInterval(fetchUsage, REFRESH_INTERVAL);
        onCleanup(() => clearInterval(interval));
    });

    return (
        <div class="min-h-screen relative">
            <div class="noise-overlay" />

            <div class="max-w-5xl mx-auto p-6 md:p-10 relative z-10">
                <header class="mb-10 animate-fade-in">
                    <div class="flex items-center justify-between">
                        <div>
                            <p class="section-label text-zinc-600 mb-1">API Quota Dashboard</p>
                            <h1 class="text-2xl font-semibold text-zinc-100 tracking-tight">
                                Agent Quota
                            </h1>
                        </div>
                        <div class="flex items-center gap-4">
                            <Show when={lastUpdated()}>
                                <span class="text-xs text-zinc-500 font-mono tabular-nums">
                                    {lastUpdated()!.toLocaleTimeString()}
                                </span>
                            </Show>
                            <button
                                onClick={fetchUsage}
                                disabled={loading()}
                                class="font-mono text-[11px] text-zinc-500 hover:text-cyan-400 disabled:text-zinc-700 transition-colors px-2 py-1 border border-zinc-800 rounded hover:border-cyan-400/30 disabled:cursor-not-allowed"
                            >
                                {loading() ? "syncing..." : "refresh"}
                            </button>
                        </div>
                    </div>
                </header>

                <Show when={error()}>
                    <div class="text-sm text-red-400/70 mb-6 font-mono bg-red-400/5 border border-red-400/10 rounded-lg p-3">
                        error: {error()}
                    </div>
                </Show>

                <Show when={loading() && usage().length === 0}>
                    <div class="flex items-center justify-center py-20">
                        <div class="text-center">
                            <div class="w-8 h-8 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3" />
                            <p class="text-xs text-zinc-600 font-mono">loading data...</p>
                        </div>
                    </div>
                </Show>

                <Show when={usage().length > 0 || !loading()}>
                    <div class="space-y-10">
                        <section class="animate-fade-in animate-fade-in-delay-1">
                            <div class="flex items-center gap-3 mb-4">
                                <div class="w-1 h-1 rounded-full bg-amber-500" />
                                <h2 class="section-label text-zinc-500">Usage Tracking</h2>
                                <div class="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <For each={usageServices()}>
                                    {(item) => <UsageCard usage={item} />}
                                </For>
                            </div>
                        </section>

                        <section class="animate-fade-in animate-fade-in-delay-2">
                            <div class="flex items-center gap-3 mb-4">
                                <div class="w-1 h-1 rounded-full bg-cyan-400" />
                                <h2 class="section-label text-zinc-500">Credits & Balance</h2>
                                <div class="flex-1 h-px bg-gradient-to-r from-zinc-800 to-transparent" />
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <For each={creditServices()}>
                                    {(item) => <CreditCard usage={item} />}
                                </For>
                            </div>
                        </section>
                    </div>
                </Show>

                <footer class="mt-12 pt-6 border-t border-zinc-800/50 animate-fade-in animate-fade-in-delay-3">
                    <div class="flex flex-wrap gap-x-6 gap-y-1">
                        <For each={usage().filter((u) => u.source)}>
                            {(item) => (
                                <span
                                    class="text-[10px] font-mono text-zinc-700 truncate max-w-xs"
                                    title={item.source}
                                >
                                    {item.service}: {item.source}
                                </span>
                            )}
                        </For>
                    </div>
                </footer>
            </div>
        </div>
    );
}
