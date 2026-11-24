import { Il2CppTypeEnum, TYPE_ATTRIBUTE_ABSTRACT } from "../il2cpp/constant.js";
import { Il2CppClass } from "../il2cpp/structs/class.js";
import { Il2CppType } from "../il2cpp/structs/type.js";
import { gpbConstant } from "./constant.js";
import { MessageFields } from "./fields.js";
import { MessageCodecs } from "./methods.js";
import { NativeProtoMethod } from "./native.js";
import { ProtoMessage, schemaName } from "./schema.js";

export class ProtoMessageType extends Il2CppClass {
    private fieldLayout?: MessageFields;
    private methodLayout?: MessageCodecs;

    constructor(handle: NativePointer, readonly index?: number) { super(handle); }

    get protobufName(): string { return schemaName(this); }
    get layout(): MessageFields { return this.fieldLayout ??= new MessageFields(this); }
    get codecs(): MessageCodecs { return this.methodLayout ??= new MessageCodecs(this); }
    get isMessage(): boolean {
        const kind = this.kind;
        return (kind === "class" || kind === "struct") && !(this.flags & TYPE_ATTRIBUTE_ABSTRACT) && this.hasCodec;
    }

    private get hasCodec(): boolean {
        return this.codecs.declaredMerge !== null || this.codecs.declaredWrite !== null;
    }

    summary(index = this.index) { return super.summary(index); }

    message(mode: ProtoMessage["mode"]): ProtoMessage {
        return { name: this.protobufName, mode, fields: [], unresolved: [], methods: this.codecs.rvas };
    }

    describe(instructions = false) {
        const describe = (method: NativeProtoMethod | null) => method ? {
            ...method.summary(), declared: method.klass.equals(this.handle), native: method.inspect(instructions)
        } : null;
        return {
            name: this.fullName, klass: this.toString(), isMessage: this.isMessage,
            parent: this.parent?.fullName, interfaces: this.interfaces.map(type => type.name),
            mergeFrom: describe(this.codecs.declaredMerge), writeTo: describe(this.codecs.declaredWrite),
            fields: Array.from(this.fields()).filter(field => !field.isStatic && !field.isLiteral).map(field =>
                ({ ...field.summary(), protobufKind: this.fieldKind(field.type) })),
            methods: Array.from(this.methods()).map(method => ({ ...method.summary(), native: new NativeProtoMethod(method.handle).inspect(instructions) }))
        };
    }

    private fieldKind(type: Il2CppType): string {
        if (type.name === gpbConstant.byteString) return "bytes";
        if (type.tag === Il2CppTypeEnum.IL2CPP_TYPE_VALUETYPE || type.tag === Il2CppTypeEnum.IL2CPP_TYPE_CLASS) {
            const klass = type.klass;
            return klass.kind === "enum" ? "enum" : new ProtoMessageType(klass.handle).isMessage ? "message" : "unknown";
        }
        if ([Il2CppTypeEnum.IL2CPP_TYPE_BOOLEAN, Il2CppTypeEnum.IL2CPP_TYPE_I4, Il2CppTypeEnum.IL2CPP_TYPE_U4,
            Il2CppTypeEnum.IL2CPP_TYPE_I8, Il2CppTypeEnum.IL2CPP_TYPE_U8, Il2CppTypeEnum.IL2CPP_TYPE_R4,
            Il2CppTypeEnum.IL2CPP_TYPE_R8, Il2CppTypeEnum.IL2CPP_TYPE_STRING].includes(type.tag)) return "scalar";
        if (type.tag === Il2CppTypeEnum.IL2CPP_TYPE_GENERICINST && type.name.startsWith(gpbConstant.list + "<")) return "list";
        return "unknown";
    }
}
