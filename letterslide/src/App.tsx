import { useEffect, useMemo, useRef, useState } from "react";

// =============================
// Letter Slide – React Starter with True Dark Mode + Super Difficult mode
// Fixes and features:
// - Guards against undefined tiles during initial render
// - Safe top-row computation & safer board construction
// - True dark mode with system detection and manual toggle
// - NEW: Super Difficult mode with click-to-type guesses & Wordle-like feedback
// - Syntax-safe JSX quotes
// - Lightweight dev tests (+ a few extras)
// =============================

// --- Types
export type Mode = "easy" | "hard" | "super";
export type Theme = "system" | "light" | "dark";

type Tile = {
  id: number; // unique instance id (important for duplicate letters)
  char: string; // A-Z or "" for blank
  isTarget: boolean; // one of the letters that must live in the top row
  targetCol?: number; // only for target letters: which column they ultimately belong to (0-indexed)
};

type GameConfig = {
  size: number; // e.g., 3..6
  mode: Mode;
  word?: string; // optional for EASY; ignored if HARD/SUPER (word will be chosen)
};

// --- Small word lists by length (swap in a proper dictionary later)
const WORDS: Record<number, string[]> = {
  3: ["CAT", "SUN", "MAP", "BOX", "HAT"],
  4: ["CODE", "GAME", "PLAY", "WORD", "MATH"],
  5: ["APPLE", "LEVEL", "QUEST", "TRAIL", "SHIFT"],
  6: ["FLOWER", "PUZZLE", "BINARY", "MARKET", "BRIDGE"],
};

// --- Helpers
const rand = (n: number) => Math.floor(Math.random() * n);

// Super mode gating: sliding allowed only after a full-length guess is entered
export function canSlideInSuper(guessLen: number, size: number): boolean {
  return guessLen >= size;
}

// Guess helpers for Super mode (pure, testable)
export function appendGuess(current: string, ch: string, size: number): string {
  const clean = (ch || "").toUpperCase().replace(/[^A-Z]/g, "");
  return (current + clean).slice(0, size);
}
export function backspaceGuess(current: string): string {
  return current.length ? current.slice(0, -1) : "";
}

function pickWord(size: number, preferred?: string): string {
  const up = preferred?.toUpperCase();
  if (up && up.length === size && /^[A-Z]+$/.test(up)) return up;
  const bank = WORDS[size] ?? ["A".repeat(size)];
  return bank[rand(bank.length)];
}

function idx(r: number, c: number, size: number) {
  return r * size + c;
}

function rc(i: number, size: number) {
  return { r: Math.floor(i / size), c: i % size };
}

// Helper: does the current top row already contain any letter in the correct spot?
function hasAnyTopRowGreen(board: Tile[], size: number, secret: string): boolean {
  for (let c = 0; c < size; c++) {
    const t = board[idx(0, c, size)];
    if (t && t.char === secret[c]) return true;
  }
  return false;
}

// For SUPER mode we may want to avoid spoilers: keep shuffling until no
// top-row position matches its secret letter (bounded tries to avoid loops).
function ensureNoInitialTopRowGreens(board: Tile[], size: number, secret: string) {
  let tries = 0;
  const maxTries = 200;
  while (tries < maxTries && hasAnyTopRowGreen(board, size, secret)) {
    // Do a handful of additional random moves to shake the top row
    shuffleByRandomMoves(board, size, Math.max(size * 2, rand(size * size)));
    tries++;
  }
}

// Build a solved board safely and fully-initialized
function makeSolvedBoard(size: number, _mode: Mode, maybeWord?: string): { word: string; board: Tile[] } {
  const word = pickWord(size, maybeWord);
  const targetTiles: Tile[] = [...word].map((ch, i) => ({ id: i + 1, char: ch, isTarget: true, targetCol: i }));

  const total = size * size;
  const fillerCount = Math.max(0, total - targetTiles.length - 1); // -1 for the blank
  const fillers: Tile[] = Array.from({ length: fillerCount }, (_, k) => ({
    id: size + 1 + k,
    char: String.fromCharCode(65 + rand(26)),
    isTarget: false,
  }));

  const blank: Tile = { id: 0, char: "", isTarget: false };

  // Start from a guaranteed full array
  const board: Tile[] = [];
  // Top row = word
  for (let c = 0; c < size; c++) board.push(targetTiles[c]);
  // Fill remaining non-blank
  const pool = [...fillers];
  while (board.length < total - 1) {
    const next = pool.pop();
    board.push(next ?? { id: 10_000 + board.length, char: String.fromCharCode(65 + rand(26)), isTarget: false });
  }
  // Last cell blank
  board.push(blank);

  return { word, board };
}

