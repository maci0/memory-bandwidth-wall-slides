// Deck engine. Slides are <section class="slide">; build steps are [data-step]
// (shown while step <= k, hidden again from [data-until]); [data-vals] tween a
// number per step; [data-play] runs a loop while the slide is on screen.
// Modes: default show, ?print (final state, every slide), ?presenter, ?embed[&next].
// Still (reduced motion, and the presenter's ?embed previews): loops draw one static
// frame per step and body.motionless turns CSS motion off, as in print.

const W = 1280, H = 720;
const WPM = 140; // read-through estimate; live delivery uses each slide's budget
// Number tweens run as long as a bar fill (--bar in deck.css) on the same curve, so a bar and its label land together.
const TWEEN_MS = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bar")) * 1000;
if (!(TWEEN_MS > 0)) throw new Error("deck.css must set --bar (the bar fill duration) on :root");
const easeOut = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)); // expo out: the deck's --ease, cubic-bezier(.16,1,.3,1)
const RESET_AFTER_MS = 500; // the outgoing slide resets once its 0.45 s fade (deck.css .slide) is over

const q = new URLSearchParams(location.search);
const messageOrigin = location.protocol === "file:" ? "null" : location.origin;
const messageTarget = messageOrigin === "null" ? "*" : messageOrigin;
const mode = q.has("print") ? "print" : q.has("presenter") ? "presenter" : q.has("embed") ? "embed" : "show";
const still = matchMedia("(prefers-reduced-motion: reduce)").matches || mode === "embed";
document.body.classList.add(mode);
if (still) document.body.classList.add("motionless");
if (q.get("theme") === "dark" || q.get("theme") === "light") document.documentElement.dataset.theme = q.get("theme");

const deck = document.getElementById("deck");
const slides = [...deck.querySelectorAll(".slide")];

// Clones get their index as --i, for staggered builds (cell n pops at n × its step).
for (const el of document.querySelectorAll("[data-repeat]")) {
  const first = el.firstElementChild;
  first.style.setProperty("--i", "0");
  for (let n = 1; n < Number(el.dataset.repeat); n++) {
    const c = first.cloneNode(true);
    c.style.setProperty("--i", String(n));
    el.appendChild(c);
  }
}

const maxStep = slides.map((s) =>
  Math.max(0, ...[...s.querySelectorAll("[data-step],[data-until]")].map((e) => Math.max(Number(e.dataset.step ?? 0), Number(e.dataset.until ?? 0))),
    ...[...s.querySelectorAll("[data-vals]")].map((e) => e.dataset.vals.split(",").length - 1)));

const planSeconds = slides.map((s) => {
  const text = s.querySelector(".notes")?.textContent ?? "";
  const words = text.replace(/\[(?:click|beat|hold|pause \d+(?:\.\d+)?s: [^\]]+)\]/g, "").match(/\S+/g)?.length ?? 0;
  const stagePauses = [...text.matchAll(/\[pause (\d+(?:\.\d+)?)s: [^\]]+\]/g)].reduce((sum, m) => sum + Number(m[1]), 0);
  return words / WPM * 60 + (text.match(/\[click\]/g)?.length ?? 0) * 1.5
    + (text.match(/\[beat\]/g)?.length ?? 0) * 3 + (text.match(/\[hold\]/g)?.length ?? 0) * 5 + stagePauses + 2;
});
const planStart = planSeconds.map((_, i) => planSeconds.slice(0, i).reduce((a, b) => a + b, 0));
const liveSeconds = slides.map(s => Number(s.dataset.seconds) || 0);
const liveStart = liveSeconds.map((_, i) => liveSeconds.slice(0, i).reduce((a, b) => a + b, 0));

slides.forEach((s, i) => {
  const n = document.createElement("span");
  n.className = "num";
  n.textContent = String(i + 1).padStart(2, "0");
  s.appendChild(n);
});

// ── numbers ──
// data-decs="2,3" gives each step its own decimals (0.66 then 0.022);
// data-dec sets one precision for every step.
function fmt(el, v, step) {
  const decs = el.dataset.decs?.split(",").map(Number);
  const dec = decs ? decs[Math.min(step, decs.length - 1)] : Number(el.dataset.dec ?? 0);
  const s = v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return (el.dataset.pre ?? "") + s + (el.dataset.suf ?? "");
}
// The build delay --d (inherited from the element's build step, or set on the element):
// a number starts counting, and a data-map label swaps, when its shape starts moving.
function buildDelay(el) {
  const d = getComputedStyle(el).getPropertyValue("--d").trim();
  return d.endsWith("ms") ? parseFloat(d) || 0 : (parseFloat(d) || 0) * 1000;
}
// data-ms sets one number's tween length when its shape is not a bar (a 1.4 s cuboid).
// Going back a step skips the delay.
function setVals(slide, k, instant, back) {
  for (const el of slide.querySelectorAll("[data-vals]")) {
    const vals = el.dataset.vals.split(",").map(Number);
    const step = Math.min(Math.max(k, 0), vals.length - 1), target = vals[step];
    const map = el.dataset.map?.split(",");
    const from = Number(el.dataset.now ?? vals[0]);
    el.dataset.now = String(target);
    cancelAnimationFrame(Number(el.dataset.raf ?? 0));
    const text = (v) => (map ? map[v] : fmt(el, v, step));
    if (instant || from === target) { el.textContent = text(target); continue; }
    const t0 = performance.now() + (back ? 0 : buildDelay(el)), ms = map ? 0 : Number(el.dataset.ms ?? TWEEN_MS);
    const tick = (t) => {
      const p = ms ? Math.min(1, Math.max(0, (t - t0) / ms)) : Number(t >= t0);
      if (p > 0) el.textContent = map ? text(target) : text(from + (target - from) * easeOut(p));
      if (p < 1) el.dataset.raf = String(requestAnimationFrame(tick));
    };
    el.dataset.raf = String(requestAnimationFrame(tick));
  }
}

// ── one step state ── (k = -1 hides the step-0 builds too, so they can build in on entry)
function apply(slide, k, instant) {
  const back = k < Number(slide.dataset.k ?? 0);
  for (const el of slide.querySelectorAll("[data-step],[data-until]")) {
    const on = k >= Number(el.dataset.step ?? 0) && !(el.dataset.until && k >= Number(el.dataset.until));
    el.classList.toggle("on", on);
  }
  for (let n = 1; n <= 9; n++) slide.classList.toggle("k" + n, k >= n);
  slide.dataset.k = String(k);
  setVals(slide, k, instant, back);
}

// Dense and MoE grids as stacked layer planes (3D): PLANES planes of COLS × ROWS cells.
// The MoE loop lights cells across all planes; the dense grid lights every cell.
(function stacks() {
  const PLANES = 4, COLS = 12, ROWS = 6;
  for (const g of document.querySelectorAll(".stack3d")) {
    for (let p = 0; p < PLANES; p++) {
      const plane = document.createElement("div");
      plane.className = "plane"; plane.style.setProperty("--p", String(p));
      for (let c = 0; c < COLS * ROWS; c++) plane.appendChild(document.createElement("i"));
      if (g.classList.contains("dense-grid") && p === PLANES - 1) plane.classList.add("attn"); // 1 in 4 layers is full attention
      if (g.classList.contains("moe-grid")) for (let c = 0; c < COLS; c++) plane.children[c].classList.add("base"); // always-read row: attention, shared expert, router
      g.appendChild(plane);
    }
  }
})();

