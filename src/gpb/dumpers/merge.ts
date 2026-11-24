import { ProtoMember } from "../fields.js";
import { ProtoMessageType } from "../message.js";
import { ProtoRuntime } from "../runtime.js";
import { ProtoField, ProtoMessage, ProtoType } from "../schema.js";
import { MergeObservation, MergeObserver } from "./merge-observer.js";
import { MergeProbe, MergeProbeCatalog, probeKey, scalarProbe } from "./merge-probes.js";

type ProbeVariants = Map<string, MergeProbe>;
type MemberProbes = Map<ProtoMember, ProbeVariants>;
type Candidate = MergeObservation & { field: ProtoField };

// 0.75.2: these readers never access the listed fields, and neither type declares an active writer.
const managedOnlyByReader = new Map([
    ["0x4e49460", "FB9E269495231A54"], // object at +0x20; tags write +0x10, +0x18, +0x28..+0x3c
    ["0x4f976f0", "F27712A4564B12F1"] // optional int at +0x20; only accessed outside the codec
]);

function expected(type: ProtoType, wire: number, raw: bigint, zigzag: boolean): bigint {
    const value = zigzag ? (raw >> 1n) ^ -(raw & 1n) : raw;
    if (type.managed === "bool" && wire === 0) return raw === 0n ? 0n : 1n;
    return BigInt.asUintN(type.scalarSize * 8, value);
}

function preferredWires(tags: readonly number[]): Map<number, Set<number>> {
    const preferred = new Map<number, Set<number>>();
    for (const tag of tags) {
        const number = tag >>> 3, wire = tag & 7;
        if (number < 1 || ![0, 1, 2, 5].includes(wire)) continue;
        const wires = preferred.get(number) ?? new Set<number>();
        wires.add(wire);
        preferred.set(number, wires);
    }
    return preferred;
}

export class MergeFromRecovery {
    private readonly observer: MergeObserver;

    constructor(private readonly type: ProtoMessageType, runtime: ProtoRuntime, private readonly maxField: number,
        private readonly probes: MergeProbeCatalog) {
        this.observer = new MergeObserver(type, runtime);
    }

    recover(known: readonly ProtoField[] = []): ProtoMessage {
        const result = this.type.message("MergeFrom"), layout = this.type.layout;
        const occupiedOffsets = new Set(known.map(field => field.offset)), knownNumbers = new Set(known.map(field => field.number));
        const reader = this.type.codecs.reader;
        if (!reader) throw new Error("No callable MergeFrom codec");
        const runtimeOnly = this.type.codecs.writer ? undefined : managedOnlyByReader.get(reader.rva ?? "");
        if (runtimeOnly) result.managedOnly = [runtimeOnly + ": not accessed by the protobuf codec"];
        const pending: MemberProbes = new Map();
        for (const member of [...layout.ordinary, ...layout.storage]) {
            if (occupiedOffsets.has(member.field.offset) || runtimeOnly && member.field.name === runtimeOnly) continue;
            pending.set(member, new Map(this.probes.forType(member.type).map(probe => [probeKey(probe), probe])));
        }
        const extended: MemberProbes = new Map();
        const discriminators = new Set<ProtoMember>();
        const preferred = preferredWires(pending.size ? reader.inspect()?.tagCandidates ?? [] : []);
        const numbers = new Set([...preferred.keys(), ...Array.from({ length: this.maxField }, (_, i) => i + 1)]);
        for (const number of numbers) {
            if (!pending.size) break;
            if (knownNumbers.has(number) || number >= 19000 && number <= 19999) continue;
            const variants: ProbeVariants = new Map();
            for (const probes of pending.values()) for (const [key, probe] of probes) variants.set(key, probe);
            const wires = preferred.get(number);
            const ordered = [...variants].sort(([, a], [, b]) => Number(!!wires?.has(b.wire)) - Number(!!wires?.has(a.wire)));
            let candidates = this.collect(number, ordered, pending, occupiedOffsets);
            if (!candidates.length && wires?.has(2)) {
                candidates = this.collect(number, this.extend(pending, extended), extended, occupiedOffsets);
            }
            const candidate = this.uniqueCandidate(candidates);
            if (!candidate) continue;
            const { field, member, discriminator } = candidate;
            result.fields.push(field);
            occupiedOffsets.add(field.offset);
            pending.delete(member);
            this.observer.confirm(number);
            if (discriminator) {
                discriminators.add(discriminator);
                pending.delete(discriminator);
            }
        }
        const baseSegment = this.observer.baseSegment();
        if (baseSegment && !knownNumbers.has(baseSegment.number) && !result.fields.some(field => field.number === baseSegment.number)) {
            result.fields.push(baseSegment);
        }
        result.unresolved = [...layout.unsupported.filter(field => !runtimeOnly || field.split(":")[0] !== runtimeOnly),
            ...[...pending.keys(), ...layout.cases].filter(member => !discriminators.has(member)).map(member => member.field.name)];
        const diagnostics = this.observer.diagnostics;
        if (result.unresolved.length && diagnostics) result.diagnostics = diagnostics;
        return result;
    }

