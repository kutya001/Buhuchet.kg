'use strict';
// Вход и восстановление пароля
/* ═════════════ Login & password recovery ═════════════ */
function logoutDlg(){if(DEMO.on)return demoExit('site');// в демо-версии экрана входа нет
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
// Вход закрыт после 10 неверных паролей подряд (решение заказчика 07.11.2026): счёт ведётся у учётной записи (pwBad) и со временем не забывается, верный пароль обнуляет его; на 10-м подряд вход закрыт (pwLocked), пока не выдадут новый пароль: сотруднику — владелец или администратор платформы, владельцу — администратор платформы. Попытки, отбитые 15-минутным запретом по логину, в счёт не идут. Уже открытые сеансы блокировка не закрывает. У администратора платформы этой блокировки нет. В макете счёт и блокировка хранятся в данных, а 15-минутный запрет — до перезагрузки страницы
const LG_ACC=10;
Object.assign(LG_T,{acc:'Вход заблокирован: 10 неверных паролей подряд. Обратитесь к владельцу организации — он выдаст новый пароль.',accOwner:'Вход заблокирован: 10 неверных паролей подряд. Обратитесь к администратору платформы — он выдаст новый пароль.'});
const accIsOwner=u=>EMP.includes(u)?u.role==='owner':ORGS.some(o=>o.owner===u.login);
// Кому писать в Telegram: у пользователей других организаций Telegram в макете считается привязанным
const tgOf=u=>EMP.includes(u)||u.id==='admin'?u:{fio:u.fio,login:u.login,tg:'@'+u.login};
const accOrg=u=>EMP.includes(u)?'':orgName(u.org);
// Владельцы организации пользователя с привязанным Telegram, кроме него самого
function accOwners(u){if(EMP.includes(u))return EMP.filter(e=>e.role==='owner'&&e.active!==false&&e.tg&&e!==u);const o=ORGS.find(x=>x.id===u.org),w=o&&OTHER_USERS.find(x=>x.login===o.owner);return w&&w!==u&&w.active!==false?[w]:[]}
function accLockFail(u){if(!u||u.id==='admin'||u.pwLocked)return;u.pwBad=(u.pwBad||0)+1;if(u.pwBad<LG_ACC)return;
  u.pwLocked=nowStamp();const own=accIsOwner(u),org=accOrg(u);
  if(EMP.includes(u))log('emp',u.id,'Вход заблокирован: 10 неверных паролей подряд',null,{who:'system'});
  // «Telegram: вход заблокирован» — самому пользователю; «…вход сотрудника заблокирован» — владельцам организации; «…вход владельца заблокирован» — администраторам платформы
  tgSvc(tgOf(u),'Вход заблокирован',{org});(own?leadAdmins():accOwners(u)).forEach(w=>tgSvc(tgOf(w),'Вход заблокирован',{org:own?'':org}))}
// Новый пароль от владельца или администратора платформы снимает блокировку и счёт неверных паролей
const accUnlock=u=>{if(u){u.pwBad=0;delete u.pwLocked}};
// Вход администратора платформы — с кодом из Telegram после пароля (решение заказчика 07.11.2026): код из 6 цифр действует 5 минут и 5 вводов, новый вход отменяет прежний код; кодов не больше 3 за 15 минут и 10 за сутки без входа (коды, по которым вошли, в суточный предел не считаются). Код привязан к паролю: после смены пароля прежний код не подходит, пределы считаются заново. В продукте код нужен на стенде и рабочем сайте; в макете бот подключён и всегда принимает сообщение, счётчики живут до перезагрузки страницы
const ADMC={sent:[],code:null},ADM_TTL=5*60*1000,ADM_TRIES=5,ADM_Q=3,ADM_QT=15*60*1000,ADM_DAY=10,ADM_CODE='731604';
Object.assign(LG_T,{admBad:'Код неверный или истёк. После 5 неверных кодов войдите заново.',admQ:'Слишком много кодов для входа. Попробуйте через 15 минут.',admDay:'Слишком много кодов для входа за сутки. Если вы не входили, кто-то знает ваш пароль: смените его кнопкой «Забыли пароль?» — вход откроется.',
  // Бот не подключён или не принял сообщение — в макете не бывает, тексты как в продукте
  admNoBot:'Telegram-бот не подключён: вход в Админку невозможен без кода из Telegram.',admSend:'Не удалось отправить код в Telegram. Попробуйте войти ещё раз через минуту.'});
const admReset=()=>{ADMC.sent=[];ADMC.code=null};
// Верный пароль администратора: без Telegram — «Привяжите Telegram»; сверх пределов — сообщение на странице входа; иначе бот присылает код (в журнал — тип «Код восстановления», без текста кода)
function admStart(l,msg){const u=PLATFORM_ADMIN,now=Date.now();ADMC.sent=ADMC.sent.filter(x=>now-x.at<FG_DAY);
  if(!u.tg)return showLogin('admtg',{login:l});
  if(ADMC.sent.filter(x=>now-x.at<ADM_QT).length>=ADM_Q)return msg(LG_T.admQ);
  if(ADMC.sent.filter(x=>!x.used).length>=ADM_DAY)return msg(LG_T.admDay);
  const c={at:now,tries:0,used:false};ADMC.sent.push(c);ADMC.code=c;tgSvc(u,TG_CODE);showLogin('admcode',{login:l})}
function showLogin(step='login',ctx={}){
  let el=$('#login');if(!el){el=document.createElement('div');el.id='login';el.className='login';document.body.appendChild(el)}
  const head=`<div class="row" style="gap:11px">${logoSvg()}<div><div class="brand-name">Buhuchet.kg</div><div class="mode">Автоматизация бухгалтерского аутсорсинга</div></div></div>`;
  const M=s=>`<span class="mono">${s}</span>`;
  let body='';
  if(step==='login')body=`<h2>Вход</h2>${fld('Логин',inp('lg-login',ctx.login||'','autocomplete="username"'),{id:'lg-login'})}${fld('Пароль',pwInp('lg-pass','','autocomplete="current-password"'),{id:'lg-pass'})}<div class="note bad" id="lg-msg" role="alert" hidden></div><button class="btn cta" id="lg-go" style="justify-content:center">Войти</button><div class="row" style="justify-content:space-between;flex-wrap:wrap"><button class="linkbtn" id="lg-forgot">Забыли пароль?</button><button class="linkbtn" id="lg-about">О платформе</button></div><div class="note">${ic('info')}<span>Демо: логины ${['erkin','meerim','alisher','aigerim','nurlan','admin'].map(M).join(', ')}; пароль ${M('demo')}. Логин ${M('bakyt')} — заблокированный сотрудник, ${M('easybuh')} — заблокированная организация, у ${M('jyldyz')} вход закрыт после 10 неверных паролей подряд (снимет «Сбросить пароль» владельца). После 5 неверных попыток подряд вход по логину закрыт на 15 минут (в макете — до перезагрузки страницы); после 10 подряд вход в учётную запись закрыт, пока не выдадут новый пароль. Администратор платформы после пароля вводит код из Telegram. Сотрудник, которого создали или которому сбросили пароль в «Сотрудниках», входит с временным паролем и сразу задаёт свой; сменённые пароли действуют до перезагрузки страницы.</span></div>`;
  if(step==='forgot')body=`<h2>Восстановление пароля</h2><p class="muted" style="margin:0">Введите логин и нажмите «Получить код».</p>${fld('Логин',inp('fg-login',ctx.login||'','autocomplete="username"'),{id:'fg-login'})}<button class="btn cta" id="fg-go" style="justify-content:center">${ic('tg')}Получить код</button><button class="linkbtn" id="fg-back" style="align-self:flex-start">Вернуться ко входу</button>`;
  // Вход с временным паролем: в программу не пускает, пока пароль не сменён; новый пароль не совпадает с текущим (решение заказчика 27.10.2026). Тексты — как в продукте (auth-texts.ts)
  if(step==='first')body=`<h2>Смените временный пароль</h2><p class="muted" style="margin:0">Вы вошли с временным паролем. Придумайте свой: пока пароль не сменён, работать в программе нельзя.</p>${fld('Новый пароль',pwInp('fp-p1','','autocomplete="new-password"'),{id:'fp-p1',hint:'Не короче 8 символов'})}${fld('Повторите пароль',pwInp('fp-p2','','autocomplete="new-password"'),{id:'fp-p2'})}<button class="btn cta" id="fp-set" style="justify-content:center">Сменить пароль</button><button class="linkbtn" id="fp-back" style="align-self:flex-start">Выйти из аккаунта</button>`;
  // После смены временного пароля без привязанного Telegram — «Привяжите Telegram» (ТЗ: привязка предлагается при первом входе); в макете привязку изображает «Демо: привязать»
  // Тексты — как в продукте (auth-texts.ts); «Позже» сразу пускает в программу, привязать можно потом в «Мой профиль»
  if(step==='tglink'){const u=find0(ctx.login||'');body=`<h2>Привяжите Telegram</h2><p class="muted" style="margin:0">Бот будет напоминать о сроках отчётов и пришлёт код, если вы забудете пароль. Откройте ссылку в Telegram — бот привяжет чат и пришлёт подтверждение.</p>${u&&u.tg?`<div class="note ok">${ic('check')}<span>Telegram привязан</span></div><button class="btn cta" id="tl-go" style="justify-content:center">Продолжить</button>`:`<div class="row" style="flex-wrap:wrap"><span class="mono" style="overflow-wrap:anywhere">t.me/buhuchet_bot?start=a7f3c91e</span><button class="btn sm" id="tl-copy">${ic('copy','sm')}Скопировать ссылку</button><button class="btn sm cta" id="tl-demo">Демо: привязать</button></div><div class="hint">Ссылка одноразовая и действует 15 минут. Бот проверит её, привяжет чат и пришлёт подтверждение.</div><button class="btn" id="tl-go" style="justify-content:center">Позже</button>`}`}
  // Вход администратора платформы: код из Telegram после пароля (решение заказчика 07.11.2026); тексты — как в продукте (auth-texts.ts)
  if(step==='admcode')body=`<h2>Код для входа в Админку</h2><div class="note">${ic('tg')}<span>Бот прислал код в ваш Telegram. Код действует 5 минут.</span></div>${fld('Код из Telegram',inp('ac-code','','inputmode="numeric" maxlength="6" autocomplete="one-time-code" class="inp mono"'),{id:'ac-code'})}<button class="btn cta" id="ac-go" style="justify-content:center">Войти</button><button class="linkbtn" id="ac-back" style="align-self:flex-start">Вернуться ко входу</button><div class="hint">Демо-код: <b class="mono">${ADM_CODE}</b> · <button class="linkbtn" id="ac-bot">показать сообщение бота</button>. Один код — не больше 5 вводов; кодов не больше 3 за 15 минут и 10 за сутки (в макете — до перезагрузки страницы).</div>`;
  // Администратор платформы без Telegram: войти можно только с кодом, поэтому сначала привязка; ссылку видит только тот, кто ввёл верный пароль. «Демо: привязать» изображает привязку в макете
  if(step==='admtg')body=`<h2>Привяжите Telegram</h2><p class="muted" style="margin:0">Чтобы войти в Админку, нужен код из Telegram. Откройте ссылку в Telegram и нажмите «Старт» — бот привяжет чат. Затем войдите снова.</p><div class="row" style="flex-wrap:wrap"><span class="mono" style="overflow-wrap:anywhere">t.me/buhuchet_bot?start=c41d8e07</span><button class="btn sm" id="at-copy">${ic('copy','sm')}Скопировать ссылку</button>${PLATFORM_ADMIN.tg?'':`<button class="btn sm cta" id="at-demo">Демо: привязать${PLATFORM_ADMIN.tgPrev?' тот же Telegram':''}</button>`}</div><button class="btn cta" id="at-go" style="justify-content:center">Telegram привязан — войти</button>`;
  if(step==='code')body=`<h2>Введите код</h2><div class="note">${ic('tg')}<span>${LG_T.code} Код действует 10 минут. Демо-код: <b class="mono">482913</b> (<button class="linkbtn" id="fg-bot">показать сообщение бота</button>) — подходит, если к логину привязан Telegram (у ${M('nurlan')} не привязан). Один код — не больше 5 вводов; после 10 неверных кодов за сутки восстановление через Telegram закрыто на 24 часа (в макете — до перезагрузки страницы).</span></div>${fld('Код из Telegram',inp('fg-code','','inputmode="numeric" maxlength="6" class="inp mono"'),{id:'fg-code'})}${fld('Новый пароль',pwInp('fg-p1','','autocomplete="new-password"'),{id:'fg-p1',hint:'Не короче 8 символов'})}${fld('Повторите пароль',pwInp('fg-p2','','autocomplete="new-password"'),{id:'fg-p2'})}<button class="btn cta" id="fg-set" style="justify-content:center">Сменить пароль</button><button class="linkbtn" id="fg-back" style="align-self:flex-start">Вернуться ко входу</button><div class="hint">После смены пароля все прежние сеансы завершатся, а бот сообщит о смене в Telegram.</div>`;
  el.innerHTML=`<div class="card">${head}${body}</div>`;
  const find=find0;
  if(step==='login'){const box=$('#lg-msg',el),msg=t=>{box.hidden=!t;box.innerHTML=t?ic('alert','sm')+`<span>${esc(t)}</span>`:''};
    const go=()=>{const l=val(el,'lg-login').trim().toLowerCase(),p=val(el,'lg-pass');msg('');
      const a=setErr(el,'lg-login',l?'':'Введите логин'),b=setErr(el,'lg-pass',p?'':'Введите пароль');if(!a||!b)return;
      const now=Date.now();let f=LG_FAIL[l];if(f&&f.till&&f.till<=now)f=LG_FAIL[l]=null;
      if(f&&f.till)return msg(LG_T.lock);
      // Пароль в макете у всех — demo; несуществующий логин — такая же неверная попытка, как неверный пароль
      const u=find(l),ou=!u&&OTHER_USERS.find(x=>x.login===l);
      // Неверный пароль настоящей учётной записи идёт и в её счёт: на 10-м подряд вход закрыт до нового пароля
      if(!(u||ou)||p!==lgPass(u||ou)){accLockFail(u||ou);f=LG_FAIL[l]=f||{n:0,till:0};if(++f.n>=LG_MAX){f.till=now+LG_LOCK;return msg(LG_T.lock)}return msg(LG_T.bad)}
      delete LG_FAIL[l];
      // О блокировке сотрудника, организации и о закрытом входе — только после верного пароля и без названия организации; верный пароль обнуляет счёт неверных, если вход не закрыт
      const lk=a=>{if(a.pwLocked){msg(accIsOwner(a)?LG_T.accOwner:LG_T.acc);return true}a.pwBad=0;return false};
      if(ou){const org=ORGS.find(o=>o.id===ou.org);if(org&&org.active===false)return msg(LG_T.org);if(ou.active===false)return msg(LG_T.user);if(lk(ou))return;return msg(LG_T.demo)}
      if(u.active===false)return msg(LG_T.user);
      if(u.id==='admin')return admStart(l,msg);
      if(lk(u))return;
      if(u.tmpPass)return showLogin('first',{login:l});
      el.remove();S.loggedIn=true;switchUser(u.id);buIntro()};
    $('#lg-go',el).onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()};$('#lg-forgot',el).onclick=()=>showLogin('forgot',{login:val(el,'lg-login')});$('#lg-about',el).onclick=()=>{location.hash='#landing'};$('#lg-login',el).focus()}
  // «Забыли пароль?»: ответ один для любого логина, дальше всегда ввод кода
  if(step==='forgot'){$('#fg-back',el).onclick=()=>showLogin('login',{login:val(el,'fg-login')});const go=()=>{const l=val(el,'fg-login').trim().toLowerCase();if(!setErr(el,'fg-login',l?'':'Введите логин'))return;
      // Новый код — только если не превышен предел запросов и восстановление не закрыто; прежний код при этом перестаёт действовать. Отправка кода пишется в журнал Telegram без текста кода
      // Вход закрыт после 10 неверных паролей — код не уходит, ответ на экране тот же
      const st=fgSt(l),u=find(l);if(!st.till&&st.req.length<FG_REQ){st.req.push(Date.now());st.tries=0;if(u&&u.tg&&!u.pwLocked)tgSvc(u,TG_CODE)}showLogin('code',{login:l})};
    $('#fg-go',el).onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()};$('#fg-login',el).focus()}
  if(step==='first'){const u=find(ctx.login||'');$('#fp-back',el).onclick=()=>showLogin('login',{login:ctx.login});const go=()=>{const p=val(el,'fp-p1');
      const a=setErr(el,'fp-p1',p.length<8?'Пароль короче 8 символов':u&&p===lgPass(u)?LG_T.same:''),b=setErr(el,'fp-p2',p===val(el,'fp-p2')?'':'Пароли не совпадают');if(!a||!b||!u)return;
      LG_PW[u.login]=p;delete u.tmpPass;log('emp',u.id,'Временный пароль заменён своим');if(!u.tg&&u.id!=='admin')return showLogin('tglink',{login:u.login});el.remove();S.loggedIn=true;switchUser(u.id);buIntro()};
    $('#fp-set',el).onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()};$('#fp-p1',el).focus()}
  if(step==='tglink'){const u=find(ctx.login||'');el.onkeydown=null;const cp=$('#tl-copy',el);if(cp)cp.onclick=()=>copyText('https://t.me/buhuchet_bot?start=a7f3c91e','Ссылка скопирована');
    const dm=$('#tl-demo',el);if(dm)dm.onclick=()=>{u.tg=u.tgPrev||'@'+u.login;delete u.tgPrev;log('emp',u.id,'Telegram привязан');tgSvc(u,'Telegram привязан');showLogin('tglink',ctx)};const gb=$('#tl-go',el);if(gb){gb.onclick=()=>{el.remove();S.loggedIn=true;switchUser(u.id);buIntro()};gb.focus()}}
  // Код для входа в Админку: каждый ввод считается; неверный, истёкший или использованный код — одно сообщение; сеанс — только после верного кода
  // Поток Т (13.11.2026): сообщение бота с кодом — код первым в тексте, копируется нажатием на код и кнопкой «Скопировать код»
  if(step==='admcode')$('#ac-bot',el).onclick=()=>tgBotDlg(PLATFORM_ADMIN,[tgCodeMsg('tgAdminCode',{логин:ctx.login||PLATFORM_ADMIN.login,код:ADM_CODE,минут:5},bishkekNow().hm)],{sub:'Сообщение с кодом для входа в Админку'});
  if(step==='code')$('#fg-bot',el).onclick=()=>tgBotDlg(null,[tgCodeMsg('tgCode',{код:'482913'},bishkekNow().hm)],{sub:'Сообщение с кодом восстановления пароля'});
  if(step==='admcode'){$('#ac-back',el).onclick=()=>showLogin('login',{login:ctx.login});const go=()=>{const k=val(el,'ac-code').trim();if(!setErr(el,'ac-code',k?'':'Введите код из Telegram'))return;
      const c=ADMC.code;let ok=false;if(c&&!c.used&&c.tries<ADM_TRIES&&Date.now()-c.at<ADM_TTL){c.tries++;ok=k===ADM_CODE}
      if(!setErr(el,'ac-code',ok?'':LG_T.admBad))return;c.used=true;ADMC.code=null;el.remove();S.loggedIn=true;switchUser('admin');buIntro()};
    $('#ac-go',el).onclick=go;el.onkeydown=e=>{if(e.key==='Enter')go()};$('#ac-code',el).focus()}
  // «Telegram привязан — войти» возвращает ко входу: после привязки — вход с кодом
  if(step==='admtg'){el.onkeydown=null;const u=PLATFORM_ADMIN;$('#at-copy',el).onclick=()=>copyText('https://t.me/buhuchet_bot?start=c41d8e07','Ссылка скопирована');
    const dm=$('#at-demo',el);if(dm)dm.onclick=()=>{u.tg=u.tgPrev||'@buhuchet_admin';delete u.tgPrev;tgSvc(u,'Telegram привязан');toast('Telegram привязан','tg');showLogin('admtg',ctx)};
    const gb=$('#at-go',el);gb.onclick=()=>showLogin('login',{login:ctx.login});gb.focus()}
  // «Забыли пароль?»: совпадение с текущим не проверяется (решение заказчика 27.10.2026)
  if(step==='code'){el.onkeydown=null;$('#fg-back',el).onclick=()=>showLogin('login',{login:ctx.login});$('#fg-set',el).onclick=()=>{const l=ctx.login||'',u=find(l),k=val(el,'fg-code').trim();const p=val(el,'fg-p1');const b=setErr(el,'fg-p1',p.length>=8?'':'Пароль короче 8 символов');const c=setErr(el,'fg-p2',p===val(el,'fg-p2')?'':'Пароли не совпадают');
      if(!setErr(el,'fg-code',k?'':'Введите код из Telegram')||!b||!c)return;
      // Каждый ввод кода считается; верный код после 5 вводов уже не подходит
      const st=fgSt(l);let e='';if(st.till)e=LG_T.fgLock;else if(st.tries>=FG_TRIES)e=LG_T.fgDead;else{st.tries++;if(!(k==='482913'&&u&&u.tg&&!u.pwLocked)){st.bad.push(Date.now());e=st.bad.length>=FG_BAD?(st.till=Date.now()+FG_DAY,LG_T.fgLock):st.tries>=FG_TRIES?LG_T.fgDead:'Код неверный или истёк'}}
      if(!setErr(el,'fg-code',e))return;
      delete FG[l];LG_PW[u.login]=p;delete u.tmpPass;u.pwBad=0;if(u.id==='admin')admReset();tgSvc(u,'Пароль изменён');showLogin('login',{login:ctx.login});toast('Пароль изменён. Войдите с новым паролем.','key')};$('#fg-code',el).focus()}
}
