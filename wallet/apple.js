// wallet/apple.js
import fs from 'fs';
import path from 'path';
import { Pass } from 'passkit-generator';

const P12 = fs.readFileSync('./certs/pass.p12');
const WWDR = fs.readFileSync('./certs/wwdr.pem');

export async function createApplePass({ uid, garage, floor, stair, teamId, passTypeId, p12Password, webServiceURL }) {
  const serialNumber = `${uid}-${garage}`;
  const pass = await Pass.from({
    model: path.join(process.cwd(), 'apple_model'),
    certificates: {
      wwdr: WWDR,
      signerCert: P12,
      signerKey: { keyFile: P12, passphrase: p12Password }
    },
    overrides: {
      teamIdentifier: teamId,
      passTypeIdentifier: passTypeId,
      serialNumber,
      webServiceURL,
      authenticationToken: cryptoRandom(24),
      'generic.primaryFields[0].value': String(floor),
      'generic.secondaryFields[0].value': stair || '',
      'generic.secondaryFields[1].value': garage
    }
  });
  pass.barcode = { message: serialNumber, format: 'PKBarcodeFormatQR', messageEncoding: 'iso-8859-1' };
  const stream = await pass.generate();
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return { pkpass: Buffer.concat(chunks), serialNumber };
}

export function cryptoRandom(n) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString('hex');
}
