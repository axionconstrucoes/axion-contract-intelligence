import * as React from "react";
import { cn } from "@/lib/utils";

function Avatar({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground ring-1 ring-border",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { Avatar };
