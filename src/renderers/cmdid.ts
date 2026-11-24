import type { CmdIdEntry } from "../cmdid/message.js";

export class CmdIdRenderer {
    render(commands: readonly CmdIdEntry[]): string {
        const lines = ["; CNCBWindows0.75.2 runtime CmdId dump", "; Written by Cyt", ""];
        const entries = [...commands].sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name) || a.cmdId - b.cmdId);
        for (const entry of entries) {
            const rva = "0x" + entry.rva.slice(2).toUpperCase();
            lines.push(entry.name + " = " + entry.cmdId + " ; dump method: " + entry.method + " | RVA: " + rva + " | Index: " + entry.index);
        }
        return lines.join("\n") + "\n";
    }
}
