import * as React from "react";
import { cn } from "@/lib/utils";

function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const title = props.title ?? props["aria-label"];
  return (
    <select
      className={cn(
        "flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className
      )}
      {...props}
      title={title}
    />
  );
}

export { Select };
