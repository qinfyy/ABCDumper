#include "pch.h"
#include "Il2CppFunctions.h"

#include "Initializer.h"
#include "PrintHelper.h"
#include "X64Emulator.h"

#include <array>
#include <cstring>
#include <sstream>
#include <unordered_map>
#include <vector>
#include "Util.h"

namespace
{
    constexpr uintptr_t kJumpTableRva = 0xF316D4;
    constexpr uintptr_t kDefaultCaseRva = 0xF303B9;
    constexpr uintptr_t kFailCaseRva = 0xF316B5;
    constexpr uintptr_t kApiTableRva = 0x1FBF310;
    constexpr size_t kApiTableEntryCount = 195;
    constexpr size_t kEncryptedApiTableCount = 0x4C3;
    constexpr uint64_t kBaseSeed = 0x502157060642ADD4ull;
    constexpr uint64_t kSeedDelta = 1;
    constexpr uint64_t kFakeStackBase = 0x1000000000ull;
    constexpr uint64_t kFakeEncryptedTableBase = 0x2000000000ull;
    constexpr size_t kMaxEmulateSteps = 4000;

    using Il2CppGetApiTable = void(__fastcall*)(uintptr_t* table);

    struct ApiBinding
    {
        const char* name;
        uint32_t caseIndex;
    };

    constexpr ApiBinding kApiBindings[] = {
        { "il2cpp_domain_get", 841 },
        { "il2cpp_thread_attach", 1100 },
        { "il2cpp_domain_get_assemblies", 1083 },
        { "il2cpp_assembly_get_image", 975 },
        { "il2cpp_image_get_name", 548 },
        { "il2cpp_image_get_class_count", 659 },
        { "il2cpp_image_get_class", 673 },
        { "il2cpp_class_get_fields", 837 },
        { "il2cpp_class_get_methods", 520 },
        { "il2cpp_class_get_name", 1162 },
        { "il2cpp_class_get_namespace", 354 },
        { "il2cpp_class_get_parent", 877 },
        { "il2cpp_field_get_flags", 1184 },
        { "il2cpp_field_get_name", 1031 },
        { "il2cpp_field_get_offset", 901 },
        { "il2cpp_field_get_type", 247 },
        { "il2cpp_method_get_return_type", 142 },
        { "il2cpp_method_get_name", 63 },
        { "il2cpp_method_get_param_count", 866 },
        { "il2cpp_method_get_param", 822 },
        { "il2cpp_type_get_name", 261 },
        { "il2cpp_method_has_attribute", 364 },
    };

    bool IsRequiredIl2CppApi(const char* apiName)
    {
        for (const auto& binding : kApiBindings) {
            if (strcmp(binding.name, apiName) == 0) {
                return true;
            }
        }

        return false;
    }

    uintptr_t GetCaseStart(uintptr_t unityBase, uint32_t caseIndex)
    {
        auto* jumpTable = reinterpret_cast<const uint32_t*>(unityBase + kJumpTableRva);
        return unityBase + jumpTable[caseIndex];
    }

    void InitializeEmulateState(X64Emulator::EmulateState& state, uint32_t caseIndex, uint64_t seed, const std::array<uintptr_t, kEncryptedApiTableCount>& encryptedApiTable)
    {
        state.rsp = kFakeStackBase;
        X64Emulator::WriteMemory(state, kFakeStackBase + 0x20, caseIndex, sizeof(uint32_t));
        X64Emulator::WriteMemory(state, kFakeStackBase + 0x28, seed, sizeof(uint64_t));
        X64Emulator::WriteMemory(state, kFakeStackBase + 0x30, kFakeEncryptedTableBase, sizeof(uint64_t));

        for (size_t i = 0; i < encryptedApiTable.size(); ++i) {
            X64Emulator::WriteMemory(state, kFakeEncryptedTableBase + i * sizeof(uintptr_t), encryptedApiTable[i], sizeof(uintptr_t));
        }
    }

    bool EmulateApiCase(uintptr_t unityBase, uint32_t caseIndex, const std::array<uintptr_t, kEncryptedApiTableCount>& encryptedApiTable, uintptr_t& decodedAddress)
    {
        bool hasDecodedAddress = false;
        X64Emulator::EmulateState state;
        InitializeEmulateState(state, caseIndex, kBaseSeed + kSeedDelta, encryptedApiTable);

        X64Emulator::EmulateOptions options;
        options.startIp = GetCaseStart(unityBase, caseIndex);
        options.successIp = unityBase + kDefaultCaseRva;
        options.failIp = unityBase + kFailCaseRva;
        options.maxSteps = kMaxEmulateSteps;
        options.onWriteMemory = [&](X64Emulator::EmulateState&, uint64_t address, uint64_t value, size_t size) {
            const auto apiTableBase = unityBase + kApiTableRva;
            if (address < apiTableBase || address >= apiTableBase + kApiTableEntryCount * sizeof(uintptr_t) || size != sizeof(uintptr_t)) {
                return false;
            }

            hasDecodedAddress = true;
            decodedAddress = static_cast<uintptr_t>(value);
            return true;
        };

        return X64Emulator::Emulate(state, options) && hasDecodedAddress && decodedAddress != 0;
    }

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
            MessageBox(nullptr, L"CNM 的 你用在啥地方了？？？ 没有找到 il2cpp_get_api_table ？无法读取加密 API table ？", L"严重错误", MB_OK | MB_ICONERROR);
            ExitProcess(1);
        }

        const auto unityPlayer = GetModuleHandleW(L"UnityPlayer.dll");
        if (!unityPlayer) {
            MessageBox(nullptr, L"CNM 的 你用在啥地方了？？？ 什么叫 找不到 UnityPlayer.dll ？？？", L"严重错误", MB_OK | MB_ICONERROR);
            ExitProcess(1);
        }

        const auto unityBase = reinterpret_cast<uintptr_t>(unityPlayer);
        std::array<uintptr_t, kEncryptedApiTableCount> encryptedApiTable{};
        getApiTable(encryptedApiTable.data());

        std::unordered_map<std::string, void*> decodedApis;
        std::vector<std::string> failedApis;
        for (const auto& binding : kApiBindings) {
            uintptr_t decodedAddress = 0;
            const auto ok = EmulateApiCase(unityBase, binding.caseIndex, encryptedApiTable, decodedAddress);
            if (!ok || !IsExecutableAddress(decodedAddress)) {
                failedApis.emplace_back(binding.name);
                continue;
            }

            decodedApis[binding.name] = reinterpret_cast<void*>(decodedAddress);
			auto rva = static_cast<uint64_t>(decodedAddress - GetGameAssemblyModuleBase());
			auto idaVa = rva + 0x180000000;
            DebugPrintA("[IL2CPP] case=%04u %-38s -> VA: %p, RVA: 0x%llX, IDA VA: 0x%llX\n", binding.caseIndex, binding.name, reinterpret_cast<void*>(decodedAddress), rva, idaVa);
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
        if (!apiAddress && IsRequiredIl2CppApi(binding.name)) {
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
