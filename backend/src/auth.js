const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || (process.env.NODE_ENV === 'production' && JWT_SECRET.length < 32)) {
  throw new Error('Configure JWT_SECRET with at least 32 characters before starting the backend');
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authenticateToken(req, res, next) {
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'الرجاء تسجيل الدخول' });
  }

  const decoded = verifyToken(match[1]);
  if (!decoded || !Number.isSafeInteger(Number(decoded.id))) {
    return res.status(401).json({ error: 'رمز المصادقة غير صالح أو منتهي الصلاحية' });
  }

  db.get('SELECT id, username, role FROM users WHERE id = ?', [decoded.id], (err, user) => {
    if (err) {
      console.error('Database error while authenticating a request:', err.message);
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }

    if (!user) {
      return res.status(401).json({ error: 'المستخدم غير موجود' });
    }

    req.user = { id: user.id, username: user.username, role: user.role };
    res.set?.('Cache-Control', 'no-store');
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'هذه العملية متاحة للمسؤول فقط' });
  }
  next();
}

function requireStaff(req, res, next) {
  if (!['admin', 'employee'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'ليس لديك صلاحية تنفيذ هذه العملية' });
  }
  next();
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  authenticateToken,
  requireAdmin,
  requireStaff
};
