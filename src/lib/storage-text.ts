/** PostgreSQL UTF-8 text/JSONB cannot represent NUL or lone UTF-16 surrogates. */
export function isStorageText(value: string): boolean {
  return value.isWellFormed() && !value.includes("\0");
}
