const express = require("express");
const supabase = require("./../supabase");
const router = express.Router();


// Liste lignes
router.get('/liste-lignes', async (req, res) => {
    try {
        const { data: lignes, error: errorLignes } = await supabase
            .from('lignes')
            .select('*')
        if (errorLignes) {
            console.error("Erreur : impossoble de récupérer les données !", errorLignes)
            res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }

        if (!lignes | lignes.length === 0) {
            return res.status(404).json({ success: false, message: "Aucune ligne trouvée !" })
        }

        return res.status(200).json({
            success: true,
            lignes: lignes,
        })
    } catch (error) {
        console.error("Erreur : impossoble de récupérer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})

// Liste departements
router.get('/liste-departements', async (req, res) => {
    try {
        const { data: departements, error: errorDepmt } = await supabase
            .from('departements')
            .select('*')

        if (errorDepmt) {
            console.error("Erreur : impossoble de récupérer les données !", errorDepmt)
            res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }

        if (!departements | departements.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun département trouvé !" })
        }

        return res.status(200).json({
            success: true,
            departements: departements,
        })
    } catch (error) {
        console.error("Erreur : impossoble de récupérer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})

//Liste gares
router.get('/liste-gares', async (req, res) => {
    try {
        const { data: gares, error: errorGares } = await supabase
            .from('gares')
            .select('*')

        if (errorGares) {
            console.error("Erreur : impossoble de récupérer les données !", errorGares)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }

        if (!gares | gares.length === 0) {
            return res.status(404).json({ success: false, message: "Aucune gare trouvée !" })
        }

        return res.status(200).json({
            success: true,
            gares: gares,
        })
    } catch (error) {
        console.error("Erreur : impossoble de récupérer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})

// Liste destinations et prix
router.get('/liste-destinations', async (req, res) => {
    try {
        const { data: destinations, error: errorDestinations } = await supabase
            .from('destinations')
            .select('*')

        if (errorDestinations) {
            console.error("Erreur : impossoble de récupérer les données !", errorDestinations)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }

        if (!destinations | destinations.length === 0) {
            return res.status(404).json({ success: false, message: "Aucune destination trouvée !" })
        }

        return res.status(200).json({
            success: true,
            destinations: destinations,
        })
    } catch (error) {
        console.error("Erreur : impossoble de récupérer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})


// Liste lignes_departements
router.get('/jointure-lignes-departements', async (req, res) => {
    try {
        const { data: lignesDpmt, error: errorLigneDpmt } = await supabase
            .from('lignes_departements')
            .select('*')

        if (errorLigneDpmt) {
            console.error("Erreur : impossoble de récupérer les données !", errorLigneDpmt)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }

        if (!lignesDpmt | lignesDpmt.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun résultat !" })
        }

        return res.status(200).json({
            success: true,
            ligneDpmt: lignesDpmt,
        })
    } catch (error) {
        console.error("Erreur : impossoble de récupérer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})


// Liste departements-gares
router.get('/jointure-departements-gares', async (req, res) => {
    try {
        const { data: dpmtGares, error: errorDpmtGare } = await supabase
            .from('departements_gares')
            .select('*')

        if (errorDpmtGare) {
            console.error("Erreur : impossoble de récupérer les données !", errorDpmtGare)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }

        if (!dpmtGares | dpmtGares.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun résultat !" })
        }

        return res.status(200).json({
            success: true,
            dpmtGares: dpmtGares,
        })
    } catch (error) {
        console.error("Erreur : impossoble de récupérer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})


// Liste lignes-gares-destinations-prix
router.get('/jointure-lignes-gares-destinations-prix', async (req, res) => {
    try {
        const { data: ligneGareDest, error: errorLigneGareDest } = await supabase
            .from('lignes_gares_destinations')
            .select(`*, destinations (nomdestination)`)

        if (errorLigneGareDest) {
            console.error("Erreur : impossoble de récupérer les données !", errorLigneGareDest)
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }

        if (!ligneGareDest | ligneGareDest.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun résultat !" })
        }

        // Transformer l'affichage
        const resultat = ligneGareDest.map(item => ({
            id : item.id,
            idligne: item.idligne,
            codegare: item.codegare,
            iddestination: item.iddestination,
            nomdestination: item.destinations.nomdestination,
            prixtransport: item.prixtransport,
        }))

        return res.status(200).json({
            success: true,
            ligneDest: resultat,
        })
    } catch (error) {
        console.error("Erreur : impossoble de récupérer les données !", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})


// Liste postes-controles
router.get('/liste-postes-controles', async (req, res) =>{
    try {
        const { data : listePosteControle, error } = await supabase
            .from('postes_controles')
            .select('*')
            .order('villeposte', { ascending : true })
        if(error) {
            console.error("Erreur lors de la récupération des données : ", error)
            res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }
        if(!listePosteControle || listePosteControle.length === 0) {
            return res.status(400).json({ success : false, message : "Aucun poste de contrôle trouvé."})
        }

        return res.status(200).json({ success : true, postes : listePosteControle })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})

// Liste departements-dun-poste-controle
router.get('/liste-departements-dun-poste-controle/:idPosteControle', async (req, res) =>{
    const { idPosteControle } = req.params

    try {
        const { data : listeDpmt, error } = await supabase
            .from('departements_postes_controles')
            .select('*, departements (*)')
            .eq('idpostecontrole', idPosteControle)
        if(error) {
            console.error("Erreur lors de la récupération des données : ", error)
            res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }
        if(!listeDpmt || listeDpmt.length === 0) {
            return res.status(400).json({ success : false, message : "Aucun poste de contrôle trouvé."})
        }

        const liste = listeDpmt.map(item => ({
            id : item.departements.id,
            codedepartement : item.departements.codedepartement,
            nomdepartement : item.departements.nomdepartement,
        }))

        return res.status(200).json({ success : true, departements : liste })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})

// Jointure-departements-postes-controles
router.get('/jointure-departements-postes-controles', async (req, res) =>{

    try {
        const { data : jointure, error } = await supabase
            .from('departements_postes_controles')
            .select('*, departements (*), postes_controles (*)')
        if(error) {
            console.error("Erreur lors de la récupération des données : ", error)
            res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
        }
        if(!jointure || jointure.length === 0) {
            return res.status(400).json({ success : false, message : "Aucun poste de contrôle trouvé."})
        }

        const liste = jointure.map(item => ({
            idjointure : item.id,
            iddepartement : item.departements.id,
            codedepartement : item.departements.codedepartement,
            nomdepartement : item.departements.nomdepartement,
            idpostecontrole : item.postes_controles.id,
            libelleposte : item.postes_controles.libelleposte,
            villeposte : item.postes_controles.villeposte,
        }))

        return res.status(200).json({ success : true, jointure : liste })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" })
    }
})

module.exports = router 