import { base, target } from "../il2cpp/addresses.js";
import { Il2CppMethod } from "../il2cpp/structs/method.js";
import { gpbConstant, nativeSemantic } from "./constant.js";

export class NativeProtoMethod extends Il2CppMethod {
    private static unwind?: DataView;

    get usable(): boolean {
        return !!this.rva && !this.invoker.isNull() && !["ret", "int3"].includes(Instruction.parse(this.body).mnemonic);
    }

    inspect(includeInstructions = false) {
        const start = this.body;
        if (start.isNull() || start.compare(base) < 0 || start.compare(base.add(target.size)) >= 0) return null;
        const { end } = this.bounds;
        const instructions: string[] = [];
        const calls: { at: string; target: string; rva: string; semantic?: string }[] = [];
        const name = this.name, reader = name === gpbConstant.methods.mergeFrom;
        const tagCandidates = new Set<number>(), fieldOffsets = new Set<number>(), thisRegisters = new Set(
            name === gpbConstant.methods.writeTo ? ["rdx"] : []);
        const tables = new Map<string, NativePointer>();
        let first = true, empty = false;
        for (const instruction of this.instructions()) {
            const address = instruction.address;
            if (first) empty = instruction.mnemonic === "ret";
            first = false;
            if (includeInstructions) instructions.push(address.sub(base) + " " + instruction);
            const [destination, source] = instruction.operands;
            for (const operand of instruction.operands) {
                if (operand.type === "mem" && operand.value.base && thisRegisters.has(operand.value.base) &&
                    !operand.value.index && operand.value.disp >= 16) fieldOffsets.add(operand.value.disp);
            }
            if (instruction.mnemonic === "mov" && destination?.type === "reg") {
                if (source?.type === "reg" && thisRegisters.has(source.value)) thisRegisters.add(destination.value);
                else thisRegisters.delete(destination.value);
            }
            const immediate = source?.type === "imm" ? Number(source.value.toString()) : undefined;
            if (reader && instruction.mnemonic === "lea" && destination?.type === "reg" &&
                source?.type === "mem" && source.value.base === "rip" && !source.value.index) {
                tables.set(destination.value, instruction.next.add(source.value.disp));
            }
            // Range-checked compare cascades can test a low byte instead of eax (e.g. 0x4AEE389).
            if (reader && instruction.mnemonic === "cmp" && destination?.type === "reg" && ["eax", "al", "ecx"].includes(destination.value) &&
                immediate !== undefined && immediate >= 8 && immediate <= 0xffffffff) {
                const branch = Instruction.parse(instruction.next) as X86Instruction;
                if (["je", "jne"].includes(branch.mnemonic)) tagCandidates.add(immediate);
                if (destination.value === "eax" && branch.mnemonic === "ja" && immediate <= 0x1000 && tables.size) {
                    this.collectSwitchTags(branch, immediate, tables, tagCandidates, end);
                }
            }
            if (["call", "jmp"].includes(instruction.mnemonic)) {
                const operand = instruction.operands[0], destination = operand?.type === "imm" ? Number(operand.value.toString()) : undefined;
                if (destination !== undefined && (instruction.mnemonic === "call" || ptr(destination).compare(start) < 0 || ptr(destination).compare(end) >= 0)) {
                    const rva = ptr(destination).sub(base).toUInt32();
                    calls.push({ at: address.sub(base).toString(), target: ptr(destination).toString(),
                        rva: "0x" + rva.toString(16), semantic: nativeSemantic(rva) });
                }
                if (instruction.mnemonic === "call") for (const register of ["rcx", "rdx", "r8", "r9", "rax"]) thisRegisters.delete(register);
            }
            if (empty) break;
        }
        return { rva: this.rva, empty, calls, tagCandidates: [...tagCandidates].sort((a, b) => a - b),
            fieldOffsets: [...fieldOffsets].sort((a, b) => a - b), instructions: includeInstructions ? instructions : undefined };
    }

    private collectSwitchTags(guard: X86Instruction, max: number, tables: Map<string, NativePointer>,
        candidates: Set<number>, end: NativePointer): void {
        // 0.75.2 e.g. 0x4A08FF7: the bounded raw tag indexes a relative jump table.
        const skip = guard.operands[0];
        if (skip?.type !== "imm" || guard.next.compare(end) >= 0) return;
        const fallback = ptr(skip.value.toString());
        let load = Instruction.parse(guard.next) as X86Instruction;
        const [dst, src] = load.operands;
        if (load.mnemonic === "mov" && dst?.type === "reg" && dst.value === "eax" && src?.type === "reg" && src.value === "eax") {
            load = Instruction.parse(load.next) as X86Instruction;
        }
        const [offset, lookup] = load.operands;
        if (load.mnemonic !== "movsxd" || offset?.type !== "reg" || lookup?.type !== "mem" ||
            lookup.value.index !== "rax" || lookup.value.scale !== 4 || !lookup.value.base) return;
        const add = Instruction.parse(load.next) as X86Instruction, jump = Instruction.parse(add.next) as X86Instruction;
        const [sum, register] = add.operands, [dispatch] = jump.operands;
        if (add.mnemonic !== "add" || sum?.type !== "reg" || sum.value !== offset.value ||
            register?.type !== "reg" || register.value !== lookup.value.base ||
            jump.mnemonic !== "jmp" || dispatch?.type !== "reg" || dispatch.value !== offset.value) return;
        const table = tables.get(register.value);
        const entries = table?.add(lookup.value.disp);
        if (!table || !entries || entries.compare(base) < 0 || entries.add(4 * (max + 1)).compare(base.add(target.size)) > 0) return;
        const tags: number[] = [];
        for (let tag = 0; tag <= max; tag++) {
            const destination = table.add(entries.add(tag * 4).readS32());
            if (destination.compare(this.body) < 0 || destination.compare(end) >= 0) return;
            if (tag >= 8 && !destination.equals(fallback)) tags.push(tag);
        }
        tags.forEach(tag => candidates.add(tag));
    }

    private *instructions(): Generator<X86Instruction> {
        const { end, leaf } = this.bounds;
        for (let address = this.body; address.compare(end) < 0;) {
            const instruction = Instruction.parse(address) as X86Instruction;
            if (instruction.mnemonic === "int3") break;
            yield instruction;
            if (leaf && ["ret", "jmp"].includes(instruction.mnemonic)) break;
            address = instruction.next;
        }
    }

    private get bounds(): { end: NativePointer; leaf: boolean } {
        const address = this.body, rva = address.sub(base).toUInt32(), table = NativeProtoMethod.unwindTable;
        let low = 0, high = Math.floor(table.byteLength / 12);
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (table.getUint32(middle * 12, true) <= rva) low = middle + 1;
            else high = middle;
        }
        if (low > 0) {
            const end = table.getUint32((low - 1) * 12 + 4, true);
            if (rva < end) return { end: base.add(end), leaf: false };
        }
        // Leaf methods may have no unwind entry; padding terminates their scan.
        return { end: address.add(0x100), leaf: true };
    }

    private static get unwindTable(): DataView {
        if (this.unwind) return this.unwind;
        const nt = base.add(base.add(0x3c).readU32()), directory = nt.add(24 + 112 + 3 * 8);
        const rva = directory.readU32(), size = directory.add(4).readU32();
        return this.unwind = new DataView(base.add(rva).readByteArray(size)!);
    }
}
