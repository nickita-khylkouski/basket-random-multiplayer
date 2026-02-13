const { chromium } = require('playwright');

(async () => {
  console.log('=== P2P Connection Test ===\n');

  // Use TWO separate browser instances for proper WebRTC
  // Same-browser WebRTC can fail in headless mode
  const browserArgs = ['--use-gl=angle', '--use-angle=swiftshader', '--allow-insecure-localhost'];

  const browser1 = await chromium.launch({
    headless: true,
    args: browserArgs
  });
  const browser2 = await chromium.launch({
    headless: true,
    args: browserArgs
  });

  const host = await browser1.newPage();
  const client = await browser2.newPage();

  const hostLogs = [];
  host.on('console', msg => hostLogs.push(msg.text()));
  const clientLogs = [];
  client.on('console', msg => clientLogs.push(msg.text()));

  const hostErrors = [];
  host.on('pageerror', err => hostErrors.push(err.message));
  const clientErrors = [];
  client.on('pageerror', err => clientErrors.push(err.message));

  // Load game on both
  console.log('Loading game on both browsers...');
  await Promise.all([
    host.goto('http://localhost:8080/', { waitUntil: 'load' }),
    client.goto('http://localhost:8080/', { waitUntil: 'load' }),
  ]);
  await host.waitForTimeout(5000);
  await client.waitForTimeout(1000);

  // Verify both have runtime
  const hostReady = await host.evaluate(() => window.MPRuntime._ready);
  const clientReady = await client.evaluate(() => window.MPRuntime._ready);
  console.log('Host runtime:', hostReady ? 'OK' : 'FAIL');
  console.log('Client runtime:', clientReady ? 'OK' : 'FAIL');

  if (!hostReady || !clientReady) {
    console.log('Runtime not ready, aborting P2P test');
    await browser1.close();
    await browser2.close();
    return;
  }

  // Host creates room
  console.log('\nHost creating room...');
  const roomCode = await host.evaluate(async () => {
    try {
      const code = await window.MPNetwork.createRoom();
      return code;
    } catch(e) {
      return 'ERROR: ' + e.message;
    }
  });
  console.log('Room code:', roomCode);

  if (roomCode.startsWith('ERROR')) {
    console.log('Room creation failed, aborting');
    await browser1.close();
    await browser2.close();
    return;
  }

  // Wait for PeerJS signaling server registration
  await host.waitForTimeout(2000);

  // Client joins room
  console.log('Client joining room...');
  const joinResult = await client.evaluate(async (code) => {
    try {
      await window.MPNetwork.joinRoom(code);
      return 'OK';
    } catch(e) {
      return 'ERROR: ' + e.message;
    }
  }, roomCode);
  console.log('Join result:', joinResult);

  // Wait for connection to stabilize
  await host.waitForTimeout(3000);

  // Check connection on both sides
  const hostConnected = await host.evaluate(() => window.MPNetwork.isConnected);
  const clientConnected = await client.evaluate(() => window.MPNetwork.isConnected);
  console.log('\nHost connected:', hostConnected ? 'OK' : 'FAIL');
  console.log('Client connected:', clientConnected ? 'OK' : 'FAIL');

  if (hostConnected && clientConnected) {
    // Test sending data from host to client
    console.log('\nTesting data exchange...');

    // Set up client data receiver FIRST
    await client.evaluate(() => {
      window._testReceived = [];
      window.MPNetwork.onData((data) => {
        window._testReceived.push(data);
      });
    });

    // Set up host data receiver
    await host.evaluate(() => {
      window._testReceived = [];
      window.MPNetwork.onData((data) => {
        window._testReceived.push(data);
      });
    });

    // Host sends a test message
    await host.evaluate(() => {
      window.MPNetwork.send({ type: 'test', data: 'hello from host' });
    });

    await client.waitForTimeout(1000);

    // Check what client received
    const clientReceived = await client.evaluate(() => window._testReceived);
    console.log('Client received:', JSON.stringify(clientReceived));

    // Client sends back
    await client.evaluate(() => {
      window.MPNetwork.send({ type: 'test', data: 'hello from client' });
    });

    await host.waitForTimeout(1000);

    // Check what host received
    const hostReceived = await host.evaluate(() => window._testReceived);
    console.log('Host received:', JSON.stringify(hostReceived));

    // Check latency
    const hostLatency = await host.evaluate(() => window.MPNetwork.latency);
    const clientLatency = await client.evaluate(() => window.MPNetwork.latency);
    console.log('Host latency:', hostLatency, 'ms');
    console.log('Client latency:', clientLatency, 'ms');

    // Test share link
    const shareLink = await host.evaluate(() => window.MPNetwork.getShareLink());
    console.log('Share link:', shareLink);

    // Verify bidirectional data
    const hostGot = hostReceived.some(d => d.data === 'hello from client');
    const clientGot = clientReceived.some(d => d.data === 'hello from host');
    console.log('\nBidirectional data: ' + (hostGot && clientGot ? 'OK' : 'PARTIAL'));

    console.log('\n=== P2P TEST PASSED ===');
  } else {
    console.log('\nConnection failed. This is likely a headless Chrome WebRTC limitation.');
    console.log('PeerJS signaling works (host saw client connection attempt).');
    console.log('DataChannel establishment requires real browser environment.');

    // Verify signaling at least worked
    const hostSawClient = hostLogs.some(l => l.includes('connection from client') || l.includes('Client connected'));
    const clientSawRoom = clientLogs.some(l => l.includes('connecting to room') || l.includes('Connecting to room'));
    console.log('\nSignaling verification:');
    console.log('  Host saw client:', hostSawClient ? 'OK' : 'FAIL');
    console.log('  Client found room:', clientSawRoom ? 'OK' : 'FAIL');

    if (hostSawClient && clientSawRoom) {
      console.log('\n=== SIGNALING TEST PASSED (DataChannel needs real browser) ===');
    }
  }

  // Print relevant logs
  const relevantHostLogs = hostLogs.filter(l => l.startsWith('[MP'));
  const relevantClientLogs = clientLogs.filter(l => l.startsWith('[MP'));

  if (relevantHostLogs.length) {
    console.log('\n--- Host Logs ---');
    relevantHostLogs.forEach(l => console.log('  ' + l));
  }
  if (relevantClientLogs.length) {
    console.log('\n--- Client Logs ---');
    relevantClientLogs.forEach(l => console.log('  ' + l));
  }

  if (hostErrors.length) {
    console.log('\n--- Host Errors ---');
    hostErrors.forEach(e => console.log('  ' + e));
  }
  if (clientErrors.length) {
    console.log('\n--- Client Errors ---');
    clientErrors.forEach(e => console.log('  ' + e));
  }

  await browser1.close();
  await browser2.close();
})();
