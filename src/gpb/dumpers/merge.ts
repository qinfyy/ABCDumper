import { ManagedEnum } from "../../il2cpp/manage/enum.js";
import { Il2CppString } from "../../il2cpp/structs/string.js";
import { ManagedInvokeError } from "../../il2cpp/structs/method.js";
import { Il2CppObject } from "../../il2cpp/structs/object.js";
import { ProtoMember } from "../fields.js";
import { ProtoMessageType } from "../message.js";
import { MessageCodecs } from "../methods.js";
import { ProtoRuntime } from "../runtime.js";
import { inlineSchema, ProtoField, ProtoMessage, ProtoType } from "../schema.js";
import { encode, fixed, varint, WireField, WireReader } from "../wire.js";
import { MessageSample } from "./samples.js";

interface Probe {
    wire: number;
    scalarWire?: number;
    input?: bigint;
    payload: number[];
    category?: string;
    typePrefixed?: boolean;
    derivedKey?: boolean;
}

interface Observation {
    member: ProtoMember;
    discriminator?: ProtoMember;
    bits?: bigint;
    entry?: Pick<ProtoField, "type" | "keyNumber">;
}

const nestedProbes = new Map<string, Probe[]>();
const textValue = [65, 66];
const curvePayload = encode(1, 2, encode(1, 5, fixed(0x3fa00000, 4)));
const guidKey = encode(2, 2, encode(1, 0, varint(73)));

// 0.75.2: selectors for derived dictionaries read these fields from the decoded value.
const derivedValuePayloads = new Map<string, number[]>([
    ["EF75EFFAA149554F", [...encode(2, 0, varint(73)), ...encode(3, 0, varint(131))]], // 0x4E4D3D0
    ["E7A441D549214BF9", [...encode(2, 0, varint(1)), ...encode(3, 0, varint(2))]], // 0x4EB0330
    ["B561AE026CD300D9", [...encode(1, 0, varint(73)), ...encode(2, 0, varint(131))]], // 0x4F47C30
    ["FA33243AA4169D4F", encode(3, 0, varint(1))], // 0x4B50740
    ["B036AE249AAC9D61", [...encode(1, 0, varint(73)), ...encode(2, 0, varint(131))]], // 0x4BE7FA0
    ["E047F940F918BC41", [...encode(2, 0, varint(73)), ...encode(3, 0, varint(131))]], // 0x4BFF280
    ["EBCAD37F1C5BE384", [...encode(2, 0, varint(73)), ...encode(3, 0, varint(131))]], // 0x4C6A810
    ["EE19EBF758FECDAB", encode(1, 2, encode(1, 2, textValue))], // 0x4C6A3F0 reads the inherited string
    ["E5055A797C31E93A", [...encode(2, 2, textValue), ...encode(3, 0, varint(1))]], // 0x4C88350
    ["EFE1FFA6D475CFA8", encode(3, 2, textValue)], // 0x4D4BE90
    ["A753A0085A4A32B8", encode(1, 2, encode(1, 0, varint(73)))], // 0x4A3EAD0
    ["B2FE6A8A8F52D7F0", [...encode(2, 2, textValue), ...encode(3, 2, [67, 68])]] // 0x4DF1740
]);

