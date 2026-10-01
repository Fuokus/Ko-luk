const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const db=require('./db');
const cfg=require('./config');
const all=(...a)=>db.all(...a),one=(...a)=>db.one(...a),run=(...a)=>db.run(...a);
class E extends Error{constructor(s,m){super(m);this.s=s}}
const today=()=>new Date(Date.now()+cfg.tzOffsetHours*36e5).toISOString().slice(0,10);
// ---- doğrulama
const int=(v,n,max,min=0)=>{const x=Number(v);if(v===''||v==null||!Number.isInteger(x)||x<min||x>max)throw new E(400,`${n} ${min} ile ${max} arasında bir tam sayı olmalı.`);return x};
const str=(v,n,max=80)=>{const s=String(v??'').trim();if(!s||s.length>max)throw new E(400,`${n} boş olamaz (en fazla ${max} karakter).`);return s};
const date=(v,n='Tarih')=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||isNaN(Date.parse(v)))throw new E(400,`${n} geçerli değil.`);return v};
const subj=v=>{if(!cfg.subjects.includes(v))throw new E(400,'Geçerli bir ders seçin.');return v};
const qs=o=>{const total=int(o.total,'Soru sayısı',cfg.maxQuestions),correct=int(o.correct,'Doğru',cfg.maxQuestions),wrong=int(o.wrong,'Yanlış',cfg.maxQuestions),blank=int(o.blank,'Boş',cfg.maxQuestions);if(correct+wrong+blank>total)throw new E(400,'Doğru, yanlış ve boş toplamı soru sayısını geçemez.');return{total,correct,wrong,blank}};
// ---- şifre / oturum
const hash=p=>{const s=crypto.randomBytes(16);return s.toString('hex')+':'+crypto.scryptSync(p,s,64).toString('hex')};
const check=(p,h)=>{const[s,k]=h.split(':');return crypto.timingSafeEqual(crypto.scryptSync(p,Buffer.from(s,'hex'),64),Buffer.from(k,'hex'))};
const DUMMY=hash('x');
const pub=u=>({id:u.id,role:u.role,first:u.first,last:u.last,code:u.code,email:u.email});
async function newCode(){for(;;){const c='OGR-'+crypto.randomInt(100000,1000000);if(!await one('SELECT 1 FROM users WHERE code=?',c))return c}}
async function login(res,u){const t=crypto.randomBytes(32).toString('hex');await run('INSERT INTO tokens VALUES(?,?,?)',t,u.id,Date.now()+7*864e5);res.setHeader('Set-Cookie',`sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7*86400}${process.env.COOKIE_SECURE?'; Secure':''}`)}
// ---- yetkilendirme: öğrenci verisine yalnızca kendisi veya bağlı koçu erişir (aksi halde 404)
async function access(u,sid){const n=sid==='me'?u.id:Number(sid);const s=Number.isInteger(n)&&n>0&&n<2e9?await one("SELECT * FROM users WHERE id=? AND role='student'",n):null;
  if(s&&(s.id===u.id||(u.role==='coach'&&await one('SELECT 1 FROM relations WHERE student_id=? AND coach_id=?',s.id,u.id))))return s;throw new E(404,'Kayıt bulunamadı.')}
const role=(u,r)=>{if(u.role!==r)throw new E(403,'Bu işlem için yetkiniz yok.')};
async function data(s){const t=today();
  const tasks=(await all('SELECT * FROM tasks WHERE student_id=? ORDER BY due',s.id)).map(x=>({...x,status:x.status!=='done'&&x.due<t?'expired':x.status}));
  const exams=await Promise.all((await all('SELECT * FROM exams WHERE student_id=? ORDER BY date,id',s.id)).map(async e=>({...e,subjects:(await all('SELECT subject,correct,wrong,blank FROM exam_subjects WHERE exam_id=?',e.id)).map(r=>({...r,net:cfg.net(r.correct,r.wrong)}))})));
  exams.forEach(e=>e.net=Math.round(e.subjects.reduce((a,r)=>a+r.net,0)*100)/100);
  return{student:pub(s),sessions:await all('SELECT * FROM sessions WHERE student_id=? ORDER BY date DESC,id DESC',s.id),tasks,exams}}
