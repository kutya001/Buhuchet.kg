import { BRAND_LOGO } from '@buhuchet/ui';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { Translate } from '../l10n/translate';
import { DrawMask, LogoBody } from '../shell/brand-intro';
import { spiral } from './landing-fx';

/*
 * Рисунки лендинга v78 и v91 (прототип modules/landing.js: landLogo, landHeroBg, landEmblem, lpSpiIc,
 * LP_FI, сквозная линия и весы в landDraw, щит «Безопасности»): только SVG, тексты — из словаря.
 */

/** Знак в шапке: спираль дорисовывается при открытии и при наведении (прототип landLogo). */
export function LandLogo() {
  return (
    <svg
      className="logo lp-logo-a"
      viewBox={BRAND_LOGO.viewBox}
      aria-hidden="true"
      focusable="false"
    >
      <LogoBody id="lp-lgm" />
    </svg>
  );
}

/** Фон первого экрана: солнце с лучами справа сверху и большая спираль логотипа (прототип landHeroBg). */
export function HeroBg() {
  return (
    <div className="lp-hero-bg" aria-hidden="true">
      <span className="lp-hb-sun" />
      <svg className="lp-hb-sp" viewBox={BRAND_LOGO.viewBox} focusable="false">
        <DrawMask id="lp-hbm" />
        <path className="lg-sp" mask="url(#lp-hbm)" d={BRAND_LOGO.spiral} />
      </svg>
    </div>
  );
}

/** Сквозная линия Бернулли с солнцем на конце: путь считает landing-fx (`#lp-path`). */
export function ScrollPath() {
  return (
    <svg className="lp-path" id="lp-path" aria-hidden="true" focusable="false">
      <path className="lp-p0" />
      <path className="lp-p1" />
      <g className="lp-knots" />
      <g className="lp-psun">
        <circle className="g" r="15" />
        <path
          className="r"
          d="M0-11V-15M0 11V15M-11 0H-15M11 0H15M-7.8-7.8-10.6-10.6M7.8 7.8 10.6 10.6M-7.8 7.8-10.6 10.6M7.8-7.8 10.6-10.6"
        />
        <circle className="c" r="6" />
      </g>
    </svg>
  );
}

/** Весы-значок в углу: кольцо — сколько прочитано, весы качаются от прокрутки. */
export function BalanceIcon() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle className="b0" cx="32" cy="32" r="29" />
      <circle className="b1" cx="32" cy="32" r="29" pathLength={1} transform="rotate(-90 32 32)" />
      <path className="bp" d="M32 19V47M25 48H39" />
      <g className="bb">
        <path className="bk" d="M16 22H48" />
        <g className="bl">
          <path d="M16 22L11 33M16 22L21 33" />
          <path className="bw" d="M9.5 33H22.5Q21 38 16 38Q11 38 9.5 33Z" />
        </g>
        <g className="br">
          <path d="M48 22L43 33M48 22L53 33" />
          <path className="bw" d="M41.5 33H54.5Q53 38 48 38Q43 38 41.5 33Z" />
        </g>
      </g>
      <circle className="bc" cx="32" cy="22" r="2.6" />
    </svg>
  );
}

/** Щит с замком «Безопасности и данных». */
export function Shield() {
  return (
    <svg className="lp-shield" viewBox="0 0 120 140" focusable="false">
      <path
        className="sh-b"
        d="M60 8L106 25V64C106 96 87 119 60 131C33 119 14 96 14 64V25Z"
        pathLength={1}
      />
      <path className="sh-k" d="M49 68V58a11 11 0 0 1 22 0v10" />
      <rect className="sh-l" x="42" y="66" width="36" height="28" rx="5" />
      <circle className="sh-h" cx="60" cy="78" r="3.6" />
      <path className="sh-h" d="M58.4 80h3.2l1 7h-5.2Z" />
    </svg>
  );
}

/** Печать после отправки заявки. */
export function Stamp() {
  return (
    <svg className="lp-stamp" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle cx="32" cy="32" r="29" />
      <circle className="i" cx="32" cy="32" r="23" />
      <path className="k" d="M21 33l7 7 15-16" />
    </svg>
  );
}

