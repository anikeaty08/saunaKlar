import { create } from 'zustand';
import { toggle, type ModelRules, type ToggleResult } from '@saunaklar/rules';
import type { PlacementValue } from '../../three/types.ts';

/**
 * Configurator state for the sauna being edited. Selections change only
 * through the rules engine's `toggle`, so the UI can never reach a
 * combination the API would reject.
 */
interface ConfiguratorState {
  slug: string | null;
  configurationId: string | null;
  selection: string[];
  roomId: string | null;
  placement: PlacementValue;
  dirty: boolean;
  init: (slug: string, selection: string[], configurationId?: string | null, room?: { id: string; placement: PlacementValue } | null) => void;
  toggleOption: (rules: ModelRules, optionId: string, on: boolean) => ToggleResult;
  setRoom: (roomId: string | null) => void;
  setPlacement: (p: PlacementValue) => void;
  saved: (configurationId: string) => void;
}

export const ORIGIN: PlacementValue = { positionXMm: 0, positionZMm: 0, rotationDeg: 0 };

export const useConfigurator = create<ConfiguratorState>((set, get) => ({
  slug: null,
  configurationId: null,
  selection: [],
  roomId: null,
  placement: ORIGIN,
  dirty: false,
  init: (slug, selection, configurationId = null, room = null) =>
    set({ slug, selection, configurationId, roomId: room?.id ?? null, placement: room?.placement ?? ORIGIN, dirty: false }),
  toggleOption: (rules, optionId, on) => {
    const r = toggle(rules, get().selection, optionId, on);
    if (!r.rejected) set({ selection: r.selection, dirty: true });
    return r;
  },
  setRoom: roomId => set({ roomId, placement: ORIGIN, dirty: true }),
  setPlacement: placement => set({ placement, dirty: true }),
  saved: configurationId => set({ configurationId, dirty: false }),
}));
