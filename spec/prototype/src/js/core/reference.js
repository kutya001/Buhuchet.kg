'use strict';
// Справочники платформы из refDB.json, каталог видов отчётов, сроки, статусы
/* ═════════════ Platform dictionaries (Админка → Справочники платформы) ═════════════ */
/* Режимы, формы, органы, льготы, банки, категории, причины, УГНС — refDB.json → dictionaries */
const DICT=DB.ref.dictionaries;
// Налоги и обязательные платежи, ставки единого налога (ст. 423), ставки налога на имущество (ст. 379), размер бизнеса (ст. 4) — только для справки и сверки
const TAXES=DB.ref.taxes,EN_TABLE=DB.ref.enRates,PROP_RATES=DB.ref.propertyRates,BIZ_SIZE=DB.ref.bizSize,REF_NOTES=DB.ref.notes;
const ugK=x=>x.code||x.id;const ugT=x=>(x.code?x.code+' · ':'')+x.name;
const ugnsLabel=k=>{if(!k)return '';const u=DICT.ugns.items.find(x=>ugK(x)===k);return u?(u.code?u.code+' · ':'')+u.short:k};
const REGIME_FULL=new Proxy({},{get:(o,k)=>{const r=DICT.regimes.items.find(x=>x.name===k);return r?r.full:undefined}});
const PHONES=DB.ref.phoneCodes;
const PH=Object.fromEntries(PHONES.map(p=>[p.cc,p]));
function applyMask(mask,digits){let out='',i=0;for(const ch of mask){if(i>=digits.length)break;if(ch==='X'){out+=digits[i++]}else out+=ch}return out}
function fmtPhone(ph){if(!ph||!ph.digits)return '';const c=PH[ph.cc]||PH.KG;const local=ph.digits.slice(c.code.length);return `+${c.code} ${applyMask(c.mask,local)}`}

/* Production calendar KR (demo set; администратор вносит каждый год) */
const HOLIDAYS=DB.ref.holidays;
const WORK_SAT=new Set(DB.ref.workingSaturdays);
const holidayName=s=>HOLIDAYS[s]||HOLIDAYS[s.slice(5)]||'';
function isWorking(s){if(WORK_SAT.has(s))return true;const d=D(s).getUTCDay();if(d===0||d===6)return false;return !holidayName(s)}
function shiftWork(s){let x=s,n=0;while(!isWorking(x)&&n<20){x=addDays(x,1);n++}return x}

/* ═════════════ Report types catalog (единый каталог платформы) ═════════════ */
/* Ставки налога — единые для всех, ведёт администратор платформы в каталоге видов */
const EN_RATES=DB.ref.singleTaxRates;
const RATES=DB.ref.taxRates;
const KIND_L={regime:'Режимный',cross:'Сквозной',internal:'Внутренний'};
const RT=DB.ref.reportTypes;
const T=Object.fromEntries(RT.map(t=>[t.id,t]));
// «Что нужно сделать»: sub — «Сдача», pay — «Уплата», both — «Сдача + уплата»; sum/payOnly are derived from it.
const ACT_L={sub:'Сдача',pay:'Уплата',both:'Сдача + уплата'};const ACT_IN={'сдача':'sub','уплата':'pay','сдача + уплата':'both','сдача+уплата':'both'};
const ACTF={sub:{sum:false,payOnly:false},pay:{sum:true,payOnly:true},both:{sum:true,payOnly:false}};


function setAct(t,a){t.act=a;Object.assign(t,ACTF[a]);if(a==='sub')t.pays=[];else if(!t.pays||!t.pays.length)t.pays=[{n:t.name,to:t.organ,kbk:''}];return t}

