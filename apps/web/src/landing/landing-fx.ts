/*
 * Анимации лендинга с отсылками к гербу бухгалтеров (прототип v78 и v91, modules/landing.js: lpSpi,
 * lpSpiral, landPathCalc, landLineSet, landLineRun, landTick, landStepsLine, landFx, landTileFx,
 * landCount). Герб бухгалтерской профессии: солнце — учёт освещает дела, весы — баланс, кривая Бернулли
 * (логарифмическая спираль) — учёт вечен. Сквозная линия идёт за прокруткой через всю страницу, плавно
 * переходя с левого поля на правое и обратно, и у заголовка каждого блока закручивается двойной спиралью
 * Бернулли; на её конце солнце; весы в углу качаются от прокрутки. Анимации — только без «уменьшить
 * движение» (класс `lp-anim` на `.land`): без него всё нарисовано сразу и стоит на месте.
 *
 * В прототипе лендинг — окно поверх программы со своей прокруткой; здесь прокручивается сама страница,
 * поэтому координаты считаются от верха `.land`, а «экран» — окно браузера.
 */

/** Лендинг в «уменьшить движение»: без заставки и анимаций. */
export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type Point = readonly [number, number];

/** Кривые Безье через точки `p` (сплайн Катмулла — Рома) от `from`-й до `to`-й; `a` — точки с соседями. */
function curves(a: readonly Point[], from: number, to: number, digits: number): string {
  const f = (q: Point) => `${q[0].toFixed(digits)} ${q[1].toFixed(digits)}`;
  let d = '';
  for (let i = from; i < to; i += 1) {
    const a0 = a[i - 1]!;
    const a1 = a[i]!;
    const a2 = a[i + 1]!;
    const a3 = a[i + 2]!;
    d += `C${f([a1[0] + (a2[0] - a0[0]) / 6, a1[1] + (a2[1] - a0[1]) / 6])} ${f([a2[0] - (a3[0] - a1[0]) / 6, a2[1] - (a3[1] - a1[1]) / 6])} ${f(a2)}`;
  }
  return d;
}

/**
 * Спираль Бернулли (логарифмическая, r = R·e^(−b·φ)) одной линией — от центра наружу; внешний конец
 * справа, с коротким росчерком (прототип lpSpi). `turns` — число витков, `digits` — знаков после запятой.
 */
export function spiral(
  cx: number,
  cy: number,
  R: number,
  turns = 2.6,
  b = 0.2,
  digits = 1,
): string {
  const n = Math.round(turns * 14);
  const full = turns * 2 * Math.PI;
  const p: Point[] = [];
  for (let j = 0; j <= n; j += 1) {
    const f = full * (1 - j / n) - 0.55;
    const r = R * Math.exp(-b * f);
    p.push([cx + r * Math.cos(-f), cy + r * Math.sin(-f)]);
  }
  const first = p[0]!;
  return `M${first[0].toFixed(digits)} ${first[1].toFixed(digits)}${curves([first, ...p, p[n]!], 1, n + 1, digits)}`;
}

/** Двойная спираль Бернулли в сквозной линии: точки входа и выхода и кривые до центра и от центра. */
export interface SpiralKnot {
  in: Point;
  out: Point;
  d1: string;
  d2: string;
}

/**
 * Двойная спираль Бернулли (прототип lpSpiral): линия входит сверху, закручивается к центру cx, cy и тем же
 * ходом раскручивается, выходя вниз. `side` 1 — вход справа от центра, выход слева; −1 — зеркально. Линия
 * проходит точно через центр: `d1` — кривые от входа до центра, `d2` — от центра до выхода.
 */
