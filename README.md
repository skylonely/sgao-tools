# SGAO 工具箱

SGAO 的独立开发工具站：[tools.sgao.cc](https://tools.sgao.cc)。输入仅在浏览器内处理，不上传、不保存输入内容，不依赖主站或 API 项目。

源码：[skylonely/sgao-tools](https://github.com/skylonely/sgao-tools)。

## 已有工具

| 工具 | 能力 | 入口 |
| --- | --- | --- |
| JSON 格式化 | 2/4 空格或 Tab、递归键名排序、压缩、语法高亮、错误定位、复制和下载；保留大整数、指数和重复键 | `/#json` |
| 时间戳转换 | 秒/毫秒自动或手动识别、双向转换、UTC/北京时间/本机时区、当前时间和复制 | `/#timestamp` |
| URL 编解码 | 参数、完整 URL 和表单三种模式，Unicode、错误提示、结果回填 | `/#url` |
| 文本对比 | 逐行新增/删除、行号、忽略空白/大小写、仅看差异、交换版本 | `/#diff` |

包含自适应布局、浅色/深色主题和键盘操作。`⌘/Ctrl + Enter` 快速格式化 JSON。只保存颜色偏好，不使用分析服务或外部字体。

## 本地开发

需要 Node.js 22 或更新版本，无需安装依赖：

```bash
npm start
```

打开终端输出的本地地址，默认 `http://127.0.0.1:4173`。修改源码后刷新浏览器即可。

```bash
npm test          # 转换、校验、精度保护和 diff 算法测试
npm run build     # 输出 dist/ 静态资源
npm run preview   # 预览 dist/
```

指定端口：`npm start -- --port 4180`。服务器仅监听本机。

## 项目结构

```text
sgao-tools/
├── src/
│   ├── index.html          # 四个工具的页面
│   ├── styles.css          # 布局、主题和响应式样式
│   ├── app.js              # 路由及界面交互
│   ├── diff-worker.js      # 后台对比线程
│   └── lib/                # 可单独测试的工具逻辑
├── public/                 # 图标及静态响应头
├── scripts/                # 零依赖开发服务器、静态构建
├── tests/                  # Node.js 内置测试
└── wrangler.jsonc          # 独立 Cloudflare Worker 和域名配置
```

## 独立 GitHub 仓库

本项目使用独立仓库 `skylonely/sgao-tools`，默认分支为 `main`。首次克隆：

```bash
git clone https://github.com/skylonely/sgao-tools.git
cd sgao-tools
npm start
```

提交并推送后，使用下方命令部署；也可配置 Workers Builds。不要复用 `sgao-website` 仓库或 Worker。

## Cloudflare Workers 部署

项目是纯静态站点；`wrangler.jsonc` 配置了独立 Worker `sgao-tools`、输出目录 `dist/` 和自定义域名 `tools.sgao.cc`。部署账号需要拥有 `sgao.cc` 的 DNS 区域；自定义域名下若已有冲突记录，需要先在 Cloudflare 处理。

手动部署（首次运行会按 npm 提示获取 Wrangler）：

```bash
npx --yes wrangler@4.92.0 login
npm run deploy
```

GitHub 自动部署可沿用主站的 **Cloudflare Workers Builds**：

1. Cloudflare → Workers & Pages → 创建应用 → 导入 Git 仓库，选择独立 `sgao-tools` 仓库。
2. Worker 名称设为 `sgao-tools`，生产分支设为 `main`，根目录保持仓库根目录。
3. 构建命令：`npm ci && npm test && npm run build`。
4. 部署命令：`npx --yes wrangler@4.92.0 deploy`。
5. 首次部署完成后，在 Worker → 设置 → 域和路由中确认 `tools.sgao.cc` 已生效。

首版已通过 Wrangler 手动发布，`tools.sgao.cc` 的 HTTPS 响应已验证。GitHub 推送自动部署需要额外连接 Workers Builds，当前未启用。也可以将 `dist/` 放到其他静态托管服务上。

## 数据处理与边界

- 所有工具在本机计算；静态响应头禁止页面发起数据请求。复制需要浏览器允许剪贴板访问。
- JSON 上限为 2,000,000 个 UTF-16 字符，最多嵌套 200 层；大结果取消语法高亮以降低渲染开销。格式化保留数值文本及重复键，不执行 JSON 中的内容。
- 时间戳自动模式按绝对值 `10¹¹` 区分秒与毫秒；较早的毫秒值请手选单位。秒支持最多 3 位小数，日期输入精确到秒；北京时间固定为 UTC+08:00，本机模式遵守系统时区及夏令时。
- 文本对比统一 CRLF/CR 为 LF；末尾换行参与对比。两侧合计上限 2,000,000 字符、20,000 行。忽略空白会移除全部空白，含行内空格。极大差异按整段展示并提示；结果最多显示 3,000 行，可用「仅看差异」缩小范围。
- 不提供后端账户、同步或输入历史；刷新页面会清除输入并显示示例。

## 增加工具

在 `src/lib/` 添加独立逻辑并测试，在 `src/index.html` 添加侧栏入口和视图，在 `src/app.js` 的 `tools` 中登记路由并连接交互。构建脚本会自动复制 `src/` 下的所有模块，无需修改构建配置。
