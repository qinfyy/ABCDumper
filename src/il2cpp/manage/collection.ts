import { ObjectScope } from "../objects.js";
import { Il2CppArray, checkedLength } from "../structs/array.js";
import { Il2CppTypeEnum } from "../constant.js";
import { Il2CppMethod } from "../structs/method.js";
import { ManagedObject, ManagedResult } from "./object.js";

// System.Collections.ICollection / System.Collections.Generic.ICollection<T>
export class ManagedCollection extends ManagedObject {
    get count(): number {
        const tag = this.klass.type.tag;
        if (tag === Il2CppTypeEnum.IL2CPP_TYPE_ARRAY || tag === Il2CppTypeEnum.IL2CPP_TYPE_SZARRAY) return new Il2CppArray(this.handle).length;
        const value = this.invoke("get_Count").value;
        if (typeof value !== "number") throw new Error("Invalid collection count type");
        return checkedLength(value);
    }

    enumerator(scope: ObjectScope): ManagedEnumerator {
        const object = this.invoke("GetEnumerator", [], scope).pointer;
        if (object.isNull()) throw new Error("Collection enumerator is null");
        return new ManagedEnumerator(object);
    }
}

// System.Collections.IEnumerator / System.Collections.Generic.IEnumerator<T>
export class ManagedEnumerator extends ManagedObject {
    readonly currentMethod: Il2CppMethod;
    private readonly move: Il2CppMethod;
    private readonly dispose?: Il2CppMethod;
    private closed = false;

    constructor(handle: NativePointer) {
        super(handle);
        this.dispose = this.klass.findMethod("Dispose", { parameterCount: 0, inherited: true, isStatic: false, native: true, explicit: true });
        try {
            this.move = this.method("MoveNext");
            // Prefer the typed getter over IEnumerator.Current, including explicit interface implementations.
            this.currentMethod = Array.from(this.klass.hierarchy()).flatMap(klass => Array.from(klass.methods())).find(method =>
                (method.name === "get_Current" || method.name.endsWith(".get_Current")) && !method.isStatic &&
                !method.parameterCount && !method.body.isNull() && method.returnType.tag !== Il2CppTypeEnum.IL2CPP_TYPE_OBJECT) ?? this.method("get_Current");
        } catch (error) {
            try { this.close(); }
            catch (cleanup) { throw new Error(String(error) + "; Enumerator cleanup failed: " + String(cleanup)); }
            throw error;
        }
    }

    moveNext(): boolean {
        if (this.closed) throw new Error("Enumerator is closed");
        const value = this.invoke(this.move).value;
        if (typeof value !== "boolean") throw new Error("MoveNext did not return bool");
        return value;
    }

    current(scope: ObjectScope): ManagedResult {
        if (this.closed) throw new Error("Enumerator is closed");
        return this.invoke(this.currentMethod, [], scope);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        if (this.dispose) this.invoke(this.dispose);
    }
}