function neighborsOfBlank(board: Tile[], size: number): number[] {
  const b = board.findIndex((t) => t && t.id === 0);
  if (b < 0) return [];
  const { r, c } = rc(b, size);
  const n: number[] = [];
  if (r > 0) n.push(idx(r - 1, c, size));
  if (r < size - 1) n.push(idx(r + 1, c, size));
  if (c > 0) n.push(idx(r, c - 1, size));
  if (c < size - 1) n.push(idx(r, c + 1, size));
  return n;
}

function swap(board: Tile[], i: number, j: number) {
  const tmp = board[i];
  board[i] = board[j];
  board[j] = tmp;
}

function shuffleByRandomMoves(board: Tile[], size: number, steps: number) {
  let prevBlank = -1;
  for (let s = 0; s < steps; s++) {
    const b = board.findIndex((t) => t && t.id === 0);
    if (b < 0) return; // safety guard
    const nbs = neighborsOfBlank(board, size).filter((i) => i !== prevBlank);
    if (nbs.length === 0) return; // safety guard
    const choice = nbs[rand(nbs.length)];
    swap(board, b, choice);
    prevBlank = b; // prevent immediate backtrack
  }
}

// SAFE top-row string builder: never assumes tiles exist
function topRowString(board: Tile[], size: number) {
  let s = "";
  for (let c = 0; c < size; c++) {
    const t = board[idx(0, c, size)];
    s += t && typeof t.char === "string" ? t.char : " ";
  }
  return s;
}

function manhattan(a: { r: number; c: number }, b: { r: number; c: number }) {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

// Lower-bound heuristic on moves needed for just the target tiles (ignores blank constraints)
function targetManhattanSum(board: Tile[], size: number) {
  let sum = 0;
  for (let i = 0; i < board.length; i++) {
    const t = board[i];
    if (!t || !t.isTarget || t.targetCol == null) continue;
    const cur = rc(i, size);
    const goal = { r: 0, c: t.targetCol };
    sum += manhattan(cur, goal);
  }
  return sum;
}

// Column feedback for HARD mode: for target tiles, are they in the correct column?
function isCorrectColumn(tile: Tile | undefined, i: number, size: number) {
  if (!tile || !tile.isTarget || tile.targetCol == null) return false;
  const { c } = rc(i, size);
  return c === tile.targetCol;
}

// Render helpers
function makePlaceholder(i: number): Tile {
  return { id: -1_000 - i, char: "", isTarget: false };
}

// System dark-mode hook
function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    const m = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPrefersDark(!!m && m.matches);
    onChange();
    if (!m) return;
    if (m.addEventListener) m.addEventListener("change", onChange);
    else m.addListener(onChange);
    return () => {
      if (m.removeEventListener) m.removeEventListener("change", onChange);
      else m.removeListener(onChange);
    };
  }, []);
  return prefersDark;
}

// --- Super mode evaluation (Wordle-like)
type Hint = "g" | "y" | "x"; // green (right column), yellow (present), gray (absent)
export type HintMap = Record<number, Hint>;

