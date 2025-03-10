const express = require('express')
const supabase = require('./../supabase')
const multer = require("multer"); // Stockage temporaire (uploader) des fichiers (images)
const fs = require('fs');
const path = require('path');
const { body, validationResult } = require('express-validator');
const { genereCodeSecret } = require('./utils');
const bcrypt = require('bcrypt')

const router = express.Router()


// 1-a Liste des refVoyages "disponibles"
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
                heurereservation
            `)
            .eq('iddepartement', idDepartement)
            .eq('disponible', true)
            // .gte('daterefvoyage', today.toISOString()) 
            .order('refvoyage', { ascending: false });

        if (refVoyagesError) {
            console.error("Erreur lors de la récupération des données :", refVoyagesError);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!refVoyages || refVoyages.length === 0) {
            return res.status(400).json({ success: false, message: "Le département indiqué est incorrect ou aucun voyage disponible." });
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
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


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

//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 2- Créer code colis. Exple : CAD1-2025020945-TRV
router.post('/creer-code-colis/:codeGare/:codeDestination', async (req, res) => {
    const { codeGare, codeDestination } = req.params;

    // Validation des paramètres
    if (!codeGare || !codeDestination) {
        return res.status(400).json({ success: false, message: "Vous devez choisir la gare et la destination" });
    }

    // Validation des paramètres pour éviter des injections
    const regexCodeGare = /^[A-Za-z0-9]+$/; // Exemple d'expression régulière pour valider les codes
    const regexCodeDestination = /^[A-Za-z0-9]+$/;

    if (!regexCodeGare.test(codeGare) || !regexCodeDestination.test(codeDestination)) {
        return res.status(400).json({ success: false, message: "Les codes gare et destination doivent être alphanumériques." });
    }

    try {
        //Compter le nombre de colis du jour pour la gare 
        const today = new Date();
        const dateDebut = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0); // Début de la journée
        const dateFin = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999); // Fin de la journée

        // Exécuter les requêtes en parallèle
        const [{ data: findGare, error: errorFind }, { count: nbreColis, error: errorNbre }] = await Promise.all([
            supabase
                .from('gares')
                .select('*')
                .eq('codegare', codeGare),
            supabase
                .from('colis')
                .select('', { count: 'exact' })  // On ne récupère que le nombre
                .eq('codegare', codeGare)
                .gte('datecolis', dateDebut.toISOString()) // >= Début du jour
                .lte('datecolis', dateFin.toISOString()), // <= Fin du jour
        ]);
        if (errorFind || errorNbre) {
            console.error("Erreur lors de la récupération des données : ", { errorFind, errorNbre });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!findGare || findGare.length === 0) {
            return res.status(404).json({ success: false, message: "Gare non trouvée." });
        }

        // Si aucun colis trouvé, assigner 1 par défaut
        const colisCount = nbreColis === 0 ? 1 : nbreColis + 1;

        // Formater le nombre de colis à 3 caractères
        const formattedNbreColis = String(colisCount).padStart(3, '0');

        // Créer la date au format AAAAMMJJ
        const dateJour = new Date();
        const dateFormatJour = formatDateToString(dateJour);

        // Créer le code colis final
        const codeColis = `C${codeGare}-${dateFormatJour}${formattedNbreColis}-${codeDestination}`;

        return res.status(201).json({
            success: true,
            codecolis: codeColis,
        });
    } catch (err) {
        console.error("Erreur interne :", err);
        return res.status(500).json({ success: false, message: "Une erreur est survenue, veuillez réessayer plus tard." });
    }
});

// Fonction de formatage de la date au format AAAAMMJJ
function formatDateToString(date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}${month}${day}`;
}
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


//3- CREATION DU COLIS
// Configuration de Multer (Stockage temporaire des fichiers)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'imageColis/');  // Stockage temporaire local
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname); // Nom unique
    }
});
const upload = multer({ storage });

/**
 * Fonction pour uploader un fichier sur Supabase Storage.
 * @param {string} filePath - Chemin du fichier à uploader.
 * @returns {string} - URL du fichier stocké.
 */
async function uploadToSupabase(filePath) {
    try {
        const bucketName = 'images';
        const folderName = 'colis';
        const fileName = path.basename(filePath);

        // Lire le fichier en mode stream (optimisé pour gros fichiers)
        const fileStream = fs.createReadStream(filePath);

        // Envoyer le fichier à Supabase Storage
        const { data, error } = await supabase
            .storage
            .from(bucketName)
            .upload(`${folderName}/${fileName}`, fileStream, {
                contentType: 'image/jpeg',
                duplex: 'half',
                upsert: true,  // écraser une image du même nom
            });

        if (error) throw error;

        // Générer l'URL publique
        return `${supabase.storageUrl}/object/public/${bucketName}/${folderName}/${fileName}`;

    } catch (error) {
        console.error("Erreur lors de l'upload sur Supabase:", error);
        throw error;
    }
}