/** Символ герба. */
export type EmblemPart = 'sun' | 'scales' | 'curve';

/** Луч солнца герба: i-й из 12, длина l (прототип landEmblem, `r`). */
function ray(i: number, l: number) {
  const a = (i * Math.PI) / 6;
  const x = Math.sin(a);
  const y = -Math.cos(a);
  return `M${(150 + x * 21).toFixed(1)} ${(78 + y * 21).toFixed(1)}L${(150 + x * l).toFixed(1)} ${(78 + y * l).toFixed(1)}`;
}
const RAYS = Array.from({ length: 12 }, (_, i) => ray(i, i % 2 ? 27 : 32)).join('');
/** Спираль Бернулли герба — под весами (прототип v91: вместо «∞»). */
const SPIRAL = spiral(146, 235, 30);
/** Та же спираль для значка в списке символов герба (прототип lpSpiIc). */
const SPIRAL_ICON = spiral(11, 12.6, 8.4, 2.2, 0.2, 2);

/** Значок спирали Бернулли в списке символов герба. */
export function SpiralIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={SPIRAL_ICON} />
    </svg>
  );
}

function Pan({ x, side, label }: { x: number; side: 'l' | 'r'; label: string }) {
  return (
    <g className={`e-pan e-pan-${side}`}>
      <path className="e-str" d={`M${x} 124L${x - 17} 160M${x} 124L${x + 17} 160`} />
      <ellipse className={`e-coin e-coin-${side}`} cx={x} cy="157" rx="9" ry="3.2" />
      <path
        className="e-bowl"
        d={`M${x - 22} 160H${x + 22}Q${x + 19} 172 ${x} 172Q${x - 19} 172 ${x - 22} 160Z`}
      />
      <text className="e-lab" x={x} y="188">
        {label}
      </text>
    </g>
  );
}

/**
 * Круглый герб: кольцо с девизом (сверху по-французски, снизу по-русски), в поле солнце, весы с чашами
 * «Дебет» и «Кредит», под ними — спираль Бернулли. Нажатие на символ подсвечивает его (`onPick`).
 */
export function Emblem({ t, onPick }: { t: Translate; onPick: (part: EmblemPart) => void }) {
  const click = (e: MouseEvent<SVGSVGElement>) => {
    const part = (e.target as Element).closest<SVGGElement>('.e-part')?.dataset.e;
    if (part === 'sun' || part === 'scales' || part === 'curve') onPick(part);
  };
  return (
    <svg
      className="lp-emb-svg"
      viewBox="0 0 300 300"
      role="img"
      aria-label={t('land.emb.aria')}
      focusable="false"
      onClick={click}
    >
      <defs>
        <radialGradient id="lpe-glow">
          <stop offset="0" className="e-g0" />
          <stop offset="1" className="e-g1" />
        </radialGradient>
        <radialGradient id="lpe-fld" cx="50%" cy="38%" r="62%">
          <stop offset="0" className="e-f0" />
          <stop offset="1" className="e-f1" />
        </radialGradient>
        <path id="lpe-top" d="M25 150A125 125 0 0 1 275 150" />
        <path id="lpe-bot" d="M14 150A136 136 0 0 0 286 150" />
      </defs>
      <circle className="e-rip" cx="150" cy="150" r="146" />
      <g className="e-seal">
        <circle className="e-band" cx="150" cy="150" r="146" />
        <circle className="e-edge" cx="150" cy="150" r="143" pathLength={1} />
        <circle className="e-field" cx="150" cy="150" r="117" fill="url(#lpe-fld)" />
        <circle className="e-dots" cx="150" cy="150" r="111" pathLength={1} />
        <text className="e-ring">
          <textPath href="#lpe-top" startOffset="50%" textAnchor="middle">
            {t('land.emb.motto')}
          </textPath>
        </text>
        <text className="e-ring">
          <textPath href="#lpe-bot" startOffset="50%" textAnchor="middle">
            {t('land.emb.motto.r')}
          </textPath>
        </text>
        <path className="e-star" d="M10 150l4-4 4 4-4 4ZM282 150l4-4 4 4-4 4Z" />
      </g>
      <g className="e-part e-sun" data-e="sun">
        <circle className="e-glow" cx="150" cy="78" r="42" fill="url(#lpe-glow)" />
        <path className="e-rays" d={RAYS} />
        <circle className="e-core" cx="150" cy="78" r="15" />
      </g>
      <g className="e-part e-scales" data-e="scales">
        <path className="e-post" d="M150 118V197" />
        <path className="e-base" d="M129 205H171L163 196H137Z" />
        <g className="e-beam">
          <path className="e-bar" d="M88 124H212" />
          <Pan x={88} side="l" label={t('land.emb.debit')} />
          <Pan x={212} side="r" label={t('land.emb.credit')} />
          <circle className="e-piv" cx="150" cy="124" r="5" />
        </g>
        <circle className="e-top" cx="150" cy="112" r="4" />
      </g>
      <g className="e-part e-curve" data-e="curve">
        <path className="e-inf" d={SPIRAL} pathLength={1} />
        <path className="e-comet" d={SPIRAL} pathLength={1} />
      </g>
    </svg>
  );
}

