'use client';

import { FormGrid, Icon } from '@buhuchet/ui';
import type { ReactNode } from 'react';
import { useT } from '../l10n/provider';
import { FORM_SECTIONS, type FormSection } from './contractor-form-model';

/*
 * Три раздела формы контрагента (прототип modules/contractor-form.js: `cfToc`, `cfSec`, `cfShow`) —
 * общие для «Нового контрагента» и «Изменить контрагента» (прототип v137): на ПК — лентой с
 * оглавлением, которое прокручивает к разделу; на телефоне — три шага.
 */

/** Оглавление разделов; `mark` — отметка раздела («заполнено», «осталось: N») у формы создания. */
export function FormToc({
  phone,
  step,
  onStep,
  mark,
}: {
  phone: boolean;
  step: FormSection;
  onStep: (sec: FormSection) => void;
  mark?: (sec: FormSection) => ReactNode;
}) {
  const t = useT();
  return (
    <div
      role="tablist"
      aria-label={t('cp.form.sections')}
      data-cf-toc=""
      data-form-toc=""
      className={`sticky -top-1.5 z-[3] -mt-1.5 flex gap-1.5 bg-pane pt-1.5 pb-2 shadow-[0_1px_0_var(--bu-line)] ${phone ? 'flex-nowrap items-center gap-0.5' : 'flex-wrap'}`}
    >
      {FORM_SECTIONS.map((sec) => {
        // На ПК, как в прототипе (cfToc со step = 1), выделен первый раздел: оглавление только прокручивает.
        const on = phone ? step === sec : sec === 1;
        return (
          <div key={sec} className="contents">
            <button
              type="button"
              role="tab"
              aria-selected={on}
              data-cf-step={sec}
              onClick={() => onStep(sec)}
              className={`inline-flex cursor-pointer items-center border border-line font-semibold ${on ? 'bg-raised text-ink shadow-btn' : 'bg-pane-alt text-muted'} ${phone ? 'min-w-0 flex-[1_1_0] flex-col gap-0.5 rounded-md px-1 py-1.5 text-center text-[11.5px] leading-[1.2]' : 'gap-[7px] rounded-full py-[5px] pr-3 pl-1.5 text-[12.5px]'}`}
            >
              <span
                className={`inline-grid h-5 w-5 flex-none place-items-center rounded-full text-[11.5px] font-bold ${on ? 'bg-accent text-on-accent' : 'bg-sel text-muted'}`}
              >
                {sec}
              </span>
              <span className="max-w-full truncate">{t(`cp.form.sec.${sec}`)}</span>
              {mark ? <span data-cf-mark={sec}>{mark(sec)}</span> : null}
            </button>
            {phone && sec < 3 ? (
              <span aria-hidden="true" className="inline-grid flex-none text-faint">
                <Icon name="right" size="sm" />
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** Раздел формы: на ПК — с заголовком, на телефоне виден только раздел своего шага. */
export function FormSectionBlock({
  sec,
  phone,
  step,
  onRef,
  after,
  children,
}: {
  sec: FormSection;
  phone: boolean;
  step: FormSection;
  /** Элемент раздела — форме: к нему прокручивает оглавление на ПК. */
  onRef: (sec: FormSection, el: HTMLElement | null) => void;
  /** Под сеткой полей раздела (сноска). */
  after?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <section
      ref={(el) => onRef(sec, el)}
      data-cf-sec={sec}
      hidden={phone && step !== sec}
      className="flex scroll-mt-[52px] flex-col gap-2.5"
    >
      {phone ? null : (
        <h3 className="m-0 flex items-center gap-2 border-b border-line pb-1.5 text-[14px]">
          <span className="inline-grid h-5 w-5 flex-none place-items-center rounded-full bg-accent text-[11.5px] font-bold text-on-accent">
            {sec}
          </span>
          {t(`cp.form.sec.${sec}`)}
        </h3>
      )}
      <FormGrid>{children}</FormGrid>
      {after}
    </section>
  );
}
