'use strict';
// Ответы по запросу (поток Т, задача Т5; пакет заказчика 13.11.2026, идея 4 списка «Идеи для Telegram-бота»).
// Раньше на любое сообщение бот отвечал одной подсказкой. Теперь у бота меню команд — «Сегодня», «Неделя», «Просрочено», «Найти контрагента»: он отвечает в любой момент, не дожидаясь утра.
// В Telegram команды стоят в меню бота (/today, /week, /overdue, /find) и кнопками под полем ввода; в макете — строкой кнопок под перепиской.
// Правила:
//   — команды работают в чате, привязанном к учётной записи: из непривязанного бот отвечает прежней подсказкой «привяжите Telegram», заблокированной учётной записи — «Нет права»;
//   — «Сегодня», «Неделя», «Просрочено» — право «Просматривать отчёты»; отчёты — в области сотрудника «Свои / Все контрагенты», как в списке отчётов на сайте; контрагенты в архиве не показываются;
//   — «Найти контрагента» — право «Просматривать контрагентов» и область контрагентов; отчёты в карточке видит тот, у кого есть право на отчёты,
//     долг за обслуживание — тот, у кого есть право «Видеть плату за обслуживание»;
//   — команды ничего не меняют, поэтому работают и при выключенных «Действиях из Telegram»; в продукте входят в общий предел частоты нажатий;
//   — в таблице не больше 20 строк, остальное — строкой «ещё N — на сайте»; под ответом — кнопка, открывающая то же самое на сайте.
// Что показывают:
//   «Сегодня» — несданные отчёты со сроком сегодня (контрагент, отчёт, статус) и налоги, которые сегодня нужно оплатить;
//   «Неделя» — по дням с сегодняшнего до конца недели: сколько сдать и сколько оплатить; в строке итогов — и просроченное;
//   «Просрочено» — несданные отчёты и неоплаченные налоги с прошедшим сроком, сначала самые старые;
//   «Найти контрагента» — бот просит название или ИНН ответом на своё сообщение; один найденный — сразу карточка, несколько — кнопки с названиями (до 5), не найден — бот ждёт другой запрос.
//   Карточка: ответственный, с какого числа обслуживается, просроченные отчёты и отчёты со сроком в этом месяце (отчёт, срок, статус), долг за обслуживание.
const TG_FIND_MAX=5,TG_FIND_MIN=2,TG_FIND_Q_MAX=60;
// Команда: код, шаблон подписи, подпись по умолчанию, команда меню Telegram, право
const TG_CMDS=[['today','tgCmdToday','Сегодня','/today','repView'],['week','tgCmdWeek','Неделя','/week','repView'],['over','tgCmdOver','Просрочено','/overdue','repView'],['find','tgCmdFind','Найти контрагента','/find','cpView'],
  // Виджет «Мои отчёты на неделю» (задача Т9, tg-widget.js)
  ['widget','tgCmdWidget','Мои на неделю','/myweek','repView']];
const tgCmdLabel=c=>tgBtnT(c[1],c[2]);
// Строка кнопок меню под перепиской (в Telegram — кнопки под полем ввода)
const tgcMenuHtml=()=>`<div class="tgc-menu" role="group" aria-label="Меню команд бота">${TG_CMDS.map(c=>`<button type="button" class="tgc-k" data-tgc-cmd="${c[0]}" title="${c[3]}">${esc(tgCmdLabel(c))}</button>`).join('')}</div>`;
// Отчёты в области сотрудника, без архивных контрагентов
const tgScopeReps=()=>visReports().filter(r=>CPM[r.cp]&&!CPM[r.cp].archived);
const tgByCp=(a,b)=>CPM[a.cp].name.localeCompare(CPM[b.cp].name,'ru')||a.id-b.id;
const tgRepsBtn=tab=>[[{t:tgBtnT('tgBtnOpenReports','Открыть отчёты на сайте'),url:`${TG_SITE}/reports/${tab}`}]];

