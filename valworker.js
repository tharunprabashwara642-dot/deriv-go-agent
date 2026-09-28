import{validate}from'./validation.js';
onmessage=e=>{for(const j of e.data.jobs)postMessage({res:validate(j.ds,j.h,e.data.o)});postMessage({done:1})};
