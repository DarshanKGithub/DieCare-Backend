const express = require('express');
const router = express.Router();
const pool = require('../db'); // Use the existing pool from db.js
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();



// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../Uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!['employee', 'hod', 'admin', 'quality'].includes(decoded.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    req.user = decoded;
    next();
  } catch (error) {
    console.error(`[AUTH ERROR] Invalid token: ${error.message}`);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Create a new part
router.post('/', verifyToken, upload.array('images', 5), async (req, res) => {
  const { partName, companyName, sapCode, description, location } = req.body;
  const imagePaths = req.files ? req.files.map(file => file.path) : [];

  if (!partName || !companyName || !sapCode || !description || !location) {
    return res.status(400).json({ message: 'All fields (partName, companyName, sapCode, description, location) are required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO products (part_name, company_name, sap_code, description, location, image_paths) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [partName, companyName, sapCode, description, location, imagePaths]
    );
    console.log(`[PART CREATED] Serial Number: ${result.rows[0].serial_number}, Part: ${partName}`);
    res.status(201).json({ part: result.rows[0] });
  } catch (error) {
    console.error(`[PART ERROR] Error adding part: ${error.message}`, {
      stack: error.stack,
      body: req.body,
      files: req.files ? req.files.map(f => f.originalname) : [],
    });
    res.status(500).json({ message: 'Failed to add part', error: error.message });
  }
});

// Get all parts
router.get('/', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products ORDER BY serial_number ASC');
    res.json(result.rows);
  } catch (error) {
    console.error(`[PART ERROR] Error fetching parts: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: 'Failed to fetch parts', error: error.message });
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
    console.error(`[PART ERROR] Error fetching part: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: 'Failed to fetch part', error: error.message });
  }
});

// Update a part
router.put('/:serialNumber', verifyToken, upload.array('images', 5), async (req, res) => {
  const { serialNumber } = req.params;
  const { partName, companyName, sapCode, description, location } = req.body;
  const newImagePaths = req.files ? req.files.map(file => file.path) : [];

  try {
    const existingPart = await pool.query('SELECT image_paths FROM products WHERE serial_number = $1', [serialNumber]);
    if (existingPart.rows.length === 0) {
      return res.status(404).json({ message: 'Part not found' });
    }

    const currentImagePaths = existingPart.rows[0].image_paths || [];
    const updatedImagePaths = [...currentImagePaths, ...newImagePaths];

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
    if (sapCode) {
      updates.push(`sap_code = $${paramCount++}`);
      values.push(sapCode);
    }
    if (description) {
      updates.push(`description = $${paramCount++}`);
      values.push(description);
    }
    if (location) {
      updates.push(`location = $${paramCount++}`);
      values.push(location);
    }
    if (newImagePaths.length > 0) {
      updates.push(`image_paths = $${paramCount++}`);
      values.push(updatedImagePaths);
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
    console.log(`[PART UPDATED] Serial Number: ${serialNumber}, Part: ${partName || result.rows[0].part_name}`);
    res.json({ part: result.rows[0] });
  } catch (error) {
    console.error(`[PART ERROR] Error updating part: ${error.message}`, {
      stack: error.stack,
      body: req.body,
      files: req.files ? req.files.map(f => f.originalname) : [],
    });
    res.status(500).json({ message: 'Failed to update part', error: error.message });
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
    console.log(`[PART DELETED] Serial Number: ${serialNumber}`);
    res.json({ message: 'Part deleted successfully' });
  } catch (error) {
    console.error(`[PART ERROR] Error deleting part: ${error.message}`, { stack: error.stack });
    res.status(500).json({ message: 'Failed to delete part', error: error.message });
  }
});

module.exports = router;