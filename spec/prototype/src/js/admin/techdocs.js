'use strict';
// Админка: «Техническая документация» — схема базы (страница db/index.html внутри модуля) и описание API продукта со связями «метод → таблицы → SQL»
/* ═════════════ Техническая документация ═════════════ */
// Исключение из правила «всё из трёх JSON» (решение заказчика 09.11.2026): схема — db/schema.json этого репозитория, страница схемы — db/index.html,
// описание API — снимок data/apiDocs.json, собранный скриптом db/api_snapshot.py по репозиторию продукта (коммит main записан в файле).
// На GitHub Pages файлы читаются по адресу; в собранном файле — из встроенных блоков td-schema, td-page, td-api (в демо-версии их нет).
// Только просмотр: из модуля ничего не меняется в базе и не вызывается ни один метод API.
const TDOC={cache:{},url:'',frame:null,ready:false,q:[],hash:'#/t',idx:null,tbl:'',hl:'',full:false,fs:false};
function tdRead(path,id,json){if(path in TDOC.cache)return TDOC.cache[path];let v=null;
  const el=document.getElementById(id);if(el)try{v=JSON.parse(el.textContent)}catch(e){v=null}
  if(v==null&&/^https?:/.test(location.protocol))try{const x=new XMLHttpRequest();x.open('GET',path+'?v='+Date.now(),false);x.send();if(x.status===200)v=json?JSON.parse(x.responseText):x.responseText}catch(e){v=null}
  return TDOC.cache[path]=v}
const tdSchema=()=>tdRead('db/schema.json','td-schema',true);
const tdApi=()=>tdRead('data/apiDocs.json','td-api',true);
const tdPage=()=>tdRead('db/index.html','td-page',false);
const tdTbl=n=>{const s=tdSchema();if(!s)return null;if(!s._m)Object.defineProperty(s,'_m',{value:new Map(s.tables.map(t=>[t.name,t]))});return s._m.get(n)||null};
const tdSec=x=>{const a=tdApi();return (a&&a.sections[x.sec])||x.sec};
const TD_ACC={public:'Без входа',session:'Вход',employee:'Сотрудник организации',perm:'Нужно право',admin:'Администратор платформы'};
const tdPermName=p=>{const x=PERM_REF.find(y=>y.id===p);return x?x.name:p};
const tdMth=m=>`<span class="mth m-${esc(m)}">${esc(m)}</span>`;
// Карта для страницы схемы: какие методы читают и меняют таблицу, и таблицы каждого метода
function tdIdx(){if(TDOC.idx)return TDOC.idx;const a=tdApi();if(!a)return null;const t={},m={};
  a.methods.forEach(x=>{m[x.id]={m:x.m,p:x.p,s:x.sum,g:tdSec(x),r:x.r,w:x.w};new Set([...x.r,...x.w]).forEach(n=>{(t[n]=t[n]||[]).push([x.id,x.w.includes(n)?(x.r.includes(n)?'rw':'w'):'r'])})});
  Object.values(t).forEach(l=>l.sort((p,q)=>COLL.compare(m[p[0]].p,m[q[0]].p)||COLL.compare(m[p[0]].m,m[q[0]].m)));
  return TDOC.idx={t,m}}
const tdTheme=()=>document.documentElement.getAttribute('data-theme')||'auto';
// Страница схемы открывается в рамке из той же страницы db/index.html: перед её скриптом добавляются схема, карта API и тема программы
function tdFrameUrl(){if(TDOC.url)return TDOC.url;const page=tdPage(),schema=tdSchema();if(!page||!schema)return '';
  const mark="<script>\n'use strict';";if(!page.includes(mark))return '';
  const inj=`<script>window.TDX_IN=${JSON.stringify({schema,api:tdIdx(),theme:tdTheme()}).replace(/</g,'\\u003c')};<\/script>`;
  TDOC.url=URL.createObjectURL(new Blob([page.replace(mark,inj+mark)],{type:'text/html'}));return TDOC.url}
