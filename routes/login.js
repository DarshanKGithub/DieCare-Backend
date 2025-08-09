const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const validator = require('validator');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const pool = require('../db');

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

// Rate limiter for login
const limiter = rateLimit({
  windowMs: process.env.RATE_LIMIT_WINDOW_MS,
  max: process.env.RATE_LIMIT_MAX,
  message: 'Too many requests, please try again later.',
});

// Login Endpoint
router.post('/', limiter, async (req, res) => {
  const { email, password } = req.body;

  // Input validation
  if (!email || !password) {
    logger.warn(`Login attempt with missing fields: ${JSON.stringify(req.body)}`);
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (!validator.isEmail(String(email))) {
    logger.warn(`Invalid email format: ${email}`);
    return res.status(400).json({ error: 'Invalid email format' });
  }

  try {
    // Check if user exists
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    if (result.rows.length === 0) {
      logger.warn(`Login failed: Invalid email ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      logger.warn(`Login failed: Invalid password for ${email}`);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate access token
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '1h' }
    );

    // Generate refresh token
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // Store refresh token in database
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await pool.query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, refreshToken, expiresAt]
    );

    logger.info(`User logged in: ${email}`);
    res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (error) {
    logger.error(`Login error for ${email}: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});

// Refresh Token Endpoint
router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    logger.warn('Refresh token request without token');
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Check if refresh token exists in database
    const tokenQuery = 'SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND expires_at > NOW()';
    const tokenResult = await pool.query(tokenQuery, [refreshToken, decoded.id]);
    if (tokenResult.rows.length === 0) {
      logger.warn(`Invalid or expired refresh token for user_id: ${decoded.id}`);
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Fetch user
    const userQuery = 'SELECT id, email, role FROM users WHERE id = $1';
    const userResult = await pool.query(userQuery, [decoded.id]);
    if (userResult.rows.length === 0) {
      logger.warn(`User not found for id: ${decoded.id}`);
      return res.status(401).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Generate new access token
    const newAccessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '1h' }
    );

    logger.info(`Access token refreshed for user: ${user.email}`);
    res.json({ accessToken: newAccessToken });
  } catch (error) {
    logger.error(`Refresh token error: ${error.message}`);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

module.exports = router;