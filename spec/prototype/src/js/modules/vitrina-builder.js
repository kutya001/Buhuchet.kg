'use strict';
// Консоль запросов «Витрины данных», этап 2 (доработки 27.11.2026: консоль запросов; прототип v167):
// П8 — «Заготовки» (блок 4, пункт 1), П9 — «Собрать запрос» по таблицам схемы (блок 6) и по таблицам метода (блок 5, пункт 3),
// П7 — автостолбец «Контрагент» при «Сохранить в шаблон» (блок 2, пункт 8). Сборщик работает по-настоящему: путь связей —
// по внешним ключам описания базы (db/schema.json), готовый SELECT открывается в консоли той же функцией dmConOpen.

/* П8. Заготовки: частые запросы и образцы конструкций. Сразу исключают удалённые и заменённые записи (deleted_at IS NULL,
   NOT superseded, у операций — cancelled_at IS NULL), чтобы суммы совпадали с программой. Деньги в базе — тыйыны */
const DMC_PRE=[
  {id:'rep-resp',n:'Отчёты контрагентов с ответственным',d:'Отчёт, срок, статус и ответственный сотрудник; замененные отчёты исключены',
    sql:`SELECT c.id AS contractor_id, c.name AS cp, t.short_name AS rep, r.period_start, r.due_date, r.status,
       e.short_name AS resp
FROM reports r
JOIN contractors c ON c.id = r.contractor_id
JOIN report_types t ON t.code = r.report_type_code
LEFT JOIN employees e ON e.id = r.responsible_employee_id
WHERE NOT r.superseded
ORDER BY r.due_date, c.name`},
  {id:'by-month',n:'Итоги по месяцам: отчёты и налоги',d:'Группировка по месяцу срока: число отчётов и сумма налогов в сомах',
    sql:`SELECT to_char(r.due_date, 'YYYY-MM') AS month, count(*) AS reports,
       round(sum(coalesce(r.amount, 0)) / 100.0, 2) AS amount_som
FROM reports r
WHERE NOT r.superseded
GROUP BY to_char(r.due_date, 'YYYY-MM')
ORDER BY month`},
  {id:'tax-debt',n:'Долг по оплате налогов',d:'Начислено, оплачено и остаток по контрагенту — только где есть долг',
    sql:`SELECT c.id AS contractor_id, c.name AS cp, sum(r.amount) AS amount, sum(coalesce(r.paid, 0)) AS paid,
       sum(r.amount - coalesce(r.paid, 0)) AS debt
FROM reports r
JOIN contractors c ON c.id = r.contractor_id
WHERE NOT r.superseded AND r.amount > coalesce(r.paid, 0)
GROUP BY c.id, c.name
ORDER BY debt DESC`},
  {id:'with',n:'Подзапрос WITH: отчёты и оплаты без задвоения',d:'Каждая таблица считается своим подзапросом и соединяется с контрагентом — суммы не задваиваются',
    sql:`WITH rep AS (
  SELECT r.contractor_id, count(*) AS reports, sum(coalesce(r.amount, 0)) AS tax
  FROM reports r
  WHERE NOT r.superseded
  GROUP BY r.contractor_id
), pay AS (
  SELECT f.contractor_id, sum(f.amount) AS fee_paid
  FROM fee_payments f
  WHERE f.deleted_at IS NULL
  GROUP BY f.contractor_id
)
SELECT c.id AS contractor_id, c.name AS cp, coalesce(rep.reports, 0) AS reports, coalesce(rep.tax, 0) AS tax,
       coalesce(pay.fee_paid, 0) AS fee_paid
FROM contractors c
LEFT JOIN rep ON rep.contractor_id = c.id
LEFT JOIN pay ON pay.contractor_id = c.id
ORDER BY c.name`},
  {id:'som',n:'Перевод тыйынов в сомы',d:'В базе деньги — целые тыйыны: делим на 100.0 и округляем до копеек (тыйынов)',
    sql:`SELECT r.id, r.amount AS amount_tyiyn, round(r.amount / 100.0, 2) AS amount_som
FROM reports r
WHERE NOT r.superseded AND r.amount IS NOT NULL
ORDER BY r.due_date DESC
LIMIT 100`},
  {id:'overdue',n:'Просроченные отчёты на сегодня',d:'Срок прошёл, отчёт не сдан; сколько дней просрочки',
    sql:`SELECT c.id AS contractor_id, c.name AS cp, t.short_name AS rep, r.due_date,
       current_date - r.due_date AS days
FROM reports r
JOIN contractors c ON c.id = r.contractor_id
JOIN report_types t ON t.code = r.report_type_code
WHERE NOT r.superseded AND r.status IN ('todo', 'in_progress', 'needs_fix') AND r.due_date < current_date
ORDER BY days DESC`},
  {id:'fee-period',n:'Оплаты за обслуживание за период',d:'Параметры :date_from и :date_to; удалённые оплаты исключены',
    sql:`SELECT c.id AS contractor_id, c.name AS cp, count(*) AS payments, sum(f.amount) AS paid
FROM fee_payments f
JOIN contractors c ON c.id = f.contractor_id
WHERE f.deleted_at IS NULL AND f.paid_on BETWEEN :date_from AND :date_to
GROUP BY c.id, c.name
ORDER BY paid DESC`},
  {id:'ops-month',n:'Операции по деньгам за месяц',d:'Параметр :month (ГГГГ-ММ); отменённые операции исключены',
    sql:`SELECT c.id AS contractor_id, c.name AS cp, m.op_date, m.kind, m.amount
FROM money_operations m
LEFT JOIN contractors c ON c.id = m.contractor_id
WHERE m.cancelled_at IS NULL AND to_char(m.op_date, 'YYYY-MM') = :month
ORDER BY m.op_date, c.name`},
  {id:'filter',n:'Задачи сотрудников: FILTER',d:'Число задач по статусам в одной строке на сотрудника — агрегат с FILTER',
    sql:`SELECT e.short_name AS employee, count(*) AS tasks,
       count(*) FILTER (WHERE t.status IN ('todo', 'in_progress', 'rework')) AS open,
       count(*) FILTER (WHERE t.status = 'done') AS done
FROM tasks t
JOIN employees e ON e.id = t.executor_employee_id
GROUP BY e.short_name
ORDER BY open DESC`},
  {id:'window',n:'Нарастающий итог: оконная функция',d:'sum(…) OVER (PARTITION BY … ORDER BY …) — налоги контрагента нарастающим итогом',
    sql:`SELECT c.id AS contractor_id, c.name AS cp, r.due_date, r.amount,
       sum(coalesce(r.amount, 0)) OVER (PARTITION BY r.contractor_id ORDER BY r.due_date) AS running
FROM reports r
JOIN contractors c ON c.id = r.contractor_id
WHERE NOT r.superseded
ORDER BY c.name, r.due_date`},
  {id:'no-resp',n:'Контрагенты без ответственного',d:'Обслуживаемые контрагенты, за которыми не закреплён сотрудник',
    sql:`SELECT c.id AS contractor_id, c.name AS cp, c.inn, c.start_date
FROM contractors c
WHERE c.responsible_employee_id IS NULL AND c.service_status = 'active'
ORDER BY c.name`}];

