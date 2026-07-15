#include "pch.h"
#include "DumpCs2.h"

#include "Constants.h"
#include "Il2CppFunctions.h"
#include "Memory.h"
#include "PrintHelper.h"
#include "Util.h"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>
#include <algorithm>
#include <cstring>
#include <cstdio>
#include "il2cpp/il2cpp-tabledefs.h"

struct MethodInfo
{
    const Il2CppClass* klass;
    const void* method_pointer;
    uint8_t _pad[0x1A];
    uint16_t flags;
};

static_assert(offsetof(MethodInfo, method_pointer) == 0x8);
static_assert(offsetof(MethodInfo, flags) == 0x2A);

namespace
{
    constexpr bool kDumpClassMembers = true;
    constexpr bool kDumpParentClass = true;
    constexpr bool kDumpInterfaces = true;
    constexpr bool kDumpInternalAssemblyTable = false;

    struct SizeAndAlignment
    {
        uint32_t size;
        uint32_t alignment;
    };

    const char* DecodeInternalString(uintptr_t value)
    {
        const char* result = nullptr;
        const auto gameAssemblyBase = GetGameAssemblyModuleBase();
        if (!gameAssemblyBase) {
            return nullptr;
        }

        using DecodeString = const char*(__fastcall*)(uintptr_t value);
        auto* decodeString = reinterpret_cast<DecodeString>(gameAssemblyBase + kStringDecodeRva);
        __try {
            result = decodeString(value);
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] 内部字符串解码异常: value=0x%llX\n", static_cast<unsigned long long>(value));
        }

