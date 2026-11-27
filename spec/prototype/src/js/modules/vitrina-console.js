'use strict';
// Консоль запросов «Витрины данных» в Админке (доработки 27.11.2026: консоль запросов, этап 1 — П4 вкладка, П5 редактор
// с подсказками, П6 методы API → запрос; прототип v166). Прототип не выполняет SQL: «Выполнить» показывает ответ готового
// шаблона, если запрос с ним совпадает, иначе — «На стенде здесь будет ответ базы». Подсказки, проверка по ходу набора,
// «Форматировать» и перестройка запроса метода работают по-настоящему. В продукте: редактор CodeMirror 6, подсказки — из карты
// базы (поля из самой базы, права ролей), ошибки — разборщиком PostgreSQL на сервере.

const DMC={tabs:null,cur:0,side:'db',q:'',mq:'mine',db:null};
// Хранятся в данных прототипа: «Мои запросы» — личные, «История» — последние 100 запусков каждого администратора
const dmcMine=()=>DB.dmConMine||(DB.dmConMine=[]),dmcHist=()=>DB.dmConHist||(DB.dmConHist=[]);
const DMC_HIST_MAX=100;
// Функции, разрешённые шаблонам, с коротким примером (блок 3, пункт 2)
const DMC_FN=[['sum','sum(r.amount)','Сумма значений'],['count','count(*)','Число строк'],['avg','avg(x.value)','Среднее'],['min','min(r.due_date)','Наименьшее'],['max','max(r.due_date)','Наибольшее'],
  ['coalesce','coalesce(r.amount, 0)','Первое непустое'],['nullif','nullif(x, 0)','Пусто, если равно'],['round','round(r.amount / 100.0, 2)','Округлить: тыйыны → сомы'],
  ['date_trunc',"date_trunc('month', r.due_date)",'Начало месяца, года'],['to_char',"to_char(r.due_date, 'YYYY-MM')",'Дата текстом'],['extract','extract(year from r.due_date)','Год, месяц из даты'],
  ['current_date','current_date','Сегодня'],['now','now()','Сейчас'],['string_agg',"string_agg(c.name, ', ')",'Склеить строки'],['greatest','greatest(a, b)','Большее из'],['least','least(a, b)','Меньшее из'],
  ['lower','lower(c.name)','Строчными'],['upper','upper(c.name)','Заглавными'],['trim','trim(c.name)','Без пробелов по краям'],['concat',"concat(e.last_name, ' ', e.first_name)",'Склеить текст']];
const DMC_SQLKW=['select','from','where','and','or','not','in','is','null','as','on','join','left join','inner join','group by','order by','having','limit','offset','distinct','case','when','then','else','end','with','union all','exists','between','like','ilike','asc','desc','over','partition by','filter'];
// Запрещённое консолью (в продукте — разборщик на сервере, этап 0, П2); здесь — по словам, для подсказки по ходу набора
const DMC_DENY=/\b(insert|update|delete|merge|drop|alter|create|truncate|grant|revoke|copy|call|vacuum|lock|set_config|pg_sleep\w*|pg_advisory\w*|pg_terminate_backend|pg_cancel_backend|query_to_xml|ts_stat|ts_rewrite|dblink\w*|lo_\w+)\b/i;
const DMC_WARN='Шаблон возьмёт только запрос метода. Права, область и расчёты, которые метод делает в коде, в шаблон не переходят';

/* Знания о базе: описание db/schema.json — таблицы и поля «Есть в базе», связи по внешним ключам (блок 3, пункт 1) */
function dmcDb(){if(DMC.db)return DMC.db;const s=tdSchema();if(!s)return null;
  const T=s.tables.filter(t=>t.status==='actual').map(t=>({n:t.name,ru:t.ru||'',g:t.group,desc:t.desc||'',org:t.columns.some(c=>c.name==='org_id')||t.group==='dicts',
    cols:t.columns.filter(c=>c.status!=='planned').map(c=>({n:c.name,ru:c.ru||'',t:c.type,desc:c.desc||'',fk:c.fk||null,money:/тыйын/i.test(c.desc||'')||(c.type==='bigint'&&/(amount|sum|paid|debt|price|fee)/.test(c.name))})),out:[],inc:[]}));
  const m=new Map(T.map(t=>[t.n,t]));
  T.forEach(t=>t.cols.forEach(c=>{if(!c.fk)return;const[rt,rc]=c.fk.split('.'),r=m.get(rt);if(!r)return;t.out.push({col:c.n,to:rt,toCol:rc});r.inc.push({from:t.n,col:c.n,toCol:rc})}));
  return DMC.db={T,m,G:s.groups||[]}}
const dmcTbl=n=>{const d=dmcDb();return d?d.m.get(String(n).replace(/^public\./i,'').toLowerCase())||null:null};

/* Вкладки запросов: недописанный запрос не теряется при уходе со вкладки — держится в памяти страницы, в браузере — как удобство */
let dmcSeq=0;
const dmcNewTab=(o={})=>({id:'q'+Date.now().toString(36)+(dmcSeq++),name:o.name||'Запрос '+(dmcSeq),sql:o.sql??'SELECT c.name AS cp, c.inn\nFROM contractors c\nORDER BY c.name\nLIMIT 100',params:o.params||{},tpl:o.tpl||null,mq:o.mq||null,notes:o.notes||null,cols:o.cols||null,res:null});
function dmcState(){if(DMC.tabs)return;const sv=store.get('dm.con.'+S.me,null);
  DMC.tabs=sv&&Array.isArray(sv.tabs)&&sv.tabs.length?sv.tabs.map(t=>Object.assign(dmcNewTab(t),{id:t.id||dmcNewTab().id,res:null})):[dmcNewTab()];DMC.cur=sv?Math.max(0,Math.min(sv.cur|0,DMC.tabs.length-1)):0}
function dmcSave(){try{store.set('dm.con.'+S.me,{tabs:DMC.tabs.map(t=>({id:t.id,name:t.name,sql:t.sql,params:t.params,tpl:t.tpl,mq:t.mq,notes:t.notes,cols:t.cols})),cur:DMC.cur})}catch(e){}}
const dmcTab=()=>{dmcState();return DMC.tabs[DMC.cur]};

// Одна функция «открыть в консоли» (П4): её зовут шаблон, метод API (П6) и сборщик (П9)
function dmConOpen(sql,params,name,o={}){dmcState();let i=o.tpl?DMC.tabs.findIndex(t=>t.tpl===o.tpl):o.mq?DMC.tabs.findIndex(t=>t.mq===o.mq):-1;
  if(i<0){DMC.tabs.push(dmcNewTab({sql,params:params||{},name,tpl:o.tpl,mq:o.mq,notes:o.notes,cols:o.cols}));i=DMC.tabs.length-1}else Object.assign(DMC.tabs[i],{sql,params:params||DMC.tabs[i].params,notes:o.notes||DMC.tabs[i].notes,res:null});
  DMC.cur=i;dmcSave();MODALS.slice().forEach(m=>m.close(true));go('dm','con');if(o.toTpl)setTimeout(()=>dmcToTpl(DMC.tabs[i]),0)}

