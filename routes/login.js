const express = require("express");
const sql = require("mssql");
const { poolPromise } = require("../server");
const jwt = require("jsonwebtoken");

const router = express.Router();

// User Login Route
router.post("/", async (req, res) => {
  try {
    const { loginName, accessCode } = req.body;

    // Input validation
    if (!loginName || !accessCode) {
      console.warn("Validation failed: Missing loginName or accessCode", { loginName, accessCode });
      return res.status(400).json({
        status: "error",
        message: "LoginName and AccessCode are required",
      });
    }

    const pool = await poolPromise;
    if (!pool) {
      console.error("Database connection failed: Pool is undefined");
      return res.status(500).json({
        status: "error",
        message: "Database connection failed",
      });
    }

    const result = await pool
      .request()
      .input("loginName", sql.NVarChar(50), loginName)
      .input("accessCode", sql.NVarChar(50), accessCode)
      .query(
        "SELECT UserCode, Name, AccessCode, Admin, Active, US, Supervisor, BranchCode, Commission, AreaCode, LoginName, StockOut, Production, BCIn, BCOut FROM TUsers WHERE LoginName = @loginName AND AccessCode = @accessCode AND Active = 1"
      );

    if (result.recordset.length === 0) {
      console.warn("Authentication failed: Invalid credentials or inactive user", { loginName });
      return res.status(401).json({
        status: "error",
        message: "Invalid LoginName or AccessCode",
      });
    }

    const user = result.recordset[0];
    const token = jwt.sign(
      {
        userCode: user.UserCode,
        name: user.Name,
        admin: user.Admin || false,
        us: user.US || false,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    console.log("Login successful", { userCode: user.UserCode, name: user.Name, loginName: user.LoginName });
    res.json({
      status: "success",
      message: "Login successful",
      token,
      user: {
        userCode: user.UserCode,
        name: user.Name,
        accessCode: user.AccessCode,
        admin: user.Admin || false,
        active: user.Active || false,
        us: user.US || false,
        supervisor: user.Supervisor || false,
        branchCode: user.BranchCode,
        commission: user.Commission,
        areaCode: user.AreaCode,
        loginName: user.LoginName,
        stockOut: user.StockOut || false,
        production: user.Production || false,
        bcIn: user.BCIn || false,
        bcOut: user.BCOut || false,
      },
    });
  } catch (err) {
    console.error("Database error:", err.message, { stack: err.stack });
    res.status(500).json({
      status: "error",
      message: "Internal server error",
      error: err.message,
    });
  }
});

module.exports = router;