// A report keeps the «Что нужно сделать» it was created with (r.act is stamped when the type changes later).
function tR(r){return Object.assign(Object.create(T[r.t]),ACTF[r.act||T[r.t].act],{act:r.act||T[r.t].act})}
const actOf=r=>r.act||T[r.t].act;
const actPill=(a,sm)=>`<span class="pill actp act-${a}${sm?' sm':''}">${a!=='pay'?ic('file','sm'):''}${a!=='sub'?ic('coins','sm'):''}${ACT_L[a]}</span>`;
const paysTxt=t=>{const ps=t.pays||[];return ps.map(p=>p.n+(p.to&&(ps.length>1||p.to!==t.organ)?` (${p.to})`:'')).join('; ')};
const PER_LABEL={M:'Месяц',Q:'Квартал',H:'Полугодие',Y:'Год'};
const ROM2=['I','II'];
const ROM=['I','II','III','IV'];
const instTxt=t=>Array.isArray(t.inst)&&t.inst.length?t.inst.map(([m,d])=>`${String(d).padStart(2,'0')}.${String(m).padStart(2,'0')}`).join('; '):'';
const instIn=v=>{if(!v||!v.trim())return [];const a=v.split(/[;,]/).map(x=>x.trim()).filter(Boolean).map(x=>{const m=/^(\d{1,2})\.(\d{1,2})$/.exec(x);return m&&+m[2]>=1&&+m[2]<=12&&+m[1]>=1&&+m[1]<=31?[+m[2],+m[1]]:null});return a.some(x=>!x)?null:a};
function payRuleText(t){if(Array.isArray(t.inst)&&t.inst.length)return `${t.inst.length} ${plural(t.inst.length,'платёж','платежа','платежей')}: до ${instTxt(t)}`;if(!t.pay)return 'как срок сдачи';return ruleText(Object.assign({},t,t.pay,{payOnly:false}))}
function typeNorm(x){if(x.from==='end')delete x.from;if('payday' in x){x.pay=x.payday?{day:x.payday,after:x.after,ym:x.ym}:null;delete x.payday}if(Array.isArray(x.inst)&&!x.inst.length)delete x.inst;return x}
function ruleText(t){
  if(t.oneOff) return `в течение ${t.day} ${plural(t.day,'дня','дней','дней')} после события`;
  const dd=t.day>=31?'последнего дня':`${t.day}-го числа`;
  if(t.payOnly&&t.after===0) return `оплата до ${dd} месяца, за который платится`;
  if(t.per==='Y') return `до ${t.day} ${MONTHS_G[t.ym-1]} ${t.from==='start'?'того же':'следующего'} года`;
  if(t.from==='start'&&t.per!=='M'){const w=t.per==='Q'?'квартала':'полугодия';return t.after===0?`до ${dd} первого месяца ${w}`:`до ${dd} ${t.after+1}-го месяца ${w}`}
  if(t.after===0) return `до ${dd} месяца, за который платится`;
  const w=t.per==='M'?'месяца':t.per==='Q'?'квартала':'полугодия';
  return t.after===1?`до ${dd} месяца после ${t.per==='M'?'отчётного':w}`:`до ${dd} ${t.after}-го месяца после ${w}`;
}
/* Отчёт разового вида: p = {y, m, ev} — период — месяц даты события ev, срок — t.day дней от неё; отчётов за месяц может быть несколько, ключ — дата события */
const evName=t=>((t&&t.evLabel)||'Дата события').replace(/^./,s=>s.toLowerCase());
function plabel(t,p){if(p&&p.ev)return `${String(p.m).padStart(2,'0')}.${p.y} · ${p.ev.slice(8,10)}.${p.ev.slice(5,7)}`;return t.per==='M'?`${String(p.m).padStart(2,'0')}.${p.y}`:t.per==='Q'?`${ROM[p.q-1]} кв. ${p.y}`:t.per==='H'?`${ROM[p.h-1]} пол. ${p.y}`:`${p.y}`}
function phuman(t,p){if(p&&p.ev)return `${MONTHS[p.m-1]} ${p.y} · ${evName(t)} ${fmtD(p.ev)}`;return t.per==='M'?`${MONTHS[p.m-1]} ${p.y}`:t.per==='Q'?`${ROM[p.q-1]} квартал ${p.y}`:t.per==='H'?`${ROM[p.h-1]} полугодие ${p.y}`:`${p.y} год`}
function pstart(t,p){if(p&&p.ev)return p.ev;return t.per==='M'?mkDate(p.y,p.m,1):t.per==='Q'?mkDate(p.y,(p.q-1)*3+1,1):t.per==='H'?mkDate(p.y,(p.h-1)*6+1,1):mkDate(p.y,1,1)}
function pend(t,p){if(p&&p.ev)return p.ev;return t.per==='M'?mkDate(p.y,p.m+1,0):t.per==='Q'?mkDate(p.y,p.q*3+1,0):t.per==='H'?mkDate(p.y,p.h*6+1,0):mkDate(p.y,12,31)}
function ruleDate(r,p,per){const md=(y,m,d)=>d>=31?mkDate(y,m+1,0):mkDate(y,m,d);const st=r.from==='start';const last=per==='M'?p.m:per==='Q'?p.q*3:per==='H'?p.h*6:12;const first=per==='M'?p.m:per==='Q'?p.q*3-2:per==='H'?p.h*6-5:1;
  if(per==='Y')return md(p.y+(st?0:1),r.ym,r.day);return md(p.y,(st?first:last)+r.after,r.day)}