function tdPost(m){if(TDOC.frame&&TDOC.ready&&TDOC.frame.isConnected)TDOC.frame.contentWindow.postMessage(Object.assign({tdx:1},m),'*');else TDOC.q.push(m)}
addEventListener('message',e=>{const f=TDOC.frame;if(!f||!f.contentWindow||e.source!==f.contentWindow||!e.data||!e.data.tdx)return;const d=e.data;
  if(d.ready){TDOC.ready=true;f.contentWindow.postMessage({tdx:1,theme:tdTheme()},'*');TDOC.q.splice(0).forEach(tdPost)}
  if(d.hash)TDOC.hash=d.hash;
  // окно метода, открытое из схемы, забирает фокус у рамки — Esc и Tab работают в окне
  if(d.open){tdMethod(d.open);const m=MODALS[MODALS.length-1];if(m&&m.el){const box=m.el.querySelector('.modal')||m.el;if(!box.hasAttribute('tabindex'))box.tabIndex=-1;box.focus({preventScroll:true})}}
  if('full' in d)tdFull(d.full);
  // Esc, который схема не обработала: закрывает верхнее окно, без окон — полноэкранный режим
  if(d.esc){const m=MODALS[MODALS.length-1];if(m)m.close();else if(TDOC.full)tdFull(false)}});
new MutationObserver(()=>{if(TDOC.frame&&TDOC.ready)tdPost({theme:tdTheme()})}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
// Переходы на вкладку «Схема базы»: таблица, диаграмма с таблицами метода, функция базы
function tdGoDb(hash){MODALS.filter(m=>m.o.td).forEach(m=>m.close());TDOC.hash=hash;
  if(S.mod==='tdocs'&&S.tab==='db'&&TDOC.frame&&TDOC.frame.isConnected){tdPost({go:hash});return}go('tdocs','db')}
const tdShowTable=n=>tdGoDb('#/t/'+encodeURIComponent(n));
const tdShowMethod=id=>tdGoDb('#/d/'+encodeURIComponent('@'+id));
const tdShowFn=n=>tdGoDb('#/r/'+encodeURIComponent(n));

function tdVer(extra){const a=tdApi(),s=tdSchema();if(!a||!s)return '';const am=a.meta,sm=s.meta;
  const old=(am.schemaVersion||0)<(sm.schemaVersion||0)||String(am.date||'')<String(sm.updated||'');
  return `<div class="td-ver">${ic('info','sm')}<span>Описание API собрано по репозиторию продукта ${esc(am.repo)}: ветка <b>${esc(am.branch)}</b>, коммит <code>${esc(am.commit)}</code> от ${fmtD(am.date)} · ${am.methods} ${plural(am.methods,'метод','метода','методов')}. Схема базы — описание версии ${esc(sm.schemaVersion)} от ${fmtD(sm.updated)} · ${s.tables.length} ${plural(s.tables.length,'таблица','таблицы','таблиц')}.</span>${extra||''}</div>
    ${old?`<div class="note yellow">${ic('alert')}<span>Описание API собрано по более старой версии, чем схема базы.</span></div>`:''}`}
function tdMissing(what){return `<div class="state">${ic('alert','lg')}<b>Не удалось прочитать ${what}</b><span>Откройте прототип через GitHub Pages или соберите файл заново (python3 build.py): описание встраивается при сборке.</span></div>`}
function renderTdocs(body,tab,fresh){
  if(!tdApi()||!tdSchema()){body.innerHTML=tdMissing(!tdSchema()?'db/schema.json':'data/apiDocs.json');return}
  if(tab==='api')return tdApiTab(body,fresh);
  const url=tdFrameUrl();if(!url){body.innerHTML=tdVer()+tdMissing('db/index.html');return}
  tdFullOff();
  body.innerHTML=`${tdVer(`<button class="btn sm td-fbtn" id="td-full" title="Схема базы на весь экран: Esc — обычный вид">${ic('maximize','sm')}На весь экран</button>`)}<div class="td-frame-w"><iframe class="td-frame" title="Схема базы данных Buhuchet.kg" loading="eager" allow="fullscreen"></iframe></div>`;
  $('#td-full',body).onclick=()=>tdFull(true);
  const f=$('.td-frame',body);TDOC.frame=f;TDOC.ready=false;f.src=url+TDOC.hash;tdFit()}
/* «На весь экран»: рамка со схемой закрывает всё окно программы, браузер по возможности переходит в полноэкранный режим.
   Окна (карточка метода) открываются поверх. Выход — кнопкой в шапке схемы, Esc или выходом браузера из полноэкранного режима */
function tdFull(on){const w=TDOC.frame&&TDOC.frame.isConnected&&TDOC.frame.closest('.td-frame-w');if(!w)return;on=!!on;if(on===TDOC.full)return;
  TDOC.full=on;w.classList.toggle('full',on);document.body.classList.toggle('td-full',on);
  const de=document.documentElement;
  if(on&&!document.fullscreenElement&&de.requestFullscreen){const p=de.requestFullscreen();TDOC.fs=true;if(p&&p.catch)p.catch(()=>{TDOC.fs=false})}
  if(!on&&TDOC.fs){TDOC.fs=false;if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{})}
  tdPost({full:on});if(!on)tdFit()}
