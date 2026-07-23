import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "./store";

describe("store (phase-0 smoke)", () => {
  beforeEach(() => {
    useStore.setState({ turnNumber: 0 });
  });

  it("seeds the scenario defaults", () => {
    const s = useStore.getState();
    expect(s.location).toBe("The Dusty Path");
    expect(s.day).toBe(1);
  });

  it("bumpTurn advances the turn counter", () => {
    useStore.getState().bumpTurn();
    useStore.getState().bumpTurn();
    expect(useStore.getState().turnNumber).toBe(2);
  });
});
