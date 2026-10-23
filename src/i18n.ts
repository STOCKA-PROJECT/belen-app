import { computed, ref } from 'vue'

import type { KeyValueStore } from './storage/kv'

export type Locale = 'ca' | 'es'

/** Catalan is the primary language: its keys define the message catalogue. */
const ca = {
  'app.title': 'Pessebre',
  'app.tab.stocka': 'Stocka',
  'app.tab.library': 'Biblioteca',
  'app.tab.pi': 'Pessebre',
  'app.offline': 'Sense connexió a Internet. La biblioteca i el pessebre segueixen funcionant.',

  'common.cancel': 'Cancel·la',
  'common.close': 'Tanca',
  'common.save': 'Desa',
  'common.delete': 'Elimina',
  'common.activate': 'Activa',
  'common.active': 'Actiu',
  'common.previous': 'Anterior',
  'common.retry': 'Torna-ho a provar',
  'common.refresh': 'Actualitza',
  'common.back': 'Enrere',
  'common.loading': 'Carregant…',
  'common.done': 'Fet',
  'common.send': 'Envia',
  'common.none': 'cap',

  'login.title': 'Entra a Stocka',
  'login.server': 'Servidor',
  'login.email': 'Correu',
  'login.password': 'Contrasenya',
  'login.submit': 'Entra',
  'login.busy': 'Entrant…',
  'login.offline': 'Per entrar a Stocka cal Internet. La biblioteca i el pessebre funcionen sense.',
  'login.expired': 'La sessió ha caducat. Torna a entrar amb la teva contrasenya.',
  'login.twofactor.title': 'Verificació en dos passos',
  'login.twofactor.hint': "Escriu el codi de l'aplicació d'autenticació o un codi de recuperació.",
  'login.twofactor.code': 'Codi',
  'login.twofactor.submit': 'Verifica',
  'login.loggedAs': 'Has entrat com a {email}',
  'login.logout': 'Surt',
  'login.sessionNote': "La sessió de Stocka dura 15 minuts; quan caduqui et tornarem a demanar la contrasenya. Els paquets descarregats es queden al mòbil.",

  'error.network': "No s'ha pogut connectar amb el servidor.",
  'error.invalidCredentials': 'Correu o contrasenya incorrectes.',
  'error.twofactorInvalid': 'El codi de verificació no és vàlid.',
  'error.twofactorExpired': 'El pas de verificació ha caducat. Torna a entrar.',
  'error.emailNotVerified': "El correu no s'ha verificat.",
  'error.sessionExpired': 'La sessió ha caducat.',
  'error.forbidden': 'No tens permís per fer aquesta acció.',
  'error.notFound': "No s'ha trobat.",
  'error.showInvalid': "El show té errors que impedeixen exportar-lo. Corregeix-los a l'editor:",
  'error.sceneNotFound': 'Aquesta timeline encara no té cap escena.',
  'error.assetNotFound': "Falta un fitxer d'àudio o vídeo al servidor.",
  'error.unknown': 'Error inesperat: {message}',

  'orgs.title': 'Organitzacions',
  'orgs.empty': 'No pertanys a cap organització.',
  'orgs.role.OWNER': 'Propietari',
  'orgs.role.MANAGER': 'Gestor',
  'orgs.role.USER': 'Usuari',
  'orgs.role.SPECTATOR': 'Espectador',

  'timelines.title': 'Timelines',
  'timelines.empty': 'Aquesta organització no té cap timeline.',
  'timelines.download': 'Descarrega',
  'timelines.redownload': 'Torna a descarregar',
  'timelines.preparing': 'Preparant el paquet…',
  'timelines.downloading': 'Descarregant… {percent}%',
  'timelines.downloadingBytes': 'Descarregant… {bytes}',
  'timelines.inLibrary': 'A la biblioteca',
  'timelines.saved': 'Paquet desat a la biblioteca',
  'timelines.updatedAt': 'Actualitzada {date}',

  'library.title': 'Biblioteca',
  'library.empty': 'Encara no has descarregat cap paquet. Entra a Stocka i prem «Descarrega» en una timeline.',
  'library.send': 'Envia al pessebre',
  'library.confirmDelete': 'Eliminar «{name}» del mòbil?',
  'library.downloadedAt': 'Descarregat {date}',
  'library.count': '{count} paquets',
  'library.onPi': 'Al pessebre',
  'library.activeOnPi': 'Actiu al pessebre',

  'pi.connection': 'Connexió',
  'pi.url': 'Adreça de la Raspberry',
  'pi.urlHint': "Connecta el mòbil a la Wi-Fi «belen» (o engega el teu punt d'accés) i prova una d'aquestes adreces.",
  'pi.connect': 'Connecta',
  'pi.connecting': 'Connectant…',
  'pi.connected': 'Connectada',
  'pi.disconnected': 'Sense connexió',
  'pi.unreachable': "No s'ha trobat cap Raspberry a {url}.",
  'pi.device': 'Dispositiu',
  'pi.version': 'Versió',
  'pi.uptime': 'Encesa des de fa',
  'pi.free': 'Espai lliure',
  'pi.simulated': 'simulat',

  'pi.pin': 'PIN',
  'pi.pinSaved': 'PIN desat en aquest mòbil',
  'pi.pinMissing': 'Sense PIN només pots mirar.',
  'pi.pinChange': 'Canvia el PIN',
  'pi.pinEnter': 'Entra el PIN',
  'pi.pinTitle': 'Entra el PIN',
  'pi.pinHint': "El PIN de 6 xifres és a l'etiqueta de la caixa. Només cal per canviar coses; mirar l'estat és lliure.",
  'pi.pinName': 'El teu nom (opcional)',
  'pi.pinInvalid': 'PIN incorrecte.',
  'pi.pinLocked': 'Massa intents; espera un minut.',
  'pi.pinRequired': 'Cal el PIN per fer això.',

  'pi.status': 'Estat',
  'pi.show': 'Show',
  'pi.mode': 'Mode',
  'pi.cycle': 'Cicle',
  'pi.lastError': 'Últim error',
  'pi.state.BOOT': 'Arrencant',
  'pi.state.SAFE': 'En segur',
  'pi.state.IDLE': 'A punt',
  'pi.state.PLAYING': 'Reproduint',
  'pi.state.TEST': 'Mode prova',
  'pi.state.ERROR': 'Error',
  'pi.mode.once': 'un cop',
  'pi.mode.loop': 'en bucle',
  'pi.mode.pulse': 'en activar-se un sensor',

  'pi.play': 'Reprodueix',
  'pi.stop': 'Para',
  'pi.panic': 'Tot en segur',
  'pi.confirmPanic': 'Parar-ho tot i deixar les sortides en segur?',

  'pi.ports': 'Ports',
  'pi.portsHint': 'Un port tallat queda apagat i ignora el show fins que el restableixis. Els talls es conserven en reiniciar.',
  'pi.cut': 'Talla',
  'pi.restore': 'Restableix',
  'pi.cutBadge': 'TALLAT',
  'pi.restoreAll': 'Restableix tots els ports',
  'pi.noPorts': 'Sense show carregat no hi ha ports.',
  'pi.cutCount': '{count} tallats',
  'pi.sensorNoCut': 'Sensor de seguretat: no es pot tallar.',

  'pi.alerts': 'Alertes',
  'pi.alertsClear': 'Esborrar alertes',
  'pi.alert.motor_timeout': 'Motor aturat per temps màxim',
  'pi.alert.sensor_stop_show': 'Sensor: show aturat',
  'pi.alert.sensor_panic': 'Sensor: tot en segur',
  'pi.alert.unknown': 'Alerta ({code})',
  'pi.unlock': 'Desbloquejar',
  'pi.motorUnlocked': 'Motor «{name}» desbloquejat.',
  'pi.motorNotLocked': 'El motor «{name}» ja no estava bloquejat.',
  'pi.ago.now': 'ara mateix',
  'pi.ago.seconds': 'fa {n} s',
  'pi.ago.minutes': 'fa {n} min',
  'pi.ago.hours': 'fa {n} h',
  'pi.ago.days': 'fa {n} dies',

  'pi.sensors': 'Sensors',
  'pi.sensorsNone': 'Aquest show no té sensors.',
  'pi.sensorActive': 'actiu',
  'pi.sensorInactive': 'inactiu',
  'pi.sensorNoReading': 'sense lectura',
  'pi.sensorOn.none': 'no fa res',
  'pi.sensorOn.play': 'inicia el show',
  'pi.sensorOn.stop_show': 'atura el show',
  'pi.sensorOn.panic': 'tot en segur',

  'pi.motor.forward': 'Girant',
  'pi.motor.reverse': 'Girant (invertit)',
  'pi.motor.stopped': 'Aturat',
  'pi.motorLocked': 'BLOQUEJAT',
  'pi.motorLastEnd': 'última aturada: {reason}',
  'pi.motorEnd.time': 'fi del clip',
  'pi.motorEnd.limit': 'final de carrera',
  'pi.motorEnd.max_time': 'temps màxim',
  'pi.motorEnd.stop': 'aturat',
  'pi.motorEnd.blocked': 'tallat',
  'pi.motorEnd.locked': 'bloquejat',

  'pi.bundles': 'Paquets a la Raspberry',
  'pi.rollback': "Torna a l'anterior",
  'pi.confirmDelete': 'Esborrar aquest paquet de la Raspberry?',
  'pi.noBundles': 'La Raspberry no té cap paquet.',
  'pi.imported': 'Importat {date}',

  'pi.send': 'Envia des de la biblioteca',
  'pi.sendHint': "Tria un paquet descarregat. S'envia per trossos i es reprèn sol si la Wi-Fi falla.",
  'pi.activateAfter': "Activa'l en acabar",
  'pi.uploading': 'Enviant {name}… {percent}%',
  'pi.verifying': 'Verificant a la Raspberry…',
  'pi.importOk': 'Paquet importat',
  'pi.importRejected': 'Paquet rebutjat',
  'pi.importActivated': 'i activat',
  'pi.importSkipped': 'ja hi era',
  'pi.uploadFailed': "No s'ha pogut enviar: {message}",
  'pi.libraryEmpty': 'La biblioteca és buida: descarrega paquets des de Stocka quan tinguis Internet.',
  'pi.alreadyOnPi': 'Ja és a la Raspberry',

  'pi.net': 'Xarxa',
  'pi.netMode': 'Mode',
  'pi.netAp': 'Sempre Wi-Fi pròpia',
  'pi.netAuto': 'Xarxes conegudes',
  'pi.netHotspotNow': 'Força la Wi-Fi pròpia ara',
  'pi.netHotspotActive': 'Wi-Fi pròpia activa',
  'pi.netDisconnected': 'Sense connexió',
  'pi.netSsid': 'Xarxa',
  'pi.netIp': 'IP',
  'pi.netDisabled': 'El gestor de xarxa està desactivat.',
  'pi.confirmNetMode': 'Canviar el mode de xarxa? Pots perdre la connexió amb la Raspberry.',
  'pi.confirmHotspot': 'Forçar la Wi-Fi pròpia? Hauràs de connectar el mòbil a la xarxa «{ssid}».',
  'pi.system': 'Sistema',
  'pi.reboot': 'Reinicia la Raspberry',
  'pi.confirmReboot': 'Reiniciar la Raspberry? Tornarà en un minut.',
  'pi.logs': 'Registre',
  'pi.logsEmpty': 'Sense registre.',
} as const

