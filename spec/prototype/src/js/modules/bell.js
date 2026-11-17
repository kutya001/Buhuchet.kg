'use strict';
// Колокольчик уведомлений: что в него попадает (пакет 16.11.2026, блок 3; поток Т). Значок, счётчик и панель — поток И: строки берутся
// только отсюда — bellItems, bellUnseen, bellSeenAll, bellRead, bellReadAll; о новой строке панель узнаёт через bellOnChange.
// Стык «Положить уведомление» — bellPut(кому, строка); в продукте — putBell в транзакции события.
// Попадает всё, что человек получает в Telegram, по тем же правилам, получателям и настройкам профиля, и опубликованные новости.
// Колокольчик работает и без привязанного Telegram, и при выключенных «Напоминаниях в Telegram» (по умолчанию).
// Одно событие — одна строка у человека: строка с тем же ключом второй раз не кладётся. Видно только то, что человек видит по правам
// сейчас: сняли право или контрагента скрыли — строки нет. Строки хранятся 90 дней (по умолчанию).
// Не попадают (по умолчанию): коды (восстановление пароля, привязка и замена Telegram, «Задать пароль»), сообщения о своём Telegram
// и пароле, ответы бота на действия в чате и сообщения в общий чат фирмы.

const BELL_DAYS=90;
// Новости и заявки — с появления колокольчика (по умолчанию): уже выпущенные новости остаются в «Новостях», счётчик ими не забит
const BELL_FROM='2026-11-16';
// Кнопки-фильтры панели; «Другое» — только во «Все»
const BELL_KINDS={reports:'Отчёты',tasks:'Задачи',files:'Файлы',money:'Деньги',news:'Новости',other:'Другое'};
const BELL=DB.bell;
let bellOnChange=null;
const bellNextId=()=>'b'+(BELL.reduce((a,x)=>Math.max(a,+String(x.id).slice(1)||0),0)+1);

// Строка: kind — фильтр панели, ev — вид события, cp — контрагент (имя берётся при чтении), need — право, без которого строки не видно,
// open — что открыть {k, id} (виды — bell-contract.md потока Т), text — что случилось одной фразой, key — ключ события
function bellPut(uid,o,quiet){if(!uid||!o||!o.key||!o.text||BELL.some(x=>x.uid===uid&&x.key===o.key))return false;
  BELL.unshift({id:bellNextId(),uid,kind:BELL_KINDS[o.kind]?o.kind:'other',ev:o.ev||'',cp:o.cp??null,need:o.need||null,open:o.open||null,text:String(o.text).slice(0,1000),
    at:o.at||nowStamp(),key:o.key,seen:!!o.seen,read:!!o.read});
  dbSoon();if(!quiet&&bellOnChange)bellOnChange();return true}
const bellPutAll=(uids,o)=>[...new Set(uids.filter(Boolean))].forEach(u=>bellPut(u,o));
// Ключ разового события: два одинаковых события подряд — две строки, повтор того же — одна
let BELL_SEQ=0;const bellOnce=k=>`${k}:${Date.now().toString(36)}${(++BELL_SEQ).toString(36)}`;

// Кому о событии контрагента: тому, кому ушло в Telegram (ответственный; без него или без его Telegram — первый владелец с Telegram),
// и ответственному, даже если у него нет Telegram; нет ни того, ни другого — первому владельцу (по умолчанию)
function bellCpTo(c){const r=EM[c.resp],resp=r&&r.active!==false?r.id:null,tg=typeof pgTgStaff==='function'?pgTgStaff(c):null,
  own=EMP.find(e=>e.role==='owner'&&e.active!==false);return [...new Set([resp,tg&&tg.id,!resp&&!tg&&own?own.id:null].filter(Boolean))]}
function bellCp(c,o){if(c)bellPutAll(bellCpTo(c),{cp:c.id,...o})}

