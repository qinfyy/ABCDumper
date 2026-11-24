import { Il2CppTypeEnum } from "../il2cpp/constant.js";
import { ManagedEnum } from "../il2cpp/manage/enum.js";
import { Il2CppClass } from "../il2cpp/structs/class.js";
import { Il2CppArray } from "../il2cpp/structs/array.js";
import { Il2CppString } from "../il2cpp/structs/string.js";
import { Il2CppType } from "../il2cpp/structs/type.js";
import { gpbConstant } from "./constant.js";
import { MessageCodecs } from "./methods.js";
import { fixed, varint, WireField, WireReader } from "./wire.js";

export interface InlineField { name: string; number: number; type: "bool" | "float" | "uint64" | "int64"; offset: number; }

const inlineFields = new Map<string, readonly InlineField[]>([
    ["UnityEngine.Vector2", [{ name: "x", number: 1, type: "float", offset: 0 }, { name: "y", number: 2, type: "float", offset: 4 }]],
    ["UnityEngine.Vector3", [{ name: "x", number: 1, type: "float", offset: 0 }, { name: "y", number: 2, type: "float", offset: 4 },
        { name: "z", number: 3, type: "float", offset: 8 }]],
    ["BAF18DA0E4BA6299", [{ name: "B838E1DDA502EF4C", number: 1, type: "uint64", offset: 0 }]],
    ["EFD1477E276EDDCA", [{ name: "BB8603272DB7D9CE", number: 2, type: "uint64", offset: 0 }]],
    ["E65F515F6EF69401", [{ name: "B52E4FD9ECDC35A6", number: 1, type: "int64", offset: 0 }]],
    ["EF5A916320893736.FBA23C5B3D87626D", [
        { name: "F95F66C60C1921CE", number: 1, type: "float", offset: 0 },
        { name: "AD75FA9CB327D238", number: 2, type: "float", offset: 4 },
        { name: "A76149C7C05DB3C0", number: 3, type: "float", offset: 8 },
        { name: "E83A2850EEA65010", number: 4, type: "float", offset: 12 }]],
    ...(["float", "bool"] as const).map(type => [`E5CF7DED4912707D.B23913127C7295DF<${type}>`, [
        { name: "F3A905468AAB6C8D", number: 1, type: "bool", offset: 0 },
        { name: "F378E1528A6C31A8", number: 2, type, offset: type === "float" ? 4 : 1 }]] as const)
]);

export function inlineSchema(type: ProtoType): readonly InlineField[] | undefined { return inlineFields.get(type.managed); }

// 0.75.2: the native reader parses a wire surrogate before converting to the managed field representation.
const wireAliases = new Map([
    ["EF5A916320893736.B546EED8D77421A7", "B31EF4BAF2BD66C6"], // 0x4C78270, then 0x4C78440
    ["E39C2E654E9898C2", "E3903C2246C9FB25"], // 0x4A55690, then 0x4A55820
    ["ABC.Config.WwiseEvent", "B761E3FAB7979507"], // 0x4F18E10, then 0x4C40EF0
    ["ABC.Config.GUID", "FCA86826C67FA44E"], // 0x57E1040 dispatches to 0x4E8BC20
    ["ABC.Splines.CatmullRom.Spline", "BBC8E29A09B175E6"], // 0x50A3EA0 parses at 0x57E20E0, then converts at 0x4C2D090
    ["ABC.Config.WwiseState", "B70E98D68A8553CE"], // 0x57E1500 dispatches to 0x4CC6ED0
    ["ABC.Config.WwiseSwitch", "FDDEB7B4F1D9A3E7"], // 0x57E1630 dispatches to 0x4FDACF0
    ["A22A28CB2FA81B32", "A73B7A34C961A4EC"], // 0x57E1C20 dispatches to 0x4C62220
    ["F9C2B2206194B4EA", "BA8239ABE73BD9E5"], // 0x57E1890 dispatches to 0x4CAE6D0
    ["ABC.Entity.CommonData", "BF6FB0A69F6EF564"], // 0x57E1760 dispatches to 0x4D32910, converted at 0x4D32A80
    ["ABC.Config.WwiseBank", "A07F4B3800B04543"], // 0x57E12A0 dispatches to 0x4F18250
    ["B9E87DA9C2DF20C8", "BBB31258B5D490EF"], // 0x57E1D50 dispatches to 0x4F338A0
    ["EF5A916320893736.F3092D79E717DE57", "E354C17C5A1CAD36"], // 0x57E2CC0 dispatches to 0x4ACB210
    ["EF5A916320893736.B5CB532D5BCD204E", "A6BD65978413BEAA"], // 0x57E2F20 dispatches to 0x4B33D60
    ["EF5A916320893736.FC8876A71E4BB8EE", "A5F29737FB398F6F"] // 0x57E2A60 dispatches to 0x4A01C10
]);

