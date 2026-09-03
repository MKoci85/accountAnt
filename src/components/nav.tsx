"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Receipt,
  BarChart3,
  Settings2,
  CreditCard,
  Repeat,
  SlidersHorizontal,
} from "lucide-react";

const links = [
  { href: "/", label: "Inicio", icon: LayoutDashboard },
  { href: "/gastos", label: "Gastos", icon: Receipt },
  { href: "/gastos-fijos", label: "Fijos", icon: Repeat },
  { href: "/estado-cuenta", label: "Tarjeta", icon: CreditCard },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/catalogos", label: "Catálogos", icon: Settings2 },
  { href: "/ajustes", label: "Ajustes", icon: SlidersHorizontal },
];

const linksMobile = links.filter((l) => l.href !== "/ajustes");

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <>
      <aside className="hidden md:flex md:w-60 md:shrink-0 md:flex-col md:gap-8 bg-sidebar text-sidebar-foreground p-6">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="marca-hormiga h-8 w-8 shrink-0 bg-sidebar-primary"
          />
          <span className="text-[17px] font-semibold tracking-tight">
            AccountAnt
          </span>
        </div>

        <nav className="flex flex-col gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="h-4.5 w-4.5" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-sidebar-border pt-4 text-xs text-sidebar-foreground/50">
          Uso local · sin sincronización
        </div>
      </aside>

      <nav className="md:hidden fixed inset-x-0 bottom-0 z-10 flex items-center justify-around border-t border-border bg-sidebar px-2 py-2 text-sidebar-foreground">
        {linksMobile.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-medium ${
                active
                  ? "text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
