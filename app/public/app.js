"use strict";
/* TUSOME Finance & Procurement — browser app.
   Every permission is enforced by the database (supabase/*.sql). This file only shows or hides
   controls to match; it is never the security boundary. */

/* ============ constants ============ */
const CATS = ["Operations & Essential Costs","Training","M&E, Reporting, and Legal Support","Product Development & Tech Improvements","Marketing & User Acquisition","Safeguarding, Gender, & Compliance"];
const PAY_KINDS = ["Expense","Advance","Subscription","Bank charge","Other"];
const KINDS = ["Goods","Service","Consultant / individual contractor","Software / subscription","Event, travel or logistics"];
const FISCAL = ["Not checked","Verified","Exception approved","None"];
const EVIDENCE = ["Complete","Partially Supported","Missing Evidence","Amount Mismatch","Date Mismatch","Duplicate","Requires Clarification","Not Applicable"];
const SUP_TYPES = ["Company","Individual","Government body","Platform / online service","To confirm"];
const CON_TYPES = ["Supply of goods","Service","Consultancy","Software / subscription","Lease / rent","Other"];
const CON_STATUS = ["Draft","Active","Completed","Expired","Terminated"];
const ACC_TYPES = ["Bank account","Mobile-money wallet","Payment gateway","Petty cash","Card"];
const ACC_STATUS = ["Active","Dormant","Closed","To confirm","Personal account used for company payments"];
const ROLES = ["admin","director","alt_director","approver","custodian","staff","auditor"];
const ROLE_NAME = {admin:"Administrator",director:"Director",alt_director:"Alternate for the Director's own items",approver:"Band 1–2 approver",custodian:"Finance custodian",staff:"Staff",auditor:"Auditor (read-only)"};
const STEP_ROLE = {ID:"approver", DIR:"director"};
const STEP_NAME = {ID:"Band 1–2 approver (Independent Director)", DIR:"Director"};
const VIEWS = [["today","Today"],["payments","Payments"],["spending","Spending overview"],["owed","Who we owe"],["requests","Purchase requests"],["envelopes","Envelopes"],["accounting","Accounting"],["bank","Bank & reconciliation"],["suppliers","Suppliers"],["contracts","Contracts"],["exceptions","Exceptions"],["audit","Audit trail"],["setup","Rules & roles"],["people","People & logins"]];
const TABS = [["today","Today","M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"],["payments","Payments","M4 7h16v11H4zM4 10h16M8 15h3"],["spending","Spending","M5 20V11M12 20V5M19 20v-7"],["owed","Owed","M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6"],["more","More","M4 6h16M4 12h16M4 18h16"]];

/* ============ state ============ */
let sb = null;
const S = {session:null,email:null,member:null,settings:null,members:{},requests:{},suppliers:{},contracts:{},accounts:{},approvals:{},audit:[],
  gl:{},glmap:{},journals:{},jlines:[],envelopes:{},claims:{},payments:{},reimbursements:{},reconciliations:{},loaded:false};
let view="today", tab="all", ptab="all", q="", pq="", af="", sheetFor=null, month=new Date().toISOString().slice(0,7);

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
function nameOf(key){if(!key)return "—";const m=S.members[key];if(m&&m.full_name)return m.full_name;const NAMES={"name:frank":"Frank","name:ibrahim":"Ibrahim","name:issa":"Issa","name:amriyyah":"Amriyyah"};if(NAMES[key])return NAMES[key];return String(key).replace(/^name:/,"")}
const myRoles=()=>(S.member&&S.member.active?S.member.roles:[])||[];
const hasRole=r=>myRoles().includes(r);
const hasAny=rs=>rs.some(hasRole);
const canWrite=()=>myRoles().some(r=>r!=="auditor");
const isAdmin=()=>hasRole("admin");
const seesAllClaims=()=>hasAny(["approver","director","alt_director","admin","custodian","auditor"]);
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
function chainState(r){if(r.envelopeCovered)return stepsFor(r).map(step=>({step,dec:null,s:"done",env:true}));let blocked=false;return stepsFor(r).map(step=>{const d=decisionFor(r,step);let s="pending";if(d)s=d.decision==="Approved"?"done":"rej";else if(!blocked&&r.submitted)s="now";if(s!=="done")blocked=true;return{step,dec:d,s}})}
const approvedAll=r=>chainState(r).every(x=>x.s==="done");
const rejected=r=>chainState(r).some(x=>x.s==="rej");
function status(r){
  if(r.historical)return{k:"paid",t:"Paid · historical",c:"p-ok"};
  if(!r.submitted)return{k:"draft",t:"Draft",c:"p-mute"};
  if(rejected(r))return{k:"rejected",t:"Rejected",c:"p-bad"};
  if(!approvedAll(r)){if(r.payment||reqPayments(r).length)return{k:"paid",t:"Paid without approval",c:"p-bad"};return{k:"approval",t:"Awaiting approval",c:"p-warn"}}
  if(!r.delivery)return{k:"approved",t:"Approved · awaiting delivery",c:"p-info"};
  if(!r.invoice)return{k:"approved",t:"Delivered · awaiting invoice",c:"p-info"};
  if(!r.payment&&!reqPayments(r).length)return{k:"payment",t:"Awaiting payment",c:"p-brand"};
  return{k:"paid",t:"Paid",c:"p-ok"}}
function supplierVerified(s){return !!(s&&s.tin&&["Yes","No"].includes(s.efd)&&s.callback==="Yes"&&s.verifiedBy&&["None declared","Declared"].includes(s.coi)&&s.f07)}
function splitFlag(r){if(!r.supplierId||!r.date)return null;const w=cfg().splitDays*864e5,d0=new Date(r.date);let t=0;
  for(const x of Object.values(S.requests)){if(x.supplierId!==r.supplierId||!x.date||rejected(x))continue;if(Math.abs(new Date(x.date)-d0)<=w){const a=amounts(x).tzs;if(a!=null)t+=a}}
  const rate=amounts(r).rate;return bandOf(t,rate?t/rate:null)>band(r)?t:null}
function checks(r){const out=[];if(r.historical)return out;
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
  Object.values(S.payments).forEach(p=>{if(p.envelope_id===e.id&&!p.request_id&&p.status!=="Rejected"){const v=toTzs(p.amount,p.currency,p.date)||0;cl+=v;items.push(["Payment",p.id,p.description,v])}});
  const budget=e.currency==="USD"?toTzs(e.amount,"USD",today()):n0(e.amount);return{req,cl,used:req+cl,budget,left:(budget||0)-(req+cl),items}}
/* payments */
const isDirector=e=>((S.members[e]||{}).roles||[]).includes("director");
function payNeedsDirector(p){const a=amounts(p);return a.usd!=null&&a.usd>cfg().thresholdUsd}
function canDecidePayment(p){if(p.status!=="Submitted"||p.payer===S.email||p.recorded_by===S.email)return false;
  if(payNeedsDirector(p))return (isDirector(p.payer)||isDirector(p.recorded_by))?hasAny(["alt_director","director"]):hasRole("director");return hasAny(["approver","director"])}
const PAY_PILL={Submitted:"p-warn",Approved:"p-ok",Rejected:"p-bad"};
const PAY_LABEL={Submitted:"Awaiting approval",Approved:"Approved",Rejected:"Rejected"};
function paidFrom(p){return p.funding==="Personal"?"Personal · "+nameOf(p.payer):((S.accounts[p.account_id]||{}).name||"Company")}
function owedByPerson(){const m={};const get=k=>m[k]=m[k]||{who:k,owed:{},pending:{},paid:{},items:[]};
  Object.values(S.payments).forEach(p=>{if(p.funding!=="Personal"||!p.payer||p.imported)return;const o=get(p.payer);o.items.push(p);
    if(p.status==="Approved")o.owed[p.currency]=(o.owed[p.currency]||0)+n0(p.amount);else if(p.status==="Submitted")o.pending[p.currency]=(o.pending[p.currency]||0)+n0(p.amount)});
  Object.values(S.reimbursements).forEach(r=>{const o=get(r.claimant);o.owed[r.currency]=(o.owed[r.currency]||0)-n0(r.amount);o.paid[r.currency]=(o.paid[r.currency]||0)+n0(r.amount)});
  Object.values(m).forEach(o=>Object.keys(o.owed).forEach(c=>{if(Math.abs(o.owed[c])<0.005)delete o.owed[c]}));return Object.values(m)}
const fmtByCur=o=>Object.keys(o).length?Object.entries(o).map(([c,v])=>money(v,c)).join(" + "):"—";
function toTzsSum(o){return Object.entries(o).reduce((t,[c,v])=>t+(toTzs(v,c,today())||0),0)}
const reqPayments=r=>Object.values(S.payments).filter(p=>p.request_id===r.id&&p.status!=="Rejected");
/* bank */
function latestRecon(accId){return Object.values(S.reconciliations).filter(r=>r.account_id===accId).sort((a,b)=>(b.as_of+b.prepared_at).localeCompare(a.as_of+a.prepared_at))[0]||null}
function reconState(r){if(!r)return{t:"Not reconciled",c:"p-warn"};if(!r.reviewed_by)return{t:"Awaiting sign-off",c:"p-warn"};if(Math.abs(n0(r.difference))>0.005)return{t:"Signed off with difference",c:"p-info"};return{t:"Reconciled",c:"p-ok"}}
function cashPosition(){const t={};Object.values(S.accounts).forEach(a=>{if(a.holder!=="Company")return;const r=latestRecon(a.id);if(r)t[r.currency]=(t[r.currency]||0)+n0(r.statement_balance)});return t}

function allExceptions(){const out=[];
  Object.values(S.requests).forEach(r=>checks(r).forEach(([k,d])=>out.push({k,d,ref:r.id,who:(S.suppliers[r.supplierId]||{}).name||"—",amt:amounts(r).tzs,go:()=>openRequest(r.id)})));
  Object.values(S.contracts).forEach(c=>contractChecks(c).forEach(([k,d])=>out.push({k,d,ref:c.id,who:(S.suppliers[c.supplierId]||{}).name||"—",amt:c.currency==="USD"?null:n0(c.value),go:()=>editContract(c.id)})));
  Object.values(S.envelopes).forEach(e=>{if(e.status!=="Active")return;const u=envelopeUse(e);if(u.left<0)out.push({k:"Envelope overspent",d:e.name+": over by "+tzs(-u.left),ref:e.id,who:"—",amt:-u.left,go:()=>go("envelopes")})});
  Object.values(S.accounts).forEach(a=>{if(a.holder!=="Company"||a.status!=="Active")return;const r=latestRecon(a.id);
    if(!r)out.push({k:"Account not reconciled",d:a.name+": no reconciliation recorded",ref:a.id,who:"—",amt:null,go:()=>go("bank")});
    else if(daysSince(r.as_of)>35)out.push({k:"Reconciliation overdue",d:a.name+": last reconciled "+fmtDate(r.as_of),ref:a.id,who:"—",amt:null,go:()=>go("bank")});
    else if(!r.reviewed_by)out.push({k:"Reconciliation awaiting sign-off",d:a.name+" as of "+fmtDate(r.as_of)+", prepared by "+nameOf(r.prepared_by),ref:r.id,who:"—",amt:null,go:()=>go("bank")});});
  Object.values(S.payments).forEach(p=>{if(p.status==="Submitted"&&daysSince(p.recorded_at||p.date)>7)out.push({k:"Payment waiting over 7 days",d:p.description+" · "+paidFrom(p),ref:p.id,who:p.payee||"—",amt:toTzs(p.amount,p.currency,p.date),go:()=>showPayment(p.id)});
    if(p.funding==="Company"&&p.status==="Approved"&&!p.imported&&p.fiscal!=="Verified"&&p.fiscal!=="Exception approved"&&p.kind!=="Bank charge")out.push({k:"Fiscal receipt not verified",d:p.description+" · "+(p.fiscal||"Not checked"),ref:p.id,who:p.payee||"—",amt:toTzs(p.amount,p.currency,p.date),go:()=>showPayment(p.id)})});
  const fx=fxFor(today());if(!fx||fx.status==="Placeholder")out.push({k:"FX rate not confirmed",d:"Add the current Bank of Tanzania rate",ref:"Rules",who:"—",amt:null,go:()=>go("setup")});
  if(!emailsWithRole("approver").length||!emailsWithRole("director").length)out.push({k:"Approvers not assigned",d:"Give at least one person the approver role and one the director role",ref:"People",who:"—",amt:null,go:()=>go("people")});
  return out}
function myPending(){const me=S.email;return Object.values(S.requests).filter(r=>{if(!r.submitted||rejected(r)||r.requester===me)return false;const now=chainState(r).find(x=>x.s==="now");return now&&hasRole(STEP_ROLE[now.step])})}
const myClaimDecisions=()=>Object.values(S.payments).filter(canDecidePayment);

