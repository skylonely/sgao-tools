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
| ICO 图标生成 | 上传或拖入 PNG/JPG/WebP/SVG，多尺寸合并、透明背景或自选底色、完整缩放/居中裁剪、实际尺寸预览和下载 | `/#ico` |
| 图片压缩 & 格式转换 | 批量感知质量检查、自适应有损编码、PNG 减色、智能选择格式、尺寸调整、原图滑块对比、单图及 ZIP 下载 | `/#image` |

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
│   ├── index.html          # 工具页面
│   ├── styles.css          # 布局、主题和响应式样式
│   ├── app.js              # 路由及界面交互
│   ├── diff-worker.js      # 后台对比线程
│   ├── ico-tool.js         # 本地图片读取、预览和图标下载
│   ├── image-tool.js       # 批量图片队列、对比及下载
│   ├── image-engine.js     # 智能压缩与格式转换
│   ├── image-worker.js     # 后台压缩线程
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
- ICO 支持 PNG/JPG/WebP/SVG 源图，单张不超过 10 MB、边长不超过 8192、总像素不超过 2400 万。支持 16/24/32/48/64/128/256 像素，默认合并 16/32/48；以 32 位 BGRA 位图和透明掩码编码为真实 ICO 文件，保留半透明。完整显示等比留白，居中裁剪等比填满。预览按实际尺寸显示，放大较小原图会提示可能模糊。图片与生成内容仅保存在页面内存，刷新即清除。
- 不提供后端账户、同步或输入历史；刷新页面会清除输入并显示示例。

## 图片智能压缩

入口：[图片压缩 & 格式转换](https://tools.sgao.cc/#image)。输入支持静态 JPG、PNG、WebP、AVIF；输出为 JPG、PNG、WebP，原文件已较优时可保留原格式。每批最多 20 张、单张 20 MB、原图合计 100 MB。解码后最多 3200 万像素、单边最多 10000 像素。动态 PNG/WebP/AVIF 会拒绝处理，避免丢失动画。

- JPG/WebP 通过多轮编码，在 384 像素预览上比较局部亮度 SSIM、颜色误差与透明度，寻找满足预设阈值的更小编码。预设为智能均衡、画质优先、体积优先。这是抽样感知指标，不等于肉眼无损保证，文字、细线及品牌色建议用对比预览检查。
- PNG 使用带 Alpha 的加权中位切分调色板、最近色映射和索引 PNG 编码（PLTE/tRNS/IDAT，zlib 压缩），尝试减少至 256/128/64 等颜色；未通过画质检查时保留原文件或尝试原像素 PNG。没有依赖 TinyPNG 服务或其专有算法。
- 智能模式比较原格式与浏览器支持的 WebP；没有更小的适当结果时保留原文件。显式转换格式或缩小尺寸可能增加体积，界面会如实显示。PNG 减色失败时保留原像素；显式 JPG/WebP 转换无法达到阈值时使用最高编码质量，仍需用户检查画质。
- 浏览器原生编码能力在运行时通过返回 MIME 校验；不支持 WebP 时，智能模式会使用 PNG/JPG 或保留原图，显式转换显示错误，不会把 PNG 改名成 WebP。AVIF 只解码不编码，解码也取决于浏览器支持。
- 不默认缩放原图，可选择最长边上限且不放大；JPG 不支持透明，使用用户选择的底色。重新编码会移除 EXIF 等元数据，保留原文件时不修改元数据。图像显示与颜色管理可能因浏览器不同而有差异。
- 后台按顺序处理，支持停止；无 OffscreenCanvas 时回退到页面画布。文件与结果仅留在当前页面内存。ZIP 使用 STORE 封装（图片已经压缩），支持 UTF-8 文件名、CRC 校验与重名处理；大于 250 MB 时提示分别下载。

## 增加工具

在 `src/lib/` 添加独立逻辑并测试，在 `src/index.html` 添加侧栏入口和视图，在 `src/app.js` 的 `tools` 中登记路由并连接交互。构建脚本会自动复制 `src/` 下的所有模块，无需修改构建配置。
