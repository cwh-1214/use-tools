# 工具集（use-tools）

一个桌面工具集合体：**一个外壳 + 无数个即插即用的小工具**。

- 技术栈：**Tauri 2 外壳（Rust）+ 一套原生 HTML/CSS/ES Module 渲染层**（没有 Vite / Webpack / babel，零构建步骤）
- 加一个工具 = 加一个文件夹 + 一行 import，改完刷新窗口即生效
- 删一个工具 = 删文件夹 + 删那行 import，不留任何残留

## 下载

不想装工具链就直接下绿色版：[Releases](https://github.com/cwh-1214/use-tools/releases/latest) 里的 `use-tools-0.1.2.exe`，单文件 4.2 MB，双击即用。

- 系统要求：Windows 10/11（用系统自带的 WebView2 运行时，Win11 已内置，Win10 若缺会自动提示安装）
- 免安装、不写注册表；设置与窗口位置存在 `%APPDATA%\com.usertools.desktop\settings.json`
- 装到开始菜单/可卸载的版本需要 NSIS 打包（`npm run build`），当前只发布绿色版

## 运行

```bash
npm install          # 首次（只装 Tauri CLI）

npm run dev          # 开发运行（首次编译 2~4 分钟，之后增量秒级）
npm run build        # 出 NSIS 安装包 → .build/target/release/bundle/nsis/

npm test             # 离线测试：xlsx 生成器 + Rust 列扫描
npm run test:e2e     # 端到端：自动构建 debug 产物，真的点按钮、断言界面结果
npm run check        # 提交前完整校验：格式 + 单测 + 全部端到端场景
npm run package      # 发布打包：release 构建 + 冒烟 + dist/ 下的 exe 与 zip
```

> 端到端测试默认用 `.build/target/debug` 的产物，缺失时自动 `cargo build`；要测发布版用 `npm run test:e2e:release`。

当前有 5 个工具：JSON 格式化、Base64 编解码、时间戳转换、列比对、SQL IN 生成器。

## 常驻与唤出

装好之后它是一个**常驻工具箱**，不占任务栏，随叫随到：

- **全局快捷键 `Ctrl+Shift+Space`**（可改）：任何界面下按一下唤出窗口（并聚焦搜索框，打字回车直达工具）；再按一下收起。被其他软件占用时会明确标注，不会静默失效。
- **托盘图标**：左键单击唤出，右键有菜单（显示 / 关闭行为 / 退出）。
- **关闭按钮 = 藏进托盘**，不是退出。不习惯的话，到设置页（侧边栏左下角「设置」）关掉这一项即可改回传统行为。
- **设置页**：关闭行为、全局快捷键（录制式修改，改失败自动回滚）、主题、版本与数据目录都收在这一页。
- **单实例**：重复启动只会把已有窗口带到前台，不会开出第二个进程。
- **主题**：跟随系统 / 浅色 / 深色，跟随系统时窗口背景也同步。
- **切换工具不丢数据**：每个工具挂载后一直留着，切走只是把它的界面从文档摘下，切回来输入、结果、筛选、滚动位置都还是原样——不会「切一下清空重来」。

## 状态记忆

所有状态存在 `%APPDATA%/工具集/settings.json`，写入是防抖 + 临时文件 + rename，不会因断电写坏：

- 窗口大小与位置（含最大化状态）
- 上次用到的工具（下次打开直接回到那里）
- 侧边栏左下角的主题选择
- **列比对**：分隔符 / 列号 / 编码 / 忽略大小写 / 展示行数（数据本身不记，下次自己给）
- **SQL IN 生成器**：全部选项 + 输入内容（超过 20KB 只记选项）

## 列比对

比较两个数据源的指定列，找出「A 有 B 没有 / B 有 A 没有 / 共有 / 合并去重」。

- **每一侧独立选择数据来源**：文件 或 直接粘贴文本。所以可以「一个文件 vs 一段粘贴内容」混着比。
- **支持 xlsx / xlsm**：直接选表格，按单元格读第 N 列（忽略分隔符与编码）；旧版 `.xls` 请先另存为 `.xlsx`。
- **实时比对**：粘贴内容、切换分隔符、改列号都会在 320ms 后自动重算，不用点按钮。
- **编码不折腾**：默认「自动」——先按 UTF-8 解，解不开再按 ANSI（GBK / CP936）；也可手动指定 UTF-8 / ANSI。
- 还支持忽略大小写、结果内筛选；列表默认展示 100 行（可改，复制与导出始终是全量）。
- **保存结果**：导出 `.xlsx`，四个分类各一个工作表（A 有 B 没有 / B 有 A 没有 / 两者共有 / 合并去重），写全量数据。
- **导入类型受限**：只收 xlsx / xlsm / txt / csv / tsv / log / dat，选到别的格式会直接提示，不会读进来变成乱码。

## SQL IN 生成器

把散落的数据整理成能直接用的 SQL 条件，或反向吐出纯净数据列。

- **输入很宽松**：多行、逗号（含中文逗号）、制表符、空格、竖线混着来都行，都交给「自动」处理。
- **引号感知切分**：`'A,B'` 是一个值，不会被逗号切开；已带引号的值不会变成 `''A''`。
- **能直接粘整段 SQL**：`id IN (...)`、`NOT IN (...)`、`VALUES (...)` 的外壳自动剥掉，语句里的列名会被复用，方向开关跟着切。
- **四种输出**：`IN 单行` / `IN 多行`（带缩进）/ `值列表`（每行带尾逗号）/ `纯数据列`（裸值）。
- **细节**：数字自动不加引号、`null` 输出 NULL、单引号按 SQL 规则转义、可去重 / 排序 / 每 N 个值分片（Oracle 的 1000 上限）。
- 支持从剪贴板粘贴，或直接把数据粘进输入框；**不读文件**——数据从剪贴板进，结果从剪贴板或「保存结果」出。要处理文件里的数据，用列比对（支持 xlsx / 文本导入）或在编辑器里打开后复制。

## 导入格式

只有 JSON 格式化和列比对支持导入文件（SQL IN 生成器只接受粘贴内容）。两个工具都只接受白名单扩展名，文件选择框和代码里各挡一道（Tauri 的对话框也会带上过滤器）：

| 工具 | 允许导入 |
| --- | --- |
| JSON 格式化 | `.json` `.txt` |
| 列比对 | `.xlsx` `.xlsm` `.txt` `.csv` `.tsv` `.log` `.dat` |

选到不支持的格式（比如把 `.xlsx` 选进 JSON）会提示「只能导入 … 文件」，不会读盘。

## 目录结构

遵循 Tauri 的标准布局：`src/` 是前端根目录（`frontendDist` 直接指向它），`src-tauri/` 只放 Rust 外壳，脚本与测试各自独立。

```
use-tools/
├── package.json
├── src/                        ← 前端根目录，Tauri 直接把它当静态站点
│   ├── index.html
│   ├── app.js                  外壳：侧边栏、搜索、路由、工具挂载
│   ├── settings.js             设置页
│   ├── core/
│   │   ├── dom.js              h() / debounce() / formatBytes() 等小工具
│   │   ├── ui.js               toolbar() / field() / seg() / statusBar() 等共用组件
│   │   ├── bridge.js           用 invoke 还原 window.api（渲染层与 Rust 的唯一接口）
│   │   ├── files.js            扩展名白名单（导入类型限制）
│   │   ├── xlsx.js             手写 OOXML 的 xlsx 生成器（导出比对结果）
│   │   └── registry.js         工具校验、分组、搜索
│   ├── styles/
│   │   ├── base.css            设计令牌与重置
│   │   └── app.css             布局 + 通用组件类
│   └── tools/
│       ├── index.js            ★ 工具清单，加工具只改这里
│       ├── _template/          新工具模板（复制它开始写）
│       ├── json-format/
│       ├── base64/
│       ├── timestamp/
│       ├── column-compare/
│       └── sql-in/
│           ├── index.js        界面与交互
│           └── parse.js        纯清洗/切分/拼装逻辑（不依赖 DOM，便于测试）
├── src-tauri/                  ← Rust 外壳，只放 Tauri 自己的东西
│   ├── Cargo.toml / Cargo.lock / build.rs
│   ├── tauri.conf.json         窗口、CSP、安装包配置（frontendDist 指向 ../src）
│   ├── capabilities/default.json
│   ├── icons/                  由 scripts/make-icon.py 生成
│   └── src/
│       ├── main.rs             入口（发布版不弹控制台）
│       ├── lib.rs              窗口、托盘、全局快捷键、单实例、窗口几何记忆
│       ├── commands.rs         全部系统能力（文件、剪贴板、设置、主题、快捷键…）
│       ├── settings.rs         设置持久化（深合并 + 防抖 + 临时文件 rename）
│       ├── column_scan.rs      流式按列抽取（encoding_rs 解码，GBK→GB18030）
│       └── smoke.rs            自检：注入 JS → IPC 回传 → Rust 断言
├── scripts/
│   ├── make-icon.py            图标生成（纯标准库，不依赖 Pillow）
│   ├── package.js              发布打包：release 构建 + 冒烟 + exe/zip
│   └── clean.js                清理产物（dist / test/output / .build）
├── test/
│   ├── unit/                   纯 Node 单测
│   ├── e2e/                    端到端场景（每个工具一个同名脚本）
│   ├── fixtures/               测试用的样例文件（按场景名建子目录）
│   ├── output/                 测试报告与产物（已 gitignore）
│   └── run-e2e.js              端到端测试编排（构建 + 起 Tauri + 注入场景）
├── .build/                     编译缓存（gitignore，npm run clean:build 可清）
├── dist/                       发布产物（gitignore）
├── docs/
│   └── 开发笔记.md             架构决策、约定、后续待办
└── .cargo/config.toml          把 Cargo target 统一到 .build/target
```

## 加一个工具

1. 复制 `src/tools/_template/` 为 `src/tools/<你的工具id>/`
2. 改写这个对象的元信息，在 `mount` 里写界面：

```js
export default {
  id: 'my-tool',        // 唯一，同时是路由 #/my-tool
  name: '我的工具',      // 侧边栏显示名
  desc: '一句话说明',
  icon: 'MT',           // 侧边栏的小图标，1-2 个字符即可
  group: '文本与编码',    // 相同 group 自动归到一组
  keywords: ['demo'],   // 参与搜索
  mount({ root, api, actions }) {
    // root：内容容器；actions：右上角按钮区；api：系统能力
    // 可以返回一个清理函数，切换工具时调用
  },
};
```

3. 到 `src/tools/index.js` 加 import 和数组项，保存，刷新窗口。

## 渲染进程能用什么

渲染进程没有 Node 权限（安全考虑），系统能力统一从 `window.api` 拿：

| API | 说明 |
|---|---|
| `api.pickFile({title, filters})` | 弹文件选择框，返回路径或 null |
| `api.readText(path, {encoding})` | 读文本文件（上限 32MB），`encoding` 支持 `utf-8` / `gbk` |
| `api.saveText({defaultName, content, filters})` | 保存文本到指定位置 |
| `api.basename(path)` | 取文件名 |
| `api.stat(path)` | 文件大小、修改时间 |
| `api.scanColumn({filePath, delimiter, columnIndex, encoding, trim})` | 流式抽取某列的唯一值，内存占用与文件大小无关 |
| `api.scanColumnText({text, delimiter, columnIndex, trim})` | 同上，输入是字符串（粘贴内容），与文件路径共用同一套切分规则 |
| `api.showItemInFolder(path)` | 在资源管理器中定位 |
| `api.clipboard.readText()` / `writeText(t)` | 剪贴板 |
| `api.settings.get()` / `update(patch)` | 读整份设置 / 深合并写入 |
| `api.settings.patchTool(toolId, partial)` | 写本工具的配置（`settings.tools[toolId]`），互不干扰 |
| `api.theme.set('system'/'light'/'dark')` | 切主题（`prefers-color-scheme` 媒体查询自动跟随） |
| `api.onSummoned(cb)` | 全局快捷键唤出窗口时触发（外壳用来聚焦搜索框） |
| `api.info()` | 应用与运行时版本 |
| `api.platform` | `win32` / `darwin` / `linux` |

需要新能力（读目录、算哈希、调外部程序）时，在 `src-tauri/src/commands.rs` 加一个 `#[tauri::command]`，再在 `core/bridge.js` 暴露一行即可。**大文件处理一律放 Rust 侧**，别在渲染进程里读整份内容。

## 样式约定

通用组件类已备好，工具里直接复用，别重复造轮子：

- 布局：`.tool-body` `.toolbar` `.split`（左右两栏，窄屏自动堆叠）`.field` `.card`
- 控件：`.btn` `.btn-primary` `.btn-ghost` `.btn-sm` `.seg`（分段切换）`.input` `.textarea`
- 反馈：`.status` / `.status.is-ok` / `.status.is-err` `.hint` `.kv`（键值表）

主题色集中在 `styles/base.css` 的 `:root` 变量里，改一处全局生效；暗色是同文件里的 `prefers-color-scheme` 媒体查询，**组件样式里不允许写死颜色**（白字配主色按钮这类主题不变量除外）。

## 测试

分三层，都不需要人工点界面：

- `npm test` —— 离线测试：`test/unit/xlsx.test.js` 验 xlsx 生成器（部件结构、XML 转义、表名清洗、base64 往返）；`cargo test` 验列扫描语义（分隔符、空行/短行、表格缺列）。
- `npm run test:e2e` —— 产物缺失**或源码比产物新**时自动 `cargo build`（Tauri 会把 `src/` 编进 exe，改了 JS/CSS 不重编就会测到旧界面），再起真实 Tauri 窗口，把 `test/e2e/<场景>.js` 注入页面，点按钮跑完整流程并断言界面结果。不带参数跑全部；只跑一个用 `npm run test:e2e sql-in`；测发布版用 `npm run test:e2e:release`。
- `npm run check` —— 提交前完整校验：`cargo fmt --check` + 单测 + 全部 e2e。
- `npm run lint` —— clippy 严格模式（`-D warnings`）。

e2e 默认走 `.build/target/debug` 的产物（增量构建快）；`--rebuild` 强制重建，`--no-build` 禁止自动构建（若源码比产物新会直接报错，避免测到旧资源），`USE_TOOLS_EXE` 可指向任意产物。

机制是一组只在冒烟模式（`USE_TOOLS_SMOKE=1`）生效的环境变量：

| 变量 | 作用 |
|---|---|
| `USE_TOOLS_SMOKE_SCRIPT` | 要注入页面的场景脚本路径 |
| `USE_TOOLS_FIXTURE_QUEUE` | `;` 分隔的预设文件路径，文件选择框按顺序直接返回（绕开系统弹窗） |
| `USE_TOOLS_SAVE_DIR` | 保存对话框不弹窗，产物直接落到这个目录 |
| `USE_TOOLS_CONFIG_DIR` | 独立配置目录，测试不碰用户真实设置 |
| `USE_TOOLS_SMOKE_WINDOW` | 固定窗口尺寸（如 `1120x720`），布局断言才稳定 |

给新工具加交互测试时，在 `test/e2e/` 放一个同名场景脚本即可；需要样例文件就建 `test/fixtures/<场景名>/`，里面的文件会按文件名顺序进队列。列比对主场景是例外：它要在同一对槽位里连续换文件，默认的 `caseA.txt` / `caseB.txt` 会排在目录内文件之前。

## 打包（exe 约 4.2MB）

Tauri 复用系统自带的 WebView2，不自带 Chromium，产物只有一个几 MB 的 exe。

```bash
npm run dev                # 开发运行（首次编译 2~4 分钟，之后增量秒级）
npm run build              # 出 NSIS 安装包 → .build/target/release/bundle/nsis/
npm run package            # 绿色版 → dist/use-tools-<ver>.exe + -portable.zip（含冒烟）
npm run test:e2e:release   # 用发布版产物跑全部端到端场景
```

`npm run package` 依次做：release 构建 → 内置冒烟（退出码非 0 直接中断）→ 复制 exe 到 `dist/` → 打 zip，并校验 `package.json` / `Cargo.toml` / `tauri.conf.json` 的版本号是否一致。

一次性环境（本机已完成）：

| 依赖 | 要求 | 本机位置 |
|---|---|---|
| Visual Studio 生成工具 | 勾「使用 C++ 的桌面开发」+ MSVC v143 + Windows SDK，其余不勾 | `D:\Microsoft Visual Studio\2022\BuildTools` |
| Rust | `stable-x86_64-pc-windows-msvc` | `D:\Rust\rustup`、`D:\Rust\cargo`（已配 rsproxy 镜像） |
| WebView2 Runtime | Win10/11 一般预装 | 系统 |

结构：

```
src-tauri/
├── Cargo.toml / build.rs
├── tauri.conf.json            窗口、CSP、安装包配置（前端目录直接指向 ../src）
├── capabilities/default.json  只开事件监听，其余能力都走自定义命令
├── icons/                     由 scripts/make-icon.py 生成
└── src/
    ├── main.rs                入口（发布版不弹控制台）
    ├── lib.rs                 窗口、托盘、全局快捷键、单实例、窗口几何记忆
    ├── commands.rs            全部系统能力（文件、剪贴板、设置、主题、快捷键…）
    ├── settings.rs            设置持久化（深合并 + 300ms 防抖 + 临时文件 rename）
    ├── column_scan.rs         流式按列抽取（encoding_rs 解码，GBK→GB18030）
    └── smoke.rs               自检：注入 JS → IPC 回传 → Rust 断言
```

**渲染层只有一个接口文件** `src/core/bridge.js`：用 `invoke` 还原 `window.api`，工具代码不直接碰 Rust。

| 对比项 | Electron（已移除） | Tauri（现在） |
|---|---|---|
| 分发包 | 98 MB（NSIS 安装包） | 4.2 MB（exe）/ 1.9 MB（zip） |
| 磁盘占用 | ~310 MB | 4.2 MB |
| 运行内存 | 120 MB+ | 35 MB |
| 冷启动 | 较慢（要起 Chromium） | 快（复用系统 WebView2） |
| 数据目录 | `%APPDATA%\工具集` | `%APPDATA%\com.usertools.desktop` |

> 已知限制：`tauri build` 的最后一步要从 GitHub 下载 NSIS 工具链，国内直连会被掐断（报 `peer closed connection` 或代理 502）。**exe 本身不需要它**，拿到 `.build/target/release/use-tools.exe` 就能直接用；要安装包时开代理再跑一次即可，工具链会缓存在 `%LOCALAPPDATA%\tauri`。

- **图标**：`scripts/make-icon.py` 用 Python 标准库生成 `src-tauri/icons/` 下的 PNG 与多尺寸 ico（不依赖 Pillow），改配色就改脚本顶部的常量再跑一次。
- **未签名**：没配代码签名证书，Windows 首次运行会弹「未知发布者」，点「更多信息 → 仍要运行」即可。自己用不用管，要分发就得买张证书。

打包完想确认产物真能跑（而不是只看到「构建成功」），直接让它自己冒烟：

```bash
USE_TOOLS_SMOKE=1 ./.build/target/release/use-tools.exe   # 退出码 0 = 通过
```

