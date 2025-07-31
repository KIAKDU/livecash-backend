const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expecting "Bearer TOKEN"

  if (!token) {
    return res.status(401).json({ status: 'error', message: 'Access denied. No token provided.' });
  }

  try {
    const secret = process.env.JWT_SECRET || '8f9b2a7d5c4e3f1a9b8c7d6e5f4a3b2c1d9e8f7a6b5c4d3e2f1a9b8c7d6e5f4';
    const decoded = jwt.verify(token, secret);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('Token verification error:', err.message);
    res.status(403).json({ status: 'error', message: 'Invalid token.' });
  }
};

module.exports = authenticateToken;