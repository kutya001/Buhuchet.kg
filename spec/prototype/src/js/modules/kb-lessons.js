'use strict';
// База знаний: уроки, шаги, уровни сотрудников
/* ═════════════ База знаний: уроки, уровни, статьи ═════════════ */
// Step: {id,t,w,star,learn,done(),ev,evk,at:['mod.tab'],hit,go(),perm,featk,mob,g,ord,active,isNew,art,how}
const CKS=DB.kbProgress;const CK={active:null,bar:false,barOff:false,shown:{},q:[],quiet:0};
const ckReset=()=>{CKS.u={};CK.active=null;CK.bar=false;CK.shown={};KB.memo={}};
// G(): where «Перейти» leads; mod/tab/hl are reused by «Показать как». after() opens a form right away.
// «Перейти» у шага сдачи при «Сдаче отчёта только после оплаты»: отчёт, который можно сдать сразу — вид «Сдача» или уже оплаченный, с ближайшим сроком
const subPick=()=>visReports().filter(r=>OPEN.has(r.status)&&!tR(r).payOnly&&!r.superseded&&!subPayWhy(r)&&(actOf(r)==='sub'||r.paid>0)).sort((a,b)=>a.due<b.due?-1:1)[0];
const G=(mod,tab,hl,mhl,after)=>{const f=()=>{if(mod)go(mod,tab);if(after)setTimeout(after,mod?220:0);else ckFlash(hl,mhl)};Object.assign(f,{mod,tab,hl,mhl});return f};
const hasLog=(ent,id,re)=>HIST.some(h=>h.ent===ent&&(id==null||h.id===id)&&(!re||re.test(h.what||'')));
const CKG=[
 {id:'org',items:[
  {id:'profile',star:1,perm:'org',done:()=>!!(ORG.name&&ORG.inn&&(ORG.head||hasLog('org','main'))),go:G('org','main','#mbody .box')},
  {id:'accs',perm:'org',done:()=>ORG.accounts.length>0,go:G('org','main','#og-addacc',null,()=>{const b=$('#og-addacc');if(b)b.click()})},
  {id:'policy',star:1,perm:'org',hit:'policy',done:()=>hasLog('org','policy'),go:G('org','policy','#mbody .box')},
  {id:'remind',perm:'org',hit:'remind',go:G('org','policy','#rd-add')},
  {id:'settings',perm:'org',done:()=>hasLog('org','settings'),go:G('org','settings','#st-save')},
  {id:'storage',learn:1,perm:'org',at:['org.settings'],go:G('org','settings','#org-storage')}]},
 {id:'me',items:[
  {id:'tg',star:1,user:1,staff:1,done:()=>!!me().tg,go:G(null,null,'#me-open','#burger',()=>{profileDlg();ckFlash('#pf-tglink')})},
  {id:'nmode',user:1,staff:1,done:()=>hasLog('emp',S.me,/^Уведомления/),go:G(null,null,'#me-open','#burger',()=>{profileDlg();ckFlash('[name=pf-nm]')})},
  {id:'theme',learn:1,hit:'theme',go:G(null,null,'#theme')}]},
 {id:'dicts',items:[
  {id:'types',star:1,perm:'dicts',done:()=>Object.values(ORG.types).some(t=>t.on),go:G('dicts','types','#dt-first, #dg')},
  {id:'typecfg',perm:'dicts',done:()=>hasLog('type')||hasLog('org',null,/^Настройки «/),go:G('dicts','types','#dg')},
  {id:'pdicts',learn:1,at:['dicts.platform'],go:G('dicts','platform','#mbody')}]},
 {id:'staff',perm:'staff',items:[
  {id:'roles',star:1,done:()=>hasLog('role'),go:G('staff','roles','#mbody')},
  {id:'emps',star:1,done:()=>EMP.length>1,go:G('staff','list','#add-btn','#fab',()=>empAddDlg())},
  {id:'empcard',learn:1,hit:'empcard',go:G('staff','list','#mbody .gscroll, #mbody .gcards')}]},
 {id:'cps',items:[
  {id:'cp1',star:1,perm:'createCp',done:()=>CPS.length>0,go:G('cps','all','#add-btn','#fab',()=>addCpDlg())},
  {id:'import',perm:'cpImport',done:()=>hasLog('import'),go:G('cps','all','#add-btn','#fab',()=>importDlg())},
  {id:'resp',star:1,perm:'assign',done:()=>{const a=CPS.filter(c=>!c.archived);return a.length>0&&a.every(c=>c.resp)},go:G('cps','all','#mbody .gscroll, #mbody .gcards')},
  {id:'tariff',perm:'fee',feat:()=>feat('fee'),done:()=>CPS.some(c=>c.tariffs&&c.tariffs.length),go:G('cps','all','#mbody .gscroll, #mbody .gcards')},
  {id:'flags',learn:1,hit:'cp.main',go:G('cps','all','#mbody .gscroll, #mbody .gcards')},
  {id:'oneoff',perm:'createCp',done:()=>CPS.some(c=>c.kind==='oneoff'),go:G('cps','all','#add-btn','#fab',()=>addCpDlg('oneoff'))},
  {id:'pause',learn:1,at:['cps.all'],go:G('cps','all','#mbody')},
  {id:'archive',learn:1,at:['cps.all'],go:G('cps','all','#mbody')},
  {id:'balance',learn:1,staff:1,hit:'cp.hist',go:G('cps','mine','#mbody .gscroll, #mbody .gcards')},
  {id:'cppage',perm:'cpPage',feat:()=>feat('cppage'),done:()=>CPS.some(c=>c.page&&c.page.on),go:G('cps','all','#mbody .gscroll, #mbody .gcards')}]},
 {id:'reports',items:[
  {id:'assign',star:1,perm:'assign',done:()=>CPS.some(c=>c.assign.length),go:G('reports','matrix','#add-btn','#fab',()=>massAssignDlg())},
  {id:'matrix',learn:1,at:['reports.matrix'],go:G('reports','matrix','#mbody')},
  {id:'rtabs',learn:1,at:['reports.week'],go:G('reports','week','#tabs')},
  {id:'submit',star:1,staff:1,perm:'changeStatus',done:()=>REPORTS.some(r=>r.status==='Сдан'),go:G('reports','week','#mbody .gscroll, #mbody .gcards',null,()=>{const r=payFirstOn()&&subPick();if(r)openReport(r);else ckFlash('#mbody .gscroll, #mbody .gcards')})},
  {id:'accept',staff:1,perm:'repConfirm',feat:()=>repConfOn(),done:()=>REPORTS.some(r=>r.status==='Сдан'&&r.confAt&&EMP.some(e=>e.id===r.confBy)),go:G('reports','waiting','#mbody .gscroll, #mbody .gcards')},
  {id:'bulk',learn:1,hit:'bulk',go:G('reports','all','#mbody .gscroll, #mbody .gcards')},
  {id:'ver',learn:1,done:()=>REPORTS.some(r=>r.ver>0),go:G('reports','all','#mbody .gscroll, #mbody .gcards')},
  {id:'na',learn:1,done:()=>REPORTS.some(r=>r.status==='Не требуется'),go:G('reports','all','#mbody .gscroll, #mbody .gcards')},
  {id:'scale',learn:1,hit:'hist',go:G('reports','all','#mbody .gscroll, #mbody .gcards')}]},
 {id:'money',feat:()=>feat('taxpay'),items:[
  {id:'in',star:1,staff:1,perm:'money',done:()=>OPS.some(o=>o.kind==='in'),go:G('reports','week','[data-recv], #mbody .gscroll, #mbody .gcards')},
  {id:'split',perm:'money',done:()=>OPS.some(o=>o.kind==='in'&&o.alloc&&o.alloc.length>1),go:G('fin','journal','#add-btn','#fab',()=>inDlg())},
  {id:'pay',star:1,perm:'money',done:()=>OPS.some(o=>o.kind==='pay'),go:G('reports','all','#mbody .gscroll, #mbody .gcards')},
  {id:'bonus',learn:1,feat:()=>feat('accounts')&&feat('finops'),at:['fin.wo'],go:G('fin','wo','#mbody')},
  {id:'journal',learn:1,feat:()=>feat('finops'),at:['fin.journal'],go:G('fin','journal','#mbody')},
  {id:'svc',perm:'projects',feat:()=>feat('finops'),done:()=>SERVICES.length>0,go:G('fin','proj','#add-btn','#fab',()=>serviceDlg())}]},
 {id:'fee',perm:'fee',feat:()=>feat('fee'),items:[
  {id:'debtors',learn:1,at:['cps.debtors'],go:G('cps','debtors','#mbody')},
  {id:'feepay',done:()=>FEEPAYS.length>0,go:G('cps','debtors','#mbody .gscroll, #mbody .gcards')},
  {id:'feepause',learn:1,hit:'cp.fee',go:G('cps','all','#mbody .gscroll, #mbody .gcards')}]},
 {id:'tasks',feat:()=>feat('tasks'),items:[
  {id:'regtasks',learn:1,staff:1,at:['tasks.mine'],go:G('tasks','mine','#mbody')},
  {id:'mtask',perm:'tasksCreate',done:()=>TASKS.some(t=>!t.reg),go:G('tasks','byme','#add-btn','#fab',()=>taskDlg())},
  {id:'daymonth',learn:1,staff:1,at:['tasks.mine','tasks.overdue','tasks.all'],go:G('tasks','mine','.kd-legend')},
  {id:'tdone',staff:1,done:()=>TASKS.some(t=>['Выполнена','Не выполнена','На подтверждении','Подтверждена'].includes(t.status)),go:G('tasks','mine','#mbody .gscroll, #mbody .gcards')},
  {id:'tconf',perm:'tasksConfirm',done:()=>TASKS.some(t=>t.confBy===S.me||t.reworkBy===S.me),go:G('tasks','mine','#mbody .plates, #mbody')}]},
 {id:'projects',perm:'projects',feat:()=>feat('projects'),items:[
  {id:'proj',done:()=>PROJECTS.length>0,go:G('projects','all','#add-btn','#fab',()=>projectDlg())},
  {id:'works',done:()=>PROJECTS.some(p=>p.works.length),go:G('projects','all','#mbody .gscroll, #mbody .gcards')},
  {id:'tranche',done:()=>PROJECTS.some(p=>p.pays.length),go:G('projects','all','#mbody .gscroll, #mbody .gcards')},
  {id:'pstat',learn:1,at:['projects.all'],go:G('projects','all','#mbody')}]},
 {id:'kpi',feat:()=>feat('indicators'),items:[
  {id:'kset',perm:'indSetup',done:()=>hasLog('kind'),go:G('kpi','setup','.kset',null,()=>{if(S.kSetV!=='list'){S.kSetV='list';renderPage()}ckFlash('.kset')})},
  {id:'kwho',perm:'indSetup',go:G('kpi','setup','#ksb',null,()=>{S.kSetV='who';renderPage();ckFlash('#ksb')})},
  {id:'kval',staff:1,soft:1,done:()=>IVALS.length>0,go:G('kpi','month','.kt, #mbody',null,()=>{const p=kPrev();const m=kCps(p).length||!kCps(ym(TODAY)).length?p:ym(TODAY);if(S.kpiM!==m){S.kpiM=m;renderPage()}})},
  {id:'kxls',staff:1,perm:'kpiImport',go:G('kpi','month','.add-x, #add-btn','#fab',()=>kxDlg())},
  {id:'kper',learn:1,staff:1,at:['kpi.period'],go:G('kpi','period','#mbody')},
  {id:'kchk',perm:'indCheck',done:()=>KMS.some(k=>k.status==='Проверено'),go:G('kpi','period','#mbody')},
  {id:'kcard',learn:1,hit:'cp.kpi',go:G('cps','all','#mbody .gscroll, #mbody .gcards')}]},
 {id:'files',feat:()=>feat('files'),items:[
  {id:'upload',done:()=>FILES.length>0,go:G('files',null,'#add-btn','#fab',()=>uploadDlg())},
  {id:'ffind',learn:1,at:['files'],go:G('files',null,'#mbody')}]},
 {id:'home',items:[
  {id:'today',learn:1,at:['home.today'],go:G('home','today','#mbody .plates')},
  {id:'anl',learn:1,perm:'fee',feat:()=>feat('fee'),at:['home.analytics'],go:G('home','analytics','#mbody')}]},
 {id:'lists',items:[
  {id:'search',learn:1,staff:1,hit:'search',go:G(null,null,'.search','#q-open')},
  {id:'cols',learn:1,staff:1,hit:'cols',go:G('cps','all','[data-a=cols]')},
  {id:'grp',learn:1,staff:1,hit:'grp',go:G('cps','all','[data-a=grp]')},
  {id:'xls',learn:1,staff:1,hit:'xls',go:G('cps','all','[data-a=xls]')},
  {id:'stats',learn:1,staff:1,hit:'stats',go:G('reports','week','#stat-btn')},
  {id:'swipe',learn:1,staff:1,hit:'swipe',go:G('reports','week','#tabs')}]}];
