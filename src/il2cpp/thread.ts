import { api } from "./api.js";

// A scope is synchronous: an awaited continuation may execute on a different native thread.
export function withThread<T>(work: (thread: NativePointer) => T extends PromiseLike<unknown> ? never : T): T {
    const before = api.il2cpp_thread_current();
    const domain = api.il2cpp_domain_get();
    if (domain.isNull()) throw new Error("IL2CPP domain not initialized");
    const thread = before.isNull() ? api.il2cpp_thread_attach(domain) : before;
    if (thread.isNull()) throw new Error("Thread::Attach returned null");
    try {
        return work(thread);
    } finally {
        if (before.isNull()) api.il2cpp_thread_detach(thread);
    }
}
