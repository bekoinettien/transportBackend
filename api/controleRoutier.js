const express = require('express');
const supabase = require('./../supabase')
require('node-fetch').fetch;

const router = express.Router();


// API : Voyages en cours (non disponibles)
router.get('/voyages-en-cours-de-route/:idPosteControle', async (req, res) => {
    const { idPosteControle } = req.params
    try {
        // Rechercher les departements du poste de controle
        const apiUrl = process.env.API_URL_DESTINATIONS
        response = await fetch(`${apiUrl}/liste-departements-dun-poste-controle/${idPosteControle}`);
        const result = await response.json();

        // Rechercher les ref_voyages en cours des departements du poste de controle 
        const { data: listeRef, error: errorRef } = await supabase
            .from('ref_voyages')
            .select('refvoyage')
            .in('iddepartement', result.departements.map(item => item.id))
            .eq('disponible', false)
            .eq('enrgaucontrole', false) // N'est pas encore enregistré au controle
        if (errorRef) {
            console.error("Erreur lors de la récupération des données : ", errorRef)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }
        if (!listeRef || listeRef.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage en cours." })
        }

        // Lister les voyages en cours du jour de ces departements
        const { data: voyages, error: errorVoyages } = await supabase
            .from('voyages')
            .select('*, ref_voyages (matcar, nbreplaces, carremplacement, nbreplaces_remplacement, nomconducteur, conducteurremplacement, disponible, iddepartement, matconducteur)')
            .in('refvoyage', listeRef.map(ref => ref.refvoyage))
        if (errorVoyages) {
            console.error("Erreur lors de la récupération des données : ", errorVoyages)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }
        if (!voyages || voyages.length === 0) {
            return res.status(404).json({ success: false, message: "Auncu voyage en cours." })
        }

        // Formater l'affichage
        const listeVoyages = voyages.map(item => ({
            refvoyage: item.refvoyage,
            montantpayants: item.montantpayants,
            montantgratuits: item.montantgratuits,
            montantcolis: item.montantcolis,
            montantbagages: item.montantbagages,
            nbrepersonnes: item.nbrepersonnes,
            nbreticketspayant: item.nbreticketspayant,
            nbreticketsgratuit: item.nbreticketsgratuit,
            nbrepersonnel: item.nbrepersonnel,
            nbrecolis: item.nbrecolis,
            nbrebagages: item.nbrebagages,
            nbreplaces: (item.ref_voyages?.carremplacement) ? (item.ref_voyages?.nbreplaces_remplacement) : item.ref_voyages?.nbreplaces,
            placesrestantes: ((item.ref_voyages?.carremplacement) ? (item.ref_voyages?.nbreplaces_remplacement) : item.ref_voyages?.nbreplaces) - item.nbrepersonnes,
            datevoyage: item.datevoyage,
            disponible: item.ref_voyages?.disponible,
            iddepartement: item.ref_voyages?.iddepartement,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            matconducteur: item.ref_voyages?.matconducteurremplacement || item.ref_voyages?.matconducteur,
            matchefdegare: item.matchefdegare,
        }))

        return res.status(200).json({
            success: true,
            voyages: listeVoyages,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})
//++++++++++++++++++++++++++++++++++++++++++++++


// API : Recap du voyage à valider au controle
router.get('/recap-voyage-controle', async (req, res) => {
    const { refVoyage, idPosteControle } = req.query;

    try {
        // Récupération des données en parallèle
        const [
            { data: voyages, error: errorVoyages },
            { data: supplementaires, error: errorSup },
            { data: verifVoyage, error: errorVerif }
        ] = await Promise.all([
            supabase
                .from('voyages')
                .select('*, ref_voyages (matcar, nbreplaces, carremplacement, nbreplaces_remplacement, nomconducteur, conducteurremplacement, disponible, iddepartement)')
                .eq('refvoyage', refVoyage),
            supabase
                .from('sieges_supplementaires')
                .select('id, prixticket, typeticket')
                .eq('idpostecontrole', idPosteControle)
                .eq('refvoyage', refVoyage),
            supabase
                .from('ref_voyages')
                .select('*')
                .eq('refvoyage', refVoyage)
                .eq('disponible', false)
                .eq('enrgaucontrole', false)
        ]);

        // Gestion des erreurs Supabase
        if (errorVoyages || errorSup || errorVerif) {
            console.error("Erreur lors de la récupération des données : ", { errorVoyages, errorSup, errorVerif });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        // Vérification si les données sont valides
        if (
            (!verifVoyage || verifVoyage.length === 0) ||
            (!voyages || voyages.length === 0) &&
            (!supplementaires || supplementaires.length === 0)
        ) {
            return res.status(404).json({ success: false, message: "Détails non disponibles." });
        }

        // Calculs avec reduce()
        const { nbreSupp_tot, nbreSupp_payant, nbreSupp_gratuit, montSupp_payant, montSupp_gratuit } = supplementaires.reduce((acc, { prixtransport, typeticket }) => {
            acc.nbreSupp_tot++;

            if (['PAYANT', 'payant', 'Payant'].includes(typeticket)) {
                acc.nbreSupp_payant++;
                acc.montSupp_payant += prixtransport;
            } else {
                acc.nbreSupp_gratuit++;
                acc.montSupp_gratuit += prixtransport;
            }

            return acc;
        }, { nbreSupp_tot: 0, nbreSupp_payant: 0, nbreSupp_gratuit: 0, montSupp_payant: 0, montSupp_gratuit: 0 });

        // Vérifier que voyage existe avant d’y accéder
        const voyage = voyages[0];
        if (!voyage) {
            return res.status(404).json({ success: false, message: "Détails du voyage introuvables." });
        }

        // Formatage de la réponse
        const recapVoyage = {
            refvoyage: voyage.refvoyage,
            iddepartement: verifVoyage.iddepartement,
            montantpayants: voyage.montantpayants + montSupp_payant,
            montantgratuits: voyage.montantgratuits + montSupp_gratuit,
            montantcolis: voyage.montantcolis,
            montantbagages: voyage.montantbagages,
            nbrepersonnes: voyage.nbrepersonnes + nbreSupp_tot,
            nbreticketspayant: voyage.nbreticketspayant + nbreSupp_payant,
            nbreticketsgratuit: voyage.nbreticketsgratuit + nbreSupp_gratuit,
            nbrepersonnel: voyage.nbrepersonnel,
            nbrecolis: voyage.nbrecolis,
            nbrebagages: voyage.nbrebagages,
            datevoyage: voyage.datevoyage,
            disponible: voyage.disponible,
            iddepartement: voyage.iddepartement,
            matcar: voyage.ref_voyages?.carremplacement || voyage.ref_voyages?.matcar,
            nomconducteur: voyage.ref_voyages?.conducteurremplacement || voyage.ref_voyages?.nomconducteur,
            matchefdegare: voyage.matchefdegare
        };
        
        return res.status(200).json({ success: true, data: recapVoyage });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// API : Enregistrer voyages des clients fideles
router.post('/enregistrer-voyages-clients', async (req, res) => {
    const { refVoyage, tabClients } = req.body;

    if (!tabClients || tabClients.length === 0) {
        return res.status(400).json({ success: false, message: "Aucun client à enregistrer." });
    }
    if (!refVoyage) {
        return res.status(400).json({ success: false, message: "Références manquantes." });
    }

    try {
        // Vérifier l'existence du voyage
        const { data: verifVoyage, error: errorVerif } = await supabase
            .from('ref_voyages')
            .select('refvoyage')
            .eq('refvoyage', refVoyage)
            .eq('disponible', false)
            .eq('enrgaucontrole', false)
            .eq('enrgalacaisse', false)
            .maybeSingle();

        if (errorVerif) {
            console.error("Erreur lors de la récupération du voyage : ", errorVerif);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!verifVoyage) {
            return res.status(404).json({ success: false, message: "Voyage non trouvé ou indisponible." });
        }

        // Construire les enregistrements
        const clients = tabClients.map(client => ({
            refvoyage: refVoyage,
            idpostecontrole: client.idPosteControle,
            gare: client.gare,
            destination: client.destination,
            codeclient: client.codeClient,
            matcontroleur: client.matControleur,
            matcar: client.matCar,
            numsiege: client.numSiege
        }));

        // Insertion en une seule requête
        const { data: voyagesClients, error: errorInsert } = await supabase
            .from('voyages_clients')
            .insert(clients)
            .select();

        if (errorInsert) {
            console.error("Erreur lors de l'enregistrement des voyages : ", errorInsert);
            if (errorInsert.message.includes("duplicate key value violates unique constraint")) {
                return res.status(400).json({ success: false, message: "Un client a son voyage déjà enregistré dans votre sélection." });
            }
            if (errorInsert.message.includes('insert or update on table "voyages_clients" violates foreign key constraint "fk_codeclient"')) {
                return res.status(400).json({ success: false, message: "Passager(s) choisi(s) ne sont pas 'client fidèle'." });
            }
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        return res.status(201).json({
            success: true,
            message: `${voyagesClients.length} clients enregistrés avec succès !`,
            clients: voyagesClients,
        });

    } catch (error) {
        console.error("Erreur lors de l'enregistrement : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})


// API : Valider le voyage au contrôle
router.post('/valider-voyage-controle', async (req, res) => {
    const {
        refVoyage,
        montantPayants,
        montantGratuits,
        montantColis,
        montantBagages,
        nbrePersonnes,
        nbrePassagersPayant,
        nbrePassagersGratuit,
        nbrePersonnels,
        nbreColis,
        nbreBagages,
        idDepartement,
        idPosteControle,
        matCar,
        nomConducteur,
        matConducteur,
        matControleur,
    } = req.body;

    try {
        // Exécuter toutes les requêtes en parallèle
        const results = await Promise.allSettled([
            supabase.from('ref_voyages')
                .select('*')
                .eq('refvoyage', refVoyage)
                .eq('disponible', false)
                .eq('enrgaucontrole', false)
                .eq('enrgalacaisse', false)
                .maybeSingle(),
            supabase.from('voyages').select('matchefdegare').eq('refvoyage', refVoyage).maybeSingle(),
            supabase.from('bagages').select('matbagagiste').eq('refvoyage', refVoyage).maybeSingle(),
            supabase.from('colis').select('matgestionnairecolis').eq('refvoyage', refVoyage).maybeSingle(),
            supabase.from('tickets').select('matguichetiere, matcontroleurticket').eq('refvoyage', refVoyage),
        ]);

        // Extraction des résultats
        const [verifVoyage, chefGare, bagagiste, gestColis, guichetieres] = results.map(r => r.status === 'fulfilled' ? r.value.data : null);
        const [errorVerif, errorChefGare, errorBagagiste, errorGestColis, errorGuichetiere] = results.map(r => r.status === 'rejected' ? r.reason : null);

        // Vérification des erreurs
        if (errorVerif || errorChefGare || errorBagagiste || errorGestColis || errorGuichetiere) {
            console.error("Erreur lors de la récupération des données : ", { errorVerif, errorChefGare, errorBagagiste, errorGestColis, errorGuichetiere });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        // Vérifier si le voyage existe
        if (!verifVoyage) {
            return res.status(404).json({ success: false, message: "Voyage non trouvé ou indisponible." });
        }

        // Extraction des personnels
        const matGuichetiere = guichetieres?.find(ticket => ticket.matguichetiere)?.matguichetiere || null;
        const matControleurTicket = guichetieres?.find(ticket => ticket.matcontroleurticket)?.matcontroleurticket || null;

        // Création de l'objet des personnels
        const personnels = {
            matchefdegare: chefGare?.matchefdegare || null,
            matbagagiste: bagagiste?.matbagagiste || null,
            matgestionnairecolis: gestColis?.matgestionnairecolis || null,
            matguichetiere: matGuichetiere,
            matcontroleurticket: matControleurTicket,
        };

        // Insertion du voyage dans `controles_voyages`
        const { data: controleVoyage, error: errorControle } = await supabase
            .from('controles_voyages')
            .insert({
                refvoyage: refVoyage,
                montantpayants: montantPayants,
                montantgratuits: montantGratuits,
                montantcolis: montantColis,
                montantbagages: montantBagages,
                nbrepersonnes: nbrePersonnes,
                nbrepassagerspayant: nbrePassagersPayant,
                nbrepassagersgratuit: nbrePassagersGratuit,
                nbrepersonnels: nbrePersonnels,
                nbrecolis: nbreColis,
                nbrebagages: nbreBagages,
                iddepartement: idDepartement,
                idpostecontrole: idPosteControle,
                matcar: matCar,
                nomconducteur: nomConducteur,
                matconducteur : matConducteur,
                matcontroleur: matControleur,
                ...personnels, // Ajout des personnels directement
            })
            .select()
            .maybeSingle();

        // Gestion des erreurs d'insertion
        if (errorControle) {
            console.error("Erreur lors de l'enregistrement des données : ", errorControle);
            if (errorControle.message.includes("duplicate key value violates unique constraint")) {
                return res.status(400).json({ success: false, message: "Voyage déjà enregistré." });
            }
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!controleVoyage) {
            return res.status(400).json({ success: false, message: "Voyage non enregistré. Veuillez réessayer." });
        }

        // Modifier `ref_voyages` : enrgaucontrole = true
        const { data: updateRef, error: errorUpdateRef } = await supabase
            .from('ref_voyages')
            .update({ enrgaucontrole: true })
            .eq('refvoyage', refVoyage)
            .select()
            .maybeSingle();
        if (errorUpdateRef) {
            console.error("Erreur lors de l'enregistrement des données : ", errorUpdateRef);
            return res.status(500).json({ success: false, message: "Une erreur interne est survenue lors de la mise à jour. Quittez la page avant de revenir." });
        }

        return res.status(201).json({
            success: true,
            message: "Voyage enregistré avec succès !",
            voyage: controleVoyage,
        });

    } catch (error) {
        console.error("Erreur lors de l'enregistrement des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// API : destination pour le controle
router.get('/postes-destinations/:idLigne/:idPosteControle', async (req, res) => {
    const { idLigne, idPosteControle } = req.params

    if (!idLigne || !idPosteControle) {
        return res.status(400).json({ success: false, message: "Références manquantes." })
    }

    try {
        const { data: listeDestinations, error: errorDestinations } = await supabase
            .from('lignes_postes_controles_destinations')
            .select('idpostecontrole, destinations (id, nomdestination)')
            .eq('idligne', idLigne)
            .eq('idpostecontrole', idPosteControle)
        if (errorDestinations) {
            console.error("Erreur lors de la récupération des données : ", errorDestinations)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }
        if (!listeDestinations || listeDestinations.length === 0) {
            return res.status(404).json({ success: false, message: "Aucune destination trouvée." })
        }

        const liste = listeDestinations.map(item => ({
            id: item.destinations?.id,
            nomdestination: item.destinations?.nomdestination,
        }))

        return res.status(200).json({ success: true, destinations: liste })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})


// API : enregistrer les tickets supplementaires
router.post('/enregistrer-tickets-vacants-news', async (req, res) => {
    const {
        refVoyage,
        destination,
        typeTicket,
        prixTicket,
        tabNumSieges,
        contactClient,
        codeClient,
        matControleurRoutier,
        idPosteControle,
    } = req.body;

    try {
        // Vérification de l'existence du voyage
        const { data: verifVoyage, error: errorVerif } = await supabase
            .from('ref_voyages')
            .select('*')
            .eq('refvoyage', refVoyage)
            .eq('disponible', false)
            .eq('enrgaucontrole', false)
            .eq('enrgalacaisse', false);

        if (errorVerif) {
            console.error("Erreur lors de la récupération du voyage : ", errorVerif);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
console.log("voyageA_Controle : ", verifVoyage)
        if (!verifVoyage || verifVoyage.length === 0) {
            return res.status(404).json({ success: false, message: "Voyage non trouvé ou indisponible." });
        }

        // Construction des tickets en une seule requête avec reduce
        const ticketsData = tabNumSieges.reduce((acc, numSiege) => {
            acc.push({
                refvoyage: refVoyage,
                destination: destination,
                typeticket: typeTicket,
                prixticket: prixTicket,
                numsiege: numSiege,
                contactclient: contactClient,
                codeclient: codeClient,
                clientbagage: false,
                ticketconsommer: true,
                matcontroleurroutier: matControleurRoutier,
                idpostecontrole: idPosteControle,
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


// API : Lister les voyages controlés
router.get('/liste-controles-voyages/:idPosteControle', async (req, res) => {
    const { idPosteControle } = req.params
    const { dateRef } = req.query

    if (!dateRef || !idPosteControle) {
        return res.status(400).json({ success: false, message: "Références manquantes." })
    }

    try {
        let dateDebut, dateFin;

        if (dateRef) {
            const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
            const match = dateRef.match(dateRegex);

            if (!match) {
                return res.status(400).json({ success: false, message: "Format de date invalide. Utilisez JJ/MM/AAAA." });
            }

            const [_, jour, mois, annee] = match;
            dateDebut = new Date(Number(annee), Number(mois) - 1, Number(jour), 0, 0, 0);
            dateFin = new Date(Number(annee), Number(mois) - 1, Number(jour), 23, 59, 59);
        } else {
            const today = new Date();
            dateDebut = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
            dateFin = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
        }

        if (isNaN(dateDebut.getTime()) || isNaN(dateFin.getTime())) {
            return res.status(400).json({ success: false, message: "Date invalide. Utilisez JJ/MM/AAAA." });
        }

        const [
            { data: listeVoyages, error: errorListe },
            { data: listeTicketsSupp, error: errorListeTicketsSupp },
            { data: listeVoyClients, error: errorListeVoyClients },
        ] = await Promise.all([
            supabase
                .from('controles_voyages')
                .select('*')
                .eq('idpostecontrole', idPosteControle)
                .gte('datevoyage', dateDebut.toISOString())
                .lte('datevoyage', dateFin.toISOString()),
            supabase 
                .from('sieges_supplementaires')
                .select('*')
                .eq('idpostecontrole', idPosteControle)
                .gte('dateticket', dateDebut.toISOString())
                .lte('dateticket', dateFin.toISOString()),
            supabase 
                .from('voyages_clients')
                .select('*')
                .eq('idpostecontrole', idPosteControle)
                .gte('datevoyage', dateDebut.toISOString())
                .lte('datevoyage', dateFin.toISOString()),
        ])
        if (errorListe || errorListeTicketsSupp || errorListeVoyClients) {
            console.error("Erreur lors de l'enregistrement : ", {errorListe, errorListeTicketsSupp, errorListeVoyClients});
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!listeVoyages || listeVoyages.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage trouvé." });
        }

        return res.status(200).json({ 
            success: true, 
            voyages_controlers: listeVoyages,
            listetickets_supp: listeTicketsSupp,
            voyages_clients: listeVoyClients 
        })


    } catch (error) {
        console.error("Erreur lors de l'enregistrement : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})


// API : Liste des tickets d'un voyage au controle
router.get('/liste-tickets-dun-voyage/:idPosteControle/:refVoyage', async (req, res) => {
    const { idPosteControle, refVoyage } = req.params

    if (!refVoyage || !idPosteControle) {
        return res.status(400).json({ success: false, message: "Références manquantes." })
    }

    try {

        const [
            { data: listeTicketsSupp, error: errorListeTicketsSupp }
        ] = await Promise.all([
            supabase 
                .from('sieges_supplementaires')
                .select('*')
                .eq('idpostecontrole', idPosteControle)
                .eq('refvoyage', refVoyage)
        ])
        if (errorListeTicketsSupp) {
            console.error("Erreur lors de l'enregistrement : ", errorListeTicketsSupp);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!listeTicketsSupp || listeTicketsSupp.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun ticket trouvé." });
        }

        const tickets = listeTicketsSupp.map(item => ({
            id: item.id,
            numsiege: item.numsiege,
            typeticket: item.typeticket,
            codeclient: item.codeclient,
            contactclient: item.contactclient,
            destination: item.destination,
            prixticket: item.prixticket,
            clientbagage: item.clientbagage,
            dateticket: item.dateticket,
            idpostecontrole: item.idpostecontrole,
            siegevacant: item.siegevacant,
        }))

        return res.status(200).json({
            success: true,
            listeTickets: tickets
        })


    } catch (error) {
        console.error("Erreur lors de l'enregistrement : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})

module.exports = router 