const CKA=[{id:'adm',items:[
  {id:'a-dicts',at:['pdicts.regimes','pdicts.forms','pdicts.organs','pdicts.ugns','pdicts.banks'],go:G('pdicts','regimes','#mbody')},
  {id:'a-types',star:1,at:['pdicts.types'],go:G('pdicts','types','#mbody')},
  {id:'a-xls',done:()=>PD_LOADS.some(l=>l.by===S.me&&l.at&&l.at.startsWith(TODAY)),hit:'pdload',go:G('pdicts','types','#mbody')},
  {id:'a-cal',at:['pdicts.calendar'],go:G('pdicts','calendar','#mbody')},
  {id:'a-tpl',at:['pdicts.templates','pdicts.roletpl'],go:G('pdicts','templates','#mbody')},
  {id:'a-l10n',at:['l10n'],go:G('l10n',null,'#mbody')},
  {id:'a-org',star:1,done:()=>ORGS.some(o=>o._cb===S.me&&String(o._ca||'').startsWith(TODAY)),go:G('orgs',null,'#add-btn','#fab',()=>addOrgDlg())}]}];
const KB_ARTS=DB.ref.kbArticles;
// Every step is personal: it counts only for the user who did the action himself (history under his name).
const KB_EV={
 'org.main':['сохранён профиль организации',h=>h.ent==='org'&&h.id==='main'],
 'org.acc':['добавлен счёт организации',h=>h.ent==='org'&&h.id==='accounts'&&/^Добавлен/.test(h.what)],
 'org.policy':['изменена учётная политика',h=>h.ent==='org'&&h.id==='policy'],
 'org.settings':['сохранены настройки организации',h=>h.ent==='org'&&h.id==='settings'],
 'emp.notify':['изменены свои уведомления',h=>h.ent==='emp'&&h.id===S.me&&/^Уведомления/.test(h.what)],
 'type.on':['подключён вид отчёта',h=>h.ent==='org'&&/^Подключён вид отчёта/.test(h.what)],
 'type.cfg':['изменены настройки вида отчёта',h=>h.ent==='type'||(h.ent==='org'&&/^Настройки «/.test(h.what))],
 'role.save':['сохранена роль',h=>h.ent==='role'],
 'emp.new':['создан сотрудник',h=>h.ent==='emp'&&h.what==='Сотрудник создан'],
 'cp.new':['создан контрагент',h=>h.ent==='cp'&&/^(Контрагент создан|Создан разовый|Создан загрузкой|Создан из свидетельства)/.test(h.what)],
 'cp.import':['выполнена загрузка контрагентов из Excel',h=>h.ent==='import'],
 'cp.resp':['назначен ответственный',h=>h.ent==='cp'&&/^(Ответственный:|Контрагент создан|Создан загрузкой|Создан из свидетельства)/.test(h.what)],
 'cp.tariff':['записан тариф',h=>h.ent==='cp'&&(/^Новая ставка/.test(h.what)||(/^(Контрагент создан|Создан загрузкой|Создан из свидетельства)/.test(h.what)&&((CPM[h.id]||{}).tariffs||[]).length>0))],
 'cp.oneoff':['создан разовый контрагент',h=>h.ent==='cp'&&/^Создан разовый/.test(h.what)],
 'cp.page':['включена страница контрагента по ссылке',h=>h.ent==='cp'&&/^Страница контрагента включена/.test(h.what)],
 'r.assign':['назначен отчёт',h=>h.ent==='cp'&&/^Назначен отчёт/.test(h.what)],
 'r.sub':['отчёт отмечен «Сдан»',h=>h.ent==='r'&&/→ Сдан|отмечен сданн/.test(h.what)],
 'r.acc':['сдача отчёта подтверждена',h=>h.ent==='r'&&/^Сдача подтверждена(?! \(Подтверждение выключено)/.test(h.what)],
 'r.ver':['создан уточнённый отчёт',h=>h.ent==='r'&&/уточнённый отчёт/i.test(h.what)],
 'r.na':['отчёт отмечен «Не требуется»',h=>h.ent==='r'&&/→ Не требуется/.test(h.what)],
 'in.new':['записано поступление',h=>h.ent==='in'&&/^Поступление/.test(h.what)],
 'in.split':['поступление распределено по нескольким отчётам',h=>h.ent==='in'&&((OPS.find(o=>o.id===h.id)||{}).alloc||[]).length>1],
 'r.pay':['налог отмечен оплаченным',h=>h.ent==='r'&&/^Оплата в бюджет/.test(h.what)],
 's.new':['создана разовая услуга',h=>h.ent==='s'&&/^Разовая услуга «/.test(h.what)],
 'fee.pay':['принята оплата за обслуживание',h=>(h.ent==='cp'||h.ent==='fp')&&/^Оплата за обслуживание/.test(h.what)],
 't.new':['поставлена ручная задача',h=>h.ent==='t'&&h.what==='Задача поставлена'],
 't.done':['задача выполнена или не выполнена',h=>h.ent==='t'&&(/^(Задача выполнена|Не выполнена)/.test(h.what)||/^Статус: .+ → На подтверждении/.test(h.what))],
 't.conf':['задача подтверждена или возвращена на доработку',h=>h.ent==='t'&&/^Статус: На подтверждении → (Подтверждена|На доработке)/.test(h.what)],
 'p.new':['создан проект',h=>h.ent==='p'&&/^Проект «.*» создан$/.test(h.what)],
 'p.work':['добавлена работа по проекту',h=>h.ent==='p'&&/^Добавлена работа/.test(h.what)],
 'p.pay':['принят транш по проекту',h=>h.ent==='p'&&/^Оплата /.test(h.what)],
 'k.setup':['сохранён показатель',h=>h.ent==='kind'],
 'k.val':['внесено значение показателя',h=>h.ent==='kv'],
 'k.who':['изменено, каким контрагентам вести показатель',h=>h.ent==='kind'&&/: «(Не ведётся|Ведётся)» → «/.test(h.what)],
 'k.xls':['показатели загружены из Excel',h=>h.ent==='kimp'&&/^Ввод показателей из Excel/.test(h.what)],
 'k.check':['месяц показателей проверен',h=>h.ent==='km'&&/→ Проверено/.test(h.what)],
 'f.upload':['загружен файл вручную',h=>h.ent==='cp'&&/^Загружены файлы/.test(h.what)],
 'open':['«Перейти» и 3 секунды на экране шага, показ «Показать как» до конца или статья шага (Посмотреть)'],'use':['первое использование функции (раздел «Работа со списками»)'],'state':['выполнено условие в данных пользователя'],'hand':['только показом или статьёй']};
const KB_MAP={profile:'org.main',accs:'org.acc',policy:'org.policy',settings:'org.settings',nmode:'emp.notify',types:'type.on',typecfg:'type.cfg',roles:'role.save',emps:'emp.new',cp1:'cp.new',import:'cp.import',resp:'cp.resp',tariff:'cp.tariff',oneoff:'cp.oneoff',cppage:'cp.page',assign:'r.assign',submit:'r.sub',accept:'r.acc',ver:'r.ver',na:'r.na',in:'in.new',split:'in.split',pay:'r.pay',svc:'s.new',feepay:'fee.pay',mtask:'t.new',tdone:'t.done',tconf:'t.conf',proj:'p.new',works:'p.work',tranche:'p.pay',kset:'k.setup',kwho:'k.who',kval:'k.val',kxls:'k.xls',kchk:'k.check',upload:'f.upload'};
const KB_KEEP={profile:1,resp:1}; // the data condition stays in addition to the event
const KB_FEAT={money:'taxpay',fee:'fee',tasks:'tasks',projects:'projects',kpi:'indicators',files:'files'},KB_IFEAT={tariff:'fee',bonus:'accounts',journal:'finops',svc:'finops',anl:'fee'};
const KBG=DB.ref.kbGroups;
const KBS=[];const KB={ver:0,q:'',memo:{}};
function kbBind(i){i.ev=KB_EV[i.evk]&&KB_EV[i.evk][1]||null;if(!i.go)i.go=G(i.mod||null,null,'#mbody');if(i.evk==='open'&&!i.at&&i.mod)i.at=[i.mod];if(i.evk!=='state'&&!KB_KEEP[i.id])i.done=null}
// Тексты, порядок, права и признаки шагов — из refDB.json (kbSteps); здесь, в CKG/CKA, только проверки и переходы
const KB_LOGIC=Object.fromEntries([...CKG,...CKA].flatMap(g=>g.items).map(i=>[i.id,i]));
function kbBuild(steps){KBS.length=0;steps.forEach(s=>{const i=Object.assign({},KB_LOGIC[s.id]||{},s);kbBind(i);KBS.push(i)});KB.memo={};KB.ver++}
kbBuild(DB.ref.kbSteps);
const kbMod=i=>i.mod||(i.go&&i.go.mod)||(i.at&&i.at[0].split('.')[0])||null;
const kbModT=id=>{const m=[...BIZ,...ADM].find(x=>x.id===id);return m?m.title:''};
const permT=p=>{const x=PERMS.find(y=>y[0]===p);return x?x[1]:''};
const ckU=u=>{u=u||S.me;const x=CKS.u[u]=CKS.u[u]||{done:{},skip:{},max:null,got:[]};if(!x.arts)x.arts={};return x};
// Отметка шага: один раз и навсегда, с датой и способом (ТЗ «Точные правила подсчёта»); у старых записей способ — строкой
const CK_HOW={action:'действием',data:'действием, сделанным раньше',show:'показом «Показать как»',art:'чтением статьи',use:'первым использованием',auto:'действием',visit:'открытием экрана',hand:'вручную'};
const ckRec=i=>{const r=ckU().done[i.id];return !r?null:typeof r==='string'?{how:r,at:''}:r};
const ckHowTxt=i=>{const r=ckRec(i);return r?(CK_HOW[r.how]||'')+(r.at?' · '+fmtD(r.at.slice(0,10)):''):''};
function kbVis(i){if(i.active===false)return false;if(i.perm&&!can(i.perm))return false;if(i.featk&&!feat(i.featk))return false;if(i.feat&&!i.feat())return false;
  const m=kbMod(i);return !m||mods().some(x=>x.id===m)}
// Порядок групп: у владельца — порядок первичной настройки; у остальных сотрудников первой идёт «Главная и аналитика»
function ckGroups(){const adm=isAdmin();let gs=KBG.filter(g=>!!g.adm===adm);if(!adm&&me().role!=='owner'){const h=gs.find(g=>g.id==='home');if(h)gs=[h,...gs.filter(g=>g!==h)]}
  return gs.map(g=>({...g,items:KBS.filter(i=>i.g===g.id&&kbVis(i)).sort((a,b)=>a.ord-b.ord)})).filter(g=>g.items.length)}
const ckAll=()=>ckGroups().flatMap(g=>g.items);
const ckDone=i=>!!ckU().done[i.id];
const ckSkip=i=>!ckDone(i)&&!!ckU().skip[i.id];
const ckRes=i=>ckDone(i)||ckSkip(i);
const ckFind=id=>KBS.find(i=>i.id===id);
function ckMark(i,how){const sc=ckU();if(sc.done[i.id])return false;sc.done[i.id]={how:how==='auto'||!how?'action':how,at:nowStamp()};delete sc.skip[i.id];return true}
// «Новое»: шаг добавлен администратором или его модуль недавно включён в учётной политике (30 дней)
const kbFeatOf=i=>i.featk||KB_FEAT[i.g]||'';
const kbIsNew=i=>!ckDone(i)&&(!!i.isNew||(()=>{const f=kbFeatOf(i);const d=f&&ORG.featOn&&ORG.featOn[f];return !!d&&d>=addDays(TODAY,-30)})());
function ckNext(after){const l=ckAll();const k=after?l.findIndex(i=>i.id===after):-1;return [...l.slice(k+1),...l.slice(0,k+1)].find(i=>!ckRes(i))||null}
function kbOk(i){if(i.ev&&!HIST.some(h=>h.who===S.me&&i.ev(h)))return false;if(i.done)return !!i.done();return !!i.ev}
/* Уровни: только по проценту выполненных шагов своей программы; полученный уровень не понижается */
const KB_LVB=DB.ref.kbLevels.business;
const KB_LVA=DB.ref.kbLevels.admin;
const kbLv=()=>isAdmin()?KB_LVA:KB_LVB;
function kbStat(){const gs=ckGroups();const l=gs.flatMap(g=>g.items);const n=l.length,d=l.filter(ckDone).length;const pct=n?Math.floor(d*100/n):0;const lv=kbLv();let k=0;lv.forEach((x,j)=>{if(pct>=x.p)k=j});
  const u=ckU();const cur=Math.max(k,u.max==null?0:u.max);const nx=lv[cur+1]||null;const need=nx?Math.max(1,Math.ceil(nx.p*n/100)-d):0;
  const al=typeof kbArts==='function'?kbArts():[];
  return {n,d,pct,k,cur,lv,nx,need,u,gs,mods:gs.map(g=>({id:g.id,t:g.t,d:g.items.filter(ckDone).length,n:g.items.length})),last:(u.got||[]).slice(-1)[0]||null,star:l.filter(i=>i.star).length,stard:l.filter(i=>i.star&&ckDone(i)).length,arts:al.length,artsRead:al.filter(a=>u.arts[a.id]).length}}
function kbSync(silent){const s=kbStat();const u=s.u;
  if(u.max==null){u.max=s.k;u.got=s.lv.slice(0,s.k+1).map((x,j)=>({l:j,at:nowStamp()}));return kbStat()}
  if(s.k>u.max){for(let j=u.max+1;j<=s.k;j++)u.got.push({l:j,at:nowStamp()});u.max=s.k;if(!silent)kbCongrats(s.lv[s.k].n)}
  return kbStat()}
function asUser(u,f){const o=S.me;S.me=u;try{return f()}finally{S.me=o}}
function kbFor(u){const key=u+'|'+HIST.length+'|'+KB.ver+'|'+JSON.stringify(ORG.features)+'|'+JSON.stringify(ROLES.map(r=>r.perms.length))+'|'+(EM[u]||{}).role;const m=KB.memo[u];if(m&&m.key===key)return m.s;
  const s=u===S.me?kbStat():asUser(u,()=>{ckBase(true);return kbSync(true)});KB.memo[u]={key,s};return s}
const KB_CL=['faint','blue','green','purple','yellow'];
function kbBadge(s,o={}){const l=s.lv[s.cur];return `<span class="pill ${o.big?'':'sm'} ${KB_CL[s.cur]||'blue'} kb-lvl" title="Уровень знаний ${s.cur+1} из ${s.lv.length}">${ic('grad')}${esc(l.n)}${o.nopct?'':` · ${s.pct} %`}</span>`}
function kbNextTxt(s){return s.nx?`ещё ${s.need} ${plural(s.need,'шаг','шага','шагов')} до «${esc(s.nx.n)}»`:'это высший уровень'}
function kbBar(s){return `<div class="bar chk-bar" role="progressbar" aria-valuenow="${s.pct}" aria-valuemax="100"><i style="width:${s.pct}%"></i></div>`}
function kbCongrats(name){let el=$('#kb-cg');if(!el){el=document.createElement('div');el.id='kb-cg';el.setAttribute('role','status');document.body.appendChild(el)}
  el.innerHTML=`${ic('grad')}<span><b>Новый уровень: ${esc(name)}</b><br><span class="muted">База знаний</span></span>`;el.classList.remove('on');void el.offsetWidth;el.classList.add('on');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('on'),4200)}
