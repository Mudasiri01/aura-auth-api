module.exports = async function handler(req, res) {
  // Add CORS headers for Electron
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // With JWT, logout is typically handled client-side by deleting the token.
  // We provide this endpoint to fulfill standard API structures.
  return res.status(200).json({ message: 'Logged out successfully' });
}
