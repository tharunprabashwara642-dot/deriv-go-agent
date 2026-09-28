import{analyze,profileFor,backtest,journalStats,streakLosses,suggestStake}from'./engine.js';
const $=i=>document.getElementById(i),now=()=>Date.now(),today=()=>new Date().toLocaleDateString('en-CA'),f2=x=>(x<0?'-':'')+'$'+Math.abs(x).toFixed(2);
const S={set:{appId:'1089',balance:5,riskPct:5,minStake:.35,maxStake:2,dailyLoss:1,maxConsec:3,cooldownMin:15,stakeOn:true,sound:true,wake:false,sym:'',exp:0},j:[],cool:{until:0,baseTs:0},price:[],times:[],last:0,n:0,gen:0,run:false,durs:[],active:null,prof:profileFor(),syms:[],acct:null,alertN:-999,evalT:0,sub:null,tok:null,lock:null,ac:null};
const NAMES={appId:'App ID',balance:'Balance (if no account)',riskPct:'Risk per trade %',minStake:'Min stake (check Deriv)',maxStake:'Max stake',dailyLoss:'Max daily loss $',maxConsec:'Max consecutive losses',cooldownMin:'Cooldown minutes'};
// ---- storage (IndexedDB) ----
const db=new Promise((ok,no)=>{const r=indexedDB.open('dtc',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const kvGet=async k=>{try{const d=await db;return await new Promise(ok=>{const q=d.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>ok(q.result);q.onerror=()=>ok()})}catch(e){err('Storage unavailable: '+e.message)}};
const kvSet=async(k,v)=>{try{const d=await db;await new Promise(ok=>{const t=d.transaction('kv','readwrite');t.objectStore('kv').put(JSON.parse(JSON.stringify(v)),k);t.oncomplete=ok;t.onerror=ok})}catch(e){err('Storage unavailable: '+e.message)}};
let errT;const err=m=>{$('err').textContent=m;clearTimeout(errT);errT=setTimeout(()=>$('err').textContent='',9000)};
// ---- WebSocket engine ----
class WS{constructor(){this.id=0;this.p=new Map();this.tries=0;this.state='connecting';this.mode='public';this.open()}
 url(){return this.mode==='public'?'wss://api.derivws.com/trading/v1/options/ws/public':`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(S.set.appId)}`}
 set(s){this.state=s;$('conn').textContent={connected:'● LIVE',connecting:'◌ CONNECTING',reconnecting:'◌ RECONNECTING',error:'✕ ERROR'}[s]||s}
 open(){this.set(this.tries?'reconnecting':'connecting');let ws;try{ws=this.ws=new WebSocket(this.url())}catch(e){err('WebSocket failed: '+e.message);return}
  ws.onopen=()=>{this.tries=0;this.set('connected');this.hb=setInterval(()=>this.send({ping:1}).catch(()=>{}),25000);this.onopen&&this.onopen()};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return err('Malformed message ignored')}
   const q=this.p.get(m.req_id);if(q){this.p.delete(m.req_id);clearTimeout(q.t);m.error?q.no(new Error(m.error.message)):q.ok(m)}else if(m.error)err('API error: '+m.error.message);else this.onmsg&&this.onmsg(m)};
  ws.onerror=()=>this.set('error');
  ws.onclose=()=>{clearInterval(this.hb);for(const q of this.p.values()){clearTimeout(q.t);q.no(new Error('Disconnected'))}this.p.clear();S.sub=null;this.set('reconnecting');setTimeout(()=>this.open(),Math.min(30000,1000*2**this.tries++))}}
 send(o){return new Promise((ok,no)=>{if(!this.ws||this.ws.readyState!==1)return no(new Error('Not connected'));const id=++this.id,t=setTimeout(()=>{this.p.delete(id);no(new Error('Request timed out'))},15000);this.p.set(id,{ok,no,t});this.ws.send(JSON.stringify({...o,req_id:id}))})}}
let ws;
// ---- market discovery & data ----
async function onOpen(){try{
 if(!S.syms.length){const r=await ws.send({active_symbols:'brief'});S.syms=(r.active_symbols||[]).filter(x=>/synthetic|derived/i.test(`${x.market||''} ${x.submarket||''} ${x.underlying_symbol_type||''} ${x.underlying_symbol_name||''}`)&&!x.is_trading_suspended);fillSyms()}
 if(S.tok)await auth(S.tok,true);
 if(S.set.sym)await load()}catch(e){err(e.message)}}
function fillSyms(){const s=$('sym'),g={};s.replaceChildren(new Option('Select market…',''));
 for(const x of S.syms)(g[x.submarket_display_name||x.submarket||x.market_display_name||x.market||'Synthetic / Derived']??=[]).push(x);
 for(const k of Object.keys(g).sort()){const og=document.createElement('optgroup');og.label=k;for(const x of g[k]){const symbol=x.symbol||x.underlying_symbol,name=x.display_name||x.underlying_symbol_name||symbol;og.append(new Option(name,symbol))}s.append(og)}
 if(!S.syms.length)err('No markets returned by Deriv');s.value=S.set.sym}
const rng=x=>{const a=/^(\d+)t$/.exec(x?.min_contract_duration||''),b=/^(\d+)t$/.exec(x?.max_contract_duration||'');return a&&b?[+a[1],+b[1]]:null};
async function load(){const g=++S.gen;S.price=[];S.times=[];S.active=null;S.n=0;S.last=0;S.durs=[];
 if(S.sub){ws.send({forget:S.sub}).catch(()=>{});S.sub=null}
 const sy=S.syms.find(x=>(x.symbol||x.underlying_symbol)===S.set.sym);if(!sy){fillExp();return}
 S.prof=profileFor([sy.submarket,sy.submarket_display_name,sy.display_name,sy.underlying_symbol_name,sy.market].filter(Boolean).join(' '));$('prof').textContent='Analysis profile: '+S.prof.name;
 try{const a=(await ws.send({contracts_for:sy.symbol})).contracts_for.available,up=a.filter(x=>x.contract_type==='CALL').map(rng).find(Boolean),dn=a.filter(x=>x.contract_type==='PUT').map(rng).find(Boolean);
  if(g!==S.gen)return;if(up&&dn){const lo=Math.max(up[0],dn[0]),hi=Math.min(up[1],dn[1]);S.durs=[3,5,7,10,15,20,30,50].filter(x=>x>=lo&&x<=hi)}
  if(!S.durs.includes(S.set.exp))S.set.exp=S.durs[0]||0;fillExp();if(!S.durs.length)err('No Rise/Fall tick durations reported for this market');
  const h=await ws.send({ticks_history:sy.symbol,end:'latest',count:3000,style:'ticks'});if(g!==S.gen)return;
  S.price=h.history.prices.map(Number);S.times=h.history.times.map(Number);
  const r=await ws.send({ticks:sy.symbol,subscribe:1});if(g!==S.gen){ws.send({forget:r.subscription?.id}).catch(()=>{});return}
  S.sub=r.subscription?.id;if(r.tick)addTick(r.tick)}catch(e){err(e.message)}}
function fillExp(){const s=$('exp');s.replaceChildren();for(const d of S.durs)s.append(new Option(d+' Ticks',d));if(!S.durs.length)s.append(new Option('Unavailable',''));s.value=S.set.exp}
function addTick(t){if(t.symbol!==S.set.sym)return;const e=+t.epoch;if(S.times.length&&e<=S.times.at(-1))return;S.price.push(+t.quote);S.times.push(e);if(S.price.length>3300){S.price.splice(0,300);S.times.splice(0,300)}S.last=now();S.n++;if(now()-S.evalT>400)evaluate()}
// ---- account (token kept in memory only) ----
async function auth(tok,quiet){try{S.tok=tok;if(ws.mode!=='legacy'){ws.mode='legacy';ws.tries=0;ws.ws?.close();return}const r=await ws.send({authorize:tok});S.acct={bal:+r.authorize.balance,cur:r.authorize.currency};renderAcct()}catch(e){S.tok=null;S.acct=null;renderAcct();err('Authentication error: '+e.message)}}
const bal=()=>S.acct?S.acct.bal:S.set.balance;
function renderAcct(){$('acct').textContent=S.acct?'Connected':'Not connected';$('bal').textContent=(S.acct?S.acct.cur+' ':'$')+bal().toFixed(2);$('bAcct').textContent=S.acct?'Disconnect account':'Connect account'}
// ---- risk ----
const dayJ=()=>S.j.filter(x=>x.day===today());
function risk(){const dj=dayJ(),pl=dj.reduce((s,x)=>s+x.pl,0),ls=streakLosses(dj.filter(x=>x.t>S.cool.baseTs));return{pl,ls,blocked:S.set.dailyLoss>0&&pl<=-S.set.dailyLoss}}
function record(e){S.j.push(e);kvSet('j',S.j);const r=risk();if(r.ls>=S.set.maxConsec){const u=now()+S.set.cooldownMin*60000;S.cool={until:u,baseTs:u};kvSet('cool',S.cool);S.active=null}}
// ---- evaluation ----
const ROWS=[['Historical Data','data'],['Live Tick Stream','live'],['Market Regime','regime'],['Trend','trend'],['Momentum','momentum'],['Structure','structure'],['Volatility','volatility'],['Microstructure','micro'],['Expiry Validation','expiry'],['Risk Check','risk']];
function evaluate(){S.evalT=now();const h=S.set.exp,cd=S.cool.until-now(),rk=risk();let R=null,sub='Waiting for a valid setup...',fresh='LIVE';
 const live=S.last&&now()-S.last<15000&&ws.state==='connected',ck={data:S.price.length>=200,live:!!live,risk:cd<=0&&!rk.blocked};
 if(!S.run)sub='Analysis stopped — press ANALYZE';
 else if(!navigator.onLine)sub='OFFLINE — LIVE MARKET ANALYSIS UNAVAILABLE';
 else if(!S.set.sym)sub='Select a market';
 else if(!h)sub='No supported tick expiry for this market — WAIT';
 else if(cd>0){S.active=null;const s=Math.ceil(cd/1000);sub=`COOLDOWN ACTIVE — ${S.set.maxConsec} consecutive losses recorded. Resume in ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
 else if(rk.blocked){S.active=null;sub='DAILY LOSS LIMIT REACHED — analysis paused until tomorrow'}
 else if(!ck.data&&S.price.length)sub='INSUFFICIENT_DATA — collecting history';
 else if(!live){S.active=null;fresh='STALE';sub='WAIT — MARKET DATA STALE'}
 else{R=analyze(S.price,h,S.prof);
  if(R.decision==='WAIT'){S.active=null;sub=R.state+' — '+R.why[0]}
  else if(!S.active||S.active.dir!==R.decision){if(S.n-S.alertN>=h){S.active={dir:R.decision,ts:new Date(),exp:h,why:R.why,n:R.n,total:R.total,ack:false,stake:S.set.stakeOn?suggestStake(bal(),S.set.riskPct,S.set.minStake,S.set.maxStake):null};S.alertN=S.n;alertUser()}else{S.active=null;sub='Signal suppressed (dedupe cooldown)'}}}
 render(R,ck,sub,fresh,rk)}
function render(R,ck,sub,fresh,rk){const A=S.active,dec=A?A.dir:'WAIT',c=R?R.checks:{};
 $('chk').replaceChildren(...ROWS.map(([n,k])=>{const v=k==='data'||k==='live'||k==='risk'?ck[k]:k==='expiry'?c.expiry&&c.sr:c[k],d=document.createElement('div');d.className='row';d.append(n,v===undefined?'–':v?'✓':'✗');return d}));
 $('dec').textContent=(A?(dec==='RISE'?'↑ ':'↓ '):'')+dec;$('dec').className=dec;$('card').className='c'+(A&&!A.ack?' sig':'');$('card').style.color=A?(dec==='RISE'?'var(--g)':'var(--r)'):'';
 $('sub').textContent=A?(A.ack?'Signal acknowledged':'Signal: VALID'):sub;$('sigb').hidden=!A;
 $('why').replaceChildren(...(A?A.why:[]).map(x=>{const l=document.createElement('li');l.textContent='✓ '+x;return l}));
 $('meta').textContent=A?`Expiry: ${A.exp} Ticks · Conditions ${A.n}/${A.total} satisfied · ${A.ts.toLocaleTimeString()} · Data: ${fresh}${A.stake?` · Suggested stake $${A.stake.v.toFixed(2)}${A.stake.note?' ('+A.stake.note+')':''}`:''}`:`Data: ${S.run?fresh:'—'}`;
 const m=R?R.m:{},lab=x=>x===1?'Bullish':x===-1?'Bearish':x===0?'Neutral':'—';
 $('dTr').textContent=lab(m.trend);$('dMo').textContent=lab(m.mom);$('dRe').textContent=m.regime||'—';$('dRs').textContent=m.rsi?.toFixed(1)??'—';$('dE9').textContent=m.e9?.toFixed(4)??'—';$('dE21').textContent=m.e21?.toFixed(4)??'—';
 $('rPL').textContent=f2(rk.pl);$('rLS').textContent=`${rk.ls} / ${S.set.maxConsec}`;$('rSt').textContent=S.cool.until>now()?'COOLDOWN':rk.blocked?'DAILY LIMIT':rk.ls>=S.set.maxConsec-1?'CAUTION':'SAFE';
 const sk=suggestStake(bal(),S.set.riskPct,S.set.minStake,S.set.maxStake);$('rSk').textContent=S.set.stakeOn?'$'+sk.v.toFixed(2)+(sk.note?' ⚠':''):'off'}
// ---- alerts, wake lock ----
function alertUser(){if(navigator.vibrate)navigator.vibrate([200,100,200]);if(!S.set.sound||!S.ac)return;try{const o=S.ac.createOscillator(),g=S.ac.createGain();o.connect(g);g.connect(S.ac.destination);g.gain.value=.15;o.frequency.value=880;o.start();o.stop(S.ac.currentTime+.25)}catch(e){err('Audio unavailable: '+e.message)}}
async function wake(){if(!S.set.wake)return;if(!('wakeLock'in navigator)){err('Wake Lock not supported in this browser');return}try{S.lock=await navigator.wakeLock.request('screen');S.lock.onrelease=()=>S.lock=null}catch(e){err('Wake Lock failed: '+e.message)}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&S.set.wake&&!S.lock)wake()});
// ---- UI wiring ----
const save=()=>kvSet('set',S.set);
function btns(){$('bSnd').textContent='SOUND: '+(S.set.sound?'ON':'OFF');$('bWake').textContent='WAKE LOCK: '+(S.set.wake?'ON':'OFF')}
$('sym').onchange=e=>{S.set.sym=e.target.value;save();load()};$('exp').onchange=e=>{S.set.exp=+e.target.value;S.active=null;save();evaluate()};
$('bGo').onclick=()=>{S.run=true;try{S.ac??=new(window.AudioContext||window.webkitAudioContext)();S.ac.resume()}catch(e){err('Audio unavailable: '+e.message)}evaluate()};
$('bStop').onclick=()=>{S.run=false;S.active=null;evaluate()};
$('bSnd').onclick=()=>{S.set.sound=!S.set.sound;save();btns()};
$('bWake').onclick=async()=>{S.set.wake=!S.set.wake;save();btns();if(S.set.wake)await wake();else{S.lock&&S.lock.release();S.lock=null}};
$('bAck').onclick=()=>{if(S.active)S.active.ack=true;evaluate()};
$('bAcct').onclick=()=>{if(S.acct||S.tok){S.acct=null;S.tok=null;ws.mode='public';renderAcct();ws.ws?.close();return}const t=prompt('Paste a READ-scope Deriv API token (kept in memory only, never saved):');if(t?.trim())auth(t.trim())};
const renderJ=()=>{const st=journalStats(S.j,today());$('jStats').textContent=`Trades ${st.total} · W ${st.wins} / L ${st.losses} · Win rate ${st.rate.toFixed(0)}% · P/L ${f2(st.pl)} · Avg win ${f2(st.avgW)} · Avg loss ${f2(st.avgL)} · Streak ${st.streak} · Max losing streak ${st.maxLS} · Today ${f2(st.daily)}. Past results do not predict future results.`;
 $('jList').replaceChildren(...S.j.slice(-15).reverse().map(x=>{const d=document.createElement('div');d.className='row';d.textContent=`${new Date(x.t).toLocaleString()} ${x.sym} ${x.exp}t ${x.sig} ${x.res} ${f2(x.pl)}${x.note?' — '+x.note:''}`;return d}))};
const openJ=()=>{const A=S.active;if(A)$('jSig').value=A.dir;$('jStk').value=A?.stake?.v??S.set.minStake;renderJ();$('dJ').showModal()};
$('bJ').onclick=openJ;$('bRec').onclick=openJ;$('jX').onclick=()=>$('dJ').close();
$('jAdd').onclick=()=>{const res=$('jRes').value,stake=+$('jStk').value;let pl=$('jPL').value===''?null:+$('jPL').value;
 if(res==='LOSS'&&pl===null)pl=-stake;if(res==='VOID'&&pl===null)pl=0;if(res==='WIN'&&(pl===null||pl<=0))return err('Enter the positive P/L for a WIN');if(!isFinite(stake)||stake<0)return err('Invalid stake');
 record({t:now(),day:today(),sym:S.set.sym,exp:S.set.exp,sig:$('jSig').value,sug:S.active?.stake?.v??null,stake,res,pl:res==='LOSS'?-Math.abs(pl):pl,note:$('jNote').value.slice(0,200)});$('jNote').value='';$('jPL').value='';renderJ();evaluate()};
$('bSet').onclick=()=>{$('sForm').replaceChildren(...Object.keys(NAMES).flatMap(k=>{const l=document.createElement('label'),i=document.createElement('input');l.textContent=NAMES[k];i.id='s_'+k;i.value=S.set[k];return[l,i]}),(()=>{const l=document.createElement('label'),c=document.createElement('input');l.textContent='Stake suggestions';c.type='checkbox';c.id='s_stakeOn';c.checked=S.set.stakeOn;c.style.width='auto';return l.append(c)||l})());$('dS').showModal()};
$('sX').onclick=()=>$('dS').close();
$('sOk').onclick=()=>{const n={...S.set};for(const k of Object.keys(NAMES)){const v=$('s_'+k).value.trim();if(k==='appId'){if(!/^\d+$/.test(v))return err('App ID must be numeric');n[k]=v}else{if(!(+v>=0)||v==='')return err('Invalid value: '+NAMES[k]);n[k]=+v}}n.stakeOn=$('s_stakeOn').checked;const re=n.appId!==S.set.appId;S.set=n;save();$('dS').close();renderAcct();if(re){err('App ID changed — reconnecting');ws.ws.close()}evaluate()};
$('bBt').onclick=()=>{$('bOut').textContent='';$('dB').showModal()};$('bX').onclick=()=>$('dB').close();
$('bRun').onclick=()=>{if(S.price.length<400||!S.set.exp)return $('bOut').textContent='Need loaded history and a supported expiry.';
 const r=backtest(S.price,S.set.exp,S.prof,+$('bStk').value||1,+$('bPay').value||95),d=r.win+r.loss;
 $('bOut').textContent=`HISTORICAL SIMULATION (${S.price.length} ticks, ${S.set.sym}, ${S.set.exp}t)\nSetups: ${r.setups} (RISE ${r.rise} / FALL ${r.fall})\nWAIT decisions: ${r.wait}\nWins ${r.win} / Losses ${r.loss}\nWin rate: ${d?(r.win/d*100).toFixed(1)+'%':'n/a'}\nHypothetical P/L: ${f2(r.pl)}\nMax losing streak: ${r.maxLS}\nEntry = tick after signal, ties lose. Small samples are unreliable; this is not a forecast.`};
window.addEventListener('online',()=>{$('off').hidden=true});window.addEventListener('offline',()=>{$('off').hidden=false});
// ---- boot ----
(async()=>{Object.assign(S.set,await kvGet('set')||{});S.j=await kvGet('j')||[];S.cool=await kvGet('cool')||S.cool;
 $('off').hidden=navigator.onLine;btns();renderAcct();ws=new WS();ws.onopen=onOpen;ws.onmsg=m=>{if(m.msg_type==='tick'&&m.tick)addTick(m.tick)};
 setInterval(()=>{if(S.run||S.cool.until>now())evaluate();else render(null,{data:S.price.length>=200,live:S.last&&now()-S.last<15000,risk:true},S.run?'':'Analysis stopped — press ANALYZE','—',risk())},1000);
 if(S.set.wake)wake();if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(e=>err('Service worker: '+e.message))})();