/* Разбор текста: строки, комментарии, операторы, псевдонимы таблиц */
// Маска: строки и комментарии заменены пробелами той же длины — поиск слов и скобок их не задевает
function dmcMask(s){let o='',i=0;const n=s.length;while(i<n){const c=s[i];
  if(c==='-'&&s[i+1]==='-'){const j=s.indexOf('\n',i);const e=j<0?n:j;o+=' '.repeat(e-i);i=e;continue}
  if(c==='/'&&s[i+1]==='*'){const j=s.indexOf('*/',i+2);const e=j<0?n:j+2;o+=s.slice(i,e).replace(/[^\n]/g,' ');i=e;continue}
  if(c==="'"){let j=i+1;while(j<n){if(s[j]==="'"){if(s[j+1]==="'"){j+=2;continue}break}j++}const e=j<n?j+1:n;o+=' '.repeat(e-i);i=e;continue}
  o+=c;i++}return o}
// Оператор под курсором: части между «;» вне строк и комментариев
function dmcStmts(s){const m=dmcMask(s),r=[];let a=0;for(let i=0;i<=m.length;i++)if(i===m.length||m[i]===';'){r.push([a,i]);a=i+1}return r.filter(([x,y])=>s.slice(x,y).trim())}
function dmcStmtAt(s,p){const L=dmcStmts(s);const x=L.find(([a,b])=>p>=a&&p<=b+1)||L.find(([a])=>a>=p)||L[L.length-1];return x?s.slice(x[0],x[1]).trim():''}
const DMC_NOT_ALIAS=new Set(['on','where','join','left','right','inner','outer','full','cross','group','order','limit','offset','union','having','using','natural','lateral','window','for','except','intersect','and','or','as','select','from','set','values','returning']);
// Таблицы запроса: псевдоним → таблица; имена из WITH — свои
function dmcRefs(s){const m=dmcMask(s),al=new Map(),cte=new Set(),order=[];
  for(const x of m.matchAll(/(?:\bwith(?:\s+recursive)?|,)\s+([a-z_]\w*)\s+as\s*\(/gi))cte.add(x[1].toLowerCase());
  for(const x of m.matchAll(/\b(from|join)\s+((?:[a-z_]\w*\.)?[a-z_]\w*)(?:\s+(?:as\s+)?([a-z_]\w*))?/gi)){const tb=x[2].toLowerCase().replace(/^public\./,''),a=x[3]&&!DMC_NOT_ALIAS.has(x[3].toLowerCase())?x[3].toLowerCase():null;
    const ref={kw:x[1].toLowerCase(),t:tb,a:a||tb,at:x.index+x[0].indexOf(x[2]),len:x[2].length};order.push(ref);al.set(ref.a,tb);if(!al.has(tb))al.set(tb,tb)}
  return {al,cte,order}}

/* Ошибки по ходу набора (блок 3, пункт 4): незакрытая скобка или кавычка, неизвестная таблица или поле, выражение без AS, запрещённое.
   Отдаёт отрезки [начало, конец, причина]; в продукте то же отдаёт метод проверки на сервере разборщиком PostgreSQL */
function dmcIssues(s,o={}){const R=[],d=dmcDb(),m=dmcMask(s);
  // кавычка: маска закрывает строку до конца текста — значит, не закрыта
  {let i=0;while(i<s.length){if(s[i]==='-'&&s[i+1]==='-'){const j=s.indexOf('\n',i);i=j<0?s.length:j;continue}
    if(s[i]==="'"){let j=i+1;while(j<s.length){if(s[j]==="'"){if(s[j+1]==="'"){j+=2;continue}break}j++}if(j>=s.length){R.push([i,s.length,'Кавычка не закрыта']);break}i=j+1;continue}i++}}
  const st=[];for(let i=0;i<m.length;i++){if(m[i]==='(')st.push(i);else if(m[i]===')'){if(st.length)st.pop();else R.push([i,i+1,'Лишняя закрывающая скобка'])}}
  st.forEach(i=>R.push([i,i+1,'Скобка не закрыта']));
  const dn=DMC_DENY.exec(m);if(dn)R.push([dn.index,dn.index+dn[0].length,o.org?`«${dn[1]}» нельзя: шаблон только читает таблицы организации`:`«${dn[1]}» нельзя в консоли: она только читает`]);
  if(d){const {al,cte,order}=dmcRefs(s);
    order.forEach(r=>{if(!cte.has(r.t)&&!d.m.has(r.t)&&!/^(generate_series|unnest|jsonb_\w+|json_\w+)$/.test(r.t))R.push([r.at,r.at+r.len,`Таблицы «${r.t}» нет в базе`]);
      else if(o.org&&d.m.has(r.t)&&!d.m.get(r.t).org)R.push([r.at,r.at+r.len,`«${r.t}» закрыта для организаций: шаблон «Для организаций» её не прочитает`])});
    for(const x of m.matchAll(/\b([a-z_]\w*)\.([a-z_]\w*)\b(?!\s*\()/gi)){const a=x[1].toLowerCase(),f=x[2].toLowerCase();if(a==='app'||a==='public'||a==='pg_catalog'||a==='dm')continue;
      const tn=al.get(a);if(!tn||cte.has(tn))continue;const t=d.m.get(tn);if(t&&!t.cols.some(c=>c.n===f))R.push([x.index+a.length+1,x.index+x[0].length,`Поля «${f}» нет в таблице «${tn}»`])}}
  // выражение в списке SELECT без имени AS — без него нет столбца вывода
  const sm=/\bselect\s+(?:distinct\s+)?/i.exec(m);if(sm){let dep=0,i=sm.index+sm[0].length,a=i;const items=[];
    for(;i<m.length;i++){const c=m[i];if(c==='(')dep++;else if(c===')'){if(dep===0)break;dep--}else if(dep===0&&c===',' ){items.push([a,i]);a=i+1}else if(dep===0&&/\bfrom\b/iy.test(m.slice(i,i+5))&&/\W/.test(m[i-1]||' ')){break}}
    items.push([a,i]);items.forEach(([x,y])=>{const t=m.slice(x,y).trim();if(!t)return;const off=x+m.slice(x,y).indexOf(t);
      if(/^(\*|[a-z_]\w*\.\*|[a-z_]\w*|[a-z_]\w*\.[a-z_]\w*)$/i.test(t)||/\bas\s+"?[a-z_]\w*"?$/i.test(t))return;
      const im=/[\w)'"]\s+([a-z_]\w*)$/i.exec(t);if(im&&!/^(end|null|true|false|asc|desc)$/i.test(im[1]))return;
      R.push([off,off+t.length,'Дайте столбцу имя через AS: без него нет столбца вывода'])})}
  return R.sort((a,b)=>a[0]-b[0])}
// Подсветка с подчёркиванием ошибок: части текста между границами отрезков подсвечиваются по отдельности
function dmcHl(s,errs){if(!errs||!errs.length)return dmHl(s);const cut=new Set([0,s.length]);errs.forEach(([a,b])=>{cut.add(a);cut.add(b)});const P=[...cut].sort((a,b)=>a-b);let h='';
  for(let i=0;i<P.length-1;i++){const a=P[i],b=P[i+1];if(a===b)continue;const part=dmHl(s.slice(a,b)).replace(/\n$/,''),e=errs.find(([x,y])=>a>=x&&b<=y);h+=e?`<span class="sq-err" title="${esc(e[2])}">${part}</span>`:part}return h+'\n'}

/* «Форматировать»: заглавные слова SQL и перенос основных частей запроса на новую строку; строки и комментарии не трогаются */
const DMC_FMT_KW=new Set('select from where and or not in is null as on join left right inner outer full cross group by order having limit offset distinct case when then else end with recursive union all exists between like ilike asc desc nulls first last over partition filter cast true false interval lateral using'.split(' '));
function dmcLex(s){const T=[];let i=0;const n=s.length;while(i<n){const c=s[i];let j;
    if(c==='-'&&s[i+1]==='-'){j=s.indexOf('\n',i);j=j<0?n:j;T.push({k:'com',v:s.slice(i,j)});i=j;continue}
    if(c==='/'&&s[i+1]==='*'){j=s.indexOf('*/',i+2);j=j<0?n:j+2;T.push({k:'lit',v:s.slice(i,j)});i=j;continue}
    if(c==="'"){j=i+1;while(j<n){if(s[j]==="'"){if(s[j+1]==="'"){j+=2;continue}break}j++}j=Math.min(n,j+1);T.push({k:'lit',v:s.slice(i,j)});i=j;continue}
    if(c==='"'){j=s.indexOf('"',i+1);j=j<0?n:j+1;T.push({k:'lit',v:s.slice(i,j)});i=j;continue}
    if(/\s/.test(c)){j=i;while(j<n&&/\s/.test(s[j]))j++;T.push({k:'ws',v:s.slice(i,j)});i=j;continue}
    const w=/^[a-z_][\w$]*/i.exec(s.slice(i,i+128));if(w){T.push({k:'w',v:w[0]});i+=w[0].length;continue}T.push({k:'s',v:c});i++}return T}
function dmcFormat(s){const T=dmcLex(s);
  const BR=new Set(['from','where','group','order','having','limit','offset','union','join','left','right','inner','full','cross']);let o='',dep=0,cl='',prevW='';
  T.forEach((t,ix)=>{if(t.k==='ws'){const pv=T[ix-1];o+=pv&&pv.k==='com'?'\n':' ';return}
    if(t.k==='s'){if(t.v==='(')dep++;if(t.v===')')dep=Math.max(0,dep-1);if(t.v===','&&dep===0&&cl==='select'){o=o.replace(/\s+$/,'')+',\n  ';return}o+=t.v;return}
    if(t.k!=='w'){o+=t.v;return}const l=t.v.toLowerCase(),up=DMC_FMT_KW.has(l)?t.v.toUpperCase():t.v;
    if(dep===0&&BR.has(l)&&!(l==='join'&&/^(left|right|inner|full|cross|outer)$/.test(prevW))&&!(l==='outer')){o=o.replace(/\s+$/,'')+'\n';cl=l}
    else if(dep===0&&(l==='and'||l==='or')&&(cl==='where'||cl==='having')){o=o.replace(/\s+$/,'')+'\n  '}
    else if(dep===0&&l==='select'){if(o.trim())o=o.replace(/\s+$/,'')+'\n';o+=up+'\n  ';cl='select';prevW=l;return}
    o+=up;prevW=l});
  return o.replace(/\n  \s+/g,'\n  ').replace(/[ \t]+$/gm,'').replace(/\n{2,}/g,'\n').trim()}

/* Подсказки при наборе (блок 3, пункт 2) и карточка при наведении (пункт 3) для любого поля запроса .dm-sqlb */
const dmcKind=t=>t.money?'Деньги':t.t;
function dmcSuggest(s,p,o={}){const d=dmcDb();if(!d)return null;const before=s.slice(0,p),m=dmcMask(before);
  if(m.length&&m[m.length-1]!==before[before.length-1])return null;// внутри строки или комментария
  const w=/([a-z_]\w*)\.([a-z_]\w*)?$|([a-zа-яё_][\wа-яё]*)$/i.exec(before);const {al,order}=dmcRefs(s);
  if(w&&w[1]){const tn=al.get(w[1].toLowerCase()),t=tn&&d.m.get(tn);if(!t)return null;const pre=(w[2]||'').toLowerCase();
    return {from:p-(w[2]||'').length,items:t.cols.filter(c=>!pre||c.n.startsWith(pre)||c.ru.toLowerCase().includes(pre)).map(c=>({l:c.n,d:`${dmcKind(c)} · ${c.ru||'нет описания'}`,ins:c.n,no:!c.desc}))}}
  const pre=w?w[3]:'',pl=pre.toLowerCase(),head=m.slice(0,m.length-pre.length),prev=(/([a-z_]+)\s*$/i.exec(head)||[])[1];const pv=prev&&prev.toLowerCase();
  if(pv==='from'||pv==='join'){const L=d.T.filter(t=>!pl||t.n.startsWith(pl)||t.n.includes(pl)||t.ru.toLowerCase().includes(pl)).sort((a,b)=>{const r=t=>t.n.startsWith(pl)?0:t.ru.toLowerCase().startsWith(pl)?1:t.n.includes(pl)?2:3;return r(a)-r(b)||a.n.localeCompare(b.n)}).slice(0,40);
    return {from:p-pre.length,items:L.map(t=>({l:t.n,d:t.ru+(o.org&&!t.org?' · закрыто для организаций':''),ins:t.n}))}}
  if(pv==='on'&&!pre){const last=order.filter(r=>r.kw==='join').pop();if(!last)return null;const X=d.m.get(last.t);if(!X)return null;const L=[];
    order.filter(r=>r!==last).forEach(r=>{const Y=d.m.get(r.t);if(!Y)return;X.out.filter(f=>f.to===Y.n).forEach(f=>L.push(`${last.a}.${f.col} = ${r.a}.${f.toCol}`));Y.out.filter(f=>f.to===X.n).forEach(f=>L.push(`${r.a}.${f.col} = ${last.a}.${f.toCol}`))});
    return L.length?{from:p,items:[...new Set(L)].map(x=>({l:x,d:'Условие по связи таблиц',ins:x}))}:null}
  if(/\b(?:from|join)\s+[\w.]+\s+$/i.test(head)&&!o.force)return null;// место псевдонима таблицы
  if(pre.length<2&&!o.force)return null;
  const items=[...DMC_FN.filter(f=>f[0].startsWith(pl)).map(f=>({l:f[0],d:`${f[2]} · ${f[1]}`,ins:f[1]})),...DMC_SQLKW.filter(k=>k.startsWith(pl)&&k!==pl).map(k=>({l:k.toUpperCase(),d:'Слово SQL',ins:k.toUpperCase()})),
    ...[...al.keys()].filter(a=>a.startsWith(pl)&&a!==pl).map(a=>({l:a,d:'Псевдоним: '+al.get(a),ins:a}))].slice(0,30);
  return items.length?{from:p-pre.length,items}:null}
function dmcCard(word){const d=dmcDb();if(!d||!word)return '';const[a,f]=word.toLowerCase().split('.');
  if(f){return ''}const t=d.m.get(a);if(!t)return '';
  const rel=[...t.out.map(x=>`→ <b class="mono">${esc(x.to)}</b> по ${esc(x.col)}`),...t.inc.slice(0,6).map(x=>`← <b class="mono">${esc(x.from)}</b>.${esc(x.col)}`)];
  return `<b>${esc(t.ru)}</b> <span class="mono faint">${esc(t.n)}</span>${t.org?'':' <span class="tag">закрыто для организаций</span>'}<p>${esc(t.desc.slice(0,260))}${t.desc.length>260?'…':''}</p>${rel.length?`<div class="dmc-rel">${rel.join('<br>')}${t.inc.length>6?`<br><span class="faint">ещё ${t.inc.length-6}</span>`:''}</div>`:''}<button type="button" class="linkbtn" data-dmc-sch="${esc(t.n)}">${ic('db','sm')}Показать на схеме</button>`}
function dmcFieldCard(t,c){return `<b>${esc(c.ru||c.n)}</b> <span class="mono faint">${esc(t.n)}.${esc(c.n)}</span> <span class="tag">${esc(c.t)}</span>${c.money?' <span class="tag">деньги в тыйынах</span>':''}${t.org?'':' <span class="tag">закрыто для организаций</span>'}<p>${c.desc?esc(c.desc):'<span class="faint">нет описания</span>'}</p>${c.fk?`<div class="dmc-rel">→ <b class="mono">${esc(c.fk)}</b></div>`:''}<button type="button" class="linkbtn" data-dmc-sch="${esc(t.n)}">${ic('db','sm')}Показать на схеме</button>`}
// Подключение к полю: подсказки (Ctrl+Пробел — вручную), Enter/Tab — вставить, Esc — закрыть; наведение — карточка; ошибки — подчёркнуты и списком
function dmcAssist(ta,o={}){const w=ta&&ta.closest('.dm-sqlb');if(!w||w._dmc)return;w._dmc=1;const pre=$('.dm-hl',w);
  const pop=document.createElement('div');pop.className='dmc-pop';pop.hidden=true;w.appendChild(pop);const card=document.createElement('div');card.className='dmc-card';card.hidden=true;w.appendChild(card);
  const errBox=o.errBox||null;let sg=null,sel=0,tmr=0,skip=false;
  const met=()=>{const cs=getComputedStyle(ta),cv=dmcAssist._cx||(dmcAssist._cx=document.createElement('canvas').getContext('2d'));cv.font=`${cs.fontSize} ${cs.fontFamily}`;
    return {cw:cv.measureText('0').width,lh:parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.5,pt:parseFloat(cs.paddingTop)+parseFloat(cs.borderTopWidth),pl:parseFloat(cs.paddingLeft)+parseFloat(cs.borderLeftWidth)}};
  const xy=p=>{const M=met(),L=ta.value.slice(0,p).split('\n');return {x:M.pl+L[L.length-1].length*M.cw-ta.scrollLeft+ta.offsetLeft,y:M.pt+L.length*M.lh-ta.scrollTop+ta.offsetTop}};
  const at=(cx,cy)=>{const M=met(),r=ta.getBoundingClientRect(),ln=Math.floor((cy-r.top-M.pt+ta.scrollTop)/M.lh),col=Math.floor((cx-r.left-M.pl+ta.scrollLeft)/M.cw);const L=ta.value.split('\n');if(ln<0||ln>=L.length||col<0||col>L[ln].length)return -1;
    let p=0;for(let i=0;i<ln;i++)p+=L[i].length+1;return p+col};
  const close=()=>{sg=null;pop.hidden=true};
  const show=force=>{if(ta.readOnly||ta.disabled)return close();sg=dmcSuggest(ta.value,ta.selectionStart,{org:o.org&&o.org(),force});const cur=sg?ta.value.slice(sg.from,ta.selectionStart).toLowerCase():'';if(sg&&!force)sg.items=sg.items.filter(x=>x.ins.toLowerCase()!==cur);if(!sg||!sg.items.length)return close();sel=0;draw()};
  const draw=()=>{pop.innerHTML=sg.items.map((x,i)=>`<button type="button" class="dmc-it${i===sel?' on':''}" data-i="${i}"><span class="mono">${esc(x.l)}</span><span class="faint${x.no?' dmc-no':''}">${esc(x.d)}</span></button>`).join('');
    const c=xy(ta.selectionStart);pop.style.left=Math.max(0,Math.min(c.x,w.clientWidth-300))+'px';pop.style.top=c.y+'px';pop.hidden=false;const on=$('.on',pop);if(on)on.scrollIntoView({block:'nearest'})};
  const put=x=>{const p=ta.selectionStart;ta.setRangeText(x.ins,sg.from,p,'end');close();skip=true;ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus()};
  pop.addEventListener('mousedown',e=>{const b=e.target.closest('[data-i]');if(!b)return;e.preventDefault();put(sg.items[+b.dataset.i])});
  ta.addEventListener('keydown',e=>{if(e.ctrlKey&&e.code==='Space'){e.preventDefault();show(true);return}if(!sg)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();sel=(sel+(e.key==='ArrowDown'?1:-1)+sg.items.length)%sg.items.length;draw()}
    else if((e.key==='Enter'&&!e.ctrlKey&&!e.metaKey)||e.key==='Tab'){e.preventDefault();put(sg.items[sel])}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close()}});
  const marks=()=>dmcIssues(ta.value,{org:o.org&&o.org()});
  const redraw=()=>{const E=marks();pre.innerHTML=dmcHl(ta.value,E);pre.scrollTop=ta.scrollTop;pre.scrollLeft=ta.scrollLeft;if(errBox)errBox.innerHTML=E.slice(0,5).map(x=>{const ln=ta.value.slice(0,x[0]).split('\n').length;return `<li>${ic('alert','sm')}<span>Строка ${ln}: ${esc(x[2])}</span></li>`}).join('')};
  ta.addEventListener('input',()=>{clearTimeout(tmr);tmr=setTimeout(redraw,350);if(skip)skip=false;else show(false)});ta.addEventListener('blur',()=>setTimeout(close,150));ta.addEventListener('click',close);
  ta.addEventListener('mousemove',e=>{const p=at(e.clientX,e.clientY);if(p<0){card.hidden=true;return}const s=ta.value;let a=p,b=p;while(a>0&&/[\w.]/.test(s[a-1]))a--;while(b<s.length&&/\w/.test(s[b]))b++;const wd=s.slice(a,b);
    let h='';if(/\./.test(wd)){const[al,f]=wd.toLowerCase().split('.');const tn=dmcRefs(s).al.get(al),t=tn&&dmcTbl(tn),c=t&&t.cols.find(x=>x.n===f);if(c&&p>=a+al.length)h=dmcFieldCard(t,c);else if(t&&p<a+al.length)h=dmcCard(tn)}else h=dmcCard(wd);
    if(!h){if(!card.matches(':hover'))card.hidden=true;return}if(card.dataset.w!==wd){card.dataset.w=wd;card.innerHTML=h}const r=w.getBoundingClientRect();card.style.left=Math.max(0,Math.min(e.clientX-r.left+12,w.clientWidth-320))+'px';card.style.top=(e.clientY-r.top+18)+'px';card.hidden=false});
  ta.addEventListener('mouseleave',()=>setTimeout(()=>{if(!card.matches(':hover'))card.hidden=true},200));card.addEventListener('mouseleave',()=>card.hidden=true);
  card.addEventListener('click',e=>{const b=e.target.closest('[data-dmc-sch]');if(b){card.hidden=true;tdShowTable(b.dataset.dmcSch)}});
  redraw();return {redraw}}

