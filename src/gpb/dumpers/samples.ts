import { Argument } from "../../il2cpp/invoke.js";
import { ManagedObject } from "../../il2cpp/manage/object.js";
import { ManagedString } from "../../il2cpp/manage/string.js";
import { ObjectScope } from "../../il2cpp/objects.js";
import { Il2CppMethodBinding } from "../../il2cpp/structs/method.js";
import { Il2CppObject } from "../../il2cpp/structs/object.js";
import { writeScalar } from "../../il2cpp/structs/value.js";
import { ProtoCollection } from "../collections.js";
import { ProtoMember } from "../fields.js";
import type { ProtoMessageType } from "../message.js";
import { ProtoRuntime } from "../runtime.js";
import { gpbConstant } from "../constant.js";
import { inlineSchema, ProtoType } from "../schema.js";
import { WireField, WireReader } from "../wire.js";

type SampleArgument = NativePointer | Extract<Argument, { type: string }>;
type SampleVariant = 0 | 1 | 2;

// 0.75.2: these empty readers leave the new reference null, and their parents store it back.
const emptyMergeReferences = new Set(["EDFCCF0A1AF77CA6", "B6FF6124CF508FB0", "E9B9029AD5E8E246",
    "E897C1473D23AFA6", "BF586511F342E4C1", "F73876910FA7A709", "BDB61A1DE6BA56FD"]);

export class MessageSample extends ManagedObject {
    private readonly reader?: Il2CppMethodBinding;
    private readonly writer?: Il2CppMethodBinding;
    private readonly snapshots = new Map<ProtoMember, string>();

    private constructor(handle: NativePointer, readonly type: ProtoMessageType, private readonly scope: ObjectScope) {
        super(handle);
        const { reader, writer } = type.codecs;
        if (reader) this.reader = new Il2CppMethodBinding(reader, NULL);
        if (writer) this.writer = new Il2CppMethodBinding(writer, NULL);
    }

    static create(type: ProtoMessageType): MessageSample {
        const scope = new ObjectScope();
        try {
            const object = scope.allocate(type);
            const ctor = type.findMethod(".ctor", { parameterCount: 0, isStatic: false, native: true });
            if (ctor) new Il2CppMethodBinding(ctor, type.isValueType ? object.data : object.handle).invoke();
            return new MessageSample(object.handle, type, scope);
        }
        catch (error) { scope.close(); throw error; }
    }

    serialize(runtime: ProtoRuntime): WireField[] {
        if (!this.writer) throw new Error("Message has no declared WriteTo");
        return new WireReader(runtime.serialize(this.writer, this.type.isValueType ? this.data : this.handle)).read();
    }

    merge(runtime: ProtoRuntime, bytes: number[]): boolean {
        if (!this.reader) throw new Error("Message has no declared MergeFrom");
        const inline = this.type.isValueType;
        return runtime.merge(this.reader, inline ? this.data : this.handle, bytes, inline);
    }

    capture(): void { for (const member of this.type.layout.members) this.snapshots.set(member, member.snapshot(this)); }

    primeMergeDefaults(): void {
        for (const member of this.type.layout.ordinary) {
            // 0.75.2: 0x4A0EF25 stores zero when the independently parsed identifier cannot be resolved.
            if (member.type.managed === "F9C2B2206194B4EA" && member.type.klass?.instanceSize === Il2CppObject.headerSize + 8) {
                member.address(this).writeU64(37);
            }
            if (member.type.klass?.kind === "class" && emptyMergeReferences.has(member.type.managed) &&
                member.address(this).readPointer().isNull()) this.populate(member);
        }
    }

    changedMembers(): ProtoMember[] {
        const changed: ProtoMember[] = [];
        for (const member of this.type.layout.members) {
            const current = member.snapshot(this);
            if (this.snapshots.get(member) !== current) changed.push(member);
            this.snapshots.set(member, current);
        }
        return changed;
    }

    populate(member: ProtoMember, variant: SampleVariant = 0): void {
        const address = member.address(this), type = member.type;
        if (!type.element) {
            const inline = inlineSchema(type);
            if (inline) {
                inline.forEach((field, index) => {
                    const at = address.add(field.offset);
                    if (field.type === "float") at.writeFloat(1.25 + index);
                    else if (field.type === "bool") at.writeU8(1);
                    else at.writeU64(37);
                });
                return;
            }
            if (type.klass?.kind === "struct" || type.isWireAlias) throw new Error("Managed wrapper requires MergeFrom evidence: " + type.managed);
            const argument = this.argument(type, variant);
            if ("type" in argument) writeScalar(address, argument.type, argument.value);
            else member.field.setReference(this.handle, argument);
            return;
        }
        if (type.managed.startsWith(gpbConstant.pooledList + "<")) throw new Error("Pooled list requires MergeFrom evidence");
        let handle = address.readPointer();
        if (handle.isNull()) {
            handle = this.scope.create(member.field.type.klass);
            member.field.setReference(this.handle, handle);
        }
        const args = type.key ? [this.argument(type.key, variant), this.argument(type.element, variant === 0 ? 1 : 0)] :
            [this.argument(type.element, variant)];
        new ProtoCollection(handle).add(type, ...args);
    }

    close(): void { this.scope.close(); }

    private argument(type: ProtoType, variant: SampleVariant): SampleArgument {
        const signed = [-37, 131, -4099][variant], unsigned = [37, 131, 4099][variant], floating = [1.25, 2.25, -3.75][variant];
        if (type.klass?.kind === "enum") return { type: "int", value: variant + 1 };
        const samples: Record<string, Extract<Argument, { type: string }>> = {
            bool: { type: "bool", value: true }, int: { type: "int", value: signed }, uint: { type: "uint", value: unsigned },
            long: { type: "long", value: signed }, ulong: { type: "ulong", value: unsigned },
            float: { type: "float", value: floating }, double: { type: "double", value: floating }
        };
        if (samples[type.managed]) return samples[type.managed];
        if (type.name === "string") return ManagedString.create(variant ? "B" : "A", this.scope).handle;
        if (type.bytesClass) {
            const bytes = this.scope.array(type.bytesClass, 1);
            bytes.writeBytes([65]);
            return bytes.handle;
        }
        if (inlineSchema(type) || type.klass?.kind === "struct" || type.isWireAlias) {
            throw new Error("Inline collection writer sample unavailable: " + type.managed);
        }
        if (type.klass) return this.scope.create(type.klass);
        throw new Error("Cannot sample " + type.managed);
    }
}