function messageProbes(type: ProtoType, repeated: boolean, extended: boolean): Probe[] {
    const message: Probe = { wire: 2, payload: [], category: "message" };
    const isStruct = type.klass?.kind === "struct";
    if (!type.klass) {
        // 0.75.2: 0x4E64230 looks up these observed registry IDs before calling the type-prefixed reader.
        return extended && type.name === "object" ? [0x865e, 0xd444].map(id =>
            ({ wire: 2, payload: varint(id), typePrefixed: true })) : [];
    }
    // 0.75.2: A73B7A34C961A4EC's first field wraps BA2D4319492A453D, whose tag 1 is int64.
    if (type.managed === "A22A28CB2FA81B32") {
        return [{ wire: 2, payload: encode(1, 2, encode(1, 0, varint(73))), category: type.managed }];
    }
    // BF6FB0A69F6EF564's discriminator 1 selects the float in field 2.
    if (type.managed === "ABC.Entity.CommonData") {
        return [{ wire: 2, payload: [...encode(1, 0, [1]), ...encode(2, 5, fixed(0x3fa00000, 4))], category: type.managed }];
    }
    if (type.managed === "EF5A916320893736.F3092D79E717DE57") {
        return [{ wire: 2, payload: encode(1, 0, varint(73)), category: type.managed }];
    }
    if (type.managed === "EF5A916320893736.B5CB532D5BCD204E" || type.managed === "EF5A916320893736.FC8876A71E4BB8EE") {
        return [{ wire: 2, payload: encode(1, 5, fixed(0x3fa00000, 4)), category: type.managed }];
    }
    if (type.managed === "ABC.Config.WwiseBank") {
        return [{ wire: 2, payload: encode(1, 2, [65, 66]), category: type.managed }];
    }
    if (type.managed === "ABC.Config.WwiseState" || type.managed === "ABC.Config.WwiseEvent") {
        return [{ wire: 2, payload: [], category: type.managed },
            { wire: 2, payload: encode(1, 2, [65, 66]), category: type.managed }];
    }
    if (type.managed === "B9E87DA9C2DF20C8") {
        return [{ wire: 2, payload: encode(1, 0, varint(73)), category: type.managed }];
    }
    if (type.managed === "B4FB7A016ADB7162") {
        return [{ wire: 2, payload: curvePayload, category: type.managed }];
    }
    if (type.managed === "ABC.Splines.CatmullRom.Spline") {
        const length = encode(2, 5, fixed(0x40200000, 4));
        return [{ wire: 2, payload: [...encode(1, 2, curvePayload), ...length], category: type.managed }];
    }
    if (extended && type.managed === "A42F976BA3D90847") {
        // 0x50A4EE0: the first entries do not satisfy the cast in 0x50A8BA0.
        return [{ wire: 2, payload: [6], typePrefixed: true }];
    }
    if (!isStruct && !extended) return [message];
    const cached = nestedProbes.get(type.managed);
    const prefix: Probe[] = extended && !isStruct ? [0, 1].map(value => ({ wire: 2, payload: [value], typePrefixed: true })) : [];
    if (cached) return repeated || !isStruct ? [message, ...cached, ...prefix] : cached;
    const payload = (tag: number): number[] => {
        const wire = tag & 7;
        return encode(tag >>> 3, wire, wire === 2 ? [65, 66] : wire === 0 ? varint(73) :
            wire === 5 ? fixed(0x3fa00000, 4) : fixed(0x3ff4000000000000n, 8));
    };
    const preferred = type.isWireAlias ? [0x0a] : new MessageCodecs(type.klass).reader?.inspect()?.tagCandidates ?? [];
    const lowTags = [0x08, 0x0a, 0x0d, 0x09, 0x10, 0x12, 0x15, 0x11];
    const candidates = [...new Set([...preferred.filter(tag => [0, 1, 2, 5].includes(tag & 7)), ...(isStruct ? lowTags : [])])].slice(0, 12);
    const result = candidates.map(tag => ({ wire: 2, payload: payload(tag), category: type.managed }));
    if (!isStruct && preferred.some(tag => (tag & 7) === 2)) {
        const tag = preferred.find(tag => (tag & 7) === 2)!;
        result.push({ wire: 2, payload: encode(tag >>> 3, 2, []), category: type.managed });
    }
    nestedProbes.set(type.managed, result);
    return repeated || !isStruct ? [message, ...result, ...prefix] : result;
}

function scalarProbe(wire: number, input: bigint, packed: boolean): Probe {
    return { wire: packed ? 2 : wire, scalarWire: wire, input,
        payload: wire === 0 ? varint(input) : fixed(input, wire === 5 ? 4 : 8) };
}