/* ============ data ============ */
function rowToRequest(x){return Object.assign({},x.details||{},{id:x.id,requester:x.requester_email,date:x.date,supplierId:x.supplier_id,amount:n0(x.amount),currency:x.currency,submitted:x.submitted,submittedAt:x.submitted_at,rev:x.rev,retro:x.retro,_details:x.details||{}})}
const ROW_TABLES=["envelopes","payments","reimbursements","reconciliations"];
async function loadTable(name){
  if(name==="settings"){const{data,error}=await sb.from("settings").select("*").eq("id",1).maybeSingle();if(!error)S.settings=data;return}
  if(name==="members"){const{data,error}=await sb.from("members").select("*");if(error){S.loadError=error.message||String(error);console.error(error);return}S.loadError=null;S.members={};data.forEach(m=>S.members[m.email]=m);S.member=S.members[S.email]||null;return}
  if(name==="requests"){const{data,error}=await sb.from("requests").select("*");if(!error){S.requests={};data.forEach(x=>S.requests[x.id]=rowToRequest(x))}return}
  if(name==="approvals"){const{data,error}=await sb.from("approvals").select("*");if(!error){S.approvals={};data.forEach(a=>S.approvals[apprKey(a.request_id,a.rev,a.step)]=a)}return}
  if(name==="audit_log"){const{data,error}=await sb.from("audit_log").select("*").order("id",{ascending:false}).limit(500);if(!error)S.audit=data;return}
  if(name==="gl_accounts"){const{data,error}=await sb.from("gl_accounts").select("*");if(error){S.glMissing=true;return}S.glMissing=false;S.gl={};data.forEach(a=>S.gl[a.code]=a);return}
  if(name==="gl_category_map"){const{data,error}=await sb.from("gl_category_map").select("*");if(!error){S.glmap={};data.forEach(m=>S.glmap[m.category]=m.account_code)}return}
  if(name==="journals"){if(!seesBooks())return;const all=[];for(let f=0;;f+=1000){const{data,error}=await sb.from("journals").select("*").range(f,f+999);if(error||!data)break;all.push(...data);if(data.length<1000)break}S.journals={};all.forEach(j=>S.journals[j.id]=j);return}
  if(name==="journal_lines"){if(!seesBooks())return;const all=[];for(let f=0;;f+=1000){const{data,error}=await sb.from("journal_lines").select("*").range(f,f+999);if(error||!data)break;all.push(...data);if(data.length<1000)break}S.jlines=all;return}
  if(ROW_TABLES.includes(name)){const{data,error}=await sb.from(name).select("*");if(error){console.warn(name,error.message);S.missing004=true;return}S[name]={};data.forEach(x=>S[name][x.id]=x);return}
  const{data,error}=await sb.from(name).select("*");if(!error){S[name]={};data.forEach(x=>S[name][x.id]=Object.assign({},x.data,{id:x.id}))}}
const TABLES=["gl_accounts","gl_category_map","journals","journal_lines","settings","members","suppliers","contracts","accounts","requests","approvals","audit_log",...ROW_TABLES];
async function loadAll(){S.missing004=false;await loadTable("members");await Promise.all(TABLES.filter(t=>t!=="members").map(loadTable));S.loaded=true;render()}
let refreshTimer=null;const pending=new Set();
function scheduleRefresh(t){pending.add(t);if(t==="journals"||t==="payments"||t==="reimbursements"){pending.add("journals");pending.add("journal_lines")}pending.add("audit_log");clearTimeout(refreshTimer);refreshTimer=setTimeout(async()=>{const list=[...pending];pending.clear();await Promise.all(list.map(loadTable));render()},250)}
function subscribe(){sb.channel("live").on("postgres_changes",{event:"*",schema:"public"},p=>scheduleRefresh(p.table)).subscribe()}
async function run(fn,okMsg,tables){try{const res=await fn();if(res&&res.error)throw res.error;if(okMsg)toast(okMsg);(tables||[]).forEach(scheduleRefresh);return res||true}catch(e){console.error(e);toast(friendly(e));return false}}
function friendly(e){const m=(e&&(e.message||e.error_description))||"";if(/row-level security|permission denied/i.test(m))return "You do not have permission to do that.";if(/relation .* does not exist|Could not find the table/i.test(m))return "The database needs the latest update (run supabase/005_payments_ledger.sql).";return m||"Could not save. Try again."}
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
const visibleViews=()=>VIEWS.filter(([k])=>(k!=="people"||isAdmin())&&(k!=="accounting"||seesBooks()));
function badgeFor(k){const cd=myClaimDecisions().length;if(k==="today"){const n=myPending().length+cd;return n?h("span",{class:"count"},n):null}
  if(k==="exceptions"){const n=allExceptions().length;return n?h("span",{class:"count bad"},n):null}if(k==="payments"&&cd)return h("span",{class:"count"},cd);return null}
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
  if(S.missing004)parts.push(h("div",{class:"banner"},h("b",null,"Database update needed. "),"Payments, envelopes and reconciliations need supabase/004 and 005 to be run in Supabase."));
  if(!canWrite())parts.push(h("div",{class:"banner info"},h("b",null,"Read-only access. "),"You can view every record and the audit trail."));
  const fn={accounting:vAccounting,today:vToday,requests:vRequests,payments:vPayments,spending:vSpending,owed:vOwed,envelopes:vEnvelopes,bank:vBank,suppliers:vSuppliers,contracts:vContracts,exceptions:vExceptions,audit:vAudit,setup:vSetup,people:vPeople}[view]||vToday;
  parts.push(...[].concat(fn()).filter(Boolean));$("#view").replaceChildren(...parts);renderSheet()}
function header(title,sub,...actions){const a=actions.filter(Boolean);return h("div",{class:"head"},h("div",null,h("h1",null,title),sub?h("p",{class:"sub"},sub):null),a.length?h("div",{class:"row"},...a):null)}
function newBtn(label,fn,ok){return (ok===undefined?canWrite():ok)?h("button",{class:"btn primary",onclick:fn},label):null}
const tile=(v,l,onclick)=>h("div",{class:"tile",style:onclick?"cursor:pointer":null,onclick},h("div",{class:"v"},v),h("div",{class:"l"},l));
const empty=t=>h("div",{class:"empty"},t);

function vToday(){const reqs=Object.values(S.requests),pend=myPending(),cd=myClaimDecisions(),me=S.email;
  const mine=reqs.filter(r=>r.requester===me&&!["paid","rejected"].includes(status(r).k));
  const toPay=reqs.filter(r=>status(r).k==="payment");
  const myOwed=owedByPerson().find(p=>p.who===me);const exc=allExceptions(),fx=fxFor(today());const first=((S.member&&S.member.full_name)||"").split(" ")[0];
  return [header("Habari"+(first?", "+first:""),"What needs your attention today.",newBtn("Record a payment",()=>editPayment()),newBtn("New purchase request",()=>editRequest())),
    h("div",{class:"tiles"},tile(pend.length+cd.length,"Waiting for your approval"),tile(toPay.length,"Approved, awaiting payment",()=>{tab="payment";go("requests")}),
      tile(fmtByCur(myOwed?myOwed.owed:{}),"TUSOME owes you",()=>go("owed")),
      isOversight()?null:tile(tzs(spendRows(curMonth()).reduce((t,p)=>t+(toTzs(p.amount,p.currency,p.date)||0),0)),"Spent this month",()=>{month=curMonth();go("spending")}),
      isOversight()?null:tile(exc.length,"Open exceptions",()=>go("exceptions"))),
    (isOversight()&&!pend.length&&!cd.length&&!mine.length)?null:h("div",{class:"grid2"},h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Your approvals")),
        (pend.length||cd.length)?h("div",{class:"list"},reqItems(pend.slice(0,6)),claimItems(cd.slice(0,Math.max(0,6-pend.length))),pend.length+cd.length>6?h("a",{href:"#payments",class:"li",style:"text-decoration:none",onclick:()=>{ptab="decide"}},h("span",{class:"t"},"View all "+(pend.length+cd.length)+" waiting for you"),""):null):empty("Nothing waiting for you. Requests and payments appear here when it is your turn.")),
      h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Your open requests")),mine.length?h("div",{class:"list"},reqItems(mine)):empty("You have no open requests."))),
    ...(isOversight()?vAdminPanel():[h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Exceptions"),h("a",{href:"#exceptions",class:"small"},"View all")),excTable(exc.slice(0,6)))])]}
/* ---- control panel for oversight roles (admin, Director, alternate, auditor) ---- */
const isOversight=()=>hasAny(["admin","director","alt_director","auditor"]);
const curMonth=()=>new Date().toISOString().slice(0,7);
function monthsBack(n,from){const out=[];const d=new Date((from||curMonth())+"-01T00:00:00");for(let i=n-1;i>=0;i--){const x=new Date(d.getFullYear(),d.getMonth()-i,1);out.push(x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0"))}return out}
const sumTzs=rows=>rows.reduce((t,p)=>t+(toTzs(p.amount,p.currency,p.date)||0),0);
const pct=(a,b)=>b?Math.round(a/b*100)+"%":"—";
function kv(k,v,onclick){return h("div",{class:"kv",style:"padding:7px 0;border-bottom:1px solid var(--line)"+(onclick?";cursor:pointer":""),onclick},h("span",null,k),h("span",{class:"num",style:"font-weight:700;color:var(--ink);text-align:right"},v))}
function panel(title,link,...kids){return h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,title),link?h("a",{href:"#"+link[0],class:"small"},link[1]):null),h("div",{style:"padding:6px 16px 14px"},...kids))}
function vAdminPanel(){const m=curMonth(),prev=monthsBack(2)[0];const rows=spendRows(m),prevRows=spendRows(prev);const total=sumTzs(rows),prevTotal=sumTzs(prevRows);
  const allPays=Object.values(S.payments).filter(p=>p.status!=="Rejected"&&!p.opening);const sinceOct=sumTzs(allPays.filter(p=>p.date>="2026-10-01"));
  const personal=sumTzs(rows.filter(p=>p.funding==="Personal"));
  const owed=owedByPerson();const owedTotal={};owed.forEach(p=>Object.entries(p.owed).forEach(([c,v])=>{if(v>0)owedTotal[c]=(owedTotal[c]||0)+v}));
  const envs=Object.values(S.envelopes).filter(e=>e.status==="Active");const envU=envs.map(e=>envelopeUse(e));
  const envBudget=envU.reduce((t,u)=>t+(u.budget||0),0),envUsed=envU.reduce((t,u)=>t+u.used,0),envOver=envU.filter(u=>u.left<0).length;
  const waitPays=Object.values(S.payments).filter(p=>p.status==="Submitted");const waitReqs=Object.values(S.requests).filter(r=>status(r).k==="approval");
  const oldest=waitPays.map(p=>daysSince(p.recorded_at||p.date)).concat(waitReqs.map(r=>daysSince(r.submittedAt||r.date))).filter(x=>x!=null).sort((a,b)=>b-a)[0];
  const awaitingPay=Object.values(S.requests).filter(r=>status(r).k==="payment");
  const rejectedM=Object.values(S.payments).filter(p=>p.status==="Rejected"&&monthOf(p.date)===m).length;
  const withRec=rows.filter(p=>/^https?:/.test(p.receipt_link||"")).length;const comp=rows.filter(p=>p.funding==="Company");const fisOk=comp.filter(p=>["Verified","Exception approved"].includes(p.fiscal)).length;
  const exc=allExceptions();const excBy={};exc.forEach(e=>excBy[e.k]=(excBy[e.k]||0)+1);
  const fx=fxFor(today());const fxAge=fx?daysSince(fx.date):null;
  const accs=Object.values(S.accounts).filter(a=>a.holder==="Company");
  /* who is holding approvals */
  const holders={};waitPays.forEach(p=>{const who=payNeedsDirector(p)?((isDirector(p.payer)||isDirector(p.recorded_by))?"Alternate (habari@)":"Director"):"Band 1–2 approvers";holders[who]=(holders[who]||0)+1});
  waitReqs.forEach(r=>{const now=chainState(r).find(x=>x.s==="now");const who=now?(now.step==="DIR"?(isDirector(r.requester)?"Alternate (habari@)":"Director"):"Band 1–2 approvers"):"—";holders[who]=(holders[who]||0)+1});
  /* activity by person this month */
  const lastSeen={};S.audit.forEach(a=>{if(a.actor_email&&a.actor_email!=="system"&&(!lastSeen[a.actor_email]||a.at>lastSeen[a.actor_email]))lastSeen[a.actor_email]=a.at});
  const people=Object.values(S.members).filter(x=>x.active).map(x=>{const mine=rows.filter(p=>p.recorded_by===x.email||p.payer===x.email);const o=owed.find(p=>p.who===x.email);
    return{x,count:mine.length,value:sumTzs(mine),personal:sumTzs(mine.filter(p=>p.funding==="Personal"&&p.payer===x.email)),owed:o?fmtByCur(Object.fromEntries(Object.entries(o.owed).filter(([,v])=>v>0))):"—",last:lastSeen[x.email]}}).sort((a,b)=>b.value-a.value);
  const months=monthsBack(6).map(k=>[k,sumTzs(spendRows(k))]);const mmax=Math.max(1,...months.map(x=>x[1]));
  const cats=groupSum(rows,p=>p.category).slice(0,5);const cmax=Math.max(1,...cats.map(x=>x[1]));
  const change=prevTotal?Math.round((total-prevTotal)/prevTotal*100):null;
  const loginBox=h("div",{class:"small muted"},isAdmin()?"Loading login activity…":"Visible to administrators.");if(isAdmin())loadLogins(loginBox);
  return [h("h2",{style:"font-size:18px;margin-top:6px"},"Control panel"),
    h("div",{class:"tiles"},tile(tzs(total),"Spent in "+monthName(m)+(change!=null?" · "+(change>=0?"+":"")+change+"% vs "+monthName(prev).split(" ")[0]:""),()=>{month=m;go("spending")}),
      tile(tzs(sinceOct),"Spent since 1 Oct 2026",()=>go("spending")),tile(fmtByCur(owedTotal),"Owed to staff",()=>go("owed")),
      tile(waitPays.length+waitReqs.length,"Waiting for approval"+(oldest!=null?" · oldest "+oldest+" days":""),()=>{ptab="waiting";go("payments")}),
      tile(envs.length?tzs(envBudget-envUsed):"—","Left in active envelopes"+(envOver?" · "+envOver+" overspent":""),()=>go("envelopes")),
      tile(exc.length,"Open exceptions",()=>go("exceptions"))),
    h("div",{class:"grid2"},
      panel("This month",["spending","Spending overview"],kv("Payments recorded",rows.length),kv("Average payment",rows.length?tzs(total/rows.length):"—"),kv("Paid with personal money",tzs(personal)+" · "+pct(personal,total)),
        kv("Company money",tzs(total-personal)),kv("Have a receipt link",pct(withRec,rows.length)),kv("Company payments with fiscal receipt verified",pct(fisOk,comp.length)),kv("Rejected payments",rejectedM)),
      panel("Approvals pipeline",["payments","Payments"],kv("Payments awaiting approval",waitPays.length+" · "+tzs(sumTzs(waitPays)),()=>{ptab="waiting";go("payments")}),kv("Purchase requests awaiting approval",waitReqs.length,()=>{tab="approval";go("requests")}),
        kv("Approved requests awaiting payment",awaitingPay.length,()=>{tab="payment";go("requests")}),kv("Oldest item waiting",oldest!=null?oldest+" days":"—"),
        h("div",{class:"small muted",style:"margin-top:10px"},"Waiting with:"),Object.keys(holders).length?Object.entries(holders).map(([k,v])=>kv(k,v)):h("div",{class:"small muted"},"Nobody. All clear."))),
    h("div",{class:"grid2"},
      panel("Last 6 months",["spending","Details"],h("div",{style:"display:grid;grid-template-columns:repeat(6,1fr);gap:8px;align-items:end;height:150px;margin-top:8px"},
        months.map(([k,v])=>h("button",{style:"display:flex;flex-direction:column;justify-content:flex-end;gap:4px;height:100%;border:0;background:none;cursor:pointer;padding:0;min-width:0",onclick:()=>{month=k;go("spending")},"aria-label":monthName(k)+": "+tzs(v)},
          h("span",{class:"small num",style:"text-align:center;font-size:11px;color:var(--muted)"},v?(v>=1e6?(v/1e6).toFixed(1)+"m":Math.round(v/1e3)+"k"):"0"),
          h("span",{style:"display:block;border-radius:4px 4px 0 0;background:"+(k===m?"var(--brand)":"var(--line)")+";height:"+Math.max(2,v/mmax*100)+"px"}),
          h("span",{class:"small",style:"text-align:center;font-weight:"+(k===m?"700":"500")},new Date(k+"-01T00:00:00").toLocaleDateString("en-GB",{month:"short"})))))),
      panel("Top categories this month",["spending","Details"],cats.length?cats.map(([k,v])=>h("div",{style:"margin-top:8px"},h("div",{class:"kv"},h("span",{style:"color:var(--ink);font-weight:600"},k),h("span",{class:"num"},tzs(v))),h("div",{class:"envbar"},h("i",{style:"width:"+(v/cmax*100)+"%"})))):empty("No spending yet this month."))),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"People this month"),isAdmin()?h("a",{href:"#people",class:"small"},"Manage people"):null),
      T([{l:"Person",primary:true},{l:"Payments",num:true},{l:"Value",num:true},{l:"Own money spent",num:true},{l:"Owed now",num:true},{l:"Last activity"}],
        people.map(p=>[h("div",null,h("div",{style:"font-weight:600"},p.x.full_name||p.x.email),h("div",{class:"small muted"},(p.x.roles||[]).filter(r=>r!=="staff").map(r=>ROLE_NAME[r]).join(", ")||"Staff")),p.count,tzs(p.value),tzs(p.personal),p.owed,p.last?fmtTime(p.last):"No activity yet"]))),
    h("div",{class:"grid2"},
      panel("Control health",["exceptions","Exceptions"],kv("FX rate",fx?Number(fx.rate).toLocaleString("en-GB",{maximumFractionDigits:2})+" · "+(fxAge===0?"today":fxAge+" days old"):"Not set",()=>go("setup")),
        ...accs.map(a=>{const r=latestRecon(a.id),st=reconState(r);return kv(a.name,(r?fmtDate(r.as_of)+" · ":"")+st.t,()=>go("bank"))}),
        Object.keys(excBy).length?Object.entries(excBy).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>kv(k,v,()=>go("exceptions"))):kv("Exceptions","None")),
      panel("Logins",isAdmin()?["people","People & logins"]:null,loginBox)),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Recent activity"),h("a",{href:"#audit",class:"small"},"Audit trail")),
      S.audit.length?T([{l:"Detail",primary:true},{l:"When"},{l:"Who"},{l:"Action"}],S.audit.slice(0,10).map(a=>[auditSummary(a),fmtTime(a.at),nameOf(a.actor_email),auditAction(a)])):empty("No activity yet."))]}
