'use strict';
// Первый запуск организации: приветствие (у владельца новой организации — шесть экранов, у сотрудников — три), опросник владельца, окно «Функция включена»
/* ═════════════ Первый запуск организации (ТЗ «Моя организация» → «Первый запуск организации») ═════════════ */
// Тексты экранов, вопросы и основной набор модулей — refDB.onboarding; здесь только логика
const OB=DB.ref.onboarding;
const WL={on:false,i:0,screens:[],ans:{},plan:null,again:false,quiz:false};
const featName=k=>(FEATURES.find(f=>f[0]===k)||[])[1]||k;
// Новая организация: в данных есть отметка onboard (появилась в v49); организации, созданные раньше, приветствие с опросником не получают
const obNew=()=>!!ORG.onboard;
const obQuiz=()=>obNew()&&can('org')&&!ORG.onboard.done&&!ORG.onboard.later;
// При входе: владельцу новой организации — приветствие с опросником вместо «Что нового»; сотрудникам новой организации — приветствие при самом первом входе
function firstLogin(how){if(navigator.webdriver&&!store.get('wntest',false))return;if(isAdmin())return whatsNew(how);
  let seen=null;if(how==='open')try{seen=sessionStorage.getItem('bu.wn.'+S.me)}catch(e){}
  const first=!store.get('kbw.'+S.me,false);
  if(!seen&&obNew()&&(obQuiz()||first)){try{sessionStorage.setItem('bu.wn.'+S.me,'1')}catch(e){}store.set('kbw.'+S.me,true);setTimeout(()=>welcomeOpen({}),350);return}
  whatsNew(how)}
// o.again — открыть снова из «Базы знаний» (без опросника); o.quiz — «Пройти опросник заново» из учётной политики
function welcomeOpen(o={}){const quiz=o.quiz||(!o.again&&obQuiz());
  WL.screens=o.quiz?['quiz','plan']:['hello','mods',...(quiz?['quiz','plan']:[]),'start',...(quiz&&can('dicts')?['taxes']:[])];WL.tx=null;WL.i=0;WL.again=!!o.again;WL.quiz=!!o.quiz;WL.plan=null;WL.ans=obAnsInit(!!o.quiz);
  let el=$('#welcome');if(!el){el=document.createElement('div');el.id='welcome';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Приветствие');document.body.appendChild(el);
    el.addEventListener('click',wlClick);el.addEventListener('change',wlChange);
    // Свайп влево-вправо листает экраны на телефоне
    let x0=null,y0=0,t0=0;el.addEventListener('touchstart',e=>{if(e.target.closest('.seg,input,select,textarea'))return;x0=e.touches[0].clientX;y0=e.touches[0].clientY;t0=performance.now()},{passive:true});
    el.addEventListener('touchend',e=>{if(x0==null)return;const dx=e.changedTouches[0].clientX-x0,dy=e.changedTouches[0].clientY-y0;x0=null;if(Math.abs(dx)<70||Math.abs(dy)>Math.abs(dx))return;wlGo(dx<0?1:-1)})}
  WL.on=true;el.hidden=false;document.body.classList.add('wl-open');MODALS.slice().forEach(m=>m.close());closePop();closeSheet();wlRender()}
function welcomeClose(){WL.on=false;const el=$('#welcome');if(el)el.hidden=true;document.body.classList.remove('wl-open')}
// Ответы: «Не знаю» при первом запуске; при повторном — по текущей учётной политике
function obAnsInit(cur){const a={};OB.questions.forEach(q=>{a[q.id]=cur?(q.on.every(k=>feat(k))?'yes':'no'):'unk';if(q.sub)a[q.sub.id]=cur?(q.sub.set==='taskConfirm'?(ORG.taskConfirm!==false?'yes':'no'):(q.sub.on||[]).every(k=>feat(k))?'yes':'no'):'unk'});return a}
// План: какие функции будут включены по ответам; «Не знаю» — значение основного набора
function obPlan(){const f={};FEATURES.forEach(([k])=>f[k]=!!OB.base[k]);let tc=true;
  OB.questions.forEach(q=>{const a=WL.ans[q.id];if(a!=='unk')q.on.forEach(k=>f[k]=a==='yes');
    if(q.sub&&a==='yes'){const b=WL.ans[q.sub.id];if(q.sub.set==='taskConfirm'){tc=b!=='no'}else if(b!=='unk')(q.sub.on||[]).forEach(k=>f[k]=b==='yes')}
    if(q.sub&&a==='no'&&q.sub.on)q.sub.on.forEach(k=>f[k]=false)});
  FEATURES.forEach(([k,,,dep])=>{if(dep&&dep.some(d=>!f[d]))f[k]=false});return {f,tc}}
