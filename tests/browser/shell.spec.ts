import { expect, test } from "@playwright/test";

test("the built shell loads without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "RenderLab" })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/^Rendering the reference scene with WebGL2/);
  expect(errors).toEqual([]);
});
