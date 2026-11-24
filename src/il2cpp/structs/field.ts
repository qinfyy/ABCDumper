import { api } from "../api.js";
import { FIELD_ATTRIBUTE_INIT_ONLY, FIELD_ATTRIBUTE_LITERAL, FIELD_ATTRIBUTE_STATIC } from "../constant.js";
import { NativeStruct } from "../memory.js";
import { Il2CppType } from "./type.js";
import { Il2CppClass } from "./class.js";
import { Il2CppObject } from "./object.js";

export class Il2CppField extends NativeStruct {
    get name(): string { return api.il2cpp_field_get_name(this.handle); }
    get type(): Il2CppType { return new Il2CppType(api.il2cpp_field_get_type(this.handle)); }
    get parent(): NativePointer { return api["il2cpp_field_get_parent"](this.handle); }
    get flags(): number { return this.type.attributes; }
    // Static/literal attributes are independent of the encoded offset's storage tag.
    get isStatic(): boolean { return (this.flags & FIELD_ATTRIBUTE_STATIC) !== 0; }
    get isLiteral(): boolean { return (this.flags & FIELD_ATTRIBUTE_LITERAL) !== 0; }
    get isReadOnly(): boolean { return (this.flags & FIELD_ATTRIBUTE_INIT_ONLY) !== 0; }
    get rawOffset(): number { return this.handle.add(0x18).readU32(); }
    get storageTag(): number { return this.rawOffset >>> 24; }
    get offset(): number { return api["il2cpp_field_get_offset"](this.handle); }
    get storage(): string {
        if (this.isLiteral) return "literal";
        if (!this.isStatic) return "instance";
        return ({ 0: "class-static", 1: "thread-static", 2: "global-static", 4: "indirect-global-static" } as Record<number, string>)[this.storageTag] ?? "unknown-static";
    }

    address(object: NativePointer, inline = false): NativePointer {
        if (this.isStatic || this.isLiteral) throw new Error("Not an instance field: " + this.name);
        const header = Il2CppObject.headerSize, offset = this.offset - (inline ? header : 0);
        const size = new Il2CppClass(this.parent).instanceSize - (inline ? header : 0);
        if (offset < (inline ? 0 : header) || offset + this.type.storageSize > size) throw new Error("Invalid instance field bounds: " + this.name);
        return object.add(offset);
    }

    setReference(object: NativePointer, value: NativePointer): void {
        this.address(object);
        api["il2cpp_field_set_value_object"](object, this.handle, value);
    }

    literalValue(): Il2CppObject {
        if (!this.isLiteral) throw new Error("Field is not a literal: " + this.name);
        const value = api["il2cpp_field_get_value_object"](this.handle, NULL);
        if (value.isNull()) throw new Error("Could not read literal: " + this.name);
        return new Il2CppObject(value);
    }

    summary() {
        return {
            field: this.toString(), name: this.name, type: this.type.name, typePointer: this.type.toString(),
            flags: this.flags, isStatic: this.isStatic, isLiteral: this.isLiteral, isReadOnly: this.isReadOnly,
            rawOffset: this.rawOffset, offset: this.offset, storageTag: this.storageTag, storage: this.storage
        };
    }
}
