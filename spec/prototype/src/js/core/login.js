'use strict';
// Вход и восстановление пароля
/* ═════════════ Login & password recovery ═════════════ */
function logoutDlg(){
  // «Выйти без сохранения?» — только если в открытой форме есть несохранённые изменения (решение заказчика 26.10.2026), как при закрытии окна
  const dirty=MODALS.some(m=>m.o.form&&m.dirty);
  const doOut=()=>{MODALS.slice().forEach(m=>m.close());S.loggedIn=false;showLogin()};
  if(dirty)confirmDlg({title:'Выйти без сохранения?',text:'В открытом окне есть несохранённые изменения. Если выйти сейчас, они пропадут.',ok:'Выйти',danger:true,run:doOut});else doOut();
}
// Сообщения на странице входа не выдают, есть ли такой логин (решение заказчика 26.10.2026, v59). Неверные попытки считаются по логину, в том числе несуществующему: 5 подряд — вход по нему закрыт на 15 минут. В макете счётчик живёт до перезагрузки страницы, в продукте его ведёт сервер
const LG_FAIL={},LG_MAX=5,LG_LOCK=15*60*1000;
// Пароли, сменённые в макете (первый вход, «Забыли пароль?», «Мой профиль»), — до перезагрузки страницы; остальные входят с паролем demo. У сотрудника с временным паролем (e.tmpPass) подходит только он
const LG_PW={};const lgPass=u=>u.tmpPass||LG_PW[u.login]||'demo';
const LG_T={bad:'Неверный логин или пароль',lock:'Вход временно закрыт: слишком много неверных попыток. Попробуйте через 15 минут.',user:'Учётная запись заблокирована. Обратитесь к владельцу организации.',org:'Организация заблокирована. Обратитесь к администратору платформы.',demo:'В макете можно войти только в демо-организацию',code:'Если к логину привязан Telegram, бот пришлёт код. Если код не пришёл, пароль сбросит владелец организации.',same:'Новый пароль совпадает с текущим'};
// «Забыли пароль?» (решение заказчика 30.10.2026, п. 9): один код можно ввести не больше 5 раз, дальше он не действует; после 10 неверных кодов за 24 часа восстановление через Telegram по логину закрыто на 24 часа — пароль сбросит владелец. Код запрашивается не больше 3 раз в час на логин: сверх этого код не отправляется, ответ на экране тот же. Счётчики — по логину, в том числе несуществующему; в макете живут до перезагрузки страницы, в продукте их ведёт сервер
const FG={},FG_TRIES=5,FG_BAD=10,FG_REQ=3,FG_H=3600*1000,FG_DAY=24*FG_H;
const fgSt=l=>{const st=FG[l]=FG[l]||{req:[],bad:[],tries:0,till:0},now=Date.now();st.req=st.req.filter(t=>now-t<FG_H);st.bad=st.bad.filter(t=>now-t<FG_DAY);if(st.till&&st.till<=now)st.till=0;return st};
Object.assign(LG_T,{fgDead:'Код больше не действует: его ввели 5 раз. Запросите новый код.',fgLock:'Восстановление через Telegram закрыто на 24 часа: слишком много неверных кодов. Пароль сбросит владелец организации.'});
const find0=l=>[...EMP,PLATFORM_ADMIN].find(u=>u.login===String(l).trim().toLowerCase());
function showLogin(step='login',ctx={}){
  let el=$('#login');if(!el){el=document.createElement('div');el.id='login';el.className='login';document.body.appendChild(el)}
  const head=`<div class="row" style="gap:11px"><div class="logo" aria-hidden="true"><i></i><i></i><i></i></div><div><div class="brand-name">Buhuchet.kg</div><div class="mode">Автоматизация бухгалтерского аутсорсинга</div></div></div>`;
  const M=s=>`<span class="mono">${s}</span>`;
  let body='';
  if(step==='login')body=`<h2>Вход</h2>${fld('Логин',inp('lg-login',ctx.login||'','autocomplete="username"'),{id:'lg-login'})}${fld('Пароль',inp('lg-pass','','type="password" autocomplete="current-password"'),{id:'lg-pass'})}<div class="note bad" id="lg-msg" role="alert" hidden></div><button class="btn cta" id="lg-go" style="justify-content:center">Войти</button><button class="linkbtn" id="lg-forgot" style="align-self:flex-start">Забыли пароль?</button><div class="note">${ic('info')}<span>Демо: логины ${['erkin','meerim','alisher','aigerim','nurlan','admin'].map(M).join(', ')}; пароль ${M('demo')}. Логин ${M('bakyt')} — заблокированный сотрудник, ${M('easybuh')} — заблокированная организация. После 5 неверных попыток подряд вход по логину закрыт на 15 минут (в макете — до перезагрузки страницы). Сотрудник, которого создали или которому сбросили пароль в «Сотрудниках», входит с временным паролем и сразу задаёт свой; сменённые пароли действуют до перезагрузки страницы.</span></div>`;
  if(step==='forgot')body=`<h2>Восстановление пароля</h2><p class="muted" style="margin:0">Введите логин и нажмите «Получить код».</p>${fld('Логин',inp('fg-login',ctx.login||'','autocomplete="username"'),{id:'fg-login'})}<button class="btn cta" id="fg-go" style="justify-content:center">${ic('tg')}Получить код</button><button class="linkbtn" id="fg-back" style="align-self:flex-start">Вернуться ко входу</button>`;
  // Вход с временным паролем: в программу не пускает, пока пароль не сменён; новый пароль не совпадает с текущим (решение заказчика 27.10.2026). Тексты — как в продукте (auth-texts.ts)
  if(step==='first')body=`<h2>Смените временный пароль</h2><p class="muted" style="margin:0">Вы вошли с временным паролем. Придумайте свой: пока пароль не сменён, работать в программе нельзя.</p>${fld('Новый пароль',inp('fp-p1','','type="password" autocomplete="new-password"'),{id:'fp-p1',hint:'Не короче 8 символов'})}${fld('Повторите пароль',inp('fp-p2','','type="password" autocomplete="new-password"'),{id:'fp-p2'})}<button class="btn cta" id="fp-set" style="justify-content:center">Сменить пароль</button><button class="linkbtn" id="fp-back" style="align-self:flex-start">Выйти из аккаунта</button>`;
  // После смены временного пароля без привязанного Telegram — «Привяжите Telegram» (ТЗ: привязка предлагается при первом входе); в макете привязку изображает «Демо: привязать»
  // Тексты — как в продукте (auth-texts.ts); «Позже» сразу пускает в программу, привязать можно потом в «Мой профиль»
  if(step==='tglink'){const u=find0(ctx.login||'');body=`<h2>Привяжите Telegram</h2><p class="muted" style="margin:0">Бот будет напоминать о сроках отчётов и пришлёт код, если вы забудете пароль. Откройте ссылку в Telegram — бот привяжет чат и пришлёт подтверждение.</p>${u&&u.tg?`<div class="note ok">${ic('check')}<span>Telegram привязан</span></div><button class="btn cta" id="tl-go" style="justify-content:center">Продолжить</button>`:`<div class="row" style="flex-wrap:wrap"><span class="mono" style="overflow-wrap:anywhere">t.me/buhuchet_bot?start=a7f3c91e</span><button class="btn sm" id="tl-copy">${ic('copy','sm')}Скопировать ссылку</button><button class="btn sm cta" id="tl-demo">Демо: привязать</button></div><div class="hint">Ссылка одноразовая и действует 15 минут. Бот проверит её, привяжет чат и пришлёт подтверждение.</div><button class="btn" id="tl-go" style="justify-content:center">Позже</button>`}`}
  if(step==='code')body=`<h2>Введите код</h2><div class="note">${ic('tg')}<span>${LG_T.code} Код действует 10 минут. Демо-код: <b class="mono">482913</b> — подходит, если к логину привязан Telegram (у ${M('nurlan')} не привязан). Один код — не больше 5 вводов; после 10 неверных кодов за сутки восстановление через Telegram закрыто на 24 часа (в макете — до перезагрузки страницы).</span></div>${fld('Код из Telegram',inp('fg-code','','inputmode="numeric" maxlength="6" class="inp mono"'),{id:'fg-code'})}${fld('Новый пароль',inp('fg-p1','','type="password" autocomplete="new-password"'),{id:'fg-p1',hint:'Не короче 8 символов'})}${fld('Повторите пароль',inp('fg-p2','','type="password" autocomplete="new-password"'),{id:'fg-p2'})}<button class="btn cta" id="fg-set" style="justify-content:center">Сменить пароль</button><button class="linkbtn" id="fg-back" style="align-self:flex-start">Вернуться ко входу</button><div class="hint">После смены пароля все прежние сеансы завершатся, а бот сообщит о смене в Telegram.</div>`;
  el.innerHTML=`<div class="card">${head}${body}</div>`;
  const find=find0;
  if(step==='login'){const box=$('#lg-msg',el),msg=t=>{box.hidden=!t;box.innerHTML=t?ic('alert','sm')+`<span>${esc(t)}</span>`:''};
    const go=()=>{const l=val(el,'lg-login').trim().toLowerCase(),p=val(el,'lg-pass');msg('');
      const a=setErr(el,'lg-login',l?'':'Введите логин'),b=setErr(el,'lg-pass',p?'':'Введите пароль');if(!a||!b)return;
      const now=Date.now();let f=LG_FAIL[l];if(f&&f.till&&f.till<=now)f=LG_FAIL[l]=null;
      if(f&&f.till)return msg(LG_T.lock);
      // Пароль в макете у всех — demo; несуществующий логин — такая же неверная попытка, как неверный пароль
      const u=find(l),ou=!u&&OTHER_USERS.find(x=>x.login===l);
      if(!(u||ou)||p!==(u?lgPass(u):'demo')){f=LG_FAIL[l]=f||{n:0,till:0};if(++f.n>=LG_MAX){f.till=now+LG_LOCK;return msg(LG_T.lock)}return msg(LG_T.bad)}
      delete LG_FAIL[l];
      // О блокировке сотрудника или организации — только после верного пароля и без названия организации
      if(ou){const org=ORGS.find(o=>o.id===ou.org);return msg(org&&org.active===false?LG_T.org:ou.active===false?LG_T.user:LG_T.demo)}
      if(u.active===false)return msg(LG_T.user);
      if(u.tmpPass)return showLogin('first',{login:l});
      el.remove();S.loggedIn=true;switchUser(u.id)};
    $('#lg-go',el).onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()};$('#lg-forgot',el).onclick=()=>showLogin('forgot',{login:val(el,'lg-login')});$('#lg-login',el).focus()}
  // «Забыли пароль?»: ответ один для любого логина, дальше всегда ввод кода
  if(step==='forgot'){$('#fg-back',el).onclick=()=>showLogin('login',{login:val(el,'fg-login')});const go=()=>{const l=val(el,'fg-login').trim().toLowerCase();if(!setErr(el,'fg-login',l?'':'Введите логин'))return;
      // Новый код — только если не превышен предел запросов и восстановление не закрыто; прежний код при этом перестаёт действовать. Отправка кода пишется в журнал Telegram без текста кода
      const st=fgSt(l),u=find(l);if(!st.till&&st.req.length<FG_REQ){st.req.push(Date.now());st.tries=0;if(u&&u.tg)tgSvc(u,TG_CODE)}showLogin('code',{login:l})};
    $('#fg-go',el).onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()};$('#fg-login',el).focus()}
  if(step==='first'){const u=find(ctx.login||'');$('#fp-back',el).onclick=()=>showLogin('login',{login:ctx.login});const go=()=>{const p=val(el,'fp-p1');
      const a=setErr(el,'fp-p1',p.length<8?'Пароль короче 8 символов':u&&p===lgPass(u)?LG_T.same:''),b=setErr(el,'fp-p2',p===val(el,'fp-p2')?'':'Пароли не совпадают');if(!a||!b||!u)return;
      LG_PW[u.login]=p;delete u.tmpPass;log('emp',u.id,'Временный пароль заменён своим');if(!u.tg&&u.id!=='admin')return showLogin('tglink',{login:u.login});el.remove();S.loggedIn=true;switchUser(u.id)};
    $('#fp-set',el).onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()};$('#fp-p1',el).focus()}
  if(step==='tglink'){const u=find(ctx.login||'');el.onkeydown=null;const cp=$('#tl-copy',el);if(cp)cp.onclick=()=>copyText('https://t.me/buhuchet_bot?start=a7f3c91e','Ссылка скопирована');
    const dm=$('#tl-demo',el);if(dm)dm.onclick=()=>{u.tg='@'+u.login;log('emp',u.id,'Telegram привязан');tgSvc(u,'Telegram привязан');showLogin('tglink',ctx)};const gb=$('#tl-go',el);if(gb){gb.onclick=()=>{el.remove();S.loggedIn=true;switchUser(u.id)};gb.focus()}}
  // «Забыли пароль?»: совпадение с текущим не проверяется (решение заказчика 27.10.2026)
  if(step==='code'){el.onkeydown=null;$('#fg-back',el).onclick=()=>showLogin('login',{login:ctx.login});$('#fg-set',el).onclick=()=>{const l=ctx.login||'',u=find(l),k=val(el,'fg-code').trim();const p=val(el,'fg-p1');const b=setErr(el,'fg-p1',p.length>=8?'':'Пароль короче 8 символов');const c=setErr(el,'fg-p2',p===val(el,'fg-p2')?'':'Пароли не совпадают');
      if(!setErr(el,'fg-code',k?'':'Введите код из Telegram')||!b||!c)return;
      // Каждый ввод кода считается; верный код после 5 вводов уже не подходит
      const st=fgSt(l);let e='';if(st.till)e=LG_T.fgLock;else if(st.tries>=FG_TRIES)e=LG_T.fgDead;else{st.tries++;if(!(k==='482913'&&u&&u.tg)){st.bad.push(Date.now());e=st.bad.length>=FG_BAD?(st.till=Date.now()+FG_DAY,LG_T.fgLock):st.tries>=FG_TRIES?LG_T.fgDead:'Код неверный или истёк'}}
      if(!setErr(el,'fg-code',e))return;
      delete FG[l];LG_PW[u.login]=p;delete u.tmpPass;tgSvc(u,'Пароль изменён');showLogin('login',{login:ctx.login});toast('Пароль изменён. Войдите с новым паролем.','key')};$('#fg-code',el).focus()}
}