function tgTodayMsg(at){const rs=tgScopeReps(),sub=rs.filter(r=>tgRepOpen(r)&&r.due===TODAY).sort(tgByCp),pay=rs.filter(r=>tgPayOpen(r)&&r.payDue===TODAY).sort(tgByCp);
  const d=D(TODAY),day=`${d.getUTCDate()} ${MONTHS_G[d.getUTCMonth()]}`;
  if(!sub.length&&!pay.length)return {t:tplFill('tgTodayNone',{день:day}),at};
  const tables=[];
  if(sub.length)tables.push(Object.assign({head:['Контрагент','Отчёт','Статус']},tgRows(sub,r=>[CPM[r.cp].name,tgRepCell(r),r.status])));
  if(pay.length)tables.push(Object.assign({title:tplFill('tgSecPay',{}),open:!sub.length,head:['Контрагент','Отчёт','Оплата']},tgRows(pay,r=>[CPM[r.cp].name,tgRepCell(r),r.payStatus])));
  return {h:tplFill('tgTodayHead',{день:day}),sub:tplFill('tgTodaySub',{сдать:sub.length,оплатить:pay.length}),tables,at,btns:tgRepsBtn('week')}}

// «Неделя»: дни с сегодняшнего до конца недели, в которые есть что сдать или оплатить. В выходные неделя — следующая, как в сводке руководителю
function tgWeekDaysMsg(at){const[w0,w1]=weekRange(),days={},day=d=>days[d]||(days[d]={d,sub:0,pay:0}),v={даты:`${tgDM(w0)}–${tgDM(w1)}`};let n1=0,n2=0,n3=0;
  tgScopeReps().forEach(r=>{
    if(tgRepOpen(r)){if(r.due<TODAY)n3++;else if(r.due<=w1){day(r.due).sub++;n1++}}
    if(tgPayOpen(r)){if(r.payDue<TODAY)n3++;else if(r.payDue<=w1){day(r.payDue).pay++;n2++}}});
  const L=Object.values(days).sort((a,b)=>a.d<b.d?-1:1);
  if(!L.length&&!n3)return {t:tplFill('tgWeekNone',v),at};
  return {h:tplFill('tgWeekHead',v),sub:tplFill('tgWeekSub',{n1,n2,n3}),at,btns:tgRepsBtn('week'),
    tables:L.length?[{head:['День','Сдать','Оплатить'],num:[1,2],rows:L.map(x=>[`${DOW_S[(D(x.d).getUTCDay()+6)%7]}, ${tgDM(x.d)}`,String(x.sub),String(x.pay)])}]:[]}}

function tgOverMsg(at){const L=[];
  tgScopeReps().forEach(r=>{if(tgRepOpen(r)&&r.due<TODAY)L.push({r,due:r.due,pay:false});if(tgPayOpen(r)&&r.payDue<TODAY)L.push({r,due:r.payDue,pay:true})});
  L.sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:a.r.id-b.r.id);
  if(!L.length)return {t:tplFill('tgOverNone',{}),at};
  return {h:`${tplFill('tgSecOver',{})} · ${L.length}`,at,btns:tgRepsBtn('all'),
    tables:[Object.assign({head:['Контрагент','Отчёт','Срок'],num:[2]},tgRows(L,x=>[CPM[x.r.cp].name,tgRepCell(x.r)+(x.pay?' — оплата':''),tgDM(x.due)]))]}}

