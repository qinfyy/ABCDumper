#pragma once
#include <string>
#include <vector>
#include <sstream>

// System.String
struct Il2CppString // sizeof=0x58
{
    void* m_pClass;
    void* monitor;
    int32_t length;
    wchar_t chars[0];
    // padding byte
    // padding byte
    // padding byte
    // padding byte
};

std::wstring Il2CppStringToWString(Il2CppString* str);

std::string Il2CppStringToUtf8String(Il2CppString* str);

std::string Il2CppStringToAnsiString(Il2CppString* str);

bool ReplaceIl2CppStringChars(Il2CppString* target, const std::wstring& ws);

Il2CppString* CreateIl2CppString(const std::wstring& ws, Il2CppString* original);

std::string ByteArrayToHex(const uint8_t* data, size_t len);

std::string Utf16ToUtf8(const std::wstring& wstr);

std::wstring Utf8ToUtf16(const std::string& str);

std::string Utf16ToAnsi(const std::wstring& wstr);

std::wstring AnsiToUtf16(const std::string& str);

std::string AsciiEscapeToEscapeLiterals(const std::string& input);
