'use strict';
// Повторяющиеся задачи (доработки 28.11.2026): серия — правило, по которому система сама ставит одинаковые задачи
/* ═════════════ Повторы задач ═════════════
   Серия: {id, by, created, start, state: «Действует» | «Остановлена» | «Завершена», why,
     rule: {n: 1–99, u: day | week | month | year, wd: дни недели (0 — пн … 6 — вс), mm: date | nth | last, end: {k: never | date | count, date, count}},
     tpl: поля задачи (title, desc, cat, cp, proj, exec, kind, needFile, confirm)}; у задачи серии — ser: id серии.
   В продукте следующую задачу ставит ночной запуск «Задачи: повторы» (00:05 по Бишкеку); в прототипе — tsRun при открытии и смене дня (derive) */
const TS_WD_C=['П','В','С','Ч','П','С','В'],TS_WD_S=['пн','вт','ср','чт','пт','сб','вс'],TS_WD_F=['понедельник','вторник','среда','четверг','пятница','суббота','воскресенье'];
const TS_WD_ACC=['понедельник','вторник','среду','четверг','пятницу','субботу','воскресенье'],TS_WD_G='mmfmffn';
const TS_ORD={m:['первый','второй','третий','четвёртый','последний'],f:['первую','вторую','третью','четвёртую','последнюю'],n:['первое','второе','третье','четвёртое','последнее']};
const TS_MON_P=['январе','феврале','марте','апреле','мае','июне','июле','августе','сентябре','октябре','ноябре','декабре'];
const TS_U={day:['день','дня','дней'],week:['неделю','недели','недель'],month:['месяц','месяца','месяцев'],year:['год','года','лет']};
const TS_U1={day:'Каждый день',week:'Каждую неделю',month:'Каждый месяц',year:'Каждый год'};
const tsWd=s=>(D(s).getUTCDay()+6)%7;
const tsOf=t=>t&&t.ser?TSER.find(s=>s.id===t.ser)||null:null;
const tsTasks=s=>TASKS.filter(t=>t.ser===s.id).sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
// Ближайшая задача серии: первая со сроком с сегодняшнего дня, иначе последняя
const tsCur=s=>{const l=tsTasks(s);return l.find(t=>t.date>=TODAY)||l[l.length-1]||null};
const tsDef=(start,kind)=>({n:1,u:kind==='month'?'month':'week',wd:[tsWd(start)],mm:'date',end:{k:'never'}});
function tsMonthTxt(mm,start){const d=+start.slice(8),w=tsWd(start),g=TS_WD_G[w];return mm==='date'||!mm?d+'-го числа':'в '+TS_ORD[g][mm==='last'||d>28?4:Math.ceil(d/7)-1]+' '+TS_WD_ACC[w]}
// Правило словами: «Каждую неделю: пн, ср · до 27.02.2027», «Каждые 2 месяца, 5-го числа», «Каждый день · 30 повторов»
function tsText(r,start,kind){if(!r)return 'Не повторять';const n=r.n||1,one=n%10===1&&n%100!==11;
  let s=n===1?TS_U1[r.u]:(one?(r.u==='week'?'Каждую ':'Каждый '):'Каждые ')+n+' '+plural(n,...TS_U[r.u]);
  if(r.u==='week'){const w=[...(r.wd||[])].sort(),wk=w.join()==='0,1,2,3,4';if(n===1&&(wk||w.length===7))s=wk?'Каждый будний день':'Каждый день';else s+=': '+(wk?'по будням':w.length===7?'все дни':w.map(i=>TS_WD_S[i]).join(', '))}
  if(start&&r.u==='month'&&kind!=='month')s+=', '+tsMonthTxt(r.mm,start);
  if(start&&r.u==='year'){const m=+start.slice(5,7);s+=kind==='month'?', в '+TS_MON_P[m-1]:', '+(+start.slice(8))+' '+MONTHS_G[m-1]}
  const e=r.end||{};if(e.k==='date'&&e.date)s+=' · до '+fmtD(e.date);if(e.k==='count')s+=' · '+e.count+' '+plural(e.count,'повтор','повтора','повторов');return s}
