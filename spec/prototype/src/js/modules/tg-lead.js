'use strict';
// Telegram заявителя — до создания организации (поток Т, доработки 14.11.2026, блок 1, пункты 2–3; решение заказчика 14.11.2026).
// Раньше бот писал о заявке только администраторам платформы, а заявитель узнавал о решении по телефону и получал временный пароль.
// Теперь:
//   — после отправки заявки — кнопка «Подключить Telegram»: одноразовая ссылка на бота платформы, действует 24 часа (leadTgLink);
//     заявитель нажимает в боте «Старт» — бот отвечает «Заявка получена, о решении сообщим здесь», у заявки «Telegram подключён» (leadTgOn);
//   — «Одобрить» (поток И) создаёт организацию и владельца без пароля, Telegram владельца — тот, что подключил заявитель;
//     бот присылает «Организация создана» и кнопку «Задать пароль»: ссылка действует 7 дней и один раз (tgLeadOwnerSetup);
//     истекла — администратор отправляет новую из карточки организации, прежняя перестаёт действовать (ownerSetupAct);
//   — «Отклонить» на сайте или кнопкой в Telegram — бот присылает заявителю причину (tgLeadRefused).
// Стык с потоком И: форма лендинга, столбцы «Заявок», «Одобрить» и «Отказ» на сайте — его; они вызывают функции этого файла.
// В макете переписка заявителя с ботом хранится у заявки (o.tgChat); в продукте её нет — бот отправляет сообщения в чат заявителя.
const LEAD_TG_TTL_H=24,OWNER_SETUP_DAYS=7,TG_LEAD_KIND='Сообщение заявителю',TG_SETUP_KIND='Ссылка, чтобы задать пароль';
const tgLeadTok=()=>{const a=new Uint32Array(2);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(8,'0')).join('')};
const setPassUrl=tok=>`https://${typeof LAND==='object'&&LAND.test?'test.':''}buhuchet.kg/setpass/${tok}`;
// Ссылка на бота для заявки: прежняя, пока действует, иначе новая (прежняя перестаёт работать). Telegram уже подключён — null
function leadTgLink(o){if(!o||o.tgAt)return null;const now=Date.now();let k=o.tgTok;
  if(!k||k.till<=now){k=o.tgTok={tok:tgLeadTok(),till:now+LEAD_TG_TTL_H*3600e3};dbSoon()}
  return {url:`https://t.me/buhuchet_bot?start=l_${k.tok}`,till:k.till}}
const leadTgOn=o=>!!(o&&o.tgAt);
const leadTgChat=o=>(o.tgChat=o.tgChat||[{day:'Сегодня'}]);
// Сообщение бота заявителю: в переписку заявки и в журнал «Телеграм» (тип сообщения, без текста и ссылки)
function leadTgSay(o,m,kind){if(!o.tgAt)return null;leadTgChat(o).push(m);tgSvc({fio:o.name,tg:o.tgName},kind||TG_LEAD_KIND,{org:'Платформа'});dbSoon();return m}
// «Старт» по ссылке: ссылка действует 24 часа и один раз, заявку не удалили. Заявке, по которой уже отказали, бот сразу присылает причину
function leadTgStart(o,name,tok){const k=o.tgTok,at=bishkekNow().hm;
  if(!LEADS.includes(o)||o.tgAt||!k||k.tok!==tok||k.till<=Date.now())return {t:tplFill('tgLeadLinkBad',{}),at};
  delete o.tgTok;o.tgAt=nowStamp();o.tgName=name;leadLog(o,`Telegram подключён: ${name}`,'guest');o.hist[o.hist.length-1].via='tg';
  const m=o.status==='Отказ'&&o.tgWhy?{t:tplFill('tgLeadNo',{фирма:leadFirm(o),причина:o.tgWhy}),at}:{t:tplFill('tgLeadGot',{фирма:leadFirm(o)}),at};
  leadTgSay(o,m);return null}
// После «Одобрить»: Telegram владельца — тот, что подключил заявитель; пароля у владельца нет, его он задаёт по ссылке из бота
function tgLeadOwnerSetup(o,orgId,userId){const org=ORGS.find(x=>x.id===orgId),u=OTHER_USERS.find(x=>x.login===userId);if(!o||!org||!u)return null;
  if(o.tgAt)u.tg=o.tgName;if(!u.tmpPass)u.noPass=true;const tok=ownerSetupNew(u);
  return leadTgSay(o,{t:tplFill('tgLeadDone',{организация:org.name,логин:u.login,дней:OWNER_SETUP_DAYS}),at:bishkekNow().hm,btns:[[{t:tgBtnT('tgBtnSetPass','Задать пароль'),url:setPassUrl(tok),sp:tok}]]},TG_SETUP_KIND)}
