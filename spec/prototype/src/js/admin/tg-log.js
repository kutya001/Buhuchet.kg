'use strict';
// Админка → «Телеграм» → «Журнал»: переписка бота в обе стороны и текст сообщений (решение заказчика 17.11.2026; пока только в прототипе) —
// ТЗ «Доработки 17.11.2026», блок «Админка: запуски по расписанию и переписка бота», пункт 3. Дополняет журнал отправленных сообщений и ошибок (telegram.js).
// Запись журнала: {id, at, dir:'out'|'in' (нет — отправлено), to — собеседник, login, org, oid, chat, ct — вид чата, kind, st, tries, err,
//   txt — текст одной строкой, msg — сообщение бота как в чате (tg-chat.js: h, sub, t, tables, btns), re — к какому сообщению относится, btn — нажатая кнопка, file, hide:'code'|'link'}
// Коды и одноразовые ссылки не пишутся никогда: вместо текста — «Текст скрыт…» (уточняет решение заказчика 30.10.2026)
/* ═════════════ Журнал переписки бота ═════════════ */
// Момент по Бишкеку «ago минут назад» — строка «ГГГГ-ММ-ДД ЧЧ:ММ», как у остальных журналов
const bkAgo=ago=>new Date(Date.now()+6*36e5-ago*6e4).toISOString().slice(0,16).replace('T',' ');
// Демо-переписка (demoDB.tgDemo) — со временем «минут назад»: журнал всегда свежий; прежняя копия из сохранённых данных заменяется
(function tgDemoLoad(){const L=DBSRC.demo.db.tgDemo||[],ids=new Set(L.map(x=>x.id));
  for(let i=TG_LOG.length-1;i>=0;i--)if(ids.has(TG_LOG[i].id))TG_LOG.splice(i,1);
  L.forEach(x=>TG_LOG.push(Object.assign(structuredClone(x),{at:bkAgo(x.ago)})))})();