// сброс без рамки: перерисовка раздела, уход в другой модуль
function tdFullOff(){if(!TDOC.full&&!document.body.classList.contains('td-full'))return;TDOC.full=false;document.body.classList.remove('td-full');
  if(TDOC.fs){TDOC.fs=false;if(document.fullscreenElement&&document.exitFullscreen)document.exitFullscreen().catch(()=>{})}}
// Esc в полноэкранном режиме браузера забирает сам браузер: выходим из него, а Esc срабатывает как обычно — закрывает открытое окно, без окон возвращает обычный вид
document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement||!TDOC.fs)return;TDOC.fs=false;if(!TDOC.full)return;const m=MODALS[MODALS.length-1];if(m)m.close();else tdFull(false)});
// Esc в программе (фокус вне схемы): сначала закрываются окна, затем полноэкранный режим
addEventListener('keydown',e=>{if(e.key==='Escape'&&TDOC.full&&!MODALS.length&&!document.querySelector('.pop')){e.preventDefault();tdFull(false)}},true);
addEventListener('hashchange',()=>setTimeout(()=>{if(TDOC.full&&(S.mod!=='tdocs'||S.tab!=='db'))tdFullOff()}));
// Рамка занимает высоту окна под шапкой модуля; страница схемы внутри листается сама
function tdFit(){const f=TDOC.frame;if(!f||!f.isConnected||TDOC.full)return;const top=f.getBoundingClientRect().top+(window.scrollY||0);const bn=$('#bnav');const b=bn&&getComputedStyle(bn).display!=='none'?bn.offsetHeight:0;f.style.height=Math.max(420,innerHeight-Math.max(0,f.getBoundingClientRect().top)-b-(isMobile()?8:16))+'px'}
addEventListener('resize',()=>{if(S.mod==='tdocs')tdFit()});

