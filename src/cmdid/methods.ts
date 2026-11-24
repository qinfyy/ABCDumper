import { Il2CppMethod } from "../il2cpp/structs/method.js";

export class CmdIdGetter extends Il2CppMethod {
    get value(): number | null {
        if (this.body.isNull()) return null;
        let value: number | undefined;
        const limit = this.body.add(64);
        for (let address = this.body; address.compare(limit) < 0;) {
            const instruction = Instruction.parse(address) as X86Instruction;
            const [destination, source] = instruction.operands;
            if (instruction.mnemonic === "ret" && value !== undefined) return value;
            if (instruction.mnemonic === "mov" && destination?.type === "reg" && ["ax", "eax", "rax"].includes(destination.value) && source?.type === "imm") {
                value = Number(source.value.toString()) & 0xffff;
            } else if (instruction.mnemonic === "xor" && destination?.type === "reg" && ["eax", "rax"].includes(destination.value) &&
                source?.type === "reg" && destination.value === source.value) {
                value = 0;
            } else if (!["nop", "endbr64"].includes(instruction.mnemonic)) {
                throw new Error("CmdId getter is not constant: " + this.rva);
            }
            address = instruction.next;
        }
        throw new Error("CmdId getter has no return: " + this.rva);
    }
}