const TG_HIDE={code:'Текст скрыт: в сообщении код',link:'Текст скрыт: одноразовая ссылка'};
const TG_HIDE_KIND={[TG_CODE]:'code','Код замены Telegram':'code','Код':'code','Привязка Telegram':'link','Ссылка «Задать пароль»':'link'};
const tgHid=x=>x.hide||TG_HIDE_KIND[x.kind]||'';
// Текст записей, сохранённых до 17.11.2026 (в них был только тип), — по типу сообщения
const TG_KIND_TXT={'Новая задача':'Вам поставлена новая задача. Откройте её на сайте или нажмите «Взять в работу».','Напоминание за 7 дней':'Через 7 дней срок сдачи отчётов. Список — «Отчеты для сдачи» → «На неделе».','Напоминание за 3 дня':'Через 3 дня срок сдачи отчётов. Список — «Отчеты для сдачи» → «На неделе».','В день срока':'Сегодня последний день сдачи отчётов.','Просрочка':'Срок сдачи отчётов прошёл: отчёты просрочены.','Сводка на неделю':'Сводка на неделю: что сдать и оплатить.','Вход заблокирован':'Вход в Buhuchet.kg заблокирован после 10 неверных паролей подряд. Разблокирует владелец организации или администратор платформы.','Возврат на исправление':'Отчёт вернули на исправление.','Сдача ждёт подтверждения':'Отчёт сдан и ждёт подтверждения.','Telegram привязан':'Telegram привязан к учётной записи. Если это были не вы — нажмите «Это не я».','Telegram отвязан':'Telegram отвязан от учётной записи.','Пароль изменён':'Пароль изменён. Если это были не вы — нажмите «Это не я».','Пароль сброшен':'Пароль сброшен. Задайте новый по ссылке от владельца организации.','Страница контрагента закрыта':'Страница контрагента закрыта.','Заявка с сайта':'Новая заявка с сайта.'};
const tgIn=x=>x.dir==='in';
const tgTxt=x=>{const h=tgHid(x);if(h)return TG_HIDE[h];if(x.file)return `Файл «${x.file.name}» · ${fmtSize(x.file.size)}`;return x.txt||TG_KIND_TXT[x.kind]||x.kind};
const tgChatKey=x=>x.chat||x.to;
const tgChatName=x=>x.ct?`${String(x.to).split(' @')[0]} · ${x.ct.toLowerCase()}`:x.to;
const tgSeq=x=>typeof x.id==='number'?x.id:+String(x.id).replace(/\D/g,'')||0;
const tgOrd=x=>x.at+String(tgSeq(x)).padStart(6,'0');
const TG_PILL={Отправлено:['green','check'],Ожидает:['yellow','hourglass'],Ошибка:['red','alert'],Обработано:['green','check'],'Не распознано':['yellow','help']};
const tgDirHtml=x=>tgIn(x)?`<span class="tgl-dir in">← Получено</span>`:`<span class="tgl-dir">→ Отправлено</span>`;
// Переключатель направления и период — на время сеанса; период по умолчанию — 7 дней (по умолчанию)
const TGL={dir:'all',per:'7'};
const TGL_PER=[['1','Сегодня'],['7','7 дней'],['30','30 дней'],['90','90 дней']];
const tgInPer=x=>TGL.per==='1'?x.at.startsWith(TODAY):x.at.slice(0,10)>=new Date(Date.parse(TODAY)-(+TGL.per-1)*864e5).toISOString().slice(0,10);
function renderTgLog(body,fresh){
  const q=TG_LOG.filter(x=>x.st==='Ожидает').length,er=TG_LOG.filter(x=>!tgIn(x)&&x.st==='Ошибка').length,today=x=>x.at.startsWith(TODAY);
  body.innerHTML=`<div class="plates">${plate({id:'q',icon:'hourglass',color:'yellow',label:'В очереди',value:q,sub:'отправляются пачками'})}${plate({id:'e',icon:'alert',color:er?'red':'green',label:'Ошибки отправки',value:er,sub:'после 5 повторов'})}${plate({id:'s',icon:'send',color:'green',label:'Отправлено сегодня',value:TG_LOG.filter(x=>!tgIn(x)&&x.st==='Отправлено'&&today(x)).length})}${plate({id:'r',icon:'chat',color:'green',label:'Получено сегодня',value:TG_LOG.filter(x=>tgIn(x)&&today(x)).length})}</div>
    <div class="row act-bar"><div class="seg" role="group" aria-label="Направление">${[['all','Все'],['out','Отправленные'],['in','Полученные']].map(([k,l])=>`<button data-td="${k}" class="${TGL.dir===k?'on':''}">${l}</button>`).join('')}</div><div class="seg" role="group" aria-label="Период">${TGL_PER.map(([k,l])=>`<button data-tp="${k}" class="${TGL.per===k?'on':''}">${l}</button>`).join('')}</div><div class="grow"></div><span class="muted act-note">Сообщения хранятся 90 дней · коды и одноразовые ссылки не показываются</span></div><div id="tgg"></div>`;
  const g0=()=>{const g=GS['tg-log'];if(g){g.filters={};g.page=0}return g};
  body.querySelector('.plates').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;const g=g0(),k=b.dataset.plate;
    if(k==='e'||k==='q'){TGL.dir='out';if(g)g.filters.st={type:'enum',vals:[k==='e'?'Ошибка':'Ожидает']};TGL.per='90'}
    else{TGL.dir=k==='s'?'out':'in';TGL.per='1'}
    renderPage()};
  body.querySelector('.act-bar').onclick=e=>{const d=e.target.closest('[data-td]'),p=e.target.closest('[data-tp]');if(d)TGL.dir=d.dataset.td;else if(p)TGL.per=p.dataset.tp;else return;const g=GS['tg-log'];if(g)g.page=0;renderPage()};
  grid($('#tgg',body),{id:'tg-log',audit:false,rid:x=>x.id,cols:[
    {key:'at',label:'Время',type:'text',w:150,val:x=>x.at,text:x=>fmtD(x.at.slice(0,10))+' '+x.at.slice(11),sortVal:tgOrd},
    {key:'dir',label:'Направление',type:'enum',w:130,val:x=>tgIn(x)?'Получено':'Отправлено',html:tgDirHtml},
    {key:'to',label:'Собеседник',type:'text',w:200,val:x=>x.to},
    {key:'kind',label:'Тип сообщения',type:'enum',w:170,val:x=>x.kind},
    {key:'txt',label:'Текст',type:'text',w:340,val:tgTxt,html:x=>tgHid(x)?`<span class="faint">${ic('eyeoff','sm')} ${esc(tgTxt(x))}</span>`:`<span class="tgl-txt">${esc(tgTxt(x).replace(/\s+/g,' '))}</span>`},
    {key:'org',label:'Организация',type:'enum',w:200,val:x=>x.org},
    {key:'st',label:'Статус',type:'enum',w:150,val:x=>x.st,html:x=>pill(x.st,TG_PILL)},
    {key:'err',label:'Ошибка',type:'text',w:280,val:x=>x.err,cls:'mono'},
    {key:'tries',label:'Попыток',type:'int',w:90,num:true,hide:1,val:x=>tgIn(x)?null:x.tries},
    {key:'chat',label:'Чат',type:'enum',w:240,hide:1,val:tgChatName},
    {key:'ct',label:'Вид чата',type:'enum',w:170,hide:1,val:x=>x.ct||'Личный'}],
    rows:()=>TG_LOG.filter(x=>(TGL.dir==='all'||(TGL.dir==='in')===tgIn(x))&&tgInPer(x)),title:'kind',noun:['сообщение','сообщения','сообщений'],sort:{key:'at',dir:-1},
    searchText:x=>[tgTxt(x),x.to,x.org,x.kind].join(' '),rowClass:x=>x.st==='Ошибка'?'overdue':'',simulateLoad:fresh,preset:S.preset,open:tgMsgDlg,
    empty:{icon:'tg',title:'Сообщений за период нет',text:'Выберите период длиннее или «Все».'},
    actions:x=>[{label:'Открыть сообщение',icon:'eye',run:()=>tgMsgDlg(x)},{label:'Вся переписка',icon:'chat',run:()=>tgChatAll(x)},{label:'Повторить отправку',icon:'refresh',disabled:!!tgNoRetry(x),reason:tgNoRetry(x),run:()=>tgRetry(x)}],
    bulk:[{label:'Повторить ошибки',icon:'refresh',run:(rs,done)=>{const xs=rs.filter(x=>!tgNoRetry(x)),k=rs.filter(x=>!tgIn(x)&&x.st==='Ошибка'&&(x.kind===TG_CODE||x.kind==='Код замены Telegram')).length;xs.forEach(x=>{x.st='Ожидает';x.err=''});done();renderPage();toast(`Поставлено в очередь: ${xs.length}`+(k?`; коды повторно не отправляются (${k})`:''))}}]});
  // «Вся переписка»: от старых к новым — после первой отрисовки журнала
  if(TGL.asc){TGL.asc=false;const g=GS['tg-log'];if(g){g.sort={key:'at',dir:1};renderPage()}}
}
function tgRetry(x){x.st='Ожидает';x.tries=0;x.err='';renderPage();toast('Сообщение снова в очереди','tg');setTimeout(()=>{x.st='Отправлено';x.tries=1;if(S.mod==='tg')renderPage()},1600)}
// «Вся переписка»: журнал с фильтром по чату, все направления и весь срок хранения, от старых к новым
function tgChatAll(x){MODALS.slice().forEach(m=>m.close());TGL.dir='all';TGL.per='90';TGL.asc=true;const g=GS['tg-log'];if(g)g.sort={key:'at',dir:1};go('tg','log',{chat:{type:'enum',vals:[tgChatName(x)]}})}
// Открыть сообщение из другого окна (окно «Запуск»): журнал и окно «Сообщение»
function tgLogShow(x){if(!x)return;TGL.dir='all';if(!tgInPer(x))TGL.per='90';go('tg','log');setTimeout(()=>tgMsgDlg(x),160)}
const tgChat=x=>TG_LOG.filter(y=>tgChatKey(y)===tgChatKey(x)).sort((a,b)=>tgOrd(a)<tgOrd(b)?-1:1);
const tgById=id=>id==null?null:TG_LOG.find(y=>y.id===id)||null;
// Сообщение в виде чата Telegram: отправленное — как его видит человек (таблица, кнопки), полученное — пузырь человека под сообщением бота, к которому оно относится
function tgBubble(x){const at=x.at.slice(11,16);if(tgHid(x))return null;
  if(tgIn(x)){if(x.btn)return {me:true,t:`Нажата кнопка «${x.btn}»`,at};if(x.file)return {me:true,file:x.file,t:'',at};return {me:true,t:x.txt||x.kind,at}}
  return Object.assign(structuredClone(x.msg||{t:tgTxt(x)}),{at})}
