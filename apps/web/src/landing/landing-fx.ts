/*
 * Анимации лендинга с отсылками к гербу бухгалтеров (прототип v78, v91 и v144–v146, modules/landing.js:
 * lpSpi, landBgCalc, landBgSet, landBgRun, landGrow, landTick, landStepsLine, landFx, landTileFx,
 * landCount). Герб бухгалтерской профессии: солнце — учёт освещает дела, весы — баланс, кривая Бернулли
 * (логарифмическая спираль) — учёт вечен. Спираль логотипа — та же кривая: она на фоне страницы, при
 * открытии выходит из знака в шапке, при прокрутке поворачивается и чуть сжимается (решение заказчика
 * 18.11.2026, вместо сквозной линии); весы в углу качаются от прокрутки. Анимации — только без «уменьшить
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

/** «Возможности» (прототип v144): примеры на карточке функции — текст словаря через «|», не больше трёх. */
export const featureChips = (text: string): string[] =>
  text
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 3);

/** Место спирали на фоне: ширина рисунка и сдвиг его левого верхнего угла от угла экрана, px. */
export interface BgSpiralPlace {
  width: number;
  left: number;
  top: number;
}

/**
 * Спираль логотипа на фоне (прототип v145, landBgCalc): на ПК — 72 % ширины экрана, от 760 до 1180 px,
 * чуть за левым краем и на пятую часть высоты ниже верха; на телефоне — шире экрана и ниже.
 */
export function bgSpiralPlace(screenWidth: number, screenHeight: number): BgSpiralPlace {
  const wide = screenWidth >= 768;
  const width = Math.round(
    wide ? Math.min(1180, Math.max(760, screenWidth * 0.72)) : screenWidth * 1.45,
  );
  return {
    width,
    left: Math.round(wide ? -width * 0.14 : -width * 0.32),
    top: Math.round(wide ? screenHeight * 0.2 : screenHeight * 0.34),
  };
}

/** Поворот спирали по прокрутке, градусы по часовой стрелке (прототип landTick): дальше 30 000 px не растёт. */
export const bgSpiralTurn = (scroll: number): number =>
  Math.min(Math.max(0, scroll), 30000) * 0.045;

/** С поворотом спираль чуть сжимается — «скручивается», не больше чем на пятую часть (прототип landBgSet). */
export const bgSpiralScale = (turn: number): number => 1 - Math.min(0.2, turn / 2600);

/**
 * Поворот плавно догоняет прокрутку (прототип landBgRun): за кадр — доля остатка по времени кадра `dt`, мс
 * (кадр длиннее 64 мс считается за 64); ближе 0,02° — сразу цель.
 */
export function bgSpiralStep(cur: number, to: number, dt: number): number {
  const d = to - cur;
  if (Math.abs(d) < 0.02) return to;
  return cur + d * (1 - Math.exp(-Math.min(64, dt) / 240));
}

/** Спираль на фоне: поворот сейчас, цель и время прошлого кадра. */
interface BgState {
  a: number;
  to: number;
  t0: number;
}

const q = <T extends Element>(root: ParentNode, sel: string) => root.querySelector<T>(sel);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Поставить спираль на место по размеру экрана (прототип landBgCalc). */
function bgCalc(root: HTMLElement) {
  const g = q<HTMLElement>(root, '#lp-bgsp .lp-bgsp-g');
  const width = document.documentElement.clientWidth;
  if (!g || !width) return;
  const place = bgSpiralPlace(width, window.innerHeight);
  Object.assign(g.style, {
    width: `${place.width}px`,
    left: `${place.left}px`,
    top: `${place.top}px`,
  });
}

/** Повернуть и сжать спираль (прототип landBgSet). */
function bgSet(root: HTMLElement, B: BgState) {
  const s = q<SVGSVGElement>(root, '.lp-bgsp-s');
  if (s) s.style.transform = `rotate(${B.a.toFixed(2)}deg) scale(${bgSpiralScale(B.a).toFixed(4)})`;
}

/**
 * Кадр прокрутки: цель поворота спирали на фоне (`chase` плавно ведёт к ней), кольцо весов, «Как это
 * выглядит», «Как начать».
 */
