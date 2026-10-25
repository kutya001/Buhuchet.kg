'use strict';
// Админка: коды значений, выгрузка и загрузка Excel, история загрузок
/* ═════════════ Справочники платформы: коды, выгрузка/загрузка, массовые правки ═════════════ */
/* У каждого значения постоянный код: по нему сопоставляются строки при загрузке, переименование не создаёт дубль */
[['regimes','РЕЖ'],['forms','ФС'],['organs','ОРГ'],['banks','БНК']].forEach(([k,p])=>DICT[k].items.forEach((x,i)=>x.code=x.code||`${p}-${String(i+1).padStart(2,'0')}`));
const nextCode=(k,p)=>`${p}-${String(DICT[k].items.length+1).padStart(2,'0')}`;
const YN=v=>v?'Да':'Нет';
const parseYN=v=>{const n=norm(String(v)).trim();return n===''?null:['да','1','yes','true','активен','активно','вкл'].includes(n)?true:['нет','0','no','false','отключён','отключен','отключено','выкл'].includes(n)?false:undefined};
const PER_IN={'месяц':'M','квартал':'Q','полугодие':'H','год':'Y','m':'M','q':'Q','h':'H','y':'Y'};
const KIND_IN={'режимный':'regime','сквозной':'cross','внутренний':'internal'};
/* Колонки выгрузки: [ключ, заголовок, выгрузить, разобрать → значение или {err}] */
const intIn=(a,b)=>v=>{if(v==='')return null;const n=parseInt(v,10);return isNaN(n)||n<a||n>b?{err:`должно быть число от ${a} до ${b}`}:n};
// «Предупреждать при ГКЭД» (gked.warn) и «Ставится по УГНС» (suggest.ugns) — вложенные поля: колонка пишет в них при загрузке
const gkWarnCol=['gkwarn','Предупреждать при ГКЭД',x=>(x.gkwarn||(x.gked||{}).warn||[]).join(', '),v=>{const p=gkParse(v);return p.err?{err:p.err}:p.v}];
// Перечни режима по форме собственности (патент): «Для ИП», «Кроме, для ИП», «Для ИТД» — отдельными колонками
const gkListCols=[['gkip','ip','Для ИП (ГКЭД)'],['gkipx','ipEx','Кроме, для ИП (ГКЭД)'],['gkitd','itd','Для ИТД (ГКЭД)']].map(([c,k,l])=>[c,l,x=>((x.gked||{})[k]||[]).join(', '),v=>{const p=gkParse(v);return p.err?{err:p.err}:p.v}]);
const gkListSet=k=>(x,v)=>{x.gked=x.gked||{in:[],ex:[]};if(v.length)x.gked[k]=v;else delete x.gked[k]};
const DX_NEST={gkip:gkListSet('ip'),gkipx:gkListSet('ipEx'),gkitd:gkListSet('itd'),gkwarn:(x,v)=>{x.gked=x.gked||{in:[],ex:[]};if(v.length)x.gked.warn=v;else delete x.gked.warn},sugUgns:(x,v)=>{if(v.length)x.suggest=Object.assign(x.suggest||{},{ugns:v});else if(x.suggest)delete x.suggest.ugns}};
// «Меняет сроки»: «nds: сдача последний+1; уплата 25+1», несколько видов — через «|»; число — день, после «+» — месяцев после периода
const ovDayTxt=d=>d==='last'||d>=31?'последний':String(d);
const ovOut=x=>Object.entries((x.dueOverride)||{}).map(([id,o])=>[o.day!=null?`сдача ${ovDayTxt(o.day)}+${o.after??1}`:'',o.pay?`уплата ${ovDayTxt(o.pay.day)}+${o.pay.after??1}`:''].filter(Boolean).join('; ').replace(/^/,id+': ')).join(' | ');
function ovIn(v){const s=String(v||'').trim();if(!s)return {};const out={},bad={err:'«Меняет сроки»: «nds: сдача последний+1; уплата 25+1»'};
  for(const part of s.split('|').map(x=>x.trim()).filter(Boolean)){const m=/^([a-z0-9_]+)\s*:\s*(.+)$/i.exec(part);if(!m||!T[m[1]])return bad;const o={};
    for(const q of m[2].split(';').map(x=>x.trim()).filter(Boolean)){const mm=/^(сдача|уплата)\s+(последний|\d{1,2})\s*\+\s*(\d)$/i.exec(q);if(!mm)return bad;const r={day:/^\d/.test(mm[2])?+mm[2]:'last',after:+mm[3]};if(/^сдача/i.test(mm[1]))Object.assign(o,r);else o.pay=r}
    out[m[1]]=o}return out}
