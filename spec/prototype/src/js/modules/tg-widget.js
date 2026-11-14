'use strict';
// Виджет «Мои отчёты на неделю» (поток Т, задача Т9; пакет заказчика 13.11.2026, идея 5 списка «Идеи для Telegram-бота»).
// Виджет — маленький экран прямо в чате с ботом (виджеты Telegram, Bot API 10.4 от 09.11.2026): список своих отчётов на неделю, переключение по дням
// и отметка «Сдан» галочкой. Новых сообщений при этом нет: экран обновляется сам.
// Правила:
//   — бот присылает виджет по команде «Мои на неделю» (/myweek) из меню бота (задача Т5) — в личном чате, привязанном к учётной записи, с правом
//     «Просматривать отчёты»; иначе — те же отказы, что у других команд. Виджеты Telegram показывает только в личных чатах;
//   — в виджете — отчёты, где сотрудник ответственный: несданные с прошедшим сроком («Просрочено») и со сроком до конца недели (в выходные — следующей,
//     как у «Неделя»), без контрагентов в архиве. Вкладки: «Просрочено» и дни с сегодняшнего; число на вкладке — сколько осталось сдать.
//     Не больше 12 отчётов (размер виджета ограничен Telegram): сначала отчёты недели, просроченных — не меньше 4 самых давних; остальное — строкой
//     «ещё N — на сайте» и кнопкой «Открыть отчёты на сайте»;
//   — галочка — то же, что кнопка «Сдан» под напоминанием (задача Т2): те же проверки (право «Менять статус», область «Свои / Все», «Действия из Telegram»,
//     отчёт ещё не сдан), то же «нельзя из чата» (сумма налога, оплата, деньги). Нужен файл — бот просит прислать его ответом в чате, отчёт сдаётся,
//     когда файл пришёл. Итог нажатия виджет показывает короткой строкой внизу — её видит только сам сотрудник;
//   — виджет обновляется без новых сообщений: после каждой галочки, по кнопке «Обновить» и каждое утро во «Время сводки» организации.
//     Бот обновляет только последний присланный виджет: прежний показывает «Экран устарел» — так в чате не висят два разных списка;
//   — старое приложение Telegram виджет не показывает, а выводит подпись под ним: в ней — сколько сдать и сколько просрочено и подсказка обновить Telegram.
//     Кто включил «Сообщения простым текстом» в «Мой профиль» (или если таблицы выключены в Админке), получает вместо виджета ответ команды «Неделя»;
//   — виджет нельзя переслать и скопировать (так его отправляет Telegram) — список не уйдёт из чата.
// Тексты — шаблоны «Справочников платформы» (tgWg…, tgCmdWidget, tgBtnWgRefresh).
const TG_WG_MAX=12;
// Список виджета: свои несданные отчёты с прошедшим сроком и со сроком до конца недели
function tgWgList(u){const[,w1]=weekRange();
  return REPORTS.filter(r=>r.resp===u.id&&CPM[r.cp]&&!CPM[r.cp].archived&&tgRepOpen(r)&&r.due<=w1).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:a.id-b.id)}
// Снимок списка: какие отчёты в виджете (в Telegram — данные виджета, до 1 КБ), сколько всего сдать на неделе и просрочено, когда обновлён.
// Не помещается всё — сначала отчёты недели, просроченных не меньше TG_WG_OVER (самые давние); остальное — «ещё N — на сайте»
const TG_WG_OVER=4;
function tgWgSnap(u,w){const L=tgWgList(u),over=L.filter(r=>r.due<TODAY),week=L.filter(r=>r.due>=TODAY);
  const nOver=Math.min(over.length,Math.max(TG_WG_OVER,TG_WG_MAX-week.length)),pick=[...over.slice(0,nOver),...week.slice(0,TG_WG_MAX-nOver)];
  w.items=pick.map(r=>r.id);w.more=L.length-pick.length;w.n1=week.length;w.n3=over.length;w.at=bishkekNow().hm;w.note=''}
// Вкладки: «Просрочено» (если есть) и дни с сегодняшнего до конца недели; выходные — только если в них есть отчёты
function tgWgTabs(w){const[,w1]=weekRange(),R=w.items.map(tgRepOf).filter(Boolean),T=[];
  const over=R.filter(r=>r.due<TODAY);if(over.length)T.push({k:'over',t:tplFill('tgWgOver',{}),rs:over});
  for(let d=TODAY;d<=w1;d=addDays(d,1)){const rs=R.filter(r=>r.due===d),wd=(D(d).getUTCDay()+6)%7;if(wd<5||rs.length)T.push({k:d,t:`${DOW_S[wd]} ${tgDM(d)}`,rs})}
  return T}
