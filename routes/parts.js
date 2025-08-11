const express = require('express');
const winston = require('winston');
const pool = require('../db'); // Assuming db.js is in the parent directory
const { verifyToken, restrictTo } = require('../middleware/auth'); // Import auth middleware
const router = express.Router();

// Logger setup (consistent with your other files)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: process.env.LOG_FILE_PATH || 'app.log' }),
    new winston.transports.Console()
  ],
});

// 1. CREATE a new part (POST /api/parts)
// Restricted to Admin and HOD roles
router.post('/', verifyToken, restrictTo('Admin', 'HOD'), async (req, res) => {
  const { part_name, company_name, sap_code } = req.body;

  // --- Validation ---
  if (!part_name || !sap_code) {
    logger.warn(`Part creation failed: Missing required fields.`);
    return res.status(400).json({ error: 'Part Name and SAP Code are required' });
  }

  try {
    // Check for duplicate SAP Code
    const sapCheck = await pool.query('SELECT id FROM parts WHERE sap_code = $1', [sap_code]);
    if (sapCheck.rows.length > 0) {
      logger.warn(`Part creation failed: SAP Code '${sap_code}' already exists.`);
      return res.status(400).json({ error: 'SAP Code already exists' });
    }

    // --- Insert into database ---
    const query = `
      INSERT INTO parts (part_name, company_name, sap_code)
      VALUES ($1, $2, $3)
      RETURNING *
    `;
    const values = [part_name, company_name || null, sap_code];
    const result = await pool.query(query, values);

    logger.info(`New part created by ${req.user.email}: ${JSON.stringify(result.rows[0])}`);
    res.status(201).json({ message: 'Part created successfully', part: result.rows[0] });

  } catch (error) {
    logger.error(`Error creating part: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});


// 2. READ all parts (GET /api/parts)
// Accessible to any authenticated user
router.get('/', verifyToken, async (req, res) => {
  try {
    const query = 'SELECT * FROM parts ORDER BY created_at DESC';
    const result = await pool.query(query);

    logger.info(`All parts retrieved by ${req.user.email}.`);
    res.json({ message: 'Parts retrieved successfully', count: result.rows.length, parts: result.rows });

  } catch (error) {
    logger.error(`Error fetching parts: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});


// 3. READ a single part by ID (GET /api/parts/:id)
// Accessible to any authenticated user
router.get('/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const query = 'SELECT * FROM parts WHERE id = $1';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      logger.warn(`Part with ID ${id} not found. Attempted access by ${req.user.email}.`);
      return res.status(404).json({ error: 'Part not found' });
    }

    logger.info(`Part ID ${id} retrieved by ${req.user.email}.`);
    res.json({ message: 'Part retrieved successfully', part: result.rows[0] });

  } catch (error) {
    logger.error(`Error fetching part ${id}: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});


// 4. UPDATE a part by ID (PUT /api/parts/:id)
// Restricted to Admin and HOD roles
router.put('/:id', verifyToken, restrictTo('Admin', 'HOD'), async (req, res) => {
  const { id } = req.params;
  const { part_name, company_name, sap_code } = req.body;

  // --- Validation ---
  if (!part_name && !company_name && !sap_code) {
      return res.status(400).json({ error: 'At least one field to update is required.' });
  }

  try {
    // Check if part exists
    const partCheck = await pool.query('SELECT * FROM parts WHERE id = $1', [id]);
    if (partCheck.rows.length === 0) {
      logger.warn(`Update failed: Part with ID ${id} not found.`);
      return res.status(404).json({ error: 'Part not found' });
    }

    // Check if the new sap_code is already taken by another part
    if (sap_code) {
      const sapCheck = await pool.query('SELECT id FROM parts WHERE sap_code = $1 AND id != $2', [sap_code, id]);
      if (sapCheck.rows.length > 0) {
          logger.warn(`Update failed: SAP Code '${sap_code}' is already in use.`);
          return res.status(400).json({ error: 'SAP Code already in use' });
      }
    }

    // --- Dynamically build the update query ---
    const oldPart = partCheck.rows[0];
    const newPart = {
        part_name: part_name || oldPart.part_name,
        company_name: company_name || oldPart.company_name,
        sap_code: sap_code || oldPart.sap_code
    };

    const query = `
      UPDATE parts 
      SET part_name = $1, company_name = $2, sap_code = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 
      RETURNING *
    `;
    const values = [newPart.part_name, newPart.company_name, newPart.sap_code, id];
    const result = await pool.query(query, values);

    logger.info(`Part ID ${id} updated by ${req.user.email}.`);
    res.json({ message: 'Part updated successfully', part: result.rows[0] });

  } catch (error) {
    logger.error(`Error updating part ${id}: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});


// 5. DELETE a part by ID (DELETE /api/parts/:id)
// Restricted to Admin role only
router.delete('/:id', verifyToken, restrictTo('Admin'), async (req, res) => {
  const { id } = req.params;
  try {
    const query = 'DELETE FROM parts WHERE id = $1 RETURNING *';
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      logger.warn(`Delete failed: Part with ID ${id} not found. Attempt by ${req.user.email}.`);
      return res.status(404).json({ error: 'Part not found' });
    }

    logger.info(`Part ID ${id} (${result.rows[0].part_name}) deleted by ${req.user.email}.`);
    res.json({ message: 'Part deleted successfully' });
    
  } catch (error) {
    // Catch potential foreign key constraint errors if parts are linked to other tables
    if (error.code === '23503') { 
        logger.error(`Attempt to delete part ${id} failed due to existing references: ${error.detail}`);
        return res.status(409).json({ error: 'Cannot delete part because it is referenced by other records.' });
    }
    logger.error(`Error deleting part ${id}: ${error.message}`);
    res.status(500).json({ error: 'Server error' });
  }
});


module.exports = router;