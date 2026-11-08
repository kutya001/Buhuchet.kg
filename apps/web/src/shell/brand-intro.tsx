'use client';

import { BRAND_LOGO } from '@buhuchet/ui';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import './brand-intro.css';

/*
 * Заставка с логотипом при каждом входе (Кутман 08.11.2026; прототип v78, modules/landing.js: buIntro,
 * buIntroEnd, buIntroTargets): спираль знака рисуется от центра, встают B и u, по буквам складывается
 * BuhUchet.kg; через 2,7 с знак и надпись улетают туда, где логотип на экране — в шапку лендинга, на карточку
 * входа или в меню программы (на телефоне меню скрыто — знак уходит вверх и тает). Нажатие или любая
 * клавиша — сразу. Где показывается: лендинг — при каждом открытии; страница входа — при загрузке страницы;
 * программа (макет /app) — при загрузке её страницы и при переходе в неё после входа. При «уменьшить
 * движение» заставки нет.
 */

/** Маска «спираль рисуется от центра»: средняя линия спирали логотипа (прототип lpMask). */
export function DrawMask({ id }: { id: string }) {
  return (
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="-4" y="6" width="76" height="62">
        <path className="lp-draw" d={BRAND_LOGO.centerline} pathLength={1} />
      </mask>
    </defs>
  );
}

/** Знак: спираль под маской, буквы B и u отдельными группами (прототип lpLogoBody). */
export function LogoBody({ id, letters = '' }: { id: string; letters?: string }) {
  return (
    <>
      <DrawMask id={id} />
      <path className="lg-sp" mask={`url(#${id})`} d={BRAND_LOGO.spiral} />
      <g className={`lp-lg-b ${letters}`}>
        <path className="lg-l" transform={BRAND_LOGO.b.transform} d={BRAND_LOGO.b.d} />
      </g>
      <g className={`lp-lg-u ${letters}`}>
        <path className="lg-l" transform={BRAND_LOGO.u.transform} d={BRAND_LOGO.u.d} />
      </g>
    </>
  );
}

const FLY_MS = 2700;
const GONE_MS = 850;
const WORD = [...'BuhUchet'];
/** После «Выйти» страница входа открывается без заставки (прототип: выход — сразу экран входа). */
const SKIP_KEY = 'bh_intro_skip';
/** Отметка «без заставки» действует столько, мс: только на переход, ради которого её поставили. */
const SKIP_MS = 10_000;

/**
 * Строка в начале заставки — до скриптов страницы: с какого мгновения заставка на экране (`buT0`), нажатие
 * или клавиша до загрузки скриптов (`buGo`); без заставки (класс `off`) — сразу после «Выйти» и в браузере под
 * управлением тестов (`navigator.webdriver`: сквозные тесты открывают сотни страниц, заставку проверяют
 * отдельно; docs/deviations.md п. О-52).
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#О-52
const BOOT = `(function(s){var o=s&&s.parentNode,k='${SKIP_KEY}',x=0;if(!o)return;o.buT0=performance.now();try{x=+sessionStorage.getItem(k)||0;sessionStorage.removeItem(k)}catch(e){}if(Date.now()-x<${SKIP_MS}||navigator.webdriver){o.classList.add('off');return}var g=function(){o.buGo=1};o.addEventListener('click',g);document.addEventListener('keydown',g,{once:true});o.buStop=function(){o.removeEventListener('click',g);document.removeEventListener('keydown',g)}})(document.currentScript)`;

/** Следующая загрузка страницы в этой вкладке — без заставки (вызывается перед переходом на страницу входа). */
export function skipNextIntro(): void {
  try {
    sessionStorage.setItem(SKIP_KEY, String(Date.now()));
  } catch {
    // Без хранилища страница входа покажет заставку.
  }
}

/** Документ уже показал первую страницу: дальнейшие переходы — без перезагрузки. */
let loaded = false;

/**
 * Компонент рисуется при загрузке страницы (разметка пришла с сервера), а не при переходе без перезагрузки:
 * строки `<script>` в разметке нужны только тогда — при переходе React их не выполняет.
 */
export function usePageLoad(): boolean {
  const [first] = useState(() => !loaded);
  return first;
}

function visible(e: Element | null | undefined): Element | null {
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return r.width &&
    r.height &&
    r.bottom > 0 &&
    r.right > 0 &&
    r.left < innerWidth &&
    r.top < innerHeight
    ? e
    : null;
}

