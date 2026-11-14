'use strict';
// Действия сотрудника из чата бота (поток Т, задача Т2; пакет заказчика 13.11.2026, идеи 1, 3 и 7 списка «Идеи для Telegram-бота»):
//   отчёт — «В работе», «Сдан», «Открыть»; задача — «Взять в работу», «Выполнена», «Открыть задачу»; сдача ждёт подтверждения — «Подтвердить», «Вернуть» с причиной.
// Кнопки стоят под сообщением об одной записи: одно сообщение — один отчёт или одна задача. Так нажатие всегда относится к одной записи, а после нажатия видно, что с ней сделано.
// Напоминание за день по-прежнему приходит одним сообщением (все отчёты списком); следом — сообщения с кнопками для первых 10 отчётов, сначала самые срочные. Остальные — на сайте.
// Правила те же, что на сайте, и проверяются при каждом нажатии: право, область «Свои / Все», статус записи. Чего в чате сделать нельзя, бот объясняет скрытым ответом и отправляет на сайт кнопкой «Открыть»:
//   «Сдан» без суммы налога (сумму вводят на сайте), «Сдан» до оплаты налога и возврат переплаты по уточнённому отчёту (деньги — только на сайте), подтверждение сдачи без обязательной квитанции.
// Решение заказчика 13.11.2026: если для «Сдан» нужен файл, бот просит прислать файл ответом на сообщение; пока файла нет, отчёт не сдан. Так же закрывается задача с «Требуется файл при выполнении».
const TG_BTN_MAX=10,TG_SITE='https://buhuchet.kg/app';
const tgRepOf=id=>REPORTS.find(x=>x.id===+id);
const tgRepName=r=>`${T[r.t].short} за ${r.phuman}`;
const tgRepFull=r=>`${tgRepName(r)}, ${CPM[r.cp].name}`;
const tgDM=s=>fmtD(s).slice(0,5);
// Отчёт в области сотрудника: свой или все — как в списке отчётов; контрагент не в архиве
const tgRepIn=(u,id)=>{const r=tgRepOf(id);return !!r&&!CPM[r.cp].archived&&visReports().includes(r)};
const tgRepOpen=r=>!!r&&!r.superseded&&OPEN.has(r.status)&&!tR(r).payOnly;
// Срок словами для строки под названием отчёта
function tgDueTxt(r){const d=diffDays(r.due,TODAY);return `срок ${tgDM(r.due)} · `+(d<0?`просрочен на ${-d} дн.`:d===0?'сегодня последний день':`через ${d} дн.`)}
const tgOpenBtn=(r)=>({t:tgBtnT('tgBtnOpen','Открыть'),url:`${TG_SITE}/reports/all?report=${r.id}`,go:()=>openReport(r)});
// Сообщение об одном отчёте с кнопками. «В работе» есть только у отчёта «К сдаче»
function tgRepMsg(r,at,sub){return {h:tgRepName(r),sub:`${CPM[r.cp].name} · ${sub||tgDueTxt(r)}`,at,
  btns:[[...(r.status==='К сдаче'?[{t:tgBtnT('tgBtnWork','В работе'),act:'repWork',arg:r.id}]:[]),{t:tgBtnT('tgBtnDone','Сдан'),act:'repDone',arg:r.id},tgOpenBtn(r)]]}}

tgAct('repWork',{change:true,perm:'changeStatus',scope:tgRepIn,stale:(u,id)=>{const r=tgRepOf(id);return !tgRepOpen(r)||r.status!=='К сдаче'},
  run:(u,id)=>{const r=tgRepOf(id);r.status='В работе';tgLog('r',r.id,'Статус: К сдаче → В работе',r.cp);return {done:'✓ В работе',eph:tplFill('tgActRepWork',{отчёт:tgRepFull(r)})}}});
// Что мешает отметить «Сдан» из чата; пусто — можно
function tgRepDoneWhy(r){const v={отчёт:tgRepFull(r)};
  if(subPayWhy(r))return tplFill('tgActRepPay',v);
  if(tR(r).sum&&r.sum==null)return tplFill('tgActRepSum',v);
  if(r.ver&&r.paid>(r.sum||0))return tplFill('tgActRepSite',v);
  if(needF(r)&&!feat('files'))return tplFill('tgActRepSite',v);
  return ''}