// Отказ на сайте (поток И) и кнопкой «Отклонить» в Telegram (tg-leads.js): причина запоминается — если заявитель подключит Telegram позже, бот пришлёт её сразу
function tgLeadRefused(o,why){if(!o)return null;o.tgWhy=String(why||'');return leadTgSay(o,{t:tplFill('tgLeadNo',{фирма:leadFirm(o),причина:o.tgWhy}),at:bishkekNow().hm})}
// Ссылка «Задать пароль»: 7 дней и один раз; новая отменяет прежнюю
function ownerSetupNew(u){const tok=tgLeadTok();u.setup={tok,till:Date.now()+OWNER_SETUP_DAYS*86400e3};dbSoon();return tok}
function ownerSetupFind(tok){const u=OTHER_USERS.find(x=>x.setup&&x.setup.tok===tok);if(!u||!u.noPass||u.setup.till<=Date.now())return null;return {u,org:ORGS.find(x=>x.id===u.org)||null}}
// Карточка организации в Админке: «Отправить новую ссылку для пароля» — пока владелец не задал пароль
function ownerSetupAct(org,u){if(!u||!u.noPass)return null;const l=orgLead(org);
  return {label:'Отправить новую ссылку для пароля',icon:'link',disabled:!u.tg,reason:'У владельца не привязан Telegram',run:()=>{const tok=ownerSetupNew(u),m={t:tplFill('tgSetPassNew',{логин:u.login,дней:OWNER_SETUP_DAYS}),at:bishkekNow().hm,btns:[[{t:tgBtnT('tgBtnSetPass','Задать пароль'),url:setPassUrl(tok),sp:tok}]]};
    if(l&&l.tgAt)leadTgSay(l,m,TG_SETUP_KIND);else tgSvc(u,TG_SETUP_KIND,{org:org.name});log('porg',org.id,`Владельцу ${u.login} отправлена новая ссылка, чтобы задать пароль; прежняя больше не действует`);
    refreshAll();toast('Новая ссылка отправлена в Telegram владельца','tg')}}}

// Прототип: переписка заявителя с ботом. Кнопка «Подключить Telegram» на лендинге открывает бота по ссылке; в макете «Старт» нажимается здесь
function leadTgOpen(o){if(!o)return;const at=()=>bishkekNow().hm;
  openModal({size:'mid',live:true,render:m=>{const list=leadTgChat(o).map(x=>x.btns?{...x,btns:x.btns.map(r=>r.map(b=>b.sp?{...b,go:()=>{MODALS.slice().forEach(y=>y.close());setPassPage(b.sp)}}:b))}:x),chat={who:'Buhuchet.kg',list};
    const k=leadTgLink(o),def=String(o.name||'').split(' ').slice(0,2).join(' ')||'Заявитель';
    return {title:'Прототип: Telegram заявителя',sub:esc(`${o.firm} · ${o.name}`)+(o.tgAt?` · Telegram подключён: ${esc(o.tgName)}`:' · Telegram не подключён'),
      body:`${tgcHtml(chat)}
        ${k?`<div class="row" style="flex-wrap:wrap">${inp('ltg-n',def,'maxlength="32" placeholder="Имя в Telegram" aria-label="Имя в Telegram" style="max-width:220px"')}<button class="btn cta" id="ltg-go">${ic('send','sm')}Нажать «Старт» в боте</button></div>`:''}
        <div class="note">${ic('info')}<span>Так бот переписывается с заявителем. В продукте кнопка «Подключить Telegram» открывает бота платформы по одноразовой ссылке: она действует ${LEAD_TG_TTL_H} часа и один раз, имя берётся из Telegram. Пока Telegram не подключён, заявку нельзя одобрить. Ссылка «Задать пароль» действует ${OWNER_SETUP_DAYS} дней и один раз. Сообщения записаны в журнал «Телеграм» с типами «${TG_LEAD_KIND}» и «${TG_SETUP_KIND}». Тексты — Справочники платформы → «Шаблоны».</span></div>
        <button type="button" class="linkbtn" id="ltg-old">В макете: нажать «Старт» по устаревшей ссылке</button>`,
      foot:'<button class="btn cta" data-close>Готово</button>',
      mount(el){tgcBind(el,chat,()=>m.draw(),null);const g=$('#ltg-go',el),n=$('#ltg-n',el);
        if(g){const go=()=>{const name=n.value.replace(/\s+/g,' ').trim();if(!name){n.focus();return}const tok=o.tgTok&&o.tgTok.tok;leadTgChat(o).push({t:'/start',me:true,at:at()});const bad=leadTgStart(o,name,tok);if(bad)leadTgChat(o).push(bad);dbSoon();refreshAll()};
          g.onclick=go;n.onkeydown=e=>{if(e.key==='Enter')go()};n.focus()}
        $('#ltg-old',el).onclick=()=>{leadTgChat(o).push({t:'/start',me:true,at:at()},{t:tplFill('tgLeadLinkBad',{}),at:at()});dbSoon();m.draw()}}}}})}

