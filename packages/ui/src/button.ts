/**
 * Классы кнопок прототипа (spec/prototype/src/css/controls.css): `.btn`, `.btn.cta` — основная
 * (светлый текст на тёмно-коричневой кнопке, контраст не ниже 4,5 : 1 в обеих темах, решение
 * заказчика 19.10.2026), `.btn.danger` — опасное действие (красная, с подтверждением), `.btn.ok` —
 * «Выполнено», «Подтвердить» (зелёная, светлый текст не ниже 4,5 : 1 в обеих темах), `.btn.ghost`,
 * `.btn.sm`, `.icon-btn`, `.linkbtn`. Подпись и значок — цветом текста кнопки, не приглушаются.
 * Кнопки плоские (прототип v138): тонкая рамка вместо объёмной тени, объём — только у основной, красной
 * и зелёной. Нажатая кнопка чуть сжимается (прототип v131: `scale(.98)` за 100 мс).
 */
const BUTTON_BASE =
  'inline-flex cursor-pointer items-center gap-[7px] rounded-lg border-0 leading-[1.2] font-[550] whitespace-nowrap no-underline transition-[background-color,box-shadow,color,scale] duration-100 enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-flat';

const BUTTON_VARIANTS = {
  default:
    'bg-btn text-ink shadow-flat hover:bg-btn-hover hover:shadow-flat-strong active:bg-row-hover active:shadow-flat-strong',
  cta: 'bg-accent text-on-accent shadow-cta hover:bg-accent-hover active:shadow-btn-active',
  danger: 'bg-danger-btn text-on-accent shadow-cta',
  ok: 'bg-ok-btn text-on-accent shadow-cta',
  ghost: 'bg-transparent text-muted hover:bg-row-hover hover:text-ink',
  /** Возврат «На исправление», «На доработку» (прототип v134 `.btn.danger-o`): обычная, текст красным. */
  dangerOutline:
    'bg-btn text-danger shadow-flat hover:bg-btn-hover hover:shadow-flat-strong active:bg-row-hover active:shadow-flat-strong',
} as const;

/** На телефоне всё нажимаемое не ниже 44 px (прототип v131, css/mobile.css; решение заказчика 17.11.2026). */
const BUTTON_SIZES = {
  md: 'min-h-[33px] px-[13px] py-1.5 text-[13px] max-md:min-h-11',
  sm: 'min-h-[29px] px-2.5 py-1 text-[12.5px] max-md:min-h-11',
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANTS;

export function buttonClass(
  variant: ButtonVariant = 'default',
  size: keyof typeof BUTTON_SIZES = 'md',
): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`;
}

/**
 * На телефоне область касания маленькой кнопки — не меньше 44 × 44 px, а вид прежний, как в прототипе
 * (ТЗ «Принципы оформления» → «Плотность»): невидимый слой поверх кнопки и вокруг неё. Кнопка
 * становится `relative` — не для кнопок с `absolute` или `fixed`.
 */
// ОТКЛОНЕНИЕ: docs/deviations.md#35
export const TOUCH_AREA =
  "relative max-md:before:absolute max-md:before:top-1/2 max-md:before:left-1/2 max-md:before:h-[max(100%,44px)] max-md:before:w-[max(100%,44px)] max-md:before:-translate-1/2 max-md:before:content-['']";

/**
 * Кнопка-значок без подписи (`.icon-btn`): подпись — в aria-label и подсказке. На телефоне — 44 px,
 * маленькая — 40 px (прототип v131).
 */
export function iconButtonClass(size: 'md' | 'sm' = 'md'): string {
  const box =
    size === 'sm'
      ? 'h-[27px] w-[27px] max-md:h-10 max-md:w-10'
      : 'h-[33px] w-[33px] max-md:h-11 max-md:w-11';
  return `inline-grid flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted transition-[background-color,color] duration-100 hover:bg-row-hover hover:text-ink ${box}`;
}

/** Кнопка-ссылка (`.linkbtn`): «Сбросить фильтры» и другие действия внутри текста. */
export function linkButtonClass(): string {
  return 'cursor-pointer border-0 bg-transparent p-0 font-[550] text-link underline decoration-1 underline-offset-[3px]';
}
