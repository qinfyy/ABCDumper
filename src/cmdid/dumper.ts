import { target } from "../il2cpp/addresses.js";
import { ClassQuery, ClassSelector } from "../il2cpp/core.js";
import { withThread } from "../il2cpp/thread.js";
import { openOutputFile } from "../io/file.js";
import { CmdIdRenderer } from "../renderers/cmdid.js";
import { CommandCatalog } from "./discovery.js";
import { CommandRegistry } from "./registry.js";

export interface CmdIdDumpOptions extends ClassQuery { output?: string; }

export interface CmdIdDumpResult {
    output: string;
    commands: number;
}

export class CmdIdDumper {
    private readonly catalog = new CommandCatalog();
    private readonly registry = new CommandRegistry();

    // RPC exports retain function references without a receiver.
    readonly probe = (selector: ClassSelector | string) => withThread(() => this.catalog.describe(this.registry.read(), selector));
    readonly registries = () => withThread(() => this.registry.read().map(command => command.summary()));

    readonly dump = (options: CmdIdDumpOptions = {}): CmdIdDumpResult => {
        const commands = withThread(() => this.catalog.select(this.registry.read(), options).map(command => command.entry()));
        const output = options.output ?? target.path.replace(/[^\\/]+$/, "") + "RuntimeDump\\CmdIds.txt";
        const file = openOutputFile(output);
        try { file.write(new CmdIdRenderer().render(commands)); }
        finally { file.close(); }
        const result = { output, commands: commands.length };
        send({ event: "cmdid-complete", ...result });
        return result;
    };
}
