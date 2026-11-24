import { ManagedEnum } from "../../il2cpp/manage/enum.js";
import { ManagedInvokeError } from "../../il2cpp/structs/method.js";
import { Il2CppObject } from "../../il2cpp/structs/object.js";
import { Il2CppString } from "../../il2cpp/structs/string.js";
import { ProtoMember } from "../fields.js";
import { ProtoMessageType } from "../message.js";
import { ProtoRuntime } from "../runtime.js";
import { inlineSchema, ProtoField, ProtoType } from "../schema.js";
import { encode, WireField, WireReader } from "../wire.js";
import { MergeProbe } from "./merge-probes.js";
import { MessageSample } from "./samples.js";

export interface MergeObservation {
    member: ProtoMember;
    discriminator?: ProtoMember;
    bits?: bigint;
    entry?: Pick<ProtoField, "type" | "keyNumber">;
}

export class MergeObserver {
    private readonly errors = new Set<string>();
    private readonly caseNumbers = new Map<ProtoMember, Set<number>>();

    constructor(private readonly type: ProtoMessageType, private readonly runtime: ProtoRuntime) {}

    get diagnostics(): string[] | undefined {
        return this.errors.size ? ["MergeFrom native error for tags: " + [...this.errors].slice(0, 12).join(", ")] : undefined;
    }

    confirm(number: number): void {
        for (const wire of [0, 1, 2, 5]) this.errors.delete(number + "/" + wire);
    }

    baseSegment(): ProtoField | undefined {
        // 0x4DE31CD calls the base reader with the same reference slot inside tag 1.
        if (this.type.codecs.reader?.rva !== "0x4de3170") return undefined;
        const parent = this.type.parent;
        if (!parent || parent.fullName !== "F2B222B133F8128E") return undefined;
        const type = ProtoType.from(parent.type), member = new ProtoMessageType(parent.handle).layout.ordinary
            .find(member => member.field.name === "B24A01A51AEAED87" && member.type.name === "string");
        if (!type || !member) return undefined;
        const textValue = [65, 66], sample = MessageSample.create(this.type);
        try {
            const address = member.address(sample), before = address.readPointer();
            if (!sample.merge(this.runtime, encode(1, 2, encode(1, 2, textValue)))) return undefined;
            const after = address.readPointer();
            if (after.isNull() || after.equals(before) || new Il2CppString(after).read() !== String.fromCharCode(...textValue)) return undefined;
            return { name: parent.name, type, number: 1, offset: member.field.offset, baseSegment: true };
        } finally { sample.close(); }
    }

    read(number: number, probe: MergeProbe): MergeObservation | undefined {
        const sample = MessageSample.create(this.type);
        try {
            sample.primeMergeDefaults();
            sample.capture();
            try {
                const merge = () => sample.merge(this.runtime, encode(number, probe.wire, probe.payload));
                const read = probe.typePrefixed ? () => this.runtime.typePrefixed(merge) : merge;
                if (!(probe.derivedKey ? this.runtime.derivedKey(read) : read())) return undefined;
            }
            catch (error) {
                if (error instanceof ManagedInvokeError) return undefined;
                // Some managed exceptions escape the native wrapper without filling its exception slot.
                if (String(error) !== "Error: system error") throw error;
                this.errors.add(number + "/" + probe.wire);
                return undefined;
            }
            const changed = sample.changedMembers();
            // Read branches can populate a typed slot and its nested enum discriminator together.
            const cases = changed.length === 2 ? changed.filter(member => this.isDiscriminator(member, sample, number)) : [];
            if (changed.length !== 1 && cases.length !== 1) return undefined;
            const discriminator = cases[0], member = changed.find(member => member !== discriminator)!;
            if (discriminator && (member.type.element || member.type.name === "object") ||
                probe.category === member.type.managed && !member.matchesInline(sample, probe.payload)) return undefined;
            if (member.type.key) {
                if (probe.derivedKey) return { member, entry: { type: probe.typePrefixed ?
                    member.type.asDerivedValues().asBytes() : member.type.asDerivedValues() } };
                const entry = probe.category === "map" ? member.matchEntry(sample, probe.payload,
                    (type, address, field) => this.matchEntryValue(type, address, field, !!probe.typePrefixed)) : undefined;
                return entry && { member, entry };
            }
            const scalar = member.type.element ?? member.type;
            return { member, discriminator, bits: scalar.scalar ? member.observed(sample) : undefined };
        } finally { sample.close(); }
    }

    private matchEntryValue(type: ProtoType, address: NativePointer, field: WireField, typePrefixed: boolean): ProtoType | undefined {
        if (typePrefixed) return type.klass?.kind === "class" && field.wire === 2 && field.payload.length === 1 &&
            !address.readPointer().isNull() ? type.asBytes() : undefined;
        // 0.75.2: the conversion callbacks at 0x50A9BD0 and 0x50A5960 preserve the first string at +0.
        if ((type.managed === "ABC.Config.WwiseState" || type.managed === "ABC.Config.WwiseEvent") && field.wire === 2) {
            let fields: WireField[];
            try { fields = new WireReader(field.payload).read(); }
            catch { return undefined; }
            const handle = address.readPointer();
            if (fields.length === 1 && fields[0].number === 1 && fields[0].wire === 2 && !handle.isNull() &&
                new Il2CppString(handle).read() === String.fromCharCode(...fields[0].payload)) return type;
            return undefined;
        }
        const direct = type.matchEntryValue(address, field), klass = type.klass;
        if (direct || inlineSchema(type) || field.wire !== 2 || klass?.kind !== "struct" || type.isWireAlias) return direct;
        const childType = new ProtoMessageType(klass.handle), layout = childType.layout;
        if (!childType.codecs.reader || layout.unsupported.length || !layout.members.length || layout.members.some(member => !member.type.scalar)) return;
        const child = MessageSample.create(childType);
        try {
            child.capture();
            if (!child.merge(this.runtime, field.payload) || !child.changedMembers().length) return;
            return layout.members.every(member => member.observed(child) ===
                member.type.readBits(address.add(member.field.offset - Il2CppObject.headerSize))) ? type : undefined;
        } catch (error) {
            if (!(error instanceof ManagedInvokeError) && String(error) !== "Error: system error") throw error;
        } finally { child.close(); }
    }

    private isDiscriminator(member: ProtoMember, sample: MessageSample, number: number): boolean {
        const klass = member.type.klass;
        if (klass?.kind !== "enum" || !klass.declaringClass?.handle.equals(this.type.handle) ||
            member.observed(sample) !== BigInt(number)) return false;
        let values = this.caseNumbers.get(member);
        if (!values) {
            values = new Set(new ManagedEnum(klass).values.map(value => Number(value.value)));
            this.caseNumbers.set(member, values);
        }
        return values.has(0) && values.has(number);
    }
}
