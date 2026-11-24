// ABC_CN_Windows_0.75.2: static codecs in ABC.Core/Common/Adventure.
export const gpbConstant = {
    images: [
        "ABC.Core.dll",
        "ABC.Adventure.dll",
        "ABC.Common.dll",
    ],
    responseInterface: "E2107772BDBD37C2",
    input: "BF7236134CE913EC",
    output: "EB1049810EFBEE36",
    byteString: "byte[]",
    list: "System.Collections.Generic.List",
    pooledList: "E13516D02DFE8FFC",
    dictionary: "BB9BBD65AB4DDD46.A5C14D56EA9D7CBB",
    derivedKeyPair: "B49316AD85A4AB65",
    methods: { mergeFrom: "E4F51C817323798E", writeTo: "AACD544EE3B749E4" },
    native: {
        initializeInput: 0x4dcc4a0,
        readTag: 0x4caee90,
        dispatchTypePrefixed: 0x57e49b0,
        readDerivedKeyEntries: [0x57f43b0, 0x57f4510, 0x57f4690, 0x57f4810, 0x57f4a00, 0x57f4e20, 0x57f4f80, 0x57f50e0, 0x57f52d0, 0x57f54d0],
        readRawVarint32: 0x4cb0be0,
        skipLastField: 0x4c379a0,
        writeRawVarint32: 0x4b52020,
        growOutput: 0x4d48310
    }
} as const;

export function nativeSemantic(rva: number): string | undefined {
    return Object.entries(gpbConstant.native).find(([, value]) => typeof value === "number" ? value === rva :
        (value as readonly number[]).includes(rva))?.[0];
}
