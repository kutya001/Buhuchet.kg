'use strict';
// Админка → «Организации» → «Подписки» (доработки 20.11.2026, блок 6; пакет 2, блок 6; поток Т). Модель и расчёты — src/js/core/subs.js.
// Три части переключателем: «Организации» (список подписок с проверкой чеков), «Виды подписок» (справочник), «Цены и реквизиты».
// Окно «Подписка организации» — subOrgWin(orgId): то же, что владелец видит на экране «Подписка» (поток И, subScreenHtml), плюс чеки на проверке
// и история изменений; его же показывает вкладка «Подписка» карточки организации. Видят и правят только администраторы платформы.

const SUBS_UI={part:store.get('subs.part','orgs')};
const subWaitN=()=>SUB_PAYS.filter(p=>p.status==='wait').length;
const subKindName=id=>(subKind(id)||{}).name||'—';
const subBar=(used,lim)=>{const p=lim&&isFinite(lim)?Math.min(100,Math.round(used/lim*100)):0;return `<div class="bar" style="margin-top:4px"><i style="width:${p}%;background:var(--${p>=100?'red':p>=80?'yellow':'green'})"></i></div>`};
const subPill=(st,late)=>`${pill(st,SUB_PILL)}${late?` <span class="pill red">${ic('alert')}Ждёт проверки больше ${SUB_P().check||3} дней</span>`:''}`;
const subWho=l=>{if(!l)return '—';if(l==='admin')return 'Администратор платформы';const e=EMP.find(x=>x.id===l||x.login===l);if(e)return e.fio;const u=(DB.platformUsers||[]).find(x=>x.login===l);return u?u.fio:l};
const subPayWhat=p=>p.what==='renew'?`Продление: ${subKindName(p.kind)}`:p.what==='free'?`Бесплатный период до ${fmtD(p.paidTo)}`:p.what==='grow'?`Расширение пакета до ${p.pack}${p.from==='next'?' со следующего месяца':''}`:p.what==='mem'?`Память сверх: ${p.extraGb} ГБ${p.from==='next'?' со следующего месяца':''}`:SUB_WHAT[p.what]||p.what;
const subPayTerm=p=>p.what==='free'?`до ${fmtD(p.paidTo)}`:p.months?`${p.months} мес.`:'—';
const subPaySt=p=>p.status==='rej'?pill('Отклонена',{Отклонена:['red','ban']}):p.status==='wait'?pill('Ждёт подтверждения',SUB_PILL):pill('Подтверждена',{Подтверждена:['green','check']});
// Строки расчёта: «Контрагенты: 60 × 95,00 × 3 мес.», скидки, «Итого к оплате»
const subLinesHtml=ls=>ls&&ls.length?`<div class="kv">${ls.map(l=>`<div class="${l.total||l.label==='Итого к оплате'?'full':''}"><span class="k">${esc(l.label)}</span><span class="v tnum ${l.total||l.label==='Итого к оплате'?'strong':''}">${som(l.sum)}</span></div>`).join('')}</div>`:'<span class="faint">Без суммы</span>';
const subFileBtn=p=>p.file?`<button type="button" class="linkbtn" data-subact="file:${esc(p.id)}">${ic('file','sm')}${esc(p.file.name)}</button>`:'<span class="faint">нет</span>';

function renderSubs(body,fresh){const P=[['orgs','Организации','building'],['kinds','Виды подписок','layers'],['prices','Цены и реквизиты','sliders']];if(!P.some(x=>x[0]===SUBS_UI.part))SUBS_UI.part='orgs';
  body.innerHTML=`<div class="row" style="margin-bottom:12px;flex-wrap:wrap;gap:8px"><div class="seg" role="tablist" aria-label="Подписки" id="sb-part">${P.map(([k,l,i])=>`<button type="button" role="tab" aria-selected="${SUBS_UI.part===k}" data-part="${k}" class="${SUBS_UI.part===k?'on':''}">${ic(i,'sm')}${l}</button>`).join('')}</div></div><div id="sb-b"></div>`;
  $$('[data-part]',body).forEach(b=>b.onclick=()=>{SUBS_UI.part=b.dataset.part;store.set('subs.part',SUBS_UI.part);renderSubs(body)});
  const h=$('#sb-b',body);if(SUBS_UI.part==='kinds')return subKindsPart(h,fresh);if(SUBS_UI.part==='prices')return subPricesPart(h);subOrgsPart(h,fresh)}

