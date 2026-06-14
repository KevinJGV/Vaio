import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { hasSecret, scanSecrets } from "../src/core/secret-scan.js"

// Helper: el primer (y normalmente único) finding de un contenido.
const first = (content: string) => scanSecrets(content)[0]

describe("scanSecrets — un caso por patrón (positivo)", () => {
  it("detecta AWS access key", () => {
    const f = first('aws = "AKIA1234567890ABCDEF"')
    expect(f?.pattern).toBe("aws-access-key")
    expect(f?.line).toBe(1)
  })

  it("detecta cabecera de private key", () => {
    const f = first("-----BEGIN RSA PRIVATE KEY-----")
    expect(f?.pattern).toBe("private-key")
  })

  it("detecta cabecera de OPENSSH private key", () => {
    expect(hasSecret("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true)
  })

  it("detecta cabecera de private key sin algoritmo", () => {
    expect(hasSecret("-----BEGIN PRIVATE KEY-----")).toBe(true)
  })

  it("detecta GitHub PAT", () => {
    const f = first(`ghp_${"a".repeat(36)}`)
    expect(f?.pattern).toBe("github-pat")
  })

  it("detecta Slack token", () => {
    const f = first("xoxb-123456789012-abcdefghij")
    expect(f?.pattern).toBe("slack-token")
  })

  it("detecta Stripe secret key", () => {
    const f = first(`sk_live_${"a".repeat(24)}`)
    expect(f?.pattern).toBe("stripe-secret")
  })

  it("detecta OpenRouter key", () => {
    const f = first(`sk-or-v1-${"a".repeat(16)}`)
    expect(f?.pattern).toBe("openrouter-key")
  })

  it("detecta OpenAI-style key", () => {
    const f = first(`sk-${"A".repeat(24)}`)
    expect(f?.pattern).toBe("openai-key")
  })

  it("detecta URL de Postgres/Neon con password", () => {
    const f = first("postgresql://user:s3cretpass@host:5432/db")
    expect(f?.pattern).toBe("postgres-url")
  })

  it("detecta JWT", () => {
    const jwt = `eyJ${"a".repeat(12)}.eyJ${"b".repeat(12)}.${"c".repeat(10)}`
    const f = first(jwt)
    expect(f?.pattern).toBe("jwt")
  })

  it("detecta asignación genérica de secret (= con comillas)", () => {
    const f = first('const password = "superseguro123"')
    expect(f?.pattern).toBe("generic-assignment")
  })

  it("detecta asignación genérica de secret (: estilo yaml/json)", () => {
    const f = first('api_key: "abcdef123456"')
    expect(f?.pattern).toBe("generic-assignment")
  })

  it("la asignación genérica es case-insensitive en el nombre", () => {
    expect(hasSecret('API_KEY = "abcdef123456"')).toBe(true)
    expect(hasSecret('Bearer: "tok12345678"')).toBe(true)
  })
})

describe("scanSecrets — número de línea (1-based)", () => {
  it("reporta la línea correcta en contenido multi-línea", () => {
    const content = [
      "línea limpia",
      "otra línea limpia",
      `secreto = "AKIA1234567890ABCDEF"`,
    ].join("\n")
    const f = first(content)
    expect(f?.line).toBe(3)
  })

  it("reporta varias líneas cuando hay varios secrets", () => {
    const content = [
      `a = "AKIA1234567890ABCDEF"`,
      "limpio",
      `ghp_${"a".repeat(36)}`,
    ].join("\n")
    const lines = scanSecrets(content).map((f) => f.line)
    expect(lines).toContain(1)
    expect(lines).toContain(3)
  })
})

describe("scanSecrets — anti falsos positivos", () => {
  it("no dispara con referencia a process.env (sin literal)", () => {
    expect(scanSecrets("const API_KEY = process.env.API_KEY")).toEqual([])
  })

  it("no dispara con comentarios que mencionan token/password sin valor", () => {
    const content = [
      "// el token del bot va en una env var",
      "// nunca pongas el password acá",
    ].join("\n")
    expect(scanSecrets(content)).toEqual([])
  })

  it("no dispara con KEY= vacío o sin comillas (estilo .env)", () => {
    const content = ["OPENROUTER_API_KEY=", "AGENT_API_KEY=", "PORT=8787"].join(
      "\n"
    )
    expect(scanSecrets(content)).toEqual([])
  })

  it("no dispara con placeholders comunes", () => {
    const content = [
      'API_KEY="your-key-here"',
      'token: "xxx"',
      'password = "changeme"',
      'secret: "placeholder"',
      'api_key = "example-value"',
    ].join("\n")
    expect(scanSecrets(content)).toEqual([])
  })

  it("no dispara con texto normal en prosa", () => {
    const content =
      "Esto es un párrafo normal que habla de seguridad y de cómo " +
      "proteger tokens y passwords sin exponer nada sensible."
    expect(scanSecrets(content)).toEqual([])
  })

  it("no produce falso match openai-key en una URL ni en texto", () => {
    expect(scanSecrets("ver https://sk-website.example.com/docs")).toEqual([])
  })
})

describe("scanSecrets — el .env.example REAL del repo está limpio", () => {
  it("hasSecret(.env.example) === false", () => {
    const envExamplePath = fileURLToPath(
      new URL("../../../.env.example", import.meta.url)
    )
    const content = readFileSync(envExamplePath, "utf8")
    expect(hasSecret(content)).toBe(false)
    expect(scanSecrets(content)).toEqual([])
  })
})

describe("hasSecret — coherente con scanSecrets", () => {
  it("true cuando hay al menos un finding", () => {
    expect(hasSecret('aws = "AKIA1234567890ABCDEF"')).toBe(true)
  })

  it("false cuando no hay findings", () => {
    expect(hasSecret("contenido completamente limpio")).toBe(false)
  })
})
