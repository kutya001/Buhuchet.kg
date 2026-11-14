'use strict';
// Таблицы в сообщениях бота (поток Т, задача Т3; пакет заказчика 13.11.2026, идеи 2, 8 и 10 списка «Идеи для Telegram-бота»):
//   утреннее напоминание — таблицей с раскрывающимися разделами; сводка недели руководителю — таблицей по сотрудникам с кнопкой «Напомнить»;
//   долги за обслуживание — свёрнутым разделом той же сводки с кнопками «Скопировать напоминание».
// Заголовки, названия разделов, подписи кнопок и скрытые ответы — шаблоны «Справочников платформы»; столбцы таблиц и их порядок задаёт продукт.
// Столбцы с числами и со сроком («20.11») не переносятся и прижаты вправо (num) — так таблица читается на телефоне.
// В таблице не больше 20 строк (долгов — 10): остальное — строкой «ещё N — на сайте», счётчик раздела показывает, сколько записей всего.
const TG_ROWS_MAX=20,TG_DEBT_MAX=10,TG_NUDGE_MAX=3,TG_FEE_COPY_MAX=3,TG_COPY_MAX=256,TG_BTN_T_MAX=64;
const TG_WD_ACC=['воскресенье','понедельник','вторник','среду','четверг','пятницу','субботу'];
const tgDayWords=iso=>{const d=D(iso);return `${TG_WD_ACC[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_G[d.getUTCMonth()]}`};
const tgClip=(s,n)=>s.length>n?s.slice(0,n-1)+'…':s;
// Период коротко, чтобы столбец «Отчёт» помещался на телефоне: «окт.», «III кв.»; год — только если он не текущий
function tgPerShort(r){let s=String(r.phuman||'');MONTHS.forEach(m=>{s=s.replace(new RegExp('^'+m+'(?= |$)','i'),m.length>3?m.slice(0,3)+'.':m)});
  return s.replace(' квартал',' кв.').replace(' '+TODAY.slice(0,4),'').replace(/ год$/,'')}
const tgRepCell=r=>`${T[r.t].short}, ${tgPerShort(r)}`;
// Строки таблицы: первые max, остальное — строкой «ещё N — на сайте»; n — сколько записей всего
function tgRows(list,cells,max=TG_ROWS_MAX){const o={n:list.length,rows:list.slice(0,max).map(cells)};if(list.length>max)o.foot=[`ещё ${list.length-max} — на сайте`,...o.rows[0].slice(1).map(()=>'')];return o}
// Налог к оплате: срок оплаты впереди, сумма не закрыта — как строка «Через N дн. срок оплаты налога»
const tgPayOpen=r=>feat('taxpay')&&!r.superseded&&['Не оплачено','Оплачено частично'].includes(r.payStatus)&&r.sum>0&&!!r.payDue;

// Идея 2. Утреннее напоминание таблицей: заголовок «Отчёты на пятницу, 20 ноября», строка итогов и разделы «Просрочено», «Сегодня», «Через N дн.», «Оплата налогов».
// «Просрочено» и «Сегодня» раскрыты, остальное свёрнуто; если срочного нет — раскрыт первый раздел. Простой текст — прежние строки напоминания (o.plain).
// В продукте в раздел «Оплата налогов» попадают и оплата сегодня, и просроченная оплата; остальные строки дня (ждут подтверждения, задачи) идут текстом над таблицами, как раньше.
function tgMornMsg(o,at){const HEAD=['Контрагент','Отчёт','Срок'],row=r=>[CPM[r.cp].name,tgRepCell(r),tgDM(r.due)],prow=r=>[CPM[r.cp].name,tgRepCell(r),tgDM(r.payDue)];
  const sec=(title,rs,cells,open)=>rs.length?[Object.assign({title,open,head:HEAD,num:[2]},tgRows(rs,cells))]:[];
  const days=Object.keys(o.by).sort((a,b)=>a-b),soon=days.reduce((n,d)=>n+o.by[d].length,0),urgent=o.ov.length+o.td.length>0;
  const tables=[...sec(tplFill('tgSecOver',{}),o.ov,row,true),...sec(tplFill('tgSecToday',{}),o.td,row,true),
    ...days.flatMap(d=>sec(tplFill('tgSecBefore',{дней:d}),o.by[d],row,false)),...sec(tplFill('tgSecPay',{}),o.pay,prow,false)];
  if(!urgent&&tables[0])tables[0].open=true;
  return {h:tplFill('tgMornHead',{день:tgDayWords(TODAY)}),sub:tplFill('tgMornSub',{просрочено:o.ov.length,сегодня:o.td.length,скоро:soon,оплата:o.pay.length}),tables,plain:o.plain,at}}

