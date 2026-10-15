// Formwright application: navigation, record screens and the form designer.
import './designer.css';
import './grids.css';
import { readTheme, applyTheme, nextTheme, themeLabel } from './theme.js';
// Admin screens (users and groups) live in admin.js; data access in store.js.

import { fillAutoNumbers, setAutoNumber, autoCounter, emailRecord, watchEmails, getExportSettings } from './store.js';
import { DEFAULT_SUBJECT, DEFAULT_MESSAGE, fillTemplate, parseEmails, emailSuggestions } from './emaillogic.js';
import { runImport, rewriteValues, moveStage, watchStages } from './store.js';
import { store, uploadFile, deleteFormCascade, loadExamples as writeExamples, watchTasks, setTaskDone, saveRecordBundle, recomputeAllAccess, attachRecords } from './store.js';
import { cadenceUrl } from './firebase.js';
import { parseRoute, routeFor } from './route.js';
import { initReports, closeCatalogPop, viewReportsList, viewReport, reportName, leaveReport, reportBusy, viewDashboards, viewDashboard, dashName, maybeMigrate, reportDirty, dashDirty, forgetDrafts, counts, drillNav, fitTiles } from './dash.js';
import { initLists, viewRecords, afterRecords, resetLists } from './lists.js';
import { initAttach, openPickChildren, closeAttach } from './attach.js';
import { titleSortOf, columnCatalog, defaultConfig, cellOf, defaultViewId } from './listlogic.js';
import { storeKey as subStoreKey, readSubs, prefsOf, setPrefs, colsFor, toggleCol as subToggle, moveCol as subMove, nextSort as subNext, limitRows, sortByVal, TASK_COLS, TASK_DEFAULT, taskCell } from './sublogic.js';
import { colsTool, showMenu, sortMenu, toolBar, moreLine, headCell as subHead } from './subui.js';
import { headingOf, readFolds, isFolded, setFold, setFolds, foldKeys } from './foldlogic.js';
import { sectionOrder, moveSection, TASKS as TASKS_KEY } from './sectionlogic.js';
import { searchForms, allSearchable, designerMatch } from './navlogic.js';
import { copyPatch, linkPatch, attachChange, detachChange, searchHit } from './attachlogic.js';
import { initImports, viewImport, viewImports, importBusy, importRunning, importTitle, resetImports } from './imports.js';
import { sortTasks, dueInfo, whoLine, cadenceLink, donePatch, repeats, repeatLabel, dateKey, taskText } from './tasks.js';
import { FX } from './formulas.js';
import { isAdmin, formLevel, canViewForm, canCreate, canEditRecord } from './access.js';
import * as admin from './admin.js';
import { leave as exportLeave } from './exportset.js';
import { initAudit } from './audit.js';
import { fieldItem, fileName as pdfFileName } from './pdfdoc.js';
import { copyValues, relinkRow } from './duplogic.js';
import { shrinkPhoto } from './photo.js';
import { evaluate as evalRules, toClear, withoutCleared, NO_RULES, holdsValue, pruneRules, impactOf, sameRules } from './rules.js';
import { initAutos } from './autos.js';
import { initWfDesign, viewWorkflow, wfClick, wfChange, wfInput } from './wfdesign.js';
import { checkWorkflow } from './workflow.js';
import { STAGE_FIELD, wfOn, stagesOf, stageById, stageIndex, firstStage, stageName, stageView, withStageField, canWork, assigneeFor, movesOf, missingToMove, waited } from './workflow.js';
import { initRules, viewRules, rulesClick, rulesChange, parentUse, rulesCtx } from './rulesui.js';
import { formatAuto, nextAuto, missingNumbers, autoSettings } from './autonum.js';
import { signOutUser } from './auth.js';
import { $, esc, uid, clone, isEmpty, toast, COLORS, colorOf, itemName, badge } from './ui.js';
import examples from './examples.json';

const ADMIN_VIEWS = new Set(['designer', 'formEdit', 'users', 'groups', 'groupEdit', 'import', 'imports', 'exports', 'audit', 'automations', 'automation']);

// other words people search field types by
const TYPE_WORDS={text:'short single line string name title',textarea:'long paragraph notes description multi line memo comments',email:'mail address',phone:'telephone mobile cell number',url:'website link web address',location:'address map gps place',number:'integer whole count quantity',decimal:'float number fraction',currency:'money price cost dollar amount',percent:'percentage rate',rating:'stars score',range:'slider scale',formula:'calculation calculated computed formula sum total',autonumber:'auto number automatic sequence serial counter invoice id reference numbering',date:'day calendar',time:'clock hour',datetime:'timestamp date time when',checkbox:'yes no toggle boolean switch tick check',select:'dropdown choice pick list menu options',radio:'single choice option buttons one of',multiselect:'multiple choice checkboxes tags many',file:'upload attachment document pdf',image:'photo picture camera',signature:'sign autograph',color:'colour',relation:'link to record lookup reference relationship connect',heading:'section heading title divider group fold'};
const TYPES=[
 ['text','Short text','Aa','Text'],['textarea','Long text','¶','Text'],
 ['email','Email','@','Contact'],['phone','Phone','+1','Contact'],['url','Website','//','Contact'],['location','Location','⌖','Contact'],
 ['number','Whole number','12','Numbers'],['decimal','Decimal','1.5','Numbers'],['currency','Currency','$','Numbers'],['percent','Percent','%','Numbers'],['rating','Rating','★','Numbers'],['autonumber','Auto number','#','Numbers'],['range','Slider','⟷','Numbers'],['formula','Calculation','ƒx','Numbers'],
 ['date','Date','D','Date & time'],['time','Time','T','Date & time'],['datetime','Date & time','DT','Date & time'],
 ['checkbox','Yes / No','✓','Choices'],['select','Dropdown','▾','Choices'],['radio','Single choice','◉','Choices'],['multiselect','Multiple choice','☰','Choices'],
 ['file','File upload','⇪','Media'],['image','Photo','▣','Media'],['signature','Signature','✎','Media'],['color','Color','◐','Media'],
 ['relation','Link to record','↗','Relations'],['heading','Section heading','§','Layout']];
const T=Object.fromEntries(TYPES.map(t=>[t[0],{label:t[1],glyph:t[2],group:t[3]}]));
const CHOICE=new Set(['select','radio','multiselect']);
const NUMERIC=new Set(['number','decimal','currency','percent','range','rating']);
const PLACEHOLDER=new Set(['text','textarea','email','phone','url','number','decimal','currency','percent']);
const NOCOL=new Set(['heading','signature','textarea']); // not on the record page's child cards
const NOLIST=new Set(['heading','signature']); // can't be a records-list column

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
    case 'currency':return new Intl.NumberFormat(undefined,{style:'currency',currency:(f.currency||'CAD').toUpperCase()}).format(v);
    case 'percent':return v+'%';
    case 'range':return v+(f.suffix||'');
    case 'rating':return '★'.repeat(v)+'☆'.repeat(Math.max(0,(f.max||5)-v));
    case 'multiselect':return v.join(', ');
    case 'location':return v.address||(v.lat!=null?`${v.lat}, ${v.lng}`:'');
    case 'file':case 'image':return v.name||'File';
    case 'signature':return 'Signed';
    case 'autonumber':return String(v);
    case 'relation':{const r=recById(v);return r?recTitle(r):'(removed)';}
    case 'date':return new Date(v+'T00:00').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
    case 'datetime':return new Date(v).toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
    default:return String(v);
  }}catch(e){return String(v)}
}
function curSym(code){try{return new Intl.NumberFormat(undefined,{style:'currency',currency:(code||'CAD').toUpperCase()}).formatToParts(0).find(p=>p.type==='currency').value}catch(e){return code||'$'}}
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
    case 'currency':return new Intl.NumberFormat(undefined,{style:'currency',currency:(f.currency||'CAD').toUpperCase()}).format(v);
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
export function go(v,push=true){ui.subPop=null;ui.anEdit=null;if(!ui.cascade?.busy)ui.cascade=null;if(!ui.mail?.busy)ui.mail=null;
  if(ADMIN_VIEWS.has(v.name)&&!isAdmin(store.me)){toast('Only administrators can open that.');return false;}
  if((v.name==='records'||v.name==='record')&&!canViewForm(store.me,v.formId)){toast('You don’t have access to that form.');return false;}
  if(!guard())return false;
  ui.leaveOk=false;ui.confirm=null;
  if(view.name==='report')leaveReport();
  if((view.name==='report'&&reportDirty(view.reportId))||(view.name==='dashboard'&&dashDirty(view.dashboardId)))forgetDrafts();
  if(v.name==='record'||v.name==='records')cdraft=null;
  drillNav(v);
  const pushed=push&&view.name!=='loading';
  if(pushed){hist.push(view);fwd=[];}
  view=v;closeMenu();syncHash(pushed);
  if(v.name==='records'){ui.search='';}
  if(v.name==='formEdit'){ui.tab=v.tab||'fields';ui.openField=null;ui.palette=false;ui.dzq='';}
  render();window.scrollTo(0,0);return true;
}
// The in-app Back button goes through the browser's history, so it and the phone's back button always agree
export function back(){if(backPending)return;if(hist.length&&history.state&&history.state.b===BOOT&&history.state.fw===hist.length){backPending=true;setTimeout(()=>{backPending=false;},600);history.back();return;}if(!guard())return;const v=hist.pop();if(v){if(v.name==='record')rdraft=null;go(v,false)}else home()}
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
/* ---------- Web addresses (#/record/<id>, #/form/<id>) and the back button ----------
   Each screen you open is a step in the browser's history ({fw: how many screens are behind it}),
   so the phone's or browser's Back goes one screen back, like the in-app Back button.
   Below the first screen sits one extra step ({fw:-1}): reaching it shows "Press back again to exit",
   and a second Back leaves. Links from Cadence open a record directly. */
let fwd=[],exitArmed=false,exitTimer=null,popIgnore=0,backPending=false;
const BOOT=Date.now().toString(36); // steps from an earlier page load are left to the browser
const st=fw=>({fw,b:BOOT});
const urlFor=v=>location.pathname+location.search+routeFor(v);
function rearm(){if(!exitArmed)return;exitArmed=false;clearTimeout(exitTimer);history.pushState(st(hist.length),'',urlFor(view));}
function syncHash(push){
  rearm();
  if(push)history.pushState(st(hist.length),'',urlFor(view));
  else history.replaceState(st(hist.length),'',urlFor(view));
}
/** Anything open on top of the screen (a pop-up, the phone menu): Back closes it first. */
function closeOverlay(){
  if($('#side')?.classList.contains('open')){closeMenu();return true;}
  if(fsShown()){closeFormSearch();return true;}
  if(closeCatalogPop())return true;
  const fc=document.querySelector('[data-act="close-field"]');if(fc){fc.click();return true;}
  if(cdraft){document.querySelector('[data-act="cell-close"]')?.click();return true;}
  if(document.querySelector('#at-root, #db-dd, .lv-scrim, .lv-pop, .im-scrim')){document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true;}
  return false;
}
window.addEventListener('popstate',e=>{
  if(!booted)return;
  backPending=false;
  if(popIgnore){popIgnore--;return;}
  const n=e.state&&e.state.b===BOOT&&typeof e.state.fw==='number'?e.state.fw:null;
  if(n===null)return; // an address typed or followed by hand: the hashchange handler opens it
  if(n===-1&&!hist.length){
    if(closeOverlay()){history.pushState(st(0),'',urlFor(view));return;}
    // the first screen: warn once; a second Back within a few seconds leaves the app
    if(dirty()&&!guard()){history.pushState(st(0),'',urlFor(view));return;}
    exitArmed=true;toast('Press back again to exit');
    clearTimeout(exitTimer);exitTimer=setTimeout(rearm,3500);
    return;
  }
  const here=hist.length;
  if(n<here||n===-1){
    // Back: close a pop-up if one is open; otherwise step back, asking first if there are unsaved changes
    if(closeOverlay()||!guard()){history.pushState(st(here),'',urlFor(view));return;}
    const to=Math.max(0,n);let v=null;
    while(hist.length>to){fwd.push(view);v=hist.pop();if(hist.length>to)view=v;}
    if(v){if(v.name==='record')rdraft=null;ui.leaveOk=true;go(v,false);}
    return;
  }
  if(n>here){
    // Forward, after going back
    const v=fwd.pop();
    if(!v||!guard()){popIgnore++;history.back();if(v)fwd.push(v);return;}
    hist.push(view);ui.leaveOk=true;
    if(!go(v,false)){hist.pop();}
  }
});
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
  const foreign=!(history.state&&history.state.b===BOOT); // a new step the browser added for a typed or followed link
  if(dirty()&&!guard()){if(foreign){popIgnore++;history.back();}else syncHash();return;}
  // the browser already added a step for this address: count the screen we're leaving as one step back
  if(foreign&&view.name!=='loading'){hist.push(view);fwd=[];}
  const n0=hist.length;
  if(!openRoute(r)){pendingRoute=r;if(foreign&&hist.length===n0){hist.pop();history.replaceState(st(hist.length),'',urlFor(view));}}
});
/* ---------- No access yet: one blocking screen, nothing of the app behind it ----------
   Admins and people in at least one security group get in. Everyone else signed in sees only
   this screen (the rules give them no data either). It lifts by itself the moment an admin adds
   them to a group, and comes back at once if their access is taken away. */
