import { base } from "../il2cpp/addresses.js";
import { TYPE_ATTRIBUTE_ABSTRACT } from "../il2cpp/constant.js";
import { Il2CppClass } from "../il2cpp/structs/class.js";
import { cmdIdConstant } from "./constant.js";
import { CmdIdGetter } from "./methods.js";
import { CommandRegistry } from "./registry.js";

export interface CmdIdEntry {
    name: string;
    namespace: string;
    cmdId: number;
    method: "registry-game" | "registry-fixed" | "getter";
    rva: string | null;
    index: number | null;
}

export class CommandMessageType extends Il2CppClass {
    private getterMethod?: CmdIdGetter | null;

    get isMessage(): boolean {
        if (this.kind !== "class" || this.flags & TYPE_ATTRIBUTE_ABSTRACT) return false;
        const self = cmdIdConstant.selfInterface + "<" + this.fullName + ">";
        if (!this.interfaces.some(type => type.name === self)) return false;
        for (const parent of this.hierarchy()) {
            if (!parent.handle.equals(this.handle) && parent.fullName === cmdIdConstant.messageBase) return true;
        }
        return false;
    }

    get getter(): CmdIdGetter | null {
        if (this.getterMethod !== undefined) return this.getterMethod;
        const method = Array.from(this.methods()).find(method => !method.isStatic && method.slot === cmdIdConstant.getterSlot &&
            method.parameterCount === 0 && method.returnType.name === "ushort");
        return this.getterMethod = method ? new CmdIdGetter(method.handle) : null;
    }

    get metadataValue(): number | null {
        return this.bitfield & cmdIdConstant.metadataFlag ? (this.extraVtable.readU32() ^ cmdIdConstant.metadataXor) & 0xffff : null;
    }

    command(registry: CommandRegistry): CmdIdEntry | null {
        const registered = registry.get(this.fullName);
        if (registered) return {
            name: this.name, namespace: this.namespace, cmdId: registered.cmdId,
            method: `registry-${registered.registry}`, rva: registered.rva, index: registered.index
        };
        const getter = this.getter, cmdId = getter?.value;
        if (!cmdId) return null;
        return { name: this.name, namespace: this.namespace, cmdId, method: "getter", rva: getter.rva, index: null };
    }

    describe(registry: CommandRegistry) {
        if (!this.isMessage) throw new Error("Not a message class: " + this.fullName);
        const registered = registry.get(this.fullName), getter = this.getter, getterValue = getter?.value ?? null;
        return {
            name: this.fullName, cmdId: registered?.cmdId ?? (getterValue || null),
            source: registered ? "registry" : getterValue ? "getter" : "none", registry: registered?.registry ?? null,
            getter: getter ? { rva: getter.rva, value: getterValue } : null,
            metadataValue: this.metadataValue, publicGetterRva: "0x" + cmdIdConstant.publicGetter.toString(16),
            publicGetterMode: base.add(cmdIdConstant.getterMode).readU8() === 1 ? "virtual-getter" : "class-metadata"
        };
    }
}
