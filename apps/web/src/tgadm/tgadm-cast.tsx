'use client';

import {
  BROADCAST_TEXT_MAX,
  CAST_IMAGE_MAX_BYTES,
  CAST_TITLE_MAX,
  castFromNews,
  fillTemplate,
  botTemplate,
  pluralForm,
  type BotButton,
  type BotMessage,
} from '@buhuchet/domain';
import {
  AdminTelegramBroadcastResult,
  AdminTelegramCastCount,
  AdminTelegramCastImage,
  AdminTelegramCastOptions,
  AdminTelegramOrgs,
  type AdminTelegramCastMore,
} from '@buhuchet/shared';
import {
  Box,
  buttonClass,
  CheckRow,
  ConfirmDialog,
  Field,
  Hint,
  Icon,
  inputClass,
  Note,
  useToast,
} from '@buhuchet/ui';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import { api, apiFailure, callApi } from '../api-client';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { pdictsTemplatesQuery } from '../platform-dicts/pdicts-data';
import { BotChat, type BotChatItem } from './bot-chat';
import { peekCastRequest, takeCastRequest } from './cast-store';

const orgsQuery = queryOptions({
  queryKey: ['admin', 'tg-orgs'],
  queryFn: async () => {
    const res = await api.api.admin.telegram.orgs.$get();
    if (!res.ok) throw await apiFailure(res);
    return AdminTelegramOrgs.parse(await res.json());
  },
});

/**
 * Новости, статьи и видео для кнопок и «Заполнить из новости» — свежие при каждом открытии; `asked` —
 * новость из «Отправить в Telegram» (приходит, даже если не входит в 20 последних).
 */
const optionsQuery = (asked: string | null) =>
  queryOptions({
    queryKey: ['admin', 'tg-cast-options', asked],
    queryFn: async () => {
      const res = await api.api.admin.telegram['cast-options'].$get({
        query: asked ? { news: asked } : {},
      });
      if (!res.ok) throw await apiFailure(res);
      return AdminTelegramCastOptions.parse(await res.json());
    },
    staleTime: 0,
  });

/** Ошибка текста объявления до запроса: пусто — «Введите текст» (прототип), длиннее 900 знаков. */
export function castTextError(t: Translate, text: string): string | undefined {
  const value = text.trim();
  if (!value) return t('tgadm.cast.err.text_required');
  if (value.length > BROADCAST_TEXT_MAX) return t('tgadm.cast.err.text_too_long');
  return undefined;
}

/** Выбор кнопки «Подробнее» в списке: `news:<id>` или `article:<id>`. */
export const moreValue = (m: AdminTelegramCastMore | null) => (m ? `${m.kind}:${m.id}` : '');
export function moreOf(value: string): AdminTelegramCastMore | null {
  const at = value.indexOf(':');
  const kind = value.slice(0, at);
  const id = value.slice(at + 1);
  return at > 0 && id && (kind === 'news' || kind === 'article') ? { kind, id } : null;
}

/**
 * Сообщение для предпросмотра (прототип `tgCastMsg`): картинка, заголовок, текст и ряд кнопок-ссылок.
 * Адреса — на этом сайте; в Telegram их собирает сервер из тех же записей.
 */
export function castPreview(o: {
  title: string;
  text: string;
  more: { text: string; url: string } | null;
  video: { text: string; url: string } | null;
}): BotMessage {
  const row: BotButton[] = [o.more, o.video].flatMap((b) => (b ? [b] : []));
  return {
    ...(o.title.trim() ? { heading: o.title.trim() } : {}),
    text: o.text.trim(),
    ...(row.length ? { buttons: [row] } : {}),
  };
}

