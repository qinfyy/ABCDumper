#include "pch.h"
#include "Il2CppFunctions.h"

#include "PrintHelper.h"

#include <array>
#include <sstream>
#include <unordered_map>
#include <vector>
#include "Util.h"

namespace
{
    constexpr size_t kApiTableEntryCount = 235;

    using Il2CppGetApiTable = void(__fastcall*)(uintptr_t* table);

    struct ApiBinding
    {
        const char* name;
        size_t slot;
    };

    constexpr ApiBinding kApiBindings[] = {
        { "il2cpp_assembly_get_image", 24 },
        { "il2cpp_class_get_interfaces", 39 },
        { "il2cpp_class_get_fields", 37 },
        { "il2cpp_class_get_methods", 43 },
        { "il2cpp_class_get_name", 46 },
        { "il2cpp_class_get_namespace", 48 },
        { "il2cpp_class_get_parent", 49 },
        { "il2cpp_class_instance_size", 51 },
        { "il2cpp_class_is_valuetype", 53 },
        { "il2cpp_class_value_size", 54 },
        { "il2cpp_class_get_flags", 56 },
        { "il2cpp_class_from_type", 60 },
        { "il2cpp_class_is_enum", 65 },
        { "il2cpp_domain_get", 71 },
        { "il2cpp_domain_get_assemblies", 73 },
        { "il2cpp_field_get_flags", 81 },
        { "il2cpp_field_get_name", 82 },
        { "il2cpp_field_get_offset", 84 },
        { "il2cpp_field_get_type", 85 },
        { "il2cpp_method_get_return_type", 136 },
        { "il2cpp_method_get_name", 138 },
        { "il2cpp_method_get_param_count", 144 },
        { "il2cpp_method_get_param", 145 },
        { "il2cpp_method_get_flags", 148 },
        { "il2cpp_method_get_param_name", 150 },
        { "il2cpp_method_get_class", 153 },
        { "il2cpp_runtime_invoke", 169 },
        { "il2cpp_thread_attach", 184 },
        { "il2cpp_type_is_byref", 201 },
        { "il2cpp_type_get_attrs", 202 },
        { "il2cpp_type_get_type", 198 },
        { "il2cpp_type_get_name", 205 },
        { "il2cpp_image_get_name", 209 },
        { "il2cpp_image_get_class_count", 212 },
        { "il2cpp_image_get_class", 213 },
    };

    bool IsExecutableAddress(uintptr_t address)
    {
        MEMORY_BASIC_INFORMATION mbi{};
        if (!VirtualQuery(reinterpret_cast<void*>(address), &mbi, sizeof(mbi))) {
            return false;
        }

        if (mbi.State != MEM_COMMIT) {
            return false;
        }

        constexpr DWORD kExecutableFlags = PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
        return (mbi.Protect & kExecutableFlags) != 0;
    }

