const crypto = require('crypto');

// Use environment variable for encryption key
// In production, this should be a strong, randomly generated key
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-32-char-encryption-key!!'; // Must be 32 chars for AES-256
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Encrypt a string value
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted text in format: iv:encryptedData
 */
function encrypt(text) {
  if (!text) return null;

  try {
    // Ensure key is exactly 32 bytes
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32));

    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Return IV and encrypted data separated by colon
    return iv.toString('hex') + ':' + encrypted;
  } catch (err) {
    console.error('Encryption error:', err);
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt an encrypted string
 * @param {string} text - Encrypted text in format: iv:encryptedData
 * @returns {string} - Decrypted plain text
 */
function decrypt(text) {
  if (!text) return null;

  try {
    // Ensure key is exactly 32 bytes
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32, '0').substring(0, 32));

    const parts = text.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid encrypted text format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Decryption error:', err);
    throw new Error('Decryption failed');
  }
}

/**
 * Check if encryption key is set to default (insecure)
 * @returns {boolean}
 */
function isUsingDefaultKey() {
  return !process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY === 'default-32-char-encryption-key!!';
}

module.exports = {
  encrypt,
  decrypt,
  isUsingDefaultKey
};