// Страница «Задать пароль» (buhuchet.kg/setpass/<ссылка>): без входа, пароль — по тем же правилам, что при смене временного (не короче 8 символов).
// Ссылка истекла, уже использована или заменена новой — «Ссылка устарела»; новую отправляет администратор платформы из карточки организации
function setPassPage(tok){const r=ownerSetupFind(tok);if(typeof LAND==='object'&&LAND.open)landHide();
  let el=$('#login');if(!el){el=document.createElement('div');el.id='login';el.className='login';document.body.appendChild(el)}
  const head=`<div class="row" style="gap:11px">${logoSvg()}<div><div class="brand-name">Buhuchet.kg</div><div class="mode">Автоматизация бухгалтерского аутсорсинга</div></div></div>`;
  const back=S.loggedIn!==false?'<button class="linkbtn" id="sp-close" style="align-self:flex-start">В макете: вернуться в программу</button>':'';
  if(!r){el.innerHTML=`<div class="card">${head}<h2>Ссылка устарела</h2><p class="muted" style="margin:0">Ссылка, чтобы задать пароль, действует ${OWNER_SETUP_DAYS} дней и только один раз. Попросите администратора платформы отправить новую — она придёт в Telegram.</p><button class="btn cta" id="sp-login" style="justify-content:center">Ко входу</button>${back}</div>`}
  else el.innerHTML=`<div class="card">${head}<h2>Задайте пароль</h2><p class="muted" style="margin:0">${r.org?`Организация: ${esc(r.org.name)}. `:''}Логин для входа: <b class="mono">${esc(r.u.login)}</b>. Придумайте пароль — с ним вы будете входить в Buhuchet.kg.</p>${fld('Новый пароль',pwInp('sp-p1','','autocomplete="new-password"'),{id:'sp-p1',hint:'Не короче 8 символов'})}${fld('Повторите пароль',pwInp('sp-p2','','autocomplete="new-password"'),{id:'sp-p2'})}<button class="btn cta" id="sp-set" style="justify-content:center">Задать пароль</button>${back}</div>`;
  const done=()=>{if(S.loggedIn!==false)el.remove();else showLogin('login',{login:r?r.u.login:''})};
  const c=$('#sp-close',el);if(c)c.onclick=()=>el.remove();const lg=$('#sp-login',el);if(lg)lg.onclick=()=>{S.loggedIn=false;MODALS.slice().forEach(m=>m.close());showLogin()};
  if(!r)return;
  const go=()=>{const p=val(el,'sp-p1'),a=setErr(el,'sp-p1',p.length<8?'Пароль короче 8 символов':''),b=setErr(el,'sp-p2',p===val(el,'sp-p2')?'':'Пароли не совпадают');if(!a||!b)return;
    // Ссылку могли заменить новой, пока страница была открыта
    if(!ownerSetupFind(tok))return setPassPage(tok);
    const u=r.u;LG_PW[u.login]=p;delete u.noPass;delete u.setup;accUnlock(u);if(r.org)log('porg',r.org.id,`Владелец ${u.login} задал пароль по ссылке из Telegram`,null,{who:'system'});dbSoon();
    done();toast(`Пароль задан. Вход — с логином ${u.login}`,'key')};
  $('#sp-set',el).onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()};$('#sp-p1',el).focus()}
