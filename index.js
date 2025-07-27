const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const userRoutes = require('./routes/userRoutes');
const partRoutes = require('./routes/partRoutes');
const taskRoutes = require('./routes/taskRoutes');
const notificationRoutes = require('./routes/notificationRoutes');

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// Route middleware
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/parts', partRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/notifications', notificationRoutes);

app.listen(process.env.PORT, () => {
  console.log('----------------------------------------------------------------------');
  console.log(`Server running on port ${process.env.PORT}`);
  console.log('----------------------------------------------------------------------');
  console.log(`Database connected at ${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE} successfully`);
  console.log('----------------------------------------------------------------------');
});