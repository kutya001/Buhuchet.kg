'use strict';
// Загрузка данных: demoDB.json, TemDB.json, refDB.json (папка data или встроенная копия), даты и деньги
/* ═════════════ Данные прототипа: demoDB.json, TemDB.json, refDB.json ═════════════ */
/* Прототип — каркас: ни одной записи данных в коде. На GitHub Pages файлы читаются из папки data,
   в артефакте и при открытии с диска — из копии, которую сборка встраивает в страницу (блоки db-*). */
const DB_VER=1,DB_KEY='bu.temdb';
const DB_FILES={demo:'demoDB.json',empty:'TemDB.json',ref:'refDB.json',gked:'gkedDB.json'};
const DB_ORG_KEYS=['organization','roles','employees','contractors','reports','moneyOps','history','tasks','feePayments','services','projects','files','indicators','indicatorValues','indicatorMonths','indicatorHistory','indicatorImports','kbProgress','newsRead','platformOrgs','platformUsers','dictRequests','telegramLog'];
const DB_REF_KEYS=['dictionaries','taxes','enRates','propertyRates','bizSize','notes','reportTypes','singleTaxRates','taxRates','defaultRates','phoneCodes','holidays','workingSaturdays','statuses','statusNames','roleTemplates','messageTemplates','localization','kbGroups','kbSteps','kbLevels','kbArticles','news','dictHistory','dictLoads','calendarAudit','permissions','kbUi','kbShows','onboarding'];
const DB_OBJ=new Set(['notes','organization','kbProgress','newsRead','dictionaries','taxRates','defaultRates','holidays','statuses','statusNames','messageTemplates','kbLevels','calendarAudit','kbUi','onboarding']);
const DB_T={organization:'Организация',roles:'Роли',employees:'Сотрудники',contractors:'Контрагенты',reports:'Отчёты',moneyOps:'Поступления и оплаты',history:'История',tasks:'Задачи',feePayments:'Оплаты за обслуживание',services:'Разовые услуги',projects:'Проекты',files:'Файлы',indicators:'Показатели',indicatorValues:'Значения показателей',indicatorMonths:'Статусы месяцев показателей',indicatorHistory:'История показателей',indicatorImports:'Загрузки показателей из Excel',kbProgress:'Прогресс в Базе знаний',newsRead:'Прочитанные новости',platformOrgs:'Организации платформы',platformUsers:'Учётные записи',dictRequests:'Запросы на справочники',telegramLog:'Журнал Telegram'};
function dbRead(name,id){
  if(/^https?:/.test(location.protocol))try{const x=new XMLHttpRequest();x.open('GET','data/'+name+'?v='+Date.now(),false);x.send();
    if(x.status===200){const v=JSON.parse(x.responseText);if(v&&v.meta&&v.meta.file===name)return {db:v,from:'папка data'}}}catch(e){}
  const el=document.getElementById(id);if(el)try{return {db:JSON.parse(el.textContent),from:'встроенная копия'}}catch(e){}
  return {db:{meta:{file:name}},from:'нет файла'}}