const WHO_L={all:'Все',org:'Организации',ip:'ИП'},WHO_IN={'все':'all','организации':'org','организация':'org','ип':'ip'};
const DX={
  types:{title:'Виды отчётов',key:'id',items:()=>RT,cols:[
    ['id','Код',t=>t.id,v=>v],['name','Название',t=>t.name,v=>v||{err:'нет названия'}],['short','Кратко',t=>t.short,v=>v||{err:'нет краткого названия'}],['code','Код формы',t=>t.code,v=>v||'—'],
    ['organ','Орган',t=>t.organ,v=>DICT.organs.items.some(x=>x.name===v)?v:{err:`органа «${v}» нет в справочнике`}],
    ['per','Периодичность',t=>PER_LABEL[t.per],v=>PER_IN[norm(v)]||{err:'периодичность: месяц, квартал, полугодие или год'}],
    ['day','Срок: число',t=>t.day,intIn(1,31)],['after','Месяцев после периода',t=>t.per==='Y'?'':t.after,intIn(0,6)],['ym','Месяц следующего года',t=>t.per==='Y'?t.ym:'',intIn(1,12)],
    ['kind','Тип',t=>KIND_L[t.kind],v=>KIND_IN[norm(v)]||{err:'тип: режимный, сквозной или внутренний'}],
    ['rates','Ставки',t=>(t.rates||[]).join('; '),v=>v?v.split(';').map(x=>x.trim()).filter(Boolean):[]],
    ['act','Что нужно сделать',t=>ACT_L[t.act],v=>ACT_IN[norm(v)]||{err:'«Что нужно сделать»: Сдача, Уплата или Сдача + уплата'}],
    ['pays','Что уплачивается',t=>(t.pays||[]).map(p=>[p.n,p.to,p.kbk].filter(Boolean).join(' / ')).join('; '),v=>v?v.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const[n,to,kbk]=x.split(/\s\/\s/).map(y=>y.trim());return {n,to:to||'',kbk:kbk||''}}):[]],
    ['from','Срок считается',t=>t.from==='start'?'от начала периода':'от конца периода',v=>!v||norm(v).includes('конца')?'end':norm(v).includes('начала')?'start':{err:'«Срок считается»: от конца периода или от начала периода'}],
    ['payday','Срок оплаты: число',t=>t.payday!==undefined?t.payday:t.pay?t.pay.day:'',v=>v===''||v==null?'':(/^\d+$/.test(v)&&+v>=1&&+v<=31?+v:{err:'срок оплаты: число от 1 до 31 или пусто (как срок сдачи)'})],
    ['inst','График оплаты',t=>instTxt(t),v=>{const a=instIn(v);return a===null?{err:'график: ДД.ММ через точку с запятой'}:a}],
    ['regimes','Применимые режимы',t=>(t.regimes||[]).join('; '),v=>{const a=v?v.split(';').map(x=>x.trim()).filter(Boolean):[];const bad=a.find(x=>!DICT.regimes.items.some(r=>r.name===x));return bad?{err:`режима «${bad}» нет в справочнике`}:a}],
    ['who','Для кого',t=>WHO_L[t.who||'all'],v=>v?(WHO_IN[norm(v)]||{err:'«Для кого»: Все, Организации или ИП'}):'all'],
    ['shift','Переносить срок',t=>YN(t.shift!==false),v=>{const b=parseYN(v);return b===undefined?{err:'«Переносить срок»: да или нет'}:b!==false}],
    ['gked','Виды деятельности (ГКЭД)',x=>gkRuleTxt(x.gked),gkRuleIn],
    ['group','Группа подбора',t=>(PK_GRP_L.find(g=>g[0]===t.group)||[])[1]||'',v=>{if(!v)return 'optional';const g=PK_GRP_L.find(g=>norm(g[1])===norm(v)||g[0]===v);return g?g[0]:{err:'группа подбора: '+PK_GRP_L.map(g=>g[1]).join(', ')}}],
    ['basis','Основания',t=>(t.basis||[]).map(k=>(baseOf(k)||{}).name||k).join('; '),v=>{const a=v?v.split(';').map(x=>x.trim()).filter(Boolean):[];const r=a.map(x=>((DICT.bases.items.find(b=>b.code===x||norm(b.name)===norm(x)))||{}).code);const bad=a.find((x,i)=>!r[i]);return bad?{err:`основания «${bad}» нет в справочнике`}:r}],
    ['preselect','Отмечать заранее',t=>YN(t.preselect),v=>parseYN(v)===true],['oneOff','Разовый',t=>YN(t.oneOff),v=>parseYN(v)===true],['evLabel','Название даты события',t=>t.evLabel||'',v=>v],
    ['index','Индекс формы',t=>t.index||'',v=>v],['respondents','Кто сдаёт',t=>t.respondents||'',v=>v],['source','Источник',t=>t.source||'',v=>!v||/^https?:\/\//i.test(v)?v:{err:'источник — ссылка, начинается с http:// или https://'}],['desc','Описание',t=>t.desc||'',v=>v],['clientNote','Пояснение для контрагента',t=>t.clientNote||'',v=>v||undefined],['art','Статья НК',t=>t.art||'',v=>v],['verify','Сверить',t=>YN(t.verify),v=>parseYN(v)===true],
    ['active','Активен',t=>YN(t.active),v=>{const b=parseYN(v);return b===undefined?{err:'«Активен»: да или нет'}:b!==false}]],
    check:t=>t.kind==='regime'&&!(t.regimes||[]).length?'у режимного вида заполните «Применимые режимы»':''},
  regimes:{title:'Режимы налогообложения',key:'code',pre:'РЕЖ',items:()=>DICT.regimes.items,cols:[['code','Код',x=>x.code,v=>v],['name','Краткое название',x=>x.name,v=>v||{err:'нет названия'}],['full','Название',x=>x.full,v=>v||{err:'нет полного названия'}],['type','Тип',x=>x.type,v=>['Общий','Специальный'].find(z=>norm(z)===norm(v))||{err:'тип: Общий или Специальный'}],['frees','Освобождает от',x=>x.frees,v=>v],['who','Кто применяет',x=>x.who,v=>v],['how','Как переходят',x=>x.how,v=>v],['combines','Совмещается с',x=>x.combines||'',v=>v],['art','Статья НК',x=>x.art,v=>v],['gked','Виды деятельности (ГКЭД)',x=>gkRuleTxt(x.gked),gkRuleIn],...gkListCols,gkWarnCol,['active','Активно',x=>YN(x.active),v=>{const b=parseYN(v);return b===undefined?{err:'«Активно»: да или нет'}:b!==false}]]},
  benefits:{title:'Налоговые льготы и особые статусы',key:'code',pre:'ЛЬГ',items:()=>DICT.benefits.items,cols:(()=>{const ids=v=>{const a=v?v.split(';').map(x=>x.trim()).filter(Boolean):[];const r=a.map(x=>(RT.find(t=>t.id===x||t.short===x)||{}).id);const bad=a.find((x,i)=>!r[i]);return bad?{err:`вида «${bad}» нет в каталоге`}:r};const tl=a=>(a||[]).map(id=>T[id]?T[id].short:id).join('; ');
    return [['code','Код',x=>x.code,v=>v],['name','Название',x=>x.name,v=>v||{err:'нет названия'}],['gives','Что даёт',x=>x.gives,v=>v||{err:'опишите, что даёт статус'}],['art','Статья НК',x=>x.art,v=>v],['removes','Делает ненужными',x=>tl(x.removes),ids],['adds','Добавляет',x=>tl(x.adds),ids],['until','Действует до',x=>x.until||'',v=>!v?'':/^\d{4}-\d\d-\d\d$/.test(v)?v:{err:'дата — ГГГГ-ММ-ДД'}],['who','Кто применяет',x=>({all:'Организации и ИП',org:'Только организации',ip:'Только ИП'})[x.who||'all'],v=>!v?'all':/ип/i.test(v)&&!/орган/i.test(v)?'ip':/^только орган/i.test(v)?'org':/орган/i.test(v)?'all':{err:'«Кто применяет»: Организации и ИП, Только организации или Только ИП'}],['cond','Условия',x=>x.cond||'',v=>v],['confirm','Как подтверждается',x=>x.confirm||'',v=>v],['combines','Совмещается с',x=>x.combines||'',v=>v],['term','Срок действия',x=>x.term||'',v=>v],['verify','Сверить',x=>YN(x.verify),v=>parseYN(v)===true],['gked','Виды деятельности (ГКЭД)',x=>gkRuleTxt(x.gked),gkRuleIn],gkWarnCol,
      ['kind','Тип',x=>x.kind==='status'?'Статус':'Льгота',v=>!v||/^льгот/i.test(v)?'':/^статус/i.test(v)?'status':{err:'«Тип»: Льгота или Статус'}],
      ['dueOverride','Меняет сроки',ovOut,ovIn],
      ['sugUgns','Ставится по УГНС',x=>(x.sugUgns||(x.suggest&&x.suggest.ugns)||[]).join('; '),v=>{const a=v?v.split(';').map(s=>s.trim()).filter(Boolean):[];const r=a.map(s=>((DICT.ugns.items.find(u=>u.id===s||u.code===s||norm(u.short)===norm(s)))||{}).id);const b=a.find((s,i)=>!r[i]);return b?{err:`УГНС «${b}» нет в справочнике`}:r}],['active','Активно',x=>YN(x.active),v=>{const b=parseYN(v);return b===undefined?{err:'«Активно»: да или нет'}:b!==false}]]})()},
  bases:{title:'Основания для отчётов',key:'code',items:()=>DICT.bases.items,cols:[['code','Код',x=>x.code,v=>v||{err:'нет кода'}],['name','Название',x=>x.name,v=>v||{err:'нет названия'}],['desc','Описание',x=>x.desc||'',v=>v],['types','Виды отчётов',x=>(x.types||[]).map(id=>T[id]?T[id].short:id).join('; '),v=>{const a=v?v.split(';').map(x=>x.trim()).filter(Boolean):[];const r=a.map(x=>(RT.find(t=>t.id===x||t.short===x)||{}).id);const bad=a.find((x,i)=>!r[i]);return bad?{err:`вида «${bad}» нет в каталоге`}:r}],['note','Примечание',x=>x.note||'',v=>v],['active','Активно',x=>YN(x.active),v=>{const b=parseYN(v);return b===undefined?{err:'«Активно»: да или нет'}:b!==false}]]},
  taxes:{title:'Налоги и обязательные платежи',key:'code',items:()=>TAXES,cols:[['code','Код',x=>x.code,v=>v],['name','Название',x=>x.name,v=>v||{err:'нет названия'}],['group','Группа',x=>x.group,v=>v],['level','Уровень',x=>x.level,v=>v],['payers','Кто платит',x=>x.payers,v=>v],['base','База',x=>x.base,v=>v],['rates','Ставки',x=>x.rates,v=>v],['period','Период',x=>x.period,v=>v],['reportDue','Срок отчёта',x=>x.reportDue,v=>v],['payDue','Срок уплаты',x=>x.payDue,v=>v],['form','Форма',x=>x.form,v=>v],['organ','Орган',x=>x.organ,v=>v],['art','Статья НК',x=>x.art,v=>v],['reportTypes','Виды отчётов',x=>(x.reportTypes||[]).join('; '),v=>v?v.split(';').map(s=>s.trim()).filter(Boolean):[]],['note','Примечание',x=>x.note,v=>v],['gked','Виды деятельности (ГКЭД)',x=>gkRuleTxt(x.gked),gkRuleIn],['verify','Сверить',x=>YN(x.verify),v=>parseYN(v)===true]]},
  enrates:{title:'Ставки единого налога',key:'code',items:()=>EN_TABLE,cols:[['code','Код',x=>x.code,v=>v],['activity','Деятельность',x=>x.activity,v=>v||{err:'нет деятельности'}],['rate','Ставка',x=>x.rate,v=>v],['cond','Условие',x=>x.cond,v=>v],['art','Статья НК',x=>x.art,v=>v],['gked','Виды деятельности (ГКЭД)',x=>gkRuleTxt(x.gked),gkRuleIn]]},
  proprates:{title:'Ставки налога на имущество',key:'code',items:()=>PROP_RATES,cols:[['code','Код',x=>x.code,v=>v],['place','Населённый пункт',x=>x.place,v=>v||{err:'нет населённого пункта'}],['region','Область',x=>x.region,v=>v],...[['homeA','Жилые, кирпич и бетон'],['homeB','Жилые, саман и другие'],['homeLand','Придомовой участок'],['bizA','Нежилые, 1-я группа'],['bizB','Нежилые, 2-я группа'],['bizLand','Земли населённых пунктов']].map(([k,l])=>[k,l,x=>fmtM(x[k],(Math.round(x[k]*100)%100)!==0),v=>{const n=parseNum(v);return isNaN(n)?{err:`«${l}»: число`}:n}])]},
  gked:{title:'ГКЭД',key:'code',items:()=>GK,cols:[['code','Код',x=>x.code,v=>String(v||'').trim().toUpperCase()],['name','Название',x=>x.name,v=>v||{err:'нет названия'}],['level','Уровень',x=>GK_LV[x.level]||x.level,v=>GK_LV_IN[norm(v)]||{err:'уровень: секция, подсекция, раздел, группа, класс или подкласс'}],
    ['parent','Входит в',x=>x.parent||'',v=>{const s=String(v||'').trim().toUpperCase();return !s?null:GKM[s]||/^([A-Z]{1,2}|\d\d(\.\d{1,2})?)$/.test(s)?s:{err:`код верхнего уровня «${s}» не похож на код ГКЭД`}}],['note','Примечание',x=>x.note||'',v=>v],['active','Действует',x=>YN(x.active!==false),v=>{const b=parseYN(v);return b===undefined?{err:'«Действует»: да или нет'}:b!==false}]],
    check:x=>!/^([A-Z]{1,2}|\d\d(\.\d{1,2}(\.\d)?)?)$/.test(x.code||'')?'формат кода: A, 01, 01.1, 01.11 или 01.11.1':x.level!=='section'&&!x.parent?'укажите «Входит в»':''},
  gkgroups:{title:'Группы кодов ГКЭД',key:'id',items:()=>GKG,cols:[['id','Код',x=>x.id,v=>/^[A-Za-z0-9_-]+$/.test(v)?v:{err:'код группы — латиница и цифры'}],['name','Название',x=>x.name,v=>v||{err:'нет названия'}],['codes','Коды',x=>(x.codes||[]).join(', '),v=>{const p=gkParse(v);return p.err?{err:p.err}:p.v.length?p.v:{err:'нет кодов'}}],
    ['en','Единый налог',x=>gkActTxt(x,'en'),v=>gkActIn(v)],['spino','СПиНО',x=>gkActTxt(x,'spino'),v=>gkActIn(v)],['ask','Вопрос при предупреждении',x=>x.ask||'',v=>v],['why','Почему',x=>x.why||'',v=>v]],
    upd:(x,v)=>{const old=structuredClone(x);Object.keys(v).forEach(f=>{if(v[f]!=null)x[f]=v[f]===''&&['en','spino'].includes(f)?null:v[f]});touch(x);gkGrpApply(old,x)},
    add:v=>{const o=born(Object.assign({codes:[]},v));['en','spino'].forEach(f=>{if(o[f]==='')o[f]=null});GKG.push(o);gkGrpApply(null,o)}},
  forms:{title:'Формы собственности',key:'code',pre:'ФС',items:()=>DICT.forms.items},
  organs:{title:'Органы',key:'code',pre:'ОРГ',items:()=>DICT.organs.items},
  banks:{title:'Банковские провайдеры',key:'code',pre:'БНК',items:()=>DICT.banks.items},
  ugns:{title:'Налоговые органы (УГНС)',key:'id',items:()=>DICT.ugns.items,cols:[
    ['id','Ключ',x=>x.id,v=>/^[a-z0-9-]+$/.test(v)?v:{err:'ключ — латиница, цифры и дефис'}],['code','Код',x=>x.code,v=>!v||/^\d{3}$/.test(v)?v:{err:'код УГНС — три цифры или пусто'}],['name','Полное название',x=>x.name,v=>v||{err:'нет названия'}],['short','Кратко',x=>x.short,v=>v||{err:'нет краткого названия'}],['city','Регион',x=>x.city,v=>v],
    ['active','Активно',x=>YN(x.active),v=>{const b=parseYN(v);return b===undefined?{err:'«Активно»: да или нет'}:b!==false}]]},
  phones:{title:'Коды стран',key:'cc',items:()=>PHONES,cols:[
    ['cc','Код страны',p=>p.cc,v=>/^[A-Za-z]{2}$/.test(v)?v.toUpperCase():{err:'код страны — две латинские буквы (KG, KZ…)'}],['name','Страна',p=>p.name,v=>v||{err:'нет названия'}],
    ['code','Телефонный код',p=>p.code,v=>/^\+?\d{1,4}$/.test(v)?v.replace('+',''):{err:'телефонный код — от 1 до 4 цифр'}],['mask','Маска номера',p=>p.mask,v=>/^[X ]+$/.test(v)?v:{err:'маска — только X и пробелы'}],['flag','Флаг',p=>p.flag,v=>v||'🏳️'],
    ['active','Активно',p=>YN(p.active!==false),v=>{const b=parseYN(v);return b===undefined?{err:'«Активно»: да или нет'}:b!==false}]]},
  cats:{title:'Категории задач',key:'code',pre:'КАТ',items:()=>DICT.cats.items},
  reasons:{title:'Причины изменения срока',key:'code',pre:'ПРЧ',items:()=>DICT.reasons.items},
  calendar:{title:'Производственный календарь',key:'d',items:()=>{const y=+TODAY.slice(0,4);return [...holidayRows(y),...holidayRows(y+1)]},cols:[
    ['d','Дата',h=>h.d,v=>{const m=/^(\d\d)\.(\d\d)\.(\d{4})$/.exec(v);const d=m?`${m[3]}-${m[2]}-${m[1]}`:v;return /^\d{4}-\d\d-\d\d$/.test(d)&&!isNaN(D(d))?d:{err:'дата — ГГГГ-ММ-ДД или ДД.ММ.ГГГГ'}}],
    ['name','Название',h=>h.name,v=>v||{err:'нет названия'}],['kind','Тип',h=>h.kind,v=>['Праздник','Перенос','Рабочая суббота'].find(x=>norm(x)===norm(v))||{err:'тип: Праздник, Перенос или Рабочая суббота'}],
    ['rule','Повторяется',h=>/^\d\d-\d\d$/.test(h.key)?'Каждый год':'Только в этом году',v=>!v?'Только в этом году':['Каждый год','Только в этом году'].find(x=>norm(x)===norm(v))||{err:'«Повторяется»: Каждый год или Только в этом году'}]],
    snapAll:()=>({h:Object.assign({},HOLIDAYS),w:[...WORK_SAT]}),restore:s=>{Object.keys(HOLIDAYS).forEach(k=>delete HOLIDAYS[k]);Object.assign(HOLIDAYS,s.h);WORK_SAT.clear();s.w.forEach(d=>WORK_SAT.add(d));recalcDues()},
    upd:(x,v)=>{const nk=v.kind||x.kind,nr=v.rule||(/^\d\d-\d\d$/.test(x.key)?'Каждый год':'Только в этом году');if(x.kind==='Рабочая суббота')WORK_SAT.delete(x.d);else delete HOLIDAYS[x.key];DX.calendar.add(Object.assign({d:x.d,name:x.name},v,{kind:nk,rule:nr}))},
    add:v=>{if(v.kind==='Рабочая суббота')WORK_SAT.add(v.d);else HOLIDAYS[v.rule==='Каждый год'?v.d.slice(5):v.d]=v.kind==='Перенос'&&!/^Перенос/.test(v.name)?'Перенос: '+v.name:v.name}}};

