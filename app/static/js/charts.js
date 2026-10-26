/* Chart.js theme + small helpers shared by every chart on the page. */
(function () {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();

  const C = {
    c0: v("--c0"), c1: v("--c1"),
    accent: v("--accent"),
    s2: "#D97B2B",               // validated 3-series set: accent / orange / teal
    s3: "#1BA58A",
    ink: v("--ink"), ink2: v("--ink-2"), muted: v("--muted"),
    line: v("--line"), grid: v("--line-2"), surface: v("--surface"),
    tipBg: v("--sidebar"),
  };

  Chart.defaults.font.family = v("--sans");
  Chart.defaults.font.size = 12;
  Chart.defaults.color = C.muted;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.animation.duration = 900;
  Chart.defaults.animation.easing = "easeOutQuart";
  Chart.defaults.plugins.legend.display = false;   // HTML legends instead
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.line.tension = 0.25;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.point.hoverBorderWidth = 2;
  Chart.defaults.elements.point.hoverBorderColor = C.surface;
  Chart.defaults.elements.bar.borderRadius = 3;

  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: C.tipBg,
    titleColor: "#AEB8C4",
    bodyColor: "#fff",
    titleFont: { weight: "500", size: 11.5 },
    bodyFont: { size: 12.5 },
    padding: { x: 11, y: 8 },
    cornerRadius: 7,
    displayColors: true,
    boxWidth: 8, boxHeight: 8, boxPadding: 5,
    usePointStyle: true,
    caretSize: 0,
  });
  Object.assign(Chart.defaults.interaction, { mode: "nearest", intersect: false });

  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Bars and points grow one after another instead of all at once.
  Chart.defaults.animation.delay = (ctx) =>
    ctx.type === "data" && ctx.mode === "default" && !REDUCED ? Math.min(ctx.dataIndex * 28 + ctx.datasetIndex * 70, 650) : 0;

  // Line charts draw left → right: the plot area is clipped to a growing width.
  const reveal = {
    id: "reveal",
    defaults: { enabled: false, duration: 1300 },
    afterInit(chart, _args, opts) {
      if (opts.enabled) replay(chart);
    },
    beforeDatasetsDraw(chart, _args, opts) {
      if (!opts.enabled || chart.$reveal >= 1) return;
      const a = chart.chartArea;
      chart.ctx.save();
      chart.ctx.beginPath();
      chart.ctx.rect(a.left - 12, a.top - 12, (a.right - a.left + 24) * (chart.$reveal || 0), a.bottom - a.top + 24);
      chart.ctx.clip();
      chart.$clipped = true;
    },
    afterDatasetsDraw(chart) {
      if (chart.$clipped) { chart.ctx.restore(); chart.$clipped = false; }
    },
  };
  Chart.register(reveal);

  function replay(chart) {
    const dur = chart.options.plugins.reveal.duration;
    if (REDUCED) { chart.$reveal = 1; return; }
    chart.$reveal = 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      chart.$reveal = 1 - Math.pow(1 - t, 3);
      chart.draw();
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  // charts that draw in: no competing per-point animation on first paint
  const drawIn = { reveal: { enabled: true } };
  const still = { x: { duration: 0 }, y: { duration: 0 } };

  function axis(extra = {}) {
    const out = {
      grid: { color: C.grid, drawTicks: false },
      border: { display: false },
      ticks: { padding: 8, color: C.muted, font: { family: v("--mono"), size: 11 } },
      ...extra,
    };
    if (extra.title) out.title = { display: true, color: C.ink2, font: { size: 12 }, padding: { top: 8 }, ...extra.title };
    return out;
  }

  // Build charts only when they scroll into view, so their entry animation is seen.
  const pending = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && pending.has(e.target)) {
        pending.get(e.target)();
        pending.delete(e.target);
        io.unobserve(e.target);
      }
    });
  }, { rootMargin: "0px 0px -12% 0px" });

  function lazy(el, fn) {
    pending.set(el, fn);
    io.observe(el);
  }

  const registry = {};
  function make(id, config) {
    const canvas = document.getElementById(id);
    if (config.type === "line") {
      config.options = config.options || {};
      config.options.plugins = { ...(config.options.plugins || {}), reveal: { enabled: true } };
      config.options.animations = { ...still, ...(config.options.animations || {}) };
    }
    return new Promise((resolve) => {
      lazy(canvas, () => {
        registry[id] = new Chart(canvas, config);
        resolve(registry[id]);
      });
    });
  }

  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  window.CF = { C, axis, make, lazy, registry, alpha, replay, drawIn, still, REDUCED };
})();
