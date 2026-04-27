import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface ThemeState {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: (typeof window !== 'undefined' && localStorage.getItem('dawn-theme') as Theme) || 'dark',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('dawn-theme', next)
    document.body.setAttribute('data-theme', next)
    set({ theme: next })
  },
  setTheme: (t) => {
    localStorage.setItem('dawn-theme', t)
    document.body.setAttribute('data-theme', t)
    set({ theme: t })
  },
}))