export type MessageKey = keyof typeof ca

const es: Record<MessageKey, string> = {
  'app.title': 'Belén',
  'app.tab.stocka': 'Stocka',
  'app.tab.library': 'Biblioteca',
  'app.tab.pi': 'Belén',
  'app.offline': 'Sin conexión a Internet. La biblioteca y el belén siguen funcionando.',

  'common.cancel': 'Cancelar',
  'common.close': 'Cerrar',
  'common.save': 'Guardar',
  'common.delete': 'Eliminar',
  'common.activate': 'Activar',
  'common.active': 'Activo',
  'common.previous': 'Anterior',
  'common.retry': 'Reintentar',
  'common.refresh': 'Actualizar',
  'common.back': 'Atrás',
  'common.loading': 'Cargando…',
  'common.done': 'Hecho',
  'common.send': 'Enviar',
  'common.none': 'ninguno',

  'login.title': 'Entra en Stocka',
  'login.server': 'Servidor',
  'login.email': 'Correo',
  'login.password': 'Contraseña',
  'login.submit': 'Entrar',
  'login.busy': 'Entrando…',
  'login.offline': 'Para entrar en Stocka hace falta Internet. La biblioteca y el belén funcionan sin ella.',
  'login.expired': 'La sesión ha caducado. Vuelve a entrar con tu contraseña.',
  'login.twofactor.title': 'Verificación en dos pasos',
  'login.twofactor.hint': 'Escribe el código de la aplicación de autenticación o un código de recuperación.',
  'login.twofactor.code': 'Código',
  'login.twofactor.submit': 'Verificar',
  'login.loggedAs': 'Has entrado como {email}',
  'login.logout': 'Salir',
  'login.sessionNote': 'La sesión de Stocka dura 15 minutos; cuando caduque te pediremos la contraseña otra vez. Los paquetes descargados se quedan en el móvil.',

  'error.network': 'No se ha podido conectar con el servidor.',
  'error.invalidCredentials': 'Correo o contraseña incorrectos.',
  'error.twofactorInvalid': 'El código de verificación no es válido.',
  'error.twofactorExpired': 'El paso de verificación ha caducado. Vuelve a entrar.',
  'error.emailNotVerified': 'El correo no se ha verificado.',
  'error.sessionExpired': 'La sesión ha caducado.',
  'error.forbidden': 'No tienes permiso para hacer esto.',
  'error.notFound': 'No se ha encontrado.',
  'error.showInvalid': 'El show tiene errores que impiden exportarlo. Corrígelos en el editor:',
  'error.sceneNotFound': 'Esta timeline todavía no tiene escena.',
  'error.assetNotFound': 'Falta un fichero de audio o vídeo en el servidor.',
  'error.unknown': 'Error inesperado: {message}',

  'orgs.title': 'Organizaciones',
  'orgs.empty': 'No perteneces a ninguna organización.',
  'orgs.role.OWNER': 'Propietario',
  'orgs.role.MANAGER': 'Gestor',
  'orgs.role.USER': 'Usuario',
  'orgs.role.SPECTATOR': 'Espectador',

  'timelines.title': 'Timelines',
  'timelines.empty': 'Esta organización no tiene ninguna timeline.',
  'timelines.download': 'Descargar',
  'timelines.redownload': 'Volver a descargar',
  'timelines.preparing': 'Preparando el paquete…',
  'timelines.downloading': 'Descargando… {percent}%',
  'timelines.downloadingBytes': 'Descargando… {bytes}',
  'timelines.inLibrary': 'En la biblioteca',
  'timelines.saved': 'Paquete guardado en la biblioteca',
  'timelines.updatedAt': 'Actualizada {date}',

  'library.title': 'Biblioteca',
  'library.empty': 'Todavía no has descargado ningún paquete. Entra en Stocka y pulsa «Descargar» en una timeline.',
  'library.send': 'Enviar al belén',
  'library.confirmDelete': '¿Eliminar «{name}» del móvil?',
  'library.downloadedAt': 'Descargado {date}',
  'library.count': '{count} paquetes',
  'library.onPi': 'En el belén',
  'library.activeOnPi': 'Activo en el belén',

  'pi.connection': 'Conexión',
  'pi.url': 'Dirección de la Raspberry',
  'pi.urlHint': 'Conecta el móvil a la Wi-Fi «belen» (o enciende tu punto de acceso) y prueba una de estas direcciones.',
  'pi.connect': 'Conectar',
  'pi.connecting': 'Conectando…',
  'pi.connected': 'Conectada',
  'pi.disconnected': 'Sin conexión',
  'pi.unreachable': 'No se ha encontrado ninguna Raspberry en {url}.',
  'pi.device': 'Dispositivo',
  'pi.version': 'Versión',
  'pi.uptime': 'Encendida desde hace',
  'pi.free': 'Espacio libre',
  'pi.simulated': 'simulado',

  'pi.pin': 'PIN',
  'pi.pinSaved': 'PIN guardado en este móvil',
  'pi.pinMissing': 'Sin PIN solo puedes mirar.',
  'pi.pinChange': 'Cambiar el PIN',
  'pi.pinEnter': 'Introducir el PIN',
  'pi.pinTitle': 'Introduce el PIN',
  'pi.pinHint': 'El PIN de 6 cifras está en la etiqueta de la caja. Solo hace falta para cambiar cosas; mirar el estado es libre.',
  'pi.pinName': 'Tu nombre (opcional)',
  'pi.pinInvalid': 'PIN incorrecto.',
  'pi.pinLocked': 'Demasiados intentos; espera un minuto.',
  'pi.pinRequired': 'Hace falta el PIN para esto.',

  'pi.status': 'Estado',
  'pi.show': 'Show',
  'pi.mode': 'Modo',
  'pi.cycle': 'Ciclo',
  'pi.lastError': 'Último error',
  'pi.state.BOOT': 'Arrancando',
  'pi.state.SAFE': 'En seguro',
  'pi.state.IDLE': 'Listo',
  'pi.state.PLAYING': 'Reproduciendo',
  'pi.state.TEST': 'Modo prueba',
  'pi.state.ERROR': 'Error',
  'pi.mode.once': 'una vez',
  'pi.mode.loop': 'en bucle',
  'pi.mode.pulse': 'al activarse un sensor',

  'pi.play': 'Reproducir',
  'pi.stop': 'Parar',
  'pi.panic': 'Todo en seguro',
  'pi.confirmPanic': '¿Parar todo y dejar las salidas en seguro?',

  'pi.ports': 'Puertos',
  'pi.portsHint': 'Un puerto cortado queda apagado e ignora el show hasta que lo restablezcas. Los cortes se conservan al reiniciar.',
  'pi.cut': 'Cortar',
  'pi.restore': 'Restablecer',
  'pi.cutBadge': 'CORTADO',
  'pi.restoreAll': 'Restablecer todos los puertos',
  'pi.noPorts': 'Sin show cargado no hay puertos.',
  'pi.cutCount': '{count} cortados',
  'pi.sensorNoCut': 'Sensor de seguridad: no se puede cortar.',

  'pi.alerts': 'Alertas',
  'pi.alertsClear': 'Borrar alertas',
  'pi.alert.motor_timeout': 'Motor parado por tiempo máximo',
  'pi.alert.sensor_stop_show': 'Sensor: show parado',
  'pi.alert.sensor_panic': 'Sensor: todo en seguro',
  'pi.alert.unknown': 'Alerta ({code})',
  'pi.unlock': 'Desbloquear',
  'pi.motorUnlocked': 'Motor «{name}» desbloqueado.',
  'pi.motorNotLocked': 'El motor «{name}» ya no estaba bloqueado.',
  'pi.ago.now': 'ahora mismo',
  'pi.ago.seconds': 'hace {n} s',
  'pi.ago.minutes': 'hace {n} min',
  'pi.ago.hours': 'hace {n} h',
  'pi.ago.days': 'hace {n} días',

  'pi.sensors': 'Sensores',
  'pi.sensorsNone': 'Este show no tiene sensores.',
  'pi.sensorActive': 'activo',
  'pi.sensorInactive': 'inactivo',
  'pi.sensorNoReading': 'sin lectura',
  'pi.sensorOn.none': 'no hace nada',
  'pi.sensorOn.play': 'inicia el show',
  'pi.sensorOn.stop_show': 'para el show',
  'pi.sensorOn.panic': 'todo en seguro',

  'pi.motor.forward': 'Girando',
  'pi.motor.reverse': 'Girando (invertido)',
  'pi.motor.stopped': 'Parado',
  'pi.motorLocked': 'BLOQUEADO',
  'pi.motorLastEnd': 'última parada: {reason}',
  'pi.motorEnd.time': 'fin del clip',
  'pi.motorEnd.limit': 'final de carrera',
  'pi.motorEnd.max_time': 'tiempo máximo',
  'pi.motorEnd.stop': 'parado',
  'pi.motorEnd.blocked': 'cortado',
  'pi.motorEnd.locked': 'bloqueado',

  'pi.bundles': 'Paquetes en la Raspberry',
  'pi.rollback': 'Volver al anterior',
  'pi.confirmDelete': '¿Borrar este paquete de la Raspberry?',
  'pi.noBundles': 'La Raspberry no tiene ningún paquete.',
  'pi.imported': 'Importado {date}',

  'pi.send': 'Enviar desde la biblioteca',
  'pi.sendHint': 'Elige un paquete descargado. Se envía por trozos y se reanuda solo si la Wi-Fi falla.',
  'pi.activateAfter': 'Activarlo al terminar',
  'pi.uploading': 'Enviando {name}… {percent}%',
  'pi.verifying': 'Verificando en la Raspberry…',
  'pi.importOk': 'Paquete importado',
  'pi.importRejected': 'Paquete rechazado',
  'pi.importActivated': 'y activado',
  'pi.importSkipped': 'ya estaba',
  'pi.uploadFailed': 'No se ha podido enviar: {message}',
  'pi.libraryEmpty': 'La biblioteca está vacía: descarga paquetes desde Stocka cuando tengas Internet.',
  'pi.alreadyOnPi': 'Ya está en la Raspberry',

  'pi.net': 'Red',
  'pi.netMode': 'Modo',
  'pi.netAp': 'Siempre Wi-Fi propia',
  'pi.netAuto': 'Redes conocidas',
  'pi.netHotspotNow': 'Forzar la Wi-Fi propia ahora',
  'pi.netHotspotActive': 'Wi-Fi propia activa',
  'pi.netDisconnected': 'Sin conexión',
  'pi.netSsid': 'Red',
  'pi.netIp': 'IP',
  'pi.netDisabled': 'El gestor de red está desactivado.',
  'pi.confirmNetMode': '¿Cambiar el modo de red? Puedes perder la conexión con la Raspberry.',
  'pi.confirmHotspot': '¿Forzar la Wi-Fi propia? Tendrás que conectar el móvil a la red «{ssid}».',
  'pi.system': 'Sistema',
  'pi.reboot': 'Reiniciar la Raspberry',
  'pi.confirmReboot': '¿Reiniciar la Raspberry? Volverá en un minuto.',
  'pi.logs': 'Registro',
  'pi.logsEmpty': 'Sin registro.',
}

