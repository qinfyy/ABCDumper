import { ClassQuery, ClassSelector, resolveClass, selectImage } from "../il2cpp/core.js";
import { cmdIdConstant } from "./constant.js";
import { RegisteredCommand } from "./message.js";

export class CommandCatalog {
    select(commands: readonly RegisteredCommand[], options: ClassQuery = {}): RegisteredCommand[] {
        const { count, image, match, offset } = options;
        if (count !== undefined && count <= 0) return [];
        const selected = image !== undefined || offset !== undefined ? selectImage(image ?? cmdIdConstant.image) : undefined;
        const allowed = selected && offset !== undefined ?
            new Set(Array.from(selected.classEntries(offset), ([, klass]) => klass.toString())) : undefined;
        const result: RegisteredCommand[] = [];
        for (const command of commands) {
            const klass = command.klass;
            if (selected && !klass.image.handle.equals(selected.handle) || allowed && !allowed.has(klass.toString())) continue;
            if (match && !klass.fullName.includes(match)) continue;
            result.push(command);
            if (count !== undefined && result.length >= count) break;
        }
        return result;
    }

    describe(commands: readonly RegisteredCommand[], selector: ClassSelector | string) {
        const klass = resolveClass(selector);
        const matches = commands.filter(command => command.klass.handle.equals(klass.handle)).map(command => command.summary());
        const first = matches[0];
        return { name: klass.fullName, image: klass.image.name, cmdId: first?.cmdId ?? null, source: first ? "registry" : "none",
            registry: first?.registry ?? null, rva: first?.rva ?? null, index: first?.index ?? null, registrations: matches };
    }
}
