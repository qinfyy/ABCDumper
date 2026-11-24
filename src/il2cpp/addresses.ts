export const addresses = {
    apis: {
        "il2cpp_domain_get": 0x791740,
        "il2cpp_domain_get_assemblies": 0x7f4630,
        "il2cpp_assembly_get_image": 0x7f3f90,
        "il2cpp_image_get_name": 0x7f5bf0,
        "il2cpp_image_get_class_count": 0x7f5ca0,
        "il2cpp_image_get_class": 0x7f5cb0,
        "il2cpp_class_from_type": 0x7f4050,
        "il2cpp_class_get_name": 0x7f43b0,
        "il2cpp_class_get_namespace": 0x7f43e0,
        "il2cpp_class_get_fields": 0x7f4110,
        "il2cpp_class_get_interfaces": 0x7f41e0,
        "il2cpp_class_get_methods": 0x7f42d0,
        "il2cpp_field_get_name": 0x7f4970,
        "il2cpp_field_get_parent": 0x7f4980,
        "il2cpp_field_get_offset": 0x7f4990,
        "il2cpp_field_get_type": 0x7f49a0,
        "il2cpp_field_get_value_object": 0x7f49f0,
        "il2cpp_field_set_value_object": 0x7f4a10,
        "il2cpp_method_get_name": 0x7f4f00,
        "il2cpp_method_get_return_type": 0x7f4ec0,
        "il2cpp_method_get_param": 0x7f4f90,
        "il2cpp_method_get_param_name": 0x7f4fe0,
        "il2cpp_thread_current": 0x7f5500,
        "il2cpp_thread_attach": 0x7f5540,
        "il2cpp_thread_detach": 0x7f5550,
        "il2cpp_runtime_invoke": 0x7f51f0,
        "il2cpp::vm::Object::New": 0x7a3b30,
        "il2cpp_array_new": 0x7eec50,
        "il2cpp_gchandle_new": 0x7f4e00,
        "il2cpp_gchandle_free": 0x771580,
        "il2cpp_string_new_len": 0x7f5450,
        "il2cpp::vm::Class::FromTypeDefinition": 0x7d03a0
    }
} as const;

export const target = Process.getModuleByName("GameAssembly.dll");
export const base = target.base;

// ABC_CN_Windows_0.75.2: first type reference and its flags in the native registration table.
if (Process.platform !== "windows" || Process.arch !== "x64" || target.size !== 0x935d000 ||
    !base.add(0x157cdb0).readPointer().equals(base.add(0x1ed85c0)) || base.add(0x1ed85c8).readU32() !== 0x001e0000) {
    throw new Error("GameAssembly.dll does not match ABC_CN_Windows_0.75.2");
}
