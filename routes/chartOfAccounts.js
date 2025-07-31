const express = require('express');
const sql = require('mssql');
const { poolPromise } = require('../server');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const router = express.Router();

console.log('chartOfAccounts.js loaded - Version 2025-07-08 v1');

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.error('Authentication error: No token provided');
    return res.status(401).json({ status: 'error', message: 'Token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error('Authentication error: Invalid or expired token', err.message);
      return res.status(403).json({ status: 'error', message: 'Invalid or expired token' });
    }
    if (!user.userCode) {
      console.error('Authentication error: userCode missing in JWT', user);
      return res.status(403).json({ status: 'error', message: 'userCode missing in JWT' });
    }
    req.user = user;
    console.log('JWT verified, userCode:', user.userCode);
    next();
  });
};

// Get all particulars
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT AccountID, AccountCode, Particular, Credit, vFundTransfer
      FROM dbo.aTChartOfAccounts
      WHERE Particular IS NOT NULL
    `);
    console.log('Particulars query result:', JSON.stringify(result.recordset, null, 2));
    res.json({ status: 'success', particulars: result.recordset });
  } catch (err) {
    console.error('Fetch particulars error:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: 'Failed to fetch particulars' });
  }
});

// Create a new particular
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { Particular, Credit, vFundTransfer } = req.body;

    if (!Particular || Particular.trim() === '') {
      console.error('Validation error: Particular is required', { Particular });
      return res.status(400).json({ status: 'error', message: 'Particular is required' });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Generate AccountCode (padded AccountID)
      const maxIdResult = await transaction
        .request()
        .query('SELECT MAX(AccountID) as MaxID FROM dbo.aTChartOfAccounts');
      const newId = (maxIdResult.recordset[0].MaxID || 0) + 1;
      const accountCode = newId.toString().padStart(4, '0');

      await transaction
        .request()
        .input('AccountCode', sql.NVarChar(50), accountCode)
        .input('Particular', sql.NVarChar(50), Particular.trim())
        .input('Credit', sql.Bit, Credit ? 1 : 0)
        .input('vFundTransfer', sql.Bit, vFundTransfer ? 1 : 0)
        .query(`
          INSERT INTO dbo.aTChartOfAccounts (AccountCode, Particular, Credit, vFundTransfer)
          VALUES (@AccountCode, @Particular, @Credit, @vFundTransfer)
        `);

      console.log('Created particular:', { AccountCode: accountCode, Particular, Credit, vFundTransfer });
      await transaction.commit();

      res.json({ status: 'success', message: 'Particular created successfully' });
    } catch (err) {
      await transaction.rollback();
      console.error('Create particular error:', err.message, { stack: err.stack });
      throw err;
    }
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Update a particular
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { Particular, Credit, vFundTransfer } = req.body;

    if (!Particular || Particular.trim() === '') {
      console.error('Validation error: Particular is required', { Particular });
      return res.status(400).json({ status: 'error', message: 'Particular is required' });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const result = await transaction
        .request()
        .input('AccountID', sql.Int, parseInt(id))
        .input('Particular', sql.NVarChar(50), Particular.trim())
        .input('Credit', sql.Bit, Credit ? 1 : 0)
        .input('vFundTransfer', sql.Bit, vFundTransfer ? 1 : 0)
        .query(`
          UPDATE dbo.aTChartOfAccounts
          SET Particular = @Particular, Credit = @Credit, vFundTransfer = @vFundTransfer
          WHERE AccountID = @AccountID
        `);

      if (result.rowsAffected[0] === 0) {
        console.error('Update error: Particular not found', { AccountID: id });
        throw new Error('Particular not found');
      }

      console.log('Updated particular:', { AccountID: id, Particular, Credit, vFundTransfer });
      await transaction.commit();

      res.json({ status: 'success', message: 'Particular updated successfully' });
    } catch (err) {
      await transaction.rollback();
      console.error('Update particular error:', err.message, { stack: err.stack });
      throw err;
    }
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Delete a particular
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Check for dependencies in aTDailyDeposits
      const dependencyCheck = await transaction
        .request()
        .input('AccountID', sql.Int, parseInt(id))
        .query('SELECT COUNT(*) as count FROM dbo.aTDailyDeposits WHERE AccountID = @AccountID');

      if (dependencyCheck.recordset[0].count > 0) {
        console.error('Deletion error: Particular is in use', { AccountID: id });
        throw new Error('Cannot delete particular because it is referenced in transactions');
      }

      const result = await transaction
        .request()
        .input('AccountID', sql.Int, parseInt(id))
        .query('DELETE FROM dbo.aTChartOfAccounts WHERE AccountID = @AccountID');

      if (result.rowsAffected[0] === 0) {
        console.error('Deletion error: Particular not found', { AccountID: id });
        throw new Error('Particular not found');
      }

      console.log('Deleted particular:', { AccountID: id });
      await transaction.commit();

      res.json({ status: 'success', message: 'Particular deleted successfully' });
    } catch (err) {
      await transaction.rollback();
      console.error('Delete particular error:', err.message, { stack: err.stack });
      throw err;
    }
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;