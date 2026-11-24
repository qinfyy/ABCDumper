import { Il2CppTypeEnum } from "../constant.js";
import { Il2CppClass } from "../structs/class.js";
import { Il2CppType } from "../structs/type.js";
import { readScalar } from "../structs/value.js";

// System.Enum
export class ManagedEnum {
    constructor(readonly klass: Il2CppClass) {
        if (klass.kind !== "enum") throw new Error("Not an enum: " + klass.fullName);
    }

    get underlyingType(): Il2CppType {
        const type = Array.from(this.klass.fields()).find(field => !field.isStatic && !field.isLiteral)?.type;
        if (!type || ![Il2CppTypeEnum.IL2CPP_TYPE_I1, Il2CppTypeEnum.IL2CPP_TYPE_U1, Il2CppTypeEnum.IL2CPP_TYPE_I2,
            Il2CppTypeEnum.IL2CPP_TYPE_U2, Il2CppTypeEnum.IL2CPP_TYPE_I4, Il2CppTypeEnum.IL2CPP_TYPE_U4,
            Il2CppTypeEnum.IL2CPP_TYPE_I8, Il2CppTypeEnum.IL2CPP_TYPE_U8].includes(type.tag)) throw new Error("Unsupported enum storage: " + this.klass.type.name);
        return type;
    }

    get values(): { name: string; value: number | string }[] {
        const type = this.underlyingType;
        return Array.from(this.klass.fields()).filter(field => field.isLiteral).map(field => ({
            name: field.name, value: readScalar(field.literalValue().data, type.tag) as number | string
        }));
    }
}
