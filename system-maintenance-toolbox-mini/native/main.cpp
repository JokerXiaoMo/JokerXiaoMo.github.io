#define _WIN32_WINNT 0x0601

#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>

#include <algorithm>
#include <cwctype>
#include <string>
#include <vector>

namespace {

constexpr wchar_t kAppTitle[] = L"系统维护工具箱 mini";
constexpr int kWindowWidth = 720;
constexpr int kWindowHeight = 470;

constexpr int IDC_WIFI_COMBO = 1001;
constexpr int IDC_WIFI_REFRESH = 1002;
constexpr int IDC_WIFI_ENABLE = 1003;
constexpr int IDC_WIFI_DISABLE = 1004;
constexpr int IDC_SPOOLER_RESTART = 1005;
constexpr int IDC_QUEUE_CLEAR = 1006;
constexpr int IDC_STATUS = 1007;
constexpr int IDI_APP = 101;

HWND g_mainWindow = nullptr;
HWND g_wifiCombo = nullptr;
HWND g_status = nullptr;
HFONT g_titleFont = nullptr;
HFONT g_regularFont = nullptr;

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

std::vector<std::wstring> SplitColumns(const std::wstring& line) {
    std::vector<std::wstring> result;
    std::wstring current;
    int whitespaceCount = 0;
    for (wchar_t character : line) {
        if (character == L' ' || character == L'\t') {
            ++whitespaceCount;
            if (whitespaceCount >= 2 && !Trim(current).empty()) {
                result.push_back(Trim(current));
                current.clear();
            } else if (whitespaceCount < 2) {
                current += L' ';
            }
        } else {
            whitespaceCount = 0;
            current += character;
        }
    }
    if (!Trim(current).empty()) {
        result.push_back(Trim(current));
    }
    return result;
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

void ShowFailure(const std::wstring& heading, const std::wstring& detail) {
    const std::wstring message = detail.empty() ? heading : heading + L"\n\n" + detail;
    SetStatus(heading);
    MessageBoxW(g_mainWindow, message.c_str(), kAppTitle, MB_OK | MB_ICONERROR);
}

std::vector<std::wstring> FindWifiInterfaces() {
    std::wstring output;
    DWORD exitCode = 1;
    if (!RunHiddenCommand(L"netsh interface show interface", &output, &exitCode) || exitCode != 0) {
        return {};
    }

    std::vector<std::wstring> adapters;
    size_t lineStart = 0;
    while (lineStart < output.size()) {
        const size_t lineEnd = output.find(L'\n', lineStart);
        const std::wstring line = Trim(output.substr(lineStart, lineEnd - lineStart));
        const std::wstring lower = ToLower(line);
        const bool looksWireless =
            lower.find(L"wi-fi") != std::wstring::npos ||
            lower.find(L"wifi") != std::wstring::npos ||
            lower.find(L"wlan") != std::wstring::npos ||
            lower.find(L"\x65e0\x7ebf") != std::wstring::npos;
        if (looksWireless && lower.find(L"interface name") == std::wstring::npos) {
            const std::vector<std::wstring> columns = SplitColumns(line);
            if (!columns.empty()) {
                const std::wstring& adapter = columns.back();
                if (std::find(adapters.begin(), adapters.end(), adapter) == adapters.end()) {
                    adapters.push_back(adapter);
                }
            }
        }
        if (lineEnd == std::wstring::npos) {
            break;
        }
        lineStart = lineEnd + 1;
    }
    return adapters;
}

std::wstring SelectedAdapter() {
    const int length = GetWindowTextLengthW(g_wifiCombo);
    std::wstring adapter(static_cast<size_t>(length + 1), L'\0');
    GetWindowTextW(g_wifiCombo, adapter.data(), length + 1);
    adapter.resize(wcslen(adapter.c_str()));
    return Trim(adapter);
}

void RefreshWifiInterfaces() {
    SendMessageW(g_wifiCombo, CB_RESETCONTENT, 0, 0);
    const std::vector<std::wstring> adapters = FindWifiInterfaces();
    for (const std::wstring& adapter : adapters) {
        SendMessageW(g_wifiCombo, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(adapter.c_str()));
    }

    if (!adapters.empty()) {
        SendMessageW(g_wifiCombo, CB_SETCURSEL, 0, 0);
        SetStatus(L"已识别无线接口：" + adapters.front());
    } else {
        SetWindowTextW(g_wifiCombo, L"Wi-Fi");
        SetStatus(L"未自动识别到无线接口；可手动填写名称，例如 Wi-Fi。");
    }
}

void SetWifiEnabled(bool enabled) {
    const std::wstring adapter = SelectedAdapter();
    if (adapter.empty()) {
        MessageBoxW(g_mainWindow, L"请先选择或填写 Wi-Fi 接口名称。", kAppTitle, MB_OK | MB_ICONWARNING);
        return;
    }

    std::wstring output;
    DWORD exitCode = 1;
    const std::wstring command = L"netsh interface set interface name=\"" + adapter + L"\" admin=" + (enabled ? L"enabled" : L"disabled");
    if (RunHiddenCommand(command, &output, &exitCode) && exitCode == 0) {
        SetStatus(enabled ? L"Wi-Fi 已启用。" : L"Wi-Fi 已禁用。");
    } else {
        ShowFailure(enabled ? L"启用 Wi-Fi 失败。" : L"禁用 Wi-Fi 失败。", output);
    }
}

void RestartPrintSpooler() {
    std::wstring stopOutput;
    std::wstring startOutput;
    DWORD stopCode = 1;
    DWORD startCode = 1;
    RunHiddenCommand(L"net stop spooler /y", &stopOutput, &stopCode);
    RunHiddenCommand(L"net start spooler", &startOutput, &startCode);

    if (startCode == 0) {
        SetStatus(stopCode == 0 ? L"打印后台服务已重启。" : L"打印后台服务已启动。" );
    } else {
        ShowFailure(L"打印后台服务重启失败。", startOutput.empty() ? stopOutput : startOutput);
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
        MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2
    );
    if (confirmation != IDYES) {
        return;
    }

    std::wstring stopOutput;
    DWORD stopCode = 1;
    RunHiddenCommand(L"net stop spooler /y", &stopOutput, &stopCode);
    if (stopCode != 0) {
        ShowFailure(L"无法停止打印后台服务。", stopOutput);
        return;
    }

    std::wstring deleteError;
    const bool deleted = DeleteQueueFiles(&deleteError);
    std::wstring startOutput;
    DWORD startCode = 1;
    RunHiddenCommand(L"net start spooler", &startOutput, &startCode);

    if (startCode != 0) {
        ShowFailure(L"打印队列已处理，但后台服务未能重新启动。", startOutput);
    } else if (!deleted) {
        ShowFailure(L"打印队列清理不完整。", deleteError);
    } else {
        SetStatus(L"打印列表已清空，打印后台服务已恢复。" );
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
    return button;
}

void BuildInterface(HWND window) {
    g_regularFont = CreateFontW(-18, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                                OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                                DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
    g_titleFont = CreateFontW(-29, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                              OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                              DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");

    HWND appIcon = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_ICON,
                                   26, 19, 50, 50, window, nullptr, GetModuleHandleW(nullptr), nullptr);
    SendMessageW(appIcon, STM_SETIMAGE, IMAGE_ICON, reinterpret_cast<LPARAM>(
        LoadImageW(GetModuleHandleW(nullptr), MAKEINTRESOURCEW(IDI_APP), IMAGE_ICON, 48, 48, LR_DEFAULTCOLOR)
    ));

    HWND title = CreateControl(0, 0, kAppTitle, 88, 18, 420, 36, window);
    SendMessageW(title, WM_SETFONT, reinterpret_cast<WPARAM>(g_titleFont), TRUE);
    CreateControl(0, 0, L"Wi-Fi 与打印维护 · 支持 Windows 7 / 10 / 11", 90, 55, 470, 24, window);

    CreateControl(SS_GRAYFRAME, 0, L"", 24, 96, 656, 152, window);
    CreateControl(0, 0, L"Wi-Fi 控制", 42, 108, 180, 24, window);
    CreateControl(0, 0, L"无线接口", 42, 144, 88, 26, window);
    g_wifiCombo = CreateWindowExW(0, L"COMBOBOX", L"", WS_CHILD | WS_VISIBLE | WS_TABSTOP | CBS_DROPDOWN | WS_VSCROLL,
                                   128, 140, 360, 250, window, reinterpret_cast<HMENU>(IDC_WIFI_COMBO), GetModuleHandleW(nullptr), nullptr);
    SendMessageW(g_wifiCombo, WM_SETFONT, reinterpret_cast<WPARAM>(g_regularFont), TRUE);
    CreateButton(L"刷新", IDC_WIFI_REFRESH, 505, 140, 128, 32, window);
    CreateButton(L"启用 Wi-Fi", IDC_WIFI_ENABLE, 128, 192, 160, 34, window);
    CreateButton(L"禁用 Wi-Fi", IDC_WIFI_DISABLE, 304, 192, 160, 34, window);

    CreateControl(SS_GRAYFRAME, 0, L"", 24, 264, 656, 110, window);
    CreateControl(0, 0, L"打印维护", 42, 277, 180, 24, window);
    CreateControl(0, 0, L"用于处理打印任务卡住、打印服务异常等问题。", 42, 308, 440, 25, window);
    CreateButton(L"重启打印机服务", IDC_SPOOLER_RESTART, 42, 336, 190, 32, window);
    CreateButton(L"清空打印列表", IDC_QUEUE_CLEAR, 248, 336, 170, 32, window);

    CreateControl(SS_GRAYFRAME, 0, L"", 24, 394, 656, 48, window);
    CreateControl(0, 0, L"状态：", 42, 408, 58, 22, window);
    g_status = CreateControl(0, IDC_STATUS, L"准备就绪。", 98, 408, 562, 22, window);
}

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE:
            g_mainWindow = window;
            BuildInterface(window);
            RefreshWifiInterfaces();
            return 0;
        case WM_COMMAND:
            switch (LOWORD(wParam)) {
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
            SetTextColor(hdc, RGB(35, 52, 68));
            SetBkColor(hdc, RGB(248, 250, 252));
            static HBRUSH brush = CreateSolidBrush(RGB(248, 250, 252));
            return reinterpret_cast<LRESULT>(brush);
        }
        case WM_DESTROY:
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
    controls.dwICC = ICC_STANDARD_CLASSES;
    InitCommonControlsEx(&controls);

    const wchar_t className[] = L"SystemMaintenanceToolboxMiniWindow";
    WNDCLASSEXW windowClass{};
    windowClass.cbSize = sizeof(windowClass);
    windowClass.hInstance = instance;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(IDI_APP));
    windowClass.hIconSm = LoadIconW(instance, MAKEINTRESOURCEW(IDI_APP));
    windowClass.hbrBackground = CreateSolidBrush(RGB(248, 250, 252));
    windowClass.lpszClassName = className;
    windowClass.lpfnWndProc = WindowProc;
    RegisterClassExW(&windowClass);

    const DWORD style = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX;
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