/* П9. Сборщик: путь связей по внешним ключам. Поля «кто создал / изменил» (…_by) и org_id в путь не идут:
   иначе любые две таблицы соединялись бы через учётные записи или организацию */
const DMC_BUILD_MAX=5,DMC_BUILD_DEPTH=3;
const dmcLinkOk=c=>c!=='org_id'&&!/_by$/.test(c);
// Связи таблицы: «к» — внешний ключ этой таблицы (она — много строк на одну), «от» — ключ соседа на неё
function dmcEdges(n){const d=dmcDb(),t=d&&d.m.get(n);if(!t)return [];
  return [...t.out.filter(f=>dmcLinkOk(f.col)&&f.to!==n).map(f=>({a:n,b:f.to,ac:f.col,bc:f.toCol,many:true})),
    ...t.inc.filter(f=>dmcLinkOk(f.col)&&f.from!==n).map(f=>({a:n,b:f.from,ac:f.toCol,bc:f.col,many:false}))]}
// Кратчайшие пути от таблицы x до любой уже взятой (C): все пути наименьшей длины, не длиннее DMC_BUILD_DEPTH
function dmcPaths(x,C){let fr=[[x,[]]];const seen=new Set([x]),R=[];
  for(let dep=0;dep<DMC_BUILD_DEPTH&&!R.length&&fr.length;dep++){const nx=[],lvl=new Set();
    for(const [n,p] of fr)for(const e of dmcEdges(n)){if(seen.has(e.b))continue;const np=[...p,e];if(C.has(e.b))R.push(np);else{nx.push([e.b,np]);lvl.add(e.b)}}
    lvl.forEach(v=>seen.add(v));fr=nx.slice(0,4000)}
  const key=p=>p.map(e=>`${e.a}.${e.ac}=${e.b}.${e.bc}`).join(' ');return [...new Map(R.map(p=>[key(p),p])).values()].slice(0,8)}
