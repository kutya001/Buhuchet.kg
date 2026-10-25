'use strict';
// Пауза обслуживания, общие блоки (файлы, история), разовые услуги
/* ═════════════ Разовые услуги, проекты, финансы, файлы, аналитика ═════════════ */
const SVST=DB.ref.statuses.service;
const PRS=DB.ref.statuses.project;
STATUS_GROUPS.push(['Статусы обслуживания',SVST,'svc'],['Статусы проектов',PRS,'proj']);
// Удалённые оплаты (отметка del) не входят в «получено» и статусы
const sumPays=a=>(a||[]).reduce((s,x)=>x.del?s:s+x.amount,0);
const svcPaid=s=>sumPays(s.pays);
const svcStatus=s=>{const p=svcPaid(s);return p>=s.amount?'Оплачено':p>0?'Оплачено частично':'Не оплачено'};
const projPlan=p=>p.plan||0;
const projPaid=p=>sumPays(p.pays);
const projLeft=p=>p.plan?Math.max(0,p.plan-projPaid(p)):0;
const projOver=p=>p.status==='В работе'&&p.to<TODAY;
const cpByName=n=>CPS.find(c=>c.name.includes(n));
const moneyVis=()=>(feat('fee')&&can('fee'))||can('projects');
const taxVis=()=>feat('taxpay')&&can('money');

/* ── Пауза и возобновление обслуживания ── */
function applyService(c){const ids=c.assign.filter(a=>!a.to).map(a=>a.t);if(ids.length&&c.kind!=='oneoff'&&!c.archived)assignTypes(c,ids,TODAY,null,null,true);
  let off=0,on=0;REPORTS.filter(r=>r.cp===c.id&&!r.superseded).forEach(r=>{const m=ym(r.pkey);const act=c.assign.some(a=>a.t===r.t&&!a.to);
    if(!inService(c,m)&&OPEN.has(r.status)&&r.due>=addDays(TODAY,-31)){r.status='Не требуется';r._paused=true;off++}
    else if(inService(c,m)&&r.status==='Не требуется'&&act&&!r.subDate&&r.due>=TODAY&&!c.archived){r.status='К сдаче';delete r._paused;on++}});return {off,on}}
