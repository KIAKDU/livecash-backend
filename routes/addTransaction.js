const express = require('express');
const router = express.Router();
const sql = require('mssql');
const { poolPromise } = require('../server');
const jwt = require('jsonwebtoken');

router.get('/transaction-types', async (req, res) => {
  try {
    console.log('Fetching transaction types...');
    const pool = await poolPromise;
    const result = await pool.request()
      .query(`
        SELECT AccountID, Particular 
        FROM [dbo].aTChartOfAccounts
      `);
    console.log('Transaction types fetched:', result.recordset.length, 'records');
    const transactionTypes = result.recordset.map(row => ({ id: row.AccountID, name: row.Particular }));
    res.json({ status: 'success', transactionTypes });
  } catch (err) {
    console.error('Fetch transaction types error:', JSON.stringify({ message: err.message, stack: err.stack, timestamp: new Date().toISOString() }, null, 2));
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/', async (req, res) => {
  console.log('Received transaction payload:', JSON.stringify(req.body, null, 2));
  
  const {
    BankCode,
    BranchCode,
    AccountNo,
    TransactionType,
    ExpensesCode,
    Notes,
    amount
  } = req.body;

  // Validate required fields
  if (!BankCode || !BranchCode || !AccountNo || !TransactionType || !amount) {
    console.warn('Validation failed: Missing required fields', { BankCode, BranchCode, AccountNo, TransactionType, amount });
    return res.status(400).json({ status: 'error', message: 'Missing required fields' });
  }

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    console.warn('Validation failed: Invalid amount', { amount });
    return res.status(400).json({ status: 'error', message: 'Invalid amount' });
  }

  try {
    // Get database connection from poolPromise
    const pool = await poolPromise;
    console.log('Database connection established');

    // Extract UserCode from JWT token
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      console.warn('No token provided in Authorization header');
      return res.status(401).json({ status: 'error', message: 'No token provided' });
    }
    let userCode;
    try {
      console.log('Verifying JWT token...');
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret');
      userCode = decoded.userCode;
      console.log('Token verified, UserCode:', userCode);
    } catch (err) {
      console.error('JWT verification error:', JSON.stringify({ message: err.message, stack: err.stack, timestamp: new Date().toISOString() }, null, 2));
      return res.status(401).json({ status: 'error', message: 'Invalid token' });
    }

    // Validate ExpensesCode against aTExpenses (if provided)
    if (ExpensesCode) {
      console.log('Validating ExpensesCode:', ExpensesCode);
      const expenseResult = await pool.request()
        .input('ExpensesCode', sql.Int, ExpensesCode)
        .query(`
          SELECT ExpensesCode 
          FROM [dbo].aTExpenses 
          WHERE ExpensesCode = @ExpensesCode
        `);
      if (expenseResult.recordset.length === 0) {
        console.warn('Invalid ExpensesCode:', ExpensesCode);
        return res.status(400).json({ status: 'error', message: 'Invalid ExpensesCode' });
      }
      console.log('ExpensesCode validated');
    }

    // Validate TransactionType and get AccountID from aTChartOfAccounts
    console.log('Validating TransactionType:', TransactionType);
    const particularResult = await pool.request()
      .input('Particular', sql.NVarChar, TransactionType)
      .query(`
        SELECT AccountID, Credit
        FROM [dbo].aTChartOfAccounts 
        WHERE Particular = @Particular
      `);
    if (particularResult.recordset.length === 0) {
      console.warn('Invalid TransactionType:', TransactionType);
      return res.status(400).json({ status: 'error', message: 'Invalid TransactionType' });
    }
    const { AccountID, Credit } = particularResult.recordset[0];
    console.log('TransactionType validated, AccountID:', AccountID, 'Credit:', Credit);

    // Get current CashInBank
    console.log('Fetching CashInBank for:', { BankCode, BranchCode, AccountNo });
    const accountResult = await pool.request()
      .input('BankCode', sql.Int, BankCode)
      .input('BranchCode', sql.Int, BranchCode)
      .input('AccountNoCode', sql.Int, AccountNo)
      .query(`
        SELECT CashInBank 
        FROM [dbo].aTAccountNo 
        WHERE BankCode = @BankCode 
        AND BranchCode = @BranchCode 
        AND AccountNoCode = @AccountNoCode
      `);

    if (accountResult.recordset.length === 0) {
      console.warn('Account not found:', { BankCode, BranchCode, AccountNo });
      return res.status(404).json({ status: 'error', message: 'Account not found' });
    }

    const currentBalance = accountResult.recordset[0].CashInBank || 0;
    console.log('Current CashInBank:', currentBalance);

    // Calculate new balance based on Credit flag
    let newBalance;
    if (Credit) { // Credit = true means increase balance (deposit)
      newBalance = currentBalance + amount;
    } else { // Credit = false means decrease balance (withdrawal)
      if (currentBalance < amount) {
        console.warn('Insufficient balance:', { currentBalance, amount });
        return res.status(400).json({ status: 'error', message: 'Insufficient balance' });
      }
      newBalance = currentBalance - amount;
    }

    // Start transaction
    console.log('Starting SQL transaction...');
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Update CashInBank in aTAccountNo
      console.log('Updating CashInBank to:', newBalance);
      await transaction.request()
        .input('BankCode', sql.Int, BankCode)
        .input('BranchCode', sql.Int, BranchCode)
        .input('AccountNoCode', sql.Int, AccountNo)
        .input('CashInBank', sql.Decimal(18, 2), newBalance)
        .query(`
          UPDATE [dbo].aTAccountNo 
          SET CashInBank = @CashInBank
          WHERE BankCode = @BankCode 
          AND BranchCode = @BranchCode 
          AND AccountNoCode = @AccountNoCode
        `);

      // Use SQL Server's GETDATE() for Date and Time
      const debit = Credit ? null : amount; // Debit for withdrawals (Credit = false)
      const credit = Credit ? amount : null; // Credit for deposits (Credit = true)

      // Insert into aTDailyDeposits using GETDATE()
      console.log('Inserting into aTDailyDeposits:', { AccountNoCode: AccountNo, Debit: debit, Credit: credit, Notes, AccountID, ExpensesCode, UserCode: userCode });
      await transaction.request()
        .input('AccountNoCode', sql.Int, AccountNo)
        .input('Debit', sql.Money, debit)
        .input('Credit', sql.Money, credit)
        .input('Notes', sql.NVarChar, Notes || '')
        .input('AccountID', sql.Int, AccountID)
        .input('ExpensesCode', sql.Int, ExpensesCode || null)
        .input('UserCode', sql.Int, userCode)
        .query(`
          INSERT INTO [dbo].aTDailyDeposits (
            AccountNoCode, Date, Time, Debit, Credit, Notes, AccountID, ExpensesCode, UserCode
          )
          VALUES (
            @AccountNoCode, GETDATE(), GETDATE(), @Debit, @Credit, @Notes, @AccountID, @ExpensesCode, @UserCode
          )
        `);

      // Retrieve the inserted record to get the actual Date and Time
      console.log('Retrieving inserted transaction...');
      const insertedRecord = await transaction.request()
        .input('AccountNoCode', sql.Int, AccountNo)
        .query(`
          SELECT TOP 1 Date, Time
          FROM [dbo].aTDailyDeposits
          WHERE AccountNoCode = @AccountNoCode
          ORDER BY Time DESC
        `);
      if (insertedRecord.recordset.length === 0) {
        console.error('Failed to retrieve inserted transaction');
        throw new Error('Failed to retrieve inserted transaction');
      }
      const { Date, Time } = insertedRecord.recordset[0];
      console.log('Inserted Date:', Date.toISOString(), 'Inserted Time:', Time.toISOString());

      // Commit transaction
      await transaction.commit();
      console.log('Transaction committed successfully, new balance:', newBalance);

      res.json({ 
        status: 'success', 
        message: 'Transaction added successfully', 
        RemainingBalance: newBalance,
        Date: Date.toISOString().split('T')[0], // e.g., "2025-07-18"
        Time: Time.toISOString() // e.g., "2025-07-18T00:10:34.900Z"
      });
    } catch (err) {
      // Rollback transaction on error
      console.error('Transaction error:', JSON.stringify({ message: err.message, stack: err.stack, timestamp: new Date().toISOString() }, null, 2));
      await transaction.rollback();
      console.log('Transaction rolled back');
      res.status(500).json({ status: 'error', message: err.message });
    }
  } catch (err) {
    console.error('Database error:', JSON.stringify({ message: err.message, stack: err.stack, timestamp: new Date().toISOString() }, null, 2));
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