const tgWgLeft=rs=>rs.filter(tgRepOpen).length;
function tgWgCaption(u,w){const[w0,w1]=weekRange();return tplFill('tgWgCaption',{даты:`${tgDM(w0)}–${tgDM(w1)}`,сдать:w.n1,просрочено:w.n3})}
// Сообщение-виджет. m.wg: {uid, items, more, at, sel — открытая вкладка, note — строка итога нажатия, old — прислан новый виджет}
function tgWidgetMsg(u,at){const w={uid:u.id};tgWgSnap(u,w);return {wg:w,at}}
function tgcWidget(m,i,plain){const w=m.wg,u=EM[w.uid]||me(),[w0,w1]=weekRange();
  // Старое приложение Telegram (в макете — «Показать простым текстом»): вместо экрана — подпись
  if(plain)return `<div class="tgc-m"><div class="tgc-b"><p class="tgc-sub">${ic('alert','sm')} Сообщение не поддерживается вашей версией Telegram</p><p>${esc(tgWgCaption(u,w))}</p><span class="tgc-at">${esc(m.at||'')}</span></div></div>`;
  if(w.old)return `<div class="tgc-m"><div class="tgc-b tgw"><p class="tgw-old">${ic('hourglass','sm')}${esc(tplFill('tgWgOld',{}))}</p></div></div>`;
  const T=tgWgTabs(w),cur=T.find(x=>x.k===w.sel)||T.find(x=>x.k==='over')||T.find(x=>x.k===TODAY&&x.rs.length)||T.find(x=>x.rs.length)||T[0];
  const tabs=T.map(x=>{const n=tgWgLeft(x.rs);return `<button type="button" class="tgw-tab${x===cur?' on':''}${x.k==='over'?' over':''}" data-tgw="${i}:tab:${x.k}">${esc(x.t)}${n?`<span>${n}</span>`:''}</button>`}).join('');
  const rows=cur&&cur.rs.length?cur.rs.map(r=>{const done=!tgRepOpen(r);return `<div class="tgw-row${done?' done':''}"><button type="button" class="tgw-chk" data-tgw="${i}:tick:${r.id}" ${done?'disabled':''} aria-label="Сдан: ${esc(tgRepFull(r))}">${done?ic('check','sm'):''}</button><span class="tgw-t"><b>${esc(CPM[r.cp].name)}</b><span>${esc(tgRepCell(r))} · ${esc(done?r.status:r.due<TODAY?`срок ${tgDM(r.due)}`:r.status)}</span></span></div>`}).join('')
    :`<p class="tgw-none">${esc(tplFill('tgWgNone',{}))}</p>`;
  return `<div class="tgc-m"><div class="tgc-b tgw"><div class="tgw-h"><b>${esc(tplFill('tgWgHead',{даты:`${tgDM(w0)}–${tgDM(w1)}`}))}</b><span>${esc(tplFill('tgWgUpd',{время:w.at}))}</span></div>
    <div class="tgw-tabs" role="tablist">${tabs}</div><div class="tgw-list">${rows}</div>${w.more?`<p class="tgw-more">${esc(tplFill('tgWgMore',{n:w.more}))}</p>`:''}
    ${w.note?`<p class="tgw-note" role="status">${esc(w.note)}</p>`:''}<div class="tgw-foot"><button type="button" class="tgc-k" data-tgw="${i}:upd:0">${ic('refresh','sm')}<span>${esc(tgBtnT('tgBtnWgRefresh','Обновить'))}</span></button><button type="button" class="tgc-k" data-tgw="${i}:site:0">${ic('link','sm')}<span>${esc(tgBtnT('tgBtnOpenReports','Открыть отчёты на сайте'))}</span></button></div></div><span class="tgc-at">${esc(m.at||'')}</span></div>`}
// Нажатие внутри виджета. В Telegram виджет шлёт боту короткий запрос, бот проверяет и отвечает строкой итога и новыми данными виджета
function tgWgPress(u,chat,m,kind,arg){const w=m.wg;if(w.old)return;
  if(kind==='tab'){w.sel=arg;w.note='';return}
  if(kind==='upd'){tgWgSnap(u,w);return}
  if(kind==='site'){toast('В Telegram виджет откроет сайт: '+TG_SITE+'/reports/week','link');return}
  if(kind!=='tick')return;
  const a=TG_ACTS.repDone,no=tgRefusal(u,a,arg);if(no){w.note=no;return}
  const r=a.run(u,arg,m,{})||{};
  if(r.ask){const x=tgRepOf(arg);
    if(!chat.list.some(y=>tgAskLive(y)&&y.ask.act===r.ask.act&&String(y.ask.arg)===String(r.ask.arg)))
      chat.list.push({t:r.ask.t,at:bishkekNow().hm,ask:Object.assign({day:TODAY},r.ask),btns:[[{t:tgBtnT('tgBtnCancel','Отмена'),act:'askCancel',icon:'x'}]]});
    w.note=tplFill('tgWgFile',{отчёт:tgRepFull(x)});return}
  w.note=r.eph&&!r.done?r.eph:tplFill('tgWgDone',{отчёт:tgRepFull(tgRepOf(arg))})}
// Команда «Мои на неделю»: прежние виджеты этого чата устаревают; простой текст — ответ «Неделя»
function tgWidgetCmd(u,chat,at){if(chat.plain||tgIsPlain(u))return chat.list.push(tgWeekDaysMsg(at));
  chat.list.forEach(x=>{if(x.wg)x.wg.old=true});chat.list.push(tgWidgetMsg(u,at))}
