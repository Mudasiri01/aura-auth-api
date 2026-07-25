const { supabase } = require('./utils/supabase');
const { verifyToken } = require('./utils/auth');

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

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { machineId } = req.body;
    if (!machineId) {
      return res.status(400).json({ error: 'Machine ID is required' });
    }

    // Check with Supabase to make sure user is still active
    const { data: user, error } = await supabase
      .from('users')
      .select('active, machine_id')
      .eq('id', decoded.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Your account has been disabled.' });
    }

    if (user.machine_id && user.machine_id !== machineId) {
       return res.status(403).json({ error: 'Machine mismatch. This account is locked to another machine.' });
    }

    return res.status(200).json({
      valid: true,
      user: {
        id: decoded.id,
        email: decoded.email
      }
    });

  } catch (error) {
    console.error('Verify error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
