import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User } from "@/types/database";

interface FilterState {
  selectedMonth: number | null;
  selectedYear: number | null;   // null = All Years
  selectedSalesperson: string | null;
  selectedStatus: string | null;
  selectedLevel: string | null;
  selectedProduct: string | null;
  searchQuery: string;
}

interface AppState {
  // Layout
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  // Locale
  locale: string;
  setLocale: (locale: string) => void;

  // User
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  salespersonId: string | null;      // set when logged-in user is a salesperson
  setSalespersonId: (id: string | null) => void;

  // Filters
  filters: FilterState;
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  resetFilters: () => void;

  // UI
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

// Default to current month + year so pages load with real data immediately
const now = new Date();
const defaultFilters: FilterState = {
  selectedMonth: now.getMonth() + 1,     // 1–12, current month
  selectedYear:  now.getFullYear(),       // current year
  selectedSalesperson: null,
  selectedStatus: null,
  selectedLevel: null,
  selectedProduct: null,
  searchQuery: "",
};

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
            return { filters: { ...state.filters, selectedMonth: now.getMonth() + 1 } };
          }
          if (key === "selectedYear" && (value === null || value === undefined)) {
            return { filters: { ...state.filters, selectedYear: now.getFullYear() } };
          }
          return { filters: { ...state.filters, [key]: value } };
        }),
      resetFilters: () => set({ filters: defaultFilters }),

      isLoading: false,
      setIsLoading: (loading) => set({ isLoading: loading }),
    }),
    {
      name: "cartela-store-v2",
      partialize: (state) => ({
        locale: state.locale,
        sidebarCollapsed: state.sidebarCollapsed,
        filters: state.filters,
      }),
    }
  )
);
