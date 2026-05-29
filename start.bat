@echo off
chcp 65001 >nul
title 麻精药品智能柜售后运维工具 v2.0

echo.
echo ==========================================
echo   麻精药品智能柜售后运维工具 v2.0
echo   正在启动服务...
echo ==========================================
echo.

cd /d "%~dp0server"

REM 检查 Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js (v16+)
    echo   下载地址: https://nodejs.org/
    pause
    exit /b 1
)

REM 检查依赖
if not exist "node_modules" (
    echo [安装] 首次运行，正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请检查网络连接
        pause
        exit /b 1
    )
)

echo [启动] 正在启动服务器...
echo.
echo 访问地址: http://localhost:3000
echo 局域网:   http://192.168.110.4:3000
echo.
echo 默认账号: engineer01 / 123456 (工程师)
echo           dealer01  / 123456 (经销商)
echo           admin01   / 123456 (总部)
echo.
echo 按 Ctrl+C 可停止服务
echo.

node server.js

pause