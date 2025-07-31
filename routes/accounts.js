const express = require('express');
const router = express.Router();
const sql = require('mssql');
const authenticateToken = require('../middleware/auth');

const poolPromise = require('../server').poolPromise;

router.get('/:bankCode/accounts', authenticateToken, async (req, res) => {
  const { bankCode } = req.params;
  try {
    if (!bankCode || isNaN(bankCode)) {
      return res.status(400).json({ status: 'error', message: 'Valid BankCode is required' });
    }
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('BankCode', sql.Int, parseInt(bankCode))
      .query(`
        SELECT AccountNoCode, BankCode, BranchCode, AccountNo, AccountType, CashInBank, Active 
        FROM dbo.aTAccountNo 
        WHERE BankCode = @BankCode
        ORDER BY AccountNo
      `);
    console.log('Fetched accounts for BankCode:', bankCode, result.recordset);
    res.json({ status: 'success', accounts: result.recordset || [] });
  } catch (err) {
    console.error('Error fetching accounts:', {
      message: err.message,
      stack: err.stack,
      sqlError: err.originalError ? err.originalError.info : null
    });
    res.status(500).json({ status: 'error', message: `Failed to fetch accounts: ${err.message}` });
  }
});

router.post('/:bankCode/accounts', authenticateToken, async (req, res) => {
  const { bankCode } = req.params;
  const { AccountNo, BranchCode, AccountType, CashInBank, Active } = req.body;
  try {
    if (!AccountNo || !AccountType || !BranchCode || !bankCode || isNaN(bankCode)) {
      return res.status(400).json({ status: 'error', message: 'AccountNo, AccountType, BranchCode, and BankCode are required' });
    }
    if (AccountNo.length > 50 || AccountType.length > 50) {
      return res.status(400).json({ status: 'error', message: 'AccountNo and AccountType must not exceed 50 characters' });
    }
    const pool = await poolPromise;

    // Check for duplicate AccountNo
    const existing = await pool.request()
      .input('AccountNo', sql.NVarChar(50), AccountNo.trim())
      .input('BankCode', sql.Int, parseInt(bankCode))
      .query('SELECT 1 FROM dbo.aTAccountNo WHERE AccountNo = @AccountNo AND BankCode = @BankCode');
    if (existing.recordset.length > 0) {
      return res.status(400).json({ status: 'error', message: 'Account number already exists for this bank' });
    }

    console.log('Creating account with data:', { BankCode: bankCode, AccountNo, BranchCode, AccountType, CashInBank, Active });
    const result = await pool
      .request()
      .input('BankCode', sql.Int, parseInt(bankCode))
      .input('AccountNo', sql.NVarChar(50), AccountNo.trim())
      .input('BranchCode', sql.Int, parseInt(BranchCode))
      .input('AccountType', sql.NVarChar(50), AccountType.trim())
      .input('CashInBank', sql.Decimal(18, 2), CashInBank || 0)
      .input('Active', sql.Bit, Active ? 1 : 0)
      .query(`
        INSERT INTO dbo.aTAccountNo (BankCode, AccountNo, BranchCode, AccountType, CashInBank, Active)
        VALUES (@BankCode, @AccountNo, @BranchCode, @AccountType, @CashInBank, @Active)
        SELECT SCOPE_IDENTITY() AS AccountNoCode
      `);
    console.log('Insert result:', result);
    res.json({ 
      status: 'success', 
      message: 'Account created', 
      AccountNoCode: result.recordset[0].AccountNoCode 
    });
  } catch (err) {
    console.error('Error creating account:', {
      message: err.message,
      stack: err.stack,
      sqlError: err.originalError ? err.originalError.info : null
    });
    res.status(500).json({ status: 'error', message: `Failed to create account: ${err.message}` });
  }
});

