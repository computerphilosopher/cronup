import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("CronUp dashboard", () => {
  it("renders the check creation shell", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "My checks" })).toBeInTheDocument();
    expect(
      screen.getByText("Private dead-man switches on your Cloudflare account."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create check" })).toBeInTheDocument();
  });
});
