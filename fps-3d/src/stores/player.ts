import { create } from "zustand";

interface PlayerState {
  speed: number;
  altitude: number;
  stamina: number;
  locked: boolean;
  setMetrics: (speed: number, altitude: number, stamina: number) => void;
  setLocked: (locked: boolean) => void;
}

export const usePlayerState = create<PlayerState>((set) => ({
  speed: 0,
  altitude: 0,
  stamina: 100,
  locked: false,
  setMetrics: (speed, altitude, stamina) =>
    set(() => ({ speed, altitude, stamina })),
  setLocked: (locked) => set(() => ({ locked })),
}));