/* ── «Организации»: список подписок (блок 6, пункт 2) ── */
// Порядок: чеки, ждущие проверки больше 3 дней, первыми; затем «Ждёт подтверждения», «Просрочена», «Скоро истекает», «Нет подписки», «Активна»; внутри — по «Оплачено до», от ближайшей
function subSortKey(o){const st=subStatus(o.id),w=subWait(o.id),s=subOf(o.id);return (subPayLate(w)?0:SUB_ST_ORD[st]+1)*1e6+(s&&s.paidTo?diffDays(s.paidTo,'2000-01-01'):999999)}
function subOrgsPart(h,fresh){const gid='adm-subs',g=GS[gid],f=g&&g.filters&&g.filters.st,on=v=>!!(f&&f.vals&&f.vals.length===1&&f.vals[0]===v);
  const n=st=>ORGS.filter(o=>subStatus(o.id)===st).length,late=ORGS.filter(o=>subPayLate(subWait(o.id))).length;
  h.innerHTML=`<div class="note">${ic('info')}<span>Организация прикрепляет чек на экране «Подписка» — доступ открывается сразу и остаётся открытым, пока вы не проверите оплату. Проверьте чек за ${SUB_P().check||3} дня: «Подтвердить оплату» продлевает подписку, «Отклонить» с причиной снова закрывает доступ, если срок прошёл. Оплату мимо платформы и бесплатные дни ставьте через «Изменить подписку».</span></div>
    <div class="plates">${plate({id:'Ждёт подтверждения',icon:'clock',color:n('Ждёт подтверждения')?'blue':'green',label:'Ждут подтверждения',value:n('Ждёт подтверждения'),sub:late?`больше ${SUB_P().check||3} дней: ${late}`:'чеки на проверке',on:on('Ждёт подтверждения')})}${plate({id:'Просрочена',icon:'alert',color:n('Просрочена')?'red':'green',label:'Просрочены',value:n('Просрочена'),sub:'доступ закрыт до оплаты',on:on('Просрочена')})}${plate({id:'Скоро истекает',icon:'hourglass',color:n('Скоро истекает')?'yellow':'green',label:'Скоро истекают',value:n('Скоро истекает'),sub:`${SUB_P().remind||7} дней и меньше`,on:on('Скоро истекает')})}${plate({id:'Активна',icon:'check',color:'green',label:'Активны',value:n('Активна'),on:on('Активна')})}</div><div id="sbg"></div>`;
  h.querySelector('.plates').onclick=e=>{const b=e.target.closest('[data-plate]');if(!b)return;const G=GS[gid];if(!G)return;const was=b.classList.contains('on');G.filters={};if(!was)G.filters.st={type:'enum',vals:[b.dataset.plate]};G.page=0;renderPage()};
  grid($('#sbg',h),{id:gid,rid:o=>o.id,cols:[
    {key:'name',label:'Организация',type:'text',w:260,val:o=>o.name,html:o=>`<span class="strong">${esc(o.name)}</span>${o.self?` <span class="pill purple">${ic('star')}Демо</span>`:''}${o.active?'':` <span class="pill red">${ic('lock')}Заблокирована</span>`}`},
    {key:'kind',label:'Вид подписки',type:'enum',w:150,val:o=>{const s=subOf(o.id);return s?s.free?'Бесплатный период':subKindName(s.kind):'—'}},
    {key:'pack',label:'Пакет',type:'int',w:110,num:true,val:o=>subSeats(o.id).pack,text:o=>{const x=subSeats(o.id);return `${x.used} из ${x.pack}`},html:o=>{const x=subSeats(o.id);return `<span class="tnum" ${x.used>x.pack?'style="color:var(--red)"':''}>${x.used} из ${x.pack}</span>`}},
    {key:'mem',label:'Память',type:'num',w:130,num:true,agg:'',val:o=>subMem(o.id).used/1000,sortVal:o=>{const m=subMem(o.id);return m.limit?m.used/m.limit:0},text:o=>{const m=subMem(o.id);return `${subGb(m.used)} из ${subGb(m.limit)} ГБ`},html:o=>{const m=subMem(o.id);return `<span class="tnum">${subGb(m.used)} из ${subGb(m.limit)} ГБ</span>`}},
    {key:'paidTo',label:'Оплачено до',type:'date',w:120,val:o=>(subOf(o.id)||{}).paidTo||''},
    {key:'st',label:'Статус',type:'enum',w:200,val:o=>subStatus(o.id),sortVal:subSortKey,html:o=>subPill(subStatus(o.id),subPayLate(subWait(o.id)))},
    {key:'chk',label:'На проверке',type:'money',w:130,num:true,val:o=>{const w=subWait(o.id);return w?w.sum:null}},
    {key:'add',label:'Дополнительная скидка, %',type:'int',w:120,num:true,hide:true,agg:'',val:o=>(subOf(o.id)||{}).addDisc||0},
    {key:'first',label:'Первая оплата',type:'date',w:120,hide:true,val:o=>{const p=subPaysOf(o.id).filter(x=>x.status==='ok'&&x.sum>0).pop();return p?p.at.slice(0,10):''}},
    {key:'last',label:'Последняя оплата',type:'date',w:120,hide:true,val:o=>{const p=subPaysOf(o.id).find(x=>x.status==='ok'&&x.sum>0);return p?p.at.slice(0,10):''}},
    {key:'owner',label:'Владелец',type:'text',w:150,hide:true,val:o=>o.owner,cls:'mono'}],
    rows:()=>ORGS,title:'name',noun:['организация','организации','организаций'],sort:{key:'st',dir:1},ordered:true,simulateLoad:fresh,
    rowClass:o=>subPayLate(subWait(o.id))?'warn-row':'',open:o=>subOrgWin(o.id),
    actions:o=>[{label:'Открыть подписку',icon:'wallet',run:()=>subOrgWin(o.id)},{label:'Изменить подписку',icon:'edit',run:()=>subEditDlg(o.id)},{sep:true},{label:'Открыть организацию',icon:'building',run:()=>orgCard(o.id)}]})}

