'use strict';
// Оболочка: левая панель, нижняя панель телефона, меню «≡», страница модуля, верхняя панель, демо-панель
/* ═════════════ Shell rendering ═════════════ */
function counts(){const vr=visReports();const[w0,w1]=weekRange();
  const overdue=vr.filter(r=>r.overdue||r.payOverdue).length;
  const week=vr.filter(r=>inWeek(r,w0,w1)).length;
  const waiting=repWaitList().length;
  return {overdue,week,waiting}}
function inWeek(r,w0,w1){if(CPM[r.cp].paused)return false;return (OPEN.has(r.status)&&!tR(r).payOnly&&r.due>=w0&&r.due<=w1)||(feat('taxpay')&&['Не оплачено','Оплачено частично'].includes(r.payStatus)&&r.sum>0&&r.payDue>=w0&&r.payDue<=w1)}
function renderSide(){
  const l=mods();const u=me();
  let h=`<div class="brand"><div class="logo" aria-hidden="true"><i></i><i></i><i></i></div><div><div class="brand-name">Buhuchet.kg</div><div class="mode">${isAdmin()?'Admin':'Business'}</div></div></div><nav class="tree">`;
  const cn=isAdmin()?{}:counts();
  l.filter(m=>!m.hidden).forEach(m=>{const tabs=modTabs(m);const open=S.open.has(m.id);const on=S.mod===m.id;
    const badge=m.id==='reports'&&cn.overdue?`<span class="badge red" title="Просрочено">${cn.overdue}</span>`:m.id==='kpi'?kMissBadge():m.id==='kb'&&newsUnread()?`<span class="badge red" title="Непрочитанные новости">${newsUnread()}</span>`:m.id==='kb'&&kbDot()?'<span class="kb-dot" title="Начните с Базы знаний"></span>':'';
    h+=`<div class="ti ${on?'on':''}"><a href="#${m.id}" data-go="${m.id}" ${on?'aria-current="page"':''}>${ic(m.icon)}<span>${esc(m.title)}</span>${badge}</a>${tabs.length?`<button class="tog ${open?'open':''}" data-tog="${m.id}" aria-label="${open?'Свернуть':'Раскрыть'} вкладки" aria-expanded="${open}">${ic('right','sm')}</button>`:''}</div>`;
    if(tabs.length&&open)h+=`<div class="subtree">${tabs.map(t=>`<a class="sti ${on&&S.tab===t.id?'on':''}" href="#${m.id}.${t.id}">${ic(t.icon||'right')}<span>${esc(t.label)}</span>${t.count!=null&&t.count!==''?`<span class="badge ${t.count?(t.red?'red':t.yellow?'yellow':''):''}" style="margin-left:auto">${t.count}</span>`:''}</a>`).join('')}</div>`;
  });
  h+=`</nav><div class="side-foot">`;
  if(!isAdmin())h+=`<button class="orgbtn" id="org-open" title="Профиль организации"><span class="av">${ic('landmark','sm')}</span><span style="min-width:0"><div class="o-n">${esc(ORG.name)}</div><div class="o-s">ИНН ${ORG.inn}</div></span></button>`;
  h+=`<div class="foot-row"><button class="btn ghost sm" id="me-open">${ic('user','sm')}Мой профиль</button><button class="btn ghost sm" id="logout">${ic('logout','sm')}Выйти из аккаунта</button></div>`;
  h+=demoBox()+`</div>`;
  $('#side').innerHTML=h;
}
const PROTO_VER='v57 · 25.10.2026';
function demoBox(){return `<div class="demo"><div class="row" style="gap:6px"><b>Прототип ${PROTO_VER}</b></div><label>Данные:</label>${sel('demo-data-x',[['demo','Демо-данные'],['empty','Пустая организация']],DATA_MODE,'data-demo-data aria-label="Данные макета"')}<label for="demo-user">Войти как:</label>${sel('demo-user',[...EMP.filter(e=>e.active).map(e=>[e.id,`${e.short} — ${ROLES.find(r=>r.id===e.role).name}`]),['admin','Администратор платформы']],S.me)}<button type="button" class="linkbtn" data-demo-fail style="align-self:flex-start">Показать ошибку загрузки списка</button><label>Данные прототипа:</label><div class="demo-db"><button type="button" class="linkbtn" data-db="export">Экспорт TemDB.json</button><button type="button" class="linkbtn" data-db="load">Загрузить TemDB.json</button><button type="button" class="linkbtn" data-db="clear">Очистить рабочие данные</button><button type="button" class="linkbtn" data-db="ref">Экспорт refDB.json</button><button type="button" class="linkbtn" data-db="gked">Экспорт gkedDB.json</button></div><span>${DATA_MODE==='empty'?'Организация как сразу после регистрации.':'Демо-данные из demoDB.json.'} Все изменения сохраняются в этом браузере (TemDB). Файлы данных: ${DBSRC.demo.from}.</span></div>`}
function renderBnav(){
  const ids=BNAV[isAdmin()?'admin':'business'];const l=mods().filter(m=>ids.includes(m.id)&&!m.hidden);const cn=isAdmin()?{}:counts();
  $('#bnav').innerHTML=l.map(m=>`<a class="bn ${S.mod===m.id?'on':''}" href="#${m.id}" data-go="${m.id}" ${S.mod===m.id?'aria-current="page"':''}>${ic(m.icon)}<span>${esc(m.short)}</span>${m.id==='reports'&&cn.overdue?`<span class="badge red">${cn.overdue}</span>`:m.id==='kpi'?kMissBadge():''}</a>`).join('');
  if(typeof renderSheetDot==='function')renderSheetDot();
  const a=$('#bnav .bn.on');if(a&&a.scrollIntoView)a.scrollIntoView({block:'nearest',inline:'nearest'});
}
function renderSheet(){
  $('#sheet').innerHTML=`<div class="grabber"></div><div class="brand" style="padding:6px 4px 10px"><div class="logo" aria-hidden="true"><i></i><i></i><i></i></div><div><div class="brand-name">Buhuchet.kg</div><div class="mode">${isAdmin()?'Admin':'Business'}</div></div></div>
  ${(()=>{const ids=BNAV[isAdmin()?'admin':'business'];const rest=mods().filter(m=>!ids.includes(m.id)&&!m.hidden);return rest.length?`<div class="sheet-mods" role="navigation" aria-label="Другие модули">${rest.map(m=>`<button data-shmod="${m.id}" class="${S.mod===m.id?'on':''}">${ic(m.icon)}<span>${esc(m.title)}</span>${m.id==='kpi'?kMissBadge('margin-left:auto'):m.id==='kb'&&newsUnread()?`<span class="badge red" style="margin-left:auto" title="Непрочитанные новости">${newsUnread()}</span>`:m.id==='kb'&&kbDot()?'<span class="kb-dot" title="Начните с Базы знаний"></span>':''}</button>`).join('')}</div>`:''})()}
  ${isAdmin()?'':`<button class="orgbtn" data-sh="org"><span class="av">${ic('landmark','sm')}</span><span><div class="o-n">${esc(ORG.name)}</div><div class="o-s">Профиль организации</div></span></button>`}
  <button class="orgbtn" data-sh="me"><span class="av round">${initials(me().fio)}</span><span><div class="o-n">Мой профиль</div><div class="o-s">${esc(me().fio)}</div></span></button>
  <button class="orgbtn" data-sh="out"><span class="av">${ic('logout','sm')}</span><span><div class="o-n">Выйти из аккаунта</div></span></button>${demoBox().replace('id="demo-user"','id="demo-user-m"').replace('for="demo-user"','for="demo-user-m"').replace('id="demo-data-x"','id="demo-data-m"')}`;
}
// «Назад» закрывает панель «Другие модули» (см. ovOpen в popups.js)
function openSheet(){renderSheet();$('#sheet').classList.add('open');$('#sheet-cover').hidden=false;ovOpen()}
function closeSheet(pop){const was=$('#sheet').classList.contains('open');$('#sheet').classList.remove('open');$('#sheet-cover').hidden=true;if(was&&!pop)ovClosed()}

