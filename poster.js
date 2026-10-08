"use strict";

/*
 * Affiche de mots mêlés, version navigateur : même mise en page que moneymaker/custom/poster.py.
 * Tout se calcule en fraction du petit côté de la page (u = 1 %), en points, origine en haut à gauche.
 * Le même dessin sert à l'aperçu (canvas) et aux PDF (jsPDF) ; les largeurs de texte viennent toujours de
 * jsPDF, pour que l'aperçu et le PDF aient exactement la même mise en page.
 */
(function (root) {
  const MM = 72 / 25.4;
  const SIZES = {
    "48x36": [48 * 72, 36 * 72], "36x24": [36 * 72, 24 * 72], "24x18": [24 * 72, 18 * 72],
    letter: [11 * 72, 8.5 * 72], a4: [297 * MM, 210 * MM],
  };
  const MIN_BODY = 5;  // pt : plus petit corps imprimé
  const GRID_PAD = 0.035;
  const LETTER_RATIO = 0.6;
  const BODY = "Atkinson";
  const BODY_BOLD = "Atkinson-Bold";
  const DISPLAY = "ArchivoBlack";
  const SERIF = "DMSerifDisplay";
  const SCRIPT = "Playball";
  // ascendante, descendante (négative) et hauteur des capitales, pour 1 pt
  const METRICS = {
    [BODY]: [0.95, -0.29, 0.668], [BODY_BOLD]: [0.95, -0.29, 0.668], [DISPLAY]: [0.878, -0.21, 0.688],
    [SERIF]: [1.036, -0.335, 0.66], [SCRIPT]: [0.95, -0.30, 0.706],
  };
  const FONT_FILES = {
    [BODY]: "AtkinsonHyperlegible-Regular.ttf", [BODY_BOLD]: "AtkinsonHyperlegible-Bold.ttf",
    [DISPLAY]: "ArchivoBlack-Regular.ttf", [SERIF]: "DMSerifDisplay-Regular.ttf", [SCRIPT]: "Playball-Regular.ttf",
  };
  const style = (background, ink, accent, soft, muted, titleFont = SERIF) =>
    ({ background, ink, accent, soft, muted, titleFont, panel: "#ffffff" });
  const STYLES = {
    classic: style("#fbf7ef", "#1f2a44", "#b0882a", "#f3e4b5", "#8a8f9c"),
    party: style("#fff3e6", "#2b2d42", "#e0534b", "#ffd6d2", "#9a9cab", DISPLAY),
    garden: style("#f3f7ee", "#22311f", "#5b8c5a", "#d4e8cf", "#8c9988"),
    blush: style("#fbf1f0", "#3d2b2f", "#bf7180", "#f6d9dc", "#a39295"),
    baby: style("#eef5fb", "#24324a", "#6b94c9", "#d5e4f6", "#8d9ab0", DISPLAY),
    holiday: style("#f7f2e8", "#1d3b2c", "#b3352b", "#f2d3cd", "#8f9a8f"),
    mono: style("#ffffff", "#111111", "#555555", "#e2e2e2", "#9a9a9a", DISPLAY),
  };

  function fitSize(measure, text, font, max, width, min) {
    const w = measure(text, font, max);
    return w ? Math.max(min, Math.min(max, (max * width) / w)) : max;
  }

  function fitList(measure, words, width, height, u) {
    let size = 3.2 * u;
    while (size >= Math.max(1.0 * u, MIN_BODY)) {
      const heading = size * 2.4;
      const rowH = size * 1.55;
      let rows = Math.floor((height - heading) / rowH);
      if (rows >= 1) {
        const cols = Math.ceil(words.length / rows);
        rows = Math.ceil(words.length / cols);  // colonnes équilibrées
        const colW = Math.max(...words.map((w) => measure(w, BODY, size))) + size * 2.6;
        if (cols * colW <= width) return { size, rows, cols, colW, rowH, heading };
      }
      size *= 0.96;
    }
    return null;
  }

  function drawGrid(p, puzzle, x0, top, side, st, answers) {
    p.rect(x0, top, side, side, { fill: st.panel, stroke: st.accent, lineWidth: Math.max(0.25, side * 0.004), radius: side * 0.025 });
    const pad = side * GRID_PAD;
    const cell = (side - 2 * pad) / puzzle.size;
    const center = (r, c) => [x0 + pad + (c + 0.5) * cell, top + pad + (r + 0.5) * cell];
    if (answers) {
      puzzle.placements.forEach((pl) => {
        const [first, last] = [pl.cells[0], pl.cells[pl.cells.length - 1]];
        p.capsule(...center(...first), ...center(...last), cell * 0.42, st.soft);
      });
    }
    const found = new Set(puzzle.placements.flatMap((pl) => pl.cells.map(([r, c]) => r * 1000 + c)));
    const letter = cell * LETTER_RATIO;
    const cap = METRICS[BODY_BOLD][2] * letter;
    puzzle.grid.forEach((row, r) => row.split("").forEach((ch, c) => {
      const [x, y] = center(r, c);
      const dim = answers && !found.has(r * 1000 + c);
      p.text(x, y + cap / 2, ch, { font: dim ? BODY : BODY_BOLD, size: letter, color: dim ? st.muted : st.ink, align: "center" });
    }));
  }

  function drawWordList(p, measure, words, x0, top, fit, st) {
    const heading = `WORDS TO FIND · ${words.length}`;
    const size = fitSize(measure, heading, BODY_BOLD, fit.size * 1.05, fit.cols * fit.colW, MIN_BODY);
    p.text(x0, top + size, heading, { font: BODY_BOLD, size, color: st.accent, tracking: size * 0.15 });
    const tick = fit.size * 0.78;
    const cap = METRICS[BODY][2] * fit.size;
    words.forEach((word, i) => {
      const col = Math.floor(i / fit.rows);
      const row = i % fit.rows;
      const x = x0 + col * fit.colW;
      const mid = top + fit.heading + (row + 0.5) * fit.rowH;
      p.rect(x, mid - tick / 2, tick, tick, { stroke: st.accent, lineWidth: Math.max(0.25, fit.size * 0.07), radius: tick * 0.2 });
      p.text(x + tick + fit.size * 0.55, mid + cap / 2, word, { font: BODY, size: fit.size, color: st.ink });
    });
  }

  /* Fond, cadre et en-tête ; renvoie la zone libre en dessous (x0, y0, x1, y1). */
  function drawPage(p, measure, spec, st, width, height, answers) {
    const u = Math.min(width, height) / 100;
    p.page(width, height);
    p.rect(0, 0, width, height, { fill: st.background });
    const s = 4 * u;
    p.rect(s + 0.2 * u, s + 0.2 * u, width - 2 * s - 0.4 * u, height - 2 * s - 0.4 * u,
      { stroke: st.accent, lineWidth: 0.3 * u, radius: 1.5 * u });
    const inner = { x0: 8 * u, y0: 8 * u, x1: width - 8 * u, y1: height - 8 * u };
    const innerW = inner.x1 - inner.x0;
    const cx = (inner.x0 + inner.x1) / 2;
    let size = fitSize(measure, spec.title, st.titleFont, 9 * u, innerW, 3 * u);
    let y = inner.y0 + METRICS[st.titleFont][0] * size;
    p.text(cx, y, spec.title, { font: st.titleFont, size, color: st.ink, align: "center" });
    y -= METRICS[st.titleFont][1] * size;
    if (spec.subtitle) {
      size = fitSize(measure, spec.subtitle, SCRIPT, 4.4 * u, innerW * 0.85, 2 * u);
      y += 0.8 * u + METRICS[SCRIPT][0] * size;
      p.text(cx, y, spec.subtitle, { font: SCRIPT, size, color: st.accent, align: "center" });
      y -= METRICS[SCRIPT][1] * size;
    }
    const label = answers ? "ANSWER KEY" : "FIND THE WORDS";
    size = 1.8 * u;
    const tracking = size * 0.35;
    y += 2.4 * u + size * 0.7;
    const half = (measure(label, BODY_BOLD, size) + tracking * (label.length - 1)) / 2;
    p.text(cx, y, label, { font: BODY_BOLD, size, color: st.accent, align: "center", tracking });
    const ruleY = y - size * 0.33;
    const gap = 2 * u;
    const length = Math.min(12 * u, innerW / 2 - half - gap);
    [-1, 1].forEach((sign) => {
      const start = cx + sign * (half + gap);
      p.line(start, ruleY, start + sign * length, ruleY, { stroke: st.accent, lineWidth: 0.2 * u });
    });
    return { x0: inner.x0, y0: y + 1.2 * u + 2.5 * u, x1: inner.x1, y1: inner.y1, u };
  }

  /* La grille et sa liste côte à côte ; la liste passe sur une 2e page si elle ne tient pas à côté. */
  function draw(p, measure, spec, puzzle, size, answers = false) {
    const [width, height] = size;
    const st = STYLES[spec.style] || STYLES.classic;
    let content = drawPage(p, measure, spec, st, width, height, answers);
    const { u } = content;
    const cw = content.x1 - content.x0;
    const ch = content.y1 - content.y0;
    const words = puzzle.placements.map((pl) => pl.word).sort((a, b) => (a.letters < b.letters ? -1 : 1)).map((w) => w.display);
    const gap = 4 * u;
    const readable = (1.01 * MIN_BODY / LETTER_RATIO) * puzzle.size / (1 - 2 * GRID_PAD);
    let side = Math.min(ch, cw * 0.66);
    let fit = null;
    while (side >= Math.max(ch * 0.45, readable)) {
      fit = fitList(measure, words, cw - side - gap, side, u);
      if (fit) break;
      side *= 0.95;
    }
    if (fit) {
      const x0 = (content.x0 + content.x1) / 2 - (side + gap + fit.cols * fit.colW) / 2;
      const top = content.y0 + (ch - side) / 2;
      drawGrid(p, puzzle, x0, top, side, st, answers);
      drawWordList(p, measure, words, x0 + side + gap, top, fit, st);
      return 1;
    }
    side = Math.min(ch, cw);
    drawGrid(p, puzzle, (content.x0 + content.x1) / 2 - side / 2, content.y0 + (ch - side) / 2, side, st, answers);
    content = drawPage(p, measure, spec, st, width, height, answers);
    fit = fitList(measure, words, content.x1 - content.x0, content.y1 - content.y0, u);
    if (!fit) throw new Error("too-many-words");
    drawWordList(p, measure, words, (content.x0 + content.x1) / 2 - (fit.cols * fit.colW) / 2, content.y0, fit, st);
    return 2;
  }

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  /* Dessin dans un PDF jsPDF (une page par appel à page()). */
  class PdfPainter {
    constructor(jsPDF, fonts) {
      this.jsPDF = jsPDF;
      this.fonts = fonts;  // { nom: base64 du TTF }
      this.doc = null;
    }

    page(width, height) {
      const orientation = width > height ? "landscape" : "portrait";
      if (!this.doc) {
        this.doc = new this.jsPDF({ unit: "pt", format: [width, height], orientation, compress: true });
        Object.entries(this.fonts).forEach(([name, data]) => {
          this.doc.addFileToVFS(`${name}.ttf`, data);
          this.doc.addFont(`${name}.ttf`, name, "normal");
        });
      } else {
        this.doc.addPage([width, height], orientation);
      }
    }

    rect(x, y, w, h, { fill, stroke, lineWidth = 1, radius = 0 }) {
      const d = this.doc;
      if (fill) d.setFillColor(...rgb(fill));
      if (stroke) { d.setDrawColor(...rgb(stroke)); d.setLineWidth(lineWidth); }
      const mode = fill && stroke ? "FD" : fill ? "F" : "S";
      if (radius) d.roundedRect(x, y, w, h, radius, radius, mode); else d.rect(x, y, w, h, mode);
    }

    line(x0, y0, x1, y1, { stroke, lineWidth }) {
      this.doc.setDrawColor(...rgb(stroke));
      this.doc.setLineWidth(lineWidth);
      this.doc.line(x0, y0, x1, y1);
    }

    capsule(x0, y0, x1, y1, radius, fill) {
      const d = this.doc;
      d.setDrawColor(...rgb(fill));
      d.setLineWidth(radius * 2);
      d.setLineCap("round");
      d.line(x0, y0, x1, y1);
      d.setLineCap("butt");
    }

    text(x, y, text, { font, size, color, align = "left", tracking = 0 }) {
      const d = this.doc;
      d.setFont(font, "normal");
      d.setFontSize(size);
      d.setTextColor(...rgb(color));
      const w = d.getTextWidth(text) + tracking * (text.length - 1);
      const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
      d.text(text, left, y, { baseline: "alphabetic", charSpace: tracking || undefined });
    }
  }

  /* Dessin à l'écran (aperçu de la 1re page). scale : pixels par point. */
  class CanvasPainter {
    constructor(canvas, scale) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.scale = scale;
      this.pages = 0;
    }

    page(width, height) {
      this.pages += 1;
      if (this.pages > 1) { this.ctx = null; return; }  // seule la 1re page est montrée
      this.canvas.width = Math.round(width * this.scale);
      this.canvas.height = Math.round(height * this.scale);
      this.ctx = this.canvas.getContext("2d");
      this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    }

    rect(x, y, w, h, { fill, stroke, lineWidth = 1, radius = 0 }) {
      const c = this.ctx;
      if (!c) return;
      c.beginPath();
      if (radius && c.roundRect) c.roundRect(x, y, w, h, radius); else c.rect(x, y, w, h);
      if (fill) { c.fillStyle = fill; c.fill(); }
      if (stroke) { c.strokeStyle = stroke; c.lineWidth = lineWidth; c.stroke(); }
    }

    line(x0, y0, x1, y1, { stroke, lineWidth }) {
      const c = this.ctx;
      if (!c) return;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
      c.strokeStyle = stroke; c.lineWidth = lineWidth; c.stroke();
    }

    capsule(x0, y0, x1, y1, radius, fill) {
      const c = this.ctx;
      if (!c) return;
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
      c.strokeStyle = fill; c.lineWidth = radius * 2; c.lineCap = "round"; c.stroke(); c.lineCap = "butt";
    }

    text(x, y, text, { font, size, color, align = "left", tracking = 0 }, measure) {
      const c = this.ctx;
      if (!c) return;
      c.font = `${size}px "${font}"`;
      c.fillStyle = color;
      c.textBaseline = "alphabetic";
      if (!tracking) {
        c.textAlign = align;
        c.fillText(text, x, y);
        c.textAlign = "left";
        return;
      }
      const widths = text.split("").map((ch) => c.measureText(ch).width);
      const total = widths.reduce((s, w) => s + w, 0) + tracking * (text.length - 1);
      let left = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
      text.split("").forEach((ch, i) => { c.fillText(ch, left, y); left += widths[i] + tracking; });
    }
  }

  /* Mesure des textes par jsPDF (les mêmes largeurs pour l'aperçu et le PDF). */
  function makeMeasure(jsPDF, fonts) {
    const doc = new jsPDF({ unit: "pt", format: [100, 100] });
    Object.entries(fonts).forEach(([name, data]) => {
      doc.addFileToVFS(`${name}.ttf`, data);
      doc.addFont(`${name}.ttf`, name, "normal");
    });
    return (text, font, size) => {
      doc.setFont(font, "normal");
      doc.setFontSize(size);
      return doc.getTextWidth(text);
    };
  }

  const api = { SIZES, STYLES, STYLE_NAMES: Object.keys(STYLES), FONT_FILES, draw, makeMeasure, PdfPainter, CanvasPainter };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MMPoster = api;
}(typeof window !== "undefined" ? window : globalThis));