export const messages: Record<Locale, Record<MessageKey, string>> = { ca, es }

export const LOCALES: Locale[] = ['ca', 'es']

/** Catalan unless the device language is Spanish. */
export function detectLocale(language: string | undefined | null): Locale {
  return (language ?? '').toLowerCase().startsWith('es') ? 'es' : 'ca'
}

export const locale = ref<Locale>(detectLocale(typeof navigator !== 'undefined' ? navigator.language : undefined))

let persistence: KeyValueStore | null = null
const LOCALE_KEY = 'ui.locale'

/** Loads the saved language, if any, and remembers where to save future changes. */
export async function initI18n(kv: KeyValueStore): Promise<void> {
  persistence = kv
  const saved = await kv.get(LOCALE_KEY)
  if (saved === 'ca' || saved === 'es') locale.value = saved
  applyDocumentLang()
}

export function setLocale(next: Locale): void {
  locale.value = next
  applyDocumentLang()
  void persistence?.set(LOCALE_KEY, next)
}

export function toggleLocale(): void {
  setLocale(locale.value === 'ca' ? 'es' : 'ca')
}

function applyDocumentLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale.value
}

/** Interpolates `{name}` placeholders. */
export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/** Translates `key` in the current locale, falling back to Catalan and then to the key itself. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const table = messages[locale.value]
  return format(table[key] ?? ca[key] ?? key, params)
}

/** Composable form: `t` and the reactive locale for templates. */
export function useI18n() {
  return { t, locale, setLocale, toggleLocale, otherLocale: computed(() => (locale.value === 'ca' ? 'es' : 'ca')) }
}
