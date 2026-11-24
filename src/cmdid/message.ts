import { Il2CppClass } from "../il2cpp/structs/class.js";
import { cmdIdConstant } from "./constant.js";

export interface CmdIdEntry {
    name: string;
    namespace: string;
    cmdId: number;
    method: "registry-network";
    rva: string;
    index: number;
}

export class RegisteredCommand {
    readonly registry = "network";
    readonly rva = "0x" + cmdIdConstant.registryInitializer.toString(16);

    constructor(readonly klass: Il2CppClass, readonly cmdId: number, readonly index: number) {}

    summary() {
        return { name: this.klass.fullName, image: this.klass.image.name, cmdId: this.cmdId, registry: this.registry,
            rva: this.rva, index: this.index };
    }

    entry(): CmdIdEntry {
        return { name: this.klass.name, namespace: this.klass.namespace, cmdId: this.cmdId, method: "registry-network",
            rva: this.rva, index: this.index };
    }
}