/* П6. Запрос метода API → SELECT (блок 5, пункт 2): CREATE VIEW … AS SELECT → SELECT; проверки «администратор» и «моя организация» убираются —
   их делает роль базы; ${…} и $1 → параметры :имя; служебные функции и представления app.* помечаются «-- замените: …»; деньги — тип «Деньги» */
const DMC_CHECK=String.raw`(?:app\.is_platform_admin\(\)|(?:[a-z_]\w*\.)?org_id\s*=\s*app\.current_org_id\(\)|app\.current_org_id\(\)\s*=\s*(?:[a-z_]\w*\.)?org_id)`;
const dmcSnake=x=>x.replace(/([a-z0-9])([A-Z])/g,'$1_$2').toLowerCase().replace(/[^a-z0-9_]/g,'_').replace(/_+/g,'_').replace(/^_|_$/g,'');
function dmcRewrite(src){const notes=[];let s=String(src).trim().replace(/;\s*$/,'');const params=[];
  const v=/^create\s+(?:or\s+replace\s+)?view\s+([\w."]+)\s*(?:with\s*\([^)]*\)\s*)?as\s+/i.exec(s);if(v){s=s.slice(v[0].length);notes.push(`CREATE VIEW ${v[1]} … AS SELECT → SELECT`)}
  if(!/^(select|with)\b/i.test(s))return {sql:null,notes:['Запрос метода не SELECT: шаблон из него не сделать'],params,cols:[]};
  const C=DMC_CHECK,n0=s;s=s.replace(new RegExp(String.raw`\bwhere\s+${C}\s+and\s+`,'gi'),'WHERE ').replace(new RegExp(String.raw`\s+and\s+${C}`,'gi'),'').replace(new RegExp(String.raw`\s+and\s+\(\s*${C}\s*\)`,'gi'),'').replace(new RegExp(String.raw`\s*\bwhere\s+${C}(?=\s*(?:$|\)|\b(?:group|order|limit|union|having|window)\b))`,'gi'),'');
  if(s!==n0)notes.push('Убраны проверки «это администратор» и «моя организация»: их делает роль базы');
  const used=new Set();const pname=x=>{let k=dmcSnake(x)||'p';if(/^\d/.test(k))k='p'+k;let n=k,i=2;while(used.has(n)&&!params.includes(n))n=k+i++;used.add(n);if(!params.includes(n))params.push(n);return n};
  s=s.replace(/\$\{\s*([^}]*)\}/g,(x,e)=>{const id=(e.match(/[A-Za-z_]\w*(?=\s*(?:\)|$|\?\?|\|\|))/g)||e.match(/[A-Za-z_]\w*/g)||['p']).pop();const n=pname(id);notes.push(`\${${e.trim()}} → :${n}`);return ':'+n});
  s=s.replace(/\$(\d+)\b/g,(x,d)=>{const n=pname('p'+d);notes.push(`$${d} → :${n}`);return ':'+n});
  s=s.replace(/app\.current_user_id\(\)/g,()=>{const n=pname('user_id');notes.push('app.current_user_id() → :'+n);return ':'+n});
  s=s.replace(/\bpublic\./g,'');
  const svc=[...new Set([...dmcMask(s).matchAll(/\bapp\.([a-z_]\w*)/gi)].map(x=>x[1]))];
  if(svc.length){s=s.split('\n').map(l=>{const f=[...new Set([...dmcMask(l).matchAll(/\bapp\.([a-z_]\w*)/gi)].map(x=>x[1]))];return f.length?`${l} -- замените: ${f.map(x=>'app.'+x).join(', ')} — служебная функция или представление базы, шаблону недоступно`:l}).join('\n');
    notes.push('Служебные функции и представления помечены «-- замените»: '+svc.map(x=>'app.'+x).join(', '))}
  const cols=dmSqlCols(s).map(k=>({k,label:k,type:/^(amount|sum|paid|debt|price|fee|balance|total)$|_(amount|sum|paid|debt|price|fee|balance|tyiyn)$/.test(k)?'money':k==='contractor_id'?'cp':/(_at)$/.test(k)?'datetime':/(_date|_on|^date)$/.test(k)?'date':'text',total:false}));
  const mn=cols.filter(c=>c.type==='money');if(mn.length)notes.push('Деньги остаются в тыйынах: столбцам '+mn.map(c=>c.k).join(', ')+' поставлен тип «Деньги»');
  return {sql:s,notes,params,cols}}