/* ── Окно «Подписка организации» (блок 6, пункты 2–4, 7) ── */
// Тело — одно для окна и вкладки «Подписка» карточки организации; если экран владельца (поток И) уже есть, его часть берётся оттуда
function subSummaryHtml(orgId){const s=subOf(orgId),st=subStatus(orgId),seats=subSeats(orgId),m=subMem(orgId),k=s&&subKind(s.kind),left=subDaysLeft(orgId),add=s&&s.addDisc&&s.pack>(SUB_P().extraOver||150)?s.addDisc:0;
  const renew=s?subCalc({orgId,what:'renew',kind:s.kind,pack:s.pack,extraGb:s.extraGb}):null;
  return `<div class="box"><h3>Подписка</h3><div class="kv">${acKv('Статус',subPill(st,subPayLate(subWait(orgId))))}${acKv('Вид подписки',s?s.free?'Бесплатный период':esc(k?k.name:s.kind):'<span class="faint">Нет подписки — организация ещё ни разу не платила</span>')}
    ${acKv('Оплачено до',s&&s.paidTo?`${fmtD(s.paidTo)} · ${left>=0?`осталось ${left} ${plural(left,'день','дня','дней')}`:`просрочено ${-left} ${plural(-left,'день','дня','дней')}`}`:'—')}
    ${acKv('Пакет',`Занято ${seats.used} из ${seats.pack}${seats.used>seats.pack?` <span class="pill red">${ic('alert')}больше пакета</span>`:''}${subBar(seats.used,seats.pack)}`)}
    ${acKv('Память',`Занято ${subGb(m.used)} из ${subGb(m.limit)} ГБ${subBar(m.used,m.limit)}<div class="hint">входит в цену ${subGb(m.inc)} ГБ, куплено сверх ${subGb(m.extra)} ГБ</div>`)}
    ${acKv('Скидки',s?[k&&k.disc?`за срок ${k.disc} %`:'за срок нет',add?`дополнительная ${add} %`:'',s.firstPaid?'':`первый месяц ${SUB_P().first||50} %`].filter(Boolean).join(' · '):'—')}
    ${s&&s.next&&s.next.from>TODAY?acKv('Со следующего месяца',`пакет ${s.next.pack}, память сверх ${s.next.extraGb} ГБ — с ${fmtD(s.next.from)}`):''}
    ${renew?acKv('Продление на тот же срок',`<span class="tnum">${som(renew.total)}</span> · ${esc(k?k.name:'')} · пакет ${s.pack}`):''}</div></div>`}
function subWaitHtml(orgId){const ws=subPaysOf(orgId).filter(p=>p.status==='wait');if(!ws.length)return '';
  return ws.map(p=>`<div class="box" style="border-color:var(--${subPayLate(p)?'red':'blue'})"><h3>${ic('clock')} Чек на проверке</h3><div class="kv">${acKv('Что оплачено',esc(subPayWhat(p)))}${acKv('Вид и срок',`${esc(subKindName(p.kind))} · ${subPayTerm(p)}`)}${acKv('Пакет',`${p.pack}`)}${acKv('Память сверх',`${p.extraGb||0} ГБ`)}
    ${acKv('Прикрепил',`${esc(subWho(p.by))}<div class="aud">${fmtDT(p.at)}</div>`)}${acKv('Чек',subFileBtn(p))}${acKv('Доступ',p.open?'открыт до проверки чека':'не открыт: прошлый чек отклонён')}${subPayLate(p)?acKv('Срок проверки',`<span class="pill red">${ic('alert')}Ждёт проверки больше ${SUB_P().check||3} дней</span>`):''}</div>
    <h4 style="margin:12px 0 4px">Расчёт суммы</h4>${subLinesHtml(p.lines)}
    <div class="row" style="margin-top:12px;gap:8px;flex-wrap:wrap"><div class="grow"></div><button class="btn danger" data-subact="rej:${esc(p.id)}">${ic('ban','sm')}Отклонить</button><button class="btn cta" data-subact="ok:${esc(p.id)}">${ic('check','sm')}Подтвердить оплату</button></div></div>`).join('')}
function subPaysHtml(orgId){const ps=subPaysOf(orgId);
  return `<div class="box"><h3>История оплат</h3>${ps.length?`<div class="tbl-wrap"><table class="mini m-cards"><thead><tr><th>Дата</th><th>Что оплачено</th><th>Срок</th><th class="num">Сумма</th><th>Чек</th><th>Статус</th><th>Причина</th></tr></thead><tbody>${ps.map(p=>`<tr data-subact="pay:${esc(p.id)}" style="cursor:pointer"><td class="tnum">${fmtDT(p.at)}</td><td>${esc(subPayWhat(p))}</td><td>${subPayTerm(p)}</td><td class="num tnum">${p.what==='free'?'<span class="faint">без суммы</span>':som(p.sum)}</td><td>${p.file?ic('file','sm'):'<span class="faint">—</span>'}</td><td>${subPaySt(p)}</td><td>${p.status==='rej'||p.what==='free'||p.what==='admin'?esc(p.reason||''):''}</td></tr>`).join('')}</tbody></table></div>`:'<span class="faint">Оплат пока не было</span>'}</div>`}
function subHistHtml(orgId){const hs=HIST.filter(h=>h.ent==='sub'&&h.id===orgId).slice().sort((a,b)=>a.at<b.at?1:-1);return `<div class="box"><h3>История изменений</h3>${hs.length?acTl(hs):'<span class="faint">Изменений пока не было</span>'}</div>`}
function subOrgBody(orgId){const own=typeof subScreenHtml==='function'?subScreenHtml(orgId,{admin:true}):subSummaryHtml(orgId);return `${subWaitHtml(orgId)}${own}${typeof subScreenHtml==='function'?'':subPaysHtml(orgId)}${subHistHtml(orgId)}`}
function subOrgWin(orgId){const o=ORGS.find(x=>x.id===orgId);if(!o)return toast('Такой организации нет','alert',true);
  MODALS.filter(x=>x.o.subOrg===orgId).forEach(x=>x.close(true));
  openModal({size:'wide',subOrg:orgId,live:true,render:()=>({title:'Подписка организации',sub:`${esc(o.name)} · ${esc(subStatus(orgId))}`,body:subOrgBody(orgId),
    foot:`<button class="btn" data-subact="org:${esc(orgId)}">${ic('building','sm')}Открыть организацию</button><div class="grow"></div><button class="btn" data-subact="edit:${esc(orgId)}">${ic('edit','sm')}Изменить подписку</button><button class="btn cta" data-close>Готово</button>`,
    mount(el){if(typeof subScreenBind==='function')subScreenBind(el,orgId,{admin:true})}})})}
