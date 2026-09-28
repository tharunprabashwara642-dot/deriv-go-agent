// Pure decision engine: shared by live analysis and historical simulation.
export const ema=(a,n)=>{const k=2/(n+1),o=[a[0]];for(let i=1;i<a.length;i++)o.push(a[i]*k+o[i-1]*(1-k));return o};
export const rsi=(a,n=14)=>{if(a.length<=n)return null;let g=0,l=0;for(let i=1;i<=n;i++){const d=a[i]-a[i-1];d>0?g+=d:l-=d}g/=n;l/=n;for(let i=n+1;i<a.length;i++){const d=a[i]-a[i-1];g=(g*(n-1)+Math.max(d,0))/n;l=(l*(n-1)+Math.max(-d,0))/n}return l===0?100:100-100/(1+g/l)};
const sd=a=>{if(!a.length)return 0;const m=a.reduce((s,x)=>s+x,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length)};
const diffs=a=>a.slice(1).map((x,i)=>x-a[i]),sgn=x=>x>0?1:x<0?-1:0;
export const candles=(p,n=10)=>{const c=[];for(let i=0;i+n<=p.length;i+=n){const s=p.slice(i,i+n);c.push({o:s[0],c:s[n-1],h:Math.max(...s),l:Math.min(...s)})}return c};
export const swings=(p,k=4)=>{const H=[],L=[];for(let i=k;i<p.length-k;i++){const w=p.slice(i-k,i+k+1);if(p[i]===Math.max(...w)&&w.filter(x=>x===p[i]).length===1)H.push(p[i]);if(p[i]===Math.min(...w)&&w.filter(x=>x===p[i]).length===1)L.push(p[i])}return{H,L}};
export const profileFor=(s='')=>/crash|boom/i.test(s)?{name:'Crash/Boom (spike-aware)',er:.25,spike:5,vmax:2}:/jump/i.test(s)?{name:'Jump',er:.25,spike:8,vmax:1.6}:/step/i.test(s)?{name:'Step',er:.2,spike:6,vmax:2}:/range/i.test(s)?{name:'Range Break',er:.25,spike:6,vmax:2,room:1.5}:/volatility|random/i.test(s)?{name:'Volatility',er:.22,spike:6,vmax:2}:{name:'Generic (conservative)',er:.3,spike:5,vmax:1.6};
export function analyze(p,h,prof=profileFor()){
 const R={decision:'WAIT',state:'ANALYZING',checks:{},m:{},why:[],n:0,total:8};
 if(p.length<200){R.state='INSUFFICIENT_DATA';R.why.push(`Need 200+ ticks, have ${p.length}`);return R}
 const w=p.slice(-400),N=w.length,last=w[N-1],d=diffs(w),sg=sd(d.slice(-300))||1e-9,sr=sd(d.slice(-30));
 const e9=ema(w,9),e21=ema(w,21),e50=ema(w,50),r=rsi(w),slope=(e21[N-1]-e21[N-6])/(sg*Math.sqrt(5));
 const trend=e9[N-1]>e21[N-1]&&e21[N-1]>e50[N-1]&&slope>.3&&last>e21[N-1]?1:e9[N-1]<e21[N-1]&&e21[N-1]<e50[N-1]&&slope<-.3&&last<e21[N-1]?-1:0;
 const m=Math.max(5,2*h),z=(last-w[N-1-m])/(sg*Math.sqrt(m));let mom=Math.abs(z)>.8?sgn(z):0;
 if(mom===1&&(r>75||r<50))mom=0;if(mom===-1&&(r<25||r>50))mom=0; // RSI read in context: needs pressure, not exhaustion
 const td=diffs(w.slice(-Math.max(10,3*h))),up=td.filter(x=>x>0).length/td.length,micro=up>=.62?1:up<=.38?-1:0;
 const sw=swings(w.slice(-150)),hs=sw.H.slice(-2),ls=sw.L.slice(-2);
 const st=hs.length===2&&ls.length===2?(hs[1]>hs[0]&&ls[1]>ls[0]?1:hs[1]<hs[0]&&ls[1]<ls[0]?-1:0):0;
 const er=Math.abs(last-w[N-41])/(d.slice(-40).reduce((s,x)=>s+Math.abs(x),0)||1e-9),vr=sr/sg;
 const spike=Math.max(...d.slice(-30).map(Math.abs))/sg>prof.spike,unstable=vr>prof.vmax||vr<.4||spike;
 const regime=unstable?'UNSTABLE':er>=prof.er?'TRENDING':er<.12?'RANGING':'MIXED';
 const dir=mom,hi=Math.max(...w.slice(-100)),lo=Math.min(...w.slice(-100)),unit=sg*Math.sqrt(h);
 const room=dir===1?(hi-last)/unit:(last-lo)/unit;
 const W=h<=5?[.5,1.5,2,.5]:h<=10?[1.5,1.5,1.5,1]:[2,1,.5,2];
 const score=dir?(W[0]*trend*dir+W[1]*mom*dir+W[2]*micro*dir+W[3]*st*dir)/W.reduce((a,b)=>a+b):0;
 const c=R.checks={regime:regime==='TRENDING',volatility:!unstable,
  trend:dir!==0&&(h<=5?trend!==-dir:trend===dir),momentum:dir!==0,
  structure:dir!==0&&(h>=20?st===dir:st!==-dir),micro:dir!==0&&micro===dir,
  sr:dir!==0&&room>=(prof.room||1),expiry:dir!==0&&score>=.6};
 R.n=Object.values(c).filter(Boolean).length;R.m={trend,mom,micro,st,rsi:r,e9:e9[N-1],e21:e21[N-1],er,vr,regime,room,score};
 const ok=R.n===R.total,lab=x=>x===1?'bullish':x===-1?'bearish':'neutral';
 if(ok){R.decision=dir===1?'RISE':'FALL';R.state='VALID';R.why=[`Regime ${regime.toLowerCase()} (efficiency ${er.toFixed(2)})`,`Trend ${lab(trend)}, EMA 9/21/50 aligned`,`Momentum ${lab(mom)}, RSI ${r.toFixed(0)} not exhausted`,`Tick pressure ${(up*100).toFixed(0)}% up over last ${td.length}`,`Structure ${lab(st)}`,`Room to ${dir===1?'resistance':'support'}: ${room.toFixed(1)} units`,`Volatility stable (ratio ${vr.toFixed(2)})`,`Expiry ${h}t alignment ${score.toFixed(2)}`]}
 else{R.state=unstable?'MARKET_UNSTABLE':dir&&[trend,micro,st].some(x=>x===-dir)?'CONFLICTED':'ANALYZING';R.why=[Object.keys(c).filter(k=>!c[k]).join(', ')+' not satisfied']}
 return R}
