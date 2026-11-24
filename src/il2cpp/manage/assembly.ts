import { ObjectScope } from "../objects.js";
import { addresses } from "../addresses.js";
import { Il2CppArray } from "../structs/array.js";
import { ManagedObject } from "./object.js";
import { ManagedRuntimeType } from "./runtime-type.js";

// A System.Reflection.Assembly object, not the native Il2CppAssembly returned by Domain.
// System.Reflection.Assembly
export class ManagedAssembly extends ManagedObject {
    get fullName(): string {
        const method = this.method("get_FullName", 0, { returnType: "string", rva: addresses.managed["System.Reflection.Assembly::get_FullName"] });
        const value = this.invoke(method).value;
        if (typeof value !== "string") throw new Error("Assembly.FullName did not return string");
        return value;
    }

    types(scope: ObjectScope): ManagedRuntimeType[] {
        const method = this.method("GetTypes", 0, { returnType: "System.Type[]" });
        const result = this.invoke(method, [], scope).pointer;
        if (result.isNull()) throw new Error("Assembly.GetTypes returned null");
        const array = new Il2CppArray(result);
        return Array.from({ length: array.length }, (_, i) => new ManagedRuntimeType(scope.root(array.elementAddress(i).readPointer())));
    }
}
