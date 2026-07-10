#include "pch.h"
#include "Initializer.h"
#include "Il2CppFunctions.h"
#include "PrintHelper.h"
#include <cstdarg>
#include <cstdio>
#include <exception>
#include <stdexcept>
#include <DbgHelp.h>
#include "DumpCs2.h"
#include "StringLiteral.h"

namespace
{
    void WriteFullDump(EXCEPTION_POINTERS* ep)
    {
        SYSTEMTIME st;
        GetLocalTime(&st);

        char path[MAX_PATH];
        sprintf_s(path, "Crash_%04d%02d%02d_%02d%02d%02d.dmp", st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond);

        HANDLE hFile = CreateFileA(path, GENERIC_WRITE, NULL, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
        if (hFile == INVALID_HANDLE_VALUE) {
            return;
        }

        MINIDUMP_EXCEPTION_INFORMATION mei{};
        mei.ThreadId = GetCurrentThreadId();
        mei.ExceptionPointers = ep;
        mei.ClientPointers = FALSE;

        auto dumpType = static_cast<MINIDUMP_TYPE>(
            MiniDumpWithFullMemory | MiniDumpWithHandleData | MiniDumpWithThreadInfo | MiniDumpWithUnloadedModules);
        MiniDumpWriteDump(GetCurrentProcess(), GetCurrentProcessId(), hFile, dumpType, &mei, nullptr, nullptr);

        CloseHandle(hFile);
    }

    LONG WINAPI GlobalExceptionFilter(EXCEPTION_POINTERS* ep)
    {
        WriteFullDump(ep);
        return EXCEPTION_EXECUTE_HANDLER;
    }
}

DWORD WINAPI MainThread(LPVOID parameter)
{
    SetUnhandledExceptionFilter(GlobalExceptionFilter);

    DebugPrintA("[INFO] Waiting for GameAssembly.dll ...\n");

    uintptr_t base = 0;
    while (!(base = GetGameAssemblyModuleBase())) {
        Sleep(200);
    }

    DebugPrintA("[INFO] GameAssembly.dll: 0x%llX\n", base);

    for (int i = 20; i > 0; --i) {
       DebugPrintA("\r[INFO] Wait for %d seconds before starting il2cpp dump ...  ", i);
       Sleep(1000);
    }

    DebugPrintA("\n[INFO] Start il2cpp dump!\n");

    try {
        InitIl2CppFunctions();

        auto* domain = il2cpp_domain_get();
        if (!domain) {
            throw std::runtime_error("il2cpp_domain_get 返回空指针");
        }

        auto* thread = il2cpp_thread_attach(domain);

        DumpCs2(".\\output\\dump.cs");
        DumpStringLiteral(".\\output\\StringLiteral.json");

        DebugPrintA("[INFO] Dump done!\n");
    }
    catch (const std::exception& e) {
        DebugPrintA("[FATAL] 初始化异常: %s\n", e.what());
        MessageBoxA(nullptr, e.what(), "MiniDumper 初始化异常", MB_OK | MB_ICONERROR);
    }

    return 0;
}
