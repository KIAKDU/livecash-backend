const express = require('express');
const router = express.Router();
const sql = require('mssql');
const authenticateToken = require('../middleware/auth');

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { AccountNoCode, ExpensesCode, UserCode, Debit, Credit, Notes, Date, Time } = req.body;

    if (!AccountNoCode || !ExpensesCode || !UserCode || !Date || (!Debit && !Credit)) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'AccountNoCode, ExpensesCode, UserCode, Date, and either Debit or Credit are required' 
      });
    }

    const pool = await req.app.locals.pool;
    if (!pool) {
      throw new Error('Database connection not established');
    }

    const expenseCheck = await pool.request()
      .input('ExpensesCode', sql.Int, ExpensesCode)
      .query('SELECT ExpensesCode FROM dbo.atExpenses WHERE ExpensesCode = @ExpensesCode');
    if (expenseCheck.recordset.length === 0) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid ExpensesCode' 
      });
    }

    const accountCheck = await pool.request()
      .input('AccountNoCode', sql.Int, AccountNoCode)
      .query('SELECT AccountNoCode FROM aTAccountNo WHERE AccountNoCode = @AccountNoCode');
    if (accountCheck.recordset.length === 0) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Invalid AccountNoCode' 
      });
    }

    const result = await pool.request()
      .input('AccountNoCode', sql.Int, AccountNoCode)
      .input('ExpensesCode', sql.Int, ExpensesCode)
      .input('UserCode', sql.Int, UserCode)
      .input('Debit', sql.Money, Debit || null)
      .input('Credit', sql.Money, Credit || null)
      .input('Notes', sql.NVarChar(2000), Notes || '')
      .input('Date', sql.DateTime, new Date(Date))
      .input('Time', sql.NVarChar(8), Time || null)
      .query(`
        INSERT INTO [dbo].[aTDailyDeposits] (AccountNoCode, ExpensesCode, UserCode, Debit, Credit, Notes, Date, Time)
        OUTPUT INSERTED.AccountID
        VALUES (@AccountNoCode, @ExpensesCode, @UserCode, @Debit, @Credit, @Notes, @Date, @Time)
      `);

    res.status(201).json({ 
      status: 'success', 
      message: 'Transaction added successfully', 
      accountId: result.recordset[0].AccountID 
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error adding transaction: ${err.message}`);
    res.status(500).json({ 
      status: 'error', 
      message: `Failed to add transaction: ${err.message}` 
    });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const pool = await req.app.locals.pool;
    if (!pool) {
      throw new Error('Database connection not established');
    }

    const { startDate, endDate, accountNoCode } = req.query;
    let query = `
      SELECT TOP 100
        t.DailyDepositCode, 
        t.AccountID, 
        t.AccountNoCode, 
        t.ExpensesCode AS ExpensesCode, 
        t.UserCode, 
        t.Debit, 
        t.Credit, 
        t.Notes, 
        CONVERT(VARCHAR(10), t.Date, 120) AS Date, 
        CONVERT(VARCHAR(8), t.Time, 108) AS Time,
        a.AccountNo, 
        e.Expenses,
        bb.BranchAdd,
        b.BankName
      FROM [dbo].[aTDailyDeposits] t
      LEFT JOIN aTAccountNo a ON t.AccountNoCode = a.AccountNoCode
      LEFT JOIN dbo.atExpenses e ON t.ExpensesCode = e.ExpensesCode
      LEFT JOIN dbo.aTBankBranch bb ON a.BranchCode = bb.BranchCode
      LEFT JOIN dbo.aTBanks b ON bb.BankCode = b.BankCode
      WHERE 1=1
    `;

    const request = pool.request();
    if (startDate) {
      query += ' AND t.Date >= @StartDate';
      request.input('StartDate', sql.DateTime, new Date(startDate));
    }
    if (endDate) {
      query += ' AND t.Date <= @EndDate';
      request.input('EndDate', sql.DateTime, new Date(endDate));
    }
    if (accountNoCode) {
      query += ' AND t.AccountNoCode = @AccountNoCode';
      request.input('AccountNoCode', sql.Int, parseInt(accountNoCode));
    }
    query += ' ORDER BY t.Date DESC, t.Time DESC';

    console.log(`[${new Date().toISOString()}] Executing query: ${query}`);
    const result = await request.query(query);
    console.log(`[${new Date().toISOString()}] Fetched transactions: ${result.recordset.length} records`);
    res.json({ status: 'success', transactions: result.recordset });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error fetching transactions: ${err.message}`);
    res.status(500).json({ 
      status: 'error', 
      message: `Failed to fetch transactions: ${err.message}` 
    });
  }
});

router.get('/years', authenticateToken, async (req, res) => {
  try {
    const pool = await req.app.locals.pool;
    if (!pool) {
      throw new Error('Database connection not established');
    }

    const result = await pool.request()
      .query(`
        SELECT DISTINCT YEAR(Date) AS year
        FROM [dbo].[aTDailyDeposits]
        WHERE Date IS NOT NULL
        ORDER BY year ASC
      `);

    const years = result.recordset.map(row => row.year);
    console.log(`[${new Date().toISOString()}] Fetched years: ${years}`);
    res.json({ status: 'success', years });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error fetching years: ${err.message}`);
    res.status(500).json({ 
      status: 'error', 
      message: `Failed to fetch years: ${err.message}` 
    });
  }
});

module.exports = router;