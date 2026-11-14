'use strict';
// Чат бота: общий вид сообщений и приём нажатий (поток Т, задача Т1; пакет заказчика 13.11.2026, одобрены все идеи списка «Идеи для Telegram-бота»)
// Сообщение бота — не строка, а описание: заголовок, текст, таблицы (у таблицы с названием — раскрывающийся раздел), кнопки под сообщением.
//   m: {img:{name, src} — картинка над текстом (рассылка, задача Т6), h, sub, t, plain, code, tables:[{title, open, n, head:[], rows:[[]], foot:[], num:[номера числовых столбцов]}], btns:[[{t, icon, act, arg, copy, copied, url, go, off}]], at, me, eph,
//       ask:{act, arg, kind:'file'|'text', re, day, off} — бот ждёт ответ на это сообщение (задача Т2), file:{name, size} и re — файл и «в ответ на» в сообщении человека}
// Что правит администратор платформы, а что задаёт продукт: тексты, подписи кнопок и скрытые ответы — шаблоны «Справочников платформы»; состав таблиц и место кнопок — продукт.
// Запасной простой текст строится из того же описания (tgPlain), отдельно его никто не пишет. Число в строке таблицы идёт с названием своего столбца: «Нурлан Т. — Сдать 6 — Просроч. 2».
// Исключение — утреннее напоминание (задача Т3): его простой текст — прежние строки шаблонов «Сегодня последний день сдачи…» (m.plain). n у таблицы — сколько записей всего, если показаны не все. Его получает тот, кто включил «Сообщения простым текстом» в «Мой профиль»,
// и все пользователи, если администратор платформы выключил таблицы (Админка → «Телеграм» → «Бот платформы»). Кнопки под сообщением остаются в обоих видах: они работают в любом приложении Telegram.
// В продукте бот переходит на простой текст и сам — когда Telegram не принял сообщение с таблицей: напоминание о сроке должно дойти всегда.
// topics — «Темы в чате с ботом» (задача Т7, tg-topics.js): по умолчанию выключено
const TG_BOT={rich:true,topics:false};
const tgIsPlain=u=>!TG_BOT.rich||!!(u&&u.tgPlain);
const tgBtnT=(k,d)=>(typeof TPL==='object'&&TPL[k])||d;
function tgPlain(m){if(m.plain)return m.plain;const L=[];if(m.h)L.push(m.h);if(m.sub)L.push(m.sub);if(m.t)L.push(m.t);
  (m.tables||[]).forEach(t=>{const nm=new Set(t.num||[]),cell=(x,i)=>nm.has(i)&&t.head&&t.head[i]?`${t.head[i]} ${x}`:x;if(t.title)L.push(`${t.title} · ${t.n??t.rows.length}`);
    t.rows.forEach(r=>L.push('• '+r.map(cell).filter((x,i)=>r[i]!==''&&r[i]!=null).join(' — ')));if(t.foot)L.push(t.foot.filter(x=>x!==''&&x!=null).join(' — '))});
  return L.join('\n')}
