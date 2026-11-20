"use strict";
/* TUSOME Finance & Procurement — browser app.
   Every permission is enforced by the database (supabase/*.sql). This file only shows or hides
   controls to match; it is never the security boundary. */

/* ============ constants ============ */
const CATS = ["Operations & Essential Costs","Training","M&E, Reporting, and Legal Support","Product Development & Tech Improvements","Marketing & User Acquisition","Safeguarding, Gender, & Compliance"];
const KINDS = ["Goods","Service","Consultant / individual contractor","Software / subscription","Event, travel or logistics"];
const FISCAL = ["Not checked","Verified","Exception approved","None"];
const EVIDENCE = ["Complete","Partially Supported","Missing Evidence","Amount Mismatch","Date Mismatch","Duplicate","Requires Clarification","Not Applicable"];
const SUP_TYPES = ["Company","Individual","Government body","Platform / online service","To confirm"];
const CON_TYPES = ["Supply of goods","Service","Consultancy","Software / subscription","Lease / rent","Other"];
const CON_STATUS = ["Draft","Active","Completed","Expired","Terminated"];
const ACC_TYPES = ["Bank account","Mobile-money wallet","Payment gateway","Petty cash","Card"];
const ACC_STATUS = ["Active","Dormant","Closed","To confirm","Personal account used for company payments"];
const ROLES = ["admin","director","approver","custodian","staff","auditor"];
const ROLE_NAME = {admin:"Administrator",director:"Director",approver:"Band 1–2 approver",custodian:"Finance custodian",staff:"Staff",auditor:"Auditor (read-only)"};
const STEP_ROLE = {ID:"approver", DIR:"director"};
const STEP_NAME = {ID:"Band 1–2 approver (Independent Director)", DIR:"Director"};
const VIEWS = [["today","Today"],["requests","Purchase requests"],["expenses","Expenses & claims"],["owed","Who we owe"],["envelopes","Envelopes"],["bank","Bank & reconciliation"],["suppliers","Suppliers"],["contracts","Contracts"],["exceptions","Exceptions"],["audit","Audit trail"],["setup","Rules & roles"],["people","People & logins"]];
const TABS = [["today","Today","M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"],["requests","Requests","M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7"],["expenses","Expenses","M4 7h16v11H4zM4 10h16M8 15h3"],["owed","Owed","M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"],["more","More","M4 6h16M4 12h16M4 18h16"]];

/* ============ state ============ */
let sb = null;
const S = {session:null,email:null,member:null,settings:null,members:{},requests:{},suppliers:{},contracts:{},accounts:{},approvals:{},audit:[],
  envelopes:{},claims:{},reimbursements:{},reconciliations:{},loaded:false};
let view="today", tab="all", ctab="mine", q="", af="", sheetFor=null;

/* ============ helpers ============ */
const $=s=>document.querySelector(s);
function h(tag,attrs,...kids){const el=document.createElement(tag);if(attrs)for(const[k,v]of Object.entries(attrs)){if(v==null||v===false)continue;if(k.startsWith("on"))el.addEventListener(k.slice(2),v);else if(k==="class")el.className=v;else el.setAttribute(k,v===true?"":v)}for(const c of kids.flat(9)){if(c==null||c===false)continue;el.append(c instanceof Node?c:document.createTextNode(String(c)))}return el}
function svg(d){const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("fill","none");s.setAttribute("stroke","currentColor");s.setAttribute("stroke-width","1.8");s.setAttribute("stroke-linecap","round");s.setAttribute("stroke-linejoin","round");s.setAttribute("aria-hidden","true");const p=document.createElementNS("http://www.w3.org/2000/svg","path");p.setAttribute("d",d);s.append(p);return s}
const today=()=>new Date().toISOString().slice(0,10);
const n0=v=>Number(v)||0;
function money(a,c){if(a===""||a==null||isNaN(a))return "—";return (c==="USD"?"USD ":"TZS ")+Number(a).toLocaleString("en-GB",{minimumFractionDigits:c==="USD"?2:0,maximumFractionDigits:c==="USD"?2:0})}
const tzs=a=>money(a,"TZS");
function fmtDate(d){if(!d)return "—";const x=new Date(String(d).length===10?d+"T00:00:00":d);return isNaN(x)?d:x.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}
function fmtTime(d){const x=new Date(d);return isNaN(x)?"":x.toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}
const daysSince=d=>d?Math.floor((new Date(today()+"T00:00:00")-new Date(String(d).slice(0,10)+"T00:00:00"))/864e5):null;
function pill(text,cls){return h("span",{class:"pill "+cls},text)}
function toast(m){const t=$("#toast");t.textContent=m;t.classList.add("show");clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove("show"),3400)}
function nameOf(key){if(!key)return "—";const m=S.members[key];if(m&&m.full_name)return m.full_name;const c=Object.values(S.claims).find(x=>x.claimant===key&&x.claimant_name);if(c)return c.claimant_name;return String(key).replace(/^name:/,"")}
const myRoles=()=>(S.member&&S.member.active?S.member.roles:[])||[];
const hasRole=r=>myRoles().includes(r);
const hasAny=rs=>rs.some(hasRole);
const canWrite=()=>myRoles().some(r=>r!=="auditor");
const isAdmin=()=>hasRole("admin");
const seesAllClaims=()=>hasAny(["approver","director","admin","custodian","auditor"]);
const canReconcile=()=>hasAny(["admin","custodian"]);
function emailsWithRole(r){return Object.values(S.members).filter(m=>m.active&&(m.roles||[]).includes(r)).map(m=>m.email)}
/* Responsive table: columns [{l:label, num, primary, mono}], rows of cells. On phones each row becomes a card. */
function T(cols,rows,onRow){return h("div",{class:"tbl"},h("table",{class:"rt"},h("thead",null,h("tr",null,cols.map(c=>h("th",{class:c.num?"num":null},c.l)))),
  h("tbody",null,rows.map((cells,i)=>{const fn=onRow?onRow(i):null;return h("tr",{class:fn?"click":null,onclick:fn},cells.map((v,j)=>h("td",{class:[cols[j].num?"num":"",cols[j].primary?"primary":"",cols[j].mono?"mono":""].join(" ").trim()||null,"data-label":cols[j].l},v)))}))))}

/* ============ policy engine (display only; the database enforces the same rules) ============ */
function cfg(){const s=S.settings||{};return{fxRates:s.fx_rates||[],band1Tzs:n0(s.band1_tzs)||500000,thresholdUsd:n0(s.threshold_usd)||1000,splitDays:n0(s.split_days)||30,policyDate:s.policy_date||"2026-11-04",contractWarnDays:n0(s.contract_warn_days)||30,wht:s.wht||[],whtSource:s.wht_source||""}}
function fxFor(d){const rates=cfg().fxRates.filter(r=>r.date&&n0(r.rate)>0).sort((a,b)=>a.date<b.date?-1:1);let pick=null;for(const r of rates){if(r.date<=d)pick=r}return pick||rates[0]||null}
function amounts(r){const d=r.fxDate||r.date||today();const fx=fxFor(d);const rate=fx?n0(fx.rate):0;const a=n0(r.amount);
  if(r.currency==="USD")return{tzs:rate?a*rate:null,usd:a,rate,fx};return{tzs:a,usd:rate?a/rate:null,rate,fx}}
const toTzs=(a,c,d)=>amounts({amount:a,currency:c,date:d}).tzs;
function bandOf(t,u){const c=cfg();if(u!=null&&u>c.thresholdUsd)return 3;if(t!=null&&t>=c.band1Tzs)return 2;return 1}
const band=r=>{const a=amounts(r);return bandOf(a.tzs,a.usd)};
function bandText(n){const c=cfg();return n===1?"Below TZS "+c.band1Tzs.toLocaleString("en-GB"):n===2?"TZS "+c.band1Tzs.toLocaleString("en-GB")+" to USD "+c.thresholdUsd.toLocaleString("en-GB"):"Above USD "+c.thresholdUsd.toLocaleString("en-GB")}
const stepsFor=r=>band(r)===3?["ID","DIR"]:["ID"];
const prePolicy=r=>(r.date||"")<cfg().policyDate;
function quotesState(r){if(prePolicy(r))return"Pre-policy";const need=band(r);return((r.quotes||[]).length>=need||!!r.waiver)?"OK":"Short"}
const apprKey=(id,rev,step)=>id+"__"+rev+"__"+step;
const decisionFor=(r,step)=>S.approvals[apprKey(r.id,r.rev,step)]||null;
function chainState(r){let blocked=false;return stepsFor(r).map(step=>{const d=decisionFor(r,step);let s="pending";if(d)s=d.decision==="Approved"?"done":"rej";else if(!blocked&&r.submitted)s="now";if(s!=="done")blocked=true;return{step,dec:d,s}})}
const approvedAll=r=>chainState(r).every(x=>x.s==="done");
const rejected=r=>chainState(r).some(x=>x.s==="rej");
function status(r){
  if(!r.submitted)return{k:"draft",t:"Draft",c:"p-mute"};
  if(rejected(r))return{k:"rejected",t:"Rejected",c:"p-bad"};
  if(!approvedAll(r)){if(r.payment)return{k:"paid",t:"Paid without approval",c:"p-bad"};return{k:"approval",t:"Awaiting approval",c:"p-warn"}}
  if(!r.delivery)return{k:"approved",t:"Approved · awaiting delivery",c:"p-info"};
  if(!r.invoice)return{k:"approved",t:"Delivered · awaiting invoice",c:"p-info"};
  if(!r.payment)return{k:"payment",t:"Awaiting payment",c:"p-brand"};
  return{k:"paid",t:"Paid",c:"p-ok"}}
function supplierVerified(s){return !!(s&&s.tin&&["Yes","No"].includes(s.efd)&&s.callback==="Yes"&&s.verifiedBy&&["None declared","Declared"].includes(s.coi)&&s.f07)}
function splitFlag(r){if(!r.supplierId||!r.date)return null;const w=cfg().splitDays*864e5,d0=new Date(r.date);let t=0;
  for(const x of Object.values(S.requests)){if(x.supplierId!==r.supplierId||!x.date||rejected(x))continue;if(Math.abs(new Date(x.date)-d0)<=w){const a=amounts(x).tzs;if(a!=null)t+=a}}
  const rate=amounts(r).rate;return bandOf(t,rate?t/rate:null)>band(r)?t:null}
function checks(r){const out=[];
  if(r.submitted&&quotesState(r)==="Short")out.push(["Quotations short","Band "+band(r)+": "+(r.quotes||[]).length+" of "+band(r)+" quotes on record"]);
  if(r.submitted&&!approvedAll(r)&&!rejected(r)&&(r.payment||r.retro))out.push(["Approval missing","Route: "+stepsFor(r).map(x=>STEP_NAME[x]).join(" then ")]);
  if(r.payment&&!approvedAll(r))out.push(["Paid before approval","Payment recorded without a complete approval chain"]);
  const sp=splitFlag(r);if(sp!=null)out.push(["Possible split purchase","Supplier total within "+cfg().splitDays+" days: "+tzs(sp)]);
  const s=S.suppliers[r.supplierId];if(r.submitted&&!supplierVerified(s))out.push(["Supplier not F07 verified",s?s.name:"No supplier selected"]);
  if(r.payment&&!["Verified","Exception approved"].includes(r.invoice&&r.invoice.fiscal))out.push(["Fiscal receipt gap","Status: "+((r.invoice&&r.invoice.fiscal)||"No invoice recorded")]);
  if(!amounts(r).rate&&r.currency==="USD")out.push(["No FX rate","Add an approval FX rate in Rules & roles"]);
  return out}
const daysToEnd=c=>c.end?Math.round((new Date(c.end+"T00:00:00")-new Date(today()+"T00:00:00"))/864e5):null;
function contractChecks(c){const out=[];if(c.type==="Consultancy"){const ok=v=>v==="Yes"||v==="Not applicable";if(!(ok(c.tor)&&c.ip==="Yes"&&ok(c.saf)&&ok(c.data)))out.push(["Consultancy clauses missing","Check ToR, IP, SAF-01, DATA-02"])}
  const d=daysToEnd(c);if(c.status==="Active"&&d!=null&&d>=0&&d<=cfg().contractWarnDays)out.push(["Contract ending soon",d+" days to end"]);return out}
function invoicedFor(cid){let t=0;Object.values(S.requests).forEach(r=>{if(r.contractId===cid&&r.invoice)t+=n0(r.invoice.amount)});return t}
/* envelopes */
function envelopeUse(e){let req=0,cl=0;const items=[];
  Object.values(S.requests).forEach(r=>{if(r.envelopeId===e.id&&r.submitted&&!rejected(r)){const v=toTzs(r.amount,r.currency,r.date)||0;req+=v;items.push(["Request",r.id,r.title,v])}});
  Object.values(S.claims).forEach(c=>{if(c.envelope_id===e.id&&["Submitted","Approved","Reimbursed"].includes(c.status)){const v=toTzs(c.amount,c.currency,c.date)||0;cl+=v;items.push(["Claim",c.id,c.description,v])}});
  const budget=e.currency==="USD"?toTzs(e.amount,"USD",today()):n0(e.amount);return{req,cl,used:req+cl,budget,left:(budget||0)-(req+cl),items}}
