const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const router = express.Router();

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'No token provided' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.log(`[AUTH ERROR] ${error.message}`);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Validate role
const validRoles = ['hod', 'employee', 'admin'];
const validateRole = (role) => validRoles.includes(role);

// Register
router.post('/register', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });

  const { name, email, contact_number, department_name, password, designation, role } = req.body;

  if (!validateRole(role)) return res.status(400).json({ message: 'Invalid role. Must be hod, employee, or admin' });

  try {
    const userExist = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExist.rows.length > 0) return res.status(400).json({ message: 'User already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await pool.query(
      'INSERT INTO users (name, email, contact_number, department_name, password, designation, role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, name, email, contact_number, department_name, designation, role',
      [name, email, contact_number, department_name, hashedPassword, designation, role]
    );

    console.log(`[REGISTER SUCCESS] User Registered: ${email}, Role: ${role}`);
    res.status(201).json({ message: 'User registered successfully', user: newUser.rows[0] });
  } catch (error) {
    console.log(`[REGISTER ERROR] ${error.message}`);
    res.status(500).json({ message: error.message });
  }
});

// Fetch Users by Role
router.get('/', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });

  const { role } = req.query;
  if (!validateRole(role)) return res.status(400).json({ message: 'Invalid role. Must be hod, employee, or admin' });

  try {
    const users = await pool.query(
      'SELECT id, name, email, contact_number, department_name, designation, role FROM users WHERE role = $1',
      [role]
    );
    res.json(users.rows);
  } catch (error) {
    console.log(`[FETCH USERS ERROR] ${error.message}`);
    res.status(500).json({ message: error.message });
  }
});

// Update User
router.put('/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });

  const { id } = req.params;
  const { name, email, contact_number, department_name, designation, role } = req.body;

  if (!validateRole(role)) return res.status(400).json({ message: 'Invalid role. Must be hod, employee, or admin' });

  try {
    const userExist = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userExist.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    const updatedUser = await pool.query(
      'UPDATE users SET name = $1, email = $2, contact_number = $3, department_name = $4, designation = $5, role = $6 WHERE id = $7 RETURNING id, name, email, contact_number, department_name, designation, role',
      [name, email, contact_number, department_name, designation, role, id]
    );

    console.log(`[UPDATE USER SUCCESS] User ID: ${id}, Email: ${email}`);
    res.json({ message: 'User updated successfully', user: updatedUser.rows[0] });
  } catch (error) {
    console.log(`[UPDATE USER ERROR] ${error.message}`);
    res.status(500).json({ message: error.message });
  }
});

// Delete User
router.delete('/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });

  const { id } = req.params;

  try {
    const userExist = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userExist.rows.length === 0) return res.status(404).json({ message: 'User not found' });

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    console.log(`[DELETE USER SUCCESS] User ID: ${id}`);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.log(`[DELETE USER ERROR] ${error.message}`);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;