const VX={forms:[['full','Полное название',x=>x.full||'',v=>v],['short','Кратко',x=>x.short||'',v=>v],['end','Для ЕНД',x=>END_L[x.end]||'',v=>{const e=Object.keys(END_L).find(k=>norm(END_L[k])===norm(v));return e||(v?{err:'«Для ЕНД»: Организация или ИП'}:'org')}]],banks:[['type','Тип',x=>x.type||'Банк',v=>BANK_T.find(t=>norm(t)===norm(v))||{err:'тип: Банк или Электронный кошелёк'}],['byPhone','Переводы по номеру',x=>YN(x.byPhone),v=>{const b=parseYN(v);return b===undefined?{err:'«Переводы по номеру»: да или нет'}:b===true}],['note','Пояснение',x=>x.note||'',v=>v]]};
['forms','organs','banks','cats','reasons'].forEach(k=>DX[k].cols=[['code','Код',x=>x.code,v=>v],['name','Название',x=>x.name,v=>v||{err:'нет названия'}],...(VX[k]||[]),['active','Активно',x=>YN(x.active),v=>{const b=parseYN(v);return b===undefined?{err:'«Активно»: да или нет'}:b!==false}]]);
const PD_LOADS=DB.ref.dictLoads;
const AUD_L={biz:'Организациям',adm:'Администраторам платформы',all:'Всем'};
const ynIn=l=>v=>{const b=parseYN(v);return b===undefined?{err:`«${l}»: да или нет`}:b!==false};
const permIn=v=>{if(!v||v==='—')return '';const p=PERMS.find(x=>norm(x[1])===norm(v));return p?p[0]:{err:`права «${v}» нет`}};
DX.kbsteps={title:'Шаги уроков',key:'id',items:()=>KBS,cols:[
 ['id','Код',i=>i.id,v=>v],
 ['g','Модуль программы',i=>(KBG.find(g=>g.id===i.g)||{}).t||'',v=>{const g=KBG.find(x=>norm(x.t)===norm(v));return g?g.id:{err:`модуля программы «${v}» нет`}}],
 ['t','Название',i=>i.t,v=>v||{err:'нет названия'}],['w','Зачем это нужно',i=>i.w||'',v=>v],
 ['learn','Вид шага',i=>i.learn?'Посмотреть':'Сделать',v=>/посмотр|изуч/i.test(v)?1:/сдела|действ/i.test(v)?0:{err:'«Вид шага»: Сделать или Посмотреть'}],
 ['star','Основной',i=>YN(!!i.star),v=>{const b=parseYN(v);return b===undefined?{err:'«Основной»: да или нет'}:b?1:0}],
 ['perm','Необходимое право',i=>i.perm?permT(i.perm):'',permIn],
 ['featk','Функция учётной политики',i=>i.featk?(FEATURES.find(f=>f[0]===i.featk)||[])[1]||'':'',v=>{if(!v||v==='—')return '';const f=FEATURES.find(x=>norm(x[1])===norm(v));return f?f[0]:{err:`функции «${v}» нет`}}],
 ['evk','Условие отметки',i=>(KB_EV[i.evk]||[''])[0],v=>{const e=Object.entries(KB_EV).find(([k,x])=>norm(x[0])===norm(v));return e?e[0]:{err:`условия «${v}» нет в списке событий`}}],
 ['ord','Порядок',i=>i.ord,intIn(1,9999)],
 ['active','Активен',i=>YN(i.active!==false),ynIn('Активен')]],
 upd:(x,v)=>{Object.keys(v).forEach(f=>{if(v[f]!=null)x[f]=v[f]});if(v.featk!=null&&v.featk!==KB_IFEAT[x.id])x.feat=null;kbBind(x);touch(x);KB.ver++},
 add:v=>{const o=born(Object.assign({active:true,isNew:true,ord:KBS.length+1,w:''},v));kbBind(o);KBS.push(o);KB.ver++}};