// Enregistrement du colis
router.post(
    '/creer-colis',
    upload.single("photoColis"),
    [
        body('codeColis').notEmpty().withMessage("Le code colis est requis."),
        body('valeurEstimee').notEmpty().withMessage("La valeur estimée est requise."),
        body('prixColis').notEmpty().withMessage("Le prix du colis est requise."),
        body('nomExpediteur').notEmpty().withMessage("Le nom de l'expéditeur est requis."),
        body('contactExpediteur').notEmpty().withMessage("Le contact de l'expéditeur est requis."),
        body('nomDestinataire').notEmpty().withMessage("Le nom du destinataire est requis."),
        body('contactDestinataire').notEmpty().withMessage("Le contact du destinataire est requis."),
        body('destination').notEmpty().withMessage("La destination est requise."),
        body('codeGare').notEmpty().withMessage("Le code de la gare est requis."),
        body('matGestionnaireColis').notEmpty().withMessage("Le matricule du gestionnaire est requis."),
    ],
    async (req, res) => {
        // Vérification des erreurs de validation
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const { codeClient = null, lienImage = null } = req.query
        const {
            codeColis,
            valeurEstimee,
            prixColis,
            description,
            nomExpediteur,
            contactExpediteur,
            nomDestinataire,
            contactDestinataire,
            destination,
            codeGare,
            matGestionnaireColis,
        } = req.body;

        try {
            let photoUrl = null;

            if (req.file) {
                photoUrl = await uploadToSupabase(req.file.path);
                fs.unlinkSync(req.file.path); // Supprime le fichier temporaire après l'upload
            }

            // Insertion en base de données
            const { data: enrgColis, error: errorEnrg } = await supabase
                .from('colis')
                .insert({
                    codecolis: codeColis,
                    valeurestimee: parseInt(valeurEstimee, 10),
                    prixcolis: parseInt(prixColis, 10),
                    description,
                    photocolis: photoUrl ? photoUrl : lienImage,
                    codeclient: codeClient ? codeClient : null,
                    nomexpediteur: nomExpediteur,
                    contactexpediteur: contactExpediteur,
                    nomdestinataire: nomDestinataire,
                    contactdestinataire: contactDestinataire,
                    destination,
                    codegare: codeGare,
                    matgestionnairecolis: matGestionnaireColis,
                })
                .select()
                .maybeSingle();

            if (errorEnrg) {
                console.error("Erreur lors de la création du colis :", errorEnrg);

                if (errorEnrg.message.includes("duplicate key value violates unique constraint")) {
                    if (errorEnrg.message.includes("colis_codecolis_key")) {
                        return res.status(400).json({ success: false, message: "Ce colis existe déjà dans la base de données." });
                    }
                }
                // Dans le cas contraire
                return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
            }

            if (!enrgColis) {
                return res.status(400).json({ success: false, message: "Enregistrement non effectué." });
            }

            return res.status(201).json({
                success: true,
                message: "Colis enregistré avec succès !",
                colis: enrgColis,
            });
        } catch (error) {
            console.error("Erreur lors de l'enregistrement du colis :", error);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
    }
);
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 4-a Chercher un Expéditeur
router.get('/trouve-expediteur', async (req, res) => {
    const { contactExpediteur } = req.query

    try {
        let infosClient = {}

        // Formater l'année en cours
        const year = new Date().getFullYear();
        const startOfYear = `${year}-01-01T00:00:00Z`;

        // Nbre de colis dans l'année
        const { count: nbreColis, error: errorNbre } = await supabase
            .from('colis')
            .select('*', { count: 'exact' })
            .eq('contactexpediteur', contactExpediteur)
            .gte('datecolis', startOfYear);

        if (errorNbre) {
            console.error("Erreur lors de la récupération des données :", errorNbre);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        // Affecter le nbre de colis
        infosClient.nbrecolis = nbreColis

        // Rechercher le client dans `colis (expediteur)`
        const { data: clientColis, error: errorClientColis } = await supabase
            .from('colis')
            .select('nomexpediteur, codeclient')
            .eq('contactexpediteur', contactExpediteur)
            .order('nomexpediteur', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (errorClientColis) {
            console.error("Erreur lors de la récupération des données :", errorClientColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!clientColis || clientColis.length === 0) { // Il n'est pas dans 'colis'
            //Le rechercher alors dans `clients_fideles`
            const { data: clientMDT, error: errorClient } = await supabase
                .from('clients_fideles')
                .select(`nomclient, codeclient`)
                .eq('contactclient', contactExpediteur)
                .order('nomclient', { ascending: false })
                .maybeSingle();

            if (errorClient) {
                console.error("Erreur lors de la récupération des données :", errorClient);
                return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
            }

            if (!clientMDT || clientMDT.length === 0) {
                return res.status(400).json({ success: false, message: "Aucun client trouvé." });
            }

            //Récupérer les infos du client
            infosClient.nomclient = clientMDT.nomclient
            infosClient.codeclient = clientMDT.codeclient

        } else if (clientColis) { // Par contre, s'il est trouvé dans colis, alors :
            //Récupérer les infos du client
            infosClient.nomclient = clientColis.nomexpediteur
            infosClient.codeclient = clientColis.codeclient
        }

        // Retourner finalement les données
        return res.status(200).json({
            success: true,
            client: infosClient,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++


// 4-b Chercher un Destinataire
router.get('/trouve-destinataire', async (req, res) => {
    const { contactDestinataire } = req.query

    try {
        const infosClient = {}

        // Rechercher le client dans `colis (destinataire)`
        const { data: clientColis, error: errorClientColis } = await supabase
            .from('colis')
            .select('nomdestinataire')
            .eq('contactdestinataire', contactDestinataire)
            .order('nomdestinataire', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (errorClientColis) {
            console.error("Erreur lors de la récupération des données :", errorClientColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!clientColis || clientColis.length === 0) { // Il n'est pas dans 'colis'
            //Le rechercher alors dans `clients_fideles`
            const { data: clientMDT, error: errorClient } = await supabase
                .from('clients_fideles')
                .select(`nomclient`)
                .eq('contactclient', contactDestinataire)
                .order('nomclient', { ascending: false })
                .maybeSingle();

            if (errorClient) {
                console.error("Erreur lors de la récupération des données :", errorClient);
                return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
            }

            if (!clientMDT || clientMDT.length === 0) {
                return res.status(400).json({ success: false, message: "Aucun client trouvé." });
            }

            //Récupérer les infos du client
            infosClient.nomclient = clientMDT.nomclient

        } else if (clientColis) { // Par contre, s'il est trouvé dans colis, alors :
            //Récupérer les infos du client
            infosClient.nomclient = clientColis.nomdestinataire
        }

        // Retourner finalement les données
        return res.status(200).json({
            success: true,
            client: infosClient,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


//5- Lister les colis enregistrés non expédiés (qui n'ont pas de refvoyage ni refenvoie)
router.get('/liste-colis-non-ref/:codeGare', async (req, res) => {
    const { codeGare } = req.params

    try {
        const { data: colisToSend, error: errorColis } = await supabase
            .from('colis')
            .select('*')
            .eq('codegare', codeGare)
            .eq('colisannuler', false)
            .or(`refvoyage.is.null, refenvoie.is.null`)

        if (errorColis) {
            console.error("Erreur lors de la récupération des données : ", errorColis)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!colisToSend || colisToSend.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis trouvé." })
        }

        // Appliquer le tri personnalisé en JavaScript
        colisToSend.sort((a, b) => {
            // D'abord, placer les colis avec refvoyage != null et refenvoie == null en premier
            if (a.refvoyage !== null && a.refenvoie === null && !(b.refvoyage !== null && b.refenvoie === null)) {
                return -1;
            }
            if (b.refvoyage !== null && b.refenvoie === null && !(a.refvoyage !== null && a.refenvoie === null)) {
                return 1;
            }
            // Ensuite, trier tous les colis par codecolis en ordre croissant
            return a.codecolis.localeCompare(b.codecolis);
        });

        //Retourner les colis
        return res.status(200).json({
            success: true,
            colis: colisToSend,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++



// 6- MODIFIER : Affecter des refvoyage et refenvoie si non null au colis à éxpédier
router.put('/affecter-references/:codeGare', async (req, res) => {
    const { codeGare } = req.params;
    const { tabCodeColis, refVoyage = null, refEnvoie = null } = req.body;

    try {
        if (!refEnvoie && !refVoyage) {
            return res.status(400).json({ success: false, message: "Aucune référence n'a été sélectionnée !" });
        }

        if (!Array.isArray(tabCodeColis) || tabCodeColis.length === 0) {
            return res.status(400).json({ success: false, message: "Aucun colis n'a été sélectionné !" });
        }

        const date_envoie = new Date();

        const { data: infosColis, error: errorInfosColis } = await supabase
            .from('colis')
            .select('codecolis, refvoyage, refenvoie, envoyer, dateenvoie')
            .in('codecolis', tabCodeColis)
            .eq('codegare', codeGare);

        if (errorInfosColis) {
            console.error("Erreur lors de la récupérations des données :", errorInfosColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!infosColis || infosColis.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis trouvé." });
        }

        let colisModifies = [];
        let reference_nonAffecter = 0
        let reference_Affecter = 0
        for (const colis of infosColis) {
            if (colis.refvoyage === null) { // On lui affecte refvoyage et éventuellement refenvoie et dateenvoie 
                const { data: update, error: errorUpdate } = await supabase
                    .from('colis')
                    .update({
                        refvoyage: refVoyage,
                        refenvoie: ((refEnvoie && refVoyage) || (refEnvoie && colis.refvoyage)) ? refEnvoie : null,
                        envoyer: ((refEnvoie && refVoyage) || (refEnvoie && colis.refvoyage)) ? true : false,
                        dateenvoie: ((refEnvoie && refVoyage) || (refEnvoie && colis.refvoyage)) ? date_envoie : null,
                    })
                    .eq('codecolis', colis.codecolis)
                    .eq('colisannuler', false)
                    .eq('envoyer', false)
                    .eq('colisrecu', false)
                    .eq('colisretirer', false)
                    .eq('colisretourner', false)
                    .is('refvoyage', null)
                    .is('refenvoie', null)
                    .select()

                if (errorUpdate) {
                    console.error("Erreur lors de la mise à jour : ", errorUpdate);
                    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
                }

                // Vérifier mannuellemnt s'il y a une modification 
                if (
                    update.length === 0 ||
                    (
                        colis.refvoyage === update[0].refvoyage &&
                        colis.refenvoie === update[0].refenvoie &&
                        colis.envoyer === update[0].envoyer &&
                        colis.dateenvoie?.toISOString() === update[0].dateenvoie?.toISOString()
                    )
                ) {
                    reference_nonAffecter++
                } else {  // Il y a eu modification, alors :
                    reference_Affecter++
                    colisModifies = colisModifies.concat(update);
                }


            } else if (colis.refvoyage !== null && colis.refenvoie === null && colis.envoyer === false) { // On lui affecte refenvoie et dateenvoie
                const { data: update, error: errorUpdate } = await supabase
                    .from('colis')
                    .update({
                        refenvoie: refEnvoie,
                        envoyer: ((!refVoyage && refEnvoie) || (refVoyage && refEnvoie)) ? true : false,
                        dateenvoie: ((!refVoyage && refEnvoie) || (refVoyage && refEnvoie)) ? date_envoie : null,
                    })
                    .eq('codecolis', colis.codecolis)
                    .eq('colisannuler', false)
                    .eq('envoyer', false)
                    .eq('colisrecu', false)
                    .eq('colisretirer', false)
                    .eq('colisretourner', false)
                    .is('refenvoie', null)
                    .select();

                if (errorUpdate) {
                    console.error("Erreur lors de la mise à jour : ", errorUpdate);
                    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
                }

                // Vérifier mannuellemnt s'il y a une modification 
                if (
                    update.length === 0 ||
                    (
                        colis.refvoyage === update[0].refvoyage &&
                        colis.refenvoie === update[0].refenvoie &&
                        colis.envoyer === update[0].envoyer &&
                        colis.dateenvoie?.toISOString() === update[0].dateenvoie?.toISOString()
                    )
                ) {
                    reference_nonAffecter++
                } else { // Il y a eu modification, alors :
                    reference_Affecter++
                    colisModifies = colisModifies.concat(update);
                }

            } else if (colis.refenvoie !== null && colis.refenvoie !== null) {
                return res.status(400).json({
                    success: false,
                    message: `Colis ou montant déjà ajoutés au nombre des expédiés !`
                })
            } else { // Tout autre cas inattendu
                return res.status(400).json({
                    success: false,
                    message: `Aucun colis ou montant ajouté au nombre des expédiés !`
                })
            }
        }

        // Retourner les résultats
        if (reference_Affecter === infosColis.length && reference_nonAffecter === 0) { // Tous les colis sont modifiés

            return res.status(201).json({
                success: true,
                message: "Colis ou montants ajoutés au nombre des expédiés avec succès !",
                colis: colisModifies,
            });
        } else if (reference_nonAffecter === infosColis.length && reference_Affecter === 0) { //Aucune modification
            return res.status(400).json({
                success: false,
                message: `Aucun colis ou montant ajouté au nombre des expédiés !`
            })
        } else if (reference_nonAffecter > 0) { // Certains colis sont modifiés, mais pas tous.
            return res.status(400).json({
                success: false,
                message: `Certains colis ou montants non ajoutés au nombre des expédiés !`,
                colis: colisModifies,
            })
        }

    } catch (error) {
        console.error("Erreur lors de l'affectation des références :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 7- Rechercher un/des colis dans le but d'effectuer un retrait-colis
router.get('/rechercher-colis/', async (req, res) => {
    const { codeColis, contactDestinataire, destination } = req.query;
    const contactExpediteur = contactDestinataire

    try {
        let query = supabase
            .from('colis')
            .select('*, gares (nomgare)')
            .eq('colisrecu', true)
            .eq('colisretirer', false) // Car on veut les retirer justement
            .eq('colisintrouvable', false) // Se rassurer qu'on a le colis (reçu ou retrouvé)
            .eq('colisannuler', false) // Se rassurer qu'il ne s'agit pas d'un colis annulé
            .eq('destination', destination)

        // Requête multicritères
        if (codeColis) {
            query = query.eq('codecolis', codeColis);
        }
        if (contactDestinataire) {
            query = query.or(`contactdestinataire.eq.${contactDestinataire}, contactexpediteur.eq.${contactExpediteur}`)
        }

        // Toujours trier par datecolis (si pertinent)
        query = query.order('datecolis', { ascending: false });

        // Exécution de la requête
        const { data: reqColis, error: errorReq } = await query;

        // Gestion des erreurs
        if (errorReq) {
            console.error("Erreur lors de la récupération des données :", errorReq);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!reqColis || reqColis.length === 0) {
            return res.status(404).json({ success: false, message: "Colis non trouvé !" });
        }

        // Vérification et transformation en tableau si nécessaire
        const listeColis = Array.isArray(reqColis) ? reqColis : [reqColis];

        const colistrouves = listeColis.map(item => ({
            id: item.id,
            codecolis: item.codecolis,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixcolis: item.prixcolis,
            description: item.description,
            codeclient: item.codeclient,
            nomexpediteur: item.nomexpediteur,
            contactexpediteur: item.contactexpediteur,
            nomdestinataire: item.nomdestinataire,
            contactdestinataire: item.contactdestinataire,
            destination: item.destination,
            datecolis: item.datecolis,
            photocolis: item.photocolis,
            codegare: item.codegare,
            nomgare: item.gares?.nomgare, // Ajout du ? pour éviter une erreur si gares est undefined
            matgestionnairecolis: item.matgestionnairecolis,
            envoyer: item.envoyer,
            colisrecu: item.colisrecu,
            colisretirer: item.colisretirer,
            colisintrouvable: item.colisintrouvable,
        }));

        return res.status(200).json({
            success: true,
            colis: colistrouves,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++



// 8- Montant des colis d'un voyage
router.get('/montant-colis-voyage/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params;
    const { codeGare } = req.query;

    try {
        let query = supabase
            .from('colis')
            .select(`*, ref_voyages (matcar, nomconducteur, carremplacement, conducteurremplacement)`)
            .eq('refvoyage', refVoyage)
            .eq('colisannuler', false)
            .order('refvoyage', { ascending: false });

        // Requêtes multicritères
        if (codeGare) {
            query = query.eq('codegare', codeGare)
        }

        // Exécution de la requête
        const { data: listeColis, error: errorListe } = await query

        if (errorListe) {
            console.error("Erreur lors de la récupération des données : ", errorListe);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!listeColis || listeColis.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis trouvé." });
        }

        const infosColis = listeColis.map(item => ({
            codecolis: item.codecolis,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            prixcolis: item.prixcolis,
            description: item.description,
            destination: item.destination,
            datecolis: item.datecolis,
            photocolis: item.photocolis,
            codegare: item.codegare,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
        }));

        // Calcul du montant total
        const montant = infosColis.reduce((total, item) => total + (item.prixcolis || 0), 0);

        return res.status(200).json({
            success: true,
            nbrecolis: infosColis.length,
            montcolis: montant,
            listecolis: infosColis,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


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

//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 10- Liste des colis (uniquement) dans le car
router.get('/autres-colis-car/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params;
    const { codeGare } = req.query;

    try {
        let query = supabase
            .from('colis')
            .select(`*, ref_voyages (matcar, nomconducteur, carremplacement, conducteurremplacement)`)
            .eq('refenvoie', refVoyage)
            .eq('envoyer', true)
            .eq('colisannuler', false)
            .order('refvoyage', { ascending: false });

        if (codeGare) {
            query = query.eq('codegare', codeGare)
        }

        // Exécution de la requête
        const { data: listeColis, error: errorListe } = await query

        // Gestion des erreurs
        if (errorListe) {
            console.error("Erreur lors de la récupération des données : ", errorListe);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!listeColis || listeColis.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis trouvé." });
        }

        const infosColis = listeColis.map(item => ({
            codecolis: item.codecolis,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            prixcolis: item.prixcolis,
            description: item.description,
            destination: item.destination,
            datecolis: item.datecolis,
            photocolis: item.photocolis,
            codegare: item.codegare,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
        }));

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

//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 11- Liste des colis en cours, colis à recevoir pour une gare
router.get('/colis-en-cours/', async (req, res) => {
    const { nomGare } = req.query;

    try {
        // Retrouver les refvoyages non disponibles (donc libérés, en cours, sorties de la gare) dans ref_voayges
        const { data: voyagesIndisponibles, error: errorVoyages } = await supabase
            .from('ref_voyages')
            .select('refvoyage')
            .eq('disponible', false)
            .order('daterefvoyage', { ascending: false })
            .limit(200);


        if (errorVoyages) {
            console.error("Erreur lors de la récupération des voyages indisponibles :", errorVoyages);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!voyagesIndisponibles || voyagesIndisponibles.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage indisponible trouvé." });
        }

        // Extraire les valeurs des refvoyage dans un tableau
        const refVoyagesList = voyagesIndisponibles.map(voyage => voyage.refvoyage);

        if (refVoyagesList.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis en cours pour votre gare." });
        }

        // Retrouver les colis dont les refenvoie correspondent aux valeurs de refVoyagesList
        const { data: enCours, error: errorEncours } = await supabase
            .from('colis')
            .select(`
                refenvoie, codecolis, valeurestimee, prixcolis, description, photocolis, destination, 
                datecolis, nomexpediteur, contactexpediteur, nomdestinataire, contactdestinataire,
                ref_voyages!inner (
                    matcar, nomconducteur, carremplacement, conducteurremplacement,
                    departements!inner (nomdepartement)
                ),
                gares!inner (codegare, nomgare)
            `)
            .in('refenvoie', refVoyagesList) // On filtre refenvoie qui correspond à un refvoyage indisponible
            .eq('destination', nomGare)
            .eq('envoyer', true)
            .eq('colisrecu', false)
            .eq('colisintrouvable', false)
            .neq('refenvoie', null)
            .order('refenvoie', { ascending: false })
            .order('codecolis', { ascending: true });

        if (errorEncours) {
            console.error("Erreur lors de la récupération des données :", errorEncours);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!enCours || enCours.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis en cours pour votre gare." });
        }

        // Regrouper les colis
        const groupedColis = enCours.reduce((acc, item) => {
            const key = `${item.refenvoie}-${item.ref_voyages?.departements?.nomdepartement}`;

            if (!acc[key]) {
                acc[key] = {
                    // refvoyage : item.refvoyage,
                    refenvoie: item.refenvoie,
                    matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
                    nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur,
                    departement: item.ref_voyages?.departements?.nomdepartement,
                    destination: item.destination,
                    nbrecolis: 0,
                    listecolis: []
                };
            }

            acc[key].listecolis.push({
                codecolis: item.codecolis,
                valeurestimee: item.valeurestimee,
                prixcolis: item.prixcolis,
                description: item.description,
                photocolis: item.photocolis,
                datecolis: item.datecolis,
                codegare: item.gares?.codegare,
                nomgare: item.gares?.nomgare,
                nomexpediteur: item.nomexpediteur,
                contactexpediteur: item.contactexpediteur,
                nomdestinataire: item.nomdestinataire,
                contactdestinataire: item.contactdestinataire,
            });

            // Calculer le nombre de colis pour une voyage
            acc[key].nbrecolis = acc[key].listecolis.length;

            return acc;
        }, {});

        // Convertir l'objet en tableau
        const colisFinal = Object.values(groupedColis);

        return res.status(200).json({
            success: true,
            nbrecars: colisFinal.length,
            data: colisFinal,
        });


    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//+++++++++++++++++++++++++++++++++++++++++++++++++++


// 12- Enregistrer colis reçus : Modification de la table colis
router.put('/enreg-colis-recu', async (req, res) => {
    const { tabCodeColis } = req.body;

    try {
        if (!Array.isArray(tabCodeColis) || tabCodeColis.length === 0) {
            return res.status(400).json({ success: false, message: "Aucun colis sélectionné !" });
        }

        // Vérifier si les colis sont bien envoyés
        const { data: colisEnvoyer, error: errorColisEnvoyer } = await supabase
            .from('colis')
            .select('codecolis')
            .in('codecolis', tabCodeColis)
            .eq('envoyer', true)
            .eq('colisannuler', false)
            .eq('colisrecu', false) // Car on veut justement l'enregistrer comme étant reçu maintenant
            .eq('colisretirer', false)
            .eq('colisretourner', false)

        if (errorColisEnvoyer) {
            console.error("Erreur lors de la récupération des données :", errorColisEnvoyer);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        // Vérifier que tous les colis envoyés par l'utilisateur sont 'envoyer = true'
        if (tabCodeColis.length !== colisEnvoyer.length) {
            return res.status(404).json({
                success: false,
                message: "Certains colis ne sont pas encore envoyés, impossible de procéder à la reception."
            });
        }


        // Mettre à jour tous les colis spécifiés dans tabCodeColis
        const { data: receptColis, error: errorRecept } = await supabase
            .from('colis')
            .update({ colisrecu: true, daterecu: new Date(), colisintrouvable: false }) // Il n'est pas/plus 'introuvable'
            .in('codecolis', tabCodeColis)  // Sélection des colis à mettre à jour
            .eq('colisannuler', false)
            .select();

        if (errorRecept) {
            console.error("Erreur lors de la mise à jour :", errorRecept);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!receptColis || receptColis.length === 0) {
            return res.status(400).json({ success: false, message: "Aucun colis enregistré. Veuillez reprendre svp." });
        }

        return res.status(200).json({
            success: true,
            message: "Colis reçus enregistrés avec succès !",
            listecolis: receptColis,
        });

    } catch (error) {
        console.error("Erreur lors de la mise à jour des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++



// 13- Lister les colis reçus
router.get('/liste-colis-recus/:nomGare', async (req, res) => {
    const { nomGare } = req.params
    const {
        codeColis,
        contactDestinataire,
        contactExpediteur,
        matCar,
        dateRecu
    } = req.query

    // Assurer que dateRecu est bien formatée
    const dateFiltre = dateRecu ? new Date(dateRecu).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]

    try {
        let query = supabase
            .from('colis')
            .select(`
            *,
            ref_voyages!inner (matcar, nomconducteur, carremplacement, conducteurremplacement),
            gares!inner (codegare, nomgare)
        `)
            .eq('destination', nomGare)
            .eq('envoyer', true)
            .eq('colisrecu', true)
            .eq('colisretirer', false)
            .eq('colisintrouvable', false)
            .eq('colisannuler', false)
            // .gte('daterecu', new Date(dateFiltre).toISOString().split('T')[0])  
            .order('daterecu', { ascending: false })
            .order('datecolis', { ascending: true })
            .limit(100);

        // **Critères optionnels**
        if (codeColis) query = query.eq('codecolis', codeColis);
        if (contactDestinataire) query = query.eq('contactdestinataire', contactDestinataire);
        if (contactExpediteur) query = query.eq('contactexpediteur', contactExpediteur);
        if (matCar) query = query.eq('ref_voyages.matcar', matCar);

        // **Exécution de la requête**
        const { data: colisRecus, error: errorColis } = await query;

        // **Gestion des erreurs**
        if (errorColis) {
            console.error("Erreur lors de la récupération des données :", errorColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!colisRecus || colisRecus.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis reçu trouvé." });
        }


        // Réorganiser les données
        const colis = colisRecus.map(item => ({
            refenvoie: item.refenvoie,
            codecolis: item.codecolis,
            valeurestimee: item.valeurestimee,
            prixcolis: item.prixcolis,
            destination: item.destination,
            datecolis: item.datecolis,
            description: item.description,
            photocolis: item.photocolis,
            contactexpediteur: item.contactexpediteur,
            nomexpediteur: item.nomexpediteur,
            contactdestinataire: item.contactdestinataire,
            nomdestinataire: item.nomdestinataire,
            daterecu: item.daterecu,
            matcar: (item.ref_voyages?.carremplacement) ? item.ref_voyages?.carremplacement : item.ref_voyages?.matcar,
            nomconducteur: (item.ref_voyages?.conducteurremplacement) ? item.ref_voyages?.conducteurremplacement : item.ref_voyages?.nomconducteur,
            nomgare: item.gares.nomgare,
            codegare: item.gares.codegare
        }))

        return res.status(200).json({
            success: true,
            nbrecolis: colis.length,
            colis: colis,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})

//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 14- Enregistrer un retrait de colis : modèle 1 (sans codeOTP)
router.post('/enregistrer-retrait-colis', async (req, res) => {
    const { tabColis } = req.body;

    try {
        // Vérifier que tabColis est un tableau non vide
        if (!Array.isArray(tabColis) || tabColis.length === 0) {
            return res.status(400).json({ success: false, message: "Vous devez sélectionner au moins un colis." });
        }

        // Extraire tous les codes colis pour la vérification en une seule requête
        const codesColis = tabColis.map(colis => colis.codeColis);

        // Vérifier si les colis sont bien reçus
        const { data: colisRecus, error: errorEstRecu } = await supabase
            .from('colis')
            .select('codecolis')
            .in('codecolis', codesColis)
            .eq('envoyer', true)
            .eq('colisrecu', true)
            .eq('colisannuler', false)
            .eq('colisretirer', false) // On veut justement le retirer maintenant

        if (errorEstRecu) {
            console.error("Erreur lors de la récupération des données :", errorEstRecu);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (codesColis.length !== colisRecus.length) {
            return res.status(404).json({
                success: false,
                message: "Certains colis ne sont pas encore reçus, impossible de procéder au retrait."
            });
        }


        // Préparer les données pour l'insertion groupée
        const retraitsColis = tabColis.map(colis => ({
            codecolis: colis.codeColis,
            contactdestinataire: colis.contactDestinataire,
            numcni: colis.numCNI,
            codegare: colis.codeGare,
            matgestionnairecolis: colis.matGestionnaireColis
        }));

        // Insérer en lot les retraits dans la base
        const { data: retraitsEnregistres, error: errorColis } = await supabase
            .from('retraits_colis')
            .insert(retraitsColis)
            .select();

        if (errorColis) {
            console.error("Erreur lors de l'enregistrement des retraits :", errorColis);

            if (errorColis.message.includes("duplicate key value violates unique constraint")) {
                return res.status(400).json({ success: false, message: "Certains colis sont déjà retirés." });
            }

            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!retraitsEnregistres) {
            return res.status(400).json({ success: false, message: "Aucun enregistrement effectué." });
        }

        // Modifier la table colis : colisretirer = true (modification groupée)
        const { data: colisRetirer, error: errorRetirer } = await supabase
            .from('colis')
            .update({ colisretirer: true, dateretrait: retraitsEnregistres[0].dateretrait })
            .in('codecolis', codesColis)
            .select();

        if (errorRetirer) {
            console.error(`Colis retirés enregistré avec succès. Mais la mise à jour a échoué 
                dû a une erreur interne du serveur!`, errorRetirer)
        }

        return res.status(201).json({
            success: true,
            message: "Enregistrement des retraits effectué avec succès !",
            listecolis: retraitsEnregistres,
        });

    } catch (error) {
        console.error("Erreur lors de l'enregistrement des retraits :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 15- Retourner un colis
router.post('/retourner-colis', async (req, res) => {
    const {
        codeColis,
        codeColisRetour,
        codeGareActuelle,
        gareInitiale,
        matGestionnaireColis
    } = req.body

    try {
        const { data: createRetour, error: errorRetour } = await supabase
            .from('colis_retours')
            .insert({
                codecolis: codeColis,
                codecolisretour: codeColisRetour,
                codegareactuelle: codeGareActuelle,
                gareinitiale: gareInitiale,
                matgestionnairecolis: matGestionnaireColis
            })
            .select();

        if (errorRetour) {
            console.error("Erreur lors de l'enregistrement des données :", errorRetour);

            // Vérifie si c'est une erreur de clé unique
            if (errorRetour.message.includes("duplicate key value violates unique constraint")) {
                //Code SQL pour avoir les noms exactes des contraintes uniques :
                // SELECT conname FROM pg_constraint WHERE conrelid = 'colis_retours'::regclass;
                if (errorRetour.message.includes("colis_retours_codecolis_key")) {
                    return res.status(400).json({ success: false, message: "Désolé, ce colis est déjà enregistré." });
                }
            }
            // Dans le cas contraire
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!createRetour) {
            return res.status(400).json({ success: false, message: "Enregistrement non effectué." });
        }


        // Modifier la table 'colis' : colisretourner = vrai
        const { data: colisRetourner, error: errorColisRetourner } = await supabase
            .from('colis')
            .update({ colisretourner: true })
            .eq('codecolis', codeColis)
            .select();

        return res.status(201).json({
            success: true,
            message: "Enregistré avec succès !",
            colis: createRetour,
        })

    } catch (error) {
        console.error("Erreur lors de l'enregistrement des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 16- Afficher les colis retourné de l'année en cours
router.get('/lister-colis-retourner/:codeGareActuelle/:gareInitiale', async (req, res) => {
    const { codeGareActuelle, gareInitiale } = req.params;

    try {
        // L'année en cours du 1er janv à 00:00:00 au 31 dec à 23:59:59
        const currentYear = new Date().getFullYear();
        const startOfYear = `${currentYear}-01-01T00:00:00.000Z`;
        const endOfYear = `${currentYear}-12-31T23:59:59.999Z`;

        // Requête optimisée avec jointure entre colis_retours et colis
        let { data: colisRetours, error: errorColisRetours } = await supabase
            .from('colis_retours')
            .select(`
                codecolis,
                codegareactuelle,
                gareinitiale,
                dateretour,
                colis (
                    nomexpediteur,
                    contactexpediteur,
                    refvoyage,
                    refenvoie,
                    valeurestimee,
                    prixcolis,
                    datecolis
                )
            `)
            .eq('codegareactuelle', codeGareActuelle)
            .eq('gareinitiale', gareInitiale)
            .gte('dateretour', startOfYear)
            .lte('dateretour', endOfYear);

        // Vérifier s'il y a une erreur
        if (errorColisRetours) {
            console.error("Erreur lors de la récupération des données :", errorColisRetours);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        // Vérifier si aucun colis n'est trouvé
        if (!colisRetours || colisRetours.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis retourné trouvé pour cette année." });
        }

        // Reformater les résultats en fusionnant colisRetours et colis
        const listeColisComplets = colisRetours.map(item => ({
            codecolis: item.codecolis,
            codegareactuelle: item.codegareactuelle,
            gareinitiale: item.gareinitiale,
            dateretour: item.dateretour,
            nomexpediteur: item.colis?.nomexpediteur || null,
            contactexpediteur: item.colis?.contactexpediteur || null,
            refvoyage: item.colis?.refvoyage || null,
            refenvoie: item.colis?.refenvoie || null,
            valeurestimee: item.colis?.valeurestimee || null,
            prixcolis: item.colis?.prixcolis || null,
            datecolis: item.colis?.datecolis || null,
        }));

        return res.status(200).json({
            success: true,
            colis: listeColisComplets,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 17-a Annulation de colis non expédié (envoyer === null) : modèle 1 (sans codeOTP)
router.post('/enregistrer-colis-annuler/:moment', async (req, res) => {
    const { moment } = req.params
    const {
        codeColis,
        motifAnnulation,
        remiseAnnulation,
        montantRetenu,
        matGestionnaireColis,
    } = req.body

    try {
        // Vérifier d'abord que le colis existe 
        let query = supabase
            .from('colis')
            .select(`codecolis, refvoyage, refenvoie`)
            .eq('codecolis', codeColis)

        if (moment === "Avant l'expédition du montant du colis") {
            query = query.is('refvoyage', null)
        }
        else if (moment === "Avant l'expédition du colis") {
            query = query.is('refenvoie', null)
        }

        // Exécution de la requête
        const { data: colis, error: errorColis } = await query

        if (errorColis) {
            console.error("Erreur lors de la récupération des données : ", errorColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!colis || colis.length === 0) {
            return res.status(404).json({ success: false, message: "Le colis non trouvé." });
        }


        // Disponibilité du voyage 
        if (moment === "Avant la sortie du car de la gare") {
            // Cas avec refvoyage
            if (colis.refvoyage !== null && colis.refvoyage !== undefined) {
                const { data: verifDisponibiliteVoyage, errorVoyage } = await supabase
                    .from('ref_voyages')
                    .select('disponible')
                    .eq('refvoyage', colis.refvoyage)
                    .maybeSingle();
                if (errorVoyage) {
                    console.error("Erreur lors de la récupération des données : ", errorVoyage);
                    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
                }
                if (!verifDisponibiliteVoyage || verifDisponibiliteVoyage.length === 0) {
                    return res.status(404).json({ success: false, message: "Voyage non trouvé." });
                }
                if (verifDisponibiliteVoyage.disponible === false) {
                    return res.status(400).json({ success: false, message: "Le colis que vous essayez d'annuler est déjà sorti de la gare." });
                }
            }
            // Cas avec refenvoie
            if (colis.refenvoie !== null && colis.refenvoie !== undefined) {
                const { data: verifDisponibiliteEnvoie, errorEnvoie } = await supabase
                    .from('ref_voyages')
                    .select('disponible')
                    .eq('refvoyage', colis.refenvoie)
                    .maybeSingle();
                if (errorEnvoie) {
                    console.error("Erreur lors de la récupération des données : ", errorEnvoie);
                    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
                }
                if (!verifDisponibiliteEnvoie || verifDisponibiliteEnvoie.length === 0) {
                    return res.status(404).json({ success: false, message: "Voyage non trouvé." });
                }
                if (verifDisponibiliteEnvoie.disponible === false) {
                    return res.status(400).json({ success: false, message: "Le colis que vous essayez d'annuler est déjà sorti de la gare." });
                }
            }
        }


        //Enregistrons le colis dans 'colis_annulers'
        const { data: colisAnnuler, error: errorAnnuler } = await supabase
            .from('colis_annulers')
            .insert({
                codecolis: codeColis,
                motifannulation: motifAnnulation,
                montantretenu: montantRetenu,
                remiseannulation: remiseAnnulation,
                matgestionnairecolis: matGestionnaireColis,
            })
            .select();

        if (errorAnnuler) {
            console.error("Erreur lors de l'enregistrement des données : ", errorAnnuler);

            if (errorAnnuler.message.includes("duplicate key value violates unique constraint")) {
                return res.status(400).json({ success: false, message: "Ce colis est déjà enregistré." });
            }
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!colisAnnuler) {
            return res.status(400).json({ success: false, message: "Aucun enregistrement effectué." });
        }

        // Modifier la table colis : colisannuler === true
        const { data: modifColis, error: errorModif } = await supabase
            .from('colis')
            .update({ colisannuler: true })
            .eq('codecolis', codeColis)
            .select();

        if (errorModif) {
            console.error("Erreur lors de la mise à jour des données : ", errorAnnuler);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }

        if (!modifColis || modifColis.colisannuler === false) {
            return res.status(400).json({ success: false, message: "Mise à jour non effectuée !" });
        }

        return res.status(201).json({
            success: true,
            message: "Colis annulé enregistré avec succès !",
            colis: colisAnnuler,
        })

    } catch (error) {
        console.error("Erreur lors de l'enregistrement des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// 17-b Annulation de colis non expédié (envoyer === null) : modèle 2 (avec codeOTP)
router.post('/enregistrer-colis-annuler/:moment/:contactExpediteur/:codeOTP', async (req, res) => {
    const { moment, contactExpediteur, codeOTP } = req.params
    const {
        codeColis,
        motifAnnulation,
        remiseAnnulation,
        montantRetenu,
        matGestionnaireColis,
    } = req.body

    try {
        // Récupérer le dernier code secret valide pour l'expéditeur
        const { data: dernierCodeSecret, error } = await supabase
            .from('codes_otp')
            .select('*')
            .eq('contact', contactExpediteur)
            .gte('expiresat', new Date().toISOString())
            .order('expiresat', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error || !dernierCodeSecret) {
            return res.status(401).json({
                success: false,
                message: 'Code secret invalide ou expiré.',
            });
        }

        // Vérification du code secret
        const isCodeValid = await bcrypt.compare(codeOTP, dernierCodeSecret.codesecret);
        if (!isCodeValid) {
            return res.status(401).json({
                success: false,
                message: 'Code secret invalide ou expiré.',
            });
        }


        // Vérifier d'abord que le colis existe 
        let query = supabase
            .from('colis')
            .select(`codecolis, refvoyage, refenvoie`)
            .eq('codecolis', codeColis)

        if (moment === "Avant l'expédition du montant du colis") {
            query = query.is('refvoyage', null)
        }
        else if (moment === "Avant l'expédition du colis") {
            query = query.is('refenvoie', null)
        }

        // Exécution de la requête
        const { data: colis, error: errorColis } = await query

        if (errorColis) {
            console.error("Erreur lors de la récupération des données : ", errorColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!colis || colis.length === 0) {
            return res.status(404).json({ success: false, message: "Le colis non trouvé." });
        }

        // Disponibilité du voyage 
        if (moment === "Avant la sortie du car de la gare") {
            // Cas avec refvoyage
            if (colis.refvoyage !== null && colis.refvoyage !== undefined) {
                const { data: verifDisponibiliteVoyage, errorVoyage } = await supabase
                    .from('ref_voyages')
                    .select('disponible')
                    .eq('refvoyage', colis.refvoyage)
                    .maybeSingle();
                if (errorVoyage) {
                    console.error("Erreur lors de la récupération des données : ", errorVoyage);
                    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
                }
                if (!verifDisponibiliteVoyage || verifDisponibiliteVoyage.length === 0) {
                    return res.status(404).json({ success: false, message: "Voyage non trouvé." });
                }
                if (verifDisponibiliteVoyage.disponible === false) {
                    return res.status(400).json({ success: false, message: "Le colis que vous essayez d'annuler est déjà sorti de la gare." });
                }
            }
            // Cas avec refenvoie
            if (colis.refenvoie !== null && colis.refenvoie !== undefined) {
                const { data: verifDisponibiliteEnvoie, errorEnvoie } = await supabase
                    .from('ref_voyages')
                    .select('disponible')
                    .eq('refvoyage', colis.refenvoie)
                    .maybeSingle();
                if (errorEnvoie) {
                    console.error("Erreur lors de la récupération des données : ", errorEnvoie);
                    return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
                }
                if (!verifDisponibiliteEnvoie || verifDisponibiliteEnvoie.length === 0) {
                    return res.status(404).json({ success: false, message: "Voyage non trouvé." });
                }
                if (verifDisponibiliteEnvoie.disponible === false) {
                    return res.status(400).json({ success: false, message: "Le colis que vous essayez d'annuler est déjà sorti de la gare." });
                }
            }
        }

        //Enregistrons le colis dans 'colis_annulers'
        const { data: colisAnnuler, error: errorAnnuler } = await supabase
            .from('colis_annulers')
            .insert({
                codecolis: codeColis,
                motifannulation: motifAnnulation,
                montantretenu: montantRetenu,
                remiseannulation: remiseAnnulation,
                matgestionnairecolis: matGestionnaireColis,
            })
            .select();

        if (errorAnnuler) {
            console.error("Erreur lors de l'enregistrement des données : ", errorAnnuler);

            if (errorAnnuler.message.includes("duplicate key value violates unique constraint")) {
                return res.status(400).json({ success: false, message: "Ce colis est déjà enregistré." });
            }
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!colisAnnuler) {
            return res.status(400).json({ success: false, message: "Aucun enregistrement effectué." });
        }

        // Modifier la table colis : colisannuler === true
        const { data: modifColis, error: errorModif } = await supabase
            .from('colis')
            .update({ colisannuler: true })
            .eq('codecolis', codeColis)
            .select();

        if (errorModif) {
            console.error("Erreur lors de la mise à jour des données : ", errorAnnuler);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" });
        }

        if (!modifColis || modifColis.colisannuler === false) {
            return res.status(400).json({ success: false, message: "Mise à jour non effectuée !" });
        }

        return res.status(201).json({
            success: true,
            message: "Colis annulé enregistré avec succès !",
            colis: colisAnnuler,
        })

    } catch (error) {
        console.error("Erreur lors de l'enregistrement des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 18-a Déclarer un colis en 'colisintrouvable'
router.put('/enregistrer-colis-introuvable', async (req, res) => {
    const { tabCodeColis } = req.body

    try {
        if (!Array.isArray(tabCodeColis) || tabCodeColis.length === 0) {
            return res.status(400).json({ success: false, message: "Vous devez selectionner au moins un colis." })
        }

        const { data: colisIntrouvable, error } = await supabase
            .from('colis')
            .update({ colisintrouvable: true })
            .in('codecolis', tabCodeColis)
            .eq('colisintrouvable', false)
            .select();

        if (error) {
            console.error("Erreur lors de la récupération des données :", error);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        return res.status(201).json({
            success: true,
            message: "Colis déclaré 'introuvable(s)' avec succès !",
            colis: colisIntrouvable,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// 18-a Déclarer un colis en 'colisintrouvable'
router.put('/enregistrer-colis-introuvable', async (req, res) => {
    const { tabCodeColis } = req.body

    try {
        if (!Array.isArray(tabCodeColis) || tabCodeColis.length === 0) {
            return res.status(400).json({ success: false, message: "Vous devez selectionner au moins un colis." })
        }

        const { data: colisIntrouvable, error } = await supabase
            .from('colis')
            .update({ colisintrouvable: true })
            .in('codecolis', tabCodeColis)
            .eq('colisintrouvable', false)
            .select();

        if (error) {
            console.error("Erreur lors de la récupération des données :", error);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        let nbre = 0
        const tab_nonModif = []
        const tabModif = []
        for (const colis of colisIntrouvable) {
            if (colis.colisintrouvable === true) {
                nbre++
                tab_nonModif.push(colis)
            } else {
                tabModif.push(colis)
            }
        }

        if (nbre === tabCodeColis.length) {
            return res.status(404).json({ success: false, message: "Echec : aucun colis déclaré comme introuvable." })
        }

        return res.status(201).json({
            success: true,
            message: "Colis déclaré 'introuvable(s)' avec succès !",
            colis: tabModif,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 19-a Modifier un colis : modèle 1 (sans code OTP)
router.put('/modifier-colis-a-expedier/:codeColis/:moment', upload.single("photoColis"), async (req, res) => {
    const { codeColis, moment } = req.params
    const {
        valeurEstimee,
        prixColis,
        description,
        nomExpediteur,
        contactExpediteur,
        nomDestinataire,
        contactDestinataire,
        destination,
        refVoyage,
        refEnvoie
    } = req.body

    try {
        let photoUrl = null;

        if (req.file) {
            photoUrl = await uploadToSupabase(req.file.path);
            fs.unlinkSync(req.file.path); // Supprime le fichier temporaire après l'upload
        }

        // Rechercher les information sur le colis
        const { data: trouveColis, error: errorTrouveColis } = await supabase
            .from('colis')
            .select('*')
            .eq('codecolis', codeColis)
            .maybeSingle();

        if (errorTrouveColis) {
            console.error("Erreur lors de la récupération des données : ", errorTrouveColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!trouveColis || trouveColis.length === 0) {
            return res.status(500).json({ success: false, message: "Colis non trouvé." });
        }

        // Vérifier que si !trouveColis.refvoyage & !refVoyage, alors refEnvoie doit être également null
        if (!trouveColis.refvoyage && !refVoyage && refEnvoie) {
            return res.status(500).json({ success: false, message: "Modifications effectuées : Vous ne pouvez pas expédier le colis sans avoir expédié l'argent." });
        }

        // Vérifier que ref_voyages.refvoyage est 'disponible'
        if (trouveColis.refenvoie && moment === "Avant la sortie du car") {
            const { data: dispoRef, error: errorDispoRef } = await supabase
                .from('ref_voyages')
                .select('*')
                .eq('refvoyage', trouveColis.refenvoie)
                .maybeSingle();
            if (errorDispoRef) {
                console.error("Erreur lors de la récupération des données : ", errorDispoRef);
                return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
            }

            if (!dispoRef || dispoRef.length === 0) {
                return res.status(500).json({ success: false, message: "Voyage non trouvé." });
            }

            if (dispoRef.disponible === false) {
                return res.status(500).json({ success: false, message: "Désolé, vous ne pouvez modifier un colis dont le car est déjà sorti (ou s'apprête à sortir) de la gare." });
            }
        }

        // Passer à la modification
        let query = supabase
            .from('colis')
            .update({
                refvoyage: refVoyage || trouveColis.refvoyage,
                refenvoie: refEnvoie || trouveColis.refenvoie,
                valeurestimee: parseInt(valeurEstimee, 10) || trouveColis.valeurestimee,
                prixcolis: parseInt(prixColis, 10) || trouveColis.prixcolis,
                description: description || trouveColis.description,
                photocolis: photoUrl ? photoUrl : trouveColis.photocolis,
                nomexpediteur: nomExpediteur || trouveColis.nomexpediteur,
                contactexpediteur: contactExpediteur || trouveColis.contactexpediteur,
                nomdestinataire: nomDestinataire || trouveColis.nomdestinataire,
                contactdestinataire: contactDestinataire || trouveColis.contactdestinataire,
                destination: destination || trouveColis.destination,
                colismodifier: true,
                datemodification: new Date(),
            })
            .eq('codecolis', codeColis)
            // .eq('colismodifier', false)
            .select();

        if (moment === "Avant l'expédition du montant du colis") {
            query = query.is('refvoyage', null)
        } else if (moment === "Avant l'expédition du colis") {
            query = query.is('refenvoie', null)
        } else if (moment === "Avant la réception du colis") {
            query = query.eq('colisrecu', false)
        } else if (moment === "Avant le retrait du colis") {
            query = query.eq('colisretirer', false)
        }

        // Exécuter la requête
        const { data: updateColis, error: errorUpdate } = await query

        if (errorUpdate) {
            console.error("Erreur lors de la modification des données : ", errorUpdate);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!updateColis || updateColis.length === 0) {
            return res.status(400).json({ success: false, message: "Aucune modification effectué." });
        }

        // Vérification mannuelle
        if (
            updateColis.valeurestimee === trouveColis.valeurestimee &&
            updateColis.prixcolis === trouveColis.prixcolis &&
            updateColis.description === trouveColis.description &&
            updateColis.photocolis === trouveColis.photocolis &&
            updateColis.nomexpediteur === trouveColis.nomexpediteur &&
            updateColis.contactexpediteur === trouveColis.contactexpediteur &&
            updateColis.nomdestinataire === trouveColis.nomdestinataire &&
            updateColis.contactdestinataire === trouveColis.contactdestinataire &&
            updateColis.destination === trouveColis.destination
        ) {

            if (
                // Aller cas par cas
                (
                    // cas 1 : les ref sont 'null'
                    !trouveColis.refvoyage && !updateColis.refvoyage &&
                    !trouveColis.refenvoie && !updateColis.refenvoie
                )
                ||
                (
                    // cas 2 : les ref sont non 'null'
                    trouveColis.refvoyage && updateColis.refvoyage &&
                    trouveColis.refenvoie && updateColis.refenvoie &&
                    trouveColis.refvoyage === updateColis.refvoyage &&
                    trouveColis.refenvoie === updateColis.refenvoie
                )
                ||
                (
                    // cas 3 : seul refenvoie est 'null'
                    trouveColis.refvoyage && updateColis.refvoyage &&
                    trouveColis.refvoyage === updateColis.refvoyage &&
                    !trouveColis.refenvoie && !updateColis.refenvoie
                )
            ) {
                //Remettre à false le booléen qui a indiqué la modification
                const { data: boolFalse, error: errorFalse } = await supabase
                    .from('colis')
                    .update({
                        colismodifier: trouveColis.colismodifier || false,
                        datemodification: trouveColis.datemodification || null
                    })
                    .eq('codecolis', codeColis)

                // Puis retourner aucune modification
                return res.status(400).json({ success: false, message: "Aucune modification effectué." });

            }
        }

        // Enregistrer l'ancienne version dans la table 'colis_modifiers' en cas donc de modification effectuée
        const { data: firstColis, error: errorFirstColis } = await supabase
            .from('colis_modifiers')
            .insert({
                codecolis: trouveColis.codecolis,
                refvoyage: trouveColis.refvoyage,
                refenvoie: trouveColis.refenvoie,
                valeurestimee: trouveColis.valeurestimee,
                prixcolis: trouveColis.prixcolis,
                description: trouveColis.description,
                photocolis: trouveColis.photocolis,
                nomexpediteur: trouveColis.nomexpediteur,
                contactexpediteur: trouveColis.contactexpediteur,
                codeclient: trouveColis.codeclient,
                nomdestinataire: trouveColis.nomdestinataire,
                contactdestinataire: trouveColis.contactdestinataire,
                destination: trouveColis.destination,
                codegare: trouveColis.codegare,
                datecolis: trouveColis.datecolis,
                datemodification: new Date(),
                matgestionnairecolis: trouveColis.matgestionnairecolis
            })
            .select()
            .maybeSingle();


        return res.status(201).json({
            success: true,
            message: "Modifications prises en compte avec succès !",
            colis: updateColis,
        })

    } catch (error) {
        console.error("Erreur lors de la modification des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})

// 19-b Modifier un colis : modèle 2 (avec code OTP)
router.put('/modifier-colis-a-expedier/:codeColis/:moment/:codeOTP', upload.single("photoColis"), async (req, res) => {
    const { codeColis, moment, codeOTP } = req.params
    const {
        valeurEstimee,
        prixColis,
        description,
        nomExpediteur,
        contactExpediteur,
        nomDestinataire,
        contactDestinataire,
        destination,
        refVoyage,
        refEnvoie
    } = req.body

    try {
        // Récupérer le dernier code secret valide pour l'expéditeur
        const { data: dernierCodeSecret, error } = await supabase
            .from('codes_otp')
            .select('*')
            .eq('contact', contactExpediteur)
            .gte('expiresat', new Date().toISOString())
            .order('expiresat', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error || !dernierCodeSecret) {
            return res.status(401).json({
                success: false,
                message: 'Code secret invalide ou expiré.',
            });
        }

        // Vérification du code secret
        const isCodeValid = await bcrypt.compare(codeOTP, dernierCodeSecret.codesecret);
        if (!isCodeValid) {
            return res.status(401).json({
                success: false,
                message: 'Code secret invalide ou expiré.',
            });
        }


        // Récupérer le lien de la photo
        let photoUrl = null;

        if (req.file) {
            photoUrl = await uploadToSupabase(req.file.path);
            fs.unlinkSync(req.file.path); // Supprime le fichier temporaire après l'upload
        }

        // Rechercher les information sur le colis
        const { data: trouveColis, error: errorTrouveColis } = await supabase
            .from('colis')
            .select('*')
            .eq('codecolis', codeColis)
            .maybeSingle();

        if (errorTrouveColis) {
            console.error("Erreur lors de la récupération des données : ", errorTrouveColis);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!trouveColis || trouveColis.length === 0) {
            return res.status(500).json({ success: false, message: "Colis non trouvé." });
        }

        // Vérifier que si !trouveColis.refvoyage & !refVoyage, alors refEnvoie doit être également null
        if (!trouveColis.refvoyage && !refVoyage && refEnvoie) {
            return res.status(500).json({ success: false, message: "Modifications effectuées : Vous ne pouvez pas expédier le colis sans avoir expédié l'argent." });
        }

        // Vérifier que ref_voyages.refvoyage est 'disponible'
        if (trouveColis.refenvoie && moment === "Avant la sortie du car") {
            const { data: dispoRef, error: errorDispoRef } = await supabase
                .from('ref_voyages')
                .select('*')
                .eq('refvoyage', trouveColis.refenvoie)
                .maybeSingle();
            if (errorDispoRef) {
                console.error("Erreur lors de la récupération des données : ", errorDispoRef);
                return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
            }

            if (!dispoRef || dispoRef.length === 0) {
                return res.status(500).json({ success: false, message: "Voyage non trouvé." });
            }

            if (dispoRef.disponible === false) {
                return res.status(500).json({ success: false, message: "Désolé, vous ne pouvez modifier un colis dont le car est déjà sorti (ou s'apprête à sortir) de la gare." });
            }
        }

        // Passer à la modification
        let query = supabase
            .from('colis')
            .update({
                refvoyage: refVoyage || trouveColis.refvoyage,
                refenvoie: refEnvoie || trouveColis.refenvoie,
                valeurestimee: parseInt(valeurEstimee, 10) || trouveColis.valeurestimee,
                prixcolis: parseInt(prixColis, 10) || trouveColis.prixcolis,
                description: description || trouveColis.description,
                photocolis: photoUrl ? photoUrl : trouveColis.photocolis,
                nomexpediteur: nomExpediteur || trouveColis.nomexpediteur,
                contactexpediteur: contactExpediteur || trouveColis.contactexpediteur,
                nomdestinataire: nomDestinataire || trouveColis.nomdestinataire,
                contactdestinataire: contactDestinataire || trouveColis.contactdestinataire,
                destination: destination || trouveColis.destination,
                colismodifier: true,
                datemodification: new Date(),
            })
            .eq('codecolis', codeColis)
            // .eq('colismodifier', false)
            .select();

        if (moment === "Avant l'expédition du montant du colis") {
            query = query.is('refvoyage', null)
        } else if (moment === "Avant l'expédition du colis") {
            query = query.is('refenvoie', null)
        } else if (moment === "Avant la réception du colis") {
            query = query.eq('colisrecu', false)
        } else if (moment === "Avant le retrait du colis") {
            query = query.eq('colisretirer', false)
        }

        // Exécuter la requête
        const { data: updateColis, error: errorUpdate } = await query

        if (errorUpdate) {
            console.error("Erreur lors de la modification des données : ", errorUpdate);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!updateColis || updateColis.length === 0) {
            return res.status(400).json({ success: false, message: "Aucune modification effectué." });
        }

        // Vérification mannuelle
        if (
            updateColis.valeurestimee === trouveColis.valeurestimee &&
            updateColis.prixcolis === trouveColis.prixcolis &&
            updateColis.description === trouveColis.description &&
            updateColis.photocolis === trouveColis.photocolis &&
            updateColis.nomexpediteur === trouveColis.nomexpediteur &&
            updateColis.contactexpediteur === trouveColis.contactexpediteur &&
            updateColis.nomdestinataire === trouveColis.nomdestinataire &&
            updateColis.contactdestinataire === trouveColis.contactdestinataire &&
            updateColis.destination === trouveColis.destination
        ) {

            if (
                // Aller cas par cas
                (
                    // cas 1 : les ref sont 'null'
                    !trouveColis.refvoyage && !updateColis.refvoyage &&
                    !trouveColis.refenvoie && !updateColis.refenvoie
                )
                ||
                (
                    // cas 2 : les ref sont non 'null'
                    trouveColis.refvoyage && updateColis.refvoyage &&
                    trouveColis.refenvoie && updateColis.refenvoie &&
                    trouveColis.refvoyage === updateColis.refvoyage &&
                    trouveColis.refenvoie === updateColis.refenvoie
                )
                ||
                (
                    // cas 3 : seul refenvoie est 'null'
                    trouveColis.refvoyage && updateColis.refvoyage &&
                    trouveColis.refvoyage === updateColis.refvoyage &&
                    !trouveColis.refenvoie && !updateColis.refenvoie
                )
            ) {
                //Remettre à false le booléen qui a indiqué la modification
                const { data: boolFalse, error: errorFalse } = await supabase
                    .from('colis')
                    .update({
                        colismodifier: trouveColis.colismodifier || false,
                        datemodification: trouveColis.datemodification || null
                    })
                    .eq('codecolis', codeColis)

                // Puis retourner aucune modification
                return res.status(400).json({ success: false, message: "Aucune modification effectué." });

            }
        }

        // Enregistrer l'ancienne version dans la table 'colis_modifiers' en cas donc de modification effectuée
        const { data: firstColis, error: errorFirstColis } = await supabase
            .from('colis_modifiers')
            .insert({
                codecolis: trouveColis.codecolis,
                refvoyage: trouveColis.refvoyage,
                refenvoie: trouveColis.refenvoie,
                valeurestimee: trouveColis.valeurestimee,
                prixcolis: trouveColis.prixcolis,
                description: trouveColis.description,
                photocolis: trouveColis.photocolis,
                nomexpediteur: trouveColis.nomexpediteur,
                contactexpediteur: trouveColis.contactexpediteur,
                codeclient: trouveColis.codeclient,
                nomdestinataire: trouveColis.nomdestinataire,
                contactdestinataire: trouveColis.contactdestinataire,
                destination: trouveColis.destination,
                codegare: trouveColis.codegare,
                datecolis: trouveColis.datecolis,
                datemodification: new Date(),
                matgestionnairecolis: trouveColis.matgestionnairecolis
            })
            .select()
            .maybeSingle();

        return res.status(201).json({
            success: true,
            message: "Modifications prises en compte avec succès !",
            colis: updateColis,
        })

    } catch (error) {
        console.error("Erreur lors de la modification des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})

// 20-a Générer code OTP pour le destinataire (RETRAIT)
router.post('/generer-code-otp-destinataire', async (req, res) => {
    const { tabCodeColis, contactDestinataire } = req.body

    try {
        // Vérifier que tabCodeColis est un tableau non vide
        if (!Array.isArray(tabCodeColis) || tabCodeColis.length === 0) {
            return res.status(400).json({ success: false, message: "Vous devez choisir au moins un colis." })
        }


        // Vérifier que le contactDestinataire du dernier colis qui lui est destiné correspond.
        const { data: verifContact, error: errorVerif } = await supabase
            .from('colis')
            .select('contactdestinataire')
            .eq('contactdestinataire', contactDestinataire)
            .in('codecolis', tabCodeColis)
            .eq('envoyer', true)
            .eq('colisrecu', true)
            .eq('colisretirer', false)
            .eq('colisintrouvable', false)
            .eq('colisannuler', false)
            .order('datecolis', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (errorVerif) {
            Console.Error("Erreur lors de l’enregistrement du code OTP : ", errorVerif)
            return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
        }

        if (!verifContact || verifContact.length === 0) {
            return res.status(404).json({ success: false, message: 'Contact du destinataire non trouvé.' });
        }

        // Génération d'un code secret
        const codeSecret = genereCodeSecret()

        // Hachage du code secret
        const hashedCode = await bcrypt.hash(codeSecret, 10);

        // Enregistrement dans la base de données
        const { error: insertError } = await supabase
            .from('codes_otp')
            .insert([
                {
                    contact: contactDestinataire,
                    codesecret: hashedCode,
                    expiresat: new Date(Date.now() + 5 * 60 * 1000), // Expiration dans 5 minutes
                },
            ]);

        if (insertError) {
            console.error("Erreur lors de l’enregistrement du code OTP : ", insertError)
            return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
        }

        // Envoi du code OTP (généré)
        console.log(`Code secret pour ${contactDestinataire} : ${codeSecret}`);
        // await envoiNotification(contactDestinataire, codeSecret);

        return res.status(202).json({
            success: true,
            message: 'Code secret envoyé avec succès.',
        });

    } catch (error) {
        console.error('Erreur lors de la connexion:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur.',
        });
    }
})

// 20-b Générer code OTP pour l'expediteur (MODIFICATION & ANNULATION)
router.post('/generer-code-otp-expediteur', async (req, res) => {
    const { codeColis, contactExpediteur } = req.body

    try {
        // Vérifier que le contactExpediteur correspond (Modification)
        const { data: verifContact, error: errorVerif } = await supabase
            .from('colis')
            .select('contactexpediteur')
            .eq('contactexpediteur', contactExpediteur)
            .eq('codecolis', codeColis)
            .eq('colisretirer', false)
            .eq('colisintrouvable', false)
            .eq('colisannuler', false)
            .order('datecolis', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (errorVerif) {
            Console.Error("Erreur lors de l’enregistrement du code OTP : ", errorVerif)
            return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
        }

        if (!verifContact || verifContact.length === 0) {
            return res.status(404).json({ success: false, message: 'Expéditeur non  trouvé.' });
        }

        // Génération d'un code secret
        const codeSecret = genereCodeSecret()

        // Hachage du code secret
        const hashedCode = await bcrypt.hash(codeSecret, 10);

        // Enregistrement dans la base de données
        const { error: insertError } = await supabase
            .from('codes_otp')
            .insert([
                {
                    contact: contactExpediteur,
                    codesecret: hashedCode,
                    expiresat: new Date(Date.now() + 5 * 60 * 1000), // Expiration dans 5 minutes
                },
            ]);

        if (insertError) {
            console.error("Erreur lors de l’enregistrement du code OTP : ", insertError)
            return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
        }

        // Envoi du code OTP (généré)
        console.log(`Code secret pour ${contactExpediteur} : ${codeSecret}`);
        // await envoiNotification(contactDestinataire, codeSecret);

        return res.status(202).json({
            success: true,
            message: 'Code secret envoyé avec succès.',
        });

    } catch (error) {
        console.error('Erreur lors de la connexion:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur.',
        });
    }
})

// 20-c Envoyer notification (SMS) au destinataire (COLIS RECUS)
router.post('/notification-colis-recu', async (req, res) => {
    const { codeColis, contactDestinataire, notification } = req.body

    try {
        // Vérifier que le contactDestinataire correspond.
        const { data: verifContact, error: errorVerif } = await supabase
            .from('colis')
            .select('contactdestinataire')
            .eq('contactdestinataire', contactDestinataire)
            .eq('codecolis', codeColis)
            .eq('envoyer', true)
            .eq('colisrecu', true)
            .eq('colisretirer', false)
            .eq('colisintrouvable', false)
            .eq('colisannuler', false)
            .order('datecolis', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (errorVerif) {
            Console.Error("Erreur lors de l’envoi de la notification : ", errorVerif)
            return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
        }

        if (!verifContact || verifContact.length === 0) {
            return res.status(404).json({ success: false, message: 'Contact du destinataire non trouvé.' });
        }

        // Hachage du code secret
        const hashedCode = await bcrypt.hash(notification, 10);

        // Enregistrement dans la base de données
        const { error: insertError } = await supabase
            .from('codes_otp')
            .insert([
                {
                    contact: contactDestinataire,
                    codesecret: hashedCode,
                    expiresat: new Date(Date.now() + 5 * 60 * 1000), // Expiration dans 5 minutes
                },
            ]);

        if (insertError) {
            console.error("Erreur lors de l’enregistrement du code OTP : ", insertError)
            return res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
        }

        // Envoi du code OTP (généré)
        console.log(`Notification pour ${contactDestinataire} : ${notification}`);
        // await envoiNotification(contactDestinataire, notification);

        return res.status(202).json({
            success: true,
            message: 'Notification envoyée avec succès.',
        });

    } catch (error) {
        console.error('Erreur lors de la connexion:', error.message);
        res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur.',
        });
    }
})

// 21- Retarait colis : modèle 2 (avec code OTP)
router.post('/enregistrer-retrait-colis-modele2/:contactDestinataire/:codeOTP', async (req, res) => {
    const { contactDestinataire, codeOTP } = req.params
    const { tabColis } = req.body;

    try {
        // Récupérer le dernier code secret valide
        const { data: dernierCodeSecret, error } = await supabase
            .from('codes_otp')
            .select('*')
            .eq('contact', contactDestinataire)
            .gte('expiresat', new Date().toISOString())
            .order('expiresat', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error || !dernierCodeSecret) {
            return res.status(401).json({
                success: false,
                message: 'Code secret invalide ou expiré.',
            });
        }

        // Vérification du code secret
        const isCodeValid = await bcrypt.compare(codeOTP, dernierCodeSecret.codesecret);
        if (!isCodeValid) {
            return res.status(401).json({
                success: false,
                message: 'Code secret invalide ou expiré.',
            });
        }

        // Vérifier que tabColis est un tableau non vide
        if (!Array.isArray(tabColis) || tabColis.length === 0) {
            return res.status(400).json({ success: false, message: "Vous devez sélectionner au moins un colis." });
        }

        // Extraire tous les codes colis pour la vérification en une seule requête
        const codesColis = tabColis.map(colis => colis.codeColis);

        // Vérifier si les colis sont bien reçus
        const { data: colisRecus, error: errorEstRecu } = await supabase
            .from('colis')
            .select('codecolis')
            .in('codecolis', codesColis)
            .eq('envoyer', true)
            .eq('colisrecu', true)
            .eq('colisannuler', false)
            .eq('colisretirer', false) // On veut justement le retirer maintenant

        if (errorEstRecu) {
            console.error("Erreur lors de la récupération des données :", errorEstRecu);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        // Vérifier que tous les sélectionnés sont bien reçus
        if (codesColis.length !== colisRecus.length) {
            return res.status(404).json({
                success: false,
                message: "Certains colis ne sont pas encore reçus, impossible de procéder au retrait."
            });
        }


        // Préparer les données pour l'insertion groupée
        const retraitsColis = tabColis.map(colis => ({
            codecolis: colis.codeColis,
            contactdestinataire: colis.contactDestinataire,
            numcni: colis.numCNI,
            codegare: colis.codeGare,
            matgestionnairecolis: colis.matGestionnaireColis
        }));

        // Insérer en lot les retraits dans la base
        const { data: retraitsEnregistres, error: errorColis } = await supabase
            .from('retraits_colis')
            .insert(retraitsColis)
            .select();

        if (errorColis) {
            console.error("Erreur lors de l'enregistrement des retraits :", errorColis);

            if (errorColis.message.includes("duplicate key value violates unique constraint")) {
                return res.status(400).json({ success: false, message: "Certains colis sont déjà retirés." });
            }

            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!retraitsEnregistres) {
            return res.status(400).json({ success: false, message: "Aucun enregistrement effectué." });
        }

        // Modifier la table colis : colisretirer = true (modification groupée)
        const { data: colisRetirer, error: errorRetirer } = await supabase
            .from('colis')
            .update({ colisretirer: true, dateretrait: retraitsEnregistres[0].dateretrait })
            .in('codecolis', codesColis)
            .select();

        if (errorRetirer) {
            console.error(`Colis retirés enregistré avec succès. Mais la mise à jour a échoué 
                dû a une erreur interne du serveur!`, errorRetirer)
        }

        return res.status(201).json({
            success: true,
            message: "Enregistrement des retraits effectué avec succès !",
            listecolis: retraitsEnregistres,
        });

    } catch (error) {
        console.error("Erreur lors de l'enregistrement des retraits :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


// 22- Rechercher approfondie de colis
router.get('/recherche-approfondie_colis', async (req, res) => {
    const { destination, valeur } = req.query
    const codeColis = valeur
    const contactDestinataire = valeur
    const contactExpediteur = valeur

    try {
        if (!valeur) {
            return res.status(400).json({ success: false, message: "Vous n'avez rien saisi." })
        }

        if (valeur.length < 5) {
            return res.status(400).json({ success: false, message: "Vous devez saisir au moins 5 caractères !" })
        }

        const currentYear = new Date().getFullYear(); // Récupération de l'année
        const { data: reqColis, error: errorReq } = await supabase
            .from('colis')
            .select(`
                *,
                ref_voyages!inner(matcar, nomconducteur, carremplacement, conducteurremplacement),
                gares!inner(codegare, nomgare)
            `)
            .gte('datecolis', `${currentYear}-01-01`) // Filtre à partir du 1er janvier de l'année en cours
            .lt('datecolis', `${currentYear + 1}-01-01`) // Exclure les colis de l'année suivante
            .eq('destination', destination)
            .eq('envoyer', true)
            .eq('colisrecu', true)
            .eq('colisretirer', false)
            .eq('colisintrouvable', false)
            .eq('colisannuler', false)
            .or(`codecolis.ilike.%${codeColis}%,contactdestinataire.ilike.%${contactDestinataire}%,contactexpediteur.ilike.%${contactExpediteur}%`)
            .order('daterecu', { ascending: false })
            .order('datecolis', { ascending: true })
            .limit(25);




        if (errorReq) {
            console.error("Erreur lors de la récupération des données : ", errorReq)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" })
        }

        if (!reqColis || reqColis.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun colis trouvé !" })
        }


        const colis = reqColis.map(item => ({
            id: item.id,
            codecolis: item.codecolis,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixcolis: item.prixcolis,
            destination: item.destination,
            description: item.description,
            photocolis: item.photocolis,
            codeclient: item.codeclient,
            nomexpediteur: item.nomexpediteur,
            contactexpediteur: item.contactexpediteur,
            nomdestinataire: item.nomdestinataire,
            contactdestinataire: item.contactdestinataire,
            datecolis: item.datecolis,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            colisrecu: item.colisrecu,
            daterecu: item.daterecu,
            colisretirer: item.colisretirer,
            dateretrait: item.dateretrait,
            colisannuler: item.colisannuler,
            colisretourner: item.colisretourner,
            colisintrouvable: item.colisintrouvable,
            codegare: item.codegare,
            nomgare: item.gares.nomgare,
            matgestionnairecolis: item.matgestionnairecolis,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur
        }))

        return res.status(200).json({
            success: true,
            nbreTrouver: colis.length,
            colis: colis,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur" })
    }
})


// 23- Résumé d'une journée
router.get('/resumer-dune-journee/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params;
    const { dateRef, codeGare } = req.query;

    if (!idDepartement || !codeGare || !dateRef) {
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

        const [
            { data: colisDuJour, error: errorColis },
            { data: colisDuJour_annulers, error: errorAnnuler }
        ] = await Promise.all([
            supabase
                .from('colis')
                .select(`
                *, 
                gares(nomgare), 
                ref_voyages(matcar, nomconducteur, carremplacement, conducteurremplacement)
            `)
                .in('refvoyage', refVoyagesIds)
                .eq('codegare', codeGare)
                .order('refvoyage', { ascending: true })
                .order('codecolis', { ascending: true }),
            supabase
                .from('colis_annulers')
                .select('codecolis, refvoyage, codegare, montantretenu, matgestionnairecolis')
                .in('refvoyage', refVoyagesIds)
                .eq('codegare', codeGare)
                .order('refvoyage', { ascending: true })
                .order('codecolis', { ascending: true }),
        ])
        if (errorColis || errorAnnuler) {
            console.error("Erreur lors de la récupération des colis : ", { errorColis, errorAnnuler });
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

        let nbreTotal = 0
        let nbreTaxers = 0
        let nbreNonTaxers = 0
        let montColis_taxers = 0
        let montColis_nontaxers = 0

        let nbreColisAnnulers = 0
        let montColisAnnulers = 0
        for (const colis of listeColis) {
            if (colis.colisannuler === false) {
                nbreTotal++
                if (colis.refenvoie !== colis.refvoyage) {
                    nbreNonTaxers++
                    montColis_nontaxers += colis.prixcolis
                }
                nbreTaxers++
                montColis_taxers += colis.prixcolis
            }
        }

        for (const colis of colisDuJour_annulers) {
            nbreColisAnnulers += 1
            montColisAnnulers += colis.montantretenu

        }

        return res.status(200).json({
            success: true,
            nbretotal: nbreTotal,

            nbretaxers: nbreTaxers,
            montaxers: montColis_taxers,

            nbrenontaxers: nbreNonTaxers,
            montnontaxers: montColis_nontaxers,

            colis: listeColis,
            nbrecolisannulers: montColisAnnulers,
            colisannulers: colisDuJour_annulers,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


module.exports = router
