import { createSignal, onMount, onCleanup, Show, For, Index, createEffect } from "solid-js";
import {
    isUsageService,
    type ServiceUsage,
    type SettingsPublic,
    type CodexAccountPublic,
    type OpencodeGoAccountPublic,
} from "./lib/types";

const BROWSER_REFRESH_INTERVAL = 5 * 60 * 1000;
/** Countdown display is minute-granular; tick often enough to flip promptly. */
const RESET_TICK_INTERVAL = 15 * 1000;

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

/** Match server `format_duration_seconds` so client countdown looks identical. */
function formatDurationSeconds(totalSeconds: number): string {
    if (totalSeconds <= 0) return "Now";
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatResetsIn(resetsAtMs: number, fallback: string, nowMs: number): string {
    if (!resetsAtMs) return fallback;
    return formatDurationSeconds(Math.floor((resetsAtMs - nowMs) / 1000));
}

function cardTitle(u: ServiceUsage): string {
    return u.displayName?.trim() || u.service;
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

function UsageCard(props: {
    usage: ServiceUsage;
    nowMs: number;
    refreshing?: boolean;
    onRefresh?: () => void;
}) {
    const u = () => props.usage;
    const maxPercent = () =>
        Math.max(
            u().fiveHour?.usedPercent || 0,
            u().sevenDay?.usedPercent || 0,
            u().monthly?.usedPercent || 0,
        );
    const title = () => cardTitle(u());
    const resetLabel = (window: { resetsAtMs: number; resetsIn: string }) =>
        formatResetsIn(window.resetsAtMs, window.resetsIn, props.nowMs);

    const refreshBtn = () => (
        <Show when={props.onRefresh}>
            <button
                type="button"
                title={`Refresh ${u().service}`}
                onClick={(e) => {
                    e.stopPropagation();
                    props.onRefresh?.();
                }}
                disabled={props.refreshing}
                class="font-mono text-[10px] text-zinc-600 hover:text-cyan-400 disabled:text-zinc-700 transition-colors px-1.5 py-0.5 border border-zinc-800 rounded hover:border-cyan-400/30 disabled:cursor-not-allowed shrink-0"
            >
                {props.refreshing ? "…" : "↻"}
            </button>
        </Show>
    );

    return (
        <Show
            when={u().status === "ok"}
            fallback={
                <div class="card-usage rounded-lg p-2.5 opacity-40">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <StatusDot status={u().status} />
                        <div class="min-w-0 flex-1">
                            <span class="text-xs font-medium text-zinc-500 block truncate">{title()}</span>
                            <Show when={u().accountEmail}>
                                <span class="text-[10px] text-zinc-600 font-mono truncate block">
                                    {u().accountEmail}
                                </span>
                            </Show>
                        </div>
                        <span class="text-[10px] text-zinc-600 font-mono truncate ml-auto shrink-0">
                            {u().error}
                        </span>
                        {refreshBtn()}
                    </div>
                </div>
            }
        >
            <div class="card-usage rounded-lg p-4 transition-all duration-300 hover:border-zinc-700">
                <div class="flex items-center justify-between mb-3 gap-2">
                    <div class="flex items-center gap-2 min-w-0">
                        <StatusDot status={u().status} percent={maxPercent()} />
                        <div class="min-w-0">
                            <span class="font-semibold text-zinc-100 block truncate">{title()}</span>
                            <Show when={u().accountEmail}>
                                <span class="text-[10px] text-zinc-500 font-mono truncate block">
                                    {u().accountEmail}
                                </span>
                            </Show>
                        </div>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <Show when={u().plan}>
                            <span class="section-label text-zinc-600 bg-zinc-800/50 px-2 py-0.5 rounded">
                                {u().plan}
                            </span>
                        </Show>
                        {refreshBtn()}
                    </div>
                </div>

                <div class="space-y-3">
                    <Show when={u().fiveHour}>
                        <div>
                            <div class="flex items-center justify-between mb-1.5">
                                <span class="text-xs text-zinc-500 font-mono uppercase tracking-wider">
                                    {u().fiveHour?.label || "5h window"}
                                </span>
                                <span
                                    class="font-mono text-sm tabular-nums"
                                    style={{ color: fillColor(u().fiveHour!.usedPercent) }}
                                >
                                    {u().fiveHour!.used}
                                </span>
                            </div>
                            <ProgressBar percent={u().fiveHour!.usedPercent} />
                            <div class="flex justify-between mt-2">
                                <span class="text-xs text-zinc-500 font-mono">
                                    reset {resetLabel(u().fiveHour!)}
                                </span>
                                <span class="text-xs text-zinc-500 font-mono">
                                    {formatTimeOfDay(u().fiveHour!.resetsAtMs)}
                                </span>
                            </div>
                        </div>
                    </Show>

                    <Show when={u().sevenDay}>
                        <div>
                            <div class="flex items-center justify-between mb-1.5">
                                <span class="text-xs text-zinc-500 font-mono uppercase tracking-wider">
                                    {u().sevenDay?.label || "7d window"}
                                </span>
                                <span
                                    class="font-mono text-sm tabular-nums"
                                    style={{ color: fillColor(u().sevenDay!.usedPercent) }}
                                >
                                    {u().sevenDay!.used}
                                </span>
                            </div>
                            <ProgressBar percent={u().sevenDay!.usedPercent} />
                            <div class="flex justify-between mt-2">
                                <span class="text-xs text-zinc-500 font-mono">
                                    reset {resetLabel(u().sevenDay!)}
                                </span>
                                <span class="text-xs text-zinc-500 font-mono">
                                    {formatDateTime(u().sevenDay!.resetsAtMs)}
                                </span>
                            </div>
                        </div>
                    </Show>

                    <Show when={u().monthly}>
                        <div>
                            <div class="flex items-center justify-between mb-1.5">
                                <span class="text-xs text-zinc-500 font-mono uppercase tracking-wider">
                                    {u().monthly?.label || "monthly"}
                                </span>
                                <span
                                    class="font-mono text-sm tabular-nums"
                                    style={{ color: fillColor(u().monthly!.usedPercent) }}
                                >
                                    {u().monthly!.used}
                                </span>
                            </div>
                            <ProgressBar percent={u().monthly!.usedPercent} />
                            <div class="flex justify-between mt-2">
                                <span class="text-xs text-zinc-500 font-mono">
                                    reset {resetLabel(u().monthly!)}
                                </span>
                                <span class="text-xs text-zinc-500 font-mono">
                                    {formatDateTime(u().monthly!.resetsAtMs)}
                                </span>
                            </div>
                        </div>
                    </Show>

                    <Show when={u().hint}>
                        <p class="text-[10px] text-zinc-600 italic pt-1 border-t border-zinc-800">
                            {u().hint}
                        </p>
                    </Show>
                </div>
            </div>
        </Show>
    );
}

function CreditCard(props: { usage: ServiceUsage }) {
    const u = props.usage;
    const title = () => cardTitle(u);

    return (
        <Show
            when={u.status === "ok"}
            fallback={
                <div class="card-credits rounded-xl p-3 opacity-40">
                    <div class="flex items-center gap-1.5">
                        <StatusDot status={u.status} />
                        <span class="text-xs font-medium text-zinc-500">{title()}</span>
                        <span class="text-[10px] text-zinc-600 font-mono truncate ml-auto">{u.error}</span>
                    </div>
                </div>
            }
        >
            <div class="card-credits rounded-xl p-6 animate-fade-in">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-2">
                        <StatusDot status={u.status} />
                        <span class="section-label text-cyan-400/80">{title()}</span>
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

function SettingsPanel(props: {
    open: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    type CodexDraft = {
        key: string;
        id: string;
        label: string;
        local: boolean;
        authJson: string;
    };

    type OpencodeDraft = {
        key: string;
        id: string;
        label: string;
        workspaceId: string;
        authCookie: string;
        hasCookie: boolean;
        cookieMasked?: string;
    };

    const [settings, setSettings] = createSignal<SettingsPublic | null>(null);
    const [opencodeDrafts, setOpencodeDrafts] = createSignal<OpencodeDraft[]>([]);
    const [codexDrafts, setCodexDrafts] = createSignal<CodexDraft[]>([]);
    const [loading, setLoading] = createSignal(false);
    const [savingOc, setSavingOc] = createSignal(false);
    const [savingCodex, setSavingCodex] = createSignal(false);
    const [msg, setMsg] = createSignal<string | null>(null);
    const [err, setErr] = createSignal<string | null>(null);

    function codexDraftsFromSettings(accounts: CodexAccountPublic[]): CodexDraft[] {
        return accounts.map((a, i) => ({
            key: `${a.id}-${i}`,
            id: a.id,
            label: a.label ?? "",
            local: a.local,
            authJson: a.authJson ?? "",
        }));
    }

    function opencodeDraftsFromSettings(accounts: OpencodeGoAccountPublic[]): OpencodeDraft[] {
        return accounts.map((a, i) => ({
            key: `${a.id}-${i}`,
            id: a.id,
            label: a.label ?? "",
            workspaceId: a.workspaceId ?? "",
            authCookie: "",
            hasCookie: a.hasCookie,
            cookieMasked: a.authCookieMasked,
        }));
    }

    async function loadSettings() {
        setLoading(true);
        setErr(null);
        try {
            const res = await fetch("/api/settings");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: SettingsPublic = await res.json();
            setSettings(data);
            setOpencodeDrafts(opencodeDraftsFromSettings(data.opencodeGoAccounts ?? []));
            setCodexDrafts(codexDraftsFromSettings(data.codexAccounts));
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }

    createEffect(() => {
        if (props.open) loadSettings();
    });

    async function saveOpencode() {
        setSavingOc(true);
        setMsg(null);
        setErr(null);
        try {
            const accounts = opencodeDrafts().map((d) => {
                const body: {
                    id: string;
                    label?: string;
                    workspaceId: string;
                    authCookie?: string;
                } = {
                    id: d.id.trim(),
                    workspaceId: d.workspaceId.trim(),
                };
                if (d.label.trim()) body.label = d.label.trim();
                const cookie = d.authCookie.trim();
                if (cookie) body.authCookie = cookie;
                return body;
            });
            const res = await fetch("/api/settings/opencode", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accounts }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setSettings(data.settings);
            setOpencodeDrafts(opencodeDraftsFromSettings(data.settings.opencodeGoAccounts ?? []));
            setMsg("OpenCode Go accounts saved");
            props.onSaved();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setSavingOc(false);
        }
    }

    async function saveCodex() {
        setSavingCodex(true);
        setMsg(null);
        setErr(null);
        try {
            const accounts = codexDrafts().map((d) => ({
                id: d.id.trim(),
                label: d.label.trim() || undefined,
                local: d.local,
                authJson: d.authJson.trim() || undefined,
            }));
            const res = await fetch("/api/settings/codex", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accounts }),
            });
            const data = await res.json();
            if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
            setSettings(data.settings);
            setCodexDrafts(codexDraftsFromSettings(data.settings.codexAccounts));
            setMsg("Codex accounts saved");
            props.onSaved();
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
        } finally {
            setSavingCodex(false);
        }
    }

    function updateCodexDraft(key: string, patch: Partial<CodexDraft>) {
        setCodexDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    }

    function removeCodexDraft(key: string) {
        setCodexDrafts((prev) => prev.filter((d) => d.key !== key || d.local));
    }

    function addCodexExtra() {
        const n = codexDrafts().filter((d) => !d.local).length + 1;
        setCodexDrafts((prev) => [
            ...prev,
            {
                key: `new-${Date.now()}`,
                id: `work${n > 1 ? n : ""}`,
                label: "",
                local: false,
                authJson: "",
            },
        ]);
    }

    function updateOcDraft(key: string, patch: Partial<OpencodeDraft>) {
        setOpencodeDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    }

    function removeOcDraft(key: string) {
        setOpencodeDrafts((prev) => prev.filter((d) => d.key !== key));
    }

    function addOcAccount() {
        const n = opencodeDrafts().length + 1;
        setOpencodeDrafts((prev) => [
            ...prev,
            {
                key: `new-oc-${Date.now()}`,
                id: n === 1 ? "opencode" : `go${n}`,
                label: "",
                workspaceId: "",
                authCookie: "",
                hasCookie: false,
            },
        ]);
    }

    return (
        <Show when={props.open}>
            <section class="mb-10 animate-fade-in border border-zinc-800 rounded-lg p-5 bg-zinc-900/40">
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <h2 class="section-label text-zinc-400">Settings</h2>
                        <p class="text-[11px] text-zinc-600 font-mono mt-1 truncate max-w-md">
                            {settings()?.configPath ?? "~/.config/agent-quota/config.json"}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={props.onClose}
                        class="font-mono text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-1 border border-zinc-800 rounded"
                    >
                        close
                    </button>
                </div>

                <Show when={loading()}>
                    <p class="text-xs text-zinc-600 font-mono">loading settings...</p>
                </Show>

                <Show when={err()}>
                    <p class="text-xs text-red-400/80 font-mono mb-3">{err()}</p>
                </Show>
                <Show when={msg()}>
                    <p class="text-xs text-cyan-400/80 font-mono mb-3">{msg()}</p>
                </Show>

                <Show when={settings() && !loading()}>
                    <div class="space-y-8">
                        <div>
                            <div class="flex items-center justify-between gap-3 mb-1">
                                <h3 class="text-sm font-medium text-zinc-200">OpenCode Go</h3>
                                <button
                                    type="button"
                                    onClick={addOcAccount}
                                    class="font-mono text-[11px] text-zinc-500 hover:text-cyan-400 px-2 py-1 border border-zinc-800 rounded hover:border-cyan-400/30"
                                >
                                    + add account
                                </button>
                            </div>
                            <p class="text-[11px] text-zinc-600 mb-3">
                                Each account needs a workspace id and <span class="font-mono">auth</span>{" "}
                                cookie from the opencode.ai Go page. Leave cookie blank to keep the saved
                                value. Cookies are never returned in full (only last 4 chars).
                            </p>
                            <div class="space-y-3">
                                <Show when={opencodeDrafts().length === 0}>
                                    <p class="text-[11px] text-zinc-600 font-mono">
                                        No accounts yet — click + add account.
                                    </p>
                                </Show>
                                <Index each={opencodeDrafts()}>
                                    {(draft) => (
                                        <div class="border border-zinc-800/80 rounded px-3 py-3 space-y-2">
                                            <div class="flex flex-wrap items-center gap-2">
                                                <input
                                                    class="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200 focus:outline-none focus:border-cyan-400/40"
                                                    value={draft().id}
                                                    onInput={(e) =>
                                                        updateOcDraft(draft().key, {
                                                            id: e.currentTarget.value,
                                                        })
                                                    }
                                                    placeholder="id"
                                                />
                                                <input
                                                    class="flex-1 min-w-[8rem] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-cyan-400/40"
                                                    value={draft().label}
                                                    onInput={(e) =>
                                                        updateOcDraft(draft().key, {
                                                            label: e.currentTarget.value,
                                                        })
                                                    }
                                                    placeholder="label (optional)"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => removeOcDraft(draft().key)}
                                                    class="font-mono text-[11px] text-zinc-600 hover:text-red-400 px-2 py-1"
                                                >
                                                    remove
                                                </button>
                                            </div>
                                            <div class="grid gap-2 md:grid-cols-2">
                                                <input
                                                    class="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200 focus:outline-none focus:border-cyan-400/40"
                                                    value={draft().workspaceId}
                                                    onInput={(e) =>
                                                        updateOcDraft(draft().key, {
                                                            workspaceId: e.currentTarget.value,
                                                        })
                                                    }
                                                    placeholder="workspace id"
                                                    autocomplete="off"
                                                />
                                                <input
                                                    type="password"
                                                    class="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200 focus:outline-none focus:border-cyan-400/40"
                                                    value={draft().authCookie}
                                                    onInput={(e) =>
                                                        updateOcDraft(draft().key, {
                                                            authCookie: e.currentTarget.value,
                                                        })
                                                    }
                                                    placeholder={
                                                        draft().hasCookie
                                                            ? `leave blank to keep (${draft().cookieMasked ?? "****"})`
                                                            : "paste auth cookie"
                                                    }
                                                    autocomplete="off"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </Index>
                            </div>
                            <button
                                type="button"
                                onClick={saveOpencode}
                                disabled={savingOc()}
                                class="mt-3 font-mono text-[11px] text-zinc-300 hover:text-cyan-400 disabled:text-zinc-700 px-3 py-1.5 border border-zinc-700 rounded hover:border-cyan-400/30"
                            >
                                {savingOc() ? "saving..." : "save opencode"}
                            </button>
                        </div>

                        <div>
                            <div class="flex items-center justify-between gap-3 mb-1">
                                <h3 class="text-sm font-medium text-zinc-200">Codex accounts</h3>
                                <button
                                    type="button"
                                    onClick={addCodexExtra}
                                    class="font-mono text-[11px] text-zinc-500 hover:text-cyan-400 px-2 py-1 border border-zinc-800 rounded hover:border-cyan-400/30"
                                >
                                    + add auth.json
                                </button>
                            </div>
                            <p class="text-[11px] text-zinc-600 mb-3">
                                Point each row at a Codex <span class="font-mono">auth.json</span>. Leave
                                the default path blank to use <span class="font-mono">~/.codex/auth.json</span>.
                                T3-style layouts work too (e.g.{" "}
                                <span class="font-mono">~/.codex-t3/peculiar/auth.json</span>).
                            </p>
                            <div class="space-y-3">
                                <Index each={codexDrafts()}>
                                    {(draft) => (
                                        <div class="border border-zinc-800/80 rounded px-3 py-3 space-y-2">
                                            <div class="flex flex-wrap items-center gap-2">
                                                <Show
                                                    when={!draft().local}
                                                    fallback={
                                                        <span class="text-[11px] font-mono text-zinc-500 w-28">
                                                            codex · default
                                                        </span>
                                                    }
                                                >
                                                    <input
                                                        class="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200 focus:outline-none focus:border-cyan-400/40"
                                                        value={draft().id}
                                                        onInput={(e) =>
                                                            updateCodexDraft(draft().key, {
                                                                id: e.currentTarget.value,
                                                            })
                                                        }
                                                        placeholder="id"
                                                    />
                                                </Show>
                                                <input
                                                    class="flex-1 min-w-[8rem] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-cyan-400/40"
                                                    value={draft().label}
                                                    onInput={(e) =>
                                                        updateCodexDraft(draft().key, {
                                                            label: e.currentTarget.value,
                                                        })
                                                    }
                                                    placeholder="label (optional)"
                                                />
                                                <Show when={!draft().local}>
                                                    <button
                                                        type="button"
                                                        onClick={() => removeCodexDraft(draft().key)}
                                                        class="font-mono text-[11px] text-zinc-600 hover:text-red-400 px-2 py-1"
                                                    >
                                                        remove
                                                    </button>
                                                </Show>
                                            </div>
                                            <input
                                                class="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono text-zinc-200 focus:outline-none focus:border-cyan-400/40"
                                                value={draft().authJson}
                                                onInput={(e) =>
                                                    updateCodexDraft(draft().key, {
                                                        authJson: e.currentTarget.value,
                                                    })
                                                }
                                                placeholder={
                                                    draft().local
                                                        ? "~/.codex/auth.json (blank = auto)"
                                                        : "/path/to/.codex-t3/curious/auth.json"
                                                }
                                            />
                                        </div>
                                    )}
                                </Index>
                            </div>
                            <button
                                type="button"
                                onClick={saveCodex}
                                disabled={savingCodex()}
                                class="mt-3 font-mono text-[11px] text-zinc-300 hover:text-cyan-400 disabled:text-zinc-700 px-3 py-1.5 border border-zinc-700 rounded hover:border-cyan-400/30"
                            >
                                {savingCodex() ? "saving..." : "save codex"}
                            </button>
                        </div>
                    </div>
                </Show>
            </section>
        </Show>
    );
}

export default function App() {
    const [usage, setUsage] = createSignal<ServiceUsage[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [error, setError] = createSignal<string | null>(null);
    const [lastUpdated, setLastUpdated] = createSignal<Date | null>(null);
    const [settingsOpen, setSettingsOpen] = createSignal(false);
    const [refreshingService, setRefreshingService] = createSignal<string | null>(null);
    const [nowMs, setNowMs] = createSignal(Date.now());

    function sortByStatus(list: ServiceUsage[]) {
        return [...list].sort((a, b) => (a.status === "ok" ? 0 : 1) - (b.status === "ok" ? 0 : 1));
    }

    const usageServices = () =>
        sortByStatus(usage().filter((u) => isUsageService(u.service)));

    const creditServices = () =>
        sortByStatus(usage().filter((u) => !isUsageService(u.service)));

    function handleUpdate(data: ServiceUsage[]) {
        setUsage((prev) => {
            const prevMap = new Map(prev.map((s) => [s.service, s]));
            const nextIds = new Set(data.map((s) => s.service));
            for (const entry of data) {
                if (entry.status === "throttled" && prevMap.has(entry.service)) continue;
                prevMap.set(entry.service, entry);
            }
            // Drop stale Codex extras removed from config
            for (const id of [...prevMap.keys()]) {
                if (!nextIds.has(id)) prevMap.delete(id);
            }
            return [...prevMap.values()];
        });
        setLastUpdated(new Date());
        setLoading(false);
        setError(null);
    }

    function handleOneUpdate(entry: ServiceUsage) {
        setUsage((prev) => {
            const prevMap = new Map(prev.map((s) => [s.service, s]));
            if (entry.status === "throttled" && prevMap.has(entry.service)) {
                return prev;
            }
            prevMap.set(entry.service, entry);
            return [...prevMap.values()];
        });
        setLastUpdated(new Date());
        setError(null);
    }

    async function fetchFromApi() {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch("/api/usage");
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            handleUpdate(data);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
        }
    }

    async function refreshOne(service: string) {
        if (refreshingService()) return;
        setRefreshingService(service);
        try {
            const response = await fetch(
                `/api/usage/${encodeURIComponent(service)}?refresh=1`,
            );
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const entry = (await response.json()) as ServiceUsage;
            handleOneUpdate(entry);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setRefreshingService(null);
        }
    }

    onMount(() => {
        fetchFromApi();
        const refresh = setInterval(fetchFromApi, BROWSER_REFRESH_INTERVAL);
        const tick = setInterval(() => setNowMs(Date.now()), RESET_TICK_INTERVAL);
        onCleanup(() => {
            clearInterval(refresh);
            clearInterval(tick);
        });
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
                        <div class="flex items-center gap-3">
                            <Show when={lastUpdated()}>
                                <span class="text-xs text-zinc-500 font-mono tabular-nums">
                                    {lastUpdated()!.toLocaleTimeString()}
                                </span>
                            </Show>
                            <button
                                type="button"
                                onClick={() => setSettingsOpen((v) => !v)}
                                class="font-mono text-[11px] text-zinc-500 hover:text-cyan-400 transition-colors px-2 py-1 border border-zinc-800 rounded hover:border-cyan-400/30"
                            >
                                {settingsOpen() ? "settings ▴" : "settings"}
                            </button>
                            <button
                                type="button"
                                onClick={fetchFromApi}
                                disabled={loading()}
                                class="font-mono text-[11px] text-zinc-500 hover:text-cyan-400 disabled:text-zinc-700 transition-colors px-2 py-1 border border-zinc-800 rounded hover:border-cyan-400/30 disabled:cursor-not-allowed"
                            >
                                {loading() ? "syncing..." : "refresh"}
                            </button>
                        </div>
                    </div>
                </header>

                <SettingsPanel
                    open={settingsOpen()}
                    onClose={() => setSettingsOpen(false)}
                    onSaved={fetchFromApi}
                />

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
                                    {(item) => (
                                        <UsageCard
                                            usage={item}
                                            nowMs={nowMs()}
                                            refreshing={refreshingService() === item.service}
                                            onRefresh={() => refreshOne(item.service)}
                                        />
                                    )}
                                </For>
                            </div>
                        </section>

                        <Show when={creditServices().length > 0}>
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
                        </Show>
                    </div>
                </Show>

                <footer class="mt-12 pt-6 border-t border-zinc-800/50 animate-fade-in animate-fade-in-delay-3">
                    <div class="flex items-center justify-between">
                        <div class="flex flex-wrap gap-x-6 gap-y-1">
                            <For each={usage().filter((u) => u.source)}>
                                {(item) => (
                                    <span
                                        class="text-[10px] font-mono text-zinc-700 truncate max-w-xs"
                                        title={item.source}
                                    >
                                        {item.displayName || item.service}: {item.source}
                                    </span>
                                )}
                            </For>
                        </div>
                    </div>
                </footer>
            </div>
        </div>
    );
}