/** Куда улетают знак и надпись (прототип buIntroTargets): шапка лендинга, иначе первый видимый знак на экране. */
function introTargets(): [Element | null, Element | null] {
  const land = document.querySelector('.land');
  if (land) {
    return [visible(land.querySelector('.lp-logo .logo')), visible(land.querySelector('.lp-bn'))];
  }
  for (const mark of document.querySelectorAll('[data-brand-mark]')) {
    if (!visible(mark)) continue;
    return [mark, visible(mark.parentElement?.querySelector('[data-brand-name]'))];
  }
  return [null, null];
}

/** Сдвиг и масштаб, чтобы элемент `a` встал на место `b`. */
function fitTo(a: Element | null, b: Element | null): string {
  if (!a || !b) return '';
  const r1 = a.getBoundingClientRect();
  const r2 = b.getBoundingClientRect();
  if (!r1.height || !r2.height) return '';
  const dx = r2.left + r2.width / 2 - r1.left - r1.width / 2;
  const dy = r2.top + r2.height / 2 - r1.top - r1.height / 2;
  return `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px) scale(${(r2.height / r1.height).toFixed(3)})`;
}

const quiet = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches || navigator.webdriver;

type IntroElement = HTMLDivElement & { buT0?: number; buGo?: number; buStop?: () => void };

/**
 * Заставка поверх страницы. `onlyOnLoad` — только при загрузке страницы, не при переходе на неё (страница
 * входа). `onReveal` — страница может показываться: через 150 мс после взлёта знака, без заставки — сразу.
 */
export function BrandIntro({
  onlyOnLoad = false,
  onReveal,
}: {
  onlyOnLoad?: boolean;
  onReveal?: () => void;
}) {
  // При загрузке страницы заставка уже в разметке с сервера (её прячет CSS или строка BOOT); при переходе
  // без перезагрузки — только если она нужна.
  const [on, setOn] = useState(() => !loaded || (!onlyOnLoad && !quiet()));
  const boot = usePageLoad();
  const ref = useRef<IntroElement>(null);
  const reveal = useRef(onReveal);
  useEffect(() => {
    reveal.current = onReveal;
  });

  useEffect(() => {
    loaded = true;
    const el = ref.current;
    el?.buStop?.();
    const timers: number[] = [];
    let target: Element | null = null;
    const end = () => {
      target?.classList.remove('bu-intro-tg');
      target = null;
      setOn(false);
    };
    if (!el || el.classList.contains('off') || quiet()) {
      const raf = requestAnimationFrame(() => {
        reveal.current?.();
        if (el) end();
      });
      return () => cancelAnimationFrame(raf);
    }
    let flown = false;
    const fly = () => {
      if (flown) return;
      flown = true;
      timers.push(window.setTimeout(() => reveal.current?.(), 150));
      timers.push(window.setTimeout(end, GONE_MS));
      if (el.classList.contains('fly')) return;
      const [mark, name] = introTargets();
      const logo = el.querySelector<SVGSVGElement>('.lp-intro-lg');
      const word = el.querySelector<HTMLElement>('.lp-intro-w');
      const to = fitTo(logo, mark);
      if (logo) {
        logo.style.transform = to || 'translateY(-34vh) scale(.3)';
        if (!to) logo.classList.add('gone');
      }
      if (word) word.style.transform = fitTo(word, name) || 'translateY(-26vh) scale(.4)';
      if (mark) {
        mark.classList.add('bu-intro-tg');
        target = mark;
      }
      el.classList.add('fly');
    };
    const t0 = el.buT0 ?? performance.now();
    if (el.buGo) fly();
    else timers.push(window.setTimeout(fly, Math.max(0, FLY_MS - (performance.now() - t0))));
    el.addEventListener('click', fly);
    document.addEventListener('keydown', fly, { once: true });
    return () => {
      timers.forEach((x) => window.clearTimeout(x));
      el.removeEventListener('click', fly);
      document.removeEventListener('keydown', fly);
      target?.classList.remove('bu-intro-tg');
    };
  }, []);

  if (!on) return null;
  return (
    <div ref={ref} className="lp-intro" aria-hidden="true" suppressHydrationWarning>
      {boot ? <script dangerouslySetInnerHTML={{ __html: BOOT }} /> : null}
      <div className="lp-intro-c">
        <svg className="lp-intro-lg" viewBox={BRAND_LOGO.viewBox} focusable="false">
          <LogoBody id="lp-inm" letters="lp-in-l" />
        </svg>
        <div className="lp-intro-w">
          {WORD.map((c, i) => (
            <span key={i} style={{ '--i': i } as CSSProperties}>
              {c}
            </span>
          ))}
          <span className="kg" style={{ '--i': 9 } as CSSProperties}>
            .kg
          </span>
        </div>
        <i className="lp-intro-ln" />
      </div>
    </div>
  );
}
