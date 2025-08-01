require('dotenv').config();
const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const authenticateToken = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 2030;
const SERVER_HOST = process.env.SERVER_HOST || '0.0.0.0';

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: [
      'http://localhost:8081',
      'http://localhost:19006',
      'http://10.0.2.2:2030',
      'https://livecash-backend.onrender.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

// Debug Middleware: Log all incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Request: ${req.method} ${req.originalUrl}`);
  console.log('Headers:', { ...req.headers, authorization: req.headers.authorization ? '[REDACTED]' : undefined });
  console.log('Body:', req.body);
  next();
});

// Database Configuration
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Database Connection with Reconnection Logic
let poolPromise = null;

const connectToDatabase = async () => {
  try {
    if (!poolPromise) {
      poolPromise = new sql.ConnectionPool(dbConfig).connect();
      const pool = await poolPromise;
      console.log(`[${new Date().toISOString()}] Database connected successfully`);
      app.locals.pool = pool;
      pool.on('error', (err) => {
        console.error(`[${new Date().toISOString()}] Database pool error:`, err.message, err.stack);
        poolPromise = null;
        app.locals.pool = null;
        reconnectToDatabase();
      });
      return pool;
    }
    return poolPromise;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Database connection error:`, err.message, err.stack);
    poolPromise = null;
    app.locals.pool = null;
    setTimeout(reconnectToDatabase, 5000);
  }
};

const reconnectToDatabase = async () => {
  console.log(`[${new Date().toISOString()}] Attempting to reconnect to database...`);
  try {
    poolPromise = new sql.ConnectionPool(dbConfig).connect();
    const pool = await poolPromise;
    console.log(`[${new Date().toISOString()}] Database reconnected successfully`);
    app.locals.pool = pool;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Reconnection failed:`, err.message, err.stack);
    setTimeout(reconnectToDatabase, 5000);
  }
};

// Initialize Database Connection
connectToDatabase();

// Export Database Pool for routes
module.exports = { poolPromise };

// Ping Endpoint
app.get('/api/ping', (req, res) => {
  res.status(200).json({ status: 'success', message: 'Server is alive', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/login', require('./routes/login')); // No auth middleware needed for login
app.use('/api/accounts', authenticateToken, require('./routes/accounts'));
app.use('/api/accountNo', authenticateToken, require('./routes/accountNo'));
app.use('/api/accountNo/branches', authenticateToken, require('./routes/bankBranch')); // Fixed typo
app.use('/api/expenses', authenticateToken, require('./routes/expenses'));
app.use('/api/transactions', authenticateToken, require('./routes/transactions'));
app.use('/api/banks', authenticateToken, require('./routes/banks'));
app.use('/api/chart-of-accounts', authenticateToken, require('./routes/chartOfAccounts'));
app.use('/api/addTransaction', authenticateToken, require('./routes/addTransaction'));
app.use('/api/users', authenticateToken, require('./routes/createUser')); // Added users route

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    if (pool) {
      res.json({ status: 'ok', message: 'Server and database are healthy', timestamp: new Date().toISOString() });
    } else {
      res.status(503).json({ status: 'error', message: 'Database not available', timestamp: new Date().toISOString() });
    }
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Health check error:`, err.message, err.stack);
    res.status(503).json({ status: 'error', message: 'Server health check failed', timestamp: new Date().toISOString() });
  }
});

// Version Endpoint
app.get('/api/version', (req, res) => {
  res.json({ version: '3.1', timestamp: '2025-07-09' });
  console.log(`[${new Date().toISOString()}] Version endpoint accessed`);
});

// Default Route
app.get('/', (req, res) => {
  res.send('API is live and running...');
});

// Global Error Handlers
process.on('uncaughtException', (err) => {
  console.error(`[${new Date().toISOString()}] Uncaught Exception:`, err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] Unhandled Rejection at:`, promise, 'reason:', reason);
});

// Global Error Handler Middleware
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Global error:`, err.message, err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Something went wrong on the server',
    error: err.message,
  });
});

// Catch-all for unmatched routes
app.use((req, res) => {
  console.log(`[${new Date().toISOString()}] Unmatched route: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ status: 'error', message: `Cannot ${req.method} ${req.originalUrl}` });
});

// Start Server
app.listen(PORT, SERVER_HOST, () => {
  console.log(`[${new Date().toISOString()}] Server running on http://${SERVER_HOST}:${PORT}`);
  console.log(`[${new Date().toISOString()}] Loaded routes:`, [
    '/api/login',
    '/api/accounts',
    '/api/accountNo',
    '/api/accountNo/branches',
    '/api/expenses',
    '/api/transactions',
    '/api/banks',
    '/api/chart-of-accounts',
    '/api/addTransaction',
    '/api/users',
    '/api/version',
    '/api/health',
    '/api/ping',
  ]);
});