export function spiralKnot(cx: number, cy: number, R: number, side: 1 | -1): SpiralKnot {
  const b = 0.22;
  const n = 21;
  const full = 1.5 * 2 * Math.PI;
  const th0 = side > 0 ? -Math.atan(b) : Math.PI + Math.atan(b);
  const p: Point[] = [];
  for (let j = 0; j <= n; j += 1) {
    const f = (full * j) / n;
    const r = R * Math.exp(-b * f);
    const a = th0 + side * f;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const mirror = [...p].reverse().map(([x, y]): Point => [2 * cx - x, 2 * cy - y]);
  const pts: Point[] = [...p, [cx, cy], ...mirror];
  const m = pts.length;
  const first = pts[0]!;
  const last = pts[m - 1]!;
  // Соседи до входа и после выхода — по вертикали: линия входит и выходит отвесно.
  const a: Point[] = [[first[0], first[1] - R * 0.6], ...pts, [last[0], last[1] + R * 0.6]];
  return { in: first, out: last, d1: curves(a, 1, n + 2, 1), d2: curves(a, n + 2, m, 1) };
}

/** Ломаная по линии: точки и длина от начала линии до каждой из них. */
export interface PathPolyline {
  /** Дописать команды пути: M, L, Q, C с абсолютными координатами. */
  add: (d: string) => void;
  /** Длина ломаной сейчас. */
  length: () => number;
  /**
   * `n` точек через равный шаг `step` по длине линии; `scale` — во сколько раз длина линии по счёту
   * браузера больше длины ломаной (шаг задан в длине браузера).
   */
  sample: (step: number, n: number, scale?: number) => { xs: Float32Array; ys: Float32Array };
}

/**
 * Сквозная линия ломаной с шагом около 4 px — чтобы знать, где её кончик на любой длине, не спрашивая
 * браузер. ОТКЛОНЕНИЕ: docs/deviations.md#И-2 — прототип спрашивает `getPointAtLength` 2 400 раз, а
 * каждый вызов заново проходит всю линию: со спиралями это секунды простоя страницы при загрузке.
 */
export function pathPolyline(): PathPolyline {
  const px: number[] = [];
  const py: number[] = [];
  const pl: number[] = [];
  let x = 0;
  let y = 0;
  let len = 0;
  const to = (nx: number, ny: number) => {
    len += Math.hypot(nx - x, ny - y);
    x = nx;
    y = ny;
    px.push(x);
    py.push(y);
    pl.push(len);
  };
  return {
    add(d) {
      for (const m of d.matchAll(/([MLQC])([^MLQC]*)/g)) {
        const v = m[2]!
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        const v0 = v[0] ?? 0;
        const v1 = v[1] ?? 0;
        if (m[1] === 'M') {
          x = v0;
          y = v1;
          px.push(x);
          py.push(y);
          pl.push(len);
        } else if (m[1] === 'L') {
          to(v0, v1);
        } else {
          // Кривая второго порядка — та же кубическая с опорными точками на 2/3 пути к вершине.
          const quad = m[1] === 'Q';
          const ex = quad ? (v[2] ?? 0) : (v[4] ?? 0);
          const ey = quad ? (v[3] ?? 0) : (v[5] ?? 0);
          const ax = quad ? x + ((v0 - x) * 2) / 3 : v0;
          const ay = quad ? y + ((v1 - y) * 2) / 3 : v1;
          const bx = quad ? ex + ((v0 - ex) * 2) / 3 : (v[2] ?? 0);
          const by = quad ? ey + ((v1 - ey) * 2) / 3 : (v[3] ?? 0);
          const sx = x;
          const sy = y;
          const rough =
            Math.hypot(ax - sx, ay - sy) +
            Math.hypot(bx - ax, by - ay) +
            Math.hypot(ex - bx, ey - by);
          const parts = Math.max(4, Math.min(160, Math.ceil(rough / 4)));
          for (let k = 1; k <= parts; k += 1) {
            const t = k / parts;
            const u = 1 - t;
            to(
              u * u * u * sx + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * ex,
              u * u * u * sy + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ey,
            );
          }
        }
      }
    },
    length: () => len,
    sample(step, n, scale = 1) {
      const xs = new Float32Array(n);
      const ys = new Float32Array(n);
      const last = px.length - 1;
      let j = 0;
      for (let i = 0; i < n && last >= 0; i += 1) {
        const at = (i * step) / scale;
        while (j < last && pl[j + 1]! < at) j += 1;
        const a = pl[j]!;
        const b = pl[Math.min(last, j + 1)]!;
        const k = b > a ? Math.max(0, Math.min(1, (at - a) / (b - a))) : 0;
        const nx = px[Math.min(last, j + 1)]!;
        const ny = py[Math.min(last, j + 1)]!;
        xs[i] = px[j]! + (nx - px[j]!) * k;
        ys[i] = py[j]! + (ny - py[j]!) * k;
      }
      return { xs, ys };
    },
  };
}

/**
 * Кончик линии догоняет прокрутку плавно (прототип landLineRun): следующий шаг от `cur` к цели `to` —
 * 16 % оставшегося пути за кадр, ближе 0,6 px — сразу цель.
 */
export function chaseStep(cur: number, to: number): number {
  const rest = to - cur;
  return Math.abs(rest) < 0.6 ? to : cur + rest * 0.16;
}

/** Опорная точка «высота страницы → длина линии». */
export interface PathAnchor {
  y: number;
  l: number;
}

/**
 * Сколько линии нарисовано, когда точка `t` (62 % высоты экрана от верха страницы) дошла до высоты:
 * в центре каждой спирали кончик линии оказывается ровно тогда, когда заголовок блока на 62 % высоты
 * экрана; между опорными точками линия рисуется равномерно — и переход через страницу, и витки спирали
 * (прототип landTick).
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
 * Опорные точки по высотам центров спиралей (прототип landPathCalc): с конца — не ниже следующей и не ниже
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

/** Блоки, у заголовка которых линия закручивается спиралью: по очереди слева и справа. */
const KNOT_BLOCKS = [
  'emb',
  'who',
  'change',
  'features',
  'shots',
  'video',
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
  /** Докуда линия нарисована сейчас и докуда должна дойти (кончик догоняет цель плавно). */
  cur: number | null;
  to: number | null;
}

const q = <T extends Element>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Сквозная линия (прототип v91, landPathCalc): от «Листайте вниз» идёт вниз через всю страницу, плавно
 * переходя с левого поля на правое и обратно между блоками; у заголовка каждого блока — двойная спираль
 * Бернулли. `prev` — прежнее состояние: при пересчёте линия не прыгает к началу.
 */
function pathCalc(root: HTMLElement, prev: PathState | null): PathState | null {
  const svg = q<SVGSVGElement>(root, '#lp-path');
  const wrap = q<HTMLElement>(root, '#lp-emb .lp-wrap');
  const cue = q<HTMLElement>(root, '.lp-scroll i');
  if (!svg || !wrap || !cue || !root.clientWidth) return null;
  const p0 = q<SVGPathElement>(svg, '.lp-p0');
  const p1 = q<SVGPathElement>(svg, '.lp-p1');
  const sun = q<SVGGElement>(svg, '.lp-psun');
  const g = q<SVGGElement>(svg, '.lp-knots');
  if (!p0 || !p1 || !sun || !g) return null;
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
  // Поле страницы слева и справа от содержимого: на широком экране спираль крупная, на телефоне —
  // маленькая, у самого края.
  const cl = X(wrap.getBoundingClientRect()) + parseFloat(getComputedStyle(wrap).paddingLeft);
  const wide = cl >= 96;
  const R = wide
    ? Math.min(44, Math.round((cl - 14) / 2.7))
    : Math.max(6, Math.min(9, Math.round(cl / 2 - 1)));
  const lx = wide ? Math.round(cl - 12 - R) : Math.max(R + 3, Math.round(cl / 2));
  const cr = cue.getBoundingClientRect();
  const x0 = X(cr) + cr.width / 2;
  const y0 = Y(cr) + cr.height + 4;
  const f = (v: number) => v.toFixed(1);
  const blocks: { bot: number; pb: number; knot: SpiralKnot; c: Point }[] = [];
  for (const id of KNOT_BLOCKS) {
    const s = q<HTMLElement>(root, `#lp-${id}`);
    if (!s) continue;
    const r = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    const top = Y(r);
    const left = blocks.length % 2 === 0;
    const cx = left ? lx : W - lx;
    const cy = top + Math.min((parseFloat(cs.paddingTop) || 0) * 0.5, 34) + R * 0.25;
    blocks.push({
      bot: top + r.height,
      pb: parseFloat(cs.paddingBottom) || 0,
      knot: spiralKnot(cx, cy, R, left ? 1 : -1),
      c: [cx, cy],
    });
  }
  if (blocks.length === 0) return null;
  // От «Листайте вниз» линия спускается к полосе цифр, идёт по её верхней границе к левому полю и
  // входит в первую спираль — не пересекая текст.
  const e0 = blocks[0]!.knot.in;
  const sb = q<HTMLElement>(root, '.lp-stats');
  let px = e0[0];
  let d: string;
  let cy: number;
  if (sb && x0 - px > 40) {
    const bt = Y(sb.getBoundingClientRect()) + 0.5;
    const r = Math.max(2, Math.min(26, bt - y0));
    const r2 = Math.max(2, Math.min(30, (e0[1] - bt) / 2));
    d = `M${f(x0)} ${f(Math.min(y0, bt - r))}L${f(x0)} ${f(bt - r)}Q${f(x0)} ${f(bt)} ${f(x0 - r)} ${f(bt)}L${f(px + r2)} ${f(bt)}Q${f(px)} ${f(bt)} ${f(px)} ${f(bt + r2)}`;
    cy = bt + r2;
  } else {
    d = `M${f(x0)} ${f(y0)}C${f(x0)} ${f(y0 + 70)} ${f(px)} ${f(y0 + 10)} ${f(px)} ${f(y0 + 90)}`;
    cy = y0 + 90;
  }
  const centres: Point[] = [];
  const lengths: number[] = [];
  const poly = pathPolyline();
  // Начало линии — в ломаную; дальше каждый кусок дописывается и в путь, и в ломаную.
  poly.add(d);
  let fed = d.length;
  const feed = () => {
    poly.add(d.slice(fed));
    fed = d.length;
  };
  blocks.forEach((s, i) => {
    const e = s.knot.in;
    if (Math.abs(px - e[0]) < 2) {
      if (e[1] > cy) d += `L${f(e[0])} ${f(e[1])}`;
    } else {
      // Переход на другое поле: по своему полю вниз до конца предыдущего блока, потом плавная волна
      // через страницу к спирали следующего.
      const before = blocks[i - 1];
      const ys = Math.max(cy, Math.min(e[1] - 70, before ? before.bot - before.pb - 48 : cy));
      const h = (e[1] - ys) * 0.78;
      if (ys > cy) d += `L${f(px)} ${f(ys)}`;
      d += `C${f(px)} ${f(ys + h)} ${f(e[0])} ${f(e[1] - h)} ${f(e[0])} ${f(e[1])}`;
    }
    d += s.knot.d1;
    // Длина линии до центра спирали — по самой линии.
    feed();
    lengths.push(poly.length());
    centres.push(s.c);
    d += s.knot.d2;
    px = s.knot.out[0];
    cy = s.knot.out[1];
  });
  const ft = q<HTMLElement>(root, '.lp-foot');
  if (ft) {
    const fy = Y(ft.getBoundingClientRect());
    if (fy - 12 > cy) d += `L${f(px)} ${f(fy - 12)}`;
  }
  feed();
  p0.setAttribute('d', d);
  p1.setAttribute('d', d);
  // Длину всей линии браузер считает один раз: по ней рисуется штрих. Ломаная чуть короче кривой —
  // её длины приводятся к длине браузера.
  const total = p1.getTotalLength();
  const scale = poly.length() > 0 && total > 0 ? total / poly.length() : 1;
  const step = Math.max(6, total / 2400);
  const n = Math.floor(total / step) + 1;
  const { xs, ys } = poly.sample(step, n, scale);
  // Промежуток длиннее линии: в начале у неё не видно круглого конца нулевой длины (прототип v78, c2c5296).
  p1.style.strokeDasharray = `${total} ${total + 40}`;
  g.innerHTML = centres
    .map(([x, y]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${R > 12 ? 4.5 : 3}"/>`)
    .join('');
  const marks = [...g.children];
  const knots = centres.map((_, i) => ({
    len: Math.min(lengths[i]! * scale, total),
    el: marks[i]!,
  }));
  const anchors = pathAnchors(
    y0,
    centres.map(([, y], i) => ({ y, l: knots[i]!.len })),
    { y: ys[n - 1]!, l: total },
    H,
    vh,
  );
  const cur = prev?.cur != null ? Math.min(prev.cur, total) : null;
  return { total, step, n, xs, ys, anchors, line: p1, sun, knots, cur, to: null };
}

/** Кончик линии: `len` — докуда она нарисована; солнце — на конце, точки спиралей загораются. */
function lineSet(P: PathState, len: number) {
  P.cur = len;
  const i = Math.min(P.n - 1, Math.max(0, Math.round(len / P.step)));
  P.sun.setAttribute('transform', `translate(${P.xs[i]!.toFixed(1)} ${P.ys[i]!.toFixed(1)})`);
  P.line.style.strokeDashoffset = len > 0 ? (P.total - len).toFixed(1) : String(P.total + 20);
  for (const k of P.knots) k.el.classList.toggle('on', len >= k.len - 1);
}

/**
 * Кадр прокрутки: цель для кончика линии (`chase` плавно ведёт к ней линию), кольцо весов, «Как это
 * выглядит», «Как начать».
 */
function tick(root: HTMLElement, P: PathState | null, chase: () => void) {
  const anim = root.classList.contains('lp-anim');
  const vh = window.innerHeight;
  const st = -root.getBoundingClientRect().top;
  const H = root.scrollHeight;
  if (P) {
    if (anim) {
      P.to = drawnLength(P.anchors, P.total, st + vh * 0.62);
      // Первый кадр — сразу на место, дальше кончик догоняет прокрутку плавно.
      if (P.cur == null) lineSet(P, P.to);
      else chase();
    } else lineSet(P, P.total);
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

/**
 * «Возможности»: запустить анимацию значка плитки заново (прототип landTileFx; класс `fx`, анимации
 * частей значка — в landing.css).
 */
export function playTile(tile: HTMLElement) {
  if (reducedMotion()) return;
  tile.classList.remove('fx');
  void tile.offsetWidth;
  tile.classList.add('fx');
  window.clearTimeout(Number(tile.dataset.fxTimer));
  tile.dataset.fxTimer = String(window.setTimeout(() => tile.classList.remove('fx'), 1900));
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
    if (x.matches('.lp-tile')) {
      const d = Number(x.style.getPropertyValue('--d')) || 0;
      later(() => playTile(x), 450 + d * 80);
    }
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

  // «Возможности»: значок оживает под мышью, а пока блок на экране — у плиток по очереди.
  const tiles = [...root.querySelectorAll<HTMLElement>('.lp-tile')];
  const feat = q<HTMLElement>(root, '#lp-features');
  if (anim && feat && tiles.length > 0) {
    const cleanTiles = tiles.map((x) => {
      const enter = (e: PointerEvent) => {
        if (e.pointerType === 'mouse') playTile(x);
      };
      x.addEventListener('pointerenter', enter);
      return () => {
        x.removeEventListener('pointerenter', enter);
        window.clearTimeout(Number(x.dataset.fxTimer));
      };
    });
    let turn = 0;
    const idle = window.setInterval(() => {
      if (!feat.classList.contains('vis') || document.hidden) return;
      const x = tiles[turn % tiles.length]!;
      turn += 1;
      if (!x.matches(':hover')) playTile(x);
    }, 2300);
    cleanups.push(() => {
      window.clearInterval(idle);
      cleanTiles.forEach((f) => f());
    });
  }

  // Кончик линии не прыгает за прокруткой, а плавно догоняет её.
  let lineRaf = 0;
  const lineRun = () => {
    lineRaf = 0;
    if (!P || P.to == null) return;
    const next = chaseStep(P.cur ?? P.to, P.to);
    lineSet(P, next);
    if (next !== P.to) lineRaf = requestAnimationFrame(lineRun);
  };
  const chase = () => {
    if (!lineRaf) lineRaf = requestAnimationFrame(lineRun);
  };
  cleanups.push(() => cancelAnimationFrame(lineRaf));

  // Пересчёт линии при изменении размеров (окно, «Подробнее», шрифты).
  const calc = () => {
    if (stopped) return;
    stepsLine(root);
    P = pathCalc(root, P);
    tick(root, P, chase);
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
      tick(root, P, chase);
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
