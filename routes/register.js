const express = require('express');
const bcrypt = require('bcrypt');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const pool = require('../db');
const { verifyToken, restrictTo } = require('../middleware/auth');

const router = express.Router();

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: process.env.LOG_FILE_PATH }),
    new winston.transports.Console()
  ],
});

// Rate limiter for registration
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS,
  max: process.env.RATE_LIMIT_MAX,
  message: 'Too many requests, please try again later.',
});

// Create User (POST /api/register)
router.post('/', limiter, async (req, res) => {
  const { email, name, phone_number, role, designation, password, confirm_password } = req.body;

  // Input sanitization and validation
  if (!email || !name || !role || !password || !confirm_password) {
    logger.warn(`Registration attempt with missing fields: ${JSON.stringify(req.body)}`);
    return res.status(400).json({ error: 'All required fields must be provided' });
  }

  if (!validator.isEmail(email)) {
    logger.warn(`Invalid email format: ${email}`);
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (phone_number && !validator.isMobilePhone(String(phone_number), 'any', { strictMode: true })) {
    logger.warn(`Invalid phone number format: ${phone_number}`);
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  if (password !== confirm_password) {
    logger.warn(`Password mismatch for email: ${email}`);
    return res.status(400).json({ error: 'Passwords do not match' });
  }

  const validRoles = ['Admin', 'HOD', 'Employee', 'Quality','PDC'];
  if (!validRoles.includes(role)) {
    logger.warn(`Invalid role: ${role}`);
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    // Check if email already exists
    const emailCheck = await pool.query('SELECT email FROM users WHERE email = $1', [email]);
    if (emailCheck.rows.length > 0) {
      logger.warn(`Email already exists: ${email}`);
      return res.status(400).json({ error: 'Email already exists' });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    const query = `
      INSERT INTO users (email, name, phone_number, role, designation, password, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id, email, name, role, designation, phone_number
    `;
    const values = [email, name, phone_number || null, role, designation || null, hashedPassword];
    const result = await pool.query(query, values);

    logger.info(`User registered: ${email}`);
    res.status(201).json({ message: 'User registered successfully', user: result.rows[0] });
  } catch (error) {
    logger.error(`Registration error for ${email}: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

// Read All Users (GET /api/register) - Admin only
router.get('/', verifyToken, restrictTo('Admin'), async (req, res) => {
  try {
    const query = 'SELECT id, email, name, role, designation, phone_number, created_at, updated_at FROM users';
    const result = await pool.query(query);
    logger.info(`Fetched ${result.rows.length} users by Admin: ${req.user.email}`);
    res.json({ message: 'Users retrieved successfully', users: result.rows });
  } catch (error) {
    logger.error(`Error fetching users: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

// Read Single User (GET /api/register/:id) - Admin or self
router.get('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id; // From JWT

  try {
    const query = 'SELECT id, email, name, role, designation, phone_number, created_at, updated_at FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      logger.warn(`User not found: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Allow Admin or the user themselves to access
    if (req.user.role !== 'Admin' && parseInt(id) !== userId) {
      logger.warn(`Access denied for user ${req.user.email} to fetch user ${id}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    logger.info(`User ${id} fetched by ${req.user.email}`);
    res.json({ message: 'User retrieved successfully', user: result.rows[0] });
  } catch (error) {
    logger.error(`Error fetching user ${id}: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update User (PUT /api/register/:id) - Admin or self
router.put('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id; // From JWT
  const { email, name, phone_number, role, designation, password } = req.body;

  // Input validation
  if (email && !validator.isEmail(email)) {
    logger.warn(`Invalid email format: ${email}`);
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (phone_number && !validator.isMobilePhone(String(phone_number), 'any', { strictMode: true })) {
    logger.warn(`Invalid phone number format: ${phone_number}`);
    return res.status(400).json({ error: 'Invalid phone number format' });
  }

  if (role && !['Admin', 'HOD', 'Employee', 'Quality','PDC'].includes(role)) {
    logger.warn(`Invalid role: ${role}`);
    return res.status(400).json({ error: 'Invalid role' });
  }

  // Only Admin can change role
  if (role && req.user.role !== 'Admin') {
    logger.warn(`Non-Admin ${req.user.email} attempted to change role for user ${id}`);
    return res.status(403).json({ error: 'Only Admin can change roles' });
  }

  // Allow Admin or the user themselves to update
  if (req.user.role !== 'Admin' && parseInt(id) !== userId) {
    logger.warn(`Access denied for user ${req.user.email} to update user ${id}`);
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    // Check if user exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      logger.warn(`User not found for update: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if email is taken by another user
    if (email) {
      const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1 AND id != $2', [email, id]);
      if (emailCheck.rows.length > 0) {
        logger.warn(`Email already in use: ${email}`);
        return res.status(400).json({ error: 'Email already in use' });
      }
    }

    // Prepare update query
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (email) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email);
    }
    if (name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (phone_number) {
      updates.push(`phone_number = $${paramIndex++}`);
      values.push(phone_number);
    }
    if (role && req.user.role === 'Admin') {
      updates.push(`role = $${paramIndex++}`);
      values.push(role);
    }
    if (designation) {
      updates.push(`designation = $${paramIndex++}`);
      values.push(designation);
    }
    if (password) {
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      updates.push(`password = $${paramIndex++}`);
      values.push(hashedPassword);
    }
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    if (updates.length === 1) {
      logger.warn(`No fields to update for user ${id}`);
      return res.status(400).json({ error: 'No valid fields provided for update' });
    }

    const query = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING id, email, name, role, designation, phone_number`;
    const result = await pool.query(query, values);

    logger.info(`User ${id} updated by ${req.user.email}`);
    res.json({ message: 'User updated successfully', user: result.rows[0] });
  } catch (error) {
    logger.error(`Error updating user ${id}: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete User (DELETE /api/register/:id) - Admin only
router.delete('/:id', verifyToken, restrictTo('Admin'), async (req, res) => {
  const { id } = req.params;

  try {
    // Check if user exists
    const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      logger.warn(`User not found for deletion: ${id}`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete associated refresh tokens
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = $1', [id]);

    // Delete user
    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    logger.info(`User ${id} deleted by Admin: ${req.user.email}`);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    logger.error(`Error deleting user ${id}: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;