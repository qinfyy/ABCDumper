export class WireField {
    constructor(readonly number: number, readonly wire: number, readonly payload: number[] = [], readonly value?: bigint) {}

    get signature(): string {
        return JSON.stringify({ number: this.number, wire: this.wire, payload: this.payload, value: this.value?.toString() });
    }

    get numeric(): bigint {
        if (this.value !== undefined) return this.value;
        if (this.wire === 2) return new WireReader(encode(1, 0, this.payload)).read()[0].value!;
        return this.payload.reduce((value, byte, i) => value | BigInt(byte) << BigInt(i * 8), 0n);
    }
}

export function varint(value: number | bigint): number[] {
    let remaining = BigInt.asUintN(64, BigInt(value));
    const bytes: number[] = [];
    while (remaining > 127n) {
        bytes.push(Number(remaining & 127n) | 128);
        remaining >>= 7n;
    }
    bytes.push(Number(remaining));
    return bytes;
}

export function fixed(value: number | bigint, size: number): number[] {
    const raw = BigInt.asUintN(size * 8, BigInt(value));
    return Array.from({ length: size }, (_, i) => Number(raw >> BigInt(i * 8) & 255n));
}

export function encode(number: number, wire: number, payload: number[]): number[] {
    return [...varint(BigInt(number) * 8n + BigInt(wire)), ...(wire === 2 ? varint(payload.length) : []), ...payload];
}

export class WireReader {
    private position = 0;

    constructor(private readonly bytes: number[]) {}

    singleVarint(): bigint | undefined {
        try {
            const value = this.varint();
            return this.position === this.bytes.length ? value : undefined;
        } catch { return undefined; }
    }

    private varint(): bigint {
        let value = 0n;
        for (let shift = 0n; shift < 70n && this.position < this.bytes.length; shift += 7n) {
            const byte = this.bytes[this.position++];
            value |= BigInt(byte & 127) << shift;
            if (!(byte & 128)) return value;
        }
        throw new Error("Truncated or oversized varint");
    }

    read(): WireField[] {
        const fields: WireField[] = [];
        while (this.position < this.bytes.length) {
            const tag = Number(this.varint()), wire = tag & 7, number = tag >>> 3;
            if (!number || ![0, 1, 2, 5].includes(wire)) throw new Error("Invalid protobuf tag " + tag);
            if (wire === 0) fields.push(new WireField(number, wire, [], this.varint()));
            else {
                const length = wire === 2 ? Number(this.varint()) : wire === 1 ? 8 : 4;
                if (length > this.bytes.length - this.position) throw new Error("Truncated protobuf payload");
                fields.push(new WireField(number, wire, this.bytes.slice(this.position, this.position += length)));
            }
        }
        return fields;
    }
}
