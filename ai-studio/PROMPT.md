# Texto para pegar en Google AI Studio

Adjunta estos archivos al chat de AI Studio (Build → nueva app) y pega el texto de abajo:

- `server.js`
- `package.json`
- `firestore.rules`
- `public/index.html`
- `public/og.jpg`

---

Quiero publicar una app que YA ESTÁ TERMINADA. No la rediseñes ni la reescribas: usa mis archivos exactamente como están.

Estructura del proyecto:
- `server.js`: servidor Node con Express. Atiende la página y la API (`/api/...`).
- `package.json`: arranca con `npm start` (Node 20 o más nuevo).
- `firestore.rules`: reglas de Firestore.
- `public/index.html`: toda la interfaz. No la modifiques.
- `public/og.jpg`: imagen para la vista previa en WhatsApp.

Instrucciones:
1. Es una app full-stack que se publica en Cloud Run. El servidor `server.js` atiende todo y escucha en el puerto de la variable `PORT`.
2. Activa Firebase Firestore para guardar los datos. El servidor ya usa `firebase-admin` y guarda en la colección `sorteos`.
3. NO uses Firebase Authentication ni ningún inicio de sesión. Los participantes entran solo con su enlace personal.
4. El navegador nunca debe leer ni escribir Firestore directamente. Usa exactamente las reglas de `firestore.rules`, que niegan todo acceso desde el cliente.
5. No agregues React, Vite, Tailwind ni el SDK de Firebase para el navegador. No cambies textos, colores, imágenes ni animaciones.
6. Si la base de Firestore tiene un ID distinto de "(default)", el servidor lo toma del campo `firestoreDatabaseId` de `firebase-applet-config.json` o de la variable `FIRESTORE_DATABASE_ID`. No cambies otra cosa del servidor.
7. Si al publicar aparece un error de permisos de Firestore, da a la cuenta de servicio de Cloud Run el rol "Cloud Datastore User" en el mismo proyecto.
