const { supabase } = require('./utils/supabase');

module.exports = async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized: Invalid admin secret' });
    }

    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { data, error } = await supabase
      .from('users')
      .update({ machine_id: null })
      .eq('email', email)
      .select();

    if (error || data.length === 0) {
      return res.status(404).json({ error: 'User not found or database error' });
    }

    return res.status(200).json({ message: `Machine ID reset successfully for ${email}` });

  } catch (error) {
    console.error('Reset machine error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
