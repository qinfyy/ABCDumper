import { Il2CppClass } from "../il2cpp/structs/class.js";
import { Il2CppField } from "../il2cpp/structs/field.js";
import { Il2CppObject } from "../il2cpp/structs/object.js";
import { ProtoCollection } from "./collections.js";
import { inlineSchema, ProtoField, ProtoType } from "./schema.js";
import { WireField, WireReader } from "./wire.js";

export class ProtoMember {
    private readonly valueSize?: number;

    constructor(readonly field: Il2CppField, readonly type: ProtoType) {
        if (inlineSchema(type) || type.klass?.kind === "struct") {
            const header = Il2CppObject.headerSize, size = type.klass!.instanceSize - header;
            if (field.offset < header || size <= 0 || field.offset + size > new Il2CppClass(field.parent).instanceSize) {
                throw new Error("Invalid inline field bounds: " + field.name);
            }
            // Inflated optional wrappers can report pointer-sized storage, but are inline.
            this.valueSize = size;
        }
    }

    address(object: Il2CppObject): NativePointer {
        return this.valueSize === undefined ? this.field.address(object.handle) : object.handle.add(this.field.offset);
    }

    snapshot(object: Il2CppObject): string {
        const address = this.address(object);
        if (this.type.element) {
            const collection = address.readPointer();
            return collection.isNull() ? "0" : String(new ProtoCollection(collection).count);
        }
        if (this.valueSize !== undefined) return String(new Uint8Array(address.readByteArray(this.valueSize)!));
        return this.type.scalar ? this.type.readBits(address).toString() : address.readPointer().toString();
    }

    observed(object: Il2CppObject): bigint | undefined {
        const address = this.address(object);
        if (this.type.repeated) {
            const collection = address.readPointer(), element = this.type.element!;
            return collection.isNull() || !element.scalar ? undefined : new ProtoCollection(collection).lastBits(element);
        }
        if (this.type.key || ["bytes", "string", "object"].includes(this.type.name) || this.type.klass?.kind === "class") return undefined;
        return this.type.readBits(address);
    }

    matchesInline(object: Il2CppObject, payload: number[]): boolean {
        return !inlineSchema(this.type) || this.type.matchesInline(this.address(object), new WireReader(payload).read());
    }

    matchEntry(object: Il2CppObject, payload: number[], matchValue?: (type: ProtoType, address: NativePointer,
        field: WireField) => ProtoType | undefined): Pick<ProtoField, "type" | "keyNumber"> | undefined {
        const handle = this.address(object).readPointer();
        if (handle.isNull() || !this.type.key) return undefined;
        const slots = new ProtoCollection(handle).singleEntry(this.type);
        if (!slots) return undefined;
        const fields = new WireReader(payload).read();
        const first = fields.find(field => field.number === 1), second = fields.find(field => field.number === 2);
        if (fields.length !== 2 || !first || !second) return undefined;
        const matches = ([1, 2] as const).flatMap(keyNumber => {
            const [keyField, valueField] = keyNumber === 1 ? [first, second] : [second, first];
            const key = this.type.key!.matchEntryValue(slots.key, keyField);
            if (!key) return [];
            const valueType = this.type.element!;
            const value = matchValue ? matchValue(valueType, slots.value, valueField) : valueType.matchEntryValue(slots.value, valueField);
            return value ? [{ keyNumber, type: this.type.withEntry(key, value) }] : [];
        });
        return matches.length === 1 ? matches[0] : undefined;
    }
}

export class MessageFields {
    readonly members: ProtoMember[];
    readonly storage: ProtoMember[];
    readonly cases: ProtoMember[];
    readonly ordinary: ProtoMember[];
    readonly unsupported: string[];

    constructor(klass: Il2CppClass) {
        this.unsupported = [];
        this.members = Array.from(klass.fields()).filter(field => !field.isStatic && !field.isLiteral).flatMap(field => {
            const type = ProtoType.from(field.type);
            if (type && field.offset >= Il2CppObject.headerSize) {
                try { return [new ProtoMember(field, type)]; }
                catch (error) {
                    this.unsupported.push(field.name + ": " + String(error));
                    return [];
                }
            }
            this.unsupported.push(field.name);
            return [];
        });
        this.storage = this.members.filter(member => member.type.name === "object");
        this.cases = this.storage.length ? this.members.filter(member => member.type.klass?.kind === "enum" &&
            member.type.klass.declaringClass?.handle.equals(klass.handle)) : [];
        this.ordinary = this.members.filter(member => !this.storage.includes(member) && !this.cases.includes(member));
    }

}
