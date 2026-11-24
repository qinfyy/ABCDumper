import { NativeStruct } from "../memory.js";
import { Il2CppType } from "./type.js";

// ABC 0.75.2: Il2CppGenericInst has a uint32 argument count and a pointer at +8.
export class Il2CppGenericInst extends NativeStruct {
    get argumentCount(): number { return this.handle.readU32(); }
    get arguments(): Il2CppType[] {
        const first = this.handle.add(8).readPointer();
        const count = this.argumentCount;
        if (count > 32 || (count && first.isNull())) throw new Error("Invalid generic argument table");
        return Array.from({ length: count }, (_, i) => new Il2CppType(first.add(i * Process.pointerSize).readPointer()));
    }
}

export class Il2CppArrayType extends NativeStruct {
    get elementType(): Il2CppType { return new Il2CppType(this.handle.readPointer()); }
    get rank(): number { return this.handle.add(8).readU8(); }
}
