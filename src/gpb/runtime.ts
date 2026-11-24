import { base } from "../il2cpp/addresses.js";
import { Il2CppMethodBinding } from "../il2cpp/structs/method.js";
import { gpbConstant } from "./constant.js";

const initializeInput = new NativeFunction(base.add(gpbConstant.native.initializeInput), "void", ["pointer", "pointer"]);
const spanSize = 0x10, inputSize = 0x80, outputSize = 0x28;
const inputCapacity = 256, outputCapacity = 65536;

export class ProtoRuntime {
    private readonly inputBuffer = Memory.alloc(inputCapacity);
    private readonly inputSpan = Memory.alloc(spanSize);
    private readonly input = Memory.alloc(inputSize);
    private readonly outputBuffer = Memory.alloc(outputCapacity);
    private readonly output = Memory.alloc(outputSize);
    private readonly emptyOutput = new ArrayBuffer(outputSize);

    merge(method: Il2CppMethodBinding, message: NativePointer, bytes: number[], inline = false): boolean {
        if (bytes.length > inputCapacity) throw new Error("Probe exceeds input buffer");
        if (bytes.length) this.inputBuffer.writeByteArray(bytes);
        this.inputSpan.writePointer(this.inputBuffer).add(8).writeU32(bytes.length).add(4).writeU32(0);
        initializeInput(this.inputSpan, this.input);
        const slot = inline ? message : Memory.alloc(Process.pointerSize).writePointer(message);
        method.invoke([this.input, slot]);
        if (!inline && !slot.readPointer().equals(message)) throw new Error("Merge replaced the sample object");
        // The refill path (0x4E78480) moves consumed bytes to the retired count at EOF.
        const position = this.input.add(0x10).readS32(), retired = this.input.add(0x20).readS32();
        return position >= 0 && retired >= 0 && position + retired === bytes.length;
    }

    typePrefixed(run: () => boolean): boolean {
        return this.observeRead([gpbConstant.native.dispatchTypePrefixed], run);
    }

    derivedKey(run: () => boolean): boolean {
        return this.observeRead(gpbConstant.native.readDerivedKeyEntries, run, 0);
    }

    private observeRead(addresses: readonly number[], run: () => boolean, depth?: number): boolean {
        let dispatched = false;
        const input = this.input, tid = Process.getCurrentThreadId();
        const listeners = addresses.map(address => Interceptor.attach(base.add(address), {
            onEnter(args) {
                if (this.threadId === tid && args[0].equals(input) && (depth === undefined || input.add(0x24).readS32() === depth)) dispatched = true;
            }
        }));
        try { return run() && dispatched; }
        finally { listeners.forEach(listener => listener.detach()); }
    }

    serialize(method: Il2CppMethodBinding, message: NativePointer): number[] {
        // The flat-span writer throws if exhausted without a backing writer (0x4D48310).
        this.output.writeByteArray(this.emptyOutput).writePointer(this.outputBuffer).add(8).writeU32(outputCapacity);
        this.output.add(0x10).writeU32(outputCapacity);
        method.invoke([this.output, message]);
        const length = this.output.add(0x14).readS32();
        if (length < 0 || length > outputCapacity || !this.output.readPointer().equals(this.outputBuffer)) {
            throw new Error("Invalid protobuf write span");
        }
        return length ? Array.from(new Uint8Array(this.outputBuffer.readByteArray(length)!)) : [];
    }
}
