const crypto = require('crypto');

/**
 * Generate a new Ed25519 key pair for licensing.
 * @returns {Object} { publicKey, privateKey } in PEM format
 */
const generateLicenseKeys = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  return { publicKey, privateKey };
};

/**
 * Sign a license payload using the server's private Ed25519 key.
 * @param {Object} payload - The license data (e.g. { licenseId, deviceId, expiry })
 * @param {String} privateKeyPem - The private key in PEM format
 * @returns {String} The base64 encoded signature
 */
const signLicense = (payload, privateKeyPem) => {
  const dataString = JSON.stringify(payload);
  // Note: Ed25519 doesn't use hashes in createSign like RSA does, but we can just use crypto.sign
  // Actually, for ed25519, crypto.sign is simpler.
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(dataString), privateKey);
  return signature.toString('base64');
};

/**
 * Verify a signed license payload using the public Ed25519 key.
 * (This is a server-side helper; the client will do this on its own).
 * @param {Object} payload - The license data
 * @param {String} signature - The base64 encoded signature
 * @param {String} publicKeyPem - The public key in PEM format
 * @returns {Boolean} True if valid, false otherwise
 */
const verifyLicense = (payload, signature, publicKeyPem) => {
  try {
    const dataString = JSON.stringify(payload);
    const publicKey = crypto.createPublicKey(publicKeyPem);
    return crypto.verify(null, Buffer.from(dataString), publicKey, Buffer.from(signature, 'base64'));
  } catch (error) {
    return false;
  }
};

module.exports = {
  generateLicenseKeys,
  signLicense,
  verifyLicense
};
