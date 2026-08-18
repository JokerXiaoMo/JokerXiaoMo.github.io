#define WINVER 0x0601
#define _WIN32_WINNT 0x0601
#define NTDDI_VERSION 0x06010000

#include <winsock2.h>
#include <windows.h>
#include <commctrl.h>
#include <iphlpapi.h>
#include <wlanapi.h>
#include <objbase.h>
#include <shellapi.h>

#include <algorithm>
#include <cstdlib>
#include <cwctype>
#include <string>
#include <vector>

namespace {

constexpr wchar_t kAppTitle[] = L"系统维护工具箱 mini";
constexpr int kWindowWidth = 720;
constexpr int kWindowHeight = 480;

constexpr int IDC_WIFI_COMBO = 1001;
constexpr int IDC_WIFI_REFRESH = 1002;
constexpr int IDC_WIFI_ENABLE = 1003;
constexpr int IDC_WIFI_DISABLE = 1004;
constexpr int IDC_SPOOLER_RESTART = 1005;
constexpr int IDC_QUEUE_CLEAR = 1006;
constexpr int IDC_STATUS = 1007;
constexpr int IDC_PROGRESS = 1008;
constexpr int IDC_ABOUT = 1009;
constexpr int IDI_APP = 101;
constexpr int IDB_LOGO = 102;
constexpr UINT_PTR kProgressHideTimer = 1;
constexpr UINT_PTR kProgressAnimationTimer = 2;

struct WifiAdapter {
    std::wstring interfaceName;
    std::wstring deviceName;
    std::wstring displayName;
};

HWND g_mainWindow = nullptr;
HWND g_appIcon = nullptr;
HWND g_title = nullptr;
HWND g_subtitle = nullptr;
HWND g_aboutButton = nullptr;
HWND g_wifiFrame = nullptr;
HWND g_wifiTitle = nullptr;
HWND g_wifiLabel = nullptr;
HWND g_wifiFormat = nullptr;
HWND g_wifiCombo = nullptr;
HWND g_wifiRefresh = nullptr;
HWND g_wifiEnable = nullptr;
HWND g_wifiDisable = nullptr;
HWND g_printerFrame = nullptr;
HWND g_printerTitle = nullptr;
HWND g_printerHint = nullptr;
HWND g_spoolerRestart = nullptr;
HWND g_queueClear = nullptr;
HWND g_statusFrame = nullptr;
HWND g_statusCaption = nullptr;
HWND g_status = nullptr;
HWND g_progress = nullptr;
HWND g_progressPercent = nullptr;
HFONT g_titleFont = nullptr;
HFONT g_regularFont = nullptr;
RECT g_wifiPanelRect{};
RECT g_printerPanelRect{};
RECT g_statusPanelRect{};
std::vector<HWND> g_actionControls;
std::vector<WifiAdapter> g_wifiAdapters;
int g_progressValue = 0;
int g_progressTarget = 0;
bool g_wifiPickerVisible = false;
bool g_wifiAdapterSelected = false;

std::wstring Trim(const std::wstring& value) {
    const auto begin = value.find_first_not_of(L" \t\r\n");
    if (begin == std::wstring::npos) {
        return L"";
    }
    const auto end = value.find_last_not_of(L" \t\r\n");
    return value.substr(begin, end - begin + 1);
}

std::wstring ToLower(std::wstring value) {
    std::transform(value.begin(), value.end(), value.begin(), [](wchar_t character) {
        return static_cast<wchar_t>(std::towlower(character));
    });
    return value;
}

std::wstring BytesToWide(const std::string& bytes) {
    if (bytes.empty()) {
        return L"";
    }
    const int size = MultiByteToWideChar(CP_ACP, 0, bytes.data(), static_cast<int>(bytes.size()), nullptr, 0);
    if (size <= 0) {
        return L"";
    }
    std::wstring result(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_ACP, 0, bytes.data(), static_cast<int>(bytes.size()), result.data(), size);
    return result;
}

bool RunHiddenCommand(const std::wstring& command, std::wstring* output, DWORD* exitCode = nullptr) {
    SECURITY_ATTRIBUTES securityAttributes{};
    securityAttributes.nLength = sizeof(securityAttributes);
    securityAttributes.bInheritHandle = TRUE;

    HANDLE readPipe = nullptr;
    HANDLE writePipe = nullptr;
    if (!CreatePipe(&readPipe, &writePipe, &securityAttributes, 0)) {
        return false;
    }
    SetHandleInformation(readPipe, HANDLE_FLAG_INHERIT, 0);

    STARTUPINFOW startupInfo{};
    startupInfo.cb = sizeof(startupInfo);
    startupInfo.dwFlags = STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES;
    startupInfo.wShowWindow = SW_HIDE;
    startupInfo.hStdOutput = writePipe;
    startupInfo.hStdError = writePipe;
    startupInfo.hStdInput = GetStdHandle(STD_INPUT_HANDLE);

    PROCESS_INFORMATION processInfo{};
    std::wstring commandLine = L"cmd.exe /d /c " + command;
    const BOOL started = CreateProcessW(
        nullptr,
        commandLine.data(),
        nullptr,
        nullptr,
        TRUE,
        CREATE_NO_WINDOW,
        nullptr,
        nullptr,
        &startupInfo,
        &processInfo
    );
    CloseHandle(writePipe);

    if (!started) {
        CloseHandle(readPipe);
        return false;
    }

    std::string bytes;
    char buffer[512];
    DWORD read = 0;
    while (ReadFile(readPipe, buffer, sizeof(buffer), &read, nullptr) && read > 0) {
        bytes.append(buffer, read);
    }
    CloseHandle(readPipe);
    WaitForSingleObject(processInfo.hProcess, INFINITE);

    DWORD code = 1;
    GetExitCodeProcess(processInfo.hProcess, &code);
    CloseHandle(processInfo.hThread);
    CloseHandle(processInfo.hProcess);

    if (output != nullptr) {
        *output = Trim(BytesToWide(bytes));
    }
    if (exitCode != nullptr) {
        *exitCode = code;
    }
    return true;
}

void SetStatus(const std::wstring& message) {
    if (g_status != nullptr) {
        SetWindowTextW(g_status, message.c_str());
    }
}

void RefreshPaint() {
    if (g_mainWindow != nullptr) {
        RedrawWindow(g_mainWindow, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN);
        UpdateWindow(g_mainWindow);
    }
}

void SetActionsEnabled(bool enabled) {
    for (HWND control : g_actionControls) {
        if (control != g_wifiEnable && control != g_wifiDisable) {
            EnableWindow(control, enabled ? TRUE : FALSE);
        }
    }
    if (g_wifiCombo != nullptr) {
        EnableWindow(g_wifiCombo, enabled && g_wifiPickerVisible ? TRUE : FALSE);
    }
    if (g_wifiEnable != nullptr) {
        EnableWindow(g_wifiEnable, enabled && g_wifiAdapterSelected ? TRUE : FALSE);
    }
    if (g_wifiDisable != nullptr) {
        EnableWindow(g_wifiDisable, enabled && g_wifiAdapterSelected ? TRUE : FALSE);
    }
}

void SetProgressPosition(int value) {
    g_progressValue = std::max(0, std::min(value, 100));
    if (g_progress != nullptr) {
        SendMessageW(g_progress, PBM_SETPOS, static_cast<WPARAM>(g_progressValue), 0);
    }
    if (g_progressPercent != nullptr) {
        const std::wstring percent = std::to_wstring(g_progressValue) + L"%";
        SetWindowTextW(g_progressPercent, percent.c_str());
    }
}

void AnimateProgressTo(int target) {
    g_progressTarget = std::max(0, std::min(target, 100));
    while (g_progressValue != g_progressTarget) {
        const int distance = g_progressTarget - g_progressValue;
        const int step = std::max(1, std::abs(distance) / 7);
        SetProgressPosition(g_progressValue + (distance > 0 ? step : -step));
        RefreshPaint();
        Sleep(12);
    }
}

void ClearProgressArea() {
    KillTimer(g_mainWindow, kProgressHideTimer);
    KillTimer(g_mainWindow, kProgressAnimationTimer);
    g_progressTarget = 0;
    SetProgressPosition(0);
    if (g_progress != nullptr) {
        ShowWindow(g_progress, SW_HIDE);
    }
    if (g_progressPercent != nullptr) {
        SetWindowTextW(g_progressPercent, L"");
        ShowWindow(g_progressPercent, SW_HIDE);
    }
    if (g_status != nullptr) {
        SetWindowTextW(g_status, L"");
    }
    if (g_statusCaption != nullptr) {
        SetWindowTextW(g_statusCaption, L"");
    }
    if (g_statusFrame != nullptr) {
        RedrawWindow(g_statusFrame, nullptr, nullptr, RDW_INVALIDATE | RDW_ERASE | RDW_UPDATENOW | RDW_ALLCHILDREN);
    }
    RefreshPaint();
}

void BeginProgress(const std::wstring& message, int progress = 10) {
    KillTimer(g_mainWindow, kProgressHideTimer);
    if (g_statusCaption != nullptr) {
        SetWindowTextW(g_statusCaption, L"执行进度");
    }
    SetActionsEnabled(false);
    SetStatus(L"正在执行：" + message);
    if (g_progress != nullptr) {
        ShowWindow(g_progress, SW_SHOW);
    }
    if (g_progressPercent != nullptr) {
        ShowWindow(g_progressPercent, SW_SHOW);
    }
    SetProgressPosition(0);
    AnimateProgressTo(progress);
    RefreshPaint();
}

void UpdateProgress(const std::wstring& message, int progress) {
    SetStatus(L"正在执行：" + message);
    AnimateProgressTo(progress);
    RefreshPaint();
}

void FinishProgress(bool success, const std::wstring& message) {
    AnimateProgressTo(100);
    SetActionsEnabled(true);
    SetStatus((success ? L"已完成：" : L"执行失败：") + message);
    SetTimer(g_mainWindow, kProgressHideTimer, 1600, nullptr);
    RefreshPaint();
}

void ShowFailure(const std::wstring& heading, const std::wstring& detail) {
    FinishProgress(false, heading);
    const std::wstring message = detail.empty() ? heading : heading + L"\n\n" + detail;
    MessageBoxW(g_mainWindow, message.c_str(), kAppTitle, MB_OK | MB_ICONERROR);
}

std::wstring NormalizeAdapterId(std::wstring value) {
    value = ToLower(Trim(value));
    value.erase(std::remove(value.begin(), value.end(), L'{'), value.end());
    value.erase(std::remove(value.begin(), value.end(), L'}'), value.end());
    return value;
}

std::vector<std::wstring> GetPhysicalWlanAdapterIds() {
    std::vector<std::wstring> identifiers;
    DWORD negotiatedVersion = 0;
    HANDLE clientHandle = nullptr;
    if (WlanOpenHandle(2, nullptr, &negotiatedVersion, &clientHandle) != ERROR_SUCCESS) {
        return identifiers;
    }

    PWLAN_INTERFACE_INFO_LIST interfaceList = nullptr;
    const DWORD result = WlanEnumInterfaces(clientHandle, nullptr, &interfaceList);
    if (result == ERROR_SUCCESS && interfaceList != nullptr) {
        for (DWORD index = 0; index < interfaceList->dwNumberOfItems; ++index) {
            wchar_t guidText[64]{};
            if (StringFromGUID2(interfaceList->InterfaceInfo[index].InterfaceGuid, guidText, 64) > 0) {
                identifiers.push_back(NormalizeAdapterId(guidText));
            }
        }
        WlanFreeMemory(interfaceList);
    }
    WlanCloseHandle(clientHandle, nullptr);
    return identifiers;
}

bool IsVirtualWirelessDevice(const std::wstring& deviceName) {
    const std::wstring name = ToLower(deviceName);
    static const wchar_t* blockedKeywords[] = {
        L"wi-fi direct", L"wifi direct", L"hosted network", L"virtual", L"miniport",
        L"hyper-v", L"vmware", L"virtualbox", L"tap-windows", L"loopback"
    };
    for (const wchar_t* keyword : blockedKeywords) {
        if (name.find(keyword) != std::wstring::npos) {
            return true;
        }
    }
    return false;
}

std::vector<WifiAdapter> FindWifiAdapters() {
    const std::vector<std::wstring> physicalIds = GetPhysicalWlanAdapterIds();
    ULONG bufferSize = 15 * 1024;
    std::vector<unsigned char> buffer(bufferSize);
    auto* addresses = reinterpret_cast<PIP_ADAPTER_ADDRESSES>(buffer.data());

    DWORD result = GetAdaptersAddresses(AF_UNSPEC, GAA_FLAG_INCLUDE_ALL_INTERFACES, nullptr, addresses, &bufferSize);
    if (result == ERROR_BUFFER_OVERFLOW) {
        buffer.resize(bufferSize);
        addresses = reinterpret_cast<PIP_ADAPTER_ADDRESSES>(buffer.data());
        result = GetAdaptersAddresses(AF_UNSPEC, GAA_FLAG_INCLUDE_ALL_INTERFACES, nullptr, addresses, &bufferSize);
    }
    if (result != NO_ERROR) {
        return {};
    }

    std::vector<WifiAdapter> physicalAdapters;
    std::vector<WifiAdapter> fallbackAdapters;
    for (PIP_ADAPTER_ADDRESSES adapter = addresses; adapter != nullptr; adapter = adapter->Next) {
        if (adapter->IfType != IF_TYPE_IEEE80211) {
            continue;
        }

        const std::wstring interfaceName = adapter->FriendlyName == nullptr ? L"" : Trim(adapter->FriendlyName);
        const std::wstring deviceName = adapter->Description == nullptr ? L"" : Trim(adapter->Description);
        if (interfaceName.empty() || IsVirtualWirelessDevice(deviceName)) {
            continue;
        }

        WifiAdapter item;
        item.interfaceName = interfaceName;
        item.deviceName = deviceName.empty() ? L"无线网卡" : deviceName;
        item.displayName = item.deviceName + L"  [" + item.interfaceName + L"]";
        fallbackAdapters.push_back(item);

        const std::wstring adapterId = NormalizeAdapterId(BytesToWide(adapter->AdapterName == nullptr ? "" : adapter->AdapterName));
        if (std::find(physicalIds.begin(), physicalIds.end(), adapterId) != physicalIds.end()) {
            physicalAdapters.push_back(item);
        }
    }

    return physicalAdapters.empty() ? fallbackAdapters : physicalAdapters;
}

WifiAdapter SelectedAdapter() {
    const int selectedIndex = static_cast<int>(SendMessageW(g_wifiCombo, CB_GETCURSEL, 0, 0));
    if (selectedIndex >= 0 && static_cast<size_t>(selectedIndex) < g_wifiAdapters.size()) {
        return g_wifiAdapters[static_cast<size_t>(selectedIndex)];
    }
    return {};
}

void RefreshWifiInterfaces() {
    BeginProgress(L"正在读取物理无线网卡设备信息…", 15);
    g_wifiAdapters = FindWifiAdapters();
    UpdateProgress(L"正在整理无线网卡设备名称…", 75);
    SendMessageW(g_wifiCombo, CB_RESETCONTENT, 0, 0);

    for (const WifiAdapter& adapter : g_wifiAdapters) {
        SendMessageW(g_wifiCombo, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(adapter.displayName.c_str()));
    }

    g_wifiPickerVisible = true;
    g_wifiAdapterSelected = false;
    SendMessageW(g_wifiCombo, CB_SETCURSEL, static_cast<WPARAM>(-1), 0);
    ShowWindow(g_wifiLabel, SW_SHOW);
    ShowWindow(g_wifiCombo, SW_SHOW);
    ShowWindow(g_wifiFormat, SW_SHOW);
    SetWindowTextW(g_wifiRefresh, L"重新检测");

    if (!g_wifiAdapters.empty()) {
        FinishProgress(true, L"已识别 " + std::to_wstring(g_wifiAdapters.size()) + L" 个物理无线网卡，请从列表选择。" );
    } else {
        FinishProgress(false, L"未识别到物理无线网卡。请检查无线网卡驱动或设备状态。" );
    }
}

void SetWifiEnabled(bool enabled) {
    const WifiAdapter adapter = SelectedAdapter();
    if (adapter.interfaceName.empty()) {
        MessageBoxW(g_mainWindow, L"请先点击“选择无线网卡”，再从列表中选择要操作的设备。", kAppTitle, MB_OK | MB_ICONWARNING);
        return;
    }

    const std::wstring action = enabled ? L"启用 Wi-Fi" : L"禁用 Wi-Fi";
    BeginProgress(action + L"：" + adapter.displayName, 20);
    std::wstring output;
    DWORD exitCode = 1;
    const std::wstring command = L"netsh interface set interface name=\"" + adapter.interfaceName + L"\" admin=" + (enabled ? L"enabled" : L"disabled");
    if (RunHiddenCommand(command, &output, &exitCode) && exitCode == 0) {
        UpdateProgress(L"正在确认 Wi-Fi 接口状态…", 85);
        FinishProgress(true, action + L"成功：" + adapter.displayName);
    } else {
        ShowFailure(action + L"失败。", L"系统未能执行该操作。请确认所选设备可用，并以管理员身份运行本程序。错误代码：" + std::to_wstring(exitCode));
    }
}

void RestartPrintSpooler() {
    BeginProgress(L"正在停止打印后台服务…", 15);
    std::wstring stopOutput;
    std::wstring startOutput;
    DWORD stopCode = 1;
    DWORD startCode = 1;
    RunHiddenCommand(L"net stop spooler /y", &stopOutput, &stopCode);
    UpdateProgress(L"正在启动打印后台服务…", 65);
    RunHiddenCommand(L"net start spooler", &startOutput, &startCode);

    if (startCode == 0) {
        FinishProgress(true, stopCode == 0 ? L"打印后台服务已重启。" : L"打印后台服务已启动。" );
    } else {
        ShowFailure(L"打印后台服务重启失败。", L"系统未能启动打印后台服务。请确认以管理员身份运行本程序，并检查 Print Spooler 服务状态。错误代码：" + std::to_wstring(startCode));
    }
}

bool DeleteQueueFiles(std::wstring* errorText) {
    wchar_t systemDirectory[MAX_PATH]{};
    if (GetSystemDirectoryW(systemDirectory, MAX_PATH) == 0) {
        *errorText = L"无法定位 Windows 系统目录。";
        return false;
    }

    const std::wstring folder = std::wstring(systemDirectory) + L"\\spool\\PRINTERS\\";
    WIN32_FIND_DATAW data{};
    HANDLE search = FindFirstFileW((folder + L"*").c_str(), &data);
    if (search == INVALID_HANDLE_VALUE) {
        const DWORD error = GetLastError();
        if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) {
            return true;
        }
        *errorText = L"无法读取打印队列目录。错误代码：" + std::to_wstring(error);
        return false;
    }