/* claims */
function claimNeedsDirector(c){const a=amounts(c);const claimantDir=((S.members[c.claimant]||{}).roles||[]).includes("director");return a.usd!=null&&a.usd>cfg().thresholdUsd&&!claimantDir}
function canDecideClaim(c){if(c.status!=="Submitted"||c.claimant===S.email)return false;return claimNeedsDirector(c)?hasRole("director"):hasAny(["approver","director"])}
const CLAIM_PILL={Draft:"p-mute",Submitted:"p-warn",Approved:"p-brand",Rejected:"p-bad",Reimbursed:"p-ok"};
function owedByPerson(){const m={};Object.values(S.claims).forEach(c=>{const p=m[c.claimant]=m[c.claimant]||{who:c.claimant,owed:{},pending:{},paid:{},claims:[]};
  p.claims.push(c);const bucket=c.status==="Approved"?p.owed:c.status==="Submitted"?p.pending:c.status==="Reimbursed"?p.paid:null;if(bucket)bucket[c.currency]=(bucket[c.currency]||0)+n0(c.amount)});return Object.values(m)}
const fmtByCur=o=>Object.keys(o).length?Object.entries(o).map(([c,v])=>money(v,c)).join(" + "):"—";
function toTzsSum(o){return Object.entries(o).reduce((t,[c,v])=>t+(toTzs(v,c,today())||0),0)}
/* bank */
function latestRecon(accId){return Object.values(S.reconciliations).filter(r=>r.account_id===accId).sort((a,b)=>(b.as_of+b.prepared_at).localeCompare(a.as_of+a.prepared_at))[0]||null}
function reconState(r){if(!r)return{t:"Not reconciled",c:"p-warn"};if(!r.reviewed_by)return{t:"Awaiting sign-off",c:"p-warn"};if(Math.abs(n0(r.difference))>0.005)return{t:"Signed off with difference",c:"p-info"};return{t:"Reconciled",c:"p-ok"}}
function cashPosition(){const t={};Object.values(S.accounts).forEach(a=>{if(a.holder!=="Company")return;const r=latestRecon(a.id);if(r)t[r.currency]=(t[r.currency]||0)+n0(r.statement_balance)});return t}

function allExceptions(){const out=[];
  Object.values(S.requests).forEach(r=>checks(r).forEach(([k,d])=>out.push({k,d,ref:r.id,who:(S.suppliers[r.supplierId]||{}).name||"—",amt:amounts(r).tzs,go:()=>openRequest(r.id)})));
  Object.values(S.contracts).forEach(c=>contractChecks(c).forEach(([k,d])=>out.push({k,d,ref:c.id,who:(S.suppliers[c.supplierId]||{}).name||"—",amt:c.currency==="USD"?null:n0(c.value),go:()=>editContract(c.id)})));
  Object.values(S.envelopes).forEach(e=>{if(e.status!=="Active")return;const u=envelopeUse(e);if(u.left<0)out.push({k:"Envelope overspent",d:e.name+": over by "+tzs(-u.left),ref:e.id,who:"—",amt:-u.left,go:()=>go("envelopes")})});
  Object.values(S.accounts).forEach(a=>{if(a.holder!=="Company"||!["Active","To confirm"].includes(a.status))return;const r=latestRecon(a.id);
    if(!r)out.push({k:"Account not reconciled",d:a.name+": no reconciliation recorded",ref:a.id,who:"—",amt:null,go:()=>go("bank")});
    else if(daysSince(r.as_of)>35)out.push({k:"Reconciliation overdue",d:a.name+": last reconciled "+fmtDate(r.as_of),ref:a.id,who:"—",amt:null,go:()=>go("bank")});
    else if(!r.reviewed_by)out.push({k:"Reconciliation awaiting sign-off",d:a.name+" as of "+fmtDate(r.as_of)+", prepared by "+nameOf(r.prepared_by),ref:r.id,who:"—",amt:null,go:()=>go("bank")});});
  const fx=fxFor(today());if(!fx||fx.status==="Placeholder")out.push({k:"FX rate not confirmed",d:"Add the current Bank of Tanzania rate",ref:"Rules",who:"—",amt:null,go:()=>go("setup")});
  if(!emailsWithRole("approver").length||!emailsWithRole("director").length)out.push({k:"Approvers not assigned",d:"Give at least one person the approver role and one the director role",ref:"People",who:"—",amt:null,go:()=>go("people")});
  return out}
function myPending(){const me=S.email;return Object.values(S.requests).filter(r=>{if(!r.submitted||rejected(r)||r.requester===me)return false;const now=chainState(r).find(x=>x.s==="now");return now&&hasRole(STEP_ROLE[now.step])})}
const myClaimDecisions=()=>Object.values(S.claims).filter(canDecideClaim);

/* ============ data ============ */
function rowToRequest(x){return Object.assign({},x.details||{},{id:x.id,requester:x.requester_email,date:x.date,supplierId:x.supplier_id,amount:n0(x.amount),currency:x.currency,submitted:x.submitted,submittedAt:x.submitted_at,rev:x.rev,retro:x.retro,_details:x.details||{}})}
const ROW_TABLES=["envelopes","claims","reimbursements","reconciliations"];
async function loadTable(name){
  if(name==="settings"){const{data,error}=await sb.from("settings").select("*").eq("id",1).maybeSingle();if(!error)S.settings=data;return}
  if(name==="members"){const{data,error}=await sb.from("members").select("*");if(error){S.loadError=error.message||String(error);console.error(error);return}S.loadError=null;S.members={};data.forEach(m=>S.members[m.email]=m);S.member=S.members[S.email]||null;return}
  if(name==="requests"){const{data,error}=await sb.from("requests").select("*");if(!error){S.requests={};data.forEach(x=>S.requests[x.id]=rowToRequest(x))}return}
  if(name==="approvals"){const{data,error}=await sb.from("approvals").select("*");if(!error){S.approvals={};data.forEach(a=>S.approvals[apprKey(a.request_id,a.rev,a.step)]=a)}return}
  if(name==="audit_log"){const{data,error}=await sb.from("audit_log").select("*").order("id",{ascending:false}).limit(500);if(!error)S.audit=data;return}
  if(ROW_TABLES.includes(name)){const{data,error}=await sb.from(name).select("*");if(error){console.warn(name,error.message);S.missing004=true;return}S[name]={};data.forEach(x=>S[name][x.id]=x);return}
  const{data,error}=await sb.from(name).select("*");if(!error){S[name]={};data.forEach(x=>S[name][x.id]=Object.assign({},x.data,{id:x.id}))}}
const TABLES=["settings","members","suppliers","contracts","accounts","requests","approvals","audit_log",...ROW_TABLES];
async function loadAll(){S.missing004=false;await Promise.all(TABLES.map(loadTable));S.loaded=true;render()}
let refreshTimer=null;const pending=new Set();
function scheduleRefresh(t){pending.add(t);pending.add("audit_log");clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{const list=[...pending];pending.clear();await Promise.all(list.map(loadTable));render()},250)}
function subscribe(){sb.channel("live").on("postgres_changes",{event:"*",schema:"public"},p=>scheduleRefresh(p.table)).subscribe()}
async function run(fn,okMsg,tables){try{const res=await fn();if(res&&res.error)throw res.error;if(okMsg)toast(okMsg);(tables||[]).forEach(scheduleRefresh);return res||true}catch(e){console.error(e);toast(friendly(e));return false}}
function friendly(e){const m=(e&&(e.message||e.error_description))||"";if(/row-level security|permission denied/i.test(m))return "You do not have permission to do that.";if(/relation .* does not exist|Could not find the table/i.test(m))return "The database needs the latest update (run supabase/004_expenses_envelopes_bank.sql).";return m||"Could not save. Try again."}
async function saveRequestDetails(r,patch,msg){const details=Object.assign({},r._details,patch);return run(()=>sb.from("requests").update({details}).eq("id",r.id),msg,["requests"])}

/* ============ auth ============ */
function authView(mode,msg){$("#appRoot").hidden=true;$("#tabbar").hidden=true;const root=$("#authRoot");root.hidden=false;const err=h("div",{class:"err",role:"alert"},msg||"");
  const card=h("form",{class:"authcard",onsubmit:e=>e.preventDefault()},h("div",{class:"brand",style:"padding:0"},h("div",{class:"mark","aria-hidden":"true"},"T"),h("div",null,"TUSOME Finance",h("small",null,"Procurement & approvals"))));
  if(mode==="login"){const em=h("input",{id:"lg-e",type:"email",autocomplete:"username",required:true}),pw=h("input",{id:"lg-p",type:"password",autocomplete:"current-password",required:true});
    const btn=h("button",{class:"btn primary",type:"submit"},"Sign in");
    card.append(h("h1",null,"Sign in"),h("label",{class:"f"},"Email",em),h("label",{class:"f"},"Password",pw),err,btn,h("button",{class:"linkbtn",type:"button",onclick:()=>authView("forgot")},"Forgot password?"));
    card.onsubmit=async e=>{e.preventDefault();btn.disabled=true;err.textContent="";const{error}=await sb.auth.signInWithPassword({email:em.value.trim().toLowerCase(),password:pw.value});btn.disabled=false;if(error)err.textContent=/invalid/i.test(error.message)?"Email or password is incorrect.":error.message}}
  else if(mode==="forgot"){const em=h("input",{type:"email",autocomplete:"username",required:true});const btn=h("button",{class:"btn primary",type:"submit"},"Send reset link");
    card.append(h("h1",null,"Reset password"),h("p",{class:"sub",style:"margin:0"},"Enter your TUSOME email. If it has a login, a reset link will arrive in a few minutes."),h("label",{class:"f"},"Email",em),err,btn,h("button",{class:"linkbtn",type:"button",onclick:()=>authView("login")},"Back to sign in"));
    card.onsubmit=async e=>{e.preventDefault();btn.disabled=true;await sb.auth.resetPasswordForEmail(em.value.trim().toLowerCase(),{redirectTo:location.origin});btn.disabled=false;err.style.color="var(--ok)";err.textContent="If that email has a login, a reset link is on its way."}}
  else if(mode==="newpass"){const p1=h("input",{type:"password",autocomplete:"new-password",minlength:"10",required:true}),p2=h("input",{type:"password",autocomplete:"new-password",required:true});const btn=h("button",{class:"btn primary",type:"submit"},"Save new password");
    card.append(h("h1",null,"Choose a new password"),h("label",{class:"f"},"New password",p1,h("span",{class:"hint"},"At least 10 characters.")),h("label",{class:"f"},"Repeat password",p2),err,btn);
    card.onsubmit=async e=>{e.preventDefault();if(p1.value.length<10){err.textContent="Use at least 10 characters.";return}if(p1.value!==p2.value){err.textContent="The passwords do not match.";return}btn.disabled=true;const{error}=await sb.auth.updateUser({password:p1.value});btn.disabled=false;if(error){err.textContent=error.message;return}toast("Password saved");setTimeout(startApp,0)}}
  root.replaceChildren(h("div",{class:"auth"},card));const f=root.querySelector("input");if(f)f.focus()}
async function startApp(){$("#authRoot").hidden=true;$("#appRoot").hidden=false;$("#tabbar").hidden=false;S._routed=false;await loadAll();
  if(!S.member||!S.member.active){$("#view").replaceChildren(h("div",{class:"banner"},h("b",null,"No access. "),S.loadError?"The database refused to load the member list: "+S.loadError+". The administrator should run supabase/003_fix_access.sql.":"This login is not an active TUSOME Finance member. Ask the administrator to add "+S.email+"."),h("div",{class:"row"},h("button",{class:"btn",onclick:signOut},"Sign out")));$("#nav").replaceChildren();$("#tabbar").hidden=true;$("#who").replaceChildren(S.email||"");return}
  if(!S._subscribed){subscribe();S._subscribed=true}readHash()}
async function signOut(){S.session=null;S.email=null;S.member=null;S.loaded=false;S._subscribed=false;sheetFor=null;
  try{sb.removeAllChannels()}catch(e){}
  try{await Promise.race([sb.auth.signOut({scope:"local"}),new Promise(r=>setTimeout(r,2500))])}catch(e){console.warn(e)}
  try{Object.keys(localStorage).filter(k=>k.startsWith("sb-")).forEach(k=>localStorage.removeItem(k))}catch(e){}
  if(dlg.open)dlg.close();$("#sheetRoot").replaceChildren();history.replaceState(null,"",location.pathname);authView("login")}
function changePassword(){openDlg("Change password",h("div",{class:"fg"},field("cp-1","New password","password","",{hint:"At least 10 characters."}),field("cp-2","Repeat password","password","")),[saveBtn("Save password",async()=>{
  const a=val("cp-1"),b=val("cp-2");if(a.length<10){toast("Use at least 10 characters.");return false}if(a!==b){toast("The passwords do not match.");return false}
  const{error}=await sb.auth.updateUser({password:a});if(error){toast(error.message);return false}toast("Password changed")})])}

/* ============ navigation ============ */
function go(v){if(dlg.open)dlg.close();location.hash=v}
function readHash(){const x=(location.hash||"").slice(1);if(x.startsWith("r-")){sheetFor=x.slice(2);if(!S._routed)view="requests"}else{sheetFor=null;if(VIEWS.some(v=>v[0]===x))view=x}S._routed=true;render();window.scrollTo(0,0)}
window.addEventListener("hashchange",()=>{if(S.member)readHash()});
const openRequest=id=>{location.hash="r-"+id};
function closeSheet(){sheetFor=null;if(location.hash.startsWith("#r-"))history.replaceState(null,"","#"+view);render()}
const visibleViews=()=>VIEWS.filter(([k])=>k!=="people"||isAdmin());
function badgeFor(k){const cd=myClaimDecisions().length;if(k==="today"){const n=myPending().length+cd;return n?h("span",{class:"count"},n):null}
  if(k==="exceptions"){const n=allExceptions().length;return n?h("span",{class:"count bad"},n):null}if(k==="expenses"&&cd)return h("span",{class:"count"},cd);return null}
