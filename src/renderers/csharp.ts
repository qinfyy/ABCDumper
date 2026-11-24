import {
    FIELD_ATTRIBUTE_FIELD_ACCESS_MASK, FIELD_ATTRIBUTE_PRIVATE, FIELD_ATTRIBUTE_FAM_AND_ASSEM, FIELD_ATTRIBUTE_ASSEMBLY,
    FIELD_ATTRIBUTE_FAMILY, FIELD_ATTRIBUTE_FAM_OR_ASSEM, FIELD_ATTRIBUTE_PUBLIC,
    METHOD_ATTRIBUTE_MEMBER_ACCESS_MASK, METHOD_ATTRIBUTE_STATIC, METHOD_ATTRIBUTE_VIRTUAL, METHOD_ATTRIBUTE_NEW_SLOT,
    METHOD_ATTRIBUTE_ABSTRACT, METHOD_ATTRIBUTE_PINVOKE_IMPL, METHOD_IMPL_ATTRIBUTE_INTERNAL_CALL,
    TYPE_ATTRIBUTE_VISIBILITY_MASK, TYPE_ATTRIBUTE_NOT_PUBLIC, TYPE_ATTRIBUTE_PUBLIC, TYPE_ATTRIBUTE_NESTED_PUBLIC,
    TYPE_ATTRIBUTE_NESTED_PRIVATE, TYPE_ATTRIBUTE_NESTED_FAMILY, TYPE_ATTRIBUTE_NESTED_ASSEMBLY,
    TYPE_ATTRIBUTE_NESTED_FAM_AND_ASSEM, TYPE_ATTRIBUTE_NESTED_FAM_OR_ASSEM, TYPE_ATTRIBUTE_ABSTRACT, TYPE_ATTRIBUTE_SEALED,
    PARAM_ATTRIBUTE_IN, PARAM_ATTRIBUTE_OUT
} from "../il2cpp/constant.js";
import { Il2CppClass } from "../il2cpp/structs/class.js";
import { Il2CppField } from "../il2cpp/structs/field.js";
import { Il2CppMethod, Il2CppParameter } from "../il2cpp/structs/method.js";

const indent = "    ";
const hex = (value: number): string => "0x" + value.toString(16).toUpperCase();
// Field and Method member-access values are identical in il2cpp-tabledefs.h.
const memberAccess: Record<number, string> = {
    [FIELD_ATTRIBUTE_PRIVATE]: "private", [FIELD_ATTRIBUTE_FAM_AND_ASSEM]: "private protected", [FIELD_ATTRIBUTE_ASSEMBLY]: "internal",
    [FIELD_ATTRIBUTE_FAMILY]: "protected", [FIELD_ATTRIBUTE_FAM_OR_ASSEM]: "protected internal", [FIELD_ATTRIBUTE_PUBLIC]: "public"
};
const typeAccess: Record<number, string> = {
    [TYPE_ATTRIBUTE_NOT_PUBLIC]: "internal", [TYPE_ATTRIBUTE_PUBLIC]: "public", [TYPE_ATTRIBUTE_NESTED_PUBLIC]: "public",
    [TYPE_ATTRIBUTE_NESTED_PRIVATE]: "private", [TYPE_ATTRIBUTE_NESTED_FAMILY]: "protected", [TYPE_ATTRIBUTE_NESTED_ASSEMBLY]: "internal",
    [TYPE_ATTRIBUTE_NESTED_FAM_AND_ASSEM]: "private protected", [TYPE_ATTRIBUTE_NESTED_FAM_OR_ASSEM]: "protected internal"
};
const keywords = new Set(("abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while").split(" "));
const identifier = (name: string): string => keywords.has(name) ? "@" + name : name;

export class CSharpRenderer {
    renderHeader(images: readonly { name: string; count: number }[]): string {
        let runningOffset = 0;
        const lines = images.map((image, index) => {
            const line = "// Image " + index + ": " + image.name + " - " + runningOffset;
            runningOffset += image.count;
            return line;
        });
        return lines.join("\n") + "\n\n";
    }