    bool success = true;
    do {
        const std::wstring name = data.cFileName;
        if (name == L"." || name == L"..") {
            continue;
        }
        const std::wstring fullPath = folder + name;
        if (data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            continue;
        }
        if (!DeleteFileW(fullPath.c_str())) {
            success = false;
            *errorText += name + L" 删除失败；";
        }
    } while (FindNextFileW(search, &data));
    FindClose(search);
    return success;
}

void ClearPrintQueue() {
    const int confirmation = MessageBoxW(
        g_mainWindow,
        L"确定要清空所有本地打印任务吗？\n\n此操作会取消尚未完成的打印作业，且无法恢复。",
        kAppTitle,
        MB_YESNOCANCEL | MB_ICONWARNING | MB_DEFBUTTON3
    );
    if (confirmation != IDYES) {
        return;
    }

    BeginProgress(L"正在停止打印后台服务…", 15);
    std::wstring stopOutput;
    DWORD stopCode = 1;
    RunHiddenCommand(L"net stop spooler /y", &stopOutput, &stopCode);
    if (stopCode != 0) {
        ShowFailure(L"无法停止打印后台服务。", L"系统拒绝停止打印后台服务。请以管理员身份运行本程序，并检查 Print Spooler 服务状态。错误代码：" + std::to_wstring(stopCode));
        return;
    }

    UpdateProgress(L"正在清空本地打印列表…", 55);
    std::wstring deleteError;
    const bool deleted = DeleteQueueFiles(&deleteError);
    UpdateProgress(L"正在恢复打印后台服务…", 82);
    std::wstring startOutput;
    DWORD startCode = 1;
    RunHiddenCommand(L"net start spooler", &startOutput, &startCode);

    if (startCode != 0) {
        ShowFailure(L"打印队列已处理，但后台服务未能重新启动。", L"请手动检查 Print Spooler 服务状态。错误代码：" + std::to_wstring(startCode));
    } else if (!deleted) {
        ShowFailure(L"打印队列清理不完整。", deleteError);
    } else {
        FinishProgress(true, L"打印列表已清空，打印后台服务已恢复。" );
    }
}

