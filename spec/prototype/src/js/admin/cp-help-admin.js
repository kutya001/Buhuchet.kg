'use strict';
// Админка → «База знаний (содержимое)» → «Страница контрагента» (доработки 15.11.2026, пункт 6; поток К; прототип v120): тексты подсказок и обучения
// на странице контрагента — один набор для всех организаций, организации их не меняют. Разделы: «Приветствие», «Обзор страницы», «Частые вопросы»,
// «Словарик» и «Подсказки в окнах»; у каждого — выгрузка в Excel и загрузка, как у «Показов». Что подсвечивает облачко обзора, задаёт разработчик.
/* ═════════════ Справочные подписи ═════════════ */
// Приглашение — полоса внизу страницы: одна строка и две кнопки (17.11.2026, «Меньше текста», п. 6)
const CPH_WEL=[['lead','Строка приглашения'],['go','Кнопка обзора'],['skip','Кнопка «Не сейчас»']];
const CPH_HINT=[['helpBtn','Подпись кнопки «?» в шапке'],['helpTitle','Заголовок панели «Помощь»'],['helpTour','Кнопка обзора в панели «Помощь»'],['faqHead','Заголовок «Частые вопросы»'],['askAcc','Вместо кнопки, если действие недоступно'],['notFound','Вверху панели: позвонить или написать бухгалтеру'],['glossHead','Заголовок «Словарик»'],
  ['actGoPay','Кнопка ответа: открыть «Оплату»'],['actPaid','Кнопка ответа: «Я оплатил»'],['actUp','Кнопка ответа: «Отправить файл»'],['actGoFiles','Кнопка ответа: открыть «Файлы»'],['actGoMoney','Кнопка ответа: открыть «Оплата» → «Налоги»'],['actGoFee','Кнопка ответа: открыть «Оплата» → «Услуги бухгалтера»'],['actGoReports','Кнопка ответа: открыть «Отчёты»'],['actTg','Кнопка ответа: «Подключить Telegram»'],['actCode','Кнопка ответа: «Прислать код в Telegram»'],
  ['paidNote','«Я оплатил»: строка сверху — это не оплата'],['paidPick','«Я оплатил» из «Помощи»: выбор «Налоги» или «Услуги бухгалтера»'],['paidFile','«Я оплатил»: под кнопкой «Приложить чек»'],['paidDone','«Я оплатил»: после отправки'],
  ['upHint','«Отправить файл»: под полем файлов ({мб}, {файлов})'],['upDone','«Отправить файл»: после отправки'],['codeWhat','Экран кода: ссылка'],['codeWhatX','Экран кода: объяснение под ссылкой'],
  ['emptyFiles','Пустая вкладка «От бухгалтера»'],['emptyFilesView','Пустая вкладка «От бухгалтера», если отправлять файлы нельзя'],['emptyReports','Пустой раздел «Отчёты» ({год})'],['emptyKpi','Пустой раздел «Цифры компании»']];
const CPH_SECL={state:'Что нужно сделать',main:'Главное (раздела больше нет)',pay:'Оплата',acc:'Связь',reports:'Отчёты',files:'Файлы',money:'Оплата → Налоги',fee:'Оплата → Услуги бухгалтера',kpi:'Цифры компании',contacts:'Связь → контакты',tg:'Связь → Telegram',help:'Кнопка «?» и «Помощь» в меню',end:'Последнее облачко «Готово»'};
const CPH_QSEC=[['','Вся страница'],['pay','Оплата: любая строка'],['payTax','Оплата: налоги'],['payFee','Оплата: услуги бухгалтера'],['reports','Отчёты'],['files','Файлы'],['money','Оплата: «Не хватает» у налогов'],['fee','Оплата: услуги бухгалтера'],['tg','Связь: Telegram']];
const CPH_ACTS=[['','Без кнопки'],['goPay','Открыть оплату'],['paid','Я оплатил'],['up','Отправить файл'],['goFiles','Открыть файлы'],['goMoney','Открыть налоги'],['goFee','Открыть услуги бухгалтера'],['goReports','Открыть отчёты'],['tg','Подключить Telegram'],['code','Прислать код в Telegram'],['colors','Метки отчётов: строки «Метка» — объяснение']];
const CPH_SUBS=[['wel','Приветствие'],['tour','Обзор страницы'],['faq','Частые вопросы'],['gloss','Словарик'],['hints','Подсказки в окнах']];
const cphQSecL=k=>(CPH_QSEC.find(x=>x[0]===(k||''))||['',k])[1];
const cphActNm=k=>(CPH_ACTS.find(x=>x[0]===(k||''))||['',k])[1];
const cphSub=()=>{const s=store.get('cphadm.sub','wel');return CPH_SUBS.some(x=>x[0]===s)?s:'wel'};
const CPH_DX={wel:'cpwel',tour:'cptour',faq:'cpfaq',gloss:'cpgloss',hints:'cphints'};
const cphLog=w=>pdLog('Страница контрагента: '+w,'cppage');
// Окно «Обзор страницы» в Админке не предпросматривается на живой странице: тексты и порядок видны в списке, сам обзор — на странице контрагента (кнопка «Открыть страницу»)
function cphPreviewCp(){return CPS.find(c=>pgOn(c))||null}

