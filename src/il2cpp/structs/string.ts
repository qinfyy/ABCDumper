import { Il2CppObject } from "./object.js";
import { checkedLength } from "./array.js";

export class Il2CppString extends Il2CppObject {
    // ABC 0.75.2: WriteTo checks the length at +0x10; il2cpp_string_chars uses +0x14.
    get length(): number { return checkedLength(this.handle.add(0x10).readS32()); }

    read(maximum = Number.MAX_SAFE_INTEGER): string {
        if (this.handle.isNull()) return "";
        const length = checkedLength(this.length, maximum);
        return this.handle.add(0x14).readUtf16String(length) ?? "";
    }
}