// Точный SQL метода чтения: запрос или представление из снимка; null — запрос написан кодом (П9: «Собрать запрос по таблицам метода»)
function dmcMethodSql(m){if(!m||m.m!=='GET')return null;const a=tdApi();const qs=(m.q||[]).map(i=>a.sql[i]).filter(q=>q&&(q.k==='sql'||q.k==='view')&&/^\s*(select|with|create\s+(or\s+replace\s+)?view)\b/i.test(q.t));return qs.length?qs[0].t:null}
function dmcFromMethod(m,toTpl){const t=dmcMethodSql(m);if(!t)return toast('У метода нет точного SQL: запрос написан кодом','alert',true);const r=dmcRewrite(t);if(!r.sql)return toast(r.notes[0],'alert',true);
  const p={};r.params.forEach(k=>p[k]='');dmConOpen(r.sql,p,m.sum||m.p,{notes:{warn:DMC_WARN,list:r.notes,from:`${m.m} ${m.p}`},cols:r.cols,toTpl})}

/* Вкладка «Консоль» */
function renderDmCon(body){dmcState();if(isMobile())return dmcPhone(body);const t=dmcTab();
  body.innerHTML=`<div class="dmc">
    <aside class="dmc-side box"><div class="tabs sm dmc-st" role="tablist">${[['db','База'],['api','Методы API'],['pre','Заготовки'],['mine','Мои запросы']].map(([k,l])=>`<button type="button" class="tab${DMC.side===k?' on':''}" data-dmc-side="${k}">${l}</button>`).join('')}</div>
      <input class="inp dmc-q" id="dmc-q" value="${esc(DMC.q)}" placeholder="${DMC.side==='api'?'Метод или адрес':DMC.side==='mine'?'Название или текст':'Таблица или поле, можно по-русски'}" ${DMC.side==='pre'?'hidden':''}><div class="dmc-list" id="dmc-list"></div></aside>
    <section class="dmc-main"><div class="dmc-tabs">${DMC.tabs.map((x,i)=>`<button type="button" class="dmc-tab${i===DMC.cur?' on':''}" data-dmc-tab="${i}" title="${esc(x.name)}"><span>${esc(x.name)}</span><span class="dmc-x" data-dmc-close="${i}" title="Закрыть вкладку">${ic('x','sm')}</span></button>`).join('')}<button type="button" class="btn sm ghost" id="dmc-new" title="Новая вкладка запроса">${ic('plus','sm')}</button></div>
      <div class="row dmc-bar"><button type="button" class="btn cta" id="dmc-run" title="Ctrl+Enter: выделенный текст, без выделения — оператор под курсором">${ic('play','sm')}Выполнить</button><button type="button" class="btn" id="dmc-stop" disabled title="Запрос не выполняется">Остановить</button><button type="button" class="btn" id="dmc-plan">План запроса</button><button type="button" class="btn" id="dmc-fmt">Форматировать</button><button type="button" class="btn" id="dmc-xl" ${t.res&&t.res.rows?'':'disabled title="Сначала выполните запрос"'}>${ic('download','sm')}В Excel</button><span class="grow"></span><button type="button" class="btn" id="dmc-mine">Сохранить в Мои запросы</button><button type="button" class="btn" id="dmc-tpl">${ic('layers','sm')}Сохранить в шаблон</button></div>
      ${t.notes?`<div class="note warn dmc-from">${ic('alert')}<span><b>${esc(t.notes.warn)}.</b>${t.notes.from?` Метод <span class="mono">${esc(t.notes.from)}</span>.`:''}${t.notes.list&&t.notes.list.length?`<br>Что заменено: ${t.notes.list.map(esc).join('; ')}.`:''}</span></div>`:''}
      ${t.tpl&&dmTpl(t.tpl)?`<div class="hint" style="margin:0">Запрос шаблона «${esc(dmTpl(t.tpl).name)}»: «Сохранить в шаблон» пишет в этот шаблон${dmTpl(t.tpl).src==='system'?' — готовый шаблон платформы сохраняется только копией':''}</div>`:''}
      <div class="dm-sqlb dmc-ed"><div class="dm-sqlg" aria-hidden="true"><div>${dmLn(t.sql)}</div></div><pre class="dm-hl mono" aria-hidden="true">${dmHl(t.sql)}</pre><textarea class="inp mono dm-sql" id="dmc-s" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Запрос">${esc(t.sql)}</textarea></div>
      <ul class="dmc-errs" id="dmc-errs"></ul><div class="dm-pars dmc-pars" id="dmc-pars"></div><div id="dmc-res"></div></section></div>`;
  const q=s=>$(s,body),ta=q('#dmc-s');dmHlBind(ta);dmcAssist(ta,{errBox:q('#dmc-errs')});
  const pars=()=>{const ks=dmSqlPars(ta.value);q('#dmc-pars').innerHTML=ks.length?ks.map(k=>{const v=t.params[k]??(/month/.test(k)?ym(TODAY):/date|_from|_to/.test(k)?TODAY:'');const ty=/month/.test(k)?'month':/date|_from$|_to$/.test(k)?'date':'text';
      return fld(':'+esc(k),`<input class="inp" type="${ty}" id="dmcp-${esc(k)}" data-dmc-p="${esc(k)}" value="${esc(v)}">`,{id:'dmcp-'+k})}).join('')+'<span class="hint" style="margin:0">Значение уходит в базу как данные и в текст запроса не вклеивается</span>':'';
    $$('[data-dmc-p]',body).forEach(x=>x.oninput=()=>{t.params[x.dataset.dmcP]=x.value;dmcSave()})};
  let pt=0;ta.addEventListener('input',()=>{t.sql=ta.value;t.res=null;clearTimeout(pt);pt=setTimeout(()=>{pars();dmcSave()},300)});
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();dmcRun(body,t,ta)}});
  pars();dmcResDraw(q('#dmc-res'),t);dmcSide(body);
  q('#dmc-run').onclick=()=>dmcRun(body,t,ta);q('#dmc-plan').onclick=()=>dmcPlan(body,t,ta);
  q('#dmc-fmt').onclick=()=>{const a=ta.selectionStart,b=ta.selectionEnd;if(a!==b){ta.setRangeText(dmcFormat(ta.value.slice(a,b)),a,b,'select')}else ta.value=dmcFormat(ta.value);ta.dispatchEvent(new Event('input',{bubbles:true}))};
  q('#dmc-xl').onclick=()=>dmcXl(t);q('#dmc-mine').onclick=()=>dmcMineDlg(t);q('#dmc-tpl').onclick=()=>{t.sql=ta.value;dmcToTpl(t)};
  q('#dmc-new').onclick=()=>{DMC.tabs.push(dmcNewTab({sql:''}));DMC.cur=DMC.tabs.length-1;dmcSave();renderPage()};
  $$('[data-dmc-tab]',body).forEach(b=>b.onclick=e=>{const c=e.target.closest('[data-dmc-close]');if(c){const i=+c.dataset.dmcClose;DMC.tabs.splice(i,1);if(!DMC.tabs.length)DMC.tabs.push(dmcNewTab());DMC.cur=Math.min(DMC.cur>i?DMC.cur-1:DMC.cur,DMC.tabs.length-1)}else DMC.cur=+b.dataset.dmcTab;dmcSave();renderPage()});
  $$('[data-dmc-side]',body).forEach(b=>b.onclick=()=>{DMC.side=b.dataset.dmcSide;DMC.q='';renderPage()});
  q('#dmc-q').oninput=e=>{DMC.q=e.target.value;dmcSide(body)}}

