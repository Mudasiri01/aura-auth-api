const jwt = require('jsonwebtoken');

const generateToken = (userId, email) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required.');
  }
  return jwt.sign(
    { id: userId, email },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
};

const generateRefreshToken = (userId, email) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required.');
  }
  return jwt.sign(
    { id: userId, email, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
};

const verifyToken = (token) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is required.');
  }
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return null;
  }
};

module.exports = { generateToken, generateRefreshToken, verifyToken };
