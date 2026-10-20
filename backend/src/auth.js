const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be configured in production');
}

const JWT_SECRET = process.env.JWT_SECRET || 'almadinah_secure_fallback_secret_key_2024';

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function comparePassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function generateToken(user) {
  try {
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    console.log('Token generated for user:', user.username);
    return token;
  } catch (error) {
    console.error('Error generating token:', error);
    throw error;
  }
}

function verifyToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('Token verified successfully for user:', decoded.username);
    return decoded;
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return null;
  }
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  console.log('Auth header present:', !!authHeader);
  console.log('Token present:', !!token);

  if (!token) {
    console.warn('No token provided in request');
    return res.status(401).json({ error: 'الرجاء تسجيل الدخول' });
  }

  try {
    const decoded = verifyToken(token);
    if (!decoded) {
      console.warn('Invalid or expired token');
      return res.status(403).json({ error: 'رمز المصادقة غير صالح' });
    }

    // Verify user still exists in database
    db.get('SELECT id, username, role FROM users WHERE id = ?', [decoded.id], (err, user) => {
      if (err) {
        console.error('Database error verifying user:', err);
        return res.status(500).json({ error: 'خطأ في الخادم' });
      }

      if (!user) {
        console.warn('User no longer exists in database:', decoded.username);
        return res.status(401).json({ error: 'المستخدم غير موجود' });
      }

      // Attach fresh user data to request
      req.user = {
        id: user.id,
        username: user.username,
        role: user.role
      };

      console.log('User authenticated:', user.username);
      next();
    });
  } catch (error) {
    console.error('CRITICAL LOGIN ERROR:', error);
    res.status(500).json({ error: 'خطأ في الخادم: ' + error.message });
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  authenticateToken
};