export function backtest(p,h,prof,stake,payout){
 const o={setups:0,rise:0,fall:0,wait:0,win:0,loss:0,pl:0,maxLS:0};let ls=0;
 for(let i=250;i+h<p.length;){const r=analyze(p.slice(Math.max(0,i-400),i),h,prof);
  if(r.decision==='WAIT'){o.wait++;i++;continue}
  o.setups++;r.decision==='RISE'?o.rise++:o.fall++;
  const a=p[i],b=p[i+h],won=r.decision==='RISE'?b>a:b<a; // entry = next tick, ties lose
  if(won){o.win++;o.pl+=stake*payout/100;ls=0}else{o.loss++;o.pl-=stake;o.maxLS=Math.max(o.maxLS,++ls)}
  i+=h+1}
 return o}
export const streakLosses=j=>{let s=0;for(let i=j.length-1;i>=0;i--){if(j[i].res==='LOSS')s++;else if(j[i].res==='WIN')break}return s};
export const suggestStake=(bal,pct,min,max)=>{const raw=bal*pct/100;return raw<min?{v:min,note:'Minimum stake exceeds your risk %'}:{v:Math.round(Math.min(raw,max)*100)/100,note:''}};
export function journalStats(j,day){const r=j.filter(x=>x.res!=='VOID'),w=r.filter(x=>x.res==='WIN'),l=r.filter(x=>x.res==='LOSS'),sum=a=>a.reduce((s,x)=>s+x.pl,0);
 let ml=0,run=0,cs='—';for(const x of r){if(x.res==='LOSS')ml=Math.max(ml,++run);else run=0}
 if(r.length){const t=r.at(-1).res;let c=0;for(let i=r.length-1;i>=0&&r[i].res===t;i--)c++;cs=(t==='WIN'?'W':'L')+c}
 return{total:j.length,wins:w.length,losses:l.length,rate:r.length?w.length/r.length*100:0,pl:sum(j),avgW:w.length?sum(w)/w.length:0,avgL:l.length?sum(l)/l.length:0,streak:cs,maxLS:ml,daily:sum(j.filter(x=>x.day===day))}}