function renderNav(){
  $("#nav").replaceChildren(...visibleViews().map(([k,l])=>h("a",{href:"#"+k,"aria-current":view===k&&!sheetFor?"page":null},h("span",null,l),badgeFor(k))));
  $("#who").replaceChildren(h("b",null,(S.member&&S.member.full_name)||S.email),S.email,h("div",null,myRoles().filter(r=>r!=="staff").map(r=>ROLE_NAME[r]).join(" · ")||"Staff"),
    h("div",{class:"row",style:"margin-top:8px"},h("button",{class:"btn sm",onclick:changePassword},"Password"),h("button",{class:"btn sm",onclick:signOut},"Sign out")));
  const inTabs=TABS.some(t=>t[0]===view);
  $("#tabbar").replaceChildren(...TABS.map(([k,l,d])=>h("a",{href:k==="more"?"#"+view:"#"+k,"aria-current":(k===view||(k==="more"&&!inTabs))&&!sheetFor?"page":null,onclick:k==="more"?e=>{e.preventDefault();openMenu()}:null},svg(d),l,k==="more"?null:badgeFor(k))));
  $("#topTitle").textContent=(VIEWS.find(v=>v[0]===view)||[0,"TUSOME Finance"])[1]}
function openMenu(){openDlg("Menu",h("div",{class:"menu-list"},
  h("div",{class:"small muted",style:"padding:6px"},((S.member&&S.member.full_name)||S.email)+" · "+(myRoles().filter(r=>r!=="staff").map(r=>ROLE_NAME[r]).join(", ")||"Staff")),
  ...visibleViews().map(([k,l])=>h("a",{href:"#"+k,onclick:()=>dlg.close()},h("span",null,l),badgeFor(k))),
  h("button",{type:"button",onclick:()=>{dlg.close();changePassword()}},"Change password"),h("button",{type:"button",style:"color:var(--bad)",onclick:()=>{dlg.close();signOut()}},"Sign out")),[])}

/* ============ views ============ */
function render(){if(!S.member)return;renderNav();const parts=[];
  if(S.missing004)parts.push(h("div",{class:"banner"},h("b",null,"Database update needed. "),"Expenses, envelopes and reconciliations need supabase/004_expenses_envelopes_bank.sql to be run in Supabase."));
  if(!canWrite())parts.push(h("div",{class:"banner info"},h("b",null,"Read-only access. "),"You can view every record and the audit trail."));
  const fn={today:vToday,requests:vRequests,expenses:vExpenses,owed:vOwed,envelopes:vEnvelopes,bank:vBank,suppliers:vSuppliers,contracts:vContracts,exceptions:vExceptions,audit:vAudit,setup:vSetup,people:vPeople}[view]||vToday;
  parts.push(...[].concat(fn()));$("#view").replaceChildren(...parts);renderSheet()}
function header(title,sub,...actions){const a=actions.filter(Boolean);return h("div",{class:"head"},h("div",null,h("h1",null,title),sub?h("p",{class:"sub"},sub):null),a.length?h("div",{class:"row"},...a):null)}
function newBtn(label,fn,ok){return (ok===undefined?canWrite():ok)?h("button",{class:"btn primary",onclick:fn},label):null}
const tile=(v,l,onclick)=>h("div",{class:"tile",style:onclick?"cursor:pointer":null,onclick},h("div",{class:"v"},v),h("div",{class:"l"},l));
const empty=t=>h("div",{class:"empty"},t);

function vToday(){const reqs=Object.values(S.requests),pend=myPending(),cd=myClaimDecisions(),me=S.email;
  const mine=reqs.filter(r=>r.requester===me&&!["paid","rejected"].includes(status(r).k));
  const toPay=reqs.filter(r=>status(r).k==="payment");
  const myOwed=owedByPerson().find(p=>p.who===me);const exc=allExceptions(),fx=fxFor(today());const first=((S.member&&S.member.full_name)||"").split(" ")[0];
  return [header("Habari"+(first?", "+first:""),"What needs your attention today.",newBtn("New request",()=>editRequest()),newBtn("New expense",()=>editClaim())),
    h("div",{class:"tiles"},tile(pend.length+cd.length,"Waiting for your approval"),tile(toPay.length,"Approved, awaiting payment",()=>{tab="payment";go("requests")}),
      tile(fmtByCur(myOwed?myOwed.owed:{}),"TUSOME owes you",()=>go("owed")),tile(fmtByCur(cashPosition()),"Cash per latest statements",()=>go("bank")),
      tile(exc.length,"Open exceptions",()=>go("exceptions")),tile(fx?Number(fx.rate).toLocaleString("en-GB",{maximumFractionDigits:2}):"—","TZS per USD"+(fx?" · "+fmtDate(fx.date):""))),
    h("div",{class:"grid2"},h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Your approvals")),
        (pend.length||cd.length)?h("div",{class:"list"},reqItems(pend),claimItems(cd)):empty("Nothing waiting for you. Requests and expense claims appear here when it is your turn.")),
      h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Your open requests")),mine.length?h("div",{class:"list"},reqItems(mine)):empty("You have no open requests."))),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Exceptions"),h("a",{href:"#exceptions",class:"small"},"View all")),excTable(exc.slice(0,6)))]}
function reqItems(arr){return arr.map(r=>{const s=status(r);return h("button",{class:"li",onclick:()=>openRequest(r.id)},h("div",{style:"min-width:0"},h("div",{class:"t"},r.title||"Untitled"),h("div",{class:"small muted"},r.id+" · "+((S.suppliers[r.supplierId]||{}).name||"No supplier")+" · "+nameOf(r.requester)),trail(r)),h("div",{style:"text-align:right"},h("div",{class:"num",style:"font-weight:700"},money(r.amount,r.currency)),pill(s.t,s.c)))})}
function claimItems(arr){return arr.map(c=>h("button",{class:"li",onclick:()=>showClaim(c.id)},h("div",{style:"min-width:0"},h("div",{class:"t"},c.description),h("div",{class:"small muted"},c.id+" · expense claim · "+nameOf(c.claimant))),h("div",{style:"text-align:right"},h("div",{class:"num",style:"font-weight:700"},money(c.amount,c.currency)),pill(c.status,CLAIM_PILL[c.status]))))}
function trail(r){const ok=r.invoice&&["Verified","Exception approved"].includes(r.invoice.fiscal);const parts=[{s:r.submitted?"done":"now"},...chainState(r).map(x=>({s:x.s==="done"?"done":x.s==="rej"?"gap":x.s==="now"?"now":""})),{s:r.delivery?"done":""},{s:r.invoice?(ok?"done":"gap"):""},{s:r.payment?(approvedAll(r)?"done":"gap"):""}];
  return h("div",{class:"trail","aria-hidden":"true"},parts.map(p=>h("span",{class:p.s})))}

function searchBox(id,valNow,set,ph){return h("input",{id,type:"search",placeholder:ph,value:valNow,"aria-label":ph,oninput:e=>{set(e.target.value);const p=e.target.selectionStart;render();const el=document.getElementById(id);el.focus();el.setSelectionRange(p,p)}})}
function vRequests(){const reqs=Object.values(S.requests).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.id>a.id?1:-1));
  const groups=[["all","All"],["draft","Draft"],["approval","Awaiting approval"],["approved","Approved"],["payment","Awaiting payment"],["paid","Paid"],["rejected","Rejected"]];
  const cnt=k=>k==="all"?reqs.length:reqs.filter(r=>status(r).k===k).length;let rows=reqs.filter(r=>tab==="all"||status(r).k===tab);
  if(q){const ql=q.toLowerCase();rows=rows.filter(r=>[r.id,r.title,r.project,(S.suppliers[r.supplierId]||{}).name,(r.payment||{}).trackerId].join(" ").toLowerCase().includes(ql))}
  return [header("Purchase requests","Every purchase from "+fmtDate(cfg().policyDate)+" starts here. The band, quotations and approval route follow FIN-02 and GOV-01.",newBtn("New purchase request",()=>editRequest())),
    h("section",{class:"panel"},h("div",{class:"tabs",role:"tablist"},groups.map(([k,l])=>h("button",{role:"tab","aria-selected":tab===k?"true":"false",onclick:()=>{tab=k;render()}},l,h("span",{class:"n"},cnt(k))))),
      h("div",{class:"toolbar"},searchBox("q",q,v=>q=v,"Search number, item, supplier, project"),h("span",{class:"small muted"},rows.length+" shown")),
      !rows.length?empty(reqs.length?"No requests match.":"No purchase requests yet. Select “New purchase request” to raise the first one."):
      T([{l:"Item",primary:true},{l:"Number",mono:true},{l:"Date"},{l:"Supplier"},{l:"Requested by"},{l:"Band"},{l:"Amount",num:true},{l:"Status"}],
        rows.map(r=>{const s=status(r),ck=checks(r);return [h("div",null,h("div",{style:"font-weight:600"},r.title||"Untitled"),h("div",{class:"small muted"},r.project||""),trail(r)),r.id,fmtDate(r.date),(S.suppliers[r.supplierId]||{}).name||"—",nameOf(r.requester),"Band "+band(r),money(r.amount,r.currency),
          h("span",null,pill(s.t,s.c),ck.length?h("span",{class:"small",style:"color:var(--bad);margin-left:6px"},ck.length+" issue"+(ck.length>1?"s":"")):null)]}),i=>()=>openRequest(rows[i].id)))]}

/* ---- expenses & claims ---- */
function vExpenses(){const all=Object.values(S.claims).filter(c=>!c.opening).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.id>a.id?1:-1));
  const groups=[["mine","My claims"]];if(hasAny(["approver","director"]))groups.push(["decide","To approve"]);if(seesAllClaims())groups.push(["all","All claims"]);
  if(!groups.some(g=>g[0]===ctab))ctab="mine";
  const pick=k=>k==="mine"?all.filter(c=>c.claimant===S.email):k==="decide"?all.filter(canDecideClaim):all;const rows=pick(ctab);
  return [header("Expenses & claims","Spent your own money on TUSOME work? Log it here with the receipt. Once approved, it is added to what TUSOME owes you until it is reimbursed.",newBtn("New expense",()=>editClaim())),
    h("section",{class:"panel"},h("div",{class:"tabs",role:"tablist"},groups.map(([k,l])=>h("button",{role:"tab","aria-selected":ctab===k?"true":"false",onclick:()=>{ctab=k;render()}},l,h("span",{class:"n"},pick(k).length)))),
      !rows.length?empty(ctab==="decide"?"No claims waiting for your decision.":"No expense claims yet. Select “New expense” to log one."):
      T([{l:"Description",primary:true},{l:"Number",mono:true},{l:"Date"},{l:"Claimant"},{l:"Envelope"},{l:"Amount",num:true},{l:"Status"}],
        rows.map(c=>[h("div",null,h("div",{style:"font-weight:600"},c.description),h("div",{class:"small muted"},[c.payee,c.project].filter(Boolean).join(" · "))),c.id,fmtDate(c.date),nameOf(c.claimant),(S.envelopes[c.envelope_id]||{}).name||"—",money(c.amount,c.currency),pill(c.status,CLAIM_PILL[c.status])]),i=>()=>showClaim(rows[i].id)))]}
function showClaim(id){const c=S.claims[id];if(!c)return;const mine=c.claimant===S.email;const acts=[];
  if(mine&&["Draft","Rejected"].includes(c.status)){acts.push(h("button",{class:"btn",onclick:()=>{dlg.close();editClaim(c.id)}},"Edit"));
    acts.push(h("button",{class:"btn primary",onclick:async()=>{if(!c.receipt_link){toast("Add the receipt link first (Edit).");return}if(await run(()=>sb.from("claims").update({status:"Submitted"}).eq("id",c.id),"Submitted for approval",["claims"]))dlg.close()}},"Submit for approval"))}
  if(mine&&c.status==="Draft")acts.push(h("button",{class:"btn danger",onclick:async()=>{if(await run(()=>sb.from("claims").delete().eq("id",c.id),"Draft deleted",["claims"]))dlg.close()}},"Delete draft"));
  if(canDecideClaim(c)){acts.push(h("button",{class:"btn ok",onclick:()=>decideClaim(c,"Approved")},"Approve"));acts.push(h("button",{class:"btn danger",onclick:()=>decideClaim(c,"Rejected")},"Reject"))}
  const reimb=c.reimbursement_id&&S.reimbursements[c.reimbursement_id];const a=amounts(c);
  openDlg(c.id+" · "+c.status,h("div",{style:"display:grid;gap:14px"},
    claimNeedsDirector(c)&&c.status==="Submitted"?h("div",{class:"banner info"},"Above USD "+cfg().thresholdUsd.toLocaleString("en-GB")+": the Director decides this claim."):null,
    h("dl",null,h("dt",null,"Claimant"),h("dd",null,nameOf(c.claimant)),h("dt",null,"Date"),h("dd",null,fmtDate(c.date)),h("dt",null,"What"),h("dd",null,c.description),h("dt",null,"Paid to"),h("dd",null,c.payee||"—"),
      h("dt",null,"Amount"),h("dd",null,money(c.amount,c.currency)+(c.currency==="USD"&&a.tzs?" · "+tzs(a.tzs):"")),h("dt",null,"Paid from"),h("dd",null,c.paid_from||"—"),
      h("dt",null,"Project"),h("dd",null,c.project||"—"),h("dt",null,"Category"),h("dd",null,c.category||"—"),h("dt",null,"Envelope"),h("dd",null,(S.envelopes[c.envelope_id]||{}).name||"—"),
      h("dt",null,"Receipt"),h("dd",null,c.receipt_link?h("a",{href:c.receipt_link,target:"_blank",rel:"noopener"},"Open receipt"):"—"),
      h("dt",null,"Decision"),h("dd",null,c.decided_by?c.status+" by "+nameOf(c.decided_by)+(c.decided_at?" on "+fmtTime(c.decided_at):"")+(c.decision_comment?" · “"+c.decision_comment+"”":""):"—"),
      h("dt",null,"Reimbursed"),h("dd",null,reimb?money(reimb.amount,reimb.currency)+" on "+fmtDate(reimb.date)+" · tracker "+reimb.tracker_id+" ("+reimb.id+")":"—"),
      c.notes?[h("dt",null,"Notes"),h("dd",null,c.notes)]:null)),acts)}
