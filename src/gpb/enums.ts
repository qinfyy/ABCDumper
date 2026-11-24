import { ManagedEnum } from "../il2cpp/manage/enum.js";
import { ProtoEnum, ProtoMessage, ProtoType, schemaName } from "./schema.js";

export class ProtoEnumType extends ManagedEnum {
    get schema(): ProtoEnum {
        return { name: schemaName(this.klass), assembly: this.klass.image.name, values: this.values.map(item => {
            if (typeof item.value !== "number" || item.value < -0x80000000 || item.value > 0x7fffffff) {
                throw new Error("Enum value is outside the protobuf int32 range: " + item.name);
            }
            return { name: item.name, value: item.value };
        }) };
    }
}

export class EnumRegistry {
    private readonly enums = new Map<string, ProtoEnum>();

    get size(): number { return this.enums.size; }
    values(): IterableIterator<ProtoEnum> { return this.enums.values(); }

    collect(message: ProtoMessage): void {
        for (const field of message.fields) this.include(field.type);
    }

    private include(type: ProtoType): void {
        if (type.klass?.kind === "enum" && !this.enums.has(type.name)) this.enums.set(type.name, new ProtoEnumType(type.klass).schema);
        if (type.key) this.include(type.key);
        if (type.element) this.include(type.element);
    }
}
