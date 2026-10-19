# belen-app

App móvil del belén (fase D del plan `timeline-editor/docs/plan/paquete-offline.md`). Con Internet
entra en Stocka y descarga los paquetes `.belen.zip` de las timelines; junto al belén, sin Internet,
habla por Wi-Fi local con la API HTTP de la Raspberry Pi para subir un paquete, activarlo,
reproducir/parar/`panic` y **cortar cualquier puerto al instante**.

Stack: **Capacitor 8 + Vue 3 + TypeScript + Vite + Pinia**, sin kit de UI (tokens del brandbook de
Stocka en `src/styles/tokens.css`). Interfaz en **catalán** (principal) y **castellano**, con
selector y detección del idioma del dispositivo. Android primero; iOS después.

## Puesta en marcha

Requisitos: Node 20+, pnpm, y para el APK Android Studio (SDK 35 + JDK 21, lo que pida el proyecto
que genera Capacitor 8).

```bash
pnpm i                      # dependencias
pnpm dev                    # http://localhost:5180 en el navegador (ver «Desarrollo en el navegador»)
pnpm test                   # vitest
pnpm build                  # vue-tsc + vite build → dist/
npx cap sync android        # copia dist/ y los plugins al proyecto android/
npx cap open android        # abre Android Studio
```

Para el APK interno, desde Android Studio «Build > Build Bundle(s) / APK(s) > Build APK(s)», o por
terminal:

```bash
cd android && ./gradlew assembleDebug     # android/app/build/outputs/apk/debug/app-debug.apk
```

Tras cada cambio del código web: `pnpm build && npx cap sync android` y volver a compilar.

### Desarrollo en el navegador

Un navegador de escritorio no puede llamar ni a la Raspberry (no envía cabeceras CORS) ni al backend
(lista blanca de orígenes), así que `pnpm dev` levanta dos proxys: `/__pi` → la Raspberry y
`/__stocka` → Stocka. La app los usa como URL por defecto cuando detecta que corre en web en modo
dev. Destinos configurables en `.env.local`:

```
VITE_PI_PROXY_TARGET=http://belen.local:8080
VITE_STOCKA_PROXY_TARGET=https://stocka.xeye.es
```

## Estructura

```
capacitor.config.ts        appId es.xeye.stocka.belen · cleartext · CapacitorHttp
android/                   proyecto nativo generado por `cap add android` (se versiona)
src/
├── api/
│   ├── stocka.ts          cliente REST de Stocka (login, 2FA, organizaciones, timelines, show, bundle en streaming)
│   ├── pi.ts              cliente de belen-api v1 (estado, mandos, overrides, subida reanudable, SSE/polling)
│   └── errors.ts          NetworkError + helpers compartidos
├── stores/
│   ├── auth.ts            sesión de Stocka (token en Preferences)
│   ├── library.ts         paquetes descargados (ficheros en Directory.Data/bundles, índice en Preferences)
│   ├── pi.ts              conexión, estado en vivo, PIN, mandos y envío con reanudación
│   └── ui.ts              toasts y estado online/offline
├── storage/
│   ├── kv.ts / kv.capacitor.ts                 clave-valor (Preferences) + fake en memoria
│   └── bundleFiles.ts / bundleFiles.capacitor.ts  ficheros de paquetes (Filesystem) + fake en memoria
├── views/                 LoginView · OrganizationsView · TimelinesView · LibraryView · PiView
├── components/            StatusCard · PortSwitches · BundleList · UploadProgress · PinDialog
├── i18n.ts                diccionarios ca/es, `t()`, idioma del dispositivo, selector
├── styles/tokens.css      variables del brandbook (claro/oscuro); app.css: .btn .panel .badge-* .field…
├── router.ts · App.vue · main.ts · config.ts · types.ts · errorMessages.ts
└── util/                  base64, formato, nombre del paquete, URLs
```

Pestañas: **Stocka** (login → organizaciones → timelines → «Descarrega»), **Biblioteca** (paquetes
en el móvil, «Envia al pessebre», eliminar) y **Pessebre** (conexión, PIN, estado en vivo, mandos,
puertos, paquetes de la Raspberry, envío con progreso e informe, red y sistema).

## Contratos que usa

### Stocka (con Internet) — base configurable, por defecto `https://stocka.xeye.es`

JSON REST con `Authorization: Bearer <jwt>`; errores RFC 7807 (`application/problem+json`) con
`code`, `detail` y `params`.

