'use strict';
// Модуль «Контрагенты»: список, архивирование, поступления
/* ═════════════ Контрагенты ═════════════ */
function cpsTabs(){const v=visCps(true);const a=v.filter(c=>!c.archived);return [
 {id:'all',label:'Все',icon:'list',count:a.length},
 {id:'mine',label:'Мои контрагенты',icon:'user',count:CPS.filter(c=>!c.archived&&c.resp===S.me).length},
 feat('fee')&&can('fee')?{id:'debtors',label:'Должники',icon:'coins',count:a.filter(c=>c.feeDebt>0).length,red:true}:null,
]}
function cpsAdd(){return [can('createCp')&&{label:'Контрагент',icon:'building',run:addCpDlg},can('cpImport')&&{label:'Загрузка из Excel',icon:'paste',run:importDlg},can('createCp')&&{label:'Из свидетельства и выписки',icon:'upload',run:regDocsDlg,beta:true,sub:'PDF Минюста: форма заполнится сама'}].filter(Boolean)}
// Значок «Показатели не заполнены» у контрагента: в подсказке месяцы, красный — есть просроченные
const cpKpiPill=c=>{const x=kMissOk()&&!c.archived&&kMissCnt().by[c.id];return x?` <span class="pill ${x.over?'red':'yellow'} sm" title="${esc(kMissTip(x))}" aria-label="${esc(kMissTip(x))}">${ic('gauge')}${x.ms.length}</span>`:''};
function cpCols(){const fee=feat('fee')&&can('fee');return [
 {key:'name',label:'Название',type:'text',w:250,val:c=>c.name,html:c=>`<span class="strong">${esc(c.name)}</span>${!c.resp&&!c.archived?` <span class="pill orange sm">${ic('alert')}нет ответственного</span>`:''}${cpKpiPill(c)}`},
 {key:'inn',label:'ИНН',type:'text',w:150,val:c=>c.inn,cls:'mono'},
 {key:'phone',label:'Телефон',type:'text',w:190,val:c=>fmtPhone(c.phone),html:c=>phoneHtml(c.phone),hide:true},
 {key:'form',label:'Форма',type:'enum',w:90,val:c=>c.form,hide:true},
 {key:'regime',label:'Режим налогообложения',type:'enum',w:170,val:c=>c.regime},{key:'regime2',label:'Дополнительный режим',type:'enum',w:170,hide:true,val:c=>c.regime2||''},{key:'ben',label:'Льготы и особые статусы',type:'text',w:220,hide:true,val:c=>(c.ben||[]).join(', ')},
 {key:'gked',label:'Основной ГКЭД',type:'text',w:280,val:c=>c.gked?gkT(c.gked):'',html:c=>c.gked?`<span class="mono">${esc(c.gked)}</span> ${esc(gkName(c.gked))}`:`<span class="pill yellow sm">${ic('alert')}Без ГКЭД</span>`,match:gkMatch,hide:true},
 {key:'gked2',label:'Дополнительные ГКЭД',type:'text',w:220,val:c=>(c.gked2||[]).join(', '),cls:'mono',match:gkMatch,hide:true},
 {key:'gkno',label:'ГКЭД указан',type:'enum',w:120,val:c=>c.gked?'Да':'Нет',hide:true},
 {key:'sft',label:'Тариф Соцфонда',type:'enum',w:190,val:c=>sfName(c),html:c=>{const x=sfState(c);return x?sfPill(x.cur,1)+(x.ask&&x.cur?` <span class="pill yellow sm">${ic('alert')}под вопросом</span>`:''):''},hide:true},
 {key:'sfq',label:'Тариф под вопросом',type:'enum',w:150,val:c=>{const x=sfState(c);return x&&x.ask?'Да':'Нет'},hide:true},
 {key:'ugns',label:'Налоговый орган',type:'enum',w:210,val:c=>ugnsLabel(c.ugns),hide:true},
 {key:'kind',label:'Тип обслуживания',type:'enum',w:150,val:c=>c.kind==='oneoff'?'Разовое':'Постоянное',hide:true},
 {key:'svc',label:'Статус обслуживания',type:'enum',w:190,val:c=>c.status,html:c=>scaleMini('svc',c.status,c)},
 {key:'resp',label:'Ответственный',type:'enum',w:140,val:c=>c.resp?empName(c.resp):''},
 {key:'start',label:'Начало обслуживания',type:'date',w:130,val:c=>c.start,hide:true},
 {key:'onesum',label:'Платит одной суммой',type:'enum',w:150,val:c=>c.oneSum?'Да':'Нет',hide:true},
 {key:'needf',label:'Файл к поступлению обязателен',type:'enum',w:200,val:c=>c.needInFile?'Да':'Нет',hide:true},
 {key:'contract',label:'Договор',type:'text',w:170,val:c=>c.contract&&c.contract!=='—'?c.contract:'',hide:true},
 {key:'head',label:'Руководитель',type:'text',w:190,val:c=>c.head||'',hide:true},
 {key:'contact',label:'Контактное лицо',type:'text',w:190,val:c=>c.contact||'',hide:true},
 {key:'nrep',label:'Видов отчётов',type:'int',w:112,num:true,val:c=>c.assign.filter(a=>!a.to).length,hide:true},
 ...(kMissOk()?[{key:'kpin',label:'Не заполнены показатели',type:'enum',w:180,hide:true,val:c=>kMissCnt().by[c.id]?'Да':'Нет'}]:[]),
 {key:'over',label:'Просрочено',type:'int',w:110,num:true,val:c=>c.overdue,html:c=>c.overdue?`<span class="pill red sm">${ic('alert')}${c.overdue}</span>`:'<span class="faint">0</span>'},
 ...(feat('taxpay')&&can('money')?[{key:'free',label:'Свободный остаток',type:'money',w:140,num:true,val:c=>c.free,hide:true}]:[]),
 ...(fee?[{key:'fee',label:'Стоимость обслуживания',type:'money',w:185,num:true,hide:true,val:c=>curTariff(c)?curTariff(c).amount:null,html:c=>{const t=curTariff(c);return t?fmtM(t.amount)+` <span class="faint">/ ${t.per==='Y'?'год':'мес'}</span>`:'<span class="faint">—</span>'}},
   {key:'debt',label:'Долг за обслуживание',type:'money',w:165,num:true,total:true,hide:true,val:c=>c.feeDebt,html:c=>c.feeDebt>0?`<span class="red strong">${fmtM(c.feeDebt)}</span>`:'<span class="faint">0,00</span>'}]:[])]}