// Идея 8. Сводка недели руководителю (владелец и главный бухгалтер, у кого включена «Сводка за неделю по понедельникам»): по сотрудникам — сколько сдать до конца недели,
// сколько просрочено (сдача и оплата налога) и сколько сдач ждут подтверждения. Отчёты — в области получателя; сотрудники с просроченным — первыми.
const tgNotifyOn=(u,k)=>{const n=notifyOf(u);return !n.off[k]&&(n.mode==='all'||(n.mode==='digest'&&['over','tasks','week'].includes(k))||(n.mode==='manual'&&k==='tasks'))};
const tgIsBoss=u=>u.role==='owner'||u.role==='chief';
// Просроченное сотрудника: несданные отчёты со сроком в прошлом и неоплаченные налоги с прошедшим сроком оплаты
function tgOverOf(id){const L=[];REPORTS.forEach(r=>{if(r.superseded||r.resp!==id||CPM[r.cp].archived)return;
  if(tgRepOpen(r)&&r.due<TODAY)L.push({r,due:r.due,pay:false});if(tgPayOpen(r)&&r.payDue<TODAY)L.push({r,due:r.payDue,pay:true})});
  return L.sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:a.r.id-b.r.id)}
function tgWeekRows(){const[,w1]=weekRange(),E={},at=id=>E[id||'']||(E[id||'']={id:id||'',sub:0,over:0,wait:0});let n1=0,n2=0,n3=0;
  visReports().forEach(r=>{if(CPM[r.cp].archived)return;
    if(tgRepOpen(r)){if(r.due<TODAY){at(r.resp).over++;n3++}else if(r.due<=w1){at(r.resp).sub++;n1++}}
    if(tgPayOpen(r)){if(r.payDue<TODAY){at(r.resp).over++;n3++}else if(r.payDue<=w1)n2++}
    if(repWait(r))at(r.resp).wait++});
  const name=x=>x.id?empName(x.id)||'—':'Без ответственного';
  const rows=Object.values(E).filter(x=>x.sub||x.over||x.wait).sort((a,b)=>b.over-a.over||b.sub-a.sub||name(a).localeCompare(name(b),'ru'));
  return {rows,name,n1,n2,n3}}
// Идея 10. Долги за обслуживание — свёрнутый раздел сводки: видит тот, у кого есть право «Оплата за обслуживание»; контрагенты — в его области, самые большие долги первыми
const tgDebtMonths=c=>feeMonths(c).filter(m=>feeDue(c,m)<=TODAY&&(feeCharge(c,m)-feeGot(c,m))>0);
function tgDebtors(){return feat('fee')&&can('fee')?visCps().filter(c=>c.feeDebt>0).sort((a,b)=>b.feeDebt-a.feeDebt||a.name.localeCompare(b.name,'ru')):[]}
// Текст напоминания о долге — тот же, что открывает «Напомнить в WhatsApp» (шаблон «WhatsApp: долг за обслуживание»). Кнопка Telegram копирует не больше 256 знаков:
// не помещается с реквизитами — без реквизитов; всё равно длинно — месяцы числом («за 4 мес.»); и так не помещается — кнопки у этого контрагента нет
function tgFeeNote(c){const ms=tgDebtMonths(c),m=ms[ms.length-1],acc=orgMain('fee'),fr=acc?rqTxt(acc):'';
  const date=(()=>{const d=m?mkDate(+m.slice(0,4),+m.slice(5,7)+1,c.feeDay):TODAY;return fmtD(d<TODAY?addDays(TODAY,1):d)})();
  const make=(months,req)=>{const t=TPL.waFee.replaceAll('{контрагент}',c.name).replaceAll('{месяц}',months).replaceAll('{сумма}',som(c.feeDebt)).replaceAll('{дата}',date).replaceAll('{реквизиты}',req||'—');
    return req&&!TPL.waFee.includes('{реквизиты}')?`${t} Реквизиты для оплаты: ${req}.`:t};
  const full=ms.map(ymLabel).join(', ');
  return [make(full,fr),make(full,''),make(`${ms.length} мес.`,'')].find(t=>t.length<=TG_COPY_MAX)||''}
