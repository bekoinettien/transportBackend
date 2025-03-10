
const express = require("express");
const supabase = require("./../supabase"); // Import du client Supabase 
const supabaseProfile = require("./../supabaseProfile"); // Import du client Supabase 
const bcrypt = require('bcrypt')
const multer = require("multer"); // Stockage temporaire (uploader) des fichiers (images)
const fs = require('fs');

require('node-fetch').fetch;

const router = express.Router();

// Route pour récupérer les données de la base distante
router.get("/profile-fonction-poste-lieu/:matUser", async (req, res) => {
    const { matUser } = req.params

    try {
        // Récupérer les données de la table profileUsers sur la base distante
        const { data, error } = await supabaseProfile
            .from("personnels")
            .select("*")
            .eq('matriculepersonnel', 'T006');

        if (error) {
            throw error; // Gérer les erreurs
        }

        res.status(200).json({
            message: "Données récupérées avec succès!",
            data: data,
        });
    } catch (err) {
        console.error("Erreur lors de la récupération des données :", err.message);
        res.status(500).json({
            message: "Erreur interne du serveur.",
            error: err.message,
        });
    }
});
//****************************************************************************//



// Afficher les infos du profile
router.get('/profile-infos/:matUser', async (req, res) => {
    const { matUser } = req.params

    try {
        // 1-Rechercher l'utilisateur
        const { data: profile, error: errorProfile } = await supabase
            .from('comptes_users')
            .select('*')
            .eq('matuser', matUser)
            .maybeSingle();

        if (errorProfile) {
            console.error("Erreur lors de la récupération des données :", errorProfile);
            return res.status(500).json({
                message: "Erreur interne du serveur.",
                error: errorProfile,
            });
        }

        // S'il n'y a pas de profile on arrete tout
        if (!profile || errorProfile) {
            console.log(errorProfile)
            return res.status(404).json({ success: false, message: "Vous n'avez pas de compte !" })
        }

        let emailContact = {}
        let response = {}
        if (!profile.contactuser || !profile.emailuser) {
            // 2-Récupérer le contact et l'email dans la table 'users'
            const { data: email_Contact, error: errorEmailContact } = await supabase
                .from('users')
                .select('*')
                .eq('matuser', matUser)
                .maybeSingle();

            if (errorEmailContact) {
                console.error("Erreur lors de la récupération des données :", errorEmailContact);
                return res.status(500).json({
                    message: "Erreur interne du serveur.",
                    error: errorEmailContact,
                });
            }

            if (email_Contact) {
                emailContact = email_Contact
            }
        }

        if (!profile.fonctionuser || !profile.posteuser || !profile.lieudeservice) {
            // 3-Récupérer la fonction, le poste et lieu de service via l'api /profile-fonction-poste-lieu
            const apiUrl = process.env.API_URL
            response = await fetch(`${apiUrl}/profile-fonction-poste-lieu/${matUser}`);

        }
        const result = await response.json();

        // On récupère les données
        const contactUser = (profile.contactuser === null) ? emailContact.contactuser : profile.contactuser
        const emailtUser = (profile.emailuser === null) ? emailContact.emailuser : profile.emailuser
        const fonctionUser = (response.ok === true) ? result.data[0].nationalite : profile.fonctionuser
        const posteUser = (response.ok === true) ? result.data[0].matrimoniale : profile.posteuser
        const lieuService = (response.ok === true) ? result.data[0].cnps : profile.lieudeservice


        const datas = {
            loginUser: profile.loginuser,
            contactUser: contactUser,
            emailUser: emailtUser,
            fonctionUser: fonctionUser,
            posteUser: posteUser,
            lieuDeService: lieuService,
            photoAvatarUser: profile.photoavataruser,
            compteActif: profile.compteactif,
            admin: profile.admin,
            dateCreation: profile.datecreation,
            dateMAJ: profile.datemaj,
        }

        return res.status(200).json({
            success: true,
            profile: datas,
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error.message);
        res.status(500).json({
            message: "Erreur interne du serveur.",
            error: error.message,
        });
    }
})


// MODIFIER PROFILE
// Configuration de Multer pour gérer l'upload du fichier
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');  // Dossier où les fichiers seront stockés temporairement
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname); // Nom unique pour chaque fichier
    }
});
const upload = multer({ storage });