function cpActions(c){const it=[{label:'Открыть карточку',icon:'building',run:()=>openCp(c)}];
  if(!c.archived){
    if(can('createCp'))it.push({label:'Изменить',icon:'edit',run:()=>editCpDlg(c)});
    if(can('assign')||can('createCp'))it.push({label:'Сменить ответственного',icon:'user',run:()=>respDlg([c])});
    if(can('assign')||can('createCp'))it.push({label:'Подобрать отчёты',icon:'matrix',run:()=>pickForCp(c)});
    if(can('cpArchive')){const linked=REPORTS.some(r=>r.cp===c.id)?'По контрагенту есть отчёты — его можно только отправить в архив':OPS.some(o=>o.cp===c.id)||FEEPAYS.some(f=>f.cp===c.id)?'По контрагенту есть деньги — его можно только отправить в архив':PROJECTS.some(p=>p.cp===c.id)||SERVICES.some(s=>s.cp===c.id)?'По контрагенту есть проекты или услуги — его можно только отправить в архив':'';
      c._del={label:'Удалить',icon:'trash',danger:true,disabled:!!linked,reason:linked,run:()=>confirmDlg({title:`Удалить ${esc(c.name)}?`,text:'По контрагенту нет отчётов, денег и проектов. Он будет удалён вместе с задачами и файлами карточки; вернуть его нельзя.',ok:'Удалить',danger:true,run:()=>{const i=CPS.indexOf(c);if(i>=0)CPS.splice(i,1);delete CPM[c.id];for(let k=TASKS.length-1;k>=0;k--)if(TASKS[k].cp===c.id)TASKS.splice(k,1);log('org','cps',`Удалён контрагент ${c.name} (ИНН ${c.inn})`);refreshAll();toast('Контрагент удалён','trash')}})}}
    if(feat('taxpay')&&can('money'))it.push({label:'Поступление денег',icon:'wallet',run:()=>inDlg(c)});
    if(feeAccOk(c))it.push({label:'Принять оплату за обслуживание',icon:'coins',sub:c.feeDebt?'Долг '+som(c.feeDebt):'',run:()=>feePayDlg(c)});
    if(can('projects')&&feat('finops'))it.push({label:'Разовая услуга',icon:'coins',run:()=>serviceDlg(null,c)});if(can('projects')&&feat('projects'))it.push({label:'Новый проект',icon:'briefcase',run:()=>projectDlg(null,c)});
    if(feat('fee')&&can('fee')&&c.feeDebt>0)it.push({label:'Напомнить о долге в WhatsApp',icon:'chat',run:()=>waDlg({cp:c,fee:true})});
    if(can('createCp')||can('cpPause')||can('cpArchive')){it.push({sep:true});const l=lastPeriod(c);
      if(c.kind==='oneoff'){if(can('createCp'))it.push({label:'Перевести в постоянное обслуживание',icon:'repeat',run:()=>toRegularDlg(c)})}
      else if(can('cpPause')){const pp=planPause(c);
        if(pp)it.push({label:'Отменить приостановку',icon:'refresh',sub:`Запланирована с ${ymG(pp.from)}`,disabled:!can('rollback'),reason:'Нужно право «Откат статусов»',run:()=>unpauseCp(c)});
        if(l&&l.to==null&&l.from>ym(TODAY))it.push({label:`Изменить возобновление: сейчас с ${ymG(l.from)}`,icon:'play',run:()=>resumeDlg(c)});
        else if(l&&l.to==null){if(!pp)it.push({label:'Приостановить обслуживание',icon:'pause',run:()=>pauseDlg(c)})}
        else if(!pp)it.push({label:'Возобновить обслуживание',icon:'play',run:()=>resumeDlg(c)});
        if(!pp&&c.status==='Приостановлен')it.push({label:'Откатить приостановку',icon:'history',disabled:!can('rollback'),reason:'Нужно право «Откат статусов»',run:()=>rollbackDlg('svc',c.id,'Обслуживается')})}
      if(can('cpArchive'))it.push({label:'В архив',icon:'archive',danger:true,run:()=>archiveDlg([c])})}
  }else if(can('cpArchive'))it.push({label:'Вернуть из архива',icon:'refresh',run:()=>unarchiveCp(c)});
  if(c._del){it.push({sep:true},c._del);delete c._del}
  return it}
