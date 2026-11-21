'use strict';
// Экран «Подписка» владельца, окно оплаты с чеком, полоса «Подписка оплачена до …» и закрытый доступ
// (доработки 20.11.2026, блок 5; блок 4, пункты 3–6; блок 2, пункт 5; пакет 2, блок 6; этап 0, П8, поток И).
// Модель, расчёт суммы и заявка с чеком — src/js/core/subs.js (поток Т): здесь только показ и вызовы subCalc, subPaySend, subPayFile.
// Тот же экран — в окне «Подписка организации» Админки (subOrgWin, поток Т): subScreenHtml(orgId,{admin:true}) — без кнопок оплаты.

const subMine=()=>!isAdmin()&&!SUBS_DEMO&&!!me()&&me().role==='owner';
// Доступ организации закрыт по подписке (блок 4, пункты 4–5): владелец видит только «Подписку», остальные сотрудники — «Доступ закрыт»
const subLock=()=>!isAdmin()&&!SUBS_DEMO&&!!ORG&&subClosed(ORG.id);
const SUB_CLOSED_T='Доступ закрыт: подписка организации не оплачена. Обратитесь к владельцу организации.';
const SUB_CLOSED_MOD={id:'closed',title:'Доступ закрыт',short:'Доступ закрыт',icon:'lock',desc:'Подписка организации не оплачена: работать можно после оплаты',
  render:b=>{b.innerHTML=`<div class="state fe">${ic('lock','lg')}<b>Доступ закрыт</b><span>Подписка организации не оплачена. Обратитесь к владельцу организации: доступ откроется, как только он оплатит подписку. Данные организации сохранены.</span></div>`}};
// Список модулей при закрытом доступе (registry.js → mods)
function subLockMods(){if(!subLock())return null;return me().role==='owner'?BIZ.filter(m=>m.id==='org'):[SUB_CLOSED_MOD]}
// Вкладки «Моей организации»: «Подписка» — только владельцам (блок 5, пункт 1); при закрытом доступе — только она
function orgTabs(){const sub={id:'sub',label:'Подписка',icon:'wallet'};if(subLock()&&me().role==='owner')return [sub];
  return [{id:'main',label:'Основное',icon:'landmark'},{id:'policy',label:'Учётная политика',icon:'sliders'},{id:'settings',label:'Настройки',icon:'gauge'},subMine()?sub:null]}

/* ── Экран «Подписка» (блок 5, пункт 2). «Подписка оплачена до …» у владельца — только полоса над экраном (subBanHtml),
   в окне «Подписка организации» Админки полосы нет — пометка стоит в окне (ТЗ, блок 4, пункт 3, правка ed192) ── */
