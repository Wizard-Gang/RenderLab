import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../../src/demo/ui/App";

describe("reference application shell", () => {
  it("names the product and starts the renderer view on the auto backend", () => {
    const markup = renderToStaticMarkup(createElement(App));
    expect(markup).toContain("<h1>RenderLab</h1>");
    expect(markup).toContain('<div class="renderer-host" data-status="starting" style="width:480px;height:270px" tabindex="0"');
    expect(markup).toContain('<p role="status">Starting the renderer…</p>');
    expect(markup).toContain('<button type="button">Restart renderer</button>');
    expect(markup).toContain('<option value="auto" selected="">Auto (prefers WebGL2)</option>');
    expect(markup).toContain('<option value="smooth" selected="">Smooth</option><option value="strict">Strict pixel</option>');
    expect(markup).toContain('<button type="button">Reset view</button>');
  });
});