function unarchiveCp(c){{c.archived=false;const l=lastPeriod(c);if(c.kind!=='oneoff'){if(l&&l.to&&l.to>=ym(TODAY))l.to=null;else c.periods.push({from:ym(TODAY),to:null})}const r=c.kind==='oneoff'?{on:0}:applyService(c);const nw=REPORTS.filter(x=>x.cp===c.id&&OPEN.has(x.status)&&!x.superseded).length;log('cp',c.id,'Возвращён из архива',c.id);refreshAll();toast(c.kind==='oneoff'?'Контрагент возвращён из архива':`Контрагент возвращён из архива, открытых отчётов: ${nw}`)}}
function renderCps(body,tab,fresh){
  const all=visCps(true).filter(c=>!c.archived);
  const noResp=all.filter(c=>!c.resp).length,withOver=all.filter(c=>c.overdue>0).length,deb=all.filter(c=>c.feeDebt>0);
  const gid='cps-'+tab;
  const kM=kMissOk()?kMissCnt():null,nKpi=kM?all.filter(c=>kM.by[c.id]).length:0;
  const vAll=visCps(true),nPau=all.filter(c=>c.paused).length,nOne=all.filter(c=>c.kind==='oneoff').length,nArc=vAll.filter(c=>c.archived).length,nNoGk=all.filter(c=>!c.gked).length,nSfq=all.filter(c=>{const x=sfState(c);return x&&x.ask}).length;
  body.innerHTML=(tab==='archive'?'':`<div class="plates">
    ${plate({id:'all',icon:'building',color:'blue',label:'На обслуживании',value:all.length,sub:seeAll('cps')?'вся организация':'закреплены за вами'})}
    ${plate({id:'noresp',icon:'alert',color:noResp?'orange':'green',label:'Без ответственного',value:noResp,sub:noResp?'владелец получил уведомление':'все закреплены'})}
    ${plate({id:'over',icon:'clock',color:withOver?'red':'green',label:'С просроченными отчётами',value:withOver})}
    ${feat('fee')&&can('fee')?plate({id:'deb',icon:'coins',color:deb.length?'red':'green',label:'Должники',value:deb.length,sub:deb.length?som(deb.reduce((a,c)=>a+c.feeDebt,0)):'долгов нет',on:tab==='debtors'}):''}
    ${plate({id:'nogk',icon:'alert',color:nNoGk?'yellow':'green',label:'Без ГКЭД',value:nNoGk,sub:nNoGk?'укажите вид деятельности':'у всех указан',on:!!(GS[gid]&&GS[gid].filters&&GS[gid].filters.gkno)})}
    ${plate({id:'sfq',icon:'shield',color:nSfq?'yellow':'green',label:'Тариф под вопросом',value:nSfq,sub:nSfq?'Соцфонд: не определён или выбран вопреки условиям':'у всех определён',on:!!(GS[gid]&&GS[gid].filters&&GS[gid].filters.sfq)})}
    ${kM?plate({id:'kpin',icon:'gauge',color:nKpi?(all.some(c=>kM.by[c.id]&&kM.by[c.id].over)?'red':'yellow'):'green',label:'Не заполнены показатели',value:nKpi,sub:nKpi?'за текущий и прошлые месяцы':'всё внесено',on:!!(GS[gid]&&GS[gid].filters&&GS[gid].filters.kpin)}):''}
    ${plate({id:'pau',icon:'pause',color:'yellow',label:'Приостановлены',value:nPau,on:!!(GS[gid]&&GS[gid].filters&&GS[gid].filters.svc&&GS[gid].filters.svc.vals.includes('Приостановлен'))})}
    ${plate({id:'one',icon:'briefcase',color:'purple',label:'Разовые',value:nOne,on:!!(GS[gid]&&GS[gid].filters&&GS[gid].filters.kind)})}
    ${plate({id:'arc',icon:'archive',color:'gray',label:'В архиве',value:nArc,sub:'показать в списке',on:!!(GS[gid]&&GS[gid].filters&&GS[gid].filters.svc&&GS[gid].filters.svc.vals.includes('В архиве'))})}
  </div>`)+`<div id="cg"></div>`;
  const pl=body.querySelector('.plates');if(pl)pl.onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;const id=b.dataset.plate;const g=GS[gid];
    if(id==='deb'){go('cps','debtors');return}
    if(!g)return;g.filters={};if(id==='noresp')g.filters.resp={type:'enum',vals:['']};if(id==='nogk')g.filters.gkno={type:'enum',vals:['Нет']};if(id==='sfq')g.filters.sfq={type:'enum',vals:['Да']};if(id==='kpin')g.filters.kpin={type:'enum',vals:['Да']};if(id==='pau')g.filters.svc={type:'enum',vals:['Приостановлен']};if(id==='one')g.filters.kind={type:'enum',vals:['Разовое']};if(id==='arc')g.filters.svc={type:'enum',vals:['В архиве']};if(id==='over')g.filters.over={type:'num',from:1,to:null};g.page=0;renderPage()};
  const rows=()=>{const v=visCps(true);const g=GS[gid];const fs=g&&g.filters&&g.filters.svc;if(fs&&fs.vals&&fs.vals.includes('В архиве'))return v;const a=v.filter(c=>!c.archived);if(tab==='mine')return a.filter(c=>c.resp===S.me);if(tab==='debtors')return a.filter(c=>c.feeDebt>0);if(tab==='paused')return a.filter(c=>c.paused);if(tab==='oneoff')return a.filter(c=>c.kind==='oneoff');return a};
  grid($('#cg',body),{id:gid,cols:cpCols(),rows,title:'name',noun:['контрагент','контрагента','контрагентов'],rowClass:c=>!c.resp&&!c.archived?'warn':c.archived||c.paused?'muted':'',
    actions:cpActions,open:openCp,sort:{key:'name',dir:1},preset:S.preset,simulateLoad:fresh,
    bulk:tab==='archive'||!(can('assign')||can('createCp')||can('cpArchive')||(feat('cppage')&&can('cpPage')))?null:[...(can('assign')||can('createCp')?[{label:'Назначить ответственного',icon:'user',run:(rs,done)=>respDlg(rs,done)}]:[]),...(feat('cppage')&&can('cpPage')?[{label:'Включить страницу',icon:'link',run:(rs,done)=>pgEnable(rs,done)}]:[]),...(can('cpArchive')?[{label:'В архив',icon:'archive',danger:true,run:(rs,done)=>archiveDlg(rs,done)}]:[])],
    empty:{icon:'building',title:tab==='mine'?'За вами пока не закреплены контрагенты':tab==='archive'?'Архив пуст':'Контрагентов пока нет',text:tab==='all'?'Добавьте первого контрагента или загрузите список из Excel.':'',add:tab==='all'&&can('createCp')?addCpDlg:null}});
}
function respDlg(cs,done){
  openModal({form:true,render:()=>({title:cs.length>1?`Ответственный для ${cs.length} контрагентов`:'Сменить ответственного',sub:cs.length>1?'':esc(cs[0].name),
    body:`${fld('Ответственный бухгалтер',sel('rs-e',EMP.filter(e=>e.active).map(e=>[e.id,`${e.short} · ${ROLES.find(r=>r.id===e.role).name}`]),cs.length===1?cs[0].resp:''),{req:true,id:'rs-e'})}<div class="note">${ic('info')}<span>Новый ответственный получит все незавершённые отчёты (ещё не сданы или налог не оплачен) и открытые задачи этих контрагентов, а также остаток денег на их налоги. Завершённые отчёты остаются за тем, кто их сдал.</span></div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="rs-ok">Назначить</button>',
    mount(el,m){$('#rs-ok',el).onclick=()=>{const to=val(el,'rs-e');cs.forEach(c=>transferCp(c,to));m.close();done&&done();refreshAll();toast(cs.length>1?`Ответственный назначен: ${cs.length} контрагентов`:'Ответственный изменён','user')}}})});
}
// Незавершённый отчёт — ещё не «Сдан» или налог по нему не оплачен: при передаче контрагента переходит к новому ответственному
const repUnfinished=r=>!r.superseded&&r.status!=='Не требуется'&&(r.status!=='Сдан'||(feat('taxpay')&&!!tR(r).sum&&r.sum>0&&r.paid<r.sum));
function transferCp(c,to){const from=c.resp;if(from===to)return;c.resp=to;
  REPORTS.filter(r=>r.cp===c.id&&repUnfinished(r)&&(r.resp===from||!r.resp)).forEach(r=>r.resp=to);
  TASKS.filter(t=>t.cp===c.id&&t.exec===from&&taskOpen(t)).forEach(t=>t.exec=to);
  if(c.paysTo==='emp')OPS.filter(o=>o.cp===c.id&&!o.self).forEach(o=>o.holder=to);
  log('cp',c.id,`Ответственный: ${empName(from)||'—'} → ${empName(to)}`,c.id)}
function archiveDlg(cs,done){
  confirmDlg({title:cs.length>1?`Отправить в архив ${cs.length} контрагентов?`:`Отправить в архив ${esc(cs[0].name)}?`,text:'Удалить контрагента с отчётами нельзя, его можно только архивировать. Отчёты за периоды после текущего месяца получат статус «Не требуется»; отчёты за уже обслуженные периоды остаются к сдаче, сданные — без изменений.',ok:'В архив',danger:true,run:()=>{
    cs.forEach(c=>{c.archived=true;{const l=lastPeriod(c);if(l&&(!l.to||l.to>ym(TODAY)))l.to=ym(TODAY)}REPORTS.filter(r=>r.cp===c.id&&OPEN.has(r.status)&&r.due>=TODAY&&!inService(c,ym(r.pkey))).forEach(r=>{r.status='Не требуется'});log('cp',c.id,'Отправлен в архив',c.id);pgOff(c,'контрагент в архиве')});done&&done();refreshAll();
    const rest=cs.filter(c=>feat('taxpay')&&c.free>0);
    if(!rest.length){toast('Отправлено в архив','archive');return}
    if(can('archiveRest'))restDlg(rest);else toast(`Отправлено в архив. Остаток денег (${som(rest.reduce((a,c)=>a+c.free,0))}) решает владелец`,'archive')}});
}
/* Остаток при архивировании: вернуть контрагенту или списать в бонус. Решает владелец или роль с правом */
function restDlg(cs){
  openModal({live:true,render:m=>{const left=cs.filter(c=>c.free>0);
    return {title:'Остаток денег у архивных контрагентов',sub:'Решите, что сделать с остатком: вернуть контрагенту или списать в бонус сотрудника',
    body:left.length?`<div class="tbl-wrap"><table class="mini"><thead><tr><th>Контрагент</th><th>Где деньги</th><th class="num">Остаток</th><th></th></tr></thead><tbody>${left.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.paysTo==='org'?'счёт организации':esc(empName(c.resp))}</td><td class="num strong">${fmtM(c.free)}</td><td class="num" style="white-space:nowrap"><button class="btn sm" data-rf="${c.id}">${ic('refresh','sm')}Вернуть</button>${c.paysTo==='emp'&&feat('accounts')?` <button class="btn sm" data-bn="${c.id}">${ic('gift','sm')}В бонус</button>`:''}</td></tr>`).join('')}</tbody></table></div><div class="hint">Можно решить позже: кнопки есть во вкладке «Деньги» карточки архивного контрагента.</div>`:`<div class="note">${ic('ok')}<span>Остатков больше нет.</span></div>`,
    foot:`<div class="grow"></div><button class="btn cta" data-close>${left.length?'Решить позже':'Готово'}</button>`,
    mount(el){$$('[data-rf]',el).forEach(b=>b.onclick=()=>moneyOpDlg(CPM[+b.dataset.rf],'refund'));$$('[data-bn]',el).forEach(b=>b.onclick=()=>moneyOpDlg(CPM[+b.dataset.bn],'bonus'))}}}});
}
function assignTypes(c,ids,from,rates,fixed,quiet,cfgs){ids.forEach(id=>{let a=c.assign.find(a=>a.t===id&&!a.to);if(!a){a={t:id,from:from||TODAY,to:null,resp:null};if(isEnT(id)){const en=enClean(rates&&Array.isArray(rates[id])?rates[id]:null);a.en=en.length?en:enAuto(c)}else a.rate=(rates&&rates[id])||(T[id].rates&&T[id].rates.length?T[id].rates[Math.min(1,T[id].rates.length-1)]:null);
    {const ad=((rates&&rates['add:'+id])||[]).filter(k=>(T[id].rateAdd||[]).some(x=>x.k===k));if(ad.length)a.add=ad}c.assign.push(a)}if(fixed&&fixed[id]!=null)a.fixed=fixed[id];if(cfgs&&cfgs[id])Object.assign(a,cfgs[id]);const t=tEff(T[id],a,c);
  // Разовый вид — отчёты только через «Разовый отчёт»; у отключённого вида новые отчёты не создаются
  if(t.oneOff||t.active===false){if(!quiet)log('cp',c.id,`Назначен отчёт: ${t.name}${t.oneOff?' (разовый: создаётся через «Разовый отчёт»)':''}`,c.id);return}
  periodList(t).filter(p=>pend(t,p)>=TODAY.slice(0,8)+'01'||t.per!=='M').filter(p=>!a.until||ym(pstart(t,p))<=a.until).forEach(p=>{if(t.per==='M'&&pstart(t,p)<TODAY.slice(0,8)+'01')return;{const ex=REPORTS.find(r=>r.cp===c.id&&r.t===id&&r.pkey===pstart(t,p)&&!r.superseded);if(ex){if(ex.status==='Не требуется'&&!ex.subDate&&ex.due>=TODAY&&!c.archived&&inService(c,ym(ex.pkey))){ex.status='К сдаче';delete ex._paused;log('r',ex.id,'Статус: Не требуется → К сдаче (назначение восстановлено)',c.id)}return}}
    if(t.per!=='M'&&dueOf(t,p).due<TODAY)return;REPORTS.push(makeReport(c,t,p,a.resp||c.resp))});
  if(!quiet)log('cp',c.id,`Назначен отчёт: ${t.name}${perOwn(t)?', '+PER_LABEL[t.per].toLowerCase()+', '+ruleText(t):''}`,c.id)})}
