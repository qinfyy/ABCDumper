#include "pch.h"
#include "StringLiteral.h"

#include "Il2CppFunctions.h"
#include "PrintHelper.h"

#include <algorithm>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <unordered_set>
#include <vector>

namespace
{
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

    struct StringLiteralEntry
    {
        uint64_t address;
        std::string value;
    };

    bool IsReadableProtection(DWORD protect)
    {
        if ((protect & (PAGE_NOACCESS | PAGE_GUARD)) != 0) {
            return false;
        }

        constexpr DWORD kReadableFlags = PAGE_READONLY | PAGE_READWRITE | PAGE_WRITECOPY | PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY;
        return (protect & kReadableFlags) != 0;
    }

    bool IsReadablePointer(const void* address, size_t size = 1)
    {
        if (!address || size == 0) {
            return false;
        }

        MEMORY_BASIC_INFORMATION mbi{};
        if (!VirtualQuery(address, &mbi, sizeof(mbi))) {
            return false;
        }

        const auto begin = reinterpret_cast<uintptr_t>(address);
        const auto regionBegin = reinterpret_cast<uintptr_t>(mbi.BaseAddress);
        const auto regionEnd = regionBegin + mbi.RegionSize;
        return mbi.State == MEM_COMMIT && IsReadableProtection(mbi.Protect) && begin >= regionBegin && begin + size <= regionEnd;
    }

    template <typename T>
    bool TryReadValue(uintptr_t address, T* value)
    {
        if (!value || !IsReadablePointer(reinterpret_cast<const void*>(address), sizeof(T))) {
            return false;
        }

        __try {
            *value = *reinterpret_cast<const T*>(address);
            return true;
        }
        __except (EXCEPTION_EXECUTE_HANDLER) {
            return false;
        }
    }

    bool GetGameAssemblyImage(uintptr_t* imageBase, size_t* imageSize, IMAGE_NT_HEADERS64** ntHeaders)
    {
        const auto base = GetGameAssemblyModuleBase();
        if (!base || !imageBase || !imageSize || !ntHeaders) {
            return false;
        }

        IMAGE_DOS_HEADER dosHeader{};
        if (!TryReadValue(base, &dosHeader) || dosHeader.e_magic != IMAGE_DOS_SIGNATURE) {
            DebugPrintA("[StringLiteral] GameAssembly.dll DOS 头不可读。\n");
            return false;
        }

        const auto ntAddress = base + static_cast<uintptr_t>(dosHeader.e_lfanew);
        if (!IsReadablePointer(reinterpret_cast<const void*>(ntAddress), sizeof(IMAGE_NT_HEADERS64))) {
            DebugPrintA("[StringLiteral] GameAssembly.dll NT 头不可读。\n");
            return false;
        }

        auto* headers = reinterpret_cast<IMAGE_NT_HEADERS64*>(ntAddress);
        if (headers->Signature != IMAGE_NT_SIGNATURE || headers->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC) {
            DebugPrintA("[StringLiteral] GameAssembly.dll PE 头格式异常。\n");
            return false;
        }

        *imageBase = base;
        *imageSize = headers->OptionalHeader.SizeOfImage;
        *ntHeaders = headers;
        return true;
    }

    void ScanPatternRange(uintptr_t imageBase, uintptr_t begin, uintptr_t end, std::vector<uint32_t>* tokens)
    {
        if (!tokens || end <= begin + 10) {
            return;
        }

        const auto* bytes = reinterpret_cast<const uint8_t*>(begin);
        const auto size = end - begin;
        for (uintptr_t i = 0; i + 10 <= size; ++i) {
            if (bytes[i] != 0xB9 || bytes[i + 5] != 0xE8) {
                continue;
            }

            int32_t rel32 = 0;
            uint32_t token = 0;
            std::memcpy(&token, bytes + i + 1, sizeof(token));
            std::memcpy(&rel32, bytes + i + 6, sizeof(rel32));
            const auto instructionAddress = begin + i;
            const auto callTarget = static_cast<uintptr_t>(static_cast<int64_t>(instructionAddress) + 10 + rel32);
            if (callTarget == imageBase + kInitMetadataRangeRva) {
                tokens->push_back(token);
            }
        }
    }