// Задачи и возврат отчёта — как сообщения Telegram о событиях (продукт: queueTelegramEvents): себе не пишется, заблокированному тоже,
// переключатели профиля «Ручные задачи» и «Возврат моих отчётов на исправление» (до 17.11.2026 — «Регулярные задачи по отчётам», ключ regtasks прежний)
const BELL_TASK={new:'Новая задача',conf:'Ждёт подтверждения',ok:'Задача подтверждена',rework:'Задача на доработке',cancel:'Задача отменена',
  start:'Задача взята в работу',done:'Задача выполнена'};
function bellTo(to,k){const u=EM[to];return !!u&&to!==S.me&&u.active!==false&&tgNotifyOn(u,k)}
function bellTask(t,ev,to,why){if(!t||!bellTo(to,'tasks'))return;
  bellPut(to,{kind:'tasks',ev:'task_'+ev,cp:t.cp||null,open:{k:'task',id:t.id},text:`${BELL_TASK[ev]}: ${t.title}${why?`. Причина: ${why}`:''}`,key:bellOnce(`task_${ev}:${t.id}`)})}
function bellFix(r){if(!r||!bellTo(r.resp,'regtasks'))return;
  bellPut(r.resp,{kind:'reports',ev:'report_fix',cp:r.cp,open:{k:'report',id:r.id},text:`На исправление: ${tgRepName(r)}${r.fixWhy?`. Причина: ${r.fixWhy}`:''}`,key:bellOnce(`report_fix:${r.id}`)})}

// Строки по расписанию — у того, кто сейчас вошёл: в продукте их кладёт задача напоминаний в час напоминаний, в макете — при первом
// открытии за день (время строки — час напоминаний, если он уже наступил). Одна строка в день, как одно утреннее сообщение Telegram.
const bellDayAt=()=>{const a=tgnAt(),n=bishkekNow().hm;return TODAY+' '+(a<n?a:n)};
const bellWd=iso=>D(iso).getUTCDay()||7;
function bellDayText(m){const pl=(n,a,b,c)=>`${n} ${plural(n,a,b,c)}`,today=[m.td.length?pl(m.td.length,'отчёт','отчёта','отчётов'):'',m.pay.length?pl(m.pay.length,'оплата','оплаты','оплат'):''].filter(Boolean);
  return `Сроки на сегодня: ${today.join(', ')||'нет'}${m.ov.length?`; просрочено ${m.ov.length}`:''}${m.bf.length?`; скоро ${m.bf.length}`:''}`}
function bellStaffDay(u){const at=bellDayAt(),m=tgMine(u);
  if(m.mine.length||m.pay.length)bellPut(u.id,{kind:'reports',ev:'day_dues',need:'repView',open:{k:'reports_day',id:TODAY},text:bellDayText(m),key:'day_dues:'+TODAY,at},true);
  if(can('repConfirm')){const w=repWaitList().filter(r=>!tgConfOwn(r)&&!CPM[r.cp].archived).length;
    if(w)bellPut(u.id,{kind:'reports',ev:'conf_wait',need:'repConfirm',open:{k:'reports_tab',id:'wait'},text:`Ждут подтверждения сдачи: ${w}`,key:'conf_wait:'+TODAY,at},true)}
  if(tgIsBoss(u)&&tgNotifyOn(u,'week')&&bellWd(TODAY)===tgnWeekDay()){const W=tgWeekRows(),sub=W.rows.reduce((a,x)=>a+x.sub,0),ov=W.rows.reduce((a,x)=>a+x.over,0),debt=tgDebtors().length;
    if(W.rows.length||debt)bellPut(u.id,{kind:'reports',ev:'week',need:'repView',open:{k:'reports_tab',id:'week'},text:`Сводка недели: сдать ${sub}, просрочено ${ov}${debt?`, должников за обслуживание ${debt}`:''}`,key:'week:'+TODAY,at},true)}}
