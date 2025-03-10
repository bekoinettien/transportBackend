
const express = require('express')
const supabase = require('./../supabase')
const axios = require('axios');


const router = express.Router()



// Modifier un voyage 1 : changer de car et/ou de conducteur
router.put('/modifier-voyage-car-conducteur/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params
    const { matCar, nomConducteur, matConducteur } = req.body 

    try {
        //Rechercher le voyage : matcar et nomconducteur
        const [{ data: trouveRef, error: errorTrouve }, { data: car, error: errorCar } ] = await Promise.all([
            supabase
                .from('ref_voyages')
                .select(`matcar, nomconducteur, disponible, nbreplaces_remplacement, matconducteurremplacement`)
                .eq('refvoyage', refVoyage)
                .maybeSingle(),
            supabase
                .from('cars')
                .select(`matcar, types_cars (nbreplaces)`)
                .eq('matcar', matCar)
                .maybeSingle(),
        ])

        if (errorTrouve || errorCar) {
            console.error("Erreur lors de la récupération des données : ", { errorTrouve, errorCar });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!trouveRef || trouveRef.length === 0) {
            return res.status(404).json({ success: false, message: "Voyage non trouvé." });
        }
        if (!car || car.length === 0) {
            return res.status(404).json({ success: false, message: "car non trouvé." });
        }
        if (trouveRef.disponible === false) {
            return res.status(400).json({ success: false, message: "Le voyage n'est plus disponible." });
        }

        // Passer à la modification
        const { data: modifVoyage, error: errorModif } = await supabase
            .from('ref_voyages')
            .update({
                carremplacement: matCar || trouveRef.matcar,
                conducteurremplacement: nomConducteur || trouveRef.nomconducteur,
                matconducteurremplacement: matConducteur || trouveRef.matconducteurremplacement,
                nbreplaces_remplacement : matCar ? car.types_cars?.nbreplaces : trouveRef.nbreplaces_remplacement,
            })
            .eq('refvoyage', refVoyage)
            .select();

        if (errorModif) {
            console.error("Erreur serveur : ", errorModif);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!modifVoyage || (modifVoyage.matcar === trouveRef.matcar && modifVoyage.nomconducteur === trouveRef.nomconducteur)) {
            return res.status(404).json({ success: false, message: "Modification non effectuée." });
        }

        return res.status(201).json({
            success: true,
            message: "Modification réussie avec succès !",
            modifVoyage,
        })

    } catch (error) {
        console.error("Erreur serveur : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++//

// Modifier voyage : refvoyage des passagers
router.put('/changer-refVoyage-passagers', async (req, res) => {
    const { refVoyage, newRefVoyage, tabNumSieges, remplacerAbsents = true } = req.body;

    if (!Array.isArray(tabNumSieges) || tabNumSieges.length === 0) {
        return res.status(401).json({ success: false, message: "Vous n'avez choisi aucun ticket !!" });
    }
    if (!tabNumSieges.every(item => item && typeof item === 'object' && item.id && item.numSiege)) {
        return res.status(401).json({ success: false, message: "Références manquantes !" });
    }
    if (!newRefVoyage || !refVoyage || remplacerAbsents == null) {
        return res.status(401).json({ success: false, message: "Références manquantes !" });
    }

    try {
        const { data: dispo_newRef, error: errorDispoRef } = await supabase
            .from('ref_voyages')
            .select('matcar, nbreplaces, disponible')
            .eq('refvoyage', newRefVoyage)
            .maybeSingle();

        if (errorDispoRef || !dispo_newRef) {
            return res.status(404).json({ success: false, message: "Vérifiez que la nouvelle référence est correcte." });
        }
        if (!dispo_newRef.disponible) {
            return res.status(400).json({ success: false, message: "Le voyage choisi n'est pas disponible." });
        }

        const [
            { data: verifSieges, error: errorSieges }, 
            { count: supplements, error: errorSupp }
        ] = await Promise.allSettled([
            supabase.from('tickets').select('siegevacant, refvoyageremplacement').eq('refvoyage', newRefVoyage),
            supabase.from('sieges_supplementaires').select('*', { count: 'exact' }).eq('refvoyage', newRefVoyage)
        ]);

        if (errorSieges || errorSupp) {
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        const nbreSieges = verifSieges.length;
        const nbreVacants = verifSieges.filter(ticket => ticket.siegevacant || ticket.refvoyageremplacement !== null).length;
        const nbrePassagers = nbreSieges - nbreVacants + supplements;
        const placesRestantes = dispo_newRef.nbreplaces - nbrePassagers;

        if (nbrePassagers > dispo_newRef.nbreplaces) {
            return res.status(400).json({ success: false, message: `Il y a surcharge dans le car ${dispo_newRef.matcar}.` });
        }
        if (placesRestantes < tabNumSieges.length) {
            return res.status(401).json({ success: false, message: `Désolé, il reste ${placesRestantes} place(s) dans le car ${dispo_newRef.matcar}.` });
        }

        const [{ data: inTickets }, { data: inSiegesSup }] = await Promise.all([
            supabase.from('tickets').select('*').eq('refvoyage', refVoyage).eq('siegevacant', false).in('id', tabNumSieges.map(item => item.id)),
            supabase.from('sieges_supplementaires').select('*').eq('refvoyage', refVoyage).eq('siegevacant', false).in('id', tabNumSieges.map(item => item.id))
        ]);

        if ((!inTickets || inTickets.length === 0) && (!inSiegesSup || inSiegesSup.length === 0)) {
            return res.status(404).json({ success: false, message: "Tickets non trouvés." });
        }

        const ticketsAtraiter = [...(inTickets || []), ...(inSiegesSup || [])];
        const ticketsResults = await Promise.all(
            ticketsAtraiter.map(async (item) => {
                const { data: tickets, error: errorTickets } = await supabase.rpc('enregistrer_tickets_mod3', {
                    jsonb_param: {
                        p_refvoyage: newRefVoyage,
                        p_codegare: item.codegare,
                        p_destination: item.destination,
                        p_prixticket: item.prixticket,
                        p_contactclient: item.contactclient,
                        p_codeclient: item.codeclient,
                        p_matguichetiere: item.matguichetiere,
                        p_nbreplacescar: dispo_newRef.nbreplaces,
                        p_matcar: item.matcar,
                        p_typeticket: item.typeticket,
                        p_nbretickets: 1,
                        p_clientbagage: item.clientbagage
                    }
                });

                if (errorTickets) throw new Error("Erreur RPC.");

                return { item, tickets };
            })
        );

        const updates = ticketsResults.map(({ item, tickets }) => (
            supabase.from('tickets')
                .update({
                    refvoyageremplacement: newRefVoyage,
                    newnumsiege: tickets.ticketsvendus.numsiege,
                    siegevacant: true
                })
                .eq('id', item.id)
                .select()
        ));

        const updateResults = await Promise.all(updates);
        const updatedTickets = updateResults.filter(({ data }) => data && data.length > 0).map(({ data }) => data);

        if (updatedTickets.length === 0) {
            return res.status(404).json({ success: false, message: "Échec de mise à jour." });
        }

        res.status(201).json({
            success: true,
            message: "Succès : changement de car pour les tickets suivants :",
            tickets_create: ticketsResults.map(({ tickets }) => tickets.tickets),
            tickets_maj: updatedTickets
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++//



// API : Valider le voyage 
router.post('/valider-voyage/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params
    const {
        montantPayants,
        montantGratuits,
        montantColis,
        montantBagages,
        nbreTicketsPayant,
        nbreTicketsGratuit,
        nbrePersonnel,
        nbreColis,
        nbreBagages,
        matChefDeGare,
    } = req.body

    const { data: voyage, error: errorVoyage } = await supabase
        .from('voyages')
        .insert([
            {
                refvoyage: refVoyage,
                montantpayants: montantPayants,
                montantgratuits: montantGratuits,
                montantcolis: montantColis,
                montantbagages: montantBagages,
                nbreticketspayant: nbreTicketsPayant,
                nbreticketsgratuit: nbreTicketsGratuit,
                nbrepersonnel: nbrePersonnel,
                nbrecolis: nbreColis,
                nbrebagages: nbreBagages,
                matchefdegare: matChefDeGare,
                nbrepersonnes : (nbreTicketsPayant + nbreTicketsGratuit + nbrePersonnel)
            },
        ])
        .select()

    if (errorVoyage) {
        console.error("Erreur de l'enregistrement : ", errorVoyage);
        if (errorVoyage.message.includes("duplicate key value violates unique constraint")) {
            return res.status(400).json({ success: false, message: "Ce voyage est déjà enregistré." });
        }
        if (errorVoyage.message.includes('insert or update on table "voyages" violates foreign key constraint')) { // "fk_matchefdegare"')) {
            return res.status(400).json({ success: false, message: "Vous devez vous connecter avec un compte avant d'effectuer cette opération." });
        }
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
    if (!voyage || voyage.length === 0) {
        return res.status(400).json({ success: false, message: "Non effectué." });
    }

    // Modifier la ref_voyages.disponible à false
    const { data: refFalse, error: errorRefFalse } = await supabase
        .from('ref_voyages')
        .update({ disponible: false })
        .eq('refvoyage', refVoyage)
        .maybeSingle();
    if (errorRefFalse) {
        console.error("Erreur lors de la récupération : ", errorRefFalse);
        return res.status(500).json({ success: false, message: "Une erreur est survenue lors de la mise à jour." })
    }

    return res.status(201).json({
        success: true,
        message: "Enregistré avec succès",
        voyage: voyage,
    })
})
//----------------------------------------------------------------------------------


// Liste des voyages à valider
router.get('/voyages-disponibles-dpmt/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params;

    try {
        const { data: listeVoyages, error: errorListe } = await supabase
            .from('ref_voyages')
            .select(`
                refvoyage,
                matcar,
                nomconducteur,
                nbreplaces,
                disponible,
                carremplacement,
                conducteurremplacement,
                nbreplaces_remplacement
            `)
            .eq('iddepartement', idDepartement)
            .eq('disponible', true);

        if (errorListe) {
            console.error("Erreur lors de la récupération des voyages : ", errorListe);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!listeVoyages || listeVoyages.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage disponible pour ce département aujourd'hui." });
        }

        const voyages = await Promise.all(listeVoyages.map(async (voyage) => {
            const refVoyage = voyage.refvoyage;
            const car = voyage.carremplacement || voyage.matcar;
            const conducteur = voyage.conducteurremplacement || voyage.nomconducteur;

            const [ticketsRes, siegesSupRes, bagagesRes, colisRes, colisAnnulesRes] = await Promise.all([
                supabase.from('tickets').select('*').eq('refvoyage', refVoyage).is('refvoyageremplacement', null),
                supabase.from('sieges_supplementaires').select('*').eq('refvoyage', refVoyage).is('refvoyageremplacement', null),
                supabase.from('bagages').select('*').or(`refvoyage.eq.${refVoyage}, refenvoie.eq.${refVoyage}`),
                supabase.from('colis').select('*').eq('colisannuler', false).or(`refvoyage.eq.${refVoyage}, refenvoie.eq.${refVoyage}`),
                supabase.from('colis_annulers').select('*').eq('refvoyage', refVoyage)
            ]);

            if (ticketsRes.error || siegesSupRes.error || bagagesRes.error || colisRes.error || colisAnnulesRes.error) {
                console.error("Erreur lors de la récupération des données : ", { ticketsRes, siegesSupRes, bagagesRes, colisRes, colisAnnulesRes });
                return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
            }

            const calculeTotal = (data, key, condition = () => true) => data.reduce((acc, item) => acc + (condition(item) ? item[key] || 0 : 0), 0);
            const calculeNombre = (data, condition = () => true) => data.filter(condition).length;

            return {
                refvoyage: refVoyage,
                matcar: car,
                nomconducteur: conducteur,
                nbreplacescar: voyage.nbreplaces,
                disponible: voyage.disponible,
                montvoyage: calculeTotal(ticketsRes.data, 'prixticket', t => t.typeticket === 'PAYANT')
                    + calculeTotal(siegesSupRes.data, 'prixticket', s => s.typeticket === 'PAYANT')
                    + calculeTotal(bagagesRes.data, 'prixbagage')
                    + calculeTotal(colisRes.data, 'prixcolis')
                    + calculeTotal(colisAnnulesRes.data, 'montantretenu'),
                tickets: {
                    nbretickets_total: ticketsRes.data.length,
                    nbrepayants: calculeNombre(ticketsRes.data, t => t.typeticket === 'PAYANT'),
                    nbregratuits: calculeNombre(ticketsRes.data, t => t.typeticket === 'GRATUIT'),
                    monttickets: calculeTotal(ticketsRes.data, 'prixticket', t => t.typeticket === 'PAYANT'),
                    montgratuits: calculeTotal(ticketsRes.data, 'prixticket', t => t.typeticket === 'GRATUIT'),
                    placerestantes: Math.max(0, voyage.nbreplaces - ticketsRes.data.length),
                    tickets: ticketsRes.data
                },
                sieges_supplementaires: {
                    nbretickets_total: siegesSupRes.data.length,
                    nbrepayants: calculeNombre(siegesSupRes.data, s => s.typeticket === 'PAYANT'),
                    nbregratuits: calculeNombre(siegesSupRes.data, s => s.typeticket === 'GRATUIT'),
                    monttickets: calculeTotal(siegesSupRes.data, 'prixticket', s => s.typeticket === 'PAYANT'),
                    montgratuits: calculeTotal(siegesSupRes.data, 'prixticket', s => s.typeticket === 'GRATUIT'),
                    tickets: siegesSupRes.data
                },
                bagages: {
                    nbrebagages: bagagesRes.data.length,
                    nbre_taxers: calculeNombre(bagagesRes.data, b => b.prixbagage > 0),
                    nbre_nontaxers: calculeNombre(bagagesRes.data, b => b.prixbagage === 0),
                    nbre_refvoyage: calculeNombre(bagagesRes.data, b => b.refenvoie === refVoyage && b.refenvoie !== b.refvoyage),
                    montbagages: calculeTotal(bagagesRes.data, 'prixbagage'),
                    sansbagages: ticketsRes.data.length - bagagesRes.data.length,
                    bagages: bagagesRes.data
                },
                colis: {
                    nbrecolis: colisRes.data.length,
                    nbre_taxers: calculeNombre(colisRes.data, c => c.refvoyage === refVoyage),
                    nbre_refvoyage: calculeNombre(colisRes.data, c => c.refenvoie === refVoyage && c.refenvoie !== c.refvoyage),
                    montcolis: calculeTotal(colisRes.data, 'prixcolis'),
                    colis: colisRes.data
                },
                colis_annules: {
                    nbrecolisannules: colisAnnulesRes.data.length,
                    montcolisannules: calculeTotal(colisAnnulesRes.data, 'montantretenu'),
                    colis_annules: colisAnnulesRes.data
                }
            };
        }));

        return res.status(200).json({ success: true, voyages });
    } catch (error) {
        console.error("Erreur serveur :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// API : Liste tous les colis du jour spécifié du département
router.get('/liste-des-colis-du-jour/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params;
    const { dateRef } = req.query;

    if (!idDepartement || !dateRef) {
        return res.status(400).json({ success: false, message: "Références manquantes." });
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

        // Récupérer les voyages du jour
        const { data: refsDuJour, error: errorRefs } = await supabase
            .from('ref_voyages')
            .select('refvoyage')
            .eq('iddepartement', idDepartement)
            .gte('daterefvoyage', dateDebut.toISOString())
            .lte('daterefvoyage', dateFin.toISOString());

        if (errorRefs) {
            console.error("Erreur lors de la récupération des voyages : ", errorRefs);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!refsDuJour || refsDuJour.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage effectué aujourd'hui." });
        }

        // Récupérer les colis liés aux références trouvées
        const refVoyagesIds = refsDuJour.map(r => r.refvoyage);
        // const refVoyagesIds = refsDuJour.map(r => r.refvoyage).join(",") //Lorsque j'utilise : .or(`refvoyage.in.(${refVoyagesIds}), refenvoie.in.(${refVoyagesIds})`)

        const { data: colisDuJour, error: errorColis } = await supabase
            .from('colis')
            .select(`
                *, 
                gares(nomgare), 
                ref_voyages(matcar, nomconducteur, carremplacement, conducteurremplacement)
            `)
            .in('refvoyage', refVoyagesIds)
            .order('refvoyage', { ascending: true })
            .order('codecolis', { ascending: true });

        if (errorColis) {
            console.error("Erreur lors de la récupération des colis : ", errorColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!colisDuJour || colisDuJour.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis expédié aujourd'hui." });
        }

        // Formatage des colis
        const listeColis = colisDuJour.map(item => ({
            codecolis: item.codecolis,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixcolis: item.prixcolis,
            description: item.description,
            destination: item.destination,
            datecolis: item.datecolis,
            photocolis: item.photocolis,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            codeclient: item.codeclient,
            nomexpediteur: item.nomexpediteur,
            contactexpediteur: item.contactexpediteur,
            nomdestinataire: item.nomdestinataire,
            contactdestinataire: item.contactdestinataire,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare,
            colismodifier: item.colismodifier,
            datemodification: item.datemodification,
            colisrecu: item.colisrecu,
            daterecu: item.daterecu,
            colisretirer: item.colisretirer,
            dateretrait: item.dateretrait,
            colisintrouvable: item.colisintrouvable,
            colisannuler: item.colisannuler,
            dateannulation: item.dateannulation,
        }));

        return res.status(200).json({
            success: true,
            nbrecolis: listeColis.length,
            colis: listeColis
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// API : Liste tous les bagages du jour spécifié du département
router.get('/liste-des-bagages-du-jour/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params;
    const { dateRef } = req.query;

    if (!idDepartement) {
        return res.status(400).json({ success: false, message: "Références manquantes." });
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

        // Récupérer les voyages du jour
        const { data: refsDuJour, error: errorRefs } = await supabase
            .from('ref_voyages')
            .select('refvoyage')
            .eq('iddepartement', idDepartement)
            .gte('daterefvoyage', dateDebut.toISOString())
            .lte('daterefvoyage', dateFin.toISOString());

        if (errorRefs) {
            console.error("Erreur lors de la récupération des voyages : ", errorRefs);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!refsDuJour || refsDuJour.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage effectué aujourd'hui." });
        }

        // Récupérer les bagages liés aux références trouvées
        const refVoyagesIds = refsDuJour.map(r => r.refvoyage);
        // const refVoyagesIds = refsDuJour.map(r => r.refvoyage).join(",") //Lorsque j'utilise : .or(`refvoyage.in.(${refVoyagesIds}), refenvoie.in.(${refVoyagesIds})`)

        const { data: bagagesDuJour, error: errorBagages } = await supabase
            .from('bagages')
            .select(`
                *, 
                gares(nomgare), 
                ref_voyages(matcar, nomconducteur, carremplacement, conducteurremplacement)
            `)
            .in('refvoyage', refVoyagesIds)
            .order('refvoyage', { ascending: true })
            .order('codebagage', { ascending: true });

        if (errorBagages) {
            console.error("Erreur lors de la récupération des bagages : ", errorBagages);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!bagagesDuJour || bagagesDuJour.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun bagage enregistré aujourd'hui." });
        }

        // Formatage des colis
        const listeBagages = bagagesDuJour.map(item => ({
            codebagage: item.codebagage,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixbagage: item.prixbagage,
            description: item.description,
            datebagage: item.datebagage,
            photobagage: item.photobagage,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            codeclient: item.codeclient,
            nomclient: item.nomclient,
            contactclient: item.contactclient,
            numsiege: item.numsiege,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare,
            bagagemodifier: item.bagagemodifier,
            datemodification: item.datemodification,
            bagageintrouvable: item.bagageintrouvable,
        }));

        return res.status(200).json({
            success: true,
            nbrebagage: listeBagages.length,
            bagages: listeBagages,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// API : Liste tous les tickets du jour spécifié du département 
router.get('/liste-des-tickets-du-jour/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params;
    const { dateRef } = req.query;

    if (!idDepartement) {
        return res.status(400).json({ success: false, message: "Références manquantes." });
    }

    try {
        let dateDebut, dateFin;
        if (dateRef) {
            const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
            const match = dateRef.match(dateRegex);
            if (!match) return res.status(400).json({ success: false, message: "Format de date invalide. Utilisez JJ/MM/AAAA." });

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

        // Récupérer les voyages du jour
        const { data: refsDuJour, error: errorRefs } = await supabase
            .from('ref_voyages')
            .select('refvoyage')
            .eq('iddepartement', idDepartement)
            .gte('daterefvoyage', dateDebut.toISOString())
            .lte('daterefvoyage', dateFin.toISOString());

        if (errorRefs) {
            console.error("Erreur lors de la récupération voyages:", errorRefs);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!refsDuJour || refsDuJour.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage aujourd'hui." });
        }

        // Récupérer les tickets des voyages trouvés
        const tabRefVoyages = refsDuJour.map(r => r.refvoyage);
        const [ticketsRes, siegesSupRes] = await Promise.all([
            supabase
                .from('tickets')
                .select('*, ref_voyages(matcar, nomconducteur, carremplacement, conducteurremplacement), gares(nomgare)')
                .in('refvoyage', tabRefVoyages)
                .is('refvoyageremplacement', null)
                .order('refvoyage', { ascending: true })
                .order('dateticket', { ascending: true }),
            supabase
                .from('sieges_supplementaires')
                .select('*, ref_voyages(matcar, nomconducteur, carremplacement, conducteurremplacement), gares(nomgare)')
                .in('refvoyage', tabRefVoyages)
                .is('refvoyageremplacement', null)
                .order('refvoyage', { ascending: true })
                .order('dateticket', { ascending: true })
        ]);

        if (ticketsRes?.error || siegesSupRes?.error) {
            console.error("Erreur lors de la récupération des tickets:", { ticketsRes, siegesSupRes });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        // Vérifier s'il y a des tickets
        const ticketsData = ticketsRes?.data || [];
        const siegesSupData = siegesSupRes?.data || [];
        if (ticketsData.length === 0 && siegesSupData.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun ticket trouvé." });
        }

        // Formatage des tickets
        const formatTicket = (item) => ({
            id: item.id,
            refvoyage: item.refvoyage,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            conducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            numsiege: item.numsiege,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare,
            destination: item.destination,
            typeticket: item.typeticket,
            prixticket: item.prixticket,
            ticketutiliser: item.ticketconsommer,
            siegevacant: item.siegevacant,
            etaitabsent: item.etaitabsent,
            clientbagage: item.clientbagage,
            contactclient: item.contactclient,
            codeclient: item.codeclient,
            dateticket: item.dateticket,
            matguichetiere: item.matguichetiere,
        });

        const listeTickets = ticketsData.map(formatTicket);
        const listeTicketsSup = siegesSupData.map(formatTicket);
        const tickets = [...listeTickets, ...listeTicketsSup].sort((a, b) => {
            if (a.refvoyage !== b.refvoyage) {
                return a.refvoyage.localeCompare(b.refvoyage);
            }
            return a.numsiege - b.numsiege;
        })

        return res.status(200).json({
            success: true,
            nbretickets: listeTickets.length + listeTicketsSup.length,
            tickets: tickets
        });

    } catch (error) {
        console.error("Erreur serveur:", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// API : colis introuvables 
router.get('/liste-des-colis-introuvables', async (req, res) => {
    try {
        const { data: colisintrouvables, error: errorIntrouvable } = await supabase
            .from('colis')
            .select(`*, ref_voyages (matcar, nomconducteur, carremplacement, conducteurremplacement), gares(nomgare)`)
            .eq('colisintrouvable', true)
        if (errorIntrouvable) {
            console.error("Erreur lors de la récupération des données : ", errorIntrouvable)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }
        if (!colisintrouvables || colisintrouvables.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis introuvable !" })
        }

        // Transformation des données
        const infosColis = colisintrouvables.map(item => ({
            codecolis: item.codecolis,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixcolis: item.prixcolis,
            description: item.description,
            destination: item.destination,
            datecolis: item.datecolis,
            photocolis: item.photocolis,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            codeclient: item.codeclient,
            nomexpediteur: item.nomexpediteur,
            contactexpediteur: item.contactexpediteur,
            nomdestinataire: item.nomdestinataire,
            contactdestinataire: item.contactdestinataire,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare,
            colismodifier: item.colismodifier,
            datemodification: item.datemodification,
            colisrecu: item.colisrecu,
            daterecu: item.daterecu,
            colisretirer: item.colisretirer,
            dateretrait: item.dateretrait,
            colisintrouvable: item.colisintrouvable,
            colisannuler: item.colisannuler,
            dateannulation: item.dateannulation,
        }));

        // Retourner les données
        return res.status(200).json({
            success: true,
            nbrecolis: infosColis.length,
            colis: infosColis,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})


// API : bagages introuvables 
router.get('/liste-des-bagages-introuvables', async (req, res) => {
    try {
        const { data: bagagesIntrouvables, error: errorIntrouvable } = await supabase
            .from('bagages')
            .select(`
                *, 
                gares(nomgare), 
                ref_voyages(matcar, nomconducteur, carremplacement, conducteurremplacement)
            `)
            .eq('bagageintrouvable', true)
        if (errorIntrouvable) {
            console.error("Erreur lors de la récupération des données : ", errorIntrouvable)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }
        if (!bagagesIntrouvables || bagagesIntrouvables.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun bagage introuvable !" })
        }


        // Formatage des bagages
        const listeBagages = bagagesIntrouvables.map(item => ({
            codebagage: item.codebagage,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixbagage: item.prixbagage,
            description: item.description,
            datebagage: item.datebagage,
            photobagage: item.photobagage,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            codeclient: item.codeclient,
            nomclient: item.nomclient,
            contactclient: item.contactclient,
            numsiege: item.numsiege,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare,
            bagagemodifier: item.bagagemodifier,
            datemodification: item.datemodification,
            bagageintrouvable: item.bagageintrouvable,
        }));

        return res.status(200).json({
            success: true,
            nbrebagage: listeBagages.length,
            bagages: listeBagages,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})

// API : Déclarer un colis introuvable
router.put('/declarer-un-colis-introuvable', async (req, res) => {
    const { codeColis } = req.body

    if (!codeColis) { return res.status(400).json({ success: false, message: "Références manquantes." }) }

    try {
        const { data: estIntrouvable, error: errorIntrouvable } = await supabase
            .from('colis')
            .update({ colisintrouvable: true })
            .eq('codecolis', codeColis)
            .select()
            .maybeSingle();
        if (errorIntrouvable) {
            console.error("Erreur lors de la récupération des données : ", errorIntrouvable)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }
        if (estIntrouvable && estIntrouvable.colisintrouvable === false) {
            return res.status(403).json({ success: false, message: "Modification non effectuée. \nVérifiez que votre colis existe." })
        }

        return res.status(202).json({ success: true, message: "Colis déclaré introuvable !", colis: estIntrouvable })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})

// API : Déclarer un bagage introuvable
router.put('/declarer-un-bagage-introuvable', async (req, res) => {
    const { codeBagage } = req.body

    if (!codeBagage) { return res.status(400).json({ success: false, message: "Références manquantes." }) }

    try {
        const { data: estIntrouvable, error: errorIntrouvable } = await supabase
            .from('bagages')
            .update({ bagageintrouvable: true })
            .eq('codebagage', codeBagage)
            .select()
            .maybeSingle();
        if (errorIntrouvable) {
            console.error("Erreur lors de la récupération des données : ", errorIntrouvable)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }
        if (!estIntrouvable || (estIntrouvable && estIntrouvable.bagageintrouvable === false)) {
            return res.status(403).json({ success: false, message: "Modification non effectuée. \nVérifiez que votre colis existe." })
        }

        return res.status(202).json({ success: true, message: "Bagage déclaré introuvable !", bagage: estIntrouvable })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})


// 1-b Liste des refVoyages d'une date
router.get('/refVoyages-dune-journee/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params;
    const { dateRef } = req.query;

    try {
        let dateDebut, dateFin;

        if (dateRef) {
            // Vérification du format JJ/MM/AAAA avec regex
            const dateRegex = /^(\d{2})\/(\d{2})\/(\d{4})$/;
            const match = dateRef.match(dateRegex);

            if (!match) {
                return res.status(400).json({ success: false, message: "Format de date invalide. Utilisez JJ/MM/AAAA." });
            }

            // Extraction et conversion en nombres
            const [_, jour, mois, annee] = match;
            const jourNum = Number(jour);
            const moisNum = Number(mois);
            const anneeNum = Number(annee);

            if (isNaN(jourNum) || isNaN(moisNum) || isNaN(anneeNum)) {
                return res.status(400).json({ success: false, message: "Date invalide Utilisez JJ/MM/AAAA." });
            }

            // Création des dates de début (00:00:00) et de fin (23:59:59)
            dateDebut = new Date(anneeNum, moisNum - 1, jourNum, 0, 0, 0);
            dateFin = new Date(anneeNum, moisNum - 1, jourNum, 23, 59, 59);
        } else {
            // Si aucune date fournie, prendre aujourd’hui (00:00:00 → 23:59:59)
            const today = new Date();
            dateDebut = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
            dateFin = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
        }

        if (isNaN(dateDebut.getTime()) || isNaN(dateFin.getTime())) {
            return res.status(400).json({ success: false, message: "Date invalide Utilisez JJ/MM/AAAA." });
        }

        // Requête Supabase : Rechercher entre `00:00:00` et `23:59:59`
        const { data: refVoyages, error: refVoyagesError } = await supabase
            .from('ref_voyages')
            .select(`
                refvoyage,
                matcar,
                matconducteur,
                nomconducteur,
                disponible
            `)
            .eq('iddepartement', idDepartement)
            .gte('daterefvoyage', dateDebut.toISOString())  // >= 00:00:00
            .lte('daterefvoyage', dateFin.toISOString())  // <= 23:59:59
            .order('refvoyage', { ascending: false });

        if (refVoyagesError) {
            console.error("Erreur lors de la récupération des données :", refVoyagesError);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!refVoyages || refVoyages.length === 0) {
            return res.status(400).json({ success: false, message: "Aucun voyage disponible." });
        }

        return res.status(200).json({
            success: true,
            datas: refVoyages,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// 9- Liste totale des colis d'un voyage
router.get('/listeTotale-colis-voyage/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params;
    const { codeGare, destination } = req.query;

    try {
        let query = supabase
            .from('colis')
            .select(`*, ref_voyages (matcar, nomconducteur, carremplacement, conducteurremplacement), gares(nomgare)`)
            .eq('colisannuler', false)
            .eq('colisretourner', false)
            .eq('colisintrouvable', false)
            .or(`refvoyage.eq.${refVoyage}, refenvoie.eq.${refVoyage}`)
            .order('codecolis', { ascending: false });

        //Ajout des paramètres optionels (multicritères)
        if (codeGare) {
            query = query.eq('codegare', codeGare);
        }
        if (destination) {
            query = query.eq('destination', destination);
        }

        // Exécuter la requête
        const { data: listeColis, error: errorListe } = await query;

        //Traitement des erreurs
        if (errorListe) {
            console.error("Erreur lors de la récupération des données : ", errorListe);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!listeColis || listeColis.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis trouvé." });
        }

        // Transformation des données
        const infosColis = listeColis.map(item => ({
            codecolis: item.codecolis,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixcolis: item.prixcolis,
            description: item.description,
            destination: item.destination,
            datecolis: item.datecolis,
            photocolis: item.photocolis,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            codeclient: item.codeclient,
            nomexpediteur: item.nomexpediteur,
            contactexpediteur: item.contactexpediteur,
            nomdestinataire: item.nomdestinataire,
            contactdestinataire: item.contactdestinataire,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare,
            colismodifier: item.colismodifier,
            datemodification: item.datemodification,
            colisrecu: item.colisrecu,
            daterecu: item.daterecu,
            colisretirer: item.colisretirer,
            dateretrait: item.dateretrait,
            colisintrouvable: item.colisintrouvable,
            colisannuler: item.colisannuler,
            dateannulation: item.dateannulation,
        }));

        // Retourner les données
        return res.status(200).json({
            success: true,
            nbrecolis: infosColis.length,
            listecolis: infosColis,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// 10- Liste totale des tickets d'un voyage
router.get('/listeTotale-tickets-voyage/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params;

    try {
        let query = supabase
            .from('tickets')
            .select(`*, ref_voyages (matcar, nomconducteur, carremplacement, conducteurremplacement), gares(nomgare)`)
            .eq('refvoyage', refVoyage)
            .order('numsiege', { ascending: true });

        // Exécuter la requête
        const { data: listeTickets, error: errorListe } = await query;

        //Traitement des erreurs
        if (errorListe) {
            console.error("Erreur lors de la récupération des données : ", errorListe);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!listeTickets || listeTickets.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis trouvé." });
        }

        // Transformation des données
        const infosTickets = listeTickets.map(item => ({
            idticket: item.id,
            refvoyage: item.refvoyage,
            prixticket: item.ticket,
            destination: item.destination,
            dateticket: item.dateticket,
            codeclient: item.codeclient,
            contactclient: item.contactclient,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare,
        }));

        // Retourner les données
        return res.status(200).json({
            success: true,
            nbretickets: infosTickets.length,
            listetickets: infosTickets,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// 11- Liste totale des bagage d'un voyage
router.get('/listeTotale-bagages-voyage/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params;

    try {
        let query = supabase
            .from('bagages')
            .select(`*, ref_voyages (matcar, nomconducteur, carremplacement, conducteurremplacement), gares(nomgare)`)
            .eq('bagageintrouvable', false)
            .or(`refvoyage.eq.${refVoyage}, refenvoie.eq.${refVoyage}`)
            .order('codebagage', { ascending: false });

        // Exécuter la requête
        const { data: listeBagages, error: errorListe } = await query;

        //Traitement des erreurs
        if (errorListe) {
            console.error("Erreur lors de la récupération des données : ", errorListe);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!listeBagages || listeBagages.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun bagage trouvé." });
        }

        // Transformation des données
        const infosBagages = listeBagages.map(item => ({
            codebagage: item.codebagage,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixbagage: item.prixbagage,
            description: item.description,
            datebagage: item.datebagage,
            photobagage: item.photobagage,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            codeclient: item.codeclient,
            nomclient: item.nomclient,
            contactclient: item.contactclient,
            numsiege: item.numsiege,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare,
            bagageintrouvable: item.bagageintrouvable,
        }));

        // Retourner les données
        return res.status(200).json({
            success: true,
            nbrebagages: infosBagages.length,
            listebagages: infosBagages,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


module.exports = router;