const tsTextS=s=>tsText(s.rule,s.start,s.tpl.kind);
// Дата по правилу в месяце m (ГГГГ-ММ); числа нет в месяце — последний день; у задачи «На месяц» — последний день месяца
function tsInMonth(r,st,m,mk){if(mk)return lastDay(m);const L=+lastDay(m).slice(8),day=+st.slice(8),p=x=>m+'-'+String(x).padStart(2,'0');
  if(r.u==='year'||r.mm!=='nth'&&r.mm!=='last')return p(Math.min(day,L));
  let x=1+(tsWd(st)-tsWd(m+'-01')+7)%7;if(r.mm==='last'||day>28){while(x+7<=L)x+=7;return p(x)}
  x+=7*(Math.ceil(day/7)-1);return p(x>L?x-7:x)}
// Первая дата по правилу не раньше from и не раньше начала; после даты окончания — null
function tsNext(s,from){const r=s.rule,st=s.start,n=Math.max(1,r.n||1);if(!from||from<st)from=st;let d=null;
  if(r.u==='day')d=addDays(st,Math.ceil(diffDays(from,st)/n)*n);
  else if(r.u==='week'){const mon=addDays(st,-tsWd(st)),wd=r.wd&&r.wd.length?r.wd:[tsWd(st)];
    for(let i=0;i<7*n+7&&!d;i++){const x=addDays(from,i);if(Math.floor(diffDays(x,mon)/7)%n===0&&wd.includes(tsWd(x)))d=x}}
  else{const step=r.u==='year'?12*n:n;let m=ym(st);for(let i=0;i<3000&&!d;i++){const x=tsInMonth(r,st,m,s.tpl.kind==='month');if(x>=from)d=x;else m=addMonths(m,step)}}
  const e=r.end||{};return d&&!(e.k==='date'&&e.date&&d>e.date)?d:null}
// Дата следующей задачи, которую серия ещё поставит (после последней поставленной)
function tsUpcoming(s){if(s.state!=='Действует')return null;const l=tsTasks(s),e=s.rule.end||{};if(e.k==='count'&&l.length>=e.count)return null;
  const last=l.length?l[l.length-1].date:null;return tsNext(s,last?maxIso(addDays(last,1),TODAY):maxIso(s.start,TODAY))}
// «Следующая» во вкладке «Повторы»: ближайшая задача серии со сроком с сегодняшнего дня или та, что серия поставит
const tsNear=s=>{if(s.state!=='Действует')return null;const c=tsTasks(s).find(t=>t.date>=TODAY);return c?c.date:tsUpcoming(s)};
// Что останавливает серию без человека
function tsStopWhy(s){const p=s.tpl,e=EM[p.exec];if(!e||e.active===false)return 'Исполнитель заблокирован';
  if(p.cp){const c=CPM[p.cp];if(!c)return 'Контрагента больше нет';if(c.archived)return 'Контрагент в архиве'}
  if(p.proj){const pj=PROJECTS.find(x=>x.id===p.proj);if(!pj||pj.status==='Отменён'||pj.status==='Завершён')return 'Проект больше не активен'}return ''}
const tsFields=o=>({title:o.title,desc:o.desc||'',cat:o.cat,cp:o.cp||null,proj:o.proj||null,exec:o.exec,kind:o.kind,needFile:!!o.needFile,confirm:!!o.confirm});
function tsNew(o,rule,start){return born({id:'s'+nextNum(TSER,'s'),by:S.me,created:TODAY,start,state:'Действует',why:'',rule:structuredClone(rule),tpl:tsFields(o)})}
// Сообщение постановщику: «Повтор закончился: …», «Повтор остановлен: …. <причина>» — в колокольчик и строкой журнала Telegram
function tsTell(s,ev,why){const t=tsCur(s);if(!t||!bellTo(s.by,'tasks'))return;const text=ev==='end'?tplFill('tgSerEnd',{задача:s.tpl.title}):tplFill('tgSerStop',{задача:s.tpl.title,причина:why||''}).replace(/\.\s*$/,'');
  bellPut(s.by,{kind:'tasks',ev:'task_ser_'+ev,cp:s.tpl.cp||null,open:{k:'task',id:t.id},text,key:bellOnce(`task_ser_${ev}:${s.id}:${TODAY}`)});
  const a=EM[s.by];if(a&&a.tg)TG_LOG.unshift({id:TG_LOG.length+1,at:nowStamp(),to:a.short+' '+a.tg,org:ORG.name,kind:ev==='end'?'Повтор закончился':'Повтор остановлен',st:'Ожидает',tries:0,err:''})}
