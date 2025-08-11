const express = require('express');
const winston = require('winston');
const pool =require('../db');
const { verifyToken } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

// --- Logger Setup (ensure consistency) ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [ new winston.transports.Console() ]
});

// --- Multer Configuration for Image Uploads ---
const uploadDir = 'uploads/images';
// Ensure the directory exists
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create a unique filename: fieldname-timestamp.extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
  fileFilter: (req, file, cb) => {
    // Allow only images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload only images.'), false);
    }
  }
});


// @route   POST /api/tasks
// @desc    Create a new quality task with image uploads
// @access  Private
router.post('/', verifyToken, upload.array('images', 5), async (req, res) => {
  const { sapCode, location, comments } = req.body;

  // --- Validation ---
  if (!sapCode || !location) {
    // If validation fails, delete any uploaded files to prevent orphans
    if (req.files) {
      req.files.forEach(file => fs.unlinkSync(file.path));
    }
    return res.status(400).json({ error: 'SAP Code and Location are required.' });
  }

  const client = await pool.connect();
  try {
    // 1. Find the part_id from the provided sapCode
    const partResult = await client.query('SELECT id FROM parts WHERE sap_code = $1', [sapCode]);
    if (partResult.rows.length === 0) {
      throw new Error('Part with the given SAP Code not found.');
    }
    const partId = partResult.rows[0].id;

    // 2. Get the paths of the uploaded images
    const imageUrls = req.files ? req.files.map(file => file.path) : [];

    // 3. Insert the new task into the database
    const query = `
      INSERT INTO quality_tasks (part_id, location, comments, image_urls)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const values = [partId, location, comments || null, imageUrls];
    const result = await client.query(query, values);

    logger.info(`New quality task created by ${req.user.email} for part ID ${partId}`);
    res.status(201).json({ message: 'Task created successfully', task: result.rows[0] });

  } catch (error) {
    // Clean up uploaded files if there's a database error
    if (req.files) {
      req.files.forEach(file => fs.unlinkSync(file.path));
    }
    logger.error(`Error creating task: ${error.message}`);
    res.status(500).json({ error: 'Server error while creating task.' });
  } finally {
    client.release();
  }
});

// @route   GET /api/tasks
// @desc    Get all quality tasks with part details
// @access  Private
router.get('/', verifyToken, async (req, res) => {
    try {
        const query = `
            SELECT
                qt.id,
                qt.location,
                qt.comments,
                qt.image_urls,
                qt.created_at,
                p.part_name,
                p.company_name,
                p.sap_code
            FROM
                quality_tasks qt
            JOIN
                parts p ON qt.part_id = p.id
            ORDER BY
                qt.created_at DESC;
        `;
        const result = await pool.query(query);

        logger.info(`Fetched ${result.rows.length} tasks for user ${req.user.email}`);
        res.status(200).json({ success: true, tasks: result.rows });

    } catch (error) {
        logger.error(`Error fetching tasks: ${error.message}`);
        res.status(500).json({ success: false, error: 'Server error while fetching tasks.' });
    }
});


module.exports = router;