const CAST_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Админка → «Телеграм» → «Рассылка» (ТЗ: «Рассылка объявлений всем пользователям или одной
 * организации»; прототип v103 admin/tg-cast.js): сообщение из картинки, заголовка, текста и кнопок
 * «Подробнее» и «Смотреть видео» (только на опубликованные записи сайта), рядом — как его увидит
 * получатель, в виде с таблицами и простым текстом. «Поставить в очередь» спрашивает подтверждение с
 * числом получателей: отправленное сообщение не отозвать. «Отправить в Telegram» в меню новости
 * открывает экран с полями из новости.
 */
export function TgAdmCast({ textRef }: { textRef: RefObject<HTMLTextAreaElement | null> }) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const id = useId();
  const orgs = useQuery(orgsQuery);
  // «Отправить в Telegram» из меню новости: просьба забирается один раз, при открытии экрана.
  const [asked] = useState(peekCastRequest);
  const options = useQuery(optionsQuery(asked));
  const templates = useQuery(pdictsTemplatesQuery);
  const fileInput = useRef<HTMLInputElement>(null);
  const [to, setTo] = useState('all');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [image, setImage] = useState<{ id: string; name: string; src: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [more, setMore] = useState('');
  const [video, setVideo] = useState('');
  const [plain, setPlain] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [at] = useState(() =>
    new Intl.DateTimeFormat('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Bishkek',
    }).format(new Date()),
  );

  const news = options.data?.news ?? [];
  const articles = options.data?.articles ?? [];
  const videos = options.data?.videos ?? [];

  const fillFromNews = (newsId: string) => {
    const n = news.find((x) => x.id === newsId);
    if (!n) return false;
    const c = castFromNews(n, (v) => videos.some((x) => x.id === v));
    setTitle(c.title);
    setText(c.text);
    setMore(moreValue(c.more));
    setVideo(c.video ?? '');
    setError(undefined);
    return true;
  };

  // «Отправить в Telegram» из меню новости: поля — из новости, когда список новостей пришёл.
  const filled = useRef(false);
  const fillAsked = useEffectEvent(() => {
    if (!asked || !options.data || filled.current) return;
    filled.current = true;
    takeCastRequest();
    if (fillFromNews(asked)) toast(t('tgadm.cast.filled_news'), { icon: 'tg' });
  });
  useEffect(() => {
    fillAsked();
  }, [options.data]);

  // Адрес картинки для предпросмотра живёт, пока она выбрана.
  useEffect(() => (image ? () => URL.revokeObjectURL(image.src) : undefined), [image]);

  const template = (key: 'tgBtnMore' | 'tgBtnVideo') =>
    fillTemplate(botTemplate(key, templates.data?.find((x) => x.key === key)?.text), {});
  const site = (path: string) =>
    typeof window === 'undefined' ? path : new URL(path, window.location.origin).href;
  const chosenMore = moreOf(more);
  const moreUrl =
    chosenMore?.kind === 'news'
      ? site(`/app/kb/news?news=${encodeURIComponent(chosenMore.id)}`)
      : chosenMore?.kind === 'article'
        ? site(`/app/kb/arts?article=${encodeURIComponent(chosenMore.id)}`)
        : null;
  const preview = castPreview({
    title,
    text,
    more: moreUrl ? { text: template('tgBtnMore'), url: moreUrl } : null,
    video: video
      ? {
          text: template('tgBtnVideo'),
          url: site(`/app/kb/video?video=${encodeURIComponent(video)}`),
        }
      : null,
  });
  const list: readonly BotChatItem[] =
    title.trim() || text.trim() || image
      ? [{ kind: 'message', message: preview, at, ...(image ? { imageSrc: image.src } : {}) }]
      : [];

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!CAST_IMAGE_TYPES.has(file.type)) {
      return toast(t('err.cast_image_type'), { bad: true });
    }
    if (file.size > CAST_IMAGE_MAX_BYTES) {
      return toast(t('err.cast_image_too_large'), { bad: true });
    }
    setUploading(true);
    const res = await callApi(() =>
      api.api.admin.telegram.images.$put(
        {},
        { headers: { 'content-type': file.type }, init: { body: file } },
      ),
    );
    setUploading(false);
    if (!res.ok) return toast(errorText(res.error), { bad: true });
    const uploaded = AdminTelegramCastImage.parse(res.data);
    setImage({ id: uploaded.id, name: file.name, src: URL.createObjectURL(file) });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    const bad = castTextError(t, text);
    setError(bad);
    if (bad) return textRef.current?.focus();
    setSending(true);
    const res = await callApi(() =>
      api.api.admin.telegram.broadcast.count.$get({
        query: to === 'all' ? {} : { org: to },
      }),
    );
    setSending(false);
    if (!res.ok) return failed(res.error);
    const n = AdminTelegramCastCount.parse(res.data).count;
    if (!n) return toast(t('err.cast_empty'), { bad: true });
    setConfirm(n);
  };

  const failed = (err: { code: string; message: string }) => {
    if (err.code === 'broadcast_org') {
      setTo('all');
      void client.invalidateQueries({ queryKey: orgsQuery.queryKey });
    }
    if (err.code === 'cast_image') setImage(null);
    if (err.code === 'cast_more' || err.code === 'cast_video') {
      void client.invalidateQueries({ queryKey: ['admin', 'tg-cast-options'] });
    }
    toast(errorText(err), { bad: true });
  };

  const send = async () => {
    setConfirm(null);
    setSending(true);
    const res = await callApi(() =>
      api.api.admin.telegram.broadcast.$post({
        json: {
          org: to === 'all' ? null : to,
          title,
          text,
          image: image?.id ?? null,
          more: chosenMore,
          video: video || null,
        },
      }),
    );
    setSending(false);
    if (!res.ok) return failed(res.error);
    const body = AdminTelegramBroadcastResult.safeParse(res.data);
    const n = body.success ? body.data.queued : 0;
    setTitle('');
    setText('');
    setImage(null);
    setMore('');
    setVideo('');
    void client.invalidateQueries({ queryKey: ['list', 'tg.log'] });
    void client.invalidateQueries({ queryKey: ['admin', 'tg-summary'] });
    toast(t(`tgadm.cast.done.${pluralForm(n)}`, { n }), { icon: 'tg' });
  };

  const orgName = orgs.data?.items.find((o) => o.id === to)?.name ?? '';
  const select = `${inputClass()} cursor-pointer`;

  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3.5 max-[900px]:grid-cols-[minmax(0,1fr)]">
      <Box title={t('tgadm.cast.message')}>
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-2.5">
          <Field
            id={`${id}-news`}
            label={t('tgadm.cast.from_news')}
            hint={t('tgadm.cast.from_news.hint')}
          >
            {(control) => (
              <select
                {...control}
                data-tg-cast-news=""
                className={select}
                value=""
                onChange={(e) => {
                  if (fillFromNews(e.target.value)) toast(t('tgadm.cast.filled'), { icon: 'tg' });
                }}
              >
                <option value="">{t('tgadm.cast.from_news.none')}</option>
                {news.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${id}-to`} label={t('tgadm.cast.to')}>
            {(control) => (
              <select
                {...control}
                data-tg-cast-to=""
                className={select}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              >
                <option value="all">{t('tgadm.cast.all')}</option>
                {(orgs.data?.items ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            id={`${id}-title`}
            label={t('tgadm.cast.title')}
            hint={t('tgadm.cast.title.hint', { n: CAST_TITLE_MAX })}
          >
            {(control) => (
              <input
                {...control}
                data-tg-cast-title=""
                className={inputClass()}
                maxLength={CAST_TITLE_MAX}
                placeholder={t('tgadm.cast.title.placeholder')}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <Field
            id={`${id}-text`}
            label={t('tgadm.cast.text')}
            required
            error={error}
            hint={t('tgadm.cast.text.hint', { n: BROADCAST_TEXT_MAX })}
          >
            {(control) => (
              <textarea
                {...control}
                ref={textRef}
                data-tg-cast-text=""
                className={`${inputClass({ multiline: true })} min-h-[120px]`}
                maxLength={BROADCAST_TEXT_MAX}
                placeholder={t('tgadm.cast.placeholder')}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(undefined);
                }}
              />
            )}
          </Field>
          <Field
            id={`${id}-image`}
            label={t('tgadm.cast.image')}
            hint={t('tgadm.cast.image.hint', { n: CAST_IMAGE_MAX_BYTES / 1024 / 1024 })}
          >
            {(control) => (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  data-tg-cast-image=""
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    void pickImage(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  id={control.id}
                  className={buttonClass('default', 'sm')}
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Icon name="upload" size="sm" />
                  {uploading
                    ? t('tgadm.cast.image.loading')
                    : image
                      ? t('tgadm.cast.image.replace')
                      : t('tgadm.cast.image.pick')}
                </button>
                {image ? (
                  <>
                    <span className="text-muted" data-tg-cast-image-name="">
                      {image.name}
                    </span>
                    <button
                      type="button"
                      className="cursor-pointer text-accent hover:underline"
                      onClick={() => setImage(null)}
                    >
                      {t('tgadm.cast.image.remove')}
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </Field>
          <Field id={`${id}-more`} label={t('tgadm.cast.more')} hint={t('tgadm.cast.more.hint')}>
            {(control) => (
              <select
                {...control}
                data-tg-cast-more=""
                className={select}
                value={more}
                onChange={(e) => setMore(e.target.value)}
              >
                <option value="">{t('tgadm.cast.none')}</option>
                {news.map((n) => (
                  <option key={`n-${n.id}`} value={moreValue({ kind: 'news', id: n.id })}>
                    {t('tgadm.cast.opt.news', { title: n.title })}
                  </option>
                ))}
                {articles.map((a) => (
                  <option key={`a-${a.id}`} value={moreValue({ kind: 'article', id: a.id })}>
                    {t('tgadm.cast.opt.article', { title: a.title })}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field id={`${id}-video`} label={t('tgadm.cast.video')}>
            {(control) => (
              <select
                {...control}
                data-tg-cast-video=""
                className={select}
                value={video}
                onChange={(e) => setVideo(e.target.value)}
              >
                <option value="">{t('tgadm.cast.none')}</option>
                {videos.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Hint>{t('tgadm.cast.hint')}</Hint>
            <div className="grow" />
            <button
              type="submit"
              className={buttonClass('cta')}
              disabled={sending || uploading}
              data-tg-cast-go=""
            >
              <Icon name="send" size="sm" />
              {t('tgadm.cast.go')}
            </button>
          </div>
        </form>
      </Box>
      <Box title={t('tgadm.cast.preview')}>
        <div className="flex flex-col gap-2.5" data-tg-cast-preview="">
          <CheckRow
            plain
            checked={plain}
            onChange={setPlain}
            label={t('tgadm.cast.plain')}
            data-tg-cast-plain=""
          >
            <Hint>{t('tgadm.cast.plain.hint')}</Hint>
          </CheckRow>
          <BotChat who="Buhuchet.kg" list={list} plain={plain} onPress={() => undefined} />
          <Note icon="info">{t('tgadm.cast.note')}</Note>
        </div>
      </Box>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={t('tgadm.cast.confirm.title')}
        text={t(to === 'all' ? 'tgadm.cast.confirm.all' : 'tgadm.cast.confirm.org', {
          title: title.trim() ? ` «${title.trim()}»` : '',
          n: confirm ?? 0,
          who: t(`tgadm.cast.confirm.who.${pluralForm(confirm ?? 0)}`),
          org: orgName,
        })}
        ok={t('tgadm.cast.go')}
        onConfirm={() => void send()}
      />
    </div>
  );
}
