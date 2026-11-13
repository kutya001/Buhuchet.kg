'use strict';
// Чат бота: общий вид сообщений и приём нажатий (поток Т, задача Т1; пакет заказчика 13.11.2026, одобрены все идеи списка «Идеи для Telegram-бота»)
// Сообщение бота — не строка, а описание: заголовок, текст, таблицы (у таблицы с названием — раскрывающийся раздел), кнопки под сообщением.
//   m: {h, sub, t, code, tables:[{title, open, head:[], rows:[[]], foot:[], num:[номера числовых столбцов]}], btns:[[{t, icon, act, arg, copy, copied, url, off}]], at, me, eph}
// Что правит администратор платформы, а что задаёт продукт: тексты, подписи кнопок и скрытые ответы — шаблоны «Справочников платформы»; состав таблиц и место кнопок — продукт.
// Запасной простой текст строится из того же описания (tgPlain), отдельно его никто не пишет. Его получает тот, кто включил «Сообщения простым текстом» в «Мой профиль»,
// и все пользователи, если администратор платформы выключил таблицы (Админка → «Телеграм» → «Бот платформы»). Кнопки под сообщением остаются в обоих видах: они работают в любом приложении Telegram.
// В продукте бот переходит на простой текст и сам — когда Telegram не принял сообщение с таблицей: напоминание о сроке должно дойти всегда.
const TG_BOT={rich:true};
const tgIsPlain=u=>!TG_BOT.rich||!!(u&&u.tgPlain);
const tgBtnT=(k,d)=>(typeof TPL==='object'&&TPL[k])||d;
function tgPlain(m){const L=[];if(m.h)L.push(m.h);if(m.sub)L.push(m.sub);if(m.t)L.push(m.t);
  (m.tables||[]).forEach(t=>{if(t.title)L.push(`${t.title} · ${t.rows.length}`);t.rows.forEach(r=>L.push('• '+r.filter(x=>x!==''&&x!=null).join(' — ')));if(t.foot)L.push(t.foot.filter(x=>x!==''&&x!=null).join(' — '))});
  return L.join('\n')}
