'use strict';
// Реквизиты для переводов: счета организации и реквизиты сотрудников (решение заказчика 25.10.2026)
/* Счёт организации (ORG.accounts) одного из двух видов:
     {kind:'acc',bank,acc,bik,name,use,mainTax,mainFee} — «Расчётный счёт»;
     {kind:'phone',phone:{cc,digits},banks:[…],name,use,mainTax,mainFee} — «Перевод по номеру телефона».
   use — назначение: 'tax' (налоги), 'fee' (обслуживание), 'both' (по умолчанию). По одному «Основному» для налогов и для обслуживания:
   он подставляется в WhatsApp-напоминания и на страницу контрагента. name — получатель так, как его видит отправитель.
   Реквизит сотрудника (e.wallets): {kind:'acc',prov,num,name,main} — «Счёт или кошелёк» · {kind:'phone',phone,banks,name,main}. */
const RQ_USE=[['both','Налоги и обслуживание'],['tax','Налоги'],['fee','Обслуживание']];
const RQ_USE_L=Object.fromEntries(RQ_USE);
// Провайдеры для выбора: у перевода по номеру — только с «Переводы по номеру телефона»; уже выбранные остаются, даже если их отключили
const rqProvs=(ph,keep=[])=>DICT.banks.items.filter(x=>(x.active!==false&&(!ph||x.byPhone))||keep.includes(x.name)).map(x=>x.name);
const accUse=(a,p)=>!p||(a.use||'both')==='both'||a.use===p;
const orgAccs=p=>ORG.accounts.filter(a=>accUse(a,p));
const orgMain=p=>{const l=orgAccs(p);return l.find(a=>p==='fee'?a.mainFee:a.mainTax)||l[0]||null};
const accKey=a=>a.kind==='phone'?'ph:'+a.phone.digits:'acc:'+a.acc;
// Номер так, как его набирают в приложении банка: у номеров Кыргызстана — с нулём, «0555 123 456»
function phLocal(ph){if(!ph||!ph.digits)return '';const c=PH[ph.cc]||PH.KG;return c.cc==='KG'?'0'+applyMask(c.mask,ph.digits.slice(c.code.length)):fmtPhone(ph)}
const rqNum=a=>a.kind==='phone'?phLocal(a.phone):a.bank?a.acc:a.num;
const rqProv=a=>a.kind==='phone'?(a.banks||[]).join(', '):a.bank||a.prov||'';
const rqKindL=(a,org)=>a.kind==='phone'?'Перевод по номеру телефона':org?'Расчётный счёт':'Счёт или кошелёк';
// Текст для сообщения: «M-Bank: 0555 123 456» · «Перевод по номеру 0555 123 456 (M-Bank, Бакай Банк), получатель Асанов А.» · «Optima Bank: р/с …, БИК …, получатель ОсОО …»
function rqTxt(a){const nm=a.name?`, получатель ${a.name}`:'';
  if(a.kind==='phone')return `Перевод по номеру ${phLocal(a.phone)} (${(a.banks||[]).join(', ')})${nm}`;
  return a.bank?`${a.bank}: р/с ${a.acc}, БИК ${a.bik}${nm}`:`${a.prov}: ${a.num}`}
// Банк упоминается в реквизите: для «Используется» в справочнике и переименования
const rqHas=(a,n)=>a.kind==='phone'?(a.banks||[]).includes(n):(a.bank||a.prov)===n;
function rqRename(o,n){const f=a=>{if(a.kind==='phone')a.banks=(a.banks||[]).map(b=>b===o?n:b);else if(a.bank===o)a.bank=n;else if(a.prov===o)a.prov=n};ORG.accounts.forEach(f);EMP.forEach(e=>(e.wallets||[]).forEach(f))}
// Поля формы реквизита: вид, провайдеры (несколько — у перевода по номеру), номер, получатель
function rqKindSel(id,k,org){return `<div class="chipsel" id="${id}" role="group" aria-label="Вид реквизита">${[['acc',org?'Расчётный счёт':'Счёт или кошелёк'],['phone','Перевод по номеру телефона']].map(([v,l])=>`<button type="button" data-rqk="${v}" class="${k===v?'on':''}" aria-pressed="${k===v}">${esc(l)}</button>`).join('')}</div>`}
function rqBanksFld(id,sel){const l=rqProvs(true,sel);return `<div class="fl-list rq-banks" id="${id}" style="max-height:190px">${l.map(n=>`<label><input type="checkbox" value="${esc(n)}" ${sel.includes(n)?'checked':''}> <span>${esc(n)}</span></label>`).join('')}</div>`}
const rqBanksRead=(el,id)=>$$('#'+id+' input:checked',el).map(x=>x.value);
// После изменения или удаления счёта: «Основной» для налогов и для обслуживания — ровно один среди счетов с таким назначением
function rqMainFix(){[['tax','mainTax'],['fee','mainFee']].forEach(([p,k])=>{ORG.accounts.forEach(a=>{if(!accUse(a,p))a[k]=false});let seen=false;const l=orgAccs(p);l.forEach(a=>{if(a[k]){if(seen)a[k]=false;seen=true}});if(l.length&&!seen)l[0][k]=true})}
