import { addresses, base } from "./addresses.js";
import { text } from "./memory.js";

const options: NativeFunctionOptions = { abi: "win64", scheduling: "exclusive" };
const bind = <R extends NativeFunctionReturnType, A extends NativeFunctionArgumentType[]>(
    name: keyof typeof addresses.apis, result: R, args: [...A]) =>
    new NativeFunction<R, A>(base.add(addresses.apis[name]), result, args, options);

const imageName = bind("il2cpp_image_get_name", "pointer", ["pointer"]);
const className = bind("il2cpp_class_get_name", "pointer", ["pointer"]);
const classNamespace = bind("il2cpp_class_get_namespace", "pointer", ["pointer"]);
const fieldName = bind("il2cpp_field_get_name", "pointer", ["pointer"]);

export const api = {
    "il2cpp_domain_get": bind("il2cpp_domain_get", "pointer", []),
    "il2cpp_domain_get_assemblies": bind("il2cpp_domain_get_assemblies", "pointer", ["pointer", "pointer"]),
    "il2cpp_assembly_get_image": bind("il2cpp_assembly_get_image", "pointer", ["pointer"]),
    "il2cpp_image_get_name": (image: NativePointer) => text(imageName(image)),
    "il2cpp_image_get_class_count": bind("il2cpp_image_get_class_count", "uint32", ["pointer"]),
    "il2cpp_image_get_class": bind("il2cpp_image_get_class", "pointer", ["pointer", "uint32"]),
    "il2cpp_class_from_type": bind("il2cpp_class_from_type", "pointer", ["pointer"]),
    "il2cpp_class_get_name": (klass: NativePointer) => text(className(klass)),
    "il2cpp_class_get_namespace": (klass: NativePointer) => text(classNamespace(klass)),
    "il2cpp_class_get_fields": bind("il2cpp_class_get_fields", "pointer", ["pointer", "pointer"]),
    "il2cpp_class_get_interfaces": bind("il2cpp_class_get_interfaces", "pointer", ["pointer", "pointer"]),
    "il2cpp_class_get_methods": bind("il2cpp_class_get_methods", "pointer", ["pointer", "pointer"]),
    "il2cpp_class_get_image": (klass: NativePointer) => klass.readPointer(),
    "il2cpp_class_get_type": (klass: NativePointer) => klass.add(0xa0),
    "il2cpp_class_get_parent": (klass: NativePointer) => klass.add(0x80).readPointer(),
    "il2cpp_field_get_name": (field: NativePointer) => text(fieldName(field)),
    "il2cpp_field_get_parent": bind("il2cpp_field_get_parent", "pointer", ["pointer"]),
    "il2cpp_field_get_offset": bind("il2cpp_field_get_offset", "uint32", ["pointer"]),
    "il2cpp_field_get_type": bind("il2cpp_field_get_type", "pointer", ["pointer"]),
    "il2cpp_field_get_value_object": bind("il2cpp_field_get_value_object", "pointer", ["pointer", "pointer"]),
    "il2cpp_field_set_value_object": bind("il2cpp_field_set_value_object", "void", ["pointer", "pointer", "pointer"]),
    "il2cpp_method_get_class": (method: NativePointer) => method.add(0x20).readPointer(),
    "il2cpp_method_get_name": bind("il2cpp_method_get_name", "pointer", ["pointer"]),
    "il2cpp_method_get_return_type": bind("il2cpp_method_get_return_type", "pointer", ["pointer"]),
    "il2cpp_method_get_param_count": (method: NativePointer) => method.add(0x36).readU8(),
    "il2cpp_method_get_param": bind("il2cpp_method_get_param", "pointer", ["pointer", "uint32"]),
    "il2cpp_method_get_param_name": bind("il2cpp_method_get_param_name", "pointer", ["pointer", "uint32"]),
    "il2cpp_thread_current": bind("il2cpp_thread_current", "pointer", []),
    "il2cpp_thread_attach": bind("il2cpp_thread_attach", "pointer", ["pointer"]),
    "il2cpp_thread_detach": bind("il2cpp_thread_detach", "void", ["pointer"]),
    "il2cpp_runtime_invoke": bind("il2cpp_runtime_invoke", "pointer", ["pointer", "pointer", "pointer", "pointer"]),
    "il2cpp::vm::Object::New": bind("il2cpp::vm::Object::New", "pointer", ["pointer"]),
    "il2cpp_array_new": bind("il2cpp_array_new", "pointer", ["pointer", "uint64"]),
    "il2cpp_gchandle_new": bind("il2cpp_gchandle_new", "uint32", ["pointer", "bool"]),
    "il2cpp_gchandle_free": bind("il2cpp_gchandle_free", "void", ["uint32"]),
    "il2cpp_string_new_len": bind("il2cpp_string_new_len", "pointer", ["pointer", "int"]),
    "il2cpp::vm::Class::FromTypeDefinition": bind("il2cpp::vm::Class::FromTypeDefinition", "pointer", ["int"])
};

export function classAt(index: number): NativePointer {
    if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff) throw new Error("Invalid type definition index: " + index);
    const klass = api["il2cpp::vm::Class::FromTypeDefinition"](index);
    if (klass.isNull()) throw new Error("No class at type definition index: " + index);
    return klass;
}
