const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader']
  });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  console.log('Loading game...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load' });
  await page.waitForTimeout(5000);

  console.log('\n=== INTEGRATION TESTS ===\n');

  // 1. UI Elements
  const uiChecks = await page.evaluate(() => ({
    overlay: document.getElementById('mp-overlay') !== null,
    playBtn: document.getElementById('mp-play-btn') !== null,
    lobby: document.getElementById('mp-lobby') !== null,
    createBtn: document.getElementById('mp-create-btn') !== null,
    joinBtn: document.getElementById('mp-join-btn') !== null,
    status: document.getElementById('mp-status') !== null,
    disconnect: document.getElementById('mp-disconnect') !== null,
    backBtn: document.getElementById('mp-back-btn') !== null,
  }));

  console.log('--- UI Elements ---');
  for (const [k, v] of Object.entries(uiChecks)) {
    console.log(`  ${k}: ${v ? 'OK' : 'FAIL'}`);
  }

  // 2. Global Objects
  const globals = await page.evaluate(() => ({
    MPRuntime: typeof window.MPRuntime !== 'undefined',
    MPNetwork: typeof window.MPNetwork !== 'undefined',
    MPGame: typeof window.MPGame !== 'undefined',
    MPSync: typeof window.MPSync !== 'undefined',
    MPUI: typeof window.MPUI !== 'undefined',
    Peer: typeof Peer !== 'undefined',
  }));

  console.log('\n--- Global Objects ---');
  for (const [k, v] of Object.entries(globals)) {
    console.log(`  ${k}: ${v ? 'OK' : 'FAIL'}`);
  }

  // 3. C3 Runtime Hook
  const runtimeReady = await page.evaluate(() => window.MPRuntime._ready);
  console.log('\n--- C3 Runtime ---');
  console.log(`  Runtime hooked: ${runtimeReady ? 'OK' : 'FAIL'}`);

  if (runtimeReady) {
    // 4. Read Global Variables
    const vars = await page.evaluate(() => ({
      P1Control: window.MPRuntime.p1Control,
      P2Control: window.MPRuntime.p2Control,
      CPU: window.MPRuntime.cpu,
      p1Score: window.MPRuntime.p1Score,
      p2Score: window.MPRuntime.p2Score,
      goal: window.MPRuntime.goal,
      pause: window.MPRuntime.pause,
      menu: window.MPRuntime.menu,
    }));
    console.log('\n--- Global Variables (read) ---');
    for (const [k, v] of Object.entries(vars)) {
      console.log(`  ${k}: ${v}`);
    }

    // 5. Write Global Variables
    const writeTests = await page.evaluate(() => {
      const results = {};
      // Test writing CPU
      window.MPRuntime.cpu = 42;
      results.writeCPU = window.MPRuntime.cpu === 42;
      window.MPRuntime.cpu = 0; // restore

      // Test writing P2Control
      window.MPRuntime.p2Control = 5;
      results.writeP2Control = window.MPRuntime.p2Control === 5;
      window.MPRuntime.p2Control = 0; // restore

      return results;
    });
    console.log('\n--- Variable Write ---');
    for (const [k, v] of Object.entries(writeTests)) {
      console.log(`  ${k}: ${v ? 'OK' : 'FAIL'}`);
    }

    // 6. Object Access
    const objTest = await page.evaluate(() => {
      try {
        const rt = window.MPRuntime._runtime;
        const objNames = Object.keys(rt.objects);
        const bodyObj = rt.objects.body;
        const bodyInst = bodyObj ? bodyObj.getFirstInstance() : null;
        return {
          totalObjects: objNames.length,
          hasBody: objNames.includes('body'),
          hasBody2: objNames.includes('body2'),
          hasHead: objNames.includes('head'),
          hasArm: objNames.includes('arm'),
          bodyInstance: bodyInst ? { x: bodyInst.x, y: bodyInst.y, angle: bodyInst.angle } : null,
        };
      } catch(e) {
        return { error: e.message };
      }
    });
    console.log('\n--- Object Access ---');
    console.log(`  Total objects: ${objTest.totalObjects}`);
    console.log(`  body: ${objTest.hasBody ? 'OK' : 'FAIL'}`);
    console.log(`  body2: ${objTest.hasBody2 ? 'OK' : 'FAIL'}`);
    console.log(`  head: ${objTest.hasHead ? 'OK' : 'FAIL'}`);
    console.log(`  arm: ${objTest.hasArm ? 'OK' : 'FAIL'}`);
    if (objTest.bodyInstance) {
      console.log(`  body position: (${objTest.bodyInstance.x.toFixed(1)}, ${objTest.bodyInstance.y.toFixed(1)}) angle=${objTest.bodyInstance.angle.toFixed(3)}`);
    }

    // 7. Full State Snapshot
    const stateTest = await page.evaluate(() => {
      try {
        const state = window.MPRuntime.getFullState();
        if (!state) return { error: 'null state' };
        return {
          bodyCount: Object.keys(state.bodies).length,
          bodyNames: Object.keys(state.bodies),
          hasTimestamp: typeof state.t === 'number',
          hasVars: typeof state.vars === 'object',
        };
      } catch(e) {
        return { error: e.message };
      }
    });
    console.log('\n--- Full State Snapshot ---');
    console.log(`  Bodies tracked: ${stateTest.bodyCount}`);
    console.log(`  Body names: ${stateTest.bodyNames ? stateTest.bodyNames.join(', ') : 'none'}`);
    console.log(`  Has timestamp: ${stateTest.hasTimestamp ? 'OK' : 'FAIL'}`);
    console.log(`  Has vars: ${stateTest.hasVars ? 'OK' : 'FAIL'}`);

    // 8. Room Code Generation
    const codeTest = await page.evaluate(() => {
      const codes = [];
      for (let i = 0; i < 5; i++) {
        codes.push(window.MPNetwork._generateCode());
      }
      return {
        codes,
        allLength6: codes.every(c => c.length === 6),
        allUnique: new Set(codes).size === codes.length,
      };
    });
    console.log('\n--- Room Codes ---');
    console.log(`  Generated: ${codeTest.codes.join(', ')}`);
    console.log(`  All 6 chars: ${codeTest.allLength6 ? 'OK' : 'FAIL'}`);
    console.log(`  All unique: ${codeTest.allUnique ? 'OK' : 'FAIL'}`);

    // 9. UI Interaction Test
    const uiTest = await page.evaluate(() => {
      // Click Play Online button
      const btn = document.getElementById('mp-play-btn');
      btn.click();
      const lobbyVisible = document.getElementById('mp-lobby').style.display === 'block';

      // Click Back
      document.getElementById('mp-back-btn').click();
      const lobbyHidden = document.getElementById('mp-lobby').style.display === 'none';

      return { lobbyOpened: lobbyVisible, lobbyClosed: lobbyHidden };
    });
    console.log('\n--- UI Interaction ---');
    console.log(`  Lobby opens on click: ${uiTest.lobbyOpened ? 'OK' : 'FAIL'}`);
    console.log(`  Lobby closes on back: ${uiTest.lobbyClosed ? 'OK' : 'FAIL'}`);
  }

  // Print MP logs
  const mpLogs = logs.filter(l => l.startsWith('[MP'));
  if (mpLogs.length > 0) {
    console.log('\n--- MP Console Logs ---');
    mpLogs.forEach(l => console.log(`  ${l}`));
  }

  // Print errors
  if (errors.length > 0) {
    console.log('\n--- PAGE ERRORS ---');
    errors.forEach(e => console.log(`  ERROR: ${e}`));
  } else {
    console.log('\n--- No page errors ---');
  }

  // Summary
  const allPassed = runtimeReady && Object.values(uiChecks).every(v => v) && Object.values(globals).every(v => v);
  console.log('\n=== RESULT: ' + (allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED') + ' ===\n');

  await browser.close();
})();
