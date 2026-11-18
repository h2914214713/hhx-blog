/* 文章数据源
 * 想加一篇新文章：往数组里 push 一个对象即可，首页、文章页会自动出现。
 */
window.POSTS = [
  {
    slug: "virtual-threads-spring-boot",
    title: "虚拟线程上线一周，我把数据库连接池从 200 调到了 40",
    excerpt:
      "虚拟线程不是「线程池的替代品」，它改变的是你对阻塞的定价方式。真正需要重新计算的，是那些按线程数配出来的池子。",
    category: "Java 后端",
    date: "2026-11-12",
    tags: ["JDK 21", "Spring Boot", "并发"],
    body: `
<p>把 <code>spring.threads.virtual.enabled=true</code> 打开只需要一行配置，但接下来一周，我们组的监控群里每天都在讨论同一个问题：为什么连接池被打满了。</p>
<p>原因不复杂。虚拟线程把「等待」变得极其廉价，于是同一个瞬间愿意发起的查询数量从 200 涨到了几千。数据库没有变快，只是排队的人变多了。</p>

<h2>先搞清楚虚拟线程在优化什么</h2>
<p>平台线程的成本在于内存与上下文切换：一个线程大约占用 1MB 栈空间，创建和调度都要过内核。虚拟线程把这部分开销搬到了 JVM 内部，栈按需增长，挂起时不占载体线程。所以它优化的不是「计算」，而是「等待」。</p>
<ul>
  <li>CPU 密集型任务：没有收益，甚至因为调度层多了一层而略慢。</li>
  <li>I/O 密集型任务：收益巨大，尤其是那种「一次请求要串行调五个下游」的链路。</li>
  <li>已经被限流的资源：虚拟线程会把压力完整地传递给下游，限流必须自己补上。</li>
</ul>

<h2>连接池为什么必须变小</h2>
<p>传统配置里 <code>maximumPoolSize=200</code> 是一个双重约束：既限制了同时访问数据库的请求数，也间接限制了 Tomcat 的工作线程数。虚拟线程解除了第二层耦合，池子就只剩下「保护数据库」这一个职责。</p>
<p>而数据库侧的合理并发，取决于磁盘 IOPS 和 CPU 核数，通常远小于 200。我们按下面的公式重算了一遍：</p>
<pre><code>理想连接数 ≈ CPU 核数 × 2 + 有效磁盘数
16 核 + NVMe  →  约 40
</code></pre>
<p>于是 <code>maximum-pool-size</code> 降到 40，<code>connection-timeout</code> 从 30s 收到 3s，<code>leak-detection-threshold</code> 设成 10s。压测结果：P99 从 412ms 降到 268ms，吞吐反而涨了 8%。少一点并发，数据库的锁等待和上下文切换都变少了。</p>

<h2>三个必须注意的坑</h2>
<h3>1. synchronized 会钉住载体线程</h3>
<p>JDK 21 的虚拟线程在 <code>synchronized</code> 块里阻塞时会 pin 住载体线程，池子被耗尽后整个调度器卡死。JDK 24 已经解决了大部分场景，但在 21 上，把热点路径的 <code>synchronized</code> 换成 <code>ReentrantLock</code> 仍然是必要的。</p>
<pre><code>// 会 pin 住载体线程
public synchronized void refresh() { ... }

// 不会
private final ReentrantLock lock = new ReentrantLock();
public void refresh() {
    lock.lock();
    try { ... } finally { lock.unlock(); }
}
</code></pre>
<p>排查方式是在启动参数里加 <code>-Djdk.tracePinnedThreads=full</code>，跑一遍压测，栈里出现 <code>&lt;== monitors:1</code> 的就是元凶。</p>

<h3>2. ThreadLocal 变成了内存放大器</h3>
<p>平台线程池里 ThreadLocal 是复用的，虚拟线程是每个请求一个，用完即弃。<code>InheritableThreadLocal</code> 尤其危险：一个 2KB 的上下文，在 5000 并发下就是 10MB 的额外对象创建与回收压力。MDC 这类东西建议改用 <code>ScopedValue</code>（JDK 21 预览）或显式传参。</p>

<h3>3. 限流要重新设计</h3>
<p>以前用线程池队列长度天然做背压，现在没有了。需要在入口用 <code>Semaphore</code> 或者 Resilience4j 的 Bulkhead 显式限流，否则虚拟线程会把下游打穿。</p>

<h2>什么时候别用</h2>
<p>如果你的应用是纯 CPU 密集的批处理，或者依赖大量 <code>synchronized</code> 的第三方库（某些老版本的 JDBC 驱动、JNDI 相关代码），先别开。虚拟线程不是性能开关，它是并发模型的改变，配套的容量假设都要跟着改。</p>
<p>一句话总结：<strong>虚拟线程让你可以无视线程数，但不能无视资源数。</strong></p>
`,
  },
  {
    slug: "spring-ai-rag-in-production",
    title: "用 Spring AI 做 RAG：demo 半天，上线三个月",
    excerpt:
      "向量检索能跑通只是起点。真正决定效果的是切分策略、混合检索的权重，以及那个没人愿意承认的问题——知识库本身就过期了。",
    category: "AI 工程",
    date: "2026-11-06",
    tags: ["Spring AI", "RAG", "向量数据库"],
    body: `
<p>去年团队要在内部的运维平台里加一个「问文档」的入口。我用 Spring AI 半天跑通了 demo，然后花了三个月把它做到能上线。这篇文章记录中间踩过的坑。</p>

<h2>第一版：能跑，但答非所问</h2>
<p>最初的实现非常标准：PDF 按 1000 字符切分，调 <code>text-embedding-3-small</code> 生成向量，存进 PGVector，用户提问时取 Top 4 拼进 prompt。测试集上的准确率是 61%，上线第一天被投诉了七次。</p>
<p>问题出在三个地方：</p>
<ol>
  <li>按固定长度切分，把一张告警码对照表从中间劈开，检索到的永远是半张表。</li>
  <li>用户问「订单超时怎么处理」，文档里写的是「order timeout」，中文查询没有命中英文段落。</li>
  <li>取 Top 4 之后直接拼接，四段内容互相矛盾时模型会编一个折中答案。</li>
</ol>

<h2>切分：按结构切，不按长度切</h2>
<p>我们把文档先解析成 Markdown，再按标题层级切，每个 chunk 前面拼上它所在的标题路径。这一步就把准确率从 61% 拉到 78%。</p>
<pre><code>Document doc = new Document(text, Map.of(
    "source", fileName,
    "section", "告警处理 / 订单超时 / 重试策略"
));

TokenTextSplitter splitter = new TokenTextSplitter(600, 100, 5, 10000, true);
List&lt;Document&gt; chunks = splitter.apply(List.of(doc));
</code></pre>
<p>关键在 <code>section</code> 这个元数据。它既参与向量化（拼进文本），也用于展示引用来源。用户看到「来自《告警处理手册》3.2 节」，信任度完全不同。</p>

<h2>检索：混合，而不是纯向量</h2>
<p>纯向量检索对专有名词和错误码极不友好。<code>ERR_4021</code> 这种 token，语义模型几乎学不到，但 BM25 一次就能命中。我们最终用 PostgreSQL 同时做两路检索，再用 RRF（Reciprocal Rank Fusion）合并：</p>
<pre><code>SELECT id, content,
       1.0 / (60 + ROW_NUMBER() OVER (ORDER BY embedding &lt;=&gt; :vec)) AS vec_rank,
       1.0 / (60 + ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, query) DESC)) AS kw_rank
FROM documents, to_tsquery(:q) query
ORDER BY (vec_rank + kw_rank) DESC
LIMIT 8;
</code></pre>
<p>不需要额外的向量数据库，PostgreSQL 一个实例把两路都做了。8 条候选里再让一个小模型做重排（我们用的是 bge-reranker-base，本地部署，一次 40ms），Top 3 进 prompt，准确率到了 89%。</p>

<h2>让模型承认自己不知道</h2>
<p>这是收益最大的一次改动。我们在 system prompt 里明确写：只允许基于给定片段回答，如果片段不包含答案，输出固定的「知识库中暂无相关记录」，并附带建议联系的人。</p>
<blockquote>模型编造答案的动机，往往来自 prompt 里那句「请尽量回答用户的问题」。把这句话删掉，幻觉少一半。</blockquote>
<p>同时把 Top 3 的相似度分数打出来，低于阈值（我们取 0.62）就直接返回兜底话术，根本不调大模型。省了 token，也省了事故。</p>

<h2>最后是工程问题</h2>
<h3>异步与超时</h3>
<p>一次问答的链路是：向量化 180ms → 检索 60ms → 重排 40ms → 生成 2.4s。前面三段用 <code>CompletableFuture</code> 并行，整体首字延迟从 3.1s 降到 2.6s。生成阶段必须开流式，用户的体感延迟取决于第一个 token，不是最后一个。</p>

<h3>知识库的保鲜</h3>
<p>这是最不性感但最重要的一环。文档更新了但向量没更新，比没有知识库更糟——它会自信地给出旧答案。我们做了一个定时任务，对比文件的 mtime 和 hash，变更的重新切分入库，删除的同步删除向量。每周还会跑一次 20 条的黄金测试集，准确率掉超过 5 个点就告警。</p>

<h2>三个月后的数字</h2>
<ul>
  <li>日均问答 340 次，人工转接率从 74% 降到 22%</li>
  <li>P95 首字延迟 2.8s，完整响应 6.1s</li>
  <li>每月 token 成本约 42 美元</li>
</ul>
<p>如果重来一次，我会先做评估集，再写第一行代码。没有评估集的 RAG，等于闭着眼睛调参。</p>
`,
  },
  {
    slug: "g1-tuning-three-seconds",
    title: "线上一次 3 秒的 GC 停顿，让我重读了 G1 的参数表",
    excerpt:
      "Humongous 对象、Region 碎片、以及那个被误设成 8 的 ParallelGCThreads——一次完整的排查记录。",
    category: "JVM",
    date: "2026-10-28",
    tags: ["G1", "GC 调优", "排查"],
    body: `
<p>周三下午，订单服务出现一次 3.2 秒的 Full GC。监控上 P99 曲线像被人从中间拽了一把。JVM 参数是别人三年前留下的，堆 16G，G1，<code>MaxGCPauseMillis=200</code>。</p>
<p>目标 200ms，实际 3200ms，说明 G1 已经放弃了这个目标——它在做最后一次挣扎。</p>

<h2>先看现场</h2>
<p>打开 GC 日志（<code>-Xlog:gc*:file=gc.log:time,uptime:filecount=5,filesize=50M</code>），找到那次停顿前后的片段，重点看三行：</p>
<pre><code>[gc,humongous] GC(1421) Humongous regions: 187->185
[gc,ergo] GC(1421) To-space exhausted
[gc      ] GC(1421) Pause Full (G1 Compaction Pause) 15234M->14890M(16384M) 3214.882ms
</code></pre>
<p>两个信号同时出现：<code>Humongous regions</code> 长期高达 187 个，以及 <code>To-space exhausted</code>。前者是原因，后者是结果。</p>

<h2>Humongous 对象是怎么堆起来的</h2>
<p>G1 把堆切成 Region（这里是 8MB）。任何超过 Region 一半的对象（4MB）都会被当作 Humongous，独占一个或多个连续 Region。这类对象在 Young GC 时几乎不被回收，只能等 Mixed GC，而 Mixed GC 又因为找不到足够干净的 Region 而无法推进。</p>
<p>我们用 <code>jcmd &lt;pid&gt; GC.class_histogram</code> 看了一眼：</p>
<pre><code> num     #instances         #bytes  class name
------------------------------------------------
   1:        128432      987654321  [B
   2:          8421       68123456  com.xxx.OrderSnapshot
</code></pre>
<p><code>byte[]</code> 占了近 1G。追到代码，是一个「把整张订单的 JSON 序列化后放进 Redis，同时本地再缓存一份」的逻辑。单个 JSON 平均 5.2MB，超过了 Region 一半的阈值。</p>

<h2>三个改动</h2>
<h3>1. 把对象拆小</h3>
<p>本地缓存改成只存反序列化后的对象，不再缓存原始 JSON 字符串。这一条直接让 Humongous Region 从 187 降到 3。</p>

<h3>2. 调整 Region 大小</h3>
<p>Region 大小是 2 的幂，从 1MB 到 32MB。<code>-XX:G1HeapRegionSize=16m</code> 把 Humongous 阈值抬到 8MB，给那些无法避免的大对象留了余量。注意这把堆切成了 1024 个 Region，对 16G 堆来说是合理的。</p>
<p>但这不是首选方案。Region 变大意味着回收粒度变粗，停顿时间反而可能上升。能拆对象就拆对象。</p>

<h3>3. 修掉那个错误的并行线程数</h3>
<p>容器里只给了 4 核，参数里却硬编码了 <code>-XX:ParallelGCThreads=8</code>。并发标记线程多于可用 CPU，会让 STW 阶段互相抢核，同时让 <code>ConcGCThreads</code> 的推导失效。删掉这个参数，让 JVM 自己按 <code>UseContainerSupport</code> 计算。</p>

<h2>关于 IHOP</h2>
<p><code>InitiatingHeapOccupancyPercent</code> 默认 45%，JDK 9 之后由自适应策略接管。很多人手动设成 60 以为能减少 GC 次数，结果只是把并发标记推迟到更危险的位置。如果确实要调，先看 <code>-Xlog:gc+ihop=debug</code> 的输出，确认是「启动太晚」还是「标记太慢」。</p>

<h2>结果</h2>
<ul>
  <li>Full GC 从每天 3~5 次降到 0 次</li>
  <li>Young GC 平均停顿 18ms，P99 62ms</li>
  <li>堆使用率稳定在 55%，不再需要 16G</li>
</ul>
<p>最后把堆降到 8G，Region 保持 16MB，机器省了一半内存。结论：<strong>GC 问题九成是对象分配问题，参数只解决剩下的那一成。</strong></p>
`,
  },
  {
    slug: "explain-three-lines",
    title: "EXPLAIN 里那三行最容易看错的输出",
    excerpt:
      "rows 不是返回行数，filtered 不是过滤效率，key 有值也不代表走对了索引。",
    category: "数据库",
    date: "2026-10-19",
    tags: ["MySQL", "索引", "性能"],
    body: `
<p>我见过太多「加了索引还是慢」的案例，最后都指向同一件事：<code>EXPLAIN</code> 的输出被读错了。这三个字段最容易被误解。</p>

<h2>一、rows：优化器的估算，不是真相</h2>
<p><code>rows</code> 是优化器根据索引统计信息估算的「需要扫描的行数」。它是成本模型的一部分，不是实际执行结果。统计信息过期时，这个数字可以差两个数量级。</p>
<pre><code>EXPLAIN SELECT * FROM orders WHERE user_id = 42 AND status = 'PAID';
-- type: ref, key: idx_user, rows: 1
</code></pre>
<p>看起来只扫 1 行，实际跑了 4.2 秒。因为它只用了 <code>idx_user</code> 定位，然后回表逐行判断 <code>status</code>——而 <code>user_id=42</code> 这个用户有 80 万条订单。</p>
<p>正确的做法是给 <code>(user_id, status)</code> 建联合索引，让 <code>status</code> 也在索引里被过滤。改完之后 <code>rows</code> 依然显示 1，但 <code>Extra</code> 里的 <code>Using where</code> 消失了，这才是关键。</p>

<h2>二、filtered：估算的过滤比例</h2>
<p><code>filtered</code> 表示「经过条件过滤后剩下的百分比」。它的作用是乘上 <code>rows</code>，估算最终行数。<code>filtered=10</code> 不是「效率只有 10%」，而是「预计留下 10%」。</p>
<p>问题在于，这个值经常是 100.00——那是优化器「不知道，就先假设全留」的默认行为，不代表真的没有过滤。判断依据应该看 <code>Extra</code> 有没有 <code>Using where</code> 和索引的使用情况。</p>
<blockquote>当 filtered 恒为 100 时，先跑一次 ANALYZE TABLE，再看统计信息是否真的覆盖了你的过滤列。</blockquote>

<h2>三、key 有值 ≠ 走对了索引</h2>
<p><code>key</code> 只说明用了哪个索引，不说明用了索引的多少。真正要配合看的是 <code>key_len</code>：</p>
<ul>
  <li><code>key_len</code> 等于索引定义的完整长度 → 用到了全部列</li>
  <li><code>key_len</code> 小于预期 → 索引只用到前几列，后面的列退化成了过滤</li>
</ul>
<p>一个 <code>(a, b, c)</code> 的联合索引，如果 <code>key_len</code> 只等于 <code>a</code> 的长度，说明 <code>b</code> 和 <code>c</code> 完全没用上。常见原因是 <code>b</code> 上做了函数运算，或者类型不匹配导致了隐式转换。</p>
<pre><code>-- phone 是 varchar，这里传了数字
WHERE phone = 13800138000
-- 隐式转换，索引失效

-- 正确
WHERE phone = '13800138000'
</code></pre>

<h2>一个实用的排查顺序</h2>
<ol>
  <li>先看 <code>type</code>：<code>ALL</code> 或 <code>index</code> 基本就是全表扫描，优先处理。</li>
  <li>看 <code>rows × filtered</code>，估算这个查询要处理多少行。</li>
  <li>看 <code>Extra</code>：出现 <code>Using filesort</code>、<code>Using temporary</code> 时，往往意味着排序或分组没走索引。</li>
  <li>最后才看 <code>key</code> 和 <code>key_len</code>，确认索引用得完整不完整。</li>
</ol>
<p>如果要看真实开销，关掉优化器估算，用 <code>EXPLAIN ANALYZE</code>（8.0.18+）看实际执行时间和真实行数。估算和实际的差距，往往就是问题所在。</p>
`,
  },
  {
    slug: "api-contract-first",
    title: "把前后端的争吵前置到设计阶段",
    excerpt:
      "接口契约不是文档，是可执行的约束。用 OpenAPI + 代码生成，让字段改名这种事在编译期就报错。",
    category: "前后端协作",
    date: "2026-10-08",
    tags: ["OpenAPI", "Spring Boot", "TypeScript"],
    body: `
<p>「这个字段为什么是 string？我以为是 number。」「你上周改的字段名，前端还在用旧的。」这类对话在每个 Java + 前端的团队里循环上演。根因不是沟通不畅，是契约没有唯一来源。</p>

<h2>契约放在哪</h2>
<p>我们试过三种做法：</p>
<ol>
  <li><strong>Wiki 文档</strong>：写完当天就开始过期，两周后没人看。</li>
  <li><strong>Swagger 注解</strong>：由代码生成文档，但文档永远滞后于代码，且前端无法提前开发。</li>
  <li><strong>契约先行</strong>：先写 <code>openapi.yaml</code>，前后端各自从它生成代码。</li>
</ol>
<p>最终选了第三种。契约文件放在独立仓库，改动走 PR，前端和后端各有一个 review 人。</p>

<h2>后端：从契约生成接口</h2>
<p>用 <code>openapi-generator-maven-plugin</code> 生成 interface，Controller 实现它，字段改名时编译直接失败：</p>
<pre><code>&lt;plugin&gt;
  &lt;groupId&gt;org.openapitools&lt;/groupId&gt;
  &lt;artifactId&gt;openapi-generator-maven-plugin&lt;/artifactId&gt;
  &lt;configuration&gt;
    &lt;inputSpec&gt;\${project.basedir}/src/main/resources/openapi.yaml&lt;/inputSpec&gt;
    &lt;generatorName&gt;spring&lt;/generatorName&gt;
    &lt;interfaceOnly&gt;true&lt;/interfaceOnly&gt;
    &lt;modelPackage&gt;com.hhx.api.model&lt;/modelPackage&gt;
  &lt;/configuration&gt;
&lt;/plugin&gt;
</code></pre>
<p>生成的 interface 自带 <code>@RequestMapping</code> 和参数校验注解，实现类只管业务逻辑。这样契约是真正的约束，不是摆设。</p>

<h2>前端：生成 TypeScript 类型</h2>
<p>同一份 yaml，前端用 <code>openapi-typescript</code> 生成 <code>types.d.ts</code>，挂到 CI 上。后端改了契约但前端没重新生成，构建会红。</p>
<pre><code>npx openapi-typescript ./openapi.yaml -o src/api/types.d.ts
</code></pre>
<p>配合 <code>openapi-fetch</code> 这类轻量客户端，连请求方法名都是类型安全的。写错字段名，IDE 直接标红。</p>

<h2>三个约定，减少八成的争论</h2>
<ul>
  <li><strong>金额一律用字符串</strong>，保留两位小数。用 number 迟早遇到浮点精度问题。</li>
  <li><strong>时间一律用 ISO 8601 带时区</strong>，<code>2026-11-18T08:35:00+08:00</code>。不要传时间戳，前端无法区分秒和毫秒。</li>
  <li><strong>空值用 null，不要省略字段</strong>。省略字段让前端无法区分「没有这个值」和「字段不存在」。</li>
</ul>

<h2>要不要用 GraphQL</h2>
<p>如果前端页面高度动态、字段按需组合，GraphQL 值得考虑。但对我们这种以表单和列表为主的业务系统，REST + 契约生成已经够了，多引入一层 schema 与 N+1 的复杂度不划算。</p>
<p>契约先行的真正收益不是少吵架，而是<strong>让变更的成本显性化</strong>。改一个字段名要动两个仓库、两个 PR，你就会在动手之前想清楚这个改动值不值。</p>
`,
  },
  {
    slug: "java21-pattern-matching",
    title: "Java 21 的模式匹配，把 if-else 拆成数据形状",
    excerpt:
      "sealed interface + record + switch 模式匹配，三者组合起来，才能在编译期穷尽所有分支。",
    category: "Java 语言",
    date: "2026-09-26",
    tags: ["JDK 21", "record", "sealed"],
    body: `
<p>模式匹配在 JDK 21 转正之后，我陆续把几个核心领域模型改成了 sealed + record 的组合。最大的变化不是代码变短，而是编译器开始替我检查「你是不是漏了一种情况」。</p>

<h2>从一堆字符串常量说起</h2>
<p>原来的代码长这样：</p>
<pre><code>public BigDecimal calculate(Payment payment) {
    switch (payment.getType()) {
        case "ALIPAY":  return alipay(payment);
        case "WECHAT":  return wechat(payment);
        case "BALANCE": return balance(payment);
        default: throw new IllegalStateException("unknown type");
    }
}
</code></pre>
<p>新增「银行卡支付」时，编译器不会提醒你。上线后第一个用银行卡的用户就触发了异常。</p>

<h2>用数据形状替代类型标签</h2>
<pre><code>public sealed interface Payment
        permits Alipay, Wechat, Balance, BankCard {}

public record Alipay(String tradeNo) implements Payment {}
public record Wechat(String prepayId) implements Payment {}
public record Balance(long userId) implements Payment {}
public record BankCard(String cardNo, String bankCode) implements Payment {}
</code></pre>
<p>sealed 限制了实现者，record 保证了不可变与自动生成的 equals/hashCode。现在 switch 可以这么写：</p>
<pre><code>public BigDecimal calculate(Payment payment) {
    return switch (payment) {
        case Alipay a  -&gt; alipay(a.tradeNo());
        case Wechat w  -&gt; wechat(w.prepayId());
        case Balance b -&gt; balance(b.userId());
        case BankCard c -&gt; bankCard(c.cardNo(), c.bankCode());
    };
}
</code></pre>
<p>没有 default，也不需要。因为 Payment 是 sealed 的，编译器知道所有可能的子类型。下次有人加了 <code>record Crypto</code>，这个 switch 会直接编译失败——<strong>这就是我想要的</strong>。</p>

<h2>嵌套模式与守卫</h2>
<p>模式匹配真正好用的地方在于解构。比如订单状态机：</p>
<pre><code>sealed interface Event {}
record Paid(String orderNo, BigDecimal amount) implements Event {}
record Shipped(String orderNo, String trackingNo)  implements Event {}

String describe(Event e) {
    return switch (e) {
        case Paid p when p.amount().compareTo(HUNDRED) &gt; 0
                -&gt; "大额支付 " + p.orderNo();
        case Paid p      -&gt; "普通支付 " + p.orderNo();
        case Shipped s   -&gt; "已发货 " + s.trackingNo();
    };
}
</code></pre>
<p><code>when</code> 守卫让分支条件写在模式里，避免了 switch 里套 if 的尴尬。注意顺序：带守卫的分支必须放在通用分支之前。</p>

<h2>record 不适合所有场景</h2>
<ul>
  <li>record 的字段全部是 final 的，JPA 实体、需要 setter 的 DTO 都不合适。</li>
  <li>record 不能继承其他类，但可以实现接口。</li>
  <li>序列化框架对 record 的支持参差不齐，Jackson 2.12+ 没问题，老版本需要额外配置。</li>
</ul>
<p>我的用法是：<strong>领域事件、API 响应、值对象用 record；持久化实体保持普通类。</strong>这样既拿到了模式匹配的好处，又不用和 ORM 打架。</p>

<h2>迁移建议</h2>
<p>不要一次性重构。挑一个「分支判断最多、最容易漏 case」的类开始，把它拆成 sealed 层级，让编译器把漏掉的分支全部指出来。这一个类的收益，就足够说服团队了。</p>
`,
  },
  {
    slug: "cache-consistency",
    title: "缓存一致性：延迟双删到底要删几次",
    excerpt:
      "先删缓存再更新库、先更新库再删缓存、延迟双删——三种方案的失败窗口究竟在哪，以及什么时候该放弃它们。",
    category: "架构",
    date: "2026-09-14",
    tags: ["Redis", "缓存", "一致性"],
    body: `
<p>「延迟双删」这四个字在面试里被问了十年，但真正上线时踩坑的地方，从来不在删几次，而在于删完之后那个并发读还没结束。</p>

<h2>先明确目标</h2>
<p>缓存与数据库的一致性，本质是一个没有完美解的问题。我们能做的是把不一致的时间窗口压到业务可接受的范围，而不是追求强一致。先问自己：读到 200ms 前的数据，业务会不会出事？</p>
<ul>
  <li>商品详情、用户头像：能接受，缓存 5 分钟都行。</li>
  <li>账户余额、库存扣减：不能接受，这类数据根本不该走普通缓存。</li>
</ul>

<h2>三种方案的失败窗口</h2>
<h3>1. 先删缓存，再更新数据库</h3>
<p>失败窗口在「删完缓存、库还没更新」之间。此时有读请求进来，读到旧值并回填缓存，缓存就长期脏了。这个窗口和数据库更新耗时正相关，高并发下几乎必然发生。</p>

<h3>2. 先更新数据库，再删缓存</h3>
<p>这是 Cache Aside 的标准写法，失败窗口更小。唯一的不一致场景是：读请求在库更新前读到旧值，在删缓存之后才回填。这个窗口取决于读请求的耗时，通常只有几毫秒，概率极低但存在。</p>

<h3>3. 延迟双删</h3>
<p>在方案 2 基础上，更新完库后再延迟一段时间（比如 500ms）删第二次，目的是清掉那个「迟到的回填」。</p>
<pre><code>public void update(Item item) {
    itemMapper.update(item);
    cache.delete(key(item));
    delayExecutor.schedule(
        () -&gt; cache.delete(key(item)),
        500, TimeUnit.MILLISECONDS
    );
}
</code></pre>
<p>但它有三个前提：延迟时间必须大于「读请求最大耗时 + 主从同步延迟」，否则删了也没用；调度器必须可靠，服务重启就丢了；而且这只是把概率压低，并没有消灭窗口。</p>

<h2>更可靠的做法</h2>
<h3>用消息队列串行化</h3>
<p>把「更新库 + 删缓存」放进同一条消息，由单个消费者顺序处理。缓存操作失败就重试，直到成功。代价是引入延迟（通常几十毫秒），换来的是最终一致。</p>

<h3>订阅 binlog</h3>
<p>Canal 或 Debezium 监听 binlog，解析出变更后异步删缓存。好处是业务代码零侵入，且能捕获所有写入路径（包括手工改库）。坏处是多了一个组件要维护。</p>

<h3>逻辑过期</h3>
<p>缓存里存 <code>{data, expireAt}</code>，不设 Redis 的 TTL。读到过期数据时异步刷新，同时返回旧值。这样永远不会有「缓存穿透到库」的尖峰，代价是短时间内读到旧数据。适合热点 key 场景。</p>

<h2>别忘了这些</h2>
<ul>
  <li><strong>删缓存失败要重试</strong>。Redis 抖动是常态，失败后进重试队列，别只打条日志。</li>
  <li><strong>主从延迟</strong>。读写分离的架构下，删缓存后立刻读主库之前，从库可能还没同步。这类场景建议强制读主。</li>
  <li><strong>热点 key 的重建</strong>。缓存失效瞬间大量请求同时回源，用分布式锁或 singleflight 把并发压成一个。</li>
</ul>
<p>我的经验是：<strong>能用 binlog 就不要在业务代码里手写双删。</strong>业务代码里的缓存逻辑越少，出问题的概率越低。</p>
`,
  },
  {
    slug: "structured-data-ai-qa",
    title: "让 AI 回答数据库里的问题，准确率从 40% 到 92%",
    excerpt:
      "Text-to-SQL 的准确率瓶颈不在模型，在 schema 的可理解性、指标口径的统一，以及那个必须存在的执行沙箱。",
    category: "AI 工程",
    date: "2026-08-30",
    tags: ["Text-to-SQL", "Spring AI", "数据"],
    body: `
<p>业务方希望「用一句话查数」。我们一开始直接把建表语句塞给模型让它生成 SQL，准确率 40%——比掷骰子好一点，但没人敢用。</p>
<p>三个月后到了 92%。下面是我们做的每一件事，按收益排序。</p>

<h2>1. 给 schema 写注释（收益最大）</h2>
<p>模型看不懂 <code>ord_amt</code> 是什么意思，但它能理解「订单实付金额，单位：分」。我们把所有表和字段的中文注释补全，并额外提供了一列 <code>description</code> 元数据：</p>
<pre><code>{
  "table": "ord_order",
  "description": "订单主表，一行代表一个订单",
  "columns": [
    {"name": "ord_amt", "type": "bigint",
     "desc": "订单实付金额，单位：分，已扣除优惠"},
    {"name": "stat", "type": "tinyint",
     "desc": "订单状态：1待支付 2已支付 3已发货 4已完成 5已取消"}
  ]
}
</code></pre>
<p>尤其是枚举值。不告诉模型 <code>stat=3</code> 是「已发货」，它只能猜。这一步单独就把准确率从 40% 拉到 66%。</p>

<h2>2. 统一指标口径</h2>
<p>「上个月的 GMV 是多少」——这句话在四个部门有四种算法。与其让模型猜，不如把口径写成一份指标定义，作为检索的资料：</p>
<blockquote>GMV = 已支付订单（stat in 2,3,4）的 ord_amt 之和，不含运费，按支付时间 pay_time 归属月份。</blockquote>
<p>用户提问时先检索相关指标定义，命中后拼进 prompt。这一步把「SQL 语法正确但业务口径错」的比例从 28% 降到 6%。</p>

<h2>3. 少表优于多表</h2>
<p>我们有 180 张表。一次性全塞进去会超出上下文，而且干扰严重。做法是先做一次表级召回：用向量检索选出 Top 6 相关表，只把这些表的 schema 放进 prompt。准确率提升的同时，token 成本降了 70%。</p>

<h2>4. 让模型先想再写</h2>
<pre><code>请按以下步骤输出：
1. 用一句话复述用户的查询意图，指出涉及的时间范围与过滤条件
2. 列出需要的表和关联字段
3. 再输出 SQL，使用标准 MySQL 语法
4. 最后用一句话解释这个 SQL 的计算口径
</code></pre>
<p>Chain-of-thought 在这里的收益非常直接：模型在复述意图时，就暴露了「它以为的月份是哪个月」。我们还把第 1 步的结果展示给用户确认，误解题意的比例大幅下降。</p>

<h2>5. 执行沙箱是底线</h2>
<p>生成的 SQL 必须经过校验才能执行：</p>
<ul>
  <li>只允许 <code>SELECT</code>，解析 AST 而不是正则匹配关键字</li>
  <li>强制加 <code>LIMIT 1000</code></li>
  <li>设置语句超时 10 秒</li>
  <li>用只读账号，且只能访问视图层</li>
  <li>禁止 <code>SELECT *</code>，禁止子查询嵌套超过 3 层</li>
</ul>
<p>我们用 JSqlParser 做 AST 校验。曾经有个模型生成了一条带 <code>CROSS JOIN</code> 的语句，在沙箱里跑了 9.8 秒才被超时杀掉——如果没有沙箱，这条语句会打满生产库的 CPU。</p>

<h2>6. 失败时重试，把错误喂回去</h2>
<p>SQL 执行报错时，把错误信息（比如 <code>Unknown column 'order_no'</code>）和原 SQL 一起回给模型，让它修正。最多重试两次，成功率能从 78% 提到 92%。这个小技巧几乎零成本。</p>

<h2>剩下 8% 是什么</h2>
<p>主要是两类：一是业务本身模糊（「最近卖得好的是哪些」——「好」没有定义），二是跨库查询。前者靠交互追问解决，后者暂时不支持。</p>
<p>我的结论是：<strong>Text-to-SQL 的上限由数据治理决定，模型只决定到达上限的速度。</strong>花在补注释、统一口径上的时间，比调 prompt 划算得多。</p>
`,
  },
];
