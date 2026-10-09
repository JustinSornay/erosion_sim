const { createEngine } = require('../helpers/engine');
const e=createEngine();const N=e.constants.N, bad=[];
let biggestJump=0,smallestRange=Infinity,counts=[0,0,0];
for(const preset of Object.keys(e.terrainCatalog)) for(let i=0;i<80;i++){
 const seed=(Math.imul(100019,i+1)+Math.imul(3793711,preset.length+1))&0x7fffffff;
 counts[seed%3]++;e.init({seed,preset});const b=e.fields().b;
 let lo=Infinity,hi=-Infinity,jump=0;
 for(let y=0;y<N;y++)for(let x=0;x<N;x++){
  const i=y*N+x,z=b[i];if(!Number.isFinite(z))bad.push([preset,seed,'nonfinite']);
  if(z<lo)lo=z;if(z>hi)hi=z;
  if(x<N-1)jump=Math.max(jump,Math.abs(z-b[i+1]));
  if(y<N-1)jump=Math.max(jump,Math.abs(z-b[i+N]));
 }
 if(jump>biggestJump)biggestJump=jump;
 if(hi-lo<smallestRange)smallestRange=hi-lo;
 if(jump>=.09 || hi-lo<=.35)bad.push([preset,seed,seed%3,jump.toFixed(3),(hi-lo).toFixed(3)]);
}
console.log(JSON.stringify({scenes:counts.reduce((a,z)=>a+z,0),views:counts,biggestJump,smallestRange,violations:bad.slice(0,40),totalViolations:bad.length},null,2));
