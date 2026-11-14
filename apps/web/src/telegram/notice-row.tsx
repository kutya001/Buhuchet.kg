'use client';

import { Hint, Icon, Pill, pillClass, SWITCH_CLASS, type IconName } from '@buhuchet/ui';
import type { ReactNode } from 'react';
import { useT } from '../l10n/provider';

/** «Выключено» (`.pill.sm.faint` прототипа): бледная метка с рамкой и кружком. */
const OFF_PILL = `${pillClass('sm')} bg-faint-pill-bg text-label shadow-[inset_0_0_0_1px_var(--bu-border)]`;

/** Кому уходит сообщение: метка строки (прототип `TGN_TO`). */
const TO = {
  staff: { tone: 'info', icon: 'users' },
  cp: { tone: 'violet', icon: 'user' },
  group: { tone: 'ok', icon: 'chat' },
} as const;

export interface NoticeRowProps {
  /** Код строки: `data-tgn`, по нему же — переключатель `data-tgn-sw`. */
  id: string;
  title: string;
  to: keyof typeof TO;
  /** Значок строки без переключателя. */
  icon?: IconName;
  /**
   * Включено ли сообщение. Нет — строка без переключателя: сообщение работает всегда (напоминания о
   * сроках, недельная сводка).
   */
  on?: boolean;
  /** Переключатель только для просмотра; `why` — почему (подсказка). */
  disabled?: boolean;
  why?: string;
  onToggle?: (on: boolean) => void;
  hint?: ReactNode;
  /** «Дни», «Время, Бишкек», «Как часто» — с большой буквы. */
  days: string;
  at: string;
  often: string;
  /** Настройки строки под ней (поля, кнопки, пояснения). */
  children?: ReactNode;
}

const upperFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');

/**
 * Строка блока «Telegram-уведомления» (пакет 14.11.2026, блок 3; прототип v111 `tgnRow`, стили
 * `.tgn-*`): переключатель или значок, название, кому (метка), «Выключено»; пояснение; дни, время по
 * Бишкеку и как часто; ниже — настройки строки. Ею же поток К строит строки «К оплате» и «Оплата за
 * обслуживание». На телефоне сведения и настройки — без отступа слева.
 */
export function NoticeRow({
  id,
  title,
  to,
  icon = 'bell',
  on,
  disabled = false,
  why,
  onToggle,
  hint,
  days,
  at,
  often,
  children,
  ...data
}: NoticeRowProps & { [attr: `data-${string}`]: string | undefined }) {
  const t = useT();
  const mark = TO[to];
  const facts = [
    ['days', t('tgn.k.days'), days],
    ['at', t('tgn.k.at'), at],
    ['often', t('tgn.k.often'), often],
  ] as const;
  return (
    <div
      data-tgn={id}
      className="grid gap-2 border-b border-line py-3 first:pt-1 last:border-b-0 last:pb-0"
      {...data}
    >
      <div className="flex items-start gap-2.5">
        {on === undefined ? (
          <span
            aria-hidden="true"
            className="inline-flex w-9 flex-none justify-center pt-px text-faint"
          >
            <Icon name={icon} />
          </span>
        ) : (
          <input
            type="checkbox"
            role="switch"
            data-tgn-sw={id}
            className={`${SWITCH_CLASS} mt-px`}
            checked={on}
            disabled={disabled}
            aria-label={title}
            title={why}
            onChange={(e) => onToggle?.(e.target.checked)}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <b className="mr-0.5 font-semibold">{title}</b>
            <Pill size="sm" tone={mark.tone} icon={mark.icon}>
              {t(`tgn.to.${to}`)}
            </Pill>
            {on === false ? (
              <span data-pill="" className={OFF_PILL}>
                <Icon name="circle" size="sm" />
                {t('tgn.state_off')}
              </span>
            ) : null}
          </div>
          {hint ? <Hint>{hint}</Hint> : null}
        </div>
      </div>
      <dl
        className={`m-0 ml-[46px] grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-[18px] gap-y-1.5 max-md:ml-0${on === false ? ' opacity-60' : ''}`}
      >
        {facts.map(([key, label, value]) => (
          <div key={key} data-tgn-kv={key} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-[11.5px] font-semibold text-faint">{label}</dt>
            <dd className="m-0 text-[13px] [overflow-wrap:anywhere]">{upperFirst(value)}</dd>
          </div>
        ))}
      </dl>
      {children ? (
        <div className="ml-[46px] flex flex-wrap items-center gap-x-4 gap-y-2 max-md:ml-0">
          {children}
        </div>
      ) : null}
    </div>
  );
}