const subKindLabel=s=>!s?'Нет подписки':s.free?`Бесплатный период до ${fmtD(s.paidTo)}`:((subKind(s.kind)||{}).name||s.kind);
const subBarHtml=(used,lim)=>{const p=lim&&isFinite(lim)?Math.round(used/lim*100):0;return `<div class="bar sub-bar ${p>=100?'red':p>=80?'yellow':''}"><i style="width:${Math.min(100,p)}%"></i></div>`};
const subDays=n=>`${n} ${plural(n,'день','дня','дней')}`;
function subScreenHtml(orgId,o={}){orgId=orgId||ORG.id;const s=subOf(orgId),st=subStatus(orgId),seats=subSeats(orgId),m=subMem(orgId),k=s&&subKind(s.kind),left=subDaysLeft(orgId),w=subWait(orgId),p=SUB_P();
  const add=s&&s.pack>(p.extraOver||150)?s.addDisc||0:0,own=!o.admin&&subMine(),closed=subClosed(orgId),renew=s?subCalc({orgId,what:'renew',kind:s.kind,pack:s.pack,extraGb:s.extraGb}):null;
  const wTxt=w?`${esc(subPayWhatOwn(w))}, ${som(w.sum)} · отправлен ${fmtDT(w.at)}`:'';
  const head=closed&&!w?`<div class="note bad">${ic('lock')}<span>${s?`Подписка закончилась ${fmtD(s.paidTo)}: доступ сотрудников закрыт до оплаты.`:'У организации ещё нет подписки: программа откроется после первой оплаты.'} ${subLastRej(orgId)?'Прошлый чек отклонён, поэтому после нового чека доступ откроется, когда администратор подтвердит оплату.':'Оплатите и прикрепите чек — доступ откроется сразу и останется открытым, пока администратор проверяет оплату.'} Данные не удаляются.</span></div>`
    :st==='Скоро истекает'&&o.admin?`<div class="note warn">${ic('clock')}<span>Подписка оплачена до ${fmtD(s.paidTo)}. Продлите её, чтобы доступ не закрылся.</span></div>`:'';
  const waitBox=w&&!o.admin?`<div class="note">${ic('clock')}<span><b>Чек на проверке:</b> ${wTxt}. ${w.open||!closed?'Доступ открыт, пока администратор проверяет оплату.':'Прошлый чек был отклонён, поэтому доступ откроется после проверки этого чека.'} Новая оплата — после проверки.${own?` <button type="button" class="linkbtn" data-subown="file:${esc(w.id)}">Заменить файл чека</button>`:''}</span></div>`:'';
  const last=subPaysOf(orgId)[0],again=!o.admin&&last&&subAgainOk(last)?`<div class="note bad">${ic('ban')}<span><b>Чек отклонён</b> (${esc(subPayWhatOwn(last))}, ${som(last.sum)}, отправлен ${fmtDT(last.at)}). Причина: ${esc(last.reason||'—')}${own?` <button type="button" class="linkbtn" data-subown="again:${esc(last.id)}">Прикрепить другой чек</button>`:''}</span></div>`:'';
  const cards=`<div class="sub-cards">
    <div class="box sub-c"><div class="sub-h">${ic('calendar','sm')}Срок</div><div class="sub-v">${s&&s.paidTo?`Оплачено до ${fmtD(s.paidTo)}`:'Не оплачено'}</div>
      <div class="hint">${s&&s.paidTo?left>=0?`Осталось ${subDays(left)}${left===0?' — сегодня последний день':''}`:`Просрочено на ${subDays(-left)}`:'Организация ещё ни разу не платила'}</div>
      ${s&&s.next&&s.next.from>TODAY?`<div class="hint">Со следующего месяца (с ${fmtD(s.next.from)}): пакет ${s.next.pack}, память сверх ${s.next.extraGb} ГБ</div>`:''}</div>
    <div class="box sub-c"><div class="sub-h">${ic('building','sm')}Пакет</div><div class="sub-v">Занято ${seats.used} из ${seats.pack}</div>${subBarHtml(seats.used,seats.pack)}
      <div class="hint">${seats.pack?seats.used>seats.pack?`<span class="red">Контрагентов больше, чем мест: новых добавить нельзя</span>`:`Свободно ${seats.free} ${plural(seats.free,'место','места','мест')} · пакет — по ${p.step||10} контрагентов`:'Пакета нет'}</div></div>
    <div class="box sub-c"><div class="sub-h">${ic('folder','sm')}Память</div><div class="sub-v">Занято ${subGb(m.used)} из ${subGb(m.limit)} ГБ</div>${subBarHtml(m.used,m.limit)}
      <div class="hint">В цену входит ${subGb(m.inc)} ГБ: ${subGb(p.baseMb||0)} ГБ на организацию и ${fmtM(p.cpMb||0,false)} МБ за место пакета${m.extra?` · куплено сверх ${subGb(m.extra)} ГБ`:''}</div></div>
    <div class="box sub-c"><div class="sub-h">${ic('gift','sm')}Скидки</div><div class="sub-v">${k&&k.disc?`За срок ${k.disc} %`:'За срок — нет'}</div>
      <div class="hint">${[k&&k.disc?`${esc(k.name)}: ${fmtM(subR2((p.cp||0)*(100-k.disc)/100))} сом за контрагента в месяц вместо ${fmtM(p.cp||0)}`:'Скидка за срок — при оплате на 3, 6, 9 или 12 месяцев',add?`<b>Дополнительная скидка ${add} %</b> — на контрагентов`:'',s&&!s.firstPaid?`Скидка первого месяца ${p.first||50} %`:''].filter(Boolean).join('<br>')}</div></div></div>`;
  const btns=own||renew?`<div class="row sub-btns">${renew?`<span class="hint grow">Продление на тот же срок и пакет — ${som(renew.total)}</span>`:'<div class="grow"></div>'}${own?`
    <button class="btn" data-subpay="mem" ${w||closed?'disabled':''} title="${w?'Дождитесь проверки прошлого чека':closed?'Сначала оплатите подписку':'Докупить память сверх включённой'}">${ic('folder','sm')}Купить память</button>
    <button class="btn" data-subpay="grow" ${w||closed?'disabled':''} title="${w?'Дождитесь проверки прошлого чека':closed?'Сначала оплатите подписку':'Больше мест для активных контрагентов'}">${ic('building','sm')}Расширить пакет</button>
    <button class="btn cta" data-subpay="renew" ${w?'disabled title="Дождитесь проверки прошлого чека"':''}>${ic('wallet','sm')}${s?'Продлить':'Оплатить подписку'}</button>`:''}</div>`:'';
  return `${head}${waitBox}${again}<div class="box sub-top"><div class="row" style="gap:10px;flex-wrap:wrap;align-items:center"><h3 style="margin:0">${esc(subKindLabel(s))}</h3>${pill(st,SUB_PILL)}<div class="grow"></div>${k&&!s.free?`<span class="muted">${fmtM(subR2((p.cp||0)*(100-(k.disc||0))/100))} сом за контрагента в месяц</span>`:''}</div>${btns}</div>
    ${cards}<div class="box"><h3>История оплат</h3><div class="sub-pays"></div><span class="hint">Нажмите на строку — откроется оплата с расчётом и чеком${own?'; у отклонённой — «Прикрепить другой чек»':''}</span></div>`}
