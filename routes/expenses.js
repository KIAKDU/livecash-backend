const express = require("express");
const sql = require("mssql");
const { poolPromise } = require("../server");
const jwt = require("jsonwebtoken");
require('dotenv').config();

const router = express.Router();

console.log('expenses.js loaded - Version 2025-07-09 v3 with Active column');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.error('Authentication error: No token provided');
    return res.status(401).json({ status: 'error', message: 'Token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error('Authentication error: Invalid or expired token', err.message);
      return res.status(403).json({ status: 'error', message: 'Invalid token' });
    }
    req.user = user;
    console.log('JWT verified, userCode:', user.userCode);
    next();
  });
}

// Get all expenses
router.get("/", authenticateToken, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT ExpensesCode, Expenses, Active
      FROM dbo.aTExpenses
    `);
    console.log('Expenses query result:', JSON.stringify(result.recordset, null, 2));
    res.json({ status: 'success', expenses: result.recordset });
  } catch (err) {
    console.error('Error fetching expenses:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: 'Failed to fetch expenses' });
  }
});

// Create a new expense
router.post('/', authenticateToken, async (req, res) => {
  const { ExpenseName, Active = true } = req.body; // Default Active to true if not provided

  if (!ExpenseName) {
    console.error('Validation error: Expense name is required');
    return res.status(400).json({ status: 'error', message: 'Expense name is required' });
  }

  if (ExpenseName.length > 50) {
    console.error('Validation error: Expense name exceeds 50 characters', { ExpenseName });
    return res.status(400).json({ status: 'error', message: 'Expense name exceeds 50 characters' });
  }

  try {
    const pool = await poolPromise;
    console.log('Creating expense with ExpenseName:', ExpenseName, 'Active:', Active);

    // Get the maximum ExpensesCode and increment it
    const maxIdResult = await pool.request().query(`
      SELECT ISNULL(MAX(ExpensesCode), 0) + 1 AS NewExpensesCode
      FROM dbo.aTExpenses
    `);
    const newExpensesCode = maxIdResult.recordset[0].NewExpensesCode;

    // Insert the new expense with the calculated ExpensesCode and Active status
    const result = await pool.request()
      .input('ExpensesCode', sql.Int, newExpensesCode)
      .input('Expenses', sql.NVarChar(50), ExpenseName.trim())
      .input('Active', sql.Bit, Active ? 1 : 0)
      .query(`
        INSERT INTO dbo.aTExpenses (ExpensesCode, Expenses, Active)
        VALUES (@ExpensesCode, @Expenses, @Active)
        SELECT @ExpensesCode AS ExpensesCode
      `);
    console.log('Insert result:', result);
    res.json({ 
      status: 'success', 
      message: 'Expense created', 
      ExpensesCode: newExpensesCode 
    });
  } catch (err) {
    console.error('Error creating expense:', {
      message: err.message,
      stack: err.stack,
      sqlError: err.originalError ? err.originalError.info : null
    });
    res.status(500).json({ status: 'error', message: `Failed to create expense: ${err.message}` });
  }
});

// Edit an existing expense
router.put('/:expensesCode', authenticateToken, async (req, res) => {
  const expensesCode = parseInt(req.params.expensesCode);
  const { ExpenseName, Active } = req.body;

  if (isNaN(expensesCode)) {
    console.error('Validation error: Invalid ExpensesCode', { expensesCode });
    return res.status(400).json({ status: 'error', message: 'Invalid ExpensesCode' });
  }
  if (!ExpenseName) {
    console.error('Validation error: Expense name is required');
    return res.status(400).json({ status: 'error', message: 'Expense name is required' });
  }
  if (ExpenseName.length > 50) {
    console.error('Validation error: Expense name exceeds 50 characters', { ExpenseName });
    return res.status(400).json({ status: 'error', message: 'Expense name exceeds 50 characters' });
  }
  if (typeof Active !== 'boolean') {
    console.error('Validation error: Active must be a boolean', { Active });
    return res.status(400).json({ status: 'error', message: 'Active must be a boolean' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ExpensesCode', sql.Int, expensesCode)
      .input('Expenses', sql.NVarChar(50), ExpenseName.trim())
      .input('Active', sql.Bit, Active ? 1 : 0)
      .query(`
        UPDATE dbo.aTExpenses
        SET Expenses = @Expenses, Active = @Active
        WHERE ExpensesCode = @ExpensesCode
      `);

    if (result.rowsAffected[0] === 0) {
      console.error('Update error: Expense not found', { expensesCode });
      return res.status(404).json({ status: 'error', message: 'Expense not found' });
    }
    res.json({ status: 'success', message: 'Expense updated', ExpensesCode: expensesCode });
  } catch (err) {
    console.error('Error updating expense:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: 'Failed to update expense' });
  }
});

// Delete an expense
router.delete('/:expensesCode', authenticateToken, async (req, res) => {
  const expensesCode = parseInt(req.params.expensesCode);

  if (isNaN(expensesCode)) {
    console.error('Validation error: Invalid ExpensesCode', { expensesCode });
    return res.status(400).json({ status: 'error', message: 'Invalid ExpensesCode' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('ExpensesCode', sql.Int, expensesCode)
      .query(`
        DELETE FROM dbo.aTExpenses
        WHERE ExpensesCode = @ExpensesCode
      `);

    if (result.rowsAffected[0] === 0) {
      console.error('Delete error: Expense not found', { expensesCode });
      return res.status(404).json({ status: 'error', message: 'Expense not found' });
    }
    res.json({ status: 'success', message: 'Expense deleted', ExpensesCode: expensesCode });
  } catch (err) {
    console.error('Error deleting expense:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: 'Failed to delete expense' });
  }
});

module.exports = router;