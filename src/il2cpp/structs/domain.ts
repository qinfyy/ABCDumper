import { api } from "../api.js";
import { NativeStruct } from "../memory.js";
import { Il2CppAssembly } from "./assembly.js";

export { Il2CppAssembly } from "./assembly.js";

export class Il2CppDomain extends NativeStruct {
    static get current(): Il2CppDomain { return new Il2CppDomain(api.il2cpp_domain_get()); }

    get assemblies(): Il2CppAssembly[] {
        if (this.handle.isNull()) throw new Error("IL2CPP domain not initialized");
        const size = Memory.alloc(8).writeU64(0);
        const first = api.il2cpp_domain_get_assemblies(this.handle, size);
        const count = size.readU64().toNumber();
        if (count <= 0 || count > 4096 || first.isNull()) throw new Error("Invalid IL2CPP assembly table");
        return Array.from({ length: count }, (_, i) => new Il2CppAssembly(first.add(i * 8).readPointer()));
    }
}
