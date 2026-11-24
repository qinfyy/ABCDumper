import { Il2CppTypeEnum } from "../constant.js";

export type ScalarType = "bool" | "char" | "byte" | "sbyte" | "short" | "ushort" | "int" | "uint" | "long" | "ulong" | "float" | "double";
export type ScalarValue = boolean | number | string;

export const scalarTags: Record<ScalarType, Il2CppTypeEnum> = {
    bool: Il2CppTypeEnum.IL2CPP_TYPE_BOOLEAN, char: Il2CppTypeEnum.IL2CPP_TYPE_CHAR,
    byte: Il2CppTypeEnum.IL2CPP_TYPE_U1, sbyte: Il2CppTypeEnum.IL2CPP_TYPE_I1,
    short: Il2CppTypeEnum.IL2CPP_TYPE_I2, ushort: Il2CppTypeEnum.IL2CPP_TYPE_U2,
    int: Il2CppTypeEnum.IL2CPP_TYPE_I4, uint: Il2CppTypeEnum.IL2CPP_TYPE_U4,
    long: Il2CppTypeEnum.IL2CPP_TYPE_I8, ulong: Il2CppTypeEnum.IL2CPP_TYPE_U8,
    float: Il2CppTypeEnum.IL2CPP_TYPE_R4, double: Il2CppTypeEnum.IL2CPP_TYPE_R8
};

export function readScalar(address: NativePointer, tag: number): ScalarValue | undefined {
    switch (tag) {
        case Il2CppTypeEnum.IL2CPP_TYPE_BOOLEAN: return Boolean(address.readU8());
        case Il2CppTypeEnum.IL2CPP_TYPE_CHAR: case Il2CppTypeEnum.IL2CPP_TYPE_U2: return address.readU16();
        case Il2CppTypeEnum.IL2CPP_TYPE_I1: return address.readS8();
        case Il2CppTypeEnum.IL2CPP_TYPE_U1: return address.readU8();
        case Il2CppTypeEnum.IL2CPP_TYPE_I2: return address.readS16();
        case Il2CppTypeEnum.IL2CPP_TYPE_I4: return address.readS32();
        case Il2CppTypeEnum.IL2CPP_TYPE_U4: return address.readU32();
        case Il2CppTypeEnum.IL2CPP_TYPE_I8: return address.readS64().toString();
        case Il2CppTypeEnum.IL2CPP_TYPE_U8: return address.readU64().toString();
        case Il2CppTypeEnum.IL2CPP_TYPE_R4: return address.readFloat();
        case Il2CppTypeEnum.IL2CPP_TYPE_R8: return address.readDouble();
    }
}

export function writeScalar(address: NativePointer, type: ScalarType, value: ScalarValue): void {
    switch (type) {
        case "bool": address.writeU8(Number(Boolean(value))); break;
        case "byte": address.writeU8(Number(value)); break;
        case "sbyte": address.writeS8(Number(value)); break;
        case "short": address.writeS16(Number(value)); break;
        case "char": case "ushort": address.writeU16(Number(value)); break;
        case "int": address.writeS32(Number(value)); break;
        case "uint": address.writeU32(Number(value)); break;
        case "long": address.writeS64(int64(String(value))); break;
        case "ulong": address.writeU64(uint64(String(value))); break;
        case "float": address.writeFloat(Number(value)); break;
        case "double": address.writeDouble(Number(value)); break;
        default: throw new Error("Unsupported scalar " + type);
    }
}
