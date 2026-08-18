@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ==================================================
echo   系统维护工具箱 mini - Windows 打包脚本
echo ==================================================
echo.

where py >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Python 启动器 py。
    echo 请先安装 Python 3.8（Windows 7 请使用 3.8.10），并勾选“Add Python to PATH”。
    pause
    exit /b 1
)

py -3.8 -m pip install --upgrade pip
if errorlevel 1 goto :pip_error

py -3.8 -m pip install -r requirements.txt
if errorlevel 1 goto :pip_error

if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
if exist "系统维护工具箱 mini.spec" del /q "系统维护工具箱 mini.spec"

py -3.8 -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onefile ^
  --windowed ^
  --uac-admin ^
  --name "系统维护工具箱 mini" ^
  --icon "assets\app.ico" ^
  --add-data "assets\app.ico;assets" ^
  --add-data "assets\source-icon.png;assets" ^
  "src\main.py"

if errorlevel 1 goto :build_error

echo.
echo [完成] 已生成：dist\系统维护工具箱 mini.exe
echo 请从 dist 文件夹运行该程序；首次启动时请选择“是”授予管理员权限。
explorer "dist"
pause
exit /b 0

:pip_error
echo.
echo [错误] 依赖安装失败。请检查网络连接和 Python 3.8 安装。
pause
exit /b 1

:build_error
echo.
echo [错误] 打包失败。请保留此窗口中的错误信息以便排查。
pause
exit /b 1
