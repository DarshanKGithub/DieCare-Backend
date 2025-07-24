const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Admin Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    if (email !== process.env.ADMIN_EMAIL) {
      return res.status(400).json({ message: 'Invalid admin email or password' });
    }

    if (password !== process.env.ADMIN_PASSWORD) {
      console.log(`[ADMIN LOGIN FAILED] Invalid Password for Email: ${email}`);
      return res.status(400).json({ message: 'Invalid admin email or password' });
    }

    const token = jwt.sign({ userId: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    console.log(`[ADMIN LOGIN SUCCESS] Email: ${email}, Role: admin`);
    res.json({ message: 'Admin login successful', token });
  } catch (error) {
    console.log(`[ADMIN LOGIN ERROR] ${error.message}`);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;