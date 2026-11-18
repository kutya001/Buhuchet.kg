'use client';

import { isDigestTime, pluralForm, weekDayOf } from '@buhuchet/domain';
import type { OrgPolicy, UpdateOrgPolicyRequest } from '@buhuchet/shared';
import { Box, CheckRow, Field, Hint, Icon, inputClass, linkButtonClass, Note } from '@buhuchet/ui';
import Link from 'next/link';
import { useId, useState } from 'react';
import { ContractorNoticeRows } from '../contractor-page/notice-rows';
import { useT } from '../l10n/provider';
import { tabHref } from '../shell/modules';
import { TelegramGroupRow } from './group-box';
import { NoticeRow } from './notice-row';

/** Правка учётной политики из блока: сохраняется сразу; `done` — текст уведомления после сохранения. */
export type NoticeSave = (
  patch: Omit<UpdateOrgPolicyRequest, 'version'>,
  done: string,
) => Promise<void>;

const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Блок «Telegram-уведомления» в «Моя организация» → «Настройки» (пакет 14.11.2026, блок 3; прототип v111
 * modules/tg-notify.js — `tgnHtml`, `tgnMount`): все сообщения, которые бот присылает сам, одним списком —
 * что за сообщение, кому, включено ли, в какие дни, во сколько по Бишкеку и как часто. Сюда переехали со
 * старых мест «Повторять при просрочке каждый день», время сводки (теперь «Час напоминаний»), «Действия
 * из Telegram», «Общий чат фирмы» и «Telegram контрагентов» — работают как раньше. Новое — день
 * недельной сводки. Всё сохраняется сразу, без «Сохранить настройки»; меняет только владелец (право
 * «Настройки и учётная политика»), сервер проверяет сам. Выключены «Напоминания в Telegram» — только
 * пояснение.
 */
export function TelegramNoticesBox({
  policy,
  own,
  busy,
  save,
}: {
  policy: OrgPolicy;
  own: boolean;
  busy: boolean;
  save: NoticeSave;
}) {
  const t = useT();
  const id = useId();
  const [hour, setHour] = useState(policy.digestTime);
  const [hourError, setHourError] = useState<string | undefined>();
  const off = !own || busy;
  const weekDay = weekDayOf(policy.weekDay);

  if (!policy.features.telegram) {
    return (
      <div data-tgn-box="">
        <Box title={t('tgn.title')}>
          <Note icon="info">{t('tgn.off')}</Note>
        </Box>
      </div>
    );
  }

  const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const days = policy.remindDays;
  const remindDays = days.length
    ? t('tgn.remind.days', {
        list: days.join(', '),
        word: t(`tgn.remind.day.${pluralForm(days[days.length - 1]!)}`),
      })
    : t('tgn.remind.days_today');

  // «Час напоминаний» сохраняется, когда поле оставили (или Enter). Пустое время не сохраняется молча:
  // ошибка под полем, прежнее значение остаётся (прототип `#tgn-at`).
  // ОТКЛОНЕНИЕ: docs/deviations.md#Т-16
  const commitHour = () => {
    if (!own) return;
    if (!isDigestTime(hour)) {
      setHourError(t('tgn.hour_required'));
      setHour(policy.digestTime);
      return;
    }
    if (hour === policy.digestTime) return;
    void save({ digestTime: hour }, t('tgn.hour_saved', { time: hour }));
  };

  return (
    <div data-tgn-box="">
      <Box title={t('tgn.title')}>
        <Hint>
          {t('tgn.intro')} {t(own ? 'tgn.intro_owner' : 'tgn.owner_only')}
        </Hint>
        <NoticeRow
          id="remind"
          title={t('tgn.remind.title')}
          to="staff"
          icon="bell"
          hint={t('tgn.remind.hint')}
          days={remindDays}
          at={policy.digestTime}
          often={t('tgn.remind.often')}
        >
          <div className="basis-full">
            <CheckRow
              plain
              compact
              checked={policy.overdueRepeat}
              disabled={off}
              onChange={(on) =>
                void save(
                  { overdueRepeat: on },
                  t(on ? 'tgn.remind.repeat_on' : 'tgn.remind.repeat_off'),
                )
              }
              label={t('tgn.remind.repeat')}
            >
              <Hint>{t('tgn.remind.repeat_hint')}</Hint>
            </CheckRow>
          </div>
          <div className="w-[220px] max-w-full" data-tgn-hour="">
            <Field
              id={`${id}-hour`}
              label={t('tgn.hour')}
              hint={t('tgn.hour_hint')}
              error={hourError}
            >
              {(c) => (
                <input
                  {...c}
                  type="time"
                  value={hour}
                  disabled={off}
                  onChange={(e) => {
                    setHour(e.target.value);
                    setHourError(undefined);
                  }}
                  onBlur={commitHour}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className={inputClass()}
                />
              )}
            </Field>
          </div>
          <span className="flex basis-full items-start gap-1.5 text-[12px] leading-[1.4] text-muted">
            <Icon name="calendar" size="sm" />
            <span>
              {t('tgn.remind.links')}{' '}
              {/* ОТКЛОНЕНИЕ: docs/deviations.md#Т-16 — без подсветки поля «+ день» */}
              <Link href={tabHref('org', 'policy')} className={linkButtonClass()}>
                {t('tgn.remind.link_policy')}
              </Link>
              {t('tgn.remind.links_types')}{' '}
              <Link href={tabHref('dicts', 'types')} className={linkButtonClass()}>
                {t('tgn.remind.link_types')}
              </Link>
            </span>
          </span>
        </NoticeRow>
        <NoticeRow
          id="week"
          title={t('tgn.week.title')}
          to="staff"
          icon="calendar"
          hint={t('tgn.week.hint')}
          days={t(`tgn.wdpl.${weekDay}`)}
          at={t('tgn.at_hour', { time: policy.digestTime })}
          often={t('tgn.week.often')}
        >
          <div className="w-[220px] max-w-full">
            <Field id={`${id}-wd`} label={t('tgn.week.day')}>
              {(c) => (
                <select
                  {...c}
                  value={weekDay}
                  disabled={off}
                  onChange={(e) => {
                    const next = weekDayOf(Number(e.target.value));
                    if (next !== weekDay) {
                      void save(
                        { weekDay: next },
                        t('tgn.week.saved', { days: t(`tgn.wdpl.${next}`) }),
                      );
                    }
                  }}
                  className={`${inputClass()} cursor-pointer`}
                >
                  {WEEK_DAYS.map((n) => (
                    <option key={n} value={n}>
                      {upper(t(`tgn.wd.${n}`))}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </NoticeRow>
        <NoticeRow
          id="actions"
          title={t('tgn.actions.title')}
          to="staff"
          on={policy.telegramActions}
          disabled={off}
          why={own ? undefined : t('tgn.owner_only')}
          onToggle={(on) =>
            void save({ telegramActions: on }, t(on ? 'tgn.actions.on' : 'tgn.actions.off'))
          }
          hint={`${t('tgn.actions.hint')}${own ? ` ${t('tgn.actions.hint_owner')}` : ''}`}
          days="—"
          at={t('tgn.actions.at')}
          often={t('tgn.actions.often')}
          data-telegram-actions=""
        />
        <TelegramGroupRow hour={policy.digestTime} />
        {policy.features.cppage ? (
          <ContractorNoticeRows policy={policy} own={own} busy={busy} save={save} />
        ) : null}
      </Box>
    </div>
  );
}