    void ScanReadableRange(uintptr_t imageBase, uintptr_t begin, uintptr_t end, std::vector<uint32_t>* tokens)
    {
        auto cursor = begin;
        while (cursor < end) {
            MEMORY_BASIC_INFORMATION mbi{};
            if (!VirtualQuery(reinterpret_cast<const void*>(cursor), &mbi, sizeof(mbi))) {
                break;
            }

            const auto regionBegin = (std::max)(cursor, reinterpret_cast<uintptr_t>(mbi.BaseAddress));
            const auto regionEnd = (std::min)(end, reinterpret_cast<uintptr_t>(mbi.BaseAddress) + mbi.RegionSize);
            if (regionEnd <= regionBegin) {
                break;
            }

            if (mbi.State == MEM_COMMIT && IsReadableProtection(mbi.Protect)) {
                ScanPatternRange(imageBase, regionBegin, regionEnd, tokens);
            }

            cursor = regionEnd;
        }
    }

    std::vector<uint32_t> ScanMetadataTokens(uintptr_t imageBase, size_t imageSize, IMAGE_NT_HEADERS64* ntHeaders)
    {
        std::vector<uint32_t> tokens;
        if (!imageBase || !imageSize || !ntHeaders) {
            return tokens;
        }

        const auto sectionCount = ntHeaders->FileHeader.NumberOfSections;
        const auto* section = IMAGE_FIRST_SECTION(ntHeaders);
        if (!IsReadablePointer(section, static_cast<size_t>(sectionCount) * sizeof(IMAGE_SECTION_HEADER))) {
            DebugPrintA("[StringLiteral] GameAssembly.dll section 表不可读。\n");
            return tokens;
        }

        for (WORD i = 0; i < sectionCount; ++i) {
            if ((section[i].Characteristics & IMAGE_SCN_MEM_EXECUTE) == 0) {
                continue;
            }

            const auto sectionSize = section[i].Misc.VirtualSize != 0 ? section[i].Misc.VirtualSize : section[i].SizeOfRawData;
            const auto sectionBegin = imageBase + section[i].VirtualAddress;
            const auto imageEnd = imageBase + imageSize;
            const auto sectionEnd = (std::min)(imageEnd, sectionBegin + static_cast<uintptr_t>(sectionSize));
            if (sectionEnd <= sectionBegin) {
                continue;
            }

            ScanReadableRange(imageBase, sectionBegin, sectionEnd, &tokens);
        }

        std::sort(tokens.begin(), tokens.end());
        tokens.erase(std::unique(tokens.begin(), tokens.end()), tokens.end());
        return tokens;
    }

    bool TryGetMetadataBase(uintptr_t imageBase, uintptr_t* metadataBase)
    {
        if (!metadataBase) {
            return false;
        }

        *metadataBase = 0;
        if (!TryReadValue(imageBase + kProtectedMetadataBaseGlobalRva, metadataBase) || !*metadataBase) {
            DebugPrintA("[StringLiteral] protected metadata base 未初始化或不可读。\n");
            return false;
        }

        return true;
    }

    bool TryDecodeStringLiteral(uintptr_t metadataBase, uint32_t sourceIndex, std::string* value)
    {
        if (!value) {
            return false;
        }

        uint32_t rawLength = 0;
        uint32_t rawDataOffset = 0;
        const auto sourceOffset = static_cast<uintptr_t>(sourceIndex) * 8;
        if (!TryReadValue(metadataBase + sourceOffset + kStringLiteralLengthOffset, &rawLength) || !TryReadValue(metadataBase + sourceOffset + kStringLiteralDataOffset, &rawDataOffset)) {
            DebugPrintA("[StringLiteral] 字符串源数据不可读: sourceIndex=%u\n", sourceIndex);
            return false;
        }

        const auto length = rawLength ^ kStringLiteralLengthXor;
        if (length > kMaxStringLiteralLength) {
            DebugPrintA("[StringLiteral] 字符串长度异常: sourceIndex=%u length=%u\n", sourceIndex, length);
            return false;
        }

        value->clear();
        if (length == 0) {
            return true;
        }

        const auto dataOffset = static_cast<int64_t>(static_cast<int32_t>(rawDataOffset)) ^ static_cast<int64_t>(kStringLiteralDataOffsetXor);
        const auto dataAddressSigned = static_cast<int64_t>(metadataBase) + dataOffset + static_cast<int64_t>(kStringLiteralDataBaseAdd);
        if (dataAddressSigned <= 0) {
            DebugPrintA("[StringLiteral] 字符串数据地址异常: sourceIndex=%u\n", sourceIndex);
            return false;
        }

        const auto dataAddress = static_cast<uintptr_t>(dataAddressSigned);
        const auto blockCount = (static_cast<size_t>(length) + 7) / 8;
        std::vector<uint8_t> buffer(blockCount * 8);
        auto key = kStringKeyAdd + kStringKeyMul * ((kStringKeySourceMul * static_cast<uint64_t>(sourceIndex)) ^ kStringKeySourceXor);
        for (size_t i = 0; i < blockCount; ++i) {
            uint64_t encrypted = 0;
            if (!TryReadValue(dataAddress + i * sizeof(uint64_t), &encrypted)) {
                DebugPrintA("[StringLiteral] 字符串密文不可读: sourceIndex=%u block=%zu\n", sourceIndex, i);
                return false;
            }

            const auto decrypted = encrypted ^ key;
            std::memcpy(buffer.data() + i * sizeof(uint64_t), &decrypted, sizeof(decrypted));
            key += kStringKeyStep;
        }

        value->assign(reinterpret_cast<const char*>(buffer.data()), length);
        return true;
    }

