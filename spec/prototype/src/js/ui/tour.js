'use strict';
// Обучение: подробный показ «Показать как» и «Обзор экрана» по живому экрану, «Войти как»
/* ═════════════ Показ по экрану (ТЗ «База знаний» → «Показать как») ═════════════ */
/* Пункт показа: {s,m,t,x,in,txt,up,scr,ctx,pre,sub,kind,f}
   s/m — элемент на ПК и на телефоне (CSS-селектор), in — где искать (например '.modal' — верхнее окно), txt — найти элемент по тексту,
   scr — экран 'модуль.вкладка', ctx — контекст: пункты одного контекста идут без закрытия окон, pre — как открыть контекст с экрана
   (открыть карточку, меню, форму), sub — что сделать внутри контекста (вкладка карточки, меню), kind — 'done' / 'doit' / 'end' / 'save' у последнего облачка,
   g — код общего элемента (одинаковый на всех экранах: поиск, «Столбцы», «На весь экран»…), common — признак «Общий элемент» у облачка сценария, mt — окно, в котором элемент.
   Тексты элементов — справочник refDB.kbUi, сценарии шагов — refDB.kbShows; в коде только движок. */
const TOUR={on:false,list:[],i:0,key:'',kind:'',sid:null,ctx:null,scr:null,mbase:0,busy:false,form:false,o:null,all:false,skip:null};
const KBUI=DB.ref.kbUi,KBSH=DB.ref.kbShows;
const tVis=el=>!!(el&&el.isConnected&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
const tWait=ms=>new Promise(r=>setTimeout(r,ms));
const tq=(k,d)=>{const v=KBUI.ui[k];return v==null?d||'':v};
const tLbl=el=>{if(!el)return '';const l=el.querySelector('.lbl');const t=(l||el).textContent.replace(/\s+/g,' ').trim();return t||el.getAttribute('aria-label')||el.title||''};
// Экран готов: нет скелетона загрузки списка
async function tSettle(min=180){await tWait(min);for(let k=0;k<25&&$('#mbody .skel, .modal .skel');k++)await tWait(80)}
function tRoot(p){if(!p.in)return document;const l=$$(p.in).filter(tVis);return l[l.length-1]||null}
function tFind(p){const r=tRoot(p);if(!r)return null;
  if(p.txt){const w=document.createTreeWalker(r,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(n.nodeValue.includes(p.txt)&&tVis(n.parentElement)){const el=p.up?n.parentElement.closest(p.up):n.parentElement;if(el&&tVis(el))return el}}return null}
  const s=isMobile()&&p.m?p.m:p.s;if(!s)return null;return s.split(/\s*\|\|\s*/).map(x=>[...r.querySelectorAll(x)].find(tVis)).find(Boolean)||null}
function tClick(sel,root){const el=[...(root||document).querySelectorAll(sel)].find(tVis);if(el){el.click();return true}return false}
// Действия перед показом пункта
async function tAct(a){if(!a)return;
  // Открывается первая обычная строка, бледная (приостановленная, неподключённая) — только если других нет
  if(a==='row'){if(!tClick('#mbody tbody tr[data-id]:not(.muted), #mbody .gcard:not(.muted)'))tClick('#mbody tbody tr[data-id], #mbody .gcard');await tSettle(320);return}
  // {row:'К сдаче'} — первая запись списка с этим текстом (например, со статусом)
  if(a.row){const r=$$('#mbody tbody tr[data-id], #mbody .gcard').filter(tVis).find(x=>x.textContent.includes(a.row));if(r){r.click();await tSettle(320)}else await tAct('row');return}
  if(a==='menu'){if(POP&&POP_ANCHOR&&POP_ANCHOR.matches('[data-menu]'))return;tClick('#mbody [data-menu]');await tWait(120);return}
  // {menuWith:'Создать уточнённый'} — меню «…» первой строки, где есть это действие (оно есть не у всех записей); {rowWith:…} — карточка этой строки.
  // Меню открывается и закрывается в один ход, без мигания; такой строки нет — как 'menu' и 'row'
  if(a.menuWith||a.rowWith){const l=a.menuWith||a.rowWith;const has=()=>!!POP&&$$('.mi',POP).some(x=>x.textContent.includes(l));
    if(a.menuWith&&POP&&POP_ANCHOR&&POP_ANCHOR.matches('[data-menu]')&&has())return;
    for(const r of $$('#mbody tbody tr[data-id], #mbody .gcard').filter(tVis)){const b=r.querySelector('[data-menu]');if(!b)continue;b.click();const ok=has();if(ok&&a.menuWith){await tWait(120);return}closePop();if(ok){r.click();await tSettle(320);return}}
    return tAct(a.menuWith?'menu':'row')}
  if(a==='add'){if(POP&&POP_ANCHOR&&POP_ANCHOR.matches('#add-btn,#fab'))return;tClick(isMobile()?'#fab':'#add-btn');await tWait(120);return}
  if(['cols','grp','opts'].includes(a)){if(POP&&POP_ANCHOR&&POP_ANCHOR.matches(`[data-a=${a}]`))return;tClick(`#mbody [data-a=${a}]`);await tWait(120);return}
  if(a==='filter'){if(POP&&POP_ANCHOR&&POP_ANCHOR.matches('.th-f'))return;tClick('#mbody .th-f');await tWait(120);return}
  if(a==='stepgo'){const i=TOUR.sid&&ckFind(TOUR.sid);if(i&&i.go)i.go();await tSettle(520);return}
  if(a==='pop'){closePop();return}
  if(a.click){const r=a.in?tRoot(a):document;if(!r)return;if(a.pop&&POP&&POP_ANCHOR&&POP_ANCHOR.matches(a.click))return;tClick(a.click,r);await tSettle(a.pop?120:260);return}
  // {tab:'Обслуживание'} — вкладка верхнего окна; на телефоне видна только текущая, остальные нажимаются скрытыми
  if(a.tab){const md=MODALS[MODALS.length-1];const t=md&&$$('.ctabs .tab',md.el).find(x=>tLbl(x).replace(/\s*\d+ из \d+.*$/,'')===a.tab);if(t&&!t.classList.contains('on')){t.click();await tSettle(220)}return}
  if(a.nav){const[m,t]=a.nav.split('.');if(S.mod!==m||(t&&S.tab!==t)){go(m,t||null);await tSettle(260)}return}}
const tScr=()=>S.mod+(S.tab?'.'+S.tab:'');
async function tBase(scr){closePop();while(MODALS.length>TOUR.mbase)MODALS[MODALS.length-1].close();if(scr&&scr!==tScr()){const[m,t]=scr.split('.');go(m,t||null);await tSettle(300)}}
// Привести экран к пункту: при смене контекста — назад к экрану и заново pre; внутри контекста — только sub
async function tPrep(p){const scr=p.scr||TOUR.scr;if(p.ctx!==TOUR.ctx||(scr&&scr!==tScr())){await tBase(scr);for(const a of p.pre||[])await tAct(a);TOUR.ctx=p.ctx}
  const opensPop=(p.sub||[]).some(a=>['menu','add','cols','grp','opts','filter'].includes(a)||(a&&(a.pop||a.menuWith)));if(!opensPop)closePop();for(const a of p.sub||[])await tAct(a);
  // Плашка, спрятанная вместе со статистикой (на телефоне по умолчанию), на время показа видна; выбор пользователя не меняется
  if(/\.plate\b/.test(p.s||'')){const pg=$('#page');if(pg&&pg.classList.contains('nostats'))pg.classList.remove('nostats')}}

/* Тексты для элементов: справочник kbUi */
const tTabTxt=(mod,id,label)=>(KBUI.tabs||{})[mod+'.'+id]||tq('tab').replace('{t}',label);
// Ключ справочника по точному названию или по началу (например «Выручка за» для «Выручка за 2026»)
const tKey=(m,l)=>{m=m||{};if(m[l]!=null)return m[l];const k=Object.keys(m).filter(x=>l.startsWith(x)).sort((a,b)=>b.length-a.length)[0];return k?m[k]:''};
// Что делает плашка: открывает список (Главная), вкладку, фильтрует или только показывает итог — по справочнику plateMode
const tPlateTxt=(lbl,sub)=>{const k=tKey(KBUI.plates,lbl);sub=(sub||'').replace(/[.\s]+$/,'');const s=sub?`Сейчас: ${sub}. `:'';const pm=KBUI.plateMode||{};const md=pm[tScr()]||pm[S.mod]||'filter';
  return s+(k||tq({go:'plateGo',tab:'plateTab',info:'plateInfo'}[md]||'plateFilter'))};
const tBtnTxt=l=>tKey(KBUI.buttons,l);
// Переключатель: пояснение по названию (или по его началу, например «Основной счёт — …»)
const tSwTxt=l=>{const d=tKey(KBUI.fields,l);return d?(d.x||d):''};
function tFieldTxt(f){const id=f.dataset.f||'';const lab=f.querySelector(':scope > label');const l=lab?lab.textContent.trim():'';const h=f.querySelector(':scope > .hint');
  const d=(KBUI.fields||{})[id]||(KBUI.fields||{})[l];const own=d?(d.x||d):'';const hint=h?h.textContent.trim():'';
  return {t:l||tq('fieldNoName'),req:!!(lab&&lab.classList.contains('req')),x:own||hint||tq(lab&&lab.classList.contains('req')?'fieldReq':'fieldOpt')}}

/* Раскрытие автоматических частей показа */
function tExpTitle(){const m=curMod();return [{s:'#tb-title',m:'#tb-title',t:m.title,x:(KBUI.mods||{})[m.id]||m.desc}]}
function tExpTabs(){const m=curMod();return $$('#tabs .tab').map(a=>{const h=a.getAttribute('href');const id=h.split('.')[1];const l=tLbl(a).replace(/\s*\d+$/,'');return {s:`#tabs .tab[href="${h}"]`,t:`Вкладка «${l}»`,x:tTabTxt(m.id,id,l)}})}
function tExpAdd(){const m=curMod();const P=[];$$('#page .add-x').forEach(b=>{const l=tLbl(b);P.push({s:`#page [data-addx="${b.dataset.addx}"]`,t:`Кнопка «${l}»`,x:tBtnTxt(l)||(KBUI.addItems||{})[l]||tq('btn')})});
  // Номер пункта в меню считается вместе с разделителями — так же, как его нумерует menu()
  const all=m.add?m.add().filter(Boolean):[];const menuIts=isMobile()?all:all.filter(a=>!a.btn);const adds=menuIts.filter(a=>!a.sep);if(!adds.length)return P;
  P.push({s:'#add-btn',m:'#fab',t:isMobile()?'Кнопка «+»':'Кнопка «+ Добавить»',x:((KBUI.add||{})[m.id]||tq('add'))+(adds.length>1?' '+tq('addMenu').replace('{n}',adds.length):'')});
  if(adds.length>1)menuIts.forEach((a,k)=>{if(!a.sep)P.push({ctx:'add',sub:['add'],s:`.pop .mi[data-i="${k}"]`,t:`«${a.label}»`,x:(KBUI.addItems||{})[a.label]||tBtnTxt(a.label)||a.sub||tq('addItem')})});
  return P}
function tExpPlates(){return $$('#mbody .plates .plate').filter(tVis).map(b=>{const l=b.querySelector('.pl-top').textContent.trim();const v=b.querySelector('.pl-val');const sub=b.querySelector('.pl-sub');
  return {s:`#mbody .plate[data-plate="${b.dataset.plate}"]`,t:`Плашка «${l}»`,x:tPlateTxt(l,[v&&v.textContent.trim(),sub&&sub.textContent.trim()].filter(Boolean).join(' — '))}})}
function tExpEls(at){const k=tScr();return (KBUI.els||[]).filter(e=>(e.at||'body')===at&&(e.scr===k||e.scr===S.mod||e.scr==='*')&&tFind(e)).map(e=>Object.assign(e.scr==='*'?{g:'el:'+e.id}:{},e))}
// Блоки экрана с заголовком (кроме блока со списком — список разбирается отдельно)
function tExpBoxes(sel){const inM=/^\.modal/.test(sel||'');return $$(sel||'#mbody .box').filter(b=>tVis(b)&&b.querySelector(':scope > h3')&&!b.querySelector('.grid')&&!b.closest('.grid')&&!b.closest('.pop')).map(b=>{const h=b.querySelector(':scope > h3');const t=(h.childNodes[0]&&h.childNodes[0].textContent||h.textContent).replace(/\s*·\s*\d+.*$/,'').trim();
  return {s:null,el:b,in:inM?'.modal':undefined,t:`Блок «${t}»`,x:tKey(KBUI.boxes,t)||tq('box')}}).filter(x=>x.t!=='Блок «»')}
function tExpGrid(){const g=$('#mbody .grid');if(!g||!tVis(g))return [];const P=[];const sel=x=>'#mbody '+x;
  if($(sel('.state'),g)){const st=$('#mbody .grid .state');P.push({s:sel('.grid .state'),t:'Пока пусто',x:(st.querySelector('b')||st).textContent.trim()+'. '+tq('empty')});return P}
  P.push({s:sel('.gcount'),t:'Число записей',x:tq('gcount'),g:'gcount'});
  if($(sel('[data-view]')))P.push({s:sel('.seg[aria-label="Вид списка"]'),m:sel('[data-view]'),t:'«Таблица / Карточки»',x:tq('view'),g:'view'});
  P.push({s:sel('[data-a=grp]'),t:'«Группировка»',x:tq('grp'),g:'grp'});
  P.push({s:sel('[data-a=cols]'),t:'«Столбцы»',x:tq('cols'),g:'cols'});P.push({ctx:'cols',sub:['cols'],s:'.pop',t:'Меню «Столбцы»',x:tq('colsMenu'),g:'colsMenu'});
  P.push({s:sel('[data-a=opts]'),t:'Настройки вида',x:tq('opts'),g:'opts'});
  if($(sel('[data-a=xls]')))P.push({s:sel('[data-a=xls]'),t:'«В Excel»',x:tq('xls'),g:'xls'});
  const th=$$('#mbody .gt thead th[data-k]').map(x=>'«'+x.textContent.trim()+'»');
  if(th.length){P.push({s:sel('.gt thead tr'),t:'Столбцы списка',x:tq('thead').replace('{cols}',th.slice(0,8).join(', ')+(th.length>8?` и ещё ${th.length-8}`:''))});
    P.push({s:sel('.gt thead .th-f'),t:'Фильтр столбца',x:tq('filterBtn'),g:'filterBtn'});P.push({ctx:'filter',sub:['filter'],s:'.pop',t:'Окно фильтра',x:tq('filter'),g:'filter'})}
  if($(sel('th.selc input, .gcard [data-sel]')))P.push({s:sel('th.selc'),m:sel('.gcard [data-sel]'),t:'Галочки выбора',x:tq('selall'),g:'selall'});
  const k=tScr();P.push({s:[sel('tbody tr[data-id]:not(.muted)'),sel('.gcard:not(.muted)'),sel('tbody tr[data-id]'),sel('.gcard')].join(' || '),t:'Строка списка',x:(KBUI.rows||{})[k]||(KBUI.rows||{})[S.mod]||tq('row')});
  if($(sel('[data-menu]'))){P.push({s:sel('[data-menu]'),t:'Кнопка «…» — действия',x:tq('rowMenu'),g:'rowMenu'});P.push({ctx:'menu',sub:['menu'],gen:'menu'})}
  if($(sel('.gfoot')))P.push({s:sel('.gfoot'),t:'Низ списка',x:tq('foot'),g:'foot'});
  return P}
// Пункты меню «…» строки: по одному на действие (раскрываются, когда меню открыто)
function tExpMenu(){if(!POP)return [];return $$('.mi',POP).filter(tVis).map(b=>{const sp=b.querySelector('span');const l=(sp.childNodes[0]||sp).textContent.trim();const sub=b.querySelector('.sub');
  return {ctx:'menu',sub:['menu'],s:`.pop .mi[data-i="${b.dataset.i}"]`,t:`«${l}»`,x:tKey(KBUI.acts,l)||(sub?sub.textContent.trim():tq('act'))}})}
// Окно (карточка или форма): заголовок, вкладки, блоки, шкалы статусов, поля, кнопки внизу.
// Окно, открытое только для просмотра (openModal({form:false}), например неподключённый вид отчёта), разбирается как карточка;
// у окна с названием записи в заголовке текст берётся по его ключу kb (openModal({kb:…}))
function tExpModal(o={}){const md=MODALS[MODALS.length-1];if(!md)return [];const el=md.el;const P=[];const ttl=el.querySelector('.mh h2');
  o={...o,form:!!(o.form&&md.o.form!==false)};const kb=md.o.kb&&(KBUI.forms||{})[md.o.kb];
  // Знакомые элементы окна запоминаются по окну: у формы — по её заголовку, у карточки записи — по модулю (название записи в заголовке разное)
  const kt=(ttl.childNodes[0]||ttl).textContent.trim();const c={ctx:o.ctx,pre:o.pre,mt:o.form?kt:'card:'+(md.o.kb||S.mod)};
  P.push({...c,in:'.modal',s:'.mh',t:o.form?`Окно «${kt}»`:`Карточка «${kt}»`,ck:o.form?'':'Карточка',x:tKey(KBUI.forms,kt)||kb||(o.form?'':(KBUI.cards||{})[S.mod])||tq(o.form?'form':'card')});
  if(el.querySelector('[data-max]'))P.push({...c,in:'.modal',s:'[data-max]',t:'«На весь экран»',x:tq('max'),g:'max'});
  $$('.ctabs .tab',el).filter(tVis).forEach(t=>{const l=tLbl(t).replace(/\s*\d+ из \d+.*$/,'').replace(/\s*\d+$/,'');P.push({...c,in:'.modal',el:t,t:`Вкладка «${l}»`,x:tKey(KBUI.ctabs,l)||tq('ctab')})});
  if(!o.noBody){$$('.mb .scf-wrap',el).filter(tVis).forEach((w,k)=>{const t=(w.querySelector('.scf-t')||{}).textContent||'Статус';P.push({...c,in:'.modal',s:`.mb .scf-wrap:nth-of-type(${k+1})`,el:w,t:`Шкала «${t.trim()}»`,x:tq('scale')})});
    if(o.form)P.push(...tExpFields('.modal',c));
    else $$('.mb .box',el).filter(b=>tVis(b)&&b.querySelector(':scope > h3')).forEach(b=>{const h=b.querySelector(':scope > h3');const t=(h.childNodes[0]&&h.childNodes[0].textContent||'').replace(/\s*·\s*\d+.*$/,'').trim();if(!t)return;P.push({...c,el:b,in:'.modal',t:`Блок «${t}»`,x:tKey(KBUI.boxes,t)||tq('box')})})}
  // Кнопки внизу карточки повторяют действия меню «…» («Выполнена», «Подтвердить»): без своего текста кнопки берётся текст действия
  $$('.mf .btn',el).filter(tVis).forEach(b=>{const l=tLbl(b);if(!l||(o.form&&!b.classList.contains('cta')))return;P.push({...c,in:'.modal',el:b,t:`Кнопка «${l}»`,x:tBtnTxt(l)||(!o.form&&(KBUI.acts||{})[l])||(b.classList.contains('cta')?tq(o.form?'save':'cta'):tq('btn')),kind:o.form&&b.classList.contains('cta')?'save':undefined,g:o.form?'formBtn:'+l:undefined})});
  return P}
function tExpFields(inSel,c={}){const r=$$(inSel).filter(tVis).pop();if(!r)return [];const P=[];
  $$('.fld',r).filter(f=>tVis(f)&&!f.closest('.pop')).forEach(f=>{const d=tFieldTxt(f);const lab=f.querySelector(':scope > label');if(!lab||!lab.textContent.trim())return;P.push({...c,in:inSel,el:f,t:d.t+(d.req?' · обязательно':''),x:d.x})});
  $$('.check-row',r).filter(tVis).forEach(row=>{const b=row.querySelector('b');const t=(b||row.querySelector('.grow')||row).childNodes[0];const l=(t&&t.textContent||'').trim();const h=row.querySelector('.hint');if(!l)return;
    P.push({...c,in:inSel,el:row,t:`Переключатель «${l}»`,x:tSwTxt(l)||(h?h.textContent.trim():tq('check'))})});
  return P}
// Полный обзор текущего экрана
function tExpScreen(){return [...tExpTitle(),...tExpTabs(),...tExpEls('top'),...tExpAdd(),{s:'.search',m:'#q-open',t:'Поиск',x:tq('search'),g:'search'},...($('#stat-btn')&&tVis($('#stat-btn'))?[{s:'#stat-btn',t:'Кнопка «Статистика»',x:tq('stats'),g:'stats'}]:[]),
  ...tExpPlates(),...tExpEls('body'),...tExpBoxes(),...tExpGrid(),...tExpEls('end')]}

/* Сценарий показа: явный из kbShows или собранный по виду шага */
function tShowOf(i){return KBSH.find(x=>x.step===i.id&&x.active!==false)||null}
function tScrOfStep(i){const sh=tShowOf(i);if(sh&&sh.scr)return sh.scr;const g=i.go||{};if(g.mod)return g.mod+(g.tab?'.'+g.tab:'');if(i.at&&i.at[0])return i.at[0];const m=kbMod(i);return m||null}
function tItemsForStep(i){const sh=tShowOf(i);const intro={t:i.t,x:(i.w||'')+' '+tq(i.learn?'introLook':'introDo'),kind:'intro'};
  let items;if(sh)items=sh.items;
  else if(i.learn&&i.at)items=[{auto:'screen'}];
  else{const g=i.go||{};const hl=g.hl&&g.hl!=='#mbody'?g.hl.split(',').map(s=>s.trim()).join(' || '):null;const add=hl&&/#add-btn/.test(hl);items=add?[{auto:'add'}]:hl?[{s:hl,m:g.mhl?g.mhl.split(',').map(s=>s.trim()).join(' || '):null,t:i.t,x:i.w}]:[{auto:'screen'}]}
  const fin=i.learn?{t:tq('finLookT'),x:tq('finLook'),kind:'done'}:{t:tq('finDoT'),x:tq('finDo'),kind:'doit'};
  return [intro,...items,fin]}
function tItemsForScreen(){return [{t:'Обзор экрана: '+curMod().title+(S.tab?' · '+((modTabs(curMod()).find(t=>t.id===S.tab)||{}).label||''):''),x:tq('introScreen'),kind:'intro'},{auto:'screen'},{t:tq('finScreenT'),x:tq('finScreen'),kind:'end'}]}
// Раскрыть автоматические части, проверить, что элементы видны; невидимые (нет права, выключена функция, пустой список) — пропустить
async function tExpand(items,scr){const out=[];
  for(const it of items){const p=Object.assign({},it);p.scr=p.scr||scr;
    if(p.auto||p.gen){await tPrep({...p,ctx:p.ctx||'auto:'+(p.auto||p.gen),pre:p.pre,sub:p.sub});let got=[];
      const c={ctx:p.ctx||'auto:'+(p.auto||p.gen),pre:p.pre,sub:p.sub,scr:p.scr};
      if(p.auto==='screen')got=tExpScreen();if(p.auto==='add')got=tExpAdd();if(p.auto==='grid')got=tExpGrid();if(p.auto==='boxes')got=tExpBoxes(p.in);if(p.auto==='plates')got=tExpPlates();if(p.auto==='tabs')got=tExpTabs();
      if(p.auto==='fields')got=tExpFields(p.in||'#mbody',c);if(p.auto==='card')got=tExpModal({ctx:c.ctx,pre:c.pre,noBody:p.noBody});if(p.auto==='form'){got=tExpModal({ctx:c.ctx,pre:c.pre,form:true}).map(x=>{const y={...x};delete y.kind;return y})}
      if(p.auto==='menu'||p.gen==='menu')got=tExpMenu().map(x=>p.auto?{...x,ctx:c.ctx,pre:c.pre,sub:[...(c.sub||[])]}:x);
      // элементы карточки/формы получают контекст раскрытия; вложенные меню раскрываются здесь же
      for(const g of got){const q=Object.assign({scr:p.scr},g);if(!g.ctx&&c.ctx&&p.auto!=='screen'&&p.auto!=='add'&&p.auto!=='grid'){q.ctx=c.ctx;q.pre=c.pre;q.sub=q.sub||c.sub}
        if(q.gen==='menu'){await tPrep(q);out.push(...tExpMenu().map(x=>({...x,scr:p.scr})));continue}
        out.push(tFix(q))}continue}
    if(!p.s&&!p.txt){out.push(p);continue}
    await tPrep(p);if(tFind(p))out.push(p)}
  await tBase(scr);TOUR.ctx=null;return out}
// Элемент, найденный при раскрытии (блок, поле), запоминается селектором по порядку среди таких же
function tMarkIdx(el){if(el.id)return {s:'#'+CSS.escape(el.id)};const tag=el.tagName.toLowerCase();const cls=[...el.classList].filter(c=>!/^(on|bad|sel|ck-flash)$/.test(c)).map(c=>'.'+CSS.escape(c)).join('');
  const f=el.dataset&&el.dataset.f?`[data-f="${CSS.escape(el.dataset.f)}"]`:'';const sel=tag+cls+f;const root=el.closest('.modal')||document;const all=[...root.querySelectorAll(sel)].filter(tVis);return {s:sel,n:Math.max(0,all.indexOf(el))}}
function tFix(q){if(q.el){q.elIdx=tMarkIdx(q.el);delete q.el}return q}
function tEl(p){if(p.elIdx){const r=tRoot(p);if(!r)return null;const l=[...r.querySelectorAll(p.elIdx.s)].filter(tVis);return l[p.elIdx.n||0]||l[0]||null}return tFind(p)}

/* Знакомые элементы (умное обучение, решение заказчика 24.10.2026): облачко, с которого ушли кнопкой «Далее» или «Готово», в следующих показах пропускается.
   Общие элементы (поиск, «Столбцы», «На весь экран», кнопки формы, облачка с признаком «Общий элемент») — один раз для всей системы,
   свои — по экрану и окну. Список хранится у пользователя вместе с прогрессом обучения (kbProgress), последнее облачко шага показывается всегда */
const tKnownMap=()=>{const u=ckU();return u.known=u.known||{}};
function tKnownKey(p){if(!p||p.kind||!p.t)return null;if(p.g||p.common)return 'g:'+(p.g||p.t);return 's:'+(p.scr||TOUR.scr||tScr())+(p.mt?'|'+p.mt:'')+'|'+(p.ck||p.t)}
const tKnown=p=>{p.kk=p.kk||tKnownKey(p);return !!p.kk&&!!tKnownMap()[p.kk]};
function tKnow(p){const k=p&&(p.kk||tKnownKey(p));if(k&&!tKnownMap()[k])tKnownMap()[k]=nowStamp()}
// Пропустить знакомые: счётчик считает только новые; если новых нет — сразу последнее облачко («Всё на этом экране вам уже знакомо» у «Посмотреть» и обзора)
function tSmart(){TOUR.skip=null;if(TOUR.all)return;const keep=TOUR.list.filter(p=>!tKnown(p));const n=TOUR.list.length-keep.length;if(!n)return;
  const mid=keep.filter(p=>p.kind!=='intro'&&!['done','doit','end','save'].includes(p.kind));
  if(mid.length)TOUR.list=keep;else{const f={...keep[keep.length-1]};if(f.kind==='done'||f.kind==='end'){f.t=tq('allKnownT');f.x=tq('allKnown')}TOUR.list=[f]}
  TOUR.skip={at:0,n}}
// «Показывать всё заново» (вкладка «Мой уровень», «Мой профиль»): выполненные шаги и уровень не меняются
function tKnownReset(after){const n=Object.keys(tKnownMap()).length;
  confirmDlg({title:'Показывать всё заново?',text:`Показы «Показать как» и «Обзор экрана» снова пройдут по всем элементам${n?` — сейчас знакомых элементов ${n}`:''}. Выполненные шаги и уровень не меняются.`,ok:'Показывать всё заново',run:()=>{ckU().known={};toast('Показы снова проходят по всем элементам','grad');after&&after()}})}

/* Запуск и навигация */
function tourKey(kind,id){return 'show.'+S.me+'.'+kind+'.'+id}
function tourOverlay(){let o=$('#tour');if(o)return o;o=document.createElement('div');o.id='tour';o.hidden=true;o.innerHTML='<div class="tour-hole"></div><div class="tour-bub" role="dialog" aria-live="polite"></div>';document.body.appendChild(o);
  o.addEventListener('click',e=>{const b=e.target.closest('[data-tour]');if(!b||TOUR.busy)return;const a=b.dataset.tour;if(a==='next')tourGo(1);if(a==='prev')tourGo(-1);if(a==='end')tourEnd(false);if(a==='all')tourAll()});
  addEventListener('resize',()=>TOUR.on&&tourPlace());return o}
// Нажатия во время показа не доходят до экрана; меню, открытое показом, не закрывается от нажатия по облачку
addEventListener('pointerdown',e=>{if(TOUR.on&&e.target.closest&&e.target.closest('#tour'))e.stopPropagation()},true);
addEventListener('keydown',e=>{if(!TOUR.on)return;if(e.key==='ArrowRight'){e.preventDefault();e.stopPropagation();if(!TOUR.busy)tourGo(1)}else if(e.key==='ArrowLeft'){e.preventDefault();e.stopPropagation();if(!TOUR.busy)tourGo(-1)}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();tourEnd(false)}},true);
// «Показать как» шага урока
function tourStep(i){const key=tourKey('step',i.id);tourAsk(key,(n,all)=>tourRun({kind:'step',sid:i.id,key,scr:tScrOfStep(i),items:tItemsForStep(i),all},n))}
// «Обзор экрана» модуля: scr — 'модуль.вкладка' или текущий экран
function tourScreen(scr){if(scr){const[m,t]=scr.split('.');if(!mods().some(x=>x.id===m))return toast('Этот модуль сейчас недоступен','lock',true);go(m,t||null)}
  setTimeout(()=>{const k=tScr();const key=tourKey('scr',k);tourAsk(key,(n,all)=>tourRun({kind:'scr',sid:null,key,scr:k,items:tItemsForScreen(),all},n))},scr?260:0)}
// Если прошлый показ закончили раньше — «Продолжить с N из M» или «Сначала». Пройденные облачка уже знакомы и пропускаются,
// поэтому «Продолжить» начинает показ без них; «Сначала» — показ целиком с первого элемента
function tourAsk(key,run){const p=store.get(key,null);if(!p||!p.i||!p.n)return run(0);
  openModal({noMax:true,size:'mid',render:()=>({title:'Продолжить показ?',body:`<p style="margin:0;color:var(--muted);line-height:1.55">В прошлый раз вы закончили показ на облачке ${p.i+1} из ${p.n}.</p>`,foot:`<button class="btn ghost" id="tr-0">Сначала</button><button class="btn cta" id="tr-c">Продолжить с ${p.i+1} из ${p.n}</button>`,
    mount(el,m){$('#tr-0',el).onclick=()=>{m.close();store.set(key,null);run(0,true)};$('#tr-c',el).onclick=()=>{m.close();run(p.all?p.i:0,!!p.all)}}})})}
async function tourRun(o,from){MODALS.slice().forEach(m=>m.close());closeSheet();closePop();const ov=tourOverlay();
  Object.assign(TOUR,{on:true,kind:o.kind,sid:o.sid,key:o.key,scr:o.scr,ctx:null,mbase:0,busy:true,form:false,list:[],i:0,o,all:!!o.all,skip:null});ov.hidden=false;ovOpen();ckBar();
  const bub=$('#tour .tour-bub');bub.innerHTML=`<b>Готовлю показ…</b><p>Нахожу на экране кнопки, вкладки и поля.</p>`;tourPlace();
  // список мог ещё загружаться (скелетон): элементы собираются по готовому экрану, иначе первый показ короче следующего
  if(o.scr)await tBase(o.scr);await tSettle(120);const items=typeof o.items==='function'?o.items():o.items;
  TOUR.list=await tExpand(items,o.scr||tScr());if(!TOUR.on)return;TOUR.busy=false;
  if(!TOUR.list.length)return tourEnd(true);tSmart();TOUR.i=Math.min(Math.max(0,from||0),TOUR.list.length-1);await tourShow()}
// «Показать всё»: тот же показ целиком, с первого элемента
async function tourAll(){const o=TOUR.o;if(!o)return;store.set(TOUR.key,null);await tourRun({...o,all:true},0)}
function tourStart(){} // совместимость со старым вызовом
async function tourGo(d){if(TOUR.busy)return;const p=TOUR.list[TOUR.i];if(d>0)tKnow(p);
  if(d>0&&p&&p.kind==='doit')return tourDoit();if(d>0&&p&&(p.kind==='done'||p.kind==='end'))return tourEnd(true);if(d>0&&p&&p.kind==='save')return tourEnd(true);
  const j=TOUR.i+d;if(j<0||j>=TOUR.list.length)return;TOUR.i=j;await tourShow()}
// «Сделать сейчас»: открыть форму шага и продолжить показ по её полям
async function tourDoit(){TOUR.busy=true;const i=ckFind(TOUR.sid);const sh=i&&tShowOf(i);await tBase(sh&&sh.scr||TOUR.scr);const n0=MODALS.length;for(const a of sh&&sh.doit||['stepgo'])await tAct(a);
  if(MODALS.length>n0){TOUR.mbase=MODALS.length;TOUR.form=true;CK.active=i.id;CK.bar=true;CK.barOff=false;
    // Открылась карточка без полей (например, задача): последнее облачко — про кнопки окна, а не «заполните и сохраните»
    const card=MODALS[MODALS.length-1].o.form===false;
    const f=tExpModal({form:true}).map(tFix);const fin=f.find(x=>x.kind==='save');let rest=f.filter(x=>x.kind!=='save');
    // знакомые поля и кнопки формы тоже пропускаются; в первом облачке формы — сколько пропущено
    if(!TOUR.all){const nw=rest.filter(x=>!tKnown(x));if(nw.length<rest.length){TOUR.skip={at:TOUR.i+1,n:rest.length-nw.length};rest=nw}}
    TOUR.list.splice(TOUR.i+1,TOUR.list.length,...rest,fin||(card?{t:tq('finCardT'),x:tq('finCard'),kind:'save'}:{t:tq('finFormT'),x:tq('finForm'),kind:'save'}));TOUR.busy=false;TOUR.i++;
    // пункты формы — внутри уже открытого окна, без возврата к экрану
    TOUR.list.slice(TOUR.i).forEach(x=>{x.ctx='form';x.pre=[];x.scr=tScr()});TOUR.ctx='form';await tourShow();return}
  TOUR.busy=false;tourEnd(true,true);if(i)ckGo(i.id)}
async function tourShow(){TOUR.busy=true;const p=TOUR.list[TOUR.i];if(!p){TOUR.busy=false;return}
  if(p.ctx==='form'){TOUR.ctx='form';closePop()}else await tPrep(p);
  if(TOUR.kind&&TOUR.i)store.set(TOUR.key,{i:TOUR.i,n:TOUR.list.length,all:TOUR.all});
  const el=p.s||p.txt||p.elIdx?tEl(p):null;TOUR.el=el;
  if(el){const sc=el.closest('.mb,.gscroll,#pane,.pop,.tabs');el.scrollIntoView({block:'center',inline:'center',behavior:'instant'});if(sc&&sc.id!=='pane')await tWait(30)}
  const bub=$('#tour .tour-bub');const n=TOUR.list.length,k=TOUR.i;const last=k===n-1;
  const nextL=p.kind==='doit'?`${ic('play','sm')}Сделать сейчас`:p.kind==='done'||p.kind==='end'?'Готово':p.kind==='save'?'Понятно, заполню':last?'Готово':'Далее';
  // «Пропущено знакомых элементов: N» и «Показать всё»; если новых нет, «Показать всё» — кнопкой рядом с «Готово»
  const sk=TOUR.skip&&TOUR.skip.at===k?TOUR.skip:null;const solo=sk&&n===1;
  bub.innerHTML=`<div class="row tour-top"><span class="tour-n">${k+1} из ${n}</span><span class="grow"></span><button class="icon-btn sm" data-tour="end" aria-label="Закончить показ" title="Закончить показ (Esc)">${ic('x','sm')}</button></div><div class="bar tour-bar" aria-hidden="true"><i style="width:${Math.round((k+1)/n*100)}%"></i></div>
    <b>${esc(p.t||'')}</b><p>${esc(p.x||'')}</p>${sk?`<div class="row tour-skip">${ic('check','sm')}<span class="grow">${esc(tq('skipped','Пропущено знакомых элементов: {n}').replace('{n}',sk.n))}</span>${solo?'':`<button class="linkbtn" data-tour="all">${esc(tq('showAll','Показать всё'))}</button>`}</div>`:''}<div class="row tour-nav"><button class="linkbtn" data-tour="end">Закончить показ</button><div class="grow"></div>${k?'<button class="btn sm ghost" data-tour="prev">Назад</button>':''}${solo?`<button class="btn sm ghost" data-tour="all">${esc(tq('showAll','Показать всё'))}</button>`:''}<button class="btn sm cta" data-tour="next">${nextL}</button></div>${isMobile()?'':`<div class="tour-keys">← → — листать, Esc — закончить</div>`}`;
  TOUR.busy=false;requestAnimationFrame(tourPlace);setTimeout(tourPlace,260)}
function tourEnd(full,quiet){if(!TOUR.on)return;const p=TOUR.list[TOUR.i];const done=full&&p&&['done','end','save','doit'].includes(p.kind);TOUR.on=false;const o=$('#tour');if(o)o.hidden=true;closePop();
  // Форма, открытая «Сделать сейчас», остаётся открытой — её заполняют; всё, что открыл сам показ, закрывается
  if(!TOUR.form)while(MODALS.length)MODALS[MODALS.length-1].close();else while(MODALS.length>TOUR.mbase)MODALS[MODALS.length-1].close();ovClosed();
  if(done||full)store.set(TOUR.key,null);else if(TOUR.i>0)store.set(TOUR.key,{i:TOUR.i,n:TOUR.list.length,all:TOUR.all});
  // «Посмотреть» засчитывается только показом до конца; обзор экрана засчитывает шаги «Посмотреть» этого экрана
  if(done&&TOUR.kind==='step'){const i=ckFind(TOUR.sid);if(i&&i.learn){if(ckMark(i,'show')){CK.active=i.id;CK.bar=true;kbSync(false);renderSide();if(typeof renderSheetDot==='function')renderSheetDot();if(S.mod==='kb')renderPage();setTimeout(()=>ckDoneDlg(i),120)}}}
  if(done&&TOUR.kind==='scr'){const k=TOUR.scr||tScr();const l=ckAll().filter(i=>i.learn&&i.at&&(i.at.includes(k)||i.at.includes(k.split('.')[0]))&&ckMark(i,'show'));if(l.length){kbSync(false);renderSide();toast(`База знаний: ${l.length===1?'шаг просмотрен — «'+l[0].t+'»':'просмотрено шагов: '+l.length}`,'grad')}}
  if(!done&&!quiet&&TOUR.kind==='step'){const i=ckFind(TOUR.sid);if(i&&i.learn)toast('Показ закончен раньше: шаг «Посмотреть» засчитается, когда пройдёте показ до конца','info')}
  ckBar()}
function tourPlace(){if(!TOUR.on)return;const mob=isMobile();const el=TOUR.el&&tVis(TOUR.el)?TOUR.el:null;const hole=$('#tour .tour-hole'),bub=$('#tour .tour-bub');
  const W=innerWidth,H=innerHeight;let r=null;
  if(el){r=el.getBoundingClientRect();const pad=6;r={left:Math.max(4,r.left-pad),top:Math.max(4,r.top-pad),width:Math.min(W-8,r.width+pad*2),height:Math.min(H-8,r.height+pad*2)}}
  if(r)Object.assign(hole.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',opacity:1});else Object.assign(hole.style,{left:W/2+'px',top:H/2+'px',width:'0px',height:'0px',opacity:1});
  const bw=Math.min(380,W-24);bub.style.width=bw+'px';const bh=bub.offsetHeight;let x,y;
  // На телефоне облачко внизу экрана поверх нижней панели; если элемент внизу — сверху
  if(mob){x=(W-bw)/2;y=H-bh-12;if(r&&r.top+r.height>y-8)y=Math.max(12,Math.min(r.top-bh-12,H-bh-12));if(r&&y<r.top+r.height&&y+bh>r.top)y=12}
  else if(!r){x=(W-bw)/2;y=(H-bh)/2}
  // Пункт меню: облачко сбоку от меню, чтобы не закрывать следующие пункты
  else if(el.closest('.pop')&&(()=>{const pr=el.closest('.pop').getBoundingClientRect();const lx=pr.left-bw-12,rx=pr.right+12;x=lx>=12?lx:rx+bw<=W-12?rx:null;y=Math.max(12,Math.min(H-bh-12,r.top-10));return x!=null})()){}
  else{x=Math.min(W-bw-12,Math.max(12,r.left));y=r.top+r.height+12;if(y+bh>H-12){y=r.top-bh-12;if(y<12){x=r.left+r.width+12;y=Math.max(12,Math.min(H-bh-12,r.top));if(x+bw>W-12)x=Math.max(12,r.left-bw-12)}}}
  bub.style.left=x+'px';bub.style.top=y+'px'}

function switchUser(id){Object.keys(GS).forEach(k=>delete GS[k]);if(id!=='admin'){const e=EMP.find(x=>x.id===id);if(e&&e.active===false){toast('Учётная запись заблокирована: войти под ней нельзя','lock');$$('#demo-user,#demo-user-m').forEach(s=>s.value=S.me);return}}if(TOUR.on)tourEnd(false,true);S.me=id;CK.active=null;CK.bar=false;ckBar();ckBase();MODALS.slice().forEach(m=>m.close());closeSheet();S.mod=null;S.tab=null;derive();location.hash='';go(isAdmin()?'accounts':'home');renderSide();renderSheetDot();toast(`Вы вошли как: ${me().fio}`,'user');firstLogin('login')}
