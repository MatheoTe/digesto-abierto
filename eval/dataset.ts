import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const expectedItemSchema = z.object({
  /** Ordinance that answers the question. */
  ordinance: z.number().int().positive(),
  /**
   * Strings that must appear in a chunk of that ordinance for it to count as
   * relevant (any of them). Empty = any chunk of the ordinance, e.g. its record card.
   */
  evidence: z.array(z.string().min(1)).default([]),
});

const questionSchema = z.object({
  id: z.string(),
  question: z.string().min(3),
  tags: z.array(z.string()).default([]),
  answerable: z.boolean().default(true),
  /** "any": one expected item suffices (the same rule is in two ordinances); "all": every item. */
  match: z.enum(["all", "any"]).default("any"),
  expected: z.array(expectedItemSchema).default([]),
  /** Facts a correct answer must contain (case-, accent- and whitespace-insensitive). */
  mustInclude: z.array(z.string()).default([]),
  /** The verified answer, written by hand from the official text. */
  reference: z.string().optional(),
});

const datasetSchema = z.object({
  version: z.number(),
  description: z.string(),
  questions: z.array(questionSchema).min(1),
});

export type GoldenQuestion = z.infer<typeof questionSchema>;
export type ExpectedItem = z.infer<typeof expectedItemSchema>;

export async function loadGoldenSet(file = path.resolve("eval/golden.json")): Promise<GoldenQuestion[]> {
  const parsed = datasetSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const ids = new Set<string>();
  for (const q of parsed.questions) {
    if (ids.has(q.id)) throw new Error(`id repetido: ${q.id}`);
    ids.add(q.id);
    if (q.answerable && q.expected.length === 0) throw new Error(`la pregunta ${q.id} tiene respuesta pero no fuentes esperadas`);
  }
  return parsed.questions;
}
