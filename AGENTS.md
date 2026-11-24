# Repository Guidelines

本文件适用于整个仓库。回复和新增文档使用中文；修改前阅读相关模块，保留用户已有改动。当前目标为 **ABC_CN_Windows_0.75.2 / Windows x64 / IL2CPP**。

## 1. 环境与构建

- agent 使用 TypeScript、Frida Gum，依赖为 `@types/frida-gum`、`typescript` 和 `frida-compile`。
- `tsconfig.json` 是 TypeScript 配置依据：ES2022、ESNext、Bundler、strict。不要通过关闭 strict 或滥用 `any` 绕过类型问题。
- `npm install` 安装依赖，`npm run build` 通过 `build.js` 编译三个入口到 `dist`；不要直接编辑生成的 JS。
- `agent.js` 和 `query-agent.js` 只安装 `abc` 和 RPC 接口；`cmdid-agent.js` 安装同样的接口并自动导出 CmdId。

## 2. 目录与职责

| 路径 | 职责 |
| --- | --- |
| `src/index.ts`、`src/query.ts`、`src/cmdid/agent.ts` | agent 入口与导出调度 |
| `src/agent.ts` | `abc` 和 RPC 接口，线程作用域包装 |
| `src/il2cpp` | 原生 API、指针解码、元数据、线程、调用与对象生命周期 |
| `src/il2cpp/structs` | Class、Type、Field、Method、Image 等运行时结构 |
| `src/gpb` | 消息发现、MergeFrom/WriteTo 恢复、集合、oneof、enum |
| `src/cmdid` | 读取网络消息注册表，独立导出 CmdId |
| `src/renderers` | C# 和 protobuf 文本渲染，不放原生扫描逻辑 |
| `src/dumper.ts`、`src/io` | C# 批量转储、输出目录和文件读写 |
| `docs` | 版本分析、符号与结构恢复依据 |

## 3. 分层与运行时约束

- 入口只调度，不放字段恢复、元数据解码或注册表解析。protobuf 与 CmdId 保持独立；CmdId 写 `CmdIds.txt`，采用 `消息名 = 命令号` 和 `; dump method: ... | RVA: ... | Index: ...` 行尾注释，Index 为注册表原始下标，从 0 开始，不输出 namespace 注释，不修改 schema。
- C# 自动导出块保持注释，它是明确保留的关闭开关，不作为死代码清理；手动 `abc.dump()` 接口仍须可用。
- 原生地址集中在 `src/il2cpp/addresses.ts`，GPB 与 CmdId 的版本锚点分别放 `src/gpb/constant.ts` 和 `src/cmdid/constant.ts`；结构偏移留在对应结构封装。不要恢复 `api-profile.json` 或混合不同版本的布局。
- libil2cpp 的类型枚举、属性标志和通用位域掩码集中在 `src/il2cpp/constant.ts`，全仓引用具名常量，不直接使用类型编号或属性掩码。头文件已有名称沿用原名；从位域推导的掩码注明结构与依据，不与游戏专属标志、布局偏移或解码密钥混淆。
- 结构、偏移、密钥与函数语义的改动必须有原生或运行时依据，注释写明版本、相关符号或 RVA。DummyDll 方法体是占位，不能据此判断原生行为，也不能照搬标准 IL2CPP 布局。
- `withThread` 必须是同步作用域，不能跨 `await`；批量任务逐批进入作用域，只 detach 本次自行 attach 的线程。
- 托管样本用 `ObjectScope` 和 GC handle 保活并释放；引用字段使用 `setReference`，不能随意用裸 `writePointer` 替代托管引用写入。
- 字段是否 static/literal 看属性 flags，不看 offset 的 storageTag；方法入口、invoker 和 MethodInfo 不可混用。
- 消息识别结合基类及自身泛型接口，不能只匹配混淆名或 getter/setter。自动模式 WriteTo 优先，缺失或恢复不完整时使用 MergeFrom 补充；不能要求每个消息同时具有两个有效方法。
- 继承空壳或声明的 ret 方法不参与字段恢复；声明空方法保留 RVA，缺失方法显示 `-`。oneof 按真实 case、存储与 wire tag 配对，不按声明顺序猜测。
- CmdId 只读客户端已初始化的网络消息注册表，未初始化时报告未就绪，不主动执行游戏初始化逻辑。
- 全局接口为 `abc`，RPC 名称和调用方式保持不变，`invoke` 保留位置参数接口。删除成员前用 `rg` 核对入口、RPC 和字符串调用，不仅看静态引用。