function probes(type: ProtoType, alternate = false, extended = false): Probe[] {
    if (type.key) {
        const values = probes(type.element!, true, extended);
        const entries = (type.key.name ? probes(type.key) : []).flatMap(key => values.flatMap(value => [
            { wire: 2, payload: [...encode(1, key.wire, key.payload), ...encode(2, value.wire, value.payload)], category: "map", typePrefixed: value.typePrefixed },
            { wire: 2, payload: [...encode(1, value.wire, value.payload), ...encode(2, key.wire, key.payload)], category: "map", typePrefixed: value.typePrefixed }
        ]));
        if (!extended) return entries;
        const derived = values.filter(value => value.wire === 2);
        const value = type.element!.managed, payload = derivedValuePayloads.get(value);
        if (payload) derived.push({ wire: 2, payload, category: value });
        // 0x50A8860 selects the value codec before reading the GUID used by 0x4BA39E0.
        if (value === "A555AA2F29F8BDE8") for (const id of [0, 1, 2]) {
            derived.push({ wire: 2, payload: [id, ...guidKey], typePrefixed: true });
        }
        return [...entries, ...derived.map(value => ({ ...value, derivedKey: true }))];
    }
    const scalar = type.element ?? type, inline = inlineSchema(scalar);
    if (inline) return [{ wire: 2, category: scalar.managed, payload: inline.flatMap((field, index) => field.type === "float" ?
        encode(field.number, 5, fixed([0x3fa00000, 0x40100000, 0x40500000, 0x40900000][index], 4)) :
        encode(field.number, 0, varint(field.type === "bool" ? 1 : 131))) }];
    if (scalar.bytesClass || scalar.name === "string") {
        return [{ wire: 2, payload: alternate ? [67, 68] : [65, 66], category: "bytes" }];
    }
    if (!scalar.scalar) return messageProbes(scalar, !!type.repeated, extended);
    const input: Record<number, bigint> = alternate ?
        { 0: 130n, 1: 0x4002000000000000n, 5: 0x40100000n } : { 0: 73n, 1: 0x3ff4000000000000n, 5: 0x3fa00000n };
    return scalar.wireTypes.flatMap(wire => {
        const values = scalar.managed === "bool" ? [1n, 0n] : [input[wire]];
        return values.flatMap(value => type.packable ?
            [scalarProbe(wire, value, false), scalarProbe(wire, value, true)] : [scalarProbe(wire, value, false)]);
    });
}

function expected(type: ProtoType, wire: number, raw: bigint, zigzag: boolean): bigint {
    const value = zigzag ? (raw >> 1n) ^ -(raw & 1n) : raw;
    if (type.managed === "bool" && wire === 0) return raw === 0n ? 0n : 1n;
    return BigInt.asUintN(type.scalarSize * 8, value);
}

function probeKey(probe: Probe): string {
    return JSON.stringify([probe.wire, probe.payload, probe.scalarWire, probe.category, probe.typePrefixed, probe.derivedKey]);
}

export class MergeFromRecovery {
    private readonly errors = new Set<string>();
    private readonly caseNumbers = new Map<ProtoMember, Set<number>>();

    constructor(private readonly type: ProtoMessageType, private readonly runtime: ProtoRuntime, private readonly maxField: number) {}