// Левая панель: «База», «Методы API», «Заготовки», «Мои запросы» и «История»
function dmcSide(body){const host=$('#dmc-list',body),q=DMC.q.trim().toLowerCase(),ta=$('#dmc-s',body);const ins=x=>{if(!ta)return;ta.focus();ta.setRangeText(x,ta.selectionStart,ta.selectionEnd,'end');ta.dispatchEvent(new Event('input',{bubbles:true}))};
  if(DMC.side==='db'){const d=dmcDb();if(!d){host.innerHTML=tdMissing('описание базы');return}
    const L=d.T.filter(t=>!q||t.n.includes(q)||t.ru.toLowerCase().includes(q)||t.cols.some(c=>c.n.includes(q)||c.ru.toLowerCase().includes(q)));
    host.innerHTML=d.G.map(g=>{const ts=L.filter(t=>t.g===g.id);return ts.length?`<details class="dmc-g" ${q?'open':''}><summary>${esc(g.ru)} <span class="faint">${ts.length}</span></summary>${ts.map(t=>`<details class="dmc-t"><summary><button type="button" class="linkbtn mono" data-dmc-ins="${esc(t.n)}" title="Вставить в запрос">${esc(t.n)}</button> <span class="faint">${esc(t.ru)}</span>${t.org?'':' <span class="tag sm" title="Роль организаций таблицу не читает">закрыто для организаций</span>'}</summary><ul>${t.cols.map(c=>`<li><button type="button" class="linkbtn mono" data-dmc-ins="${esc(c.n)}">${esc(c.n)}</button> <span class="faint">${esc(dmcKind(c))}</span> <span class="${c.desc?'':'faint'}">${esc(c.ru||'нет описания')}</span></li>`).join('')}</ul><button type="button" class="linkbtn" data-dmc-sch="${esc(t.n)}">${ic('db','sm')}Показать на схеме</button></details>`).join('')}</details>`:''}).join('')||'<span class="faint">Ничего не нашлось</span>'}
  else if(DMC.side==='api'){const a=tdApi();if(!a){host.innerHTML=tdMissing('описание API');return}
    const L=a.methods.filter(m=>m.m==='GET'&&(!q||m.p.toLowerCase().includes(q)||(m.sum||'').toLowerCase().includes(q))).slice(0,150);
    host.innerHTML=`<span class="hint" style="margin:0">Методы чтения (GET). Кнопки передают запрос в консоль, сами ничего не выполняют.</span>`+L.map(m=>{const ok=!!dmcMethodSql(m);return `<div class="dmc-m"><button type="button" class="linkbtn" data-dmc-md="${esc(m.id)}" title="Карточка метода">${tdMth(m.m)} <span class="mono">${esc(m.p)}</span></button><span class="faint">${esc(m.sum||'')}</span>${ok?`<div class="row"><button type="button" class="btn sm" data-dmc-mo="${esc(m.id)}">Открыть в консоли</button><button type="button" class="btn sm" data-dmc-mt="${esc(m.id)}">Создать шаблон на основе</button></div>`:'<span class="hint" style="margin:0">Запрос написан кодом: точного SQL нет</span>'}</div>`}).join('')}
  else if(DMC.side==='pre'){host.innerHTML=`<div class="state">${ic('book','lg')}<b>Заготовки появятся в следующей версии</b><span>Частые запросы и образцы конструкций. Запрос готового шаблона открывается в консоли из вкладки «Шаблоны» — кнопкой «Открыть в консоли».</span></div>`}
  else{const mine=dmcMine().filter(x=>x.by===S.me&&(!q||x.name.toLowerCase().includes(q)||x.sql.toLowerCase().includes(q))),hist=dmcHist().filter(x=>x.by===S.me&&(!q||x.sql.toLowerCase().includes(q)));
    host.innerHTML=`<div class="tabs sm" role="tablist"><button type="button" class="tab${DMC.mq==='mine'?' on':''}" data-dmc-mq="mine">Мои запросы · ${mine.length}</button><button type="button" class="tab${DMC.mq==='hist'?' on':''}" data-dmc-mq="hist">История · ${hist.length}</button></div>`+
      (DMC.mq==='mine'?(mine.length?mine.slice().sort((a,b)=>b.at.localeCompare(a.at)).map(x=>`<div class="dmc-m"><button type="button" class="linkbtn" data-dmc-mine="${esc(x.id)}"><b>${esc(x.name)}</b></button><span class="mono faint dmc-1">${esc(x.sql.split('\n')[0])}</span><div class="row"><span class="faint">${fmtDT(x.at)}</span><span class="grow"></span><button type="button" class="btn sm ghost" data-dmc-mdel="${esc(x.id)}" title="Удалить">${ic('trash','sm')}</button></div></div>`).join(''):'<span class="faint">Сохранённых запросов нет. «Сохранить в Мои запросы» над редактором. Их видите только вы.</span>')
        :(hist.length?hist.slice(-DMC_HIST_MAX).reverse().map((x,i)=>`<div class="dmc-m"><button type="button" class="linkbtn mono dmc-1" data-dmc-h="${dmcHist().indexOf(x)}">${esc(x.sql.split('\n')[0])}</button><span class="faint">${fmtDT(x.at)} · ${esc(x.res)}${x.n!=null?` · строк ${x.n}`:''}</span></div>`).join(''):'<span class="faint">Запусков ещё не было. Здесь — ваши последние 100.</span>'))}
  host.onclick=e=>{let b;if(b=e.target.closest('[data-dmc-ins]'))ins(b.dataset.dmcIns);else if(b=e.target.closest('[data-dmc-sch]'))tdShowTable(b.dataset.dmcSch);
    else if(b=e.target.closest('[data-dmc-md]'))tdMethod(b.dataset.dmcMd,'sql');else if(b=e.target.closest('[data-dmc-mo],[data-dmc-mt]')){const id=b.dataset.dmcMo||b.dataset.dmcMt;dmcFromMethod(tdApi().methods.find(m=>m.id===id),!!b.dataset.dmcMt)}
    else if(b=e.target.closest('[data-dmc-mq]')){DMC.mq=b.dataset.dmcMq;dmcSide(body)}
    else if(b=e.target.closest('[data-dmc-mine]')){const x=dmcMine().find(y=>y.id===b.dataset.dmcMine);if(x)dmConOpen(x.sql,Object.assign({},x.params),x.name,{mq:x.id})}
    else if(b=e.target.closest('[data-dmc-mdel]')){const x=dmcMine().find(y=>y.id===b.dataset.dmcMdel);if(x)confirmDlg({title:'Удалить запрос?',text:`«${esc(x.name)}» пропадёт из «Моих запросов».`,ok:'Удалить',danger:true,run:()=>{dmcMine().splice(dmcMine().indexOf(x),1);DMC.tabs.forEach(t=>{if(t.mq===x.id)t.mq=null});dmcSave();dmcSide(body);toast('Запрос удалён','trash')}})}
    else if(b=e.target.closest('[data-dmc-h]')){const x=dmcHist()[+b.dataset.dmcH];if(x)dmConOpen(x.sql,Object.assign({},x.params||{}),'Из истории')}}}

