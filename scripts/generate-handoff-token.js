// Generate a new API token for user_id=1 (admin) for handoff-check script.
// Run: node scripts/generate-handoff-token.js
// Then run the output SQL on the remote server.

const crypto = require('crypto');

const TOKEN_PREFIX = 'ck_live_';
const random = crypto.randomBytes(32).toString('hex');
const plaintext = TOKEN_PREFIX + random;

// We can't bcrypt here (module not available), so we generate the token
// and let the server hash it properly. Alternative: use the backend's own
// API to create the token.

console.log('=== NEW TOKEN ===');
console.log(plaintext);
console.log('');
console.log('Insert via SSH (manual approach):');
console.log('1. Revoke old: ssh oracle-vm "sqlite3 /opt/claudetracker-data/database.sqlite \'UPDATE api_tokens SET revoked_at = datetime(\\"\'now\\"\") WHERE user_id = 1 AND revoked_at IS NULL;\'"');
console.log('');
console.log('2. Insert (will hash on first use via findUserByApiToken fallback):');
console.log('Not possible without bcrypt. Use the backend API instead:');
console.log('');
console.log('=== ALTERNATIVE: Use backend API (if already authenticated) ===');
console.log('curl -X POST -H "Content-Type: application/json"');
console.log('  -H "Cookie: cut_session=<session_cookie>"');
console.log('  -d \'{"label":"handoff-check"}\'');
console.log('  https://claudetracker.wolfinisoftware.de/api/account/token/rotate');
