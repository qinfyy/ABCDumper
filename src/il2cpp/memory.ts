export const u64 = (value: bigint): bigint => BigInt.asUintN(64, value);
export const read64 = (address: NativePointer): bigint => BigInt(address.readU64().toString());
export const pointer = (value: bigint): NativePointer => ptr("0x" + u64(value).toString(16));
export const subtractPointer = (address: NativePointer, key: bigint): NativePointer => pointer(read64(address) - key);
export const xorPointer = (address: NativePointer, key: bigint): NativePointer => pointer(read64(address) ^ key);
export const text = (address: NativePointer): string => address.isNull() ? "" : address.readUtf8String() ?? "";
export class NativeStruct {
    constructor(readonly handle: NativePointer) {}

    toString(): string {
        return this.handle.toString();
    }
}
