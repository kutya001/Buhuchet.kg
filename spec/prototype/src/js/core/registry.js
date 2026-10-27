'use strict';
// Реестр модулей (BIZ, ADM) и роутер #модуль.вкладка; подключается после всех модулей
/* ═════════════ Module registry ═════════════ */
const BIZ=[
 {id:'home',title:'Главная',short:'Главная',icon:'home',desc:'Сводка на сегодня: просроченные отчёты и оплаты, что сдать и оплатить на этой неделе и ваши задачи. Каждая плашка открывает нужный список с уже применённым фильтром. Вкладка «Аналитика» — выручка по контрагентам (видна с правом на плату за обслуживание).',tabs:homeTabs,render:renderHome},
 {id:'cps',title:'Контрагенты',short:'Контрагенты',icon:'building',desc:'Компании на обслуживании: реквизиты, ответственный бухгалтер, назначенные отчёты, деньги на налоги и плата за обслуживание.',tabs:cpsTabs,add:cpsAdd,perm:'cpView',render:renderCps},
 {id:'reports',title:'Отчеты для сдачи',short:'Отчёты',icon:'file',desc:'Все отчёты контрагентов по периодам: сроки сдачи и оплаты, статусы, суммы к уплате и сверка денег. Отчёты создаются автоматически по назначениям.',tabs:repTabs,add:repAdd,perm:'repView',render:renderReports},
 {id:'fin',title:'Финансовые операции по контрагентам',short:'Финансы',icon:'coins',desc:'Единый журнал всех денег от контрагентов: поступления на налоги, оплаты налогов, оплаты за обслуживание, проекты, разовые услуги, списания и возвраты. Отдельная вкладка — журнал поступлений с детализацией.',tabs:finTabs,add:finAdd,perm:'finView',render:renderFin,feature:'finops'},
 {id:'projects',title:'Проекты контрагентов',short:'Проекты',icon:'briefcase',desc:'Разовые работы по контрагенту за отдельную плату: сроки, несколько ответственных, работы, задачи, оплата траншами и файлы.',tabs:projTabs,add:projAdd,perm:'projView',render:renderProjects,feature:'projects'},
 {id:'kpi',title:'Показатели контрагентов',short:'Показатели',icon:'gauge',desc:'Помесячные показатели контрагентов — выручка, численность и свои показатели организации: быстрый ввод за месяц, итоги за период (сумма, среднее, максимум, минимум) и контроль незаполненных.',feature:'indicators',tabs:kpiTabs,add:kpiAdd,perm:'kpiView',render:renderKpi},
 {id:'tasks',title:'Задачи',short:'Задачи',icon:'task',desc:'Ручные задачи от старших и регулярные задачи по каждому отчёту. Регулярная задача закрывается сама, когда отчёт «Сдан» и сдача подтверждена.',feature:'tasks',tabs:taskTabs,add:taskAdd,render:renderTasks},
 {id:'files',title:'Файловый менеджер',short:'Файлы',icon:'folder',desc:'Все файлы организации в одном месте: прикреплённые к отчётам, контрагентам, задачам, оплатам, финансовым операциям и проектам, а также загруженные вручную. У каждого файла виден источник.',feature:'files',add:filesAdd,perm:'filesView',render:renderFiles},
 {id:'staff',title:'Сотрудники',short:'Сотрудники',icon:'users',desc:'Сотрудники организации, их роли и права, закреплённые контрагенты и виртуальные счета.',perm:'staffView',tabs:staffTabs,add:staffAdd,render:renderStaff},
 {id:'dicts',title:'Справочники',short:'Справочники',icon:'book',desc:'Виды отчётов из единого каталога платформы, которые подключила организация, и справочники платформы для просмотра.',tabs:()=>[{id:'types',label:'Виды отчётов',icon:'file'},{id:'platform',label:'Справочники платформы',icon:'lock'}],add:()=>[can('dicts')?{label:'Подключить из каталога',icon:'plus',btn:true,run:txDlg}:null,{label:'Попросить добавить',icon:'send',run:requestDlg},{label:'Мои запросы',icon:'list',run:myReqDlg}],render:renderDicts},
 {id:'org',title:'Моя организация',short:'Организация',icon:'landmark',desc:'Основные сведения и реквизиты организации, учётная политика и настройки. Редактирует владелец.',tabs:()=>[{id:'main',label:'Основное',icon:'landmark'},{id:'policy',label:'Учётная политика',icon:'sliders'},{id:'settings',label:'Настройки',icon:'gauge'}],render:renderOrg},
 {id:'kb',title:'База знаний',short:'База знаний',icon:'grad',desc:'Обучение работе с системой: уроки с практикой по вашим правам, статьи инструкции и ваш уровень знаний — от «Новичка» до «Эксперта».',tabs:kbTabs,render:renderKB},
];
const ADM=[
 {id:'accounts',title:'Учётные записи',short:'Учётки',icon:'user',desc:'Все пользователи платформы: сброс пароля, блокировка и разблокировка.',render:renderAccounts},
 {id:'orgs',title:'Организации',short:'Организации',icon:'building',desc:'Организации-клиенты платформы: создание вместе с владельцем, блокировка.',add:()=>[{label:'Организация',icon:'building',run:addOrgDlg}],render:renderOrgs},
 {id:'pdicts',title:'Справочники платформы',short:'Справочники',icon:'book',desc:'Общие списки для всех организаций. Использованное значение нельзя удалить, только отключить. Каждое изменение пишется в историю.',tabs:pdTabs,add:pdAdd,render:renderPDicts},
 {id:'l10n',title:'Локализация',short:'Языки',icon:'globe',desc:'Словарь текстов интерфейса. Сейчас включён только русский язык; добавление других заложено в логику.',render:renderL10n},
 {id:'kb',title:'База знаний',short:'База знаний',icon:'grad',desc:'Обучение работе с системой: уроки с практикой по вашим правам, статьи инструкции и ваш уровень знаний — от «Новичка» до «Эксперта».',tabs:kbTabs,render:renderKB},
 {id:'kbadm',title:'База знаний (содержимое)',short:'Обучение',icon:'layers',desc:'Содержимое «Базы знаний» для всех организаций: статьи, шаги уроков с правами и условиями отметки, уровни. Организации его только проходят.',tabs:kbAdmTabs,add:kbAdmAdd,render:renderKbAdm},
 {id:'tg',title:'Телеграм',short:'Телеграм',icon:'tg',desc:'Бот платформы: журнал отправленных сообщений и ошибок, повтор отправки, рассылка объявлений.',tabs:()=>[{id:'log',label:'Журнал',icon:'list'},{id:'bot',label:'Бот платформы',icon:'tg'},{id:'cast',label:'Рассылка',icon:'send'}],add:()=>[{label:'Объявление',icon:'send',run:()=>go('tg','cast')}],render:renderTg},
];
const mods=()=>isAdmin()?ADM:BIZ.filter(m=>(!m.feature||feat(m.feature))&&(!m.perm||can(m.perm))&&(m.id!=='fin'||taxVis()||moneyVis()));
const curMod=()=>{const l=mods();return l.find(m=>m.id===S.mod)||l[0]};
function modTabs(m){return m.tabs?m.tabs().filter(Boolean):[]}