/* ── вкладка «API» ── */
function tdApiTab(body,fresh){const a=tdApi();
  const tbls=[...new Set(a.methods.flatMap(m=>[...m.r,...m.w]))].sort((x,y)=>COLL.compare((tdTbl(x)||{ru:x}).ru,(tdTbl(y)||{ru:y}).ru));
  body.innerHTML=`${tdVer()}<div class="row td-bar"><label class="td-tf">${ic('db','sm')}<span>Таблица</span>${sel('td-tf',[['','Все таблицы'],...tbls.map(n=>[n,`${(tdTbl(n)||{ru:n}).ru} · ${n}`])],TDOC.tbl,'aria-label="Фильтр по таблице"')}</label><div class="grow"></div><button class="btn sm" id="td-oapi" title="Описание методов в формате OpenAPI 3.1: openapi.json">${ic('download','sm')}Скачать OpenAPI</button></div><div id="tdg"></div>`;
  $('#td-tf',body).onchange=e=>{TDOC.tbl=e.target.value;g.s.page=0;g.refresh()};
  $('#td-oapi',body).onclick=tdOpenApiSave;
  const g=grid($('#tdg',body),{id:'adm-api',rid:m=>m.id,audit:false,exportable:true,defGroup:['sec'],sort:{key:'p',dir:1},
    cols:[{key:'m',label:'Метод',type:'enum',w:96,val:m=>m.m,html:m=>tdMth(m.m)},
      {key:'p',label:'Адрес',type:'text',w:280,val:m=>m.p,cls:'mono',html:m=>`<span class="mono td-p">${esc(m.p)}</span>`},
      {key:'sec',label:'Раздел',type:'enum',w:190,hide:true,val:m=>tdSec(m)},
      {key:'sum',label:'Описание',type:'text',w:320,val:m=>m.sum},
      {key:'acc',label:'Доступ',type:'enum',w:170,val:m=>TD_ACC[m.acc]||m.acc,html:m=>`<span class="pill sm ${m.acc==='admin'?'purple':m.acc==='public'?'yellow':m.acc==='perm'?'blue':'faint'}">${esc(TD_ACC[m.acc]||m.acc)}</span>`},
      {key:'perm',label:'Право',type:'text',w:220,hide:true,val:m=>m.perm.map(tdPermName).join(', ')},
      {key:'n',label:'Таблиц',type:'int',w:80,num:true,agg:'',val:m=>new Set([...m.r,...m.w]).size},
      {key:'w',label:'Меняет данные',type:'enum',w:120,val:m=>m.w.length?'Да':'Нет',html:m=>m.w.length?`<span class="pill sm orange">Да</span>`:'<span class="faint">Нет</span>'},
      {key:'tb',label:'Таблицы',type:'text',w:280,hide:true,val:m=>[...new Set([...m.r,...m.w])].join(', ')},
      {key:'rate',label:'Предел запросов',type:'text',w:200,hide:true,val:m=>m.rate||''},
      {key:'file',label:'Файл кода',type:'text',w:280,hide:true,cls:'mono',val:m=>(m.code[0]||{}).file||''}],
    rows:()=>TDOC.tbl?a.methods.filter(m=>m.r.includes(TDOC.tbl)||m.w.includes(TDOC.tbl)):a.methods,
    searchText:m=>[m.p,m.sum,m.desc,...m.r,...m.w,...m.r.concat(m.w).map(n=>(tdTbl(n)||{}).ru||'')].join(' '),
    title:'p',noun:['метод','метода','методов'],simulateLoad:fresh,open:m=>tdMethod(m.id),
    actions:m=>[{label:'Открыть',icon:'code',run:()=>tdMethod(m.id)},{label:'Показать на схеме',icon:'db',disabled:!(m.r.length||m.w.length),reason:'Метод не обращается к таблицам',run:()=>tdShowMethod(m.id)},{label:'Скопировать адрес',icon:'copy',run:()=>copyText(m.m+' '+m.p,'Адрес метода скопирован')}]})}

