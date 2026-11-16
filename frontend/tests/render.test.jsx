import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import React from "react";
import App from "../src/App.jsx";

describe("SSR-смоук рендера (ловит падения фазы render: TDZ, undefined-константы)", () => {
  it("App рендерится без исключений", () => {
    const html = renderToString(React.createElement(App));
    expect(html).toContain("Всемирная ёлка подарков");
    expect(html).toContain("Кольцо");
  });
});
