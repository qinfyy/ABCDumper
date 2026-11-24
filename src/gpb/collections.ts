import { Argument } from "../il2cpp/invoke.js";
import { ManagedCollection } from "../il2cpp/manage/collection.js";
import { Il2CppArray } from "../il2cpp/structs/array.js";
import { Il2CppField } from "../il2cpp/structs/field.js";
import { Il2CppObject } from "../il2cpp/structs/object.js";
import { gpbConstant } from "./constant.js";
import { ProtoType } from "./schema.js";

const entryFields = new Map<string, { key: Il2CppField; value: Il2CppField }>();

export class ProtoCollection extends ManagedCollection {
    private get backing(): NativePointer | undefined {
        if (this.klass.fullName === gpbConstant.pooledList) return this.handle.add(0x10).readPointer();
        if (this.klass.fullName === gpbConstant.dictionary) return this.handle;
    }

    get count(): number {
        const backing = this.backing;
        if (!backing) return super.count;
        if (backing.isNull()) return 0;
        // PooledList stores size at +0x20; Dictionary also subtracts its free count.
        return backing.add(0x20).readS32() - (this.klass.fullName === gpbConstant.dictionary ? backing.add(0x28).readS32() : 0);
    }

    add(type: ProtoType, ...args: Argument[]): void {
        // Arguments use concrete T/TKey/TValue storage, not IDictionary.Add(object, object) boxing.
        const name = type.key ? "A625BC090887479B" : "Add";
        const method = this.klass.findMethod(name, { parameterCount: args.length, inherited: true, isStatic: false, native: true });
        if (!method) throw new Error("Collection Add not found: " + this.klass.fullName);
        this.invoke(method, args);
    }

    singleEntry(type: ProtoType): { key: NativePointer; value: NativePointer } | undefined {
        if (this.klass.fullName !== gpbConstant.dictionary || this.count !== 1 || this.handle.add(0x20).readS32() !== 1) return undefined;
        const array = new Il2CppArray(this.handle.add(0x18).readPointer());
        if (array.handle.isNull() || !array.length) return undefined;
        const klass = array.elementType.klass, id = klass.toString();
        let fields = entryFields.get(id);
        if (!fields) {
            // 0.75.2 Dictionary Entry names are shared by inflated TKey/TValue classes.
            const members = [...klass.fields()].filter(field => !field.isStatic);
            const key = members.find(field => field.name === "EF3AE79867E38521");
            const value = members.find(field => field.name === "B52E4FD9ECDC35A6");
            if (!key || !value || key.type.name !== type.key?.managed || value.type.name !== type.element?.managed) return undefined;
            fields = { key, value };
            entryFields.set(id, fields);
        }
        return { key: fields.key.address(array.data, true), value: fields.value.address(array.data, true) };
    }

    lastBits(type: ProtoType): bigint | undefined {
        const backing = this.backing;
        if (backing) {
            const count = this.count;
            if (count <= 0) return undefined;
            const array = new Il2CppArray(backing.add(0x18).readPointer());
            if (array.handle.isNull() || count > array.length) return undefined;
            return type.readBits(array.data.add((count - 1) * type.scalarSize));
        }
        const method = this.klass.findMethod("get_Item", { parameterCount: 1, inherited: true, isStatic: false });
        const count = this.count;
        if (!method || !count) return undefined;
        const value = this.invoke(method, [{ type: "int", value: count - 1 }]).pointer;
        return value.isNull() ? undefined : type.readBits(new Il2CppObject(value).data);
    }
}
