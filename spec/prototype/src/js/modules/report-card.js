'use strict';
// Карточка отчёта
/* ── Report card ── */
// Строки суммы по ставкам в карточке отчёта: ставка, выручка и налог
function linesKv(r){const ls=(r.lines||[]).filter(l=>l.rev!=null||l.tax!=null);if(!ls.length)return '';
  return `<div class="ln-kv"><span class="k">Строки по ставкам</span><span class="v">${ls.map(l=>`<span class="ln-row"><span>${esc(l.label)}</span><span class="tnum">${l.rev!=null?`выручка ${som(l.rev)} · `:''}налог <b>${som(l.tax||0)}</b></span></span>`).join('')}</span></div>`}
function openReport(r){
  if(!r)return;
  openModal({size:'mid',live:true,render:m=>{
    r=REPORTS.find(x=>x.id===r.id)||r;const t=tR(r),c=CPM[r.cp];const sch=schedule(r);
    const versions=REPORTS.filter(x=>x.cp===r.cp&&x.t===r.t&&x.pkey===r.pkey).sort((a,b)=>a.ver-b.ver);
    const hist=HIST.filter(h=>h.ent==='r'&&h.id===r.id).sort((a,b)=>a.at<b.at?1:-1);
    // «Сдача отчёта только после оплаты»: пока оплаты нет, «Отметить сданным» неактивна с причиной, рядом — «Принять деньги» и «Отметить оплаченным»
    const payOk=feat('taxpay')&&t.sum&&r.sum>0&&r.paid<r.sum&&r.status!=='Не требуется'&&!r.superseded,subW=subPayWhy(r);
    const primary=OPEN.has(r.status)&&!t.payOnly?{l:'Отметить сданным',i:'send',f:()=>submitDlg([r]),ok:can('changeStatus')&&!subW,why:subW}:repWait(r)&&!repConfWhy(r)?{l:'Подтвердить',i:'check',f:()=>repConfDlg([r]),ok:true,fix:true}:payOk?{l:'Отметить оплаченным',i:'wallet',f:()=>payDlg(r),ok:can('money')}:null;
    const payBtn=payOk&&!!subW&&can('money');
    // Блок сумм вверху карточки — в том же порядке, что столбцы списка (решение заказчика 25.10.2026)
    const sums=feat('taxpay')&&t.sum&&r.status!=='Не требуется'?`<div class="box sums4"><div class="sm4"><span class="k">К уплате</span><b class="tnum">${r.sum==null?'<span class="faint">не указана</span>':som(r.sum)}</b>${r.auto?`<span class="tag">${ic('repeat','sm')} повторяющаяся</span>`:''}</div><div class="sm4"><span class="k">Получено от контрагента</span><b class="tnum ${r.sum>0&&r.got>=r.sum?'green':''}">${som(r.got||0)}</b>${r.sum>0?`<span class="faint">${r.got+(r.selfPaid||0)>=r.sum?'получено полностью':r.got>0?'получено частично':'ожидаем'}</span>`:''}</div><div class="sm4"><span class="k">Оплачено в бюджет</span><b class="tnum">${som(r.paid)}</b>${scaleMini0('pay',r.payStatus,r)}${r.selfPaid?`<span class="faint">оплатил контрагент сам: ${som(r.selfPaid)}</span>`:''}${r.sum!=null&&r.paid>r.sum?`<span class="tag yellow">+${fmtM(r.paid-r.sum)} пеня/переплата</span>`:''}</div><div class="sm4"><span class="k">Осталось оплатить</span><b class="tnum ${r.payOverdue?'red':''}">${som(Math.max(0,Math.round(((r.sum||0)-r.paid)*100)/100))}</b>${r.payOverdue?`<span class="pill red sm">${ic('alert')}срок оплаты прошёл</span>`:''}</div></div>`:'';
    return {title:`${esc(t.name)} ${actPill(t.act)}${r.ver?` <span class="tag blue" style="font-size:12px;vertical-align:3px">уточнённый ${r.ver}</span>`:''}`,sub:`${esc(c.name)} · ${esc(r.phuman)} · ${esc(t.organ)}${t.sum&&(t.pays||[]).length?`<br>Что уплачивается: ${esc(paysTxt(t))}`:''}`,
    body:`<div class="box"><div class="scales">${t.payOnly?'':scaleFull('rep',r.status,r.id)}${t.sum&&feat('taxpay')?scaleFull('pay',r.payStatus,r.id):''}</div></div>${sums}${subPayNote(r,false)}<div class="row">${r.overdue?`<span class="pill red">${ic('alert')}Просрочен на ${diffDays(TODAY,r.due)} ${plural(diffDays(TODAY,r.due),'день','дня','дней')}</span>`:''}</div>${repConfBox(r)}
    <div class="box"><div class="kv">
      ${auditKv(r)}<div><span class="k">Контрагент</span><span class="v"><button class="linkbtn" id="rc-cp">${esc(c.name)}</button></span></div>
      <div><span class="k">ИНН</span><span class="v mono">${c.inn}</span></div>
      <div><span class="k">Код формы · периодичность</span><span class="v">${esc(t.code)} · ${esc(perTxt(tFor(r)))}</span></div>${rateOf(r)?`<div><span class="k">Ставка</span><span class="v">${esc(rateOf(r))}</span></div>`:''}${sfTypeIds().includes(t.id)&&sfState(c)?`<div><span class="k">Тариф Соцфонда</span><span class="v">${sfPill(sfState(c).cur,1)}${(sfState(c).cur&&sfCapTxt(sfState(c).cur))?`<div class="hint">Взносы не начисляются на часть зарплаты выше предельной базы (${esc(sfCapTxt(sfState(c).cur))})</div>`:''}</span></div>`:''}${c.ugns?`<div><span class="k">УГНС</span><span class="v">${esc(ugnsLabel(c.ugns))}</span></div>`:''}
      ${t.payOnly?'':`<div><span class="k">Срок сдачи</span><span class="v ${r.overdue?'red strong':''}">${fmtD(r.due)}${r.dueManual?(r.due!==dueLaw(r)?`<div class="hint">изменён вручную; по закону: ${fmtD(dueLaw(r))}</div>`:''):r.due!==r.dueBase?`<div class="hint">перенесён с ${fmtD(r.dueBase)}: ${esc(holidayName(r.dueBase)||'выходной')}</div>`:''}</span></div>`}
      <div><span class="k">Ответственный</span><span class="v">${esc(empName(r.resp)||'—')}${can('assign')?` <button class="linkbtn" id="rc-resp" style="font-size:12px">сменить</button>`:''}</span></div>
      ${t.payOnly?'':`<div><span class="k">Дата сдачи</span><span class="v">${r.subDate?fmtD(r.subDate):'—'}${r.subDate&&r.subBy&&EMP.some(e=>e.id===r.subBy)?` <span class="faint">· отметил ${esc(empName(r.subBy))}</span>`:''}</span></div>`}
      ${t.sum?`${sums?'':`<div><span class="k">Сумма к уплате</span><span class="v strong tnum">${r.sum==null?'<span class="faint">не указана</span>':som(r.sum)}${r.auto?` <span class="tag">${ic('repeat','sm')} повторяющаяся</span>`:''}</span></div>`}${linesKv(r)}
      ${feat('taxpay')?`<div><span class="k">Срок оплаты</span><span class="v ${r.payOverdue?'red strong':''}">${fmtD(r.payDue)}</span></div>
      <div><span class="k">Деньги контрагента</span><span class="v">${moneyHtml(r)}</span></div>`:''}`:`<div><span class="k">Сумма к уплате</span><span class="v faint">у этого вида отчёта суммы нет</span></div>`}
    </div>${sfPeniNote(r)}</div>
    ${t.sum&&sch.length>1?`<div class="box"><h3>График оплаты · ${sch.length} платежа</h3><table class="mini"><thead><tr><th>Срок</th><th class="num">Сумма</th><th class="num">Оплачено</th><th>Статус</th></tr></thead><tbody>${sch.map(s=>`<tr><td class="${s.paid<s.amount&&s.due<TODAY?'red strong':''}">${fmtD(s.due)}</td><td class="num">${fmtM(s.amount)}</td><td class="num">${fmtM(s.paid)}</td><td>${pill(s.paid>=s.amount?'Оплачено':s.paid>0?'Оплачено частично':'Не оплачено',PST)}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${versions.length>1?`<div class="box"><h3>Версии</h3><table class="mini"><tbody>${versions.map(v=>`<tr class="clk" data-ver="${v.id}"><td>${v.ver?'Уточнённый '+v.ver:'Первичный'}${v.id===r.id?' <span class="tag">открыт</span>':''}</td><td>${pill(repStKey(v),ST)}</td><td class="num">${v.sum==null?'—':fmtM(v.sum)}</td></tr>`).join('')}</tbody></table></div>`:''}
    ${feat('files')?`<div class="box"><h3>Файлы<span class="grow"></span>${can('filesUpload')?`<button class="btn sm" id="rc-file">${ic('clip','sm')}Прикрепить</button>`:''}</h3>${r.files.length?(FBOX['rc-'+r.id]={files:r.files,ent:'r',id:r.id,cp:r.cp},r.files.map((f,i)=>`<div class="row">${ic('file','sm')}<span class="grow">${esc(f)}</span>${can('changeStatus')&&fileDelOk(f)?`<button class="icon-btn sm" data-fdel="rc-${r.id}:${i}" title="Удалить файл" aria-label="Удалить ${esc(f)}">${ic('trash','sm')}</button>`:''}</div>`).join('')):'<span class="faint">Файлов нет</span>'}</div>`:''}
    <div class="box"><h3>История статусов</h3>${t.payOnly?'':statusHistHtml('rep',r,t.sum&&feat('taxpay')?'Сдача':'')}${t.sum&&feat('taxpay')?statusHistHtml('pay',r,t.payOnly?'':'Оплата'):''}</div>
    <div class="box"><h3>История изменений</h3>${hist.length?`<ul class="tl">${hist.map(h=>`<li><span class="t">${fmtD(h.at.slice(0,10))}<br>${h.at.slice(11)}</span><span>${esc(h.what)}<br><span class="w">${esc(whoName(h.who))}</span></span></li>`).join('')}</ul>`:'<span class="faint">Изменений пока не было</span>'}</div>`,
    foot:`<button class="btn" id="rc-more">${ic('more','sm')}Ещё действия</button><div class="grow"></div>${canRecv(r)?`<button class="btn" id="rc-recv">${ic('download','sm')}Принять деньги</button>`:''}${primary&&primary.fix?`<button class="btn" id="rc-fix">${ic('refresh','sm')}На исправление</button>`:''}${payBtn?`<button class="btn" id="rc-pay">${ic('wallet','sm')}Отметить оплаченным</button>`:''}${primary?`<button class="btn cta" id="rc-main" ${primary.ok?'':'disabled'} ${primary.why?`title="${esc(primary.why)}"`:''}>${ic(primary.i,'sm')}${primary.l}</button>`:''}`,
    mount(el,mm){const q=s=>el.querySelector(s);
      q('#rc-more').onclick=e=>menu(e.currentTarget,reportActions(r).filter(x=>x.label!=='Открыть карточку'));
      if(q('#rc-main'))q('#rc-main').onclick=primary.f;if(q('#rc-pay'))q('#rc-pay').onclick=()=>payDlg(r);if(q('#rc-fix'))q('#rc-fix').onclick=()=>repFixDlg(r);if(q('#rc-recv'))q('#rc-recv').onclick=()=>recvDlg(r);
      q('#rc-cp').onclick=()=>openCp(c);
      if(q('#rc-file'))q('#rc-file').onclick=()=>fileDlg(r);
      if(q('#rc-resp'))q('#rc-resp').onclick=e=>menu(e.currentTarget,EMP.filter(x=>x.active).map(x=>({label:x.short,icon:'user',on:x.id===r.resp,run:()=>{const o=r.resp;r.resp=x.id;log('r',r.id,`Ответственный: ${empName(o)||'—'} → ${x.short}`,r.cp);refreshAll();toast('Ответственный изменён. Задача перешла к новому сотруднику.')}})));
      $$('[data-ver]',el).forEach(tr=>tr.onclick=()=>{const v=REPORTS.find(x=>x.id===+tr.dataset.ver);if(v.id!==r.id){mm.close();openReport(v)}});
    }};
  }});
}
// Блок «Подтверждение сдачи» в карточке: кто и когда подтвердил, сколько ждёт; причина возврата «На исправление»
function repConfBox(r){const k=repMark(r);
  if(r.status==='Требует исправления'&&r.fixWhy)return `<div class="note warn">${ic('refresh')}<span><b>Возвращён на исправление</b>${r.fixBy?` · ${esc(empName(r.fixBy))}`:''}${r.fixAt?`, ${fmtDT(r.fixAt)}`:''}<br>${esc(r.fixWhy)}</span></div>`;
  if(!k)return '';const ok=k===REP_MK.ok;const why=repConfWhy(r);
  return `<div class="note ${ok?'ok':''}">${ic(ok?'check':'hourglass')}<span class="grow">${ok?`<b>${esc(stl(REP_MK.ok))}</b>${r.confBy&&EMP.some(e=>e.id===r.confBy)?` · ${esc(empName(r.confBy))}`:''}${r.confAt?`, ${fmtDT(r.confAt)}`:''}${r.confNote?`<br>${esc(r.confNote)}`:''}`
    :`<b>${esc(stl(REP_MK.wait))} · ${repWaitDays(r)} дн.</b><br>${why&&why!=='Отчёт не ждёт подтверждения'?esc(why):can('repConfirm')?'Проверьте сдачу и нажмите «Подтвердить» или верните «На исправление» с причиной':'Сдачу проверит и подтвердит старший бухгалтер'}`}</span></div>`}
// Разовый вид (поле «Разовый»): вместо месяца периода — дата события («Дата ввоза», «Дата выдачи лицензии»), срок — от неё по правилу вида
function adhocDlg(){
  const cps=visCps(false,'reports');const types=RT.filter(t=>ORG.types[t.id]&&ORG.types[t.id].on&&t.active!==false);
  const st={cp:cps[0]&&cps[0].id,t:types.some(t=>t.id==='nds')?'nds':types[0]&&types[0].id,p:addMonths(ym(TODAY),-1),ev:TODAY,d:addDays(TODAY,7),dTouch:false,rs:'Другое'};
  // Срок «Разового отчёта» и отчёта разового вида, выпавший на нерабочий день, сразу переносится на рабочий (ТЗ; решение заказчика 30.10.2026, продукт п. Д-18)
  const evDue=t=>shiftWork(dueOf(t,{y:+st.ev.slice(0,4),m:+st.ev.slice(5,7),ev:st.ev}).base);const offTxt=d=>/^\d{4}-\d\d-\d\d$/.test(d)&&!isWorking(d)?`${fmtD(d)} — нерабочий день: срок будет ${fmtD(shiftWork(d))}`:'';
  openModal({form:true,render:m=>{const t=T[st.t];const one=!!(t&&t.oneOff);if(one&&!st.dTouch&&st.ev)st.d=evDue(t);
    return {title:'Разовый отчёт',sub:one?`${esc(t.short)} — разовый вид: отчёт на каждое событие`:'Например, пропущенный период или отчёт по запросу органа',body:`<div class="form">${fld('Контрагент',sel('ah-cp',cps.map(c=>[c.id,c.name]),st.cp),{req:true,full:true,id:'ah-cp'})}${fld('Вид отчёта',sel('ah-t',types.map(t=>[t.id,t.name+(t.oneOff?' (разовый)':'')]),st.t),{req:true,full:true,id:'ah-t'})}
      ${one?fld(esc(t.evLabel||'Дата события'),inp('ah-ev',st.ev,'type="date"'),{req:true,id:'ah-ev',hint:`Срок — ${esc(ruleText(t))}; период отчёта — месяц этой даты`}):fld('Месяц периода',inp('ah-p',st.p,'type="month"'),{req:true,id:'ah-p',hint:'Для квартальных и годовых берётся квартал или год этого месяца'})}
      ${fld(one&&t.act==='pay'?'Срок оплаты':'Срок сдачи',inp('ah-d',st.d,'type="date"'),{req:true,id:'ah-d',hint:(one?'Посчитан от даты события, можно изменить. ':'')+'Срок на нерабочий день переносится на ближайший рабочий'})}<div class="hint full" id="ah-dw" style="grid-column:1/-1;color:var(--orange)" ${offTxt(st.d)?'':'hidden'}>${esc(offTxt(st.d))}</div>${fld('Причина',sel('ah-rs',DICT.reasons.items.filter(x=>x.active).map(x=>x.name),st.rs),{full:true,id:'ah-rs'})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ah-ok">Создать отчёт</button>',
    mount(el){const snap=()=>{st.cp=+val(el,'ah-cp')||st.cp;st.t=val(el,'ah-t')||st.t;if($('#ah-p',el))st.p=val(el,'ah-p');if($('#ah-ev',el))st.ev=val(el,'ah-ev');st.d=val(el,'ah-d');st.rs=val(el,'ah-rs')};
      $('#ah-t',el).onchange=()=>{snap();st.dTouch=false;m.draw()};if($('#ah-ev',el))$('#ah-ev',el).onchange=()=>{snap();if(!st.dTouch&&st.ev)m.draw()};$('#ah-d',el).onchange=()=>{st.dTouch=true};$('#ah-d',el).oninput=e=>{const w=$('#ah-dw',el),x=offTxt(e.target.value);w.textContent=x;w.hidden=!x};
      $('#ah-ok',el).onclick=()=>{snap();const c=CPM[st.cp],t=T[st.t];const one=!!(t&&t.oneOff);if(![setErr(el,'ah-cp',c?'':'Нет контрагентов: сначала добавьте контрагента'),setErr(el,'ah-t',t?'':'Нет подключённых видов отчётов: подключите их в «Справочники» → «Виды отчётов»'),
        one?setErr(el,'ah-ev',/^\d{4}-\d{2}-\d{2}$/.test(st.ev)?'':'Укажите дату события'):setErr(el,'ah-p',/^\d{4}-\d{2}$/.test(st.p)?'':'Укажите месяц'),setErr(el,'ah-d',st.d?'':'Укажите срок')].every(Boolean))return;
        const p=one?{y:+st.ev.slice(0,4),m:+st.ev.slice(5,7),ev:st.ev}:perOfYm(t,st.p);
        if(REPORTS.some(r=>r.cp===c.id&&r.t===t.id&&r.pkey===pstart(t,p)&&!r.superseded)){setErr(el,one?'ah-ev':'ah-p',one?'Отчёт по этому событию уже есть: один контрагент + вид + дата события = один отчёт':'Такой отчёт уже есть: один контрагент + вид + период = один отчёт');return}
        const r=born(makeReport(c,t,p,c.resp));if(one){r.ev=st.ev;if(st.d!==shiftWork(r.dueBase))r.dueManual=true}else{r.adhoc=true;r.dueBase=st.d}r.due=shiftWork(st.d);const mv=r.due!==st.d?`; срок ${fmtD(st.d)} — нерабочий день, перенесён на ${fmtD(r.due)}`:'';
        REPORTS.push(r);log('r',r.id,`Создан вручную (${st.rs})${one?`; ${evName(t)} ${fmtD(st.ev)}`:''}${mv}`,c.id);m.close();refreshAll();toast('Отчёт создан'+mv);openReport(r)}}}}});
}

