'use strict';
// Админка: «Справочники платформы» → «БИК банков» (решение заказчика 14.11.2026). Ведёт администратор платформы; удалить БИК нельзя — только «Закрыт»
function renderBik(body,fresh,ioBar){const d=DICT.bik;const n=s=>d.items.filter(x=>x.status===s).length;
  body.innerHTML=`<div class="note">${ic('info')}<span>${d.src?`Источник: ${esc(d.src)}. `:''}Первые три цифры БИК — код банка, головной офис — «код001»; провайдер берётся из поля «Банк» или по «Коду банка в БИК» на вкладке «Банки». БИК не удаляется — ставится «Закрыт». Новую выгрузку НБКР вставьте через «Загрузить» как есть: перед записью видно новые, изменённые и закрытые БИК.</span></div>
    <div class="plates">${plate({id:'k1',icon:'list',color:'blue',label:'Всего БИК',value:d.items.length})}${plate({id:'k2',icon:'check',color:'green',label:'Активных',value:n('Активный')})}${plate({id:'k3',icon:'alert',color:'yellow',label:'С ограничениями или приостановлено',value:n('Введены ограничения')+n('Приостановлен')})}${plate({id:'k4',icon:'ban',color:'red',label:'Закрытых',value:n('Закрыт')})}</div>
    ${ioBar('bik')}<div id="pg"></div>${pdHistHtml('bik')}`;
  grid($('#pg',body),{id:'adm-bik',rid:x=>x.bik,cols:[
    {key:'bik',label:'БИК',type:'text',w:100,val:x=>x.bik,cls:'mono'},
    {key:'name',label:'Наименование',type:'text',w:330,val:x=>x.name,html:x=>`<span class="strong">${esc(x.name)}</span>`},
    {key:'type',label:'Тип участника',type:'enum',w:150,val:x=>x.type||''},
    {key:'bank',label:'Банк',type:'enum',w:190,val:x=>(bikProv(x)||{}).name||'',html:x=>{const p=bikProv(x);return p?esc(p.name):'<span class="faint">—</span>'}},
    {key:'status',label:'Статус',type:'enum',w:180,val:x=>x.status||'Не указан',html:x=>pill(x.status||'Не указан',BIK_STC)},
    {key:'succ',label:'БИК преемника',type:'text',w:130,val:x=>x.succ||'',cls:'mono'},
    {key:'addr',label:'Адрес',type:'text',w:320,val:x=>x.addr||''},
    {key:'swift',label:'БИК SWIFT',type:'text',w:120,val:x=>x.swift||'',cls:'mono',hide:true},
    {key:'used',label:'В реквизитах',type:'int',w:120,num:true,val:x=>bikUsed(x.bik),hide:true}],
    rows:()=>d.items,title:'name',noun:['БИК','БИК','БИК'],sort:{key:'bik',dir:1},rowClass:x=>x.status==='Закрыт'?'muted':'',open:x=>bikDlg(x),simulateLoad:fresh,fixedView:'table',
    actions:x=>[{label:'Изменить',icon:'edit',run:()=>bikDlg(x)},{sep:true},x.status!=='Закрыт'?{label:'Закрыть БИК',icon:'ban',danger:true,sub:'Удалить БИК нельзя: в реквизитах он покажет ошибку «БИК закрыт»',run:()=>bikDlg(x,true)}:{label:'Сделать активным',icon:'check',run:()=>{x.status='Активный';touch(x);pdLog(`БИК банков: ${x.bik} — статус «Закрыт» → «Активный»`,'bik');renderPage();toast('БИК снова активный')}}]})}
