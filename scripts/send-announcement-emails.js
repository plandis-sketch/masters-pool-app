/**
 * Announcement Email Sender
 *
 * Checks Firestore for admin announcements where emailSent === false,
 * sends a BCC email to all registered participants via Gmail API,
 * then marks each announcement as emailSent = true.
 *
 * Runs every 5 minutes via GitHub Actions.
 * Usage: node scripts/send-announcement-emails.js
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore, collection, getDocs, query, where, updateDoc, doc,
} from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';

// --- Load .env (local) or use environment variables (GitHub Actions) ---
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
const env = {};
try {
  const envFile = readFileSync(envPath, 'utf-8');
  envFile.split('\n').forEach(line => {
    const [key, ...vals] = line.split('=');
    if (key && vals.length) env[key.trim()] = vals.join('=').trim();
  });
} catch {
  // No .env file — fall back to process.env (GitHub Actions)
}
const getEnv = (key) => process.env[key] || env[key];

// --- Firebase setup ---
const firebaseConfig = {
  apiKey: getEnv('VITE_FIREBASE_API_KEY'),
  authDomain: getEnv('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: getEnv('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: getEnv('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: getEnv('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: getEnv('VITE_FIREBASE_APP_ID'),
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// --- Gmail setup ---
const oauth2Client = new google.auth.OAuth2(
  getEnv('GMAIL_CLIENT_ID'),
  getEnv('GMAIL_CLIENT_SECRET'),
);
oauth2Client.setCredentials({ refresh_token: getEnv('GMAIL_REFRESH_TOKEN') });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

const FROM = 'itsphil24@gmail.com';
const SUBJECT = "Phil's Masters Pool — New Announcement";
const BATCH_SIZE = 499; // Gmail max recipients per message

function buildRawEmail({ bccList, subject, body }) {
  const lines = [
    `From: Phil's Masters Pool <${FROM}>`,
    `To: ${FROM}`,
    `Bcc: ${bccList.join(', ')}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    ``,
    body,
  ];
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

async function run() {
  // Find announcements that haven't had emails sent yet
  const messagesSnap = await getDocs(
    query(collection(db, 'messages'), where('emailSent', '==', false))
  );

  if (messagesSnap.empty) {
    console.log('No pending announcements.');
    return;
  }

  // Collect all participant emails
  const usersSnap = await getDocs(collection(db, 'users'));
  const emails = usersSnap.docs
    .map(d => d.data().email)
    .filter(e => typeof e === 'string' && e.includes('@'));

  if (emails.length === 0) {
    console.log('No participant emails found, skipping.');
    return;
  }

  for (const msgDoc of messagesSnap.docs) {
    const { content, authorName } = msgDoc.data();
    const body = [
      `New announcement from ${authorName || 'Admin'}:`,
      ``,
      content,
      ``,
      `---`,
      `View the full Message Board at https://phils-masters-pool.web.app`,
    ].join('\n');

    let allSent = true;
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      try {
        await gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: buildRawEmail({ bccList: batch, subject: SUBJECT, body }),
          },
        });
        console.log(`Sent announcement ${msgDoc.id} to ${batch.length} recipients (batch ${Math.floor(i / BATCH_SIZE) + 1})`);
      } catch (err) {
        console.error(`Failed to send batch for announcement ${msgDoc.id}:`, err.message);
        allSent = false;
      }
    }

    if (allSent) {
      await updateDoc(doc(db, 'messages', msgDoc.id), { emailSent: true });
      console.log(`Marked announcement ${msgDoc.id} as emailSent.`);
    }
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
