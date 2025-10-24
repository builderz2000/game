import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

// =============================================================
// Letter Slide — Single Mode (Free Solve, Any Row)
// - Board has N rows; each row r has a hidden real word of length N
// - The multiset of all letters on the board equals the letters of all row words
// - Swap ANY two tiles (click-select twice, or drag one onto another)
// - Coloring is LIVE and duplicate-safe:
//     • green  = letter sits in the correct cell (correct row AND correct column)
//     • orange = letter belongs to this row but wrong column (row match)
//     • yellow = letter belongs to this column but wrong row (column match)
//     • gray   = letter belongs to neither the row nor the column
//   Priority: green > orange > yellow > gray. Duplicates are handled by counts.
// - Rows can be solved in ANY order; a solved row locks (cannot move its tiles)
// - Win when all rows are solved OR you run out of meter (0 = out of time)
// - Mobile friendly: drag-to-swap, FLIP animation, light/dark theme
// =============================================================

// ---------- Types
export type Theme = "system" | "light" | "dark";

type Tile = { id: number; char: string };
export type Hint = "g" | "o" | "y" | "x"; // green, orange(row), yellow(col), gray

type RowSecret = { word: string };


// ---------- Tunables (scoring / meter)
const SCORE_START = 100;           // initial meter (also the visual bar cap)
const SCORE_CAP = 100;             // max shown in the bar (we clamp for clarity)
const DECAY_PER_SEC = 1.5;           // continuous decay per second
const MOVE_PENALTY = 2;            // cost per swap
const GREEN_BONUS = 5;             // reward when a tile becomes green for the first time
const ROW_SOLVED_BONUS_PER_SIZE = 5; // per-size bonus when a row locks (5 * size)

// ---------- Word list (expanded; no proper nouns)
const WORDS: Record<number, string[]> = {
  3: [
    "CAT","DOG","SUN","MAP","BOX","HAT","CAR","BUS","ANT","BEE","FOX","OWL","BAT","JAR","KEY","LIP","MUG","PEN","RUG","EGG"
  ],
  4: [
    "CODE","GAME","PLAY","WORD","MATH","TREE","LEAF","FISH","BIRD","LION","WOLF","FIRE","WIND","SNOW","RAIN","STAR","MOON","SHIP","ROAD","BOOK","DOOR","MILK","BREAD","CORN"
  ],
  5: [
    "APPLE","LEVEL","QUEST","TRAIL","SHIFT","ABOUT","AFTER","AGAIN","OTHER","HEART","PLANT","GRAPE","MANGO","TIGER","RIVER","MUSIC","LIGHT","SOUND","BREAD","WATER","EARTH","WORLD","SMILE","CHAIR","TABLE","POINT","RIGHT","UNDER","GREEN","BROWN","BLACK","WHITE","STONE","FIELD","HOUSE","BRICK","PLANE","TRAIN","CLOUD","STORM","SHINE","QUIET","NOISE","HAPPY","TIMES","QUICK","SWEET","SHARP","ROUND"
  ],
  6: [
    "FLOWER","PUZZLE","BINARY","MARKET","BRIDGE","ORANGE","PURPLE","YELLOW","SILVER","NATURE","RIVERS","GALAXY","PLANET","STREAM","THINGS","LETTER","SPIRIT","WINDOW","GARDEN","SCHOOL","FRIEND","ANIMAL","PEOPLE","FUTURE","PENCIL","NUMBER","POCKET","CAMERA","PILLOW","MARKER","BUTTON","CHERRY","BANANA","BOTTLE","FOLLOW","SPRING","SUMMER","AUTUMN","WINTER","CANDLE","CRAYON","DANCER","ENGINE","FABRIC","GOBLET","HANDLE","INSECT"
  ]
};

// ---------- Helpers
const rand = (n: number) => Math.floor(Math.random() * n);
const idx = (r: number, c: number, size: number) => r * size + c;
const rc = (i: number, size: number) => ({ r: Math.floor(i / size), c: i % size });
const swapArr = <T,>(a: T[], i: number, j: number) => { const t = a[i]; a[i] = a[j]; a[j] = t; };

function rowString(board: Tile[], size: number, r: number) {
  let s = "";
  for (let c = 0; c < size; c++) s += board[idx(r, c, size)]?.char ?? " ";
  return s;
}

