const express = require('express');
const bcrypt = require('bcrypt');
const { genereCodeSecret, envoiNotification } = require('./utils');
const supabase = require('../supabase');

const router = express.Router();

// Validation des données saisies
function validateUserData(loginUser, passwordUser) {
    const loginRegex = /^[a-zA-Z0-9_]{5,15}$/; // Login entre 5 et 15 caractères
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,20}$/; // Lettres et chiffres 8-20 caractères

    if (!loginRegex.test(loginUser)) {
        return 'Le login doit comporter entre 5 et 15 caractères.';
    }
    if (!passwordRegex.test(passwordUser)) {
        return 'Le mot de passe doit comporter entre 8 et 20 caractères, avec lettres et chiffres.';
    }
    return null;
}

// Route 1 : /envoiCode
router.post('/envoiCode', async (req, res) => {
    const { matUser, loginUser, passwordUser } = req.body;

    try {
        // Validation des données
        const validationError = validateUserData(loginUser, passwordUser);
        if (validationError) {
            return res.status(400).json({ success: false, message: validationError });
        }

        // Recherche de l'utilisateur dans la table `users`
        const { data: dataUser, error: errorUser } = await supabase
            .from('users')
            .select('*')
            .eq('matuser', matUser)
            .single();

        if (!dataUser || errorUser) {
            return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
        }

        // Cryptage du mot de passe
        const hashedPassword = await bcrypt.hash(passwordUser, 10);

        // Génération du code secret
        const codeSecret = genereCodeSecret();
        const hashedCode = await bcrypt.hash(codeSecret, 10);

        // Enregistrement du code secret dans la base de données
        const { error: insertError } = await supabase
            .from('codes_secrets')
            .insert([{
                matuser: matUser,
                codesecret: hashedCode,
                expiresat: new Date(Date.now() + 5 * 60 * 1000), // Expiration dans 5 minutes
            }]);

        if (insertError) {
            throw new Error('Erreur lors de l’enregistrement du code secret.');
        }

        console.log(`Code secret : ${codeSecret}`);

        // Récupération du contact de l'utilisateur
        const { contactser: contactUser } = dataUser;

        // Envoi du code secret via Twilio
        // await envoiNotification(contactUser, codeSecret);

        const donnees = {
            matUser,
            loginUser,
            passwordUser: hashedPassword,
            contactUser
        };

        return res.status(201).json({
            success: true,
            message: 'Code secret envoyé avec succès.',
            data: donnees,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
    }
});

// Route 2 : CONFIRMER CODE SECRET
router.post('/confirmerCode', async (req, res) => {
    const { data, codeSecret } = req.body;

    try {
        const { matUser } = data;

        // Récupérer le dernier code secret valide pour l'utilisateur
        const { data: dernierCodeSecret, error } = await supabase
            .from('codes_secrets')
            .select('*')
            .eq('matuser', matUser)
            .gte('expiresat', new Date().toISOString())
            .order('expiresat', { ascending: false })
            .limit(1)
            .single();

        if (error || !dernierCodeSecret) {
            return res.status(401).json({
                success: false,
                message: 'Code secret invalide ou expiré.',
            });
        }

        // Vérification du code secret
        const isValidCode = await bcrypt.compare(codeSecret, dernierCodeSecret.codesecret);

        if (!isValidCode) {
            return res.status(401).json({
                success: false,
                message: 'Code secret invalide.',
            });
        }

        const donnees = {
            matUser: data.matUser,
            loginUser: data.loginUser,
            passwordUser: data.passwordUser
        }


        return res.status(200).json({
            success: true,
            message: 'Code secret validé avec succès.',
            datas: donnees,
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur.',
        });
    }
});

// Route 3 : ENREGISTRER LE COMPTE PROPREMENT DIT
router.post('/enrgCompte', async (req, res) => {
    const { datas } = req.body;

    try {
        const { matUser, loginUser, passwordUser } = datas;

        // Vérification si l'utilisateur a déjà un compte
        const { data: existingAccounts } = await supabase
            .from('comptes_users')
            .select('*')
            .eq('matuser', matUser);

        if (existingAccounts && existingAccounts.length > 0) {
            const compteUser = existingAccounts.find(account => account.loginuser === loginUser);

            if (compteUser) {
                if (!compteUser.compteactif) {
                    return res.status(403).json({
                        success: false,
                        message: 'Votre compte est désactivé. Veuillez contacter l’administrateur.',
                    });
                }

                // Mise à jour du compte existant
                await supabase
                    .from('comptes_users')
                    .update({ passworduser: passwordUser })
                    .eq('matuser', matUser)
                    .eq('loginuser', loginUser);

                return res.status(200).json({
                    success: true,
                    message: 'Compte mis à jour avec succès.',
                });
            } else {
                return res.status(401).json({
                    success: false,
                    message: 'Login déjà utilisé !.',
                });
            }
        }

        // Création d'un nouveau compte
        const { error } = await supabase
            .from('comptes_users')
            .insert([{ matuser: matUser, loginuser: loginUser, passworduser: passwordUser }]);

        if (error) {
            throw new Error('Erreur lors de la création du compte.');
        }

        return res.status(201).json({
            success: true,
            message: 'Compte créé avec succès !',
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            success: false,
            message: 'Erreur interne du serveur.',
        });
    }
});

// Route GET : Liste des utilisateurs
router.get('/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('matuser', { ascending: true });

        if (error) {
            throw new Error('Erreur lors de la récupération des utilisateurs.');
        }

        res.status(200).json({
            success: true,
            data: users,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Erreur interne du serveur.' });
    }
});

module.exports = router;