// Fonction pour uploader l'image sur Supabase Storage (bucket 'images' et dossier 'profiles')
async function uploadToSupabase(filePath) {
    try {
        const bucketName = 'images'; // Nom du bucket où les fichiers seront stockés
        const folderName = 'avatars'; // Dossier spécifique pour les photos de profil
        const fileName = filePath.split('/').pop();  // Extraire le nom du fichier

        // Ouvrir le fichier et le charger dans Supabase Storage
        const { data, error } = await supabase
            .storage
            .from(bucketName)
            .upload(`${folderName}/${fileName}`, fs.createReadStream(filePath), {
                contentType: 'image/jpeg',  // Assurez-vous de définir le type MIME correct
                duplex: 'half',
                upsert: true,  // Permet d'écraser une image existante si elle a le même nom
            });

        if (error) {
            throw error;  // Si l'upload échoue
        }

        // Générer l'URL publique pour accéder au fichier
        const imageUrl = `${supabase.storageUrl}/object/public/${bucketName}/${folderName}/${fileName}`;
        return imageUrl;  // Retourner l'URL du fichier stocké

    } catch (error) {
        console.error("Erreur lors de l'upload sur Supabase:", error);
        throw error;
    }
}

// Route pour mettre à jour les informations du profil
router.post('/profile-update/:matUser', upload.single("photoAvatarUser"), async (req, res) => {
    const { matUser } = req.params;
    const { passwordUser, contactUser, emailUser } = req.body;
    const photoAvatarUser = req.file; // Le fichier téléchargé est ici

    try {
        // Vérification de l'existence du compte utilisateur
        const { data: trouveCompte, error: findError } = await supabase
            .from('comptes_users')
            .select('*')
            .eq('matuser', matUser)
            .single(); // On recherche un utilisateur par son matricule

        if (findError || !trouveCompte) {
            return res.status(401).json({
                success: false,
                message: "Matricule incorrect"
            });
        }

        // Vérification du mot de passe
        if (passwordUser && !(await bcrypt.compare(passwordUser, trouveCompte.passworduser))) {
            return res.status(401).json({
                success: false,
                message: 'Mot de passe incorrect.'
            });
        }

        let imageUrl = trouveCompte.photoavataruser;  // Conserver l'ancienne photo si pas de nouvelle image

        // Logique pour envoyer l'image vers Supabase Storage
        if (photoAvatarUser) {
            imageUrl = await uploadToSupabase(photoAvatarUser.path); // Upload de l'image et obtention de l'URL
        }

        // Mettre à jour les informations de l'utilisateur dans la table comptes_users
        const { data: updatedUser, error: updateError } = await supabase
            .from('comptes_users')
            .update([
                {
                    contactuser: contactUser || trouveCompte.contactuser,
                    emailuser: emailUser || trouveCompte.emailuser,
                    photoavataruser: imageUrl,
                }
            ])
            .eq('matuser', matUser)
            .single() // Mise à jour de l'utilisateur
            .select();

        if (updateError) {
            return res.status(500).json({
                success: false,
                message: "Erreur lors de la mise à jour des données.",
                error: updateError.message,
            });
        }


        // Rechercher les données dans 'users'
        const { data: trouveUser, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('matuser', matUser)
            .single(); // On recherche un utilisateur par son matricule

        if (userError) {
            return res.status(404).json({
                success: false,
                message: "Vous n'êtes pas enregistré(e)s dans la Base de Données"
            })
        }



        // Mettre à jour les informations de l'utilisateur dans la table users
        const { data: majUser, error: majError } = await supabase
            .from('users')
            .update([
                {
                    contactuser: contactUser || trouveCompte.contactuser || trouveUser.contactuser,
                    emailuser: emailUser || trouveCompte.emailuser || trouveUser.emailuser,
                }
            ])
            .eq('matuser', matUser)
            .single() // Mise à jour de l'utilisateur
            .select();



        // Retourner une réponse de succès
        return res.status(200).json({
            success: true,
            message: "Profil mis à jour avec succès !",
            updatedUser,
        });
    } catch (error) {
        console.error("Erreur lors de l'enregistrement : ", error.message);
        res.status(500).json({
            success: false,
            message: "Erreur interne du serveur.",
            error: error.message,
        });
    }
});
//*******************************************************************//



// Api pour modifier login
router.put('/profile-modif-login/:matUser', async (req, res) => {
    const { matUser } = req.params
    const { newLoginUser, passwordUser } = req.body

    try {
        // Vérification de l'existence du compte utilisateur
        const { data: trouveCompte, error: errorCompte } = await supabase
            .from('comptes_users')
            .select('passworduser')
            .eq('matuser', matUser)
            .maybeSingle();

        if (!trouveCompte || errorCompte) {
            return res.status(401).json({
                success: false,
                message: "Matricule incorrect"
            });
        }

        // Vérification du mot de passe 
        if (!(await bcrypt.compare(passwordUser, trouveCompte.passworduser))) {
            return res.status(401).json({
                success: false,
                message: 'Mot de passe incorrect.'
            });
        }

        //Enregistrer la modification du login
        const { data: newCompte, error: errorNewCompte } = await supabase
            .from('comptes_users')
            .update([{ loginuser: newLoginUser || trouveCompte.loginuser, }])
            .eq('matuser', matUser)
            .select();

        if (!newCompte || errorNewCompte) {
            throw error(errorNewCompte)
        }

        return res.status(201).json({
            success: true,
            message: "Login modifié avec succès",
            data: newCompte,
        })

    } catch (error) {
        console.error("Erreur lors de l'enregistrement :", error.message);
        res.status(500).json({
            message: "Erreur interne du serveur.",
            error: error.message,
        });
    }
})
/////////////////////////////////////////////////////////////


// Api pour modifier password
router.put('/profile-modif-password/:matUser', async (req, res) => {
    const { matUser } = req.params
    const { lastPassword, newPassword } = req.body

    try {
        // Vérification de l'existence du compte utilisateur
        const { data: trouveCompte, error: errorCompte } = await supabase
            .from('comptes_users')
            .select('passworduser')
            .eq('matuser', matUser)
            .maybeSingle();

        if (!trouveCompte || errorCompte) {
            return res.status(401).json({
                success: false,
                message: "Matricule incorrect"
            });
        }

        // Vérifier la concordance des passwords
        if (!(await bcrypt.compare(lastPassword, trouveCompte.passworduser))) {
            return res.status(401).json({
                success: false,
                message: 'Mots de passes non conformes !'
            });
        }

        // Crypter password
        const cryptPassword = await bcrypt.hash(newPassword, 10);

        //Enregistrer la modification du password
        const { data: newCompte, error: errorNewCompte } = await supabase
            .from('comptes_users')
            .update([{ passworduser: cryptPassword || trouveCompte.passworduser, }])
            .eq('matuser', matUser)
            .select();

        if (!newCompte || errorNewCompte) {
            throw error(errorNewCompte)
        }

        return res.status(201).json({
            success: true,
            message: "Compte modifié avec succès",
            data: newCompte,
        })

    } catch (error) {
        console.error("Erreur lors de l'enregistrement :", error.message);
        res.status(500).json({
            message: "Erreur interne du serveur.",
            error: error.message,
        });
    }
})
///////////////////////////////////////////////////////////////////



// HISTORIQUE DE TRAVAIL DE L'UTILISATEUR
async function HistoriqueParMois(matGuichetiere) {
    try {
        const { data, error } = await supabase.rpc('historique_par_mois', { mat_guichetiere: matGuichetiere });

        if (error) {
            throw error;
        }

        const response = { success: true, historiqueTravail: {} };
        data.forEach(row => {
            const { mois, jour, voyages } = row;
            if (!response.historiqueTravail[mois]) {
                response.historiqueTravail[mois] = {};
            }
            response.historiqueTravail[mois][jour] = voyages;
        });

        return response;
    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return {
            success: false,
            message: "Erreur interne du serveur."
        };
    }
}
router.get('/profile-historique-travail/:matGuichetiere', async (req, res) => {
    const { matGuichetiere } = req.params;
    const data = await HistoriqueParMois(matGuichetiere);
    res.json(data);
});
//*****************************************************************************//


// Bilan d'un jour donné pour une gare par une guichetiere
router.get('/bilan-jour', async (req, res) => {
    const { matGuichetiere, date } = req.query;

    try {
        // Vérification et conversion de la date "JJ/MM/AAAA" en "YYYY-MM-DD"
        const dateParts = date.split('/'); // Séparer "JJ/MM/AAAA"
        if (dateParts.length !== 3) {
            return res.status(400).json({ success: false, message: "Format de date invalide. Utiliser 'JJ/MM/AAAA'." });
        }
        const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // Reformater en "YYYY-MM-DD"

        // Création de la plage horaire pour la date donnée (de 00:00:00 à 23:59:59)
        const startOfDay = `${formattedDate} 00:00:00`;
        const endOfDay = `${formattedDate} 23:59:59`;

        // Requête vers Supabase avec agrégation des données
        let query = supabase
            .from('tickets')
            .select(`
                refvoyage,
                prixticket,
                typeticket,
                clientbagage,
                gares(nomgare) 
            `)
            .eq('matguichetiere', matGuichetiere)
            .gte('dateticket', startOfDay)
            .lt('dateticket', endOfDay);

        // Exécution de la requête
        const { data: bilan, error: errorBilan } = await query;

        if (errorBilan) {
            console.error('Impossible de récupérer des données !', errorBilan);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!bilan || bilan.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun résultat pour cette date." });
        }

        // Calcul des statistiques demandées
        let nbrevoyages = new Set(); // Pour compter les voyages uniques
        let totaltickets = 0;
        let monttotaltickets = 0;
        let totalclientsbagages = 0;
        let totalgratuits = 0;
        let nomgare = bilan[0]?.gares?.nomgare // Récupérer le nom de la gare

        bilan.forEach(ticket => {
            nbrevoyages.add(ticket.refvoyage); // Stocke les voyages uniques
            totaltickets += 1;
            monttotaltickets += ticket.prixticket || 0;
            totalclientsbagages += ticket.clientbagage || 0;
            if (ticket.typeticket === 'GRATUIT') {
                totalgratuits += ticket.nbretickets || 0;
            }
        });

        return res.status(200).json({
            success: true,
            bilan: {
                nomgare,
                nbrevoyages: nbrevoyages.size, // Nombre unique de voyages
                totaltickets,
                monttotaltickets,
                totalgratuits,
                totalclientsbagages,
            }
        });

    } catch (error) {
        console.error('Impossible de récupérer des données !', error);
        res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

//////////////////////////////////////////////////////////////////////


router.get('/bilan-jour-departement', async (req, res) => {
    const { idDepartement, date } = req.query;

    try {
        // Vérification du format de la date (JJ/MM/AAAA → YYYY-MM-DD)
        const dateParts = date.split('/');
        if (dateParts.length !== 3) {
            return res.status(400).json({ success: false, message: "Format de date invalide. Utiliser 'JJ/MM/AAAA'." });
        }
        const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;

        // Récupérer les codesGare du département
        const { data: garesDepartement, error: errorGares } = await supabase
            .from('departements_gares')
            .select('codegare')
            .eq('iddepartement', idDepartement);

        if (errorGares || !garesDepartement || garesDepartement.length === 0) {
            console.error('Erreur lors de la récupération des gares:', errorGares);
            return res.status(404).json({ success: false, message: "Aucune gare trouvée pour ce département." });
        }

        // Extraire la liste des codesGare
        const codesGare = garesDepartement.map(g => g.codegare);

        // Récupérer les tickets pour ces gares à la date donnée
        const { data: bilan, error: errorBilan } = await supabase
            .from('tickets')
            .select(`
                codegare,
                refvoyage,
                prixticket,
                typeticket,
                clientbagage,
                gares ( nomgare )
            `)
            .in('codegare', codesGare)
            .gte('dateticket', formattedDate)  // tickets du jour
            .lt('dateticket', `${formattedDate} 23:59:59`);  // tickets avant la fin du jour

        if (errorBilan) {
            console.error('Erreur Supabase:', errorBilan);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!bilan || bilan.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun résultat pour cette date." });
        }

        // Structure des résultats
        let bilanDepartement = {
            nbrevoyages: new Set(),
            totaltickets: 0,
            monttotaltickets: 0,
            totalgratuits: 0,
            nbretotalbagages: 0,
        };

        let bilanParGare = {};

        bilan.forEach(ticket => {
            const { codegare, refvoyage, prixticket, typeticket, clientbagage, gares } = ticket;

            // --- Calcul du bilan général pour le département ---
            bilanDepartement.nbrevoyages.add(refvoyage);
            bilanDepartement.totaltickets += 1;
            bilanDepartement.monttotaltickets += prixticket || 0;
            bilanDepartement.nbretotalbagages += clientbagage || 0;
            if (typeticket === 'GRATUIT') {
                bilanDepartement.totalgratuits += ticket.nbretickets || 0;
            }

            // --- Calcul du bilan par gare ---
            if (!bilanParGare[codegare]) {
                bilanParGare[codegare] = {
                    codegare,
                    nomgare: gares?.nomgare,
                    nbrevoyages: new Set(),
                    totaltickets: 0,
                    monttotaltickets: 0,
                    totalgratuits: 0,
                    nbretotalbagages: 0,
                };
            }

            bilanParGare[codegare].nbrevoyages.add(refvoyage);
            bilanParGare[codegare].totaltickets += 1;
            bilanParGare[codegare].monttotaltickets += prixticket || 0;
            bilanParGare[codegare].nbretotalbagages += clientbagage || 0;
            if (typeticket === 'GRATUIT') {
                bilanParGare[codegare].totalgratuits += ticket.nbretickets || 0;
            }
        });

        // Conversion des Set() en nombre d'éléments uniques
        bilanDepartement.nbrevoyages = bilanDepartement.nbrevoyages.size;

        // Transformer bilanParGare (objet) en tableau d'objets
        let bilanParGareArray = Object.keys(bilanParGare).map(codegare => ({
            codegare,
            nomgare: bilanParGare[codegare].nomgare,
            nbrevoyages: bilanParGare[codegare].nbrevoyages.size,
            totaltickets: bilanParGare[codegare].totaltickets,
            monttotaltickets: bilanParGare[codegare].monttotaltickets,
            totalgratuits: bilanParGare[codegare].totalgratuits,
            nbretotalbagages: bilanParGare[codegare].nbretotalbagages
        }));

        return res.status(200).json({
            success: true,
            bilanDepartement,
            bilanParGare: bilanParGareArray
        });

    } catch (error) {
        console.error('Erreur serveur:', error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});

module.exports = router;