function pickWord(size: number, preferred?: string) {
  const up = preferred?.toUpperCase();
  if (up && up.length === size && /^[A-Z]+$/.test(up)) return up;
  const pool = WORDS[size] ?? ["A".repeat(size)];
  return pool[rand(pool.length)];
}

// Campaign words and board
function chooseCampaignWords(size: number, preferredFirst?: string): string[] {
  const first = pickWord(size, preferredFirst);
  const pool = WORDS[size] ?? [first];
  const words: string[] = [first];
  while (words.length < size) words.push(pool[rand(pool.length)]);
  return words;
}

function makeCampaignBoard(size: number, maybeWord?: string): { words: string[]; board: Tile[] } {
  const words = chooseCampaignWords(size, maybeWord);
  const board: Tile[] = [];
  for (let r = 0; r < size; r++) {
    const w = words[r];
    for (let c = 0; c < size; c++) board.push({ id: r * size + c + 1, char: w[c] });
  }
  shuffleByAdjSwaps(board, size, Math.max(300, size * size * 10));
  return { words, board };
}

// Shuffle by adjacent swaps (no blank tile)
function shuffleByAdjSwaps(board: Tile[], size: number, steps: number) {
  for (let s = 0; s < steps; s++) {
    const a = rand(board.length);
    const r = Math.floor(a / size), c = a % size;
    const neigh: number[] = [];
    if (r > 0) neigh.push(idx(r - 1, c, size));
    if (r < size - 1) neigh.push(idx(r + 1, c, size));
    if (c > 0) neigh.push(a - 1);
    if (c < size - 1) neigh.push(a + 1);
    const b = neigh[rand(neigh.length)];
    swapArr(board, a, b);
  }
}

// ---------- Duplicate-safe color evaluation (global, any-order rows)
// Priority: green > orange(row) > yellow(col) > gray
function computeMarks(board: Tile[], size: number, secrets: RowSecret[], locked: Set<number>): Map<number, Hint> {
  const total = size * size;
  const marks = new Map<number, Hint>();

  // Greens first
  const rowNeed: Array<Record<string, number>> = Array.from({ length: size }, (_, r) => {
    const need: Record<string, number> = {};
    const w = secrets[r].word;
    for (let k = 0; k < size; k++) need[w[k]] = (need[w[k]] || 0) + 1;
    return need;
  });
  const colNeed: Array<Record<string, number>> = Array.from({ length: size }, (_, c) => {
    const need: Record<string, number> = {};
    for (let r = 0; r < size; r++) {
      const ch = secrets[r].word[c];
      need[ch] = (need[ch] || 0) + 1;
    }
    return need;
  });

  // pass 1: mark greens and decrement both row & col needs
  for (let i = 0; i < total; i++) {
    const t = board[i]; if (!t) continue;
    const { r, c } = rc(i, size);
    if (secrets[r].word[c] === t.char) {
      marks.set(t.id, "g");
      rowNeed[r][t.char]!--;
      colNeed[c][t.char]!--;
    }
  }

  // pass 2: row oranges (correct row, wrong col), skip rows already locked (they are all greens anyway)
  for (let r = 0; r < size; r++) {
    if (locked.has(r)) continue;
    for (let c = 0; c < size; c++) {
      const i = idx(r, c, size); const t = board[i]; if (!t) continue;
      if (marks.has(t.id)) continue; // already green
      const ch = t.char;
      // letter is wanted by this row (somewhere) and column isn't the right one for this row
      if ((rowNeed[r][ch] || 0) > 0 && secrets[r].word[c] !== ch) {
        marks.set(t.id, "o");
        rowNeed[r][ch]!--;
      }
    }
  }

  // pass 3: column yellows (correct column, wrong row)
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) {
      const i = idx(r, c, size); const t = board[i]; if (!t) continue;
      if (marks.has(t.id)) continue; // green/orange already
      const ch = t.char;
      if ((colNeed[c][ch] || 0) > 0 && secrets[r].word[c] !== ch) {
        marks.set(t.id, "y");
        colNeed[c][ch]!--;
      }
    }
  }

  // pass 4: the rest are gray
  for (let i = 0; i < total; i++) {
    const t = board[i]; if (!t) continue;
    if (!marks.has(t.id)) marks.set(t.id, "x");
  }

  return marks;
}

// Count new tile IDs that became green (and aren't rewarded yet)
function newlyGreenIDs(prev: Map<number, Hint>, next: Map<number, Hint>, already: Set<number>): number[] {
  const gained: number[] = [];
  next.forEach((h, id) => {
    if (h === 'g') {
      const before = prev.get(id);
      if (before !== 'g' && !already.has(id)) gained.push(id);
    }
  });
  return gained;
}