// Код подтверждения в тексте нажимается: в Telegram моноширинный текст копируется нажатием
const tgcText=(s,code)=>{const h=esc(s);return code?h.split(esc(code)).join(`<button type="button" class="tgc-code" data-tgc-copy="${esc(code)}" title="Нажмите, чтобы скопировать">${esc(code)}</button>`):h};
function tgcTable(t){const nm=new Set(t.num||[]),c=i=>nm.has(i)?' class="num"':'';
  const tb=`<table class="tgc-t">${t.head?`<thead><tr>${t.head.map((x,i)=>`<th${c(i)}>${esc(x)}</th>`).join('')}</tr></thead>`:''}<tbody>${t.rows.map(r=>`<tr>${r.map((x,i)=>`<td${c(i)}>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody>${t.foot?`<tfoot><tr>${t.foot.map((x,i)=>`<td${c(i)}>${esc(x)}</td>`).join('')}</tr></tfoot>`:''}</table>`;
  return t.title?`<details${t.open?' open':''}><summary>${esc(t.title)} <span class="tgc-n">${t.rows.length}</span></summary>${tb}</details>`:tb}
function tgcMsg(m,i,plain){
  if(m.eph)return `<div class="tgc-eph" role="status"><b>${ic('eyeoff','sm')}Видно только вам</b>${esc(m.eph)}</div>`;
  if(m.day)return `<span class="tgc-day">${esc(m.day)}</span>`;
  const at=m.at?`<span class="tgc-at">${esc(m.at)}</span>`:'';
  if(m.me)return `<div class="tgc-m me"><div class="tgc-b"><p>${esc(m.t)}</p>${at}</div></div>`;
  const body=plain?`<p>${tgcText(tgPlain(m),m.code)}</p>`:`${m.h?`<p class="tgc-h">${esc(m.h)}</p>`:''}${m.sub?`<p class="tgc-sub">${esc(m.sub)}</p>`:''}${m.t?`<p>${tgcText(m.t,m.code)}</p>`:''}${(m.tables||[]).map(tgcTable).join('')}`;
  const kb=(m.btns||[]).length?`<div class="tgc-kb">${m.btns.map((r,ri)=>`<div class="tgc-row">${r.map((b,ci)=>`<button type="button" class="tgc-k" data-tgc="${i}:${ri}:${ci}" ${b.off?'disabled':''}>${b.icon?ic(b.icon,'sm'):b.copy?ic('copy','sm'):b.url?ic('link','sm'):''}<span>${esc(b.t)}</span></button>`).join('')}</div>`).join('')}</div>`:'';
  return `<div class="tgc-m"><div class="tgc-b">${body}${at}</div>${kb}</div>`}
// chat: {who, list, plain}
function tgcHtml(chat){return `<div class="tgc" data-tgchat><div class="tgc-head"><span class="tgc-ava">B</span><b>${esc(chat.who||'Buhuchet.kg')}</b><span>бот</span></div>${chat.list.map((m,i)=>tgcMsg(m,i,chat.plain)).join('')||'<span class="tgc-empty">Сообщений нет</span>'}</div>`}

// Нажатие кнопки под сообщением. Общие проверки — до действия, одни для всех кнопок:
//   чат привязан к учётной записи; учётная запись и организация не заблокированы; владелец не выключил «Действия из Telegram» (для кнопок, которые меняют данные);
//   у сотрудника есть право, запись — в его области «Свои / Все контрагенты»; запись не изменилась с момента отправки сообщения.
// Отказ бот показывает скрытым ответом — его видит только нажавший, в переписке он не остаётся. Данные меняют только обратимые действия; деньги и удаление — только на сайте.
// Каждое выполненное действие пишется в историю записи с пометкой «через Telegram» (tgLog).
const TG_ACTS={};
// def: {change — меняет данные (выключается владельцем), perm — право, scope(u,arg) — запись в области, stale(u,arg) — запись уже изменена, run(u,arg,m,b) → {eph, msg, done}}
function tgAct(id,def){TG_ACTS[id]=def}
function tgRefusal(u,a,arg){
  if(!a)return tplFill('tgActStale',{});
  if(!u||!u.tg)return tplFill('tgActNoLink',{});
  if(u.active===false)return tplFill('tgActNoRight',{});
  if(a.change&&u.id!=='admin'&&ORG.tgActions===false)return tplFill('tgActOff',{});
  if(a.perm&&!can(a.perm))return tplFill('tgActNoRight',{});
  if(a.scope&&!a.scope(u,arg))return tplFill('tgActNoRight',{});
  if(a.stale&&a.stale(u,arg))return tplFill('tgActStale',{});
  return ''}
const tgLog=(ent,id,what,cp)=>log(ent,id,what,cp,{via:'tg'});
// Пометка записи истории, сделанной нажатием в чате
const histVia=h=>h&&h.via==='tg'?` <span class="pill blue">${ic('tg')}через Telegram</span>`:'';
function tgPress(u,chat,m,b){const a=TG_ACTS[b.act],no=tgRefusal(u,a,b.arg);
  if(no){chat.list.push({eph:no});return}
  const r=a.run(u,b.arg,m,b)||{};
  // Выполненное действие: кнопка становится неактивной с новой подписью, соседние кнопки ряда гаснут, если действие их отменяет
  if(r.done){b.t=r.done;b.off=true}
  if(r.off)(m.btns||[]).forEach(row=>row.forEach(x=>{if(r.off.includes(x.act))x.off=true}));
  if(r.msg)chat.list.push(r.msg);
  if(r.eph)chat.list.push({eph:r.eph})}
function tgcBind(root,chat,redraw,u){const box=root.querySelector('[data-tgchat]');if(!box)return;
  box.onclick=e=>{const c=e.target.closest('[data-tgc-copy]');if(c)return copyText(c.dataset.tgcCopy,'Код скопирован',true);
    const k=e.target.closest('[data-tgc]');if(!k||k.disabled)return;const[i,ri,ci]=k.dataset.tgc.split(':').map(Number),m=chat.list[i],b=m&&m.btns[ri][ci];if(!b)return;
    if(b.copy)return copyText(b.copy,b.copied||'Скопировано',true);
    if(b.url)return toast('В Telegram кнопка откроет сайт: '+b.url,'link');
    if(b.act){tgPress(u,chat,m,b);redraw()}}}

// Сообщение с кодом подтверждения (пакет заказчика 13.11.2026: код копируется одним нажатием): код стоит в тексте первым — его видно в строке уведомления телефона,
// в чате код нажимается и копируется, под сообщением — кнопка «Скопировать код». Скрытым сообщением код не отправляется: доставка скрытых сообщений не гарантирована
function tgCodeMsg(key,vals,at){const code=String(vals.код);return {t:tplFill(key,vals),code,at,btns:[[{t:tgBtnT('tgBtnCopyCode','Скопировать код'),copy:code,copied:'Код скопирован'}]]}}
// «Проверить бота»: сообщение с таблицей и кнопкой — человек видит, как его приложение Telegram показывает новый вид сообщений
tgAct('test',{run:()=>({eph:tplFill('tgTestOk',{})})});
function tgTestMsg(){return {h:'Проверка бота',t:tplFill('tgTest',{}),tables:[{head:['Что проверяем','Как должно быть'],rows:[['Таблица','столбцами, как здесь'],['Кнопки','под сообщением'],['Скрытый ответ','после нажатия кнопки']]}],at:bishkekNow().hm,btns:[[{t:tgBtnT('tgBtnTest','Проверить кнопки'),act:'test',icon:'check'}]]}}

// Окно «Чат с ботом»: макет переписки. o: {title, sub, note, who}
function tgBotDlg(u,list,o={}){const chat={who:o.who||'Buhuchet.kg',list,plain:tgIsPlain(u)};
  openModal({size:'mid',live:true,render:m=>({title:o.title||'Прототип: чат с ботом',sub:o.sub||'Так сообщения бота выглядят в Telegram',
    body:`<label class="check-row"><input type="checkbox" class="sw" id="tgc-plain" ${chat.plain?'checked':''}><span class="grow">Показать простым текстом<div class="hint">Запасной вид: без таблиц и разделов. Его получает тот, кто включил «Сообщения простым текстом» в «Мой профиль»${TG_BOT.rich?'':'; сейчас так получают все — таблицы выключены в Админке'}. Кнопки остаются.</div></span></label>${tgcHtml(chat)}<div class="note">${ic('info')}<span>${o.note||'Это макет: шрифты и форма кнопок в приложении Telegram немного другие. Тексты, подписи кнопок и скрытые ответы — Справочники платформы → «Шаблоны».'}</span></div>`,
    foot:'<button class="btn cta" data-close>Готово</button>',
    mount(el){$('#tgc-plain',el).onchange=e=>{chat.plain=e.target.checked;m.draw()};tgcBind(el,chat,()=>m.draw(),u)}})})}
// Примеры для Админки → «Телеграм» → «Бот платформы»
function tgSamplesDlg(){const u=me();tgBotDlg(u,[{day:'Сегодня'},tgCodeMsg('tgCode',{код:'482913'},'09:12'),tgTestMsg()],{title:'Прототип: вид сообщений бота',sub:'Код подтверждения с копированием и сообщение с таблицей и кнопкой'})}
