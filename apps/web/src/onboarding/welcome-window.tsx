'use client';

import {
  FEATURE_REQUIRES,
  FEATURES,
  MENU_MODULES,
  onboardingAnswersOf,
  onboardingFreshAnswers,
  onboardingPlan,
  onboardingPlanToggle,
  onboardingRetakePlan,
  welcomeScreens,
  type Feature,
  type OnboardingAnswer,
  type OnboardingAnswers,
  type OnboardingPlan,
  type WelcomeScreen,
} from '@buhuchet/domain';
import {
  ApplyOnboardingResult,
  type OrgPolicy,
  OrgReportTypesConnected,
  type Onboarding,
  type OnboardingContent,
  type KbState,
  type KbStep,
} from '@buhuchet/shared';
import {
  BrandMark,
  buttonClass,
  CheckRow,
  Hint,
  Icon,
  ICONS,
  Modal,
  Note,
  PHONE_QUERY,
  pillClass,
  RecordChangedNotice,
  Segments,
  useMediaQuery,
  useToast,
  useWindow,
  type IconName,
} from '@buhuchet/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { api, callApi } from '../api-client';
import { catalogQuery, useDictsRefresh } from '../dicts/dicts-data';
import { TaxPickList } from '../dicts/tax-pick';
import { kbStateQuery } from '../kb/kb-data';
import { SHOW_AFTER_GO_MS, useKb } from '../kb/kb-provider';
import { useErrorText, useT } from '../l10n/provider';
import type { Translate } from '../l10n/translate';
import { policyQuery } from '../org/org-data';
import { MODULES, type ShellAccess } from '../shell/modules';

/**
 * Окно приветствия (ТЗ «Моя организация» → «Первый запуск организации»; прототип modules/onboard.js —
 * welcomeOpen, wlRender, wlClick, obApply): точки и «N из M», «Далее» / «Назад», свайп на телефоне.
 * Владельцу новой организации — шесть экранов с опросником и «Выбором налогов», сотруднику и при
 * повторном открытии из «Базы знаний» — «Добро пожаловать», «Модули», «С чего начать»; «Пройти
 * опросник заново» — опросник и «Что будет включено». На ПК — окно 860 px, на телефоне — весь экран.
 */

/** Как открыто окно: при входе с опросником или без, из «Базы знаний», из учётной политики. */
export type WelcomeMode = 'quiz' | 'tour' | 'again' | 'retake';

/** Свайп короче 70 px или больше вертикальный — не листание (прототип: touchend в welcomeOpen). */
const SWIPE_MIN_PX = 70;

export interface WelcomeOpen {
  kind: WelcomeMode;
  data: Onboarding;
  content: OnboardingContent;
  /** Учётная политика, которую видел пользователь (у опросника), — версия для «Применить». */
  policy: OrgPolicy | null;
}

export interface WelcomeWindowProps extends WelcomeOpen {
  open: boolean;
  access: ShellAccess;
  /** Модули меню вошедшего: сотрудник видит на экране «Модули» только их. */
  modules: readonly string[];
  homeHref: string;
  lessonsHref: string;
  /** Закрыли до опросника («Позже», крестик): опросник отложен. */
  onPostpone: (toast: boolean) => void;
  /** Опросник применён: перечитать учётную политику и меню. */
  onApplied: () => void;
  /** «Пройти опросник заново» применён: окно закрыто, что включено. */
  onRetakeDone: (result: ApplyOnboardingResult) => void;
  onClose: () => void;
}

