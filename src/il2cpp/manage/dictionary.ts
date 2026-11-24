import { Argument } from "../invoke.js";
import { ObjectScope } from "../objects.js";
import { Il2CppType } from "../structs/type.js";
import { ManagedCollection } from "./collection.js";
import { ManagedObject, ManagedResult } from "./object.js";

// System.Collections.Generic.Dictionary<TKey, TValue>
export class ManagedDictionary extends ManagedCollection {
    get keyType(): Il2CppType { return this.method("get_Item", 1).parameters[0].type; }
    get valueType(): Il2CppType { return this.method("get_Item", 1).returnType; }

    get(key: Argument, scope?: ObjectScope): ManagedResult { return this.invoke("get_Item", [key], scope); }

    containsKey(key: Argument): boolean {
        const value = this.invoke("ContainsKey", [key]).value;
        if (typeof value !== "boolean") throw new Error("ContainsKey did not return bool");
        return value;
    }

    values(scope: ObjectScope): ManagedCollection {
        const object = this.invoke("get_Values", [], scope).pointer;
        if (object.isNull()) throw new Error("Dictionary value view is null");
        return new ManagedCollection(object);
    }

    add(key: Argument, value: Argument): void { this.invoke("Add", [key, value]); }
}

// System.Collections.Generic.KeyValuePair<TKey, TValue>
export class ManagedKeyValuePair extends ManagedObject {
    constructor(handle: NativePointer) {
        super(handle);
        if (handle.isNull() || this.klass.kind !== "struct") throw new Error("Dictionary entry is not a boxed struct");
    }

    get keyType(): Il2CppType { return this.method("get_Key").returnType; }
    key(scope: ObjectScope): ManagedResult { return this.invoke("get_Key", [], scope); }
    value(scope: ObjectScope): ManagedResult { return this.invoke("get_Value", [], scope); }
}
