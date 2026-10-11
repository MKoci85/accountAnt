import type { Metadata } from "next";
import { Manrope, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import { AvisoBandeja } from "@/components/aviso-bandeja";
import { obtenerResumenBandeja } from "@/app/actions/entrantes";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AccountAnt",
  description: "Seguimiento personal de gastos hormiga",
};

// Lee la bandeja de entrada en cada pedido: prerenderizado, el aviso quedaría
// congelado en lo que había al compilar.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const bandeja = await obtenerResumenBandeja();

  return (
    <html
      lang="es"
      className={`${manrope.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="flex min-h-screen">
          <Nav />
          <main className="flex-1 pb-20 md:pb-0">
            <AvisoBandeja
              total={bandeja.total}
              atrasados={bandeja.bloqueada ? bandeja.atrasados : 0}
            />
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
