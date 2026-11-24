import { ClassQuery, ClassSelector, resolveClass, selectImage } from "../il2cpp/core.js";
import { cmdIdConstant } from "./constant.js";
import { CommandMessageType } from "./message.js";

export class CommandCatalog {
    *select(options: ClassQuery = {}): Generator<CommandMessageType> {
        if (options.count !== undefined && options.count <= 0) return;
        const image = selectImage(options.image ?? cmdIdConstant.image);
        let count = 0;
        for (let index = options.offset ?? 0; index < image.typeCount; index++) {
            const type = new CommandMessageType(image.classAt(index).handle);
            if (!type.isMessage || options.match && !type.fullName.includes(options.match)) continue;
            yield type;
            if (options.count !== undefined && ++count >= options.count) break;
        }
    }

    resolve(selector: ClassSelector | string): CommandMessageType { return new CommandMessageType(resolveClass(selector).handle); }
}
