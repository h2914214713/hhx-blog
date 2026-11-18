# HHX — Java 后端与 AI 工程笔记

一个手写的静态博客，视觉语言参考 apple.com：大留白、系统字体、毛玻璃导航、克制的滚动动效。

**线上地址：https://book.aikouya.store**（Cloudflare Pages 自定义域名，`hhx-blog.pages.dev` 作为备用地址仍可访问）

- 零依赖、零构建：四个 HTML 页面 + 一份 CSS + 一份原生 JS
- 数据驱动：文章写在 `assets/js/data.js`，新增文章不用碰 HTML
- 深浅色主题、站内搜索、写作日历、文章目录、代码复制、RSS —— 全部手写实现

## 功能

| 功能 | 入口 | 说明 |
| --- | --- | --- |
| 站内搜索 | 导航放大镜 / `⌘K` / `Ctrl+K` / `/` | 匹配标题、标签、分类与正文，方向键选择、回车打开 |
| 深浅色切换 | 导航太阳/月亮按钮 | 记忆在 localStorage，未手动切换时跟随系统 |
| 写作日历 | 首页「写作日历」 | 月视图，有文章的日期带圆点，点击直达该文章 |
| 时间状态条 | 首屏按钮下方 | 北京时间、文章总数、总字数、距上次更新 |
| 文章目录 | 文章页右侧 | 根据正文 h2/h3 自动生成，滚动高亮当前章节 |
| 代码复制 | 代码块右上角 | 悬停出现，复制后显示「已复制」 |
| 阅读进度 | 文章页顶部细线 | 随滚动推进 |
| 自动字数/时长 | 文章页 meta、搜索列表 | 汉字按 400 字/分钟、西文按 220 词/分钟估算 |
| RSS | 首页「RSS 订阅」→ `/subscribe` | 先到订阅引导页（可直接复制地址、跳转 Feedly/Inoreader），`feed.xml` 由脚本从 data.js 生成 |

## 目录结构

```
.
├── index.html            # 首页：首屏、精选、专题、文章列表、写作日历
├── article.html          # 文章页：?slug=xxx 渲染对应文章，含右栏目录
├── about.html            # 关于
├── subscribe.html        # 订阅引导页：为什么 RSS 不是网页、怎么加进阅读器
├── 404.html              # 自定义 404（Cloudflare Pages 自动使用）
├── feed.xml              # RSS，由 scripts/build-feed.mjs 生成
├── sitemap.xml           # 站点地图，由同一脚本生成
├── robots.txt            # 指向 sitemap
├── _headers              # 给 feed.xml 声明 application/rss+xml 与缓存策略
├── scripts
│   └── build-feed.mjs    # 零依赖的 RSS + sitemap 生成脚本
└── assets
    ├── css/site.css      # 全部样式，颜色走 CSS 变量
    └── js
        ├── data.js       # 文章数据（唯一需要编辑的内容文件）
        └── app.js        # 渲染与全部交互
```

## 本地预览

直接双击 `index.html` 即可，或起一个静态服务：

```bash
python -m http.server 4321
# 浏览器打开 http://127.0.0.1:4321
```

## 新增一篇文章

在 `assets/js/data.js` 的数组里追加一个对象：

```js
{
  slug: "my-new-post",          // URL 标识，唯一
  title: "标题",
  excerpt: "一句话摘要，显示在列表里",
  category: "Java 后端",         // Java 后端 / JVM / 数据库 / 架构 / Java 语言 / AI 工程 / 前后端协作
  date: "2026-12-01",
  tags: ["标签一", "标签二"],
  body: `<p>正文，支持任意 HTML。</p>`
}
```

保存刷新即可，首页、文章页、专题计数、写作日历、搜索索引都会自动更新。
阅读时长和字数由正文自动计算，不需要手写。

> 注意：`body` 是模板字符串，正文里如果出现 `${...}` 需要写成 `\${...}`。

## 生成 RSS

```bash
node scripts/build-feed.mjs
```

追加文章后跑一次，`feed.xml` 与 `sitemap.xml` 会同步更新。

站点根地址默认 `https://book.aikouya.store`，需要临时换域名时用环境变量覆盖：

```bash
SITE_URL=https://hhx-blog.pages.dev node scripts/build-feed.mjs
```

## 部署

托管在 Cloudflare Pages（项目名 `hhx-blog`）：

```bash
CI=true npx wrangler pages deploy . --project-name hhx-blog --branch main --commit-dirty=true
```

自定义域名：`book.aikouya.store` 已绑定到 Pages 项目，DNS 为指向 `hhx-blog.pages.dev` 的 CNAME（已代理）。

> 域名 `aikouya.store` 托管在 Cloudflare：apex 上只有 Cloudflare Email Routing 的 MX 记录，
> 另有 `cdn` / `demo` / `game` / `mail` 等 Worker 与隧道子域。博客只占 `book` 这一个子域，
> 根域 `aikouya.store` 与 `www` 不挂站点，留给以后使用。

## 写作约定

- 结论必须能复现，不确定的地方写明「据说」
- 金额用字符串，时间用带时区的 ISO 8601
- 每篇文章至少包含一次真实的故障或一组真实数字
