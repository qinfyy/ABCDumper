# MiniDumper

支持版本：`CNBETAWin4.3.53`

CSharp dump
```CSharp
namespace: RPG.Client
Assembly: Assembly-CSharp.dll
class ClientStartupConfig : Object {

	0xff20 | static RPG.Client.ClientStartupConfig <Data>k__BackingField;
	0x10 | string ChannelName;
	0x18 | System.String[] OriginLiveGlobalDispatchUrlList;
	0x20 | string ProductName;
	0x28 | System.String[] OriginTestGlobalDispatchUrlList;
	0x30 | System.String[] OriginCbGlobalDispatchUrlList;
	0x38 | string BundleIdentifier;
	0x40 | System.String[] GlobalDispatchUrlList;
	0x48 | string ScriptDefines;
	0x50 | int DefaultServerIndex;

	[Flags: 0b00000000000000000001100010000110] [ParamsCount: 0] |RVA: 0xBC61CF0|
	void .ctor();

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 0] |RVA: 0xBC61730|
	static void Load();

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 1] |RVA: 0xBC61A90|
	static DDENCEMCKLN Serialize(RPG.Client.ClientStartupConfig arg1);

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 1] |RVA: 0xBC617A0|
	static RPG.Client.ClientStartupConfig Deserialize(System.Byte[] arg1);

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 1] |RVA: 0xBC61D00|
	static RPG.Client.ClientStartupConfig ReadBinaryFromFile(string arg1);

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 2] |RVA: 0xBC61D50|
	static void WriteBinaryToFile(RPG.Client.ClientStartupConfig arg1, string arg2);

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 2] |RVA: 0xBC61FA0|
	static void WriteJsonToFile(RPG.Client.ClientStartupConfig arg1, string arg2);

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 2] |RVA: 0xBC61FF0|
	static void ToggleToCbDispatch(string arg1, string arg2);

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 0] |RVA: 0xBC62190|
	static string GetOverSeaUrl();

	[Flags: 0b00000000000000000000000010010110] [ParamsCount: 2] |RVA: 0xBC621D0|
	static void ToggleToOSCbDispatch(string arg1, string arg2);

	[Flags: 0b00000000000000000000100010010110] [ParamsCount: 0] |RVA: 0xBC62370|
	static RPG.Client.ClientStartupConfig get_Data();

	[Flags: 0b00000000000000000000100010010001] [ParamsCount: 1] |RVA: 0xBC62380|
	static void set_Data(RPG.Client.ClientStartupConfig arg1);

}
```