| Método | Ruta | Uso |
|---|---|---|
| POST | `/auth/login` `{email, password, rememberMe:false}` | `{accessToken, expiresIn, user}` o `{requires2fa:true, mfaToken}` |
| POST | `/auth/login/2fa` `{mfaToken, code, rememberMe:false}` | segundo paso (TOTP o código de recuperación) |
| POST | `/auth/logout` | best effort |
| GET | `/organizations` | `[{id, name, slug, currentUserRole}]` |
| GET | `/organizations/{slug}/timelines` | `[{id, organizationId, name, createdAt, updatedAt}]` |
| GET | `/organizations/{slug}/timelines/{id}/show` | paquete `stocka-show`; la app solo lee `meta.name` y `meta.hash` |
| GET | `/organizations/{slug}/timelines/{id}/bundle` | `application/zip`, `Content-Disposition: attachment; filename="<slug>-<hash8>.belen.zip"` |

Un `422 timeline_shows.invalid` (escena con errores) trae `params.issues[]` y `params.warnings[]`
(`{level, code, message, clipId, port}`); la app los muestra bajo la timeline.

**Sesión.** El token de acceso dura 15 min (`JWT_EXPIRATION_TIME`). El refresco del backend va por
la cookie httpOnly `stocka_refresh` (`SameSite=Lax`, `Path=/auth`) y la política CORS no admite
credenciales, así que una app nativa no puede usarlo. Decisión: la app guarda el token de acceso y,
cuando el backend responde `401 auth.token_expired`/`auth.unauthenticated`, borra la sesión y vuelve
a pedir la contraseña (correo prellenado). Es suficiente para el flujo «entrar → descargar»; si algún
día hace falta sesión larga en móvil, el backend tendría que exponer un refresh por cuerpo
(`refreshToken` en JSON) o aceptar credenciales por CORS.

**Descarga.** Primero `GET …/show` (nombre, hash completo y, si procede, el 422 con los problemas) y
después `GET …/bundle` en streaming (`response.body.getReader()`) hacia el fichero
`bundles/<slug>-<hash8>.belen.zip` de `Directory.Data`. El nombre se calcula con la misma regla que
`ShowBundleWriter`/`tools/bundle_tool.py`. El índice de la biblioteca (`fileName, hash, name,
orgSlug, orgName, timelineId, size, downloadedAt`) se guarda en Preferences.

### Raspberry Pi (sin Internet) — `http://belen.local:8080` o `http://10.42.0.1:8080`

Fuente de verdad: `rpi4-system/app/api/server.py`. Lecturas libres; escrituras con
`Authorization: Pin 123456` (+ `X-Name`) en cada petición (sin cookie de sesión). Errores
`{error, message}`: `pin_required`/`pin_invalid` (401), `pin_locked` (429), `no_show`,
`already_playing`, `unknown_show`, `unknown_target`, `invalid_show`, `rollback_failed`.

| Método | Ruta | Uso en la app |
|---|---|---|
| GET | `/api/info` | comprobar que la dirección responde; nombre del dispositivo, versión |
| GET | `/api/status` · `/api/events` (SSE) | estado en vivo: `state, showName, mode, cycle, cycleMs, durationMs, hardware[{name,kind,off}], lastError…` |
| GET | `/api/bundles` · `/api/net` · `/api/logs?n=` | paquetes almacenados, red, registro |
| POST | `/api/bundles?activate=1` (multipart `file`) | paquetes ≤ 4 MiB en una sola petición |
| POST/PUT/POST | `/api/uploads` → `/api/uploads/{id}` (`Content-Range: bytes a-b/total`) → `/api/uploads/{id}/finish?activate=` | subida reanudable en trozos de 1 MiB; `409 bad_offset` devuelve `received` y la app resincroniza; `GET /api/uploads/{id}` reanuda tras reiniciar la app (el `uploadId` se guarda por fichero y Raspberry) |
| POST | `/api/bundles/{hash}/activate` · `/api/rollback` · DELETE `/api/bundles/{hash}` | gestión de paquetes |
| POST | `/api/play` `{cycles?}` · `/api/stop` · `/api/panic` | mandos |
| PUT | `/api/overrides` `{target, mode: "off"|"normal"}` · DELETE `/api/overrides` | **cortar / restablecer un puerto**; los cortados se muestran en rojo |
| POST | `/api/net/mode` `{mode}` · `/api/net/hotspot` · `/api/system/reboot` | acciones rápidas, siempre tras confirmación |

Reintentos de los trozos: errores de transporte y 5xx con backoff 0,5 s → 1 s → 2 s (4 intentos);
los 4xx (PIN, offset, 404) no se reintentan. El informe de importación (`ok, hash, name, errors[],
warnings[], imported[], skipped[], activated`) se muestra tal cual, también cuando la Raspberry
rechaza el paquete (422).

## Red en el dispositivo (Android)

- **HTTP en claro.** `capacitor.config.ts` lleva `server.cleartext: true`; `cap sync` añade
  `android:usesCleartextTraffic="true"` al manifiesto que se fusiona desde
  `android/capacitor-cordova-android-plugins/`. Sin esto Android 9+ bloquea `http://belen.local`.
  Si se prefiere acotarlo, sustitúyase por un `res/xml/network_security_config.xml` con
  `<domain-config cleartextTrafficPermitted="true">` para `belen.local`, `10.42.0.1` y el rango del
  hotspot, referenciado con `android:networkSecurityConfig` en `<application>`.
