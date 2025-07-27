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
    console.error(`[NOTIFICATION ERROR] Invalid token: ${error.message}`);
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// Create notifications
router.post('/', verifyToken, async (req, res) => {
  if (req.user.role !== 'quality') {
    return res.status(403).json({ message: 'Only quality role can send notifications' });
  }

  const { message, recipients, taskId } = req.body;

  if (!message || !recipients || !Array.isArray(recipients) || recipients.length === 0 || !taskId) {
    return res.status(400).json({ message: 'Message, taskId, and recipients array are required' });
  }

  const validRoles = ['employee', 'hod'];
  const invalidRecipients = recipients.filter(r => !validRoles.includes(r));
  if (invalidRecipients.length > 0) {
    return res.status(400).json({ message: `Invalid recipients: ${invalidRecipients.join(', ')}` });
  }

  try {
    // Verify task exists
    const task = await pool.query('SELECT * FROM tasks WHERE id = $1', [taskId]);
    if (task.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const insertPromises = recipients.map(recipient =>
      pool.query(
        'INSERT INTO notifications (message, recipient_role, task_id) VALUES ($1, $2, $3) RETURNING *',
        [message, recipient, taskId]
      )
    );

    const results = await Promise.all(insertPromises);
    const insertedNotifications = results.map(result => result.rows[0]);

    console.log(`[NOTIFICATION CREATED] Sent to: ${recipients.join(', ')}, Task ID: ${taskId}`);
    res.status(201).json({ notifications: insertedNotifications });
  } catch (error) {
    console.error(`[NOTIFICATION ERROR] Error creating notifications: ${error.message}`);
    res.status(500).json({ message: 'Failed to create notifications' });
  }
});

// Get notifications for a role
router.get('/:role', verifyToken, async (req, res) => {
  const { role } = req.params;

  if (!['employee', 'hod'].includes(role)) {
    return res.status(400).json({ message: 'Invalid role. Must be employee or hod' });
  }

  if (req.user.role !== role) {
    return res.status(403).json({ message: 'You can only fetch notifications for your own role' });
  }

  try {
    const result = await pool.query(
      'SELECT id, message, task_id, is_read, created_at FROM notifications WHERE recipient_role = $1 ORDER BY created_at DESC',
      [role]
    );
    res.json({ notifications: result.rows, count: result.rows.filter(n => !n.is_read).length });
  } catch (error) {
    console.error(`[NOTIFICATION ERROR] Error fetching notifications: ${error.message}`);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
router.put('/:id/read', verifyToken, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND recipient_role = $2 RETURNING *',
      [id, req.user.role]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Notification not found or not authorized' });
    }
    res.json({ notification: result.rows[0] });
  } catch (error) {
    console.error(`[NOTIFICATION ERROR] Error marking notification as read: ${error.message}`);
    res.status(500).json({ message: 'Failed to mark notification as read' });
  }
});

module.exports = router;