router.put('/:bankCode/accounts/:accountNoCode', authenticateToken, async (req, res) => {
  const { bankCode, accountNoCode } = req.params;
  const { AccountNo, BranchCode, AccountType, CashInBank, Active } = req.body;
  try {
    if (!AccountNo || !AccountType || !BranchCode || !bankCode || !accountNoCode || isNaN(bankCode) || isNaN(accountNoCode)) {
      return res.status(400).json({ status: 'error', message: 'AccountNo, AccountType, BranchCode, BankCode, and AccountNoCode are required' });
    }
    if (AccountNo.length > 50 || AccountType.length > 50) {
      return res.status(400).json({ status: 'error', message: 'AccountNo and AccountType must not exceed 50 characters' });
    }
    const pool = await poolPromise;

    // Check for duplicate AccountNo (excluding the current account)
    const existing = await pool.request()
      .input('AccountNo', sql.NVarChar(50), AccountNo.trim())
      .input('BankCode', sql.Int, parseInt(bankCode))
      .input('AccountNoCode', sql.Int, parseInt(accountNoCode))
      .query('SELECT 1 FROM dbo.aTAccountNo WHERE AccountNo = @AccountNo AND BankCode = @BankCode AND AccountNoCode != @AccountNoCode');
    if (existing.recordset.length > 0) {
      return res.status(400).json({ status: 'error', message: 'Account number already exists for this bank' });
    }

    console.log('Updating account with data:', { BankCode: bankCode, AccountNoCode: accountNoCode, AccountNo, BranchCode, AccountType, CashInBank, Active });
    const result = await pool
      .request()
      .input('BankCode', sql.Int, parseInt(bankCode))
      .input('AccountNoCode', sql.Int, parseInt(accountNoCode))
      .input('AccountNo', sql.NVarChar(50), AccountNo.trim())
      .input('BranchCode', sql.Int, parseInt(BranchCode))
      .input('AccountType', sql.NVarChar(50), AccountType.trim())
      .input('CashInBank', sql.Decimal(18, 2), CashInBank || 0)
      .input('Active', sql.Bit, Active ? 1 : 0)
      .query(`
        UPDATE dbo.aTAccountNo 
        SET AccountNo = @AccountNo, 
            BranchCode = @BranchCode, 
            AccountType = @AccountType, 
            CashInBank = @CashInBank, 
            Active = @Active 
        WHERE BankCode = @BankCode AND AccountNoCode = @AccountNoCode
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }
    res.json({ status: 'success', message: 'Account updated', AccountNoCode: parseInt(accountNoCode) });
  } catch (err) {
    console.error('Error updating account:', {
      message: err.message,
      stack: err.stack,
      sqlError: err.originalError ? err.originalError.info : null
    });
    res.status(500).json({ status: 'error', message: `Failed to update account: ${err.message}` });
  }
});

router.delete('/:bankCode/accounts/:accountNoCode', authenticateToken, async (req, res) => {
  const { bankCode, accountNoCode } = req.params;
  try {
    if (!bankCode || !accountNoCode || isNaN(bankCode) || isNaN(accountNoCode)) {
      return res.status(400).json({ status: 'error', message: 'Valid BankCode and AccountNoCode are required' });
    }
    const pool = await poolPromise;
    console.log('Deleting account with:', { BankCode: bankCode, AccountNoCode: accountNoCode });
    const result = await pool
      .request()
      .input('BankCode', sql.Int, parseInt(bankCode))
      .input('AccountNoCode', sql.Int, parseInt(accountNoCode))
      .query(`
        DELETE FROM dbo.aTAccountNo 
        WHERE BankCode = @BankCode AND AccountNoCode = @AccountNoCode
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }
    res.json({ status: 'success', message: 'Account deleted', AccountNoCode: parseInt(accountNoCode) });
  } catch (err) {
    console.error('Error deleting account:', {
      message: err.message,
      stack: err.stack,
      sqlError: err.originalError ? err.originalError.info : null
    });
    res.status(500).json({ status: 'error', message: `Failed to delete account: ${err.message}` });
  }
});

module.exports = router;