// Окно одной оплаты: расчёт и чек (нажатие на строку «Истории оплат»)
function subPayWin(p){MODALS.filter(x=>x.o.payWin===p.id).forEach(x=>x.close(true));openModal({size:'mid',payWin:p.id,render:()=>({title:esc(subPayWhat(p)),sub:`${esc(subOrgName(p.org))} · ${fmtDT(p.at)}`,
  body:`<div class="box"><div class="kv">${acKv('Статус',subPaySt(p))}${acKv('Вид и срок',`${esc(subKindName(p.kind))} · ${subPayTerm(p)}`)}${acKv('Пакет',String(p.pack))}${acKv('Память сверх',`${p.extraGb||0} ГБ`)}${acKv('Отправил',`${esc(subWho(p.by))}<div class="aud">${fmtDT(p.at)}</div>`)}${acKv('Чек',subFileBtn(p))}
    ${p.chkBy?acKv(p.status==='rej'?'Отклонил':'Подтвердил',`${esc(subWho(p.chkBy))}<div class="aud">${fmtDT(p.chkAt)}</div>`):''}${p.paidTo&&p.what!=='free'?acKv('Оплачено до',fmtD(p.paidTo)):''}${p.reason?acKv(p.status==='rej'?'Причина отклонения':'Причина',esc(p.reason),true):''}</div></div>
    <div class="box"><h3>Расчёт суммы</h3>${subLinesHtml(p.lines)}</div>`,
  foot:`<div class="grow"></div>${p.status==='wait'&&isAdmin()?`<button class="btn danger" data-subact="rej:${esc(p.id)}">${ic('ban','sm')}Отклонить</button><button class="btn cta" data-subact="ok:${esc(p.id)}">${ic('check','sm')}Подтвердить оплату</button>`:'<button class="btn cta" data-close>Готово</button>'}`})})}
const subRedraw=()=>{refreshAll();MODALS.filter(m=>m.o.subOrg||m.o.porg).forEach(m=>m.draw())};
// «Подтвердить оплату» (блок 6, пункт 3): «Число месяцев» из заявки и посчитанное «Оплачено до» можно поправить
function subPayOkDlg(p){const s=subOf(p.org),renew=p.what==='renew';const calc=n=>renew?subPaidToAfter(p.org,n,p.at.slice(0,10)):(s&&s.paidTo)||TODAY;
  openModal({form:true,state:{hand:false},render:m=>({title:'Подтвердить оплату',sub:`${esc(subOrgName(p.org))} · ${esc(subPayWhat(p))} · ${som(p.sum)}`,
    body:`<div class="form">${fld('Число месяцев',inp('so-m',String(p.months||0),`type="number" min="${renew?1:0}" max="36" step="1" inputmode="numeric" ${renew?'':'disabled'}`),{id:'so-m',hint:renew?'Подставлено из заявки, можно изменить':'Расширение и память — до конца оплаченного срока'})}
      ${fld('Оплачено до',inp('so-to',calc(p.months),'type="date"'),{req:true,id:'so-to',hint:renew?'Посчитано по числу месяцев, можно поправить':'Дата не меняется, если её не поправить'})}</div>
      <div class="box" style="margin-top:12px"><h3>Расчёт суммы</h3>${subLinesHtml(p.lines)}</div><div class="hint">Подписка начнёт действовать сразу, владельцы получат сообщение «Оплата подтверждена». Подтверждённую оплату назад не вернуть: ошибку исправляйте через «Изменить подписку» с причиной.</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="so-ok">Подтвердить оплату</button>',
    mount(el){const mi=$('#so-m',el),ti=$('#so-to',el);ti.oninput=()=>{m.state.hand=true};mi.oninput=()=>{const n=+mi.value;if(!m.state.hand&&n>0)ti.value=calc(n)};
      $('#so-ok',el).onclick=()=>{const n=+mi.value,to=ti.value;const ok=[setErr(el,'so-m',!renew||(n>=1&&n<=36&&Number.isInteger(n))?'':'От 1 до 36 месяцев'),setErr(el,'so-to',/^\d{4}-\d{2}-\d{2}$/.test(to)?'':'Укажите дату')].every(Boolean);if(!ok)return;
        if(!subPayOk(p.id,{months:renew?n:p.months,paidTo:to}))return toast('Оплату уже проверили','alert',true);m.close();MODALS.filter(x=>x.o.payWin).forEach(x=>x.close());subRedraw();toast(`Оплата подтверждена: подписка до ${fmtD(subOf(p.org).paidTo)}, владельцы получили сообщение`,'check')}}})})}
// «Отклонить» — причина обязательна, её видит организация
function subPayRejDlg(p){openModal({form:true,render:()=>({title:'Отклонить чек',sub:`${esc(subOrgName(p.org))} · ${esc(subPayWhat(p))} · ${som(p.sum)}`,
  body:`${fld('Причина',`<textarea class="inp" id="sr-why" style="min-height:72px" maxlength="500" placeholder="Например: сумма в чеке 2 000 сом, а нужно 3 000 сом"></textarea>`,{req:true,full:true,id:'sr-why'})}<div class="hint">Организация увидит причину на экране «Подписка», владельцы получат сообщение «Чек отклонён». ${subOf(p.org)&&subOf(p.org).paidTo>=TODAY?'Срок подписки ещё не прошёл — доступ остаётся открытым.':'Срок подписки прошёл — доступ, открытый по чеку, закроется.'} Новый чек доступ заранее не откроет.</div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn danger" id="sr-ok">Отклонить</button>',
  mount(el,m){$('#sr-ok',el).onclick=()=>{const w=val(el,'sr-why').trim();if(!setErr(el,'sr-why',w?'':'Укажите причину'))return;if(!subPayRej(p.id,w))return toast('Оплату уже проверили','alert',true);m.close();MODALS.filter(x=>x.o.payWin).forEach(x=>x.close());subRedraw();toast('Чек отклонён, владельцы получили сообщение','ban')}}})})}
