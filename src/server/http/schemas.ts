import { z } from "zod";
import { ValidationError } from "../errors";

export const askRequestSchema = z
  .object({
    question: z
      .string()
      .trim()
      .min(3, "La pregunta es muy corta")
      .max(600, "La pregunta es muy larga (máximo 600 caracteres)"),
    /** Earlier turns for follow-up questions; only the last few are used. */
    history: z
      .array(
        z.object({
          question: z.string().trim().min(1).max(1000),
          answer: z.string().max(4000),
        }),
      )
      .max(6)
      .optional(),
  })
  .strict();

export type AskRequest = z.infer<typeof askRequestSchema>;

export const idParamSchema = z.object({ id: z.uuid("Invalid id") });

/** Parse or throw a typed ValidationError with field-level details. */
export function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fieldErrors = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    throw new ValidationError(fieldErrors[0]?.message ?? "Invalid request", fieldErrors);
  }
  return result.data;
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}
