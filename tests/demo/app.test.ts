import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../../src/demo/ui/App";

describe("reference application shell", () => {
  it("names the product and reports that no renderer is mounted yet", () => {
    const markup = renderToStaticMarkup(createElement(App));
    expect(markup).toContain("<h1>RenderLab</h1>");
    expect(markup).toContain('<p role="status">Repository bootstrap: no renderer is mounted yet.</p>');
  });
});
