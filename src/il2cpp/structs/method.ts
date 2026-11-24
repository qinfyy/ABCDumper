import { api } from "../api.js";
import { base, target } from "../addresses.js";
import { NativeStruct, text } from "../memory.js";
import { Il2CppType } from "./type.js";
import { METHOD_ATTRIBUTE_STATIC } from "../constant.js";
import { Il2CppObject } from "./object.js";

export class Il2CppParameter {
    constructor(readonly method: NativePointer, readonly index: number) {}
    get type(): Il2CppType { return new Il2CppType(api["il2cpp_method_get_param"](this.method, this.index)); }
    get name(): string { return text(api["il2cpp_method_get_param_name"](this.method, this.index)); }
    summary() { return { name: this.name, type: this.type.name, flags: this.type.attributes }; }
}

export class Il2CppMethod extends NativeStruct {
    get name(): string { return text(api.il2cpp_method_get_name(this.handle)); }
    get klass(): NativePointer { return api.il2cpp_method_get_class(this.handle); }
    get body(): NativePointer { return this.handle.add(0x10).readPointer(); }
    get invoker(): NativePointer { return this.handle.readPointer(); }
    get flags(): number { return this.handle.add(0x32).readU16(); }
    get isStatic(): boolean { return (this.flags & METHOD_ATTRIBUTE_STATIC) !== 0; }
    get implementationFlags(): number { return this.handle.add(0x34).readU16(); }
    get slot(): number { return this.handle.add(0x30).readU16(); }
    get parameterCount(): number { return api.il2cpp_method_get_param_count(this.handle); }
    get returnType(): Il2CppType { return new Il2CppType(api.il2cpp_method_get_return_type(this.handle)); }
    get rva(): string | null {
        const body = this.body;
        return body.isNull() || body.compare(base) < 0 || body.compare(base.add(target.size)) >= 0 ? null : body.sub(base).toString();
    }
    get parameters(): Il2CppParameter[] {
        return Array.from({ length: this.parameterCount }, (_, i) => new Il2CppParameter(this.handle, i));
    }

    summary() {
        return {
            method: this.toString(), name: this.name, returnType: this.returnType.name,
            parameters: this.parameters.map(parameter => parameter.summary()), flags: this.flags,
            implementationFlags: this.implementationFlags, body: this.body.toString(), rva: this.rva, invoker: this.invoker.toString()
        };
    }
}

export class ManagedInvokeError extends Error {}

// Reuse native parameter slots for synchronous probes; arguments are already marshalled pointers.
export class Il2CppMethodBinding {
    private readonly parameters: NativePointer;
    private readonly exception = Memory.alloc(Process.pointerSize);

    constructor(readonly method: Il2CppMethod, readonly object: NativePointer) {
        this.parameters = method.parameterCount ? Memory.alloc(method.parameterCount * Process.pointerSize) : NULL;
    }

    invoke(args: NativePointer[] = []): NativePointer {
        if (args.length !== this.method.parameterCount) throw new Error("Wrong method argument count");
        if (!this.method.rva || this.method.invoker.isNull()) throw new Error("Method has no callable invoker: " + this.method.name);
        args.forEach((arg, i) => this.parameters.add(i * Process.pointerSize).writePointer(arg));
        this.exception.writePointer(NULL);
        const result = api.il2cpp_runtime_invoke(this.method.handle, this.object, this.parameters, this.exception);
        const exception = this.exception.readPointer();
        if (!exception.isNull()) throw new ManagedInvokeError(new Il2CppObject(exception).klass.fullName + " in " + this.method.name);
        return result;
    }
}