    private extend(pending: MemberProbes, extended: MemberProbes): ProbeVariants {
        const alternatives: ProbeVariants = new Map();
        for (const [member, tried] of pending) {
            let variants = extended.get(member);
            if (!variants) {
                variants = new Map();
                for (const probe of this.probes.forType(member.type, true)) {
                    const key = probeKey(probe);
                    if (probe.wire === 2 && !tried.has(key)) variants.set(key, probe);
                }
                extended.set(member, variants);
            }
            for (const [key, probe] of variants) alternatives.set(key, probe);
        }
        return alternatives;
    }

    private collect(number: number, variants: Iterable<[string, MergeProbe]>, available: MemberProbes,
        occupiedOffsets: ReadonlySet<number>): Candidate[] {
        const candidates: Candidate[] = [];
        for (const [key, probe] of variants) {
            const outcome = this.observer.read(number, probe);
            if (!outcome) continue;
            const { member, discriminator, entry } = outcome;
            if (!available.get(member)?.has(key) || discriminator && occupiedOffsets.has(discriminator.field.offset)) continue;
            const { type } = member, scalar = type.element ?? type;
            const { name, offset } = member.field, { typePrefixed, derivedKey } = probe;
            if (entry) {
                candidates.push({ ...outcome, field: { name, number, offset, typePrefixed, derivedKey, ...entry } });
                continue;
            }
            const codec = scalar.scalar ? this.infer(number, probe, outcome) : { zigzag: false };
            if (!codec) continue;
            // MergeFrom cannot attest which accepted form the writer emits.
            candidates.push({ ...outcome, field: { name, number, offset, oneof: discriminator?.field.name,
                type: typePrefixed ? type.asBytes() : type.withWire(probe.scalarWire ?? probe.wire, codec.zigzag),
                typePrefixed, xor: codec.xor } });
        }
        return candidates;
    }

    private uniqueCandidate(candidates: Candidate[]): Candidate | undefined {
        const first = candidates[0];
        if (!first || candidates.some(candidate => candidate.member !== first.member || candidate.discriminator !== first.discriminator ||
            candidate.field.type.name !== first.field.type.name || candidate.field.typePrefixed !== first.field.typePrefixed ||
            candidate.field.derivedKey !== first.field.derivedKey ||
            candidate.field.xor !== first.field.xor || candidate.field.keyNumber !== first.field.keyNumber ||
            candidate.field.type.key?.name !== first.field.type.key?.name)) return undefined;
        return first;
    }

    private infer(number: number, probe: MergeProbe,
        { member, discriminator, bits }: MergeObservation): { xor?: string; zigzag: boolean } | undefined {
        const { scalarWire: wire, input } = probe, type = member.type.element ?? member.type;
        if (wire === undefined || input === undefined || bits === undefined) return undefined;
        if (wire === 0 && !type.integer) return bits === expected(type, wire, input, false) ? { zigzag: false } : undefined;
        const models = (wire === 0 && type.signed ? [false, true] : [false]).map(zigzag =>
            ({ zigzag, mask: bits ^ expected(type, wire, input, zigzag) }));
        if (models.length === 1 && models[0].mask === 0n) return { zigzag: false };
        const packed = probe.wire === 2;
        const values = wire === 0 ? [130n, 2049n] : wire === 5 ? [0x40100000n, 0xc0700000n] : [0x4002000000000000n, 0xc00e000000000000n];
        const verified = values.map(value => {
            const observed = this.observer.read(number, scalarProbe(wire, value, packed));
            return observed?.member === member && observed.discriminator === discriminator && observed.bits !== undefined ?
                { value, bits: observed.bits } : undefined;
        });
        const matches = models.filter(({ zigzag, mask }) => verified.every(observed => observed &&
            (observed.bits ^ expected(type, wire, observed.value, zigzag)) === mask));
        if (matches.length !== 1) return undefined;
        const { mask, zigzag } = matches[0];
        return { zigzag, xor: mask === 0n ? undefined : "0x" + mask.toString(16).toUpperCase() };
    }
}
