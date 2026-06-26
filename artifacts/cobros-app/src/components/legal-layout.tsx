import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export function LegalLayout({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/">
            <img
              src={`${import.meta.env.BASE_URL}brand/nextcob-logo.png`}
              alt="NextCob"
              className="h-8 w-auto cursor-pointer"
            />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al inicio
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Última actualización: {updatedAt}
        </p>
        <div className="legal-content mt-8 space-y-6 text-[15px] leading-relaxed text-foreground/90">
          {children}
        </div>

        <div className="mt-12 border-t border-border pt-6 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/privacidad" className="hover:text-foreground transition-colors">
            Política de Privacidad
          </Link>
          <Link href="/terminos" className="hover:text-foreground transition-colors">
            Términos y Condiciones
          </Link>
          <a
            href="mailto:contacto@nextcob.com"
            className="hover:text-foreground transition-colors"
          >
            contacto@nextcob.com
          </a>
        </div>
      </main>
    </div>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}
