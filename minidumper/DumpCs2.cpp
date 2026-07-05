#include "pch.h"
#include "DumpCs2.h"

#include "Il2CppFunctions.h"
#include "PrintHelper.h"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include "il2cpp/il2cpp-tabledefs.h"

struct MethodInfo
{
    const Il2CppClass* klass;
    const void* method_pointer;
    uint8_t _pad[0x20];
    uint16_t flags;
};

namespace
{
    std::string SafeString(const char* value, const char* fallback = "")
    {
        return value ? value : fallback;
    }

    std::string ToBinary32(uint32_t value)
    {
        std::string result = "0b";
        for (int i = 31; i >= 0; --i) {
            result += ((value >> i) & 1) ? '1' : '0';
        }
        return result;
    }

    std::string FormatTypeName(const std::string& name)
    {
        if (name == "System.Int32") return "int";
        if (name == "System.UInt32") return "uint";
        if (name == "System.Int16") return "short";
        if (name == "System.UInt16") return "ushort";
        if (name == "System.Int64") return "long";
        if (name == "System.UInt64") return "ulong";
        if (name == "System.Byte") return "byte";
        if (name == "System.SByte") return "sbyte";
        if (name == "System.Boolean") return "bool";
        if (name == "System.Single") return "float";
        if (name == "System.Double") return "double";
        if (name == "System.String") return "string";
        if (name == "System.Char") return "char";
        if (name == "System.Object") return "object";
        if (name == "System.Void") return "void";
        if (name == "System.Decimal") return "decimal";

        return name;
    }

    std::string GetTypeName(const Il2CppType* type, const char* fallback = "object")
    {
        if (!type || !il2cpp_type_get_name) {
            return fallback;
        }

        auto* name = il2cpp_type_get_name(type);
        return FormatTypeName(SafeString(name, fallback));
    }

    std::string GetIl2CppClassName(const Il2CppClass* klass, const char* fallback = "UnknownClass")
    {
        if (!klass || !il2cpp_class_get_name) {
            return fallback;
        }

        return SafeString(il2cpp_class_get_name(const_cast<Il2CppClass*>(klass)), fallback);
    }

    std::string GetClassNamespace(const Il2CppClass* klass)
    {
        if (!klass || !il2cpp_class_get_namespace) {
            return "";
        }

        return SafeString(il2cpp_class_get_namespace(const_cast<Il2CppClass*>(klass)));
    }

    std::string GetParentName(const Il2CppClass* klass)
    {
        if (!klass || !il2cpp_class_get_parent || !il2cpp_class_get_name) {
            return "";
        }

        auto* parent = il2cpp_class_get_parent(const_cast<Il2CppClass*>(klass));
        return parent ? GetIl2CppClassName(parent, "") : "";
    }

    uint32_t GetFieldFlags(FieldInfo* field)
    {
        if (!field || !il2cpp_field_get_flags) {
            return 0;
        }

        return static_cast<uint32_t>(il2cpp_field_get_flags(field));
    }

    uint32_t GetMethodFlags(const MethodInfo* method)
    {
        if (!method) {
            return 0;
        }

        return method->flags;
    }

    uintptr_t GetMethodPointer(const MethodInfo* method)
    {
        if (!method) {
            return 0;
        }

        return reinterpret_cast<uintptr_t>(method->method_pointer);
    }

    uintptr_t GetRva(uintptr_t address)
    {
        const auto base = GetGameAssemblyModuleBase();
        if (!base || address < base) {
            return 0;
        }

        return address - base;
    }

    std::string GetParamName(const MethodInfo* method, uint32_t index)
    {
        if (method && il2cpp_method_get_param_name) {
            const auto* name = il2cpp_method_get_param_name(method, index);
            if (name && *name) {
                return name;
            }
        }

        return "arg" + std::to_string(index + 1);
    }

    void DumpFields(std::ostringstream& os, const Il2CppClass* klass)
    {
        if (!klass || !il2cpp_class_get_fields) {
            return;
        }

        void* iter = nullptr;
        while (auto* field = il2cpp_class_get_fields(const_cast<Il2CppClass*>(klass), &iter)) {
            const auto flags = GetFieldFlags(field);
            if (il2cpp_field_get_offset) {
                os << "\t0x" << std::hex << il2cpp_field_get_offset(field) << std::dec << " | ";
            }
            else {
                os << "\t";
            }

            if ((flags & FIELD_ATTRIBUTE_STATIC) != 0) {
                os << "static ";
            }

            const auto* fieldType = il2cpp_field_get_type ? il2cpp_field_get_type(field) : nullptr;
            const auto fieldName = il2cpp_field_get_name ? SafeString(il2cpp_field_get_name(field), "unknownField") : "unknownField";
            os << GetTypeName(fieldType) << " " << fieldName << ";\n";
        }
    }