function pauseDlg(c){const nm=addMonths(ym(TODAY),1);
  openModal({form:true,render:()=>({title:'Приостановить обслуживание',sub:esc(c.name),body:`<div class="form">${fld('Приостановить с месяца',inp('pz-from',nm,`type="month" min="${ym(TODAY)}"`),{req:true,id:'pz-from',hint:'С этого месяца отчёты не создаются, плата не начисляется, напоминаний нет'})}${fld('Возобновить с месяца',inp('pz-to','','type="month"'),{id:'pz-to',hint:'Необязательно, можно указать позже'})}${fld('Причина',inp('pz-why','','placeholder="Например: сезонная деятельность"'),{full:true,id:'pz-why'})}</div>
    <div class="note">${ic('info')}<span>Пример: приостановить с ноября 2026, возобновить с мая 2027. Несданные отчёты за месяцы паузы получат статус «Не требуется», сданные останутся. Ответственный и назначенные отчёты сохраняются, просрочки по приостановленному контрагенту не считаются.</span></div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="pz-ok">Приостановить</button>',
    mount(el,m){$('#pz-ok',el).onclick=()=>{const f=val(el,'pz-from'),t=val(el,'pz-to'),why=val(el,'pz-why');
      if(!setErr(el,'pz-from',!f?'Укажите месяц':f<ym(TODAY)?'Прошлые месяцы не меняются':''))return;if(!setErr(el,'pz-to',t&&t<=f?'Месяц возобновления должен быть позже месяца паузы':''))return;
      const l=lastPeriod(c);if(l){l.to=addMonths(f,-1);if(l.to<l.from)c.periods.pop()}if(t)c.periods.push({from:t,to:null});
      const r=applyService(c);log('cp',c.id,`Обслуживание приостановлено с ${ymG(f)}${t?', возобновление с '+ymG(t):''}${why?'. Причина: '+why:''}`,c.id);m.close();refreshAll();
      toast(`Приостановлено с ${ymG(f)}${r.off?`, отчётов «Не требуется»: ${r.off}`:''}`,'pause')}}})});
}
function resumeDlg(c){const l=lastPeriod(c);const plan=l&&!l.to&&l.from>ym(TODAY);const def=plan?l.from:maxIso(ym(TODAY),l&&l.to?addMonths(l.to,1):ym(TODAY));
  openModal({form:true,render:()=>({title:'Возобновить обслуживание',sub:`${esc(c.name)} · ${esc(periodsText(c))}`,body:`<div class="form">${fld('Возобновить с месяца',inp('rs-from',def,`type="month" min="${ym(TODAY)}"`),{req:true,id:'rs-from',hint:'Отчёты за этот и следующие периоды создадутся сами'})}</div>${feat('fee')&&can('fee')&&curTariff(c)?`<div class="note">${ic('info')}<span>Плата начнёт начисляться по текущей ставке ${som(curTariff(c).amount)} ${curTariff(c).per==='Y'?'в год':'в месяц'}. Новую ставку можно внести во вкладке «Обслуживание».</span></div>`:''}`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="rs-ok">Возобновить</button>',
    mount(el,m){$('#rs-ok',el).onclick=()=>{const f=val(el,'rs-from');if(!setErr(el,'rs-from',!f?'Укажите месяц':f<ym(TODAY)?'Прошлые месяцы не меняются':''))return;
      const l=lastPeriod(c);if(l&&!l.to&&l.from>ym(TODAY)){l.from=f;const pv=c.periods[c.periods.length-2];if(pv&&pv.to&&addMonths(pv.to,1)>=f){c.periods.pop();pv.to=null}}else if(l&&l.to&&addMonths(l.to,1)>=f)l.to=null;else c.periods.push({from:f,to:null});
      const r=applyService(c);log('cp',c.id,`Обслуживание возобновлено с ${ymG(f)}`,c.id);m.close();refreshAll();toast(`Обслуживание возобновится с ${ymG(f)}${r.on?`, отчётов вернулось в работу: ${r.on}`:''}`,'play')}}})});
}
function unpauseCp(c){const pp=planPause(c);if(!pp)return;if(!can('rollback'))return toast('Нет права «Откат статусов»','alert',true);confirmDlg({title:'Отменить приостановку?',text:`Запланированная пауза с ${ymG(pp.from)}${pp.resume?` и возобновление с ${ymG(pp.resume)}`:''} отменятся, обслуживание продолжится без перерыва.`,ok:'Отменить приостановку',run:()=>{if(pp.fut)c.periods.pop();pp.prev.to=null;applyService(c);log('cp',c.id,'Приостановка отменена',c.id);refreshAll();toast('Приостановка отменена')}})}
function toRegularDlg(c){const fee=feat('fee')&&can('fee');const st={per:'M'};
  openModal({form:true,render:m=>({title:'Перевести в постоянное обслуживание',sub:esc(c.name),body:`<div class="form">${fld('Начало обслуживания',inp('tr-from',ym(TODAY),`type="month" min="${ym(TODAY)}"`),{req:true,id:'tr-from'})}${fld('Режим налогообложения',sel('tr-reg',[['','— не указан —'],...DICT.regimes.items.filter(x=>x.active).map(x=>[x.name,REGIME_FULL[x.name]||x.name])],c.regime||''),{id:'tr-reg'})}
    ${fee?fld('Стоимость обслуживания, сом',`<div class="row" style="flex-wrap:nowrap">${inp('tr-fee','','inputmode="decimal" class="inp tnum"')}${sel('tr-per',[['M','в месяц'],['Y','в год']],st.per,'style="width:auto"')}</div>`,{req:true,id:'tr-fee'}):''}</div>
    <div class="note">${ic('info')}<span>После сохранения откроется выбор отчётов, которые сдаёт контрагент. Разовые услуги и проекты останутся в его карточке.</span></div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="tr-ok">Дальше: выбрать отчёты</button>',
    mount(el){$('#tr-ok',el).onclick=()=>{const f=val(el,'tr-from');if(!setErr(el,'tr-from',f?'':'Укажите месяц'))return;let n=NaN;if(fee){n=parseNum(val(el,'tr-fee'));if(!setErr(el,'tr-fee',isNaN(n)||n<0?'Введите сумму, 0 — допустимо':''))return}
      c.kind='regular';c.regime=val(el,'tr-reg');{const lp=c.periods[c.periods.length-1];if(lp&&!lp.to){if(lp.from<f)lp.to=addMonths(f,-1);else c.periods.pop()}}c.periods.push({from:f,to:null});if(c.start.slice(0,7)<f)c.start=f+'-01';if(fee)c.tariffs.push({amount:n,per:val(el,'tr-per'),from:f,by:S.me,at:TODAY,note:'Переход на постоянное обслуживание'});
      log('cp',c.id,`Переведён в постоянное обслуживание с ${ymG(f)}`,c.id);m.close();refreshAll();pickForCp(c)}}})});
}