const NEWS_AUD={all:'Все пользователи',adm:'Только режим Админка'};
DX.kbnews={title:'Новости',key:'id',items:()=>NEWS,cols:[
 ['id','Код',n=>n.id,v=>v],['t','Заголовок',n=>n.t,v=>v||{err:'нет заголовка'}],
 ['type','Тип',n=>n.type,v=>Object.keys(NEWS_T).find(x=>norm(x)===norm(v))||{err:'«Тип»: Обновление, Нововведение, Исправление или Объявление'}],
 ['ver','Версия',n=>n.ver||'',v=>v||''],
 ['date','Дата публикации',n=>fmtD(n.date),v=>{const m=/^(\d\d)\.(\d\d)\.(\d{4})$/.exec(v);return m?`${m[3]}-${m[2]}-${m[1]}`:{err:'дата — ДД.ММ.ГГГГ'}}],
 ['aud','Для кого',n=>NEWS_AUD[n.aud],v=>{const e=Object.entries(NEWS_AUD).find(([k,x])=>norm(x)===norm(v));return e?e[0]:{err:'«Для кого»: Все пользователи или Только режим Админка'}}],
 ['pin','Закрепить вверху',n=>YN(n.pin),ynIn('Закрепить вверху')],
 ['login','Показывать при входе',n=>YN(n.login),ynIn('Показывать при входе')],
 ['short','Краткое описание',n=>n.short||'',v=>v||{err:'нет краткого описания'}],
 ['md','Подробное описание (markdown)',n=>n.md||'',v=>v||{err:'нет подробного описания'}]],
 upd:(x,v)=>{Object.keys(v).forEach(f=>{if(v[f]!=null)x[f]=v[f]});if(x.status==='Опубликовано')x.edited=TODAY;touch(x)},
 add:v=>{const o=born(Object.assign({status:'Черновик',off:false,link:null,hist:[{at:nowStamp(),to:'Черновик',who:S.me}]},v));NEWS.push(o)}};
