/*
 * Анимации лендинга с отсылками к гербу бухгалтеров (прототип v78, modules/landing.js: lpLem,
 * landPathCalc, landTick, landStepsLine, landFx, landCount). Герб бухгалтерской профессии: солнце — учёт
 * освещает дела, весы — баланс, кривая Бернулли (∞) — учёт вечен. Сквозная линия Бернулли идёт за
 * прокруткой через всю страницу, на её конце солнце; весы в углу качаются от прокрутки. Анимации — только
 * без «уменьшить движение» (класс `lp-anim` на `.land`): без него всё нарисовано сразу и стоит на месте.
 *
 * В прототипе лендинг — окно поверх программы со своей прокруткой; здесь прокручивается сама страница,
 * поэтому координаты считаются от верха `.land`, а «экран» — окно браузера.
 */

/** Лендинг в «уменьшить движение»: без заставки и анимаций. */
export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Лемниската Бернулли (∞): центр cx, cy, полуширина a, n точек. Из центра идёт вниз-вправо и
 * возвращается в центр в том же направлении — так она встраивается в сквозную линию. `m` — начало пути,
 * `d` — кривые Безье через все точки (сплайн Катмулла — Рома).
 */
export function lemniscate(cx: number, cy: number, a: number, n = 24): { m: string; d: string } {
  const p: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    const t = Math.PI / 2 - (2 * Math.PI * i) / n;
    const s = Math.sin(t);
    const c = Math.cos(t);
    const k = 1 + s * s;
    p.push([cx + (a * c) / k, cy + (a * s * c) / k]);
  }
  const f = (q: readonly [number, number]) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`;
  const at = (i: number) => p[(i + n) % n]!;
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const a0 = at(i - 1);
    const a1 = at(i);
    const a2 = at(i + 1);
    const a3 = at(i + 2);
    d += `C${f([a1[0] + (a2[0] - a0[0]) / 6, a1[1] + (a2[1] - a0[1]) / 6])} ${f([a2[0] - (a3[0] - a1[0]) / 6, a2[1] - (a3[1] - a1[1]) / 6])} ${f(a2)}`;
  }
  return { m: `M${f(p[0]!)}`, d };
}

/** Опорная точка «высота страницы → длина линии». */
export interface PathAnchor {
  y: number;
  l: number;
}

/**
 * Сколько линии нарисовано, когда точка `t` (62 % высоты экрана от верха страницы) дошла до высоты:
 * у каждой петли кончик линии оказывается ровно тогда, когда заголовок блока на 62 % высоты экрана; между
 * опорными точками линия рисуется равномерно (прототип landTick).
 */
export function drawnLength(anchors: readonly PathAnchor[], total: number, t: number): number {
  if (anchors.length === 0 || t <= anchors[0]!.y) return 0;
  let k = 1;
  while (k < anchors.length && anchors[k]!.y < t) k += 1;
  if (k >= anchors.length) return total;
  const a = anchors[k - 1]!;
  const b = anchors[k]!;
  return a.l + (b.l - a.l) * Math.min(1, (t - a.y) / Math.max(1, b.y - a.y));
}

/**
 * Опорные точки по высотам петель (прототип landPathCalc): с конца — не ниже следующей и не ниже
 * `tmax` (конец линии успевает дорисоваться у подвала); в самом верху линия ещё не нарисована — она
 * начинается с первой прокрутки.
 */
export function pathAnchors(
  start: number,
  knots: readonly PathAnchor[],
  end: PathAnchor,
  pageHeight: number,
  viewHeight: number,
): PathAnchor[] {
  const a = [{ y: start, l: 0 }, ...knots.map((k) => ({ ...k })), { ...end }];
  const tmax = pageHeight - viewHeight * 0.38 - 2;
  for (let i = a.length - 1; i > 0; i -= 1) {
    a[i]!.y = Math.min(a[i]!.y, i === a.length - 1 ? tmax : a[i + 1]!.y - 1);
  }
  a[0]!.y = Math.min(Math.max(a[0]!.y, viewHeight * 0.62 + 1), a[1]!.y - 40);
  return a;
}

/** Блоки, у заголовка которых линия делает петлю ∞. */
const KNOT_BLOCKS = [
  'emb',
  'who',
  'change',
  'features',
  'shots',
  'start',
  'security',
  'faq',
  'lead',
] as const;

interface PathState {
  total: number;
  step: number;
  n: number;
  xs: Float32Array;
  ys: Float32Array;
  anchors: PathAnchor[];
  line: SVGPathElement;
  sun: SVGGElement;
  knots: { len: number; el: Element }[];
}

const q = <T extends Element>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Сквозная линия: от «Листайте вниз» по левому полю страницы, у заголовка каждого блока — петля ∞. */
function pathCalc(root: HTMLElement): PathState | null {
  const svg = q<SVGSVGElement>(root, '#lp-path');
  const wrap = q<HTMLElement>(root, '#lp-emb .lp-wrap');
  const cue = q<HTMLElement>(root, '.lp-scroll i');
  if (!svg || !wrap || !cue || !root.clientWidth) return null;
  const pr = root.getBoundingClientRect();
  const W = root.clientWidth;
  const H = root.scrollHeight;
  const vh = window.innerHeight;
  const Y = (r: DOMRect) => r.top - pr.top;
  const X = (r: DOMRect) => r.left - pr.left;
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.height = `${H}px`;
  const cl = X(wrap.getBoundingClientRect()) + parseFloat(getComputedStyle(wrap).paddingLeft);
  const wide = cl >= 96;
  const lx = wide ? Math.round(cl - 46) : Math.max(6, Math.round(cl / 2));
  const a = wide ? 26 : 8;
  const kx = lx;
  const cr = cue.getBoundingClientRect();
  const x0 = X(cr) + cr.width / 2;
  const y0 = Y(cr) + cr.height + 4;
  const f = (v: number) => v.toFixed(1);
  // От «Листайте вниз» линия спускается к полосе цифр, идёт по её верхней границе к левому полю и
  // дальше вниз — не пересекая текст.
  const sb = q<HTMLElement>(root, '.lp-stats');
  let d: string;
  let cy: number;
  if (sb && x0 - lx > 40) {
    const bt = Y(sb.getBoundingClientRect()) + 0.5;
    const r = Math.max(2, Math.min(18, bt - y0));
    d = `M${f(x0)} ${f(Math.min(y0, bt - r))}L${f(x0)} ${f(bt - r)}Q${f(x0)} ${f(bt)} ${f(x0 - r)} ${f(bt)}L${lx + 18} ${f(bt)}Q${lx} ${f(bt)} ${lx} ${f(bt + 18)}`;
    cy = bt + 18;
  } else {
    d = `M${f(x0)} ${f(y0)}C${f(x0)} ${f(y0 + 70)} ${lx} ${f(y0 + 10)} ${lx} ${f(y0 + 90)}`;
    cy = y0 + 90;
  }
  const kn: [number, number][] = [];
  for (const id of KNOT_BLOCKS) {
    const s = q<HTMLElement>(root, `#lp-${id}`);
    if (!s) continue;
    const ky =
      Y(s.getBoundingClientRect()) + Math.min(parseFloat(getComputedStyle(s).paddingTop) * 0.5, 34);
    const k = Math.min(wide ? 18 : 6, (ky - cy) / 4);
    if (ky - 70 > cy) d += `L${lx} ${f(ky - 70)}`;
    d += `C${lx} ${f(ky - 36)} ${f(kx - k)} ${f(ky - k)} ${f(kx)} ${f(ky)}${lemniscate(kx, ky, a).d}C${f(kx + k)} ${f(ky + k)} ${lx} ${f(ky + 34)} ${lx} ${f(ky + 70)}`;
    cy = ky + 70;
    kn.push([kx, ky]);
  }
  const ft = q<HTMLElement>(root, '.lp-foot');
  if (ft) {
    const fy = Y(ft.getBoundingClientRect());
    if (fy - 12 > cy) d += `L${lx} ${f(fy - 12)}`;
  }
  const p0 = q<SVGPathElement>(svg, '.lp-p0');
  const p1 = q<SVGPathElement>(svg, '.lp-p1');
  const sun = q<SVGGElement>(svg, '.lp-psun');
  const g = q<SVGGElement>(svg, '.lp-knots');
  if (!p0 || !p1 || !sun || !g) return null;
  p0.setAttribute('d', d);
  p1.setAttribute('d', d);
  const total = p1.getTotalLength();
  const step = Math.max(6, total / 1600);
  const n = Math.floor(total / step) + 1;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const pt = p1.getPointAtLength(i * step);
    xs[i] = pt.x;
    ys[i] = pt.y;
  }
  // Промежуток длиннее линии: в начале у неё не видно круглого конца нулевой длины (прототип v78, c2c5296).
  p1.style.strokeDasharray = `${total} ${total + 40}`;
  g.innerHTML = kn.map(([x, y]) => `<circle cx="${f(x)}" cy="${f(y)}" r="5"/>`).join('');
  const marks = [...g.children];
  const knots = kn.map(([x, y], i) => {
    let j = 0;
    for (; j < n; j += 1) if (Math.hypot(xs[j]! - x, ys[j]! - y) <= step * 0.75 + 1) break;
    return { len: Math.min(j, n - 1) * step, el: marks[i]! };
  });
  const anchors = pathAnchors(
    y0,
    kn.map(([, y], i) => ({ y, l: knots[i]!.len })),
    { y: ys[n - 1]!, l: total },
    H,
    vh,
  );
  return { total, step, n, xs, ys, anchors, line: p1, sun, knots };
}