// Поиск контрагента: по части названия (без учёта регистра, «ё» = «е») или по началу ИНН; только в области сотрудника, без архивных
const tgFindNorm=s=>String(s||'').toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ').trim().slice(0,TG_FIND_Q_MAX);
function tgCpFind(q){const dg=/^\d+$/.test(q);return visCps().filter(c=>tgFindNorm(c.name).includes(q)||(dg&&String(c.inn||'').startsWith(q))).sort((a,b)=>a.name.localeCompare(b.name,'ru'))}
// Карточка контрагента одним сообщением
function tgCpMsg(c,at){
  const rs=can('repView')?tgScopeReps().filter(r=>r.cp===c.id&&!tR(r).payOnly&&((OPEN.has(r.status)&&r.due<TODAY)||r.due.slice(0,7)===TODAY.slice(0,7))).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:a.id-b.id):null;
  const fee=feat('fee')&&can('fee')&&c.kind!=='oneoff'?tplFill('tgCardDebt',{долг:c.feeDebt>0?`${fmtM(c.feeDebt)} сом за ${tgDebtMonths(c).length} мес.`:'нет'}):'';
  return {h:c.name,sub:tplFill('tgCardSub',{ответственный:empName(c.resp)||'не назначен',дата:fmtD(c.start)})+(c.paused?' · обслуживание приостановлено':''),
    t:[fee,rs&&!rs.length?tplFill('tgCardNoReports',{}):''].filter(Boolean).join('\n'),at,
    tables:rs&&rs.length?[Object.assign({head:['Отчёт','Срок','Статус'],num:[1]},tgRows(rs,r=>[tgRepCell(r),tgDM(r.due),r.status]))]:[],
    btns:[[{t:tgBtnT('tgBtnOpenCp','Открыть на сайте'),url:`${TG_SITE}/contractors?contractor=${c.id}`,go:()=>openCp(c)}]]}}
// Ответ на просьбу «напишите название или ИНН»: проверки те же, что у нажатия (tgRefusal); не найден или запрос короткий — бот ждёт другой ответ
tgAct('cpFind',{perm:'cpView',
  reply:(u,arg,p)=>{const q=tgFindNorm(p.text),at=bishkekNow().hm;if(q.length<TG_FIND_MIN)return {again:tplFill('tgFindShort',{n:TG_FIND_MIN})};
    const L=tgCpFind(q);if(!L.length)return {again:tplFill('tgFindNone',{})};
    if(L.length===1)return {msg:tgCpMsg(L[0],at)};
    return {msg:{t:tplFill(L.length>TG_FIND_MAX?'tgFindMore':'tgFindMany',{n:L.length,показано:TG_FIND_MAX}),at,btns:L.slice(0,TG_FIND_MAX).map(c=>[{t:tgClip(c.name,TG_BTN_T_MAX),act:'cpCard',arg:c.id,icon:'building'}])}}}});
// Кнопка с названием контрагента: карточка. Кнопка не гаснет — карточку можно запросить снова; контрагент ушёл из области или в архив — «Нет права»
tgAct('cpCard',{perm:'cpView',scope:(u,id)=>visCps().some(c=>c.id===+id),run:(u,id)=>({msg:tgCpMsg(CPM[+id],bishkekNow().hm)})});

// Команда меню: в переписке — сообщение человека и ответ бота. Отказ — обычным сообщением: скрытый ответ бывает только у нажатия кнопки под сообщением
function tgCmd(u,chat,id){const c=TG_CMDS.find(x=>x[0]===id);if(!c)return;const at=bishkekNow().hm,say=t=>chat.list.push({t,at});
  chat.list.push({me:true,t:tgCmdLabel(c),at});
  if(!u||!u.tg)return say(tplFill('tgStart',{}));
  if(u.active===false||u.id==='admin'||!feat('telegram')||!can(c[4]))return say(tplFill('tgActNoRight',{}));
  if(id==='widget')return tgWidgetCmd(u,chat,at);
  if(id!=='find')return chat.list.push({today:tgTodayMsg,week:tgWeekDaysMsg,over:tgOverMsg}[id](at));
  // Новая просьба отменяет прежнюю: бот ждёт один ответ
  chat.list.forEach(m=>{if(tgAskLive(m)&&m.ask.act==='cpFind')tgAskClose(m)});
  chat.list.push({t:tplFill('tgFindAsk',{}),at,ask:{act:'cpFind',arg:0,kind:'text',ph:'Название или ИНН',re:tgCmdLabel(c),day:TODAY},btns:[[{t:tgBtnT('tgBtnCancel','Отмена'),act:'askCancel',icon:'x'}]]})}
