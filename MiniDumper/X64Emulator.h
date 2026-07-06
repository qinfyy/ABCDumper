#pragma once

#include <cstdint>
#include <functional>
#include <stack>
#include <unordered_map>

namespace X64Emulator
{
    struct EmulateState
    {
        uint64_t rax{};
        uint64_t rbx{};
        uint64_t rcx{};
        uint64_t rdx{};
        uint64_t rsi{};
        uint64_t rdi{};
        uint64_t rsp{};
        uint64_t rbp{};
        uint64_t r8{};
        uint64_t r9{};
        uint64_t r10{};
        uint64_t r11{};
        uint64_t r12{};
        uint64_t r13{};
        uint64_t r14{};
        uint64_t r15{};
        bool zeroFlag{};
        bool carryFlag{};
        std::stack<uint64_t> returnStack;
        std::unordered_map<uint64_t, uint8_t> memory;
    };

    struct EmulateOptions
    {
        uintptr_t startIp{};
        uintptr_t successIp{};
        uintptr_t failIp{};
        size_t maxSteps{5000};
        std::function<bool(EmulateState& state, uint64_t address, uint64_t value, size_t size)> onWriteMemory;
    };

    uint64_t ReadMemory(const EmulateState& state, uint64_t address, size_t size);
    void WriteMemory(EmulateState& state, uint64_t address, uint64_t value, size_t size);
    bool Emulate(EmulateState& state, const EmulateOptions& options);
}