// ---- rotalar
const R=[];const route=(m,p,f,auth=true)=>R.push({m,re:new RegExp('^/api'+p+'$'),f,auth});
const gone=(r,m)=>{if(!r.changes)throw new E(404,m)};
route('GET','/config',()=>({subjects:cfg.subjects}),false);
route('POST','/register',async({b,res})=>{const r=b.role;if(!['student','coach'].includes(r))throw new E(400,'Hesap türü seçin.');
  const first=str(b.first,'Ad',40),last=str(b.last,'Soyad',40),email=str(b.email,'E-posta',120).toLowerCase();
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw new E(400,'Geçerli bir e-posta girin.');
  if(String(b.password||'').length<8||b.password.length>200)throw new E(400,'Şifre en az 8 karakter olmalı.');
  if(await one('SELECT 1 FROM users WHERE email=?',email))throw new E(409,'Bu e-posta ile zaten bir hesap var.');
  const id=(await run('INSERT INTO users(role,first,last,code,email,pw) VALUES(?,?,?,?,?,?) RETURNING id',r,first,last,r==='student'?await newCode():null,email,hash(b.password))).id;
  const u=await one('SELECT * FROM users WHERE id=?',id);await login(res,u);return pub(u)},false);
route('POST','/login',async({b,res})=>{const u=await one('SELECT * FROM users WHERE email=?',String(b.email||'').trim().toLowerCase());
  const ok=check(String(b.password||''),u?u.pw:DUMMY);if(!u||!ok)throw new E(401,'E-posta veya şifre hatalı.');await login(res,u);return pub(u)},false);
route('POST','/logout',async({res,tok})=>{await run('DELETE FROM tokens WHERE token=?',tok);res.setHeader('Set-Cookie','sid=; Max-Age=0; Path=/');return{ok:1}});
route('GET','/me',async({u})=>{const o=pub(u);if(u.role==='student'){const c=await one('SELECT u.first,u.last FROM relations r JOIN users u ON u.id=r.coach_id WHERE r.student_id=?',u.id);o.coach=c?c.first+' '+c.last:null}return o});
// davetler
route('POST','/invites',async({u,b})=>{role(u,'coach');const s=await one("SELECT * FROM users WHERE code=? AND role='student'",String(b.code||'').trim().toUpperCase());
  if(!s)throw new E(404,'Bu ID ile bir öğrenci bulunamadı.');
  if(await one('SELECT 1 FROM relations WHERE student_id=?',s.id))throw new E(409,'Bu öğrenci zaten bir koça bağlı.');
  if(await one("SELECT 1 FROM invitations WHERE coach_id=? AND student_id=? AND status='pending'",u.id,s.id))throw new E(409,'Bu öğrenciye zaten davet gönderdin.');
  await run('INSERT INTO invitations(coach_id,student_id,created) VALUES(?,?,?)',u.id,s.id,today());return{ok:1}});
route('GET','/invites',({u})=>u.role==='student'
  ?all("SELECT i.id,i.created,u.first,u.last FROM invitations i JOIN users u ON u.id=i.coach_id WHERE i.student_id=? AND i.status='pending'",u.id)
  :all('SELECT i.id,i.status,i.created,u.first,u.last,u.code FROM invitations i JOIN users u ON u.id=i.student_id WHERE i.coach_id=? ORDER BY i.id DESC',u.id));
route('POST','/invites/(\\d+)/respond',async({u,p,b})=>{role(u,'student');const i=await one("SELECT * FROM invitations WHERE id=? AND student_id=? AND status='pending'",p[0],u.id);if(!i)throw new E(404,'Davet bulunamadı.');
  if(b.accept){if(await one('SELECT 1 FROM relations WHERE student_id=?',u.id))throw new E(409,'Zaten bir koça bağlısın.');
    await db.tx(async t=>{await t.run("UPDATE invitations SET status='accepted' WHERE id=?",i.id);await t.run("UPDATE invitations SET status='rejected' WHERE student_id=? AND status='pending'",u.id);await t.run('INSERT INTO relations VALUES(?,?)',u.id,i.coach_id)})}
  else await run("UPDATE invitations SET status='rejected' WHERE id=?",i.id);return{ok:1}});
// koç: öğrenci listesi ve detay
route('GET','/students',async({u})=>{role(u,'coach');return Promise.all((await all('SELECT s.* FROM relations r JOIN users s ON s.id=r.student_id WHERE r.coach_id=? ORDER BY s.first',u.id)).map(data))});
route('GET','/students/(\\w+)',async({u,p})=>data(await access(u,p[0])));
// çalışma kayıtları (yalnızca öğrenci kendi kaydını yazar)
const sess=b=>({date:date(b.date),subject:subj(b.subject),topic:str(b.topic,'Konu'),minutes:int(Number(b.hours||0)*60+Number(b.mins||0),'Süre (dakika)',cfg.maxMinutes,1),...qs(b)});
const sv=o=>[o.date,o.subject,o.topic,o.minutes,o.total,o.correct,o.wrong,o.blank];
route('POST','/sessions',async({u,b})=>{role(u,'student');await run('INSERT INTO sessions(student_id,date,subject,topic,minutes,total,correct,wrong,blank) VALUES(?,?,?,?,?,?,?,?,?)',u.id,...sv(sess(b)));return{ok:1}});
route('PUT','/sessions/(\\d+)',async({u,p,b})=>{role(u,'student');const o=sess(b);gone(await run('UPDATE sessions SET date=?,subject=?,topic=?,minutes=?,total=?,correct=?,wrong=?,blank=? WHERE id=? AND student_id=?',...sv(o),p[0],u.id),'Kayıt bulunamadı.');return{ok:1}});
route('DELETE','/sessions/(\\d+)',async({u,p})=>{role(u,'student');gone(await run('DELETE FROM sessions WHERE id=? AND student_id=?',p[0],u.id),'Kayıt bulunamadı.');return{ok:1}});
// görevler
route('POST','/tasks',async({u,b})=>{role(u,'coach');const s=await access(u,String(b.student_id));const d=date(b.due,'Son tarih');if(d<today())throw new E(400,'Son tarih geçmişte olamaz.');
  await run('INSERT INTO tasks(coach_id,student_id,subject,topic,questions,due) VALUES(?,?,?,?,?,?)',u.id,s.id,subj(b.subject),str(b.topic,'Konu'),int(b.questions,'Soru sayısı',cfg.maxQuestions,1),d);return{ok:1}});
