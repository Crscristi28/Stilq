/**
 * One-time script to set admin custom claim
 *
 * Prerequisites:
 *   gcloud auth application-default login
 *   gcloud config set project elenor-57bde
 *
 * Run:
 *   node scripts/setAdmin.js
 */

const admin = require('firebase-admin');

// Initialize with Application Default Credentials
admin.initializeApp({
    projectId: 'elenor-57bde'
});

const ADMIN_EMAIL = 'cristinelbucioaca2801@gmail.com';

(async () => {
    try {
        const user = await admin.auth().getUserByEmail(ADMIN_EMAIL);
        console.log(`Found user: ${user.uid}`);

        await admin.auth().setCustomUserClaims(user.uid, { admin: true });
        console.log(`✅ Admin claim set for ${ADMIN_EMAIL}`);
        console.log(`\nIMPORTANT: Log out and log back in for the claim to take effect.`);

        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
})();