const hasAccess=()=>!!store.me&&(isAdmin(store.me)||(store.me.groups||[]).length>0);
function accessGate(){
  let g=document.getElementById('noaccess');
  if(hasAccess()){if(g){g.remove();$('#app').hidden=!booted;}return false;}
  $('#boot').hidden=true;$('#app').hidden=true;
  if(!g){
    g=document.createElement('div');g.id='noaccess';g.className='auth';
    g.innerHTML=`<div class="auth-card na-card" role="alertdialog" aria-modal="true" aria-labelledby="na-t" aria-describedby="na-d"><div class="brand"><span class="brand-mark"><i></i></span><b>Formwright</b></div><h1 id="na-t">You don’t have access yet</h1><p id="na-d">Please contact an administrator.</p><p class="na-who">Signed in as <b>${esc(store.user?.email||'this account')}</b></p><button type="button" class="btn" id="na-out">Sign out</button></div>`;
    g.querySelector('#na-out').addEventListener('click',async()=>{await signOutUser();});
    document.body.appendChild(g);
    g.querySelector('#na-out').focus({preventScroll:true});
  }
  return true;
}
function onData(){
  if(!store.ready)return;
  if(accessGate())return;
  if(!booted){
    booted=true;$('#boot').hidden=true;$('#app').hidden=false;
    // the exit step below the first screen (see the back button notes above)
    if(!(history.state&&history.state.b===BOOT)){history.replaceState(st(-1),'',location.href);history.pushState(st(0),'',location.href);}
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
/* ---------- the sidebar's form search: no list, a pop-up of matches as you type ---------- */
const fsShown=()=>!!(ui.fsOpen||String(ui.fq||'').trim());
function formResults(){
  const typed=String(ui.fq||'').trim(),can=f=>canViewForm(store.me,f.id);
  const res=typed?searchForms(store.forms,ui.fq,can):allSearchable(store.forms,can);
  ui.fi=Math.min(ui.fi||0,Math.max(0,res.length-1));
  if(!fsShown())return '';
  if(!res.length)return typed?`<p class="fs-none">No forms match “${esc(ui.fq)}”.</p>`:`<p class="fs-none">No forms to open yet.</p>`;
  return res.map(({form:f,at,len},i)=>{
    const n=recordsOf(f.id).length,add=canCreate(store.me,f.id),noun=n===1?itemName(f).toLowerCase():f.name.toLowerCase();
    return `<div class="fs-row${i===ui.fi?' hi':''}"><button type="button" class="nav fs-item${i===ui.fi?' hi':''}" id="fs-o${i}" role="option" aria-selected="${i===ui.fi}" data-act="fs-open" data-id="${f.id}" tabindex="-1" title="${add?'New '+esc(itemName(f).toLowerCase()):'Open the list'}">${badge(f)}<span class="t">${len?`${esc(f.name.slice(0,at))}<mark>${esc(f.name.slice(at,at+len))}</mark>${esc(f.name.slice(at+len))}`:esc(f.name)}</span>${add?'<span class="fs-add" aria-hidden="true">+ New</span>':''}</button><button type="button" class="fs-count" data-act="nav-form" data-id="${f.id}" tabindex="-1" aria-label="Open the list of ${n} ${esc(noun)}" title="Open the list">${n.toLocaleString()}</button></div>`;}).join('')+`<p class="fs-hint">${typed?'':'Type to narrow · '}↑ ↓ choose · Enter: new · Shift+Enter: list · Esc closes</p>`;
}
function paintFormResults(){
  const box=$('#fs-res'),q=$('#fs-q');if(!box||!q)return;
  box.innerHTML=formResults();box.hidden=!fsShown();
  q.setAttribute('aria-expanded',box.hidden?'false':'true');
  const hi=box.querySelector('.fs-item.hi');if(hi){q.setAttribute('aria-activedescendant',hi.id);hi.scrollIntoView({block:'nearest'});}else q.removeAttribute('aria-activedescendant');
}
const THEME_ICON={
  auto:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none"/></svg>',
  light:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  dark:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>'};
/** Light / Dark / Auto, per device: one button that steps through them */
function themeButton(){
  const t=readTheme(localStorage),nx=nextTheme(t);
  const now=t==='auto'?'Auto (follows this device)':themeLabel(t);
  return `<button type="button" class="ibtn theme-btn" data-act="theme" aria-label="Theme: ${now}. Switch to ${themeLabel(nx)}" title="Theme: ${now} · click for ${themeLabel(nx)}">${THEME_ICON[t]}</button>`;
}
function renderSide(){
  const fsFocus=document.activeElement?.id==='fs-q'?document.activeElement.selectionStart:null; // a redraw while searching keeps the cursor
  const fs=sidebarForms();
  const activeForm=(view.name==='records'||view.name==='record')?view.formId:null;
  const me=store.me||{};const name=store.profiles[me.uid]?.displayName||store.user?.displayName||store.user?.email||'You';
  const adm=isAdmin(me);
  $('#side').innerHTML=`
    <div class="brand"><span class="brand-mark"><i></i></span><b>Formwright</b></div>
    <div class="navlabel" id="fs-lab">Forms</div>
    <div class="fsearch">
      <svg class="fs-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
      <input type="search" class="in" id="fs-q" role="combobox" aria-autocomplete="list" aria-controls="fs-res" aria-expanded="${fsShown()?'true':'false'}" aria-labelledby="fs-lab" placeholder="Search forms" autocomplete="off" value="${esc(ui.fq||'')}">
      <div id="fs-res" class="fs-res" role="listbox" aria-label="Forms"${fsShown()?'':' hidden'}>${formResults()}</div>
    </div>
    <div class="navlabel" style="margin-top:12px">Insights</div>
    ${store.forms.some(f=>wfOn(f))?`<button class="nav${view.name==='mywork'?' on':''}" data-act="nav-mywork"><span class="glyph navg">☰</span><span class="t">My work</span><span class="n">${myWorkCount()||''}</span></button>`:''}
    <button class="nav${view.name==='dashboards'||view.name==='dashboard'?' on':''}" data-act="nav-dashboards"><span class="glyph navg">▦</span><span class="t">Dashboards</span><span class="n">${counts().dashboards}</span></button>
    <button class="nav${view.name==='reports'||view.name==='report'?' on':''}" data-act="nav-reports"><span class="glyph navg">▤</span><span class="t">Reports</span><span class="n">${counts().reports}</span></button>
    ${adm?`<div class="navlabel" style="margin-top:12px">Administration</div>
    <button class="nav${view.name==='designer'||view.name==='formEdit'?' on':''}" data-act="nav-designer"><span class="glyph navg">⚙</span><span class="t">Form designer</span><span class="n">${store.forms.length}</span></button>
    <button class="nav${view.name==='groups'||view.name==='groupEdit'?' on':''}" data-act="nav-groups"><span class="glyph navg">◫</span><span class="t">Security groups</span><span class="n">${store.groups.length}</span></button>
    <button class="nav${view.name==='users'?' on':''}" data-act="nav-users"><span class="glyph navg">☺</span><span class="t">Users</span><span class="n">${store.users.length}</span></button>
    <button class="nav${view.name==='imports'?' on':''}" data-act="nav-imports"><span class="glyph navg">⇪</span><span class="t">Import history</span><span class="n">${store.imports.length}</span></button>
    <button class="nav${view.name==='exports'?' on':''}" data-act="nav-exports"><span class="glyph navg">⇩</span><span class="t">PDF exports</span></button>
    <button class="nav${view.name==='automations'||view.name==='automation'?' on':''}" data-act="nav-automations"><span class="glyph navg">↯</span><span class="t">Automations</span><span class="n">${store.automations.filter(a=>a.on).length||''}</span></button>
    <button class="nav${view.name==='audit'?' on':''}" data-act="nav-audit"><span class="glyph navg">⌕</span><span class="t">Audit trail</span></button>`:''}
    <div class="side-foot"><div class="who"><b>${esc(name)}</b><span>${adm?'Administrator':'Member'}</span></div>${themeButton()}<button class="btn sm ghost" data-act="sign-out">Sign out</button></div>`;
  if(fsFocus!=null){const q=$('#fs-q');if(q){q.focus({preventScroll:true});try{q.setSelectionRange(fsFocus,fsFocus)}catch(e){}paintFormResults();}}
}
function renderMain(){
  const m=$('#main');let h='',title='Formwright';
  if(!store.ready){m.innerHTML='<div class="loading">Loading your forms…</div>';return;}
  let wide=true; // every screen uses the room it has (up to 1600px); dashboards the whole width
  if(view.name==='reports'){title='Reports';h=viewReportsList();}
  else if(view.name==='report'){title=reportName(view.reportId);h=viewReport(view.reportId);wide=true;}
  else if(view.name==='dashboards'){title='Dashboards';h=viewDashboards();}
  else if(view.name==='dashboard'){title=dashName(view.dashboardId);h=viewDashboard(view.dashboardId);wide='full';}
  else if(view.name==='records'){const f=formById(view.formId);title=f?.name;h=viewRecords(f);wide=true;}
  else if(view.name==='record'){const f=formById(view.formId);title=f?.name;h=viewRecord(f);}
  else if(view.name==='mywork'){title='My work';h=viewMyWork();}
  else if(view.name==='import'){title=importTitle();h=viewImport(formById(view.formId));}
  else if(view.name==='imports'){title='Import history';h=viewImports();}
  else if(view.name==='designer'){title='Form designer';h=viewDesigner();}
  else if(view.name==='formEdit'){title='Edit form';h=viewFormEdit();}
  else if(admin.handles(view)){const r=admin.renderView(view);title=r.title;h=r.html;}
  else if(view.name==='welcome'){title='Formwright';h=viewWelcome();}
  $('#topttl').textContent=title||'Formwright';
  const ae=document.activeElement,ks=ae&&ae.dataset?.ksearch?[ae.dataset.ksearch,ae.selectionStart]:null; // a redraw while searching keeps the cursor in the box
  m.innerHTML=`<div class="wrap${wide?' wide':''}${wide==='full'?' full':''}">${h}</div>`;
  if(ks){const s2=m.querySelector(`[data-ksearch="${CSS.escape(ks[0])}"]`);if(s2){s2.focus({preventScroll:true});try{s2.setSelectionRange(ks[1],ks[1])}catch(e){}}}
  document.querySelectorAll('canvas[data-sig]').forEach(initSig);
  if(view.name==='records')afterRecords();
  if(view.name==='formEdit')applyDzq();
  if(view.name==='record'&&rdraft){rdraft._rs=null;applyRules(rdraft);}
  if(view.name==='formEdit'&&pdraft&&(ui.tab==='rules'||ui.tab==='preview'))applyRules(pdraft);
  if(view.name==='dashboard')fitTiles();
  syncTaskWatch();syncEmailWatch();syncStageWatch();
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
function paintTasks(){
  const el=$('#rec-tasks');if(!el)return;
  const a=document.activeElement,typing=a&&a.dataset?.ksearch==='t:tasks'?a.selectionStart:null; // a task update mid-search keeps the cursor
  el.innerHTML=tasksInner();
  if(typing!=null){const s=el.querySelector('[data-ksearch="t:tasks"]');if(s){s.focus({preventScroll:true});try{s.setSelectionRange(typing,typing)}catch(e){}}}
}
function tasksInner(){
  const rec=view.recordId?recById(view.recordId):null;
  const form=rec?formById(rec.formId):null;
  const noun=form?itemName(form).toLowerCase():'record';
  const k='t:tasks',p=form?subPrefs(form.id,k):prefsOf({},'',k);
  const addBtn=cadenceUrl?`<button class="btn sm" data-act="add-task">+ Add task</button>`:'';
  const ready=tw.status==='ready'&&tw.recordId===view.recordId;
  const openTasks=ready?tw.tasks.filter(t=>!t.done):[];
  const tOpen=!(form&&folded(form.id,k));
  let tSum='';
  if(ready&&tw.tasks.length){
    const next=sortTasks(openTasks).find(t=>t.due);
    const done=tw.tasks.length-openTasks.length;
    tSum=[next?'next due '+new Date(next.due+'T00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'}):'',done?done+' done':''].filter(Boolean).join(' · ');
  }
  const head=`<div class="section-h"><h2>${foldBtn(k,tOpen,`<span class="badge" style="background:${COLORS[6]}" aria-hidden="true">T</span><span>Tasks</span>${openTasks.length?` <span class="count">${openTasks.length}</span>`:''}`,tSum)}</h2></div>`;
  if(!tOpen)return head;
  if(tw.status==='loading'||tw.recordId!==view.recordId)return head+`<div class="panel subsec">${toolBar({buttons:addBtn})}<p class="note">Loading tasks…</p></div>`;
  if(tw.status==='error')return head+`<div class="panel subsec"><p class="note">${tw.error==='failed-precondition'?'Tasks need a database index that is still being built. Try again in a few minutes.':tw.error==='permission-denied'&&!isAdmin(store.me)&&store.me?.cadence!==true?'Tasks come from Cadence, which isn’t switched on for you yet. Ask an administrator to turn on Cadence for you under Users.':'Couldn’t load tasks ('+esc(tw.error)+').'}</p></div>`;
  if(!tw.tasks.length)return head+`<div class="panel subsec">${toolBar({buttons:addBtn})}<p class="note">No tasks for this ${esc(noun)} yet.${cadenceUrl?' Add one, or link an existing task to it in Cadence.':' Link a task to it from Cadence.'}</p></div>`;
  const me=store.user?.uid,today=dateKey(new Date()),now=Date.now();
  const tq=(rdraft?.kq||{})[k]||'';
  const {cols,sort,rows:found}=taskRows(p,tq,today,now);
  const lim=limitRows(found,p.show);
  const tools=colsTool(k,ui.subPop===k,cols,TASK_COLS.map(c=>({...c,group:''})),{fixed:'Task'})+showMenu(k,p.show,tw.tasks.length)+sortMenu(k,[{key:'title',label:'Task'},...cols],sort,'Open first, by due date');
  const bar=toolBar({search:tw.tasks.length>5||tq?subSearch(k,'Tasks',tq,found.length,tw.tasks.length):'',tools,buttons:addBtn});
  if(!found.length)return head+`<div class="panel subsec">${bar}<p class="note">No tasks match “${esc(tq)}”.</p></div>`;
  const tick=t=>{const busy=tw.busy.has(t.id),rep=repeats(t);return `<button class="tcheck${t.done?' on':''}" data-act="task-done" data-id="${esc(t.id)}" aria-pressed="${!!t.done}" aria-label="${t.done?'Reopen':'Mark done'}: ${esc(t.title)}"${busy?' disabled':''}${rep&&!t.done?' title="Repeating tasks are completed in Cadence, so the next one is created"':''}>✓</button>`;};
  const tdCell=(c,x)=>`<td class="${[c.num?'num':'',x.tone?'tt-'+x.tone:'',x.long?'lv-long':''].filter(Boolean).join(' ')}"${x.long&&x.text?` title="${esc(x.text)}"`:''}>${esc(x.text)}</td>`;
  const table=`<div class="sub-box"><div class="tblwrap"><table class="tbl lv-tbl sub-tbl tt-tbl"><thead><tr><th class="tt-ck"><span class="sr">Done</span></th>${subHead(k,{key:'title',label:'Task'},sort)}${cols.map(c=>subHead(k,c,sort)).join('')}</tr></thead>
    <tbody>${lim.rows.map(r=>`<tr class="${r.t.done?'done':''}"${cadenceUrl?` data-act="task-open" data-id="${esc(r.t.id)}"`:''}><td class="tt-ck">${tick(r.t)}</td><td class="title" title="${esc(r.title.text)}">${esc(r.title.text)}</td>${cols.map((c,i)=>tdCell(c,r.cells[i])).join('')}</tr>`).join('')}</tbody></table></div></div>`;
  const cards=`<div class="sub-cards tlist">${lim.rows.map(({t})=>{
    const due=t.done?{text:'Done',tone:'ok'}:dueInfo(t.due,today);
    const rep=repeats(t);
    const meta=[`<span class="tdue ${due.tone}">${esc(due.text)}</span>`,whoLine(t,me),rep?repeatLabel(t):''].filter(Boolean);
    return `<div class="trow${t.done?' done':''}">${tick(t)}
      <button class="tmain" data-act="task-open" data-id="${esc(t.id)}"${cadenceUrl?'':' disabled'}><b>${esc(t.title||'Untitled task')}</b><span class="tmeta">${meta.map(x=>x.startsWith('<')?x:`<span>${esc(x)}</span>`).join('')}</span></button>
    </div>`;}).join('')}</div>`;
  return head+`<div class="panel subsec">${bar}${table}${cards}${moreLine(k,lim.rows.length,found.length,found.length===1?'task':'tasks')}</div>`;
}
/** This record's tasks as rows: chosen columns, searched, sorted (default: open first, by due date). */
function taskRows(p,tq,today,now){
  const keys=colsFor(p.cols,TASK_COLS,TASK_DEFAULT);
  const cols=keys.map(x=>TASK_COLS.find(c=>c.key===x));
  const sort=p.sort&&(p.sort.key==='title'||keys.includes(p.sort.key)||TASK_COLS.some(c=>c.key===p.sort.key))?p.sort:null;
  const opt={todayKey:today,now,dueInfo};
  let rows=sortTasks(tw.tasks).filter(t=>!tq.trim()||searchHit(taskText(t,today),tq)).map(t=>({t,title:taskCell('title',t,opt),cells:cols.map(c=>taskCell(c.key,t,opt))}));
  if(sort){rows.forEach(r=>{r.sortVal=taskCell(sort.key,r.t,opt).sort;});rows=sortByVal(rows,sort.dir);}
  return {cols,sort,rows};
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
    if(rel?.copy&&pf){(form.fields||[]).forEach(f=>{const m=f.type!=='formula'&&f.type!=='autonumber'&&pf.fields.find(p=>p.type===f.type&&p.type!=='heading'&&p.label.trim().toLowerCase()===f.label.trim().toLowerCase());if(m&&!isEmpty(parent.values?.[m.id])){values[f.id]=clone(parent.values[m.id]);copied++;}});}
    (form.fields||[]).forEach(f=>{if(f.type==='relation'&&f.relForm===parent.formId&&isEmpty(values[f.id]))values[f.id]=parent.id;});
  }
  return {formId:form.id,recordId:null,values,parentId:parent?.id||null,parentFormId:parent?.formId||null,errors:{},dirty:false,copied};
}
function viewRecord(form){
  if(!form)return '';
  const rec=view.recordId?recById(view.recordId):null;
  if(!rdraft||rdraft.formId!==form.id||rdraft.recordId!==(view.recordId||null)){rdraft=rec?{formId:form.id,recordId:rec.id,values:{},errors:{},dirty:false}:newRecordDraft(form,null);}
  if(rec&&!rdraft.dirty){rdraft.values=clone(rec.values||{});rdraft.parentId=rec.parentId||null;rdraft.parentFormId=rec.parentFormId||null;}
  const ro=rec?(rec.stage&&wfOn(form)?!canWork(rec,store.me):!canEditRecord(store.me,rec)):!canCreate(store.me,form.id);rdraft.readOnly=ro;
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
  const sec={}; // the sections under the fields, by child form id (or 'tasks'), shown in the form's chosen order
  grels.forEach(({rel,cf})=>{sec[cf.id]=gridSection(form,rel,cf,rdraft,ro);});
  if(rec)children.forEach(({cf})=>{sec[cf.id]=childSection(form,cf,rec,ro);});
  if(rec)sec[TASKS_KEY]=`<section class="section" id="rec-tasks">${tasksInner()}</section>`;
  const sectionsHTML=sectionOrder(form).map(k=>sec[k]||'').join('');
  let backHTML='';
  if(rec){
    const links=[];
    store.forms.forEach(f=>(f.fields||[]).filter(x=>x.type==='relation'&&x.relForm===form.id).forEach(x=>recordsOf(f.id).filter(r=>r.values?.[x.id]===rec.id).forEach(r=>links.push({r,f,x}))));
    if(links.length)backHTML=`<section class="section"><div class="section-h"><h2>Linked from <span class="count">${links.length}</span></h2></div><div class="panel"><div class="cards" style="display:flex">${links.map(({r,f,x})=>`<button class="card" data-act="open-record" data-id="${r.id}"><b>${esc(recTitle(r,f))}</b><div class="meta"><span>${esc(f.name)} · ${esc(x.label)}</span></div></button>`).join('')}</div></div></section>`;
  }
  const fk=recordFoldKeys(form,rec),anyOpen=fk.some(k=>!folded(form.id,k));
  const foldAllBtn=fk.length>1||(fk.length===1&&fk[0].startsWith('h:'))?`<div class="actions"><button type="button" class="btn" data-act="fold-all" aria-label="${anyOpen?'Collapse all sections':'Expand all sections'}">${anyOpen?'Collapse all':'Expand all'}</button></div>`:'';
  const delKey='rec-'+(rec?.id||'');
  const kids=rec?store.records.filter(r=>r.parentId===rec.id).length:0;
  return `
  <div class="recbar" role="toolbar" aria-label="${esc(itemName(form))} actions">
    ${rec&&!ro?`<button class="btn danger${ui.confirm===delKey?' armed':''}" data-act="del-record">${ui.confirm===delKey?(kids?`Tap again to delete (${kids} child record${kids>1?'s':''} stay)`:'Tap again to delete'):'Delete'}</button>`:''}
    <span class="grow" id="dirtynote" role="status">${rdraft.dirty?'Unsaved changes':ro?'Read only':''}</span>
    ${rec&&isAdmin(store.me)?`<button class="btn ghost" data-act="rec-history" title="This ${esc(itemName(form).toLowerCase())} in the audit trail">History</button>`:''}
    ${rec&&isAdmin(store.me)?`<button class="btn" data-act="email-pdf" title="Email this ${esc(itemName(form).toLowerCase())} as a PDF">Email PDF</button>`:''}
    ${rec&&canCreate(store.me,form.id)?`<button class="btn ghost" data-act="rec-duplicate" title="Start a new ${esc(itemName(form).toLowerCase())} with this one’s details">Duplicate</button>`:''}
    ${rec?`<button class="btn" data-act="export-pdf" id="pdf-btn"${ui.pdfBusy?' disabled':''} title="Download this ${esc(itemName(form).toLowerCase())} as a PDF">${ui.pdfBusy?'Making PDF…':'Export PDF'}</button>`:''}
    <button class="btn ghost" data-act="back">${rdraft.dirty?'Discard':'Back'}</button>
    ${ro?'':`<button class="btn primary" data-act="save-record">${rec?'Save':'Save '+esc(itemName(form).toLowerCase())}</button>`}
  </div>
  <div class="crumbs">${crumbs}</div>
  <div class="head"><div class="ttl">${badge(form,1)}<div><h1>${esc(title)}</h1>${rec?`<p class="sub">${recordMeta(rec)}</p>`:''}${!rec&&rdraft.duplicateOf?`<p class="sub dupnote">A copy of <b>${esc(rdraft.duplicateTitle||'')}</b>${rdraft.dupRows?` with its ${rdraft.dupRows} row${rdraft.dupRows>1?'s':''}`:''}. Nothing is saved until you click Save${rdraft.dupKids?`; its ${esc(rdraft.dupKids)} aren’t copied`:''}.</p>`:''}${!rec&&rdraft.copied?`<p class="sub">${rdraft.copied} field${rdraft.copied>1?'s':''} copied from the ${esc(itemName(pform||{}).toLowerCase())}.</p>`:''}</div></div>${foldAllBtn}</div>
  ${parentPick}
  ${wfBar(form,rec)}
  <div class="panel">
    <fieldset class="fset"${ro?' disabled':''}>${formFieldsHTML(form,rdraft,'record')}</fieldset>
  </div>
  ${sectionsHTML}${rec&&wfOn(form)?`<div id="rec-history">${historyHTML(form)}</div>`:''}${backHTML}${rec?`<div id="rec-emails">${sentEmailsHTML()}</div>`:''}
  ${!rec&&children.length?`<p class="help">Save this ${esc(itemName(form).toLowerCase())} to add ${children.map(c=>esc(c.cf.name.toLowerCase())).join(' and ')}.</p>`:''}
  ${cellPopup()}${ui.mail&&ui.mail.rec===rec?.id?mailDialog(form,rec):''}${ui.cascade&&ui.cascade.parentId===rec?.id?cascadeDialog():''}${ui.wfAsk&&ui.wfAsk.recId===rec?.id?wfAskDialog(form,rec):''}`;
}

const personName=id=>String(id||'').startsWith('auto:')?'an automation':store.profiles[id]?.displayName||(id===store.user?.uid?'you':'someone');
const when=t=>new Date(t).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function recordMeta(rec){
  const by=rec.ownerId===store.user?.uid?'you':personName(rec.ownerId);
  let s=`Created by ${esc(by)}`;
  if(rec.updatedAt)s+=` · edited ${esc(when(rec.updatedAt))}`+(rec.updatedBy&&rec.updatedBy!==rec.ownerId?` by ${esc(personName(rec.updatedBy))}`:'');
  return s;
}

/* ---------- Workflows: the stage bar, moving on, the history, My work ----------
   form.workflow (workflow.js): stages with an assignee, buttons to move on, and fields per stage.
   Only the assignee (or someone in the assigned group) and administrators can change a record
   while it's in a stage; firestore.rules enforce the same. */
const WF_KEY='w:history';
const sw={recordId:null,unsub:null,list:[]};
function syncStageWatch(){
  const rec=view.name==='record'&&view.recordId?recById(view.recordId):null;
  const want=rec&&wfOn(formById(rec.formId))?rec.id:null;
  if(want===sw.recordId)return;
  if(sw.unsub){sw.unsub();sw.unsub=null;}
  Object.assign(sw,{recordId:want,list:[]});
  if(want)sw.unsub=watchStages(want,list=>{sw.list=list;const el=$('#rec-history');if(el){const f=formById(recById(want)?.formId);if(f)el.innerHTML=historyHTML(f);}});
}
const groupName=id=>store.groups.find(g=>g.id===id)?.name||'';
function whoHas(rec){
  if(rec.assignee)return rec.assignee===store.user?.uid?'you':realName(rec.assignee);
  if(rec.assigneeGroup){const n=groupName(rec.assigneeGroup);return n?`the ${n} group`:'a group';}
  return 'nobody yet';
}
function wfBar(form,rec){
  if(!wfOn(form))return '';
  const stages=stagesOf(form),cur=rec?.stage&&stageById(form,rec.stage)?rec.stage:null,i=cur?stageIndex(form,cur):-1;
  const chips=`<ol class="wf-steps">${stages.map((s,j)=>`<li class="${j<i?'done':j===i?'on':''}"${j===i?' aria-current="step"':''}>${j<i?'<span aria-hidden="true">✓</span> ':''}${esc(s.name)}</li>`).join('')}</ol>`;
  let line='',btns='';
  const admin=isAdmin(store.me);
  if(!rec)line=`Starts at <b>${esc(stages[0].name)}</b> when you save it.`;
  else if(!cur){
    line='Not in the workflow yet.';
    if(admin||canEditRecord(store.me,rec))btns=`<button type="button" class="btn sm primary" data-act="wf-start">Start at ${esc(stages[0].name)}</button>`;
  }else{
    const mine=canWork(rec,store.me);
    line=`<b>${esc(stageName(form,rec))}</b> · waiting on <b>${esc(whoHas(rec))}</b>${rec.stageAt?(w=>w==='today'?' since today':` for ${esc(w)}`)(waited(rec.stageAt,Date.now())):''}`;
    if(!mine)line+=`<span class="wf-ro">Only ${esc(whoHas(rec))} or an administrator can change it at this stage.</span>`;
    else btns=movesOf(form,cur).map(m=>`<button type="button" class="btn sm${stageIndex(form,m.to)>i?' primary':''}" data-act="wf-move" data-id="${esc(m.id)}"${ui.wfBusy?' disabled':''}>${esc(m.label)}</button>`).join('');
    if(admin)btns+=`<label class="wf-jump"><span class="sr">Move to any stage</span><select class="in" data-wf-jump="1" aria-label="Move to any stage"><option value="">Move to…</option>${stages.filter(s=>s.id!==cur).map(s=>`<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>`;
    if(stageView(form,cur).req.size)line+=`<span class="wf-note">Fields marked * are needed before moving on.</span>`;
  }
  return `<section class="panel wf-bar" aria-label="Workflow">${chips}<div class="wf-now"><p class="wf-line">${line}</p>${btns?`<div class="wf-btns">${btns}</div>`:''}</div></section>`;
}
function historyHTML(form){
  const k=WF_KEY,list=sw.list;
  const open=!folded(form.id,k);
  const last=list[0];
  const head=`<div class="section-h"><h2>${foldBtn(k,open,`<span class="badge wf-badge" aria-hidden="true">⇢</span><span>Stage history</span> <span class="count">${list.length}</span>`,last?`${last.toName||''} · ${when(last.at)}`:'')}</h2></div>`;
  if(!open)return `<section class="section" id="wf-history">${head}</section>`;
  const row=e=>`<li><div class="wf-h1"><b>${esc(realName(e.by))}</b> ${e.fromName?`moved it from <b>${esc(e.fromName)}</b> to <b>${esc(e.toName||'')}</b>`:`started it at <b>${esc(e.toName||'')}</b>`}${e.label?` <span class="chip">${esc(e.label)}</span>`:''}</div>
    <div class="wf-h2">${esc(when(e.at))}${e.assignee?` · for ${esc(realName(e.assignee))}`:e.assigneeGroup?` · for ${esc(groupName(e.assigneeGroup)?'the '+groupName(e.assigneeGroup)+' group':'a group')}`:''}</div>${e.comment?`<blockquote class="wf-c">${esc(e.comment)}</blockquote>`:''}</li>`;
  return `<section class="section" id="wf-history">${head}<div class="panel subsec">${list.length?`<ol class="wf-hist">${list.map(row).join('')}</ol>`:'<p class="note">No moves yet.</p>'}</div></section>`;
}
function wfAskDialog(form,rec){
  const a=ui.wfAsk,t=stageById(form,a.to);
  return `<div class="lv-scrim" data-act="wf-scrim"><div class="lv-dlg ra-dlg" role="dialog" aria-modal="true" aria-labelledby="wf-h" data-stop-scrim="1">
    <h2 id="wf-h">${esc(a.label)}: move to ${esc(t?.name||'')}?</h2>
    <label class="mail-l"><span class="mlab">${a.need?'Say why (required)':'Comment (optional)'}</span><textarea class="in" rows="4" data-wf-comment="1" maxlength="2000"${a.busy?' disabled':''}>${esc(a.comment||'')}</textarea></label>
    <p class="help">It goes to ${esc(whoHas({...rec,...assigneeFor(t,rec,store.user?.uid)}))}, and the comment is kept in the stage history.</p>
    <div class="lv-dlgacts"><button type="button" class="btn ghost" data-act="wf-cancel"${a.busy?' disabled':''}>Cancel</button><button type="button" class="btn primary" id="wf-go" data-act="wf-go"${a.busy?' disabled':''}>${a.busy?'Moving…':esc(a.label)}</button></div>
  </div></div>`;
}
/** Move the open record on: save what's typed, check what this stage needs, ask for a comment if wanted. */
async function wfMove(moveId,jumpTo){
  const rec=recById(view.recordId),form=rec?formById(rec.formId):null;if(!rec||!form)return;
  let m=null;
  if(jumpTo){const t=stageById(form,jumpTo);if(!t||!isAdmin(store.me))return;m={id:'jump',label:'Moved by an administrator',to:t.id,comment:false,target:t,jump:true};}
  else{m=movesOf(form,rec.stage).find(x=>x.id===moveId);if(!m)return;}
  const onScreen=rdraft&&rdraft.recordId===rec.id?{...rdraft.values}:null; // what's typed (the saved copy can take a moment to come back)
  if(rdraft?.dirty){await saveRecord();if(rdraft?.dirty)return;}
  const fresh=recById(rec.id)||rec;
  if(!m.jump&&stageIndex(form,m.to)>stageIndex(form,fresh.stage)){
    const st=draftRules(rdraft);
    const vals=onScreen||fresh.values||{};
    const miss=missingToMove(form,fresh.stage,vals,isEmpty,st.hiddenFields);
    if(miss.length){rdraft.errors={...(rdraft.errors||{})};miss.forEach(f=>{rdraft.errors[f.id]='Needed before moving on.';});renderMain();toast(`Fill in ${miss.map(f=>f.label).slice(0,3).join(', ')}${miss.length>3?' and more':''} first.`);document.querySelector('.fld.bad')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
  }
  if(m.comment||m.jump){ui.wfAsk={recId:rec.id,to:m.to,label:m.label,need:!!m.comment,comment:'',busy:false};renderMain();setTimeout(()=>document.querySelector('[data-wf-comment]')?.focus(),0);return;}
  await doWfMove(fresh,form,m.target,m.label,'');
}
async function doWfMove(rec,form,target,label,comment){
  const next=assigneeFor(target,rec,store.user?.uid);
  ui.wfBusy=true;
  try{
    await moveStage(rec.id,{stage:target.id,assignee:next.assignee||null,assigneeGroup:next.assigneeGroup||null,stageAt:Date.now()},
      {from:rec.stage||null,fromName:rec.stage?stageName(form,rec):null,to:target.id,toName:target.name,label:String(label||'').slice(0,80),comment:String(comment||'').slice(0,2000),assignee:next.assignee||null,assigneeGroup:next.assigneeGroup||null});
    toast(`Moved to ${target.name} · ${whoHas({...rec,...next})}`);
    if(rdraft?.errors)Object.keys(rdraft.errors).forEach(k=>{if(rdraft.errors[k]==='Needed before moving on.')delete rdraft.errors[k];});
  }catch(e){console.error(e);toast(e?.code==='permission-denied'?'Only the person it’s waiting on, or an administrator, can move it. (Or the latest security rules aren’t deployed yet.)':'Moving it failed. Check your connection and try again.');}
  ui.wfBusy=false;renderMain();
}
/* My work: records waiting on you (or your groups) in any workflow. Admins can see everyone's. */
function viewMyWork(){
  const me=store.user?.uid,groups=store.me?.groups||[],admin=isAdmin(store.me),who=admin?ui.wfWho||'me':'me',now=Date.now();
  const recs=store.records.filter(r=>{const f=formById(r.formId);if(!f||!wfOn(f)||!r.stage||!stageById(f,r.stage))return false;return who==='all'||r.assignee===me||(r.assigneeGroup&&groups.includes(r.assigneeGroup));}).sort((a,b)=>(a.stageAt||0)-(b.stageAt||0));
  const byForm=new Map();recs.forEach(r=>{if(!byForm.has(r.formId))byForm.set(r.formId,[]);byForm.get(r.formId).push(r);});
  const tables=[...byForm].map(([fid,rs])=>{const f=formById(fid);return `<section class="section"><div class="section-h"><h2>${badge(f)}<span>${esc(f.name)}</span> <span class="count">${rs.length}</span></h2></div>
    <div class="panel"><div class="tblwrap"><table class="tbl lv-tbl wf-tbl"><thead><tr><th>${esc(itemName(f))}</th><th>Stage</th>${who==='all'?'<th>Waiting on</th>':''}<th class="num">Waiting</th></tr></thead><tbody>${rs.map(r=>`<tr data-act="open-record" data-id="${esc(r.id)}"><td class="title">${esc(recTitle(r,f))}</td><td>${esc(stageName(f,r))}</td>${who==='all'?`<td>${esc(whoHas(r))}</td>`:''}<td class="num">${esc(waited(r.stageAt,now))}</td></tr>`).join('')}</tbody></table></div></div></section>`;}).join('');
  return `<div class="head"><div class="ttl"><div><h1>My work</h1><p class="sub">${who==='all'?'Every record waiting on someone in a workflow':'Records waiting on you, or a group you’re in'}, longest waiting first.</p></div></div>
    ${admin?`<div class="actions"><div class="segs" role="group" aria-label="Whose work"><button type="button" class="${who==='me'?'on':''}" aria-pressed="${who==='me'}" data-act="wf-who" data-v="me">Mine</button><button type="button" class="${who==='all'?'on':''}" aria-pressed="${who==='all'}" data-act="wf-who" data-v="all">Everyone</button></div></div>`:''}</div>
    ${recs.length?tables:`<div class="panel empty"><h2>Nothing waiting${who==='all'?'':' on you'}</h2><p>When a record reaches a stage that’s yours, it shows up here.</p></div>`}`;
}
const myWorkCount=()=>{const me=store.user?.uid,groups=store.me?.groups||[];return store.records.filter(r=>r.stage&&(r.assignee===me||(r.assigneeGroup&&groups.includes(r.assigneeGroup)))&&wfOn(formById(r.formId))).length;};

/* ---------- Email PDF (administrators) ----------
   Email PDF opens a short form: who to send to (addresses found on this record and the
   records around it, or typed), Cc, a copy to yourself, and the subject and message from the
   form's template. Sending makes the same PDF as Export PDF and hands it to the server
   (emailRecord), which sends it through Gmail and notes it under "Sent emails". */
const ew={recordId:null,unsub:null,list:[]};
function syncEmailWatch(){
  const want=view.name==='record'&&view.recordId?view.recordId:null;
  if(want===ew.recordId)return;
  if(ew.unsub){ew.unsub();ew.unsub=null;}
  Object.assign(ew,{recordId:want,list:[]});
  if(want)ew.unsub=watchEmails(want,list=>{ew.list=list;const el=$('#rec-emails');if(el)el.innerHTML=sentEmailsHTML();});
}
function sentEmailsHTML(){
  if(!ew.list.length||ew.recordId!==view.recordId)return '';
  const row=m=>`<div class="mail-row"><div class="grow"><b>${esc(m.subject||'(no subject)')}</b><span>To ${esc((m.to||[]).join(', '))}${(m.cc||[]).length?' · Cc '+esc(m.cc.join(', ')):''}</span></div><small>${esc(when(m.at))}<br>${esc(m.byName||'')}</small></div>`;
  return `<section class="section"><div class="section-h"><h2>Sent emails <span class="count">${ew.list.length}</span></h2></div><div class="panel mail-list">${ew.list.slice(0,20).map(row).join('')}</div></section>`;
}
function fieldTextByLabel(form,rec,label){
  const n=String(label).trim().toLowerCase();
  const f=(form.fields||[]).find(x=>x.type!=='heading'&&String(x.label||'').trim().toLowerCase()===n);
  if(!f)return undefined;
  return pdfText(f,valOf(f,rec,form));
}
async function openMail(){
  const rec=view.recordId?recById(view.recordId):null,form=rec?formById(rec.formId):null;
  if(!rec||!form||!isAdmin(store.me))return;
  if(rdraft?.dirty){toast('Save your changes first, so the PDF matches what’s saved.');return;}
  const brand=await getExportSettings();
  const ctx={field:l=>fieldTextByLabel(form,rec,l),title:recTitle(rec,form),form:form.name,item:itemName(form),company:brand.companyName||'',sender:realName(store.user?.uid),date:longDate(Date.now())};
  const sugg=emailSuggestions(rec,{formById,recById,records:store.records,recTitle});
  ui.mail={rec:rec.id,sugg,to:new Set(sugg.slice(0,1).map(x=>x.email)),extra:'',cc:'',copyMe:true,attach:true,
    subject:fillTemplate((form.emailSubject||'').trim()||(ctx.company?DEFAULT_SUBJECT:'{Item} {Title}'),ctx).trim(),
    message:fillTemplate((form.emailMessage||'').trim()||(ctx.company?DEFAULT_MESSAGE:DEFAULT_MESSAGE.replace('\n{Company}','')),ctx),busy:false,company:ctx.company};
  renderMain();
  setTimeout(()=>{(document.querySelector('.mail-dlg input[data-mailto]')||document.querySelector('.mail-dlg [data-mail="extra"]'))?.focus();},0);
}
function mailDialog(form,rec){
  const m=ui.mail,me=String(store.me?.email||store.user?.email||'');
  const file=fileNameOf(form,rec);
  return `<div class="lv-scrim mail-scrim" data-act="mail-scrim"><div class="lv-dlg mail-dlg" role="dialog" aria-modal="true" aria-labelledby="mail-h" data-stop-scrim="1">
    <h2 id="mail-h">Email ${esc(itemName(form).toLowerCase())} ${esc(recTitle(rec,form))}</h2>
    <fieldset class="mail-f"${m.busy?' disabled':''}>
    <div class="mail-to"><span class="mlab" id="mail-to-l">To</span>
      ${m.sugg.length?`<div class="mail-sugg" role="group" aria-labelledby="mail-to-l">${m.sugg.map(x=>`<label class="mail-opt"><input type="checkbox" data-mailto="${esc(x.email)}"${m.to.has(x.email)?' checked':''}><span><b>${esc(x.email)}</b><small>${esc(x.who)} · ${esc(x.where)}</small></span></label>`).join('')}</div>`:'<p class="help">No email addresses on this record or the records around it. Type one below.</p>'}
      <input class="in" data-mail="extra" value="${esc(m.extra)}" placeholder="${m.sugg.length?'Other addresses, separated by commas':'name@example.com'}" aria-label="Other addresses to send to" autocomplete="off">
    </div>
    <label class="mail-l"><span class="mlab">Cc</span><input class="in" data-mail="cc" value="${esc(m.cc)}" placeholder="Optional" autocomplete="off"></label>
    <label class="switch mail-copy"><input type="checkbox" data-mail="copyMe"${m.copyMe?' checked':''}><span class="tr"></span><span>Send me a copy${me?' ('+esc(me)+')':''}</span></label>
    <label class="mail-l"><span class="mlab">Subject</span><input class="in" data-mail="subject" value="${esc(m.subject)}" maxlength="200"></label>
    <label class="mail-l"><span class="mlab">Message</span><textarea class="in" data-mail="message" rows="8" maxlength="10000">${esc(m.message)}</textarea></label>
    <label class="switch mail-copy"><input type="checkbox" data-mail="attach"${m.attach?' checked':''}><span class="tr"></span><span>Attach the PDF</span></label>
    ${m.attach?`<p class="mail-att"><span aria-hidden="true">📎</span> ${esc(file)}</p>`:''}
    <p class="help">Sent from your Gmail${m.company?' as '+esc(m.company):''}. Replies come to you, and it’s listed under Sent emails on this ${esc(itemName(form).toLowerCase())}.</p>
    </fieldset>
    <div class="lv-dlgacts"><button type="button" class="btn ghost" data-act="mail-cancel"${m.busy?' disabled':''}>Cancel</button><button type="button" class="btn primary" data-act="mail-send"${m.busy?' disabled':''}>${m.busy?'Sending…':'Send'}</button></div>
  </div></div>`;
}
const fileNameOf=(form,rec)=>pdfFileName(form.name,recTitle(rec,form));
async function sendMail(){
  const m=ui.mail;if(!m||m.busy)return;
  const rec=recById(m.rec),form=rec?formById(rec.formId):null;if(!rec||!form)return;
  const extra=parseEmails(m.extra),cc=parseEmails(m.cc);
  if(extra.bad.length||cc.bad.length){toast(`“${[...extra.bad,...cc.bad][0]}” isn’t an email address.`);return;}
  const to=[...new Set([...m.to,...extra.ok])];
  if(!to.length){toast('Pick or type at least one address.');return;}
  if(to.length+cc.ok.length>10){toast('Send to 10 addresses at most.');return;}
  if(!m.subject.trim()){toast('Add a subject.');return;}
  m.busy=true;renderMain();
  try{
    let pdf={missing:0};
    if(m.attach){
      const {makeRecordPdf,toBase64}=await import('./pdfexport.js');
      pdf=await makeRecordPdf(pdfModel(form,rec));
      if(pdf.bytes.length>8*1024*1024)throw Object.assign(new Error('The PDF is over 8 MB, too big to email.'),{code:'local'});
      pdf.b64=toBase64(pdf.bytes);
    }
    await emailRecord(m.attach?{recordId:rec.id,to,cc:cc.ok,copyMe:m.copyMe,subject:m.subject.trim(),message:m.message,pdf:pdf.b64,fileName:pdf.name}:{recordId:rec.id,to,cc:cc.ok,copyMe:m.copyMe,subject:m.subject.trim(),message:m.message,attach:false});
    ui.mail=null;
    toast(`Emailed to ${to.join(', ')}${pdf.missing?` (${pdf.missing} picture${pdf.missing>1?'s':''} couldn’t be included)`:''}`);
  }catch(e){
    console.error('[formwright] email',e);
    if(ui.mail)ui.mail.busy=false;
    const code=String(e?.code||'');
    toast(code==='functions/not-found'||/not.?found|404/i.test(code)&&!/record/i.test(e?.message||'')?'The email service isn’t set up yet. Deploy the Cadence functions first (see the install steps).'
      :code==='local'||/invalid-argument|failed-precondition|resource-exhausted|unavailable|permission-denied/.test(code)?e.message
      :'The email didn’t go. Check your connection and try again.');
  }
  renderMain();
}

/* ---------- Export PDF ----------
   The record as a document: its fields in order, then its grids, child records and tasks in the
   form's section order. Only what this person can see is included (store.records already is). */
const realName=id=>store.profiles[id]?.displayName||(id===store.user?.uid?(store.profiles[id]?.displayName||store.user?.displayName||'you'):'someone');
const longDate=t=>new Date(t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
function pdfText(f,v){if(f.type==='rating')return isEmpty(v)?'':`${v} of ${f.max||5}`;if(f.type==='textarea')return isEmpty(v)?'':String(v);try{return fmt(f,v)}catch(e){return String(v??'')}}
const pdfNum=f=>(NUMERIC.has(f.type)||f.type==='formula')&&f.type!=='rating';
function pdfModel(form,rec){
  const rs=withStage(rulesOf(form,rec,rec.parentId?recById(rec.parentId):null),form,rec.stage); // what the rules and the stage hide is left out
  const items=(form.fields||[]).filter(f=>!rs.hiddenFields.has(f.id)&&!rs.hidden.has('f:'+f.id)).map(f=>{const v=f.type==='heading'||rs.cleared.has(f.id)?null:valOf(f,rec,form);return fieldItem(f,v,f.type==='heading'?'':pdfText(f,v));});
  const sections=[];
  const grels=gridRels(form),gmap=Object.fromEntries(grels.map(g=>[g.cf.id,g]));
  const kids=Object.fromEntries((form.children||[]).filter(c=>c.display!=='grid').map(c=>formById(c.formId)).filter(cf=>cf&&canViewForm(store.me,cf.id)).map(cf=>[cf.id,cf]));
  sectionOrder(form).forEach(k=>{
    if(rs.hidden.has((gmap[k]?'g:':kids[k]?'c:':'')+k)||(k===TASKS_KEY&&rs.hidden.has('t:tasks')))return;
    if(gmap[k]){
      const {rel,cf}=gmap[k],cols=gridColsFor(form,rel,cf),g=rdraft.grids?.[cf.id],gp=subPrefs(form.id,'g:'+cf.id);
      const rows=g?sortRowsGrid(g,cf,rdraft,gp.sort&&cols.some(f=>f.id===gp.sort.key)?gp.sort:null):[];
      const totals=cols.map(f=>gridTotal(cf,f,rdraft,rows));
      const total=rows.length>1&&totals.some(t=>t!=null)?cols.map((f,i)=>totals[i]==null?(i===0?'Total':''):pdfText(f,totals[i])):null;
      sections.push({title:cf.name,count:rows.length,cols:cols.map(f=>({label:f.label,num:pdfNum(f)})),rows:rows.map(r=>{const st=rowRules(cf,r,rdraft);return cols.map(f=>st.blank.has(f.id)?'':pdfText(f,valOf(f,rowRec(r,cf,rdraft),cf)));}),total,empty:`No ${cf.name.toLowerCase()}.`});
    }else if(kids[k]){
      const cf=kids[k],{ctx,cols,rows}=childRowsOf(form,cf,rec,'');
      sections.push({title:cf.name,count:rows.length,cols:[{label:ctx.tf?.label||itemName(cf)},...cols.map(c=>({label:c.label,num:!!c.num}))],rows:rows.map(r=>[r.title,...r.cells.map(c=>c.text)]),total:null,empty:`No ${cf.name.toLowerCase()} for this ${itemName(form).toLowerCase()}.`});
    }else if(k===TASKS_KEY&&tw.recordId===rec.id&&tw.status==='ready'){
      const {cols,rows}=taskRows(subPrefs(form.id,'t:tasks'),'',dateKey(new Date()),Date.now());
      sections.push({title:'Tasks',count:rows.length,cols:[{label:'Task'},...cols.map(c=>({label:c.label,num:!!c.num}))],rows:rows.map(r=>[r.title.text,...r.cells.map(c=>c.text)]),total:null,empty:`No tasks for this ${itemName(form).toLowerCase()}.`});
    }
  });
  const parent=rec.parentId?recById(rec.parentId):null,pform=parent?formById(parent.formId):null;
  const meta=[rec.createdAt?`Created ${longDate(rec.createdAt)} by ${realName(rec.createdBy||rec.ownerId)}`:'',
    rec.updatedAt&&rec.updatedAt!==rec.createdAt?`Last updated ${longDate(rec.updatedAt)}${rec.updatedBy?' by '+realName(rec.updatedBy):''}`:'',
    `Owner ${realName(rec.ownerId)}`];
  const now=new Date();
  return {accent:colorOf(form),formName:form.name,title:recTitle(rec,form),meta,parent:parent&&pform?`${pform.name}: ${recTitle(parent,pform)}`:null,items,sections,
    stamp:`Exported ${now.toLocaleString(undefined,{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} by ${realName(store.user?.uid)}`};
}
async function exportPdf(){
  const rec=view.recordId?recById(view.recordId):null,form=rec?formById(rec.formId):null;
  if(!rec||!form||ui.pdfBusy)return;
  if(rdraft?.dirty){toast('Save your changes first, so the PDF matches what’s saved.');return;}
  ui.pdfBusy=true;const paint=()=>{const b=$('#pdf-btn');if(b){b.disabled=!!ui.pdfBusy;b.textContent=ui.pdfBusy?'Making PDF…':'Export PDF';}};paint();
  try{
    const {exportRecordPdf}=await import('./pdfexport.js');
    const r=await exportRecordPdf(pdfModel(form,rec));
    toast(r.missing?`Downloaded ${r.name}. ${r.missing} picture${r.missing>1?'s':''} couldn’t be included.`:`Downloaded ${r.name}`);
  }catch(e){console.error('[formwright] PDF',e);toast(/Failed to fetch|dynamically imported|Importing a module/i.test(String(e?.message))?'Couldn’t load the PDF maker. Check your connection and try again.':'Couldn’t make the PDF. Try again.');}
  finally{ui.pdfBusy=false;paint();}
}

/* ---------- Sections under the fields: columns, sort and how many show ----------
   Grids ('g:'), child records ('c:') and Tasks ('t:tasks') each have a tool bar at the top
   (search, Columns, Show, then Add / Attach) and a sortable table. Choices are kept per person
   on this device (sublogic.js). Phones get cards with a Sort menu. */
let subsCache=null;
function subsAll(){const k=subStoreKey(store.user?.uid);if(!subsCache||subsCache.k!==k){let raw=null;try{raw=localStorage.getItem(k)}catch(e){}subsCache={k,v:readSubs(raw)};}return subsCache.v;}
function subPrefs(formId,k){return prefsOf(subsAll(),formId,k);}
function saveSub(formId,k,patch){const all=setPrefs(subsAll(),formId,k,patch);subsCache.v=all;try{localStorage.setItem(subsCache.k,JSON.stringify(all))}catch(e){/* private mode: kept for this visit */}}
/** A section's current columns and how its headings first sort. */
function subCols(formId,k){
  const form=formById(formId);if(!form)return null;
  if(k==='t:tasks'){const p=subPrefs(formId,k);return {cur:colsFor(p.cols,TASK_COLS,TASK_DEFAULT),min:0,firstDir:x=>{const c=TASK_COLS.find(y=>y.key===x);return c&&(c.num||c.date)?'desc':'asc';}};}
  const cf=formById(k.slice(2));if(!cf)return null;
  if(k.startsWith('g:')){const g=gridRels(form).find(x=>x.cf.id===cf.id);if(!g)return null;return {cur:gridColsFor(form,g.rel,cf).map(f=>f.id),min:1,firstDir:x=>{const f=cf.fields.find(y=>y.id===x);return f&&(NUMERIC.has(f.type)||f.type==='formula')&&f.type!=='rating'?'desc':'asc';}};}
  const ctx=childCtx(cf),p=subPrefs(formId,k);
  return {cur:colsFor(p.cols,ctx.catalog,ctx.defaults),min:0,firstDir:x=>{const c=ctx.byKey.get(x);return c&&(c.num||x==='sys:updated'||x==='sys:created')?'desc':'asc';}};
}
const subNoun=(cf,n)=>n===1?itemName(cf).toLowerCase():cf.name.toLowerCase();
function subSearch(k,label,q,shown,all,anyNew){return `<input type="search" class="in sub-q" data-ksearch="${esc(k)}" value="${esc(q)}" placeholder="Search ${esc(label.toLowerCase())}" aria-label="Search ${esc(label)}">${q.trim()?`<span class="help sub-n" role="status">Showing ${shown} of ${all}${anyNew?'; new rows always show':''}</span>`:''}`;}

/** Child records: the columns on offer and the starting ones (the form's own list columns). */
function childCtx(cf){
  const tf=titleFieldOf(cf);
  const kidForms=(cf.children||[]).map(c=>formById(c.formId)).filter(x=>x&&canViewForm(store.me,x.id));
  const catalog=columnCatalog({form:cf,titleField:tf,parents:[],children:kidForms});
  const saved=store.listViews.find(v=>v.id===defaultViewId(cf.id));
  const defaults=(Array.isArray(saved?.cols)?saved.cols:defaultConfig({form:cf,titleField:tf,parents:[]}).cols).filter(x=>x!=='parent'&&!x.startsWith('p:'));
  return {tf,catalog,byKey:new Map(catalog.map(c=>[c.key,c])),defaults};
}
function childCells(cf){
  const kids=new Map();store.records.forEach(r=>{if(r.parentId){const x=r.parentId+'|'+r.formId;kids.set(x,(kids.get(x)||0)+1);}});
  return {form:cf,formById,recById,valOf,fmt,recTitle:(r,f)=>recTitle(r,f),kids:(id,fid)=>kids.get(id+'|'+fid)||0,nameOf:u=>store.profiles[u]?.displayName||(u===store.user?.uid?'You':'Someone')};
}
/** A child form's records under this record: cells, sorted, searched. */
function childRowsOf(form,cf,rec,q){
  const k='c:'+cf.id,p=subPrefs(form.id,k),ctx=childCtx(cf);
  const cols=colsFor(p.cols,ctx.catalog,ctx.defaults).map(x=>ctx.byKey.get(x));
  const h=childCells(cf);
  const sort=p.sort&&(p.sort.key==='title'||ctx.byKey.has(p.sort.key))?p.sort:{key:'sys:updated',dir:'desc'};
  let rows=store.records.filter(r=>r.parentId===rec.id&&r.formId===cf.id).map(r=>({rec:r,title:recTitle(r,cf),cells:cols.map(c=>cellOf(c.key,r,h))}));
  const total=rows.length;
  // search looks at every field, not only the columns shown
  const hayFields=(cf.fields||[]).filter(f=>!['heading','file','image','signature'].includes(f.type));
  if(q&&q.trim())rows=rows.filter(r=>searchHit([r.title,...r.cells.map(c=>c.text),...hayFields.map(f=>{try{return fmt(f,valOf(f,r.rec,cf))}catch(e){return ''}})].join(' • '),q));
  const si=cols.findIndex(c=>c.key===sort.key);
  rows.forEach(r=>{r.sortVal=sort.key==='title'?cellOf('title',r.rec,h).sort:si>=0?r.cells[si].sort:cellOf(sort.key,r.rec,h).sort;});
  return {k,p,ctx,cols,sort,total,rows:sortByVal(rows,sort.dir)};
}
function childSection(form,cf,rec,ro){
  const kq=(rdraft.kq||{})['c:'+cf.id]||'';
  const {k,p,ctx,cols,sort,total,rows}=childRowsOf(form,cf,rec,kq);
  const latest=store.records.filter(r=>r.parentId===rec.id&&r.formId===cf.id).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0];
  const cOpen=!folded(form.id,k);
  const cHead=`<div class="section-h"><h2>${foldBtn(k,cOpen,`${badge(cf)}<span>${esc(cf.name)}</span> <span class="count">${total}</span>`,latest?'latest: '+recTitle(latest,cf):'')}</h2></div>`;
  if(!cOpen)return `<section class="section" id="kids-${cf.id}">${cHead}</section>`;
  const lim=limitRows(rows,p.show);
  const titleLabel=ctx.tf?.label||itemName(cf);
  const detachable=r=>!ro&&canEditRecord(store.me,r);
  const buttons=`${canCreate(store.me,cf.id)?`<button class="btn sm" data-act="add-child" data-id="${cf.id}">+ Add ${esc(itemName(cf).toLowerCase())}</button>`:''}${ro?'':`<button class="btn sm" data-act="child-attach" data-id="${cf.id}">Attach existing</button>`}`;
  const tools=total?colsTool(k,ui.subPop===k,cols.map(c=>({key:c.key,label:c.label,src:c.src})),ctx.catalog,{fixed:titleLabel})+showMenu(k,p.show,total)+sortMenu(k,[{key:'title',label:titleLabel},...cols],sort,''):'';
  const bar=toolBar({search:total>5||kq?subSearch(k,cf.name,kq,rows.length,total):'',tools,buttons});
  const det=r=>detachable(r.rec)?`<button type="button" class="ibtn at-det" data-act="child-detach" data-id="${r.rec.id}" aria-label="Detach ${esc(r.title)} (keeps it)" title="Detach: take it off this ${esc(itemName(form).toLowerCase())} but keep it">${DETACH_ICON}</button>`:'';
  const cell=c=>`<td${c.num?' class="num"':c.long?` class="lv-long" title="${esc(c.text)}"`:c.text&&c.text.length>30?` title="${esc(c.text)}"`:''}>${esc(c.text)}</td>`;
  const body=!total?`<p class="note">No ${esc(cf.name.toLowerCase())} for this ${esc(itemName(form).toLowerCase())} yet.</p>`
    :!rows.length?`<p class="note">No ${esc(cf.name.toLowerCase())} match “${esc(kq)}”.</p>`
    :`<div class="sub-box"><div class="tblwrap"><table class="tbl lv-tbl sub-tbl"><thead><tr>${subHead(k,{key:'title',label:titleLabel},sort)}${cols.map(c=>subHead(k,c,sort)).join('')}<th class="sub-act"><span class="sr">Actions</span></th></tr></thead>
      <tbody>${lim.rows.map(r=>`<tr data-act="open-record" data-id="${r.rec.id}"><td class="title" title="${esc(r.title)}">${esc(r.title)}</td>${r.cells.map(cell).join('')}<td class="sub-act">${det(r)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="sub-cards">${lim.rows.map(r=>{const meta=cols.map((c,i)=>r.cells[i].text?`<span>${esc(c.label)}: ${esc(r.cells[i].text)}</span>`:'').filter(Boolean).slice(0,4).join('');const card=`<button class="card" data-act="open-record" data-id="${r.rec.id}"><b>${esc(r.title)}</b>${meta?`<div class="meta">${meta}</div>`:''}</button>`;return det(r)?`<div class="at-card">${card}${det(r)}</div>`:card;}).join('')}</div>
      ${moreLine(k,lim.rows.length,rows.length,subNoun(cf,rows.length))}`;
  return `<section class="section" id="kids-${cf.id}">${cHead}<div class="panel subsec">${bar}${body}</div></section>`;
}

/** The columns a grid shows for this person: their choice, else the ones set in the form designer. */
function gridColsFor(form,rel,cf){
  const usable=(cf.fields||[]).filter(f=>f.type!=='heading');
  const p=subPrefs(form.id,'g:'+cf.id);
  const keys=colsFor(p.cols,usable.map(f=>({key:f.id})),gridCols(rel,cf).map(f=>f.id),{min:1});
  return keys.map(id=>usable.find(f=>f.id===id)).filter(Boolean);
}

/* ---------- Sub-form grids ----------
   A child form whose relationship is shown as a grid is edited inside the parent record.
   Rows live in rdraft.grids[childFormId] = {rows:[{id, values, ownerId, createdAt, isNew, dirty, errors}], removed:[ids], sort}
   and are saved with the parent in one batch (saveRecordBundle). Long text, files, photos,
   signatures, locations and multiple choice open in a pop-up (cdraft) from their cell. */
/* ---------- folding sections (per user, per form; remembered on this device) ---------- */
let foldState=null,foldUid=null;
const foldStoreKey=()=>'fw.folds.'+(store.user?.uid||'anon');
function folds(){
  if(foldState&&foldUid===store.user?.uid)return foldState;
  let raw=null;try{raw=localStorage.getItem(foldStoreKey());}catch(e){/* private mode */}
  foldUid=store.user?.uid;foldState=readFolds(raw);return foldState;
}
function saveFolds(f){foldState=f;try{localStorage.setItem(foldStoreKey(),JSON.stringify(f));}catch(e){/* private mode: kept for this visit */}}
const folded=(formId,key)=>isFolded(folds(),formId,key);
const CHEV='<svg class="fold-c" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
/** The heading of a foldable section: a button that says whether it's open, plus a summary when folded. */
function foldBtn(key,open,inner,summary){return `<button type="button" class="fold-t" data-act="fold" data-k="${esc(key)}" aria-expanded="${open}">${CHEV}${inner}${!open&&summary?`<span class="fold-sum">${esc(summary)}</span>`:''}</button>`;}
/** The search box at the top of a sub-form grid or a child section (shown from 6 rows, or while searching). */
function kSearch(key,cf,q,shown,all,anyNew){
  return `<div class="ksearch"><input type="search" class="in" data-ksearch="${esc(key)}" value="${esc(q)}" placeholder="Search ${esc(cf.name.toLowerCase())}" aria-label="Search ${esc(cf.name)}">${q.trim()?`<span class="help" role="status">Showing ${shown} of ${all}${anyNew?'; new rows always show':''}</span>`:''}</div>`;
}
function recordFoldKeys(form,rec){
  const grids=gridRels(form).map(x=>x.cf.id);
  const kids=rec?(form.children||[]).filter(c=>c.display!=='grid').map(c=>formById(c.formId)).filter(cf=>cf&&canViewForm(store.me,cf.id)).map(cf=>cf.id):[];
  return foldKeys(form,grids,kids).concat(rec?['t:tasks']:[]).concat(rec&&wfOn(form)?[WF_KEY]:[]);
}
const SORT_H={valOf:(f,r,fm)=>valOf(f,r,fm),fmt:(f,v)=>fmt(f,v),recTitle:(r,fm)=>recTitle(r,fm),recById:id=>recById(id),formById:id=>formById(id)};
const DETACH_ICON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 4 8"/><path d="M8 12h3"/><path d="M3 3l18 18"/></svg>';
const POPUP_TYPES=new Set(['textarea','file','image','signature','location','multiselect']);
const GRID_SUM=new Set(['number','decimal','currency']);
let cdraft=null;
function gridRels(form){return (form.children||[]).filter(c=>c.display==='grid').map(rel=>({rel,cf:formById(rel.formId)})).filter(x=>x.cf&&x.cf.id!==form.id&&canViewForm(store.me,x.cf.id));}
function gridCols(rel,cf){
  const usable=(cf.fields||[]).filter(f=>f.type!=='heading');
  const picked=Array.isArray(rel.cols)&&rel.cols.length?rel.cols.map(id=>usable.find(f=>f.id===id)).filter(Boolean):usable.filter(f=>!POPUP_TYPES.has(f.type)).slice(0,8);
  return picked.length?picked:usable.slice(0,1);
}
/** Add a moved record's recalculated values (PARENT() and friends) to its attach/detach change. */
function withFormulas(cf,rec,ch){const values={...(rec.values||{}),...ch.set};const r={...rec,values,parentId:ch.parentId};(cf.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const c=calc(cf,f,r);const v=c.e?null:c.v;if((rec.values||{})[f.id]!==v)ch.set[f.id]=v;});return ch;}
function rowRec(row,cf,d){return {id:row.id,formId:cf.id,values:row.values,parentId:d.recordId||null,ownerId:row.ownerId,_parentDraft:d};}
function syncGrids(d,rec,rels){
  d.grids=d.grids||{};
  rels.forEach(({cf})=>{
    let g=d.grids[cf.id];
    if(!g)g=d.grids[cf.id]={rows:[],removed:[],detached:[],sort:null};
    if(!d.dirty){
      g.rows=rec?store.records.filter(r=>r.parentId===rec.id&&r.formId===cf.id).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).map(r=>({id:r.id,values:clone(r.values||{}),ownerId:r.ownerId,createdAt:r.createdAt,isNew:false,dirty:false,errors:{}})):[];
      g.removed=[];g.detached=[];
    }
  });
}
function newRowValues(cf,d,parentForm){
  const values={};
  (cf.fields||[]).forEach(f=>{if(f.type==='checkbox')values[f.id]=false;if(f.type==='range')values[f.id]=f.min??0;if(f.type==='relation'&&f.relForm===parentForm.id&&d.recordId)values[f.id]=d.recordId;});
  return values;
}
function rowEditable(row,cf){return row.isNew?canCreate(store.me,cf.id):canEditRecord(store.me,{formId:cf.id,ownerId:row.ownerId});}
function sortRowsGrid(g,cf,d,sort){
  const old=g.rows.filter(r=>!r.isNew),fresh=g.rows.filter(r=>r.isNew).reverse(); // new rows at the top, newest first
  if(!sort)return fresh.concat(old);
  const f=(cf.fields||[]).find(x=>x.id===sort.key);if(!f)return fresh.concat(old);
  const val=r=>{const v=valOf(f,rowRec(r,cf,d),cf);if(v==null||v==='')return null;if(typeof v==='number'||typeof v==='boolean')return Number(v);if(['date','datetime','time'].includes(f.type))return String(v);if(f.type==='relation'){const t=recById(v);return t?titleSortOf(t,formById(t.formId),SORT_H):null;}return fmt(f,v).toLowerCase();};
  return fresh.concat(sortByVal(old.map(r=>({r,sortVal:val(r)})),sort.dir).map(x=>x.r));
}
function popupSummary(f,v){
  if(isEmpty(v))return '';
  if(f.type==='textarea'){const s=String(v);return s.length>36?s.slice(0,36)+'…':s;}
  return fmt(f,v);
}
function gridCell(cf,row,f,d,ro){
  if(cf.rules?.length){const st=row._rs||(row._rs=rowRules(cf,row,d));if(st.blank.has(f.id))return `<span class="gcalc rule-na" title="${st.cleared.has(f.id)?'Cleared':'Hidden'} by a rule">—</span>`;}
  const ids=`data-grid="${cf.id}" data-row="${row.id}" data-gf="${f.id}"`,v=row.values[f.id],val=v==null?'':esc(v),dis=ro?' disabled':'';
  const lab=` aria-label="${esc(f.label)}"`;
  if(f.type==='autonumber'){const live=row.isNew?null:recById(row.id);const t=live?.nums?.[f.id];return `<span class="gcalc gauto">${esc(t||(row.isNew?'On save':'…'))}</span>`;}
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
  const g=d.grids[cf.id];const k='g:'+cf.id,p=subPrefs(form.id,k);const cols=gridColsFor(form,rel,cf);
  const sort=p.sort&&cols.some(f=>f.id===p.sort.key)?p.sort:null;
  const allRows=sortRowsGrid(g,cf,d,sort);
  // search across the grid's columns; new rows and rows with a problem always show
  const q=(d.kq||{})[k]||'';
  const bad=r=>!!(r.errors&&Object.keys(r.errors).length);
  const rowText=row=>cols.map(f=>{try{const v=valOf(f,rowRec(row,cf,d),cf);return f.type==='formula'?fmtCalc(f,v):fmt(f,v);}catch(e){return ''}}).join(' • ');
  const found=q.trim()?allRows.filter(r=>r.isNew||bad(r)||searchHit(rowText(r),q)):allRows;
  const lim=limitRows(found,p.show,r=>r.isNew||bad(r));
  const rows=lim.rows;
  const mayAdd=!parentRo&&canCreate(store.me,cf.id);
  const errs=[];
  const body=rows.map((row,i)=>{
    const ro=parentRo||!rowEditable(row,cf);
    if(bad(row))Object.entries(row.errors).forEach(([fid,m])=>{const f=cf.fields.find(x=>x.id===fid);errs.push(`${row.isNew?'New row':'Row '+(i+1)}: ${f?f.label+' – ':''}${m}`);});
    if(cf.rules?.length)row._rs=rowRules(cf,row,d);
    return `<tr class="${row.isNew?'gnew':''}${bad(row)?' gbad':''}" data-growid="${row.id}"${ro?' data-ro="1"':''}>${cols.map(f=>`<td data-gcol="${f.id}" class="${(NUMERIC.has(f.type)||f.type==='formula')&&f.type!=='rating'?'num':''}${row.errors?.[f.id]?' bad':''}">${gridCell(cf,row,f,d,ro)}</td>`).join('')}
      <td class="gact">${row.isNew?'':`<button type="button" class="ibtn" data-act="open-record" data-id="${row.id}" aria-label="Open this row on its own" title="Open on its own">↗</button>`}${ro||row.isNew?'':`<button type="button" class="ibtn at-det" data-act="grid-detach" data-grid="${cf.id}" data-row="${row.id}" aria-label="Detach row ${i+1} (keeps the ${esc(itemName(cf).toLowerCase())})" title="Detach: take it off this ${esc(itemName(form).toLowerCase())} but keep it">${DETACH_ICON}</button>`}${ro?'':`<button type="button" class="ibtn" data-act="grid-del" data-grid="${cf.id}" data-row="${row.id}" aria-label="Delete row ${i+1}" title="Delete row">✕</button>`}</td></tr>`;
  }).join('');
  const totals=cols.map(f=>gridTotal(cf,f,d,allRows)); // totals always cover every row
  const showTot=allRows.length>1&&totals.some(t=>t!=null);
  const isNum=f=>(NUMERIC.has(f.type)||f.type==='formula')&&f.type!=='rating';
  const head=cols.map(f=>{const on=sort?.key===f.id;return `<th${isNum(f)?' class="num"':''} aria-sort="${on?(sort.dir==='asc'?'ascending':'descending'):'none'}"><button type="button" class="ghb${on?' on':''}" data-act="sub-sort" data-k="${k}" data-v="${f.id}">${esc(f.label)}${f.required?'<span class="req">*</span>':''}<span class="arr" aria-hidden="true">${on?(sort.dir==='asc'?'▲':'▼'):''}</span></button></th>`;}).join('');
  const gOpen=!folded(form.id,k)||errs.length>0;
  const gSum=cols.map((f,i)=>totals[i]==null?'':`${f.label} ${f.type==='formula'?fmtCalc(f,totals[i]):fmt(f,totals[i])}`).filter(Boolean).slice(0,3).join(' · ');
  const gHead=`<div class="section-h"><h2>${foldBtn(k,gOpen,`${badge(cf)}<span>${esc(cf.name)}</span> <span class="count">${allRows.filter(r=>!r.isNew).length}</span>`,gSum)}</h2><span class="chip acc">Grid</span></div>`;
  if(!gOpen)return `<section class="section gsec" id="grid-${cf.id}">${gHead}</section>`;
  const usable=(cf.fields||[]).filter(f=>f.type!=='heading');
  const buttons=`${mayAdd?`<button type="button" class="btn sm" data-act="grid-add" data-grid="${cf.id}">+ Add ${esc(itemName(cf).toLowerCase())}</button>`:''}${parentRo?'':`<button type="button" class="btn sm" data-act="grid-attach" data-grid="${cf.id}">Attach existing</button>`}`;
  const tools=colsTool(k,ui.subPop===k,cols.map(f=>({key:f.id,label:f.label})),usable.map(f=>({key:f.id,label:f.label,group:''})),{min:1})+(allRows.length?showMenu(k,p.show,allRows.filter(r=>!r.isNew).length):'');
  const hint=(sort?'Click a heading again to reverse. ':'Click a heading to sort. ')+(mayAdd?'New rows stay at the top until you save.':'');
  const bar=toolBar({search:allRows.length>5||q?subSearch(k,cf.name,q,found.filter(r=>!r.isNew).length,allRows.filter(r=>!r.isNew).length,allRows.some(r=>r.isNew)):'',tools,buttons,hint});
  const nouns=subNoun(cf,found.length);
  return `<section class="section gsec" id="grid-${cf.id}">${gHead}
    <div class="panel subsec">${bar}<div class="gwrap"><table class="gtbl"><thead><tr>${head}<th class="gact"><span class="sr">Row actions</span></th></tr></thead>
      <tbody>${body||`<tr><td class="gempty" colspan="${cols.length+1}">${q.trim()&&allRows.length?`No ${esc(cf.name.toLowerCase())} match “${esc(q)}”.`:`No ${esc(cf.name.toLowerCase())} yet.`}</td></tr>`}</tbody>
      ${showTot?`<tfoot><tr>${cols.map((f,i)=>`<td class="num" id="gt-${cf.id}-${f.id}">${totals[i]==null?(i===0?(rows.length<allRows.length?`Total (all ${allRows.length})`:'Total'):''):esc(f.type==='formula'?fmtCalc(f,totals[i]):fmt(f,totals[i]))}</td>`).join('')}<td></td></tr></tfoot>`:''}
    </table></div>
    ${errs.length?`<div class="gerrs" role="alert">${errs.slice(0,6).map(e=>`<p>${esc(e)}</p>`).join('')}</div>`:''}
    ${moreLine(k,rows.length,found.length,nouns)}</div></section>`;
}
function refreshGrids(d){
  if(!d?.grids)return;
  const form=formById(d.formId);if(!form)return;
  gridRels(form).forEach(({rel,cf})=>{
    const g=d.grids[cf.id];if(!g)return;const cols=gridColsFor(form,rel,cf);
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
  const st=scope==='cell'?NO_RULES:(d._rs=draftRules(d));
  if(scope!=='record')return `<div class="fgrid" data-scope="${scope}">${fs.map(f=>fieldOut(d,f,scope,st)).join('')}</div>`;
  // record page: a Section Heading folds the fields under it (a section with a problem stays open)
  const under=headingOf(fs),shut=new Set();
  fs.filter(f=>f.type==='heading').forEach(h=>{if(folded(form.id,'h:'+h.id)&&!fs.some(f=>under[f.id]===h.id&&d.errors?.[f.id]))shut.add(h.id);});
  return `<div class="fgrid" data-scope="${scope}">${fs.map(f=>{
    if(f.type==='heading'){
      const open=!shut.has(f.id),kids=fs.filter(x=>under[x.id]===f.id);
      const vals=kids.filter(x=>!['file','image','signature','textarea','formula','location'].includes(x.type)).map(x=>{let t='';try{t=fmt(x,d.values[x.id])}catch(e){}return t?x.label+': '+t:''}).filter(Boolean).slice(0,2);
      const sum=kids.length+' field'+(kids.length===1?'':'s')+(vals.length?' · '+vals.join(' · '):'');
      return `<div class="fsec${st.hidden.has('f:'+f.id)?' rule-off':''}" id="fb-${scope}-${f.id}"><h3>${foldBtn('h:'+f.id,open,`<span>${esc(f.label)}</span>`,sum)}</h3>${open&&f.help?`<p class="help">${esc(f.help)}</p>`:''}</div>`;
    }
    const html=fieldOut(d,f,scope,st);
    return under[f.id]&&shut.has(under[f.id])?html.replace(/^<div /,'<div hidden '):html;
  }).join('')}</div>`;
}
function fieldBlock(f,v,err,scope,locked){
  if(f.type==='heading')return `<div class="fsec" id="fb-${scope}-${f.id}"><h3>${esc(f.label)}</h3>${f.help?`<p class="help">${esc(f.help)}</p>`:''}</div>`;
  const id=`in-${scope}-${f.id}`;
  const lab=['radio','multiselect','rating','checkbox','formula','autonumber'].includes(f.type)?`<span class="flabel" id="lb-${id}">${esc(f.label)}${f.required?'<span class="req">*</span>':''}</span>`:`<label class="flabel" for="${id}">${esc(f.label)}${f.required?'<span class="req">*</span>':''}</label>`;
  if(locked)return `<div class="fld w-${f.width==='half'?'half':'full'} locked${locked==='view'?' viewonly':''}" id="fb-${scope}-${f.id}">${lab}<div class="lockw" inert>${control(f,locked==='view'?v:null,id,scope)}</div><p class="help rule-note">${locked==='view'?'View only at this stage':'Cleared by a rule'}</p></div>`;
  return `<div class="fld w-${f.width==='half'?'half':'full'}${err?' bad':''}" id="fb-${scope}-${f.id}">${lab}${control(f,v,id,scope)}${f.help?`<p class="help">${esc(f.help)}</p>`:''}${err?`<p class="err">${esc(err)}</p>`:''}</div>`;
}
function control(f,v,id,scope){
  const a=`id="${id}" data-fid="${f.id}"`,ph=f.placeholder?` placeholder="${esc(f.placeholder)}"`:'';
  const mm=(f.min!=null&&f.min!==''?` min="${f.min}"`:'')+(f.max!=null&&f.max!==''?` max="${f.max}"`:'');
  const val=v==null?'':esc(v);
  switch(f.type){
    case 'autonumber':return autoControl(f,scope);
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
/* ---------- Auto number fields ----------
   The server gives the number when a record is first saved (records/{id}.nums); the app only
   shows it. Admins can change one (Change…), with a warning; the server keeps it unique. */
const thisYear=()=>new Date().getFullYear();
function autoControl(f,scope){
  if(scope==='preview'){const s=autoSettings(f);return `<div class="calc auto">${esc(formatAuto(f,s.start,thisYear()))}</div><span class="fxsrc">Given out when a record is first saved</span>`;}
  const d=draftFor(scope);
  const recId=scope==='record'?d?.recordId:scope==='cell'&&cdraft?._row&&!cdraft._row.isNew?cdraft._row.id:null;
  if(!recId)return `<div class="calc auto muted">Assigned when you save</div>`;
  const t=recById(recId)?.nums?.[f.id]||'';
  if(!t)return `<div class="calc auto muted">Being assigned…</div>${isAdmin(store.me)?'<span class="fxsrc">Still waiting after a minute? Form designer → this field → Number them now.</span>':''}`;
  const ed=ui.anEdit&&ui.anEdit.rec===recId&&ui.anEdit.fid===f.id?ui.anEdit:null;
  if(!ed)return `<div class="autow"><div class="calc auto">${esc(t)}</div>${isAdmin(store.me)&&scope==='record'?`<button type="button" class="btn sm ghost" data-act="an-edit" data-fid="${f.id}">Change…</button>`:''}</div>`;
  return `<div class="anedit" role="group" aria-label="Change ${esc(f.label)}">
    <p class="anwarn"><b>Change this number only to fix a mistake.</b> Copies already sent or printed will still show ${esc(t)}. The new number must not be used on another ${esc(formById(d.formId)?itemName(formById(d.formId)).toLowerCase():'record')}, and the change is noted on the record.</p>
    <div class="row2"><input class="in" data-anval="1" value="${esc(ed.value)}" maxlength="60" aria-label="New number"${ed.busy?' disabled':''}><button type="button" class="btn sm primary" data-act="an-save"${ed.busy?' disabled':''}>${ed.busy?'Saving…':'Save number'}</button><button type="button" class="btn sm ghost" data-act="an-cancel"${ed.busy?' disabled':''}>Cancel</button></div></div>`;
}

function draftRec(d){return {id:d.recordId||null,formId:d.formId,values:d.values,parentId:d.parentId||null,_draft:d.grids?d:null};}
/* ---------- Show/hide rules on records (rules.js) ----------
   Worked out from what's on screen as people type (the record, its parent, a grid row's parent
   record). Hidden fields and fields a rule clears are emptied when the record is saved. */
function parentGetter(parent){
  return (src,fid)=>{if(!parent||parent.formId!==src)return null;const pf=formById(src);const f=withStageField(pf)?.fields?.find(x=>x.id===fid);if(!f)return null;return {f,v:fid===STAGE_FIELD?stageName(pf,parent):f.type==='autonumber'?recById(parent.id)?.nums?.[fid]:valOf(f,parent,pf)};};
}
function rulesOf(form,recLike,parent){
  if(!form?.rules?.length)return NO_RULES;
  const sf=withStageField(form);
  const pg=parentGetter(parent),byId=new Map((sf.fields||[]).map(f=>[f.id,f]));
  return evalRules(sf,(src,fid)=>{if(src!=='self')return pg(src,fid);const f=byId.get(fid);if(!f)return null;return {f,v:fid===STAGE_FIELD?stageName(form,recLike):f.type==='autonumber'?(recLike.nums||recById(recLike.id)?.nums||{})[fid]:valOf(f,recLike,form)};});
}
/** The rules, plus what the record's workflow stage hides, shows read-only or needs before moving on. */
function withStage(st,form,stage){
  if(!wfOn(form)||!stage)return st;
  const sv=stageView(form,stage);
  if(!sv.hide.size&&!sv.view.size&&!sv.req.size&&!sv.keys.size)return st;
  const hidden=new Set([...st.hidden,...sv.keys,...[...sv.hide].map(id=>'f:'+id)]);
  return {...st,hidden,hiddenFields:new Set([...st.hiddenFields,...sv.hide]),view:sv.view,moveReq:sv.req,
    required:f=>!sv.hide.has(f.id)&&!sv.view.has(f.id)&&st.required(f)};
}
/** The rules for a draft on screen: the record being edited, or the designer's Try it. */
function draftRules(d){
  if(!d||d===cdraft)return NO_RULES;
  if(d===pdraft)return fdraft?withStage(rulesOf(fdraft,{id:null,formId:fdraft.id,values:d.values,stage:d._stage||null},d._parent||null),fdraft,d._stage||null):NO_RULES;
  const form=formById(d.formId);
  const stage=d.recordId?recById(d.recordId)?.stage||null:null;
  return withStage(rulesOf(form,{...draftRec(d),stage},d.parentId?recById(d.parentId):null),form,stage);
}
/** A grid row's rules: its own form's, with the record on screen as its parent. */
function rowRules(cf,row,d){return cf?.rules?.length?rulesOf(cf,rowRec(row,cf,d),draftRec(d)):NO_RULES;}
/** One field on a record page, as the rules have it: hidden, locked (cleared) or required. */
function fieldOut(d,f,scope,st){
  st=st||NO_RULES;
  const off=st.hiddenFields.has(f.id)||st.hidden.has('f:'+f.id);
  let html;
  if(st.cleared.has(f.id))html=fieldBlock({...f,required:false},null,null,scope,true);
  else if(st.view?.has(f.id))html=fieldBlock({...f,required:false},d.values[f.id],null,scope,'view');
  else if(st.moveReq?.has(f.id))html=fieldBlock({...f,required:true},d.values[f.id],d.errors?.[f.id],scope);
  else if(f.type==='heading'||!holdsValue(f)||st.required(f)===!!f.required)html=fieldBlock(f,d.values[f.id],d.errors?.[f.id],scope);
  else html=fieldBlock({...f,required:st.required(f)},d.values[f.id],d.errors?.[f.id],scope);
  return off?html.replace(/^<div class="/,'<div class="rule-off '):html;
}
const RULE_SECTIONS=k=>k.startsWith('g:')?'grid-'+k.slice(2):k.startsWith('c:')?'kids-'+k.slice(2):k==='t:tasks'?'rec-tasks':null;
/** After a change: show and hide what the rules say, and redraw fields whose lock or required mark changed. */
function applyRules(d){
  if(!d||(d!==rdraft&&d!==pdraft))return;
  const form=formOfDraft(d);if(!form)return;
  const scope=scopeOf(d),prev=d._rs||NO_RULES,st=draftRules(d);d._rs=st;
  (form.fields||[]).forEach(f=>{
    const el=document.getElementById(`fb-${scope}-${f.id}`);if(!el)return;
    el.classList.toggle('rule-off',st.hiddenFields.has(f.id)||st.hidden.has('f:'+f.id));
    if(f.type==='heading')return;
    if(prev.cleared.has(f.id)!==st.cleared.has(f.id)||prev.required(f)!==st.required(f)||!!prev.view?.has(f.id)!==!!st.view?.has(f.id)||!!prev.moveReq?.has(f.id)!==!!st.moveReq?.has(f.id)){repaint(d,f);const c=document.querySelector(`#fb-${scope}-${f.id} canvas[data-sig]`);if(c)initSig(c);}
  });
  if(d===rdraft){
    ['g:','c:'].forEach(pre=>(form.children||[]).forEach(c=>{const el=document.getElementById(RULE_SECTIONS(pre+c.formId));if(el)el.classList.toggle('rule-off',st.hidden.has(pre+c.formId));}));
    const t=document.getElementById('rec-tasks');if(t)t.classList.toggle('rule-off',st.hidden.has('t:tasks'));
    refreshRowRules(d);
  }
  if(d===pdraft)paintTryState(st);
}
/** Grid cells a row's rules hide or clear show as "—"; redraw only cells whose state changed. */
function refreshRowRules(d){
  const form=formById(d.formId);if(!form||!d.grids)return;
  gridRels(form).forEach(({rel,cf})=>{
    if(!cf.rules?.length)return;const g=d.grids[cf.id];if(!g)return;const cols=gridColsFor(form,rel,cf);
    g.rows.forEach(row=>{
      const prev=row._rs||NO_RULES,st=rowRules(cf,row,d);row._rs=st;
      const tr=document.querySelector(`#grid-${CSS.escape(cf.id)} tr[data-growid="${CSS.escape(row.id)}"]`);if(!tr)return;
      const ro=!!tr.dataset.ro;
      cols.forEach(f=>{if(prev.blank.has(f.id)===st.blank.has(f.id))return;const td=tr.querySelector(`td[data-gcol="${CSS.escape(f.id)}"]`);if(td)td.innerHTML=gridCell(cf,row,f,d,ro);});
    });
  });
}
const scopeOf=d=>d===pdraft?'preview':d===cdraft&&cdraft?'cell':'record';
const draftFor=scope=>scope==='record'?rdraft:scope==='cell'?cdraft:scope==='preview'?pdraft:null;
function refreshCalcs(d){const form=formOfDraft(d);const scope=scopeOf(d);(form?.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const el=document.getElementById(`calc-${scope}-${f.id}`);if(!el)return;const r=calc(form,f,d===cdraft?rowRec(cdraft._row,form,rdraft):draftRec(d));el.textContent=r.e||fmtCalc(f,r.v)||'—';el.classList.toggle('bad',!!r.e);});}
function draftOf(el){return draftFor(el.closest('[data-scope]')?.dataset.scope);}
function formOfDraft(d){return d===pdraft?fdraft:formById(d.formId);}
function repaint(d,f){const scope=scopeOf(d);const el=document.getElementById(`fb-${scope}-${f.id}`);if(!el)return;const hid=el.hidden;el.outerHTML=fieldOut(d,f,scope,scope==='cell'?NO_RULES:d._rs);if(hid){const n=document.getElementById(`fb-${scope}-${f.id}`);if(n)n.hidden=true;}const c=document.querySelector(`#fb-${scope}-${f.id} canvas[data-sig]`);if(c)initSig(c);}
function markDirty(d){d.dirty=true;refreshCalcs(d);if(d===pdraft){applyRules(d);return;}if(d===cdraft&&cdraft){cdraft._row.dirty=true;if(cdraft._row.errors)delete cdraft._row.errors[cdraft._fid];markDirty(rdraft);return;}if(d===rdraft){refreshGrids(d);applyRules(d);}if(d===rdraft){const n=$('#dirtynote');if(n)n.textContent='Unsaved changes';const b=document.querySelector('[data-act="back"]');if(b)b.textContent='Discard';}}
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
      if(f.type==='image'){fb.querySelector('.pick')?.setAttribute('data-busy','Preparing photo…');file=await shrinkPhoto(file);}
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
function validate(form,vals,st){
  const errs={};st=st||NO_RULES;
  (form.fields||[]).forEach(f=>{
    if(f.type==='heading'||f.type==='formula'||f.type==='autonumber')return;const v=vals[f.id];
    if(st.blank.has(f.id)||st.hiddenFields.has(f.id)||st.view?.has(f.id))return; // hidden, cleared or view only: nothing to check
    if(st.required(f)&&(f.type==='checkbox'?!v:isEmpty(v))){errs[f.id]=f.type==='checkbox'?'This must be switched on.':'This field is required.';return;}
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
  const d=rdraft,form=formById(d.formId);if(d.readOnly){toast('This record is read only for you.');return;}const rs=draftRules(d);const errs=validate(form,d.values,rs);
  if(Object.keys(errs).length){d.errors=errs;renderMain();toast('Fix the highlighted fields, then save.');document.querySelector('.fld.bad')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
  // sub-form rows: check, then work out their calculations
  const grels=gridRels(form);let rowErr=0;
  grels.forEach(({cf})=>{const g=d.grids?.[cf.id];if(!g)return;g.rows.forEach(row=>{row.errors={};if(!(row.isNew||row.dirty))return;const e=validate(cf,row.values,rowRules(cf,row,d));if(Object.keys(e).length){row.errors=e;rowErr++;}});});
  if(rowErr){renderMain();toast(`${rowErr} row${rowErr>1?'s need':' needs'} attention before saving.`);document.querySelector('.gtbl tr.gbad')?.scrollIntoView({block:'center',behavior:'smooth'});return;}
  const now=Date.now(),old=d.recordId?recById(d.recordId):null,id=d.recordId||uid('r');
  if(!d.recordId)d.recordId=id; // rows' PARENT() and the parent's CHILD…() see the final ID
  const rowsOut=[],removed=[];
  grels.forEach(({rel,cf})=>{const g=d.grids?.[cf.id];if(!g)return;
    g.rows.forEach(row=>{
      if(row.attached){if(rel?.copy)Object.assign(row.values,copyPatch(form,cf,d.values,row.values));Object.assign(row.values,linkPatch(cf,form.id,id,row.fromParent,row.values));}
      let changed=row.isNew||row.dirty;
      if(cf.rules?.length){const gone=toClear(cf,row.values,rowRules(cf,row,d));if(gone.length){row.values=withoutCleared(row.values,gone);changed=true;}}
      const r=rowRec(row,cf,d);
      (cf.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const c=calc(cf,f,r);const v=c.e?null:c.v;if(row.values[f.id]!==v){row.values[f.id]=v;changed=true;}});
      if(changed&&rowEditable(row,cf))rowsOut.push({id:row.id,formId:cf.id,values:row.values,parentId:id,parentFormId:form.id,createdAt:row.createdAt||now,updatedAt:now});
    });
    (g.detached||[]).forEach(row=>{
      if(!rowEditable(row,cf))return;
      const values={...row.values,...linkPatch(cf,form.id,null,id,row.values)};
      (cf.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const c=calc(cf,f,{id:row.id,formId:cf.id,values,parentId:null,ownerId:row.ownerId});values[f.id]=c.e?null:c.v;});
      rowsOut.push({id:row.id,formId:cf.id,values,parentId:null,parentFormId:null,createdAt:row.createdAt||now,updatedAt:now});
    });
    removed.push(...g.removed);});
  const gone=toClear(form,d.values,rs);if(gone.length)d.values=withoutCleared(d.values,gone); // hidden or cleared by a rule
  (form.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const r=calc(form,f,draftRec(d));d.values[f.id]=r.e?null:r.v;});
  const rec={id,formId:form.id,values:d.values,parentId:d.parentId||null,parentFormId:d.parentFormId||null,createdAt:old?.createdAt||now,updatedAt:now};
  try{if(rowsOut.length||removed.length)await saveRecordBundle(rec,rowsOut,removed);else await store.put('records',rec);}
  catch(e){console.error(e);if(!old)d.recordId=null;toast(e?.code==='permission-denied'?'You don’t have permission to save this record or one of its rows.':'Saving failed. Check your connection and try again.');return;}
  if(rowsOut.length||removed.length){const n=rowsOut.length+removed.length;setTimeout(()=>toast(`Saved with ${n} row change${n>1?'s':''}`),0);}
  d.dirty=false;d.errors={};d.recordId=id;d.copied=0;view.recordId=id;toast('Saved');render();
  if(!old&&wfOn(form)){const fs=firstStage(form);await doWfMove({...rec,ownerId:store.user?.uid},form,fs,'Created','');}
  askChildRules(form,{...(old||{}),...rec,nums:old?.nums});
}
/* ---------- A parent changed: children whose rules look at it ----------
   After a save, child records (separate records, not grid rows: those are saved with the parent)
   whose rules use this form's fields are checked; if fields would be emptied, it asks first. */
function askChildRules(form,parent){
  const items=[];
  (form.children||[]).filter(c=>c.display!=='grid').forEach(c=>{
    const cf=formById(c.formId);if(!cf?.rules?.length||cf.id===form.id)return;
    if(!cf.rules.some(r=>!r.off&&(r.conds||[]).flatMap(x=>x.group?x.conds||[]:[x]).some(x=>x.src===form.id)))return;
    const kids=recordsOf(cf.id).filter(r=>r.parentId===parent.id&&canEditRecord(store.me,r));
    const im=ruleImpact(cf,kids,parent);
    if(im.rows.length)items.push({cf,rows:im.rows,perField:im.perField});
  });
  if(!items.length)return;
  ui.cascade={parentId:parent.id,parentTitle:recTitle(parent,form),formName:itemName(form),items,busy:false};
  renderMain();setTimeout(()=>$('#cs-go')?.focus(),0);
}
function cascadeDialog(){
  const c=ui.cascade,n=c.items.reduce((s,x)=>s+x.rows.length,0);
  const what=c.items.map(x=>`${x.rows.length} ${x.rows.length===1?itemName(x.cf).toLowerCase():x.cf.name.toLowerCase()}`).join(' and ');
  return `<div class="lv-scrim" data-act="cs-scrim"><div class="lv-dlg ra-dlg" role="dialog" aria-modal="true" aria-labelledby="cs-h" data-stop-scrim="1">
    <h2 id="cs-h">Also update ${esc(what)}?</h2>
    <p>Their rules look at this ${esc(c.formName.toLowerCase())}. With what you just saved, these would be emptied:</p>
    ${c.items.map(x=>{const labels=new Map((x.cf.fields||[]).map(f=>[f.id,f.label]));return `<p class="ra-sub"><b>${esc(x.cf.name)}</b></p><ul class="ra-list">${[...x.perField].map(([fid,k])=>`<li>${esc(labels.get(fid)||'Field')}: ${k}</li>`).join('')}</ul>`;}).join('')}
    <p class="help"><b>Update ${n}</b> empties them now${isAdmin(store.me)?'; it’s listed in Import history with Undo for 7 days':''}, and every change is in the audit trail. <b>Not now</b> leaves them; each is emptied the next time someone saves it.</p>
    <div class="lv-dlgacts"><button type="button" class="btn ghost" data-act="cs-no"${c.busy?' disabled':''}>Not now</button><button type="button" class="btn primary" id="cs-go" data-act="cs-go"${c.busy?' disabled':''}>${c.busy?'Updating…':`Update ${n}`}</button></div>
  </div></div>`;
}
async function runCascade(){
  const c=ui.cascade;if(!c||c.busy)return;c.busy=true;renderMain();
  let n=0;
  try{for(const x of c.items)n+=await applyRuleChange(x.cf,x.rows,`${c.formName} changed (${c.parentTitle})`.slice(0,80));ui.cascade=null;toast(`Updated ${n} record${n===1?'':'s'}`);}
  catch(e){console.error(e);c.busy=false;toast(e?.code==='permission-denied'?'You don’t have permission to change some of those. Nothing more was changed.':'The update stopped part way. Check your connection and try again.');}
  renderMain();
}

/* Designer */
/** The designer's search box: narrows the list to forms whose name contains what's typed */
function designerSearch(fs){
  const q=String(ui.dq||''),n=fs.filter(f=>designerMatch(f,q)).length;
  return `<div class="dsearch"><svg class="fs-ic" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg><input type="search" class="in" id="dq" data-ksearch="designer" placeholder="Search forms by name" aria-label="Search forms by name" autocomplete="off" value="${esc(q)}"><span class="help" id="dq-n" role="status">${q.trim()?(n?`${n} of ${fs.length} forms`:`No forms match “${esc(q.trim())}”`):''}</span></div>`;
}
/** Filter the designer list in place as you type (no redraw, so the cursor stays put) */
function applyDq(){
  const q=String(ui.dq||''),cards=[...document.querySelectorAll('.flist .fcard')];
  let n=0;cards.forEach(c=>{const on=designerMatch({name:c.dataset.fname},q);c.hidden=!on;if(on)n++;});
  document.querySelector('.flist')?.classList.toggle('searching',!!q.trim());
  const s=$('#dq-n');if(s)s.textContent=q.trim()?(n?`${n} of ${cards.length} forms`:`No forms match “${q.trim()}”`):'';
}
function viewDesigner(){
  const fs=[...store.forms].sort(byOrder);
  return `
  <div class="head"><div class="ttl"><div><h1>Form designer</h1><p class="sub">Build forms, choose which ones appear in the sidebar, and connect them as parents and children. Hidden forms are still reachable from their parent records. Who can see and edit each form is set in Security groups.</p></div></div>
    <div class="actions"><button class="btn primary" data-act="new-form">+ New form</button></div></div>
  ${fs.length?`${designerSearch(fs)}<div class="panel flist${String(ui.dq||'').trim()?' searching':''}">${fs.map((f,i)=>{
    const par=parentsOf(f.id),kids=(f.children||[]).map(c=>formById(c.formId)).filter(Boolean);
    return `<div class="fcard" data-fname="${esc(f.name||'')}"${designerMatch(f,ui.dq)?'':' hidden'}>${badge(f,1)}<div class="info"><b>${esc(f.name)}</b><div class="tags"><span class="chip">${(f.fields||[]).filter(x=>x.type!=='heading').length} fields</span><span class="chip">${recordsOf(f.id).length} record${recordsOf(f.id).length===1?'':'s'}</span>${par.length?`<span class="chip acc">Child of ${par.map(p=>esc(p.name)).join(', ')}</span>`:''}${kids.length?`<span class="chip acc">Parent of ${kids.map(k=>esc(k.name)).join(', ')}</span>`:''}${f.showInSidebar?'':'<span class="chip warn">Hidden</span>'}</div></div>
      <div class="ctl"><label class="switch vis"><input type="checkbox" data-act-change="toggle-sidebar" data-id="${f.id}"${f.showInSidebar?' checked':''}><span class="tr"></span><span>Sidebar</span></label>
      <button class="ibtn" data-act="form-move" data-id="${f.id}" data-dir="-1" aria-label="Move up"${i===0?' disabled':''}>↑</button><button class="ibtn" data-act="form-move" data-id="${f.id}" data-dir="1" aria-label="Move down"${i===fs.length-1?' disabled':''}>↓</button>
      <button class="btn sm" data-act="new-record" data-id="${f.id}" aria-label="Add ${/^[aeiou]/i.test(itemName(f))?'an':'a'} ${esc(itemName(f).toLowerCase())}" title="New ${esc(itemName(f).toLowerCase())}">+ Add</button><button class="btn sm" data-act="nav-records" data-id="${f.id}">Records</button><button class="btn sm primary" data-act="edit-form" data-id="${f.id}">Edit</button></div></div>`;}).join('')}</div>`
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
  if(type==='autonumber'){f.prefix='';f.start=1;f.digits=1;f.year=false;f.inList=true;f.label='Number';}
  if(type==='relation'){const o=store.forms.find(x=>x.id!==fdraft?.id);f.relForm=o?.id||'';f.label=o?itemName(o):'Linked record';}
  return f;
}
/** The designer's cards for what shows under a record's fields: sub-forms, child forms and Tasks, in order. */
function sectionCards(f){
  const order=sectionOrder(f);
  const card=(k,i)=>{
    let badgeHTML,name,kind;
    if(k===TASKS_KEY){badgeHTML=`<span class="badge" style="background:${COLORS[6]}" aria-hidden="true">T</span>`;name='Tasks';kind='Tasks linked from Cadence';}
    else{const cf=formById(k)||(f._newForms||[]).find(x=>x.id===k);const rel=(f.children||[]).find(c=>c.formId===k);if(!rel)return '';badgeHTML=cf?badge(cf):'<span class="badge">?</span>';name=cf?.name||'New sub-form';kind=rel.display==='grid'?'Sub-form, shown as a grid':'Child form, separate records';}
    return `<li class="scard"><button type="button" class="pgrip" data-pdrag="section" data-v="${esc(k)}" aria-label="Move ${esc(name)}: drag, or use the up and down arrow keys" title="Drag to move"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="6" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/></svg></button><span class="sgrip" aria-hidden="true">${i+1}</span>${badgeHTML}<div class="crow-m"><b>${esc(name)}</b><small>${esc(kind)}</small></div>
      ${k===TASKS_KEY?'':`<button type="button" class="btn sm ghost" data-act="tab" data-tab="relations">Relationships</button>`}
      <button type="button" class="ibtn" data-act="sec-move" data-k="${esc(k)}" data-dir="-1" aria-label="Move ${esc(name)} up"${i===0?' disabled':''}>↑</button>
      <button type="button" class="ibtn" data-act="sec-move" data-k="${esc(k)}" data-dir="1" aria-label="Move ${esc(name)} down"${i===order.length-1?' disabled':''}>↓</button></li>`;
  };
  return `<section class="dz-secs" aria-labelledby="dz-secs-h"><h3 id="dz-secs-h" class="dz-h">Under the fields</h3><p class="help">On a record, these come after all the fields, in this order. Drag a card by its handle, or use the arrows, to rearrange them; add or remove sub-forms and child forms on the Relationships tab.</p><ol class="scards">${order.map(card).join('')}</ol></section>`;
}
/** Filter the field types by what's typed in their search box (every word must match a name, group or other word). */
function applyDzq(){
  const box=document.querySelector('[data-dzq]');if(!box)return;
  if(box.value!==(ui.dzq||''))box.value=ui.dzq||'';
  const words=(ui.dzq||'').toLowerCase().split(/\s+/).filter(Boolean);
  let any=false;
  document.querySelectorAll('.dz-types .pgroup').forEach(g=>{
    let n=0;
    g.querySelectorAll('.dz-chip').forEach(c=>{const hit=words.every(w=>c.dataset.words.includes(w));c.hidden=!hit;if(hit)n++;});
    g.hidden=!n;if(n)any=true;
  });
  const none=document.querySelector('.dz-none');if(none)none.hidden=any;
}
/* ---------- Rules tab: Try it ---------- */
/** "· rule" on a field in the designer when a rule changes it or looks at it. */
function ruleTag(f,fid){
  const rs=(f.rules||[]).filter(r=>!r.off);
  const acts=rs.some(r=>(r.acts||[]).some(a=>(a.targets||[]).includes('f:'+fid)));
  const used=rs.some(r=>(r.conds||[]).flatMap(c=>c.group?c.conds||[]:[c]).some(c=>(!c.src||c.src==='self')&&c.field===fid));
  return acts?' · <span class="rl-tag" title="A rule shows, hides or sets this field">rule</span>':used?' · <span class="rl-tag soft" title="A rule looks at this field">used by a rule</span>':'';
}
function tryInput(x,v){
  const a=`data-tryp="v" data-fid="${x.id}" aria-label="${esc(x.label)}"`;
  if(CHOICE.has(x.type)&&x.type!=='multiselect')return `<select class="in" ${a}><option value=""></option>${(x.options||[]).map(o=>`<option${o===v?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
  if(x.type==='multiselect')return `<select class="in" ${a}><option value=""></option>${(x.options||[]).map(o=>`<option${Array.isArray(v)&&v[0]===o?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
  if(x.type==='checkbox')return `<select class="in" ${a}><option value="">No</option><option value="1"${v?' selected':''}>Yes</option></select>`;
  if(NUMERIC.has(x.type))return `<input class="in" type="number" step="any" ${a} value="${esc(v??'')}">`;
  if(x.type==='date'||x.type==='datetime')return `<input class="in" type="date" ${a} value="${esc(String(v||'').slice(0,10))}">`;
  if(x.type==='relation'){const tf=formById(x.relForm);const rs=tf?recordsOf(tf.id).map(r=>({r,t:recTitle(r,tf)})).sort((p,q)=>p.t.localeCompare(q.t)).slice(0,500):[];return `<select class="in" ${a}><option value=""></option>${rs.map(({r,t})=>`<option value="${r.id}"${r.id===v?' selected':''}>${esc(t)}</option>`).join('')}</select>`;}
  return `<input class="in" type="text" ${a} value="${esc(v??'')}">`;
}
function tryPanel(f){
  if(!pdraft)pdraft={values:{},errors:{},dirty:false};
  const use=parentUse(f);let par='';
  if(use.size){
    const ids=[...use.keys()].filter(id=>formById(id));
    if(ids.length){
      if(!pdraft._parent||!ids.includes(pdraft._parent.formId))pdraft._parent={id:null,formId:ids[0],values:{}};
      const pf=formById(pdraft._parent.formId);
      par=`<div class="rl-par"><p class="help">Pretend this ${esc(itemName(f).toLowerCase())} belongs to ${ids.length>1?`a <select class="in rl-pform" data-tryp="form" aria-label="Parent form">${ids.map(id=>`<option value="${id}"${id===pdraft._parent.formId?' selected':''}>${esc(itemName(formById(id)).toLowerCase())}</option>`).join('')}</select>`:`a ${esc(itemName(pf).toLowerCase())}`} with:</p>${[...use.get(pdraft._parent.formId)||[]].map(fid=>{const x=pf.fields.find(y=>y.id===fid);return x?`<label class="rl-pv"><span>${esc(x.label)}</span>${tryInput(x,pdraft._parent.values[fid])}</label>`:'';}).join('')}</div>`;
    }
  }
  if(wfOn(f)&&(f.rules||[]).some(r=>(r.conds||[]).flatMap(c=>c.group?c.conds||[]:[c]).some(c=>c.field===STAGE_FIELD)))par+=`<div class="rl-par"><label class="rl-pv"><span>Pretend its stage is</span><select class="in" data-tryp="stage"><option value=""></option>${stagesOf(f).map(x=>`<option value="${esc(x.id)}"${x.id===pdraft._stage?' selected':''}>${esc(x.name)}</option>`).join('')}</select></label></div>`;
  const secs=rulesCtx(f).targets.filter(t=>['grid','child','tasks'].includes(t.kind));
  return `<h2 class="dz-h">Try it</h2><p class="help">Fill in the fields to watch the rules work. Nothing here is saved.</p>${par}
    ${formFieldsHTML(f,pdraft,'preview')}
    ${secs.length?`<div class="rl-secs"><span class="help">Under the fields</span>${secs.map(t=>`<span class="rl-sec" data-trysec="${esc(t.key)}">${esc(t.label)} <b></b></span>`).join('')}</div>`:''}
    <button type="button" class="btn sm ghost" data-act="try-reset">Start again</button>`;
}
/** Try it: which sections show, and which rules apply right now. */
function paintTryState(st){
  document.querySelectorAll('[data-trysec]').forEach(el=>{const off=st.hidden.has(el.dataset.trysec);el.classList.toggle('off',off);const b=el.querySelector('b');if(b)b.textContent=off?'hidden':'shown';});
  document.querySelectorAll('[data-rlfire]').forEach(el=>{el.hidden=!st.fired.get(el.dataset.rlfire);});
}
function viewFormEdit(){
  const f=fdraft;const tabs=[['fields','Fields'],['relations','Relationships'],['rules','Rules'],['workflow','Workflow'],['settings','Settings'],['preview','Preview']];
  let body='';
  if(ui.tab==='fields'){
    const groups=[...new Set(TYPES.map(t=>t[3]))];
    body=`<div class="dz">
      <aside class="panel dz-types" aria-label="Field types">
        <h2 class="dz-h">Field types</h2>
        <input type="search" class="in dz-q" data-dzq placeholder="Search field types" aria-label="Search field types" autocomplete="off">
        <p class="note dz-none" hidden>No field type matches.</p>
        ${groups.map(g=>`<div class="pgroup"><span>${g}</span>${TYPES.filter(t=>t[3]===g).map(t=>`<button class="dz-chip" draggable="true" data-act="add-field" data-type="${t[0]}" data-words="${esc((t[1]+' '+t[3]+' '+(TYPE_WORDS[t[0]]||'')).toLowerCase())}" title="Drag onto the form, or tap to add"><span class="glyph">${t[2]}</span>${t[1]}</button>`).join('')}</div>`).join('')}
      </aside>
      <aside class="panel dz-list" aria-label="Fields in this form">
        <h2 class="dz-h">In this form (${f.fields.length})</h2>
        ${f.fields.length?`<ol class="dz-ol">${f.fields.map((x,i)=>`<li><button class="dz-li" data-act="focus-field" data-id="${x.id}"><span class="num">${i+1}</span><span class="fname">${esc(x.label||'Untitled field')}</span><span class="ftype">${esc(T[x.type].label)}</span></button></li>`).join('')}</ol>`:`<p class="note">No fields yet.</p>`}
      </aside>
      <main class="panel dz-canvas" data-dz-canvas aria-label="Form canvas">
        ${f.fields.length?f.fields.map((x)=>`<div class="crow" data-feid="${x.id}">
          <button type="button" class="pgrip" data-pdrag="field" data-v="${x.id}" aria-label="Move ${esc(x.label||'field')}: drag, or use the up and down arrow keys" title="Drag to move"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="8" cy="6" r="1.8"/><circle cx="16" cy="6" r="1.8"/><circle cx="8" cy="12" r="1.8"/><circle cx="16" cy="12" r="1.8"/><circle cx="8" cy="18" r="1.8"/><circle cx="16" cy="18" r="1.8"/></svg></button>
          <span class="glyph" title="${esc(T[x.type].label)}">${T[x.type].glyph}</span>
          <div class="crow-m"><b id="frl-${x.id}">${esc(x.label||'Untitled field')}${x.required?'<span class="req">*</span>':''}</b><small>${esc(T[x.type].label)}${x.type==='relation'&&formById(x.relForm)?' → '+esc(formById(x.relForm).name):''}${x.inList?' · in list':''}${f.titleField===x.id?' · title':''}${ruleTag(f,x.id)}</small></div>
          <button class="ibtn dz-dots" data-act="open-field" data-id="${x.id}" aria-label="Options for ${esc(x.label||'field')}">⋯</button>
        </div>`).join(''):`<p class="note dz-empty">Drag a field type here to add it.</p>`}
        <div class="dz-drop">Drop a field type here</div>
        ${sectionCards(f)}
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
  }else if(ui.tab==='workflow'){
    body=viewWorkflow(f);
  }else if(ui.tab==='rules'){
    body=`<div class="rl-wrap">${viewRules(f)}<aside class="panel rl-try" aria-label="Try the rules">${tryPanel(f)}</aside></div>`;
  }else if(ui.tab==='settings'){
    const tfs=f.fields.filter(x=>['text','email','phone','url','number','select','date','autonumber'].includes(x.type));
    body=`<div class="panel"><div class="settings">
      <label class="prop"><span>One record is called</span><input class="in" data-fprop="itemName" value="${esc(f.itemName||'')}" placeholder="${esc(itemName(f))}"><small class="help">Used in buttons like “New ${esc(itemName(f).toLowerCase())}”.</small></label>
      <label class="prop"><span>Record title comes from</span><select class="in" data-fprop="titleField"><option value="">First text field</option>${tfs.map(x=>`<option value="${x.id}"${x.id===f.titleField?' selected':''}>${esc(x.label)}</option>`).join('')}</select></label>
      <label class="prop full"><span>Description</span><textarea class="in" data-fprop="description" rows="2" placeholder="What this form collects">${esc(f.description||'')}</textarea></label>
      <div class="prop"><span>Color</span><div class="swatches">${COLORS.map((c,i)=>`<button class="sw${(f.color??0)===i?' on':''}" style="background:${c}" data-act="set-color" data-i="${i}" aria-label="Color ${i+1}"></button>`).join('')}</div></div>
      <label class="prop full"><span>Email PDF: subject</span><input class="in" data-fprop="emailSubject" value="${esc(f.emailSubject||'')}" maxlength="200" placeholder="${esc(DEFAULT_SUBJECT)}"></label>
      <label class="prop full"><span>Email PDF: message</span><textarea class="in" data-fprop="emailMessage" rows="6" maxlength="10000" placeholder="${esc(DEFAULT_MESSAGE)}">${esc(f.emailMessage||'')}</textarea><small class="help">What <b>Email PDF</b> fills in; it can be changed before sending. Use {Field name} for any field on this form (for example {${esc((f.fields||[]).find(x=>x.type!=='heading')?.label||'Invoice #')}}), plus {Title}, {Item}, {Company}, {Sender} and {Date}. Leave empty for the standard wording shown.</small></label>
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
  <div class="tabs" role="tablist">${tabs.map(([k,l])=>`<button class="tab${ui.tab===k?' on':''}" role="tab" aria-selected="${ui.tab===k}" data-act="tab" data-tab="${k}">${l}${k==='fields'?` <span class="count">${f.fields.length}</span>`:''}${k==='relations'&&(f.children||[]).length?` <span class="count">${f.children.length}</span>`:''}${k==='rules'&&(f.rules||[]).length?` <span class="count">${f.rules.length}</span>`:''}${k==='workflow'&&wfOn(f)?` <span class="count">${stagesOf(f).length}</span>`:''}</button>`).join('')}</div>
  ${body}
  ${ui.ruleApply?ruleApplyDialog():''}
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
  if(x.type==='currency')h+=P('Currency code',inp('currency',x.currency||'CAD','maxlength="3" style="text-transform:uppercase"'));
  if(x.type==='range')h+=P('Step',num('step',x.step))+P('Unit after value',inp('suffix',x.suffix,'placeholder="e.g. %"'));
  if(x.type==='rating')h+=P('Number of stars',num('max',x.max));
  if(x.type==='autonumber')h+=autoEditor(x,P,inp,num,sw);
  if(x.type==='relation')h+=P('Links to form',`<select class="in" data-prop="relForm"><option value="">Choose a form…</option>${[...store.forms].sort(byOrder).map(o=>`<option value="${o.id}"${o.id===x.relForm?' selected':''}>${esc(o.name)}</option>`).join('')}</select>`);
  if(x.type!=='heading')h+=`<div class="props-sw">${x.type==='formula'||x.type==='autonumber'?'':sw('required','Required')}${NOLIST.has(x.type)?'':sw('inList','Column in the starting list')}<label class="switch"><input type="checkbox" data-prop="width" data-kind="half"${x.width==='half'?' checked':''}><span class="tr"></span><span>Half width on wide screens</span></label></div>`;
  h+=`<div class="prop full"><span class="keyline">Field ID ${esc(x.id)}</span></div>`;
  return `<div class="fedit">${h}</div>`;
}
function autoPrev(x){const y=thisYear(),saved=(formById(fdraft.id)?.fields||[]).some(f=>f.id===x.id&&f.type==='autonumber'),counter=(ui.anNext||{})[fdraft.id+'|'+x.id];const n=saved&&counter?nextAuto(x,counter,y):autoSettings(x).start;return `<b>${esc(formatAuto(x,n,y))}</b>, then ${esc(formatAuto(x,n+1,y))}`;}
/** The designer's settings for an Auto number field, its preview, and numbering existing records. */
function autoEditor(x,P,inp,num,sw){
  const s=autoSettings(x),y=thisYear();
  let h=P('Prefix',inp('prefix',x.prefix,'maxlength="20" placeholder="e.g. INV-"'))+P('Starting number',num('start',x.start??1))+P('Minimum digits',num('digits',x.digits??1));
  h+=`<div class="props-sw">${sw('year','Add the year, and start again each January')}</div>`;
  const saved=(formById(fdraft.id)?.fields||[]).find(f=>f.id===x.id&&f.type==='autonumber');
  const key=fdraft.id+'|'+x.id;
  if(saved&&!(key in (ui.anNext||{}))){ui.anNext={...(ui.anNext||{}),[key]:null};autoCounter(fdraft.id,x.id).then(c=>{ui.anNext={...ui.anNext,[key]:c||{}};if(view.name==='formEdit')renderMain();});}
  const counter=(ui.anNext||{})[key];
  h+=`<div class="prop full"><span>${saved&&counter?'Next number':'Looks like'}</span><div class="autoprev" id="ap-${x.id}">${autoPrev(x)}</div><p class="help">Every new ${esc(itemName(fdraft).toLowerCase())} gets the next number when it's first saved. Numbers are never reused, even after a delete. Changing these settings affects new numbers only.</p></div>`;
  const recs=store.records.filter(r=>r.formId===fdraft.id);
  if(!recs.length)return h;
  if(!saved)return h+`<div class="prop full"><p class="help anfill">Save the form, then come back here to number the ${recs.length} ${esc(fdraft.name.toLowerCase())} already saved${x.id&&recs.some(r=>!isEmpty(r.values?.[x.id]))?' (numbers already typed into this field are kept)':''}.</p></div>`;
  const m=missingNumbers(recs,fdraft.id,x.id);
  if(!m.missing)return h+`<div class="prop full"><p class="help anfill">All ${recs.length} ${esc(fdraft.name.toLowerCase())} have a number.</p></div>`;
  const busy=ui.anBusy===x.id;
  return h+`<div class="prop full anfill"><p><b>${m.missing} ${esc(m.missing===1?itemName(fdraft).toLowerCase():fdraft.name.toLowerCase())} ${m.missing===1?'has':'have'} no number yet.</b> ${m.typed?`${m.typed} of them already have a number typed in, which ${m.typed===1?'is':'are'} kept. `:''}The rest are numbered oldest first, carrying on after the highest number in use.</p><button type="button" class="btn sm" data-act="an-fill" data-fid="${x.id}"${busy?' disabled':''}>${busy?'Numbering…':'Number them now'}</button></div>`;
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
  {const wp=checkWorkflow(f,{people:new Set(store.users.map(u=>u.id)),groups:new Set(store.groups.map(g=>g.id))});if(wp.length){ui.tab='workflow';renderMain();toast('Workflow: '+wp[0]);return;}}
  if(f.workflow?.stages){f.workflow.stages.forEach(x=>{x.name=String(x.name||'').trim();x.moves=(x.moves||[]).filter(m=>m.label&&m.label.trim()&&f.workflow.stages.some(y=>y.id===m.to));});}
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
  if(out.rules){const c=rulesCtx(f);out.rules=pruneRules(withStageField(out),{targets:c.targets,parentFields:c.parentFields});if(!out.rules.length)delete out.rules;}
  // changed rules: saved records they'd empty fields on are cleared now (with Undo) or on their next save
  let applyRows=null;
  if(!f.isNew&&!sameRules(before?.rules,out.rules)){
    const choice=ui.ruleApply?.choice;
    if(!choice){
      if(store.recordsLoading.size){toast('Still loading records. Try again in a moment.');return;}
      const real=ruleImpact(out,recordsOf(f.id));
      if(real.rows.length){ui.ruleApply={form:out,rows:real.rows,perField:real.perField,choice:null,busy:false};renderMain();setTimeout(()=>$('#ra-apply')?.focus(),0);return;}
    }else if(choice==='apply')applyRows=ui.ruleApply.rows;
  }
  ui.ruleApply=null;
  if(f.isNew)out.order=Math.max(0,...store.forms.map(x=>x.order||0))+1;
  out.updatedAt=Date.now();
  try{await store.put('forms',out);}catch(e){toast('Saving failed. Check your connection and try again.');return;}
  f._newForms=[];f._inherit={};
  if(accessMoves&&isAdmin(store.me)){
    const changed=new Map([[out.id,{...out,id:out.id}],...pending.map(nf=>[nf.id,nf]),...inheritChanges.map(([o,v])=>[o.id,{...o,inheritAccess:v}])]);
    const formsAfter=[...store.forms.filter(x=>!changed.has(x.id)),...changed.values()];
    try{await recomputeAllAccess(formsAfter);}catch(e){toast('Form saved, but people’s access wasn’t updated. Use Recalculate access in Security groups.');f.dirty=false;f.isNew=false;render();return;}
  }
  if(applyRows){
    try{const n=await applyRuleChange(out,applyRows);f.dirty=false;f.isNew=false;toast(`Form saved. Emptied fields on ${n} ${n===1?itemName(out).toLowerCase():out.name.toLowerCase()}. Undo is in Import history.`);render();}
    catch(e){console.error(e);f.dirty=false;toast(e?.code==='permission-denied'?'Form saved, but Firestore refused to change the records.':'Form saved, but changing the records stopped part way. Undo what was done from Import history, or try Save form again.');render();}
    return;
  }
  f.dirty=false;f.isNew=false;toast('Form saved');render();
}
/** Which saved records the form's rules would empty fields on: { rows: [{ id, clear }], perField }. */
function ruleImpact(form,recs,parent){
  const sf=withStageField(form);
  const im=impactOf(sf,recs,r=>{
    const byId=new Map((sf.fields||[]).map(x=>[x.id,x])),pg=parentGetter(parent&&parent.id===r.parentId?parent:r.parentId?recById(r.parentId):null);
    return (src,fid)=>{if(src!=='self')return pg(src,fid);const x=byId.get(fid);return x?{f:x,v:fid===STAGE_FIELD?stageName(form,r):x.type==='autonumber'?r.nums?.[fid]:valOf(x,r,form)}:null;};
  });
  return im;
}
/**
 * Empty those fields on saved records (rows: [{ id, clear, set? }]; set = values to change first).
 * Admins: logged in Import history as a rule change, with Undo. Others: an ordinary edit.
 * label: what it was ("Rule change", "Set field: Stage → Done", "Project changed").
 */
async function applyRuleChange(form,rows,label='Rule change'){
  const labels=new Map((form.fields||[]).map(x=>[x.id,x.label]));
  let done=0;
  for(let i=0;i<rows.length;i+=4000){
    const part=rows.slice(i,i+4000),per={};
    const updates=part.map(({id,clear,set})=>{
      const r=recById(id);if(!r)return null;
      clear.forEach(fid=>{const l=labels.get(fid)||'Field';per[l]=(per[l]||0)+1;});
      const values=withoutCleared({...(r.values||{}),...(set||{})},clear);
      const rec={...r,values};(form.fields||[]).filter(x=>x.type==='formula').forEach(x=>{const c=calc(form,x,rec);values[x.id]=c.e?null:c.v;});
      return {id,values,parentId:r.parentId||null,parentFormId:r.parentFormId||null};
    }).filter(Boolean);
    if(!updates.length)continue;
    const names=Object.keys(per);
    if(isAdmin(store.me))await runImport({id:uid('imp'),formId:form.id,formName:form.name,fileName:(label+': '+names.join(', ')).slice(0,200),
      counts:{kind:'rules',what:label.slice(0,80),added:0,updated:updates.length,skipped:0,fields:per},creates:[],updates});
    else await rewriteValues(updates);
    done+=updates.length;
  }
  return done;
}
function ruleApplyDialog(){
  const a=ui.ruleApply,f=a.form,n=a.rows.length,noun=n===1?itemName(f).toLowerCase():f.name.toLowerCase();
  const labels=new Map((f.fields||[]).map(x=>[x.id,x.label]));
  return `<div class="lv-scrim" data-act="ra-scrim"><div class="lv-dlg ra-dlg" role="dialog" aria-modal="true" aria-labelledby="ra-h" data-stop-scrim="1">
    <h2 id="ra-h">Apply the new rules to saved ${esc(f.name.toLowerCase())}?</h2>
    <p>With these rules, fields would be emptied on <b>${n.toLocaleString()} ${esc(noun)}</b> already saved:</p>
    <ul class="ra-list">${[...a.perField].map(([fid,c])=>`<li><b>${esc(labels.get(fid)||'Field')}</b>: ${c.toLocaleString()}</li>`).join('')}</ul>
    <p class="help"><b>Apply to all ${n.toLocaleString()}</b> empties them now. It’s listed in Import history, where you can undo it for 7 days, and every change is in the audit trail.<br><b>Leave them</b> saves the rules; each ${esc(itemName(f).toLowerCase())} is emptied the next time someone saves it.</p>
    <div class="lv-dlgacts"><button type="button" class="btn ghost" data-act="ra-cancel"${a.busy?' disabled':''}>Cancel</button><button type="button" class="btn" data-act="ra-leave"${a.busy?' disabled':''}>Leave them</button><button type="button" class="btn primary" id="ra-apply" data-act="ra-apply"${a.busy?' disabled':''}>${a.busy?'Applying…':`Apply to all ${n.toLocaleString()}`}</button></div>
  </div></div>`;
}
function editForm(id){
  const src=formById(id);if(!src||!guard())return;
  fdraft={...clone(src),fields:clone(src.fields||[]),children:clone(src.children||[]),dirty:false,isNew:false,_labels:Object.fromEntries((src.fields||[]).map(x=>[x.id,x.label]))};pdraft=null;
  go({name:'formEdit',formId:id});
}

/* ---------- Events ---------- */
// Rules tab: building rules, and Try it's parent values
document.addEventListener('click',e=>{const el=e.target.closest?.('[data-rl]');if(!el||el.dataset.rl==='toggle'||view.name!=='formEdit'||!fdraft)return;rulesClick(fdraft,el);});
document.addEventListener('click',e=>{const el=e.target.closest?.('[data-wfa]');if(!el||view.name!=='formEdit'||!fdraft)return;wfClick(fdraft,el);});
document.addEventListener('input',e=>{const el=e.target;if(view.name==='formEdit'&&fdraft&&el.dataset?.wfd)wfInput(fdraft,el);});
document.addEventListener('change',e=>{
  const el=e.target;if(view.name!=='formEdit'||!fdraft||!el.dataset)return;
  if(el.closest('.rl-list')&&(el.dataset.rl==='toggle'||el.dataset.rlj||el.dataset.rlc||el.dataset.rla)){rulesChange(fdraft,el);return;}
  if(el.dataset.wfd&&el.closest('.wf-design')){wfChange(fdraft,el);return;}
  if(el.dataset.tryp&&pdraft){
    if(el.dataset.tryp==='form'){pdraft._parent={id:null,formId:el.value,values:{}};renderMain();return;}
    if(el.dataset.tryp==='stage'){pdraft._stage=el.value||null;applyRules(pdraft);return;}
    const pf=formById(pdraft._parent?.formId),x=pf?.fields.find(y=>y.id===el.dataset.fid);if(!x)return;
    pdraft._parent.values[x.id]=x.type==='checkbox'?el.value==='1':x.type==='multiselect'?(el.value?[el.value]:[]):NUMERIC.has(x.type)?(el.value===''?null:Number(el.value)):el.value;
    applyRules(pdraft);
  }
});
function closeFormSearch(){ui.fq='';ui.fi=0;ui.fsOpen=false;const q=$('#fs-q');if(q)q.value='';paintFormResults();}
document.addEventListener('pointerdown',e=>{if(fsShown()&&!e.target.closest?.('.fsearch'))closeFormSearch();},true);
// clicking or tapping into Search forms lists every form you can open; leaving it closes the list
document.addEventListener('focusin',e=>{
  if(e.target?.id==='fs-q'){if(!ui.fsOpen){ui.fsOpen=true;ui.fi=0;paintFormResults();}return;}
  if(fsShown()&&!e.target.closest?.('.fsearch'))closeFormSearch();
});
document.addEventListener('click',e=>{if(e.target?.id==='fs-q'&&!ui.fsOpen){ui.fsOpen=true;paintFormResults();}});
document.addEventListener('click',async e=>{
  if(e.target.closest('[data-stop]'))return;
  const el=e.target.closest('[data-act]');if(!el)return;
  const a=el.dataset.act,id=el.dataset.id;
  if(a!=='del-record'&&a!=='del-form'&&a!=='field-del'&&ui.confirm&&!a.startsWith('nav')){ui.confirm=null;}
  switch(a){
    case 'menu':$('#side').classList.add('open');$('#scrim').classList.add('open');break;
    case 'close-menu':closeMenu();break;
    case 'fs-open':{ui.fq='';ui.fi=0;ui.fsOpen=false;if(document.activeElement?.id==='fs-q')document.activeElement.blur();const f=formById(id);if(!f)break;if(canCreate(store.me,id))goRec(newRecordDraft(f,null),{name:'record',formId:id,recordId:null});else go({name:'records',formId:id});break;}
    case 'nav-form':ui.fq='';ui.fi=0;ui.fsOpen=false;if(document.activeElement?.id==='fs-q')document.activeElement.blur();go({name:'records',formId:id});break;
    case 'nav-records':go({name:'records',formId:id});break;
    case 'nav-designer':go({name:'designer'});break;
    case 'nav-reports':go({name:'reports'});break;
    case 'nav-dashboards':go({name:'dashboards'});break;
    case 'nav-groups':go({name:'groups'});break;
    case 'nav-users':go({name:'users'});break;
    case 'nav-imports':go({name:'imports'});break;
    case 'nav-audit':go({name:'audit'});break;
    case 'nav-automations':go({name:'automations'});break;
    case 'rec-duplicate':{
      const rec=view.recordId?recById(view.recordId):null,form=rec?formById(rec.formId):null;
      if(!rec||!form||!canCreate(store.me,form.id))return;
      if(rdraft?.dirty){toast('Save or discard your changes first, then duplicate.');return;}
      const parent=rec.parentId?recById(rec.parentId):null;
      const d=newRecordDraft(form,parent);
      d.values={...d.values,...copyValues(form,rec.values,{titleId:titleFieldOf(form)?.id})};
      d.parentId=rec.parentId||null;d.parentFormId=rec.parentFormId||null;d.copied=0;
      d.grids={};let nRows=0;
      gridRels(form).forEach(({cf})=>{
        const rows=canCreate(store.me,cf.id)?store.records.filter(r=>r.parentId===rec.id&&r.formId===cf.id).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)):[];
        nRows+=rows.length;
        d.grids[cf.id]={rows:rows.map(r=>({id:uid('r'),values:relinkRow(cf,copyValues(cf,r.values,{suffix:''}),form.id,rec.id),ownerId:store.user.uid,isNew:true,dirty:true,errors:{}})),removed:[],detached:[],sort:null};
      });
      const kids=(form.children||[]).filter(c=>c.display!=='grid').map(c=>formById(c.formId)).filter(cf=>cf&&store.records.some(r=>r.parentId===rec.id&&r.formId===cf.id));
      Object.assign(d,{dirty:true,duplicateOf:rec.id,duplicateTitle:recTitle(rec,form),dupRows:nRows,dupKids:kids.map(k=>k.name.toLowerCase()).join(' and ')});
      goRec(d,{name:'record',formId:form.id,recordId:null});
      setTimeout(()=>{const t=document.getElementById('in-record-'+(titleFieldOf(form)?.id||''));if(t){t.focus();try{t.select();}catch(e){}}},0);
      break;}
    case 'rec-history':if(view.recordId)go({name:'audit',recordId:view.recordId});break;
    case 'nav-exports':if(view.name!=='exports')exportLeave();go({name:'exports'});break;
    case 'theme':{const t=applyTheme(document,nextTheme(readTheme(localStorage)),localStorage);renderSide();toast(themeLabel(t)==='Auto'?'Theme: Auto (follows this device)':'Theme: '+themeLabel(t)+' on this device');$('[data-act="theme"]')?.focus({preventScroll:true});break;}
    case 'sign-out':if(!guard())return;await signOutUser();break;
    case 'back':back();break;
    case 'new-record':{const f=formById(id);if(f)goRec(newRecordDraft(f,null),{name:'record',formId:id,recordId:null});break;}
    case 'open-record':{const r=recById(id);if(r)goRec(null,{name:'record',formId:r.formId,recordId:r.id});break;}
    case 'add-child':{const parent=recById(view.recordId);const cf=formById(id);if(!parent||!cf)return;if(rdraft?.dirty){toast('Save this record first.');return;}goRec(newRecordDraft(cf,parent),{name:'record',formId:cf.id,recordId:null});break;}
    case 'save-record':saveRecord();break;
    case 'grid-add':{const cf=formById(el.dataset.grid);const g=rdraft?.grids?.[el.dataset.grid];if(!cf||!g)return;const row={id:uid('r'),values:newRowValues(cf,rdraft,formById(rdraft.formId)),ownerId:store.user.uid,isNew:true,dirty:true,errors:{}};g.rows.push(row);markDirty(rdraft);renderMain();document.querySelector(`tr[data-growid="${row.id}"] .gin, tr[data-growid="${row.id}"] .gck, tr[data-growid="${row.id}"] .gpopbtn`)?.focus({preventScroll:true});document.querySelector(`tr[data-growid="${row.id}"]`)?.scrollIntoView({block:'nearest'});break;}
    case 'grid-del':{const g=rdraft?.grids?.[el.dataset.grid];if(!g)return;const row=g.rows.find(r=>r.id===el.dataset.row);if(!row)return;g.rows=g.rows.filter(r=>r!==row);if(!row.isNew)g.removed.push(row.id);markDirty(rdraft);renderMain();toast('Row removed. It’s deleted when you save; Discard brings it back.');break;}
    case 'fold':{const fid=rdraft?.formId;if(!fid)return;const k=el.dataset.k;saveFolds(setFold(folds(),fid,k,!folded(fid,k)));renderMain();document.querySelector(`[data-act="fold"][data-k="${CSS.escape(k)}"]`)?.focus({preventScroll:true});break;}
    case 'fold-all':{const form=formById(rdraft?.formId);if(!form)return;const keys=recordFoldKeys(form,rdraft.recordId?recById(rdraft.recordId):null);const shut=keys.some(k=>!folded(form.id,k));saveFolds(setFolds(folds(),form.id,keys,shut));renderMain();document.querySelector('[data-act="fold-all"]')?.focus({preventScroll:true});break;}
    case 'grid-attach':{
      const d=rdraft,cf=formById(el.dataset.grid),form=formById(d?.formId),g=d?.grids?.[el.dataset.grid];if(!cf||!g||!form)return;
      const rel=(form.children||[]).find(c=>c.formId===cf.id);
      openPickChildren({parentForm:form,parentId:d.recordId||null,parentValues:d.values,parentTitle:d.recordId?recTitle({formId:form.id,values:d.values},form):'this new '+itemName(form).toLowerCase(),childForm:cf,exclude:new Set(g.rows.map(r=>r.id)),
        onPick:recs=>{
          if(rdraft!==d)return;
          recs.forEach(r=>{const values=clone(r.values||{});if(rel?.copy)Object.assign(values,copyPatch(form,cf,d.values,values));
            g.detached=(g.detached||[]).filter(x=>x.id!==r.id);
            g.rows.push({id:r.id,values,ownerId:r.ownerId,createdAt:r.createdAt,isNew:false,dirty:true,errors:{},attached:true,fromParent:r.parentId||null});});
          markDirty(d);renderMain();
          toast(`Attached ${recs.length} ${recs.length===1?itemName(cf).toLowerCase():cf.name.toLowerCase()}. They’re saved with this ${itemName(form).toLowerCase()}.`);
        }});
      break;}
    case 'grid-detach':{
      const d=rdraft,g=d?.grids?.[el.dataset.grid],cf=formById(el.dataset.grid);if(!g||!cf)return;
      const row=g.rows.find(r=>r.id===el.dataset.row);if(!row)return;
      g.rows=g.rows.filter(r=>r!==row);
      const stored=recById(row.id);
      if(d.recordId&&stored&&stored.parentId===d.recordId){g.detached=g.detached||[];g.detached.push(row);} // on this record now: saved as unattached
      markDirty(d);renderMain();
      toast(`Detached. The ${itemName(cf).toLowerCase()} is kept${d.recordId&&stored?.parentId===d.recordId?' and saved as unattached when you save; Discard brings it back':''}.`);
      break;}
    case 'child-attach':{
      const parent=recById(view.recordId),cf=formById(id),pf=parent&&formById(parent.formId);if(!parent||!cf||!pf)return;
      if(rdraft?.dirty){toast('Save this record first.');return;}
      const rel=(pf.children||[]).find(c=>c.formId===cf.id);
      openPickChildren({parentForm:pf,parentId:parent.id,parentValues:parent.values||{},parentTitle:recTitle(parent,pf),childForm:cf,exclude:new Set(store.records.filter(r=>r.parentId===parent.id&&r.formId===cf.id).map(r=>r.id)),
        onPick:async recs=>{
          try{await attachRecords(recs.map(r=>withFormulas(cf,r,attachChange(r,parent,pf,cf,!!rel?.copy))));}
          catch(err){console.error('[formwright] attach',err);toast(err?.code==='permission-denied'?'You don’t have permission to change one of those. Nothing was attached.':'Attaching failed. Check your connection and try again.');return false;}
          toast(`Attached ${recs.length} ${recs.length===1?itemName(cf).toLowerCase():cf.name.toLowerCase()}`);renderMain();
        }});
      break;}
    case 'child-detach':{
      const r=recById(id),cf=r&&formById(r.formId);if(!r||!cf)return;
      try{await attachRecords([withFormulas(cf,r,detachChange(r,cf,r.parentFormId||recById(r.parentId)?.formId))]);}
      catch(err){console.error('[formwright] detach',err);toast(err?.code==='permission-denied'?'You don’t have permission to change that record.':'Detaching failed. Check your connection and try again.');return;}
      toast(`Detached ${recTitle(r,cf)}. It’s kept; Attach existing brings it back.`);renderMain();
      break;}
    case 'grid-cell':{const g=rdraft?.grids?.[el.dataset.grid];const cf=formById(el.dataset.grid);const row=g?.rows.find(r=>r.id===el.dataset.row);if(!row||!cf)return;cdraft={formId:cf.id,values:row.values,errors:{},_row:row,_fid:el.dataset.fid,readOnly:rdraft.readOnly||!rowEditable(row,cf)};renderMain();document.querySelector('.gpop [data-scope="cell"] input, .gpop [data-scope="cell"] textarea, .gpop [data-scope="cell"] canvas')?.focus();break;}
    case 'cell-close':{const back=cdraft&&`[data-act="grid-cell"][data-row="${cdraft._row.id}"][data-fid="${cdraft._fid}"]`;cdraft=null;renderMain();if(back)document.querySelector(back)?.focus();break;}
    case 'task-done':toggleTask(id);break;
    case 'task-open':if(cadenceUrl)window.open(cadenceLink(cadenceUrl,{task:id}),'cadence');break;
    case 'add-task':if(cadenceUrl&&view.recordId)window.open(cadenceLink(cadenceUrl,{addTaskFor:view.recordId}),'cadence');break;
    case 'export-pdf':exportPdf();break;
    case 'email-pdf':openMail();break;
    case 'mail-cancel':if(ui.mail&&!ui.mail.busy){ui.mail=null;renderMain();document.querySelector('[data-act="email-pdf"]')?.focus();}break;
    case 'mail-scrim':if(e.target===el&&ui.mail&&!ui.mail.busy){ui.mail=null;renderMain();}break;
    case 'mail-send':sendMail();break;
    case 'an-edit':{const rid=rdraft?.recordId;const t=recById(rid)?.nums?.[el.dataset.fid]||'';ui.anEdit={rec:rid,fid:el.dataset.fid,value:t,busy:false};renderMain();const i=document.querySelector('[data-anval]');if(i){i.focus();i.select();}break;}
    case 'an-cancel':ui.anEdit=null;renderMain();break;
    case 'an-save':{const ed=ui.anEdit;if(!ed||ed.busy)return;const v=String(ed.value||'').trim();if(!v){toast('Type the new number.');return;}if(v===(recById(ed.rec)?.nums?.[ed.fid]||'')){ui.anEdit=null;renderMain();return;}
      ed.busy=true;renderMain();
      try{await setAutoNumber(ed.rec,ed.fid,v);ui.anEdit=null;toast(`Number changed to ${v}`);}
      catch(e){ed.busy=false;toast(/already-exists/.test(e?.code||'')?e.message:/not-found|404/i.test(e?.code||e?.message||'')?'The numbering service isn’t set up yet. Deploy the Cadence functions first.':'Couldn’t change it: '+(e?.message||'try again'));}
      renderMain();break;}
    case 'an-fill':{if(fdraft?.dirty){toast('Save the form first.');return;}const fid=el.dataset.fid,formId=fdraft?.id;if(!formId||ui.anBusy)return;
      ui.anBusy=fid;renderMain();
      try{const r=await fillAutoNumbers(formId,fid);
        ui.anNext={...(ui.anNext||{})};delete ui.anNext[formId+'|'+fid];
        toast([r.numbered?`Numbered ${r.numbered} (${r.first}${r.numbered>1?' to '+r.last:''})`:'',r.kept?`kept ${r.kept} typed number${r.kept>1?'s':''}`:'',r.duplicates?.length?`check duplicates: ${r.duplicates.slice(0,5).join(', ')}`:''].filter(Boolean).join('; ')+'.');}
      catch(e){toast(/not-found|404/i.test(e?.code||e?.message||'')?'The numbering service isn’t set up yet. Deploy the Cadence functions first.':'Couldn’t number them: '+(e?.message||'try again'));}
      ui.anBusy=null;renderMain();[500,1500].forEach(ms=>setTimeout(()=>{if(view.name==='formEdit'&&ui.openField)renderMain();},ms));break;}
    case 'sub-pop':{const k=el.dataset.k;ui.subPop=ui.subPop===k?null:k;renderMain();if(ui.subPop)document.querySelector('.sub-pop input:not(:disabled)')?.focus({preventScroll:true});else document.querySelector(`[data-act="sub-pop"][data-k="${CSS.escape(k)}"]`)?.focus();break;}
    case 'sub-pop-close':{const k=ui.subPop;ui.subPop=null;renderMain();if(k)document.querySelector(`[data-act="sub-pop"][data-k="${CSS.escape(k)}"]`)?.focus();break;}
    case 'sub-col-move':{const fid=rdraft?.formId;if(!fid)return;const k=el.dataset.k,c=subCols(fid,k);if(!c)return;saveSub(fid,k,{cols:subMove(c.cur,el.dataset.v,+el.dataset.dir)});renderMain();document.querySelector(`[data-act="sub-col-move"][data-k="${CSS.escape(k)}"][data-v="${CSS.escape(el.dataset.v)}"][data-dir="${el.dataset.dir}"]:not(:disabled)`)?.focus();break;}
    case 'sub-cols-reset':{const fid=rdraft?.formId;if(!fid)return;saveSub(fid,el.dataset.k,{cols:undefined});renderMain();break;}
    case 'sub-sort':{const fid=rdraft?.formId;if(!fid)return;const k=el.dataset.k,c=subCols(fid,k);if(!c)return;const cur=subPrefs(fid,k).sort;saveSub(fid,k,{sort:subNext(cur,el.dataset.v,c.firstDir(el.dataset.v))});renderMain();document.querySelector(`[data-act="sub-sort"][data-k="${CSS.escape(k)}"][data-v="${CSS.escape(el.dataset.v)}"]`)?.focus();break;}
    case 'sub-showall':{const fid=rdraft?.formId;if(!fid)return;saveSub(fid,el.dataset.k,{show:'all'});renderMain();break;}
    case 'del-record':{const k='rec-'+view.recordId;if(ui.confirm!==k){ui.confirm=k;renderMain();return;}ui.confirm=null;const rid=view.recordId;rdraft.dirty=false;try{await store.del('records',rid);toast('Deleted');}catch(err){toast('Delete failed. Try again.');}break;}
    case 'rate':{const d=draftOf(el);const f=formOfDraft(d).fields.find(x=>x.id===el.dataset.fid);const n=+el.dataset.n;d.values[f.id]=d.values[f.id]===n?0:n;markDirty(d);repaint(d,f);break;}
    case 'file-clear':{const d=draftOf(el);const f=formOfDraft(d).fields.find(x=>x.id===el.dataset.fid);d.values[f.id]=null;markDirty(d);repaint(d,f);break;}
    case 'sig-clear':{const d=draftOf(el);const f=formOfDraft(d).fields.find(x=>x.id===el.dataset.fid);d.values[f.id]=null;markDirty(d);repaint(d,f);break;}
    case 'edit-form':editForm(id);break;
    case 'new-form':if(!guard())return;fdraft={id:uid('f'),name:'',itemName:'',description:'',color:store.forms.length%COLORS.length,showInSidebar:true,titleField:'',children:[],fields:[],isNew:true,dirty:true};fdraft.fields.push({...newField('text'),label:'Name',required:true,inList:true,width:'full'});pdraft=null;go({name:'formEdit',formId:fdraft.id});setTimeout(()=>$('.title-in')?.focus(),50);break;
    case 'tab':ui.tab=el.dataset.tab;ui.confirm=null;ui.openField=null;if(ui.tab==='preview'||ui.tab==='rules')pdraft=null;renderMain();break;
    case 'open-field':ui.openField=id;fmPos={x:0,y:0};renderMain();break;
    case 'close-field':ui.openField=null;renderMain();break;
    case 'focus-field':document.querySelector(`.crow[data-feid="${id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});break;
    case 'sec-move':{const k=el.dataset.k,dir=+el.dataset.dir;fdraft.sectionOrder=moveSection(sectionOrder(fdraft),k,dir);setFdirty();renderMain();const b=document.querySelector(`[data-act="sec-move"][data-k="${CSS.escape(k)}"][data-dir="${dir}"]:not(:disabled)`)||document.querySelector(`[data-act="sec-move"][data-k="${CSS.escape(k)}"]:not(:disabled)`);b?.focus();break;}
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
    case 'save-form':ui.ruleApply=null;saveForm();break;
    case 'wf-move':wfMove(el.dataset.id);break;
    case 'wf-start':{const rec=recById(view.recordId),form=rec&&formById(rec.formId);if(rec&&form){if(rdraft?.dirty){await saveRecord();if(rdraft?.dirty)return;}await doWfMove(recById(rec.id)||rec,form,firstStage(form),'Started','');}break;}
    case 'wf-cancel':if(ui.wfAsk&&!ui.wfAsk.busy){ui.wfAsk=null;renderMain();}break;
    case 'wf-scrim':if(e.target===el&&ui.wfAsk&&!ui.wfAsk.busy){ui.wfAsk=null;renderMain();}break;
    case 'wf-go':{const a=ui.wfAsk;if(!a||a.busy)return;if(a.need&&!String(a.comment||'').trim()){toast('Say why, so they know what to change.');document.querySelector('[data-wf-comment]')?.focus();return;}
      const rec=recById(a.recId),form=rec&&formById(rec.formId),t=form&&stageById(form,a.to);if(!t)return;a.busy=true;renderMain();await doWfMove(rec,form,t,a.label,a.comment);ui.wfAsk=null;renderMain();break;}
    case 'wf-who':ui.wfWho=el.dataset.v;renderMain();break;
    case 'nav-mywork':go({name:'mywork'});break;
    case 'cs-no':if(ui.cascade&&!ui.cascade.busy){ui.cascade=null;renderMain();}break;
    case 'cs-scrim':if(e.target===el&&ui.cascade&&!ui.cascade.busy){ui.cascade=null;renderMain();}break;
    case 'cs-go':runCascade();break;
    case 'ra-cancel':if(ui.ruleApply&&!ui.ruleApply.busy){ui.ruleApply=null;renderMain();}break;
    case 'ra-scrim':if(e.target===el&&ui.ruleApply&&!ui.ruleApply.busy){ui.ruleApply=null;renderMain();}break;
    case 'ra-leave':if(ui.ruleApply&&!ui.ruleApply.busy){ui.ruleApply.choice='leave';saveForm();}break;
    case 'ra-apply':if(ui.ruleApply&&!ui.ruleApply.busy){ui.ruleApply.choice='apply';ui.ruleApply.busy=true;renderMain();saveForm();}break;
    case 'done-form':if(fdraft.dirty&&!ui.leaveOk){ui.leaveOk=true;toast('Tap Discard again to drop your changes.');setTimeout(()=>ui.leaveOk=false,4000);return;}fdraft.dirty=false;go({name:'designer'});break;
    case 'del-form':{if(ui.confirm!=='form'){ui.confirm='form';renderMain();return;}ui.confirm=null;await deleteForm(fdraft.id);break;}
    case 'form-move':{const fs=[...store.forms].sort(byOrder);const i=fs.findIndex(x=>x.id===id),j=i+(+el.dataset.dir);if(j<0||j>=fs.length)return;[fs[i],fs[j]]=[fs[j],fs[i]];try{for(let k=0;k<fs.length;k++)if(fs[k].order!==k)await store.put('forms',{...fs[k],order:k});}catch(err){toast('Reordering failed. Try again.');}break;}
    case 'fx-ins':{const x=fdraft.fields.find(z=>z.id===el.dataset.fid);const ta=document.querySelector(`[data-feid="${x.id}"] textarea[data-prop=expr]`);if(!ta)return;const ins=el.dataset.ins;const st=ta.selectionStart??ta.value.length,en=ta.selectionEnd??st;ta.setRangeText(ins,st,en,'end');if(ins.endsWith('('))ta.setRangeText(')',ta.selectionStart,ta.selectionStart,'start');ta.focus();x.expr=ta.value;setFdirty();updateFxCheck(x);break;}
    case 'load-examples':await loadExamples();break;
    case 'try-reset':pdraft=null;renderMain();break;
    case 'preview-check':{const errs=validate(fdraft,pdraft.values,draftRules(pdraft));pdraft.errors=errs;renderMain();toast(Object.keys(errs).length?`${Object.keys(errs).length} field${Object.keys(errs).length>1?'s need':' needs'} attention.`:'Everything checks out.');break;}
    default:await admin.onClick(el,a,id);
  }
});
document.addEventListener('input',e=>{
  if(e.target.dataset?.mail&&ui.mail&&e.target.type!=='checkbox'){ui.mail[e.target.dataset.mail]=e.target.value;return;}
  if(e.target.dataset?.wfComment&&ui.wfAsk){ui.wfAsk.comment=e.target.value;return;}
  if(e.target.dataset?.anval){if(ui.anEdit)ui.anEdit.value=e.target.value;return;}
  const t=e.target;
  if(t.dataset.dzq!==undefined){ui.dzq=t.value;applyDzq();return;}
  if(t.id==='fs-q'){ui.fq=t.value;ui.fi=0;paintFormResults();return;}
  if(t.id==='dq'){ui.dq=t.value;applyDq();return;}
  if(t.dataset.grid&&t.dataset.gf){if(t.type!=='checkbox'&&t.tagName!=='SELECT')setGridVal(t);return;}
  if(t.dataset.ksearch&&rdraft&&view.name==='record'){rdraft.kq={...(rdraft.kq||{}),[t.dataset.ksearch]:t.value};const k=t.dataset.ksearch,pos=t.selectionStart;renderMain();const s=document.querySelector(`[data-ksearch="${CSS.escape(k)}"]`);if(s){s.focus({preventScroll:true});try{s.setSelectionRange(pos,pos)}catch(err){}}return;}
  if(t.id==='search'){ui.search=t.value;const pos=t.selectionStart;renderMain();const s=$('#search');if(s){s.focus();s.setSelectionRange(pos,pos);}return;}
  if(t.dataset.fid&&t.type!=='file'&&!(t.type==='radio'||t.type==='checkbox'))setVal(t);
  if(t.dataset.fprop&&t.dataset.kind!=='bool'){fdraft[t.dataset.fprop]=t.value;setFdirty();}
  if(t.dataset.prop&&!['bool','half'].includes(t.dataset.kind)&&t.tagName!=='SELECT'){
    const f=fdraft.fields.find(x=>x.id===t.closest('[data-feid]').dataset.feid);const p=t.dataset.prop,k=t.dataset.kind;
    f[p]=k==='num'?(t.value===''?null:Number(t.value)):k==='lines'?t.value.split('\n').map(s=>s.trim()):p==='currency'?t.value.toUpperCase():t.value;
    if(p==='expr')updateFxCheck(f);
    if(f.type==='autonumber'){const ap=document.getElementById('ap-'+f.id);if(ap)ap.innerHTML=autoPrev(f);}
    if(p==='label'){fdraft.fields.filter(z=>z.type==='formula').forEach(updateFxCheck);const l=document.getElementById('frl-'+f.id);if(l)l.innerHTML=esc(f.label||'Untitled field')+(f.required?'<span class="req">*</span>':'');}
    setFdirty();
  }
  admin.onInput(t);
});
document.addEventListener('change',async e=>{
  if(ui.mail&&e.target.dataset?.mailto){const v=e.target.dataset.mailto;if(e.target.checked)ui.mail.to.add(v);else ui.mail.to.delete(v);return;}
  if(e.target.dataset?.wfJump){const v=e.target.value;e.target.value='';if(v)wfMove(null,v);return;}
  if(ui.mail&&e.target.dataset?.mail==='copyMe'){ui.mail.copyMe=e.target.checked;return;}
  if(ui.mail&&e.target.dataset?.mail==='attach'){ui.mail.attach=e.target.checked;renderMain();return;}
  {const t0=e.target,fid=rdraft?.formId;
   if(fid&&t0.dataset?.subcol){const k=t0.dataset.subcol,c=subCols(fid,k);if(c){saveSub(fid,k,{cols:subToggle(c.cur,t0.dataset.v,{min:c.min})});renderMain();document.querySelector(`[data-subcol="${CSS.escape(k)}"][data-v="${CSS.escape(t0.dataset.v)}"]`)?.focus({preventScroll:true});}return;}
   if(fid&&t0.dataset?.subshow){const v=t0.value==='all'?'all':Number(t0.value);saveSub(fid,t0.dataset.subshow,{show:v});renderMain();document.querySelector(`[data-subshow="${CSS.escape(t0.dataset.subshow)}"]`)?.focus({preventScroll:true});return;}
   if(fid&&t0.dataset?.subsort!=null&&t0.dataset.subsort){const [key,dir]=t0.value.split('|');saveSub(fid,t0.dataset.subsort,{sort:key?{key,dir}:undefined});renderMain();document.querySelector(`[data-subsort="${CSS.escape(t0.dataset.subsort)}"]`)?.focus({preventScroll:true});return;}}
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
    else if(p==='type'){const nf=newField(t.value);Object.assign(f,{type:t.value},Object.fromEntries(Object.entries(nf).filter(([key])=>!['id','label','required','inList','help','width'].includes(key)&&f[key]==null)));if(NOLIST.has(f.type))f.inList=false;}
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
document.addEventListener('keydown',e=>{
  if(e.target?.id==='fs-q'){
    const items=[...document.querySelectorAll('#fs-res .fs-item')];
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){if(!items.length)return;e.preventDefault();ui.fi=((ui.fi||0)+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;paintFormResults();return;}
    if(e.key==='Enter'){e.preventDefault();const it=items[ui.fi||0];if(e.shiftKey)it?.parentElement.querySelector('.fs-count')?.click();else it?.click();return;}
    if(e.key==='Escape'&&fsShown()){e.preventDefault();closeFormSearch();return;}
    return;
  }
  if(e.target?.dataset?.dzq!==undefined){
    if(e.key==='Enter'){e.preventDefault();const first=[...document.querySelectorAll('.dz-types .dz-chip')].find(c=>!c.hidden&&!c.closest('.pgroup')?.hidden);if(first)first.click();return;}
    if(e.key==='Escape'&&e.target.value){e.preventDefault();ui.dzq='';applyDzq();return;}
  }
  if(e.target?.id==='dq'&&e.key==='Escape'&&e.target.value){e.preventDefault();e.target.value='';ui.dq='';applyDq();}
});
document.addEventListener('pointerdown',e=>{if(ui.subPop&&!e.target.closest?.('.lv-anchor')){ui.subPop=null;renderMain();}},true);
document.addEventListener('keydown',e=>{if(e.target?.dataset?.anval&&(e.key==='Enter'||e.key==='Escape')){e.preventDefault();document.querySelector(e.key==='Enter'?'[data-act="an-save"]':'[data-act="an-cancel"]')?.click();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&ui.mail&&!ui.mail.busy){e.preventDefault();ui.mail=null;renderMain();document.querySelector('[data-act="email-pdf"]')?.focus();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&ui.subPop){e.preventDefault();const k=ui.subPop;ui.subPop=null;renderMain();document.querySelector(`[data-act="sub-pop"][data-k="${CSS.escape(k)}"]`)?.focus();}});
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

/* ---------- Designer: moving fields and section cards by their handle ----------
   Pointer events, so it works with a mouse, a finger or a pen. Only the handle starts a
   drag (touch-action:none on it), so scrolling the page with a thumb never moves anything.
   Arrow keys on a focused handle move it one place. */
let pd=null; // { kind:'field'|'section', id, el, others, to, y0, cy, pid, moved, line, raf }
const pdItems=kind=>[...document.querySelectorAll(kind==='field'?'[data-dz-canvas] .crow':'.scards .scard')];
function pdApply(kind,id,to){
  if(kind==='field'){
    const fs=fdraft.fields,moved=fs.find(x=>x.id===id);if(!moved)return false;
    const rest=fs.filter(x=>x.id!==id),next=[...rest.slice(0,to),moved,...rest.slice(to)];
    if(next.every((x,k)=>x===fs[k]))return false;
    fdraft.fields=next;
  }else{
    const order=sectionOrder(fdraft),rest=order.filter(k=>k!==id),next=[...rest.slice(0,to),id,...rest.slice(to)];
    if(next.join()===order.join())return false;
    fdraft.sectionOrder=next;
  }
  setFdirty();renderMain();
  document.querySelector(`[data-pdrag="${kind}"][data-v="${CSS.escape(id)}"]`)?.focus({preventScroll:true});
  return true;
}
function pdTrack(){
  if(!pd)return;
  const dy=(pd.cy+window.scrollY)-pd.y0;
  pd.el.style.transform=`translateY(${dy}px)`;
  let i=pd.others.length;
  for(let k=0;k<pd.others.length;k++){const r=pd.others[k].getBoundingClientRect();if(pd.cy<r.top+r.height/2){i=k;break;}}
  pd.to=i;
  const ref=pd.others[i],last=pd.others[pd.others.length-1];
  const box=(ref||last||pd.el).getBoundingClientRect();
  const y=ref?box.top-5:box.bottom+3;
  Object.assign(pd.line.style,{top:y+'px',left:box.left+'px',width:box.width+'px'});
}
function pdLoop(){
  if(!pd)return;
  const edge=70,dir=pd.cy<edge?-1:pd.cy>window.innerHeight-edge?1:0; // near the top or bottom: scroll the page
  if(dir){window.scrollBy(0,dir*12);pdTrack();}
  pd.raf=requestAnimationFrame(pdLoop);
}
function pdEnd(apply){
  const d=pd;if(!d)return;pd=null;
  cancelAnimationFrame(d.raf);d.line.remove();d.el.classList.remove('lifting');d.el.style.transform='';
  document.body.classList.remove('pd-on');
  if(apply&&d.moved)pdApply(d.kind,d.id,d.to);
}
document.addEventListener('pointerdown',e=>{
  const g=e.target.closest?.('[data-pdrag]');
  if(!g||!fdraft||(e.button!=null&&e.button!==0))return;
  const kind=g.dataset.pdrag,items=pdItems(kind),el=g.closest(kind==='field'?'.crow':'.scard');
  if(!el||items.indexOf(el)<0||items.length<2)return;
  e.preventDefault();
  try{g.setPointerCapture(e.pointerId);}catch(err){/* older browsers */}
  const line=document.createElement('div');line.className='pd-line';document.body.appendChild(line);
  pd={kind,id:g.dataset.v,el,others:items.filter(x=>x!==el),to:items.indexOf(el),y0:e.clientY+window.scrollY,cy:e.clientY,pid:e.pointerId,moved:false,line,raf:0};
  el.classList.add('lifting');document.body.classList.add('pd-on');
  pdTrack();pd.raf=requestAnimationFrame(pdLoop);
});
window.addEventListener('pointermove',e=>{
  if(!pd||e.pointerId!==pd.pid)return;
  pd.cy=e.clientY;
  if(Math.abs(e.clientY+window.scrollY-pd.y0)>4)pd.moved=true;
  pdTrack();
});
window.addEventListener('pointerup',e=>{if(pd&&e.pointerId===pd.pid)pdEnd(true);});
window.addEventListener('pointercancel',e=>{if(pd&&e.pointerId===pd.pid)pdEnd(false);});
document.addEventListener('keydown',e=>{
  const g=e.target.closest?.('[data-pdrag]');
  if(!g||!fdraft||!['ArrowUp','ArrowDown'].includes(e.key))return;
  e.preventDefault();
  const kind=g.dataset.pdrag,id=g.dataset.v,dir=e.key==='ArrowUp'?-1:1;
  if(kind==='field'){const i=fdraft.fields.findIndex(x=>x.id===id);if(i<0||i+dir<0||i+dir>=fdraft.fields.length)return;pdApply('field',id,i+dir);}
  else{const order=sectionOrder(fdraft),i=order.indexOf(id);if(i<0||i+dir<0||i+dir>=order.length)return;pdApply('section',id,i+dir);}
});

/* ---------- Designer: dragging a field type onto the form (mouse; tapping a type adds it) ---------- */
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
  if(chip){dzDrag={kind:'new',type:chip.dataset.type};e.dataTransfer.effectAllowed='copy';}
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
  initLists({ruleImpact,applyRuleChange,fmt,valOf,recTitle,titleFieldOf,parentsOf,formById,recById,recordsOf,renderMain,withFormulas,search:()=>ui.search});
  initAudit({fmt,formById,recById,recTitle:(r,f)=>recTitle(r,f),go,renderMain});
  initAttach({fmt,valOf,recTitle,titleFieldOf,formById,recById});
  initWfDesign({setFdirty,renderMain,ui:()=>ui,people:()=>store.users.map(u=>({id:u.id,name:store.profiles[u.id]?.displayName||u.displayName||(u.email||'').split('@')[0]||'Unnamed'})).sort((a,b)=>a.name.localeCompare(b.name)),groups:()=>[...store.groups].sort((a,b)=>(a.name||'').localeCompare(b.name||'')),sections:f=>rulesCtx(f).targets.filter(t=>['grid','child','tasks'].includes(t.kind))});
  initAutos({formById,recById,parentsOf,recordsOf,recTitle,go,renderMain,forms:()=>[...store.forms].sort(byOrder)});
  initRules({formById,recById,parentsOf,recordsOf,recTitle,setFdirty,renderMain,ui:()=>ui});
  initImports({ruleClears:(form,r)=>toClear(form,r.values,rulesOf(form,r,r.parentId?recById(r.parentId):null)),fmt,recTitle,formById,go,renderMain,computeFormulas:(form,rec)=>{const out={};(form.fields||[]).filter(f=>f.type==='formula').forEach(f=>{const r=calc(form,f,rec);out[f.id]=r.e?null:r.v;});return out;}});
  Object.assign(ui,{search:'',openField:null,tab:'fields',palette:false,confirm:null,leaveOk:false,dzq:''});
  store.onChange=onData;
  store.onError=(err)=>{if(err?.code==='permission-denied')toast('Some data could not be loaded because of your permissions.');else toast('Lost the connection to the database. Changes will sync when it returns.');};
}
export function stopApp(){
  booted=false;store.onChange=()=>{};$('#app').hidden=true;document.getElementById('noaccess')?.remove();closeMenu();resetLists();resetImports();forgetDrafts();
  if(tw.unsub){tw.unsub();tw.unsub=null;}tw.recordId=null;
}
export { view as currentView, ui, byOrder, formById, recordsOf, renderMain };
