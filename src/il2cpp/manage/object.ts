import { Argument, invoke } from "../invoke.js";
import { ObjectScope } from "../objects.js";
import { MethodQuery } from "../structs/class.js";
import { Il2CppMethod } from "../structs/method.js";
import { Il2CppObject } from "../structs/object.js";
import { ScalarValue } from "../structs/value.js";

export interface ManagedResult { pointer: NativePointer; value: ScalarValue | undefined }

export function callManaged(method: Il2CppMethod, object: NativePointer = NULL, args: Argument[] = [], scope?: ObjectScope): ManagedResult {
    const result = invoke(method.handle, null, null, null, object, args);
    if (result.exception !== "0x0") throw new Error("Managed exception in " + method.name + ": " + result.exception);
    const pointer = ptr(result.object);
    if (scope && result.value === undefined && !pointer.isNull()) scope.root(pointer);
    return { pointer, value: result.value };
}

const methods = new Map<string, Il2CppMethod>();

// System.Object
export class ManagedObject extends Il2CppObject {
    method(name: string, arity = 0, signature?: Pick<MethodQuery, "parameterTypes" | "rva"> & { returnType: string }): Il2CppMethod {
        const klass = this.klass, key = klass.toString() + ":" + name + ":" + arity + ":" + JSON.stringify(signature);
        const cached = methods.get(key);
        if (cached) return cached;
        const query = { parameterCount: arity, inherited: true, isStatic: false, native: true, ...signature };
        const method = klass.findMethod(name, { ...query, rva: undefined, explicit: true }) ??
            (signature?.returnType && klass.findMethod("", query));
        if (!method) throw new Error("Managed method not found: " + klass.fullName + "::" + name + "/" + arity);
        methods.set(key, method);
        return method;
    }

    invoke(method: Il2CppMethod | string, args: Argument[] = [], scope?: ObjectScope): ManagedResult {
        const selected = typeof method === "string" ? this.method(method, args.length) : method;
        return callManaged(selected, selected.isStatic ? NULL : this.receiver, args, scope);
    }
}
