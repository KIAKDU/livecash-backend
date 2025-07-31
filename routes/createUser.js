const express = require('express');
const sql = require('mssql');
const { poolPromise } = require('../server');
const router = express.Router();

// Get all users
router.get('/', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT UserCode, Name, LoginName, AccessCode, Admin, Active
      FROM dbo.TUsers
    `);
    console.log(`[${new Date().toISOString()}] Users fetched successfully`, { count: result.recordset.length });
    res.json({ status: 'success', users: result.recordset });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error fetching users`, { error: err.message, stack: err.stack });
    res.status(500).json({ status: 'error', message: 'Failed to fetch users' });
  }
});

// Create a new user
router.post('/', async (req, res) => {
  const { Name, LoginName, AccessCode, Admin, Active } = req.body;

  if (!Name || !LoginName || !AccessCode) {
    console.warn(`[${new Date().toISOString()}] Validation failed: Missing required fields`, { body: req.body });
    return res.status(400).json({ status: 'error', message: 'Name, LoginName, and AccessCode are required' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('Name', sql.NVarChar(50), Name.trim())
      .input('LoginName', sql.NVarChar(50), LoginName.trim())
      .input('AccessCode', sql.NVarChar(50), AccessCode.trim())
      .input('Admin', sql.Bit, Admin ? 1 : 0)
      .input('Active', sql.Bit, Active ? 1 : 0)
      .query(`
        INSERT INTO dbo.TUsers (Name, LoginName, AccessCode, Admin, Active)
        VALUES (@Name, @LoginName, @AccessCode, @Admin, @Active);
        SELECT SCOPE_IDENTITY() AS UserCode;
      `);

    console.log(`[${new Date().toISOString()}] User created successfully`, { UserCode: result.recordset[0].UserCode });
    res.json({ status: 'success', message: 'User created successfully', UserCode: result.recordset[0].UserCode });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error creating user`, { error: err.message, stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to create user: ${err.message}` });
  }
});

// Update a user
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { Name, LoginName, AccessCode, Admin, Active } = req.body;

  if (!Name || !LoginName || !AccessCode) {
    console.warn(`[${new Date().toISOString()}] Validation failed: Missing required fields`, { body: req.body });
    return res.status(400).json({ status: 'error', message: 'Name, LoginName, and AccessCode are required' });
  }

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('UserCode', sql.Int, id)
      .input('Name', sql.NVarChar(50), Name.trim())
      .input('LoginName', sql.NVarChar(50), LoginName.trim())
      .input('AccessCode', sql.NVarChar(50), AccessCode.trim())
      .input('Admin', sql.Bit, Admin ? 1 : 0)
      .input('Active', sql.Bit, Active ? 1 : 0)
      .query(`
        UPDATE dbo.TUsers
        SET Name = @Name, LoginName = @LoginName, AccessCode = @AccessCode, Admin = @Admin, Active = @Active
        WHERE UserCode = @UserCode
      `);

    if (result.rowsAffected[0] === 0) {
      console.warn(`[${new Date().toISOString()}] User not found for update`, { UserCode: id });
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    console.log(`[${new Date().toISOString()}] User updated successfully`, { UserCode: id });
    res.json({ status: 'success', message: 'User updated successfully' });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error updating user`, { error: err.message, stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to update user: ${err.message}` });
  }
});

// Delete a user
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('UserCode', sql.Int, id)
      .query('DELETE FROM dbo.TUsers WHERE UserCode = @UserCode');

    if (result.rowsAffected[0] === 0) {
      console.warn(`[${new Date().toISOString()}] User not found for deletion`, { UserCode: id });
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    console.log(`[${new Date().toISOString()}] User deleted successfully`, { UserCode: id });
    res.json({ status: 'success', message: 'User deleted successfully' });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error deleting user`, { error: err.message, stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to delete user: ${err.message}` });
  }
});

module.exports = router;