## 4. 代码风格与精简

- TypeScript、JavaScript、Python 和 JSON 使用 4 空格缩进；文本使用 UTF-8 无 BOM、LF 和文件末尾换行，不留行尾空白。
- TypeScript 本地导入沿用 `.js` 后缀；类型与接口用 PascalCase，函数和变量用 camelCase，既有 IL2CPP API 名称保持不变。
- il2cpp 中恢复出的原生函数使用有依据的完整 C++ 符号名称，例如 `"il2cpp::vm::MetadataCache::GetTypeInfoFromTypeDefinitionIndex"`、`"il2cpp::vm::Field::GetData"`、`il2cpp_*`；对象键使用双引号，调用使用 `api["完整符号"](...)`，地址键、绑定键及所有调用处同步更新，不再为已确认的内部函数使用等自造别名。
- 原生函数命名须核对反汇编中的参数、返回值、控制流与调用关系，并与可用的 libil2cpp 源码交叉确认；在 `docs` 中记录版本和 RVA，区分源码对应确认与语义推定。原版源码缺少同名函数不构成否定游戏分支符号的依据，语义推定也不能表述为已取得原始调试符号。游戏独有且无法确认符号名称的函数保留现名，不编造 C++ 符号。
- 沿用现有帮助函数和模块，不直接套入或复制外部 bridge，不为单个用途引入框架、新接口或多层封装。
- 删除无调用方代码、重复逻辑、无意义赋值和已完成的 TODO；不顺带批量改名或格式化无关文件。
- 注释说明依据、原因和不明显的约束，不复述代码；同一文件沿用既有注释语言。
- 不新增测试框架、Checks 计数、manifest、哈希报告或重复校验。必要的内存读写边界、异常处理、资源释放和未恢复状态必须保留，不能吞错或伪造成功。

## 5. 验证与输出

- 修改 TypeScript 后运行 `npx tsc --noEmit` 和 `npm run build`；修改 Python 工具可用 `python -B <脚本名> --help` 核对入口及依赖。
- 涉及原生行为时使用查询 agent 对少量类探查，记录实际结果；没有运行客户端验证就明确说明，不把构建成功当作恢复成功。
- 纯文档修改不连接游戏、不触发全量转储。调试注入使用 `--no-auto-reload`，避免编译产物变化引发重复执行。
- 默认输出位于进程 exe 目录的 `RuntimeDump`，自动创建目录并覆盖文件；局部探查使用另一个输出文件，不覆盖已有全量成果。
- 未恢复字段保留 `UNRESOLVED`，不凭参考 proto 或字段顺序编造类型、字段号、enum 值或 CmdId；名称保持元数据中的混淆名。

## 6. 文档与交付

- README 保持简短，只写目标版本、运行命令与默认输出，不引用本地分析材料，不塞入逆向过程或工具清单。
- 分析文档放在 `docs`，使用中文，以版本、符号、RVA 和结构偏移记录依据，不写私人绝对路径，不依赖仓库外项目或临时报告。不保留某次运行的导出总数、成功率、耗时、匹配或冲突计数等统计汇总；解释原生结构所需的数组长度、记录步长、字段号和具体样本依据可以保留。
- 不提交 `node_modules`、`dist`、RuntimeDump、二进制样本、缓存和原始逆向数据；不为本地分析产物修改忽略规则。
- 不回退、清理或暂存用户改动；除非用户明确要求，不执行提交。
- 提交信息使用 Conventional Commits：`type(scope): summary`，scope 采用 `il2cpp`、`gpb`、`cmdid`、`renderers`、`agent` 或 `repo`；格式化、重构与行为变更分开提交。
- 交付简要说明改动、实际验证结果及尚未验证的部分，不夸大恢复范围。