// Код подтверждения в тексте нажимается: в Telegram моноширинный текст копируется нажатием
const tgcText=(s,code)=>{const h=esc(s);return code?h.split(esc(code)).join(`<button type="button" class="tgc-code" data-tgc-copy="${esc(code)}" title="Нажмите, чтобы скопировать">${esc(code)}</button>`):h};
function tgcTable(t){const nm=new Set(t.num||[]),c=i=>nm.has(i)?' class="num"':'';
  const tb=`<table class="tgc-t">${t.head?`<thead><tr>${t.head.map((x,i)=>`<th${c(i)}>${esc(x)}</th>`).join('')}</tr></thead>`:''}<tbody>${t.rows.map(r=>`<tr>${r.map((x,i)=>`<td${c(i)}>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody>${t.foot?`<tfoot><tr>${t.foot.map((x,i)=>`<td${c(i)}>${esc(x)}</td>`).join('')}</tr></tfoot>`:''}</table>`;
  return t.title?`<details${t.open?' open':''}><summary>${esc(t.title)} <span class="tgc-n">${t.n??t.rows.length}</span></summary>${tb}</details>`:tb}
function tgcMsg(m,i,plain){
  if(m.eph)return `<div class="tgc-eph" role="status"><b>${ic('eyeoff','sm')}Видно только вам</b>${esc(m.eph)}</div>`;
  if(m.day)return `<span class="tgc-day">${esc(m.day)}</span>`;
  const at=m.at?`<span class="tgc-at">${esc(m.at)}</span>`:'';
  if(m.me)return `<div class="tgc-m me${m.re||m.file?' say':''}"><div class="tgc-b">${m.re?`<p class="tgc-re">${ic('chat','sm')}${esc(m.re)}</p>`:''}${m.file?`<p class="tgc-file">${ic('file','sm')}<span>${esc(m.file.name)}</span><span class="tgc-fs">${fmtSize(m.file.size)}</span></p>`:''}${m.t?`<p>${esc(m.t)}</p>`:''}${at}</div></div>`;
  const body=plain?`<p>${tgcText(tgPlain(m),m.code)}</p>`:`${m.h?`<p class="tgc-h">${esc(m.h)}</p>`:''}${m.sub?`<p class="tgc-sub">${esc(m.sub)}</p>`:''}${m.t?`<p>${tgcText(m.t,m.code)}</p>`:''}${(m.tables||[]).map(tgcTable).join('')}`;
  const kb=(m.btns||[]).length?`<div class="tgc-kb">${m.btns.map((r,ri)=>`<div class="tgc-row">${r.map((b,ci)=>`<button type="button" class="tgc-k" data-tgc="${i}:${ri}:${ci}" ${b.off?'disabled':''}>${b.icon?ic(b.icon,'sm'):b.copy?ic('copy','sm'):b.url?ic('link','sm'):''}<span>${esc(b.t)}</span></button>`).join('')}</div>`).join('')}</div>`:'';
  return `<div class="tgc-m"><div class="tgc-b">${m.img?`<img class="tgc-img" src="${esc(m.img.src)}" alt="${esc(m.img.name||'Картинка')}">`:''}${body}${tgAskLive(m)?`<p class="tgc-wait">${ic('hourglass','sm')}Бот ждёт ответ на это сообщение</p>`:''}${at}</div>${kb}</div>`}
// chat: {who, list, plain, menu — строка команд под перепиской (задача Т5, tg-menu.js), topics, cur, byOrg — темы чата и открытая тема (задача Т7, tg-topics.js)}
function tgcHtml(chat){const shown=chat.list.map((m,i)=>tgTopicShown(chat,m)?tgcMsg(m,i,chat.plain):''),any=chat.list.some(m=>!m.day&&tgTopicShown(chat,m)),alien=chat.topics&&chat.cur.startsWith('org:')&&chat.cur!=='org:'+ORG.id;
  return `<div class="tgc" data-tgchat><div class="tgc-head"><span class="tgc-ava">B</span><b>${esc(chat.who||'Buhuchet.kg')}</b><span>бот</span></div>${chat.topics?tgcTopicsHtml(chat):''}${any?shown.join(''):'<span class="tgc-empty">Сообщений нет</span>'}${alien?'<span class="tgc-empty">Здесь — сообщения и ответы на команды учётной записи этой организации. В макете её данных нет</span>':`${tgcAskHtml(chat)}${chat.menu?tgcMenuHtml():''}`}</div>`}

// Ответ боту (поток Т, задача Т2; решение заказчика 13.11.2026: «если нужно прикрепить файл — отправить файл боту, нет файла — не сдано»).
// Действию нужен файл или текст — бот просит ответить на своё сообщение и ждёт до конца дня; под просьбой кнопка «Отмена». Пока ответа нет, запись не меняется.
// Ответ проходит те же проверки, что и нажатие (tgRefusal): за время ожидания право могли забрать, а запись — изменить. Файл — по правилам сайта: до 20 МБ, без программ, сценариев и веб-страниц;
// неподходящий ответ бот объясняет и ждёт другой. Ответ на сообщение — не нажатие, скрытого ответа у него нет: бот отвечает обычным сообщением.
const tgAskLive=m=>!!(m&&m.ask&&!m.ask.off&&m.ask.day===TODAY);
const tgAskOpen=chat=>chat.list.slice().reverse().find(tgAskLive)||null;
const TG_FILE_NO=new Set('exe msi com scr pif cpl dll sys lnk reg inf bat cmd ps1 vbs vbe js jse mjs wsf wsh hta jar sh app dmg pkg apk deb rpm html htm xhtml shtml mht mhtml svg svgz php asp aspx jsp chm iso img url'.split(' '));
function tgFileWhy(f){if(f.size>FILE_MAX_MB*1048576)return tplFill('tgFileBig',{мб:FILE_MAX_MB});const i=f.name.lastIndexOf('.');return i>0&&TG_FILE_NO.has(f.name.slice(i+1).toLowerCase())?tplFill('tgFileType',{}):''}
// Поле ответа под перепиской: в Telegram человек отвечает на сообщение бота (бот сам открывает ответ), в макете — эта строка
function tgcAskHtml(chat){const m=tgAskOpen(chat);if(!m||!tgTopicShown(chat,m))return '';const k=m.ask;
  return `<div class="tgc-ask" data-tgc-ask><div class="tgc-ask-h">${ic('chat','sm')}<span>Ответ на: ${esc(k.re||m.t||'')}</span></div>${k.kind==='file'
    ?`<input type="file" class="inp" data-tgc-file aria-label="Файл для бота"><input class="inp" data-tgc-cap maxlength="${FNOTE_MAX}" placeholder="Подпись к файлу — станет примечанием" aria-label="Подпись к файлу"><div class="row" style="flex-wrap:wrap"><button type="button" class="linkbtn" data-tgc-demo>В макете: отправить пример «Квитанция.pdf»</button><div class="grow"></div><button type="button" class="btn cta sm" data-tgc-send>${ic('send','sm')}Отправить файл</button></div>`
    :`<div class="row"><input class="inp" data-tgc-text maxlength="500" placeholder="${esc(k.ph||'Ваш ответ')}" aria-label="Ответ боту" style="flex:1;min-width:0"><button type="button" class="btn cta sm" data-tgc-send>${ic('send','sm')}Ответить</button></div>`}</div>`}
function tgReply(u,chat,m,p){const k=m.ask,a=TG_ACTS[k.act],at=bishkekNow().hm,say=t=>chat.list.push({t,at});
  chat.list.push(p.file?{me:true,file:p.file,t:p.cap||'',re:k.re,at}:{me:true,t:p.text||'',re:k.re,at});
  const no=tgRefusal(u,a,k.arg);if(no){tgAskClose(m);return say(no)}
  const r=a.reply(u,k.arg,p,k)||{};
  // Ответ не подошёл (не тот файл, пустая причина): бот объясняет и ждёт другой ответ на то же сообщение
  if(r.again)return say(r.again);
  tgAskClose(m);
  if(r.done&&k.src){k.src.b.t=r.done;k.src.b.off=true;(k.src.m.btns||[]).forEach(row=>row.forEach(x=>{if((r.off||[]).includes(x.act))x.off=true}))}
  if(r.msg)chat.list.push(r.msg);if(r.say)say(r.say)}
function tgAskClose(m){m.ask.off=true;(m.btns||[]).forEach(row=>row.forEach(x=>{if(x.act==='askCancel')x.off=true}))}

// Нажатие кнопки под сообщением. Общие проверки — до действия, одни для всех кнопок:
//   чат привязан к учётной записи (кроме кнопки «Это не я» под сообщением о безопасности, a.prev: она работает в том чате, куда пришло сообщение, даже отвязанном — tg-security.js);
//   учётная запись и организация не заблокированы; владелец не выключил «Действия из Telegram» (для кнопок, которые меняют данные);
//   у сотрудника есть право, запись — в его области «Свои / Все контрагенты»; запись не изменилась с момента отправки сообщения.
// Отказ бот показывает скрытым ответом — его видит только нажавший, в переписке он не остаётся. Данные меняют только обратимые действия; деньги и удаление — только на сайте.
// Каждое выполненное действие пишется в историю записи с пометкой «через Telegram» (tgLog).
const TG_ACTS={};
// def: {change — меняет данные (выключается владельцем), prev — работает и в отвязанном чате, perm — право, scope(u,arg) — запись в области, stale(u,arg) — запись уже изменена, run(u,arg,m,b) → {eph, msg, done}}
function tgAct(id,def){TG_ACTS[id]=def}
// «Отмена» под просьбой бота: бот перестаёт ждать ответ, запись не меняется
tgAct('askCancel',{run:(u,arg,m)=>{if(!tgAskLive(m))return {eph:tplFill('tgActStale',{})};tgAskClose(m);return {done:'Отменено',eph:tplFill('tgActCancelled',{})}}});
function tgRefusal(u,a,arg){
  if(!a)return tplFill('tgActStale',{});
  if(!u||(!u.tg&&!a.prev))return tplFill('tgActNoLink',{});
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
  // Действию нужен ответ: бот просит его отдельным сообщением с кнопкой «Отмена»; нажатая кнопка пока не меняется — она погаснет, когда ответ будет принят
  if(r.ask){if(chat.list.some(x=>tgAskLive(x)&&x.ask.act===r.ask.act&&x.ask.arg===r.ask.arg))r.eph=tplFill('tgActAskWait',{});
    else chat.list.push({t:r.ask.t,at:bishkekNow().hm,ask:Object.assign({day:TODAY,src:{m,b}},r.ask),btns:[[{t:tgBtnT('tgBtnCancel','Отмена'),act:'askCancel',icon:'x'}]]})}
  if(r.eph)chat.list.push({eph:r.eph})}
function tgcBind(root,chat,redraw,u){const box=root.querySelector('[data-tgchat]');if(!box)return;
  // После нажатия и ответа переписка прокручивается к последнему сообщению — как в Telegram
  if(chat.jump){chat.jump=false;const l=box.lastElementChild;if(l&&l.scrollIntoView)l.scrollIntoView({block:'nearest'})}
  box.onclick=e=>{const c=e.target.closest('[data-tgc-copy]');if(c)return copyText(c.dataset.tgcCopy,'Код скопирован',true);
    const k=e.target.closest('[data-tgc]');if(!k||k.disabled)return;const[i,ri,ci]=k.dataset.tgc.split(':').map(Number),m=chat.list[i],b=m&&m.btns[ri][ci];if(!b)return;
    if(b.copy)return copyText(b.copy,b.copied||'Скопировано',true);
    if(b.url)return b.go?b.go():toast('В Telegram кнопка откроет сайт: '+b.url,'link');
    if(b.act){tgPress(u,chat,m,b);tgTopicTag(chat);chat.jump=true;redraw()}};
  // Темы (задача Т7): нажатие на тему открывает её переписку
  box.querySelectorAll('[data-tgc-topic]').forEach(x=>x.onclick=e=>{e.stopPropagation();chat.cur=x.dataset.tgcTopic;chat.jump=true;redraw()});
  // Меню команд (задача Т5): нажатие — сообщение человека и ответ бота
  box.querySelectorAll('[data-tgc-cmd]').forEach(x=>x.onclick=e=>{e.stopPropagation();tgCmd(u,chat,x.dataset.tgcCmd);tgTopicTag(chat);chat.jump=true;redraw()});
  const ask=box.querySelector('[data-tgc-ask]');if(!ask)return;
  const m=tgAskOpen(chat),q=s=>ask.querySelector(s),send=p=>{tgReply(u,chat,m,p);tgTopicTag(chat);chat.jump=true;redraw()};
  q('[data-tgc-send]').onclick=()=>{if(m.ask.kind==='file'){const f=q('[data-tgc-file]').files[0];if(!f)return toast('Выберите файл','alert',true);return send({file:{name:f.name,size:f.size},cap:fNoteClean(q('[data-tgc-cap]').value)})}
    const t=q('[data-tgc-text]').value.trim();if(!t)return toast('Напишите ответ: пустое сообщение в Telegram не отправить','alert',true);send({text:t})};
  if(q('[data-tgc-demo]'))q('[data-tgc-demo]').onclick=()=>send({file:{name:'Квитанция.pdf',size:184320},cap:fNoteClean(q('[data-tgc-cap]').value)});
  if(q('[data-tgc-text]'))q('[data-tgc-text]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();q('[data-tgc-send]').click()}}}

// Сообщение с кодом подтверждения (пакет заказчика 13.11.2026: код копируется одним нажатием): код стоит в тексте первым — его видно в строке уведомления телефона,
// в чате код нажимается и копируется, под сообщением — кнопка «Скопировать код». Скрытым сообщением код не отправляется: доставка скрытых сообщений не гарантирована
function tgCodeMsg(key,vals,at){const code=String(vals.код);return tgIn('sec',{t:tplFill(key,vals),code,at,btns:[[{t:tgBtnT('tgBtnCopyCode','Скопировать код'),copy:code,copied:'Код скопирован'}]]})}
// «Проверить бота»: сообщение с таблицей и кнопкой — человек видит, как его приложение Telegram показывает новый вид сообщений
tgAct('test',{run:()=>({eph:tplFill('tgTestOk',{})})});
function tgTestMsg(){return {h:'Проверка бота',t:tplFill('tgTest',{}),tables:[{head:['Что проверяем','Как должно быть'],rows:[['Таблица','столбцами, как здесь'],['Кнопки','под сообщением'],['Скрытый ответ','после нажатия кнопки']]}],at:bishkekNow().hm,btns:[[{t:tgBtnT('tgBtnTest','Проверить кнопки'),act:'test',icon:'check'}]]}}

// Окно «Чат с ботом»: макет переписки. o: {title, sub, note, who}
function tgBotDlg(u,list,o={}){const chat={who:o.who||'Buhuchet.kg',list,plain:tgIsPlain(u),menu:!!o.menu};
  // Темы (задача Т7): сообщения без темы — в «Общем»; открывается тема последнего сообщения
  if(TG_BOT.topics){chat.topics=tgTopicsFor(u,o);chat.byOrg=!!tgOrgsOf(u,o).length;list.forEach(m=>{if(m.topic===undefined&&!m.day)m.topic=''});tgTopicStart(chat)}
  // После «Это не я» сеанс нажавшего завершён: когда окно переписки закроют, макет покажет страницу входа (tgSecLeave, tg-security.js)
  openModal({size:'mid',live:true,onClose:()=>{tgSecLeave();if(o.onClose)o.onClose()},render:m=>({title:o.title||'Прототип: чат с ботом',sub:o.sub||'Так сообщения бота выглядят в Telegram',
    body:`<label class="check-row"><input type="checkbox" class="sw" id="tgc-plain" ${chat.plain?'checked':''}><span class="grow">Показать простым текстом<div class="hint">Запасной вид: без таблиц и разделов. Его получает тот, кто включил «Сообщения простым текстом» в «Мой профиль»${TG_BOT.rich?'':'; сейчас так получают все — таблицы выключены в Админке'}. Кнопки остаются.</div></span></label>${chat.topics&&u&&u.id!=='admin'?`<label class="check-row"><input type="checkbox" class="sw" id="tgc-orgs" ${chat.byOrg?'checked':''}><span class="grow">Демо: этот Telegram привязан и к учётной записи в другой организации<div class="hint">Тогда темы — по организациям: отчёты и задачи каждой организации в своей теме, «Безопасность» — общая.</div></span></label>`:''}${tgcHtml(chat)}<div class="note">${ic('info')}<span>${o.note||'Это макет: шрифты и форма кнопок в приложении Telegram немного другие. Тексты, подписи кнопок и скрытые ответы — Справочники платформы → «Шаблоны».'}</span></div>`,
    foot:'<button class="btn cta" data-close>Готово</button>',
    mount(el){$('#tgc-plain',el).onchange=e=>{chat.plain=e.target.checked;m.draw()};
      const og=$('#tgc-orgs',el);if(og)og.onchange=e=>{o.orgs=e.target.checked?[TG_DEMO_ORG2]:[];chat.topics=tgTopicsFor(u,o);chat.byOrg=!!o.orgs.length;tgTopicStart(chat);m.draw()};tgcBind(el,chat,()=>o.live?refreshAll():m.draw(),u)}})})}
// Примеры для Админки → «Телеграм» → «Бот платформы»
function tgSamplesDlg(){const u=me();tgBotDlg(u,[{day:'Сегодня'},tgCodeMsg('tgCode',{код:'482913'},'09:12'),tgTestMsg()],{title:'Прототип: вид сообщений бота',sub:'Код подтверждения с копированием и сообщение с таблицей и кнопкой'})}
