'use client';

import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../icon';
import type { IconName } from '../icons';

/**
 * Раскрытые строки состояния: помнятся до перезагрузки страницы (прототип `STL_OPEN`). Не больше
 * `OPENED_MAX` последних — за длинный день без перезагрузки список не растёт без предела.
 */
const OPENED = new Set<string>();
const OPENED_MAX = 200;

function remember(id: string) {
  OPENED.delete(id);
  OPENED.add(id);
  for (const old of OPENED) {
    if (OPENED.size <= OPENED_MAX) break;
    OPENED.delete(old);
  }
}

/**
 * Строка состояния карточки (решение заказчика 17.11.2026, «Меньше текста, понятнее, плавнее», ТЗ п. 8;
 * прототип v134 `stLine`): сразу под шапкой — коротко шкала, срок и ответственный; полная шкала с датами
 * и откатом раскрывается по нажатию на короткую. Без `full` короткая шкала не нажимается.
 */
export function StatusLine({
  id,
  minis,
  parts,
  full,
  label,
}: {
  /** Ключ записи («r<id>», «t<id>»): раскрытое помнится по нему. */
  id: string;
  minis: ReactNode;
  parts: ReactNode[];
  full?: ReactNode;
  /** Подпись кнопки шкалы («Шкала статусов»). */
  label: string;
}) {
  const [open, setOpen] = useState(() => OPENED.has(id));
  const panel = useId();
  const toggle = () => {
    const next = !open;
    if (next) remember(id);
    else OPENED.delete(id);
    setOpen(next);
  };
  const pill =
    'inline-flex min-h-8 flex-wrap items-center gap-3 rounded-full border border-line py-1 pr-2 pl-3 max-md:min-h-10';
  return (
    <>
      <div
        data-status-line=""
        className="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-b border-line pb-3 text-[13.5px] max-md:gap-x-3.5"
      >
        {full ? (
          <button
            type="button"
            data-status-line-scale=""
            title={label}
            aria-label={label}
            aria-expanded={open}
            aria-controls={panel}
            onClick={toggle}
            className={`${pill} cursor-pointer text-ink transition-colors duration-100 hover:border-line-strong hover:bg-hover`}
          >
            {minis}
            <span
              aria-hidden="true"
              className={`inline-flex text-muted transition-transform duration-180 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
            >
              <Icon name="down" size="sm" />
            </span>
          </button>
        ) : (
          <span className={pill}>{minis}</span>
        )}
        {parts.filter(Boolean).map((p, i) => (
          <span
            key={i}
            data-status-line-part=""
            className="inline-flex flex-wrap items-center gap-1.5 [&>svg]:text-muted"
          >
            {p}
          </span>
        ))}
      </div>
      {full ? (
        <div
          id={panel}
          hidden={!open}
          data-status-line-full=""
          className="-mt-0.5 animate-slide-up motion-reduce:animate-none"
        >
          {full}
        </div>
      ) : null}
    </>
  );
}

/**
 * Срок в строке состояния (прототип `dueBit`): «до 20.11», «просрочен на N дн.» красным или
 * «осталось N дн.» / «сегодня» в ближайшие две недели; `note` — мелко серым.
 */
export function DueBit({
  icon = 'calendar',
  text,
  late,
  left,
  note,
}: {
  icon?: IconName;
  /** «до 20.11.2026». */
  text: string;
  /** «просрочен на 3 дн.» — когда срок прошёл. */
  late?: string | null;
  /** «осталось 5 дн.» или «сегодня». */
  left?: string | null;
  note?: string | null;
}) {
  return (
    <>
      <Icon name={icon} size="sm" />
      <span>{text}</span>
      {late ? (
        <b className="text-danger">{late}</b>
      ) : left ? (
        <span className="text-faint">{left}</span>
      ) : null}
      {note ? <small className="text-[12px] text-faint">{note}</small> : null}
    </>
  );
}
