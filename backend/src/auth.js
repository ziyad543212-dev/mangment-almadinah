const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./database');

// Use a persistent JWT secret - never change this in production without invalidating all tokens
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-key-in-production-123456789';

console.log('JWT_SECRET configured:', JWT_SECRET ? 'Yes' : 'No (using default)');

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
    console.error('Authentication error:', error);
    return res.status(500).json({ error: 'خطأ في الخادم' });
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  authenticateToken
};
