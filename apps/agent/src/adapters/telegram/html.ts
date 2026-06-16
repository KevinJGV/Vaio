// Saneo del HTML para la Bot API de Telegram. El modelo a veces emite tags que Telegram NO soporta en
// `parse_mode: HTML` (p.ej. `<span>` PELADO —solo vale `<span class="tg-spoiler">`—, `<ul>/<li>/<p>/<h1>/<div>`)
// → Telegram responde 400 "can't parse entities: Tag X ...". Verificado en vivo (un `4<span>0</span>4`) + context7.
// `sanitizeTelegramHtml` deja SOLO los tags soportados (mantiene el texto interno del resto); `stripTelegramHtml`
// quita TODOS los tags (fallback a texto plano: limpio, sin markup crudo a la vista).

/** Tags que Telegram acepta en parse_mode HTML (context7 / core.telegram.org/bots/api). `span` se EXCLUYE a
 *  propósito: solo es válido con `class="tg-spoiler"` y emparejar ese caso no compensa (el modelo casi no usa
 *  spoilers; existe `<tg-spoiler>`). */
const TG_ALLOWED = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ins",
  "s",
  "strike",
  "del",
  "tg-spoiler",
  "tg-emoji",
  "a",
  "code",
  "pre",
  "blockquote",
])

/** Cualquier tag de apertura/cierre: captura el nombre (con guion para tg-spoiler/tg-emoji). */
const TAG_RE = /<\/?([a-zA-Z][\w-]*)(?:\s[^>]*)?>/g

/** Deja solo los tags soportados por Telegram; descarta el resto manteniendo su texto. `<br>` → salto de línea. */
export function sanitizeTelegramHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(TAG_RE, (match, name: string) =>
      TG_ALLOWED.has(name.toLowerCase()) ? match : ""
    )
}

/** Quita TODOS los tags HTML (para el fallback a texto plano: que no se vean `<b>`/`<code>` crudos). */
export function stripTelegramHtml(text: string): string {
  return text.replace(TAG_RE, "")
}