    std::vector<StringLiteralEntry> CollectStringLiterals()
    {
        uintptr_t imageBase = 0;
        size_t imageSize = 0;
        IMAGE_NT_HEADERS64* ntHeaders = nullptr;
        std::vector<StringLiteralEntry> entries;
        if (!GetGameAssemblyImage(&imageBase, &imageSize, &ntHeaders)) {
            return entries;
        }

        uintptr_t metadataBase = 0;
        if (!TryGetMetadataBase(imageBase, &metadataBase)) {
            return entries;
        }

        const auto tokens = ScanMetadataTokens(imageBase, imageSize, ntHeaders);
        std::unordered_set<uint64_t> seenAddresses;
        size_t usageStringPairCount = 0;
        size_t directStringIndexCount = 0;
        size_t skippedPairCount = 0;
        size_t skippedStringIndexCount = 0;
        size_t skippedStringCount = 0;
        DebugPrintA("[StringLiteral] metadata token count=%zu\n", tokens.size());
        for (const auto token : tokens) {
            uint32_t rawStringStart = 0;
            uint32_t rawNextStringStart = 0;
            uint32_t rawPairStart = 0;
            uint32_t rawNextPairStart = 0;
            const auto listAddress = metadataBase + static_cast<uintptr_t>(token) * 8 + kUsageListOffset;
            const auto nextListAddress = metadataBase + (static_cast<uintptr_t>(token) + 1) * 8 + kUsageListOffset;
            if (!TryReadValue(listAddress, &rawStringStart) || !TryReadValue(listAddress + 4, &rawPairStart) || !TryReadValue(nextListAddress, &rawNextStringStart) || !TryReadValue(nextListAddress + 4, &rawNextPairStart)) {
                ++skippedPairCount;
                continue;
            }

            const auto currentStart = rawPairStart - kUsageListEndSub;
            const auto nextStart = rawNextPairStart - kUsageListEndSub;
            if (currentStart < nextStart) {
                const auto rangeCount = rawNextPairStart - rawPairStart;
                if (rangeCount > kMaxUsagePairCount) {
                    DebugPrintA("[StringLiteral] usage pair range 异常: token=0x%X count=%u\n", token, rangeCount);
                    ++skippedPairCount;
                }
                else {
                    const auto pairIndexStart = currentStart + kUsagePairIndexAdd;
                    for (uint32_t i = 0; i < rangeCount; ++i) {
                        uint32_t pairWord = 0;
                        const auto pairIndex = pairIndexStart + i;
                        if (!TryReadValue(metadataBase + static_cast<uintptr_t>(pairIndex) * 4, &pairWord)) {
                            ++skippedPairCount;
                            continue;
                        }

                        const auto destIndex = pairWord & 0x00FFFFFF;
                        uint32_t encodedUsage = 0;
                        if (!TryReadValue(metadataBase + static_cast<uintptr_t>(destIndex) * 4 + kUsageEncodedOffset, &encodedUsage)) {
                            ++skippedPairCount;
                            continue;
                        }

                        const auto usageType = encodedUsage >> 28;
                        if (usageType != kStringLiteralUsageType) {
                            continue;
                        }

                        ++usageStringPairCount;
                        const auto sourceIndex = encodedUsage & 0x0FFFFFFF;
                        const auto address = static_cast<uint64_t>(kUsageCacheTableRva) + static_cast<uint64_t>(destIndex) * 8;
                        if (!seenAddresses.insert(address).second) {
                            continue;
                        }

                        std::string value;
                        if (!TryDecodeStringLiteral(metadataBase, sourceIndex, &value)) {
                            ++skippedStringCount;
                            continue;
                        }

                        entries.push_back({ address, value });
                    }
                }
            }

            const auto currentStringStart = rawStringStart - kUsageListStartSub;
            const auto nextStringStart = rawNextStringStart - kUsageListStartSub;
            if (currentStringStart >= nextStringStart) {
                continue;
            }

            const auto stringRangeCount = rawNextStringStart - rawStringStart;
            if (stringRangeCount > kMaxStringIndexCount) {
                DebugPrintA("[StringLiteral] string index range 异常: token=0x%X count=%u\n", token, stringRangeCount);
                ++skippedStringIndexCount;
                continue;
            }

            const auto stringIndexStart = currentStringStart + kStringIndexListAdd;
            for (uint32_t i = 0; i < stringRangeCount; ++i) {
                int32_t sourceIndexValue = 0;
                const auto stringIndex = stringIndexStart + i;
                if (!TryReadValue(metadataBase + static_cast<uintptr_t>(stringIndex) * 4, &sourceIndexValue)) {
                    ++skippedStringIndexCount;
                    continue;
                }

                if (sourceIndexValue < 0) {
                    continue;
                }

                ++directStringIndexCount;
                const auto sourceIndex = static_cast<uint32_t>(sourceIndexValue);
                const auto address = static_cast<uint64_t>(kStringLiteralTableRva) + static_cast<uint64_t>(sourceIndex) * 8;
                if (!seenAddresses.insert(address).second) {
                    continue;
                }

                std::string value;
                if (!TryDecodeStringLiteral(metadataBase, sourceIndex, &value)) {
                    ++skippedStringCount;
                    continue;
                }

                entries.push_back({ address, value });
            }
        }

        DebugPrintA("[StringLiteral] collected=%zu usageStringPairs=%zu directStringIndexes=%zu skippedPairs=%zu skippedStringIndexes=%zu skippedStrings=%zu\n", entries.size(), usageStringPairCount, directStringIndexCount, skippedPairCount, skippedStringIndexCount, skippedStringCount);
        return entries;
    }