/** Кадр прокрутки: конец линии с солнцем, петли, кольцо весов, «Как это выглядит», «Как начать». */
function tick(root: HTMLElement, P: PathState | null) {
  const anim = root.classList.contains('lp-anim');
  const vh = window.innerHeight;
  const st = -root.getBoundingClientRect().top;
  const H = root.scrollHeight;
  if (P) {
    let len = P.total;
    if (anim) {
      len = drawnLength(P.anchors, P.total, st + vh * 0.62);
      const i = Math.min(P.n - 1, Math.round(len / P.step));
      P.sun.setAttribute('transform', `translate(${P.xs[i]!.toFixed(1)} ${P.ys[i]!.toFixed(1)})`);
    }
    P.line.style.strokeDashoffset = len > 0 ? (P.total - len).toFixed(1) : String(P.total + 20);
    for (const k of P.knots) k.el.classList.toggle('on', len >= k.len);
  }
  const ring = q<SVGCircleElement>(root, '.lp-bal .b1');
  if (ring) {
    const read = H > vh ? Math.min(1, Math.max(0, st) / (H - vh)) : 1;
    ring.style.strokeDashoffset = read > 0.002 ? (1 - read).toFixed(4) : '1.1';
  }
  if (!anim) return;
  // «Как это выглядит»: экран раскрывается, пока блок въезжает.
  const tl = q<HTMLElement>(root, '.lp-tilt');
  if (tl) {
    const r = tl.getBoundingClientRect();
    tl.style.setProperty('--tp', clamp01((vh - r.top) / (vh * 0.75)).toFixed(3));
  }
  // «Как начать»: линия шагов заполняется, номера загораются.
  const sw = q<HTMLElement>(root, '.lp-steps-w');
  if (sw) {
    const r = sw.getBoundingClientRect();
    const p = clamp01((vh * 0.72 - r.top) / Math.max(1, r.height * 0.85));
    const li = [...sw.querySelectorAll('.lp-steps li')];
    sw.style.setProperty('--sp', p.toFixed(3));
    li.forEach((x, i) => x.classList.toggle('on', p >= i / Math.max(1, li.length - 1) - 0.01));
  }
}