function wlGo(d){if(!WL.on)return;const j=WL.i+d;if(j<0||j>=WL.screens.length)return;if(WL.screens[WL.i]==='quiz'&&d>0)WL.plan=obPlan();WL.i=j;wlRender()}
const wlAvail=m=>mods().some(x=>x.id===m.id);
function wlRender(){const el=$('#welcome');const k=WL.screens[WL.i];const n=WL.screens.length;let body='';
  const own=can('org');
  if(k==='hello'){const h=OB.s1;body=`<div class="wl-hero"><div class="logo wl-logo" aria-hidden="true"><i></i><i></i><i></i></div><h1>${esc(h.t)}</h1><p class="wl-lead">${esc(h.lead)}</p></div>
    <div class="wl-pts">${h.points.map(p=>`<div class="wl-pt"><span class="wl-ic">${ic(p.i)}</span><div><b>${esc(p.t)}</b><p>${esc(p.x)}</p></div></div>`).join('')}</div>
    <figure class="wl-pic" aria-label="Как выглядит программа"><div class="wl-app"><div class="wl-side">${['home','building','file','task','users','grad'].map((x,j)=>`<span class="${j===2?'on':''}">${ic(x,'sm')}</span>`).join('')}</div><div class="wl-main"><div class="wl-top"><b>Отчеты для сдачи</b><span>На неделе</span><span>Просрочено</span><span class="wl-add">+ Добавить</span></div><div class="wl-plates"><span class="r"><b>3</b>Просрочено</span><span class="y"><b>12</b>На этой неделе</span><span class="b"><b>5</b>Ожидают подтверждения</span></div>${[['НДС','ОсОО «Ала-Тоо»','К сдаче','y'],['Единый налог','ИП Асанов','Сдан','b'],['Соцфонд','ОсОО «Бектур»','Подтверждено','g']].map(r=>`<div class="wl-row"><span>${r[0]}</span><span>${r[1]}</span><span class="wl-st ${r[3]}">${r[2]}</span></div>`).join('')}</div></div><figcaption>Слева — модули, сверху — вкладки и «+ Добавить», плашки — быстрые фильтры, ниже — список</figcaption></figure>`}
  if(k==='mods'){const h=OB.s2;const al=new Set(OB.always);const list=[...BIZ.filter(m=>own||wlAvail(m)),{id:'profile',title:'Мой профиль',icon:'user'}];
    const st=m=>{if(al.has(m.id))return `<span class="pill sm green">${ic('lock')}Включён всегда</span>`;if(m.feature&&!feat(m.feature))return '<span class="pill sm faint">Можно включить</span>';return '<span class="pill sm blue">Включён · можно выключить</span>'};
    const fx=FEATURES.filter(f=>!BIZ.some(m=>m.feature===f[0]));
    body=`<h1>${esc(h.t)}</h1><p class="wl-lead">${esc(own?h.lead:h.leadStaff)}</p><div class="wl-mods">${list.map(m=>`<div class="wl-mod"><span class="wl-ic">${ic(m.icon)}</span><div class="grow"><b>${esc(m.title)}</b><p>${esc((KBUI.mods||{})[m.id]||m.desc||'')}</p></div>${own?st(m):''}</div>`).join('')}</div>
    ${own?`<h3 class="wl-h3">Функции внутри модулей</h3><div class="wl-fx">${fx.map(f=>`<div class="wl-mod sm"><div class="grow"><b>${esc(f[1])}</b><p>${esc((KBUI.features[f[0]]||{}).benefit||f[2])}</p></div>${feat(f[0])?'<span class="pill sm blue">Включена</span>':'<span class="pill sm faint">Можно включить</span>'}</div>`).join('')}</div>`:''}`}
  if(k==='quiz'){const h=OB.s3;const seg=(id,v)=>`<div class="seg wl-seg" role="radiogroup" aria-label="Ответ">${[['yes','Да'],['no','Нет'],['unk','Не знаю']].map(([a,l])=>`<button type="button" role="radio" aria-checked="${v===a}" class="${v===a?'on':''}" data-ans="${id}|${a}">${l}</button>`).join('')}</div>`;
    const qh=(q,sub)=>`<div class="wl-q ${sub?'sub':''}"><div class="grow"><b>${esc(q.q)}</b><p>${esc(q.x)}</p></div>${seg(q.id,WL.ans[q.id])}</div>`;
    body=`<h1>${esc(WL.quiz?h.tAgain:h.t)}</h1><p class="wl-lead">${esc(WL.quiz?h.leadAgain:h.lead)}</p><div class="wl-qs">${OB.questions.map(q=>qh(q)+(q.sub&&WL.ans[q.id]==='yes'?qh(q.sub,true):'')).join('')}</div>`}
  if(k==='plan'){const p=WL.plan||(WL.plan=obPlan());const on=FEATURES.filter(f=>p.f[f[0]]),off=FEATURES.filter(f=>!p.f[f[0]]);
    const it=f=>`<label class="check-row wl-pl"><input type="checkbox" class="sw" data-plan="${f[0]}" ${p.f[f[0]]?'checked':''}><span class="grow"><b>${esc(f[1])}</b><div class="hint">${esc((KBUI.features[f[0]]||{}).benefit||f[2])}${f[3]?` · требует «${esc(featName(f[3][0]))}»`:''}</div></span></label>`;
    body=`<h1>${esc(OB.s3.planT)}</h1><p class="wl-lead">${esc(OB.s3.planLead)}</p><div class="wl-plan"><div><h3 class="wl-h3">Будет включено · ${on.length}</h3>${on.map(it).join('')||'<span class="faint">Ничего, кроме основных модулей</span>'}</div><div><h3 class="wl-h3">Не включено · ${off.length}</h3>${off.map(it).join('')||'<span class="faint">Всё включено</span>'}</div></div>
      ${p.f.tasks?`<label class="check-row wl-pl"><input type="checkbox" class="sw" data-plan-tc ${p.tc?'checked':''}><span class="grow"><b>Задачи требуют подтверждения</b><div class="hint">Выполненную задачу проверяет постановщик или сотрудник с правом «Подтверждать задачи»</div></span></label>`:''}
      <div class="note">${ic('info')}<span>Всегда включены: ${OB.always.map(id=>'«'+((BIZ.find(m=>m.id===id)||{}).title||'Мой профиль')+'»').join(', ')}. Всё остальное можно включить или выключить позже в «Моя организация» → «Учётная политика»; данные при выключении не удаляются.</span></div>`}
  if(k==='start'){const h=OB.s4;const l=wlFirst();body=`<h1>${esc(h.t)}</h1><p class="wl-lead">${esc(own&&!WL.again?h.lead:h.leadStaff)}</p><ol class="wl-steps">${l.map(i=>`<li><b>${i.star?'★ ':''}${esc(i.t)}</b><p>${esc(i.w||'')}</p></li>`).join('')||'<li><b>Все основные шаги уже выполнены</b><p>Загляните в «Базу знаний», чтобы пройти остальные уроки.</p></li>'}</ol>
    <div class="wl-how"><span class="wl-ic">${ic('play')}</span><div><b>${esc(h.howT)}</b><p>${esc(h.how)}</p></div></div>`}
  // Экран 5 «Выбор налогов»: весь каталог видов отчётов по группам (компонент tax-pick.js)
  if(k==='taxes'){const h=OB.tax;const st=WL.tx||(WL.tx=txState());body=`<h1>${esc(h.t)}</h1><p class="wl-lead">${esc(h.lead)}</p>${txHtml(st)}`}
  const dots=WL.screens.map((s,j)=>`<span class="${j===WL.i?'on':''}"></span>`).join('');
  const later=!WL.again&&!WL.quiz&&WL.i<WL.screens.indexOf('quiz')&&obQuiz();
  let right='';if(k==='quiz')right=`<button class="btn cta" data-wl="next">Далее: что будет включено</button>`;else if(k==='plan')right=`<button class="btn cta" data-wl="apply">${ic('check','sm')}Применить</button>`;else if(k==='taxes'){const n=WL.tx?WL.tx.sel.size:0;right=`<span class="muted wl-n">Выбрано: <b>${n}</b></span><button class="btn ghost" data-wl="taxskip">Пропустить</button><button class="btn" data-wl="taxself" ${n?'':'disabled'}>Подключить и осмотреться</button><button class="btn cta" data-wl="taxlearn" ${n?'':'disabled'}>${ic('play','sm')}Подключить и начать обучение</button>`}else if(k==='start'&&WL.screens[WL.i+1]==='taxes')right=`<button class="btn cta" data-wl="next">Далее: выбор налогов</button>`;else if(k==='start')right=`<button class="btn ghost" data-wl="self">Осмотреться самому</button><button class="btn cta" data-wl="learn">${ic('play','sm')}Начать обучение</button>`;else right=`<button class="btn cta" data-wl="next">Далее</button>`;
  el.innerHTML=`<div class="wl-card"><div class="wl-head"><div class="wl-dots" aria-label="Экран ${WL.i+1} из ${n}">${dots}</div><span class="muted">${WL.i+1} из ${n}</span><span class="grow"></span>${later?`<button class="btn ghost sm" data-wl="later" title="Опросник можно пройти позже в учётной политике">Позже</button>`:''}<button class="icon-btn" data-wl="x" aria-label="Закрыть">${ic('x')}</button></div><div class="wl-body">${body}</div>
    <div class="wl-foot">${WL.i?'<button class="btn ghost" data-wl="prev">Назад</button>':''}<div class="grow"></div>${right}</div></div>`;
  const b=el.querySelector('.wl-body');if(b&&!WL.keep)b.scrollTop=0;WL.keep=false;
  if(k==='taxes')txMount(b,WL.tx,()=>{const sc=b.scrollTop;WL.keep=true;wlRender();$('#welcome .wl-body').scrollTop=sc});const f=el.querySelector('.wl-foot .cta');if(f&&!isMobile())f.focus({preventScroll:true})}