function perOfYm(t,k){const[y,mo]=k.split('-').map(Number);return t.per==='M'?{y,m:mo}:t.per==='Q'?{y,q:Math.ceil(mo/3)}:t.per==='H'?{y,h:Math.ceil(mo/6)}:{y}}
/* Срок по статусу (ТЗ «Налоговые льготы и особые статусы» → «Меняет сроки»): при установке или снятии статуса несданные отчёты пересчитываются,
   сроки, изменённые вручную, и разовые отчёты не трогаются. cpRedueList — что изменится при статусах ben и датах dates (для подсказки до сохранения) */
function cpRedueList(c,ben,dates){const f=Object.assign({},c,{ben:ben||c.ben||[],benDates:dates!==undefined?dates:c.benDates});
  return REPORTS.filter(r=>r.cp===c.id&&OPEN.has(r.status)&&!r.superseded&&!r.dueManual&&!r.ev&&T[r.t]).map(r=>{const t=tEff(T[r.t],assignOfT(c,r.t),f);const d=dueOf(t,r.p);return d.due!==r.due||d.base!==r.dueBase?{r,d,ben:t.ovBen||null}:null}).filter(Boolean)}
const redueNote=l=>l.length?`Сроки по статусу изменятся у ${l.length} ${plural(l.length,'несданного отчёта','несданных отчётов','несданных отчётов')}: ${l.slice(0,4).map(x=>`${esc(T[x.r.t].short)} ${esc(x.r.plabel)} — ${fmtD(x.r.due)} → ${fmtD(x.d.due)}`).join('; ')}${l.length>4?'; …':''}`:'';
// Какие несданные отчёты сейчас получают срок по статусу: {id отчёта: название статуса} — снимок до изменения статусов
const cpOvMap=c=>Object.fromEntries(REPORTS.filter(r=>r.cp===c.id&&OPEN.has(r.status)&&T[r.t]).map(r=>[r.id,(tFor(r)||{}).ovBen]).filter(x=>x[1]));
// «Ставится по УГНС»: статусы, которые отмечаются сами при этом УГНС (cx — контрагент или черновик формы); сами не снимаются
function ugAuto(cx,ug){const add=ugBens(ug).filter(b=>!(cx.ben||[]).includes(b.name)).map(b=>b.name);if(add.length)cx.ben=[...(cx.ben||[]),...add];return add}
// Смена УГНС: снять статусы, которые ставит прежнее УГНС, а новое — нет (поставленные вручную при другом УГНС не трогаются)
function ugDrop(cx,old,ug){const keep=new Set(ugBens(ug).map(b=>b.name));const drop=ugBens(old).map(b=>b.name).filter(n=>(cx.ben||[]).includes(n)&&!keep.has(n));
  if(drop.length){cx.ben=cx.ben.filter(n=>!drop.includes(n));const bd=cx.benD||cx.benDates;if(bd)drop.forEach(n=>delete bd[n])}return drop}
const ugMsg=(add,drop)=>[...add.map(n=>`Отмечен статус «${n}» по УГНС`),...(drop||[]).map(n=>`Снят статус «${n}» по УГНС`)].join('; ');
// У сохранённого контрагента: отметить или снять статусы по УГНС, записать в историю, пересчитать сроки
function ugApply(c,old){const was=cpOvMap(c);const add=ugAuto(c,c.ugns),drop=ugDrop(c,old,c.ugns);if(!add.length&&!drop.length)return {add,drop,n:0};
  add.forEach(n=>log('cp',c.id,`Отмечен статус «${n}» по УГНС`,c.id));drop.forEach(n=>log('cp',c.id,`Снят статус «${n}» по УГНС`,c.id));touch(c);return {add,drop,n:cpRedue(c,was)}}
function cpRedue(c,was){const l=cpRedueList(c);l.forEach(({r,d,ben})=>{r.dueBase=d.base;r.due=d.due;const wb=was&&was[r.id];log('r',r.id,ben?`Срок по статусу «${ben}»: ${fmtD(d.due)}`:`Срок по каталогу${wb?` (снят статус «${wb}»)`:''}: ${fmtD(d.due)}`,c.id)});return l.length}
function periodsFrom(t,fromYm){const out=[],seen=new Set();for(let k=fromYm;k<=ym(TODAY);k=addMonths(k,1)){const p=perOfYm(t,k);const ps=pstart(t,p);if(seen.has(ps))continue;seen.add(ps);if(pend(t,p)<TODAY)out.push(p)}return out}
function asgDlg(c,a){const t=T[a.t];const st={from:(a.from||TODAY).slice(0,7),until:a.until||'',resp:a.resp||'',dd:a.dueDay||'',note:a.note||'',mark:true};
  const missing=()=>periodsFrom(tEff(t,a,c),st.from).filter(p=>!REPORTS.some(r=>r.cp===c.id&&r.t===t.id&&r.pkey===pstart(tEff(t,a,c),p)));const noPer=t.kind==='internal'||t.oneOff||t.active===false;
  openModal({form:true,size:'mid',render:m=>{const miss=noPer?[]:missing();return {title:'Назначение: '+esc(t.short),sub:`${esc(c.name)} · ${esc(t.name)}`,body:`<div class="form">
    ${fld('С какого периода',inp('ag-from',st.from,'type="month"'),{req:true,id:'ag-from'})}${fld('До какого периода',inp('ag-until',st.until,'type="month"'),{id:'ag-until',hint:'Пусто — бессрочно'})}
    ${fld('Ответственный',sel('ag-resp',[['','Ответственный контрагента: '+empName(c.resp)],...EMP.filter(e=>e.active).map(e=>[e.id,e.fio])],st.resp),{id:'ag-resp',hint:'Например, Соцфонд ведёт кадровик; деньги остаются на счёте ответственного контрагента'})}
    ${t.kind!=='internal'&&t.per!=='Y'&&!t.oneOff?fld('Вариант срока',sel('ag-dd',[['',(dueBen(t,c)?`По статусу «${dueBen(t,c).name}»: `+ruleText(tOv(t,c)):'Как в каталоге: '+ruleText(t))],...[10,15,20,25].filter(d=>d!==t.day).map(d=>[String(d),'до '+d+'-го числа']),['31','до последнего дня месяца']],String(st.dd)),{id:'ag-dd',full:true,hint:'Если у контрагента срок отличается от каталога, например НДС до 25-го или до последнего дня месяца'}):''}
    ${fld('Примечание',inp('ag-note',st.note),{id:'ag-note',full:true})}</div>
    ${miss.length?`<div class="note warn">${ic('history')}<span>Назначение начинается в прошлом: нет отчётов за ${miss.length} ${plural(miss.length,'прошлый период','прошлых периода','прошлых периодов')} (${miss.map(p=>plabel(tEff(t,a),p)).join(', ')}). Они будут созданы.</span></div><label class="check-row"><input type="checkbox" class="sw" id="ag-mark" ${st.mark?'checked':''}><span class="grow">Сразу отметить прошлые периоды сданными${repConfOn()?' и подтверждёнными':''}</span></label>`:''}`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ag-ok">Сохранить</button>',
    mount(el){const snap=()=>{st.from=val(el,'ag-from')||st.from;st.until=val(el,'ag-until');st.resp=val(el,'ag-resp');st.dd=$('#ag-dd',el)?val(el,'ag-dd'):'';st.note=val(el,'ag-note');if($('#ag-mark',el))st.mark=$('#ag-mark',el).checked};
      $('#ag-from',el).onchange=()=>{snap();m.draw()};
      $('#ag-ok',el).onclick=()=>{snap();if(!setErr(el,'ag-until',st.until&&st.until<st.from?'Период окончания раньше начала':''))return;const ch=[];const miss=noPer?[]:missing();
        if(st.from!==(a.from||TODAY).slice(0,7))ch.push('с '+ymG(st.from));if((st.until||'')!==(a.until||''))ch.push(st.until?'по '+ymLabel(st.until):'бессрочно');
        if((st.resp||'')!==(a.resp||''))ch.push('ответственный: '+empName(st.resp||c.resp));if(String(st.dd||'')!==String(a.dueDay||''))ch.push('срок: '+(st.dd?(+st.dd>=31?'до последнего дня':'до '+st.dd+'-го'):'как в каталоге'));if((st.note||'')!==(a.note||''))ch.push('примечание');
        a.from=st.from+'-01';a.until=st.until||null;a.resp=st.resp||null;a.dueDay=st.dd?+st.dd:null;a.note=st.note;touch(c);const te=tEff(t,a,c);
        REPORTS.filter(r=>r.cp===c.id&&r.t===t.id&&OPEN.has(r.status)).forEach(r=>{r.resp=a.resp||c.resp;if(!r.dueManual&&!r.ev){const d=dueOf(te,r.p);r.dueBase=d.base;r.due=d.due}});
        if(a.until)REPORTS.filter(r=>r.cp===c.id&&r.t===t.id&&OPEN.has(r.status)&&ym(r.pkey)>a.until).forEach(r=>{r.status='Не требуется';log('r',r.id,`Статус: ${'К сдаче'} → Не требуется (назначение до ${ymLabel(a.until)})`,c.id)});
        miss.forEach(p=>{const r=born(makeReport(c,te,p,a.resp||c.resp));if(st.mark){Object.assign(r,{status:'Сдан',subDate:r.dueBase,subAt:nowStamp(),subBy:S.me,confAt:nowStamp(),confBy:S.me,confNote:'Прошлый период отмечен при назначении'});r.sum=r.sum??0;r.paid=r.sum||0}REPORTS.push(r);log('r',r.id,st.mark?`Создан за прошлый период и отмечен сданным${repConfOn()?' и подтверждённым':''} при назначении`:'Создан за прошлый период при назначении',c.id)});
        if(miss.length)ch.push(`отчётов за прошлые периоды: ${miss.length}${st.mark?' (отмечены сданными)':''}`);
        if(ch.length)log('cp',c.id,`${t.short}: назначение изменено — ${ch.join(', ')}`,c.id);m.close();derive();refreshAll();toast(ch.length?'Назначение сохранено':'Без изменений')}}}}})}