async function loadLogins(box){try{const{data:{session}}=await sb.auth.getSession();const res=await fetch("/api/admin-users",{headers:{Authorization:"Bearer "+session.access_token}});const out=await res.json();
  if(!res.ok)throw new Error(out.error||"Could not load");const by={};(out.users||[]).forEach(u=>by[u.email]=u);
  const list=Object.values(S.members).sort((a,b)=>a.email.localeCompare(b.email));
  box.replaceChildren(...list.map(m=>{const u=by[m.email];return kv(m.full_name||m.email,!m.active?"Disabled":!u?"No login yet":u.last_sign_in_at?"Last sign-in "+fmtTime(u.last_sign_in_at):"Never signed in")}));box.className=""}
  catch(e){box.textContent="Login activity unavailable: "+e.message}}

function reqItems(arr){return arr.map(r=>{const s=status(r);return h("button",{class:"li",onclick:()=>openRequest(r.id)},h("div",{style:"min-width:0"},h("div",{class:"t"},r.title||"Untitled"),h("div",{class:"small muted"},r.id+" · "+((S.suppliers[r.supplierId]||{}).name||"No supplier")+" · "+nameOf(r.requester)),trail(r)),h("div",{style:"text-align:right"},h("div",{class:"num",style:"font-weight:700"},money(r.amount,r.currency)),pill(s.t,s.c)))})}
function claimItems(arr){return arr.map(p=>h("button",{class:"li",onclick:()=>showPayment(p.id)},h("div",{style:"min-width:0"},h("div",{class:"t"},p.description),h("div",{class:"small muted"},p.id+" · payment · "+paidFrom(p))),h("div",{style:"text-align:right"},h("div",{class:"num",style:"font-weight:700"},money(p.amount,p.currency)),pill(PAY_LABEL[p.status],PAY_PILL[p.status]))))}
function trail(r){const ok=r.invoice&&["Verified","Exception approved"].includes(r.invoice.fiscal);const parts=[{s:r.submitted?"done":"now"},...chainState(r).map(x=>({s:x.s==="done"?"done":x.s==="rej"?"gap":x.s==="now"?"now":""})),{s:r.delivery?"done":""},{s:r.invoice?(ok?"done":"gap"):""},{s:(r.payment||reqPayments(r).length)?(approvedAll(r)?"done":"gap"):""}];
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

/* ---- payments (the book of payments) ---- */
function monthOf(d){return String(d||"").slice(0,7)}
function vPayments(){const all=Object.values(S.payments).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.id>a.id?1:-1));
  const groups=[["all","All"],["mine","Mine"],["decide","To approve"],["waiting","Awaiting approval"],["personal","Paid personally"],["company","Company"]];
  const pick=k=>k==="mine"?all.filter(p=>p.payer===S.email||p.recorded_by===S.email):k==="decide"?all.filter(canDecidePayment):k==="waiting"?all.filter(p=>p.status==="Submitted"):k==="personal"?all.filter(p=>p.funding==="Personal"):k==="company"?all.filter(p=>p.funding==="Company"):all;
  let rows=pick(ptab);if(pq){const f=pq.toLowerCase();rows=rows.filter(p=>[p.id,p.description,p.payee,p.project,p.category,p.tracker_id,nameOf(p.payer)].join(" ").toLowerCase().includes(f))}
  return [header("Payments","Every payment TUSOME makes, from a company account or from someone's own pocket. Money paid personally is added to Who we owe once approved.",newBtn("Record a payment",()=>editPayment()),isAdmin()?h("button",{class:"btn",onclick:importTracker},"Import from tracker"):null),
    h("section",{class:"panel"},h("div",{class:"tabs",role:"tablist"},groups.filter(([k])=>k!=="decide"||hasAny(["approver","director","alt_director"])).map(([k,l])=>h("button",{role:"tab","aria-selected":ptab===k?"true":"false",onclick:()=>{ptab=k;render()}},l,h("span",{class:"n"},pick(k).length)))),
      h("div",{class:"toolbar"},searchBox("pq",pq,v=>pq=v,"Search what, who, project, tracker ID"),h("span",{class:"small muted"},rows.length+" shown")),
      !rows.length?empty(all.length?"No payments match.":"No payments yet. Select “Record a payment” to add the first."):
      T([{l:"What",primary:true},{l:"Date"},{l:"Paid to"},{l:"Paid from"},{l:"Project"},{l:"Amount",num:true},{l:"Status"}],
        rows.map(p=>[h("div",null,h("div",{style:"font-weight:600"},p.description),h("div",{class:"small muted"},p.id+(p.tracker_id?" · "+p.tracker_id:"")+(p.opening?" · opening balance":""))),fmtDate(p.date),p.payee||"—",paidFrom(p),p.project||"—",money(p.amount,p.currency),pill(PAY_LABEL[p.status],PAY_PILL[p.status])]),i=>()=>showPayment(rows[i].id)))]}
function showPayment(id){const p=S.payments[id];if(!p)return;const acts=[];const mine=p.recorded_by===S.email;
  if(mine&&p.status!=="Approved")acts.push(h("button",{class:"btn",onclick:()=>{dlg.close();editPayment(p.id)}},"Edit"));
  if(p.status==="Approved"&&(mine||hasAny(["admin","custodian"])))acts.push(h("button",{class:"btn",onclick:()=>{dlg.close();paymentEvidence(p)}},"Update evidence"));
  if(mine&&p.status!=="Approved")acts.push(h("button",{class:"btn danger",onclick:async()=>{if(await run(()=>sb.from("payments").delete().eq("id",p.id),"Deleted",["payments"]))dlg.close()}},"Delete"));
  if(canDecidePayment(p)){acts.push(h("button",{class:"btn ok",onclick:()=>decidePayment(p,"Approved")},"Approve"));acts.push(h("button",{class:"btn danger",onclick:()=>decidePayment(p,"Rejected")},"Reject"))}
  const a=amounts(p);const link=u=>u&&/^https?:/.test(u)?h("a",{href:u,target:"_blank",rel:"noopener"},"Open receipt"):(u||"—");
  openDlg(p.id,h("div",{style:"display:grid;gap:12px"},h("div",{class:"row"},pill(PAY_LABEL[p.status],PAY_PILL[p.status]),h("b",{class:"num"},money(p.amount,p.currency)),p.currency==="USD"&&a.tzs?h("span",{class:"muted small"},"≈ "+tzs(a.tzs)):null),
    p.status==="Submitted"&&payNeedsDirector(p)?h("div",{class:"banner info"},"Above USD "+cfg().thresholdUsd.toLocaleString("en-GB")+": "+((isDirector(p.payer)||isDirector(p.recorded_by))?"the alternate approver decides the Director's own payments.":"the Director decides.")):null,
    h("dl",null,h("dt",null,"What"),h("dd",null,p.description),h("dt",null,"Date"),h("dd",null,fmtDate(p.date)),h("dt",null,"Paid to"),h("dd",null,p.payee||(S.suppliers[p.supplier_id]||{}).name||"—"),
      h("dt",null,"Paid from"),h("dd",null,paidFrom(p)),h("dt",null,"Type"),h("dd",null,p.kind||"Expense"),h("dt",null,"Project"),h("dd",null,p.project||"—"),h("dt",null,"Category"),h("dd",null,p.category||"—"),
      h("dt",null,"Envelope"),h("dd",null,(S.envelopes[p.envelope_id]||{}).name||"—"),h("dt",null,"Purchase request"),h("dd",null,p.request_id?h("a",{href:"#r-"+p.request_id,onclick:()=>dlg.close()},p.request_id):"—"),
      h("dt",null,"Receipt"),h("dd",null,link(p.receipt_link)),h("dt",null,"Fiscal receipt"),h("dd",null,p.fiscal||"Not checked"),
      h("dt",null,"Approval"),h("dd",null,p.status==="Approved"?(p.approval_basis||"Approved")+(p.decided_at?" · "+fmtTime(p.decided_at):""):p.status==="Rejected"?"Rejected by "+nameOf(p.decided_by)+(p.decision_comment?" · “"+p.decision_comment+"”":""):"Waiting for a decision"),
      h("dt",null,"Recorded by"),h("dd",null,nameOf(p.recorded_by)+(p.recorded_at?" · "+fmtTime(p.recorded_at):"")),p.tracker_id?[h("dt",null,"Tracker Record ID"),h("dd",{class:"mono"},p.tracker_id)]:null,
      p.notes?[h("dt",null,"Notes"),h("dd",null,p.notes)]:null)),acts)}