    render(klass: Il2CppClass, index: number, image: string): string {
        const kind = klass.kind;
        const modifiers = [typeAccess[klass.flags & TYPE_ATTRIBUTE_VISIBILITY_MASK]];
        if (kind === "class") {
            if ((klass.flags & (TYPE_ATTRIBUTE_ABSTRACT | TYPE_ATTRIBUTE_SEALED)) === (TYPE_ATTRIBUTE_ABSTRACT | TYPE_ATTRIBUTE_SEALED)) modifiers.push("static");
            else {
                if (klass.flags & TYPE_ATTRIBUTE_ABSTRACT) modifiers.push("abstract");
                if (klass.flags & TYPE_ATTRIBUTE_SEALED) modifiers.push("sealed");
            }
        }
        const bases: string[] = [];
        const parent = klass.parent;
        if (parent && !["System.Object", "System.ValueType", "System.Enum"].includes(parent.fullName)) bases.push(parent.type.name);
        bases.push(...klass.interfaces.map(type => type.name));
        const lines = [
            "// Image: " + image + "; TypeDefIndex: " + index,
            "// Namespace: " + klass.namespace + (klass.declaringClass ? "; DeclaringType: " + klass.declaringClass.fullName : ""),
            "// RuntimeClass: " + klass + "; InstanceSize: " + hex(klass.instanceSize) + "; StaticSize: " + hex(klass.staticSize),
            modifiers.join(" ") + " " + kind + " " + identifier(klass.name) + (bases.length ? " : " + bases.join(", ") : ""),
            "{"
        ];
        for (const field of klass.fields()) lines.push(this.field(field));
        for (const method of klass.methods()) lines.push(...this.method(method, klass.name, kind));
        lines.push("}", "");
        return lines.join("\n") + "\n";
    }

    private field(field: Il2CppField): string {
        const flags = field.flags;
        const modifiers = [memberAccess[flags & FIELD_ATTRIBUTE_FIELD_ACCESS_MASK] ?? ""];
        if (field.isLiteral) modifiers.push("const");
        else {
            if (field.isStatic) modifiers.push("static");
            if (field.isReadOnly) modifiers.push("readonly");
        }
        const location = field.isLiteral ? "literal; value not recovered" : "Offset: " + hex(field.offset) + "; " + field.storage;
        return indent + modifiers.filter(Boolean).join(" ") + " " + field.type.name + " " + identifier(field.name) +
            "; // " + location;
    }

    private parameter(parameter: Il2CppParameter, index: number): string {
        let type = parameter.type.name;
        let modifier = "";
        if (parameter.type.isByReference) {
            type = type.slice(0, -1);
            modifier = parameter.type.attributes & PARAM_ATTRIBUTE_OUT ? "out " : parameter.type.attributes & PARAM_ATTRIBUTE_IN ? "in " : "ref ";
        }
        return modifier + type + " " + identifier(parameter.name || "arg" + index);
    }

    private method(method: Il2CppMethod, className: string, kind: string): string[] {
        const flags = method.flags;
        const name = method.name;
        const constructor = name === ".ctor" || name === ".cctor";
        const modifiers: string[] = name === ".cctor" ? ["static"] : [memberAccess[flags & METHOD_ATTRIBUTE_MEMBER_ACCESS_MASK] ?? ""];
        if (!constructor) {
            if (flags & METHOD_ATTRIBUTE_STATIC) modifiers.push("static");
            if (flags & METHOD_ATTRIBUTE_ABSTRACT) modifiers.push("abstract");
            else if (flags & METHOD_ATTRIBUTE_VIRTUAL) modifiers.push(flags & METHOD_ATTRIBUTE_NEW_SLOT ? "virtual" : "override");
            if (method.implementationFlags & METHOD_IMPL_ATTRIBUTE_INTERNAL_CALL || flags & METHOD_ATTRIBUTE_PINVOKE_IMPL) modifiers.push("extern");
        }
        let returnType = method.returnType.name;
        if (returnType.endsWith("&")) returnType = "ref " + returnType.slice(0, -1);
        const signature = modifiers.filter(Boolean).join(" ") + " " +
            (constructor ? identifier(className) : returnType + " " + identifier(name)) + "(" +
            method.parameters.map((parameter, index) => this.parameter(parameter, index)).join(", ") + ")";
        const noBody = kind === "interface" || Boolean(flags & METHOD_ATTRIBUTE_ABSTRACT) ||
            Boolean(method.implementationFlags & METHOD_IMPL_ATTRIBUTE_INTERNAL_CALL) || Boolean(flags & METHOD_ATTRIBUTE_PINVOKE_IMPL);
        return [indent + "// RVA: " + method.rva + "; VA: " + method.body + "; MethodInfo: " + method + "; Invoker: " + method.invoker,
            indent + signature + (noBody ? ";" : " {}")];
    }
}
