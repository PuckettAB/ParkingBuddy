import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import {
  dbGetUser, dbUpsertUser, dbUpdateSpot, dbGetSpot,
  dbAddApplePush, dbRemoveApplePush
} from './db.js';
import { createApplePass } from './wallet/apple.js';
import { googleSaveUrl, googleUpdateObject } from './wallet/google.js';

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

const {
  PORT=3000,
  TAG_HMAC_SECRET,
  APPLE_TEAM_ID,
  APPLE_PASS_TYPE_ID,
  APPLE_P12_PASSWORD,
  APPLE_WEB_SERVICE_URL,
  GOOGLE_ISSUER_ID,
  ORIGIN,
  GARAGE_LAT,
  GARAGE_LON
} = process.env;

function verifyHmac({ garage, floor, stair, tag, sig }) {
  const data = `${garage}|${floor}|${stair}|${tag}`;
  const h = crypto.createHmac('sha256', TAG_HMAC_SECRET).update(data).digest('hex');
  return sig && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(sig));
}

function isAndroid(ua) { return /Android/i.test(ua || ''); }

function mapsUrl(ua, title) {
  return isAndroid(ua)
    ? `https://maps.google.com/?q=${encodeURIComponent(title)}`
    : `https://maps.apple.com/?q=${encodeURIComponent(title)}`;
}

// NFC entry point
app.get('/floor', async (req, res) => {
  const { garage, floor, stair, tag, sig } = req.query;
  if (!garage || !floor || !tag || !sig || !verifyHmac({ garage, floor, stair, tag, sig })) {
    return res.status(400).send('<h1>Unrecognized or tampered tag</h1>');
  }

  let uid = req.cookies.uid;
  if (!uid) {
    uid = crypto.randomUUID();
    res.cookie('uid', uid, { httpOnly: false, sameSite: 'Lax', secure: true, maxAge: 31536000000 });
  }

  // upsert user
  let user = await dbGetUser(uid, garage);
  if (!user) user = await dbUpsertUser({ uid, garage });

  // Save latest spot
  await dbUpdateSpot({ uid, garage, floor, stair: stair || '', ts: Date.now() });

  // If pass exists, update it now (Android direct; Apple via pull after push)
  const ua = req.headers['user-agent'] || '';
  const title = `Parked — Floor ${floor}${stair ? ' • ' + stair : ''}`;
  const maplink = mapsUrl(ua, title);

  let saveGoogleUrl = '';
  if (isAndroid(ua)) {
    const objectId = `${GOOGLE_ISSUER_ID}.${uid}-${garage}`;
    saveGoogleUrl = googleSaveUrl({
      issuerId: GOOGLE_ISSUER_ID,
      classId: `${GOOGLE_ISSUER_ID}.parking_generic`,
      origin: ORIGIN,
      objectId, garage, floor, stair,
      lat: GARAGE_LAT, lon: GARAGE_LON
    });
    // Store if not present
    if (!user.googleObjectId) {
      user = await dbUpsertUser({ uid, garage, googleObjectId: objectId });
    } else {
      await googleUpdateObject({ objectId: user.googleObjectId, garage, floor, stair });
    }
  }

  const needsApple = !isAndroid(ua) && !user.appleSerial;
  const needsGoogle = isAndroid(ua) && !user.googleObjectId;

  res.set('Content-Type', 'text/html');
  res.send(`
<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto;max-width:520px;margin:24px auto;padding:16px}
.btn{display:block;padding:14px 16px;margin:12px 0;border-radius:12px;border:1px solid #ccc;text-decoration:none;color:#000;text-align:center}
.ok{color:#2a7f2a}
small{opacity:.7}
</style>
<h1>Saved: Floor ${floor}${stair ? ' • ' + stair : ''}</h1>
<a class="btn" href="${maplink}">Open in Maps</a>
${needsApple ? `
<form method="POST" action="/wallet/apple/create">
  <input type="hidden" name="uid" value="${uid}">
  <input type="hidden" name="garage" value="${garage}">
  <input type="hidden" name="floor" value="${floor}">
  <input type="hidden" name="stair" value="${stair || ''}">
  <button class="btn">Add to Apple Wallet</button>
</form>` : `<p class="ok">Apple Wallet linked ✓</p>`}
${needsGoogle ? `<a class="btn" href="${saveGoogleUrl}">Add to Google Wallet</a>` : (isAndroid(ua) ? `<p class="ok">Google Wallet linked ✓</p>` : ``)}
<small>Tip: for nearby reminders, keep Location Services on (and Bluetooth on iOS). If prompted after tapping, unlock your phone.</small>
`);
});

