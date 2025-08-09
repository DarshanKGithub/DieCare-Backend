const express = require('express');
const cors = require('cors'); // 1. Import the cors package
const registerRoutes = require('./routes/register');
const loginRoutes = require('./routes/login');
const winston = require('winston');
require('dotenv').config();

const app = express();

// 2. Configure CORS Options
const corsOptions = {
  // This should be the URL of your Next.js frontend application
  origin: 'http://localhost:3000', 
  optionsSuccessStatus: 200 // For legacy browser support
};




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

// 3. Apply CORS middleware BEFORE your routes
app.use(cors(corsOptions));

// Middleware
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api/register', registerRoutes);
app.use('/api/login', loginRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});