"use client";

import { Moon, Sun, Globe, Bell, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { GlobalSearch } from "@/components/layout/GlobalSearch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface NavbarProps {
  locale: string;
  onLocaleChange: (_: string) => void;
  user?: { full_name: string; email: string; role: string };
  onMenuToggle?: () => void;
}

export function Navbar({ locale, onLocaleChange, user, onMenuToggle }: NavbarProps) {
  const { theme, setTheme } = useTheme();
  const isRTL = locale === "ar";

  const initials = user?.full_name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  return (
    <header className="sticky top-0 z-20 max-md:z-[45] flex h-12 md:h-16 items-center gap-1.5 md:gap-4 border-b border-border bg-background/95 backdrop-blur-sm px-2 md:px-6 min-w-0">
      {/* Mobile menu — above drawer (z-30) so it stays tappable in RTL */}
      {onMenuToggle && (
        <Button variant="ghost" size="icon" onClick={onMenuToggle} className="h-8 w-8 shrink-0 md:hidden">
          <Menu className="h-4 w-4 md:h-5 md:w-5" />
        </Button>
      )}

      {/* Search */}
      <GlobalSearch locale={locale} />

      <div className="flex items-center gap-0.5 md:gap-2 shrink-0">
        {/* Language switcher */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onLocaleChange(locale === "ar" ? "en" : "ar")}
          className="gap-1 md:gap-2 font-medium h-8 px-1.5 md:h-9 md:px-3"
        >
          <Globe className="h-3.5 w-3.5 md:h-4 md:w-4 shrink-0" />
          <span className="text-xs md:text-sm">{locale === "ar" ? "EN" : "عربي"}</span>
        </Button>

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 md:h-10 md:w-10"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative h-8 w-8 md:h-10 md:w-10">
          <Bell className="h-3.5 w-3.5 md:h-4 md:w-4" />
          <span className="absolute top-1 right-1 md:top-1.5 md:right-1.5 h-1.5 w-1.5 md:h-2 md:w-2 rounded-full bg-red-500" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-1 md:gap-2 px-1 md:px-2 h-8 md:h-auto">
              <Avatar className="h-7 w-7 md:h-8 md:w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden md:flex flex-col items-start">
                <span className="text-sm font-medium leading-none">{user?.full_name}</span>
                <span className="text-xs text-muted-foreground capitalize">{user?.role}</span>
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isRTL ? "start" : "end"} className="w-48">
            <DropdownMenuLabel>{isRTL ? "حسابي" : "My Account"}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>{isRTL ? "الملف الشخصي" : "Profile"}</DropdownMenuItem>
            <DropdownMenuItem>{isRTL ? "الإعدادات" : "Settings"}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
