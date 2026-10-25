/**
 * Деньги платформы — только сомы (KGS). Внутри — целые тыйыны (1 сом = 100 тыйын),
 * на экране — «1 250,50» (разделитель тысяч — неразрывный пробел, минус — «−»), как в прототипе (fmtM).
 */

/** Сумма в тыйынах: целое число. */
export type Tyiyn = number;

const NBSP = '\u00a0';
const MINUS = '−';

export function assertTyiyn(value: number): asserts value is Tyiyn {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Сумма должна быть целым числом тыйынов, получено: ${value}`);
  }
}

/** Сомы (число, допускаются копейки) → тыйыны с округлением до ближайшего тыйына. */
export function somToTyiyn(som: number): Tyiyn {
  if (!Number.isFinite(som)) {
    throw new RangeError(`Сумма в сомах должна быть числом, получено: ${som}`);
  }
  const tyiyn = Math.round(som * 100);
  assertTyiyn(tyiyn);
  return tyiyn;
}

/**
 * Формат «1 250,50». `fraction: 'always'` — всегда два знака после запятой (как fmtM(n) прототипа),
 * `'auto'` — без «,00» для целых сомов (как som() прототипа без слова «сом»).
 */
export function formatSom(tyiyn: Tyiyn, fraction: 'always' | 'auto' = 'always'): string {
  assertTyiyn(tyiyn);
  const negative = tyiyn < 0;
  const abs = Math.abs(tyiyn);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const showFraction = fraction === 'always' || cents !== 0;
  const tail = showFraction ? ',' + String(cents).padStart(2, '0') : '';
  return (negative ? MINUS : '') + grouped + tail;
}

/** «1 250,50 сом» / «1 250 сом»; перед «сом» неразрывный пробел, как в som() прототипа. */
export function formatSomWithUnit(tyiyn: Tyiyn): string {
  return `${formatSom(tyiyn, 'auto')}${NBSP}сом`;
}

/**
 * Разбор суммы, введённой человеком: «1 250,50», «1250.5», «−300», «1 250». Пустая строка и мусор — null.
 * Больше двух знаков после запятой — null (тыйынов меньше одного не бывает).
 */
export function parseSom(input: string): Tyiyn | null {
  const text = input
    .replace(/[\s\u00a0]/g, '')
    .replace(MINUS, '-')
    .replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith('-');
  const [whole = '0', frac = ''] = text.replace('-', '').split('.');
  const tyiyn = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(tyiyn)) return null;
  return negative ? -tyiyn : tyiyn;
}

/** Сумма списка тыйынов без потери точности. */
export function sumTyiyn(values: readonly Tyiyn[]): Tyiyn {
  let total = 0;
  for (const v of values) {
    assertTyiyn(v);
    total += v;
  }
  assertTyiyn(total);
  return total;
}
