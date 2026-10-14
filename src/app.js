// Formwright application: navigation, record screens and the form designer.
import './designer.css';
import './grids.css';
// Admin screens (users and groups) live in admin.js; data access in store.js.

import { store, uploadFile, deleteFormCascade, loadExamples as writeExamples, watchTasks, setTaskDone, saveRecordBundle, recomputeAllAccess } from './store.js';
import { cadenceUrl } from './firebase.js';
import { parseRoute, routeFor } from './route.js';
import { initReports, viewReportsList, viewReport, reportName, leaveReport, reportBusy, viewDashboards, viewDashboard, dashName, maybeMigrate, reportDirty, dashDirty, forgetDrafts, counts } from './dash.js';
import { initLists, viewRecords, afterRecords, resetLists } from './lists.js';
import { initImports, viewImport, viewImports, importBusy, importRunning, importTitle, resetImports } from './imports.js';
import { sortTasks, dueInfo, whoLine, cadenceLink, donePatch, repeats, repeatLabel, dateKey } from './tasks.js';
import { FX } from './formulas.js';
import { isAdmin, formLevel, canViewForm, canCreate, canEditRecord } from './access.js';
import * as admin from './admin.js';
import { signOutUser } from './auth.js';
import { $, esc, uid, clone, isEmpty, toast, COLORS, colorOf, itemName, badge } from './ui.js';
import examples from './examples.json';

const ADMIN_VIEWS = new Set(['designer', 'formEdit', 'users', 'groups', 'groupEdit', 'import', 'imports']);

const TYPES=[
 ['text','Short text','Aa','Text'],['textarea','Long text','¶','Text'],
 ['email','Email','@','Contact'],['phone','Phone','+1','Contact'],['url','Website','//','Contact'],['location','Location','⌖','Contact'],
 ['number','Whole number','12','Numbers'],['decimal','Decimal','1.5','Numbers'],['currency','Currency','$','Numbers'],['percent','Percent','%','Numbers'],['rating','Rating','★','Numbers'],['range','Slider','⟷','Numbers'],['formula','Calculation','ƒx','Numbers'],
 ['date','Date','D','Date & time'],['time','Time','T','Date & time'],['datetime','Date & time','DT','Date & time'],
 ['checkbox','Yes / No','✓','Choices'],['select','Dropdown','▾','Choices'],['radio','Single choice','◉','Choices'],['multiselect','Multiple choice','☰','Choices'],
 ['file','File upload','⇪','Media'],['image','Photo','▣','Media'],['signature','Signature','✎','Media'],['color','Color','◐','Media'],
 ['relation','Link to record','↗','Relations'],['heading','Section heading','§','Layout']];
const T=Object.fromEntries(TYPES.map(t=>[t[0],{label:t[1],glyph:t[2],group:t[3]}]));
const CHOICE=new Set(['select','radio','multiselect']);
const NUMERIC=new Set(['number','decimal','currency','percent','range','rating']);
const PLACEHOLDER=new Set(['text','textarea','email','phone','url','number','decimal','currency','percent']);
const NOCOL=new Set(['heading','signature','textarea']);

/* ---------- Lookups ---------- */
const formById=id=>store.forms.find(f=>f.id===id);
const recById=id=>store.records.find(r=>r.id===id);
const byOrder=(a,b)=>(a.order??0)-(b.order??0)||a.name.localeCompare(b.name);
function titleFieldOf(form){
  const fs=(form.fields||[]);
  return fs.find(f=>f.id===form.titleField)||fs.find(f=>['text','email','phone','url'].includes(f.type))||fs.find(f=>f.type!=='heading');
}
function recTitle(rec,form){
  form=form||formById(rec.formId); if(!form)return 'Untitled';
  const f=titleFieldOf(form); const t=f?fmt(f,valOf(f,rec)):'';
  return t||('Untitled '+itemName(form).toLowerCase());
}
const parentsOf=formId=>store.forms.filter(f=>(f.children||[]).some(c=>c.formId===formId)).sort(byOrder);
const recordsOf=formId=>store.records.filter(r=>r.formId===formId);

function fmt(f,v){
  if(f.type!=='formula'&&isEmpty(v))return '';
  try{switch(f.type){
    case 'formula':return fmtCalc(f,v);
    case 'checkbox':return v?'Yes':'No';
    case 'decimal':return Number(v).toLocaleString(undefined,{minimumFractionDigits:f.decimals??2,maximumFractionDigits:f.decimals??2});
    case 'number':return Number(v).toLocaleString();
    case 'currency':return new Intl.NumberFormat(undefined,{style:'currency',currency:(f.currency||'USD').toUpperCase()}).format(v);
    case 'percent':return v+'%';
    case 'range':return v+(f.suffix||'');
    case 'rating':return '★'.repeat(v)+'☆'.repeat(Math.max(0,(f.max||5)-v));
    case 'multiselect':return v.join(', ');
    case 'location':return v.address||(v.lat!=null?`${v.lat}, ${v.lng}`:'');
    case 'file':case 'image':return v.name||'File';
    case 'signature':return 'Signed';
    case 'relation':{const r=recById(v);return r?recTitle(r):'(removed)';}
    case 'date':return new Date(v+'T00:00').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
    case 'datetime':return new Date(v).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    default:return String(v);
  }}catch(e){return String(v)}
}
function curSym(code){try{return new Intl.NumberFormat(undefined,{style:'currency',currency:(code||'USD').toUpperCase()}).formatToParts(0).find(p=>p.type==='currency').value}catch(e){return code||'$'}}
const fsize=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':(n/1048576).toFixed(1)+' MB';
function mapUrl(v){if(!v)return '';if(v.lat!=null&&v.lng!=null&&v.lat!==''&&v.lng!=='')return `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lng}`;if(v.address)return 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(v.address);return '';}


/* ---------- Calculations ---------- */
const lc=s=>String(s||'').trim().toLowerCase();
function fieldByName(form,name){const n=lc(name);return (form?.fields||[]).find(f=>f.type!=='heading'&&(lc(f.label)===n||f.id===name));}
function rawFor(f,rec,form,depth,check){
  if(f.type==='formula')return evalFormula(form,f,rec,depth+1,check);
  const v=rec.values?.[f.id];
  if(f.type==='relation'){const r=v&&recById(v);return r?recTitle(r):'';}
  if(f.type==='location')return v?.address||'';
  if(f.type==='file'||f.type==='image')return v?.name||'';
  return v??null;
}
function evalFormula(form,f,rec,depth=0,check=false){
  if(depth>20)throw FX.E('These calculations refer to each other in a loop.');
  const ast=FX.parse(f.expr||'');
  const ctx={check,
    ref:name=>{const g=fieldByName(form,name);if(!g)throw FX.E(`There is no field called {${name}} on this form.`);if(g.id===f.id)throw FX.E('A calculation can’t use itself.');return rawFor(g,rec,form,depth,check)},
    family:(fn,a)=>{
      if(fn==='PARENT'){const g=a[0];const p=rec._parentDraft?draftRec(rec._parentDraft):(rec.parentId&&recById(rec.parentId));if(!p){if(check)return 0;return null}const pf=formById(p.formId);const pg=fieldByName(pf,g);if(!pg)throw FX.E(`The parent form has no field called “${g}”.`);return rawFor(pg,p,pf,depth,check)}
      const cf=store.forms.find(x=>lc(x.name)===lc(a[0]))||(check&&fdraft&&lc(fdraft.name)===lc(a[0])?fdraft:null);
      if(!cf)throw FX.E(`There is no form called “${a[0]}”.`);
      const dg=rec._draft?.grids?.[cf.id];
      const kids=dg?dg.rows.map(r=>rowRec(r,cf,rec._draft)):rec.id?store.records.filter(r=>r.parentId===rec.id&&r.formId===cf.id):[];
      if(fn==='CHILDCOUNT')return kids.length;
      const g=fieldByName(cf,a[1]);if(!g)throw FX.E(`${cf.name} has no field called “${a[1]}”.`);
      const vals=kids.map(k=>FX.num(rawFor(g,k,cf,depth,check)));
      if(fn==='CHILDSUM')return vals.reduce((s,x)=>s+x,0);
      if(fn==='CHILDAVG')return vals.length?vals.reduce((s,x)=>s+x,0)/vals.length:0;
      if(fn==='CHILDMIN')return vals.length?Math.min(...vals):0;
      return vals.length?Math.max(...vals):0;
    }};
  return FX.ev(ast,ctx);
}
function calc(form,f,rec){try{const v=evalFormula(form,f,rec);return (typeof v==='number'&&!isFinite(v))?{e:'The result is too large or undefined.'}:{v}}catch(e){return {e:e.fx?e.message:'This formula could not be worked out.'}}}
function valOf(f,rec,form){if(f.type!=='formula')return rec.values?.[f.id];form=form||formById(rec.formId);const r=calc(form,f,rec);return r.e?null:r.v;}
function fmtCalc(f,v){
  if(v==null||v==='')return '';
  if(typeof v==='boolean')return v?'Yes':'No';
  if(typeof v!=='number'||f.format==='text')return String(v);
  const d=f.decimals??2;
  try{switch(f.format){
    case 'number':return v.toLocaleString(undefined,{maximumFractionDigits:d});
    case 'currency':return new Intl.NumberFormat(undefined,{style:'currency',currency:(f.currency||'USD').toUpperCase()}).format(v);
    case 'percent':return v.toLocaleString(undefined,{maximumFractionDigits:d})+'%';
    case 'days':return v.toLocaleString()+(Math.abs(v)===1?' day':' days');
    default:return v.toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});
  }}catch(e){return String(v)}
}

/* ---------- State ---------- */
let view={name:'loading'},hist=[],rdraft=null,fdraft=null,pdraft=null;
const ui={search:'',openField:null,tab:'fields',palette:false,confirm:null,leaveOk:false};

function dirty(){return (view.name==='record'&&rdraft?.dirty)||(view.name==='formEdit'&&fdraft?.dirty)||(view.name==='report'&&reportDirty(view.reportId))||(view.name==='dashboard'&&dashDirty(view.dashboardId))||admin.isDirty(view)}
function guard(){if(importRunning()){toast('The import is still running. Wait for it to finish.');return false;}if(dirty()&&!ui.leaveOk){ui.leaveOk=true;toast('You have unsaved changes. Tap again to leave without saving.');setTimeout(()=>ui.leaveOk=false,4000);return false;}ui.leaveOk=true;return true;}
export function goRec(draft,v){if(!guard())return;rdraft=draft;go(v);}
export function go(v,push=true){
  if(ADMIN_VIEWS.has(v.name)&&!isAdmin(store.me)){toast('Only administrators can open that.');return false;}
  if((v.name==='records'||v.name==='record')&&!canViewForm(store.me,v.formId)){toast('You don’t have access to that form.');return false;}
  if(!guard())return false;
  ui.leaveOk=false;ui.confirm=null;
  if(view.name==='report')leaveReport();
  if((view.name==='report'&&reportDirty(view.reportId))||(view.name==='dashboard'&&dashDirty(view.dashboardId)))forgetDrafts();
  if(v.name==='record'||v.name==='records')cdraft=null;
  if(push&&view.name!=='loading')hist.push(view);
  view=v;closeMenu();syncHash();
  if(v.name==='records'){ui.search='';}
  if(v.name==='formEdit'){ui.tab=v.tab||'fields';ui.openField=null;ui.palette=false;}
  render();window.scrollTo(0,0);return true;
}
export function back(){if(!guard())return;const v=hist.pop();if(v){if(v.name==='record')rdraft=null;go(v,false)}else home()}
function sidebarForms(){return store.forms.filter(f=>f.showInSidebar&&canViewForm(store.me,f.id)).sort(byOrder);}
export function home(){
  const fs=sidebarForms();
  ui.leaveOk=true;
  const hd=store.profiles[store.user?.uid]?.homeDashboard;
  if(hd){go({name:'dashboard',dashboardId:hd},false);return;}
  if(fs.length)go({name:'records',formId:fs[0].id},false);
  else if(isAdmin(store.me))go({name:'designer'},false);
  else go({name:'welcome'},false);
}
let booted=false,pendingRoute=null,homeCheck=false;
/* ---------- Web addresses (#/record/<id>, #/form/<id>) ---------- */
// The address follows the screen without adding browser history; the in-app Back
// button keeps its own history. Links from Cadence open a record directly.
function syncHash(){
  const h=routeFor(view);
  if((location.hash||'')===h)return;
  history.replaceState(null,'',location.pathname+location.search+h);
}
/** Open the screen an address names. Returns true once handled (opened, refused or given up). */
function openRoute(r){
  if(!r)return true;
  if(r.kind==='reports'){go({name:'reports'},false);return true;}
  if(r.kind==='dashboards'){go({name:'dashboards'},false);return true;}
  if(r.kind==='dashboard'){
    if(!store.dashboards.some(x=>x.id===r.id)){
      if(!store.dashReady)return false; // still arriving
      toast('That dashboard isn’t available. It may have been deleted, or it isn’t shared with you.');return true;
    }
    go({name:'dashboards'},false);go({name:'dashboard',dashboardId:r.id});return true;
  }
  if(r.kind==='report'){
    if(!store.reportDefs.some(x=>x.id===r.id)){
      if(!store.dashReady||!store.reportsReady)return false; // still arriving
      if(store.dashboards.some(x=>x.id==='mig-'+r.id)){go({name:'dashboards'},false);go({name:'dashboard',dashboardId:'mig-'+r.id});return true;} // an old report, now a dashboard
      toast('That report isn’t available. It may have been deleted, or it isn’t shared with you.');return true;
    }
    go({name:'reports'},false);go({name:'report',reportId:r.id});return true;
  }
  if(r.kind==='form'){
    const f=formById(r.id);
    if(!f||!canViewForm(store.me,f.id)){toast('That form isn’t available to you.');return true;}
    go({name:'records',formId:f.id},false);return true;
  }
  const rec=recById(r.id);
  if(!rec){
    if(store.recordsLoading.size)return false; // still arriving: try again on the next update
    toast('That record isn’t available. It may have been deleted, or you may not have access to it.');return true;
  }
  // Back from a linked record goes to its form's list
  go({name:'records',formId:rec.formId},false);
  rdraft=null;go({name:'record',formId:rec.formId,recordId:rec.id});
  return true;
}
window.addEventListener('hashchange',()=>{
  if(!booted)return;
  const r=parseRoute(location.hash);
  if(!r||location.hash===routeFor(view))return;
  if(dirty()&&!guard()){syncHash();return;}
  if(!openRoute(r))pendingRoute=r;
});
function onData(){
  if(!store.ready)return;
  if(!booted){
    booted=true;$('#boot').hidden=true;$('#app').hidden=false;
    const r=parseRoute(location.hash);
    home();
    homeCheck=!r&&!store.profiles[store.user?.uid];
    if(r&&!openRoute(r))pendingRoute=r;
    return;
  }
  // the home dashboard is on the profile, which can arrive after the first screen
  if(homeCheck&&store.profiles[store.user?.uid]){homeCheck=false;if(!hist.length&&store.profiles[store.user.uid].homeDashboard&&view.name!=='dashboard'&&!dirty()){home();return;}}
  if(pendingRoute&&openRoute(pendingRoute))pendingRoute=null;
  if(ADMIN_VIEWS.has(view.name)&&!isAdmin(store.me)){ui.leaveOk=true;home();return;}
  if((view.name==='records'||view.name==='record')&&!canViewForm(store.me,view.formId)){ui.leaveOk=true;home();return;}
  renderSide();
  if(admin.isDirty(view))return;
  if(view.name==='formEdit')return;
  if(view.name==='record'&&rdraft?.dirty)return;
  if(view.name==='import'&&importBusy())return;
  if(view.name==='import'&&!formById(view.formId)){home();return;}
  maybeMigrate();
  if((view.name==='report'||view.name==='dashboard')&&reportBusy())return;
  if(view.name==='record'||view.name==='records'){if(!formById(view.formId)){home();return;}}
  if(view.name==='record'&&view.recordId&&!recById(view.recordId)){back();return;}
  renderMain();
}