// ── loops ──
const PLAY = {
  // Decode lap: the weights are read (sweep), then every KV row so far (a scan that grows with the
  // context; from click 2, when the KV panel shows), then the token appears and is appended.
  decode(slide, still) {
    const gen = slide.querySelector(".gen"), nxt = slide.querySelector(".nxt");
    const stack = slide.querySelector(".kvstack"), kvn = slide.querySelector(".kvn");
    const wbar = slide.querySelector(".wbar"), model = slide.querySelector(".model"), back = slide.querySelector(".arrow-line.back");
    const toks = [" slow", "?", " It", " isn't", ".", " It's", " starving", "."];
    const SEED = 4, FIRST_MS = 600, SWEEP_MS = 550, KV_ROW_MS = 45, APPEND_MS = 450, NEXT_MS = 650, HOLD_MS = 2400, RESTART_MS = 700;
    let n = 0, timer = 0;
    const row = () => { const c = document.createElement("i"); c.style.setProperty("--at", stack.children.length * KV_ROW_MS + "ms"); stack.appendChild(c); };
    const flash = (...els) => { for (const el of els) { el.classList.remove("hit"); void el.getBoundingClientRect(); el.classList.add("hit"); } };
    const reset = () => { n = 0; gen.textContent = ""; nxt.textContent = "…"; stack.textContent = ""; kvn.textContent = SEED + " tokens"; for (let j = 0; j < SEED; j++) row(); };
    const step = () => {
      if (n >= toks.length) { timer = setTimeout(() => { reset(); timer = setTimeout(step, RESTART_MS); }, HOLD_MS); return; }
      const t = toks[n++];
      flash(wbar, model);
      const kvRead = Number(slide.dataset.k) >= 2 ? stack.children.length * KV_ROW_MS : 0;
      timer = setTimeout(() => {
        if (kvRead) flash(stack);
        timer = setTimeout(() => {
          nxt.textContent = t.trim();
          flash(nxt);
          timer = setTimeout(() => {
            gen.textContent += t;
            row();
            kvn.textContent = SEED + n + " tokens";
            flash(back);
            timer = setTimeout(step, NEXT_MS);
          }, APPEND_MS);
        }, kvRead);
      }, SWEEP_MS);
    };
    reset();
    if (still) { // the finished loop: every token produced
      while (n < toks.length) { gen.textContent += toks[n++]; row(); }
      kvn.textContent = SEED + n + " tokens";
      nxt.textContent = toks.at(-1).trim();
      return () => {};
    }
    timer = setTimeout(step, FIRST_MS);
    return () => clearTimeout(timer);
  },

  // Speculative acceptance game: each drafted token is accepted with chance α
  // until the first miss; the target always adds one token.
  accept(slide, still) {
    const PASS_MS = 1700, CHIP_MS = 130;
    const rows = [...slide.querySelectorAll(".simrow")].map((el) => ({
      el, a: Number(el.dataset.a), chips: [...el.querySelectorAll(".chips i")],
      pass: el.querySelector(".pass"), run: el.querySelector(".run"),
    }));
    const DRAFT = rows[0]?.chips.length - 1;
    const expected = (a) => (1 - a ** (DRAFT + 1)) / (1 - a);
    const show = (r, kept, timers) => {
      r.chips.forEach((c) => (c.className = c.classList.contains("bonus") ? "bonus" : ""));
      const label = () => { r.pass.textContent = kept === 0 ? "1 token" : `${kept + 1} tokens`; };
      if (timers) r.pass.textContent = "…"; // the count belongs to this pass: blank until its chips are shown
      let at = 0;
      for (let j = 0; j <= DRAFT; j++) {
        const c = r.chips[j], cls = j === DRAFT ? "bonus on" : j < kept ? "ok" : j === kept ? "no" : "dim";
        if (!timers) { c.className = cls; continue; }
        const t = () => { c.className = cls; };
        if (cls === "dim") { timers.push(setTimeout(t, kept * CHIP_MS)); continue; } // dimmed when the miss shows, not before
        timers.push(setTimeout(t, at)); at += CHIP_MS;
      }
      timers ? timers.push(setTimeout(label, at)) : label();
    };
    const go = () => Number(slide.dataset.k) >= 1;
    const blank = () => {
      for (const r of rows) {
        r.chips.forEach((c) => (c.className = c.classList.contains("bonus") ? "bonus" : ""));
        r.pass.textContent = "…";
        r.run.textContent = "–";
      }
    };
    // The average over many passes is eq. 1's expected value (the footnote's 1.97, 2.94, 4.69);
    // each tick draws one pass to watch.
    const average = () => { for (const r of rows) r.run.textContent = expected(r.a).toFixed(2); };
    if (still) {
      if (!go()) { blank(); return () => {}; }
      for (const r of rows) show(r, Math.round(expected(r.a)) - 1, null);
      average();
      return () => {};
    }
    // The loop waits for the guess click so the pass counts are not the answer.
    const draw = (a) => { let k = 0; while (k < DRAFT && Math.random() < a) k++; return k; };
    let timers = [], running = false;
    const tick = () => {
      timers = [];
      for (const r of rows) show(r, draw(r.a), timers);
      timers.push(setTimeout(tick, PASS_MS));
    };
    const start = () => {
      if (!go()) {
        timers.forEach(clearTimeout);
        timers = [];
        running = false;
        blank();
        return;
      }
      if (running) return;
      running = true;
      average();
      tick();
    };
    slide.onStep = start;
    start();
    return () => { timers.forEach(clearTimeout); slide.onStep = null; };
  },

  // Dense vs MoE: the dense grid lights fully per token; the MoE grid lights the experts one
  // token picks (k of N per layer), then the union over a batch. Cells are a scaled picture of
  // N experts; the coverage and the GB read are computed.
  moe(slide, still) {
    const PASS_MS = 1400, CLIMB_MS = 250;
    const grid = slide.querySelector(".moe-grid"), gb = grid.parentElement.querySelector(".mstat b");
    const n = Number(grid.dataset.n), k = Number(grid.dataset.k), batch = Number(grid.dataset.batch);
    const cover = (b) => 1 - (1 - k / n) ** b; // share of routed experts a batch of b tokens reads (uniform routing)
    // GB per step = always-read bytes + routed-expert bytes × coverage, fitted to the footnote:
    // 13.3 GB at batch 1 of 250.2 GB in all, which gives 231 GB at batch 128.
    const one = Number(grid.dataset.one), all = Number(grid.dataset.all);
    const experts = (all - one) / (1 - cover(1)), always = all - experts;
    const lbl = gb.nextElementSibling, BATCH_LBL = lbl.dataset.map.split(",")[1];
    const gbAt = (b) => { gb.textContent = (always + experts * cover(b)).toFixed(0) + " GB"; if (b > 1) lbl.textContent = b < batch ? `read per step at batch ${b}` : BATCH_LBL; }; // the label counts with the number
    const REQ = ["pa", "pb", "pc"]; // request shades, as on the routing slide
    const BATCHES = [];
    for (let b = 1; b <= batch; b *= 2) BATCHES.push(b);
    // Frames: 0, 1 one token (two draws); 2, 3 the full batch (two draws); 4… the batches between.
    // Frames 0, 4…, 2 share one draw per cell, so each doubling lights a superset of the last.
    if (!grid.querySelector(".moe-frame")) {
      const planes = [...grid.children];
      const draw = () => planes.flatMap((p) => [...p.children]).map(() => ({ u: Math.random(), req: REQ[Math.floor(Math.random() * REQ.length)] }));
      const paint = (tokens, cells) => {
        const frame = document.createElement("div");
        frame.className = "moe-frame";
        frame.append(...planes.map((p) => p.cloneNode(true)));
        frame.querySelectorAll("i").forEach((c, j) => {
          if (c.classList.contains("base") || cells[j].u >= cover(tokens)) return;
          c.className = "lit " + (cells[j].u < cover(1) ? REQ[0] : cells[j].req); // the first request's picks keep its shade
        });
        return frame;
      };
      const climb = draw();
      grid.replaceChildren(paint(1, climb), paint(1, draw()), paint(batch, climb), paint(batch, draw()), ...BATCHES.slice(1, -1).map((b) => paint(b, climb)));
    }
    const frames = [...grid.children], CLIMB = [0, ...BATCHES.slice(1, -1).map((_, j) => 4 + j), 2];
    // the incoming frame fades in over the outgoing one, which stays lit underneath until it is covered
    const show = (f) => {
      grid.querySelector(".moe-frame.prev")?.classList.remove("prev");
      grid.querySelector(".moe-frame.show")?.classList.replace("show", "prev");
      frames[f].classList.add("show");
      grid.dataset.frame = String(f);
    };
    const high = () => Number(slide.dataset.k) >= 2;
    if (still) { show(high() ? 2 : 0); gbAt(high() ? batch : 1); return () => {}; }
    let timer = 0, alt = 0, wasHigh = high();
    const loop = () => { show((wasHigh ? 2 : 0) + alt); alt ^= 1; timer = setTimeout(loop, PASS_MS); };
    // batch 1, 2, 4 … 128, one frame each: the union of experts read grows as the batch doubles
    const climb = (j) => {
      show(CLIMB[j]);
      gbAt(BATCHES[j]);
      if (j + 1 < CLIMB.length) timer = setTimeout(() => climb(j + 1), CLIMB_MS);
      else { alt = 1; timer = setTimeout(loop, PASS_MS); }
    };
    const enter = (animate) => {
      clearTimeout(timer);
      wasHigh = high();
      alt = 0;
      if (wasHigh && animate) { climb(0); return; }
      gbAt(wasHigh ? batch : 1);
      loop();
    };
    slide.onStep = () => { if (high() !== wasHigh) enter(high()); };
    enter(false);
    return () => { clearTimeout(timer); slide.onStep = null; };
  },

  // Four tenants share four pods; each pod caches two prefixes, least recently used out first.
  // A miss recomputes the prefix (amber), a hit reuses it (green). Tenants send at one rate: each
  // round, every tenant sends once, in random order. Random routing then hits about a third of the
  // requests in the first minute; prefix-aware routing hits nearly all. The counters are simulated
  // and labeled so; the measured receipt comes on click 2.
  router(slide, still) {
    const KEYS = ["a", "b", "c", "d"], ROOM = 2, TICK_MS = 1100, FLY_MS = 650, COLD_POD = 2;
    // The scripted first request holds the board while the narration walks through it: random mode
    // until "…recomputes six thousand tokens" ends (16.3 s in at 140 wpm), prefix-aware 4 s.
    const FIRST_MS = [16500, 4000];
    const START_MS = 600; // the first request flies once the 0.45 s slide crossfade is over
    const root = slide.querySelector(".router"), card = slide.querySelector(".rqcard");
    const key = card.querySelector(".rkey"), what = card.querySelector("span");
    const pods = [...slide.querySelectorAll(".rp")].map((el) => ({ el, slots: [...el.querySelectorAll(".rcache i")], out: el.querySelector(".rout"), cache: [] }));
    const hitEl = slide.querySelector(".rhit"), missEl = slide.querySelector(".rmiss"), prev = slide.querySelector(".rprev");
    const missLbl = missEl.nextElementSibling;
    const setMisses = (v) => { missEl.textContent = String(v); missLbl.textContent = v === 1 ? "prefill recomputed" : "prefills recomputed"; };
    const smart = () => Number(slide.dataset.k) >= 1;
    const draw = (p) => p.slots.forEach((s, j) => { const k = p.cache[j]; s.className = k ? "p" + k : ""; s.textContent = k ? k.toUpperCase() : ""; });
    let n = 0, hits = 0, misses = 0, timer = 0, mode = -1, first = true, seen = new Set(), epoch = 0, round = [];
    const nextKey = () => {
      if (!round.length) {
        round = [...KEYS];
        for (let j = round.length - 1; j > 0; j--) { const r = Math.floor(Math.random() * (j + 1)); [round[j], round[r]] = [round[r], round[j]]; }
      }
      return round.pop();
    };
    const reset = () => {
      n = hits = misses = 0; first = true; seen = new Set(["a"]); round = [];
      for (const p of pods) { p.cache = []; draw(p); p.out.textContent = ""; p.el.classList.remove("hit", "miss"); }
      pods[0].cache = ["a"]; draw(pods[0]);
      hitEl.textContent = "–"; setMisses(0);
    };
    // switching to prefix-aware keeps the random run's result on screen, in gray
    const setMode = (m) => {
      if (m === 1 && mode === 0 && n > 0) prev.textContent = `random: ${hits}/${n} hits · ${misses} recomputed`;
      if (m === 0) prev.textContent = "";
      mode = m;
      reset();
    };
    const setCard = (k, fresh) => {
      const K = k.toUpperCase();
      key.className = "rkey p" + k; key.textContent = K;
      if (fresh) { void key.offsetWidth; key.classList.add("fresh"); }
      what.textContent = `shared prefix ${K} + new question`;
    };
    const clearChips = () => {
      epoch++;
      clearTimeout(timer);
      timer = 0;
      root.querySelectorAll(".req").forEach((d) => { d.getAnimations().forEach((a) => a.cancel()); d.remove(); });
    };
    // benchmark card: each prefix sits on its warm pod, and the loop stops
    const hold = () => {
      if (mode === 2) return;
      mode = 2;
      reset();
      pods.forEach((p, i) => { if (KEYS[i]) { p.cache = [KEYS[i]]; draw(p); } });
    };
    prev.textContent = "";
    if (still) {
      const k = Number(slide.dataset.k);
      if (k >= 2) hold();
      else if (k >= 1) {
        reset();
        pods[0].el.classList.add("hit");
        pods[0].out.textContent = "cache hit";
        hitEl.textContent = "100%";
      } else {
        reset();
        pods[COLD_POD].cache = ["a"]; draw(pods[COLD_POD]);
        pods[COLD_POD].slots[0].classList.add("new");
        pods[COLD_POD].el.classList.add("miss");
        pods[COLD_POD].out.textContent = "prefill 6k tokens";
        hitEl.textContent = "0%";
        setMisses(1);
      }
      return () => {};
    }
    // position inside the unscaled stage (the deck itself is scaled with a transform)
    const at = (el) => { let x = 0, y = 0; for (let e = el; e && e !== root; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return [x, y]; };
    const land = (p, k, mine) => {
      if (mine !== epoch) return;
      const hit = p.cache.includes(k);
      p.cache = [k, ...p.cache.filter((c) => c !== k)].slice(0, ROOM);
      draw(p);
      if (!hit) p.slots[0].classList.add("new");
      n++; if (hit) hits++; else if (seen.has(k)) misses++; // computed before somewhere: a recompute
      seen.add(k);
      hitEl.textContent = Math.round((100 * hits) / n) + "%"; setMisses(misses);
      for (const o of pods) o.out.textContent = ""; // only the pod that just acted keeps a label
      p.out.textContent = hit ? "cache hit" : "prefill 6k tokens";
      p.el.classList.remove("hit", "miss"); void p.el.offsetWidth; p.el.classList.add(hit ? "hit" : "miss");
    };
    const tick = () => {
      if (Number(slide.dataset.k) >= 2) { clearChips(); hold(); return; }
      if (mode !== Number(smart())) setMode(Number(smart()));
      // the first request of each mode is scripted so the narration can follow it
      const scripted = first; first = false;
      const k = scripted ? "a" : nextKey(), K = k.toUpperCase();
      setCard(k, true);
      const p = smart() ? pods[KEYS.indexOf(k)] : pods[scripted ? COLD_POD : Math.floor(Math.random() * pods.length)];
      const chip = document.createElement("b"); chip.className = "req p" + k; chip.textContent = K;
      const [x0, y0] = at(key), [x1, y1] = at(p.slots[0]);
      root.appendChild(chip);
      const mine = epoch;
      chip.animate([{ transform: `translate(${x0}px,${y0}px)` }, { transform: `translate(${x1}px,${y1}px)` }], { duration: FLY_MS, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" })
        .onfinish = () => { if (mine !== epoch) return; chip.remove(); land(p, k, mine); };
      timer = setTimeout(tick, scripted ? FIRST_MS[Number(smart())] : TICK_MS);
    };
    slide.onStep = () => {
      if (Number(slide.dataset.k) >= 2) { clearChips(); hold(); return; }
      if (mode === Number(smart())) return;
      clearChips();
      tick();
    };
    if (Number(slide.dataset.k) >= 2) hold();
    else { setMode(Number(smart())); setCard("a", false); timer = setTimeout(tick, START_MS); }
    return () => { clearChips(); slide.onStep = null; };
  },

  // Conveyor: tokens per second = belt speed ÷ bytes per token. One box is one token's weights,
  // sized by the checkpoint bytes; the belt keeps one speed, so smaller boxes arrive more often
  // (1 : 1.80 : 2.54, as 144 : 259 : 365 tok/s). Boxes resize with the slab; the GPU flashes per arrival.
  belt(slide, still) {
    const SPEED = 200, BF16_BOX = 300, GAP = 0.08, RESIZE_MS = 1400; // px/s; px; gap per box; the slab's 1.4 s (deck.css .cub)
    const belt = slide.querySelector(".belt"), boxes = belt.querySelector(".boxes"), gpu = belt.querySelector(".gpu");
    const gb = slide.querySelector(".slabrow b[data-vals]").dataset.vals.split(",").map(Number);
    const size = () => BF16_BOX * gb[Math.min(Math.max(Number(slide.dataset.k), 0), gb.length - 1)] / gb[0];
    let bw = size(), from = bw, to = bw, t0 = 0, last = 0, off = 0, phase = 0, raf = 0;
    // The strip is drawn once at bf16 size (BF16_BOX px boxes, GAP gaps); scaleX(bw / BF16_BOX) sizes it, translateX moves it.
    // Box j's front: (off − period) + s · (BF16_BOX + j · BF16_BOX · (1 + GAP)) = off − period + bw + j · period.
    const place = (o) => { const s = bw / BF16_BOX; boxes.style.transform = `translateX(${(o - bw * (1 + GAP)).toFixed(1)}px) scaleX(${s.toFixed(4)})`; };
    place(0);
    if (still) return () => {};
    const edge = belt.clientWidth - gpu.offsetWidth; // where a box front reaches the GPU
    const frame = (t) => {
      const dt = last ? Math.min(t - last, 100) / 1000 : 0;
      last = t;
      if (bw !== to) { const p = Math.min(1, (t - t0) / RESIZE_MS); bw = p >= 1 ? to : from + (to - from) * easeOut(p); }
      const period = bw * (1 + GAP);
      off = (off + SPEED * dt) % period;
      place(off);
      // the layer starts one period left of the belt, so box fronts sit at off − period + bw + j · period
      const ph = (((off + bw - edge) % period) + period) % period;
      if (ph < phase - period / 2) { gpu.classList.remove("hit"); void gpu.offsetWidth; gpu.classList.add("hit"); }
      phase = ph;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    slide.onStep = () => { from = bw; to = size(); t0 = performance.now(); };
    return () => { cancelAnimationFrame(raf); slide.onStep = null; };
  },

  // What fits in HBM: conversations = 17.5 GiB ÷ (64 KiB × context + 147 MiB state), the footnote's
  // formula. Click 1 pops one cell per conversation as the count climbs; click 2 stretches the
  // context to 128k, each block grows with it, and the count is computed from the context every frame.
  fit(slide, still) {
    const BUDGET_MIB = 17.5 * 1024, KIB_PER_TOKEN = 64, STATE_MIB = 147, POP_MS = 33;
    const count = slide.querySelector(".fitcount .huge"), ctxEl = slide.querySelector(".ctxlbl");
    const short = slide.querySelector(".kvfill.short"), long = slide.querySelector(".kvfill.long");
    const ctxs = ctxEl.dataset.ctx.split(",").map(Number); // context per step, in k (1,024) tokens
    const mib = (ctx) => KIB_PER_TOKEN * ctx + STATE_MIB; // 64 KiB × 1,024 tokens = 64 MiB per k
    const fits = (ctx) => Math.floor(BUDGET_MIB / mib(ctx));
    // the blocks are to scale: a 128k conversation's share of the budget, starting from its 8k size
    long.style.setProperty("--w0", (100 * mib(ctxs[1]) / BUDGET_MIB).toFixed(2));
    long.style.setProperty("--w1", (100 * mib(ctxs[2]) / BUDGET_MIB).toFixed(2));
    short.style.setProperty("--pop", POP_MS + "ms");
    let raf = 0, k = Number(slide.dataset.k);
    const show = (ctx, conv) => { ctxEl.textContent = Math.round(ctx) + "k context"; count.textContent = String(conv); };
    const settle = () => { const c = ctxs[Math.min(Math.max(k, 0), ctxs.length - 1)]; show(c, k > 0 ? fits(c) : 0); };
    settle();
    if (still) return () => {};
    const run = (draw, ms, delay) => {
      const t0 = performance.now() + delay;
      const f = (t) => { const p = Math.min(1, Math.max(0, (t - t0) / ms)); draw(p); if (p < 1) raf = requestAnimationFrame(f); };
      raf = requestAnimationFrame(f);
    };
    slide.onStep = () => {
      const was = k;
      k = Number(slide.dataset.k);
      cancelAnimationFrame(raf);
      if (k === 1) { // one cell pops per conversation; the count follows the pops
        const conv = fits(ctxs[1]);
        run((p) => show(ctxs[1], p > 0 ? Math.min(conv, Math.floor(p * conv) + 1) : 0), conv * POP_MS, buildDelay(short));
      } else if (k === 2 && was === 1) { // 8k → 128k on the bar curve, as the blocks grow
        run((p) => { const c = ctxs[1] + (ctxs[2] - ctxs[1]) * easeOut(p); show(c, fits(c)); }, TWEEN_MS, buildDelay(long));
      } else settle();
    };
    return () => { cancelAnimationFrame(raf); slide.onStep = null; };
  },

  // The grid slides to the data: grids() below moves each code tick from its symmetric to its
  // asymmetric place on click 2; the count goes up by one as each tick enters the range.
  grid(slide, still) {
    const used = slide.querySelector(".used .huge"), ticks = [...slide.querySelectorAll(".sym line.mv")];
    const inRange = ticks.filter((l) => !l.classList.contains("waste")).length;
    const enters = ticks.filter((l) => l.dataset.tc).map((l) => Number(l.dataset.tc)).sort((a, b) => a - b);
    const set = (c) => { used.textContent = `${c} / ${ticks.length}`; };
    const high = () => Number(slide.dataset.k) >= 2;
    let timers = [], wasHigh = high();
    set(wasHigh ? ticks.length : inRange);
    if (still) return () => {};
    slide.onStep = () => {
      if (high() === wasHigh) return;
      wasHigh = high();
      timers.forEach(clearTimeout);
      timers = [];
      set(inRange);
      if (wasHigh) enters.forEach((t, j) => timers.push(setTimeout(() => set(inRange + j + 1), t)));
    };
    return () => { timers.forEach(clearTimeout); slide.onStep = null; };
  },
};

// Syntax colors for commands, flags and PromQL (relumea syn-* tokens). Only text
// nodes are wrapped, so <b> emphasis, comment spans and build steps stay intact.
(function highlight() {
  const CMDS = "vllm|curl|jq|nsys|lm-eval|guidellm|helm|kubectl|uv";
  const CODE = new RegExp([
    `(?<str>'[^'\\n]*'|"[^"\\n]*")`,
    `(?<metric>\\b(?:vllm:|DCGM_FI_)[\\w:]+)`,
    `(?<flag>(?<![\\w-])--?[a-z][\\w.-]*)`,
    `(?<cmd>(?<=^\\s*|\\|\\s*|…\\s*|&&\\s*)(?:${CMDS})\\b)`,
    `(?<fn>\\b(?:histogram_quantile|sum|rate|avg|max)\\b(?=\\s*\\()|\\bby\\b(?=\\s*\\())`,
    `(?<num>(?<![\\w.])\\d+(?:\\.\\d+)?(?![\\w.]))`,
  ].join("|"), "gm");
  for (const root of document.querySelectorAll(".code, .kit dd")) {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest(".cm") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const node of nodes) {
      const text = node.textContent, frag = document.createDocumentFragment();
      let last = 0;
      for (const m of text.matchAll(CODE)) {
        const kind = Object.keys(m.groups).find((g) => m.groups[g] !== undefined);
        frag.append(text.slice(last, m.index));
        const s = document.createElement("span"); s.className = "sx-" + kind; s.textContent = m[0]; frag.append(s);
        last = m.index + m[0].length;
      }
      if (last === 0) continue;
      frag.append(text.slice(last));
      node.replaceWith(frag);
    }
  }
})();

// K/V heatmaps: keys get fixed outlier channels, values get scattered outliers.
(function heat() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const ROWS = 12, COLS = 24, K_OUTLIER_COLS = [3, 10, 17, 21];
  for (const [sel, outlier] of [[".gk", (r, c) => K_OUTLIER_COLS.includes(c)], [".gv", () => rnd() < 0.07]]) {
    const g = document.querySelector(sel);
    if (!g) continue;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const i = document.createElement("i");
      const v = outlier(r, c) ? 0.75 + rnd() * 0.25 : rnd() * 0.28;
      i.style.setProperty("--v", v.toFixed(2));
      
      g.appendChild(i);
    }
  }
})();

// Symmetric vs asymmetric 4-bit grids for one channel whose values span [LO, HI]. One set of 16
// ticks stands at the symmetric codes; on click 2 each slides to its asymmetric code (dashed ghosts
// stay behind) and turns green as it enters [LO, HI]. --tc is that moment, for the CSS and PLAY.grid's count.
(function grids() {
  const AXIS_MIN = -2.3, AXIS_MAX = 2.0, X0 = 40, X1 = 1112, LO = -0.4, HI = 2.0;
  const MOVE_MS = 1200, STAGGER_MS = 30;
  const x = (v) => X0 + ((v - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * (X1 - X0);
  const NS = "http://www.w3.org/2000/svg";
  const sym = Array.from({ length: 16 }, (_, k) => (k - 8) * (HI / 7));
  const asy = Array.from({ length: 16 }, (_, k) => LO + k * ((HI - LO) / 15));
  const g = document.querySelector(".sym .ticks");
  if (!g) return;
  g.style.setProperty("--move", MOVE_MS + "ms");
  const line = (v, cls) => {
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", x(v).toFixed(1)); l.setAttribute("x2", x(v).toFixed(1));
    l.setAttribute("y1", "108"); l.setAttribute("y2", "168");
    l.setAttribute("class", cls);
    g.appendChild(l);
    return l;
  };
  for (const v of sym) line(v, v < LO - 1e-9 || v > HI + 1e-9 ? "ghost" : "ghost in");
  sym.forEach((v, k) => {
    const out = v < LO - 1e-9 || v > HI + 1e-9;
    const l = line(v, out ? "mv waste" : "mv");
    const dx = x(asy[k]) - x(v), delay = k * STAGGER_MS;
    l.style.setProperty("--dx", dx.toFixed(1) + "px");
    l.style.setProperty("--at", delay + "ms");
    if (!out) return;
    // on the expo-out curve the tick has covered share s of its move at p = −log2(1 − s) ÷ 10;
    // within half a pixel of the range edge counts as in
    const share = Math.min((x(v < LO ? LO : HI) - x(v)) / dx, 1 - 0.5 / Math.abs(dx));
    const tc = Math.round(delay + (MOVE_MS * -Math.log2(1 - share)) / 10);
    l.style.setProperty("--tc", tc + "ms");
    l.dataset.tc = String(tc);
  });
})();

// NVFP4 ruler: the E2M1 values as ticks; the example block as dots that slide from the raw
// weights to the weights divided by the block scale (click 1), then snap to the nearest tick
// (click 2). Each dot rides a full-width box, so translate() percentages are of the ruler width.
(function ruler() {
  const rl = document.querySelector(".rl");
  if (!rl) return;
  const E2M1 = [0, 0.5, 1, 1.5, 2, 3, 4, 6];
  const ticks = [...new Set([...E2M1, ...E2M1.map((v) => -v)])];
  const BLOCK = [0.81, -0.12, 2.40, 0.33, -1.05, 0.07, 4.70, -0.66, 0.19, 1.62, -2.95, 0.48, -0.02, 0.91, -0.37, 1.24];
  const SPAN = 6.5, ROWS = 4, ROW_PX = 11;
  const TRACE = new Set([3, 5, 6]); // 0.33, 0.07 and 4.70: the three weights the script follows
  // the block scale is stored as FP8 (E4M3): amax / 6 = 0.7833 rounds to 0.8125 (step 0.0625 in [0.5, 1))
  const E4M3_STEP = 0.0625;
  const scale = Math.round(Math.max(...BLOCK.map(Math.abs)) / 6 / E4M3_STEP) * E4M3_STEP;
  const pct = (v) => (((v + SPAN) / (2 * SPAN)) * 100).toFixed(2) + "%";
  const nearest = (v) => ticks.reduce((a, t) => (Math.abs(t - v) < Math.abs(a - v) ? t : a));
  for (const t of ticks) {
    const i = document.createElement("i");
    i.className = "tick"; i.style.left = pct(t);
    i.dataset.v = String(t).replace("-", "−");
    rl.appendChild(i);
  }
  BLOCK.forEach((w, n) => {
    const s = w / scale, d = document.createElement("b"), dot = document.createElement("i");
    d.className = TRACE.has(n) ? "rdot tr" : "rdot";
    if (TRACE.has(n)) { dot.dataset.l = s.toFixed(2); dot.dataset.q = String(nearest(s)); } // scaled value before the snap, tick after it
    d.style.setProperty("--xr", pct(w)); d.style.setProperty("--x0", pct(s)); d.style.setProperty("--x1", pct(nearest(s)));
    d.style.setProperty("--y", (n % ROWS) * ROW_PX + "px");
    d.appendChild(dot);
    rl.appendChild(d);
    const g = document.createElement("b");
    g.className = TRACE.has(n) ? "rghost tr" : "rghost"; g.style.left = pct(s); g.style.top = (n % ROWS) * ROW_PX + "px";
    rl.appendChild(g);
  });
})();

// PagedAttention: blocks are handed out as tokens arrive, so A, B and C take turns and D, which
// arrives last, comes after them. --i is each block's place in that order (deck.css pops them in by it).
(function pages() {
  const groups = [...document.querySelectorAll(".blocks .grp")].map((g) => [...g.querySelectorAll("i[class]")]).filter((g) => g.length);
  const late = groups.pop() ?? [];
  let order = 0;
  for (let r = 0; groups.some((g) => r < g.length); r++) for (const g of groups) if (r < g.length) g[r].style.setProperty("--i", String(order++));
  for (const b of late) b.style.setProperty("--i", String(order++));
})();

// Uppercase .tag labels keep units and names in their own case (GiB, tok/s, bf16, vLLM, llm-d, 90th).
(function tagCase() {
  const UNIT = /\b\d[\d.,]*\s?(?:GiB|KiB|MiB|GB|TB\/s|GB\/s|tok\/s|k)\b|\b(?:bf16|vLLM|llm-d|tok\/s|nvidia-smi|90th|99th|95th)\b/g;
  for (const tag of document.querySelectorAll(".tag")) {
    const walk = document.createTreeWalker(tag, NodeFilter.SHOW_TEXT);
    const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const node of nodes) {
      const text = node.textContent; let last = 0; const frag = document.createDocumentFragment();
      for (const m of text.matchAll(UNIT)) {
        frag.append(text.slice(last, m.index));
        const s = document.createElement("span"); s.className = "nc"; s.textContent = m[0]; frag.append(s);
        last = m.index + m[0].length;
      }
      if (last === 0) continue;
      frag.append(text.slice(last)); node.replaceWith(frag);
    }
  }
})();

// ── navigation ──
let cur = 0, at = 0, stop = null, booted = false;
const resets = new Map(); // slide → pending reset timer, so a quick return cancels it
let peer = mode === "show" && q.has("companion") ? window.opener : null; // paired presentation or presenter window

function sendState(target) {
  target?.postMessage({ i: cur, k: at, theme: document.documentElement.dataset.theme, blank: document.body.classList.contains("blank") }, messageTarget);
}

function render(i, k, remote) {
  i = Math.max(0, Math.min(slides.length - 1, Number.isFinite(i) ? Math.trunc(i) : 0));
  k = Math.max(0, Math.min(maxStep[i], Number.isFinite(k) ? Math.trunc(k) : 0));
  if (mode === "embed" && q.has("next")) [i, k] = k < maxStep[i] ? [i, k + 1] : i < slides.length - 1 ? [i + 1, 0] : [i, k];
  const changed = i !== cur || !slides[i].classList.contains("active");
  const s = slides[i];
  if (changed) {
    if (stop) stop();
    stop = null;
    const old = slides[cur];
    old.classList.remove("active");
    s.classList.add("active");
    clearTimeout(resets.get(s));
    if (!booted) for (const o of slides) { if (o !== s) apply(o, 0, true); }
    else if (old !== s) {
      // The outgoing slide keeps its last step while it fades, then resets out of sight.
      clearTimeout(resets.get(old));
      resets.set(old, setTimeout(() => apply(old, 0, true), RESET_AFTER_MS));
    }
    booted = true;
    if (k === 0) { // step-0 builds play on entry, with their delays: hide them at once (.snap: no transition), resolve that, then build
      s.classList.add("snap");
      apply(s, -1, true);
      for (const el of s.querySelectorAll('[data-step="0"], [data-step="0"] *')) void getComputedStyle(el).opacity;
      s.classList.remove("snap");
    }
    else { s.classList.add("snap"); requestAnimationFrame(() => requestAnimationFrame(() => s.classList.remove("snap"))); } // entering mid-slide: no replay
  }
  cur = i; at = k;
  // Apply the step before a loop starts, so its first frame reads the right step.
  apply(s, k, changed || still);
  // Entering mid-slide (a jump, or back from the next slide): finite CSS builds land at their end state;
  // looping animations (infinite iterations) keep running.
  if (changed && k > 0) for (const a of s.getAnimations({ subtree: true })) { if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); }
  const play = s.dataset.play, runs = play && PLAY[play] && mode !== "presenter";
  if (changed) {
    if (runs) stop = PLAY[play](s, still);
  } else if (still && runs) {
    if (stop) stop();
    stop = PLAY[play](s, true);
  } else s.onStep?.();
  if (mode === "show") history.replaceState(null, "", `#${i + 1}.${k}`);
  if (mode === "presenter") {
    if (changed) document.getElementById("pv-notes").scrollTop = 0;
    presenterUpdate();
  }
  if (!remote && peer && !peer.closed) sendState(peer);
}

function next() { if (at < maxStep[cur]) render(cur, at + 1); else if (cur < slides.length - 1) render(cur + 1, 0); }
function prev() { if (at > 0) render(cur, at - 1); else if (cur > 0) render(cur - 1, maxStep[cur - 1]); }

addEventListener("message", (e) => {
  const source = mode === "embed" ? window.parent : peer;
  if (!source || e.source !== source || e.origin !== messageOrigin || mode === "print") return;
  if (mode === "show" && e.data?.ready) { sendState(peer); return; }
  const { i, k, theme, blank } = e.data ?? {};
  if (!Number.isInteger(i) || !Number.isInteger(k)) return;
  if (theme === "dark" || theme === "light") document.documentElement.dataset.theme = theme;
  if (typeof blank === "boolean") document.body.classList.toggle("blank", blank);
  render(i, k, true);
});

const JUMP_MS = 2000; let jump = "", jumpTimer = 0;
if (mode === "show" || mode === "presenter") addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key;
  if (e.target instanceof Element && e.target.closest("input, select, textarea, [contenteditable]")) return;
  if ([" ", "Enter"].includes(key) && e.target instanceof Element && e.target.closest('button, a, summary, [role="button"]')) return;
  // Type a slide number, then Enter, to jump to its last step (digits expire after 2 s)
  if (/^[0-9]$/.test(key) && mode === "show") { jump = (jump + key).slice(-2); clearTimeout(jumpTimer); jumpTimer = setTimeout(() => { jump = ""; }, JUMP_MS); e.preventDefault(); return; }
  if (key === "Enter" && jump) { const n = Number(jump) - 1; jump = ""; if (n >= 0 && n < slides.length) render(n, maxStep[n]); e.preventDefault(); return; }
  if (["ArrowRight", "ArrowDown", " ", "PageDown", "Enter"].includes(key)) {
    if (e.shiftKey) { if (cur < slides.length - 1) render(cur + 1, 0); }
    else next();
  } else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(key)) {
    if (e.shiftKey) { if (cur > 0) render(cur - 1, 0); }
    else prev();
  }
  else if (key === "Home") render(0, 0);
  else if (key === "End") render(slides.length - 1, maxStep[slides.length - 1]);
  else if (key === "f") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  else if (key === "b" || key === "." || key === "d") {
    if (key === "d") {
      const r = document.documentElement, dark = (r.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
      r.dataset.theme = dark ? "light" : "dark";
    } else document.body.classList.toggle("blank");
    if (mode === "presenter") presenterUpdate();
    if (peer && !peer.closed) sendState(peer);
  }
  else if (key === "p" && mode === "show") {
    if (!peer || peer.closed) peer = window.open(location.pathname + "?presenter", "presenter");
    else peer.focus();
  }
  else if (key === "t" && mode === "presenter") t0 = Date.now();
  else if (key === "h" && mode === "presenter") document.getElementById("pv-follow-toggle").click();
  else return;
  e.preventDefault();
});
if (mode === "show") deck.addEventListener("click", (e) => (e.clientX > innerWidth / 3 ? next() : prev()));

