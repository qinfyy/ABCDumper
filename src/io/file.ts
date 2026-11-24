const createDirectory = new SystemFunction(Process.getModuleByName("kernel32.dll").getExportByName("CreateDirectoryW"), "int", ["pointer", "pointer"]);

export function openOutputFile(path: string): File {
    const separator = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
    if (separator > 0) {
        const directory = path.slice(0, separator);
        const result = createDirectory(Memory.allocUtf16String(directory), NULL) as WindowsSystemFunctionResult<number>;
        if (!result.value && result.lastError !== 183) {
            throw new Error("Cannot create directory " + directory + ": Win32 error " + result.lastError);
        }
    }
    return new File(path, "w");
}