// Показы: строка — одно облачко сценария; меняются заголовок, текст, признак «Общий элемент» и «Активен» сценария
const shFlat=()=>KBSH.flatMap(h=>h.items.map((p,k)=>({id:h.id+'#'+(k+1),h,p,name:((KBS.find(s=>s.id===h.step)||{}).t||h.step)+' · облачко '+(k+1)})));
DX.kbshows={title:'Показы',key:'id',items:shFlat,cols:[
 ['id','Код',x=>x.id,v=>v],['step','Шаг',x=>{const i=KBS.find(s=>s.id===x.h.step);return i?i.t:x.h.step},v=>v],['what','Что подсвечивает',x=>kbShowWhat(x.p),v=>v],
 ['t','Заголовок облачка',x=>x.p.auto?'':x.p.t||'',v=>v],['x','Текст облачка',x=>x.p.auto?'':x.p.x||'',v=>v],
 ['common','Общий элемент',x=>x.p.auto?'':YN(!!x.p.common),v=>{const b=parseYN(v);return b===undefined?{err:'«Общий элемент»: да или нет'}:b}],['active','Сценарий активен',x=>YN(x.h.active!==false),ynIn('Сценарий активен')]],
 upd:(x,v)=>{if(!x.p.auto){if(v.t)x.p.t=v.t;if(v.x!=null)x.p.x=v.x;if(v.common!=null){if(v.common)x.p.common=true;else delete x.p.common}}if(v.active!=null)x.h.active=v.active},
 add:v=>{const h=KBSH.find(s=>v.id&&v.id.startsWith(s.id+'#'));if(h&&v.t)h.items.push(Object.assign({t:v.t,x:v.x||''},v.common?{common:true}:{}))}};
DX.kbarts={title:'Статьи Базы знаний',key:'id',items:()=>KB_ARTS,cols:[
 ['id','Код',a=>a.id,v=>v],['sec','Раздел',a=>a.sec,v=>v||{err:'нет раздела'}],['t','Название',a=>a.t,v=>v||{err:'нет названия'}],
 ['mod','Модуль',a=>a.mod?kbModT(a.mod):'',v=>{if(!v||v==='—')return '';const m=[...BIZ,...ADM].find(x=>norm(x.title)===norm(v));return m?m.id:{err:`модуля «${v}» нет`}}],
 ['perm','Право для просмотра',a=>a.perm?permT(a.perm):'',permIn],
 ['aud','Кому',a=>AUD_L[a.aud]||'',v=>{const e=Object.entries(AUD_L).find(([k,x])=>norm(x)===norm(v));return e?e[0]:{err:'«Кому»: Организациям, Администраторам платформы или Всем'}}],
 ['html','Текст',a=>a.html,v=>v||{err:'нет текста'}],['active','Активна',a=>YN(a.active!==false),ynIn('Активна')]],
 upd:(x,v)=>{Object.keys(v).forEach(f=>{if(v[f]!=null)x[f]=v[f]});touch(x);KB.ver++},add:v=>{KB_ARTS.push(born(Object.assign({active:true},v)));KB.ver++}};

