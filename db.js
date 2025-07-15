const dotenv = require('dotenv');
const {Pool} = require('pg');

const pool = new Pool();

module.exports = pool;