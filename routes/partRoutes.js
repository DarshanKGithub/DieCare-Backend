const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
require('dotenv').config();

// Database connection
const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!['employee', 'hod', 'admin'].includes(decoded.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Create a new part
router.post('/', verifyToken, async (req, res) => {
  const { partName, companyName } = req.body;

  if (!partName || !companyName) {
    return res.status(400).json({ message: 'Part name and company name are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO products (part_name, company_name) VALUES ($1, $2) RETURNING *',
      [partName, companyName]
    );
    res.status(201).json({ part: result.rows[0] });
  } catch (error) {
    console.error('Error adding part:', error);
    res.status(500).json({ message: 'Failed to add part' });
  }
});

// Get all parts
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY serial_number ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching parts:', error);
    res.status(500).json({ message: 'Failed to fetch parts' });
  }
});

// Get a single part by serial_number
router.get('/:serialNumber', verifyToken, async (req, res) => {
  const { serialNumber } = req.params;
  try {
    const result = await pool.query('SELECT * FROM products WHERE serial_number = $1', [serialNumber]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Part not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching part:', error);
    res.status(500).json({ message: 'Failed to fetch part' });
  }
});

// Update a part
router.put('/:serialNumber', verifyToken, async (req, res) => {
  const { serialNumber } = req.params;
  const { partName, companyName } = req.body;

  try {
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (partName) {
      updates.push(`part_name = $${paramCount++}`);
      values.push(partName);
    }
    if (companyName) {
      updates.push(`company_name = $${paramCount++}`);
      values.push(companyName);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields provided for update' });
    }

    values.push(serialNumber);
    const query = `UPDATE products SET ${updates.join(', ')} WHERE serial_number = $${paramCount} RETURNING *`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Part not found' });
    }
    res.json({ part: result.rows[0] });
  } catch (error) {
    console.error('Error updating part:', error);
    res.status(500).json({ message: 'Failed to update part' });
  }
});

// Delete a part
router.delete('/:serialNumber', verifyToken, async (req, res) => {
  const { serialNumber } = req.params;
  try {
    const result = await pool.query('DELETE FROM products WHERE serial_number = $1 RETURNING *', [serialNumber]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Part not found' });
    }
    res.json({ message: 'Part deleted successfully' });
  } catch (error) {
    console.error('Error deleting part:', error);
    res.status(500).json({ message: 'Failed to delete part' });
  }
});

module.exports = router;