// Called after saves, visits and first-use events.
let ckT=null;function ckSoon(){clearTimeout(ckT);ckT=setTimeout(ckEval,250)}
function ckEval(){const fresh=CK.q.splice(0);
  ckAll().forEach(i=>{if(ckDone(i))return;let ok=false;try{ok=kbOk(i)}catch(e){ok=false}if(ok&&ckMark(i))fresh.push(i)});
  // Feedback right at the moment of the action: the lesson step first, then other actions; «Посмотреть»-hits only toast.
  const a=CK.active&&ckFind(CK.active);const act=fresh.filter(i=>!i.at);
  const pick=act.find(i=>i===a&&!i.soft&&!i.learn)||act.find(i=>!i.learn&&!i.soft);
  if(pick&&CK.active){CK.active=pick.id;CK.bar=true;setTimeout(()=>ckDoneDlg(pick),MODALS.length?250:50)}
  {const rest=act.filter(i=>!(CK.active&&i===pick));if(rest.length){CK.quiet++;toast(rest.length===1?`База знаний: шаг выполнен — «${rest[0].t}»`:`База знаний: выполнено ${rest.length} ${plural(rest.length,'шаг','шага','шагов')} — ${rest.map(i=>'«'+i.t+'»').join(', ')}`,'grad');CK.quiet--}}
  const before=ckU().max;kbSync(false);if(ckU().max!==before||fresh.length){if(S.mod==='kb')renderPage();renderSide();if(typeof renderSheetDot==='function')renderSheetDot()}
  ckBar()}