export class ProtoType {
    constructor(readonly managed: string, readonly name: string, readonly klass?: Il2CppClass,
        readonly repeated?: boolean, readonly key?: ProtoType, readonly element?: ProtoType, readonly bytesClass?: Il2CppClass) {}

    static from(type: Il2CppType): ProtoType | null {
        const managed = type.name;
        if (scalarNames[managed]) return new ProtoType(managed, scalarNames[managed]);
        if (managed === gpbConstant.byteString) return new ProtoType(managed, "bytes", undefined, undefined, undefined, undefined, type.elementType.klass);
        if (managed === "object") return new ProtoType(managed, "object");
        if (inlineFields.has(managed)) {
            const klass = type.klass, generic = managed.indexOf("<");
            const name = schemaName(klass) + (generic === -1 ? "" : "_" + identifier(managed.slice(generic + 1, -1)));
            return new ProtoType(managed, name, klass);
        }
        if (type.tag === Il2CppTypeEnum.IL2CPP_TYPE_VALUETYPE || type.tag === Il2CppTypeEnum.IL2CPP_TYPE_CLASS) {
            const klass = type.klass;
            if (klass.kind === "enum") {
                const enumeration = new ManagedEnum(klass), storage = enumeration.underlyingType.tag;
                return storage === Il2CppTypeEnum.IL2CPP_TYPE_I4 || storage === Il2CppTypeEnum.IL2CPP_TYPE_U4 &&
                    enumeration.values.every(({ value }) => typeof value === "number" && value <= 0x7fffffff) ?
                    new ProtoType(managed, schemaName(klass), klass) : null;
            }
            const alias = wireAliases.get(managed);
            if (alias) return new ProtoType(managed, alias, klass);
            if (klass.kind === "class" || klass.kind === "struct") {
                const codecs = new MessageCodecs(klass);
                if (codecs.declaredMerge || codecs.declaredWrite) return new ProtoType(managed, schemaName(klass), klass);
            }
        }
        if (type.tag === Il2CppTypeEnum.IL2CPP_TYPE_GENERICINST) {
            const container = managed.slice(0, managed.indexOf("<"));
            if (container === gpbConstant.list || container === gpbConstant.pooledList) {
                const [element] = type.genericArguments.map(ProtoType.from);
                if (element && !element.element && element.name !== "object") return new ProtoType(managed, element.name, undefined, true, undefined, element);
            } else if (container === gpbConstant.dictionary) {
                const [managedKey, managedValue] = type.genericArguments;
                const decoded = ProtoType.from(managedKey), value = ProtoType.from(managedValue);
                const key = decoded && (decoded.integer || decoded.name === "bool" || decoded.name === "string" ||
                    inlineSchema(decoded) || decoded.isWireAlias) ? decoded : null;
                // The pair is constructed by the selector, not decoded as a standalone key.
                const derivedPair = managedKey.name.startsWith(gpbConstant.derivedKeyPair + "<");
                if (value && !value.element && value.name !== "object" && (key || derivedPair)) {
                    const keyType = key ?? new ProtoType(managedKey.name, "");
                    return new ProtoType(managed, value.name, undefined, undefined, keyType, value);
                }
            }
        }
        return null;
    }

