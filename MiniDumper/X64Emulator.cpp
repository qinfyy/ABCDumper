#include "pch.h"
#include "X64Emulator.h"

#include <capstone/capstone.h>
#include <sstream>
#include <stdexcept>

namespace X64Emulator
{
    namespace
    {
        enum class RegisterId
        {
            Rax,
            Rbx,
            Rcx,
            Rdx,
            Rsi,
            Rdi,
            Rsp,
            Rbp,
            R8,
            R9,
            R10,
            R11,
            R12,
            R13,
            R14,
            R15,
        };

        struct RegisterRef
        {
            RegisterId id{};
            uint32_t bits{};
        };

        uint64_t MaskForSize(size_t size)
        {
            if (size >= sizeof(uint64_t)) {
                return UINT64_MAX;
            }

            return (uint64_t{1} << (size * 8)) - 1;
        }

        RegisterRef DecodeRegister(x86_reg reg)
        {
            switch (reg) {
            case X86_REG_RAX: return { RegisterId::Rax, 64 };
            case X86_REG_RBX: return { RegisterId::Rbx, 64 };
            case X86_REG_RCX: return { RegisterId::Rcx, 64 };
            case X86_REG_RDX: return { RegisterId::Rdx, 64 };
            case X86_REG_RSI: return { RegisterId::Rsi, 64 };
            case X86_REG_RDI: return { RegisterId::Rdi, 64 };
            case X86_REG_RSP: return { RegisterId::Rsp, 64 };
            case X86_REG_RBP: return { RegisterId::Rbp, 64 };
            case X86_REG_R8: return { RegisterId::R8, 64 };
            case X86_REG_R9: return { RegisterId::R9, 64 };
            case X86_REG_R10: return { RegisterId::R10, 64 };
            case X86_REG_R11: return { RegisterId::R11, 64 };
            case X86_REG_R12: return { RegisterId::R12, 64 };
            case X86_REG_R13: return { RegisterId::R13, 64 };
            case X86_REG_R14: return { RegisterId::R14, 64 };
            case X86_REG_R15: return { RegisterId::R15, 64 };
            case X86_REG_EAX: return { RegisterId::Rax, 32 };
            case X86_REG_EBX: return { RegisterId::Rbx, 32 };
            case X86_REG_ECX: return { RegisterId::Rcx, 32 };
            case X86_REG_EDX: return { RegisterId::Rdx, 32 };
            case X86_REG_ESI: return { RegisterId::Rsi, 32 };
            case X86_REG_EDI: return { RegisterId::Rdi, 32 };
            case X86_REG_ESP: return { RegisterId::Rsp, 32 };
            case X86_REG_EBP: return { RegisterId::Rbp, 32 };
            case X86_REG_R8D: return { RegisterId::R8, 32 };
            case X86_REG_R9D: return { RegisterId::R9, 32 };
            case X86_REG_R10D: return { RegisterId::R10, 32 };
            case X86_REG_R11D: return { RegisterId::R11, 32 };
            case X86_REG_R12D: return { RegisterId::R12, 32 };
            case X86_REG_R13D: return { RegisterId::R13, 32 };
            case X86_REG_R14D: return { RegisterId::R14, 32 };
            case X86_REG_R15D: return { RegisterId::R15, 32 };
            case X86_REG_AL: return { RegisterId::Rax, 8 };
            case X86_REG_BL: return { RegisterId::Rbx, 8 };
            case X86_REG_CL: return { RegisterId::Rcx, 8 };
            case X86_REG_DL: return { RegisterId::Rdx, 8 };
            default:
                throw std::runtime_error("？？？x64 模拟器遇到不支持的寄存器");
            }
        }

        uint64_t& RegisterStorage(EmulateState& state, RegisterId id)
        {
            switch (id) {
            case RegisterId::Rax: return state.rax;
            case RegisterId::Rbx: return state.rbx;
            case RegisterId::Rcx: return state.rcx;
            case RegisterId::Rdx: return state.rdx;
            case RegisterId::Rsi: return state.rsi;
            case RegisterId::Rdi: return state.rdi;
            case RegisterId::Rsp: return state.rsp;
            case RegisterId::Rbp: return state.rbp;
            case RegisterId::R8: return state.r8;
            case RegisterId::R9: return state.r9;
            case RegisterId::R10: return state.r10;
            case RegisterId::R11: return state.r11;
            case RegisterId::R12: return state.r12;
            case RegisterId::R13: return state.r13;
            case RegisterId::R14: return state.r14;
            case RegisterId::R15: return state.r15;
            default:
                throw std::runtime_error("？？？ x64 模拟器遇到不支持的寄存器存储");
            }
        }

