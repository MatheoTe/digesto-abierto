import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Instrument_Serif, Inter_Tight } from "next/font/google";
import { Backdrop } from "@/components/backdrop";
import { MotionProvider } from "@/components/motion-provider";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Inter_Tight({ variable: "--font-display", subsets: ["latin"], weight: ["500", "600", "700"] });
const serif = Instrument_Serif({ variable: "--font-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: { default: "Digesto Abierto — las ordenanzas de Mar del Plata, en castellano", template: "%s · Digesto Abierto" },
  description:
    "Preguntale a las ordenanzas municipales de General Pueyrredon y recibí una respuesta con el artículo exacto, el link al texto oficial del Concejo Deliberante y aviso si la norma cambió.",
  openGraph: {
    title: "Digesto Abierto",
    description: "Las ordenanzas de Mar del Plata, respondidas con el artículo exacto y su vigencia.",
    locale: "es_AR",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es-AR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <MotionProvider>
            <Backdrop />
            <SiteHeader />
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
            <footer className="border-t border-border/70 py-8 text-xs text-muted-foreground">
              <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                <p className="max-w-xl leading-relaxed">
                  <span className="font-display font-semibold text-foreground/85">Digesto Abierto</span> no es un sitio oficial ni
                  da asesoramiento legal. Responde con los textos que publica la Biblioteca del Honorable Concejo Deliberante de
                  General Pueyrredon; tiene validez legal lo publicado en el Boletín Oficial Municipal.
                </p>
                <p className="flex shrink-0 flex-wrap gap-x-4 gap-y-1">
                  <Link href="/como-funciona" className="hover:text-foreground">
                    Cómo funciona
                  </Link>
                  <a href="https://basenormas.concejomdp.gov.ar" target="_blank" rel="noreferrer" className="hover:text-foreground">
                    Base de Normas del HCD
                  </a>
                  <a href="https://github.com/MatheoTe/digesto-abierto" target="_blank" rel="noreferrer" className="hover:text-foreground">
                    Código abierto
                  </a>
                </p>
              </div>
            </footer>
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
