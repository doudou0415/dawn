@echo off
chcp 65001 >nul
title DawnPanel Backend

set PANEL_DIR=D:\AI\DawnNew\DawnPanel
set BUN_PATH=C:\Users\Administrator\.bun\bin\bun.exe

echo [1/4] 检查 Bun 环境...
if not exist "%BUN_PATH%" (
    echo 错误: 未找到 Bun，请确认 Bun 已正确安装。
    pause
    exit /b 1
)

echo [2/4] 清理旧进程（端口 3457）...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3457') do (
    if not "%%a"=="" (
        taskkill /F /PID %%a >nul 2>&1
    )
)
timeout /t 1 /nobreak >nul

echo [3/4] 构建前端...
cd /d "%PANEL_DIR%"
"%BUN_PATH%" build src/app.ts --outdir ./dist
if %errorlevel% neq 0 (
    echo 错误: 前端构建失败。
    pause
    exit /b 1
)
echo 前端构建成功。

echo [4/4] 启动后端服务（端口 3457）...
echo 面板地址: http://localhost:3457
start "" "%BUN_PATH%" run src/backend.ts

echo 启动完成。
timeout /t 2 /nobreak >nul
exit /b 0