/* «Выполнить»: в базу уходит один оператор — выделенный текст или оператор под курсором (блок 1, пункт 3) */
const dmcNorm=s=>dmcMask(String(s)).replace(/\s+/g,' ').trim().replace(/;$/,'').toLowerCase();
function dmcPick(ta){const a=ta.selectionStart,b=ta.selectionEnd;return a!==b?ta.value.slice(a,b).trim():dmcStmtAt(ta.value,a)}
function dmcRun(body,t,ta){const s=dmcPick(ta);if(!s)return toast('Нет запроса под курсором','alert',true);
  if(dmcStmts(s).length>1){t.res={err:'В базу уходит один оператор: выделите один запрос или поставьте курсор на него'};return dmcResDraw($('#dmc-res',body),t)}
  const E=dmcIssues(s).filter(x=>/нельзя|закрыт|Лишняя/.test(x[2]));const p={};dmSqlPars(s).forEach(k=>p[k]=t.params[k]??null);
  const miss=dmSqlPars(s).filter(k=>!p[k]);if(miss.length){t.res={err:`Укажите значение параметра :${miss[0]} — полоска полей над результатом`};return dmcResDraw($('#dmc-res',body),t)}
  let r;if(E.length)r={err:E[0][2]};else{const tp=DM_TPL.find(x=>x.sql&&dmcNorm(x.sql)===dmcNorm(s));const run=tp&&DM_RUN[tp.run||tp.code]?dmRun(Object.assign({},tp,{state:'Опубликован'}),Object.assign(Object.fromEntries(tp.params.map(x=>[x.k,dmDef(x.def)])),p),ORG.id):null;
    r=run?{rows:run.rows,ms:run.ms,cols:tp.cols.filter(c=>c.type!=='cp'),tpl:tp.name}:{stand:true,cols:dmSqlCols(s).map(k=>({k,label:k,type:'text'}))}}
  t.res=r;t.cols=r.cols||t.cols;dmcHist().push({at:nowStamp(),by:S.me,sql:s,params:p,n:r.rows?r.rows.length:null,res:r.err?'Ошибка':r.stand?'На стенде':'Успешно'});
  while(dmcHist().filter(x=>x.by===S.me).length>DMC_HIST_MAX)dmcHist().splice(dmcHist().findIndex(x=>x.by===S.me),1);
  dmcResDraw($('#dmc-res',body),t);const xl=$('#dmc-xl',body);if(xl){xl.disabled=!r.rows;xl.title=r.rows?'':'Сначала выполните запрос'}if(DMC.side==='mine')dmcSide(body)}
