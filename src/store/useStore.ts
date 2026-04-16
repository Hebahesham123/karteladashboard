import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types/database";

interface FilterState {
  selectedMonth: number | null;
  selectedYear: number | null;   // null = All Years
  selectedSalesperson: string | null;
  selectedSalespersons: string[];
  selectedClient: string | null;
  selectedClients: string[];
  selectedStatus: string | null;
  selectedLevel: string | null;
  selectedProduct: string | null;
  selectedProducts: string[];
  searchQuery: string;
}

interface AppState {
  // Layout
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (_: boolean) => void;
  toggleSidebar: () => void;

  // Locale
  locale: string;
  setLocale: (_: string) => void;

  // User
  currentUser: User | null;
  setCurrentUser: (_: User | null) => void;
  salespersonId: string | null;
  setSalespersonId: (_: string | null) => void;

  // Filters
  filters: FilterState;
  setFilter: <K extends keyof FilterState>(_k: K, _v: FilterState[K]) => void;
  resetFilters: () => void;

  // UI
  isLoading: boolean;
  setIsLoading: (_: boolean) => void;
}

// Default to previous month (complete data period)
const now = new Date();
const defaultMonth = now.getMonth() === 0 ? 12 : now.getMonth();
const defaultYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
const defaultFilters: FilterState = {
  selectedMonth: defaultMonth,
  selectedYear:  defaultYear,
  selectedSalesperson: null,
  selectedSalespersons: [],
  selectedClient: null,
  selectedClients: [],
  selectedStatus: null,
  /** Default: ORANGE = meter orders under 100m. User can pick "All levels" to clear. */
  selectedLevel: "ORANGE",
  selectedProduct: null,
  selectedProducts: [],
  searchQuery: "",
};

/** One-shot: older persisted state used selectedLevel null as default; coerce to ORANGE once. */
const SELECT_LEVEL_LEGACY_MIGRATION_KEY =
  "cartela-selected-level-default-orange-v1";

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      locale: "ar",
      setLocale: (locale) => set({ locale }),

      currentUser: null,
      setCurrentUser: (user) => set({ currentUser: user }),
      salespersonId: null,
      setSalespersonId: (id) => set({ salespersonId: id }),

      filters: defaultFilters,
      setFilter: (key, value) =>
        set((state) => {
          // Never allow selectedMonth or selectedYear to become null
          if (key === "selectedMonth" && (value === null || value === undefined)) {
            return { filters: { ...state.filters, selectedMonth: defaultMonth } };
          }
          if (key === "selectedYear" && (value === null || value === undefined)) {
            return { filters: { ...state.filters, selectedYear: defaultYear } };
          }
          return { filters: { ...state.filters, [key]: value } };
        }),
      resetFilters: () => set({ filters: defaultFilters }),

      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: "cartela-store-v2",
      version: 1,
      migrate: (persistedState, fromVersion) => {
        const ps = persistedState as {
          locale?: string;
          sidebarCollapsed?: boolean;
          filters?: Partial<FilterState>;
        };
        if (fromVersion === 0 && ps?.filters != null) {
          const level = ps.filters.selectedLevel;
          if (level === null || level === undefined) {
            return {
              locale: ps.locale ?? "ar",
              sidebarCollapsed: ps.sidebarCollapsed ?? false,
              filters: { ...defaultFilters, ...ps.filters, selectedLevel: "ORANGE" },
            };
          }
        }
        return persistedState as {
          locale: string;
          sidebarCollapsed: boolean;
          filters: FilterState;
        };
      },
      onRehydrateStorage: () => (rehydrated, error) => {
        if (error || !rehydrated) return;
        if (typeof window === "undefined") return;
        try {
          if (localStorage.getItem(SELECT_LEVEL_LEGACY_MIGRATION_KEY)) return;
          if (rehydrated.filters.selectedLevel == null) {
            useStore.getState().setFilter("selectedLevel", "ORANGE");
          }
          localStorage.setItem(SELECT_LEVEL_LEGACY_MIGRATION_KEY, "1");
        } catch {
          /* ignore quota / private mode */
        }
      },
      partialize: (state) => ({
        locale: state.locale,
        sidebarCollapsed: state.sidebarCollapsed,
        filters: state.filters,
      }),
    }
  )
);