        uint64_t ReadRegister(EmulateState& state, x86_reg reg)
        {
            const auto ref = DecodeRegister(reg);
            return RegisterStorage(state, ref.id) & MaskForSize(ref.bits / 8);
        }

        void WriteRegister(EmulateState& state, x86_reg reg, uint64_t value)
        {
            const auto ref = DecodeRegister(reg);
            auto& storage = RegisterStorage(state, ref.id);
            if (ref.bits == 8) {
                storage = (storage & ~uint64_t{0xFF}) | (value & 0xFF);
            }
            else if (ref.bits == 32) {
                storage = value & 0xFFFFFFFFull;
            }
            else {
                storage = value;
            }
        }

        uint64_t ResolveMemoryAddress(EmulateState& state, const cs_insn& insn, const cs_x86_op& op)
        {
            uint64_t base = 0;
            if (op.mem.base == X86_REG_RIP) {
                base = insn.address + insn.size;
            }
            else if (op.mem.base != X86_REG_INVALID) {
                base = ReadRegister(state, static_cast<x86_reg>(op.mem.base));
            }

            uint64_t index = 0;
            if (op.mem.index != X86_REG_INVALID) {
                index = ReadRegister(state, static_cast<x86_reg>(op.mem.index));
            }

            return base + index * op.mem.scale + op.mem.disp;
        }

        uint64_t ReadOperand(EmulateState& state, const cs_insn& insn, const cs_x86_op& op)
        {
            switch (op.type) {
            case X86_OP_REG:
                return ReadRegister(state, static_cast<x86_reg>(op.reg));
            case X86_OP_IMM:
                return static_cast<uint64_t>(op.imm) & MaskForSize(op.size == 0 ? sizeof(uint64_t) : op.size);
            case X86_OP_MEM:
                return ReadMemory(state, ResolveMemoryAddress(state, insn, op), op.size);
            default:
                throw std::runtime_error("x64 模拟器遇到未支持的操作数读取");
            }
        }

        void WriteOperand(EmulateState& state, const EmulateOptions& options, const cs_insn& insn, const cs_x86_op& op, uint64_t value)
        {
            switch (op.type) {
            case X86_OP_REG:
                WriteRegister(state, static_cast<x86_reg>(op.reg), value);
                return;
            case X86_OP_MEM:
            {
                const auto address = ResolveMemoryAddress(state, insn, op);
                if (options.onWriteMemory && options.onWriteMemory(state, address, value, op.size)) {
                    return;
                }

                WriteMemory(state, address, value, op.size);
                return;
            }
            default:
                throw std::runtime_error("x64 模拟器遇到未支持的操作数写入");
            }
        }

        bool ShouldTakeJump(const EmulateState& state, uint32_t instructionId)
        {
            switch (instructionId) {
            case X86_INS_JE:
                return state.zeroFlag;
            case X86_INS_JNE:
                return !state.zeroFlag;
            case X86_INS_JA:
                return !state.carryFlag && !state.zeroFlag;
            case X86_INS_JAE:
                return !state.carryFlag;
            case X86_INS_JB:
                return state.carryFlag;
            case X86_INS_JBE:
                return state.carryFlag || state.zeroFlag;
            default:
                throw std::runtime_error("x64 模拟器遇到未支持的条件跳转");
            }
        }
    }

    uint64_t ReadMemory(const EmulateState& state, uint64_t address, size_t size)
    {
        uint64_t value = 0;
        for (size_t i = 0; i < size; ++i) {
            const auto it = state.memory.find(address + i);
            if (it != state.memory.end()) {
                value |= static_cast<uint64_t>(it->second) << (i * 8);
            }
        }

        return value;
    }

    void WriteMemory(EmulateState& state, uint64_t address, uint64_t value, size_t size)
    {
        const auto mask = MaskForSize(size);
        value &= mask;
        for (size_t i = 0; i < size; ++i) {
            state.memory[address + i] = static_cast<uint8_t>((value >> (i * 8)) & 0xFF);
        }
    }