// ---------- Dark mode (system-aware)
function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setPrefersDark(!!m.matches);
    on();
    if (typeof m.addEventListener === "function") {
      m.addEventListener("change", on);
      return () => m.removeEventListener("change", on);
    } else if (typeof (m as any).addListener === "function") {
      (m as any).addListener(on);
      return () => (m as any).removeListener(on);
    }
    return () => {};
  }, []);
  return prefersDark;
}

// ======================================================
// App (single mode — free solve)
// ======================================================
export default function App() {
  // Core state
  const [size, setSize] = useState(5);

  // Campaign-first init
  const campInit = useMemo(() => makeCampaignBoard(5), []);
  const [board, setBoard] = useState<Tile[]>((() => campInit.board));
  const [rowSecrets, setRowSecrets] = useState<RowSecret[]>((() => campInit.words.map((w) => ({ word: w }))));

  // Rows solved can be in ANY order
  const [lockedRows, setLockedRows] = useState<Set<number>>(new Set());

  // Game meta
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [won, setWon] = useState(false);
  const [lost, setLost] = useState(false);
  const [rowCleared, setRowCleared] = useState<number | null>(null);
  const [hideWin, setHideWin] = useState(false);
  const [celebrateRow, setCelebrateRow] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [showIntro, setShowIntro] = useState<boolean>(() => {
    try { return localStorage.getItem("ls_intro_v1") ? false : true; } catch { return true; }
  });
  const gridRef = useRef<HTMLDivElement | null>(null);
  const tileRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const [flip, setFlip] = useState<Map<number, { dx: number; dy: number }>>(new Map());
  const initialTouch = typeof window !== "undefined" && (("ontouchstart" in window) || (navigator as any).maxTouchPoints > 0);
  const [isTouch, setIsTouch] = useState(initialTouch);

  useEffect(() => { setIsTouch((("ontouchstart" in window) || (navigator as any).maxTouchPoints > 0)); }, []);

  const prefersDark = usePrefersDark();
  const [theme, setTheme] = useState<Theme>("system");
  const isDark = theme === "dark" || (theme === "system" && !isTouch && prefersDark);

  useEffect(() => { if (!showIntro) try { localStorage.setItem("ls_intro_v1", "1"); } catch {} }, [showIntro]);

  // ===== Scoring / Meter =====
  const [score, setScore] = useState<number>(SCORE_START);
  const rewardedGreen = useRef<Set<number>>(new Set());
  const [scoreFlash, setScoreFlash] = useState<{v:number,key:number}|null>(null);
  const flash = (delta:number) => {
    if (delta === 0) return;
    setScoreFlash({ v: delta, key: Math.random() });
    const id = window.setTimeout(() => setScoreFlash(null), 700);
    return () => window.clearTimeout(id);
  };

  // Meter decay every second while running
  useEffect(() => {
    if (!running || won || lost) return;
    const id = window.setInterval(() => {
      setSeconds((s) => s + 1);
      setScore((sc) => {
        const next = Math.max(0, sc - DECAY_PER_SEC);
        if (next !== sc) flash(-DECAY_PER_SEC);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, won, lost]);

  // Out of time
  useEffect(() => {
    if (!won && score <= 0) {
      setLost(true);
      setRunning(false);
    }
  }, [score, won]);

  // Row-cleared detection (any order)
  useEffect(() => {
    if (won || lost) return;
    for (let r = 0; r < size; r++) {
      if (lockedRows.has(r)) continue;
      const secret = rowSecrets[r]?.word;
      if (secret && rowString(board, size, r) === secret) {
        setRowCleared(r);
        setRunning(false);
        break;
      }
    }
  }, [board, rowSecrets, size, lockedRows, won, lost]);

  // One-shot celebration + lock row + award bonus + resume
  useEffect(() => {
    if (rowCleared != null) {
      setCelebrateRow(rowCleared);
      const t = window.setTimeout(() => {
        setCelebrateRow(null);
        setLockedRows((prev) => new Set(prev).add(rowCleared));
        setRowCleared(null);
        // Award row bonus
        const bonus = ROW_SOLVED_BONUS_PER_SIZE * size;
        setScore((s) => Math.min(SCORE_CAP, s + bonus));
        flash(bonus);
        setRunning(true);
      }, 650);
      return () => window.clearTimeout(t);
    }
  }, [rowCleared, size]);

  useEffect(() => {
    if (lockedRows.size === size && size > 0) {
      setWon(true);
      setRunning(false);
    }
  }, [lockedRows, size]);

  // Marks are derived every render (duplicate-safe, priority g>o>y>x)
  const marks = useMemo(() => computeMarks(board, size, rowSecrets, lockedRows), [board, size, rowSecrets, lockedRows]);

  // ---------- Handlers
  function isRowLocked(r: number) { return lockedRows.has(r) || r === rowCleared; }

  function canSwapIndices(a: number, b: number) {
    if (a === b) return false;
    const ra = rc(a, size).r; const rb = rc(b, size).r;
    if (isRowLocked(ra) || isRowLocked(rb)) return false;
    return true;
  }

  function performSwap(a: number, b: number) {
    const nextBoard = [...board];

    // FLIP capture pre-swap rects
    const idA = nextBoard[a]?.id; const idB = nextBoard[b]?.id;
    const elA = idA ? tileRefs.current.get(idA) : null;
    const elB = idB ? tileRefs.current.get(idB) : null;
    const rectA = elA?.getBoundingClientRect();
    const rectB = elB?.getBoundingClientRect();

    // Predict next marks for scoring deltas
    const nextBoardPreview = [...nextBoard];
    swapArr(nextBoardPreview, a, b);
    const nextMarks = computeMarks(nextBoardPreview, size, rowSecrets, lockedRows);
    const newly = newlyGreenIDs(marks, nextMarks, rewardedGreen.current);

    // Now commit the swap
    swapArr(nextBoard, a, b);
    setBoard(nextBoard);
    setSelectedIndex(null);
    if (!running) setRunning(true);
    setMoves((m) => m + 1);

    // Score effects
    if (MOVE_PENALTY) { setScore((s) => Math.max(0, s - MOVE_PENALTY)); flash(-MOVE_PENALTY); }
    if (newly.length) {
      const gain = newly.length * GREEN_BONUS;
      newly.forEach((id) => rewardedGreen.current.add(id));
      setScore((s) => Math.min(SCORE_CAP, s + gain));
      flash(gain);
    }

    // FLIP animate to new spot (after DOM updates)
    if (idA && idB && rectA && rectB) {
      requestAnimationFrame(() => {
        const elA2 = tileRefs.current.get(idA);
        const elB2 = tileRefs.current.get(idB);
        if (elA2 && elB2) {
          const afterA = elA2.getBoundingClientRect();
          const afterB = elB2.getBoundingClientRect();
          const m = new Map<number, { dx: number; dy: number }>();
          m.set(idA, { dx: rectA.left - afterA.left, dy: rectA.top - afterA.top });
          m.set(idB, { dx: rectB.left - afterB.left, dy: rectB.top - afterB.top });
          setFlip(m);
          requestAnimationFrame(() => setFlip(new Map()));
        }
      });
    }
  }

  function startGame(newSize = size, maybeWord?: string) {
    const nextCamp = makeCampaignBoard(newSize, maybeWord);
    setBoard(nextCamp.board);
    setSize(newSize);

    setMoves(0);
    setSeconds(0);
    setRunning(true);
    setWon(false);
    setLost(false);
    setRowCleared(null);
    setSelectedIndex(null);

    setRowSecrets(nextCamp.words.map((w) => ({ word: w })));
    setLockedRows(new Set());
    rewardedGreen.current = new Set();
    setScore(SCORE_START);
    setHideWin(false);
  }

  function handleTileClick(i: number) {
    if (won || lost) return;
    const r = rc(i, size).r;
    if (isRowLocked(r)) return;

    if (selectedIndex == null) { setSelectedIndex(i); return; }
    if (selectedIndex === i) { setSelectedIndex(null); return; }

    const rSel = rc(selectedIndex, size).r;
    if (isRowLocked(rSel)) { setSelectedIndex(i); return; }

    if (canSwapIndices(selectedIndex, i)) performSwap(selectedIndex, i);
    else setSelectedIndex(i);
  }

  // ---------- Render data
  const tilesToRender: Tile[] = useMemo(() => {
    const total = size * size;
    if (board.length === total) return board;
    return Array.from({ length: total }, (_, i) => board[i] ?? { id: -1_000 - i, char: "" });
  }, [board, size]);

  const solvedCount = lockedRows.size;
  const meterPct = Math.max(0, Math.min(100, Math.round((score / SCORE_CAP) * 100)));
  const low = meterPct <= 20;

  return (
    <div className={`${isDark ? "bg-slate-900 text-slate-100" : "bg-white text-neutral-900"} min-h-screen w-full overflow-x-hidden`}>
      <div className="max-w-3xl mx-auto p-4 select-none">
        {/* Intro overlay (first visit) */}
        {showIntro && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className={`w-full max-w-lg rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-neutral-200'} p-6`}>
              <h2 className="text-2xl font-bold mb-1">How to play</h2>
              <p className="opacity-80 mb-4">Swap <strong>any two tiles</strong> by clicking (select + select) or dragging one onto another. Solve all hidden words. Colors mean:</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5 text-center">
                <LegendBox isDark={isDark} color={isDark?"bg-emerald-600":"bg-green-300"} icon="★" label="Correct cell" />
                <LegendBox isDark={isDark} color={isDark?"bg-orange-600":"bg-orange-300"} icon="↔︎" label="Right row" />
                <LegendBox isDark={isDark} color={isDark?"bg-amber-600":"bg-yellow-300"} icon="↕︎" label="Right column" />
                <LegendBox isDark={isDark} color={isDark?"bg-slate-600":"bg-neutral-300"} icon="✕" label="Not in row/col" />
              </div>
              <div className="flex items-center justify-between text-sm mb-4">
                <div className="opacity-80">Your meter drains over time and with moves. Make greens to refill. Finish all rows before it hits zero!</div>
              </div>
              <div className="text-right">
                <button
                  className={`px-4 py-2 rounded-md border ${isDark ? 'bg-slate-800 border-slate-600 hover:bg-slate-700' : 'bg-white border-neutral-300 hover:bg-neutral-50'}`}
                  onClick={() => { setShowIntro(false); setSeconds(0); setScore(SCORE_START); setRunning(true); }}
                >
                  Ready to play
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <header className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold tracking-wide">Letter Slide</h1>
          <div className="flex items-center gap-2">
            <select
              className={`px-2 py-1 rounded-md border ${isDark ? "bg-slate-800 border-slate-600" : "bg-white border-neutral-300"}`}
              value={size}
              onChange={(e) => startGame(parseInt(e.target.value, 10))}
            >
              {[3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}×{n}</option>
              ))}
            </select>
            <button className={`px-3 py-1 rounded-md border ${isDark ? "bg-slate-800 border-slate-600 hover:bg-slate-700" : "bg-white border-neutral-300 hover:bg-neutral-50"}`} onClick={() => startGame(size)}>New</button>
            <select
              className={`px-2 py-1 rounded-md border ${isDark ? "bg-slate-800 border-slate-600" : "bg-white border-neutral-300"}`}
              value={theme}
              onChange={(e) => setTheme((e.target as HTMLSelectElement).value as Theme)}
              title="Theme"
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </header>

        {/* Subheader with meter */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-sm mb-1">
            <div className="font-mono">Time: {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} · Moves: {moves}</div>
            <div className="font-mono flex items-center gap-2">
              <span>Solved {solvedCount}/{size}</span>
              <span className="relative">
                <span className={`px-2 py-0.5 rounded-md border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-neutral-300'} transition-transform ${scoreFlash && scoreFlash.v>0 ? 'scale-110' : ''}`}>Score {score}</span>
                {scoreFlash && (
                  <span key={scoreFlash.key} className={`absolute -top-5 right-0 text-xs font-bold ${scoreFlash.v>0? 'text-emerald-500':'text-rose-500'} animate-[fadeInUp_0.7s_ease-out_forwards]`}>{scoreFlash.v>0?'+':''}{scoreFlash.v}</span>
                )}
              </span>
            </div>
          </div>
          <div className={`h-2 w-full rounded-full ${isDark? 'bg-slate-800':'bg-neutral-200'} overflow-hidden ${low ? 'ring-2 ring-rose-400 animate-pulse' : ''}`}>
            <div
              className={`h-full ${low ? 'bg-gradient-to-r from-rose-600 via-orange-500 to-amber-400 animate-pulse' : 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-emerald-300'}`}
              style={{ width: `${meterPct}%`, transition: 'width 250ms linear' }}
            />
          </div>
        </div>

        {/* Legend + quick hint */}
        <div className={`rounded-lg border ${isDark ? "bg-slate-800 border-slate-600" : "bg-slate-50 border"} p-3 text-sm mb-4`}>
          <div className="mb-2">Swap any two tiles by clicking or dragging. Color key:</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <LegendBox isDark={isDark} color={isDark?"bg-emerald-600":"bg-green-300"} icon="★" label="Correct cell" />
            <LegendBox isDark={isDark} color={isDark?"bg-orange-600":"bg-orange-300"} icon="↔︎" label="Right row" />
            <LegendBox isDark={isDark} color={isDark?"bg-amber-600":"bg-yellow-300"} icon="↕︎" label="Right column" />
            <LegendBox isDark={isDark} color={isDark?"bg-slate-600":"bg-neutral-300"} icon="✕" label="Not in row/col" />
          </div>
        </div>

        {/* Board */}
        <div
          ref={gridRef}
          className={`grid gap-2 ${isDark ? "text-slate-100" : "text-neutral-900"}`}
          style={{
            gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
            touchAction: isTouch ? "none" : "auto",
            overscrollBehavior: "contain",
            maxWidth: "100%",
          }}
        >
          {tilesToRender.map((t, i) => {
            let base = isDark ? "bg-slate-700" : "bg-white";
            const { r } = rc(i, size);
            const locked = isRowLocked(r);

            if (locked) base = isDark ? "bg-emerald-800" : "bg-green-200";
            else {
              const mark = marks.get(t.id);
              base = mark === "g" ? (isDark ? "bg-emerald-600" : "bg-green-300")
                   : mark === "o" ? (isDark ? "bg-orange-600" : "bg-orange-300")
                   : mark === "y" ? (isDark ? "bg-amber-600" : "bg-yellow-300")
                   : mark === "x" ? (isDark ? "bg-slate-600" : "bg-neutral-300")
                   : base;
            }

            const isSel = selectedIndex === i;
            const canSwap = !locked && selectedIndex != null && !isRowLocked(rc(selectedIndex, size).r) && i !== selectedIndex;
            const celebrating = celebrateRow != null && r === celebrateRow;

            // FLIP slide transform
            const fl = flip.get(t.id);
            const translate = fl ? `translate(${fl.dx}px, ${fl.dy}px)` : `translate(0px, 0px)`;
            const styleTrans: CSSProperties = { transform: translate, transition: fl ? "transform 0s" : "transform 180ms ease" };

            return (
              <button
                key={t.id}
                ref={(el) => { if (el) tileRefs.current.set(t.id, el); }}
                data-index={i}
                draggable={!locked && !isTouch}
                onDragStart={!isTouch ? (e) => {
                  setDragIndex(i);
                  try { e.dataTransfer.setData('text/plain', String(i)); } catch {}
                  e.dataTransfer.effectAllowed = 'move';
                } : undefined}
                onDragOver={!isTouch ? (e) => { if (dragIndex != null && canSwapIndices(dragIndex, i)) e.preventDefault(); } : undefined}
                onDrop={!isTouch ? (e) => {
                  e.preventDefault();
                  const a = dragIndex ?? parseInt(e.dataTransfer.getData('text/plain') || '-1', 10);
                  const b = i;
                  if (a >= 0 && a !== b && canSwapIndices(a, b)) performSwap(a, b);
                  setDragIndex(null);
                  setSelectedIndex(null);
                } : undefined}
                onDragEnd={!isTouch ? () => setDragIndex(null) : undefined}

                onPointerDown={isTouch ? (e) => { (e.currentTarget as any).setPointerCapture?.(e.pointerId); setDragIndex(i); } : undefined}
                onPointerUp={isTouch ? (e) => {
                  const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
                  let ii: number | null = null; let n: HTMLElement | null = el;
                  while (n && ii == null) { const v = n.getAttribute?.('data-index'); if (v != null) ii = parseInt(v, 10); n = n.parentElement as HTMLElement | null; }
                  if (dragIndex != null && ii != null && ii !== dragIndex && canSwapIndices(dragIndex, ii)) performSwap(dragIndex, ii);
                  setDragIndex(null); setSelectedIndex(null);
                } : undefined}
                onPointerCancel={isTouch ? () => setDragIndex(null) : undefined}

                onClick={() => handleTileClick(i)}
                style={styleTrans}
                className={`relative aspect-square rounded-xl border ${isDark ? "border-slate-600" : "border-neutral-300"} ${base}
                            flex items-center justify-center text-xl font-bold
                            ${isSel ? "ring-2 ring-sky-500" : canSwap ? "ring-2 ring-sky-300" : ""}
                            ${celebrating ? "animate-[bounce_0.6s_ease-out_1]" : ""}
                            ${locked ? "cursor-not-allowed pointer-events-none opacity-95" : "cursor-pointer"}
                            shadow-[0_4px_0_rgba(0,0,0,.18)]`}
              >
                <span className="pointer-events-none absolute inset-0 rounded-xl" style={{ background: isDark ? 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.0) 55%)' : 'linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.0) 60%)' }} />
                {t.char}
                {locked && <span className="absolute top-1 right-1 text-xs opacity-70">🔒</span>}
              </button>
            );
          })}
        </div>

        {/* Dev tests (trimmed to core invariants) */}
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer select-none">Run dev tests</summary>
          <div className="mt-2 flex gap-2">
            <button
              className={`px-3 py-1 rounded-md border ${isDark ? "bg-slate-800 border-slate-600 hover:bg-slate-700" : "bg-white border-neutral-300 hover:bg-neutral-50"}`}
              onClick={() => {
                const results: { name: string; passed: boolean }[] = [];

                // campaign words exist in dictionary
                const camp = makeCampaignBoard(4);
                const allInDict = camp.words.every((w) => (WORDS[4] || []).includes(w));
                results.push({ name: "campaign words exist in dictionary", passed: allInDict });

                // board letters equal words letters (multiset)
                const boardCounts: Record<string, number> = {};
                camp.board.forEach((t) => { boardCounts[t.char] = (boardCounts[t.char] || 0) + 1; });
                const wordCounts: Record<string, number> = {};
                camp.words.join("").split("").forEach((ch) => { wordCounts[ch] = (wordCounts[ch] || 0) + 1; });
                const sameMultiset = Object.keys({ ...boardCounts, ...wordCounts }).every((k) => boardCounts[k] === wordCounts[k]);
                results.push({ name: "board letters equal words letters", passed: sameMultiset });

                // computeMarks basics - orange for row-misplaced
                {
                  const sizeT = 4; const secrets = [{word:"ABCD"},{word:"EFGH"},{word:"IJKL"},{word:"MNOP"}];
                  const boardT: Tile[] = [];
                  for (let r=0;r<sizeT;r++) for (let c=0;c<sizeT;c++) boardT.push({id:r*sizeT+c+1,char:secrets[r].word[c]});
                  // swap to create row misplacement in row 0
                  swapArr(boardT, idx(0,0,sizeT), idx(0,1,sizeT)); // row 0 now B A C D
                  const m = computeMarks(boardT, sizeT, secrets, new Set());
                  const idA = boardT[idx(0,1,sizeT)].id; // 'A' in row 0 wrong col -> orange
                  results.push({ name: "orange for row-misplaced letter", passed: m.get(idA)==='o' });
                }

                // computeMarks basics - yellow for column-misplaced
                {
                  const sizeT = 4; const secrets = [{word:"ABCD"},{word:"EFGH"},{word:"IJKL"},{word:"MNOP"}];
                  const boardT: Tile[] = [];
                  for (let r=0;r<sizeT;r++) for (let c=0;c<sizeT;c++) boardT.push({id:r*sizeT+c+1,char:secrets[r].word[c]});
                  // move 'A' from (0,0) to (1,0) by swapping with 'E'
                  swapArr(boardT, idx(0,0,sizeT), idx(1,0,sizeT)); // column 0 has A in wrong row
                  const m2 = computeMarks(boardT, sizeT, secrets, new Set());
                  const idA2 = boardT[idx(1,0,sizeT)].id; // 'A' in right column wrong row -> yellow
                  results.push({ name: "yellow for column-misplaced letter", passed: m2.get(idA2)==='y' });
                }

                // newlyGreenIDs utility test
                {
                  const sizeT = 3; const secrets = [{word:"ABC"},{word:"DEF"},{word:"GHI"}];
                  const boardT: Tile[] = [];
                  for (let r=0;r<sizeT;r++) for (let c=0;c<sizeT;c++) boardT.push({id:r*sizeT+c+1,char:secrets[r].word[c]});
                  const cur = computeMarks(boardT, sizeT, secrets, new Set()); // all green
                  const prev = new Map<number, Hint>();
                  const gained = newlyGreenIDs(prev, cur, new Set());
                  results.push({ name: "newlyGreenIDs finds all at start", passed: gained.length === 9 });
                }

                alert(results.map((r) => `${r.passed ? "✅" : "❌"} ${r.name}`).join("\n"));
              }}
            >
              Run
            </button>
          </div>
        </details>

        {/* Win overlay */}
        {won && !hideWin && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className={`w-full max-w-sm rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-neutral-200'} p-5 text-center`}>
              <h2 className="text-2xl font-bold mb-2">🎉 You solved all words!</h2>
              <p className="mb-4 text-sm opacity-90">Great job on a {size}×{size} board.</p>
              <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
                <div className={`rounded-lg ${isDark ? 'bg-slate-800' : 'bg-neutral-100'} p-3`}>
                  <div className="opacity-70">Moves</div>
                  <div className="font-mono text-lg">{moves}</div>
                </div>
                <div className={`rounded-lg ${isDark ? 'bg-slate-800' : 'bg-neutral-100'} p-3`}>
                  <div className="opacity-70">Time</div>
                  <div className="font-mono text-lg">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</div>
                </div>
                <div className={`rounded-lg ${isDark ? 'bg-slate-800' : 'bg-neutral-100'} p-3`}>
                  <div className="opacity-70">Score</div>
                  <div className="font-mono text-lg">{score}</div>
                </div>
              </div>
              <div className="flex gap-2 justify-center">
                <button className={`px-3 py-2 rounded-md border ${isDark ? 'bg-slate-800 border-slate-600 hover:bg-slate-700' : 'bg-white border-neutral-300 hover:bg-neutral-50'}`} onClick={() => startGame(size)}>Play again</button>
                <button className={`px-3 py-2 rounded-md border ${isDark ? 'bg-slate-800 border-slate-600 hover:bg-slate-700' : 'bg-white border-neutral-300 hover:bg-neutral-50'}`} onClick={() => {
                  const url = typeof window !== 'undefined' ? window.location.href : '';
                  const text = `I solved a ${size}×${size} Letter Slide in ${moves} moves and ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}! Score ${score}.`;
                  const share = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
                  window.open(share, '_blank');
                }}>Share</button>
                <button className={`px-3 py-2 rounded-md border ${isDark ? 'bg-slate-800 border-slate-600 hover:bg-slate-700' : 'bg-white border-neutral-300 hover:bg-neutral-50'}`} onClick={() => setHideWin(true)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Loss overlay */}
        {lost && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className={`w-full max-w-sm rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-neutral-200'} p-5 text-center`}>
              <h2 className="text-2xl font-bold mb-2">⏳ Out of time</h2>
              <p className="mb-4 text-sm opacity-90">Your meter hit zero. Try a more efficient path!</p>
              <div className="grid grid-cols-3 gap-2 mb-4 text-sm">
                <div className={`rounded-lg ${isDark ? 'bg-slate-800' : 'bg-neutral-100'} p-3`}>
                  <div className="opacity-70">Moves</div>
                  <div className="font-mono text-lg">{moves}</div>
                </div>
                <div className={`rounded-lg ${isDark ? 'bg-slate-800' : 'bg-neutral-100'} p-3`}>
                  <div className="opacity-70">Time</div>
                  <div className="font-mono text-lg">{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</div>
                </div>
                <div className={`rounded-lg ${isDark ? 'bg-slate-800' : 'bg-neutral-100'} p-3`}>
                  <div className="opacity-70">Score</div>
                  <div className="font-mono text-lg">{score}</div>
                </div>
              </div>
              <div className="flex gap-2 justify-center">
                <button className={`px-3 py-2 rounded-md border ${isDark ? 'bg-slate-800 border-slate-600 hover:bg-slate-700' : 'bg-white border-neutral-300 hover:bg-neutral-50'}`} onClick={() => startGame(size)}>Try again</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --------- Small legend box component (declared after default export, fine in TS/JS)
function LegendBox({ isDark, color, icon, label }: { isDark: boolean; color: string; icon: string; label: string }) {
  return (
    <div className={`flex items-center gap-2 p-2 rounded-lg border ${isDark ? 'border-slate-600 bg-slate-800/50' : 'border-neutral-300 bg-white/70'}`}>
      <div className={`w-7 h-7 rounded-md flex items-center justify-center text-base font-bold ${color} shadow-inner`}>{icon}</div>
      <div className="text-xs font-medium">{label}</div>
    </div>
  );
}

// Tailwind keyframes for score flash
// (Using arbitrary class animate-[fadeInUp...] in JSX; ensure safelisted or use JIT)
// keyframes are not required here because Tailwind JIT will inline them for the shorthand used above.
