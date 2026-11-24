import { target } from "../il2cpp/addresses.js";
import { ClassSelector } from "../il2cpp/core.js";
import { withThread } from "../il2cpp/thread.js";
import { openOutputFile } from "../io/file.js";
import { ProtobufRenderer } from "../renderers/protobuf.js";
import { gpbConstant } from "./constant.js";
import { ProtocolCatalog, ProtocolQuery } from "./discovery.js";
import { EnumRegistry } from "./enums.js";
import { ProtoMessageType } from "./message.js";
import { ProtoRecovery, ProtoRecoveryOptions } from "./recovery.js";
import { ProtoRuntime } from "./runtime.js";
import { InlineField, inlineSchema, ProtoMethodRvas } from "./schema.js";

export interface ProtoDumpOptions extends ProtocolQuery, ProtoRecoveryOptions {
    output?: string;
    batchSize?: number;
}

export interface ProtoDumpResult {
    output: string;
    total: number;
    messages: number;
    enums: number;
    fields: number;
    mergeFrom: number;
    writeTo: number;
    incomplete: number;
    failed: number;
    cancelled: boolean;
    finished: boolean;
}

export class ProtoDumper {
    readonly gpbConstant = gpbConstant;
    private readonly catalog = new ProtocolCatalog();
    private active?: Promise<ProtoDumpResult>;
    private session?: ProtoDumpSession;

    // RPC exports retain function references without a receiver.
    readonly classes = (options?: ProtocolQuery | null) => withThread(() => this.catalog.select(options ?? {}).map(type => type.summary()));
    readonly inspect = (selector: ClassSelector | string, instructions = false) => withThread(() => this.catalog.resolve(selector).describe(instructions));
    readonly probe = (selector: ClassSelector | string, options: ProtoDumpOptions = {}) => withThread(() => {
        const runtime = new ProtoRuntime();
        const type = this.catalog.resolve(selector), message = new ProtoRecovery(runtime, options ?? {}).recover(type);
        const enums = new EnumRegistry();
        enums.collect(message);
        return { ...message, fields: message.fields.map(field => ({ ...field, type: field.type.plain() })), enums: [...enums.values()] };
    });

    readonly dump = (options: ProtoDumpOptions = {}): Promise<ProtoDumpResult> => {
        if (this.active) throw new Error("A protobuf dump is already running");
        this.session = new ProtoDumpSession(this.catalog, { ...options });
        this.active = this.session.run().finally(() => { this.active = undefined; });
        return this.active;
    };

    readonly status = () => ({ active: this.active !== undefined, result: this.session?.result });
    readonly cancel = (): void => { this.session?.cancel(); };
    readonly wait = (): Promise<ProtoDumpResult> => this.active ?? (this.session?.result ? Promise.resolve(this.session.result) : this.dump());
}

function append(groups: Map<string, string[]>, assembly: string, text: string): void {
    const group = groups.get(assembly);
    if (group) group.push(text);
    else groups.set(assembly, [text]);
}

class ProtoDumpSession {
    readonly result: ProtoDumpResult;
    private readonly batchSize: number;
    private readonly renderer = new ProtobufRenderer();
    private readonly enums = new EnumRegistry();
    private readonly inline = new Map<string, { assembly: string; fields: readonly InlineField[] }>();
    private cancelled = false;

    constructor(private readonly catalog: ProtocolCatalog, private readonly options: ProtoDumpOptions) {
        this.batchSize = options.batchSize ?? 8;
        if (!Number.isInteger(this.batchSize) || this.batchSize <= 0) throw new Error("Invalid protobuf batchSize");
        const filename = options.image === undefined && options.match === undefined && options.count === undefined ? "dump.proto" : "probe.proto";
        const output = options.output ?? target.path.replace(/[^\\/]+$/, "") + "RuntimeDump\\" + filename;
        this.result = { output, total: 0, messages: 0, enums: 0, fields: 0,
            mergeFrom: 0, writeTo: 0, incomplete: 0, failed: 0, cancelled: false, finished: false };
    }

    cancel(): void { this.cancelled = true; }

    async run(): Promise<ProtoDumpResult> {
        const { allImages, image, offset, count } = this.options;
        if (allImages && (image !== undefined || offset !== undefined || count !== undefined)) {
            throw new Error("allImages cannot be combined with image, offset or count");
        }
        const types = withThread(() => this.catalog.select(this.options).map(type => ({ type, assembly: type.image.name })));
        if (!types.length) throw new Error("No matching HNA codecs");
        const file = openOutputFile(this.result.output);
        this.result.total = types.length;
        try {
            send({ event: "proto-start", ...this.result });
            file.write(this.renderer.header());
            const messages = new Map<string, string[]>(), enums = new Map<string, string[]>();
            const recovery = new ProtoRecovery(new ProtoRuntime(), this.options);
            for (let first = 0; first < types.length && !this.cancelled; first += this.batchSize) {
                withThread(() => {
                    for (const { type, assembly } of types.slice(first, first + this.batchSize)) {
                        append(messages, assembly, this.dumpMessage(type, recovery));
                    }
                });
                send({ event: "proto-progress", processed: Math.min(first + this.batchSize, types.length), ...this.result });
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            for (const [name, { assembly, fields }] of this.inline) append(messages, assembly, this.renderer.inline(name, fields));
            for (const enumeration of this.enums.values()) append(enums, enumeration.assembly, this.renderer.enum(enumeration));
            for (const [name, groups] of [["Messages", messages], ["Enums", enums]] as const) {
                file.write(this.renderer.section(name));
                for (const [assembly, entries] of groups) {
                    file.write(this.renderer.assembly(assembly));
                    for (const entry of entries) file.write(entry);
                }
            }
            file.flush();
            this.result.enums = this.enums.size;
            this.result.cancelled = this.cancelled;
            this.result.finished = true;
            send({ event: "proto-complete", ...this.result });
            return this.result;
        } finally {
            file.close();
        }
    }

    private dumpMessage(type: ProtoMessageType, recovery: ProtoRecovery): string {
        let methods: ProtoMethodRvas | undefined;
        try {
            methods = type.codecs.rvas;
            const message = recovery.recover(type);
            this.enums.collect(message);
            for (const field of message.fields) {
                const type = field.type.element ?? field.type, inline = inlineSchema(type);
                if (inline && !this.inline.has(type.name)) this.inline.set(type.name, { assembly: type.klass!.image.name, fields: inline });
            }
            const rendered = this.renderer.message(message);
            this.result.messages++;
            this.result.fields += message.fields.length;
            if (message.mode === "MergeFrom") this.result.mergeFrom++;
            if (message.mode === "WriteTo") this.result.writeTo++;
            if (message.unresolved.length) this.result.incomplete++;
            return rendered;
        } catch (error) {
            this.result.failed++;
            send({ event: "proto-class-error", name: type.fullName, error: String(error) });
            return this.renderer.message({ name: type.protobufName, mode: "none", fields: [],
                methods, unresolved: [String(error)] });
        }
    }
}
