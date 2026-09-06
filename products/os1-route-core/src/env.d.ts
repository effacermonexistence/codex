// Secret binding names only. Values remain in the existing Worker secret store.
interface Env {
  TICKET_SIGNING_KEY_PKCS8: string;
  TICKET_VERIFYING_KEY_SPKI: string;
  DELIVERY_DENYLIST_JSON: string;
}
