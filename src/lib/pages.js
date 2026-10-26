export const SITE_URL = 'https://tools.sgao.cc';
export const HOME = {
  key: 'home', path: '/', name: '工具导航',
  title: 'SGAO 工具箱 · 免费在线图片与开发工具',
  description: '免费的在线图片与开发工具箱：图片裁剪与尺寸调整、图片压缩、格式转换、网站图标整包生成、二维码、SVG 优化、JSON 格式化、时间戳、URL 编解码与文本对比。无需登录，内容在浏览器本地处理。',
};

// Shared by the static build, local server and legacy-link compatibility.
export const TOOLS = [
  {
    key: 'json', path: '/json-formatter/', name: 'JSON 格式化', icon: 'braces', category: 'dev',
    title: 'JSON 格式化与压缩 · 在线校验、语法高亮 - SGAO 工具箱',
    tagline: '把复杂的数据，整理成清晰的结构。',
    description: '在线格式化、压缩和校验 JSON，支持语法高亮、递归键名排序与错误定位，保留大整数和原始数值。无需登录，在浏览器本地处理，可复制或下载结果。',
    card: '格式化、压缩与校验 JSON，让嵌套结构清晰可读。', tags: ['语法高亮', '保留大整数'], keywords: 'json 数据 格式化 压缩 校验 美化 formatter',
    intro: '适合整理接口响应、检查配置文件和压缩 JSON 数据。支持对象、数组及基础类型；格式化只调整布局，不把大整数转成浮点数。',
    steps: ['粘贴 JSON，或点击「试试示例」了解输入格式。', '选择缩进与键名排序，点击「格式化」或「压缩 JSON」。', '检查结果与错误提示，复制内容或下载 JSON 文件。'],
    faqs: [['会丢失长整数的精度吗？', '工具保留原始数值文本，包括超出 JavaScript 安全整数范围的数字、指数写法和负零；不会先转成普通浮点数再输出。'], ['支持多大的 JSON？', '最多输入 200 万字符，嵌套深度上限为 200 层。较长结果会关闭语法高亮，以减少浏览器负担。'], ['可以处理注释和末尾逗号吗？', '目前按标准 JSON 校验，不接受注释、未加引号的键名和末尾逗号。遇到错误会提示位置。']],
    related: ['diff', 'url', 'timestamp'],
  },
  {
    key: 'timestamp', path: '/timestamp-converter/', name: '时间戳转换', icon: 'clock', category: 'dev',
    title: '时间戳转换 · Unix 秒、毫秒与日期互转 - SGAO 工具箱',
    tagline: '在一串数字和某个瞬间之间，轻松往返。',
    description: '在线 Unix 时间戳与日期双向转换，支持秒、毫秒自动识别，北京时间、UTC 和本机时区。实时查看当前时间戳，无需登录，全部在浏览器内完成。',
    card: '秒、毫秒与日期双向转换，轻松核对不同时区。', tags: ['秒 / 毫秒', '三种时区'], keywords: '时间戳 日期 unix timestamp 毫秒 秒 utc 北京时间',
    intro: '用来核对日志时间、接口时间字段和定时任务。时间戳表示一个确定的瞬间，选择的时区决定日期如何显示和解析。',
    steps: ['选择北京时间、UTC 或本机时区。', '输入 Unix 时间戳，选择自动识别、秒或毫秒；也可在右侧选择日期。', '点击对应转换按钮，查看并复制日期、秒级或毫秒级结果。'],
    faqs: [['自动识别秒和毫秒的规则是什么？', '绝对值小于 1000 亿按秒处理，其余按毫秒处理。处理较早的毫秒时间戳时，建议手动指定单位。'], ['为什么同一个时间戳会显示不同日期？', '时间戳本身不含时区。北京时间是 UTC+08:00，本机时区取决于设备设置；显示方式不同，表示的瞬间相同。'], ['支持负数和小数吗？', '支持 1970 年以前的负时间戳。秒级输入最多保留三位小数，毫秒级输入使用整数；超出日期范围会提示错误。']],
    related: ['json', 'url', 'diff'],
  },
  {
    key: 'url', path: '/url-encoder/', name: 'URL 编解码', icon: 'link', category: 'dev',
    title: 'URL 编码与解码 · 中文参数与表单转换 - SGAO 工具箱',
    tagline: '处理地址和参数，让每个字符准确传达。',
    description: '免费在线 URL 编码和解码，支持 encodeURIComponent 参数模式、encodeURI 完整地址模式及表单空格转加号。支持中文与 Unicode，内容仅在本地处理。',
    card: '处理中文、特殊字符与链接参数，支持三种编码模式。', tags: ['中文参数', '表单编码'], keywords: 'url 编码 解码 encode decode uri 百分号 中文 参数',
    intro: '用于准备查询参数、还原百分号编码和排查链接乱码。完整 URL、单个参数和表单参数使用不同规则，请根据内容选择模式。',
    steps: ['选择 URL 参数、完整 URL 或表单参数模式。', '粘贴原始文本或已编码内容，点击「编码」或「解码」。', '复制结果，或用「结果作为输入」继续处理。'],
    faqs: [['应该选择哪种编码模式？', '编码单个查询参数值时选 URL 参数；保留地址中的斜杠、问号等结构时选完整 URL；处理表单参数值时选表单模式。'], ['加号为什么有时会变成空格？', '表单模式把空格编码为 +，把原始加号编码为 %2B。其他两种模式解码时不会把普通加号当作空格。'], ['为什么解码失败？', '不完整的百分号序列或无效的 UTF-8 编码会导致解码失败。请确认复制了完整内容，并选择与编码时一致的模式。']],
    related: ['qrcode', 'json', 'diff'],
  },
  {
    key: 'diff', path: '/text-diff/', name: '文本对比', icon: 'diff', category: 'dev',
    title: '文本对比工具 · 在线逐行比较文本差异 - SGAO 工具箱',
    tagline: '并排放下两个版本，让每一处变化浮现。',
    description: '在线逐行对比两个文本版本，高亮新增和删除，支持行号、忽略空白、忽略大小写及仅看差异。在浏览器后台线程处理，文本不上传，无需登录。',
    card: '并排比较两个版本，高亮新增、删除与细微变化。', tags: ['逐行比较', '忽略空白'], keywords: 'diff 文本 对比 比较 差异 文档 版本',
    intro: '适合检查配置修改、接口响应变化和文本版本差异。工具按行比较，并统一 Windows 与 Unix 换行符，避免只因换行方式不同产生差异。',
    steps: ['把旧版和新版文本分别放入两侧输入框。', '按需启用「忽略空白字符」或「忽略大小写」，点击「开始对比」。', '查看新增与删除行，或选择「仅看差异」集中检查修改处。'],
    faqs: [['对比的是字符还是整行？', '当前按行标记新增和删除，并显示对应行号。被修改的一行通常表现为删除旧行、添加新行。'], ['支持多长的文本？', '两侧合计最多 200 万字符。复杂的大规模差异可能采用近似结果，并在界面提示，以限制处理时间。'], ['忽略空白会忽略哪些内容？', '启用后，对比时忽略行内空白字符；原始文本仍用于展示。结果中的换行符统一为 LF。']],
    related: ['json', 'url', 'timestamp'],
  },
  {
    key: 'ico', path: '/favicon-generator/', name: '网站图标整包生成', icon: 'image', category: 'image',
    title: '网站图标生成器 · ICO、Apple Touch 与 PWA 图标整包 - SGAO 工具箱',
    tagline: '一张 Logo，备齐网站与主屏幕需要的图标。',
    description: '上传一张 Logo，在线生成 favicon.ico、多尺寸 PNG、Apple Touch、PWA 与 Maskable 图标，以及 Web App Manifest 和 HTML 引用代码。13 个文件打包下载，全程本地处理。',
    card: '一张 Logo，生成网站、Apple 和 PWA 所需的整套图标。', tags: ['13 个文件', 'ICO / PWA'], keywords: 'ico favicon png 图标 logo 网站 苹果 apple touch pwa manifest maskable',
    intro: '把品牌 Logo 转成浏览器标签页和手机主屏幕需要的图标。可调整裁切、背景和应用信息，下载整包或单独导出多尺寸 ICO。',
    steps: ['上传 PNG、JPG、WebP 或 SVG Logo，选择缩放、背景与 ICO 尺寸。', '填写应用名称、图标目录和应用入口，检查各平台预览及安全区。', '下载 ZIP，按 README 放置文件，并把 HTML 引用代码加入网站 head。'],
    faqs: [['整包里包含哪些文件？', '包括 favicon.ico、9 张 PNG、site.webmanifest、html-head.txt 和 README.txt，共 13 个文件。PNG 涵盖常用 favicon、180 px Apple Touch、192/512 px PWA 及 Maskable 图标。'], ['源图片有什么限制？', '单张不超过 10 MB，单边不超过 8192 px，总像素不超过 2400 万。建议使用清晰的正方形 Logo；SVG 的显示取决于浏览器支持。'], ['生成 Manifest 后就能离线访问吗？', 'Manifest 描述应用入口、名称、颜色和图标。离线缓存等能力需要网站另外实现；生成图标整包不会自动添加这些能力。']],
    related: ['svg', 'image', 'qrcode'],
  },
  {
    key: 'image', path: '/image-compressor/', name: '图片压缩 & 格式转换', icon: 'compress', category: 'image',
    title: '在线图片压缩与格式转换 · JPG、PNG、WebP - SGAO 工具箱',
    tagline: '让图片轻一点，让网页快一点。',
    description: '免费在线批量压缩图片，智能有损压缩并对照画质，支持 JPG、PNG、WebP、AVIF 输入及 JPG、PNG、WebP 输出。单张最高 20 MB，支持尺寸调整与 ZIP 下载，图片不上传。',
    card: '智能有损压缩、调整尺寸与转换格式，为网页减轻负担。', tags: ['批量 20 张', '画质对比'], keywords: '图片 压缩 转换 格式 jpg jpeg png webp avif image tinypng',
    intro: '为网页准备体积更小的图片。工具对照原图的颜色、明暗与透明度寻找编码参数，支持手动控制压缩程度，并用滑块检查细节。',
    steps: ['拖入静态 JPG、PNG、WebP 或 AVIF 图片，可批量选择。', '选择压缩策略、输出格式与最长边，点击「开始智能压缩」，查看体积和画质对比。', '按需调整参数重新处理，单张下载或打包下载 ZIP。'],
    faqs: [['支持多大的图片和多少张？', '单张最高 20 MB，每批最多 20 张、合计最高 100 MB；单边不超过 10000 px，总像素不超过 3200 万。设备可用内存也会影响处理能力。'], ['压缩后一定会变小吗？', '已经充分压缩的图片可能几乎没有缩小空间。有损压缩会改变图像数据，实际节省量与画质取决于图片内容，请在下载前检查对比。'], ['能输出哪些格式？', '可输出 JPG、PNG 和 WebP，也可自动选择合适格式。AVIF 用作输入，解码支持取决于浏览器；当前只处理静态图片。']],
    related: ['crop', 'svg', 'ico'],
  },
  {
    key: 'qrcode', path: '/qrcode/', name: '二维码生成 & 识别', icon: 'qr', category: 'share',
    title: '二维码生成与识别 · 网址、文字、Wi-Fi 在线转码 - SGAO 工具箱',
    tagline: '把内容放进方寸之间，让分享更简单。',
    description: '免费在线生成网址、文字和 Wi-Fi 二维码，可选颜色、尺寸与 Logo，下载 PNG 或 SVG；支持上传图片识别二维码。内容不上传，生成结果自动进行本地识别校验。',
    card: '生成网址、文字和 Wi-Fi 二维码，也能从图片识别内容。', tags: ['PNG / SVG', '图片识别'], keywords: '二维码 qrcode qr code 生成 识别 扫码 wifi 链接',
    intro: '把网址、文字或 Wi-Fi 信息直接写进二维码，支持自定义颜色与 Logo。也可以拖入二维码截图，在浏览器里提取文字和链接。',
    steps: ['选择网址、文字或 Wi-Fi，填写需要分享的内容。', '调整颜色、尺寸和容错等级，按需加入 Logo；确认本地识别校验通过。', '下载 PNG 或 SVG；识别已有二维码时，把图片放入下方识别区域。'],
    faqs: [['二维码会过期吗？', '生成的是静态二维码，内容直接写入图片，不依赖本站跳转。二维码本身没有本站设置的有效期；网址是否有效取决于目标网站。'], ['Wi-Fi 密码会上传吗？', '不会上传，内容在当前浏览器处理。但密码会写入二维码，拿到二维码的人可以读取，请只分享给需要连接的人。'], ['内容和图片有什么限制？', '生成内容最多 1200 个 UTF-8 字节，中文通常每字占 3 字节。识别图片单张最高 20 MB，支持 PNG、JPG、WebP；Logo 最高 2 MB。']],
    related: ['url', 'image', 'ico'],
  },
  {
    key: 'svg', path: '/svg-optimizer/', name: 'SVG 优化 & 转 PNG', icon: 'vector', category: 'image',
    title: 'SVG 优化与转 PNG · 在线精简矢量图片 - SGAO 工具箱',
    tagline: '精简矢量，保留细节，轻松导出每一种尺寸。',
    description: '在线优化 SVG 源码并导出 PNG，使用本地 SVGO 精简文件，支持前后预览、精度调整、保留 ID、透明背景与自定义导出尺寸。单个 SVG 最高 5 MB，无需上传服务器。',
    card: '精简 SVG 源码，前后对照，并导出指定尺寸的 PNG。', tags: ['本地 SVGO', '透明 PNG'], keywords: 'svg 优化 压缩 矢量 png 转换 svgo vector',
    intro: '精简设计工具导出的静态 SVG，减少冗余源码；保留 viewBox，并可按指定尺寸导出透明或实色背景 PNG。',
    steps: ['上传 SVG 文件或粘贴源码，单个文件最高 5 MB。', '选择数值精度与保留 ID 选项，点击优化并对照预览。', '下载优化后的 SVG，或设置 PNG 尺寸、比例和背景后导出。'],
    faqs: [['PNG 最多能导出多大？', '宽高分别为 1–8192 px 的整数，总像素不超过 3200 万。支持锁定原始比例，解锁后图像等比居中留白。'], ['哪些 SVG 暂不支持？', '当前面向独立静态 SVG，不支持外部资源、脚本、动画和嵌入 HTML。文字效果依赖本机字体，请确认预览后再使用。'], ['优化后体积为什么变化不大？', '已经精简的 SVG 可能只有少量可优化空间。降低数值精度有时能进一步缩小体积，但可能改变曲线细节，建议对照检查。']],
    related: ['image', 'ico', 'qrcode'],
  },
  {
    key: 'crop', path: '/image-cropper/', name: '图片裁剪 & 尺寸调整', icon: 'crop', category: 'image',
    title: '在线图片裁剪与尺寸调整 · 旋转、翻转、精确缩放 - SGAO 工具箱',
    tagline: '留下刚好的画面，调整成需要的尺寸。',
    description: '免费在线裁剪图片、调整像素尺寸、旋转和翻转，支持自由选区与常用比例、PNG/JPG/WebP 导出及透明背景。单张最高 20 MB，图片只在浏览器本地处理，还可继续智能压缩。',
    card: '裁剪画面、旋转翻转与精确缩放，准备头像和网页封面。', tags: ['自由裁剪', '精确宽高'], keywords: '图片 裁剪 大小 尺寸 缩放 旋转 翻转 crop resize png jpg webp 头像 封面',
    intro: '从图片中选出需要的区域，再按像素调整输出尺寸。支持拖动、数值输入和方向键微调，适合制作头像、文章封面及网页素材。',
    steps: ['上传静态 PNG、JPG、WebP 或 AVIF，选择自由裁剪、原图比例或常用比例。', '拖动选区和控制点，按需旋转、翻转；填写导出宽高，选择格式与背景。', '检查实际导出预览和体积后下载，或在新标签页继续智能压缩，无需重复选择图片。'],
    faqs: [['图片与导出尺寸有什么限制？', '源图单张最高 20 MB、单边不超过 10000 px、总像素不超过 3200 万；导出单边最高 8192 px、总像素不超过 3200 万。继续压缩时，导出文件需在 20 MB 以内。'], ['解锁比例后，图片会变形吗？', '默认采用等比完整显示，在指定画布中居中留白。也可明确选择「拉伸填满指定尺寸」。JPG 不支持透明，留白和透明区域会使用所选底色。'], ['旋转、放大和继续压缩如何工作？', '旋转会按当前比例重新选取画面；翻转以当前画面方向为准。放大不会增加细节。继续压缩会打开同站新标签页，直接传递当前结果，不上传图片，也不将图片写入浏览器存储。']],
    related: ['image', 'ico', 'svg'],
  },
];
export const HOME_ORDER = ['image', 'crop', 'ico', 'qrcode', 'svg', 'json', 'timestamp', 'url', 'diff'];
export const CATEGORIES = [{ key: 'all', name: '全部工具' }, { key: 'image', name: '图片与图标' }, { key: 'dev', name: '开发与文本' }, { key: 'share', name: '分享与连接' }];
export function toolByKey(key) { return TOOLS.find(tool => tool.key === key); }
export function pageForPath(pathname) {
  const path = pathname.replace(/\/index\.html$/, '/').replace(/\/?$/, '/');
  return path === '/' ? HOME : TOOLS.find(tool => tool.path === path);
}
export function legacyDestination(hash, search = '') {
  const tool = toolByKey(hash.replace(/^#/, ''));
  return tool ? `${tool.path}${search}` : null;
}
export function matchesTool(tool, query, category = 'all') {
  const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = `${tool.name} ${tool.card} ${tool.keywords} ${tool.tags.join(' ')}`.normalize('NFKC').toLocaleLowerCase();
  return (category === 'all' || tool.category === category) && terms.every(term => text.includes(term));
}