    get packable(): boolean {
        return !!this.repeated && !!this.element?.scalar;
    }

    get isWireAlias(): boolean { return wireAliases.has(this.managed); }

    get scalar(): boolean {
        return this.klass?.kind === "enum" || ["bool", "int", "uint", "long", "ulong", "float", "double"].includes(this.managed);
    }

    get scalarSize(): number { return this.managed === "bool" ? 1 : ["long", "ulong", "double"].includes(this.managed) ? 8 : 4; }

    readBits(address: NativePointer): bigint {
        if (this.scalarSize === 1) return BigInt(address.readU8());
        if (this.scalarSize === 8) return BigInt(address.readU64().toString());
        return BigInt(address.readU32());
    }

    get signed(): boolean { return this.managed === "int" || this.managed === "long"; }
    get integer(): boolean { return this.signed || this.managed === "uint" || this.managed === "ulong" || this.klass?.kind === "enum"; }

    withWire(wire: number, zigzag = false): ProtoType {
        const scalar = this.element ?? this;
        let name = scalar.name;
        if (scalar.klass || !["int32", "uint32", "int64", "uint64"].includes(name)) return this;
        const bits = name.endsWith("64") ? "64" : "32";
        if (wire === 1 || wire === 5) name = (name.startsWith("int") ? "sfixed" : "fixed") + bits;
        else if (zigzag) name = "sint" + bits;
        return this.renamed(name);
    }

    withEntry(key: ProtoType, value: ProtoType): ProtoType {
        return new ProtoType(this.managed, value.name, undefined, undefined, key, value);
    }

    asBytes(): ProtoType {
        return new ProtoType(this.managed, "bytes", undefined, this.repeated, undefined, this.element?.asBytes());
    }

    asDerivedValues(): ProtoType {
        const value = this.element!;
        return new ProtoType(this.managed, value.name, undefined, true, undefined, value);
    }

    get wireTypes(): readonly number[] {
        if (this.managed === "float") return [5];
        if (this.managed === "double") return [1];
        if (this.klass?.kind === "enum" || this.managed === "bool") return [0];
        if (this.integer) return [0, this.scalarSize === 8 ? 1 : 5];
        return [2];
    }

    outputMatches(field: WireField, bits: bigint, wire: number, zigzag: boolean): boolean {
        const scalar = this.element ?? this;
        const signed = BigInt.asIntN(scalar.scalarSize * 8, bits);
        const encoded = zigzag ? signed < 0n ? -signed * 2n - 1n : signed * 2n :
            scalar.signed || scalar.klass?.kind === "enum" ? signed : bits;
        if (this.packable && field.wire === 2) {
            const expected = wire === 0 ? varint(encoded) : fixed(bits, wire === 1 ? 8 : 4);
            return expected.length === field.payload.length && expected.every((byte, index) => byte === field.payload[index]);
        }
        if (field.wire !== wire) return false;
        return wire === 0 ? field.value === BigInt.asUintN(64, encoded) : field.numeric === bits;
    }

    outputMask(field: WireField, bits: bigint, wire: number, zigzag: boolean): bigint | undefined {
        const raw = field.wire === wire ? field.numeric : this.packable && field.wire === 2 ?
            (wire === 0 ? new WireReader(field.payload).singleVarint() :
                field.payload.length === (wire === 1 ? 8 : 4) ? new WireField(field.number, wire, field.payload).numeric : undefined) : undefined;
        if (raw === undefined) return undefined;
        const value = zigzag ? (raw >> 1n) ^ -(raw & 1n) : raw;
        const mask = bits ^ BigInt.asUintN((this.element ?? this).scalarSize * 8, value);
        return this.outputMatches(field, bits ^ mask, wire, zigzag) ? mask : undefined;
    }

