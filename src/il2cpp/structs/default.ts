import { globalPointer, NativeStruct } from "../memory.js";

let defaults: Map<number, Il2CppFieldDefaultValue> | undefined;

// CN 7.2.50 field-default records are 12 bytes; the client stores the data index at +4.
export class Il2CppFieldDefaultValue extends NativeStruct {
    get fieldIndex(): number { return this.handle.readS32(); }
    get dataIndex(): number { return this.handle.add(4).readS32(); }
    get data(): NativePointer {
        if (this.dataIndex < 0) throw new Error("Field default value has no data");
        const offset = globalPointer("metadataHeader").add(0x90).readU32() ^ 0x31164e35;
        return globalPointer("il2cpp::vm::MetadataCache::s_GlobalMetadata").add(offset >>> 0).add(this.dataIndex);
    }

    static find(index: number): Il2CppFieldDefaultValue | undefined {
        if (!defaults) {
            const header = globalPointer("metadataHeader"), payload = globalPointer("il2cpp::vm::MetadataCache::s_GlobalMetadata");
            const size = (header.add(0xb8).readU32() + 0xd04b930e) >>> 0;
            const start = (header.add(8).readU32() + 0xc2e62c7e) >>> 0;
            const records = new Map<number, Il2CppFieldDefaultValue>();
            for (let offset = 0; offset < size; offset += 12) {
                const record = new Il2CppFieldDefaultValue(payload.add(start + offset));
                records.set(record.fieldIndex, record);
            }
            defaults = records;
        }
        return defaults.get(index);
    }
}