/** Линия шагов «Как начать» — от первого номера до последнего (на ПК поперёк, на телефоне вдоль). */
function stepsLine(root: HTMLElement) {
  const sw = q<HTMLElement>(root, '.lp-steps-w');
  const ln = q<HTMLElement>(root, '.lp-sline');
  if (!sw || !ln) return;
  const nums = sw.querySelectorAll('.lp-num');
  if (nums.length < 2) return;
  const R = sw.getBoundingClientRect();
  const a = nums[0]!.getBoundingClientRect();
  const b = nums[nums.length - 1]!.getBoundingClientRect();
  const ax = a.left + a.width / 2 - R.left;
  const ay = a.top + a.height / 2 - R.top;
  const bx = b.left + b.width / 2 - R.left;
  const by = b.top + b.height / 2 - R.top;
  const h = Math.abs(by - ay) < 4;
  ln.dataset.o = h ? 'h' : 'v';
  Object.assign(
    ln.style,
    h
      ? { left: `${ax}px`, top: `${ay - 1.5}px`, width: `${bx - ax}px`, height: '3px' }
      : { left: `${ax - 1.5}px`, top: `${ay}px`, width: '3px', height: `${by - ay}px` },
  );
}

/** Числа полосы цифр досчитываются от нуля, когда полоса показалась. */
function countUp(b: HTMLElement) {
  const n = Number(b.dataset.lpCount);
  if (!n) return;
  const t0 = performance.now();
  const dur = 1200;
  const frame = (t: number) => {
    if (!b.isConnected) return;
    const k = Math.min(1, (t - t0) / dur);
    b.textContent = String(Math.round(n * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(frame);
  };
  b.textContent = '0';
  requestAnimationFrame(frame);
}

export interface LandingFx {
  /** Показать блоки (после заставки): появление при прокрутке. */
  reveal(): void;
  /** Весы герба взвешивают: монеты падают в чаши, весы уравновешиваются. */
  weigh(): void;
  stop(): void;
}

/**
 * Запуск анимаций лендинга (прототип landFx). `deferReveal` — идёт заставка: блоки появятся, когда она
 * улетит в шапку (`reveal`).
 */
export function startLandingFx(root: HTMLElement, deferReveal: boolean): LandingFx {
  const anim = !reducedMotion() && 'IntersectionObserver' in window;
  root.classList.toggle('lp-anim', anim);
  const timers: number[] = [];
  const later = (f: () => void, ms: number) => timers.push(window.setTimeout(f, ms));
  const cleanups: (() => void)[] = [];
  let stopped = false;
  let P: PathState | null = null;

  const emb = q<HTMLElement>(root, '#lp-emb');
  const embSvg = emb ? q<SVGSVGElement>(emb, '.lp-emb-svg') : null;
  const onIn = (x: HTMLElement) => {
    if (x.dataset.lpCount) countUp(x);
    if (x === emb) later(() => emb.classList.add('e-idle'), 3900);
    if (x.matches('.lp-fc')) {
      const d = Number(x.style.getPropertyValue('--d')) || 0;
      later(() => x.classList.add('now'), 900 + d * 260);
    }
  };
  let revealed = false;
  const reveal = () => {
    if (revealed || stopped) return;
    revealed = true;
    const items = root.querySelectorAll<HTMLElement>('.rv,.lp-live,[data-lp-count]');
    if (anim) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const t = e.target as HTMLElement;
            if (t.classList.contains('lp-live')) t.classList.toggle('vis', e.isIntersecting);
            if (e.isIntersecting && !t.classList.contains('in')) {
              t.classList.add('in');
              onIn(t);
              if (!t.classList.contains('lp-live')) io.unobserve(t);
            }
          }
        },
        { rootMargin: '0px 0px -12% 0px', threshold: 0 },
      );
      items.forEach((x) => io.observe(x));
      cleanups.push(() => io.disconnect());
    } else {
      root.querySelectorAll('.rv,.lp-live').forEach((x) => x.classList.add('in', 'vis'));
      root.querySelectorAll('.lp-fc').forEach((x) => x.classList.add('now'));
    }
  };
  if (!(deferReveal && anim)) reveal();

  // Пересчёт линии при изменении размеров (окно, «Подробнее», шрифты).
  const calc = () => {
    if (stopped) return;
    stepsLine(root);
    P = pathCalc(root);
    tick(root, P);
  };
  let rt = 0;
  const recalc = () => {
    window.clearTimeout(rt);
    rt = window.setTimeout(calc, 140);
  };
  cleanups.push(() => window.clearTimeout(rt));
  const main = q<HTMLElement>(root, 'main');
  if ('ResizeObserver' in window && main) {
    const ro = new ResizeObserver(recalc);
    ro.observe(main);
    cleanups.push(() => ro.disconnect());
  }
  window.addEventListener('resize', recalc);
  cleanups.push(() => window.removeEventListener('resize', recalc));
  requestAnimationFrame(calc);
  void document.fonts?.ready.then(recalc);

  // Весы в углу качаются от скорости прокрутки и снова выравниваются.
  const bb = q<SVGGElement>(root, '.lp-bal .bb');
  const bl = q<SVGGElement>(root, '.lp-bal .bl');
  const br = q<SVGGElement>(root, '.lp-bal .br');
  let ang = 0;
  let v = 0;
  let swingRaf = 0;
  let tickRaf = 0;
  let last = window.scrollY;
  const swing = () => {
    v += -ang * 0.09;
    v *= 0.86;
    ang += v;
    if (Math.abs(ang) < 0.05 && Math.abs(v) < 0.05) {
      ang = 0;
      v = 0;
      swingRaf = 0;
    } else swingRaf = requestAnimationFrame(swing);
    if (bb && bl && br) {
      bb.style.transform = `rotate(${ang.toFixed(2)}deg)`;
      bl.style.transform = br.style.transform = `rotate(${(-ang).toFixed(2)}deg)`;
    }
  };
  const bg = q<HTMLElement>(root, '.lp-hero-bg');
  const onScroll = () => {
    const y = window.scrollY;
    const dy = y - last;
    last = y;
    if (anim && bb && dy) {
      ang = Math.max(-16, Math.min(16, ang - Math.max(-2.2, Math.min(2.2, dy * 0.05))));
      if (!swingRaf) swingRaf = requestAnimationFrame(swing);
    }
    if (tickRaf) return;
    tickRaf = requestAnimationFrame(() => {
      tickRaf = 0;
      tick(root, P);
      if (anim && bg && y < 1600) bg.style.transform = `translate3d(0,${(y * 0.3).toFixed(1)}px,0)`;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  cleanups.push(() => {
    window.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(swingRaf);
    cancelAnimationFrame(tickRaf);
  });

  // Мышь над первым экраном чуть сдвигает солнце и картинку (только на ПК с мышью).
  const hero = q<HTMLElement>(root, '#lp-hero');
  if (anim && hero && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
    const move = (e: PointerEvent) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      hero.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    };
    hero.addEventListener('pointermove', move);
    cleanups.push(() => hero.removeEventListener('pointermove', move));
  }

  let weighT = 0;
  const weigh = () => {
    if (!embSvg) return;
    embSvg.classList.add('e-coins');
    if (!anim) return;
    embSvg.classList.remove('e-weigh');
    void embSvg.getBoundingClientRect();
    embSvg.classList.add('e-weigh');
    window.clearTimeout(weighT);
    weighT = window.setTimeout(() => embSvg.classList.remove('e-weigh'), 2700);
  };
  cleanups.push(() => window.clearTimeout(weighT));

  return {
    reveal,
    weigh,
    stop() {
      stopped = true;
      timers.forEach((t) => window.clearTimeout(t));
      cleanups.forEach((f) => f());
    },
  };
}
