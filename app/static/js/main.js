/* ClickForest dashboard — renders every section from /api/results. */
(function () {
  const { C, axis, make, lazy, registry, alpha } = window.CF;
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const pct = (x, d = 1) => (x * 100).toFixed(d) + "%";
  const f3 = (x) => Number(x).toFixed(3);
  const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const SHORT = {
    "Daily Time Spent on Site": "Time on site",
    "Daily Internet Usage": "Internet usage",
    "Area Income": "Area income",
    "Age": "Age", "Male": "Male", "Hour": "Hour", "Day of Week": "Day of week",
    "Month": "Month", "Site Share": "Site share", "Timestamp": "Timestamp",
    "Clicked on Ad": "Clicked",
  };
  const UNIT = {
    "Daily Time Spent on Site": "min", "Daily Internet Usage": "min", "Age": "yrs", "Area Income": "USD",
  };
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"];

  let R; // results

  /* ------------------------------------------------------------------ */
  /* shared UI behaviour                                                 */
  /* ------------------------------------------------------------------ */
  const tip = $("#tip");
  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.classList.add("show");
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > innerHeight - 8) y = evt.clientY - h - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  const hideTip = () => tip.classList.remove("show");

  function countUp(node, to, fmt, ms = 1200) {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      node.textContent = fmt(to * e);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Animate a number from the value it last showed to a new one.
  function tweenNum(el, to, fmt, ms = 320) {
    const from = el._v ?? to;
    el._v = to;
    cancelAnimationFrame(el._raf);
    if (from === to || CF.REDUCED) { el.textContent = fmt(to); return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (t < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }

  function setupReveal() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -6% 0px" });
    $$(".reveal").forEach((n) => {
      // stagger siblings that sit in the same grid row
      const sibs = n.parentElement ? [...n.parentElement.children].filter((c) => c.classList.contains("reveal")) : [];
      const i = sibs.indexOf(n);
      if (n.parentElement.classList.contains("grid") && i > 0) n.style.setProperty("--d", i * 0.08 + "s");
      io.observe(n);
    });
    // section divider lines draw in as each section arrives
    const so = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("seen"); so.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -10% 0px" });
    $$(".section").forEach((s) => so.observe(s));
  }

  function setupNav() {
    const links = $$(".nav-link");
    const ind = $("#navIndicator");
    const sections = links.map((a) => $(a.getAttribute("href")));
    const nav = $("#nav");
    function activate(i) {
      links.forEach((l, j) => l.classList.toggle("active", i === j));
      const a = links[i];
      ind.style.transform = `translateY(${a.offsetTop}px)`;
      ind.style.height = a.offsetHeight + "px";
      ind.style.opacity = 1;
    }
    let current = -1;
    function onScroll() {
      const y = scrollY + innerHeight * 0.3;
      let idx = 0;
      sections.forEach((s, i) => { if (s.offsetTop <= y) idx = i; });
      if (innerHeight + scrollY >= document.body.scrollHeight - 4) idx = sections.length - 1;
      if (idx !== current) { current = idx; activate(idx); }
      const max = document.body.scrollHeight - innerHeight;
      $("#progress").style.transform = `scaleX(${max > 0 ? scrollY / max : 0})`;
    }
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    onScroll();

    const sb = $("#sidebar");
    $("#menuBtn").addEventListener("click", () => sb.classList.toggle("open"));
    nav.addEventListener("click", (e) => { if (e.target.closest("a")) sb.classList.remove("open"); });
  }

  function segmented(container, items, onPick, initial = 0) {
    container.innerHTML = items.map((it, i) =>
      `<button type="button" data-i="${i}" class="${i === initial ? "on" : ""}">${esc(it)}</button>`).join("");
    container.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      $$("button", container).forEach((x) => x.classList.toggle("on", x === b));
      onPick(+b.dataset.i);
    });
  }

  function legends() {
    const sets = {
      class: [["sw", C.c0, "Not clicked"], ["sw", C.c1, "Clicked"]],
      impl: [["sw", C.accent, "From scratch (NumPy)"], ["sw", C.s3, "scikit-learn"]],
      fit: [["sw line", C.accent, "Cross-validation"], ["sw dash", C.s3, "Training"]],
      roc3: [["sw line", C.accent, "Random Forest (tuned)"], ["sw line", C.s2, "Logistic Regression"], ["sw dash", C.s3, "Decision Tree"]],
    };
    $$("[data-legend]").forEach((n) => {
      n.innerHTML = sets[n.dataset.legend].map(([cls, col, label]) =>
        `<span><i class="${cls}" style="background:${col};border-color:${col}"></i>${label}</span>`).join("");
    });
  }

  /* ------------------------------------------------------------------ */
  /* 01 overview                                                         */
  /* ------------------------------------------------------------------ */
  function overview() {
    const m = R.evaluation.metrics;
    const bp = R.tuning.best_params;
    // [label, value, format, sub-line, bar fill 0–1]
    const items = [
      ["Test accuracy", m.accuracy, (x) => pct(x), `${Math.round(m.accuracy * 250)} of 250 unseen rows correct`, m.accuracy],
      ["ROC-AUC", m.roc_auc, (x) => x.toFixed(3), "Ranking quality across all thresholds", m.roc_auc],
      ["F1 score", m.f1, (x) => x.toFixed(3), `Precision ${pct(m.precision)} · Recall ${pct(m.recall)}`, m.f1],
      ["Trees in forest", bp.n_estimators, (x) => Math.round(x), `max_depth ${bp.max_depth} · ${bp.max_features} features`, bp.n_estimators / 600],
    ];
    const box = $("#kpis");
    box.innerHTML = items.map(([l, , , s]) =>
      `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">0</div><div class="kpi-sub">${s}</div><div class="kpi-bar"><i></i></div></div>`).join("");
    lazy(box, () => {
      $$(".kpi-value", box).forEach((n, i) => countUp(n, items[i][1], items[i][2]));
      $$(".kpi-bar i", box).forEach((b, i) => (b.style.width = items[i][4] * 100 + "%"));
    });

    $("#flowTrees").textContent = `${bp.n_estimators} trees`;
    $("#footModel").textContent = `RF · ${bp.n_estimators} trees`;
    const flow = $("#flow");
    $$("li", flow).forEach((li, i) => li.style.setProperty("--i", i));
    lazy(flow, () => setTimeout(() => { flow.classList.add("run"); flow.parentElement.classList.add("run"); }, 250));

    const hero = new CF.Surface($("#heroSurface"), R.surface, R.eda.scatter, surfaceTips());
    lazy($("#heroSurface"), () => setTimeout(() => hero.play(), 300));
  }

  function surfaceTips() {
    return {
      onHover: (e, s) => showTip(e, `<div class="t-head">Time on site ${s.t.toFixed(0)} min · online ${s.u.toFixed(0)} min</div>
        P(click) = <b>${s.p.toFixed(2)}</b> → ${s.p >= 0.5 ? "click" : "no click"}`),
      onLeave: hideTip,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 02 dataset                                                          */
  /* ------------------------------------------------------------------ */
  function dataset() {
    const D = R.dataset;
    $("#colSummary").textContent = `${D.rows.toLocaleString()} rows × ${D.columns} columns`;
    $("#colTable").innerHTML = `
      <thead><tr><th>Column</th><th>Kind</th><th class="num">Unique</th><th class="num">Missing</th><th>Range / note</th><th>Role</th></tr></thead>
      <tbody>${D.column_info.map((c) => `
        <tr>
          <td><b>${esc(c.name)}</b><div class="small muted">${esc(c.description)}</div></td>
          <td class="small">${c.kind}</td>
          <td class="num">${c.unique.toLocaleString()}</td>
          <td class="num">${c.missing}</td>
          <td class="small mono">${c.kind === "numeric" ? `${c.min} – ${c.max}<br><span class="muted">μ ${c.mean} · σ ${c.std}</span>` :
            c.kind === "datetime" ? `${D.date_range[0]} → ${D.date_range[1]}` :
            c.kind === "binary" ? "0 / 1" : `${pct(c.unique / D.rows, 1)} unique`}</td>
          <td><span class="role role-${c.role}">${c.role}</span></td>
        </tr>`).join("")}</tbody>`;

    const n0 = D.class_counts["0"], n1 = D.class_counts["1"], tot = n0 + n1;
    $("#balance").innerHTML = `
      <div class="balance-bar"><div style="background:${C.c0}" data-w="${n0 / tot * 100}">${n0}</div><div style="background:${C.c1}" data-w="${n1 / tot * 100}">${n1}</div></div>
      <div class="balance-legend"><span><i class="dot" style="background:${C.c0}"></i>Not clicked</span><span><i class="dot" style="background:${C.c1}"></i>Clicked</span></div>`;
    lazy($("#balance"), () => $$(".balance-bar div").forEach((d) => (d.style.width = d.dataset.w + "%")));

    $("#checks").innerHTML = [
      ["Missing values", D.missing_total],
      ["Duplicate rows", D.duplicates],
      ["Numeric features", 4],
      ["Date span", `${D.date_range[0].slice(5)} → ${D.date_range[1].slice(5)} (2016)`],
      ["Countries / cities", "237 / 969"],
    ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join("");

    records();
  }

  function records() {
    const all = R.dataset.records;
    const per = 10;
    let page = 0, q = "", cls = "all";
    const table = $("#recTable"), pager = $("#recPager");
    const cols = [
      ["Daily Time Spent on Site", "Time on site", "num"], ["Age", "Age", "num"], ["Area Income", "Area income", "num"],
      ["Daily Internet Usage", "Internet use", "num"], ["Ad Topic Line", "Ad topic line", ""], ["City", "City", ""],
      ["Country", "Country", ""], ["Male", "Male", "num"], ["Timestamp", "Timestamp", "mono small"],
    ];
    function rows() {
      const s = q.toLowerCase();
      return all.filter((r) => (cls === "all" || String(r["Clicked on Ad"]) === cls) &&
        (!s || (r["Ad Topic Line"] + r.City + r.Country).toLowerCase().includes(s)));
    }
    function render() {
      const list = rows();
      const pages = Math.max(1, Math.ceil(list.length / per));
      page = Math.min(page, pages - 1);
      const slice = list.slice(page * per, page * per + per);
      table.innerHTML = `<thead><tr>${cols.map(([, l, c]) => `<th class="${c.includes("num") ? "num" : ""}">${l}</th>`).join("")}<th>Clicked</th></tr></thead>
        <tbody>${slice.map((r, ri) => `<tr style="--r:${ri}">${cols.map(([k, , c]) =>
          `<td class="${c}" title="${esc(r[k])}">${k === "Area Income" ? money(r[k]) : esc(r[k])}</td>`).join("")}
          <td><i class="dot" style="background:${r["Clicked on Ad"] ? C.c1 : C.c0}"></i>${r["Clicked on Ad"] ? "Yes" : "No"}</td></tr>`).join("") ||
          `<tr><td colspan="10" class="muted">No records match.</td></tr>`}</tbody>`;
      pager.innerHTML = `<span>${list.length ? page * per + 1 : 0}–${Math.min(list.length, page * per + per)} of ${list.length.toLocaleString()}</span>
        <div class="pager-btns"><button class="btn ghost small" data-p="-1" ${page === 0 ? "disabled" : ""}>Previous</button>
        <button class="btn ghost small" data-p="1" ${page >= pages - 1 ? "disabled" : ""}>Next</button></div>`;
    }
    pager.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-p]");
      if (b) { page += +b.dataset.p; render(); }
    });
    $("#recSearch").addEventListener("input", (e) => { q = e.target.value; page = 0; render(); });
    $("#recFilter").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#recFilter button").forEach((x) => x.classList.toggle("on", x === b));
      cls = b.dataset.v; page = 0; render();
    });
    render();
  }

  /* ------------------------------------------------------------------ */
  /* 03 exploration                                                      */
  /* ------------------------------------------------------------------ */
  function explore() {
    const E = R.eda;
    const cols = Object.keys(E.histograms);
    let hist;
    function histData(col) {
      const h = E.histograms[col];
      const labels = h.edges.slice(0, -1).map((e, i) => `${Math.round(e)}–${Math.round(h.edges[i + 1])}`);
      return { labels, h };
    }
    function histNote(col) {
      const h = E.histograms[col];
      const unit = UNIT[col] === "USD" ? money : (x) => `${x} ${UNIT[col]}`;
      $("#histNote").textContent = `Average ${SHORT[col].toLowerCase()}: ${unit(h.mean_clicked)} for clickers vs. ${unit(h.mean_not_clicked)} for non-clickers.`;
    }
    const first = histData(cols[0]);
    histNote(cols[0]);
    make("histChart", {
      type: "bar",
      data: {
        labels: first.labels,
        datasets: [
          { label: "Not clicked", data: first.h.not_clicked, backgroundColor: C.c0, borderSkipped: "bottom" },
          { label: "Clicked", data: first.h.clicked, backgroundColor: C.c1, borderSkipped: "bottom" },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        datasets: { bar: { categoryPercentage: 0.82, barPercentage: 0.9 } },
        scales: { x: axis({ grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14, color: C.muted, font: { size: 10.5 } } }),
                  y: axis({ title: { text: "Users" } }) },
        plugins: { tooltip: { callbacks: { title: (it) => `${SHORT[cols[curHist]]}: ${it[0].label}` } } },
      },
    }).then((c) => (hist = c));
    let curHist = 0;
    segmented($("#histTabs"), cols.map((c) => SHORT[c]), (i) => {
      curHist = i;
      const d = histData(cols[i]);
      histNote(cols[i]);
      if (!hist) return;
      hist.data.labels = d.labels;
      hist.data.datasets[0].data = d.h.not_clicked;
      hist.data.datasets[1].data = d.h.clicked;
      hist.update();
    });

    const sc = E.scatter;
    const pts = (y) => sc.filter((p) => p.y === y).map((p) => ({ x: p.t, y: p.u }));
    make("scatterChart", {
      type: "scatter",
      data: {
        datasets: [
          { label: "Not clicked", data: pts(0), backgroundColor: alpha(C.c0, 0.78), borderColor: C.surface, borderWidth: 1, pointRadius: 4, pointHoverRadius: 6 },
          { label: "Clicked", data: pts(1), backgroundColor: alpha(C.c1, 0.78), borderColor: C.surface, borderWidth: 1, pointRadius: 4, pointHoverRadius: 6 },
        ],
      },
      options: {
        interaction: { mode: "nearest", intersect: true },
        scales: { x: axis({ title: { text: "Daily time on site (min)" } }), y: axis({ title: { text: "Daily internet usage (min)" } }) },
        plugins: { tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${it.parsed.x} min on site, ${it.parsed.y} min online` } } },
      },
    });

    const ages = E.by_age;
    const top = ages.reduce((a, b) => (b.rate > a.rate ? b : a));
    const low = ages.reduce((a, b) => (b.rate < a.rate ? b : a));
    $("#ageNote").textContent = `Click rate climbs steadily with age, from ${pct(low.rate, 0)} (${low.band}) to ${pct(top.rate, 0)} (${top.band}). Age is the strongest demographic signal.`;
    make("ageChart", {
      type: "bar",
      data: { labels: ages.map((a) => a.band), datasets: [{ label: "Click rate", data: ages.map((a) => a.rate), backgroundColor: C.c1, borderSkipped: "bottom", maxBarThickness: 46 }] },
      options: {
        scales: { x: axis({ grid: { display: false }, title: { text: "Age band" } }),
                  y: axis({ min: 0, max: 1, ticks: { callback: (v) => pct(v, 0), color: C.muted, font: { size: 11 } } }) },
        plugins: { tooltip: { displayColors: false, callbacks: { label: (it) => `Click rate ${pct(it.parsed.y)} · n = ${ages[it.dataIndex].n}` } } },
      },
    });

    make("hourChart", {
      type: "line",
      data: {
        labels: E.by_hour.map((h) => String(h.hour).padStart(2, "0")),
        datasets: [
          { label: "Click rate", data: E.by_hour.map((h) => h.rate), borderColor: C.accent, backgroundColor: C.accent, pointRadius: 2.5, pointBackgroundColor: C.accent },
          { label: "Overall rate", data: E.by_hour.map(() => 0.5), borderColor: C.muted, borderDash: [4, 4], borderWidth: 1, pointRadius: 0, pointHoverRadius: 0 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: axis({ grid: { display: false }, title: { text: "Hour of day" } }),
                  y: axis({ min: 0, max: 1, ticks: { callback: (v) => pct(v, 0), color: C.muted, font: { size: 11 } } }) },
        plugins: { tooltip: { filter: (it) => it.datasetIndex === 0, displayColors: false,
          callbacks: { title: (it) => `${it[0].label}:00`, label: (it) => `Click rate ${pct(it.parsed.y)} · n = ${E.by_hour[it.dataIndex].n}` } } },
      },
    });

    heatmap();
  }

  function heatmap() {
    const { labels, matrix } = R.eda.corr;
    const n = labels.length;
    const box = $("#heatmap");
    box.style.gridTemplateColumns = `104px repeat(${n}, minmax(0, 1fr))`;
    const neutral = [236, 237, 238];
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const neg = hex(C.c0), pos = hex(C.c1);
    const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
    let html = "<div></div>" + labels.map((l) => `<div class="hm-label hm-col">${SHORT[l]}</div>`).join("");
    matrix.forEach((row, i) => {
      html += `<div class="hm-label">${SHORT[labels[i]]}</div>`;
      row.forEach((r, j) => {
        const rgb = i === j ? [218, 222, 228] : mix(neutral, r < 0 ? neg : pos, Math.min(1, Math.abs(r)));
        const ink = Math.abs(r) > 0.5 ? "#fff" : C.ink2;
        html += `<div class="hm-cell" data-i="${i}" data-j="${j}" style="--w:${(i + j) * 22}ms;background:rgb(${rgb});color:${ink}">${i === j ? "" : r.toFixed(2).replace("0.", ".")}</div>`;
      });
    });
    box.innerHTML = html;
    lazy(box, () => {
      box.classList.add("show");
      setTimeout(() => box.classList.add("done"), (2 * n) * 22 + 500);
    });
    box.insertAdjacentHTML("afterend", `<div class="hm-scale"><span>−1</span><div class="hm-grad" style="background:linear-gradient(90deg, ${C.c0}, rgb(${neutral}), ${C.c1})"></div><span>+1</span></div>`);
    box.addEventListener("mousemove", (e) => {
      const c = e.target.closest(".hm-cell");
      if (!c) return hideTip();
      const i = +c.dataset.i, j = +c.dataset.j;
      showTip(e, `<div class="t-head">${labels[i]} × ${labels[j]}</div>r = ${matrix[i][j].toFixed(3)}`);
    });
    box.addEventListener("mouseleave", hideTip);
  }

  /* ------------------------------------------------------------------ */
  /* 04 preprocessing                                                    */
  /* ------------------------------------------------------------------ */
  function prep() {
    const P = R.preprocessing;
    const corrShare = R.eda.facts.corr_with_target["Site Share"];
    const steps = [
      {
        t: "Drop identifier-like text columns",
        p: "Ad Topic Line, City and Country are almost unique per row. A model would memorise them instead of learning a pattern.",
        extra: `<table class="table compact"><thead><tr><th>Column</th><th class="num">Unique values</th><th class="num">Share unique</th></tr></thead><tbody>
          ${P.dropped.map((d) => `<tr><td>${d.name}</td><td class="num">${d.unique}</td><td class="num">${pct(d.share_unique)}</td></tr>`).join("")}</tbody></table>`,
        why: "<b>Why:</b> with 237 countries over 1,000 rows, most countries appear 2–8 times. One-hot encoding would add 237 sparse columns of noise.",
      },
      {
        t: "Decompose the timestamp",
        p: "A raw datetime is not a usable split variable. Hour, day of week and month are extracted so trees can test them separately.",
        code: `ts = pd.to_datetime(X[<span class="s">"Timestamp"</span>])
out[<span class="s">"Hour"</span>]        = ts.dt.hour
out[<span class="s">"Day of Week"</span>] = ts.dt.day_of_week   <span class="c"># 0 = Mon</span>
out[<span class="s">"Month"</span>]       = ts.dt.month`,
        why: "<b>Why:</b> if ad timing mattered, these would show it. They end up near zero importance, which is itself a finding.",
      },
      {
        t: "Cap outliers with the IQR rule",
        p: "Bounds are Q1 − 1.5·IQR and Q3 + 1.5·IQR, learned on the training split only. Values outside are clipped to the bound, not deleted.",
        extra: `<table class="table compact"><thead><tr><th>Feature</th><th class="num">Lower</th><th class="num">Upper</th><th class="num">Clipped</th></tr></thead><tbody>
          ${Object.entries(P.clip_bounds).map(([k, b]) => `<tr><td>${SHORT[k]}</td><td class="num">${b.lower.toLocaleString()}</td><td class="num">${b.upper.toLocaleString()}</td><td class="num">${b.below + b.above}</td></tr>`).join("")}</tbody></table>`,
        why: "<b>Why:</b> trees are robust to outliers, but the linear and distance-based baselines are not. Clipping also keeps live inputs inside the range the model has seen.",
      },
      {
        t: "Engineer a ratio feature",
        p: "Site Share = time on site ÷ total internet time: how much of a user's online day this site takes up.",
        code: `out[<span class="s">"Site Share"</span>] = (out[<span class="s">"Daily Time Spent on Site"</span>]
                    / out[<span class="s">"Daily Internet Usage"</span>])`,
        why: `<b>Honest result:</b> its linear correlation with clicking is only r = ${corrShare.toFixed(3)}, but trees use it in interactions and it takes ~${pct(R.importance.mdi.find((d) => d.feature === "Site Share").value, 0)} of impurity importance.`,
      },
      {
        t: "Encoding & scaling",
        p: "Male is already 0/1 and no text columns remain, so no one-hot encoding is needed. Random Forest needs no scaling: a split at x ≤ t is unchanged by any monotonic rescaling.",
        code: `<span class="c"># scaling only for scale-sensitive baselines</span>
Pipeline([(<span class="s">"f"</span>, FeatureBuilder()), (<span class="s">"s"</span>, StandardScaler()),
          (<span class="s">"m"</span>, LogisticRegression())])`,
        why: "<b>Why:</b> scaling only the baselines that need it (Logistic Regression, KNN, SVM) makes the comparison fair without touching the forest.",
      },
      {
        t: "Stratified split, leak-free pipeline",
        p: `${P.split.train} training rows / ${P.split.test} test rows, stratified on the target (seed ${P.split.seed}). The test set is touched once, at the very end.`,
        code: `pipe = Pipeline([(<span class="s">"features"</span>, FeatureBuilder()),
                 (<span class="s">"rf"</span>, RandomForestClassifier())])
<span class="c"># FeatureBuilder is refit inside every CV fold → no leakage</span>`,
        why: "<b>Why:</b> because outlier bounds are learned inside the pipeline, each cross-validation fold computes its own bounds without peeking at its validation rows.",
      },
    ];
    $("#steps").innerHTML = steps.map((s, i) => `
      <div class="card step reveal">
        <div class="step-head"><span class="step-n">${String(i + 1).padStart(2, "0")}</span><h3>${s.t}</h3></div>
        <p>${s.p}</p>
        ${s.extra || ""}${s.code ? `<pre class="code">${s.code}</pre>` : ""}
        <div class="why">${s.why}</div>
      </div>`).join("");
  }

  /* ------------------------------------------------------------------ */
  /* 05 forest                                                           */
  /* ------------------------------------------------------------------ */
  function forest() {
    bagging();
    growingForest();
    tree();

    const S = R.scratch;
    const rows = [
      ["Accuracy", "accuracy", pct], ["Precision", "precision", pct], ["Recall", "recall", pct],
      ["F1", "f1", f3], ["ROC-AUC", "roc_auc", f3], ["OOB accuracy", "oob", pct],
      ["Mean tree depth", "mean_depth", (x) => x], ["Fit time", "fit_seconds", (x) => x + " s"],
    ];
    $("#scratchTable").innerHTML = `<thead><tr><th>Metric (test set)</th><th class="num">From scratch</th><th class="num">scikit-learn</th></tr></thead>
      <tbody>${rows.map(([l, k, f]) => `<tr><td>${l}</td><td class="num">${f(S.scratch[k])}</td><td class="num">${f(S.sklearn[k])}</td></tr>`).join("")}</tbody>`;
    const ex = S.example;
    $("#scratchNote").innerHTML = `The two implementations agree on <b>${pct(S.agreement)}</b> of test predictions. The small gap comes from different random draws, not different logic.
      Hardest test row for the scratch forest: <b>${ex.votes_click} of 100</b> trees voted “click” (mean P = ${ex.mean_prob.toFixed(2)}); the true label was <b>${ex.truth ? "click" : "no click"}</b>.`;

    const feats = Object.keys(S.importance).sort((a, b) => S.importance[b][1] - S.importance[a][1]);
    make("impAgreeChart", {
      type: "bar",
      data: {
        labels: feats.map((f) => SHORT[f]),
        datasets: [
          { label: "From scratch", data: feats.map((f) => S.importance[f][0]), backgroundColor: C.accent, borderSkipped: "left" },
          { label: "scikit-learn", data: feats.map((f) => S.importance[f][1]), backgroundColor: C.s3, borderSkipped: "left" },
        ],
      },
      options: {
        indexAxis: "y",
        interaction: { mode: "index", intersect: false },
        datasets: { bar: { categoryPercentage: 0.78, barPercentage: 0.88 } },
        scales: { x: axis({ ticks: { callback: (v) => pct(v, 0), color: C.muted, font: { size: 11 } } }), y: axis({ grid: { display: false }, ticks: { color: C.ink2, font: { size: 12 } } }) },
        plugins: { tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${pct(it.parsed.x)}` } } },
      },
    });
  }

  function growingForest() {
    const S = R.surface;
    const keys = Object.keys(S.by_trees);                        // "1", "3", "10", "30", "167"
    const total = +keys[keys.length - 1];
    const surf = new CF.Surface($("#growSurface"), S, R.eda.scatter, { ...surfaceTips(), initial: keys[0] });
    const share = (k, f) => S.by_trees[k].filter(f).length / S.by_trees[k].length;
    const text = {
      "1": "A single tree carves the map into hard rectangles. Almost every point gets a 0 or 1, and the boundary is a staircase that follows its own bootstrap sample.",
      "3": "Three trees already disagree in places. Their votes average into intermediate probabilities, and the staircase starts to soften.",
      "10": "With ten trees, the individual quirks cancel out. The boundary settles onto the diagonal that separates the two groups.",
      "30": "Thirty trees: the surface is smooth and changes very little from here. The band of uncertainty along the boundary is now an honest one.",
    };
    text[String(total)] = `The full tuned forest of ${total} trees. Extra trees add stability, not new structure, which matches the flat out-of-bag error curve in section 06.`;
    let idx = 0, timer = null;
    function show(i) {
      idx = i;
      const k = keys[i];
      surf.morphTo(k);
      $$("#growTabs button").forEach((b, j) => b.classList.toggle("on", j === i));
      tweenNum($("#growN"), +k, (x) => Math.max(1, Math.round(x)), 600);
      $("#growUnit").textContent = +k === 1 ? "tree" : "trees";
      $("#growFill").style.width = (Math.log(+k + 1) / Math.log(total + 1)) * 100 + "%";
      $("#growText").textContent = text[k];
      $("#growSure").textContent = pct(share(k, (v) => v < 0.02 || v > 0.98), 0);
      $("#growUnsure").textContent = pct(share(k, (v) => v > 0.2 && v < 0.8), 0);
    }
    function stop() { clearInterval(timer); timer = null; $("#growPlay").textContent = "▶ Play"; $("#growPlay").classList.remove("playing"); }
    function play() {
      if (timer) return stop();
      $("#growPlay").textContent = "❚❚ Pause"; $("#growPlay").classList.add("playing");
      show(0);
      timer = setInterval(() => (idx < keys.length - 1 ? show(idx + 1) : stop()), 1700);
    }
    segmented($("#growTabs"), keys.map((k) => (k === "1" ? "1 tree" : k)), (i) => { stop(); show(i); });
    $("#growPlay").addEventListener("click", play);
    $("#growFixed").textContent = `Other inputs held at typical values: age ${S.fixed.Age}, area income ${money(S.fixed["Area Income"])}, female, weekday noon.`;
    show(0);
    lazy($("#growSurface"), () => { surf.play(); setTimeout(play, 2600); });
  }

  function bagging() {
    const box = $("#bagging");
    const sample = R.dataset.records.slice(0, 40).map((r) => r["Clicked on Ad"]);
    const featNames = ["Time on site", "Age", "Area income", "Internet usage", "Male", "Hour", "Day of week", "Month", "Site share"];
    const votes = R.scratch.example.tree_probs.slice(0, 5).map((p) => (p >= 0.5 ? 1 : 0));
    // deterministic pseudo-random so the replay looks the same
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    box.innerHTML = `
      <div class="bag-col"><h4>Training rows</h4><div class="bag-data">${sample.map((y) => `<span class="bag-dot" style="background:${y ? C.c1 : C.c0}"></span>`).join("")}</div>
        <p class="small muted" style="margin-top:12px">Each tree draws rows <b>with replacement</b>. Some rows repeat, ~37% are left out (its out-of-bag set).</p></div>
      <div class="bag-col"><h4>Five of the trees</h4><div class="bag-trees">${votes.map((_, i) => `
        <div class="bag-tree" data-i="${i}"><span class="mono small">Tree ${i + 1}</span><div class="bag-sample"></div><span class="bag-vote"></span>
        <div class="bag-feats"></div></div>`).join("")}</div></div>
      <div class="bag-col bag-result"><h4>Majority vote</h4><div class="bag-final" id="bagFinal">—</div><div class="bag-final-sub" id="bagSub">waiting for trees</div>
        <div class="bag-tally">${votes.map(() => "<i></i>").join("")}</div></div>`;

    const dots = $$(".bag-dot", box);
    let timers = [];
    function run() {
      timers.forEach(clearTimeout); timers = [];
      seed = 7;
      $$(".bag-tree", box).forEach((t) => { t.classList.remove("on"); $(".bag-sample", t).classList.remove("fill"); $(".bag-sample", t).innerHTML = ""; $(".bag-vote", t).classList.remove("show"); $(".bag-feats", t).textContent = ""; });
      $$(".bag-tally i", box).forEach((i) => (i.style.background = ""));
      $("#bagFinal").textContent = "—"; $("#bagSub").textContent = "waiting for trees";
      dots.forEach((d) => d.classList.remove("pick", "out"));
      let clicks = 0;
      votes.forEach((v, i) => {
        timers.push(setTimeout(() => {
          const picks = Array.from({ length: 22 }, () => Math.floor(rnd() * dots.length));
          const set = new Set(picks);
          dots.forEach((d, j) => { d.classList.toggle("pick", set.has(j)); d.classList.toggle("out", !set.has(j)); });
          const row = $$(".bag-tree", box)[i];
          row.classList.add("on");
          const s = $(".bag-sample", row);
          s.innerHTML = picks.map((p) => `<i style="background:${sample[p] ? C.c1 : C.c0}"></i>`).join("");
          requestAnimationFrame(() => s.classList.add("fill"));
          const fs = [...featNames].sort(() => rnd() - 0.5).slice(0, 3);
          $(".bag-feats", row).textContent = "splits on: " + fs.join(", ");
          timers.push(setTimeout(() => {
            const chip = $(".bag-vote", row);
            chip.textContent = v ? "Click" : "No";
            chip.style.background = v ? C.c1 : C.c0;
            chip.classList.add("show");
            $$(".bag-tally i", box)[i].style.background = v ? C.c1 : C.c0;
            clicks += v;
          }, 650));
        }, i * 1100));
      });
      timers.push(setTimeout(() => {
        dots.forEach((d) => d.classList.remove("pick", "out"));
        const win = clicks * 2 > votes.length;
        $("#bagFinal").textContent = win ? "Click" : "No click";
        $("#bagFinal").style.color = win ? C.c1 : C.c0;
        $("#bagSub").textContent = `${win ? clicks : votes.length - clicks} of ${votes.length} trees agree`;
      }, votes.length * 1100 + 500));
    }
    lazy(box, run);
    $("#replayBag").addEventListener("click", run);
  }

  function tree() {
    const T = R.tree;
    $("#treeMeta").textContent = `full depth ${T.depth} · ${T.leaves} leaves · 1 of ${T.n_trees}`;
    const svg = $("#treeSvg");
    const W = 1120, H = 380, nw = 128, nh = 60, levels = 4, vgap = (H - nh - 20) / (levels - 1);
    const nodes = [], edges = [];
    (function place(n, depth, lo, hi, parent, side) {
      const x = (lo + hi) / 2, y = 10 + depth * vgap;
      const me = { n, x, y, depth };
      nodes.push(me);
      if (parent) edges.push({ a: parent, b: me, side });
      if (n.left) {
        place(n.left, depth + 1, lo, x, me, "yes");
        place(n.right, depth + 1, x, hi, me, "no");
      }
    })(T.root, 0, 0, W, null, null);

    const fmtThr = (f, t) => f === "Area Income" ? money(t) : f === "Male" ? "0.5" : f === "Site Share" ? t.toFixed(2) : t;
    let html = "";
    edges.forEach((e, i) => {
      const x1 = e.a.x, y1 = e.a.y + nh, x2 = e.b.x, y2 = e.b.y, my = (y1 + y2) / 2;
      // each branch draws after its parent node has appeared
      html += `<path class="edge" pathLength="1" style="transition-delay:${(e.b.depth - 1) * 0.55 + 0.2}s" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
      if (e.a.depth === 0) html += `<text class="elabel" style="transition-delay:.5s" x="${(x1 + x2) / 2 + (e.side === "yes" ? -14 : 14)}" y="${my}" text-anchor="middle">${e.side === "yes" ? "true" : "false"}</text>`;
    });
    nodes.forEach((d) => {
      const n = d.n, x = d.x - nw / 2;
      const rule = n.feature ? `${SHORT[n.feature]} ≤ ${fmtThr(n.feature, n.threshold)}` : n.leaf ? `Leaf → ${n.p_click >= 0.5 ? "Click" : "No click"}` : "subtree continues…";
      const bw = nw - 20;
      html += `<g class="node" style="transition-delay:${d.depth * 0.55}s" data-tip="${esc(`${rule}|${n.samples}|${n.p_click}|${n.impurity}`)}">
        <rect class="box" x="${x}" y="${d.y}" width="${nw}" height="${nh}" rx="6"/>
        <text class="rule" x="${d.x}" y="${d.y + 19}" text-anchor="middle">${esc(rule)}</text>
        <text class="meta" x="${d.x}" y="${d.y + 35}" text-anchor="middle">n=${n.samples} · P=${n.p_click.toFixed(2)}</text>
        <rect x="${x + 10}" y="${d.y + 44}" width="${bw}" height="6" rx="2" fill="${C.c0}"/>
        <rect x="${x + 10}" y="${d.y + 44}" width="${Math.max(0, bw * n.p_click)}" height="6" rx="2" fill="${C.c1}"/>
      </g>`;
    });
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = html;
    lazy(svg, () => svg.classList.add("show"));
    svg.addEventListener("mousemove", (e) => {
      const g = e.target.closest(".node");
      if (!g) return hideTip();
      const [rule, n, p, imp] = g.dataset.tip.split("|");
      showTip(e, `<div class="t-head">${rule}</div>Samples: ${n}<br>P(click): ${(+p).toFixed(3)}<br>Impurity: ${(+imp).toFixed(3)}`);
    });
    svg.addEventListener("mouseleave", hideTip);
  }

  /* ------------------------------------------------------------------ */
  /* 06 tuning                                                           */
  /* ------------------------------------------------------------------ */
  function tuning() {
    const T = R.tuning;
    $("#tuneLede").textContent = `Randomized search sampled ${T.n_iter} configurations and scored each with ${T.folds}-fold stratified cross-validation (${T.fits} fits, ${Math.round(T.seconds)} s). ROC-AUC was the selection metric: it rewards good ranking at every threshold and is less jumpy than accuracy on 150-row folds.`;
    const bp = T.best_params;
    $("#spaceTable").innerHTML = `<thead><tr><th>Parameter</th><th>Range sampled</th><th class="num">Chosen</th></tr></thead>
      <tbody>${Object.entries(T.space).map(([k, s]) => `<tr><td class="mono small">${k}</td><td class="small">${s}</td><td class="num"><b>${bp[k] === null ? "None" : bp[k]}</b></td></tr>`).join("")}</tbody>`;
    $("#bestAuc").textContent = `CV AUC ${T.best_cv.auc.toFixed(4)}`;
    $("#bestParams").innerHTML = Object.entries(bp).map(([k, v]) => `<div class="param"><span>${k}</span><b>${v === null ? "None" : v}</b></div>`).join("");
    const def = R.comparison.models.find((m) => m.model === "Random Forest (default)");
    const tuned = R.comparison.models.find((m) => m.model === "Random Forest (tuned)");
    $("#bestNote").innerHTML = `The search picked a <b>regularised</b> forest: depth capped at ${bp.max_depth} and at least ${bp.min_samples_leaf} rows per leaf.
      Training accuracy falls from ${pct(def.train_acc)} (default, fully grown trees) to ${pct(tuned.train_acc)}, while CV accuracy stays at ${pct(T.best_cv.acc)}. Less memorisation, same generalisation.`;

    make("oobChart", {
      type: "line",
      data: { datasets: [{ label: "OOB error", data: T.oob_curve.map((p) => ({ x: p[0], y: p[1] })), borderColor: C.accent, backgroundColor: C.accent, pointRadius: 3, pointBackgroundColor: C.accent }] },
      options: {
        parsing: false,
        scales: { x: axis({ type: "linear", min: 0, title: { text: "Number of trees" } }), y: axis({ ticks: { callback: (v) => pct(v, 1), color: C.muted, font: { size: 11 } } }) },
        plugins: { tooltip: { displayColors: false, callbacks: { title: (it) => `${it[0].parsed.x} trees`, label: (it) => `OOB error ${pct(it.parsed.y, 2)}` } } },
      },
    });

    const notes = {
      depth_curve: "Shallow trees underfit (depth 1–3). Beyond depth ≈ 5 the CV score plateaus while training accuracy keeps rising: the extra depth only memorises.",
      features_curve: "Fewer features per split decorrelates trees. With 9 inputs, 2–4 candidates per split (≈ √9 = 3) sits at or near the best CV score.",
      leaf_curve: "Larger leaves smooth predictions. Small values let trees memorise; very large ones (30–50) start to underfit.",
    };
    let vc;
    const vcData = (k) => ({
      labels: T[k].map((d) => String(d.value)),
      datasets: [
        { label: "Cross-validation", data: T[k].map((d) => d.cv), borderColor: C.accent, backgroundColor: C.accent, pointRadius: 3, pointBackgroundColor: C.accent },
        { label: "Training", data: T[k].map((d) => d.train), borderColor: C.s3, backgroundColor: C.s3, borderDash: [5, 4], pointRadius: 3, pointBackgroundColor: C.s3 },
      ],
    });
    const vcTitles = { depth_curve: "max_depth", features_curve: "max_features", leaf_curve: "min_samples_leaf" };
    let vcKey = "depth_curve";
    $("#vcNote").textContent = notes[vcKey];
    make("vcChart", {
      type: "line", data: vcData(vcKey),
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: axis({ grid: { display: false }, title: { text: vcTitles[vcKey] } }), y: axis({ ticks: { callback: (v) => pct(v, 0), color: C.muted, font: { size: 11 } } }) },
        plugins: { tooltip: { callbacks: { label: (it) => ` ${it.dataset.label}: ${pct(it.parsed.y)}` } } },
      },
    }).then((c) => (vc = c));
    $("#vcTabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#vcTabs button").forEach((x) => x.classList.toggle("on", x === b));
      vcKey = b.dataset.k;
      $("#vcNote").textContent = notes[vcKey];
      if (!vc) return;
      vc.data = vcData(vcKey);
      vc.options.scales.x.title.text = vcTitles[vcKey];
      vc.update();
      CF.replay(vc);
    });

    make("lcChart", {
      type: "line",
      data: {
        labels: T.learning_curve.map((d) => d.size),
        datasets: [
          { label: "Cross-validation", data: T.learning_curve.map((d) => d.cv), borderColor: C.accent, backgroundColor: C.accent, pointRadius: 3, pointBackgroundColor: C.accent },
          { label: "Training", data: T.learning_curve.map((d) => d.train), borderColor: C.s3, backgroundColor: C.s3, borderDash: [5, 4], pointRadius: 3, pointBackgroundColor: C.s3 },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: { x: axis({ grid: { display: false }, title: { text: "Training rows" } }), y: axis({ ticks: { callback: (v) => pct(v, 0), color: C.muted, font: { size: 11 } } }) },
        plugins: { tooltip: { callbacks: { title: (it) => `${it[0].label} training rows`, label: (it) => ` ${it.dataset.label}: ${pct(it.parsed.y)}` } } },
      },
    });

    const fmtv = (v) => (v === null ? "None" : v === true ? "yes" : v === false ? "no" : v);
    $("#trialsTable").innerHTML = `<thead><tr><th class="num">#</th><th class="num">trees</th><th class="num">depth</th><th>features</th><th class="num">leaf</th><th>boot</th><th>crit.</th><th class="num">CV AUC</th><th class="num">CV acc</th></tr></thead>
      <tbody>${T.trials.slice(0, 8).map((t, i) => `<tr class="${i === 0 ? "hl" : ""}"><td class="num">${t.rank}</td><td class="num">${t.params.n_estimators}</td><td class="num">${fmtv(t.params.max_depth)}</td>
        <td class="mono small">${fmtv(t.params.max_features)}</td><td class="num">${t.params.min_samples_leaf}</td><td class="small">${fmtv(t.params.bootstrap)}</td><td class="small">${t.params.criterion}</td>
        <td class="num">${t.auc.toFixed(4)}</td><td class="num">${pct(t.acc)}</td></tr>`).join("")}</tbody>`;
  }

  /* ------------------------------------------------------------------ */
  /* 07 evaluation                                                       */
  /* ------------------------------------------------------------------ */
  function evaluation() {
    const E = R.evaluation;
    const { y, p } = E.test;
    $("#aucChip").textContent = `AUC ${E.metrics.roc_auc.toFixed(3)}`;
    $("#prChip").textContent = `AP ${E.pr_auc.toFixed(3)}`;

    function at(thr) {
      let tp = 0, fp = 0, tn = 0, fn = 0;
      p.forEach((pi, i) => {
        const hat = pi >= thr ? 1 : 0;
        if (hat && y[i]) tp++; else if (hat) fp++; else if (y[i]) fn++; else tn++;
      });
      const n = tp + fp + tn + fn;
      const acc = (tp + tn) / n, prec = tp + fp ? tp / (tp + fp) : 0, rec = tp / (tp + fn), spec = tn / (tn + fp);
      const f1 = prec + rec ? (2 * prec * rec) / (prec + rec) : 0;
      return { tp, fp, tn, fn, n, acc, prec, rec, spec, f1 };
    }

    let roc, prc;
    function render(thr) {
      const m = at(thr);
      $("#thrOut").textContent = thr.toFixed(2);
      CM_CELLS.forEach(([k, , sub, ok]) => {
        const n = m[k], share = n / m.n;
        const el = $(`.cm-cell[data-k="${k}"]`);
        el.style.background = ok ? alpha(C.accent, 0.1 + share * 1.2) : alpha("#A94438", n ? 0.1 + share * 3 : 0.04);
        el.style.color = ok && share > 0.35 ? "#fff" : C.ink;
        tweenNum($(".cm-n", el), n, Math.round);
        $(".cm-p", el).textContent = `${sub} · ${pct(share)}`;
      });

      const fr = (a, b) => `<span class="fr"><span>${a}</span><span>${b}</span></span>`;
      [
        `(TP + TN) / N = ${fr(`${m.tp} + ${m.tn}`, m.n)}`,
        `TP / (TP + FP) = ${fr(m.tp, `${m.tp} + ${m.fp}`)}`,
        `TP / (TP + FN) = ${fr(m.tp, `${m.tp} + ${m.fn}`)}`,
        `TN / (TN + FP) = ${fr(m.tn, `${m.tn} + ${m.fp}`)}`,
        `2PR / (P + R) = ${fr(`2 × ${m.prec.toFixed(3)} × ${m.rec.toFixed(3)}`, `${m.prec.toFixed(3)} + ${m.rec.toFixed(3)}`)}`,
      ].forEach((f, i) => {
        const row = $$("#calc .calc-row")[i];
        $(".calc-f", row).innerHTML = f;
        tweenNum($(".calc-v", row), [m.acc, m.prec, m.rec, m.spec, m.f1][i], (x) => x.toFixed(3));
      });

      if (roc) { roc.data.datasets[2].data = [{ x: 1 - m.spec, y: m.rec }]; roc.update("none"); }
      if (prc) { prc.data.datasets[2].data = [{ x: m.rec, y: m.prec }]; prc.update("none"); }
    }
    // build the matrix and formula rows once; render() only updates values
    const CM_CELLS = [["tn", "True negative", "TN", true], ["fp", "False positive", "FP", false],
                      ["fn", "False negative", "FN", false], ["tp", "True positive", "TP", true]];
    const cellHtml = ([k, title]) => `<div class="cm-cell" data-k="${k}"><span class="cm-t">${title}</span><span class="cm-n">0</span><span class="cm-p"></span></div>`;
    $("#cm").innerHTML = `<div></div><div class="cm-h">Predicted: no click</div><div class="cm-h">Predicted: click</div>
      <div class="cm-r">Actual:<br>no click</div>${cellHtml(CM_CELLS[0])}${cellHtml(CM_CELLS[1])}
      <div class="cm-r">Actual:<br>click</div>${cellHtml(CM_CELLS[2])}${cellHtml(CM_CELLS[3])}`;
    $("#calc").innerHTML = ["Accuracy", "Precision", "Recall", "Specificity", "F1 score"]
      .map((n) => `<div class="calc-row"><span class="calc-name">${n}</span><span class="calc-f"></span><span class="calc-v">0.000</span></div>`).join("");

    const thr = $("#thr");
    thr.addEventListener("input", () => render(+thr.value));
    $("#thrReset").addEventListener("click", () => { thr.value = 0.5; render(0.5); });
    render(0.5);

    const pt = (arr) => arr.map(([a, b]) => ({ x: a, y: b }));
    const m0 = at(0.5);
    const curveOpts = (xt, yt) => ({
      parsing: false,
      interaction: { mode: "nearest", intersect: false },
      clip: false,
      scales: { x: axis({ type: "linear", min: 0, max: 1, title: { text: xt } }), y: axis({ min: 0, max: 1, title: { text: yt }, ticks: { callback: (v) => v.toFixed(1), color: C.muted, font: { size: 11 } } }) },
      plugins: { tooltip: { filter: (it) => it.datasetIndex !== 1, displayColors: false,
        callbacks: { label: (it) => it.datasetIndex === 2 ? `Threshold ${(+thr.value).toFixed(2)}: (${it.parsed.x.toFixed(3)}, ${it.parsed.y.toFixed(3)})` : `(${it.parsed.x.toFixed(3)}, ${it.parsed.y.toFixed(3)})` } } },
    });
    const marker = (x, y) => ({ label: "Current threshold", data: [{ x, y }], showLine: false, pointRadius: 6, pointHoverRadius: 7, pointBackgroundColor: C.c1, pointBorderColor: C.surface, pointBorderWidth: 2 });
    make("rocChart", {
      type: "line",
      data: { datasets: [
        { label: "ROC", data: pt(E.roc), borderColor: C.accent, backgroundColor: alpha(C.accent, 0.08), fill: true, tension: 0, stepped: false },
        { label: "Chance", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: C.muted, borderDash: [4, 4], borderWidth: 1, pointHoverRadius: 0 },
        marker(1 - m0.spec, m0.rec),
      ] },
      options: curveOpts("False positive rate", "True positive rate"),
    }).then((c) => { roc = c; render(+thr.value); });
    make("prChart", {
      type: "line",
      data: { datasets: [
        { label: "PR", data: pt(E.pr), borderColor: C.accent, backgroundColor: alpha(C.accent, 0.08), fill: true, tension: 0 },
        { label: "Baseline", data: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }], borderColor: C.muted, borderDash: [4, 4], borderWidth: 1, pointHoverRadius: 0 },
        marker(m0.rec, m0.prec),
      ] },
      options: curveOpts("Recall", "Precision"),
    }).then((c) => { prc = c; render(+thr.value); });

    // importance
    const I = R.importance;
    const sets = {
      perm: { labels: I.permutation.map((d) => SHORT[d.feature]), data: I.permutation.map((d) => d.mean), std: I.permutation.map((d) => d.std),
        note: "Drop in test ROC-AUC when one raw column is shuffled (30 repeats). Timestamp covers hour, day and month together. Internet usage and time on site dominate; Male and Timestamp are effectively zero." },
      mdi: { labels: I.mdi.map((d) => SHORT[d.feature]), data: I.mdi.map((d) => d.value),
        note: "Mean decrease in impurity across all splits of all trees. Same top two as permutation, but MDI gives some weight to low-signal features like Hour, because high-cardinality features get more chances to split." },
    };
    let imp;
    $("#impNote").textContent = sets.perm.note;
    make("impChart", {
      type: "bar",
      data: { labels: sets.perm.labels, datasets: [{ data: sets.perm.data, backgroundColor: C.accent, borderSkipped: "left", maxBarThickness: 22 }] },
      options: {
        indexAxis: "y",
        scales: { x: axis(), y: axis({ grid: { display: false }, ticks: { color: C.ink2, font: { size: 12 } } }) },
        plugins: { tooltip: { displayColors: false, callbacks: { label: (it) => {
          const k = $("#impTabs .on").dataset.k;
          return k === "perm" ? `ΔAUC ${it.parsed.x.toFixed(4)} ± ${sets.perm.std[it.dataIndex].toFixed(4)}` : `Importance ${pct(it.parsed.x)}`;
        } } } },
      },
    }).then((c) => (imp = c));
    $("#impTabs").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      $$("#impTabs button").forEach((x) => x.classList.toggle("on", x === b));
      const s = sets[b.dataset.k];
      $("#impNote").textContent = s.note;
      if (!imp) return;
      imp.data.labels = s.labels;
      imp.data.datasets[0].data = s.data;
      imp.update();
    });

    // partial dependence
    const pdpCols = Object.keys(R.pdp);
    let pdp;
    const pdpData = (col) => R.pdp[col].map(([a, b]) => ({ x: a, y: b }));
    make("pdpChart", {
      type: "line",
      data: { datasets: [{ label: "P(click)", data: pdpData(pdpCols[0]), borderColor: C.c1, backgroundColor: C.c1, pointRadius: 0, tension: 0.3 },
        { label: "threshold", data: [], borderColor: C.muted, borderDash: [4, 4], borderWidth: 1, pointHoverRadius: 0 }] },
      options: {
        parsing: false,
        scales: { x: axis({ type: "linear", title: { text: pdpCols[0] } }), y: axis({ min: 0, max: 1, title: { text: "Average P(click)" } }) },
        plugins: { tooltip: { filter: (it) => it.datasetIndex === 0, displayColors: false,
          callbacks: { title: (it) => `${SHORT[pdpCols[curPdp]]} = ${it[0].parsed.x}`, label: (it) => `Avg P(click) ${it.parsed.y.toFixed(3)}` } } },
      },
    }).then((c) => { pdp = c; setPdp(0); });
    let curPdp = 0;
    function setPdp(i) {
      curPdp = i;
      if (!pdp) return;
      const d = pdpData(pdpCols[i]);
      pdp.data.datasets[0].data = d;
      pdp.data.datasets[1].data = [{ x: d[0].x, y: 0.5 }, { x: d[d.length - 1].x, y: 0.5 }];
      pdp.options.scales.x.title.text = pdpCols[i] + (UNIT[pdpCols[i]] ? ` (${UNIT[pdpCols[i]]})` : "");
      pdp.update();
      CF.replay(pdp);
    }
    segmented($("#pdpTabs"), pdpCols.map((c) => SHORT[c]), setPdp);

    // folds
    const F = E.folds;
    const keys = ["accuracy", "precision", "recall", "f1", "roc_auc"];
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
    $("#foldTable").innerHTML = `<thead><tr><th>Fold</th>${keys.map((k) => `<th class="num">${k === "roc_auc" ? "AUC" : k[0].toUpperCase() + k.slice(1)}</th>`).join("")}</tr></thead>
      <tbody>${F.accuracy.map((_, i) => `<tr><td>${i + 1}</td>${keys.map((k) => `<td class="num">${F[k][i].toFixed(3)}</td>`).join("")}</tr>`).join("")}
      <tr class="hl"><td><b>Mean ± sd</b></td>${keys.map((k) => `<td class="num"><b>${mean(F[k]).toFixed(3)}</b> <span class="muted">± ${sd(F[k]).toFixed(3)}</span></td>`).join("")}</tr></tbody>`;

    // misclassified
    $("#missCount").textContent = `${E.misclassified.length} of 250`;
    $("#missTable").innerHTML = `<thead><tr><th class="num">Site</th><th class="num">Online</th><th class="num">Age</th><th class="num">Income</th><th>Actual</th><th class="num">P(click)</th></tr></thead>
      <tbody>${E.misclassified.sort((a, b) => Math.abs(a.prob - 0.5) - Math.abs(b.prob - 0.5)).map((m) => `<tr>
        <td class="num">${m.time}</td><td class="num">${m.usage}</td><td class="num">${m.age}</td><td class="num">${money(m.income)}</td>
        <td><i class="dot" style="background:${m.truth ? C.c1 : C.c0}"></i>${m.truth ? "Click" : "No click"}</td><td class="num">${m.prob.toFixed(3)}</td></tr>`).join("")}</tbody>`;
  }

  /* ------------------------------------------------------------------ */
  /* 08 comparison                                                       */
  /* ------------------------------------------------------------------ */
  function comparison() {
    const M = [...R.comparison.models].sort((a, b) => b.accuracy - a.accuracy);
    const REF = "Random Forest (tuned)";
    const lo = Math.floor(Math.min(...M.map((m) => m.ci[0])) * 50) / 50;
    const hi = 1;
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    const ref = M.find((m) => m.model === REF);
    const ticks = [];
    for (let t = lo; t <= hi + 1e-9; t += 0.02) ticks.push(t);

    const plot = $("#ciPlot");
    plot.innerHTML = M.map((m, k) => `
      <div class="ci-row ${m.model === REF ? "ref" : ""}" style="--k:${k}" data-m="${esc(m.model)}">
        <span class="ci-name">${esc(m.model)}</span>
        <div class="ci-track">
          <div class="ci-ref-line" style="left:${x(ref.accuracy)}%"></div>
          <div class="ci-bar" style="left:${x(m.ci[0])}%;width:${x(m.ci[1]) - x(m.ci[0])}%"></div>
          <div class="ci-pt" style="left:${x(m.accuracy)}%"></div>
        </div>
        <span class="ci-val">${pct(m.accuracy)}</span>
      </div>`).join("") +
      `<div class="ci-axis"><span></span><div class="ci-ticks">${ticks.map((t) => `<span style="left:${x(t)}%">${pct(t, 0)}</span>`).join("")}</div><span></span></div>`;
    lazy(plot, () => plot.classList.add("show"));
    plot.addEventListener("mousemove", (e) => {
      const row = e.target.closest(".ci-row");
      if (!row) return hideTip();
      const m = M.find((k) => k.model === row.dataset.m);
      const mc = m.model === REF ? "Reference model" :
        `McNemar vs forest: p = ${m.mcnemar.p.toFixed(3)}<br>Forest right / this wrong: ${m.mcnemar.rf_only}<br>This right / forest wrong: ${m.mcnemar.other_only}`;
      showTip(e, `<div class="t-head">${esc(m.model)}</div>Accuracy ${pct(m.accuracy)}<br>95% CI ${pct(m.ci[0])} – ${pct(m.ci[1])}<br>${mc}`);
    });
    plot.addEventListener("mouseleave", hideTip);

    // sortable scorecard
    const cols = [
      ["model", "Model", (m) => esc(m.model)], ["family", "Family", (m) => `<span class="small muted">${m.family}</span>`],
      ["accuracy", "Accuracy", (m) => pct(m.accuracy)], ["precision", "Precision", (m) => pct(m.precision)],
      ["recall", "Recall", (m) => pct(m.recall)], ["f1", "F1", (m) => f3(m.f1)], ["roc_auc", "AUC", (m) => f3(m.roc_auc)],
      ["cv_mean", "CV acc", (m) => (m.cv_mean == null ? "—" : `${pct(m.cv_mean)} <span class="muted">±${(m.cv_std * 100).toFixed(1)}</span>`)],
      ["gap", "Train − test", (m) => `${((m.train_acc - m.accuracy) * 100).toFixed(1)} pt`],
      ["p", "McNemar p", (m) => (m.model === REF ? "—" : m.mcnemar.p.toFixed(3))],
      ["seconds", "Time", (m) => m.seconds + " s"],
    ];
    const val = (m, k) => (k === "gap" ? m.train_acc - m.accuracy : k === "p" ? (m.model === REF ? 2 : m.mcnemar.p) : m[k] ?? -1);
    let sortK = "roc_auc", asc = false;
    const table = $("#cmpTable");
    function draw() {
      const rows = [...R.comparison.models].sort((a, b) => {
        const A = val(a, sortK), B = val(b, sortK);
        return (typeof A === "string" ? A.localeCompare(B) : A - B) * (asc ? 1 : -1);
      });
      table.innerHTML = `<thead><tr>${cols.map(([k, l]) => `<th data-k="${k}" class="${k === sortK ? "sorted" + (asc ? " asc" : "") : ""} ${["model", "family"].includes(k) ? "" : "num"}">${l}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((m) => `<tr class="${m.model === REF ? "hl" : ""}">${cols.map(([k, , f]) => `<td class="${["model", "family"].includes(k) ? "" : "num"}">${f(m)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    }
    table.addEventListener("click", (e) => {
      const th = e.target.closest("th"); if (!th) return;
      if (sortK === th.dataset.k) asc = !asc; else { sortK = th.dataset.k; asc = ["model", "family", "gap", "p", "seconds"].includes(sortK); }
      draw();
    });
    draw();

    // ROC overlay
    const O = R.comparison.roc_overlay;
    const name = (s) => Object.keys(O).find((k) => k.startsWith(s));
    const ds = [
      [name("Random Forest"), C.accent, []], [name("Logistic"), C.s2, []], [name("Decision Tree"), C.s3, [5, 4]],
    ].map(([k, col, dash]) => ({ label: k, data: O[k].map(([a, b]) => ({ x: a, y: b })), borderColor: col, backgroundColor: col, borderDash: dash, tension: 0 }));
    make("roc3Chart", {
      type: "line",
      data: { datasets: [...ds, { label: "Chance", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }], borderColor: C.muted, borderDash: [3, 4], borderWidth: 1, pointHoverRadius: 0 }] },
      options: {
        parsing: false,
        interaction: { mode: "nearest", intersect: false },
        scales: { x: axis({ type: "linear", min: 0, max: 0.5, title: { text: "False positive rate (zoomed to 0–0.5)" } }), y: axis({ min: 0.5, max: 1.005, title: { text: "True positive rate" }, ticks: { callback: (v) => (v > 1 ? "" : v.toFixed(1)), color: C.muted, font: { size: 11 } } }) },
        plugins: { tooltip: { filter: (it) => it.datasetIndex < 3, callbacks: { label: (it) => ` ${it.dataset.label}: FPR ${it.parsed.x.toFixed(3)}, TPR ${it.parsed.y.toFixed(3)}` } } },
      },
    });

    const by = (s) => R.comparison.models.find((m) => m.model.startsWith(s));
    const lr = by("Logistic"), rf = by("Random Forest (tuned)"), dt = by("Decision Tree"), gb = by("Gradient"), ada = by("AdaBoost"), def = by("Random Forest (default)");
    const pmin = Math.min(...R.comparison.models.filter((m) => m.model !== REF).map((m) => m.mcnemar.p));
    $("#cmpText").innerHTML = `
      <p><b>The top models are statistically tied.</b> Logistic Regression scores highest (${pct(lr.accuracy)}) and the forest scores ${pct(rf.accuracy)}, a gap of ${Math.round((lr.accuracy - rf.accuracy) * 250)} rows out of 250.
      Every model's confidence interval overlaps the forest's, and the smallest McNemar p-value is ${pmin.toFixed(3)}, far above 0.05.</p>
      <p><b>Why a linear model does so well here.</b> The scatter plot shows the classes split along a nearly straight diagonal in time-on-site × internet-usage space. A linear boundary is exactly the right shape. A forest builds that diagonal from many axis-aligned steps, which costs a few rows near the edge.</p>
      <p><b>Why the forest is still the stronger tool.</b> It beats a single tree on ranking (AUC ${f3(rf.roc_auc)} vs ${f3(dt.roc_auc)}) because averaging ${R.tuning.best_params.n_estimators} de-correlated trees cancels out individual-tree variance. It needs no scaling, captures interactions automatically, and gives OOB error and feature importance at no extra cost.</p>
      <p><b>Bagging vs. boosting.</b> Gradient Boosting (${pct(gb.accuracy)}) and AdaBoost (${pct(ada.accuracy)}) focus on the hardest rows. Here those rows are mostly noise near the boundary, so the extra focus does not help.</p>
      <p><b>Tuning paid off in robustness, not raw accuracy.</b> The default forest reaches ${pct(def.train_acc)} training accuracy; the tuned one ${pct(rf.train_acc)} with the same test performance and higher AUC. A smaller train–test gap means more trust on new traffic.</p>`;
  }

  /* ------------------------------------------------------------------ */
  /* 09 predictor                                                        */
  /* ------------------------------------------------------------------ */
  function predictor() {
    const Rg = R.predictor.ranges;
    const state = {
      "Daily Time Spent on Site": Rg["Daily Time Spent on Site"].median, "Daily Internet Usage": Rg["Daily Internet Usage"].median,
      "Age": Math.round(Rg.Age.median), "Area Income": Math.round(Rg["Area Income"].median),
      "Male": 0, "Hour": 14, "Day of Week": 2, "Month": 4,
    };
    const sliders = [
      ["Daily Time Spent on Site", 0.5, (v) => `${(+v).toFixed(1)} min`],
      ["Daily Internet Usage", 0.5, (v) => `${(+v).toFixed(1)} min`],
      ["Age", 1, (v) => `${v} yrs`],
      ["Area Income", 500, (v) => money(v)],
    ];
    const form = $("#predictForm");
    form.innerHTML = sliders.map(([k, step, f]) => `
      <div class="field">
        <div class="field-top"><label for="f-${k}">${k}</label><output data-for="${k}">${f(state[k])}</output></div>
        <input type="range" id="f-${k}" name="${k}" min="${Math.floor(Rg[k].min)}" max="${Math.ceil(Rg[k].max)}" step="${step}" value="${state[k]}">
        <div class="field-hint"><span>${f(Math.floor(Rg[k].min))}</span><span>median ${f(Rg[k].median)}</span><span>${f(Math.ceil(Rg[k].max))}</span></div>
      </div>`).join("") + `
      <div class="field-row">
        <div class="field"><label class="small" for="f-Male">Gender</label><select class="select" id="f-Male" name="Male"><option value="0">Female</option><option value="1">Male</option></select></div>
        <div class="field"><label class="small" for="f-Hour">Hour shown</label><select class="select" id="f-Hour" name="Hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === state.Hour ? "selected" : ""}>${String(h).padStart(2, "0")}:00</option>`).join("")}</select></div>
        <div class="field"><label class="small" for="f-Day">Day</label><select class="select" id="f-Day" name="Day of Week">${DAYS.map((d, i) => `<option value="${i}" ${i === state["Day of Week"] ? "selected" : ""}>${d}</option>`).join("")}</select></div>
      </div>
      <div class="field-row">
        <div class="field"><label class="small" for="f-Month">Month (training range)</label><select class="select" id="f-Month" name="Month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${i + 1 === state.Month ? "selected" : ""}>${m}</option>`).join("")}</select></div>
      </div>`;

    const fmt = Object.fromEntries(sliders.map(([k, , f]) => [k, f]));
    const presets = {
      "Likely clicker": { "Daily Time Spent on Site": 44, "Daily Internet Usage": 128, "Age": 47, "Area Income": 38500, "Male": 0 },
      "Unlikely clicker": { "Daily Time Spent on Site": 82, "Daily Internet Usage": 236, "Age": 28, "Area Income": 66000, "Male": 1 },
      "Borderline": { "Daily Time Spent on Site": 62, "Daily Internet Usage": 180, "Age": 36, "Area Income": 52000, "Male": 0 },
    };
    $("#presets").innerHTML = Object.keys(presets).map((p) => `<button type="button" class="btn ghost small" data-p="${p}">${p}</button>`).join("");
    $("#presets").addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      Object.entries(presets[b.dataset.p]).forEach(([k, v]) => {
        state[k] = v;
        const inp = form.elements[k];
        inp.value = v;
        const out = $(`output[data-for="${k}"]`); if (out) out.textContent = fmt[k](v);
      });
      schedule();
    });

    form.addEventListener("input", (e) => {
      const t = e.target;
      state[t.name] = +t.value;
      const out = $(`output[data-for="${t.name}"]`);
      if (out) out.textContent = fmt[t.name](t.value);
      schedule();
    });

    let timer, ctrl, lastProb = 0, whatif = null, wiChart, wiCol = 0;
    const wiCols = sliders.map((s) => s[0]);
    function schedule() { clearTimeout(timer); timer = setTimeout(run, 120); }

    async function run() {
      if (ctrl) ctrl.abort();
      ctrl = new AbortController();
      $("#result").classList.add("busy");
      try {
        const res = await fetch("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state), signal: ctrl.signal });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Prediction failed");
        show(d);
      } catch (err) {
        if (err.name !== "AbortError") $("#verdict").textContent = err.message;
      } finally {
        $("#result").classList.remove("busy");
      }
    }

    function show(d) {
      const from = lastProb, to = d.probability, start = performance.now();
      const probEl = $("#prob");
      (function tick(now) {
        const t = Math.min(1, (now - start) / 500), e = 1 - Math.pow(1 - t, 3);
        probEl.textContent = pct(from + (to - from) * e);
        if (t < 1) requestAnimationFrame(tick);
      })(start);
      lastProb = to;
      const click = d.label === 1;
      const v = $("#verdict");
      v.textContent = click ? "Likely to click" : "Unlikely to click";
      v.className = "verdict " + (click ? "v1" : "v0");
      const arc = $("#gVal");
      arc.style.strokeDashoffset = 100 - to * 100;
      arc.style.stroke = click ? C.c1 : C.c0;
      $("#gNeedle").style.transform = `rotate(${-90 + to * 180}deg)`;
      const n = d.tree_probs.length, agree = Math.max(d.trees_for_click, n - d.trees_for_click);
      $("#resultStats").innerHTML = `
        <div class="rs"><span>Trees voting click</span><b>${d.trees_for_click} / ${n}</b></div>
        <div class="rs"><span>Forest agreement</span><b>${pct(agree / n, 0)}</b></div>
        <div class="rs"><span>Site share</span><b>${d.site_share.toFixed(3)}</b></div>`;
      $("#voteCount").textContent = `${d.trees_for_click} click · ${n - d.trees_for_click} no click`;

      const grid = $("#votes");
      if (grid.children.length !== n) {
        grid.innerHTML = d.tree_probs.map((p, i) => `<i style="--i:${i}"></i>`).join("");
      }
      [...grid.children].forEach((cell, i) => {
        const p = d.tree_probs[i];
        cell.className = (p >= 0.5 ? "v1" : "v0") + (Math.abs(p - 0.5) < 0.15 ? " weak" : "");
        cell.title = `Tree ${i + 1}: P(click) = ${p.toFixed(2)}`;
      });

      whatif = d.whatif;
      drawWhatif();
    }

    function drawWhatif() {
      if (!whatif) return;
      const col = wiCols[wiCol];
      const line = whatif[col].map(([a, b]) => ({ x: a, y: b }));
      const cur = state[col];
      const near = line.reduce((a, b) => (Math.abs(b.x - cur) < Math.abs(a.x - cur) ? b : a));
      const datasets = [
        { label: "P(click)", data: line, borderColor: C.c1, backgroundColor: C.c1, tension: 0.2 },
        { label: "Current", data: [{ x: cur, y: near.y }], showLine: false, pointRadius: 6, pointHoverRadius: 7, pointBackgroundColor: C.ink, pointBorderColor: C.surface, pointBorderWidth: 2 },
        { label: "Threshold", data: [{ x: line[0].x, y: 0.5 }, { x: line[line.length - 1].x, y: 0.5 }], borderColor: C.muted, borderDash: [4, 4], borderWidth: 1, pointHoverRadius: 0 },
      ];
      if (!wiChart) {
        make("whatifChart", {
          type: "line", data: { datasets },
          options: {
            parsing: false,
            scales: { x: axis({ type: "linear", title: { text: col } }), y: axis({ min: 0, max: 1, title: { text: "P(click)" } }) },
            plugins: { tooltip: { filter: (it) => it.datasetIndex < 2, displayColors: false,
              callbacks: { title: (it) => `${SHORT[wiCols[wiCol]]} = ${fmt[wiCols[wiCol]](it[0].parsed.x)}`, label: (it) => `P(click) ${it.parsed.y.toFixed(3)}` } } },
          },
        }).then((c) => { wiChart = c; drawWhatif(); });   // refresh in case inputs moved meanwhile
        wiChart = "pending";
      } else if (wiChart !== "pending") {
        wiChart.data.datasets = datasets;
        wiChart.options.scales.x.title.text = col;
        wiChart.update();
      }
    }
    segmented($("#whatifTabs"), wiCols.map((c) => SHORT[c]), (i) => {
      wiCol = i;
      drawWhatif();
      if (wiChart && wiChart !== "pending") CF.replay(wiChart);
    });

    lazy($("#result"), run);
  }

  /* ------------------------------------------------------------------ */
  /* 10 insights                                                         */
  /* ------------------------------------------------------------------ */
  function insights() {
    const F = R.eda.facts;
    const bars = (rows) => `<div class="insight-bars">${rows.map(([l, v, c]) =>
      `<div class="ib"><span>${l}</span><div class="ib-track"><div class="ib-fill" data-w="${v * 100}" style="background:${c}"></div></div><b>${pct(v, 0)}</b></div>`).join("")}</div>`;
    const cards = [
      { big: pct(F.rate_usage_lt_150, 0), vs: "click rate of light internet users", h: "Light internet users are the audience",
        bars: [["< 150 min/day", F.rate_usage_lt_150, C.c1], ["≥ 200 min/day", F.rate_usage_ge_200, C.c0]],
        p: "Heavy users see so many ads that they tune them out (banner blindness). People who spend little time online still notice and act on ads." },
      { big: pct(F.rate_time_lt_60, 0), vs: "click rate when time on site < 60 min", h: "Short visits click, long visits read",
        bars: [["< 60 min on site", F.rate_time_lt_60, C.c1], ["≥ 75 min on site", F.rate_time_ge_75, C.c0]],
        p: "Engaged readers came for the content and stay on the page. Brief visitors are more willing to leave through an ad." },
      { big: pct(F.rate_age_ge_45, 0), vs: "click rate for users aged 45+", h: "Older users in lower-income areas",
        bars: [["Age ≥ 45", F.rate_age_ge_45, C.c1], ["Age < 30", F.rate_age_lt_30, C.c0], ["Income < $40k", F.rate_income_lt_40k, C.c1], ["Income ≥ $60k", F.rate_income_ge_60k, C.c0]],
        p: "Age and area income are the secondary signals. Together with the two usage features they explain almost all of the model's decisions." },
    ];
    $("#insightCards").innerHTML = cards.map((c) => `
      <div class="card insight reveal"><div class="insight-big">${c.big}</div><div class="insight-vs">${c.vs}</div>${bars(c.bars)}<h3>${c.h}</h3><p>${c.p}</p></div>`).join("");
    $$(".insight").forEach((card, i) => lazy(card, () => {
      $$(".ib-fill", card).forEach((f) => (f.style.width = f.dataset.w + "%"));
      countUp($(".insight-big", card), parseFloat(cards[i].big) / 100, (x) => pct(x, 0), 1100);
    }));

    const m = R.evaluation.metrics;
    $("#recs").innerHTML = [
      `<b>Score before you bid.</b> Use P(click) as a pre-bid filter. At the 0.5 threshold, ${pct(m.precision)} of impressions the model flags really are clicks, so far less budget is spent on users who will never click.`,
      `<b>Pick the threshold from costs, not habit.</b> If an impression is cheap and a click is valuable, lower the threshold to catch more clickers (higher recall). If impressions are expensive, raise it. The slider in section 07 shows the exact trade-off.`,
      `<b>Change format for heavy users, not frequency.</b> Users online 200+ min/day click about ${pct(F.rate_usage_ge_200, 0)} of the time. Showing them more banners wastes spend; native or video formats are worth testing instead.`,
      `<b>Don't pay a premium for timing.</b> Hour, day of week and month carry almost no signal, so day-parting bid multipliers would add cost without lift.`,
      `<b>Retrain on fresh logs.</b> User behaviour drifts. Re-running <span class="mono">python -m ml.train</span> monthly and watching OOB error keeps the model honest.`,
    ].map((t) => `<li>${t}</li>`).join("");
    $("#limits").innerHTML = [
      `<b>Small and very clean data.</b> 1,000 balanced rows with near-linear separation is easier than real ad logs, where click-through rates are often 1–2%. Production would need class weighting, probability calibration and log-loss.`,
      `<b>Ad content is unused.</b> Every headline is unique, so it was dropped. With repeated campaigns, text features (TF-IDF or embeddings) could explain <i>which</i> ads work.`,
      `<b>Geography was dropped.</b> 237 countries across 1,000 rows is too sparse. With more data, target encoding of country would be worth testing.`,
      `<b>Correlation, not causation.</b> The model shows who clicks, not why. An A/B test is needed before claiming that targeting a segment <i>causes</i> more clicks.`,
    ].map((t) => `<li>${t}</li>`).join("");
  }

  /* ------------------------------------------------------------------ */
  async function init() {
    const stage = (w, text) => { $("#loaderFill").style.width = w + "%"; $("#loaderText").textContent = text; };
    stage(25, "Loading model results");
    try {
      const res = await fetch("/api/results");
      R = await res.json();
    } catch (e) {
      stage(100, "Could not load results. Is the server running?");
      return;
    }
    stage(70, "Building charts");
    await new Promise((r) => setTimeout(r, 30));   // let the loader paint its progress first
    legends();
    overview(); dataset(); explore(); prep(); forest(); tuning(); evaluation(); comparison(); predictor(); insights();
    setupReveal();
    setupNav();
    stage(100, "Ready");
    setTimeout(() => $("#loader").classList.add("done"), 380);
    // content was injected after load, so honour a #section link now
    if (location.hash && $(location.hash)) $(location.hash).scrollIntoView();
  }
  init();
})();