function editPayment(id,preset){if(!canWrite())return;const p=id?S.payments[id]:Object.assign({date:today(),currency:"TZS",funding:"Personal",kind:"Expense"},preset||{});
  const companyAccs=Object.values(S.accounts).filter(a=>a.holder==="Company").map(a=>[a.id,a.name]);
  const canOnBehalf=hasAny(["custodian","admin"]);const people=Object.values(S.members).filter(m=>m.active).map(m=>[m.email,m.full_name||m.email]);
  const fromSel=field("y-from","Paid from","select",p.funding==="Company"?"acc:"+(p.account_id||""):"me",{blank:false,options:[["me","My own money (TUSOME will owe me)"],...companyAccs.map(([k,l])=>["acc:"+k,"Company: "+l]),...(canOnBehalf?people.filter(x=>x[0]!==S.email).map(([k,l])=>["for:"+k,"Personal money of "+l]):[])]});
  const note=h("div",{class:"rule",style:"grid-column:1/-1"});const more=h("div",{class:"fg",style:"grid-column:1/-1",hidden:!id&&!preset});
  const env=Object.values(S.envelopes).filter(e=>e.status==="Active"||e.id===p.envelope_id).map(e=>[e.id,e.name+(e.pre_approved?" · pre-approved":"")+" · "+tzs(envelopeUse(e).left)+" left"]);
  const approvedReqs=Object.values(S.requests).filter(r=>approvedAll(r)&&r.submitted||r.id===p.request_id).map(r=>[r.id,r.id+" · "+(r.title||"")+" · "+money(r.amount,r.currency)]);
  more.append(field("y-payee","Paid to (shop, supplier or person)","text",p.payee),field("y-sup","Supplier (if registered)","select",p.supplier_id,{options:supOptions(),blank:"None"}),
    field("y-proj","Project / client","text",p.project),field("y-cat","Category","select",p.category,{options:CATS}),field("y-kind","Type","select",p.kind,{options:PAY_KINDS,blank:false}),
    field("y-req","For purchase request","select",p.request_id,{options:approvedReqs,blank:"None"}),field("y-fis","Fiscal receipt (EFD/VFD)","select",p.fiscal||"Not checked",{options:FISCAL,blank:false}),field("y-notes","Notes","textarea",p.notes,{full:true}));
  const body=h("div",{class:"fg"},field("y-desc","What was it for?","text",p.description,{full:true,ph:"e.g. Fuel for Zanzibar field visit"}),field("y-amt","Amount","number",p.amount),field("y-cur","Currency","select",p.currency,{options:["TZS","USD"],blank:false}),
    field("y-date","Date paid","date",p.date),fromSel,field("y-env","Envelope (budget)","select",p.envelope_id,{options:env,blank:"None"}),
    field("y-rec","Link to receipt or proof of payment","url",p.receipt_link,{full:true,hint:"Required. A Google Drive link to the photo or PDF works."}),note,
    h("button",{type:"button",class:"linkbtn",style:"grid-column:1/-1",onclick:e=>{more.hidden=!more.hidden;e.target.textContent=more.hidden?"More details (payee, project, category, request)":"Hide details"}},more.hidden?"More details (payee, project, category, request)":"Hide details"),more);
  const preview=()=>{const amt=n0(val("y-amt"));if(!(amt>0)){note.replaceChildren("Enter the amount to see how it will be approved.");return}
    const cur=val("y-cur")||"TZS",t=toTzs(amt,cur,val("y-date")||today()),u=amounts({amount:amt,currency:cur,date:val("y-date")}).usd;const e=S.envelopes[val("y-env")];const from=val("y-from");
    let how;if(val("y-req"))how="Covered by approved purchase request "+val("y-req")+": approved automatically.";
    else if(e&&e.pre_approved&&e.status==="Active"&&envelopeUse(e).left-(id&&p.envelope_id===e.id?0:t||0)>=0)how="Inside pre-approved envelope "+e.name+": approved automatically.";
    else how=(u!=null&&u>cfg().thresholdUsd?"Above USD "+cfg().thresholdUsd.toLocaleString("en-GB")+": the Director must approve.":"A Band 1–2 approver or the Director must approve.");
    note.replaceChildren(h("b",null,from==="me"||from.startsWith("for:")?"Personal money: added to Who we owe once approved.":"Company money."),how)};
  body.addEventListener("input",preview);body.addEventListener("change",preview);
  openDlg(id?"Edit "+id:"Record a payment",body,[saveBtn(id?"Save":"Record payment",async()=>{const desc=val("y-desc"),amt=n0(val("y-amt"));if(!desc||!(amt>0)){toast("Add what it was for and the amount.");return false}
    if(!val("y-rec")){toast("Add the receipt link.");return false}const from=val("y-from");
    const row={description:desc,amount:amt,currency:val("y-cur"),date:val("y-date")||today(),envelope_id:val("y-env")||null,receipt_link:val("y-rec"),payee:val("y-payee"),supplier_id:val("y-sup")||null,project:val("y-proj"),category:val("y-cat")||null,kind:val("y-kind")||"Expense",request_id:val("y-req")||null,fiscal:val("y-fis")||"Not checked",notes:val("y-notes"),
      funding:from.startsWith("acc:")?"Company":"Personal",account_id:from.startsWith("acc:")?from.slice(4):null,payer:from.startsWith("for:")?from.slice(4):(from==="me"?S.email:null)};
    if(id)return run(()=>sb.from("payments").update(row).eq("id",id),"Saved",["payments"]);
    return run(()=>sb.from("payments").insert(Object.assign({id:"new"},row)),"Payment recorded",["payments","requests"])})]);preview()}
function paymentEvidence(p){openDlg("Evidence · "+p.id,h("div",{class:"fg"},field("pe-r","Receipt link","url",p.receipt_link,{full:true}),field("pe-f","Fiscal receipt (EFD/VFD)","select",p.fiscal,{options:FISCAL,blank:false}),field("pe-s","Supplier (if registered)","select",p.supplier_id,{options:supOptions(),blank:"None"}),field("pe-n","Notes","textarea",p.notes,{full:true})),
  [saveBtn("Save",()=>run(()=>sb.from("payments").update({receipt_link:val("pe-r"),fiscal:val("pe-f"),supplier_id:val("pe-s")||null,notes:val("pe-n")}).eq("id",p.id),"Saved",["payments"]))])}
function decidePayment(p,decision){openDlg((decision==="Approved"?"Approve ":"Reject ")+p.id,h("div",{style:"display:grid;gap:10px"},h("div",{class:"rule"},h("b",null,p.description),paidFrom(p)+" · "+money(p.amount,p.currency)+" · "+fmtDate(p.date)),
  p.receipt_link&&/^https?:/.test(p.receipt_link)?h("a",{href:p.receipt_link,target:"_blank",rel:"noopener"},"Open the receipt before deciding"):null,field("dp-c",decision==="Rejected"?"Reason for rejection (required)":"Comment (optional)","textarea","",{rows:3})),
  [saveBtn(decision==="Approved"?"Approve":"Reject",async()=>{const cm=val("dp-c");if(decision==="Rejected"&&!cm){toast("Give a reason.");return false}return run(()=>sb.rpc("decide_payment",{p_id:p.id,p_decision:decision,p_comment:cm}),decision,["payments"])})])}