/* ── Общие блоки: файлы, история, оплата частями ── */
const FBOX={};
// Свои файлы сотрудник удаляет без права «Удалять файлы» в течение суток после загрузки (в прототипе — загруженные в этом сеансе)
const FUP=new Set();const fileDelOk=f=>can('filesDelete')||FUP.has(f);
function filesBox(files,id,canAdd=true,title='Файлы',meta){FBOX[id]=Object.assign({files},meta||{});return `<div class="box"><h3>${title} · ${files.length}<span class="grow"></span>${canAdd&&feat('files')&&can('filesUpload')?`<label class="btn sm" style="cursor:pointer">${ic('clip','sm')}Прикрепить<input type="file" id="${id}" multiple hidden></label>`:''}</h3>${files.length?`<div class="list">${files.map(f=>`<div class="li" style="cursor:default">${ic('file')}<div class="grow"><div class="t1">${esc(f)}</div><div class="t2">${fext(f)} · ${fmtSize(fsize(f))}</div></div><button class="icon-btn sm" data-dl="${esc(f)}" aria-label="Скачать ${esc(f)}">${ic('download','sm')}</button>${canAdd&&feat('files')&&fileDelOk(f)?`<button class="icon-btn sm" data-fdel="${id}:${files.indexOf(f)}" title="Удалить файл" aria-label="Удалить ${esc(f)}">${ic('trash','sm')}</button>`:''}</div>`).join('')}</div>`:'<span class="faint">Файлов пока нет</span>'}</div>`}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-fdel]');if(!b)return;e.stopPropagation();const[id,i]=b.dataset.fdel.split(':');const fb=FBOX[id];if(!fb)return;const n=fb.files[+i];if(n==null)return;
  confirmDlg({title:`Удалить файл «${esc(n)}»?`,text:'Файл пропадёт из записи и из файлового менеджера. Удаление записывается в историю.',ok:'Удалить',danger:true,run:()=>{fb.files.splice(+i,1);if(fb.ent)log(fb.ent,fb.id,'Удалён файл: '+n,fb.cp);const m=MODALS[MODALS.length-1];if(m&&m.draw)m.draw();refreshAll();toast('Файл удалён','trash')}})},true);
