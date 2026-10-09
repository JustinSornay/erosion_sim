const { createEngine } = require('../helpers/engine');
const e = createEngine();
const seeds=[0,1,2,3,10,100,7654321,12345678,314159265,271828182,1000000000,2147483647];
for(const preset of Object.keys(e.terrainCatalog)){
 let result=[];
 for(const seed of seeds){
  e.init({seed,preset});const {b,flowTo}=e.fields();const N=e.constants.N;
  const order=Array.from(b,(_,i)=>i).sort((a,z)=>b[a]-b[z]);
  const reach=new Uint8Array(b.length),len=new Uint16Array(b.length);
  let pits=0,maxjump=0;
  for(const i of order){const x=i%N,y=i/N|0,j=flowTo[i];
   if(x===0||x===N-1||y===0||y===N-1)reach[i]=1;
   else if(j>=0)reach[i]=reach[j];else pits++;
   len[i]=j<0?0:len[j]+1;
  }
  const drain=reach.reduce((a,z)=>a+z,0)/b.length;
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){
   let i=y*N+x; if(x<N-1)maxjump=Math.max(maxjump,Math.abs(b[i]-b[i+1]));
   if(y<N-1)maxjump=Math.max(maxjump,Math.abs(b[i]-b[i+N]));
  }
  result.push(`${seed}: ${drain.toFixed(2)} (${pits}) [${maxjump.toFixed(3)}]`);
 }
 console.log(preset, result.join(', '));
}
