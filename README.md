# HHX — Java 后端与 AI 工程笔记

一个手写的静态博客，视觉语言参考 apple.com：大留白、系统字体、毛玻璃导航、克制的滚动动效。

- 零依赖、零构建：三个 HTML 页面 + 一份 CSS + 一份原生 JS
- 数据驱动：文章写在 `assets/js/data.js`，新增文章不用碰 HTML
- 自动适配深色模式与移动端

## 目录结构

```
.
├── index.html            # 首页：首屏、精选、专题、文章列表
├── article.html          # 文章页：?slug=xxx 渲染对应文章
├── about.html            # 关于
└── assets
    ├── css/site.css      # 全部样式
    └── js
        ├── data.js       # 文章数据（唯一需要编辑的内容文件）
        └── app.js        # 渲染、滚动揭示、阅读进度
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
  category: "Java 后端",         // Java 后端 / JVM / 数据库 / 架构 / AI 工程 / 前后端协作
  date: "2026-12-01",
  readTime: "8 分钟",
  tags: ["标签一", "标签二"],
  body: `<p>正文，支持任意 HTML。</p>`
}
```

保存刷新即可，首页、文章页、专题计数会自动更新。

## 部署

托管在 Cloudflare Pages：

```bash
npx wrangler pages deploy . --project-name hhx-blog --branch main
```

## 写作约定

- 结论必须能复现，不确定的地方写明「据说」
- 金额用字符串，时间用带时区的 ISO 8601
- 每篇文章至少包含一次真实的故障或一组真实数字
