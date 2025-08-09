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

// Registration Endpoint
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

  const validRoles = ['Admin', 'HOD', 'Employee', 'Quality'];
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
      RETURNING id, email, name, role
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

// Example Protected Route (Admin Only)
router.get('/admin', verifyToken, restrictTo('Admin'), async (req, res) => {
  logger.info(`Admin route accessed by user: ${req.user.email}`);
  res.json({ message: 'Welcome, Admin!', user: req.user });
});

module.exports = router;