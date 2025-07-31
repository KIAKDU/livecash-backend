const express = require('express');
const router = express.Router();
const sql = require('mssql');
const jwt = require('jsonwebtoken');
require('dotenv').config();

console.log('bankBranch.js loaded successfully - Version: 3.5.4 (fixed CONCAT, strict bankCode filter, cascading AccountNo updates, enhanced logging)');

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

router.get('/version', (req, res) => {
  res.json({ status: 'success', version: 'bankBranch.js Version 3.5.4 (fixed CONCAT, strict bankCode filter, cascading AccountNo updates, enhanced logging)' });
});

router.get('/debug', authenticateToken, async (req, res) => {
  try {
    const pool = await req.app.locals.pool;
    const result = await pool.request().query(`
      SELECT TOP 100
        bb.BranchCode, bb.BranchAdd, bb.BankCode, b.BankName
      FROM dbo.aTBankBranch bb
      INNER JOIN dbo.aTBanks b ON bb.BankCode = b.BankCode
      ORDER BY bb.BankCode, bb.BranchAdd
    `);
    console.log('Debug aTBankBranch data:', result.recordset);
    res.json({ status: 'success', branches: result.recordset });
  } catch (err) {
    console.error('Debug endpoint error:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to fetch debug data: ${err.message}` });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    console.log('GET /api/accountNo/branches - Query:', req.query);
    const pool = await req.app.locals.pool;
    if (!pool) throw new Error('Database pool not initialized');
    const { BankCode } = req.query; // Case-sensitive to match query param
    if (!BankCode) {
      console.warn('GET /api/accountNo/branches - Missing BankCode parameter');
      return res.status(400).json({ status: 'error', message: 'BankCode parameter is required' });
    }
    const query = `
      SELECT 
        bb.BranchCode,
        bb.BranchAdd,
        bb.ContactPerson,
        bb.PhoneNo,
        bb.FaxNo,
        bb.BankCode,
        b.BankName
      FROM dbo.aTBankBranch bb
      INNER JOIN dbo.aTBanks b ON bb.BankCode = b.BankCode
      WHERE bb.BankCode = @BankCode
      ORDER BY bb.BranchAdd
    `;
    const result = await pool.request()
      .input('BankCode', sql.Int, parseInt(BankCode))
      .query(query);
    console.log(`GET /api/accountNo/branches?bankCode=${BankCode} - Fetched ${result.recordset.length} branches`, result.recordset);
    const branches = result.recordset.map(branch => ({
      BranchCode: branch.BranchCode,
      BranchAdd: branch.BranchAdd,
      ContactPerson: branch.ContactPerson,
      PhoneNo: branch.PhoneNo,
      FaxNo: branch.FaxNo,
      BankCode: branch.BankCode,
      BankName: branch.BankName,
    }));
    console.log(`GET /api/accountNo/branches?bankCode=${BankCode} - Transformed response:`, branches);
    res.json({ status: 'success', branches });
  } catch (err) {
    console.error(`GET /api/accountNo/branches - Error:`, err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to fetch branches: ${err.message}` });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  const { BranchAdd, ContactPerson, PhoneNo, FaxNo, BankCode } = req.body;
  try {
    console.log('POST /api/accountNo/branches - Request body:', req.body);
    if (!BranchAdd || !BankCode) {
      console.warn('POST /api/accountNo/branches - Missing BranchAdd or BankCode');
      return res.status(400).json({ status: 'error', message: 'BranchAdd and BankCode are required' });
    }
    if (BranchAdd.length > 15) {
      console.warn('POST /api/accountNo/branches - BranchAdd exceeds 15 characters');
      return res.status(400).json({ status: 'error', message: 'Branch Address cannot exceed 15 characters' });
    }
    const pool = await req.app.locals.pool;
    const bankCheck = await pool.request()
      .input('BankCode', sql.Int, BankCode)
      .query('SELECT BankCode, BankName FROM dbo.aTBanks WHERE BankCode = @BankCode');
    console.log('POST /api/accountNo/branches - Bank check result:', bankCheck.recordset);
    if (bankCheck.recordset.length === 0) {
      console.warn(`POST /api/accountNo/branches - Invalid BankCode: ${BankCode}`);
      return res.status(400).json({ status: 'error', message: 'Invalid BankCode' });
    }
    const { BankName } = bankCheck.recordset[0];
    const duplicateCheck = await pool.request()
      .input('BranchAdd', sql.NVarChar, BranchAdd.trim())
      .input('BankCode', sql.Int, BankCode)
      .query('SELECT BranchCode FROM dbo.aTBankBranch WHERE BranchAdd = @BranchAdd AND BankCode = @BankCode');
    console.log('POST /api/accountNo/branches - Duplicate check result:', duplicateCheck.recordset);
    if (duplicateCheck.recordset.length > 0) {
      console.warn(`POST /api/accountNo/branches - Duplicate BranchAdd: ${BranchAdd} for BankCode: ${BankCode}`);
      return res.status(400).json({ status: 'error', message: 'Branch Address already exists for this bank' });
    }
    const result = await pool.request()
      .input('BranchAdd', sql.NVarChar, BranchAdd.trim())
      .input('ContactPerson', sql.NVarChar, ContactPerson || null)
      .input('PhoneNo', sql.NVarChar, PhoneNo || null)
      .input('FaxNo', sql.NVarChar, FaxNo || null)
      .input('BankCode', sql.Int, BankCode)
      .query(`
        INSERT INTO dbo.aTBankBranch (BranchAdd, ContactPerson, PhoneNo, FaxNo, BankCode)
        OUTPUT INSERTED.BranchCode, INSERTED.BranchAdd, INSERTED.ContactPerson, INSERTED.PhoneNo, INSERTED.FaxNo, INSERTED.BankCode
        VALUES (@BranchAdd, @ContactPerson, @PhoneNo, @FaxNo, @BankCode);
        SELECT BankName FROM dbo.aTBanks WHERE BankCode = @BankCode
      `);
    console.log('POST /api/accountNo/branches - Insert result:', result.recordsets);
    const branch = {
      ...result.recordsets[0][0],
      BankName: result.recordsets[1][0].BankName
    };
    res.json({
      status: 'success',
      message: 'Branch created successfully',
      branch
    });
  } catch (err) {
    console.error('POST /api/accountNo/branches - Error:', err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to create branch: ${err.message}` });
  }
});