function dmcPlan(body,t,ta){const s=dmcPick(ta);if(!s)return toast('Нет запроса под курсором','alert',true);t.res={plan:true};dmcResDraw($('#dmc-res',body),t)}
// Результат под редактором: та же таблица «как в Excel», что во «Выводе»; деньги — в сомах с пометкой «в базе тыйыны»
function dmcResDraw(host,t){const r=t.res;if(!host)return;if(!r){host.innerHTML='';return}
  if(r.err){host.innerHTML=`<div class="note bad">${ic('alert')}<span>${esc(r.err)}</span></div>`;return}
  if(r.plan){host.innerHTML=`<div class="note">${ic('info')}<span>«План запроса» — оценка запроса базой без выполнения: сколько строк и насколько тяжёлый запрос. Прототип не выполняет SQL: план покажет тестовый стенд. В журнал консоли он не пишется.</span></div>`;return}
  if(r.stand){host.innerHTML=`<div class="note">${ic('info')}<span>На стенде здесь будет ответ базы: строки, их число и время выполнения, ошибка — текстом базы. Прототип показывает ответ, только если запрос совпадает с готовым шаблоном.${r.cols.length?` Столбцы вывода: ${r.cols.map(c=>esc(c.k)).join(', ')}.`:''}</span></div>`;return}
  const money=r.cols.some(c=>c.type==='money');
  host.innerHTML=`<div class="row dm-meta"><span class="hint" style="margin:0">Строк: <b>${r.rows.length}</b> · выполнено за ${r.ms} мс · прототип: ответ шаблона «${esc(r.tpl)}» на демо-данных${money?' · деньги — в сомах, в базе тыйыны':''}</span></div><div class="ex-stat" id="dmc-st"></div><div id="dmc-g"></div>`;
  grid($('#dmc-g',host),{id:'dmc-res',audit:false,fixedView:'table',size:'all',rid:x=>x._i,ordered:true,noun:['строка','строки','строк'],cols:r.cols.map((c,i)=>Object.assign(dmCol(c,i),{label:c.k+(c.type==='money'?' · сом':''),title:c.type==='money'?'В базе тыйыны, здесь — сомы':c.label})),rows:r.rows,
    empty:{icon:'search',title:'Запрос не вернул строк',text:'Измените запрос или параметры и нажмите «Выполнить».'},after:h=>dmEx(h,$('#dmc-st',host))})}