    recover(known: ProtoField[] = []): ProtoMessage {
        const result = this.type.message("MergeFrom"), layout = this.type.layout;
        const knownOffsets = new Set(known.map(field => field.offset)), knownNumbers = new Set(known.map(field => field.number));
        const reader = this.type.codecs.reader;
        if (!reader) throw new Error("No callable MergeFrom codec");
        // 0.75.2: all cases store to other offsets, and neither type declares an active writer.
        const runtimeOnly = new Map([
            ["0x4e49460", "FB9E269495231A54"], // object at +0x20; tags write +0x10, +0x18, +0x28..+0x3c
            ["0x4f976f0", "F27712A4564B12F1"] // optional int at +0x20; only accessed outside the codec
        ]).get(reader.rva!);
        if (runtimeOnly && !this.type.codecs.writer) result.managedOnly = [runtimeOnly + ": not accessed by the protobuf codec"];
        const pending = new Map([...layout.ordinary, ...layout.storage].filter(member => !knownOffsets.has(member.field.offset) &&
            (!result.managedOnly || member.field.name !== runtimeOnly)).map(member =>
            [member, new Map(probes(member.type).map(probe => [probeKey(probe), probe]))]));
        const extended = new Map<ProtoMember, Map<string, Probe>>();
        const discriminators = new Set<ProtoMember>();
        const preferred = new Map<number, Set<number>>();
        if (pending.size) for (const tag of reader.inspect()?.tagCandidates ?? []) {
            const number = tag >>> 3, wire = tag & 7;
            if (number < 1 || ![0, 1, 2, 5].includes(wire)) continue;
            const wires = preferred.get(number) ?? new Set<number>();
            wires.add(wire);
            preferred.set(number, wires);
        }
        const numbers = new Set([...preferred.keys(), ...Array.from({ length: this.maxField }, (_, i) => i + 1)]);
        for (const number of numbers) {
            if (!pending.size) break;
            if (knownNumbers.has(number) || number >= 19000 && number <= 19999) continue;
            const variants = new Map<string, Probe>();
            for (const probes of pending.values()) for (const [key, probe] of probes) variants.set(key, probe);
            const preferredWires = preferred.get(number), candidates: (Observation & { field: ProtoField })[] = [];
            const collect = (variants: Map<string, Probe>, available: typeof pending): void => {
                for (const [key, probe] of variants) {
                    const outcome = this.observe(number, probe);
                    if (!outcome) continue;
                    const { member, discriminator, bits, entry } = outcome;
                    if (!available.get(member)?.has(key)) continue;
                    if (discriminator && (knownOffsets.has(discriminator.field.offset) ||
                        result.fields.some(field => field.offset === discriminator.field.offset))) continue;
                    const type = member.type, scalar = type.element ?? type;
                    const name = member.field.name, offset = member.field.offset;
                    if (entry) {
                        candidates.push({ ...outcome, field: { name, number, offset, typePrefixed: probe.typePrefixed,
                            derivedKey: probe.derivedKey, ...entry } });
                        continue;
                    }
                    let xor: string | undefined, zigzag = false;
                    if (scalar.scalar) {
                        if (bits === undefined || probe.scalarWire === undefined || probe.input === undefined) continue;
                        const inferred = this.infer(number, probe, outcome, bits);
                        if (!inferred) continue;
                        ({ xor, zigzag } = inferred);
                    }
                    // MergeFrom cannot attest which accepted form the writer emits.
                    candidates.push({ ...outcome, field: { name, number, offset, oneof: discriminator?.field.name,
                        type: probe.typePrefixed ? type.asBytes() : type.withWire(probe.scalarWire ?? probe.wire, zigzag),
                        typePrefixed: probe.typePrefixed, xor } });
                }
            };
            collect(new Map([...variants].sort(([, a], [, b]) => Number(!!preferredWires?.has(b.wire)) - Number(!!preferredWires?.has(a.wire)))), pending);
            if (!candidates.length && preferredWires?.has(2)) {
                const alternatives = new Map<string, Probe>();
                for (const [member, tried] of pending) {
                    if (!extended.has(member)) extended.set(member, new Map(probes(member.type, false, true).flatMap(probe => {
                        const key = probeKey(probe);
                        return probe.wire === 2 && !tried.has(key) ? [[key, probe] as const] : [];
                    })));
                    for (const [key, probe] of extended.get(member)!) alternatives.set(key, probe);
                }
                collect(alternatives, extended);
            }
            const first = candidates[0];
            if (!first || candidates.some(candidate => candidate.member !== first.member || candidate.discriminator !== first.discriminator ||
                candidate.field.type.name !== first.field.type.name || candidate.field.typePrefixed !== first.field.typePrefixed ||
                candidate.field.derivedKey !== first.field.derivedKey ||
                candidate.field.xor !== first.field.xor || candidate.field.keyNumber !== first.field.keyNumber ||
                candidate.field.type.key?.name !== first.field.type.key?.name)) continue;
            result.fields.push(first.field);
            pending.delete(first.member);
            for (const wire of [0, 1, 2, 5]) this.errors.delete(number + "/" + wire);
            if (first.discriminator) {
                discriminators.add(first.discriminator);
                pending.delete(first.discriminator);
            }
        }
        const baseSegment = this.baseSegment();
        if (baseSegment && !knownNumbers.has(baseSegment.number) && !result.fields.some(field => field.number === baseSegment.number)) {
            result.fields.push(baseSegment);
        }
        result.unresolved = [...layout.unsupported.filter(field => !result.managedOnly || field.split(":")[0] !== runtimeOnly), ...[...pending.keys(), ...layout.cases]
            .filter(member => !discriminators.has(member)).map(member => member.field.name)];
        if (result.unresolved.length && this.errors.size) {
            result.diagnostics = ["MergeFrom native error for tags: " + [...this.errors].slice(0, 12).join(", ")];
        }
        return result;
    }

