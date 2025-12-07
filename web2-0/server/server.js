// Simple Node.js WebSocket server simulating a fluid-bed coffee roaster
// Run with: `node server.js`
// Requires: npm i ws

import { WebSocketServer } from 'ws';

// --- Simulation Constants ---
const AMBIENT_TEMP = 25;
let ET = 25; // Environment temp
let BT = 25; // Bean temp
let FanVal = 0;
let BurnerVal = 0;
let msgId = 0;

// Heating/cooling dynamics (tunable)
const TICK_MS = 200;            // simulation step
const ET_HEAT_GAIN = 0.14;     // how much ET increases per burner percent per tick
const ET_COOL_GAIN = 0.03;     // how much ET decreases per fan percent per tick
const BT_TRANSFER = 0.2;      // how fast bean temp follows ET

const wss = new WebSocketServer({ port: 8080 });
console.log("Roaster simulation WebSocket server running on ws://localhost:8080");

// --- Main global simulation loop ---
setInterval(() => {
  simulatePhysics();
  const msg = createMessage();
  // Broadcast to all connected clients
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(JSON.stringify(msg));
  });
}, TICK_MS);

wss.on('connection', (ws) => {
  console.log('Client connected');

  // Send an immediate snapshot on connect
  ws.send(JSON.stringify(createMessage()));

  ws.on('message', (msg) => {
    try {
      const cmd = JSON.parse(msg.toString());
      handleCommand(cmd, ws);
    } catch (err) {
      console.error('Invalid message', err);
      ws.send(JSON.stringify({ error: 'invalid-json' }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// --- Command Handling -------------------------------------------------------
function handleCommand(cmd, ws) {
  if (!cmd || typeof cmd.command !== 'string') return;

  switch (cmd.command) {
    case 'getData': {
      // send a single snapshot (clients also receive periodic broadcasts)
      const snapshot = createMessage();
      ws.send(JSON.stringify(snapshot));
      break;
    }

    case 'setBurner':
      BurnerVal = clamp(Number(cmd.value) || 0, 0, 100);
      break;

    case 'setFan':
      FanVal = clamp(Number(cmd.value) || 0, 0, 100);
      break;

    case 'startCooling':
      BurnerVal = 0;
      FanVal = 100;
      break;

    default:
      ws.send(JSON.stringify({ error: 'unknown-command' }));
  }
}

// --- Simulation Model -------------------------------------------------------
function simulatePhysics() {
  // ET increases proportionally to burner setting
  ET += BurnerVal * ET_HEAT_GAIN;

  // ET drops proportionally to fan setting
  ET -= FanVal * ET_COOL_GAIN;

  // passive heat loss/gain toward ambient
  ET += (AMBIENT_TEMP - ET) * 0.0015;

  // Bean temp slowly follows ET
  BT += (ET - BT) * BT_TRANSFER;

  // clamp to reasonable bounds
  ET = clamp(ET, AMBIENT_TEMP, 450);
  BT = clamp(BT, AMBIENT_TEMP, 450);
}

function createMessage() {
  return {
    id: msgId++,
    data: {
      ET: Number(ET.toFixed(1)),
      BT: Number(BT.toFixed(1)),
      Amb: AMBIENT_TEMP,
      FanVal,
      BurnerVal,
    },
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// Optional: graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  wss.close(() => process.exit(0));
});
