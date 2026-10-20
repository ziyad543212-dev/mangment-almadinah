const express = require('express');
const router = express.Router();
const { authenticateToken, hashPassword, comparePassword, generateToken } = require('../auth');
const { queryGet, queryRun } = require('./helpers');

router.post('/login', async (req, res) => {
  try {
    console.log('=== Login Attempt ===');
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    const user = await queryGet('SELECT * FROM users WHERE username = ?', [username]);

    if (!user) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

    const passwordMatch = comparePassword(password, user.password_hash);

    if (!passwordMatch) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
    }

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
    console.error('Login error details:', error);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.post('/setup-admin', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'الرجاء إدخال اسم المستخدم وكلمة المرور' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    const users = await queryGet('SELECT COUNT(*) AS count FROM users');
    if (parseInt(users.count) > 0) {
      return res.status(409).json({ error: 'تم إعداد حساب المسؤول مسبقاً' });
    }

    const passwordHash = hashPassword(password);

    const result = await queryRun(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, passwordHash, 'admin']
    );

    res.json({ message: 'تم إنشاء حساب المسؤول بنجاح', userId: result.lastID });
  } catch (err) {
    console.error('Setup admin error:', err);
    res.status(500).json({ error: 'خطأ في الخادم' });
  }
});

router.get('/verify', authenticateToken, (req, res) => {
  res.json({ user: req.user });
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

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' });
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