// SUPER mode evaluator that colors ONLY the tiles the player clicked.
// Rules:
//  • Green: clicked tile is a TARGET tile and is currently in its correct column.
//  • Yellow: clicked tile is a TARGET tile, letter appears in the secret but the tile is not in its correct column (dup letters respect counts).
//  • Gray: clicked tile is not a target tile for the secret (or letter count already exhausted).
function evaluateGuessFromPath(board: Tile[], size: number, secret: string, path: number[]): HintMap {
  // Policy B (column-credit):
  //  - Interpret the guess as letters per column (from the clicked path).
  //  - Greens: for column i, if guessed letter equals secret[i] and the target tile for i currently sits in column i.
  //            Color THAT target tile green (even if a different copy was clicked).
  //  - Yellows: for remaining guessed letters that exist elsewhere in the secret (respecting duplicate counts),
  //             color one unassigned TARGET tile with that letter yellow.
  //  - Grays: tiles the player clicked that didn't receive green/yellow become 'x' (we render these as a ring only).
  const hints: HintMap = {};
  if (!secret || path.length !== size) return hints;

  // Build the typed guess by reading letters at clicked positions
  const guessLetters: string[] = path.map((pos) => (board[pos]?.char || "").toUpperCase());

  // Remaining counts for each letter in the secret
  const counts: Record<string, number> = {};
  for (let i = 0; i < size; i++) counts[secret[i]] = (counts[secret[i]] || 0) + 1;

  // Helper: locate the target tile object for a given column (by intended targetCol)
  const targetTileForCol: (col: number) => Tile | undefined = (col) =>
    board.find((t) => t && t.isTarget && t.targetCol === col && t.char === secret[col]);

  const assignedTileIds = new Set<number>();

  // Pass 1: GREENS by column credit
  for (let col = 0; col < size; col++) {
    const gch = guessLetters[col];
    if (gch !== secret[col]) continue;
    const t = targetTileForCol(col);
    if (!t) continue;
    const tIndex = board.findIndex((tt) => tt.id === t.id);
    if (tIndex < 0) continue;
    const { c } = rc(tIndex, size);
    if (c === col && (counts[gch] || 0) > 0) {
      hints[t.id] = "g";
      assignedTileIds.add(t.id);
      counts[gch]! -= 1;
    }
  }

  // Pass 2: YELLOWS for remaining guessed letters that still have counts
  // We assign to any unassigned TARGET tile with that letter.
  for (let col = 0; col < size; col++) {
    const gch = guessLetters[col];
    if ((counts[gch] || 0) <= 0) continue;
    // Skip if already satisfied by a green in this column
    if (gch === secret[col]) {
      const t = targetTileForCol(col);
      if (t && hints[t.id] === "g") continue;
    }
    const candidate = board.find(
      (t) => t && t.isTarget && !assignedTileIds.has(t.id) && t.char === gch
    );
    if (candidate) {
      hints[candidate.id] = "y";
      assignedTileIds.add(candidate.id);
      counts[gch]! -= 1;
    }
  }

  // Pass 3: GRAYS for clicked tiles that weren't assigned (we render these as rings only)
  for (const pos of path) {
    const t = board[pos];
    if (!t || t.id === 0) continue;
    if (hints[t.id] === undefined) hints[t.id] = "x";
  }

  return hints;
}

// NEW: Global highlight evaluator for Policy B' (set-based, column-credit greens + global yellows)
function evaluateGuessGlobal(board: Tile[], size: number, secret: string, guessRaw: string): HintMap {
  const hints: HintMap = {};
  const guess = guessRaw.toUpperCase().replace(/[^A-Z]/g, "");
  // Do not color anything until there is at least one letter in the guess
  if (!secret || guess.length === 0) return hints;

  const guessSet = new Set<string>([...guess]);
  const secretSet = new Set<string>([...secret]);
  const includeSet = new Set<string>([...guessSet].filter((ch) => secretSet.has(ch)));
  const excludeSet = new Set<string>([...guessSet].filter((ch) => !secretSet.has(ch)));

  for (let i = 0; i < board.length; i++) {
    const t = board[i];
    if (!t || t.id === 0) continue;
    const { r, c } = rc(i, size);
    // Green if the letter that currently sits in the TOP ROW column matches the secret for that column
    if (r === 0 && t.char === secret[c]) {
      hints[t.id] = "g";
      continue;
    }
    if (excludeSet.has(t.char)) {
      hints[t.id] = "x";
      continue;
    }
    if (includeSet.has(t.char)) {
      hints[t.id] = "y";
    }
  }

  return hints;
}

// Live upgrade logic for Super mode: promote to green when a tile sits in its correct TOP-ROW column
function superEffectiveHint(
  tile: Tile,
  index: number,
  size: number,
  hints: HintMap,
  secret: string
): Hint | undefined {
  const { r, c } = rc(index, size);
  if (r === 0 && tile.char === secret[c]) return "g";
  const h = hints[tile.id];
  if (!h) return undefined;
  if (h === "g") return "g";
  if (h === "y") return "y";
  if (h === "x") return "x";
  return undefined;
}