router.put('/:branchCode', authenticateToken, async (req, res) => {
  const { branchCode } = req.params;
  const { BranchAdd, ContactPerson, PhoneNo, FaxNo, BankCode } = req.body;
  try {
    console.log(`PUT /api/accountNo/branches/:${branchCode} - Request body:`, req.body);
    if (!BranchAdd || !BankCode) {
      console.warn(`PUT /api/accountNo/branches/:${branchCode} - Missing BranchAdd or BankCode`);
      return res.status(400).json({ status: 'error', message: 'BranchAdd and BankCode are required' });
    }
    if (BranchAdd.length > 15) {
      console.warn(`PUT /api/accountNo/branches/:${branchCode} - BranchAdd exceeds 15 characters`);
      return res.status(400).json({ status: 'error', message: 'Branch Address cannot exceed 15 characters' });
    }
    const pool = await req.app.locals.pool;
    const bankCheck = await pool.request()
      .input('BankCode', sql.Int, BankCode)
      .query('SELECT BankCode, BankName FROM dbo.aTBanks WHERE BankCode = @BankCode');
    console.log(`PUT /api/accountNo/branches/:${branchCode} - Bank check result:`, bankCheck.recordset);
    if (bankCheck.recordset.length === 0) {
      console.warn(`PUT /api/accountNo/branches/:${branchCode} - Invalid BankCode: ${BankCode}`);
      return res.status(400).json({ status: 'error', message: 'Invalid BankCode' });
    }
    const { BankName } = bankCheck.recordset[0];
    const duplicateCheck = await pool.request()
      .input('BranchAdd', sql.NVarChar, BranchAdd.trim())
      .input('BankCode', sql.Int, BankCode)
      .input('BranchCode', sql.Int, branchCode)
      .query('SELECT BranchCode FROM dbo.aTBankBranch WHERE BranchAdd = @BranchAdd AND BankCode = @BankCode AND BranchCode != @BranchCode');
    console.log(`PUT /api/accountNo/branches/:${branchCode} - Duplicate check result:`, duplicateCheck.recordset);
    if (duplicateCheck.recordset.length > 0) {
      console.warn(`PUT /api/accountNo/branches/:${branchCode} - Duplicate BranchAdd: ${BranchAdd} for BankCode: ${BankCode}`);
      return res.status(400).json({ status: 'error', message: 'Branch Address already exists for this bank' });
    }
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const branchUpdate = await transaction.request()
        .input('BranchCode', sql.Int, branchCode)
        .input('BranchAdd', sql.NVarChar, BranchAdd.trim())
        .input('ContactPerson', sql.NVarChar, ContactPerson || null)
        .input('PhoneNo', sql.NVarChar, PhoneNo || null)
        .input('FaxNo', sql.NVarChar, FaxNo || null)
        .input('BankCode', sql.Int, BankCode)
        .query(`
          UPDATE dbo.aTBankBranch
          SET BranchAdd = @BranchAdd,
              ContactPerson = @ContactPerson,
              PhoneNo = @PhoneNo,
              FaxNo = @FaxNo,
              BankCode = @BankCode
          OUTPUT INSERTED.BranchCode, INSERTED.BranchAdd, INSERTED.ContactPerson, INSERTED.PhoneNo, INSERTED.FaxNo, INSERTED.BankCode
          WHERE BranchCode = @BranchCode;
          SELECT BankName FROM dbo.aTBanks WHERE BankCode = @BankCode
        `);
      if (branchUpdate.recordsets[0].length === 0) {
        await transaction.rollback();
        console.warn(`PUT /api/accountNo/branches/:${branchCode} - Branch not found`);
        return res.status(404).json({ status: 'error', message: 'Branch not found' });
      }
      const accountUpdate = await transaction.request()
        .input('BranchCode', sql.Int, branchCode)
        .input('BranchAdd', sql.NVarChar, BranchAdd.trim())
        .input('BankName', sql.NVarChar, BankName)
        .query(`
          UPDATE a
          SET a.AccountNo = RTRIM(LTRIM(RTRIM(LTRIM(SUBSTRING(a.AccountNo, 1, CHARINDEX(' ', a.AccountNo + ' ')))) + ' ' + RTRIM(LTRIM(@BranchAdd)) + ' ' + RTRIM(LTRIM(@BankName))))
          FROM dbo.aTAccountNo a
          JOIN dbo.aTBankBranch bb ON a.BranchCode = bb.BranchCode
          WHERE a.BranchCode = @BranchCode;
          SELECT @@ROWCOUNT as rowsAffected
        `);
      console.log(`PUT /api/accountNo/branches/:${branchCode} - Updated ${accountUpdate.recordsets[0][0].rowsAffected} accounts in aTAccountNo`);
      await transaction.commit();
      const branch = {
        ...branchUpdate.recordsets[0][0],
        BankName: branchUpdate.recordsets[1][0].BankName
      };
      res.json({
        status: 'success',
        message: 'Branch and related accounts updated successfully',
        branch
      });
    } catch (err) {
      await transaction.rollback();
      console.error(`PUT /api/accountNo/branches/:${branchCode} - Transaction error:`, err.message, { stack: err.stack });
      throw err;
    }
  } catch (err) {
    console.error(`PUT /api/accountNo/branches/:${branchCode} - Error:`, err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to update branch: ${err.message}` });
  }
});

router.delete('/:branchCode', authenticateToken, async (req, res) => {
  const { branchCode } = req.params;
  try {
    console.log(`DELETE /api/accountNo/branches/:${branchCode}`);
    const pool = await req.app.locals.pool;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      const accountDelete = await transaction.request()
        .input('BranchCode', sql.Int, branchCode)
        .query(`
          DELETE FROM dbo.aTAccountNo
          WHERE BranchCode = @BranchCode;
          SELECT @@ROWCOUNT as rowsAffected
        `);
      console.log(`DELETE /api/accountNo/branches/:${branchCode} - Deleted ${accountDelete.recordsets[0][0].rowsAffected} accounts from aTAccountNo`);
      const branchDelete = await transaction.request()
        .input('BranchCode', sql.Int, branchCode)
        .query(`
          DELETE FROM dbo.aTBankBranch
          WHERE BranchCode = @BranchCode;
          SELECT @@ROWCOUNT as rowsAffected
        `);
      if (branchDelete.recordsets[0][0].rowsAffected === 0) {
        await transaction.rollback();
        console.warn(`DELETE /api/accountNo/branches/:${branchCode} - Branch not found`);
        return res.status(404).json({ status: 'error', message: 'Branch not found' });
      }
      console.log(`DELETE /api/accountNo/branches/:${branchCode} - Deleted ${branchDelete.recordsets[0][0].rowsAffected} branch from aTBankBranch`);
      await transaction.commit();
      res.json({
        status: 'success',
        message: 'Branch and related accounts deleted successfully',
        details: {
          accountsDeleted: accountDelete.recordsets[0][0].rowsAffected,
          branchesDeleted: branchDelete.recordsets[0][0].rowsAffected
        }
      });
    } catch (err) {
      await transaction.rollback();
      console.error(`DELETE /api/accountNo/branches/:${branchCode} - Transaction error:`, err.message, { stack: err.stack });
      throw err;
    }
  } catch (err) {
    console.error(`DELETE /api/accountNo/branches/:${branchCode} - Error:`, err.message, { stack: err.stack });
    res.status(500).json({ status: 'error', message: `Failed to delete branch: ${err.message}` });
  }
});

module.exports = router;