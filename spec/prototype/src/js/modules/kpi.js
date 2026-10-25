'use strict';
// Модуль «Показатели контрагентов»
/* ═════════════ Показатели контрагентов ═════════════ */
// Indicators are the organisation's own setting (not a platform dictionary). One value per contractor × indicator × month;
// empty ≠ 0. Month status per contractor: Не заполнено → Заполнено (auto, all required filled) → Проверено (right «Проверять показатели»).
const KST=DB.ref.statuses.indicator;
// Статусы месяца показателей — во вкладке «Статусы» справочников платформы вместе с остальными: администратор меняет название и цвет
STATUS_GROUPS.push(['Статусы показателей',KST,'ind']);
const IND=DB.indicators,IVALS=DB.indicatorValues,KMS=DB.indicatorMonths,IHIST=DB.indicatorHistory;
let IV={},KMI={};
const KTYPES={int:'Целое число',dec:'Число с копейками',som:'Сумма в сом',pct:'Процент'};
const KAGG={sum:'Сумма',avg:'Среднее',max:'Максимум',min:'Минимум',last:'Последнее значение'};
const KUNITS=['сом','чел.','шт.','%'];
const MON_S=['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
const ymS=k=>MON_S[+k.slice(5,7)-1]+' '+k.slice(2,4);
function kpiIndex(){IV={};IVALS.forEach(v=>IV[v.cp+'|'+v.ind+'|'+v.m]=v);KMI={};KMS.forEach(k=>KMI[k.id]=k)}
const kInds=all=>IND.filter(i=>all||!i.archived).sort((a,b)=>a.order-b.order);
// «Кому вести»: scope 'all' — всем, кроме выключенных; 'sel' — отмеченным (cps) и новым контрагентам при autoNew (новые — кого не было в seen на момент выбора).
// off[id] — месяц выключения (пометка «Не ведётся с …»); from[id] — месяц «с …» у контрагента: более ранние месяцы не требуются
const kNew=(i,c)=>!!i.autoNew&&!(i.seen||[]).includes(c.id);
const kOn=(i,c)=>!(i.off&&c.id in i.off)&&(i.scope==='all'||(i.cps||[]).includes(c.id)||kNew(i,c));
// «Вести с»: у показателя — start (по умолчанию месяц создания); у контрагента — свой месяц «с …»: по умолчанию поздний из «Вести с» и начала обслуживания.
// Раньше «с …» значения вносить можно, но они необязательны и в «Не заполнено» не попадают
const kSvc0=c=>(c.periods||[]).map(p=>p.from).sort()[0]||'';
const kStartI=i=>i.start||(i._ca||'').slice(0,7)||ym(TODAY);
const kStart=(i,c)=>(i.from&&i.from[c.id])||[kStartI(i),kSvc0(c)].sort().pop();
const kOpen=(i,c)=>!i.archived&&c.kind!=='oneoff'&&!c.archived&&kOn(i,c);
const kApplies=(i,c,m)=>kOpen(i,c)&&m>=kStart(i,c)&&(inService(c,m)||m<kSvc0(c));
const kEarly=(i,c,m)=>kOpen(i,c)&&m<kStart(i,c);
const kCanVal=(i,c,m)=>kApplies(i,c,m)||kEarly(i,c,m);
const ymN=m=>m.slice(5,7)+'.'+m.slice(0,4);
const kWhoTxt=i=>{const cs=kWhoAll(),n=cs.filter(c=>kOn(i,c)).length;return i.scope==='all'?(n<cs.length?`всем, кроме ${cs.length-n}`:'всем контрагентам'):`выбранным: ${n}${i.autoNew?', новые — автоматически':''}`};
const kOffLbl=(i,c)=>!kOn(i,c)&&i.off&&i.off[c.id]?`Не ведётся с ${ymG(i.off[c.id])}`:'';
function kSetOn(i,c,on,quiet){if(kOn(i,c)===on)return false;i.off=i.off||{};i.from=i.from||{};
  if(on){delete i.off[c.id];if(i.scope==='sel'&&!(i.cps||[]).includes(c.id))(i.cps=i.cps||[]).push(c.id);i.from[c.id]=kPrev()}
  else{i.off[c.id]=ym(TODAY);if(i.cps)i.cps=i.cps.filter(x=>x!==c.id)}
  if(i.scope==='sel'&&!(i.seen||[]).includes(c.id))(i.seen=i.seen||[]).push(c.id);
  touch(i);log('kind',i.id,`Показатель «${i.name}», ${c.name}: «${on?'Не ведётся':'Ведётся'}» → «${on?'Ведётся':'Не ведётся'}»`,c.id);if(!quiet)kResync();return true}
const kVal=(cp,ind,m)=>IV[cp+'|'+ind+'|'+m];
const kHasVals=i=>IVALS.some(v=>v.ind===i.id);
const kNum=(i,v)=>i.type==='int'?fmtM(v,false):fmtM(v,i.type==='dec'||(Math.round(v*100)%100)!==0);
const kFmt=(i,v)=>v==null||v===''?'':kNum(i,v)+(i.unit?' '+i.unit:'');
function kAgg(vals){const a=vals.filter(v=>v!=null);if(!a.length)return {n:0};const s=a.reduce((x,y)=>x+y,0);return {n:a.length,sum:s,avg:s/a.length,max:Math.max(...a),min:Math.min(...a),last:a[a.length-1]}}
const kMonths=(from,to)=>{const o=[];for(let x=from;x<=to;x=addMonths(x,1))o.push(x);return o};
const kPrev=()=>{const p=addMonths(ym(TODAY),-1);return !CPS.length||CPS.some(c=>c.kind!=='oneoff'&&inService(c,p))?p:ym(TODAY)};
const kCanEdit=c=>!isAdmin()&&can('kpiEdit')&&(seeAll('kpi')||c.resp===S.me);
function kReq(c,m){const ap=kInds().filter(i=>kApplies(i,c,m));const rq=ap.filter(i=>i.req);return rq.length?rq:ap}
function kDue(c,m){const rq=kReq(c,m);const d=rq.length?Math.min(...rq.map(i=>i.dueDay||10)):10;const n=addMonths(m,1);return mkDate(+n.slice(0,4),+n.slice(5,7),d)}
function kMonth(c,m){const id=c.id+'|'+m;let k=KMI[id];if(k)return k;if(!kReq(c,m).length)return null;
  k={id,cp:c.id,m,name:`${c.name} · ${ymLabel(m)}`,status:'Не заполнено',_cb:'system',_ca:addMonths(m,1)+'-01 00:00'};KMS.push(k);KMI[id]=k;return k}
const kFilled=(c,m)=>{const rq=kReq(c,m);return rq.length>0&&rq.every(i=>kVal(c.id,i.id,m))};
function kSync(c,m,edited){const k=kMonth(c,m);if(!k||!kReq(c,m).length)return k;const f=kFilled(c,m);let to=k.status;
  if(!f)to='Не заполнено';else if(k.status==='Не заполнено'||(edited&&k.status==='Проверено'))to='Заполнено';
  if(to!==k.status){log('km',k.id,`Статус: ${k.status} → ${to}${k.status==='Проверено'?' (значение изменено — нужна повторная проверка)':''}`,c.id);k.status=to}return k}
function kParse(i,txt){const t=String(txt).trim();if(t==='')return null;let n=parseNum(t.replace('%',''));if(isNaN(n))return NaN;if(i.type==='int')n=Math.round(n);else n=Math.round(n*100)/100;return n}
function kSet(c,i,m,v,note,file,src){const key=c.id+'|'+i.id+'|'+m;const old=IV[key];const ov=old?old.v:null;
  if(v==null){if(!old)return false;IVALS.splice(IVALS.indexOf(old),1);delete IV[key]}
  else if(old){if(old.v===v&&(note==null||note===old.note)&&!file)return false;old.v=v;if(note!=null)old.note=note;if(file)old.file=file;old.by=S.me;old.at=nowStamp()}
  else{const o={cp:c.id,ind:i.id,m,v,note:note||'',file:file||'',by:S.me,at:nowStamp()};IVALS.push(o);IV[key]=o}
  if(ov!==v){IHIST.push(Object.assign({cp:c.id,ind:i.id,m,old:ov,new:v,by:S.me,at:nowStamp()},src?{src}:{}));log('kv',c.id+'|'+m,`Показатель «${i.name}», ${ymLabel(m)}: ${ov==null?'пусто':kFmt(i,ov)} → ${v==null?'пусто':kFmt(i,v)}${src==='xlsx'?' (из Excel)':''}`,c.id)}
  kSync(c,m,ov!==v);return true}
function kResync(){const last=kPrev();CPS.forEach(c=>kMonths(addMonths(last,-K_BACK),last).forEach(m=>{if(KMI[c.id+'|'+m]||kReq(c,m).length)kSync(c,m,false)}))}
const kCps=m=>visCps(false,'kpi').filter(c=>c.kind!=='oneoff'&&kReq(c,m).length);
// В «Вводе за месяц» — ещё и контрагенты, у которых месяц раньше «с …»: значения можно внести, но они необязательны
const kCpsIn=m=>visCps(false,'kpi').filter(c=>c.kind!=='oneoff'&&(kReq(c,m).length||kInds().some(i=>kEarly(i,c,m))));
function kStats(m){const cs=kCps(m);const st=cs.map(c=>(kMonth(c,m)||{}).status);const due=c=>kDue(c,m);
  return {all:cs.length,filled:st.filter(x=>x==='Заполнено'||x==='Проверено').length,empty:st.filter(x=>x==='Не заполнено').length,over:cs.filter((c,j)=>st[j]==='Не заполнено'&&TODAY>due(c)).length,checked:st.filter(x=>x==='Проверено').length}}
// Незаполненные месяцы: от «с …» каждого обязательного показателя до текущего месяца заполнения (прошлый календарный месяц), не дальше K_BACK месяцев назад.
// Результат запоминается до изменения значений, настроек или контрагентов: счётчик нужен в панели модулей, на «Главной» и в каждой строке списка контрагентов
const K_BACK=35;
function kMissing(){const key=[TODAY,S.me,IVALS.length,IHIST.length,HIST.length,IND.length,CPS.length].join('|');if(kMissing.key===key)return kMissing.rows.slice();
  const last=kPrev(),lo=addMonths(last,-K_BACK),out=[];
  visCps(false,'kpi').forEach(c=>{const ri=kInds().filter(i=>i.req&&kOpen(i,c));if(!ri.length)return;let from=ri.map(i=>kStart(i,c)).sort()[0];if(from<lo)from=lo;
    kMonths(from,last).forEach(m=>{const miss=ri.filter(i=>kApplies(i,c,m)&&!kVal(c.id,i.id,m));if(!miss.length)return;const due=kDue(c,m);out.push({id:c.id+'|'+m,c,m,miss,due,over:TODAY>due?diffDays(TODAY,due):0,k:kMonth(c,m)})})});
  kMissing.key=key;kMissing.rows=out;return out.slice()}
// Индикатор незаполненных: контрагенты с незаполненными обязательными показателями за текущий месяц заполнения и прошлые месяцы.
// Красный — есть просроченные месяцы, жёлтый — не заполнен только текущий месяц до срока
function kMissCnt(){kMissing();if(kMissCnt.rows===kMissing.rows)return kMissCnt.v;const by={};
  kMissing.rows.forEach(r=>{const x=by[r.c.id]=by[r.c.id]||{c:r.c,ms:[],over:false};x.ms.push(r.m);if(r.over)x.over=true});
  const l=Object.values(by);kMissCnt.rows=kMissing.rows;kMissCnt.v={n:l.length,over:l.some(x=>x.over),by};return kMissCnt.v}
const kMissOk=()=>!isAdmin()&&feat('indicators')&&can('kpiView');
function kMissBadge(style){if(!kMissOk())return '';const k=kMissCnt();if(!k.n)return '';
  return `<span class="badge ${k.over?'red':'yellow'}" ${style?`style="${style}"`:''} title="${k.over?'Не заполнены показатели, есть просроченные месяцы':'Не заполнен текущий месяц, срок ещё не прошёл'}">${k.n}</span>`}
// После ввода значения без перерисовки страницы: счётчик на вкладке «Не заполнено», в панели модулей и точка на «≡»
function kLiveBadges(){const k=kMissCnt();const b=$('#tabs .tab[href$=".missing"] .badge');if(b){b.textContent=k.n;b.className='badge '+(k.n?(k.over?'red':'yellow'):'')}renderSide();renderSheetDot()}
const kMissTip=x=>`Показатели не заполнены: ${x.ms.map(ymN).join(', ')}`;
function kpiTabs(){return [{id:'month',label:'Ввод за месяц',icon:'edit'},{id:'period',label:'За период',icon:'chart'},(()=>{const k=kMissCnt();return {id:'missing',label:'Не заполнено',icon:'alert',count:k.n,red:k.over,yellow:!k.over}})(),can('indSetup')?{id:'setup',label:'Настройка показателей',icon:'sliders'}:null]}
function kpiAdd(){return [can('indSetup')&&{label:'Показатель',icon:'gauge',run:()=>indDlg()},can('kpiImport')&&{label:'Ввод из Excel',icon:'upload',btn:true,sub:'Шаблон и загрузка заполненного шаблона',run:()=>kxDlg()}].filter(Boolean)}
function kPlates(m){const s=kStats(m);return `<div class="plates">${plate({id:'kf',icon:'check',color:'blue',label:`Заполнено за ${MONTHS[+m.slice(5,7)-1]}`,value:`${s.filled} из ${s.all}`,sub:'контрагентов с внесёнными показателями'})}${plate({id:'ke',icon:'alert',color:s.empty?'orange':'green',label:'Не заполнено',value:s.empty,sub:s.empty?'нет обязательных значений':'всё внесено'})}${plate({id:'ko',icon:'clock',color:s.over?'red':'green',label:'Просрочено заполнение',value:s.over,sub:'срок заполнения прошёл'})}${plate({id:'kc',icon:'ok',color:'green',label:'Проверено',value:s.checked,sub:'главным бухгалтером или владельцем'})}</div>`}
function kPeriodBar(p,id){const y=+TODAY.slice(0,4),last=kPrev();const q0=addMonths(ym(TODAY),-((+TODAY.slice(5,7)-1)%3));
  const qs=[['year',`${y}-01`,`${y}-12`,'Этот год'],['prev',`${y-1}-01`,`${y-1}-12`,'Прошлый год'],['12',addMonths(last,-11),last,'Последние 12 месяцев'],['q',q0,addMonths(q0,2),'Квартал']];
  return `<div class="row kpi-bar"><label class="row" style="gap:6px"><span class="muted">С</span><input type="month" class="inp" id="${id}-f" value="${p.from}" style="width:auto;min-height:32px;padding:3px 8px"></label><label class="row" style="gap:6px"><span class="muted">по</span><input type="month" class="inp" id="${id}-t" value="${p.to}" style="width:auto;min-height:32px;padding:3px 8px"></label><div class="seg">${qs.map(q=>`<button data-kq="${q[1]}|${q[2]}" class="${p.from===q[1]&&p.to===q[2]?'on':''}">${q[3]}</button>`).join('')}</div></div>`}
function kBindPeriod(root,id,p,redraw){const f=root.querySelector('#'+id+'-f'),t=root.querySelector('#'+id+'-t');
  const set=(a,b)=>{if(!a||!b)return;if(a>b)[a,b]=[b,a];p.from=a;p.to=b;redraw()};f.onchange=()=>set(f.value,t.value);t.onchange=()=>set(f.value,t.value);
  root.querySelectorAll('[data-kq]').forEach(b=>b.onclick=()=>{const[a,c]=b.dataset.kq.split('|');set(a,c)})}

function renderKpi(body,tab,fresh){
  S.kpiM=S.kpiM||kPrev();S.kpiP=S.kpiP||{from:addMonths(kPrev(),-11),to:kPrev()};
  if(tab==='setup')return kpiSetup(body);
  if(!visCps(false,'kpi').length){const fe=firstEmpty();body.innerHTML=fe?feHtml(fe):'';body.onclick=e=>{const b=e.target.closest('[data-a=fe]');if(b)fe.btns.filter(Boolean)[+b.dataset.i][2]()};return}
  if(tab==='month')return kpiMonth(body);
  if(tab==='period')return kpiPeriod(body,fresh);
  if(tab==='missing')return kpiMissingTab(body,fresh);
}
// Выбор месяца в «Вводе за месяц»: стрелки «‹ ›» и список месяцев; у месяца с незаполненными значениями — красная точка и число контрагентов
function kMonCnt(){const n={};kMissing().forEach(r=>n[r.m]=(n[r.m]||0)+1);return n}
function kMonList(){const cur=ym(TODAY);let lo=addMonths(cur,-24);kMissing().forEach(r=>{if(r.m<lo)lo=r.m});return kMonths(lo,cur).reverse()}
function kMonPick(m){const n=kMonCnt()[m]||0;
  return `<div class="km-pick" role="group" aria-label="Месяц"><button class="icon-btn sm" id="km-prev" aria-label="Предыдущий месяц" title="Предыдущий месяц">${ic('left','sm')}</button><button class="btn sm km-cur" id="km-open" aria-haspopup="listbox" title="Выбрать месяц">${n?'<span class="kdot" aria-hidden="true"></span>':''}<span>${esc(ymLabel(m))}${n?` · не заполнено ${n}`:''}</span>${ic('down','sm')}</button><button class="icon-btn sm" id="km-next" aria-label="Следующий месяц" title="Следующий месяц" ${m>=ym(TODAY)?'disabled':''}>${ic('right','sm')}</button></div>`}
function kMonBind(root,m){const go=x=>{S.kpiM=x;renderPage()};const p=$('#km-prev',root),n=$('#km-next',root),o=$('#km-open',root);if(!o)return;
  p.onclick=()=>go(addMonths(m,-1));n.onclick=()=>{if(m<ym(TODAY))go(addMonths(m,1))};
  o.onclick=()=>{const cnt=kMonCnt();openPop(o,`<div class="km-list" role="listbox" aria-label="Месяцы">${kMonList().map(x=>`<button class="mi ${x===m?'on':''}" data-km="${x}" role="option" aria-selected="${x===m}"><span class="kdot ${cnt[x]?'':'off'}" aria-hidden="true"></span><span>${ymN(x)}${cnt[x]?` · не заполнено ${cnt[x]}`:''}${x===ym(TODAY)?' <small class="faint">идёт сейчас</small>':''}</span></button>`).join('')}</div>`,
    {cls:'km-pop',mount(el){const on=el.querySelector('.mi.on');if(on)on.scrollIntoView({block:'center'});el.addEventListener('click',e=>{const b=e.target.closest('[data-km]');if(b){closePop();go(b.dataset.km)}})}})}}
// «Ввод за месяц»: Excel-like grid; arrows/Enter move between cells, a block pasted from Excel fills cells from the focused one.
function kpiMonth(body){const m=S.kpiM;const inds=kInds();const q=norm(S.search.trim());
  const cs=kCpsIn(m).filter(c=>!q||norm(c.name).includes(q)||norm(empName(c.resp)).includes(q)).sort((a,b)=>COLL.compare(a.name,b.name));
  let h=kPlates(m)+`<div class="row kpi-bar">${kMonPick(m)}<span class="hint" style="margin:0">Внесите значения за месяц после его окончания или выберите любой прошлый месяц. Пусто — «не заполнено», 0 — «внесено, равно нулю». Можно вставить блок из Excel.</span></div>`;
  if(!inds.length){body.innerHTML=h+`<div class="state">${ic('gauge','lg')}<b>Показателей нет</b><span>Создайте показатели во вкладке «Настройка показателей».</span></div>`;return}
  if(!cs.length){body.innerHTML=h+`<div class="state">${ic('search','lg')}<b>Ничего не найдено</b><span>Нет контрагентов, для которых нужны показатели за ${esc(ymLabel(m))}.</span></div>`;bindM();return}
  if(isMobile()){h+=`<div class="gcards">${cs.map(c=>{const k=kMonth(c,m);const ap=inds.filter(i=>kCanVal(i,c,m));const n=ap.filter(i=>kVal(c.id,i.id,m)).length;const er=ap.find(i=>kEarly(i,c,m));
      return `<button class="gcard kcard ${k&&k.status==='Не заполнено'&&TODAY>kDue(c,m)?'overdue':''}" data-kmc="${c.id}"><div class="row" style="flex-wrap:nowrap"><b class="grow" style="text-align:left">${esc(c.name)}</b>${ic('right','sm')}</div><dl><dt>Внесено</dt><dd>${n} из ${ap.length}</dd>${er?`<dt>Необязательно</dt><dd>ведётся с ${ymN(kStart(er,c))}</dd>`:''}<dt>Ответственный</dt><dd>${esc(empName(c.resp)||'—')}</dd><dt>Статус</dt><dd>${k?scaleMini('ind',k.status,k):'—'}</dd></dl></button>`}).join('')}</div>`;
    body.innerHTML=h;bindM();body.onclick=e=>{const b=e.target.closest('[data-kmc]');if(b)kEditDlg(CPM[+b.dataset.kmc],m)};return}
  h+=`<div class="tbl-wrap kpi-wrap"><table class="kt"><thead><tr><th class="kt-cp">Контрагент</th><th>Ответственный</th>${inds.map(i=>`<th class="num">${esc(i.name)}${i.desc?tipI(i.desc):''}<small>${esc(i.unit||KTYPES[i.type])}${i.req?'':' · необязательный'}</small></th>`).join('')}<th>Статус месяца</th></tr></thead><tbody>`;
  cs.forEach((c,ri)=>{const k=kMonth(c,m);const ed=kCanEdit(c);const ov=k&&k.status==='Не заполнено'&&TODAY>kDue(c,m);
    h+=`<tr class="${ov?'overdue':''}" data-kr="${c.id}"><td class="kt-cp"><button class="linkbtn" data-kcp="${c.id}">${esc(c.name)}</button></td><td class="muted">${esc(empName(c.resp)||'—')}</td>${inds.map((i,ci)=>{if(!kCanVal(i,c,m))return `<td class="num faint kno" title="${esc(kOffLbl(i,c)||'Показатель у этого контрагента не ведётся или не нужен в этом месяце')}">—</td>`;const v=kVal(c.id,i.id,m);const early=kEarly(i,c,m);const st=early?'Ведётся с '+ymN(kStart(i,c)):'';
      return `<td class="num ${v||early?'':i.req?'emp':''} ${early?'kearly':''}"><input class="kin" data-r="${ri}" data-c="${ci}" data-cp="${c.id}" data-ind="${i.id}" ${early?`data-early="1" placeholder="${st.toLowerCase()}"`:''} value="${v?esc(kNum(i,v.v)):''}" ${ed?(early?`title="${st}: значение за этот месяц необязательно"`:''):'readonly title="Вносит ответственный, главный бухгалтер или владелец"'} inputmode="decimal" aria-label="${esc(c.name)}: ${esc(i.name)}${early?'. '+st+', необязательно':''}"></td>`}).join('')}<td class="kst">${k?scaleMini('ind',k.status,k):'—'}</td></tr>`});
  h+=`</tbody><tfoot>${[['sum','Сумма'],['avg','Среднее'],['max','Максимум'],['min','Минимум']].map(([a,l])=>`<tr><th colspan="2">${l}</th>${inds.map(i=>`<td class="num" data-kf="${i.id}" data-a="${a}"></td>`).join('')}<td></td></tr>`).join('')}</tfoot></table></div>`;
  body.innerHTML=h;bindM();foot();
  function foot(){inds.forEach(i=>{const g=kAgg(cs.map(c=>{const v=kVal(c.id,i.id,m);return v?v.v:null}));body.querySelectorAll(`[data-kf="${i.id}"]`).forEach(td=>{const a=td.dataset.a;td.textContent=g.n?kNum(i,a==='avg'?Math.round(g[a]*100)/100:g[a]):'—';td.title=g.n?`по ${g.n} из ${cs.length} контрагентов`:''})})}
  function bindM(){kMonBind(body,m)}
  const inputs=[...body.querySelectorAll('.kin')];const at=(r,c)=>body.querySelector(`.kin[data-r="${r}"][data-c="${c}"]`);
  const commit=x=>{if(x.readOnly)return;const c=CPM[+x.dataset.cp],i=IND.find(y=>y.id===x.dataset.ind);const v=kParse(i,x.value);
    if(Number.isNaN(v)){toast(`«${x.value}» — не число`,'alert',true);const o=kVal(c.id,i.id,m);x.value=o?kNum(i,o.v):'';return}
    if(kSet(c,i,m,v)){x.value=v==null?'':kNum(i,v);x.parentElement.classList.toggle('emp',v==null&&i.req&&!x.dataset.early);const tr=x.closest('tr');const k=KMI[c.id+'|'+m];tr.querySelector('.kst').innerHTML=k?scaleMini('ind',k.status,k):'—';tr.classList.toggle('overdue',!!k&&k.status==='Не заполнено'&&TODAY>kDue(c,m));foot();
      const pl=body.querySelector('.plates');if(pl)pl.outerHTML=kPlates(m);kLiveBadges()}};
  inputs.forEach(x=>{x.addEventListener('change',()=>commit(x));x.addEventListener('focus',()=>x.select());
    x.addEventListener('keydown',e=>{const r=+x.dataset.r,c=+x.dataset.c;let t=null;
      if(e.key==='ArrowDown'||e.key==='Enter'){for(let k=r+1;k<=cs.length&&!t;k++)t=at(k,c)}if(e.key==='ArrowUp'){for(let k=r-1;k>=0&&!t;k--)t=at(k,c)}
      if(e.key==='ArrowRight'&&x.selectionEnd===x.value.length){for(let k=c+1;k<=inds.length&&!t;k++)t=at(r,k)}if(e.key==='ArrowLeft'&&x.selectionStart===0){for(let k=c-1;k>=0&&!t;k--)t=at(r,k)}
      if(t){e.preventDefault();commit(x);t.focus()}});
    x.addEventListener('paste',e=>{const tx=(e.clipboardData||window.clipboardData).getData('text');if(!/[\t\n]/.test(tx.trim()))return;e.preventDefault();const r0=+x.dataset.r,c0=+x.dataset.c;let n=0,bad=0;
      tx.replace(/\r/g,'').replace(/\n$/,'').split('\n').forEach((line,dr)=>line.split('\t').forEach((cell,dc)=>{const y=at(r0+dr,c0+dc);if(!y||y.readOnly)return;const c=CPM[+y.dataset.cp],i=IND.find(z=>z.id===y.dataset.ind);const v=kParse(i,cell);if(Number.isNaN(v)){bad++;return}if(kSet(c,i,m,v))n++}));
      renderPage();toast(`Вставлено значений: ${n}${bad?`, пропущено не чисел: ${bad}`:''}`,'paste')})});
  body.onclick=e=>{const b=e.target.closest('[data-kcp]');if(b)openCp(CPM[+b.dataset.kcp],'kpi')};
}
// «За период»: contractor × indicator rows, month columns and totals over filled months only.
function kpiPeriod(body,fresh){const p=S.kpiP;const ms=kMonths(p.from,p.to);
  body.innerHTML=kPlates(S.kpiM)+kPeriodBar(p,'kpp')+'<div id="kpg"></div>';kBindPeriod(body,'kpp',p,()=>renderPage());
  const rows=()=>{const out=[];visCps(true,'kpi').filter(c=>c.kind!=='oneoff').forEach(c=>kInds(true).forEach(i=>{const vals=ms.map(m=>{const v=kVal(c.id,i.id,m);return v?v.v:null});const need=ms.filter(m=>kApplies(i,c,m)).length;if(!need&&!vals.some(v=>v!=null))return;
      const last=IVALS.filter(v=>v.cp===c.id&&v.ind===i.id&&v.m>=p.from&&v.m<=p.to).sort((a,b)=>a.at<b.at?1:-1)[0];out.push({id:c.id+'|'+i.id,c,i,vals,need,g:kAgg(vals),last})}));return out};
  const tot=a=>({key:a,label:KAGG[a],type:'num',w:a==='avg'?170:130,num:true,val:r=>r.g.n?r.g[a]:null,html:r=>r.g.n?`<b>${esc(kNum(r.i,a==='avg'?Math.round(r.g.avg*100)/100:r.g[a]))}</b>${a==='avg'?` <small class="faint">по ${r.g.n} из ${r.need||ms.length}</small>`:''}`:'<span class="faint">—</span>'});
  grid($('#kpg',body),{id:'kpi-period',audit:false,firstRun:true,title:'id',noun:['строка','строки','строк'],sort:{key:'cp',dir:1},
    cols:[{key:'cp',label:'Контрагент',type:'text',w:230,val:r=>r.c.name,html:r=>`<button class="linkbtn strong" data-kcp="${r.c.id}">${esc(r.c.name)}</button>`},
      {key:'ind',label:'Показатель',type:'enum',w:190,val:r=>r.i.name,html:r=>`${esc(r.i.name)}${r.i.archived?' <span class="tag">архив</span>':''}${kOffLbl(r.i,r.c)?` <span class="tag">${esc(kOffLbl(r.i,r.c))}</span>`:''}`},
      ...ms.map((m,j)=>({key:'m'+m,label:ymS(m),type:'num',w:105,num:true,val:r=>r.vals[j],html:r=>{const ap=kApplies(r.i,r.c,m),v=r.vals[j];return `<button class="kcell ${v==null&&ap&&m<ym(TODAY)?'emp':''}" data-kc="${r.c.id}|${m}" title="${esc(r.i.name)}, ${esc(ymLabel(m))}">${v==null?(ap?'пусто':'—'):esc(kNum(r.i,v))}</button>`}})),
      tot('sum'),tot('avg'),tot('max'),tot('min'),
      {key:'resp',label:'Ответственный',type:'enum',w:140,hide:true,val:r=>empName(r.c.resp)},{key:'unit',label:'Единица',type:'enum',w:90,hide:true,val:r=>r.i.unit},
      {key:'nf',label:'Заполнено месяцев',type:'int',w:120,num:true,hide:true,val:r=>r.g.n,html:r=>`${r.g.n} из ${r.need}`},
      {key:'fs',label:'Статус заполнения',type:'enum',w:150,hide:true,val:r=>r.g.n>=r.need?'Заполнено полностью':'Есть пропуски'},
      {key:'ub',label:'Изменил',type:'text',w:170,hide:true,val:r=>r.last?whoName(r.last.by)+' · '+fmtDT(r.last.at):''}],
    rows,open:r=>openCp(r.c,'kpi')});
  body.onclick=e=>{let b;if(b=e.target.closest('[data-kc]')){e.stopPropagation();const[cp,m]=b.dataset.kc.split('|');kEditDlg(CPM[+cp],m);return}if(b=e.target.closest('[data-kcp]')){e.stopPropagation();openCp(CPM[+b.dataset.kcp],'kpi')}};
}
function kpiMissingTab(body,fresh){body.innerHTML=kPlates(S.kpiM)+`<div class="note">${ic('info')}<span>Контрагенты, у которых за прошедшие месяцы не внесены обязательные показатели. После срока заполнения строка подсвечивается красным.</span></div><div id="kmg"></div>`;
  grid($('#kmg',body),{id:'kpi-missing',audit:false,noun:['месяц','месяца','месяцев'],sort:{key:'due',dir:1},rowClass:r=>r.over?'overdue':'',
    empty:{icon:'ok',title:'Всё заполнено',text:'Обязательные показатели внесены по всем контрагентам.'},
    cols:[{key:'cp',label:'Контрагент',type:'text',w:230,val:r=>r.c.name,html:r=>`<span class="strong">${esc(r.c.name)}</span>`},{key:'m',label:'Месяц',type:'enum',w:140,val:r=>ymLabel(r.m),sortVal:r=>r.m},
      {key:'miss',label:'Не внесено',type:'text',w:260,val:r=>r.miss.map(i=>i.name).join(', ')},{key:'resp',label:'Ответственный',type:'enum',w:140,val:r=>empName(r.c.resp)},
      {key:'due',label:'Срок заполнения',type:'date',w:130,val:r=>r.due,html:r=>`<span class="${r.over?'red strong':''}">${fmtD(r.due)}</span>`},{key:'over',label:'Просрочено, дней',type:'int',w:120,num:true,val:r=>r.over||null},
      {key:'st',label:'Статус месяца',type:'enum',w:170,val:r=>r.k?r.k.status:'',html:r=>r.k?scaleMini('ind',r.k.status,r.k):''}],
    rows:kMissing,open:r=>kEditDlg(r.c,r.m)})}
// «Настройка показателей»: переключатель вида «Показатели / Кому вести»
function kpiSetup(body){S.kSetV=S.kSetV||'list';
  body.innerHTML=`<div class="row kpi-bar"><div class="seg" role="group" aria-label="Вид"><button data-ksv="list" class="${S.kSetV==='list'?'on':''}">${ic('list','sm')}Показатели</button><button data-ksv="who" class="${S.kSetV==='who'?'on':''}">${ic('matrix','sm')}Кому вести</button></div></div><div id="ksb"></div>`;
  $$('[data-ksv]',body).forEach(b=>b.onclick=()=>{S.kSetV=b.dataset.ksv;renderPage()});
  const h=$('#ksb',body);if(S.kSetV==='who')kpiWho(h);else kpiSetupList(h)}
// Фильтры контрагентов для «Кому вести» и окна показателя: режим, ответственный, статус, ГКЭД, поиск
const kWhoAll=()=>visCps(false,'kpi').filter(c=>c.kind!=='oneoff').sort((a,b)=>COLL.compare(a.name,b.name));
function kWhoFiltHtml(f,id){const cs=kWhoAll();const regs=[...new Set(cs.map(c=>c.regime||'').filter(Boolean))].sort();const rs=[...new Set(cs.map(c=>c.resp||''))];
  return `<div class="kw-f" data-kwf="${id}"><input class="inp" type="search" data-kf="q" value="${esc(f.q||'')}" placeholder="Поиск по названию или ИНН" aria-label="Поиск контрагента">
    ${sel(id+'-reg',[['','Все режимы'],...regs.map(r=>[r,r])],f.reg||'','data-kf="reg" aria-label="Режим"')}${sel(id+'-resp',[['','Все ответственные'],...rs.map(r=>[r||'-',r?empName(r):'Без ответственного'])],f.resp||'','data-kf="resp" aria-label="Ответственный"')}
    ${sel(id+'-st',[['','Все статусы'],['Обслуживается','Обслуживается'],['Приостановлен','Приостановлен']],f.st||'','data-kf="st" aria-label="Статус контрагента"')}<input class="inp mono" data-kf="gk" value="${esc(f.gk||'')}" placeholder="ГКЭД" aria-label="ГКЭД"></div>`}
function kWhoFilter(f){const q=norm(f.q||'').trim(),g=(f.gk||'').trim();return kWhoAll().filter(c=>(!q||norm(c.name).includes(q)||c.inn.includes(q))&&(!f.reg||c.regime===f.reg)&&(!f.resp||(f.resp==='-'?!c.resp:c.resp===f.resp))&&(!f.st||c.status===f.st)&&(!g||[c.gked,...(c.gked2||[])].some(k=>k&&k.startsWith(g))))}
function kWhoFiltBind(el,f,redraw){$$('[data-kf]',el).forEach(x=>{const k=x.dataset.kf;const ev=x.tagName==='SELECT'?'change':'input';x.addEventListener(ev,()=>{f[k]=x.value;redraw(k,x)})})}
// Включить или выключить показатель группе контрагентов; при нескольких — подтверждение «Изменится у N контрагентов»
function kWhoMass(i,cs,on,done){const ch=cs.filter(c=>kOn(i,c)!==on);if(!ch.length)return toast(on?'Показатель уже ведётся у всех в фильтре':'Показатель уже выключен у всех в фильтре');
  const run=()=>{ch.forEach(c=>kSetOn(i,c,on,true));kResync();done&&done();refreshAll();toast(`«${i.name}»: ${on?'включён':'выключен'} у ${ch.length} ${plural(ch.length,'контрагента','контрагентов','контрагентов')}`,'gauge')};
  if(ch.length===1)return run();
  confirmDlg({title:`${on?'Включить':'Выключить'} показатель «${esc(i.name)}»?`,text:`Изменится у ${ch.length} ${plural(ch.length,'контрагента','контрагентов','контрагентов')}. ${on?'Значения нужно будет вносить начиная с '+esc(ymG(kPrev()))+'.':'Внесённые значения сохранятся и будут видны в «За период».'}`,ok:on?'Включить':'Выключить',danger:!on,run})}
// «Кому вести»: строки — контрагенты, столбцы — показатели, в ячейке галочка «Вести»; на телефоне — выбор показателя и список с переключателями
function kpiWho(host){const f=S.kWhoF=S.kWhoF||{};const inds=kInds();const ed=can('indSetup');
  if(!inds.length){host.innerHTML=`<div class="state">${ic('gauge','lg')}<b>Показателей нет</b><span>Создайте показатель в виде «Показатели».</span></div>`;return}
  const draw=()=>{const cs=kWhoFilter(f);const all=kWhoAll();
    let h=`<div class="note">${ic('info')}<span>Отметьте, каким контрагентам вести каждый показатель. Выключение не удаляет внесённые значения; невключённый показатель не попадает в «Не заполнено», в статус месяца и в шаблон Excel. Разовым и приостановленным показатели не требуются.</span></div>${kWhoFiltHtml(f,'kw')}
      <div class="row kw-acts"><span class="muted">Контрагентов: ${cs.length}${cs.length<all.length?` из ${all.length}`:''}</span><div class="grow"></div>${ed?`<button class="btn sm" id="kw-on">${ic('check','sm')}Включить показатель…</button><button class="btn sm" id="kw-off">${ic('x','sm')}Выключить показатель…</button>`:''}</div>`;
    if(!cs.length)h+=`<div class="state">${ic('search','lg')}<b>Ничего не найдено</b><span>Измените фильтры.</span></div>`;
    else if(isMobile()){S.kWhoI=inds.find(i=>i.id===S.kWhoI)?S.kWhoI:inds[0].id;const i=inds.find(x=>x.id===S.kWhoI);const n=cs.filter(c=>kOn(i,c)).length;
      h+=`${fld('Показатель',sel('kw-ind',inds.map(x=>[x.id,x.name]),i.id),{id:'kw-ind'})}<div class="row" style="margin:6px 0"><span class="muted">Ведётся у ${n} из ${cs.length}</span><div class="grow"></div>${ed?`<label class="row" style="gap:8px">Всем в фильтре<input type="checkbox" class="sw" data-kwcol="${i.id}" ${n===cs.length?'checked':''}></label>`:''}</div>
        <div class="kw-list">${cs.map(c=>{const o=kOffLbl(i,c);return `<label class="kw-li"><span class="grow"><b>${esc(c.name)}</b><small class="faint">${esc(c.regime||'—')} · ${esc(empName(c.resp)||'без ответственного')}${c.paused?' · приостановлен':''}${o?' · '+esc(o):''}</small></span><input type="checkbox" class="sw" data-kwc="${c.id}|${i.id}" ${kOn(i,c)?'checked':''} ${ed?'':'disabled'} aria-label="${esc(c.name)}: вести «${esc(i.name)}»"></label>`}).join('')}</div>`}
    else{h+=`<div class="tbl-wrap kpi-wrap"><table class="kt kw-t"><thead><tr><th class="kt-cp">Контрагент</th>${inds.map(i=>{const n=cs.filter(c=>kOn(i,c)).length;return `<th class="kw-h"><label title="Вести всем контрагентам в фильтре"><input type="checkbox" data-kwcol="${i.id}" ${n===cs.length?'checked':''} ${n&&n<cs.length?'data-ind="1"':''} ${ed?'':'disabled'}><span>${esc(i.name)}</span></label><small>${n} из ${cs.length}</small></th>`}).join('')}</tr></thead><tbody>
      ${cs.map(c=>{const n=inds.filter(i=>kOn(i,c)).length;return `<tr class="${c.paused?'muted':''}"><td class="kt-cp"><label class="kw-rh" title="Все показатели этому контрагенту"><input type="checkbox" data-kwrow="${c.id}" ${n===inds.length?'checked':''} ${n&&n<inds.length?'data-ind="1"':''} ${ed?'':'disabled'}><span><button type="button" class="linkbtn" data-kcp="${c.id}">${esc(c.name)}</button><small class="faint">${esc(c.regime||'—')} · ${esc(empName(c.resp)||'без ответственного')}${c.paused?' · приостановлен':''}</small></span></label></td>
        ${inds.map(i=>{const o=kOffLbl(i,c);return `<td class="kw-c"><input type="checkbox" data-kwc="${c.id}|${i.id}" ${kOn(i,c)?'checked':''} ${ed?'':'disabled'} aria-label="${esc(c.name)}: вести «${esc(i.name)}»" title="${esc(o||(kOn(i,c)?'Ведётся':'Не ведётся'))}">${o?`<small class="faint">${esc(o.replace('Не ведётся с ',''))}</small>`:''}</td>`}).join('')}</tr>`}).join('')}</tbody></table></div>`}
    host.innerHTML=h;$$('[data-ind]',host).forEach(x=>x.indeterminate=true);
    kWhoFiltBind(host,f,(k,x)=>{draw();const n=host.querySelector(`[data-kf="${k}"]`);if(n&&x.tagName!=='SELECT'){n.focus();n.setSelectionRange(n.value.length,n.value.length)}});
    const ki=$('#kw-ind',host);if(ki)ki.onchange=()=>{S.kWhoI=ki.value;draw()};
    const pick=on=>ev=>menu(ev.currentTarget,inds.map(i=>({label:i.name,icon:'gauge',sub:`${on?'Не ведётся':'Ведётся'} у ${cs.filter(c=>kOn(i,c)!==on).length} в фильтре`,run:()=>kWhoMass(i,cs,on,draw)})));
    if($('#kw-on',host))$('#kw-on',host).onclick=pick(true);if($('#kw-off',host))$('#kw-off',host).onclick=pick(false);
    $$('[data-kwc]',host).forEach(x=>x.onchange=()=>{const[cid,iid]=x.dataset.kwc.split('|');kSetOn(IND.find(i=>i.id===iid),CPM[+cid],x.checked);refreshAll();draw()});
    $$('[data-kwcol]',host).forEach(x=>x.onchange=()=>{const i=IND.find(y=>y.id===x.dataset.kwcol);x.checked=!x.checked;kWhoMass(i,cs,!(cs.every(c=>kOn(i,c))),draw)});
    $$('[data-kwrow]',host).forEach(x=>x.onchange=()=>{const c=CPM[+x.dataset.kwrow];const on=x.checked;const ch=inds.filter(i=>kOn(i,c)!==on);ch.forEach(i=>kSetOn(i,c,on,true));kResync();refreshAll();draw();toast(`${c.name}: ${on?'включено':'выключено'} показателей — ${ch.length}`,'gauge')});
    $$('[data-kcp]',host).forEach(b=>b.onclick=e=>{e.preventDefault();openCp(CPM[+b.dataset.kcp],'kpi')})};
  draw()}
// Карточка контрагента: какие показатели вести (переключатели «Вести»; без права «Настраивать показатели» — только просмотр)
function kpiCardWhoHtml(c){const inds=kInds();if(!inds.length)return '';const ed=can('indSetup');
  return `<details class="box kw-card" ${c.archived?'':'open'}><summary><b>Какие показатели вести</b><span class="grow"></span><span class="muted">${inds.filter(i=>kOn(i,c)).length} из ${inds.length}</span>${ic('down','sm')}</summary><div class="kw-list">${inds.map(i=>{const o=kOffLbl(i,c),on=kOn(i,c),f=kStart(i,c);return `<div class="kw-li"><span class="grow"><b>${esc(i.name)}</b><small class="faint">${esc(i.unit||KTYPES[i.type])}${i.req?'':' · необязательный'}${o?' · '+esc(o):''}</small></span>${on?`<label class="row kw-from" title="С этого месяца показатель обязателен; за более ранние месяцы значения вносить можно, но незаполненными они не считаются"><span class="muted">с</span><input type="month" class="inp" data-kcf="${i.id}" value="${f}" max="${ym(TODAY)}" ${ed&&!c.archived?'':'disabled'} aria-label="«${esc(i.name)}»: вести с месяца"></label>`:''}<label class="row kw-on"><span class="muted">Вести</span><input type="checkbox" class="sw" data-kcw="${i.id}" ${on?'checked':''} ${ed&&!c.archived?'':'disabled'} aria-label="Вести «${esc(i.name)}»"></label></div>`}).join('')}</div>${ed?'':'<div class="hint">Менять может роль с правом «Настраивать показатели».</div>'}</details>`}
// «Показатели»: order by drag (arrows on the phone), archive, delete only without values.
function kpiSetupList(body){const inds=kInds(true);
  body.innerHTML=`<div class="note">${ic('info')}<span>Показатели — собственная настройка вашей организации: другие организации и администратор платформы их не видят. Порядок здесь — порядок в таблицах и в карточке контрагента; меняется перетаскиванием.</span></div>
  <div class="kset">${inds.map((i,j)=>{const n=IVALS.filter(v=>v.ind===i.id).length;return `<div class="kset-i ${i.archived?'arch':''}" draggable="${!isMobile()}" data-kid="${i.id}"><span class="kset-g" aria-hidden="true">${ic('grip')}</span><div class="grow"><div class="row" style="gap:8px"><b>${esc(i.name)}</b><span class="tag">${esc(i.unit||'—')}</span>${i.req?'<span class="pill blue sm">обязательный</span>':''}${i.archived?'<span class="tag">архив</span>':''}</div>
    <div class="hint" style="margin:3px 0 0">${KTYPES[i.type]} · основной итог: ${KAGG[i.main].toLowerCase()} · ${esc(kWhoTxt(i))} · вести с ${ymN(kStartI(i))} · заполнять до ${i.dueDay}-го числа следующего месяца · значений: ${n}</div>${i.desc?`<div class="hint" style="margin:2px 0 0">${esc(i.desc)}</div>`:''}</div>
    <button class="icon-btn sm" data-kup="${i.id}" ${j?'':'disabled'} aria-label="Выше">${ic('up','sm')}</button><button class="icon-btn sm" data-kdn="${i.id}" ${j<inds.length-1?'':'disabled'} aria-label="Ниже" style="transform:rotate(180deg)">${ic('up','sm')}</button><button class="icon-btn sm" data-kmore="${i.id}" aria-label="Действия">${ic('more','sm')}</button></div>`}).join('')}</div>
  <div class="row"><button class="btn cta" id="ks-add">${ic('plus')}Добавить показатель</button></div>`;
  const move=(id,to)=>{const l=kInds(true);const a=l.findIndex(x=>x.id===id);if(a<0||to<0||to>=l.length)return;const[x]=l.splice(a,1);l.splice(to,0,x);l.forEach((y,k)=>y.order=k+1);log('kind',id,`Порядок показателей: ${l.map(y=>y.name).join(', ')}`);renderPage()};
  $('#ks-add',body).onclick=()=>indDlg();
  body.onclick=e=>{let b;const l=kInds(true);
    if(b=e.target.closest('[data-kup]'))return move(b.dataset.kup,l.findIndex(x=>x.id===b.dataset.kup)-1);
    if(b=e.target.closest('[data-kdn]'))return move(b.dataset.kdn,l.findIndex(x=>x.id===b.dataset.kdn)+1);
    if(b=e.target.closest('[data-kmore]')){const i=IND.find(x=>x.id===b.dataset.kmore);const has=kHasVals(i);
      return menu(b,[{label:'Изменить',icon:'edit',run:()=>indDlg(i)},{label:i.archived?'Вернуть из архива':'В архив',icon:'archive',sub:i.archived?'':'Новых значений не будет, старые останутся видны',run:()=>{i.archived=!i.archived;touch(i);log('kind',i.id,`Показатель «${i.name}» ${i.archived?'отправлен в архив':'возвращён из архива'}`);kResync();refreshAll();toast(i.archived?'Показатель в архиве':'Показатель возвращён')}},
        {sep:true},{label:'Удалить',icon:'trash',danger:true,disabled:has,reason:'По показателю уже есть значения — отправьте его в архив',run:()=>confirmDlg({title:`Удалить показатель «${esc(i.name)}»?`,text:'Значений по нему нет, удаление ничего не затронет.',ok:'Удалить',danger:true,run:()=>{IND.splice(IND.indexOf(i),1);log('kind',i.id,`Показатель «${i.name}» удалён`);kResync();refreshAll();toast('Показатель удалён')}})}])}
    if(!e.target.closest('button')&&(b=e.target.closest('.kset-i')))indDlg(IND.find(x=>x.id===b.dataset.kid))};
  let drag=null;body.querySelectorAll('.kset-i').forEach(x=>{x.addEventListener('dragstart',e=>{drag=x.dataset.kid;x.classList.add('dragging');e.dataTransfer.effectAllowed='move'});x.addEventListener('dragend',()=>x.classList.remove('dragging'));
    x.addEventListener('dragover',e=>{e.preventDefault();x.classList.add('over')});x.addEventListener('dragleave',()=>x.classList.remove('over'));x.addEventListener('drop',e=>{e.preventDefault();x.classList.remove('over');if(drag&&drag!==x.dataset.kid)move(drag,kInds(true).findIndex(y=>y.id===x.dataset.kid))})})}
function indDlg(i0){if(!can('indSetup'))return toast('Нет права «Настраивать показатели»','alert',true);const has=i0&&kHasVals(i0);
  const st={name:i0?i0.name:'',unit:i0?i0.unit:'сом',type:i0?i0.type:'som',main:i0?i0.main:'sum',desc:i0?i0.desc:'',scope:i0?i0.scope:'all',sel:new Set(i0?kWhoAll().filter(c=>kOn(i0,c)).map(c=>c.id):[]),autoNew:i0?i0.autoNew!==false:true,f:{},req:i0?i0.req:true,dueDay:i0?i0.dueDay:10,start:i0?kStartI(i0):ym(TODAY)};
  const custom=()=>!KUNITS.includes(st.unit);
  openModal({form:true,size:'mid',render:m=>({title:i0?`Показатель «${esc(i0.name)}»`:'Новый показатель',sub:'Настройка организации: показатель увидят все сотрудники с доступом к контрагентам',
    body:`<div class="form">${fld('Название',inp('ki-n',st.name,'placeholder="Например: Выручка"'),{req:true,full:true,id:'ki-n'})}
      ${fld('Единица',sel('ki-u',[...KUNITS.map(u=>[u,u]),['_','своя подпись']],custom()?'_':st.unit,has?'disabled':''),{id:'ki-u',hint:has?'Нельзя менять: по показателю уже есть значения':''})}
      ${custom()?fld('Своя подпись',inp('ki-uc',st.unit==='_'?'':st.unit,'placeholder="Например: м²"'),{id:'ki-uc'}):'<div></div>'}
      ${fld('Тип значения',sel('ki-t',Object.entries(KTYPES),st.type,has?'disabled':''),{id:'ki-t',hint:has?'Нельзя менять: по показателю уже есть значения':''})}
      ${fld('Основной итог',sel('ki-a',Object.entries(KAGG),st.main),{id:'ki-a',hint:'Показывается первым: для выручки — сумма, для численности — среднее или последнее'})}
      ${fld('Описание',`<textarea class="inp" id="ki-d" style="min-height:60px" placeholder="Что и откуда брать — покажем подсказкой ⓘ при вводе">${esc(st.desc)}</textarea>`,{full:true,id:'ki-d'})}
      ${fld('Срок заполнения, число следующего месяца',inp('ki-due',st.dueDay,'type="number" min="1" max="28" style="width:110px"'),{id:'ki-due'})}
      ${fld('Вести с',`<input type="month" class="inp" id="ki-st" value="${st.start}" max="${ym(TODAY)}" style="width:auto">`,{id:'ki-st',hint:'С этого месяца показатель обязателен. Значения за более ранние месяцы вносить можно, но незаполненными они не считаются. У контрагента месяц «с …» меняется в его карточке'})}
      <div class="fld"><label class="lbl">&nbsp;</label><label class="row"><input type="checkbox" id="ki-req" ${st.req?'checked':''}> Обязательно заполнять каждый месяц</label><div class="hint">Незаполненный месяц попадёт во вкладку «Не заполнено»</div></div>
      <div class="fld full"><span class="lbl">Кому вести</span><div class="seg"><button data-ksc="all" class="${st.scope==='all'?'on':''}">Всем контрагентам</button><button data-ksc="sel" class="${st.scope==='sel'?'on':''}">Выбранным</button></div>
      ${st.scope==='all'?(i0&&i0.scope==='all'&&kWhoAll().some(c=>!kOn(i0,c))?`<div class="hint">Сейчас не ведётся у ${kWhoAll().filter(c=>!kOn(i0,c)).length} контрагентов — их меняют во вкладке «Кому вести» или в карточке контрагента</div>`:''):(()=>{const cs=kWhoFilter(st.f);const allOn=cs.length&&cs.every(c=>st.sel.has(c.id));
        return `<div style="margin-top:8px">${kWhoFiltHtml(st.f,'kd')}</div><div class="row" style="margin:6px 0"><span class="muted">Выбрано: ${st.sel.size} из ${kWhoAll().length}${cs.length<kWhoAll().length?` · в фильтре ${cs.length}`:''}</span><div class="grow"></div>${cs.length?`<button type="button" class="btn sm" id="ki-all">${allOn?'Снять все':'Выбрать все'}</button>`:''}</div>
        <div class="fl-list">${cs.map(c=>`<label><input type="checkbox" data-kcs="${c.id}" ${st.sel.has(c.id)?'checked':''}>${esc(c.name)} <small class="faint">${esc(c.regime||'')}${c.paused?' · приостановлен':''}</small></label>`).join('')||'<span class="faint" style="padding:6px">Никого не найдено</span>'}</div>`})()}
      <label class="row" style="margin-top:8px"><input type="checkbox" id="ki-auto" ${st.scope==='all'||st.autoNew?'checked':''} ${st.scope==='all'?'disabled':''}> Включать новых контрагентов автоматически</label>
      <div class="hint">${st.scope==='all'?'При «Всем контрагентам» новые контрагенты включаются всегда. ':''}У разовых и приостановленных контрагентов показатель не требуется, даже если он включён</div></div>
      ${i0?(()=>{const hs=HIST.filter(h=>h.ent==='kind'&&h.id===i0.id).slice().reverse().slice(0,30);return hs.length?`<details class="fld full"><summary class="lbl" style="cursor:pointer">История показателя · ${hs.length}</summary><div class="tbl-wrap"><table class="mini"><thead><tr><th>Когда</th><th>Кто</th><th>Что</th></tr></thead><tbody>${hs.map(h=>`<tr><td class="tnum">${fmtDT(h.at)}</td><td>${esc(whoName(h.who))}</td><td style="white-space:normal">${esc(h.what)}</td></tr>`).join('')}</tbody></table></div></details>`:''})():''}</div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ki-ok">${i0?'Сохранить':'Создать показатель'}</button>`,
    mount(el){const rd=()=>{st.name=val(el,'ki-n');st.desc=val(el,'ki-d');st.req=$('#ki-req',el).checked;st.dueDay=+val(el,'ki-due')||10;st.main=val(el,'ki-a');st.start=val(el,'ki-st')||st.start;if(!has){st.type=val(el,'ki-t');const u=val(el,'ki-u');st.unit=u==='_'?(el.querySelector('#ki-uc')?val(el,'ki-uc')||'_':'_'):u}};
      $('#ki-u',el).onchange=()=>{rd();m.draw()};$$('[data-ksc]',el).forEach(b=>b.onclick=()=>{rd();st.scope=b.dataset.ksc;if(st.scope==='sel'&&!st.sel.size&&!i0)kWhoAll().forEach(c=>st.sel.add(c.id));m.draw()});$$('[data-kcs]',el).forEach(x=>x.onchange=()=>{rd();x.checked?st.sel.add(+x.dataset.kcs):st.sel.delete(+x.dataset.kcs);m.draw()});
      const au=$('#ki-auto',el);if(au)au.onchange=()=>{if(st.scope==='sel')st.autoNew=au.checked};
      const ka=$('#ki-all',el);if(ka)ka.onclick=()=>{rd();const cs=kWhoFilter(st.f);const on=cs.every(c=>st.sel.has(c.id));cs.forEach(c=>on?st.sel.delete(c.id):st.sel.add(c.id));m.draw()};
      kWhoFiltBind(el,st.f,(k,x)=>{rd();m.draw();const n=el.querySelector(`[data-kf="${k}"]`);if(n&&x.tagName!=='SELECT'){n.focus();n.setSelectionRange(n.value.length,n.value.length)}});
      $('#ki-ok',el).onclick=()=>{rd();const nm=st.name.trim();const dup=IND.some(x=>x!==i0&&x.name.toLowerCase()===nm.toLowerCase());
        if(!setErr(el,'ki-n',!nm?'Введите название':dup?'Такой показатель уже есть':''))return;if(st.unit==='_'&&el.querySelector('#ki-uc')&&!setErr(el,'ki-uc','Введите подпись единицы'))return;
        if(st.dueDay<1||st.dueDay>28)return setErr(el,'ki-due','От 1 до 28');if(!setErr(el,'ki-st',st.start>ym(TODAY)?'Не позже текущего месяца':''))return;if(st.scope==='sel'&&!st.sel.size)return toast('Выберите хотя бы одного контрагента','alert',true);
        const d={name:nm,unit:st.unit==='_'?'':st.unit,type:st.type,main:st.main,desc:st.desc,req:st.req,dueDay:st.dueDay,start:st.start};
        if(i0){const ws=kStartI(i0);Object.assign(i0,d);if(ws!==st.start)log('kind',i0.id,`Показатель «${nm}»: вести с ${ymN(ws)} → с ${ymN(st.start)}`);kWhoApply(i0,st,false);touch(i0);log('kind',i0.id,`Показатель «${nm}» изменён`)}else{const n=born(Object.assign({id:'k'+(Math.max(0,...IND.map(x=>+x.id.slice(1)))+1),archived:false,order:IND.length+1,scope:'all',cps:[],off:{},from:{},seen:[],autoNew:true},d));kWhoApply(n,st,true);IND.push(n);log('kind',n.id,`Создан показатель «${nm}»`)}
        kResync();m.close();refreshAll();toast(i0?'Показатель сохранён':'Показатель создан','gauge')}}})})}
// Сохранение «Кому вести» из окна показателя: сверяет, у кого показатель вёлся и у кого должен вестись, пишет изменения в историю показателя и контрагента
function kWhoApply(i,st,isNew){const cs=CPS.filter(c=>c.kind!=='oneoff');const before=new Map(cs.map(c=>[c.id,isNew?null:kOn(i,c)]));const stayAll=!isNew&&i.scope==='all'&&st.scope==='all';
  i.scope=st.scope;i.autoNew=st.scope==='all'?true:st.autoNew;i.off=i.off||{};i.from=i.from||{};
  if(st.scope==='sel'){i.cps=[...st.sel];i.seen=CPS.map(c=>c.id)}else{i.cps=[];i.seen=[];if(!stayAll)i.off={}}
  cs.forEach(c=>{const b=before.get(c.id);const want=st.scope==='sel'?st.sel.has(c.id):stayAll?b:true;
    if(want){delete i.off[c.id];if(b===false)i.from[c.id]=kPrev()}else if(b)i.off[c.id]=ym(TODAY);
    if(b!=null&&b!==want)log('kind',i.id,`Показатель «${i.name}», ${c.name}: «${b?'Ведётся':'Не ведётся'}» → «${want?'Ведётся':'Не ведётся'}»`,c.id)})}
// One contractor × month: all indicators, comment and file per value, status scale and history.
function kEditDlg(c,m){if(!c)return;const ed=kCanEdit(c);
  openModal({form:true,size:'mid',live:true,render:mm=>{const inds=kInds(true).filter(i=>kCanVal(i,c,m)||kVal(c.id,i.id,m));const k=kMonth(c,m);const hs=IHIST.filter(x=>x.cp===c.id&&x.m===m).sort((a,b)=>a.at<b.at?1:-1);
    return {title:esc(c.name),sub:`Показатели за ${esc(ymLabel(m))} · заполнить до ${fmtD(kDue(c,m))}`,
    body:`${k?`<div class="box">${scaleFull('ind',k.status,k.id)}</div>`:''}<div class="note">${ic('info')}<span>Пусто — «не заполнено», 0 — «внесено, равно нулю». ${ed?'':'Вносит и правит ответственный, главный бухгалтер или владелец.'}</span></div>
      ${inds.length?inds.map(i=>{const v=kVal(c.id,i.id,m);const ro=!ed||i.archived;return `<div class="box flat kv-ed"><div class="row" style="gap:6px"><b>${esc(i.name)}</b>${i.desc?tipI(i.desc):''}${i.req?'':'<span class="tag">необязательный</span>'}${kEarly(i,c,m)?`<span class="tag" title="Месяц раньше «с ${ymN(kStart(i,c))}»: значение можно внести, но оно необязательно">ведётся с ${ymN(kStart(i,c))}</span>`:''}${i.archived?'<span class="tag">архив</span>':''}<div class="grow"></div>${v?`<span class="hint" style="margin:0">${esc(whoName(v.by))}, ${fmtDT(v.at)}</span>`:''}</div>
        <div class="form">${fld(`Значение, ${esc(i.unit||KTYPES[i.type].toLowerCase())}`,inp('kv-'+i.id,v?kNum(i,v.v):'',`inputmode="decimal" class="inp tnum" placeholder="пусто" ${ro?'readonly':''}`),{id:'kv-'+i.id})}${fld('Комментарий',inp('kn-'+i.id,v?v.note:'',`placeholder="Необязательно" ${ro?'readonly':''}`),{id:'kn-'+i.id})}
        ${ro?(v&&v.file?`<div class="fld"><span class="lbl">Файл</span><span class="tag">${ic('clip','sm')}${esc(v.file)}</span></div>`:''):fld('Файл',`${v&&v.file?`<span class="tag">${ic('clip','sm')}${esc(v.file)}</span>`:''}<input type="file" class="inp" id="kf-${i.id}">`,{id:'kf-'+i.id,hint:'Например, выписка'})}</div></div>`}).join(''):`<div class="state">${ic('gauge','lg')}<b>Показатели за этот месяц не нужны</b></div>`}
      ${hs.length?`<div class="box"><h3>История значений</h3><div class="tbl-wrap"><table class="mini"><thead><tr><th>Когда</th><th>Показатель</th><th>Было</th><th>Стало</th><th>Кто</th></tr></thead><tbody>${hs.map(x=>{const i=IND.find(y=>y.id===x.ind)||{name:'?'};return `<tr><td class="tnum">${fmtDT(x.at)}</td><td>${esc(i.name)}</td><td class="faint">${x.old==null?'пусто':esc(kFmt(i,x.old))}</td><td>${x.new==null?'пусто':esc(kFmt(i,x.new))}${x.src==='xlsx'?' <span class="tag">Из Excel</span>':''}</td><td>${esc(whoName(x.by))}</td></tr>`}).join('')}</tbody></table></div></div>`:''}
      ${k?statusHistHtml('ind',k,'История статусов'):''}`,
    foot:`<button class="btn ghost" data-close>${ed?'Отмена':'Закрыть'}</button>${ed?'<button class="btn cta" id="kv-ok">Сохранить</button>':''}`,
    mount(el){const ok=el.querySelector('#kv-ok');if(!ok)return;ok.onclick=()=>{let bad=false,n=0;
      inds.filter(i=>!i.archived).forEach(i=>{const v=kParse(i,val(el,'kv-'+i.id));if(Number.isNaN(v)){setErr(el,'kv-'+i.id,'Введите число');bad=true;return}setErr(el,'kv-'+i.id,'');
        const f=el.querySelector('#kf-'+i.id);const fn=f&&f.files&&f.files[0]?f.files[0].name:'';if(v==null&&!kVal(c.id,i.id,m))return;if(kSet(c,i,m,v,val(el,'kn-'+i.id),fn))n++});
      if(bad)return;mm.close();refreshAll();toast(n?`Сохранено: ${n}`:'Изменений нет')}}}}})}
// Карточка контрагента: какие месяцы не заполнены и кнопка «Внести за прошлые месяцы»
function kCardMissHtml(c,ed){const x=kMissOk()&&kMissCnt().by[c.id];const b=ed?`<button class="btn sm ${x?'cta':'dis'}" id="kc-past" ${x?'':'aria-disabled="true" data-why="Незаполненных месяцев нет: все обязательные показатели внесены"'}>${ic('edit','sm')}Внести за прошлые месяцы</button>`:'';
  if(!x)return b?`<div class="row kc-miss"><span class="hint grow" style="margin:0">Все обязательные показатели внесены с месяца «с …» до прошлого месяца.</span>${b}</div>`:'';
  return `<div class="note ${x.over?'red':'warn'} kc-miss">${ic('alert')}<span class="grow">Показатели не заполнены за ${x.ms.length} ${plural(x.ms.length,'месяц','месяца','месяцев')}: ${x.ms.map(ymN).join(', ')}${x.over?'':' — срок ещё не прошёл'}</span>${b}</div>`}
// «Внести за прошлые месяцы»: все незаполненные месяцы контрагента от «с …» до прошлого месяца по всем ведущимся показателям; ввод в ячейках, как в «Вводе за месяц».
// Список месяцев запоминается при открытии: заполненная строка не исчезает, пока окно открыто
function kPastDlg(c,done){if(!kCanEdit(c))return toast('Нет права «Вносить значения показателей»','lock',true);
  const ms=((kMissCnt().by[c.id]||{}).ms||[]).slice().sort();const inds=kInds().filter(i=>kOpen(i,c));
  openModal({form:true,size:'wide',onClose:()=>{refreshAll();done&&done()},render:mm=>{const left=()=>ms.filter(m=>kInds().some(i=>i.req&&kApplies(i,c,m)&&!kVal(c.id,i.id,m))).length;
    return {title:'Внести за прошлые месяцы',sub:esc(c.name),
    body:ms.length?`<div class="note">${ic('info')}<span>Незаполненные месяцы от «с …» до прошлого месяца. Пусто — «не заполнено», 0 — «внесено, равно нулю». Стрелки и Enter переходят между ячейками, можно вставить блок из Excel.</span></div>
      <div class="tbl-wrap kpi-wrap"><table class="kt kt-past"><thead><tr><th class="kt-cp">Месяц</th>${inds.map(i=>`<th class="num">${esc(i.name)}${i.desc?tipI(i.desc):''}<small>${esc(i.unit||KTYPES[i.type])}${i.req?'':' · необязательный'}</small></th>`).join('')}<th>Статус месяца</th></tr></thead><tbody>
      ${ms.map((m,ri)=>{const k=kMonth(c,m);return `<tr class="${k&&k.status==='Не заполнено'&&TODAY>kDue(c,m)?'overdue':''}" data-pm="${m}"><td class="kt-cp"><b>${esc(ymLabel(m))}</b><small class="faint">до ${fmtD(kDue(c,m))}</small></td>${inds.map((i,ci)=>{if(!kApplies(i,c,m))return `<td class="num faint kno" title="В этом месяце показатель не нужен">—</td>`;const v=kVal(c.id,i.id,m);
        return `<td class="num ${v?'':i.req?'emp':''}"><input class="kin" data-r="${ri}" data-c="${ci}" data-m="${m}" data-ind="${i.id}" value="${v?esc(kNum(i,v.v)):''}" inputmode="decimal" aria-label="${esc(i.name)}, ${esc(ymLabel(m))}"></td>`}).join('')}<td class="kst">${k?scaleMini('ind',k.status,k):'—'}</td></tr>`}).join('')}</tbody></table></div>`
      :`<div class="state">${ic('ok','lg')}<b>Всё заполнено</b><span>Обязательные показатели внесены за все месяцы.</span></div>`,
    foot:`<span class="hint grow" id="kp-left" style="margin:0">${ms.length?`Осталось незаполненных месяцев: ${left()} из ${ms.length}`:''}</span><button class="btn cta" data-close>Готово</button>`,
    mount(el){const at=(r,ci)=>el.querySelector(`.kin[data-r="${r}"][data-c="${ci}"]`);
      const put=(x,raw)=>{const i=IND.find(y=>y.id===x.dataset.ind),m=x.dataset.m;const v=kParse(i,raw);if(Number.isNaN(v))return 'bad';if(!kSet(c,i,m,v))return false;
        x.value=v==null?'':kNum(i,v);x.parentElement.classList.toggle('emp',v==null&&i.req);const tr=x.closest('tr'),k=KMI[c.id+'|'+m];tr.querySelector('.kst').innerHTML=k?scaleMini('ind',k.status,k):'—';tr.classList.toggle('overdue',!!k&&k.status==='Не заполнено'&&TODAY>kDue(c,m));return true};
      const upd=()=>{const l=el.querySelector('#kp-left');if(l)l.textContent=`Осталось незаполненных месяцев: ${left()} из ${ms.length}`;kLiveBadges()};
      $$('.kin',el).forEach(x=>{x.addEventListener('focus',()=>x.select());
        x.addEventListener('change',()=>{const r=put(x,x.value);if(r==='bad'){toast(`«${x.value}» — не число`,'alert',true);const i=IND.find(y=>y.id===x.dataset.ind),o=kVal(c.id,i.id,x.dataset.m);x.value=o?kNum(i,o.v):''}else if(r)upd()});
        x.addEventListener('keydown',e=>{const r=+x.dataset.r,ci=+x.dataset.c;let t=null;
          if(e.key==='ArrowDown'||e.key==='Enter'){for(let k=r+1;k<=ms.length&&!t;k++)t=at(k,ci)}if(e.key==='ArrowUp'){for(let k=r-1;k>=0&&!t;k--)t=at(k,ci)}
          if(e.key==='ArrowRight'&&x.selectionEnd===x.value.length){for(let k=ci+1;k<=inds.length&&!t;k++)t=at(r,k)}if(e.key==='ArrowLeft'&&x.selectionStart===0){for(let k=ci-1;k>=0&&!t;k--)t=at(r,k)}
          if(t){e.preventDefault();x.dispatchEvent(new Event('change'));t.focus()}});
        x.addEventListener('paste',e=>{const tx=(e.clipboardData||window.clipboardData).getData('text');if(!/[\t\n]/.test(tx.trim()))return;e.preventDefault();const r0=+x.dataset.r,c0=+x.dataset.c;let n=0,bad=0;
          tx.replace(/\r/g,'').replace(/\n$/,'').split('\n').forEach((line,dr)=>line.split('\t').forEach((cell,dc)=>{const y=at(r0+dr,c0+dc);if(!y)return;const r=put(y,cell);if(r==='bad')bad++;else if(r)n++}));
          upd();toast(`Вставлено значений: ${n}${bad?`, пропущено не чисел: ${bad}`:''}`,'paste')})})}}}})}
// Card tab «Показатели»: table indicator × month + totals, inline entry, chart of the chosen indicator.
function kpiCardHtml(c,st){const y=+TODAY.slice(0,4);st.kp=st.kp||{from:`${y}-01`,to:`${y}-12`};const p=st.kp;const ms=kMonths(p.from,p.to);
  const inds=kInds(true).filter(i=>kOpen(i,c)||ms.some(m=>kVal(c.id,i.id,m)));const ed=kCanEdit(c);st.kch=st.kch&&inds.find(i=>i.id===st.kch)?st.kch:(inds[0]||{}).id;
  const who=kpiCardWhoHtml(c)+kCardMissHtml(c,ed);
  if(!inds.length)return who+kPeriodBar(p,'kcp')+`<div class="state">${ic('gauge','lg')}<b>Показателей за этот период нет</b><span>${c.paused||c.archived?'Обслуживание приостановлено или контрагент в архиве.':'Показатели настраиваются в модуле «Показатели контрагентов».'}</span></div>`;
  const row=i=>{const vals=ms.map(m=>{const v=kVal(c.id,i.id,m);return v?v.v:null});return {vals,g:kAgg(vals),need:ms.filter(m=>kApplies(i,c,m)).length}};
  const cell=(i,m)=>{const v=kVal(c.id,i.id,m);const ap=kApplies(i,c,m);const emp=!v&&ap&&m<ym(TODAY);const early=kEarly(i,c,m);
    if(ed&&!i.archived&&(ap||v||early)&&m<=ym(TODAY))return `<td class="num ${emp?'emp':''} ${early?'kearly':''}"><input class="kin kin-c" data-ind="${i.id}" data-m="${m}" value="${v?esc(kNum(i,v.v)):''}" inputmode="decimal" ${early?`title="Ведётся с ${ymN(kStart(i,c))}: значение необязательно"`:''} aria-label="${esc(i.name)}, ${esc(ymLabel(m))}"></td>`;
    return `<td class="num ${emp?'emp':''}">${v?esc(kNum(i,v.v)):ap&&m<ym(TODAY)?'<span class="faint">пусто</span>':'<span class="faint">—</span>'}</td>`};
  const tots=(i,r)=>['sum','avg','max','min'].map(a=>`<td class="num ktot ${a===i.main?'strong':''}">${r.g.n?esc(kNum(i,a==='avg'?Math.round(r.g.avg*100)/100:r.g[a])):'—'}${a==='avg'&&r.g.n?`<small class="faint"> по ${r.g.n} из ${r.need||ms.length}</small>`:''}</td>`).join('');
  let h=who+kPeriodBar(p,'kcp')+`<div class="hint" style="margin:0">Итоги считаются только по заполненным месяцам. Незаполненные месяцы подсвечены.</div>`;
  if(isMobile()){h+=inds.map(i=>{const r=row(i);return `<div class="box kcard-i"><div class="row"><b class="grow">${esc(i.name)}</b>${i.desc?tipI(i.desc):''}<span class="tag">${esc(i.unit||'—')}</span></div>
      <div class="ktots">${['sum','avg','max','min'].map(a=>`<span class="${a===i.main?'on':''}"><small>${KAGG[a]}</small><b>${r.g.n?esc(kNum(i,a==='avg'?Math.round(r.g.avg*100)/100:r.g[a])):'—'}</b></span>`).join('')}</div>
      <table class="mini kmlist"><tbody>${ms.map(m=>`<tr><td>${esc(ymLabel(m))}</td>${cell(i,m)}</tr>`).join('')}</tbody></table></div>`}).join('');return h}
  h+=`<div class="tbl-wrap kpi-wrap"><table class="kt kt-card"><thead><tr><th class="kt-cp">Показатель</th>${['sum','avg','max','min'].map(a=>`<th class="num ktot-h">${KAGG[a]}</th>`).join('')}${ms.map(m=>`<th class="num">${ymS(m)}</th>`).join('')}</tr></thead><tbody>
    ${inds.map(i=>{const r=row(i);return `<tr class="${st.kch===i.id?'sel':''}"><td class="kt-cp"><button class="linkbtn" data-kch="${i.id}" title="Показать на графике">${esc(i.name)}</button>${i.desc?tipI(i.desc):''}<small class="faint"> ${esc(i.unit||'')}</small></td>${tots(i,r)}${ms.map(m=>cell(i,m)).join('')}</tr>`}).join('')}</tbody></table></div>`;
  const ci=inds.find(i=>i.id===st.kch);if(ci){const r=row(ci);const mx=Math.max(1,...r.vals.filter(v=>v!=null).map(Math.abs));const W=Math.max(320,ms.length*56),H=170;const bw=Math.min(36,W/ms.length-14);
    h+=`<div class="box"><h3>${esc(ci.name)} по месяцам<span class="grow"></span><span class="chk-n">${KAGG[ci.main]}: ${r.g.n?esc(kFmt(ci,ci.main==='avg'?Math.round(r.g.avg*100)/100:r.g[ci.main])):'—'}</span></h3><div style="overflow-x:auto"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="График «${esc(ci.name)}»" style="min-width:${Math.min(W,560)}px;display:block">
      <line x1="0" x2="${W}" y1="${H-24}" y2="${H-24}" stroke="var(--border)"/>${ms.map((m,j)=>{const v=r.vals[j];const x=j*(W/ms.length)+(W/ms.length-bw)/2;const bh=v==null?0:Math.max(2,Math.abs(v)/mx*(H-50));
        return `<g><title>${esc(ymLabel(m))}: ${v==null?'не заполнено':esc(kFmt(ci,v))}</title>${v==null?`<rect x="${x}" y="${H-28}" width="${bw}" height="4" rx="2" fill="var(--border-strong)"/>`:`<rect x="${x}" y="${H-24-bh}" width="${bw}" height="${bh}" rx="4" fill="var(--b-blue)"/>`}<text x="${x+bw/2}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--faint)">${ymS(m).split(' ')[0]}</text></g>`}).join('')}</svg></div><div class="hint" style="margin:0">Серые отметки — месяцы без значения: в итоги они не входят.</div></div>`}
  return h}
function kpiCardMount(el,c,st,mm){kBindPeriod(el,'kcp',st.kp,()=>mm.draw());
  $$('[data-kcw]',el).forEach(x=>x.onchange=()=>{const i=IND.find(y=>y.id===x.dataset.kcw);if(kSetOn(i,c,x.checked)){derive();mm.draw();refreshAll();toast(`«${i.name}»: ${x.checked?'ведётся':'не ведётся'}`,'gauge')}});
  $$('[data-kcf]',el).forEach(x=>x.onchange=()=>{const i=IND.find(y=>y.id===x.dataset.kcf),was=kStart(i,c),v=x.value;if(!v||v===was)return;if(v>ym(TODAY)){x.value=was;return toast('Месяц начала не может быть позже текущего','alert',true)}
    i.from=i.from||{};i.from[c.id]=v;touch(i);log('kind',i.id,`Показатель «${i.name}», ${c.name}: вести с ${ymN(was)} → с ${ymN(v)}`,c.id);kResync();derive();mm.draw();refreshAll();toast(`«${i.name}»: ведётся с ${ymN(v)}`,'gauge')});
  const kp=$('#kc-past',el);if(kp)kp.onclick=()=>kp.dataset.why?toast(kp.dataset.why,'lock',true):kPastDlg(c,()=>mm.draw());
  $$('[data-kch]',el).forEach(b=>b.onclick=()=>{st.kch=b.dataset.kch;mm.draw()});
  $$('.kin-c',el).forEach(x=>{x.addEventListener('focus',()=>x.select());x.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();x.blur()}});
    x.addEventListener('change',()=>{const i=IND.find(y=>y.id===x.dataset.ind),m=x.dataset.m;const v=kParse(i,x.value);if(Number.isNaN(v)){toast(`«${x.value}» — не число`,'alert',true);const o=kVal(c.id,i.id,m);x.value=o?kNum(i,o.v):'';return}
      if(kSet(c,i,m,v)){derive();mm.draw();toast('Сохранено')}})})}