// «Изменить подписку» (блок 6, пункт 4): вид, пакет, память сверх, «Оплачено до», доп. скидка (с пакета 160), причина обязательна; «Бесплатный период» — без оплаты
function subEditFields(s,pre){const p=SUB_P(),ks=SUB_KINDS().filter(k=>k.active||(s&&k.id===s.kind)).sort((a,b)=>a.order-b.order),big=(s?s.pack:10)>(p.extraOver||150);
  return `${fld('Вид подписки',sel(pre+'-k',ks.map(k=>[k.id,`${k.name} · скидка ${k.disc} %${k.active?'':' (выключен)'}`]),s?s.kind:(ks[0]||{}).id),{id:pre+'-k'})}
    ${fld('Пакет, мест',inp(pre+'-p',String(s?s.pack:p.step||10),`type="number" min="${p.step||10}" step="${p.step||10}" inputmode="numeric"`),{req:true,id:pre+'-p',hint:`Шаг ${p.step||10}`})}
    ${fld('Память сверх, ГБ',inp(pre+'-g',String(s?s.extraGb||0:0),'type="number" min="0" step="1" inputmode="numeric"'),{id:pre+'-g'})}
    ${fld('Оплачено до',inp(pre+'-to',s&&s.paidTo||addDays(TODAY,30),'type="date"'),{req:true,id:pre+'-to'})}
    ${fld('Дополнительная скидка, %',inp(pre+'-a',String(s&&s.addDisc||0),`type="number" min="0" max="100" step="1" inputmode="numeric" ${big?'':'disabled'}`),{id:pre+'-a',hint:`Доступно при пакете от ${(p.extraOver||150)+(p.step||10)}; складывается со скидкой за срок, на память не действует`})}`}
function subEditRead(el,pre,s){const p=SUB_P(),st=p.step||10,k=subKind(val(el,pre+'-k')),n=+val(el,pre+'-p'),g=+val(el,pre+'-g'),to=val(el,pre+'-to'),big=n>(p.extraOver||150),a=big?+val(el,pre+'-a'):0;
  const ok=[setErr(el,pre+'-p',Number.isInteger(n)&&n>=st&&n%st===0?'':`Пакет — число мест с шагом ${st}: ${st}, ${st*2}, ${st*3}…`),setErr(el,pre+'-g',Number.isInteger(g)&&g>=0?'':'Целое число ГБ, 0 и больше'),
    setErr(el,pre+'-to',/^\d{4}-\d{2}-\d{2}$/.test(to)?'':'Укажите дату'),setErr(el,pre+'-a',!big||(Number.isInteger(a)&&a>=0&&a+(k?k.disc:0)<=100)?'':'От 0 %; вместе со скидкой за срок — не больше 100 %')].every(Boolean);
  return ok?{kind:k?k.id:s&&s.kind,pack:n,extraGb:g,paidTo:to,addDisc:a}:null}