function tsLog(s,what,who){const t=tsCur(s);if(t)log('t',t.id,what,t.cp,who?{who}:undefined)}
function tsFin(s){s.state='Завершена';s.why='';touch(s);tsLog(s,'Повтор закончился','system');tsTell(s,'end')}
function tsHalt(s,why,who){s.state='Остановлена';s.why=why||'';touch(s);tsLog(s,'Повтор остановлен'+(why?': '+why:''),who);if(who==='system')tsTell(s,'stop',why)}
function tsMake(s,d){const n=Object.assign({id:'t'+(TID++),by:s.by,status:'К выполнению',file:null,reason:'',created:TODAY,doneAt:null,comments:[]},structuredClone(s.tpl),{date:d,ser:s.id});
  born(n,'system');TASKS.push(n);log('t',n.id,'Задача поставлена по повтору',n.cp,{who:'system'});bellTask(n,'new',n.exec);return n}
// Ставит следующие задачи серий: у серии всегда одна ближайшая задача; пропущенные даты задним числом не ставятся
function tsRun(){if(typeof TSER==='undefined'||!TSER.length||!feat('tasks'))return 0;let made=0;
  TSER.forEach(s=>{if(s.state!=='Действует')return;const why=tsStopWhy(s);if(why)return tsHalt(s,why,'system');
    const c=s.tpl.cp&&CPM[s.tpl.cp];if(c&&cpStatus(c)==='Приостановлен')return;
    const l=tsTasks(s),last=l.length?l[l.length-1].date:null;if(last&&last>=TODAY)return;
    const e=s.rule.end||{};if(e.k==='count'&&l.length>=e.count)return tsFin(s);
    const d=tsNext(s,last?maxIso(addDays(last,1),TODAY):maxIso(s.start,TODAY));if(!d)return tsFin(s);
    tsMake(s,d);made++;if(!tsUpcoming(s))tsFin(s)});
  return made}

