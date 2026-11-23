'use strict';
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new Database(path.join(dataDir, 'vantuong.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 username TEXT PRIMARY KEY COLLATE NOCASE,
 full_name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('admin','receiver','processor','viewer')),
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS records (
 id TEXT PRIMARY KEY,
 payload TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const initialPassword = process.env.INITIAL_ADMIN_PASSWORD;
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  if (!initialPassword || initialPassword.length < 14 || initialPassword.includes('REPLACE_')) {
    console.error('Set INITIAL_ADMIN_PASSWORD (at least 14 characters) before first start.');
    process.exit(1);
  }
  db.prepare('INSERT INTO users(username,full_name,role,password_hash) VALUES(?,?,?,?)')
    .run('admin', 'Quản trị viên Vạn Tường', 'admin', bcrypt.hashSync(initialPassword, 12));
  console.log('Initial admin created. Sign in as admin and change the password.');
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || process.env.SESSION_SECRET.includes('REPLACE_')) {
  console.error('Set SESSION_SECRET to a random secret of at least 32 characters.'); process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'],
  objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
} } }));
app.use(express.json({ limit: '12mb' }));
app.use(session({
  name: 'vt.sid', secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir, table: 'sessions' }),
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 }
}));
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Quá nhiều lần đăng nhập. Vui lòng thử lại sau.' } });
const roles = ['admin','receiver','processor','viewer'];
function publicUser(u) { return { username: u.username, fullName: u.full_name, role: u.role }; }
function requireAuth(req,res,next) { if (!req.session.user) return res.status(401).json({error:'Vui lòng đăng nhập.'}); next(); }
function requireRole(...allowed) { return (req,res,next) => { if (!req.session.user || !allowed.includes(req.session.user.role)) return res.status(403).json({error:'Bạn không có quyền thực hiện thao tác này.'}); next(); }; }
function csrf(req,res,next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const token = req.get('x-csrf-token');
  if (!req.session.csrf || !token || token.length !== req.session.csrf.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.csrf))) return res.status(403).json({error:'Phiên bảo mật không hợp lệ. Hãy tải lại trang.'});
  next();
}
app.use('/api', csrf);
app.get('/api/session', (req,res) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.json({ user: req.session.user || null, csrfToken: req.session.csrf });
});
app.post('/api/login', loginLimiter, (req,res,next) => {
  const username = String(req.body.username || '').trim(); const password = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({error:'Tên đăng nhập hoặc mật khẩu không đúng.'});
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.user = publicUser(u); req.session.csrf = crypto.randomBytes(32).toString('hex');
    req.session.save(e => e ? next(e) : res.json({user:req.session.user, csrfToken:req.session.csrf}));
  });
});
app.post('/api/logout', requireAuth, (req,res,next) => req.session.destroy(err => err ? next(err) : res.clearCookie('vt.sid', {httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict'}).json({ok:true})));
app.post('/api/change-password', requireAuth, (req,res) => {
  const oldPassword = String(req.body.oldPassword || ''); const newPassword = String(req.body.newPassword || '');
  if (newPassword.length < 12) return res.status(400).json({error:'Mật khẩu mới phải có ít nhất 12 ký tự.'});
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.session.user.username);
  if (!u || !bcrypt.compareSync(oldPassword,u.password_hash)) return res.status(400).json({error:'Mật khẩu hiện tại không đúng.'});
  db.prepare('UPDATE users SET password_hash=? WHERE username=?').run(bcrypt.hashSync(newPassword,12),u.username);
  res.json({ok:true});
});
app.get('/api/records', requireAuth, (req,res) => {
  const rows = db.prepare('SELECT payload FROM records ORDER BY updated_at DESC').all();
  res.json(rows.map(x => JSON.parse(x.payload)));
});
app.put('/api/records/:id', requireAuth, (req,res) => {
  const role = req.session.user.role;
  const exists = db.prepare('SELECT 1 FROM records WHERE id=?').get(req.params.id);
  if (!exists && !['admin','receiver'].includes(role)) return res.status(403).json({error:'Vai trò của bạn không được tiếp nhận hồ sơ.'});
  if (exists && !['admin','receiver','processor'].includes(role)) return res.status(403).json({error:'Vai trò của bạn không được sửa hồ sơ.'});
  const r = req.body;
  if (!r || r.id !== req.params.id || !r.applicantName || !r.recordNumber || !r.receiveDate || !r.dueDate) return res.status(400).json({error:'Dữ liệu hồ sơ không hợp lệ.'});
  if (JSON.stringify(r).length > 10_000_000) return res.status(413).json({error:'Dữ liệu/ảnh quá lớn.'});
  db.prepare(`INSERT INTO records(id,payload,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=CURRENT_TIMESTAMP`).run(r.id,JSON.stringify(r));
  res.json({ok:true});
});
app.delete('/api/records/:id', requireAuth, requireRole('admin'), (req,res) => {
  db.prepare('DELETE FROM records WHERE id=?').run(req.params.id); res.json({ok:true});
});
app.get('/api/users', requireAuth, requireRole('admin'), (req,res) => {
  res.json(db.prepare('SELECT username,full_name,role FROM users ORDER BY username').all().map(publicUser));
});
app.post('/api/users', requireAuth, requireRole('admin'), (req,res) => {
  const username=String(req.body.username||'').trim(); const fullName=String(req.body.fullName||'').trim(); const password=String(req.body.password||''); const role=String(req.body.role||'');
  if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username) || !fullName || password.length<12 || !roles.includes(role)) return res.status(400).json({error:'Thông tin tài khoản không hợp lệ. Tên đăng nhập 3–32 ký tự; mật khẩu ít nhất 12 ký tự.'});
  try { db.prepare('INSERT INTO users(username,full_name,role,password_hash) VALUES(?,?,?,?)').run(username,fullName,role,bcrypt.hashSync(password,12)); }
  catch(e) { if (String(e).includes('UNIQUE')) return res.status(409).json({error:'Tên đăng nhập đã tồn tại.'}); throw e; }
  res.json({ok:true});
});
app.patch('/api/users/:username', requireAuth, requireRole('admin'), (req,res) => {
  const role=String(req.body.role||''); if (!roles.includes(role)) return res.status(400).json({error:'Vai trò không hợp lệ.'});
  if (req.params.username.toLowerCase()==='admin' && role!=='admin') return res.status(400).json({error:'Không thể hạ quyền tài khoản admin gốc.'});
  const result=db.prepare('UPDATE users SET role=? WHERE username=?').run(role,req.params.username);
  if (!result.changes) return res.status(404).json({error:'Không tìm thấy tài khoản.'}); res.json({ok:true});
});
app.delete('/api/users/:username', requireAuth, requireRole('admin'), (req,res) => {
  if (req.params.username.toLowerCase()==='admin' || req.params.username===req.session.user.username) return res.status(400).json({error:'Không thể xóa tài khoản admin gốc hoặc tài khoản đang đăng nhập.'});
  db.prepare('DELETE FROM users WHERE username=?').run(req.params.username); res.json({ok:true});
});
app.get('/healthz', (req,res) => res.status(200).send('ok'));
app.use(express.static(path.join(__dirname,'public'), { extensions:['html'], maxAge:'1h' }));
app.use((err,req,res,next) => { console.error(err); res.status(500).json({error:'Lỗi máy chủ. Vui lòng thử lại.'}); });
const port=Number(process.env.PORT||3000); app.listen(port,'0.0.0.0',()=>console.log(`Vạn Tường server listening on ${port}`));