    bool Emulate(EmulateState& state, const EmulateOptions& options)
    {
        csh capstone{};
        if (cs_open(CS_ARCH_X86, CS_MODE_64, &capstone) != CS_ERR_OK) {
            throw std::runtime_error("Capstone 初始化失败，无法执行 x64 模拟");
        }

        cs_option(capstone, CS_OPT_DETAIL, CS_OPT_ON);
        auto ip = options.startIp;

        for (size_t step = 0; step < options.maxSteps; ++step) {
            if (ip == options.successIp) {
                cs_close(&capstone);
                return true;
            }

            if (ip == options.failIp) {
                cs_close(&capstone);
                return false;
            }

            const uint8_t* code = reinterpret_cast<const uint8_t*>(ip);
            size_t codeSize = 16;
            uint64_t address = ip;
            cs_insn* insn = cs_malloc(capstone);
            if (!insn) {
                cs_close(&capstone);
                throw std::runtime_error("Capstone 指令分配失败");
            }

            const bool disassembled = cs_disasm_iter(capstone, &code, &codeSize, &address, insn);
            if (!disassembled) {
                cs_free(insn, 1);
                cs_close(&capstone);
                throw std::runtime_error("Capstone 反汇编失败");
            }

            const auto& x86 = insn->detail->x86;
            auto nextIp = ip + insn->size;

            switch (insn->id) {
            case X86_INS_MOV:
            case X86_INS_MOVABS:
                WriteOperand(state, options, *insn, x86.operands[0], ReadOperand(state, *insn, x86.operands[1]));
                break;
            case X86_INS_LEA:
                WriteOperand(state, options, *insn, x86.operands[0], ResolveMemoryAddress(state, *insn, x86.operands[1]));
                break;
            case X86_INS_ADD:
                WriteOperand(state, options, *insn, x86.operands[0], ReadOperand(state, *insn, x86.operands[0]) + ReadOperand(state, *insn, x86.operands[1]));
                break;
            case X86_INS_INC:
                WriteOperand(state, options, *insn, x86.operands[0], ReadOperand(state, *insn, x86.operands[0]) + 1);
                break;
            case X86_INS_XOR:
                WriteOperand(state, options, *insn, x86.operands[0], ReadOperand(state, *insn, x86.operands[0]) ^ ReadOperand(state, *insn, x86.operands[1]));
                break;
            case X86_INS_SHR:
                WriteOperand(state, options, *insn, x86.operands[0], ReadOperand(state, *insn, x86.operands[0]) >> ReadOperand(state, *insn, x86.operands[1]));
                break;
            case X86_INS_IMUL:
                if (x86.op_count == 2) {
                    WriteOperand(state, options, *insn, x86.operands[0], ReadOperand(state, *insn, x86.operands[0]) * ReadOperand(state, *insn, x86.operands[1]));
                }
                else if (x86.op_count == 3) {
                    WriteOperand(state, options, *insn, x86.operands[0], ReadOperand(state, *insn, x86.operands[1]) * ReadOperand(state, *insn, x86.operands[2]));
                }
                else {
                    cs_free(insn, 1);
                    cs_close(&capstone);
                    throw std::runtime_error("x64 模拟器遇到未支持的 imul 形式");
                }
                break;
            case X86_INS_CMP:
            {
                const auto left = ReadOperand(state, *insn, x86.operands[0]);
                const auto right = ReadOperand(state, *insn, x86.operands[1]);
                const auto size = x86.operands[0].size > x86.operands[1].size ? x86.operands[0].size : x86.operands[1].size;
                const auto mask = MaskForSize(size);
                const auto maskedLeft = left & mask;
                const auto maskedRight = right & mask;
                state.zeroFlag = ((maskedLeft - maskedRight) & mask) == 0;
                state.carryFlag = maskedLeft < maskedRight;
                break;
            }
            case X86_INS_CALL:
                state.returnStack.push(nextIp);
                nextIp = ReadOperand(state, *insn, x86.operands[0]);
                break;
            case X86_INS_RET:
                if (state.returnStack.empty()) {
                    cs_free(insn, 1);
                    cs_close(&capstone);
                    return false;
                }
                nextIp = state.returnStack.top();
                state.returnStack.pop();
                break;
            case X86_INS_JMP:
                nextIp = ReadOperand(state, *insn, x86.operands[0]);
                break;
            case X86_INS_JE:
            case X86_INS_JNE:
            case X86_INS_JA:
            case X86_INS_JAE:
            case X86_INS_JB:
            case X86_INS_JBE:
                if (ShouldTakeJump(state, insn->id)) {
                    nextIp = ReadOperand(state, *insn, x86.operands[0]);
                }
                break;
            case X86_INS_NOP:
                break;
            default:
            {
                std::stringstream ss;
                ss << "x64 模拟器遇到不支持的指令: " << insn->mnemonic << " " << insn->op_str;
                cs_free(insn, 1);
                cs_close(&capstone);
                throw std::runtime_error(ss.str());
            }
            }

            cs_free(insn, 1);
            ip = nextIp;
        }

        cs_close(&capstone);
        return false;
    }
}