// «Сдан» сегодняшней датой — та же запись, что делает окно «Отметить отчёт сданным» на сайте; f — файл, присланный боту, note — подпись к нему
function tgRepSubmit(r,f,note){const o=r.status;
  if(f){r.files.push(f.name);FUP.add(f.name);fNoteAdd(r.cp,[f],note);tgLog('r',r.id,'Прикреплены файлы: '+f.name+fNoteLog(fNoteClean(note)),r.cp)}
  Object.assign(r,{status:'Сдан',subDate:TODAY,subAt:nowStamp(),subBy:S.me,confAt:null,confBy:null,confNote:'',fixWhy:'',fixBy:null,fixAt:null});
  tgLog('r',r.id,`Статус: ${o} → Сдан${r.sum!=null&&tR(r).sum?`, сумма к уплате ${som(r.sum)}`:''}${f?`, файлы: ${f.name}`:''}`,r.cp);
  return {done:'✓ Сдан',off:['repWork'],text:tplFill(repWait(r)?'tgActRepWait':'tgActRepDone',{отчёт:tgRepFull(r)})}}
tgAct('repDone',{change:true,perm:'changeStatus',scope:tgRepIn,stale:(u,id)=>!tgRepOpen(tgRepOf(id)),
  run:(u,id)=>{const r=tgRepOf(id),no=tgRepDoneWhy(r);if(no)return {eph:no};
    if(needF(r))return {ask:{act:'repFile',arg:id,kind:'file',re:tgRepFull(r),t:tplFill('tgRepAskFile',{отчёт:tgRepFull(r)})}};
    const x=tgRepSubmit(r);return {done:x.done,off:x.off,eph:x.text}}});
tgAct('repFile',{change:true,perm:'changeStatus',scope:tgRepIn,stale:(u,id)=>!tgRepOpen(tgRepOf(id)),
  reply:(u,id,p)=>{const r=tgRepOf(id);if(!p.file)return {again:tplFill('tgAskNeedFile',{})};const bad=tgFileWhy(p.file);if(bad)return {again:bad};
    const no=tgRepDoneWhy(r);if(no)return {say:no};
    const x=tgRepSubmit(r,p.file,p.cap);return {done:x.done,off:x.off,say:x.text}}});

// Задачи (идея 3). Сообщение о новой задаче приходит исполнителю; нажимает исполнитель, постановщик получает сообщение о каждом нажатии
const tgTaskOf=id=>TASKS.find(x=>x.id===id);
const tgTaskIn=(u,id)=>{const t=tgTaskOf(id);return feat('tasks')&&!!t&&t.exec===u.id};
function tgTaskMsg(t,at){return {h:t.title,sub:tplFill('tgTask',{автор:empName(t.by)||'—',задача:t.title,срок:fmtD(t.date)}),at,
  btns:[[...(t.status==='К выполнению'?[{t:tgBtnT('tgBtnTaskWork','Взять в работу'),act:'taskWork',arg:t.id}]:[]),{t:tgBtnT('tgBtnTaskDone','Выполнена'),act:'taskDone',arg:t.id}],
    [{t:tgBtnT('tgBtnTaskOpen','Открыть задачу'),url:`${TG_SITE}/tasks/mine?task=${t.id}`,go:()=>openTask(t)}]]}}
// Сообщение постановщику: в макете — строка журнала «Телеграм» (чат постановщика здесь не показан)
function tgTaskTell(t,kind){const a=t.by&&t.by!==t.exec&&EM[t.by];if(a&&a.tg)TG_LOG.unshift({id:TG_LOG.length+1,at:nowStamp(),to:a.short+' '+a.tg,org:ORG.name,kind,st:'Ожидает',tries:0,err:''})}
tgAct('taskWork',{change:true,scope:tgTaskIn,stale:(u,id)=>tgTaskOf(id).status!=='К выполнению',
  run:(u,id)=>{const t=tgTaskOf(id);t.status='В работе';tgLog('t',t.id,'Статус: К выполнению → В работе');tgTaskTell(t,'Задача взята в работу');return {done:'✓ В работе',eph:tplFill('tgActTaskWork',{})}}});
