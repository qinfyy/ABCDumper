# ProtoDumper

目标为 **NexusAnima / ABC_CN_Windows_0.75.2 / Windows x64**。

```powershell
npm install
npx tsc --noEmit
npm run build
```

在已连接且 IL2CPP 已初始化的测试会话中加载 `dist/query-agent.js`。主入口 `dist/agent.js` 同样提供 `ys` 和 RPC，不会自动开始导出。

```javascript
ys.assemblies()
ys.gpb.classes({ image: "ABC.Common.dll", interface: "E2107772BDBD37C2", count: 10 })
ys.gpb.inspect({ image: "ABC.Common.dll", name: "B62FCA9B447E245B" })
ys.gpb.probe({ image: "ABC.Common.dll", name: "B62FCA9B447E245B" }, { maxField: 16 })
ys.gpb.dump({ image: "ABC.Common.dll", match: "B62FCA9B447E245B", count: 1, maxField: 16 })
ys.gpb.dump()
```

默认导出 `gpbConstant.images` 中的程序集至 `RuntimeDump/hna-all.proto`；`allImages: true` 扫描全部已加载程序集。消息和枚举各自按程序集分组。局部导出默认写入 `RuntimeDump/probe.proto`，可能需要其他类型定义。未恢复的字段保留为 `UNRESOLVED`。手动 `ys.dump()` 仍是 C# 转储入口。
