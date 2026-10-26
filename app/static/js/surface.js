/* Decision-surface renderer: P(click) field + real users + the P = 0.5 boundary.
   Draws on a <canvas>, animates in, and morphs smoothly between tree counts. */
(function () {
  const { C } = window.CF;
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const PAD = { l: 58, r: 12, t: 10, b: 38 };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const NEUTRAL = [238, 240, 242];
  const P0 = hex(C.c0), P1 = hex(C.c1);
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));

  function colour(p) {
    const pole = p < 0.5 ? P0 : P1;
    const t = Math.min(1, Math.abs(p - 0.5) * 2) * 0.62;
    return NEUTRAL.map((n, i) => Math.round(n + (pole[i] - n) * t));
  }

  // Marching squares for the 0.5 iso-line → list of segments in grid units
  function contour(v, nx, ny, level = 0.5) {
    const seg = [];
    const at = (i, j) => v[j * nx + i];
    const lerp = (a, b) => (level - a) / (b - a);
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
        const idx = (a > level) | ((b > level) << 1) | ((c > level) << 2) | ((d > level) << 3);
        if (idx === 0 || idx === 15) continue;
        const top = [i + lerp(a, b), j], right = [i + 1, j + lerp(b, c)];
        const bottom = [i + lerp(d, c), j + 1], left = [i, j + lerp(a, d)];
        const map = {
          1: [[left, top]], 2: [[top, right]], 3: [[left, right]], 4: [[right, bottom]],
          5: [[left, top], [right, bottom]], 6: [[top, bottom]], 7: [[left, bottom]], 8: [[bottom, left]],
          9: [[top, bottom]], 10: [[top, right], [bottom, left]], 11: [[right, bottom]], 12: [[right, left]],
          13: [[top, right]], 14: [[left, top]],
        };
        seg.push(...map[idx]);
      }
    }
    return seg;
  }

  class Surface {
    constructor(canvas, data, points, opts = {}) {
      this.cv = canvas;
      this.ctx = canvas.getContext("2d");
      this.d = data;
      this.nx = data.nx; this.ny = data.ny;
      this.points = [...points].sort((a, b) => a.t - b.t);   // left-to-right entrance
      this.opts = opts;
      this.key = opts.initial || Object.keys(data.by_trees).pop();
      this.values = Float32Array.from(data.by_trees[this.key]);
      this.field = document.createElement("canvas");
      this.field.width = this.nx; this.field.height = this.ny;
      this.intro = REDUCED ? 1 : 0;
      this.paintField();
      new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
      canvas.addEventListener("mousemove", (e) => this.hover(e));
      canvas.addEventListener("mouseleave", () => { this.cursor = null; this.draw(); opts.onLeave && opts.onLeave(); });
      this.resize();
    }

    resize() {
      const r = this.cv.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.w = r.width; this.h = r.height;
      this.cv.width = Math.round(r.width * dpr); this.cv.height = Math.round(r.height * dpr);
      this.cv.style.width = r.width + "px"; this.cv.style.height = r.height + "px";
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.draw();
    }

    paintField() {
      const img = new ImageData(this.nx, this.ny);
      for (let j = 0; j < this.ny; j++) {
        for (let i = 0; i < this.nx; i++) {
          const [r, g, b] = colour(this.values[j * this.nx + i]);
          const o = ((this.ny - 1 - j) * this.nx + i) * 4;      // flip: low usage at the bottom
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
        }
      }
      this.field.getContext("2d").putImageData(img, 0, 0);
      this.segments = contour(this.values, this.nx, this.ny);
    }

    // data ↔ pixel helpers
    get area() { return { x: PAD.l, y: PAD.t, w: this.w - PAD.l - PAD.r, h: this.h - PAD.t - PAD.b }; }
    px(t) { const a = this.area; return a.x + ((t - this.d.x[0]) / (this.d.x[1] - this.d.x[0])) * a.w; }
    py(u) { const a = this.area; return a.y + a.h - ((u - this.d.y[0]) / (this.d.y[1] - this.d.y[0])) * a.h; }

    play() {
      if (REDUCED) { this.intro = 1; this.draw(); return; }
      const start = performance.now(), dur = 2300;
      const tick = (now) => {
        this.intro = clamp01((now - start) / dur);
        this.draw();
        if (this.intro < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    morphTo(key) {
      if (key === this.key) return;
      const from = Float32Array.from(this.values), to = this.d.by_trees[key];
      this.key = key;
      if (REDUCED) { this.values = Float32Array.from(to); this.paintField(); this.draw(); return; }
      const token = (this.morphToken = {});              // a newer morph cancels this one
      const start = performance.now(), dur = 650;
      const tick = (now) => {
        if (token !== this.morphToken) return;
        const t = ease(clamp01((now - start) / dur));
        for (let k = 0; k < from.length; k++) this.values[k] = from[k] + (to[k] - from[k]) * t;
        this.paintField();
        this.draw();
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }

    sample(t, u) {
      const fx = ((t - this.d.x[0]) / (this.d.x[1] - this.d.x[0])) * (this.nx - 1);
      const fy = ((u - this.d.y[0]) / (this.d.y[1] - this.d.y[0])) * (this.ny - 1);
      const i = Math.max(0, Math.min(this.nx - 2, Math.floor(fx))), j = Math.max(0, Math.min(this.ny - 2, Math.floor(fy)));
      const dx = fx - i, dy = fy - j, v = this.values, n = this.nx;
      return (v[j * n + i] * (1 - dx) + v[j * n + i + 1] * dx) * (1 - dy) + (v[(j + 1) * n + i] * (1 - dx) + v[(j + 1) * n + i + 1] * dx) * dy;
    }

    hover(e) {
      const rect = this.cv.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top, a = this.area;
      if (x < a.x || x > a.x + a.w || y < a.y || y > a.y + a.h) {
        this.cursor = null; this.draw(); this.opts.onLeave && this.opts.onLeave(); return;
      }
      const t = this.d.x[0] + ((x - a.x) / a.w) * (this.d.x[1] - this.d.x[0]);
      const u = this.d.y[0] + ((a.y + a.h - y) / a.h) * (this.d.y[1] - this.d.y[0]);
      this.cursor = { x, y };
      this.draw();
      this.opts.onHover && this.opts.onHover(e, { t, u, p: this.sample(t, u) });
    }

    draw() {
      const ctx = this.ctx, a = this.area;
      if (!this.w) return;
      ctx.clearRect(0, 0, this.w, this.h);
      const k = this.intro;
      const fieldT = ease(clamp01(k / 0.4));                 // 0 – 40%: field wipes in
      const lineT = ease(clamp01((k - 0.62) / 0.3));         // 62 – 92%: boundary fades in

      // axes + ticks
      ctx.font = `11px ${getComputedStyle(document.body).getPropertyValue("--mono") || "monospace"}`;
      ctx.fillStyle = C.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
      for (let t = 30; t <= 90; t += 10) ctx.fillText(t, this.px(t), a.y + a.h + 7);
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      for (let u = 100; u <= 275; u += 25) if (u <= this.d.y[1]) ctx.fillText(u, a.x - 7, this.py(u));
      ctx.font = `12px ${getComputedStyle(document.body).fontFamily}`;
      ctx.fillStyle = C.ink2; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText("Daily time on site (min)", a.x + a.w / 2, this.h - 1);
      ctx.save(); ctx.translate(2, a.y + a.h / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "top";
      ctx.fillText("Daily internet usage (min)", 0, 0); ctx.restore();

      // field (wipe from left)
      ctx.save();
      ctx.beginPath(); ctx.rect(a.x, a.y, a.w * fieldT, a.h); ctx.clip();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.field, a.x, a.y, a.w, a.h);
      ctx.restore();

      // grid hairlines over the field
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let t = 40; t <= 90; t += 10) { const x = Math.round(this.px(t)) + 0.5; ctx.moveTo(x, a.y); ctx.lineTo(x, a.y + a.h); }
      for (let u = 125; u < this.d.y[1]; u += 25) { const y = Math.round(this.py(u)) + 0.5; ctx.moveTo(a.x, y); ctx.lineTo(a.x + a.w, y); }
      ctx.stroke();

      // boundary
      if (lineT > 0) {
        const sx = a.w / (this.nx - 1), sy = a.h / (this.ny - 1);
        ctx.save();
        ctx.globalAlpha = lineT;
        ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6; ctx.lineCap = "round";
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        for (const [p, q] of this.segments) {
          ctx.moveTo(a.x + p[0] * sx, a.y + a.h - p[1] * sy);
          ctx.lineTo(a.x + q[0] * sx, a.y + a.h - q[1] * sy);
        }
        ctx.stroke();
        ctx.restore();
      }

      // users: pop in left to right
      const n = this.points.length;
      this.points.forEach((pt, idx) => {
        const start = 0.18 + (idx / n) * 0.5;
        const s = ease(clamp01((k - start) / 0.12));
        if (s <= 0) return;
        const x = this.px(pt.t), y = this.py(pt.u);
        if (x < a.x || x > a.x + a.w || y < a.y || y > a.y + a.h) return;
        ctx.beginPath();
        ctx.arc(x, y, 3.3 * s, 0, Math.PI * 2);
        ctx.fillStyle = pt.y ? C.c1 : C.c0;
        ctx.globalAlpha = 0.92 * s;
        ctx.fill();
        ctx.globalAlpha = s;
        ctx.lineWidth = 1; ctx.strokeStyle = C.surface; ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // frame
      ctx.strokeStyle = C.line; ctx.lineWidth = 1;
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);

      // cursor
      if (this.cursor) {
        const { x, y } = this.cursor;
        ctx.strokeStyle = "rgba(23,32,43,.35)"; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x + 0.5, a.y); ctx.lineTo(x + 0.5, a.y + a.h); ctx.moveTo(a.x, y + 0.5); ctx.lineTo(a.x + a.w, y + 0.5); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
  }

  window.CF.Surface = Surface;
})();
