import { Argument } from "../invoke.js";
import { ObjectScope } from "../objects.js";
import { Il2CppTypeEnum } from "../constant.js";
import { Il2CppMethod } from "../structs/method.js";
import { Il2CppType } from "../structs/type.js";
import { ManagedCollection } from "./collection.js";
import { ManagedResult } from "./object.js";

// Use instantiated client methods rather than assuming a List<T> field layout.
// System.Collections.Generic.List<T>
export class ManagedList extends ManagedCollection {
    readonly itemMethod: Il2CppMethod;

    constructor(handle: NativePointer) {
        super(handle);
        const method = this.method("get_Item", 1);
        if (method.parameters[0].type.tag !== Il2CppTypeEnum.IL2CPP_TYPE_I4) throw new Error("Unsupported list indexer");
        this.itemMethod = method;
    }
    get elementType(): Il2CppType { return this.itemMethod.returnType; }

    get(index: number, scope?: ObjectScope): ManagedResult {
        if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) throw new Error("Invalid list index: " + index);
        return this.invoke(this.itemMethod, [{ type: "int", value: index }], scope);
    }

    add(value: Argument): void { this.invoke("Add", [value]); }
}
