const express = require('express');
const router = express.Router();
const { authenticateToken, requireAdmin, hashPassword, comparePassword, generateToken } = require('../auth');
const { query, queryGet, queryRun } = require('./helpers');

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const failedLoginAttempts = new Map();

function getLoginAttemptKey(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isLoginRateLimited(req, res, next) {
  const key = getLoginAttemptKey(req);
  const now = Date.now();
  const attempts = failedLoginAttempts.get(key);
  if (attempts && now - attempts.firstAttemptAt < LOGIN_WINDOW_MS &&
      attempts.count >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'محاولات تسجيل الدخول كثيرة. يرجى الانتظار 15 دقيقة.' });
  }
  if (attempts && now - attempts.firstAttemptAt >= LOGIN_WINDOW_MS) {
    failedLoginAttempts.delete(key);
  }
  next();
}

function recordFailedLogin(req) {
  const now = Date.now();
  const key = getLoginAttemptKey(req);
  const current = failedLoginAttempts.get(key);
  if (!current || now - current.firstAttemptAt >= LOGIN_WINDOW_MS) {
    if (failedLoginAttempts.size >= 10_000) {
      const oldestKey = failedLoginAttempts.keys().next().value;
      if (oldestKey !== undefined) failedLoginAttempts.delete(oldestKey);
    }
    failedLoginAttempts.set(key, { firstAttemptAt: now, count: 1 });
  } else {
    current.count += 1;
  }
}

router.post('/login', isLoginRateLimited, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (typeof username !== 'string' || typeof password !== 'string' ||
        !username.trim() || !password || username.length > 80 || password.length > 128) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    const user = await queryGet('SELECT id, username, password_hash, role FROM users WHERE username = ?', [username.trim()]);

    if (!user) {
      recordFailedLogin(req);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const passwordMatch = comparePassword(password, user.password_hash);

    if (!passwordMatch) {
      recordFailedLogin(req);
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    failedLoginAttempts.delete(getLoginAttemptKey(req));
    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login failed due to a server error:', error.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/setup-admin', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (typeof username !== 'string' || typeof password !== 'string' ||
        !username.trim() || username.trim().length > 80 || password.length > 128) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }
    if (password.length < 12) {
      return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 12 حرفاً' });
    }

    const passwordHash = hashPassword(password);
    const result = await require('../database').transaction(async ({ query }) => {
      await query('SELECT pg_advisory_xact_lock(?)', [834756214]);
      const users = await query('SELECT COUNT(*)::integer AS count FROM users');
      if (users.rows[0].count > 0) {
        const error = new Error('تم إعداد حساب المسؤول مسبقاً');
        error.statusCode = 409;
        throw error;
      }
      return query(
        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id',
        [username.trim(), passwordHash, 'admin']
      );
    });

    res.status(201).json({ message: 'تم إنشاء حساب المسؤول بنجاح', userId: result.rows[0].id });
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ error: error.message });
    }
    console.error('Admin setup failed:', error.message);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

router.get('/employees', authenticateToken, requireAdmin, async (_req, res) => {
  try {
    const employees = await query(
      "SELECT id, username, role, created_at FROM users WHERE role = 'employee' ORDER BY created_at DESC, id DESC"
    );
    res.json({ employees });
  } catch (error) {
    console.error('Employee list failed:', error.code || error.name);
    res.status(500).json({ error: 'تعذر تحميل حسابات الموظفين' });
  }
});

router.post('/employees', authenticateToken, requireAdmin, async (req, res) => {
  const { username, password, confirmPassword } = req.body;
  if (typeof username !== 'string' || !username.trim() || username.trim().length > 80 ||
      typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return res.status(400).json({ error: 'أدخل اسم مستخدم وكلمة مرور بين 12 و128 حرفاً' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'تأكيد كلمة المرور غير مطابق' });
  }
  try {
    // The role is always assigned here; callers cannot create another administrator.
    const result = await queryRun(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id',
      [username.trim(), hashPassword(password), 'employee']
    );
    res.status(201).json({ user: { id: result.lastID, username: username.trim(), role: 'employee' } });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'اسم المستخدم مستخدم مسبقاً' });
    console.error('Employee creation failed:', error.code || error.name);
    res.status(500).json({ error: 'تعذر إنشاء حساب الموظف' });
  }
});

router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة غير متطابقة مع التأكيد' });
    }

    if (newPassword.length < 12 || newPassword.length > 128) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون بين 12 و128 حرفاً' });
    }

    const user = await queryGet('SELECT * FROM users WHERE id = ?', [req.user.id]);

    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (!comparePassword(currentPassword, user.password_hash)) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }

    const newPasswordHash = hashPassword(newPassword);

    await queryRun(
      'UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newPasswordHash, req.user.id]
    );

    res.json({ message: 'تم تغيير كلمة المرور بنجاح' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

module.exports = router;