const dmcPathText=p=>p.map(e=>`${e.a}.${e.ac} = ${e.b}.${e.bc}`).join(' → ');
const DMC_NO_ALIAS=new Set(['as','at','by','do','if','in','is','no','of','on','or','to','all','and','any','asc','end','for','not','off','set','use']);
// Псевдоним: первые буквы слов имени (reports → r, report_types → rt); занятый — с цифрой
function dmcAlias(n,used){const b=n.split('_').map(w=>w[0]).join('')||'t';let a=DMC_NO_ALIAS.has(b)?b+'1':b,i=2;while(used.has(a))a=b+i++;used.add(a);return a}
// Заранее отмечены названия и даты, а не номера записей (блок 6, пункт 2)
function dmcPreCols(t){const L=[...t.cols.filter(c=>/(^|_)(name|title)$/.test(c.n)||c.n==='inn').slice(0,3),...t.cols.filter(c=>c.t==='date'&&!/_base$/.test(c.n)).slice(0,2)].map(c=>c.n);
  if(L.length)return L;const f=t.cols.find(c=>c.t!=='uuid'&&!/^(id|org_id|version)$/.test(c.n));return f?[f.n]:[]}
// Удалённые и заменённые записи (блок 6, пункт 3)
function dmcAlive(t,a){const c=new Set(t.cols.map(x=>x.n)),L=[];if(c.has('deleted_at'))L.push(`${a}.deleted_at IS NULL`);if(c.has('superseded'))L.push(`NOT ${a}.superseded`);if(c.has('cancelled_at'))L.push(`${a}.cancelled_at IS NULL`);return L}
const dmcNum=c=>c.money||/^(bigint|integer|smallint|numeric)$/.test(c.t);

/* План сборки: порядок соединений, промежуточные таблицы, выбор пути и предупреждение о задвоении.
   st = {names, choice: {таблица: номер пути}, kind: 'left' | 'inner', sep: «Считать итоги отдельно», fields: {таблица: [поля]}} */
function dmcBuildPlan(st){const d=dmcDb();const names=st.names.filter(n=>d&&d.m.has(n));if(!names.length)return {J:[],steps:[],names};
  const J=[{t:names[0],parent:null}],have=new Set([names[0]]),steps=[];
  for(const x of names.slice(1)){if(have.has(x)){steps.push({t:x,paths:[],pick:0});continue}const paths=dmcPaths(x,have);
    if(!paths.length){steps.push({t:x,none:true});continue}const k=Math.max(0,Math.min(st.choice[x]|0,paths.length-1)),p=paths[k];
    for(let i=p.length-1;i>=0;i--){const e=p[i];if(have.has(e.a))continue;J.push({t:e.a,parent:e.b,col:e.ac,pcol:e.bc,many:e.many,via:!names.includes(e.a)});have.add(e.a)}
    steps.push({t:x,paths,pick:k})}
  const used=new Set();J.forEach(j=>{j.a=dmcAlias(j.t,used);j.T=d.m.get(j.t)});J.forEach(j=>{if(j.parent)j.pa=J.find(x=>x.t===j.parent).a});
  // задвоение: две таблицы «много строк на одного» в одном запросе
  const many=J.filter(j=>j.many);const leaf=j=>!J.some(x=>x.parent===j.t);
  return {J,steps,names,many,dbl:many.length>=2,sepOk:many.filter(j=>leaf(j)&&j.parent).length>=1}}
