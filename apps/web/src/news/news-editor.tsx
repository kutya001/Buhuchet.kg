'use client';

import {
  bishkekDate,
  formatDateRu,
  MENU_MODULE_IDS,
  NEWS_AUDIENCES,
  NEWS_IMAGE_MAX_BYTES,
  NEWS_TEMPLATE,
  NEWS_TYPES,
  newsLoginDefault,
  newsMdTrim,
  newsProblems,
  type NewsAudience,
  type NewsField,
  type NewsType,
  type UiTextKey,
} from '@buhuchet/domain';
import {
  AdminNewsRecord,
  NewsArticleOptions,
  NewsImageUploaded,
  type NewsLinkSchema,
} from '@buhuchet/shared';
import {
  buttonClass,
  Field,
  FormGrid,
  Icon,
  inputClass,
  Modal,
  RecordChangedNotice,
  Segments,
  SWITCH_CLASS,
  useToast,
  type IconName,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useForm, useWatch, type FieldPath } from 'react-hook-form';
import { api, apiFailure, callApi } from '../api-client';
import { fieldError } from '../auth/fields';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { MODULES } from '../shell/modules';
import { adminNewsQuery } from './news-data';
import { NewsBody } from './news-provider';

/*
 * Окно «Новость» в Админке (ТЗ «Админка» → «База знаний (содержимое)» → «Новости»; прототип
 * admin/news.js, newsEditDlg): новая новость сначала сохраняется черновиком или сразу публикуется;
 * у черновика — «Сохранить черновик» и «Опубликовать», у опубликованной — «Сохранить» (у пользователей
 * появится «Изменено»). Подробное описание — markdown с кнопками, предпросмотром (на ПК — рядом, на
 * телефоне — переключателем «Текст / Предпросмотр») и картинками в хранилище.
 */

interface NewsFormValues {
  title: string;
  type: NewsType;
  release: string;
  date: string;
  audience: NewsAudience;
  /** '' — нет, `art:a5` — статья, `mod:reports` — модуль. */
  link: string;
  pinned: boolean;
  showOnLogin: boolean;
  short: string;
  md: string;
}

/** Поле проверки домена → поле формы. */
const FORM_FIELD: Record<NewsField | 'link', FieldPath<NewsFormValues>> = {
  title: 'title',
  date: 'date',
  short: 'short',
  md: 'md',
  version: 'release',
  link: 'link',
};

const linkValue = (link: NewsLinkSchema | null) => (link ? `${link.kind}:${link.id}` : '');
const linkOf = (value: string): NewsLinkSchema | null => {
  const [kind, id] = value.split(':');
  return (kind === 'art' || kind === 'mod') && id ? { kind, id } : null;
};

function formValues(n: AdminNewsRecord | null): NewsFormValues {
  if (!n) {
    return {
      title: '',
      type: 'update',
      release: '',
      date: bishkekDate(new Date()),
      audience: 'all',
      link: '',
      pinned: false,
      showOnLogin: true,
      short: '',
      md: NEWS_TEMPLATE,
    };
  }
  return {
    title: n.title,
    type: n.type,
    release: n.release ?? '',
    date: n.date,
    audience: n.audience,
    link: linkValue(n.link),
    pinned: n.pinned,
    showOnLogin: n.showOnLogin,
    short: n.short,
    md: n.md,
  };
}

/** Состояние новости строкой: «1/2 Черновик», «2/2 Опубликовано · появится 01.11.2026 в 09:00». */
export function newsStateText(t: Translate, n: { state: AdminNewsRecord['state']; date: string }) {
  return n.state === 'scheduled'
    ? t('news.state.scheduled', { date: formatDateRu(n.date) })
    : t(`news.state.${n.state}`);
}

/** Активные статьи Базы знаний — для «Ссылки «Подробнее»». */
const articleOptionsQuery = queryOptions({
  queryKey: ['admin-news', 'articles'],
  queryFn: async () => {
    const res = await api.api.admin.news.articles.$get();
    if (!res.ok) throw await apiFailure(res);
    return NewsArticleOptions.parse(await res.json()).items;
  },
});

