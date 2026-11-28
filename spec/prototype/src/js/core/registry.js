'use strict';
// Реестр модулей (BIZ, ADM) и роутер #модуль.вкладка; подключается после всех модулей
/* ═════════════ Module registry ═════════════ */
const BIZ=[
 {id:'home',title:'Главная',short:'Главная',icon:'home',desc:'Что горит сегодня: просрочки, сроки недели, ваши задачи.',tabs:homeTabs,render:renderHome},
 {id:'cps',title:'Контрагенты',short:'Контрагенты',icon:'building',desc:'Ваши клиенты: реквизиты, ответственный, отчёты, деньги.',tabs:cpsTabs,add:cpsAdd,perm:'cpView',render:renderCps},
 {id:'reports',title:'Отчеты для сдачи',short:'Отчёты',icon:'file',desc:'Все отчёты клиентов: сроки, статусы, суммы к уплате.',tabs:repTabs,add:repAdd,perm:'repView',render:renderReports},
 {id:'fin',title:'Финансовые операции по контрагентам',short:'Финансы',icon:'coins',desc:'Все деньги клиентов: поступления, оплаты налогов, обслуживание.',tabs:finTabs,add:finAdd,perm:'finView',render:renderFin,feature:'finops'},
 {id:'projects',title:'Проекты контрагентов',short:'Проекты',icon:'briefcase',desc:'Разовые работы за отдельную плату: сроки, оплата, файлы.',tabs:projTabs,add:projAdd,perm:'projView',render:renderProjects,feature:'projects'},
 {id:'kpi',title:'Показатели контрагентов',short:'Показатели',icon:'gauge',desc:'Выручка, численность и свои показатели клиентов по месяцам.',feature:'indicators',tabs:kpiTabs,add:kpiAdd,perm:'kpiView',render:renderKpi},
 {id:'tasks',title:'Задачи',short:'Задачи',icon:'task',desc:'Поручения сотрудникам и контроль их выполнения.',feature:'tasks',tabs:taskTabs,add:taskAdd,render:renderTasks},
 {id:'files',title:'Файловый менеджер',short:'Файлы',icon:'folder',desc:'Все файлы организации; у каждого видно, откуда он.',feature:'files',add:filesAdd,perm:'filesView',tabs:filesTabs,render:renderFiles},
 {id:'dm',title:'Витрина данных',short:'Витрина',icon:'table',desc:'Отчёты по готовым шаблонам в таблице как в Excel и выдача тех же данных внешним программам по API-токену.',perm:'dmView',tabs:dmTabs,add:dmAdd,render:renderDm},
 {id:'staff',title:'Сотрудники',short:'Сотрудники',icon:'users',desc:'Сотрудники организации, их роли и права, закреплённые контрагенты и виртуальные счета.',perm:'staffView',tabs:staffTabs,add:staffAdd,render:renderStaff},
 {id:'dicts',title:'Справочники',short:'Справочники',icon:'book',desc:'Какие отчёты вы ведёте и общие списки платформы.',tabs:()=>[{id:'types',label:'Виды отчётов',icon:'file'},{id:'platform',label:'Справочники платформы',icon:'lock'}],add:()=>[can('dicts')?{label:'Подключить из каталога',icon:'plus',btn:true,run:txDlg}:null,{label:'Попросить добавить',icon:'send',run:reqDictPick},{label:'Мои запросы',icon:'msg',run:()=>reqMyDlg()}],render:renderDicts},
 {id:'org',title:'Моя организация',short:'Организация',icon:'landmark',desc:'Основные сведения и реквизиты организации, учётная политика и настройки. Редактирует владелец.',tabs:orgTabs,render:renderOrg},
 {id:'kb',title:'База знаний',short:'База знаний',icon:'grad',desc:'Уроки, статьи и видео о работе в программе.',tabs:kbTabs,render:renderKB},
];
const ADM=[
 {id:'accounts',title:'Учётные записи',short:'Учётки',icon:'user',desc:'Все пользователи платформы: сброс пароля, блокировка и разблокировка.',render:renderAccounts},
 {id:'orgs',title:'Организации',short:'Организации',icon:'building',desc:'Организации-клиенты платформы: создание вместе с владельцем, блокировка; заявки с лендинга buhuchet.kg.',tabs:()=>[{id:'list',label:'Организации',icon:'building'},{id:'act',label:'Активность',icon:'chart'},{id:'leads',label:'Заявки',icon:'send',count:leadNew()},{id:'subs',label:'Подписки',icon:'wallet',count:subWaitN()}],add:()=>[{label:'Организация',icon:'building',run:addOrgDlg}],render:renderOrgs},
 {id:'reqs',title:'Запросы',short:'Запросы',icon:'msg',desc:'Запросы пользователей организаций: вопросы, ошибки, опечатки и запросы в справочники — с перепиской, статусами и уведомлениями.',tabs:reqAdmTabs,render:renderReqAdm},
 {id:'afiles',title:'Файлы',short:'Файлы',icon:'folder',desc:'Хранилище платформы: сколько занято, чьи файлы и откуда, просмотр любого файла; удалённые файлы ждут стирания сутки, раз в сутки база сверяется с хранилищем.',tabs:afTabs,render:renderAFiles},
 {id:'dm',title:'Витрина данных',short:'Витрина',icon:'table',desc:'Шаблоны отчётов на SQL для организаций и платформы, их вывод, API-токены и журнал запросов.',tabs:dmTabs,add:dmAdd,render:renderDm},
 {id:'pdicts',title:'Справочники платформы',short:'Справочники',icon:'book',desc:'Общие списки для всех организаций. Использованное значение нельзя удалить, только отключить. Каждое изменение пишется в историю.',tabs:pdTabs,add:pdAdd,render:renderPDicts},
 {id:'l10n',title:'Локализация',short:'Языки',icon:'globe',desc:'Словарь текстов интерфейса. Сейчас включён только русский язык; добавление других заложено в логику.',render:renderL10n},
 {id:'kb',title:'База знаний',short:'База знаний',icon:'grad',desc:'Уроки, статьи и видео о работе в программе.',tabs:kbTabs,render:renderKB},
 {id:'kbadm',title:'База знаний (содержимое)',short:'Обучение',icon:'layers',desc:'Содержимое «Базы знаний» для всех организаций: статьи, шаги уроков с правами и условиями отметки, уровни. Организации его только проходят.',tabs:kbAdmTabs,add:kbAdmAdd,render:renderKbAdm},
 {id:'tdocs',title:'Техническая документация',short:'Документация',icon:'db',desc:'Схема базы данных (ER-диаграмма) и описание API продукта со связями: какой метод какие таблицы читает и меняет, какой SQL выполняет. Только просмотр.',tabs:()=>[{id:'db',label:'Схема базы',icon:'db'},{id:'api',label:'API',icon:'code'}],render:renderTdocs},
 {id:'runs',title:'Запуски',short:'Запуски',icon:'clock',desc:'Задачи по расписанию и журнал их запусков: что запускалось, когда, с каким итогом и ошибкой. Только просмотр: запустить задачу или изменить расписание отсюда нельзя.',tabs:()=>[{id:'jobs',label:'Задачи',icon:'list'},{id:'runs',label:'Запуски',icon:'history'}],render:renderRuns},
 {id:'tg',title:'Телеграм',short:'Телеграм',icon:'tg',desc:'Бот платформы: переписка в обе стороны с текстом сообщений, ошибки и повтор отправки, рассылка объявлений и новостей оформленным сообщением.',tabs:()=>[{id:'log',label:'Журнал',icon:'list'},{id:'bot',label:'Бот платформы',icon:'tg'},{id:'cast',label:'Рассылка',icon:'send'}],add:()=>[{label:'Объявление',icon:'send',run:()=>go('tg','cast')}],render:renderTg},
];
const mods=()=>isAdmin()?ADM:subLockMods()||BIZ.filter(m=>(!m.feature||feat(m.feature))&&(!m.perm||can(m.perm))&&(m.id!=='fin'||taxVis()||moneyVis()));
const curMod=()=>{const l=mods();return l.find(m=>m.id===S.mod)||l[0]};
function modTabs(m){return m.tabs?m.tabs().filter(Boolean):[]}

