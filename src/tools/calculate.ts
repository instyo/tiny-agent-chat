import { createTool } from "@anvia/core";
import { z } from "zod";

function evaluateArithmetic(expression: string): number {
  const cleaned = expression.replace(/\s+/g, "");
  if (!cleaned) {
    throw new Error("Expression is empty.");
  }
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) {
    throw new Error("Only digits and + - * / ( ) . are allowed.");
  }

  let i = 0;

  function peek() {
    return cleaned[i];
  }

  function consume() {
    return cleaned[i++];
  }

  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseFactor();
      if (op === "*") {
        value *= right;
      } else {
        if (right === 0) throw new Error("Division by zero.");
        value /= right;
      }
    }
    return value;
  }

  function parseFactor(): number {
    if (peek() === "+") {
      consume();
      return parseFactor();
    }
    if (peek() === "-") {
      consume();
      return -parseFactor();
    }
    if (peek() === "(") {
      consume();
      const value = parseExpression();
      if (peek() !== ")") throw new Error("Missing closing parenthesis.");
      consume();
      return value;
    }
    return parseNumber();
  }

  function parseNumber(): number {
    const start = i;
    while (true) {
      const ch = peek();
      if (!ch || !/[0-9.]/.test(ch)) break;
      consume();
    }
    if (start === i) throw new Error("Expected a number.");
    const raw = cleaned.slice(start, i);
    if ((raw.match(/\./g) ?? []).length > 1) {
      throw new Error(`Invalid number: ${raw}`);
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`Invalid number: ${raw}`);
    return value;
  }

  const result = parseExpression();
  if (i !== cleaned.length) {
    throw new Error(`Unexpected character at position ${i}.`);
  }
  return result;
}

export const calculateTool = createTool({
  name: "calculate",
  description:
    "Evaluate a basic arithmetic expression using + - * / and parentheses.",
  inputSchema: z.object({
    expression: z
      .string()
      .min(1)
      .describe("A basic arithmetic expression such as 123 * 456"),
  }),
  outputSchema: z.object({
    expression: z.string(),
    result: z.number(),
  }),
  async execute({ expression }) {
    return {
      expression,
      result: evaluateArithmetic(expression),
    };
  },
});
