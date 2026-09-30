import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import PDISBadge from "@/components/ui/PDISBadge";

describe("PDISBadge", () => {
  it("renders unavailable scores without inventing a zero", () => {
    render(<PDISBadge score={null} />);
    expect(screen.getByText("N/A")).toBeInTheDocument();
  });
  it("renders the 0-100 score with one decimal", () => {
    render(<PDISBadge score={45.67} />);
    expect(screen.getByText("45.7")).toBeInTheDocument();
  });

  it("renders the large badge with two decimals", () => {
    render(<PDISBadge score={96.36} size="lg" />);
    expect(screen.getByText("96.36")).toBeInTheDocument();
  });

  it("renders zero score", () => {
    render(<PDISBadge score={0} />);
    expect(screen.getByText("0.0")).toBeInTheDocument();
  });

  it("renders max score", () => {
    render(<PDISBadge score={100} />);
    expect(screen.getByText("100.0")).toBeInTheDocument();
  });

  it("renders with sm size", () => {
    const { container } = render(<PDISBadge score={50} size="sm" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
