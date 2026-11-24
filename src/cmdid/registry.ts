import { base } from "../il2cpp/addresses.js";
import { Il2CppArray } from "../il2cpp/structs/array.js";
import { Il2CppClass } from "../il2cpp/structs/class.js";
import { Il2CppObject } from "../il2cpp/structs/object.js";
import { cmdIdConstant } from "./constant.js";
import { RegisteredCommand } from "./message.js";

export class CommandRegistry {
    read(): RegisteredCommand[] {
        const handle = base.add(cmdIdConstant.registrySlot).readPointer();
        if (handle.isNull()) throw new Error("HNA command registry is not initialized");
        return new NetworkCommandTable(handle).read();
    }
}

class NetworkCommandTable extends Il2CppObject {
    read(): RegisteredCommand[] {
        if (this.klass.type.name !== cmdIdConstant.dictionary) throw new Error("Unexpected HNA command dictionary type");

        // 0.75.2: lookup 0x6276A10 reads the entry vector; insertion 0x6275890 updates count and version.
        const entries = new Il2CppArray(this.handle.add(0x18).readPointer());
        const used = this.handle.add(0x20).readS32(), free = this.handle.add(0x28).readS32();
        const version = this.handle.add(0x2c).readS32();
        if (entries.handle.isNull() || used <= 0 || used > entries.length || free < 0 || free >= used || used - free > 0x10000) {
            throw new Error("Invalid HNA command dictionary size");
        }

        const element = entries.elementType;
        const fields = new Map([...element.klass.fields()].filter(field => !field.isStatic).map(field => [field.name, field]));
        const hash = fields.get(cmdIdConstant.entry.hash), key = fields.get(cmdIdConstant.entry.key), value = fields.get(cmdIdConstant.entry.value);
        if (hash?.type.name !== "int" || key?.type.name !== "ushort" || value?.type.storageSize !== Process.pointerSize) {
            throw new Error("Unexpected HNA command entry layout");
        }
        const first = entries.data, stride = cmdIdConstant.entry.stride;
        const hashAt = hash.address(first, true), keyAt = key.address(first, true), valueAt = value.address(first, true);
        const result: RegisteredCommand[] = [];
        for (let index = 0; index < used; index++) {
            const offset = index * stride;
            if (hashAt.add(offset).readS32() < 0) continue;
            const klass = valueAt.add(offset).readPointer();
            if (klass.isNull()) throw new Error("Null class in HNA command registry at index " + index);
            result.push(new RegisteredCommand(new Il2CppClass(klass), keyAt.add(offset).readU16(), index));
        }
        if (this.handle.add(0x2c).readS32() !== version || result.length !== used - free) {
            throw new Error("HNA command dictionary changed or has invalid entries");
        }
        return result;
    }
}
