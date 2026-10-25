'use strict';
// Пустые состояния и первый вход
/* ═════════════ Пустые состояния и первый вход ═════════════ */
// First-run empty states per module (ТЗ «Пустые состояния и первый вход»); shown only when the module has no data at all.
function firstEmpty(){const needCp=f=>()=>CPS.length?f():(toast('Сначала добавьте контрагента','info'),go('cps'));
  const F={
  cps:()=>!CPS.length&&{icon:'building',title:'Здесь будут ваши клиенты',text:'Добавьте контрагентов по одному или загрузите сразу списком из Excel.',btns:[can('createCp')&&['Добавить контрагента','plus',addCpDlg,1],can('cpImport')&&['Загрузить из Excel','paste',importDlg]]},
  reports:()=>!REPORTS.length&&{icon:'file',title:'Отчёты появятся, когда вы назначите виды отчётов контрагентам',text:'Отчёты создаются сами по назначенным видам и срокам, вручную их заводить не нужно.',btns:[['Перейти к контрагентам','building',()=>go('cps'),1]]},
  tasks:()=>!allTasks().length&&{icon:'task',title:'Регулярные задачи создадутся сами по отчётам; ручную задачу можно поставить сейчас',btns:[can('tasksCreate')&&['Добавить','plus',()=>taskDlg(),1]]},
  fin:()=>!OPS.length&&!FEEPAYS.length&&!SERVICES.length&&{icon:'coins',title:'Поступления и оплаты налогов появятся после первого приёма денег',btns:[taxVis()&&['Принять деньги','wallet',needCp(()=>inDlg()),1]]},
  projects:()=>!PROJECTS.length&&{icon:'briefcase',title:'Проекты — разовые работы для контрагента за отдельную плату',text:'Здесь будут сроки, ответственные, работы и оплаты по каждому проекту.',btns:[can('projects')&&['Добавить','plus',needCp(()=>projectDlg()),1]]},
  kpi:()=>!visCps().length&&{icon:'gauge',title:'Показатели вносятся по контрагентам',text:'Добавьте первого контрагента — и здесь можно будет вести его выручку, численность и другие показатели по месяцам.',btns:[['Перейти к контрагентам','building',()=>go('cps'),1]]},
  files:()=>!FILES.length&&{icon:'folder',title:'Здесь будут все файлы организации',text:'Отчёты, квитанции и документы, прикреплённые в любом модуле, собираются сюда сами.',btns:[['Добавить','plus',()=>uploadDlg(),1]]}};
  const f=F[S.mod];return f?f()||null:null}
function feHtml(e){return `<div class="state fe">${ic(e.icon,'lg')}<b>${esc(e.title)}</b>${e.text?`<span>${esc(e.text)}</span>`:''}<div class="row" style="justify-content:center">${e.btns.filter(Boolean).map((b,i)=>`<button class="btn ${b[3]?'cta':''}" data-a="fe" data-i="${i}">${ic(b[1])}${esc(b[0])}</button>`).join('')}</div></div>`}
// Small ⓘ next to complex fields and buttons.
const tipI=t=>`<button type="button" class="icon-btn sm tipi" data-tip="${esc(t)}" aria-label="Пояснение">${ic('info','sm')}</button>`;
document.addEventListener('click',e=>{const b=e.target.closest('.tipi');if(!b)return;e.preventDefault();e.stopPropagation();openPop(b,`<div style="padding:6px 8px;font-size:13px;line-height:1.5;max-width:300px">${esc(b.dataset.tip)}</div>`)},true);