function bindFiles(el,id,arr,after){const x=el.querySelector('#'+id);if(x)x.onchange=e=>{const f=[...e.target.files].map(x=>x.name);f.forEach(n=>FUP.add(n));arr.push(...f);after&&after(f);toast('Файлы прикреплены','clip')};$$('[data-dl]',el).forEach(b=>b.onclick=()=>toast(`Скачивание: ${b.dataset.dl}`,'download'))}
function histBox(ent,id){const hs=HIST.filter(h=>h.ent===ent&&h.id===id).sort((a,b)=>a.at<b.at?1:-1);return hs.length?`<div class="box"><h3>История</h3><ul class="tl">${hs.map(h=>`<li><span class="t">${fmtD(h.at.slice(0,10))}<br>${h.at.slice(11)}</span><span>${esc(h.what)}<br><span class="w">${esc(whoName(h.who))}</span></span></li>`).join('')}</ul></div>`:''}
function tranchDlg({title,sub,left,run,note}){const lim=left!=null;
  openModal({form:true,render:()=>({title,sub,body:`<div class="form">${fld('Сумма, сом',inp('tp-sum',lim&&left>0?left:'','inputmode="decimal" class="inp tnum"'),{req:true,id:'tp-sum',hint:lim?`Осталось получить ${som(left)}`:'Стоимость не задана — любая сумма'})}${fld('Дата',inp('tp-date',TODAY,`type="date" max="${TODAY}"`),{req:true,id:'tp-date'})}${note?fld('Комментарий',inp('tp-note','','placeholder="Например: аванс, второй транш"'),{full:true,id:'tp-note'}):''}${fld('Файлы: платёжка, чек',`<input class="inp" type="file" id="tp-f" multiple>`,{full:true,id:'tp-f'})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="tp-ok">Записать оплату</button>',
    mount(el,m){$('#tp-ok',el).onclick=()=>{const n=parseNum(val(el,'tp-sum'));if(!setErr(el,'tp-sum',isNaN(n)||n<=0?'Введите сумму больше нуля':lim&&n>left?`Больше остатка: осталось ${som(left)}`:''))return;
      run({amount:n,date:val(el,'tp-date')||TODAY,by:S.me,note:note?val(el,'tp-note'):'',files:[...$('#tp-f',el).files].map(x=>x.name)});m.close();refreshAll();toast('Оплата записана','wallet')}}})});
}

/* ── Разовые услуги ── */
function serviceDlg(s0,c0){const e=s0?Object.assign({},s0):{cp:c0?c0.id:'',name:'',date:TODAY,amount:'',resp:c0&&c0.resp||S.me,desc:''};
  openModal({form:true,size:'mid',render:()=>({title:s0?'Изменить разовую услугу':'Разовая услуга',sub:c0||s0?esc(CPM[e.cp].name):'Оплачивается отдельно от ежемесячного обслуживания',body:`<div class="form">
    ${c0||s0?'':fld('Контрагент',sel('sv-cp',[['','— выберите —'],...visCps(false,'projects').map(c=>[c.id,c.name+(c.kind==='oneoff'?' · разовый':'')])],e.cp),{req:true,full:true,id:'sv-cp'})}
    ${fld('Услуга',inp('sv-name',e.name,'placeholder="Например: проверка учёта за 2025 год"'),{req:true,full:true,id:'sv-name'})}
    ${fld('Дата',inp('sv-date',e.date,'type="date"'),{req:true,id:'sv-date'})}${fld('Стоимость, сом',inp('sv-sum',e.amount,'inputmode="decimal" class="inp tnum"'),{req:true,id:'sv-sum',hint:s0&&svcPaid(s0)?`Уже получено ${som(svcPaid(s0))}`:''})}
    ${fld('Исполнитель',sel('sv-resp',EMP.filter(x=>x.active).map(x=>[x.id,x.short]),e.resp),{id:'sv-resp'})}<div></div>
    ${fld('Описание',`<textarea class="inp" id="sv-desc" style="min-height:60px">${esc(e.desc)}</textarea>`,{full:true,id:'sv-desc'})}
    ${s0?'':`<label class="check-row full" style="grid-column:1/-1"><input type="checkbox" class="sw" id="sv-paid"><span class="grow">Оплачено сразу<div class="hint">Запишется оплата на всю сумму сегодняшним днём</div></span></label>`}
    ${fld('Файлы: акт, договор, чек',`<input class="inp" type="file" id="sv-f" multiple>`,{full:true,id:'sv-f'})}
    ${s0?fld('Причина изменения',`<textarea class="inp" id="sv-why" style="min-height:56px" placeholder="Например: стоимость согласовали заново"></textarea>`,{full:true,id:'sv-why',hint:'Обязательна, если меняются стоимость или дата'}):''}</div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="sv-ok">${s0?'Сохранить':'Добавить услугу'}</button>`,
    mount(el,m){$('#sv-ok',el).onclick=()=>{const cp=s0?s0.cp:c0?c0.id:+val(el,'sv-cp');const n=parseNum(val(el,'sv-sum'));
      const ch=s0?[Math.abs(n-s0.amount)>0.001?`стоимость ${fmtM(s0.amount)} → ${fmtM(n)} сом`:'',val(el,'sv-date')!==s0.date?`дата ${fmtD(s0.date)} → ${fmtD(val(el,'sv-date'))}`:''].filter(Boolean):[];const why=s0?val(el,'sv-why'):'';
      const ok=[c0||s0?true:setErr(el,'sv-cp',cp?'':'Выберите контрагента'),setErr(el,'sv-name',val(el,'sv-name')?'':'Опишите услугу'),setErr(el,'sv-date',val(el,'sv-date')?'':'Укажите дату'),setErr(el,'sv-sum',isNaN(n)||n<=0?'Введите стоимость':s0&&n<svcPaid(s0)?`Не меньше уже полученного: ${som(svcPaid(s0))}`:''),s0?setErr(el,'sv-why',ch.length&&!why?'Укажите причину: меняются стоимость или дата':''):true].every(Boolean);if(!ok)return;
      const o={name:val(el,'sv-name'),date:val(el,'sv-date'),amount:n,resp:val(el,'sv-resp'),desc:val(el,'sv-desc')};const files=[...$('#sv-f',el).files].map(x=>x.name);
      if(s0){Object.assign(s0,o);s0.files.push(...files);if(ch.length)s0.edited=true;log('s',s0.id,ch.length?`Изменено: ${ch.join('; ')}. Причина: ${why}`:'Услуга изменена',s0.cp)}
      else{const s=born(Object.assign({id:'s'+(SERVICES.length+1)+'n',cp,pays:[],files},o));if($('#sv-paid',el).checked)s.pays.push({id:s.id+'p1',date:TODAY,amount:n,by:S.me,files:[]});SERVICES.push(s);log('s',s.id,`Разовая услуга «${o.name}» на ${som(n)}${s.pays.length?', оплачена':''}`,cp)}
      m.close();refreshAll();toast(s0?'Услуга сохранена':'Разовая услуга добавлена','coins')}}})});
}
function svcActions(s){const left=s.amount-svcPaid(s);const ed=can('projects');const d={src:'svc',ref:s};if(s.del)return [{label:'Открыть',icon:'coins',run:()=>serviceCard(s)}];const dL=opLock(d,'del');return [{label:'Открыть',icon:'coins',run:()=>serviceCard(s)},{label:'Записать оплату',icon:'wallet',disabled:!ed||left<=0,reason:left<=0?'Услуга оплачена полностью':'Нужно право «Вести проекты и разовые услуги»',run:()=>svcPay(s)},{label:'Изменить',icon:'edit',disabled:!ed,run:()=>serviceDlg(s)},{label:'Карточка контрагента',icon:'building',run:()=>openCp(CPM[s.cp])},{sep:true},
  {label:'Удалить',icon:'trash',danger:true,disabled:!!dL,reason:dL,run:()=>opDelDlg(d)}]}
function svcPay(s){tranchDlg({title:'Оплата разовой услуги',sub:esc(s.name)+' · '+esc(CPM[s.cp].name),left:s.amount-svcPaid(s),run:p=>{const x=Object.assign({id:s.id+'p'+(s.pays.length+1),_ca:nowStamp()},p);s.pays.push(x);log('s',s.id,`Оплата ${som(p.amount)}`,s.cp,{sub:x.id})}})}
function serviceCard(s){
  openModal({size:'mid',live:true,render:m=>{const paid=svcPaid(s),left=s.amount-paid;const st=svcStatus(s);
    const live=s.pays.filter(p=>!p.del);
    return {title:esc(s.name),sub:`${esc(CPM[s.cp].name)} · разовая услуга от ${fmtD(s.date)}`,body:`<div class="row">${pill(st,PST)}${s.del?`<span class="pill red">${ic('trash')}Удалена</span>`:s.edited?`<span class="pill yellow">${ic('edit')}Изменена</span>`:''}</div>
    ${s.del?`<div class="note bad">${ic('trash')}<span><b>Удалена</b> · ${esc(whoName(s.del.by))}, ${fmtDT(s.del.at)}. Причина: ${esc(s.del.why)}. В суммы и итоги не входит.</span></div>`:''}
    <div class="box"><div class="kv"><div><span class="k">Стоимость</span><span class="v tnum strong">${som(s.amount)}</span></div><div><span class="k">Получено</span><span class="v tnum">${som(paid)}</span></div><div><span class="k">Осталось</span><span class="v tnum ${left>0?'red strong':''}">${som(left)}</span></div><div><span class="k">Исполнитель</span><span class="v">${esc(empName(s.resp))}</span></div>${auditKv(s)}</div>${s.desc?`<p style="margin:0">${esc(s.desc)}</p>`:''}</div>
    <div class="box"><h3>Оплаты · ${live.length}<span class="grow"></span>${can('projects')&&left>0&&!s.del?`<button class="btn sm cta" id="sc-pay">${ic('wallet','sm')}Записать оплату</button>`:''}</h3>${live.length?`<div class="tbl-wrap"><table class="mini m-cards"><thead><tr><th>Дата</th><th>Записал</th><th>Файлы</th><th class="num">Сумма</th><th style="width:36px"></th></tr></thead><tbody>${live.map(p=>{const d={src:'sp',ref:p,own:s};return `<tr class="clk" data-opw="${esc(opKey(d))}" title="Открыть оплату"><td>${fmtD(p.date)}${p.edited?' <span class="tag yellow">изменена</span>':''}</td><td>${esc(whoName(p.by))}</td><td>${(p.files||[]).map(esc).join(', ')||'<span class="faint">—</span>'}</td><td class="num">${fmtM(p.amount)}</td><td>${opMenuBtn(d)}</td></tr>`}).join('')}</tbody></table></div>`:'<span class="faint">Оплат пока не было</span>'}</div>
    ${filesBox(s.files,'sc-f',can('projects')&&!s.del,'Файлы',{ent:'s',id:s.id,cp:s.cp})}${histBox('s',s.id)}`,
    foot:`${s.del?'':`<button class="btn" id="sc-more">${ic('more','sm')}Действия</button>`}<div class="grow"></div><button class="btn cta" data-close>Готово</button>`,
    mount(el,mm){if($('#sc-more',el))$('#sc-more',el).onclick=e=>menu(e.currentTarget,svcActions(s).filter(x=>x.label!=='Открыть'));if($('#sc-pay',el))$('#sc-pay',el).onclick=()=>svcPay(s);bindFiles(el,'sc-f',s.files,f=>{log('s',s.id,'Прикреплены файлы: '+f.join(', '),s.cp);mm.draw()})}}}});
}