HWND CreateControl(DWORD style, int id, const wchar_t* text, int x, int y, int width, int height, HWND parent) {
    HWND control = CreateWindowExW(
        0, L"STATIC", text, WS_CHILD | WS_VISIBLE | style,
        x, y, width, height, parent, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), GetModuleHandleW(nullptr), nullptr
    );
    if (g_regularFont != nullptr) {
        SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(g_regularFont), TRUE);
    }
    return control;
}

HWND CreateButton(const wchar_t* text, int id, int x, int y, int width, int height, HWND parent) {
    HWND button = CreateWindowExW(
        0, L"BUTTON", text, WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
        x, y, width, height, parent, reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), GetModuleHandleW(nullptr), nullptr
    );
    if (g_regularFont != nullptr) {
        SendMessageW(button, WM_SETFONT, reinterpret_cast<WPARAM>(g_regularFont), TRUE);
    }
    g_actionControls.push_back(button);
    return button;
}

void PlaceControl(HWND control, int x, int y, int width, int height) {
    if (control != nullptr) {
        SetWindowPos(control, nullptr, x, y, std::max(1, width), std::max(1, height),
                     SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOREDRAW);
    }
}

void DrawPanel(HDC hdc, const RECT& rect) {
    HBRUSH fill = CreateSolidBrush(RGB(255, 255, 255));
    HPEN border = CreatePen(PS_SOLID, 1, RGB(207, 215, 224));
    HGDIOBJ previousBrush = SelectObject(hdc, fill);
    HGDIOBJ previousPen = SelectObject(hdc, border);
    RoundRect(hdc, rect.left, rect.top, rect.right, rect.bottom, 10, 10);
    SelectObject(hdc, previousPen);
    SelectObject(hdc, previousBrush);
    DeleteObject(border);
    DeleteObject(fill);
}

