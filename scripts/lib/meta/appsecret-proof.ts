import crypto from 'node:crypto';

/**
 * Meta `appsecret_proof` for server-side Graph calls (HMAC-SHA256 of the access token using app secret).
 * @see https://developers.facebook.com/docs/facebook-login/security/
 */
export function makeAppSecretProof(appSecret: string, accessTokenUsedInCall: string): string {
  return crypto.createHmac('sha256', appSecret).update(accessTokenUsedInCall).digest('hex');
}