const DBSRC={demo:dbRead(DB_FILES.demo,'db-demo'),empty:dbRead(DB_FILES.empty,'db-tem'),ref:dbRead(DB_FILES.ref,'db-ref'),gked:dbRead(DB_FILES.gked,'db-gked')};
// Поле «Виды деятельности (ГКЭД)» появилось в v37: у справочников, сохранённых в браузере раньше, его берём из refDB.json
const DB_GK_REF=[['regimes',r=>r.dictionaries.regimes.items,x=>x.code||x.name],['benefits',r=>r.dictionaries.benefits.items,x=>x.code||x.name],['enRates',r=>r.enRates,x=>x.code],['reportTypes',r=>r.reportTypes,x=>x.id]];
const DB_TXT_REF=[[r=>r.taxes,x=>x.code,['guide']],[r=>r.enRates,x=>x.code,['explain']],[r=>r.dictionaries.forms.items,x=>x.code||x.name,['note']],[r=>r.dictionaries.organs.items,x=>x.code||x.name,['note']],[r=>r.dictionaries.regimes.items,x=>x.code||x.name,['acc']]];
let DATA_MODE=store.get('data','demo'),DBMISS=[];
// Недостающие разделы (старый или чужой файл) берутся из пустого шаблона и refDB.json — прототип не ломается, а показывает, чего не хватило
function dbFill(db){const miss=[],e=DBSRC.empty.db,r=DBSRC.ref.db;db.meta=db.meta||{};
  DB_ORG_KEYS.forEach(k=>{if(db[k]==null){miss.push(DB_T[k]||k);db[k]=structuredClone(e[k]!=null?e[k]:DB_OBJ.has(k)?{}:[])}});
  const hadRef=!!db.ref;db.ref=db.ref||{};
  DB_REF_KEYS.forEach(k=>{if(db.ref[k]==null){if(hadRef)miss.push('справочник '+k);db.ref[k]=structuredClone(r[k]!=null?r[k]:DB_OBJ.has(k)?{}:[])}});
  // Справочник ГКЭД — отдельный файл gkedDB.json; правки администратора платформы хранятся в TemDB (ref.gked)
  if(db.ref.gked==null)db.ref.gked=structuredClone(DBSRC.gked.db.items||[]);
  DB_GK_REF.forEach(([k,get,key])=>{let a,b;try{a=get(db.ref);b=get(r)}catch(e){return}if(!a||!b)return;const m=Object.fromEntries(b.map(x=>[key(x),x]));a.forEach(x=>{if(!('gked' in x)&&m[key(x)]&&m[key(x)].gked)x.gked=structuredClone(m[key(x)].gked)})});
  // Пояснения справочников (v43) — содержимое платформы: у справочников, сохранённых в браузере раньше, берутся из refDB.json
  DB_TXT_REF.forEach(([get,key,fs])=>{let a,b;try{a=get(db.ref);b=get(r)}catch(e){return}if(!a||!b)return;const m=Object.fromEntries(b.map(x=>[key(x),x]));a.forEach(x=>{const f=m[key(x)];if(f)fs.forEach(k=>{if(!(k in x)&&f[k]!=null)x[k]=structuredClone(f[k])})})});
  // Тарифы Соцфонда (v45): у данных, сохранённых в браузере раньше, ПЛТ-01, вид отчёта soc и орган ОРГ-02 обновляются из refDB.json, пока администратор их не менял
  {const pick=(a,k,v)=>(a||[]).find(x=>x[k]===v);const tx=pick(db.ref.taxes,'code','ПЛТ-01'),ftx=pick(r.taxes,'code','ПЛТ-01');
    if(tx&&ftx&&ftx.guide&&ftx.guide.tariffs&&!(tx.guide&&tx.guide.tariffs)&&tx._ua<='2026-10-18 09:54')['base','rates','art','verify','guide','_ua'].forEach(k=>{if(ftx[k]!==undefined)tx[k]=structuredClone(ftx[k])});
    const rt=pick(db.ref.reportTypes,'id','soc'),frt=pick(r.reportTypes,'id','soc');if(rt&&frt&&/27,25 % от фонда оплаты \(17,25/.test(rt.desc||''))['desc','verifyNote'].forEach(k=>rt[k]=frt[k]);
    const og=db.ref.dictionaries&&pick(db.ref.dictionaries.organs.items,'code','ОРГ-02'),fog=r.dictionaries&&pick(r.dictionaries.organs.items,'code','ОРГ-02');if(og&&fog&&fog.contacts&&!og.contacts&&og._ua<='2026-10-18 09:54')['note','contacts','hours','site','contactsNote'].forEach(k=>{if(fog[k]!==undefined)og[k]=structuredClone(fog[k])})}
  ['dictGroups','statusNotes','templateNotes','gkedGroups'].forEach(k=>{if(db.ref[k]==null)db.ref[k]=structuredClone(r[k]||(k==='dictGroups'?[]:{}))});
  // Общие группы кодов ГКЭД (v53): в refDB.json — объект {id: группа}, в работе — список с полем id
  if(!Array.isArray(db.ref.gkedGroups))db.ref.gkedGroups=Object.entries(db.ref.gkedGroups||{}).map(([id,g])=>Object.assign({id},g));
  {const cs=db.ref.dictionaries&&db.ref.dictionaries.cats;const o=cs&&cs.items.find(x=>x.name==='Другое'&&x.code==='КАТ-005');if(o&&cs.items.some(x=>x!==o&&x.code==='КАТ-005'))o.code='КАТ-007'}
  // Подтверждение задач и права по модулям (v47): у данных, сохранённых в браузере раньше, — новые статусы задач, право «Подтверждать задачи» у главного бухгалтера, шаг урока, справочник «Права ролей» и тексты статей из refDB.json
  if(!db.meta.v47){db.meta.v47=1;const ts=db.ref.statuses&&db.ref.statuses.task;if(ts)Object.entries(r.statuses.task).forEach(([k,v])=>{if(!ts[k])ts[k]=structuredClone(v)});
    (db.roles||[]).forEach(x=>{if((x.id==='chief'||x.id==='owner')&&!x.perms.includes('tasksConfirm'))x.perms.push('tasksConfirm')});(db.ref.roleTemplates||[]).forEach(x=>{if(x.id==='chief'&&!x.perms.includes('tasksConfirm'))x.perms.push('tasksConfirm')});
    const ks=db.ref.kbSteps||[];const nk=(r.kbSteps||[]).find(x=>x.id==='tconf');if(nk&&!ks.some(x=>x.id==='tconf')){const td=ks.find(x=>x.id==='tdone');ks.forEach(x=>{if(td&&x.ord>td.ord)x.ord++});ks.splice(td?ks.indexOf(td)+1:ks.length,0,Object.assign(structuredClone(nk),{ord:td?td.ord+1:nk.ord}))}
    ['roles'].forEach(id=>{const a=ks.find(x=>x.id===id),b=(r.kbSteps||[]).find(x=>x.id===id);if(a&&b)a.w=b.w});
    ['a3','a13'].forEach(id=>{const a=(db.ref.kbArticles||[]).find(x=>x.id===id),b=(r.kbArticles||[]).find(x=>x.id===id);if(a&&b)a.html=b.html});
    const g=(db.ref.dictGroups||[]).find(x=>x.group==='Работа системы'),fg=(r.dictGroups||[]).find(x=>x.group==='Работа системы');const ft=fg&&fg.tabs.find(x=>x.tab==='Права ролей');if(g&&ft&&!g.tabs.some(x=>x.tab==='Права ролей'))g.tabs.push(structuredClone(ft))}
  // Права по действиям и область (37 прав вместо 20): у данных, сохранённых в браузере раньше, — новый справочник «Права ролей», роли сохраняют прежние возможности:
  // просмотр всех модулей, «Создавать…» → ещё загрузка списком, приостановка, архив; «Назначать отчёты» → ещё «Изменять срок»; ввод показателей, загрузка файлов и выгрузка — всем, как было
  if(!db.meta.perms2){db.meta.perms2=1;if(r.permissions)db.ref.permissions=structuredClone(r.permissions);
    const sg=['cps','reports','fin','projects','kpi','files'],mig=x=>{if(!x||x.scope)return;const p=new Set(x.perms||[]);
      ['cpView','repView','finView','projView','kpiView','filesView','kpiEdit','filesUpload','export'].forEach(k=>p.add(k));
      if(p.has('createCp'))['cpImport','cpPause','cpArchive'].forEach(k=>p.add(k));if(p.has('assign'))p.add('repDue');if(p.has('indSetup'))p.add('kpiImport');if(p.has('staff'))['staffView','kbLevels'].forEach(k=>p.add(k));
      x.perms=[...p];x.scope=Object.fromEntries(sg.map(g=>[g,p.has('viewAll')?'all':'own']))};
    (db.roles||[]).forEach(mig);(db.ref.roleTemplates||[]).forEach(mig);const ow=(db.roles||[]).find(x=>x.id==='owner');if(ow)ow.perms=(r.permissions||[]).map(x=>x.id);
    // Шаги «Кому вести» и «Ввод из Excel», права шагов и статьи «Роли и права», «Показатели контрагентов» — из refDB
    const ks=db.ref.kbSteps||[],rk=r.kbSteps||[];['kwho','kxls'].forEach(id=>{const nk=rk.find(x=>x.id===id);if(!nk||ks.some(x=>x.id===id))return;const prev=rk[rk.indexOf(nk)-1];const a=prev&&ks.find(x=>x.id===prev.id);ks.forEach(x=>{if(a&&x.ord>a.ord)x.ord++});ks.splice(a?ks.indexOf(a)+1:ks.length,0,Object.assign(structuredClone(nk),{ord:a?a.ord+1:nk.ord}))});
    ['import','xls','kval','roles'].forEach(id=>{const a=ks.find(x=>x.id===id),b=rk.find(x=>x.id===id);if(a&&b){a.perm=b.perm;a.w=b.w}});
    ['a3','a_kpi'].forEach(id=>{const a=(db.ref.kbArticles||[]).find(x=>x.id===id),b=(r.kbArticles||[]).find(x=>x.id===id);if(a&&b)a.html=b.html});
    const nw=db.ref.news||[];(r.news||[]).forEach(x=>{const i=nw.findIndex(y=>y.id===x.id);if(i<0)nw.push(structuredClone(x));else if(nw[i].status==='Черновик'&&nw[i]._cb==='admin'&&nw[i]._ua<=x._ua)nw[i]=structuredClone(x)})}
  // Обучение и первый запуск (v49): шаги уроков — новые названия, права и признаки из refDB; статьи — пересобранные под текущий прототип, если администратор их не менял;
  // пустая организация, в которой ещё ничего не сделано, получает основной набор модулей и приветствие с опросником, как новая
  if(!db.meta.v49){db.meta.v49=1;const ks=db.ref.kbSteps||[],rk=r.kbSteps||[];
    rk.forEach(b=>{const a=ks.find(x=>x.id===b.id);if(!a)return;['t','w','perm','art','learn'].forEach(k=>{if(b[k]!==undefined)a[k]=b[k]});delete a.mob});
    (r.kbGroups||[]).forEach(b=>{const a=(db.ref.kbGroups||[]).find(x=>x.id===b.id);if(a&&b.scr)a.scr=b.scr});
    const arts=db.ref.kbArticles||[];(r.kbArticles||[]).forEach(b=>{const i=arts.findIndex(x=>x.id===b.id);if(i<0)arts.push(structuredClone(b));else if(!arts[i]._ub||arts[i]._ub==='system')arts[i]=structuredClone(b)});
    const nw=db.ref.news||[];(r.news||[]).forEach(x=>{const i=nw.findIndex(y=>y.id===x.id);if(i<0)nw.push(structuredClone(x));else if(nw[i].status==='Черновик'&&nw[i]._cb==='admin')nw[i]=structuredClone(x)});
    const o=db.organization;if(db.meta.mode==='empty'&&o&&!o.onboard&&!(db.contractors||[]).length&&!(db.history||[]).some(h=>h.who!=='system')){o.onboard={state:'new'};Object.assign(o.features,(r.onboarding||{}).base||{})}}
  // Сверка с прототипом (v51): статьи, облачка показов и подсказки «Базы знаний» с новыми названиями прав и кнопок, недостающие шаблоны сообщений, описания прав «Просматривать финансовые операции» и «Просматривать отчёты» —
  // у данных, сохранённых в браузере раньше, берутся из refDB, если администратор их не менял (статья без его правки, облачко со старым текстом, подсказки, которых ещё не было, в том числе подсказки админки)
  if(!db.meta.v51){db.meta.v51=1;const arts=db.ref.kbArticles||[];
    ['a_kbadm','a14','a12','a7','a_kb','a3','a15'].forEach(id=>{const b=(r.kbArticles||[]).find(x=>x.id===id),i=arts.findIndex(x=>x.id===id);if(b&&i>=0&&(!arts[i]._ub||arts[i]._ub==='system'))arts[i]=structuredClone(b)});
    const old=['Нужно право «Выгрузка в Excel».','Нужно право «Тариф и оплата обслуживания».','прежние тарифы остаются в журнале.'];
    ['sh-xls','sh-feepay','sh-tariff'].forEach(id=>{const a=(db.ref.kbShows||[]).find(x=>x.id===id),b=(r.kbShows||[]).find(x=>x.id===id);if(!a||!b)return;
      b.items.forEach(bi=>{const ai=bi.s&&(a.items||[]).find(x=>x.s===bi.s);if(ai&&old.some(o=>(ai.x||'').includes(o))){ai.t=bi.t;ai.x=bi.x}})});
    const tc=(db.ref.kbShows||[]).find(x=>x.id==='sh-typecfg'),tcb=(r.kbShows||[]).find(x=>x.id==='sh-typecfg');if(tc&&tcb){const i=(tc.items||[]).findIndex(x=>x.t==='Подключённый вид отчёта');if(i>=0)tc.items[i]=structuredClone(tcb.items[0])}
    // «Создать уточнённый», «Отметить оплаченным» и «Принять деньги» есть не у всех отчётов: показ открывает меню и карточку отчёта, у которого это действие есть
    ['sh-ver','sh-pay','sh-in'].forEach(id=>{const a=(db.ref.kbShows||[]).find(x=>x.id===id),b=(r.kbShows||[]).find(x=>x.id===id);if(!a||!b||!a.items||!a.items.length)return;
      if(JSON.stringify(a.items[0].sub)==='["menu"]'){a.items[0].sub=structuredClone(b.items[0].sub);if(a.items[1]&&b.items[1]&&JSON.stringify(a.items[1].pre)==='["row"]')a.items[1].pre=structuredClone(b.items[1].pre);if(id==='sh-ver'&&a.scr==='reports.all')a.scr=b.scr}});
    const u=db.ref.kbUi,ru=r.kbUi;if(u&&ru){['fields','forms','boxes','rows','acts','tabs','add','addItems','plates','plateMode','buttons'].forEach(k=>{u[k]=u[k]||{};Object.entries(ru[k]||{}).forEach(([n,v])=>{if(!(n in u[k]))u[k][n]=structuredClone(v)})});
      if(u.ui&&ru.ui){if(/^Форма новой записи/.test(u.ui.form||''))u.ui.form=ru.ui.form;Object.entries(ru.ui).forEach(([n,v])=>{if(!(n in u.ui))u.ui[n]=v})}const tf=u.fields['Тип обслуживания'];if(tf&&/«Постоянный»/.test(tf.x||''))tf.x=ru.fields['Тип обслуживания'].x;
      if(u.acts['Заблокировать']==='Запрещает вход; данные сотрудника сохраняются.')u.acts['Заблокировать']=ru.acts['Заблокировать']}
    [['finView',/«Финансы»/],['repView',/вкладку «Отчёты» в/]].forEach(([id,re])=>{const a=(db.ref.permissions||[]).find(x=>x.id===id),b=(r.permissions||[]).find(x=>x.id===id);if(a&&b&&re.test(a.desc||''))a.desc=b.desc});
    ['messageTemplates','templateNotes'].forEach(k=>{const a=db.ref[k];if(a&&r[k])Object.entries(r[k]).forEach(([n,v])=>{if(a[n]==null)a[n]=v})})}
  // Без уведомления «Должники по обслуживанию» (v52, решение заказчика 23.10.2026): у данных, сохранённых в браузере раньше, убираются его шаблон Telegram, подсказка и отметка переключателя
  if(!db.meta.v52){db.meta.v52=1;['messageTemplates','templateNotes'].forEach(k=>{if(db.ref[k])delete db.ref[k].tgFee});const u=db.ref.kbUi;if(u&&u.fields)delete u.fields['Должники по обслуживанию'];
    (db.employees||[]).forEach(e=>{if(e.notify&&e.notify.off)delete e.notify.off.fee})}
  // Налоги, статусы и формы Нацстаткома (v53): у данных, сохранённых в браузере раньше, — новые и изменённые записи refDB.json (виды отчётов, налоги, органы, статусы,
  // основания, поле gked по ГКЭД v7), если администратор не менял их после выгрузки v52 (20.10.2026 09:40); новые записи встают на своё место по порядку refDB
  if(!db.meta.v53){db.meta.v53=1;const OLD='2026-10-20 09:40';
    const sync=(a,b,key)=>{if(!a||!b)return;b.forEach((x,i)=>{const k=key(x),j=a.findIndex(y=>key(y)===k);
      if(j<0){const pk=i?key(b[i-1]):null,pj=pk!=null?a.findIndex(y=>key(y)===pk):-1;a.splice(pj+1,0,structuredClone(x));return}
      if(JSON.stringify(a[j])!==JSON.stringify(x)&&(!a[j]._ua||a[j]._ua<=OLD))a[j]=structuredClone(x)})};
    sync(db.ref.reportTypes,r.reportTypes,x=>x.id);sync(db.ref.taxes,r.taxes,x=>x.code);sync(db.ref.enRates,r.enRates,x=>x.code);
    Object.keys(r.dictionaries||{}).forEach(k=>{const d=db.ref.dictionaries&&db.ref.dictionaries[k];if(d)sync(d.items,r.dictionaries[k].items,x=>x.code||x.id||x.name)});
    (db.ref.dictGroups||[]).forEach(g=>{const fg=(r.dictGroups||[]).find(x=>x.group===g.group);(g.tabs||[]).forEach(t=>{const ft=fg&&fg.tabs.find(x=>x.tab===t.tab);if(ft&&/8 платежей вне НК/.test(t.about||''))t.about=ft.about})})}
  // ПВТ и патент (v54): у данных, сохранённых в браузере раньше, — новые тексты и перечни ГКЭД этих записей refDB.json, если администратор их не менял (метка изменения та же, что в v53)
  if(!db.meta.v54){db.meta.v54=1;const V53={'ЛЬГ-02':'2026-10-18 09:54','РЕЖ-02':'2026-10-18 09:54','РЕЖ-05':'2026-10-18 09:54','НАЛ-14':'2026-10-18 09:54','ПЛТ-03':'2026-10-18 09:54',pvtd:'2025-01-15 10:35',pat:'2025-01-15 10:35',patw:'2025-01-15 10:24'};
    const put=(a,b,key)=>{if(a&&b)a.forEach((x,i)=>{const k=key(x),f=V53[k]&&b.find(y=>key(y)===k);if(f&&(x._ua||'')===V53[k])a[i]=structuredClone(f)})};
    put(db.ref.reportTypes,r.reportTypes,x=>x.id);put(db.ref.taxes,r.taxes,x=>x.code);['regimes','benefits'].forEach(k=>{const d=db.ref.dictionaries&&db.ref.dictionaries[k];if(d&&r.dictionaries&&r.dictionaries[k])put(d.items,r.dictionaries[k].items,x=>x.code)})}
  // Патент и ПВТ по ГКЭД v9 (v55): перечни патента для ИП и ИТД без пометки «сверить», ПВТ по основному ГКЭД и тексты «Налогов» — у тех же записей, если администратор их не менял (метка изменения та же, что в v54)
  if(!db.meta.v55){db.meta.v55=1;const V54={'ЛЬГ-02':'2026-10-23 13:05','РЕЖ-02':'2026-10-23 13:05','РЕЖ-05':'2026-10-23 13:05','НАЛ-14':'2026-10-23 13:05','ПЛТ-03':'2026-10-23 13:05',pat:'2026-10-23 13:05',pvtd:'2025-01-15 10:35',patw:'2025-01-15 10:24'};
    const put=(a,b,key)=>{if(a&&b)a.forEach((x,i)=>{const k=key(x),f=V54[k]&&b.find(y=>key(y)===k);if(f&&(x._ua||'')===V54[k])a[i]=structuredClone(f)})};
    put(db.ref.reportTypes,r.reportTypes,x=>x.id);put(db.ref.taxes,r.taxes,x=>x.code);['regimes','benefits'].forEach(k=>{const d=db.ref.dictionaries&&db.ref.dictionaries[k];if(d&&r.dictionaries&&r.dictionaries[k])put(d.items,r.dictionaries[k].items,x=>x.code)})}
  // Подтверждение сдачи вместо «Принят» (v56, решение заказчика 24.10.2026): у данных, сохранённых в браузере раньше, отчёты «Принят» становятся «Сдан» с отметкой «Подтверждено» —
  // дата подтверждения — когда отметили «Принят» (или дата принятия), подтвердил — кто отметил «Принят», файлы остаются; статусы, право «Подтверждать сдачу отчётов» у главного бухгалтера,
  // шаблоны Telegram, шаг урока, облачко показа, подсказки и статьи — из refDB.json, если администратор их не менял; записи «Налогов» 24.10 — если их не меняли после v55
  if(!db.meta.v56){db.meta.v56=1;const hs={};(db.history||[]).forEach(h=>{if(h.ent==='r')(hs[h.id]=hs[h.id]||[]).push(h)});
    (db.reports||[]).forEach(x=>{const h=(hs[x.id]||[]).slice().sort((a,b)=>a.at<b.at?-1:1);const sb=h.filter(e=>/→ Сдан/.test(e.what)).pop();
      if(x.status==='Принят'){const a=h.filter(e=>/→ Принят/.test(e.what)).pop();Object.assign(x,{status:'Сдан',confAt:a?a.at:(x.accDate||x.subDate||x.due)+' 12:00',confBy:a?a.who:x._ub||null,confNote:''})}
      if(sb&&!x.subBy&&['Сдан','Требует исправления'].includes(x.status))Object.assign(x,{subBy:sb.who,subAt:sb.at});delete x.accDate});
    (db.history||[]).forEach(h=>{if(h.ent==='r'&&/^Статус: Сдан → Принят/.test(h.what)){const f=h.what.split(', подтверждение: ')[1];h.what='Сдача подтверждена (раньше — статус «Принят»)'+(f?', файлы: '+f:'')}});
    const sr=db.ref.statuses&&db.ref.statuses.report,fr=r.statuses&&r.statuses.report;if(sr&&fr){const o=Object.assign({},sr);delete o['Принят'];if(String(o['Сдан'])==='yellow,hourglass')o['Сдан']=fr['Сдан'];
      const n={};Object.keys(fr).forEach(k=>{n[k]=o[k]||structuredClone(fr[k])});Object.keys(o).forEach(k=>{if(!n[k])n[k]=o[k]});db.ref.statuses.report=n}
    if(db.ref.statusNames)delete db.ref.statusNames['Принят'];
    const sn=db.ref.statusNotes;if(sn&&sn['Принят']!=null){delete sn['Принят'];['Сдан','Требует исправления'].forEach(k=>{if(/ждёт подтверждения$|^орган вернул/.test(sn[k]||''))sn[k]=r.statusNotes[k]});Object.entries(r.statusNotes||{}).forEach(([k,v])=>{if(sn[k]==null)sn[k]=v})}
    const ps=db.ref.permissions||[],fp=(r.permissions||[]).find(x=>x.id==='repConfirm');if(fp&&!ps.some(x=>x.id==='repConfirm')){const i=ps.findIndex(x=>x.id==='changeSum');ps.splice(i<0?ps.length:i+1,0,structuredClone(fp))}
    {const a=ps.find(x=>x.id==='changeStatus'),b=(r.permissions||[]).find(x=>x.id==='changeStatus');if(a&&b&&/«Принят»/.test(a.desc||''))a.desc=b.desc}
    const addP=x=>{if(!x.perms.includes('repConfirm')){const i=x.perms.indexOf('changeSum');x.perms.splice(i<0?x.perms.length:i+1,0,'repConfirm')}};
    (db.roles||[]).forEach(x=>{if(x.id==='chief'||x.id==='owner')addP(x)});(db.ref.roleTemplates||[]).forEach(x=>{if(x.id==='chief')addP(x)});
    ['messageTemplates','templateNotes'].forEach(k=>{const a=db.ref[k];if(a&&r[k])['tgConfWait','tgFix','waPage'].forEach(n=>{if(a[n]==null&&r[k][n]!=null)a[n]=r[k][n]})});
    {const ks=db.ref.kbSteps||[],rk=r.kbSteps||[];const a=ks.find(x=>x.id==='accept'),b=rk.find(x=>x.id==='accept');if(a&&b&&/«Принят»/.test(a.t||''))['t','w','perm'].forEach(k=>a[k]=b[k]);
      const v=ks.find(x=>x.id==='ver'),vb=rk.find(x=>x.id==='ver');if(v&&vb&&/принятого/.test(v.w||''))v.w=vb.w}
    {const a=(db.ref.kbShows||[]).find(x=>x.id==='sh-accept'),b=(r.kbShows||[]).find(x=>x.id==='sh-accept');if(a&&b&&a.items&&a.items[0]&&/орган ещё не подтвердил/.test(a.items[0].x||'')){a.items[0].t=b.items[0].t;a.items[0].x=b.items[0].x}}
    const u=db.ref.kbUi,ru=r.kbUi;if(u&&ru){const old=v=>/«Принят»|принят[а-я]* органом|Отметить принятым|Принято в этом|Дата принятия/.test(JSON.stringify(v));
      Object.keys(ru).forEach(k=>{const a=u[k],b=ru[k];if(!a||!b||typeof b!=='object'||Array.isArray(b))return;Object.keys(a).forEach(n=>{if(!(n in b)&&old(a[n]))delete a[n]});Object.entries(b).forEach(([n,v])=>{if(!(n in a)||old(a[n]))a[n]=structuredClone(v)})});
      if(u.fields)['ac-date','ac-file'].forEach(n=>delete u.fields[n]);if(u.acts&&u.acts['Подтвердить']==='Подтверждает выполненную задачу.')u.acts['Подтвердить']=ru.acts['Подтвердить'];
      if(u.forms&&/подтверждения органа\.$/.test(u.forms['Отметить отчёт сданным']||''))u.forms['Отметить отчёт сданным']=ru.forms['Отметить отчёт сданным'];
      // Окно операции с «Изменить» и «Удалить» (пункт 7): тексты, которые администратор не менял, заменяются новыми
      [['cards','fin','Карточка операции: сумма, детализация, файлы. «Обратная запись» исправляет ошибку без удаления.'],['rows','fin','Одна денежная операция. Нажмите — откроется её карточка с детализацией.'],['rows','staff.bonus','Одно списание остатка в бонус: дата, сотрудник, контрагент, сумма и причина. В меню «…» — карточка контрагента и «Отменить списание».'],
        ['boxes','Операции','Все деньги по контрагенту: поступления, оплаты, списания.'],['boxes','Оплаты (транши)','Оплаты по проекту частями.'],['acts','Удалить','Удаляет запись совсем — только если по ней ещё нет данных.'],['acts','Отменить списание','Возвращает списанный остаток обратно на счёт.'],
        ['forms','Оплата за обслуживание','Оплата за обслуживание: за какой месяц, сумма и дата. Долг уменьшится, оплата попадёт в «Финансовые операции».'],
        // «Вести с» и индикатор незаполненных показателей (пункт 5)
        ['tabs','kpi.month','Быстрый ввод значений за месяц: строка — контрагент, столбец — показатель. Можно вставить блок из Excel.'],['tabs','kpi.missing','Кто ещё не заполнил показатели и насколько просрочен срок заполнения.'],
        ['ctabs','Показатели','Помесячные показатели: итоги «Сумма / Среднее / Максимум / Минимум» и график.'],
        // Страница контрагента по ссылке (пункт 2)
        ['ctabs','Основное','Главные данные: статус обслуживания, ГКЭД, режим, ответственный, баланс и реквизиты.']]
        .forEach(([k,n,was])=>{if(u[k]&&ru[k]&&ru[k][n]!=null&&u[k][n]===was)u[k][n]=ru[k][n]});
      if(Array.isArray(u.els)&&!u.els.some(e=>e.id==='fin-del')){const e=(ru.els||[]).find(x=>x.id==='fin-del');if(e)u.els.push(structuredClone(e))}
      {const a=(u.els||[]).find(e=>e.id==='kpi-bar'),b=(ru.els||[]).find(e=>e.id==='kpi-bar');if(a&&b&&a.x==='За какой месяц вносить значения. Обычно — за прошлый: показатели вносят после окончания месяца.')a.x=b.x}
      {const a=(u.artForms||[]).find(x=>x.mod==='kpi');if(a&&a.fields&&!a.fields.includes('ki-st')){const i=a.fields.indexOf('ki-due');a.fields.splice(i<0?a.fields.length:i+1,0,'ki-st')}}
      // «Принять оплату за обслуживание» (пункт 6): сумма делится по месяцам, поля «За месяц» больше нет
      if(u.fields){const f=u.fields['fp-sum'];if(f&&/долг за выбранный месяц/.test(f.x||''))u.fields['fp-sum']=structuredClone(ru.fields['fp-sum']);delete u.fields['fp-m']}}
    {const a=(db.ref.kbShows||[]).find(x=>x.id==='sh-feepay'),b=(r.kbShows||[]).find(x=>x.id==='sh-feepay');if(a&&b)(a.items||[]).forEach((it,i)=>{const nb=(b.items||[]).find(y=>y.s==='#cp-feepay');if(it.t==='Кнопка «Отметить оплату»'&&nb){it.t=nb.t;it.x=nb.x}})}
    {const a=(db.ref.kbSteps||[]).find(x=>x.id==='feepay'),b=(r.kbSteps||[]).find(x=>x.id==='feepay');if(a&&b&&a.w==='Оплата закрывает начисления по месяцам.')a.w=b.w}
    const arts=db.ref.kbArticles||[];['a2','a3','a5','a6','a7','a8','a9','a11','a12','a13','a16','a17','a18','a20','a21','a22','a23','a_kpi','a_kb','a_kbadm'].forEach(id=>{const b=(r.kbArticles||[]).find(x=>x.id===id),i=arts.findIndex(x=>x.id===id);if(b&&i>=0&&(!arts[i]._ub||arts[i]._ub==='system'))arts[i]=structuredClone(b)});
    const V55={nspm:'2026-08-28 15:40',nspq:'2026-08-28 15:40',roy:'2025-01-15 10:36',enq:'2026-10-23 15:45',enm:'2026-10-23 15:45',patw:'2026-10-23 15:50','НАЛ-10':'2026-10-18 09:54','НАЛ-15':'2026-10-23 15:45','ЕНС-02':'2026-10-18 09:54','ЕНС-03':'2026-10-18 09:54','ЕНС-04':'2026-10-18 09:54','ЕНС-16':'2026-10-18 09:54'};
    const put=(a,b,key)=>{if(a&&b)a.forEach((x,i)=>{const k=key(x),f=V55[k]&&b.find(y=>key(y)===k);if(f&&(x._ua||'')===V55[k])a[i]=structuredClone(f)})};
    put(db.ref.reportTypes,r.reportTypes,x=>x.id);put(db.ref.taxes,r.taxes,x=>x.code);put(db.ref.enRates,r.enRates,x=>x.code);
    // Умное обучение (пункт 1): облачка сценариев про элементы, одинаковые на всех экранах, получают признак «Общий элемент»
    (db.ref.kbShows||[]).forEach(h=>(h.items||[]).forEach(it=>{if(['Галочки выбора','«Столбцы»'].includes(it.t)&&it.common==null)it.common=true}));
    // Показатели (пункт 5): «Вести с» — месяц создания показателя, но не раньше 12 месяцев назад: раньше незаполненными считались только последние 12 месяцев
    {const[y,mo]=TODAY.split('-').map(Number),lo=new Date(Date.UTC(y-1,mo-1,1)).toISOString().slice(0,7);(db.indicators||[]).forEach(i=>{if(!i.start){const c=(i._ca||'').slice(0,7)||TODAY.slice(0,7);i.start=c>lo?c:lo}})}
    // Страница контрагента по ссылке (пункт 2): адрес страницы у организаций платформы — по названию, без повторов; разделы страницы — все; право «Управлять страницей контрагента» у владельца
    // и главного бухгалтера; описание «Менять журнал тарифов», шаг урока, показ и основной набор — из refDB.json; в демо-данных функция включена и у двух контрагентов страницы — как в demoDB.json
    {const o=db.organization,taken=[];(db.platformOrgs||[]).forEach(x=>{if(x.self)return;if(!x.slug)x.slug=slugFree(slugOf(x.name),taken);taken.push(x.slug)});
      if(o){if(!o.slug)o.slug=slugFree(slugOf(o.name),taken);if(!o.pageSec)o.pageSec=['contacts','reports','money','kpi','fee'];if(o.features&&o.features.cppage==null)o.features.cppage=db.meta.mode==='demo'}
      const pr=db.ref.permissions||[],fp=(r.permissions||[]).find(x=>x.id==='cpPage');if(fp&&!pr.some(x=>x.id==='cpPage')){const i=pr.findIndex(x=>x.id==='tariff');pr.splice(i<0?pr.length:i+1,0,structuredClone(fp))}
      {const a=pr.find(x=>x.id==='tariff'),b=(r.permissions||[]).find(x=>x.id==='tariff');if(a&&b&&/записывать оплату обслуживания/.test(a.desc||''))a.desc=b.desc}
      const addPg=x=>{if(!x.perms.includes('cpPage')){const i=x.perms.indexOf('tariff');x.perms.splice(i<0?x.perms.length:i+1,0,'cpPage')}};
      (db.roles||[]).forEach(x=>{if(x.id==='chief'||x.id==='owner')addPg(x)});(db.ref.roleTemplates||[]).forEach(x=>{if(x.id==='chief')addPg(x)});
      const ks=db.ref.kbSteps||[],nk=(r.kbSteps||[]).find(x=>x.id==='cppage');if(nk&&!ks.some(x=>x.id==='cppage')){const a=ks.find(x=>x.id==='balance');ks.forEach(x=>{if(a&&x.ord>a.ord)x.ord++});ks.splice(a?ks.indexOf(a)+1:ks.length,0,Object.assign(structuredClone(nk),{ord:a?a.ord+1:nk.ord}))}
      const sh=db.ref.kbShows||[],ns=(r.kbShows||[]).find(x=>x.id==='sh-cppage');if(ns&&!sh.some(x=>x.id==='sh-cppage')){const i=sh.findIndex(x=>x.step==='balance');sh.splice(i<0?sh.length:i+1,0,structuredClone(ns))}
      const ob=db.ref.onboarding&&db.ref.onboarding.base;if(ob&&ob.cppage==null)ob.cppage=false;
      if(db.meta.mode==='demo'){const dc=DBSRC.demo.db.contractors||[];(db.contractors||[]).forEach(c=>{const f=dc.find(x=>x.id===c.id&&x.inn===c.inn);if(f&&f.page&&!c.page){c.page=structuredClone(f.page);(DBSRC.demo.db.history||[]).forEach(h=>{if(h.ent==='cp'&&h.id===c.id&&/^(Страница контрагента|Ссылка на страницу)/.test(h.what))db.history.push(structuredClone(h))})}})}}
    // ЕН — строки ЕНС в назначении (пункт 3): у ЕНС-16 — к каким ставкам она добавляется, у налога с продаж — добавляемые строки ставок, подсказка «Ставки налога» — из refDB.json;
    // процент в старых назначениях ЕН заменяется строкой ЕНС при первом пересчёте (enNorm); в демо-данных строки ЕНС и строки сумм — как в demoDB.json
    {(db.ref.enRates||[]).forEach(x=>{const f=(r.enRates||[]).find(y=>y.code===x.code);if(f&&f.addTo&&!x.addTo)x.addTo=[...f.addTo]});
      (db.ref.reportTypes||[]).forEach(x=>{const f=(r.reportTypes||[]).find(y=>y.id===x.id);if(f&&f.rateAdd&&!x.rateAdd)x.rateAdd=structuredClone(f.rateAdd)});
      const u=db.ref.kbUi,ru=r.kbUi;if(u&&ru&&u.fields&&ru.fields){const f=u.fields['Ставки налога'];if(f&&f.x==='Ставки берутся из каталога платформы; повторяющуюся сумму можно задать, чтобы она подставлялась в отчёт сама.'&&ru.fields['Ставки налога'])u.fields['Ставки налога']=structuredClone(ru.fields['Ставки налога'])}
      if(db.meta.mode==='demo'){const dc=DBSRC.demo.db.contractors||[],dr=DBSRC.demo.db.reports||[];
        (db.contractors||[]).forEach(c=>{const f=dc.find(x=>x.id===c.id&&x.inn===c.inn);if(f)(c.assign||[]).forEach(a=>{if(!['enq','enm'].includes(a.t)||a.en)return;const fa=(f.assign||[]).find(y=>y.t===a.t&&y.from===a.from);if(fa&&fa.en){a.en=structuredClone(fa.en);delete a.rate}})});
        (db.reports||[]).forEach(x=>{const f=!x.lines&&dr.find(y=>y.id===x.id&&y.cp===x.cp&&y.t===x.t&&y.pkey===x.pkey);if(f&&f.lines&&f.sum===x.sum)x.lines=structuredClone(f.lines)})}}}
  // Реквизиты по номеру телефона (v57, решение заказчика 25.10.2026): банки сверены с реестром Нацбанка и получили «Переводы по номеру телефона» — записи, которые администратор не менял,
  // берутся из refDB.json по коду, новые добавляются; переименованные банки и дубль «А-Банк» переименовываются в реквизитах. Счёт организации становится «Расчётным счётом»
  // с назначением «Налоги и обслуживание», прежний основной — основной для налогов и для обслуживания; реквизиты сотрудников — «Счёт или кошелёк». Тексты страницы контрагента,
  // пояснения для контрагента у видов отчётов, записи «Налогов» 23.10 и строки группировки справочников — из refDB.json; в демо-данных реквизиты как в demoDB.json
  if(!db.meta.v57){db.meta.v57=1;const ren={'А-Банк':'АБанк'};
    const bd=db.ref.dictionaries&&db.ref.dictionaries.banks,rb=r.dictionaries&&r.dictionaries.banks;
    if(bd&&rb){const its=bd.items;rb.items.forEach(f=>{const i=its.findIndex(x=>(x.code||'')===f.code);if(i<0){if(!its.some(x=>x.name===f.name))its.push(structuredClone(f));return}const x=its[i];
        if((x._ua||'')<='2026-10-18 09:54'){if(x.name!==f.name&&!ren[x.name])ren[x.name]=f.name;its[i]=structuredClone(f)}else if(x.byPhone==null)x.byPhone=!!f.byPhone});
      its.forEach(x=>{if(x.byPhone==null)x.byPhone=x.type==='Электронный кошелёк'})}
    const rn=n=>ren[n]||n;const o=db.organization;
    if(o){(o.accounts||[]).forEach(a=>{if(!a.kind){a.kind='acc';a.use='both';a.mainTax=a.mainFee=!!a.main;delete a.main;if(a.name==null)a.name=o.name||''}if(a.kind==='phone')a.banks=(a.banks||[]).map(rn);else a.bank=rn(a.bank)});
      if((o.accounts||[]).length)['mainTax','mainFee'].forEach(k=>{if(!o.accounts.some(a=>a[k]))o.accounts[0][k]=true});
      if(o.pageSec&&!o.pageSec.includes('pay'))o.pageSec.unshift('pay')}
    (db.employees||[]).forEach(e=>(e.wallets||[]).forEach(w=>{if(!w.kind)w.kind='acc';if(w.kind==='phone')w.banks=(w.banks||[]).map(rn);else w.prov=rn(w.prov)}));
    const u=db.ref.kbUi,ru=r.kbUi;if(u&&ru&&ru.page&&!u.page)u.page=structuredClone(ru.page);
    const rk=Object.fromEntries((r.reportTypes||[]).map(x=>[x.id,x]));(db.ref.reportTypes||[]).forEach((x,i,a)=>{const f=rk[x.id];if(!f)return;if(['enq','enm'].includes(x.id)&&(x._ua||'')==='2026-10-23 15:45'){a[i]=structuredClone(f);return}if(x.clientNote==null&&f.clientNote)x.clientNote=f.clientNote});
    (db.ref.taxes||[]).forEach((x,i,a)=>{if(['НАЛ-10','НАЛ-15'].includes(x.code)&&(x._ua||'')==='2026-10-24 21:10'){const f=(r.taxes||[]).find(y=>y.code===x.code);if(f)a[i]=structuredClone(f)}});
    (db.ref.dictGroups||[]).forEach(g=>{const fg=(r.dictGroups||[]).find(x=>x.group===g.group);(g.tabs||[]).forEach((t,i)=>{const ft=fg&&fg.tabs.find(x=>x.tab===t.tab);
      if(ft&&((t.tab==='Виды отчётов'&&!/clientNote/.test(t.recordNotes||''))||(t.tab==='Банки'&&t.about==='Банки и электронные кошельки КР.')))g.tabs[i]=structuredClone(ft)})});
    if(db.meta.mode==='demo'){const dd=DBSRC.demo.db,dg=s=>String(s||'').replace(/\D/g,'').replace(/^996/,'0');
      if(o&&!(o.accounts||[]).some(a=>a.kind==='phone')){const ph=((dd.organization||{}).accounts||[]).filter(a=>a.kind==='phone');if(ph.length){if(ph.some(a=>a.mainFee))o.accounts.forEach(a=>a.mainFee=false);o.accounts.push(...structuredClone(ph))}}
      (db.employees||[]).forEach(e=>{const f=(dd.employees||[]).find(x=>x.id===e.id&&x.login===e.login);if(!f||!(f.wallets||[]).length)return;const nums=new Set(f.wallets.map(w=>dg(w.kind==='phone'?w.phone.digits:w.num)));
        if((e.wallets||[]).every(w=>w.kind!=='phone'&&nums.has(dg(w.num))))e.wallets=structuredClone(f.wallets)})}}
  // Описания прав «Принимать деньги…», «Проекты…» и «Подтверждать сдачу…» (v59) — как в ТЗ; у данных, сохранённых в браузере раньше, заменяются, если администратор их не менял
  if(!db.meta.v59){db.meta.v59=1;const was={"repConfirm": "Подтверждать сданные отчёты других сотрудников или возвращать их «На исправление» с причиной; видит все отчёты, ждущие подтверждения, в пределах области группы. Свой сданный отчёт подтвердить нельзя (кроме владельца).", "money": "Принимать деньги от контрагента на налоги, отмечать оплату в бюджет, делать переводы.", "projects": "Создавать проекты и разовые услуги, менять их статус и принимать по ним оплату."};
    Object.keys(was).forEach(id=>{const a=(db.ref.permissions||[]).find(x=>x.id===id),b=(r.permissions||[]).find(x=>x.id===id);if(a&&b&&a.desc===was[id])a.desc=b.desc});
    // Сообщения на странице входа (решение заказчика 26.10.2026): текст auth.code_sent и новые ключи входа в «Локализации», справка «4.1. Вход» — у данных, сохранённых раньше, если их не меняли
    const lo=db.ref.localization;if(Array.isArray(lo)){const ra=(r.localization||[]).filter(x=>/^auth\./.test(x.key)),cs=lo.find(x=>x.key==='auth.code_sent'),rcs=ra.find(x=>x.key==='auth.code_sent');
      if(cs&&rcs&&cs.ru==='Код отправлен в Telegram')Object.assign(cs,structuredClone(rcs));
      ra.forEach(x=>{if(lo.some(y=>y.key===x.key))return;const i=lo.map(y=>/^auth\./.test(y.key)).lastIndexOf(true);lo.splice(i<0?lo.length:i+1,0,structuredClone(x))})}
    const a4=(db.ref.kbArticles||[]).find(x=>x.id==='a4');if(a4&&a4.html)[['<li>После нескольких неверных паролей вход временно блокируется.</li>',/<li>На неверный логин[^]*?<\/li><li>О блокировке[^]*?<\/li>/],['<li>Бот пришлёт в ваш Telegram одноразовый код, он действует 10 минут.</li>',/<li>Если к логину привязан Telegram, бот пришлёт[^]*?<\/li>/],['<li>Если Telegram не привязан, пароль сбрасывает владелец организации (владельцу — администратор платформы).</li>',/<li>Если код не пришёл[^]*?<\/li>/]].forEach(([o,re])=>{const m=(((r.kbArticles||[]).find(x=>x.id==='a4')||{}).html||'').match(re);if(m&&a4.html.includes(o))a4.html=a4.html.replace(o,m[0])})
    // «Бот платформы» вместо «Настройка бота» (решение заказчика 26.10.2026): подсказки и статья «Телеграм» у данных, сохранённых раньше, если их не меняли
    const u=db.ref.kbUi,ru=r.kbUi;if(u&&ru){if(u.tabs&&u.tabs['tg.bot']==='Настройка бота платформы.')u.tabs['tg.bot']=ru.tabs['tg.bot'];if(u.boxes&&u.boxes['Бот платформы']==='Имя бота, токен, вебхук и состояние. «Проверить вебхук» показывает, отвечает ли бот; «Заменить токен» — когда @BotFather выдал новый.')u.boxes['Бот платформы']=ru.boxes['Бот платформы']}
    const a195=(db.ref.kbArticles||[]).find(x=>x.id==='a19_5'),o195='<li>«Настройка бота» — настройки бота платформы.</li>',m195=(((r.kbArticles||[]).find(x=>x.id==='a19_5')||{}).html||'').match(/<li>«Бот платформы»[^]*?<\/li>/);if(a195&&m195&&(a195.html||'').includes(o195))a195.html=a195.html.replace(o195,m195[0])
    // «В Excel» скачивает файл .xlsx (решение заказчика 26.10.2026): описание шага обучения и облачко «Показать как» — у данных, сохранённых раньше, если их не меняли
    {const a=(db.ref.kbSteps||[]).find(x=>x.id==='xls'),b=(r.kbSteps||[]).find(x=>x.id==='xls');if(a&&b&&a.w==='Копирует отфильтрованные строки для вставки в Excel.')a.w=b.w}
    {const a=(db.ref.kbShows||[]).find(x=>x.id==='sh-xls'),b=(r.kbShows||[]).find(x=>x.id==='sh-xls');const ai=a&&(a.items||[])[0],bi=b&&(b.items||[])[0];if(ai&&bi&&/^Копирует отфильтрованные записи с видимыми столбцами/.test(ai.x||''))ai.x=bi.x}
    // Права сотрудника с «Сотрудники и роли», «Изменить» сотрудника, «Удалить» роли, временный пароль (ТЗ, решение заказчика 27.10.2026): статья «Сотрудники» и подсказки полей у данных, сохранённых раньше, если их не меняли
    {const a=(db.ref.kbArticles||[]).find(x=>x.id==='a15'),b=((r.kbArticles||[]).find(x=>x.id==='a15')||{}).html||'';const e=b.match(/<li>«Изменить» — [^<]*<\/li>/),d=b.match(/<li>Роль, которая никому не назначена,[^<]*<\/li><li>Сотрудник с правом «Сотрудники и роли», если он не владелец,[^<]*<\/li>/);
      if(a&&a.html&&e&&d&&!a.html.includes('<li>«Изменить» —'))a.html=a.html.replace('<li>«Передать контрагентов» —',e[0]+'<li>«Передать контрагентов» —').replace('<li>Право «Откат статусов» по умолчанию только у владельца.</li>','<li>Право «Откат статусов» по умолчанию только у владельца.</li>'+d[0])}
    {const f=(db.ref.kbUi||{}).fields,rf=(r.kbUi||{}).fields;if(f&&rf)[['ne-pass','Передайте сотруднику; при первом входе он сменит пароль.'],['no-pass','Передайте его владельцу: при первом входе система попросит задать свой пароль.'],['ne-role','Набор прав: «Главный бухгалтер», «Бухгалтер» или ваша роль.']].forEach(([k,o])=>{if(f[k]&&rf[k]&&f[k].x===o)f[k].x=rf[k].x})}
    // Новый пароль не совпадает с текущим (решение заказчика 27.10.2026): фраза в статье «Вход и профиль» у данных, сохранённых раньше
    {const a=(db.ref.kbArticles||[]).find(x=>x.id==='a4'),o='при первом входе система попросит сменить его.',n=(((r.kbArticles||[]).find(x=>x.id==='a4')||{}).html||'').match(/при первом входе система попросит сменить его\. Новый пароль не может совпадать с текущим[^<]*/);if(a&&a.html&&n&&!a.html.includes('Новый пароль не может совпадать'))a.html=a.html.replace(o,n[0])}
    // «Мои запросы» (решение заказчика 27.10.2026): у запросов «Попросить добавить» есть ответ администратора; в демо — примеры запросов своей организации
    {const q=db.dictRequests;if(Array.isArray(q)){q.forEach(x=>{if(x.answer==null)x.answer=''});if(db.meta.mode==='demo'){const k=x=>x._ca+'|'+x.what,have=new Set(q.map(k));q.unshift(...structuredClone((DBSRC.demo.db.dictRequests||[]).filter(x=>x.oid&&!have.has(k(x)))))}}
      const uk=db.ref.kbUi,rk2=r.kbUi;if(uk&&rk2)[['addItems','Мои запросы'],['forms','Мои запросы'],['forms','Отклонить запрос'],['forms','Запрос выполнен']].forEach(([g,k])=>{uk[g]=uk[g]||{};if(!(k in uk[g])&&rk2[g]&&rk2[g][k])uk[g][k]=rk2[g][k]});
      const ua=(db.ref.kbUi||{}).acts,ra=(r.kbUi||{}).acts;if(ua&&ra)[['Добавлено','Отмечает запрос выполненным: значение добавлено в справочник, организация увидит ответ.'],['Отклонить','Отклоняет запрос организации: значение в справочник не добавляется.']].forEach(([k,o])=>{if(ua[k]===o&&ra[k])ua[k]=ra[k]});
      const art=id=>(db.ref.kbArticles||[]).find(x=>x.id===id),ref=id=>((r.kbArticles||[]).find(x=>x.id===id)||{}).html||'';
      {const a=art('a16'),m=ref('a16').match(/<li>Что стало с запросом,[^<]*<\/li>/),o='Запрос уйдёт администратору платформы.</li>';if(a&&a.html&&m&&!a.html.includes('Мои запросы')&&a.html.includes(o))a.html=a.html.replace(o,o+m[0])}
      {const a=art('a19_3'),m=ref('a19_3').match(/<li>«Запросы» — просьбы организаций[^<]*<\/li>/),o='<li>«Запросы» — просьбы организаций добавить значение («Добавлено» / «Отклонить»)</li>';if(a&&a.html&&m&&a.html.includes(o))a.html=a.html.replace(o,m[0])}}}
  if(db.organization&&db.organization.payFirst==null)db.organization.payFirst=true;
  if(db.organization&&db.organization.repConfirm==null)db.organization.repConfirm=true;
  if(db.organization&&db.organization.taskConfirm==null)db.organization.taskConfirm=true;
  if(!db.kbProgress.u)db.kbProgress.u={};
  return {db,miss}}
function dbFresh(mode){const db=structuredClone(mode==='empty'?DBSRC.empty.db:DBSRC.demo.db);delete db.ref;
  db.meta={file:'TemDB.json',version:DB_VER,mode,from:DB_FILES[mode==='empty'?'empty':'demo'],created:TODAY+' '+bishkekNow().hm};
  const f=dbFill(db).db;if(mode==='empty')f.organization.created=TODAY;return f}
function dbBoot(){let s=null;try{s=JSON.parse(localStorage.getItem(DB_KEY)||'null')}catch(e){}
  if(s&&s.meta&&s.meta.file==='TemDB.json'){const f=dbFill(s);DBMISS=f.miss;return f.db}
  return dbFresh(DATA_MODE)}
const DB=dbBoot();DATA_MODE=DB.meta.mode||DATA_MODE;
const dbSets=o=>{const x={};Object.entries(o||{}).forEach(([k,v])=>x[k]=new Set(v));return x};
const nowStamp=()=>TODAY+' '+bishkekNow().hm;
const D=s=>{const[y,m,d]=s.split('-').map(Number);return new Date(Date.UTC(y,m-1,d))};
const toIso=dt=>dt.toISOString().slice(0,10);
const mkDate=(y,m,d)=>toIso(new Date(Date.UTC(y,m-1,d)));
const addDays=(s,n)=>{const d=D(s);d.setUTCDate(d.getUTCDate()+n);return toIso(d)};
const diffDays=(a,b)=>Math.round((D(a)-D(b))/864e5);
const fmtD=s=>s?`${s.slice(8,10)}.${s.slice(5,7)}.${s.slice(0,4)}`:'';
const minIso=(a,b)=>a<b?a:b, maxIso=(a,b)=>a>b?a:b;
const MONTHS=['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
const MONTHS_G=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const DOW=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const DOW_S=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const ym=s=>s.slice(0,7);
const ymG=k=>{const[y,m]=k.split('-').map(Number);return `${MONTHS_G[m-1]} ${y}`};
const ymLabel=k=>{const[y,m]=k.split('-').map(Number);return `${MONTHS[m-1]} ${y}`};
const addMonths=(k,n)=>{const[y,m]=k.split('-').map(Number);const d=new Date(Date.UTC(y,m-1+n,1));return toIso(d).slice(0,7)};
const lastDay=k=>{const[y,m]=k.split('-').map(Number);return mkDate(y,m+1,0)};
const isWeekend=()=>{const d=D(TODAY).getUTCDay();return d===0||d===6};
function weekRange(){const wd=(D(TODAY).getUTCDay()+6)%7;let mon=addDays(TODAY,-wd);if(isWeekend())mon=addDays(mon,7);return [mon,addDays(mon,6)]}

/* Money: «1 250,50», only soms */
function fmtM(n,dec=true){if(n==null||n===''||isNaN(n))return '';const neg=n<0;const v=Math.abs(+n);const[i,f]=v.toFixed(dec?2:0).split('.');return (neg?'−':'')+i.replace(/\B(?=(\d{3})+(?!\d))/g,' ')+(f?','+f:'')}
const som=n=>fmtM(n,(Math.round(n*100)%100)!==0)+' сом';
const parseNum=s=>{if(s==null)return NaN;const t=String(s).replace(/[\s ]/g,'').replace(',','.');return t===''?NaN:+t};

