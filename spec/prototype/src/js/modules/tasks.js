'use strict';
// Модуль «Задачи»
/* ═════════════ Задачи ═════════════ */
const taskOpen=t=>t.status==='К выполнению'||t.status==='В работе'||t.status==='На доработке';
// Подтверждение выполнения: «На подтверждении» ждёт постановщика или сотрудника с правом «Подтверждать задачи»; исполнитель свою задачу не подтверждает
const taskPend=t=>t.status==='На подтверждении';
const taskConfDef=()=>ORG.taskConfirm!==false;
function taskConfWhy(t){if(!taskPend(t))return 'Задача не ждёт подтверждения';if(t.exec===S.me)return 'Свою задачу подтвердить нельзя: подтверждает постановщик или другой сотрудник с правом';if(t.by!==S.me&&!can('tasksConfirm'))return 'Подтверждает постановщик или сотрудник с правом «Подтверждать задачи»';return ''}
const taskConfTxt=t=>!t.confirm?'Не требуется':t.status==='Подтверждена'&&t.confBy?'Подтвердил '+empName(t.confBy):'Требуется';
const taskOver=t=>taskOpen(t)&&t.date<TODAY;
// Исполнитель новой задачи по умолчанию: ответственный выбранного контрагента, иначе тот, кто ставит задачу
const taskExec0=e=>{const r=e.cp&&CPM[e.cp]&&CPM[e.cp].resp;return r&&EMP.some(x=>x.id===r&&x.active)?r:S.me};
// Менять и отменять ручную задачу может поставивший её — только с правом «Ставить задачи» (ТЗ; решение заказчика 30.10.2026, продукт п. Б-4) — и владелец
const taskBoss=t=>(t.by===S.me&&can('tasksCreate'))||me().role==='owner';
const taskBossWhy=t=>t.by===S.me&&!taskBoss(t)?'Менять и отменять свои задачи можно только с правом «Ставить задачи»':'';
// Задачи — только поручения, которые ставят люди: отчётов в «Задачах» нет, они только в «Отчетах для сдачи» (решение заказчика 17.11.2026)
function allTasks(){return TASKS}
function taskScope(){return can('tasksAll')?allTasks():allTasks().filter(t=>t.exec===S.me||t.by===S.me||(can('tasksConfirm')&&taskPend(t)))}
function taskTabs(){const sc=taskScope();return [
 {id:'mine',label:'Мои',icon:'user',count:sc.filter(t=>t.exec===S.me&&taskOpen(t)).length},
 can('tasksCreate')?{id:'byme',label:'Поставленные мной',icon:'send',count:TASKS.filter(t=>t.by===S.me&&taskOpen(t)).length}:null,
 can('tasksAll')?{id:'all',label:'Все',icon:'list'}:null,
 {id:'overdue',label:'Просроченные',icon:'alert',count:sc.filter(taskOver).length,red:true},
 can('tasksCreate')?{id:'series',label:'Повторы',icon:'repeat',count:tsScope().filter(s=>s.state==='Действует').length}:null]}
