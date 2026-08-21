import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("CronUp React scaffold", () => {
  it("renders the product shell", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "CronUp" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Monitoring that runs on your Cloudflare account."),
    ).toBeInTheDocument();
  });
});
