const express = require('express');
const router = express.Router();
const sql = require('mssql');
const jwt = require('jsonwebtoken');
require('dotenv').config();

console.log('accountNo.js loaded - Version 2025-07-25-03:00 (fixed syntax errors, enforces AccountNo as [AccountPrefix] [BranchAdd] [BankName], cascading updates, SQL Server 2008 compatible, enhanced logging)');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    console.warn('No token provided');
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
router.get('/banks', authenticateToken, async (req, res) => {
  try {
    const pool = await req.app.locals.pool;
    const result = await pool.request().query('SELECT BankCode, BankName FROM dbo.aTBanks ORDER BY BankName');
    console.log('GET /api/accountNo/banks - Fetched banks:', result.recordset);
    res.json({ status: 'success', banks: result.recordset });
  } catch (err) {
    console.error('GET /api/accountNo/banks - Error fetching banks:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to fetch banks: ${err.message}` });
  }
});

// Get all branches
router.get('/branches', authenticateToken, async (req, res) => {
  try {
    const pool = await req.app.locals.pool;
    const result = await pool.request().query(`
      SELECT 
        b.BranchCode, 
        b.BranchAdd, 
        b.ContactPerson, 
        b.PhoneNo, 
        b.FaxNo, 
        b.BankCode, 
        ba.BankName
      FROM dbo.aTBankBranch b
      LEFT JOIN dbo.aTBanks ba ON b.BankCode = ba.BankCode
      ORDER BY b.BranchAdd
    `);
    console.log('GET /api/accountNo/branches - Fetched branches:', result.recordset);
    res.json({ status: 'success', branches: result.recordset });
  } catch (err) {
    console.error('GET /api/accountNo/branches - Error fetching branches:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to fetch branches: ${err.message}` });
  }
});

// Get accounts by branch
router.get('/accounts', authenticateToken, async (req, res) => {
  try {
    const pool = await req.app.locals.pool;
    const { branchCode } = req.query;
    if (!branchCode) {
      console.warn('GET /api/accountNo/accounts - Missing branchCode parameter');
      return res.status(400).json({ status: 'error', message: 'BranchCode is required' });
    }
    const result = await pool.request()
      .input('BranchCode', sql.Int, parseInt(branchCode))
      .query(`
        SELECT 
          a.AccountNoCode,
          a.AccountNo,
          a.AccountType,
          a.CashInBank,
          a.Active,
          a.BranchCode,
          b.BranchAdd,
          ba.BankName,
          RTRIM(LTRIM(SUBSTRING(a.AccountNo, 1, CHARINDEX(' ', a.AccountNo + ' ')))) AS AccountPrefix
        FROM dbo.aTAccountNo a
        LEFT JOIN dbo.aTBankBranch b ON a.BranchCode = b.BranchCode
        LEFT JOIN dbo.aTBanks ba ON b.BankCode = ba.BankCode
        WHERE a.BranchCode = @BranchCode
        ORDER BY a.AccountNo
      `);
    console.log('GET /api/accountNo/accounts - Fetched accounts by branch:', result.recordset);
    if (result.recordset.length === 0) {
      return res.status(404).json({ status: 'error', message: 'No accounts found for this branch' });
    }
    res.json({ status: 'success', accounts: result.recordset });
  } catch (err) {
    console.error('GET /api/accountNo/accounts - Error fetching accounts by branch:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to fetch accounts: ${err.message}` });
  }
});

// Create a new account
router.post('/:bankCode/accounts', authenticateToken, async (req, res) => {
  const { AccountPrefix, AccountType, CashInBank, Active, BranchCode } = req.body;
  const { bankCode } = req.params;
  try {
    console.log(`POST /api/accountNo/${bankCode}/accounts - Request body:`, req.body);
    if (!AccountPrefix || !AccountType || !BranchCode) {
      console.warn(`POST /api/accountNo/${bankCode}/accounts - Missing AccountPrefix, AccountType, or BranchCode`);
      return res.status(400).json({ status: 'error', message: 'AccountPrefix, AccountType, and BranchCode are required' });
    }
    const pool = await req.app.locals.pool;
    const branchResult = await pool.request()
      .input('BranchCode', sql.Int, BranchCode)
      .input('BankCode', sql.Int, parseInt(bankCode))
      .query('SELECT BranchAdd, BankCode FROM dbo.aTBankBranch WHERE BranchCode = @BranchCode AND BankCode = @BankCode');
    if (branchResult.recordset.length === 0) {
      console.warn(`POST /api/accountNo/${bankCode}/accounts - Invalid BranchCode: ${BranchCode} or BankCode: ${bankCode}`);
      return res.status(400).json({ status: 'error', message: 'Invalid BranchCode or BankCode' });
    }
    const { BranchAdd } = branchResult.recordset[0];
    const bankResult = await pool.request()
      .input('BankCode', sql.Int, parseInt(bankCode))
      .query('SELECT BankName FROM dbo.aTBanks WHERE BankCode = @BankCode');
    if (bankResult.recordset.length === 0) {
      console.warn(`POST /api/accountNo/${bankCode}/accounts - Invalid BankCode: ${bankCode}`);
      return res.status(400).json({ status: 'error', message: 'Invalid BankCode' });
    }
    const { BankName } = bankResult.recordset[0];
    const accountNo = RTRIM(LTRIM(AccountPrefix.trim())) + ' ' + RTRIM(LTRIM(BranchAdd)) + ' ' + RTRIM(LTRIM(BankName));
    if (accountNo.length > 50) {
      console.warn(`POST /api/accountNo/${bankCode}/accounts - AccountNo exceeds 50 characters: ${accountNo}`);
      return res.status(400).json({ status: 'error', message: 'Account number exceeds maximum length of 50 characters' });
    }
    const duplicateCheck = await pool.request()
      .input('AccountNo', sql.NVarChar, accountNo)
      .query('SELECT AccountNoCode FROM dbo.aTAccountNo WHERE AccountNo = @AccountNo');
    if (duplicateCheck.recordset.length > 0) {
      console.warn(`POST /api/accountNo/${bankCode}/accounts - Duplicate AccountNo: ${accountNo}`);
      return res.status(400).json({ status: 'error', message: 'Account number already exists' });
    }
    const result = await pool.request()
      .input('AccountNo', sql.NVarChar, accountNo)
      .input('AccountType', sql.NVarChar, AccountType)
      .input('CashInBank', sql.Decimal(18, 2), CashInBank || 0)
      .input('Active', sql.Bit, Active ? 1 : 0)
      .input('BranchCode', sql.Int, BranchCode)
      .query(`
        INSERT INTO dbo.aTAccountNo (AccountNo, AccountType, CashInBank, Active, BranchCode)
        OUTPUT INSERTED.AccountNoCode, INSERTED.AccountNo, INSERTED.AccountType, INSERTED.CashInBank, INSERTED.Active, INSERTED.BranchCode
        VALUES (@AccountNo, @AccountType, @CashInBank, @Active, @BranchCode)
      `);
    console.log(`POST /api/accountNo/${bankCode}/accounts - Created account:`, result.recordset[0]);
    res.json({ status: 'success', account: result.recordset[0] });
  } catch (err) {
    console.error(`POST /api/accountNo/${bankCode}/accounts - Error creating account:`, err.message, { stack: err.stack });
    if (err.message.includes('Violation of UNIQUE KEY constraint')) {
      return res.status(400).json({ status: 'error', message: 'Account number already exists' });
    }
    res.status(500).json({ status: 'error', message: `Failed to create account: ${err.message}` });
  }
});

// Update an account
router.put('/:bankCode/accounts/:accountNoCode', authenticateToken, async (req, res) => {
  const { AccountPrefix, AccountType, CashInBank, Active, BranchCode } = req.body;
  const { bankCode, accountNoCode } = req.params;
  try {
    console.log(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Request body:`, req.body);
    if (!AccountPrefix || !AccountType || !BranchCode || !accountNoCode) {
      console.warn(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Missing AccountPrefix, AccountType, BranchCode, or accountNoCode`);
      return res.status(400).json({ status: 'error', message: 'AccountPrefix, AccountType, BranchCode, and AccountNoCode are required' });
    }
    const pool = await req.app.locals.pool;
    const branchResult = await pool.request()
      .input('BranchCode', sql.Int, BranchCode)
      .input('BankCode', sql.Int, parseInt(bankCode))
      .query('SELECT BranchAdd, BankCode FROM dbo.aTBankBranch WHERE BranchCode = @BranchCode AND BankCode = @BankCode');
    if (branchResult.recordset.length === 0) {
      console.warn(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Invalid BranchCode: ${BranchCode} or BankCode: ${bankCode}`);
      return res.status(400).json({ status: 'error', message: 'Invalid BranchCode or BankCode' });
    }
    const { BranchAdd } = branchResult.recordset[0];
    const bankResult = await pool.request()
      .input('BankCode', sql.Int, parseInt(bankCode))
      .query('SELECT BankName FROM dbo.aTBanks WHERE BankCode = @BankCode');
    if (bankResult.recordset.length === 0) {
      console.warn(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Invalid BankCode: ${bankCode}`);
      return res.status(400).json({ status: 'error', message: 'Invalid BankCode' });
    }
    const { BankName } = bankResult.recordset[0];
    const accountNo = RTRIM(LTRIM(AccountPrefix.trim())) + ' ' + RTRIM(LTRIM(BranchAdd)) + ' ' + RTRIM(LTRIM(BankName));
    if (accountNo.length > 50) {
      console.warn(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - AccountNo exceeds 50 characters: ${accountNo}`);
      return res.status(400).json({ status: 'error', message: 'Account number exceeds maximum length of 50 characters' });
    }
    const duplicateCheck = await pool.request()
      .input('AccountNo', sql.NVarChar, accountNo)
      .input('AccountNoCode', sql.Int, accountNoCode)
      .query('SELECT AccountNoCode FROM dbo.aTAccountNo WHERE AccountNo = @AccountNo AND AccountNoCode != @AccountNoCode');
    if (duplicateCheck.recordset.length > 0) {
      console.warn(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Duplicate AccountNo: ${accountNo}`);
      return res.status(400).json({ status: 'error', message: 'Account number already exists' });
    }
    const result = await pool.request()
      .input('AccountNoCode', sql.Int, accountNoCode)
      .input('AccountNo', sql.NVarChar, accountNo)
      .input('AccountType', sql.NVarChar, AccountType)
      .input('CashInBank', sql.Decimal(18, 2), CashInBank || 0)
      .input('Active', sql.Bit, Active ? 1 : 0)
      .input('BranchCode', sql.Int, BranchCode)
      .query(`
        UPDATE dbo.aTAccountNo
        SET AccountNo = @AccountNo,
            AccountType = @AccountType,
            CashInBank = @CashInBank,
            Active = @Active,
            BranchCode = @BranchCode
        OUTPUT INSERTED.AccountNoCode, INSERTED.AccountNo, INSERTED.AccountType, INSERTED.CashInBank, INSERTED.Active, INSERTED.BranchCode
        WHERE AccountNoCode = @AccountNoCode
      `);
    if (result.rowsAffected[0] === 0) {
      console.warn(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Account not found`);
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }
    console.log(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Updated account:`, result.recordset[0]);
    res.json({ status: 'success', account: result.recordset[0] });
  } catch (err) {
    console.error(`PUT /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Error updating account:`, err.message, { stack: err.stack });
    if (err.message.includes('Violation of UNIQUE KEY constraint')) {
      return res.status(400).json({ status: 'error', message: 'Account number already exists' });
    }
    res.status(500).json({ status: 'error', message: `Failed to update account: ${err.message}` });
  }
});

// Delete an account
router.delete('/:bankCode/accounts/:accountNoCode', authenticateToken, async (req, res) => {
  const { bankCode, accountNoCode } = req.params;
  try {
    console.log(`DELETE /api/accountNo/${bankCode}/accounts/:${accountNoCode}`);
    const pool = await req.app.locals.pool;
    const result = await pool.request()
      .input('AccountNoCode', sql.Int, accountNoCode)
      .query('DELETE FROM dbo.aTAccountNo WHERE AccountNoCode = @AccountNoCode; SELECT @@ROWCOUNT as rowsAffected');
    if (result.recordset[0].rowsAffected === 0) {
      console.warn(`DELETE /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Account not found`);
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }
    console.log(`DELETE /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Deleted account`);
    res.json({ status: 'success', message: 'Account deleted successfully' });
  } catch (err) {
    console.error(`DELETE /api/accountNo/${bankCode}/accounts/:${accountNoCode} - Error deleting account:`, err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to delete account: ${err.message}` });
  }
});

module.exports = router;