function taskAdd(){return can('tasksCreate')?[{label:'Задача',icon:'task',run:()=>taskDlg()}]:[]}
function taskCols(){return [
 {key:'title',label:'Задача',type:'text',w:330,val:t=>t.title,html:t=>`${tsIc(t)}<span class="strong">${esc(t.title)}</span>`},
 {key:'cp',label:'Контрагент',type:'enum',inn:true,w:190,val:t=>t.cp?CPM[t.cp].name:'Общие задачи',text:t=>t.cp?CPM[t.cp].name:'',html:t=>t.cp?esc(CPM[t.cp].name):'<span class="faint">Общая</span>',pin:'Общие задачи',hide:true},
 {key:'proj',label:'Проект',type:'enum',w:200,val:t=>t.proj?(PROJECTS.find(p=>p.id===t.proj)||{}).name||'':'',hide:true},
 {key:'cat',label:'Категория',type:'enum',w:150,val:t=>t.cat},
 {key:'exec',label:'Исполнитель',type:'enum',w:130,val:t=>empName(t.exec)},
 {key:'date',label:'Срок',type:'date',w:150,val:t=>t.date,html:t=>`<span class="${taskOver(t)?'red strong':''}">${taskOver(t)?ic('alert','sm')+' ':''}${t.kind==='month'?'до '+fmtD(t.date):fmtD(t.date)}</span> <span class="tag ${t.kind==='month'?'kd-month':'kd-day'}">${t.kind==='month'?'Месяц':'День'}</span>`},
 {key:'status',label:'Статус',type:'enum',w:220,val:t=>t.status,html:t=>scaleMini('task',t.status,t)},
 {key:'needf',label:'Нужен файл',type:'enum',w:110,val:t=>t.needFile?'Да':'Нет',hide:true},{key:'doneAt',label:'Дата выполнения',type:'date',w:130,val:t=>t.doneAt||null,hide:true},{key:'file',label:'Файл',type:'enum',w:110,val:t=>t.needFile?(t.file?'Приложен':'Нужен'):'',html:t=>t.needFile?(t.file?`<span class="pill green sm">${ic('clip')}приложен</span>`:`<span class="pill sm">${ic('clip')}нужен</span>`):'<span class="faint">—</span>'},
 {key:'by',label:'Поставил',type:'enum',w:120,val:t=>empName(t.by)},
 {key:'confirm',label:'Подтверждение',type:'enum',w:170,val:taskConfTxt,html:t=>!t.confirm?'<span class="faint">Не требуется</span>':t.status==='Подтверждена'?`<span class="pill green sm">${ic('check')}${esc(taskConfTxt(t))}</span>`:t.status==='На подтверждении'?`<span class="pill purple sm">${ic('hourglass')}ждёт</span>`:'Требуется',hide:true},
 {key:'scope',label:'Вид задачи',type:'enum',w:140,val:t=>t.cp?'По контрагенту':'Общая',hide:true,xls:true},
 {key:'term',label:'Вид срока',type:'enum',w:120,val:t=>t.kind==='month'?'На месяц':'На день',hide:true},
 {key:'rep',label:'Повтор',type:'enum',w:230,val:t=>t.ser?'Повторяющиеся':'Разовые',text:t=>{const s=tsOf(t);return s?tsTextS(s):''},html:t=>{const s=tsOf(t);return s?esc(tsTextS(s)):'<span class="faint">—</span>'},hide:true,xls:true},
 {key:'open',label:'Открыта',type:'enum',w:100,val:t=>taskOpen(t)?'Да':'Нет',hide:true}]}
function taskActions(t){
  const mine=t.exec===S.me,boss=taskBoss(t),why=taskBossWhy(t),edit={label:'Изменить',icon:'edit',disabled:!boss,reason:why,run:()=>taskDlg(t)};const it=[{label:'Открыть',icon:'task',run:()=>openTask(t)}];
  if(taskPend(t)){const why=taskConfWhy(t);it.push({label:'Подтвердить',icon:'check',disabled:!!why,reason:why,run:()=>taskConfDlg(t)},{label:'На доработку',icon:'refresh',danger:true,disabled:!!why,reason:why,run:()=>taskReworkDlg(t)});if(boss||why)it.push(edit)}
  if(taskOpen(t)){if(t.status==='К выполнению')it.push({label:'Взять в работу',icon:'clock',disabled:!mine&&!boss,reason:!mine&&!boss&&(why||'Взять в работу может исполнитель или постановщик'),run:()=>{t.status='В работе';log('t',t.id,'Статус: К выполнению → В работе');refreshAll();toast('Задача в работе')}});
    it.push({label:'Выполнена',icon:'ok',disabled:!mine,reason:!mine&&'Отметить может только исполнитель',run:()=>taskDoneDlg(t)});
    it.push({label:'Не выполнена',icon:'x',disabled:!mine,reason:!mine&&'Отметить может только исполнитель',run:()=>taskFailDlg(t)});
    if(boss||why)it.push(edit,{sep:true},{label:'Отменить задачу',icon:'ban',danger:true,disabled:!boss,reason:why,run:()=>taskCancelDlg(t)})}
  return it}
function taskCancelDlg(t){const s=tsOf(t);
  const fin=all=>{t.status='Отменена';log('t',t.id,'Задача отменена');bellTask(t,'cancel',t.exec);if(all)tsHalt(s,'',S.me);refreshAll();toast(all?'Задача отменена, повтор остановлен':'Задача отменена')};
  if(s&&s.state==='Действует')return tsAsk({title:'Отменить задачу серии?',ok:'Отменить задачу',danger:true,run:v=>fin(v==='all')});
  confirmDlg({title:'Отменить задачу?',text:`«${esc(t.title)}» получит статус «Отменена». Исполнитель увидит это в Telegram.`,ok:'Отменить задачу',cancel:'Не отменять',danger:true,run:()=>{t.status='Отменена';log('t',t.id,'Задача отменена');bellTask(t,'cancel',t.exec);refreshAll();toast('Задача отменена')}})}
/* Доска задач: столбцы — статус (по умолчанию), исполнитель, контрагент, категория, проект, постановщик, вид срока.
   Перенос карточки в другой столбец делает то же, что действие в меню: те же права и те же окна (файл, причина, подтверждение) */