    std::string JsonEscape(const std::string& value)
    {
        constexpr char kHexDigits[] = "0123456789ABCDEF";
        std::string escaped;
        escaped.reserve(value.size() + value.size() / 8);
        for (const auto ch : value) {
            const auto byte = static_cast<unsigned char>(ch);
            switch (byte) {
            case '\"':
                escaped += "\\\"";
                break;
            case '\\':
                escaped += "\\\\";
                break;
            case '\n':
                escaped += "\\n";
                break;
            case '\r':
                escaped += "\\r";
                break;
            case '\t':
                escaped += "\\t";
                break;
            default:
                if (byte < 0x20) {
                    escaped += "\\u00";
                    escaped += kHexDigits[byte >> 4];
                    escaped += kHexDigits[byte & 0x0F];
                }
                else {
                    escaped.push_back(static_cast<char>(byte));
                }
                break;
            }
        }

        return escaped;
    }

    std::string WriteJson(const std::vector<StringLiteralEntry>& entries)
    {
        std::ostringstream output;
        output << "{\n";
        output << "  \"ScriptString\": [\n";
        for (size_t i = 0; i < entries.size(); ++i) {
            output << "    {\n";
            output << "      \"Address\": " << entries[i].address << ",\n";
            output << "      \"Value\": \"" << JsonEscape(entries[i].value) << "\"\n";
            output << "    }";
            if (i + 1 < entries.size()) {
                output << ",";
            }
            output << "\n";
        }
        output << "  ]\n";
        output << "}\n";

        return output.str();
    }
}

void DumpStringLiteral(const char* path)
{
    DebugPrintA("[StringLiteral] dumping...\n");
    const auto entries = CollectStringLiterals();
    const auto json = WriteJson(entries);
    const std::filesystem::path filePath(path);
    const auto directory = filePath.parent_path();
    if (!directory.empty() && !std::filesystem::exists(directory)) {
        std::filesystem::create_directories(directory);
    }

    std::ofstream file(path, std::ios::binary);
    if (!file.is_open()) {
        DebugPrintA("[StringLiteral] 打开文件失败: %s\n", path);
        return;
    }

    file << json;

    DebugPrintA("[StringLiteral] entries=%zu\n", entries.size());
    DebugPrintA("[StringLiteral] dump done: %s\n", path);
}
