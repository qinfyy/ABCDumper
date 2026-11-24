import { api } from "./api.js";
import { resolveClass } from "./core.js";
import { Argument, invoke } from "./invoke.js";
import { Il2CppClass } from "./structs/class.js";
import { Il2CppMethod } from "./structs/method.js";
import { Il2CppObject } from "./structs/object.js";
import { checkedLength, Il2CppArray } from "./structs/array.js";

export function call(method: Il2CppMethod, object: NativePointer = NULL, args: Argument[] = []): NativePointer {
    const result = invoke(method.handle, null, null, null, object, args);
    if (result.exception !== "0x0") {
        const exception = ptr(result.exception);
        throw new Error(new Il2CppObject(exception).klass.fullName + " in " + method.name);
    }
    return ptr(result.object);
}

export function findMethod(klass: Il2CppClass, name: string, types: string[]): Il2CppMethod {
    const method = klass.findMethod(name, { parameterTypes: types });
    if (!method) throw new Error(klass.fullName + "::" + name + "(" + types.join(",") + ") not found");
    return method;
}

export class ObjectScope {
    private handles: number[] = [];

    root(object: NativePointer): NativePointer {
        if (object.isNull()) throw new Error("Managed allocation returned null");
        const handle = api.il2cpp_gchandle_new(object, 1);
        if (!handle) throw new Error("Managed pin failed");
        this.handles.push(handle);
        return object;
    }

    create(klass: Il2CppClass, args: Argument[] = [], types: string[] = []): NativePointer {
        const object = this.allocate(klass).handle;
        call(findMethod(klass, ".ctor", types), object, args);
        return object;
    }

    allocate(klass: Il2CppClass): Il2CppObject {
        return new Il2CppObject(this.root(api["il2cpp::vm::Object::New"](klass.handle)));
    }

    array(elementClass: Il2CppClass, length: number): Il2CppArray {
        checkedLength(length);
        return new Il2CppArray(this.root(api.il2cpp_array_new(elementClass.handle, length)));
    }

    bytes(length: number): NativePointer {
        byteClass ??= resolveClass({ image: "mscorlib.dll", name: "System.Byte" });
        return this.array(byteClass, length).handle;
    }

    close(): void {
        for (const handle of this.handles.splice(0)) api.il2cpp_gchandle_free(handle);
    }
}

let byteClass: Il2CppClass | undefined;
let exchange: Il2CppMethod | undefined;

export function setReference(address: NativePointer, value: NativePointer): void {
    exchange ??= findMethod(resolveClass({ image: "mscorlib.dll", name: "System.Threading.Interlocked" }), "Exchange", ["object&", "object"]);
    call(exchange, NULL, [address, value]);
}