route('PATCH','/tasks/(\\d+)',async({u,p,b})=>{role(u,'student');if(!['pending','in_progress','done'].includes(b.status))throw new E(400,'Geçersiz durum.');
  gone(await run('UPDATE tasks SET status=? WHERE id=? AND student_id=?',b.status,p[0],u.id),'Görev bulunamadı.');return{ok:1}});
route('DELETE','/tasks/(\\d+)',async({u,p})=>{role(u,'coach');gone(await run('DELETE FROM tasks WHERE id=? AND coach_id=?',p[0],u.id),'Görev bulunamadı.');return{ok:1}});
// denemeler
route('POST','/exams',async({u,b})=>{role(u,'student');const name=str(b.name,'Deneme adı'),d=date(b.date);const seen=new Set();
  const rows=(Array.isArray(b.subjects)?b.subjects:[]).map(r=>({subject:subj(r.subject),correct:int(r.correct||0,'Doğru',200),wrong:int(r.wrong||0,'Yanlış',200),blank:int(r.blank||0,'Boş',200)})).filter(r=>r.correct+r.wrong+r.blank>0);
  if(!rows.length)throw new E(400,'En az bir ders için sonuç girin.');rows.forEach(r=>{if(seen.has(r.subject))throw new E(400,'Bir ders yalnızca bir kez girilebilir.');seen.add(r.subject)});
  await db.tx(async t=>{const id=(await t.run('INSERT INTO exams(student_id,name,date) VALUES(?,?,?) RETURNING id',u.id,name,d)).id;for(const r of rows)await t.run('INSERT INTO exam_subjects VALUES(?,?,?,?,?)',id,r.subject,r.correct,r.wrong,r.blank)});return{ok:1}});
route('DELETE','/exams/(\\d+)',async({u,p})=>{role(u,'student');await run('DELETE FROM exam_subjects WHERE exam_id IN(SELECT id FROM exams WHERE id=? AND student_id=?)',p[0],u.id);gone(await run('DELETE FROM exams WHERE id=? AND student_id=?',p[0],u.id),'Deneme bulunamadı.');return{ok:1}});
// ---- sunucu
const send=(res,s,o)=>{res.writeHead(s,{'Content-Type':'application/json','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(o))};
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://x');
  if(!url.pathname.startsWith('/api')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"});return res.end(fs.readFileSync(path.join(__dirname,'index.html')))}
  let raw='';req.on('data',c=>{raw+=c;if(raw.length>1e5)req.destroy()});
  req.on('end',async()=>{try{await db.ready;
    const r=R.find(x=>x.m===req.method&&x.re.test(url.pathname));if(!r)throw new E(404,'Sayfa bulunamadı.');
    let b={};if(raw){if(!(req.headers['content-type']||'').includes('application/json'))throw new E(415,'Geçersiz istek.');try{b=JSON.parse(raw)}catch{throw new E(400,'Geçersiz istek.')}}
    const tok=((req.headers.cookie||'').match(/(?:^|; )sid=([a-f0-9]+)/)||[])[1];let u=null;
    if(tok)u=await one('SELECT u.* FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.token=? AND t.exp>?',tok,Date.now())||null;
    if(r.auth&&!u)throw new E(401,'Devam etmek için giriş yapın.');
    send(res,200,await r.f({u,b,res,tok,p:url.pathname.match(r.re).slice(1)}))
  }catch(e){if(!(e instanceof E))console.error(e);send(res,e.s||500,{error:e instanceof E?e.message:'Bir hata oluştu. Lütfen tekrar deneyin.'})}})});
if(require.main===module)server.listen(process.env.PORT||3000,()=>console.log('http://localhost:'+(process.env.PORT||3000)));
module.exports=server;
