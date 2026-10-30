'use client';

import { SOCFUND_FLAGS, type SocfundFlag, type UiTextKey } from '@buhuchet/domain';
import type { ContractorSocfundCheck, ContractorSocfundRequest } from '@buhuchet/shared';
import { buttonClass, Field, Icon, inputClass, Note, Segments } from '@buhuchet/ui';
import { useT } from '../l10n/provider';

/*
 * Блок «Тариф Соцфонда» формы контрагента (ТЗ «Тариф страховых взносов в Соцфонд (СПиНО)»; прототип
 * modules/socfund-ui.js: sfFields, sfMount, sfValid): признаки «Да / Нет», выбор тарифа («Определить
 * автоматически» по условиям), что подходит по условиям и чего не хватает, «Сменить на …» и причина
 * ручного выбора. Тариф по набранным значениям считает сервер (`socfund-check`), форма показывает ответ.
 */

/** Признаки и выбор тарифа в форме: `touched` — тариф менял пользователь (иначе выбор не трогали). */
export interface SocfundDraft {
  flags: Readonly<Record<SocfundFlag, boolean | null>>;
  tariff: string;
  touched: boolean;
  reason: string;
}

export const socfundDraftOf = (
  flags: Partial<Record<SocfundFlag, boolean | null>> = {},
  tariff = '',
): SocfundDraft => ({
  flags: Object.fromEntries(SOCFUND_FLAGS.map((k) => [k, flags[k] ?? null])) as Record<
    SocfundFlag,
    boolean | null
  >,
  tariff,
  touched: false,
  reason: '',
});

/** Признаки и выбор для запроса: выбор не трогали — `tariff` не передаётся (прототип sfApply). */
export function socfundRequestOf(d: SocfundDraft): ContractorSocfundRequest {
  return {
    flags: d.flags,
    ...(d.touched ? { tariff: (d.tariff || null) as ContractorSocfundRequest['tariff'] } : {}),
    reason: d.reason.trim(),
  };
}

const FLAG_HINT: Partial<Record<SocfundFlag, UiTextKey>> = {
  confirmed: 'cp.socfund.flag_hint.confirmed',
  gov: 'cp.socfund.flag_hint.gov',
};

/** «Тариф ПВТ / ПКИ» → «тариф ПВТ / ПКИ» для «Сменить на …» (прототип sfLow без « тариф»). */
const low = (s: string) => s.replace(/^./, (x) => x.toLowerCase()).replace(/ тариф$/, '');