// Silent baseline: what this user already did before (history under his name) is marked at once, without dialogs.
function ckBase(noSync){ckAll().forEach(i=>{if(!ckDone(i)&&(i.ev||i.done)){let ok=false;try{ok=kbOk(i)}catch(e){}if(ok)ckMark(i,'data')}});if(!noSync)kbSync(true)}
// Первое использование функции засчитывает шаг «Сделать» и шаги «Посмотреть» раздела «Работа со списками и интерфейсом»; остальные «Посмотреть» — только показом или статьёй
function ckHit(name){if(TOUR.on)return;ckAll().forEach(i=>{if(i.hit===name&&(!i.learn||i.g==='lists')&&ckMark(i,'use'))CK.q.push(i)});ckSoon()}
// Само открытие экрана шаг «Посмотреть» не засчитывает: только «Перейти» из урока и 3 секунды на экране (ckLook), показ или статья
// Ушёл с экрана шага раньше 3 секунд — таймер сбрасывается, шаг не засчитывается
function ckVisit(){const L=CK.look;if(!L)return;const i=ckFind(L.id);if(!i||!ckOnScr(i)){ckLookStop();ckBar()}}
// Статья прочитана: открыта и прокручена до конца; засчитывает связанный шаг «Посмотреть»
function kbArtRead(a,stepId){if(!a||!a.id)return;const u=ckU();const fresh=!u.arts[a.id];if(fresh)u.arts[a.id]={at:nowStamp()};
  const l=ckAll().filter(i=>i.learn&&(i.id===stepId||i.art===a.id)&&ckMark(i,'art'));if(l.length||fresh){kbSync(false);renderSide();if(typeof renderSheetDot==='function')renderSheetDot();if(S.mod==='kb'&&!MODALS.length)renderPage()}
  if(l.length)toast(`База знаний: ${l.length===1?'шаг просмотрен — «'+l[0].t+'»':'просмотрено шагов: '+l.length}`,'grad');else if(fresh)toast('Статья прочитана','book')}
