// Uçtan uca senaryo testi: DB=:memory: node test.js
process.env.DB=':memory:';const srv=require('./server'),assert=require('assert');
const mk=()=>{let c='';return async(m,p,b)=>{const r=await fetch(base+'/api'+p,{method:m,headers:{'Content-Type':'application/json',cookie:c},body:b&&JSON.stringify(b)});const s=r.headers.get('set-cookie');if(s)c=s.split(';')[0];return{s:r.status,j:await r.json()}}};
let base;srv.listen(0,async()=>{base='http://localhost:'+srv.address().port;try{
const S=mk(),C=mk(),C2=mk(),S2=mk(),t=new Date(Date.now()+3*36e5).toISOString().slice(0,10),due='2099-10-03';
let r=await S('POST','/register',{role:'student',first:'Ali',last:'Yılmaz',email:'a@x.com',password:'sifre1234'});assert(/^OGR-\d{6}$/.test(r.j.code),'öğrenci ID');const code=r.j.code,sid=r.j.id;
await C('POST','/register',{role:'coach',first:'Ece',last:'K',email:'c@x.com',password:'sifre1234'});
await C2('POST','/register',{role:'coach',first:'Başka',last:'K',email:'c2@x.com',password:'sifre1234'});
const s2=await S2('POST','/register',{role:'student',first:'Veli',last:'B',email:'b@x.com',password:'sifre1234'});
assert.equal((await C('POST','/invites',{code})).s,200);assert.equal((await C('POST','/invites',{code})).s,409);
const inv=(await S('GET','/invites')).j;assert.equal(inv.length,1);assert.equal((await S('POST','/invites/'+inv[0].id+'/respond',{accept:true})).s,200);
assert.equal((await C2('POST','/invites',{code})).s,409,'tek koç');
assert.equal((await C('POST','/tasks',{student_id:sid,subject:'Matematik',topic:'Trigonometri',questions:100,due})).s,200);
assert.equal((await C2('POST','/tasks',{student_id:sid,subject:'Matematik',topic:'x',questions:1,due})).s,404,'IDOR görev');
assert.equal((await S('GET','/students/me')).j.tasks.length,1);
assert.equal((await S('POST','/sessions',{date:t,subject:'Matematik',topic:'Trigonometri',hours:1,mins:35,total:85,correct:68,wrong:12,blank:5})).s,200);
assert.equal((await S('POST','/sessions',{date:t,subject:'Matematik',topic:'x',hours:0,mins:10,total:5,correct:-1,wrong:0,blank:0})).s,400,'negatif');
assert.equal((await S('POST','/sessions',{date:t,subject:'Matematik',topic:'x',hours:0,mins:10,total:5,correct:5,wrong:5,blank:0})).s,400,'toplam');
assert.equal((await C('GET','/students/'+sid)).j.sessions[0].minutes,95,'koç çalışmayı görür');
assert.equal((await S('POST','/exams',{name:'TYT 1',date:t,subjects:[{subject:'Türkçe',correct:32,wrong:5,blank:3},{subject:'Matematik',correct:25,wrong:8,blank:7}]})).s,200);
const e=(await C('GET','/students/'+sid)).j.exams[0];assert.equal(e.subjects[0].net,30.75);assert.equal(e.net,30.75+23);
assert.equal((await C2('GET','/students/'+sid)).s,404,'başka koç');assert.equal((await S2('GET','/students/'+sid)).s,404,'başka öğrenci');
assert.equal((await S2('DELETE','/sessions/1')).s,404,'başkasının kaydını silemez');assert.equal((await S2('GET','/students')).s,403);assert.equal((await C2('GET','/students')).j.length,0);
assert.equal((await S('GET','/me')).j.coach,'Ece K');assert.equal((await mk()('GET','/students')).s,401);
assert.equal((await mk()('POST','/login',{email:'a@x.com',password:'yanlis'})).s,401);
console.log('TÜM TESTLER GEÇTİ')}catch(x){console.error('HATA',x.message,x.stack.split('\n')[1]);process.exitCode=1}srv.close()});
