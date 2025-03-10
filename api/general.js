const express = require('express')
const supabase = require('./../supabase')

const router = express.Router()

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
            console.error('Erreur du serveur :', errorType)
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


// 5- Lister les refvoyages du jour "disponibles"
router.get('/refVoyages-true/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params

    try {
        const today = new Date(new Date().setHours(0, 0, 0, 0))
        const { data: refVoyage, error: errorRefVoyage } = await supabase
            .from('ref_voyages')
            .select(`refvoyage`)
            .eq('iddepartement', idDepartement)
            .eq('disponible', true)
            .eq('annulervoyage', false)
            // .gte('datevoyage', today.toISOString())
            .order('refvoyage', { ascending: false })

        if (errorRefVoyage) {
            console.error("Erreur : Impossible de récupérer les données.", errorRefVoyage)
            res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }

        if (!refVoyage || refVoyage.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage enregistré" })
        }
        const listRef = refVoyage.map(item => item.refvoyage) // Retourne seulement le tableau des valeurs
        return res.status(200).json({
            success: true,
            refVoyage: listRef
        })

    } catch (error) {
        console.error("Erreur : Impossible de récupérer les données.", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})


// 5- Lister les refvoyages du jour "non disponibles"
router.get('/refVoyages-false/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params

    try {
        const today = new Date().toISOString().split('T')[0]; // Formate pour comparer la date sans l'heure

        const { data: refVoyage, error: errorRefVoyage } = await supabase
            .from('voyages')
            .select(`
                refvoyage, 
                ref_voyages(disponible)
            `)
            .eq('ref_voyages.iddepartement', idDepartement)
            .eq('ref_voyages.disponible', false)
            .gte('datevoyage', today);

        if (errorRefVoyage) {
            console.error("Erreur : Impossible de récupérer les données.", errorRefVoyage)
            res.status(500).json({ success: false, message: "Erreur interne du serveur." })
        }

        if (!refVoyage || refVoyage.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun voyage enregistré." })
        }
        const listRef = refVoyage.map(item => item.refvoyage) // Retourne seulement le tableau des valeurs
        return res.status(200).json({
            success: true,
            refVoyage: listRef
        })

    } catch (error) {
        console.error("Erreur : Impossible de récupérer les données.", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur." })
    }
})


module.exports = router