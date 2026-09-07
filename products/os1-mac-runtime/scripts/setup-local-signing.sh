#!/bin/bash
# A local-only, reusable signing identity. No trust roots or privacy DB changes.
# Never package/export the private key or confuse this with Developer ID.
set -euo pipefail
umask 077
readonly identity_name='OS-1 CLODEX Local Development'
readonly state_dir="$HOME/Library/Application Support/OS-1/build-signing"
readonly identity_file="$state_dir/identity-sha1"
mkdir -p "$state_dir"
chmod 700 "$state_dir"
if [[ -f "$identity_file" ]]; then
  identity=$(tr -d '\n' < "$identity_file")
  if [[ "$identity" =~ ^[A-Fa-f0-9]{40}$ ]] && security find-identity -p codesigning | grep -qi "$identity"; then
    echo "Existing local signing identity: $identity"
    exit 0
  fi
  echo 'Saved local signing identity is unavailable; refusing to silently create a new privacy identity.' >&2
  exit 1
fi
if security find-certificate -c "$identity_name" >/dev/null 2>&1; then
  echo 'An existing matching certificate requires inspection before creating another.' >&2
  exit 1
fi
readonly scratch="$(mktemp -d /tmp/os1-local-signing.XXXXXX)"
# Only these three freshly generated private artifacts are removed.
trap 'rm -f "$scratch/key.pem" "$scratch/cert.pem" "$scratch/identity.p12"; rmdir "$scratch"' EXIT
openssl req -x509 -newkey rsa:3072 -nodes -days 3650 \
  -subj "/CN=$identity_name/O=OS-1 local development only" \
  -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'keyUsage=critical,digitalSignature' \
  -addext 'extendedKeyUsage=critical,codeSigning' \
  -keyout "$scratch/key.pem" -out "$scratch/cert.pem" 2>/dev/null
# Empty-password PKCS12 files have incompatible MAC handling in macOS import.
# This is an ephemeral transport phrase, NOT an account or keychain password;
# private temp-file permissions protect the generated key before import.
openssl pkcs12 -export -inkey "$scratch/key.pem" -in "$scratch/cert.pem" \
  -name "$identity_name" -passout pass:os1-local-temporary-import \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -out "$scratch/identity.p12"
keychain=$(security default-keychain -d user | sed 's/^[[:space:]]*"//;s/"[[:space:]]*$//')
security import "$scratch/identity.p12" -k "$keychain" -f pkcs12 -P os1-local-temporary-import -x -T /usr/bin/codesign
identity=$(openssl x509 -in "$scratch/cert.pem" -noout -fingerprint -sha1 | sed 's/.*=//;s/://g')
[[ "$identity" =~ ^[A-Fa-f0-9]{40}$ ]]
printf '%s\n' "$identity" > "$identity_file"
echo "Local signing identity created in the user keychain: $identity"
echo 'No system trust, MDM, Gatekeeper or macOS privacy permissions were changed.'