void PaintMainWindow(HWND window) {
    PAINTSTRUCT paint{};
    HDC hdc = BeginPaint(window, &paint);
    RECT client{};
    GetClientRect(window, &client);
    HBRUSH background = CreateSolidBrush(RGB(248, 250, 252));
    FillRect(hdc, &client, background);
    DeleteObject(background);
    DrawPanel(hdc, g_wifiPanelRect);
    DrawPanel(hdc, g_printerPanelRect);
    DrawPanel(hdc, g_statusPanelRect);
    EndPaint(window, &paint);
}

LRESULT CALLBACK AboutWindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE: {
            const HINSTANCE instance = GetModuleHandleW(nullptr);
            HWND icon = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_BITMAP,
                                        22, 18, 70, 70, window, nullptr, instance, nullptr);
            SendMessageW(icon, STM_SETIMAGE, IMAGE_BITMAP, reinterpret_cast<LPARAM>(
                LoadImageW(instance, MAKEINTRESOURCEW(IDB_LOGO), IMAGE_BITMAP, 70, 70, LR_CREATEDIBSECTION)
            ));

            HWND title = CreateWindowExW(0, L"STATIC", L"系统维护工具箱 mini", WS_CHILD | WS_VISIBLE,
                                         108, 24, 360, 34, window, nullptr, instance, nullptr);
            SendMessageW(title, WM_SETFONT, reinterpret_cast<WPARAM>(g_titleFont), TRUE);

            const wchar_t details[] =
                L"By 小潘·樱花树下科技工作室·AI创作\n"
                L"别的项目地址：http://fanxiaofei.ccwu.cc/\n\n"
                L"文件说明：系统维护工具箱mini\n"
                L"文件版本：0.05    类型：应用程序\n"
                L"产品名：系统维护工具箱mini\n"
                L"产品版本：0.1.0\n"
                L"版权：© 樱花科技工作室";
            HWND text = CreateWindowExW(0, L"STATIC", details, WS_CHILD | WS_VISIBLE | SS_LEFT,
                                        24, 92, 450, 226, window, nullptr, instance, nullptr);
            SendMessageW(text, WM_SETFONT, reinterpret_cast<WPARAM>(g_regularFont), TRUE);

            HWND close = CreateWindowExW(0, L"BUTTON", L"关闭", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
                                         378, 328, 92, 32, window, reinterpret_cast<HMENU>(IDOK), instance, nullptr);
            SendMessageW(close, WM_SETFONT, reinterpret_cast<WPARAM>(g_regularFont), TRUE);
            return 0;
        }
        case WM_COMMAND:
            if (LOWORD(wParam) == IDOK || LOWORD(wParam) == IDCANCEL) {
                DestroyWindow(window);
                return 0;
            }
            break;
        case WM_CLOSE:
            DestroyWindow(window);
            return 0;
        default:
            break;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