- **CORS.** La página de la app vive en `https://localhost` dentro del WebView. La Raspberry no
  envía cabeceras CORS y el backend tiene lista blanca, así que `plugins.CapacitorHttp.enabled: true`
  hace que `fetch` salga por la pila nativa: los GET pasan por el proxy local del WebView (en
  streaming, binario intacto, cabeceras reenviadas) y los POST/PUT/DELETE por el plugin, que
  decodifica los cuerpos `File` (los trozos se envían como `File`, no como `ArrayBuffer`, por eso).
  Si se desactivara CapacitorHttp habría que añadir `https://localhost` (y `capacitor://localhost`
  en iOS) a `CORS_ALLOWED_ORIGINS` del backend y dar CORS a la Raspberry.
- **SSE.** `EventSource` no pasa por el plugin, así que en el móvil el estado se obtiene por
  **polling cada 2 s** de `/api/status` (`android.allowMixedContent: true` queda por si algún día la
  Raspberry añade CORS y el stream funciona; la app cae a polling automáticamente si falla).
- **iOS (pendiente).** Añadir a `Info.plist` `NSAppTransportSecurity` → `NSAllowsLocalNetworking: true`
  y `NSLocalNetworkUsageDescription`; `npx cap add ios`.

## Almacenamiento y memoria

- Paquetes en `Directory.Data/bundles/` (privado de la app; no se borra al limpiar la caché).
- La descarga se escribe en trozos de 768 KiB (múltiplo de 3 para que cada pieza base64 no lleve
  relleno): un paquete de 50 MB nunca ocupa más de ~2 MB en el JS (trozo + su copia base64); el
  coste es el +33 % de base64 por el puente nativo. La subida lee rangos `offset/length` con el
  plugin Filesystem 8.1+, así que solo el trozo en vuelo (1 MiB) está en memoria. En web (dev) no hay
  lectura por rangos y el fichero se carga entero una vez.
- El PIN se guarda en Preferences (SharedPreferences, sin cifrar): protege un dispositivo de una
  red local y la etiqueta de la caja ya lo lleva impreso. Si se quiere, cambiarlo a un plugin de
  almacenamiento seguro es un único punto (`stores/pi.ts`).

## Tests

`pnpm test` (vitest, entorno node, sin DOM):

- `src/api/pi.test.ts`: fake de `belen-api` en memoria; troceado y `Content-Range`, reanudación por
  `uploadId`, `409 bad_offset` tras respuesta perdida, reintentos con backoff, límite de intentos,
  PIN erróneo sin reintento, `pin_required` sin tocar la red, 422 del `finish`, aborto, multipart
  para ficheros pequeños, SSE → polling.
- `src/api/stocka.test.ts`: mapeo de errores RFC 7807 (422 con `issues`/`warnings`, 401,
  cuerpos no JSON, fallo de red), login con y sin 2FA, cabeceras, descarga en streaming.
- `src/stores/library.test.ts`: índice (añadir, sustituir, borrar, persistir, restaurar), descarga
  con cliente falso, deduplicación por hash, sustitución del fichero antiguo, error 422.
- `src/storage/bundleFiles.capacitor.test.ts`: escritura por trozos base64 y lectura por rangos con
  un Filesystem falso.
- `src/i18n.test.ts`: todas las claves de `ca` existen en `es` y viceversa, mismos placeholders.
- `src/util/bundleName.test.ts`: slug/nombre del paquete y `Content-Disposition`.
- `src/api/pi.integration.test.ts` (se salta si no hay entorno): contra una `belen-api` real, por
  ejemplo `python main.py --simulate --no-screen --port 8081 --storage /tmp/belen` en rpi4-system:
  `BELEN_PI_URL=http://127.0.0.1:8081 BELEN_PI_PIN=<pin de device.json> BELEN_BUNDLE=x.belen.zip pnpm test`.
  Sube por trozos, activa, corta y restablece un puerto, play/stop y comprueba el `skipped` al reenviar.

## Estado

Hecho y probado: clientes de ambas APIs (unit + integración contra la `belen-api` simulada real),
biblioteca, flujos de las tres pestañas recorridos en el navegador con `pnpm dev` (login, 2FA,
organizaciones, descarga con 422, biblioteca, conexión, PIN, envío con informe, cortes de puerto,
play/stop), i18n, estilos, proyecto Android generado y sincronizado. **No se ha ejecutado en un
dispositivo ni compilado el APK aquí** (sin SDK de Android): la primera prueba real debe comprobar
cleartext hacia la Raspberry, la subida por trozos a través de CapacitorHttp (cuerpos `File`) y la
descarga en streaming por el proxy del WebView.
