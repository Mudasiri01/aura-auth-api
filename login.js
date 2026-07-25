const bcrypt = require('bcryptjs');
const { supabase } = require('./utils/supabase');
const { generateToken } = require('./utils/auth');

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
    const { email, password, machineId } = req.body;

    if (!email || !password || !machineId) {
      return res.status(400).json({ error: 'Email, password, and machineId are required.' });
    }

    // Fetch user from Supabase
    const { data: user, error: dbError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (dbError || !user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.active) {
      return res.status(403).json({ error: 'Your account has been disabled. Please contact the administrator.' });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Check Machine Lock
    if (!user.machine_id) {
      // First time login, save machine ID
      const { error: updateError } = await supabase
        .from('users')
        .update({ machine_id: machineId })
        .eq('id', user.id);

      if (updateError) {
        return res.status(500).json({ error: 'Failed to register machine ID.' });
      }
      user.machine_id = machineId;
    } else if (user.machine_id !== machineId) {
      return res.status(403).json({ error: 'This account is already activated on another computer.' });
    }

    // Generate JWT
    const token = generateToken(user);

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        active: user.active
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
}