function subEditBind(el,pre){const pi=$('#'+pre+'-p',el),ai=$('#'+pre+'-a',el);if(pi&&ai)pi.oninput=()=>{const big=+pi.value>(SUB_P().extraOver||150);ai.disabled=!big;if(!big)ai.value='0'}}
function subEditDlg(orgId){const o=ORGS.find(x=>x.id===orgId);if(!o)return;const s=subOf(orgId),act=subActive(orgId);
  openModal({form:true,render:()=>({title:s?'Изменить подписку':'Поставить подписку',sub:`${esc(o.name)} · активных контрагентов ${act}`,
    body:`<div class="form">${subEditFields(s,'se')}<label class="check-row full"><input type="checkbox" id="se-free"><span class="grow">Бесплатный период<div class="hint">«Оплачено до» без оплаты; в «Истории оплат» — строка «Бесплатный период до …» без суммы</div></span></label>
      ${fld('Причина изменения',`<textarea class="inp" id="se-why" style="min-height:64px" maxlength="500" placeholder="Например: оплата наличными 20.11.2026"></textarea>`,{req:true,full:true,id:'se-why',hint:'Пишется в историю подписки и организации'})}</div>
      <div class="hint">Статус ставит система по дате и чекам. Новые цены и вид действуют с этой правки; уже оплаченные суммы не пересчитываются.</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="se-ok">Сохранить</button>',
    mount(el,m){subEditBind(el,'se');const fr=$('#se-free',el),wy=$('#se-why',el);fr.onchange=()=>{if(fr.checked&&!wy.value.trim())wy.value='Бесплатный период'};
      $('#se-ok',el).onclick=()=>{const x=subEditRead(el,'se',s);const w=wy.value.trim();if(!setErr(el,'se-why',w?'':'Укажите причину')||!x)return;
        if(x.pack<act&&!m.state.warned){m.state.warned=1;setErr(el,'se-p',`Активных контрагентов ${act} — больше пакета: новых добавить не смогут. Нажмите «Сохранить» ещё раз, если так и нужно`);return}
        if(fr.checked)x.free=true;if(!subSet(orgId,x,w))return toast('Изменений нет');m.close();subRedraw();toast(fr.checked?`Бесплатный период до ${fmtD(x.paidTo)}`:'Подписка изменена','check')}}})})}
// Блок «Подписка» в окне «Новая организация» (блок 6, пункт 4): можно не заполнять — тогда «Нет подписки»
const subNewOrgHtml=()=>`<details class="full box" id="no-sub" style="margin:0"><summary class="strong" style="cursor:pointer">Подписка <span class="hint" style="display:inline">— необязательно: без неё у организации «Нет подписки», владелец сначала увидит экран оплаты</span></summary><label class="check-row" style="margin-top:8px"><input type="checkbox" id="ns-on"><span class="grow">Поставить подписку сразу</span></label><div class="form" style="margin-top:8px">${subEditFields(null,'ns')}<label class="check-row full"><input type="checkbox" id="ns-free" checked><span class="grow">Бесплатный период</span></label></div></details>`;
const subNewOrgOk=el=>!$('#ns-on',el)||!$('#ns-on',el).checked||!!subEditRead(el,'ns',null);
function subNewOrgSave(el,orgId){const on=$('#ns-on',el);if(!on||!on.checked)return;const x=subEditRead(el,'ns',null);if(!x)return;const fr=$('#ns-free',el).checked;if(fr)x.free=true;subSet(orgId,x,fr?'Бесплатный период при создании организации':'Подписка при создании организации')}

/* ── «Виды подписок» (блок 6, пункт 5) ── */
const subKindUsed=id=>ORGS.filter(o=>{const s=subOf(o.id);return s&&s.kind===id}).length;
const subCfgLog=(what)=>log('subcfg','subs',what);
function subKindsPart(h,fresh){h.innerHTML=`<div class="note">${ic('info')}<span>Виды различаются только сроком и скидкой: все функции платформы есть в каждом виде. Организация видит виды карточками в окне оплаты — с ценой за контрагента в месяц и списком преимуществ. Вид, по которому есть подписки, не удаляется — его можно выключить: новые оплаты по нему недоступны, оплаченные сроки дорабатывают.</span></div>
  <div class="row" style="margin-bottom:8px"><div class="grow"></div><button class="btn cta" id="sk-add">${ic('plus','sm')}Вид подписки</button></div><div id="skg"></div>${subCfgHist()}`;
  $('#sk-add',h).onclick=()=>subKindDlg(null);
  grid($('#skg',h),{id:'adm-subkinds',rid:k=>k.id,cols:[{key:'order',label:'Порядок',type:'int',w:90,num:true,agg:'',val:k=>k.order},{key:'name',label:'Название',type:'text',w:160,val:k=>k.name,html:k=>`<span class="strong">${esc(k.name)}</span>`},
    {key:'months',label:'Срок, мес.',type:'int',w:100,num:true,agg:'',val:k=>k.months},{key:'disc',label:'Скидка, %',type:'int',w:100,num:true,agg:'',val:k=>k.disc},
    {key:'price',label:'Цена за контрагента в месяц',type:'money',w:150,num:true,agg:'',val:k=>subR2((SUB_P().cp||0)*(100-k.disc)/100)},{key:'perks',label:'Преимущества',type:'text',w:320,val:k=>(k.perks||[]).join('; ')},
    {key:'used',label:'Подписок',type:'int',w:100,num:true,val:k=>subKindUsed(k.id)},{key:'active',label:'Действует',type:'enum',w:120,val:k=>k.active?'Да':'Нет',html:k=>k.active?pill('Да',{Да:['green','check']}):pill('Нет',{Нет:['gray','ban']})}],
    rows:()=>SUB_KINDS(),title:'name',noun:['вид подписки','вида подписки','видов подписки'],sort:{key:'order',dir:1},ordered:true,simulateLoad:fresh,open:k=>subKindDlg(k),rowClass:k=>k.active?'':'muted',
    actions:k=>{const u=subKindUsed(k.id)||SUB_PAYS.some(p=>p.kind===k.id);return [{label:'Изменить',icon:'edit',run:()=>subKindDlg(k)},k.active?{label:'Выключить',icon:'ban',run:()=>{k.active=false;touch(k);subCfgLog(`Виды подписок: «${k.name}» выключен`);renderPage();toast('Вид выключен: новые оплаты по нему недоступны')}}:{label:'Включить',icon:'check',run:()=>{k.active=true;touch(k);subCfgLog(`Виды подписок: «${k.name}» включён`);renderPage();toast('Вид включён')}},{sep:true},
      {label:'Удалить',icon:'trash',danger:true,disabled:!!u,reason:u?'По этому виду есть подписки или оплаты — его можно только выключить':'',run:()=>confirmDlg({title:`Удалить вид «${esc(k.name)}»?`,text:'Подписок и оплат по нему нет.',ok:'Удалить',danger:true,run:()=>{const a=SUB_KINDS(),i=a.indexOf(k);if(i>=0)a.splice(i,1);subCfgLog(`Виды подписок: «${k.name}» удалён`);renderPage();toast('Вид удалён','trash')}})}]}})}
function subKindDlg(k){const nw=!k;openModal({form:true,render:()=>({title:nw?'Новый вид подписки':'Вид подписки',sub:nw?'Виды различаются только сроком и скидкой':esc(k.name),
  body:`<div class="form">${fld('Название',inp('sk-n',k?k.name:''),{req:true,full:true,id:'sk-n'})}${fld('Срок, месяцев',inp('sk-m',k?String(k.months):'','type="number" min="1" max="36" step="1" inputmode="numeric"'),{req:true,id:'sk-m'})}${fld('Скидка, %',inp('sk-d',k?String(k.disc):'0','type="number" min="0" max="90" step="1" inputmode="numeric"'),{req:true,id:'sk-d',hint:'На контрагентов и на память сверх'})}
    ${fld('Преимущества',`<textarea class="inp" id="sk-pk" style="min-height:84px" placeholder="Каждое с новой строки">${esc(k?(k.perks||[]).join('\n'):'')}</textarea>`,{full:true,id:'sk-pk',hint:'Организация видит их в карточке вида в окне оплаты; каждое — с новой строки'})}
    ${fld('Порядок показа',inp('sk-o',String(k?k.order:SUB_KINDS().reduce((a,x)=>Math.max(a,x.order||0),0)+1),'type="number" min="1" step="1" inputmode="numeric"'),{id:'sk-o'})}<label class="check-row"><input type="checkbox" id="sk-a" ${!k||k.active?'checked':''}><span class="grow">Действует</span></label></div>`,
  foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="sk-ok">Сохранить</button>',
  mount(el,m){$('#sk-ok',el).onclick=()=>{const n=val(el,'sk-n').trim(),mo=+val(el,'sk-m'),d=+val(el,'sk-d'),o=+val(el,'sk-o'),pk=$('#sk-pk',el).value.split('\n').map(x=>x.trim()).filter(Boolean),a=$('#sk-a',el).checked;
    const dup=SUB_KINDS().some(x=>x!==k&&x.name.toLowerCase()===n.toLowerCase());
    const ok=[setErr(el,'sk-n',!n?'Введите название':n.length>40?'Не длиннее 40 знаков':dup?'Такой вид уже есть':''),setErr(el,'sk-m',Number.isInteger(mo)&&mo>=1&&mo<=36?'':'От 1 до 36 месяцев'),setErr(el,'sk-d',Number.isInteger(d)&&d>=0&&d<=90?'':'От 0 до 90 %'),setErr(el,'sk-pk',pk.length<=10&&pk.every(x=>x.length<=120)?'':'Не больше 10 строк по 120 знаков'),setErr(el,'sk-o',Number.isInteger(o)&&o>=1?'':'Целое число от 1')].every(Boolean);if(!ok)return;
    if(nw){const id='k'+Date.now().toString(36);SUB_KINDS().push(born({id,name:n,months:mo,disc:d,perks:pk,order:o,active:a}));subCfgLog(`Виды подписок: добавлен «${n}» — ${mo} мес., скидка ${d} %`)}
    else{const ch=[];if(k.name!==n)ch.push(`название «${k.name}» → «${n}»`);if(k.months!==mo)ch.push(`срок ${k.months} → ${mo} мес.`);if(k.disc!==d)ch.push(`скидка ${k.disc} → ${d} %`);if((k.perks||[]).join('\n')!==pk.join('\n'))ch.push('преимущества');if(k.order!==o)ch.push(`порядок ${k.order} → ${o}`);if(k.active!==a)ch.push(a?'включён':'выключен');
      if(!ch.length){m.close();return toast('Изменений нет')}Object.assign(k,{name:n,months:mo,disc:d,perks:pk,order:o,active:a});touch(k);subCfgLog(`Виды подписок: «${n}» — ${ch.join(', ')}`)}
    m.close();renderPage();toast(nw?'Вид подписки добавлен':'Вид подписки сохранён')}}})})}

/* ── «Цены и реквизиты» (блок 6, пункт 6) ── */
const SUB_PF=[['cp','Цена за контрагента в месяц, сом',1,100000],['step','Шаг пакета, мест',1,1000],['gb','Цена 1 ГБ сверх в месяц, сом',0,100000],['baseGb','Включённая память на организацию, ГБ',0,1000],['cpMb','Память за место пакета, МБ',0,100000],['first','Скидка первого месяца, %',0,100],['extraOver','Дополнительная скидка — для пакета больше, мест',0,100000],['remind','Напоминать об оплате за, дней',1,60],['check','Срок проверки чека, дней',1,30]];
const SUB_RF=[['to','Получатель',true],['inn','ИНН получателя',false],['bank','Банк',true],['bik','БИК',true],['acc','Счёт',true],['purpose','Назначение платежа',true]];
function subCfgHist(){const hs=HIST.filter(h=>h.ent==='subcfg').slice().sort((a,b)=>a.at<b.at?1:-1).slice(0,50);return `<div class="box" style="margin-top:12px"><h3>История изменений</h3>${hs.length?acTl(hs):'<span class="faint">Изменений пока не было</span>'}</div>`}
function subPricesPart(h){const p=SUB_P(),r=p.req||{},v=k=>k==='baseGb'?(p.baseMb||0)/1000:p[k];
  h.innerHTML=`<div class="note">${ic('info')}<span>Новые цены действуют на новые оплаты; уже оплаченный срок не пересчитывается. Реквизиты видит владелец организации в окне оплаты; в назначении платежа {организация} и {ИНН} заменяются на её название и ИНН.</span></div>
  <div class="cols2"><div class="box"><h3>Цены и сроки</h3><div class="form">${SUB_PF.map(([k,l,mn,mx])=>fld(l,inp('sp-'+k,String(v(k)??''),`type="number" min="${mn}" max="${mx}" step="${k==='cp'||k==='gb'?'0.01':'1'}" inputmode="decimal"`),{req:true,id:'sp-'+k})).join('')}</div></div>
    <div class="box"><h3>Реквизиты платформы для оплаты</h3><div class="form">${SUB_RF.map(([k,l,rq])=>fld(l,k==='purpose'?`<textarea class="inp" id="sp-r-${k}" style="min-height:64px" maxlength="210">${esc(r[k]||'')}</textarea>`:inp('sp-r-'+k,r[k]||'',k==='bik'?'class="inp mono" maxlength="6" inputmode="numeric"':k==='inn'?'class="inp mono" maxlength="14" inputmode="numeric"':k==='acc'?'class="inp mono" maxlength="24"':''),{req:rq,full:k==='purpose'||k==='to',id:'sp-r-'+k,hint:k==='purpose'?'Подстановки: {организация}, {ИНН}':''})).join('')}</div>
    <div class="box" style="margin-top:8px"><span class="hint" style="margin:0">Пример для «${esc(ORG.name)}»: ${esc(subPurpose('o1'))}</span></div></div></div>
  <div class="row" style="margin-top:12px"><div class="grow"></div><button class="btn cta" id="sp-ok">${ic('check','sm')}Сохранить</button></div>${subCfgHist()}`;
  $('#sp-ok',h).onclick=()=>{const nv={},nr={};let ok=true;
    SUB_PF.forEach(([k,l,mn,mx])=>{const x=+val(h,'sp-'+k),bad=val(h,'sp-'+k)===''||isNaN(x)||x<mn||x>mx||((k!=='cp'&&k!=='gb')&&!Number.isInteger(x));ok=setErr(h,'sp-'+k,bad?`От ${mn} до ${mx}${k!=='cp'&&k!=='gb'?', целое':''}`:'')&&ok;nv[k]=x});
    SUB_RF.forEach(([k,l,rq])=>{const x=val(h,'sp-r-'+k).trim();let e=rq&&!x?'Заполните поле':'';if(!e&&k==='bik'&&x&&!/^\d{6}$/.test(x))e='БИК — 6 цифр';if(!e&&k==='inn'&&x&&!/^\d{14}$/.test(x))e='ИНН — 14 цифр';
      if(!e&&k==='purpose'){const bad=(x.match(/\{([^{}]*)\}/g)||[]).filter(t=>!['{организация}','{ИНН}'].includes(t));if(bad.length)e='Неизвестная подстановка: '+bad.join(', ')}ok=setErr(h,'sp-r-'+k,e)&&ok;nr[k]=x});
    if(!ok){const f=h.querySelector('.fld.bad input,.fld.bad textarea');if(f)f.focus();return toast('Исправьте отмеченные поля','alert',true)}
    const ch=[];SUB_PF.forEach(([k,l])=>{const was=v(k);if(was!==nv[k])ch.push(`${l}: ${was} → ${nv[k]}`)});SUB_RF.forEach(([k,l])=>{if((r[k]||'')!==nr[k])ch.push(`${l}: «${r[k]||''}» → «${nr[k]}»`)});
    if(!ch.length)return toast('Изменений нет');SUB_PF.forEach(([k])=>{if(k==='baseGb')p.baseMb=nv[k]*1000;else p[k]=nv[k]});p.req=Object.assign(p.req||{},nr);touch(p);subCfgLog('Цены и реквизиты: '+ch.join('; '));dbSoon();renderPage();toast('Цены и реквизиты сохранены')}}
const subPurpose=orgId=>{const o=subOrgObj(orgId)||{};return ((SUB_P().req||{}).purpose||'').replace(/\{организация\}/g,o.name||'').replace(/\{ИНН\}/g,o.inn||'')};

/* ── Колокольчик и Telegram: напоминания и повтор о чеках (задачи «Подписки: …», блок 4, пункт 3; блок 6, пункт 3) ── */
// В макете задача по расписанию срабатывает при открытии «Запусков» и вкладки «Подписки»: одно событие — одна строка у человека в день (ключ с датой)
function subDaily(){if(SUBS_DEMO)return;const d=TODAY;ORGS.forEach(o=>{const t=subRemindText(o.id);if(!t)return;const s=subOf(o.id);
    if(o===ORG||o.self)subOwners(o.id).forEach(u=>{if(typeof bellPut==='function')bellPut(u.id,{kind:'other',ev:'sub',open:{k:'sub',id:o.id},text:t,key:`subRemind:${o.id}:${d}`},true)})});
  SUB_PAYS.filter(p=>p.status==='wait'&&diffDays(d,p.at.slice(0,10))>=1).forEach(p=>{if(typeof bellPut==='function')bellPut('admin',{kind:'other',ev:'subCheck',open:{k:'sub_check',id:p.org},text:subTpl('tgSubCheckWait',{организация:subOrgName(p.org),сумма:som(p.sum),дней:diffDays(d,p.at.slice(0,10))}),key:`subCheckWait:${p.id}:${d}`,at:d+' 09:00'},true)})}
// Нажатие на строку колокольчика: владельцу — экран «Подписка» (поток И), администратору — окно «Подписка организации»
function subBellGo(o){if(o.k==='sub_check')return subOrgWin(o.id);return go('org','sub')}

/* ── Действия из окон (кнопки с data-subact) ── */
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-subact]');if(!b)return;const[a,id]=b.dataset.subact.split(':');const p=SUB_PAYS.find(x=>x.id===id);
  if(a==='ok'&&p&&isAdmin()){e.stopPropagation();return subPayOkDlg(p)}if(a==='rej'&&p&&isAdmin()){e.stopPropagation();return subPayRejDlg(p)}
  if(a==='file'&&p&&p.file){e.stopPropagation();return fileView([{id:p.id,name:p.file.name,size:p.file.size}],0,{sub:()=>`Чек подписки · ${esc(subOrgName(p.org))} · ${fmtDT(p.at)}`})}
  if(a==='pay'&&p){e.stopPropagation();return subPayWin(p)}if(a==='edit'&&isAdmin())return subEditDlg(id);if(a==='org'&&isAdmin())return orgCard(id)},true);