const BIK_FL={swift:'БИК SWIFT',type:'тип участника',name:'наименование',addr:'адрес',status:'статус',succ:'БИК преемника',bank:'банк'};
function bikDlg(x,close){const banks=DICT.banks.items.filter(b=>(b.type||'Банк')==='Банк'&&(b.active||x&&x.bank===b.code)).map(b=>[b.code,b.name+(b.bikCode?` · ${b.bikCode}`:'')]);
  openModal({form:true,render:()=>({title:close?`Закрыть БИК ${esc(x.bik)}`:x?`БИК ${esc(x.bik)}`:'Новый БИК',sub:x?esc(x.name):'Справочник платформы «БИК банков»',body:`<div class="form">
    ${fld('БИК',inp('bk-bik',x?x.bik:'',`class="inp mono" inputmode="numeric" maxlength="6" placeholder="124001" ${x?'disabled':''}`),{req:true,id:'bk-bik',hint:x?'БИК не меняется: для нового кода добавьте запись, а у старой поставьте «Закрыт» и «БИК преемника»':'6 цифр; первые три — код банка'})}
    ${fld('Тип участника',sel('bk-type',BIK_T,x?x.type:'Филиал банка'),{id:'bk-type'})}
    ${fld('Наименование',inp('bk-name',x?x.name:'','placeholder="Бишкекский филиал ОАО «…»"'),{req:true,full:true,id:'bk-name'})}
    ${fld('Адрес',inp('bk-addr',x?x.addr||'':''),{full:true,id:'bk-addr'})}
    ${fld('Статус',sel('bk-st',BIK_ST,close?'Закрыт':x&&x.status||'Активный'),{id:'bk-st'})}
    ${fld('БИК преемника',inp('bk-succ',x?x.succ||'':'','class="inp mono" inputmode="numeric" maxlength="6"'),{id:'bk-succ',hint:'Для закрытого БИК: в реквизитах предложат «Подставить» новый код'})}
    ${fld('Банк',sel('bk-bank',[['','— нет провайдера —'],...banks],x?x.bank||'':''),{id:'bk-bank',hint:'Провайдер из «Банков»; пусто — по «Коду банка в БИК»'})}
    ${fld('БИК SWIFT',inp('bk-swift',x?x.swift||'':'','class="inp mono" maxlength="11"'),{id:'bk-swift'})}</div>
    ${x&&bikUsed(x.bik)?`<div class="note warn">${ic('alert')}<span>БИК указан в ${bikUsed(x.bik)} ${plural(bikUsed(x.bik),'реквизите','реквизитах','реквизитах')} организаций. Статус «Закрыт» покажет там ошибку при следующем изменении счёта.</span></div>`:''}`,
    foot:`<button class="btn ghost" data-close>Отмена</button><button class="btn ${close?'danger':'cta'}" id="bk-ok">${close?'Закрыть БИК':'Сохранить'}</button>`,
    mount(el,m){$('#bk-ok',el).onclick=()=>{const c=x?x.bik:val(el,'bk-bik').trim(),s=val(el,'bk-succ').trim();
      const ok=[setErr(el,'bk-bik',x?'':!/^\d{6}$/.test(c)?'БИК — 6 цифр':bikFind(c)?'Такой БИК уже есть':''),setErr(el,'bk-name',val(el,'bk-name').trim()?'':'Введите наименование'),
        setErr(el,'bk-succ',!s?'':!/^\d{6}$/.test(s)?'БИК преемника — 6 цифр':s===c?'Совпадает с самим БИК':!bikFind(s)?'Такого БИК нет в справочнике':'')].every(Boolean);if(!ok)return;
      const v={type:val(el,'bk-type'),name:val(el,'bk-name').trim(),addr:val(el,'bk-addr').trim(),status:val(el,'bk-st'),succ:s,bank:val(el,'bk-bank'),swift:val(el,'bk-swift').trim().toUpperCase()};
      if(x){const ch=Object.keys(v).filter(f=>(x[f]||'')!==v[f]);if(!ch.length){m.close();return toast('Изменений нет')}
        const st=ch.includes('status')?` (статус «${x.status||'не указан'}» → «${v.status}»)`:'';Object.assign(x,v);touch(x);pdLog(`БИК банков: ${x.bik} — изменены поля: ${ch.map(f=>BIK_FL[f]).join(', ')}${st}`,'bik')}
      else{d_bikAdd(Object.assign({bik:c},v));pdLog(`БИК банков: добавлен ${c} «${v.name}»`,'bik')}
      m.close();renderPage();toast(close?'БИК закрыт':'Сохранено')}}})})}
const d_bikAdd=v=>DICT.bik.items.push(born(Object.assign({swift:'',type:'Филиал банка',name:'',addr:'',status:'Активный',succ:'',bank:''},v)));
