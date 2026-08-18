# 系统维护工具箱 mini

**系统维护工具箱 mini** 是一个面向 Windows 7、Windows 10 与 Windows 11 的轻量级桌面维护工具。它使用本仓库 `assets/source-icon.png` 中的用户提供图片作为应用图标，并提供 Wi‑Fi 开关、打印后台服务重启以及本地打印队列清空功能。

> **直接运行：** 请在 `release` 文件夹中选择与你的系统相符的 `.exe`，双击即可运行。无需安装 Python、无需执行 `build_windows.bat`、无需打开命令提示符。Windows 10/11 通常选择 `系统维护工具箱 mini（64位）.exe`。

> 本工具需要以管理员身份运行。它只在本机调用 Windows 的网络接口与打印后台服务，不会收集或上传设备、网络或打印内容。

| 功能 | 实际操作 | 使用提示 |
| --- | --- | --- |
| 启用 Wi‑Fi | 启用所选无线网络接口 | 可先点击“刷新”自动识别接口，也可手动填写接口名称。 |
| 禁用 Wi‑Fi | 禁用所选无线网络接口 | 禁用后网络会断开；再次点击“启用 Wi‑Fi”即可恢复。 |
| 重启打印机服务 | 停止并启动 `Print Spooler` 服务 | 可用于处理打印机服务异常或作业卡住。 |
| 清空打印列表 | 停止打印后台、清理本地队列文件并重新启动服务 | 会取消所有尚未完成的本地打印任务，操作前会二次确认。 |

## 环境与兼容性

| 项目 | 要求 |
| --- | --- |
| 目标系统 | Windows 7、Windows 10、Windows 11 |
| Windows 7 构建 Python | Python 3.8.10（请使用 64 位或 32 位版本，与目标机器一致） |
| Windows 10/11 构建 Python | Python 3.8.x；若仅在较新系统使用，也可以在 `build_windows.bat` 中调整对应版本启动器。 |
| 权限 | 启动后需在 UAC 提示中选择“是”。 |
| 打包工具 | PyInstaller，版本已固定在 `requirements.txt`。 |

## 直接运行的程序

`release` 文件夹已包含可直接运行的原生 Windows 程序。64 位 Windows 7、Windows 10 与 Windows 11 使用 `系统维护工具箱 mini（64位）.exe`；32 位 Windows 7 使用 `系统维护工具箱 mini（32位）.exe`。这两个版本均已嵌入应用图标和管理员权限清单。

## Python 版一键打包（仅供开发）

仓库根目录保留 `build_windows.bat` 与 Python 版源代码，供后续需要自行修改界面的人使用；普通使用者不需要运行它。

## 开发目录

```text
system-maintenance-toolbox-mini/
├── assets/
│   ├── app.ico                 # 由原图生成的多尺寸 Windows 图标
│   └── source-icon.png         # 用户提供的原始图标图片
├── native/
│   ├── main.cpp                # 无依赖原生 Windows 界面主体
│   ├── app.rc                  # 图标与清单资源定义
│   └── app.manifest            # 管理员权限清单
├── release/
│   ├── 系统维护工具箱 mini（64位）.exe
│   └── 系统维护工具箱 mini（32位）.exe
├── src/
│   └── main.py                 # 保留的 Python 开发版
├── tests/
│   └── test_core.py            # Python 版关键命令与状态识别测试
├── build_windows.bat           # Python 开发版的一键打包脚本
├── requirements.txt            # Python 开发版依赖
└── tools_make_icon.py          # 图标转换脚本
```

## 使用说明

启动程序后，先确认窗口上方状态栏显示已取得管理员权限。对于 Wi‑Fi，请在“无线接口”选择框中选择自动识别的接口；若未识别，可输入系统中显示的无线接口名称，例如 `Wi-Fi`。再按需要点击启用、禁用或检查状态。

“重启打印机服务”不会主动删除打印任务；“清空打印列表”才会取消本地尚未完成的打印作业。后者设有二次确认，避免误操作。

## 验证

开发环境已执行 `python -m unittest discover -s tests -v`。测试覆盖 Wi‑Fi 接口识别、Wi‑Fi 禁用命令、Wi‑Fi 状态识别和打印后台服务重启命令构造。由于本项目目标为 Windows 系统，最终 `.exe` 应在相应的 Windows 版本上按实际网卡与打印机环境进行验证。

## 图标来源

`assets/source-icon.png` 与 `assets/app.ico` 均来自本任务中由用户提供的图片，且只用于本软件的应用图标和窗口标识。