function tgMsgDlg(x){
  const re=tgById(x.re),kids=TG_LOG.filter(y=>y.re===x.id),chat=tgChat(x),i=chat.indexOf(x),prev=chat[i-1],next=chat[i+1];
  const bot=tgIn(x)?re&&!tgIn(re)?re:null:x,pressed=new Set([x.btn,...kids.map(y=>y.btn)].filter(Boolean));
  const list=[];if(tgIn(x)&&bot)list.push(tgBubble(bot));const own=tgBubble(x);if(own)list.push(own);
  const hid=tgHid(x),dash='<span class="faint">—</span>',kv=(k,v)=>`<div><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const who=x.login&&typeof acUser==='function'&&acUser(x.login)?`<button type="button" class="linkbtn" id="tm-who">${esc(x.to)}</button>`:esc(x.to);
  const org=x.oid&&ORGS.some(o=>o.id===x.oid)?`<button type="button" class="linkbtn" id="tm-org">${esc(x.org)}</button>`:esc(x.org||'—');
  const link=(y,pre)=>`<li><span class="t">${fmtD(y.at.slice(0,10))}<br>${y.at.slice(11,16)}</span><span>${pre?pre+' ':''}${tgIn(y)?'← ':'→ '}<button type="button" class="linkbtn" data-tm="${esc(String(y.id))}">${esc(y.kind)}</button><br><span class="w">${esc(tgTxt(y).replace(/\s+/g,' ').slice(0,90))}</span></span></li>`;
  const rel=[re?link(re,tgIn(x)?'Сообщение бота:':'В ответ на:'):'',...kids.map(y=>link(y,''))].join('');
  const nr=tgNoRetry(x);
  openModal({size:'mid',render:()=>({title:esc(x.kind),sub:`${tgIn(x)?'← Получено':'→ Отправлено'} · ${fmtDT(x.at)} · ${pill(x.st,TG_PILL)}`,
    body:`${hid?`<div class="note">${ic('eyeoff')}<span>${esc(TG_HIDE[hid])}. Коды и одноразовые ссылки в журнал не пишутся${tgIn(x)?'':', такое сообщение повторно не отправляется'}.</span></div>`:''}
    ${list.length?`<div class="tgl-view">${tgcHtml({who:x.ct==='Общий чат фирмы'?String(x.to).replace(/^Чат /,''):'Buhuchet.kg',group:x.ct==='Общий чат фирмы',list}).replace(/data-tgc="/g,'data-tgl="')}</div>`:''}
    <div class="box"><div class="kv">${kv('Собеседник',who)}${kv('Организация',org)}${kv('Вид чата',esc(x.ct||'Личный'))}${tgIn(x)?'':kv('Попыток',x.tries??'—')}${kv('Ошибка',x.err?`<span class="mono">${esc(x.err)}</span>`:dash)}</div></div>
    ${rel?`<div class="box"><h3>Связанные сообщения</h3><ul class="tl">${rel}</ul></div>`:''}`,
    foot:`<button class="btn" id="tm-prev" ${prev?'':'disabled'}>${ic('left','sm')}Раньше</button><button class="btn" id="tm-next" ${next?'':'disabled'}>Позже${ic('right','sm')}</button><button class="btn ghost" id="tm-all">${ic('chat','sm')}Вся переписка</button><div class="grow"></div>${tgIn(x)?'':`<button class="btn ${nr?'dis':''}" id="tm-retry" ${nr?`aria-disabled="true" title="${esc(nr)}"`:''}>${ic('refresh','sm')}Повторить отправку</button>`}<button class="btn cta" data-close>Закрыть</button>`,
    mount(el,m){
      // Нажатая кнопка отмечена — у сообщения бота и у нажатия под ним
      el.querySelectorAll('.tgl-view .tgc-k').forEach(b=>{if(pressed.has(b.textContent.trim())){b.classList.add('pressed');b.title='Нажата';b.insertAdjacentHTML('afterbegin',ic('check','sm'))}});
      const to=y=>{m.close();tgMsgDlg(y)};
      $('#tm-prev',el).onclick=()=>prev&&to(prev);$('#tm-next',el).onclick=()=>next&&to(next);$('#tm-all',el).onclick=()=>tgChatAll(x);
      el.querySelectorAll('[data-tm]').forEach(b=>b.onclick=()=>{const y=TG_LOG.find(z=>String(z.id)===b.dataset.tm);if(y)to(y)});
      const w=$('#tm-who',el);if(w)w.onclick=()=>{m.close();accCard(x.login,'tg')};
      const o=$('#tm-org',el);if(o)o.onclick=()=>{m.close();orgCard(x.oid)};
      const r=$('#tm-retry',el);if(r)r.onclick=()=>{if(nr)return toast(nr,'lock',true);m.close();tgRetry(x)}}})})}