function editClaim(id){if(!canWrite())return;const c=id?S.claims[id]:{date:today(),currency:"TZS"};
  const envs=Object.values(S.envelopes).filter(e=>e.status==="Active"||e.id===c.envelope_id).map(e=>[e.id,e.name+(e.project?" · "+e.project:"")]);
  const body=h("div",{class:"fg"},field("c-desc","What was it for?","text",c.description,{full:true,ph:"e.g. Fuel for Zanzibar field visit"}),field("c-payee","Paid to","text",c.payee,{ph:"Shop, supplier or person"}),field("c-date","Date paid","date",c.date),
    field("c-amt","Amount","number",c.amount),field("c-cur","Currency","select",c.currency,{options:["TZS","USD"],blank:false}),field("c-from","Paid from (your account)","text",c.paid_from,{ph:"e.g. my Selcom Pesa, my card"}),
    field("c-proj","Project / client","text",c.project),field("c-cat","Workplan category","select",c.category,{options:CATS}),field("c-env","Envelope (budget)","select",c.envelope_id,{options:envs,blank:"None"}),
    field("c-rec","Link to receipt or proof of payment","url",c.receipt_link,{full:true,hint:"Required before submitting. A Google Drive link to the photo or PDF works."}),field("c-notes","Notes","textarea",c.notes,{full:true}));
  const collect=()=>{const amt=n0(val("c-amt"));const desc=val("c-desc");if(!desc||!(amt>0)){toast("Add what it was for and the amount.");return null}
    return{description:desc,payee:val("c-payee"),date:val("c-date")||today(),amount:amt,currency:val("c-cur"),paid_from:val("c-from"),project:val("c-proj"),category:val("c-cat")||null,envelope_id:val("c-env")||null,receipt_link:val("c-rec"),notes:val("c-notes")}};
  const save=async submit=>{const row=collect();if(!row)return false;if(submit&&!row.receipt_link){toast("Add the receipt link before submitting.");return false}
    if(id){row.status=submit?"Submitted":"Draft";return run(()=>sb.from("claims").update(row).eq("id",id),submit?"Submitted for approval":"Saved",["claims"])}
    return run(async()=>{const res=await sb.from("claims").insert(Object.assign({id:"new",claimant:S.email},row)).select("id").single();if(res.error||!submit)return res;return sb.from("claims").update({status:"Submitted"}).eq("id",res.data.id)},submit?"Submitted for approval":"Saved as draft",["claims"])};
  const draftBtn=h("button",{class:"btn",onclick:async()=>{draftBtn.disabled=true;try{if(await save(false))dlg.close()}finally{draftBtn.disabled=false}}},"Save draft");
  openDlg(id?"Edit "+id:"New expense",body,[draftBtn,saveBtn("Save and submit",()=>save(true))])}
function decideClaim(c,decision){openDlg((decision==="Approved"?"Approve ":"Reject ")+c.id,h("div",{style:"display:grid;gap:10px"},h("div",{class:"rule"},h("b",null,c.description),nameOf(c.claimant)+" · "+money(c.amount,c.currency)+" · "+fmtDate(c.date)),
  c.receipt_link?h("a",{href:c.receipt_link,target:"_blank",rel:"noopener"},"Open the receipt before deciding"):null,field("dc-c",decision==="Rejected"?"Reason for rejection (required)":"Comment (optional)","textarea","",{rows:3})),
  [saveBtn(decision==="Approved"?"Approve":"Reject",async()=>{const cm=val("dc-c");if(decision==="Rejected"&&!cm){toast("Give a reason so the claimant can fix it.");return false}return run(()=>sb.rpc("decide_claim",{p_id:c.id,p_decision:decision,p_comment:cm}),decision,["claims"])})])}

/* ---- who we owe ---- */
function vOwed(){const people=owedByPerson().filter(p=>Object.keys(p.owed).length||Object.keys(p.pending).length||Object.keys(p.paid).length).sort((a,b)=>toTzsSum(b.owed)-toTzsSum(a.owed));
  const canPay=hasAny(["custodian","admin"]);const reimbs=Object.values(S.reimbursements).sort((a,b)=>(b.date+b.id).localeCompare(a.date+a.id));
  const totalOwed={};people.forEach(p=>Object.entries(p.owed).forEach(([c,v])=>totalOwed[c]=(totalOwed[c]||0)+v));
  return [header("Who we owe",(seesAllClaims()?"Approved expense claims not yet reimbursed, by person. ":"What TUSOME owes you. ")+"A reimbursement settles approved claims and must carry the expenditure tracker Record ID.",newBtn("New expense",()=>editClaim())),
    h("div",{class:"tiles"},tile(fmtByCur(totalOwed),seesAllClaims()?"Total owed to staff":"Owed to you"),tile(people.reduce((n,p)=>n+p.claims.filter(c=>c.status==="Submitted").length,0),"Claims awaiting approval"),tile(reimbs.length,"Reimbursements recorded")),
    h("section",{class:"panel"},!people.length?empty("Nobody is owed anything."):
      T([{l:"Person",primary:true},{l:"Owed now",num:true},{l:"Awaiting approval",num:true},{l:"Reimbursed to date",num:true},{l:""}],
        people.map(p=>[h("div",null,h("div",{style:"font-weight:700"},nameOf(p.who)),String(p.who).startsWith("name:")?h("div",{class:"small muted"},"No login"):null),fmtByCur(p.owed),fmtByCur(p.pending),fmtByCur(p.paid),
          canPay&&Object.keys(p.owed).length&&p.who!==S.email?h("button",{class:"btn sm primary",onclick:e=>{e.stopPropagation();reimburse(p)}},"Reimburse"):h("button",{class:"btn sm",onclick:e=>{e.stopPropagation();personClaims(p)}},"Details")]),i=>()=>personClaims(people[i]))),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Reimbursements")),!reimbs.length?empty("No reimbursements recorded yet."):
      T([{l:"Person",primary:true},{l:"Number",mono:true},{l:"Date"},{l:"Amount",num:true},{l:"From"},{l:"Tracker ID",mono:true},{l:"Recorded by"}],reimbs.map(r=>[nameOf(r.claimant),r.id,fmtDate(r.date),money(r.amount,r.currency),(S.accounts[r.account_id]||{}).name||"—",r.tracker_id,nameOf(r.recorded_by)])))]}
function personClaims(p){openDlg(nameOf(p.who),h("div",{class:"list"},p.claims.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(c=>h("button",{class:"li",onclick:()=>showClaim(c.id)},h("div",null,h("div",{class:"t"},c.description),h("div",{class:"small muted"},c.id+" · "+fmtDate(c.date))),h("div",{style:"text-align:right"},h("div",{class:"num",style:"font-weight:700"},money(c.amount,c.currency)),pill(c.status,CLAIM_PILL[c.status]))))),[])}
function reimburse(p){const ok=p.claims.filter(c=>c.status==="Approved");const curs=[...new Set(ok.map(c=>c.currency))];let cur=curs[0];
  const box=h("div",{style:"display:grid;gap:6px"});const total=h("div",{class:"rule"});
  function draw(){box.replaceChildren(...ok.filter(c=>c.currency===cur).map(c=>h("label",{class:"row small",style:"gap:8px;font-weight:600;justify-content:space-between;border-bottom:1px solid var(--line);padding:6px 0"},h("span",{class:"row",style:"gap:8px"},h("input",{type:"checkbox",value:c.id,checked:true,onchange:sum}),c.id+" · "+c.description),money(c.amount,c.currency))));sum()}
  function sum(){const ids=[...box.querySelectorAll("input:checked")].map(i=>i.value);const t=ok.filter(c=>ids.includes(c.id)).reduce((s,c)=>s+n0(c.amount),0);total.replaceChildren(h("b",null,"Reimburse "+money(t,cur)),ids.length+" claim(s). Enter the payment in the expenditure tracker first.")}
  const body=h("div",{class:"fg"},curs.length>1?field("rb-cur","Currency","select",cur,{options:curs,blank:false}):null,h("div",{style:"grid-column:1/-1"},box),h("div",{style:"grid-column:1/-1"},total),
    field("rb-d","Date paid","date",today()),field("rb-a","Paid from","select","",{options:Object.values(S.accounts).filter(a=>a.holder==="Company").map(a=>[a.id,a.name])}),field("rb-t","Tracker Record ID","text","",{full:true,ph:"e.g. Q426-150"}));
  openDlg("Reimburse "+nameOf(p.who),body,[saveBtn("Record reimbursement",async()=>{const ids=[...box.querySelectorAll("input:checked")].map(i=>i.value);if(!ids.length){toast("Select at least one claim.");return false}
    if(!val("rb-t")){toast("Add the tracker Record ID.");return false}
    return run(()=>sb.rpc("record_reimbursement",{p_claim_ids:ids,p_date:val("rb-d")||today(),p_account:val("rb-a"),p_tracker:val("rb-t")}),"Reimbursement recorded",["claims","reimbursements"])})]);
  const cs=document.getElementById("rb-cur");if(cs)cs.addEventListener("change",()=>{cur=cs.value;draw()});draw()}

/* ---- envelopes ---- */
function vEnvelopes(){const list=Object.values(S.envelopes).sort((a,b)=>(a.status===b.status?0:a.status==="Active"?-1:1)||a.name.localeCompare(b.name));
  return [header("Envelopes","Budgets for each activity: how much is set aside, where the money comes from, and how much is already committed. Only administrators can create or change them.",newBtn("New envelope",()=>editEnvelope(),isAdmin())),
    !list.length?h("section",{class:"panel"},empty(isAdmin()?"No envelopes yet. Select “New envelope” to set the first activity budget.":"No envelopes yet. The Director sets them up.")):
    h("div",{class:"cards"},list.map(e=>{const u=envelopeUse(e);const pc=u.budget?Math.min(100,u.used/u.budget*100):0;
      return h("div",{class:"card",style:"cursor:pointer",onclick:()=>showEnvelope(e.id)},h("div",{class:"row",style:"justify-content:space-between"},h("div",{class:"t"},e.name),pill(e.status,e.status==="Active"?"p-ok":"p-mute")),
        h("div",{class:"small muted"},[e.id,e.activity,e.project].filter(Boolean).join(" · ")),
        h("div",{class:"kv"},h("span",null,"Budget"),h("span",null,money(e.amount,e.currency))),h("div",{class:"kv"},h("span",null,"Committed"),h("span",null,tzs(u.used))),
        h("div",{class:"kv"},h("span",null,"Remaining"),h("span",{style:u.left<0?"color:var(--bad);font-weight:700":"font-weight:700"},tzs(u.left))),
        h("div",{class:"envbar"},h("i",{class:u.left<0?"over":"",style:"width:"+pc+"%"})),
        h("div",{class:"kv"},h("span",null,"Money from"),h("span",null,e.funding_source||"—")),h("div",{class:"kv"},h("span",null,"Held in"),h("span",null,(S.accounts[e.account_id]||{}).name||"—")))}))]}
function showEnvelope(id){const e=S.envelopes[id];const u=envelopeUse(e);
  openDlg(e.name,h("div",{style:"display:grid;gap:14px"},h("dl",null,h("dt",null,"Activity"),h("dd",null,e.activity||"—"),h("dt",null,"Project / client"),h("dd",null,e.project||"—"),h("dt",null,"Budget"),h("dd",null,money(e.amount,e.currency)),
      h("dt",null,"Money from"),h("dd",null,e.funding_source||"—"),h("dt",null,"Held in"),h("dd",null,(S.accounts[e.account_id]||{}).name||"—"),h("dt",null,"Period"),h("dd",null,(e.start_date?fmtDate(e.start_date):"—")+" to "+(e.end_date?fmtDate(e.end_date):"—")),
      h("dt",null,"Committed"),h("dd",null,tzs(u.used)+" ("+tzs(u.req)+" requests, "+tzs(u.cl)+" claims)"),h("dt",null,"Remaining"),h("dd",null,tzs(u.left)),e.notes?[h("dt",null,"Notes"),h("dd",null,e.notes)]:null),
    u.items.length?T([{l:"Item",primary:true},{l:"Type"},{l:"Number",mono:true},{l:"TZS",num:true}],u.items.map(x=>[x[2]||"—",x[0],x[1],tzs(x[3])])):h("div",{class:"small muted"},"Nothing charged to this envelope yet. Choose it on a purchase request or an expense claim.")),
    isAdmin()?[h("button",{class:"btn primary",onclick:()=>{dlg.close();editEnvelope(id)}},"Edit envelope")]:[])}