// Первые три невыполненных шага программы (основные «★» — первыми)
function wlFirst(){const l=ckAll().filter(i=>!ckDone(i));return [...l.filter(i=>i.star),...l.filter(i=>!i.star)].slice(0,3).sort((a,b)=>l.indexOf(a)-l.indexOf(b))}
function wlClick(e){const b=e.target.closest('[data-wl],[data-ans]');if(!b)return;
  if(b.dataset.ans){const[id,a]=b.dataset.ans.split('|');WL.ans[id]=a;WL.plan=null;const sc=$('#welcome .wl-body').scrollTop;wlRender();$('#welcome .wl-body').scrollTop=sc;return}
  const a=b.dataset.wl;
  if(a==='next')return wlGo(1);if(a==='prev')return wlGo(-1);
  if(a==='later'){ORG.onboard.later=true;ORG.onboard.at=nowStamp();welcomeClose();toast('Опросник можно пройти позже: «Моя организация» → «Учётная политика»','info');return}
  if(a==='x'){if(!WL.again&&!WL.quiz&&obQuiz()&&WL.screens.includes('quiz')){ORG.onboard.later=true}welcomeClose();return}
  if(a==='apply'){const ch=obApply();if(WL.quiz){welcomeClose();if(ch.on.length)featOnDlg(ch.on);else toast(ch.on.length||ch.off.length?'Учётная политика обновлена по опроснику':'Изменений нет: учётная политика не изменилась');return}WL.i++;wlRender();return}
  if(a==='taxskip'){ORG.onboard.taxes='skip';welcomeClose();go('home');toast('Налоги можно выбрать позже: «Справочники» → «Виды отчётов» → «Подключить из каталога»','info');return}
  if(a==='taxself'||a==='taxlearn'){const r=txApply(WL.tx,null,'приветствие, выбор налогов');ORG.onboard.taxes=[...WL.tx.sel];toast(`Подключено видов отчётов: ${r.on}`,'ok');return wlClick({target:{closest:()=>({dataset:{wl:a==='taxself'?'self':'learn'}})}})}
  if(a==='self'){welcomeClose();go('home');return}
  if(a==='learn'){welcomeClose();const l=wlFirst();go('kb','lessons');if(l[0])setTimeout(()=>ckHow(l[0].id),450);return}}