/* ── карточка метода ── */
const tdFieldsTbl=(fs,o={})=>!fs||!fs.length?'<span class="faint">Полей нет</span>':`<div class="tbl-wrap"><table class="mini td-f"><thead><tr><th>Поле</th><th>Тип</th><th>Обязательное</th><th>Ограничения</th><th>Описание</th></tr></thead><tbody>${fs.map(f=>`<tr><td class="mono">${esc(f.n)}</td><td class="mono">${tdTypeHtml(f.t)}${f.null?' <span class="faint">| null</span>':''}</td><td>${f.req?'да':'<span class="faint">нет</span>'}</td><td>${esc(f.c||'')}</td><td>${esc(f.d||'')}</td></tr>`).join('')}</tbody></table></div>`;
function tdTypeHtml(t){const a=tdApi();return esc(t).replace(/\b([A-Z]\w+)\b/g,(x,n)=>a.schemas[n]?`<button type="button" class="linkbtn mono" data-tds="${n}">${n}</button>`:x)}
function tdReqHtml(m){const r=m.req||{},part=(k,h)=>r[k]&&r[k].f&&r[k].f.length?`<h4>${h}${r[k].s?` · <span class="mono">${esc(r[k].s)}</span>`:''}</h4>${tdFieldsTbl(r[k].f)}`:'';
  const b=r.body;const has=['params','query','headers'].some(k=>r[k]&&r[k].f&&r[k].f.length)||b;
  return !has?'<p class="muted" style="margin:0">У метода нет параметров и тела запроса.</p>':
    part('params','Параметры адреса')+part('query','Параметры строки запроса')+part('headers','Заголовки')+
    (b?`<h4>Тело запроса${b.s?` · <span class="mono">${esc(b.s)}</span>`:''}${b.ct?` <span class="faint">${esc(b.ct)}</span>`:''}</h4>${tdFieldsTbl(b.f)}${b.ex&&Object.keys(b.ex).length?`<div class="td-code-h"><b>Пример тела</b><span class="grow"></span><button class="btn sm" data-tdcopy="ex">${ic('copy','sm')}Копировать</button></div><pre class="td-code" data-tdsrc="ex">${esc(JSON.stringify(b.ex,null,2))}</pre>`:''}`:'')}
function tdResHtml(m){const a=tdApi();return `<div class="td-res">${m.res.map(r=>`<details class="td-r"${r.code[0]==='2'?' open':''}><summary><span class="pill sm ${r.code[0]==='2'?'green':r.code[0]==='3'?'blue':r.code==='429'||r.code==='409'?'yellow':'red'} mono">${esc(r.code)}</span><span class="grow">${esc(r.d||'')}</span>${r.s?`<span class="mono faint">${esc(r.s)}</span>`:''}</summary>${r.s&&a.schemas[r.s]?tdFieldsTbl(a.schemas[r.s]):r.s?'<span class="faint">Поля схемы не разобраны</span>':'<span class="faint">Тело ответа без схемы</span>'}</details>`).join('')}</div>`}
const tdTblBtn=n=>{const t=tdTbl(n);return `<button type="button" class="td-tb" data-tdtb="${esc(n)}" title="Открыть таблицу на вкладке «Схема базы»">${ic('db','sm')}<span><b>${esc(t?t.ru:n)}</b><span class="mono faint">${esc(n)}</span></span></button>`};
function tdTblHtml(m){const a=tdApi();const r=m.r.filter(n=>!m.w.includes(n)),w=m.w;
  return `<div class="td-tbs"><div><h4>Читает · ${r.length}</h4>${r.length?r.map(tdTblBtn).join(''):'<span class="faint">—</span>'}</div><div><h4>Меняет (добавляет, изменяет, удаляет) · ${w.length}</h4>${w.length?w.map(tdTblBtn).join(''):'<span class="faint">—</span>'}</div></div>
    ${m.v.length?`<h4>Через представления</h4><ul class="td-ul">${m.v.map(v=>`<li><code>app.${esc(v)}</code> — читает ${(a.views[v]||{r:[]}).r.map(n=>esc((tdTbl(n)||{ru:n}).ru)).join(', ')||'—'} <span class="faint">(миграция ${esc((a.views[v]||{}).mig||'')})</span></li>`).join('')}</ul>`:''}
    ${m.r.length||m.w.length?`<div class="row" style="margin-top:10px"><button class="btn sm" data-tdshow>${ic('db','sm')}Показать на схеме</button><span class="hint" style="margin:0">Диаграмма с подсветкой: читаемые — синим, изменяемые — оранжевым</span></div>`:''}`}