function tick(root: HTMLElement, B: BgState, chase: () => void) {
  const anim = root.classList.contains('lp-anim');
  const vh = window.innerHeight;
  const st = -root.getBoundingClientRect().top;
  const H = root.scrollHeight;
  // При «уменьшить движение» спираль стоит на фоне: не растёт и не поворачивается (прототип v146).
  B.to = anim ? bgSpiralTurn(st) : 0;
  if (anim) chase();
  else {
    B.a = B.to;
    bgSet(root, B);
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
 * «Возможности»: запустить анимацию карточки функции заново — значок и примеры по очереди (прототип
 * landTileFx; класс `fx`, анимации — в landing.css).
 */
export function playTile(tile: HTMLElement) {
  if (reducedMotion()) return;
  tile.classList.remove('fx');
  void tile.offsetWidth;
  tile.classList.add('fx');
  window.clearTimeout(Number(tile.dataset.fxTimer));
  tile.dataset.fxTimer = String(window.setTimeout(() => tile.classList.remove('fx'), 2200));
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
  const B: BgState = { a: 0, to: 0, t0: 0 };

  const emb = q<HTMLElement>(root, '#lp-emb');
  const embSvg = emb ? q<SVGSVGElement>(emb, '.lp-emb-svg') : null;
  const onIn = (x: HTMLElement) => {
    if (x.dataset.lpCount) countUp(x);
    if (x === emb) later(() => emb.classList.add('e-idle'), 3900);
    if (x.matches('.lp-fcd')) {
      const d = Number(x.style.getPropertyValue('--d')) || 0;
      later(() => playTile(x), 350 + d * 160);
    }
    if (x.matches('.lp-fc')) {
      const d = Number(x.style.getPropertyValue('--d')) || 0;
      later(() => x.classList.add('now'), 900 + d * 260);
    }
  };
  // Спираль выходит из знака: сначала она ровно на месте знака в шапке и его размера, поверх шапки, потом
  // плавно вырастает и бледнеет до фона (прототип landGrow). Страницу открыли не с начала — сразу на фоне.
  const bgBox = q<HTMLElement>(root, '#lp-bgsp');
  let growRaf = 0;
  const grow = () => {
    const g = bgBox ? q<HTMLElement>(bgBox, '.lp-bgsp-g') : null;
    if (!bgBox || !g) return;
    const mark = q<Element>(root, '.lp-logo .logo');
    const from = mark?.getBoundingClientRect();
    const to = g.getBoundingClientRect();
    if (!from?.width || !to.width || window.scrollY > 40) {
      bgBox.classList.remove('pre');
      return;
    }
    bgBox.classList.add('grow0');
    bgBox.classList.remove('pre');
    g.style.transform = `translate(${(from.left - to.left).toFixed(2)}px,${(from.top - to.top).toFixed(2)}px) scale(${(from.width / to.width).toFixed(5)})`;
    void g.getBoundingClientRect();
    growRaf = requestAnimationFrame(() => {
      bgBox.classList.remove('grow0');
      bgBox.classList.add('growing', 'over');
      g.style.transform = 'translate(0px,0px) scale(1)';
      // Поверх шапки спираль только в начале, пока выходит из знака; дальше уходит под текст первого экрана.
      later(() => bgBox.classList.remove('over'), 380);
      later(() => bgBox.classList.remove('growing'), 2000);
    });
  };
  cleanups.push(() => cancelAnimationFrame(growRaf));

  let revealed = false;
  const reveal = () => {
    if (revealed || stopped) return;
    revealed = true;
    const items = root.querySelectorAll<HTMLElement>('.rv,.lp-live,[data-lp-count]');
    bgCalc(root);
    if (anim) {
      grow();
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
      bgBox?.classList.remove('pre');
      root.querySelectorAll('.rv,.lp-live').forEach((x) => x.classList.add('in', 'vis'));
      root.querySelectorAll('.lp-fc').forEach((x) => x.classList.add('now'));
    }
  };
  if (!(deferReveal && anim)) reveal();

  // «Возможности»: карточка оживает под мышью, а пока блок на экране — карточки на экране по очереди.
  const tiles = [...root.querySelectorAll<HTMLElement>('.lp-fcd')];
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
      const vh = window.innerHeight;
      const shown = tiles.filter((x) => {
        const r = x.getBoundingClientRect();
        return r.height > 0 && r.bottom > 60 && r.top < vh;
      });
      if (shown.length === 0) return;
      const x = shown[turn % shown.length]!;
      turn += 1;
      if (!x.matches(':hover')) playTile(x);
    }, 1700);
    cleanups.push(() => {
      window.clearInterval(idle);
      cleanTiles.forEach((f) => f());
    });
  }

  // Поворот спирали на фоне не прыгает за прокруткой, а плавно догоняет её.
  let bgRaf = 0;
  const bgRun = (t: number) => {
    bgRaf = 0;
    const dt = B.t0 ? t - B.t0 : 16;
    B.t0 = t;
    B.a = bgSpiralStep(B.a, B.to, dt);
    bgSet(root, B);
    if (B.a === B.to) B.t0 = 0;
    else bgRaf = requestAnimationFrame(bgRun);
  };
  const chase = () => {
    if (!bgRaf) bgRaf = requestAnimationFrame(bgRun);
  };
  cleanups.push(() => cancelAnimationFrame(bgRaf));

  // Пересчёт при изменении размеров (окно, «Подробнее», шрифты): линия шагов и место спирали на фоне.
  const calc = () => {
    if (stopped) return;
    stepsLine(root);
    bgCalc(root);
    tick(root, B, chase);
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
      tick(root, B, chase);
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