const empByName=n=>EMP.find(e=>e.active&&e.short===n);
function taskKanban(){return {def:'status',by:['status','exec','cp','cat','proj','by','term'],
  order:{status:['К выполнению','В работе','На доработке','На подтверждении','Выполнена','Подтверждена','Не выполнена','Отменена']},
  show:{status:['К выполнению','В работе','На подтверждении','Выполнена'],exec:()=>can('tasksAll')?EMP.filter(e=>e.active).map(e=>e.short):[]},
  drop(t,key,v,label){const bad=m=>toast(m,'alert',true);
    if(key==='status'){
      const mine=t.exec===S.me,boss=taskBoss(t),open=taskOpen(t);
      if(v==='В работе'&&t.status==='К выполнению'){if(!mine&&!boss)return bad('Взять в работу может исполнитель или постановщик');t.status='В работе';log('t',t.id,'Статус: К выполнению → В работе');refreshAll();return toast('Задача в работе')}
      if((v==='Выполнена'||v==='На подтверждении'||(v==='Подтверждена'&&!taskPend(t)))&&open){if(!mine)return bad('Отметить выполненной может только исполнитель');return taskDoneDlg(t)}
      if(v==='Подтверждена'&&taskPend(t))return taskConfDlg(t);
      if(v==='На доработке'&&taskPend(t))return taskReworkDlg(t);
      if(v==='Не выполнена'&&open){if(!mine)return bad('Отметить может только исполнитель');return taskFailDlg(t)}
      if(v==='Отменена'&&open){if(!boss)return bad(taskBossWhy(t)||'Отменить задачу может тот, кто её поставил, или владелец');return taskCancelDlg(t)}
      return bad(`Из «${t.status}» в «${label}» задачу перевести нельзя`)}
    if(key==='exec'){const e=empByName(v);if(!e)return bad('Выберите столбец сотрудника');
      if(!taskBoss(t))return bad(taskBossWhy(t)||'Сменить исполнителя может тот, кто поставил задачу, или владелец');if(!taskOpen(t))return bad('Исполнитель меняется только у открытой задачи');
      const was=empName(t.exec);t.exec=e.id;touch(t);log('t',t.id,`Исполнитель: ${was||'—'} → ${e.short}`,t.cp);refreshAll();return toast(`Исполнитель: ${e.short}`,'user')}
    bad('Перетаскиванием меняются статус и исполнитель. Остальное — в окне «Изменить»')}}}
