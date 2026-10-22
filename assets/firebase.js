import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';

const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'appId'];

export const firebaseConfigured = requiredKeys.every((key) => {
  const value = String(firebaseConfig[key] || '').trim();
  return value && !value.startsWith('COLE_AQUI') && !value.includes('SEU-PROJETO');
});

export let app = null;
export let auth = null;
export let db = null;
export let storage = null;

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  auth.languageCode = 'pt-BR';
  db = getFirestore(app);
  storage = getStorage(app);
}

export const CONFIG_ERROR_MESSAGE = 'O Firebase ainda não foi configurado. Preencha o arquivo public/assets/firebase-config.js com os dados do seu projeto.';
