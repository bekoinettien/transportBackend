const express = require('express')
const supabase = require('./../supabase')

const router = express.Router()


// 1- Liste des refVoyages "disponibles"
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


// 2- Authentifier un ticket - et le consommer
function isValidUUID(uuid) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid);
}

//Cas 1 : pour scanner (automatique, dynamique, et plus sécurisé)
router.put('/authentifier-ticket/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params
    const { idTicket, numSiege, refVoyageTicket, matControleurTicket } = req.body

    try {
        if (idTicket && numSiege && refVoyage && refVoyageTicket) {
            // Vérifier que les 2 refVoyages correspondent
            if (refVoyage !== refVoyageTicket) {
                return res.status(400).json({ success: false, message: "Ticket invalide !" })
            }

            // Vérification si l'ID est un UUID valide
            if (!isValidUUID(idTicket)) {
                return res.status(400).json({ success: false, message: "Ticket invalide !" });
            }
            const [ticketsRes, siegesSupRes] = await Promise.all([
                supabase
                    .from('tickets')
                    .select('*')
                    .eq('id', String(idTicket))
                    .eq('refvoyage', refVoyage)
                    .eq('numsiege', numSiege)
                    .maybeSingle(),
                supabase
                    .from('sieges_supplementaires')
                    .select('*')
                    .eq('id', String(idTicket))
                    .eq('refvoyage', refVoyage)
                    .eq('numsiege', numSiege)
                    .maybeSingle(),
            ]);
            if (ticketsRes.error || siegesSupRes.error) {
                console.error("Erreur lors de la récupération des données : ", { ticketsRes, siegesSupRes });
                return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
            }

            // Vérifier l'existence du ticket
            if (
                (!ticketsRes.data && !siegesSupRes.data) ||
                (ticketsRes.data.length === 0 && siegesSupRes.data.length === 0)
            ) {
                return res.status(400).json({ success: false, message: "Ticket invalide !" });
            }

            // Vérifier que le ticket n'est pas consommé
            if (
                (ticketsRes.data && ticketsRes.data.ticketconsommer === true) ||
                (siegesSupRes.data && siegesSupRes.data.ticketconsommer === true)
            ) {
                return res.status(400).json({ success: false, message: "Ticket déjà utilisé !" });
            }

            // Vérifier que  refvoyageremplacement du ticket n'a pas changé 
            if (
                (ticketsRes.data && ticketsRes.data.refvoyageremplacement !== null) ||
                (siegesSupRes.data && siegesSupRes.data.refvoyageremplacement !== null)
            ) {
                // Rechercher le ticket dont le voyage a changé 
                const refRemplacer_1 = ticketsRes.data ? ticketsRes.data.refvoyageremplacement : 'NON TROUVER'
                const siegeRemplacer_1 = ticketsRes.data ? ticketsRes.data.newnumsiege : 'NON TROUVER'

                const refRemplacer_2 = siegesSupRes.data ? siegesSupRes.data.refvoyageremplacement : 'NON TROUVER'
                const siegeRemplacer_2 = siegesSupRes.data ? siegesSupRes.data.newnumsiege : 'NON TROUVER'

                const [autreTicket, autreTicketSup] = await Promise.all([
                    supabase
                        .from('tickets')
                        .select('refvoyage, numsiege, destination, newnumsiege, ref_voyages (matcar, carremplacement)')
                        .eq('refvoyage', refRemplacer_1)
                        .eq('numsiege', siegeRemplacer_1)
                        .maybeSingle(),
                    supabase
                        .from('sieges_supplementaires')
                        .select('refvoyage, numsiege, destination, newnumsiege, ref_voyages (matcar, carremplacement)')
                        .eq('refvoyage', refRemplacer_2)
                        .eq('numsiege', siegeRemplacer_2)
                        .maybeSingle(),
                ])
                if (autreTicket.error || autreTicketSup.error) {
                    console.error("Erreur lors de la récupération des données : ", { autreTicket, autreTicketSup })
                    return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
                }
                // Vérifier l'existence du ticket
                if (
                    (!autreTicket.data && !autreTicketSup.data) ||
                    (autreTicket.data.length === 0 && autreTicketSup.data.length === 0)
                ) {
                    return res.status(400).json({ success: false, message: "Ticket non trouvé !" });
                }

                // Extraire le matCar en priorisant carremplacement s'il existe
                const refVoyagesTicket = autreTicket?.data?.ref_voyages;
                const refVoyagesSupp = autreTicketSup?.data?.ref_voyages;
                const matCar = refVoyagesTicket?.carremplacement ?? refVoyagesTicket?.matcar ??
                    refVoyagesSupp?.carremplacement ?? refVoyagesSupp?.matcar;

                // Vérifier que le ticket est consommé
                const ticketConsommer = Boolean(autreTicket?.data?.ticketconsommer || autreTicketSup?.data?.ticketconsommer);
                const utiliser = ticketConsommer ? "OUI" : "NON";

                // Construire la réponse
                const messageResponse = "Nvlle ref : " + ticketsRes.data.refvoyageremplacement +
                    "\nmatricule car : " + matCar +
                    "\nNuméro de siege : " + ticketsRes.data.newnumsiege +
                    "\nTicket utilisé ? : " + utiliser;


                return res.status(401).json({ success: false, message: messageResponse })
            }


            // Le modifier tickets.ticketconsommer = true
            const [consomTickets, consomSiegesSup] = await Promise.all([
                supabase
                    .from('tickets')
                    .update({ ticketconsommer: true, matcontroleurticket :  matControleurTicket })
                    .eq('refvoyage', refVoyage)
                    .eq('numsiege', numSiege)
                    .select()
                    .maybeSingle(),
                supabase
                    .from('sieges_supplementaires')
                    .update({ ticketconsommer: true, matcontroleurticket :  matControleurTicket })
                    .eq('refvoyage', refVoyage)
                    .eq('numsiege', numSiege)
                    .select()
                    .maybeSingle(),
            ])
            if (consomTickets.error || consomSiegesSup.error) {
                console.error("Erreur lors de l'enregistrement des données : ", { consomTickets, consomSiegesSup });
                return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
            }
            if (
                (!consomTickets || (consomTickets.ticketconsommer === false && consomTickets.matcontroleurticket === null)) ||
                (!consomSiegesSup || (consomSiegesSup.ticketconsommer === false && consomSiegesSup.matcontroleurticket === null))
            ) {
                return res.status(500).json({ success: false, message: "Enregistrement non effectué." });
            }

            const ticket = consomTickets.data ? consomTickets.data : consomSiegesSup.data

            return res.status(202).json({
                success: true,
                message: "Ticket validé !",
                ticket: ticket,
            })

        } else {
            return res.status(400).json({ success: false, message: "Rérécences manquantes !!" })
        }

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})