/** Кнопки над текстом (прототип `tb`): жирный, заголовок, список, ссылка, картинка. */
const TOOLS: readonly {
  id: 'b' | 'h' | 'ul' | 'a' | 'img';
  label: UiTextKey;
  /** Буква на кнопке (ключ словаря) или значок. */
  letter?: UiTextKey;
  icon?: IconName;
}[] = [
  { id: 'b', label: 'news.md.bold', letter: 'news.md.bold_mark' },
  { id: 'h', label: 'news.md.heading', letter: 'news.md.heading_mark' },
  { id: 'ul', label: 'news.md.list', icon: 'list' },
  { id: 'a', label: 'news.md.link', icon: 'link' },
  { id: 'img', label: 'news.md.image', icon: 'upload' },
];

export function NewsEditDialog({
  record,
  open,
  onClose,
  onSaved,
}: {
  /** null — новая новость. */
  record: AdminNewsRecord | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const [current, setCurrent] = useState(record);
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'text' | 'prev'>('text');
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const articles = useQuery(articleOptionsQuery).data ?? [];
  const {
    register,
    getValues,
    setValue,
    setError,
    clearErrors,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm<NewsFormValues>({ defaultValues: formValues(record) });
  // Поля регистрируются по порядку на экране: при ошибках фокус встаёт на первое неверное.
  const fields = {
    title: register('title'),
    type: register('type', {
      // Новый тип — «Показывать при входе» по умолчанию для него (прототип: при смене типа).
      onChange: (e: { target: { value: NewsType } }) =>
        setValue('showOnLogin', newsLoginDefault(e.target.value, getValues('pinned'))),
    }),
    release: register('release'),
    date: register('date'),
    audience: register('audience'),
    link: register('link'),
    pinned: register('pinned'),
    showOnLogin: register('showOnLogin'),
    short: register('short'),
    md: register('md'),
  };
  const md = useWatch({ control, name: 'md' });
  const draft = !current || current.status === 'draft';

  const setMd = (value: string) => setValue('md', value, { shouldDirty: true });
  const wrap = (pre: string, post: string, placeholder: string) => {
    const ta = textarea.current;
    if (!ta) return;
    const a = ta.selectionStart;
    const z = ta.selectionEnd;
    const picked = ta.value.slice(a, z) || placeholder;
    ta.setRangeText(pre + picked + post, a, z, 'end');
    setMd(ta.value);
    ta.focus();
    if (picked === placeholder)
      ta.setSelectionRange(a + pre.length, a + pre.length + picked.length);
  };
  const line = (pre: string) => {
    const ta = textarea.current;
    if (!ta) return;
    const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    ta.setRangeText(pre, start, start, 'end');
    setMd(ta.value);
    ta.focus();
  };
  const tool = (k: (typeof TOOLS)[number]['id']) => {
    if (k === 'b') wrap('**', '**', t('news.md.bold_ph'));
    if (k === 'h') line('## ');
    if (k === 'ul') line('- ');
    if (k === 'a') wrap('[', '](https://)', t('news.md.link_ph'));
    if (k === 'img') fileInput.current?.click();
  };
  const addImage = async (file: File) => {
    if (file.size > NEWS_IMAGE_MAX_BYTES) return toast(t('news.md.image_big'), { bad: true });
    const res = await callApi(() =>
      api.api.admin.news.images.$put(
        {},
        { headers: { 'content-type': file.type }, init: { body: file } },
      ),
    );
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const image = NewsImageUploaded.parse(res.data);
    const ta = textarea.current;
    if (!ta) return;
    ta.setRangeText(
      `\n![${file.name.replace(/[[\]]/g, '')}](${image.url})\n`,
      ta.selectionStart,
      ta.selectionEnd,
      'end',
    );
    setMd(ta.value);
    toast(t('news.md.image_added'));
  };

  const reload = async () => {
    if (!current) return;
    setReloading(true);
    try {
      const fresh = await client.fetchQuery(adminNewsQuery(current.id));
      setCurrent(fresh);
      reset(formValues(fresh));
      setChanged(false);
    } catch {
      toast(t('err.network'), { bad: true });
    } finally {
      setReloading(false);
    }
  };

  const save = async (publish: boolean) => {
    const v = getValues();
    clearErrors();
    const problems = newsProblems(
      { title: v.title, type: v.type, version: v.release, date: v.date, short: v.short, md: v.md },
      { publish: publish || !draft },
    );
    const bad = (Object.keys(problems) as NewsField[]).map((f) => [f, problems[f]!] as const);
    if (bad.length) {
      bad.forEach(([f, problem], i) =>
        setError(
          FORM_FIELD[f],
          { type: 'server', message: t(`err.${problem}`) },
          { shouldFocus: i === 0 },
        ),
      );
      return;
    }
    const input = {
      title: v.title,
      type: v.type,
      release: v.release,
      date: v.date,
      short: v.short,
      md: v.md,
      link: linkOf(v.link),
      pinned: v.pinned,
      showOnLogin: v.showOnLogin,
      audience: v.audience,
      publish,
    };
    setBusy(true);
    const res = await callApi(() =>
      current
        ? api.api.admin.news[':id'].$put({
            param: { id: current.id },
            json: { ...input, version: current.version },
          })
        : api.api.admin.news.$post({ json: input }),
    ).finally(() => setBusy(false));
    if (res.ok) {
      const saved = AdminNewsRecord.parse(res.data);
      onSaved();
      onClose();
      toast(
        saved.state === 'draft'
          ? t('news.draft_saved')
          : saved.state === 'live'
            ? t('news.published_live')
            : saved.state === 'scheduled'
              ? t('news.published_later', { date: formatDateRu(saved.date) })
              : t('news.saved'),
        { icon: saved.state === 'draft' ? 'check' : 'send' },
      );
      return;
    }
    if (res.error.code === 'record_changed') return setChanged(true);
    const field = (res.error.details as Record<string, unknown> | undefined)?.field;
    if (typeof field === 'string' && field in FORM_FIELD) {
      return setError(
        FORM_FIELD[field as NewsField | 'link'],
        { type: 'server', message: errorText(res.error) },
        { shouldFocus: true },
      );
    }
    toast(errorText(res.error), { bad: true });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(false);
  };

  const formId = `${id}-form`;
  const off = changed;
  const linkOptions: { value: string; label: string }[] = [
    { value: '', label: t('news.f.link_none') },
    ...articles.map((a) => ({
      value: `art:${a.id}`,
      label: t('news.f.link_art', { title: a.title }),
    })),
    ...MENU_MODULE_IDS.map((m) => ({
      value: `mod:${m}`,
      label: t('news.f.link_mod', { title: t(MODULES[m].title) }),
    })),
  ];
  const currentLink = linkValue(current?.link ?? null);
  if (currentLink && !linkOptions.some((o) => o.value === currentLink)) {
    linkOptions.push({ value: currentLink, label: currentLink });
  }
  const switchRow = (control: ReactNode, text: string) => (
    <label className="inline-flex min-h-[35px] cursor-pointer items-center gap-2 text-[13px]">
      {control}
      {text}
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      kind="form"
      size="wide"
      title={t(current ? 'news.dlg.edit' : 'news.dlg.new')}
      sub={current ? newsStateText(t, current) : t('news.dlg.new_sub')}
      dirty={isDirty}
      footer={
        <>
          <button type="button" className={buttonClass('ghost')} onClick={onClose}>
            {t('news.btn.cancel')}
          </button>
          <div className="flex-1" />
          {draft ? (
            <>
              <button
                type="submit"
                form={formId}
                data-news-save=""
                className={buttonClass()}
                disabled={busy || off}
              >
                {t('news.btn.save_draft')}
              </button>
              <button
                type="button"
                data-news-publish=""
                className={buttonClass('cta')}
                disabled={busy || off}
                onClick={() => void save(true)}
              >
                <Icon name="send" size="sm" />
                {t('news.btn.publish')}
              </button>
            </>
          ) : (
            <button
              type="submit"
              form={formId}
              data-news-save=""
              className={buttonClass('cta')}
              disabled={busy || off}
            >
              {t('news.btn.save')}
            </button>
          )}
        </>
      }
    >
      {changed ? (
        <RecordChangedNotice
          message={t('err.record_changed')}
          reloadLabel={t('form.reload')}
          onReload={() => void reload()}
          reloading={reloading}
        />
      ) : null}
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-3.5">
        <FormGrid>
          <Field
            id={`${id}-title`}
            label={t('news.f.title')}
            required
            full
            error={fieldError(t, errors.title)}
          >
            {(c) => <input {...c} {...fields.title} type="text" className={inputClass()} />}
          </Field>
          <Field id={`${id}-type`} label={t('news.f.type')} required>
            {(c) => (
              <select {...c} {...fields.type} className={`${inputClass()} cursor-pointer`}>
                {NEWS_TYPES.map((x) => (
                  <option key={x} value={x}>
                    {t(`news.type.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-release`}
            label={t('news.f.release')}
            hint={t('news.f.release_hint')}
            error={fieldError(t, errors.release)}
          >
            {(c) => (
              <input
                {...c}
                {...fields.release}
                type="text"
                placeholder={t('news.f.release_ph')}
                className={inputClass()}
              />
            )}
          </Field>
          <Field
            id={`${id}-date`}
            label={t('news.f.date')}
            required
            hint={t('news.f.date_hint')}
            error={fieldError(t, errors.date)}
          >
            {(c) => <input {...c} {...fields.date} type="date" className={inputClass()} />}
          </Field>
          <Field id={`${id}-audience`} label={t('news.f.audience')}>
            {(c) => (
              <select {...c} {...fields.audience} className={`${inputClass()} cursor-pointer`}>
                {NEWS_AUDIENCES.map((x) => (
                  <option key={x} value={x}>
                    {t(`news.aud.${x}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-link`}
            label={t('news.f.link')}
            hint={t('news.f.link_hint')}
            error={fieldError(t, errors.link)}
          >
            {(c) => (
              <select {...c} {...fields.link} className={`${inputClass()} cursor-pointer`}>
                {linkOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${id}-pinned`} label={t('news.f.pinned')}>
            {(c) =>
              switchRow(
                <input
                  {...c}
                  {...fields.pinned}
                  type="checkbox"
                  role="switch"
                  className={SWITCH_CLASS}
                />,
                t('news.f.pinned_text'),
              )
            }
          </Field>
          <Field id={`${id}-login`} label={t('news.f.login')} full>
            {(c) =>
              switchRow(
                <input
                  {...c}
                  {...fields.showOnLogin}
                  type="checkbox"
                  role="switch"
                  className={SWITCH_CLASS}
                />,
                t('news.f.login_text'),
              )
            }
          </Field>
          <Field
            id={`${id}-short`}
            label={t('news.f.short')}
            required
            full
            hint={t('news.f.short_hint')}
            error={fieldError(t, errors.short)}
          >
            {(c) => (
              <input
                {...c}
                {...fields.short}
                type="text"
                maxLength={200}
                placeholder={t('news.f.short_ph')}
                className={inputClass()}
              />
            )}
          </Field>
          <Field
            id={`${id}-md`}
            label={t('news.f.md')}
            required
            full
            hint={t('news.f.md_hint')}
            error={fieldError(t, errors.md)}
          >
            {(c) => (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {TOOLS.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      data-md-tool={x.id}
                      onClick={() => tool(x.id)}
                      title={t(x.label)}
                      aria-label={t(x.label)}
                      className={buttonClass('default', 'sm')}
                    >
                      {x.letter ? (
                        <b className="min-w-3 text-center text-[13px]">{t(x.letter)}</b>
                      ) : x.icon ? (
                        <Icon name={x.icon} size="sm" />
                      ) : null}
                      <span className="max-md:hidden">{t(x.label)}</span>
                    </button>
                  ))}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void addImage(file);
                    }}
                  />
                  <div className="flex-1" />
                  <div className="md:hidden">
                    <Segments
                      size="sm"
                      label={t('news.md.view')}
                      value={view}
                      onChange={setView}
                      options={[
                        { value: 'text', label: t('news.md.text') },
                        { value: 'prev', label: t('news.md.preview') },
                      ]}
                    />
                  </div>
                </div>
                <div className="grid min-h-[320px] grid-cols-2 gap-2.5 max-md:grid-cols-1">
                  <textarea
                    {...c}
                    {...fields.md}
                    ref={(el) => {
                      fields.md.ref(el);
                      textarea.current = el;
                    }}
                    spellCheck
                    className={`${inputClass({ multiline: true })} h-full min-h-[320px] font-mono text-[12.5px] leading-[1.55] ${view === 'prev' ? 'max-md:hidden' : ''}`}
                  />
                  <div
                    aria-label={t('news.md.preview')}
                    data-news-preview=""
                    className={`max-h-[520px] overflow-auto rounded-lg border border-line bg-pane px-3.5 py-2.5 text-[13.5px] ${view === 'text' ? 'max-md:hidden' : ''}`}
                  >
                    {newsMdTrim(md) ? (
                      <NewsBody source={newsMdTrim(md)} preview />
                    ) : (
                      <span className="text-muted">{t('news.md.empty')}</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Field>
        </FormGrid>
      </form>
    </Modal>
  );
}