export function WelcomeWindow(props: WelcomeWindowProps) {
  const { kind, content, access, open, onClose, onPostpone } = props;
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const client = useQueryClient();
  const phone = useMediaQuery(PHONE_QUERY);
  const own = access.can('org');
  const screens = useMemo(
    () =>
      welcomeScreens({
        kind: kind === 'again' ? 'tour' : kind,
        canDicts: access.can('dicts'),
      }),
    [kind, access],
  );
  const [index, setIndex] = useState(0);
  const screen = screens[index] ?? 'hello';
  const [policy, setPolicy] = useState(props.policy);
  const initial = useMemo(
    () =>
      kind === 'retake' && policy
        ? onboardingAnswersOf(content.questions, policy.features, policy.taskConfirm)
        : onboardingFreshAnswers(content.questions),
    [kind, content, policy],
  );
  const [answers, setAnswers] = useState<OnboardingAnswers>(initial);
  const [edited, setEdited] = useState<OnboardingPlan | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [taxes, setTaxes] = useState<ReadonlySet<string>>(new Set());
  const catalog = useQuery({ ...catalogQuery, enabled: open && screens.includes('taxes') }).data;
  const body = useRef<HTMLDivElement>(null);
  const cta = useRef<HTMLButtonElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const plan =
    edited ??
    (kind === 'retake' && policy
      ? onboardingRetakePlan(content.questions, content.base, policy, initial, answers)
      : onboardingPlan(content.questions, content.base, answers));

  // Новый экран — с начала; на ПК фокус на основной кнопке (прототип: `.wl-foot .cta`).
  useEffect(() => {
    body.current?.closest('[data-window-body]')?.scrollTo({ top: 0 });
    if (!phone) cta.current?.focus({ preventScroll: true });
  }, [index, phone]);

  /** Опросник ещё не применён: закрыть — значит отложить (прототип: `ORG.onboard.later`). */
  const quizPending = kind === 'quiz' && !applied;
  const close = () => {
    if (quizPending) onPostpone(false);
    onClose();
  };

  const go = (step: number) => {
    const next = index + step;
    if (next < 0 || next >= screens.length) return;
    if (screen === 'quiz' && step > 0) setEdited(plan);
    setIndex(next);
  };

  const answer = (id: string, value: OnboardingAnswer) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setEdited(null);
  };

  const apply = async () => {
    if (!policy) return;
    setBusy(true);
    const res = await callApi(() =>
      api.api.onboarding.apply.$post({
        json: {
          answers,
          features: plan.features,
          taskConfirm: plan.taskConfirm,
          version: policy.version,
          again: kind === 'retake',
        },
      }),
    );
    if (!res.ok) {
      setBusy(false);
      if (res.error.code === 'record_changed') setChanged(true);
      else toast(errorText(res.error), { bad: true, icon: 'alert' });
      return;
    }
    const result = ApplyOnboardingResult.parse(res.data);
    props.onApplied();
    if (kind === 'retake') {
      setBusy(false);
      props.onRetakeDone(result);
      return;
    }
    // «Назад» на «Что будет включено» и второе «Применить» — с новой версией политики.
    const fresh = await client.fetchQuery({ ...policyQuery, staleTime: 0 }).catch(() => null);
    if (fresh) setPolicy(fresh);
    setBusy(false);
    setApplied(true);
    go(1);
  };

  const reload = async () => {
    setBusy(true);
    const fresh = await client.fetchQuery({ ...policyQuery, staleTime: 0 }).catch(() => null);
    setBusy(false);
    if (!fresh) return;
    setPolicy(fresh);
    setChanged(false);
    if (kind === 'retake') {
      setAnswers(onboardingAnswersOf(content.questions, fresh.features, fresh.taskConfirm));
      setEdited(null);
    }
  };

  // Свайп влево-вправо листает экраны на телефоне; на кнопках ответа и в полях — нет.
  const touchStart = (e: ReactTouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-segments],input,select,textarea')) return;
    const p = e.touches[0];
    touch.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const touchEnd = (e: ReactTouchEvent) => {
    const from = touch.current;
    const p = e.changedTouches[0];
    touch.current = null;
    if (!from || !p) return;
    const dx = p.clientX - from.x;
    const dy = p.clientY - from.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dy) > Math.abs(dx)) return;
    // Вперёд — только где есть «Далее»: «Применить» и последний экран свайпом не пропускаются.
    if (dx < 0 && (screen === 'plan' || index === screens.length - 1)) return;
    go(dx < 0 ? 1 : -1);
  };

  const quizAt = screens.indexOf('quiz');
  const later = quizPending && quizAt > index;
  const n = screens.length;

  return (
    <Modal
      open={open}
      onClose={close}
      kind="card"
      size="large"
      sticky
      label={t('onboarding.label')}
      title={
        <span className="flex items-center gap-2.5" data-welcome={kind}>
          <span
            className="flex gap-1.5"
            role="img"
            aria-label={t('onboarding.position_label', { n: index + 1, total: n })}
          >
            {screens.map((s, i) => (
              <span
                key={s}
                className={`h-2 rounded-full ${i === index ? 'w-[22px] bg-accent' : 'w-2 bg-line-strong'}`}
              />
            ))}
          </span>
          <span data-welcome-position="" className="text-[13px] font-normal text-muted">
            {t('onboarding.position', { n: index + 1, total: n })}
          </span>
        </span>
      }
      head={
        later ? (
          <button
            type="button"
            data-welcome-later=""
            title={t('onboarding.later_title')}
            className={buttonClass('ghost', 'sm')}
            onClick={() => {
              onPostpone(true);
              onClose();
            }}
          >
            {t('onboarding.later')}
          </button>
        ) : null
      }
      footer={
        <WelcomeFooter
          screen={screen}
          next={screens[index + 1] ?? null}
          index={index}
          busy={busy}
          taxes={taxes}
          ctaRef={cta}
          homeHref={props.homeHref}
          lessonsHref={props.lessonsHref}
          onGo={go}
          onApply={() => void apply()}
        />
      }
    >
      <div
        ref={body}
        data-welcome-screen={screen}
        onTouchStart={touchStart}
        onTouchEnd={touchEnd}
        className="flex flex-col gap-3.5"
      >
        {screen === 'hello' ? <HelloScreen content={content} /> : null}
        {screen === 'mods' ? (
          <ModsScreen
            content={content}
            mods={props.data.mods}
            access={access}
            own={own}
            modules={props.modules}
          />
        ) : null}
        {screen === 'quiz' ? (
          <QuizScreen
            content={content}
            again={kind === 'retake'}
            answers={answers}
            onAnswer={answer}
          />
        ) : null}
        {screen === 'plan' ? (
          <>
            {changed ? (
              <RecordChangedNotice
                message={t('err.record_changed')}
                reloadLabel={t('form.reload')}
                onReload={() => void reload()}
                reloading={busy}
              />
            ) : null}
            <PlanScreen content={content} plan={plan} onChange={setEdited} />
          </>
        ) : null}
        {screen === 'start' ? (
          <StartScreen content={content} lead={own && kind !== 'again'} />
        ) : null}
        {screen === 'taxes' ? (
          <>
            <ScreenHead title={content.tax.t} lead={content.tax.lead} />
            {catalog ? (
              <TaxPickList
                catalog={catalog}
                selected={taxes}
                setSelected={setTaxes}
                was={NOTHING}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

const NOTHING: ReadonlySet<string> = new Set();

/** Заголовок экрана и пояснение под ним (прототип `.wl-body h1`, `.wl-lead`). */
function ScreenHead({ title, lead }: { title: string; lead: string }) {
  return (
    <>
      <h1 className="m-0 text-[24px] leading-tight font-bold tracking-[-.02em] max-md:text-[21px]">
        {title}
      </h1>
      <p className="m-0 max-w-[680px] text-[15px] leading-[1.55] text-muted">{lead}</p>
    </>
  );
}

const iconOf = (name: string): IconName => (name in ICONS ? (name as IconName) : 'info');

/** Значок в синем квадрате (прототип `.wl-ic`). */
function WlIcon({ name }: { name: IconName }) {
  return (
    <span className="inline-grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] bg-info-bg text-info">
      <Icon name={name} />
    </span>
  );
}

const ITEM_TEXT = 'mt-[3px] mb-0 text-[13px] leading-[1.45] text-muted';

/** Экран 1 «Добро пожаловать»: три пункта и картинка интерфейса. */
function HelloScreen({ content }: { content: OnboardingContent }) {
  const t = useT();
  const s = content.s1;
  return (
    <>
      <div className="flex flex-col gap-2">
        <span className="mb-1.5 origin-left scale-[1.3] self-start">
          <BrandMark />
        </span>
        <ScreenHead title={s.t} lead={s.lead} />
      </div>
      <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        {s.points.map((p) => (
          <div key={p.t} className="flex items-start gap-2.5 rounded-xl bg-pane-alt p-3">
            <WlIcon name={iconOf(p.i)} />
            <div>
              <b>{p.t}</b>
              <p className={ITEM_TEXT}>{p.x}</p>
            </div>
          </div>
        ))}
      </div>
      <AppPicture t={t} />
    </>
  );
}

/** Картинка «Как выглядит программа» (прототип `.wl-pic`): модули, вкладки, плашки и список. */
function AppPicture({ t }: { t: Translate }) {
  const side: IconName[] = ['home', 'building', 'file', 'task', 'users', 'grad'];
  const rows = [
    ['row1', 'bg-warn-bg text-warn'],
    ['row2', 'bg-info-bg text-info'],
    ['row3', 'bg-ok-bg text-ok'],
  ] as const;
  return (
    <figure className="m-0 flex flex-col gap-1.5" aria-label={t('onboarding.pic.label')}>
      <div className="flex min-h-[170px] overflow-hidden rounded-xl border border-line bg-pane">
        <div className="flex flex-col gap-1.5 border-r border-line bg-pane-alt px-2 py-2.5">
          {side.map((x, i) => (
            <span
              key={x}
              className={`grid h-[30px] w-[30px] place-items-center rounded-lg ${i === 2 ? 'bg-nav-active text-ink' : 'text-muted'}`}
            >
              <Icon name={x} size="sm" />
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2.5 text-[12.5px] text-muted">
            <b className="text-[13.5px] text-ink">{t('onboarding.pic.title')}</b>
            <span>{t('onboarding.pic.week')}</span>
            <span>{t('onboarding.pic.overdue')}</span>
            <span className="ml-auto rounded-lg bg-accent px-2.5 py-[3px] font-semibold text-on-accent">
              {t('onboarding.pic.add')}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['3', 'plate_overdue', 'bg-danger-bg'],
                ['12', 'plate_week', 'bg-warn-bg'],
                ['5', 'plate_wait', 'bg-info-bg'],
              ] as const
            ).map(([n, key, tone]) => (
              <span
                key={key}
                className={`flex min-w-[92px] flex-col rounded-[9px] px-2.5 py-1.5 text-[11.5px] text-muted ${tone}`}
              >
                <b className="text-[17px] text-ink">{n}</b>
                {t(`onboarding.pic.${key}`)}
              </span>
            ))}
          </div>
          {rows.map(([row, tone]) => (
            <div
              key={row}
              className="grid grid-cols-[1.2fr_1.4fr_auto] items-center gap-2 border-t border-line px-0.5 py-[5px] text-[12.5px] max-md:grid-cols-[1fr_auto]"
            >
              <span>{t(`onboarding.pic.${row}.type`)}</span>
              <span className="max-md:hidden">{t(`onboarding.pic.${row}.cp`)}</span>
              <span className={`rounded-md px-2 py-px text-[11.5px] font-semibold ${tone}`}>
                {t(`onboarding.pic.${row}.status`)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <figcaption className="text-[12.5px] text-faint">{t('onboarding.pic.caption')}</figcaption>
    </figure>
  );
}

const PILL_BLUE = `${pillClass('sm')} flex-none self-center bg-info-bg text-info`;
const PILL_FAINT = `${pillClass('sm')} flex-none self-center bg-faint-pill-bg text-label shadow-[inset_0_0_0_1px_var(--bu-border)]`;
const PILL_GREEN = `${pillClass('sm')} flex-none self-center bg-ok-bg text-ok`;

/** Модуль или функция в сетке (прототип `.wl-mod`). */
function ModCard({
  icon,
  title,
  text,
  pill,
  small = false,
  id,
}: {
  icon?: IconName;
  title: string;
  text: string;
  pill?: ReactNode;
  small?: boolean;
  id: string;
}) {
  return (
    <div
      data-welcome-mod={id}
      className={`flex items-start gap-2.5 rounded-xl border border-line px-3 ${small ? 'py-2' : 'py-2.5'}`}
    >
      {icon ? <WlIcon name={icon} /> : null}
      <div className="min-w-0 grow">
        <b>{title}</b>
        <p className={ITEM_TEXT}>{text}</p>
      </div>
      {pill}
    </div>
  );
}

/**
 * Экран 2 «Модули»: у владельца — все модули с отметкой «Включён всегда», «Включён · можно выключить»
 * или «Можно включить» и функции внутри модулей; у сотрудника — только его модули, без отметок.
 */
function ModsScreen({
  content,
  mods,
  access,
  own,
  modules,
}: {
  content: OnboardingContent;
  mods: Record<string, string>;
  access: ShellAccess;
  own: boolean;
  modules: readonly string[];
}) {
  const t = useT();
  const always = new Set(content.always);
  const list = MENU_MODULES.filter((m) => own || modules.includes(m.id));
  const state = (id: string, feature: Feature | null) => {
    if (always.has(id))
      return (
        <span className={PILL_GREEN}>
          <Icon name="lock" size="sm" />
          {t('onboarding.mods.always')}
        </span>
      );
    if (feature && !access.feature(feature))
      return <span className={PILL_FAINT}>{t('onboarding.mods.can_on')}</span>;
    return <span className={PILL_BLUE}>{t('onboarding.mods.on')}</span>;
  };
  const inside = FEATURES.filter((f) => !MENU_MODULES.some((m) => m.feature === f));
  return (
    <>
      <ScreenHead title={content.s2.t} lead={own ? content.s2.lead : content.s2.leadStaff} />
      <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
        {list.map((m) => (
          <ModCard
            key={m.id}
            id={m.id}
            icon={MODULES[m.id].icon}
            title={t(MODULES[m.id].title)}
            text={mods[m.id] ?? t(MODULES[m.id].desc)}
            pill={own ? state(m.id, m.feature) : null}
          />
        ))}
        <ModCard
          id="profile"
          icon="user"
          title={t('profile.title')}
          text={mods.profile ?? ''}
          pill={own ? state('profile', null) : null}
        />
      </div>
      {own ? (
        <>
          <h3 className="m-0 mt-1.5 text-[14px] font-bold">{t('onboarding.mods.features')}</h3>
          <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
            {inside.map((f) => (
              <ModCard
                key={f}
                id={f}
                small
                title={t(`org.feature.${f}`)}
                text={t(`org.feature.${f}.benefit`)}
                pill={
                  access.feature(f) ? (
                    <span className={PILL_BLUE}>{t('onboarding.fx.on')}</span>
                  ) : (
                    <span className={PILL_FAINT}>{t('onboarding.mods.can_on')}</span>
                  )
                }
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

/** Экран 3 «Опросник»: «Да» / «Нет» / «Не знаю»; подвопрос — при «Да» на основной. */
function QuizScreen({
  content,
  again,
  answers,
  onAnswer,
}: {
  content: OnboardingContent;
  again: boolean;
  answers: OnboardingAnswers;
  onAnswer: (id: string, value: OnboardingAnswer) => void;
}) {
  const t = useT();
  const s = content.s3;
  const options = (['yes', 'no', 'unk'] as const).map((value) => ({
    value,
    label: t(`onboarding.answer.${value}`),
  }));
  const row = (q: { id: string; q: string; x: string }, sub: boolean) => (
    <div
      key={q.id}
      data-quiz-question={q.id}
      className={`grid grid-cols-[1fr_auto] items-center gap-3.5 rounded-xl border border-line px-3 py-2.5 max-md:grid-cols-1 max-md:gap-2 ${sub ? 'ml-7 bg-pane-alt max-md:ml-3.5' : ''}`}
    >
      <div className="min-w-0">
        <b>{q.q}</b>
        <p className={ITEM_TEXT}>{q.x}</p>
      </div>
      <div className="max-md:[&>div]:flex max-md:[&>div>button]:flex-1">
        <Segments
          options={options}
          value={answers[q.id] ?? 'unk'}
          onChange={(v) => onAnswer(q.id, v)}
          label={t('onboarding.answer')}
        />
      </div>
    </div>
  );
  return (
    <>
      <ScreenHead title={again ? s.tAgain : s.t} lead={again ? s.leadAgain : s.lead} />
      <div className="flex flex-col gap-2">
        {content.questions.flatMap((q) => [
          row(q, false),
          ...(q.sub && answers[q.id] === 'yes' ? [row(q.sub, true)] : []),
        ])}
      </div>
    </>
  );
}

/** Экран 4 «Что будет включено»: списки с переключателями и «Задачи требуют подтверждения». */
function PlanScreen({
  content,
  plan,
  onChange,
}: {
  content: OnboardingContent;
  plan: OnboardingPlan;
  onChange: (plan: OnboardingPlan) => void;
}) {
  const t = useT();
  const on = FEATURES.filter((f) => plan.features[f]);
  const off = FEATURES.filter((f) => !plan.features[f]);
  const item = (f: Feature) => {
    const needs = FEATURE_REQUIRES[f]?.[0];
    return (
      <CheckRow
        key={f}
        data-plan-feature={f}
        checked={plan.features[f]}
        onChange={(v) => onChange(onboardingPlanToggle(plan, f, v))}
        label={t(`org.feature.${f}`)}
      >
        <Hint>
          {t(`org.feature.${f}.benefit`)}
          {needs ? ` · ${t('org.feature.needs', { name: t(`org.feature.${needs}`) })}` : null}
        </Hint>
      </CheckRow>
    );
  };
  const always = content.always
    .map((id) =>
      t('onboarding.history.name', {
        name: id in MODULES ? t(MODULES[id as keyof typeof MODULES].title) : t('profile.title'),
      }),
    )
    .join(', ');
  return (
    <>
      <ScreenHead title={content.s3.planT} lead={content.s3.planLead} />
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <div className="flex flex-col" data-plan-on="">
          <h3 className="m-0 mt-1.5 text-[14px] font-bold">
            {t('onboarding.plan.on', { n: on.length })}
          </h3>
          {on.length ? (
            on.map(item)
          ) : (
            <span className="text-faint">{t('onboarding.plan.on_empty')}</span>
          )}
        </div>
        <div className="flex flex-col" data-plan-off="">
          <h3 className="m-0 mt-1.5 text-[14px] font-bold">
            {t('onboarding.plan.off', { n: off.length })}
          </h3>
          {off.length ? (
            off.map(item)
          ) : (
            <span className="text-faint">{t('onboarding.plan.off_empty')}</span>
          )}
        </div>
      </div>
      {plan.features.tasks ? (
        <CheckRow
          data-plan-task-confirm=""
          checked={plan.taskConfirm}
          onChange={(v) => onChange({ ...plan, taskConfirm: v })}
          label={t('org.policy.task_confirm')}
        >
          <Hint>{t('onboarding.plan.task_confirm_hint')}</Hint>
        </CheckRow>
      ) : null}
      <Note>{t('onboarding.plan.note', { list: always })}</Note>
    </>
  );
}

/** Первые три невыполненных шага программы, основные «★» — первыми (прототип wlFirst). */
function firstSteps(state: KbState | undefined): KbStep[] {
  const open = (state?.lessons ?? []).flatMap((l) => l.steps).filter((x) => !x.done);
  return [...open.filter((x) => x.star), ...open.filter((x) => !x.star)]
    .slice(0, 3)
    .sort((a, b) => open.indexOf(a) - open.indexOf(b));
}

/** Экран 5 «С чего начать»: первые три невыполненных шага программы, основные «★» — первыми. */
function StartScreen({ content, lead }: { content: OnboardingContent; lead: boolean }) {
  const t = useT();
  const state = useQuery(kbStateQuery).data;
  const s = content.s4;
  const first = firstSteps(state);
  return (
    <>
      <ScreenHead title={s.t} lead={lead ? s.lead : s.leadStaff} />
      {state ? (
        <ol className="m-0 flex list-decimal flex-col gap-2.5 pl-[22px]" data-welcome-steps="">
          {first.length ? (
            first.map((x) => (
              <li key={x.id} data-welcome-step={x.id}>
                <b>
                  {x.star ? '★ ' : ''}
                  {x.title}
                </b>
                <p className={ITEM_TEXT}>{x.why}</p>
              </li>
            ))
          ) : (
            <li>
              <b>{t('onboarding.start.all_done')}</b>
              <p className={ITEM_TEXT}>{t('onboarding.start.all_done_text')}</p>
            </li>
          )}
        </ol>
      ) : null}
      <div className="flex items-start gap-2.5 rounded-xl bg-pane-alt p-3">
        <WlIcon name="play" />
        <div>
          <b>{s.howT}</b>
          <p className={ITEM_TEXT}>{s.how}</p>
        </div>
      </div>
    </>
  );
}

/**
 * Нижняя строка: «Назад» и кнопки экрана (прототип wlRender → right, wlClick). Переходы закрывают окно
 * с заменой записи истории (`leave`): «Назад» телефона не вернёт к приветствию.
 */
function WelcomeFooter({
  screen,
  next,
  index,
  busy,
  taxes,
  ctaRef,
  homeHref,
  lessonsHref,
  onGo,
  onApply,
}: {
  screen: WelcomeScreen;
  next: WelcomeScreen | null;
  index: number;
  busy: boolean;
  taxes: ReadonlySet<string>;
  ctaRef: RefObject<HTMLButtonElement | null>;
  homeHref: string;
  lessonsHref: string;
  onGo: (step: number) => void;
  onApply: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const errorText = useErrorText();
  const router = useRouter();
  const refreshDicts = useDictsRefresh();
  const { leave } = useWindow();
  const [connecting, setConnecting] = useState(false);
  const kb = useKb();
  const state = useQuery(kbStateQuery).data;
  const to = (href: string) => {
    leave();
    router.replace(href);
  };
  // «Начать обучение»: «Уроки» и «Показать как» первого шага (прототип wlClick, `learn`).
  const learn = () => {
    const first = firstSteps(state)[0];
    to(lessonsHref);
    if (first) setTimeout(() => kb.show(first.id), SHOW_AFTER_GO_MS);
  };
  const cta = buttonClass('cta');
  const wide = 'max-md:min-h-[42px] max-md:flex-auto';

  const connect = async (then: () => void) => {
    setConnecting(true);
    const res = await callApi(() =>
      api.api['org-report-types'].connect.$post({
        json: { connect: [...taxes], disconnect: [] },
      }),
    );
    setConnecting(false);
    if (!res.ok) {
      toast(errorText(res.error), { bad: true, icon: 'alert' });
      return;
    }
    const done = OrgReportTypesConnected.parse(res.data);
    refreshDicts();
    toast(t('onboarding.tax.done', { n: done.connected }), { icon: 'check' });
    then();
  };

  let right: ReactNode;
  if (screen === 'quiz') {
    right = (
      <button ref={ctaRef} type="button" className={`${cta} ${wide}`} onClick={() => onGo(1)}>
        {t('onboarding.next_plan')}
      </button>
    );
  } else if (screen === 'plan') {
    right = (
      <button
        ref={ctaRef}
        type="button"
        data-welcome-apply=""
        className={`${cta} ${wide}`}
        disabled={busy}
        onClick={onApply}
      >
        <Icon name="check" size="sm" />
        {t('onboarding.apply')}
      </button>
    );
  } else if (screen === 'taxes') {
    const n = taxes.size;
    right = (
      <>
        <span className="text-muted" data-welcome-taxes="">
          {t('onboarding.tax.selected')} <b>{n}</b>
        </span>
        <button
          type="button"
          className={`${buttonClass('ghost')} ${wide}`}
          onClick={() => {
            toast(t('onboarding.tax.skipped'), { icon: 'info' });
            to(homeHref);
          }}
        >
          {t('onboarding.tax.skip')}
        </button>
        <button
          type="button"
          className={`${buttonClass()} ${wide}`}
          disabled={!n || connecting}
          onClick={() => void connect(() => to(homeHref))}
        >
          {t('onboarding.tax.self')}
        </button>
        <button
          ref={ctaRef}
          type="button"
          className={`${cta} ${wide}`}
          disabled={!n || connecting}
          onClick={() => void connect(learn)}
        >
          <Icon name="play" size="sm" />
          {t('onboarding.tax.learn')}
        </button>
      </>
    );
  } else if (screen === 'start' && next === 'taxes') {
    right = (
      <button ref={ctaRef} type="button" className={`${cta} ${wide}`} onClick={() => onGo(1)}>
        {t('onboarding.next_taxes')}
      </button>
    );
  } else if (screen === 'start') {
    right = (
      <>
        <button
          type="button"
          className={`${buttonClass('ghost')} ${wide}`}
          onClick={() => to(homeHref)}
        >
          {t('onboarding.self')}
        </button>
        <button ref={ctaRef} type="button" className={`${cta} ${wide}`} onClick={learn}>
          <Icon name="play" size="sm" />
          {t('onboarding.learn')}
        </button>
      </>
    );
  } else {
    right = (
      <button ref={ctaRef} type="button" className={`${cta} ${wide}`} onClick={() => onGo(1)}>
        {t('onboarding.next')}
      </button>
    );
  }
  return (
    <>
      {index > 0 ? (
        <button
          type="button"
          className={`${buttonClass('ghost')} ${wide}`}
          onClick={() => onGo(-1)}
        >
          {t('onboarding.prev')}
        </button>
      ) : null}
      <div className="flex-1 max-md:hidden" />
      {right}
    </>
  );
}
