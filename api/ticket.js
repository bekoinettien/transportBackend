const express = require('express');
const { formatsDateDuJour } = require('./utils')
const supabase = require('./../supabase')

const router = express.Router();

// 1- RENVOYER LE TYPE DE VOYAGE
router.get('/type-voyage/:typeVoyage', async (req, res) => {
    const { typeVoyage } = req.params

    try {
        const { data: typeDeVoyage, error: errorType } = await supabase
            .from('types_ref_voyages')
            .select('*')
            .eq('libelletypevoyage', typeVoyage)
            .maybeSingle()

        if (errorType) {
            console.error('Erreur du serveur :', error)
            return res.status(500).json({ success: false, message: "Erreur lors de la récupération des données." })
        }

        return res.status(200).json({
            success: true,
            typeVoyage: typeDeVoyage
        })
    } catch (error) {
        console.error('Erreur du serveur :', error)
        res.status(500).json({ success: false, message: "Erreur interne du sereur." })
    }
})
//******************************************************************//

// 2- Construction de refVoyage
router.post('/ref-voyage/:idDepartement/:codeDepartement/:typeRefVoyage', async (req, res) => {
    const { idDepartement, codeDepartement, typeRefVoyage } = req.params;
    const firstLetter = typeRefVoyage.slice(0, 1); // Extraire la première lettre du type de voyage

    let numDepart = '';

    try {
        // Date du jour (remise à 00:00:00 pour comparaison)
        const dateDuJour = new Date(new Date().setHours(0, 0, 0, 0));
        const dateJour = new Date();
        const dateFormatJour = formatsDateDuJour(dateJour)[4]; // Format AAAAMMJJ

        // Recherche de la dernière refVoyage correspondante dans Supabase
        const { data: lastRefVoyage, error } = await supabase
            .from('ref_voyages')
            .select('refvoyage')
            .eq('iddepartement', idDepartement)
            .ilike('refvoyage', `%${firstLetter}`) // Filtre sur la fin de la refVoyage
            .gte('daterefvoyage', dateDuJour.toISOString()) // Filtrer les voyages du jour
            .eq('disponible', true)
            .order('daterefvoyage', { ascending: false }) // Trier du plus récent au plus ancien
            .limit(1); // Prendre uniquement le dernier

        if (error) {
            console.error('Erreur Supabase:', error.message);
            return res.status(500).json({ success: false, message: 'Erreur de récupération des données' });
        }

        if (!lastRefVoyage || lastRefVoyage.length === 0) {
            // Aucune refVoyage trouvée pour cette gare et cette lettre → Premier départ
            numDepart = '01';
        } else {
            const refVoyage = lastRefVoyage[0].refvoyage;
            const dernierNumDepart = parseInt(refVoyage.split('-')[2], 10) || 0; // Extraire numDepart
            numDepart = (dernierNumDepart + 1).toString().padStart(2, '0'); // Format sur 2 chiffres
        }

        // Construction de la refVoyage
        const refVoyage = `${codeDepartement}-${dateFormatJour}-${numDepart}-${firstLetter}`;

        // Retour de la référence générée
        return res.status(201).json({ success: true, refVoyage });

    } catch (error) {
        console.error('Erreur lors de la génération de refVoyage:', error.message);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
    }
});
//******************************************************************//

// 3- Renvoyer matricule Car et nbre de places
router.get('/listeCars', async (req, res) => {
    try {
        // Récupération des voitures avec leurs types
        const { data: cars, error: errorCars } = await supabase
            .from('cars')
            .select(`
                matcar,
                types_cars (
                    libelletypecar,
                    nbreplaces
                )
            `)
            .order('matcar', { ascending: true });

        // Vérification des erreurs
        if (errorCars) {
            console.error('Erreur Supabase:', errorCars);
            return res.status(500).json({ success: false, message: 'Erreur de récupération des données' });
        }

        // Transformation des données pour correspondre au format voulu
        const listeCars = cars.map(car => ({
            matcar: car.matcar,
            typecar: car.types_cars ? car.types_cars.libelletypecar : null,
            nbreplaces: car.types_cars ? car.types_cars.nbreplaces : null
        }));

        // Retourner la liste des voitures
        return res.status(200).json({ success: true, cars: listeCars });

    } catch (error) {
        console.error('Erreur interne du serveur:', error.message);
        return res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
    }
});
//******************************************************************//