function dmcBuildSql(st,P){P=P||dmcBuildPlan(st);if(!P.J.length)return '';const join=st.kind==='inner'?'JOIN':'LEFT JOIN';
  const sep=st.sep&&P.dbl?new Set(P.many.filter(j=>!P.J.some(x=>x.parent===j.t)&&j.parent).map(j=>j.t)):new Set();
  const f=j=>(st.fields[j.t]||[]).filter(c=>j.T.cols.some(x=>x.n===c));
  const cnt={};P.J.filter(j=>!sep.has(j.t)).forEach(j=>f(j).forEach(c=>cnt[c]=(cnt[c]||0)+1));
  const sel=[],withs=[],from=[];
  P.J.forEach((j,i)=>{if(sep.has(j.t)){const s=j.a+'_sum',nums=f(j).filter(c=>dmcNum(j.T.cols.find(x=>x.n===c)));const al=dmcAlive(j.T,j.a);
      withs.push(`${s} AS (\n  SELECT ${j.a}.${j.col}, count(*) AS ${j.t}_n${nums.map(c=>`, sum(${j.a}.${c}) AS ${j.t}_${c}`).join('')}\n  FROM ${j.t} ${j.a}${al.length?`\n  WHERE ${al.join(' AND ')}`:''}\n  GROUP BY ${j.a}.${j.col}\n)`);
      from.push(`LEFT JOIN ${s} ON ${s}.${j.col} = ${j.pa}.${j.pcol}`);sel.push(`coalesce(${s}.${j.t}_n, 0) AS ${j.t}_n`,...nums.map(c=>`coalesce(${s}.${j.t}_${c}, 0) AS ${j.t}_${c}`));return}
    f(j).forEach(c=>sel.push(cnt[c]>1?`${j.a}.${c} AS ${j.t}_${c}`:`${j.a}.${c}`));
    if(!i)from.push(`FROM ${j.t} ${j.a}`);else from.push(`${join} ${j.t} ${j.a} ON ${[`${j.a}.${j.col} = ${j.pa}.${j.pcol}`,...dmcAlive(j.T,j.a)].join(' AND ')}`)});
  const base=P.J[0],w=dmcAlive(base.T,base.a);
  return `${withs.length?`WITH ${withs.join(', ')}\n`:''}SELECT\n  ${(sel.length?sel:[`${base.a}.*`]).join(',\n  ')}\n${from.join('\n')}${w.length?`\nWHERE ${w.join(' AND ')}`:''}\nORDER BY 1`}

