import { api } from "../api.js";
import { NativeStruct } from "../memory.js";
import { Il2CppImage } from "./image.js";

export class Il2CppAssembly extends NativeStruct {
    get image(): Il2CppImage { return new Il2CppImage(api.il2cpp_assembly_get_image(this.handle)); }
}
