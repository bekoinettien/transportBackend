
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');  // <-- Ajout pour WebSocket
require('dotenv').config();
// const { wss } = require('./webSocket'); // Importer le serveur WebSocket

const { wss, broadcast } = require('./webSocket'); // Importer le WebSocket (sécurisé)
const supabase = require('./supabase')

const connexionRoutes = require('./api/connexion');
const compteRoutes = require('./api/compteUser');
const clientRoutes = require('./api/client');
const paramsRoutes = require('./api/parametres');
const ticketsRoutes = require('./api/ticket');
const profileRoutes = require('./api/profile');
const bdBasesRoutes = require('./api/bdBase');
const voyagesRoutes = require('./api/voyages');
const bagagesRoutes = require('./api/bagages');
const colisRoutes = require('./api/colis');
const generalRoutes = require('./api/general');

const controleRoutiers = require('./api/controleRoutier')
const controleTicketRoutes = require('./api/controleTickets')


const app = express();
const PORT = process.env.PORT || 3000;


// Middlewares
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Création manuelle du serveur HTTP pour supporter WebSocket
const server = http.createServer(app);


// Routes publiques
app.use('/api/connexion', connexionRoutes);
app.use('/api/compte', compteRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/params', paramsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/bdBases', bdBasesRoutes);
app.use('/api/general', generalRoutes)

app.use('/api/colis', colisRoutes);
app.use('/api/bagages', bagagesRoutes)
app.use('/api/tickets', ticketsRoutes);
app.use('/api/voyages', voyagesRoutes);
app.use('/api/controles-routiers', controleRoutiers)
app.use('/api/controleTickets', controleTicketRoutes)



// Écouter les connexions WebSocket
server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});


// Écoute des modifications en temps réel dans Supabase sur les 12 tables
const tablesToListen = [
    'tickets',
    'sieges_supplementaires',
    'surplus_controles',
    'bagages',
    'colis',
    'colis_annulers',
    'colis_modifiers',
    'colis_retours',
    'retraits_colis',
    'controles_voyages',
    'ref_voyages',
    'voyages',
    'voyages_clients',
    'carburants',
    'parametres_gares_colis',
    'parametres_generaux_colis',
    'reclamations',
    'convois',
];

tablesToListen.forEach((table) => {
    supabase
        .channel(`realtime:${table}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, (payload) => {
            console.log(`Nouvelle insertion dans ${table}:`, payload.new);
            broadcast({
                type: `NEW_${table.toUpperCase()}`,
                payload: payload.new
            });
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, (payload) => {
            console.log(`Mise à jour dans ${table}:`, payload.new);
            broadcast({
                type: `UPDATE_${table.toUpperCase()}`,
                payload: payload.new
            });
        })
        .subscribe();
});

// Démarrage du serveur
server.listen(PORT, () => {
    console.log(`Serveur backend lancé sur http://localhost:${PORT}`);
});