function wlChange(e){const x=e.target;if(x.dataset.plan){const p=WL.plan||(WL.plan=obPlan());const k=x.dataset.plan;p.f[k]=x.checked;
    FEATURES.forEach(([f,,,dep])=>{if(dep&&dep.includes(k)&&!x.checked)p.f[f]=false;if(dep&&f===k&&x.checked)dep.forEach(d=>p.f[d]=true)});wlRender();return}
  if(x.hasAttribute('data-plan-tc')){(WL.plan||(WL.plan=obPlan())).tc=x.checked}}
// Применить опросник: меняется только то, что отличается от текущей политики; в историю — запись «по опроснику»; данные выключенных модулей не удаляются
function obApply(){const p=WL.plan||obPlan();const on=[],off=[];
  FEATURES.forEach(([k])=>{const v=!!p.f[k];if(v!==feat(k)){(v?on:off).push(k);ORG.features[k]=v;if(v){ORG.featOn=ORG.featOn||{};ORG.featOn[k]=TODAY}}});
  const tcCh=p.f.tasks&&(ORG.taskConfirm!==false)!==p.tc;if(tcCh)ORG.taskConfirm=p.tc;
  const parts=[on.length?'включены '+on.map(k=>'«'+featName(k)+'»').join(', '):'',off.length?'выключены '+off.map(k=>'«'+featName(k)+'»').join(', '):'',tcCh?`«Задачи требуют подтверждения»: ${p.tc?'включено':'выключено'}`:''].filter(Boolean);
  log('org','policy',`Учётная политика по опроснику${WL.quiz?' (пройден заново)':''}: ${parts.join('; ')||'без изменений'}`);
  ORG.onboard=Object.assign(ORG.onboard||{},{done:true,later:false,at:nowStamp(),by:S.me,answers:{...WL.ans}});
  ckBase();refreshAll();ckSoon();return {on,off}}
