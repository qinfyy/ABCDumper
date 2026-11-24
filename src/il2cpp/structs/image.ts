import { api } from "../api.js";
import { NativeStruct } from "../memory.js";
import { Il2CppClass } from "./class.js";

export class Il2CppImage extends NativeStruct {
    get name(): string { return api.il2cpp_image_get_name(this.handle); }
    get typeStart(): number { return this.handle.add(0x10).readPointer().readS32(); }
    get typeCount(): number { return api.il2cpp_image_get_class_count(this.handle); }

    classHandle(index: number): NativePointer {
        return api["il2cpp_image_get_class"](this.handle, index);
    }

    classAt(index: number): Il2CppClass {
        if (!Number.isInteger(index) || index < 0 || index >= this.typeCount) throw new Error("Image class index out of bounds: " + index);
        return new Il2CppClass(this.classHandle(index));
    }

    summary() {
        return { image: this.toString(), name: this.name, typeStart: this.typeStart, typeCount: this.typeCount };
    }
}
