
const dotenv = require('dotenv');
const twilio = require('twilio');
const supababse = require('../supabase');
const supabase = require('../supabase');

dotenv.config();


// Génération du code secret
function genereCodeSecret() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

//*************************************************************** */
// Envoi de notifications via Twilio
async function envoiNotification(contactUser, codeSecret) {
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const clientT = twilio(accountSid, authToken);

    clientT.messages
      .create({
        body: `Votre code secret est : ${codeSecret}`,
        messagingServiceSid: 'MGa781784b9f2cb30ea1b7200955878136',
        to: `+225${contactUser}`, //'+15558675310'
      })
      .then(message => console.log(message.sid));
  } catch (error) {
    console.error("Erreur lors de l'envoi du SMS : ", error.message);
    if (error.code === 21211) {
      throw new Error('Numéro de téléphone invalide.');
    }
    throw new Error("Erreur lors de l'envoi du SMS.");
  }
}
//*************************************************************** */


//Vérification des contacts
async function contactUnique(contact) {
  try {
    //Dans la table `Fournisseurs`
    const { data: chezFournisseurs, error: errorFournisseurs } = await supababse
      .from('fournisseurs')
      .select('*')
      .eq('contactfournisseur', contact)
      .single()

    if (chezFournisseurs) {
      return true; // Retourne true si le fournisseur existe, sinon false
    }


    //Dans la table `Caissieres`
    const { data: chezCaissiere, error: errorCaissiere } = await supababse
      .from('caissieres')
      .select('*')
      .eq('contactcaissiere', contact)
      .single()

    if (chezCaissiere) {
      return true; 
    }


    //Dans la table `Users`
    const { data: chezUser, error: errorUser } = await supababse
      .from('users')
      .select('*')
      .eq('contactuser', contact)
      .single()

    if (chezUser) {
      return true; // Retourne true si la caissière existe, sinon false
    }


    //Dans la table `Conducteurs`
    const { data: chezConducteurs, error: errorConducteurs } = await supababse
      .from('conducteurs')
      .select('*')
      .eq('contactconducteur', contact)
      .single()

    if (chezConducteurs) {
      return true; 
    }

    //Dans la table `clients_fideles`
    const { data: chezClients, error: errorClients } = await supababse
      .from('clients_fideles')
      .select('*')
      .eq('contactclient', contact)
      .single()

    if (chezClients) {
      return true;
    }

    return false 
  } catch (error) {
    // Gestion des erreurs internes du serveur
    console.error('Erreur lors de la connexion:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur.'
    });
  }
}
//* ************************************ *//


//Vérification des emails
const emailUnique = async (email) => {
  try {
    // Dans la table `Users`
    const { data : chezUsers, error : errorUsers } = await supabase
      .from('users')
      .select('id')
      .eq('emailuser', email)
      .single()
    
    if (errorUsers) {
      console.error("Erreur lors de la requête :", errorUsers);
      return false;
    }

    if (chezUsers) {
      return true;
    }

    return false;
  } catch (error) {
    // Gestion des erreurs internes du serveur
    console.error('Erreur lors de la connexion:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur.'
    });
  }
}
//* ************************** *//

// Créer des formats de date "AAAA-MM-JJ", "JJMMAAAA", "AAAAMMJJ", etc.
function formatsDateDuJour(date = new Date()) {
  //const date = new Date();

  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Les mois commencent à 0 
  const day = date.getDate().toString().padStart(2, '0');

  return [
    `${year}-${month}-${day}`,
    `${day}/${month}/${year}`,
    `${day}-${month}-${year}`,
    `${day}${month}${year}`,
    `${year}${month}${day}`
  ]
}
//* ************************* *//


module.exports = {
  genereCodeSecret,
  envoiNotification,
  contactUnique,
  emailUnique,
  formatsDateDuJour,
};