    void DumpMethods(std::ostringstream& os, const Il2CppClass* klass)
    {
        if (!klass || !il2cpp_class_get_methods) {
            return;
        }

        void* iter = nullptr;
        while (const auto* method = il2cpp_class_get_methods(const_cast<Il2CppClass*>(klass), &iter)) {
            const auto flags = GetMethodFlags(method);
            const auto methodPointer = GetMethodPointer(method);
            const auto paramCount = il2cpp_method_get_param_count ? il2cpp_method_get_param_count(method) : 0;
            const auto methodName = il2cpp_method_get_name ? SafeString(il2cpp_method_get_name(method), "unknownMethod") : "unknownMethod";
            os << "\t[Flags: " << ToBinary32(flags) << "] [ParamsCount: " << paramCount << "]";
            if (methodPointer) {
                os << " |RVA: 0x" << std::uppercase << std::hex << GetRva(methodPointer) << std::nouppercase << std::dec << "|";
            }
            os << "\n\t";

            if ((flags & METHOD_ATTRIBUTE_STATIC) != 0) {
                os << "static ";
            }

            const auto* returnType = il2cpp_method_get_return_type ? il2cpp_method_get_return_type(method) : nullptr;
            os << GetTypeName(returnType, "void") << " " << methodName << "(";

            for (uint32_t i = 0; i < paramCount; ++i) {
                const auto* paramType = il2cpp_method_get_param ? il2cpp_method_get_param(method, i) : nullptr;
                os << GetTypeName(paramType) << " " << GetParamName(method, i);
                if (i + 1 < paramCount) {
                    os << ", ";
                }
            }

            os << ");\n\n";
        }
    }

    void DumpClass(std::ostringstream& os, const Il2CppImage* image, const Il2CppClass* klass)
    {
        if (!klass) {
            return;
        }

        const auto namespaze = GetClassNamespace(klass);
        const auto className = GetIl2CppClassName(klass);
        DebugPrintA("[DumpCs2] Dumping class: %s\n", className.c_str());

        os << "namespace: " << namespaze << "\n";
        os << "Assembly: ";
        if (image && il2cpp_image_get_name) {
            os << SafeString(il2cpp_image_get_name(image));
        }
        os << "\n";

        os << "class " << className;
        const auto parentName = GetParentName(klass);
        if (!parentName.empty()) {
            os << " : " << parentName;
        }
        os << " {\n\n";

        DumpFields(os, klass);
        os << "\n";
        DumpMethods(os, klass);
        os << "}\n\n";
    }

    void DumpImage(std::ostringstream& os, const Il2CppImage* image)
    {
        if (!image || !il2cpp_image_get_class_count || !il2cpp_image_get_class) {
            return;
        }

        const auto classCount = il2cpp_image_get_class_count(image);
        for (size_t i = 0; i < classCount; ++i) {
            DumpClass(os, image, il2cpp_image_get_class(image, i));
        }
    }

    void Render(std::ostringstream& os)
    {
        os << "// Create by minidump\n\n";

        auto* domain = il2cpp_domain_get();
        if (!domain) {
            DebugPrintA("[DumpCs2] il2cpp_domain_get 返回空指针。\n");
            return;
        }

        size_t assemblyCount = 0;
        auto** assemblies = il2cpp_domain_get_assemblies(domain, &assemblyCount);
        if (!assemblies) {
            DebugPrintA("[DumpCs2] il2cpp_domain_get_assemblies 返回空指针。\n");
            return;
        }

        for (size_t i = 0; i < assemblyCount; ++i) {
            const auto* image = assemblies[i] ? il2cpp_assembly_get_image(assemblies[i]) : nullptr;
            DumpImage(os, image);
        }
    }
}

void DumpCs2(const char* path)
{
    const std::filesystem::path filePath(path);
    const auto directory = filePath.parent_path();
    if (!directory.empty() && !std::filesystem::exists(directory)) {
        std::filesystem::create_directories(directory);
    }

    std::ofstream file(path, std::ios::binary);
    if (!file.is_open()) {
        DebugPrintA("[DumpCs2] 打开文件失败: %s\n", path);
        return;
    }

    DebugPrintA("[DumpCs2] dumping...\n");
    std::ostringstream output;
    Render(output);
    file << output.str();
    DebugPrintA("[DumpCs2] dump done: %s\n", path);
}