/* Окно «Повтор»: интервал и единица, дни недели, «N-го числа» или «в N-й день недели», начало (срок первой задачи), окончание */
function tsDlg({rule,start,kind,done}){const r=structuredClone(rule||tsDef(start,kind));r.end=r.end||{k:'never'};const st={start};const mk=kind==='month';
  const m0=openModal({form:true,render:m=>{const us=mk?['month','year']:['day','week','month','year'];if(!us.includes(r.u))r.u=us[0];if(!r.wd||!r.wd.length)r.wd=[tsWd(st.start)];
    const d=+st.start.slice(8),L=+lastDay(ym(st.start)).slice(8),mmO=[['date',d+'-го числа'],...(d<=28?[['nth',tsMonthTxt('nth',st.start)]]:[]),...(d+7>L?[['last',tsMonthTxt('last',st.start)]]:[])];
    if(!mmO.some(x=>x[0]===r.mm))r.mm='date';const e=r.end;
    return {title:'Повтор',body:`<div class="form ts-form">
      <div class="fld full" data-f="ts-n"><label for="ts-n">Повторять с интервалом</label><div class="row ts-int"><input class="inp" id="ts-n" type="number" min="1" max="99" step="1" inputmode="numeric" value="${r.n}">${sel('ts-u',us.map(u=>[u,plural(+r.n||1,...TS_U[u]).replace('неделю','неделя')]),r.u,'aria-label="Единица"')}</div><div class="err" hidden></div></div>
      ${r.u==='week'?`<div class="fld full" data-f="ts-wd"><span class="lbl">Дни недели</span><div class="ts-wd" role="group" aria-label="Дни недели">${TS_WD_C.map((c,i)=>`<button type="button" class="ts-d ${r.wd.includes(i)?'on':''}" data-wd="${i}" aria-pressed="${r.wd.includes(i)}" aria-label="${TS_WD_F[i]}" title="${TS_WD_F[i]}">${c}</button>`).join('')}</div><div class="err" hidden></div></div>`:''}
      ${r.u==='month'&&!mk?fld('Когда',sel('ts-mm',mmO,r.mm),{full:true,id:'ts-mm'}):''}
      ${r.u==='year'&&!mk?`<div class="fld full"><div class="hint">Тот же день и месяц, что у начала: ${+st.start.slice(8)} ${MONTHS_G[+st.start.slice(5,7)-1]}${st.start.slice(5)==='02-29'?'; в невисокосный год — 28 февраля':''}</div></div>`:''}
      ${fld('Начало',mk?inp('ts-start',ym(st.start),'type="month"'):inp('ts-start',st.start,'type="date"'),{req:true,id:'ts-start',hint:'Срок первой задачи — то же поле, что срок в форме'})}
      <div class="fld full" data-f="ts-end"><span class="lbl">Окончание</span><div class="ts-ends" role="radiogroup" aria-label="Окончание">
        <label class="ts-end"><input type="radio" name="ts-e" value="never" ${e.k==='never'?'checked':''}> Никогда</label>
        <label class="ts-end"><input type="radio" name="ts-e" value="date" ${e.k==='date'?'checked':''}> Дата <input class="inp" type="date" id="ts-ed" value="${esc(e.date||addDays(st.start,90))}" ${e.k==='date'?'':'disabled'} aria-label="Дата окончания"></label>
        <label class="ts-end"><input type="radio" name="ts-e" value="count" ${e.k==='count'?'checked':''}> После <input class="inp" type="number" id="ts-ec" min="1" max="999" step="1" inputmode="numeric" value="${e.count||30}" ${e.k==='count'?'':'disabled'} aria-label="Число повторов"> ${plural(e.count||30,'повтора','повторов','повторов')}</label></div><div class="err" hidden></div></div>
      <div class="fld full"><div class="note">${ic('repeat')}<span id="ts-pv">${esc(tsText(r,st.start,kind))}</span></div></div></div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ts-ok">Готово</button>',
    mount(el){const snap=()=>{r.n=Math.round(+val(el,'ts-n'))||r.n;r.u=val(el,'ts-u');if($('#ts-mm',el))r.mm=val(el,'ts-mm');const k=(el.querySelector('[name=ts-e]:checked')||{}).value||'never';
        r.end={k};if(k==='date')r.end.date=val(el,'ts-ed');if(k==='count')r.end.count=Math.round(+val(el,'ts-ec'))||30;
        const s0=val(el,'ts-start');if(s0)st.start=mk?lastDay(s0):s0};
      const pv=()=>{snap();$('#ts-pv',el).textContent=tsText(r,st.start,kind)};
      $('#ts-u',el).onchange=()=>{snap();m.draw()};$('#ts-start',el).onchange=()=>{snap();m.draw()};
      $('#ts-n',el).oninput=pv;if($('#ts-mm',el))$('#ts-mm',el).onchange=pv;$('#ts-ec',el).oninput=pv;$('#ts-ed',el).onchange=pv;
      $$('[name=ts-e]',el).forEach(x=>x.onchange=()=>{const k=x.value;$('#ts-ed',el).disabled=k!=='date';$('#ts-ec',el).disabled=k!=='count';setErr(el,'ts-end','');pv()});
      $$('[data-wd]',el).forEach(b=>b.onclick=()=>{const i=+b.dataset.wd;r.wd=r.wd.includes(i)?r.wd.filter(x=>x!==i):[...r.wd,i].sort();b.classList.toggle('on',r.wd.includes(i));b.setAttribute('aria-pressed',r.wd.includes(i));setErr(el,'ts-wd','');pv()});
      $('#ts-ok',el).onclick=()=>{snap();const n=+val(el,'ts-n');let ok=setErr(el,'ts-n',Number.isInteger(n)&&n>=1&&n<=99?'':'Интервал — целое число от 1 до 99');
        if(r.u==='week')ok=setErr(el,'ts-wd',r.wd.length?'':'Отметьте хотя бы один день недели')&&ok;
        if(!val(el,'ts-start'))ok=setErr(el,'ts-start','Укажите начало')&&ok;
        const c=+val(el,'ts-ec');let ee='';if(r.end.k==='date')ee=!r.end.date?'Укажите дату окончания':r.end.date<st.start?'Окончание раньше начала':'';if(r.end.k==='count'&&!(Number.isInteger(c)&&c>=1&&c<=999))ee='Число повторов — от 1 до 999';
        ok=setErr(el,'ts-end',ee)&&ok;if(!ok)return;
        if(r.u!=='week')delete r.wd;if(r.u!=='month'||mk)delete r.mm;m.close();done(r,st.start)}}}}});
  if(isMobile())m0.setMax(true)}
// «Только эту задачу» или «Эту и следующие» — как в Google
function tsAsk({title,ok='Сохранить',danger=false,oneWhy='',run}){
  const m0=openModal({noMax:true,render:()=>({title,body:`<div class="ts-ask" role="radiogroup" aria-label="Какие задачи">${[['one','Только эту задачу',oneWhy],['all','Эту и следующие','']].map(([k,l,w])=>`<label class="check-row"><input type="radio" name="ts-sc" value="${k}" ${(oneWhy?k==='all':k==='one')?'checked':''} ${w?'disabled':''}><span class="grow"><b>${l}</b>${w?`<div class="hint">${esc(w)}</div>`:''}</span></label>`).join('')}</div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn ${danger?'danger':'cta'}" id="ts-sc-ok">${esc(ok)}</button>`,
    mount(el,m){$('#ts-sc-ok',el).onclick=()=>{const v=(el.querySelector('[name=ts-sc]:checked')||{}).value||'one';m.close();run(v)}}})});m0.el.classList.add('cfm');return m0}
