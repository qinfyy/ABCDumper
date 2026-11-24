import { api } from "../api.js";
import { Il2CppTypeBits, Il2CppTypeEnum } from "../constant.js";
import { NativeStruct, pointer, read64 } from "../memory.js";
import { Il2CppClass } from "./class.js";
import { Il2CppArrayType, Il2CppGenericClass } from "./generic.js";
import { Il2CppObject } from "./object.js";

const primitiveNames: Record<number, string> = {
    [Il2CppTypeEnum.IL2CPP_TYPE_VOID]: "void", [Il2CppTypeEnum.IL2CPP_TYPE_BOOLEAN]: "bool",
    [Il2CppTypeEnum.IL2CPP_TYPE_CHAR]: "char", [Il2CppTypeEnum.IL2CPP_TYPE_I1]: "sbyte", [Il2CppTypeEnum.IL2CPP_TYPE_U1]: "byte",
    [Il2CppTypeEnum.IL2CPP_TYPE_I2]: "short", [Il2CppTypeEnum.IL2CPP_TYPE_U2]: "ushort",
    [Il2CppTypeEnum.IL2CPP_TYPE_I4]: "int", [Il2CppTypeEnum.IL2CPP_TYPE_U4]: "uint",
    [Il2CppTypeEnum.IL2CPP_TYPE_I8]: "long", [Il2CppTypeEnum.IL2CPP_TYPE_U8]: "ulong",
    [Il2CppTypeEnum.IL2CPP_TYPE_R4]: "float", [Il2CppTypeEnum.IL2CPP_TYPE_R8]: "double",
    [Il2CppTypeEnum.IL2CPP_TYPE_STRING]: "string", [Il2CppTypeEnum.IL2CPP_TYPE_TYPEDBYREF]: "System.TypedReference",
    [Il2CppTypeEnum.IL2CPP_TYPE_I]: "System.IntPtr", [Il2CppTypeEnum.IL2CPP_TYPE_U]: "System.UIntPtr",
    [Il2CppTypeEnum.IL2CPP_TYPE_OBJECT]: "object"
};
const names = new Map<string, string>();
const classes = new Map<string, Il2CppClass>();
const scalarSizes: Record<number, number> = {
    [Il2CppTypeEnum.IL2CPP_TYPE_BOOLEAN]: 1, [Il2CppTypeEnum.IL2CPP_TYPE_CHAR]: 2,
    [Il2CppTypeEnum.IL2CPP_TYPE_I1]: 1, [Il2CppTypeEnum.IL2CPP_TYPE_U1]: 1,
    [Il2CppTypeEnum.IL2CPP_TYPE_I2]: 2, [Il2CppTypeEnum.IL2CPP_TYPE_U2]: 2,
    [Il2CppTypeEnum.IL2CPP_TYPE_I4]: 4, [Il2CppTypeEnum.IL2CPP_TYPE_U4]: 4,
    [Il2CppTypeEnum.IL2CPP_TYPE_I8]: 8, [Il2CppTypeEnum.IL2CPP_TYPE_U8]: 8,
    [Il2CppTypeEnum.IL2CPP_TYPE_R4]: 4, [Il2CppTypeEnum.IL2CPP_TYPE_R8]: 8
};