/* ---- import from the expenditure tracker (admin) ---- */
function parseCSV(t){const rows=[];let row=[],f="",q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=c}else if(c==='"')q=true;else if(c===","||c==="\t"){row.push(f);f=""}else if(c==="\n"){row.push(f);rows.push(row);row=[];f=""}else if(c!=="\r")f+=c}if(f||row.length){row.push(f);rows.push(row)}return rows.filter(r=>r.some(x=>x.trim()))}
function toISO(d){d=String(d||"").trim();if(/^\d{4}-\d{2}-\d{2}/.test(d))return d.slice(0,10);const m=d.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);if(m){const y=m[3].length===2?"20"+m[3]:m[3];return y+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0")}const x=new Date(d);return isNaN(x)?"":x.toISOString().slice(0,10)}
function importTracker(){const FIELDS=[["tracker_id","Record ID",/record|^id$|ref/i],["date","Date",/date/i],["description","What / purpose",/purpose|description|item|detail/i],["payee","Paid to",/payee|supplier|vendor|paid to/i],["amount","Amount",/amount|total|value/i],["currency","Currency",/curr/i],["category","Category",/categ|budget line/i],["project","Project",/project|activity/i],["paid","Payment type (paid personally?)",/payment status|paid|method/i],["account","Account used",/account|wallet|source/i],["payer","Paid by",/payer|paid by/i],["approval","Approval status",/approv(al)? status|^approval$/i],["receipt","Evidence link",/url|link|evidence|file/i]];
  let data=[];const map={};const mapBox=h("div",{class:"fg"});const prev=h("div",{class:"small"});
  const accFor=a=>{a=String(a||"").toLowerCase();const hit=Object.values(S.accounts).find(x=>x.name&&a&&(a.includes(x.name.toLowerCase())||x.name.toLowerCase().includes(a)));if(a.includes("founder"))return "ACC-05";if(a.includes("pesapal"))return "ACC-02";if(a.includes("joseph"))return "ACC-07";if(a.includes("visa")||a.includes("card"))return "ACC-08";if(a.includes("hamis"))return "ACC-06";return hit?hit.id:""};
  const payerFor=t=>{t=String(t||"").toLowerCase();const m=Object.values(S.members).find(x=>x.full_name&&t.includes(x.full_name.split(" ")[0].toLowerCase()));return m?m.email:""};
  function build(){const hdr=data[0]||[];mapBox.replaceChildren(...FIELDS.map(([k,l,re])=>{if(map[k]===undefined){const i=hdr.findIndex(x=>re.test(x));map[k]=i}return h("label",{class:"f"},l,h("select",{onchange:e=>{map[k]=Number(e.target.value);show()}},h("option",{value:"-1"},"(not in file)"),hdr.map((x,i)=>h("option",{value:i,selected:map[k]===i?true:null},x||"Column "+(i+1)))))}));show()}
  function rowsOut(){const g=(r,k)=>map[k]>=0?String(r[map[k]]||"").trim():"";return data.slice(1).map(r=>{const acc=accFor(g(r,"account"));const personal=/personal/i.test(g(r,"paid"))||(acc&&(S.accounts[acc]||{}).holder==="Personal");
    return{tracker_id:g(r,"tracker_id"),date:toISO(g(r,"date")),description:g(r,"description"),payee:g(r,"payee"),amount:Number(g(r,"amount").replace(/[^0-9.\-]/g,"")),currency:/usd/i.test(g(r,"currency"))?"USD":"TZS",category:g(r,"category"),project:g(r,"project"),
      funding:personal?"Personal":"Company",account_id:acc,payer:personal?(payerFor(g(r,"payer"))||payerFor(g(r,"account"))||""):"",receipt_link:/^https?:/.test(g(r,"receipt"))?g(r,"receipt"):"",approved:/approved/i.test(g(r,"approval")),notes:"Imported from the expenditure tracker. Account in tracker: "+(g(r,"account")||"not recorded")+"; paid by: "+(g(r,"payer")||"not recorded")}}).filter(x=>x.tracker_id&&x.amount>0&&x.date)}
  function show(){const out=rowsOut();const dup=out.filter(x=>Object.values(S.payments).some(p=>p.tracker_id===x.tracker_id)).length;
    prev.replaceChildren(h("b",null,out.length+" rows ready"),", "+dup+" already in the platform (they will be skipped). ",out.slice(0,3).map(x=>h("div",{class:"muted"},x.tracker_id+" · "+x.date+" · "+x.description+" · "+money(x.amount,x.currency)+" · "+x.funding)))}
  const file=h("input",{type:"file",accept:".csv,.tsv,.txt",onchange:async e=>{const f=e.target.files[0];if(!f)return;data=parseCSV(await f.text());build()}});
  const paste=h("textarea",{rows:3,placeholder:"…or paste the rows here, including the header row",oninput:e=>{data=parseCSV(e.target.value);build()}});
  openDlg("Import from the expenditure tracker",h("div",{style:"display:grid;gap:12px"},
    h("p",{class:"small muted",style:"margin:0"},"In Excel, open the tracker's expenses sheet → File → Save As → CSV. Upload it here, check the column matches, then import. Rows already imported (same Record ID) are skipped. Imported personal payments do not change Who we owe; the opening balances already cover them."),
    h("label",{class:"f"},"CSV file",file),paste,mapBox,prev),[saveBtn("Import",async()=>{const out=rowsOut();if(!out.length){toast("Nothing to import yet.");return false}
      const res=await run(()=>sb.rpc("import_payments",{p_rows:out}),null,["payments"]);if(res&&res.data!=null)toast(res.data+" payments imported");return !!res})])}

/* ---- spending overview ---- */
function spendRows(m){return Object.values(S.payments).filter(p=>monthOf(p.date)===m&&p.status!=="Rejected"&&!p.opening)}
function lastMonths(n){const out=[];const d=new Date(month+"-01T00:00:00");for(let i=n-1;i>=0;i--){const x=new Date(d.getFullYear(),d.getMonth()-i,1);out.push(x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0"))}return out}
const monthName=m=>new Date(m+"-01T00:00:00").toLocaleDateString("en-GB",{month:"long",year:"numeric"});
function groupSum(rows,key){const g={};rows.forEach(p=>{const k=key(p)||"Not set";g[k]=(g[k]||0)+(toTzs(p.amount,p.currency,p.date)||0)});return Object.entries(g).sort((a,b)=>b[1]-a[1])}
function barList(title,pairs,total,limit){const top=pairs.slice(0,limit||8);const rest=pairs.slice(limit||8).reduce((t,x)=>t+x[1],0);if(rest>0)top.push(["Other",rest]);const max=Math.max(1,...top.map(x=>x[1]));
  return h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,title)),!top.length?empty("No spending this month."):h("div",{style:"padding:12px 16px;display:grid;gap:10px"},top.map(([k,v])=>h("div",null,
    h("div",{class:"kv"},h("span",{style:"color:var(--ink);font-weight:600;min-width:0;overflow-wrap:anywhere"},k),h("span",{class:"num"},tzs(v)+(total?" · "+Math.round(v/total*100)+"%":""))),
    h("div",{class:"envbar"},h("i",{style:"width:"+(v/max*100)+"%"}))))))}
function vSpending(){const rows=spendRows(month);const total=rows.reduce((t,p)=>t+(toTzs(p.amount,p.currency,p.date)||0),0);
  const prevM=lastMonths(2)[0];const prevTotal=spendRows(prevM).reduce((t,p)=>t+(toTzs(p.amount,p.currency,p.date)||0),0);
  const personal=rows.filter(p=>p.funding==="Personal").reduce((t,p)=>t+(toTzs(p.amount,p.currency,p.date)||0),0);
  const pending=rows.filter(p=>p.status==="Submitted");const withReceipt=rows.filter(p=>/^https?:/.test(p.receipt_link||"")).length;
  const fiscalOk=rows.filter(p=>["Verified","Exception approved"].includes(p.fiscal)).length;
  const months=lastMonths(6).map(m=>[m,spendRows(m).reduce((t,p)=>t+(toTzs(p.amount,p.currency,p.date)||0),0)]);const mmax=Math.max(1,...months.map(x=>x[1]));
  const allMonths=[...new Set(Object.values(S.payments).map(p=>monthOf(p.date)).filter(Boolean).concat([new Date().toISOString().slice(0,7)]))].sort().reverse();
  const change=prevTotal?Math.round((total-prevTotal)/prevTotal*100):null;
  return [header("Spending overview","What TUSOME spent in "+monthName(month)+", from company accounts and staff's own money. Amounts in TZS at the approval FX rate; rejected payments excluded.",
      h("select",{"aria-label":"Month",class:"btn",onchange:e=>{month=e.target.value;render()}},allMonths.map(m=>h("option",{value:m,selected:m===month?true:null},monthName(m)))),
      h("button",{class:"btn",onclick:()=>exportCSV(rows)},"Export CSV")),
    h("div",{class:"tiles"},tile(tzs(total),"Spent in "+monthName(month)+(change!=null?" · "+(change>=0?"+":"")+change+"% vs "+monthName(prevM):"")),tile(rows.length,"Payments"),
      tile(total?Math.round(personal/total*100)+"%":"—","Paid with personal money ("+tzs(personal)+")"),tile(pending.length,"Awaiting approval",()=>{ptab="waiting";go("payments")}),
      tile(rows.length?Math.round(withReceipt/rows.length*100)+"%":"—","Have a receipt link"),tile(rows.length?Math.round(fiscalOk/rows.length*100)+"%":"—","Fiscal receipt verified")),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Last 6 months")),h("div",{style:"padding:14px 16px;display:grid;grid-template-columns:repeat(6,1fr);gap:10px;align-items:end;height:190px"},
      months.map(([m,v])=>h("button",{style:"display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;gap:4px;height:100%;border:0;background:none;cursor:pointer;padding:0;min-width:0",onclick:()=>{month=m;render()},"aria-label":monthName(m)+": "+tzs(v)},
        h("span",{class:"small num",style:"text-align:center;font-size:11px;color:var(--muted)"},v?(v>=1e6?(v/1e6).toFixed(1)+"m":Math.round(v/1e3)+"k"):"0"),
        h("span",{style:"display:block;border-radius:4px 4px 0 0;background:"+(m===month?"var(--brand)":"var(--line)")+";height:"+Math.max(2,v/mmax*120)+"px"}),
        h("span",{class:"small",style:"text-align:center;font-weight:"+(m===month?"700":"500")},new Date(m+"-01T00:00:00").toLocaleDateString("en-GB",{month:"short"})))))),
    h("div",{class:"grid2"},barList("By category",groupSum(rows,p=>p.category),total),barList("By project",groupSum(rows,p=>p.project),total),
      barList("By envelope",groupSum(rows,p=>(S.envelopes[p.envelope_id]||{}).name||"No envelope"),total),barList("Top payees",groupSum(rows,p=>p.payee||(S.suppliers[p.supplier_id]||{}).name),total,6),
      barList("Paid from",groupSum(rows,paidFrom),total),barList("By type",groupSum(rows,p=>p.kind),total)),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Largest payments")),!rows.length?empty("No payments in this month."):
      T([{l:"What",primary:true},{l:"Date"},{l:"Paid to"},{l:"Paid from"},{l:"Amount",num:true},{l:"Status"}],rows.slice().sort((a,b)=>(toTzs(b.amount,b.currency,b.date)||0)-(toTzs(a.amount,a.currency,a.date)||0)).slice(0,10).map(p=>[p.description,fmtDate(p.date),p.payee||"—",paidFrom(p),money(p.amount,p.currency),pill(PAY_LABEL[p.status],PAY_PILL[p.status])]),
        i=>{const list=rows.slice().sort((a,b)=>(toTzs(b.amount,b.currency,b.date)||0)-(toTzs(a.amount,a.currency,a.date)||0));return ()=>showPayment(list[i].id)}))]}