function pdLog(what,dict){PD_HIST.push({at:TODAY+' '+bishkekNow().hm,what,dict:dict||S.tab,who:S.me})}
function pdHistHtml(dict){const h=PD_HIST.filter(x=>x.dict===dict).slice().reverse();if(!h.length)return '';return `<div class="box"><h3>История изменений · ${h.length}</h3><ul class="tl">${h.slice(0,12).map(x=>`<li><span class="t">${fmtD(x.at.slice(0,10))}<br>${x.at.slice(11)}</span><span>${esc(x.what)}<br><span class="w">${esc(whoName(x.who))}</span></span></li>`).join('')}</ul></div>`}
// Ячейка с переводами строк (подробное описание новости в markdown) уходит в кавычках, как её копирует Excel; остальные — одной строкой
const dxCell=v=>{v=String(v??'');return /\n/.test(v)?'"'+v.replace(/"/g,'""')+'"':v.replace(/\t/g,' ')};
function dxText(k){const d=DX[k];return [d.cols.map(c=>c[1]).join('\t'),...d.items().map(x=>d.cols.map(c=>dxCell(c[2](x))).join('\t'))].join('\n')}
// Разбор вставки из Excel: строки и ячейки, ячейка в кавычках может содержать переводы строк
function dxRows(t,dl){const rows=[];let row=[],c='',i=0,q=false;t=t.replace(/\r\n?/g,'\n');
  while(i<t.length){const ch=t[i];
    if(q){if(ch==='"'&&t[i+1]==='"'){c+='"';i+=2;continue}if(ch==='"'){q=false;i++;continue}c+=ch;i++;continue}
    if(ch==='"'&&!c.trim()){q=true;c='';i++;continue}
    if(ch===dl){row.push(c);c='';i++;continue}
    if(ch==='\n'){row.push(c);rows.push(row);row=[];c='';i++;continue}
    c+=ch;i++}
  row.push(c);rows.push(row);return rows.filter(r=>r.some(x=>x.trim()))}
function exportDlg(k){const d=DX[k];const txt=dxText(k);
  openModal({size:'wide',render:()=>({title:`Выгрузка: ${esc(d.title)}`,sub:`${d.items().length} строк · формат как у загрузки`,body:`<div class="note">${ic('info')}<span>Откройте файл в Excel, поправьте и загрузите обратно через «Загрузить из Excel». Колонку «Код» не меняйте: по ней строки сопоставляются. Новую строку добавьте с новым кодом${k==='types'?' (латиницей, без пробелов)':''}.</span></div><textarea class="inp mono" id="ex-ta" readonly style="min-height:260px;font-size:12px;white-space:pre">${esc(txt)}</textarea>`,
    foot:`<button class="btn" id="ex-copy">${ic('paste','sm')}Скопировать</button><div class="grow"></div><button class="btn ghost" data-close>Закрыть</button><button class="btn cta" id="ex-dl">${ic('download','sm')}Скачать для Excel</button>`,
    mount(el){$('#ex-copy',el).onclick=()=>{const ta=$('#ex-ta',el);ta.select();try{navigator.clipboard.writeText(txt).then(()=>toast('Скопировано: вставьте в Excel'),()=>{document.execCommand('copy');toast('Скопировано: вставьте в Excel')})}catch(e){document.execCommand('copy');toast('Скопировано')}};
      $('#ex-dl',el).onclick=()=>toast('В рабочей версии скачается файл Excel. В прототипе нажмите «Скопировать» и вставьте в Excel','download')}})});
}
/* Загрузка: вставка или файл → сравнение → «Применить» (со снимком для отката) */
function importDictDlg(k){const d=DX[k];const st={text:'',diff:null};
  const compare=()=>{const first=st.text.split(/\r?\n/).find(l=>l.trim())||'';const dl=first.includes('\t')?'\t':';';const lines=dxRows(st.text,dl);if(lines.length<2){st.diff={fatal:'Нужна строка заголовков и хотя бы одна строка данных'};return}
    const head=lines[0].map(h=>norm(h.trim()));const idx=d.cols.map(c=>head.indexOf(norm(c[1])));
    if(idx[0]<0){st.diff={fatal:`Нет колонки «${d.cols[0][1]}»: без кода строки не сопоставить`};return}
    const seen=new Set();const out={add:[],chg:[],off:[],same:0,err:[],rows:lines.length-1};
    lines.slice(1).forEach((l,li)=>{const cells=l.map(x=>x.trim());const v={},e=[];
      d.cols.forEach((c,ci)=>{if(idx[ci]<0)return;const r=c[3](cells[idx[ci]]??'');if(r&&typeof r==='object'&&r.err)e.push(r.err);else v[c[0]]=r});
      const code=v[d.cols[0][0]];if(!code)e.push('нет кода');else if(seen.has(code))e.push('код повторяется в файле');seen.add(code);
      if(d.check&&!e.length){const base=d.items().find(i=>i[d.key]===code)||{};const nv=Object.assign({},base);Object.keys(v).forEach(f=>{if(v[f]!=null)nv[f]=v[f]});const ce=d.check(nv);if(ce)e.push(ce)}
      if(e.length){out.err.push({n:li+2,code:code||'—',e});return}
      const x=d.items().find(i=>i[d.key]===code);
      if(!x){if(k==='types'&&!/^[a-z0-9_]+$/i.test(code)){out.err.push({n:li+2,code,e:['код вида — латиница и цифры']});return}out.add.push({code,v});return}
      const ch=[];d.cols.forEach((c,ci)=>{if(idx[ci]<0||ci===0)return;const nx=Object.assign({},x,v);if(c[0]==='after'||c[0]==='ym'){if((v.per||x.per)==='Y'?c[0]==='after':c[0]==='ym')return}const a=String(c[2](x)??''),b=String(c[2](nx)??'');if(a!==b)ch.push([c[1],a,b])});
      if(!ch.length){out.same++;return}
      const off=x.active&&v.active===false;(off?out.off:out.chg).push({code,x,v,ch})});
    if(k==='types'){const ids=new Set([...out.chg,...out.off].filter(r=>['per','day','after','ym'].some(f=>r.v[f]!=null&&r.v[f]!==r.x[f])).map(r=>r.code));out.dues=REPORTS.filter(r=>ids.has(r.t)&&OPEN.has(r.status)).length;
      const ac=new Set([...out.chg,...out.off].filter(r=>r.v.act&&r.v.act!==r.x.act).map(r=>r.code));out.actT=ac.size;out.actR=REPORTS.filter(r=>ac.has(r.t)).length}
    st.diff=out};
  openModal({size:'wide',live:true,render:m=>{const df=st.diff;const ok=df&&!df.fatal;const n=ok?df.add.length+df.chg.length+df.off.length:0;
    const row=(cls,lbl,r,txt)=>`<tr><td><span class="pill sm ${cls}">${lbl}</span></td><td class="mono">${esc(r.code)}</td><td style="white-space:normal">${txt}</td></tr>`;
    return {title:`Загрузка: ${esc(d.title)}`,sub:'Вставьте строки из Excel или выберите файл в формате выгрузки',body:!df||df.fatal?`${fld('Данные',`<textarea class="inp mono" id="id-ta" style="min-height:220px;font-size:12px" placeholder="Вставьте строки с заголовками (Ctrl+V)">${esc(st.text)}</textarea>`,{full:true,id:'id-ta',hint:df&&df.fatal?'':`Колонки: ${d.cols.map(c=>c[1]).join(', ')}. Удаление через загрузку не делается — чтобы убрать значение, поставьте «Нет» в колонке «${d.cols[d.cols.length-1][1]}».`})}
      <div class="row"><label class="btn sm" style="cursor:pointer">${ic('upload','sm')}Файл Excel/CSV<input type="file" id="id-f" accept=".csv,.tsv,.txt" hidden></label><button class="linkbtn" id="id-cur">Подставить текущую выгрузку</button></div>`
      :`<div class="plates">${plate({id:'a',icon:'plus',color:'green',label:'Будет добавлено',value:df.add.length})}${plate({id:'c',icon:'edit',color:'blue',label:'Будет изменено',value:df.chg.length})}${plate({id:'o',icon:'ban',color:'orange',label:'Будет отключено',value:df.off.length})}${plate({id:'e',icon:'alert',color:df.err.length?'red':'green',label:'Строк с ошибками',value:df.err.length,sub:df.err.length?'не загрузятся':'ошибок нет'})}</div>
      ${df.actR?`<div class="note">${ic('info')}<span>«Что нужно сделать» меняется у ${df.actT} ${plural(df.actT,'вида','видов','видов')}: по ${df.actT>1?'ним':'нему'} уже создано ${df.actR} ${plural(df.actR,'отчёт','отчёта','отчётов')}, они не изменятся. Новое значение действует для новых периодов.</span></div>`:''}
      ${df.dues?`<div class="note warn">${ic('alert')}<span>Изменятся сроки у ${spreadTxt(df.dues)}. Сданные отчёты не меняются.</span></div>`:''}
      <div class="tbl-wrap" style="max-height:340px;overflow:auto"><table class="mini"><thead><tr><th style="width:130px">Что будет</th><th style="width:110px">Код</th><th>Подробно</th></tr></thead><tbody>
      ${df.err.map(r=>`<tr><td><span class="pill sm red">${ic('alert')}ошибка</span></td><td class="mono">${esc(r.code)}</td><td style="white-space:normal">Строка ${r.n}: ${esc(r.e.join('; '))}</td></tr>`).join('')}
      ${df.add.map(r=>row('green','добавится',r,esc(r.v.name||''))).join('')}
      ${df.chg.map(r=>row('blue','изменится',r,r.ch.map(([l,a,b])=>`${esc(l)}: <s class="faint">${esc(a)||'пусто'}</s> → <b>${esc(b)||'пусто'}</b>`).join('<br>'))).join('')}
      ${df.off.map(r=>row('orange','отключится',r,esc(r.x.name)+(r.ch.length>1?'<br>'+r.ch.filter(c=>c[0]!==d.cols[d.cols.length-1][1]).map(([l,a,b])=>`${esc(l)}: ${esc(a)} → <b>${esc(b)}</b>`).join('<br>'):''))).join('')}
      ${!n&&!df.err.length?`<tr><td colspan="3" class="faint">Отличий нет: ${df.same} ${plural(df.same,'строка совпадает','строки совпадают','строк совпадают')} со справочником.</td></tr>`:''}
      </tbody></table></div><div class="hint">Без изменений: ${df.same}. Значения, которых нет в файле, остаются как есть — удаление через загрузку не делается.</div>`,
    foot:!df||df.fatal?`${df&&df.fatal?`<span class="red">${ic('alert','sm')} ${esc(df.fatal)}</span>`:''}<div class="grow"></div><button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="id-cmp">Сравнить</button>`:`<button class="btn ghost" id="id-back">${ic('left','sm')}Изменить данные</button><div class="grow"></div><button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="id-ok" ${n?'':'disabled'}>ОК, применить ${n||''}</button>`,
    mount(el){const q=s=>el.querySelector(s);
      if(q('#id-ta'))q('#id-ta').oninput=e=>st.text=e.target.value;
      if(q('#id-cur'))q('#id-cur').onclick=()=>{st.text=dxText(k);st.diff=null;m.draw()};
      if(q('#id-f'))q('#id-f').onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{st.text=String(rd.result).replace(/^﻿/,'');st.diff=null;m.draw();toast('Файл прочитан: нажмите «Сравнить»')};rd.readAsText(f,'utf-8')};
      if(q('#id-cmp'))q('#id-cmp').onclick=()=>{if(!st.text.trim()){setErr(el,'id-ta','Вставьте данные или выберите файл');return}compare();m.draw()};
      if(q('#id-back'))q('#id-back').onclick=()=>{st.diff=null;m.draw()};
      if(q('#id-ok'))q('#id-ok').onclick=()=>{const df=st.diff;const snap={};[...df.chg,...df.off].forEach(r=>snap[r.code]=JSON.parse(JSON.stringify(r.x)));const all=d.snapAll?d.snapAll():null;
        [...df.chg,...df.off].forEach(r=>{const x=r.x;if(d.upd){d.upd(x,r.v);return}const rule=k==='types'&&['per','day','after','ym'].some(f=>r.v[f]!=null&&r.v[f]!==x[f]);
          if(k!=='types'&&r.v.name&&r.v.name!==x.name)renameDictValue(k,x.name,r.v.name);
          if(k==='types'&&r.v.act&&r.v.act!==x.act)REPORTS.filter(rp=>rp.t===x.id&&!rp.act).forEach(rp=>rp.act=x.act);
          Object.keys(r.v).forEach(f=>{if(r.v[f]==null)return;if(DX_NEST[f]){DX_NEST[f](x,r.v[f]);return}x[f]=f==='gked'?gkRuleKeep(x.gked,r.v[f]):r.v[f]});if(k==='types'){typeNorm(x);x.rate=(x.rates||[])[0]||'';const pays=x.pays;setAct(x,x.act||'both');if(x.act!=='sub'&&pays&&pays.length)x.pays=pays}touch(x);
          if(rule)REPORTS.filter(rp=>rp.t===x.id&&OPEN.has(rp.status)).forEach(rp=>{const dd=dueOf(tFor(rp),rp.p);rp.dueBase=dd.base;rp.due=dd.due})});
        df.add.forEach(r=>{let o;if(d.add){d.add(r.v);return}if(k==='types'){o=Object.assign({id:r.code,name:'',short:'',code:'—',organ:'ГНС',per:'M',day:20,after:1,ym:4,sum:true,kind:'cross',regimes:[],who:'all',rates:[],shift:true,active:true},r.v);o.after=o.after??1;o.ym=o.ym??4;typeNorm(o);o.rate=(o.rates||[])[0]||'';born(o);RT.push(o);T[o.id]=o}else{o=born(Object.assign({active:true},r.v));Object.keys(DX_NEST).forEach(f=>{if(f in o){DX_NEST[f](o,o[f]);delete o[f]}});d.items().push(o);if(k==='phones')PH[o.cc]=o}});
        const L={id:'L'+(PD_LOADS.length+1),at:TODAY+' '+bishkekNow().hm,by:S.me,dict:k,rows:df.rows,add:df.add.length,chg:df.chg.length,off:df.off.length,err:df.err.length,snap,all,added:df.add.map(r=>r.code),rolled:false};PD_LOADS.push(L);
        if(d.add)recalcDues();
        if(k==='bases')typesFromBases();if(k==='types')basesFromTypes();pdLog(`${d.title}: загрузка из Excel — добавлено ${L.add}, изменено ${L.chg}, отключено ${L.off}`);m.close();refreshAll();toast(`Загружено: добавлено ${L.add}, изменено ${L.chg}, отключено ${L.off}`,'upload')}}}}});
}
function renameDictValue(k,o,n){if(k==='benefits')CPS.forEach(c=>{if(c.ben)c.ben=c.ben.map(x=>x===o?n:x)});if(k==='regimes')CPS.forEach(c=>{if(c.regime2===o)c.regime2=n});if(k==='cats')TASKS.forEach(t=>{if(t.cat===o)t.cat=n});if(k==='regimes'){CPS.forEach(c=>{if(c.regime===o)c.regime=n});RT.forEach(t=>{t.regimes=t.regimes.map(r=>r===o?n:r)})}if(k==='forms')CPS.forEach(c=>{if(c.form===o)c.form=n});if(k==='organs')RT.forEach(t=>{if(t.organ===o)t.organ=n})}
function rollbackLoad(L){const d=DX[L.dict];
  confirmDlg({title:'Откатить последнюю загрузку?',text:`${esc(d.title)}, ${fmtD(L.at.slice(0,10))} ${L.at.slice(11)}: добавленные значения (${L.add}) уберутся, изменённые и отключённые (${L.chg+L.off}) вернутся к прежнему виду.`,ok:'Откатить',danger:true,run:()=>{
    if(L.all&&d.restore){d.restore(L.all);L.rolled=true;pdLog(`${d.title}: загрузка от ${fmtD(L.at.slice(0,10))} откачена`,L.dict);refreshAll();toast('Загрузка откачена');return}
    Object.entries(L.snap).forEach(([code,old])=>{const x=d.items().find(i=>i[d.key]===code);if(!x)return;if(L.dict!=='types'&&old.name!==x.name)renameDictValue(L.dict,x.name,old.name);Object.assign(x,old);touch(x);
      if(L.dict==='types')REPORTS.filter(rp=>rp.t===x.id&&OPEN.has(rp.status)).forEach(rp=>{const dd=dueOf(tFor(rp),rp.p);rp.dueBase=dd.base;rp.due=dd.due})});
    L.added.forEach(code=>{const arr=d.items();const i=arr.findIndex(x=>x[d.key]===code);if(i<0)return;const used=L.dict==='types'?CPS.some(c=>c.assign.some(a=>a.t===code)):false;if(used){arr[i].active=false;return}arr.splice(i,1);if(L.dict==='types')delete T[code]});
    L.rolled=true;pdLog(`${d.title}: загрузка от ${fmtD(L.at.slice(0,10))} откачена`);refreshAll();toast('Загрузка откачена')}})}
function renderLoads(body,fresh){body.innerHTML=`<div class="note">${ic('info')}<span>Каждая загрузка справочника из Excel — отдельная запись. Последнюю загрузку можно откатить: справочник вернётся к виду до неё.</span></div><div id="pg"></div>`;
  const last=[...PD_LOADS].reverse().find(l=>!l.rolled);
  grid($('#pg',body),{id:'adm-loads',audit:false,cols:[{key:'at',label:'Когда',type:'date',w:150,val:l=>l.at.slice(0,10),html:l=>`${fmtD(l.at.slice(0,10))} ${l.at.slice(11)}`},{key:'dict',label:'Справочник',type:'enum',w:220,val:l=>DX[l.dict].title},{key:'by',label:'Кто',type:'enum',w:170,val:l=>whoName(l.by)},{key:'rows',label:'Строк',type:'int',w:80,num:true,val:l=>l.rows},{key:'add',label:'Добавлено',type:'int',w:100,num:true,val:l=>l.add},{key:'chg',label:'Изменено',type:'int',w:100,num:true,val:l=>l.chg},{key:'off',label:'Отключено',type:'int',w:100,num:true,val:l=>l.off},{key:'err',label:'Ошибок',type:'int',w:90,num:true,val:l=>l.err},
    {key:'st',label:'Статус',type:'enum',w:150,val:l=>l.rolled?'Откачена':l===last?'Последняя':'Применена',html:l=>l.rolled?pill('Откачена',{Откачена:['faint','history']}):pill(l===last?'Последняя':'Применена',{Последняя:['blue','check'],Применена:['green','check']})}],
    rows:()=>PD_LOADS,title:'dict',noun:['загрузка','загрузки','загрузок'],sort:{key:'at',dir:-1},simulateLoad:fresh,
    actions:l=>[{label:'Откатить',icon:'history',danger:true,disabled:l!==last,reason:l.rolled?'Уже откачена':'Откатить можно только последнюю загрузку',run:()=>rollbackLoad(l)}],
    empty:{icon:'upload',title:'Загрузок пока не было',text:'Выгрузите справочник, поправьте в Excel и загрузите обратно — загрузка появится здесь.'}});
}