/* Окно «Собрать запрос» (блок 6, пункт 2): отмеченные таблицы, путь связей, поля галочками, выбор словами, предпросмотр SELECT */
function dmcBuild(names,o={}){const d=dmcDb();if(!d)return toast('Нет описания базы: сборщик берёт связи из него','alert',true);
  const ok=[...new Set((names||[]).map(n=>String(n).replace(/^public\./,'').toLowerCase()))].filter(n=>d.m.has(n));
  const cut=ok.length>DMC_BUILD_MAX;const st={names:ok.slice(0,DMC_BUILD_MAX),choice:{},kind:'left',sep:false,fields:{}};
  if(!st.names.length)return toast(o.method?'У метода нет таблиц базы, которые он читает':'Отметьте хотя бы одну таблицу','alert',true);
  const fill=P=>P.J.forEach(j=>{if(!st.fields[j.t])st.fields[j.t]=j.via?[]:dmcPreCols(j.T)});
  openModal({size:'wide',render:m=>{const P=dmcBuildPlan(st);fill(P);const sql=dmcBuildSql(st,P);
    const step=t=>P.steps.find(s=>s.t===t);
    const card=j=>{const s=step(j.t),k=st.names.indexOf(j.t);return `<div class="box dmb-t"><div class="row dmb-h"><b>${esc(j.T.ru||j.t)}</b><span class="mono faint">${esc(j.t)} ${esc(j.a)}</span>${j.via?'<span class="tag">промежуточная</span>':''}${j.T.org?'':'<span class="tag">закрыто для организаций</span>'}<span class="grow"></span>${k>=0&&st.names.length>1?`<button type="button" class="btn sm ghost" data-dmb-del="${esc(j.t)}" title="Убрать таблицу">${ic('x','sm')}</button>`:''}</div>
      ${j.parent?`<span class="hint" style="margin:0">${j.via?`Прямой связи нет: система добавила «${esc(j.T.ru||j.t)}», чтобы соединить таблицы. `:''}Связь: <span class="mono">${esc(j.a)}.${esc(j.col)} = ${esc(j.pa)}.${esc(j.pcol)}</span>${j.many?` — много строк на одну «${esc(d.m.get(j.parent).ru||j.parent)}»`:''}</span>`:'<span class="hint" style="margin:0">Первая таблица: от неё идёт запрос</span>'}
      ${s&&s.paths&&s.paths.length>1?fld('Путь связей · '+s.paths.length,`<select class="inp" data-dmb-path="${esc(j.t)}">${s.paths.map((p,i)=>`<option value="${i}" ${i===s.pick?'selected':''}>${esc(dmcPathText(p))}</option>`).join('')}</select>`,{full:true,hint:'Несколько путей: выберите, по какой связи соединять'}):''}
      <div class="dmb-f">${j.T.cols.map(c=>`<label class="check-row"><input type="checkbox" data-dmb-f="${esc(j.t)}" value="${esc(c.n)}" ${(st.fields[j.t]||[]).includes(c.n)?'checked':''}><span class="mono">${esc(c.n)}</span><span class="faint">${esc(c.ru||dmcKind(c))}</span></label>`).join('')}</div></div>`};
    const none=P.steps.filter(s=>s.none);
    const free=d.T.filter(t=>!st.names.includes(t.n)).sort((a,b)=>a.n.localeCompare(b.n));
    return {title:'Собрать запрос',sub:`Отмечено ${st.names.length} из ${DMC_BUILD_MAX} · путь связей — по внешним ключам базы${o.method?` · таблицы метода ${esc(o.method)}`:''}`,
      body:`<div class="dmb">${cut?`<div class="note warn">${ic('alert')}<span>У метода больше ${DMC_BUILD_MAX} таблиц: отмечены первые ${DMC_BUILD_MAX}. Лишние уберите, нужные добавьте ниже.</span></div>`:''}
        <div class="dmb-l">${P.J.map(card).join('')}${none.map(s=>`<div class="note bad">${ic('alert')}<span>«${esc(s.t)}»: связи с остальными таблицами не нашлось за ${DMC_BUILD_DEPTH} шага. Уберите её или добавьте таблицу, через которую они связаны.</span><button type="button" class="btn sm ghost" data-dmb-del="${esc(s.t)}">Убрать</button></div>`).join('')}
          ${st.names.length<DMC_BUILD_MAX?`<div class="row">${fld('Добавить таблицу',`<select class="inp" id="dmb-add"><option value="">—</option>${free.map(t=>`<option value="${esc(t.n)}">${esc(t.n)} · ${esc(t.ru)}</option>`).join('')}</select>`,{id:'dmb-add'})}</div>`:''}</div>
        <div class="dmb-r"><div class="box"><h3>Какие строки</h3>${[['left','Все строки первой таблицы, даже без пары'],['inner','Только строки с парой']].map(([v,l])=>`<label class="check-row"><input type="radio" name="dmb-k" value="${v}" ${st.kind===v?'checked':''}><span>${l}</span></label>`).join('')}
          <span class="hint" style="margin:0">Удалённые и заменённые записи исключены сразу: deleted_at IS NULL, NOT superseded — суммы совпадут с программой</span></div>
          ${P.dbl?`<div class="note warn dmb-dbl">${ic('alert')}<span><b>Суммы задвоятся.</b> ${P.many.map(j=>`«${esc(j.T.ru||j.t)}»`).join(' и ')} — много строк на одного: каждая строка одной таблицы повторится для каждой строки другой.${P.sepOk?' «Считать итоги отдельно» — каждая из них считается своим подзапросом.':''}</span>${P.sepOk?`<button type="button" class="btn sm${st.sep?' cta':''}" id="dmb-sep" aria-pressed="${st.sep}">${st.sep?'Итоги считаются отдельно':'Считать итоги отдельно'}</button>`:''}</div>`:''}
          <div class="box"><h3>Запрос</h3><pre class="dm-hl mono dmb-sql">${dmHl(sql)}</pre></div></div></div>`,
      foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="dmb-go" ${sql?'':'disabled'}>${ic('code','sm')}Открыть в консоли</button>`,
      mount(el){const q=s=>$(s,el);
        $$('[data-dmb-f]',el).forEach(x=>x.onchange=()=>{const t=x.dataset.dmbF,L=st.fields[t]||(st.fields[t]=[]);if(x.checked){if(!L.includes(x.value))L.push(x.value)}else L.splice(L.indexOf(x.value),1);m.draw()});
        $$('[data-dmb-path]',el).forEach(x=>x.onchange=()=>{st.choice[x.dataset.dmbPath]=+x.value;m.draw()});
        $$('[data-dmb-del]',el).forEach(b=>b.onclick=()=>{st.names.splice(st.names.indexOf(b.dataset.dmbDel),1);delete st.fields[b.dataset.dmbDel];m.draw()});
        $$('[name="dmb-k"]',el).forEach(x=>x.onchange=()=>{st.kind=x.value;m.draw()});
        const a=q('#dmb-add');if(a)a.onchange=()=>{if(a.value){st.names.push(a.value);m.draw()}};
        const sp=q('#dmb-sep');if(sp)sp.onclick=()=>{st.sep=!st.sep;m.draw()};
        q('#dmb-go').onclick=()=>{const s=dmcBuildSql(st);if(!s)return;const nm='Сборка: '+st.names.join(', ');
          dmConOpen(s,{},nm.length>60?nm.slice(0,59)+'…':nm,{src:'build',notes:o.notes||null})}}}}})}

/* П7. Автостолбец «Контрагент» (блок 2, пункт 8): в запросе есть таблица контрагента, а столбца contractor_id нет —
   добавляем его в список SELECT основного запроса; модуль шаблона предлагаем по первой таблице */
const DMC_TPL_MOD={reports:'reports',money_operations:'fin',projects:'projects',project_payments:'projects',one_off_services:'projects',one_off_service_payments:'projects',indicator_values:'kpi',tasks:'staff',fee_payments:'cps',contractor_tariffs:'cps',contractors:'cps'};
function dmcDepthAt(m,p){let dep=0;for(let i=0;i<p;i++){if(m[i]==='(')dep++;else if(m[i]===')')dep=Math.max(0,dep-1)}return dep}
function dmcAutoCp(sql){const d=dmcDb(),m=dmcMask(sql);if(!d)return null;const {cte,order}=dmcRefs(sql);
  const top=order.filter(r=>dmcDepthAt(m,r.at)===0&&!cte.has(r.t)&&d.m.has(r.t));if(!top.length)return null;
  const mod=(top.map(r=>DMC_TPL_MOD[r.t]).find(Boolean))||'cps',fee=top.some(r=>/^(fee_payments|contractor_tariffs)$/.test(r.t));
  if(dmSqlCols(sql).includes('contractor_id'))return {sql,added:null,mod,fee};
  const cp=top.find(r=>r.t==='contractors')||top.find(r=>d.m.get(r.t).cols.some(c=>c.n==='contractor_id'));if(!cp)return {sql,added:null,mod,fee};
  const ex=`${cp.a}.${cp.t==='contractors'?'id':'contractor_id'} AS contractor_id`;
  let at=-1;for(const x of m.matchAll(/\bselect\b(\s+distinct\b)?\s*/gi))if(dmcDepthAt(m,x.index)===0){at=x.index+x[0].length;break}
  if(at<0)return {sql,added:null,mod,fee};return {sql:sql.slice(0,at)+ex+', '+sql.slice(at),added:ex,mod,fee}}