function tgWeekMsg(u,at){const[w0,w1]=weekRange(),W=tgWeekRows(),debt=tgDebtors(),conf=repConfOn();if(!W.rows.length&&!debt.length)return null;
  const tables=[],btns=[];
  if(W.rows.length)tables.push(Object.assign({head:['Сотрудник','Сдать','Просроч.',...(conf?['Ждут']:[])],num:[1,2,3]},tgRows(W.rows,x=>[W.name(x),String(x.sub),String(x.over),...(conf?[String(x.wait)]:[])])));
  // «Напомнить» — у первых трёх сотрудников с просроченным (себе не напоминают)
  W.rows.filter(x=>x.id&&x.id!==u.id&&x.over>0).slice(0,TG_NUDGE_MAX).forEach(x=>btns.push([{t:tgClip(tplFill('tgBtnNudge',{сотрудник:W.name(x),n:x.over}),TG_BTN_T_MAX),act:'nudge',arg:x.id,icon:'bell'}]));
  if(debt.length){const total=debt.reduce((s,c)=>s+c.feeDebt,0);
    tables.push({title:tplFill('tgSecDebt',{}),open:false,n:debt.length,head:['Контрагент','Долг, сом','Мес.'],num:[1,2],rows:debt.slice(0,TG_DEBT_MAX).map(c=>[c.name,fmtM(c.feeDebt),String(tgDebtMonths(c).length)]),
      foot:[debt.length>TG_DEBT_MAX?`Всего у ${debt.length} контрагентов`:'Всего',fmtM(total),'']});
    debt.slice(0,TG_FEE_COPY_MAX).forEach(c=>{const note=tgFeeNote(c);if(note)btns.push([{t:tgClip(tplFill('tgBtnFeeCopy',{контрагент:c.name}),TG_BTN_T_MAX),copy:note,copied:'Напоминание скопировано'}])})}
  return {h:tplFill('tgWeekHead',{даты:`${tgDM(w0)}–${tgDM(w1)}`}),sub:tplFill('tgWeekSub',{n1:W.n1,n2:W.n2,n3:W.n3}),tables,btns,at}}

// «Напомнить»: сотрудник получает сообщение со списком своего просроченного. Напомнить может тот, кто видит отчёты всех сотрудников; одному сотруднику — раз в день, кто бы ни нажал.
// Данные кнопка не меняет, поэтому работает и при выключенных «Действиях из Telegram». Сообщение сотруднику — в журнале «Телеграм» и в его чате с ботом
function tgNudgeMsg(u,at){const L=tgOverOf(u.id),by=u.nudge&&EM[u.nudge.by];
  return {t:tplFill('tgNudge',{кто:by?by.short:'Руководитель',n:L.length}),tables:[Object.assign({head:['Контрагент','Отчёт','Срок'],num:[2]},tgRows(L,x=>[CPM[x.r.cp].name,tgRepCell(x.r)+(x.pay?' — оплата':''),tgDM(x.due)]))],at,
    btns:[[{t:tgBtnT('tgBtnOpenReports','Открыть отчёты на сайте'),url:`${TG_SITE}/reports/all`}]]}}
tgAct('nudge',{scope:(u,id)=>seeAll('reports')&&!!EM[id]&&EM[id].active!==false&&id!==u.id,stale:(u,id)=>!tgOverOf(id).length,
  run:(u,id)=>{const e=EM[id],v={сотрудник:e.short,n:tgOverOf(id).length};
    if(!e.tg)return {eph:tplFill('tgActNudgeNoTg',v)};
    if(e.nudge&&e.nudge.day===TODAY)return {eph:tplFill('tgActNudgeWait',v)};
    e.nudge={day:TODAY,by:u.id,at:bishkekNow().hm};TG_LOG.unshift({id:TG_LOG.length+1,at:nowStamp(),to:e.short+' '+e.tg,org:ORG.name,kind:'Напоминание о просроченном',st:'Ожидает',tries:0,err:''});
    return {done:'✓ Напомнили',eph:tplFill('tgActNudgeOk',v)}}});