function tgTaskFinish(t,f,note){const from=t.status;t.doneAt=TODAY;if(f){t.file=f.name;FUP.add(f.name);fNoteAdd(t.cp,[f],note)}
  if(t.confirm){t.status='На подтверждении';t.rework='';tgLog('t',t.id,`Статус: ${from} → На подтверждении`+(f?', файл: '+f.name:''))}
  else{t.status='Выполнена';tgLog('t',t.id,'Задача выполнена'+(f?', файл: '+f.name:''))}
  tgTaskTell(t,t.confirm?'Задача ждёт подтверждения':'Задача выполнена');
  return {done:'✓ Выполнена',off:['taskWork'],text:tplFill(t.confirm?'tgActTaskWait':'tgActTaskDone',{})}}
tgAct('taskDone',{change:true,scope:tgTaskIn,stale:(u,id)=>!taskOpen(tgTaskOf(id)),
  run:(u,id)=>{const t=tgTaskOf(id);
    if(t.needFile&&!t.file)return feat('files')?{ask:{act:'taskFile',arg:id,kind:'file',re:t.title,t:tplFill('tgTaskAskFile',{задача:t.title})}}:{eph:tplFill('tgActFailed',{})};
    const x=tgTaskFinish(t);return {done:x.done,off:x.off,eph:x.text}}});
tgAct('taskFile',{change:true,scope:tgTaskIn,stale:(u,id)=>!taskOpen(tgTaskOf(id)),
  reply:(u,id,p)=>{if(!p.file)return {again:tplFill('tgAskNeedFile',{})};const bad=tgFileWhy(p.file);if(bad)return {again:bad};
    const x=tgTaskFinish(tgTaskOf(id),p.file,p.cap);return {done:x.done,off:x.off,say:x.text}}});

// Подтверждение сдачи (идея 7): сотруднику с правом «Подтверждать сдачу отчётов». Свой сданный отчёт подтвердить нельзя (владельцу можно) — как на сайте
function tgConfMsg(r,at){return {h:tgRepName(r),sub:`${CPM[r.cp].name} · сдан ${tgDM(r.subDate||TODAY)}${empName(r.subBy||r.resp)?', '+empName(r.subBy||r.resp):''}`,at,
  btns:[[{t:tgBtnT('tgBtnConfOk','Подтвердить'),act:'confOk',arg:r.id},{t:tgBtnT('tgBtnConfBack','Вернуть'),act:'confBack',arg:r.id},tgOpenBtn(r)]]}}
const tgConfOwn=r=>r.subBy===S.me&&me().role!=='owner';
const tgConfStale=(u,id)=>!repWait(tgRepOf(id));
tgAct('confOk',{change:true,perm:'repConfirm',scope:tgRepIn,stale:tgConfStale,
  run:(u,id)=>{const r=tgRepOf(id),v={отчёт:tgRepFull(r)};if(tgConfOwn(r))return {eph:tplFill('tgActConfOwn',{})};
    if(needRcpt(r)&&!r.files.length)return {eph:tplFill('tgActConfRcpt',v)};
    Object.assign(r,{confAt:nowStamp(),confBy:S.me,confNote:''});tgLog('r',r.id,'Сдача подтверждена',r.cp);
    return {done:'✓ Подтверждено',off:['confBack'],eph:tplFill('tgActConfOk',v)}}});
tgAct('confBack',{change:true,perm:'repConfirm',scope:tgRepIn,stale:tgConfStale,
  run:(u,id)=>{const r=tgRepOf(id);if(tgConfOwn(r))return {eph:tplFill('tgActConfOwn',{})};
    return {ask:{act:'confWhy',arg:id,kind:'text',ph:'Например: не приложена квитанция',re:tgRepFull(r),t:tplFill('tgConfAskWhy',{отчёт:tgRepFull(r)})}}}});