/* ---------- Rendering ---------- */
export function render(){renderSide();renderMain();}
function renderSide(){
  const fs=sidebarForms();
  const activeForm=(view.name==='records'||view.name==='record')?view.formId:null;
  const me=store.me||{};const name=store.profiles[me.uid]?.displayName||store.user?.displayName||store.user?.email||'You';
  const adm=isAdmin(me);
  $('#side').innerHTML=`
    <div class="brand"><span class="brand-mark"><i></i></span><b>Formwright</b></div>
    <div class="navlabel">Forms</div>
    ${fs.length?fs.map(f=>`<button class="nav${activeForm===f.id?' on':''}" data-act="nav-form" data-id="${f.id}">${badge(f)}<span class="t">${esc(f.name)}</span><span class="n">${recordsOf(f.id).length}</span></button>`).join(''):`<div class="nav-empty">No forms to show yet.</div>`}
    <div class="navlabel" style="margin-top:12px">Insights</div>
    <button class="nav${view.name==='dashboards'||view.name==='dashboard'?' on':''}" data-act="nav-dashboards"><span class="glyph navg">▦</span><span class="t">Dashboards</span><span class="n">${counts().dashboards}</span></button>
    <button class="nav${view.name==='reports'||view.name==='report'?' on':''}" data-act="nav-reports"><span class="glyph navg">▤</span><span class="t">Reports</span><span class="n">${counts().reports}</span></button>
    ${adm?`<div class="navlabel" style="margin-top:12px">Administration</div>
    <button class="nav${view.name==='designer'||view.name==='formEdit'?' on':''}" data-act="nav-designer"><span class="glyph navg">⚙</span><span class="t">Form designer</span><span class="n">${store.forms.length}</span></button>
    <button class="nav${view.name==='groups'||view.name==='groupEdit'?' on':''}" data-act="nav-groups"><span class="glyph navg">◫</span><span class="t">Security groups</span><span class="n">${store.groups.length}</span></button>
    <button class="nav${view.name==='users'?' on':''}" data-act="nav-users"><span class="glyph navg">☺</span><span class="t">Users</span><span class="n">${store.users.length}</span></button>
    <button class="nav${view.name==='imports'?' on':''}" data-act="nav-imports"><span class="glyph navg">⇪</span><span class="t">Import history</span><span class="n">${store.imports.length}</span></button>`:''}
    <div class="side-foot"><div class="who"><b>${esc(name)}</b><span>${adm?'Administrator':'Member'}</span></div><button class="btn sm ghost" data-act="sign-out">Sign out</button></div>`;
}
function renderMain(){
  const m=$('#main');let h='',title='Formwright';
  if(!store.ready){m.innerHTML='<div class="loading">Loading your forms…</div>';return;}
  let wide=false;
  if(view.name==='reports'){title='Reports';h=viewReportsList();}
  else if(view.name==='report'){title=reportName(view.reportId);h=viewReport(view.reportId);wide=true;}
  else if(view.name==='dashboards'){title='Dashboards';h=viewDashboards();}
  else if(view.name==='dashboard'){title=dashName(view.dashboardId);h=viewDashboard(view.dashboardId);wide=true;}
  else if(view.name==='records'){const f=formById(view.formId);title=f?.name;h=viewRecords(f);}
  else if(view.name==='record'){const f=formById(view.formId);title=f?.name;h=viewRecord(f);}
  else if(view.name==='import'){title=importTitle();h=viewImport(formById(view.formId));}
  else if(view.name==='imports'){title='Import history';h=viewImports();}
  else if(view.name==='designer'){title='Form designer';h=viewDesigner();}
  else if(view.name==='formEdit'){title='Edit form';h=viewFormEdit();}
  else if(admin.handles(view)){const r=admin.renderView(view);title=r.title;h=r.html;}
  else if(view.name==='welcome'){title='Formwright';h=viewWelcome();}
  $('#topttl').textContent=title||'Formwright';
  m.innerHTML=`<div class="wrap${wide?' wide':''}">${h}</div>`;
  document.querySelectorAll('canvas[data-sig]').forEach(initSig);
  if(view.name==='records')afterRecords();
  syncTaskWatch();
}

/* ---------- Cadence tasks linked to the open record ---------- */
// Only tasks this person owns or is assigned in Cadence are listed (Cadence's rules).
const tw={recordId:null,unsub:null,tasks:[],status:'off',error:null,busy:new Set()};
function syncTaskWatch(){
  const want=view.name==='record'&&view.recordId?view.recordId:null;
  if(want===tw.recordId)return;
  if(tw.unsub){tw.unsub();tw.unsub=null;}
  Object.assign(tw,{recordId:want,tasks:[],status:want?'loading':'off',error:null});
  if(!want)return;
  tw.unsub=watchTasks(want,(list)=>{tw.tasks=list;tw.status='ready';paintTasks();},(err)=>{
    console.error('[formwright] tasks',err);tw.status='error';tw.error=err?.code||'unknown';paintTasks();
  });
}
function paintTasks(){const el=$('#rec-tasks');if(el)el.innerHTML=tasksInner();}
function tasksInner(){
  const rec=view.recordId?recById(view.recordId):null;
  const form=rec?formById(rec.formId):null;
  const noun=form?itemName(form).toLowerCase():'record';
  const add=cadenceUrl?`<button class="btn sm" data-act="add-task">+ Add task</button>`:'';
  const head=`<div class="section-h"><h2>Tasks${tw.status==='ready'&&tw.tasks.length?` <span class="count">${tw.tasks.filter(t=>!t.done).length}</span>`:''}</h2>${add}</div>`;
  if(tw.status==='loading'||tw.recordId!==view.recordId)return head+`<div class="panel"><p class="note">Loading tasks…</p></div>`;
  if(tw.status==='error')return head+`<div class="panel"><p class="note">${tw.error==='failed-precondition'?'Tasks need a database index that is still being built. Try again in a few minutes.':'Couldn’t load tasks ('+esc(tw.error)+').'}</p></div>`;
  if(!tw.tasks.length)return head+`<div class="panel"><p class="note">No tasks for this ${esc(noun)} yet.${cadenceUrl?' Add one, or link an existing task to it in Cadence.':' Link a task to it from Cadence.'}</p></div>`;
  const me=store.user?.uid,today=dateKey(new Date());
  return head+`<div class="panel tlist">${sortTasks(tw.tasks).map(t=>{
    const due=t.done?{text:'Done',tone:'ok'}:dueInfo(t.due,today);
    const rep=repeats(t),busy=tw.busy.has(t.id);
    const meta=[`<span class="tdue ${due.tone}">${esc(due.text)}</span>`,whoLine(t,me),rep?repeatLabel(t):''].filter(Boolean);
    return `<div class="trow${t.done?' done':''}">
      <button class="tcheck${t.done?' on':''}" data-act="task-done" data-id="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="${t.done?'Reopen':'Mark done'}: ${esc(t.title)}"${busy?' disabled':''}${rep&&!t.done?' title="Repeating tasks are completed in Cadence, so the next one is created"':''}>✓</button>
      <button class="tmain" data-act="task-open" data-id="${esc(t.id)}"${cadenceUrl?'':' disabled'}><b>${esc(t.title||'Untitled task')}</b><span class="tmeta">${meta.map(x=>x.startsWith('<')?x:`<span>${esc(x)}</span>`).join('')}</span></button>
    </div>`;}).join('')}</div>`;
}
async function toggleTask(id){
  const t=tw.tasks.find(x=>x.id===id);if(!t)return;
  if(repeats(t)&&!t.done){
    if(cadenceUrl){window.open(cadenceLink(cadenceUrl,{task:t.id}),'cadence');toast('Complete repeating tasks in Cadence so the next one is created.');}
    else toast('Complete repeating tasks in Cadence so the next one is created.');
    return;
  }
  tw.busy.add(id);paintTasks();
  try{await setTaskDone(id,donePatch(!t.done,store.user.uid,Date.now()));}
  catch(err){console.error('[formwright] task',err);toast('Couldn’t update that task. Try again.');}
  tw.busy.delete(id);paintTasks();
}

function viewWelcome(){
  return `<div class="panel empty"><h2>You’re signed in</h2><p>No forms are shared with you yet. An administrator needs to add you to a security group.</p><p class="help">Signed in as ${esc(store.user?.email||'')}</p></div>`;
}

/* Records list: see lists.js */

/* Record page */
function newRecordDraft(form,parent){
  const values={};
  (form.fields||[]).forEach(f=>{if(f.type==='checkbox')values[f.id]=false;if(f.type==='range')values[f.id]=f.min??0;});
  let copied=0;
  if(parent){
    const pf=formById(parent.formId);const rel=(pf?.children||[]).find(c=>c.formId===form.id);
    if(rel?.copy&&pf){(form.fields||[]).forEach(f=>{const m=f.type!=='formula'&&pf.fields.find(p=>p.type===f.type&&p.type!=='heading'&&p.label.trim().toLowerCase()===f.label.trim().toLowerCase());if(m&&!isEmpty(parent.values?.[m.id])){values[f.id]=clone(parent.values[m.id]);copied++;}});}
    (form.fields||[]).forEach(f=>{if(f.type==='relation'&&f.relForm===parent.formId&&isEmpty(values[f.id]))values[f.id]=parent.id;});
  }
  return {formId:form.id,recordId:null,values,parentId:parent?.id||null,parentFormId:parent?.formId||null,errors:{},dirty:false,copied};
}
function viewRecord(form){
  if(!form)return '';
  const rec=view.recordId?recById(view.recordId):null;
  if(!rdraft||rdraft.formId!==form.id||rdraft.recordId!==(view.recordId||null)){rdraft=rec?{formId:form.id,recordId:rec.id,values:{},errors:{},dirty:false}:newRecordDraft(form,null);}
  if(rec&&!rdraft.dirty){rdraft.values=clone(rec.values||{});rdraft.parentId=rec.parentId||null;rdraft.parentFormId=rec.parentFormId||null;}
  const ro=rec?!canEditRecord(store.me,rec):!canCreate(store.me,form.id);rdraft.readOnly=ro;
  const grels=gridRels(form);syncGrids(rdraft,rec,grels);
  const parent=rdraft.parentId?recById(rdraft.parentId):null;
  const pform=parent?formById(parent.formId):null;
  const parentForms=parentsOf(form.id);
  const title=rec?recTitle({formId:form.id,values:rdraft.values},form):'New '+itemName(form).toLowerCase();
  let crumbs=`<button data-act="nav-records" data-id="${form.id}">${esc(form.name)}</button>`;
  if(parent&&pform)crumbs=`<button data-act="open-record" data-id="${parent.id}">${esc(pform.name)} · ${esc(recTitle(parent,pform))}</button><span>›</span>`+crumbs;
  let parentPick='';
  if(parentForms.length){
    const opts=parentForms.map(pf=>`<optgroup label="${esc(pf.name)}">${recordsOf(pf.id).map(r=>`<option value="${r.id}"${r.id===rdraft.parentId?' selected':''}>${esc(recTitle(r,pf))}</option>`).join('')}</optgroup>`).join('');
    parentPick=`<div class="panel parentcard"><div class="grow"><small>Belongs to</small><select class="in" id="parent-pick" style="margin-top:6px" aria-label="Parent record"${ro?' disabled':''}><option value="">No parent</option>${opts}</select></div>${parent?`<button class="btn sm" data-act="open-record" data-id="${parent.id}">Open ${esc(itemName(pform).toLowerCase())}</button>`:''}</div>`;
  }
  const children=(form.children||[]).filter(c=>c.display!=='grid').map(c=>({rel:c,cf:formById(c.formId)})).filter(x=>x.cf&&canViewForm(store.me,x.cf.id));
  const gridHTML=grels.map(({rel,cf})=>gridSection(form,rel,cf,rdraft,ro)).join('');
  const childHTML=rec?children.map(({cf})=>{
    const rs=store.records.filter(r=>r.parentId===rec.id&&r.formId===cf.id).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    const cols=(cf.fields||[]).filter(f=>f.inList&&!NOCOL.has(f.type)&&f.id!==titleFieldOf(cf)?.id).slice(0,3);
    return `<section class="section"><div class="section-h"><h2>${badge(cf)}${esc(cf.name)} <span class="count">${rs.length}</span></h2>${canCreate(store.me,cf.id)?`<button class="btn sm" data-act="add-child" data-id="${cf.id}">+ Add ${esc(itemName(cf).toLowerCase())}</button>`:''}</div>
      <div class="panel">${rs.length?`<div class="cards" style="display:flex">${rs.map(r=>`<button class="card" data-act="open-record" data-id="${r.id}"><b>${esc(recTitle(r,cf))}</b><div class="meta">${cols.map(c=>{const t=fmt(c,valOf(c,r));return t?`<span>${esc(c.label)}: ${esc(t)}</span>`:''}).join('')}</div></button>`).join('')}</div>`:`<p class="note">No ${esc(cf.name.toLowerCase())} for this ${esc(itemName(form).toLowerCase())} yet.</p>`}</div></section>`;
  }).join(''):'';
  let backHTML='';
  if(rec){
    const links=[];
    store.forms.forEach(f=>(f.fields||[]).filter(x=>x.type==='relation'&&x.relForm===form.id).forEach(x=>recordsOf(f.id).filter(r=>r.values?.[x.id]===rec.id).forEach(r=>links.push({r,f,x}))));
    if(links.length)backHTML=`<section class="section"><div class="section-h"><h2>Linked from <span class="count">${links.length}</span></h2></div><div class="panel"><div class="cards" style="display:flex">${links.map(({r,f,x})=>`<button class="card" data-act="open-record" data-id="${r.id}"><b>${esc(recTitle(r,f))}</b><div class="meta"><span>${esc(f.name)} · ${esc(x.label)}</span></div></button>`).join('')}</div></div></section>`;
  }
  const delKey='rec-'+(rec?.id||'');
  const kids=rec?store.records.filter(r=>r.parentId===rec.id).length:0;
  return `
  <div class="crumbs">${crumbs}</div>
  <div class="head"><div class="ttl">${badge(form,1)}<div><h1>${esc(title)}</h1>${!rec&&rdraft.copied?`<p class="sub">${rdraft.copied} field${rdraft.copied>1?'s':''} copied from the ${esc(itemName(pform||{}).toLowerCase())}.</p>`:''}</div></div></div>
  ${parentPick}
  <div class="panel">
    <fieldset class="fset"${ro?' disabled':''}>${formFieldsHTML(form,rdraft,'record')}</fieldset>
    <div class="savebar">
      ${rec&&!ro?`<button class="btn danger${ui.confirm===delKey?' armed':''}" data-act="del-record">${ui.confirm===delKey?(kids?`Tap again to delete (${kids} child record${kids>1?'s':''} stay)`:'Tap again to delete'):'Delete'}</button>`:''}
      <span class="grow" id="dirtynote">${rdraft.dirty?'Unsaved changes':rec?recordMeta(rec)+(ro?' · Read only':''):''}</span>
      <button class="btn ghost" data-act="back">${rdraft.dirty?'Discard':'Back'}</button>
      ${ro?'':`<button class="btn primary" data-act="save-record">${rec?'Save':'Save '+esc(itemName(form).toLowerCase())}</button>`}
    </div>
  </div>
  ${gridHTML}
  ${rec?`<section class="section" id="rec-tasks">${tasksInner()}</section>`:''}
  ${childHTML}${backHTML}
  ${!rec&&children.length?`<p class="help">Save this ${esc(itemName(form).toLowerCase())} to add ${children.map(c=>esc(c.cf.name.toLowerCase())).join(' and ')}.</p>`:''}
  ${cellPopup()}`;
}

