// Veri katmanı: DATABASE_URL varsa PostgreSQL (canlı), yoksa SQLite (yerel/test). Arayüz aynıdır.
const path=require('path');
const DDL=`CREATE TABLE IF NOT EXISTS users(id {PK},role TEXT CHECK(role IN('student','coach')),first TEXT,last TEXT,code TEXT UNIQUE,email TEXT UNIQUE,pw TEXT);
CREATE TABLE IF NOT EXISTS tokens(token TEXT PRIMARY KEY,user_id INTEGER REFERENCES users(id),exp BIGINT);
CREATE TABLE IF NOT EXISTS relations(student_id INTEGER PRIMARY KEY REFERENCES users(id),coach_id INTEGER REFERENCES users(id));
CREATE TABLE IF NOT EXISTS invitations(id {PK},coach_id INTEGER REFERENCES users(id),student_id INTEGER REFERENCES users(id),status TEXT DEFAULT 'pending',created TEXT);
CREATE TABLE IF NOT EXISTS sessions(id {PK},student_id INTEGER REFERENCES users(id),date TEXT,subject TEXT,topic TEXT,minutes INTEGER,total INTEGER,correct INTEGER,wrong INTEGER,blank INTEGER);
CREATE TABLE IF NOT EXISTS tasks(id {PK},coach_id INTEGER REFERENCES users(id),student_id INTEGER REFERENCES users(id),subject TEXT,topic TEXT,questions INTEGER,due TEXT,status TEXT DEFAULT 'pending');
CREATE TABLE IF NOT EXISTS exams(id {PK},student_id INTEGER REFERENCES users(id),name TEXT,date TEXT);
CREATE TABLE IF NOT EXISTS exam_subjects(exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,subject TEXT,correct INTEGER,wrong INTEGER,blank INTEGER);
CREATE INDEX IF NOT EXISTS ix_s ON sessions(student_id,date);CREATE INDEX IF NOT EXISTS ix_t ON tasks(student_id);`;
function sqlite(){const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.DB||path.join(__dirname,'data.db'));d.exec('PRAGMA foreign_keys=ON');let lock=Promise.resolve();
  const db={all:async(s,...p)=>d.prepare(s).all(...p),one:async(s,...p)=>d.prepare(s).get(...p),exec:async s=>d.exec(s),
    run:async(s,...p)=>{if(/returning/i.test(s)){const r=d.prepare(s).all(...p);return{id:r[0]&&r[0].id,changes:r.length}}return{changes:Number(d.prepare(s).run(...p).changes)}}};
  db.tx=f=>{const r=lock.then(async()=>{d.exec('BEGIN');try{const v=await f(db);d.exec('COMMIT');return v}catch(e){d.exec('ROLLBACK');throw e}});lock=r.catch(()=>{});return r};return db}
function pg(url){const{Pool}=require('pg');const pool=new Pool({connectionString:url,max:5});pool.on('error',e=>console.error(e.message));
  const conv=s=>{let i=0;return s.replace(/\?/g,()=>'$'+(++i))};
  const mk=x=>({all:async(s,...p)=>(await x.query(conv(s),p)).rows,one:async(s,...p)=>(await x.query(conv(s),p)).rows[0],exec:async s=>{await x.query(s)},
    run:async(s,...p)=>{const r=await x.query(conv(s),p);return{id:r.rows[0]&&r.rows[0].id,changes:r.rowCount}}});
  const db=mk(pool);db.tx=async f=>{const c=await pool.connect();try{await c.query('BEGIN');const v=await f(mk(c));await c.query('COMMIT');return v}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}};return db}
const url=process.env.DATABASE_URL,db=url?pg(url):sqlite();
db.ready=db.exec(DDL.replace(/\{PK\}/g,url?'SERIAL PRIMARY KEY':'INTEGER PRIMARY KEY'));
module.exports=db;
