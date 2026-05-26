import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { tokenizeCli } from "@/lib/tokenize-cli";

describe("tokenizeCli", () => {
  it("renders an env-var line with .tok-env and .tok-str spans", () => {
    const { container } = render(
      <pre>{tokenizeCli("NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem \\")}</pre>,
    );
    expect(container.querySelector(".tok-env")).toHaveTextContent(
      "NODE_EXTRA_CA_CERTS",
    );
    expect(container.querySelector(".tok-str")).toHaveTextContent(
      "/etc/ssl/cert.pem",
    );
    expect(container.querySelector(".tok-cont")).toHaveTextContent("\\");
  });

  it("renders flags with .tok-flag", () => {
    const { container } = render(
      <pre>{tokenizeCli('  --figma-url "https://example/" \\')}</pre>,
    );
    expect(container.querySelector(".tok-flag")).toHaveTextContent(
      "--figma-url",
    );
    expect(container.querySelector(".tok-str")).toBeTruthy();
  });
});
