import assert from 'assert';
import handler from './src/index.js';

console.log('Running integration tests with real Ed25519 signature checks...');

// Helper to generate keypair and sign
async function setupTestAuth() {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const publicKeyHex = Buffer.from(publicKeyRaw).toString('hex');

  async function signPayload(bodyText, timestamp) {
    const encoder = new TextEncoder();
    const message = Buffer.concat([
      encoder.encode(timestamp),
      encoder.encode(bodyText)
    ]);
    const sigRaw = await crypto.subtle.sign(
      { name: 'Ed25519' },
      keyPair.privateKey,
      message
    );
    return Buffer.from(sigRaw).toString('hex');
  }

  return { publicKeyHex, signPayload };
}

const { publicKeyHex, signPayload } = await setupTestAuth();

const defaultEnv = {
  DISCORD_PUBLIC_KEY: publicKeyHex,
  ALLOWED_GUILD_ID: 'guild_123',
  CHANNEL_REPO_MAP_JSON: JSON.stringify({
    guilds: {
      guild_123: {
        channels: {
          channel_mapped: 'owner/repo',
          channel_invalid_repo: 'invalid_repo_name'
        }
      }
    }
  }),
  OPENAI_MODEL: 'gpt-5.5'
};

const defaultCtx = {
  waitUntil: (promise) => {
    // resolve immediately in tests
    promise.catch(err => console.error('Error in waitUntil:', err));
  }
};

async function testRequest(bodyObj, headersOverride = {}, env = defaultEnv) {
  const bodyText = JSON.stringify(bodyObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signPayload(bodyText, timestamp);

  const request = new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature-ed25519': signature,
      'x-signature-timestamp': timestamp,
      ...headersOverride
    },
    body: bodyText
  });

  return await handler.fetch(request, env, defaultCtx);
}

// 1. Invalid method or route
{
  const res = await handler.fetch(new Request('http://localhost/other', { method: 'POST' }), defaultEnv, defaultCtx);
  assert.strictEqual(res.status, 404);
  console.log('404 on invalid path passed');
}

// 2. Large body size
{
  const request = new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-length': '999999' }
  });
  const res = await handler.fetch(request, defaultEnv, defaultCtx);
  assert.strictEqual(res.status, 413);
  console.log('413 on large content-length passed');
}

// 3. Invalid signature
{
  const bodyText = JSON.stringify({ type: 1 });
  const request = new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'x-signature-ed25519': 'invalid_sig',
      'x-signature-timestamp': '123'
    },
    body: bodyText
  });
  const res = await handler.fetch(request, defaultEnv, defaultCtx);
  assert.strictEqual(res.status, 401);
  console.log('401 on invalid signature passed');
}

// 4. PING to PONG
{
  const res = await testRequest({ type: 1 });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.type, 1);
  console.log('PING interaction returns PONG passed');
}

// 5. Allowed Guild ID Guard
{
  const res = await testRequest({
    type: 2,
    guild_id: 'wrong_guild',
    data: { name: 'add-issue' }
  });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.data.content, 'Server không được phép dùng bot này.');
  console.log('Allowed Guild Guard passed');
}

// 6. Command missing text option
{
  const res = await testRequest({
    type: 2,
    guild_id: 'guild_123',
    data: {
      name: 'add-issue',
      options: []
    }
  });
  const data = await res.json();
  assert.strictEqual(data.data.content, 'Thiếu nội dung issue.');
  console.log('Command missing text validation passed');
}

// 7. Command with unmapped channel
{
  const res = await testRequest({
    type: 2,
    guild_id: 'guild_123',
    channel_id: 'unmapped_channel',
    data: {
      name: 'add-issue',
      options: [{ name: 'text', type: 3, value: 'Hello' }]
    }
  });
  const data = await res.json();
  assert.strictEqual(data.data.content, 'Channel này chưa được map với repo nào.');
  console.log('Command unmapped channel validation passed');
}

// 8. Command with invalid repo mapping
{
  const res = await testRequest({
    type: 2,
    guild_id: 'guild_123',
    channel_id: 'channel_invalid_repo',
    data: {
      name: 'add-issue',
      options: [{ name: 'text', type: 3, value: 'Hello' }]
    }
  });
  const data = await res.json();
  assert.strictEqual(data.data.content, 'Repo mapping không hợp lệ.');
  console.log('Command invalid repo validation passed');
}

// 9. Command valid mapping -> returns deferred response (type 5)
{
  const res = await testRequest({
    type: 2,
    guild_id: 'guild_123',
    channel_id: 'channel_mapped',
    data: {
      name: 'add-issue',
      options: [{ name: 'text', type: 3, value: 'Test issue text' }]
    }
  });
  const data = await res.json();
  assert.strictEqual(data.type, 5); // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
  console.log('Valid command returns deferred response passed');
}

console.log('All integration tests passed successfully!');
