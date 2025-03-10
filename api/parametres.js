const express = require('express');
const supabase = require('../supabase'); 

const router = express.Router();

// Liste des lignes
router.get('/lignes', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('lignes')
            .select('id, nomligne')
            .order('nomligne', { ascending: true });

        if (error) throw error;

        const lignes = data.map(item => ({
            idLigne: item.id,
            nomLigne: item.nomligne,
        }));

        return res.status(200).json({ success: true, lignes: lignes });
    } catch (error) {
        console.error("Erreur : Impossible de récupérer les lignes.", error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur' });
    }
});


// Liste des départements d'une ligne
router.get('/departements/:idLigne', async (req, res) => {
    const { idLigne } = req.params;

    try {
        // Récupérer les départements d'une ligne
        const { data, error } = await supabase
            .from('lignes_departements')
            .select('departements!inner(id, nomdepartement, codedepartement)')
            .eq('idligne', idLigne);

        if (error) throw error;

        // Trier les résultats côté serveur ou localement
        const departements = data
            .map(item => ({
                idDepartement: item.departements.id,
                nomDepartement: item.departements.nomdepartement,
                codeDepartement: item.departements.codedepartement,
            }))
            .sort((a, b) => a.nomDepartement.localeCompare(b.nomDepartement)); // Tri local

        return res.status(200).json({ success: true, data: departements });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Erreur interne du serveur" });
    }
});


// Liste des gares d'un département
router.get('/gares/:idDepartement', async (req, res) => {
    const { idDepartement } = req.params;

    try {
        const { data, error } = await supabase
            .from('departements_gares')
            .select('gares!inner(id, codegare, nomgare)')
            .eq('iddepartement', idDepartement)

        if (error) throw error;

        const gares = data
            .map(item => ({
                idGare: item.gares.id,
                codeGare: item.gares.codegare,
                nomGare: item.gares.nomgare,
            }))
            .sort((a, b) => a.nomGare.localeCompare(b.nomGare))

        return res.status(200).json({ success: true, data: gares });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Erreur interne du serveur" });
    }
});

// Liste des destinations et prix par gare
router.get('/prix-destinations/:idLigne/:codeGare', async (req, res) => {
    const { idLigne, codeGare } = req.params;

    try {
        const { data, error } = await supabase
            .from('lignes_gares_destinations')
            .select('gares(nomgare), destinations(id, nomdestination), prixtransport')
            .eq('idligne', idLigne) // Filtrer par idLigne
            .eq('codegare', codeGare); // Filtrer par codeGare

        if (error) throw error;

        const destinationsPrix = data
            .map(item => ({
                nomGare : item.gares.nomgare,
                idDestination: item.destinations.id,
                nomDestination: item.destinations.nomdestination,
                prixTransport: item.prixtransport,
            }))
            .sort((a, b) => a.nomDestination.localeCompare(b.nomDestination))

        return res.status(200).json({ success: true, data: destinationsPrix });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
    }
});

module.exports = router;
