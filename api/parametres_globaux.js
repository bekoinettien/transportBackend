const express = require('express');
const supabase = require('../supabase');

const router = express.Router();

// 1- Afficher les paramètres colis globaux
router.get('/parametres-globaux/:codeGare', async (req, res) => {
    const { codeGare } = req.params

    try {
        //Savoir si la gare spécifiée a des paramètres globaux spécifiques
        const { data: trueOrFalse, error: errorTrue } = await supabase
            .from('choix_type_params')
            .select('parametres_gares')
            .eq('codegare', codeGare)
        // Gestion des erreurs
        if (errorTrue) {
            console.error("Erreur lors de la récupération des données :", errorTrue);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
        }
        // Si aucun résultat pour paramètres spécifiques de la gare
        if (!trueOrFalse || trueOrFalse.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun résultat. Vérifiez que la gare spécifiée est correcte" });
        }

        //1-parametres_generaux_colis
        if (trueOrFalse[0].parametres_gares === false) {
            // Requête parametres_generaux_colis
            const { data: paramsGeneraux, error: errorParamsGeneraux } = await supabase
                .from('parametres_generaux_colis')
                .select('*')
                .maybeSingle();
            if (errorParamsGeneraux) {
                console.error("Erreur lors de la récupération des données :", errorParamsGeneraux);
                return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
            }
            return res.status(200).json({ success: true, parametres: paramsGeneraux })
        }

        //2-parametres_gares_colis
        const { data: paramsGlobauxGare, error: errorParamsGlobauxGare } = await supabase
            .from('parametres_gares_colis')
            .select('*')
            .eq('codegare', codeGare)
            .maybeSingle();

        if (errorParamsGlobauxGare) {
            console.error("Erreur lors de la récupération des données :", errorParamsGlobauxGare);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
        }
        return res.status(200).json({ success: true, parametres: paramsGlobauxGare })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++


// 2- API DE MODIFICATIONS - params generaux
router.put('/modifier-parametres-globaux', async (req, res) => {
    const {
        autoriser_Annulation_Colis,
        pourcentage_Remise,
        moment_Annulation,
        autoriser_Modification_Colis,
        moment_Modification,
        autoriser_OTP_modification_Expediteur,
        modifier_natureColis,
        modifier_photoColis,
        modifier_destinationColis,
        modifier_contactExpediteur,
        modifier_nomExpediteur,
        modifier_nomDestinataire,
        modifier_contactDestinataire,
        modifier_valeurEstimee,
        modifier_prixColis,
        appliquer_Pourcentage_prixColis,
        pourcentage_prixColis,
        autoriser_Gratuite_prixColis,
        nbreColis_pourGratuite,
        imposer_PhotoColis,
        autoriser_OTP_retrait_Destinataire,
        imposerScanCodeQR_retrait,
        autoriser_RetourColis,
        imposer_ScanCodeQR_reception,
        autoriser_OTP_annulation_expediteur,
        imprimer_recu_annulation,
        envoieSMS_destinataire_reception,
        imprimer_recu_modification,
        notification_reception,
    } = req.body

    try {

        // PASSER A LA MODIFICATION : parametres_generaux_colis
        //1- Récupérer les anciennes données
        const { data: lastDatas, error: errorLastDatas } = await supabase
            .from('parametres_generaux_colis')
            .select('*')
            .maybeSingle();
        if (errorLastDatas) {
            console.error("Erreur lors de la récupération des données :", errorLastDatas);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
        }

        //2- Requête parametres_generaux_colis
        const { data: modifParams, error: errorModif } = await supabase
            .from('parametres_generaux_colis')
            .upsert({
                id: 1,
                //Pour annulation : 
                autoriser_annulation_colis: autoriser_Annulation_Colis ?? lastDatas.autoriser_annulation_colis,
                pourcentage_remise: (autoriser_Annulation_Colis === false) ? 60 : pourcentage_Remise ?? lastDatas.pourcentage_remise,
                moment_annulation: (autoriser_Annulation_Colis === false) ? 'Avant la sortie du car de la gare' : moment_Annulation ?? lastDatas.moment_annulation,
                autoriser_otp_annulation_expediteur: (autoriser_Annulation_Colis === false) ? true : autoriser_OTP_annulation_expediteur ?? lastDatas.autoriser_otp_annulation_expediteur,
                imprimer_recu_annulation: (autoriser_Annulation_Colis === false) ? true : imprimer_recu_annulation ?? lastDatas.imprimer_recu_annulation,
                //Pour modification : 
                autoriser_modification_colis: autoriser_Modification_Colis ?? lastDatas.autoriser_modification_colis,
                moment_modification: (autoriser_Modification_Colis === false) ? 'Avant le retrait du colis' : moment_Modification ?? lastDatas.moment_modification,
                autoriser_otp_modification_expediteur: (autoriser_Modification_Colis === false) ? true : autoriser_OTP_modification_Expediteur ?? lastDatas.autoriser_otp_modification_expediteur,
                modifier_naturecolis: (autoriser_Modification_Colis === false) ? true : modifier_natureColis ?? lastDatas.modifier_naturecolis,
                modifier_photocolis: (autoriser_Modification_Colis === false) ? true : modifier_photoColis ?? lastDatas.modifier_photocolis,
                modifier_destinationcolis: (autoriser_Modification_Colis === false) ? true : modifier_destinationColis ?? lastDatas.modifier_destinationcolis,
                modifier_contactexpediteur: (autoriser_Modification_Colis === false) ? true : modifier_contactExpediteur ?? lastDatas.modifier_contactexpediteur,
                modifier_nomexpediteur: (autoriser_Modification_Colis === false) ? true : modifier_nomExpediteur ?? lastDatas.modifier_nomexpediteur,
                modifier_nomdestinataire: (autoriser_Modification_Colis === false) ? true : modifier_nomDestinataire ?? lastDatas.modifier_nomdestinataire,
                modifier_contactdestinataire: (autoriser_Modification_Colis === false) ? true : modifier_contactDestinataire ?? lastDatas.modifier_contactdestinataire,
                modifier_valeurestimee: (autoriser_Modification_Colis === false) ? true : modifier_valeurEstimee ?? lastDatas.modifier_valeurestimee,
                modifier_prixcolis: (autoriser_Modification_Colis === false) ? true : modifier_prixColis ?? lastDatas.modifier_prixcolis,
                imprimer_recu_modification: (autoriser_Modification_Colis === false) ? true : imprimer_recu_modification ?? lastDatas.imprimer_recu_modification,
                //Pour enregistrement : 
                appliquer_pourcentage_prixcolis: appliquer_Pourcentage_prixColis ?? lastDatas.appliquer_pourcentage_prixcolis,
                pourcentage_prixcolis: (appliquer_Pourcentage_prixColis === false) ? 10 : pourcentage_prixColis ?? lastDatas.pourcentage_prixcolis,
                autoriser_gratuite_prixcolis: autoriser_Gratuite_prixColis ?? lastDatas.autoriser_gratuite_prixcolis,
                nbrecolis_pourgratuite: (autoriser_Gratuite_prixColis === false) ? 7 : nbreColis_pourGratuite ?? lastDatas.nbrecolis_pourgratuite,
                imposer_photocolis: imposer_PhotoColis ?? lastDatas.imposer_photocolis,
                //Pour retrait : 
                autoriser_otp_retrait_destinataire: autoriser_OTP_retrait_Destinataire ?? lastDatas.autoriser_otp_retrait_destinataire,
                imposerscancodeqr_retrait: imposerScanCodeQR_retrait ?? lastDatas.imposerscancodeqr_retrait,
                //Pour retour : 
                autoriser_retourcolis: autoriser_RetourColis ?? lastDatas.autoriser_retourcolis,
                //Pour reception : 
                imposer_scancodeqr_reception: imposer_ScanCodeQR_reception ?? lastDatas.imposer_scancodeqr_reception,
                envoiesms_destinataire_reception: envoieSMS_destinataire_reception ?? lastDatas.envoiesms_destinataire_reception,
                notification_reception : notification_reception ?? lastDatas.notification_reception,
                //Date automatique :
                dateparamscolis: new Date(),
            })
            .select()
            .maybeSingle();
        if (errorModif) {
            console.error("Erreur lors de la modification des données : ", errorModif);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
        }

        // Retourner le résultat
        return res.status(202).json({ success: true, modifications: modifParams })


    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++


// 3- API DE MODIFICATIONS - params spécifique gare
router.put('/modifier-parametres-specifiques-gares/:codeGare', async (req, res) => {
    const { codeGare } = req.params
    const {
        autoriser_Annulation_Colis,
        pourcentage_Remise,
        moment_Annulation,
        autoriser_Modification_Colis,
        moment_Modification,
        autoriser_OTP_modification_Expediteur,
        modifier_natureColis,
        modifier_photoColis,
        modifier_destinationColis,
        modifier_contactExpediteur,
        modifier_nomExpediteur,
        modifier_nomDestinataire,
        modifier_contactDestinataire,
        modifier_valeurEstimee,
        modifier_prixColis,
        appliquer_Pourcentage_prixColis,
        pourcentage_prixColis,
        autoriser_Gratuite_prixColis,
        nbreColis_pourGratuite,
        imposer_PhotoColis,
        autoriser_OTP_retrait_Destinataire,
        imposerScanCodeQR_retrait,
        autoriser_RetourColis,
        imposer_ScanCodeQR_reception,
        autoriser_OTP_annulation_expediteur,
        imprimer_recu_annulation,
        envoieSMS_destinataire_reception,
        imprimer_recu_modification,
        notification_reception
    } = req.body

    try {
        //Savoir si la gare spécifiée a des paramètres globaux spécifiques
        const { data: trueOrFalse, error: errorTrue } = await supabase
            .from('choix_type_params')
            .select('parametres_gares')
            .eq('codegare', codeGare)
        // Gestion des erreurs
        if (errorTrue) {
            console.error("Erreur lors de la récupération des données :", errorTrue);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
        }
        // Si aucun résultat pour paramètres spécifiques de la gare
        if (!trueOrFalse || trueOrFalse.length === 0) {
            return res.status(404).json({ success: false, message: "Aucun résultat. Vérifiez que la gare spécifiée est correcte" });
        }
        // Vérifier si la gare a une configuration spécifique
        if (trueOrFalse[0].parametres_gares === false) {
            return res.status(404).json({ success: false, message: "Cette gare n'a pas de configuration propre à elle." });
        }


        //1-Récupérer les anciennes données
        const { data: lastDatas, error: errorLastDatas } = await supabase
            .from('parametres_gares_colis')
            .select('*')
            .eq('codegare', codeGare)
            .maybeSingle();
        if (errorLastDatas) {
            console.error("Erreur lors de la récupération des données :", errorLastDatas);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
        }

        // PASSER A LA MODIFICATION ou création : parametres_gares_colis
        const { data: modifParams, error: errorModif } = await supabase
            .from('parametres_gares_colis')
            .upsert(
                {
                    codegare: codeGare,
                    //Pour annulation : 
                    autoriser_annulation_colis: autoriser_Annulation_Colis ?? lastDatas.autoriser_annulation_colis,
                    pourcentage_remise: (autoriser_Annulation_Colis === false) ? 60 : pourcentage_Remise ?? lastDatas.pourcentage_remise,
                    moment_annulation: (autoriser_Annulation_Colis === false) ? 'Avant la sortie du car de la gare' : moment_Annulation ?? lastDatas.moment_annulation,
                    autoriser_otp_annulation_expediteur: (autoriser_Annulation_Colis === false) ? true : autoriser_OTP_annulation_expediteur ?? lastDatas.autoriser_otp_annulation_expediteur,
                    imprimer_recu_annulation: (autoriser_Annulation_Colis === false) ? true : imprimer_recu_annulation ?? lastDatas.imprimer_recu_annulation,
                    //Pour modification : 
                    autoriser_modification_colis: autoriser_Modification_Colis ?? lastDatas.autoriser_modification_colis,
                    moment_modification: (autoriser_Modification_Colis === false) ? 'Avant le retrait du colis' : moment_Modification ?? lastDatas.moment_modification,
                    autoriser_otp_modification_expediteur: (autoriser_Modification_Colis === false) ? true : autoriser_OTP_modification_Expediteur ?? lastDatas.autoriser_otp_modification_expediteur,
                    modifier_naturecolis: (autoriser_Modification_Colis === false) ? true : modifier_natureColis ?? lastDatas.modifier_naturecolis,
                    modifier_photocolis: (autoriser_Modification_Colis === false) ? true : modifier_photoColis ?? lastDatas.modifier_photocolis,
                    modifier_destinationcolis: (autoriser_Modification_Colis === false) ? true : modifier_destinationColis ?? lastDatas.modifier_destinationcolis,
                    modifier_contactexpediteur: (autoriser_Modification_Colis === false) ? true : modifier_contactExpediteur ?? lastDatas.modifier_contactexpediteur,
                    modifier_nomexpediteur: (autoriser_Modification_Colis === false) ? true : modifier_nomExpediteur ?? lastDatas.modifier_nomexpediteur,
                    modifier_nomdestinataire: (autoriser_Modification_Colis === false) ? true : modifier_nomDestinataire ?? lastDatas.modifier_nomdestinataire,
                    modifier_contactdestinataire: (autoriser_Modification_Colis === false) ? true : modifier_contactDestinataire ?? lastDatas.modifier_contactdestinataire,
                    modifier_valeurestimee: (autoriser_Modification_Colis === false) ? true : modifier_valeurEstimee ?? lastDatas.modifier_valeurestimee,
                    modifier_prixcolis: (autoriser_Modification_Colis === false) ? true : modifier_prixColis ?? lastDatas.modifier_prixcolis,
                    imprimer_recu_modification: (autoriser_Modification_Colis === false) ? true : imprimer_recu_modification ?? lastDatas.imprimer_recu_modification,
                    //Pour enregistrement : 
                    appliquer_pourcentage_prixcolis: appliquer_Pourcentage_prixColis ?? lastDatas.appliquer_pourcentage_prixcolis,
                    pourcentage_prixcolis: (appliquer_Pourcentage_prixColis === false) ? 10 : pourcentage_prixColis ?? lastDatas.pourcentage_prixcolis,
                    autoriser_gratuite_prixcolis: autoriser_Gratuite_prixColis ?? lastDatas.autoriser_gratuite_prixcolis,
                    nbrecolis_pourgratuite: (autoriser_Gratuite_prixColis === false) ? 7 : nbreColis_pourGratuite ?? lastDatas.nbrecolis_pourgratuite,
                    imposer_photocolis: imposer_PhotoColis ?? lastDatas.imposer_photocolis,
                    //Pour retrait : 
                    autoriser_otp_retrait_destinataire: autoriser_OTP_retrait_Destinataire ?? lastDatas.autoriser_otp_retrait_destinataire,
                    imposerscancodeqr_retrait: imposerScanCodeQR_retrait ?? lastDatas.imposerscancodeqr_retrait,
                    //Pour retour : 
                    autoriser_retourcolis: autoriser_RetourColis ?? lastDatas.autoriser_retourcolis,
                    //Pour reception : 
                    imposer_scancodeqr_reception: imposer_ScanCodeQR_reception ?? lastDatas.imposer_scancodeqr_reception,
                    envoiesms_destinataire_reception: envoieSMS_destinataire_reception ?? lastDatas.envoiesms_destinataire_reception,
                    notification_reception : notification_reception ?? lastDatas.notification_reception,
                    //Date automatique :
                    dateparamscolis: new Date(),
                },
                { onConflict: ['codegare'] } // Forcer la mise à jour sur `codegare`
            )
            .select()
            .maybeSingle();
        if (errorModif) {
            console.error("Erreur lors de la modification des données : ", errorModif);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
        }

        //Retourner le résultat
        return res.status(202).json({ success: true, modifications: modifParams })

    } catch (error) {
        console.error("Erreur lors de la récupération des données :", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur !" });
    }
})
//+++++++++++++++++++++++++++++++++++++++++++++++++++


// 4- Basculer entre configuration collective et locale
router.put('/configuration-collective-ou-locale/:codeGare', async (req, res) => {
    const { codeGare } = req.params;
    const { local = false } = req.body;

    try {
        if (typeof local !== 'boolean') {
            return res.status(400).json({ success: false, message: "Vous devez spécifier un booléen : true/false." });
        }

        const { data: choixConfiguration, error: errorChoix } = await supabase
            .from('choix_type_params')
            .upsert(
                {
                    codegare: codeGare,
                    parametres_gares: local
                },
                { onConflict: ['codegare'] } // Forcer la mise à jour sur `codegare`
            )
            .select()
            .maybeSingle();

        if (errorChoix) {
            console.error("Erreur lors de la mise à jour : ", errorChoix);
            return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
        }

        if (!choixConfiguration) {
            return res.status(500).json({ success: false, message: "Mise à jour non effectuée. Vérifiez que la gare spécifiée est correcte." });
        }

        // Retourner le résultat
        return res.status(202).json({ success: true, modifications: local });

    } catch (error) {
        console.error("Erreur lors de la mise à jour : ", error);
        return res.status(500).json({ success: false, message: "Erreur interne du serveur." });
    }
});
//++++++++++++++++++++++++++++++++++++++++++++++++++


// 5- Retourner le type de configuration d'une gare
router.get('/type-configuration-gare/:codeGare', async (req, res) => {
    const { codeGare } = req.params

    try {
        const { data: typeConfig, error: errorTypeConfig } = await supabase
            .from('choix_type_params')
            .select('parametres_gares')
            .eq('codegare', codeGare)
            .maybeSingle();
        if (errorTypeConfig) {
            console.error("Erreur lors de la récupération des données : ", errorTypeConfig)
            return res.status(500).json(({ success: false, message: "Erreur interne du serveur." }))
        }
        if (!typeConfig || typeConfig.length === 0) {
            return res.status(500).json(({ success: false, message: "Aucun résultat : vérifiez que vous fournissez une gare." }))
        }

        return res.status(200).json({
            success: true,
            locale: typeConfig.parametres_gares
        })

    } catch (error) {
        console.error("Erreur lors de la récupération des données : ", error)
        res.status(500).json(({ success: false, message: "Erreur interne du serveur." }))
    }
})

module.exports = router