// Причина возврата — текст до 500 знаков; без причины отчёт не возвращается. Запись та же, что делает «На исправление» на сайте; ответственный получает причину и кнопки отчёта
tgAct('confWhy',{change:true,perm:'repConfirm',scope:tgRepIn,stale:tgConfStale,
  reply:(u,id,p)=>{const r=tgRepOf(id),why=String(p.text||'').replace(/[()]/g,'').replace(/\s+/g,' ').trim().slice(0,500);if(!why)return {again:tplFill('tgAskNeedText',{})};
    if(tgConfOwn(r))return {say:tplFill('tgActConfOwn',{})};
    Object.assign(r,{status:'Требует исправления',fixWhy:why,fixBy:S.me,fixAt:nowStamp(),confAt:null,confBy:null,confNote:''});tgLog('r',r.id,`Статус: Сдан → Требует исправления (на исправление: ${why})`,r.cp);
    const e=EM[r.resp];if(e&&e.tg)TG_LOG.unshift({id:TG_LOG.length+1,at:nowStamp(),to:e.short+' '+e.tg,org:ORG.name,kind:'Возврат на исправление',st:'Ожидает',tries:0,err:''});
    return {done:'↩ Возвращён',off:['confOk'],say:tplFill('tgConfBackOk',{отчёт:tgRepFull(r)})}}});
// Сообщение ответственному о возврате: прежний текст шаблона и кнопки отчёта — исправил и сразу отметил «Сдан»
function tgFixMsg(r,at){return {t:tplFill('tgFix',{отчёт:tgRepFull(r),причина:r.fixWhy||'—',автор:empName(r.fixBy)||'—'}),at,btns:[[{t:tgBtnT('tgBtnDone','Сдан'),act:'repDone',arg:r.id},tgOpenBtn(r)]]}}