void ShowAboutWindow() {
    static const wchar_t aboutClass[] = L"SystemMaintenanceToolboxMiniAboutWindow";
    static bool registered = false;
    const HINSTANCE instance = GetModuleHandleW(nullptr);
    if (!registered) {
        WNDCLASSEXW aboutClassInfo{};
        aboutClassInfo.cbSize = sizeof(aboutClassInfo);
        aboutClassInfo.hInstance = instance;
        aboutClassInfo.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        aboutClassInfo.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(IDI_APP));
        aboutClassInfo.hbrBackground = GetSysColorBrush(COLOR_WINDOW);
        aboutClassInfo.lpszClassName = aboutClass;
        aboutClassInfo.lpfnWndProc = AboutWindowProc;
        registered = RegisterClassExW(&aboutClassInfo) != 0;
    }
    if (!registered) {
        return;
    }

    const DWORD style = WS_CAPTION | WS_SYSMENU;
    RECT rect{0, 0, 510, 390};
    AdjustWindowRectEx(&rect, style, FALSE, WS_EX_DLGMODALFRAME);
    HWND about = CreateWindowExW(
        WS_EX_DLGMODALFRAME,
        aboutClass,
        L"关于系统维护工具箱 mini",
        style,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        rect.right - rect.left,
        rect.bottom - rect.top,
        g_mainWindow,
        nullptr,
        instance,
        nullptr
    );
    if (about != nullptr) {
        ShowWindow(about, SW_SHOW);
        UpdateWindow(about);
    }
}

