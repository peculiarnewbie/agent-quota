@echo off
REM Agent Quota – Windows Tray
REM First time:  uv tool install ./windows-tray
REM Then just:   agent-quota
REM
REM This bat is a convenience shortcut that runs it via uvx directly.
cd /d "%~dp0"
start /b uvx --from . agent-quota
