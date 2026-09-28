@echo off
chcp 65001 >nul
title Qwen-Image-2.1 应用
cd /d "%~dp0"
set "PY=C:\Users\Administrator\AppData\Local\Programs\Python\Python311\python.exe"
if not exist "%PY%" set "PY=python"
echo ============================================
echo   Qwen-Image-2.1 本地应用（无限制版）
echo   后端启动后会自动打开浏览器
echo   关闭本窗口即停止应用
echo ============================================
start "" cmd /c "timeout /t 3 >nul && start http://127.0.0.1:8777"
"%PY%" "src\backend\server.py"
pause
