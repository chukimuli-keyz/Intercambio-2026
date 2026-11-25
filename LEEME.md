# Intercambio Navideño 2026

Sorteo navideño de intercambio de regalos para 6 personas. Cada participante recibe por WhatsApp un enlace privado, elige uno de seis regalos y descubre a quién le toca regalar.

## Cómo está hecho

- **Servidor:** Cloudflare Worker (`src/worker.js`).
- **Base de datos:** un Durable Object por sorteo. Las operaciones de cada sorteo se ejecutan una por una, así que si dos personas tocan el mismo regalo al mismo tiempo solo una lo obtiene y la otra recibe “ya lo eligió alguien más”.
- **Página:** un solo archivo, `public/index.html`, sin librerías. Los regalos son SVG, el confeti y la nieve son canvas, y los sonidos se sintetizan con Web Audio (no hay archivos de audio).
- **Vista previa en WhatsApp:** `public/og.jpg`, más un título personalizado (“Andrea, te espera un regalo misterioso”).

## Reglas que valida el servidor

- Exactamente 6 nombres, sin repetir.
- Las asignaciones se generan al crear el sorteo, con una permutación aleatoria uniforme sin puntos fijos: nadie se saca a sí mismo y cada quien da y recibe un solo regalo.
- Cada enlace lleva 128 bits aleatorios: no se puede adivinar.
- Una persona solo puede elegir un regalo. Si vuelve a abrir su enlace ve el mismo resultado.
- El panel del organizador solo muestra quién ya eligió, nunca quién le tocó a quién.

## Publicarlo gratis (sin tarjeta)

### Opción A: desde GitHub, sin terminal
1. El código ya está en GitHub: `chukimuli-keyz/Intercambio-2026`.
2. Entra a dash.cloudflare.com → **Workers & Pages** → **Create** → **Import a repository**.
3. Elige el repositorio y presiona **Deploy**. Cloudflare lee `wrangler.jsonc` y crea la base de datos solo.
4. Te da una dirección como `https://intercambio-2026.TU-CUENTA.workers.dev`. Esa es la app.

### Opción B: con terminal
```bash
npm install
npx wrangler login
npx wrangler deploy
```

Para probarlo en tu computadora: `npm run dev` y abre http://localhost:8787

## Cómo se usa

1. El organizador abre la app, escribe los 6 nombres (y si quiere, la fecha y el presupuesto) y presiona **Crear sorteo y enlaces**.
2. Llega a su panel, copia el enlace de cada persona y se lo manda por WhatsApp.
3. En el panel se ve el avance (“4 de 6”), que se actualiza solo.
4. **Crear otro sorteo** abre un formulario vacío sin tocar el sorteo actual. Se pueden tener varios sorteos al mismo tiempo.
5. **Mis sorteos**, en la pantalla principal, lista los sorteos creados o abiertos desde ese dispositivo. Para abrir un panel desde otro dispositivo hay que guardar su enlace.
6. **Borrar este sorteo** pide confirmación y lo elimina: sus enlaces dejan de funcionar.

> Nota: el panel no muestra las asignaciones. Aun así, como el organizador tiene todos los enlaces, podría abrir el de otra persona. Lo mejor es mandar cada enlace sin abrirlo.