// Изменить правило из карточки задачи и вкладки «Повторы»: это «Эту и следующие» для правила
function tsEditRule(s){const why=taskBossWhy(s);if(!taskBoss(s))return toast(why||'Менять повтор может тот, кто его настроил, или владелец','alert',true);
  tsDlg({rule:s.rule,start:s.start,kind:s.tpl.kind,done:(r,start)=>{const was=tsTextS(s);s.rule=r;s.start=start;touch(s);const now=tsTextS(s);
    if(was!==now)tsLog(s,`Повтор изменён: ${was} → ${now}`);if(s.state==='Завершена'&&tsUpcoming(Object.assign({},s,{state:'Действует'}))){s.state='Действует';tsLog(s,'Повтор возобновлён')}
    tsRun();refreshAll();toast('Повтор изменён','repeat')}})}
function tsStopDlg(s){if(!taskBoss(s))return toast(taskBossWhy(s)||'Остановить повтор может тот, кто его настроил, или владелец','alert',true);
  confirmDlg({title:'Остановить повтор?',text:`Новые задачи «${esc(s.tpl.title)}» ставиться не будут. Уже поставленные останутся как есть.`,ok:'Остановить повтор',danger:true,run:()=>{tsHalt(s,'',S.me);refreshAll();toast('Повтор остановлен','repeat')}})}
function tsResume(s){if(!taskBoss(s))return toast(taskBossWhy(s)||'Возобновить повтор может тот, кто его настроил, или владелец','alert',true);
  const why=tsStopWhy(s);if(why)return toast(`${why}: смените это в «Изменить» задачи → «Эту и следующие», затем возобновите`,'alert',true);
  s.state='Действует';s.why='';touch(s);tsLog(s,'Повтор возобновлён');const n=tsRun();if(!n&&!tsUpcoming(s)&&!tsTasks(s).some(t=>t.date>=TODAY))tsFin(s);refreshAll();toast(n?'Повтор возобновлён: поставлена задача на ближайшую дату':'Повтор возобновлён','repeat')}
function tsListDlg(s){openModal({size:'mid',render:m=>({title:'Все задачи серии',sub:esc(s.tpl.title)+' · '+esc(tsTextS(s)),body:`<div class="ts-list">${tsTasks(s).slice().reverse().map(t=>`<button type="button" class="ts-li" data-t="${esc(t.id)}"><span class="ts-li-d">${fmtD(t.date)}</span><span class="grow">${esc(empName(t.exec)||'—')}</span>${scaleMini('task',t.status,t)}</button>`).join('')||'<p class="muted">Задач пока нет</p>'}</div>`,
  mount(el){$$('[data-t]',el).forEach(b=>b.onclick=()=>{m.close();openTask(TASKS.find(x=>x.id===b.dataset.t))})}})})}
// Строка «Повтор» в карточке задачи
function tsCardHtml(t){const s=tsOf(t);if(!s)return '';const up=tsUpcoming(s),boss=taskBoss(s),why=taskBossWhy(s),show=boss||why,dis=boss?'':`disabled title="${esc(why)}"`;
  return `<div class="note ts-card">${ic('repeat')}<span class="grow"><b>Повтор:</b> ${esc(tsTextS(s))}${up?` · следующая ${fmtD(up)}`:''}${s.state!=='Действует'?` · <span class="pill sm ${s.state==='Завершена'?'':'orange'}">${s.state==='Остановлена'?'остановлен':'закончился'}</span>${s.why?` <span class="muted">${esc(s.why)}</span>`:''}`:''}
    <span class="ts-acts"><button type="button" class="linkbtn" id="ts-all">Все задачи серии · ${tsTasks(s).length}</button>${show?`<button type="button" class="linkbtn" id="ts-edit" ${dis}>Изменить повтор</button>${s.state==='Действует'?`<button type="button" class="linkbtn" id="ts-stop" ${dis}>Остановить повтор</button>`:s.state==='Остановлена'?`<button type="button" class="linkbtn" id="ts-go" ${dis}>Возобновить</button>`:''}`:''}</span></span></div>`}
