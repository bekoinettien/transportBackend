const WebSocket = require('ws');

// Initialisation du serveur WebSocket
const wss = new WebSocket.Server({ noServer: true });

// Diffuser les messages à tous les clients connectés
function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Gestion des connexions WebSocket
wss.on('connection', (ws) => {
  console.log('Client connecté au WebSocket.');

  ws.on('close', () => {
    console.log('Client déconnecté du WebSocket.');
  });
});

// Exporter le serveur WebSocket et la fonction de diffusion
module.exports = { wss, broadcast };
