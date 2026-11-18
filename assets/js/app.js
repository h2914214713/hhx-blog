/* 站点交互：文章列表渲染、文章详情、滚动揭示、阅读进度 */
(function () {
  "use strict";

  var posts = (window.POSTS || []).slice().sort(function (a, b) {
    return a.date < b.date ? 1 : -1;
  });

  var FEATURED_SLUG = "spring-ai-rag-in-production";

  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.getFullYear() + " 年 " + (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------------- 首页列表 ---------------- */

  function renderHome() {
    var list = document.querySelector("[data-post-list]");
    if (!list) return;

    list.innerHTML = posts
      .map(function (p) {
        return (
          '<a class="post-row" href="article.html?slug=' + encodeURIComponent(p.slug) + '">' +
            '<span class="post-date">' + fmtDate(p.date) + "</span>" +
            "<span>" +
              '<span class="post-title">' + esc(p.title) +
                '<span class="dot">›</span>' +
              "</span>" +
              '<span class="post-excerpt">' + esc(p.excerpt) + "</span>" +
            "</span>" +
            '<span class="post-cat">' + esc(p.category) + "</span>" +
          "</a>"
        );
      })
      .join("");
  }

  function renderFeatured() {
    var el = document.querySelector("[data-featured]");
    if (!el) return;
    var p = posts.filter(function (x) { return x.slug === FEATURED_SLUG; })[0] || posts[0];
    if (!p) return;
    el.querySelector("[data-featured-title]").textContent = p.title;
    el.querySelector("[data-featured-excerpt]").textContent = p.excerpt;
    el.querySelector("[data-featured-meta]").textContent =
      p.category + " · " + p.readTime;
    el.querySelector("[data-featured-link]").href =
      "article.html?slug=" + encodeURIComponent(p.slug);
  }

  var CATEGORY_GROUPS = {
    java: ["Java 后端", "JVM", "数据库", "架构", "Java 语言"],
    ai: ["AI 工程"],
    fe: ["前后端协作"],
  };

  function renderCounts() {
    var all = {};
    posts.forEach(function (p) {
      all[p.category] = (all[p.category] || 0) + 1;
    });
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var key = el.getAttribute("data-count");
      var cats = CATEGORY_GROUPS[key];
      var n = cats
        ? cats.reduce(function (sum, c) { return sum + (all[c] || 0); }, 0)
        : all[key] || 0;
      el.textContent = n + " 篇文章";
    });
  }

  /* ---------------- 文章页 ---------------- */

  function renderArticle() {
    var root = document.querySelector("[data-article]");
    if (!root) return;

    var slug = new URLSearchParams(location.search).get("slug");
    var idx = -1;
    posts.forEach(function (p, i) { if (p.slug === slug) idx = i; });
    if (idx < 0) idx = 0;

    var p = posts[idx];
    if (!p) return;

    document.title = p.title + " — HHX";
    root.querySelector("[data-art-cat]").textContent = p.category;
    root.querySelector("[data-art-title]").textContent = p.title;
    root.querySelector("[data-art-date]").textContent = fmtDate(p.date);
    root.querySelector("[data-art-time]").textContent = p.readTime;
    root.querySelector("[data-art-body]").innerHTML = p.body;
    root.querySelector("[data-art-tags]").innerHTML = (p.tags || [])
      .map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; })
      .join("");

    var next = posts[(idx + 1) % posts.length];
    var nextEl = document.querySelector("[data-next]");
    if (nextEl && next) {
      nextEl.href = "article.html?slug=" + encodeURIComponent(next.slug);
      nextEl.querySelector("[data-next-title]").textContent = next.title;
    }
    document.body.classList.add("is-ready");
  }

  /* ---------------- 滚动揭示 ---------------- */

  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!items.length) return;
    if (!("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 }
    );
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------------- 阅读进度 ---------------- */

  function initProgress() {
    var bar = document.querySelector(".progress");
    if (!bar) return;
    function update() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var pct = h > 0 ? (window.scrollY / h) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
    }
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ---------------- 订阅表单 ---------------- */

  function initForm() {
    var form = document.querySelector(".mail-form");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var note = form.parentElement.querySelector(".form-note");
      if (note) {
        note.textContent = "已收到，新的文章会发到你的邮箱。";
        note.style.color = "#0071e3";
      }
      form.reset();
    });
  }

  /* ---------------- 年份 ---------------- */

  function initYear() {
    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }

  function boot() {
    renderHome();
    renderFeatured();
    renderCounts();
    renderArticle();
    initReveal();
    initProgress();
    initForm();
    initYear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
