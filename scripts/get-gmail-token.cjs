/**
 * One-time script to generate a Gmail OAuth2 refresh token.
 *
 * Usage:
 *   GMAIL_CLIENT_ID=<your-id> GMAIL_CLIENT_SECRET=<your-secret> node scripts/get-gmail-token.js
 *
 * It will print an authorization URL. Open it in your browser, authorize,
 * paste the code back, and the script will print your refresh token.
 * Store it with: firebase functions:secrets:set GMAIL_REFRESH_TOKEN
 */

const { google } = require("googleapis");
const readline = require("readline");

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Usage: GMAIL_CLIENT_ID=<id> GMAIL_CLIENT_SECRET=<secret> node scripts/get-gmail-token.js"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  "urn:ietf:wg:oauth:2.0:oob" // Desktop/OOB redirect
);

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent", // force refresh_token to be returned
});

console.log("\n1. Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n2. Authorize the app with itsphil24@gmail.com");
console.log("3. Paste the authorization code below:\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Authorization code: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log("\n--- Tokens received ---");
    console.log("Refresh token:", tokens.refresh_token);
    console.log("\nRun these commands to store secrets in Firebase:");
    console.log(`  firebase functions:secrets:set GMAIL_CLIENT_ID`);
    console.log(`  firebase functions:secrets:set GMAIL_CLIENT_SECRET`);
    console.log(`  firebase functions:secrets:set GMAIL_REFRESH_TOKEN`);
    console.log("\nWhen prompted, paste the corresponding value.");
    if (!tokens.refresh_token) {
      console.warn(
        "\nWARNING: No refresh_token returned. This usually means the app was already authorized.\n" +
          "Go to https://myaccount.google.com/permissions, revoke access for your app, then re-run this script."
      );
    }
  } catch (err) {
    console.error("Error exchanging code:", err.message);
  }
});
