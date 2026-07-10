#pragma once

#include <cstddef>
#include <cstdint>

constexpr uintptr_t kInitMetadataRangeRva = 0x6D3000;
constexpr uintptr_t kProtectedMetadataBaseGlobalRva = 0x20896B8;
constexpr uintptr_t kUsageCacheTableRva = 0x1DAF0D0;
constexpr uintptr_t kStringLiteralTableRva = 0x1E5CD10;
constexpr uint32_t kUsageListOffset = 0x16DDB8;
constexpr uint32_t kUsageListStartSub = 0x0A09F36F;
constexpr uint32_t kUsageListEndSub = 0x3FE3C243;
constexpr uint32_t kUsagePairIndexAdd = 0x2B172B;
constexpr uint32_t kStringIndexListAdd = 0x114AD9;
constexpr uint32_t kUsageEncodedOffset = 0x9ED180;
constexpr uint32_t kStringLiteralLengthOffset = 0x13AD1DC;
constexpr uint32_t kStringLiteralLengthXor = 0x57AFB483;
constexpr uint32_t kStringLiteralDataOffset = 0x13AD1E0;
constexpr uint32_t kStringLiteralDataOffsetXor = 0x21D6690C;
constexpr uint32_t kStringLiteralDataBaseAdd = 0x13ECC70;
constexpr uint32_t kStringLiteralUsageType = 5;
constexpr uint32_t kMaxUsagePairCount = 0x100000;
constexpr uint32_t kMaxStringIndexCount = 0x100000;
constexpr uint32_t kMaxStringLiteralLength = 0x100000;
constexpr uint64_t kStringKeySourceMul = 0x7555E6CD072DF156;
constexpr uint64_t kStringKeySourceXor = 0x5474924A04CC6763;
constexpr uint64_t kStringKeyMul = 0x9FD7EBCFA1B6DB7E;
constexpr uint64_t kStringKeyAdd = 0xFC5C61C69C5516C9;
constexpr uint64_t kStringKeyStep = 0x06665D3E5028D592;

constexpr uintptr_t kInternalAssemblyTableRva = 0x20896D0;
constexpr uintptr_t kStringDecodeRva = 0x6D4EB0;
constexpr size_t kInternalAssemblyCount = 0x62;
constexpr size_t kInternalAssemblyStride = 0x18;
constexpr size_t kMaxImageClassCount = 200000;
constexpr size_t kMaxMemberCount = 200000;
constexpr size_t kClassFieldsOffset = 0x80;
constexpr size_t kClassFieldCountOffset = 0x114;
constexpr size_t kFieldInfoSize = 0x20;
constexpr uintptr_t kProtectedFieldMetadataOffset = 0x538398;
constexpr uint32_t kFieldMetadataStartXor = 0x2EE556B4;
constexpr uintptr_t kFieldNameTokenXor = 0x475139FE2D91A4FF;
constexpr uint32_t kFieldMetadataIndexAdd = 0xB1F1C1BA;
constexpr uint32_t kFieldMetadataOffsetXor = 0x03AE7562;
constexpr uintptr_t kFieldTypeMethodXor = 0x695367855EBB9ED9;
constexpr uintptr_t kFieldTypeMethodAdd = 0xA0A6BFEBD56CF834;
constexpr uintptr_t kFieldParentXor = 0x4994C8584E1F5204;
constexpr uint32_t kFieldOffsetAdd = 0x9DC67E34;
constexpr uint32_t kFieldValueApiOffsetXor = 0xE2A40C;
constexpr size_t kNexusMethodPointerOffset = 0x28;
constexpr size_t kNexusMethodPointerFallbackOffset = 0x20;
constexpr size_t kMaxCStringLength = 0x4000;
constexpr uint32_t kIl2CppObjectHeaderSize = 0x10;