/* ═════════════ Router: #module.tab ═════════════ */
function parseHash(){const h=location.hash.replace(/^#/,'');const[a,b]=h.split('.');return {mod:a||'',tab:b||''}}
// Заглушка «Назад» (ovOpen в popups.js): окно закрыли и сразу переходим — переход заменяет её; окно или показ ещё открыты — она остаётся сверху с новым адресом
function go(mod,tab,preset){if(OV.skip){OV.next=[mod,tab,preset];return}S.preset=preset||null;const h='#'+mod+(tab?'.'+tab:'');if(location.hash===h)route();else if(ovStale()){clearTimeout(OV.t);location.replace(h)}
  else if(ovAny()&&history.state&&history.state.ov){history.replaceState(history.state,'',h);route()}else location.hash=h}
function route(){
  // #/<адрес организации>/inn/<ИНН> — страница контрагента по ссылке, открывается поверх программы
  if(pubRoute())return;if(PUB.open)pubHide();
  const {mod,tab}=parseHash();const l=mods();const m=l.find(x=>x.id===mod)||l[0];
  const tabs=modTabs(m);const t=tabs.find(x=>x.id===tab)||tabs[0];
  const changed=S.mod!==m.id||S.tab!==(t&&t.id);
  S.mod=m.id;S.tab=t?t.id:null;
  if(changed){clearSearch();$('#topbar').classList.remove('searching')}
  if(!changed&&!S.preset){renderShell();return}
  renderShell(true);
  if(location.hash!=='#'+S.mod+(S.tab?'.'+S.tab:''))history.replaceState(history.state,'','#'+S.mod+(S.tab?'.'+S.tab:''));
}
addEventListener('hashchange',route);

