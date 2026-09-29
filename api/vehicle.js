import CryptoJS from 'crypto-js';

const DEFAULT_CONFIG = {
  baseUrl: 'https://delhigw.napix.gov.in/nic/parivahan',
  apiUrl: 'https://delhigw.napix.gov.in/nic/parivahan/mparivahan/wrapperapi',
  clientId: 'b91c303443f61b37106750823881cd2f',
  clientSecret: 'de83eeeb148878ae375f28756492e8a0'
};

// CORS wrapper
const cors = (handler) => async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  return handler(req, res);
};

function aesEncrypt(value, key) {
  const keyBytes = CryptoJS.enc.Utf8.parse(key);
  const encrypted = CryptoJS.AES.encrypt(value, keyBytes, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  });
  return encrypted.toString();
}

function aesDecrypt(encryptedValue, key) {
  const keyBytes = CryptoJS.enc.Utf8.parse(key);
  const decrypted = CryptoJS.AES.decrypt(encryptedValue, keyBytes, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  });
  return decrypted.toString(CryptoJS.enc.Utf8);
}

function generateRequestKey(timestamp) {
  return timestamp.slice(-4).split('').reverse().join('') + 
         timestamp.slice(0, 4).split('').reverse().join('') + 
         "!~)#@*&^";
}

async function handler(req, res) {
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
      return res.status(401).json({ error: 'Authentication failed' });
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
    } catch {
      result = { raw: rawText };
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
    return res.status(500).json({ error: error.message });
  }
}

export default cors(handler);
