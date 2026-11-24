import { api } from "../il2cpp/api.js";
import { base } from "../il2cpp/addresses.js";
import { Il2CppClass } from "../il2cpp/structs/class.js";
import { Il2CppField } from "../il2cpp/structs/field.js";
import { cmdIdConstant } from "./constant.js";

export interface RegisteredCommand {
    name: string;
    cmdId: number;
    registry: "game" | "fixed";
    rva: string;
    index: number;
}

export class CommandRegistry {
    private commands?: Map<string, RegisteredCommand>;

    get(name: string): RegisteredCommand | undefined { return this.entries.get(name); }
    values(): IterableIterator<RegisteredCommand> { return this.entries.values(); }

    private get entries(): Map<string, RegisteredCommand> {
        return this.commands ??= new Map([...new GameCommandRegistry().read(), ...new FixedCommandRegistry().read()]
            .map(command => [command.name, command]));
    }
}

abstract class NativeCommandRegistry {
    protected abstract readonly kind: RegisteredCommand["registry"];
    protected abstract readonly profile: { start: number; end: number; usage: number; };

    read(): RegisteredCommand[] {
        api["il2cpp::vm::MetadataCache::InitializeMethodMetadata"](this.profile.usage);
        return this.recover();
    }

    protected abstract recover(): RegisteredCommand[];

    protected *instructions(): Generator<X86Instruction> {
        const limit = base.add(this.profile.end);
        for (let address = base.add(this.profile.start); address.compare(limit) < 0;) {
            const instruction = Instruction.parse(address) as X86Instruction;
            yield instruction;
            address = instruction.next;
        }
    }

    protected ripSlot(instruction: X86Instruction, operand: X86Operand | undefined): NativePointer | null {
        return operand?.type === "mem" && operand.value.base === "rip" ? instruction.next.add(operand.value.disp) : null;
    }

    protected command(slot: NativePointer, cmdId: number, index: number): RegisteredCommand {
        return { name: new Il2CppClass(slot.readPointer()).fullName, cmdId, registry: this.kind,
            rva: "0x" + this.profile.start.toString(16), index };
    }
}

class GameCommandRegistry extends NativeCommandRegistry {
    protected readonly kind = "game";
    protected readonly profile = cmdIdConstant.game;

    protected recover(): RegisteredCommand[] {
        const data = new Il2CppField(base.add(this.profile.idsField).readPointer()).data;
        if (data.isNull()) throw new Error("Game CmdId array has no field data");
        const slots = new Map<number, NativePointer>();
        let source: NativePointer | null = null;
        // CN 7.2.50 constructor: class array data starts at +0x20, with 8-byte slots paired to the ushort array.
        for (const instruction of this.instructions()) {
            const [destination, value] = instruction.operands;
            if (instruction.mnemonic === "mov") {
                if (destination?.type === "reg" && destination.value === "rax") source = this.ripSlot(instruction, value);
                if (destination?.type === "mem" && destination.value.base === "rbx" && !destination.value.index &&
                    value?.type === "reg" && value.value === "rax" && source) {
                    const offset = destination.value.disp;
                    if (offset >= 0x20 && offset % 8 === 0) slots.set((offset - 0x20) / 8, source);
                }
            }
            if (instruction.mnemonic === "call") source = null;
        }
        if (slots.size !== this.profile.count) throw new Error("Game CmdId/class array lengths differ");
        return Array.from({ length: this.profile.count }, (_, index) => {
            const slot = slots.get(index);
            if (!slot) throw new Error("Game CmdId class missing at index " + index);
            return this.command(slot, data.add(index * 2).readU16(), index);
        });
    }
}

class FixedCommandRegistry extends NativeCommandRegistry {
    protected readonly kind = "fixed";
    protected readonly profile = cmdIdConstant.fixed;

    protected recover(): RegisteredCommand[] {
        const result: RegisteredCommand[] = [];
        let cmdId: number | null = null, slot: NativePointer | null = null;
        for (const instruction of this.instructions()) {
            const [destination, value] = instruction.operands;
            if (instruction.mnemonic === "mov" && destination?.type === "reg") {
                if (["dx", "edx"].includes(destination.value) && value?.type === "imm") cmdId = Number(value.value.toString()) & 0xffff;
                if (destination.value === "r8") slot = this.ripSlot(instruction, value);
            }
            if (instruction.mnemonic === "call") {
                if (destination?.type === "imm" && ptr(destination.value.toString()).equals(base.add(this.profile.insert))) {
                    if (cmdId === null || !slot) throw new Error("Fixed CmdId registration is incomplete");
                    result.push(this.command(slot, cmdId, result.length));
                }
                cmdId = null;
                slot = null;
            }
        }
        return result;
    }
}
