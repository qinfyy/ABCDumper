import { MergeFromRecovery } from "./dumpers/merge.js";
import { MergeProbeCatalog } from "./dumpers/merge-probes.js";
import { WriteToRecovery } from "./dumpers/write.js";
import { ProtoMessageType } from "./message.js";
import { ProtoRuntime } from "./runtime.js";
import { ProtoField, ProtoMessage } from "./schema.js";

export interface ProtoRecoveryOptions {
    maxField?: number;
    mode?: "auto" | "merge" | "write";
}

export class ProtoRecovery {
    private readonly maxField: number;
    private readonly probes = new MergeProbeCatalog();

    constructor(private readonly runtime: ProtoRuntime, private readonly options: ProtoRecoveryOptions = {}) {
        this.maxField = options.maxField ?? 128;
        if (!Number.isInteger(this.maxField) || this.maxField < 1 || this.maxField > 8192) throw new Error("protobuf maxField must be 1..8192");
    }

    recover(type: ProtoMessageType): ProtoMessage {
        if (!type.isMessage) throw new Error("Class has no matching HNA protobuf codec: " + type.fullName);
        const merge = this.options.mode !== "write" && type.codecs.reader;
        const write = this.options.mode !== "merge" && type.codecs.writer;
        if (write) {
            const message = new WriteToRecovery(type, this.runtime).recover();
            if (message.unresolved.length && merge) {
                const output = this.merge(type, message.fields);
                const recovered = new Set(output.fields.flatMap(field => field.oneof ? [field.name, field.oneof] : [field.name]));
                message.fields.push(...output.fields);
                message.unresolved = message.unresolved.filter(field => !recovered.has(field.split(":")[0]));
                message.diagnostics = output.diagnostics;
            }
            return message;
        }
        if (merge) return this.merge(type);
        const message = type.message("none");
        message.unresolved = [...type.layout.unsupported, ...type.layout.members.map(member => member.field.name)];
        return message;
    }

    private merge(type: ProtoMessageType, known?: readonly ProtoField[]): ProtoMessage {
        return new MergeFromRecovery(type, this.runtime, this.maxField, this.probes).recover(known);
    }
}