function renderTasks(body,tab,fresh){
  if(tab==='series')return tsRender(body,fresh);
  const m=ym(TODAY);
  const pl=can('tasksCreate')||can('tasksConfirm');const gid='tasks-'+tab;const pend=taskScope().filter(taskPend);const fst=(S.preset||(GS[gid]&&GS[gid].filters)||{}).status;const pendOn=!!(fst&&(fst.vals||[]).includes('На подтверждении'));
  body.innerHTML=`${pl?`<div class="plates" style="grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))">${plate({id:'pend',icon:'hourglass',color:pend.length?'purple':'green',label:'На подтверждении',value:pend.length,sub:pend.length?`можете подтвердить: ${pend.filter(t=>!taskConfWhy(t)).length}`:'выполненных задач без подтверждения нет',on:pendOn})}</div>`:''}<div class="row"><span class="kd-legend"><span class="tag kd-day">День</span> задача на дату <span class="tag kd-month">Месяц</span> задача на месяц</span><span class="muted">${tab==='overdue'?'Все просроченные задачи':`С ${ymG(m)}, вперёд и всё просроченное`}</span><div class="grow"></div>
  </div><div id="tg"></div>`;
  const pb=body.querySelector('.plates');if(pb)pb.onclick=e=>{if(!e.target.closest('[data-plate="pend"]'))return;const g=GS[gid];if(!g)return;g.filters=pendOn?{}:{status:{type:'enum',vals:['На подтверждении']}};g.page=0;renderPage()};
  const rows=()=>{let l=taskScope();const g=GS[gid];if(g&&g.filters&&g.filters.status&&(g.filters.status.vals||[]).includes('На подтверждении')&&tab!=='overdue')return l.filter(t=>taskPend(t)||g.filters.status.vals.includes(t.status));if(tab==='mine')l=l.filter(t=>t.exec===S.me);if(tab==='byme')l=TASKS.filter(t=>t.by===S.me);if(tab==='overdue')return l.filter(taskOver);
    return l.filter(t=>ym(t.date)>=m||taskOver(t))};
  grid($('#tg',body),{id:gid,cols:taskCols(),rows,title:'title',noun:['задача','задачи','задач'],rowClass:t=>(t.kind==='month'?'k-month ':'k-day ')+(taskOver(t)?'overdue':!taskOpen(t)?'muted':''),actions:taskActions,open:openTask,sort:{key:'date',dir:1},preset:S.preset,simulateLoad:fresh,kanban:taskKanban(),
    empty:{icon:'ok',title:tab==='overdue'?'Просроченных задач нет':'Задач нет',text:'',add:can('tasksCreate')&&tab!=='overdue'?()=>taskDlg():null}});
}
function openTask(t){
  if(!t)return;
  openModal({size:'mid',live:true,form:false,render:m=>{const hs=HIST.filter(h=>h.ent==='t'&&h.id===t.id).sort((a,b)=>a.at<b.at?1:-1);
    const pj=t.proj&&PROJECTS.find(p=>p.id===t.proj);
    // 17.11.2026 («Меньше текста», п. 8): описание — сразу под шапкой; строка состояния «шкала · срок · исполнитель», полная шкала по нажатию
    const closed=!taskOpen(t)&&!taskPend(t);
    return {title:esc(t.title),sub:esc(t.cat),body:`${t.desc?`<p class="tk-desc">${esc(t.desc)}</p>`:''}${stLine('t'+t.id,scaleMini0('task',t.status,t),[
        closed&&t.doneAt?`${ic('ok','sm')}<span>выполнена ${fmtD(t.doneAt)}</span>`:closed?'':dueBit(t.date,taskOver(t),t.kind==='month'?'в течение месяца':''),
        `${ic('user','sm')}<span>${esc(empName(t.exec)||'—')}</span>`],scaleFull('task',t.status,t.id))}${t.status==='На доработке'&&t.rework?`<div class="note warn">${ic('refresh')}<span><b>Возвращена на доработку</b>${t.reworkBy?` · ${esc(empName(t.reworkBy))}`:''}: ${esc(t.rework)}</span></div>`:''}${taskPend(t)?`<div class="note">${ic('hourglass')}<span>Подтверждает ${esc(empName(t.by))} ${tipI(`Подтвердить может постановщик${t.by!==t.exec?' или сотрудник с правом «Подтверждать задачи»':''}${t.exec===S.me?'. Свою задачу подтвердить нельзя':''}.`)}</span></div>`:''}${tsCardHtml(t)}<div class="row">${t.needFile?`<span class="pill ${t.file?'green':''}">${ic('clip')}${t.file?'файл приложен':'нужен файл при выполнении'}</span>`:''}</div>
    <div class="box"><div class="kv">${t.cp?`<div><span class="k">Контрагент</span><span class="v"><button class="linkbtn" id="tk-cpl">${esc(CPM[t.cp].name)}</button></span></div>${pj?`<div><span class="k">Проект</span><span class="v"><button class="linkbtn" id="tk-pjl">${esc(pj.name)}</button></span></div>`:''}`:`<div><span class="k">Вид задачи</span><span class="v">Общая задача</span></div>`}<div><span class="k">Поставил</span><span class="v">${esc(empName(t.by))}, ${fmtD(t.created)}</span></div>${closed?`<div><span class="k">Срок</span><span class="v">${fmtD(t.date)}</span></div>`:''}${t.status==='Подтверждена'&&t.confBy?`<div><span class="k">Подтвердил</span><span class="v">${esc(EM[t.confBy]?EM[t.confBy].fio:empName(t.confBy))}${t.confBy!==t.by?' вместо постановщика':''}${t.confAt?', '+fmtDT(t.confAt):''}</span></div>`:''}${t.confNote&&t.status==='Подтверждена'?`<div><span class="k">Комментарий</span><span class="v">${esc(t.confNote)}</span></div>`:''}${t.file?`<div><span class="k">Файл</span><span class="v">${ic('file','sm')} ${esc(t.file)}</span></div>`:''}${t.reason?`<div><span class="k">Причина</span><span class="v">${esc(t.reason)}</span></div>`:''}</div></div>
    <div class="box"><h3>Комментарии · ${t.comments.length}</h3>${t.comments.map(c=>`<div><b>${esc(empName(c.who))}</b> <span class="faint">${fmtD(c.at.slice(0,10))} ${c.at.slice(11)}</span><div>${esc(c.text)}</div></div>`).join('')}<div class="row" style="flex-wrap:nowrap"><input class="inp" id="tk-c" placeholder="Написать комментарий"><button class="btn" id="tk-cs" aria-label="Отправить" title="Отправить">${ic('send','sm')}</button></div></div>
    <details class="box rc-hist"><summary><h3>История</h3></summary>${statusHistHtml('task',t)}${hs.length?`<h4>Изменения</h4><ul class="tl">${hs.map(h=>`<li><span class="t">${fmtD(h.at.slice(0,10))}<br>${h.at.slice(11)}</span><span>${esc(h.what)}<br><span class="w">${esc(whoName(h.who))}${histVia(h)}</span></span></li>`).join('')}</ul>`:''}<div class="kv">${auditKv(t)}</div></details>`,
    foot:`<button class="btn act-more" id="tk-more">${ic('more','sm')}<span class="bl">Действия</span></button><div class="grow"></div>${taskOpen(t)&&t.exec===S.me?`<button class="btn ok" id="tk-done">${ic('ok','sm')}Выполнена</button>`:''}${taskPend(t)&&!taskConfWhy(t)?`<button class="btn danger-o" id="tk-rw">${ic('refresh','sm')}На доработку</button><button class="btn ok" id="tk-cf">${ic('check','sm')}Подтвердить</button>`:''}`,
    mount(el){const send=()=>{const v=val(el,'tk-c');if(!v)return;t.comments.push({who:S.me,at:TODAY+' '+bishkekNow().hm,text:v});m.draw()};$('#tk-cs',el).onclick=send;$('#tk-c',el).onkeydown=e=>{if(e.key==='Enter')send()};
      tsCardMount(el,t);if($('#tk-cpl',el))$('#tk-cpl',el).onclick=()=>openCp(CPM[t.cp]);if($('#tk-pjl',el))$('#tk-pjl',el).onclick=()=>openProject(pj);
      $('#tk-more',el).onclick=e=>menu(e.currentTarget,taskActions(t).filter(x=>x.label!=='Открыть'));if($('#tk-done',el))$('#tk-done',el).onclick=()=>taskDoneDlg(t);if($('#tk-cf',el))$('#tk-cf',el).onclick=()=>taskConfDlg(t);if($('#tk-rw',el))$('#tk-rw',el).onclick=()=>taskReworkDlg(t)}}}});
}
function taskDoneDlg(t){openModal({form:true,render:()=>({title:'Задача выполнена',sub:esc(t.title),body:(t.needFile?fld('Файл',`<input class="inp" type="file" id="td-f">`,{req:true,id:'td-f'}):'')+(t.confirm?`<div class="note">${ic('hourglass')}<span>Уйдёт на подтверждение: ${esc(empName(t.by))}</span></div>`:t.needFile?'':'<p class="muted" style="margin:0">Отметить задачу выполненной?</p>'),
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn ok" id="td-ok">Выполнена</button>',mount(el,m){$('#td-ok',el).onclick=()=>{let f=null;if(t.needFile){const x=$('#td-f',el).files[0];if(!setErr(el,'td-f',x?'':'Прикрепите файл'))return;f=x.name}t.doneAt=TODAY;if(f)t.file=f;if(t.confirm){const from=t.status;t.status='На подтверждении';t.rework='';log('t',t.id,`Статус: ${from} → На подтверждении`+(f?', файл: '+f:''));bellTask(t,'conf',t.by);m.close();refreshAll();toast(`Отправлено на подтверждение: ${empName(t.by)} получит уведомление в Telegram`,'hourglass');return}
  t.status='Выполнена';log('t',t.id,'Задача выполнена'+(f?', файл: '+f:''));m.close();refreshAll();toast('Задача выполнена','ok')}}})})}
