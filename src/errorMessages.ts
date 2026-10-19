import { NetworkError } from './api/errors'
import { PI_CODES, PiApiError } from './api/pi'
import { STOCKA_CODES, StockaApiError } from './api/stocka'
import { t } from './i18n'

/** User-facing text for an error raised by the Stocka client. */
export function stockaErrorMessage(err: unknown): string {
  if (err instanceof NetworkError) return t('error.network')
  if (err instanceof StockaApiError) {
    switch (err.code) {
      case STOCKA_CODES.invalidCredentials:
        return t('error.invalidCredentials')
      case STOCKA_CODES.twoFactorInvalidCode:
        return t('error.twofactorInvalid')
      case STOCKA_CODES.twoFactorTokenExpired:
        return t('error.twofactorExpired')
      case STOCKA_CODES.emailNotVerified:
        return t('error.emailNotVerified')
      case STOCKA_CODES.tokenExpired:
      case STOCKA_CODES.unauthenticated:
        return t('error.sessionExpired')
      case STOCKA_CODES.showInvalid:
        return t('error.showInvalid')
      case STOCKA_CODES.showSceneNotFound:
        return t('error.sceneNotFound')
      case STOCKA_CODES.showAssetNotFound:
        return t('error.assetNotFound')
      default:
        if (err.status === 401) return t('error.sessionExpired')
        if (err.status === 403) return t('error.forbidden')
        if (err.status === 404) return t('error.notFound')
        return err.detail || t('error.unknown', { message: err.code })
    }
  }
  return t('error.unknown', { message: err instanceof Error ? err.message : String(err) })
}

/** User-facing text for an error raised by the Pi client. */
export function piErrorMessage(err: unknown): string {
  if (err instanceof NetworkError) return t('error.network')
  if (err instanceof PiApiError) {
    switch (err.code) {
      case PI_CODES.pinRequired:
        return t('pi.pinRequired')
      case PI_CODES.pinInvalid:
        return t('pi.pinInvalid')
      case PI_CODES.pinLocked:
        return t('pi.pinLocked')
      default:
        return err.message || err.code
    }
  }
  return t('error.unknown', { message: err instanceof Error ? err.message : String(err) })
}
