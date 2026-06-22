import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Badge } from "@/components/ui/badge";

describe("Badge", () => {
  it("renders its content", () => {
    const { container } = render(<Badge variant="success">PROCEDENTE</Badge>);
    expect(container.textContent).toContain("PROCEDENTE");
  });
});
