import { Il2CppObject } from "./object.js";
import { Il2CppType } from "./type.js";

export function checkedLength(value: number, maximum = Number.MAX_SAFE_INTEGER): number {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw new Error("Invalid collection size: " + value);
    return value;
}

// CN 7.2.50: object header + bounds pointer + native-sized length; vector starts at +0x20.
export class Il2CppArray extends Il2CppObject {
    get bounds(): NativePointer { return this.handle.add(0x10).readPointer(); }
    get length(): number { return checkedLength(this.handle.add(0x18).readU64().toNumber()); }
    get data(): NativePointer { return this.handle.add(0x20); }
    get elementType(): Il2CppType { return this.klass.type.elementType; }

    elementAddress(index: number, stride = this.elementType.storageSize): NativePointer {
        if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) throw new Error("Array index out of bounds: " + index);
        if (!Number.isSafeInteger(stride) || stride <= 0 || !Number.isSafeInteger(index * stride)) throw new Error("Invalid array element stride: " + stride);
        return this.data.add(index * stride);
    }

    readBytes(length = this.length, offset = 0): ArrayBuffer {
        this.checkBytes(offset, length);
        if (!length) return new ArrayBuffer(0);
        const bytes = this.data.add(offset).readByteArray(length);
        if (bytes === null) throw new Error("Array byte read returned null");
        return bytes;
    }

    writeBytes(bytes: number[] | ArrayBuffer, offset = 0): void {
        const length = Array.isArray(bytes) ? bytes.length : bytes.byteLength;
        this.checkBytes(offset, length);
        if (length) this.data.add(offset).writeByteArray(bytes);
    }

    private checkBytes(offset: number, length: number): void {
        if (this.elementType.storageSize !== 1) throw new Error("Byte access requires a byte-sized array");
        checkedLength(offset, this.length);
        checkedLength(length, this.length - offset);
    }
}
