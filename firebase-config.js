const firebaseConfig = {
    apiKey: "AIzaSyA_sg5Bpwx4B6oGGxV6So1F6fGp_wOhtOw",
    authDomain: "gosk-47e10.firebaseapp.com",
    databaseURL: "https://gosk-47e10-default-rtdb.firebaseio.com",
    projectId: "gosk-47e10",
    storageBucket: "gosk-47e10.firebasestorage.app",
    messagingSenderId: "472880925499",
    appId: "1:472880925499:web:bcc8a3cbc4b00810b4c51e",
    measurementId: "G-YRMCK7SQWD"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

const CLOUD_NAME = 'dk9xej3cf';
const UPLOAD_PRESET = 'k30_mk';

const AGORA_APP_ID_CALL = '929646610d814d529a06c4081c81325f';

const ADMIN_EMAIL = 'jasim30b@gmail.com';
const ADMIN_PASSWORD = 'bb2314bb';

console.log('✅ SPARK - Firebase, Cloudinary & Agora Ready');
