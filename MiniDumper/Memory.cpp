#include "pch.h"
#include "Memory.h"

#include "Constants.h"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <limits>

uintptr_t Scan(HMODULE moduleBase, LPCSTR pattern)
{
    if (!moduleBase)
        return 0;

    PIMAGE_DOS_HEADER dosHeader = (PIMAGE_DOS_HEADER)moduleBase;
    PIMAGE_NT_HEADERS ntHeaders = (PIMAGE_NT_HEADERS)((BYTE*)moduleBase + dosHeader->e_lfanew);
    DWORD sizeOfImage = ntHeaders->OptionalHeader.SizeOfImage;

    int* patternBytes = (int*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, (lstrlenA(pattern) / 3 + 1) * sizeof(int));
    if (!patternBytes) {
        return 0;
    }

    int patternIndex = 0;
    const char* start = pattern;
    const char* end = start + lstrlenA(pattern);

    for (const char* current = start; current < end; ++current) {
        if (*current == '?') {
            ++current;
            if (*current == '?')
                ++current;
            patternBytes[patternIndex++] = -1;
        }
        else {
            patternBytes[patternIndex++] = strtoul(current, (char**)&current, 16);
        }
    }

    BYTE* scanBytes = (BYTE*)moduleBase;
    DWORD patternSize = patternIndex;

    for (DWORD i = 0; i < sizeOfImage - patternSize; ++i) {
        bool found = true;
        for (DWORD j = 0; j < patternSize; ++j) {
            if (scanBytes[i + j] != patternBytes[j] && patternBytes[j] != -1) {
                found = false;
                break;
            }
        }

        if (found) {
            HeapFree(GetProcessHeap(), 0, patternBytes);
            return (uintptr_t)&scanBytes[i];
        }
    }

    HeapFree(GetProcessHeap(), 0, patternBytes);
    return 0;
}

uintptr_t ExtractQwordTarget(uintptr_t instructionAddress)
{
    const int32_t relativeOffset = *reinterpret_cast<int32_t*>(instructionAddress + 3);
    return instructionAddress + 7 + relativeOffset;
}

bool IsReadableProtection(DWORD protect)
{
    if ((protect & (PAGE_NOACCESS | PAGE_GUARD)) != 0) {
        return false;
    }

    constexpr DWORD kReadableFlags = PAGE_READONLY | PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
    return (protect & kReadableFlags) != 0;
}

bool IsReadablePointer(const void* address, size_t size)
{
    if (!address || size == 0) {
        return false;
    }

    MEMORY_BASIC_INFORMATION mbi{};
    if (!VirtualQuery(address, &mbi, sizeof(mbi))) {
        return false;
    }

    if (mbi.State != MEM_COMMIT || !IsReadableProtection(mbi.Protect)) {
        return false;
    }

    const auto begin = reinterpret_cast<uintptr_t>(address);
    const auto regionBegin = reinterpret_cast<uintptr_t>(mbi.BaseAddress);
    if (regionBegin > (std::numeric_limits<uintptr_t>::max)() - mbi.RegionSize) {
        return false;
    }

    const auto regionEnd = regionBegin + mbi.RegionSize;
    if (begin < regionBegin || begin >= regionEnd) {
        return false;
    }

    return size <= regionEnd - begin;
}

bool IsExecutablePointer(uintptr_t address)
{
    if (!address) {
        return false;
    }

    MEMORY_BASIC_INFORMATION mbi{};
    if (!VirtualQuery(reinterpret_cast<const void*>(address), &mbi, sizeof(mbi))) {
        return false;
    }

    if (mbi.State != MEM_COMMIT || (mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD)) != 0) {
        return false;
    }

    constexpr DWORD kExecutableFlags = PAGE_EXECUTE | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
    return (mbi.Protect & kExecutableFlags) != 0;
}

const char* ValidateCString(const char* value)
{
    if (!value) {
        return nullptr;
    }

    auto address = reinterpret_cast<uintptr_t>(value);
    size_t checkedLength = 0;
    while (checkedLength < kMaxCStringLength) {
        MEMORY_BASIC_INFORMATION mbi{};
        if (!VirtualQuery(reinterpret_cast<const void*>(address), &mbi, sizeof(mbi))) {
            return nullptr;
        }

        if (mbi.State != MEM_COMMIT || !IsReadableProtection(mbi.Protect)) {
            return nullptr;
        }

        const auto regionBegin = reinterpret_cast<uintptr_t>(mbi.BaseAddress);
        if (regionBegin > (std::numeric_limits<uintptr_t>::max)() - mbi.RegionSize) {
            return nullptr;
        }

        const auto regionEnd = regionBegin + mbi.RegionSize;
        if (address < regionBegin || address >= regionEnd) {
            return nullptr;
        }

        const auto chunkSize = (std::min)(regionEnd - address, kMaxCStringLength - checkedLength);
        if (chunkSize == 0) {
            return nullptr;
        }

        const void* terminator = nullptr;
        __try {
            terminator = std::memchr(reinterpret_cast<const void*>(address), '\0', chunkSize);
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            return nullptr;
        }

        if (terminator) {
            return value;
        }

        address += chunkSize;
        checkedLength += chunkSize;
    }

    return nullptr;
}

bool TryReadMemory(uintptr_t address, void* destination, size_t size)
{
    if (!address || !destination || !IsReadablePointer(reinterpret_cast<const void*>(address), size)) {
        return false;
    }

    __try {
        std::memcpy(destination, reinterpret_cast<const void*>(address), size);
        return true;
    }
    __except (EXCEPTION_EXECUTE_HANDLER) {
        return false;
    }
}
