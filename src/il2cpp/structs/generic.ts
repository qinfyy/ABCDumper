import { NativeStruct } from "../memory.js";
import { Il2CppType } from "./type.js";

// ABC 0.75.2: Il2CppGenericClass carries the definition type and class instance at +0/+8.
export class Il2CppGenericClass extends NativeStruct {
    readonly definition: Il2CppType;
    readonly instance: Il2CppGenericInst;

    constructor(handle: NativePointer) {
        super(handle);
        const definition = handle.readPointer(), instance = handle.add(8).readPointer();
        if (definition.isNull() || instance.isNull()) throw new Error("Incomplete generic class");
        this.definition = new Il2CppType(definition);
        this.instance = new Il2CppGenericInst(instance);
    }
}

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