function editEnvelope(id){if(!isAdmin())return;const e=id?S.envelopes[id]:{currency:"TZS",status:"Active"};
  openDlg(id?"Edit "+e.name:"New envelope",h("div",{class:"fg"},field("e-n","Envelope name","text",e.name,{full:true,ph:"e.g. AI RCT Zanzibar endline"}),field("e-ac","Activity","text",e.activity),field("e-p","Project / client","text",e.project),
    field("e-a","Budget amount","number",e.amount),field("e-c","Currency","select",e.currency,{options:["TZS","USD"],blank:false}),field("e-f","Where the money comes from","text",e.funding_source,{full:true,ph:"e.g. Client payment, grant tranche 2, own funds"}),
    field("e-acc","Held in (bank or wallet)","select",e.account_id,{options:Object.values(S.accounts).map(a=>[a.id,a.name]),blank:"Not set"}),field("e-s","Status","select",e.status,{options:["Active","Closed"],blank:false}),
    field("e-sd","Start date","date",e.start_date),field("e-ed","End date","date",e.end_date),field("e-no","Notes","textarea",e.notes,{full:true})),
    [saveBtn("Save envelope",async()=>{const name=val("e-n");if(!name){toast("Name the envelope.");return false}
      const row={name,activity:val("e-ac"),project:val("e-p"),amount:n0(val("e-a")),currency:val("e-c"),funding_source:val("e-f"),account_id:val("e-acc")||null,status:val("e-s"),start_date:val("e-sd")||null,end_date:val("e-ed")||null,notes:val("e-no")};
      if(id)return run(()=>sb.from("envelopes").update(row).eq("id",id),"Envelope saved",["envelopes"]);
      const nid=await sb.rpc("next_id",{kind:"envelope"});if(nid.error){toast(friendly(nid.error));return false}return run(()=>sb.from("envelopes").insert(Object.assign({id:nid.data},row)),"Envelope "+nid.data+" created",["envelopes"])})])}

/* ---- bank & reconciliation ---- */
function vBank(){const list=Object.values(S.accounts).sort((a,b)=>a.id>b.id?1:-1);const recs=Object.values(S.reconciliations).sort((a,b)=>(b.as_of+b.prepared_at).localeCompare(a.as_of+a.prepared_at));
  return [header("Bank & reconciliation","Record each account's statement balance and compare it with the expenditure tracker. Prepared by the Finance custodian, signed off by a different administrator.",
      newBtn("Update balance",()=>editRecon(),canReconcile()),isAdmin()?h("button",{class:"btn",onclick:()=>editAccount()},"Add account"):null),
    h("div",{class:"tiles"},tile(fmtByCur(cashPosition()),"Cash per latest statements (company accounts)"),tile(recs.filter(r=>!r.reviewed_by).length,"Awaiting sign-off"),tile(list.filter(a=>a.holder==="Company"&&!latestRecon(a.id)).length,"Company accounts never reconciled")),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Accounts")),!list.length?empty("No accounts recorded."):
      T([{l:"Account",primary:true},{l:"Holder"},{l:"Last 4",mono:true},{l:"Statement balance",num:true},{l:"Difference",num:true},{l:"As of"},{l:"Status"},{l:""}],list.map(a=>{const r=latestRecon(a.id),st=reconState(r);
        return [h("div",null,h("div",{style:"font-weight:600"},a.name),h("div",{class:"small muted"},[a.type,a.provider].filter(Boolean).join(" · "))),a.holder||"—",a.last4||"—",r?money(r.statement_balance,r.currency):"—",r?h("span",{style:Math.abs(n0(r.difference))>0.005?"color:var(--bad);font-weight:700":null},money(r.difference,r.currency)):"—",r?fmtDate(r.as_of):"—",pill(st.t,st.c),
          h("span",{class:"row",style:"justify-content:flex-end"},canReconcile()?h("button",{class:"btn sm",onclick:e=>{e.stopPropagation();editRecon(null,a.id)}},"Update"):null,isAdmin()?h("button",{class:"btn sm",onclick:e=>{e.stopPropagation();editAccount(a.id)}},"Edit"):null)]}))),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Reconciliation history")),!recs.length?empty("No reconciliations yet. Select “Update balance” after each month-end statement."):
      T([{l:"Account",primary:true},{l:"Number",mono:true},{l:"As of"},{l:"Statement",num:true},{l:"Tracker (book)",num:true},{l:"Difference",num:true},{l:"Prepared by"},{l:"Signed off"}],
        recs.map(r=>[(S.accounts[r.account_id]||{}).name||r.account_id,r.id,fmtDate(r.as_of),money(r.statement_balance,r.currency),money(r.book_balance,r.currency),money(r.difference,r.currency),nameOf(r.prepared_by),r.reviewed_by?nameOf(r.reviewed_by)+" · "+fmtDate(r.reviewed_at):pill("Pending","p-warn")]),i=>()=>showRecon(recs[i].id)))]}
function showRecon(id){const r=S.reconciliations[id];const st=reconState(r);const acts=[];
  if(!r.reviewed_by&&canReconcile())acts.push(h("button",{class:"btn",onclick:()=>{dlg.close();editRecon(id)}},"Edit"));
  if(!r.reviewed_by&&isAdmin()&&r.prepared_by!==S.email)acts.push(h("button",{class:"btn ok",onclick:()=>{openDlg("Sign off "+r.id,h("div",{style:"display:grid;gap:10px"},h("div",{class:"rule"},"Difference "+money(r.difference,r.currency)+(r.explanation?" · "+r.explanation:"")),field("rv-c","Comment (optional)","textarea","",{rows:2})),[saveBtn("Sign off",()=>run(()=>sb.rpc("review_reconciliation",{p_id:r.id,p_comment:val("rv-c")}),"Signed off",["reconciliations"]))])}},"Sign off"));
  openDlg(r.id+" · "+((S.accounts[r.account_id]||{}).name||""),h("div",{style:"display:grid;gap:12px"},h("div",null,pill(st.t,st.c)),h("dl",null,h("dt",null,"As of"),h("dd",null,fmtDate(r.as_of)),h("dt",null,"Statement balance"),h("dd",null,money(r.statement_balance,r.currency)),
    h("dt",null,"Tracker (book) balance"),h("dd",null,money(r.book_balance,r.currency)),h("dt",null,"Difference"),h("dd",null,money(r.difference,r.currency)),h("dt",null,"Explanation"),h("dd",null,r.explanation||"—"),
    h("dt",null,"Statement"),h("dd",null,r.statement_link?h("a",{href:r.statement_link,target:"_blank",rel:"noopener"},"Open statement"):"—"),h("dt",null,"Prepared"),h("dd",null,nameOf(r.prepared_by)+" · "+fmtTime(r.prepared_at)),
    h("dt",null,"Signed off"),h("dd",null,r.reviewed_by?nameOf(r.reviewed_by)+" · "+fmtTime(r.reviewed_at)+(r.review_comment?" · “"+r.review_comment+"”":""):"Not yet"))),acts)}
function editRecon(id,accId){if(!canReconcile())return;const r=id?S.reconciliations[id]:{account_id:accId||"",as_of:today(),currency:(S.accounts[accId]||{}).currency||"TZS"};
  const diff=h("div",{class:"rule",style:"grid-column:1/-1"});
  const body=h("div",{class:"fg"},field("rc-a","Account","select",r.account_id,{options:Object.values(S.accounts).map(a=>[a.id,a.name])}),field("rc-d","Statement date (as of)","date",r.as_of),
    field("rc-s","Balance per statement","number",r.statement_balance,{neg:true}),field("rc-b","Balance per expenditure tracker","number",r.book_balance,{neg:true}),field("rc-c","Currency","select",r.currency,{options:["TZS","USD"],blank:false}),
    field("rc-l","Link to statement","url",r.statement_link),diff,field("rc-e","Explain any difference","textarea",r.explanation,{full:true,rows:3,hint:"e.g. bank charges not yet in the tracker, payment in transit. Required before sign-off if there is a difference."}));
  const upd=()=>{const d=n0(val("rc-s"))-n0(val("rc-b"));diff.replaceChildren(h("b",null,"Difference: "+money(d,val("rc-c")||"TZS")),Math.abs(d)>0.005?"Explain it below.":"Statement and tracker agree.")};body.addEventListener("input",upd);body.addEventListener("change",upd);
  openDlg(id?"Edit "+id:"Update balance and reconcile",body,[saveBtn("Save",()=>{if(!val("rc-a")){toast("Choose the account.");return false}if(val("rc-s")===""||val("rc-b")===""){toast("Enter both balances.");return false}
    const row={account_id:val("rc-a"),as_of:val("rc-d")||today(),statement_balance:n0(val("rc-s")),book_balance:n0(val("rc-b")),currency:val("rc-c"),statement_link:val("rc-l"),explanation:val("rc-e")};
    return id?run(()=>sb.from("reconciliations").update(row).eq("id",id),"Saved",["reconciliations"]):run(()=>sb.from("reconciliations").insert(Object.assign({id:"new"},row)),"Saved. An administrator other than you must sign it off.",["reconciliations"])})]);upd()}

function vSuppliers(){const list=Object.values(S.suppliers).sort((a,b)=>(a.name||"").localeCompare(b.name||""));const v=list.filter(supplierVerified).length;
  return [header("Suppliers","F07 onboarding: legal name, TIN, EFD/VFD receipts, payment details confirmed by call-back, and a conflict-of-interest declaration. "+v+" of "+list.length+" verified.",newBtn("Add supplier",()=>editSupplier())),
    h("section",{class:"panel"},!list.length?empty("No suppliers yet."):T([{l:"Legal name",primary:true},{l:"ID",mono:true},{l:"Type"},{l:"TIN",mono:true},{l:"EFD/VFD"},{l:"Call-back"},{l:"Conflict"},{l:"F07"}],
      list.map(s=>[h("div",null,h("div",{style:"font-weight:600"},s.name),s.notes?h("div",{class:"small muted"},s.notes):null),s.id,s.type||"—",s.tin||"—",s.efd||"Unknown",s.callback||"No",s.coi||"Not obtained",supplierVerified(s)?pill("Verified","p-ok"):pill("Not verified","p-bad")]),i=>()=>editSupplier(list[i].id)))]}
function vContracts(){const list=Object.values(S.contracts).sort((a,b)=>a.id>b.id?1:-1);
  return [header("Contracts","Contracts and consultancy agreements. Consultancy needs a ToR, IP assignment to TUSOME, SAF-01 where children are involved, and DATA-02.",newBtn("Add contract",()=>editContract())),
    h("section",{class:"panel"},!list.length?empty("No contracts yet. Add one when a purchase needs a written agreement."):T([{l:"Title",primary:true},{l:"ID",mono:true},{l:"Supplier"},{l:"Type"},{l:"End"},{l:"Value",num:true},{l:"Invoiced",num:true},{l:"Status"},{l:"Checks"}],
      list.map(c=>{const ck=contractChecks(c);return [c.title,c.id,(S.suppliers[c.supplierId]||{}).name||"—",c.type||"—",fmtDate(c.end),money(c.value,c.currency),money(invoicedFor(c.id),c.currency),c.status||"Draft",ck.length?h("span",null,ck.map(x=>pill(x[0],"p-bad"))):pill("OK","p-ok")]}),i=>()=>editContract(list[i].id)))]}
function vExceptions(){const exc=allExceptions(),by={};exc.forEach(e=>by[e.k]=(by[e.k]||0)+1);
  return [header("Exceptions","Control gaps across requests, envelopes, bank accounts, suppliers, contracts and rules. Fix each in its record; the list updates live."),
    h("div",{class:"tiles"},Object.keys(by).length?Object.entries(by).map(([k,v])=>tile(v,k)):tile(0,"Open exceptions")),h("section",{class:"panel"},excTable(exc)),
    h("div",{class:"banner info"},h("b",null,"Monthly manual check: "),"filter the expenditure tracker for payments above "+tzs(cfg().band1Tzs)+" and confirm each has a request number here.")]}
function excTable(exc){if(!exc.length)return empty("No exceptions.");
  return T([{l:"Check",primary:true},{l:"Reference",mono:true},{l:"Supplier"},{l:"Amount",num:true},{l:"Detail"}],exc.map(e=>[pill(e.k,"p-bad"),e.ref,e.who,e.amt==null?"—":tzs(e.amt),e.d]),i=>exc[i].go)}

