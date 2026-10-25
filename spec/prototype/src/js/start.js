'use strict';
// Запуск: сохранение рабочих данных (TemDB), кнопки демо-панели, первая отрисовка
/* ═════════════ Start ═════════════ */
// Живые данные ↔ TemDB: снимок для сохранения и выгрузки, замена на месте при загрузке и очистке
const dbOrg=()=>({organization:ORG,roles:ROLES,employees:EMP,contractors:CPS,reports:REPORTS,moneyOps:OPS,history:HIST,tasks:TASKS,feePayments:FEEPAYS,services:SERVICES,projects:PROJECTS,files:FILES,indicators:IND,indicatorValues:IVALS,indicatorMonths:KMS,indicatorHistory:IHIST,indicatorImports:KIMP,kbProgress:CKS,newsRead:NEWS_READ,platformOrgs:ORGS,platformUsers:OTHER_USERS,dictRequests:REQUESTS,telegramLog:TG_LOG});
const dbRef=()=>({dictionaries:DICT,taxes:TAXES,enRates:EN_TABLE,propertyRates:PROP_RATES,bizSize:BIZ_SIZE,notes:REF_NOTES,reportTypes:RT,singleTaxRates:EN_RATES,taxRates:RATES,defaultRates:DEF_RATE,phoneCodes:PHONES,holidays:HOLIDAYS,workingSaturdays:WORK_SAT,statuses:{report:ST,payment:PST,task:TST,service:SVST,project:PRS,indicator:KST},statusNames:STL,roleTemplates:ROLE_TPL,messageTemplates:TPL,localization:L10N,kbGroups:KBG,kbSteps:KBS,kbLevels:{business:KB_LVB,admin:KB_LVA},kbArticles:KB_ARTS,news:NEWS,dictHistory:PD_HIST,dictLoads:PD_LOADS,calendarAudit:HOL_AUD,permissions:PERM_REF,gked:GK,kbUi:KBUI,kbShows:KBSH,onboarding:OB});
const CP_DERIVED=['overdue','avail','free','status','paused'],KB_FN=['done','go','ev','feat'];
const dbClean=v=>JSON.parse(JSON.stringify(v,(k,x)=>x instanceof Set?[...x]:typeof x==='function'?undefined:x));
function dbSnap(){const o=dbClean(dbOrg()),r=dbClean({...dbRef(),kbSteps:KBS.map(i=>Object.fromEntries(Object.entries(i).filter(([k,v])=>typeof v!=='function'&&!KB_FN.includes(k))))});
  o.contractors.forEach(c=>CP_DERIVED.forEach(k=>delete c[k]));return {meta:{...DB.meta,file:'TemDB.json',version:DB_VER,saved:TODAY+' '+bishkekNow().hm},...o,ref:r}}
function dbPut(t,v){if(t instanceof Set){t.clear();(v||[]).forEach(x=>t.add(x))}else if(Array.isArray(t)){t.length=0;t.push(...v)}else{Object.keys(t).forEach(k=>delete t[k]);Object.assign(t,v)}}
function dbApply(db){const o=dbOrg(),r=dbRef();
  DB_ORG_KEYS.forEach(k=>{if(k!=='newsRead')dbPut(o[k],db[k])});dbPut(NEWS_READ,dbSets(db.newsRead));
  DB_REF_KEYS.forEach(k=>{if(k==='kbSteps')return;if(k==='statuses'||k==='kbLevels')Object.keys(r[k]).forEach(s=>dbPut(r[k][s],db.ref[k][s]||(k==='kbLevels'?[]:{})));else dbPut(r[k],db.ref[k])});
  dbPut(GK,db.ref.gked||[]);gkIndex();
  permsBuild();kbBuild(db.ref.kbSteps);ORGS.forEach(orgBind);DB.meta=db.meta;
  dbPut(T,Object.fromEntries(RT.map(t=>[t.id,t])));dbPut(PH,Object.fromEntries(PHONES.map(p=>[p.cc,p])));
  dbPut(CPM,Object.fromEntries(CPS.map(c=>[c.id,c])));dbPut(EM,Object.fromEntries(EMP.map(e=>[e.id,e])));
  CPID=nextNum(CPS);RID=nextNum(REPORTS);OPID=nextNum(OPS);TID=nextNum(TASKS,'t');HIXn=-1;newsSync();derive()}
let dbT=null,dbWarned=false;
function dbSave(){clearTimeout(dbT);dbT=null;try{localStorage.setItem(DB_KEY,JSON.stringify(dbSnap()))}catch(e){if(!dbWarned&&e&&e.name==='QuotaExceededError'){dbWarned=true;toast('Не удалось сохранить рабочие данные: в браузере не хватает места. Выгрузите TemDB.json','alert')}}}
const dbSoon=()=>{clearTimeout(dbT);dbT=setTimeout(dbSave,700)};
// После замены данных — как после входа: закрыть окна, войти владельцем, открыть «Главную»
function dbAfter(msg){Object.keys(GS).forEach(k=>delete GS[k]);if(typeof welcomeClose==='function')welcomeClose();MODALS.slice().forEach(m=>m.close());closeSheet();closePop();if(TOUR.on){TOUR.on=false;$('#tour').hidden=true}
  CK.active=null;CK.bar=false;CK.shown={};KB.memo={};Object.keys(TAB_SCROLL).forEach(k=>delete TAB_SCROLL[k]);S.me='e1';S.mod=null;S.tab=null;derive();
  if(location.hash==='#home.today')route();else location.hash='#home.today';
  ckBase();renderSide();dbSave();toast(msg,'refresh');firstLogin('login')}