function dueOf(t,p){const base=p&&p.ev?addDays(p.ev,t.day):ruleDate(t,p,t.per);return {base,due:t.shift?shiftWork(base):base}}
/* Срок оплаты: своё правило вида (t.pay) или как срок сдачи */
function payDueOf(t,p,due){if(!t.pay||(p&&p.ev))return due;const b=ruleDate(Object.assign({from:t.from,ym:t.ym,after:t.after},t.pay),p,t.per);return t.shift?shiftWork(b):b}
function periodList(t,ahead=1){
  const[y,m]=TODAY.split('-').map(Number);const out=[];
  if(t.per==='M')for(let k=-3;k<=ahead;k++){const d=new Date(Date.UTC(y,m-1+k,1));out.push({y:d.getUTCFullYear(),m:d.getUTCMonth()+1})}
  if(t.per==='Q'){const q=Math.ceil(m/3);for(let k=-2;k<=0;k++){let qq=q+k,yy=y;while(qq<1){qq+=4;yy--}out.push({y:yy,q:qq})}}
  if(t.per==='H'){const h=Math.ceil(m/6);out.push(h===1?{y:y-1,h:2}:{y,h:1},{y,h})}
  if(t.per==='Y')out.push({y:y-1},{y});
  return out.filter(p=>!(t.skipQ&&t.skipQ.includes(p.q)));
}
/* Внутренняя фин. отчётность: периодичность и срок задаются в назначении конкретного контрагента */
const perOwn=t=>!!t&&(t.kind==='internal'||!!t.perAssign);
// Разовый вид (oneOff): по периодам не назначается, каждый отчёт создаётся через «Разовый отчёт»
const perTxt=t=>t.oneOff?'разовый':perOwn(t)?'по назначению':(PER_LABEL[t.per]||'').toLowerCase();
/* Срок по статусу контрагента: у статуса dueOverride {вид: {day, after, pay}} — например, «Крупный налогоплательщик»: НДС до последнего дня следующего месяца, уплата до 25-го.
   Действует, пока статус у контрагента не истёк (даты «Действует с / по»); «Вариант срока» в назначении важнее статуса */