function auditSummary(a){const o=a.old_data||{},n=a.new_data||{};
  if(a.table_name==="approvals")return (n.step?STEP_NAME[n.step]+": ":"")+(n.decision||"")+(n.comment?" · “"+n.comment+"”":"");
  if(a.table_name==="claims"&&a.action==="UPDATE"&&o.status!==n.status)return "Claim "+n.id+": "+o.status+" → "+n.status+(n.decision_comment?" · “"+n.decision_comment+"”":"");
  if(a.table_name==="reimbursements")return money(n.amount,n.currency)+" to "+nameOf(n.claimant)+" · tracker "+n.tracker_id;
  if(a.table_name==="reconciliations"&&n.account_id)return ((S.accounts[n.account_id]||{}).name||n.account_id)+" as of "+fmtDate(n.as_of)+" · difference "+money(n.difference,n.currency)+(n.reviewed_by&&!o.reviewed_by?" · signed off":"");
  if(a.action==="INSERT")return "Created"+(n.details&&n.details.title?": "+n.details.title:n.data&&n.data.name?": "+n.data.name:n.data&&n.data.title?": "+n.data.title:n.description?": "+n.description:n.name?": "+n.name:"");
  if(a.action==="DELETE")return "Deleted";
  const ch=[];const flat=x=>Object.assign({},x,x.details||{},x.data||{});const fo=flat(o),fn=flat(n);
  for(const k of Object.keys(fn)){if(["details","data","created_at"].includes(k))continue;if(JSON.stringify(fo[k])!==JSON.stringify(fn[k]))ch.push(k)}
  return ch.length?"Changed: "+ch.slice(0,8).join(", "):"Updated"}
function auditAction(a){if(a.table_name==="approvals")return (a.new_data||{}).decision||"Decision";const n=a.new_data||{},o=a.old_data||{};
  if(a.table_name==="requests"&&a.action==="UPDATE"){if(n.submitted&&!o.submitted)return "Submitted";if(!n.submitted&&o.submitted)return "Recalled to draft";const nd=n.details||{},od=o.details||{};if(nd.payment&&!od.payment)return "Payment recorded";if(nd.invoice&&!od.invoice)return "Invoice recorded";if(nd.delivery&&!od.delivery)return "Delivery confirmed"}
  if(a.table_name==="claims"&&a.action==="UPDATE"&&o.status!==n.status)return n.status;
  if(a.table_name==="reconciliations"&&n.reviewed_by&&!o.reviewed_by)return "Signed off";
  return {INSERT:"Created",UPDATE:"Edited",DELETE:"Deleted"}[a.action]||a.action}
function vAudit(){let rows=S.audit;if(af){const f=af.toLowerCase();rows=rows.filter(a=>[a.row_id,a.table_name,a.actor_email,auditAction(a),auditSummary(a)].join(" ").toLowerCase().includes(f))}
  return [header("Audit trail","Every change, recorded by the database itself with who made it and when. Nobody can edit or delete these entries. Showing the latest 500."),
    h("section",{class:"panel"},h("div",{class:"toolbar"},searchBox("af",af,v=>af=v,"Filter by person, record or action"),h("span",{class:"small muted"},rows.length+" entries")),
      !rows.length?empty("No activity recorded yet."):T([{l:"Detail",primary:true},{l:"When"},{l:"Who"},{l:"Area"},{l:"Action"},{l:"Record",mono:true}],rows.map(a=>{const rid=a.table_name==="approvals"?(a.new_data||{}).request_id:a.row_id;
        return [auditSummary(a),fmtTime(a.at),nameOf(a.actor_email),a.table_name,auditAction(a),rid||"—"]}),i=>{const a=rows[i];if(a.table_name==="requests")return ()=>openRequest(a.row_id);if(a.table_name==="approvals")return ()=>openRequest((a.new_data||{}).request_id);return null}))]}

function vSetup(){const c=cfg(),admin=isAdmin();const rates=c.fxRates.slice().sort((a,b)=>b.date.localeCompare(a.date));
  return [header("Rules & roles","These settings drive every calculation. Only administrators can change them, and every change is in the audit trail.",admin?h("button",{class:"btn",onclick:editRules},"Edit thresholds"):null),
    h("div",{class:"grid2"},
      h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Approvers"),admin?h("a",{href:"#people",class:"small"},"Manage people"):null),
        h("div",{style:"padding:12px 16px"},h("dl",null,...["director","approver","custodian","auditor"].flatMap(r=>[h("dt",null,ROLE_NAME[r]),h("dd",null,emailsWithRole(r).length?emailsWithRole(r).map(nameOf).join(", "):pill("Not assigned",r==="director"||r==="approver"?"p-bad":"p-mute"))])),
          h("p",{class:"small muted",style:"margin:10px 0 0"},"Requests: Band 1–2 need one Band 1–2 approver; Band 3 needs a Band 1–2 approver, then the Director. Expense claims: a Band 1–2 approver or the Director, and the Director above USD "+c.thresholdUsd.toLocaleString("en-GB")+". Nobody approves their own."))),
      h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Quotation bands")),
        T([{l:"Band",primary:true},{l:"Applies to"},{l:"Quotes"},{l:"Approval"}],[1,2,3].map(n=>["Band "+n,bandText(n),n,n===3?"Band 1–2 approver, then Director":"Band 1–2 approver"])),
        h("div",{class:"small muted",style:"padding:10px 16px"},"Split-purchase window: "+c.splitDays+" days · Policy start: "+fmtDate(c.policyDate)+" · Contract warning: "+c.contractWarnDays+" days"))),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Approval FX rates (TZS per USD)"),admin?h("button",{class:"btn sm",onclick:addRate},"Add rate"):null),
      T([{l:"Effective",primary:true},{l:"TZS per USD",num:true},{l:"Status"},{l:"Source"}],rates.map(r=>[fmtDate(r.date),Number(r.rate).toLocaleString("en-GB",{maximumFractionDigits:4}),pill(r.status,r.status==="BoT mean rate"||r.status==="Confirmed by accountant"?"p-ok":"p-mute"),h("span",{class:"small"},r.source||"")]))),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Withholding tax rates")),
      T([{l:"Payment",primary:true},{l:"Resident"},{l:"Non-resident"},{l:"Note"}],c.wht.map(w=>[w.type,w.res,w.nonres,h("span",{class:"small",style:/confirm/i.test(w.note||"")?"color:var(--warn)":null},w.note||"")])),
      h("div",{class:"small muted",style:"padding:10px 16px"},c.whtSource))]}
function vPeople(){if(!isAdmin())return [header("People & logins","Only administrators can manage people.")];
  const list=Object.values(S.members).sort((a,b)=>a.email.localeCompare(b.email));
  return [header("People & logins","The email is the username. A person can sign in only if they are listed here and active. Roles decide what they can do.",h("button",{class:"btn primary",onclick:()=>editMember()},"Add person")),
    h("section",{class:"panel"},T([{l:"Email (username)",primary:true,mono:true},{l:"Name"},{l:"Roles"},{l:"Status"},{l:""}],
      list.map(m=>[m.email,m.full_name||"—",h("span",null,(m.roles||[]).map(r=>pill(ROLE_NAME[r]||r,r==="auditor"?"p-info":r==="staff"?"p-mute":"p-brand"))),m.active?pill("Active","p-ok"):pill("Disabled","p-bad"),
        h("span",{class:"row",style:"justify-content:flex-end"},h("button",{class:"btn sm",onclick:()=>editMember(m.email)},"Edit"),h("button",{class:"btn sm",onclick:()=>loginDialog(m.email)},"Set password"))]))),
    h("div",{class:"banner info"},h("b",null,"Passwords: "),"use “Set password” to create a login or reset it, then give the password to the person directly (not by email). They can change it after signing in. To remove access, edit the person and untick Active.")]}

/* ============ request sheet ============ */
function renderSheet(){const root=$("#sheetRoot");if(!sheetFor){root.replaceChildren();return}
  const r=S.requests[sheetFor];const close=h("button",{class:"x",onclick:closeSheet,"aria-label":"Close"},"×");
  if(!r){root.replaceChildren(h("div",{class:"scrim",onclick:closeSheet}),h("aside",{class:"sheet",role:"dialog","aria-label":"Request"},h("div",{class:"sh-head"},h("h2",null,sheetFor),close),h("div",{class:"sh-body"},empty(S.loaded?"This request does not exist.":"Loading…"))));return}
  const s=status(r),a=amounts(r),b=band(r),sup=S.suppliers[r.supplierId],me=S.email,cw=canWrite(),ch=chainState(r),ck=checks(r),isReq=r.requester===me;const acts=[];
  if(cw&&!r.submitted){acts.push(h("button",{class:"btn",onclick:()=>editRequest(r.id)},"Edit"));acts.push(h("button",{class:"btn primary",onclick:()=>submitReq(r)},"Submit for approval"))}
  if(cw&&r.submitted&&!approvedAll(r)&&!r.payment)acts.push(h("button",{class:"btn",onclick:()=>recallReq(r)},rejected(r)?"Revise and resubmit":"Recall to draft"));
  const now=ch.find(x=>x.s==="now");
  if(now&&hasRole(STEP_ROLE[now.step])&&!isReq){acts.push(h("button",{class:"btn ok",onclick:()=>decide(r,now.step,"Approved")},"Approve"));acts.push(h("button",{class:"btn danger",onclick:()=>decide(r,now.step,"Rejected")},"Reject"))}
  if(cw&&approvedAll(r)&&!r.delivery)acts.push(h("button",{class:"btn primary",onclick:()=>recordDelivery(r)},"Confirm delivery (F08)"));
  if(cw&&approvedAll(r)&&r.delivery&&!r.invoice)acts.push(h("button",{class:"btn primary",onclick:()=>recordInvoice(r)},"Record invoice"));
  if(cw&&r.invoice&&!r.payment&&approvedAll(r))acts.push(h("button",{class:"btn primary",onclick:()=>recordPayment(r)},"Record payment"));
  if(cw&&(r.invoice||r.payment||r.retro))acts.push(h("button",{class:"btn",onclick:()=>editEvidence(r)},"Evidence & tax"));
  const hist=S.audit.filter(x=>x.row_id===r.id||(x.table_name==="approvals"&&(x.new_data||{}).request_id===r.id));
  const link=(u,t)=>u?h("a",{href:u,target:"_blank",rel:"noopener"},t||"Open file"):null;const env=S.envelopes[r.envelopeId];
  const body=h("div",{class:"sh-body"},
    r.retro?h("div",{class:"banner"},h("b",null,"Retrospective entry. "),r.notes||""):null,
    acts.length?h("div",{class:"row"},acts):null,
    ck.length?h("div",{class:"sec"},h("h3",null,"Issues"),h("ul",{class:"small",style:"margin:0;padding-left:18px"},ck.map(c=>h("li",null,h("b",null,c[0]),": "+c[1])))):null,
    h("div",{class:"sec"},h("h3",null,"Approval chain"),h("div",{class:"chain"},
      h("div",{class:"step done"},h("div",{class:"dot"},"✓"),h("div",null,h("div",{class:"st"},"Raised by "+nameOf(r.requester)),h("div",{class:"small muted"},fmtDate(r.date)+(r.submittedAt?" · submitted "+fmtTime(r.submittedAt):" · not submitted")+(r.rev>1?" · revision "+r.rev:"")))),
      ch.map(x=>h("div",{class:"step "+(x.s==="done"?"done":x.s==="rej"?"rej":x.s==="now"?"now":"")},h("div",{class:"dot"},x.s==="done"?"✓":x.s==="rej"?"✕":""),h("div",null,h("div",{class:"st"},STEP_NAME[x.step]),
        h("div",{class:"small muted"},x.dec?(x.dec.decision+" by "+nameOf(x.dec.by_email)+" on "+fmtTime(x.dec.at)):x.s==="now"?"Waiting for "+(emailsWithRole(STEP_ROLE[x.step]).filter(e=>e!==r.requester).map(nameOf).join(" or ")||"an assigned person"):"Not yet reached"),x.dec&&x.dec.comment?h("div",{class:"small"},"“"+x.dec.comment+"”"):null))))),
    h("div",{class:"sec"},h("h3",null,"Request"),h("dl",null,
      h("dt",null,"Item"),h("dd",null,r.title||"—"),h("dt",null,"Purpose"),h("dd",null,r.purpose||"—"),h("dt",null,"Project / client"),h("dd",null,r.project||"—"),h("dt",null,"Envelope"),h("dd",null,env?env.name+" · "+tzs(envelopeUse(env).left)+" remaining":"—"),
      h("dt",null,"Category"),h("dd",null,r.category||"—"),h("dt",null,"Type"),h("dd",null,r.kind||"—"),
      h("dt",null,"Supplier"),h("dd",null,sup?sup.name+" ("+sup.id+") ":"—",sup?(supplierVerified(sup)?pill("F07 verified","p-ok"):pill("Not verified","p-bad")):null),
      h("dt",null,"Amount"),h("dd",null,money(r.amount,r.currency)+(r.currency==="USD"?" · "+(a.tzs!=null?tzs(a.tzs):"no FX rate"):" · "+(a.usd!=null?money(a.usd,"USD"):"no FX rate"))),
      h("dt",null,"FX rate used"),h("dd",null,a.fx?Number(a.rate).toLocaleString("en-GB",{maximumFractionDigits:4})+" ("+a.fx.status+", "+fmtDate(a.fx.date)+")":"None"),
      h("dt",null,"Band"),h("dd",null,"Band "+b+": "+bandText(b)+" · needs "+b+" quote"+(b>1?"s":"")),
      h("dt",null,"Quotations"),h("dd",null,(r.quotes||[]).length?h("ul",{style:"margin:0;padding-left:18px"},r.quotes.map(x=>h("li",null,(x.supplier||"Quote")+" · "+money(x.amount,r.currency)+" ",link(x.link,"file")))):"None recorded",r.waiver?h("div",{class:"small"},"Waiver: "+r.waiver):null," ",pill(quotesState(r),quotesState(r)==="Short"?"p-bad":"p-ok")),
      h("dt",null,"Contract"),h("dd",null,r.contractId||"—"),h("dt",null,"F01 request"),h("dd",null,link(r.f01)||"—"))),
    h("div",{class:"sec"},h("h3",null,"Delivery, invoice and payment"),h("dl",null,
      h("dt",null,"Delivery (F08)"),h("dd",null,r.delivery?fmtDate(r.delivery.date)+" ":"—",r.delivery?link(r.delivery.link,"file"):null),
      h("dt",null,"Invoice"),h("dd",null,r.invoice?(r.invoice.no||"No number")+" · "+money(r.invoice.amount,r.currency)+" ":"—",r.invoice?link(r.invoice.link,"file"):null),
      h("dt",null,"Fiscal receipt"),h("dd",null,(r.invoice&&r.invoice.fiscal)||"—"),
      h("dt",null,"Payment"),h("dd",null,r.payment?money(r.payment.amount,r.currency)+" on "+fmtDate(r.payment.date)+" from "+((S.accounts[r.payment.account]||{}).name||r.payment.account||"—"):"—"),
      h("dt",null,"Tracker Record ID"),h("dd",{class:"mono"},(r.payment&&r.payment.trackerId)||"—"),
      h("dt",null,"WHT"),h("dd",null,r.wht?(r.wht.applicable||"—")+(r.wht.amount?" · "+tzs(r.wht.amount):""):"—"),
      h("dt",null,"Evidence status"),h("dd",null,r.evidence?pill(r.evidence,r.evidence==="Complete"?"p-ok":"p-warn"):"—"),
      r.notes&&!r.retro?[h("dt",null,"Notes"),h("dd",null,r.notes)]:null)),
    h("div",{class:"sec"},h("h3",null,"History"),hist.length?h("div",{class:"small"},hist.map(x=>h("div",{style:"padding:6px 0;border-bottom:1px solid var(--line)"},h("b",null,auditAction(x))," · "+nameOf(x.actor_email)+" · "+fmtTime(x.at),h("div",{class:"muted"},auditSummary(x))))):h("div",{class:"small muted"},"No recorded activity.")));
  root.replaceChildren(h("div",{class:"scrim",onclick:closeSheet}),h("aside",{class:"sheet",role:"dialog","aria-label":"Purchase request "+r.id},
    h("div",{class:"sh-head"},h("div",{style:"min-width:0"},h("div",{class:"mono muted"},r.id),h("h2",{style:"font-size:18px;margin:2px 0 6px"},r.title||"Untitled"),h("div",{class:"row"},pill(s.t,s.c),h("span",{class:"num",style:"font-weight:800"},money(r.amount,r.currency)))),close),body))}

