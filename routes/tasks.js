const express = require('express');
const winston = require('winston');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const router = express.Router();

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

const uploadDir = 'Uploads/images';
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image! Please upload only images.'), false);
    }
  }
});

router.post('/', verifyToken, upload.array('images', 5), async (req, res) => {
  const { partName, companyName, sapCode, location, comments } = req.body;

  if (!partName || !sapCode || !location) {
    if (req.files) req.files.forEach(file => fs.unlinkSync(file.path));
    return res.status(400).json({ error: 'Part Name, SAP Code, and Location are required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const partResult = await client.query('SELECT id, part_name, company_name, sap_code FROM parts WHERE sap_code = $1', [sapCode]);
    if (partResult.rows.length === 0) {
      throw new Error('Part with the given SAP Code not found.');
    }
    const part = partResult.rows[0];

    const imageUrls = req.files ? req.files.map(file => file.path) : [];

    const query = `
      INSERT INTO quality_tasks (part_id, location, comments, image_urls, created_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      RETURNING id, part_id, location, comments, image_urls, created_at
    `;
    const values = [part.id, location, comments || null, imageUrls];
    const taskResult = await client.query(query, values);
    const task = taskResult.rows[0];

    // Create notifications
    const roles = ['HOD', 'PDC', 'Employee'];
    const notificationQuery = `
      INSERT INTO notifications (task_id, part_name, company_name, sap_code, location, comments, recipient_role, read, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, CURRENT_TIMESTAMP)
    `;
    for (const role of roles) {
      await client.query(notificationQuery, [
        task.id,
        part.part_name,
        part.company_name,
        part.sap_code,
        task.location,
        task.comments,
        role
      ]);
      req.io.to(`role:${role}`).emit(`notification:${role}`, {
        id: task.id, // Use task.id as a placeholder; actual notification ID would be better
        task_id: task.id,
        part_name: part.part_name,
        company_name: part.company_name,
        sap_code: part.sap_code,
        location: task.location,
        comments: task.comments,
        recipient_role: role,
        read: false,
        created_at: new Date()
      });
    }

    await client.query('COMMIT');
    logger.info(`New quality task created by ${req.user.email} for part ID ${part.id}`);
    res.status(201).json({
      success: true,
      task: {
        id: task.id,
        partName: part.part_name,
        companyName: part.company_name,
        sapCode: part.sap_code,
        location: task.location,
        comments: task.comments,
        image_urls: task.image_urls,
        created_at: task.created_at
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (req.files) req.files.forEach(file => fs.unlinkSync(file.path));
    logger.error(`Error creating task: ${error.message}`);
    res.status(500).json({ success: false, error: 'Server error while creating task.' });
  } finally {
    client.release();
  }
});

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
        qt.created_at DESC
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