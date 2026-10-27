'use strict';
// Единый компонент списка (grid): столбцы, сортировка, группировка, фильтры, карточки
/* ═════════════ UnifiedDataGrid ═════════════ */
// «Все записи» — до 5 000 строк за раз, дальше страницы по 5 000 (решение заказчика 26.10.2026)
const GRID_ALL_MAX=5000;
// В фильтре-галочках — не больше 500 значений; «В Excel» — не больше 50 000 строк (решение заказчика 26.10.2026)
const GRID_ENUM_MAX=500,GRID_XLS_MAX=50000;
const GS={};let ACTIVE=[];let FAIL_NEXT=false;const CLOSED=new Set();
const norm=s=>String(s??'').toLowerCase().replace(/ё/g,'е').replace(/ /g,' ');
const strip=s=>norm(s).replace(/[\s\-()+.,№«»"]/g,'');
const COLL=new Intl.Collator('ru',{numeric:true,sensitivity:'base'});
function gst(cfg){let s=GS[cfg.id];if(!s){const sv=store.get('g5.'+cfg.id,{});s=GS[cfg.id]={view:sv.view||null,density:sv.density||'normal',width:sv.width||'full',hidden:new Set(sv.hidden||defHidden(cfg)),order:sv.order||null,widths:sv.widths||{},sort:sv.sort!==undefined?sv.sort:defSort(cfg),group:sv.group||[],agg:sv.agg||{},closed:new Set(),filters:{},page:0,size:sv.size||25,sel:new Set()}}return s}
/* Сортировка по умолчанию во всех списках — от новых к старым по «Создано» */
/* Видимые по умолчанию столбцы по спискам (ТЗ, «Столбцы, видимые по умолчанию»); остальные — в меню «Столбцы» */
const SHOW={'cp-rep':['type','act','period','due','status','sum','got','paid','resp'],'rep-':['cp','type','act','period','due','status','wait','sum','got','paid','resp'],
 'cps-':['name','inn','regime','resp','over','svc'],'tasks-':['title','cp','exec','date','status'],'staff':['fio','role','phone','cps','over','active','kb'],
 'fin-journal':['date','cp','total','dist','adv','files'],'cp-fin':['date','cat','what','amount','acc'],'fin-svc':null,'fin-':['date','cp','cat','what','amount','acc'],
 'proj-':['name','cp','from','to','resps','status','paid'],'files':['name','cp','src','by','date'],'dict-types':['on','name','act','pays','organ','per','rule','file','rcpt','used'],
 'bonus':['month','emp','cp','sum'],'an-cps':['cp','feeCh','fee','debt','total'],'adm-users':['login','fio','org','role','last','active'],'adm-orgs':['name','inn','owner','cps','staff','active']};
function defHidden(cfg){const k=Object.keys(SHOW).find(k=>cfg.id===k)||Object.keys(SHOW).find(k=>k.endsWith('-')&&cfg.id.startsWith(k));const sh=k&&SHOW[k];
  if(!sh)return cfg.cols.filter(c=>c.hide).map(c=>c.key);const keys=cfg.cols.map(c=>c.key);if(!sh.some(x=>keys.includes(x)))return cfg.cols.filter(c=>c.hide).map(c=>c.key);
  const v=sh.filter(x=>keys.includes(x));return keys.filter(x=>!v.includes(x))}
function defSort(cfg){return cfg.ordered?cfg.sort:cfg.cols.some(c=>c.key==='_ca')?{key:'_ca',dir:-1}:cfg.sort||null}
function gsave(id){const s=GS[id];store.set('g5.'+id,{view:s.view,density:s.density,width:s.width,hidden:[...s.hidden],order:s.order,widths:s.widths,size:s.size,sort:s.sort,group:s.group,agg:s.agg})}
const fmtDT=v=>v?fmtD(String(v).slice(0,10))+(String(v).length>10?' '+String(v).slice(11,16):''):'';
function colTxt(c,r){if(c.text)return c.text(r);const v=c.val(r);if(v==null||v==='')return '';if(c.type==='date')return fmtD(v);if(c.type==='datetime')return fmtDT(v);if(c.type==='money')return fmtM(v);return String(v)}
function ftype(c){return c.type==='enum'?'enum':c.type==='date'||c.type==='datetime'?'date':['money','num','int'].includes(c.type)?'num':'text'}
function passF(c,f,r){const v=c.val(r);
  if(f.type==='text')return c.match?c.match(r,f.q):norm(colTxt(c,r)).includes(norm(f.q));
  if(f.type==='enum')return f.vals.includes(v==null?'':String(v));
  if(f.type==='num'){if(v==null||v==='')return false;return (f.from==null||v>=f.from)&&(f.to==null||v<=f.to)}
  if(f.type==='date'){if(!v)return false;const d=String(v).slice(0,10);return (!f.from||d>=f.from)&&(!f.to||d<=f.to)}
  return true}
function chipText(c,f){
  if(f.type==='text')return `«${f.q}»`;
  if(f.type==='enum'){const l=f.vals.map(v=>v===''?'(Пусто)':v);return l.length>2?`${l.slice(0,2).join(', ')} +${l.length-2}`:l.join(', ')}
  if(f.type==='num')return [f.from!=null?`от ${fmtM(f.from,false)}`:'',f.to!=null?`до ${fmtM(f.to,false)}`:''].filter(Boolean).join(' ');
  if(f.type==='date')return [f.from?`с ${fmtD(f.from)}`:'',f.to?`по ${fmtD(f.to)}`:''].filter(Boolean).join(' ');
}
function clearSearch(){S.search='';const q=$('#q');if(q)q.value=''}

const NUMT=['money','num','int'];
const AGG_L={sum:'Сумма',avg:'Среднее',min:'Минимум',max:'Максимум',count:'Количество'};
function gKey(c,r){const v=c.val(r);if(v==null||v==='')return '';return c.type==='datetime'?String(v).slice(0,10):String(v)}
function gLabel(c,r){const v=c.val(r);if(v==null||v==='')return '(Пусто)';if(c.type==='datetime')return fmtD(String(v).slice(0,10));return colTxt(c,r)||'(Пусто)'}
function aggVal(c,how,rows){const xs=rows.map(r=>c.val(r)).filter(v=>v!=null&&v!==''&&!isNaN(+v)).map(Number);if(how==='count')return xs.length;if(!xs.length)return null;if(how==='avg')return xs.reduce((a,b)=>a+b,0)/xs.length;if(how==='min')return Math.min(...xs);if(how==='max')return Math.max(...xs);return xs.reduce((a,b)=>a+b,0)}
// Итог в строке группы: по умолчанию сумма у всех числовых столбцов (ТЗ «Группировка», решение заказчика 26.10.2026); выбор пользователя сохраняется в виде
function aggOf(s,c){return s.agg[c.key]!=null?s.agg[c.key]:NUMT.includes(c.type)?'sum':''}
function aggTxt(c,how,v){if(v==null)return '—';if(how==='count'||(c.type==='int'&&how!=='avg'))return String(v);return fmtM(v,c.type==='money'||how==='avg')}
/* Служебные колонки: Создал / Изменил / Создано / Изменено — во всех списках по умолчанию */
function auditCols(acc){const A=r=>(acc?acc(r):r)||{};return [
 {key:'_cb',hide:1,label:'Создал',type:'enum',w:136,audit:1,val:r=>whoName(A(r)._cb)},
 {key:'_ub',hide:1,label:'Изменил',type:'enum',w:136,audit:1,val:r=>whoName(A(r)._ub||A(r)._cb)},
 {key:'_ca',hide:1,label:'Создано',type:'datetime',w:146,audit:1,val:r=>A(r)._ca||null},
 {key:'_ua',hide:1,label:'Изменено',type:'datetime',w:146,audit:1,val:r=>A(r)._ua||A(r)._ca||null}]}
function grid(host,cfg){
  if(cfg.audit!==false&&!cfg._aud){cfg.cols=cfg.cols.concat(auditCols(cfg.audit));cfg._aud=1}
  const s=gst(cfg);const g={cfg,host,s,refresh};ACTIVE.push(g);
  if(cfg.preset){s.filters=JSON.parse(JSON.stringify(cfg.preset));s.page=0}
  const rid=r=>String(cfg.rid?cfg.rid(r):r.id);
  const cols=()=>{const keys=cfg.cols.map(c=>c.key);const ord=(s.order||[]).filter(k=>keys.includes(k));keys.forEach(k=>{if(!ord.includes(k))ord.splice(keys.indexOf(k),0,k)});return ord.map(k=>cfg.cols.find(c=>c.key===k))};
  const vis=()=>{const v=cols().filter(c=>!s.hidden.has(c.key)&&!(c.deskOnly&&isMobile()));return v.length?v:[cols()[0]]};
  let byId={};
  const gcols=()=>(s.group||[]).map(k=>cols().find(c=>c.key===k)).filter(Boolean);
  function groupTree(rows,lv,path){const gc=gcols();if(lv>=gc.length)return null;const c=gc[lv];const m=new Map();
    rows.forEach(r=>{const k=gKey(c,r);if(!m.has(k))m.set(k,{k,label:gLabel(c,r),sv:c.sortVal?c.sortVal(r):k===''?'':c.val(r),rows:[]});m.get(k).rows.push(r)});
    const d=s.sort&&s.sort.key===c.key?s.sort.dir:1;const arr=[...m.values()].sort((a,b)=>a.k===''?1:b.k===''?-1:d*(typeof a.sv==='number'&&typeof b.sv==='number'?a.sv-b.sv:COLL.compare(String(a.sv),String(b.sv))));
    arr.forEach(g=>{g.path=path+'›'+g.k;g.lv=lv;g.sub=groupTree(g.rows,lv+1,g.path)});return arr}
  function compute(){
    const all=(typeof cfg.rows==='function'?cfg.rows():cfg.rows);byId={};all.forEach(r=>byId[rid(r)]=r);
    const ac=cols(),vc=vis();
    let rows=all.filter(r=>Object.entries(s.filters).every(([k,f])=>{const c=ac.find(x=>x.key===k);return !c||passF(c,f,r)}));
    const q=cfg.search===false?'':S.search.trim();
    if(q){const nq=norm(q),sq=strip(q);rows=rows.filter(r=>vc.some(c=>{const t=colTxt(c,r);return norm(t).includes(nq)||(sq.length>=3&&strip(t).includes(sq))}))}
    if(s.sort){const c=ac.find(x=>x.key===s.sort.key);if(c){const d=s.sort.dir;rows=rows.slice().sort((a,b)=>{const va=c.sortVal?c.sortVal(a):c.val(a),vb=c.sortVal?c.sortVal(b):c.val(b);const ea=va==null||va==='',eb=vb==null||vb==='';if(ea&&eb)return 0;if(ea)return 1;if(eb)return -1;return d*(typeof va==='number'&&typeof vb==='number'?va-vb:COLL.compare(String(va),String(vb)))})}}
    return {all,rows,vc,ac};
  }
  function refresh(){
    const {all,rows,vc,ac}=compute();g.rows=rows;
    const total=rows.length;const size=s.size==='all'?Math.min(Math.max(total,1),GRID_ALL_MAX):s.size;const pages=Math.max(1,Math.ceil(total/size));if(s.page>=pages)s.page=pages-1;
    const gt=gcols().length?groupTree(rows,0,''):null;g.tree=gt;
    const pr=gt?rows:rows.slice(s.page*size,s.page*size+size);
    const view=cfg.fixedView||s.view||(isMobile()?'cards':'table');
    const selRows=[...s.sel].filter(id=>byId[id]);s.sel=new Set(selRows);
    const fk=Object.keys(s.filters).filter(k=>ac.find(c=>c.key===k));
    let h=`<div class="gtools">`;
    if(s.sel.size&&cfg.bulk){h+=`<div class="bulkbar"><b>Выбрано: ${s.sel.size}</b>${cfg.bulk.map((b,i)=>`<button class="btn sm ${b.danger?'danger':''}" data-bulk="${i}">${ic(b.icon||'check')}${esc(b.label)}</button>`).join('')}<button class="icon-btn sm" data-a="unsel" aria-label="Снять выбор" title="Снять выбор">${ic('x')}</button></div>`}
    else h+=`<div class="gcount">${cfg.caption?cfg.caption(rows):`<span>${total} ${plural(total,...(cfg.noun||['запись','записи','записей']))}</span>`}</div>`;
    h+=`<div class="grow"></div>`;
    /* На телефоне (до 768 px) кнопки панели — только значками с подсказкой, вид списка — одна кнопка-переключатель (ТЗ, «Панель над списком») */
    const mob=isMobile(),ng=gcols().length;
    if(!cfg.fixedView){if(mob){const to=view==='table'?'cards':'table',tl=to==='table'?'Таблица':'Карточки';h+=`<button class="icon-btn sm raised" data-view="${to}" title="${tl}" aria-label="Вид списка: ${tl}">${ic(to,'sm')}</button>`}
      else h+=`<div class="seg" role="group" aria-label="Вид списка"><button data-view="table" class="${view==='table'?'on':''}" title="Таблица">${ic('table','sm')}<span>Таблица</span></button><button data-view="cards" class="${view==='cards'?'on':''}" title="Карточки">${ic('cards','sm')}<span>Карточки</span></button></div>`}
    if(mob)h+=`<button class="icon-btn sm raised gt-ic ${ng?'on':''}" data-a="grp" title="Группировка${ng?` (${ng})`:''}" aria-label="Группировка${ng?` (${ng})`:''}">${ic('layers','sm')}${ng?`<span class="gt-n">${ng}</span>`:''}</button><button class="icon-btn sm raised" data-a="cols" title="Столбцы (${vc.length}/${ac.length})" aria-label="Столбцы (${vc.length}/${ac.length})">${ic('columns','sm')}</button><button class="icon-btn sm raised" data-a="opts" title="Плотность и ширина" aria-label="Настройки вида">${ic('sliders','sm')}</button>`;
    else h+=`<button class="btn sm ${ng?'on':''}" data-a="grp" title="Группировать список по столбцам (до двух уровней)">${ic('layers','sm')}Группировка${ng?` (${ng})`:''}</button><button class="btn sm" data-a="cols">${ic('columns','sm')}Столбцы (${vc.length}/${ac.length})</button><button class="icon-btn sm raised" data-a="opts" title="Плотность и ширина" aria-label="Настройки вида">${ic('sliders','sm')}</button>`;
    if(cfg.exportable!==false&&(isAdmin()||can('export')))h+=mob?`<button class="icon-btn sm raised" data-a="xls" title="В Excel: скачать файл .xlsx со всеми отфильтрованными записями" aria-label="В Excel">${ic('download','sm')}</button>`:`<button class="btn sm" data-a="xls" title="Скачать файл .xlsx со всеми отфильтрованными записями">${ic('download','sm')}В Excel</button>`;
    h+=`</div>`;
    const gc=gcols();if(fk.length||gc.length||(S.search&&cfg.search!==false))h+=`<div class="chips">${gc.length?`<span class="chip"><span><b>Группировка:</b> ${gc.map(c=>esc(c.label)).join(' → ')}</span><button data-a="ungrp" aria-label="Убрать группировку">${ic('x','sm')}</button></span>`:''}${S.search&&cfg.search!==false?`<span class="chip"><span><b>Поиск:</b> «${esc(S.search)}»</span><button data-a="clrq" aria-label="Очистить поиск">${ic('x','sm')}</button></span>`:''}${fk.map(k=>{const c=ac.find(x=>x.key===k);return `<span class="chip"><span><b>${esc(c.label)}:</b> ${esc(chipText(c,s.filters[k]))}</span><button data-clr="${k}" aria-label="Убрать фильтр">${ic('x','sm')}</button></span>`}).join('')}<button class="linkbtn" data-a="clrall" style="font-size:12.5px">Сбросить всё</button></div>`;
    if(cfg.error)h+=`<div class="state">${ic('alert','lg')}<b>Не удалось загрузить список</b><span>Проверьте подключение к интернету и попробуйте ещё раз.</span><button class="btn cta" data-a="retry">${ic('refresh','sm')}Повторить</button></div>`;
    else if(cfg.loading)h+=skel();
    else if(!total)h+=emptyHtml(all.length||fk.length||(S.search&&cfg.search!==false));
    else h+=view==='table'?tableHtml(pr,vc,rows,gt):cardsHtml(pr,vc,rows,gt);
    if(total&&gt)h+=`<div class="gfoot"><span>Групп: ${gt.length} · записей: ${total}</span><div class="grow"></div><button class="linkbtn" data-a="gall">Развернуть все</button><button class="linkbtn" data-a="gnone">Свернуть все</button></div>`;
    else if(total)h+=`<div class="gfoot"><span>Показано ${fmtM(s.page*size+1,false)}–${fmtM(Math.min(total,(s.page+1)*size),false)} из ${fmtM(total,false)}</span><div class="grow"></div><label>На странице ${sel('pg-'+cfg.id,[[25,'25'],[50,'50'],[100,'100'],['all','Все записи']],s.size,'data-a="size" style="display:inline-block;width:auto"')}</label><button class="icon-btn sm" data-a="prev" ${s.page?'':'disabled'} aria-label="Назад">${ic('left')}</button><span class="tnum">${s.page+1} / ${pages}</span><button class="icon-btn sm" data-a="next" ${s.page<pages-1?'':'disabled'} aria-label="Вперёд">${ic('right')}</button></div>`;
    const sc=host.querySelector('.gscroll');const keep=sc?[sc.scrollTop,sc.scrollLeft]:null;
    host.className='grid';host.dataset.density=s.density;host.dataset.width=s.width;host.innerHTML=h;
    const sc2=host.querySelector('.gscroll');if(sc2&&keep){sc2.scrollTop=keep[0];sc2.scrollLeft=keep[1]}
    bind(vc,ac,pr,rows);
  }
  function skel(){return `<div class="gscroll" style="padding:14px;display:flex;flex-direction:column;gap:14px">${Array.from({length:6},(_,i)=>`<div style="display:flex;gap:16px">${[30,18,14,16,12].map(w=>`<div class="skel" style="width:${w+(i*7)%9}%"></div>`).join('')}</div>`).join('')}</div>`}
  function emptyHtml(any){
    if(!any){const fe=cfg.firstRun===false?null:firstEmpty();g.fe=fe;if(fe)return feHtml(fe);const e=cfg.empty||{};return `<div class="state">${ic(e.icon||'list','lg')}<b>${esc(e.title||'Здесь пока пусто')}</b>${e.text?`<span>${esc(e.text)}</span>`:''}${e.add?`<button class="btn cta" data-a="emptyadd">${ic('plus')}Добавить</button>`:''}</div>`}
    return `<div class="state">${ic('search','lg')}<b>Ничего не найдено</b><span>Под поиск и фильтры не подходит ни одна запись.</span><button class="linkbtn" data-a="clrall">Сбросить фильтры</button></div>`}
  function W(c){return s.widths[c.key]||c.w||140}
  function tableHtml(pr,vc,rows,gt){
    const selCol=!!cfg.bulk;const tw=vc.reduce((a,c)=>a+W(c),0)+(selCol?38:0)+(cfg.actions?44:0);
    let h=`<div class="gscroll"><table class="gt" style="width:${tw}px"><colgroup>${selCol?'<col style="width:38px">':''}${vc.map(c=>`<col data-c="${c.key}" style="width:${W(c)}px">`).join('')}${cfg.actions?'<col style="width:44px">':''}</colgroup><thead><tr>`;
    if(selCol)h+=`<th class="selc"><input type="checkbox" data-a="selall" aria-label="Выбрать все на странице" ${pr.length&&pr.every(r=>s.sel.has(rid(r)))?'checked':''}></th>`;
    vc.forEach(c=>{const so=s.sort&&s.sort.key===c.key?s.sort.dir:0;const fa=!!s.filters[c.key];
      h+=`<th data-k="${c.key}" draggable="true" class="${c.num?'num':''}" aria-sort="${so>0?'ascending':so<0?'descending':'none'}"><div class="thc"><button class="th-sort ${so?'on':''}" data-sort="${c.key}" title="Сортировать: ${esc(c.label)}"><span>${esc(c.label)}</span>${so?ic(so>0?'up':'dn','sm'):''}</button>${c.nofilter?'':`<button class="th-f ${fa?'on':''}" data-filt="${c.key}" aria-label="Фильтр: ${esc(c.label)}" title="Фильтр">${ic('filter','sm')}</button>`}</div><span class="resz" data-rz="${c.key}" title="Ширина столбца"></span></th>`});
    if(cfg.actions)h+=`<th class="actc"></th>`;
    h+=`</tr></thead><tbody>`;
    const rowTr=r=>{const id=rid(r);return `<tr data-id="${esc(id)}" tabindex="0" class="${cfg.rowClass?cfg.rowClass(r):''} ${s.sel.has(id)?'sel':''}">`+(selCol?`<td class="selc"><input type="checkbox" data-sel="${esc(id)}" ${s.sel.has(id)?'checked':''} aria-label="Выбрать строку"></td>`:'')+vc.map(c=>`<td class="${c.num?'num':''} ${c.cls||''}" title="${esc(colTxt(c,r))}">${c.html?c.html(r):esc(colTxt(c,r))}</td>`).join('')+(cfg.actions?`<td class="actc"><button class="icon-btn sm" data-menu="${esc(id)}" aria-label="Действия">${ic('more')}</button></td>`:'')+`</tr>`};
    let span=0;while(span<vc.length&&!NUMT.includes(vc[span].type))span++;span=Math.max(1,span);
    const grpTr=gr=>{const open=!s.closed.has(gr.path);return `<tr class="g-row lv${gr.lv}">${selCol?'<td></td>':''}<td colspan="${span}" class="g-l"><button class="g-tg" data-g="${esc(gr.path)}" aria-expanded="${open}" style="padding-left:${gr.lv*22}px">${ic(open?'down':'right','sm')}<b>${esc(gr.label)}</b><span class="g-c">${gr.rows.length}</span></button></td>${vc.slice(span).map(c=>{const how=NUMT.includes(c.type)&&aggOf(s,c);if(!how)return '<td></td>';return `<td class="num g-a" title="${AGG_L[how]}: ${esc(c.label)}">${aggTxt(c,how,aggVal(c,how,gr.rows))}</td>`}).join('')}${cfg.actions?'<td></td>':''}</tr>`};
    const walk=arr=>arr.map(gr=>grpTr(gr)+(s.closed.has(gr.path)?'':gr.sub?walk(gr.sub):gr.rows.map(rowTr).join(''))).join('');
    h+=gt?walk(gt):pr.map(rowTr).join('');
    h+='</tbody>';
    if(vc.some(c=>c.total)){h+=`<tfoot><tr>${selCol?'<td></td>':''}${vc.map((c,i)=>c.total?`<td class="num">${fmtM(rows.reduce((a,r)=>a+(+c.val(r)||0),0))}</td>`:i===0?`<td>Итого по фильтру · ${rows.length}</td>`:'<td></td>').join('')}${cfg.actions?'<td></td>':''}</tr></tfoot>`}
    return h+'</table></div>';
  }
  // Столбцы с cline на телефоне — одной строкой плитки: «К уплате 5 000 · Получено 5 000 · Оплачено 3 000»; cl — короткая подпись, cv — значение для плитки
  const clineHtml=(cs,r)=>{const ps=cs.map(c=>{const v=c.val(r);return v==null||v===''?'':`<span>${esc(c.cl||c.label)} <b>${c.cv?c.cv(r):esc(colTxt(c,r))}</b></span>`}).filter(Boolean);return ps.length?`<dd class="gc-line">${ps.join('<i>·</i>')}</dd>`:''};
  function cardsHtml(pr,vc,rows,gt){
    const tc=vc.find(c=>c.key===cfg.title)||vc[0];const rest=vc.filter(c=>c!==tc&&!c.audit);const au=vc.filter(c=>c.audit);const AU=k=>au.find(c=>c.key===k);
    const audLine=r=>{if(!au.length)return '';const part=(w,t)=>{const a=AU(w),b=AU(t);if(!a&&!b)return '';return `${a?esc(colTxt(a,r)):''}${a&&b?', ':''}${b?esc(colTxt(b,r)):''}`};const c1=part('_cb','_ca'),c2=part('_ub','_ua');return `<div class="gc-aud">${c1?`<span>Создал: ${c1}</span>`:''}${c2?`<span>Изменил: ${c2}</span>`:''}</div>`};
    const card=r=>{const id=rid(r);return `<div class="gcard ${cfg.rowClass?cfg.rowClass(r):''} ${s.sel.has(id)?'sel':''}" data-id="${esc(id)}" tabindex="0"><div class="gc-h">${cfg.bulk?`<input type="checkbox" data-sel="${esc(id)}" ${s.sel.has(id)?'checked':''} aria-label="Выбрать">`:''}<div class="gc-t">${tc.html?tc.html(r):esc(colTxt(tc,r))}</div>${cfg.actions?`<button class="icon-btn sm" data-menu="${esc(id)}" aria-label="Действия">${ic('more')}</button>`:''}</div><dl>${rest.map(c=>{if(c.cline)return c===rest.find(x=>x.cline)?clineHtml(rest.filter(x=>x.cline),r):'';const v=c.html?c.html(r):esc(colTxt(c,r));return `<dt>${esc(c.label)}</dt><dd>${v===''?'<span class="faint">—</span>':v}</dd>`}).join('')}</dl>${audLine(r)}</div>`};
    const nums=vc.filter(c=>NUMT.includes(c.type)&&aggOf(s,c));
    const walk=arr=>arr.map(gr=>{const open=!s.closed.has(gr.path);return `<div class="gc-grp lv${gr.lv}"><button class="g-tg" data-g="${esc(gr.path)}" aria-expanded="${open}">${ic(open?'down':'right','sm')}<b>${esc(gr.label)}</b><span class="g-c">${gr.rows.length}</span></button>${nums.length?`<span class="gc-agg">${nums.map(c=>{const how=aggOf(s,c);return `<span>${esc(c.label)}${how==='sum'?'':' ('+AGG_L[how].toLowerCase()+')'}: <b>${aggTxt(c,how,aggVal(c,how,gr.rows))}</b></span>`}).join('')}</span>`:''}</div>${open?(gr.sub?`<div class="gc-sub">${walk(gr.sub)}</div>`:`<div class="gcards">${gr.rows.map(card).join('')}</div>`):''}`}).join('');
    let h=gt?`<div class="gc-groups">${walk(gt)}</div>`:`<div class="gcards">${pr.map(card).join('')}</div>`;
    const tcs=vc.filter(c=>c.total);
    if(tcs.length)h+=`<div class="gtotal"><span>Итого по фильтру · ${rows.length}</span>${tcs.map(c=>`<span>${esc(c.label)}: <b>${fmtM(rows.reduce((a,r)=>a+(+c.val(r)||0),0))}</b></span>`).join('')}</div>`;
    return h;
  }
  function filterPop(btn,c){
    const f=s.filters[c.key];const t=ftype(c);let body='',keys=[],on=null,fmatch=null,fvals=null;
    if(t==='text')body=`<input class="inp" id="gf-q" placeholder="Содержит…" value="${esc(f?f.q:'')}">`;
    if(t==='num')body=`<div class="row" style="flex-wrap:nowrap">${inp('gf-from',f&&f.from!=null?f.from:'','placeholder="От" inputmode="decimal"')}${inp('gf-to',f&&f.to!=null?f.to:'','placeholder="До" inputmode="decimal"')}</div><div class="hint">Границы включительно</div>`;
    if(t==='date')body=`<div class="fld"><label class="lbl" for="gf-from">С даты</label>${inp('gf-from',f?f.from||'':'','type="date"')}</div><div class="fld"><label class="lbl" for="gf-to">По дату</label>${inp('gf-to',f?f.to||'':'','type="date"')}</div>`;
    if(t==='enum'){const all=(typeof cfg.rows==='function'?cfg.rows():cfg.rows);const cnt={};all.forEach(r=>{const v=c.val(r);const k=v==null?'':String(v);cnt[k]=(cnt[k]||0)+1});
      keys=Object.keys(cnt).sort((a,b)=>a===c.pin?-1:b===c.pin?1:a===''?1:b===''?-1:COLL.compare(a,b));on=f?new Set(f.vals):new Set(keys);
      // Показываются первые 500 значений; «Найти значение» ищет по всем, отметки скрытых значений сохраняются
      fmatch=q=>q?keys.filter(k=>norm(k).includes(q)):keys;
      fvals=q=>{const m=fmatch(q);return {html:m.slice(0,GRID_ENUM_MAX).map(k=>`<label data-v="${esc(norm(k))}"><input type="checkbox" class="gf-v" value="${esc(k)}" ${on.has(k)?'checked':''}> ${k===''?'<i class="faint">(Пусто)</i>':esc(k)}<span class="n">${cnt[k]}</span></label>`).join(''),more:m.length>GRID_ENUM_MAX?`Показаны первые ${fmtM(GRID_ENUM_MAX,false)} значений из ${fmtM(m.length,false)} — сузьте список поиском`:'',all:m.every(k=>on.has(k))}};
      const v0=fvals('');
      body=`${keys.length>8?`<input class="inp" id="gf-find" placeholder="Найти значение">`:''}<div class="fl-list"><label><input type="checkbox" id="gf-all" ${v0.all?'checked':''}> <b>Выбрать все</b></label><div id="gf-vals">${v0.html}</div></div><div class="hint" id="gf-more" ${v0.more?'':'hidden'}>${esc(v0.more)}</div>`}
    const ing=(s.group||[]).includes(c.key);
    openPop(btn,`<h4>${esc(c.label)}</h4>${body}<button class="linkbtn" id="gf-grp" style="margin-top:8px;font-size:12.5px">${ic('layers','sm')} ${ing?'Убрать группировку по этому столбцу':'Группировать по этому столбцу'}</button><div class="pop-actions"><button class="btn sm ghost" id="gf-clr">Очистить</button><button class="btn sm cta" id="gf-ok">Применить</button></div>`,{cls:'pad',mount(el){
      const all=$('#gf-all',el),fd=$('#gf-find',el),fq=()=>fd?norm(fd.value):'';
      if(t==='enum'){const show=()=>{const v=fvals(fq());$('#gf-vals',el).innerHTML=v.html;const mo=$('#gf-more',el);mo.textContent=v.more;mo.hidden=!v.more;all.checked=v.all};
        // «Выбрать все» отмечает все значения, подходящие под «Найти значение», в том числе не показанные
        all.onchange=()=>{fmatch(fq()).forEach(k=>all.checked?on.add(k):on.delete(k));$$('.gf-v',el).forEach(x=>x.checked=all.checked)};
        $('#gf-vals',el).onchange=e=>{const x=e.target.closest('.gf-v');if(!x)return;x.checked?on.add(x.value):on.delete(x.value);all.checked=fmatch(fq()).every(k=>on.has(k))};
        if(fd)fd.oninput=show}
      const apply=()=>{let nf=null;
        if(t==='text'){const q=$('#gf-q',el).value.trim();if(q)nf={type:'text',q}}
        if(t==='num'){const a=parseNum($('#gf-from',el).value),b=parseNum($('#gf-to',el).value);if(!isNaN(a)||!isNaN(b))nf={type:'num',from:isNaN(a)?null:a,to:isNaN(b)?null:b}}
        if(t==='date'){const a=$('#gf-from',el).value,b=$('#gf-to',el).value;if(a||b)nf={type:'date',from:a||null,to:b||null}}
        if(t==='enum'){const v=keys.filter(k=>on.has(k));if(v.length<keys.length)nf={type:'enum',vals:v}}
        if(nf)s.filters[c.key]=nf;else delete s.filters[c.key];s.page=0;closePop();refresh()};
      $('#gf-grp',el).onclick=()=>{if(ing)s.group=s.group.filter(k=>k!==c.key);else if(s.group.length<2)s.group=[...s.group,c.key];else{s.group=[s.group[0],c.key];toast('Не больше двух уровней — второй уровень заменён')}s.closed=new Set();gsave(cfg.id);closePop();refresh()};
      $('#gf-ok',el).onclick=apply;$('#gf-clr',el).onclick=()=>{delete s.filters[c.key];s.page=0;closePop();refresh()};
      el.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply()}});
    }});
  }
  function groupPop(btn){
    const ac=cols();const o=[['','— нет —'],...ac.map(c=>[c.key,c.label])];
    const nums=ac.filter(c=>NUMT.includes(c.type)&&!s.hidden.has(c.key));
    openPop(btn,`<h4>Группировка</h4><div class="fld"><label class="lbl" for="gg-1">Уровень 1</label>${sel('gg-1',o,s.group[0]||'')}</div><div class="fld"><label class="lbl" for="gg-2">Уровень 2 (внутри первого)</label>${sel('gg-2',o,s.group[1]||'',s.group[0]?'':'disabled')}</div>${nums.length?`<div class="lbl" style="margin-top:10px">Итоги в строке группы</div>${nums.map(c=>`<div class="row" style="flex-wrap:nowrap;align-items:center;gap:8px;margin-top:6px"><label for="ga-${c.key}" style="flex:1;font-size:13px">${esc(c.label)}</label>${sel('ga-'+c.key,[['','Не считать'],...Object.entries(AGG_L)],aggOf(s,c),`data-agg="${c.key}" style="width:140px"`)}</div>`).join('')}`:''}<div class="hint">Не больше двух уровней. Группы сворачиваются по нажатию на строку группы.</div><div class="pop-actions"><button class="btn sm ghost" id="gg-clr">Убрать</button><button class="btn sm cta" id="gg-ok">Применить</button></div>`,{cls:'pad',mount(el){
      const a=$('#gg-1',el),b=$('#gg-2',el);a.onchange=()=>{b.disabled=!a.value;if(!a.value)b.value=''};
      $('#gg-ok',el).onclick=()=>{s.group=[...new Set([a.value,b.disabled?'':b.value].filter(Boolean))];$$('[data-agg]',el).forEach(x=>s.agg[x.dataset.agg]=x.value);s.closed=new Set();gsave(cfg.id);closePop();refresh()};
      $('#gg-clr',el).onclick=()=>{s.group=[];gsave(cfg.id);closePop();refresh()}}});
  }
  function colsPop(btn){
    const list=()=>{const ac=cols();return ac.map((c,i)=>`<div class="cl-row" draggable="true" data-ck="${c.key}"><span class="cl-h" title="Перетащите, чтобы поменять порядок">${ic('grip','sm')}</span><label><input type="checkbox" class="gc-c" value="${c.key}" ${s.hidden.has(c.key)?'':'checked'}> <span class="cl-t">${esc(c.label)}</span>${c.audit?'<span class="n">системный</span>':''}</label><button class="icon-btn xs" data-mv="-1" data-ck="${c.key}" ${i?'':'disabled'} aria-label="Выше: ${esc(c.label)}" title="Выше">${ic('up','sm')}</button><button class="icon-btn xs" data-mv="1" data-ck="${c.key}" ${i<ac.length-1?'':'disabled'} aria-label="Ниже: ${esc(c.label)}" title="Ниже">${ic('dn','sm')}</button></div>`).join('')};
    openPop(btn,`<h4>Столбцы</h4><div class="fl-list cl-list" style="max-height:340px">${list()}</div><div class="hint">Галочка — показать столбец. Порядок — перетащите строку или стрелками. Последний столбец скрыть нельзя.</div>`,{cls:'pad cl-pop',mount(el){
      const L=$('.cl-list',el);
      const sync=()=>{const on=$$('.gc-c',el).filter(x=>x.checked);on.forEach(x=>x.disabled=on.length===1);$$('.gc-c',el).filter(x=>!x.checked).forEach(x=>x.disabled=false)};sync();
      const after=()=>{gsave(cfg.id);refresh();const b=host.querySelector('[data-a=cols]');if(b)POP_ANCHOR=b};
      const redraw=()=>{const st=L.scrollTop;L.innerHTML=list();L.scrollTop=st;sync()};
      const move=(k,to)=>{const ord=cols().map(c=>c.key);const i=ord.indexOf(k);if(i<0||to===i)return;ord.splice(i,1);ord.splice(to,0,k);s.order=ord;after();redraw();const r=L.querySelector(`[data-ck="${k}"]`);if(r){r.classList.add('moved');const f=r.querySelector(`[data-mv]`);}};
      el.addEventListener('change',e=>{const x=e.target.closest('.gc-c');if(!x)return;if(x.checked)s.hidden.delete(x.value);else s.hidden.add(x.value);sync();after()});
      el.addEventListener('click',e=>{const b=e.target.closest('[data-mv]');if(!b)return;e.preventDefault();const ord=cols().map(c=>c.key);const i=ord.indexOf(b.dataset.ck);move(b.dataset.ck,Math.max(0,Math.min(ord.length-1,i+(+b.dataset.mv))));const nb=L.querySelector(`[data-ck="${b.dataset.ck}"] [data-mv="${b.dataset.mv}"]`);if(nb&&!nb.disabled)nb.focus()});
      let dk=null;
      L.addEventListener('dragstart',e=>{const r=e.target.closest('.cl-row');if(!r)return;dk=r.dataset.ck;r.classList.add('drag');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dk)}catch(_){}});
      L.addEventListener('dragover',e=>{const r=e.target.closest('.cl-row');if(!dk||!r)return;e.preventDefault();$$('.cl-row.dragover',L).forEach(x=>x!==r&&x.classList.remove('dragover'));r.classList.add('dragover')});
      L.addEventListener('drop',e=>{const r=e.target.closest('.cl-row');if(!dk||!r)return;e.preventDefault();const ord=cols().map(c=>c.key);const k=dk;dk=null;move(k,ord.indexOf(r.dataset.ck))});
      L.addEventListener('dragend',()=>{dk=null;$$('.cl-row',L).forEach(x=>x.classList.remove('dragover','drag'))});
    }});
  }
  function rowMenu(anchor,r,pt){if(!cfg.actions)return;menu(anchor,cfg.actions(r),pt)}
  function bind(vc,ac,pr,rows){
    host.onclick=e=>{
      const t=e.target;let b;
      if(b=t.closest('[data-sort]')){const k=b.dataset.sort;const cur=s.sort&&s.sort.key===k?s.sort.dir:0;s.sort=cur===0?{key:k,dir:1}:cur===1?{key:k,dir:-1}:null;gsave(cfg.id);refresh();return}
      if(b=t.closest('[data-g]')){const p=b.dataset.g;if(s.closed.has(p))s.closed.delete(p);else s.closed.add(p);refresh();return}
      if(b=t.closest('[data-filt]')){filterPop(b,ac.find(c=>c.key===b.dataset.filt));return}
      if(b=t.closest('[data-menu]')){rowMenu(b,byId[b.dataset.menu]);ckHit('rowmenu.'+cfg.id);return}
      if(b=t.closest('[data-view]')){s.view=b.dataset.view;gsave(cfg.id);refresh();return}
      if(b=t.closest('[data-clr]')){delete s.filters[b.dataset.clr];s.page=0;refresh();return}
      if(b=t.closest('[data-bulk]')){ckHit('bulk');const list=[...s.sel].map(id=>byId[id]).filter(Boolean);cfg.bulk[+b.dataset.bulk].run(list,()=>{s.sel.clear()});return}
      if(b=t.closest('[data-a]')){const a=b.dataset.a;
        if(a==='cols'){colsPop(b);ckHit('cols')}
        if(a==='grp'){groupPop(b);ckHit('grp')}
        if(a==='ungrp'){s.group=[];gsave(cfg.id);refresh()}
        if(a==='gall'){s.closed=new Set();refresh()}
        if(a==='gnone'){const all=[];const w=arr=>arr.forEach(x=>{all.push(x.path);if(x.sub)w(x.sub)});w(g.tree||[]);s.closed=new Set(all);refresh()}
        if(a==='opts')menu(b,[{label:'Обычно',icon:'list',on:s.density==='normal',run:()=>{s.density='normal';gsave(cfg.id);refresh()}},{label:'Компактно',icon:'menu',on:s.density==='compact',run:()=>{s.density='compact';gsave(cfg.id);refresh()}},{sep:true},{label:'На весь экран',icon:'columns',on:s.width==='full',run:()=>{s.width='full';gsave(cfg.id);refresh()}},{label:'По центру',icon:'table',on:s.width==='center',run:()=>{s.width='center';gsave(cfg.id);refresh()}},{sep:true},{label:'Сбросить вид',icon:'refresh',sub:'Столбцы, порядок, ширины, сортировка, группировка, плотность',run:()=>{delete GS[cfg.id];store.set('g5.'+cfg.id,{});const ns=gst(cfg);Object.assign(s,ns,{filters:s.filters});GS[cfg.id]=s;refresh();toast('Вид списка сброшен')}}]);
        // «В Excel» — файл .xlsx со всеми отфильтрованными записями и видимыми столбцами (решение заказчика 26.10.2026); в окне внутри другой страницы (артефакт claude.ai) скачивание может быть запрещено — тогда строки ещё и копируются для вставки в Excel
        // Больше 50 000 строк не выгружается: в файл идут первые 50 000, уведомление просит сузить фильтр
        if(a==='xls'){ckHit('xls');const vc=[...vis(),...cols().filter(c=>c.xls&&!vis().includes(c))];const isN=c=>NUMT.includes(c.type);
          const xr=g.rows.slice(0,GRID_XLS_MAX),tot=g.rows.length,cut=tot>xr.length&&`Выгружено ${fmtM(xr.length,false)} строк из ${fmtM(tot,false)} — сузьте фильтр, чтобы выгрузить остальные`;
          const sheet=[vc.map(c=>({v:c.label,s:XL_ST.head})),...xr.map(r=>vc.map(c=>{const v=c.val(r);if(isN(c))return v==null||v===''||isNaN(v)?'':+v;return colTxt(c,r).replace(/\s*\n\s*/g,' ')}))];
          const md=host.closest('.modal'),m0=curMod(),t0=modTabs(m0).find(t=>t.id===S.tab);const ttl=md?(md.querySelector('.mh h2')||{}).textContent||'Список':m0.title+(t0&&t0.label!==m0.title?' — '+t0.label:'');
          const nm=`${ttl.replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim().slice(0,90)} ${fmtD(TODAY)}.xlsx`,n=xr.length,cnt=`${n} ${plural(n,'запись','записи','записей')}`;
          xlSave(xlWrite([{name:(md?'Список':m0.short||m0.title),rows:sheet,freeze:{y:1},widths:vc.map(c=>Math.max(8,Math.min(60,Math.round((c.w||120)/7))))}]),nm);
          let framed=false;try{framed=window.self!==window.top}catch(e){framed=true}
          if(!framed)toast(cut||`Скачан файл «${nm}»: ${cnt}`,cut?'alert':'download');
          else{const tsv=[vc.map(c=>c.label).join('\t'),...xr.map(r=>vc.map(c=>{const v=c.val(r);if(isN(c))return v==null?'':String(v).replace('.',',');return colTxt(c,r).replace(/[\t\n]/g,' ')}).join('\t'))].join('\n');
            const m1=cut?cut+'.':`Файл «${nm}» скачивается (${cnt}).`,ico=cut?'alert':'download',msg=`${m1} Если здесь скачивание запрещено, строки скопированы — вставьте их в Excel`;try{navigator.clipboard.writeText(tsv).then(()=>toast(msg,ico),()=>toast(m1,ico))}catch(e){toast(m1,ico)}}}
        if(a==='retry'){cfg.error=false;cfg.loading=true;refresh();setTimeout(()=>{cfg.loading=false;if(host.isConnected)refresh()},400);return}
        if(a==='clrall'){s.filters={};s.page=0;if(S.search){clearSearch();ACTIVE.forEach(x=>x.refresh())}else refresh()}
        if(a==='clrq'){clearSearch();ACTIVE.forEach(x=>x.refresh())}
        if(a==='prev'){s.page--;refresh()}if(a==='next'){s.page++;refresh()}
        if(a==='unsel'){s.sel.clear();refresh()}
        if(a==='emptyadd')cfg.empty.add();
        if(a==='fe'){const x=g.fe.btns.filter(Boolean)[+b.dataset.i];x&&x[2]()}
        return}
      if(t.closest('a,button,input,select,label,textarea'))return;
      const row=t.closest('[data-id]');if(row&&!row.dataset.lp&&cfg.open)cfg.open(byId[row.dataset.id]);if(row)delete row.dataset.lp;
    };
    host.onchange=e=>{const t=e.target;
      if(t.dataset.sel!=null){const id=t.dataset.sel;if(t.checked)s.sel.add(id);else s.sel.delete(id);refresh()}
      if(t.dataset.a==='selall'){pr.forEach(r=>{if(t.checked)s.sel.add(rid(r));else s.sel.delete(rid(r))});refresh()}
      if(t.dataset.a==='size'){s.size=t.value==='all'?'all':+t.value;s.page=0;gsave(cfg.id);refresh()}
    };
    host.oncontextmenu=e=>{const row=e.target.closest('[data-id]');if(!row||!cfg.actions||e.target.closest('a'))return;e.preventDefault();rowMenu(row,byId[row.dataset.id],{x:e.clientX,y:e.clientY})};
    host.onkeydown=e=>{const row=e.target.closest&&e.target.closest('tr[data-id],.gcard[data-id]');if(row&&e.target===row&&e.key==='Enter'&&cfg.open)cfg.open(byId[row.dataset.id]);if(row&&e.target===row&&(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10'))){e.preventDefault();rowMenu(row,byId[row.dataset.id])}};
    let lp=null;
    let lpx=0,lpy=0;host.onpointerdown=e=>{if(e.pointerType!=='touch')return;const row=e.target.closest('[data-id]');if(!row||!cfg.actions)return;const x=e.clientX,y=e.clientY;lpx=x;lpy=y;lp=setTimeout(()=>{row.dataset.lp='1';rowMenu(row,byId[row.dataset.id],{x,y});if(navigator.vibrate)try{navigator.vibrate(15)}catch(_){} },550)};
    const cancel=()=>{clearTimeout(lp)};host.onpointerup=cancel;host.onpointercancel=cancel;host.onpointermove=e=>{if(e.pointerType==='touch'&&Math.hypot(e.clientX-lpx,e.clientY-lpy)>8)cancel()};host.addEventListener('touchmove',e=>{const t=e.touches[0];if(t&&Math.hypot(t.clientX-lpx,t.clientY-lpy)>8)cancel()},{passive:true});
    // resize
    $$('.resz',host).forEach(rz=>{rz.onpointerdown=e=>{e.preventDefault();e.stopPropagation();const k=rz.dataset.rz;const th=rz.closest('th');th.draggable=false;const col=host.querySelector(`col[data-c="${k}"]`);const tb=host.querySelector('table.gt');const x0=e.clientX,w0=col.offsetWidth||parseInt(col.style.width),tw0=tb.offsetWidth;rz.classList.add('act');rz.setPointerCapture(e.pointerId);
      rz.onpointermove=ev=>{const w=Math.max(70,w0+ev.clientX-x0);col.style.width=w+'px';tb.style.width=(tw0+w-w0)+'px';s.widths[k]=w};
      rz.onpointerup=()=>{rz.onpointermove=null;rz.classList.remove('act');th.draggable=true;gsave(cfg.id)}}});
    // reorder
    let dragK=null;
    $$('th[data-k]',host).forEach(th=>{
      th.ondragstart=e=>{dragK=th.dataset.k;e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragK)}catch(_){}};
      th.ondragover=e=>{if(!dragK)return;e.preventDefault();th.classList.add('dragover')};
      th.ondragleave=()=>th.classList.remove('dragover');
      th.ondrop=e=>{e.preventDefault();th.classList.remove('dragover');const to=th.dataset.k;if(!dragK||dragK===to)return;const ord=cols().map(c=>c.key);ord.splice(ord.indexOf(dragK),1);ord.splice(ord.indexOf(to),0,dragK);s.order=ord;dragK=null;gsave(cfg.id);refresh()};
      th.ondragend=()=>{dragK=null};
    });
  }
  if(cfg.simulateLoad||FAIL_NEXT){cfg.loading=true;refresh();setTimeout(()=>{cfg.loading=false;if(FAIL_NEXT){FAIL_NEXT=false;cfg.error=true}if(host.isConnected)refresh()},260)}else refresh();
  return g;
}