// Cas 2-a : rechercher ticket (comparaison mannuelle) 
router.get('/recherche-ticket/:refVoyage/:numSiege', async (req, res) => {
    const { refVoyage, numSiege } = req.params

    try {
        if (!numSiege || !refVoyage) {
            return res.status(400).json({ success: false, message: "Références manquantes !" })
        }

        const [ticketsRes, siegesSupRes] = await Promise.all([
            supabase
                .from('tickets')
                .select('*')
                .eq('refvoyage', refVoyage)
                .eq('numsiege', numSiege)
                // .is('refvoyageremplacement', null)
                .maybeSingle(),
            supabase
                .from('sieges_supplementaires')
                .select('*')
                .eq('refvoyage', refVoyage)
                .eq('numsiege', numSiege)
                // .is('refvoyageremplacement', null)
                .maybeSingle(),
        ]);
        if (ticketsRes.error || siegesSupRes.error) {
            console.error("Erreur lors de la récupération des données : ", { ticketsRes, siegesSupRes });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }

        // Vérifier l'existence du ticket
        if (
            (!ticketsRes.data && !siegesSupRes.data) ||
            (ticketsRes.data.length === 0 && siegesSupRes.data.length === 0)
        ) {
            return res.status(400).json({ success: false, message: "Ticket non trouvé !" });
        }

        // Vérifier que refvoyageremplacement du ticket n'a pas changé 
        if (
            (ticketsRes.data && ticketsRes.data.refvoyageremplacement !== null) ||
            (siegesSupRes.data && siegesSupRes.data.refvoyageremplacement !== null)
        ) {
            // Rechercher le ticket dont le voyage a changé 
            const refRemplacer_1 = ticketsRes.data ? ticketsRes.data.refvoyageremplacement : 'NON TROUVER'
            const siegeRemplacer_1 = ticketsRes.data ? ticketsRes.data.newnumsiege : 'NON TROUVER'

            const refRemplacer_2 = siegesSupRes.data ? siegesSupRes.data.refvoyageremplacement : 'NON TROUVER'
            const siegeRemplacer_2 = siegesSupRes.data ? siegesSupRes.data.newnumsiege : 'NON TROUVER'

            const [autreTicket, autreTicketSup] = await Promise.all([
                supabase
                    .from('tickets')
                    .select('refvoyage, numsiege, destination, newnumsiege, ref_voyages (matcar, carremplacement)')
                    .eq('refvoyage', refRemplacer_1)
                    .eq('numsiege', siegeRemplacer_1)
                    .maybeSingle(),
                supabase
                    .from('sieges_supplementaires')
                    .select('refvoyage, numsiege, destination, newnumsiege, ref_voyages (matcar, carremplacement)')
                    .eq('refvoyage', refRemplacer_2)
                    .eq('numsiege', siegeRemplacer_2)
                    .maybeSingle(),
            ])
            if (autreTicket.error || autreTicketSup.error) {
                console.error("Erreur lors de la récupération des données : ", { autreTicket, autreTicketSup })
                return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
            }
            // Vérifier l'existence du ticket
            console.log("refRemplacer_1 : ", refRemplacer_1)
            console.log("siegeRemplacer_1 : ", siegeRemplacer_1)
            console.log("refRemplacer_2 : ", refRemplacer_2)
            console.log("siegeRemplacer_2 : ", siegeRemplacer_2)

            console.log("autreTicket : ", autreTicket)
            console.log("autreTicketSup : ", autreTicketSup)
            if (
                (!autreTicket.data && !autreTicketSup.data) ||
                (autreTicket.data.length === 0 && autreTicketSup.data.length === 0)
            ) {
                return res.status(400).json({ success: false, message: "Ticket non trouvé !" });
            }

            // Extraire le matCar en priorisant carremplacement s'il existe
            const refVoyagesTicket = autreTicket?.data?.ref_voyages;
            const refVoyagesSupp = autreTicketSup?.data?.ref_voyages;
            const matCar = refVoyagesTicket?.carremplacement ?? refVoyagesTicket?.matcar ??
                refVoyagesSupp?.carremplacement ?? refVoyagesSupp?.matcar;

            // Vérifier que le ticket est consommé
            const ticketConsommer = Boolean(autreTicket?.data?.ticketconsommer || autreTicketSup?.data?.ticketconsommer);
            const utiliser = ticketConsommer ? "OUI" : "NON";

            // Construire la réponse
            const messageResponse = "Nvlle ref : " + ticketsRes.data.refvoyageremplacement + 
                "\nmatricule car : " + matCar + 
                "\nNuméro de siege : " + ticketsRes.data.newnumsiege + 
                "\nTicket utilisé ? : " + utiliser;

            return res.status(403).json({ success: false, message: messageResponse, newref : true }) 
        }

        const ticket = ticketsRes.data ? ticketsRes.data : siegesSupRes.data 
        return res.status(200).json({
            success: true,
            ticket: ticket,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})

// Cas 2-b : Enregistrer comme ticket consommé (comparaison mannuelle) 
router.put('/consommer-ticket', async (req, res) => {
    const { numSiege, refVoyage, matControleurTicket } = req.body

    try {
        if (!numSiege || !refVoyage) {
            return res.status(400).json({ success: false, message: "Références manquantes !" })
        }

        // Le modifier tickets.ticketconsommer = true
        const [consomTickets, consomSiegesSup] = await Promise.all([
            supabase
                .from('tickets')
                .update({ ticketconsommer: true, matcontroleurticket : matControleurTicket })
                .eq('refvoyage', refVoyage)
                .eq('numsiege', numSiege)
                .eq('ticketconsommer', false)
                .select()
                .maybeSingle(),
            supabase
                .from('sieges_supplementaires')
                .update({ ticketconsommer: true, matcontroleurticket : matControleurTicket })
                .eq('refvoyage', refVoyage)
                .eq('numsiege', numSiege)
                .eq('ticketconsommer', false)
                .select()
                .maybeSingle(),
        ])
        if (consomTickets.error || consomSiegesSup.error) {
            console.error("Erreur lors de l'enregistrement des données : ", { consomTickets, consomSiegesSup });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }
        console.log("consomTickets : ", consomTickets)
        console.log("consomSiegesSup : ", consomSiegesSup)
        // return
        if (
            ((!consomTickets || consomTickets.data === null) &&
                (!consomSiegesSup || consomSiegesSup.data === null)) ||
            ((consomTickets.data && consomTickets.data.ticketconsommer === false) ||
                (consomSiegesSup.data && consomSiegesSup.data.ticketconsommer === false))
        ) {
            return res.status(400).json({ success: false, message: "Ticket déjà utilisé ou validé." });
        }

        const ticket = consomTickets.data ? consomTickets.data : consomSiegesSup.data

        return res.status(202).json({
            success: true,
            message: "Ticket validé !",
            ticket: ticket,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})

// 3- Marquer les absents
router.put("/marquer-les-absents", async (req, res) => {
    const { tabNumSieges, refVoyage, matControleurTicket } = req.body

    try {
        // Vérifier que tabNumSieges est bien un tableau non vide
        if (!Array.isArray(tabNumSieges) || tabNumSieges.length === 0) {
            return res.status(400).json({ success: false, message: "Aucun ticket choisi !!" })
        }
        if (!refVoyage) {
            return res.status(400).json({ success: false, message: "Vous devez spécifier un voyage." })
        }

        // Passer directement à la modification
        const [ticketsRes, siegesSupRes] = await Promise.all([
            supabase
                .from('tickets')
                .update({ siegevacant: true, ticketconsommer: false, matcontroleurticket : matControleurTicket })
                .eq('refvoyage', refVoyage)
                .in('numsiege', tabNumSieges)
                .is('refvoyageremplacement', null)
                .eq('siegevacant', false)
                .select(),
            supabase
                .from('sieges_supplementaires')
                .update({ siegevacant: true, ticketconsommer: false, matcontroleurticket : matControleurTicket })
                .eq('refvoyage', refVoyage)
                .in('numsiege', tabNumSieges)
                .is('refvoyageremplacement', null)
                .eq('siegevacant', false)
                .order('dateticket', { ascending: false })
                .select()
        ]);
        if (ticketsRes.error || siegesSupRes.error) {
            console.error("Erreur lors de la récupération des données : ", { ticketsRes, siegesSupRes });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }

        if (
            (ticketsRes.data && ticketsRes.data.siegevacant === false) &&
            (siegesSupRes.data && siegesSupRes.data.siegevacant === false)
        ) {
            return res.status(401).json({ success: false, message: "Modification non effectuée. Veuillez réessayer." })
        }

        const tickets = (ticketsRes.data) ? ticketsRes.data : siegesSupRes.data

        return res.status(202).json({
            success: true,
            message: "Marqué absent avec succès!!",
            tickets: tickets,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})


// 4- API générale : 
// vérifier tickets, bagages, colis, retraits_colis, colismodifiers, colisannulers, colisretours, convois 
router.get('recherche-generale/:reference/:id/:nature', async (req, res) => {
    const { reference, id, nature = "tickets" } = req.params

    try {

        if (nature === "tickets") {
            // Vérification si l'ID est un UUID valide
            if (!isValidUUID(id)) {
                return res.status(400).json({ success: false, message: "Ticket invalide !" });
            }
            const [ticketsRes, siegesSupRes] = await Promise.all([
                supabase
                    .from('tickets')
                    .select('*')
                    .eq('id', String(id))
                    .eq('refvoyage', reference)
                    .maybeSingle(),
                supabase
                    .from('sieges_supplementaires')
                    .select('*')
                    .eq('id', String(id))
                    .eq('refvoyage', reference)
                    .maybeSingle(),
            ]);
            if (ticketsRes.error || siegesSupRes.error) {
                console.error("Erreur lors de la récupération des données : ", { ticketsRes, siegesSupRes });
                return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
            }

            // Vérifier l'existence du ticket
            if (
                (!ticketsRes.data && !siegesSupRes.data) ||
                (ticketsRes.data.length === 0 && siegesSupRes.data.length === 0)
            ) {
                return res.status(400).json({ success: false, message: "Ticket invalide !" });
            }

            //retourner le résultat
            const ticket = ticketsRes.data ? ticketsRes.data : siegesSupRes.data
            return res.status(200).json({
                success: true,
                ticket: ticket,
            })

        } else if (nature === "bagages") {


        } else if (nature === "colis") {


        } else if (nature === "retraits_colis") {


        } else if (nature === "colismodifiers") {


        } else if (nature === "colisannulers") {

        } else if (nature === "colisretours") {

        } else if (nature === "convois") {

        }

    } catch (error) {
        console.error("Erreur lors de la vérification : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
});

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

module.exports = router