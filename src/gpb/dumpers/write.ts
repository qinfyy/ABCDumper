import { ProtoMember } from "../fields.js";
import { ManagedEnum } from "../../il2cpp/manage/enum.js";
import { ProtoMessageType } from "../message.js";
import { ProtoRuntime } from "../runtime.js";
import { ProtoField, ProtoMessage } from "../schema.js";
import { WireField } from "../wire.js";
import { MessageSample } from "./samples.js";

function byNumber(fields: WireField[]): Map<number, WireField[]> {
    const groups = new Map<number, WireField[]>();
    for (const field of fields) {
        const group = groups.get(field.number);
        if (group) group.push(field);
        else groups.set(field.number, [field]);
    }
    return groups;
}

export class WriteToRecovery {
    constructor(private readonly type: ProtoMessageType, private readonly runtime: ProtoRuntime) {}

    recover(): ProtoMessage {
        const result = this.type.message("WriteTo"), layout = this.type.layout;
        result.unresolved.push(...layout.unsupported, ...[...layout.storage, ...layout.cases].map(member => member.field.name));
        const fields = new Map<number, ProtoField[]>();
        for (const member of layout.ordinary) {
            try {
                const field = this.probeField(member), group = fields.get(field.number);
                if (group) group.push(field);
                else fields.set(field.number, [field]);
            } catch (error) { result.unresolved.push(member.field.name + ": " + String(error)); }
        }
        for (const group of fields.values()) {
            if (group.length === 1) result.fields.push(group[0]);
            else result.unresolved.push(...group.map(field => field.name + ": shared wire number"));
        }
        const numbers = new Set(result.fields.map(field => field.number));
        const offsets = new Set(this.type.codecs.writer?.inspect()?.fieldOffsets);
        for (const member of layout.ordinary) {
            const { field, type } = member, klass = type.klass;
            if (klass?.kind !== "enum" || !klass.declaringClass?.handle.equals(this.type.handle) || offsets.has(field.offset)) continue;
            const failure = field.name + ": Error: Sample did not isolate one tag";
            if (!result.unresolved.includes(failure)) continue;
            const values = new ManagedEnum(klass).values.map(value => Number(value.value));
            // In these writers the nested cases describe existing tags; the enum slot is not read.
            if (values.length > 1 && values.includes(0) && values.every(value => value === 0 || numbers.has(value))) {
                (result.managedOnly ??= []).push(field.name + ": discriminator is not written as a separate field");
                result.unresolved = result.unresolved.filter(item => item !== failure);
            }
        }
        return result;
    }

    private probeField(member: ProtoMember): ProtoField {
        const type = member.type, scalar = type.element ?? type;
        const first = this.compare(member, 0);
        const { field, bits, entry } = first;
        const packed = type.packable ? field.wire === 2 : undefined;
        const candidates = (packed ? scalar.wireTypes : [field.wire]).filter(wire => scalar.wireTypes.includes(wire));
        if (type.key) {
            if (!entry) throw new Error("Cannot verify the written dictionary entry");
            return { name: member.field.name, number: field.number, offset: member.field.offset, ...entry };
        }
        if (!scalar.scalar) {
            if (field.wire !== 2) throw new Error("Incompatible output wire type");
            return { name: member.field.name, number: field.number, type, offset: member.field.offset };
        }
        if (bits === undefined) throw new Error("Cannot observe the written scalar");
        const models = candidates.flatMap(wire => (wire === 0 && scalar.signed ? [false, true] : [false]).map(zigzag => ({ wire, zigzag })));
        let matches = models.filter(({ wire, zigzag }) => type.outputMatches(field, bits, wire, zigzag));
        let xor: string | undefined;
        if (scalar.integer || !matches.length && scalar.managed !== "bool") {
            const variant = (index: 1 | 2) => {
                const next = this.compare(member, index);
                if (next.field.number !== field.number || next.field.wire !== field.wire || next.bits === undefined) {
                    throw new Error("Writer changed tag or encoding across values");
                }
                return { field: next.field, bits: next.bits };
            };
            const next = variant(1);
            matches = matches.filter(({ wire, zigzag }) => type.outputMatches(next.field, next.bits, wire, zigzag));
            if (!matches.length) {
                const masks = models.flatMap(model => {
                    const { wire, zigzag } = model, mask = type.outputMask(field, bits, wire, zigzag);
                    return mask && mask === type.outputMask(next.field, next.bits, wire, zigzag) ? [{ ...model, mask }] : [];
                });
                if (masks.length) {
                    const last = variant(2);
                    const verified = masks.filter(({ wire, zigzag, mask }) => mask === type.outputMask(last.field, last.bits, wire, zigzag));
                    if (verified.length === 1) {
                        matches = verified;
                        xor = "0x" + verified[0].mask.toString(16).toUpperCase();
                    }
                }
            }
        }
        if (matches.length !== 1) throw new Error("Ambiguous or transformed scalar encoding");
        const { wire, zigzag } = matches[0];
        return { name: member.field.name, number: field.number, type: type.withWire(wire, zigzag), offset: member.field.offset, packed, xor };
    }

    private compare(member: ProtoMember, variant: 0 | 1 | 2): { field: WireField; bits?: bigint; entry?: Pick<ProtoField, "type" | "keyNumber"> } {
        const sample = MessageSample.create(this.type);
        try {
            const before = byNumber(sample.serialize(this.runtime));
            sample.populate(member, variant);
            const after = byNumber(sample.serialize(this.runtime));
            const changed = [...new Set([...before.keys(), ...after.keys()])].filter(number =>
                before.get(number)?.map(field => field.signature).join("\n") !== after.get(number)?.map(field => field.signature).join("\n"));
            const written = after.get(changed[0]);
            if (changed.length !== 1 || written?.length !== 1) throw new Error("Sample did not isolate one tag");
            if (!member.matchesInline(sample, written[0].payload)) throw new Error("Inline payload does not match its managed value");
            if (member.type.key) return { field: written[0], entry: written[0].wire === 2 ? member.matchEntry(sample, written[0].payload) : undefined };
            return { field: written[0], bits: (member.type.element ?? member.type).scalar ? member.observed(sample) : undefined };
        } finally { sample.close(); }
    }
}
