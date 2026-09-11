const { generateLicenseKeys } = require('../utils/crypto');

console.log('Generating Ed25519 License Keys...\n');
const { publicKey, privateKey } = generateLicenseKeys();

console.log('--- ADD THESE TO YOUR API .env FILE ---');
console.log('LICENSE_PRIVATE_KEY="' + privateKey.replace(/\n/g, '\\n') + '"');
console.log('\n--- ADD THIS TO YOUR FRONTEND (or distribute with client) ---');
console.log('LICENSE_PUBLIC_KEY="' + publicKey.replace(/\n/g, '\\n') + '"');
console.log('\nKeys generated successfully.');
