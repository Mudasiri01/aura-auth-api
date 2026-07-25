const subscriptionCheck = (req, res, next) => {
  if (req.user && req.user.isAdmin) {
    return next();
  }
  
  if (req.user && (req.user.subscriptionStatus === 'active' || req.user.subscriptionStatus === 'trial')) {
    if (req.user.expiresAt && new Date() > new Date(req.user.expiresAt)) {
      return res.status(403).json({ error: 'Subscription Expired' });
    }
    next();
  } else {
    res.status(403).json({ error: 'Account is inactive. Subscription required.' });
  }
};

module.exports = { subscriptionCheck };
