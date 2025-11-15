// wallet/google.js
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import fs from 'fs';

const SA = JSON.parse(fs.readFileSync('./certs/google-sa.json', 'utf8'));

export function googleSaveUrl({ issuerId, classId, origin, objectId, garage, floor, stair, lat, lon }) {
  const payload = {
    iss: SA.client_email,
    aud: 'google',
    typ: 'savetoandroidpay',
    origins: [origin],
    payload: {
      genericObjects: [{
        id: objectId,
        classId,
        logo: { sourceUri: { uri: `${origin}/logo.png` } },
        cardTitle: { defaultValue: { language: 'en-US', value: 'Parking Helper' } },
        subheader: { defaultValue: { language: 'en-US', value: `Garage ${garage}` } },
        header: { defaultValue: { language: 'en-US', value: `Floor ${floor}` } },
        textModulesData: [{ header: 'Stair/Elevator', body: stair || '' }],
        locations: [{ latitude: Number(lat), longitude: Number(lon) }]
      }],
      genericClasses: [{
        id: classId,
        issuerName: 'YourCo',
        reviewStatus: 'underReview',
        locations: [{ latitude: Number(lat), longitude: Number(lon) }]
      }]
    }
  };
  const token = jwt.sign(payload, SA.private_key, { algorithm: 'RS256', keyid: SA.private_key_id });
  return `https://pay.google.com/gp/v/save/${token}`;
}

export async function googleUpdateObject({ objectId, garage, floor, stair }) {
  const auth = new google.auth.GoogleAuth({
    credentials: SA,
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer']
  });
  const wallet = google.walletobjects({ version: 'v1', auth });
  await wallet.genericobject.patch({
    resourceId: objectId,
    resource: {
      header: { defaultValue: { language: 'en-US', value: `Floor ${floor}` } },
      subheader: { defaultValue: { language: 'en-US', value: `Garage ${garage}` } },
      textModulesData: [{ header: 'Stair/Elevator', body: stair || '' }]
    }
  });
}