function renderPage(fresh){
  const m=curMod();const tabs=modTabs(m);const page=$('#page');const pane=$('#pane');
  const keep=fresh?0:pane.scrollTop;
  ACTIVE=[];closePop();
  // Все способы добавления — пункты меню «+ Добавить» (на ПК и телефоне); btn:true — отдельная кнопка на ПК (сейчас не используется)
  const all=m.add?m.add().filter(Boolean):[];const btns=isMobile()?[]:all.filter(a=>a.btn),adds=isMobile()?all:all.filter(a=>!a.btn);
  page.innerHTML=`<div class="tabrow"><span class="tr-l"></span>
  ${tabs.length?`<div class="tabs" id="tabs" role="tablist">${tabs.map((t,ti)=>`${ti&&t.group&&t.group!==tabs[ti-1].group?`<span class="tab-sep" aria-hidden="true"></span>`:''}<a class="tab ${S.tab===t.id?'on':''}" role="tab" aria-selected="${S.tab===t.id}" href="#${m.id}.${t.id}" title="${esc(t.group?t.group+' · '+t.label:t.label)}">${ic(t.icon||'right')}<span class="lbl">${esc(t.label)}</span>${t.count!=null&&t.count!==''?`<span class="badge ${t.count?(t.red?'red':t.yellow?'yellow':''):''}">${t.count}</span>`:''}</a>`).join('')}</div>`:''}<div class="tr-r"><button type="button" class="icon-btn stat-btn" id="stat-btn" hidden aria-label="Статистика" title="Скрыть или показать статистику">${ic('chart')}</button>${btns.map((a,i)=>`<button class="btn add-x" data-addx="${i}" title="${esc(a.label)}">${ic(a.icon)}<span class="lbl">${esc(a.label)}</span>${a.beta?'<span class="pill yellow sm beta-p">Бета</span>':''}</button>`).join('')}${adds.length?`<button class="btn cta add-btn" id="add-btn" title="Добавить">${ic('plus')}<span class="lbl">Добавить</span>${adds.length>1?ic('down','sm'):''}</button>`:''}</div></div><div id="mbody" style="display:flex;flex-direction:column;gap:14px;min-width:0"></div>`;
  const runAdd=b=>{if(adds.length===1)adds[0].run();else menu(b,adds.map(a=>a.sep?a:({label:a.label,icon:a.icon,run:a.run,badge:a.beta?'Бета':'',sub:a.sub||''})))};
  $$('[data-addx]',page).forEach(b=>b.onclick=()=>btns[+b.dataset.addx].run());
  const ab=$('#add-btn');if(ab)ab.onclick=()=>runAdd(ab);
  const fab=$('#fab');fab.hidden=!adds.length;fab.innerHTML=ic('plus');fab.onclick=()=>runAdd(fab);
  m.render($('#mbody'),S.tab,fresh);
  {const sb=$('#stat-btn');const has=!!$('#mbody .plates');sb.hidden=!has;const k='stats.'+m.id;const off=()=>store.get(k,isMobile()?'off':'on')==='off';const ap=()=>{page.classList.toggle('nostats',off());sb.classList.toggle('on',!off());sb.setAttribute('aria-pressed',String(!off()));sb.title=off()?'Показать статистику':'Скрыть статистику'};ap();sb.onclick=()=>{store.set(k,off()?'on':'off');ap();fitTabs();ckHit('stats')}}
  S.preset=null;
  fitTabs();
  pane.scrollTop=keep;ckVisit();
  $('#q-scope').textContent=tabs.length?(tabs.find(t=>t.id===S.tab)||{}).label||'':m.title;
  {const tl=tabs.length?(tabs.find(t=>t.id===S.tab)||{}).label||'':'';$('#tb-mod').textContent=m.title;$('#tb-tab').textContent=tl;$('#tb-tab').hidden=!tl;const tb=$('#tb-title');tb.classList.remove('full');tb.title=m.title+(tl?' · '+tl:'');tb.onclick=()=>tb.classList.toggle('full');const ti=$('#tb-info');ti.innerHTML=ic('info','sm');ti.onclick=()=>openPop(ti,`<h4>${esc(m.title)}</h4><div style="font-size:13px;line-height:1.5;max-width:300px">${esc(m.desc)}</div>`,{cls:'pad'})}
}
function fitTabs(){const t=$('#tabs');if(!t)return;const ab=$('#add-btn');const ax=$$('.add-x');const over=()=>t.scrollWidth>t.clientWidth+2;t.classList.remove('compact','tight','tight2');if(ab)ab.classList.remove('slim');ax.forEach(x=>x.classList.remove('slim'));
  if(isMobile()){if(ab&&over())ab.classList.add('slim');if(over())t.classList.add('compact')}else{if(over())ax.forEach(x=>x.classList.add('slim'));if(over())t.classList.add('tight');if(over())t.classList.add('tight2')}
  // центрируем активную вкладку только по горизонтали: scrollIntoView прокрутил бы и страницу
  const on=$('.tab.on',t);if(on&&over())t.scrollLeft=Math.max(0,on.offsetLeft-(t.clientWidth-on.offsetWidth)/2)}