// Окно после включения функции: польза и «Пройти урок»
function featOnDlg(keys){keys=[].concat(keys);const k0=keys[0];const info=KBUI.features[k0]||{};const g=keys.map(k=>(KBUI.features[k]||{}).g).find(Boolean);
  openModal({noMax:true,size:'mid',render:()=>({title:keys.length===1?`Функция «${esc(featName(k0))}» включена`:`Включено функций: ${keys.length}`,
    body:keys.map(k=>`<div class="wl-mod sm"><span class="wl-ic">${ic('ok')}</span><div class="grow"><b>${esc(featName(k))}</b><p>${esc((KBUI.features[k]||{}).benefit||'')}</p></div></div>`).join('')+`<p class="muted" style="margin:0">Уроки по ${keys.length===1?'этой функции':'этим функциям'} появились в «Базе знаний» у всех сотрудников с отметкой «Новое».</p>`,
    foot:`<button class="btn ghost" data-close>Позже</button>${g?`<button class="btn cta" id="fo-learn">${ic('play','sm')}Пройти урок</button>`:''}`,
    mount(el,m){const b=$('#fo-learn',el);if(b)b.onclick=()=>{m.close();featLesson(g)}}})})}
function featLesson(g){const gr=ckGroups().find(x=>x.id===g);go('kb','lessons');if(!gr)return;const closed=new Set(store.get('ck.closed.'+S.me,[]));if(closed.has(g)){closed.delete(g);store.set('ck.closed.'+S.me,[...closed])}
  const i=gr.items.find(x=>!ckDone(x))||gr.items[0];setTimeout(()=>ckHow(i.id),450)}
// «Включить» из «Можно включить»: открыть учётную политику и подсветить функцию
function polFocus(k){go('org','policy');setTimeout(()=>ckFlash(`[data-feat-row="${k}"]`),320)}
