import { api } from "../api.js";
import { ObjectScope } from "../objects.js";
import { Il2CppString } from "../structs/string.js";

// System.String
export class ManagedString extends Il2CppString {
    static create(value: string, scope: ObjectScope): ManagedString {
        // il2cpp_string_new_len takes the UTF-8 byte count, not the JS UTF-16 length.
        let bytes = 0;
        for (const character of value) {
            const code = character.codePointAt(0)!;
            bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
        }
        return new ManagedString(scope.root(api.il2cpp_string_new_len(Memory.allocUtf8String(value), bytes)));
    }
}