function dmcXl(t){const r=t.res;if(!r||!r.rows)return;const rows=[r.cols.map(c=>({v:c.k,s:XL_ST.head})),...r.rows.map(x=>r.cols.map(c=>({v:x[c.k]??''})))];
  if(xlSave(xlWrite([{name:'Консоль',rows,freeze:{y:1},widths:r.cols.map(()=>18)}]),'Консоль — '+t.name+'.xlsx'))toast('Скачивание: «Консоль — '+t.name+'.xlsx»','download')}

/* «Сохранить в Мои запросы»: личные запросы — видит только автор; это не шаблон, токен на него не выпустить (блок 4, пункт 2) */
function dmcMineDlg(t){const x0=t.mq&&dmcMine().find(x=>x.id===t.mq&&x.by===S.me);
  openModal({form:true,render:()=>({title:x0?'Сохранить запрос':'Сохранить в Мои запросы',sub:'Видите только вы. Это не шаблон: организации его не видят',body:`<div class="form">${fld('Название',inp('dcm-n',x0?x0.name:t.name),{req:true,full:true,id:'dcm-n'})}</div>`,
    foot:`<button class="btn ghost" data-close>Отмена</button>${x0?'<button class="btn" id="dcm-new">Сохранить как новый</button>':''}<button class="btn cta" id="dcm-ok">Сохранить</button>`,
    mount(el,m){const go2=asNew=>{const n=val(el,'dcm-n');if(!setErr(el,'dcm-n',!n?'Введите название':n.length>200?'Не длиннее 200 знаков':''))return;if(t.sql.length>20000)return toast('Запрос длиннее 20 000 знаков','alert',true);
        if(x0&&!asNew)Object.assign(x0,{name:n,sql:t.sql,params:Object.assign({},t.params),at:nowStamp(),ver:(x0.ver||1)+1});else{const x={id:'mq'+Date.now().toString(36),by:S.me,name:n,sql:t.sql,params:Object.assign({},t.params),at:nowStamp(),ver:1};dmcMine().push(x);t.mq=x.id}
        t.name=n;dmcSave();m.close();DMC.side='mine';DMC.mq='mine';DMC.q='';renderPage();toast('Запрос сохранён в «Мои запросы»','check')};
      $('#dcm-ok',el).onclick=()=>go2(false);if($('#dcm-new',el))$('#dcm-new',el).onclick=()=>go2(true)}})})}

/* «Сохранить в шаблон» (блок 1, пункт 7; блок 4, пункт 4): обычное окно шаблона, в нём уже запрос, параметры и столбцы последнего запуска */
function dmcToTpl(t){const ks=dmSqlPars(t.sql),cols=(t.cols&&t.cols.length?t.cols:dmSqlCols(t.sql).map(k=>({k,label:k,type:'text'}))).map(c=>({k:c.k,label:c.label||c.k,type:c.type||'text',total:!!c.total}));
  const params=ks.map(k=>({k,label:k,type:/month/.test(k)?'month':/date|_from$|_to$/.test(k)?'date':/year/.test(k)?'year':'text',req:true,def:null}));
  const t0=t.tpl&&dmTpl(t.tpl);
  if(t0&&t0.src==='system'){let code=t0.code+'-copy',i=2;while(dmTpl(code))code=t0.code+'-copy'+i++;const n=Object.assign(structuredClone(t0),{id:'dt'+Date.now().toString(36),code,name:t0.name+' (копия)',state:'Черновик',src:'copy',run:t0.run||t0.code,checked:null,err:'',hist:[],_cb:S.me,_ca:nowStamp()});
    DM_TPL.push(n);dmHist(n,`Создан копированием шаблона «${t0.name}» из консоли: Черновик`);t.tpl=n.code;dmcSave();toast('Готовый шаблон платформы сохраняется копией','copy');return dmEdit(n,{sql:t.sql,params:params.map(p=>n.params.find(x=>x.k===p.k)||p)})}
  if(t0)return dmEdit(t0,{sql:t.sql,params:params.map(p=>t0.params.find(x=>x.k===p.k)||p),cols:t0.state==='Черновик'?cols.map(c=>t0.cols.find(x=>x.k===c.k)||c):null});
  dmEdit(null,{sql:t.sql,params,cols:cols.length?cols:null,name:t.notes?t.name:''})}

/* Телефон (блок 1, пункт 6): список «Моих запросов», запуск и результат; писать запросы — на ПК */
function dmcPhone(body){const t=dmcTab(),mine=dmcMine().filter(x=>x.by===S.me);
  body.innerHTML=`<div class="note">${ic('info')}<span>На телефоне — «Мои запросы», запуск и результат. Писать запросы — на ПК.</span></div>
    <div class="box dmc-pm">${mine.length?mine.map(x=>`<button type="button" class="dmc-pi${t.mq===x.id?' on':''}" data-dmc-pm="${esc(x.id)}"><b>${esc(x.name)}</b><span class="mono faint dmc-1">${esc(x.sql.split('\n')[0])}</span></button>`).join(''):'<span class="faint">Сохранённых запросов нет: сохраните запрос в консоли на ПК.</span>'}</div>
    ${t.mq?`<div class="box"><h3>${esc(t.name)}</h3><pre class="dm-hl mono dmc-ro">${dmHl(t.sql)}</pre><div class="dm-pars" id="dmc-pars">${dmSqlPars(t.sql).map(k=>fld(':'+esc(k),`<input class="inp" type="${/month/.test(k)?'month':/date|_from$|_to$/.test(k)?'date':'text'}" data-dmc-p="${esc(k)}" value="${esc(t.params[k]??'')}">`)).join('')}</div><button type="button" class="btn cta" id="dmc-run">${ic('play','sm')}Выполнить</button></div><div id="dmc-res"></div>`:''}`;
  $$('[data-dmc-pm]',body).forEach(b=>b.onclick=()=>{const x=dmcMine().find(y=>y.id===b.dataset.dmcPm);dmConOpen(x.sql,Object.assign({},x.params),x.name,{mq:x.id})});
  $$('[data-dmc-p]',body).forEach(x=>x.oninput=()=>{t.params[x.dataset.dmcP]=x.value;dmcSave()});
  const r=$('#dmc-run',body);if(r){const ro={value:t.sql,selectionStart:0,selectionEnd:0};r.onclick=()=>dmcRun(body,t,ro);dmcResDraw($('#dmc-res',body),t)}}
