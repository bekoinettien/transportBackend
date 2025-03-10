const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const http = require('http');
const supabase = require('./supabase')
require('dotenv').config();

// const { wss, broadcast } = require('./webSockets'); // Importer le WebSocket (sécurisé)
const { ws, broadcast } = require('./webSockets'); // Importer le WebSocket (non sécurisé)
const connexionRoutes = require('./api/connexion');
const compteRoutes = require('./api/compteUser');
const clientRoutes = require('./api/client');
const paramsRoutes = require('./api/parametres');
const ticketsRoutes = require('./api/ticket');
const profileRoutes = require('./api/profile');
const bdBasesRoutes = require('./api/bdBase');
const voyagesRoutes = require('./api/voyages');
const bagagesRoutes = require('./api/bagages');
const generalRoutes = require('./api/general');

const app = express();
const PORT = process.env.PORT || 3000;



// Middleware
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Création du serveur HTTP
const server = http.createServer(app);

// Routes publiques
app.use('/api/connexion', connexionRoutes);
app.use('/api/compte', compteRoutes);
app.use('/api/client', clientRoutes);
app.use('/api/params', paramsRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/bdBases', bdBasesRoutes);
app.use('/api/voyages', voyagesRoutes);
app.use('/api/bagages', bagagesRoutes);
app.use('/api/general', generalRoutes);

// WebSocket écoute les connexions
server.on('upgrade', (request, socket, head) => {
    ws.handleUpgrade(request, socket, head, (ws) => {
        ws.emit('connection', ws, request);
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
