const express = require('express');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { genereCodeSecret, envoiNotification } = require('./utils');
const supabase = require('../supabase'); 

const router = express.Router();

// Middleware pour limiter les tentatives de connexion
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // Fenêtre de 15 minutes
  max: 10, // Maximum de 10 tentatives autorisées
  message: 'Trop de tentatives, veuillez réessayer plus tard.',
});

// Route 1 : Login et mot de passe pour la connexion
router.post('/login', limiter, async (req, res) => {
  const { loginUser, passwordUser } = req.body;

  // Validation des champs obligatoires
  if (!loginUser || !passwordUser || passwordUser.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'Champs invalides ou mot de passe trop court.',
    });
  }

  try {
    // Recherche de l'utilisateur par son identifiant unique
    const { data: dataUser, error: errorUser } = await supabase
      .from('comptes_users')
      .select('*, users(matuser, contactuser, nomuser, prenomsuser)')
      .eq('loginuser', loginUser)
      .maybeSingle();

    if (errorUser || !dataUser) {
      return res.status(401).json({
        success: false,
        message: 'Login ou mot de passe incorrect.',
      });
    }

    // Vérification du mot de passe
    const isPasswordValid = await bcrypt.compare(passwordUser, dataUser.passworduser);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Login ou mot de passe incorrect.',
      });
    }

    // Vérification du statut du compte
    if (!dataUser.compteactif) {
      return res.status(403).json({
        success: false,
        message: 'Votre compte est désactivé. Veuillez contacter l’administrateur.',
      });
    }

    // Génération d'un code secret
    const codeSecret = genereCodeSecret();

    // Hachage du code secret
    const hashedCode = await bcrypt.hash(codeSecret, 10);

    // Enregistrement dans la base de données
    const { error: insertError } = await supabase
      .from('codes_secrets')
      .insert([
        {
          matuser: dataUser.matuser,
          codesecret: hashedCode,
          expiresat: new Date(Date.now() + 5 * 60 * 1000), // Expiration dans 5 minutes
        },
      ]);

    if (insertError) {
      throw new Error('Erreur lors de l’enregistrement du code secret.');
    }

    // Envoi du code secret (simulé)
    console.log(`Code secret pour ${dataUser.users.contactuser} : ${codeSecret}`);
    // await envoiNotification(dataUser.users.contactuser, codeSecret);

    return res.status(200).json({
      success: true,
      message: 'Code secret envoyé avec succès.',
      data: {
        matUser: dataUser.matuser,
        contactUser: dataUser.users.contactuser,
        nomUser: `${dataUser.users.nomuser} ${dataUser.users.prenomsuser}`,
      },
    });
  } catch (error) {
    console.error('Erreur lors de la connexion:', error.message);
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur.',
    });
  }
});

// Route 2 : Confirmer le code secret
router.post('/confirmerCode', async (req, res) => {
  const { data, codeSecret } = req.body;

  if (!data || !codeSecret) {
    return res.status(400).json({
      success: false,
      message: 'Données ou code secret manquants.',
    });
  }

  try {
    const { matUser } = data;

    // Récupérer le dernier code secret valide
    const { data: dernierCodeSecret, error } = await supabase
      .from('codes_secrets')
      .select('*')
      .eq('matuser', matUser)
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
    const isCodeValid = await bcrypt.compare(codeSecret, dernierCodeSecret.codesecret);
    if (!isCodeValid) {
      return res.status(401).json({
        success: false,
        message: 'Code secret invalide ou expiré.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Code secret validé avec succès.',
      matUser: data.matUser,
      nomUser: data.nomUser,

    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur.',
    });
  }
});

module.exports = router;