// 4- Liste des conducteurs

router.get('/listeConducteurs', async (req, res) => {
    try {
        // Récupération des conducteurs triés par nom
        const { data: conducteurs, error } = await supabase
            .from('conducteurs')
            .select('matconducteur, nomconducteur, prenomsconducteur')
            .order('nomconducteur', { ascending: true });

        // Vérification des erreurs
        if (error) {
            console.error('Erreur Supabase:', error.message);
            return res.status(500).json({ success: false, message: 'Erreur de récupération des données' });
        }

        // Transformation des données
        const listeConducteurs = conducteurs.map(conducteur => ({
            matConducteur: conducteur.matconducteur,
            nomConducteur: `${conducteur.nomconducteur} ${conducteur.prenomsconducteur}`
        }));

        // Retourner la liste des conducteurs
        return res.status(200).json({ success: true, conducteurs: listeConducteurs });

    } catch (error) {
        console.error('Erreur interne du serveur:', error.message);
        return res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
    }
});
//******************************************************************//


// 5- Enregistrer les paramètres du voyage
router.post('/params-refVoyage', async (req, res) => {
    const {
        refVoyage,
        idTypesRefVoyage,
        idDepartement,
        matCar,
        nbrePlaces,
        matConducteur,
        nomConducteur,
        typeCar,
        dateReservation = null,
        heureReservation = null,
        visibleAuxClients = false,
    } = req.body;

    try {
        // Vérifier si la refVoyage existe déjà
        const { data: verifRefVoyage, error: errorVerif } = await supabase
            .from('ref_voyages')
            .select('refvoyage')
            .eq('refvoyage', refVoyage)
            .maybeSingle();

        if (verifRefVoyage) {
            return res.status(400).json({ success: false, message: "Cette refVoyage a déjà été enregistrée !" });
        }

        // Vérification d'erreur Supabase
        if (errorVerif && errorVerif.code !== 'PGRST116') {
            console.error('Erreur lors de la vérification:', errorVerif.message);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }

        // Insérer les données
        const { data: paramsVoyage, error: errorInsert } = await supabase
            .from('ref_voyages')
            .insert([
                {
                    refvoyage: refVoyage,
                    idtypesrefvoyage: idTypesRefVoyage,
                    iddepartement: idDepartement,
                    matcar: matCar,
                    nbreplaces: nbrePlaces,
                    matconducteur: matConducteur,
                    nomconducteur: nomConducteur,
                    typecar: typeCar,
                    datereservation: dateReservation,
                    heurereservation: heureReservation,
                    visibleauxclients : visibleAuxClients,
                }
            ])
            .select()
            .maybeSingle();

        // Vérification d'erreur d'insertion
        if (errorInsert) {
            console.error("Erreur lors de l'insertion:", errorInsert.message);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }

        const datas = {
            paramsVoyage,
            typeCar,
        }

        // Retourner la réponse
        return res.status(201).json({
            success: true,
            message: 'Enregistré avec succès !',
            data: datas,
        });

    } catch (error) {
        console.error("Erreur interne du serveur:", error.message);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
    }
});

//******************************************************************//

// 6- Récupérer les paramètres du voyage enregistrés
router.get('/paramsVoyage/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params

    try {
        const { data: paramsVoyage, error: errorParams } = await supabase
            .from('ref_voyages')
            .select('*')
            .eq('refvoyage', refVoyage)
            .maybeSingle()

        if (!paramsVoyage | errorParams) {
            return res.status(400).json({ success: false, message: "La refVoyage indiquée est incorrecte !" })
        }

        // Retourner les valeurs
        return res.status(200).json({ success: true, data: paramsVoyage })
    } catch (error) {
        console.error("Erreur lors de la récupéraation", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur" })
    }
})
//*******************************************************//


