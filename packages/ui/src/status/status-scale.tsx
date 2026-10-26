import type { StatusTone } from '@buhuchet/domain';
import type { ReactNode } from 'react';
import { buttonClass } from '../button';
import { pillClass } from '../form';
import { Icon } from '../icon';
import type { IconName } from '../icons';
import { STATUS_TONE } from './tones';

/**
 * Шкала статусов (ТЗ «Общие элементы интерфейса» → «Шкала статусов», «Статусы на телефоне»; прототип
 * ui/status-scale.js: `scaleFull`, `scaleMini`, стили `.scf`, `.scm` в css/grid.css). Компонент только
 * рисует: шаги, текущий, даты, следующий и шаг для отката приходят пропсами — их считают правила
 * `@buhuchet/domain` (`scalePosition`, `scaleNext`, `scaleBack`) и модуль (право, условия шага).
 */

export interface StatusStep {
  code: string;
  label: string;
  /** Когда шаг поставлен в последний раз — «ДД.ММ.ГГГГ ЧЧ:ММ» по Бишкеку; пусто — не был. */
  at?: string | null | undefined;
}

export interface StatusScaleLabels {
  /** Подсказка следующего шага: «Перевести в «Сдан»». */
  moveTo: (name: string) => string;
  /** Подсказка шага для отката: «Откатить в «В работе»». */
  rollbackTo: (name: string) => string;
  /** Подпись «откатить» под шагом для отката. */
  rollbackMark: string;
  /** Боковой статус: «на шаге 3 «Сдан»». */
  sideOnStep: (n: number, name: string) => string;
}

export interface StatusScaleProps {
  /** Название шкалы над шагами: «Сдача», «Оплата». */
  title: string;
  steps: readonly StatusStep[];
  /** Номер текущего шага с 0. */
  index: number;
  /** Цвет текущего статуса (у отметки — её цвет). */
  tone: StatusTone;
  /** Боковой статус на текущем шаге («Требует исправления», «Отменена»). */
  side?: { label: string; tone: 'red' | 'faint'; at?: string | null | undefined } | null;
  /** Отметка на текущем шаге («Ждёт подтверждения», «Подтверждено»). */
  mark?: { label: string; tone: StatusTone; icon: IconName } | null;
  /** Коды шагов, в которые можно перевести нажатием. */
  next?: readonly string[];
  /** Следующие шаги, которые пока нельзя поставить: код → почему (подсказка, нажатие не работает). */
  blocked?: Readonly<Record<string, string>>;
  /** Шаг для отката (только при праве «Откат статусов»): пройденный или текущий с боковым статусом. */
  back?: string | null;
  /** Строки под шкалой: почему откат или шаг недоступен. */
  hints?: readonly ReactNode[];
  onStep?: (code: string) => void;
  onBack?: (code: string) => void;
  labels: StatusScaleLabels;
}

// Цвета шага и кружка — только в ветках состояния: у одного свойства не два класса (иначе побеждает
// порядок правил в CSS, а не порядок в разметке).
const STEP =
  'inline-flex flex-none items-center gap-[7px] rounded-full border py-[5px] pr-[9px] pl-[5px] text-[13px] max-md:min-h-10 max-md:w-full max-md:gap-2.5 max-md:rounded-lg max-md:py-1.5 max-md:pr-2.5 max-md:pl-1.5';
const NUMBER =
  'inline-grid h-6 w-6 flex-none place-items-center rounded-full border-[1.5px] text-[12px] font-bold tabular-nums';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';
const LABEL =
  'flex flex-col items-start text-left leading-[1.15] max-md:min-w-0 max-md:flex-auto max-md:flex-row max-md:flex-wrap max-md:items-baseline max-md:gap-x-2 max-md:gap-y-0.5 max-md:leading-[1.25]';
const NOTE = 'mt-0.5 text-[11px] not-italic max-md:mt-0 max-md:basis-full';
const HINT = 'text-[11.5px] leading-[1.4] text-faint';

/** Название шкалы (`.scf-t`). */
function ScaleTitle({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] font-bold tracking-[.06em] text-muted uppercase">{children}</span>
  );
}

/**
 * Полная шкала в карточке записи: пронумерованные шаги, пройденные — с галочкой, текущий — цветом
 * статуса, следующий — пунктирной рамкой, шаг для отката — оранжевой пунктирной рамкой с «откатить»;
 * под шагом — дата и время, когда он поставлен. На ПК — в строку, на телефоне — столбиком во всю
 * ширину, дата справа. Свайп по вкладкам на шкале не начинается.
 */