function tsCardMount(el,t){const s=tsOf(t);if(!s)return;const b=id=>$('#'+id,el);if(b('ts-all'))b('ts-all').onclick=()=>tsListDlg(s);if(b('ts-edit'))b('ts-edit').onclick=()=>tsEditRule(s);if(b('ts-stop'))b('ts-stop').onclick=()=>tsStopDlg(s);if(b('ts-go'))b('ts-go').onclick=()=>tsResume(s)}
const tsIc=t=>{const s=tsOf(t);return s?`<span class="ts-ic" title="Повтор: ${esc(tsTextS(s))}" aria-label="Повторяющаяся задача: ${esc(tsTextS(s))}">${ic('repeat','sm')}</span>`:''};

/* Вкладка «Повторы»: одна строка на серию */
const tsScope=()=>can('tasksAll')||me().role==='owner'?TSER:TSER.filter(s=>s.by===S.me);
function tsEndTxt(s){const e=s.rule.end||{};return e.k==='date'?'До '+fmtD(e.date):e.k==='count'?`${e.count} ${plural(e.count,'повтор','повтора','повторов')}`:'Никогда'}
function tsActions(s){const boss=taskBoss(s),why=taskBossWhy(s),r=why||(!boss&&'Менять повтор может тот, кто его настроил, или владелец'),cur=tsCur(s);return [
  cur?{label:'Открыть ближайшую задачу',icon:'task',run:()=>openTask(cur)}:null,
  {label:'Изменить повтор',icon:'edit',disabled:!boss,reason:r,run:()=>tsEditRule(s)},
  s.state==='Действует'?{label:'Остановить повтор',icon:'ban',danger:true,disabled:!boss,reason:r,run:()=>tsStopDlg(s)}:s.state==='Остановлена'?{label:'Возобновить',icon:'repeat',disabled:!boss,reason:r,run:()=>tsResume(s)}:null,
  {label:'Все задачи серии',icon:'list',run:()=>tsListDlg(s)}].filter(Boolean)}
function tsRender(body,fresh){body.innerHTML='<div id="tg"></div>';
  grid($('#tg',body),{id:'tasks-series',rows:tsScope,title:'title',noun:['серия','серии','серий'],ordered:true,sort:{key:'next',dir:1},simulateLoad:fresh,actions:tsActions,open:s=>{const t=tsCur(s);if(t)openTask(t)},rowClass:s=>s.state==='Действует'?'':'muted',
    cols:[{key:'title',label:'Задача',type:'text',w:300,val:s=>s.tpl.title,html:s=>`<span class="ts-ic">${ic('repeat','sm')}</span><span class="strong">${esc(s.tpl.title)}</span>`},
      {key:'rule',label:'Повтор',type:'text',w:270,val:tsTextS},
      {key:'exec',label:'Исполнитель',type:'enum',w:130,val:s=>empName(s.tpl.exec)},
      {key:'cp',label:'Контрагент',type:'enum',w:190,val:s=>s.tpl.cp&&CPM[s.tpl.cp]?CPM[s.tpl.cp].name:'Общие задачи',html:s=>s.tpl.cp&&CPM[s.tpl.cp]?esc(CPM[s.tpl.cp].name):'<span class="faint">Общая</span>',pin:'Общие задачи'},
      {key:'next',label:'Следующая',type:'date',w:130,val:tsNear,sortVal:s=>s.state==='Действует'?tsNear(s)||'9997':s.state==='Остановлена'?'9998':'9999'},
      {key:'end',label:'Окончание',type:'enum',w:140,val:tsEndTxt},
      {key:'state',label:'Состояние',type:'enum',w:170,val:s=>s.state,html:s=>`<span class="pill sm ${s.state==='Действует'?'green':s.state==='Остановлена'?'orange':''}">${esc(s.state)}</span>${s.why?` <span class="muted">${esc(s.why)}</span>`:''}`},
      {key:'by',label:'Поставил',type:'enum',w:120,val:s=>empName(s.by),hide:true},
      {key:'created',label:'Создано',type:'date',w:120,val:s=>s.created,hide:true},
      {key:'made',label:'Поставлено задач',type:'int',w:120,num:true,val:s=>tsTasks(s).length,hide:true}],
    empty:{icon:'repeat',title:'Повторов нет',text:'Повтор настраивается в окне задачи: строка «Повтор» рядом со сроком.',add:can('tasksCreate')?()=>taskDlg():null}})}
