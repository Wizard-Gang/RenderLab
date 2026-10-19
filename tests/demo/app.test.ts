import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "../../src/demo/ui/App";

describe("reference application shell", () => {
  it("names the product and starts the WebGL2 renderer view", () => {
    const markup = renderToStaticMarkup(createElement(App));
    expect(markup).toContain("<h1>RenderLab</h1>");
    expect(markup).toContain('<div class="renderer-host" data-status="starting" style="width:480px;height:270px"></div>');
    expect(markup).toContain('<p role="status">Starting WebGL2…</p>');
    expect(markup).toContain('<button type="button">Restart renderer</button>');
  });
});