const TD_KW=/^(SELECT|FROM|WHERE|AND|OR|NOT|INSERT|INTO|VALUES|UPDATE|SET|DELETE|RETURNING|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|GROUP|BY|ORDER|LIMIT|OFFSET|WITH|CREATE|VIEW|FUNCTION|REPLACE|RETURNS|LANGUAGE|SECURITY|DEFINER|BEGIN|END|IF|THEN|ELSE|CASE|WHEN|IS|NULL|IN|EXISTS|DISTINCT|COALESCE|COUNT|SUM|MAX|MIN|UNION|ALL|CONFLICT|DO|NOTHING|LATERAL|HAVING|ASC|DESC|TRUE|FALSE|DECLARE|PERFORM|RAISE|EXCEPTION|TABLE|BOOLEAN|INTEGER|TEXT|UUID|STABLE|VOLATILE|IMMUTABLE)$/i;
// Подсветка SQL: ключевые слова, параметры $1…, строки и комментарии (текст сначала экранируется)
function tdSqlHl(t){return esc(t).replace(/(--[^\n]*)|(&#39;(?:[^&]|&(?!#39;))*?&#39;)|(\$\d+)|\b([A-Za-z_]+)\b/g,(x,c,s,p,w)=>c?`<i class="c">${c}</i>`:s?`<i class="s">${s}</i>`:p?`<i class="p">${p}</i>`:TD_KW.test(w)?`<i class="k">${w}</i>`:w)}
const TD_QK={sql:['SQL','green','Текст SQL из кода продукта; $1, $2 … — параметры'],code:['Запрос по коду','yellow','Запрос строит Drizzle: показан фрагмент кода, по которому собирается SQL'],view:['Представление','blue','Определение представления из миграции']};
const TD_CTX={org:['Организация запроса','withOrgContext: SET LOCAL app.org_id — организация пользователя; RLS пускает только к строкам этой организации'],user:['Пользователь','withUserContext: SET LOCAL app.user_id — текущий пользователь; функции входа и профиля видят только его записи']};
function tdSqlHtml(m){const a=tdApi();const list=m.q.map(i=>a.sql[i]).filter(Boolean);const flt=m.m==='GET'&&m.req&&m.req.query&&m.req.query.f&&m.req.query.f.length;
  const ctx=m.ctx.map(c=>TD_CTX[c]).filter(Boolean);if(m.acc==='admin')ctx.push(['Администратор платформы','requirePlatformAdmin: запрос только от администратора платформы; данные организаций читаются через представления app.admin_* и функции SECURITY DEFINER']);
  const tbls=[...new Set([...m.r,...m.w])];
  return `<div class="box td-ctx"><h4>Контекст выполнения</h4>${ctx.length?`<ul class="td-ul">${ctx.map(c=>`<li><b>${esc(c[0])}</b> — <span class="mono">${esc(c[1].split(':')[0])}</span>:${esc(c[1].split(':').slice(1).join(':'))}</li>`).join('')}</ul>`:'<span class="faint">Без контекста организации и пользователя</span>'}
    ${m.fns.length?`<h4>Функции базы</h4><div class="row" style="gap:6px">${m.fns.map(f=>`<button type="button" class="tag td-fn" data-tdfn="${esc(f)}" title="Открыть в «Функции базы»">app.${esc(f)}</button>`).join('')}</div>`:''}
    ${tbls.length?`<details class="td-rls"><summary>Правила RLS таблиц метода · ${tbls.length}</summary><ul class="td-ul">${tbls.map(n=>{const t=tdTbl(n);return `<li><b>${esc(t?t.ru:n)}</b> <code>${esc(n)}</code> — ${esc(t?t.rls||'—':'—')}</li>`}).join('')}</ul></details>`:''}</div>
    ${list.length?list.map((q,j)=>{const k=TD_QK[q.k]||TD_QK.code;return `<div class="td-q"><div class="td-code-h"><b>${j+1}.</b><span class="pill sm ${k[1]}" title="${esc(k[2])}">${k[0]}</span>${flt&&q.k!=='view'?'<span class="pill sm faint" title="Показан вариант без фильтров и сортировки списка">Меняется по фильтрам</span>':''}<span class="mono faint td-src">${esc(q.f)}${q.l?':'+q.l:''} · ${esc(q.fn)}</span><span class="grow"></span><button class="btn sm" data-tdcopy="q${j}">${ic('copy','sm')}Копировать</button></div><pre class="td-code ${q.k==='code'?'ts':''}" data-tdsrc="q${j}" data-raw="${esc(q.t)}">${q.k==='code'?esc(q.t):tdSqlHl(q.t)}</pre></div>`}).join(''):'<p class="muted">Метод не обращается к базе данных или запросы не найдены разбором кода.</p>'}`}
function tdCodeHtml(m){const a=tdApi();const base=`https://github.com/${a.meta.repo}/blob/${a.meta.commit}/`;
  return `<div class="list td-codel">${m.code.map(c=>`<a class="li" href="${esc(base+c.file+(c.line?'#L'+c.line:''))}" target="_blank" rel="noopener" title="Открыть в репозитории продукта">${ic(c.what==='Запрос к базе'?'db':'code')}<div class="grow"><div class="t1 mono">${esc(c.file)}${c.line?':'+c.line:''}</div><div class="t2">${esc(c.what)} · <span class="mono">${esc(c.fn)}</span></div></div>${ic('link','sm')}</a>`).join('')}</div><span class="hint">Файлы продукта на коммите ${esc(a.meta.commit)}; ссылки открывают их на GitHub.</span>`}
function tdMethod(id,tab){const a=tdApi();const m=a&&a.methods.find(x=>x.id===id);if(!m){toast('Метод не найден в описании API','alert',true);return}
  MODALS.filter(x=>x.o.td).forEach(x=>x.close());
  openModal({size:'wide',td:1,state:{tab:tab||'req'},render:mm=>{const st=mm.state;const n=new Set([...m.r,...m.w]).size;
    const tabs=[['req','Запрос','edit'],['res','Ответы','list',m.res.length],['tbl','Таблицы','db',n],['sql','SQL','code',m.q.length],['code','Код','folder',m.code.length]];
    const acc=m.acc==='admin'?'Только администратор платформы':m.acc==='public'?'Без входа':m.acc==='perm'?'Нужен вход и право: '+m.perm.map(p=>`«${tdPermName(p)}»`).join(', '):m.acc==='employee'?'Нужен вход сотрудника организации':'Нужен вход';
    const b=st.tab==='req'?tdReqHtml(m):st.tab==='res'?tdResHtml(m):st.tab==='tbl'?tdTblHtml(m):st.tab==='sql'?tdSqlHtml(m):tdCodeHtml(m);
    return {title:`${tdMth(m.m)} <span class="mono td-tp">${esc(m.p)}</span>`,sub:esc(m.sum),
      body:`<div class="kv td-kv"><div><span class="k">Раздел</span><span class="v">${esc(tdSec(m))}</span></div><div><span class="k">Доступ</span><span class="v">${esc(acc)}</span></div>${m.rate?`<div><span class="k">Предел запросов</span><span class="v">${esc(m.rate)}</span></div>`:''}${m.desc?`<div class="full"><span class="k">Описание</span><span class="v">${esc(m.desc)}</span></div>`:''}</div>${cardTabs(tabs,st.tab,'tdt')}<div class="td-b">${b}</div>`,
      foot:`<span class="hint" style="margin:0">Только просмотр: из Админки метод не вызывается</span><div class="grow"></div><button class="btn cta" data-close>Готово</button>`,
      mount(el){bindCardTabs(el,'tdt',k=>{st.tab=k;mm.draw();const x=el.querySelector('.mb');if(x)x.scrollTop=0});
        $$('[data-tdtb]',el).forEach(x=>x.onclick=()=>tdShowTable(x.dataset.tdtb));
        $$('[data-tdshow]',el).forEach(x=>x.onclick=()=>tdShowMethod(m.id));
        $$('[data-tdfn]',el).forEach(x=>x.onclick=()=>tdShowFn(x.dataset.tdfn));
        $$('[data-tds]',el).forEach(x=>x.onclick=()=>tdSchemaDlg(x.dataset.tds));
        $$('[data-tdcopy]',el).forEach(x=>x.onclick=()=>{const p=el.querySelector(`[data-tdsrc="${x.dataset.tdcopy}"]`);if(p)copyText(p.dataset.raw||p.textContent,'Скопировано')})}}}})}
function tdSchemaDlg(n){const a=tdApi();openModal({size:'mid',render:()=>({title:`<span class="mono">${esc(n)}</span>`,sub:'Схема Zod из пакета shared продукта',body:tdFieldsTbl(a.schemas[n]),foot:'<button class="btn cta" data-close>Готово</button>',mount(el){$$('[data-tds]',el).forEach(x=>x.onclick=()=>tdSchemaDlg(x.dataset.tds))}})})}

/* ── «Скачать OpenAPI»: openapi.json из снимка ── */
const TD_PRIM={string:{type:'string'},number:{type:'number'},boolean:{type:'boolean'},object:{type:'object'},record:{type:'object'},Uuid:{type:'string',format:'uuid'},IsoDate:{type:'string',format:'date'},'string(datetime)':{type:'string',format:'date-time'},RecordVersion:{type:'integer'},Tyiyn:{type:'integer',description:'Деньги в тыйынах'},Count:{type:'integer'},Positive:{type:'integer'},Day:{type:'integer'},Month:{type:'integer'},YearMonth:{type:'string'}};
function tdOaType(t,sc){const x=/^array<(.+)>$/.exec(t);if(x)return {type:'array',items:tdOaType(x[1],sc)};if(t==='array')return {type:'array'};if(TD_PRIM[t])return Object.assign({},TD_PRIM[t]);if(sc[t])return {$ref:'#/components/schemas/'+t};return {type:'string',description:t}}
function tdOaObj(fs,sc){const o={type:'object',properties:{}},req=[];(fs||[]).forEach(f=>{const p=tdOaType(f.t,sc);if(f.d)p.description=(p.description?p.description+'. ':'')+f.d;if(f.null)p.nullable=true;o.properties[f.n]=p;if(f.req)req.push(f.n)});if(req.length)o.required=req;return o}
function tdOpenApi(){const a=tdApi(),sc=a.schemas,paths={};
  a.methods.forEach(m=>{const op={summary:m.sum,tags:[tdSec(m)],operationId:(m.code[0]||{}).fn||m.id};if(m.desc)op.description=m.desc;
    const ps=[];[['params','path'],['query','query'],['headers','header']].forEach(([k,inn])=>((m.req||{})[k]||{f:[]}).f.forEach(f=>ps.push({name:f.n,in:inn,required:inn==='path'||!!f.req,schema:tdOaType(f.t,sc),...(f.d?{description:f.d}:{})})));if(ps.length)op.parameters=ps;
    const b=(m.req||{}).body;if(b)op.requestBody={required:true,content:{[b.ct||'application/json']:{schema:b.s&&sc[b.s]?{$ref:'#/components/schemas/'+b.s}:tdOaObj(b.f,sc)}}};
    op.responses=Object.fromEntries(m.res.map(r=>[r.code,Object.assign({description:r.d||''},r.s?{content:{'application/json':{schema:sc[r.s]?{$ref:'#/components/schemas/'+r.s}:{type:'object',description:r.s}}}}:{})]));
    op['x-access']=TD_ACC[m.acc]||m.acc;if(m.perm.length)op['x-permissions']=m.perm;op['x-tables']={read:m.r,write:m.w};
    const p=paths[m.p]=paths[m.p]||{};p[m.m.toLowerCase()]=op});
  return {openapi:'3.1.0',info:{title:'Buhuchet.kg API',version:a.meta.commit,description:`Снимок описания API продукта ${a.meta.repo}, ветка ${a.meta.branch}, коммит ${a.meta.commit} от ${a.meta.date}. ${a.meta.note}`},servers:[{url:'/api'}],paths,components:{schemas:Object.fromEntries(Object.entries(sc).map(([k,fs])=>[k,tdOaObj(fs,sc)]))}}}
function tdOpenApiSave(){xlSave(new Blob([JSON.stringify(tdOpenApi(),null,2)],{type:'application/json'}),'openapi.json');toast('Скачивание: openapi.json','download')}
