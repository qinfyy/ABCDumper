import { NativeStruct } from "../memory.js";
import { Il2CppClass } from "./class.js";
import { Il2CppField } from "./field.js";

export class Il2CppObject extends NativeStruct {
    // ABC 0.75.2: boxed value data follows the two-pointer object header.
    static readonly headerSize = 0x10;

    get klass(): Il2CppClass { return new Il2CppClass(this.handle.readPointer()); }
    get monitor(): NativePointer { return this.handle.add(8).readPointer(); }
    get data(): NativePointer { return this.handle.add(Il2CppObject.headerSize); }
    get receiver(): NativePointer { return this.klass.isValueType ? this.data : this.handle; }

    fieldAddress(field: Il2CppField): NativePointer { return field.address(this.handle); }
}