// Что оплачено — словами «Истории оплат» (блок 5, пункт 2): продление, расширение пакета, память
const subPayWhatOwn=p=>typeof subPayWhat==='function'?subPayWhat(p):SUB_WHAT[p.what]||p.what;
const subPayTermOwn=p=>p.what==='free'?`до ${fmtD(p.paidTo)}`:p.months?`${p.months} мес.`:'—';
// «Прикрепить другой чек» — у последней оплаты, если она отклонена и нового чека нет (блок 5, пункт 6)
// Последняя проверенная оплата отклонена: новый чек доступ заранее не открывает (блок 4, пункт 6; правило subPaySend)
const subLastRej=orgId=>{const l=subPaysOf(orgId).find(x=>x.status!=='wait'&&x.what!=='admin'&&x.what!=='free');return !!l&&l.status==='rej'};
const subAgainOk=p=>p.status==='rej'&&!subWait(p.org)&&subPaysOf(p.org)[0]===p;
const SUB_PAY_PILL={'Ждёт подтверждения':['blue','clock'],'Подтверждена':['green','check'],'Отклонена':['red','ban']};
function subScreenBind(el,orgId,o={}){orgId=orgId||ORG.id;const h=$('.sub-pays',el);if(!h)return;const own=!o.admin&&subMine();
  grid(h,{id:o.admin?'adm-sub-pays':'sub-pays',rid:p=>p.id,audit:false,search:false,size:25,title:'what',noun:['оплата','оплаты','оплат'],sort:{key:'at',dir:-1},rows:()=>subPaysOf(orgId),
    empty:{icon:'wallet',title:'Оплат пока не было',text:own?'Нажмите «Оплатить подписку», выберите вид и пакет и прикрепите чек':''},
    cols:[{key:'at',label:'Дата',type:'datetime',w:140,val:p=>p.at},{key:'what',label:'Что оплачено',type:'text',w:240,val:p=>subPayWhatOwn(p)},{key:'term',label:'Срок',type:'text',w:110,val:p=>subPayTermOwn(p)},
      {key:'sum',label:'Сумма',type:'money',w:110,num:true,val:p=>p.what==='free'?null:p.sum},
      {key:'file',label:'Чек',type:'text',w:170,val:p=>p.file?p.file.name:'',html:p=>p.file?`<button type="button" class="linkbtn" data-subact="file:${esc(p.id)}">${ic('file','sm')}${esc(p.file.name)}</button>`:'<span class="faint">—</span>'},
      {key:'st',label:'Статус',type:'enum',w:180,val:p=>SUB_PAY_ST[p.status]||p.status,html:p=>pill(SUB_PAY_ST[p.status]||p.status,SUB_PAY_PILL)},
      {key:'reason',label:'Причина',type:'text',w:240,val:p=>p.status==='rej'?p.reason||'':''}],
    open:p=>o.admin&&typeof subPayWin==='function'?subPayWin(p):subPayView(p),
    actions:p=>[{label:'Открыть',icon:'eye',run:()=>o.admin&&typeof subPayWin==='function'?subPayWin(p):subPayView(p)},
      ...(own&&subAgainOk(p)?[{label:'Прикрепить другой чек',icon:'upload',run:()=>subPayDlg(p.what,{pre:p})}]:[]),
      ...(own&&p.status==='wait'?[{label:'Заменить файл чека',icon:'refresh',run:()=>subFileDlg(p)}]:[])]});
  $$('[data-subown]',el).forEach(b=>b.onclick=()=>{const[a,id]=b.dataset.subown.split(':');const p=SUB_PAYS.find(x=>x.id===id);if(a==='file'&&p)subFileDlg(p);if(a==='again'&&p)subPayDlg(p.what,{pre:p})})}
function renderOrgSub(body){if(!subMine())return void(body.innerHTML=`<div class="note">${ic('lock')}<span>Подписку видит и оплачивает только владелец организации.</span></div>`);
  body.innerHTML=subScreenHtml(ORG.id);subScreenBind(body,ORG.id)}