// 7- Créer un/des ticket(s) : modèle 1
router.post('/enrgTicket-modele1', async (req, res) => {
    const {
        p_refvoyage,
        p_tabnumsiege = [],
        p_codegare,
        p_destination,
        p_prixticket,
        p_contactclient,
        p_codeclient,
        p_matguichetiere,
        p_nbreplacescar,
        p_matcar,
        p_typeticket,
        p_clientbagage
    } = req.body;

    // Vérifier que `tabnumsiege` est un tableau et contient des éléments
    if (!Array.isArray(p_tabnumsiege) || p_tabnumsiege.length === 0) {
        return res.status(400).json({ success: false, message: "Aucun numsiege sélectionné !" });
    }

    // Vérifier que chaque numéro de siège a exactement 2 caractères
    if (!p_tabnumsiege.every(siege => typeof siege === 'string' && siege.length === 2)) {
        return res.status(400).json({ success: false, message: "Chaque numéro de siège doit avoir exactement 2 caractères !" });
    }

    // Appel de la fonction RPC sur Supabase
    const { data: tickets, error: errorTickets } = await supabase.rpc('enregistrer_tickets_mod1', {
        p_refvoyage,
        p_tabnumsiege,
        p_codegare,
        p_destination,
        p_prixticket,
        p_contactclient,
        p_codeclient,
        p_matguichetiere,
        p_nbreplacescar,
        p_matcar,
        p_typeticket,
        p_clientbagage
    });

    if (errorTickets) {
        console.error("Erreur RPC :", errorTickets);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }

    return res.status(201).json(tickets);
});
//* *************************************************** *//


// 8- Créer un/des ticket(s) : modèle 2
router.post('/enrgTicket-modele2', async (req, res) => {
    const {
        p_refvoyage,
        p_codegare,
        p_destination,
        p_prixticket,
        p_contactclient,
        p_codeclient,
        p_matguichetiere,
        p_nbreplacescar,
        p_matcar,
        p_typeticket,
        p_nbretickets = 1,
        p_clientbagage = true,
    } = req.body;

    try {
        // Appel de la fonction RPC
        const { data: tickets, error: errorTickets } = await supabase
            .rpc('enregistrer_tickets_mod3', {
                jsonb_param: {
                    p_refvoyage: p_refvoyage,
                    p_codegare: p_codegare,
                    p_destination: p_destination,
                    p_prixticket: p_prixticket,
                    p_contactclient: p_contactclient,
                    p_codeclient: p_codeclient,
                    p_matguichetiere: p_matguichetiere,
                    p_nbreplacescar: p_nbreplacescar,
                    p_matcar: p_matcar,
                    p_typeticket: p_typeticket,
                    p_nbretickets: p_nbretickets,
                    p_clientbagage: p_clientbagage
                }
            });

        if (errorTickets) {
            console.error("Erreur RPC :", errorTickets);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        return res.status(201).json(tickets);
    } catch (error) {
        console.error("Erreur lors de l'enregistrement des tickets :", error);
        return res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
        });
    }
});

//*********************************************************************//