function dueEditDlg(r){const t=tR(r);const rs=DICT.reasons.items.filter(x=>x.active).map(x=>x.name);
  openModal({form:true,render:()=>({title:'Изменить срок сдачи',sub:`${esc(CPM[r.cp].name)} · ${esc(t.short)} ${esc(r.plabel)}`,body:`<div class="form">${fld('Новый срок',inp('de-d',r.due,'type="date"'),{req:true,id:'de-d',hint:'Сейчас: '+fmtD(r.due)+(r.dueBase!==r.due?' · по закону '+fmtD(r.dueBase):'')})}${fld('Причина',sel('de-r',rs,rs[0]),{req:true,id:'de-r',hint:'Из справочника платформы «Причины изменения срока отчёта»'})}${fld('Комментарий',inp('de-c',''),{id:'de-c',full:true})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="de-ok">Сохранить</button>',
    mount(el,m){$('#de-ok',el).onclick=()=>{const d=val(el,'de-d');if(!setErr(el,'de-d',d?'':'Укажите дату'))return;if(d===r.due){m.close();return}const why=val(el,'de-r'),cm=val(el,'de-c');log('r',r.id,`Срок сдачи: ${fmtD(r.due)} → ${fmtD(d)} (${why}${cm?', '+cm:''})`,r.cp);r.due=d;r.dueManual=true;touch(r);m.close();derive();refreshAll();toast('Срок сдачи изменён')}}})})}
function unassignDlg(c,ids,done){
  const names=ids.map(id=>T[id].short).join(', ');const fut=REPORTS.filter(r=>r.cp===c.id&&ids.includes(r.t)&&OPEN.has(r.status)&&r.due>=TODAY).length;
  confirmDlg({title:`Снять назначение: ${esc(names)}?`,text:`${esc(c.name)} больше не сдаёт ${esc(names)} с сегодняшнего дня. Будущих несданных отчётов: ${fut}, они получат статус «Не требуется». Сданные отчёты останутся.`,ok:'Снять',danger:true,run:()=>{
    ids.forEach(id=>{const a=c.assign.find(a=>a.t===id&&!a.to);if(a)a.to=TODAY;REPORTS.filter(r=>r.cp===c.id&&r.t===id&&OPEN.has(r.status)&&r.due>=TODAY).forEach(r=>r.status='Не требуется');log('cp',c.id,`Снято назначение: ${T[id].name}`,c.id)});done&&done();refreshAll();toast('Назначение снято')}});
}
function typeChips(id,c,selected){
  return `<div class="chipsel" id="${id}">${RT.filter(t=>ORG.types[t.id]&&ORG.types[t.id].on&&(t.active!==false||selected.has(t.id))).map(t=>{const why=compatible(t,c);const fit=!why&&gkFitType(t,c);return `<button type="button" data-t="${t.id}" class="${selected.has(t.id)?'on':''} ${fit?'gkfit':''}" ${why&&!selected.has(t.id)?'disabled':''} title="${esc(why||(fit?'Подходит по ГКЭД · ':'')+t.name+' · '+t.organ+' · '+ruleText(t))}">${selected.has(t.id)?ic('check','sm'):''}${esc(t.short)}${fit?'<i class="gk-dot" aria-label="Подходит по ГКЭД"></i>':''}</button>`}).join('')}</div>`}
function assignDlg(c){
  const st={sel:new Set(c.assign.filter(a=>!a.to).map(a=>a.t)),rates:{},fixed:{},cfg:{}};const before=new Set(st.sel);c.assign.filter(a=>!a.to).forEach(a=>{if(isEnT(a.t))st.rates[a.t]=(a.en||[]).map(e=>Object.assign({},e));else if(a.rate)st.rates[a.t]=a.rate;if((a.add||[]).length)st.rates['add:'+a.t]=[...a.add];if(a.fixed!=null)st.fixed[a.t]=a.fixed;if(perOwn(T[a.t])){const e=tEff(T[a.t],a);st.cfg[a.t]={per:e.per,day:e.day,mo:e.per==='Y'?e.ym:e.after}}});
  const cfgOf=id=>st.cfg[id]||(st.cfg[id]={per:T[id].per,day:T[id].day,mo:T[id].per==='Y'?T[id].ym:T[id].after});const before0=JSON.stringify(st.cfg);
  openModal({form:true,size:'mid',render:m=>({title:'Ставки и сроки отчётов',sub:`${esc(c.name)} · ${esc(c.regime||'режим не указан')} · ${esc(c.form)}`,
    body:`<div class="hint">Какие отчёты сдаёт контрагент, меняется кнопкой «Изменить» в блоке «Сдаёт отчёты»: там подбор с описанием каждого отчёта.</div>
    ${st.sel.size?`<div class="box flat"><h3>Ставки и повторяющиеся суммы</h3>${rateRows(st.sel,st.rates,st.fixed,c)||'<span class="faint">Нет видов со ставкой</span>'}<span class="hint">Повторяющаяся сумма сама подставится в каждый новый отчёт этого вида, например фиксированный патент или Соцфонд. Пусто — сумму вносят при сдаче.</span></div>`:''}
    ${[...st.sel].some(id=>perOwn(T[id]))?`<div class="box flat"><h3>Периодичность и срок в назначении</h3><span class="hint" style="margin-top:-4px">Внутренняя финансовая отчётность — по требованию контрагента; патент — по сроку патента.</span>${intRows([...st.sel].filter(id=>perOwn(T[id])),cfgOf)}<span class="hint">У каждого контрагента свои периодичность и срок. В каталоге стоят только значения по умолчанию: раз в год, до 1 апреля. При смене периодичности несданные будущие отчёты пересоздаются.</span></div>`:''}
    `,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="as-ok">Сохранить</button>',
    mount(el){bindRates(el,st.rates,st.fixed,{cx:c,redraw:()=>m.draw()});bindInt(el,cfgOf,m);
      $('#as-ok',el).onclick=()=>{const add=[...st.sel].filter(x=>!before.has(x)),rem=[...before].filter(x=>!st.sel.has(x));if(!st.sel.size){toast('Нужен хотя бы один вид отчёта','alert',true);return}
        c.assign.filter(a=>!a.to&&st.sel.has(a.t)).forEach(a=>{const t=T[a.t];const k0=JSON.stringify([a.rate??null,a.en||null,a.add||null]),f0=a.fixed,f1=st.fixed[a.t]??null;
          if(isEnT(t)){const en=enClean(st.rates[a.t]);if(en.length)a.en=en}else{a.rate=st.rates[a.t]||a.rate;const ad=(st.rates['add:'+a.t]||[]).filter(k=>(t.rateAdd||[]).some(x=>x.k===k));if(ad.length)a.add=ad;else delete a.add}
          if(JSON.stringify([a.rate??null,a.en||null,a.add||null])!==k0||f1!==(f0??null)){a.fixed=f1;
          if(f1!=null)REPORTS.filter(r=>r.cp===c.id&&r.t===a.t&&OPEN.has(r.status)&&(r.sum==null||r.auto)).forEach(r=>{r.sum=f1;r.auto=true;delete r.lines});
          log('cp',c.id,`${t.short}: ставка ${aRateTxt(a,t)||'—'}, повторяющаяся сумма ${f1!=null?som(f1):'нет'}`,c.id)}});
        c.assign.filter(a=>!a.to&&st.sel.has(a.t)&&perOwn(T[a.t])&&!add.includes(a.t)).forEach(a=>{const n=cfgOf(a.t);const o=tEff(T[a.t],a);if(n.per===o.per&&n.day===o.day&&n.mo===(o.per==='Y'?o.ym:o.after))return;
          for(let i=REPORTS.length-1;i>=0;i--){const r=REPORTS[i];if(r.cp===c.id&&r.t===a.t&&['К сдаче','В работе'].includes(r.status)&&r.due>=TODAY&&!r.ver)REPORTS.splice(i,1)}
          Object.assign(a,n);assignTypes(c,[a.t],null,null,null,true);log('cp',c.id,`${T[a.t].short}: ${PER_LABEL[n.per].toLowerCase()}, ${ruleText(tEff(T[a.t],a))}`,c.id)});
        if(add.length)assignTypes(c,add,null,st.rates,st.fixed,false,Object.fromEntries(add.filter(id=>perOwn(T[id])).map(id=>[id,cfgOf(id)])));m.close();if(rem.length)unassignDlg(c,rem);else{refreshAll();toast(add.length?`Назначено: ${add.map(x=>T[x].short).join(', ')}`:'Без изменений')}}}})});
}
function massAssignDlg(){
  const st={t:(RT.find(x=>x.id==='nds'&&x.active!==false&&ORG.types.nds&&ORG.types.nds.on)||RT.find(x=>x.active!==false&&ORG.types[x.id]&&ORG.types[x.id].on)||{}).id,sel:new Set(),rate:null};
  openModal({form:true,size:'mid',render:m=>{const t=T[st.t];const cps=visCps();
    if(!t)return {title:'Назначить отчёт нескольким контрагентам',body:`<div class="note">${ic('info')}<span>В организации не включён ни один вид отчёта. Включите нужные виды в «Справочники → Виды отчётов».</span></div>`,foot:`<div class="grow"></div><button class="btn" data-close>Закрыть</button>`};
    return {title:'Назначить отчёт нескольким контрагентам',sub:'Выберите вид отчёта и отметьте компании',body:`${fld('Вид отчёта',sel('ma-t',RT.filter(x=>ORG.types[x.id]&&ORG.types[x.id].on&&x.active!==false).map(x=>[x.id,`${x.name} · ${x.organ}`]),st.t),{id:'ma-t'})}
    ${isEnT(t)?`<div class="note">${ic('info')}<span>Ставка единого налога подставится каждому контрагенту по его основному и дополнительным ГКЭД и статусам — строками справочника «Ставки единого налога», например «ЕНС-04 · 4 % безнал + 6 % нал». Изменить её можно в карточке контрагента, кнопка «Ставки».</span></div>`:t.rates&&t.rates.length>1?fld('Ставка для отмеченных',sel('ma-rate',t.rates,st.rate||t.rates[1]),{id:'ma-rate',hint:'Ставку отдельного контрагента потом можно изменить в его карточке'}):''}
    <div class="row"><span class="muted">Срок: ${esc(ruleText(t))}${t.rates&&t.rates.length===1?' · ставка '+esc(t.rates[0]):''}</span><div class="grow"></div><button class="linkbtn" id="ma-all">Отметить все подходящие</button></div>
    <div class="fl-list" style="max-height:340px">${cps.map(c=>{const has=c.assign.some(a=>a.t===t.id&&!a.to);const why=compatible(t,c);return `<label title="${esc(why)}" style="${why?'opacity:.5':''}"><input type="checkbox" data-c="${c.id}" ${has||st.sel.has(c.id)?'checked':''} ${has||why?'disabled':''}> ${esc(c.name)}<span class="n">${has?'уже сдаёт':why?esc(why):esc(c.regime||'')+(isEnT(t)?' · '+esc(aRateTxt({t:t.id,en:enAuto(c)},t,true)):'')}</span>${!has&&!why&&gkFitType(t,c)?'<span class="pill green sm">Подходит по ГКЭД</span>':''}</label>`}).join('')}</div>`,
    foot:`<span class="muted">Выбрано: ${st.sel.size}</span><div class="grow"></div><button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ma-ok" ${st.sel.size?'':'disabled'}>Назначить</button>`,
    mount(el){if(!$('#ma-t',el))return;$('#ma-t',el).onchange=e=>{st.t=e.target.value;st.sel.clear();st.rate=null;m.draw()};if($('#ma-rate',el))$('#ma-rate',el).onchange=e=>st.rate=e.target.value;
      el.querySelector('.fl-list').onchange=e=>{const x=e.target;x.checked?st.sel.add(+x.dataset.c):st.sel.delete(+x.dataset.c);m.draw()};
      $('#ma-all',el).onclick=()=>{cps.forEach(c=>{if(!c.assign.some(a=>a.t===t.id&&!a.to)&&!compatible(t,c))st.sel.add(c.id)});m.draw()};
      $('#ma-ok',el).onclick=()=>{const rt=$('#ma-rate',el)?{[st.t]:val(el,'ma-rate')}:null;[...st.sel].forEach(id=>assignTypes(CPM[id],[st.t],null,rt));m.close();refreshAll();toast(`${t.short} назначен: ${st.sel.size} ${plural(st.sel.size,'контрагенту','контрагентам','контрагентам')}`)}}}}});
}
function allocText(o){const p=(o.alloc||[]).map(x=>{const r=REPORTS.find(y=>y.id===x.r);return r?`${T[r.t].short} ${r.plabel} — ${fmtM(x.a,false)}`:''}).filter(Boolean);(o.feeAlloc||[]).forEach(x=>p.push(`обслуживание ${ymLabel(x.m)} — ${fmtM(x.a,false)}`));const adv=advOf(o);if(adv>0&&p.length)p.push(`аванс — ${fmtM(adv,false)}`);return p.join('; ')}
const advOf=o=>Math.max(0,o.amount-(o.alloc||[]).reduce((a,x)=>a+x.a,0));
/* Поступление от контрагента: одна общая сумма + детализация по отчётам (и, если нужно, за обслуживание) */
function inDlg(c0,edit,pre){
  const st={cp:c0?c0.id:(visCps().find(c=>c.kind!=='oneoff')||{}).id,total:edit?(edit.total??edit.amount):'',date:edit?edit.date:TODAY,alloc:{},fee:{},acc:edit?edit.holder:null,why:''};
  if(pre&&c0){st.alloc[pre.r]=pre.amt;st.total=pre.amt;st.pre=c0.id}
  const prevFee={},own={};if(edit){(edit.alloc||[]).forEach(x=>{st.alloc[x.r]=x.a;own[x.r]=x.a});(edit.feeAlloc||[]).forEach(x=>{st.fee[x.m]=x.a;prevFee[x.m]=x.a})}
  const fv=v=>v==null||v===''?'':String(v);
  // Уже получено под отчёт без этого поступления: при изменении его собственная часть (и оплата из неё) не считается чужой
  const already=r=>Math.max(0,r.paid-(own[r.id]||0),(r.recv||0)-(own[r.id]||0));
  openModal({form:true,size:'wide',render:m=>{
    const c=CPM[st.cp];
    const reps=c?REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&tR(r).sum&&r.sum>0&&r.status!=='Не требуется'&&(r.sum-already(r)>0||st.alloc[r.id]!=null)).sort((a,b)=>a.payDue<b.payDue?-1:1):[];
    const feeOk=c&&feat('fee')&&c.kind!=='oneoff'&&can('fee')&&c.paysTo==='org';
    const fGot=mm=>feeGot(c,mm)-(prevFee[mm]||0);const fLeft=mm=>feeCharge(c,mm)-fGot(mm);
    const fms=feeOk?feeMonths(c).filter(mm=>fLeft(mm)>0||st.fee[mm]!=null):[];
    const left=r=>Math.max(0,r.sum-already(r));
    const one=!edit&&c&&c.oneSum&&feeOk;
    if(one&&st.pre!==c.id){st.pre=c.id;st.alloc={};st.fee={};const eom=lastDay(ym(TODAY));let tot=0;
      reps.filter(r=>r.payDue<=eom).forEach(r=>{const x=left(r);if(x>0){st.alloc[r.id]=x;tot+=x}});
      fms.filter(mm=>mm<=ym(TODAY)).forEach(mm=>{const x=fLeft(mm);if(x>0){st.fee[mm]=x;tot+=x}});st.total=tot||''}
    const iStyle='style="max-width:130px;margin-left:auto;text-align:right"';
    return {title:edit?'Изменить поступление':'Поступление от контрагента',sub:c?`${esc(c.name)} · на ${c.paysTo==='org'?'счёт организации':'счёт '+esc(empName(c.resp))}${fms.length?' · плата за обслуживание — на счёт организации':''}`:'',
    body:`${edit?inEditNote(edit):''}${one?`<div class="note">${ic('coins')}<span><b>Платит одной суммой: налоги и обслуживание вместе.</b> Деление подставлено само: обслуживание за текущий месяц и налоги со сроком до конца месяца. Поправьте суммы, если контрагент перевёл иначе.</span></div>`:''}<div class="form">${c0||edit?'':fld('Контрагент',sel('in-cp',visCps().map(x=>[x.id,x.name]),st.cp),{req:true,full:true,id:'in-cp'})}
      ${fld('Общая сумма, сом',inp('in-sum',fv(st.total),'inputmode="decimal" class="inp tnum" placeholder="15 000"'),{req:true,id:'in-sum',hint:'Сколько всего перевёл контрагент'})}${fld('Дата',inp('in-date',st.date,`type="date" max="${TODAY}"`),{req:true,id:'in-date'})}</div>
    <div class="box flat"><h3>Детализация: за что эти деньги<span class="grow"></span><button class="btn sm" id="in-auto" type="button">${ic('list','sm')}Распределить по срокам</button></h3>
      ${reps.length||fms.length?`<div class="tbl-wrap"><table class="mini"><thead><tr><th>Отчёт</th><th>Период</th><th>Срок оплаты</th><th class="num">К уплате</th><th class="num" title="Уже получено от контрагента под этот отчёт (или уже оплачено)">Уже получено</th><th class="num" style="width:150px">Распределить сейчас</th><th class="num">Осталось</th></tr></thead><tbody>
      ${reps.map(r=>`<tr><td>${esc(T[r.t].short)}</td><td>${esc(r.plabel)}</td><td class="${r.payDue<TODAY?'red strong':''}">${fmtD(r.payDue)}</td><td class="num">${fmtM(r.sum)}</td><td class="num">${fmtM(already(r))}</td><td class="num"><input class="inp tnum" data-al="${r.id}" data-max="${left(r)}" value="${fv(st.alloc[r.id])}" inputmode="decimal" ${iStyle} aria-label="Распределить на ${esc(T[r.t].short)}"></td><td class="num strong" data-rest="al${r.id}" data-base="${left(r)}"></td></tr>`).join('')}
      ${fms.map(mm=>`<tr><td>${ic('coins','sm')} Обслуживание</td><td>${esc(ymLabel(mm))}</td><td>${fmtD(feeDue(c,mm))}</td><td class="num">${fmtM(feeCharge(c,mm))}</td><td class="num">${fmtM(fGot(mm))}</td><td class="num"><input class="inp tnum" data-fm="${mm}" data-max="${fLeft(mm)}" value="${fv(st.fee[mm])}" inputmode="decimal" ${iStyle} aria-label="Распределить на обслуживание"></td><td class="num strong" data-rest="fm${mm}" data-base="${fLeft(mm)}"></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3"><b>Итого</b></td><td class="num"><b>${fmtM(reps.reduce((s,r)=>s+r.sum,0)+fms.reduce((s,mm)=>s+feeCharge(c,mm),0))}</b></td><td class="num"><b>${fmtM(reps.reduce((s,r)=>s+already(r),0)+fms.reduce((s,mm)=>s+fGot(mm),0))}</b></td><td class="num"><b id="in-t-now"></b></td><td class="num"><b id="in-t-rest"></b></td></tr></tfoot></table></div>`:(()=>{const un=c?REPORTS.filter(r=>r.cp===c.id&&!r.superseded&&r.status!=='Не требуется'&&r.sum>r.paid).length:0;return `<span class="faint">${un?`Деньги на все неоплаченные налоги (${un} ${plural(un,'отчёт','отчёта','отчётов')}) уже получены — эта сумма станет авансом контрагента.`:'Неоплаченных налогов нет — вся сумма станет авансом контрагента.'}</span>`})()}
      <div id="in-sumline" class="row"></div>
      <span class="hint">Общая сумма должна быть не меньше суммы строк, излишек остаётся авансом контрагента.${fms.length?' Часть за обслуживание на виртуальный счёт не попадает.':''}</span></div>
    ${fld('Файлы: платёжка, чек, скрин перевода',`<input class="inp" type="file" id="in-f" multiple>`,{full:true,id:'in-f',req:!!(c&&c.needInFile),hint:c&&c.needInFile?'Для этого контрагента файл обязателен'+(edit&&(edit.files||[]).length?`: уже приложено ${edit.files.length}`:''):''})}
    ${edit?`<div class="form">${fld('Счёт',sel('in-acc',[['org','Счёт организации'],...EMP.filter(e=>(e.active&&e.role!=='owner')||e.id===edit.holder).map(e=>[e.id,'Счёт '+e.short+(e.id===c.resp?' — ответственный':'')])],st.acc),{id:'in-acc'})}<div></div>${fld('Причина изменения',`<textarea class="inp" id="in-why" style="min-height:56px" placeholder="Например: ошибка в сумме платёжки">${esc(st.why)}</textarea>`,{full:true,id:'in-why',hint:'Обязательна, если меняются сумма, дата, детализация или счёт'})}</div>`:''}`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="in-ok">${edit?'Сохранить':'Записать поступление'}</button>`,
    mount(el,mm){
      const sl=$('#in-sumline',el);
      const calc=()=>{const tot=parseNum(st.total);const a=Object.values(st.alloc).reduce((s,v)=>s+(+v||0),0),f=Object.values(st.fee).reduce((s,v)=>s+(+v||0),0);const d=a+f,T_=isNaN(tot)?0:tot;
        let rest=0;$$('[data-rest]',el).forEach(td=>{const k=td.dataset.rest;const v=k.startsWith('al')?(+st.alloc[k.slice(2)]||0):(+st.fee[k.slice(2)]||0);const x=+td.dataset.base-v;rest+=Math.max(0,x);td.textContent=fmtM(x);td.classList.toggle('red',x<0);td.classList.toggle('faint',x===0)});
        if($('#in-t-now',el)){$('#in-t-now',el).textContent=fmtM(d);$('#in-t-rest',el).textContent=fmtM(rest)}
        sl.innerHTML=`<span>Детализация: <b class="tnum">${fmtM(d)}</b>${f?` <span class="muted">(налоги ${fmtM(a)}, обслуживание ${fmtM(f)})</span>`:''}</span><div class="grow"></div>${d>T_?`<span class="pill red">${ic('alert')}больше общей суммы на ${fmtM(d-T_)}</span>`:T_-d>0?`<span class="pill blue">${ic('info')}аванс ${fmtM(T_-d)}</span>`:T_>0?`<span class="pill green">${ic('ok')}сходится</span>`:''}`;return {tot,a,f,d}};
      calc();
      if($('#in-cp',el))$('#in-cp',el).onchange=e=>{st.cp=+e.target.value;st.alloc={};st.fee={};st.total='';mm.draw()};
      $('#in-sum',el).oninput=e=>{st.total=e.target.value;calc()};$('#in-date',el).oninput=e=>{st.date=e.target.value};
      if($('#in-why',el)){$('#in-why',el).oninput=e=>{st.why=e.target.value};$('#in-acc',el).onchange=e=>{st.acc=e.target.value}}
      $$('[data-al]',el).forEach(i=>i.oninput=()=>{const n=parseNum(i.value);if(isNaN(n))delete st.alloc[i.dataset.al];else st.alloc[i.dataset.al]=n;calc()});
      $$('[data-fm]',el).forEach(i=>i.oninput=()=>{const n=parseNum(i.value);if(isNaN(n))delete st.fee[i.dataset.fm];else st.fee[i.dataset.fm]=n;calc()});
      $('#in-auto',el).onclick=()=>{let t=parseNum(st.total);if(isNaN(t)){t=reps.reduce((s,r)=>s+left(r),0)+fms.reduce((s,f)=>s+fLeft(f),0);st.total=t}st.alloc={};st.fee={};reps.forEach(r=>{const x=Math.min(t,left(r));if(x>0){st.alloc[r.id]=x;t-=x}});fms.forEach(f=>{const x=Math.min(t,fLeft(f));if(x>0){st.fee[f]=x;t-=x}});mm.draw()};
      $('#in-ok',el).onclick=()=>{const {tot,f,d}=calc();
        if(!setErr(el,'in-sum',!c?'Выберите контрагента':isNaN(tot)||tot<=0?'Введите сумму больше нуля':d>tot?`Сумма детализации больше общей на ${som(d-tot)}: общая сумма должна быть не меньше`:''))return;
        let bad=false;$$('[data-al],[data-fm]',el).forEach(i=>{const n=parseNum(i.value);const b=!isNaN(n)&&(n<0||n>+i.dataset.max+.001);i.style.borderColor=b?'var(--red)':'';if(b)bad=true});
        if(bad){toast('В строке сумма больше, чем нужно оплатить','alert',true);return}
        if(c.needInFile&&!$('#in-f',el).files.length&&!(edit&&(edit.files||[]).length)){setErr(el,'in-f','Прикрепите файл: для этого контрагента поступление без файла не сохраняется');return}
        const alloc=Object.entries(st.alloc).filter(([,v])=>v>0).map(([r,v])=>({r:+r,a:v})),feeAlloc=Object.entries(st.fee).filter(([,v])=>v>0).map(([k,v])=>({m:k,a:v}));
        // Изменение: на налоги должно остаться не меньше уже потраченного; причина — если меняются сумма, дата, детализация или счёт
        let ch=[];if(edit){const minT=inMin(edit);if(tot-f<minT-0.001){setErr(el,'in-sum',`Из этого поступления на налоги уже потрачено ${som(minT)}: столько должно остаться на налоги. Чтобы уменьшить сильнее, сначала измените или удалите оплату налога`);return}
          const t0=edit.total??edit.amount,d0=allocText(edit)||'аванс',d1=allocText({amount:tot-f,alloc,feeAlloc})||'аванс';
          if(Math.abs(tot-t0)>0.001)ch.push(`общая сумма ${fmtM(t0)} → ${fmtM(tot)} сом`);if(st.date!==edit.date)ch.push(`дата ${fmtD(edit.date)} → ${fmtD(st.date)}`);if(d0!==d1)ch.push(`детализация «${d0}» → «${d1}»`);if(st.acc!==edit.holder)ch.push(`счёт: ${accName(edit.holder)} → ${accName(st.acc)}`);
          if(!setErr(el,'in-why',ch.length&&!st.why.trim()?'Укажите причину: меняются '+ch.map(s=>s.split(/[ :]/)[0]==='общая'?'сумма':s.split(/[ :]/)[0]).join(', '):''))return}
        const files=[...$('#in-f',el).files].map(x=>x.name);const holder=c.paysTo==='org'?'org':c.resp;
        const note=alloc.length?'За '+alloc.map(x=>T[REPORTS.find(y=>y.id===x.r).t].short).join(', '):feeAlloc.length?'За обслуживание':'Аванс';
        let op=edit;
        if(edit){(edit.feeAlloc||[]).forEach(x=>{c.feePaid[x.m]=(c.feePaid[x.m]||0)-x.a});for(let i=FEEPAYS.length-1;i>=0;i--)if(FEEPAYS[i].op===edit.id)FEEPAYS.splice(i,1);
          Object.assign(edit,{amount:tot-f,total:tot,alloc,feeAlloc,date:st.date,note,holder:st.acc});edit.files=(edit.files||[]).concat(files);if(ch.length)edit.edited=true;touch(edit);HIST.push({at:nowStamp(),who:S.me,ent:'in',id:edit.id,cp:c.id,what:ch.length?`Изменено: ${ch.join('; ')}${files.length?'; добавлены файлы: '+files.join(', '):''}. Причина: ${st.why.trim()}`:files.length?'Прикреплены файлы: '+files.join(', '):'Сохранено без изменений'})}
        else{op={id:OPID++,cp:c.id,kind:'in',amount:tot-f,total:tot,alloc,feeAlloc,date:st.date,by:S.me,holder,note,files,_ca:nowStamp(),_ub:S.me,_ua:nowStamp()};OPS.push(op);HIST.push({at:nowStamp(),who:S.me,ent:'in',id:op.id,cp:c.id,what:`Поступление ${som(tot)} записано`})}
        feeAlloc.forEach(x=>{c.feePaid[x.m]=(c.feePaid[x.m]||0)+x.a;FEEPAYS.push({id:fpId(),cp:c.id,month:x.m,amount:x.a,date:st.date,by:S.me,holder:'org',op:op.id,_ca:nowStamp()})});
        if(!edit)log('cp',c.id,`Поступление ${som(tot)}${allocText(op)?': '+allocText(op):''}`,c.id);mm.close();refreshAll();toast(edit?'Поступление изменено':'Поступление записано','wallet')}}};
  }});
}
function moneyOpDlg(c,kind){
  const titles={bonus:['Списать остаток в бонус','Сумма фиксируется как бонус сотрудника. Отдельно бонус не выплачивается и не оформляется.'],refund:['Вернуть остаток контрагенту','Деньги возвращены контрагенту']};
  openModal({form:true,render:()=>({title:titles[kind][0],sub:`${esc(c.name)} · свободный остаток ${som(c.free)}`,body:`<div class="form">${fld('Сумма, сом',inp('mo-sum',c.free,'inputmode="decimal" class="inp tnum"'),{req:true,id:'mo-sum'})}${fld('Дата',inp('mo-date',TODAY,'type="date"'),{req:true,id:'mo-date'})}${fld(kind==='bonus'?'Причина':'Комментарий',inp('mo-note',kind==='bonus'?'Остаток после оплаты налогов':''),{full:true,id:'mo-note'})}</div><div class="note">${ic('lock')}<span>${titles[kind][1]} Запись потом нельзя изменить, только отменить обратной записью.</span></div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="mo-ok">${kind==='bonus'?'Списать':'Записать возврат'}</button>`,
    mount(el,m){$('#mo-ok',el).onclick=()=>{const n=parseNum(val(el,'mo-sum'));if(!setErr(el,'mo-sum',isNaN(n)||n<=0?'Введите сумму больше нуля':n>c.free?`Свободно только ${som(c.free)}`:''))return;
      OPS.push({id:OPID++,cp:c.id,kind,amount:n,date:val(el,'mo-date'),by:S.me,holder:c.paysTo==='org'?'org':c.resp,note:val(el,'mo-note')});log('cp',c.id,`${kind==='bonus'?'Списано в бонус':'Возврат контрагенту'} ${som(n)}`,c.id);m.close();refreshAll();toast(kind==='bonus'?'Списано в бонус':'Возврат записан')}}})});
}

