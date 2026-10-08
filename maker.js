"use strict";

/*
 * Page de l'acheteur : il tape son titre et ses mots, voit sa grille aussitôt et télécharge ses fichiers.
 * Tout se fait dans son navigateur (wordsearch.js, poster.js, jsPDF) : rien n'est envoyé nulle part, et
 * il n'y a rien à faire de notre côté pour livrer.
 */
(async function maker() {
  const { jsPDF } = window.jspdf;
  const WS = window.MMWordSearch;
  const P = window.MMPoster;
  const BLOCKED = window.MM_BLOCKED || [];
  const MAX_WORDS = 150;
  const SAVE_KEY = "mm-maker-form";
  const PREVIEW_PX = 1600;  // largeur de l'aperçu (affiche 36 × 24)
  const HELP = {
    easy: "Across and down only: great for kids and quick party games.",
    medium: "Adds diagonals, always read left to right.",
    hard: "All 8 directions, even backwards: for puzzle lovers.",
  };
  const REASONS = { short: "needs at least 3 letters", long: "is too long", blocked: "can't be used", duplicate: "is listed twice" };
  const FILES = {
    "poster-36x24": [["36x24", false]], "poster-48x36": [["48x36", false]], "poster-24x18": [["24x18", false]],
    "print-at-home": [["letter", false], ["a4", false]], "answer-key": [["letter", true], ["a4", true]],
  };
  const FILE_NAMES = {
    "poster-36x24": "poster-36x24-inches", "poster-48x36": "poster-48x36-inches", "poster-24x18": "poster-24x18-inches",
    "print-at-home": "print-at-home-letter-and-a4", "answer-key": "answer-key-letter-and-a4",
  };

  const form = document.getElementById("maker");
  const canvas = document.getElementById("canvas");
  const status = document.getElementById("status");
  const downloads = document.getElementById("downloads");
  const placeholder = document.getElementById("placeholder");

  document.getElementById("styles").innerHTML = Object.entries(P.STYLES).map(([name, s], i) =>
    `<label class="swatch"><input type="radio" name="style" value="${name}" ${i === 0 ? "checked" : ""}>
      <span><i style="background:${s.background}"></i><i style="background:${s.accent}"></i><i style="background:${s.ink}"></i>${name[0].toUpperCase()}${name.slice(1)}</span></label>`).join("");

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  status.textContent = "Loading fonts…";
  const fonts = {};
  await Promise.all(Object.entries(P.FONT_FILES).map(async ([name, file]) => {
    const buffer = await (await fetch(`fonts/${file}`)).arrayBuffer();
    fonts[name] = toBase64(buffer);
    document.fonts.add(await new FontFace(name, buffer).load());
  }));
  const measure = P.makeMeasure(jsPDF, fonts);
  status.textContent = "";

  try {  // formulaire laissé en cours : retrouvé à la prochaine visite
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
    if (saved) {
      ["title", "subtitle", "words"].forEach((k) => { form.elements[k].value = saved[k] || ""; });
      ["difficulty", "style"].forEach((k) => { if (saved[k]) form.elements[k].value = saved[k]; });
    }
  } catch { /* stockage indisponible : formulaire vide */ }

  let current = null;

  function read() {
    const f = form.elements;
    return {
      title: f.title.value.trim() || "Word Search", subtitle: f.subtitle.value.trim(),
      words: WS.parseWords(f.words.value).slice(0, MAX_WORDS), raw: f.words.value,
      difficulty: f.difficulty.value, style: f.style.value,
    };
  }

  function seedOf(spec) {
    return `${spec.title}|${spec.difficulty}|${spec.words.join("|")}`;
  }

  function rejectedText(rejected) {
    return rejected.map(([word, reason]) => {
      if (reason.startsWith("overlap:")) return `"${word}" (it overlaps with "${reason.slice(8)}")`;
      return `"${word}" (${REASONS[reason] || "can't be placed"})`;
    }).join(", ");
  }

  function render() {
    if (!current) return;
    const answers = form.elements.view ? document.querySelector('input[name="view"]:checked').value === "answers" : false;
    const painter = new P.CanvasPainter(canvas, PREVIEW_PX / P.SIZES["36x24"][0]);
    const pages = P.draw(painter, measure, current.spec, current.puzzle, P.SIZES["36x24"], answers);
    placeholder.hidden = true;
    return pages;
  }

  function update() {
    const spec = read();
    document.getElementById("count").textContent = `${spec.words.length} / ${MAX_WORDS}`;
    document.getElementById("difficulty-help").textContent = HELP[spec.difficulty];
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ ...spec, words: spec.raw })); } catch { /* sans mémoire */ }
    if (!spec.words.length) {
      current = null;
      downloads.hidden = true;
      placeholder.hidden = false;
      canvas.width = 0;
      status.textContent = "";
      return;
    }
    const result = WS.build(spec.words, spec.difficulty, seedOf(spec), BLOCKED);
    if (!result.puzzle) {
      current = null;
      downloads.hidden = true;
      status.className = "status warn";
      status.textContent = result.error === "no-words" ? "Add at least one word of 3 letters or more."
        : "That's too many letters for one puzzle: remove a few of the longest words.";
      return;
    }
    current = { spec, puzzle: result.puzzle };
    render();
    downloads.hidden = false;
    const left = result.rejected.length ? ` Left out: ${rejectedText(result.rejected)}.` : "";
    status.className = left ? "status warn" : "status";
    status.textContent = `${result.puzzle.placements.length} words in a ${result.puzzle.size} × ${result.puzzle.size} grid.${left}`;
  }

  let timer = null;
  form.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(update, 250); });
  form.addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("view").addEventListener("change", render);

  function pdfBlob(pages) {
    const painter = new P.PdfPainter(jsPDF, fonts);
    pages.forEach(([size, answers]) => P.draw(painter, measure, current.spec, current.puzzle, P.SIZES[size], answers));
    return painter.doc.output("blob");
  }

  function stem() {
    const slug = current.spec.title.normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase()
      .replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
    return `${slug || "custom"}-word-search`;
  }

  function save(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  downloads.addEventListener("click", async (e) => {
    const button = e.target.closest("[data-file]");
    if (!button || !current) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "Preparing…";
    await new Promise((resolve) => setTimeout(resolve, 30));  // laisse le bouton se redessiner
    try {
      const file = button.dataset.file;
      if (file === "all") {
        const zip = new window.JSZip();
        Object.entries(FILES).forEach(([key, pages]) => zip.file(`${stem()}-${FILE_NAMES[key]}.pdf`, pdfBlob(pages)));
        save(await zip.generateAsync({ type: "blob" }), `${stem()}.zip`);
      } else {
        save(pdfBlob(FILES[file]), `${stem()}-${FILE_NAMES[file]}.pdf`);
      }
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });

  update();
}());