/** Задержка появления элемента в блоке (`--d` прототипа). */
export const delay = (d: number) => ({ '--d': d }) as CSSProperties;

/** Очередь части значка в его анимации (`--i` прототипа). */
const turn = (i: number) => ({ '--i': i }) as CSSProperties;

/*
 * «Возможности» (прототип v91, LP_FI): значок каждой функции собран из частей, и у каждого своя анимация
 * (классы f1…f12 в landing.css): 1 — листы отчётов раскладываются веером, 2 — отметка срока прыгает по
 * дням, 3 — лупа проходит по списку и ставит галочку, 4 — самолётик улетает и возвращается, 5 — галочки
 * ставятся по очереди, 6 — монета падает на стопку, 7 — печатается квитанция, 8 — на странице клиента
 * набирается код, 9 — столбики растут, 10 — из папки поднимается лист, 11 — переключатели прав: один
 * включается, второй не поддаётся, 12 — шапочка выпускника подлетает. `bg` — заливка цветом подложки
 * (закрывает то, что позади), `dot` — сплошная точка.
 */
const FEATURE_PARTS: readonly ReactNode[] = [
  <>
    <rect className="f1-c bg" x="9.5" y="2.5" width="11" height="14" rx="2" />
    <rect className="f1-b bg" x="6.5" y="5" width="11" height="14" rx="2" />
    <g className="f1-a">
      <rect className="bg" x="3.5" y="7.5" width="11" height="14" rx="2" />
      <path d="M6.5 12h5M6.5 15h5M6.5 18h3" />
    </g>
  </>,
  <>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17" />
    <path className="f2-r" d="M8 3v4M16 3v4" />
    <path className="f2-g" d="M7.5 13.6h.01M12 13.6h.01M16.5 13.6h.01M7.5 17.1h.01M12 17.1h.01" />
    <rect className="f2-d dot" x="14.6" y="15.2" width="3.8" height="3.8" rx="1.1" />
  </>,
  <>
    <path d="M3.5 6h10M3.5 11h5M3.5 16h6" />
    <g className="f3-m">
      <circle className="bg" cx="15" cy="13.5" r="4.3" />
      <path d="M18.1 16.6l3.1 3.1" />
      <path className="f3-k" pathLength={1} d="M13.2 13.6l1.3 1.3 2.3-2.6" />
    </g>
  </>,
  <>
    <path className="f4-t" d="M3 21l3.5-3.5M3.5 15.5l2-2M8.5 20.5l2-2" />
    <g className="f4-p">
      <path d="M21 3L3.5 9.6l6.9 3.6 3.6 6.9Z" />
      <path d="M21 3L10.4 13.2" />
    </g>
  </>,
  <>
    <rect className="f5-x" x="3.5" y="3.5" width="7" height="7" rx="2" />
    <path className="f5-a" pathLength={1} d="M5.4 7.1l1.3 1.3 2.3-2.6" />
    <path d="M13.5 7h7" />
    <rect className="f5-y" x="3.5" y="13.5" width="7" height="7" rx="2" />
    <path className="f5-b" pathLength={1} d="M5.4 17.1l1.3 1.3 2.3-2.6" />
    <path d="M13.5 17h5" />
  </>,
  <>
    <path d="M3.5 18.2v-3.4M16.5 18.2v-3.4" />
    <ellipse cx="10" cy="18.2" rx="6.5" ry="2.4" />
    <ellipse className="bg" cx="10" cy="14.8" rx="6.5" ry="2.4" />
    <g className="f6-c">
      <path d="M3.5 14.8v-3.4M16.5 14.8v-3.4" />
      <ellipse className="bg" cx="10" cy="11.4" rx="6.5" ry="2.4" />
    </g>
    <path className="f6-s" d="M19.2 3.2v4.2M17.1 5.3h4.2" />
  </>,
  <>
    <svg x="0" y="5.5" width="24" height="18.5" viewBox="0 5.5 24 18.5">
      <g className="f7-r">
        <path className="bg" d="M7 3v16.6l1.7-1.3 1.6 1.3 1.7-1.3 1.7 1.3 1.6-1.3 1.7 1.3V3" />
        <path d="M9.8 9.6h4.4M9.8 12.6h4.4M9.8 15.4h2.6" />
      </g>
    </svg>
    <path className="f7-s" d="M3.5 5.5h17" />
  </>,
  <>
    <g className="f8-w">
      <rect x="3" y="4.5" width="18" height="15.5" rx="2.5" />
      <path d="M3 9h18" />
      <path d="M6 6.8h.01M8.6 6.8h.01" />
    </g>
    {[7.5, 10.5, 13.5, 16.5].map((cx, i) => (
      <circle key={cx} className="f8-d dot" style={turn(i)} cx={cx} cy="14.5" r="1.3" />
    ))}
  </>,
  <>
    <path d="M3.5 3.5v17h17" />
    <path className="f9-b" style={turn(0)} d="M8 17.5v-3" />
    <path className="f9-b" style={turn(1)} d="M12.5 17.5v-6" />
    <path className="f9-b" style={turn(2)} d="M17 17.5v-9.5" />
  </>,
  <>
    <path d="M3.5 18.5V6A1.5 1.5 0 0 1 5 4.5h4l2 2.5h8A1.5 1.5 0 0 1 20.5 8.5V12" />
    <g className="f10-s">
      <rect className="bg" x="7.8" y="8.6" width="8.4" height="9" rx="1.2" />
      <path d="M10 11.2h4" />
    </g>
    <path
      className="f10-f bg"
      d="M3.5 13h17l-.9 5.8a1.5 1.5 0 0 1-1.5 1.2H5.9a1.5 1.5 0 0 1-1.5-1.2Z"
    />
  </>,
  <>
    <rect x="3" y="4" width="12" height="6.5" rx="3.25" />
    <circle className="f11-a dot" cx="11.75" cy="7.25" r="1.9" />
    <path d="M18 7.25h3" />
    <rect x="3" y="13.5" width="12" height="6.5" rx="3.25" />
    <circle className="f11-b dot" cx="6.25" cy="16.75" r="1.9" />
    <path d="M18 16.75h3" />
  </>,
  <g className="f12-c">
    <path d="M6.5 11.6v4.4c1.6 1.4 3.4 2.1 5.5 2.1s3.9-.7 5.5-2.1v-4.4" />
    <path className="bg" d="M2.5 9.5L12 5l9.5 4.5L12 14Z" />
    <path className="f12-t" d="M21.5 9.5v5.5" />
  </g>,
];

/** Сколько функций в блоке «Возможности» — у каждой свой значок. */
export const FEATURE_COUNT = FEATURE_PARTS.length;

/** Значок функции блока «Возможности»: `n` — номер функции с единицы. */
export function FeatureIcon({ n }: { n: number }) {
  return (
    <svg className={`lp-fi f${n}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {FEATURE_PARTS[n - 1]}
    </svg>
  );
}
