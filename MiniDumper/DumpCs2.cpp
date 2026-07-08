#include "pch.h"
#include "DumpCs2.h"

#include "Il2CppFunctions.h"
#include "PrintHelper.h"

#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <unordered_set>
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
    constexpr uintptr_t kInternalAssemblyTableRva = 0x20896D0;
    constexpr uintptr_t kStringDecodeRva = 0x6D4EB0;
    constexpr size_t kInternalAssemblyCount = 0x62;
    constexpr size_t kInternalAssemblyStride = 0x18;
    constexpr size_t kMaxImageClassCount = 200000;
    constexpr size_t kMaxMemberCount = 200000;
    constexpr size_t kClassFieldsOffset = 0x78;
    constexpr size_t kClassFieldCountOffset = 0x11C;
    constexpr size_t kFieldInfoSize = 0x28;
    constexpr uintptr_t kProtectedMetadataBaseGlobalRva = 0x20896B8;
    constexpr uintptr_t kProtectedFieldMetadataOffset = 0x538398;
    constexpr uintptr_t kFieldTypeMethodXor = 0x695367855EBB9ED9;
    constexpr uintptr_t kFieldTypeMethodAdd = 0xA0A6BFEBD56CF834;
    constexpr uintptr_t kFieldParentXor = 0x4994C8584E1F5204;
    constexpr uint32_t kFieldOffsetAdd = 0x9DC67E34;
    constexpr uint32_t kFieldValueApiOffsetXor = 0xE2A40C;
    constexpr size_t kDebugFieldSampleCount = 64;
    constexpr bool kDumpClassMembers = true;
    constexpr bool kDumpParentClass = false;
    constexpr bool kDumpInternalAssemblyTable = false;

    bool IsReadablePointer(const void* address, size_t size = 1)
    {
        if (!address) {
            return false;
        }

        MEMORY_BASIC_INFORMATION mbi{};
        if (!VirtualQuery(address, &mbi, sizeof(mbi))) {
            return false;
        }

        if (mbi.State != MEM_COMMIT || (mbi.Protect & (PAGE_NOACCESS | PAGE_GUARD)) != 0) {
            return false;
        }

        const auto begin = reinterpret_cast<uintptr_t>(address);
        const auto regionBegin = reinterpret_cast<uintptr_t>(mbi.BaseAddress);
        const auto regionEnd = regionBegin + mbi.RegionSize;
        return begin >= regionBegin && begin + size <= regionEnd;
    }

    const char* ValidateCString(const char* value)
    {
        if (!value || !IsReadablePointer(value)) {
            return nullptr;
        }

        return value;
    }

    std::string SafeString(const char* value, const char* fallback = "")
    {
        return value ? value : fallback;
    }

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
        const char* name = nullptr;
        __try {
            name = il2cpp_type_get_name ? il2cpp_type_get_name(type) : nullptr;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_type_get_name 异常: type=%p\n", type);
        }

        return name;
    }

    uint32_t TryGetTypeAttrs(const Il2CppType* type)
    {
        uint32_t attrs = 0;
        __try {
            attrs = il2cpp_type_get_attrs ? il2cpp_type_get_attrs(type) : 0;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            DebugPrintA("[DumpCs2] il2cpp_type_get_attrs 异常: type=%p\n", type);
        }

        return attrs;
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

        return name;
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

        return namespaze;
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

        return name;
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

        return name;
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

        return name;
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

        auto* parent = il2cpp_class_get_parent(const_cast<Il2CppClass*>(klass));
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
        if (!method || !IsReadablePointer(method, offsetof(MethodInfo, method_pointer) + sizeof(method->method_pointer))) {
            return 0;
        }

        const auto methodPointer = reinterpret_cast<uintptr_t>(method->method_pointer);
        const auto gameAssemblyBase = GetGameAssemblyModuleBase();
        if (!gameAssemblyBase || methodPointer < gameAssemblyBase || !IsReadablePointer(reinterpret_cast<const void*>(methodPointer))) {
            return 0;
        }

        return methodPointer;
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

        static size_t debugFieldSamples = 0;
        uintptr_t protectedMetadataBase = 0;
        uint32_t metadataFieldStart = 0;
        const auto gameAssemblyBase = GetGameAssemblyModuleBase();
        if (gameAssemblyBase != 0 && IsReadablePointer(reinterpret_cast<const void*>(gameAssemblyBase + kProtectedMetadataBaseGlobalRva), sizeof(uintptr_t))) {
            protectedMetadataBase = *reinterpret_cast<const uintptr_t*>(gameAssemblyBase + kProtectedMetadataBaseGlobalRva);
        }
        if (IsReadablePointer(reinterpret_cast<const void*>(klassAddress + 0xA8), sizeof(uintptr_t))) {
            const auto classMetadata = *reinterpret_cast<const uintptr_t*>(klassAddress + 0xA8);
            if (IsReadablePointer(reinterpret_cast<const void*>(classMetadata + 0x24), sizeof(uint32_t))) {
                metadataFieldStart = *reinterpret_cast<const uint32_t*>(classMetadata + 0x24);
            }
        }

        for (uint16_t i = 0; i < fieldCount; ++i) {
            const auto field = fields + static_cast<uintptr_t>(i) * kFieldInfoSize;
            const auto encodedBackupTypeMethod = *reinterpret_cast<const uintptr_t*>(field);
            const auto encodedTypeMethod = *reinterpret_cast<const uintptr_t*>(field + 0x8);
            const auto encodedName = *reinterpret_cast<const uintptr_t*>(field + 0x10);
            const auto encodedParent = *reinterpret_cast<const uintptr_t*>(field + 0x18);
            const auto offsetData = *reinterpret_cast<const uint32_t*>(field + 0x20);
            const auto* fieldName = DecodeInternalString(encodedName);
            const auto fieldTypeMethodAddress = encodedTypeMethod + kFieldTypeMethodAdd;
            const auto backupFieldTypeMethodAddress = encodedBackupTypeMethod ^ kFieldTypeMethodXor;
            const auto* fieldTypeMethod = IsReadablePointer(reinterpret_cast<const void*>(fieldTypeMethodAddress), 0x40) ? reinterpret_cast<const MethodInfo*>(fieldTypeMethodAddress) : nullptr;
            const auto* backupFieldTypeMethod = IsReadablePointer(reinterpret_cast<const void*>(backupFieldTypeMethodAddress), 0x40) ? reinterpret_cast<const MethodInfo*>(backupFieldTypeMethodAddress) : nullptr;
            const MethodInfo* typeMethods[] = { fieldTypeMethod, backupFieldTypeMethod };
            std::string fieldTypeName = "UnknownType";
            std::string fallbackFieldTypeName = "UnknownType";
            for (const auto* typeMethod : typeMethods) {
                if (!typeMethod) {
                    continue;
                }

                const auto returnTypeName = GetTypeName(TryGetMethodReturnType(typeMethod));
                if (returnTypeName != "UnknownType" && returnTypeName != "void" && returnTypeName != "System.Void" && returnTypeName != "E56AA9CC9042EEB5.F843136B4E1FE977") {
                    fieldTypeName = returnTypeName;
                    break;
                }
                if (fallbackFieldTypeName == "UnknownType" && returnTypeName != "UnknownType") {
                    fallbackFieldTypeName = returnTypeName;
                }

                const auto paramCount = TryGetMethodParamCount(typeMethod);
                for (uint32_t paramIndex = 0; paramIndex < paramCount; ++paramIndex) {
                    const auto paramTypeName = GetTypeName(TryGetMethodParam(typeMethod, paramIndex));
                    if (paramTypeName != "UnknownType" && paramTypeName != "void" && paramTypeName != "System.Void" && paramTypeName != "E56AA9CC9042EEB5.F843136B4E1FE977") {
                        fieldTypeName = paramTypeName;
                        break;
                    }
                    if (fallbackFieldTypeName == "UnknownType" && paramTypeName != "UnknownType") {
                        fallbackFieldTypeName = paramTypeName;
                    }
                }
                if (fieldTypeName != "UnknownType") {
                    break;
                }
            }
            if (fieldTypeName == "UnknownType" && fallbackFieldTypeName != "UnknownType") {
                fieldTypeName = fallbackFieldTypeName;
            }
            const auto fieldOffset = static_cast<uint32_t>(offsetData + kFieldOffsetAdd);

            if (debugFieldSamples < kDebugFieldSampleCount) {
                uint32_t meta0 = 0;
                uint32_t meta4 = 0;
                uint64_t meta8 = 0;
                uint32_t meta10 = 0;
                const auto metadataEntry = protectedMetadataBase != 0 ? protectedMetadataBase + kProtectedFieldMetadataOffset + (static_cast<uintptr_t>(metadataFieldStart) + i) * 0x14 : 0;
                if (metadataEntry != 0 && IsReadablePointer(reinterpret_cast<const void*>(metadataEntry), 0x14)) {
                    meta0 = *reinterpret_cast<const uint32_t*>(metadataEntry);
                    meta4 = *reinterpret_cast<const uint32_t*>(metadataEntry + 0x4);
                    meta8 = *reinterpret_cast<const uint64_t*>(metadataEntry + 0x8);
                    meta10 = *reinterpret_cast<const uint32_t*>(metadataEntry + 0x10);
                }
                const auto offsetFromParentSlot = static_cast<uint32_t>((encodedParent & 0xFFFFFF) ^ kFieldValueApiOffsetXor);
                const auto decodedParent = encodedParent ^ kFieldParentXor;
                const auto slot0ReturnTypeName = backupFieldTypeMethod ? GetTypeName(TryGetMethodReturnType(backupFieldTypeMethod)) : "null";
                const auto slot8ReturnTypeName = fieldTypeMethod ? GetTypeName(TryGetMethodReturnType(fieldTypeMethod)) : "null";
                const auto slot0ParamCount = backupFieldTypeMethod ? TryGetMethodParamCount(backupFieldTypeMethod) : 0;
                const auto slot8ParamCount = fieldTypeMethod ? TryGetMethodParamCount(fieldTypeMethod) : 0;
                const auto slot0ParamTypeName = slot0ParamCount > 0 ? GetTypeName(TryGetMethodParam(backupFieldTypeMethod, 0)) : "null";
                const auto slot8ParamTypeName = slot8ParamCount > 0 ? GetTypeName(TryGetMethodParam(fieldTypeMethod, 0)) : "null";
                const auto* slot0MethodName = backupFieldTypeMethod ? TryGetMethodName(backupFieldTypeMethod) : nullptr;
                const auto* slot8MethodName = fieldTypeMethod ? TryGetMethodName(fieldTypeMethod) : nullptr;
                DebugPrintA("[DumpCs2] 字段样本[%zu]: klass=%p class=%s index=%u field=%p name=%s raw0=%016llX raw8=%016llX raw10=%016llX raw18=%016llX raw20=%08X slot0=%p m0=%s ret0=%s p0=%s pc0=%u slot8=%p m8=%s ret8=%s p8=%s pc8=%u parent=%p off20=0x%X off18Low=0x%X metaBase=%p metaIndex=%u meta=%08X,%08X,%016llX,%08X finalType=%s\n", debugFieldSamples, klass, className.c_str(), i, reinterpret_cast<const void*>(field), SafeString(fieldName, "unknownField"), static_cast<unsigned long long>(encodedBackupTypeMethod), static_cast<unsigned long long>(encodedTypeMethod), static_cast<unsigned long long>(encodedName), static_cast<unsigned long long>(encodedParent), offsetData, reinterpret_cast<const void*>(backupFieldTypeMethodAddress), SafeString(slot0MethodName, "null"), slot0ReturnTypeName.c_str(), slot0ParamTypeName.c_str(), slot0ParamCount, reinterpret_cast<const void*>(fieldTypeMethodAddress), SafeString(slot8MethodName, "null"), slot8ReturnTypeName.c_str(), slot8ParamTypeName.c_str(), slot8ParamCount, reinterpret_cast<const void*>(decodedParent), fieldOffset, offsetFromParentSlot, reinterpret_cast<const void*>(protectedMetadataBase), metadataFieldStart + i, meta0, meta4, static_cast<unsigned long long>(meta8), meta10, fieldTypeName.c_str());
                ++debugFieldSamples;
            }

            os << "\t0x" << std::hex << fieldOffset << std::dec << " | ";
            os << fieldTypeName << " " << SafeString(fieldName, "unknownField") << ";\n";
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

        os << "class " << className;
        if constexpr (kDumpParentClass) {
            const auto parentName = GetParentName(klass);
            if (!parentName.empty()) {
                os << " : " << parentName;
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
