const express = require('express');
const router = express.Router();
const sql = require('mssql');
const jwt = require('jsonwebtoken');
require('dotenv').config();

console.log('banks.js loaded - Version 2025-07-25-05:00 (fixed CONCAT, bankCode scoping, cascading AccountNo updates, enhanced logging)');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    console.warn('No token provided in request');
    return res.status(401).json({ status: 'error', message: 'Token required' });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.warn('Invalid token:', err.message);
      return res.status(403).json({ status: 'error', message: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Get all banks
router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = await req.app.locals.pool;
    const result = await pool.request().query(`
      SELECT BankCode, BankName
      FROM dbo.aTBanks
      ORDER BY BankName
    `);
    console.log(`GET /banks - Fetched ${result.recordset.length} banks`);
    res.json({ status: 'success', banks: result.recordset });
  } catch (err) {
    console.error('GET /banks error:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to fetch banks: ${err.message}` });
  }
});

// Create a new bank
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { BankName } = req.body;
    console.log('POST /banks - Request body:', req.body);
    if (!BankName || !BankName.trim()) {
      console.warn('POST /banks - BankName missing or empty');
      return res.status(400).json({ status: 'error', message: 'Bank Name is required and cannot be empty' });
    }
    const pool = await req.app.locals.pool;
    const nameCheck = await pool.request()
      .input('BankName', sql.VarChar, BankName.trim())
      .query('SELECT BankCode FROM dbo.aTBanks WHERE LOWER(BankName) = LOWER(@BankName)');
    if (nameCheck.recordset.length > 0) {
      console.warn(`POST /banks - Duplicate BankName: ${BankName.trim()}`);
      return res.status(400).json({ status: 'error', message: 'Bank Name already exists' });
    }
    const result = await pool.request()
      .input('BankName', sql.VarChar, BankName.trim())
      .query(`
        INSERT INTO dbo.aTBanks (BankName)
        VALUES (@BankName);
        SELECT SCOPE_IDENTITY() as BankCode, @BankName as BankName;
      `);
    const newBank = result.recordset[0];
    console.log('POST /banks - New bank created:', newBank);
    res.status(201).json({ status: 'success', message: 'Bank created successfully', bank: newBank });
  } catch (err) {
    console.error('POST /banks error:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to create bank: ${err.message}` });
  }
});

