// Offline test preload: fail closed on socket, DNS and HTTP/network attempts.
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

let attempts = 0;
function denied() {
  attempts++;
  throw new Error('Network access forbidden in offline tests');
}
net.Socket.prototype.connect = denied;
net.connect = net.createConnection = denied;
tls.connect = denied;
http.request = http.get = https.request = https.get = denied;
dns.lookup = dns.resolve = denied;
dns.promises.lookup = dns.promises.resolve = denied;
globalThis.fetch = denied;
process.on('exit', () => {
  if (attempts) {
    console.error(`Offline guard detected ${attempts} network attempt(s)`);
    process.exitCode = 1;
  }
});
