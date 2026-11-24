import { Il2CppClass } from "../il2cpp/structs/class.js";
import { gpbConstant } from "./constant.js";
import { NativeProtoMethod } from "./native.js";
import type { ProtoMethodRvas } from "./schema.js";

export class MessageCodecs {
    readonly declaredMerge: NativeProtoMethod | null = null;
    readonly declaredWrite: NativeProtoMethod | null = null;

    constructor(klass: Il2CppClass) {
        for (const method of klass.methods()) {
            if (!method.isStatic || method.parameterCount !== 2) continue;
            const name = method.name, merge = name === gpbConstant.methods.mergeFrom;
            if (!merge && name !== gpbConstant.methods.writeTo || method.returnType.name !== "void") continue;
            const [stream, message] = method.parameters.map(parameter => parameter.type);
            if (stream.name !== (merge ? gpbConstant.input : gpbConstant.output) + "&" || message.isByReference !== merge ||
                !message.klass.handle.equals(klass.handle)) continue;
            const codec = new NativeProtoMethod(method.handle);
            if (merge) this.declaredMerge = codec;
            else this.declaredWrite = codec;
        }
    }

    get reader(): NativeProtoMethod | null { return this.declaredMerge?.usable ? this.declaredMerge : null; }
    get writer(): NativeProtoMethod | null { return this.declaredWrite?.usable ? this.declaredWrite : null; }
    get rvas(): ProtoMethodRvas { return { mergeFrom: this.declaredMerge?.rva ?? null, writeTo: this.declaredWrite?.rva ?? null }; }
}
