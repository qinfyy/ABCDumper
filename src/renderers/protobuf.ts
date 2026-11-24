import { InlineField, ProtoEnum, ProtoMessage, ProtoType, identifier } from "../gpb/schema.js";

function typeName(type: ProtoType): string {
    if (type.key) return "map<" + typeName(type.key) + ", " + typeName(type.element!) + ">";
    return (type.repeated ? "repeated " : "") + type.name;
}

function rva(address?: string | null): string { return address ? "0x" + address.replace(/^0x/i, "").toUpperCase() : "-"; }

export class ProtobufRenderer {
    header(): string { return '// CNCBWindows0.75.2 runtime protobuf schema dump\n// Written by Cyt\n\nsyntax = "proto3";\n\n'; }

    section(name: "Messages" | "Enums"): string { return "// " + name + "\n\n"; }
    assembly(name: string): string { return "// Assembly: " + name.replace(/[\r\n]/g, " ") + "\n\n"; }

    message(message: ProtoMessage): string {
        const method = message.mode === "none" ? "-" : message.mode;
        const comment = "// dump method: " + method + " | MergeFrom: " + rva(message.methods?.mergeFrom) + " | WriteTo: " + rva(message.methods?.writeTo);
        const lines = [comment, "message " + message.name + " {"];
        const needsEntry = (field: ProtoMessage["fields"][number]): boolean =>
            !!field.type.key && (field.keyNumber === 2 || !!field.type.key.klass);
        const entryName = (name: string): string => identifier(name) + "_Entry";
        const render = (field: ProtoMessage["fields"][number], indent: string): string => indent +
            (needsEntry(field) ? "repeated " + entryName(field.name) : typeName(field.type)) + " " +
            identifier(field.name) + " = " + field.number + (field.packed !== undefined ? " [packed = " + field.packed + "]" : "") +
            (field.baseSegment ? "; // Base message, no separate field slot" : "; // Offset: 0x" + field.offset.toString(16)) +
            (field.xor ? " | XOR: " + field.xor : "") +
            (field.typePrefixed ? " | Type-prefixed payload (" + field.type.managed + ")" : "") +
            (field.derivedKey ? " | Dictionary key derived from value" : "") +
            (field.type.packable && field.packed === undefined ? " | packed: unverified" : "");
        const fields = [...message.fields].sort((a, b) => a.number - b.number);
        for (const field of fields.filter(needsEntry)) {
            const key = typeName(field.type.key!) + " key = " + field.keyNumber + ";";
            const value = typeName(field.type.element!) + " value = " + (field.keyNumber === 2 ? 1 : 2) + ";";
            lines.push("    message " + entryName(field.name) + " {",
                ...(field.keyNumber === 2 ? [value, key] : [key, value]).map(line => "        " + line), "    }");
        }
        fields.filter(field => !field.oneof).forEach(field => lines.push(render(field, "    ")));
        for (const name of new Set(fields.flatMap(field => field.oneof ? [field.oneof] : []))) {
            lines.push("    oneof " + identifier(name) + " {");
            fields.filter(field => field.oneof === name).forEach(field => lines.push(render(field, "        ")));
            lines.push("    }");
        }
        message.unresolved.forEach(field => lines.push("    // UNRESOLVED: " + field.replace(/[\r\n]/g, " ")));
        message.managedOnly?.forEach(field => lines.push("    // MANAGED ONLY: " + field.replace(/[\r\n]/g, " ")));
        message.diagnostics?.forEach(detail => lines.push("    // PROBE ERROR: " + detail.replace(/[\r\n]/g, " ")));
        lines.push("}", "");
        return lines.join("\n") + "\n";
    }

    inline(name: string, fields: readonly InlineField[]): string {
        return ["// Native inline codec", "message " + name + " {",
            ...fields.map(field => `    ${field.type} ${identifier(field.name)} = ${field.number};`), "}", "", ""].join("\n");
    }

    enum(enumeration: ProtoEnum): string {
        const values = [...enumeration.values].sort((a, b) => (a.value === 0 ? -1 : b.value === 0 ? 1 : 0));
        const lines = ["enum " + enumeration.name + " {"];
        if (new Set(values.map(value => value.value)).size !== values.length) lines.push("    option allow_alias = true;");
        if (!values.some(value => value.value === 0)) lines.push("    " + enumeration.name + "_UNSPECIFIED = 0;");
        values.forEach(value => lines.push("    " + enumeration.name + "_" + identifier(value.name) + " = " + value.value + ";"));
        lines.push("}", "");
        return lines.join("\n") + "\n";
    }
}
