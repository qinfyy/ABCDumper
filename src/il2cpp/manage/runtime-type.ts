import { api } from "../api.js";
import { resolveClass } from "../core.js";
import { ObjectScope, setReference } from "../objects.js";
import { Il2CppClass } from "../structs/class.js";
import { Il2CppType } from "../structs/type.js";
import { ManagedAssembly } from "./assembly.js";
import { ManagedObject } from "./object.js";

// System.RuntimeType
export class ManagedRuntimeType extends ManagedObject {
    static from(type: Il2CppType, scope: ObjectScope): ManagedRuntimeType {
        return new ManagedRuntimeType(scope.root(api.il2cpp_type_get_object(type.handle)));
    }

    get representedClass(): Il2CppClass {
        const handle = api["il2cpp::vm::Class::FromSystemType"](this.handle);
        if (handle.isNull()) throw new Error("Reflection type has no runtime class");
        return new Il2CppClass(handle);
    }

    assembly(scope: ObjectScope): ManagedAssembly {
        const method = this.method("get_Assembly", 0, { returnType: "System.Reflection.Assembly" });
        const result = this.invoke(method, [], scope).pointer;
        if (result.isNull()) throw new Error("RuntimeType.Assembly returned null");
        return new ManagedAssembly(result);
    }

    makeGenericType(arguments_: readonly Il2CppType[], scope: ObjectScope): ManagedRuntimeType {
        const types = scope.array(resolveClass({ image: "mscorlib.dll", name: "System.Type" }), arguments_.length);
        arguments_.forEach((type, index) => setReference(types.elementAddress(index), ManagedRuntimeType.from(type, scope).handle));
        const method = this.method("MakeGenericType", 1, { returnType: "System.Type", parameterTypes: ["System.Type[]"] });
        const result = this.invoke(method, [types.handle], scope).pointer;
        if (result.isNull()) throw new Error("RuntimeType.MakeGenericType returned null");
        return new ManagedRuntimeType(result);
    }
}