/* ============ dialogs ============ */
const dlg=$("#dlg");
function field(id,label,type,v,o){o=o||{};let inp;
  if(type==="select")inp=h("select",{id},[o.blank!==false?h("option",{value:""},o.blank||"Select…"):null,...o.options.map(x=>{const[k,l]=Array.isArray(x)?x:[x,x];return h("option",{value:k,selected:String(v==null?"":v)===String(k)?true:null},l)})]);
  else if(type==="textarea")inp=h("textarea",{id,rows:o.rows||2},v||"");
  else inp=h("input",{id,type,value:v==null?"":v,step:type==="number"?"any":null,inputmode:type==="number"?"decimal":null,min:type==="number"&&!o.neg?"0":null,placeholder:o.ph||null,maxlength:o.max||null,autocomplete:type==="password"?"new-password":null});
  return h("label",{class:"f",style:o.full?"grid-column:1/-1":null},label,inp,o.hint?h("span",{class:"hint"},o.hint):null)}
const val=id=>{const el=document.getElementById(id);return el?el.value.trim():""};
function openDlg(title,body,actions){dlg.replaceChildren(h("div",{class:"dh"},h("h2",null,title),h("button",{class:"x","aria-label":"Close",onclick:()=>dlg.close()},"×")),h("div",{class:"db"},body),h("div",{class:"df"},h("button",{class:"btn",onclick:()=>dlg.close()},actions.length?"Cancel":"Close"),...actions));if(!dlg.open)dlg.showModal()}
function saveBtn(label,fn){const b=h("button",{class:"btn primary",onclick:async()=>{b.disabled=true;try{const ok=await fn();if(ok!==false)dlg.close()}finally{b.disabled=false}}},label);return b}
const supOptions=()=>Object.values(S.suppliers).sort((a,b)=>a.name.localeCompare(b.name)).map(s=>[s.id,s.name+" ("+s.id+")"+(supplierVerified(s)?"":" · not verified")]);
const envOptions=cur=>Object.values(S.envelopes).filter(e=>e.status==="Active"||e.id===cur).map(e=>[e.id,e.name+" · "+tzs(envelopeUse(e).left)+" left"]);

function editRequest(id){if(!canWrite())return;const r=id?S.requests[id]:{currency:"TZS",date:today(),quotes:[]};const quotes=(r.quotes||[]).map(x=>Object.assign({},x));
  const qBox=h("div",{style:"display:grid;gap:8px"}),rule=h("div",{class:"rule"});
  function drawQ(){qBox.replaceChildren(...quotes.map((x,i)=>h("div",{class:"qrow"},
    h("label",{class:"f"},"Quote from",h("input",{value:x.supplier||"",oninput:e=>x.supplier=e.target.value})),h("label",{class:"f"},"Amount",h("input",{type:"number",inputmode:"decimal",step:"any",min:"0",value:x.amount==null?"":x.amount,oninput:e=>x.amount=e.target.value})),
    h("label",{class:"f"},"Link to quote (F02/F09)",h("input",{type:"url",value:x.link||"",oninput:e=>x.link=e.target.value})),h("button",{class:"btn sm danger",type:"button",onclick:()=>{quotes.splice(i,1);drawQ();preview()}},"Remove"))),
    h("div",null,h("button",{class:"btn sm",type:"button",onclick:()=>{quotes.push({});drawQ();preview()}},"Add quotation")))}
  function preview(){const t={amount:val("f-amt"),currency:val("f-cur")||"TZS",date:val("f-date")||today(),fxDate:val("f-fxd")};if(!(n0(t.amount)>0)){rule.replaceChildren("Enter the expected cost to see which rules apply.");return}
    const a=amounts(t),b=bandOf(a.tzs,a.usd),kind=val("f-kind");const env=S.envelopes[val("f-env")];const extra=kind.startsWith("Consultant")?" Consultant: signed ToR and contract before work starts, IP assigned to TUSOME, SAF-01 if working with children, withholding tax deducted.":kind.startsWith("Software")?" Subscription: a dated price page counts as the quote; check data-protection terms.":kind.startsWith("Event")?" Events and logistics should sit in the project's logistics plan.":"";
    const envNote=env?" Envelope "+env.name+": "+tzs(envelopeUse(env).left-(id&&r.envelopeId===env.id&&r.submitted?0:(a.tzs||0)))+" left after this.":"";
    rule.replaceChildren(h("b",null,"Band "+b+": "+bandText(b)),"About "+(a.tzs!=null?tzs(a.tzs):"—")+" / "+(a.usd!=null?money(a.usd,"USD"):"—")+". Needs "+b+" written quotation"+(b>1?"s":"")+" ("+quotes.length+" added). Approval: "+(b===3?"Band 1–2 approver, then Director.":"Band 1–2 approver.")+envNote+extra)}
  drawQ();
  const body=h("div",{class:"fg"},field("f-title","What do you need?","text",r.title,{full:true,ph:"e.g. Printing of endline test booklets"}),field("f-purpose","Business purpose","textarea",r.purpose,{full:true}),
    field("f-proj","Project / client","text",r.project),field("f-env","Envelope (budget)","select",r.envelopeId,{options:envOptions(r.envelopeId),blank:"None"}),field("f-cat","Workplan category","select",r.category,{options:CATS}),field("f-kind","Type of purchase","select",r.kind,{options:KINDS}),
    field("f-sup","Supplier","select",r.supplierId,{options:supOptions(),blank:"Select supplier…",hint:"Not listed? Add it under Suppliers first."}),
    field("f-amt","Expected total cost","number",r.amount),field("f-cur","Currency","select",r.currency,{options:["TZS","USD"],blank:false}),
    field("f-date","Date raised","date",r.date),field("f-fxd","FX rate date","date",r.fxDate,{hint:"Blank uses the date raised."}),
    field("f-con","Contract ID (if any)","select",r.contractId,{options:Object.keys(S.contracts),blank:"None"}),field("f-f01","Link to F01 request form","url",r.f01),
    h("div",{style:"grid-column:1/-1;display:grid;gap:6px"},h("div",{class:"f"},"Quotations"),qBox),field("f-waiver","Quote waiver reason (only if approved)","text",r.waiver,{full:true}),h("div",{style:"grid-column:1/-1"},rule));
  body.addEventListener("input",preview);body.addEventListener("change",preview);
  openDlg(id?"Edit "+id:"New purchase request",body,[saveBtn(id?"Save changes":"Save draft",async()=>{
    const title=val("f-title"),amt=n0(val("f-amt"));if(!title||!(amt>0)){toast("Add what you need and the expected cost.");return false}
    const det={title,purpose:val("f-purpose"),project:val("f-proj"),envelopeId:val("f-env"),category:val("f-cat"),kind:val("f-kind"),fxDate:val("f-fxd"),contractId:val("f-con"),f01:val("f-f01"),waiver:val("f-waiver"),quotes:quotes.filter(x=>x.supplier||x.amount||x.link).map(x=>({supplier:x.supplier||"",amount:n0(x.amount),link:x.link||""}))};
    const row={amount:amt,currency:val("f-cur")||"TZS",date:val("f-date")||today(),supplier_id:val("f-sup")||null};
    if(id){const details=Object.assign({},r._details,det);return run(()=>sb.from("requests").update(Object.assign(row,{details})).eq("id",id),"Saved",["requests"])}
    const res=await run(()=>sb.from("requests").insert(Object.assign(row,{id:"new",details:det})).select("id").single(),"Draft saved",["requests"]);if(res&&res.data){await loadTable("requests");openRequest(res.data.id)}return !!res})]);preview()}
const submitReq=r=>run(()=>sb.from("requests").update({submitted:true}).eq("id",r.id),"Submitted for approval",["requests"]);
const recallReq=r=>run(()=>sb.from("requests").update({submitted:false}).eq("id",r.id),"Back in draft as a new revision",["requests"]);
function decide(r,step,decision){const body=h("div",{style:"display:grid;gap:10px"},h("div",{class:"rule"},h("b",null,r.id+" · "+(r.title||"")),money(r.amount,r.currency)+" · Band "+band(r)+" · "+((S.suppliers[r.supplierId]||{}).name||"no supplier")),
  checks(r).length?h("div",{class:"banner"},"Open issues: "+checks(r).map(c=>c[0]).join(", ")):null,field("d-c",decision==="Rejected"?"Reason for rejection (required)":"Comment (optional)","textarea","",{rows:3}));
  openDlg((decision==="Approved"?"Approve as ":"Reject as ")+STEP_NAME[step],body,[saveBtn(decision==="Approved"?"Approve":"Reject",async()=>{const c=val("d-c");if(decision==="Rejected"&&!c){toast("Give a reason so the requester can fix it.");return false}
    return run(()=>sb.rpc("decide",{p_request:r.id,p_decision:decision,p_comment:c}),decision,["approvals","requests"])})])}
function recordDelivery(r){openDlg("Confirm delivery (F08)",h("div",{class:"fg"},field("v-d","Date delivered","date",today()),field("v-l","Link to signed F08","url",""),field("v-n","Note","text","",{full:true})),[saveBtn("Confirm delivery",()=>saveRequestDetails(r,{delivery:{date:val("v-d")||today(),link:val("v-l"),note:val("v-n"),by:S.email}},"Delivery confirmed"))])}
function recordInvoice(r){openDlg("Record invoice",h("div",{class:"fg"},field("i-no","Invoice number","text",""),field("i-amt","Invoice amount ("+r.currency+")","number",r.amount),field("i-l","Link to invoice","url",""),field("i-f","Fiscal receipt (EFD/VFD)","select","Not checked",{options:FISCAL,blank:false})),[saveBtn("Save invoice",()=>{
  const amt=n0(val("i-amt"));if(!(amt>0)){toast("Enter the invoice amount.");return false}if(Math.abs(amt-r.amount)>0.5)toast("Note: invoice differs from the approved amount.");
  return saveRequestDetails(r,{invoice:{no:val("i-no"),amount:amt,link:val("i-l"),fiscal:val("i-f")}},"Invoice recorded")})])}
function recordPayment(r){openDlg("Record payment",h("div",{class:"fg"},h("div",{class:"rule",style:"grid-column:1/-1"},"Enter the payment in the expenditure tracker first, then copy its Record ID here. The tracker stays the book of payments."),
  field("p-d","Payment date","date",today()),field("p-amt","Amount paid ("+r.currency+")","number",(r.invoice&&r.invoice.amount)||r.amount),field("p-acc","Paid from","select","",{options:Object.values(S.accounts).map(a=>[a.id,a.name])}),field("p-t","Tracker Record ID","text","",{ph:"e.g. Q426-140"})),[saveBtn("Record payment",()=>{
  const amt=n0(val("p-amt")),tid=val("p-t");if(!(amt>0)){toast("Enter the amount paid.");return false}if(!tid){toast("Add the tracker Record ID.");return false}
  return saveRequestDetails(r,{payment:{date:val("p-d")||today(),amount:amt,account:val("p-acc"),trackerId:tid,by:S.email}},"Payment recorded")})])}