/* ── Окно одной оплаты у владельца: расчёт и чек; у отклонённой — «Прикрепить другой чек» (блок 5, пункты 2, 5, 6) ── */
function subPayView(p){MODALS.filter(x=>x.o.subView===p.id).forEach(x=>x.close(true));const own=subMine()&&p.org===ORG.id;
  const lines=p.lines&&p.lines.length?`<div class="sub-calc">${p.lines.map(l=>`<div class="${l.label==='Итого к оплате'||l.total?'tot':''}"><span>${esc(l.label)}</span><span class="tnum">${som(l.sum)}</span></div>`).join('')}</div>`:'<span class="faint">Без суммы</span>';
  openModal({size:'mid',subView:p.id,render:()=>({title:esc(subPayWhatOwn(p)),sub:`${fmtDT(p.at)} · ${esc(SUB_PAY_ST[p.status]||p.status)}`,
    body:`${p.status==='rej'?`<div class="note bad">${ic('ban')}<span><b>Чек отклонён.</b> Причина: ${esc(p.reason||'—')}</span></div>`:p.status==='wait'?`<div class="note">${ic('clock')}<span>Администратор проверяет оплату — обычно до конца ${SUB_P().check||3}-го дня после отправки. ${p.open||!subClosed(p.org)?'Доступ открыт до проверки.':'Доступ откроется после проверки.'}</span></div>`:''}
      <div class="box"><div class="kv">${acKv('Статус',pill(SUB_PAY_ST[p.status]||p.status,SUB_PAY_PILL))}${acKv('Вид и срок',`${esc((subKind(p.kind)||{}).name||p.kind||'—')} · ${subPayTermOwn(p)}`)}${acKv('Пакет',String(p.pack||'—'))}${acKv('Память сверх',`${p.extraGb||0} ГБ`)}
        ${acKv('Отправил',`${esc(typeof subWho==='function'?subWho(p.by):whoName(p.by))}<div class="aud">${fmtDT(p.at)}</div>`)}${acKv('Чек',p.file?`<button type="button" class="linkbtn" data-subact="file:${esc(p.id)}">${ic('file','sm')}${esc(p.file.name)}</button>`:'<span class="faint">нет</span>')}
        ${p.chkAt?acKv(p.status==='rej'?'Отклонено':'Подтверждено',fmtDT(p.chkAt)):''}${p.paidTo&&p.what!=='free'&&p.status==='ok'?acKv('Оплачено до',fmtD(p.paidTo)):''}${p.what==='free'&&p.reason?acKv('Причина',esc(p.reason),1):''}</div></div>
      <div class="box"><h3>Расчёт суммы</h3>${lines}</div>`,
    foot:`<div class="grow"></div>${own&&p.status==='wait'?`<button class="btn" id="spv-file">${ic('refresh','sm')}Заменить файл чека</button>`:''}${own&&subAgainOk(p)?`<button class="btn cta" id="spv-again">${ic('upload','sm')}Прикрепить другой чек</button>`:''}<button class="btn ${own&&subAgainOk(p)?'':'cta'}" data-close>Готово</button>`,
    mount(el,m){const f=$('#spv-file',el);if(f)f.onclick=()=>subFileDlg(p,()=>m.draw());const a=$('#spv-again',el);if(a)a.onclick=()=>{m.close();subPayDlg(p.what,{pre:p})}}})})}

/* ── Файл чека: один, PDF или фото JPG, PNG до 20 МБ; тип — по содержимому, а не по расширению (блок 5, пункт 3) ── */
const SUB_FILE_MB=20;
async function subFileErr(f){if(!f)return 'Прикрепите чек об оплате';if(f.size>SUB_FILE_MB*1048576)return `Файл больше ${SUB_FILE_MB} МБ: сожмите фото или прикрепите PDF`;if(!f.size)return 'Файл пустой: выберите другой';
  try{const b=new Uint8Array(await f.slice(0,8).arrayBuffer()),t=String.fromCharCode(...b.slice(0,5));
    if(t==='%PDF-'||b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF||b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47&&b[4]===0x0D&&b[5]===0x0A&&b[6]===0x1A&&b[7]===0x0A)return ''}catch(e){}
  return 'Это не PDF и не фото JPG или PNG: прикрепите чек в одном из этих форматов'}