        return ValidateCString(result);
    }

    const Il2CppClass* TryGetImageClass(const Il2CppImage* image, size_t index)
    {
        const Il2CppClass* klass = nullptr;
        __try {
            klass = il2cpp_image_get_class ? il2cpp_image_get_class(image, index) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_image_get_class 异常: image=%p index=%zu\n", image, index);
        }

        return klass;
    }

    const char* TryGetTypeName(const Il2CppType* type)
    {
        if (!type || !IsReadablePointer(type)) {
            return nullptr;
        }

        const char* name = nullptr;
        __try {
            name = il2cpp_type_get_name ? il2cpp_type_get_name(type) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_type_get_name 异常: type=%p\n", type);
        }

        return ValidateCString(name);
    }

    uint32_t TryGetTypeAttrs(const Il2CppType* type)
    {
        if (!type || !IsReadablePointer(type)) {
            return 0;
        }

        uint32_t attrs = 0;
        __try {
            attrs = il2cpp_type_get_attrs ? il2cpp_type_get_attrs(type) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_type_get_attrs 异常: type=%p\n", type);
        }

        return attrs;
    }

    int TryGetTypeKind(const Il2CppType* type)
    {
        if (!type || !IsReadablePointer(type)) {
            return -1;
        }

        int typeKind = -1;
        __try {
            typeKind = il2cpp_type_get_type ? il2cpp_type_get_type(type) : -1;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_type_get_type 异常: type=%p\n", type);
        }

        return typeKind;
    }

    const char* TryGetClassName(const Il2CppClass* klass)
    {
        const char* name = nullptr;
        __try {
            name = il2cpp_class_get_name ? il2cpp_class_get_name(const_cast<Il2CppClass*>(klass)) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_get_name 异常: klass=%p\n", klass);
        }

        return ValidateCString(name);
    }

    const char* TryGetClassNamespace(const Il2CppClass* klass)
    {
        const char* namespaze = nullptr;
        __try {
            namespaze = il2cpp_class_get_namespace ? il2cpp_class_get_namespace(const_cast<Il2CppClass*>(klass)) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_get_namespace 异常: klass=%p\n", klass);
        }

        return ValidateCString(namespaze);
    }

    uint32_t TryGetClassFlags(const Il2CppClass* klass)
    {
        uint32_t flags = 0;
        __try {
            flags = il2cpp_class_get_flags ? static_cast<uint32_t>(il2cpp_class_get_flags(klass)) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_get_flags 异常: klass=%p\n", klass);
        }

        return flags;
    }

    Il2CppClass* TryGetClassParent(const Il2CppClass* klass)
    {
        Il2CppClass* parent = nullptr;
        __try {
            parent = il2cpp_class_get_parent ? il2cpp_class_get_parent(const_cast<Il2CppClass*>(klass)) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_get_parent 异常: klass=%p\n", klass);
        }

        return parent;
    }

    Il2CppClass* TryGetNextInterface(const Il2CppClass* klass, void** iter)
    {
        Il2CppClass* interfaceClass = nullptr;
        __try {
            interfaceClass = il2cpp_class_get_interfaces ? il2cpp_class_get_interfaces(const_cast<Il2CppClass*>(klass), iter) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_get_interfaces 异常: klass=%p iter=%p\n", klass, iter ? *iter : nullptr);
        }

        return interfaceClass;
    }

    int32_t TryGetClassInstanceSize(const Il2CppClass* klass)
    {
        int32_t size = 0;
        __try {
            size = il2cpp_class_instance_size ? il2cpp_class_instance_size(const_cast<Il2CppClass*>(klass)) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_instance_size 异常: klass=%p\n", klass);
        }

        return size;
    }

    bool TryIsClassValueType(const Il2CppClass* klass)
    {
        bool isValueType = false;
        __try {
            isValueType = il2cpp_class_is_valuetype ? il2cpp_class_is_valuetype(klass) : false;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_is_valuetype 异常: klass=%p\n", klass);
        }

        return isValueType;
    }

    bool TryIsClassEnum(const Il2CppClass* klass)
    {
        bool isEnum = false;
        __try {
            isEnum = il2cpp_class_is_enum ? il2cpp_class_is_enum(klass) : false;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_is_enum 异常: klass=%p\n", klass);
        }

        return isEnum;
    }

    int32_t TryGetClassValueSize(Il2CppClass* klass, uint32_t* alignment)
    {
        int32_t size = 0;
        __try {
            size = il2cpp_class_value_size ? il2cpp_class_value_size(klass, alignment) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_value_size 异常: klass=%p\n", klass);
        }

        return size;
    }

    Il2CppClass* TryGetClassFromType(const Il2CppType* type)
    {
        if (!type || !IsReadablePointer(type)) {
            return nullptr;
        }

        Il2CppClass* klass = nullptr;
        __try {
            klass = il2cpp_class_from_type ? il2cpp_class_from_type(type) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_from_type 异常: type=%p\n", type);
        }

        return klass;
    }

    bool TryIsTypeByRef(const Il2CppType* type)
    {
        if (!type || !IsReadablePointer(type)) {
            return false;
        }

        bool isByRef = false;
        __try {
            isByRef = il2cpp_type_is_byref ? il2cpp_type_is_byref(type) : false;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_type_is_byref 异常: type=%p\n", type);
        }

        return isByRef;
    }

    FieldInfo* TryGetNextField(const Il2CppClass* klass, void** iter)
    {
        FieldInfo* field = nullptr;
        __try {
            field = il2cpp_class_get_fields ? il2cpp_class_get_fields(const_cast<Il2CppClass*>(klass), iter) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_get_fields 异常: klass=%p iter=%p\n", klass, iter ? *iter : nullptr);
        }

        return field;
    }

    const MethodInfo* TryGetNextMethod(const Il2CppClass* klass, void** iter)
    {
        const MethodInfo* method = nullptr;
        __try {
            method = il2cpp_class_get_methods ? il2cpp_class_get_methods(const_cast<Il2CppClass*>(klass), iter) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_class_get_methods 异常: klass=%p iter=%p\n", klass, iter ? *iter : nullptr);
        }

        return method;
    }

    const char* TryGetFieldName(FieldInfo* field)
    {
        const char* name = nullptr;
        __try {
            name = il2cpp_field_get_name ? il2cpp_field_get_name(field) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_field_get_name 异常: field=%p\n", field);
        }

        return ValidateCString(name);
    }

    const Il2CppType* TryGetFieldType(FieldInfo* field)
    {
        const Il2CppType* type = nullptr;
        __try {
            type = il2cpp_field_get_type ? il2cpp_field_get_type(field) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_field_get_type 异常: field=%p\n", field);
        }

        return type;
    }

    size_t TryGetFieldOffset(FieldInfo* field)
    {
        size_t offset = 0;
        __try {
            offset = il2cpp_field_get_offset ? il2cpp_field_get_offset(field) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_field_get_offset 异常: field=%p\n", field);
        }

        return offset;
    }

    uint32_t TryGetFieldFlags(FieldInfo* field)
    {
        uint32_t flags = 0;
        __try {
            flags = il2cpp_field_get_flags ? static_cast<uint32_t>(il2cpp_field_get_flags(field)) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
        }

        return flags;
    }

    const char* TryGetMethodName(const MethodInfo* method)
    {
        const char* name = nullptr;
        __try {
            name = il2cpp_method_get_name ? il2cpp_method_get_name(method) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_method_get_name 异常: method=%p\n", method);
        }

        return ValidateCString(name);
    }

    const Il2CppType* TryGetMethodReturnType(const MethodInfo* method)
    {
        const Il2CppType* type = nullptr;
        __try {
            type = il2cpp_method_get_return_type ? il2cpp_method_get_return_type(method) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_method_get_return_type 异常: method=%p\n", method);
        }

        return type;
    }

    uint32_t TryGetMethodParamCount(const MethodInfo* method)
    {
        uint32_t count = 0;
        __try {
            count = il2cpp_method_get_param_count ? il2cpp_method_get_param_count(method) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_method_get_param_count 异常: method=%p\n", method);
        }

        return count;
    }

    const Il2CppType* TryGetMethodParam(const MethodInfo* method, uint32_t index)
    {
        const Il2CppType* type = nullptr;
        __try {
            type = il2cpp_method_get_param ? il2cpp_method_get_param(method, index) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_method_get_param 异常: method=%p index=%u\n", method, index);
        }

        return type;
    }

    const char* TryGetMethodParamName(const MethodInfo* method, uint32_t index)
    {
        const char* name = nullptr;
        __try {
            name = il2cpp_method_get_param_name ? il2cpp_method_get_param_name(method, index) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_method_get_param_name 异常: method=%p index=%u\n", method, index);
        }

        return ValidateCString(name);
    }

    uint32_t TryGetMethodFlags(const MethodInfo* method)
    {
        uint32_t flags = 0;
        __try {
            flags = il2cpp_method_get_flags ? il2cpp_method_get_flags(method, nullptr) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_method_get_flags 异常: method=%p\n", method);
        }

        return flags;
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

    std::string GetTypeName(const Il2CppType* type, const char* fallback = "UnknownType")
    {
        if (!type || !il2cpp_type_get_name) {
            return fallback;
        }

        switch (TryGetTypeKind(type)) {
        case 0x01: return "void";
        case 0x02: return "bool";
        case 0x03: return "char";
        case 0x04: return "sbyte";
        case 0x05: return "byte";
        case 0x06: return "short";
        case 0x07: return "ushort";
        case 0x08: return "int";
        case 0x09: return "uint";
        case 0x0A: return "long";
        case 0x0B: return "ulong";
        case 0x0C: return "float";
        case 0x0D: return "double";
        case 0x0E: return "string";
        case 0x1C: return "object";
        default: break;
        }

        auto* name = TryGetTypeName(type);
        return FormatTypeName(SafeString(name, fallback));
    }

    std::string GetIl2CppClassName(const Il2CppClass* klass, const char* fallback = "UnknownClass")
    {
        if (!klass || !il2cpp_class_get_name) {
            return fallback;
        }

        return SafeString(TryGetClassName(klass), fallback);
    }

    std::string GetClassNamespace(const Il2CppClass* klass)
    {
        if (!klass || !il2cpp_class_get_namespace) {
            return "";
        }

        return SafeString(TryGetClassNamespace(klass));
    }

    std::string GetParentName(const Il2CppClass* klass)
    {
        if (!klass || !il2cpp_class_get_parent || !il2cpp_class_get_name) {
            return "";
        }

        auto* parent = TryGetClassParent(klass);
        if (parent && !IsReadablePointer(parent, 0x128)) {
            DebugPrintA("[DumpCs2] 跳过不可读父类: klass=%p parent=%p\n", klass, parent);
            return "";
        }

        return parent ? GetIl2CppClassName(parent, "") : "";
    }

    uint32_t GetFieldFlags(FieldInfo* field)
    {
        if (!field) {
            return 0;
        }

        return TryGetFieldFlags(field);
    }

    uint32_t GetMethodFlags(const MethodInfo* method)
    {
        if (!method) {
            return 0;
        }

        return TryGetMethodFlags(method);
    }

    uintptr_t GetMethodPointer(const MethodInfo* method)
    {
        if (!method || !IsReadablePointer(method, kNexusMethodPointerOffset + sizeof(uintptr_t))) {
            return 0;
        }

        const auto gameAssemblyBase = GetGameAssemblyModuleBase();
        if (!gameAssemblyBase) {
            return 0;
        }

        const size_t candidateOffsets[] = { kNexusMethodPointerOffset, kNexusMethodPointerFallbackOffset, offsetof(MethodInfo, method_pointer) };
        for (const auto offset : candidateOffsets) {
            if (!IsReadablePointer(reinterpret_cast<const uint8_t*>(method) + offset, sizeof(uintptr_t))) {
                continue;
            }

            const auto methodPointer = *reinterpret_cast<const uintptr_t*>(reinterpret_cast<const uint8_t*>(method) + offset);
            if (methodPointer >= gameAssemblyBase && IsExecutablePointer(methodPointer)) {
                return methodPointer;
            }
        }

        return 0;
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
        const auto* name = TryGetMethodParamName(method, index);
        if (name && name[0] != '\0') {
            return name;
        }

        return "arg" + std::to_string(index + 1);
    }

    std::string GetParamModifier(const Il2CppType* type)
    {
        if (!type || !IsReadablePointer(type)) {
            return "";
        }

        const auto attrs = TryGetTypeAttrs(type);
        if (TryIsTypeByRef(type)) {
            if ((attrs & PARAM_ATTRIBUTE_OUT) != 0 && (attrs & PARAM_ATTRIBUTE_IN) == 0) {
                return "out ";
            }
            if ((attrs & PARAM_ATTRIBUTE_IN) != 0 && (attrs & PARAM_ATTRIBUTE_OUT) == 0) {
                return "in ";
            }
            return "ref ";
        }

        std::string modifier;
        const auto hasInAttribute = (attrs & PARAM_ATTRIBUTE_IN) != 0;
        const auto hasOutAttribute = (attrs & PARAM_ATTRIBUTE_OUT) != 0;
        if (hasInAttribute && hasOutAttribute) {
            return "[In, Out] ";
        }
        if (hasInAttribute) {
            modifier += "[In] ";
        }
        if (hasOutAttribute) {
            modifier += "[Out] ";
        }
        return modifier;
    }

    SizeAndAlignment GetTypeSizeAndAlignment(const Il2CppType* type)
    {
        if (!type) {
            return { sizeof(void*), sizeof(void*) };
        }

        if (TryIsTypeByRef(type)) {
            return { sizeof(void*), sizeof(void*) };
        }

        switch (TryGetTypeKind(type)) {
        case 0x02:
        case 0x04:
        case 0x05:
            return { 1, 1 };
        case 0x03:
        case 0x06:
        case 0x07:
            return { 2, 2 };
        case 0x08:
        case 0x09:
        case 0x0C:
            return { 4, 4 };
        case 0x0A:
        case 0x0B:
        case 0x0D:
        case 0x18:
        case 0x19:
            return { 8, 8 };
        case 0x0E:
        case 0x0F:
        case 0x12:
        case 0x13:
        case 0x14:
        case 0x1B:
        case 0x1C:
        case 0x1D:
        case 0x1E:
            return { sizeof(void*), sizeof(void*) };
        case 0x11:
        case 0x15:
        {
            auto* klass = TryGetClassFromType(type);
            if (!klass) {
                return { sizeof(void*), sizeof(void*) };
            }

            if (TryGetTypeKind(type) == 0x15 && !TryIsClassValueType(klass)) {
                return { sizeof(void*), sizeof(void*) };
            }

            uint32_t alignment = 0;
            const auto size = TryGetClassValueSize(klass, &alignment);
            if (size <= 0) {
                return { sizeof(void*), sizeof(void*) };
            }

            if (alignment == 0 || alignment > sizeof(void*)) {
                alignment = sizeof(void*);
            }

            return { static_cast<uint32_t>(size), alignment };
        }
        default:
            return { sizeof(void*), sizeof(void*) };
        }
    }

    void DumpFields(std::ostringstream& os, const Il2CppClass* klass, const std::string& className)
    {
        if (!klass) {
            return;
        }

        DebugPrintA("[DumpCs2] Dump fields: %s\n", className.c_str());
        const auto klassAddress = reinterpret_cast<uintptr_t>(klass);
        if (!IsReadablePointer(reinterpret_cast<const void*>(klassAddress + kClassFieldsOffset), sizeof(uintptr_t)) || !IsReadablePointer(reinterpret_cast<const void*>(klassAddress + kClassFieldCountOffset), sizeof(uint16_t))) {
            DebugPrintA("[DumpCs2] class 字段表地址不可读: klass=%p\n", klass);
            return;
        }

        auto fields = *reinterpret_cast<const uintptr_t*>(klassAddress + kClassFieldsOffset);
        const auto fieldCount = *reinterpret_cast<const uint16_t*>(klassAddress + kClassFieldCountOffset);
        if (fieldCount == 0) {
            return;
        }

        if (!fields && il2cpp_class_get_fields) {
            DebugPrintA("[DumpCs2] 字段表未初始化，尝试触发 builder: klass=%p count=%u\n", klass, fieldCount);
            void* iter = nullptr;
            const auto* firstField = TryGetNextField(klass, &iter);
            fields = *reinterpret_cast<const uintptr_t*>(klassAddress + kClassFieldsOffset);
            DebugPrintA("[DumpCs2] 字段 builder 返回: klass=%p firstField=%p iter=%p fields=%p\n", klass, firstField, iter, reinterpret_cast<const void*>(fields));
        }

        if (fieldCount > kMaxMemberCount || !IsReadablePointer(reinterpret_cast<const void*>(fields), static_cast<size_t>(fieldCount) * kFieldInfoSize)) {
            DebugPrintA("[DumpCs2] 字段表异常: klass=%p fields=%p count=%u\n", klass, reinterpret_cast<const void*>(fields), fieldCount);
            return;
        }

        uintptr_t protectedMetadataBase = 0;
        uint32_t metadataFieldStart = 0;
        const auto gameAssemblyBase = GetGameAssemblyModuleBase();
        if (gameAssemblyBase != 0 && IsReadablePointer(reinterpret_cast<const void*>(gameAssemblyBase + kProtectedMetadataBaseGlobalRva), sizeof(uintptr_t))) {
            protectedMetadataBase = *reinterpret_cast<const uintptr_t*>(gameAssemblyBase + kProtectedMetadataBaseGlobalRva);
        }
        if (IsReadablePointer(reinterpret_cast<const void*>(klassAddress + 0xA8), sizeof(uintptr_t))) {
            const auto classMetadata = *reinterpret_cast<const uintptr_t*>(klassAddress + 0xA8);
            if (IsReadablePointer(reinterpret_cast<const void*>(classMetadata + 0x44), sizeof(uint32_t))) {
                metadataFieldStart = *reinterpret_cast<const uint32_t*>(classMetadata + 0x44) ^ kFieldMetadataStartXor;
            }
        }

        struct FieldDumpRecord
        {
            std::string typeName;
            std::string name;
            uint32_t fieldOffset;
        };

        std::vector<FieldDumpRecord> fieldRecords;
        fieldRecords.reserve(fieldCount);

        for (uint16_t i = 0; i < fieldCount; ++i) {
            const auto field = fields + static_cast<uintptr_t>(i) * kFieldInfoSize;
            auto* fieldInfo = reinterpret_cast<FieldInfo*>(field);
            const auto* fieldName = TryGetFieldName(fieldInfo);
            const auto* fieldType = TryGetFieldType(fieldInfo);
            const auto typeReadable = fieldType && IsReadablePointer(fieldType);
            const auto fieldTypeName = typeReadable ? GetTypeName(fieldType) : std::string("UnknownType");
            std::string fieldNameText = SafeString(fieldName, "");
            auto fieldNamePrintable = !fieldNameText.empty();
            for (const auto ch : fieldNameText) {
                const auto byte = static_cast<unsigned char>(ch);
                if (byte < 0x20 || byte > 0x7E) {
                    fieldNamePrintable = false;
                    break;
                }
            }

            uint64_t rawNameToken = 0;
            uint64_t decodedNameToken = 0;
            if (!fieldNamePrintable && protectedMetadataBase && metadataFieldStart != 0) {
                const auto nameTokenAddress = protectedMetadataBase + 12ull * (static_cast<uint64_t>(metadataFieldStart) + i) + 12;
                if (IsReadablePointer(reinterpret_cast<const void*>(nameTokenAddress), sizeof(uint64_t))) {
                    rawNameToken = *reinterpret_cast<const uint64_t*>(nameTokenAddress);
                    decodedNameToken = rawNameToken ^ kFieldNameTokenXor;
                    char fallbackName[32]{};
                    sprintf_s(fallbackName, "%016llX", static_cast<unsigned long long>(decodedNameToken));
                    fieldNameText = fallbackName;
                    fieldNamePrintable = true;
                }
            }

            if (!fieldNamePrintable) {
                fieldNameText = "unknownField";
            }

            const auto fieldFlags = GetFieldFlags(fieldInfo);
            const auto offsetData = *reinterpret_cast<const uint32_t*>(field + 0x18);
            auto fieldOffset = (offsetData & 0xFFFFFFu) ^ kFieldValueApiOffsetXor;
            const auto apiOffset = TryGetFieldOffset(fieldInfo);
            auto sizeAndAlignment = SizeAndAlignment{ static_cast<uint32_t>(sizeof(void*)), static_cast<uint32_t>(sizeof(void*)) };
            auto typeKind = -1;
            if (typeReadable) {
                sizeAndAlignment = GetTypeSizeAndAlignment(fieldType);
                typeKind = TryGetTypeKind(fieldType);
            }

            DebugPrintA("[DumpCs2] 字段 offset: klass=%p class=%s index=%u field=%p name=%s type=%s typePtr=%p typeName=%s typeReadable=%d flags=0x%X finalOffset=0x%X apiOffset=0x%llX rawOffset=%08X rawNameToken=%016llX decodedNameToken=%016llX typeKind=0x%X size=%u align=%u\n", klass, className.c_str(), i, reinterpret_cast<const void*>(field), fieldNameText.c_str(), fieldTypeName.c_str(), fieldType, fieldTypeName.c_str(), typeReadable ? 1 : 0, fieldFlags, fieldOffset, static_cast<unsigned long long>(apiOffset), offsetData, static_cast<unsigned long long>(rawNameToken), static_cast<unsigned long long>(decodedNameToken), typeKind, sizeAndAlignment.size, sizeAndAlignment.alignment);

            fieldRecords.push_back({ fieldTypeName, fieldNameText, fieldOffset });
        }

        for (const auto& fieldRecord : fieldRecords) {
            os << "\t0x" << std::hex << fieldRecord.fieldOffset << std::dec << " | ";
            os << fieldRecord.typeName << " " << fieldRecord.name << ";\n";
        }
    }

    void DumpMethods(std::ostringstream& os, const Il2CppClass* klass, const std::string& className)
    {
        if (!klass || !il2cpp_class_get_methods) {
            return;
        }

        DebugPrintA("[DumpCs2] Dump methods: %s\n", className.c_str());
        size_t methodIndex = 0;
        void* iter = nullptr;
        while (methodIndex++ < kMaxMemberCount) {
            const auto* method = TryGetNextMethod(klass, &iter);
            if (!method) {
                break;
            }

            const auto flags = GetMethodFlags(method);
            const auto methodPointer = GetMethodPointer(method);
            const auto paramCount = TryGetMethodParamCount(method);
            const auto methodName = SafeString(TryGetMethodName(method), "unknownMethod");
            os << "\t[Flags: " << ToBinary32(flags) << "] [ParamsCount: " << paramCount << "]";
            if (methodPointer) {
                os << " |RVA: 0x" << std::uppercase << std::hex << GetRva(methodPointer) << std::nouppercase << std::dec << "|";
            }
            os << "\n\t";

            if ((flags & METHOD_ATTRIBUTE_STATIC) != 0) {
                os << "static ";
            }

            const auto* returnType = TryGetMethodReturnType(method);
            os << GetTypeName(returnType, "void") << " " << methodName << "(";

            for (uint32_t i = 0; i < paramCount; ++i) {
                const auto* paramType = TryGetMethodParam(method, i);
                os << GetParamModifier(paramType) << GetTypeName(paramType) << " " << GetParamName(method, i);
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

        if (!IsReadablePointer(klass, 0x128)) {
            DebugPrintA("[DumpCs2] 跳过不可读 class: %p\n", klass);
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

        if (TryIsClassEnum(klass)) {
            os << "enum ";
        }
        else if (TryIsClassValueType(klass)) {
            os << "struct ";
        }

        os << "class " << className;

        std::vector<std::string> inheritedNames;
        if constexpr (kDumpParentClass) {
            const auto parentName = GetParentName(klass);
            if (!parentName.empty()) {
                inheritedNames.push_back(parentName);
            }
        }

        if constexpr (kDumpInterfaces) {
            if (il2cpp_class_get_interfaces) {
                size_t interfaceIndex = 0;
                void* iter = nullptr;
                while (interfaceIndex++ < kMaxMemberCount) {
                    const auto* interfaceClass = TryGetNextInterface(klass, &iter);
                    if (!interfaceClass) {
                        break;
                    }

                    if (!IsReadablePointer(interfaceClass, 0x128)) {
                        DebugPrintA("[DumpCs2] 跳过不可读接口: klass=%p interface=%p\n", klass, interfaceClass);
                        continue;
                    }

                    const auto interfaceName = GetIl2CppClassName(interfaceClass, "");
                    if (interfaceName.empty() || std::find(inheritedNames.begin(), inheritedNames.end(), interfaceName) != inheritedNames.end()) {
                        continue;
                    }

                    inheritedNames.push_back(interfaceName);
                }
            }
        }

        if (!inheritedNames.empty()) {
            os << " : ";
            for (size_t i = 0; i < inheritedNames.size(); ++i) {
                if (i != 0) {
                    os << ", ";
                }
                os << inheritedNames[i];
            }
        }
        os << " {\n\n";

        if constexpr (kDumpClassMembers) {
            DumpFields(os, klass, className);
            os << "\n";
            DumpMethods(os, klass, className);
        }
        os << "}\n\n";
    }

    void DumpImage(std::ostringstream& os, const Il2CppImage* image, std::unordered_set<const Il2CppImage*>& visitedImages)
    {
        if (!image || !il2cpp_image_get_class_count || !il2cpp_image_get_class) {
            return;
        }

        if (!visitedImages.insert(image).second) {
            return;
        }

        if (!IsReadablePointer(image, 0x38)) {
            DebugPrintA("[DumpCs2] 跳过不可读 image: %p\n", image);
            return;
        }

        const auto imageName = il2cpp_image_get_name ? SafeString(il2cpp_image_get_name(image), "<unknown>") : "<unknown>";
        const auto classCount = il2cpp_image_get_class_count(image);
        DebugPrintA("[DumpCs2] Image: %p name=%s classCount=%zu\n", image, imageName.c_str(), classCount);
        os << "// Image: " << imageName << " classCount=" << classCount << "\n\n";
        if (classCount > kMaxImageClassCount) {
            DebugPrintA("[DumpCs2] 跳过异常 classCount: image=%p count=%zu\n", image, classCount);
            return;
        }

        for (size_t i = 0; i < classCount; ++i) {
            DebugPrintA("[DumpCs2] Image class index: %s[%zu/%zu]\n", imageName.c_str(), i, classCount);
            DumpClass(os, image, TryGetImageClass(image, i));
        }
    }

    void DumpInternalImages(std::ostringstream& os, std::unordered_set<const Il2CppImage*>& visitedImages)
    {
        const auto gameAssemblyBase = GetGameAssemblyModuleBase();
        if (!gameAssemblyBase || !il2cpp_assembly_get_image) {
            return;
        }

        const auto assemblyTableGlobal = reinterpret_cast<uintptr_t*>(gameAssemblyBase + kInternalAssemblyTableRva);
        if (!IsReadablePointer(assemblyTableGlobal, sizeof(uintptr_t))) {
            DebugPrintA("[DumpCs2] 内部 assembly 表全局地址不可读: %p\n", assemblyTableGlobal);
            return;
        }

        const auto assemblyTable = *assemblyTableGlobal;
        DebugPrintA("[DumpCs2] Internal assembly table: global=%p table=%p count=%zu stride=0x%zX\n", assemblyTableGlobal, reinterpret_cast<void*>(assemblyTable), kInternalAssemblyCount, kInternalAssemblyStride);
        if (!IsReadablePointer(reinterpret_cast<void*>(assemblyTable), kInternalAssemblyCount * kInternalAssemblyStride)) {
            DebugPrintA("[DumpCs2] 内部 assembly 表不可读: %p\n", reinterpret_cast<void*>(assemblyTable));
            return;
        }

        for (size_t i = 0; i < kInternalAssemblyCount; ++i) {
            const auto* assembly = reinterpret_cast<const Il2CppAssembly*>(assemblyTable + i * kInternalAssemblyStride);
            const auto* image = il2cpp_assembly_get_image(assembly);
            DebugPrintA("[DumpCs2] Internal assembly[%zu]: assembly=%p image=%p\n", i, assembly, image);
            DumpImage(os, image, visitedImages);
        }
    }

    void Render(std::ostringstream& os)
    {
        os << "// Create by MiniDumper\n\n";

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

        std::unordered_set<const Il2CppImage*> visitedImages;
        DebugPrintA("[DumpCs2] public assembly count=%zu\n", assemblyCount);
        for (size_t i = 0; i < assemblyCount; ++i) {
            const auto* image = assemblies[i] ? il2cpp_assembly_get_image(assemblies[i]) : nullptr;
            DebugPrintA("[DumpCs2] public assembly[%zu]: assembly=%p image=%p\n", i, assemblies[i], image);
            DumpImage(os, image, visitedImages);
        }

        if constexpr (kDumpInternalAssemblyTable) {
            DumpInternalImages(os, visitedImages);
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
