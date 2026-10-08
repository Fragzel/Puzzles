"use strict";

/*
 * Générateur de mots mêlés, version navigateur : même méthode que moneymaker/puzzles/wordsearch.py.
 * - mots placés du plus long au plus court, jamais deux sur le même axe au même endroit ;
 * - lettres de remplissage tirées d'après la fréquence de l'anglais et les lettres de la liste ;
 * - chaque mot n'apparaît qu'une fois, et aucun mot grossier n'apparaît par hasard.
 * Utilisable dans la page (window.MMWordSearch) et sous Node (module.exports), pour les tests.
 */
(function (root) {
  const DIRECTIONS = { E: [0, 1], S: [1, 0], SE: [1, 1], NE: [-1, 1], W: [0, -1], N: [-1, 0], NW: [-1, -1], SW: [1, -1] };
  const AXIS = { E: "H", W: "H", S: "V", N: "V", SE: "D1", NW: "D1", NE: "D2", SW: "D2" };
  const DIFFICULTY_DIRECTIONS = { easy: ["E", "S"], medium: ["E", "S", "SE", "NE"], hard: Object.keys(DIRECTIONS) };
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const ENGLISH_FREQ = [8.2, 1.5, 2.8, 4.3, 12.7, 2.2, 2.0, 6.1, 7.0, 0.15, 0.77, 4.0, 2.4,
    6.7, 7.5, 1.9, 0.095, 6.0, 6.3, 9.1, 2.8, 0.98, 2.4, 0.15, 2.0, 0.074];
  const MIN_SIZE = 12;
  const MAX_SIZE = 40;
  const FILL = 0.55;

  /* Forme grille : majuscules sans accents, lettres A-Z uniquement. */
  function normalize(text) {
    return String(text).normalize("NFKD").toUpperCase().replace(/[^A-Z]/g, "");
  }

  function cleanDisplay(text) {
    return String(text).toUpperCase().split(/\s+/).filter(Boolean).join(" ");
  }

  function conflicts(a, b) {
    const rev = (s) => s.split("").reverse().join("");
    return a.includes(b) || rev(a).includes(b) || b.includes(a) || rev(b).includes(a);
  }

  /* Liste de l'acheteur : une ligne, une virgule, un point-virgule ou une puce par mot. */
  function parseWords(text) {
    const seen = new Set();
    const words = [];
    String(text || "").replace(/\s*[([][^)\]]*[)\]]/g, "").split(/[\n,;•·|]+/).forEach((part) => {
      const word = part.replace(/^\s*(?:[-*–]|\d{1,3}[.)])\s+/, "").split(/\s+/).filter(Boolean).join(" ").replace(/^[ .-]+|[ .-]+$/g, "");
      const key = normalize(word) || word.toLowerCase();
      if (word && !seen.has(key)) { seen.add(key); words.push(word); }
    });
    return words;
  }

  /* Mots retenus (dans l'ordre donné) et mots écartés, avec la raison. */
  function prepareWords(raw, size, blocked) {
    const blockedSet = new Set(blocked.map(normalize));
    const kept = [];
    const rejected = [];
    raw.forEach((item) => {
      const display = cleanDisplay(item);
      const letters = normalize(display);
      const tokens = display.split(" ").map(normalize);
      let reason = null;
      if (letters.length < 3) reason = "short";
      else if (letters.length > size) reason = "long";
      else if (blockedSet.has(letters) || tokens.some((t) => blockedSet.has(t))) reason = "blocked";
      else if (kept.some((w) => w.letters === letters)) reason = "duplicate";
      else {
        const other = kept.find((w) => conflicts(letters, w.letters));
        if (other) reason = `overlap:${other.display}`;
      }
      if (reason) rejected.push([item, reason]);
      else kept.push({ display, letters });
    });
    return { words: kept, rejected };
  }

  /* Hasard reproductible : même commande, même grille. */
  function rngFrom(seed) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i += 1) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function choose(rng, items, weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let x = rng() * total;
    for (let i = 0; i < items.length; i += 1) {
      x -= weights[i];
      if (x < 0) return items[i];
    }
    return items[items.length - 1];
  }

  function shuffle(rng, items) {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const LINES = new Map();
  /* Toutes les lignes de la grille (lignes, colonnes, deux diagonales), lues dans un sens. */
  function lines(size) {
    if (LINES.has(size)) return LINES.get(size);
    const out = [];
    for (let r = 0; r < size; r += 1) out.push(Array.from({ length: size }, (_, c) => [r, c]));
    for (let c = 0; c < size; c += 1) out.push(Array.from({ length: size }, (_, r) => [r, c]));
    for (let offset = -(size - 1); offset < size; offset += 1) {
      const line = [];
      for (let r = 0; r < size; r += 1) if (r + offset >= 0 && r + offset < size) line.push([r, r + offset]);
      out.push(line);
    }
    for (let total = 0; total < 2 * size - 1; total += 1) {
      const line = [];
      for (let c = 0; c < size; c += 1) if (total - c >= 0 && total - c < size) line.push([total - c, c]);
      out.push(line);
    }
    const kept = out.filter((line) => line.length >= 2);
    LINES.set(size, kept);
    return kept;
  }

  const key = (r, c) => r * 1000 + c;

  /* Ensembles de cases (clés triées) où `letters` se lit, dans les 8 directions. */
  function find(lineTexts, letters) {
    const found = [];
    const seen = new Set();
    const n = letters.length;
    const reversed = letters.split("").reverse().join("");
    lineTexts.forEach(([line, text]) => {
      [letters, reversed].forEach((target) => {
        let start = text.indexOf(target);
        while (start !== -1) {
          const cells = line.slice(start, start + n).map(([r, c]) => key(r, c)).sort((a, b) => a - b);
          const id = cells.join(",");
          if (!seen.has(id)) { seen.add(id); found.push(cells); }
          start = text.indexOf(target, start + 1);
        }
      });
    });
    return found;
  }

  function lineTexts(grid) {
    return lines(grid.length).map((line) => [line, line.map(([r, c]) => grid[r][c]).join("")]);
  }

  function cellsOf(p) {
    const [dr, dc] = DIRECTIONS[p.direction];
    return Array.from({ length: p.word.letters.length }, (_, k) => [p.row + dr * k, p.col + dc * k]);
  }

  function place(grid, axes, word, directions, rng) {
    const size = grid.length;
    const n = word.letters.length;
    for (const direction of shuffle(rng, directions)) {
      const [dr, dc] = DIRECTIONS[direction];
      const axis = AXIS[direction];
      const candidates = [];
      const weights = [];
      for (let r = 0; r < size; r += 1) {
        for (let c = 0; c < size; c += 1) {
          const er = r + dr * (n - 1);
          const ec = c + dc * (n - 1);
          if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
          let overlap = 0;
          let ok = true;
          for (let k = 0; k < n; k += 1) {
            const cr = r + dr * k;
            const cc = c + dc * k;
            const current = grid[cr][cc];
            if (current === null) continue;
            if (current !== word.letters[k] || (axes.get(key(cr, cc)) || []).includes(axis)) { ok = false; break; }
            overlap += 1;
          }
          if (ok && overlap < n) { candidates.push([r, c]); weights.push(1 + 2 * overlap); }
        }
      }
      if (candidates.length) {
        const [r, c] = choose(rng, candidates, weights);
        const placement = { word, row: r, col: c, direction };
        cellsOf(placement).forEach(([cr, cc], k) => {
          grid[cr][cc] = word.letters[k];
          axes.set(key(cr, cc), [...(axes.get(key(cr, cc)) || []), axis]);
        });
        return placement;
      }
    }
    return null;
  }

  /* Cases de remplissage à retirer ; null si le problème ne se corrige pas sans tout replacer. */
  function cellsToReroll(grid, placements, blocked, fixed) {
    const bad = new Set();
    const texts = lineTexts(grid);
    const own = placements.map((p) => cellsOf(p).map(([r, c]) => key(r, c)).sort((a, b) => a - b));
    for (let i = 0; i < placements.length; i += 1) {
      for (const occ of find(texts, placements[i].word.letters)) {
        if (occ.join(",") === own[i].join(",")) continue;
        const free = occ.filter((k) => !fixed.has(k));
        if (!free.length) return null;
        free.forEach((k) => bad.add(k));
      }
    }
    for (const word of blocked) {
      for (const occ of find(texts, word)) {
        if (own.some((cells) => occ.every((k) => cells.includes(k)))) continue;  // ASS dans GRASS
        const free = occ.filter((k) => !fixed.has(k));
        if (!free.length) return null;
        free.forEach((k) => bad.add(k));
      }
    }
    return [...bad];
  }

  function generate(words, size, difficulty, seed, blocked = [], maxAttempts = 60, maxRepairs = 300) {
    const directions = DIFFICULTY_DIRECTIONS[difficulty];
    const order = words.slice().sort((a, b) => b.letters.length - a.letters.length || (a.letters < b.letters ? -1 : 1));
    const counts = {};
    words.forEach((w) => w.letters.split("").forEach((ch) => { counts[ch] = (counts[ch] || 0) + 1; }));
    const total = Object.values(counts).reduce((s, v) => s + v, 0) || 1;
    const letters = ALPHABET.split("");
    const weights = letters.map((ch, i) => 0.5 * ENGLISH_FREQ[i] / 100 + 0.5 * (counts[ch] || 0) / total);
    const blockedNorm = [...new Set(blocked.map(normalize).filter((b) => b.length >= 3))];
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const rng = rngFrom(`${seed}:${attempt}`);
      const grid = Array.from({ length: size }, () => Array(size).fill(null));
      const axes = new Map();
      const placements = [];
      let complete = true;
      for (const word of order) {
        const placement = place(grid, axes, word, directions, rng);
        if (!placement) { complete = false; break; }
        placements.push(placement);
      }
      if (!complete) continue;
      const fixed = new Set(placements.flatMap((p) => cellsOf(p).map(([r, c]) => key(r, c))));
      for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) if (grid[r][c] === null) grid[r][c] = choose(rng, letters, weights);
      for (let repair = 0; repair < maxRepairs; repair += 1) {
        const bad = cellsToReroll(grid, placements, blockedNorm, fixed);
        if (bad === null) break;
        if (!bad.length) {
          return { size, difficulty, grid: grid.map((row) => row.join("")), placements: placements.map((p) => ({ ...p, cells: cellsOf(p) })) };
        }
        bad.forEach((k) => { grid[Math.floor(k / 1000)][k % 1000] = choose(rng, letters, weights); });
      }
    }
    return null;
  }

  /* La plus petite grille qui place tous les mots retenus, de 12 à 40 cases de côté. */
  function build(rawWords, difficulty, seed, blocked = []) {
    const prepared = prepareWords(rawWords, MAX_SIZE, blocked);
    if (!prepared.words.length) return { error: "no-words", rejected: prepared.rejected };
    const lettersCount = prepared.words.reduce((s, w) => s + w.letters.length, 0);
    const longest = Math.max(...prepared.words.map((w) => w.letters.length));
    let size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, longest + 1, Math.ceil(Math.sqrt(lettersCount / FILL))));
    for (; size <= MAX_SIZE; size += 1) {
      const puzzle = generate(prepared.words, size, difficulty, seed, blocked);
      if (puzzle) return { puzzle, rejected: prepared.rejected };
    }
    return { error: "too-many", rejected: prepared.rejected };
  }

  /* Contrôle indépendant : chaque mot une seule fois, à sa place, dans une direction permise. */
  function verify(puzzle, blocked = []) {
    const errors = [];
    const texts = lineTexts(puzzle.grid);
    puzzle.placements.forEach((p) => {
      if (!DIFFICULTY_DIRECTIONS[puzzle.difficulty].includes(p.direction)) errors.push(`${p.word.display}: direction`);
      if (p.cells.map(([r, c]) => puzzle.grid[r][c]).join("") !== p.word.letters) errors.push(`${p.word.display}: letters`);
      const count = find(texts, p.word.letters).length;
      if (count !== 1) errors.push(`${p.word.display}: found ${count} times`);
    });
    const own = puzzle.placements.map((p) => p.cells.map(([r, c]) => key(r, c)));
    blocked.map(normalize).filter((b) => b.length >= 3).forEach((word) => {
      find(texts, word).forEach((occ) => {
        if (!own.some((cells) => occ.every((k) => cells.includes(k)))) errors.push(`blocked word visible: ${word}`);
      });
    });
    return errors;
  }

  const api = { normalize, parseWords, prepareWords, build, generate, verify, DIFFICULTY_DIRECTIONS, MAX_SIZE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MMWordSearch = api;
}(typeof window !== "undefined" ? window : globalThis));