    private baseSegment(): ProtoField | undefined {
        // 0x4DE31CD calls the base reader with the same reference slot inside tag 1.
        if (this.type.codecs.reader?.rva !== "0x4de3170") return undefined;
        const parent = this.type.parent;
        if (!parent || parent.fullName !== "F2B222B133F8128E") return undefined;
        const type = ProtoType.from(parent.type), member = new ProtoMessageType(parent.handle).layout.ordinary
            .find(member => member.field.name === "B24A01A51AEAED87" && member.type.name === "string");
        if (!type || !member) return undefined;
        const sample = MessageSample.create(this.type);
        try {
            const address = member.address(sample), before = address.readPointer();
            if (!sample.merge(this.runtime, encode(1, 2, encode(1, 2, textValue)))) return undefined;
            const after = address.readPointer();
            if (after.isNull() || after.equals(before) || new Il2CppString(after).read() !== String.fromCharCode(...textValue)) return undefined;
            return { name: parent.name, type, number: 1, offset: member.field.offset, baseSegment: true };
        } finally { sample.close(); }
    }

    private infer(number: number, probe: Probe, { member, discriminator }: Observation, bits: bigint): { xor?: string; zigzag: boolean } | undefined {
        const wire = probe.scalarWire!, input = probe.input!, type = member.type.element ?? member.type;
        if (wire === 0 && !type.integer) return bits === expected(type, wire, input, false) ? { zigzag: false } : undefined;
        const models = (wire === 0 && type.signed ? [false, true] : [false]).map(zigzag =>
            ({ zigzag, mask: bits ^ expected(type, wire, input, zigzag) }));
        if (models.length === 1 && models[0].mask === 0n) return { zigzag: false };
        const packed = probe.wire === 2;
        const values = wire === 0 ? [130n, 2049n] : wire === 5 ? [0x40100000n, 0xc0700000n] : [0x4002000000000000n, 0xc00e000000000000n];
        const verified = values.map(value => {
            const observed = this.observe(number, scalarProbe(wire, value, packed));
            return observed?.member === member && observed.discriminator === discriminator && observed.bits !== undefined ?
                { value, bits: observed.bits } : undefined;
        });
        const matches = models.filter(({ zigzag, mask }) => verified.every(observed => observed &&
            (observed.bits ^ expected(type, wire, observed.value, zigzag)) === mask));
        if (matches.length !== 1) return undefined;
        const { mask, zigzag } = matches[0];
        return { zigzag, xor: mask === 0n ? undefined : "0x" + mask.toString(16).toUpperCase() };
    }

    private observe(number: number, probe: Probe): Observation | undefined {
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