    std::unordered_map<std::string, void*> DecodeSelectedApiAddresses(HMODULE gameAssembly)
    {
        auto* getApiTable = reinterpret_cast<Il2CppGetApiTable>(GetProcAddress(gameAssembly, "il2cpp_get_api_table"));
        if (!getApiTable) {
            MessageBox(nullptr, L"没有找到 il2cpp_get_api_table，无法读取 IL2CPP API 表。", L"严重错误", MB_OK | MB_ICONERROR);
            ExitProcess(1);
        }

        std::array<uintptr_t, kApiTableEntryCount> apiTable{};
        getApiTable(apiTable.data());

        const auto gameAssemblyBase = GetGameAssemblyModuleBase();
        size_t nonZeroApiTableCount = 0;
        size_t executableApiTableCount = 0;
        size_t gameAssemblyApiTableCount = 0;
        DebugPrintA("[IL2CPP] il2cpp_get_api_table raw output begin: table=%p count=%zu\n", apiTable.data(), apiTable.size());
        for (size_t i = 0; i < apiTable.size(); ++i) {
            const auto value = apiTable[i];
            if (value == 0) {
                DebugPrintA("[IL2CPP-TABLE] index=%04zu -> VA: %p\n", i, reinterpret_cast<void*>(value));
                continue;
            }

            ++nonZeroApiTableCount;
            const auto executable = IsExecutableAddress(value);
            if (executable) {
                ++executableApiTableCount;
            }

            uint64_t rva = 0;
            uint64_t idaVa = 0;
            if (gameAssemblyBase != 0 && value >= gameAssemblyBase) {
                rva = static_cast<uint64_t>(value - gameAssemblyBase);
                idaVa = rva + 0x180000000;
                ++gameAssemblyApiTableCount;
            }

            DebugPrintA("[IL2CPP] index=%04zu -> VA: %p, RVA: 0x%llX, IDA VA: 0x%llX, exec=%s\n", i, reinterpret_cast<void*>(value), rva, idaVa, executable ? "true" : "false");
        }
        DebugPrintA("[IL2CPP] il2cpp_get_api_table raw output end: nonzero=%zu executable=%zu gameAssemblyRange=%zu\n", nonZeroApiTableCount, executableApiTableCount, gameAssemblyApiTableCount);

        std::unordered_map<std::string, void*> decodedApis;
        std::vector<std::string> failedApis;
        for (const auto& binding : kApiBindings) {
            const auto apiAddress = binding.slot < apiTable.size() ? apiTable[binding.slot] : 0;
            if (!apiAddress || !IsExecutableAddress(apiAddress)) {
                failedApis.emplace_back(binding.name);
                continue;
            }

            decodedApis[binding.name] = reinterpret_cast<void*>(apiAddress);
            const auto rva = gameAssemblyBase != 0 && apiAddress >= gameAssemblyBase ? static_cast<uint64_t>(apiAddress - gameAssemblyBase) : 0;
            const auto idaVa = rva != 0 ? rva + 0x180000000 : 0;
            DebugPrintA("[IL2CPP] slot=%04zu %-38s -> VA: %p, RVA: 0x%llX, IDA VA: 0x%llX\n", binding.slot, binding.name, reinterpret_cast<void*>(apiAddress), rva, idaVa);
        }

        for (const auto& api : failedApis) {
            DebugPrintA("[IL2CPP] 可选 API 绑定失败，相关输出会被跳过: %s\n", api.c_str());
        }

        return decodedApis;
    }
}

uintptr_t GetGameAssemblyModuleBase()
{
    return reinterpret_cast<uintptr_t>(GetModuleHandleW(L"GameAssembly.dll"));
}

void* FindIl2CppAddress(const std::string& funcName)
{
    const auto it = g_il2CppAddresses.find(funcName);
    if (it == g_il2CppAddresses.end() || it->second == nullptr) {
        return nullptr;
    }

    return it->second;
}

void InitIl2CppFunctions()
{
    const auto gameAssembly = reinterpret_cast<HMODULE>(GetGameAssemblyModuleBase());
    if (!gameAssembly) {
        MessageBox(nullptr, L"CNM 的 你用在啥地方了？？？ 什么叫 找不到 GameAssembly.dll ？？？", L"严重错误", MB_OK | MB_ICONERROR);
        ExitProcess(1);
    }

    const auto decodedApis = DecodeSelectedApiAddresses(gameAssembly);
    std::vector<std::string> failedRequiredApis;
    g_il2CppAddresses.clear();

    for (const auto& [name, address] : decodedApis) {
        g_il2CppAddresses[name] = address;
    }

    for (const auto& binding : kApiBindings) {
        const auto it = g_il2CppAddresses.find(binding.name);
        const auto* apiAddress = it == g_il2CppAddresses.end() ? nullptr : it->second;
        if (!apiAddress) {
            failedRequiredApis.emplace_back(binding.name);
        }
    }

    DebugPrintA("[INFO] IL2CPP API Binding completed: selected=%zu\n", decodedApis.size());

    if (!failedRequiredApis.empty()) {
        std::wstringstream ss;
        ss << L"项目必需的 IL2CPP API 绑定失败:";
        for (const auto& api : failedRequiredApis) {
            ss << L"\n  - " << AnsiToUtf16(api);
        }
        ss << std::endl;
        MessageBox(nullptr, ss.str().c_str(), L"严重错误", MB_OK | MB_ICONERROR);
        ExitProcess(1);
    }
}
