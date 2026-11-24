import { MessageCodecs } from "../methods.js";
import { inlineSchema, ProtoType } from "../schema.js";
import { encode, fixed, varint } from "../wire.js";

export interface MergeProbe {
    wire: number;
    scalarWire?: number;
    input?: bigint;
    payload: number[];
    category?: string;
    typePrefixed?: boolean;
    derivedKey?: boolean;
}

const textValue = [65, 66];
const integerField = encode(1, 0, varint(73));
const floatField = encode(1, 5, fixed(0x3fa00000, 4));
const textField = encode(1, 2, textValue);
const curvePayload = encode(1, 2, floatField);
const guidKey = encode(2, 2, integerField);

// 0.75.2: these readers require nonempty nested samples or a specific case.
const messagePayloads = new Map<string, number[][]>([
    // A73B7A34C961A4EC wraps BA2D4319492A453D (int64 at tag 1).
    ["A22A28CB2FA81B32", [encode(1, 2, integerField)]],
    // BF6FB0A69F6EF564's discriminator 1 selects the float in field 2.
    ["ABC.Entity.CommonData", [[...encode(1, 0, [1]), ...encode(2, 5, fixed(0x3fa00000, 4))]]],
    ["EF5A916320893736.F3092D79E717DE57", [integerField]],
    ["EF5A916320893736.B5CB532D5BCD204E", [floatField]],
    ["EF5A916320893736.FC8876A71E4BB8EE", [floatField]],
    ["ABC.Config.WwiseBank", [textField]],
    ["ABC.Config.WwiseState", [[], textField]],
    ["ABC.Config.WwiseEvent", [[], textField]],
    ["B9E87DA9C2DF20C8", [integerField]],
    ["B4FB7A016ADB7162", [curvePayload]],
    ["ABC.Splines.CatmullRom.Spline", [[...encode(1, 2, curvePayload), ...encode(2, 5, fixed(0x40200000, 4))]]]
]);

// 0.75.2: selectors for derived dictionaries read these fields from the decoded value.
const derivedValuePayloads = new Map<string, number[]>([
    ["EF75EFFAA149554F", [...encode(2, 0, varint(73)), ...encode(3, 0, varint(131))]], // 0x4E4D3D0
    ["E7A441D549214BF9", [...encode(2, 0, varint(1)), ...encode(3, 0, varint(2))]], // 0x4EB0330
    ["B561AE026CD300D9", [...integerField, ...encode(2, 0, varint(131))]], // 0x4F47C30
    ["FA33243AA4169D4F", encode(3, 0, varint(1))], // 0x4B50740
    ["B036AE249AAC9D61", [...integerField, ...encode(2, 0, varint(131))]], // 0x4BE7FA0
    ["E047F940F918BC41", [...encode(2, 0, varint(73)), ...encode(3, 0, varint(131))]], // 0x4BFF280
    ["EBCAD37F1C5BE384", [...encode(2, 0, varint(73)), ...encode(3, 0, varint(131))]], // 0x4C6A810
    ["EE19EBF758FECDAB", encode(1, 2, textField)], // 0x4C6A3F0 reads the inherited string
    ["E5055A797C31E93A", [...encode(2, 2, textValue), ...encode(3, 0, varint(1))]], // 0x4C88350
    ["EFE1FFA6D475CFA8", encode(3, 2, textValue)], // 0x4D4BE90
    ["A753A0085A4A32B8", encode(1, 2, integerField)], // 0x4A3EAD0
    ["B2FE6A8A8F52D7F0", [...encode(2, 2, textValue), ...encode(3, 2, [67, 68])]] // 0x4DF1740
]);

const scalarInputs: readonly Readonly<Record<number, bigint>>[] = [
    { 0: 73n, 1: 0x3ff4000000000000n, 5: 0x3fa00000n },
    { 0: 130n, 1: 0x4002000000000000n, 5: 0x40100000n }
];

export function scalarProbe(wire: number, input: bigint, packed: boolean): MergeProbe {
    return { wire: packed ? 2 : wire, scalarWire: wire, input,
        payload: wire === 0 ? varint(input) : fixed(input, wire === 5 ? 4 : 8) };
}

export function probeKey(probe: MergeProbe): string {
    return JSON.stringify([probe.wire, probe.payload, probe.scalarWire, probe.category, probe.typePrefixed, probe.derivedKey]);
}

export class MergeProbeCatalog {
    private readonly nested = new Map<string, MergeProbe[]>();

    forType(type: ProtoType, extended = false): MergeProbe[] { return this.build(type, false, extended); }

