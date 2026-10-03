// Firebase connection settings for this Daybook. These are not secrets: Firebase web settings are
// meant to be public. Your entries are protected by your sign-in and by firestore.rules.
export const config = {
  backend: 'firebase',
  firebase: {
    apiKey: 'AIzaSyCuxp5yhoRhz5gPl3exFQu0hW-_PqmmU6Y',
    authDomain: 'daybook-geo.firebaseapp.com',
    projectId: 'daybook-geo',
    // Web client ID used for Google sign-in on the website (public, not a secret)
    googleClientId: '832652150721-s6kpbgc8r3alkp9u1oku50q8jvpgdo97.apps.googleusercontent.com',
    appId: '1:832652150721:web:64442c71a3b87475519140'
  }
};