// --- Apple: create .pkpass on demand
app.post('/wallet/apple/create', async (req, res) => {
  const { uid, garage, floor, stair } = req.body || {};
  if (!uid || !garage) return res.status(400).send('Missing');
  const { pkpass, serialNumber } = await createApplePass({
    uid, garage, floor, stair,
    teamId: APPLE_TEAM_ID,
    passTypeId: APPLE_PASS_TYPE_ID,
    p12Password: APPLE_P12_PASSWORD,
    webServiceURL: APPLE_WEB_SERVICE_URL
  });
  await dbUpsertUser({ uid, garage, appleSerial: serialNumber });
  res.set({
    'Content-Type': 'application/vnd.apple.pkpass',
    'Content-Disposition': 'attachment; filename=parking.pkpass'
  });
  return res.send(pkpass);
});

/* ---- Apple PassKit Web Service (v1) minimal implementation ----
Your apple_model/pass.json has:
 "webServiceURL": "https://YOURDOMAIN.com/applepass",
 "authenticationToken": "<random per pass>"
Wallet calls these endpoints to register for updates and to fetch updated passes.
For prototype simplicity, we skip per-pass auth; add it for production.
*/

// 1) Register device for push updates
app.post('/applepass/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeId/:serialNumber', async (req, res) => {
  // body: { pushToken }
  const { deviceLibraryIdentifier, passTypeId, serialNumber } = req.params;
  const { pushToken } = req.body || {};
  // serial looks like "uid-garage"
  const [uid, garage] = serialNumber.split('-');
  await dbAddApplePush(uid, garage, deviceLibraryIdentifier, pushToken);
  return res.status(201).json({});
});

// 2) Unregister device
app.delete('/applepass/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeId/:serialNumber', async (req, res) => {
  const { deviceLibraryIdentifier, serialNumber } = req.params;
  const [uid, garage] = serialNumber.split('-');
  await dbRemoveApplePush(uid, garage, deviceLibraryIdentifier);
  return res.status(200).json({});
});

// 3) List serials for a device (not used here; return empty)
app.get('/applepass/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeId', (req, res) => {
  return res.status(200).json({ serialNumbers: [], lastUpdated: new Date().toISOString() });
});

// 4) Return the updated .pkpass on pull
app.get('/applepass/v1/passes/:passTypeId/:serialNumber', async (req, res) => {
  // In a full implementation, read latest spot and rebuild the pass so fields reflect new floor/stair.
  const serialNumber = req.params.serialNumber;
  const [uid, garage] = serialNumber.split('-');
  const s = await dbGetSpot(uid, garage) || { floor: 4, stair: 'A' };
  const { pkpass } = await createApplePass({
    uid, garage, floor: s.floor, stair: s.stair,
    teamId: APPLE_TEAM_ID, passTypeId: APPLE_PASS_TYPE_ID,
    p12Password: APPLE_P12_PASSWORD, webServiceURL: APPLE_WEB_SERVICE_URL
  });
  res.set('Content-Type', 'application/vnd.apple.pkpass');
  return res.send(pkpass);
});

// Static assets (logo.png etc)
app.get('/logo.png', (req,res)=>res.sendFile(process.cwd()+'/apple_model/logo.png'));

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