const personName=id=>store.profiles[id]?.displayName||(id===store.user?.uid?'you':'someone');
const when=t=>new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function recordMeta(rec){
  const by=rec.ownerId===store.user?.uid?'you':personName(rec.ownerId);
  let s=`Created by ${esc(by)}`;
  if(rec.updatedAt)s+=` · edited ${esc(when(rec.updatedAt))}`+(rec.updatedBy&&rec.updatedBy!==rec.ownerId?` by ${esc(personName(rec.updatedBy))}`:'');
  return s;
}

/* ---------- Sub-form grids ----------
   A child form whose relationship is shown as a grid is edited inside the parent record.
   Rows live in rdraft.grids[childFormId] = {rows:[{id, values, ownerId, createdAt, isNew, dirty, errors}], removed:[ids], sort}
   and are saved with the parent in one batch (saveRecordBundle). Long text, files, photos,
   signatures, locations and multiple choice open in a pop-up (cdraft) from their cell. */
const POPUP_TYPES=new Set(['textarea','file','image','signature','location','multiselect']);
const GRID_SUM=new Set(['number','decimal','currency']);
let cdraft=null;
function gridRels(form){return (form.children||[]).filter(c=>c.display==='grid').map(rel=>({rel,cf:formById(rel.formId)})).filter(x=>x.cf&&x.cf.id!==form.id&&canViewForm(store.me,x.cf.id));}
function gridCols(rel,cf){
  const usable=(cf.fields||[]).filter(f=>f.type!=='heading');
  const picked=Array.isArray(rel.cols)&&rel.cols.length?rel.cols.map(id=>usable.find(f=>f.id===id)).filter(Boolean):usable.filter(f=>!POPUP_TYPES.has(f.type)).slice(0,8);
  return picked.length?picked:usable.slice(0,1);
}
function rowRec(row,cf,d){return {id:row.id,formId:cf.id,values:row.values,parentId:d.recordId||null,ownerId:row.ownerId,_parentDraft:d};}
function syncGrids(d,rec,rels){
  d.grids=d.grids||{};
  rels.forEach(({cf})=>{
    let g=d.grids[cf.id];
    if(!g)g=d.grids[cf.id]={rows:[],removed:[],sort:null};
    if(!d.dirty){
      g.rows=rec?store.records.filter(r=>r.parentId===rec.id&&r.formId===cf.id).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).map(r=>({id:r.id,values:clone(r.values||{}),ownerId:r.ownerId,createdAt:r.createdAt,isNew:false,dirty:false,errors:{}})):[];
      g.removed=[];
    }
  });
}
function newRowValues(cf,d,parentForm){
  const values={};
  (cf.fields||[]).forEach(f=>{if(f.type==='checkbox')values[f.id]=false;if(f.type==='range')values[f.id]=f.min??0;if(f.type==='relation'&&f.relForm===parentForm.id&&d.recordId)values[f.id]=d.recordId;});
  return values;
}
function rowEditable(row,cf){return row.isNew?canCreate(store.me,cf.id):canEditRecord(store.me,{formId:cf.id,ownerId:row.ownerId});}
function sortRowsGrid(g,cf,d){
  const old=g.rows.filter(r=>!r.isNew),fresh=g.rows.filter(r=>r.isNew);
  if(!g.sort)return old.concat(fresh);
  const f=(cf.fields||[]).find(x=>x.id===g.sort.key);if(!f)return old.concat(fresh);
  const val=r=>{const v=valOf(f,rowRec(r,cf,d),cf);if(v==null||v==='')return null;if(typeof v==='number'||typeof v==='boolean')return Number(v);return fmt(f,v).toLowerCase();};
  const dir=g.sort.dir==='asc'?1:-1;
  return old.map(r=>({r,v:val(r)})).sort((a,b)=>{if(a.v==null||b.v==null)return a.v==null&&b.v==null?0:a.v==null?1:-1;return (typeof a.v==='number'&&typeof b.v==='number'?a.v-b.v:String(a.v).localeCompare(String(b.v),undefined,{numeric:true}))*dir;}).map(x=>x.r).concat(fresh);
}
function popupSummary(f,v){
  if(isEmpty(v))return '';
  if(f.type==='textarea'){const s=String(v);return s.length>36?s.slice(0,36)+'…':s;}
  return fmt(f,v);
}
function gridCell(cf,row,f,d,ro){
  const ids=`data-grid="${cf.id}" data-row="${row.id}" data-gf="${f.id}"`,v=row.values[f.id],val=v==null?'':esc(v),dis=ro?' disabled':'';
  const lab=` aria-label="${esc(f.label)}"`;
  if(f.type==='formula'){const r=calc(cf,f,rowRec(row,cf,d));return `<span class="gcalc" id="gc-${cf.id}-${row.id}-${f.id}">${esc(r.e?'—':fmtCalc(f,r.v))}</span>`;}
  if(POPUP_TYPES.has(f.type)){const s=popupSummary(f,v);return `<button type="button" class="gpopbtn${s?' has':''}" data-act="grid-cell" data-grid="${cf.id}" data-row="${row.id}" data-fid="${f.id}">${esc(s||(ro?'—':f.type==='signature'?'Sign':'Add'))}</button>`;}
  switch(f.type){
    case 'checkbox':return `<input type="checkbox" class="gck" ${ids}${lab}${v?' checked':''}${dis}>`;
    case 'select':case 'radio':return `<select class="gin" ${ids}${lab}${dis}><option value=""></option>${(f.options||[]).map(o=>`<option${o===v?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
    case 'relation':{const tf=formById(f.relForm);const rs=tf?recordsOf(tf.id).map(r=>({r,t:recTitle(r,tf)})).sort((x,y)=>x.t.localeCompare(y.t)):[];return `<select class="gin" ${ids}${lab}${dis}><option value=""></option>${rs.map(({r,t})=>`<option value="${r.id}"${r.id===v?' selected':''}>${esc(t)}</option>`).join('')}</select>`;}
    case 'rating':{const mx=f.max||5;let o='<option value="0">—</option>';for(let i=1;i<=mx;i++)o+=`<option value="${i}"${v===i?' selected':''}>${'★'.repeat(i)}</option>`;return `<select class="gin" ${ids}${lab}${dis}>${o}</select>`;}
    case 'number':case 'decimal':case 'currency':case 'percent':case 'range':return `<input class="gin num" type="number" step="any" inputmode="decimal" ${ids}${lab} value="${val}"${dis}>`;
    case 'date':return `<input class="gin" type="date" ${ids}${lab} value="${val}"${dis}>`;
    case 'time':return `<input class="gin" type="time" ${ids}${lab} value="${val}"${dis}>`;
    case 'datetime':return `<input class="gin" type="datetime-local" ${ids}${lab} value="${val}"${dis}>`;
    case 'color':return `<input class="gin" type="color" ${ids}${lab} value="${esc(v||'#3346c8')}"${dis}>`;
    case 'email':return `<input class="gin" type="email" ${ids}${lab} value="${val}"${dis}>`;
    case 'phone':return `<input class="gin" type="tel" ${ids}${lab} value="${val}"${dis}>`;
    default:return `<input class="gin" type="text" ${ids}${lab} value="${val}"${dis}>`;
  }
}
function gridTotal(cf,f,d,rows){
  const sum=GRID_SUM.has(f.type)||(f.type==='formula'&&['number','decimal','currency'].includes(f.format||'decimal'));
  if(!sum)return null;
  let s=0,n=0;rows.forEach(r=>{const v=valOf(f,rowRec(r,cf,d),cf);if(typeof v==='number'&&isFinite(v)){s+=v;n++;}});
  return n?s:null;
}
function gridSection(form,rel,cf,d,parentRo){
  const g=d.grids[cf.id];const cols=gridCols(rel,cf);
  const rows=sortRowsGrid(g,cf,d);
  const mayAdd=!parentRo&&canCreate(store.me,cf.id);
  const errs=[];
  const body=rows.map((row,i)=>{
    const ro=parentRo||!rowEditable(row,cf);
    const bad=row.errors&&Object.keys(row.errors).length;
    if(bad)Object.entries(row.errors).forEach(([fid,m])=>{const f=cf.fields.find(x=>x.id===fid);errs.push(`Row ${i+1}: ${f?f.label+' – ':''}${m}`);});
    return `<tr class="${row.isNew?'gnew':''}${bad?' gbad':''}" data-growid="${row.id}">${cols.map(f=>`<td class="${(NUMERIC.has(f.type)||f.type==='formula')&&f.type!=='rating'?'num':''}${row.errors?.[f.id]?' bad':''}">${gridCell(cf,row,f,d,ro)}</td>`).join('')}
      <td class="gact">${row.isNew?'':`<button type="button" class="ibtn" data-act="open-record" data-id="${row.id}" aria-label="Open this row on its own" title="Open on its own">↗</button>`}${ro?'':`<button type="button" class="ibtn" data-act="grid-del" data-grid="${cf.id}" data-row="${row.id}" aria-label="Delete row ${i+1}" title="Delete row">✕</button>`}</td></tr>`;
  }).join('');
  const totals=cols.map(f=>gridTotal(cf,f,d,rows));
  const showTot=rows.length>1&&totals.some(t=>t!=null);
  const head=cols.map(f=>{const on=g.sort?.key===f.id;return `<th${(NUMERIC.has(f.type)||f.type==='formula')&&f.type!=='rating'?' class="num"':''} aria-sort="${on?(g.sort.dir==='asc'?'ascending':'descending'):'none'}"><button type="button" class="ghb${on?' on':''}" data-act="grid-sort" data-grid="${cf.id}" data-key="${f.id}">${esc(f.label)}${f.required?'<span class="req">*</span>':''}<span class="arr" aria-hidden="true">${on?(g.sort.dir==='asc'?'▲':'▼'):''}</span></button></th>`;}).join('');
  return `<section class="section gsec" id="grid-${cf.id}"><div class="section-h"><h2>${badge(cf)}${esc(cf.name)} <span class="count">${rows.length}</span></h2><span class="chip acc">Grid</span></div>
    <div class="panel"><div class="gwrap"><table class="gtbl"><thead><tr>${head}<th class="gact"><span class="sr">Row actions</span></th></tr></thead>
      <tbody>${body||`<tr><td class="gempty" colspan="${cols.length+1}">No ${esc(cf.name.toLowerCase())} yet.</td></tr>`}</tbody>
      ${showTot?`<tfoot><tr>${cols.map((f,i)=>`<td class="num" id="gt-${cf.id}-${f.id}">${totals[i]==null?(i===0?'Total':''):esc(f.type==='formula'?fmtCalc(f,totals[i]):fmt(f,totals[i]))}</td>`).join('')}<td></td></tr></tfoot>`:''}
    </table></div>
    ${errs.length?`<div class="gerrs" role="alert">${errs.slice(0,6).map(e=>`<p>${esc(e)}</p>`).join('')}</div>`:''}
    <div class="gfoot">${mayAdd?`<button type="button" class="btn sm" data-act="grid-add" data-grid="${cf.id}">+ Add ${esc(itemName(cf).toLowerCase())}</button>`:''}<span class="help">${g.sort?'Click a heading again to reverse. ':'Click a heading to sort. '}${mayAdd?'New rows stay at the bottom until you save.':''}</span></div></div></section>`;
}
function refreshGrids(d){
  if(!d?.grids)return;
  const form=formById(d.formId);if(!form)return;
  gridRels(form).forEach(({rel,cf})=>{
    const g=d.grids[cf.id];if(!g)return;const cols=gridCols(rel,cf);
    cols.filter(f=>f.type==='formula').forEach(f=>g.rows.forEach(row=>{const el=document.getElementById(`gc-${cf.id}-${row.id}-${f.id}`);if(el){const r=calc(cf,f,rowRec(row,cf,d));el.textContent=r.e?'—':fmtCalc(f,r.v);}}));
    cols.forEach(f=>{const el=document.getElementById(`gt-${cf.id}-${f.id}`);if(!el)return;const t=gridTotal(cf,f,d,g.rows);if(t!=null)el.textContent=f.type==='formula'?fmtCalc(f,t):fmt(f,t);});
  });
}
function setGridVal(t){
  const d=rdraft;const g=d?.grids?.[t.dataset.grid];if(!g)return;
  const row=g.rows.find(r=>r.id===t.dataset.row);const cf=formById(t.dataset.grid);const f=cf?.fields.find(x=>x.id===t.dataset.gf);if(!row||!f)return;
  let v;
  if(f.type==='checkbox')v=t.checked;
  else if(f.type==='rating')v=Number(t.value)||0;
  else if(NUMERIC.has(f.type))v=t.value===''?null:Number(t.value);
  else v=t.value;
  row.values[f.id]=v;row.dirty=true;
  if(row.errors?.[f.id]){delete row.errors[f.id];t.closest('td')?.classList.remove('bad');}
  markDirty(d);
}
function cellPopup(){
  if(!cdraft)return '';
  const cf=formById(cdraft.formId);const f=cf?.fields.find(x=>x.id===cdraft._fid);if(!f)return '';
  return `<div class="fscrim gscrim"><div class="gpop" role="dialog" aria-modal="true" aria-labelledby="gpop-h">
    <div class="gpop-h"><b id="gpop-h">${esc(cf.name)} · ${esc(f.label)}</b><button class="ibtn" data-act="cell-close" aria-label="Close">✕</button></div>
    <fieldset class="fset gpop-b" data-scope="cell"${cdraft.readOnly?' disabled':''}>${fieldBlock(f,cdraft.values[f.id],null,'cell')}</fieldset>
    <div class="gpop-f"><button class="btn primary" data-act="cell-close">Done</button></div></div></div>`;
}

/* Field rendering */
function formFieldsHTML(form,d,scope){
  const fs=form.fields||[];
  if(!fs.length)return `<p class="note">This form has no fields yet. Add some in the designer.</p>`;
  return `<div class="fgrid" data-scope="${scope}">${fs.map(f=>fieldBlock(f,d.values[f.id],d.errors?.[f.id],scope)).join('')}</div>`;
}
function fieldBlock(f,v,err,scope){
  if(f.type==='heading')return `<div class="fsec" id="fb-${scope}-${f.id}"><h3>${esc(f.label)}</h3>${f.help?`<p class="help">${esc(f.help)}</p>`:''}</div>`;
  const id=`in-${scope}-${f.id}`;
  const lab=['radio','multiselect','rating','checkbox','formula'].includes(f.type)?`<span class="flabel" id="lb-${id}">${esc(f.label)}${f.required?'<span class="req">*</span>':''}</span>`:`<label class="flabel" for="${id}">${esc(f.label)}${f.required?'<span class="req">*</span>':''}</label>`;
  return `<div class="fld w-${f.width==='half'?'half':'full'}${err?' bad':''}" id="fb-${scope}-${f.id}">${lab}${control(f,v,id,scope)}${f.help?`<p class="help">${esc(f.help)}</p>`:''}${err?`<p class="err">${esc(err)}</p>`:''}</div>`;
}
function control(f,v,id,scope){
  const a=`id="${id}" data-fid="${f.id}"`,ph=f.placeholder?` placeholder="${esc(f.placeholder)}"`:'';
  const mm=(f.min!=null&&f.min!==''?` min="${f.min}"`:'')+(f.max!=null&&f.max!==''?` max="${f.max}"`:'');
  const val=v==null?'':esc(v);
  switch(f.type){
    case 'formula':{const d=draftFor(scope);const form=d?formOfDraft(d):null;const r=form?calc(form,f,d===cdraft?rowRec(cdraft._row,form,rdraft):draftRec(d)):{e:''};return `<div class="calc${r.e?' bad':''}" id="calc-${scope}-${f.id}" aria-live="polite">${esc(r.e||fmtCalc(f,r.v)||'—')}</div><span class="fxsrc">= ${esc(f.expr||'')}</span>`;}
    case 'text':return `<input class="in" type="text" ${a} value="${val}"${ph}>`;
    case 'textarea':return `<textarea class="in" ${a}${ph}>${val}</textarea>`;
    case 'email':return `<input class="in" type="email" inputmode="email" autocomplete="email" ${a} value="${val}"${ph||' placeholder="name@example.com"'}>`;
    case 'phone':return `<input class="in" type="tel" inputmode="tel" autocomplete="tel" ${a} value="${val}"${ph||' placeholder="+1 555 555 0100"'}>`;
    case 'url':return `<input class="in" type="url" inputmode="url" ${a} value="${val}"${ph||' placeholder="https://"'}>`;
    case 'number':return `<input class="in" type="number" step="1" inputmode="numeric" ${a} value="${val}"${mm}${ph}>`;
    case 'decimal':{const d=f.decimals??2;return `<input class="in" type="number" step="${d?Math.pow(10,-d).toFixed(d):1}" inputmode="decimal" ${a} value="${val}"${mm}${ph}>`;}
    case 'currency':return `<div class="affix"><span>${esc(curSym(f.currency))}</span><input class="in" type="number" step="0.01" inputmode="decimal" ${a} value="${val}"${mm}${ph}></div>`;
    case 'percent':return `<div class="affix"><input class="in" type="number" step="any" inputmode="decimal" ${a} value="${val}"${mm}${ph}><span>%</span></div>`;
    case 'range':{const mn=f.min??0,mx=f.max??100,cur=v??mn;return `<div class="rangew"><input type="range" ${a} min="${mn}" max="${mx}" step="${f.step||1}" value="${esc(cur)}"><output id="out-${id}">${esc(cur)}${esc(f.suffix||'')}</output></div>`;}
    case 'rating':{const mx=f.max||5;let s='';for(let i=1;i<=mx;i++)s+=`<button type="button" class="${(v||0)>=i?'on':''}" data-act="rate" data-fid="${f.id}" data-n="${i}" aria-label="${i} of ${mx}" aria-pressed="${(v||0)>=i}">★</button>`;return `<div class="stars" role="group" aria-labelledby="lb-${id}">${s}</div>`;}
    case 'date':return `<input class="in" type="date" ${a} value="${val}">`;
    case 'time':return `<input class="in" type="time" ${a} value="${val}">`;
    case 'datetime':return `<input class="in" type="datetime-local" ${a} value="${val}">`;
    case 'checkbox':return `<label class="switch"><input type="checkbox" ${a}${v?' checked':''} aria-labelledby="lb-${id}"><span class="tr"></span><span>${v?'Yes':'No'}</span></label>`;
    case 'select':return `<select class="in" ${a}><option value="">Choose…</option>${(f.options||[]).map(o=>`<option${o===v?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
    case 'radio':return `<div class="opts" role="radiogroup" aria-labelledby="lb-${id}">${(f.options||[]).map((o,i)=>`<label class="opt"><input type="radio" name="${id}" data-fid="${f.id}" value="${esc(o)}"${o===v?' checked':''}>${esc(o)}</label>`).join('')}</div>`;
    case 'multiselect':return `<div class="opts" role="group" aria-labelledby="lb-${id}">${(f.options||[]).map(o=>`<label class="opt"><input type="checkbox" data-fid="${f.id}" data-multi value="${esc(o)}"${(v||[]).includes(o)?' checked':''}>${esc(o)}</label>`).join('')}</div>`;
    case 'color':return `<div class="colorw"><input type="color" ${a} value="${esc(v||'#3346c8')}"><code id="out-${id}">${esc(v||'Not set')}</code></div>`;
    case 'location':{const L=v||{},u=mapUrl(L);return `<div class="loc"><input class="in" type="text" ${a} data-part="address" value="${esc(L.address||'')}" placeholder="Street address or place name" autocomplete="street-address"><div class="row2"><input class="in" type="number" step="any" inputmode="decimal" data-fid="${f.id}" data-part="lat" value="${esc(L.lat??'')}" placeholder="Latitude" aria-label="${esc(f.label)} latitude"><input class="in" type="number" step="any" inputmode="decimal" data-fid="${f.id}" data-part="lng" value="${esc(L.lng??'')}" placeholder="Longitude" aria-label="${esc(f.label)} longitude"></div><a id="map-${id}" href="${esc(u)}" target="_blank" rel="noopener"${u?'':' hidden'}>Open in Google Maps ↗</a></div>`;}
    case 'file':case 'image':{
      let chip='';
      if(v){const src=v.url||v.data||'';chip=`<div class="file-chip">${f.type==='image'&&src?`<img src="${esc(src)}" alt="">`:`<span class="glyph">${f.type==='image'?'▣':'⇪'}</span>`}<span class="nm">${esc(v.name)}</span><span class="sz">${v.size?fsize(v.size):''}</span>${src?`<a class="btn sm ghost" href="${esc(src)}" target="_blank" rel="noopener">Open</a>`:''}<button type="button" class="ibtn" data-act="file-clear" data-fid="${f.id}" aria-label="Remove file">✕</button></div>`;}
      return `<div class="filew">${chip}<label class="pick"><input type="file" ${a}${f.type==='image'?' accept="image/*"':''}>${v?'Replace':(f.type==='image'?'Take or choose a photo':'Choose a file')}</label></div>`;}
    case 'signature':return `<div class="sig"><canvas data-sig="${f.id}" data-scope="${scope}" aria-label="Signature pad for ${esc(f.label)}"></canvas><div class="sigbar"><span>${v?'Signed':'Sign above with your finger or mouse'}</span><button type="button" class="btn sm ghost" data-act="sig-clear" data-fid="${f.id}">Clear</button></div></div>`;
    case 'relation':{const tf=formById(f.relForm);if(!tf)return `<p class="help">Choose which form this links to in the designer.</p>`;const rs=recordsOf(tf.id).map(r=>({r,t:recTitle(r,tf)})).sort((x,y)=>x.t.localeCompare(y.t));return `<div class="row2" style="grid-template-columns:minmax(0,1fr) auto"><select class="in" ${a}><option value="">Choose a ${esc(itemName(tf).toLowerCase())}…</option>${rs.map(({r,t})=>`<option value="${r.id}"${r.id===v?' selected':''}>${esc(t)}</option>`).join('')}</select>${v&&recById(v)&&scope==='record'?`<button type="button" class="btn" data-act="open-record" data-id="${v}">Open</button>`:''}</div>`;}
  }
  return '';
}
function draftRec(d){return {id:d.recordId||null,formId:d.formId,values:d.values,parentId:d.parentId||null,_draft:d.grids?d:null};}
const scopeOf=d=>d===pdraft?'preview':d===cdraft&&cdraft?'cell':'record';
const draftFor=scope=>scope==='record'?rdraft:scope==='cell'?cdraft:scope==='preview'?pdraft:null;
function refreshCalcs(d){const form=formOfDraft(d);const scope=scopeOf(d);(form?.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const el=document.getElementById(`calc-${scope}-${f.id}`);if(!el)return;const r=calc(form,f,d===cdraft?rowRec(cdraft._row,form,rdraft):draftRec(d));el.textContent=r.e||fmtCalc(f,r.v)||'—';el.classList.toggle('bad',!!r.e);});}
function draftOf(el){return draftFor(el.closest('[data-scope]')?.dataset.scope);}
function formOfDraft(d){return d===pdraft?fdraft:formById(d.formId);}
function repaint(d,f){const scope=scopeOf(d);const el=document.getElementById(`fb-${scope}-${f.id}`);if(!el)return;el.outerHTML=fieldBlock(f,d.values[f.id],d.errors?.[f.id],scope);const c=document.querySelector(`#fb-${scope}-${f.id} canvas[data-sig]`);if(c)initSig(c);}
function markDirty(d){d.dirty=true;refreshCalcs(d);if(d===cdraft&&cdraft){cdraft._row.dirty=true;if(cdraft._row.errors)delete cdraft._row.errors[cdraft._fid];markDirty(rdraft);return;}if(d===rdraft)refreshGrids(d);if(d===rdraft){const n=$('#dirtynote');if(n)n.textContent='Unsaved changes';const b=document.querySelector('[data-act="back"]');if(b)b.textContent='Discard';}}
function setVal(t){
  const d=draftOf(t);if(!d)return;const form=formOfDraft(d);const f=(form?.fields||[]).find(x=>x.id===t.dataset.fid);if(!f)return;
  let v;
  if(t.type==='checkbox'&&!('multi' in t.dataset)){v=t.checked;const s=t.parentElement.querySelector('.tr + span');if(s)s.textContent=v?'Yes':'No';}
  else if('multi' in t.dataset){v=[...t.closest('.opts').querySelectorAll('input:checked')].map(x=>x.value);}
  else if(t.dataset.part){v={...(d.values[f.id]||{})};v[t.dataset.part]=t.dataset.part==='address'?t.value:(t.value===''?null:Number(t.value));const a=document.getElementById('map-'+t.closest('.fld').querySelector('[data-part=address]').id);if(a){const u=mapUrl(v);a.href=u;a.hidden=!u;}}
  else if(NUMERIC.has(f.type)){v=t.value===''?null:Number(t.value);if(f.type==='range'){const o=document.getElementById('out-'+t.id);if(o)o.textContent=t.value+(f.suffix||'');}}
  else if(f.type==='color'){v=t.value;const o=document.getElementById('out-'+t.id);if(o)o.textContent=v;}
  else v=t.value;
  d.values[f.id]=v;
  if(d.errors?.[f.id]){delete d.errors[f.id];const fb=t.closest('.fld');fb?.classList.remove('bad');fb?.querySelector('.err')?.remove();}
  markDirty(d);
}
async function onFile(t){
  const d=draftOf(t);const form=formOfDraft(d);const f=form.fields.find(x=>x.id===t.dataset.fid);let file=t.files?.[0];if(!file)return;
  const fb=t.closest('.fld');fb.classList.add('pending');
  try{
    let val;
    if(d===pdraft){val={name:file.name,size:file.size,type:file.type,url:URL.createObjectURL(file)};}
    else{
      if(file.size>25*1024*1024){fb.classList.remove('pending');t.value='';toast(`That file is ${fsize(file.size)}. Files must be under 25 MB.`);return;}
      val=await uploadFile(file,form.id);
    }
    d.values[f.id]=val;markDirty(d);repaint(d,f);
  }catch(e){fb.classList.remove('pending');toast(e?.code==='storage/unauthorized'?'You don’t have permission to upload files to this form.':'The upload failed. Check your connection and try again.');console.error(e);}
}
function initSig(c){
  const scope=c.dataset.scope,d=draftFor(scope);if(!d)return;const fid=c.dataset.sig;
  const dpr=Math.min(2,window.devicePixelRatio||1),w=c.clientWidth||300;c.width=w*dpr;c.height=160*dpr;
  const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.fillStyle='#fbfbf7';ctx.fillRect(0,0,w,160);
  ctx.strokeStyle='#15182a';ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';
  if(d.values[fid]){const im=new Image();im.onload=()=>ctx.drawImage(im,0,0,w,160);im.src=d.values[fid];}
  if(c.closest('fieldset[disabled]'))return;
  let drawing=false,last=null,moved=false;
  const pt=e=>{const r=c.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
  c.onpointerdown=e=>{drawing=true;moved=false;last=pt(e);c.setPointerCapture(e.pointerId);};
  c.onpointermove=e=>{if(!drawing)return;const p=pt(e);ctx.beginPath();ctx.moveTo(...last);ctx.lineTo(...p);ctx.stroke();last=p;moved=true;};
  c.onpointerup=c.onpointercancel=()=>{if(!drawing)return;drawing=false;if(moved){d.values[fid]=c.toDataURL('image/png');markDirty(d);const s=c.parentElement.querySelector('.sigbar span');if(s)s.textContent='Signed';}};
}
function validate(form,vals){
  const errs={};
  (form.fields||[]).forEach(f=>{
    if(f.type==='heading'||f.type==='formula')return;const v=vals[f.id];
    if(f.required&&(f.type==='checkbox'?!v:isEmpty(v))){errs[f.id]=f.type==='checkbox'?'This must be switched on.':'This field is required.';return;}
    if(isEmpty(v))return;
    if(f.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))errs[f.id]='Enter an email like name@example.com.';
    if(f.type==='url'){try{const u=new URL(/^[a-z]+:\/\//i.test(v)?v:'https://'+v);if(!u.hostname.includes('.'))throw 0;}catch(e){errs[f.id]='Enter a web address like example.com.';}}
    if(f.type==='phone'&&(!/^[+()\-.\s\d]+$/.test(v)||v.replace(/\D/g,'').length<7))errs[f.id]='Enter a phone number with at least 7 digits.';
    if(NUMERIC.has(f.type)&&typeof v==='number'){
      if(Number.isNaN(v))errs[f.id]='Enter a number.';
      else if(f.type==='number'&&!Number.isInteger(v))errs[f.id]='Enter a whole number.';
      else if(f.min!=null&&f.min!==''&&v<f.min)errs[f.id]=`Must be ${f.min} or more.`;
      else if(f.max!=null&&f.max!==''&&f.type!=='rating'&&v>f.max)errs[f.id]=`Must be ${f.max} or less.`;
    }
    if(f.type==='location'&&v){if(v.lat!=null&&(v.lat<-90||v.lat>90))errs[f.id]='Latitude must be between -90 and 90.';if(v.lng!=null&&(v.lng<-180||v.lng>180))errs[f.id]='Longitude must be between -180 and 180.';}
  });
  return errs;
}
async function saveRecord(){
  const d=rdraft,form=formById(d.formId);if(d.readOnly){toast('This record is read only for you.');return;}const errs=validate(form,d.values);
  if(Object.keys(errs).length){d.errors=errs;renderMain();toast('Fix the highlighted fields, then save.');document.querySelector('.fld.bad')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
  // sub-form rows: check, then work out their calculations
  const grels=gridRels(form);let rowErr=0;
  grels.forEach(({cf})=>{const g=d.grids?.[cf.id];if(!g)return;g.rows.forEach(row=>{row.errors={};if(!(row.isNew||row.dirty))return;const e=validate(cf,row.values);if(Object.keys(e).length){row.errors=e;rowErr++;}});});
  if(rowErr){renderMain();toast(`${rowErr} row${rowErr>1?'s need':' needs'} attention before saving.`);document.querySelector('.gtbl tr.gbad')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
  const now=Date.now(),old=d.recordId?recById(d.recordId):null,id=d.recordId||uid('r');
  if(!d.recordId)d.recordId=id; // rows' PARENT() and the parent's CHILD…() see the final ID
  const rowsOut=[],removed=[];
  grels.forEach(({cf})=>{const g=d.grids?.[cf.id];if(!g)return;
    g.rows.forEach(row=>{
      const r=rowRec(row,cf,d);let changed=row.isNew||row.dirty;
      (cf.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const c=calc(cf,f,r);const v=c.e?null:c.v;if(row.values[f.id]!==v){row.values[f.id]=v;changed=true;}});
      if(changed&&rowEditable(row,cf))rowsOut.push({id:row.id,formId:cf.id,values:row.values,parentId:id,parentFormId:form.id,createdAt:row.createdAt||now,updatedAt:now});
    });
    removed.push(...g.removed);});
  (form.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const r=calc(form,f,draftRec(d));d.values[f.id]=r.e?null:r.v;});
  const rec={id,formId:form.id,values:d.values,parentId:d.parentId||null,parentFormId:d.parentFormId||null,createdAt:old?.createdAt||now,updatedAt:now};
  try{if(rowsOut.length||removed.length)await saveRecordBundle(rec,rowsOut,removed);else await store.put('records',rec);}
  catch(e){console.error(e);if(!old)d.recordId=null;toast(e?.code==='permission-denied'?'You don’t have permission to save this record or one of its rows.':'Saving failed. Check your connection and try again.');return;}
  if(rowsOut.length||removed.length){const n=rowsOut.length+removed.length;setTimeout(()=>toast(`Saved with ${n} row change${n>1?'s':''}`),0);}
  d.dirty=false;d.errors={};d.recordId=id;d.copied=0;view.recordId=id;toast('Saved');render();
}

/* Designer */
function viewDesigner(){
  const fs=[...store.forms].sort(byOrder);
  return `
  <div class="head"><div class="ttl"><div><h1>Form designer</h1><p class="sub">Build forms, choose which ones appear in the sidebar, and connect them as parents and children. Hidden forms are still reachable from their parent records. Who can see and edit each form is set in Security groups.</p></div></div>
    <div class="actions"><button class="btn primary" data-act="new-form">+ New form</button></div></div>
  ${fs.length?`<div class="panel flist">${fs.map((f,i)=>{
    const par=parentsOf(f.id),kids=(f.children||[]).map(c=>formById(c.formId)).filter(Boolean);
    return `<div class="fcard">${badge(f,1)}<div class="info"><b>${esc(f.name)}</b><div class="tags"><span class="chip">${(f.fields||[]).filter(x=>x.type!=='heading').length} fields</span><span class="chip">${recordsOf(f.id).length} record${recordsOf(f.id).length===1?'':'s'}</span>${par.length?`<span class="chip acc">Child of ${par.map(p=>esc(p.name)).join(', ')}</span>`:''}${kids.length?`<span class="chip acc">Parent of ${kids.map(k=>esc(k.name)).join(', ')}</span>`:''}${f.showInSidebar?'':'<span class="chip warn">Hidden</span>'}</div></div>
      <div class="ctl"><label class="switch vis"><input type="checkbox" data-act-change="toggle-sidebar" data-id="${f.id}"${f.showInSidebar?' checked':''}><span class="tr"></span><span>Sidebar</span></label>
      <button class="ibtn" data-act="form-move" data-id="${f.id}" data-dir="-1" aria-label="Move up"${i===0?' disabled':''}>↑</button><button class="ibtn" data-act="form-move" data-id="${f.id}" data-dir="1" aria-label="Move down"${i===fs.length-1?' disabled':''}>↓</button>
      <button class="btn sm" data-act="nav-records" data-id="${f.id}">Records</button><button class="btn sm primary" data-act="edit-form" data-id="${f.id}">Edit</button></div></div>`;}).join('')}</div>`
  :`<div class="panel empty"><h2>No forms yet</h2><p>Create your first form, or load a set of connected example forms (Clients, Projects, Site visits, Contacts) to see how relationships work.</p><div class="actions"><button class="btn" data-act="load-examples">Load example forms</button><button class="btn primary" data-act="new-form">+ New form</button></div></div>`}`;
}
function newField(type){
  const f={id:uid('x'),type,label:T[type].label,required:false,inList:false,width:['heading','textarea','location','multiselect','file','signature'].includes(type)?'full':'half',help:''};
  if(CHOICE.has(type))f.options=['Option 1','Option 2','Option 3'];
  if(type==='decimal')f.decimals=2;
  if(type==='currency')f.currency='CAD';
  if(type==='rating')f.max=5;
  if(type==='formula'){f.expr='';f.format='decimal';f.decimals=2;f.inList=true;}
  if(type==='range'){f.min=0;f.max=100;f.step=1;}
  if(type==='relation'){const o=store.forms.find(x=>x.id!==fdraft?.id);f.relForm=o?.id||'';f.label=o?itemName(o):'Linked record';}
  return f;
}
function viewFormEdit(){
  const f=fdraft;const tabs=[['fields','Fields'],['relations','Relationships'],['settings','Settings'],['preview','Preview']];
  let body='';
  if(ui.tab==='fields'){
    const groups=[...new Set(TYPES.map(t=>t[3]))];
    body=`<div class="dz">
      <aside class="panel dz-types" aria-label="Field types">
        <h2 class="dz-h">Field types</h2>
        ${groups.map(g=>`<div class="pgroup"><span>${g}</span>${TYPES.filter(t=>t[3]===g).map(t=>`<button class="dz-chip" draggable="true" data-act="add-field" data-type="${t[0]}" title="Drag onto the form, or tap to add"><span class="glyph">${t[2]}</span>${t[1]}</button>`).join('')}</div>`).join('')}
      </aside>
      <aside class="panel dz-list" aria-label="Fields in this form">
        <h2 class="dz-h">In this form (${f.fields.length})</h2>
        ${f.fields.length?`<ol class="dz-ol">${f.fields.map((x,i)=>`<li><button class="dz-li" data-act="focus-field" data-id="${x.id}"><span class="num">${i+1}</span><span class="fname">${esc(x.label||'Untitled field')}</span><span class="ftype">${esc(T[x.type].label)}</span></button></li>`).join('')}</ol>`:`<p class="note">No fields yet.</p>`}
      </aside>
      <main class="panel dz-canvas" data-dz-canvas aria-label="Form canvas">
        ${f.fields.length?f.fields.map((x)=>`<div class="crow" draggable="true" data-feid="${x.id}">
          <span class="grip" aria-hidden="true"></span>
          <span class="glyph" title="${esc(T[x.type].label)}">${T[x.type].glyph}</span>
          <div class="crow-m"><b id="frl-${x.id}">${esc(x.label||'Untitled field')}${x.required?'<span class="req">*</span>':''}</b><small>${esc(T[x.type].label)}${x.type==='relation'&&formById(x.relForm)?' → '+esc(formById(x.relForm).name):''}${x.inList?' · in list':''}${f.titleField===x.id?' · title':''}</small></div>
          <button class="ibtn dz-dots" data-act="open-field" data-id="${x.id}" aria-label="Options for ${esc(x.label||'field')}">⋯</button>
        </div>`).join(''):`<p class="note dz-empty">Drag a field type here to add it.</p>`}
        <div class="dz-drop">Drop a field type here</div>
      </main>
    </div>${ui.openField?fieldModal():''}`;
  }else if(ui.tab==='relations'){
    const pending=f._newForms||[];
    const others=[...store.forms.filter(x=>x.id!==f.id),...pending];
    const par=parentsOf(f.id);
    const linkers=[];store.forms.forEach(o=>(o.fields||[]).filter(x=>x.type==='relation'&&x.relForm===f.id).forEach(x=>linkers.push(o.name+' · '+x.label)));
    const noun=esc(itemName(f).toLowerCase()||'record');
    const relCard=(c,i)=>{
      const cf=others.find(o=>o.id===c.formId)||(c.formId===f.id?f:null);
      const isNew=pending.some(x=>x.id===c.formId);
      const grid=c.display==='grid';
      const inh=f._inherit&&c.formId in f._inherit?f._inherit[c.formId]:!!cf?.inheritAccess;
      const colIds=new Set(cf&&grid?gridCols(c,cf).map(x=>x.id):[]);
      const pick=isNew?`<input class="in" data-crel="${i}" data-cprop="newname" value="${esc(cf.name)}" aria-label="Sub-form name" placeholder="Sub-form name, e.g. Line items">`
        :`<select class="in" data-crel="${i}" data-cprop="formId" aria-label="Child form">${others.filter(o=>!pending.includes(o)).sort(byOrder).map(o=>`<option value="${o.id}"${o.id===c.formId?' selected':''}>${esc(o.name)}</option>`).join('')}<option value="${f.id}"${c.formId===f.id?' selected':''}>${esc(f.name||'This form')} (itself)</option></select>`;
      return `<div class="relcard"><div class="rel">${pick}
        <label class="switch"><input type="checkbox" data-crel="${i}" data-cprop="copy"${c.copy?' checked':''}><span class="tr"></span><span>Copy matching fields</span></label>
        <button class="ibtn" data-act="del-rel" data-i="${i}" aria-label="Remove ${esc(cf?.name||'child form')}">✕</button></div>
        <div class="relopts"><span class="help">Show in the ${noun} as</span><div class="segs" role="group" aria-label="How ${esc(cf?.name||'it')} shows">
          <button type="button" class="${grid?'on':''}" aria-pressed="${grid}" data-act="rel-display" data-i="${i}" data-v="grid">Grid in the record</button>
          <button type="button" class="${grid?'':'on'}" aria-pressed="${!grid}" data-act="rel-display" data-i="${i}" data-v="records">Separate records</button></div>
          ${isNew?'<span class="chip acc">New sub-form · saved with this form</span>':''}</div>
        ${grid&&cf&&cf.id!==f.id?`<div class="relcols"><span class="help">Grid columns</span><div class="colchecks">${(cf.fields||[]).filter(x=>x.type!=='heading').map(x=>`<label class="colcheck"><input type="checkbox" data-crel="${i}" data-cprop="col" value="${x.id}"${colIds.has(x.id)?' checked':''}><span>${esc(x.label)}</span>${POPUP_TYPES.has(x.type)?'<small>pop-up</small>':x.type==='formula'?'<small>calc</small>':''}</label>`).join('')}</div></div>`:''}
        ${cf&&cf.id!==f.id?`<label class="switch relinh"><input type="checkbox" data-crel="${i}" data-cprop="inherit"${inh?' checked':''}><span class="tr"></span><span>Rows follow this form’s access</span></label><p class="help">${inh?`Anyone who can see a ${noun} can see its ${esc(cf.name.toLowerCase())}, and editing works the same way. ${esc(cf.name)} no longer has its own row in Security groups.`:`${esc(cf.name)} keeps its own access in Security groups.`}</p>`:''}
      </div>`;
    };
    body=`<section class="section"><div class="section-h"><h2>Sub-forms and child forms</h2><button class="btn sm" data-act="add-rel">+ Add child form</button><button class="btn sm primary" data-act="add-subform">+ New sub-form</button></div>
      <p class="help">A <b>grid</b> shows the rows inside the ${noun}, saved together with it, like line items. <b>Separate records</b> lists them as cards under the ${noun}; each opens on its own.</p>
      <div class="panel">${(f.children||[]).length?f.children.map(relCard).join(''):`<p class="note">No sub-forms or child forms yet.</p>`}</div>
      <p class="help">“Copy matching fields” fills in any child field whose label and type match a field on the parent. Sub-forms go one level deep: a form shown as a grid can’t have grids of its own.</p></section>
      <section class="section"><div class="section-h"><h2>Parents</h2></div><div class="panel"><p class="note">${par.length?`This form is a child of ${par.map(p=>`<b>${esc(p.name)}</b>`).join(', ')}. Its records can belong to one of their records.`:'No form lists this one as a child.'}</p></div></section>
      <section class="section"><div class="section-h"><h2>Linked by fields</h2></div><div class="panel"><p class="note">${linkers.length?'Link-to-record fields that point here: '+linkers.map(esc).join(', ')+'.':'Add a “Link to record” field to any form to point at records in another form, like a lookup.'}</p></div></section>`;
  }else if(ui.tab==='settings'){
    const tfs=f.fields.filter(x=>['text','email','phone','url','number','select','date'].includes(x.type));
    body=`<div class="panel"><div class="settings">
      <label class="prop"><span>One record is called</span><input class="in" data-fprop="itemName" value="${esc(f.itemName||'')}" placeholder="${esc(itemName(f))}"><small class="help">Used in buttons like “New ${esc(itemName(f).toLowerCase())}”.</small></label>
      <label class="prop"><span>Record title comes from</span><select class="in" data-fprop="titleField"><option value="">First text field</option>${tfs.map(x=>`<option value="${x.id}"${x.id===f.titleField?' selected':''}>${esc(x.label)}</option>`).join('')}</select></label>
      <label class="prop full"><span>Description</span><textarea class="in" data-fprop="description" rows="2" placeholder="What this form collects">${esc(f.description||'')}</textarea></label>
      <div class="prop"><span>Color</span><div class="swatches">${COLORS.map((c,i)=>`<button class="sw${(f.color??0)===i?' on':''}" style="background:${c}" data-act="set-color" data-i="${i}" aria-label="Color ${i+1}"></button>`).join('')}</div></div>
      <div class="prop"><span>Visibility</span><label class="switch"><input type="checkbox" data-fprop="showInSidebar" data-kind="bool"${f.showInSidebar?' checked':''}><span class="tr"></span><span>Show in sidebar</span></label><small class="help">Hidden forms stay in the designer and under their parent records.</small></div>
    </div></div>
    ${f.isNew?'':`<section class="section"><div class="section-h"><h2>Delete form</h2></div><div class="panel"><div class="parentcard"><p class="grow help">Deletes the form and its ${recordsOf(f.id).length} records. Child records in other forms are kept.</p><button class="btn danger${ui.confirm==='form'?' armed':''}" data-act="del-form">${ui.confirm==='form'?'Tap again to delete':'Delete form'}</button></div></div></section>`}`;
  }else{
    if(!pdraft)pdraft={values:{},errors:{},dirty:false};
    body=`<div class="panel"><div class="preview-note">Preview. Try the fields; nothing here is saved.</div>${formFieldsHTML(f,pdraft,'preview')}<div class="savebar"><button class="btn" data-act="preview-check">Check required fields</button></div></div>`;
  }
  return `
  <div class="crumbs"><button data-act="nav-designer">Form designer</button><span>›</span><span>${f.isNew?'New form':esc(f.name)}</span></div>
  <div class="head"><div class="ttl">${badge(f.name?f:{...f,name:'?'},1)}<div style="flex:1;min-width:0"><input class="title-in" data-fprop="name" value="${esc(f.name)}" placeholder="Form name, e.g. Inspections" aria-label="Form name"></div></div></div>
  <div class="tabs" role="tablist">${tabs.map(([k,l])=>`<button class="tab${ui.tab===k?' on':''}" role="tab" aria-selected="${ui.tab===k}" data-act="tab" data-tab="${k}">${l}${k==='fields'?` <span class="count">${f.fields.length}</span>`:''}${k==='relations'&&(f.children||[]).length?` <span class="count">${f.children.length}</span>`:''}</button>`).join('')}</div>
  ${body}
  <div class="panel savebar" style="border-radius:var(--r)"><span class="grow" id="fdirty">${f.dirty?'Unsaved changes':'All changes saved'}</span><button class="btn ghost" data-act="done-form">${f.dirty?'Discard':'Done'}</button><button class="btn primary" data-act="save-form">Save form</button></div>`;
}
/* Field options popup. Reuses fieldEditor, so every option and its handlers stay the same. */
function fieldModal(){
  const x=fdraft.fields.find(z=>z.id===ui.openField);
  if(!x)return '';
  const i=fdraft.fields.indexOf(x),last=fdraft.fields.length-1;
  const armed=ui.confirm==='f-'+x.id;
  return `<div class="fscrim">
    <div class="fmodal" data-feid="${x.id}" role="dialog" aria-modal="true" aria-labelledby="fm-t-${x.id}" style="transform:translate3d(${fmPos.x}px,${fmPos.y}px,0)">
      <div class="fmodal-h"><span class="glyph">${T[x.type].glyph}</span><b id="fm-t-${x.id}">${esc(x.label||'Untitled field')}</b><span class="fm-type">${esc(T[x.type].label)}</span><button class="ibtn" data-act="close-field" aria-label="Close">✕</button></div>
      <div class="fmodal-b">${fieldEditor(x)}</div>
      <div class="fmodal-f">
        <button class="ibtn" data-act="field-move" data-id="${x.id}" data-dir="-1" aria-label="Move up"${i===0?' disabled':''}>↑</button>
        <button class="ibtn" data-act="field-move" data-id="${x.id}" data-dir="1" aria-label="Move down"${i===last?' disabled':''}>↓</button>
        <button class="btn sm" data-act="field-dup" data-id="${x.id}">Duplicate</button>
        <span class="grow"></span>
        <button class="btn sm danger${armed?' armed':''}" data-act="field-del" data-id="${x.id}">${armed?'Tap again to delete':'Delete'}</button>
        <button class="btn sm primary" data-act="close-field">Done</button>
      </div>
    </div>
  </div>`;
}
function fieldEditor(x){
  const P=(l,h,c='')=>`<label class="prop ${c}"><span>${l}</span>${h}</label>`;
  const inp=(p,v,attrs='')=>`<input class="in" data-prop="${p}" value="${esc(v??'')}" ${attrs}>`;
  const num=(p,v)=>inp(p,v,'type="number" step="any" inputmode="decimal" data-kind="num"');
  const sw=(p,l)=>`<label class="switch"><input type="checkbox" data-prop="${p}" data-kind="bool"${x[p]?' checked':''}><span class="tr"></span><span>${l}</span></label>`;
  let h=P('Label',inp('label',x.label))+P('Field type',`<select class="in" data-prop="type">${TYPES.map(t=>`<option value="${t[0]}"${t[0]===x.type?' selected':''}>${t[1]}</option>`).join('')}</select>`);
  h+=P(x.type==='heading'?'Description':'Help text',inp('help',x.help),'full');
  if(x.type==='formula'){
    const others=fdraft.fields.filter(o=>o.id!==x.id&&o.type!=='heading');
    h+=`<label class="prop full"><span>Formula</span><textarea class="in fx" data-prop="expr" rows="3" spellcheck="false" autocapitalize="off" placeholder="{Price} * {Quantity}">${esc(x.expr||'')}</textarea></label>
    <div class="prop full"><span id="fxc-${x.id}" class="fxcheck${fxCheck(x).ok?'':' bad'}">${fxCheck(x).msg}</span></div>
    <div class="prop full"><span>Insert a field</span><div class="chips">${others.length?others.map(o=>`<button type="button" class="chipbtn" data-act="fx-ins" data-fid="${x.id}" data-ins="{${esc(o.label)}}">${esc(o.label)}</button>`).join(''):'<span class="help">Add other fields first.</span>'}</div></div>
    <div class="prop full"><span>Insert a function</span><div class="chips">${['+','-','*','/','( )','SUM(','ROUND(',"IF(",'DAYS(','TODAY()','CHILDSUM(','CHILDCOUNT(','PARENT('].map(fn=>`<button type="button" class="chipbtn fn" data-act="fx-ins" data-fid="${x.id}" data-ins="${esc(fn==='( )'?'(':fn.length===1?' '+fn+' ':fn)}">${esc(fn)}</button>`).join('')}</div></div>
    <div class="prop full">${FX_REF}</div>`;
    h+=P('Show result as',`<select class="in" data-prop="format">${[['decimal','Decimal number'],['number','Number'],['currency','Currency'],['percent','Percent'],['days','Days'],['text','Text']].map(([k,l])=>`<option value="${k}"${(x.format||'decimal')===k?' selected':''}>${l}</option>`).join('')}</select>`);
    if(['decimal','number','percent'].includes(x.format||'decimal'))h+=P('Decimal places',num('decimals',x.decimals));
    if(x.format==='currency')h+=P('Currency code',inp('currency',x.currency||'CAD','maxlength="3" style="text-transform:uppercase"'));
  }
  if(PLACEHOLDER.has(x.type))h+=P('Placeholder',inp('placeholder',x.placeholder));
  if(CHOICE.has(x.type))h+=P('Options, one per line',`<textarea class="in" data-prop="options" data-kind="lines" rows="4">${esc((x.options||[]).join('\n'))}</textarea>`,'full');
  if(['number','decimal','currency','percent','range'].includes(x.type))h+=P('Minimum',num('min',x.min))+P('Maximum',num('max',x.max));
  if(x.type==='decimal')h+=P('Decimal places',num('decimals',x.decimals));
  if(x.type==='currency')h+=P('Currency code',inp('currency',x.currency,'maxlength="3" style="text-transform:uppercase"'));
  if(x.type==='range')h+=P('Step',num('step',x.step))+P('Unit after value',inp('suffix',x.suffix,'placeholder="e.g. %"'));
  if(x.type==='rating')h+=P('Number of stars',num('max',x.max));
  if(x.type==='relation')h+=P('Links to form',`<select class="in" data-prop="relForm"><option value="">Choose a form…</option>${[...store.forms].sort(byOrder).map(o=>`<option value="${o.id}"${o.id===x.relForm?' selected':''}>${esc(o.name)}</option>`).join('')}</select>`);
  if(x.type!=='heading')h+=`<div class="props-sw">${x.type==='formula'?'':sw('required','Required')}${NOCOL.has(x.type)?'':sw('inList','Column in the starting list')}<label class="switch"><input type="checkbox" data-prop="width" data-kind="half"${x.width==='half'?' checked':''}><span class="tr"></span><span>Half width on wide screens</span></label></div>`;
  h+=`<div class="prop full"><span class="keyline">Field ID ${esc(x.id)}</span></div>`;
  return `<div class="fedit">${h}</div>`;
}
const FX_REF=`<details class="fxref"><summary>Formula reference</summary><div class="tblwrap"><table><tbody>
<tr><td>{Field name}</td><td>The value of another field on this form. Yes/No counts as 1 or 0.</td></tr>
<tr><td>+ - * / ^ %</td><td>Add, subtract, multiply, divide, power, remainder.</td></tr>
<tr><td>= != &lt; &gt; &lt;= &gt;=</td><td>Compare two values, for use inside IF.</td></tr>
<tr><td>&amp;</td><td>Join text, e.g. {First} &amp; " " &amp; {Last}.</td></tr>
<tr><td>IF(test, a, b)</td><td>a when the test is true, otherwise b. AND( ), OR( ), NOT( ) combine tests.</td></tr>
<tr><td>SUM, AVG, MIN, MAX</td><td>Over any list of values, e.g. SUM({Q1}, {Q2}, {Q3}).</td></tr>
<tr><td>ROUND(x, 2)</td><td>Round to 2 places. Also ROUNDUP, ROUNDDOWN, FLOOR, CEIL, ABS, SQRT, POW, MOD.</td></tr>
<tr><td>DAYS(end, start)</td><td>Days between two dates. TODAY() is today's date.</td></tr>
<tr><td>HOURS(end, start)</td><td>Hours between two times or date-times.</td></tr>
<tr><td>CHILDSUM("Form", "Field")</td><td>Total of a field across this record's children. Also CHILDAVG, CHILDMIN, CHILDMAX.</td></tr>
<tr><td>CHILDCOUNT("Form")</td><td>How many child records this record has in that form.</td></tr>
<tr><td>PARENT("Field")</td><td>A value from the parent record.</td></tr>
</tbody></table></div></details>`;
function fxCheck(x){
  if(!(x.expr||'').trim())return {ok:false,msg:'Write a formula, for example {Price} * {Quantity}.'};
  try{const rec={id:null,formId:fdraft.id,values:{},parentId:null};evalFormula(fdraft,x,rec,0,true);return {ok:true,msg:'✓ Formula is valid'};}
  catch(e){return {ok:false,msg:e.fx?e.message:'This formula could not be worked out.'};}
}
function updateFxCheck(x){const el=document.getElementById('fxc-'+x.id);if(!el)return;const r=fxCheck(x);el.textContent=r.msg;el.classList.toggle('bad',!r.ok);}
function setFdirty(){fdraft.dirty=true;const n=$('#fdirty');if(n)n.textContent='Unsaved changes';const b=document.querySelector('[data-act="done-form"]');if(b)b.textContent='Discard';}
async function saveForm(){
  const f=fdraft;
  if(!f.name.trim()){toast('Give the form a name first.');$('.title-in')?.focus();return;}
  f.fields.forEach(x=>{if(!x.label.trim())x.label='Untitled field';if(CHOICE.has(x.type))x.options=(x.options||[]).filter(Boolean);});
  const reEsc=t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  Object.entries(f._labels||{}).forEach(([id,old])=>{const nf=f.fields.find(z=>z.id===id);if(!nf||!old||nf.label===old)return;f.fields.filter(z=>z.type==='formula'&&z.expr).forEach(z=>{z.expr=z.expr.replace(new RegExp('\\{\\s*'+reEsc(old)+'\\s*\\}','gi'),()=>'{'+nf.label+'}');});});
  const renames=Object.entries(f._labels||{}).map(([id,old])=>[old,f.fields.find(z=>z.id===id)?.label]).filter(([o,n])=>o&&n&&o!==n);
  const q='["\']';
  const others=renames.length&&!f.isNew?store.forms.filter(o=>o.id!==f.id&&(o.fields||[]).some(z=>z.type==='formula'&&z.expr)):[];
  const nameRe=reEsc(f.name.trim());
  for(const o of others){
    let changed=false;const fields=clone(o.fields);
    fields.filter(z=>z.type==='formula'&&z.expr).forEach(z=>{renames.forEach(([old,nw])=>{
      const r1=new RegExp('(CHILD(?:SUM|AVG|MIN|MAX)\\(\\s*'+q+nameRe+q+'\\s*,\\s*'+q+')'+reEsc(old)+'('+q+')','gi');
      const r2=new RegExp('(PARENT\\(\\s*'+q+')'+reEsc(old)+'('+q+')','gi');
      const isChild=(f.children||[]).some(c=>c.formId===o.id);
      let e=z.expr.replace(r1,(m,x,y)=>x+nw+y);if(isChild)e=e.replace(r2,(m,x,y)=>x+nw+y);
      if(e!==z.expr){z.expr=e;changed=true;}
    });});
    if(changed){try{await store.put('forms',{...o,fields});}catch(e){}}
  }
  // sub-forms: new ones, access inheritance, one-level nesting
  const pending=(f._newForms||[]).filter(nf=>(f.children||[]).some(c=>c.formId===nf.id));
  if(pending.some(nf=>!nf.name.trim())){toast('Give the new sub-form a name.');return;}
  for(const c of (f.children||[]).filter(c=>c.display==='grid')){const cf=formById(c.formId);if(cf&&(cf.children||[]).some(x=>x.display==='grid')){toast(`${cf.name} has grids of its own, so it can’t be a grid here.`);return;}}
  if((f.children||[]).some(c=>c.display==='grid')&&store.forms.some(o=>o.id!==f.id&&(o.children||[]).some(c=>c.formId===f.id&&c.display==='grid'))){toast('This form is shown as a grid elsewhere, so it can’t hold grids itself.');return;}
  const inheritChanges=Object.entries(f._inherit||{}).map(([id,v])=>[formById(id),v]).filter(([o,v])=>o&&!!o.inheritAccess!==v);
  const before=formById(f.id);
  const kidsKey=x=>JSON.stringify(((x?.children)||[]).map(c=>c.formId).sort());
  const accessMoves=pending.length||inheritChanges.length||(kidsKey(before)!==kidsKey(f)&&store.forms.some(o=>o.inheritAccess));
  try{
    for(const nf of pending){const o=clone(nf);o.name=o.name.trim();o.order=Math.max(0,...store.forms.map(x=>x.order||0))+1;o.updatedAt=Date.now();await store.put('forms',o);}
    for(const [o,v] of inheritChanges)await store.put('forms',{...o,inheritAccess:v,updatedAt:Date.now()});
  }catch(e){toast('Saving the sub-forms failed. Check your connection and try again.');return;}
  f._labels=Object.fromEntries(f.fields.map(x=>[x.id,x.label]));
  const out=clone(f);delete out.dirty;delete out.isNew;delete out._labels;delete out._newForms;delete out._inherit;out.name=out.name.trim();
  if(f.isNew)out.order=Math.max(0,...store.forms.map(x=>x.order||0))+1;
  out.updatedAt=Date.now();
  try{await store.put('forms',out);}catch(e){toast('Saving failed. Check your connection and try again.');return;}
  f._newForms=[];f._inherit={};
  if(accessMoves&&isAdmin(store.me)){
    const changed=new Map([[out.id,{...out,id:out.id}],...pending.map(nf=>[nf.id,nf]),...inheritChanges.map(([o,v])=>[o.id,{...o,inheritAccess:v}])]);
    const formsAfter=[...store.forms.filter(x=>!changed.has(x.id)),...changed.values()];
    try{await recomputeAllAccess(formsAfter);}catch(e){toast('Form saved, but people’s access wasn’t updated. Use Recalculate access in Security groups.');f.dirty=false;f.isNew=false;render();return;}
  }
  f.dirty=false;f.isNew=false;toast('Form saved');render();
}
function editForm(id){
  const src=formById(id);if(!src||!guard())return;
  fdraft={...clone(src),fields:clone(src.fields||[]),children:clone(src.children||[]),dirty:false,isNew:false,_labels:Object.fromEntries((src.fields||[]).map(x=>[x.id,x.label]))};pdraft=null;
  go({name:'formEdit',formId:id});
}

/* ---------- Events ---------- */
document.addEventListener('click',async e=>{
  if(e.target.closest('[data-stop]'))return;
  const el=e.target.closest('[data-act]');if(!el)return;
  const a=el.dataset.act,id=el.dataset.id;
  if(a!=='del-record'&&a!=='del-form'&&a!=='field-del'&&ui.confirm&&!a.startsWith('nav')){ui.confirm=null;}
  switch(a){
    case 'menu':$('#side').classList.add('open');$('#scrim').classList.add('open');break;
    case 'close-menu':closeMenu();break;
    case 'nav-form':case 'nav-records':go({name:'records',formId:id});break;
    case 'nav-designer':go({name:'designer'});break;
    case 'nav-reports':go({name:'reports'});break;
    case 'nav-dashboards':go({name:'dashboards'});break;
    case 'nav-groups':go({name:'groups'});break;
    case 'nav-users':go({name:'users'});break;
    case 'nav-imports':go({name:'imports'});break;
    case 'sign-out':if(!guard())return;await signOutUser();break;
    case 'back':back();break;
    case 'new-record':{const f=formById(id);if(f)goRec(newRecordDraft(f,null),{name:'record',formId:id,recordId:null});break;}
    case 'open-record':{const r=recById(id);if(r)goRec(null,{name:'record',formId:r.formId,recordId:r.id});break;}
    case 'add-child':{const parent=recById(view.recordId);const cf=formById(id);if(!parent||!cf)return;if(rdraft?.dirty){toast('Save this record first.');return;}goRec(newRecordDraft(cf,parent),{name:'record',formId:cf.id,recordId:null});break;}
    case 'save-record':saveRecord();break;
    case 'grid-add':{const cf=formById(el.dataset.grid);const g=rdraft?.grids?.[el.dataset.grid];if(!cf||!g)return;const row={id:uid('r'),values:newRowValues(cf,rdraft,formById(rdraft.formId)),ownerId:store.user.uid,isNew:true,dirty:true,errors:{}};g.rows.push(row);markDirty(rdraft);renderMain();document.querySelector(`tr[data-growid="${row.id}"] .gin, tr[data-growid="${row.id}"] .gck, tr[data-growid="${row.id}"] .gpopbtn`)?.focus();break;}
    case 'grid-del':{const g=rdraft?.grids?.[el.dataset.grid];if(!g)return;const row=g.rows.find(r=>r.id===el.dataset.row);if(!row)return;g.rows=g.rows.filter(r=>r!==row);if(!row.isNew)g.removed.push(row.id);markDirty(rdraft);renderMain();toast('Row removed. It’s deleted when you save; Discard brings it back.');break;}
    case 'grid-sort':{const g=rdraft?.grids?.[el.dataset.grid];if(!g)return;const k=el.dataset.key;g.sort=g.sort?.key===k?{key:k,dir:g.sort.dir==='asc'?'desc':'asc'}:{key:k,dir:'asc'};renderMain();document.querySelector(`[data-act="grid-sort"][data-grid="${el.dataset.grid}"][data-key="${k}"]`)?.focus();break;}
    case 'grid-cell':{const g=rdraft?.grids?.[el.dataset.grid];const cf=formById(el.dataset.grid);const row=g?.rows.find(r=>r.id===el.dataset.row);if(!row||!cf)return;cdraft={formId:cf.id,values:row.values,errors:{},_row:row,_fid:el.dataset.fid,readOnly:rdraft.readOnly||!rowEditable(row,cf)};renderMain();document.querySelector('.gpop [data-scope="cell"] input, .gpop [data-scope="cell"] textarea, .gpop [data-scope="cell"] canvas')?.focus();break;}
    case 'cell-close':{const back=cdraft&&`[data-act="grid-cell"][data-row="${cdraft._row.id}"][data-fid="${cdraft._fid}"]`;cdraft=null;renderMain();if(back)document.querySelector(back)?.focus();break;}
    case 'task-done':toggleTask(id);break;
    case 'task-open':if(cadenceUrl)window.open(cadenceLink(cadenceUrl,{task:id}),'cadence');break;
    case 'add-task':if(cadenceUrl&&view.recordId)window.open(cadenceLink(cadenceUrl,{addTaskFor:view.recordId}),'cadence');break;
    case 'del-record':{const k='rec-'+view.recordId;if(ui.confirm!==k){ui.confirm=k;renderMain();return;}ui.confirm=null;const rid=view.recordId;rdraft.dirty=false;try{await store.del('records',rid);toast('Deleted');}catch(err){toast('Delete failed. Try again.');}break;}
    case 'rate':{const d=draftOf(el);const f=formOfDraft(d).fields.find(x=>x.id===el.dataset.fid);const n=+el.dataset.n;d.values[f.id]=d.values[f.id]===n?0:n;markDirty(d);repaint(d,f);break;}
    case 'file-clear':{const d=draftOf(el);const f=formOfDraft(d).fields.find(x=>x.id===el.dataset.fid);d.values[f.id]=null;markDirty(d);repaint(d,f);break;}
    case 'sig-clear':{const d=draftOf(el);const f=formOfDraft(d).fields.find(x=>x.id===el.dataset.fid);d.values[f.id]=null;markDirty(d);repaint(d,f);break;}
    case 'edit-form':editForm(id);break;
    case 'new-form':if(!guard())return;fdraft={id:uid('f'),name:'',itemName:'',description:'',color:store.forms.length%COLORS.length,showInSidebar:true,titleField:'',children:[],fields:[],isNew:true,dirty:true};fdraft.fields.push({...newField('text'),label:'Name',required:true,inList:true,width:'full'});pdraft=null;go({name:'formEdit',formId:fdraft.id});setTimeout(()=>$('.title-in')?.focus(),50);break;
    case 'tab':ui.tab=el.dataset.tab;ui.confirm=null;ui.openField=null;if(ui.tab==='preview')pdraft=null;renderMain();break;
    case 'open-field':ui.openField=id;fmPos={x:0,y:0};renderMain();break;
    case 'close-field':ui.openField=null;renderMain();break;
    case 'focus-field':document.querySelector(`.crow[data-feid="${id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});break;
    case 'add-field':{const f=newField(el.dataset.type);fdraft.fields.push(f);ui.openField=f.id;setFdirty();renderMain();document.querySelector(`[data-feid="${f.id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});break;}
    case 'field-move':{const fs=fdraft.fields,i=fs.findIndex(x=>x.id===id),j=i+(+el.dataset.dir);if(j<0||j>=fs.length)return;[fs[i],fs[j]]=[fs[j],fs[i]];setFdirty();renderMain();break;}
    case 'field-dup':{const i=fdraft.fields.findIndex(x=>x.id===id);const c={...clone(fdraft.fields[i]),id:uid('x')};c.label+=' (copy)';fdraft.fields.splice(i+1,0,c);ui.openField=c.id;setFdirty();renderMain();break;}
    case 'field-del':{if(ui.confirm!=='f-'+id){ui.confirm='f-'+id;renderMain();toast('Tap the check to delete this field. Values already saved in records are kept but hidden.');return;}ui.confirm=null;fdraft.fields=fdraft.fields.filter(x=>x.id!==id);if(fdraft.titleField===id)fdraft.titleField='';setFdirty();renderMain();break;}
    case 'add-rel':{const cand=store.forms.find(x=>x.id!==fdraft.id&&!(fdraft.children||[]).some(c=>c.formId===x.id));if(!cand){toast('Create another form first, then add it here as a child.');return;}fdraft.children.push({formId:cand.id,copy:true});setFdirty();renderMain();break;}
    case 'del-rel':{const [c]=fdraft.children.splice(+el.dataset.i,1);if(c&&fdraft._newForms)fdraft._newForms=fdraft._newForms.filter(x=>x.id!==c.formId);setFdirty();renderMain();break;}
    case 'add-subform':{
      const pend=fdraft._newForms=fdraft._newForms||[];
      const names=new Set([...store.forms,...pend].map(x=>x.name.toLowerCase()));let name='Line items',n=2;while(names.has(name.toLowerCase()))name='Line items '+n++;
      const qty={...newField('decimal'),label:'Qty',inList:true},price={...newField('currency'),label:'Unit price',inList:true};
      const nf={id:uid('f'),name,itemName:'Line item',description:'',color:(store.forms.length+pend.length)%COLORS.length,showInSidebar:false,inheritAccess:true,titleField:'',children:[],
        fields:[{...newField('text'),label:'Description',required:true,inList:true,width:'full'},qty,price,{...newField('formula'),label:'Amount',expr:'{Qty} * {Unit price}',format:'currency',currency:'CAD'}]};
      nf.titleField=nf.fields[0].id;
      pend.push(nf);fdraft.children.push({formId:nf.id,copy:false,display:'grid'});setFdirty();renderMain();
      document.querySelector(`[data-cprop="newname"][data-crel="${fdraft.children.length-1}"]`)?.select();break;}
    case 'rel-display':{
      const c=fdraft.children[+el.dataset.i];if(!c)return;
      if(el.dataset.v==='grid'){
        const cf=formById(c.formId);
        if(cf&&(cf.children||[]).some(x=>x.display==='grid')){toast(`${cf.name} has grids of its own. Sub-forms go one level deep.`);return;}
        const host=store.forms.find(o=>o.id!==fdraft.id&&(o.children||[]).some(x=>x.formId===fdraft.id&&x.display==='grid'));
        if(host){toast(`${fdraft.name||'This form'} is shown as a grid in ${host.name}, so it can’t hold grids itself.`);return;}
        if(c.formId===fdraft.id){toast('A form can’t be a grid inside itself.');return;}
      }
      c.display=el.dataset.v;setFdirty();renderMain();break;}
    case 'set-color':fdraft.color=+el.dataset.i;setFdirty();renderMain();break;
    case 'save-form':saveForm();break;
    case 'done-form':if(fdraft.dirty&&!ui.leaveOk){ui.leaveOk=true;toast('Tap Discard again to drop your changes.');setTimeout(()=>ui.leaveOk=false,4000);return;}fdraft.dirty=false;go({name:'designer'});break;
    case 'del-form':{if(ui.confirm!=='form'){ui.confirm='form';renderMain();return;}ui.confirm=null;await deleteForm(fdraft.id);break;}
    case 'form-move':{const fs=[...store.forms].sort(byOrder);const i=fs.findIndex(x=>x.id===id),j=i+(+el.dataset.dir);if(j<0||j>=fs.length)return;[fs[i],fs[j]]=[fs[j],fs[i]];try{for(let k=0;k<fs.length;k++)if(fs[k].order!==k)await store.put('forms',{...fs[k],order:k});}catch(err){toast('Reordering failed. Try again.');}break;}
    case 'fx-ins':{const x=fdraft.fields.find(z=>z.id===el.dataset.fid);const ta=document.querySelector(`[data-feid="${x.id}"] textarea[data-prop=expr]`);if(!ta)return;const ins=el.dataset.ins;const st=ta.selectionStart??ta.value.length,en=ta.selectionEnd??st;ta.setRangeText(ins,st,en,'end');if(ins.endsWith('('))ta.setRangeText(')',ta.selectionStart,ta.selectionStart,'start');ta.focus();x.expr=ta.value;setFdirty();updateFxCheck(x);break;}
    case 'load-examples':await loadExamples();break;
    case 'preview-check':{const errs=validate(fdraft,pdraft.values);pdraft.errors=errs;renderMain();toast(Object.keys(errs).length?`${Object.keys(errs).length} field${Object.keys(errs).length>1?'s need':' needs'} attention.`:'Everything checks out.');break;}
    default:await admin.onClick(el,a,id);
  }
});
document.addEventListener('input',e=>{
  const t=e.target;
  if(t.dataset.grid&&t.dataset.gf){if(t.type!=='checkbox'&&t.tagName!=='SELECT')setGridVal(t);return;}
  if(t.id==='search'){ui.search=t.value;const pos=t.selectionStart;renderMain();const s=$('#search');if(s){s.focus();s.setSelectionRange(pos,pos);}return;}
  if(t.dataset.fid&&t.type!=='file'&&!(t.type==='radio'||t.type==='checkbox'))setVal(t);
  if(t.dataset.fprop&&t.dataset.kind!=='bool'){fdraft[t.dataset.fprop]=t.value;setFdirty();}
  if(t.dataset.prop&&!['bool','half'].includes(t.dataset.kind)&&t.tagName!=='SELECT'){
    const f=fdraft.fields.find(x=>x.id===t.closest('[data-feid]').dataset.feid);const p=t.dataset.prop,k=t.dataset.kind;
    f[p]=k==='num'?(t.value===''?null:Number(t.value)):k==='lines'?t.value.split('\n').map(s=>s.trim()):p==='currency'?t.value.toUpperCase():t.value;
    if(p==='expr')updateFxCheck(f);
    if(p==='label'){fdraft.fields.filter(z=>z.type==='formula').forEach(updateFxCheck);const l=document.getElementById('frl-'+f.id);if(l)l.innerHTML=esc(f.label||'Untitled field')+(f.required?'<span class="req">*</span>':'');}
    setFdirty();
  }
  admin.onInput(t);
});
document.addEventListener('change',async e=>{
  const t=e.target;
  if(t.dataset.grid&&t.dataset.gf){setGridVal(t);return;}
  if(t.dataset.fid){if(t.type==='file')return onFile(t);if(t.type==='radio'||t.type==='checkbox'||t.tagName==='SELECT')setVal(t);return;}
  if(t.id==='parent-pick'){const r=t.value?recById(t.value):null;rdraft.parentId=r?.id||null;rdraft.parentFormId=r?.formId||null;markDirty(rdraft);renderMain();return;}
  if(t.dataset.actChange==='toggle-sidebar'){const f=formById(t.dataset.id);if(!f)return;try{await store.put('forms',{...f,showInSidebar:t.checked});toast(t.checked?`${f.name} is in the sidebar`:`${f.name} is hidden from the sidebar`);}catch(err){toast('Could not save that change. Try again.');t.checked=!t.checked;}return;}
  if(t.dataset.fprop&&t.dataset.kind==='bool'){fdraft[t.dataset.fprop]=t.checked;setFdirty();return;}
  if(t.dataset.fprop==='titleField'){setFdirty();renderMain();return;}
  if(t.dataset.prop){
    const f=fdraft.fields.find(x=>x.id===t.closest('[data-feid]').dataset.feid);const p=t.dataset.prop,k=t.dataset.kind;
    if(k==='bool')f[p]=t.checked;else if(k==='half')f.width=t.checked?'half':'full';
    else if(p==='type'){const nf=newField(t.value);Object.assign(f,{type:t.value},Object.fromEntries(Object.entries(nf).filter(([key])=>!['id','label','required','inList','help','width'].includes(key)&&f[key]==null)));if(NOCOL.has(f.type))f.inList=false;}
    else if(t.tagName==='SELECT')f[p]=t.value;
    setFdirty();
    if(['type','relForm','required','inList','format'].includes(p)||k==='bool')renderMain();
    return;
  }
  if(t.dataset.crel!=null){const c=fdraft.children[+t.dataset.crel];const p=t.dataset.cprop;
    if(p==='copy')c.copy=t.checked;
    else if(p==='newname'){const nf=(fdraft._newForms||[]).find(x=>x.id===c.formId);if(nf)nf.name=t.value;setFdirty();return;}
    else if(p==='col'){const cf=formById(c.formId)||(fdraft._newForms||[]).find(x=>x.id===c.formId);if(!cf)return;const cur=gridCols(c,cf).map(x=>x.id);const next=t.checked?[...cur.filter(x=>x!==t.value),t.value]:cur.filter(x=>x!==t.value);const order=(cf.fields||[]).map(x=>x.id);c.cols=next.sort((a,b)=>order.indexOf(a)-order.indexOf(b));if(!c.cols.length){c.cols=cur;t.checked=true;toast('A grid needs at least one column.');return;}}
    else if(p==='inherit'){fdraft._inherit={...(fdraft._inherit||{}),[c.formId]:t.checked};}
    else{c.formId=t.value;if(c.display==='grid'){const cf=formById(t.value);if(cf&&(cf.children||[]).some(x=>x.display==='grid'))c.display='records';}delete c.cols;}
    setFdirty();renderMain();return;}
  await admin.onChange(t);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&cdraft){e.preventDefault();document.querySelector('[data-act="cell-close"]')?.click();}});
function closeMenu(){$('#side').classList.remove('open');$('#scrim').classList.remove('open');}

async function deleteForm(id){
  try{await deleteFormCascade(id);fdraft.dirty=false;toast('Form deleted');go({name:'designer'},false);}
  catch(e){console.error(e);toast('Delete failed. Try again.');}
}
async function loadExamples(){
  try{await writeExamples(examples);toast('Example forms loaded. Give people access in Security groups.');home();}
  catch(e){console.error(e);toast('Loading the examples failed. Try again.');}
}

/* ---------- Designer drag and drop ---------- */
// Canvas rows and palette types use HTML5 drag and drop (desktop). On touch screens, use the ↑ ↓ buttons in the options popup.
let dzDrag=null;            // {kind:'move', id} or {kind:'new', type}
let dzGap=null;             // the blue insertion line
function dzIndex(canvas,y){
  const rows=[...canvas.querySelectorAll('.crow:not(.dragging)')];
  for(let i=0;i<rows.length;i++){
    const r=rows[i].getBoundingClientRect();
    if(y<r.top+r.height/2)return {rows,i};
  }
  return {rows,i:rows.length};
}
document.addEventListener('dragstart',e=>{
  const chip=e.target.closest?.('.dz-chip');
  const row=e.target.closest?.('.crow');
  if(chip){dzDrag={kind:'new',type:chip.dataset.type};e.dataTransfer.effectAllowed='copy';}
  else if(row){dzDrag={kind:'move',id:row.dataset.feid};row.classList.add('dragging');e.dataTransfer.effectAllowed='move';}
  else return;
  try{e.dataTransfer.setData('text/plain',dzDrag.kind);}catch(err){}
});
document.addEventListener('dragover',e=>{
  const canvas=e.target.closest?.('[data-dz-canvas]');
  if(!canvas||!dzDrag)return;
  e.preventDefault();
  e.dataTransfer.dropEffect=dzDrag.kind==='new'?'copy':'move';
  const {rows,i}=dzIndex(canvas,e.clientY);
  dzGap=dzGap||document.createElement('div');
  dzGap.className='dz-gap';
  const ref=rows[i]||canvas.querySelector('.dz-drop');
  if(ref&&dzGap!==ref.previousElementSibling)canvas.insertBefore(dzGap,ref);
});
document.addEventListener('drop',e=>{
  const canvas=e.target.closest?.('[data-dz-canvas]');
  if(!canvas||!dzDrag||!fdraft)return;
  e.preventDefault();
  const {i}=dzIndex(canvas,e.clientY);
  const drag=dzDrag;dzDrag=null;
  const fs=fdraft.fields;
  if(drag.kind==='move'){
    const moved=fs.find(x=>x.id===drag.id);
    if(!moved)return;
    const rest=fs.filter(x=>x.id!==drag.id);
    const next=[...rest.slice(0,i),moved,...rest.slice(i)];
    if(next.every((x,k)=>x===fs[k]))return;   // dropped where it already was
    fdraft.fields=next;
  }else{
    const nf=newField(drag.type);
    fdraft.fields=[...fs.slice(0,i),nf,...fs.slice(i)];
    ui.openField=nf.id;
    fmPos={x:0,y:0};
  }
  setFdirty();
  renderMain();
});
document.addEventListener('dragend',()=>{
  dzDrag=null;
  document.querySelectorAll('.crow.dragging').forEach(r=>r.classList.remove('dragging'));
  dzGap?.remove();
});

// Options popup: drag by its header. Movement is applied once per frame with a transform.
let fmPos={x:0,y:0};        // remembered position, reapplied on every render
let fmDrag=null;
document.addEventListener('pointerdown',e=>{
  const h=e.target.closest?.('.fmodal-h');
  if(!h||e.button!==0||e.target.closest('button'))return;
  const m=h.parentElement;
  const s=m.parentElement.getBoundingClientRect();
  const r=m.getBoundingClientRect();
  fmDrag={m,id:e.pointerId,sx:e.clientX,sy:e.clientY,ox:fmPos.x,oy:fmPos.y,
    dxMin:s.left-r.left,dxMax:s.right-r.right,dyMin:s.top-r.top,dyMax:s.bottom-r.bottom,
    nx:fmPos.x,ny:fmPos.y,raf:0};
  h.setPointerCapture(e.pointerId);
  m.style.transition='none';
  m.classList.add('lift');
  e.preventDefault();
});
document.addEventListener('pointermove',e=>{
  const d=fmDrag;
  if(!d||e.pointerId!==d.id)return;
  d.nx=d.ox+Math.min(Math.max(e.clientX-d.sx,d.dxMin),d.dxMax);
  d.ny=d.oy+Math.min(Math.max(e.clientY-d.sy,d.dyMin),d.dyMax);
  if(!d.raf)d.raf=requestAnimationFrame(()=>{d.raf=0;d.m.style.transform=`translate3d(${d.nx}px,${d.ny}px,0)`;});
});
function endFmDrag(e){
  const d=fmDrag;
  if(!d||e.pointerId!==d.id)return;
  if(d.raf)cancelAnimationFrame(d.raf);
  d.m.style.transform=`translate3d(${d.nx}px,${d.ny}px,0)`;
  d.m.style.transition='';
  d.m.classList.remove('lift');
  fmPos={x:d.nx,y:d.ny};
  fmDrag=null;
}
document.addEventListener('pointerup',endFmDrag);
document.addEventListener('pointercancel',endFmDrag);

/* ---------- Lifecycle (called from main.js) ---------- */
export function startApp(){
  booted=false;pendingRoute=null;view={name:'loading'};hist=[];rdraft=fdraft=pdraft=null;
  initReports({fmt,valOf,recTitle,go,renderMain,openRecord:(id)=>{const r=recById(id);if(r)goRec(null,{name:'record',formId:r.formId,recordId:r.id});}});
  initLists({fmt,valOf,recTitle,titleFieldOf,parentsOf,formById,recById,recordsOf,renderMain,search:()=>ui.search});
  initImports({fmt,recTitle,formById,go,renderMain,computeFormulas:(form,rec)=>{const out={};(form.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const r=calc(form,f,rec);out[f.id]=r.e?null:r.v;});return out;}});
  Object.assign(ui,{search:'',openField:null,tab:'fields',palette:false,confirm:null,leaveOk:false});
  store.onChange=onData;
  store.onError=(err)=>{if(err?.code==='permission-denied')toast('Some data could not be loaded because of your permissions.');else toast('Lost the connection to the database. Changes will sync when it returns.');};
}
export function stopApp(){
  booted=false;store.onChange=()=>{};$('#app').hidden=true;closeMenu();resetLists();resetImports();forgetDrafts();
  if(tw.unsub){tw.unsub();tw.unsub=null;}tw.recordId=null;
}
export { view as currentView, ui, byOrder, formById, recordsOf, renderMain };
