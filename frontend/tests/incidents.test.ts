import { describe, expect, it } from "vitest";

import { buildQuery } from "@/lib/api";
import {
  DEFAULT_FILTERS,
  filtersFromParams,
  paramsFromFilters,
  type IncidentFilters,
} from "@/lib/incidents";

describe("incident filters", () => {
  it("defaults when no params are present", () => {
    expect(filtersFromParams(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it("round-trips filters through URL params", () => {
    const filters: IncidentFilters = {
      state: "open",
      service: "PIX-Core",
      q: "pix",
      page: 3,
    };
    expect(filtersFromParams(paramsFromFilters(filters))).toEqual(filters);
  });

  it("omits default values from the URL", () => {
    expect(paramsFromFilters(DEFAULT_FILTERS).toString()).toBe("");
  });
});

describe("buildQuery", () => {
  it("is empty for no/default params", () => {
    expect(buildQuery({})).toBe("");
    expect(buildQuery({ state: "all" })).toBe("");
  });

  it("encodes the active filters", () => {
    const qs = buildQuery({ state: "open", service: "PIX-Core", q: "pix", offset: 50 });
    expect(qs.startsWith("?")).toBe(true);
    expect(qs).toContain("state=open");
    expect(qs).toContain("service=PIX-Core");
    expect(qs).toContain("offset=50");
  });
});