// Update a bank
router.put('/:bankCode', authenticateToken, async (req, res) => {
  try {
    const { BankName } = req.body;
    const bankCode = parseInt(req.params.bankCode); // Fix scoping
    console.log(`PUT /banks/:${bankCode} - Request body:`, req.body);
    if (!BankName || !BankName.trim()) {
      console.warn(`PUT /banks/:${bankCode} - BankName missing or empty`);
      return res.status(400).json({ status: 'error', message: 'Bank Name is required and cannot be empty' });
    }
    const pool = await req.app.locals.pool;
    const nameCheck = await pool.request()
      .input('BankName', sql.VarChar, BankName.trim())
      .input('BankCode', sql.Int, bankCode)
      .query('SELECT BankCode FROM dbo.aTBanks WHERE LOWER(BankName) = LOWER(@BankName) AND BankCode != @BankCode');
    if (nameCheck.recordset.length > 0) {
      console.warn(`PUT /banks/:${bankCode} - Duplicate BankName: ${BankName.trim()}`);
      return res.status(400).json({ status: 'error', message: 'Bank Name already exists' });
    }
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const bankUpdate = await transaction.request()
        .input('BankCode', sql.Int, bankCode)
        .input('BankName', sql.VarChar, BankName.trim())
        .query(`
          UPDATE dbo.aTBanks
          SET BankName = @BankName
          WHERE BankCode = @BankCode;
          SELECT @@ROWCOUNT as rowsAffected;
        `);
      if (bankUpdate.recordset[0].rowsAffected === 0) {
        await transaction.rollback();
        console.warn(`PUT /banks/:${bankCode} - Bank not found`);
        return res.status(404).json({ status: 'error', message: 'Bank not found' });
      }
      const accountUpdate = await transaction.request()
        .input('BankCode', sql.Int, bankCode)
        .input('BankName', sql.VarChar, BankName.trim())
        .query(`
          UPDATE a
          SET a.AccountNo = RTRIM(LTRIM(RTRIM(LTRIM(SUBSTRING(a.AccountNo, 1, CHARINDEX(' ', a.AccountNo + ' ')))) + ' ' + RTRIM(LTRIM(bb.BranchAdd)) + ' ' + RTRIM(LTRIM(@BankName))))
          FROM dbo.aTAccountNo a
          JOIN dbo.aTBankBranch bb ON a.BranchCode = bb.BranchCode
          WHERE bb.BankCode = @BankCode;
          SELECT @@ROWCOUNT as rowsAffected;
        `);
      console.log(`PUT /banks/:${bankCode} - Updated ${accountUpdate.recordset[0].rowsAffected} accounts in aTAccountNo`);
      await transaction.commit();
      res.json({ status: 'success', message: 'Bank and related accounts updated successfully' });
    } catch (err) {
      await transaction.rollback();
      console.error(`PUT /banks/:${bankCode} - Transaction error:`, err.message, { stack: err.stack });
      throw err;
    }
  } catch (err) {
    console.error(`PUT /banks/:${bankCode} - Error updating bank:`, err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to update bank: ${err.message}` });
  }
});

// Delete a bank and its related branches and accounts
router.delete('/:bankCode', authenticateToken, async (req, res) => {
  try {
    const bankCode = parseInt(req.params.bankCode); // Fix scoping
    console.log(`DELETE /banks/:${bankCode}`);
    const pool = await req.app.locals.pool;
    const bankCheck = await pool.request()
      .input('BankCode', sql.Int, bankCode)
      .query('SELECT BankCode FROM dbo.aTBanks WHERE BankCode = @BankCode');
    if (bankCheck.recordset.length === 0) {
      console.warn(`DELETE /banks/:${bankCode} - Bank not found`);
      return res.status(404).json({ status: 'error', message: 'Bank not found' });
    }
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const accountDelete = await transaction.request()
        .input('BankCode', sql.Int, bankCode)
        .query(`
          DELETE a
          FROM dbo.aTAccountNo a
          WHERE a.BranchCode IN (
            SELECT BranchCode FROM dbo.aTBankBranch WHERE BankCode = @BankCode
          );
          SELECT @@ROWCOUNT as rowsAffected;
        `);
      console.log(`DELETE /banks/:${bankCode} - Deleted ${accountDelete.recordset[0].rowsAffected} accounts from aTAccountNo`);
      const branchDelete = await transaction.request()
        .input('BankCode', sql.Int, bankCode)
        .query(`
          DELETE FROM dbo.aTBankBranch
          WHERE BankCode = @BankCode;
          SELECT @@ROWCOUNT as rowsAffected;
        `);
      console.log(`DELETE /banks/:${bankCode} - Deleted ${branchDelete.recordset[0].rowsAffected} branches from aTBankBranch`);
      const bankDelete = await transaction.request()
        .input('BankCode', sql.Int, bankCode)
        .query(`
          DELETE FROM dbo.aTBanks
          WHERE BankCode = @BankCode;
          SELECT @@ROWCOUNT as rowsAffected;
        `);
      if (bankDelete.recordset[0].rowsAffected === 0) {
        await transaction.rollback();
        console.warn(`DELETE /banks/:${bankCode} - Bank not found during deletion`);
        return res.status(404).json({ status: 'error', message: 'Bank not found' });
      }
      console.log(`DELETE /banks/:${bankCode} - Deleted bank`);
      await transaction.commit();
      res.json({
        status: 'success',
        message: 'Bank, related branches, and accounts deleted successfully',
        details: {
          accountsDeleted: accountDelete.recordset[0].rowsAffected,
          branchesDeleted: branchDelete.recordset[0].rowsAffected,
          banksDeleted: bankDelete.recordset[0].rowsAffected
        }
      });
    } catch (err) {
      await transaction.rollback();
      console.error(`DELETE /banks/:${bankCode} - Transaction error:`, err.message, { stack: err.stack });
      throw err;
    }
  } catch (err) {
    console.error(`DELETE /banks/:${bankCode} - Error:`, err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to delete bank: ${err.message}` });
  }
});

module.exports = router;