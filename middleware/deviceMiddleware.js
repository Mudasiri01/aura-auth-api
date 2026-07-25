const deviceCheck = (req, res, next) => {
  const { deviceId, machineId } = req.body;
  const idToCheck = deviceId || machineId;

  if (!idToCheck) {
    return res.status(400).json({ error: 'Device ID is required' });
  }

  const deviceExists = req.user.devices.some((device) => device.deviceId === idToCheck);

  if (deviceExists) {
    next();
  } else {
    return res.status(403).json({ error: 'Unauthorized device.' });
  }
};

module.exports = { deviceCheck };