function ckFlash(sel,msel){setTimeout(()=>{const s=isMobile()&&msel?msel:sel;if(!s)return;const el=[...document.querySelectorAll(s)].find(x=>x.getClientRects().length);if(!el)return;
  el.scrollIntoView({block:'center',behavior:'smooth'});el.classList.remove('ck-flash');void el.offsetWidth;el.classList.add('ck-flash');setTimeout(()=>el.classList.remove('ck-flash'),2800)},380)}
function ckGo(id){const i=ckFind(id);if(!i)return;CK.active=id;CK.bar=true;CK.barOff=false;MODALS.slice().forEach(m=>m.close());i.go();ckBar();ckLook(i)}
// Шаг «Посмотреть» с экраном: после «Перейти» пользователь 3 секунды остаётся на этом экране — шаг засчитывается и открывается окно «Шаг выполнен»
// (решение заказчика 25.10.2026; ушёл с экрана раньше — не засчитывается)
const CK_LOOK=3000;
const ckOnScr=i=>{const scr=S.mod+(S.tab?'.'+S.tab:'');return (i.at||[]).some(a=>a===scr||a===S.mod)};
// Внизу экрана — полоса-таймер «Смотрите экран… 3»; стартует после прокрутки «Перейти» к нужному месту; у уже засчитанного шага таймера нет
function ckLook(i){ckLookStop();if(!i.learn||!i.at||ckDone(i))return;
  CK.lst=setTimeout(()=>{if(CK.active!==i.id||TOUR.on||!ckOnScr(i))return;CK.look={id:i.id,end:Date.now()+CK_LOOK};CK.bar=true;CK.barOff=false;ckBar();
    CK.lt=setInterval(()=>{const L=CK.look;if(!L||L.id!==i.id||CK.active!==i.id||TOUR.on||!ckOnScr(i)){ckLookStop();ckBar();return}
      if(Date.now()<L.end){const n=$('#ckbar [data-ckt]');if(n)n.textContent=Math.max(1,Math.ceil((L.end-Date.now())/1000));return}
      ckLookStop();if(ckDone(i)||!ckMark(i,'visit')){ckBar();return}kbSync(false);renderSide();if(typeof renderSheetDot==='function')renderSheetDot();ckBar();ckDoneDlg(i,'look')},200)},i.go&&i.go.hl?450:150)}
