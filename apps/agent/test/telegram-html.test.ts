import { describe, expect, it } from "vitest"
import {
  escapeTelegramHtml,
  sanitizeTelegramHtml,
  stripTelegramHtml,
} from "../src/adapters/telegram/html.js"

describe("sanitizeTelegramHtml", () => {
  it("descarta el `<span>` pelado manteniendo el texto (el bug real: 4<span>0</span>4)", () => {
    expect(sanitizeTelegramHtml("4<span>0</span>4")).toBe("404")
  })

  it("conserva los tags SOPORTADOS (b/i/code/pre/a/blockquote/tg-spoiler)", () => {
    const ok =
      '<b>bold</b> <i>x</i> <code>y</code> <pre>z</pre> <a href="http://e.com">l</a> <blockquote>q</blockquote> <tg-spoiler>s</tg-spoiler>'
    expect(sanitizeTelegramHtml(ok)).toBe(ok)
  })

  it("descarta tags NO soportados manteniendo el texto (ul/li/p/h1/div)", () => {
    expect(sanitizeTelegramHtml("<ul><li>uno</li><li>dos</li></ul>")).toBe(
      "unodos"
    )
    expect(sanitizeTelegramHtml("<h1>Título</h1><p>texto</p>")).toBe(
      "Títulotexto"
    )
    expect(sanitizeTelegramHtml('<div class="x">y</div>')).toBe("y")
  })

  it("`<br>` (y variantes) → salto de línea", () => {
    expect(sanitizeTelegramHtml("a<br>b<br/>c<br />d")).toBe("a\nb\nc\nd")
  })

  it("conserva atributos de los tags soportados (href de <a>, class de <code>)", () => {
    expect(sanitizeTelegramHtml('<a href="https://x.com/a-b_c">t</a>')).toBe(
      '<a href="https://x.com/a-b_c">t</a>'
    )
    expect(
      sanitizeTelegramHtml('<pre><code class="language-ts">x</code></pre>')
    ).toBe('<pre><code class="language-ts">x</code></pre>')
  })
})

describe("stripTelegramHtml", () => {
  it("quita TODOS los tags (fallback texto plano limpio)", () => {
    expect(
      stripTelegramHtml("<b>bold</b> <code>y</code> 4<span>0</span>4")
    ).toBe("bold y 404")
  })
})

describe("escapeTelegramHtml", () => {
  it("neutraliza tags inyectados por un visitante (no se renderizan como HTML)", () => {
    expect(escapeTelegramHtml("<b>x</b>")).toBe("&lt;b&gt;x&lt;/b&gt;")
    // tras escapar, sanitize ya no ve tags → el visitante no puede inyectar formato
    expect(sanitizeTelegramHtml(escapeTelegramHtml("<b>x</b>"))).toBe(
      "&lt;b&gt;x&lt;/b&gt;"
    )
  })

  it("escapa `&` primero (no doble-escapa)", () => {
    expect(escapeTelegramHtml("Tom & Jerry < 5 > 3")).toBe(
      "Tom &amp; Jerry &lt; 5 &gt; 3"
    )
  })

  it("deja intacto el texto sin metacaracteres", () => {
    expect(escapeTelegramHtml("¿le gusta la pasta?")).toBe(
      "¿le gusta la pasta?"
    )
  })
})
