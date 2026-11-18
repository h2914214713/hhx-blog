/* 站点交互
 * 文章渲染 / 搜索 / 写作日历 / 目录 / 代码复制 / 主题切换 / 时间状态
 */
(function () {
  "use strict";

  var posts = (window.POSTS || []).slice().sort(function (a, b) {
    return a.date < b.date ? 1 : -1;
  });

  var FEATURED_SLUG = "spring-ai-rag-in-production";

  /* ================= 通用工具 ================= */

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

  function plainText(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    return (tmp.textContent || "").replace(/\s+/g, " ").trim();
  }

  /* 中英混排的字数统计：汉字按字，西文按词 */
  function countWords(html) {
    var text = plainText(html);
    var cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var latin = text
      .replace(/[\u4e00-\u9fa5]/g, " ")
      .split(/\s+/)
      .filter(function (w) {
        return /[a-zA-Z0-9]/.test(w);
      }).length;
    return cjk + latin;
  }

  function readingMinutes(html) {
    var text = plainText(html);
    var cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    var latin = countWords(html) - cjk;
    return Math.max(1, Math.round(cjk / 400 + latin / 220));
  }

  function postMinutes(p) {
    return Math.max(1, readingMinutes(p.body));
  }

  function postWords(p) {
    return countWords(p.body);
  }

  function dayKey(d) {
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    return d.getFullYear() + "-" + (m.length < 2 ? "0" + m : m) + "-" + (day.length < 2 ? "0" + day : day);
  }

  function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
  }

  /* ================= 主题切换 ================= */

  var THEME_KEY = "hhx-theme";

  function currentTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (e) {}
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else if (theme === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#000000" : "#ffffff");
  }

  function initTheme() {
    var stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch (e) {}
    if (stored) applyTheme(stored);
  }

  function toggleTheme() {
    var next = currentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (e) {}
  }

  /* ================= 导航按钮注入 ================= */

  var ICON_SEARCH =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.4"></circle><path d="M10.3 10.3 14 14"></path></svg>';
  var ICON_SUN =
    '<svg class="i-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3.1"></circle><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3.1 3.1l1.1 1.1M11.8 11.8l1.1 1.1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1"></path></svg>';
  var ICON_MOON =
    '<svg class="i-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.7 5.7 0 1 0 7 7Z"></path></svg>';

  function initNavActions() {
    var cta = document.querySelector(".nav-cta");
    if (!cta || document.querySelector(".nav-actions")) return;

    var box = document.createElement("div");
    box.className = "nav-actions";

    var searchBtn = document.createElement("button");
    searchBtn.className = "icon-btn";
    searchBtn.type = "button";
    searchBtn.setAttribute("aria-label", "搜索文章");
    searchBtn.title = "搜索（⌘K）";
    searchBtn.innerHTML = ICON_SEARCH;
    searchBtn.addEventListener("click", openSearch);

    var themeBtn = document.createElement("button");
    themeBtn.className = "icon-btn";
    themeBtn.type = "button";
    themeBtn.setAttribute("aria-label", "切换深浅色");
    themeBtn.title = "切换深浅色";
    themeBtn.innerHTML = ICON_SUN + ICON_MOON;
    themeBtn.addEventListener("click", toggleTheme);

    box.appendChild(searchBtn);
    box.appendChild(themeBtn);
    cta.parentNode.insertBefore(box, cta);
  }

  /* ================= 搜索 ================= */

  var searchState = { open: false, index: -1, results: [] };

  function buildSearchIndex() {
    return posts.map(function (p) {
      return {
        post: p,
        haystack: [
          p.title,
          p.excerpt,
          p.category,
          (p.tags || []).join(" "),
          plainText(p.body),
        ]
          .join(" ")
          .toLowerCase(),
      };
    });
  }

  var SEARCH_INDEX = [];

  function initSearch() {
    SEARCH_INDEX = buildSearchIndex();

    var overlay = document.createElement("div");
    overlay.className = "search-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "搜索文章");
    overlay.innerHTML =
      '<div class="search-panel">' +
      '<div class="search-top">' +
      ICON_SEARCH +
      '<input class="search-input" type="text" name="q" autocomplete="off" placeholder="搜索文章、标签、正文…" aria-label="搜索关键词" />' +
      "</div>" +
      '<div class="search-results"></div>' +
      '<div class="search-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>↵</kbd> 打开</span><span><kbd>esc</kbd> 关闭</span></div>' +
      "</div>";
    document.body.appendChild(overlay);

    var input = overlay.querySelector(".search-input");
    var resultsEl = overlay.querySelector(".search-results");

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeSearch();
    });

    input.addEventListener("input", function () {
      renderSearch(input.value);
    });

    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveSearch(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        moveSearch(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        var item = searchState.results[searchState.index];
        if (item) window.location.href = "article.html?slug=" + encodeURIComponent(item.post.slug);
      }
    });

    document.addEventListener("keydown", function (e) {
      var isInput =
        /^(input|textarea|select)$/i.test(document.activeElement.tagName) ||
        document.activeElement.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchState.open ? closeSearch() : openSearch();
      } else if (e.key === "/" && !isInput && !searchState.open) {
        e.preventDefault();
        openSearch();
      } else if (e.key === "Escape" && searchState.open) {
        closeSearch();
      }
    });

    function renderSearch(q) {
      var query = q.trim().toLowerCase();
      var list = [];

      if (!query) {
        list = posts.slice(0, 5).map(function (p) {
          return { post: p, score: 0 };
        });
      } else {
        SEARCH_INDEX.forEach(function (entry) {
          var idx = entry.haystack.indexOf(query);
          if (idx < 0) return;
          var score = 0;
          if (entry.post.title.toLowerCase().indexOf(query) >= 0) score += 100;
          if ((entry.post.tags || []).join(" ").toLowerCase().indexOf(query) >= 0) score += 40;
          if (entry.post.category.toLowerCase().indexOf(query) >= 0) score += 20;
          list.push({ post: entry.post, score: score });
        });
        list.sort(function (a, b) {
          return b.score - a.score;
        });
      }

      searchState.results = list;
      searchState.index = list.length ? 0 : -1;

      if (!list.length) {
        resultsEl.innerHTML = '<div class="search-empty">没有找到和「' + esc(q) + '」相关的文章</div>';
        return;
      }

      resultsEl.innerHTML = list
        .map(function (item, i) {
          var p = item.post;
          return (
            '<a class="search-item' + (i === 0 ? " is-active" : "") + '" href="article.html?slug=' +
            encodeURIComponent(p.slug) + '">' +
            '<div class="search-item-title">' + highlight(p.title, query) + "</div>" +
            '<div class="search-item-meta">' + esc(p.category) + " · " + fmtDate(p.date) + " · " + postMinutes(p) + " 分钟</div>" +
            "</a>"
          );
        })
        .join("");
    }

    function highlight(text, query) {
      if (!query) return esc(text);
      var safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var re = new RegExp("(" + safe + ")", "ig");
      return esc(text).replace(re, "<mark>$1</mark>");
    }

    function moveSearch(dir) {
      if (!searchState.results.length) return;
      searchState.index =
        (searchState.index + dir + searchState.results.length) % searchState.results.length;
      var items = resultsEl.querySelectorAll(".search-item");
      items.forEach(function (el, i) {
        el.classList.toggle("is-active", i === searchState.index);
      });
      var active = items[searchState.index];
      if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
    }

    searchState.openSearch = function () {
      overlay.classList.add("is-open");
      document.body.classList.add("no-scroll");
      searchState.open = true;
      input.value = "";
      renderSearch("");
      setTimeout(function () {
        input.focus();
      }, 40);
    };

    searchState.closeSearch = function () {
      overlay.classList.remove("is-open");
      document.body.classList.remove("no-scroll");
      searchState.open = false;
    };
  }

  function openSearch() {
    if (searchState.openSearch) searchState.openSearch();
  }

  function closeSearch() {
    if (searchState.closeSearch) searchState.closeSearch();
  }

  /* ================= 首页渲染 ================= */

  var CATEGORY_GROUPS = {
    java: ["Java 后端", "JVM", "数据库", "架构", "Java 语言"],
    ai: ["AI 工程"],
    fe: ["前后端协作"],
  };

  function renderHome() {
    var list = document.querySelector("[data-post-list]");
    if (!list) return;

    list.innerHTML = posts
      .map(function (p) {
        return (
          '<a class="post-row" href="article.html?slug=' + encodeURIComponent(p.slug) + '">' +
          '<span class="post-date">' + fmtDate(p.date) + "</span>" +
          "<span>" +
          '<span class="post-title">' + esc(p.title) + '<span class="dot">›</span></span>' +
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
    var p =
      posts.filter(function (x) {
        return x.slug === FEATURED_SLUG;
      })[0] || posts[0];
    if (!p) return;
    el.querySelector("[data-featured-title]").textContent = p.title;
    el.querySelector("[data-featured-excerpt]").textContent = p.excerpt;
    el.querySelector("[data-featured-meta]").textContent =
      p.category + " · " + postMinutes(p) + " 分钟";
    el.querySelector("[data-featured-link]").href =
      "article.html?slug=" + encodeURIComponent(p.slug);
  }

  function renderCounts() {
    var all = {};
    posts.forEach(function (p) {
      all[p.category] = (all[p.category] || 0) + 1;
    });
    document.querySelectorAll("[data-count]").forEach(function (el) {
      var key = el.getAttribute("data-count");
      var cats = CATEGORY_GROUPS[key];
      var n = cats
        ? cats.reduce(function (sum, c) {
            return sum + (all[c] || 0);
          }, 0)
        : all[key] || 0;
      el.textContent = n + " 篇文章";
    });
  }

  /* ================= 时间状态条 ================= */

  function initStatusBar() {
    var bar = document.querySelector("[data-statusbar]");
    if (!bar) return;

    var clockEl = bar.querySelector("[data-clock]");
    var postsEl = bar.querySelector("[data-stat-posts]");
    var wordsEl = bar.querySelector("[data-stat-words]");
    var lastEl = bar.querySelector("[data-stat-last]");

    function tick() {
      var now = new Date();
      var hh = String(now.getHours());
      var mm = String(now.getMinutes());
      if (clockEl) clockEl.textContent = (hh.length < 2 ? "0" + hh : hh) + ":" + (mm.length < 2 ? "0" + mm : mm);
    }

    tick();
    setInterval(tick, 30000);

    if (postsEl) postsEl.textContent = posts.length;
    if (wordsEl) {
      var total = posts.reduce(function (sum, p) {
        return sum + postWords(p);
      }, 0);
      wordsEl.textContent = total.toLocaleString("en-US");
    }
    if (lastEl && posts.length) {
      var latest = new Date(posts[0].date + "T00:00:00");
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var diff = daysBetween(latest, today);
      lastEl.textContent = diff <= 0 ? "今天" : diff + " 天前";
    }
  }

  /* ================= 写作日历 ================= */

  function initCalendar() {
    var grid = document.querySelector("[data-cal-grid]");
    if (!grid) return;

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var byDay = {};
    posts.forEach(function (p) {
      (byDay[p.date] = byDay[p.date] || []).push(p);
    });

    var view = { y: today.getFullYear(), m: today.getMonth() };
    var labelEl = document.querySelector("[data-cal-label]");

    function monthCount(y, m) {
      var prefix = y + "-" + (m + 1 < 10 ? "0" + (m + 1) : m + 1);
      return Object.keys(byDay).filter(function (k) {
        return k.indexOf(prefix) === 0;
      }).length;
    }

    function dayCount(y, m) {
      return new Date(y, m + 1, 0).getDate();
    }

    function render() {
      var y = view.y;
      var m = view.m;
      if (labelEl) labelEl.textContent = y + " 年 " + (m + 1) + " 月";

      var first = new Date(y, m, 1);
      var offset = (first.getDay() + 6) % 7; // 周一为一周起点
      var total = dayCount(y, m);
      var prevTotal = dayCount(y, m === 0 ? 11 : m - 1);
      var cells = [];

      for (var i = offset - 1; i >= 0; i--) {
        cells.push({ d: prevTotal - i, out: true });
      }
      for (var d = 1; d <= total; d++) {
        cells.push({ d: d, out: false });
      }
      var rest = (7 - (cells.length % 7)) % 7;
      for (var t = 1; t <= rest; t++) {
        cells.push({ d: t, out: true });
      }

      grid.innerHTML = cells
        .map(function (c) {
          var cls = ["cal-day"];
          if (c.out) cls.push("is-out");
          var key = "";
          if (!c.out) {
            key = dayKey(new Date(y, m, c.d));
            if (byDay[key]) cls.push("has-post");
            if (key === dayKey(today)) cls.push("is-today");
            var count = byDay[key] ? byDay[key].length : 0;
            return (
              '<button class="' + cls.join(" ") + '" data-date="' + key + '"' +
              (count ? ' title="' + count + ' 篇文章"' : "") +
              (count ? "" : " disabled") +
              ">" + c.d + "</button>"
            );
          }
          return '<span class="' + cls.join(" ") + '">' + c.d + "</span>";
        })
        .join("");

      var monthEl = document.querySelector("[data-cal-month]");
      if (monthEl) monthEl.textContent = monthCount(y, m);

      var totalEl = document.querySelector("[data-cal-total]");
      if (totalEl) totalEl.textContent = posts.length;

      var lastEl = document.querySelector("[data-cal-last]");
      if (lastEl && posts.length) {
        var latest = new Date(posts[0].date + "T00:00:00");
        var diff = daysBetween(latest, today);
        lastEl.textContent = diff <= 0 ? "今天" : diff + " 天前";
      }
    }

    grid.addEventListener("click", function (e) {
      var btn = e.target.closest(".cal-day.has-post");
      if (!btn) return;
      var list = byDay[btn.getAttribute("data-date")];
      if (list && list.length) {
        window.location.href = "article.html?slug=" + encodeURIComponent(list[0].slug);
      }
    });

    var prev = document.querySelector("[data-cal-prev]");
    var next = document.querySelector("[data-cal-next]");
    if (prev) {
      prev.addEventListener("click", function () {
        view.m--;
        if (view.m < 0) {
          view.m = 11;
          view.y--;
        }
        render();
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        view.m++;
        if (view.m > 11) {
          view.m = 0;
          view.y++;
        }
        render();
      });
    }

    render();
  }

  /* ================= 文章页 ================= */

  function renderArticle() {
    var root = document.querySelector("[data-article]");
    if (!root) return;

    var slug = new URLSearchParams(location.search).get("slug");
    var idx = -1;
    posts.forEach(function (p, i) {
      if (p.slug === slug) idx = i;
    });
    if (idx < 0) idx = 0;

    var p = posts[idx];
    if (!p) return;

    document.title = p.title + " — HHX";
    root.querySelector("[data-art-cat]").textContent = p.category;
    root.querySelector("[data-art-title]").textContent = p.title;
    root.querySelector("[data-art-date]").textContent = fmtDate(p.date);
    root.querySelector("[data-art-time]").textContent = postMinutes(p) + " 分钟";
    var wordsEl = root.querySelector("[data-art-words]");
    if (wordsEl) wordsEl.textContent = postWords(p).toLocaleString("en-US") + " 字";
    root.querySelector("[data-art-body]").innerHTML = p.body;
    root.querySelector("[data-art-tags]").innerHTML = (p.tags || [])
      .map(function (t) {
        return '<span class="chip">' + esc(t) + "</span>";
      })
      .join("");

    var next = posts[(idx + 1) % posts.length];
    var nextEl = document.querySelector("[data-next]");
    if (nextEl && next) {
      nextEl.href = "article.html?slug=" + encodeURIComponent(next.slug);
      nextEl.querySelector("[data-next-title]").textContent = next.title;
    }
  }

  function initToc() {
    var body = document.querySelector("[data-art-body]");
    var toc = document.querySelector("[data-toc]");
    if (!body || !toc) return;

    var heads = body.querySelectorAll("h2, h3");
    if (heads.length < 2) {
      toc.style.display = "none";
      return;
    }

    var links = [];
    var html = '<p class="toc-title">本文目录</p>';

    Array.prototype.forEach.call(heads, function (h, i) {
      var id = "sec-" + (i + 1);
      h.id = id;
      var lvl = h.tagName === "H3" ? 3 : 2;
      html +=
        '<a class="lvl-' + lvl + '" href="#' + id + '">' + esc(h.textContent.trim()) + "</a>";
      links.push({ id: id, el: h });
    });

    toc.innerHTML = html;

    var anchors = toc.querySelectorAll("a");
    function spy() {
      var current = links[0].id;
      var offset = 140;
      links.forEach(function (item) {
        if (item.el.getBoundingClientRect().top - offset <= 0) current = item.id;
      });
      Array.prototype.forEach.call(anchors, function (a) {
        a.classList.toggle("is-active", a.getAttribute("href") === "#" + current);
      });
    }

    var ticking = false;
    window.addEventListener(
      "scroll",
      function () {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function () {
          spy();
          ticking = false;
        });
      },
      { passive: true }
    );
    spy();
  }

  function initCodeCopy() {
    var pres = document.querySelectorAll(".prose pre");
    Array.prototype.forEach.call(pres, function (pre) {
      var btn = document.createElement("button");
      btn.className = "copy-btn";
      btn.type = "button";
      btn.textContent = "复制";
      pre.appendChild(btn);

      btn.addEventListener("click", function () {
        var code = pre.querySelector("code");
        var text = (code || pre).textContent;
        var done = function () {
          btn.textContent = "已复制";
          btn.classList.add("is-done");
          setTimeout(function () {
            btn.textContent = "复制";
            btn.classList.remove("is-done");
          }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(fallback);
        } else {
          fallback();
        }
        function fallback() {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
            done();
          } catch (e) {}
          document.body.removeChild(ta);
        }
      });
    });
  }

  /* ================= 回到顶部 ================= */

  function initToTop() {
    var btn = document.createElement("button");
    btn.className = "to-top";
    btn.type = "button";
    btn.setAttribute("aria-label", "回到顶部");
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 13V4"></path><path d="M3.6 8.2 8 3.8l4.4 4.4"></path></svg>';
    document.body.appendChild(btn);

    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    function onScroll() {
      btn.classList.toggle("is-on", window.scrollY > 900);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ================= 滚动揭示 / 进度 / 表单 ================= */

  function initReveal() {
    var items = document.querySelectorAll(".reveal");
    if (!items.length) return;
    if (!("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(items, function (el) {
        el.classList.add("is-in");
      });
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
    Array.prototype.forEach.call(items, function (el) {
      io.observe(el);
    });
  }

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

  function initYear() {
    document.querySelectorAll("[data-year]").forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }

  /* ================= 启动 ================= */

  function boot() {
    initTheme();
    initNavActions();
    initSearch();

    renderHome();
    renderFeatured();
    renderCounts();

    renderArticle();
    initToc();
    initCodeCopy();

    initStatusBar();
    initCalendar();

    initReveal();
    initProgress();
    initForm();
    initYear();
    initToTop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
