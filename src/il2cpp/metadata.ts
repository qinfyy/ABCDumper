import { api } from "./api.js";
import { Il2CppGenericInst } from "./structs/generic.js";

export function classFullName(klass: NativePointer, depth = 0): string {
    if (depth > 32) throw new Error("Invalid declaring class chain");
    const name = api["il2cpp_class_get_name"](klass);
    const outer = klass.add(0x38).readPointer();
    if (!outer.isNull()) return classFullName(outer, depth + 1) + "." + name;
    const namespace = api["il2cpp_class_get_namespace"](klass);
    return namespace ? namespace + "." + name : name;
}

// ABC 0.75.2: Il2CppGenericClass carries the definition type and class instance at +0/+8.
export function genericInstance(generic: NativePointer): { name: string; arguments: NativePointer[] } {
    const definition = generic.readPointer(), instance = generic.add(8).readPointer();
    if (definition.isNull() || instance.isNull()) throw new Error("Incomplete generic class");
    const klass = api["il2cpp_class_from_type"](definition);
    if (klass.isNull()) throw new Error("Invalid generic type definition");
    return {
        name: classFullName(klass).replace(/`\d+$/, ""),
        arguments: new Il2CppGenericInst(instance).arguments.map(type => type.handle)
    };
}