// 9- Rechercher ticket(s) perdu(s) d'un client
router.get('/reqTicket/:contactClient', async (req, res) => {
    const { contactClient } = req.params

    try {

        // Date du jour à minuit (début de la journée)
        const aujourdhui = new Date(new Date().setHours(0, 0, 0, 0));

        const { data: ticketsClient, error: errorTicketClient } = await supabase
            .from('tickets')
            .select(`
                id, refvoyage, numsiege, destination, typeticket, prixticket, contactclient, codeclient,
                dateticket, matguichetiere, ticketconsommer, clientbagage,
                gares ( nomgare ),
                users ( nomuser, prenomsuser ),
                ref_voyages ( matcar )`)
            .eq('contactclient', contactClient)
            .gte('dateticket', aujourdhui.toISOString())
            .order('dateticket', { ascending: false })
        // .or(`dateticket.gte.${aujourdhui.toISOString()}, ticketconsommer.eq.false`);

        if (errorTicketClient) {
            console.error("Erreur récupération tickets :", errorTicketClient);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!ticketsClient) {
            return res.status(404).json({ success: false, message: "Contact non trouvé !" })
        }

        const listeTickets = ticketsClient.map(item => ({
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

        return res.status(200).json({ success: true, listeTickets: listeTickets })
    } catch (error) {
        console.error('Impossible de récupérer les données.', error)
        res.status(500).json({ success: false, message: "Erreur interne du serveru !" })
    }
})
//*****************************************************************//


// 10-Montant des tickets vendus pour une gare
router.get('/resumerTickets/:codeGare', async (req, res) => {
    const { codeGare } = req.params;

    try {
        const today = new Date(new Date().setHours(0, 0, 0, 0)); // Date du jour

        // Requête Supabase
        const { data: ticketsClient, error: ticketsError } = await supabase
            .from('tickets')
            .select(`
                refvoyage,
                typeticket,
                prixticket,
                clientbagage,
                ref_voyages (
                    refvoyage,
                    matcar,
                    matconducteur,
                    nomconducteur,
                    carremplacement,
                    conducteurremplacement,
                    nbreplaces,
                    disponible,
                    datereservation,
                    heurereservation,
                    types_ref_voyages (
                        libelletypevoyage
                    )
                )`)
            .eq('codegare', codeGare)
            .gte('dateticket', today.toISOString()); // Tickets du jour

        if (ticketsError) {
            console.error("Erreur Supabase :", ticketsError);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!ticketsClient || ticketsClient.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun ticket trouvé pour cette gare !" });
        }

        // Regrouper et calculer les résultats par refVoyage
        const groupedByRefVoyage = ticketsClient.reduce((acc, ticket) => {
            const refVoyage = ticket.ref_voyages.refvoyage;

            if (!acc[refVoyage]) {
                acc[refVoyage] = {
                    refVoyage: refVoyage,
                    typeVoyage: ticket.ref_voyages.types_ref_voyages.libelletypevoyage,
                    disponible: ticket.ref_voyages.disponible,
                    matCar: ticket.ref_voyages.matcar,
                    nbrePlaces: ticket.ref_voyages.nbreplaces,
                    matConducteur: ticket.ref_voyages.matconducteur,
                    nomConducteur: ticket.ref_voyages.nomconducteur,
                    carRemplacement: ticket.ref_voyages.carremplacement,
                    conducteurRemplacement: ticket.ref_voyages.conducteurremplacement,
                    dateReservation: ticket.ref_voyages.datereservation,
                    heureReservation: ticket.ref_voyages.heurereservation,
                    nbreTicketsVendus: 0,
                    nbrePayants: 0,
                    nbreGratuits: 0,
                    montTickets: 0,
                    montGratuits: 0,
                    sansBagages: 0,
                    placesRestantes: 0
                };
            }

            acc[refVoyage].nbreTicketsVendus++;
            if (!ticket.clientbagage) {
                acc[refVoyage].sansBagages++;
            }
            if (ticket.typeticket === "PAYANT") {
                acc[refVoyage].nbrePayants++;
                acc[refVoyage].montTickets += ticket.prixticket;
            } else {
                acc[refVoyage].nbreGratuits++;
                acc[refVoyage].montGratuits += ticket.prixticket;
            }
            acc[refVoyage].placesRestantes = ticket.ref_voyages.nbreplaces - acc[refVoyage].nbreTicketsVendus;

            return acc;
        }, {});

        // Trier par disponibilité (disponible = true doit être en premier)
        const sortedResume = Object.values(groupedByRefVoyage)
            .sort((a, b) => {
                return b.disponible - a.disponible;
            });

        return res.status(200).json({
            success: true,
            resumer: sortedResume,
        });

    } catch (error) {
        console.error('Impossible de récupérer des données !', error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//*******************************************************************************//


// 11- Liste des refVoyages "disponibles"
router.get('/refVoyages-true/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params;

    try {
        const today = new Date(new Date().setHours(0, 0, 0, 0)); // Date du jour

        // Requête Supabase pour récupérer les ref_voyages et le nombre de tickets associés
        const { data: refVoyages, error: refVoyagesError } = await supabase
            .from('ref_voyages')
            .select(`
                refvoyage,
                matcar,
                matconducteur,
                nbreplaces,
                nomconducteur,
                datereservation,
                heurereservation,
                tickets (
                    refvoyage
                )`)
            .eq('iddepartement', idDepartement)
            .eq('disponible', true)
            .gte('daterefvoyage', today.toISOString()) // Tickets du jour
            .order('refvoyage', { ascending: false });

        if (refVoyagesError) {
            console.error("Erreur lors de la récupération des données :", refVoyagesError);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!refVoyages || refVoyages.length === 0) {
            return res.status(400).json({ success: false, message: "Le département indiqué est incorrect ou aucun voyage disponible." });
        }

        // Récupérer les données et ajouter les calculs nécessaires
        const tabRefVoyages = refVoyages.map(refVoyage => {
            const nbreTicketsVendus = refVoyage.tickets.length;
            const placesRestantes = refVoyage.nbreplaces - nbreTicketsVendus;

            return {
                refvoyage: refVoyage.refvoyage,
                matcar: refVoyage.matcar,
                matconducteur: refVoyage.matconducteur,
                nbreplaces: refVoyage.nbreplaces,
                nomconducteur: refVoyage.nomconducteur,
                nbreticketsvendus: nbreTicketsVendus,
                placesrestantes: placesRestantes,
                datereservation: refVoyage.datereservation,
                heurereservation: refVoyage.heurereservation,
            };
        });

        return res.status(200).json({
            success: true,
            datas: tabRefVoyages,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//****************************************************************************//

// 12- Liste des tickets achetés d'un voyage (refVoyage)
router.get('/listeTickets/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params

    try {
        const { data: listTickets, error: errorListe } = await supabase
            .from('tickets')
            .select(`
                id, numsiege, typeticket, codeclient, contactclient, destination, prixticket, clientbagage, dateticket, refvoyageremplacement, siegevacant,
                gares (nomgare)
            `)
            .eq('refvoyage', refVoyage)
            .order('numsiege', { ascending: false })

        if (errorListe) {
            console.error("Erreur lors de la récupération des tickets : ", errorListe);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!listTickets) {
            return res.status(404).json({ success: false, message: "Vérifier le paramètre saisi" })
        }

        let isRemplaced = false
        if (listTickets.refvoyageremplacement !== null) {
            isRemplaced = true
        }

        const tickets = listTickets.map(item => ({
            id: item.id,
            numsiege: item.numsiege,
            typeticket: item.typeticket,
            codeclient: item.codeclient,
            contactclient: item.contactclient,
            destination: item.destination,
            prixticket: item.prixticket,
            clientbagage: item.clientbagage,
            dateticket: item.dateticket,
            nomgare: item.gares.nomgare,
            isremplaced: isRemplaced,
            siegevacant: item.siegevacant,
        }))

        return res.status(200).json({
            success: true,
            listeTickets: tickets
        })

    } catch (error) {
        console.error("ERREUR : Impossible de récuperer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})
//******************************************************************************//


// 13- Nbre de passagers par destination
router.get('/nbre-passagers-destination/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params;

    try {
        // Récupération des tickets avec les relations nécessaires
        const { data: tickets, error: errorTickets } = await supabase
            .from('tickets')
            .select(`*,
            ref_voyages (*, 
                types_ref_voyages (*)
            )
        `)
            .eq('refvoyage', refVoyage)
            .order('destination', { ascending: true });

        if (errorTickets) {
            console.error("ERREUR : impossible de récupérer les données. ", errorTickets);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!tickets || tickets.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun ticket trouvé !" });
        }

        // Regrouper par destination
        const parDestination = tickets.reduce((acc, ticket) => {
            const { destination } = ticket;
            const typevoyage = ticket.ref_voyages?.types_ref_voyages?.libelletypevoyage;

            if (!acc[destination]) {
                acc[destination] = {
                    refvoyage: refVoyage,
                    typevoyage: typevoyage,
                    destination: destination,
                    nbrepassagers: 0,
                    clientbagages: 0,
                };
            }

            acc[destination].nbrepassagers++;
            if (ticket.clientbagage === true) {
                acc[destination].clientbagages++;
            }

            return acc;
        }, {});

        // Convertir en tableau d'objets JSON
        const tableauDestinations = Object.values(parDestination);

        return res.status(200).json({
            success: true,
            resumer: tableauDestinations,
        });

    } catch (error) {
        console.error("ERREUR : Impossible de récupérer les données !", error);
        res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//*****************************************************************************//


// 14- Liste et nbre de passagers "sansBagages" par refvoyage "disponible"
router.get('/clients-sans-bagages/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params

    try {
        const { data: passagersSansBagages, error: errorPassagers } = await supabase
            .from('tickets')
            .select(`
            refvoyage,
            numsiege,
            contactclient,
            clientbagage,
            ref_voyages (
                matcar
            )
        `)
            .eq('clientbagage', false)
            .gte('dateticket', new Date().toISOString().split('T')[0]) // Aujourd'hui
            .lt('dateticket', new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().split('T')[0]) // Avant demain
            .eq('ref_voyages.disponible', true)
            .gte('ref_voyages.daterefvoyage', new Date().toISOString().split('T')[0]) // refVoyage >= aujourd’hui
            .lt('ref_voyages.daterefroyage', new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().split('T')[0]) // refVoyage < demain
            .eq('ref_voyages.iddepartement', idDepartement)
            .order('refvoyage', { ascending: true });

        if (errorPassagers) {
            console.error("ERREUR : Impossible de récupérer les données !", errorPassagers);
            res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!passagersSansBagages) {
            return res.status(404).json({ success: false, message: "Aucun résultat !" })
        }

        // Étape 2 : Transformation des données
        const organiserDatas = passagersSansBagages.reduce((acc, row) => {
            const { refvoyage, matcar, numsiege, contactclient, clientbagage, nbrepassagers } = row;

            // Trouver ou créer un objet pour ce refVoyage
            let voyage = acc.find((v) => v.refVoyage === refvoyage && v.matCar === matcar,);

            if (!voyage) {
                voyage = {
                    refvoyage,
                    matcar,
                    nbrepassagers,
                    clients: [],
                };
                acc.push(voyage);
            }

            // Ajouter le client à la liste des clients de ce refVoyage
            voyage.clients.push({
                numsiege,
                contactclient,
                clientbagage,
            });

            // Nbre de passagers
            voyage.nbrepassagers = voyage.clients.length

            return acc;
        }, []);

        // Étape 3 : Réponse
        res.status(200).json({ success: true, data: organiserDatas });

    } catch (error) {
        console.error("ERREUR : Impossible de récuperer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})
//**************************************************************************//


// 15- liste des clients sansBagages
router.get('/sans-bagages/:refVoyage/:codeGare', async (req, res) => {
    const { refVoyage, codeGare } = req.params

    try {
        const { data: sansBagages, error: errorSansBagage } = await supabase
            .from('tickets')
            .select(`*, gares (*)`)
            .eq('refvoyage', refVoyage)
            .eq('codegare', codeGare)
            .eq('clientbagage', false)
        if (errorSansBagage) {
            console.error("ERREUR : Impossible de récuperer les données !", errorSansBagage)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }

        if (!sansBagages | sansBagages.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun passager sans bagages trouvé !" })
        }

        const noBagages = sansBagages.map(item => ({
            refvoyage: item.refvoyage,
            numsiege: item.numsiege,
            nomgare: item.gares.nomgare,
            destination: item.destination,
            prixticket: item.prixticket,
            typeticket: item.typeticket,
            ticketutiliser: item.ticketconsommer,
            codeclient: item.codeclient,
            contactclient: item.contactclient,
            clientbagage: item.clientbagage,
            dateticket: item.dateticket
        }))

        let nbre = 0
        if (sansBagages) {
            nbre = sansBagages.length
        }

        return res.status(200).json({
            success: true,
            nbrepassagers: nbre,
            sansbagages: noBagages
        })

    } catch (error) {
        console.error("ERREUR : Impossible de récuperer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})
//***********************************************************************//

// 16-Montant des tickets vendus pour une gare
router.get('/resumer-tickets-refVoyage/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params;

    try {
        const { data: listeTickets, error: errorListe } = await supabase
            .from('tickets')
            .select(`*, ref_voyages (*, types_ref_voyages (*))`)
            .eq('refvoyage', refVoyage)

        if (errorListe) {
            console.error('Impossible de récupérer des données !', errorListe);
            res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!listeTickets | listeTickets.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun ticket trouvé !" });
        }

        const groupedByRefVoyage = listeTickets.reduce((acc, ticket) => {
            const refVoyage = ticket.ref_voyages.refvoyage;

            if (!acc[refVoyage]) {
                acc[refVoyage] = {
                    refvoyage: refVoyage,
                    typevoyage: ticket.ref_voyages.types_ref_voyages.libelletypevoyage,
                    disponible: ticket.ref_voyages.disponible,
                    matcar: ticket.ref_voyages.matcar,
                    nbreplaces: ticket.ref_voyages.nbreplaces,
                    matconducteur: ticket.ref_voyages.matconducteur,
                    nomconducteur: ticket.ref_voyages.nomconducteur,
                    carremplacement: ticket.ref_voyages.carremplacement,
                    conducteurremplacement: ticket.ref_voyages.conducteurremplacement,
                    datereservation: ticket.ref_voyages.datereservation,
                    heurereservation: ticket.ref_voyages.heurereservation,
                    nbreticketsvendus: 0, //nbrePassagers
                    nbrepayants: 0,
                    nbregratuits: 0,
                    monttickets: 0,
                    montgratuits: 0,
                    sansbagages: 0,
                    placesrestantes: 0
                };
            }

            acc[refVoyage].nbreticketsvendus++;
            if (!ticket.clientbagage) {
                acc[refVoyage].sansbagages++;
            }
            if (ticket.typeticket === "PAYANT") {
                acc[refVoyage].nbrepayants++;
                acc[refVoyage].monttickets += ticket.prixticket;
            } else {
                acc[refVoyage].nbregratuits++;
                acc[refVoyage].montgratuits += ticket.prixticket;
            }
            acc[refVoyage].placesrestantes = ticket.ref_voyages.nbreplaces - acc[refVoyage].nbreticketsvendus

            return acc;
        }, {});

        // Trier les résultats : ref_voyages disponibles (true) d'abord
        const sortedResume = Object.values(groupedByRefVoyage)
            .sort((a, b) => {
                // true (1) doit apparaître avant false (0)
                return b.disponible - a.disponible;
            });

        return res.status(200).json({
            success: true,
            resumer: sortedResume,
        });
    } catch (error) {
        console.error('Impossible de récupérer des données !', error);
        res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//*******************************************************************************//


// Enregistrer un ticket de remplacement (supplémentaire) :
// API : enregistrer les tickets supplementaires
router.post('/enregistrer-tickets-vacants', async (req, res) => {
    const {
        refVoyage,
        codeGare,
        destination,
        typeTicket,
        prixTicket,
        tabNumSieges,
        contactClient,
        codeClient,
        idDepartement,
        matGuichetiere
    } = req.body;

    try {
        // Vérification de l'existence du voyage
        const [
            { data: verifVoyage, error: errorVerif },
            { data: verifRempplacement, error: errorRemplacement },
        ] = await Promise.allSettled([
            supabase 
                .from('ref_voyages')
                .select('*')
                .eq('refvoyage', refVoyage)
                .eq('disponible', false)
                .eq('enrgaucontrole', false)
                .eq('enrgalacaisse', false),
            supabase 
                .from('tickets')
                .select('*')
                .in('numsiege', tabNumSieges)
                .eq('refvoyage', refVoyage)
                .eq('siegevacant', true)
        ])
        if (errorVerif, errorRemplacement) {
            console.error("Erreur lors de la récupération des données : ", { errorVerif, errorRemplacement } );
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!verifVoyage || verifVoyage.length === 0) {
            return res.status(404).json({ success: false, message: "Voyage non trouvé ou indisponible." });
        }
        if (!verifRempplacement || verifRempplacement.length === 0) {
            return res.status(404).json({ success: false, message: "Les passagers sélectionnés sont non absents, ou tickets non trouvés." });
        }

        // Construction des tickets en une seule requête avec reduce
        const ticketsData = tabNumSieges.reduce((acc, numSiege) => {
            acc.push({
                refvoyage: refVoyage,
                codegare: codeGare,
                destination: destination,
                typeticket: typeTicket,
                prixticket: prixTicket,
                numsiege: numSiege,
                contactclient: contactClient,
                codeclient: codeClient,
                iddepartement: idDepartement,
                matguichetiere: matGuichetiere,
            });
            return acc;
        }, []);

        // Exécution d'une seule requête d'insertion
        const { data: tickets, error: errorTickets } = await supabase
            .from('sieges_supplementaires')
            .insert(ticketsData)
            .select();

        if (errorTickets) {
            console.error("Erreur lors de l'enregistrement des tickets : ", errorTickets);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!tickets || tickets.length === 0) {
            return res.status(400).json({ success: false, message: "Aucun ticket enregistré." });
        }

        return res.status(201).json({
            success: true,
            message: 'Ticket(s) enregistré(s) avec succès !',
            tickets: tickets,
        });

    } catch (error) {
        console.error("Erreur lors de l'enregistrement : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


module.exports = router;
