const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const registerRoutes = require('./routes/register');
const loginRoutes = require('./routes/login');
const partRoutes = require('./routes/parts');
const taskRoutes = require('./routes/tasks');
const notificationRoutes = require('./routes/notifications');
const winston = require('winston');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:3000' },
});

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

// Socket.IO authentication
io.use((socket, next) => {
  const token = socket.handshake.auth.token?.split(' ')[1];
  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    socket.user = decoded;
    next();
  } catch (error) {
    next(new Error('Authentication error: Invalid token'));
  }
});

io.on('connection', (socket) => {
  logger.info(`Client connected: ${socket.id}, User: ${socket.user.email}`);
  socket.join(`role:${socket.user.role}`); // Join role-specific room
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Middleware to attach io to req
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }));
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.url}`);
  next();
});

app.use('/uploads', express.static('Uploads'));

// Routes
app.use('/api/register', registerRoutes);
app.use('/api/login', loginRoutes);
app.use('/api/parts', partRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/notifications', notificationRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});