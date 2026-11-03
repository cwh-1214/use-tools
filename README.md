# 工具集（use-tools）

一个桌面工具集合体：**一个外壳 + 无数个即插即用的小工具**。

- 技术栈：一套原生 HTML/CSS/ES Module 的渲染层，**Electron 与 Tauri 两个外壳共用**（都没有 Vite / Webpack / babel，零构建步骤）
- 加一个工具 = 加一个文件夹 + 一行 import，改完刷新窗口即生效
- 删一个工具 = 删文件夹 + 删那行 import，不留任何残留

## 下载

不想装工具链就直接下绿色版：[Releases](https://github.com/cwh-1214/use-tools/releases/latest) 里的 `use-tools-0.1.0.exe`，单文件 3.85 MB，双击即用。

- 系统要求：Windows 10/11（用系统自带的 WebView2 运行时，Win11 已内置，Win10 若缺会自动提示安装）
- 免安装、不写注册表；设置与窗口位置存在 `%APPDATA%\com.usertools.desktop\settings.json`
- 装到开始菜单/可卸载的版本需要 NSIS 打包（`npm run tauri:build`），当前只发布绿色版

## 运行

```bash
npm install     # 首次
npm start       # 启动
npm run dev     # 启动并打开 DevTools
npm run smoke   # 无界面冒烟测试，验证渲染进程能否正常加载
npm test        # 单元测试（文件读取与列抽取逻辑）
npm run test:e2e# 端到端测试（真的点按钮、断言界面结果，出截图）
npm run tauri:dev # 用 Tauri 外壳启动（产物 3.8MB，需 Rust 工具链，见文末）
```

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

- **输入很宽松**：多行、逗号 / 全角逗号 / 分号 / 制表符 / 空格分隔都行，混着来也行。
- **引号感知切分**：`'A,B'` 是一个值，不会被逗号切开；已带引号的值不会变成 `''A''`。
- **能直接粘整段 SQL**：`id IN (...)`、`NOT IN (...)`、`VALUES (...)` 的外壳自动剥掉，语句里的列名会被复用，方向开关跟着切。
- **四种输出**：`IN 单行` / `IN 多行`（带缩进）/ `值列表`（每行带尾逗号）/ `纯数据列`（裸值）。
- **细节**：数字自动不加引号、`null` 输出 NULL、单引号按 SQL 规则转义、可去重 / 排序 / 每 N 个值分片（Oracle 的 1000 上限）。
- 支持从剪贴板粘贴、导入 txt/csv/sql/log/dat 文件（编码默认自动识别，也可指定 UTF-8 / ANSI）；xlsx 这类二进制文件会被拦下。

## 导入格式

三个吃文本的工具都只接受纯文本类扩展名，文件选择框和代码里各挡一道（Tauri 的对话框也会带上过滤器）：

| 工具 | 允许导入 |
| --- | --- |
| JSON 格式化 | `.json` `.txt` |
| SQL IN 生成器 | `.txt` `.csv` `.sql` `.log` `.dat` |
| 列比对 | `.xlsx` `.xlsm` `.txt` `.csv` `.tsv` `.log` `.dat` |

选到不支持的格式（比如把 `.xlsx` 选进 JSON）会提示「只能导入 … 文件」，不会读盘。

## 目录结构

```
use-tools/
├── package.json
├── build/
│   ├── icon.ico               应用图标（7 个尺寸，由脚本生成）
│   └── make-icon.py           纯标准库生成 ico，不依赖 Pillow
├── scripts/
│   ├── launch.js              启动器（剔除 ELECTRON_RUN_AS_NODE 等环境干扰）
│   └── e2e.js                 端到端测试编排
├── src/
│   ├── main/
│   │   ├── main.js            主进程：窗口、app:// 协议、托盘接线、冒烟测试钩子
│   │   ├── ipc.js             主进程 ↔ 渲染进程的能力桥（文件、剪贴板、设置、主题…）
│   │   ├── store.js           设置持久化（userData/settings.json，原子写入）
│   │   ├── tray.js            托盘 + 全局快捷键
│   │   └── column-scan.js     流式按列抽取唯一值（文件列比对的计算核心）
│   ├── assets/
│   │   └── tray*.png          托盘图标（16/32 两份，make-icon.py 生成）
│   ├── preload/
│   │   └── preload.js         通过 contextBridge 暴露 window.api
│   └── renderer/
│       ├── index.html
│       ├── app.js             外壳：侧边栏、搜索、路由、工具挂载
│       ├── core/
│       │   ├── dom.js         h() / debounce() / formatBytes() 等小工具
│       │   ├── ui.js          toolbar() / field() / seg() / statusBar() 等共用组件
│       │   ├── bridge.js      Tauri 下用 invoke 还原 window.api（Electron 下不做事）
│       │   └── registry.js    工具校验、分组、搜索
│       ├── styles/
│       │   ├── base.css       设计令牌与重置
│       │   └── app.css        布局 + 通用组件类
│       └── tools/
│           ├── index.js       ★ 工具清单，加工具只改这里
│           ├── _template/     新工具模板（复制它开始写）
│           ├── json-format/
│           ├── base64/
│           ├── timestamp/
│           ├── column-compare/
│           └── sql-in/
│               ├── index.js   界面与交互
│               └── parse.js   纯清洗/切分/拼装逻辑（不依赖 DOM，便于测试）
├── test/
│   ├── column-scan.test.js    列抽取逻辑断言（不需要 Electron）
│   ├── e2e/                   注入页面的端到端场景（每个工具一个同名脚本）
│   ├── fixtures/              测试用的样例文件（按场景名建子目录）
│   └── output/                测试截图（已 gitignore）
├── dist/                      打包产物（已 gitignore）
├── src-tauri/                 Tauri 外壳（Rust 主进程 + 配置，见文末）
└── docs/
    └── 开发笔记.md             架构决策、约定、后续待办
```

## 加一个工具

1. 复制 `src/renderer/tools/_template/` 为 `src/renderer/tools/<你的工具id>/`
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

3. 到 `src/renderer/tools/index.js` 加 import 和数组项，保存，刷新窗口。

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

需要新能力（读目录、算哈希、调外部程序）时，在 `src/main/ipc.js` 加一个 `ipcMain.handle`，再在 `preload.js` 暴露一行即可。**大文件处理一律放主进程**，别在渲染进程里读整份内容。

## 样式约定

通用组件类已备好，工具里直接复用，别重复造轮子：

- 布局：`.tool-body` `.toolbar` `.split`（左右两栏，窄屏自动堆叠）`.field` `.card`
- 控件：`.btn` `.btn-primary` `.btn-ghost` `.btn-sm` `.seg`（分段切换）`.input` `.textarea`
- 反馈：`.status` / `.status.is-ok` / `.status.is-err` `.hint` `.kv`（键值表）

主题色集中在 `styles/base.css` 的 `:root` 变量里，改一处全局生效；暗色是同文件里的 `prefers-color-scheme` 媒体查询，**组件样式里不允许写死颜色**（白字配主色按钮这类主题不变量除外）。

## 测试

两层，都不需要人工点界面：

- `npm test` —— 纯 Node，直接测 `src/main/column-scan.js`。覆盖 CRLF、空行、越界列、GBK、BOM、多字符分隔符、6 万行大文件、异常输入。
- `npm run test:e2e` —— 起真实窗口，注入脚本点按钮跑完整流程，断言界面结果，末尾把截图存到 `test/output/`。不带参数时依次跑 `test/e2e/` 下所有场景；只跑一个就 `npm run test:e2e sql-in`。
- `npm run test:all` —— 两层一起跑。

机制是三个只在冒烟模式生效的环境变量：`SMOKE_SCRIPT` 注入 JS、`SMOKE_SHOT` 出截图、`SMOKE_FIXTURE_QUEUE` 让文件选择框直接返回预设路径（绕开系统弹窗）。给新工具加交互测试时，在 `test/e2e/` 放一个同名场景脚本即可；需要样例文件就建 `test/fixtures/<场景名>/`，里面的文件会按文件名顺序进队列。

## 打包（Tauri 版，体积 3.8MB）

Electron 的 98MB 里有 239MB 是 Chromium 主程序的固定成本，压不下去。Tauri 复用系统自带的 WebView2，同一份渲染层几乎零改动就能跑，产物从 **98MB 降到 3.8MB**。

```bash
npm run tauri:dev                    # 开发运行（首次编译 2~4 分钟，之后增量秒级）
npm run tauri:build                  # 出安装包 → src-tauri/target/release/bundle/nsis/
USE_TOOLS_SMOKE=1 ./src-tauri/target/release/use-tools.exe   # 无人工自检，退出码 0 = 通过
```

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
├── tauri.conf.json            窗口、CSP、安装包配置（前端目录直接指向 ../src/renderer）
├── capabilities/default.json  只开事件监听，其余能力都走自定义命令
├── icons/                     由 build/make-icon.py 一并生成
└── src/
    ├── main.rs                入口（发布版不弹控制台）
    ├── lib.rs                 窗口、托盘、全局快捷键、单实例、窗口几何记忆
    ├── commands.rs            IPC 命令，签名与原来 ipc.js 一一对应
    ├── settings.rs            设置持久化（深合并 + 300ms 防抖 + 临时文件 rename）
    ├── column_scan.rs         流式按列抽取（encoding_rs 解码，GBK→GB18030）
    └── smoke.rs               自检：注入 JS → IPC 回传 → Rust 断言
```

**前端只加了一个文件** `src/renderer/core/bridge.js`：检测到 `window.__TAURI__` 时用 `invoke` 还原同签名的 `window.api`，于是 `app.js` 和 5 个工具一行没改。

| 对比项 | Electron 版 | Tauri 版 |
|---|---|---|
| 分发包 | 98 MB（NSIS 安装包） | 3.82 MB（exe）/ 1.73 MB（zip） |
| 磁盘占用 | ~310 MB | 3.82 MB |
| 运行内存 | 120 MB+ | 35 MB |
| 冷启动 | 较慢（要起 Chromium） | 快（复用系统 WebView2） |
| 数据目录 | `%APPDATA%\工具集` | `%APPDATA%\com.usertools.desktop` |

> 两套外壳**并存**，`npm start` 仍是 Electron 版，互不干扰；数据目录也是分开的。
> 已知限制：`tauri build` 的最后一步要从 GitHub 下载 NSIS 工具链，国内直连会被掐断（报 `peer closed connection` 或代理 502）。**exe 本身不需要它**，拿到 `target/release/use-tools.exe` 就能直接用；要安装包时开代理再跑一次即可，工具链会缓存在 `%LOCALAPPDATA%\tauri`。

## 打包（Electron 版）

```bash
npm run dist       # 出 NSIS 安装包 → dist/use-tools-<version>-setup.exe
npm run dist:dir   # 只出免安装目录 → dist/win-unpacked/（快速验证用）
```

- **体积**：安装包约 98MB，安装后约 310MB。这是 Electron 的固定成本（自带 Chromium + Node），不是配置问题；已做语言包裁剪（只留中英）+ NSIS 最大压缩，再往下只能换 Tauri（需 Rust 工具链）。`scripts/prune-locales.js` 是打包钩子，负责删语言包。
- **安装位置**：默认 `%LOCALAPPDATA%\Programs\工具集`，可改路径；建桌面与开始菜单快捷方式；卸载保留用户数据。
- **图标**：`build/make-icon.py` 用 Python 标准库生成 7 个尺寸的 `build/icon.ico`（不依赖 Pillow），改配色就改脚本顶部的常量再跑一次。
- **国内打包**：electron-builder 要额外下载 electron 与 nsis 资源，走镜像才不卡：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist
```

- **未签名**：没配代码签名证书，Windows 首次运行会弹「未知发布者」，点「更多信息 → 仍要运行」即可。自己用不用管，要分发就得买张证书。

打包完想确认产物真能跑（而不是只看到"构建成功"），直接让安装版自己冒烟：

```bash
SMOKE_HASH="sql-in" SMOKE_SHOT="dist/check.png" "dist/win-unpacked/工具集.exe" --smoke
```

