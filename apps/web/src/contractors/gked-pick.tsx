'use client';

import { GKED_PICK_LIMIT } from '@buhuchet/domain';
import { buttonClass, Field, Icon, Modal, Pill } from '@buhuchet/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useT } from '../l10n/provider';
import { gkedSearchQuery } from './contractor-data';

/*
 * Выбор ГКЭД в форме контрагента (ТЗ «Основной вид деятельности (ГКЭД)»; прототип modules/gked-ui.js:
 * gkPickDlg, gkFields): окно поиска по коду, началу кода или словам названия — выбирается только
 * подкласс, у каждого кода путь «секция › раздел › группа › класс», первые 80 найденных; поля основного
 * (обязателен) и дополнительных (сколько угодно, без повтора основного) видов деятельности.
 */

/** Код ГКЭД с названием — как его видит пользователь. */
export interface GkedValue {
  code: string;
  name: string;
}

/** Строка поиска уходит на сервер, когда пользователь перестал печатать. */
const TYPE_PAUSE_MS = 200;

export function GkedPickDialog({
  open,
  onClose,
  title,
  current,
  exclude,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  current?: string | null;
  /** Коды, уже указанные у контрагента: их не выбрать. */
  exclude: readonly string[];
  onPick: (value: GkedValue) => void;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [sent, setSent] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSent(q.trim()), TYPE_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [q]);
  const found = useQuery(gkedSearchQuery(sent)).data;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="mid"
      title={title}
      sub={t('cp.form.gked.pick_sub')}
      footer={
        <button type="button" className={buttonClass('ghost')} onClick={onClose}>
          {t('btn.cancel')}
        </button>
      }
    >
      <div className="relative w-full">
        <span className="pointer-events-none absolute top-1/2 left-[11px] flex -translate-y-1/2 text-faint">
          <Icon name="search" />
        </span>
        <input
          className="h-9 w-full rounded-full border border-line bg-field pr-3 pl-[34px] text-[13.5px] outline-none focus:border-line-strong focus:shadow-[0_0_0_3px_var(--bu-sel)]"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('cp.form.gked.search')}
          autoComplete="off"
          aria-label={t('cp.form.gked.search_label')}
          data-gked-search=""
        />
      </div>
      <div className="mt-2 text-[12px] text-muted" data-gked-count="">
        {found
          ? found.total
            ? found.total > GKED_PICK_LIMIT
              ? t('cp.form.gked.found_more', { n: found.total, max: GKED_PICK_LIMIT })
              : t('cp.form.gked.found', { n: found.total })
            : t('cp.form.gked.none')
          : null}
      </div>
      <div
        role="listbox"
        aria-label={title}
        className="mt-1.5 flex max-h-[min(460px,calc(100dvh-300px))] flex-col gap-0.5 overflow-auto"
      >
        {(found?.items ?? []).map((x) => {
          const taken = exclude.includes(x.code);
          const on = x.code === current;
          return (
            <button
              key={x.code}
              type="button"
              role="option"
              aria-selected={on}
              disabled={taken}
              title={taken ? t('cp.form.gked.taken') : undefined}
              data-gked={x.code}
              className={`flex cursor-pointer items-start gap-2.5 rounded-md border-0 px-[9px] py-[7px] text-left text-[13px] leading-[1.35] text-ink disabled:cursor-not-allowed disabled:opacity-45 ${on ? 'bg-sel' : 'bg-transparent hover:enabled:bg-row-hover'}`}
              onClick={() => {
                onPick({ code: x.code, name: x.name });
                onClose();
              }}
            >
              <span className="min-w-[62px] flex-none font-mono font-semibold">{x.code}</span>
              <span className="grow">
                {x.name}
                <small className="block text-[11.5px] text-faint">{x.path.join(' › ')}</small>
              </span>
              {on ? <Icon name="check" size="sm" /> : null}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

/**
 * Поля «Основной вид деятельности (ГКЭД)» и «Дополнительные виды деятельности (ГКЭД)» (прототип
 * gkFields, gkBind): кнопка с найденным кодом открывает окно поиска; код, который больше не действует, —
 * с жёлтой меткой «Не действует».
 */
export function GkedFields({
  idPrefix,
  mainId = `${idPrefix}-gk`,
  main,
  extra,
  off,
  error,
  onMain,
  onExtra,
}: {
  idPrefix: string;
  /** id кнопки основного ГКЭД: по нему форма прокручивает к ошибке. */
  mainId?: string;
  main: GkedValue | null;
  extra: readonly GkedValue[];
  /** Коды, которые больше не действуют (сверка с ГКЭД). */
  off: readonly string[];
  error?: string | undefined;
  onMain: (value: GkedValue) => void;
  onExtra: (values: GkedValue[]) => void;
}) {
  const t = useT();
  const [pick, setPick] = useState<{ kind: 'main' | 'extra'; n: number } | null>(null);
  const [open, setOpen] = useState(false);
  const show = (kind: 'main' | 'extra') => {
    setPick((p) => ({ kind, n: (p?.n ?? 0) + 1 }));
    setOpen(true);
  };
  const offPill = (code: string) =>
    off.includes(code) ? (
      <Pill tone="warn" size="sm" icon="alert">
        {t('cp.form.gked.off')}
      </Pill>
    ) : null;
  const codes = [main?.code, ...extra.map((x) => x.code)].filter((c): c is string => !!c);
  return (
    <>
      <Field
        id={mainId}
        label={t('cp.form.gked.main')}
        required
        full
        hint={t('cp.form.gked.main_hint')}
        error={error}
      >
        {(control) => (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              {...control}
              type="button"
              data-gked-main=""
              className={`${buttonClass('default')} min-h-[35px] w-full justify-start text-left whitespace-normal ${main ? '' : 'text-muted'}`}
              onClick={() => show('main')}
            >
              <Icon name="search" size="sm" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {main ? `${main.code} — ${main.name}` : t('cp.form.gked.choose')}
              </span>
            </button>
            {main ? offPill(main.code) : null}
          </div>
        )}
      </Field>
      <Field
        id={`${idPrefix}-gkx`}
        label={t('cp.form.gked.extra')}
        full
        hint={t('cp.form.gked.extra_hint')}
      >
        {() => (
          <div className="flex flex-wrap items-center gap-1.5" data-gked-extra="">
            {extra.map((x) => (
              <span
                key={x.code}
                title={`${x.code} — ${x.name}`}
                data-gked-chip={x.code}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-info-bg py-0.5 pr-1 pl-2.5 text-[12.5px] font-[550] text-info"
              >
                <span className="truncate">
                  <b>{x.code}</b> {x.name}
                </span>
                {offPill(x.code)}
                <button
                  type="button"
                  aria-label={t('cp.form.gked.remove', { code: x.code })}
                  className="grid h-5 w-5 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent text-inherit"
                  onClick={() => onExtra(extra.filter((y) => y.code !== x.code))}
                >
                  <Icon name="x" size="sm" />
                </button>
              </span>
            ))}
            <button
              type="button"
              className={buttonClass('default', 'sm')}
              data-gked-add=""
              onClick={() => show('extra')}
            >
              <Icon name="plus" size="sm" />
              {t('btn.add')}
            </button>
          </div>
        )}
      </Field>
      {pick ? (
        <GkedPickDialog
          key={`gked-${pick.n}`}
          open={open}
          onClose={() => setOpen(false)}
          title={pick.kind === 'main' ? t('cp.form.gked.main') : t('cp.form.gked.extra_one')}
          current={pick.kind === 'main' ? (main?.code ?? null) : null}
          exclude={pick.kind === 'main' ? extra.map((x) => x.code) : codes}
          onPick={(value) => (pick.kind === 'main' ? onMain(value) : onExtra([...extra, value]))}
        />
      ) : null}
    </>
  );
}
