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
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// 2- Créer code bagage. Exple : BAD1-20250209001
router.post('/creer-code-bagage/:codeGare', async (req, res) => {
    const { codeGare } = req.params;

    // Validation des paramètres
    if (!codeGare) {
        return res.status(400).json({ success: false, message: "Références manquantes." });
    }

    // Validation des paramètres pour éviter des injections
    const regexCodeGare = /^[A-Za-z0-9]+$/; // Exemple d'expression régulière pour valider les codes

    if (!regexCodeGare.test(codeGare)) {
        return res.status(400).json({ success: false, message: "Le code gare doit être alphanumérique." });
    }

    try {
        // Compter le nombre de bagage du jour pour la gare
        const today = new Date();
        const dateDebut = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0); // Début de la journée
        // const dateFin = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999); // Fin de la journée

        const [{ data: findGare, error: errorFind }, { count: nbreBagages, erro: errorNbre }] = await Promise.all([
            supabase
                .from('gares')
                .select('*')
                .eq('codegare', codeGare),
            supabase
                .from('bagages')
                .select('*', { count: 'exact' })
                .eq('codegare', codeGare)
                .gte('datebagage', dateDebut.toISOString())
            // .gte('datebagage', dateFin.toISOString()),
        ])
        if (errorNbre || errorFind) {
            console.error("Erreur lors de la récupération des données : ", { errorFind, errorNbre });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!findGare || findGare.length === 0) {
            return res.status(500).json({ success: false, message: "Gare non trouvée." });
        }

        // Si aucun bagage trouvé, assigner 1 par défaut
        const bagageCount = nbreBagages === 0 ? 1 : nbreBagages + 1;

        // Formater le nombre de bagage à 3 caractères
        const formattedNbreBagages = String(bagageCount).padStart(3, '0');

        // Créer la date au format AAAAMMJJ
        const dateJour = new Date();
        const dateFormatJour = formatDateToString(dateJour);

        // Créer le code bagage final
        const codeBagage = `B${codeGare}-${dateFormatJour}${formattedNbreBagages}`;

        return res.status(201).json({
            success: true,
            codebagage: codeBagage,
        });
    } catch (err) {
        console.error("Erreur lors de la récupération des données :", err);
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


//3- CREATION DU BAGAGE
// Configuration de Multer (Stockage temporaire des fichiers)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'imageBagages/');  // Stockage temporaire local
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
        const folderName = 'bagages';
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

// Enregistrement du bagage
router.post('/creer-bagage', upload.single("photoBagage"), async (req, res) => {
    let {
        codeClient = null,
        refVoyage = null,
        refEnvoie = null
    } = req.query

    let {
        codeBagage,
        valeurEstimee,
        prixBagage,
        description,
        destination,
        contactClient,
        numSiege,
        codeGare,
        matBagagiste,
    } = req.body;

    codeClient = (codeClient === "") ? null : codeClient
    destination = (destination === "null" | "NULL") ? null : destination
    if (!description || description === "" || description.length < 3) {
        return res.status(400).json({ success: false, message: "La description doit contenir du texte." })
    }
    if (!codeBagage) {
        return res.status(400).json({ success: false, message: "Le code bagage est requis." })
    }
    if (!destination || destination.length === 0 || destination === null) {
        return res.status(400).json({ success: false, message: "La destination est requise." })
    }
    if (!contactClient) {
        return res.status(400).json({ success: false, message: "Le contact du client est requis." })
    }
    if (!codeGare) {
        return res.status(400).json({ success: false, message: "Le code de la gare est requis." })
    }
    if (!matBagagiste) {
        return res.status(400).json({ success: false, message: "Le matricule du bagagiste est requis." })
    }

    try {
        let photoUrl = null;

        if (req.file) {
            photoUrl = await uploadToSupabase(req.file.path);
            fs.unlinkSync(req.file.path); // Supprime le fichier temporaire après l'upload
        }

        // Insertion en base de données
        const { data: enrgBagage, error: errorEnrg } = await supabase
            .from('bagages')
            .insert({
                codebagage: codeBagage,
                valeurestimee: parseInt(valeurEstimee, 10),
                prixbagage: parseInt(prixBagage, 10),
                description: description,
                destination: destination,
                photobagage: photoUrl ? photoUrl : null,
                codeclient: codeClient ? codeClient : null,
                contactclient: contactClient,
                numsiege: numSiege ? numSiege : null,
                codegare: codeGare,
                matbagagiste: matBagagiste,
                refvoyage: refVoyage ? refVoyage : null,
                refenvoie: refEnvoie ? refEnvoie : null,
                envoyer: refVoyage ? true : false,
                dateenvoie: refVoyage ? new Date() : null
            })
            .select()
            .maybeSingle();

        if (errorEnrg) {
            console.error("Erreur lors de la création du bagage : ", errorEnrg);

            if (errorEnrg.message.includes("duplicate key value violates unique constraint")) {
                if (errorEnrg.message.includes("bagages_codebagage_key")) {
                    return res.status(400).json({ success: false, message: "Ce bagage existe déjà dans la base de données." });
                }
            }
            // Dans le cas contraire
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!enrgBagage) {
            return res.status(400).json({ success: false, message: "Enregistrement non effectué." });
        }

        return res.status(201).json({
            success: true,
            message: "Bagage enregistré avec succès !",
            bagage: enrgBagage,
        });
    } catch (error) {
        console.error("Erreur lors de l'enregistrement du bagage :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
}
);
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++


//5- Lister les bagages enregistrés non expédiés (qui n'ont pas de refvoyage ni refenvoie)
router.get('/liste-bagages-non-ref/:codeGare', async (req, res) => {
    const { codeGare } = req.params

    try {
        const { data: bagageToSend, error: errorBagage } = await supabase
            .from('bagages')
            .select('*')
            .eq('codegare', codeGare)
            .or(`refvoyage.is.null, refenvoie.is.null`)

        if (errorBagage) {
            console.error("Erreur lors de la récupération des données : ", errorBagage)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!bagageToSend || bagageToSend.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun bagage trouvé." })
        }

        // Appliquer le tri personnalisé en JavaScript
        bagageToSend.sort((a, b) => {
            // D'abord, placer les bagages avec refvoyage != null et refenvoie == null en premier
            if (a.refvoyage !== null && a.refenvoie === null && !(b.refvoyage !== null && b.refenvoie === null)) {
                return -1;
            }
            if (b.refvoyage !== null && b.refenvoie === null && !(a.refvoyage !== null && a.refenvoie === null)) {
                return 1;
            }
            // Ensuite, trier tous les bagages par codeBagage en ordre croissant
            return a.codebagage.localeCompare(b.codebagage);
        });

        //Retourner les bagages 
        return res.status(200).json({
            success: true,
            bagages: bagageToSend,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++



// 6- MODIFIER : Affecter des refvoyage et refenvoie si non null au bagage à éxpédier
router.put('/affecter-references/:codeGare', async (req, res) => {
    const { codeGare } = req.params;
    const { tabCodeBagage, refVoyage = null, refEnvoie = null } = req.body;

    try {
        if (!refEnvoie && !refVoyage) {
            return res.status(400).json({ success: false, message: "Aucune référence n'a été sélectionnée !" });
        }

        if (!Array.isArray(tabCodeBagage) || tabCodeBagage.length === 0) {
            return res.status(400).json({ success: false, message: "Aucun bagage n'a été sélectionné !" });
        }

        const date_envoie = new Date();

        const { data: infosBagages, error: errorInfosBagages } = await supabase
            .from('bagages')
            .select('codebagage, refvoyage, refenvoie, envoyer, dateenvoie')
            .in('codebagage', tabCodeBagage)
            .eq('codegare', codeGare);

        if (errorInfosBagages) {
            console.error("Erreur lors de la récupérations des données :", errorInfosBagages);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!infosBagages || infosBagages.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun bagage trouvé." });
        }

        let bagagesModifies = [];
        let reference_nonAffecter = 0
        let reference_Affecter = 0
        for (const bagage of infosBagages) {
            if (bagage.refvoyage === null) { // On lui affecte refvoyage et éventuellement refenvoie et dateenvoie 
                const { data: update, error: errorUpdate } = await supabase
                    .from('bagages')
                    .update({
                        refvoyage: refVoyage,
                        refenvoie: ((refEnvoie && refVoyage) || (refEnvoie && bagage.refvoyage)) ? refEnvoie : null,
                        envoyer: ((refEnvoie && refVoyage) || (refEnvoie && bagage.refvoyage)) ? true : false,
                        dateenvoie: ((refEnvoie && refVoyage) || (refEnvoie && bagage.refvoyage)) ? date_envoie : null,
                    })
                    .eq('codebagage', bagage.codebagage)
                    .eq('envoyer', false)
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
                        bagage.refvoyage === update[0].refvoyage &&
                        bagage.refenvoie === update[0].refenvoie &&
                        bagage.envoyer === update[0].envoyer &&
                        bagage.dateenvoie?.toISOString() === update[0].dateenvoie?.toISOString()
                    )
                ) {
                    reference_nonAffecter++
                } else {  // Il y a eu modification, alors :
                    reference_Affecter++
                    bagagesModifies = bagagesModifies.concat(update);
                }


            } else if (bagage.refvoyage !== null && bagage.refenvoie === null && bagage.envoyer === false) { // On lui affecte refenvoie et dateenvoie
                const { data: update, error: errorUpdate } = await supabase
                    .from('bagages')
                    .update({
                        refenvoie: refEnvoie,
                        envoyer: ((!refVoyage && refEnvoie) || (refVoyage && refEnvoie)) ? true : false,
                        dateenvoie: ((!refVoyage && refEnvoie) || (refVoyage && refEnvoie)) ? date_envoie : null,
                    })
                    .eq('codebagage', bagage.codebagage)
                    .eq('envoyer', false)
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
                        bagage.refvoyage === update[0].refvoyage &&
                        bagage.refenvoie === update[0].refenvoie &&
                        bagage.envoyer === update[0].envoyer &&
                        bagage.dateenvoie?.toISOString() === update[0].dateenvoie?.toISOString()
                    )
                ) {
                    reference_nonAffecter++
                } else { // Il y a eu modification, alors :
                    reference_Affecter++
                    bagagesModifies = bagagesModifies.concat(update);
                }

            } else if (bagage.refenvoie !== null && bagage.refenvoie !== null) {
                return res.status(400).json({
                    success: false,
                    message: `Bagages ou montants déjà ajoutés au nombre des expédiés !`
                })
            } else { // Tout autre cas inattendu
                return res.status(400).json({
                    success: false,
                    message: `Aucun bagage ou montant ajouté au nombre des expédiés !`
                })
            }
        }

        // Retourner les résultats
        if (reference_Affecter === infosBagages.length && reference_nonAffecter === 0) { // Tous les bagages sont modifiés

            return res.status(201).json({
                success: true,
                message: "Bagages ou montants ajoutés au nombre des expédiés avec succès !",
                bagages: bagagesModifies,
            });
        } else if (reference_nonAffecter === infosBagages.length && reference_Affecter === 0) { //Aucune modification
            return res.status(400).json({
                success: false,
                message: `Aucun bagage ou montant ajouté au nombre des expédiés !`
            })
        } else if (reference_nonAffecter > 0) { // Certains bagages sont modifiés, mais pas tous.

            return res.status(400).json({
                success: false,
                message: `Certains bagages ou montants non ajoutés au nombre des expédiés !`,
                bagages: bagagesModifies,
            })
        }

    } catch (error) {
        console.error("Erreur lors de l'affectation des références :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 7- Lister les bagages d'une refVoyage
router.get('/listeTotale-bagages-voyage/:refVoyage', async (req, res) => {
    const { refVoyage } = req.params;
    const { codeGare } = req.query;

    try {
        let query = supabase
            .from('bagages')
            .select(`*, ref_voyages (matcar, nomconducteur, carremplacement, conducteurremplacement), gares(nomgare)`)
            .eq('bagageintrouvable', false)
            .or(`refvoyage.eq.${refVoyage}, refenvoie.eq.${refVoyage}`)
            .order('codebagage', { ascending: false });

        //Ajout des paramètres optionels (multicritères)
        if (codeGare) {
            query = query.eq('codegare', codeGare);
        }

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
            destination: item.destination,
        }));

        // Retourner les données
        return res.status(200).json({
            success: true,
            nbrebagage: infosBagages.length,
            listebagages: infosBagages,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 8-a Déclarer un bagage en 'bagageintrouvable'
router.put('/enregistrer-bagages-introuvables', async (req, res) => {
    const { tabCodeBagages } = req.body

    try {
        if (!Array.isArray(tabCodeBagages) || tabCodeBagages.length === 0) {
            return res.status(400).json({ success: false, message: "Vous devez selectionner au moins un bagage." })
        }

        const { data: bagagesIntrouvables, error } = await supabase
            .from('bagages')
            .update({ bagageintrouvable: true })
            .in('codebagage', tabCodeBagages)
            .eq('bagageintrouvable', false)
            .select();

        if (error) {
            console.error("Erreur lors de la récupération des données : ", error);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        let nbre = 0
        const tab_nonModif = []
        const tabModif = []
        for (const bagage of bagagesIntrouvables) {
            if (bagage.bagageintrouvable === true) {
                nbre++
                tab_nonModif.push(bagage)
            } else {
                tabModif.push(bagage)
            }
        }

        if (nbre === tabCodeBagages.length) {
            return res.status(404).json({ success: false, message: "Echec : aucun bagage déclaré comme introuvable." })
        }

        return res.status(201).json({
            success: true,
            message: "Bagage(s) déclaré(s) 'introuvable(s)' avec succès !",
            bagages: tabModif,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

// 8-b Lister les bagages 'introuvable'
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
            destination: destination,
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
//+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 9- Recherche approfondie de bagage
router.get('/recherche-approfondie-bagages', async (req, res) => {
    const { valeur } = req.query
    const codeBagage = valeur
    const contactClient = valeur

    try {
        if (!valeur) {
            return res.status(400).json({ success: false, message: "Vous n'avez rien saisi." })
        }

        if (valeur.length < 5) {
            return res.status(400).json({ success: false, message: "Vous devez saisir au moins 5 caractères !" })
        }

        const currentYear = new Date().getFullYear(); // Récupération de l'année
        const { data: reqBagages, error: errorReq } = await supabase
            .from('bagages')
            .select(`
                *,
                ref_voyages!inner(matcar, nomconducteur, carremplacement, conducteurremplacement),
                gares!inner(codegare, nomgare)
            `)
            .gte('datebagage', `${currentYear}-01-01`) // Filtre à partir du 1er janvier de l'année en cours
            .lt('datebagage', `${currentYear + 1}-01-01`) // Exclure les colis de l'année suivante
            .eq('envoyer', true)
            .eq('bagageintrouvable', false)
            .or(`codebagage.ilike.%${codeBagage}%,contactclient.ilike.%${contactClient}%`)
            .order('datebagage', { ascending: true })
            .limit(25);
        if (errorReq) {
            console.error("Erreur lors de la récupération des données : ", errorReq)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur" })
        }

        if (!reqBagages || reqBagages.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun bagage trouvé !" })
        }

        const bagages = reqBagages.map(item => ({
            id: item.id,
            codebagage: item.codebagage,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixbagage: item.prixbagage,
            description: item.description,
            photobagage: item.photobagage,
            codeclient: item.codeclient,
            nomclient: item.nomclient,
            contactclient: item.contactclient,
            numsiege: item.numsiege,
            destination: destination,
            datebagage: item.datebagage,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            bagageintrouvable: item.bagageintrouvable,
            codegare: item.codegare,
            nomgare: item.gares.nomgare,
            matgestionnairebagage: item.matgestionnairebagage,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur
        }))

        return res.status(200).json({
            success: true,
            nbreTrouver: bagages.length,
            bagages: bagages,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        return res.status(500).json({ success: false, message: "Erreur interne du serveur" })
    }
})
//++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++


// 4-a Chercher un client
router.get('/trouve-client', async (req, res) => {
    const { contactClient } = req.query

    try {
        let infosClient = {}

        // Formater l'année en cours
        const year = new Date().getFullYear();
        const startOfYear = `${year}-01-01T00:00:00Z`;

        // Nbre de bagages dans l'année
        const { count: nbreBagages, error: errorNbre } = await supabase
            .from('bagages')
            .select('*', { count: 'exact' })
            .eq('contactclient', contactClient)
            .gte('datebagage', startOfYear);

        if (errorNbre) {
            console.error("Erreur lors de la récupération des données :", errorNbre);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        // Affecter le nbre de bagages
        infosClient.nbrebagages = nbreBagages

        // Rechercher le client dans `bagages`
        const { data: clientBagage, error: errorClientBagage } = await supabase
            .from('bagages')
            .select('nomclient, codeclient')
            .eq('contactclient', contactClient)
            .limit(1)
            .maybeSingle();
        if (errorClientBagage) {
            console.error("Erreur lors de la récupération des données :", errorClientBagage);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!clientBagage || clientBagage.length === 0) { // Il n'est pas dans 'bagage'
            //Le rechercher alors dans `clients_fideles`
            const { data: clientMDT, error: errorClient } = await supabase
                .from('clients_fideles')
                .select(`nomclient, codeclient`)
                .eq('contactclient', contactClient)
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

        } else if (clientBagage) { // Par contre, s'il est trouvé dans 'bagages', alors :
            //Récupérer les infos du client 
            infosClient.nomclient = clientBagage.nomexpediteur
            infosClient.codeclient = clientBagage.codeclient
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
            return res.status(404).json({ success: false, message: "Aucun trouvé." });
        }

        // Récupérer les bagages liés aux références trouvées
        const refVoyagesIds = refsDuJour.map(r => r.refvoyage);
        // const refVoyagesIds = refsDuJour.map(r => r.refvoyage).join(",") //Lorsque j'utilise : .or(`refvoyage.in.(${refVoyagesIds}), refenvoie.in.(${refVoyagesIds})`)

        const [{ data: bagagesDuJour, error: errorBagages }] = await Promise.all([
            supabase
                .from('bagages')
                .select(`
                *, 
                gares(nomgare), 
                ref_voyages(matcar, nomconducteur, carremplacement, conducteurremplacement, nbreplaces_remplacement)
            `)
                .in('refvoyage', refVoyagesIds)
                .eq('codegare', codeGare)
                .order('refvoyage', { ascending: true })
                .order('codebagage', { ascending: true }),
        ])
        if (errorBagages) {
            console.error("Erreur lors de la récupération des bagages : ", { errorBagages });
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }
        if (!bagagesDuJour || bagagesDuJour.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun bagage trouvé." });
        }

        // Formatage des bagages
        const listeBagages = bagagesDuJour.map(item => ({
            id: item.id,
            codebagage: item.codebagage,
            refvoyage: item.refvoyage,
            refenvoie: item.refenvoie,
            valeurestimee: item.valeurestimee,
            prixbagage: item.prixbagage,
            description: item.description,
            photobagage: item.photobagage,
            codeclient: item.codeclient,
            nomclient: item.nomclient,
            contactclient: item.contactclient,
            numsiege: item.numsiege,
            destination: item.destination,
            datebagage: item.datebagage,
            envoyer: item.envoyer,
            dateenvoie: item.dateenvoie,
            bagageintrouvable: item.bagageintrouvable,
            codegare: item.codegare,
            nomgare: item.gares.nomgare,
            matgestionnairebagage: item.matgestionnairebagage,
            matcar: item.ref_voyages?.carremplacement || item.ref_voyages?.matcar,
            nomconducteur: item.ref_voyages?.conducteurremplacement || item.ref_voyages?.nomconducteur
        }));

        let nbreTotal = 0
        let nbreTaxers = 0
        let nbreNonTaxers = 0
        let montBagages_taxers = 0
        let montBagages_nontaxers = 0
        for (const bagage of listeBagages) {
            nbreTotal++
            if (bagage.refenvoie !== bagage.refvoyage) {
                nbreNonTaxers++
                montBagages_nontaxers += bagage.prixbagage
            }
            nbreTaxers++
            montBagages_taxers += bagage.prixbagage

        }

        return res.status(200).json({
            success: true,
            nbretotal: nbreTotal,
            nbretaxers: nbreTaxers,
            montaxers: montBagages_taxers,
            nbrenontaxers: nbreNonTaxers,
            montnontaxers: montBagages_nontaxers,
            bagages: listeBagages,
        });

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});


module.exports = router