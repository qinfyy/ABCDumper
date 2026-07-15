#pragma once

#include <Windows.h>

#include <cstddef>
#include <cstdint>
#include <type_traits>

uintptr_t Scan(HMODULE moduleBase, LPCSTR pattern);
uintptr_t ExtractQwordTarget(uintptr_t instructionAddress);

bool IsReadableProtection(DWORD protect);
bool IsReadablePointer(const void* address, size_t size = 1);
bool IsExecutablePointer(uintptr_t address);
const char* ValidateCString(const char* value);

bool TryReadMemory(uintptr_t address, void* destination, size_t size);

template <typename T>
bool TryReadValue(uintptr_t address, T* value)
{
    static_assert(std::is_trivially_copyable_v<T>);
    return TryReadMemory(address, value, sizeof(T));
}
