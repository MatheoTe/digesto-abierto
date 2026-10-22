import { expect, test } from "@playwright/test";

test("pregunta, cita con vigencia, panel de la fuente y página de la ordenanza", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Preguntale a las ordenanzas/ })).toBeVisible();
  await expect(page.getByTestId("corpus-stats")).toContainText("ordenanzas en la base");

  await page.getByLabel("Tu pregunta").fill("¿Cuántas horas de turno diario obligatorio tiene que cumplir un taxi?");
  await page.keyboard.press("Enter");

  const answer = page.getByTestId("answer");
  await expect(answer).toContainText("ocho (8) horas");
  await expect(answer).toContainText("fuente citada");
  // The cited ordinance was amended after its consolidated text: the answer says so.
  await expect(page.getByTestId("vigencia")).toContainText("Ordenanza 90020");

  await page.getByTestId("citation").first().click();
  const panel = page.getByTestId("source-panel");
  await expect(panel).toContainText("Ordenanza 90001 · Art. 16º");
  await expect(panel).toContainText("Cambios sin incorporar");

  await panel.getByRole("link", { name: /Ver la ordenanza completa/ }).click();
  await expect(page).toHaveURL(/\/ordenanza\/90001#frag-/);
  await expect(page.getByRole("heading", { name: "Ordenanza 90001" })).toBeVisible();
  await expect(page.getByText("Modificada por:").first()).toBeVisible();
});

test("una ordenanza derogada lo dice, y una inexistente muestra la página de no encontrada", async ({ page }) => {
  await page.goto("/ordenanza/90003");
  await expect(page.getByText("no está vigente", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ordenanza 90004" }).first()).toBeVisible();

  // The page streams, so the status is already 200 when notFound() runs; Next marks it noindex.
  await page.goto("/ordenanza/12345");
  await expect(page.getByText("No está en el digesto")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("se abstiene cuando el digesto no responde", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Tu pregunta").fill("¿Cuánto cuesta el estacionamiento medido en la Rambla?");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("answer")).toContainText("No encontré esto en las ordenanzas vigentes");
  await expect(page.getByTestId("answer")).toContainText("No está en el digesto");
});
