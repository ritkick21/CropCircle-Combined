#!/usr/bin/env node

const url = process.env.SOCKET_URL ?? 'ws://localhost:3001/realtime/?EIO=4&transport=websocket';
const token = process.env.SOCKET_ACCESS_TOKEN;

const socket = new WebSocket(url);
let answered = false;
const timeout = setTimeout(() => {
  console.error(`Socket.IO probe timed out (${url})`);
  socket.close();
  process.exitCode = 1;
}, 5000);

socket.addEventListener('message', (event) => {
  const packet = String(event.data);
  if (packet.startsWith('0')) {
    socket.send(token ? '40' + JSON.stringify({ token }) : '40');
  } else if (packet.startsWith('44')) {
    answered = true;
    clearTimeout(timeout);
    const reply = JSON.parse(packet.slice(2));
    if (!token && reply.message === 'unauthorized') console.log(`Socket.IO: anonymous connection rejected (${url})`);
    else {
      console.error(`Socket.IO: unexpected authentication response (${url})`);
      process.exitCode = 1;
    }
    socket.close();
  } else if (packet.startsWith('40')) {
    if (token) socket.send('421["service.ping"]');
    else {
      clearTimeout(timeout);
      console.error('Socket.IO: unauthenticated connection was accepted');
      process.exitCode = 1;
      socket.close();
    }
  } else if (packet.startsWith('431')) {
    answered = true;
    const [result] = JSON.parse(packet.slice(3));
    if (result?.status === 'ok' && result?.service === 'api') {
      clearTimeout(timeout);
      console.log(`Socket.IO: ok (${url})`);
      socket.close();
    } else {
      console.error(`Socket.IO: unexpected response ${packet}`);
      process.exitCode = 1;
      socket.close();
    }
  }
});

socket.addEventListener('error', (error) => {
  clearTimeout(timeout);
  console.error(`Socket.IO: ${error.message ?? 'connection failed'}`);
  process.exitCode = 1;
});

socket.addEventListener('close', () => {
  clearTimeout(timeout);
  if (!answered && !process.exitCode) {
    console.error('Socket.IO closed before returning the expected response');
    process.exitCode = 1;
  }
});
