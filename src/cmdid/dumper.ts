import { target } from "../il2cpp/addresses.js";
import { ClassQuery, ClassSelector } from "../il2cpp/core.js";
import { withThread } from "../il2cpp/thread.js";
import { openOutputFile } from "../io/file.js";
import { CmdIdRenderer } from "../renderers/cmdid.js";
import { CommandCatalog } from "./discovery.js";
import { CmdIdEntry } from "./message.js";
import { CommandRegistry } from "./registry.js";

export type { CmdIdEntry } from "./message.js";

export interface CmdIdDumpOptions extends ClassQuery { output?: string; }

export interface CmdIdDumpResult {
    output: string;
    commands: number;
}

export class CmdIdDumper {
    private readonly catalog = new CommandCatalog();
    private readonly registry = new CommandRegistry();

    // RPC exports retain function references without a receiver.
    readonly probe = (selector: ClassSelector | string) => withThread(() => this.catalog.resolve(selector).describe(this.registry));
    readonly registries = () => withThread(() => [...this.registry.values()]);
    readonly dump = (options: CmdIdDumpOptions = {}): CmdIdDumpResult =>
        new CmdIdDumpSession(this.catalog, this.registry, { ...options }).run();
}

class CmdIdDumpSession {
    constructor(private readonly catalog: CommandCatalog, private readonly registry: CommandRegistry, private readonly options: CmdIdDumpOptions) {}

    run(): CmdIdDumpResult {
        const commands = withThread(() => this.collect());
        const output = this.options.output ?? target.path.replace(/[^\\/]+$/, "") + "RuntimeDump\\CmdIds.txt";
        const file = openOutputFile(output);
        try { file.write(new CmdIdRenderer().render(commands)); }
        finally { file.close(); }
        const result = { output, commands: Object.keys(commands).length };
        send({ event: "cmdid-complete", ...result });
        return result;
    }

    private collect(): Record<string, CmdIdEntry> {
        const commands: Record<string, CmdIdEntry> = {};
        for (const type of this.catalog.select(this.options)) {
            const command = type.command(this.registry);
            if (command) commands[type.fullName] = command;
        }
        return Object.fromEntries(Object.entries(commands).sort(([a], [b]) => a.localeCompare(b)));
    }
}