const ovDay=d=>d==='last'?31:d;
const benLive=(cp,b)=>{const d=(cp.benDates||{})[b.name]||{};return (!d.from||d.from<=TODAY)&&(!d.to||d.to>=TODAY)};
const dueBen=(t,cp)=>!t||!cp?null:benOf(cp).find(b=>b.active!==false&&b.dueOverride&&b.dueOverride[t.id]&&benLive(cp,b))||null;
function tOv(t,cp){const b=dueBen(t,cp);if(!b)return t;const o=b.dueOverride[t.id];
  return Object.assign({},t,{day:ovDay(o.day!=null?o.day:t.day),after:o.after!=null?o.after:t.after,ovBen:b.name},o.ym?{ym:o.ym}:{},o.pay?{pay:{day:ovDay(o.pay.day),after:o.pay.after!=null?o.pay.after:t.after}}:{})}
function tEff(t,a,cp){if(!t)return t;t=tOv(t,cp);if(!a)return t;if(!perOwn(t))return a.dueDay?Object.assign({},t,{day:a.dueDay,ovBen:null}):t;if(!a.per)return t;return Object.assign({},t,{per:a.per,day:a.day,after:a.per==='Y'?0:a.mo,ym:a.per==='Y'?a.mo:t.ym})}
const assignOfT=(cp,id)=>cp.assign.find(a=>a.t===id&&!a.to)||cp.assign.filter(a=>a.t===id).slice(-1)[0];
const tFor=r=>tEff(T[r.t],assignOfT(CPM[r.cp],r.t),CPM[r.cp]);
// Срок не по правилу каталога: уточнённый отчёт, «Разовый отчёт», отчёт разового вида или срок, изменённый вручную, — правка правила срока его не трогает (ТЗ; решение заказчика 30.10.2026, продукт п. Д-18)
const dueFixed=r=>!!(r.ver||r.adhoc||r.ev||r.dueManual||(T[r.t]&&T[r.t].oneOff));
const regsOf=cp=>[cp.regime,cp.regime2].filter(Boolean);
const END_IDS=['endo','endi'],EN_ZERO=['0 %','0,1 %','0,5 %'];
const formEnd=cp=>{const f=DICT.forms.items.find(x=>x.name===cp.form);return f&&f.end||(cp.form==='ИП'?'ip':'org')};
function compatible(t,cp){
  if(t.who==='org'&&cp.form&&formEnd(cp)==='ip')return 'Для ИП назначается «ЕНД для ИП»';
  if(t.who==='ip'&&cp.form&&formEnd(cp)!=='ip')return 'Для организаций назначается «ЕНД для организаций»';
  const rs=regsOf(cp);
  if(t.kind==='regime'&&rs.length&&!t.regimes.some(r=>rs.includes(r)))return `Не подходит к режиму «${rs.join(' + ')}»`;
  if(END_IDS.includes(t.id)){const nr=rs.find(r=>['Патент','Зона торговли','Налог на транзакцию'].includes(r));if(nr)return `ЕНД не сдают плательщики режима «${nr}» (ст. 106)`;
    if(cp.form==='Крестьянское (фермерское) хозяйство')return 'КФХ без юрлица ЕНД не сдаёт (ст. 106)';
    const en=(cp.assign||[]).find(a=>!a.to&&isEnT(a.t)&&(a.en||[]).length);const er=en?aRows(en).filter(e=>!e.x.addTo):[];
    if(er.length&&er.every(e=>rtParts(e.x,e.v).every(p=>EN_ZERO.includes(p.pct))))return `ЕНД не сдают плательщики единого налога по ставке ${er.map(e=>`${e.code} · ${rtTxt(e.x,e.v)}`).join(', ')} (ст. 106)`}
  return '';
}
const benOf=cp=>(cp.ben||[]).map(n=>DICT.benefits.items.find(b=>b.name===n)).filter(Boolean);
/* Подсказка по льготам: какие выбранные виды статус делает ненужными и какие добавляет; решение за бухгалтером */
function benHint(cp,sel){const bs=benOf(cp);if(!bs.length)return '';const ids=[...sel];const out=[];
  bs.forEach(b=>{const rm=(b.removes||[]).filter(id=>ids.includes(id)&&T[id]),ad=(b.adds||[]).filter(id=>!ids.includes(id)&&T[id]);if(rm.length||ad.length)out.push(`«${esc(b.name)}»: ${rm.length?'обычно не нужны '+rm.map(id=>esc(T[id].short)).join(', '):''}${rm.length&&ad.length?'; ':''}${ad.length?'нужен '+ad.map(id=>esc(T[id].short)).join(', '):''}`)});
  const rates=bs.filter(b=>/Единый налог \d|ставк/i.test(b.gives)).map(b=>`«${esc(b.name)}»: ${esc(b.gives.split(';')[0])}`);
  if(!out.length&&!rates.length)return '';return `<div class="note">${ic('info')}<span>Подсказка по льготам — решение за бухгалтером.<br>${[...out,...rates].join('<br>')}</span></div>`}