    matchesInline(address: NativePointer, fields: WireField[]): boolean {
        const shape = inlineSchema(this);
        return !!shape && fields.length === shape.length && shape.every(field => {
            const value = fields.find(candidate => candidate.number === field.number);
            const wire = field.type === "float" ? 5 : 0;
            const at = address.add(field.offset);
            const bits = wire === 5 ? BigInt(at.readU32()) : field.type === "bool" ? BigInt(at.readU8()) : BigInt(at.readU64().toString());
            return value?.wire === wire && value.numeric === bits;
        });
    }

    matchEntryValue(address: NativePointer, field: WireField): ProtoType | undefined {
        if (!this.wireTypes.includes(field.wire)) return undefined;
        if (this.scalar) {
            const bits = this.readBits(address);
            const models = field.wire === 0 && this.signed ? [false, true] : [false];
            const matches = models.filter(zigzag => this.outputMatches(field, bits, field.wire, zigzag));
            return matches.length === 1 ? this.withWire(field.wire, matches[0]) : undefined;
        }
        if (inlineSchema(this)) {
            let fields: WireField[];
            try { fields = new WireReader(field.payload).read(); }
            catch { return undefined; }
            return this.matchesInline(address, fields) ? this : undefined;
        }
        if (this.klass?.kind === "struct") return undefined;
        const handle = address.readPointer();
        if (handle.isNull()) return undefined;
        if (this.name === "string") {
            const value = new Il2CppString(handle);
            return value.length === field.payload.length && value.read() === String.fromCharCode(...field.payload) ? this : undefined;
        }
        if (this.bytesClass) {
            const bytes = new Il2CppArray(handle);
            return bytes.length === field.payload.length && new Uint8Array(bytes.readBytes()).every((value, i) => value === field.payload[i]) ? this : undefined;
        }
        return this;
    }

    plain(): unknown {
        return { name: this.name, managed: this.managed, klass: this.klass?.toString(), repeated: this.repeated,
            key: this.key?.plain(), element: this.element?.plain() };
    }

    private renamed(name: string): ProtoType {
        const element = this.element && new ProtoType(this.element.managed, name, this.element.klass);
        return new ProtoType(this.managed, name, this.klass, this.repeated, this.key, element, this.bytesClass);
    }
}

export interface ProtoField {
    name: string;
    number: number;
    type: ProtoType;
    offset: number;
    oneof?: string;
    packed?: boolean;
    xor?: string;
    keyNumber?: 1 | 2;
    typePrefixed?: boolean;
    derivedKey?: boolean;
    baseSegment?: boolean;
}

export interface ProtoMethodRvas {
    mergeFrom: string | null;
    writeTo: string | null;
}

export interface ProtoMessage {
    name: string;
    mode: "MergeFrom" | "WriteTo" | "none";
    methods?: ProtoMethodRvas;
    fields: ProtoField[];
    unresolved: string[];
    managedOnly?: string[];
    diagnostics?: string[];
}

export interface ProtoEnum {
    name: string;
    assembly: string;
    values: { name: string; value: number }[];
}

export function identifier(name: string): string {
    const clean = name.replace(/[^A-Za-z0-9_]/g, "_");
    return /^[A-Za-z_]/.test(clean) ? clean : "_" + clean;
}

export function schemaName(klass: Il2CppClass): string {
    const names = [klass.name];
    for (let parent = klass.declaringClass; parent; parent = parent.declaringClass) names.unshift(parent.name);
    if (klass.namespace) names.unshift(klass.namespace);
    return identifier(names.join("_"));
}

const scalarNames: Record<string, string> = {
    bool: "bool", int: "int32", uint: "uint32", long: "int64", ulong: "uint64",
    float: "float", double: "double", string: "string"
};