void LayoutInterface(int clientWidth, int clientHeight) {
    const int margin = 24;
    const int inner = 18;
    const int right = std::max(margin + 650, clientWidth - margin);
    const int contentWidth = right - margin;
    const int wifiTop = 108;
    const int wifiHeight = 158;
    const int printerTop = wifiTop + wifiHeight + 18;
    const int statusHeight = 58;
    const int statusTop = std::max(printerTop + 136, clientHeight - margin - statusHeight);
    const int printerHeight = std::max(118, statusTop - printerTop - 18);
    const int controlLeft = margin + 128;
    const int refreshWidth = 128;
    const int refreshLeft = right - inner - refreshWidth;
    const int comboWidth = std::max(220, refreshLeft - 14 - controlLeft);

    g_wifiPanelRect = {margin, wifiTop, right, wifiTop + wifiHeight};
    g_printerPanelRect = {margin, printerTop, right, printerTop + printerHeight};
    g_statusPanelRect = {margin, statusTop, right, statusTop + statusHeight};

    PlaceControl(g_appIcon, margin + 6, 18, 68, 68);
    PlaceControl(g_title, margin + 88, 20, std::max(250, right - margin - 205), 36);
    PlaceControl(g_subtitle, margin + 90, 58, std::max(250, right - margin - 205), 24);
    PlaceControl(g_aboutButton, right - 102, 32, 84, 32);

    PlaceControl(g_wifiTitle, margin + inner, wifiTop + 14, 180, 24);
    PlaceControl(g_wifiLabel, margin + inner, wifiTop + 52, 110, 26);
    PlaceControl(g_wifiCombo, controlLeft, wifiTop + 48, comboWidth, 250);
    PlaceControl(g_wifiRefresh, refreshLeft, wifiTop + 48, refreshWidth, 32);
    PlaceControl(g_wifiFormat, controlLeft, wifiTop + 84, std::max(200, right - inner - controlLeft), 22);
    PlaceControl(g_wifiEnable, controlLeft, wifiTop + 114, 160, 34);
    PlaceControl(g_wifiDisable, controlLeft + 176, wifiTop + 114, 160, 34);

    PlaceControl(g_printerTitle, margin + inner, printerTop + 14, 180, 24);
    PlaceControl(g_printerHint, margin + inner, printerTop + 46, std::max(280, contentWidth - inner * 2), 25);
    PlaceControl(g_spoolerRestart, margin + inner, printerTop + 76, 190, 32);
    PlaceControl(g_queueClear, margin + inner + 206, printerTop + 76, 170, 32);

    PlaceControl(g_statusCaption, margin + inner, statusTop + 18, 72, 22);
    const int progressWidth = 164;
    const int percentWidth = 48;
    const int progressLeft = right - inner - progressWidth;
    const int percentLeft = progressLeft - percentWidth - 8;
    PlaceControl(g_progressPercent, percentLeft, statusTop + 18, percentWidth, 22);
    PlaceControl(g_progress, progressLeft, statusTop + 16, progressWidth, 22);
    PlaceControl(g_status, margin + 92, statusTop + 18, std::max(120, percentLeft - 18 - (margin + 92)), 22);

    if (g_mainWindow != nullptr) {
        RedrawWindow(g_mainWindow, nullptr, nullptr, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
    }
}

void BuildInterface(HWND window) {
    g_regularFont = CreateFontW(-18, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
    g_titleFont = CreateFontW(-29, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                              OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                              DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");

    const HINSTANCE instance = GetModuleHandleW(nullptr);
    g_appIcon = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_BITMAP,
                                0, 0, 1, 1, window, nullptr, instance, nullptr);
    SendMessageW(g_appIcon, STM_SETIMAGE, IMAGE_BITMAP, reinterpret_cast<LPARAM>(
        LoadImageW(instance, MAKEINTRESOURCEW(IDB_LOGO), IMAGE_BITMAP, 68, 68, LR_CREATEDIBSECTION)
    ));

    g_title = CreateControl(0, 0, kAppTitle, 0, 0, 1, 1, window);
    SendMessageW(g_title, WM_SETFONT, reinterpret_cast<WPARAM>(g_titleFont), TRUE);
    g_subtitle = CreateControl(0, 0, L"Wi-Fi 与打印维护 · 支持 Windows 7 / 10 / 11", 0, 0, 1, 1, window);
    g_aboutButton = CreateWindowExW(0, L"BUTTON", L"💡 信息", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
                                    0, 0, 1, 1, window, reinterpret_cast<HMENU>(IDC_ABOUT), instance, nullptr);
    SendMessageW(g_aboutButton, WM_SETFONT, reinterpret_cast<WPARAM>(g_regularFont), TRUE);

    g_wifiTitle = CreateControl(0, 0, L"Wi-Fi 控制", 0, 0, 1, 1, window);
    g_wifiLabel = CreateControl(0, 0, L"无线网卡设备", 0, 0, 1, 1, window);
    g_wifiCombo = CreateWindowExW(0, L"COMBOBOX", L"", WS_CHILD | WS_VISIBLE | WS_TABSTOP | CBS_DROPDOWNLIST | WS_VSCROLL,
                                   0, 0, 1, 1, window, reinterpret_cast<HMENU>(IDC_WIFI_COMBO), instance, nullptr);
    SendMessageW(g_wifiCombo, WM_SETFONT, reinterpret_cast<WPARAM>(g_regularFont), TRUE);
    g_wifiRefresh = CreateButton(L"选择无线网卡", IDC_WIFI_REFRESH, 0, 0, 1, 1, window);
    g_wifiFormat = CreateControl(0, 0, L"显示格式：网卡设备名称 [Windows 接口名称]", 0, 0, 1, 1, window);
    g_wifiEnable = CreateButton(L"启用 Wi-Fi", IDC_WIFI_ENABLE, 0, 0, 1, 1, window);
    g_wifiDisable = CreateButton(L"禁用 Wi-Fi", IDC_WIFI_DISABLE, 0, 0, 1, 1, window);

    g_printerTitle = CreateControl(0, 0, L"打印维护", 0, 0, 1, 1, window);
    g_printerHint = CreateControl(0, 0, L"用于处理打印任务卡住、打印服务异常等问题。", 0, 0, 1, 1, window);
    g_spoolerRestart = CreateButton(L"重启打印机服务", IDC_SPOOLER_RESTART, 0, 0, 1, 1, window);
    g_queueClear = CreateButton(L"清空打印列表", IDC_QUEUE_CLEAR, 0, 0, 1, 1, window);

    g_statusCaption = CreateControl(0, 0, L"", 0, 0, 1, 1, window);
    g_status = CreateControl(0, IDC_STATUS, L"", 0, 0, 1, 1, window);
    g_progressPercent = CreateControl(SS_CENTER, 0, L"", 0, 0, 1, 1, window);
    g_progress = CreateWindowExW(0, PROGRESS_CLASSW, L"", WS_CHILD | PBS_SMOOTH,
                                  0, 0, 1, 1, window, reinterpret_cast<HMENU>(IDC_PROGRESS), instance, nullptr);
    SendMessageW(g_progress, PBM_SETRANGE32, 0, 100);
    SendMessageW(g_progress, PBM_SETBARCOLOR, 0, RGB(46, 160, 67));
    SendMessageW(g_progress, PBM_SETBKCOLOR, 0, RGB(230, 238, 232));

    RECT client{};
    GetClientRect(window, &client);
    LayoutInterface(client.right - client.left, client.bottom - client.top);
    ShowWindow(g_wifiLabel, SW_HIDE);
    ShowWindow(g_wifiCombo, SW_HIDE);
    ShowWindow(g_wifiFormat, SW_HIDE);
    ClearProgressArea();
    SetActionsEnabled(true);
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE:
            g_mainWindow = window;
            BuildInterface(window);
            return 0;
        case WM_TIMER:
            if (wParam == kProgressHideTimer) {
                ClearProgressArea();
                return 0;
            }
            break;
        case WM_SIZE:
            LayoutInterface(LOWORD(lParam), HIWORD(lParam));
            return 0;
        case WM_GETMINMAXINFO: {
            auto* minMax = reinterpret_cast<MINMAXINFO*>(lParam);
            RECT minimumClient{0, 0, kWindowWidth, kWindowHeight};
            AdjustWindowRect(&minimumClient, WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN, FALSE);
            minMax->ptMinTrackSize.x = minimumClient.right - minimumClient.left;
            minMax->ptMinTrackSize.y = minimumClient.bottom - minimumClient.top;
            return 0;
        }
        case WM_ERASEBKGND:
            return 1;
        case WM_PAINT:
            PaintMainWindow(window);
            return 0;
        case WM_COMMAND:
            switch (LOWORD(wParam)) {
                case IDC_WIFI_COMBO:
                    if (HIWORD(wParam) == CBN_SELCHANGE) {
                        const int index = static_cast<int>(SendMessageW(g_wifiCombo, CB_GETCURSEL, 0, 0));
                        g_wifiAdapterSelected = index >= 0 && static_cast<size_t>(index) < g_wifiAdapters.size();
                        SetActionsEnabled(true);
                    }
                    return 0;
                case IDC_ABOUT:
                    ShowAboutWindow();
                    return 0;
                case IDC_WIFI_REFRESH:
                    RefreshWifiInterfaces();
                    return 0;
                case IDC_WIFI_ENABLE:
                    SetWifiEnabled(true);
                    return 0;
                case IDC_WIFI_DISABLE:
                    SetWifiEnabled(false);
                    return 0;
                case IDC_SPOOLER_RESTART:
                    RestartPrintSpooler();
                    return 0;
                case IDC_QUEUE_CLEAR:
                    ClearPrintQueue();
                    return 0;
                default:
                    break;
            }
            break;
        case WM_CTLCOLORSTATIC: {
            HDC hdc = reinterpret_cast<HDC>(wParam);
            HWND control = reinterpret_cast<HWND>(lParam);
            static HBRUSH headerBrush = CreateSolidBrush(RGB(248, 250, 252));
            static HBRUSH panelBrush = CreateSolidBrush(RGB(255, 255, 255));
            SetTextColor(hdc, RGB(35, 52, 68));
            if (control == g_title || control == g_subtitle || control == g_appIcon) {
                SetBkColor(hdc, RGB(248, 250, 252));
                return reinterpret_cast<LRESULT>(headerBrush);
            }
            SetBkColor(hdc, RGB(255, 255, 255));
            return reinterpret_cast<LRESULT>(panelBrush);
        }
        case WM_DESTROY:
            KillTimer(window, kProgressHideTimer);
            KillTimer(window, kProgressAnimationTimer);
            if (g_titleFont != nullptr) {
                DeleteObject(g_titleFont);
            }
            if (g_regularFont != nullptr) {
                DeleteObject(g_regularFont);
            }
            PostQuitMessage(0);
            return 0;
        default:
            break;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

}  // namespace

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int commandShow) {
    INITCOMMONCONTROLSEX controls{};
    controls.dwSize = sizeof(controls);
    controls.dwICC = ICC_STANDARD_CLASSES | ICC_PROGRESS_CLASS;
    InitCommonControlsEx(&controls);

    const wchar_t className[] = L"SystemMaintenanceToolboxMiniWindow";
    WNDCLASSEXW windowClass{};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(IDI_APP));
    windowClass.hIconSm = LoadIconW(instance, MAKEINTRESOURCEW(IDI_APP));
    windowClass.style = CS_HREDRAW | CS_VREDRAW;
    windowClass.hbrBackground = nullptr;
    windowClass.lpszClassName = className;
    windowClass.lpfnWndProc = WindowProc;
    RegisterClassExW(&windowClass);

    const DWORD style = WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_CLIPCHILDREN;
    RECT windowRect{0, 0, kWindowWidth, kWindowHeight};
    AdjustWindowRect(&windowRect, style, FALSE);
    HWND window = CreateWindowExW(
        0,
        className,
        kAppTitle,
        style,
        CW_USEDEFAULT,
        CW_USEDEFAULT,
        windowRect.right - windowRect.left,
        windowRect.bottom - windowRect.top,
        nullptr,
        nullptr,
        instance,
        nullptr
    );
    if (window == nullptr) {
        return 1;
    }

    ShowWindow(window, commandShow);
    UpdateWindow(window);

    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return static_cast<int>(message.wParam);
}
