const express = require('express');
const winston = require('winston');
const pool = require('../db');
const { verifyToken } = require('../middleware/auth');

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

// GET /api/notifications - Fetch notifications for the user
router.get('/', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT id, task_id, part_name, company_name, sap_code, location, comments, recipient_role, read, created_at
      FROM notifications
      WHERE recipient_role = $1 OR recipient_role = 'all'
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [req.user.role]);
    logger.info(`Fetched ${result.rows.length} notifications for user ${req.user.email}`);
    res.json({ success: true, notifications: result.rows });
  } catch (error) {
    logger.error(`Error fetching notifications for ${req.user.email}: ${error.message}`);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// PATCH /api/notifications/:id/read - Mark a notification as read
router.patch('/:id/read', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const query = 'UPDATE notifications SET read = TRUE WHERE id = $1 AND (recipient_role = $2 OR recipient_role = \'all\') RETURNING *';
    const result = await pool.query(query, [id, req.user.role]);
    if (result.rows.length === 0) {
      logger.warn(`Notification ${id} not found or not accessible for ${req.user.email}`);
      return res.status(404).json({ error: 'Notification not found or not accessible' });
    }
    logger.info(`Notification ${id} marked as read by ${req.user.email}`);
    res.json({ success: true, notification: result.rows[0] });
  } catch (error) {
    logger.error(`Error marking notification ${id} as read: ${error.message}`);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// DELETE /api/notifications/clear - Clear all notifications for the user
router.delete('/clear', verifyToken, async (req, res) => {
  try {
    const query = 'DELETE FROM notifications WHERE recipient_role = $1 OR recipient_role = \'all\'';
    await pool.query(query, [req.user.role]);
    logger.info(`Cleared notifications for ${req.user.email}`);
    res.json({ success: true, message: 'Notifications cleared' });
  } catch (error) {
    logger.error(`Error clearing notifications for ${req.user.email}: ${error.message}`);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;