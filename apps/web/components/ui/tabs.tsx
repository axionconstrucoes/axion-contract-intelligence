"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsProps {
  defaultValue: string;
  className?: string;
  children: React.ReactNode;
}

const TabsContext = React.createContext<{ value: string; setValue: (v: string) => void } | null>(null);

function Tabs({ defaultValue, className, children }: TabsProps) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("inline-flex items-center gap-1 rounded-md bg-muted p-1", className)} {...props} />;
}

// `variant="prominent"` (Ações e Escalonamentos — Parte 5): fonte +2
// corpos (text-sm -> text-lg) e aba ativa preto/branco de alto contraste,
// em vez do bg-background/text-foreground padrão. Nunca o default global
// — outras páginas (ex.: Documentos) continuam exatamente como antes,
// só quem passa variant="prominent" explicitamente muda de aparência.
// focus-visible (anel de foco) é sempre aplicado, nos dois variants —
// acessibilidade de teclado não é opcional.
function TabsTrigger({
  value,
  className,
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string; variant?: "default" | "prominent" }) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsTrigger deve estar dentro de Tabs");
  const active = ctx.value === value;
  return (
    <button
      type="button"
      onClick={() => ctx.setValue(value)}
      className={cn(
        "rounded-sm px-3 py-1 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        variant === "prominent" ? "text-lg" : "text-sm",
        active
          ? variant === "prominent"
            ? "bg-black text-white shadow-sm"
            : "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ value, className, children }: { value: string; className?: string; children: React.ReactNode }) {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error("TabsContent deve estar dentro de Tabs");
  if (ctx.value !== value) return null;
  return <div className={cn("mt-3", className)}>{children}</div>;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