/* ═════════════ Router: #module.tab ═════════════ */
function parseHash(){const h=location.hash.replace(/^#/,'');const[a,b]=h.split('.');return {mod:a||'',tab:b||''}}
// Заглушка «Назад» (ovOpen в popups.js): окно закрыли и сразу переходим — переход заменяет её; окно или показ ещё открыты — она остаётся сверху с новым адресом
function go(mod,tab,preset){if(OV.skip){OV.next=[mod,tab,preset];return}S.preset=preset||null;const h='#'+mod+(tab?'.'+tab:'');if(location.hash===h)route();else if(ovStale()){clearTimeout(OV.t);location.replace(h)}
  else if(ovAny()&&history.state&&history.state.ov){history.replaceState(history.state,'',h);route()}else location.hash=h}
function route(){
  // #video/<код> — ссылка «Скопировать ссылку» на видео: вкладка «Видео» Базы знаний с окном видео
  if(/^#video\//.test(location.hash))vidRoute();
  // #accounts/<логин>, #orgs/<адрес организации> — карточка пользователя или организации в Админке
  if(/^#(accounts|orgs)\//.test(location.hash))admCardRoute();
  // #/<адрес организации>/inn/<ИНН> — страница контрагента по ссылке, открывается поверх программы
  if(pubRoute())return;if(PUB.open)pubHide();
  // #landing — лендинг buhuchet.kg для гостей, открывается поверх программы и страницы входа
  if(landRoute())return;if(LAND.open)landHide();
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

