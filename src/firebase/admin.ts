import admin from "firebase-admin";
import path from "path";
import { config } from "../config";

/**
 * Inicializa o Firebase Admin SDK usando o arquivo de credenciais da
 * service account apontado em FIREBASE_SERVICE_ACCOUNT_PATH.
 *
 * Este módulo deve ser importado apenas uma vez (efeito colateral de
 * inicialização). Os demais módulos devem importar `db` a partir daqui.
 */
if (admin.apps.length === 0) {
  const serviceAccountPath = path.resolve(
    process.cwd(),
    config.firebase.serviceAccountPath
  );

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const serviceAccount = require('../../serviceAccountKey.json');

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  console.log("[Firebase] Firebase Admin inicializado com sucesso.");
}

export const db = admin.firestore();
export const FieldValue = admin.firestore.FieldValue;
export default admin;
