import { cmdid } from "./cmdid/index.js";
import { addresses, base } from "./il2cpp/addresses.js";
import { api } from "./il2cpp/api.js";
import { assemblies, classes, ClassQuery, ClassSelector, resolveClass } from "./il2cpp/core.js";
import { invoke } from "./il2cpp/invoke.js";
import { Il2CppClass } from "./il2cpp/structs/class.js";
import { Il2CppType } from "./il2cpp/structs/type.js";
import { withThread } from "./il2cpp/thread.js";
import { cancelDump, dump, dumpStatus, waitDump } from "./dumper.js";
import { gpb } from "./gpb/index.js";

export const abc = {
    api, addresses, base, withThread, gpb, cmdid,
    assemblies: () => withThread(assemblies),
    classes: (options?: ClassQuery) => withThread(() => classes(options)),
    findClass: (options: ClassSelector | string) => withThread(() => resolveClass(options).toString()),
    inspect: (options: ClassSelector) => withThread(() => resolveClass(options).inspect(options.index)),
    fields: (klass: string) => withThread(() => Array.from(new Il2CppClass(ptr(klass)).fields(), field => field.summary())),
    methods: (klass: string) => withThread(() => Array.from(new Il2CppClass(ptr(klass)).methods(), method => method.summary())),
    typeName: (type: string) => withThread(() => new Il2CppType(ptr(type)).name),
    invoke: (...args: Parameters<typeof invoke>) => withThread(() => invoke(...args)),
    context: () => withThread(thread => ({
        base: base.toString(), domain: api.il2cpp_domain_get().toString(), thread: thread.toString(), nativeThreadId: Process.getCurrentThreadId()
    })),
    dump, waitDump, cancelDump, dumpStatus
};

export function installAgent(): void {
    (globalThis as typeof globalThis & { abc: typeof abc }).abc = abc;
    rpc.exports = {
        context: abc.context, assemblies: abc.assemblies, classes: abc.classes, findclass: abc.findClass,
        inspect: abc.inspect, invoke: abc.invoke, dump, waitdump: waitDump, canceldump: cancelDump, dumpstatus: dumpStatus,
        gpbclasses: gpb.classes, gpbinspect: gpb.inspect, gpbprobe: gpb.probe,
        dumpproto: gpb.dump, protostatus: gpb.status, cancelproto: gpb.cancel, waitproto: gpb.wait,
        dumpcmdid: cmdid.dump, cmdidprobe: cmdid.probe, cmdidregistries: cmdid.registries
    };
}
