
// Built-in crypto module (Node.js native)
import crypto from 'crypto';

const DEFAULT_CONFIG = {
  baseUrl: 'https://delhigw.napix.gov.in/nic/parivahan',
  apiUrl: 'https://delhigw.napix.gov.in/nic/parivahan/mparivahan/wrapperapi',
  clientId: 'b91c303443f61b37106750823881cd2f',
  clientSecret: 'de83eeeb148878ae375f28756492e8a0'
};

// AES Encryption using Node.js crypto
function aesEncrypt(text, key) {
  const keyBuffer = Buffer.from(key, 'utf8');
  const cipher = crypto.createCipheriv('aes-128-ecb', keyBuffer, null);
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

function aesDecrypt(encryptedText, key) {
  const keyBuffer = Buffer.from(key, 'utf8');
  const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuffer, null);
  let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function generateRequestKey(timestamp) {
  return timestamp.slice(-4).split('').reverse().join('') + 
         timestamp.slice(0, 4).split('').reverse().join('') + 
         "!~)#@*&^";
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mobileNo, clientId, clientSecret } = req.body;
  
  if (!mobileNo || !/^\d{10}$/.test(mobileNo)) {
    return res.status(400).json({ error: 'Valid 10-digit mobile required' });
  }

  const cid = clientId || DEFAULT_CONFIG.clientId;
  const csec = clientSecret || DEFAULT_CONFIG.clientSecret;

  try {
    // Step 1: Get Token
    const tokenRes = await fetch(`${DEFAULT_CONFIG.baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: {
        'User-Agent': 'okhttp/4.9.2',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'napix',
        client_id: cid,
        client_secret: csec
      })
    });

    const tokenData = await tokenRes.json();
    
    if (!tokenData.access_token) {
      return res.status(401).json({ error: 'Authentication failed', details: tokenData });
    }

    // Step 2: Encrypted POST to get vehicles
    const timestamp = String(Date.now());
    const key = generateRequestKey(timestamp);
    const plainText = JSON.stringify({ mobileNo });
    const encryptedData = aesEncrypt(plainText, key);
    
    const envelope = { data: Buffer.from(encryptedData).toString('base64') };

    const vehicleRes = await fetch(
      `${DEFAULT_CONFIG.apiUrl}/vahan/vahancapi/common/getvehiclevalidity`,
      {
        method: 'POST',
        headers: {
          'User-Agent': 'okhttp/4.9.2',
          'Accept': 'application/json',
          'timestamp': timestamp,
          'Authorization': `Bearer ${tokenData.access_token}`,
          'Param2': '2.0.142',
          'Param1': 'abcd',
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(envelope)
      }
    );

    const rawText = await vehicleRes.text();
    let result;

    try {
      const outer = JSON.parse(rawText);
      if (outer.data) {
        const encryptedText = Buffer.from(outer.data, 'base64').toString();
        const decrypted = aesDecrypt(encryptedText, key);
        result = JSON.parse(decrypted);
      } else {
        result = outer;
      }
    } catch (e) {
      return res.status(500).json({ 
        error: 'Parse error', 
        raw: rawText.substring(0, 500),
        parseError: e.message 
      });
    }

    // Process result
    const apiMessage = result?.apiMessage || {};
    let vehicles = [];

    if (Array.isArray(result.data)) {
      vehicles = result.data.filter(v => typeof v === 'object');
    } else if (typeof result.data === 'object' && result.data !== null) {
      vehicles = [result.data];
    }

    if (vehicles.length === 0) {
      const msg = result?.error || 
                  apiMessage.developerMessage || 
                  apiMessage.message || 
                  'No vehicle registered against this mobile number.';
      return res.json({ found: false, message: msg });
    }

    return res.json({
      found: true,
      count: vehicles.length,
      vehicles: vehicles
    });

  } catch (error) {
    return res.status(500).json({ error: error.message, stack: error.stack });
  }
}
