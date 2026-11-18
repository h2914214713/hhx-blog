/* 从 assets/js/data.js 生成 feed.xml
 * 用法：node scripts/build-feed.mjs
 * 零依赖：把 data.js 放进一个假的 window 里求值，拿到 POSTS
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataPath = path.join(root, "assets/js/data.js");
const outPath = path.join(root, "feed.xml");

const SITE = process.env.SITE_URL || "https://book.aikouya.store";
const TITLE = "HHX — Java 与 AI 笔记";
const SUBTITLE = "Java 后端与 AI 工程的实践笔记：Spring、JVM、缓存架构、RAG 与 AI 应用落地。";

const code = fs.readFileSync(dataPath, "utf8");
const sandbox = {};
new Function("window", code)(sandbox);

const posts = (sandbox.POSTS || [])
  .slice()
  .sort((a, b) => (a.date < b.date ? 1 : -1));

const esc = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const cdata = (s = "") => "<![CDATA[" + String(s).replace(/]]>/g, "]]&gt;") + "]]>";

const rfc822 = (date) => new Date(date + "T09:00:00+08:00").toUTCString();

const items = posts
  .map((p) => {
    const url = `${SITE}/article?slug=${encodeURIComponent(p.slug)}`;
    return `    <item>
      <title>${esc(p.title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${rfc822(p.date)}</pubDate>
      <category>${esc(p.category)}</category>
      <description>${esc(p.excerpt)}</description>
      <content:encoded>${cdata(p.body)}</content:encoded>
    </item>`;
  })
  .join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(TITLE)}</title>
    <link>${SITE}/</link>
    <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
    <description>${esc(SUBTITLE)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${rfc822(posts[0] ? posts[0].date : new Date().toISOString().slice(0, 10))}</lastBuildDate>
${items}
  </channel>
</rss>
`;

fs.writeFileSync(outPath, xml, "utf8");
console.log(`feed.xml 已生成：${posts.length} 篇，${(Buffer.byteLength(xml) / 1024).toFixed(1)} KB`);

/* ---------- 顺带生成 sitemap.xml ---------- */

const today = new Date().toISOString().slice(0, 10);

const url = (loc, lastmod, priority) =>
  `  <url>
    <loc>${esc(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <priority>${priority}</priority>
  </url>`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${url(SITE + "/", today, "1.0")}
${url(SITE + "/about", today, "0.6")}
${url(SITE + "/subscribe", today, "0.4")}
${posts.map((p) => url(`${SITE}/article?slug=${p.slug}`, p.date, "0.8")).join("\n")}
</urlset>
`;

fs.writeFileSync(path.join(root, "sitemap.xml"), sitemap, "utf8");
console.log(`sitemap.xml 已生成：${posts.length + 3} 条`);
