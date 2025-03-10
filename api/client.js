const express = require('express');
const { contactUnique } = require('./utils');
const supabase = require('../supabase');

const router = express.Router();


// Fonction pour générer un code client aléatoire
const generateRandomCode = (length = 40) => {
    const characters = "A9r/B0&g@C5=Dn!7E#u6{Fa)1Gt]4Hùw8Iès2J§qK?Lz5}M9y)NO2+mPQ@6l_RSk[3Th-U1f%VW0~gXY" +
        "i&8ZaCbç1EcA$d3=Se8!Qfg?T4h>F2i|Rj9[Mkl<7Ym}nP5oB*p6K$qrHs|0tXu)5vwN%7xDyU§z0Fm1yè2Lzû3Z4=aT5x-I67o_B8p9@G";
    let result = "";
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
};

const formatId = (id) => id.toString().padStart(3, "0");

// A- ENREGISTRER UN CLIENT
router.post('/enrgClient', async (req, res) => {
    const { nomClient, contactClient, profession } = req.body;

    if (!nomClient || !contactClient) {
        return res.status(400).json({
            success: false,
            message: "Vous devez renseigner le nom et contact du client !",
        });
    }

    try {
        // Vérifier si le contact existe déjà
        const estTrouve = await contactUnique(contactClient);
        if (estTrouve === true) {
            return res.status(404).json({ success: false, message: "Le contact existe déjà !" })
        }

        // Créer un code temporaire
        const codeTemporaire = generateRandomCode();

        // Enregistrer le client
        const { data: newClient, error: createError } = await supabase
            .from('clients_fideles')
            .insert([
                {
                    nomclient: nomClient,
                    contactclient: contactClient,
                    profession: profession,
                    codeclient: codeTemporaire,
                }
            ])
            .select()
            .single();

        if (createError) {
            throw createError;
        }

        // Générer le code client final
        const codeFinal = `C${formatId(newClient.id)}MDT`;

        // Mettre à jour le code client final
        const { data: clientMAJ, error: ErrorMAJ } = await supabase
            .from('clients_fideles')
            .update({ codeclient: codeFinal })
            .eq('id', newClient.id)
            .select()
            .single();

        if (ErrorMAJ) {
            throw ErrorMAJ;
        }

        res.status(201).json({
            success: true,
            message: "Client créé avec succès.",
            data: clientMAJ,
        });
    } catch (error) {
        console.error("Erreur interne :", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});

// B- RECHERCHER UN CLIENT ET LE NOMBRE DE VOYAGES
router.get('/searchClient/:contactClient', async (req, res) => {
    const { contactClient } = req.params;

    try {
        // Rechercher le client
        const { data: client, error: clientError } = await supabase
            .from('clients_fideles')
            .select('codeclient, nomclient, contactclient, profession')
            .eq('contactclient', contactClient)
            .single();

        if (clientError || !client) {
            return res.status(404).json({ success: false, message: "Client non trouvé !" });
        }

        // Récupérer le nombre total de voyages
        const { data: voyages, error: voyagesError } = await supabase
            .from('voyages_clients')
            .select('id', { count: 'exact' })
            .eq('codeclient', client.codeclient);

        if (voyagesError) {
            throw voyagesError;
        }

        // Nbre de voyages
        const nbre = voyages.length % 10

        res.status(200).json({
            success: true,
            data: {
                client,
                nbreVoyages: nbre,
            },
        });
    } catch (error) {
        console.error("Erreur :", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});

// C- LISTER LES N DERNIERS VOYAGES
router.get('/listeVoyages/:codeClient/:nbreVoyages', async (req, res) => {
    const { codeClient, nbreVoyages } = req.params;

    try {
        const { data: voyages, error: voyagesError } = await supabase
            .from('voyages_clients')
            .select(
                'refvoyage, gare, destination, datevoyage, matcontroleur, matcar, postes_controles(libelleposte), users(nomuser, prenomsuser)'
            )
            .eq('codeclient', codeClient)
            .order('datevoyage', { ascending: false })
            .limit(parseInt(nbreVoyages, 10));

        if (voyagesError) {
            throw voyagesError;
        }

        const listVoyages = voyages.map((voyage) => ({
            refVoyage: voyage.refvoyage,
            posteControle: voyage.postes_controles.libelleposte,
            gare: voyage.gare,
            destination: voyage.destination,
            dateVoyage: voyage.datevoyage,
            matControleur: voyage.matcontroleur,
            nomControleur: voyage.users.nomuser,
            prenomsControleur: voyage.users.prenomsuser,
            matCar: voyage.matcar,
        }));

        res.status(200).json({
            success: true,
            data: listVoyages,
        });
    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});
//*********************************************************************//


// D- Derniers tickets du jour du client
router.get('/derniers-tickets/:contactClient', async (req, res) => {
    const { contactClient } = req.params;

    try {
        // Recherche du codeClient
        const { data: client, error: errorClient } = await supabase
            .from('clients_fideles')
            .select('codeclient')
            .eq('contactclient', contactClient)
            .single();

        if (errorClient) {
            console.error("Erreur lors de la récupération des données :", errorClient);
            return res.status(500).json({
                success: false,
                message: "Une erreur interne est survenue. Veuillez réessayer plus tard.",
            });
        }

        if (!client) {
            return res.status(404).json({ success: false, message: "Aucun ticket. Client non trouvé !" });
        }

        const codeClient = client?.codeclient;

        // 1. Derniers tickets du jour
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const startOfDayISO = startOfDay.toISOString(); // ✅ Format valide pour Supabase

        const { data: tickets, error: errorTickets } = await supabase
            .from('tickets')
            .select(`
                id,
                refvoyage,
                numsiege,
                destination,
                typeticket,
                prixticket,
                contactclient,
                codeclient,
                dateticket,
                matguichetiere,
                ticketconsommer,
                clientbagage,
                gares ( nomgare ),
                users ( nomuser, prenomsuser ),
                ref_voyages ( matcar )
            `)
            .or(`contactclient.eq.${contactClient}, codeclient.eq.${codeClient}`) // Filtrage dynamique
            .gte('dateticket', startOfDayISO) // 🔹 Date au format ISO
            .order('dateticket', { ascending: false });

        if (errorTickets) {
            console.error("Erreur lors de la récupération des données :", errorTickets);
            return res.status(500).json({
                success: false,
                message: "Une erreur interne est survenue. Veuillez réessayer plus tard.",
            });
        }

        if (!tickets || tickets.length === 0) {
            return res.status(404).json({ success: true, message: "Aucun ticket acheté aujourd'hui !" });
        }

        const listeTickets = tickets.map(item => ({
            id: item.id,
            refvoyage: item.refvoyage,
            matcar: item.ref_voyages?.matcar || null, // Vérifier si ref_voyages existe
            numsiege: item.numsiege,
            nomgare: item.gares?.nomgare || null, // Vérifier si gares existe
            destination: item.destination,
            typeticket: item.typeticket,
            prixticket: item.prixticket,
            ticketutiliser: item.ticketconsommer,
            clientbagage: item.clientbagage,
            contactclient: item.contactclient,
            codeclient: item.codeclient,
            dateticket: item.dateticket,
            matguichetiere: item.matguichetiere,
            nomguichetiere: item.users?.nomuser || null, // Vérifier si users existe
            prenomsguichetiere: item.users?.prenomsuser || null, // Vérifier si users existe
        }));

        // 3. Retourner les données au client
        return res.status(200).json({
            success: true,
            message: "Informations du ticket :",
            listeTickets,
        });

    } catch (error) {
        console.error("Erreur interne :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
    }
});


// Route pour modifier les informations d'un client
router.put("/modifClient/:codeClient", async (req, res) => {
    const { codeClient } = req.params;
    const { nomClient, contactClient, profession } = req.body;

    try {
        // Vérification de l'existence du client
        const { data: client, error: clientError } = await supabase
            .from('clients_fideles')
            .select('*')
            .eq('codeclient', codeClient)
            .single();

        if (clientError || !client) {
            console.error("Client non trouvé");
            return res.status(404).json({
                success: false,
                message: "Client inconnu.",
            });
        }

        // Mise à jour des informations
        const { data: clientMAJ, error: errorMAJ } = await supabase
            .from('clients_fideles')
            .update({
                nomclient: nomClient || client.nomclient,
                contactclient: contactClient || client.contactclient,
                profession: profession || client.profession,
            })
            .eq('codeclient', codeClient)
            .select();

        if (errorMAJ || !clientMAJ) {
            return res.status(400).json({
                success: false,
                message: "Modifications non effectuées.",
            });
        }

        // Réponse finale
        return res.status(200).json({
            success: true,
            message: "Informations mises à jour avec succès.",
            data: clientMAJ,
        });

    } catch (error) {
        console.error("Erreur: impossible de contacter le serveur", error);
        return res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});


module.exports = router;