function renderShell(fresh){$('#app').classList.toggle('nav-hidden',S.navHidden&&!isMobile());renderSide();renderBnav();renderPage(fresh)}
function refreshAll(){gkIndex();derive();const openForms=MODALS.filter(m=>m.o.live);renderShell();openForms.forEach(m=>m.draw())}

/* ═════════════ Top bar ═════════════ */
function tick(){const n=bishkekNow();if(n.iso!==TODAY){TODAY=n.iso;derive()}$('#clock').innerHTML=`<span class="d">${fmtD(n.iso)}</span>${n.hm}`;$('#clock').title=`${fmtD(n.iso)} ${n.hm}, Бишкек`}
function effTheme(){const a=document.documentElement.getAttribute('data-theme');return a||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}
function paintTheme(){$('#theme').innerHTML=ic(effTheme()==='dark'?'sun':'moon')}
function initTop(){
  $('#burger').innerHTML=ic('menu');$('#help').innerHTML=ic('help');$('#help').onclick=()=>kbHelp();$('#search-ic').outerHTML=ic('search');$('#q-open').innerHTML=ic('search');paintTheme();
  $('#burger').onclick=()=>{if(isMobile()){openSheet();return}S.navHidden=!S.navHidden;store.set('nav',S.navHidden);$('#app').classList.toggle('nav-hidden',S.navHidden);fitTabs()};
  $('#theme').onclick=()=>{ckHit('theme');const t=effTheme()==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',t);store.set('theme',t);try{localStorage.setItem('bu.theme',t)}catch(e){}paintTheme()};
  let deb;$('#q').addEventListener('input',e=>{clearTimeout(deb);deb=setTimeout(()=>{S.search=e.target.value;if(S.search)ckHit('search');ACTIVE.forEach(g=>{g.s.page=0;g.refresh()});if(S.mod==='reports'&&S.tab==='matrix')renderPage()},120)});
  $('#q-open').onclick=()=>{$('#topbar').classList.add('searching');$('#q').focus()};
  $('#q').addEventListener('blur',()=>{if(!S.search)$('#topbar').classList.remove('searching')});
  tick();setInterval(tick,20000);
}