// Чат сотрудника в макете: что бот прислал бы ему сегодня. В макете в него попадают все его несданные отчёты со сроком в ближайшие дни напоминания, все ждущие подтверждения и все новые задачи —
// чтобы было что нажать; в продукте напоминание приходит в свои дни (за N дней, в день срока, при просрочке), о задаче — когда её поставили, о подтверждении — когда сдача ждёт дольше заданного
function tgStaffList(u){const L=[{day:'Сегодня'}],put=(k,m)=>L.push(tgIn(k,m)),list=rs=>rs.map(r=>`${tgRepName(r)} — ${CPM[r.cp].name}`).join(', ');
  if(feat('telegram')){
    const days=r=>{const o=ORG.types[r.t];return Math.max(0,...((o&&o.days)||ORG.remind||[]))};
    const mine=visReports().filter(r=>r.resp===u.id&&tgRepOpen(r)&&!CPM[r.cp].archived&&diffDays(r.due,TODAY)<=days(r)).sort((a,b)=>a.due<b.due?-1:a.due>b.due?1:a.id-b.id);
    const ov=mine.filter(r=>r.due<TODAY),td=mine.filter(r=>r.due===TODAY),bf=mine.filter(r=>r.due>TODAY);
    // Налоги к оплате: срок оплаты впереди, в пределах дней напоминания (задача Т3: раздел «Оплата налогов» утренней таблицы)
    const pay=visReports().filter(r=>r.resp===u.id&&tgPayOpen(r)&&!CPM[r.cp].archived&&r.payDue>TODAY&&diffDays(r.payDue,TODAY)<=days(r)).sort((a,b)=>a.payDue<b.payDue?-1:a.payDue>b.payDue?1:a.id-b.id);
    if(mine.length||pay.length){const by={},pby={};bf.forEach(r=>{const d=diffDays(r.due,TODAY);(by[d]=by[d]||[]).push(r)});pay.forEach(r=>{const d=diffDays(r.payDue,TODAY);(pby[d]=pby[d]||[]).push(r)});
      // Утреннее напоминание — таблицей с разделами (tgMornMsg); простой текст — прежние строки
      const plain=[ov.length?tplFill('tgOver',{список:list(ov)}):'',td.length?tplFill('tgToday',{список:list(td)}):'',...Object.keys(by).map(d=>tplFill('tgBefore',{дней:d,список:list(by[d])})),...Object.keys(pby).map(d=>tplFill('tgPay',{дней:d,список:list(pby[d])}))].filter(Boolean).join('\n');
      put('rep',tgMornMsg({ov,td,by,pay,plain},'08:00'));
      mine.slice(0,TG_BTN_MAX).forEach(r=>put('rep',tgRepMsg(r,'08:00')));
      if(mine.length>TG_BTN_MAX)put('rep',{t:tplFill('tgMoreOnSite',{n:TG_BTN_MAX,ещё:mine.length-TG_BTN_MAX}),at:'08:00',btns:[[{t:tgBtnT('tgBtnOpenReports','Открыть отчёты на сайте'),url:`${TG_SITE}/reports/all`}]]})}
    const fx=visReports().filter(r=>r.resp===u.id&&r.status==='Требует исправления'&&r.fixWhy&&r.fixBy!==u.id&&(r.fixAt||'').slice(0,10)===TODAY&&!mine.slice(0,TG_BTN_MAX).includes(r));
    fx.forEach(r=>put('rep',tgFixMsg(r,(r.fixAt||'').slice(11)||'08:00')));
    if(can('repConfirm')){const w=repWaitList().filter(r=>!tgConfOwn(r)&&!CPM[r.cp].archived).sort((a,b)=>(a.subAt||'')<(b.subAt||'')?-1:1);
      if(w.length){put('rep',{t:tplFill('tgConfHead',{n:w.length}),at:'08:00'});w.slice(0,TG_BTN_MAX).forEach(r=>put('rep',tgConfMsg(r,'08:00')));
        if(w.length>TG_BTN_MAX)put('rep',{t:tplFill('tgMoreOnSite',{n:TG_BTN_MAX,ещё:w.length-TG_BTN_MAX}),at:'08:00',btns:[[{t:tgBtnT('tgBtnOpenReports','Открыть отчёты на сайте'),url:`${TG_SITE}/reports/wait`}]]})}}}
  // Сводка недели руководителю: в продукте — по понедельникам, в макете — всегда, чтобы было что открыть (задача Т3)
  if(feat('telegram')&&tgIsBoss(u)&&tgNotifyOn(u,'week')){const w=tgWeekMsg(u,'08:00');if(w)put('rep',w)}
  // «Напомнить» от руководителя: сотрудник видит своё просроченное списком
  if(feat('telegram')&&u.nudge&&u.nudge.day===TODAY&&tgOverOf(u.id).length)put('rep',tgNudgeMsg(u,u.nudge.at||'09:00'));
  if(feat('tasks'))TASKS.filter(t=>t.exec===u.id&&t.status==='К выполнению').slice(0,5).forEach(t=>put('task',tgTaskMsg(t,(t._ca||'').slice(0,10)===TODAY?(t._ca||'').slice(11):'09:00')));
  // Сообщения о безопасности с кнопкой «Это не я» (задача Т4): приходят всегда, их нельзя отключить
  tgSecOf(u,u.tg).forEach(m=>put('sec',m));
  return L}
function tgStaffDlg(){const u=me(),L=tgStaffList(u);
  tgBotDlg(u,L,{live:true,menu:true,title:'Прототип: чат с ботом',sub:L.length>1?'Утреннее напоминание и сводка недели — таблицами; отчёты, задачи и подтверждение сдачи — кнопками; внизу — меню команд':'Сегодня бот ничего не прислал: срочных отчётов и новых задач нет. Внизу — меню команд',
    note:'Это макет: кнопки работают и меняют данные так же, как на сайте, запись в истории получает отметку «через Telegram». Кнопки есть у первых 10 отчётов напоминания, сначала самые срочные. Сводку недели руководитель получает по понедельникам — в макете она есть всегда. Внизу — меню команд: бот по запросу покажет отчёты на сегодня, на неделю, просроченные и карточку контрагента. Деньги и удаление — только на сайте.'})}