export class Il2CppType extends NativeStruct {
    get data(): bigint { return read64(this.handle); }
    get attributes(): number { return this.handle.add(8).readU16(); }
    get tag(): number { return this.handle.add(10).readU8(); }
    get isByReference(): boolean { return (this.handle.add(11).readU8() & Il2CppTypeBits.byref) !== 0; }
    get isEnum(): boolean { return this.tag === Il2CppTypeEnum.IL2CPP_TYPE_VALUETYPE && !!(this.handle.add(12).readU8() & Il2CppTypeBits.enumType); }
    get name(): string { return this.resolveName(); }
    get klass(): Il2CppClass {
        const key = this.toString(), cached = classes.get(key);
        if (cached) return cached;
        const handle = api["il2cpp_class_from_type"](this.handle);
        if (handle.isNull()) throw new Error("No runtime class for Il2CppType " + key);
        const klass = new Il2CppClass(handle);
        classes.set(key, klass);
        return klass;
    }
    get elementType(): Il2CppType {
        if (this.tag === Il2CppTypeEnum.IL2CPP_TYPE_ARRAY) return new Il2CppArrayType(pointer(this.data)).elementType;
        if (this.tag === Il2CppTypeEnum.IL2CPP_TYPE_SZARRAY || this.tag === Il2CppTypeEnum.IL2CPP_TYPE_PTR) return new Il2CppType(pointer(this.data));
        throw new Error("Type has no array/pointer element: " + this.name);
    }
    get genericArguments(): Il2CppType[] {
        return this.tag === Il2CppTypeEnum.IL2CPP_TYPE_GENERICINST ? new Il2CppGenericClass(pointer(this.data)).instance.arguments : [];
    }
    get storageSize(): number {
        if (this.isByReference) throw new Error("By-reference storage is not supported: " + this.name);
        if (scalarSizes[this.tag]) return scalarSizes[this.tag];
        if ([Il2CppTypeEnum.IL2CPP_TYPE_STRING, Il2CppTypeEnum.IL2CPP_TYPE_CLASS, Il2CppTypeEnum.IL2CPP_TYPE_OBJECT,
            Il2CppTypeEnum.IL2CPP_TYPE_SZARRAY, Il2CppTypeEnum.IL2CPP_TYPE_ARRAY, Il2CppTypeEnum.IL2CPP_TYPE_PTR,
            Il2CppTypeEnum.IL2CPP_TYPE_I, Il2CppTypeEnum.IL2CPP_TYPE_U].includes(this.tag)) return Process.pointerSize;
        if (this.tag === Il2CppTypeEnum.IL2CPP_TYPE_VALUETYPE || this.tag === Il2CppTypeEnum.IL2CPP_TYPE_GENERICINST) {
            const klass = this.klass;
            if (!klass.isValueType) return Process.pointerSize;
            klass.ensureLayout();
            const size = klass.instanceSize - Il2CppObject.headerSize;
            if (size > 0 && size < 65536) return size;
        }
        throw new Error("Type storage size is not recovered: " + this.name);
    }

    private resolveName(depth = 0): string {
        if (this.handle.isNull()) return "<null-type>";
        const key = this.toString();
        const cached = names.get(key);
        if (cached !== undefined) return cached;
        if (depth > 32) return "<recursive-type>";
        const data = this.data;
        const tag = this.tag;
        const nested = (type: Il2CppType): string => type.resolveName(depth + 1);
        let name = primitiveNames[tag];
        switch (tag) {
            case Il2CppTypeEnum.IL2CPP_TYPE_VALUETYPE:
            case Il2CppTypeEnum.IL2CPP_TYPE_CLASS:
                name = this.klass.fullName;
                break;
            case Il2CppTypeEnum.IL2CPP_TYPE_PTR:
            case Il2CppTypeEnum.IL2CPP_TYPE_SZARRAY:
                name = nested(new Il2CppType(pointer(data))) + (tag === Il2CppTypeEnum.IL2CPP_TYPE_PTR ? "*" : "[]");
                break;
            case Il2CppTypeEnum.IL2CPP_TYPE_ARRAY: {
                const array = new Il2CppArrayType(pointer(data));
                name = nested(array.elementType) + "[" + ",".repeat(Math.max(0, array.rank - 1)) + "]";
                break;
            }
            case Il2CppTypeEnum.IL2CPP_TYPE_GENERICINST: {
                const generic = new Il2CppGenericClass(pointer(data));
                const definition = generic.definition.klass.fullName.replace(/`\d+$/, "");
                name = definition + "<" + generic.instance.arguments.map(nested).join(", ") + ">";
                break;
            }
            case Il2CppTypeEnum.IL2CPP_TYPE_VAR:
            case Il2CppTypeEnum.IL2CPP_TYPE_MVAR:
                name = (tag === Il2CppTypeEnum.IL2CPP_TYPE_VAR ? "!" : "!!") + this.handle.readPointer();
                break;
        }
        name ??= "<type:" + tag + " data:0x" + data.toString(16) + ">";
        if (this.isByReference) name += "&";
        names.set(key, name);
        return name;
    }
}