    private build(type: ProtoType, alternate: boolean, extended: boolean): MergeProbe[] {
        if (type.key) return this.mapEntries(type.key, type.element!, extended);
        const scalar = type.element ?? type, inline = inlineSchema(scalar);
        if (inline) return [{ wire: 2, category: scalar.managed, payload: inline.flatMap((field, index) => field.type === "float" ?
            encode(field.number, 5, fixed([0x3fa00000, 0x40100000, 0x40500000, 0x40900000][index], 4)) :
            encode(field.number, 0, varint(field.type === "bool" ? 1 : 131))) }];
        if (scalar.bytesClass || scalar.name === "string") {
            return [{ wire: 2, payload: alternate ? [67, 68] : textValue, category: "bytes" }];
        }
        if (!scalar.scalar) return this.messages(scalar, !!type.repeated, extended);
        const inputs = scalarInputs[Number(alternate)];
        return scalar.wireTypes.flatMap(wire => {
            const values = scalar.managed === "bool" ? [1n, 0n] : [inputs[wire]];
            return values.flatMap(value => type.packable ?
                [scalarProbe(wire, value, false), scalarProbe(wire, value, true)] : [scalarProbe(wire, value, false)]);
        });
    }

    private mapEntries(keyType: ProtoType, valueType: ProtoType, extended: boolean): MergeProbe[] {
        const values = this.build(valueType, true, extended);
        const entries = (keyType.name ? this.forType(keyType) : []).flatMap(key => values.flatMap(value => [
            { wire: 2, payload: [...encode(1, key.wire, key.payload), ...encode(2, value.wire, value.payload)], category: "map", typePrefixed: value.typePrefixed },
            { wire: 2, payload: [...encode(1, value.wire, value.payload), ...encode(2, key.wire, key.payload)], category: "map", typePrefixed: value.typePrefixed }
        ]));
        if (!extended) return entries;
        const derived = values.filter(value => value.wire === 2), payload = derivedValuePayloads.get(valueType.managed);
        if (payload) derived.push({ wire: 2, payload, category: valueType.managed });
        // 0x50A8860 selects the value codec before reading the GUID used by 0x4BA39E0.
        if (valueType.managed === "A555AA2F29F8BDE8") for (const id of [0, 1, 2]) {
            derived.push({ wire: 2, payload: [id, ...guidKey], typePrefixed: true });
        }
        return [...entries, ...derived.map(value => ({ ...value, derivedKey: true }))];
    }

    private messages(type: ProtoType, repeated: boolean, extended: boolean): MergeProbe[] {
        if (!type.klass) {
            // 0.75.2: 0x4E64230 resolves these registry IDs before reading the type-prefixed value.
            return extended && type.name === "object" ? [0x865e, 0xd444].map(id =>
                ({ wire: 2, payload: varint(id), typePrefixed: true })) : [];
        }
        const payloads = messagePayloads.get(type.managed);
        if (payloads) return payloads.map(payload => ({ wire: 2, payload, category: type.managed }));
        if (extended && type.managed === "A42F976BA3D90847") {
            // 0x50A4EE0: the first entries do not satisfy the cast in 0x50A8BA0.
            return [{ wire: 2, payload: [6], typePrefixed: true }];
        }
        const message: MergeProbe = { wire: 2, payload: [], category: "message" };
        const isStruct = type.klass.kind === "struct";
        if (!isStruct && !extended) return [message];
        const nested = this.nested.get(type.managed) ?? this.buildNested(type, isStruct);
        const prefix: MergeProbe[] = extended && !isStruct ? [0, 1].map(value => ({ wire: 2, payload: [value], typePrefixed: true })) : [];
        return repeated || !isStruct ? [message, ...nested, ...prefix] : nested;
    }

    private buildNested(type: ProtoType, isStruct: boolean): MergeProbe[] {
        const preferred = type.isWireAlias ? [0x0a] : new MessageCodecs(type.klass!).reader?.inspect()?.tagCandidates ?? [];
        const lowTags = [0x08, 0x0a, 0x0d, 0x09, 0x10, 0x12, 0x15, 0x11];
        const candidates = [...new Set([...preferred.filter(tag => [0, 1, 2, 5].includes(tag & 7)), ...(isStruct ? lowTags : [])])].slice(0, 12);
        const probes = candidates.map(tag => {
            const wire = tag & 7;
            const payload = wire === 2 ? textValue : scalarProbe(wire, scalarInputs[0][wire], false).payload;
            return { wire: 2, payload: encode(tag >>> 3, wire, payload), category: type.managed };
        });
        const lengthDelimitedTag = preferred.find(tag => (tag & 7) === 2);
        if (!isStruct && lengthDelimitedTag !== undefined) {
            probes.push({ wire: 2, payload: encode(lengthDelimitedTag >>> 3, 2, []), category: type.managed });
        }
        this.nested.set(type.managed, probes);
        return probes;
    }
}