function ckLookStop(){clearInterval(CK.lt);clearTimeout(CK.lst);CK.look=null}
function ckHow(id){const i=ckFind(id);if(!i)return;CK.active=id;CK.bar=false;CK.barOff=false;tourStep(i)}
function ckDoneDlg(i,how){if(CK.shown[i.id])return;CK.shown[i.id]=1;const nx=ckNext(i.id);
  openModal({noMax:true,size:'mid',render:()=>({title:how==='look'?`Шаг выполнен: вы посмотрели «${esc(i.t)}»`:`Готово: шаг «${esc(i.t)}» выполнен`,sub:(()=>{const s=kbStat();return `База знаний: ${esc(s.lv[s.cur].n)} · ${s.pct} %`})(),
    body:`<p style="margin:0;color:var(--muted);line-height:1.55">${nx?`Следующий шаг — «${esc(nx.t)}».`:'Все шаги вашей программы пройдены.'} Можно вернуться к Базе знаний, сразу перейти к следующему шагу или остаться здесь.</p>`,
    foot:`<button class="btn ghost" id="ckd-stay">Остаться здесь</button>${nx?`<button class="btn" id="ckd-next" title="${esc(nx.t)}">Следующий шаг: ${esc(nx.t.length>34?nx.t.slice(0,32)+'…':nx.t)}</button>`:''}<button class="btn cta" id="ckd-back">Вернуться к Базе знаний</button>`,
    mount(el,m){$('#ckd-stay',el).onclick=()=>{m.close();CK.bar=true;ckBar()};const n=$('#ckd-next',el);if(n)n.onclick=()=>{m.close();ckGo(nx.id)};
      $('#ckd-back',el).onclick=()=>{MODALS.slice().forEach(x=>x.close());CK.active=null;CK.bar=false;ckBar();go('kb','lessons')}}})})}
