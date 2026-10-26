/**
 * Классы кнопок прототипа (spec/prototype/src/css/controls.css): `.btn`, `.btn.cta` — основная
 * (светлый текст на тёмно-коричневой кнопке, контраст не ниже 4,5 : 1 в обеих темах, решение
 * заказчика 19.10.2026), `.btn.danger` — опасное действие (красная, с подтверждением), `.btn.ok` —
 * «Выполнено», «Подтвердить» (зелёная, светлый текст не ниже 4,5 : 1 в обеих темах), `.btn.ghost`,
 * `.btn.sm`, `.icon-btn`, `.linkbtn`. Подпись и значок — цветом текста кнопки, не приглушаются.
 */
const BUTTON_BASE =
  'inline-flex cursor-pointer items-center gap-[7px] rounded-lg border-0 leading-[1.2] font-[550] whitespace-nowrap no-underline transition-[background-color,box-shadow,color] duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none';

const BUTTON_VARIANTS = {
  default:
    'bg-btn text-ink shadow-btn hover:bg-btn-hover hover:shadow-btn-hover active:shadow-btn-active',
  cta: 'bg-accent text-on-accent shadow-cta hover:bg-accent-hover active:shadow-btn-active',
  danger: 'bg-danger-btn text-on-accent shadow-cta',
  ok: 'bg-ok-btn text-on-accent shadow-cta',
  ghost: 'bg-transparent text-muted hover:bg-row-hover hover:text-ink',
} as const;

const BUTTON_SIZES = {
  md: 'min-h-[33px] px-[13px] py-1.5 text-[13px]',
  sm: 'min-h-[29px] px-2.5 py-1 text-[12.5px]',
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

/** Кнопка-значок без подписи (`.icon-btn`): подпись — в aria-label и подсказке. */
export function iconButtonClass(size: 'md' | 'sm' = 'md'): string {
  const box = size === 'sm' ? 'h-[27px] w-[27px]' : 'h-[33px] w-[33px]';
  return `inline-grid flex-none cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted hover:bg-row-hover hover:text-ink ${box}`;
}

/** Кнопка-ссылка (`.linkbtn`): «Сбросить фильтры» и другие действия внутри текста. */
export function linkButtonClass(): string {
  return 'cursor-pointer border-0 bg-transparent p-0 font-[550] text-link underline decoration-1 underline-offset-[3px]';
}
