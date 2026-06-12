@echo off
:: Deploy SharedAccManager to Azure Container Apps.
:: Double-click this file or run from CMD / PowerShell.
:: Prereqs: Azure CLI (az login), Node.js, git

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy.ps1"
if %ERRORLEVEL% neq 0 (
    echo.
    echo Deploy failed.
    pause
    exit /b %ERRORLEVEL%
)
pause
