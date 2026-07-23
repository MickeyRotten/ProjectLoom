import { create } from "zustand";

/**
 * Phase 0 store — the minimal slice of the active game the shell needs to
 * prove Zustand is wired. The full `GameState` / `Settings` shape from
 * DESIGN.md → Data Model lands with the turn loop in Phase 1+.
 */
export interface LoomState {
  location: string;
  day: number;
  turnNumber: number;
  bumpTurn: () => void;
}

export const useStore = create<LoomState>((set) => ({
  location: "The Dusty Path",
  day: 1,
  turnNumber: 0,
  bumpTurn: () => set((s) => ({ turnNumber: s.turnNumber + 1 })),
}));
