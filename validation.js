// Validation harness. Uses the SAME analyze() as live. Historical results are never live guarantees.
import{analyze,DEFAULT_CFG,profileFor}from'./engine.js';
export const HORIZONS=[5,10,20,30,50];
export const DISCLAIMER='Historical validation result only — NOT a live accuracy guarantee. Many markets/expiries are tested, so some can look good by chance; consecutive ticks are correlated; market behaviour changes.';
export const wilson=(w,n,z=1.96)=>{if(!n)return[0,0];const p=w/n,d=1+z*z/n,c=p+z*z/(2*n),a=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n));return[(c-a)/d,(c+a)/d]};
export function clean(pr,tm=[]){const P=[],T=[],hasT=tm.length===pr.length&&tm.length>0;for(let i=0;i<pr.length;i++){const x=+pr[i];if(!isFinite(x)||x<=0)continue;if(hasT){const e=+tm[i];if(!isFinite(e)||(T.length&&e<=T[T.length-1]))continue;T.push(e)}P.push(x)}return{prices:P,times:hasT?T:[]}}
export function parseTicks(text){let pr=[],tm=[];const t=String(text).trim();
 try{const j=JSON.parse(t),o=j&&j.history?j.history:j;if(Array.isArray(o))pr=o.map(Number);else if(o&&o.prices){pr=o.prices.map(Number);tm=(o.times||[]).map(Number)}}catch{}
 if(!pr.length){tm=[];for(const ln of t.split(/\r?\n/)){const c=ln.split(/[,;\t ]+/).filter(Boolean).map(Number);if(!c.length||c.some(Number.isNaN))continue;if(c.length===1)pr.push(c[0]);else{tm.push(c[0]);pr.push(c[1])}}}
 return clean(pr,tm)}
// Signal at tick i-1 (last tick analysed) -> entry = tick i -> exit = tick i+h. Ties lose. Outcome never uses data past i+h.
export function walkForward(p,t,h,prof,cfg,o={}){const fn=o.fn||analyze,from=Math.max(o.from??250,250),to=o.to??p.length,R={recs:[],wait:0,points:0},cfg=o.cfg||DEFAULT_CFG;
 for(let i=from;i+h<to;){const r=fn(p.slice(Math.max(0,i-400),i),h,prof,cfg);R.points++;
  if(r.decision==='WAIT'){R.wait++;i++;continue}
  const a=p[i],b=p[i+h],out=b===a?'TIE':(r.decision==='RISE'?b>a:b<a)?'WIN':'LOSS';
  R.recs.push({dir:r.decision,sigIdx:i-1,sigEpoch:t[i-1]??null,entryIdx:i,entryEpoch:t[i]??null,entryPrice:a,exitIdx:i+h,exitEpoch:t[i+h]??null,exitPrice:b,outcome:out,conds:r.n});
  i+=h+1}
 return R}
export function summarize(R,payout=95,minN=100){const s={points:R.points,wait:R.wait,signals:R.recs.length,RISE:{n:0,w:0,t:0},FALL:{n:0,w:0,t:0}};
 for(const x of R.recs){const d=s[x.dir];d.n++;if(x.outcome==='WIN')d.w++;if(x.outcome==='TIE')d.t++}
 const n=s.signals,w=s.RISE.w+s.FALL.w;s.wins=w;s.losses=n-w;s.rate=n?w/n:0;s.ci=wilson(w,n,2.576);s.be=1/(1+payout/100);s.coverage=s.points?n/s.points:0;s.fpr=n?(n-w)/n:0;s.pl=w*payout/100-(n-w);
 s.verdict=n<minN?`NOT VALIDATED (only ${n} signals, need ≥${minN})`:s.ci[0]<=s.be?'NO EDGE DEMONSTRATED (99% CI lower bound ≤ breakeven)':'HISTORICALLY POSITIVE — validation sample only, not a live guarantee';return s}
export function validate(ds,h,o={}){const M=o.maxTicks||30000,p=ds.prices.slice(-M),t=(ds.times||[]).slice(-M),prof=profileFor(ds.fam||ds.label||''),payout=o.payout??95,minN=o.minN??100;
 const out={key:ds.key||ds.label,label:ds.label,profile:prof.name,h,ticks:p.length,cfg:{...DEFAULT_CFG,...o.cfg},tuned:false,train:null};
 if(p.length<800){out.error=`Only ${p.length} ticks — need ≥800`;out.verdict='NOT VALIDATED (dataset too small)';return out}
 const cut=Math.floor(p.length*Math.min(.8,Math.max(.3,o.trainPct??.6)));out.cut=cut;
 if(o.tune){let best=null;for(const score of[.5,.6,.75])for(const erMul of[.8,1,1.25]){const cfg={...out.cfg,score,erMul},s=summarize(walkForward(p,t,h,prof,cfg,{to:cut}),payout,30);if(s.signals>=30&&(!best||s.ci[0]>best.s.ci[0]))best={cfg,s}}
  if(best){out.cfg=best.cfg;out.tuned=true;out.train=best.s}}
 const V=walkForward(p,t,h,prof,out.cfg,{from:cut}),s=summarize(V,payout,minN),n=p.length-cut;
 out.blocks=[0,1,2].map(k=>{const r=V.recs.filter(x=>x.entryIdx>=cut+n*k/3&&x.entryIdx<cut+n*(k+1)/3);return`${r.filter(x=>x.outcome==='WIN').length}/${r.length}`});
 out.valid=s;out.records=V.recs;out.verdict=s.verdict;return out}
const pc=x=>(x*100).toFixed(1)+'%';
export function report(r){const L=[`[${r.label} | ${r.h}t] profile: ${r.profile}, ${r.ticks} ticks`];if(r.error)return L.concat('  '+r.error+' → '+r.verdict).join('\n');
 const v=r.valid;L.push(r.tuned?`  thresholds tuned on TRAIN only (score ${r.cfg.score}, erMul ${r.cfg.erMul}); train n=${r.train.signals}, win ${pc(r.train.rate)}`:'  thresholds: as configured (not tuned)',
 `  VALIDATION (last ${pc(1-r.cut/r.ticks)}): decision points ${v.points}, WAIT ${v.wait}, signals ${v.signals}, coverage ${pc(v.coverage)}`,
 `   RISE n=${v.RISE.n} wins=${v.RISE.w} | FALL n=${v.FALL.n} wins=${v.FALL.w} | ties=${v.RISE.t+v.FALL.t}`,
 `   historical win rate ${pc(v.rate)} (99% CI ${pc(v.ci[0])}–${pc(v.ci[1])}), breakeven ${pc(v.be)}, non-win (false-positive) rate ${pc(v.fpr)}`,`   time blocks wins/n: ${r.blocks.join('  ')}`);
 for(const x of r.records.slice(0,3))L.push(`   e.g. ${x.dir} sig@#${x.sigIdx} entry #${x.entryIdx} ${x.entryPrice} → exit #${x.exitIdx} ${x.exitPrice} ${x.outcome}`);
 L.push('  ▶ '+r.verdict);return L.join('\n')}