function editEvidence(r){openDlg("Evidence & tax · "+r.id,h("div",{class:"fg"},field("e-s","Evidence status","select",r.evidence,{options:EVIDENCE}),field("e-f","Fiscal receipt","select",(r.invoice&&r.invoice.fiscal)||"Not checked",{options:FISCAL,blank:false}),field("e-w","WHT applicable","select",r.wht&&r.wht.applicable,{options:["Yes","No","To confirm"]}),field("e-wa","WHT deducted (TZS)","number",r.wht&&r.wht.amount),field("e-n","Notes","textarea",r.notes,{full:true,rows:3})),[saveBtn("Save",()=>{
  const p={evidence:val("e-s"),wht:{applicable:val("e-w"),amount:n0(val("e-wa"))},notes:val("e-n")};if(r.invoice)p.invoice=Object.assign({},r.invoice,{fiscal:val("e-f")});return saveRequestDetails(r,p,"Saved")})])}

function lockForm(body){body.querySelectorAll("input,select,textarea").forEach(e=>e.disabled=true)}
function editSupplier(id){const s=id?S.suppliers[id]:{};
  const body=h("div",{class:"fg"},field("s-n","Legal name","text",s.name,{full:true}),field("s-tr","Trading name","text",s.trading),field("s-ty","Supplier type","select",s.type,{options:SUP_TYPES}),field("s-tin","TIN","text",s.tin),field("s-vrn","VRN (VAT)","text",s.vrn),
    field("s-efd","Issues EFD/VFD receipts","select",s.efd||"Unknown",{options:["Yes","No","Unknown"],blank:false}),field("s-cp","Contact person","text",s.contact),field("s-ph","Phone","text",s.phone),field("s-em","Email","email",s.email),
    field("s-pm","Preferred payment method","text",s.payMethod),field("s-bk","Bank or wallet provider","text",s.bank),field("s-l4","Account / wallet no. (last 4 digits only)","text",s.last4,{max:4}),field("s-cb","Payment details verified by call-back","select",s.callback||"No",{options:["Yes","No"],blank:false}),
    field("s-vb","Verified by","text",s.verifiedBy),field("s-vd","Verification date","date",s.verifiedOn),field("s-coi","Conflict of interest","select",s.coi||"Not obtained",{options:["None declared","Declared","Not obtained"],blank:false}),field("s-cd","Conflict details","text",s.coiDetail),
    field("s-f07","F07 form link","url",s.f07,{full:true}),field("s-no","Notes","textarea",s.notes,{full:true}));
  if(!canWrite()){openDlg(s.name||"Supplier",body,[]);lockForm(body);return}
  openDlg(id?"Supplier "+id:"Add supplier",body,[saveBtn("Save supplier",async()=>{const name=val("s-n");if(!name){toast("Add the legal name.");return false}const l4=val("s-l4");if(l4&&!/^\d{4}$/.test(l4)){toast("Store only the last 4 digits.");return false}
    const data=Object.assign({},s,{name,trading:val("s-tr"),type:val("s-ty"),tin:val("s-tin"),vrn:val("s-vrn"),efd:val("s-efd"),contact:val("s-cp"),phone:val("s-ph"),email:val("s-em"),payMethod:val("s-pm"),bank:val("s-bk"),last4:l4,callback:val("s-cb"),verifiedBy:val("s-vb"),verifiedOn:val("s-vd"),coi:val("s-coi"),coiDetail:val("s-cd"),f07:val("s-f07"),notes:val("s-no")});delete data.id;
    if(id)return run(()=>sb.from("suppliers").update({data}).eq("id",id),"Supplier saved",["suppliers"]);
    const nid=await sb.rpc("next_id",{kind:"supplier"});if(nid.error){toast(friendly(nid.error));return false}return run(()=>sb.from("suppliers").insert({id:nid.data,data}),"Supplier "+nid.data+" added",["suppliers"])})])}
function editContract(id){const c=id?S.contracts[id]:{currency:"TZS",status:"Draft"},cl=["Yes","No","Not applicable"];
  const body=h("div",{class:"fg"},field("c-t","Contract title","text",c.title,{full:true}),field("c-s","Supplier","select",c.supplierId,{options:supOptions()}),field("c-ty","Contract type","select",c.type,{options:CON_TYPES}),
    field("c-p","Project / client","text",c.project),field("c-r","Linked request","select",c.prq,{options:Object.keys(S.requests),blank:"None"}),field("c-st","Start date","date",c.start),field("c-en","End date","date",c.end),
    field("c-v","Contract value","number",c.value),field("c-cu","Currency","select",c.currency,{options:["TZS","USD"],blank:false}),field("c-pt","Payment terms","text",c.terms,{full:true}),field("c-d","Deliverables","textarea",c.deliverables,{full:true}),
    field("c-tor","ToR attached","select",c.tor,{options:cl}),field("c-ip","IP assigned to TUSOME","select",c.ip,{options:cl}),field("c-saf","SAF-01 safeguarding signed","select",c.saf,{options:cl}),field("c-da","DATA-02 data protection signed","select",c.data,{options:cl}),
    field("c-sb","Signed for TUSOME by","text",c.signedBy),field("c-sd","Date signed","date",c.signedOn),field("c-l","Signed contract link","url",c.link),field("c-stt","Status","select",c.status,{options:CON_STATUS,blank:false}),field("c-n","Notes","textarea",c.notes,{full:true}));
  if(!canWrite()){openDlg(c.title||"Contract",body,[]);lockForm(body);return}
  openDlg(id?"Contract "+id:"Add contract",body,[saveBtn("Save contract",async()=>{const title=val("c-t");if(!title){toast("Add a title.");return false}
    const data={title,supplierId:val("c-s"),type:val("c-ty"),project:val("c-p"),prq:val("c-r"),start:val("c-st"),end:val("c-en"),value:n0(val("c-v")),currency:val("c-cu"),terms:val("c-pt"),deliverables:val("c-d"),tor:val("c-tor"),ip:val("c-ip"),saf:val("c-saf"),data:val("c-da"),signedBy:val("c-sb"),signedOn:val("c-sd"),link:val("c-l"),status:val("c-stt"),notes:val("c-n")};
    if(id)return run(()=>sb.from("contracts").update({data}).eq("id",id),"Contract saved",["contracts"]);
    const nid=await sb.rpc("next_id",{kind:"contract"});if(nid.error){toast(friendly(nid.error));return false}return run(()=>sb.from("contracts").insert({id:nid.data,data}),"Contract "+nid.data+" added",["contracts"])})])}
function editAccount(id){if(!isAdmin())return;const a=id?S.accounts[id]:{};
  openDlg(id?"Account "+id:"Add account",h("div",{class:"fg"},field("a-n","Account name","text",a.name,{full:true}),field("a-t","Type","select",a.type,{options:ACC_TYPES}),field("a-p","Institution / provider","text",a.provider),field("a-l","Last 4 digits","text",a.last4,{max:4}),field("a-c","Currency","select",a.currency,{options:["TZS","USD"]}),
    field("a-h","Holder","select",a.holder,{options:["Company","Personal","To confirm"]}),field("a-s","Signatories / authorised users","text",a.signatories),field("a-r","Approval rule for payments","text",a.rule),field("a-st","Status","select",a.status,{options:ACC_STATUS}),field("a-no","Notes","textarea",a.notes,{full:true})),
    [saveBtn("Save account",()=>{const name=val("a-n");if(!name){toast("Add the account name.");return false}const l4=val("a-l");if(l4&&!/^\d{4}$/.test(l4)){toast("Store only the last 4 digits.");return false}
      const data=Object.assign({},a,{name,type:val("a-t"),provider:val("a-p"),last4:l4,currency:val("a-c"),holder:val("a-h"),signatories:val("a-s"),rule:val("a-r"),status:val("a-st"),notes:val("a-no")});delete data.id;
      if(id)return run(()=>sb.from("accounts").update({data}).eq("id",id),"Account saved",["accounts"]);
      const nid="ACC-"+String(Object.keys(S.accounts).length+1).padStart(2,"0");return run(()=>sb.from("accounts").insert({id:nid,data}),"Account added",["accounts"])})])}
const saveSettings=(patch,msg)=>run(()=>sb.from("settings").update(patch).eq("id",1),msg||"Rules updated",["settings"]);
function editRules(){const c=cfg();openDlg("Thresholds",h("div",{class:"fg"},field("r-b1","Two-quote band starts at (TZS)","number",c.band1Tzs),field("r-th","Director approval above (USD)","number",c.thresholdUsd),field("r-sw","Split-purchase window (days)","number",c.splitDays),field("r-pd","Policy start date","date",c.policyDate),field("r-cw","Contract end warning (days)","number",c.contractWarnDays)),
  [saveBtn("Save",()=>saveSettings({band1_tzs:n0(val("r-b1")),threshold_usd:n0(val("r-th")),split_days:n0(val("r-sw")),policy_date:val("r-pd"),contract_warn_days:n0(val("r-cw"))}))])}
function addRate(){openDlg("Add approval FX rate",h("div",{class:"fg"},field("x-d","Effective date","date",today()),field("x-r","TZS per USD","number",""),field("x-s","Status","select","BoT mean rate",{options:["BoT mean rate","Confirmed by accountant","Placeholder"],blank:false}),field("x-src","Source","text","Bank of Tanzania mean rate, https://www.bot.go.tz/ExchangeRate/excRates",{full:true})),
  [saveBtn("Add rate",()=>{const rate=n0(val("x-r"));if(!(rate>0)){toast("Enter the rate.");return false}const list=cfg().fxRates.filter(x=>x.date!==val("x-d"));list.push({date:val("x-d"),rate,status:val("x-s"),source:val("x-src")});return saveSettings({fx_rates:list},"FX rate added")})])}
function editMember(email){const m=email?S.members[email]:{roles:["staff"],active:true};
  const boxes=ROLES.map(r=>h("label",{class:"row small",style:"gap:6px;font-weight:600"},h("input",{type:"checkbox",value:r,checked:(m.roles||[]).includes(r)?true:null}),ROLE_NAME[r]));
  const act=h("input",{type:"checkbox",checked:m.active?true:null});
  openDlg(email?"Edit "+email:"Add person",h("div",{class:"fg"},field("m-e","Email (username)","email",m.email,{full:true}),field("m-n","Full name","text",m.full_name,{full:true}),
    h("div",{class:"f",style:"grid-column:1/-1"},"Roles",h("div",{style:"display:grid;grid-template-columns:1fr 1fr;gap:6px"},boxes),h("span",{class:"hint"},"Staff raise requests and log expenses. Auditors can only read. Administrators manage rules, envelopes, people and bank accounts.")),
    h("label",{class:"row",style:"grid-column:1/-1;gap:8px;font-weight:600"},act,"Active (can sign in)")),
    [saveBtn("Save person",()=>{const e=val("m-e").toLowerCase();if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){toast("Enter a valid email.");return false}
      const roles=boxes.map(b=>b.querySelector("input")).filter(i=>i.checked).map(i=>i.value);if(!roles.length){toast("Give at least one role.");return false}
      if(email===S.email&&!roles.includes("admin")){toast("You cannot remove your own administrator role.");return false}
      const row={email:e,full_name:val("m-n"),roles,active:act.checked};
      return email?run(()=>sb.from("members").update(row).eq("email",email),"Saved",["members"]):run(()=>sb.from("members").insert(row),"Added. Now use “Set password” to create their login.",["members"])})])}
function loginDialog(email){const pw=genPassword();openDlg("Set password · "+email,h("div",{class:"fg"},h("p",{class:"small muted",style:"grid-column:1/-1;margin:0"},"Creates the login if it does not exist yet, or replaces the current password. Give the password to the person directly; they can change it after signing in."),
  field("lp-p","Password","text",pw,{full:true,hint:"At least 10 characters. A random one is suggested."})),[saveBtn("Save password",async()=>{const p=val("lp-p");if(p.length<10){toast("Use at least 10 characters.");return false}
    const{data:{session}}=await sb.auth.getSession();const res=await fetch("/api/admin-users",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},body:JSON.stringify({email,password:p})});
    const out=await res.json().catch(()=>({}));if(!res.ok){toast(out.error||"Could not set the password.");return false}
    try{await navigator.clipboard.writeText(p);toast((out.created?"Login created":"Password updated")+" and copied")}catch(e){toast(out.created?"Login created":"Password updated")}})])}
function genPassword(){const a="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";const r=new Uint32Array(14);crypto.getRandomValues(r);return Array.from(r,x=>a[x%a.length]).join("")}

/* ============ boot ============ */
(async()=>{
  let conf;try{conf=await (await fetch("/api/config")).json()}catch(e){conf=null}
  if(!conf||!conf.url||!conf.anonKey){document.getElementById("authRoot").textContent="Configuration missing: set SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.";return}
  sb=supabase.createClient(conf.url,conf.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  sb.auth.onAuthStateChange((event,session)=>{
    if(event==="PASSWORD_RECOVERY"){S.session=session;S.email=session&&session.user.email.toLowerCase();authView("newpass");return}
    if(event==="SIGNED_OUT"){if(S.session){S.session=null;S.email=null;S.member=null;S.loaded=false;authView("login")}return}
    if(session&&(event==="SIGNED_IN"||event==="INITIAL_SESSION")&&!S.session){S.session=session;S.email=session.user.email.toLowerCase();setTimeout(startApp,0)}
    if(!session&&event==="INITIAL_SESSION")authView("login")});
})();
