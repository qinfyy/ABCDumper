import { api } from "../api.js";
import { Il2CppTypeEnum, TYPE_ATTRIBUTE_INTERFACE } from "../constant.js";
import { NativeStruct } from "../memory.js";
import { Il2CppField } from "./field.js";
import { Il2CppImage } from "./image.js";
import { Il2CppMethod } from "./method.js";
import { Il2CppType } from "./type.js";

export interface MethodQuery {
    parameterCount?: number;
    parameterTypes?: readonly string[];
    returnType?: string;
    rva?: number;
    inherited?: boolean;
    isStatic?: boolean;
    native?: boolean;
    explicit?: boolean;
}

export class Il2CppClass extends NativeStruct {
    get name(): string { return api.il2cpp_class_get_name(this.handle); }
    get namespace(): string { return api.il2cpp_class_get_namespace(this.handle); }
    get fullName(): string { return this.resolveFullName(0); }
    get image(): Il2CppImage { return new Il2CppImage(api.il2cpp_class_get_image(this.handle)); }
    get definition(): NativePointer { return this.handle.add(0x10).readPointer(); }
    get type(): Il2CppType { return new Il2CppType(api.il2cpp_class_get_type(this.handle)); }
    get flags(): number { return this.handle.add(0xf0).readU32(); }
    get kind(): "class" | "struct" | "enum" | "interface" {
        if (this.flags & TYPE_ATTRIBUTE_INTERFACE) return "interface";
        if (this.type.isEnum) return "enum";
        if (this.type.tag === Il2CppTypeEnum.IL2CPP_TYPE_VALUETYPE || this.parent?.fullName === "System.ValueType" ||
            this.type.tag >= Il2CppTypeEnum.IL2CPP_TYPE_BOOLEAN && this.type.tag <= Il2CppTypeEnum.IL2CPP_TYPE_R8) return "struct";
        return "class";
    }
    get instanceSize(): number { return this.handle.add(0x106).readU16(); }
    get isValueType(): boolean { return this.kind === "struct" || this.kind === "enum"; }
    get staticSize(): number { return this.handle.add(0x116).readU16(); }
    get fieldCount(): number { return this.handle.add(0x11e).readU16(); }
    get methodCount(): number { return this.handle.add(0x108).readU16(); }
    get vtableCount(): number { return this.handle.add(0x10a).readU16(); }
    get vtableStride(): number { return 16; }
    get extraVtable(): NativePointer { return this.handle.add(0x128 + this.vtableCount * this.vtableStride); }
    get genericContainer(): NativePointer { return this.handle.add(0xf8).readPointer(); }
    get parent(): Il2CppClass | null {
        const handle = api.il2cpp_class_get_parent(this.handle);
        return handle.isNull() ? null : new Il2CppClass(handle);
    }
    get declaringClass(): Il2CppClass | null {
        const handle = this.handle.add(0x38).readPointer();
        return handle.isNull() ? null : new Il2CppClass(handle);
    }

    private resolveFullName(depth: number): string {
        if (depth > 32) throw new Error("Invalid declaring class chain");
        const name = this.name, outer = this.declaringClass;
        if (outer) return outer.resolveFullName(depth + 1) + "." + name;
        const namespace = this.namespace;
        return namespace ? namespace + "." + name : name;
    }

    get interfaces(): Il2CppType[] {
        const iterator = Memory.alloc(8).writePointer(NULL), result: Il2CppType[] = [];
        for (let handle = api["il2cpp_class_get_interfaces"](this.handle, iterator); !handle.isNull();
            handle = api["il2cpp_class_get_interfaces"](this.handle, iterator)) {
            result.push(new Il2CppType(api["il2cpp_class_get_type"](handle)));
        }
        return result;
    }

    *hierarchy(): Generator<Il2CppClass> {
        const seen = new Set<string>();
        for (let klass: Il2CppClass | null = this; klass; klass = klass.parent) {
            if (seen.size >= 32 || seen.has(klass.toString())) throw new Error("Invalid class hierarchy");
            seen.add(klass.toString());
            yield klass;
        }
    }

    findMethod(name: string, query: MethodQuery = {}): Il2CppMethod | undefined {
        for (const klass of query.inherited ? this.hierarchy() : [this]) {
            let match: Il2CppMethod | undefined;
            for (const method of klass.methods()) {
                if (method.name !== name && !(query.explicit && method.name.endsWith("." + name))) continue;
                if (query.isStatic !== undefined && method.isStatic !== query.isStatic || query.native && method.body.isNull()) continue;
                if (query.parameterCount !== undefined && method.parameterCount !== query.parameterCount) continue;
                if (query.returnType !== undefined && method.returnType.name !== query.returnType) continue;
                if (query.rva !== undefined && method.rva !== "0x" + query.rva.toString(16)) continue;
                if (query.parameterTypes && (method.parameterCount !== query.parameterTypes.length ||
                    !method.parameters.every((parameter, i) => parameter.type.name === query.parameterTypes![i]))) continue;
                if (name) return method;
                if (match) throw new Error("Ambiguous unnamed method signature: " + klass.fullName);
                match = method;
            }
            if (match) return match;
        }
        return undefined;
    }

    ensureLayout(): void {
        if (!this.instanceSize) throw new Error("Runtime class layout is uninitialized: " + this.fullName);
    }

    *fields(): Generator<Il2CppField> {
        const iterator = Memory.alloc(8);
        iterator.writePointer(NULL);
        for (let field = api.il2cpp_class_get_fields(this.handle, iterator); !field.isNull(); field = api.il2cpp_class_get_fields(this.handle, iterator)) {
            yield new Il2CppField(field);
        }
    }

    *methods(): Generator<Il2CppMethod> {
        const iterator = Memory.alloc(8);
        iterator.writePointer(NULL);
        for (let method = api.il2cpp_class_get_methods(this.handle, iterator); !method.isNull(); method = api.il2cpp_class_get_methods(this.handle, iterator)) {
            yield new Il2CppMethod(method);
        }
    }

    summary(index?: number) {
        return {
            index, klass: this.toString(), name: this.name, namespace: this.namespace, image: this.image.name,
            kind: this.kind, flags: this.flags, fieldCount: this.fieldCount, methodCount: this.methodCount
        };
    }

    inspect(index?: number) {
        return {
            ...this.summary(index), parent: this.parent?.fullName ?? null,
            declaringClass: this.declaringClass?.fullName ?? null, interfaces: this.interfaces.map(type => type.name),
            instanceSize: this.instanceSize, staticSize: this.staticSize, genericContainer: this.genericContainer.toString(),
            fields: Array.from(this.fields(), field => field.summary()), methods: Array.from(this.methods(), method => method.summary())
        };
    }
}
