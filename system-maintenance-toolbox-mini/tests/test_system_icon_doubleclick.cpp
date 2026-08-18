#include <windows.h>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    HWND window = nullptr;
    for (int attempt = 0; attempt < 40 && window == nullptr; ++attempt) {
        window = FindWindowW(L"SystemMaintenanceToolboxMiniWindow", nullptr);
        Sleep(100);
    }
    if (window == nullptr) {
        return 2;
    }

    SendMessageW(window, WM_NCLBUTTONDBLCLK, HTSYSMENU, 0);
    SendMessageW(window, WM_SYSCOMMAND, SC_CLOSE, 0);
    Sleep(300);
    if (!IsWindow(window)) {
        return 3;
    }

    Sleep(1000);
    if (!IsWindow(window)) {
        return 4;
    }

    SendMessageW(window, WM_CLOSE, 0, 0);
    Sleep(100);
    if (IsWindow(window)) {
        return 5;
    }
    return 0;
}
