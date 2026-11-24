import { classAt } from "./api.js";
import { Il2CppClass } from "./structs/class.js";
import { Il2CppDomain } from "./structs/domain.js";
import { Il2CppImage } from "./structs/image.js";

export interface ClassSelector {
    klass?: string;
    index?: number;
    name?: string;
    className?: string;
    image?: string;
}

export interface ClassQuery {
    image?: string;
    offset?: number;
    count?: number;
    match?: string;
}

export function assemblies() {
    return Il2CppDomain.current.assemblies.map(assembly => ({ assembly: assembly.toString(), ...assembly.image.summary() }));
}

export function images(): Il2CppImage[] {
    return Il2CppDomain.current.images;
}

export function selectImage(name = "ABC.Common.dll"): Il2CppImage {
    const image = Il2CppDomain.current.findImage(name);
    if (!image) throw new Error("Image not found: " + name);
    return image;
}

export function resolveClass(selector: ClassSelector | string): Il2CppClass {
    const options = typeof selector === "string" ? { name: selector } : selector;
    if (options.klass !== undefined) return new Il2CppClass(ptr(options.klass));
    if (options.index !== undefined) return new Il2CppClass(classAt(options.index));
    const image = selectImage(options.image);
    const wanted = options.name ?? options.className;
    if (!wanted) throw new Error("Provide klass, index or class name");
    const klass = image.findClass(wanted);
    if (!klass) throw new Error("Class not found: " + wanted);
    return klass;
}

export function classes(options: ClassQuery = {}) {
    const image = selectImage(options.image);
    const result = [];
    for (const [i, klass] of image.classEntries(options.offset ?? 0, options.count ?? 20)) {
        if (!options.match || klass.fullName.includes(options.match)) result.push(klass.summary(image.typeStart + i));
    }
    return result;
}