// --- React Component
export default function LetterSlideApp({ initial }: { initial?: Partial<GameConfig> }) {
  const initialSize = initial?.size ?? 5;
  const initialMode: Mode = initial?.mode ?? "super";

  const [size, setSize] = useState(initialSize);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [theme, setTheme] = useState<Theme>("system");
  const prefersDark = usePrefersDark();
  const isDark = theme === "dark" || (theme === "system" && prefersDark);

  const [secret, setSecret] = useState<string>("");
  const [board, setBoard] = useState<Tile[]>([]);
  const [moves, setMoves] = useState(0);
  const [running, setRunning] = useState(false);
  const [secs, setSecs] = useState(0);
  const [won, setWon] = useState(false);

  // Super mode state
  const [guess, setGuess] = useState("");
  const [guessPath, setGuessPath] = useState<number[]>([]);
  const [hints, setHints] = useState<HintMap>({});
  const [missLetters, setMissLetters] = useState<Set<string>>(new Set());
  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [spinning, setSpinning] = useState(false);
  const [spinTick, setSpinTick] = useState(0);
  const [hasGuessedOnce, setHasGuessedOnce] = useState(false);

  const timerRef = useRef<number | null>(null);

  // (Re)start a game
  const startGame = (desiredWord?: string) => {
    const { word, board } = makeSolvedBoard(size, mode, desiredWord);
    shuffleByRandomMoves(board, size, Math.max(50, size * size * 20));
    if (mode === "easy" && topRowString(board, size).trim() === word) {
      shuffleByRandomMoves(board, size, 30);
    }
    // NEW: For SUPER, avoid initial spoilers — no greens in the top row
    if (mode === "super") {
      ensureNoInitialTopRowGreens(board, size, word);
    }

    setSecret(word);
    setBoard([...board]);
    setMoves(0);
    setSecs(0);
    setWon(false);
    setRunning(false);
    setGuess("");
    setGuessPath([]);
    setHints({});
    setMissLetters(new Set());
    setHasGuessedOnce(false);
    if (timerRef.current) window.clearInterval(timerRef.current);
  };

  useEffect(() => {
    startGame(initial?.word);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, mode]);

  // intro overlay visibility follows mode
  useEffect(() => {
    setShowIntro(mode === "super");
  }, [mode]);

  // spinning animation driver
  useEffect(() => {
    if (!spinning) return;
    const intId = window.setInterval(() => setSpinTick((t) => t + 1), 60);
    const toId = window.setTimeout(() => {
      setSpinning(false);
      window.clearInterval(intId);
    }, 900);
    return () => {
      window.clearInterval(intId);
      window.clearTimeout(toId);
    };
  }, [spinning]);

  // timer
  useEffect(() => {
    if (!running || won) return;
    timerRef.current = window.setInterval(() => setSecs((s) => s + 1), 1000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [running, won]);

  const onTileClick = (i: number) => {
    if (won) return;
    if (board.length !== size * size) return;

    // SUPER: clicks build the guess until it's full; sliding is disabled until then
    if (mode === "super" && !canSlideInSuper(guess.length, size)) {
      const t = board[i];
      if (!t || t.id === 0) return; // ignore blank
      const newPath = [...guessPath, i];
      const next = appendGuess(guess, t.char, size);
      setGuess(next);
      setGuessPath(newPath);
      // First tap starts coloring for the session
      if (!hasGuessedOnce && next.length > 0) setHasGuessedOnce(true);
      // Incremental coloring as letters are entered
      setHints(evaluateGuessGlobal(board, size, secret, next));
      // Persistently gray letters that aren't in the secret
      if (!secret.includes(t.char)) {
        setMissLetters((prev) => new Set([...Array.from(prev), t.char]));
      }
      if (next.length === size) {
        setGuessPath([]);
      }
      return; // no sliding before first full guess
    }

    // Sliding behavior (all modes, and SUPER after first full guess)
    const b = board.findIndex((t) => t.id === 0);
    if (b < 0) return;
    const { r: br, c: bc } = rc(b, size);
    const { r: tr, c: tc } = rc(i, size);
    const isAdj = Math.abs(br - tr) + Math.abs(bc - tc) === 1;
    if (!isAdj) return;
    const nextBoard = [...board];
    swap(nextBoard, b, i);
    if (!running) setRunning(true);
    setBoard(nextBoard);
    setMoves((m) => m + 1);
  };

  const goalMet = useMemo(() => {
    const currentTop = topRowString(board, size);
    return currentTop === secret; // same win check across modes
  }, [board, size, secret]);

  useEffect(() => {
    if (goalMet && !won) {
      setWon(true);
      setRunning(false);
      if (timerRef.current) window.clearInterval(timerRef.current);
    }
  }, [goalMet, won]);

  const targetLowerBound = useMemo(() => targetManhattanSum(board, size), [board, size]);

  // Always render a full grid; if board isn't ready, use placeholders
  const renderBoard: Tile[] = useMemo(() => {
    const total = size * size;
    if (board.length === total) return board;
    return Array.from({ length: total }, (_, i) => board[i] ?? makePlaceholder(i));
  }, [board, size]);

  // Palette based on theme
  const palette = isDark
    ? {
        pageBg: "bg-slate-900",
        pageText: "text-slate-100",
        controlBg: "bg-slate-800 border-slate-600 text-slate-100 hover:bg-slate-700 active:bg-slate-700",
        selectBg: "bg-slate-800 border-slate-600 text-slate-100",
        border: "border-slate-600",
        tileText: "text-slate-100",
        tileBlank: "bg-slate-800 border-dashed",
        tileWrong: "bg-amber-600",
        tileRight: "bg-emerald-600",
        tileNeutral: "bg-slate-700",
        panelBg: "bg-slate-800 border-slate-600",
        winBg: "bg-emerald-900 border-emerald-700 text-emerald-100",
        guessMiss: "bg-slate-600",
      }
    : {
        pageBg: "bg-white",
        pageText: "text-neutral-900",
        controlBg: "bg-white border-neutral-300 hover:bg-neutral-50 active:bg-neutral-100",
        selectBg: "bg-white border-neutral-300",
        border: "border-neutral-300",
        tileText: "text-neutral-900",
        tileBlank: "bg-neutral-100 border-dashed",
        tileWrong: "bg-yellow-300",
        tileRight: "bg-green-300",
        tileNeutral: "bg-white",
        panelBg: "bg-slate-50 border",
        winBg: "bg-emerald-100 border-emerald-300 text-emerald-900",
        guessMiss: "bg-neutral-300",
      };

  // --- Lightweight dev tests (rendered in a collapsible panel)
  type TestResult = { name: string; passed: boolean; details?: string };
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);

  const runTests = () => {
    const results: TestResult[] = [];

    const safeTopRowNoCrash = () => {
      try {
        const s = topRowString([], 4);
        results.push({ name: "topRowString safe on empty board", passed: typeof s === "string" && s.length === 4 });
      } catch (e) {
        results.push({ name: "topRowString safe on empty board", passed: false, details: String(e) });
      }
    };

    const solvedBoardIsFull = () => {
      const { board } = makeSolvedBoard(4, "easy", "WORD");
      const top = topRowString(board, 4);
      const full = board.length === 16 && board.every((t) => t && typeof t.char === "string");
      results.push({ name: "makeSolvedBoard produces full board", passed: full && top === "WORD" });
    };

    const shuffleKeepsChars = () => {
      const { board } = makeSolvedBoard(5, "easy", "LEVEL");
      shuffleByRandomMoves(board, 5, 200);
      const valid = board.length === 25 && board.filter((t) => t.id === 0).length === 1 && board.every((t) => typeof t.char === "string");
      results.push({ name: "shuffle keeps board integrity", passed: valid });
    };

    const manhattanNonNegative = () => {
      const { board } = makeSolvedBoard(3, "easy", "CAT");
      const h = targetManhattanSum(board, 3);
      results.push({ name: "targetManhattanSum >= 0", passed: typeof h === "number" && h >= 0 });
    };

    const correctColumnLogic = () => {
      const { board } = makeSolvedBoard(3, "easy", "CAT");
      const ok = [0, 1, 2].every((c) => isCorrectColumn(board[c], c, 3));
      results.push({ name: "isCorrectColumn true for solved top row", passed: ok });
    };

    // Additional tests
    const pickWordMatchesSize = () => {
      const w = pickWord(6);
      results.push({ name: "pickWord length matches grid size", passed: w.length === 6 });
    };

    const placeholderGridSafe = () => {
      const total = 4 * 4;
      const temp: Tile[] = Array.from({ length: total }, (_, i) => (i < 5 ? makePlaceholder(i) : { id: i + 1, char: "A", isTarget: false }));
      const safe = temp.length === total && temp.every((t) => typeof t.char === "string");
      results.push({ name: "placeholder tiles are valid", passed: safe });
    };

    const targetCountEqualsSize = () => {
      const { board } = makeSolvedBoard(5, "easy", "APPLE");
      const count = board.filter((t) => t.isTarget).length;
      results.push({ name: "target tiles count equals grid size", passed: count === 5 });
    };

    const topRowStringLength = () => {
      const { board } = makeSolvedBoard(4, "easy", "WORD");
      const s = topRowString(board.slice(0, 10), 4); // even if truncated array
      results.push({ name: "topRowString returns size-length string", passed: typeof s === "string" && s.length === 4 });
    };

    const evalGuessGreensWork = () => {
      const { board, word } = makeSolvedBoard(4, "easy", "WORD");
      // Path = click the top-row tiles left-to-right
      const path = [0, 1, 2, 3];
      const m = evaluateGuessFromPath(board, 4, word, path);
      const greens = Object.values(m).filter((v) => v === "g").length;
      results.push({ name: "evaluateGuessFromPath all green on exact match", passed: greens === 4 });
    };

    const evalGuessGreensEqualCorrectColumns = () => {
      const { board, word } = makeSolvedBoard(4, "easy", "WORD");
      // Swap first two columns (W<->O)
      const t0 = 0; const t1 = 1; const tmp = board[t0]; board[t0] = board[t1]; board[t1] = tmp;
      const path = [0, 1, 2, 3];
      const m = evaluateGuessFromPath(board, 4, word, path);
      const greens = Object.values(m).filter((v) => v === "g").length;
      // R and D remain in their correct columns
      results.push({ name: "greens equal number of clicked tiles already in correct columns", passed: greens === 2 });
    };

    const evalGuessRejectWrongLength = () => {
      const { board, word } = makeSolvedBoard(4, "easy", "WORD");
      const path = [0, 1, 2]; // wrong length
      const m = evaluateGuessFromPath(board, 4, word, path);
      results.push({ name: "evaluateGuessFromPath ignores wrong length", passed: Object.keys(m).length === 0 });
    };

    // NEW: Global evaluator tests
    const globalGreensOnTopRow = () => {
      const { board, word } = makeSolvedBoard(4, "easy", "WORD");
      // board is solved; every top-row tile should be green for any non-empty guess containing those letters
      const m = evaluateGuessGlobal(board, 4, word, "WORD");
      const greens = Object.values(m).filter((v) => v === "g").length;
      results.push({ name: "evaluateGuessGlobal greens on correct top row", passed: greens >= 4 });
    };

    const globalMarksAbsentAsGray = () => {
      const { board, word } = makeSolvedBoard(4, "easy", "WORD");
      const m = evaluateGuessGlobal(board, 4, word, "ZZZZ");
      const hasGray = Object.values(m).some((v) => v === "x");
      results.push({ name: "evaluateGuessGlobal marks absent letters gray", passed: hasGray });
    };

    const globalNoHintsOnEmptyGuess = () => {
      const { board, word } = makeSolvedBoard(4, "easy", "WORD");
      const m = evaluateGuessGlobal(board, 4, word, "");
      results.push({ name: "evaluateGuessGlobal no hints on empty guess", passed: Object.keys(m).length === 0 });
    };

    const superNoInitialGreens = () => {
      const { board, word } = makeSolvedBoard(5, "super", "LEVEL");
      shuffleByRandomMoves(board, 5, 300);
      ensureNoInitialTopRowGreens(board, 5, word);
      const hasGreens = hasAnyTopRowGreen(board, 5, word);
      results.push({ name: "SUPER start has no initial top-row greens", passed: hasGreens === false });
    };

    safeTopRowNoCrash();
    solvedBoardIsFull();
    shuffleKeepsChars();
    manhattanNonNegative();
    correctColumnLogic();
    pickWordMatchesSize();
    placeholderGridSafe();
    targetCountEqualsSize();
    topRowStringLength();
    evalGuessGreensWork();
    evalGuessGreensEqualCorrectColumns();

    // After-eval upgrade: yellow should become green when moved into correct column
    const yellowUpgradesToGreen = () => {
      const { board, word } = makeSolvedBoard(4, "easy", "WORD");
      // Swap W and O so W is in wrong column
      const tmp = board[0]; board[0] = board[1]; board[1] = tmp;
      const path = [0, 1, 2, 3];
      const hints = evaluateGuessFromPath(board, 4, word, path);
      const wTile = board[1]; // W is now at index 1
      const effNow = superEffectiveHint(wTile, 1, 4, hints, word); // should be yellow
      const effAsIfMoved = superEffectiveHint(wTile, 0, 4, hints, word); // would become green at col 0
      results.push({ name: "yellow promotes to green when in correct column", passed: effNow === "y" && effAsIfMoved === "g" });
    };
    yellowUpgradesToGreen();
    evalGuessRejectWrongLength();
    globalGreensOnTopRow();
    globalMarksAbsentAsGray();
    globalNoHintsOnEmptyGuess();
    superNoInitialGreens();

    // canSlideInSuper tests
    const gatingBeforeFullGuess = () => {
      results.push({ name: "canSlideInSuper false before full guess", passed: canSlideInSuper(3, 4) === false });
    };
    const gatingAfterFullGuess = () => {
      results.push({ name: "canSlideInSuper true at full guess", passed: canSlideInSuper(4, 4) === true });
    };
    gatingBeforeFullGuess();
    gatingAfterFullGuess();

    // Super input helpers tests
    const guessAppendRespectsSize = () => {
      const g1 = appendGuess("", "a", 4);
      const g2 = appendGuess(g1, "b", 4);
      const g3 = appendGuess(g2, "C", 4);
      const g4 = appendGuess(g3, "-", 4); // ignored non-letter
      const g5 = appendGuess(g4, "D", 4);
      const g6 = appendGuess(g5, "E", 4); // capped at size
      results.push({ name: "appendGuess uppercases and caps length", passed: g5 === "ABCD" && g6 === "ABCD" });
    };
    const guessBackspaceSafe = () => {
      const g = backspaceGuess("");
      results.push({ name: "backspaceGuess safe on empty", passed: g === "" });
    };
    guessAppendRespectsSize();
    guessBackspaceSafe();

    setTestResults(results);
  };

  const rootCardClasses = `w-full max-w-3xl mx-auto p-4 select-none rounded-2xl shadow-lg ${palette.pageBg} ${palette.pageText}`;
  const btnBase = `border rounded px-3 py-1 ${palette.controlBg}`;
  const selectBase = `border rounded px-2 py-1 ${palette.selectBg}`;
  const tileBorder = `${palette.border}`;

  return (
    <div className={rootCardClasses} style={{ colorScheme: isDark ? "dark" : "light" }}>
      <header className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Letter Slide</h1>
          <p className="text-sm opacity-70">Arrange the top row to form the word.</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select className={selectBase} value={size} onChange={(e) => setSize(parseInt(e.target.value))}>
            {[3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>{n}×{n}</option>
            ))}
          </select>
          <select className={selectBase} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="easy">Easy (word shown)</option>
            <option value="hard">Mystery (word hidden)</option>
            <option value="super">Super Difficult (enter guesses)</option>
          </select>
          <select className={selectBase} value={theme} onChange={(e) => setTheme(e.target.value as Theme)} aria-label="Theme">
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <button className={btnBase} onClick={() => startGame()}>New</button>
        </div>
      </header>

      {/* Word display / hints */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex-1">
          {mode === "easy" ? (
            <div className="font-mono text-lg tracking-widest">Target: <span className="font-bold">{secret}</span></div>
          ) : mode === "hard" ? (
            <div className="font-mono text-lg tracking-widest">Target: <span className="opacity-50">????{" ".repeat(Math.max(0, size - 4))}</span> <span className="text-xs opacity-60">(mystery)</span></div>
          ) : (
            <div className="font-mono text-lg tracking-widest">Super mode: <span className="opacity-70">tap letters on the grid to enter a {size}-letter guess (sliding unlocks after your first full guess)</span></div>
          )}
          <div className="text-xs opacity-70">Lower bound (target Manhattan): {targetLowerBound}</div>
        </div>
        <div className="text-right">
          <div className="text-sm">Moves: <span className="font-semibold">{moves}</span></div>
          <div className="text-sm">Time: <span className="font-semibold">{Math.floor(secs / 60)}:{(secs % 60).toString().padStart(2, "0")}</span></div>
        </div>
      </div>

      {/* Grid */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0,1fr))` }}
      >
        {renderBoard.map((t, i) => {
          const isBlank = t.id === 0;
          // Visual feedback rules
          let eff: Hint | undefined = undefined;
          let base: string;
          if (isBlank) {
            base = palette.tileBlank;
          } else if (mode === "hard") {
            const correctCol = isCorrectColumn(t, i, size);
            base = t.isTarget ? (correctCol ? palette.tileRight : palette.tileWrong) : palette.tileNeutral;
          } else if (mode === "super") {
            if (!hasGuessedOnce) {
              base = palette.tileNeutral;
            } else if (missLetters.has(t.char)) {
              base = palette.guessMiss;
            } else {
              eff = superEffectiveHint(t, i, size, hints, secret);
              base = eff === "g" ? palette.tileRight : eff === "y" ? palette.tileWrong : palette.tileNeutral;
            }
          } else {
            // easy: just show targets in yellow so players know which letters matter
            base = t.isTarget ? palette.tileWrong : palette.tileNeutral;
          }

          const classes = `aspect-square rounded-xl border ${tileBorder} flex items-center justify-center font-bold text-xl ${palette.tileText} ${base}`;

          return (
            <button
              key={t.id + ":" + i}
              className={classes}
              onClick={() => onTileClick(i)}
              aria-label={isBlank ? "blank" : t.char || ""}
              disabled={board.length !== size * size}
            >
              {isBlank ? "" : (
                <span className={`font-mono ${spinning ? "animate-spin" : ""}`}>
                  {spinning ? String.fromCharCode(65 + ((i + spinTick) % 26)) : t.char}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {mode === "easy" && (
          <button className={btnBase} onClick={() => startGame(secret)}>Re-shuffle same word</button>
        )}
        {mode === "hard" && (
          <>
            <button className={btnBase} onClick={() => startGame()}>Re-shuffle mystery</button>
            <button className={btnBase} onClick={() => alert(`Hint: the ${size}-letter word starts with ${secret[0]}`)}>Hint: first letter</button>
          </>
        )}
        {mode === "super" && (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Read-only guess field populated by tile clicks */}
            <input
              className={`${selectBase} font-mono`}
              type="text"
              value={guess}
              readOnly
              placeholder={`${size}-letter guess`}
              aria-label="Guess (click tiles to enter)"
              onKeyDown={(e) => {
                if (e.key === "Backspace") { setGuess(backspaceGuess(guess)); setGuessPath(guessPath.slice(0, -1)); }
                if (e.key === "Enter" && guess.length === size) { setHints(evaluateGuessGlobal(board, size, secret, guess)); setGuessPath([]); const gs = new Set(guess.toUpperCase()); const ss = new Set(secret); const not = Array.from(gs).filter((ch)=>!ss.has(ch)); setMissLetters((prev)=> new Set([...Array.from(prev), ...not])); }
              }}
              style={{ width: `${Math.max(6, size + 4)}ch` }}
            />
            <button className={btnBase} onClick={() => setGuess(backspaceGuess(guess))} disabled={guess.length === 0} title="Backspace">⌫</button>
            <button className={btnBase} onClick={() => { setGuess(""); setGuessPath([]); setHints({}); }} title="Clear guess">Clear</button>
            <button
              className={btnBase}
              onClick={() => { setHints(evaluateGuessGlobal(board, size, secret, guess)); setGuessPath([]); const gs = new Set(guess.toUpperCase()); const ss = new Set(secret); const not = Array.from(gs).filter((ch)=>!ss.has(ch)); setMissLetters((prev)=> new Set([...Array.from(prev), ...not])); }}
              disabled={guess.length !== size}
            >
              Submit
            </button>
          </div>
        )}
        <button className={btnBase} onClick={() => setRunning((r) => !r)}>{running && !won ? "Pause" : "Start"}</button>
        <button className={btnBase} onClick={() => startGame()}>Reset</button>
        {/* Dev tests */}
        <button className={`${btnBase} ml-auto`} onClick={runTests}>Run tests</button>
      </div>

      {/* Test results panel */}
      {testResults && (
        <div className={`mt-4 p-3 rounded-2xl border ${palette.panelBg}`}>
          <div className="font-semibold mb-2">Dev tests</div>
          <ul className="text-sm list-disc pl-5">
            {testResults.map((t) => (
              <li key={t.name} className={t.passed ? "text-green-600" : "text-red-600"}>
                {t.passed ? "✅" : "❌"} {t.name}
                {t.details ? <span className="opacity-70"> - {t.details}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-6 text-xs opacity-60">
        <p>
          Rules: Slide tiles into the blank to arrange the <strong>top row</strong>.
          <em>Easy</em>: goal word shown. <em>Mystery</em>: target tiles highlighted (yellow), turn green when in the correct column.
          <em> Super</em>: <strong>tap letters on the grid</strong> to build a {size}-letter guess; tiles turn green if a tile sits in its correct top-row column of the secret word, yellow if the letter is in the word, and gray if the letter is not in the word (stays gray). Sliding is disabled until you enter your first full guess; Clear the guess to enter a new one and re-lock sliding.
        </p>
      </footer>

      {/* Intro overlay (Super mode) */}
      {mode === "super" && showIntro && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className={`max-w-md w-full rounded-2xl border ${palette.panelBg} ${palette.pageText} p-4 text-sm`}>
            <h2 className="text-lg font-semibold mb-2">Super Difficult</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Figure out the hidden word.</li>
              <li>Solve by moving letters into the <span className="font-semibold">top row</span>.</li>
              <li>Tap letters to guess. <span className="font-semibold">Green</span> = correct top-row column, <span className="font-semibold">Yellow</span> = in the word, <span className="font-semibold">Gray</span> = not in the word (stays gray).</li>
            </ul>
            <div className="mt-4 text-right">
              <button className={btnBase} onClick={() => { setShowIntro(false); setSpinning(true); }}>Ready to play</button>
            </div>
          </div>
        </div>
      )}

      {/* Win overlay */}
      {won && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className={`max-w-sm w-full rounded-2xl border ${palette.winBg} p-4`}>
            <h2 className="text-lg font-semibold mb-2">You solved it!</h2>
            <p className="text-sm mb-3">Word: <span className="font-mono font-bold">{secret}</span><br/>Moves: {moves} · Time: {Math.floor(secs / 60)}:{(secs % 60).toString().padStart(2, "0")}</p>
            <div className="text-right">
              <button className={btnBase} onClick={() => startGame()}>Play again</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