const subFileType=f=>/\.pdf$/i.test(f.name)?'application/pdf':/\.png$/i.test(f.name)?'image/png':'image/jpeg';
const subDropHtml=id=>`<label class="drop" id="${id}-drop" tabindex="0">${ic('upload')}<span><b>Перетащите чек сюда</b> или нажмите, чтобы выбрать файл</span><span class="hint">Один файл: PDF или фото JPG, PNG, до ${SUB_FILE_MB} МБ</span><input type="file" id="${id}" accept="application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png" hidden></label><div class="sub-file" id="${id}-x" hidden></div>`;
// Выбор файла чека: перетаскивание или выбор, проверка по содержимому; on(file|null)
function subDropBind(el,id,on){const inp=$('#'+id,el),dz=$('#'+id+'-drop',el),box=$('#'+id+'-x',el);
  const take=async f=>{const e=await subFileErr(f);setErr(el,id+'-w',e);if(e){inp.value='';return on(null)}box.hidden=false;dz.hidden=true;
    box.innerHTML=`<div class="li" style="cursor:default">${ic('file')}<div class="grow"><div class="t1">${esc(f.name)}</div><div class="t2">${esc(fext(f.name))} · ${fmtSize(f.size)}</div></div><button type="button" class="btn sm ghost" id="${id}-rm">${ic('x','sm')}Убрать</button></div>`;
    $('#'+id+'-rm',el).onclick=()=>{inp.value='';box.hidden=true;dz.hidden=false;on(null)};on(f)};
  inp.onchange=()=>{if(inp.files.length>1)return setErr(el,id+'-w','Прикрепите один файл');take(inp.files[0])};
  dz.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inp.click()}};
  dz.ondragover=e=>{e.preventDefault();dz.classList.add('over')};dz.ondragleave=()=>dz.classList.remove('over');
  dz.ondrop=e=>{e.preventDefault();dz.classList.remove('over');const fs=[...(e.dataTransfer.files||[])];if(fs.length!==1)return setErr(el,id+'-w','Прикрепите один файл');take(fs[0])}}