function benChips(id,arr){return `<div class="chipsel" id="${id}">${DICT.benefits.items.filter(b=>b.active||arr.includes(b.name)).map(b=>`<button type="button" data-b="${esc(b.name)}" class="${arr.includes(b.name)?'on':''}" title="${esc(b.gives)}">${arr.includes(b.name)?ic('check','sm'):''}${esc(b.name)}</button>`).join('')}</div>`}
// У статуса (тип «Статус», kind='status') льгот нет — нет и предупреждения об окончании
const benSoon=cp=>benOf(cp).filter(b=>b.kind!=='status'&&b.until&&b.until>=TODAY&&diffDays(b.until,TODAY)<=60);
// Статусы, которые отмечаются сами по УГНС контрагента (поле «Ставится по УГНС»)
const ugBens=ug=>ug?DICT.benefits.items.filter(b=>b.active!==false&&b.suggest&&(b.suggest.ugns||[]).includes(ug)):[];
// Срок по статусу словами: «Сдача — до последнего дня месяца после отчётного; уплата — до 25-го числа месяца после отчётного (статус «…»)»
function ovText(t,cp){const e=tOv(t,cp);if(!e.ovBen)return '';const pay=t.act!=='sub'&&e.pay?payRuleText(e):'';
  return `${t.act==='pay'?'Уплата':'Сдача'} — ${ruleText(t.act==='pay'&&e.pay?Object.assign({},e,e.pay):e)}${pay&&t.act!=='pay'?'; уплата — '+pay:''} (статус «${e.ovBen}»)`}
const reg2Opts=(main,cur)=>[['','— нет —'],...DICT.regimes.items.filter(x=>(x.active||x.name===cur)&&x.name!==main).map(x=>[x.name,REGIME_FULL[x.name]||x.name])];

/* ═════════════ Statuses (состав зашит, названия и цвета ведёт администратор) ═════════════ */
const ST=DB.ref.statuses.report;
const PST=DB.ref.statuses.payment;
const TST=DB.ref.statuses.task;
const STATUS_GROUPS=[['Статусы сдачи отчётов',ST,'rep','1 К сдаче → 2 В работе → 3 Сдан. Отметки «Ждёт подтверждения» и «Подтверждено» стоят на шаге «Сдан», если в учётной политике организации включено подтверждение сдачи.'],['Статусы оплаты',PST,'pay'],['Статусы задач',TST,'task','Только для ручных задач. Регулярная задача показывает статус своего отчёта. Без подтверждения: 1 К выполнению → 2 В работе → 3 Выполнена; с подтверждением: 1 → 2 → 3 На подтверждении → 4 Подтверждена; «На доработке» — отметка на шаге 2.']];
const STL=DB.ref.statusNames;const stl=s=>STL[s]||s;
const pill=(text,map,extra='')=>{const[c,i]=(map&&map[text])||['gray','circle'];return `<span class="pill ${c} ${extra}">${ic(i)}${esc(stl(text))}</span>`};

