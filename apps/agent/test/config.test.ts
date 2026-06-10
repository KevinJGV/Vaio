import { describe, expect, it } from "vitest";
import type { Env } from "../src/config.js";
import { modelChain } from "../src/config.js";

function envWith(models: string | undefined): Env {
  return { OPENROUTER_MODELS: models } as Env;
}

describe("modelChain", () => {
  it("parsea lista separada por comas, trimea y filtra vacíos", () => {
    expect(modelChain(envWith("a/x, b/y ,, c/z "))).toEqual(["a/x", "b/y", "c/z"]);
  });

  it("devuelve [] si no hay OPENROUTER_MODELS", () => {
    expect(modelChain(envWith(undefined))).toEqual([]);
  });

  it("preserva el orden (primario primero = cadena de fallback)", () => {
    const chain = modelChain(envWith("primary,fallback,free"));
    expect(chain[0]).toBe("primary");
    expect(chain.at(-1)).toBe("free");
  });
});