// «Заменить файл чека» до проверки (блок 5, пункт 5)
function subFileDlg(p,done){if(!p||p.status!=='wait')return toast('Чек уже проверен: заменить файл нельзя','alert',true);let file=null;
  openModal({form:true,render:()=>({title:'Заменить файл чека',sub:`${esc(subPayWhatOwn(p))} · ${som(p.sum)}`,body:`${p.file?`<div class="hint" style="margin-bottom:8px">Сейчас: ${esc(p.file.name)}</div>`:''}${fld('Новый файл чека',subDropHtml('sfd-f'),{full:true,id:'sfd-f-w'})}`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="sfd-ok">${ic('check','sm')}Заменить</button>`,
    mount(el,m){subDropBind(el,'sfd-f',f=>file=f);$('#sfd-ok',el).onclick=()=>{if(!file)return setErr(el,'sfd-f-w','Прикрепите новый файл чека');
      if(!subPayFile(p.id,{name:file.name,size:file.size,type:subFileType(file)}))return toast('Чек уже проверен: заменить файл нельзя','alert',true);
      m.close();refreshAll();done&&done();toast('Файл чека заменён','check')}}})})}

/* ── Окно оплаты (блок 5, пункты 3–5; блок 3, пункт 3): всё в одном окне сверху вниз ── */
// mode: renew — «Продлить»; grow — «Расширить пакет»; mem — «Купить память». o.pre — отклонённая оплата: «Прикрепить другой чек» с теми же значениями
function subPayDlg(mode,o={}){const orgId=o.orgId||ORG.id;
  if(!subMine())return toast('Подписку оплачивает владелец организации','lock',true);
  if(subWait(orgId))return toast('Дождитесь проверки прошлого чека: новая оплата — после проверки','clock',true);
  const s=subOf(orgId),p=SUB_P(),step=p.step||10,act=subActive(orgId),seats=subSeats(orgId),m0=subMem(orgId),left=subMonthsLeft(orgId),pre=o.pre||null;
  if(mode!=='renew'&&(!s||subClosed(orgId))){toast('Сначала продлите подписку: расширить можно только действующую','info');mode='renew'}
  const kinds=SUB_KINDS().filter(k=>k.active||s&&k.id===s.kind).sort((a,b)=>a.order-b.order);
  const minPack=Math.max(step,Math.ceil(act/step)*step);
  const st={what:mode,kind:pre&&pre.kind||(s&&subKind(s.kind)&&subKind(s.kind).active?s.kind:(kinds[0]||{}).id),
    pack:pre?pre.pack:mode==='grow'?Math.max(seats.pack+step,minPack):s?Math.max(s.pack,minPack):minPack,gb:pre?pre.extraGb||0:mode==='mem'?subExtraGb(orgId)+1:s?s.extraGb||0:0,
    from:pre&&pre.from==='next'&&left>1?'next':'now',file:null};
  const title={renew:s?'Продлить подписку':'Оплатить подписку',grow:'Расширить пакет',mem:'Купить память'}[mode];
  const lastRej=subLastRej(orgId);
  const req=p.req||{},purpose=String(req.purpose||'').replace(/\{организация\}/g,ORG.name).replace(/\{ИНН\}/g,ORG.inn||'');
  const kindCards=()=>`<div class="sub-kinds" role="radiogroup" aria-label="Вид подписки">${kinds.map(k=>{const on=k.id===st.kind,pr=subR2((p.cp||0)*(100-(k.disc||0))/100);
    return `<button type="button" class="sub-kind ${on?'on':''}" role="radio" aria-checked="${on}" data-sk="${esc(k.id)}"><span class="sk-n">${esc(k.name)}${s&&s.kind===k.id?' <span class="pill sm">сейчас</span>':''}</span>
      <span class="sk-p"><b>${fmtM(pr)}</b> сом за контрагента в месяц</span><span class="sk-d">${k.disc?`скидка ${k.disc} %`:'без скидки за срок'} · ${k.months} мес.</span>
      ${(k.perks||[]).length?`<ul>${k.perks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</button>`}).join('')}</div>`;
  const whenSeg=()=>`<div class="seg" role="radiogroup" aria-label="Когда" id="sp-when">${[['now','Сейчас'],['next','Со следующего месяца']].map(([k,l])=>`<button type="button" role="radio" aria-checked="${st.from===k}" class="${st.from===k?'on':''}" data-when="${k}" ${k==='next'&&left<=1?'disabled title="Срок подписки кончается в этом месяце: новый размер укажите при продлении"':''}>${l}</button>`).join('')}</div>`;
  const calc=()=>subCalc({orgId,what:st.what,kind:st.what==='renew'?st.kind:s&&s.kind,pack:st.pack,extraGb:st.gb,from:st.from});
  // Ошибки значений: пакет — шаг 10 и не меньше активных; память — занятое должно помещаться (блок 3, пункты 1, 4)
  const errs=()=>{const e={};const k=subKind(st.kind);
    if(st.what==='renew'&&(!k||!k.active))e.kind='Выберите вид подписки';
    if(st.what!=='mem'){if(!Number.isInteger(st.pack)||st.pack<step||st.pack%step)e.pack=`Пакет — по ${step} контрагентов: ${step}, ${step*2}, ${step*3}…`;
      else if(st.pack<act)e.pack=`Сначала переведите в архив ${act-st.pack} ${plural(act-st.pack,'контрагента','контрагентов','контрагентов')}: активных ${act}`;
      else if(st.what==='grow'&&st.pack<=seats.pack)e.pack=`Новый пакет должен быть больше нынешнего: сейчас ${seats.pack}`}
    if(st.what!=='grow'){if(!Number.isInteger(st.gb)||st.gb<0)e.gb='Память сверх — целое число ГБ, 0 и больше';
      else if(st.what==='mem'&&st.gb<=subExtraGb(orgId))e.gb=`Укажите больше, чем сейчас: ${subExtraGb(orgId)} ГБ сверх`;
      else{const lim=(p.baseMb||0)+(p.cpMb||0)*(st.what==='renew'?st.pack:seats.pack)+st.gb*1000;if(lim<m0.used)e.gb=`Сначала удалите лишние файлы: занято ${subGb(m0.used)} ГБ, а с такой памятью лимит — ${subGb(lim)} ГБ`}}
    return e};
  const calcHtml=()=>{const e=errs();if(e.kind||e.pack||e.gb)return `<div class="hint">${esc(e.kind||e.pack||e.gb)}</div>`;const c=calc();
    const memAfter=(p.baseMb||0)+(p.cpMb||0)*(st.what==='renew'?st.pack:seats.pack)+st.gb*1000;
    return `<div class="sub-calc">${c.lines.map(l=>`<div class="${l.total?'tot':''}"><span>${esc(l.label)}</span><span class="tnum">${som(l.sum)}</span></div>`).join('')}</div>
      <div class="hint" style="margin-top:6px">${st.what==='renew'?`После проверки чека: ${esc((subKind(st.kind)||{}).name||'')}, оплачено до ${fmtD(subPaidToAfter(orgId,c.months,TODAY))}; пакет ${st.pack}, память ${subGb(memAfter)} ГБ`
        :st.from==='next'?`Со следующего месяца подписки: ${st.what==='grow'?`пакет ${st.pack}`:`память ${subGb(memAfter)} ГБ`}. За текущий месяц доплаты нет`
        :`${st.what==='grow'?`${st.pack-seats.pack} новых мест`:`Ещё ${st.gb-subExtraGb(orgId)} ГБ`} — сразу после отправки чека. Доплата за ${c.months} ${plural(c.months,'месяц','месяца','месяцев')}: текущий месяц подписки целиком${c.months>1?' и оставшиеся месяцы срока':''}`}</div>`};
  const sizeHtml=()=>st.what==='renew'?`<div class="form">${fld('Пакет, контрагентов',`<input class="inp tnum" type="number" id="sp-pack" min="${minPack}" step="${step}" value="${st.pack}" inputmode="numeric">`,{id:'sp-pack',hint:`Активных контрагентов: ${act} — пакет не меньше ${minPack}. В архиве место не занимают`})}
      ${fld('Память сверх, ГБ',`<input class="inp tnum" type="number" id="sp-gb" min="0" step="1" value="${st.gb}" inputmode="numeric">`,{id:'sp-gb',hint:`В цену входит ${subGb(p.baseMb||0)} ГБ и ${fmtM(p.cpMb||0,false)} МБ за место пакета; занято ${subGb(m0.used)} ГБ. ${fmtM(p.gb||0)} сом за ГБ в месяц, со скидкой за срок`})}</div>`
    :st.what==='grow'?`<div class="form">${fld('Новый пакет, контрагентов',`<input class="inp tnum" type="number" id="sp-pack" min="${seats.pack+step}" step="${step}" value="${st.pack}" inputmode="numeric">`,{id:'sp-pack',hint:`Сейчас пакет ${seats.pack}, занято ${seats.used}. Каждые ${step} мест добавляют ${subGb((p.cpMb||0)*step)} ГБ памяти`})}${fld('Когда',whenSeg(),{id:'sp-when'})}</div>`
    :`<div class="form">${fld('Память сверх, ГБ',`<input class="inp tnum" type="number" id="sp-gb" min="${subExtraGb(orgId)+1}" step="1" value="${st.gb}" inputmode="numeric">`,{id:'sp-gb',hint:`Сейчас сверх ${subExtraGb(orgId)} ГБ, лимит ${subGb(m0.limit)} ГБ, занято ${subGb(m0.used)} ГБ`})}${fld('Когда',whenSeg(),{id:'sp-when'})}</div>`;
  const reqRow=(k,v,mono)=>`<div class="sub-req"><span class="k">${k}</span><span class="v ${mono?'mono':''}">${esc(v||'—')}</span>${v?`<button type="button" class="icon-btn sm" data-cp="${esc(v)}" aria-label="Скопировать: ${esc(k)}" title="Скопировать">${ic('copy','sm')}</button>`:''}</div>`;
  openModal({form:true,size:'wide',render:()=>({title,sub:`${esc(ORG.name)}${s&&s.paidTo?` · оплачено до ${fmtD(s.paidTo)}`:''}`,
    body:`${pre?`<div class="note bad">${ic('ban')}<span><b>Прошлый чек отклонён.</b> Причина: ${esc(pre.reason||'—')}. Проверьте сумму и реквизиты и прикрепите другой чек — сумма посчитана заново.</span></div>`:''}
      ${st.what==='renew'&&subClosed(orgId)?`<div class="note ${lastRej?'warn':''}">${ic(lastRej?'alert':'info')}<span>${lastRej?'Прошлый чек был отклонён, поэтому доступ откроется после того, как администратор подтвердит оплату.':'Доступ откроется сразу после отправки чека и останется открытым, пока администратор проверяет оплату.'}</span></div>`:''}
      ${st.what!=='renew'?`<div class="note">${ic('info')}<span>Доплата считается за весь текущий месяц. Выгоднее брать пакет с запасом или расширить его со следующего месяца.</span></div>`:''}
      <div class="box"><h3>${st.what==='renew'?'1. Вид подписки':'1. Подписка'}</h3>${st.what==='renew'?`${kindCards()}<div class="err" id="sp-kind-e" hidden></div>`:`<div class="hint">${esc(subKindLabel(s))} · оплачено до ${fmtD(s.paidTo)} · месяцев срока, считая текущий: ${left}. Доплата — по цене этого вида</div>`}</div>
      <div class="box"><h3>2. ${st.what==='renew'?'Пакет и память':st.what==='grow'?'Пакет':'Память'}</h3>${sizeHtml()}</div>
      <div class="box"><h3>3. Расчёт</h3><div id="sp-calc">${calcHtml()}</div></div>
      <div class="box"><h3>4. Реквизиты для перевода</h3><div class="sub-reqs">${reqRow('Получатель',req.to)}${reqRow('ИНН получателя',req.inn,1)}${reqRow('Банк',req.bank)}${reqRow('БИК',req.bik,1)}${reqRow('Счёт',req.acc,1)}${reqRow('Назначение платежа',purpose)}</div>
        <div class="row" style="margin-top:8px"><span class="hint grow">Переведите сумму из «Итого к оплате» с назначением платежа как здесь</span><button type="button" class="btn sm" id="sp-cpall">${ic('copy','sm')}Скопировать всё</button></div></div>
      <div class="box"><h3>5. Чек об оплате</h3>${fld('',subDropHtml('sp-f'),{full:true,id:'sp-f-w'})}<span class="hint">Сумма, вид, пакет и память уйдут вместе с чеком — второй раз их вводить не нужно</span></div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="sp-ok">${ic('send','sm')}Отправить на проверку</button>`,
    mount(el,m){const re=()=>{$('#sp-calc',el).innerHTML=calcHtml()};
      const ks=$('.sub-kinds',el);if(ks)ks.onclick=e=>{const b=e.target.closest('[data-sk]');if(!b)return;st.kind=b.dataset.sk;$$('[data-sk]',el).forEach(x=>{const on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-checked',on)});$('#sp-kind-e',el).hidden=true;m.dirty=true;re()};
      const pk=$('#sp-pack',el),gb=$('#sp-gb',el);if(pk)pk.oninput=()=>{st.pack=+pk.value;setErr(el,'sp-pack','');re()};if(gb)gb.oninput=()=>{st.gb=+gb.value;setErr(el,'sp-gb','');re()};
      const wh=$('#sp-when',el);if(wh)wh.onclick=e=>{const b=e.target.closest('[data-when]');if(!b||b.disabled)return;st.from=b.dataset.when;$$('[data-when]',el).forEach(x=>{const on=x===b;x.classList.toggle('on',on);x.setAttribute('aria-checked',on)});re()};
      $$('[data-cp]',el).forEach(b=>b.onclick=()=>copyText(b.dataset.cp,'Скопировано'));
      $('#sp-cpall',el).onclick=()=>copyText([['Получатель',req.to],['ИНН',req.inn],['Банк',req.bank],['БИК',req.bik],['Счёт',req.acc],['Назначение платежа',purpose],['Сумма',errs().pack||errs().gb?'':som(calc().total)]].filter(x=>x[1]).map(x=>x.join(': ')).join('\n'),'Реквизиты скопированы');
      subDropBind(el,'sp-f',f=>{st.file=f;m.dirty=true});
      $('#sp-ok',el).onclick=()=>{const e=errs();const ok=[setErr(el,'sp-pack',e.pack||''),setErr(el,'sp-gb',e.gb||''),setErr(el,'sp-f-w',st.file?'':'Прикрепите чек об оплате')].every(Boolean);
        const ke=$('#sp-kind-e',el);if(ke){ke.hidden=!e.kind;ke.innerHTML=e.kind?ic('alert','sm')+`<span>${esc(e.kind)}</span>`:''}if(!ok||e.kind)return;
        if(calc().total<=0)return toast('Доплаты нет: выберите больший пакет или память, или «Сейчас»','alert',true);
        const wasClosed=subClosed(orgId),x=subPaySend(orgId,{what:st.what,kind:st.what==='renew'?st.kind:s.kind,pack:st.what==='mem'?seats.pack:st.pack,extraGb:st.what==='grow'?subExtraGb(orgId):st.gb,from:st.what==='renew'?'now':st.from,file:{name:st.file.name,size:st.file.size,type:subFileType(st.file)}});
        if(!x)return toast('Дождитесь проверки прошлого чека: новая оплата — после проверки','clock',true);
        m.close();refreshAll();toast(x.open||!wasClosed?'Чек отправлен. Доступ открыт, пока администратор проверяет оплату':'Чек отправлен. Доступ откроется после проверки оплаты','send')}}})})}

/* ── Полоса «Подписка оплачена до …» — владельцам за 7 дней до конца срока (блок 4, пункт 3) ── */
function subBanHtml(){if(!subMine()||subLock())return '';const s=subOf(ORG.id);if(!s||subStatus(ORG.id)!=='Скоро истекает')return '';
  return `<div class="note warn sub-ban" role="status">${ic('clock')}<span class="grow">Подписка оплачена до ${fmtD(s.paidTo)}. Продлите её, чтобы доступ не закрылся.</span><button class="btn sm cta" data-subpay="renew">${ic('wallet','sm')}Продлить</button></div>`}
document.addEventListener('click',e=>{const b=e.target.closest&&e.target.closest('[data-subpay]');if(!b||b.disabled)return;e.preventDefault();subPayDlg(b.dataset.subpay)});

/* ── Память заполнена: новые файлы не загружаются (блок 2, пункт 5) ── */
// true — окно показано, загрузку не начинать; у владельца — «Купить память», у сотрудника — «Обратитесь к владельцу организации»
function subMemFullDlg(){if(isAdmin()||SUBS_DEMO||!subOf(ORG.id))return false;const m=subMem(ORG.id);if(!isFinite(m.limit)||m.used<m.limit)return false;
  const own=subMine(),w=subWait(ORG.id);
  openModal({render:()=>({title:'Память организации заполнена',body:`<div class="note bad">${ic('folder')}<span>Память организации заполнена: занято ${subGb(m.used)} из ${subGb(m.limit)} ГБ. Купите память или удалите лишние файлы.</span></div><p class="muted" style="margin:10px 0 0">Просмотр и скачивание файлов работают как обычно.${own?'':' Обратитесь к владельцу организации: память докупает он.'}</p>`,
    foot:`<button class="btn" data-close>Закрыть</button><button class="btn" id="smf-files">${ic('folder','sm')}К файлам</button>${own?`<button class="btn cta" id="smf-buy" ${w?'disabled title="Дождитесь проверки прошлого чека"':''}>${ic('wallet','sm')}Купить память</button>`:''}`,
    mount(el,mm){$('#smf-files',el).onclick=()=>{mm.close();go('files')};const b=$('#smf-buy',el);if(b)b.onclick=()=>{mm.close();subPayDlg('mem')}}})});return true}