/* ═════════════ Вкладка ═════════════ */
function cphAdmAdd(){const s=cphSub(),io=k=>[{sep:true},{label:'Выгрузить в Excel',icon:'download',run:()=>exportDlg(k)},{label:'Загрузить из Excel',icon:'upload',run:()=>importDictDlg(k)}];
  if(s==='faq')return [{label:'Вопрос',icon:'help',run:()=>cphFaqDlg()},...io('cpfaq')];if(s==='gloss')return [{label:'Слово',icon:'book',run:()=>cphGlossDlg()},...io('cpgloss')];return io(CPH_DX[s])}
function renderCphAdm(body,fresh,ioBar){const s=cphSub(),H=CPH(),cp=cphPreviewCp();
  body.innerHTML=`<div class="note">${ic('info')}<span>Подсказки и обучение на странице контрагента — для клиентов без бухгалтерского образования: приглашение внизу страницы, обзор страницы, панель «Помощь» с частыми вопросами, «Словарик» и подсказки в окнах. Один набор текстов для всех организаций; организации их не меняют. Пишите на «вы», коротко — до 15 слов в предложении, без бухгалтерских слов; если без слова не обойтись, добавьте его в «Словарик».</span></div>
    <div class="row"><div class="chipsel" role="group" aria-label="Раздел">${CPH_SUBS.map(([k,l])=>`<button type="button" data-cphs="${k}" class="${s===k?'on':''}" aria-pressed="${s===k}">${l}</button>`).join('')}</div><div class="grow"></div>${cp?`<a class="btn sm" href="#/${esc(pgPath(cp))}" title="Страница контрагента «${esc(cp.name)}» демо-организации">${ic('eye','sm')}Открыть страницу</a>`:''}</div>
    ${ioBar(CPH_DX[s])}<div id="pg"></div>${pdHistHtml('cppage')}`;
  const prev=body.onclick;body.onclick=e=>{const b=e.target.closest('[data-cphs]');if(b){store.set('cphadm.sub',b.dataset.cphs);renderPage();return}prev&&prev(e)};
  const g=$('#pg',body);
  if(s==='wel'||s==='hints'){const L=s==='wel'?CPH_WEL:CPH_HINT,src=()=>s==='wel'?(H.welcome||(H.welcome={})):(H.hints||(H.hints={}));
    grid(g,{id:'cph-'+s,cols:[{key:'id',label:'Код',type:'text',w:110,val:x=>x.id,cls:'mono',hide:true},{key:'l',label:'Где',type:'text',w:320,val:x=>x.l,html:x=>`<span class="strong">${esc(x.l)}</span>`},{key:'t',label:'Текст',type:'text',w:520,val:x=>x.t,html:x=>x.t?esc(x.t):'<span class="faint">— текст по умолчанию</span>'}],
      rows:()=>L.map(([id,l])=>({id,l,t:src()[id]||''})),title:'l',noun:['текст','текста','текстов'],open:x=>cphTextDlg(s,x),simulateLoad:fresh,actions:x=>[{label:'Изменить',icon:'edit',run:()=>cphTextDlg(s,x)}]});return}
  if(s==='tour'){const L=()=>H.tour||(H.tour=[]);
    grid(g,{id:'cph-tour',cols:[{key:'n',label:'№',type:'int',w:60,num:true,val:x=>L().indexOf(x)+1},{key:'sec',label:'Что подсвечивает',type:'enum',w:220,val:x=>CPH_SECL[x.sec]||x.sec},{key:'t',label:'Заголовок облачка',type:'text',w:200,val:x=>x.t,html:x=>`<span class="strong">${esc(x.t)}</span>`},
      {key:'x',label:'Текст облачка',type:'text',w:420,val:x=>x.x},{key:'x2',label:'Текст, если действие недоступно',type:'text',w:300,val:x=>x.x2||''},{key:'on',label:'Шаг активен',type:'enum',w:120,val:x=>x.sec==='end'||x.on!==false?'Да':'Нет'}],
      rows:L,title:'t',noun:['облачко','облачка','облачков'],sort:{key:'n',dir:1},rowClass:x=>x.sec==='end'||x.on!==false?'':'muted',open:x=>cphTourDlg(x),simulateLoad:fresh,
      actions:x=>{const l=L(),k=l.indexOf(x),end=x.sec==='end',mv=d=>{const j=k+d;[l[k],l[j]]=[l[j],l[k]];cphLog(`обзор — «${x.t}» ${d<0?'выше':'ниже'}`);renderPage()};
        return [{label:'Изменить',icon:'edit',run:()=>cphTourDlg(x)},...(end?[]:[{label:'Выше',icon:'up',disabled:k===0,run:()=>mv(-1)},{label:'Ниже',icon:'dn',disabled:k>=l.length-1||l[k+1].sec==='end',run:()=>mv(1)},{sep:true},
          x.on!==false?{label:'Выключить',icon:'ban',sub:'Облачко пропадёт из обзора',run:()=>{x.on=false;cphLog(`обзор — «${x.t}» выключено`);renderPage()}}:{label:'Включить',icon:'check',run:()=>{x.on=true;cphLog(`обзор — «${x.t}» включено`);renderPage()}}])]}});return}
  if(s==='faq'){const L=()=>(H.faq||(H.faq=[])).slice().sort((a,b)=>(a.ord||0)-(b.ord||0));
    grid(g,{id:'cph-faq',cols:[{key:'ord',label:'Порядок',type:'int',w:90,num:true,val:x=>x.ord||0},{key:'q',label:'Вопрос',type:'text',w:300,val:x=>x.q,html:x=>`<span class="strong">${esc(x.q)}</span>`},{key:'a',label:'Ответ',type:'text',w:380,val:x=>String(x.a||'').replace(/\n/g,' · ')},
      {key:'sec',label:'Раздел',type:'enum',w:200,val:x=>cphQSecL(x.sec)},{key:'act',label:'Кнопка действия',type:'enum',w:230,val:x=>cphActNm(x.act)},{key:'on',label:'Активен',type:'enum',w:100,val:x=>x.on!==false?'Да':'Нет'}],
      rows:L,title:'q',noun:['вопрос','вопроса','вопросов'],sort:{key:'ord',dir:1},rowClass:x=>x.on!==false?'':'muted',open:x=>cphFaqDlg(x),simulateLoad:fresh,
      actions:x=>{const l=L(),k=l.indexOf(x),mv=d=>{const o=l[k+d];[x.ord,o.ord]=[o.ord,x.ord];cphLog(`вопрос «${x.q}» ${d<0?'выше':'ниже'}`);renderPage()};
        return [{label:'Изменить',icon:'edit',run:()=>cphFaqDlg(x)},{label:'Выше',icon:'up',disabled:k===0,run:()=>mv(-1)},{label:'Ниже',icon:'dn',disabled:k===l.length-1,run:()=>mv(1)},{sep:true},
          x.on!==false?{label:'Выключить',icon:'ban',sub:'Вопрос пропадёт из «Помощи»',run:()=>{x.on=false;cphLog(`вопрос «${x.q}» выключен`);renderPage()}}:{label:'Включить',icon:'check',run:()=>{x.on=true;cphLog(`вопрос «${x.q}» включён`);renderPage()}},
          {label:'Удалить',icon:'trash',danger:true,run:()=>confirmDlg({title:'Удалить вопрос?',text:`«${x.q}» пропадёт из «Помощи» у всех контрагентов. Чтобы скрыть на время, лучше выключите его.`,ok:'Удалить',danger:true,run:()=>{H.faq.splice(H.faq.indexOf(x),1);cphLog(`вопрос «${x.q}» удалён`);renderPage();toast('Вопрос удалён')}})}]}});return}
  const L=()=>(H.gloss||(H.gloss=[])).slice().sort((a,b)=>a.w.localeCompare(b.w,'ru'));
  grid(g,{id:'cph-gloss',cols:[{key:'w',label:'Слово',type:'text',w:200,val:x=>x.w,html:x=>`<span class="strong">${esc(cphCap(x.w))}</span>`},{key:'x',label:'Объяснение',type:'text',w:480,val:x=>x.x},{key:'also',label:'Другие формы на странице',type:'text',w:240,val:x=>x.also||''}],
    rows:L,title:'w',noun:['слово','слова','слов'],sort:{key:'w',dir:1},open:x=>cphGlossDlg(x),simulateLoad:fresh,
    actions:x=>[{label:'Изменить',icon:'edit',run:()=>cphGlossDlg(x)},{sep:true},{label:'Удалить',icon:'trash',danger:true,run:()=>confirmDlg({title:'Удалить слово?',text:`«${x.w}» больше не будет подчёркнуто на странице и пропадёт из «Словарика».`,ok:'Удалить',danger:true,run:()=>{H.gloss.splice(H.gloss.indexOf(x),1);cphLog(`«Словарик» — удалено «${x.w}»`);renderPage();toast('Слово удалено')}})}]})}

