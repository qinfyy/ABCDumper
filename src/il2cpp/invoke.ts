import { api } from "./api.js";
import { ClassSelector, resolveClass } from "./core.js";
import { Il2CppMethod } from "./structs/method.js";
import { Il2CppObject } from "./structs/object.js";
import { Il2CppString } from "./structs/string.js";
import { readScalar, ScalarType, scalarTags, writeScalar } from "./structs/value.js";

export type Argument = NativePointerValue | null | { type: ScalarType; value: number | string | boolean };
export type MethodSelector = NativePointerValue | ClassSelector;

function argument(value: Argument | undefined, allocations: NativePointer[]): NativePointerValue {
    if (value === null || value === undefined) return NULL;
    if (typeof value !== "object" || !("type" in value)) return value;
    const p = Memory.alloc(8);
    allocations.push(p);
    writeScalar(p, value.type, value.value);
    return p;
}

function unbox(result: NativePointer, type: string): number | string | boolean | undefined {
    if (type === "string") return new Il2CppString(result).read();
    const tag = scalarTags[type as ScalarType];
    return tag === undefined ? undefined : readScalar(new Il2CppObject(result).data, tag);
}

export function invoke(method?: MethodSelector | null, methodName?: string | null, arity?: number | null, parameterTypes?: string[] | null, object?: Argument, args?: Argument[] | null) {
    let selected: Il2CppMethod;
    if (method === undefined || method === null) throw new Error("Provide a method pointer or class selector");
    if (typeof method !== "object" || "handle" in method || "isNull" in method) {
        selected = new Il2CppMethod(typeof method !== "object" ? ptr(method) : "handle" in method ? method.handle : method);
    } else {
        const candidates = Array.from(resolveClass(method).methods()).filter(candidate =>
            candidate.name === methodName && (arity == null || candidate.parameterCount === arity) &&
            (!parameterTypes || JSON.stringify(candidate.parameters.map(p => p.type.name)) === JSON.stringify(parameterTypes)));
        if (candidates.length !== 1) throw new Error("Specify method pointer or an unambiguous methodName + parameterTypes");
        selected = candidates[0];
    }
    const values = args ?? [];
    if (values.length !== selected.parameterCount) throw new Error("Wrong method argument count");
    if (!selected.rva || selected.invoker.isNull()) throw new Error("Method has no callable invoker: " + selected.name);
    const allocations: NativePointer[] = [];
    const params = values.length ? Memory.alloc(values.length * 8) : NULL;
    values.forEach((arg, i) => params.add(i * 8).writePointer(argument(arg, allocations)));
    const exception = Memory.alloc(8);
    exception.writePointer(NULL);
    // The embedding API expects unboxed this for value types; it applies the object-header adjustment.
    const instance = argument(object, allocations);
    const result = api.il2cpp_runtime_invoke(selected.handle, instance, params, exception);
    const error = exception.readPointer();
    const type = selected.returnType.name;
    const value = result.isNull() || !error.isNull() ? undefined : unbox(result, type);
    allocations.length = 0;
    return { method: selected.toString(), returnType: type, object: result.toString(), exception: error.toString(), value };
}