export function SocfundFields({
  idPrefix,
  reasonId = `${idPrefix}-sfwhy`,
  draft,
  check,
  saved,
  reasonError,
  disabled = false,
  onChange,
}: {
  idPrefix: string;
  /** id поля причины: по нему форма прокручивает к ошибке. */
  reasonId?: string;
  draft: SocfundDraft;
  /** Ответ сервера по набранным значениям; нет — ещё грузится. */
  check: ContractorSocfundCheck | undefined;
  /** Сохранённый выбор контрагента (форма «Изменить»): «Выбран вручную, хотя не совпадает…». */
  saved?: { id: string; manual: boolean; reason: string | null } | null;
  reasonError?: string | undefined;
  disabled?: boolean;
  onChange: (next: SocfundDraft) => void;
}) {
  const t = useT();
  if (!check?.needed) return null;
  const auto = check.auto;
  const cur = check.tariff;
  const fit = auto?.id ? check.tariffs.find((x) => x.id === auto.id) : undefined;
  const shown = cur ? check.tariffs.find((x) => x.id === cur.id) : fit;
  const badText = !check.bad
    ? ''
    : draft.touched
      ? t('cp.socfund.bad.touched', { tariff: cur?.short ?? '', why: check.badWhy })
      : saved?.manual && saved.id === draft.tariff
        ? t('cp.socfund.bad.manual', { why: check.badWhy }) +
          (saved.reason ? `. ${t('cp.socfund.reason_line', { reason: saved.reason })}` : '')
        : t('cp.socfund.bad.stale', { tariff: cur?.short ?? '', why: check.badWhy });
  const hint = (k: SocfundFlag) => {
    const key = FLAG_HINT[k];
    return key ? t(key) : '';
  };
  const flag = (k: SocfundFlag) => {
    const v = draft.flags[k];
    // У госфинансирования «Нет» по умолчанию (прототип sfFields: k === 'gov' ? false : null).
    const shownValue = v ?? (k === 'gov' ? false : null);
    return shownValue === null ? '' : shownValue ? 'yes' : 'no';
  };
  return (
    <Field id={`${idPrefix}-sf`} label={t('cp.socfund.title')} full hint={undefined}>
      {() => (
        <div className="flex flex-col gap-2" data-socfund="">
          <span className="text-[12px] text-muted">{t('cp.socfund.tip')}</span>
          <div className="flex flex-col rounded-md border border-line bg-pane-alt px-2.5 py-0.5">
            {SOCFUND_FLAGS.map((k) => (
              <div
                key={k}
                className="flex items-center gap-2.5 border-b border-line py-[7px] last:border-b-0"
                data-sf-flag={k}
              >
                <span className="grow text-[13px]">
                  {t(`cp.socfund.flag.${k}`)}
                  {hint(k) ? (
                    <span className="mt-px block text-[12px] text-muted">{hint(k)}</span>
                  ) : null}
                </span>
                <Segments<'' | 'yes' | 'no'>
                  label={t(`cp.socfund.flag.${k}`)}
                  disabled={disabled}
                  options={[
                    { value: 'yes', label: t('cp.yes') },
                    { value: 'no', label: t('cp.no') },
                  ]}
                  value={flag(k)}
                  onChange={(v) =>
                    onChange({ ...draft, flags: { ...draft.flags, [k]: v === 'yes' } })
                  }
                />
              </div>
            ))}
          </div>
          <select
            className={`${inputClass()} cursor-pointer`}
            aria-label={t('cp.socfund.title')}
            disabled={disabled}
            value={draft.tariff}
            data-sf-tariff=""
            onChange={(e) => onChange({ ...draft, tariff: e.target.value, touched: true })}
          >
            <option value="">
              {fit
                ? t('cp.socfund.auto_option_fit', { tariff: fit.short })
                : t('cp.socfund.auto_option')}
            </option>
            {check.tariffs.map((x) => (
              <option key={x.id} value={x.id}>
                {x.total ? `${x.title} · ${x.total}` : x.title}
              </option>
            ))}
          </select>
          {auto ? (
            auto.id ? (
              <span className="flex items-start gap-1.5 text-[12px] text-muted" data-sf-fit="">
                <Icon name="info" size="sm" />
                <span>
                  {t('cp.socfund.fit')} <b>{auto.short}</b>
                  {auto.total ? ` · ${auto.total}` : ''} — {auto.why.join('; ')}
                  {auto.miss.length
                    ? `. ${t('cp.socfund.not_set', { miss: auto.miss.join(', ') })}`
                    : ''}
                </span>
              </span>
            ) : (
              <Note tone="warn">
                {t('cp.socfund.undetermined_specify', { miss: auto.miss.join(', ') })}
              </Note>
            )
          ) : null}
          {(auto?.warn ?? []).map((w) => (
            <Note key={w} tone="warn">
              {w}
            </Note>
          ))}
          {badText ? (
            <Note tone="warn">
              <div className="flex flex-wrap items-center gap-2" data-sf-bad="">
                <span className="min-w-0 flex-[1_1_220px]">{badText}</span>
                {!disabled && fit ? (
                  <button
                    type="button"
                    className={`${buttonClass('default', 'sm')} ml-auto`}
                    onClick={() =>
                      onChange({ ...draft, tariff: fit.id, touched: true, reason: '' })
                    }
                  >
                    {t('cp.socfund.switch', { tariff: low(fit.short) })}
                  </button>
                ) : null}
              </div>
            </Note>
          ) : null}
          {!check.bad && check.manualMismatch && cur ? (
            <Note tone="warn">
              {t('cp.socfund.manual_undetermined', {
                tariff: cur.short,
                miss: (auto?.miss ?? []).join(', '),
              })}
            </Note>
          ) : null}
          {check.manualMismatch ? (
            <Field id={reasonId} label={t('cp.socfund.reason')} required full error={reasonError}>
              {(control) => (
                <input
                  {...control}
                  className={inputClass()}
                  value={draft.reason}
                  placeholder={t('cp.socfund.reason_placeholder')}
                  onChange={(e) => onChange({ ...draft, reason: e.target.value })}
                />
              )}
            </Field>
          ) : null}
          {shown ? (
            <details className="group" data-sf-rates="">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] text-muted group-open:mb-1.5 [&::-webkit-details-marker]:hidden">
                <Icon name="coins" size="sm" />
                <span className="grow">{t('cp.socfund.rates', { title: shown.title })}</span>
                <Icon name="down" size="sm" />
              </summary>
              <div className="flex flex-col gap-1 text-[12.5px]">
                <span>{shown.rates}</span>
                {shown.total ? (
                  <span>{t('cp.socfund.rates_total', { total: shown.total })}</span>
                ) : null}
                {shown.cap ? (
                  <span className="text-muted">{t('cp.socfund.cap_hint', { cap: shown.cap })}</span>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </Field>
  );
}
