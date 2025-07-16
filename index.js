const dotenv = require('dotenv');
const { Pool } = require('pg');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const pool = require('./db'); // Import the database connection
require('dotenv').config();

const app = express();
app.use(express.json()); // Middleware to parse JSON bodies
app.use(cors());

// Register 
app.post('/register', async (req, res) => {
    const { name, email, contact_number, department_name, password, designation, role } = req.body;

    try {
        const userExist = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userExist.rows.length > 0) return res.status(400).json({ error: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await pool.query(
            'INSERT INTO users (name, email, contact_number, department_name, password, designation, role) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [name, email, contact_number, department_name, hashedPassword, designation, role]
        );
       
        console.log(`[REGISTER SUCCESS] User Registered: ${email}, Role: ${role}`);
        res.status(201).json({ message: 'User registered successfully', user: newUser.rows[0] });
        
    } catch (error) {
        console.log(`[REGISTER ERROR] ${error.message}`);
        res.status(500).json({ message: error.message });
    }
});

// Login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (user.rows.length === 0) return res.status(400).json({ message: "Invalid email or password" });

        const validPass = await bcrypt.compare(password, user.rows[0].password);
        if (!validPass) return res.status(400).json({ message: "Invalid email or password" });

        const token = jwt.sign({ userId: user.rows[0].id, role: user.rows[0].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  
        console.log(`[LOGIN SUCCESS] Email: ${email}, Role: ${user.rows[0].role}`);
        res.json({ message: "Login successful", token });
    } catch (err) {
        console.log(`[LOGIN FAILED] Invalid Password for Email: ${email}`);
        res.status(500).json({ message: err.message });
    }
});

// Admin Login
app.post('/admin/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Check if the provided email matches the admin email
        if (email !== process.env.ADMIN_EMAIL) {
            return res.status(400).json({ message: "Invalid admin email or password" });
        }

        // Compare the provided password with the hashed admin password
        const validPass = await bcrypt.compare(password, await bcrypt.hash(process.env.ADMIN_PASSWORD, 10));
        if (!validPass) {
            console.log(`[ADMIN LOGIN FAILED] Invalid Password for Email: ${email}`);
            return res.status(400).json({ message: "Invalid admin email or password" });
        }

        // Generate JWT token with admin role
        const token = jwt.sign({ userId: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });

        console.log(`[ADMIN LOGIN SUCCESS] Email: ${email}, Role: admin`);
        res.json({ message: "Admin login successful", token });
    } catch (err) {
        console.log(`[ADMIN LOGIN ERROR] ${err.message}`);
        res.status(500).json({ message: err.message });
    }
});

app.listen(process.env.PORT, () => {
    console.log('----------------------------------------------------------------------');
    console.log(`Server running on port ${process.env.PORT}`);
    console.log('----------------------------------------------------------------------');
    console.log(`Database connected at ${process.env.PGHOST}:${process.env.PGPORT}/${process.env.PGDATABASE} successfully`);
    console.log('----------------------------------------------------------------------');
});