// Переключатель «Данные» и «Очистить рабочие данные»: TemDB создаётся заново из demoDB.json или из пустого шаблона TemDB.json
function setDataMode(v){DATA_MODE=v;store.set('data',v);if(v==='empty')EMP.forEach(e=>store.set('kbw.'+e.id,false));
  dbApply(dbFresh(v));dbAfter(v==='empty'?'Пустая организация: как сразу после регистрации':'Включены демо-данные')}
const dbSum=db=>`${(db.contractors||[]).length} контрагентов, ${(db.reports||[]).length} отчётов, ${(db.employees||[]).length} сотрудников`;
function dbDownload(name,obj){const text=JSON.stringify(obj,null,1);
  // В артефакте прямое скачивание запрещено: файл предлагается через возможность downloads (зритель подтверждает), иначе — буфер обмена
  if(window.top!==window.self){const cp=()=>copyText(text,`Скопировано: сохраните как ${name}`);const u=window.claude&&window.claude.use;if(!u){cp();return}
    u.call(window.claude,'downloads').then(dl=>{if(!dl){cp();return}dl.save({filename:name,data:new Blob([text],{type:'application/json'})}).then(()=>toast(`Файл ${name} сохранён`,'download'),e=>{const c=e&&e.code;if(c==='declined')toast('Сохранение отменено','x');else if(c==='rate_limited')toast('Окно сохранения уже открыто','alert');else cp()})},cp);return}
  try{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000);toast(`Файл ${name} скачан`,'download')}catch(e){copyText(text,`Скопировано: сохраните как ${name}`)}}
function dbAct(k){
  if(k==='export'){dbSave();dbDownload('TemDB.json',dbSnap());return}
  if(k==='ref'){const s=dbSnap();delete s.ref.gked;dbDownload('refDB.json',{meta:{file:'refDB.json',version:DB_VER,exported:TODAY+' '+bishkekNow().hm,description:'Справочники платформы с правками администратора из прототипа'},...s.ref});return}
  if(k==='gked'){dbDownload('gkedDB.json',{meta:{...(DBSRC.gked.db.meta||{}),file:'gkedDB.json',exported:TODAY+' '+bishkekNow().hm},items:dbClean(GK)});return}
  if(k==='clear'){confirmDlg({title:'Очистить рабочие данные?',text:`Всё, что вы ввели и изменили в прототипе, пропадёт, в том числе правки справочников. Данные вернутся к ${DATA_MODE==='empty'?'пустой организации (TemDB.json)':'демо-данным (demoDB.json)'}. Чтобы сохранить изменения, сначала нажмите «Экспорт TemDB.json».`,ok:'Очистить',danger:true,run:()=>setDataMode(DATA_MODE)});return}
  if(k==='load'){const inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';
    inp.onchange=()=>{const f=inp.files[0];if(!f)return;f.text().then(tx=>{let j=null;try{j=JSON.parse(tx)}catch(e){}
      if(!j||!j.meta||!['TemDB.json','demoDB.json'].includes(j.meta.file)){toast('Это не файл TemDB.json: нет блока meta с именем файла','alert');return}
      const {db,miss}=dbFill(j);const newer=(j.meta.version||1)>DB_VER;
      confirmDlg({title:'Загрузить TemDB.json?',text:`В файле: ${esc(dbSum(db))}. Сейчас в прототипе: ${esc(dbSum(dbOrg()))}. Текущие рабочие данные будут заменены.${miss.length?`<br><br><b>В файле не хватает разделов:</b> ${esc(miss.join(', '))}. Они будут взяты из пустого шаблона и refDB.json.`:''}${newer?'<br><br>Файл сделан более новой версией прототипа: незнакомые поля будут пропущены.':''}`,ok:'Загрузить',
        run:()=>{db.meta=Object.assign({},j.meta,{file:'TemDB.json',version:DB_VER,mode:j.meta.mode||'demo'});DATA_MODE=db.meta.mode;store.set('data',DATA_MODE);dbApply(db);dbAfter('Рабочие данные загружены из файла')}})})};
    inp.click()}}
// Каждое действие пользователя сохраняется в TemDB (localStorage) через 0,7 с; при закрытии страницы — сразу
['click','change','input','keydown','drop','paste'].forEach(ev=>document.addEventListener(ev,dbSoon,true));
addEventListener('pagehide',()=>{if(dbT)dbSave()});document.addEventListener('visibilitychange',()=>{if(document.hidden&&dbT)dbSave()});
derive();initTop();dbSave();
if(DBMISS.length)setTimeout(()=>toast('В сохранённых рабочих данных не хватало разделов: '+DBMISS.join(', ')+'. Они взяты из шаблона','alert'),600);
if(!location.hash||location.hash==='#')history.replaceState(null,'','#home');
ckBase();route();ckBar();renderSide();renderSheetDot();firstLogin('open');
