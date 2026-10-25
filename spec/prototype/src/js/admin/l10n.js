'use strict';
// Админка: «Локализация»
const L10N=DB.ref.localization;
const L10N_MOD={'nav.home':'home','nav.counterparties':'cps','nav.reports':'reports','nav.tasks':'tasks','nav.staff':'staff'};
function l10nApply(x){const id=L10N_MOD[x.key];if(id){const m=BIZ.find(b=>b.id===id);if(m){m.title=x.ru;m.short=x.ru}}if(x.key==='kb.title')[...BIZ,...ADM].filter(m=>m.id==='kb').forEach(m=>{m.title=x.ru;m.short=x.ru})}
function renderL10n(body,tab,fresh){
  body.innerHTML=`<div class="plates">${plate({id:'ru',icon:'globe',color:'green',label:'Русский',value:'100 %',sub:'язык по умолчанию · включён'})}<button class="plate" data-plate="add" disabled style="opacity:.6;cursor:not-allowed"><span class="pl-top"><span class="pl-dot">${ic('plus')}</span>Добавить язык</span><span class="pl-sub">Заложено в логику, пока не используется. Выбор языка в профиле появится, когда языков станет больше одного.</span></button></div><div class="note">${ic('info')}<span>Изменённый текст применяется без изменения кода. В макете сразу видны названия модулей (nav.*) и название «Базы знаний» (kb.title), остальные тексты подставятся в рабочей версии.</span></div><div id="lg"></div>`;
  grid($('#lg',body),{id:'l10n',rid:x=>x.key,cols:[{key:'key',label:'Ключ',type:'text',w:220,val:x=>x.key,cls:'mono'},{key:'ru',label:'Русский текст',type:'text',w:340,val:x=>x.ru},{key:'sec',label:'Раздел',type:'enum',w:120,val:x=>x.sec}],rows:()=>L10N,title:'ru',noun:['строка','строки','строк'],sort:{key:'sec',dir:1},simulateLoad:fresh,
    open:x=>openModal({form:true,render:()=>({title:'Текст интерфейса',sub:`<span class="mono">${esc(x.key)}</span>`,body:fld('Русский',`<textarea class="inp" id="ln-v" style="min-height:70px">${esc(x.ru)}</textarea>`,{id:'ln-v',hint:'Изменение применится без изменения кода'}),foot:'<button class="btn ghost" data-close>Отмена</button><button class="btn cta" id="ln-ok">Сохранить</button>',mount(el,m){$('#ln-ok',el).onclick=()=>{x.ru=val(el,'ln-v');touch(x);l10nApply(x);m.close();renderPage();toast('Текст сохранён')}}})}),
    actions:x=>[{label:'Изменить текст',icon:'edit',run:()=>$(`[data-id="${CSS.escape(x.key)}"]`).click()}]});
}
