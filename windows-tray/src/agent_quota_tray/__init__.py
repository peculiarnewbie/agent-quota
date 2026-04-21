"""
Agent Quota – Windows System Tray
Shows the highest API usage % as a tray icon number.
Hover for full details across all tracked services.

Install:  uv tool install ./windows-tray
Run:      agent-quota
"""

from __future__ import annotations

import ctypes
import json
import os
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests
from PIL import Image, ImageDraw, ImageFont
from pystray import Icon, Menu, MenuItem


# ─── Configuration ────────────────────────────────────────────────────────────

REFRESH_SECONDS = 300  # 5 minutes
ENV_FILE_NAME = ".env"

# Where the shared cache lives (same schema as the Linux plugin)
def _config_dir() -> Path:
    base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    return base / "agent-quota"

def _env_path() -> Path:
    return _config_dir() / ENV_FILE_NAME

def _cache_path() -> Path:
    return _config_dir() / "usage-cache.json"


# ─── Tiny .env reader ────────────────────────────────────────────────────────

def _parse_dotenv(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        env[key] = value
    return env


# ─── Credential helpers ──────────────────────────────────────────────────────

_plugin_env: dict[str, str] = {}

def _env(name: str) -> str:
    """Resolve from real env → plugin .env → empty."""
    return os.environ.get(name, "") or _plugin_env.get(name, "")


def _read_json(path: Path) -> Any | None:
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return None


def _home() -> Path:
    return Path.home()


def get_claude_credentials() -> dict | None:
    token = _env("CLAUDE_ACCESS_TOKEN")
    if token:
        return {"accessToken": token}
    for rel in [
        ".claude/.credentials.json",
        ".claude/credentials.json",
        ".config/claude/credentials.json",
    ]:
        data = _read_json(_home() / rel)
        if not data:
            continue
        if isinstance(data.get("claudeAiOauth"), dict):
            t = data["claudeAiOauth"].get("accessToken")
            if t:
                return {"accessToken": t}
        if data.get("accessToken"):
            return {"accessToken": data["accessToken"]}
    return None


def get_codex_credentials() -> dict | None:
    result: dict[str, str] = {}
    api_key = _env("OPENAI_API_KEY")
    if api_key:
        result["apiKey"] = api_key
    for rel in [".codex/auth.json", ".config/codex/auth.json"]:
        data = _read_json(_home() / rel)
        if not data:
            continue
        if not result.get("apiKey") and data.get("OPENAI_API_KEY"):
            result["apiKey"] = data["OPENAI_API_KEY"]
        tokens = data.get("tokens") or {}
        if tokens.get("access_token"):
            result["accessToken"] = tokens["access_token"]
        if tokens.get("account_id"):
            result["accountId"] = tokens["account_id"]
        if result.get("accessToken") or result.get("apiKey"):
            return result
    return result if result else None


def get_zai_credentials() -> dict | None:
    for name in ("ZAI_API_KEY", "ZAI_KEY", "ZHIPU_API_KEY", "ZHIPUAI_API_KEY"):
        key = _env(name)
        if key:
            return {"apiKey": key}
    for rel in [".zai/config.json", ".config/zai/config.json"]:
        data = _read_json(_home() / rel)
        if data and (data.get("apiKey") or data.get("api_key")):
            return {"apiKey": data.get("apiKey") or data.get("api_key")}
    return None


def get_openrouter_credentials() -> dict | None:
    key = _env("OPENROUTER_API_KEY")
    if key:
        return {"apiKey": key}
    for rel in [".config/openrouter/config.json", ".openrouter/config.json"]:
        data = _read_json(_home() / rel)
        if data:
            k = data.get("OPENROUTER_API_KEY") or data.get("apiKey") or data.get("api_key")
            if k:
                return {"apiKey": k}
    return None


def get_opencode_zen_credentials() -> dict | None:
    key = _env("OPENCODE_API_KEY")
    if key:
        return {"apiKey": key}
    for rel in [".config/opencode/config.json", ".opencode/config.json"]:
        data = _read_json(_home() / rel)
        if data:
            k = data.get("OPENCODE_API_KEY") or data.get("apiKey") or data.get("api_key")
            if k:
                return {"apiKey": k}
    return None


def get_opencode_go_credentials() -> dict | None:
    workspace_id = _env("OPENCODE_GO_WORKSPACE_ID").strip()
    auth_cookie = _env("OPENCODE_GO_AUTH_COOKIE").strip()
    if workspace_id and auth_cookie:
        return {"workspaceId": workspace_id, "authCookie": auth_cookie}

    for rel in [
        ".config/opencode/opencode-quota/opencode-go.json",
        ".opencode-quota/opencode-go.json",
    ]:
        data = _read_json(_home() / rel)
        if not data:
            continue
        workspace = str(data.get("workspaceId") or "").strip()
        cookie = str(data.get("authCookie") or "").strip()
        if workspace and cookie:
            return {"workspaceId": workspace, "authCookie": cookie}
    return None


# ─── Duration formatting ─────────────────────────────────────────────────────

def _fmt_duration(seconds: int) -> str:
    if seconds <= 0:
        return "Now"
    d, rem = divmod(seconds, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    if d:
        return f"{d}d {h}h {m}m"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


# ─── Service result type ─────────────────────────────────────────────────────

@dataclass
class WindowUsage:
    used_pct: float = 0.0
    resets_in: str = "--"
    label: str = ""

@dataclass
class ServiceResult:
    service: str = ""
    status: str = "error"       # "ok" | "error" | "no_credentials"
    error: str = ""
    hint: str = ""
    plan: str = ""
    windows: list[WindowUsage] = field(default_factory=list)
    credit_used: str = ""
    credit_remaining: str = ""


# ─── Fetchers ────────────────────────────────────────────────────────────────

def _get(url: str, headers: dict, timeout: int = 15) -> tuple[int, Any]:
    try:
        r = requests.get(url, headers=headers, timeout=timeout)
        try:
            body = r.json()
        except Exception:
            body = r.text
        return r.status_code, body
    except Exception as e:
        return 0, str(e)


def _parse_opencode_go_monthly_usage(html: str) -> dict[str, int] | None:
    import re

    pct_first = re.search(
        r"monthlyUsage:\$R\[\d+\]=\{[^}]*usagePercent:(\d+)[^}]*resetInSec:(\d+)[^}]*\}",
        html,
    )
    if pct_first:
        return {
            "usagePercent": int(pct_first.group(1)),
            "resetInSec": int(pct_first.group(2)),
        }

    reset_first = re.search(
        r"monthlyUsage:\$R\[\d+\]=\{[^}]*resetInSec:(\d+)[^}]*usagePercent:(\d+)[^}]*\}",
        html,
    )
    if reset_first:
        return {
            "usagePercent": int(reset_first.group(2)),
            "resetInSec": int(reset_first.group(1)),
        }

    return None


def _sanitize_hint(value: Any) -> str:
    return " ".join(str(value or "").split())[:200]


def fetch_claude() -> ServiceResult:
    creds = get_claude_credentials()
    if not creds:
        return ServiceResult("claude", "no_credentials", "No credentials",
                             "Run 'claude' or set CLAUDE_ACCESS_TOKEN")
    status, data = _get("https://api.anthropic.com/api/oauth/usage", {
        "Authorization": f"Bearer {creds['accessToken']}",
        "anthropic-beta": "oauth-2025-04-20",
        "Content-Type": "application/json",
    })
    if status == 200 and isinstance(data, dict):
        r = ServiceResult("claude", "ok")
        five = data.get("five_hour") or {}
        if five:
            pct = float(five.get("utilization", 0))
            resets = five.get("resets_at", "")
            delta = 0
            if resets:
                from datetime import datetime, timezone
                try:
                    dt = datetime.fromisoformat(resets.replace("Z", "+00:00"))
                    delta = max(0, int((dt - datetime.now(timezone.utc)).total_seconds()))
                except Exception:
                    pass
            r.windows.append(WindowUsage(pct, _fmt_duration(delta), "5h"))
        seven = data.get("seven_day") or {}
        if seven:
            pct = float(seven.get("utilization", 0))
            resets = seven.get("resets_at", "")
            delta = 0
            if resets:
                from datetime import datetime, timezone
                try:
                    dt = datetime.fromisoformat(resets.replace("Z", "+00:00"))
                    delta = max(0, int((dt - datetime.now(timezone.utc)).total_seconds()))
                except Exception:
                    pass
            r.windows.append(WindowUsage(pct, _fmt_duration(delta), "7d"))
        return r
    if status == 401:
        return ServiceResult("claude", "error", "Token expired", "Run 'claude' to re-auth")
    return ServiceResult("claude", "error", f"HTTP {status}")


def fetch_codex() -> ServiceResult:
    creds = get_codex_credentials()
    if not creds:
        return ServiceResult("codex", "no_credentials", "No credentials",
                             "Run 'codex login' or set OPENAI_API_KEY")
    if creds.get("accessToken") and creds.get("accountId"):
        status, data = _get("https://chatgpt.com/backend-api/wham/usage", {
            "Authorization": f"Bearer {creds['accessToken']}",
            "chatgpt-account-id": creds["accountId"],
            "User-Agent": "codex-cli",
            "Content-Type": "application/json",
        })
        if status == 200 and isinstance(data, dict):
            r = ServiceResult("codex", "ok")
            if data.get("plan_type"):
                r.plan = str(data["plan_type"])
            rl = data.get("rate_limit") or {}
            pw = rl.get("primary_window") or {}
            if pw:
                pct = float(pw.get("used_percent", 0))
                secs = int(pw.get("reset_after_seconds", 0))
                r.windows.append(WindowUsage(pct, _fmt_duration(secs), "5h"))
            sw = rl.get("secondary_window") or {}
            if sw:
                pct = float(sw.get("used_percent", 0))
                secs = int(sw.get("reset_after_seconds", 0))
                r.windows.append(WindowUsage(pct, _fmt_duration(secs), "7d"))
            return r
    # API key fallback
    if creds.get("apiKey"):
        status, _ = _get("https://api.openai.com/v1/models", {
            "Authorization": f"Bearer {creds['apiKey']}",
            "Content-Type": "application/json",
        })
        if status == 200:
            return ServiceResult("codex", "ok", hint="API key valid – OAuth needed for quota")
    return ServiceResult("codex", "error", "Auth failed", "Run 'codex login'")


def fetch_zai() -> ServiceResult:
    creds = get_zai_credentials()
    if not creds:
        return ServiceResult("zai", "no_credentials", "No credentials",
                             "Set ZAI_API_KEY")
    status, data = _get("https://api.z.ai/api/monitor/usage/quota/limit", {
        "Authorization": creds["apiKey"],
        "Content-Type": "application/json",
    })
    if status == 200 and isinstance(data, dict) and data.get("success"):
        r = ServiceResult("zai", "ok")
        for lim in (data.get("data") or {}).get("limits") or []:
            if lim.get("type") != "TOKENS_LIMIT":
                continue
            pct = float(lim.get("percentage", 0))
            reset_ts = int(lim.get("nextResetTime", 0))
            delta = max(0, (reset_ts - int(time.time() * 1000)) // 1000)
            r.windows.append(WindowUsage(pct, _fmt_duration(delta), "quota"))
        return r
    return ServiceResult("zai", "error", f"HTTP {status}")


def fetch_openrouter() -> ServiceResult:
    creds = get_openrouter_credentials()
    if not creds:
        return ServiceResult("openrouter", "no_credentials", "No credentials",
                             "Set OPENROUTER_API_KEY")
    status, data = _get("https://openrouter.ai/api/v1/credits", {
        "Authorization": f"Bearer {creds['apiKey']}",
        "Content-Type": "application/json",
    })
    if status == 200 and isinstance(data, dict) and data.get("data"):
        d = data["data"]
        total = float(d.get("total_credits", 0))
        used = float(d.get("total_usage", 0))
        remaining = total - used
        pct = (used / total * 100) if total > 0 else 0
        r = ServiceResult("openrouter", "ok")
        r.windows.append(WindowUsage(pct, "--", "credits"))
        r.credit_used = f"${used:.2f}"
        r.credit_remaining = f"${remaining:.2f}"
        return r
    return ServiceResult("openrouter", "error", f"HTTP {status}")


def fetch_opencode_zen() -> ServiceResult:
    creds = get_opencode_zen_credentials()
    if not creds:
        return ServiceResult("opencode-zen", "no_credentials", "No credentials",
                             "Set OPENCODE_API_KEY")
    status, data = _get("https://opencode.ai/zen/v1/balance", {
        "Authorization": f"Bearer {creds['apiKey']}",
        "Content-Type": "application/json",
    })
    if status == 200 and isinstance(data, dict):
        balance = float(data.get("balance", 0))
        currency = data.get("currency", "USD")
        r = ServiceResult("opencode-zen", "ok")
        r.credit_remaining = f"{currency} {balance:.2f}"
        return r
    return ServiceResult("opencode-zen", "error", f"HTTP {status}")


def fetch_opencode_go() -> ServiceResult:
    creds = get_opencode_go_credentials()
    if not creds:
        return ServiceResult(
            "opencode-go",
            "no_credentials",
            "No credentials",
            "Set OPENCODE_GO_WORKSPACE_ID and OPENCODE_GO_AUTH_COOKIE",
        )

    status, data = _get(
        f"https://opencode.ai/workspace/{creds['workspaceId']}/go",
        {
            "Accept": "text/html",
            "Cookie": f"auth={creds['authCookie']}",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0",
        },
    )

    if status == 200:
        html = data if isinstance(data, str) else json.dumps(data)
        monthly = _parse_opencode_go_monthly_usage(html)
        if monthly:
            used_pct = max(0, min(100, float(monthly["usagePercent"])))
            reset_in_sec = max(0, int(monthly["resetInSec"]))
            r = ServiceResult("opencode-go", "ok")
            r.windows.append(WindowUsage(used_pct, _fmt_duration(reset_in_sec), "monthly"))
            return r
        return ServiceResult(
            "opencode-go",
            "error",
            "Could not parse monthly usage from dashboard",
            "OpenCode may have changed the dashboard markup",
        )

    return ServiceResult(
        "opencode-go",
        "error",
        f"HTTP {status}",
        _sanitize_hint(data) or "Refresh your OpenCode auth cookie",
    )


# ─── Orchestration ────────────────────────────────────────────────────────────

ALL_FETCHERS = [
    ("claude", fetch_claude),
    ("codex", fetch_codex),
    ("zai", fetch_zai),
    ("opencode-go", fetch_opencode_go),
    ("openrouter", fetch_openrouter),
    ("opencode-zen", fetch_opencode_zen),
]


def fetch_all() -> list[ServiceResult]:
    global _plugin_env
    _plugin_env = _parse_dotenv(_env_path())
    results: list[ServiceResult] = []
    for _, fn in ALL_FETCHERS:
        try:
            results.append(fn())
        except Exception as e:
            results.append(ServiceResult(fn.__name__.replace("fetch_", ""), "error", str(e)))
    return results


# ─── Icon rendering ──────────────────────────────────────────────────────────

def _color_for_pct(pct: float) -> str:
    if pct >= 100:
        return "#ef4444"
    if pct >= 90:
        return "#f97316"
    if pct >= 70:
        return "#eab308"
    return "#22c55e"


def _make_icon(text: str, color: str = "#22c55e", bg: str = "#1e1e2e") -> Image.Image:
    """Draw a 64x64 icon with a number in it."""
    size = 64
    img = Image.new("RGBA", (size, size), bg)
    draw = ImageDraw.Draw(img)

    # Try to get a nice font; fall back to default
    font = None
    font_size = 38 if len(text) <= 2 else 28
    for name in [
        "segoeuib.ttf",   # Segoe UI Bold – ships with Windows
        "segoeui.ttf",
        "arialbd.ttf",
        "arial.ttf",
        "calibrib.ttf",
    ]:
        try:
            font = ImageFont.truetype(name, font_size)
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    # Draw a filled rounded-rect background
    pad = 3
    draw.rounded_rectangle([pad, pad, size - pad, size - pad], radius=12, fill=bg, outline=color, width=3)

    # Center the text
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1]
    draw.text((x, y), text, fill=color, font=font)

    return img


def _make_loading_icon() -> Image.Image:
    return _make_icon("...", "#71717a")


# ─── Tooltip builder ─────────────────────────────────────────────────────────

def _build_tooltip(results: list[ServiceResult], max_pct: float) -> str:
    """
    Windows tray tooltips are capped at 127 chars for the legacy API,
    but pystray uses Shell_NotifyIconW which allows 128 chars.
    We'll keep it concise.
    """
    parts: list[str] = []
    for r in results:
        if r.status == "no_credentials":
            continue
        name = r.service.upper()
        if r.status != "ok":
            parts.append(f"{name}: {r.error or '?'}")
            continue
        if r.windows:
            segs = []
            for w in r.windows:
                segs.append(f"{w.label}:{w.used_pct:.0f}%")
            parts.append(f"{name} {' '.join(segs)}")
        elif r.credit_remaining:
            parts.append(f"{name} bal:{r.credit_remaining}")
        else:
            parts.append(f"{name} ok")

    tooltip = " | ".join(parts) if parts else "Agent Quota"

    # Hard truncate at 127 chars (Windows limit)
    if len(tooltip) > 127:
        tooltip = tooltip[:124] + "..."
    return tooltip


# ─── Main app ────────────────────────────────────────────────────────────────

class AgentQuotaTray:
    def __init__(self) -> None:
        self.results: list[ServiceResult] = []
        self.max_pct: float = 0.0
        self.icon: Icon | None = None
        self._stop = threading.Event()

    def _compute_max(self) -> float:
        m = 0.0
        for r in self.results:
            if r.status != "ok":
                continue
            for w in r.windows:
                if w.used_pct > m:
                    m = w.used_pct
        return m

    def _refresh(self) -> None:
        self.results = fetch_all()
        self.max_pct = self._compute_max()
        self._update_icon()

    def _update_icon(self) -> None:
        if not self.icon:
            return
        pct = self.max_pct
        text = str(int(round(pct)))
        color = _color_for_pct(pct)
        self.icon.icon = _make_icon(text, color)
        self.icon.title = _build_tooltip(self.results, pct)

    def _refresh_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._refresh()
            except Exception as e:
                print(f"[agent-quota] refresh error: {e}", file=sys.stderr)
            self._stop.wait(REFRESH_SECONDS)

    def _on_refresh(self, icon: Icon, item: MenuItem) -> None:
        threading.Thread(target=self._refresh, daemon=True).start()

    def _on_quit(self, icon: Icon, item: MenuItem) -> None:
        self._stop.set()
        icon.stop()

    def run(self) -> None:
        _config_dir().mkdir(parents=True, exist_ok=True)

        menu = Menu(
            MenuItem("Refresh now", self._on_refresh),
            Menu.SEPARATOR,
            MenuItem("Quit", self._on_quit),
        )

        self.icon = Icon(
            "agent-quota",
            _make_loading_icon(),
            "Agent Quota – loading...",
            menu,
        )

        # Patch pystray to include NIF_GUID so Windows can track the icon
        # in Settings → Taskbar → Other system tray icons.
        _patch_icon_guid(self.icon)

        worker = threading.Thread(target=self._refresh_loop, daemon=True)
        worker.start()

        self.icon.run()


# ─── Windows integration ─────────────────────────────────────────────────────

# Stable GUID for our tray icon – generated once, never changes.
# Windows uses this to track the icon in Settings → Taskbar → Other system tray icons.
_ICON_GUID = "{7C4B1B2D-6E3A-4F8D-9A1C-5D2E8F0B3A6C}"


def _patch_icon_guid(icon: Icon) -> None:
    """
    Monkey-patch pystray's _message() to include NIF_GUID and our stable GUID
    on every Shell_NotifyIcon call.  Without this, Windows 11 won't list the
    icon in Settings → Taskbar → Other system tray icons.
    """
    try:
        from pystray._util import win32
        import uuid

        guid_bytes = uuid.UUID(_ICON_GUID)

        # GUID is a nested class inside NOTIFYICONDATAW
        GUID = win32.NOTIFYICONDATAW.GUID
        guid_struct = GUID()
        guid_struct.Data1 = guid_bytes.fields[0]
        guid_struct.Data2 = guid_bytes.fields[1]
        guid_struct.Data3 = guid_bytes.fields[2]
        guid_struct.Data4 = (ctypes.c_ubyte * 8)(*guid_bytes.bytes[8:])

        original_message = icon._message.__func__

        def _patched_message(self, code, flags, **kwargs):
            flags |= win32.NIF_GUID
            kwargs["guidItem"] = guid_struct
            original_message(self, code, flags, **kwargs)

        import types
        icon._message = types.MethodType(_patched_message, icon)
    except Exception as exc:
        print(f"[agent-quota] GUID patch failed: {exc}", file=sys.stderr)


def main() -> None:
    AgentQuotaTray().run()
