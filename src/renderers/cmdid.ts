import type { CmdIdEntry } from "../cmdid/dumper.js";

export class CmdIdRenderer {
    render(commands: Record<string, CmdIdEntry>): string {
        const lines = ["; CN 7.2.50 runtime CmdId dump", "; Written by Hueby", ""];
        const entries = Object.values(commands).sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name));
        for (const entry of entries) {
            const rva = entry.rva ? "0x" + entry.rva.replace(/^0x/i, "").toUpperCase() : "-";
            const index = entry.method === "getter" ? "" : " | Index: " + entry.index;
            lines.push(entry.name + " = " + entry.cmdId + " ; dump method: " + entry.method + " | RVA: " + rva + index);
        }
        return lines.join("\n") + "\n";
    }
}
