import { target } from "./il2cpp/addresses.js";
import { images } from "./il2cpp/core.js";
import { withThread } from "./il2cpp/thread.js";
import { openOutputFile } from "./io/file.js";
import { CSharpRenderer } from "./renderers/csharp.js";

export interface DumpOptions {
    image?: string;
    offset?: number;
    count?: number;
    batchSize?: number;
    output?: string;
}

export interface DumpResult {
    output: string;
    dumped: number;
    failed: number;
    cancelled: boolean;
    finished: boolean;
}

let active: Promise<DumpResult> | undefined;
let last: DumpResult | undefined;
let cancelled = false;

export function dump(options: DumpOptions = {}): Promise<DumpResult> {
    if (active) throw new Error("A dump is already running");
    cancelled = false;
    active = runDump(options).finally(() => { active = undefined; });
    return active;
}

export function waitDump(): Promise<DumpResult> {
    if (active) return active;
    if (last) return Promise.resolve(last);
    return dump();
}

export function cancelDump(): void { cancelled = true; }
export function dumpStatus() { return { active: active !== undefined, result: last }; }

async function runDump(options: DumpOptions): Promise<DumpResult> {
    const allImages = withThread(() => images()
        .map(image => ({ image, name: image.name, start: image.typeStart, count: image.typeCount })));
    const selected = allImages.filter(image => !options.image || image.name === options.image);
    if (!selected.length) throw new Error("No matching image: " + options.image);
    const offset = options.offset ?? 0;
    const batchSize = options.batchSize ?? 64;
    if (!Number.isInteger(batchSize) || batchSize <= 0) throw new Error("batchSize must be positive");
    if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be nonnegative");
    if (options.count !== undefined && (!Number.isInteger(options.count) || options.count < 0)) throw new Error("count must be nonnegative");
    const output = options.output ?? target.path.replace(/[^\\/]+$/, "") + "RuntimeDump\\dump.cs";
    const result: DumpResult = { output, dumped: 0, failed: 0, cancelled: false, finished: false };
    last = result;
    let file: File;
    try {
        file = openOutputFile(output);
    } catch (error) {
        throw new Error("Cannot open dump output " + output + ": " + String(error));
    }
    const renderer = new CSharpRenderer();
    send({ event: "dump-start", output });
    try {
        file.write("// CN 7.2.50 runtime metadata dump\n" + "// Written by Hueby\n\n");
        file.write(renderer.renderHeader(allImages));
        for (const item of selected) {
            const end = Math.min(item.count, offset + (options.count ?? item.count));
            for (let first = offset; first < end && !cancelled; first += batchSize) {
                withThread(() => {
                    for (let local = first; local < Math.min(end, first + batchSize); local++) {
                        const index = item.start + local;
                        let rendered: string;
                        try {
                            rendered = renderer.render(item.image.classAt(local), index, item.name);
                        } catch (error) {
                            const detail = String(error).replace(/[\r\n]/g, " ");
                            file.write("// ERROR TypeDefIndex: " + index + "; " + item.name + "; " + detail + "\n");
                            result.failed++;
                            send({ event: "class-error", index, image: item.name, error: detail });
                            continue;
                        }
                        file.write(rendered);
                        result.dumped++;
                    }
                });
                // The native thread scope has ended before yielding to Frida's event loop.
                await new Promise<void>(resolve => setTimeout(resolve, 0));
            }
            file.flush();
            send({ event: "image-dumped", image: item.name, dumped: result.dumped, failed: result.failed });
            if (cancelled) break;
        }
        result.cancelled = cancelled;
    } finally {
        file.close();
    }
    result.finished = true;
    send({ event: "dump-complete", ...result });
    return result;
}
