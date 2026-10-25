'use strict';
// Вход и восстановление пароля
/* ═════════════ Login & password recovery ═════════════ */
function logoutDlg(){
  const dirty=MODALS.some(m=>m.o.form);
  const doOut=()=>{MODALS.slice().forEach(m=>m.close());S.loggedIn=false;showLogin()};
  if(dirty)confirmDlg({title:'Выйти без сохранения?',text:'В открытом окне есть несохранённые изменения. Если выйти сейчас, они пропадут.',ok:'Выйти',danger:true,run:doOut});else doOut();
}
function showLogin(step='login',ctx={}){
  let el=$('#login');if(!el){el=document.createElement('div');el.id='login';el.className='login';document.body.appendChild(el)}
  const head=`<div class="row" style="gap:11px"><div class="logo" aria-hidden="true"><i></i><i></i><i></i></div><div><div class="brand-name">Buhuchet.kg</div><div class="mode">Автоматизация бухгалтерского аутсорсинга</div></div></div>`;
  let body='';
  if(step==='login')body=`<h2>Вход</h2>${fld('Логин',inp('lg-login',ctx.login||'','autocomplete="username"'),{id:'lg-login'})}${fld('Пароль',inp('lg-pass','','type="password" autocomplete="current-password"'),{id:'lg-pass'})}<button class="btn cta" id="lg-go" style="justify-content:center">Войти</button><button class="linkbtn" id="lg-forgot" style="align-self:flex-start">Забыли пароль?</button><div class="note">${ic('info')}<span>Демо: логины <span class="mono">erkin</span>, <span class="mono">meerim</span>, <span class="mono">alisher</span>, <span class="mono">aigerim</span>, <span class="mono">nurlan</span>, <span class="mono">admin</span>; пароль <span class="mono">demo</span>. Логин <span class="mono">easybuh</span> показывает вход в заблокированную организацию.</span></div>`;
  if(step==='forgot')body=`<h2>Восстановление пароля</h2><p class="muted" style="margin:0">Введите логин. Бот пришлёт одноразовый код в привязанный Telegram. Код действует 10 минут.</p>${fld('Логин',inp('fg-login',ctx.login||''),{id:'fg-login'})}<button class="btn cta" id="fg-go" style="justify-content:center">${ic('tg')}Получить код</button><button class="linkbtn" id="fg-back" style="align-self:flex-start">Вернуться ко входу</button>`;
  if(step==='code')body=`<h2>Введите код</h2><div class="note">${ic('tg')}<span>Код отправлен в Telegram ${esc(ctx.tg)}. Демо-код: <b class="mono">482913</b></span></div>${fld('Код из Telegram',inp('fg-code','','inputmode="numeric" maxlength="6" class="inp mono"'),{id:'fg-code'})}${fld('Новый пароль',inp('fg-p1','','type="password" autocomplete="new-password"'),{id:'fg-p1',hint:'Не короче 8 символов'})}${fld('Повторите пароль',inp('fg-p2','','type="password" autocomplete="new-password"'),{id:'fg-p2'})}<button class="btn cta" id="fg-set" style="justify-content:center">Сменить пароль</button><div class="hint">После смены пароля все прежние сеансы завершатся, а бот сообщит о смене в Telegram.</div>`;
  el.innerHTML=`<div class="card">${head}${body}</div>`;
  const users=[...EMP,PLATFORM_ADMIN];
  const find=l=>users.find(u=>u.login===l.trim().toLowerCase());
  if(step==='login'){const go_=()=>{const u=find(val(el,'lg-login'));const okU=setErr(el,'lg-login',u?'':'Нет такого логина');const okP=setErr(el,'lg-pass',val(el,'lg-pass')==='demo'?'':'Неверный пароль. После 5 неверных попыток вход блокируется на 15 минут.');
      if(okU&&u.active===false){setErr(el,'lg-login','Учётная запись заблокирована. Обратитесь к владельцу организации.');return}
      if(okU&&okP){el.remove();S.loggedIn=true;switchUser(u.id)}};
    const go0=go_;const go2=()=>{const l=val(el,'lg-login').trim().toLowerCase();const ou=OTHER_USERS.find(x=>x.login===l);if(ou&&!find(l)){const org=ORGS.find(o=>o.id===ou.org);if(org&&org.active===false){setErr(el,'lg-login',`Организация ${org.name} заблокирована. Обратитесь к администратору платформы.`);return}if(ou.active===false){setErr(el,'lg-login','Учётная запись заблокирована. Обратитесь к владельцу организации.');return}setErr(el,'lg-login','В макете можно войти только в демо-организацию');return}go0()};
    $('#lg-go',el).onclick=go2;el.onkeydown=e=>{if(e.key==='Enter')go2()};$('#lg-forgot',el).onclick=()=>showLogin('forgot',{login:val(el,'lg-login')});$('#lg-login',el).focus()}
  if(step==='forgot'){$('#fg-back',el).onclick=()=>showLogin('login');$('#fg-go',el).onclick=()=>{const u=find(val(el,'fg-login'));if(!setErr(el,'fg-login',u?'':'Нет такого логина'))return;
      if(!u.tg){setErr(el,'fg-login',u.role==='owner'?'Telegram не привязан. Пароль сбросит администратор платформы.':'Telegram не привязан. Пароль сбросит владелец организации.');return}
      showLogin('code',{login:u.login,tg:u.tg})}}
  if(step==='code'){$('#fg-set',el).onclick=()=>{const a=setErr(el,'fg-code',val(el,'fg-code')==='482913'?'':'Код неверный или истёк');const p=val(el,'fg-p1');const b=setErr(el,'fg-p1',p.length>=8?'':'Пароль короче 8 символов');const c=setErr(el,'fg-p2',p===val(el,'fg-p2')?'':'Пароли не совпадают');
      if(a&&b&&c){showLogin('login',{login:ctx.login});toast('Пароль изменён. Войдите с новым паролем.','key')}}}
}

