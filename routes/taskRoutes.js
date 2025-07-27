const express = require('express');
const router = express.Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!['quality', 'employee', 'hod'].includes(decoded.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    console.error(`[TASK ERROR] Invalid token: ${error.message}`);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Create a new task
router.post('/', verifyToken, async (req, res) => {
  if (req.user.role !== 'quality') {
    return res.status(403).json({ message: 'Only quality role can create tasks' });
  }

  const { partId, partName, companyName, sapCode, description, location, status, createdBy } = req.body;

  if (!partId || !partName || !companyName || !sapCode || !description || !location || !status || !createdBy) {
    return res.status(400).json({ message: 'All fields (partId, partName, companyName, sapCode, description, location, status, createdBy) are required' });
  }

  try {
    const part = await pool.query('SELECT * FROM products WHERE serial_number = $1', [partId]);
    if (part.rows.length === 0) {
      return res.status(404).json({ message: 'Part not found' });
    }

    const result = await pool.query(
      'INSERT INTO tasks (part_id, part_name, company_name, sap_code, description, location, status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [partId, partName, companyName, sapCode, description, location, status, createdBy]
    );

    console.log(`[TASK CREATED] Task ID: ${result.rows[0].id}, Part: ${partName}`);
    res.status(201).json({ task: result.rows[0] });
  } catch (error) {
    console.error(`[TASK ERROR] Error creating task: ${error.message}`);
    res.status(500).json({ message: 'Failed to create task' });
  }
});

// Get all tasks
router.get('/', verifyToken, async (req, res) => {
  try {
    let query = 'SELECT * FROM tasks';
    const values = [];

    if (req.user.role === 'employee') {
      query += ' WHERE created_by != $1';
      values.push(req.user.role);
    }

    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, values);
    res.json(result.rows);
  } catch (error) {
    console.error(`[TASK ERROR] Error fetching tasks: ${error.message}`);
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
});

// Get task by ID
router.get('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(`[TASK ERROR] Error fetching task: ${error.message}`);
    res.status(500).json({ message: 'Failed to fetch task' });
  }
});

module.exports = router;