/* ═════════════ Окна правки ═════════════ */
// Проверка простоты текста: предложение длиннее 15 слов — подсказка администратору (не запрет)
const cphLong=t=>String(t||'').split(/(?<=[.!?])\s+|\n/).some(x=>x.split(/\s+/).filter(w=>/[\p{L}\p{N}]/u.test(w)).length>15);
const cphLongHint='Есть предложение длиннее 15 слов — клиенту будет проще, если разбить его на два';
function cphTextDlg(s,x){const src=s==='wel'?CPH().welcome:CPH().hints;
  openModal({form:true,noMax:true,render:()=>({title:'Текст подсказки',sub:esc(x.l),body:`<div class="form">${fld('Текст',`<textarea class="inp" id="cpt-t" maxlength="600" style="min-height:90px">${esc(src[x.id]||'')}</textarea>`,{req:true,full:true,id:'cpt-t',hint:/\{/.test(x.l)?'Слова в фигурных скобках программа заменит сама — оставьте их как есть':''})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="cpt-ok">Сохранить</button>',
    mount(el,m){$('#cpt-ok',el).onclick=()=>{const t=val(el,'cpt-t').trim();if(!setErr(el,'cpt-t',t?'':'Введите текст'))return;if(src[x.id]===t){m.close();return}src[x.id]=t;cphLog(`«${x.l}» изменён`);m.close();renderPage();toast(cphLong(t)?cphLongHint:'Текст сохранён',cphLong(t)?'info':'check')}}})})}
function cphTourDlg(x){const end=x.sec==='end',alt=x.sec==='pay'||x.sec==='files';
  openModal({form:true,noMax:true,render:()=>({title:'Облачко обзора',sub:esc(CPH_SECL[x.sec]||x.sec),body:`<div class="note">${ic('info')}<span>Облачко подсвечивает: ${esc(CPH_SECL[x.sec]||x.sec)}. Что подсвечивать, задаёт разработчик. Облачко раздела, скрытого у контрагента, обзор пропускает сам.</span></div><div class="form">
    ${fld('Заголовок облачка',inp('cpo-t',x.t||''),{req:true,full:true,id:'cpo-t'})}${fld('Текст облачка',`<textarea class="inp" id="cpo-x" maxlength="300" style="min-height:70px">${esc(x.x||'')}</textarea>`,{req:true,full:true,id:'cpo-x',hint:'1–2 простых предложения: что здесь и что сделать'})}
    ${alt?fld('Текст, если действие недоступно',`<textarea class="inp" id="cpo-x2" maxlength="300" style="min-height:60px">${esc(x.x2||'')}</textarea>`,{full:true,id:'cpo-x2',hint:x.sec==='pay'?'Когда «Я оплатил» нет: контрагент не может отправлять файлы':'Когда «Отправить файл» нет: контрагент не может отправлять файлы'}):''}
    ${end?'':fld('Шаг активен',`<label class="row" style="gap:8px"><input type="checkbox" class="sw" id="cpo-on" ${x.on!==false?'checked':''}>выключенное облачко обзор пропускает</label>`,{id:'cpo-on'})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="cpo-ok">Сохранить</button>',
    mount(el,m){$('#cpo-ok',el).onclick=()=>{const t=val(el,'cpo-t').trim(),tx=val(el,'cpo-x').trim();if(![setErr(el,'cpo-t',t?'':'Введите заголовок'),setErr(el,'cpo-x',tx?'':'Введите текст')].every(Boolean))return;
      Object.assign(x,{t,x:tx});if(alt)x.x2=val(el,'cpo-x2').trim();if(!end)x.on=$('#cpo-on',el).checked;cphLog(`обзор — облачко «${t}» изменено`);m.close();renderPage();toast(cphLong(tx)?cphLongHint:'Облачко сохранено',cphLong(tx)?'info':'check')}}})})}
function cphFaqDlg(x0){const isNew=!x0,H=CPH(),x=x0||{q:'',a:'',sec:'',act:'',on:true};
  openModal({form:true,size:'mid',render:()=>({title:isNew?'Новый вопрос':'Частый вопрос',sub:isNew?'Появится в «Помощи» у всех контрагентов':esc(x.q),body:`<div class="form">
    ${fld('Вопрос',inp('cpq-q',x.q),{req:true,full:true,id:'cpq-q',hint:'Так, как спросил бы клиент: «Как…?», «Что значит…?»'})}
    ${fld('Ответ',`<textarea class="inp" id="cpq-a" maxlength="1000" style="min-height:110px">${esc(x.a||'')}</textarea>`,{req:true,full:true,id:'cpq-a',hint:'2–4 коротких шага, каждый с новой строки. У кнопки «Метки отчётов» — строки вида «Сдан» — объяснение'})}
    ${fld('Раздел',sel('cpq-sec',CPH_QSEC,x.sec||''),{id:'cpq-sec',hint:'Раздел скрыт у контрагента — вопрос не показывается'})}${fld('Кнопка действия',sel('cpq-act',CPH_ACTS,x.act||''),{id:'cpq-act',hint:'Действие недоступно — вместо кнопки «Спросите вашего бухгалтера»'})}
    ${fld('Активен',`<label class="row" style="gap:8px"><input type="checkbox" class="sw" id="cpq-on" ${x.on!==false?'checked':''}>показывается в «Помощи»</label>`,{id:'cpq-on'})}</div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="cpq-ok">Сохранить</button>',
    mount(el,m){$('#cpq-ok',el).onclick=()=>{const q=val(el,'cpq-q').trim(),a=$('#cpq-a',el).value.split('\n').map(l=>l.trim()).filter(Boolean).join('\n');
      if(![setErr(el,'cpq-q',q?'':'Введите вопрос'),setErr(el,'cpq-a',a?'':'Введите ответ')].every(Boolean))return;
      const v={q,a,sec:val(el,'cpq-sec'),act:val(el,'cpq-act'),on:$('#cpq-on',el).checked};
      if(isNew){H.faq=H.faq||[];H.faq.push({id:'q'+Date.now().toString(36),ord:Math.max(0,...H.faq.map(y=>y.ord||0))+1,...v});cphLog(`добавлен вопрос «${q}»`)}else{Object.assign(x,v);cphLog(`вопрос «${q}» изменён`)}
      m.close();renderPage();toast(cphLong(a)?cphLongHint:isNew?'Вопрос добавлен':'Вопрос сохранён',cphLong(a)?'info':'check')}}})})}
function cphGlossDlg(x0){const isNew=!x0,H=CPH(),x=x0||{w:'',x:'',also:''};
  openModal({form:true,noMax:true,render:()=>({title:isNew?'Новое слово':'Слово «Словарика»',sub:isNew?'':esc(cphCap(x.w)),body:`<div class="form">
    ${fld('Слово',inp('cpg-w',x.w),{req:true,full:true,id:'cpg-w',hint:'Как в тексте страницы, с маленькой буквы; сокращения — заглавными (НДС)'})}
    ${fld('Объяснение',`<textarea class="inp" id="cpg-x" maxlength="300" style="min-height:70px">${esc(x.x||'')}</textarea>`,{req:true,full:true,id:'cpg-x',hint:'Простыми словами, 1–2 предложения'})}
    ${fld('Другие формы на странице',inp('cpg-a',x.also||''),{full:true,id:'cpg-a',hint:'Необязательно, через запятую: например, «к уплате» для «к оплате». Формы одного слова (отчёт, отчёты, отчётов) находятся сами'})}
    <label class="row full" style="grid-column:1/-1"><input type="checkbox" id="cpg-pg" ${x.pg===false?'':'checked'}> Подчёркивать на странице</label><span class="hint full" style="grid-column:1/-1">Пунктиром — только настоящие термины (НДС, Соцфонд); обычные слова есть только в «Словарике» «Помощи». Подчёркивается первое появление в каждом разделе</span></div>`,
    foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="cpg-ok">Сохранить</button>',
    mount(el,m){$('#cpg-ok',el).onclick=()=>{const w=val(el,'cpg-w').trim(),tx=val(el,'cpg-x').trim(),also=val(el,'cpg-a').split(',').map(s=>s.trim()).filter(Boolean).join(', ');
      const dup=(H.gloss||[]).some(y=>y!==x0&&norm(y.w)===norm(w));
      if(![setErr(el,'cpg-w',!w?'Введите слово':dup?'Такое слово уже есть в «Словарике»':''),setErr(el,'cpg-x',tx?'':'Введите объяснение')].every(Boolean))return;
      const pg=$('#cpg-pg',el).checked,v={w,x:tx,...(also?{also}:{}),...(pg?{}:{pg:false})};if(isNew){H.gloss=H.gloss||[];H.gloss.push(v);cphLog(`«Словарик» — добавлено «${w}»`)}else{delete x.also;delete x.pg;Object.assign(x,v);cphLog(`«Словарик» — «${w}» изменено`)}
      m.close();renderPage();toast(isNew?'Слово добавлено':'Слово сохранено')}}})})}

/* ═════════════ Выгрузка в Excel и загрузка — как у «Показов» ═════════════ */
// Строки-обёртки: колонки «Где», «№» и «Что подсвечивает» только для чтения — их задаёт разработчик
const cphTexts=(s,L)=>()=>L.map(([id,l])=>({id,l,t:((s==='wel'?CPH().welcome:CPH().hints)||{})[id]||''}));
const cphTextDX=(s,L,title)=>({title,key:'id',items:cphTexts(s,L),hint:'Коды не меняйте: по ним строки сопоставляются. Новые строки через загрузку не добавляются.',
  cols:[['id','Код',x=>x.id,v=>v],['l','Где',x=>x.l,v=>v],['t','Текст',x=>x.t,v=>v||{err:'нет текста'}]],
  check:v=>L.some(([id])=>id===v.id)?'':'такого текста нет — новые тексты добавляет разработчик',
  upd:(x,v)=>{if(v.t)(s==='wel'?CPH().welcome:CPH().hints)[x.id]=v.t},add:()=>{},
  snapAll:()=>structuredClone(s==='wel'?CPH().welcome:CPH().hints),restore:o=>{CPH()[s==='wel'?'welcome':'hints']=o}});
DX.cpwel=cphTextDX('wel',CPH_WEL,'Страница контрагента: приветствие');
DX.cphints=cphTextDX('hints',CPH_HINT,'Страница контрагента: подсказки в окнах');
DX.cptour={title:'Страница контрагента: обзор страницы',key:'id',hint:'Коды не меняйте. Новые облачка через загрузку не добавляются — что подсвечивать, задаёт разработчик. Чтобы убрать облачко, поставьте «Нет» в колонке «Шаг активен».',
  items:()=>(CPH().tour||[]).map((s,i)=>({id:s.id,s,n:i+1,t:s.t,x:s.x,x2:s.x2||'',on:s.sec==='end'||s.on!==false})),
  cols:[['id','Код',x=>x.id,v=>v],['n','№',x=>x.n,v=>v],['secL','Что подсвечивает',x=>CPH_SECL[x.s.sec]||x.s.sec,v=>v],['t','Заголовок облачка',x=>x.t,v=>v||{err:'нет заголовка'}],['x','Текст облачка',x=>x.x,v=>v||{err:'нет текста'}],['x2','Текст, если действие недоступно',x=>x.x2,v=>v],['on','Шаг активен',x=>YN(x.on),ynIn('Шаг активен')]],
  check:v=>v.s?'':'такого облачка нет — новые облачка добавляет разработчик',
  upd:(x,v)=>{const s=x.s;if(v.t)s.t=v.t;if(v.x)s.x=v.x;if(v.x2!=null&&(s.sec==='pay'||s.sec==='files'))s.x2=v.x2;if(v.on!=null&&s.sec!=='end')s.on=v.on},add:()=>{},
  snapAll:()=>structuredClone(CPH().tour),restore:o=>{CPH().tour=o}};
DX.cpfaq={title:'Страница контрагента: частые вопросы',key:'id',
  items:()=>(CPH().faq||[]).map(q=>({id:q.id,q:q.q,a:q.a,sec:q.sec||'',act:q.act||'',ord:q.ord||0,on:q.on!==false,_q:q})),
  cols:[['id','Код',x=>x.id,v=>v],['ord','Порядок',x=>x.ord,v=>{const n=parseInt(v,10);return v===''?null:isNaN(n)||n<0?{err:'«Порядок» — целое число'}:n}],['q','Вопрос',x=>x.q,v=>v||{err:'нет вопроса'}],['a','Ответ (шаги с новой строки)',x=>x.a,v=>v||{err:'нет ответа'}],
    ['sec','Раздел',x=>cphQSecL(x.sec),v=>{const e=CPH_QSEC.find(([,l])=>norm(l)===norm(v));return e?e[0]:{err:'«Раздел»: '+CPH_QSEC.map(x=>x[1]).join(', ')}}],
    ['act','Кнопка действия',x=>cphActNm(x.act),v=>{const e=CPH_ACTS.find(([,l])=>norm(l)===norm(v));return e?e[0]:{err:'«Кнопка действия»: '+CPH_ACTS.map(x=>x[1]).join(', ')}}],['on','Активен',x=>YN(x.on),ynIn('Активен')]],
  upd:(x,v)=>{const q=x._q;['q','a','sec','act','ord','on'].forEach(f=>{if(v[f]!=null)q[f]=v[f]})},snapAll:()=>structuredClone(CPH().faq),restore:o=>{CPH().faq=o},
  add:v=>{const H=CPH();H.faq=H.faq||[];H.faq.push({id:v.id,q:v.q,a:v.a,sec:v.sec||'',act:v.act||'',ord:v.ord??Math.max(0,...H.faq.map(y=>y.ord||0))+1,on:v.on!==false})}};
DX.cpgloss={title:'Страница контрагента: «Словарик»',key:'w',hint:'Колонку «Слово» не меняйте: по ней строки сопоставляются. Новое слово — новой строкой. Удаление через загрузку не делается — удалите слово в списке.',
  items:()=>(CPH().gloss||[]).map(g=>({w:g.w,x:g.x,also:g.also||'',_g:g})),
  cols:[['w','Слово',x=>x.w,v=>v],['x','Объяснение',x=>x.x,v=>v||{err:'нет объяснения'}],['also','Другие формы на странице',x=>x.also,v=>v]],
  upd:(x,v)=>{const g=x._g;if(v.x)g.x=v.x;if(v.also!=null){if(v.also)g.also=v.also;else delete g.also}},snapAll:()=>structuredClone(CPH().gloss),restore:o=>{CPH().gloss=o},
  add:v=>{const H=CPH();H.gloss=H.gloss||[];H.gloss.push({w:v.w,x:v.x,...(v.also?{also:v.also}:{})})}};