function exportCSV(rows){const cols=["id","tracker_id","date","description","payee","amount","currency","amount_tzs","kind","category","project","envelope","funding","paid_from","status","approval_basis","fiscal","receipt_link","recorded_by"];
  const esc=v=>{v=v==null?"":String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const lines=[cols.join(",")].concat(rows.map(p=>[p.id,p.tracker_id,p.date,p.description,p.payee,p.amount,p.currency,Math.round(toTzs(p.amount,p.currency,p.date)||0),p.kind,p.category,p.project,(S.envelopes[p.envelope_id]||{}).name,p.funding,paidFrom(p),p.status,p.approval_basis,p.fiscal,p.receipt_link,p.recorded_by].map(esc).join(",")));
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/csv"}));a.download="tusome-payments-"+month+".csv";document.body.append(a);a.click();a.remove()}

/* ---- who we owe ---- */
function vOwed(){const people=owedByPerson().filter(p=>Object.keys(p.owed).length||Object.keys(p.pending).length||Object.keys(p.paid).length).sort((a,b)=>toTzsSum(b.owed)-toTzsSum(a.owed));
  const canPay=hasAny(["custodian","admin"]);const reimbs=Object.values(S.reimbursements).sort((a,b)=>(b.date+b.id).localeCompare(a.date+a.id));
  const totalOwed={};people.forEach(p=>Object.entries(p.owed).forEach(([c,v])=>totalOwed[c]=(totalOwed[c]||0)+v));
  return [header("Who we owe",(seesAllClaims()?"Money staff paid personally for TUSOME, approved but not yet paid back. ":"What TUSOME owes you. ")+"Pay back in full or in part.",newBtn("Record a payment",()=>editPayment())),
    h("div",{class:"tiles"},tile(fmtByCur(totalOwed),seesAllClaims()?"Total owed to staff":"Owed to you"),tile(fmtByCur(people.reduce((o,p)=>{Object.entries(p.pending).forEach(([c,v])=>o[c]=(o[c]||0)+v);return o},{})),"Personal payments awaiting approval"),tile(reimbs.length,"Repayments recorded")),
    h("section",{class:"panel"},!people.length?empty("Nobody is owed anything."):
      T([{l:"Person",primary:true},{l:"Owed now",num:true},{l:"Awaiting approval",num:true},{l:"Paid back so far",num:true},{l:""}],
        people.map(p=>[h("div",null,h("div",{style:"font-weight:700"},nameOf(p.who)),String(p.who).startsWith("name:")?h("div",{class:"small muted"},"No login"):null),fmtByCur(p.owed),fmtByCur(p.pending),fmtByCur(p.paid),
          h("span",{class:"row",style:"justify-content:flex-end"},canPay&&Object.values(p.owed).some(v=>v>0)&&p.who!==S.email?h("button",{class:"btn sm primary",onclick:e=>{e.stopPropagation();repay(p)}},"Pay back"):null,h("button",{class:"btn sm",onclick:e=>{e.stopPropagation();personItems(p)}},"Details"))]),i=>()=>personItems(people[i]))),
    h("section",{class:"panel"},h("div",{class:"ph"},h("h2",null,"Repayments")),!reimbs.length?empty("No repayments recorded yet."):
      T([{l:"Person",primary:true},{l:"Number",mono:true},{l:"Date"},{l:"Amount",num:true},{l:"From"},{l:"Reference"},{l:"Recorded by"}],reimbs.map(r=>[nameOf(r.claimant),r.id,fmtDate(r.date),money(r.amount,r.currency),(S.accounts[r.account_id]||{}).name||"—",r.reference||r.tracker_id||"—",nameOf(r.recorded_by)])))]}
function personItems(p){const reps=Object.values(S.reimbursements).filter(r=>r.claimant===p.who);
  openDlg(nameOf(p.who),h("div",{style:"display:grid;gap:12px"},h("div",{class:"rule"},h("b",null,"Owed now: "+fmtByCur(p.owed)),"Awaiting approval: "+fmtByCur(p.pending)+" · Paid back: "+fmtByCur(p.paid)),
    h("div",{class:"list"},p.items.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(x=>h("button",{class:"li",onclick:()=>showPayment(x.id)},h("div",null,h("div",{class:"t"},x.description),h("div",{class:"small muted"},x.id+" · "+fmtDate(x.date))),h("div",{style:"text-align:right"},h("div",{class:"num",style:"font-weight:700"},money(x.amount,x.currency)),pill(PAY_LABEL[x.status],PAY_PILL[x.status])))),
      reps.map(r=>h("div",{class:"li",style:"cursor:default"},h("div",null,h("div",{class:"t"},"Paid back"),h("div",{class:"small muted"},r.id+" · "+fmtDate(r.date))),h("div",{class:"num",style:"font-weight:700;color:var(--ok)"},"− "+money(r.amount,r.currency)))))),[])}
function repay(p){const curs=Object.keys(p.owed).filter(c=>p.owed[c]>0);const cur0=curs[0];
  const body=h("div",{class:"fg"},field("rp-cur","Currency","select",cur0,{options:curs,blank:false}),field("rp-amt","Amount paid back","number",p.owed[cur0],{hint:"Owed now: "+fmtByCur(p.owed)+". Change it for a part-payment."}),
    field("rp-d","Date paid","date",today()),field("rp-a","Paid from","select","",{options:Object.values(S.accounts).filter(a=>a.holder==="Company").map(a=>[a.id,a.name])}),field("rp-r","Reference (e.g. Selcom or bank reference)","text","",{full:true}));
  openDlg("Pay back "+nameOf(p.who),body,[saveBtn("Record repayment",()=>{const amt=n0(val("rp-amt"));if(!(amt>0)){toast("Enter the amount.");return false}
    return run(()=>sb.rpc("record_repayment",{p_person:p.who,p_amount:amt,p_currency:val("rp-cur"),p_date:val("rp-d")||today(),p_account:val("rp-a"),p_reference:val("rp-r")}),"Repayment recorded",["reimbursements"])})]);
  document.getElementById("rp-cur").addEventListener("change",e=>{document.getElementById("rp-amt").value=p.owed[e.target.value]})}

/* ---- envelopes ---- */
function vEnvelopes(){const list=Object.values(S.envelopes).sort((a,b)=>(a.status===b.status?0:a.status==="Active"?-1:1)||a.name.localeCompare(b.name));
  return [header("Envelopes","Budgets for each activity: how much is set aside, where the money comes from, and how much is already committed. Only administrators can create or change them.",newBtn("New envelope",()=>editEnvelope(),isAdmin())),
    !list.length?h("section",{class:"panel"},empty(isAdmin()?"No envelopes yet. Select “New envelope” to set the first activity budget.":"No envelopes yet. The Director sets them up.")):
    h("div",{class:"cards"},list.map(e=>{const u=envelopeUse(e);const pc=u.budget?Math.min(100,u.used/u.budget*100):0;
      return h("div",{class:"card",style:"cursor:pointer",onclick:()=>showEnvelope(e.id)},h("div",{class:"row",style:"justify-content:space-between"},h("div",{class:"t"},e.name),h("span",{class:"row",style:"gap:4px"},e.pre_approved?pill("Pre-approved","p-brand"):null,pill(e.status,e.status==="Active"?"p-ok":"p-mute"))),
        h("div",{class:"small muted"},[e.id,e.activity,e.project].filter(Boolean).join(" · ")),
        h("div",{class:"kv"},h("span",null,"Budget"),h("span",null,money(e.amount,e.currency))),h("div",{class:"kv"},h("span",null,"Committed"),h("span",null,tzs(u.used))),
        h("div",{class:"kv"},h("span",null,"Remaining"),h("span",{style:u.left<0?"color:var(--bad);font-weight:700":"font-weight:700"},tzs(u.left))),
        h("div",{class:"envbar"},h("i",{class:u.left<0?"over":"",style:"width:"+pc+"%"})),
        h("div",{class:"kv"},h("span",null,"Money from"),h("span",null,e.funding_source||"—")),h("div",{class:"kv"},h("span",null,"Held in"),h("span",null,(S.accounts[e.account_id]||{}).name||"—")))}))]}
function showEnvelope(id){const e=S.envelopes[id];const u=envelopeUse(e);
  openDlg(e.name,h("div",{style:"display:grid;gap:14px"},h("dl",null,h("dt",null,"Activity"),h("dd",null,e.activity||"—"),h("dt",null,"Project / client"),h("dd",null,e.project||"—"),h("dt",null,"Budget"),h("dd",null,money(e.amount,e.currency)),
      h("dt",null,"Money from"),h("dd",null,e.funding_source||"—"),h("dt",null,"Held in"),h("dd",null,(S.accounts[e.account_id]||{}).name||"—"),h("dt",null,"Period"),h("dd",null,(e.start_date?fmtDate(e.start_date):"—")+" to "+(e.end_date?fmtDate(e.end_date):"—")),
      h("dt",null,"Approval"),h("dd",null,e.pre_approved?"Pre-approved by "+nameOf(e.approved_by)+(e.approved_at?" on "+fmtDate(e.approved_at):"")+": spending inside it needs no separate approval":"Each purchase and payment needs approval"),h("dt",null,"Committed"),h("dd",null,tzs(u.used)+" ("+tzs(u.req)+" requests, "+tzs(u.cl)+" direct payments)"),h("dt",null,"Remaining"),h("dd",null,tzs(u.left)),e.notes?[h("dt",null,"Notes"),h("dd",null,e.notes)]:null),
    u.items.length?T([{l:"Item",primary:true},{l:"Type"},{l:"Number",mono:true},{l:"TZS",num:true}],u.items.map(x=>[x[2]||"—",x[0],x[1],tzs(x[3])])):h("div",{class:"small muted"},"Nothing charged to this envelope yet. Choose it on a purchase request or an expense claim.")),
    isAdmin()?[h("button",{class:"btn primary",onclick:()=>{dlg.close();editEnvelope(id)}},"Edit envelope")]:[])}
function editEnvelope(id){if(!isAdmin())return;const e=id?S.envelopes[id]:{currency:"TZS",status:"Active"};
  openDlg(id?"Edit "+e.name:"New envelope",h("div",{class:"fg"},field("e-n","Envelope name","text",e.name,{full:true,ph:"e.g. AI RCT Zanzibar endline"}),field("e-ac","Activity","text",e.activity),field("e-p","Project / client","text",e.project),
    field("e-a","Budget amount","number",e.amount),field("e-c","Currency","select",e.currency,{options:["TZS","USD"],blank:false}),field("e-f","Where the money comes from","text",e.funding_source,{full:true,ph:"e.g. Client payment, grant tranche 2, own funds"}),
    field("e-acc","Held in (bank or wallet)","select",e.account_id,{options:Object.values(S.accounts).map(a=>[a.id,a.name]),blank:"Not set"}),field("e-s","Status","select",e.status,{options:["Active","Closed"],blank:false}),
    field("e-sd","Start date","date",e.start_date),field("e-ed","End date","date",e.end_date),
    h("label",{class:"row",style:"grid-column:1/-1;gap:8px;font-weight:600;align-items:flex-start"},h("input",{id:"e-pre",type:"checkbox",checked:e.pre_approved?true:null}),h("span",null,"Pre-approved",h("span",{class:"hint",style:"display:block;font-weight:500"},"Purchases and payments inside this budget are approved automatically until it is used up. Quotations and receipts are still required."))),
    field("e-no","Notes","textarea",e.notes,{full:true})),
    [saveBtn("Save envelope",async()=>{const name=val("e-n");if(!name){toast("Name the envelope.");return false}
      const row={name,activity:val("e-ac"),project:val("e-p"),amount:n0(val("e-a")),currency:val("e-c"),funding_source:val("e-f"),account_id:val("e-acc")||null,status:val("e-s"),start_date:val("e-sd")||null,end_date:val("e-ed")||null,notes:val("e-no"),pre_approved:document.getElementById("e-pre").checked};
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
        h("div",{style:"padding:12px 16px"},h("dl",null,...["director","alt_director","approver","custodian","auditor"].flatMap(r=>[h("dt",null,ROLE_NAME[r]),h("dd",null,emailsWithRole(r).length?emailsWithRole(r).map(nameOf).join(", "):pill("Not assigned",r==="director"||r==="approver"?"p-bad":"p-mute"))])),
          h("p",{class:"small muted",style:"margin:10px 0 0"},"Requests: Band 1–2 need one Band 1–2 approver; Band 3 needs a Band 1–2 approver, then the Director. Payments not covered by an approved request or a pre-approved envelope: a Band 1–2 approver or the Director, and the Director above USD "+c.thresholdUsd.toLocaleString("en-GB")+". The alternate decides the Director's own items above that. Nobody approves their own."))),
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

/* ============ accounting ============ */
const seesBooks=()=>hasAny(["admin","director","alt_director","custodian","auditor"]);
const keepsBooks=()=>hasAny(["admin","custodian"]);
const GL_TYPES=["Asset","Liability","Equity","Income","Expense"];
let atab="pl", acc={from:null,to:null,asAt:null,project:"",account:"",preset:"month"};
function acctDefaults(){if(acc.from)return;const t=today();acc.to=t;acc.asAt=t;acc.from=t.slice(0,7)+"-01"}
function setPreset(p){const t=today(),d=new Date(t+"T00:00:00");acc.preset=p;
  if(p==="month"){acc.from=t.slice(0,7)+"-01";acc.to=t}
  else if(p==="last"){const a=new Date(d.getFullYear(),d.getMonth()-1,1),b=new Date(d.getFullYear(),d.getMonth(),0);acc.from=iso(a);acc.to=iso(b)}
  else if(p==="year"){acc.from=d.getFullYear()+"-01-01";acc.to=t}
  else if(p==="since"){acc.from="2026-10-01";acc.to=t}
  acc.asAt=acc.to;render()}
const iso=d=>d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const glName=c=>(S.gl[c]||{}).name||c;
const natural=t=>t==="Asset"||t==="Expense"?1:-1;   // debit-natural accounts
function linesIn(from,to,proj){return S.jlines.filter(l=>{const j=S.journals[l.journal_id];if(!j)return false;return (!from||j.date>=from)&&(!to||j.date<=to)&&(!proj||l.project===proj)})}
function balances(lines){const b={};lines.forEach(l=>{b[l.account_code]=(b[l.account_code]||0)+n0(l.debit)-n0(l.credit)});return b}
const fmtA=v=>{const r=Math.round(v);return r<0?"("+Math.abs(r).toLocaleString("en-GB")+")":r.toLocaleString("en-GB")};
function amtCell(v,bold){return h("span",{class:"num",style:(bold?"font-weight:800;":"")+(v<0?"color:var(--bad)":"")},fmtA(v))}
function reportTable(sections,cols){/* sections: [{title, rows:[[label,v1,v2..]], total:[label,v..]}] */
  const head=h("tr",null,h("th",null,""),cols.map(c=>h("th",{class:"num"},c)));const body=[];
  sections.forEach(s=>{if(s.title)body.push(h("tr",null,h("td",{colspan:cols.length+1,style:"font-weight:800;padding-top:16px;border-bottom:0"},s.title)));
    s.rows.forEach(r=>body.push(h("tr",{class:r.go?"click":null,onclick:r.go||null},h("td",{style:"padding-left:26px"},r[0]),r.slice(1).map(v=>h("td",{class:"num"},amtCell(v))))));
    if(s.total)body.push(h("tr",null,h("td",{style:"font-weight:800"},s.total[0]),s.total.slice(1).map(v=>h("td",{class:"num",style:"border-top:2px solid var(--ink)"},amtCell(v,true)))))});
  return h("div",{class:"tbl"},h("table",null,h("thead",null,head),h("tbody",null,body)))}
function prevPeriod(){const f=new Date(acc.from+"T00:00:00"),t=new Date(acc.to+"T00:00:00");const days=Math.round((t-f)/864e5)+1;
  if(acc.preset==="month"||acc.preset==="last"){const a=new Date(f.getFullYear(),f.getMonth()-1,1),b=new Date(f.getFullYear(),f.getMonth(),0);return [iso(a),iso(b)]}
  const b=new Date(f.getTime()-864e5),a=new Date(b.getTime()-(days-1)*864e5);return [iso(a),iso(b)]}
function pnl(from,to,proj){const b=balances(linesIn(from,to,proj));const acs=Object.values(S.gl);
  const inc=acs.filter(a=>a.type==="Income").map(a=>[a.code,-(b[a.code]||0)]).filter(x=>Math.abs(x[1])>0.5);
  const exp=acs.filter(a=>a.type==="Expense").map(a=>[a.code,b[a.code]||0]).filter(x=>Math.abs(x[1])>0.5);
  const ti=inc.reduce((t,x)=>t+x[1],0),te=exp.reduce((t,x)=>t+x[1],0);return{inc,exp,ti,te,net:ti-te}}
function projects(){return [...new Set(S.jlines.map(l=>l.project).filter(Boolean))].sort()}

function vAccounting(){if(!seesBooks())return [header("Accounting","Only administrators, the Director, the Finance custodian and the auditor can see the books.")];
  acctDefaults();const tabs=[["pl","Profit & loss"],["bs","Balance sheet"],["tb","Trial balance"],["gl","General ledger"],["jn","Journals"],["coa","Chart of accounts"]];
  const lock=(S.settings||{}).lock_date;
  const period=h("div",{class:"toolbar"},
    h("select",{"aria-label":"Period",onchange:e=>setPreset(e.target.value)},[["month","This month"],["last","Last month"],["since","Since 1 Oct 2026"],["year","This calendar year"],["custom","Custom dates"]].map(([k,l])=>h("option",{value:k,selected:acc.preset===k?true:null},l))),
    atab==="bs"||atab==="tb"?h("label",{class:"row small",style:"gap:6px"},"As at",h("input",{type:"date",value:acc.asAt,onchange:e=>{acc.asAt=e.target.value;render()}})):
      [h("label",{class:"row small",style:"gap:6px"},"From",h("input",{type:"date",value:acc.from,onchange:e=>{acc.from=e.target.value;acc.preset="custom";render()}})),h("label",{class:"row small",style:"gap:6px"},"To",h("input",{type:"date",value:acc.to,onchange:e=>{acc.to=e.target.value;acc.preset="custom";render()}}))],
    atab==="pl"||atab==="gl"?h("select",{"aria-label":"Project",onchange:e=>{acc.project=e.target.value;render()}},h("option",{value:""},"All projects"),projects().map(p=>h("option",{value:p,selected:acc.project===p?true:null},p))):null);
  const body={pl:aPL,bs:aBS,tb:aTB,gl:aGL,jn:aJN,coa:aCOA}[atab]();
  return [header("Accounting","Double-entry books in TZS. Approved payments, repayments and opening balances post automatically; other entries are made as journals."+(lock?" Books locked up to "+fmtDate(lock)+".":""),
      keepsBooks()?h("button",{class:"btn primary",onclick:()=>editJournal()},"New journal"):null,isAdmin()?h("button",{class:"btn",onclick:setLock},lock?"Lock date: "+fmtDate(lock):"Lock the books"):null),
    S.glMissing?h("div",{class:"banner"},h("b",null,"Database update needed. "),"Run supabase/011_accounting_core.sql in Supabase to switch on the books."):null,
    h("section",{class:"panel"},h("div",{class:"tabs",role:"tablist"},tabs.map(([k,l])=>h("button",{role:"tab","aria-selected":atab===k?"true":"false",onclick:()=>{atab=k;render()}},l))),["jn","coa"].includes(atab)?null:period,body)]}
function aPL(){const cur=pnl(acc.from,acc.to,acc.project);const[pf,pt]=prevPeriod();const prv=pnl(pf,pt,acc.project);const pv=(list,c)=>((list.find(x=>x[0]===c)||[0,0])[1]);
  const codes=(a,b)=>[...new Set(a.map(x=>x[0]).concat(b.map(x=>x[0])))].sort();
  const cols=[fmtDate(acc.from)+" – "+fmtDate(acc.to),fmtDate(pf)+" – "+fmtDate(pt)];
  const go=c=>()=>{acc.account=c;atab="gl";render()};
  return h("div",null,reportTable([
    {title:"Income",rows:codes(cur.inc,prv.inc).map(c=>Object.assign([c+" "+glName(c),pv(cur.inc,c),pv(prv.inc,c)],{go:go(c)})),total:["Total income",cur.ti,prv.ti]},
    {title:"Expenses",rows:codes(cur.exp,prv.exp).map(c=>Object.assign([c+" "+glName(c),pv(cur.exp,c),pv(prv.exp,c)],{go:go(c)})),total:["Total expenses",cur.te,prv.te]},
    {title:null,rows:[],total:[cur.net>=0?"Net profit":"Net loss",cur.net,prv.net]}],cols),
    !cur.ti?h("div",{class:"small muted",style:"padding:0 16px 14px"},"No income is recorded yet. Client invoices and receipts come in the next phase; until then a receipt can be posted as a journal (for example Dr 1020 PesaPal, Cr 4000 Consulting income)."):null,
    h("div",{class:"row",style:"padding:0 16px 14px"},h("button",{class:"btn sm",onclick:()=>csvDownload("profit-and-loss",[["Account",cols[0],cols[1]],...cur.inc.concat(cur.exp).map(x=>[x[0]+" "+glName(x[0]),Math.round(x[1]),Math.round(pv(prv.inc.concat(prv.exp),x[0]))]),["Net",Math.round(cur.net),Math.round(prv.net)]])},"Export CSV")))}
function aBS(){const at=acc.asAt;const b=balances(linesIn(null,at));const acs=Object.values(S.gl).sort((a,c)=>a.code.localeCompare(c.code));
  const sec=(type,sign)=>acs.filter(a=>a.type===type).map(a=>[a.code,sign*(b[a.code]||0)]).filter(x=>Math.abs(x[1])>0.5);
  const A=sec("Asset",1),L=sec("Liability",-1),E=sec("Equity",-1);const earn=pnl(null,at).net;
  const tA=A.reduce((t,x)=>t+x[1],0),tL=L.reduce((t,x)=>t+x[1],0),tE=E.reduce((t,x)=>t+x[1],0)+earn;const go=c=>()=>{acc.account=c;atab="gl";acc.from="2000-01-01";acc.to=at;acc.preset="custom";render()};
  const diff=Math.round(tA-tL-tE);
  return h("div",null,reportTable([{title:"Assets",rows:A.map(x=>Object.assign([x[0]+" "+glName(x[0]),x[1]],{go:go(x[0])})),total:["Total assets",tA]},
    {title:"Liabilities",rows:L.map(x=>Object.assign([x[0]+" "+glName(x[0]),x[1]],{go:go(x[0])})),total:["Total liabilities",tL]},
    {title:"Equity",rows:E.map(x=>Object.assign([x[0]+" "+glName(x[0]),x[1]],{go:go(x[0])})).concat([["Current earnings (profit or loss to date)",earn]]),total:["Total equity",tE]},
    {title:null,rows:[],total:["Liabilities and equity",tL+tE]}],["As at "+fmtDate(at)]),
    h("div",{class:"small",style:"padding:0 16px 14px;color:"+(diff?"var(--bad)":"var(--ok)")},diff?"Out of balance by "+fmtA(diff)+". Report this.":"Assets equal liabilities plus equity."),
    (b["1020"]||0)<0||(b["1010"]||0)<0?h("div",{class:"banner",style:"margin:0 16px 14px"},"A bank account shows a negative balance because its opening balance and the money received into it are not recorded yet. Post the opening balance as a journal (Dr the bank, Cr 3900 Opening balance equity) and record receipts."):null)}
function aTB(){const at=acc.asAt;const b=balances(linesIn(null,at));const acs=Object.values(S.gl).filter(a=>Math.abs(b[a.code]||0)>0.5).sort((a,c)=>a.code.localeCompare(c.code));
  const rows=acs.map(a=>{const v=b[a.code];return [a.code,a.name,a.type,v>0?v:0,v<0?-v:0]});const td=rows.reduce((t,r)=>t+r[3],0),tc=rows.reduce((t,r)=>t+r[4],0);
  return h("div",null,T([{l:"Account",primary:true},{l:"Type"},{l:"Debit",num:true},{l:"Credit",num:true}],rows.map(r=>[r[0]+" "+r[1],r[2],r[3]?fmtA(r[3]):"",r[4]?fmtA(r[4]):""]).concat([[h("b",null,"Total"),"",h("b",null,fmtA(td)),h("b",null,fmtA(tc))]]),i=>i<rows.length?()=>{acc.account=rows[i][0];acc.from="2000-01-01";acc.to=at;acc.preset="custom";atab="gl";render()}:null),
    h("div",{class:"row",style:"padding:10px 16px"},h("span",{class:"small",style:"color:"+(Math.round(td-tc)?"var(--bad)":"var(--ok)")},Math.round(td-tc)?"Debits and credits differ by "+fmtA(td-tc):"Debits equal credits."),h("button",{class:"btn sm",onclick:()=>csvDownload("trial-balance-"+at,[["Code","Account","Type","Debit","Credit"],...rows.map(r=>[r[0],r[1],r[2],Math.round(r[3]),Math.round(r[4])])])},"Export CSV")))}
function aGL(){const acs=Object.values(S.gl).sort((a,b)=>a.code.localeCompare(b.code));if(!acc.account&&acs.length)acc.account=(acs.find(a=>a.code==="1020")||acs[0]).code;
  const a=S.gl[acc.account]||{};const open=balances(linesIn(null,new Date(new Date(acc.from+"T00:00:00").getTime()-864e5).toISOString().slice(0,10),acc.project))[acc.account]||0;
  const ls=linesIn(acc.from,acc.to,acc.project).filter(l=>l.account_code===acc.account).sort((x,y)=>{const jx=S.journals[x.journal_id],jy=S.journals[y.journal_id];return (jx.date+jx.id).localeCompare(jy.date+jy.id)});
  let run=open;const rows=ls.map(l=>{run+=n0(l.debit)-n0(l.credit);return [l,run]});const sign=natural(a.type);
  return h("div",null,h("div",{class:"toolbar"},h("select",{"aria-label":"Account",onchange:e=>{acc.account=e.target.value;render()}},acs.map(x=>h("option",{value:x.code,selected:x.code===acc.account?true:null},x.code+" "+x.name)))),
    h("div",{class:"small muted",style:"padding:8px 16px"},"Opening balance: "+fmtA(sign*open)+" · Closing balance: "+fmtA(sign*run)+(sign<0?" (credit balance shown as positive)":"")),
    !rows.length?empty("No entries for this account in the period."):T([{l:"Description",primary:true},{l:"Date"},{l:"Journal",mono:true},{l:"Debit",num:true},{l:"Credit",num:true},{l:"Balance",num:true}],
      rows.map(([l,b])=>{const j=S.journals[l.journal_id];return [h("div",null,h("div",null,l.description||j.memo),h("div",{class:"small muted"},[l.contact,l.project,l.currency!=="TZS"&&l.amount_fc?money(l.amount_fc,l.currency)+" @ "+n0(l.fx_rate).toLocaleString("en-GB",{maximumFractionDigits:2}):null].filter(Boolean).join(" · "))),fmtDate(j.date),j.id,n0(l.debit)?fmtA(l.debit):"",n0(l.credit)?fmtA(l.credit):"",fmtA(sign*b)]}),i=>()=>showJournal(rows[i][0].journal_id)))}
function aJN(){const list=Object.values(S.journals).sort((a,b)=>(b.date+b.id).localeCompare(a.date+a.id));const tot=id=>S.jlines.filter(l=>l.journal_id===id).reduce((t,l)=>t+n0(l.debit),0);
  const SRC={payment:"Payment",repayment:"Repayment",opening:"Opening balance",manual:"Manual journal",reversal:"Reversal"};
  return !list.length?empty("No journals yet."):T([{l:"Memo",primary:true},{l:"Date"},{l:"Journal",mono:true},{l:"Source"},{l:"Amount",num:true},{l:"Status"}],
    list.slice(0,400).map(j=>[j.memo,fmtDate(j.date),j.id,SRC[j.source]||j.source,fmtA(tot(j.id)),pill(j.status,j.status==="Posted"?"p-ok":"p-mute")]),i=>()=>showJournal(list[i].id))}
function showJournal(id){const j=S.journals[id];if(!j)return;const ls=S.jlines.filter(l=>l.journal_id===id);const acts=[];
  if(keepsBooks()&&j.status==="Posted"&&j.source!=="reversal")acts.push(h("button",{class:"btn danger",onclick:()=>{openDlg("Reverse "+j.id,h("div",{style:"display:grid;gap:10px"},h("div",{class:"rule"},"Posts an opposite entry dated today. "+(j.source==="payment"?"To change a payment, edit or reclassify the payment instead; it reposts automatically.":"")),field("rv-r","Reason (required)","text","",{full:true})),[saveBtn("Reverse",()=>{if(!val("rv-r")){toast("Give a reason.");return false}return run(()=>sb.rpc("reverse_journal",{p_id:j.id,p_reason:val("rv-r")}),"Reversed",["journals","journal_lines"])})])}},"Reverse"));
  if(j.source==="payment"&&S.payments[j.source_id])acts.push(h("button",{class:"btn",onclick:()=>showPayment(j.source_id)},"Open payment"));
  openDlg(j.id+" · "+fmtDate(j.date),h("div",{style:"display:grid;gap:12px"},h("div",null,h("b",null,j.memo),h("div",{class:"small muted"},(j.status==="Reversed"?"Reversed by "+j.reversed_by+" · ":"")+(j.reversal_of?"Reverses "+j.reversal_of+" · ":"")+"Posted by "+nameOf(j.created_by)+" · "+fmtTime(j.created_at))),
    T([{l:"Account",primary:true},{l:"Description"},{l:"Debit",num:true},{l:"Credit",num:true}],ls.map(l=>[l.account_code+" "+glName(l.account_code),[l.description,l.project].filter(Boolean).join(" · "),n0(l.debit)?fmtA(l.debit):"",n0(l.credit)?fmtA(l.credit):""]))),acts)}
function editJournal(){if(!keepsBooks())return;const lines=[{},{}];const box=h("div",{style:"display:grid;gap:8px"});const tot=h("div",{class:"rule"});
  const opts=Object.values(S.gl).filter(a=>a.active).sort((a,b)=>a.code.localeCompare(b.code)).map(a=>[a.code,a.code+" "+a.name]);
  function draw(){box.replaceChildren(...lines.map((l,i)=>h("div",{class:"qrow",style:"grid-template-columns:1.6fr .8fr .8fr auto"},
    h("label",{class:"f"},"Account",h("select",{onchange:e=>{l.account=e.target.value}},h("option",{value:""},"Choose…"),opts.map(([k,t])=>h("option",{value:k,selected:l.account===k?true:null},t)))),
    h("label",{class:"f"},"Debit",h("input",{type:"number",inputmode:"decimal",min:"0",step:"any",value:l.debit||"",oninput:e=>{l.debit=e.target.value;sum()}})),
    h("label",{class:"f"},"Credit",h("input",{type:"number",inputmode:"decimal",min:"0",step:"any",value:l.credit||"",oninput:e=>{l.credit=e.target.value;sum()}})),
    h("button",{class:"btn sm danger",type:"button",onclick:()=>{if(lines.length>2){lines.splice(i,1);draw()}}},"Remove"))),h("div",null,h("button",{class:"btn sm",type:"button",onclick:()=>{lines.push({});draw()}},"Add line")));sum()}
  function sum(){const d=lines.reduce((t,l)=>t+n0(l.debit),0),c=lines.reduce((t,l)=>t+n0(l.credit),0);tot.replaceChildren(h("b",{style:"color:"+(Math.abs(d-c)<0.005&&d>0?"var(--ok)":"var(--bad)")},"Debits "+fmtA(d)+" · Credits "+fmtA(c)),Math.abs(d-c)<0.005&&d>0?"Balanced.":"Debits must equal credits.")}
  draw();openDlg("New journal",h("div",{class:"fg"},field("j-d","Date","date",today()),field("j-p","Project (optional)","text",""),field("j-m","Description","text","",{full:true,ph:"e.g. Opening balance PesaPal at 1 Oct 2026"}),h("div",{style:"grid-column:1/-1"},box),h("div",{style:"grid-column:1/-1"},tot),
    h("div",{class:"small muted",style:"grid-column:1/-1"},"Amounts in TZS. Examples: opening bank balance (Dr 1020 PesaPal, Cr 3900); client receipt (Dr 1020, Cr 4000); bank charges (Dr 6800, Cr 1020).")),
    [saveBtn("Post journal",()=>{const ls=lines.filter(l=>l.account&&(n0(l.debit)||n0(l.credit))).map(l=>({account:l.account,debit:n0(l.debit),credit:n0(l.credit),description:val("j-m"),project:val("j-p")}));
      if(ls.length<2){toast("Add at least two lines.");return false}return run(()=>sb.rpc("post_manual_journal",{p_date:val("j-d")||today(),p_memo:val("j-m"),p_lines:ls}),"Journal posted",["journals","journal_lines"])})])}
function aCOA(){const b=balances(S.jlines);const acs=Object.values(S.gl).sort((a,c)=>a.code.localeCompare(c.code));
  return h("div",null,isAdmin()?h("div",{class:"toolbar"},h("button",{class:"btn sm primary",onclick:()=>editGL()},"Add account"),h("button",{class:"btn sm",onclick:editMap},"Category mapping")):null,
    GL_TYPES.map(t=>h("div",null,h("div",{style:"padding:12px 16px 4px;font-weight:800"},t+(t==="Asset"||t==="Liability"||t==="Equity"?" (balance sheet)":" (profit & loss)")),
      T([{l:"Account",primary:true},{l:"Code",mono:true},{l:"Detail"},{l:"Balance",num:true},{l:"Status"}],acs.filter(a=>a.type===t).map(a=>[a.name,a.code,[a.subtype,a.bank_account_id?(S.accounts[a.bank_account_id]||{}).name:null].filter(Boolean).join(" · ")||"—",fmtA(natural(a.type)*(b[a.code]||0)),a.active?(a.system?pill("System","p-mute"):pill("Active","p-ok")):pill("Inactive","p-bad")]),
        i=>{const a=acs.filter(x=>x.type===t)[i];return ()=>{if(isAdmin())editGL(a.code);else{acc.account=a.code;atab="gl";render()}}}))))}
function editGL(code){const a=code?S.gl[code]:{type:"Expense",active:true};
  openDlg(code?"Account "+code:"Add account",h("div",{class:"fg"},field("g-c","Code","text",a.code,{hint:code?"Codes cannot change.":"e.g. 6610"}),field("g-n","Name","text",a.name),field("g-t","Type","select",a.type,{options:GL_TYPES,blank:false}),field("g-s","Detail type","text",a.subtype,{ph:"e.g. Bank, Overhead, Fixed asset"}),
    field("g-b","Linked bank or wallet","select",a.bank_account_id,{options:Object.values(S.accounts).map(x=>[x.id,x.name]),blank:"None"}),field("g-d","Description","text",a.description,{full:true}),
    h("label",{class:"row",style:"grid-column:1/-1;gap:8px;font-weight:600"},h("input",{id:"g-a",type:"checkbox",checked:a.active?true:null,disabled:a.system?true:null}),"Active"+(a.system?" (system account)":""))),
    [saveBtn("Save account",()=>{const c=code||val("g-c");if(!/^\d{3,6}$/.test(c)){toast("Use a numeric code of 3 to 6 digits.");return false}if(!val("g-n")){toast("Name the account.");return false}
      const row={name:val("g-n"),type:val("g-t"),subtype:val("g-s"),bank_account_id:val("g-b")||null,description:val("g-d"),active:document.getElementById("g-a").checked};
      if(code){document.getElementById("g-c").disabled=true;return run(()=>sb.from("gl_accounts").update(row).eq("code",code),"Account saved",["gl_accounts"])}
      return run(()=>sb.from("gl_accounts").insert(Object.assign({code:c},row)),"Account added",["gl_accounts"])})]);if(code)document.getElementById("g-c").disabled=true}
function editMap(){const opts=Object.values(S.gl).filter(a=>a.active&&a.type==="Expense").sort((a,b)=>a.code.localeCompare(b.code)).map(a=>[a.code,a.code+" "+a.name]);
  openDlg("Category mapping",h("div",{class:"fg"},h("p",{class:"small muted",style:"grid-column:1/-1;margin:0"},"Which expense account each workplan category posts to. Changes apply to payments approved from now on."),
    CATS.map((c,i)=>field("m-"+i,c,"select",S.glmap[c],{options:opts,blank:false,full:true}))),
    [saveBtn("Save mapping",async()=>{for(let i=0;i<CATS.length;i++){const v=val("m-"+i);if(v&&v!==S.glmap[CATS[i]]){const r=await run(()=>sb.from("gl_category_map").upsert({category:CATS[i],account_code:v}),null,["gl_category_map"]);if(!r)return false}}toast("Mapping saved")})])}
function setLock(){const l=(S.settings||{}).lock_date;openDlg("Lock the books",h("div",{class:"fg"},h("p",{class:"small muted",style:"grid-column:1/-1;margin:0"},"Nothing dated on or before the lock date can be posted, approved or reversed. Lock each month once it is reconciled and reviewed."),
  field("lk-d","Lock up to and including","date",l||"",{full:true,hint:"Clear the date to unlock."})),[saveBtn("Save lock date",()=>run(()=>sb.rpc("set_lock_date",{p_date:val("lk-d")||null}),val("lk-d")?"Books locked to "+fmtDate(val("lk-d")):"Books unlocked",["settings"]))])}
function csvDownload(name,rows){const esc=v=>{v=v==null?"":String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([rows.map(r=>r.map(esc).join(",")).join("\n")],{type:"text/csv"}));a.download="tusome-"+name+".csv";document.body.append(a);a.click();a.remove()}

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
  if(cw&&approvedAll(r)&&!r.payment)acts.push(h("button",{class:r.invoice||r.envelopeCovered?"btn primary":"btn",onclick:()=>editPayment(null,{request_id:r.id,description:r.title,amount:r.invoice?r.invoice.amount:r.amount,currency:r.currency,supplier_id:r.supplierId,payee:(S.suppliers[r.supplierId]||{}).name,project:r.project,category:r.category,envelope_id:r.envelopeId,funding:"Company"})},"Record payment"));
  if(cw&&(r.invoice||r.payment||r.retro))acts.push(h("button",{class:"btn",onclick:()=>editEvidence(r)},"Evidence & tax"));
  const hist=S.audit.filter(x=>x.row_id===r.id||(x.table_name==="approvals"&&(x.new_data||{}).request_id===r.id));
  const link=(u,t)=>u?h("a",{href:u,target:"_blank",rel:"noopener"},t||"Open file"):null;const env=S.envelopes[r.envelopeId];
  const body=h("div",{class:"sh-body"},
    r.historical?h("div",{class:"banner info"},h("b",null,"Historical record. "),"Paid before the platform started and treated as approved on import (20 Nov 2026). "+(r.notes||"")):r.retro?h("div",{class:"banner"},h("b",null,"Retrospective entry. "),r.notes||""):null,
    acts.length?h("div",{class:"row"},acts):null,
    ck.length?h("div",{class:"sec"},h("h3",null,"Issues"),h("ul",{class:"small",style:"margin:0;padding-left:18px"},ck.map(c=>h("li",null,h("b",null,c[0]),": "+c[1])))):null,
    h("div",{class:"sec"},h("h3",null,"Approval chain"),h("div",{class:"chain"},
      h("div",{class:"step done"},h("div",{class:"dot"},"✓"),h("div",null,h("div",{class:"st"},"Raised by "+nameOf(r.requester)),h("div",{class:"small muted"},fmtDate(r.date)+(r.submittedAt?" · submitted "+fmtTime(r.submittedAt):" · not submitted")+(r.rev>1?" · revision "+r.rev:"")))),
      ch.map(x=>h("div",{class:"step "+(x.s==="done"?"done":x.s==="rej"?"rej":x.s==="now"?"now":"")},h("div",{class:"dot"},x.s==="done"?"✓":x.s==="rej"?"✕":""),h("div",null,h("div",{class:"st"},STEP_NAME[x.step]),
        h("div",{class:"small muted"},x.env?"Covered by pre-approved envelope "+((S.envelopes[r.envelopeId]||{}).name||r.envelopeId):x.dec?(x.dec.decision+" by "+nameOf(x.dec.by_email)+" on "+fmtTime(x.dec.at)):x.s==="now"?"Waiting for "+(emailsWithRole(STEP_ROLE[x.step]).filter(e=>e!==r.requester).map(nameOf).join(" or ")||"an assigned person"):"Not yet reached"),x.dec&&x.dec.comment?h("div",{class:"small"},"“"+x.dec.comment+"”"):null))))),
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
      h("dt",null,"Payment"),h("dd",null,r.payment?money(r.payment.amount,r.currency)+" on "+fmtDate(r.payment.date)+" from "+((S.accounts[r.payment.account]||{}).name||r.payment.account||"—"):reqPayments(r).length?reqPayments(r).map(p=>h("div",null,h("a",{href:"#",onclick:e=>{e.preventDefault();showPayment(p.id)}},p.id),", "+money(p.amount,p.currency)+" on "+fmtDate(p.date)+" from "+paidFrom(p))):"—"),
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
const envOptions=cur=>Object.values(S.envelopes).filter(e=>e.status==="Active"||e.id===cur).map(e=>[e.id,e.name+(e.pre_approved?" · pre-approved":"")+" · "+tzs(envelopeUse(e).left)+" left"]);

function editRequest(id){if(!canWrite())return;const r=id?S.requests[id]:{currency:"TZS",date:today(),quotes:[]};const quotes=(r.quotes||[]).map(x=>Object.assign({},x));
  const qBox=h("div",{style:"display:grid;gap:8px"}),rule=h("div",{class:"rule"});
  function drawQ(){qBox.replaceChildren(...quotes.map((x,i)=>h("div",{class:"qrow"},
    h("label",{class:"f"},"Quote from",h("input",{value:x.supplier||"",oninput:e=>x.supplier=e.target.value})),h("label",{class:"f"},"Amount",h("input",{type:"number",inputmode:"decimal",step:"any",min:"0",value:x.amount==null?"":x.amount,oninput:e=>x.amount=e.target.value})),
    h("label",{class:"f"},"Link to quote (F02/F09)",h("input",{type:"url",value:x.link||"",oninput:e=>x.link=e.target.value})),h("button",{class:"btn sm danger",type:"button",onclick:()=>{quotes.splice(i,1);drawQ();preview()}},"Remove"))),
    h("div",null,h("button",{class:"btn sm",type:"button",onclick:()=>{quotes.push({});drawQ();preview()}},"Add quotation")))}
  function preview(){const t={amount:val("f-amt"),currency:val("f-cur")||"TZS",date:val("f-date")||today(),fxDate:val("f-fxd")};if(!(n0(t.amount)>0)){rule.replaceChildren("Enter the expected cost to see which rules apply.");return}
    const a=amounts(t),b=bandOf(a.tzs,a.usd),kind=val("f-kind");const env=S.envelopes[val("f-env")];const extra=kind.startsWith("Consultant")?" Consultant: signed ToR and contract before work starts, IP assigned to TUSOME, SAF-01 if working with children, withholding tax deducted.":kind.startsWith("Software")?" Subscription: a dated price page counts as the quote; check data-protection terms.":kind.startsWith("Event")?" Events and logistics should sit in the project's logistics plan.":"";
    const envNote=env?" Envelope "+env.name+": "+tzs(envelopeUse(env).left-(id&&r.envelopeId===env.id&&r.submitted?0:(a.tzs||0)))+" left after this.":"";
    rule.replaceChildren(h("b",null,"Band "+b+": "+bandText(b)),"About "+(a.tzs!=null?tzs(a.tzs):"—")+" / "+(a.usd!=null?money(a.usd,"USD"):"—")+". Needs "+b+" written quotation"+(b>1?"s":"")+" ("+quotes.length+" added). Approval: "+(env&&env.pre_approved&&envelopeUse(env).left>=(a.tzs||0)?"covered by the pre-approved envelope, no separate approval.":b===3?"Band 1–2 approver, then Director.":"Band 1–2 approver.")+envNote+extra)}
  drawQ();
  const more=h("div",{class:"fg",style:"grid-column:1/-1",hidden:!id});
  more.append(field("f-purpose","Business purpose","textarea",r.purpose,{full:true}),field("f-proj","Project / client","text",r.project),field("f-cat","Workplan category","select",r.category,{options:CATS}),field("f-kind","Type of purchase","select",r.kind,{options:KINDS}),
    field("f-date","Date raised","date",r.date),field("f-fxd","FX rate date","date",r.fxDate,{hint:"Blank uses the date raised."}),
    field("f-con","Contract ID (if any)","select",r.contractId,{options:Object.keys(S.contracts),blank:"None"}),field("f-f01","Link to F01 request form","url",r.f01),field("f-waiver","Quote waiver reason (only if approved)","text",r.waiver,{full:true}));
  const body=h("div",{class:"fg"},field("f-title","What do you need?","text",r.title,{full:true,ph:"e.g. Printing of endline test booklets"}),
    field("f-amt","Expected total cost","number",r.amount),field("f-cur","Currency","select",r.currency,{options:["TZS","USD"],blank:false}),
    field("f-sup","Supplier","select",r.supplierId,{options:supOptions(),blank:"Select supplier…",hint:"Not listed? Add it under Suppliers first."}),field("f-env","Envelope (budget)","select",r.envelopeId,{options:envOptions(r.envelopeId),blank:"None"}),
    h("div",{style:"grid-column:1/-1"},rule),h("div",{style:"grid-column:1/-1;display:grid;gap:6px"},h("div",{class:"f"},"Quotations"),qBox),
    h("button",{type:"button",class:"linkbtn",style:"grid-column:1/-1",onclick:e=>{more.hidden=!more.hidden;e.target.textContent=more.hidden?"More details (purpose, project, category, dates, contract)":"Hide details"}},more.hidden?"More details (purpose, project, category, dates, contract)":"Hide details"),more);
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