function ckBar(){let b=$('#ckbar');const i=CK.active&&ckFind(CK.active);const show=i&&CK.bar&&!CK.barOff&&S.mod!=='kb'&&!TOUR.on;
  if(!b){b=document.createElement('div');b.id='ckbar';b.setAttribute('role','status');document.body.appendChild(b);
    b.addEventListener('click',e=>{if(e.target.closest('[data-ckb=back]')){CK.bar=false;go('kb','lessons')}if(e.target.closest('[data-ckb=x]')){CK.barOff=true;ckBar()}})}
  b.hidden=!show;b.classList.toggle('look',!!(show&&CK.look&&CK.look.id===i.id));if(!show)return;const d=ckDone(i);
  if(CK.look&&CK.look.id===i.id){const rem=Math.max(0,CK.look.end-Date.now());b.innerHTML=`${ic('eye','sm')}<span class="grow">Смотрите экран… <b data-ckt>${Math.max(1,Math.ceil(rem/1000))}</b> <span class="faint">· ${esc(i.t)}</span></span><span class="ck-tm" aria-hidden="true"><i style="animation-duration:${rem}ms"></i></span><button class="icon-btn sm" data-ckb="x" aria-label="Закрыть плашку">${ic('x','sm')}</button>`;return}
  b.innerHTML=`${ic(d?'ok':'grad','sm')}<span class="grow">Урок: <b>${esc(i.t)}</b>${d?' <span class="ck-ok">выполнено</span>':''}</span><button class="btn sm cta" data-ckb="back">К Базе знаний</button><button class="icon-btn sm" data-ckb="x" aria-label="Закрыть плашку">${ic('x','sm')}</button>`}
