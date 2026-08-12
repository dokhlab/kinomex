import { render, screen } from "@testing-library/react";
import StatsBar from "@/components/ui/StatsBar";

jest.mock("framer-motion", () => ({
  motion: { div: "div" },
  useInView: () => false,
}));

describe("StatsBar", () => {
  it("renders unavailable markers instead of NaN for malformed counts", () => {
    render(
      <StatsBar
        stats={{
          totalKinases: undefined,
          totalLigands: Number.NaN,
          totalVariants: -1,
          totalStructures: undefined,
          totalDiseases: Number.POSITIVE_INFINITY,
        } as any}
      />,
    );

    expect(screen.queryByText("NaN")).toBeNull();
    expect(screen.getAllByText("—")).toHaveLength(5);
  });
});