// ── presenter ──
let t0 = 0;
const guide = { slide: -1, step: -1, items: [], index: 0, elapsed: 0, last: 0, running: false, wpm: 130 };
function mmss(s) { s = Math.max(0, Math.round(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); }
function guideDuration(item) { return Number(item.dataset.pause) || Number(item.dataset.words) * 60 / guide.wpm; }
function guidePaint(scroll = false) {
  const active = guide.items[guide.index];
  if (!active) return;
  guide.items.forEach((item, n) => {
    item.classList.toggle("pv-active", n === guide.index);
    if (n === guide.index) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  });
  document.getElementById("pv-follow-toggle").textContent = guide.running ? "Pause highlighting" : "Start highlighting";
  const sentences = guide.items.filter(item => item.classList.contains("pv-sentence"));
  const finished = guide.index === guide.items.length - 1 && guide.elapsed >= guideDuration(active);
  document.getElementById("pv-follow-status").textContent = !guide.running ? "Paused · click a sentence to resync"
    : finished ? "Step complete · advance when ready"
    : active.dataset.pause ? `Pause · ${Math.ceil(guideDuration(active) - guide.elapsed)} s`
    : `Sentence ${sentences.indexOf(active) + 1}/${sentences.length} · click to resync`;
  if (scroll) active.scrollIntoView({ block: "nearest", behavior: "instant" });
}
function guideSeek(index, scroll = true) {
  if (!guide.items[index]) return;
  guide.index = index; guide.elapsed = 0; guide.last = performance.now();
  guidePaint(scroll);
}
function guideTick(now = performance.now()) {
  if (!guide.running || !guide.items.length) return;
  guide.elapsed += Math.max(0, now - guide.last) / 1000;
  guide.last = now;
  const before = guide.index;
  while (guide.index < guide.items.length - 1 && guide.elapsed >= guideDuration(guide.items[guide.index])) {
    guide.elapsed -= guideDuration(guide.items[guide.index++]);
  }
  guide.elapsed = Math.min(guide.elapsed, guideDuration(guide.items[guide.index]));
  guidePaint(guide.index !== before);
}
function presenterUpdate() {
  if (!t0) t0 = Date.now();
  for (const f of document.querySelectorAll("#presenter iframe")) sendState(f.contentWindow);
  const notes = document.getElementById("pv-notes");
  const newSlide = guide.slide !== cur;
  const newPassage = newSlide || guide.step !== at;
  if (newSlide) {
    notes.innerHTML = slides[cur].querySelector(".notes")?.innerHTML ?? "";
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    for (const p of notes.querySelectorAll("p")) {
      const text = p.textContent;
      const emphasis = [];
      for (const strong of p.querySelectorAll("strong")) {
        const range = document.createRange();
        range.selectNodeContents(p); range.setEndBefore(strong);
        const start = range.toString().length, end = start + strong.textContent.length;
        const previous = emphasis.at(-1);
        if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
        else emphasis.push({ start, end });
      }
      p.replaceChildren();
      const speech = (part, start) => {
        let position = start;
        // Sentence segmentation treats these lowercase product names as continuations.
        for (const chunk of part.split(/(?<=[.!?])(?=\s+(?:vLLM|llm-d)\b)/)) for (const { segment } of segmenter.segment(chunk)) {
          const end = position + segment.length;
          if (!segment.trim()) { p.append(segment); position = end; continue; }
          const span = document.createElement("span");
          span.className = "pv-sentence";
          let cursor = position;
          for (const mark of emphasis) {
            if (mark.end <= position || mark.start >= end) continue;
            const left = Math.max(position, mark.start), right = Math.min(end, mark.end);
            span.append(text.slice(cursor, left));
            const strong = document.createElement("strong");
            strong.textContent = text.slice(left, right); span.append(strong);
            cursor = right;
          }
          span.append(text.slice(cursor, end));
          span.dataset.words = String(segment.match(/\S+/g)?.length ?? 0);
          p.append(span); position = end;
        }
      };
      let end = 0;
      for (const cue of text.matchAll(/\[(click|beat|hold|pause (\d+(?:\.\d+)?)s: ([^\]]+))\]/g)) {
        speech(text.slice(end, cue.index), end);
        const span = document.createElement("span");
        span.className = "pv-cue" + (cue[2] ? " pv-pause" : "");
        span.dataset.pause = String(cue[2] ?? { click: 1.5, beat: 3, hold: 5 }[cue[1]]);
        span.textContent = cue[2] ? `[pause ~${cue[2]} s: ${cue[3]}]` : `[${cue[1]}] ~${span.dataset.pause} s`;
        p.append(span); end = cue.index + cue[0].length;
      }
      speech(text.slice(end), end);
    }
  }
  const clicks = notes.textContent.match(/\[click\]/g)?.length ?? 0;
  if (newPassage) {
    notes.querySelector(".pv-active")?.classList.remove("pv-active");
    notes.querySelector("[aria-current]")?.removeAttribute("aria-current");
    notes.querySelectorAll("p").forEach((p, n) => {
      p.classList.toggle("done", n < at);
      p.classList.toggle("current", n === at);
      p.querySelectorAll(".pv-sentence").forEach(span => {
        if (n === at) { span.setAttribute("role", "button"); span.tabIndex = 0; }
        else { span.removeAttribute("role"); span.removeAttribute("tabindex"); }
      });
    });
    guide.slide = cur; guide.step = at;
    guide.items = [...notes.querySelectorAll("p.current .pv-sentence, p.current .pv-cue")];
  }
  if (newSlide && liveSeconds[cur]) {
    const cue = document.createElement("div");
    cue.className = "pv-delivery";
    const target = document.createElement("b"), instruction = document.createElement("span");
    target.textContent = `Live target ${mmss(liveStart[cur])}–${mmss(liveStart[cur] + liveSeconds[cur])} · ${mmss(liveSeconds[cur])} budget`;
    instruction.textContent = slides[cur].dataset.coach;
    cue.append(target, instruction);
    notes.prepend(cue);
  }
  const title = slides[cur].querySelector("h1,h2")?.cloneNode(true);
  title?.querySelectorAll("br").forEach(br => br.replaceWith(br.previousSibling?.textContent.endsWith("-") ? "" : " "));
  document.getElementById("pv-title").textContent = title?.textContent ?? "Speaker script";
  document.getElementById("pv-prev").disabled = cur === 0 && at === 0;
  document.getElementById("pv-next").disabled = cur === slides.length - 1 && at === maxStep[cur];
  document.getElementById("pv-pos").textContent = `slide ${cur + 1}/${slides.length} · step ${at}/${maxStep[cur]}` + (clicks !== maxStep[cur] ? " · notes clicks " + clicks : "");
  document.getElementById("pv-plan").textContent = "Script estimate at this slide ≈ " + mmss(planStart[cur]);
  if (newPassage) guideSeek(0, guide.running);
}
if (mode === "presenter") {
  peer = window.opener;
  document.title = "Speaker script · The Memory-Bandwidth Wall";
  deck.hidden = true;
  const pv = document.getElementById("presenter");
  pv.hidden = false;
  const open = document.getElementById("pv-open"), status = document.getElementById("pv-status");
  if (peer && !peer.closed) { open.textContent = "Show presentation"; status.textContent = "Presentation open. Navigation stays in sync."; }
  open.onclick = () => {
    if (peer && !peer.closed) { sendState(peer); peer.focus(); return; }
    const url = new URL(location.href);
    url.search = "?companion";
    url.hash = `${cur + 1}.${at}`;
    const theme = document.documentElement.dataset.theme;
    if (theme) url.searchParams.set("theme", theme);
    peer = window.open(url.href, "presentation");
    status.textContent = peer ? "Presentation open. Move it to your audience display." : "Allow pop-ups, then try Open presentation again.";
    open.textContent = peer ? "Show presentation" : "Open presentation";
  };
  document.getElementById("pv-prev").onclick = prev;
  document.getElementById("pv-next").onclick = next;
  document.getElementById("pv-reset").onclick = () => { t0 = Date.now(); };
  document.getElementById("pv-follow-toggle").onclick = () => {
    guideTick();
    guide.running = !guide.running; guide.last = performance.now();
    guidePaint(guide.running);
  };
  document.getElementById("pv-pace").onchange = (e) => {
    guideTick();
    const fraction = guide.elapsed / guideDuration(guide.items[guide.index]);
    guide.wpm = Number(e.target.value);
    guide.elapsed = fraction * guideDuration(guide.items[guide.index]);
    guidePaint();
  };
  const notes = document.getElementById("pv-notes");
  notes.onclick = (e) => {
    const sentence = e.target.closest("p.current .pv-sentence");
    if (sentence) guideSeek(guide.items.indexOf(sentence));
  };
  notes.onkeydown = (e) => {
    if (["Enter", " "].includes(e.key) && e.target.matches('.pv-sentence[role="button"]')) {
      e.preventDefault(); e.target.click();
    }
  };

  document.getElementById("pv-cur").src = location.pathname + "?embed";
  document.getElementById("pv-nxt").src = location.pathname + "?embed&next";
  setInterval(() => {
    guideTick();
    if (peer?.closed) {
      peer = null; open.textContent = "Open presentation";
      status.textContent = "Presentation closed. Open it again to reconnect.";
    }
    const el = (t0 - Date.now()) / -1000;
    document.getElementById("pv-time").textContent = mmss(el);
    document.getElementById("pv-time").className = el >= 2100 || (liveSeconds[cur] && el > liveStart[cur] + liveSeconds[cur]) ? "late" : "";
    const gauge = document.getElementById("pv-progress");
    gauge.style.strokeDashoffset = String(2100 - Math.min(el, 2100));
    gauge.classList.toggle("near", el >= 1980 && el < 2100);
    gauge.classList.toggle("over", el >= 2100);
  }, 500);
  document.querySelectorAll("#presenter iframe").forEach((f) => {
    f.tabIndex = -1;
    f.style.pointerEvents = "none";
    f.addEventListener("load", () => sendState(f.contentWindow));
  });
}

// ── scale to window ──
function fit() {
  if (mode === "print" || mode === "presenter") return;
  const s = Math.min(innerWidth / W, innerHeight / H);
  deck.style.transform = `translate(${(innerWidth - W * s) / 2}px, ${(innerHeight - H * s) / 2}px) scale(${s})`;
}
addEventListener("resize", fit);
if (mode === "show") addEventListener("hashchange", () => {
  const [hi, hk] = location.hash.slice(1).split(".").map(Number);
  if (hi >= 1 && (hi - 1 !== cur || (hk || 0) !== at)) render(hi - 1, hk || 0);
});
fit();

// ── start ──
if (mode === "print") {
  slides.forEach((s, i) => {
    s.classList.add("active");
    apply(s, maxStep[i], true);
    const play = s.dataset.play;
    if (play && PLAY[play]) PLAY[play](s, true);
  });
} else {
  const [hi, hk] = location.hash.slice(1).split(".").map(Number);
  render((hi || 1) - 1, hk || 0, mode === "presenter");
  if (mode === "presenter") peer?.postMessage({ ready: true }, messageTarget);
}
