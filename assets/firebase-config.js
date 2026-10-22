// Configuração do app Web do Firebase.
//
// No console do Firebase:
// 1. Abra o projeto.
// 2. Clique no ícone de engrenagem > Configurações do projeto.
// 3. Em "Seus apps", clique em "</>" (Web) e registre um app.
// 4. Copie os valores do objeto firebaseConfig para cá.
//
// A apiKey do Firebase é pública. A proteção dos dados é feita pelas
// regras do Firestore e do Storage incluídas neste projeto.

export const firebaseConfig = {
  apiKey: "AIzaSyDCX5WrOxDON_Vz2BoLD5vsLPH7TWyCaJ8",
  authDomain: "mystore-3d08c.firebaseapp.com",
  projectId: "mystore-3d08c",
  storageBucket: "mystore-3d08c.firebasestorage.app",
  messagingSenderId: "660147891847",
  appId: "1:660147891847:web:1411c09a2951dfe4881222",
  measurementId: "G-QJ967SLCPM"
};

// Como as imagens são armazenadas:
// 'firestore' = comprimidas dentro dos documentos do banco (não precisa de Cloud Storage)
// 'storage'   = enviadas para o Cloud Storage (exige ativar o Storage no console)
export const imageStorageMode = 'firestore';

// Contas Google autorizadas a entrar no portal do super administrador.
// Esta mesma lista precisa estar em firestore.rules (função isSuperAdmin).
export const superAdminEmails = [
  'marcialpsiqueira@gmail.com',
];