// Новости — у каждого, кто их видит; прочитанная в «Новостях» — прочитана и здесь (и наоборот: bellRead)
// Новости и заявки старше 90 дней в колокольчик не кладутся: bellClean убрал бы их строку, а следующий bellSync вернул бы снова (как в продукте)
const bellFrom=()=>{const l=addDays(TODAY,-BELL_DAYS);return l>BELL_FROM?l:BELL_FROM};
function bellNews(uid){const rd=newsRead(uid),from=bellFrom();
  newsVis().filter(n=>n.date>=from).forEach(n=>{const r=rd.has(n.id);bellPut(uid,{kind:'news',ev:'news',open:{k:'news',id:n.id},text:n.t,key:'news:'+n.id,at:n.date+' 09:00',seen:r,read:r},true)});
  BELL.forEach(x=>{if(x.uid===uid&&x.ev==='news'&&!x.read&&x.open&&rd.has(x.open.id))x.read=x.seen=true})}
// Режим Админка: новые заявки с лендинга (и новости «Только режим Админка» — через bellNews)
function bellLeads(){const from=bellFrom();LEADS.filter(l=>l.status==='Новая'&&(l.at||'').slice(0,10)>=from).forEach(l=>bellPut('admin',{kind:'other',ev:'lead',open:{k:'lead',id:l.id},
  text:`Новая заявка с сайта: ${l.firm||l.name||''}`,key:'lead:'+l.id,at:l.at},true))}
function bellClean(){const lim=addDays(TODAY,-BELL_DAYS);for(let i=BELL.length-1;i>=0;i--)if(String(BELL[i].at).slice(0,10)<lim)BELL.splice(i,1)}
function bellSync(){bellClean();if(isAdmin())bellLeads();else bellStaffDay(me());bellNews(S.me)}

// Видна ли строка тому, кто сейчас вошёл: право, контрагент не скрыт и в его области, запись видна
function bellSees(x){const o=x.open||{},adm=isAdmin();if(adm!==(x.uid==='admin'))return false;
  if(x.need&&!can(x.need))return false;
  if(x.cp!=null){const c=CPM[x.cp];if(!c||c.archived||!visCps(false,'cps').includes(c))return false}
  if(o.k==='report')return visReports().some(r=>r.id===o.id);
  if(o.k==='task')return feat('tasks')&&taskScope().some(t=>t.id===o.id);
  if(o.k==='news')return newsVis().some(n=>n.id===o.id);
  if(o.k==='lead')return adm;
  if(o.k==='cp_sent')return feat('cppage');
  if(o.k==='cp_fee')return feat('fee')&&can('fee');
  if(o.k==='employee')return can('staffView');
  return true}

// Для панели (поток И). uid — кто вошёл: права проверяются у него
function bellItems(uid,tab){bellSync();uid=uid||S.me;
  return BELL.filter(x=>x.uid===uid&&(!tab||tab==='all'||x.kind===tab)&&bellSees(x)).sort((a,b)=>String(b.at).localeCompare(String(a.at))||(+b.id.slice(1))-(+a.id.slice(1)))}
const bellUnseen=uid=>bellItems(uid).filter(x=>!x.seen).length;
// Открыл панель — просмотрены все строки человека, и на других устройствах (в продукте — на сервере)
function bellSeenAll(uid){uid=uid||S.me;BELL.forEach(x=>{if(x.uid===uid)x.seen=true});dbSoon()}
// Нажал строку — прочитана; новость — прочитана и в «Новостях»
function bellRead(id){const x=BELL.find(y=>y.id===id);if(!x)return;x.read=x.seen=true;if(x.ev==='news'&&x.open)newsRead(x.uid).add(x.open.id);dbSoon()}
function bellReadAll(uid){uid=uid||S.me;BELL.forEach(x=>{if(x.uid!==uid)return;x.read=x.seen=true;if(x.ev==='news'&&x.open)newsRead(uid).add(x.open.id)});dbSoon()}