export function StatusScale({
  title,
  steps,
  index,
  tone,
  side = null,
  mark = null,
  next = [],
  blocked = {},
  back = null,
  hints = [],
  onStep,
  onBack,
  labels,
}: StatusScaleProps) {
  const current = STATUS_TONE[side ? side.tone : tone];
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <ScaleTitle>{title}</ScaleTitle>
      <ol
        aria-label={title}
        data-no-swipe=""
        data-status-scale=""
        className="m-0 flex list-none items-center overflow-x-auto p-0.5 [scrollbar-width:none] max-md:flex-col max-md:items-stretch max-md:overflow-visible max-md:p-0"
      >
        {steps.map((step, j) => {
          const passed = j < index;
          const isCurrent = j === index;
          const why = blocked[step.code];
          const go = next.includes(step.code) && !why;
          const rollback = !go && back === step.code && (passed || (isCurrent && !!side));
          const at = isCurrent && side ? side.at : j <= index ? step.at : null;
          // Следующий шаг поверх пройденного (обслуживание «В архиве» → «Обслуживается»): как `.go`.
          const text = go || isCurrent ? 'text-ink' : passed ? 'text-muted' : 'text-faint';
          const border = go
            ? 'border-dashed border-line-strong'
            : rollback
              ? 'border-dashed border-caution/45'
              : isCurrent
                ? current.stepBorder
                : 'border-transparent';
          const action = go
            ? `cursor-pointer hover:bg-row-hover ${FOCUS}`
            : rollback
              ? `cursor-pointer hover:bg-caution-bg ${FOCUS}`
              : 'cursor-default';
          const look = `${text} ${border} ${isCurrent ? `font-[650] ${current.stepBg}` : 'bg-transparent'} ${action}`;
          const number = isCurrent
            ? `${current.number} text-on-accent`
            : go
              ? `border-accent text-accent ${passed ? 'bg-pane-alt' : 'bg-pane'}`
              : passed
                ? 'border-line-strong bg-pane-alt text-muted'
                : 'border-line-strong bg-pane';
          return (
            <li
              key={step.code}
              className="flex flex-none items-center max-md:flex-col max-md:items-stretch"
            >
              <button
                type="button"
                className={`${STEP} ${look}`}
                aria-current={isCurrent ? 'step' : undefined}
                {...(go
                  ? { title: labels.moveTo(step.label), onClick: () => onStep?.(step.code) }
                  : rollback
                    ? { title: labels.rollbackTo(step.label), onClick: () => onBack?.(step.code) }
                    : { tabIndex: -1, 'aria-disabled': true, title: why })}
              >
                <span className={`${NUMBER} ${number}`}>
                  {passed ? (
                    <Icon name="check" size="sm" />
                  ) : isCurrent && side ? (
                    <Icon name={side.tone === 'red' ? 'x' : 'ban'} size="sm" />
                  ) : (
                    j + 1
                  )}
                </span>
                <span className={LABEL}>
                  {isCurrent && side ? (
                    <>
                      {side.label}
                      <em className={`${NOTE} font-medium text-muted`}>
                        {labels.sideOnStep(j + 1, step.label)}
                      </em>
                    </>
                  ) : (
                    step.label
                  )}
                  {at ? (
                    <small className="mt-px text-[10.5px] font-medium text-faint tabular-nums max-md:mt-0 max-md:ml-auto max-md:text-[11px]">
                      {at}
                    </small>
                  ) : null}
                  {mark && isCurrent && !side ? (
                    <em
                      className={`${NOTE} inline-flex items-center gap-[3px] font-semibold ${STATUS_TONE[mark.tone].text}`}
                    >
                      <Icon name={mark.icon} size="sm" />
                      {mark.label}
                    </em>
                  ) : null}
                  {rollback ? (
                    <small className="mt-px inline-flex items-center gap-[3px] text-[10.5px] font-semibold text-caution-label max-md:mt-0 max-md:basis-full">
                      <Icon name="history" size="sm" />
                      {labels.rollbackMark}
                    </small>
                  ) : null}
                </span>
              </button>
              {j < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={`h-0.5 flex-[0_0_18px] rounded-sm max-md:ml-[17px] max-md:h-2 max-md:w-0.5 max-md:flex-none ${passed ? 'bg-line-strong' : 'bg-line'}`}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
      {hints.map((hint, i) => (
        <span key={i} className={HINT}>
          {hint}
        </span>
      ))}
    </div>
  );
}

/**
 * Статус без шкалы («Не требуется»): серая надпись вместо шкалы, с какого времени, и «Снять «…»» —
 * откат, если есть право (прототип `scaleFull` для `none`).
 */
export function StatusNone({
  title,
  text,
  since,
  undo,
}: {
  title: string;
  /** «Не требуется — шкала не ведётся». */
  text: string;
  /** «с 12.10.2026 10:00». */
  since?: string | null | undefined;
  undo?: { label: string; onClick: () => void } | null | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <ScaleTitle>{title}</ScaleTitle>
      <div
        data-status-scale=""
        className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted"
      >
        <Icon name="ban" size="sm" />
        <span>
          {text}
          {since ? <small className="ml-1 text-[11px] text-faint">{since}</small> : null}
        </span>
        {undo ? (
          <button
            type="button"
            className={`${buttonClass('default', 'sm')} ml-2.5`}
            onClick={undo.onClick}
          >
            <Icon name="history" size="sm" />
            {undo.label}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Шкалы записи (`.scales`): на ПК — рядом, на телефоне — одна под другой во всю ширину. */
export function StatusScales({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-7 gap-y-3 max-md:flex-col max-md:flex-nowrap max-md:gap-3.5 max-md:[&>*]:w-full">
      {children}
    </div>
  );
}

/** Метка статуса (`pill(статус, справочник)`): значок и название цветом статуса. */
export function StatusPill({
  label,
  tone,
  icon,
  size = 'md',
}: {
  label: string;
  tone: StatusTone;
  icon: IconName;
  size?: 'md' | 'sm';
}) {
  return (
    <span data-pill="" className={`${pillClass(size)} ${STATUS_TONE[tone].pill}`}>
      <Icon name={icon} size="sm" />
      {label}
    </span>
  );
}

export interface StatusMiniProps {
  /** Сколько шагов в шкале и номер текущего с 0. */
  count: number;
  index: number;
  tone: StatusTone;
  /** Название статуса. */
  label: string;
  /** Боковой статус: текущая точка красная. */
  side?: boolean;
  /** Подсказка: «Этап 2 из 3: В работе». */
  title: string;
  /** Когда установлен — мелко под статусом. */
  at?: string | null | undefined;
  /** Подсказка к времени: «Установлен 12.10.2026 10:00, Тилекова А.». */
  atTitle?: string | undefined;
  /** Отметка на шаге — значок после названия. */
  mark?: { label: string; icon: IconName; tone: StatusTone } | null;
}

/**
 * Компактная шкала для списков и плиток (прототип `scaleMini`): точки шагов, «2/3» цветом статуса и
 * название; под ним — дата и время установки.
 */
export function StatusMini({
  count,
  index,
  tone,
  label,
  side = false,
  title,
  at,
  atTitle,
  mark = null,
}: StatusMiniProps) {
  const t = STATUS_TONE[mark ? mark.tone : tone];
  const mini = (
    <span
      title={title}
      data-status-mini=""
      className="inline-flex max-w-full items-center gap-1.5 text-[12.5px] font-semibold whitespace-nowrap text-ink"
    >
      <span aria-hidden="true" className="inline-flex flex-none gap-[3px]">
        {Array.from({ length: count }, (_, j) => (
          <i
            key={j}
            className={`box-border h-2 w-2 rounded-full border-[1.5px] ${
              j < index
                ? `${t.dot} opacity-45`
                : j === index
                  ? `${side ? 'border-danger bg-danger' : t.dot} ring-2 ${t.ring}`
                  : 'border-line-strong'
            }`}
          />
        ))}
      </span>
      <b className={`font-bold tabular-nums ${t.text}`}>
        {index + 1}/{count}
      </b>
      <span className="min-w-0 truncate">{label}</span>
      {mark ? (
        <span role="img" aria-label={mark.label} className={`inline-flex ${t.text}`}>
          <Icon name={mark.icon} size="sm" />
        </span>
      ) : null}
    </span>
  );
  if (!at) return mini;
  return (
    <span
      title={atTitle}
      className="inline-flex max-w-full flex-col gap-px align-middle leading-[1.2]"
    >
      {mini}
      <small className="pl-px text-[10.5px] text-faint tabular-nums">{at}</small>
    </span>
  );
}

/** Компактный статус без шкалы («Не требуется»): значок и название серым. */
export function StatusMiniNone({ label, title }: { label: string; title: string }) {
  return (
    <span
      title={title}
      data-status-mini=""
      className="inline-flex items-center gap-1 text-[12.5px] font-medium text-muted"
    >
      <Icon name="ban" size="sm" />
      {label}
    </span>
  );
}
