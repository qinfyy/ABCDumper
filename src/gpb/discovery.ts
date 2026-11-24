import { ClassQuery, ClassSelector, images, resolveClass, selectImage } from "../il2cpp/core.js";
import { gpbConstant } from "./constant.js";
import { ProtoMessageType } from "./message.js";

export interface ProtocolQuery extends ClassQuery {
    allImages?: boolean;
    interface?: string;
}

export class ProtocolCatalog {
    select(options: ProtocolQuery = {}): ProtoMessageType[] {
        if (options.count !== undefined && options.count <= 0) return [];
        if (options.offset !== undefined && options.image === undefined) throw new Error("Specify an image with offset");
        const result: ProtoMessageType[] = [];
        const selected = options.image !== undefined ? [selectImage(options.image)] :
            options.allImages ? images() : gpbConstant.images.map(selectImage);
        for (const image of selected) {
            const start = image.typeStart;
            for (const [index, klass] of image.classEntries(options.offset ?? 0)) {
                const type = new ProtoMessageType(klass.handle, start + index);
                if (options.match && !type.fullName.includes(options.match) || !type.isMessage) continue;
                if (options.interface && !type.interfaces.some(type => type.name === options.interface)) continue;
                result.push(type);
                if (options.count !== undefined && result.length >= options.count) return result;
            }
        }
        return result;
    }

    resolve(selector: ClassSelector | string): ProtoMessageType {
        const options = typeof selector === "string" ? { name: selector } : selector;
        if (options.image !== undefined || options.index !== undefined || options.klass !== undefined) {
            return new ProtoMessageType(resolveClass(options).handle);
        }
        const wanted = options.name ?? options.className;
        if (!wanted) throw new Error("Provide klass, index or class name");
        const types = this.select({ match: wanted }).filter(type => type.fullName === wanted || type.name === wanted);
        if (types.length === 1) return types[0];
        throw new Error(types.length ? "Specify an image for ambiguous codec: " + wanted : "Codec not found: " + wanted);
    }
}