function taskConfDlg(t){const why=taskConfWhy(t);if(why)return toast(why,'alert',true);const inst=t.by!==S.me;
  openModal({form:true,render:()=>({title:'Подтвердить выполнение',sub:esc(t.title),body:`<div class="kv"><div><span class="k">Исполнитель</span><span class="v">${esc(EM[t.exec]?EM[t.exec].fio:'—')}</span></div><div><span class="k">Выполнена</span><span class="v">${t.doneAt?fmtD(t.doneAt):'—'}</span></div>${t.file?`<div><span class="k">Файл</span><span class="v">${ic('file','sm')} ${esc(t.file)}</span></div>`:''}</div>${inst?`<div class="note">${ic('info')}<span>Вы подтверждаете вместо ${esc(empName(t.by))}</span></div>`:''}${fld('Комментарий',`<textarea class="inp" id="tc-c" style="min-height:60px"></textarea>`,{full:true,id:'tc-c'})}`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn ok" id="tc-ok">Подтвердить</button>',mount(el,m){$('#tc-ok',el).onclick=()=>{const c=val(el,'tc-c').trim();t.status='Подтверждена';t.confBy=S.me;t.confAt=nowStamp();t.confNote=c;log('t',t.id,'Статус: На подтверждении → Подтверждена'+(inst?` (вместо постановщика ${empName(t.by)})`:'')+(c?', '+c:''));bellTask(t,'ok',t.exec);m.close();refreshAll();toast(`Задача подтверждена: ${empName(t.exec)} получит уведомление`,'check')}}})})}
function taskReworkDlg(t){const why=taskConfWhy(t);if(why)return toast(why,'alert',true);
  openModal({form:true,render:()=>({title:'Вернуть на доработку',sub:esc(t.title),body:`${fld('Причина',`<textarea class="inp" id="tw-r" style="min-height:70px" placeholder="Что нужно доделать"></textarea>`,{req:true,full:true,id:'tw-r'})}<div class="hint">${esc(empName(t.exec))} получит причину в Telegram.${t.date<TODAY?' Срок прошёл: задача станет просроченной.':''}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn danger" id="tw-ok">На доработку</button>',mount(el,m){$('#tw-ok',el).onclick=()=>{const r=val(el,'tw-r').trim();if(!setErr(el,'tw-r',r?'':'Укажите причину'))return;t.status='На доработке';t.rework=r;t.reworkBy=S.me;log('t',t.id,`Статус: На подтверждении → На доработке (${r})`);bellTask(t,'rework',t.exec,r);m.close();refreshAll();toast('Задача возвращена на доработку','refresh')}}})})}
function taskFailDlg(t){openModal({form:true,render:()=>({title:'Задача не выполнена',sub:esc(t.title),body:fld('Причина',`<textarea class="inp" id="tf-r" style="min-height:70px"></textarea>`,{req:true,id:'tf-r'}),
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="tf-ok">Не выполнена</button>',mount(el,m){$('#tf-ok',el).onclick=()=>{const r=val(el,'tf-r');if(!setErr(el,'tf-r',r?'':'Укажите причину'))return;t.status='Не выполнена';t.reason=r;log('t',t.id,'Не выполнена: '+r);m.close();refreshAll();toast('Сохранено')}}})})}
function taskDlg(t,pre){const e=t||Object.assign({},pre||{});const st={kind:e.kind||'day',scope:e.cp?'cp':'gen',execT:!!t||!!(pre&&pre.exec),more:!!(t&&(e.desc||e.proj||e.kind==='month'||e.needFile))};const wasCp=!!(t&&t.cp);
  // Повтор (доработки 28.11.2026): у новой задачи — «Не повторять»; у задачи серии — правило серии; закрытой разовой задаче повтор не добавляется
  const s0=tsOf(t);st.rep=s0?structuredClone(s0.rule):pre&&pre.rep?structuredClone(pre.rep):null;
  const repStart=()=>st.kind==='day'?(e.date||addDays(TODAY,1)):lastDay(ym(e.date||TODAY));
  const repRow=()=>{if(t&&!s0&&!taskOpen(t))return '';
    if(s0&&s0.state==='Завершена')return fld('Повтор',`<div class="ts-ro">${ic('repeat','sm')}<span>${esc(tsTextS(s0))} · закончился</span></div>`,{id:'tk-rep',hint:'Продлить повтор — «Изменить повтор» в карточке задачи'});
    return fld('Повтор',`<div class="row ts-row"><button type="button" class="btn ts-btn" id="tk-rep">${ic('repeat','sm')}<span>${esc(st.rep?tsText(st.rep,repStart(),st.kind):'Не повторять')}</span></button>${st.rep&&!s0?`<button type="button" class="icon-btn sm" id="tk-rep-x" aria-label="Не повторять" title="Не повторять">${ic('x','sm')}</button>`:''}</div>`,
      {id:'tk-rep',hint:s0&&s0.state==='Остановлена'?'Повтор остановлен: возобновить — в карточке задачи':s0?'Правило меняется для этой и следующих задач':''})};
  const projsOf=cp=>PROJECTS.filter(p=>p.cp===cp&&p.status!=='Отменён'&&(p.status!=='Завершён'||p.id===e.proj));
  openModal({form:true,size:'mid',render:m=>{const cpOn=st.scope==='cp',projOn=cpOn&&feat('projects');
    const cf0=t?!!t.confirm:taskConfDef(),nMore=[e.desc,e.proj,e.kind==='month',e.needFile,e.cat&&e.cat!=='Сбор документов',e.confirm!=null&&!!e.confirm!==cf0].filter(Boolean).length;
    return {title:t?'Изменить задачу':'Новая задача',body:`<div class="form">
    <div class="fld full"><span class="lbl">Вид задачи</span><div class="seg" role="group" aria-label="Вид задачи" id="tk-scope" style="align-self:flex-start;width:max-content">${[['gen','Общая'],['cp','По контрагенту']].map(([k,l])=>`<button type="button" data-k="${k}" class="${st.scope===k?'on':''}">${l}</button>`).join('')}</div>${t&&wasCp&&!cpOn?`<div class="hint red">Контрагент и проект будут убраны из задачи</div>`:''}</div>
    ${fld('Название',inp('tk-title',e.title||''),{req:true,full:true,id:'tk-title'})}
    ${cpOn?fld('Контрагент',cpSel('tk-cp',visCps(),e.cp||'',{empty:'— выберите контрагента —'}),{req:true,id:'tk-cp'}):''}
    ${fld('Исполнитель',sel('tk-exec',EMP.filter(x=>x.active).map(x=>[x.id,x.short]),st.execT?e.exec:cpOn?taskExec0(e):S.me),{req:true,id:'tk-exec'})}
    ${st.kind==='day'?fld('Дата',inp('tk-date',e.date||addDays(TODAY,1),'type="date"'),{req:true,id:'tk-date'}):fld('Месяц',inp('tk-month',e.date?ym(e.date):ym(TODAY),'type="month"'),{req:true,id:'tk-month'})}
    ${repRow()}
    ${fMore(`${fld('Описание',`<textarea class="inp" id="tk-desc" style="min-height:70px">${esc(e.desc||'')}</textarea>`,{full:true,id:'tk-desc'})}
    ${projOn?fld('Проект',sel('tk-proj',[['',e.cp?'Без проекта':'— сначала выберите контрагента —'],...(e.cp?projsOf(e.cp).map(p=>[p.id,p.name]):[])],e.proj||''),{id:'tk-proj'}):''}
    ${fld('Категория',sel('tk-cat',DICT.cats.items.filter(x=>x.active).map(x=>x.name),e.cat||'Сбор документов'),{id:'tk-cat'})}${fld('Вид срока',sel('tk-kind',[['day','На день'],['month','На месяц (до последнего дня)']],st.kind),{id:'tk-kind'})}
    <div class="fld full"><span class="lbl">При выполнении</span><label class="row" style="min-height:35px"><input type="checkbox" class="sw" id="tk-file" ${e.needFile?'checked':''}> нужен файл</label>
    <label class="row" style="min-height:35px"><input type="checkbox" class="sw" id="tk-conf" ${(t?e.confirm:e.confirm!=null?e.confirm:taskConfDef())?'checked':''} ${t&&!taskOpen(t)&&!taskPend(t)?'disabled':''}> нужно подтверждение</label>${t&&!taskOpen(t)&&!taskPend(t)?'<span class="hint">Задача уже закрыта: признак не меняется</span>':t&&taskPend(t)?'<span class="hint">Если снять, задача сразу станет «Выполнена»</span>':''}</div>`,'Дополнительно',{id:'tk-more',open:st.more,n:nMore})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="tk-ok">'+(t?'Сохранить':'Поставить задачу')+'</button>',
    mount(el){const snapT=()=>{e.title=val(el,'tk-title');e.desc=val(el,'tk-desc');e.cat=val(el,'tk-cat');if($('#tk-cp',el))e.cp=+val(el,'tk-cp')||'';if($('#tk-proj',el))e.proj=val(el,'tk-proj')||null;if(st.execT)e.exec=val(el,'tk-exec');e.needFile=$('#tk-file',el).checked;e.confirm=$('#tk-conf',el).checked;if($('#tk-date',el))e.date=val(el,'tk-date');const mv=$('#tk-month',el)&&val(el,'tk-month');if(mv)e.date=lastDay(mv)};
      $$('#tk-scope button',el).forEach(b=>b.onclick=()=>{snapT();st.scope=b.dataset.k;m.draw()});
      $('#tk-kind',el).onchange=ev=>{snapT();st.kind=ev.target.value;if(st.rep&&st.kind==='month'&&(st.rep.u==='day'||st.rep.u==='week')){st.rep.u='month';delete st.rep.wd}m.draw()};
      const rb=$('#tk-rep',el);if(rb&&rb.tagName==='BUTTON')rb.onclick=()=>{snapT();tsDlg({rule:st.rep,start:repStart(),kind:st.kind,done:(r,d)=>{st.rep=r;e.date=d;m.dirty=true;m.draw()}})};
      if($('#tk-rep-x',el))$('#tk-rep-x',el).onclick=()=>{snapT();st.rep=null;m.draw()};$('#tk-exec',el).onchange=()=>{st.execT=true;e.exec=val(el,'tk-exec')};
      if($('#tk-cp',el))$('#tk-cp',el).onchange=()=>{snapT();e.proj=null;m.draw()};
      $('#tk-more',el).ontoggle=ev=>{st.more=ev.target.open};
      $('#tk-ok',el).onclick=()=>{const title=val(el,'tk-title');if(!setErr(el,'tk-title',title?'':'Введите название'))return;
        const cp=st.scope==='cp'?+val(el,'tk-cp')||null:null;if(st.scope==='cp'&&!setErr(el,'tk-cp',cp?'':'Выберите контрагента'))return;
        const proj=st.scope==='cp'&&$('#tk-proj',el)?val(el,'tk-proj')||null:null;
        const date=st.kind==='day'?val(el,'tk-date'):lastDay(val(el,'tk-month'));if(st.kind==='day'&&!setErr(el,'tk-date',date?'':'Укажите дату'))return;
        const o={title,desc:val(el,'tk-desc'),cat:val(el,'tk-cat'),cp,proj,exec:val(el,'tk-exec'),kind:st.kind,date,needFile:$('#tk-file',el).checked,confirm:$('#tk-conf',el).disabled?!!(t&&t.confirm):$('#tk-conf',el).checked};
        const ruleCh=!!s0&&JSON.stringify(st.rep)!==JSON.stringify(s0.rule);
        if(!t){let ser=null;const d0=date;if(st.rep){ser=tsNew(o,st.rep,date);const d=tsNext(ser,maxIso(date,TODAY));if(!d)return toast('По правилу повтора нет ни одной даты: проверьте «Окончание»','alert',true);o.date=d}
          const n=Object.assign({id:'t'+(TID++),by:S.me,status:'К выполнению',file:null,reason:'',created:TODAY,doneAt:null,comments:[]},o);if(ser){n.ser=ser.id;TSER.push(ser)}born(n);TASKS.push(n);log('t',n.id,'Задача поставлена');
          if(ser){log('t',n.id,'Повтор настроен: '+tsTextS(ser));if(!tsUpcoming(ser))tsFin(ser)}bellTask(n,'new',n.exec);
          m.close();refreshAll();toast(ser?`Задача с повтором поставлена: ${empName(o.exec)}${o.date!==d0?', первая — на '+fmtD(o.date):''}`:`Задача поставлена: ${empName(o.exec)}`,'task');return}
        // Задача серии: «Только эту задачу» или «Эту и следующие»; правило — только через «Эту и следующие»
        if(s0&&s0.state!=='Завершена')return tsAsk({title:'Изменить задачу серии',oneWhy:ruleCh?'Правило повтора меняется только для этой и следующих задач':'',run:v=>{taskApply(t,o);if(v==='all')tsApplyAll(s0,t,o,st.rep);m.close();refreshAll();toast(v==='all'?'Сохранено: эта и следующие задачи серии':'Задача сохранена','task')}});
        taskApply(t,o);if(st.rep&&!s0&&taskOpen(t)){const ser=tsNew(o,st.rep,t.date);TSER.push(ser);t.ser=ser.id;log('t',t.id,'Повтор настроен: '+tsTextS(ser));if(!tsUpcoming(ser))tsFin(ser)}
        m.close();refreshAll();toast('Задача сохранена','task')}}}}});
}
// Изменение одной задачи из окна «Изменить задачу»
function taskApply(t,o){const was=t.cp?'По контрагенту':'Общая',now=o.cp?'По контрагенту':'Общая';const cw=!!t.confirm,ex=t.exec;Object.assign(t,o);if(t.exec!==ex)bellTask(t,'new',t.exec);log('t',t.id,was!==now?`Вид задачи изменён: «${was}» → «${now}»`:'Задача изменена');
          if(cw!==o.confirm){log('t',t.id,`Подтверждение: ${o.confirm?'требуется':'не требуется'}`);if(!o.confirm&&t.status==='На подтверждении'){t.status='Выполнена';log('t',t.id,'Статус: На подтверждении → Выполнена (подтверждение не требуется)')}else if(!o.confirm&&t.status==='На доработке'){t.status='В работе';log('t',t.id,'Статус: На доработке → В работе (подтверждение не требуется)')}}}
// «Эту и следующие»: поля серии и открытых следующих задач, правило и начало — от срока этой задачи
function tsApplyAll(s,t,o,rule){const was=tsTextS(s);s.tpl=tsFields(o);if(rule)s.rule=structuredClone(rule);s.start=o.date;touch(s);
  TASKS.filter(x=>x.ser===s.id&&x!==t&&x.date>t.date&&taskOpen(x)).forEach(x=>{Object.assign(x,tsFields(o));touch(x)});
  const now=tsTextS(s);log('t',t.id,was!==now?`Повтор изменён: ${was} → ${now}`:'Изменены эта и следующие задачи серии',t.cp)}
